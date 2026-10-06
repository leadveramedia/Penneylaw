/**
 * Netlify event-triggered function: Netlify runs `submission-created` on every VERIFIED
 * (non-spam) Netlify Forms submission. The file name is what registers it.
 *
 * Sends website leads to the OpenAI (ChatGPT ads) Conversions API as `lead_created`, so a lead
 * still counts when the browser pixel is blocked. OpenAI dedupes it against the pixel's lead
 * event (GTM "OpenAI Pixel - Lead", fix f8) by the shared conversion_event_id.
 *
 * Only submissions whose `conversion_event_id` field js/ad-tracking.js filled are sent. It
 * leaves that field empty for the mass tort intake forms (data-no-enhanced-conversions) and
 * for visitors who opted out (penney_consent denied, or GPC); the Google Ads lead-form S2S
 * posts (lead-form-worker.js) never carry it. All of those are skipped here.
 *
 * Contact details leave this function only as SHA-256 hashes; case details never do.
 *
 * Environment variables (Netlify Dashboard), both required or nothing is sent:
 *   OPENAI_PIXEL_ID   Pixel ID from ChatGPT Ads Manager -> Conversions
 *   OPENAI_CAPI_KEY   Conversions API key from the same page. Server-side only.
 */

const { createHash } = require('crypto');

const ENDPOINT = 'https://bzr.openai.com/v1/events';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// OpenAI's name normalization: lowercase, drop whitespace and ASCII punctuation.
const normName = (s) => s.toLowerCase().replace(/[\s!-/:-@[-`{-~]/g, '');

/**
 * Hashed identity in OpenAI's Conversions API shape. Normalization must match the GTM pixel
 * tag (scripts/gtm-apply.mjs openAiLeadJs), which hashes the same lead from leadsUserData.
 */
function buildUser(d) {
    const user = {};

    const email = String(d.email || '').trim().toLowerCase();
    if (email) user.emails_sha256 = [sha256(email)];

    // Same E.164 shaping as ad-tracking.js extractLeadsUserData (10 digits => +1), then
    // OpenAI's rule: digits only, no leading + or zeroes, 8-15 digits.
    let digits = String(d.phone || '').replace(/\D/g, '');
    if (digits.length === 10) digits = '1' + digits;
    digits = digits.replace(/^0+/, '');
    if (digits.length >= 8 && digits.length <= 15) user.phone_numbers_sha256 = [sha256(digits)];

    // Split like extractLeadsUserData: first word, then the rest as the last name.
    const parts = String(d.name || '').trim().split(/\s+/);
    const first = normName(parts.shift() || '');
    const last = normName(parts.join(''));
    if (first) user.first_names_sha256 = [sha256(first)];
    if (last) user.last_names_sha256 = [sha256(last)];

    if (d.ip) user.ip_address = d.ip;
    if (d.user_agent) user.user_agent = d.user_agent;
    return user;
}

exports.handler = async (event) => {
    const pid = process.env.OPENAI_PIXEL_ID;
    const key = process.env.OPENAI_CAPI_KEY;

    let payload = {};
    try {
        payload = JSON.parse(event.body || '{}').payload || {};
    } catch (e) { /* not a form event — nothing to send */ }
    const d = payload.data || {};

    if (!d.conversion_event_id || !pid || !key) {
        return { statusCode: 200, body: '' };
    }

    const ev = {
        id: d.conversion_event_id,
        type: 'lead_created',
        timestamp_ms: Date.parse(payload.created_at) || Date.now(),
        action_source: 'web',
        source_url: /^https?:\/\//.test(d.referrer || '') ? d.referrer : 'https://penneylaw.com/',
        user: buildUser(d),
        data: { type: 'customer_action' },
    };
    if (d.oppref) ev.oppref = d.oppref;

    try {
        const res = await fetch(`${ENDPOINT}?pid=${encodeURIComponent(pid)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ events: [ev] }),
            signal: AbortSignal.timeout(8000),
        });
        const text = await res.text();
        const log = res.ok ? console.info : console.error;
        log(JSON.stringify({
            event: 'openai_capi.sent',
            status: res.status,
            form: payload.form_name,
            has_oppref: Boolean(d.oppref),
            response: text.slice(0, 300),
        }));
    } catch (err) {
        console.error(JSON.stringify({ event: 'openai_capi.error', form: payload.form_name, error: err.message }));
    }

    // The submission is already stored and emailed by Netlify; nothing here can affect it.
    return { statusCode: 200, body: '' };
};
