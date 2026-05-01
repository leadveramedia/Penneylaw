#!/usr/bin/env node
/**
 * Build all paid-search landing pages from a single template + per-LP JSON configs.
 *
 *   Source: lp-source/template.html  +  lp-source/configs/{slug}.json
 *   Output: lp/{slug}.html
 *
 * Run with: npm run build:lps
 *
 * Each config defines per-LP content (title, H1, hero image, FAQs, testimonials, etc.).
 * Shared content (firm/office schema, awards, footer, CSS) lives in the template — edit
 * once, regenerate all 13 LPs.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'lp-source');
const OUT = path.join(ROOT, 'lp');
const SITE_URL = 'https://www.penneylaw.com';

// Six office locations — fed into LegalService.areaServed and emitted as 6 LocalBusiness blocks.
// Sacramento ZIP and geo coords for non-Roseville offices are TODOs (see lp-improvement-plan).
const OFFICES = [
    { id: 'roseville',  name: 'Roseville',  street: '1508 Eureka Rd',                       zip: '95661', geo: { lat: '38.7521', lon: '-121.2880' } },
    { id: 'sacramento', name: 'Sacramento', street: '333 University Avenue, Suite 200',     zip: null    /* TODO confirm */ },
    { id: 'fairfield',  name: 'Fairfield',  street: '1652 West Texas Street, Suite 248',    zip: '94533' },
    { id: 'stockton',   name: 'Stockton',   street: '5250 Claremont Avenue',                zip: '95207' },
    { id: 'modesto',    name: 'Modesto',    street: '1111 J Street',                        zip: '95354' },
    { id: 'chico',      name: 'Chico',      street: '1108 Sherman Ave',                     zip: '95926' }
];

const FIRM_ID = `${SITE_URL}/#firm`;

function buildLegalService() {
    return {
        '@type': 'LegalService',
        '@id': FIRM_ID,
        name: 'Frank Penney Injury Law',
        description: "Northern California's top-rated injury law firm with $1 Billion+ recovered for accident victims. No fee unless we win. Free consultation 24/7.",
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/images/Logo-FrankPenny.png`,
        image: `${SITE_URL}/images/Logo-FrankPenny.png`,
        telephone: '+1-888-888-0566',
        priceRange: 'Free Consultation',
        founder: { '@type': 'Person', name: 'Frank Penney' },
        foundingDate: '1995',
        slogan: 'Bank on Frank — No Fee Unless We Win',
        knowsLanguage: ['en', 'es'],
        areaServed: [
            { '@type': 'State', name: 'California' },
            ...OFFICES.map(o => o.name)
        ],
        address: {
            '@type': 'PostalAddress',
            streetAddress: '1508 Eureka Rd',
            addressLocality: 'Roseville',
            addressRegion: 'CA',
            postalCode: '95661',
            addressCountry: 'US'
        },
        openingHoursSpecification: {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
            opens: '00:00',
            closes: '23:59'
        },
        sameAs: [
            'https://www.facebook.com/FrankPenneyInjuryLaw',
            'https://www.linkedin.com/company/frank-penney-injury-law'
        ]
    };
}

function buildLocalBusiness(office) {
    const address = {
        '@type': 'PostalAddress',
        streetAddress: office.street,
        addressLocality: office.name,
        addressRegion: 'CA',
        addressCountry: 'US'
    };
    if (office.zip) address.postalCode = office.zip;

    const block = {
        '@type': 'LocalBusiness',
        '@id': `${SITE_URL}/#${office.id}`,
        name: `Frank Penney Injury Law — ${office.name}`,
        address,
        telephone: '+1-888-888-0566',
        openingHoursSpecification: {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
            opens: '00:00',
            closes: '23:59'
        },
        branchOf: { '@id': FIRM_ID }
    };
    if (office.geo) {
        block.geo = { '@type': 'GeoCoordinates', latitude: office.geo.lat, longitude: office.geo.lon };
    }
    return block;
}

function buildService(config) {
    return {
        '@type': 'Service',
        '@id': `${SITE_URL}/lp/${config.slug}.html#service`,
        serviceType: config.serviceType,
        name: config.serviceName,
        provider: { '@id': FIRM_ID },
        areaServed: { '@type': 'State', name: 'California' },
        description: config.serviceDescription,
        offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
            description: 'Free case consultation. No fee unless we win.'
        }
    };
}

function buildBreadcrumb(config) {
    return {
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
            { '@type': 'ListItem', position: 2, name: config.breadcrumbName, item: `${SITE_URL}/lp/${config.slug}.html` }
        ]
    };
}

