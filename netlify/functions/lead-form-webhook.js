/**
 * Netlify Function: Google Ads Lead Form Webhook
 *
 * Receives lead submissions from Google Ads Lead Form Assets, verifies the
 * SHA-256 signature Google attaches to every payload, and durably stores the
 * lead in a Netlify Blobs store. Forwarding to the Netlify Forms inbox is
 * handled asynchronously by lead-form-worker.js (scheduled cron, every 1 min).
 *
 * Spec: ../../webhook-spec-lead-form.md
 * Endpoint: POST https://penneylaw.com/api/lead-form-webhook
 *   (rewritten via netlify.toml redirect to /.netlify/functions/lead-form-webhook)
 *
 * Environment variables required (set in Netlify Dashboard):
 *   GOOGLE_LEAD_FORM_KEY  HMAC secret shared with Google Ads asset.
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
    const signature = body.lead_id_signature;

    // Google Ads "Preview" / test-mode pings include "is_test": true and omit
    // lead_id_signature. Acknowledge with 200 so Roger's Preview tool succeeds,
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

    if (!leadId || !signature) {
        console.warn(JSON.stringify({
            event: 'lead_form.missing_fields',
            has_lead_id: !!leadId,
            has_signature: !!signature,
            latency_ms: Date.now() - start
        }));
        return { statusCode: 400, body: '' };
    }

    if (!verifySignature(leadId, signature, googleKey)) {
        console.warn(JSON.stringify({
            event: 'lead_form.hmac_fail',
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
 * Verify Google's signature: base64(SHA256(lead_id + google_key)).
 * Constant-time compare to avoid timing oracle.
 */
function verifySignature(leadId, providedSignature, googleKey) {
    const expected = crypto
        .createHash('sha256')
        .update(leadId + googleKey)
        .digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(providedSignature);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}
