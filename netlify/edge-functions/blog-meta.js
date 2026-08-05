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

const BRAND_SUFFIX = ' | Frank Penney Injury Law';
const TITLE_MAX = 60;

/**
 * Append the brand suffix only when the result still fits a SERP title.
 *
 * Storyblok headlines run 75-90 chars on their own, so unconditionally adding
 * 26 more guaranteed the brand name was exactly the part Google truncated —
 * 57 of 60 blog titles measured over 60 chars, the longest at 117. Dropping the
 * suffix on long headlines spends the budget on words that actually get read.
 */
function withBrand(headline) {
    const base = String(headline || '').trim();
    // Guard the empty case: without it a story missing its title yields a
    // <title> of " | Frank Penney Injury Law", leading separator and all.
    if (!base) return 'Frank Penney Injury Law';
    return base.length + BRAND_SUFFIX.length <= TITLE_MAX ? base + BRAND_SUFFIX : base;
}

// NOTE: there is deliberately no bare-city handler. /{city}/ pretty-URL-strips to
// /{city} because {city}.html exists, so the old city-listing.html hub could never
// render. City articles now surface on the static location pages instead.

const DEFAULT_OG_IMAGE = 'https://penneylaw.com/images/favicon/Frank-Penny-Social-Preview-1200x630.png';

