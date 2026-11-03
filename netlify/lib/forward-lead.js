/**
 * A website lead to the systems intake works from: CaseBank and CallRail. Called by
 * submission-created.js for every submission Netlify accepts, and by spam-rescue.js for real leads
 * Netlify's spam filter flagged. Never throws: Netlify keeps its own copy either way.
 *
 * Google Ads lead forms are skipped: CaseBank gets those straight from Google, and they were never
 * CallRail form leads.
 */
const { getStore, connectLambda } = require('@netlify/blobs');
const casebank = require('./casebank');
const callrail = require('./callrail');

// Into CaseBank's Triage. A failed send is parked in Blobs and retried every minute by casebank-retry.js.
async function toCaseBank(event, payload) {
    if (!casebank.configured()) return;
    const body = casebank.bodyOf(payload);
    const status = await casebank.send(body);
    if (status >= 200 && status < 300) {
        console.info(JSON.stringify({ event: 'casebank.sent', form: payload.form_name }));
        return;
    }
    try {
        connectLambda(event);
        await getStore({ name: casebank.STORE }).setJSON(`pending/${payload.id}.json`, { body, attempts: 1, last_status: status });
        console.warn(JSON.stringify({ event: 'casebank.parked', form: payload.form_name, status }));
    } catch (err) {
        console.error(JSON.stringify({ event: 'casebank.park_failed', form: payload.form_name, status, error: err.message }));
    }
}

// ponytail: no retry queue for CallRail; the lead is already in Netlify and CaseBank. Add one like
// casebank-retry.js if `callrail.failed` shows up in the function logs.
async function toCallRail(payload) {
    if (!callrail.configured()) return;
    const status = await callrail.send(callrail.bodyOf(payload));
    const ok = status >= 200 && status < 300;
    (ok ? console.info : console.error)(JSON.stringify({ event: ok ? 'callrail.sent' : 'callrail.failed', form: payload.form_name, status }));
}

async function forwardLead(event, payload) {
    if (!payload.id || payload.form_name === 'google-ads-lead') return;
    await toCaseBank(event, payload);
    await toCallRail(payload);
}

module.exports = { forwardLead };
