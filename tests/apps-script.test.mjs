import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, feed, makeJob, makeResponse, renderStatus } from './apps-script-harness.mjs';

function ready(jobs = []) {
  const world = createWorld();
  world.sandbox.setup();
  world.jobs = jobs;
  world.fetch = (url) => (url.includes('raw/jobs') ? feed(world.jobs) : world.github ? world.github(url) : { code: 404, body: '' });
  return world;
}
const signUp = (world, id = 'r1', overrides = {}) => world.sandbox.onFormSubmit({ response: makeResponse(world.sandbox, id, overrides) });
const toStudents = (world, address = 'asha@example.com') => world.sent.filter((mail) => mail.to === address);

// Logic -----------------------------------------------------------------------------------------------
const logic = createWorld().sandbox;
const synonyms = logic.buildSynonyms([]);
const bachelor = { degree: "Bachelor's (BTech)", gradYear: '2029' };

test('graduation year rules', () => {
  const check = (minQualifications, gradYear = '2029') => logic.evaluateEligibility({ title: 'Intern', minQualifications }, { ...bachelor, gradYear }).status;
  assert.equal(check("Bachelor's degree, graduating in 2029."), 'eligible');
  assert.equal(check("Bachelor's degree, graduating in 2029.", '2028'), 'not_eligible');
  assert.equal(check('Expected graduation between 2028 and 2030.'), 'eligible');
  assert.equal(check('Expected graduation between 2026 and 2028.'), 'not_eligible');
  assert.equal(check('Must graduate before 2029.'), 'not_eligible');
  assert.equal(check('Must graduate by 2029.'), 'eligible');
  assert.equal(check("Pursuing a Bachelor's degree."), 'unclear');
});

test('real Google wording: PhD internships exclude a Bachelor student, Student Researcher stays unclear', () => {
  const phd = logic.evaluateEligibility({ title: 'Software Engineering PhD Intern, Summer 2027', minQualifications: 'Pursuing a PhD program with a focus in software development.' }, bachelor);
  assert.equal(phd.status, 'not_eligible');
  const researcher = logic.evaluateEligibility({ title: 'Student Researcher, 2027', minQualifications: "Currently enrolled in a degree program (e.g., Bachelor's, Master's or PhD) in Computer Science." }, bachelor);
  assert.equal(researcher.status, 'unclear');
  assert.match(researcher.quote, /Bachelor/);
});

test('summer year in a title is not treated as a graduation year', () => {
  const result = logic.evaluateEligibility({ title: 'Software Intern, Summer 2027', minQualifications: "Pursuing a Bachelor's degree." }, bachelor);
  assert.equal(result.status, 'unclear');
});

test('Scrum Master title is not read as a degree requirement', () => {
  const result = logic.evaluateEligibility({ title: 'Scrum Master Intern', minQualifications: 'Good communication.' }, bachelor);
  assert.notEqual(result.status, 'not_eligible');
});

test('skills: synonyms, exact-case short names, student tokens', () => {
  assert.deepEqual([...logic.extractSkills('We use Golang and postgres', synonyms)].sort(), ['go', 'sql']);
  assert.equal(logic.extractSkills('you will go far', synonyms).includes('go'), false);
  assert.equal(logic.extractSkills('Experience with C/C++', synonyms).includes('c++'), true);
  const parsed = logic.parseStudentSkills('go, Solidity, react.js, PYTHON', synonyms);
  assert.equal(parsed.known.includes('go'), true);
  assert.equal(parsed.known.includes('python'), true);
  assert.equal(parsed.unknown.includes('solidity'), true);
});

test('routing: skills filter normal roles but never hide priority roles', () => {
  const noMatch = { ...bachelor, skills: 'Figma' };
  const pythonJob = { title: 'Intern', minQualifications: "Bachelor's, graduating in 2029. Python." };
  assert.equal(logic.routeJob(pythonJob, noMatch, synonyms).channel, 'none');
  assert.equal(logic.routeJob({ ...pythonJob, priority: true }, noMatch, synonyms).channel, 'instant');
  assert.equal(logic.routeJob(pythonJob, { ...bachelor, skills: 'Python' }, synonyms).channel, 'digest');
  const unnamed = { title: 'Intern', minQualifications: 'Graduating in 2029.' };
  assert.equal(logic.routeJob(unnamed, noMatch, synonyms).channel, 'digest');
  const unclearPriority = logic.routeJob({ title: 'Intern', priority: true, minQualifications: "Bachelor's degree." }, noMatch, synonyms);
  assert.equal(unclearPriority.channel, 'instant');
  assert.equal(unclearPriority.checkEligibility, true);
  const excludedPriority = logic.routeJob({ title: 'Intern', priority: true, minQualifications: 'Pursuing a PhD.' }, noMatch, synonyms);
  assert.equal(excludedPriority.channel, 'none');
});

