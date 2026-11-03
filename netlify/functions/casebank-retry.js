/**
 * Netlify Scheduled Function (every minute, netlify.toml): website form submissions CaseBank didn't
 * take the first time (submission-created.js parked them in the `casebank` Blobs store). Each is sent
 * again until CaseBank answers 2xx; after MAX_ATTEMPTS it moves to dlq/ for a person to look at
 * (Netlify's own Forms inbox and email still have the submission).
 *
 *   pending/<submission id>.json   { body, attempts, last_status }
 *   dlq/<submission id>.json       gave up
 */
const { getStore, connectLambda } = require('@netlify/blobs');
const { STORE, MAX_ATTEMPTS, configured, send } = require('../lib/casebank');

exports.handler = async (event) => {
    if (!configured()) return { statusCode: 200, body: '' };
    try {
        connectLambda(event);
    } catch (err) {
        console.error(JSON.stringify({ event: 'casebank.retry.connect_lambda_fail', error: err.message }));
        return { statusCode: 500, body: '' };
    }
    const store = getStore({ name: STORE });
    const { blobs = [] } = await store.list({ prefix: 'pending/' });
    for (const blob of blobs) {
        const id = blob.key.replace(/^pending\//, '').replace(/\.json$/, '');
        const record = await store.get(blob.key, { type: 'json' }).catch(() => null);
        if (!record || !record.body) continue;
        const status = await send(record.body);
        const attempts = (record.attempts || 0) + 1;
        if (status >= 200 && status < 300) {
            await store.delete(blob.key);
            console.info(JSON.stringify({ event: 'casebank.retry.sent', id, attempts }));
        } else if (attempts >= MAX_ATTEMPTS) {
            await store.setJSON(`dlq/${id}.json`, { ...record, attempts, last_status: status });
            await store.delete(blob.key);
            console.error(JSON.stringify({ event: 'casebank.retry.dlq', id, attempts, status }));
        } else {
            await store.setJSON(blob.key, { ...record, attempts, last_status: status });
            console.warn(JSON.stringify({ event: 'casebank.retry.again', id, attempts, status }));
        }
    }
    return { statusCode: 200, body: '' };
};
