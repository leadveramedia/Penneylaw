#!/usr/bin/env node
// Static lint for netlify.toml redirects.
// Catches the redirect-loop pattern caused by Netlify's pretty-URL aliasing:
//   [[redirects]] from = "/foo" to = "/foo/" force = true
// With force=true, the rule matches BOTH /foo and /foo/ (aliasing), so /foo/
// redirects to /foo/, which re-matches → infinite 301 chain.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const NETLIFY_TOML = path.join(REPO_ROOT, 'netlify.toml');

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

    for (const r of redirects) {
        if (!r.from || !r.to) continue;

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
