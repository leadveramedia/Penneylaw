#!/usr/bin/env node
/**
 * GTM container auditor — zero dependencies, zero auth.
 *
 * The COMPILED container is public, so we can audit the live published version
 * without the Tag Manager API or a service account:
 *   https://www.googletagmanager.com/gtm.js?id=GTM-PC9XN9DP
 *
 * What this cannot see (it needs the API): tag/trigger NAMES, notes, folders,
 * version history, and uncommitted workspace edits. Everything checked below is
 * derivable from the compiled resource block.
 *
 * Usage:
 *   node scripts/gtm-audit.mjs                 # audit the live container
 *   node scripts/gtm-audit.mjs --file <path>    # audit a saved snapshot
 *   node scripts/gtm-audit.mjs --json          # machine-readable
 *
 * Exits 1 if any HIGH/CRITICAL finding is present (usable as a pre-deploy gate).
 * Findings the team has consciously accepted are listed in ACCEPTED below and
 * reported as ACCEPTED rather than failing the run.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONTAINER_ID = 'GTM-PC9XN9DP';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Events the site actually pushes. Sources:
//   js/ad-tracking.js  -> phone_click, form_submit
//   thank-you.html     -> form_conversion
const SITE_EVENTS = ['phone_click', 'form_submit', 'form_conversion'];

// GTM-generated events. A trigger on one of these is never "dead".
const GTM_EVENTS = [
    'gtm.js', 'gtm.dom', 'gtm.load', 'gtm.init', 'gtm.init_consent',
    'gtm.click', 'gtm.linkClick', 'gtm.formSubmit', 'gtm.historyChange',
    'gtm.scrollDepth', 'gtm.timer', 'gtm.video', 'gtm.elementVisibility',
    'gtm.triggerGroup',
];

// Consciously accepted after review — reported, never fatal. See the plan file.
const ACCEPTED = new Set([
    'callrail-clarity-ungated', // owner's decision: no consent gating
    'orphan-variables',         // harmless; deleting 17 has risk and no gain
    'hardcoded-ids',            // cosmetic
]);

const TAG_LABELS = {
    __googtag: 'Google Tag', __awct: 'Google Ads Conversion',
    __gclidw: 'Conversion Linker', __awud: 'Ads User-Provided Data',
    __html: 'Custom HTML', __lcl: 'Link Click Listener',
    __fsl: 'Form Submit Listener', __img: 'Custom Image',
};

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const fileIdx = args.indexOf('--file');

// ---------------------------------------------------------------- load + parse

async function loadContainer() {
    if (fileIdx !== -1) {
        const p = args[fileIdx + 1];
        if (!p) throw new Error('--file needs a path');
        return readFileSync(p, 'utf8');
    }
    const res = await fetch(`https://www.googletagmanager.com/gtm.js?id=${CONTAINER_ID}`);
    if (!res.ok) throw new Error(`fetch gtm.js failed: HTTP ${res.status}`);
    return res.text();
}

/** Extract the `"resource":{...}` object by brace-matching (it is valid JSON). */
function extractResource(src) {
    const at = src.indexOf('"resource"');
    if (at === -1) throw new Error('no "resource" block found — container format changed?');
    const start = src.indexOf('{', at);
    let depth = 0;
    for (let i = start; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) {
            return JSON.parse(src.slice(start, i + 1));
        }
    }
    throw new Error('unbalanced braces in resource block');
}

/** Every macro index referenced anywhere in tags / predicates / other macros. */
function referencedMacros(resource) {
    const used = new Set();
    const walk = (node) => {
        if (Array.isArray(node)) {
            if (node[0] === 'macro' && typeof node[1] === 'number') used.add(node[1]);
            node.forEach(walk);
        } else if (node && typeof node === 'object') {
            Object.values(node).forEach(walk);
        }
    };
    walk(resource.tags);
    walk(resource.predicates);
    walk(resource.macros);
    return used;
}

/** tag index -> list of rule indexes that fire it */
function tagFiringRules(resource) {
    const map = new Map();
    (resource.rules || []).forEach((rule, ri) => {
        for (const clause of rule) {
            if (Array.isArray(clause) && clause[0] === 'add') {
                for (const t of clause.slice(1)) {
                    if (!map.has(t)) map.set(t, []);
                    map.get(t).push(ri);
                }
            }
        }
    });
    return map;
}

