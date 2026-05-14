const fs = require('fs');
const http = require('http');
const https = require('https');

const csvPath = process.argv[2] || '../Frank Penney - Migration - 2026 - Pages.csv';
const baseUrl = process.argv[3] || 'http://localhost:8888';

const csv = fs.readFileSync(csvPath, 'utf-8');
const lines = csv.split('\n').slice(1).filter(l => l.trim());

// Parse CSV (handle commas in quoted fields)
function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; }
        else { current += ch; }
    }
    fields.push(current.trim());
    return fields;
}

// Normalize URL for comparison
function normalize(url) {
    if (!url) return '';
    url = url.replace(/^https?:\/\/(www\.)?penneylaw\.com/, '');
    url = url.replace(/\.html$/, '');
    url = url.replace(/\/+$/, '');
    if (!url) url = '/';
    return url.toLowerCase();
}

function testRedirect(originalUrl) {
    return new Promise((resolve) => {
        // Convert original URL to path
        let path = originalUrl.replace(/^https?:\/\/(www\.)?penneylaw\.com/, '');
        if (!path) path = '/';

        const url = `${baseUrl}${path}`;
        const visited = [];

        const makeRequest = (requestUrl) => {
            if (visited.includes(requestUrl)) {
                resolve({
                    path,
                    status: 'REDIRECT_LOOP',
                    finalUrl: requestUrl,
                    loopChain: [...visited, requestUrl],
                });
                return;
            }
            if (visited.length > 10) {
                resolve({ path, status: 'TOO_MANY_REDIRECTS', finalUrl: requestUrl, loopChain: visited });
                return;
            }
            visited.push(requestUrl);

            const mod = requestUrl.startsWith('https') ? https : http;
            const req = mod.get(requestUrl, { timeout: 10000 }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    let location = res.headers.location;
                    if (location.startsWith('/')) {
                        location = `${baseUrl}${location}`;
                    }
                    makeRequest(location);
                } else {
                    // Get final path
                    let finalPath = requestUrl.replace(baseUrl, '');
                    if (!finalPath) finalPath = '/';
                    resolve({ path, status: res.statusCode, finalUrl: finalPath, redirectCount: visited.length - 1 });
                }
            });
            req.on('error', (e) => {
                resolve({ path, status: 'ERROR', error: e.message, finalUrl: '' });
            });
            req.on('timeout', () => {
                req.destroy();
                resolve({ path, status: 'TIMEOUT', finalUrl: '' });
            });
        };

        makeRequest(url);
    });
}

// Canonical URLs that must return 200 (no loops, no 4xx/5xx). Add slugs here
// when you ship a new top-level page. This is the safety net that would have
// caught the /frank-d-penney/ ⇄ /frank-d-penney/ loop pre-deploy.
const CANONICAL_URLS = [
    '/',
    '/about-us.html',
    '/contact.html',
    '/practice-areas.html',
    '/locations.html',
    '/frank-d-penney/',
    '/mark-mccauley/',
    '/joshua-boyce/',
];

async function runCanonicalSmokeTest() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`CANONICAL SMOKE TEST (must return 200, no loops)`);
    console.log(`${'='.repeat(80)}\n`);

    const failures = [];
    for (const url of CANONICAL_URLS) {
        const result = await testRedirect(`https://penneylaw.com${url}`);
        if (result.status === 200) {
            console.log(`  OK  ${url}`);
        } else if (result.status === 'REDIRECT_LOOP') {
            console.log(`  LOOP ${url} → chain: ${result.loopChain.join(' → ')}`);
            failures.push({ url, result });
        } else {
            console.log(`  FAIL ${url} → HTTP ${result.status} at ${result.finalUrl}`);
            failures.push({ url, result });
        }
    }
    return failures;
}

