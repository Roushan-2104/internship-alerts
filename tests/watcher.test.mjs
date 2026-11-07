import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertAllowedGoogleUrl, containsKeyword, fingerprint, htmlToText, matchesPriority, mergeRun,
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
    { id: '1', title: 'Software Intern', location: 'Bengaluru', jobUrl: 'https://a/1', descriptionPlain: 'Python' },
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
  { id: '1', text: 'Security Intern', hostedUrl: 'https://l/1', categories: { location: 'Bengaluru' } },
  { id: '2', text: 'Analyst', hostedUrl: 'https://l/2', categories: { location: 'India', commitment: 'Internship' } },
  { id: '3', text: 'Internal Tools Engineer', hostedUrl: 'https://l/3', categories: { location: 'India' } },
  { id: '4', text: 'Data Intern', hostedUrl: 'https://l/4', categories: { location: 'Paris' } },
], async () => {
  const jobs = await readLever(atsSource, atsConfig);
  assert.deepEqual(jobs.map((item) => item.id), ['lever-acme-1', 'lever-acme-2']);
}));

test('Greenhouse keeps India internships and marks priority roles', () => withFetch({
  jobs: [
    { id: 1, title: 'Associate Software Developer Intern', absolute_url: 'https://g/1', location: { name: 'Bengaluru, India' }, content: '&lt;p&gt;Java&lt;/p&gt;' },
    { id: 2, title: 'Software Intern', absolute_url: 'https://g/2', location: { name: 'New York' }, content: '' },
  ],
}, async () => {
  const jobs = await readGreenhouse(atsSource, atsConfig);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].priority, true);
  assert.equal(jobs[0].minQualifications, 'Java');
}));

