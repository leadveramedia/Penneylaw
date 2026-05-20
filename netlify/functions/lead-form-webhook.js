/**
 * Netlify Function: Google Ads Lead Form Webhook
 *
 * Receives lead submissions from Google Ads Lead Form Assets, authenticates
 * the request by comparing the `google_key` field in the body to our stored
 * copy of the same secret, and durably stores the lead in a Netlify Blobs
 * store. Forwarding to the Netlify Forms inbox is handled asynchronously by
 * lead-form-worker.js (scheduled cron, every 1 min).
 *
 * Spec: ../../webhook-spec-lead-form.md
 * Endpoint: POST https://penneylaw.com/api/lead-form-webhook
 *   (rewritten via netlify.toml redirect to /.netlify/functions/lead-form-webhook)
 *
 * Environment variables required (set in Netlify Dashboard):
 *   GOOGLE_LEAD_FORM_KEY  Shared secret. Same value must be set in the
 *                         Google Ads Lead Form asset configuration so Google
 *                         echoes it back in the request body's `google_key`.
 *
 * Time budget: must respond within 5s. Practical p99 target <500ms.
 */

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'lead-form';

exports.handler = async (event) => {
    const start = Date.now();

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: '' };
    }

    const googleKey = process.env.GOOGLE_LEAD_FORM_KEY;
    if (!googleKey) {
        console.error(JSON.stringify({ event: 'lead_form.misconfigured', reason: 'GOOGLE_LEAD_FORM_KEY unset' }));
        // Return 500 so Google retries — gives ops time to fix the secret.
        return { statusCode: 500, body: '' };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        console.warn(JSON.stringify({ event: 'lead_form.malformed_json', latency_ms: Date.now() - start }));
        return { statusCode: 400, body: '' };
    }

    const leadId = body.lead_id;
    const providedKey = body.google_key;

    // Google Ads "Preview" / test-mode pings include "is_test": true and may
    // omit google_key. Acknowledge with 200 so Roger's Preview tool succeeds,
    // but don't persist (avoids cluttering Netlify Forms with test data).
    if (body.is_test === true) {
        console.info(JSON.stringify({
            event: 'lead_form.test_ping',
            lead_id: leadId,
            campaign_id: body.campaign_id,
            ad_id: body.ad_id,
            latency_ms: Date.now() - start
        }));
        return { statusCode: 200, body: '' };
    }

    if (!leadId || !providedKey) {
        console.warn(JSON.stringify({
            event: 'lead_form.missing_fields',
            has_lead_id: !!leadId,
            has_google_key: !!providedKey,
            latency_ms: Date.now() - start
        }));
        return { statusCode: 400, body: '' };
    }

    if (!constantTimeEquals(providedKey, googleKey)) {
        console.warn(JSON.stringify({
            event: 'lead_form.key_mismatch',
            lead_id: leadId,
            campaign_id: body.campaign_id,
            ad_id: body.ad_id,
            latency_ms: Date.now() - start
        }));
        return { statusCode: 401, body: '' };
    }

    try {
        const store = getStore({ name: STORE_NAME, consistency: 'strong' });
        const key = `inbox/${leadId}.json`;

        // Idempotency: if the blob already exists, this is a Google retry.
        // Silently dedupe and return 200 so Google stops retrying.
        const existing = await store.getMetadata(key);
        if (existing) {
            console.info(JSON.stringify({
                event: 'lead_form.received',
                lead_id: leadId,
                campaign_id: body.campaign_id,
                adgroup_id: body.adgroup_id,
                ad_id: body.ad_id,
                hmac: 'pass',
                outcome: 'dedup',
                latency_ms: Date.now() - start
            }));
            return { statusCode: 200, body: '' };
        }

        await store.setJSON(key, {
            payload: body,
            status: 'pending',
            attempts: 0,
            received_at: new Date().toISOString(),
            last_attempt_at: null
        });

        console.info(JSON.stringify({
            event: 'lead_form.received',
            lead_id: leadId,
            campaign_id: body.campaign_id,
            adgroup_id: body.adgroup_id,
            ad_id: body.ad_id,
            hmac: 'pass',
            outcome: 'inserted',
            latency_ms: Date.now() - start
        }));
        return { statusCode: 200, body: '' };
    } catch (err) {
        console.error(JSON.stringify({
            event: 'lead_form.persist_error',
            lead_id: leadId,
            error: err.message,
            latency_ms: Date.now() - start
        }));
        // 500 → Google retries. Better duplicates (which we dedupe) than dropped leads.
        return { statusCode: 500, body: '' };
    }
};

/**
 * Constant-time string comparison. Use for any auth-secret check so we don't
 * leak length / prefix info via response timing.
 */
function constantTimeEquals(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
}
