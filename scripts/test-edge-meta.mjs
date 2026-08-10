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
import { injectMeta, escapeAttr, extractTextSnippet, injectRelatedPosts } from '../netlify/edge-functions/blog-meta.js';

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
    assert.equal(countOf(tricky, 'aria-label="Read: Damages under $&lt;25,000 &amp; &quot;more&quot;"'), 1);
}

console.log('test-edge-meta: all assertions passed');
