import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertAllowedGoogleUrl, classifyHeading, containsKeyword, fingerprint, htmlToText, matchesPriority, mergeRun, parseDescription,
} from '../watcher/lib.mjs';
import { readAshby, readGreenhouse, readLever } from '../watcher/sources.mjs';

const options = { repostWindowDays: 90, closedJobRetentionDays: 180 };
const job = (id, title = 'Software Intern') => ({ id, title, company: 'Google', location: 'Bengaluru, India', url: 'https://x/y' });
const result = (jobs, extra = {}) => ({ name: 'G', company: 'Google', ok: true, requireJobs: true, jobs, ...extra });

test('priority matching ignores the ordinary word step but finds the role names', () => {
  const names = ['Associate Software Developer Intern', 'STEP'];
  assert.equal(matchesPriority('Associate Software Developer Intern, 2027', names), true);
  assert.equal(matchesPriority('associate software developer intern', names), true);
  assert.equal(matchesPriority('STEP Intern, 2027', names), true);
  assert.equal(matchesPriority('Next step engineer', names), false);
  assert.equal(matchesPriority('Stepper Motor Intern', names), false);
  assert.equal(matchesPriority('Software Engineering Intern', names), false);
});

test('keyword matching uses whole words', () => {
  assert.equal(containsKeyword('Software Intern', ['intern']), true);
  assert.equal(containsKeyword('Internal Tools Engineer', ['intern']), false);
});

test('paginated Google URLs are refused', () => {
  assert.throws(() => assertAllowedGoogleUrl('https://www.google.com/about/careers/applications/jobs/results/?page=2'));
  assert.doesNotThrow(() => assertAllowedGoogleUrl('https://www.google.com/about/careers/applications/jobs/results/?location=India'));
});

test('new jobs are stored as open with first-seen time', () => {
  const now = new Date('2026-11-06T10:00:00Z');
  const next = mergeRun({ jobs: [] }, [result([job('a')])], options, now);
  assert.equal(next.jobs.length, 1);
  assert.equal(next.jobs[0].open, true);
  assert.equal(next.jobs[0].firstSeen, now.toISOString());
  assert.equal(next.lastFullSuccessAt, now.toISOString());
});

test('a failed source keeps jobs open and keeps last success time', () => {
  const first = mergeRun({ jobs: [] }, [result([job('a')])], options, new Date('2026-11-06T10:00:00Z'));
  const next = mergeRun(first, [result([], { ok: false, error: 'blocked' })], options, new Date('2026-11-06T10:30:00Z'));
  assert.equal(next.jobs[0].open, true);
  assert.equal(next.sources.G.ok, false);
  assert.equal(next.sources.G.error, 'blocked');
  assert.equal(next.lastFullSuccessAt, '2026-11-06T10:00:00.000Z');
});

test('zero jobs from a required source counts as failure and closes nothing', () => {
  const first = mergeRun({ jobs: [] }, [result([job('a')])], options, new Date('2026-11-06T10:00:00Z'));
  const next = mergeRun(first, [result([])], options, new Date('2026-11-06T10:30:00Z'));
  assert.equal(next.sources.G.ok, false);
  assert.match(next.sources.G.error, /Zero jobs/);
  assert.equal(next.jobs[0].open, true);
});

test('a job missing from a successful listing is closed, and firstSeen survives reopening', () => {
  const first = mergeRun({ jobs: [] }, [result([job('a'), job('b', 'Other Intern')])], options, new Date('2026-11-06T10:00:00Z'));
  const closed = mergeRun(first, [result([job('b', 'Other Intern')])], options, new Date('2026-11-06T10:30:00Z'));
  assert.equal(closed.jobs.find((item) => item.id === 'a').open, false);
  const reopened = mergeRun(closed, [result([job('a'), job('b', 'Other Intern')])], options, new Date('2026-11-06T11:00:00Z'));
  const again = reopened.jobs.find((item) => item.id === 'a');
  assert.equal(again.open, true);
  assert.equal(again.firstSeen, '2026-11-06T10:00:00.000Z');
});

test('a priority-only search cannot close jobs', () => {
  const first = mergeRun({ jobs: [] }, [result([job('a')])], options, new Date('2026-11-06T10:00:00Z'));
  const next = mergeRun(first, [result([], { requireJobs: false, authoritative: false })], options, new Date('2026-11-06T10:30:00Z'));
  assert.equal(next.jobs[0].open, true);
  assert.equal(next.sources.G.ok, true);
});

test('a new id with the same job details is marked as a repost', () => {
  const first = mergeRun({ jobs: [] }, [result([job('a')])], options, new Date('2026-11-06T10:00:00Z'));
  const next = mergeRun(first, [result([job('a2')])], options, new Date('2026-11-20T10:00:00Z'));
  assert.equal(next.jobs.find((item) => item.id === 'a2').repostOf, 'a');
});