async function main() {
    const pairs = [];
    for (const line of lines) {
        const fields = parseCSVLine(line);
        const originalUrl = fields[0];
        const newUrl = fields[1];
        if (originalUrl) {
            pairs.push({ originalUrl, newUrl: newUrl || '' });
        }
    }

    console.log(`Testing ${pairs.length} URLs against ${baseUrl}...\n`);

    const results = { pass: [], fail: [], noTarget: [], error: [], loop: [] };

    // Test in batches of 10 for speed
    for (let i = 0; i < pairs.length; i += 10) {
        const batch = pairs.slice(i, i + 10);
        const batchResults = await Promise.all(batch.map(async ({ originalUrl, newUrl }) => {
            const result = await testRedirect(originalUrl);
            const expectedPath = normalize(newUrl);
            const actualPath = normalize(result.finalUrl);

            return { originalUrl, newUrl, result, expectedPath, actualPath };
        }));

        for (const { originalUrl, newUrl, result, expectedPath, actualPath } of batchResults) {
            if (result.status === 'REDIRECT_LOOP' || result.status === 'TOO_MANY_REDIRECTS') {
                results.loop.push({ originalUrl, newUrl, result });
            } else if (result.status === 'ERROR' || result.status === 'TIMEOUT') {
                results.error.push({ originalUrl, newUrl, result });
            } else if (!newUrl || newUrl === '/') {
                // No target URL or redirect to home - just check it doesn't 404 if redirecting to /
                if (newUrl === '/' && result.status === 200) {
                    results.pass.push({ originalUrl, newUrl, result });
                } else if (!newUrl) {
                    results.noTarget.push({ originalUrl, result });
                } else {
                    results.fail.push({ originalUrl, newUrl, result, expectedPath, actualPath });
                }
            } else if (actualPath === expectedPath) {
                results.pass.push({ originalUrl, newUrl, result });
            } else {
                results.fail.push({ originalUrl, newUrl, result, expectedPath, actualPath });
            }
        }
    }

    // Print results
    console.log(`\n${'='.repeat(80)}`);
    console.log(`RESULTS: ${results.pass.length} PASS | ${results.fail.length} FAIL | ${results.loop.length} LOOP | ${results.noTarget.length} NO TARGET | ${results.error.length} ERROR`);
    console.log(`${'='.repeat(80)}\n`);

    if (results.loop.length > 0) {
        console.log('--- REDIRECT LOOPS ---');
        for (const { originalUrl, result } of results.loop) {
            console.log(`  LOOP: ${originalUrl}`);
            console.log(`    Chain: ${(result.loopChain || []).join(' → ')}`);
            console.log('');
        }
    }

    if (results.fail.length > 0) {
        console.log('--- FAILED REDIRECTS ---');
        for (const { originalUrl, newUrl, result, expectedPath, actualPath } of results.fail) {
            console.log(`  FAIL: ${originalUrl}`);
            console.log(`    Expected: ${newUrl} (normalized: ${expectedPath})`);
            console.log(`    Got:      ${result.finalUrl} (normalized: ${actualPath}) [HTTP ${result.status}]`);
            console.log('');
        }
    }

    if (results.error.length > 0) {
        console.log('--- ERRORS ---');
        for (const { originalUrl, result } of results.error) {
            console.log(`  ERROR: ${originalUrl} → ${result.status} ${result.error || ''}`);
        }
        console.log('');
    }

    if (results.noTarget.length > 0) {
        console.log('--- NO TARGET URL (empty New URL column) ---');
        for (const { originalUrl, result } of results.noTarget) {
            console.log(`  ${originalUrl} → HTTP ${result.status}, landed at: ${result.finalUrl}`);
        }
        console.log('');
    }

    // Summary of passes
    console.log(`--- PASSED (${results.pass.length}) ---`);
    for (const { originalUrl, newUrl } of results.pass) {
        console.log(`  OK: ${originalUrl} → ${newUrl || '/'}`);
    }

    const smokeFailures = await runCanonicalSmokeTest();
    const exitCode = (results.fail.length + results.loop.length + smokeFailures.length) > 0 ? 1 : 0;
    process.exit(exitCode);
}

main();