test('an unclear priority role arrives instantly with the check eligibility label', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.tick();
  world.sent.length = 0;
  world.hour = 0;
  world.jobs = [makeJob('asd', { title: 'Associate Software Developer Intern', priority: true })];
  world.sandbox.tick();
  const mail = toStudents(world);
  assert.equal(mail.length, 1);
  assert.match(mail[0].subject, /Associate Software Developer Intern/);
  assert.match(mail[0].body, /Check eligibility/);
});

test('GitHub links and repo summary', () => {
  assert.equal(logic.parseGithubUsername('https://github.com/asha-dev/'), 'asha-dev');
  assert.equal(logic.parseGithubUsername('github.com/asha'), 'asha');
  assert.equal(logic.parseGithubUsername('https://evil.example/asha'), '');
  assert.equal(logic.parseGithubUsername('https://github.com/asha/repo'), '');
  const skills = logic.summarizeGithubRepos([
    { fork: false, language: 'Python', name: 'api', description: 'Flask app', topics: ['docker'] },
    { fork: true, language: 'Rust', name: 'forked', description: '', topics: [] },
  ], synonyms);
  assert.deepEqual([...skills].sort(), ['docker', 'flask', 'python']);
});

test('emails escape job text and refuse unsafe links', () => {
  const mail = logic.buildInstantEmail({ title: '<b>X</b>', company: 'G', location: 'I', url: 'javascript:alert(1)', minQualifications: '<script>x</script>' }, 'https://edit/1');
  assert.equal(mail.htmlBody.includes('<script>'), false);
  assert.equal(mail.htmlBody.includes('javascript:'), false);
  assert.match(mail.subject, /is open: apply now/);
});

test('digest hours stay inside the sending window', () => {
  for (const address of ['a@x.com', 'b@y.com', 'long.address.here@gmail.com']) {
    const hour = logic.digestHour(address);
    assert.ok(hour >= 9 && hour <= 20, `hour ${hour}`);
  }
});

// Setup -----------------------------------------------------------------------------------------------
test('setup refuses unset config and the wrong account', () => {
  const unset = createWorld({ configured: false });
  unset.sandbox.CONFIG.JOBS_URL = 'REPLACE_ME';
  assert.throws(() => unset.sandbox.setup(), /Set CONFIG\.JOBS_URL/);
  const wrong = createWorld();
  wrong.account = 'someone@gmail.com';
  assert.throws(() => wrong.sandbox.setup(), /must run from internshipalerts\.roushan@gmail\.com/);
});

test('setup creates tables and triggers, and can be run twice', () => {
  const world = ready();
  world.sandbox.setup();
  assert.deepEqual(Object.keys(world.sheets).sort(), ['Jobs', 'Logs', 'Matches', 'Queue', 'Skills', 'Students']);
  assert.equal(world.sheets.Students.rows.length, 1);
  assert.ok(world.triggers.includes('tick') && world.triggers.includes('onFormSubmit') && world.triggers.includes('sendHeartbeat'));
});

// End to end ------------------------------------------------------------------------------------------
test('first sync records existing jobs without emailing anyone', () => {
  const world = ready([makeJob('old')]);
  signUp(world);
  world.sandbox.tick();
  const mail = toStudents(world);
  assert.equal(mail.length, 1);
  assert.match(mail[0].subject, /signed up/);
  assert.match(mail[0].body, /Not spam/);
  assert.match(mail[0].body, /https:\/\/edit\/r1/);
  assert.equal(world.table('Matches').length, 0);
});

