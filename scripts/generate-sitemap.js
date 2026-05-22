/**
 * Sitemap Generator for Frank Penney Injury Law
 *
 * Scans root HTML files and fetches blog post slugs from Storyblok CMS
 * to auto-generate sitemap.xml during the build process.
 *
 * Usage: node scripts/generate-sitemap.js
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const SITE_URL = 'https://www.penneylaw.com';
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT_DIR, 'sitemap.xml');

// Storyblok config (public read-only token, same as blog.js)
const STORYBLOK_TOKEN = 'yDLol9DLwFeUUgsyYx3rcQtt';
const STORYBLOK_API = 'https://api.storyblok.com/v2/cdn';

// Files that should never appear in the sitemap
const EXCLUDED_FILES = new Set([
    '404.html',
    'thank-you.html',
    'style-guide.html',
    'netlify-form-template.html',
    'blog-post.html',          // Shell for /blog/{slug}
    'accident-news-post.html', // Shell for /accident-news/{slug}
    'city-listing.html',       // Shell for /{city}/
    'city-post.html',          // Shell for /{city}/{slug}
]);

// Page classification for priority and changefreq
const PAGE_CONFIG = {
    'index.html':           { priority: '1.0', changefreq: 'weekly' },
    'contact.html':         { priority: '0.9', changefreq: 'monthly' },
    'practice-areas.html':  { priority: '0.9', changefreq: 'monthly' },
    'about-us.html':        { priority: '0.8', changefreq: 'monthly' },
    'attorney-referrals.html': { priority: '0.6', changefreq: 'monthly' },
    'locations.html':       { priority: '0.8', changefreq: 'monthly' },
    'blog.html':            { priority: '0.7', changefreq: 'weekly' },
    'resources.html':       { priority: '0.6', changefreq: 'monthly' },
    'privacy-policy.html':  { priority: '0.3', changefreq: 'yearly' },
    'terms-of-service.html':{ priority: '0.3', changefreq: 'yearly' },
    'disclaimer.html':      { priority: '0.3', changefreq: 'yearly' },
};

// Practice area pages get priority 0.8
const PRACTICE_AREA_FILES = new Set([
    'personal-injury.html',
    'car-accidents.html',
    'truck-accidents.html',
    'motorcycle-accidents.html',
    'wrongful-death.html',
    'dog-bite.html',
    'slip-and-fall.html',
    'bicycle-accidents.html',
    'bus-accidents.html',
    'traumatic-brain-injuries.html',
]);

// Location pages get priority 0.7
const LOCATION_FILES = new Set([
    'sacramento.html',
    'roseville.html',
    'fairfield.html',
    'stockton.html',
    'modesto.html',
    'chico.html',
    'redding.html',
    'oakland.html',
    'san-francisco.html',
    'los-angeles.html',
    'san-diego.html',
]);

// Cities with Storyblok-backed content (mirrors CITY_NAMES in js/city.js)
const CITY_SLUGS = [
    'sacramento', 'roseville', 'stockton', 'modesto',
    'oakland', 'redding', 'chico', 'fairfield',
];

// Attorney bio pages live at /{slug}/index.html; not picked up by root-only scan.
const ATTORNEY_SLUGS = [
    'frank-d-penney',
    'mark-mccauley',
    'joshua-boyce',
    'jacob-stoeltzing',
];

// Pages that have hreflang alternates. Keyed by absolute URL (no host) for the EN
// canonical; value is the full alternate set (including self). Every URL in this map
// emits identical <xhtml:link rel="alternate" hreflang="..."/> children so that
// Google sees reciprocal hreflang on all variants.
const TRANSLATED_PAGES = {
    '/car-accidents.html': [
        { hreflang: 'en',        loc: '/car-accidents.html' },
        { hreflang: 'es',        loc: '/es/car-accidents.html' },
        { hreflang: 'ru',        loc: '/ru/car-accidents.html' },
        { hreflang: 'x-default', loc: '/car-accidents.html' },
    ],
};
// Build a reverse lookup: any URL that should emit hreflang -> its alternate set.
const HREFLANG_BY_PATH = (function () {
    const map = {};
    for (const enPath of Object.keys(TRANSLATED_PAGES)) {
        const alts = TRANSLATED_PAGES[enPath];
        for (const a of alts) {
            map[a.loc] = alts;
        }
    }
    return map;
})();

function getPageConfig(filename) {
    if (PAGE_CONFIG[filename]) {
        return PAGE_CONFIG[filename];
    }
    if (PRACTICE_AREA_FILES.has(filename)) {
        return { priority: '0.8', changefreq: 'monthly' };
    }
    if (LOCATION_FILES.has(filename)) {
        return { priority: '0.7', changefreq: 'monthly' };
    }
    // Default for any new pages
    return { priority: '0.5', changefreq: 'monthly' };
}

function getStaticPages() {
    const files = fs.readdirSync(ROOT_DIR);
    const pages = [];

    for (const file of files) {
        if (!file.endsWith('.html')) continue;
        if (EXCLUDED_FILES.has(file)) continue;

        const fullPath = path.join(ROOT_DIR, file);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;

        const loc = file === 'index.html'
            ? SITE_URL + '/'
            : SITE_URL + '/' + file;

        const lastmod = stat.mtime.toISOString().split('T')[0];
        const config = getPageConfig(file);

        pages.push({
            loc,
            lastmod,
            changefreq: config.changefreq,
            priority: config.priority,
        });
    }

    // Translated pages live in /es/ and /ru/ subdirectories. The root scan
    // doesn't recurse, so add each known alternate explicitly (skipping
    // entries whose loc matches the EN source already discovered above).
    const enLocs = new Set(pages.map((p) => p.loc));
    for (const altList of Object.values(TRANSLATED_PAGES)) {
        for (const alt of altList) {
            if (alt.hreflang === 'x-default') continue;
            const fullPath = path.join(ROOT_DIR, alt.loc.replace(/^\//, ''));
            if (!fs.existsSync(fullPath)) continue;
            const fullUrl = SITE_URL + alt.loc;
            if (enLocs.has(fullUrl)) continue;
            const stat = fs.statSync(fullPath);
            pages.push({
                loc: fullUrl,
                lastmod: stat.mtime.toISOString().split('T')[0],
                changefreq: 'monthly',
                priority: '0.8',
            });
        }
    }

    return pages;
}

// Blog posts use content.publish_date (format: "2026-02-02 00:00" or ISO)
function blogLastmod(story) {
    const d = story.content && story.content.publish_date;
    if (d) return d.split(' ')[0].split('T')[0];
    return story.published_at
        ? story.published_at.split('T')[0]
        : new Date().toISOString().split('T')[0];
}

// accident-news and city posts use content.Date (capital D)
function cmsDateLastmod(story) {
    const d = story.content && story.content.Date;
    if (d) return d.split(' ')[0].split('T')[0];
    return story.published_at
        ? story.published_at.split('T')[0]
        : new Date().toISOString().split('T')[0];
}

async function fetchStoriesFromFolder(prefix, opts) {
    const { buildUrl, getLastmod, priority, changefreq } = opts;
    const posts = [];
    let page = 1;
    const perPage = 100;

    try {
        while (true) {
            const url = `${STORYBLOK_API}/stories?token=${STORYBLOK_TOKEN}&version=published` +
                `&starts_with=${encodeURIComponent(prefix)}&is_startpage=false` +
                `&per_page=${perPage}&page=${page}`;
            let response = await fetch(url);

            // Storyblok's CDN has a short-burst rate limit; back off once on 429.
            if (response.status === 429) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                response = await fetch(url);
            }

            if (!response.ok) {
                console.warn(`Storyblok ${prefix} returned ${response.status} — skipping`);
                return [];
            }

            const data = await response.json();
            if (!data.stories || data.stories.length === 0) break;

            for (const story of data.stories) {
                posts.push({
                    loc: buildUrl(story),
                    lastmod: getLastmod(story),
                    changefreq,
                    priority,
                });
            }

            const total = parseInt(response.headers.get('Total'), 10) || 0;
            if (page * perPage >= total) break;
            page++;
        }
    } catch (err) {
        console.warn(`Failed to fetch ${prefix} from Storyblok:`, err.message);
        return [];
    }

    return posts;
}

function buildSitemapXml(entries) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    xml += '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';

    for (const entry of entries) {
        xml += '    <url>\n';
        xml += '        <loc>' + entry.loc + '</loc>\n';
        xml += '        <lastmod>' + entry.lastmod + '</lastmod>\n';
        xml += '        <changefreq>' + entry.changefreq + '</changefreq>\n';
        xml += '        <priority>' + entry.priority + '</priority>\n';

        // Emit reciprocal hreflang alternates if this URL has translated variants.
        const sitePath = entry.loc.startsWith(SITE_URL)
            ? entry.loc.slice(SITE_URL.length) || '/'
            : entry.loc;
        const alternates = HREFLANG_BY_PATH[sitePath];
        if (alternates) {
            for (const alt of alternates) {
                xml += '        <xhtml:link rel="alternate" hreflang="' + alt.hreflang +
                    '" href="' + SITE_URL + alt.loc + '"/>\n';
            }
        }

        xml += '    </url>\n';
    }

    xml += '</urlset>\n';
    return xml;
}

async function main() {
    console.log('Generating sitemap...');

    const staticPages = getStaticPages();

    const today = new Date().toISOString().split('T')[0];

    // Note: bare /{city}/ URLs are intentionally excluded. Netlify pretty-URL handling
    // resolves them to the static /{city}.html landing page, so listing both forms in
    // the sitemap creates duplicate-URL warnings. City-post URLs (/{city}/{slug}) are
    // still indexed below since they're distinct content.
    const cityListings = [];

    const attorneyPages = ATTORNEY_SLUGS.map((slug) => ({
        loc: `${SITE_URL}/${slug}/`,
        lastmod: today,
        changefreq: 'monthly',
        priority: '0.6',
    }));

    // Fetch serially to avoid tripping Storyblok's burst rate limit (429s).
    const blogPosts = await fetchStoriesFromFolder('blog/', {
        buildUrl: (s) => `${SITE_URL}/blog/${s.slug}`,
        getLastmod: blogLastmod,
        priority: '0.6',
        changefreq: 'monthly',
    });
    const newsPosts = await fetchStoriesFromFolder('accident-news/', {
        buildUrl: (s) => `${SITE_URL}/accident-news/${s.slug}`,
        getLastmod: cmsDateLastmod,
        priority: '0.6',
        changefreq: 'monthly',
    });
    const cityPosts = [];
    for (const city of CITY_SLUGS) {
        const posts = await fetchStoriesFromFolder(`${city}/`, {
            buildUrl: (s) => `${SITE_URL}/${city}/${s.slug}`,
            getLastmod: cmsDateLastmod,
            priority: '0.6',
            changefreq: 'monthly',
        });
        cityPosts.push(...posts);
    }

    const allEntries = [
        ...staticPages,
        ...cityListings,
        ...attorneyPages,
        ...blogPosts,
        ...newsPosts,
        ...cityPosts,
    ];

    const xml = buildSitemapXml(allEntries);
    fs.writeFileSync(OUTPUT_FILE, xml, 'utf-8');

    console.log(
        `Generated sitemap.xml with ${allEntries.length} URLs ` +
        `(${staticPages.length} static pages + ${cityListings.length} city listings + ` +
        `${attorneyPages.length} attorney pages + ` +
        `${blogPosts.length} blog + ${newsPosts.length} accident-news + ${cityPosts.length} city posts)`
    );
}

main().catch(function (err) {
    console.error('Sitemap generation failed:', err);
    process.exit(1);
});