test('same title after the repost window counts as a new job', () => {
  const first = mergeRun({ jobs: [] }, [result([job('a')])], options, new Date('2026-01-01T10:00:00Z'));
  const next = mergeRun(first, [result([job('a2')])], options, new Date('2026-11-20T10:00:00Z'));
  assert.equal(next.jobs.find((item) => item.id === 'a2').repostOf, null);
});

test('old closed jobs are removed after retention', () => {
  const first = mergeRun({ jobs: [] }, [result([job('a'), job('b', 'B Intern')])], options, new Date('2026-01-01T10:00:00Z'));
  const next = mergeRun(first, [result([job('b', 'B Intern')])], options, new Date('2026-11-20T10:00:00Z'));
  assert.equal(next.jobs.some((item) => item.id === 'a'), false);
});

test('fingerprint ignores case and punctuation', () => {
  assert.equal(
    fingerprint({ company: 'Google', title: 'SWE Intern, 2027', location: 'Bengaluru, India' }),
    fingerprint({ company: 'google', title: 'swe intern 2027', location: 'BENGALURU INDIA' }),
  );
});

test('htmlToText handles escaped ATS content', () => {
  assert.equal(htmlToText('&lt;p&gt;Python &amp; SQL&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Git&lt;/li&gt;&lt;/ul&gt;'), 'Python & SQL\nGit');
});

const atsConfig = { priorityTitles: ['Associate Software Developer Intern'], internKeywords: ['intern', 'trainee'], locationKeywords: ['india', 'bengaluru'] };
const atsSource = { name: 'Acme', company: 'Acme', board: 'acme' };

function withFetch(payload, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
  return run().finally(() => { globalThis.fetch = original; });
}

test('Ashby keeps India internships, including by job type and secondary location', () => withFetch({
  jobs: [
    { id: '1', title: 'Software Intern', location: 'Bengaluru', jobUrl: 'https://a/1', descriptionHtml: '<p><strong>Requirements</strong></p><ul><li>Python</li></ul>' },
    { id: '2', title: 'Engineer', employmentType: 'Intern', location: 'Remote', secondaryLocations: [{ location: 'India' }], jobUrl: 'https://a/2' },
    { id: '3', title: 'Software Intern', location: 'London', jobUrl: 'https://a/3' },
    { id: '4', title: 'Senior Engineer', location: 'Bengaluru', jobUrl: 'https://a/4' },
    { id: '5', title: 'Hidden Intern', location: 'India', isListed: false, jobUrl: 'https://a/5' },
  ],
}, async () => {
  const jobs = await readAshby(atsSource, atsConfig);
  assert.deepEqual(jobs.map((item) => item.id), ['ashby-acme-1', 'ashby-acme-2']);
  assert.equal(jobs[0].company, 'Acme');
  assert.equal(jobs[0].minQualifications, 'Python');
}));

test('Lever keeps India internships by title or commitment', () => withFetch([
  { id: '1', text: 'Security Intern', hostedUrl: 'https://l/1', categories: { location: 'Bengaluru' }, description: '<div>About us. We make apps.</div>', lists: [{ text: 'On the Job', content: '<li>Find bugs</li>' }, { text: 'Must-Haves', content: '<li>Python</li>' }, { text: 'Good to Haves', content: '<li>Go</li>' }, { text: 'Why join us?', content: '<li>Free lunch</li>' }] },
  { id: '2', text: 'Analyst', hostedUrl: 'https://l/2', categories: { location: 'India', commitment: 'Internship' } },
  { id: '3', text: 'Internal Tools Engineer', hostedUrl: 'https://l/3', categories: { location: 'India' } },
  { id: '4', text: 'Data Intern', hostedUrl: 'https://l/4', categories: { location: 'Paris' } },
], async () => {
  const jobs = await readLever(atsSource, atsConfig);
  assert.deepEqual(jobs.map((item) => item.id), ['lever-acme-1', 'lever-acme-2']);
  assert.equal(jobs[0].minQualifications, 'Python');
  assert.equal(jobs[0].preferredQualifications, 'Go');
  assert.equal(jobs[0].responsibilities, 'Find bugs');
}));

test('Greenhouse keeps India internships and marks priority roles', () => withFetch({
  jobs: [
    { id: 1, title: 'Associate Software Developer Intern', absolute_url: 'https://g/1', location: { name: 'Bengaluru, India' }, content: '&lt;h4&gt;Requirements&lt;/h4&gt;&lt;ul&gt;&lt;li&gt;Java&lt;/li&gt;&lt;/ul&gt;' },
    { id: 2, title: 'Software Intern', absolute_url: 'https://g/2', location: { name: 'New York' }, content: '' },
  ],
}, async () => {
  const jobs = await readGreenhouse(atsSource, atsConfig);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].priority, true);
  assert.equal(jobs[0].minQualifications, 'Java');
}));