/** Conditions (if/unless predicate indexes) for a rule. */
function ruleConditions(rule) {
    const out = { if: [], unless: [] };
    for (const clause of rule) {
        if (Array.isArray(clause) && (clause[0] === 'if' || clause[0] === 'unless')) {
            out[clause[0]].push(...clause.slice(1));
        }
    }
    return out;
}

/** Collect every string value under vtp_* keys of a tag/macro. */
function stringValues(obj) {
    const out = [];
    const walk = (n) => {
        if (typeof n === 'string') out.push(n);
        else if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === 'object') Object.values(n).forEach(walk);
    };
    for (const [k, v] of Object.entries(obj)) if (k.startsWith('vtp_')) walk(v);
    return out;
}

// ------------------------------------------------------------------------ CSP

function parseCsp() {
    let toml;
    try {
        toml = readFileSync(join(REPO_ROOT, 'netlify.toml'), 'utf8');
    } catch {
        return null;
    }
    const m = toml.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
    if (!m) return null;
    const directives = {};
    for (const part of m[1].split(';')) {
        const bits = part.trim().split(/\s+/).filter(Boolean);
        if (bits.length) directives[bits[0]] = bits.slice(1);
    }
    return directives;
}

/** Does `host` satisfy any entry in a directive's source list (incl. wildcards)? */
function cspAllows(sources, host) {
    if (!sources) return false;
    return sources.some((src) => {
        const s = src.replace(/^https?:\/\//, '').replace(/\/$/, '');
        if (s === host) return true;
        if (s.startsWith('*.')) {
            const suffix = s.slice(1); // ".example.com"
            return host.endsWith(suffix) || host === s.slice(2);
        }
        return false;
    });
}

// -------------------------------------------------------------------- checks

function audit(resource, csp) {
    const findings = [];
    const add = (severity, id, message, detail) =>
        findings.push({ severity, id, message, detail });

    const tags = resource.tags || [];
    const macros = resource.macros || [];
    const predicates = resource.predicates || [];
    const rules = resource.rules || [];
    const firing = tagFiringRules(resource);
    const usedMacros = referencedMacros(resource);
    const label = (i) => `tag${i} (${TAG_LABELS[tags[i].function] || tags[i].function})`;

    // 1. Orphan / paused tags
    tags.forEach((t, i) => {
        if (!firing.has(i)) add('HIGH', 'orphan-tag', `${label(i)} is fired by no trigger — it never runs`);
        if (t.vtp_firingStatus === 'paused') add('MEDIUM', 'paused-tag', `${label(i)} is paused`);
    });

    // 2. Dead events, both directions
    const listened = new Set();
    predicates.forEach((p) => {
        const isEventMacro =
            Array.isArray(p.arg0) && p.arg0[0] === 'macro' && macros[p.arg0[1]]?.function === '__e';
        if (isEventMacro && typeof p.arg1 === 'string') listened.add(p.arg1);
    });
    for (const ev of listened) {
        if (!GTM_EVENTS.includes(ev) && !SITE_EVENTS.includes(ev)) {
            add('HIGH', 'trigger-on-unpushed-event',
                `a trigger listens for event "${ev}" which the site never pushes`);
        }
    }
    for (const ev of SITE_EVENTS) {
        if (!listened.has(ev)) {
            add('MEDIUM', 'dead-event',
                `site pushes "${ev}" but no trigger listens for it — the event is wasted`);
        }
    }

    // 3. Orphan variables
    const orphans = macros.map((m, i) => [i, m]).filter(([i]) => !usedMacros.has(i));
    if (orphans.length) {
        add('LOW', 'orphan-variables',
            `${orphans.length} of ${macros.length} variables are referenced by nothing`,
            orphans.map(([i, m]) => `macro${i} ${m.vtp_name || m.function}`).join(', '));
    }

    // 4. Conversion tags on URL-substring triggers (fires on refresh/back-nav/direct)
    tags.forEach((t, i) => {
        if (t.function !== '__awct') return;
        for (const ri of firing.get(i) || []) {
            const { if: ifs } = ruleConditions(rules[ri]);
            for (const pi of ifs) {
                const p = predicates[pi];
                const onUrl =
                    Array.isArray(p?.arg0) && p.arg0[0] === 'macro' && macros[p.arg0[1]]?.function === '__u';
                if (onUrl && p.function === '_cn') {
                    add('HIGH', 'conversion-on-url-substring',
                        `${label(i)} fires on Page URL contains "${p.arg1}" — re-fires on refresh, back-nav and direct hits`,
                        `label=${t.vtp_conversionLabel}`);
                }
            }
        }
    });

    // 5. Duplicate consent-default source inside the container.
    //    The site already issues one in js/component-loader.js before gtm.js loads.
    tags.forEach((t, i) => {
        if (t.vtp_command !== 'default') return;
        const denied = ['functionality_storage', 'security_storage']
            .filter((k) => t[`vtp_${k}`] === 'denied');
        add('HIGH', 'duplicate-consent-default',
            `${label(i)} issues a second "consent default" — the site already sets one before gtm.js loads`,
            `wait_for_update=${t.vtp_wait_for_update}` +
            (denied.length ? `; denies ${denied.join(' + ')} which the site grants` : ''));
    });

    // 6. Enhanced Conversions wiring
    const awec = macros.map((m, i) => [i, m]).filter(([, m]) => m.function === '__awec');
    const autoModes = awec.filter(([, m]) => m.vtp_mode === 'AUTO');
    const codeModes = awec.filter(([, m]) => m.vtp_mode === 'CODE');
    const awudTags = tags.map((t, i) => [i, t]).filter(([, t]) => t.function === '__awud');
    for (const [ti, t] of awudTags) {
        const ref = Array.isArray(t.vtp_userDataVariable) ? t.vtp_userDataVariable[1] : null;
        const mode = ref != null ? macros[ref]?.vtp_mode : '(none)';
        if (mode === 'AUTO') {
            add('HIGH', 'enhanced-conversions-auto',
                `${label(ti)} uses AUTO mode (macro${ref}) — it scrapes the DOM for email/phone, so a site-wide phone number can be sent as the lead's own`);
        }
    }
    for (const [mi] of codeModes) {
        if (!usedMacros.has(mi)) {
            add('HIGH', 'enhanced-conversions-orphaned',
                `macro${mi} is a correctly-wired CODE-mode user-data variable but is attached to nothing — EC data is being ignored`);
        }
    }
    if (autoModes.length && codeModes.length) {
        add('MEDIUM', 'enhanced-conversions-conflict',
            `both AUTO (${autoModes.map(([i]) => 'macro' + i).join(', ')}) and CODE (${codeModes.map(([i]) => 'macro' + i).join(', ')}) user-data variables exist`);
    }
    tags.forEach((t, i) => {
        if (t.function === '__awct' && t.vtp_enableEnhancedConversionsCheckbox === false) {
            add('MEDIUM', 'enhanced-conversions-off',
                `${label(i)} has Enhanced Conversions disabled`, `label=${t.vtp_conversionLabel}`);
        }
    });

    // 7. Conversion Linker hygiene
    tags.forEach((t, i) => {
        if (t.function !== '__gclidw') return;
        if (t.vtp_enableUrlPassthrough === false) {
            add('CRITICAL', 'no-url-passthrough',
                `${label(i)} has url_passthrough disabled — gclid is lost whenever ad_storage is denied, which is the default state, breaking offline conversion import`);
        }
        const raw = typeof t.vtp_linkerDomains === 'string' ? t.vtp_linkerDomains : '';
        const doms = raw.split(/[,\s]+/).filter(Boolean);
        const junk = doms.filter((d) => d.includes('--') || d.includes('.netlify.app'));
        if (junk.length) {
            add('MEDIUM', 'linker-domain-junk',
                `${junk.length} of ${doms.length} linker domains are ephemeral deploy-preview hostnames`,
                `keep: ${doms.filter((d) => !junk.includes(d)).join(', ')}`);
        }
    });

    // 8. Hosts referenced by tags vs the CSP allowlist
    if (csp) {
        const hosts = new Map(); // host -> tag indexes
        tags.forEach((t, i) => {
            for (const s of stringValues(t)) {
                for (const m of s.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
                    if (!hosts.has(m[1])) hosts.set(m[1], []);
                    if (!hosts.get(m[1]).includes(i)) hosts.get(m[1]).push(i);
                }
            }
        });
        // Checked against ALL fetch directives, not just script-src. Pixel endpoints
        // legitimately appear only in img-src/connect-src (e.g. www.facebook.com for the Meta
        // pixel), and flagging those would make this gate cry wolf. The tradeoff: a script
        // loaded from an image-only host slips through. Worth it — a noisy gate gets ignored.
        const FETCH_DIRECTIVES = ['script-src', 'img-src', 'connect-src', 'frame-src', 'default-src'];
        for (const [host, tagIdx] of hosts) {
            const allowed = FETCH_DIRECTIVES.some((d) => cspAllows(csp[d], host));
            if (!allowed) {
                add('CRITICAL', 'csp-blocks-tag-host',
                    `${host} is referenced by ${tagIdx.map(label).join(', ')} but appears in no CSP fetch directive — requests to it are blocked silently`);
            }
        }
    } else {
        add('LOW', 'csp-unreadable', 'could not read Content-Security-Policy from netlify.toml');
    }

    // 9. Custom HTML risk surface (CSP has require-trusted-types-for and no unsafe-eval)
    tags.forEach((t, i) => {
        if (t.function !== '__html') return;
        const html = String(t.vtp_html || '');
        for (const pat of ['eval(', 'new Function', 'document.write']) {
            if (html.includes(pat)) {
                add('HIGH', 'custom-html-unsafe',
                    `${label(i)} contains ${pat} — blocked by require-trusted-types-for 'script' with no unsafe-eval`);
            }
        }
        if (t.vtp_supportDocumentWrite === true) {
            add('MEDIUM', 'custom-html-document-write', `${label(i)} enables document.write support`);
        }
        // Empty metadata map == no additional consent checks configured.
        if (Array.isArray(t.metadata) && t.metadata.length <= 1) {
            add('MEDIUM', 'callrail-clarity-ungated',
                `${label(i)} has no consent conditions — it fires before the visitor answers the banner`);
        }
    });

    // 10. Hardcoded measurement / conversion IDs
    const idPat = /\b(G-[A-Z0-9]{6,}|AW-\d{9,}|GT-[A-Z0-9]+|UA-\d+-\d+)\b/;
    const hard = [];
    tags.forEach((t, i) => {
        for (const s of stringValues(t)) {
            const m = s.match(idPat);
            if (m) hard.push(`${label(i)}: ${m[1]}`);
            if (m && m[1].startsWith('UA-')) {
                add('HIGH', 'universal-analytics', `${label(i)} references a dead Universal Analytics ID ${m[1]}`);
            }
        }
    });
    if (hard.length) {
        add('LOW', 'hardcoded-ids', `${hard.length} measurement/conversion IDs are literals rather than variables`, hard.join('; '));
    }

    // 11. GA4 coverage
    const googTags = tags.filter((t) => t.function === '__googtag');
    const ga4 = googTags.filter((t) => String(t.vtp_tagId || '').startsWith('G-'));
    const ga4Events = tags.filter((t) => t.function === '__gaawe').length;
    const seen = new Map();
    for (const t of ga4) seen.set(t.vtp_tagId, (seen.get(t.vtp_tagId) || 0) + 1);
    for (const [id, n] of seen) {
        if (n > 1) add('HIGH', 'duplicate-ga4-config', `${n} Google Tags configure ${id} — page views will double-count`);
    }
    if (ga4.length && ga4Events === 0) {
        add('LOW', 'ga4-no-events', 'GA4 has a config tag but no event tags — page_view and enhanced measurement only');
    }

    return findings;
}

// -------------------------------------------------------------------- report

const RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const src = await loadContainer();
const resource = extractResource(src);
const csp = parseCsp();
const findings = audit(resource, csp)
    .map((f) => (ACCEPTED.has(f.id) ? { ...f, severity: 'ACCEPTED' } : f))
    .sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));

