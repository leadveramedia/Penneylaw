#!/usr/bin/env node
// Checks the job page build-careers.js renders: Google's JobPosting fields, escaping, validation.
const assert = require('assert');
const { renderJob } = require('./build-careers.js');

const job = {
    slug: 'test-paralegal',
    title: 'Paralegal <b>',
    office: 'roseville',
    remote: true,
    employmentType: 'FULL_TIME',
    datePosted: '2026-11-23',
    salary: { min: 60000, max: 80000, unit: 'YEAR' },
    summary: 'A summary.',
    intro: ['Hello & **welcome**.'],
    sections: [
        { heading: 'Why', items: ['**Lead.** Then text.'] },
        { heading: 'Perks', layout: 'cards', items: ['**Card title.** Card body.'] },
        { heading: 'Pay', layout: 'tiles', items: ['**Base salary:** Lots'] },
    ],
};

const html = renderJob(job);
const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const jp = lds.find((ld) => ld['@type'] === 'JobPosting');

assert.ok(jp, 'JobPosting JSON-LD present');
for (const key of ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation', 'baseSalary', 'employmentType']) {
    assert.ok(jp[key], `JobPosting.${key}`);
}
assert.strictEqual(jp.baseSalary.value.minValue, 60000);
assert.strictEqual(jp.jobLocation.address.addressLocality, 'Roseville');
// Google requires applicantLocationRequirements whenever jobLocationType is TELECOMMUTE.
assert.strictEqual(jp.jobLocationType, 'TELECOMMUTE');
assert.ok(jp.applicantLocationRequirements);
assert.ok(jp.description.includes('<strong>Lead.</strong>'), 'description carries the body HTML');

// Data is escaped in the page and can't close the JSON-LD <script>.
assert.ok(!html.includes('<b>'), 'raw HTML from data never reaches the page');
assert.ok(html.includes('Paralegal &lt;b&gt;'));
assert.ok(html.includes('Hello &amp; <strong>welcome</strong>.'));

// Card and tile layouts turn the **lead** into a heading, without its trailing . or :
assert.ok(html.includes('<h3>Card title</h3>'), 'cards: lead becomes the card title');
assert.ok(html.includes('<h3>Base salary</h3><p>Lots</p>'), 'tiles: lead becomes the tile label');
assert.ok(html.includes('class="why-photo"'), 'first cards section gets the photo tile');

// On-site only jobs carry no remote fields.
const onsite = renderJob({ ...job, remote: false });
assert.ok(!onsite.includes('TELECOMMUTE'));

// Bad data fails the build instead of publishing a broken posting.
assert.throws(() => renderJob({ ...job, salary: undefined }), /salary/);
assert.throws(() => renderJob({ ...job, office: 'reno' }), /office/);
assert.throws(() => renderJob({ ...job, employmentType: 'FULLTIME' }), /employmentType/);
assert.throws(() => renderJob({ ...job, slug: 'Bad Slug' }), /slug/);
assert.throws(() => renderJob({ ...job, sections: [{ heading: 'X', layout: 'grid', items: ['a'] }] }), /layout/);

console.log('careers: ok');