test('descriptions split into named sections and drop company and perks text', () => {
  const parsed = parseDescription(`
    <div class="content-intro"><p>Acme is a great company founded long ago.</p></div>
    <h4><strong>About the role</strong></h4><p>You will join our platform team.</p>
    <h4>Responsibilities</h4><ul><li>Build APIs</li><li><strong>Own:</strong> testing</li></ul>
    <p><strong>Who you are</strong></p>
    <p><strong>Minimum requirements</strong></p><ul><li>Python &amp; SQL</li></ul>
    <p><b>Preferred qualifications:</b></p><ul><li>Docker</li></ul>
    <h4>Benefits</h4><ul><li>Free lunch</li></ul>`);
  assert.equal(parsed.aboutRole, 'You will join our platform team.');
  assert.equal(parsed.responsibilities, 'Build APIs\nOwn: testing');
  assert.equal(parsed.minQualifications, 'Python & SQL');
  assert.equal(parsed.preferredQualifications, 'Docker');
  for (const field of ['aboutRole', 'responsibilities', 'minQualifications', 'preferredQualifications']) {
    assert.equal(parsed[field].includes('Free lunch'), false);
    assert.equal(parsed[field].includes('founded long ago'), false);
  }
  assert.equal(parsed.fullText.includes('founded long ago'), false, 'company intro boxes are removed');
  assert.match(parsed.fullText, /Free lunch/);
});

test('escaped Greenhouse HTML and plain-line headings both work', () => {
  const parsed = parseDescription('&lt;p&gt;Intro&lt;/p&gt;&lt;p&gt;Requirements:&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Java&lt;/li&gt;&lt;/ul&gt;');
  assert.equal(parsed.minQualifications, 'Java');
});

test('a posting with no sections keeps its text only in fullText', () => {
  const parsed = parseDescription('<p>We want someone who knows Python.</p>');
  assert.equal(parsed.minQualifications, '');
  assert.match(parsed.fullText, /Python/);
});

test('long sections are cut at a sentence or line, not mid-word', () => {
  const parsed = parseDescription(`<h4>Requirements</h4><ul>${'<li>Experience with systems.</li>'.repeat(200)}</ul>`);
  assert.ok(parsed.minQualifications.length <= 3000);
  assert.match(parsed.minQualifications, /systems\.$/);
});

test('headings classify correctly, with preferred winning over qualifications', () => {
  assert.equal(classifyHeading('Preferred qualifications'), 'preferred');
  assert.equal(classifyHeading('Minimum qualifications'), 'requirements');
  assert.equal(classifyHeading('Must-Haves'), 'requirements');
  assert.equal(classifyHeading('Good to Haves'), 'preferred');
  assert.equal(classifyHeading('On the Job'), 'responsibilities');
  assert.equal(classifyHeading('About the Role'), 'aboutRole');
  assert.equal(classifyHeading('Why join us?'), 'skip');
  assert.equal(classifyHeading('About Stripe'), 'other');
});

test('sub-headings stay in their section, and later sections still split', () => {
  const parsed = parseDescription(`
    <p><span><strong>Key Responsibilities</strong></span></p>
    <p><strong>1. Inventory Ownership</strong></p><ul><li>Track devices</li></ul>
    <p><strong>Skills &amp; Requirements</strong></p>
    <p><strong>Mandatory</strong></p><ul><li>Google Sheets</li></ul>
    <p><strong>Preferred</strong></p><ul><li>Audit experience</li></ul>
    <p><strong>Key Traits</strong></p><ul><li>Zero-error mindset</li></ul>
    <p><strong>About Instawork</strong></p><p>We are a marketplace.</p>`);
  assert.equal(parsed.responsibilities, 'Track devices');
  assert.equal(parsed.minQualifications, 'Google Sheets');
  assert.equal(parsed.preferredQualifications, 'Audit experience');
  assert.equal(parsed.fullText.includes('marketplace'), true);
  assert.equal(parsed.preferredQualifications.includes('marketplace'), false);
});

test('sentences marked as headings are text, and company intro boxes are removed', () => {
  const parsed = parseDescription(`
    <div class="content-intro"><p>Acme helps companies hire.</p></div>
    <h4><em>This is a 6-month full-time onsite internship (Jan - June 2027).</em></h4>
    <p>You will write great code.</p>`);
  assert.match(parsed.aboutRole, /6-month full-time onsite/);
  assert.match(parsed.aboutRole, /write great code/);
  assert.equal(parsed.aboutRole.includes('helps companies hire'), false);
});

test('company text before named sections is not shown as the role', () => {
  const parsed = parseDescription('<p>Acme was founded in 1999.</p><h4>Requirements</h4><ul><li>Java</li></ul>');
  assert.equal(parsed.aboutRole, '');
  assert.equal(parsed.minQualifications, 'Java');
});

test('text escaped twice is cleaned, and blank lines disappear', () => {
  const parsed = parseDescription('&lt;h4&gt;Requirements&lt;/h4&gt;&lt;ul&gt;&lt;li&gt;Python &amp;amp; SQL&lt;/li&gt;&lt;li&gt;&amp;nbsp;&lt;/li&gt;&lt;/ul&gt;');
  assert.equal(parsed.minQualifications, 'Python & SQL');
  assert.equal(parsed.fullText.includes('&'), true);
  assert.equal(parsed.fullText.includes('nbsp'), false);
});

