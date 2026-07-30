/**
 * Regression check for js/ad-tracking.js attribution storage.
 * Run: node scripts/test-ad-tracking.mjs
 *
 * Covers the branch that silently breaks attribution if it regresses: first-touch must
 * survive later visits (up to its TTL) while last-touch always updates. A browser shows
 * nothing when this is wrong — the lead email just quietly reports the wrong source.
 *
 * The script is a browser IIFE with no exports, so this drives it through the same globals
 * the browser provides and asserts on what lands in localStorage.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'ad-tracking.js'),
    'utf8',
);

function makeStore() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        _map: map,
    };
}

/**
 * A minimal stand-in for a Netlify lead form.
 * @param {{valid?: boolean, values?: Record<string,string>}} opts
 */
function makeForm({ valid = true, values = {} } = {}) {
    const submitHandlers = [];
    return {
        name: 'contact',
        id: 'contact-form',
        checkValidity: () => valid,
        addEventListener(evt, fn) { if (evt === 'submit') submitHandlers.push(fn); },
        querySelector(sel) {
            const m = sel.match(/name="([^"]+)"/);
            const key = m && m[1];
            return key in values ? { value: values[key] } : null;
        },
        querySelectorAll: () => [],
        appendChild() {},
        closest: () => null,
        submit() { submitHandlers.forEach((fn) => fn({ target: this })); },
        get handlerCount() { return submitHandlers.length; },
    };
}

/** Run ad-tracking.js against a fake page. Returns the storage it wrote to. */
function visit({ search = '', pathname = '/', localStore, now, forms = [] }) {
    const local = localStore || makeStore();
    const session = makeStore();
    const dataLayer = [];
    const doc = {
        readyState: 'complete',
        body: { nodeType: 1 },
        addEventListener() {},
        createElement: () => ({ setAttribute() {} }),
        querySelectorAll: (sel) => (sel.includes('form') ? forms : []),
        referrer: '',
    };
    const win = { dataLayer, location: { search, pathname }, addEventListener() {} };

    const RealDate = Date;
    class FixedDate extends RealDate {
        constructor(...a) { super(...(a.length ? a : [now])); }
        static now() { return now; }
    }

    // eslint-disable-next-line no-new-func
    new Function(
        'window', 'document', 'localStorage', 'sessionStorage',
        'MutationObserver', 'Date', 'URLSearchParams',
        SRC,
    )(
        win, doc, local, session,
        class { observe() {} disconnect() {} },
        FixedDate, URLSearchParams,
    );

    return { local, session, dataLayer };
}

/** Run fn with console.warn muted — for cases that deliberately exercise the catch path. */
function quietly(fn) {
    const real = console.warn;
    console.warn = () => {};
    try { return fn(); } finally { console.warn = real; }
}

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_750_000_000_000;
const read = (local) => JSON.parse(local.getItem('penney_attr'));

// 1. First visit records both first and last touch.
{
    const { local } = visit({ search: '?utm_source=tiktok&utm_medium=paid_social', pathname: '/car-accidents', now: T0 });
    const rec = read(local);
    assert.equal(rec.first.utm_source, 'tiktok');
    assert.equal(rec.last.utm_source, 'tiktok');
    assert.equal(rec.first.landing_page, '/car-accidents');
    assert.equal(rec.first_ts, T0);
}

// 2. A later visit from a different source updates last-touch but PRESERVES first-touch.
{
    const { local } = visit({ search: '?utm_source=tiktok&utm_medium=paid_social', pathname: '/car-accidents', now: T0 });
    visit({ search: '?gclid=ABC123&utm_source=google', pathname: '/contact', localStore: local, now: T0 + 5 * DAY });
    const rec = read(local);
    assert.equal(rec.first.utm_source, 'tiktok', 'first-touch was overwritten — attribution lost');
    assert.equal(rec.first_ts, T0, 'first_ts moved');
    assert.equal(rec.last.utm_source, 'google');
    assert.equal(rec.last.gclid, 'ABC123');
}

