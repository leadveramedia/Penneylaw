/**
 * Regression check for netlify/edge-functions/blog-meta.js meta injection.
 * Run: node scripts/test-edge-meta.mjs
 *
 * Covers the two bugs fixed in Jul 2026:
 *  1. Blog/city posts emitted <meta name="description" content=""> because the
 *     fallback chain had no Body_Content snippet, and injectMeta overwrote the
 *     shell's generic description with the empty string.
 *  2. String.replace() interprets $&, $`, $', $$ in a replacement string, so an
 *     escaped description containing "$<" broke out of the attribute.
 */
import assert from 'node:assert/strict';
import {
    injectMeta, escapeAttr, extractTextSnippet, injectRelatedPosts, statusForStoryblok,
    renderRichText, renderPostArticle, pickRelated, formatDate, injectPost, injectBreadcrumbs,
} from '../netlify/edge-functions/blog-meta.js';

const rich = (s) => ({ content: [{ content: [{ type: 'text', text: s }] }] });

const SHELL =
    '<title>Shell</title>' +
    '<meta name="description" content="GENERIC SHELL DESCRIPTION">' +
    '<link rel="canonical" href="https://penneylaw.com/">' +
    '<meta property="og:title" content="A">' +
    '<meta property="og:description" content="B">' +
    '<meta property="og:url" content="C">' +
    '<meta property="og:image" content="D">' +
    '<meta name="twitter:title" content="E">' +
    '<meta name="twitter:description" content="F">' +
    '<meta name="twitter:image" content="G">';

const base = { title: 'T', canonical: 'https://penneylaw.com/blog/x', ogImage: 'https://penneylaw.com/i.png' };
const descOf = (html) => (html.match(/<meta name="description" content="([^"]*)">/) || [])[1];
const countOf = (html, needle) => html.split(needle).length - 1;

// 1. A real description is injected into all three description tags.
{
    const out = injectMeta(SHELL, { ...base, description: 'Potholes can cause serious crashes.' });
    for (const tag of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
        const m = out.match(new RegExp('<meta ' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' content="([^"]*)">'));
        assert.equal(m[1], 'Potholes can cause serious crashes.', `${tag} not injected`);
    }
}

// 2. An empty description must NOT blank the shell's generic fallback.
for (const empty of ['', undefined, null]) {
    const out = injectMeta(SHELL, { ...base, description: empty });
    assert.equal(descOf(out), 'GENERIC SHELL DESCRIPTION', `empty description (${empty}) blanked the shell fallback`);
    assert.ok(!out.includes('content=""'), 'emitted an empty content attribute');
}

// 3. $-sequences in body text stay literal instead of re-injecting the matched tag.
for (const d of ['damages under $<50,000 apply', 'he paid $"cash" up front', 'pre $` post', "x $' y", 'a $$ b']) {
    const out = injectMeta(SHELL, { ...base, description: d });
    assert.equal(countOf(out, '<meta name="description"'), 1, `$-breakout duplicated the tag for: ${d}`);
    assert.equal(descOf(out), escapeAttr(d), `$-sequence mangled for: ${d}`);
}