const fatal = findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');

if (asJson) {
    console.log(JSON.stringify({
        container: CONTAINER_ID,
        version: resource.version,
        counts: {
            tags: resource.tags?.length ?? 0,
            variables: resource.macros?.length ?? 0,
            predicates: resource.predicates?.length ?? 0,
            rules: resource.rules?.length ?? 0,
        },
        findings,
    }, null, 2));
} else {
    console.log(`\nGTM ${CONTAINER_ID} — published version ${resource.version}`);
    console.log(`${resource.tags?.length ?? 0} tags, ${resource.macros?.length ?? 0} variables, ` +
                `${resource.predicates?.length ?? 0} predicates, ${resource.rules?.length ?? 0} rules\n`);
    if (!findings.length) console.log('  no findings\n');
    for (const f of findings) {
        console.log(`  [${f.severity}] ${f.id}`);
        console.log(`      ${f.message}`);
        if (f.detail) console.log(`      ${f.detail}`);
    }
    const counts = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] || 0) + 1 }), {});
    console.log('\n' + Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('  ') || '');
    console.log(fatal.length ? `\nFAIL — ${fatal.length} unaccepted high-severity finding(s)\n`
                             : '\nPASS — no unaccepted high-severity findings\n');
}

process.exit(fatal.length ? 1 : 0);
