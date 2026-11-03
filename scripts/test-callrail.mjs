/**
 * Regression check for netlify/lib/callrail.js and the forwarding gate in netlify/lib/forward-lead.js.
 * Run: node scripts/test-callrail.mjs
 *
 * CallRail gets website form leads only from the server now, so these are the paths that decide
 * what it receives: the API body, the fallback when the API rejects a session id, and the
 * real-US-phone gate on everything forwarded.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.CALLRAIL_API_KEY = 'key';
process.env.CALLRAIL_ACCOUNT_ID = 'ACC1';
process.env.CALLRAIL_COMPANY_ID = 'COM1';
const callrail = require('../netlify/lib/callrail.js');
const { forwardLead, isUsPhone } = require('../netlify/lib/forward-lead.js');

const submission = (data, extra = {}) => ({ id: 's1', form_name: 'contact', data, ...extra });

// 1. API body: labelled fields, plumbing dropped, session id passed through, URLs on our site.
{
    const { form_submission: b } = callrail.bodyOf(submission({
        name: 'Jane Doe', phone: '(916) 287-0100', message: 'Rear-ended on I-80',
        subject: 'New Lead: Jane Doe', 'bot-field': '', ip: '1.2.3.4', callrail_session: 'abc-123',
        referrer: 'https://penneylaw.com/contact', landing_page: '/?utm_source=google', utm_source: 'google',
    }, {
        ordered_human_fields: [
            { title: 'Full Name', name: 'name', value: 'Jane Doe' },
            { title: 'Phone Number', name: 'phone', value: '(916) 287-0100' },
            { title: 'Subject', name: 'subject', value: 'New Lead: Jane Doe' },
            { title: 'Callrail Session', name: 'callrail_session', value: 'abc-123' },
        ],
    }));
    assert.equal(b.company_id, 'COM1');
    assert.equal(b.session_id, 'abc-123');
    assert.deepEqual(b.form_data, { 'Full Name': 'Jane Doe', 'Phone Number': '(916) 287-0100' });
    assert.equal(b.form_url, 'https://penneylaw.com/contact');
    assert.equal(b.landing_page_url, 'https://penneylaw.com/?utm_source=google');
    assert.equal(b.referring_url, '');
}

// 2. If CallRail rejects the session id, the lead is sent again without it.
{
    const calls = [];
    globalThis.fetch = async (url, opts) => {
        calls.push(JSON.parse(opts.body).form_submission);
        return { status: calls.length === 1 ? 422 : 201 };
    };
    const status = await callrail.send(callrail.bodyOf(submission({ name: 'Jane', callrail_session: 'bad' })));
    assert.equal(status, 201);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].session_id, 'bad');
    assert.ok(!('session_id' in calls[1]), 'retry still carried the rejected session id');
}

// 3. Only a real US phone number is forwarded: the +7 bot and the 555 crawler never reach CallRail.
{
    const sent = [];
    globalThis.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body).form_submission.form_data); return { status: 201 }; };
    const lead = (phone) => submission({ name: 'Jane Doe', phone, message: 'hi' });
    await forwardLead({}, lead('+79990000000'));
    await forwardLead({}, lead('(650) 555-0199'));
    await forwardLead({}, lead('(116) 287-0100'));
    assert.equal(sent.length, 0, 'a non-US or fictional number reached CallRail');
    await forwardLead({}, lead('+1 (916) 287-0100'));
    assert.equal(sent.length, 1, 'a real US number was not forwarded');
    assert.ok(isUsPhone('916-287-0100') && !isUsPhone('79990000000') && !isUsPhone(''));
}

console.log('test-callrail: all assertions passed');
