/**
 * Netlify Edge Function: Meta Tag Injection
 *
 * Intercepts requests to /blog/*, /accident-news/*, /{city}/*, and /{city}/
 * and injects per-page <title>, <meta description>, canonical, OG/Twitter,
 * H1 + excerpt, JSON-LD, and the related-posts links by fetching content from
 * Storyblok's CDN API.
 *
 * Responses carry a CDN cache header so the synchronous Storyblok fetch isn't
 * paid on every request (these pages measured 981ms TTFB uncached).
 *
 * A story Storyblok doesn't have is a real 404. Any other failure (5xx, 429,
 * network, bad JSON) is a 503 with Retry-After, so a Storyblok blip while
 * Googlebot crawls reads as "come back later" instead of de-indexing live posts.
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

const DEFAULT_OG_IMAGE = 'https://penneylaw.com/images/favicon/social-preview-2026-1200x630.png';

// Browser revalidates every time; the CDN absorbs the Storyblok round-trip.
// ponytail: 1h CDN TTL. A freshly published post can lag by up to this long —
// lower it, or add an on-publish cache purge, if editors need faster turnaround.
const BROWSER_CACHE = 'public, max-age=0, must-revalidate';
const CDN_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';
// Missing posts stay missing for a while; a short TTL so a just-published slug
// that was requested early isn't stuck as a 404.
const CDN_CACHE_NOT_FOUND = 'public, s-maxage=300';
const RETRY_AFTER_SECONDS = '120';

/**
 * Build the response with CDN caching.
 *
 * `response.headers` from context.next() may be immutable, hence the copy. Status
 * is passed through explicitly — omitting it defaults to 200, which is the bug
 * class the 3xx guards upstream exist to avoid.
 */
function cachedResponse(html, response, cdnCache) {
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', BROWSER_CACHE);
    headers.set('Netlify-CDN-Cache-Control', cdnCache);
    return new Response(html, { status: response.status, headers });
}

// The shells ship a related-posts <section hidden> that js/blog.js fills in on
// hydration. Filling it at the edge instead puts the links in the HTML, which is
// what a crawler sees: before this, every CMS post had exactly one incoming
// internal link (its entry in the static archive block) and 59 URLs were reported
// as "only one internal link". The client-side version also bailed out entirely
// for any post with no categories set.
const RELATED_COUNT = 3;
const RELATED_TARGETS = {
    'blog': { section: 'blog-related-posts', grid: 'blog-related-grid' },
    'accident-news': { section: 'accident-news-related-posts', grid: 'accident-news-related-grid' },
    'city': { section: 'city-related-posts', grid: 'city-related-grid' },
};

/**
 * Newest siblings from a Storyblok folder, excluding the post being rendered.
 * Returns [] on any failure — related links are a nice-to-have and must never
 * take the page down.
 */
async function fetchRelated(folder, excludeSlug) {
    try {
        const res = await fetch(
            `${STORYBLOK_API}/stories?token=${STORYBLOK_TOKEN}&version=published`
            + `&starts_with=${encodeURIComponent(folder)}/`
            + `&excluding_slugs=${encodeURIComponent(excludeSlug)}`
            + `&per_page=${RELATED_COUNT}&sort_by=first_published_at:desc`
        );
        if (!res.ok) return [];
        const data = await res.json();
        return (data.stories || [])
            .map((s) => ({
                url: '/' + s.full_slug,
                title: (s.content && s.content.title) || s.name || '',
                excerpt: (s.content && (s.content.excerpt || s.content.Subheadline)) || '',
            }))
            .filter((s) => s.title && s.url !== '/' + excludeSlug);
    } catch (error) {
        console.error('Related posts fetch failed:', error);
        return [];
    }
}

/**
 * Unhide the shell's related-posts section and fill its grid with real anchors.
 * js/blog.js later overwrites the same grid with its richer cards, so this is a
 * pre-hydration stand-in, not a competing block. Card classes match renderBlogCard
 * in js/blog.js so the unhydrated view is styled.
 */