test('priority role goes instantly only to eligible students', () => {
  const world = ready([]);
  signUp(world);
  signUp(world, 'r2', { [world.sandbox.FORM_TITLES.EMAIL]: 'late@example.com', [world.sandbox.FORM_TITLES.GRAD_YEAR]: '2027' });
  world.sandbox.tick();
  world.sent.length = 0;
  world.jobs = [makeJob('asd', { title: 'Associate Software Developer Intern', priority: true, minQualifications: "Bachelor's, graduating in 2029." })];
  world.sandbox.tick();
  assert.equal(toStudents(world).length, 1);
  assert.match(toStudents(world)[0].subject, /Associate Software Developer Intern/);
  assert.equal(toStudents(world, 'late@example.com').length, 0);
  world.sent.length = 0;
  world.sandbox.tick();
  assert.equal(world.sent.length, 0, 'must not send the same job twice');
});

test('digest waits for its hour, combines jobs, labels unclear ones, and skips non-matches', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.tick();
  world.sent.length = 0;
  world.hour = 0;
  world.jobs = [
    makeJob('a'),
    makeJob('b'),
    makeJob('phd', { title: 'PhD Intern', minQualifications: 'Pursuing a PhD.' }),
    makeJob('other', { minQualifications: "Bachelor's. Experience with Verilog." }),
  ];
  world.sandbox.tick();
  assert.equal(toStudents(world).length, 0, 'digest waits for its hour');
  world.hour = 23;
  world.sandbox.tick();
  const mail = toStudents(world);
  assert.equal(mail.length, 1);
  assert.match(mail[0].subject, /2 new internships/);
  assert.match(mail[0].body, /Check eligibility/);
  assert.equal(mail[0].body.includes('PhD Intern'), false);
  assert.equal(mail[0].body.includes('other Intern'), false);
  assert.equal(mail[0].name, 'Test Sender');
});

test('reposts and closed jobs send nothing', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.tick();
  world.sent.length = 0;
  world.hour = 23;
  world.jobs = [makeJob('re', { repostOf: 'old' }), makeJob('shut', { open: false })];
  world.sandbox.tick();
  assert.equal(world.sent.length, 0);
});

test('profile updates affect future jobs only, without another sign-up email', () => {
  const world = ready([]);
  const titles = world.sandbox.FORM_TITLES;
  signUp(world);
  world.hour = 23;
  world.sandbox.tick();
  world.sent.length = 0;
  world.jobs = [makeJob('rust1', { minQualifications: "Bachelor's. Rust required." })];
  world.sandbox.tick();
  assert.equal(world.sent.length, 0, 'no Rust skill yet');

  signUp(world, 'r1', { [titles.SKILLS]: 'Python, SQL, Rust' });
  assert.equal(world.table('Students').length, 1);
  world.sandbox.tick();
  assert.equal(world.sent.length, 0, 'the earlier job is not sent, and no new confirmation');

  world.jobs.push(makeJob('rust2', { minQualifications: "Bachelor's. Rust required." }));
  world.sandbox.tick();
  assert.equal(world.sent.length, 1);
  assert.match(world.sent[0].body, /rust2 Intern/);
});

test('new skills from students are added to the synonym list once', () => {
  const world = ready();
  signUp(world, 'r1', { [world.sandbox.FORM_TITLES.SKILLS]: 'Solidity, Python' });
  signUp(world, 'r2', { [world.sandbox.FORM_TITLES.EMAIL]: 'b@example.com', [world.sandbox.FORM_TITLES.SKILLS]: 'solidity' });
  assert.deepEqual(world.table('Skills').map((row) => row.skill), ['solidity']);
});

test('a second sign-up from the same address replaces the first', () => {
  const world = ready();
  signUp(world, 'r1');
  signUp(world, 'r2', { [world.sandbox.FORM_TITLES.SKILLS]: 'Java' });
  const students = world.table('Students');
  assert.equal(students.length, 1);
  assert.equal(students[0].responseId, 'r2');
  assert.ok(world.deletedResponses.includes('r1'));
  world.sandbox.tick();
  assert.equal(world.sent.filter((mail) => /signed up/.test(mail.subject)).length, 0);
});

test('pausing stops emails and clears waiting ones', () => {
  const world = ready([]);
  const { FORM_TITLES: titles, ALERT_STATUS: status } = world.sandbox;
  signUp(world);
  world.sandbox.tick();
  world.sent.length = 0;
  world.hour = 0;
  world.jobs = [makeJob('a')];
  world.sandbox.tick();
  signUp(world, 'r1', { [titles.STATUS]: status.PAUSED });
  world.hour = 23;
  world.jobs.push(makeJob('b'));
  world.sandbox.tick();
  assert.equal(world.sent.length, 0);
  assert.equal(world.table('Students')[0].status, 'paused');
});

