/**
 * Website form submissions to CaseBank, the firm's case management system (CaseBank's
 * src/integrations/website/form.ts). Every verified Netlify Forms submission is sent to
 * CASEBANK_FORMS_URL, signed X-CaseBank-Signature: sha256=<hex HMAC-SHA256(CASEBANK_FORMS_SECRET, body)>.
 * Netlify still keeps and emails its own copy, so a failure here never loses a lead: it's parked in
 * the `casebank` Blobs store and casebank-retry.js tries again every minute.
 *
 * Environment variables (Netlify Dashboard); with either missing nothing is sent:
 *   CASEBANK_FORMS_URL     https://casebank.penneylaw.com/api/webhooks/website
 *   CASEBANK_FORMS_SECRET  the same value as CaseBank's WebsiteFormsSecret
 */
const { createHmac } = require('crypto');

const STORE = 'casebank';
const MAX_ATTEMPTS = 5;
const configured = () => Boolean(process.env.CASEBANK_FORMS_URL && process.env.CASEBANK_FORMS_SECRET);

// The submission CaseBank stores: no visitor IP or browser string (it doesn't need them).
function bodyOf(payload) {
    const { ip, user_agent, ...data } = payload.data || {}; // eslint-disable-line no-unused-vars
    return JSON.stringify({ id: payload.id, form_name: payload.form_name, created_at: payload.created_at, data });
}

// Returns the HTTP status (0 when it couldn't connect); 2xx means CaseBank has it.
async function send(body) {
    const sig = 'sha256=' + createHmac('sha256', process.env.CASEBANK_FORMS_SECRET).update(body).digest('hex');
    try {
        const res = await fetch(process.env.CASEBANK_FORMS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CaseBank-Signature': sig },
            body,
            signal: AbortSignal.timeout(8000),
        });
        return res.status;
    } catch (err) {
        return 0;
    }
}

module.exports = { STORE, MAX_ATTEMPTS, configured, bodyOf, send };
