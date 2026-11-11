import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRole, companiesToSources, isPartTime, parseCsv, placeFor, tagAreas } from '../watcher/classify.mjs';
import { mergeRun } from '../watcher/lib.mjs';
import { readSmartRecruiters } from '../watcher/sources.mjs';

test('role types are recognised', () => {
  assert.equal(classifyRole('Software Engineer, Intern'), 'internship');
  assert.equal(classifyRole('Analyst', 'Internship'), 'internship');
  assert.equal(classifyRole('Industrial Trainee'), 'apprentice');
  assert.equal(classifyRole('Operations Associate, Apprenticeship'), 'apprentice');
  assert.equal(classifyRole('Student Researcher, 2027'), 'research');
  assert.equal(classifyRole('Software Engineer, New Grad'), 'newGrad');
  assert.equal(classifyRole('Associate Product Manager, University Graduate, 2027 Start'), 'newGrad');
  assert.equal(classifyRole('Software Engineer I, Frontend'), 'newGrad');
  assert.equal(classifyRole('Business Development Executive - Fresher'), 'newGrad');
  assert.equal(classifyRole('Junior Data Analyst'), 'newGrad');
});

test('senior, mid-level and ordinary roles are left out', () => {
  assert.equal(classifyRole('Software Engineer II'), null);
  assert.equal(classifyRole('Software Engineer III, Core Systems'), null);
  assert.equal(classifyRole('Senior Software Engineer'), null);
  assert.equal(classifyRole('Engineering Manager I'), null);
  assert.equal(classifyRole('Senior Associate Software Engineer'), null);
  assert.equal(classifyRole('Internal Tools Engineer'), null);
  assert.equal(classifyRole('Account Manager, Engage'), null);
});

test('part-time and contract count only at student level', () => {
  assert.equal(classifyRole('Contract Technical Recruiter', 'Contract'), null);
  assert.equal(classifyRole('Senior TPM for Infra Initiatives', 'Contract'), null);
  assert.equal(classifyRole('Content Writer (Part-time, students welcome)'), 'partTime');
  assert.equal(classifyRole('Field Facilitator - 6 months Contractual'), null);
  assert.equal(classifyRole('Marketing Intern', 'Part-time'), 'internship');
  assert.equal(isPartTime('Marketing Intern', 'Part-time'), true);
  assert.equal(isPartTime('Marketing Intern', 'Full-time'), false);
});

test('areas of work come from the title, then the department', () => {
  assert.deepEqual(tagAreas('Software Engineer, Intern'), ['engineering']);
  assert.deepEqual(tagAreas('UX Design - Intern'), ['design']);
  assert.deepEqual(tagAreas('Product Management Intern'), ['product']);
  assert.deepEqual(tagAreas('HR Intern'), ['people']);
  assert.ok(tagAreas('Machine Learning Engineer Intern').includes('data and AI'));
  assert.deepEqual(tagAreas('Hardware Intern — Robotics & AI').slice(0, 1), ['hardware']);
  assert.deepEqual(tagAreas('Fulfilment Intern'), ['operations']);
  assert.deepEqual(tagAreas('Intern', 'Finance'), ['finance']);
  assert.deepEqual(tagAreas('Intern'), ['other']);
});

test('places: India counts, remote only when open to India', () => {
  assert.deepEqual(placeFor('Bengaluru, Karnataka'), { relevant: true, remote: false });
  assert.deepEqual(placeFor('Remote - India'), { relevant: true, remote: true });
  assert.deepEqual(placeFor('Remote (APAC)'), { relevant: true, remote: true });
  assert.deepEqual(placeFor('Remote', 'This role is open to candidates anywhere in India.'), { relevant: true, remote: true });
  assert.deepEqual(placeFor('Remote - US'), { relevant: false, remote: true });
  assert.deepEqual(placeFor('Remote'), { relevant: false, remote: true });
  assert.deepEqual(placeFor('Indianapolis, IN'), { relevant: false, remote: false });
  assert.deepEqual(placeFor('London'), { relevant: false, remote: false });
});

test('company sheet CSV: quotes, disabled rows and bad rows', () => {
  const rows = parseCsv('Company,Type,Board,Enabled,Group\r\n"Acme, Inc",greenhouse,acme,yes,YC\r\nOff Co,lever,off,no,\r\nBad Co,workday,bad,yes,\r\n,,,,\r\nAsh,Ashby,ash,,\r\n');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].company, 'Acme, Inc');
  const { sources, problems } = companiesToSources(rows);
  assert.deepEqual(sources.map((s) => `${s.company}:${s.type}:${s.board}`), ['Acme, Inc:greenhouse:acme', 'Ash:ashby:ash']);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Bad Co/);
});