test('delete removes the student, matches, queue, form response and resume', () => {
  const world = ready([]);
  const { FORM_TITLES: titles, ALERT_STATUS: status } = world.sandbox;
  signUp(world, 'r1', { [titles.RESUME]: ['resume-1'] });
  world.sandbox.tick();
  world.hour = 0;
  world.jobs = [makeJob('a')];
  world.sandbox.tick();
  assert.ok(world.table('Matches').length > 0);
  signUp(world, 'r1', { [titles.STATUS]: status.DELETE, [titles.RESUME]: ['resume-1'] });
  assert.equal(world.table('Students').length, 0);
  assert.equal(world.table('Matches').length, 0);
  assert.equal(world.table('Queue').filter((row) => row.status === 'pending').length, 0);
  assert.ok(world.deletedResponses.includes('r1'));
  assert.ok(world.trashed.includes('resume-1'));
});

test('GitHub: scans a few per run, caches, stops on rate limit, and handles missing profiles', () => {
  const world = ready([]);
  const titles = world.sandbox.FORM_TITLES;
  for (let i = 0; i < 5; i += 1) {
    signUp(world, `r${i}`, { [titles.EMAIL]: `s${i}@example.com`, [titles.GITHUB]: `https://github.com/user${i}` });
  }
  let calls = 0;
  world.github = (url) => {
    calls += 1;
    if (url.includes('user4')) return { code: 404, body: '' };
    return { code: 200, body: JSON.stringify([{ fork: false, language: 'Python', name: 'x', description: '', topics: [] }]) };
  };
  world.sandbox.tick();
  assert.equal(calls, 3);
  world.sandbox.tick();
  assert.equal(calls, 5);
  world.sandbox.tick();
  assert.equal(calls, 5, 'cached results are not fetched again');
  const students = world.table('Students');
  assert.equal(students.find((row) => row.responseId === 'r0').githubSkills, 'python');
  assert.equal(students.find((row) => row.responseId === 'r4').githubError, 'GitHub profile not found');

  const limited = ready([]);
  signUp(limited, 'r0', { [titles.GITHUB]: 'user0' });
  limited.github = () => ({ code: 403, body: '' });
  limited.sandbox.tick();
  const row = limited.table('Students')[0];
  assert.equal(row.githubScannedAt, '', 'a rate-limited scan is retried later');
});

test('resume reading feeds matching, cleans up the temp file, and records failures', () => {
  const world = ready([]);
  const titles = world.sandbox.FORM_TITLES;
  signUp(world, 'r1', { [titles.RESUME]: ['file-1'] });
  world.sandbox.tick();
  const student = world.table('Students')[0];
  assert.equal(student.resumeReadFileId, 'file-1');
  assert.match(student.resumeSkills, /docker/);
  assert.ok(world.trashed.includes('temp-doc'));

  const failing = ready([]);
  failing.ocrFails = true;
  signUp(failing, 'r1', { [titles.RESUME]: ['file-1'] });
  failing.sandbox.tick();
  assert.equal(failing.table('Students')[0].resumeError, 'OCR failed');
  assert.equal(failing.sent.filter((m) => m.to === 'owner@example.com').length, 0);
});

test('quota: digests stop at the reserve, instant alerts still go, and waiting mail stays queued', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.tick();
  world.sent.length = 0;
  world.hour = 23;
  world.quota = 15;
  world.jobs = [makeJob('normal'), makeJob('asd', { title: 'Associate Software Developer Intern', priority: true, minQualifications: "Bachelor's, graduating in 2029." })];
  world.sandbox.tick();
  const student = toStudents(world);
  assert.equal(student.length, 1);
  assert.match(student[0].subject, /Associate/);
  assert.equal(world.table('Queue').filter((row) => row.type === 'digest' && row.status === 'pending').length, 1);
  assert.equal(world.sent.filter((m) => /Problem: quota/.test(m.subject)).length, 1);
  world.quota = 100;
  world.sandbox.tick();
  assert.equal(toStudents(world).length, 2);
  assert.equal(world.sent.filter((m) => /Fixed: quota/.test(m.subject)).length, 1);
});