// 4. Special characters are escaped so they cannot break out of the attribute.
{
    const out = injectMeta(SHELL, { ...base, description: 'He said "hi" & <script>alert(1)</script>' });
    assert.equal(descOf(out), 'He said &quot;hi&quot; &amp; &lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(countOf(out, '<script'), 0, 'unescaped <script> reached the output');
}

// 5. extractTextSnippet: safe on junk input, and truncates on a word boundary.
for (const junk of [undefined, null, 'a string', [], {}, { content: [] }, { content: [null] }, { content: [{ type: 'text' }] }]) {
    assert.equal(extractTextSnippet(junk), '', `expected '' for ${JSON.stringify(junk)}`);
}
assert.equal(extractTextSnippet(rich('   ')), '', 'whitespace-only body should be falsy so the shell fallback wins');
assert.equal(extractTextSnippet(rich('Short body.')), 'Short body.');
// Runs of whitespace/newlines collapse to single spaces (rich-text nodes join with ' ').
assert.equal(extractTextSnippet(rich('a  b\n\nc\td')), 'a b c d');
{
    const source = ('alpha bravo charlie delta echo foxtrot golf hotel '.repeat(6)).trim();
    const long = extractTextSnippet(rich(source));
    const body = long.slice(0, -3);
    assert.ok(long.length <= 163, `snippet too long: ${long.length}`);
    assert.ok(long.endsWith('...'), 'long snippet should end with an ellipsis');
    assert.ok(/\S$/.test(body), 'should not leave a dangling space before the ellipsis');
    assert.ok(source.startsWith(body), 'snippet should be a prefix of the source text');
    // Word boundary: the source character right after the cut must be a space.
    assert.equal(source[body.length], ' ', `truncated mid-word: ...${body.slice(-12)}`);
}
// A single 200-char token has no space to break on — must still truncate, not return ''.
assert.equal(extractTextSnippet(rich('x'.repeat(200))), 'x'.repeat(157) + '...');

// 6. injectRelatedPosts: unhides the shell section and puts real crawlable
//    anchors in the grid. This is the fix for the 59 "only one internal link"
//    URLs, so it has to survive shell edits.
{
    const RELATED_SHELL =
        '<section id="blog-related-posts" class="section section-lg bg-light" hidden>' +
        '<div id="blog-related-grid" class="grid grid-3 blog-grid"></div>' +
        '</section>';

    const out = injectRelatedPosts(RELATED_SHELL, 'blog', [
        { url: '/blog/one', title: 'First Post', excerpt: 'Ex one.' },
        { url: '/blog/two', title: 'Second Post', excerpt: '' },
    ]);
    assert.equal(countOf(out, ' hidden>'), 0, 'related section must be unhidden');
    assert.equal(countOf(out, 'href="/blog/one"'), 1);
    assert.equal(countOf(out, 'href="/blog/two"'), 1);
    assert.ok(out.includes('>First Post</h3>'), 'anchor text must be the post title');
    assert.equal(countOf(out, 'blog-card-excerpt'), 1, 'empty excerpt should emit no <p>');

    // No related posts -> shell untouched, section stays hidden.
    assert.equal(injectRelatedPosts(RELATED_SHELL, 'blog', []), RELATED_SHELL);
    // Unknown content type is a no-op rather than a crash.
    assert.equal(injectRelatedPosts(RELATED_SHELL, 'nope', [{ url: '/x', title: 'X' }]), RELATED_SHELL);

    // Same $& hazard as injectMeta: CMS titles are escaped, and "$&" in the
    // replacement text must not re-inject the matched tag.
    const tricky = injectRelatedPosts(RELATED_SHELL, 'blog', [
        { url: '/blog/x', title: 'Damages under $<25,000 & "more"', excerpt: '' },
    ]);
    assert.equal(countOf(tricky, '<div id="blog-related-grid"'), 1, '$& re-injected the matched tag');
    // Text content escapes & < > only; the aria-label attribute also escapes the quotes.
    assert.equal(countOf(tricky, '>Damages under $&lt;25,000 &amp; "more"</h3>'), 1);
    assert.equal(countOf(tricky, 'aria-label='), 0, 'cards are named by their visible title, not an aria-label');
}

// A missing story is a real 404; any other Storyblok failure must be a 503, never a
// 200 + noindex — that de-indexed live posts whenever Storyblok blipped mid-crawl.
assert.equal(statusForStoryblok(200), 200);
assert.equal(statusForStoryblok(404), 404);
assert.equal(statusForStoryblok(429), 503);
assert.equal(statusForStoryblok(500), 503);
assert.equal(statusForStoryblok(401), 503);

// Post body rendering (moved from the browser). Quotes must not break out of
// attributes, script URLs are neutralised, and body headings never duplicate the H1.
{
    const doc = { type: 'doc', content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Intro' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: '/x" onmouseover="alert(1)', target: '_blank' } }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
        { type: 'image', attrs: { src: 'https://a.storyblok.com/i.png"x', alt: 'A "quoted" alt' } },
        { type: 'paragraph', content: [] },
    ] };
    const html = renderRichText(doc);
    assert.equal(countOf(html, '<h1'), 0, 'body h1 is clamped to h2');
    assert.equal(countOf(html, '<h2>Intro</h2>'), 1);
    assert.equal(countOf(html, 'onmouseover="'), 0, 'quote in href broke out of the attribute');
    assert.equal(countOf(html, 'href="/x&quot; onmouseover=&quot;alert(1)" target="_blank" rel="noopener noreferrer"'), 1);
    assert.equal(countOf(html, 'javascript:'), 0, 'javascript: URL survived');
    assert.equal(countOf(html, 'src="https://a.storyblok.com/i.png&quot;x"'), 1);
    assert.equal(countOf(html, '<p></p>'), 0, 'empty paragraphs are dropped');
}

