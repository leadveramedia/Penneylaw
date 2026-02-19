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
    'blog-post.html', // Template shell for dynamic blog posts
]);

// Page classification for priority and changefreq
const PAGE_CONFIG = {
    'index.html':           { priority: '1.0', changefreq: 'weekly' },
    'contact.html':         { priority: '0.9', changefreq: 'monthly' },
    'practice-areas.html':  { priority: '0.9', changefreq: 'monthly' },
    'about-us.html':        { priority: '0.8', changefreq: 'monthly' },
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
]);

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

    return pages;
}

async function fetchAllBlogPosts() {
    const posts = [];
    let page = 1;
    const perPage = 100;

    try {
        while (true) {
            const url = `${STORYBLOK_API}/stories?token=${STORYBLOK_TOKEN}&version=published&starts_with=blog/&is_startpage=false&per_page=${perPage}&page=${page}&sort_by=content.publish_date:desc`;
            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`Storyblok API returned ${response.status} — skipping blog posts in sitemap`);
                return [];
            }

            const data = await response.json();

            if (!data.stories || data.stories.length === 0) break;

            for (const story of data.stories) {
                const publishDate = story.content && story.content.publish_date;
                // Normalize "2026-02-02 00:00" to just the date part
                const lastmod = publishDate
                    ? publishDate.split(' ')[0].split('T')[0]
                    : story.published_at
                        ? story.published_at.split('T')[0]
                        : new Date().toISOString().split('T')[0];

                posts.push({
                    loc: SITE_URL + '/blog/' + story.slug,
                    lastmod,
                    changefreq: 'monthly',
                    priority: '0.6',
                });
            }

            const total = parseInt(response.headers.get('Total'), 10) || 0;
            if (page * perPage >= total) break;
            page++;
        }
    } catch (err) {
        console.warn('Failed to fetch blog posts from Storyblok:', err.message);
        console.warn('Blog posts will not be included in sitemap.');
        return [];
    }

    return posts;
}

function buildSitemapXml(entries) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    for (const entry of entries) {
        xml += '    <url>\n';
        xml += '        <loc>' + entry.loc + '</loc>\n';
        xml += '        <lastmod>' + entry.lastmod + '</lastmod>\n';
        xml += '        <changefreq>' + entry.changefreq + '</changefreq>\n';
        xml += '        <priority>' + entry.priority + '</priority>\n';
        xml += '    </url>\n';
    }

    xml += '</urlset>\n';
    return xml;
}

async function main() {
    console.log('Generating sitemap...');

    const staticPages = getStaticPages();
    const blogPosts = await fetchAllBlogPosts();
    const allEntries = [...staticPages, ...blogPosts];

    const xml = buildSitemapXml(allEntries);
    fs.writeFileSync(OUTPUT_FILE, xml, 'utf-8');

    console.log(`Generated sitemap.xml with ${allEntries.length} URLs (${staticPages.length} pages + ${blogPosts.length} blog posts)`);
}

main().catch(function (err) {
    console.error('Sitemap generation failed:', err);
    process.exit(1);
});
