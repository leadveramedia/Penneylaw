/**
 * Netlify Edge Function: Meta Tag Injection
 *
 * Intercepts requests to /blog/*, /accident-news/*, /{city}/*, and /{city}/
 * and injects per-page <title>, <meta description>, canonical, OG/Twitter,
 * H1 + excerpt, and JSON-LD by fetching content from Storyblok's CDN API.
 *
 * On failure, sets a self-canonical and adds noindex so a broken render
 * isn't deduped to the homepage by Google.
 *
 * Runs on Deno (Netlify Edge Functions runtime).
 */

// Public read-only content delivery token (intentionally client-side; visible in browser network tab regardless)
const STORYBLOK_TOKEN = 'yDLol9DLwFeUUgsyYx3rcQtt';
const STORYBLOK_API = 'https://api.storyblok.com/v2/cdn';

// City folders managed by Storyblok
const CITY_FOLDERS = ['sacramento', 'roseville', 'stockton', 'modesto', 'oakland', 'redding', 'chico', 'fairfield'];

// Per-city metadata for bare-city content hubs
const CITY_META = {
    sacramento: { name: 'Sacramento', county: 'Sacramento County' },
    roseville:  { name: 'Roseville',  county: 'Placer County' },
    stockton:   { name: 'Stockton',   county: 'San Joaquin County' },
    modesto:    { name: 'Modesto',    county: 'Stanislaus County' },
    oakland:    { name: 'Oakland',    county: 'Alameda County' },
    redding:    { name: 'Redding',    county: 'Shasta County' },
    chico:      { name: 'Chico',      county: 'Butte County' },
    fairfield:  { name: 'Fairfield',  county: 'Solano County' },
};

const DEFAULT_OG_IMAGE = 'https://penneylaw.com/images/favicon/Frank-Penny-Social-Preview-1200x630.png';

