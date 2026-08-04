#!/usr/bin/env node
/**
 * Extract the subset of css/style.css that the landing pages actually use, and
 * write it to lp-source/critical.css for build-lps.js to inline.
 *
 *   npm run build:lp-css     (runs before build:lps in `npm run build`)
 *
 * Why this exists
 * ---------------
 * LPs inline their own CSS but also used to render-block on css/style.min.css
 * (58KB) for the header, buttons, forms, awards carousel and consent banner.
 * Paid traffic is first-visit traffic, so that request is never cached and sits
 * on the critical path. Inlining a hand-copied subset would work once and then
 * rot the moment anyone edited style.css — generating it on every build means
 * the LPs can never fall out of sync.
 *
 * How it decides what to keep
 * ---------------------------
 * Tokens (classes/ids) are collected from lp-source/template.html, NOT from the
 * generated lp/*.html — otherwise this would depend on its own consumer's output.
 * A rule is kept when every class and id in its selector is either present in the
 * template or listed in RUNTIME_TOKENS below.
 *
 * RUNTIME_TOKENS is the load-bearing part: classes that JS adds at runtime, and
 * elements JS creates from scratch, never appear in the static HTML. Dropping
 * their rules would leave validation errors unstyled, the mobile nav stuck
 * off-screen and the consent banner invisible — all without any build error.
 * Re-check it against `grep -rhoE "classList\.(add|remove|toggle)\('[^']+'\)" js/`
 * whenever the JS changes.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS_IN = path.join(ROOT, 'css/style.css');
const TEMPLATE = path.join(ROOT, 'lp-source/template.html');
const CSS_OUT = path.join(ROOT, 'lp-source/critical.css');

// Classes toggled by JS, plus classes on elements JS builds itself (the consent
// banner is created entirely in js/consent.js and appears in no HTML file).
const RUNTIME_TOKENS = new Set([
    'active', 'components-loaded', 'components-loading', 'consent-banner--visible',
    'current-menu-item', 'error', 'has-error', 'hidden-by-cta', 'menu-open',
    'modal-open', 'open', 'revealed', 'scrolled', 'translating', 'valid',
    'consent-banner', 'consent-banner__inner', 'consent-banner__text',
    'consent-banner__heading', 'consent-banner__body', 'consent-banner__link',
    'consent-banner__actions', 'consent-banner__btn', 'consent-banner__status',
    'consent-banner__undo'
]);

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Split a stylesheet (or the body of an at-rule) into top-level blocks. */
function splitBlocks(css) {
    const blocks = [];
    let depth = 0, start = 0, inStr = null;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (inStr) { if (c === inStr && css[i - 1] !== '\\') inStr = null; continue; }
        if (c === '"' || c === "'") { inStr = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) {
                const raw = css.slice(start, i + 1);
                const brace = raw.indexOf('{');
                blocks.push({
                    prelude: raw.slice(0, brace).trim(),
                    body: raw.slice(brace + 1, -1),
                    raw
                });
                start = i + 1;
            }
        }
    }
    return blocks;
}

/** Does every class/id in this selector list exist on the LPs? */
function selectorMatches(selectorList, tokens) {
    return selectorList.split(',').some(part => {
        const bare = part
            .replace(/\[[^\]]*\]/g, '')            // attribute selectors
            .replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, ''); // pseudo classes/elements
        const classes = [...bare.matchAll(/\.([A-Za-z0-9_-]+)/g)].map(m => m[1]);
        const ids = [...bare.matchAll(/#([A-Za-z0-9_-]+)/g)].map(m => m[1]);
        // Tag-only / universal / pseudo-only selectors are cheap and often resets.
        if (!classes.length && !ids.length) return true;
        return classes.every(c => tokens.has(c)) && ids.every(id => tokens.has(id));
    });
}

function collectTokens(html) {
    const tokens = new Set(RUNTIME_TOKENS);
    for (const m of html.matchAll(/class\s*=\s*"([^"]*)"/g)) {
        m[1].split(/\s+/).forEach(t => { if (t && !t.includes('{{')) tokens.add(t); });
    }
    for (const m of html.matchAll(/id\s*=\s*"([^"]*)"/g)) {
        const id = m[1].trim();
        if (id && !id.includes('{{')) tokens.add(id);
    }
    return tokens;
}

function animationNames(css) {
    const names = new Set();
    for (const m of css.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
        m[1].split(',').forEach(part => {
            part.trim().split(/\s+/).forEach(tok => {
                if (/^[A-Za-z_][\w-]*$/.test(tok) &&
                    !['none','normal','infinite','linear','ease','ease-in','ease-out',
                      'ease-in-out','alternate','reverse','both','forwards','backwards',
                      'running','paused','alternate-reverse','initial','inherit'].includes(tok) &&
                    !/^\d/.test(tok)) names.add(tok);
            });
        });
    }
    return names;
}

/** Filter a list of blocks, recursing into conditional at-rules. */
function filterBlocks(blocks, tokens) {
    const out = [];
    for (const b of blocks) {
        const p = b.prelude;
        if (/^@(media|supports)/i.test(p)) {
            const inner = filterBlocks(splitBlocks(b.body), tokens);
            if (inner.length) out.push(`${p} {\n${inner.join('\n')}\n}`);
        } else if (/^@(keyframes|-webkit-keyframes|font-face|page)/i.test(p)) {
            out.push(b.raw);                       // resolved in a later pass
        } else if (/^:root/.test(p) || selectorMatches(p, tokens)) {
            out.push(`${p} {${b.body}}`);
        }
    }
    return out;
}

const css = stripComments(fs.readFileSync(CSS_IN, 'utf8'));
const tokens = collectTokens(fs.readFileSync(TEMPLATE, 'utf8'));

let kept = filterBlocks(splitBlocks(css), tokens).join('\n');

// Drop @keyframes nobody references, then re-check (a kept keyframes block can
// itself be referenced only from a rule that survived).
const used = animationNames(kept);
kept = kept.replace(/@(?:-webkit-)?keyframes\s+([A-Za-z_][\w-]*)\s*\{[\s\S]*?\n\}/g,
    (m, name) => (used.has(name) ? m : ''));

const out = `/* GENERATED by scripts/build-lp-critical-css.js — do not edit.
   Subset of css/style.css used by lp-source/template.html.
   Regenerate with: npm run build:lp-css */
${kept.replace(/\n{3,}/g, '\n\n').trim()}
`;
fs.writeFileSync(CSS_OUT, out);

const inKb = (fs.statSync(CSS_IN).size / 1024).toFixed(1);
const outKb = (Buffer.byteLength(out) / 1024).toFixed(1);
console.log(`critical CSS: ${inKb}KB -> ${outKb}KB  (${path.relative(ROOT, CSS_OUT)})`);
console.log(`  tokens matched: ${tokens.size}, keyframes kept: ${[...used].join(', ') || 'none'}`);
