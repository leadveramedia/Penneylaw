/**
 * Netlify Edge Function: Meta Tag Injection
 *
 * Intercepts requests to /blog/*, /accident-news/*, and /{city}/* and renders the
 * post server-side from Storyblok's CDN API: the full article (H1, byline, body),
 * breadcrumbs, related posts, per-page <title>/meta/canonical/OG, and JSON-LD.
 * The post shells contain no article of their own and the browser no longer
 * renders posts, so this is the only place a post's content is built.
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
// `durable` shares one cached copy across Netlify's edge nodes instead of one per node.
const CDN_CACHE = 'public, durable, s-maxage=3600, stale-while-revalidate=86400';
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

// The shells ship an empty related-posts <section hidden>; filling it here puts the
// links in the HTML a crawler sees. Before this, every CMS post had exactly one
// incoming internal link (its entry in the static archive block).
const RELATED_COUNT = 3;
// ponytail: candidates are the folder's newest RELATED_POOL posts; widen it (or page
// through) if older posts should be reachable from related links too.
const RELATED_POOL = 25;
const RELATED_TARGETS = {
    'blog': { section: 'blog-related-posts', grid: 'blog-related-grid' },
    'accident-news': { section: 'accident-news-related-posts', grid: 'accident-news-related-grid' },
    'city': { section: 'city-related-posts', grid: 'city-related-grid' },
};

/**
 * Candidate related posts: the folder's newest RELATED_POOL siblings, bodies excluded.
 * Returns [] on any failure — related links are a nice-to-have and must never
 * take the page down.
 */
async function fetchRelated(folder, excludeSlug) {
    try {
        const res = await fetch(
            `${STORYBLOK_API}/stories?token=${STORYBLOK_TOKEN}&version=published`
            + `&starts_with=${encodeURIComponent(folder)}/`
            + `&excluding_slugs=${encodeURIComponent(excludeSlug)}`
            + `&excluding_fields=Body_Content`
            + `&per_page=${RELATED_POOL}&sort_by=first_published_at:desc`
        );
        if (!res.ok) return [];
        const data = await res.json();
        return (data.stories || [])
            .map((s) => ({
                url: '/' + s.full_slug,
                title: (s.content && s.content.title) || s.name || '',
                excerpt: (s.content && (s.content.excerpt || s.content.Subheadline)) || '',
                categories: (s.content && s.content.categories) || [],
            }))
            .filter((s) => s.title && s.url !== '/' + excludeSlug);
    } catch (error) {
        console.error('Related posts fetch failed:', error);
        return [];
    }
}

/**
 * Pick related posts for one post: same-category candidates first, then the rest,
 * each starting from a per-post rotation of the list. It used to be "the 3 newest",
 * so every post in a folder linked to the same three.
 */
export function pickRelated(candidates, { seed = '', categories = [], count = RELATED_COUNT } = {}) {
    if (!candidates.length) return [];
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const offset = h % candidates.length;
    const rotated = candidates.slice(offset).concat(candidates.slice(0, offset));
    const same = rotated.filter((c) => c.categories && c.categories.some((cat) => categories.includes(cat)));
    const rest = rotated.filter((c) => !same.includes(c));
    return same.concat(rest).slice(0, count);
}

/**
 * Unhide the shell's related-posts section and fill its grid with real anchors.
 * Card classes match renderBlogCard in js/blog.js so they share its styles.
 */
