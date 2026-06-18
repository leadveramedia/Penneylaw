/**
 * Build translated copies of car-accidents.html into /es/ and /ru/.
 *
 * Reads the EN source, sends translatable strings to DeepL, and writes
 * the result with translated copy + translated meta + canonical-to-self
 * + reciprocal hreflang tags + a <script src="/js/i18n-strings.js"> tag
 * so the modal/form-validation can pick up translations at runtime.
 *
 * Usage:
 *   DEEPL_API_KEY=xxxxx npm run build:translations
 *   DEEPL_API_TYPE=free|paid (optional, defaults to 'free')
 *
 * The output files are committed to git — regenerate them whenever the
 * EN source page is edited.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const fetch = require('node-fetch');

const ROOT_DIR = path.resolve(__dirname, '..');
const SITE_URL = 'https://penneylaw.com';

// Source -> targets. Add more pages here when expanding the program.
const TRANSLATIONS = [
    {
        source: 'car-accidents.html',
        targets: [
            { lang: 'es', deeplCode: 'ES',    locale: 'es_ES', outPath: 'es/car-accidents.html' },
            { lang: 'ru', deeplCode: 'RU',    locale: 'ru_RU', outPath: 'ru/car-accidents.html' },
        ],
    },
];

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_API_TYPE = process.env.DEEPL_API_TYPE || 'free';
const DEEPL_URL = DEEPL_API_TYPE === 'paid'
    ? 'https://api.deepl.com/v2/translate'
    : 'https://api-free.deepl.com/v2/translate';

// Strings the firm has chosen to keep literal across all languages (branded).
const DO_NOT_TRANSLATE = new Set([
    'Bank on Frank',
    'Frank Penney Injury Law',
]);

// CSS selectors that identify translatable content nodes (visible body copy).
// We translate textContent of each match. Attributes (alt, aria-label, title,
// placeholder, content) are handled separately below.
const TEXT_SELECTORS = [
    'h1', 'h2', 'h3', 'h4',
    'main p',
    'main li',
    'main a.btn',
    'main button',
    'main .section-subtitle',
    'main .section-description',
    'main .breadcrumbs-link span',
    'main .breadcrumbs-current',
    'main .page-subtitle',
];

const ATTR_SELECTORS = [
    { selector: 'img[alt]', attr: 'alt' },
    { selector: '[aria-label]', attr: 'aria-label' },
    { selector: 'input[placeholder]', attr: 'placeholder' },
    { selector: 'textarea[placeholder]', attr: 'placeholder' },
];

function ensureApiKey() {
    if (!DEEPL_API_KEY) {
        console.error('ERROR: DEEPL_API_KEY env var is required.');
        console.error('Get a free key at https://www.deepl.com/pro-api');
        console.error('Then run: DEEPL_API_KEY=xxxxx npm run build:translations');
        process.exit(1);
    }
}

/**
 * Batch-translate an array of strings via DeepL. Returns array in same order.
 * DeepL accepts up to 50 text params per request; we chunk to be safe.
 */
