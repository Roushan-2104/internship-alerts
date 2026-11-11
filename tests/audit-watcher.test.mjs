import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRole } from '../watcher/classify.mjs';
import { mergeRun, parseDescription } from '../watcher/lib.mjs';

test('audit: bullets are never taken as headings', () => {
  const parsed = parseDescription(`
    <h4>Responsibilities</h4><ul><li>Build reporting dashboards</li><li>Write tests</li></ul>
    <h4>Requirements</h4><ul><li>Strong communication skills</li><li>Bonus points for Rust</li><li>Python</li></ul>`);
  assert.equal(parsed.responsibilities, 'Build reporting dashboards\nWrite tests');
  assert.equal(parsed.minQualifications, 'Strong communication skills\nBonus points for Rust\nPython');
  assert.equal(parsed.preferredQualifications, '');
});

test('audit: bold headings inside list items still work', () => {
  const parsed = parseDescription('<ul><li><p><strong>Requirements</strong></p></li><li>Java</li></ul>');
  assert.equal(parsed.minQualifications, 'Java');
});

test('audit: staff roles about students are not student roles', () => {
  for (const title of [
    'Internship Program Manager', 'Manager, Internship Programs', 'Intern Recruiter', 'Campus Recruiter',
    'Senior Campus Recruiter', 'Early Career Recruiter', 'Director, New Grad Hiring', 'Senior Research Associate',
    'Lead Research Associate', 'Postdoctoral Research Fellow', 'University Recruiting Coordinator, Interns',
  ]) {
    assert.equal(classifyRole(title), null, title);
  }
});

test('audit: real student roles that mention staff words still count', () => {
  const expected = {
    'Recruiting Intern': 'internship', 'Product Manager Intern': 'internship', 'Talent Acquisition Intern': 'internship',
    'Project Management Intern': 'internship', 'Software Engineer, Intern': 'internship', 'Research Intern': 'research',
    'Associate Product Manager, University Graduate, 2027 Start': 'newGrad',
    'Associate Product Manager': 'newGrad', 'Summer Analyst': 'internship', 'GET - Mechanical': 'apprentice', 'Senior Associate Product Manager': null,
  };
  for (const [title, role] of Object.entries(expected)) assert.equal(classifyRole(title), role, title);
});

test('audit: level-one titles in common formats count as new-grad', () => {
  for (const title of ['SDE-1', 'SDE 1', 'Engineer-I', 'Software Engineer - I', 'Data Scientist I', 'Software Engineer I']) {
    assert.equal(classifyRole(title), 'newGrad', title);
  }
  for (const title of ['Software Engineer II', 'SDE-2', 'Software Engineer - II', 'Engineer III', 'Software Engineer 10']) {
    assert.equal(classifyRole(title), null, title);
  }
});

const options = { repostWindowDays: 90, closedJobRetentionDays: 180 };

test('audit: details read from a Google job page are not overwritten by the shorter listing card', () => {
  const card = { id: 'g1', title: 'Intern', company: 'Google', location: 'India', url: 'https://x', minQualifications: 'Short card text' };
  const first = mergeRun({ jobs: [] }, [{ name: 'G', company: 'Google', ok: true, jobs: [card] }], options, new Date('2026-11-11T10:00:00Z'));
  Object.assign(first.jobs[0], { minQualifications: 'Full detail text', detailVersion: 2, deadline: 'Dec 4' });
  const next = mergeRun(first, [{ name: 'G', company: 'Google', ok: true, jobs: [card] }], options, new Date('2026-11-11T10:30:00Z'));
  assert.equal(next.jobs[0].minQualifications, 'Full detail text');
  assert.equal(next.jobs[0].deadline, 'Dec 4');
});

test('audit: jobs from a company removed from the sheet are closed', () => {
  const job = { id: 'a', title: 'Intern', company: 'Gone', location: 'India', url: 'https://x' };
  const first = mergeRun({ jobs: [] }, [{ name: 'Gone', company: 'Gone', ok: true, jobs: [job] }], options, new Date('2026-11-11T10:00:00Z'));
  const next = mergeRun(first, [{ name: 'Other', company: 'Other', ok: true, jobs: [] }], options, new Date('2026-11-11T10:30:00Z'));
  assert.equal(next.jobs[0].open, false);
  const failed = mergeRun(first, [{ name: 'Gone', company: 'Gone', ok: false, jobs: [], error: 'down' }], options, new Date('2026-11-11T10:30:00Z'));
  assert.equal(failed.jobs[0].open, true, 'a failed source is not the same as a removed one');
});