function buildFaqPage(config) {
    return {
        '@type': 'FAQPage',
        mainEntity: config.faq.map(qa => ({
            '@type': 'Question',
            name: qa.q,
            acceptedAnswer: { '@type': 'Answer', text: qa.a }
        }))
    };
}

function buildReviews(config) {
    return config.testimonials.map(t => ({
        '@type': 'Review',
        itemReviewed: { '@id': FIRM_ID },
        author: { '@type': 'Person', name: t.author },
        reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
        reviewBody: t.text
    }));
}

function buildSchema(config) {
    const graph = [
        buildLegalService(),
        ...OFFICES.map(buildLocalBusiness),
        buildService(config),
        buildBreadcrumb(config),
        buildFaqPage(config),
        ...buildReviews(config)
    ];
    return {
        '@context': 'https://schema.org',
        '@graph': graph
    };
}

function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildFaqHtml(faq) {
    return '\n' + faq.map(qa => (
        `            <details class="lp-faq-item">\n` +
        `                <summary>${escapeHtml(qa.q)}</summary>\n` +
        `                <div class="lp-faq-answer">${escapeHtml(qa.a)}</div>\n` +
        `            </details>`
    )).join('\n') + '\n        ';
}

function buildTestimonialsHtml(testimonials) {
    return '\n' + testimonials.map(t => (
        `            <div class="lp-testimonial">\n` +
        `                <p class="lp-testimonial-text">${escapeHtml(t.text)}</p>\n` +
        `                <p class="lp-testimonial-author">${escapeHtml(t.author)}</p>\n` +
        `                <p class="lp-testimonial-case">${escapeHtml(t.case || '5-Star Google Review')}</p>\n` +
        `            </div>`
    )).join('\n') + '\n        ';
}

function buildOne(template, config) {
    const lpPrefix = `lp-${config.slug}`;
    const canonical = `${SITE_URL}/lp/${config.slug}.html`;
    const schema = buildSchema(config);
    // Match the inline JSON-LD style: 4-space indent, leading newline.
    const schemaJson = '\n    ' + JSON.stringify(schema, null, 4).replace(/\n/g, '\n    ') + '\n    ';

    const replacements = {
        TITLE:               config.title,
        META_DESCRIPTION:    config.metaDescription,
        CANONICAL_URL:       canonical,
        SCHEMA_JSON:         schemaJson,
        HERO_IMAGE:          config.heroImage,
        H1_PRE:              config.h1Pre,
        H1_SPAN:             config.h1Span,
        HERO_SUBHEADLINE:    config.heroSubheadline,
        MOBILE_H2:           config.mobileH2,
        WHY_TEXT:            config.whyText,
        CITIES_TITLE:        config.citiesTitle,
        CITIES_LEDE:         config.citiesLede,
        FAQ_TITLE:           config.faqTitle,
        FAQ_HTML:            buildFaqHtml(config.faq),
        TESTIMONIALS_HTML:   buildTestimonialsHtml(config.testimonials),
        PRACTICE_AREA:       config.practiceArea,
        LP_PREFIX:           lpPrefix
    };

    let html = template;
    for (const [key, val] of Object.entries(replacements)) {
        html = html.replaceAll(`{{${key}}}`, val);
    }

    // Sanity: nothing should remain unreplaced.
    const unresolved = html.match(/\{\{[A-Za-z0-9_]+\}\}/g);
    if (unresolved) {
        throw new Error(`Unresolved placeholders in ${config.slug}: ${unresolved.join(', ')}`);
    }

    return html;
}

function main() {
    const template = fs.readFileSync(path.join(SRC, 'template.html'), 'utf8');
    const configsDir = path.join(SRC, 'configs');
    const configFiles = fs.readdirSync(configsDir)
        .filter(f => f.endsWith('.json'))
        .sort();

    if (configFiles.length === 0) {
        console.error('No configs found in', configsDir);
        process.exit(1);
    }

    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

    let success = 0;
    for (const file of configFiles) {
        const config = JSON.parse(fs.readFileSync(path.join(configsDir, file), 'utf8'));
        const html = buildOne(template, config);
        fs.writeFileSync(path.join(OUT, `${config.slug}.html`), html);
        const bytes = Buffer.byteLength(html, 'utf8');
        console.log(`✓ lp/${config.slug}.html  (${bytes.toLocaleString()} bytes)`);
        success++;
    }
    console.log(`\nBuilt ${success}/${configFiles.length} landing pages.`);
}

main();