// Dates come straight from the string — the edge's UTC clock must not shift them.
assert.equal(formatDate('2026-02-02 00:00'), 'February 2, 2026');
assert.equal(formatDate('2025-12-31T23:30:00.000Z'), 'December 31, 2025');
assert.equal(formatDate(''), '');

// Full article: visible H1, author linked to the bio, review byline, no author on news.
{
    const story = { full_slug: 'blog/x', name: 'X', first_published_at: '2026-01-05T10:00:00.000Z',
        content: { title: 'A & B', author: ['Marissa Hauck'], categories: ['Car Accidents', ''], Body_Content: { type: 'doc', content: [] } } };
    const blog = renderPostArticle('blog', story);
    assert.equal(countOf(blog, '<h1 class="blog-post-title">A &amp; B</h1>'), 1);
    assert.equal(countOf(blog, '<a href="/marissa-hauck/" class="blog-author-name">Marissa Hauck</a>'), 1);
    assert.equal(countOf(blog, 'Legal review by <a href="/frank-d-penney/">Frank D. Penney</a>'), 1);
    assert.equal(countOf(blog, '<time datetime="2026-01-05">January 5, 2026</time>'), 1);
    assert.equal(countOf(blog, 'blog-post-category'), 1, 'blank categories are skipped');
    const news = renderPostArticle('accident-news', { ...story, full_slug: 'accident-news/x' });
    assert.equal(countOf(news, 'blog-post-author'), 0, 'news posts carry no author block');
    assert.equal(countOf(news, 'Legal review by'), 1);
    // Unknown author values fall back to Frank rather than printing a raw ID.
    const unknown = renderPostArticle('blog', { ...story, content: { ...story.content, author: ['abc-123'] } });
    assert.equal(countOf(unknown, '>Frank D. Penney</a><span class="blog-author-title">'), 1);
    assert.equal(countOf(unknown, 'Legal review by'), 0, "no review line under Frank's own byline");
}

// Article + breadcrumb injection into the shells.
{
    const shell = '<nav><span class="breadcrumbs-current" id="city-post-breadcrumb-title" itemprop="name">Article</span>' +
        '<a href="#" class="breadcrumbs-link" id="city-post-breadcrumb-city" itemprop="item"><span itemprop="name">Article</span></a></nav>' +
        '<article id="city-post-content" class="blog-post"><p>placeholder</p></article>' +
        '<h2 class="section-title" id="city-related-title">More Articles</h2>';
    let out = injectPost(shell, 'city', '<h1>Real $& post</h1>');
    out = injectBreadcrumbs(out, 'city', { full_slug: 'sacramento/x' }, 'Crash on I-80 <update>');
    assert.equal(countOf(out, 'placeholder'), 0);
    assert.equal(countOf(out, '<h1>Real $& post</h1>'), 1, 'replacement must be literal');
    assert.equal(countOf(out, '>Crash on I-80 &lt;update&gt;</span>'), 1);
    assert.equal(countOf(out, '<a href="/sacramento" class="breadcrumbs-link" id="city-post-breadcrumb-city" itemprop="item"><span itemprop="name">Sacramento</span></a>'), 1);
    assert.equal(countOf(out, '>More Sacramento Articles</h2>'), 1);
}

// Related posts: same category first, and different posts get different picks
// (it used to be "the 3 newest" for every post in a folder).
{
    const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => ({ url: '/blog/' + k, title: k, categories: k === 'e' ? ['Dog Bites'] : [] }));
    const one = pickRelated(pool, { seed: 'blog/post-one', categories: ['Dog Bites'] });
    assert.equal(one.length, 3);
    assert.equal(one[0].url, '/blog/e', 'same-category post comes first');
    assert.deepEqual(pickRelated(pool, { seed: 'blog/post-one' }), pickRelated(pool, { seed: 'blog/post-one' }), 'stable per post');
    const firsts = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((seed) => pickRelated(pool, { seed })[0].url));
    assert.ok(firsts.size > 1, 'every post got the same related links');
    assert.deepEqual(pickRelated([], { seed: 'x' }), []);
}

console.log('test-edge-meta: all assertions passed');
