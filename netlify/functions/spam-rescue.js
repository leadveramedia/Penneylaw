/**
 * Netlify Scheduled Function (every 5 minutes, netlify.toml): real leads out of Netlify's spam folder.
 *
 * Netlify filters every form submission through Akismet, which can't be turned off or tuned, and it
 * flags about half of real website leads: 15-31 Oct 2026, 40 accepted against 40 flagged, and 38 of
 * the flagged had a valid phone and no links. A flagged submission sends no email and never runs
 * submission-created, so without this it never reaches CaseBank or CallRail.
 *
 * A flagged submission is forwarded exactly as submission-created would (netlify/lib/forward-lead.js)
 * when it looks like a person: a name, a 10-11 digit phone outside the fictional 555 exchange, and no
 * links in what they typed. It stays in Netlify's spam folder; `rescued/<id>` in the `spam-rescue`
 * Blobs store keeps it from being sent twice. Only the last 2 hours are considered, so the backlog
 * from before this shipped (which CallRail already has from its browser capture) isn't re-sent.
 *
 * Environment variable (Netlify Dashboard); without it nothing runs:
 *   NETLIFY_API_TOKEN   a Netlify personal access token, to list the site's spam submissions
 */
const { getStore, connectLambda } = require('@netlify/blobs');
const { forwardLead } = require('../lib/forward-lead');

const SITE_ID = process.env.SITE_ID || 'c401235f-6cfb-42e2-b7e5-ca6c77bceab4';
const WINDOW_MS = 2 * 60 * 60 * 1000;

function looksLikeAPerson(sub) {
    const d = sub.data || {};
    const digits = String(d.phone || '').replace(/\D/g, '');
    const phoneOk = digits.length >= 10 && digits.length <= 11 && digits.slice(-7, -4) !== '555';
    const typed = [d.name, d.email, d.message].map((v) => String(v || ''));
    const hasLink = typed.some((v) => /https?:\/\/|www\./i.test(v));
    return Boolean(String(d.name || '').trim()) && phoneOk && !hasLink && !d['bot-field'];
}

exports.handler = async (event) => {
    const token = process.env.NETLIFY_API_TOKEN;
    if (!token) return { statusCode: 200, body: '' };
    try {
        connectLambda(event);
    } catch (err) {
        console.error(JSON.stringify({ event: 'spam_rescue.connect_lambda_fail', error: err.message }));
        return { statusCode: 500, body: '' };
    }

    let subs;
    try {
        const res = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/submissions?state=spam&per_page=100`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        subs = await res.json();
    } catch (err) {
        console.error(JSON.stringify({ event: 'spam_rescue.list_failed', error: err.message }));
        return { statusCode: 500, body: '' };
    }

    const store = getStore({ name: 'spam-rescue' });
    const since = Date.now() - WINDOW_MS;
    for (const sub of subs) {
        if (sub.form_name === 'google-ads-lead' || Date.parse(sub.created_at) < since || !looksLikeAPerson(sub)) continue;
        const key = `rescued/${sub.id}.json`;
        if (await store.getMetadata(key)) continue;
        // Marked before sending: a crash mid-send must not resend it every 5 minutes.
        await store.setJSON(key, { form: sub.form_name, created_at: sub.created_at, rescued_at: new Date().toISOString() });
        await forwardLead(event, sub);
        console.info(JSON.stringify({ event: 'spam_rescue.forwarded', form: sub.form_name, id: sub.id }));
    }
    return { statusCode: 200, body: '' };
};

exports.looksLikeAPerson = looksLikeAPerson;