export default async (request, context) => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Detect content type from path
    let contentType = null;
    let slug = null;

    if (path.match(/^\/blog\/[a-z0-9][\w-]*\/?$/i)) {
        contentType = 'blog';
        slug = 'blog/' + path.replace(/^\/blog\//, '').replace(/\/$/, '');
    } else if (path.match(/^\/accident-news\/[a-z0-9][\w-]*\/?$/i)) {
        contentType = 'accident-news';
        slug = 'accident-news/' + path.replace(/^\/accident-news\//, '').replace(/\/$/, '');
    } else {
        const cityPostMatch = path.match(/^\/([a-z]+)\/([a-z0-9][\w-]*)\/?$/i);
        if (cityPostMatch && CITY_FOLDERS.indexOf(cityPostMatch[1]) !== -1) {
            contentType = 'city';
            slug = cityPostMatch[1] + '/' + cityPostMatch[2];
        }
    }

    if (!contentType) {
        return context.next();
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

        // Track the bare headline separately from the <title>. It feeds the SSR H1 and
        // the Article JSON-LD, which used to recover it by string-stripping the suffix
        // off the title — that breaks now the suffix is conditional.
        let headline, description, postUrl, excerpt;

        if (contentType === 'blog') {
            headline = content.meta_title || content.title;
            description = content.meta_description || content.excerpt || extractTextSnippet(content.Body_Content) || '';
            postUrl = 'https://penneylaw.com/blog/' + story.slug;
            excerpt = content.excerpt || extractTextSnippet(content.Body_Content) || description;
        } else if (contentType === 'accident-news') {
            headline = content.title;
            description = content.Subheadline || extractTextSnippet(content.Body_Content) || '';
            postUrl = 'https://penneylaw.com/accident-news/' + story.slug;
            excerpt = content.Subheadline || extractTextSnippet(content.Body_Content) || description;
        } else {
            // city post
            headline = content.meta_title || content.title;
            description = content.meta_description || content.excerpt || extractTextSnippet(content.Body_Content) || '';
            postUrl = 'https://penneylaw.com/' + story.full_slug;
            excerpt = content.excerpt || extractTextSnippet(content.Body_Content) || description;
        }

        const title = withBrand(headline);

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
        modifiedHtml = injectSsrPostHeader(modifiedHtml, headline, excerpt);

        // Strip the defensive shell noindex on successful render
        modifiedHtml = stripShellNoindex(modifiedHtml);

        // Inject Article/NewsArticle/BlogPosting JSON-LD for richer SERP results + AI citation.
        // Shells ship with no JSON-LD, so this is the only article schema on these pages.
        const articleType = contentType === 'blog' ? 'BlogPosting'
            : contentType === 'accident-news' ? 'NewsArticle' : 'Article';
        modifiedHtml = injectArticleJsonLd(modifiedHtml, articleType, {
            headline,
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
    // sub() matters here: url.pathname is request-controlled and keeps "$" and "&"
    // literal, so a request for /blog/$&x would otherwise re-inject the matched tag.
    modifiedHtml = sub(
        modifiedHtml,
        /<link rel="canonical" href="[^"]*">/,
        `<link rel="canonical" href="${escapeAttr(selfCanonical)}">`
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

// Exported for scripts/test-edge-meta.mjs. Netlify only uses the default export + config.
export function injectMeta(html, { title, description, canonical, ogImage }) {
    let out = html;
    out = sub(out, /<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
    // Only overwrite descriptions when we actually have one — the shells ship with a
    // generic firm description, and blanking it is worse than leaving the fallback.
    if (description) {
        out = sub(out, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeAttr(description)}">`);
    }
    out = sub(out, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escapeAttr(canonical)}">`);
    out = sub(out, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeAttr(title)}">`);
    if (description) {
        out = sub(out, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeAttr(description)}">`);
    }
    out = sub(out, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escapeAttr(canonical)}">`);
    out = sub(out, /<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${escapeAttr(ogImage)}">`);
    out = sub(out, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${escapeAttr(title)}">`);
    if (description) {
        out = sub(out, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${escapeAttr(description)}">`);
    }
    out = sub(out, /<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${escapeAttr(ogImage)}">`);
    return out;
}

// String.replace() interprets $&, $`, $', $$ in a replacement STRING. Our replacements
// carry escaped CMS body text, where escapeAttr turns < " & into &-entities — so a "$<"
// in a post ("damages under $<25,000") becomes "$&lt;" and the $& re-injects the matched
// tag, breaking out of the attribute. Passing a function makes the replacement literal.
function sub(html, pattern, replacement) {
    return html.replace(pattern, () => replacement);
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
    return sub(html, /<div class="ssr-post-header sr-only">[\s\S]*?<\/div>/, replacement);
}

function injectArticleJsonLd(html, type, data) {
    const obj = {
        '@context': 'https://schema.org',
        '@type': type,
        headline: String(data.headline || '').substring(0, 110),
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
    if (data.description) obj.description = data.description;
    if (data.datePublished) obj.datePublished = data.datePublished;
    if (data.dateModified) obj.dateModified = data.dateModified;
    // Escape HTML-special chars so embedded content can't break out of the <script> element.
    const json = JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    return sub(html, '</head>', `    <script type="application/ld+json">${json}</script>\n</head>`);
}

function stripShellNoindex(html) {
    // The shell templates ship with `<meta name="robots" content="noindex">` so a
    // failed/un-routed render isn't indexed. On successful injection, strip it.
    return html.replace(/\s*<meta name="robots" content="noindex">\s*\n?/, '\n');
}

export function extractTextSnippet(richText) {
    if (!richText || !richText.content) return '';
    function getText(node) {
        if (!node) return '';
        if (node.type === 'text') return node.text || '';
        if (!node.content) return '';
        return node.content.map(getText).join(' ');
    }
    const text = richText.content.map(getText).join(' ').replace(/\s+/g, ' ').trim();
    if (text.length <= 160) return text;
    // Trim back to a word boundary so SERP snippets don't end mid-word. Falls back to a
    // hard cut when the first 157 chars contain no space (single very long token).
    const cut = text.slice(0, 157);
    return (/\s/.test(cut) ? cut.replace(/\s+\S*$/, '') : cut) + '...';
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const config = {
    // Only intercept trailing-slash + slug paths. Bare /sacramento (no slash) is the static
    // sacramento.html landing page and must be left out — the edge function has no business
    // rewriting meta on a hand-authored location page.
    path: [
        "/blog/*",
        "/accident-news/*",
        "/sacramento/*", "/roseville/*", "/stockton/*", "/modesto/*",
        "/oakland/*", "/redding/*", "/chico/*", "/fairfield/*"
    ]
};
