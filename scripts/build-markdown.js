#!/usr/bin/env node
/**
 * Markdown copies of the indexable static pages, for AI agents.
 *
 *   npm run build:markdown     (runs at the end of `npm run build`)
 *
 * Each page's <main> becomes /md/<page>.md, and the page links to it with
 * <link rel="alternate" type="text/markdown">. The link tags are committed (inserted
 * idempotently); the .md files are only written on Netlify builds (or with --write),
 * so local builds don't litter the tree. /md/* is served as text/markdown with
 * noindex (netlify.toml) so the copies never compete with the HTML in search.
 *
 * ponytail: static pages only, and no `Accept: text/markdown` negotiation. Edge-
 * rendered posts would need the edge function to emit Markdown too; add that if
 * agent traffic to /md/ shows it's worth it.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://penneylaw.com';
const OUT = path.join(ROOT, 'md');
const WRITE = Boolean(process.env.NETLIFY) || process.argv.includes('--write');
const SKIP_DIRS = new Set(['node_modules', 'components', 'lp', 'lp-source', 'md', '.git', '.netlify', '.playwright-mcp']);

function pages(dir = ROOT) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : pages(full);
        return entry.name.endsWith('.html') ? [full] : [];
    });
}

/** /car-accidents → /md/car-accidents.md, / → /md/index.md, /frank-d-penney/ → /md/frank-d-penney.md */
function mdPath(canonicalPath) {
    const p = canonicalPath.replace(/^\/|\/$/g, '');
    return `/md/${p || 'index'}.md`;
}

function inline($, el) {
    return $(el).contents().map((i, node) => {
        if (node.type === 'text') return node.data.replace(/\s+/g, ' ');
        if (node.type !== 'tag') return '';
        const tag = node.name;
        const text = inline($, node);
        if (tag === 'a') {
            const href = $(node).attr('href') || '';
            if (!text.trim() || href.startsWith('#') || href.startsWith('javascript:')) return text;
            return `[${text.trim()}](${href.startsWith('/') ? SITE + href : href})`;
        }
        if (tag === 'strong' || tag === 'b') return text.trim() ? `**${text.trim()}**` : '';
        if (tag === 'em' || tag === 'i') return text.trim() ? `*${text.trim()}*` : '';
        if (tag === 'br') return '\n';
        if (tag === 'img' || tag === 'svg' || tag === 'picture') return '';
        return text;
    }).get().join('');
}

function blocks($, el, out) {
    $(el).children().each((i, node) => {
        const tag = node.name;
        const text = () => inline($, node).replace(/[ \t]+/g, ' ').trim();
        if (/^h[1-6]$/.test(tag)) {
            const t = text();
            if (t) out.push('#'.repeat(Number(tag[1])) + ' ' + t);
        } else if (tag === 'p' || tag === 'blockquote' || tag === 'summary') {
            const t = text();
            if (t) out.push(tag === 'blockquote' ? '> ' + t : t);
        } else if (tag === 'ul' || tag === 'ol') {
            const items = $(node).children('li').map((n, li) => {
                const t = inline($, li).replace(/\s+/g, ' ').trim();
                return t ? (tag === 'ol' ? `${n + 1}. ` : '- ') + t : '';
            }).get().filter(Boolean);
            if (items.length) out.push(items.join('\n'));
        } else if (tag === 'table') {
            const rows = $(node).find('tr').map((n, tr) =>
                '| ' + $(tr).children('th,td').map((m, c) => inline($, c).replace(/\s+/g, ' ').trim()).get().join(' | ') + ' |'
            ).get();
            if (rows.length) out.push(rows.join('\n'));
        } else {
            blocks($, node, out);
        }
    });
}

function toMarkdown(html, canonical) {
    const $ = cheerio.load(html);
    const main = $('main').first();
    // Navigation, forms, scripts and duplicated/hidden UI aren't page content.
    main.find('script, style, noscript, form, nav, iframe, [hidden], [aria-hidden="true"], .sr-only, .skip-link').remove();
    const out = [];
    blocks($, main, out);
    const title = $('title').text().trim();
    const desc = $('meta[name="description"]').attr('content') || '';
    return `---\ntitle: ${JSON.stringify(title)}\nsource: ${canonical}\n---\n\n` +
        (desc ? `> ${desc}\n\n` : '') + out.join('\n\n') + '\n';
}

let linked = 0;
let written = 0;
for (const file of pages()) {
    const html = fs.readFileSync(file, 'utf8');
    const canonical = (/<link rel="canonical" href="([^"]+)">/.exec(html) || [])[1];
    if (!canonical || !canonical.startsWith(SITE)) continue;
    if (/<meta name="robots" content="[^"]*noindex/.test(html)) continue;

    const md = mdPath(canonical.slice(SITE.length) || '/');
    const tag = `<link rel="alternate" type="text/markdown" href="${md}">`;
    if (!html.includes(tag)) {
        // Strip a stale tag (canonical changed), then add right after the canonical.
        const cleaned = html.replace(/<link rel="alternate" type="text\/markdown" href="[^"]*">/g, '');
        fs.writeFileSync(file, cleaned.replace(/(<link rel="canonical" href="[^"]+">)/, `$1${tag}`));
        linked++;
    }
    if (WRITE) {
        const dest = path.join(ROOT, md);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, toMarkdown(html, canonical));
        written++;
    }
}
console.log(`markdown: ${linked} page(s) linked, ${written} file(s) written${WRITE ? '' : ' (pass --write or run on Netlify to write files)'}`);
