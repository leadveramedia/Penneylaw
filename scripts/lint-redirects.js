#!/usr/bin/env node
// Static lint for netlify.toml redirects.
// Catches redirects whose target isn't a real page (in sitemap.xml or a static file) —
// they land on a 404 or a soft 404 and throw away whatever the old URL had earned.
// Also catches the redirect-loop pattern caused by Netlify's pretty-URL aliasing:
//   [[redirects]] from = "/foo" to = "/foo/" force = true
// With force=true, the rule matches BOTH /foo and /foo/ (aliasing), so /foo/
// redirects to /foo/, which re-matches → infinite 301 chain.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const NETLIFY_TOML = path.join(REPO_ROOT, 'netlify.toml');
const SITEMAP = path.join(REPO_ROOT, 'sitemap.xml');

function parseRedirects(content) {
    const lines = content.split('\n');
    const redirects = [];
    let current = null;

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const raw = lines[i];
        const trimmed = raw.trim();

        if (trimmed === '[[redirects]]') {
            if (current) redirects.push(current);
            current = { startLine: lineNum };
            continue;
        }

        if (trimmed.startsWith('[') && trimmed !== '[[redirects]]') {
            if (current) {
                redirects.push(current);
                current = null;
            }
            continue;
        }

        if (!current) continue;
        if (trimmed === '' || trimmed.startsWith('#')) continue;

        const m = trimmed.match(/^(\w+)\s*=\s*(.+?)(\s*#.*)?$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
            val = val.slice(1, -1);
        } else if (val === 'true' || val === 'false') {
            val = val === 'true';
        } else if (/^-?\d+$/.test(val)) {
            val = parseInt(val, 10);
        }
        current[key] = val;
    }
    if (current) redirects.push(current);
    return redirects;
}

function normalizeSlash(p) {
    if (!p) return '';
    if (p === '/') return '/';
    return p.replace(/\/+$/, '');
}

function knownUrls() {
    if (!fs.existsSync(SITEMAP)) return new Set();
    const xml = fs.readFileSync(SITEMAP, 'utf-8');
    return new Set([...xml.matchAll(/<loc>https:\/\/penneylaw\.com([^<]*)<\/loc>/g)].map((m) => normalizeSlash(m[1]) || '/'));
}

function targetExists(to, known) {
    if (/^https?:/.test(to) || /[*:]/.test(to)) return true; // external, splat or placeholder
    const p = to.split(/[?#]/)[0];
    if (known.has(normalizeSlash(p) || '/')) return true;
    const rel = p.replace(/^\//, '');
    return [rel + '.html', path.join(rel, 'index.html'), rel]
        .some((f) => f && fs.existsSync(path.join(REPO_ROOT, f)) && fs.statSync(path.join(REPO_ROOT, f)).isFile());
}

function main() {
    if (!fs.existsSync(NETLIFY_TOML)) {
        console.error(`lint-redirects: ${NETLIFY_TOML} not found`);
        process.exit(2);
    }

    const content = fs.readFileSync(NETLIFY_TOML, 'utf-8');
    const redirects = parseRedirects(content);

    const errors = [];
    const warnings = [];
    const seenFrom = new Map();
    const known = knownUrls();

    for (const r of redirects) {
        if (!r.from || !r.to) continue;

        const status = r.status || 301;
        if (status >= 300 && status < 400 && !targetExists(r.to, known)) {
            errors.push({
                line: r.startLine,
                rule: r,
                message: `Target "${r.to}" is not in sitemap.xml and no file serves it, so this redirect lands on a 404 or soft 404. Point it at a live page.`,
            });
        }

        const fromN = normalizeSlash(r.from);
        const toN = normalizeSlash(r.to);

        // Self-loop check (slash aliasing).
        // Skip wildcard rules — splat semantics differ, and most are intentional.
        if (!r.from.includes('*') && fromN === toN) {
            const severity = r.force === true ? 'error' : 'warning';
            const msg = {
                line: r.startLine,
                rule: r,
                message: r.force === true
                    ? `Self-loop with force=true. Netlify pretty-URL aliasing matches both "${r.from}" and "${r.to}", so this redirects to itself → infinite 301 chain. Delete this rule; the static file at the destination is served automatically.`
                    : `Inert self-loop. "${r.from}" and "${r.to}" are slash-equivalent. The rule does nothing useful — delete it.`,
            };
            (severity === 'error' ? errors : warnings).push(msg);
        }

        // Duplicate `from` — first-match wins, later rules are dead.
        if (seenFrom.has(r.from)) {
            warnings.push({
                line: r.startLine,
                rule: r,
                message: `Duplicate "from = ${r.from}" (first declared at line ${seenFrom.get(r.from).startLine}). First match wins; this rule is dead.`,
            });
        } else {
            seenFrom.set(r.from, r);
        }
    }

    if (errors.length === 0 && warnings.length === 0) {
        console.log(`lint-redirects: OK (${redirects.length} rules scanned)`);
        process.exit(0);
    }

    if (errors.length > 0) {
        console.error(`\nlint-redirects: ${errors.length} error(s)\n`);
        for (const e of errors) {
            console.error(`  netlify.toml:${e.line}  ${e.message}`);
            console.error(`    from  = "${e.rule.from}"`);
            console.error(`    to    = "${e.rule.to}"`);
            console.error(`    force = ${e.rule.force}\n`);
        }
    }
    if (warnings.length > 0) {
        console.warn(`lint-redirects: ${warnings.length} warning(s)\n`);
        for (const w of warnings) {
            console.warn(`  netlify.toml:${w.line}  ${w.message}`);
            console.warn(`    from  = "${w.rule.from}"`);
            console.warn(`    to    = "${w.rule.to}"\n`);
        }
    }

    process.exit(errors.length > 0 ? 1 : 0);
}

main();