async function translateBatch(texts, targetLang) {
    if (texts.length === 0) return [];
    const out = [];
    const CHUNK = 40;
    for (let i = 0; i < texts.length; i += CHUNK) {
        const chunk = texts.slice(i, i + CHUNK);
        const params = new URLSearchParams();
        params.append('target_lang', targetLang);
        params.append('tag_handling', 'html');
        params.append('preserve_formatting', '1');
        if (targetLang === 'ES') params.append('formality', 'more');
        for (const t of chunk) params.append('text', t);

        const res = await fetch(DEEPL_URL, {
            method: 'POST',
            headers: {
                'Authorization': 'DeepL-Auth-Key ' + DEEPL_API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`DeepL ${res.status}: ${body}`);
        }
        const data = await res.json();
        for (const r of data.translations) out.push(r.text);
    }
    return out;
}

/**
 * Translate text but skip the DO_NOT_TRANSLATE set. Returns same-length array
 * in same order so caller can map back to original positions.
 */
async function translatePreserving(strings, targetLang) {
    const indices = [];
    const toSend = [];
    strings.forEach((s, i) => {
        const trimmed = s.trim();
        if (!trimmed) return;
        if (DO_NOT_TRANSLATE.has(trimmed)) return;
        indices.push(i);
        toSend.push(s);
    });
    if (toSend.length === 0) return strings.slice();
    const translated = await translateBatch(toSend, targetLang);
    const out = strings.slice();
    indices.forEach((origIdx, j) => { out[origIdx] = translated[j]; });
    return out;
}

// Canonical URLs are non-www + clean (no .html); the file path keeps its
// extension, so strip .html only when building the public URL.
function cleanUrlPath(p) {
    return p.replace(/\.html$/, '');
}

function selfUrl(outPath) {
    return SITE_URL + '/' + cleanUrlPath(outPath);
}

function buildHreflangLinks(sourceFilename) {
    const clean = cleanUrlPath(sourceFilename);
    return [
        { hreflang: 'en',        href: SITE_URL + '/' + clean },
        { hreflang: 'es',        href: SITE_URL + '/es/' + clean },
        { hreflang: 'ru',        href: SITE_URL + '/ru/' + clean },
        { hreflang: 'x-default', href: SITE_URL + '/' + clean },
    ];
}

/**
 * Mutate $ (cheerio root for one target language). Translates copy + rewrites
 * meta/canonical/hreflang/JSON-LD/og:locale and injects i18n-strings.js script.
 */
async function transformDoc($, target, sourceFilename) {
    // 1) Set html lang
    $('html').attr('lang', target.lang);

    // 2) Collect text nodes to translate (body + select head fields)
    const textTargets = []; // { setter: fn(newText), original: string }

    // Head meta fields
    const TITLE_TEXT = $('title').text();
    if (TITLE_TEXT) textTargets.push({ original: TITLE_TEXT, setter: (t) => $('title').text(t) });

    const metaPairs = [
        { sel: 'meta[name="description"]' },
        { sel: 'meta[property="og:title"]' },
        { sel: 'meta[property="og:description"]' },
        { sel: 'meta[name="twitter:title"]' },
        { sel: 'meta[name="twitter:description"]' },
    ];
    for (const { sel } of metaPairs) {
        const el = $(sel);
        if (el.length) {
            const content = el.attr('content') || '';
            if (content) {
                textTargets.push({
                    original: content,
                    setter: (t) => el.attr('content', t),
                });
            }
        }
    }

    // Body text content (one selector at a time, walking direct text-bearing nodes)
    for (const sel of TEXT_SELECTORS) {
        $(sel).each(function () {
            const $el = $(this);
            // Only translate elements whose children are pure text or simple inline tags
            // (avoid translating wrapper elements that contain other translatable children).
            const html = $el.html() || '';
            if (!html.trim()) return;
            // Skip if any descendant is also in TEXT_SELECTORS (will be handled separately)
            if ($el.find(TEXT_SELECTORS.join(',')).length > 0) return;
            const text = $el.html();
            textTargets.push({
                original: text,
                setter: (t) => $el.html(t),
            });
        });
    }

    // Attribute targets
    for (const { selector, attr } of ATTR_SELECTORS) {
        $(selector).each(function () {
            const $el = $(this);
            const val = $el.attr(attr);
            if (!val || !val.trim()) return;
            textTargets.push({
                original: val,
                setter: (t) => $el.attr(attr, t),
            });
        });
    }

    // 3) Translate via DeepL
    const originals = textTargets.map((t) => t.original);
    const translated = await translatePreserving(originals, target.deeplCode);
    textTargets.forEach((t, i) => t.setter(translated[i]));

    // 4) Canonical -> self
    const canonical = $('link[rel="canonical"]');
    if (canonical.length) canonical.attr('href', selfUrl(target.outPath));

    // 5) Open Graph url + locale; Twitter url
    $('meta[property="og:url"]').attr('content', selfUrl(target.outPath));
    $('meta[name="twitter:url"]').attr('content', selfUrl(target.outPath));

    let ogLocale = $('meta[property="og:locale"]');
    if (!ogLocale.length) {
        ogLocale = $('<meta property="og:locale">');
        $('meta[property="og:site_name"]').after(ogLocale);
    }
    ogLocale.attr('content', target.locale);

    // og:locale:alternate — one per other language
    $('meta[property="og:locale:alternate"]').remove();
    const allLocales = TRANSLATIONS[0].targets.map((t) => t.locale).concat(['en_US']);
    for (const loc of allLocales) {
        if (loc === target.locale) continue;
        $('<meta>').attr('property', 'og:locale:alternate').attr('content', loc).insertAfter(ogLocale);
    }

    // 6) hreflang block — replace any existing alternates with the canonical set
    $('link[rel="alternate"][hreflang]').remove();
    const alternates = buildHreflangLinks(sourceFilename);
    const canonicalEl = $('link[rel="canonical"]');
    let insertAfter = canonicalEl.length ? canonicalEl : $('title');
    // Insert in reverse so they appear in declared order
    for (let i = alternates.length - 1; i >= 0; i--) {
        const a = alternates[i];
        const link = $('<link>').attr('rel', 'alternate').attr('hreflang', a.hreflang).attr('href', a.href);
        insertAfter.after(link);
    }

    // 7) JSON-LD: translate description + serviceType, rewrite url; keep
    //    name/address/telephone/geo/areaServed literal. priceRange "Free
    //    Consultation" gets translated via DeepL.
    const ldNode = $('script[type="application/ld+json"]').first();
    if (ldNode.length) {
        try {
            const ld = JSON.parse(ldNode.contents().toString());
            const fieldsToTranslate = [];
            if (ld.description) fieldsToTranslate.push({ key: 'description', val: ld.description });
            if (ld.serviceType) fieldsToTranslate.push({ key: 'serviceType', val: ld.serviceType });
            if (ld.priceRange)  fieldsToTranslate.push({ key: 'priceRange',  val: ld.priceRange });

            if (fieldsToTranslate.length > 0) {
                const translatedLd = await translatePreserving(
                    fieldsToTranslate.map((f) => f.val),
                    target.deeplCode,
                );
                fieldsToTranslate.forEach((f, i) => { ld[f.key] = translatedLd[i]; });
            }
            ld.url = selfUrl(target.outPath);
            // Keep name, telephone, address, geo, areaServed literal — DO NOT translate.
            ldNode.text(JSON.stringify(ld, null, 4));
        } catch (e) {
            console.warn(`  WARN: could not parse JSON-LD: ${e.message}`);
        }
    }

    // 8) Robots meta: explicit index,follow defense for the translation
    let robotsMeta = $('meta[name="robots"]');
    if (!robotsMeta.length) {
        robotsMeta = $('<meta name="robots" content="index, follow">');
        $('head meta[charset]').after(robotsMeta);
    } else {
        robotsMeta.attr('content', 'index, follow');
    }

    // 9) Rewrite relative asset/link URLs to absolute. Translated pages live one
    //    directory deeper than the EN source, so relative paths like "css/..."
    //    or "js/..." would 404. Skip absolute URLs, anchors, and special schemes.
    const URL_ATTRS = ['href', 'src'];
    const isAbsoluteOrSpecial = (v) =>
        /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(v);
    URL_ATTRS.forEach((attr) => {
        $('[' + attr + ']').each(function () {
            const $el = $(this);
            const v = $el.attr(attr);
            if (!v || isAbsoluteOrSpecial(v)) return;
            $el.attr(attr, '/' + v);
        });
    });

    // 10) Inject i18n-strings.js so modal & form-validation pick up translations.
    if ($('script[src="/js/i18n-strings.js"]').length === 0) {
        const i18nScript = '<script src="/js/i18n-strings.js" defer></script>';
        // Insert before the existing bundle.min.js script
        const bundleScript = $('script[src*="bundle.min.js"]');
        if (bundleScript.length) {
            bundleScript.first().before(i18nScript);
        } else {
            $('body').append(i18nScript);
        }
    }
}

async function processOne(source) {
    const srcPath = path.join(ROOT_DIR, source.source);
    if (!fs.existsSync(srcPath)) {
        throw new Error(`Source file not found: ${srcPath}`);
    }
    const html = fs.readFileSync(srcPath, 'utf-8');

    // Patch EN source: ensure hreflang block is present (idempotent).
    const $en = cheerio.load(html, { decodeEntities: false });
    $en('link[rel="alternate"][hreflang]').remove();
    const alternates = buildHreflangLinks(source.source);
    const canonicalEnEl = $en('link[rel="canonical"]');
    let insertAfter = canonicalEnEl.length ? canonicalEnEl : $en('title');
    for (let i = alternates.length - 1; i >= 0; i--) {
        const a = alternates[i];
        const link = $en('<link>').attr('rel', 'alternate').attr('hreflang', a.hreflang).attr('href', a.href);
        insertAfter.after(link);
    }
    fs.writeFileSync(srcPath, $en.html(), 'utf-8');
    console.log(`Patched EN source ${source.source} with hreflang block.`);

    // Build each translation
    for (const target of source.targets) {
        console.log(`\nTranslating ${source.source} -> ${target.outPath} (${target.deeplCode})...`);
        const $ = cheerio.load(html, { decodeEntities: false });
        await transformDoc($, target, source.source);

        const outFull = path.join(ROOT_DIR, target.outPath);
        fs.mkdirSync(path.dirname(outFull), { recursive: true });
        fs.writeFileSync(outFull, $.html(), 'utf-8');
        console.log(`  Wrote ${target.outPath}`);
    }
}

async function main() {
    ensureApiKey();
    for (const t of TRANSLATIONS) {
        await processOne(t);
    }
    console.log('\nDone. Run `npm run generate:sitemap` to refresh sitemap.xml with hreflang.');
}

main().catch((err) => {
    console.error('\nbuild-translations failed:', err.message);
    process.exit(1);
});