export default async (request, context) => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Detect content type from path
    let contentType = null;
    let slug = null;
    let citySlug = null;

    if (path.match(/^\/blog\/[a-z0-9][\w-]*\/?$/i)) {
        contentType = 'blog';
        slug = 'blog/' + path.replace(/^\/blog\//, '').replace(/\/$/, '');
    } else if (path.match(/^\/accident-news\/[a-z0-9][\w-]*\/?$/i)) {
        contentType = 'accident-news';
        slug = 'accident-news/' + path.replace(/^\/accident-news\//, '').replace(/\/$/, '');
    } else {
        const cityPostMatch = path.match(/^\/([a-z]+)\/([a-z0-9][\w-]*)\/?$/i);
        const bareCityMatch = path.match(/^\/([a-z]+)\/?$/i);
        if (cityPostMatch && CITY_FOLDERS.indexOf(cityPostMatch[1]) !== -1) {
            contentType = 'city';
            slug = cityPostMatch[1] + '/' + cityPostMatch[2];
        } else if (bareCityMatch && CITY_FOLDERS.indexOf(bareCityMatch[1]) !== -1) {
            contentType = 'bare-city';
            citySlug = bareCityMatch[1];
        }
    }

    if (!contentType) {
        return context.next();
    }

    // Bare-city listings don't fetch a story — they just set per-city meta on the city-listing.html shell.
    if (contentType === 'bare-city') {
        try {
            return await handleBareCity(citySlug, path, context);
        } catch (error) {
            console.error('Edge function bare-city error:', error);
            return await fallbackResponse(context, url);
        }
    }

    try {
        const storyResponse = await fetch(
            `${STORYBLOK_API}/stories/${slug}?token=${STORYBLOK_TOKEN}&version=published`
        );

        if (!storyResponse.ok) {
            return await fallbackResponse(context, url);
        }

        const storyData = await storyResponse.json();
        const story = storyData.story;
        const content = story.content;

        const response = await context.next();
        if (response.status >= 300 && response.status < 400) {
            return response;
        }
        const html = await response.text();

        let title, description, postUrl, excerpt;

        if (contentType === 'blog') {
            title = (content.meta_title || content.title) + ' | Frank Penney Injury Law';
            description = content.meta_description || content.excerpt || '';
            postUrl = 'https://penneylaw.com/blog/' + story.slug;
            excerpt = content.excerpt || extractTextSnippet(content.Body_Content) || description;
        } else if (contentType === 'accident-news') {
            title = content.title + ' | Frank Penney Injury Law';
            description = content.Subheadline || extractTextSnippet(content.Body_Content) || '';
            postUrl = 'https://penneylaw.com/accident-news/' + story.slug;
            excerpt = content.Subheadline || extractTextSnippet(content.Body_Content) || description;
        } else {
            // city post
            title = (content.meta_title || content.title) + ' | Frank Penney Injury Law';
            description = content.meta_description || content.excerpt || '';
            postUrl = 'https://penneylaw.com/' + story.full_slug;
            excerpt = content.excerpt || extractTextSnippet(content.Body_Content) || description;
        }

        const imageUrl = (content.og_image && content.og_image.filename)
            ? content.og_image.filename + '/m/1200x630'
            : (content.Featured_Image && content.Featured_Image.filename)
                ? content.Featured_Image.filename + '/m/1200x630'
                : DEFAULT_OG_IMAGE;

        let modifiedHtml = injectMeta(html, {
            title,
            description,
            canonical: postUrl,
            ogImage: imageUrl,
        });

        // Inject SSR H1 + excerpt for non-JS crawlers
        modifiedHtml = injectSsrPostHeader(modifiedHtml, title.replace(' | Frank Penney Injury Law', ''), excerpt);

        // Strip the defensive shell noindex on successful render
        modifiedHtml = stripShellNoindex(modifiedHtml);

        // Inject Article/NewsArticle/BlogPosting JSON-LD for richer SERP results + AI citation.
        // Shells ship with no JSON-LD, so this is the only article schema on these pages.
        const articleType = contentType === 'blog' ? 'BlogPosting'
            : contentType === 'accident-news' ? 'NewsArticle' : 'Article';
        modifiedHtml = injectArticleJsonLd(modifiedHtml, articleType, {
            headline: title.replace(' | Frank Penney Injury Law', ''),
            description,
            image: imageUrl,
            url: postUrl,
            datePublished: story.first_published_at || story.created_at || null,
            dateModified: story.published_at || story.first_published_at || story.created_at || null,
        });

        return new Response(modifiedHtml, { headers: response.headers });

    } catch (error) {
        console.error('Edge function error:', error);
        return await fallbackResponse(context, url);
    }
};

async function handleBareCity(citySlug, path, context) {
    const meta = CITY_META[citySlug];
    if (!meta) {
        return await fallbackResponse(context, new URL('https://penneylaw.com' + path));
    }

    const canonical = `https://penneylaw.com/${citySlug}/`;
    const title = `${meta.name} Personal Injury Articles & Local Resources | Frank Penney Injury Law`;
    const description = `Personal injury articles, accident news, and legal resources for ${meta.name}, CA (${meta.county}). $1B+ recovered for our clients.`;
    const h1 = `${meta.name} Legal Resources`;
    const subtitle = `Personal injury articles and accident news for ${meta.name} and ${meta.county}.`;

    const response = await context.next();
    // If Netlify returned a redirect (e.g. pretty-URL trailing-slash strip), pass it through
    // unchanged. Wrapping a 3xx body in a 200 response would produce a broken page.
    if (response.status >= 300 && response.status < 400) {
        return response;
    }
    const html = await response.text();

    let modifiedHtml = injectMeta(html, {
        title,
        description,
        canonical,
        ogImage: DEFAULT_OG_IMAGE,
    });

    // Update visible H1 + subtitle + breadcrumb (city-listing.html placeholders)
    modifiedHtml = modifiedHtml.replace(
        /<h1 class="page-title" id="city-page-title">[^<]*<\/h1>/,
        `<h1 class="page-title" id="city-page-title">${escapeHtml(h1)}</h1>`
    );
    modifiedHtml = modifiedHtml.replace(
        /<p class="page-subtitle" id="city-page-subtitle">[^<]*<\/p>/,
        `<p class="page-subtitle" id="city-page-subtitle">${escapeHtml(subtitle)}</p>`
    );
    modifiedHtml = modifiedHtml.replace(
        /<span class="breadcrumbs-current" id="city-breadcrumb"([^>]*)>[^<]*<\/span>/,
        `<span class="breadcrumbs-current" id="city-breadcrumb"$1>${escapeHtml(meta.name)}</span>`
    );

    modifiedHtml = stripShellNoindex(modifiedHtml);

    return new Response(modifiedHtml, { headers: response.headers });
}

async function fallbackResponse(context, url) {
    // EF couldn't render the page (Storyblok unavailable, story missing, etc.).
    // Set self-canonical to the requested URL and noindex so Google doesn't
    // dedupe the placeholder shell to the homepage.
    const response = await context.next();
    if (response.status >= 300 && response.status < 400) {
        return response;
    }
    const html = await response.text();
    // Force the canonical host to non-www (the site's primary domain) so a
    // direct-to-www edge invocation can't leak a www self-canonical.
    const selfCanonical = 'https://penneylaw.com' + url.pathname;

    let modifiedHtml = html;
    modifiedHtml = modifiedHtml.replace(
        /<link rel="canonical" href="[^"]*">/,
        `<link rel="canonical" href="${selfCanonical}">`
    );
    // Replace existing robots meta if present, otherwise add one before </head>
    if (/<meta name="robots" content="[^"]*">/.test(modifiedHtml)) {
        modifiedHtml = modifiedHtml.replace(
            /<meta name="robots" content="[^"]*">/,
            '<meta name="robots" content="noindex, follow">'
        );
    } else {
        modifiedHtml = modifiedHtml.replace(
            '</head>',
            '    <meta name="robots" content="noindex, follow">\n</head>'
        );
    }
    return new Response(modifiedHtml, { headers: response.headers });
}