// 3. Past the 90-day TTL, first-touch resets to the new source.
{
    const { local } = visit({ search: '?utm_source=tiktok', now: T0 });
    visit({ search: '?utm_source=google', localStore: local, now: T0 + 91 * DAY });
    const rec = read(local);
    assert.equal(rec.first.utm_source, 'google', 'expired first-touch should reset');
}

// 4. Just inside the TTL, first-touch still holds.
{
    const { local } = visit({ search: '?utm_source=tiktok', now: T0 });
    visit({ search: '?utm_source=google', localStore: local, now: T0 + 89 * DAY });
    assert.equal(read(local).first.utm_source, 'tiktok');
}

// 5. A visit with NO tracking params must not clobber a stored record.
{
    const { local } = visit({ search: '?utm_source=tiktok', now: T0 });
    visit({ search: '', pathname: '/about-us', localStore: local, now: T0 + DAY });
    const rec = read(local);
    assert.equal(rec.first.utm_source, 'tiktok');
    assert.equal(rec.last.utm_source, 'tiktok', 'an organic pageview overwrote last-touch');
}

// 6. Nothing is written when there was never a tracked visit.
{
    const { local } = visit({ search: '', now: T0 });
    assert.equal(local.getItem('penney_attr'), null);
}

// 7. New click IDs are captured.
for (const [param, value] of [['ttclid', 'TT123'], ['msclkid', 'MS456'], ['fbclid', 'FB789']]) {
    const { local } = visit({ search: `?${param}=${value}`, now: T0 });
    assert.equal(read(local).last[param], value, `${param} not captured`);
}

// 8. A corrupt record degrades to a fresh one instead of throwing.
{
    const local = makeStore();
    local.setItem('penney_attr', '{not json');
    const { local: after } = quietly(() =>
        visit({ search: '?utm_source=tiktok', localStore: local, now: T0 }));
    assert.equal(read(after).last.utm_source, 'tiktok');
}

// 14. A record untouched for longer than the retention window is deleted, not kept forever.
//     privacy-policy.html discloses 90 days, so this has to actually happen.
{
    const { local } = visit({ search: '?utm_source=tiktok', now: T0 });
    assert.ok(local.getItem('penney_attr'), 'sanity: record written');
    visit({ search: '', pathname: '/about-us', localStore: local, now: T0 + 91 * DAY });
    assert.equal(local.getItem('penney_attr'), null, 'stale record was not purged — disclosure would be false');
}

// 15. A VALID submit arms the conversion token and stashes Enhanced Conversions data.
{
    const form = makeForm({ valid: true, values: { email: 'A@B.com', phone: '(916) 555-1234', name: 'Jo Smith' } });
    const { session } = visit({ search: '', pathname: '/contact', now: T0, forms: [form] });
    assert.equal(form.handlerCount, 1, 'submit handler not attached on an organic page');
    form.submit();
    assert.equal(session.getItem('pending_conversion'), '1', 'organic visitor got no conversion token');
    const ec = JSON.parse(session.getItem('enhanced_conversion_data'));
    assert.equal(ec.email, 'a@b.com', 'email should be lowercased');
    assert.equal(ec.phone_number, '+19165551234', 'phone should be E.164');
    assert.deepEqual(ec.address, { first_name: 'Jo', last_name: 'Smith' });
}

// 16. An INVALID submit must NOT arm the token. js/form-validation.js preventDefault()s the
//     form, but that does not stop this listener, so the guard has to do it.
{
    const form = makeForm({ valid: false, values: { email: '', phone: '' } });
    const { session } = visit({ search: '', pathname: '/contact', now: T0, forms: [form] });
    form.submit();
    assert.equal(session.getItem('pending_conversion'), null,
        'a validation-failed attempt armed the conversion token');
    assert.equal(session.getItem('enhanced_conversion_data'), null);
}