export function injectRelatedPosts(html, contentType, related) {
    const target = RELATED_TARGETS[contentType];
    if (!target || !related.length) return html;

    const cards = related.map((r) =>
        `<a href="${escapeAttr(r.url)}" class="card blog-card">` +
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

const SITE = 'https://penneylaw.com';
const FIRM = { '@type': 'LegalService', '@id': SITE + '/#firm', name: 'Frank Penney Injury Law', url: SITE + '/' };

// Storyblok's `author` option values → byline. Bio URLs let the visible byline and the
// JSON-LD author point at the attorney's page. "Guest Author" has no bio.
const AUTHORS = {
    'Frank Penney': { name: 'Frank D. Penney', image: '/images/attorneys/frank-penney.webp', title: 'Founding Attorney', url: '/frank-d-penney/' },
    'Jacob Stoeltzing': { name: 'Jacob Stoeltzing', image: '/images/attorneys/jacob-stoeltzing.webp', title: 'Attorney', url: '/jacob-stoeltzing/' },
    'Joshua Boyce': { name: 'Joshua Boyce', image: '/images/attorneys/joshua-boyce.webp', title: 'Attorney', url: '/joshua-boyce/' },
    'Liam Conley': { name: 'Liam Conley', image: '/images/attorneys/liam-conley.webp', title: 'Attorney', url: '/liam-conley/' },
    'Marissa Hauck': { name: 'Marissa Hauck', image: '/images/attorneys/marissa-hauck.webp', title: 'Attorney', url: '/marissa-hauck/' },
    'Mark McCauley': { name: 'Mark McCauley', image: '/images/attorneys/mark-mccauley.webp', title: 'Attorney', url: '/mark-mccauley/' },
    'Guest Author': { name: 'Guest Author', image: '/images/logos/frank-penney-logo-pink-2026.webp', title: '', url: null },
};
const REVIEWER = AUTHORS['Frank Penney'];

export function postAuthor(content) {
    const raw = Array.isArray(content.author) ? content.author[0] : content.author;
    return AUTHORS[raw] || AUTHORS['Frank Penney'];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// Storyblok dates look like "2026-02-02 00:00" or ISO. Read the calendar date from the
// string itself: new Date() on the edge's UTC clock could shift it by a day.
function isoDate(value) {
    const m = /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''));
    return m ? m[0] : '';
}

export function formatDate(value) {
    const iso = isoDate(value);
    if (!iso) return '';
    const [y, mo, d] = iso.split('-');
    return `${MONTHS[Number(mo) - 1]} ${Number(d)}, ${y}`;
}

function plainText(node) {
    if (!node) return '';
    if (node.type === 'text') return node.text || '';
    return (node.content || []).map(plainText).join(' ');
}

function readMinutes(richText) {
    const words = plainText(richText).split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
}

function safeHref(href) {
    return /^\s*(javascript|data|vbscript):/i.test(href) ? '#' : href;
}

// Storyblok rich text → HTML. Moved here from js/blog.js, city.js and accident-news.js
// (three byte-identical copies), with attribute-safe escaping: the browser versions
// escaped text but not quotes, and wrote `target` unescaped.
export function renderRichText(doc) {
    if (!doc || !doc.content) return '';
    return doc.content.map(renderNode).join('');
}

function renderChildren(node) {
    return (node.content || []).map(renderNode).join('');
}

function renderNode(node) {
    if (!node) return '';
    const a = node.attrs || {};
    switch (node.type) {
        case 'paragraph': {
            const inner = renderChildren(node);
            return inner ? `<p>${inner}</p>` : '';
        }
        case 'heading': {
            // The page H1 is the post title, so body headings start at h2.
            const level = Math.min(Math.max(Number(a.level) || 2, 2), 6);
            return `<h${level}>${renderChildren(node)}</h${level}>`;
        }
        case 'bullet_list': return `<ul>${renderChildren(node)}</ul>`;
        case 'ordered_list': return `<ol>${renderChildren(node)}</ol>`;
        case 'list_item': return `<li>${renderChildren(node)}</li>`;
        case 'blockquote': return `<blockquote>${renderChildren(node)}</blockquote>`;
        case 'code_block': return `<pre><code>${renderChildren(node)}</code></pre>`;
        case 'horizontal_rule': return '<hr>';
        case 'hard_break': return '<br>';
        case 'image':
            return '<figure class="blog-content-image">' +
                `<img src="${escapeAttr(a.src || '')}" alt="${escapeAttr(a.alt || '')}" loading="lazy" decoding="async">` +
                (a.alt ? `<figcaption>${escapeHtml(a.alt)}</figcaption>` : '') +
                '</figure>';
        case 'text': {
            let text = escapeHtml(node.text || '');
            for (const mark of node.marks || []) {
                const m = mark.attrs || {};
                if (mark.type === 'bold') text = `<strong>${text}</strong>`;
                else if (mark.type === 'italic') text = `<em>${text}</em>`;
                else if (mark.type === 'underline') text = `<u>${text}</u>`;
                else if (mark.type === 'strike') text = `<s>${text}</s>`;
                else if (mark.type === 'code') text = `<code>${text}</code>`;
                else if (mark.type === 'link') {
                    const blank = m.target === '_blank' ? ' target="_blank" rel="noopener noreferrer"' : '';
                    text = `<a href="${escapeAttr(safeHref(m.href || '#'))}"${blank}>${text}</a>`;
                }
            }
            return text;
        }
        default: return renderChildren(node);
    }
}

function cityName(city) {
    return city.charAt(0).toUpperCase() + city.slice(1);
}

/**
 * The full <article> body for a post — same markup the browser used to build, so
 * css/blog.css styles it unchanged. News posts carry no author or taxonomy.
 */
export function renderPostArticle(contentType, story) {
    const content = story.content || {};
    const isNews = contentType === 'accident-news';
    const title = content.title || story.name || '';
    const postUrl = `${SITE}/${story.full_slug}`;
    const date = content.Date || content.publish_date || story.first_published_at || '';
    const author = isNews ? null : postAuthor(content);
    const categories = isNews ? [] : (content.categories || []).filter((c) => c && c.trim());
    const tags = isNews ? [] : (content.tags || story.tag_list || []);
    const image = content.Featured_Image && content.Featured_Image.filename;
    const shareUrl = encodeURIComponent(postUrl);
    const shareTitle = encodeURIComponent(title);

    const authorHtml = !author ? '' :
        '<div class="blog-post-author">' +
            `<img src="${escapeAttr(author.image)}" alt="" class="blog-author-avatar" width="44" height="44" loading="lazy">` +
            '<div class="blog-author-info">' +
                (author.url
                    ? `<a href="${author.url}" class="blog-author-name">${escapeHtml(author.name)}</a>`
                    : `<span class="blog-author-name">${escapeHtml(author.name)}</span>`) +
                (author.title ? `<span class="blog-author-title">${escapeHtml(author.title)}</span>` : '') +
            '</div>' +
        '</div>';

    return '<div class="container blog-post-layout">' +
        '<div class="blog-post-main">' +
            '<header class="blog-post-header">' +
                (categories.length ? '<div class="blog-post-categories">' +
                    categories.map((c) => `<span class="blog-post-category">${escapeHtml(c)}</span>`).join('') + '</div>' : '') +
                `<h1 class="blog-post-title">${escapeHtml(title)}</h1>` +
                '<div class="blog-post-meta">' +
                    authorHtml +
                    '<div class="blog-post-meta-details">' +
                        (isoDate(date) ? `<time datetime="${isoDate(date)}">${formatDate(date)}</time>` : '') +
                        `<span class="blog-post-read-time">${readMinutes(content.Body_Content)} min read</span>` +
                    '</div>' +
                '</div>' +
                // Frank reviews every post; skip the line on his own (it would repeat the byline).
                (author === REVIEWER ? '' :
                    `<p class="blog-post-review">Legal review by <a href="${REVIEWER.url}">${REVIEWER.name}</a>, ${REVIEWER.title.toLowerCase()}</p>`) +
            '</header>' +
            (image ? '<figure class="blog-post-featured-image">' +
                `<img src="${escapeAttr(image)}/m/1200x630" srcset="${escapeAttr(image)}/m/600x315 600w, ${escapeAttr(image)}/m/1200x630 1200w" ` +
                `sizes="(max-width: 768px) 100vw, 800px" alt="${escapeAttr(content.featured_image_alt || title)}" width="1200" height="630" fetchpriority="high">` +
                '</figure>' : '') +
            `<div class="blog-post-body">${renderRichText(content.Body_Content)}</div>` +
            (tags.length ? '<div class="blog-post-tags"><span class="blog-tags-label">Tags:</span>' +
                tags.map((t) => `<a href="/blog?tag=${encodeURIComponent(t)}" class="blog-post-tag">${escapeHtml(t)}</a>`).join('') + '</div>' : '') +
            '<div class="blog-share">' +
                '<span class="blog-share-label">Share this article:</span>' +
                '<div class="blog-share-buttons">' +
                    `<a href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" target="_blank" rel="noopener noreferrer" class="blog-share-btn blog-share-facebook" aria-label="Share on Facebook">Facebook</a>` +
                    `<a href="https://twitter.com/intent/tweet?url=${shareUrl}&amp;text=${shareTitle}" target="_blank" rel="noopener noreferrer" class="blog-share-btn blog-share-twitter" aria-label="Share on X (Twitter)">X</a>` +
                    `<a href="https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}" target="_blank" rel="noopener noreferrer" class="blog-share-btn blog-share-linkedin" aria-label="Share on LinkedIn">LinkedIn</a>` +
                    `<a href="mailto:?subject=${shareTitle}&amp;body=${shareUrl}" class="blog-share-btn blog-share-email" aria-label="Share via email">Email</a>` +
                '</div>' +
            '</div>' +
        '</div>' +
        '<aside class="blog-post-sidebar" aria-label="Article sidebar">' +
            '<div class="blog-sidebar-cta">' +
                '<h2>Injured in an Accident?</h2>' +
                '<p>Get a free consultation from our experienced attorneys.</p>' +
                '<a href="/contact" class="btn btn-primary btn-full">Bank on Frank</a>' +
                '<a href="tel:8888880566" class="btn btn-outline btn-full">Call (888) 888-0566</a>' +
            '</div>' +
        '</aside>' +
    '</div>';
}

const POST_CONTAINERS = {
    'blog': 'blog-post-content',
    'accident-news': 'accident-news-post-content',
    'city': 'city-post-content',
};

/** Replace the shell's placeholder <article> contents with the rendered post. */
export function injectPost(html, contentType, articleHtml) {
    const id = POST_CONTAINERS[contentType];
    return html.replace(
        new RegExp(`(<article id="${id}"[^>]*>)[\\s\\S]*?(</article>)`),
        (m, open, close) => open + articleHtml + close
    );
}

/** Real breadcrumb names (the shells ship placeholders) and, for city posts, the city link. */
export function injectBreadcrumbs(html, contentType, story, title) {
    let out = html.replace(
        /(<span class="breadcrumbs-current" id="(?:breadcrumb-post-title|city-post-breadcrumb-title)" itemprop="name">)[^<]*(<\/span>)/,
        (m, open, close) => open + escapeHtml(title) + close
    );
    if (contentType === 'city') {
        const city = story.full_slug.split('/')[0];
        const name = escapeHtml(cityName(city));
        out = out.replace(
            /<a href="[^"]*" class="breadcrumbs-link" id="city-post-breadcrumb-city" itemprop="item"><span itemprop="name">[^<]*<\/span><\/a>/,
            () => `<a href="/${escapeAttr(city)}" class="breadcrumbs-link" id="city-post-breadcrumb-city" itemprop="item"><span itemprop="name">${name}</span></a>`
        );
        out = out.replace(
            /(<h2 class="section-title" id="city-related-title">)[^<]*(<\/h2>)/,
            (m, open, close) => `${open}More ${name} Articles${close}`
        );
    }
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
        let headline, description, postUrl;

        if (contentType === 'blog') {
            headline = content.meta_title || content.title;
            description = content.meta_description || content.excerpt || extractTextSnippet(content.Body_Content) || '';
            postUrl = 'https://penneylaw.com/blog/' + story.slug;
        } else if (contentType === 'accident-news') {
            headline = content.title;
            description = content.Subheadline || extractTextSnippet(content.Body_Content) || '';
            postUrl = 'https://penneylaw.com/accident-news/' + story.slug;
        } else {
            // city post
            headline = content.meta_title || content.title;
            description = content.meta_description || content.excerpt || extractTextSnippet(content.Body_Content) || '';
            postUrl = 'https://penneylaw.com/' + story.full_slug;
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

        modifiedHtml = injectPost(modifiedHtml, contentType, renderPostArticle(contentType, story));
        modifiedHtml = injectBreadcrumbs(modifiedHtml, contentType, story, content.title || headline);

        // Strip the defensive shell noindex on successful render
        modifiedHtml = stripShellNoindex(modifiedHtml);

        // Inject Article/NewsArticle/BlogPosting JSON-LD for richer SERP results + AI citation.
        // Shells ship with no JSON-LD, so this is the only article schema on these pages.
        const articleType = contentType === 'blog' ? 'BlogPosting'
            : contentType === 'accident-news' ? 'NewsArticle' : 'Article';
        const author = contentType === 'accident-news' ? null : postAuthor(content);
        modifiedHtml = injectArticleJsonLd(modifiedHtml, articleType, {
            headline,
            description,
            image: imageUrl,
            url: postUrl,
            author: author && author.url
                ? { '@type': 'Person', '@id': SITE + author.url + '#person', name: author.name, url: SITE + author.url, worksFor: { '@id': FIRM['@id'] } }
                : FIRM,
            datePublished: story.first_published_at || story.created_at || null,
            dateModified: story.published_at || story.first_published_at || story.created_at || null,
        });

        // City folders hold as few as one post each, so top up thin folders from
        // /blog rather than shipping a one-link section.
        let related = pickRelated(relatedFromFolder, { seed: slug, categories: content.categories || [] });
        if (related.length < RELATED_COUNT && relatedFolder !== 'blog') {
            const extra = pickRelated(await fetchRelated('blog', slug), { seed: slug });
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

function injectArticleJsonLd(html, type, data) {
    const obj = {
        '@context': 'https://schema.org',
        '@type': type,
        headline: String(data.headline || '').substring(0, 110),
        image: data.image,
        url: data.url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': data.url },
        author: data.author,
        publisher: {
            ...FIRM,
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
    const text = plainText(richText).replace(/\s+/g, ' ').trim();
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