test('a narrow search never closes jobs from a full listing, and the reverse', () => {
  const options = { repostWindowDays: 90, closedJobRetentionDays: 180 };
  const job = (id, title) => ({ id, title, company: 'Google', location: 'India', url: 'https://x' });
  const full = (jobs) => ({ name: 'Google internships India', company: 'Google', ok: true, requireJobs: true, jobs });
  const search = (jobs) => ({ name: 'Google university graduate search', company: 'Google', ok: true, requireJobs: false, jobs });
  const first = mergeRun({ jobs: [] }, [full([job('i1', 'Intern')]), search([job('g1', 'APM, University Graduate')])], options, new Date('2026-11-11T10:00:00Z'));
  const next = mergeRun(first, [full([job('i1', 'Intern')]), search([])], options, new Date('2026-11-11T10:30:00Z'));
  assert.equal(next.jobs.find((j) => j.id === 'g1').open, false, 'the search itself is a full list of its own results');
  assert.equal(next.jobs.find((j) => j.id === 'i1').open, true);
  const later = mergeRun(first, [full([job('i1', 'Intern')]), search([job('g1', 'APM, University Graduate')])], options, new Date('2026-11-11T11:00:00Z'));
  assert.equal(later.jobs.find((j) => j.id === 'g1').open, true, 'the full intern list does not close the graduate role');
});

test('older stored jobs without a sources list still close correctly', () => {
  const options = { repostWindowDays: 90, closedJobRetentionDays: 180 };
  const old = { jobs: [{ id: 'a', title: 'Intern', company: 'Acme', location: 'India', source: 'Acme', open: true, firstSeen: '2026-11-01T00:00:00Z', lastSeen: '2026-11-10T00:00:00Z' }] };
  const next = mergeRun(old, [{ name: 'Acme', company: 'Acme', ok: true, jobs: [] }], options, new Date('2026-11-11T00:00:00Z'));
  assert.equal(next.jobs[0].open, false);
});

test('SmartRecruiters: keeps India student roles and reads their sections', async () => {
  const original = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    const body = url.endsWith('limit=100') ? {
      content: [
        { id: '1', name: 'Intern – Manufacturing Engineer', location: { city: 'Bengaluru', country: 'in', fullLocation: 'Bengaluru, Karnataka, India' }, typeOfEmployment: { label: 'Intern' }, function: { label: 'Engineering' } },
        { id: '2', name: 'Staff Engineer', location: { city: 'Bengaluru', country: 'in' }, typeOfEmployment: { label: 'Full-time' } },
        { id: '3', name: 'Technician Intern', location: { city: 'Shenzhen', country: 'cn' }, typeOfEmployment: { label: 'Intern' } },
      ],
    } : {
      postingUrl: 'https://jobs.smartrecruiters.com/WD/1-intern',
      jobAd: { sections: {
        companyDescription: { title: 'Company Description', text: '<p>WD builds storage.</p>' },
        jobDescription: { title: 'Job Description', text: '<p><strong>Responsibilities</strong></p><ul><li>Run tests</li></ul>' },
        qualifications: { title: 'Qualifications', text: '<ul><li>Studying a Bachelor degree</li></ul>' },
        additionalInformation: { title: 'Additional Information', text: '<p>We value diversity.</p>' },
      } },
    };
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const jobs = await readSmartRecruiters({ name: 'Western Digital', company: 'Western Digital', board: 'westerndigital' }, { priorityTitles: [] });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, 'smartrecruiters-westerndigital-1');
    assert.equal(jobs[0].roleType, 'internship');
    assert.equal(jobs[0].url, 'https://jobs.smartrecruiters.com/WD/1-intern');
    assert.equal(jobs[0].responsibilities, 'Run tests');
    assert.equal(jobs[0].minQualifications, 'Studying a Bachelor degree');
    assert.equal(jobs[0].fullText.includes('diversity'), false);
    assert.equal(requested.filter((url) => !url.endsWith('limit=100')).length, 1, 'details only for the kept job');
  } finally {
    globalThis.fetch = original;
  }
});