// ---------------------------------------------------------------------------------------
// thank-you.html conversion gate. This is the whole conversion path: if it fires when it
// shouldn't, leads are over-counted; if it stops firing, every conversion silently vanishes.
// ---------------------------------------------------------------------------------------

const THANKYOU = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'thank-you.html'),
    'utf8',
);

/** Pull the trailing inline <script> (the conversion block) out of thank-you.html. */
function thankYouScript() {
    const blocks = [...THANKYOU.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const block = blocks.find((b) => b.includes('form_conversion'));
    assert.ok(block, 'could not find the form_conversion block in thank-you.html');
    return block;
}

/** Run that block against a fake page and return what reached the dataLayer. */
function loadThankYou({ token, ecData, ecRaw }) {
    const session = makeStore();
    if (token) session.setItem('pending_conversion', token);
    if (ecData) session.setItem('enhanced_conversion_data', JSON.stringify(ecData));
    if (ecRaw !== undefined) session.setItem('enhanced_conversion_data', ecRaw);

    const dataLayer = [];
    let domReady = null;
    const doc = {
        addEventListener(evt, fn) { if (evt === 'DOMContentLoaded') domReady = fn; },
    };
    const win = { dataLayer, location: { pathname: '/thank-you' } };

    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'sessionStorage', thankYouScript())(win, doc, session);

    assert.ok(domReady, 'conversion block must defer to DOMContentLoaded so the consent default is queued first');
    domReady();
    return { dataLayer: win.dataLayer, session };
}

// 9. No token (direct hit, refresh after consumption, bookmark) => no conversion.
{
    const { dataLayer } = loadThankYou({ token: null });
    assert.equal(dataLayer.length, 0, 'thank-you fired a conversion with no submission token');
}

// 10. Valid token => conversion fires once, token is consumed.
{
    const { dataLayer, session } = loadThankYou({ token: '1' });
    const events = dataLayer.filter((d) => d.event === 'form_conversion');
    assert.equal(events.length, 1);
    assert.equal(events[0].page_path, '/thank-you');
    assert.equal(session.getItem('pending_conversion'), null, 'token not consumed — a refresh would re-fire');
}

// 11. Enhanced Conversions data is pushed BEFORE the conversion event, and unhashed.
//     (GTM's Ads tag hashes client-side; hashing here too would break matching.)
{
    const ec = { email: 'a@b.com', phone_number: '+15551234567' };
    const { dataLayer, session } = loadThankYou({ token: '1', ecData: ec });
    const iUser = dataLayer.findIndex((d) => d.leadsUserData);
    const iConv = dataLayer.findIndex((d) => d.event === 'form_conversion');
    assert.ok(iUser !== -1, 'leadsUserData was not pushed');
    assert.ok(iUser < iConv, 'leadsUserData must precede the conversion event or EC has no data');
    assert.deepEqual(dataLayer[iUser].leadsUserData, ec, 'EC payload must be passed through unhashed');
    assert.equal(session.getItem('enhanced_conversion_data'), null, 'EC data not cleared');
}

// 12. A corrupt EC stash must not block the conversion — EC is a bonus, the lead is not.
{
    const { dataLayer } = loadThankYou({ token: '1', ecRaw: '{not json' });
    assert.equal(dataLayer.filter((d) => d.event === 'form_conversion').length, 1,
        'a corrupt enhanced-conversions stash swallowed the conversion');
    assert.equal(dataLayer.filter((d) => d.leadsUserData).length, 0);
}

// 13. End to end: a submit sets the token, so the very next thank-you load converts once
//     and a second load does not.
{
    const shared = makeStore();
    shared.setItem('pending_conversion', '1');
    const first = loadThankYou({ token: '1' });
    assert.equal(first.dataLayer.filter((d) => d.event === 'form_conversion').length, 1);
    const second = loadThankYou({ token: first.session.getItem('pending_conversion') });
    assert.equal(second.dataLayer.length, 0, 'refresh after a conversion re-fired it');
}

console.log('test-ad-tracking: all assertions passed');