function injectMeta(html, { title, description, canonical, ogImage }) {
    let out = html;
    out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
    out = out.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeAttr(description)}">`);
    out = out.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canonical}">`);
    out = out.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeAttr(title)}">`);
    out = out.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeAttr(description)}">`);
    out = out.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${canonical}">`);
    out = out.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${escapeAttr(ogImage)}">`);
    out = out.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${escapeAttr(title)}">`);
    out = out.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${escapeAttr(description)}">`);
    out = out.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${escapeAttr(ogImage)}">`);
    return out;
}

function injectSsrPostHeader(html, title, excerpt) {
    // Replace the SSR placeholder (added in shell templates) with the real H1 and excerpt.
    // The placeholder is sr-only, so users still see the loading skeleton.
    // JS replaces innerHTML of the parent on render, removing this once the page hydrates.
    const replacement =
        `<div class="ssr-post-header sr-only">\n` +
        `        <h1 class="ssr-post-title">${escapeHtml(title)}</h1>\n` +
        `        <p class="ssr-post-excerpt">${escapeHtml(excerpt)}</p>\n` +
        `    </div>`;
    return html.replace(
        /<div class="ssr-post-header sr-only">[\s\S]*?<\/div>/,
        replacement
    );
}

function injectArticleJsonLd(html, type, data) {
    const obj = {
        '@context': 'https://schema.org',
        '@type': type,
        headline: String(data.headline || '').substring(0, 110),
        description: data.description,
        image: data.image,
        url: data.url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': data.url },
        author: { '@type': 'Organization', name: 'Frank Penney Injury Law', url: 'https://penneylaw.com/' },
        publisher: {
            '@type': 'Organization',
            name: 'Frank Penney Injury Law',
            logo: { '@type': 'ImageObject', url: 'https://penneylaw.com/images/logos/FP-Logo-Dark-Background.png' }
        }
    };
    if (data.datePublished) obj.datePublished = data.datePublished;
    if (data.dateModified) obj.dateModified = data.dateModified;
    // Escape HTML-special chars so embedded content can't break out of the <script> element.
    const json = JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    return html.replace('</head>', `    <script type="application/ld+json">${json}</script>\n</head>`);
}

function stripShellNoindex(html) {
    // The shell templates ship with `<meta name="robots" content="noindex">` so a
    // failed/un-routed render isn't indexed. On successful injection, strip it.
    return html.replace(/\s*<meta name="robots" content="noindex">\s*\n?/, '\n');
}

function extractTextSnippet(richText) {
    if (!richText || !richText.content) return '';
    function getText(node) {
        if (!node) return '';
        if (node.type === 'text') return node.text || '';
        if (!node.content) return '';
        return node.content.map(getText).join(' ');
    }
    const text = richText.content.map(getText).join(' ').trim();
    return text.substring(0, 160) + (text.length > 160 ? '...' : '');
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const config = {
    // Only intercept trailing-slash + slug paths. Bare /sacramento (no slash) is the static
    // sacramento.html landing page — leaving it out so the edge function doesn't inject
    // city-listing meta into the location-page shell.
    path: [
        "/blog/*",
        "/accident-news/*",
        "/sacramento/*", "/roseville/*", "/stockton/*", "/modesto/*",
        "/oakland/*", "/redding/*", "/chico/*", "/fairfield/*"
    ]
};
