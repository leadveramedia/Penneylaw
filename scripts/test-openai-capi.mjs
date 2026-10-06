/**
 * Regression check for netlify/functions/submission-created.js (OpenAI Conversions API).
 * Run: node scripts/test-openai-capi.mjs
 *
 * Covers what fails silently in production: a lead OpenAI must not receive getting sent
 * (intake forms, opt-outs, Google lead-form posts), and hashes that don't match the pixel's,
 * which turns one lead into two unmatched ones.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const { handler } = createRequire(import.meta.url)('../netlify/functions/submission-created.js');
const sha = (s) => createHash('sha256').update(s).digest('hex');

let calls = [];
globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, text: async () => '{}' };
};
console.info = () => {};

const submit = (data, extra = {}) =>
    handler({ body: JSON.stringify({ payload: { form_name: 'contact', data, ...extra } }) });

process.env.OPENAI_PIXEL_ID = 'PIX';
process.env.OPENAI_CAPI_KEY = 'KEY';

// 1. No conversion_event_id (intake forms, opt-outs, Google Ads lead-form posts) => nothing sent.
calls = [];
assert.equal((await submit({ email: 'a@b.com', conversion_event_id: '' })).statusCode, 200);
await submit({ email: 'a@b.com' });
await handler({ body: 'not json' });
assert.equal(calls.length, 0, 'sent a lead that carried no conversion_event_id');

// 2. Unconfigured => nothing sent, and no error.
calls = [];
delete process.env.OPENAI_CAPI_KEY;
await submit({ email: 'a@b.com', conversion_event_id: 'e1' });
assert.equal(calls.length, 0);
process.env.OPENAI_CAPI_KEY = 'KEY';

// 3. A real lead: endpoint, auth, event shape, normalized hashes, passthroughs.
calls = [];
await submit({
    email: ' A@B.com ', phone: '(916) 555-1234', name: ' Jo  Van Smith ',
    conversion_event_id: 'e1', oppref: 'OP1', ip: '1.2.3.4', user_agent: 'UA',
    referrer: 'https://penneylaw.com/contact', message: 'I broke my leg',
}, { created_at: '2026-10-06T12:00:00.000Z' });
assert.equal(calls.length, 1);
const { url, opts, body } = calls[0];
assert.equal(url, 'https://bzr.openai.com/v1/events?pid=PIX');
assert.equal(opts.headers.Authorization, 'Bearer KEY');
const ev = body.events[0];
assert.equal(ev.id, 'e1', 'id must equal the pixel event_id or OpenAI double counts');
assert.equal(ev.type, 'lead_created');
assert.equal(ev.action_source, 'web');
assert.equal(ev.timestamp_ms, Date.parse('2026-10-06T12:00:00.000Z'));
assert.equal(ev.source_url, 'https://penneylaw.com/contact');
assert.equal(ev.oppref, 'OP1');
assert.deepEqual(ev.data, { type: 'customer_action' });
assert.deepEqual(ev.user, {
    emails_sha256: [sha('a@b.com')],
    phone_numbers_sha256: [sha('19165551234')],   // matches the pixel's +1 E.164 digits
    first_names_sha256: [sha('jo')],
    last_names_sha256: [sha('vansmith')],
    ip_address: '1.2.3.4',
    user_agent: 'UA',
});
assert.ok(!opts.body.includes('broke my leg'), 'case details must never leave the site');
assert.ok(!opts.body.includes('a@b.com') && !opts.body.includes('555-1234'), 'raw contact data sent');

// 4. Missing optional fields degrade cleanly.
calls = [];
await submit({ email: 'a@b.com', phone: '12', conversion_event_id: 'e2', referrer: 'javascript:x' });
const ev2 = calls[0].body.events[0];
assert.equal(ev2.source_url, 'https://penneylaw.com/');
assert.equal(ev2.oppref, undefined);
assert.equal(ev2.user.phone_numbers_sha256, undefined, 'a too-short phone should be dropped, not hashed');
assert.ok(Number.isFinite(ev2.timestamp_ms));

// 5. A network failure must not throw — the submission is already saved by Netlify.
globalThis.fetch = async () => { throw new Error('offline'); };
console.error = () => {};
assert.equal((await submit({ email: 'a@b.com', conversion_event_id: 'e3' })).statusCode, 200);

console.log('test-openai-capi: all assertions passed');
