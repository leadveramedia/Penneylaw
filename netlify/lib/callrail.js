/**
 * Website form leads to CallRail, sent from the server once Netlify has accepted them.
 * CallRail's own in-browser form capture is switched off on our forms
 * (js/ad-tracking.js): it sent whatever a browser submitted before Netlify's honeypot or spam filter
 * saw it, so a form-testing crawler that never completed the post still landed in CallRail as leads.
 *
 * API: POST /v3/a/{account}/form_submissions.json (apidocs.callrail.com, "Creating a form
 * submission"). `session_id` ties the lead to the visitor's CallRail session, which carries the
 * source and keywords; js/ad-tracking.js copies it from CallRail's `calltrk_session_id` cookie into
 * the form's `callrail_session` field.
 *
 * Environment variables (Netlify Dashboard); with any missing nothing is sent:
 *   CALLRAIL_API_KEY      CallRail API key
 *   CALLRAIL_ACCOUNT_ID   the account id the API uses (the id in app.callrail.com/a/<id>/...)
 *   CALLRAIL_COMPANY_ID   the company id the API uses for penneylaw.com
 */
const SITE = 'https://penneylaw.com';

// Not lead content: spam trap, our own plumbing, and the visitor's IP / browser string.
const INTERNAL = new Set(['bot-field', 'subject', 'conversion_event_id', 'oppref', 'callrail_session', 'ip', 'user_agent']);

const configured = () => Boolean(process.env.CALLRAIL_API_KEY && process.env.CALLRAIL_ACCOUNT_ID && process.env.CALLRAIL_COMPANY_ID);

/** The API body for a Netlify submission (submission-created payload or Netlify API object). */
function bodyOf(payload) {
    const d = payload.data || {};
    // Labelled fields read like the old browser capture ("Full Name": ...); fall back to raw names.
    const fields = payload.ordered_human_fields || Object.entries(d).map(([name, value]) => ({ title: name, name, value }));
    const formData = {};
    for (const f of fields) {
        if (!INTERNAL.has(f.name) && f.value !== '' && f.value != null) formData[f.title || f.name] = f.value;
    }
    const ownPage = (u) => /^https:\/\/(www\.)?penneylaw\.com\//.test(u || '');
    const formUrl = ownPage(d.referrer) ? d.referrer : `${SITE}/`;
    const external = /^https?:\/\//.test(d.referrer || '') && !ownPage(d.referrer) ? d.referrer : '';
    const body = {
        company_id: process.env.CALLRAIL_COMPANY_ID,
        referrer: external ? new URL(external).hostname : (d.utm_source || 'direct'),
        referring_url: external,
        landing_page_url: /^\//.test(d.landing_page || '') ? SITE + d.landing_page : formUrl,
        form_url: formUrl,
        form_data: formData,
    };
    if (d.callrail_session) body.session_id = d.callrail_session;
    return { form_submission: body };
}

// Returns the HTTP status (0 when it couldn't connect); 2xx means CallRail has it.
async function send(body) {
    const url = `https://api.callrail.com/v3/a/${encodeURIComponent(process.env.CALLRAIL_ACCOUNT_ID)}/form_submissions.json`;
    const post = (b) => fetch(url, {
        method: 'POST',
        headers: { Authorization: `Token token=${process.env.CALLRAIL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(b),
        signal: AbortSignal.timeout(8000),
    }).then((r) => r.status, () => 0);
    let status = await post(body);
    // The session id comes from CallRail's own cookie, but if the API won't take it, the lead
    // matters more than its attribution: send it again without.
    if (status >= 400 && status < 500 && body.form_submission.session_id) {
        const { session_id, ...rest } = body.form_submission; // eslint-disable-line no-unused-vars
        status = await post({ form_submission: rest });
    }
    return status;
}

module.exports = { configured, bodyOf, send };