export function injectRelatedPosts(html, contentType, related) {
    const target = RELATED_TARGETS[contentType];
    if (!target || !related.length) return html;

    const cards = related.map((r) =>
        `<a href="${escapeAttr(r.url)}" class="card blog-card" aria-label="Read: ${escapeAttr(r.title)}">` +
            '<div class="blog-card-body">' +
                `<h3 class="blog-card-title">${escapeHtml(r.title)}</h3>` +
                (r.excerpt ? `<p class="blog-card-excerpt">${escapeHtml(r.excerpt)}</p>` : '') +
                '<span class="blog-card-read-more">Read Article</span>' +
            '</div>' +
        '</a>'
    ).join('');

    let out = html.replace(
        new RegExp(`(<section id="${target.section}"[^>]*?) hidden>`),
        (m, attrs) => `${attrs}>`
    );
    // Replacer function, not a string: the cards carry escaped CMS text where a
    // literal "$&" would otherwise re-inject the matched tag (see sub() below).
    out = out.replace(
        new RegExp(`<div id="${target.grid}"([^>]*)></div>`),
        (m, attrs) => `<div id="${target.grid}"${attrs}>${cards}</div>`
    );
    return out;
}

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

    // One URL per post: /blog/slug/ → /blog/slug (the canonical form).
    if (path.endsWith('/')) {
        const target = new URL(url);
        target.pathname = path.replace(/\/+$/, '');
        return Response.redirect(target.toString(), 301);
    }

    // The related-posts folder is the first path segment for every content type:
    // 'blog', 'accident-news', or the city name.
    const relatedFolder = slug.split('/')[0];

    try {
        // Concurrent: the related list is independent of the story body, so it costs
        // no extra serial latency on top of the story fetch.
        const [storyResponse, relatedFromFolder] = await Promise.all([
            fetch(`${STORYBLOK_API}/stories/${slug}?token=${STORYBLOK_TOKEN}&version=published`),
            fetchRelated(relatedFolder, slug),
        ]);

        const outcome = statusForStoryblok(storyResponse.status);
        if (outcome === 404) {
            return await notFoundResponse(url);
        }
        if (outcome === 503) {
            console.error(`Storyblok ${slug} returned ${storyResponse.status}`);
            return await unavailableResponse(context);
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

        // City folders hold as few as one post each, so top up thin folders from
        // /blog rather than shipping a one-link section.
        let related = relatedFromFolder;
        if (related.length < RELATED_COUNT && relatedFolder !== 'blog') {
            const extra = await fetchRelated('blog', slug);
            related = related
                .concat(extra.filter((e) => !related.some((r) => r.url === e.url)))
                .slice(0, RELATED_COUNT);
        }
        modifiedHtml = injectRelatedPosts(modifiedHtml, contentType, related);

        return cachedResponse(modifiedHtml, response, CDN_CACHE);

    } catch (error) {
        console.error('Edge function error:', error);
        return await unavailableResponse(context);
    }
};

/**
 * Storyblok has no such story: serve the site's 404 page with a real 404 status
 * (previously a 200 + noindex shell — a soft 404).
 */
async function notFoundResponse(url) {
    const page = await fetch(new URL('/404.html', url));
    const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
    headers.set('Cache-Control', BROWSER_CACHE);
    headers.set('Netlify-CDN-Cache-Control', CDN_CACHE_NOT_FOUND);
    return new Response(await page.text(), { status: 404, headers });
}

/**
 * Storyblok failed (5xx, 429, network, bad JSON): 503 + Retry-After, never cached,
 * never noindex. The shell still ships its own noindex, which a 503 doesn't expose.
 */
async function unavailableResponse(context) {
    const response = await context.next();
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('Netlify-CDN-Cache-Control', 'no-store');
    headers.set('Retry-After', RETRY_AFTER_SECONDS);
    return new Response(await response.text(), { status: 503, headers });
}

/**
 * Exported for scripts/test-edge-meta.mjs: what a Storyblok story response maps to.
 */
export function statusForStoryblok(status) {
    if (status === 404) return 404;
    return status >= 200 && status < 300 ? 200 : 503;
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
            logo: { '@type': 'ImageObject', url: 'https://penneylaw.com/images/logos/frank-penney-logo-pink-2026.png' }
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
    // Required for Netlify to honour Netlify-CDN-Cache-Control on edge responses;
    // without it every post paid the ~1s Storyblok round-trip on every request.
    cache: "manual",
    // The single declaration of these paths — netlify.toml no longer repeats them
    // (a toml declaration would take precedence and drop `cache`).
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