test('failed sends retry, then stop and show on the status page', () => {
  const world = ready([]);
  signUp(world);
  world.mailFails = true;
  world.quota = 100;
  // Health alerts use the same mail service, so the fake failure stops them too; that must not break a run.
  world.sandbox.tick();
  world.sandbox.tick();
  world.sandbox.tick();
  world.mailFails = false;
  const row = world.table('Queue')[0];
  assert.equal(row.status, 'failed');
  assert.match(world.sandbox.getStatusData_().warnings.join(' '), /failed after retries/);
});

test('health: stale data, failed source and bad feed alert once, then report fixed', () => {
  const world = ready([]);
  world.sandbox.tick();
  assert.equal(world.sent.length, 0);

  const staleAt = new Date(Date.now() - 5 * 3600000).toISOString();
  world.fetch = () => feed([], { generatedAt: staleAt });
  world.sandbox.tick();
  world.sandbox.tick();
  assert.equal(world.sent.filter((m) => /Problem: stale/.test(m.subject)).length, 1, 'only one email per problem');
  assert.equal(world.sandbox.getStatusData_().overall, 'Red');

  world.fetch = () => feed([], { sources: { Google: { ok: false, error: 'Zero jobs found' } } });
  world.sandbox.tick();
  assert.equal(world.sent.filter((m) => /Fixed: stale/.test(m.subject)).length, 1);
  assert.equal(world.sent.filter((m) => /Problem: source:Google/.test(m.subject)).length, 1);

  world.fetch = () => ({ code: 500, body: '' });
  world.sandbox.tick();
  assert.equal(world.sent.filter((m) => /Problem: feed/.test(m.subject)).length, 1);

  world.fetch = () => feed([]);
  world.sandbox.tick();
  assert.equal(world.sent.filter((m) => /Fixed: feed/.test(m.subject)).length, 1);
  assert.equal(world.props.OPEN_INCIDENTS, '{}');
});

test('malformed job data is reported, not crashed on', () => {
  const world = ready([]);
  world.fetch = () => ({ code: 200, body: 'not json' });
  world.sandbox.tick();
  assert.equal(world.sent.filter((m) => /Problem: feed/.test(m.subject)).length, 1);
  assert.ok(world.props.LAST_TICK_AT);
});

test('a crashing step does not stop later steps, and it is reported', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.refreshProfiles_ = () => { throw new Error('profile boom'); };
  world.sandbox.tick();
  assert.equal(toStudents(world).length, 1, 'email still goes');
  assert.equal(world.sent.filter((m) => /Problem: step:profiles/.test(m.subject)).length, 1);
  assert.ok(world.table('Logs').some((row) => /profile boom/.test(row.message)));
});

test('formula-like student text is stored safely', () => {
  const world = ready();
  signUp(world, 'r1', { [world.sandbox.FORM_TITLES.NAME]: '=IMPORTXML("http://evil","//a")' });
  assert.equal(String(world.table('Students')[0].name).startsWith("'="), true);
});

test('reminders are queued after the interval, once, and respect quota', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.tick();
  const student = world.table('Students')[0];
  student.lastReminderAt = new Date(Date.now() - 80 * 86400000).toISOString();
  world.sandbox.updateRow_('Students', student);
  world.sent.length = 0;
  world.quota = 30;
  world.sandbox.tick();
  world.sandbox.tick();
  assert.equal(world.sent.length, 0, 'reminders wait while quota is low');
  assert.equal(world.table('Queue').filter((row) => row.type === 'reminder').length, 1);
  world.quota = 100;
  world.sandbox.tick();
  assert.match(world.sent[0].subject, /Anything new/);
});

test('heartbeat and status page render with real data and escape it', () => {
  const world = ready([makeJob('old')]);
  signUp(world);
  world.sandbox.tick();
  world.sandbox.log_('ERROR', 'test', '<img src=x onerror=alert(1)>');
  world.sandbox.sendHeartbeat();
  assert.match(world.sent.at(-1).body, /still running/);
  const data = world.sandbox.getStatusData_();
  assert.equal(data.studentsActive, 1);
  assert.equal(data.jobsOpen, 1);
  assert.match(data.warnings.join(' '), /resume upload question/);
  assert.equal(data.overall, 'Yellow');
  world.formItems.push({ getType: () => 'FILE_UPLOAD' });
  assert.equal(world.sandbox.getStatusData_().overall, 'Green');
  const html = renderStatus(world.sandbox.getStatusData_());
  assert.match(html, /Status: Green/);
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img src=x/);
});
