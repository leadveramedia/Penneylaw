/**
 * Netlify Scheduled Function: Lead Form Worker
 *
 * Runs every minute. Picks up pending leads from the lead-form Blobs store
 * (written by lead-form-webhook.js), reshapes them into a Netlify Forms
 * server-to-server submission, and forwards. The existing Netlify Forms
 * email-notification plumbing then alerts the firm's intake.
 *
 * Spec: ../../webhook-spec-lead-form.md
 *
 * Schedule: every 1 minute (configured via the exported `config.schedule`).
 *
 * Behaviour:
 *   - inbox/<lead_id>.json     pending lead, awaiting forwarding
 *   - forwarded/<lead_id>.json delivered to Netlify Forms (audit trail)
 *   - dlq/<lead_id>.json       failed 3+ times, manual review
 */

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'lead-form';
const FORM_NAME = 'google-ads-lead';
// Netlify Forms accepts S2S POSTs to any page that hosts the static form.
const FORM_POST_URL = 'https://penneylaw.com/netlify-form-template.html';
const MAX_ATTEMPTS = 3;
const PER_LEAD_TIMEOUT_MS = 10_000;

exports.handler = async () => {
    const startedAt = Date.now();
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });

    let inboxList;
    try {
        inboxList = await store.list({ prefix: 'inbox/' });
    } catch (err) {
        console.error(JSON.stringify({ event: 'lead_form.worker.list_error', error: err.message }));
        return { statusCode: 500, body: '' };
    }

    const blobs = inboxList.blobs || [];
    if (blobs.length === 0) {
        console.info(JSON.stringify({ event: 'lead_form.worker.no_pending' }));
        return { statusCode: 200, body: '' };
    }

    let forwarded = 0;
    let retried = 0;
    let dlq = 0;

    for (const blob of blobs) {
        const key = blob.key; // e.g. "inbox/abc123.json"
        const leadId = key.replace(/^inbox\//, '').replace(/\.json$/, '');

        let record;
        try {
            record = await store.get(key, { type: 'json' });
        } catch (err) {
            console.error(JSON.stringify({ event: 'lead_form.worker.read_error', lead_id: leadId, error: err.message }));
            continue;
        }
        if (!record || !record.payload) continue;
        if (record.status === 'forwarded') continue; // Defensive

        const formBody = buildFormBody(record.payload);
        const ok = await postWithTimeout(FORM_POST_URL, formBody, PER_LEAD_TIMEOUT_MS);
        const attempts = (record.attempts || 0) + 1;

        if (ok) {
            await store.setJSON(`forwarded/${leadId}.json`, {
                ...record,
                status: 'forwarded',
                attempts,
                last_attempt_at: new Date().toISOString(),
                forwarded_at: new Date().toISOString()
            });
            await store.delete(key);
            forwarded += 1;
            console.info(JSON.stringify({
                event: 'lead_form.worker.forwarded',
                lead_id: leadId,
                attempts
            }));
            continue;
        }

        if (attempts >= MAX_ATTEMPTS) {
            await store.setJSON(`dlq/${leadId}.json`, {
                ...record,
                status: 'dlq',
                attempts,
                last_attempt_at: new Date().toISOString()
            });
            await store.delete(key);
            dlq += 1;
            console.error(JSON.stringify({
                event: 'lead_form.worker.dlq',
                lead_id: leadId,
                attempts,
                form_post_url: FORM_POST_URL
            }));
            continue;
        }

        await store.setJSON(key, {
            ...record,
            status: 'pending',
            attempts,
            last_attempt_at: new Date().toISOString()
        });
        retried += 1;
        console.warn(JSON.stringify({
            event: 'lead_form.worker.retry',
            lead_id: leadId,
            attempts
        }));
    }

    console.info(JSON.stringify({
        event: 'lead_form.worker.batch_done',
        scanned: blobs.length,
        forwarded,
        retried,
        dlq,
        latency_ms: Date.now() - startedAt
    }));
    return { statusCode: 200, body: '' };
};

// Netlify reads this to schedule the function. "* * * * *" = every minute.
exports.config = {
    schedule: '* * * * *'
};

/**
 * Convert a Google Ads Lead Form payload into a URL-encoded body
 * compatible with Netlify Forms server-to-server submission.
 *
 * Standard columns (FULL_NAME / PHONE_NUMBER / EMAIL) have stable column_ids.
 * Custom-question column_ids vary per asset (e.g. Google may emit
 * "when_did_this_incident_occur?" vs the spec's "When did the accident happen?")
 * so we keyword-match across both column_id and column_name. Anything we don't
 * recognize is preserved verbatim in the `all_answers` field so no data is lost.
 */
function buildFormBody(payload) {
    const params = new URLSearchParams();
    params.set('form-name', FORM_NAME);

    const cols = Array.isArray(payload.user_column_data) ? payload.user_column_data : [];

    // Standard fields by stable column_id
    const stdById = {};
    for (const c of cols) {
        if (c.column_id) stdById[c.column_id] = c.string_value || '';
    }
    params.set('name', stdById.FULL_NAME || '');
    params.set('phone', stdById.PHONE_NUMBER || '');
    params.set('email', stdById.EMAIL || '');

    // Custom questions: fuzzy keyword match across column_id + column_name.
    params.set('accident_when', findColumn(cols, ['when']));
    params.set('accident_type', findColumn(cols, ['type', 'accident']));
    params.set('injured', findColumn(cols, ['injur']));

    // Fallback / archive: every non-standard answer, formatted for human reading.
    const STD = new Set(['FULL_NAME', 'PHONE_NUMBER', 'EMAIL']);
    const allAnswers = cols
        .filter(c => !STD.has(c.column_id))
        .map(c => `${c.column_name || c.column_id || '?'}: ${c.string_value || ''}`)
        .join('\n');
    params.set('all_answers', allAnswers);

    params.set('lead_id', payload.lead_id || '');
    params.set('campaign_id', String(payload.campaign_id || ''));
    params.set('ad_id', String(payload.ad_id || ''));
    params.set('gcl_id', payload.gcl_id || '');
    params.set('source', 'Google Ads Lead Form');

    return params.toString();
}

/**
 * Find the first column whose column_id OR column_name (lowercased) contains
 * ALL of the given keyword substrings. Returns the string_value or ''.
 */
function findColumn(cols, keywords) {
    for (const c of cols) {
        const haystack = ((c.column_id || '') + ' ' + (c.column_name || '')).toLowerCase();
        if (keywords.every(k => haystack.includes(k))) {
            return c.string_value || '';
        }
    }
    return '';
}

/**
 * POST URL-encoded body to a Netlify Forms endpoint with a hard timeout.
 * Returns true on 2xx, false otherwise.
 */
async function postWithTimeout(url, body, timeoutMs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            signal: controller.signal
        });
        return res.ok;
    } catch (e) {
        return false;
    } finally {
        clearTimeout(t);
    }
}
