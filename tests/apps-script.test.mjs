import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, feed, makeJob, makeResponse, renderStatus } from './apps-script-harness.mjs';

function ready(jobs = []) {
  const world = createWorld();
  world.sandbox.setup();
  world.jobs = jobs;
  world.props.GITHUB_DISPATCH_TOKEN = 'github_pat_test_secret';
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

test('reposts and closed jobs are not sent to students', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.tick();
  world.sent.length = 0;
  world.hour = 23;
  world.jobs = [makeJob('re', { repostOf: 'old' }), makeJob('shut', { open: false })];
  world.sandbox.tick();
  assert.equal(world.sent.length, 1);
  assert.match(world.sent[0].subject, /No new internship openings/);
});

test('digest goes out once a day, and later jobs wait for the next day', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.tick();
  world.sent.length = 0;
  world.hour = 23;
  world.jobs = [makeJob('a')];
  world.sandbox.tick();
  assert.equal(world.sent.length, 1);
  assert.match(world.sent[0].body, /a Intern/);

  world.sent.length = 0;
  world.jobs.push(makeJob('b'));
  world.sandbox.tick();
  world.sandbox.tick();
  assert.equal(world.sent.length, 0, 'a second digest must not go out the same day');

  world.day = '2026-11-07';
  world.hour = 0;
  world.sandbox.tick();
  assert.equal(world.sent.length, 0, 'waits for the assigned hour');
  world.hour = 23;
  world.sandbox.tick();
  assert.equal(world.sent.length, 1);
  assert.match(world.sent[0].body, /b Intern/);
  assert.equal(world.sent[0].body.includes('a Intern'), false);
});

test('no-openings email goes once a day to active students only', () => {
  const world = ready([]);
  const { FORM_TITLES: titles, ALERT_STATUS: status } = world.sandbox;
  signUp(world);
  signUp(world, 'r2', { [titles.EMAIL]: 'paused@example.com', [titles.STATUS]: status.PAUSED });
  world.sandbox.tick();
  world.sent.length = 0;
  world.hour = 23;
  world.sandbox.tick();
  world.sandbox.tick();
  assert.equal(toStudents(world).length, 1);
  assert.match(toStudents(world)[0].subject, /No new internship openings/);
  assert.match(toStudents(world)[0].body, /https:\/\/edit\/r1/);
  assert.equal(toStudents(world, 'paused@example.com').length, 0);
  world.day = '2026-11-07';
  world.sandbox.tick();
  assert.equal(toStudents(world).length, 2);
});

test('near the limit, digests with jobs go first and no-openings emails are dropped', () => {
  const world = ready([]);
  const titles = world.sandbox.FORM_TITLES;
  signUp(world, 'r1', { [titles.EMAIL]: 'match@example.com' });
  signUp(world, 'r2', { [titles.EMAIL]: 'nomatch@example.com', [titles.SKILLS]: 'Figma' });
  world.sandbox.tick();
  world.sent.length = 0;
  world.jobs = [makeJob('a')];
  world.sandbox.tick();
  world.hour = 23;
  world.quota = 21;
  world.sandbox.tick();
  assert.equal(toStudents(world, 'match@example.com').length, 1);
  assert.equal(toStudents(world, 'nomatch@example.com').length, 0);
  assert.equal(world.table('Students').find((row) => row.responseId === 'r2').lastDigestDate, '');
});

test('test emails only go to the alerts inbox', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.sendTestEmails();
  assert.equal(world.sent.length, 3);
  assert.ok(world.sent.every((mail) => mail.to === 'owner@example.com' && mail.subject.startsWith('[Test] ')));
  assert.equal(world.table('Queue').filter((row) => row.status === 'sent').length, 0);
});

test('profile updates affect future jobs only, without another sign-up email', () => {
  const world = ready([]);
  const titles = world.sandbox.FORM_TITLES;
  signUp(world);
  world.sandbox.tick();
  world.sent.length = 0;
  world.jobs = [makeJob('rust1', { minQualifications: "Bachelor's. Rust required." })];
  world.hour = 23;
  world.sandbox.tick();
  assert.equal(world.sent.length, 1);
  assert.match(world.sent[0].subject, /No new internship openings/, 'no Rust skill yet');

  world.sent.length = 0;
  signUp(world, 'r1', { [titles.SKILLS]: 'Python, SQL, Rust' });
  assert.equal(world.table('Students').length, 1);
  world.sandbox.tick();
  assert.equal(world.sent.length, 0, 'the earlier job is not sent, and no new confirmation');

  world.day = '2026-11-07';
  world.jobs.push(makeJob('rust2', { minQualifications: "Bachelor's. Rust required." }));
  world.sandbox.tick();
  assert.equal(world.sent.length, 1);
  assert.match(world.sent[0].body, /rust2 Intern/);
  assert.equal(world.sent[0].body.includes('rust1'), false);
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

function staleFeed(world) {
  world.fetch = () => feed([], { generatedAt: new Date(Date.now() - 45 * 60000).toISOString() });
}

test('stale job data starts the watcher on main with the token', () => {
  const world = ready([]);
  staleFeed(world);
  world.sandbox.tick();
  assert.equal(world.dispatches.length, 1);
  const request = world.dispatches[0];
  assert.equal(request.method, 'post');
  assert.equal(request.headers.Authorization, 'Bearer github_pat_test_secret');
  assert.deepEqual(JSON.parse(request.payload), { ref: 'main' });
  assert.equal(world.sent.length, 0, 'a successful start sends no email');
});

test('fresh job data does not start another run', () => {
  const world = ready([]);
  world.sandbox.tick();
  assert.equal(world.dispatches.length, 0);
});

test('an unreadable feed still starts the watcher, so it can recover', () => {
  const world = ready([]);
  world.fetch = () => ({ code: 500, body: '' });
  world.sandbox.tick();
  assert.equal(world.dispatches.length, 1);
});

test('a rejected token alerts once, reports the fix, and never reveals the token', () => {
  const world = ready([]);
  staleFeed(world);
  world.dispatch = { code: 401 };
  world.sandbox.tick();
  world.sandbox.tick();
  const alerts = world.sent.filter((mail) => /Problem: step:watcher/.test(mail.subject));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].body, /may have expired/);
  const everything = JSON.stringify(world.sent) + JSON.stringify(world.table('Logs')) + JSON.stringify(world.sandbox.getStatusData_());
  assert.equal(everything.includes('github_pat_test_secret'), false);

  world.dispatch = { code: 204 };
  world.sandbox.tick();
  assert.equal(world.sent.filter((mail) => /Fixed: step:watcher/.test(mail.subject)).length, 1);
});

test('missing access and a missing token are both reported', () => {
  const world = ready([]);
  staleFeed(world);
  world.dispatch = { code: 403 };
  world.sandbox.tick();
  assert.ok(world.sent.some((mail) => /Actions read and write/.test(mail.body)));

  const none = ready([]);
  delete none.props.GITHUB_DISPATCH_TOKEN;
  staleFeed(none);
  none.sandbox.tick();
  assert.ok(none.sent.some((mail) => /GITHUB_DISPATCH_TOKEN is missing/.test(mail.body)));
});

test('a failed start does not stop the other steps', () => {
  const world = ready([]);
  signUp(world);
  staleFeed(world);
  world.dispatch = { code: 500 };
  world.sandbox.tick();
  assert.equal(toStudents(world).length, 1);
});

test('send now matches every new job and ignores the assigned hour', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.tick();
  world.sent.length = 0;
  world.hour = 0;
  world.jobs = Array.from({ length: 23 }, (_, i) => makeJob(`job${i}`));
  const summary = world.sandbox.sendDigestNow();
  assert.equal(summary.jobsNotYetMatched, 0);
  assert.equal(summary.matchedJobsWaiting, 23);
  assert.equal(summary.digestEmailsSent, 1);
  assert.equal(world.sent.length, 1);
  assert.match(world.sent[0].subject, /23 new internships/);
  assert.equal(world.table('Queue').filter((row) => row.type === 'digest' && row.status === 'pending').length, 0);
});

test('send now works after today\'s digest, without repeating jobs or sending empty emails', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.tick();
  world.hour = 23;
  world.sandbox.tick();
  world.sent.length = 0;
  assert.equal(world.sandbox.sendDigestNow().digestEmailsSent, 0, 'nothing waiting means no email');
  assert.equal(world.sent.length, 0);

  world.jobs = [makeJob('late')];
  world.sandbox.tick();
  assert.equal(world.sent.length, 0, 'the normal cycle waits for tomorrow');
  world.sandbox.sendDigestNow();
  assert.equal(world.sent.length, 1);
  assert.match(world.sent[0].body, /late Intern/);
  world.sent.length = 0;
  world.sandbox.sendDigestNow();
  assert.equal(world.sent.length, 0, 'the same job is not sent twice');
});

test('send now skips paused students and reports a bad feed', () => {
  const world = ready([]);
  const { FORM_TITLES: titles, ALERT_STATUS: status } = world.sandbox;
  signUp(world, 'r1', { [titles.STATUS]: status.PAUSED });
  world.sandbox.tick();
  world.sent.length = 0;
  world.jobs = [makeJob('a')];
  world.sandbox.sendDigestNow();
  assert.equal(world.sent.length, 0);
  world.fetch = () => ({ code: 500, body: '' });
  assert.throws(() => world.sandbox.sendDigestNow(), /Could not read job data/);
});

test('emails put each part of a job under its own heading, in order', () => {
  const mail = logic.buildInstantEmail({
    title: 'Intern', company: 'Acme', location: 'India', url: 'https://x/1', aboutRole: 'Join the team.',
    responsibilities: 'Build things', minQualifications: 'Python', preferredQualifications: 'Docker', fullText: 'Founded in 1999. Free lunch.',
  }, 'https://edit/1', false);
  const order = ['About the role', 'Join the team.', "What you&#39;ll do", 'Build things', 'What they ask for', 'Python', 'Nice to have', 'Docker'];
  let position = -1;
  for (const piece of order) {
    const next = mail.htmlBody.indexOf(piece);
    assert.ok(next > position, `${piece} out of order`);
    position = next;
  }
  assert.equal(mail.htmlBody.includes('Free lunch'), false);
  assert.match(mail.body, /WHAT THEY ASK FOR\n- Python/);
});

test('empty sections show no heading, and long sections say they were shortened', () => {
  const none = logic.buildInstantEmail({ title: 'Intern', company: 'A', location: 'I', url: 'https://x', fullText: 'Everything in one block.' }, 'https://e', false);
  assert.equal(none.htmlBody.includes('What they ask for'), false);
  assert.match(none.htmlBody, /no clear sections/);
  const long = logic.buildInstantEmail({ title: 'Intern', company: 'A', location: 'I', url: 'https://x', minQualifications: Array.from({ length: 20 }, (_, i) => `Skill ${i}`).join('\n') }, 'https://e', false);
  assert.equal(long.htmlBody.includes('Skill 7'), true);
  assert.equal(long.htmlBody.includes('Skill 8'), false);
  assert.match(long.htmlBody, /Shortened for this email/);
});

test('matching and eligibility use the full text when sections are missing', () => {
  const job = { title: 'Intern', minQualifications: '', fullText: 'Graduating in 2029. Experience with Python.' };
  assert.equal(logic.evaluateEligibility(job, bachelor).status, 'eligible');
  assert.equal(logic.routeJob(job, { ...bachelor, skills: 'Python' }, synonyms).channel, 'digest');
  const phd = { title: 'Intern', minQualifications: '', fullText: 'Pursuing a PhD program.' };
  assert.equal(logic.evaluateEligibility(phd, bachelor).status, 'not_eligible');
});

test('new section details reach stored jobs on later syncs', () => {
  const world = ready([makeJob('old')]);
  world.sandbox.tick();
  world.jobs = [makeJob('old', { aboutRole: 'Now with details', fullText: 'All of it' })];
  world.sandbox.tick();
  const row = world.table('Jobs')[0];
  assert.equal(row.aboutRole, 'Now with details');
  assert.equal(row.fullText, 'All of it');
});

test('long role text ends at a full sentence, with joined sentences separated', () => {
  const sentence = 'This sentence describes the programme in some detail.';
  const aboutRole = Array.from({ length: 20 }, () => sentence).join('');
  const mail = logic.buildInstantEmail({ title: 'Intern', company: 'A', location: 'I', url: 'https://x', aboutRole }, 'https://e', false);
  assert.match(mail.body, /detail\.\n/);
  assert.equal(mail.body.includes('detail.This'), false);
  assert.match(mail.htmlBody, /Shortened for this email/);
});

test('old messy text is replaced when a job no longer has that section', () => {
  const world = ready([makeJob('old', { minQualifications: 'Company history and everything else' })]);
  world.sandbox.tick();
  world.jobs = [makeJob('old', { minQualifications: '', aboutRole: 'Clean text' })];
  world.sandbox.tick();
  const row = world.table('Jobs')[0];
  assert.equal(row.minQualifications, '');
  assert.equal(row.aboutRole, 'Clean text');
});

test('until the relaunch, only internship-style roles are stored and remote-only roles wait', () => {
  const world = ready([]);
  signUp(world);
  world.sandbox.tick();
  world.sent.length = 0;
  world.hour = 23;
  world.jobs = [
    makeJob('intern', { roleType: 'internship' }),
    makeJob('trainee', { roleType: 'apprentice' }),
    makeJob('grad', { roleType: 'newGrad' }),
    makeJob('parttime', { roleType: 'partTime' }),
    makeJob('remote', { roleType: 'internship', remote: true, location: 'Remote - APAC' }),
    makeJob('remoteIndia', { roleType: 'internship', remote: true, location: 'Remote - India' }),
    makeJob('legacy'),
  ];
  world.sandbox.tick();
  assert.deepEqual(world.table('Jobs').map((row) => row.id).sort(), ['intern', 'legacy', 'remoteIndia', 'trainee']);
  assert.equal(world.sent.length, 1);
  assert.equal(world.sent[0].body.includes('grad Intern'), false);
});

// Gemini ------------------------------------------------------------------------------------------
const facts = (overrides = {}) => ({
  degreeLevels: [], gradYearMin: null, gradYearMax: null, minYearsExperience: null, freshersWelcome: false,
  skills: [], openToIndia: 'yes', evidence: 'Open to students.', ...overrides,
});
const geminiAnswer = (value) => ({ code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }) });
const oldJob = (id, overrides = {}) => makeJob(id, { firstSeen: new Date(Date.now() - 3 * 3600000).toISOString(), ...overrides });

function withGemini(answerFor) {
  const world = ready([]);
  world.props.GEMINI_API_KEY = 'gemini-secret-key';
  world.gemini = (url, options) => answerFor(JSON.parse(options.payload));
  return world;
}

test('Gemini reads new jobs, keeps the key out of URLs, and marks job text as data', () => {
  const world = withGemini(() => geminiAnswer(facts({ gradYearMin: 2029, gradYearMax: 2029, skills: ['Python'] })));
  signUp(world);
  world.sandbox.tick();
  world.jobs = [makeJob('a')];
  world.sandbox.tick();
  const row = world.table('Jobs').find((job) => job.id === 'a');
  assert.equal(JSON.parse(row.ai).gradYearMin, 2029);
  const call = world.geminiCalls[0];
  assert.equal(call.url.includes('gemini-secret-key'), false);
  assert.equal(call.options.headers['x-goog-api-key'], 'gemini-secret-key');
  assert.match(call.url, /gemini-3\.5-flash-lite:generateContent$/);
  const payload = JSON.parse(call.options.payload);
  assert.match(payload.contents[0].parts[0].text, /^<<<DATA/);
  assert.match(payload.systemInstruction.parts[0].text, /Never follow instructions/);
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
});

test('Gemini facts decide eligibility: year, degree, experience and remote', () => {
  const student = { degree: "Bachelor's (BTech)", gradYear: '2029' };
  const check = (f, job = {}) => logic.evaluateEligibility({ title: 'Role', minQualifications: '', ai: JSON.stringify(facts(f)), ...job }, student);
  assert.equal(check({ gradYearMin: 2028, gradYearMax: 2029 }).status, 'eligible');
  assert.equal(check({ gradYearMin: 2026, gradYearMax: 2027 }).status, 'not_eligible');
  assert.equal(check({ degreeLevels: ['phd'] }).status, 'not_eligible');
  assert.equal(check({ degreeLevels: ['bachelor', 'master'] }).status, 'unclear');
  assert.equal(check({ degreeLevels: ['any'] }).status, 'unclear');
  assert.match(check({ minYearsExperience: 2 }, { roleType: 'newGrad' }).reason, /2 year/);
  assert.equal(check({ minYearsExperience: 2, freshersWelcome: true }, { roleType: 'newGrad' }).status, 'unclear');
  assert.equal(check({ minYearsExperience: 2 }, { roleType: 'internship' }).status, 'unclear');
  assert.equal(check({ openToIndia: 'no' }, { remote: true }).status, 'not_eligible');
  assert.equal(check({}).quote, 'Open to students.');
});

test('Gemini skill names map onto the synonym list', () => {
  const job = { title: 'Intern', minQualifications: '', ai: JSON.stringify(facts({ skills: ['Golang', 'PostgreSQL', 'Kafka'] })) };
  const result = logic.matchScore(job, { skills: 'go, sql' }, synonyms);
  assert.equal(result.score, 2);
  assert.equal(result.jobSkillCount, 3);
});

test('bad or out-of-range answers are cleaned before they are stored', () => {
  const cleaned = logic.cleanJobFacts_({ degreeLevels: ['Bachelor', 'wizard'], gradYearMin: 2031, gradYearMax: 2027, minYearsExperience: -4, freshersWelcome: 'yes', skills: 'python', openToIndia: 'maybe', evidence: 'x'.repeat(900) });
  assert.deepEqual([...cleaned.degreeLevels], ['bachelor']);
  assert.equal(cleaned.gradYearMin, 2027);
  assert.equal(cleaned.gradYearMax, 2031);
  assert.equal(cleaned.minYearsExperience, null);
  assert.equal(cleaned.freshersWelcome, false);
  assert.deepEqual([...cleaned.skills], []);
  assert.equal(cleaned.openToIndia, 'unclear');
  assert.equal(cleaned.evidence.length, 300);
  assert.equal(logic.cleanJobFacts_({ gradYearMin: 1999 }).gradYearMin, null);
});

test('a new job waits for Gemini, but never longer than the wait limit', () => {
  const world = ready([]);
  world.props.GEMINI_API_KEY = 'k';
  world.gemini = () => ({ code: 500, body: '' });
  signUp(world);
  world.sandbox.tick();
  world.props.GEMINI_PAUSED_UNTIL = String(Date.now() - 1);
  world.sandbox.CONFIG.GEMINI_READS_PER_TICK = 0;
  world.jobs = [makeJob('fresh'), oldJob('stale'), makeJob('vip', { priority: true, firstSeen: new Date(Date.now() - 30 * 60000).toISOString() })];
  world.sandbox.tick();
  const processed = Object.fromEntries(world.table('Jobs').map((job) => [job.id, Boolean(job.processedAt)]));
  assert.deepEqual(processed, { fresh: false, stale: true, vip: true });
});

test('when Google says the limit is reached, Gemini pauses quietly and the rules match jobs', () => {
  const world = withGemini(() => ({ code: 429, body: '' }));
  signUp(world);
  world.sandbox.tick();
  world.sent.length = 0;
  world.hour = 23;
  world.jobs = [makeJob('a')];
  world.sandbox.tick();
  assert.match(world.sandbox.geminiBlocked_(), /Paused/);
  assert.equal(world.table('Jobs').find((job) => job.id === 'a').processedAt !== '', true, 'matched by the rules straight away');
  assert.equal(world.sent.filter((mail) => /Problem/.test(mail.subject)).length, 0);
  assert.equal(world.sent.filter((mail) => mail.to === 'asha@example.com').length, 1);
  assert.equal(world.geminiCalls.length, 1, 'no more calls while paused');
});

test('the daily cap stops requests', () => {
  const world = withGemini(() => geminiAnswer(facts()));
  world.sandbox.CONFIG.GEMINI_DAILY_LIMIT = 2;
  world.sandbox.tick();
  world.jobs = [makeJob('a'), makeJob('b'), makeJob('c')];
  world.sandbox.tick();
  assert.equal(world.geminiCalls.length, 2);
  assert.match(world.sandbox.geminiBlocked_(), /Daily cap/);
});

test('a rejected key raises one alert and never reveals the key', () => {
  const world = withGemini(() => ({ code: 400, body: '{"error":{"message":"API key not valid. API_KEY_INVALID"}}' }));
  world.sandbox.tick();
  world.jobs = [makeJob('a'), makeJob('b')];
  world.sandbox.tick();
  world.sandbox.tick();
  const alerts = world.sent.filter((mail) => /Problem: step:gemini/.test(mail.subject));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].body, /rejected the API key/);
  const everything = JSON.stringify(world.sent) + JSON.stringify(world.table('Logs')) + JSON.stringify(world.table('Jobs')) + JSON.stringify(world.sandbox.getStatusData_());
  assert.equal(everything.includes('gemini-secret-key'), false);
});

test('one unreadable job is recorded and the rest continue', () => {
  let calls = 0;
  const world = withGemini(() => (++calls === 1 ? { code: 200, body: '{"candidates":[]}' } : geminiAnswer(facts())));
  world.sandbox.tick();
  world.jobs = [makeJob('a'), makeJob('b')];
  world.sandbox.tick();
  const rows = world.table('Jobs');
  assert.equal(rows.filter((job) => job.aiError).length, 1);
  assert.equal(rows.filter((job) => job.ai).length, 1);
  assert.equal(world.sent.filter((mail) => /Problem/.test(mail.subject)).length, 0);
});

test('profiles are not sent to Gemini until the consent switch is on', () => {
  const world = withGemini((payload) => (/list the concrete skills/.test(payload.systemInstruction.parts[0].text) ? geminiAnswer({ skills: ['Rust', 'Kafka'] }) : geminiAnswer(facts())));
  signUp(world);
  world.sandbox.tick();
  assert.equal(world.geminiCalls.filter((call) => /concrete skills/.test(call.options.payload)).length, 0);
  world.sandbox.CONFIG.AI_READS_PROFILES = true;
  world.sandbox.tick();
  const student = world.table('Students')[0];
  assert.deepEqual(JSON.parse(student.ai).skills, ['rust', 'kafka']);
  assert.ok(logic.studentSkillSet({ ...student, ai: student.ai }, synonyms).includes('rust'));
  signUp(world, 'r1', { [world.sandbox.FORM_TITLES.SKILLS]: 'Python, Go' });
  assert.equal(world.table('Students')[0].aiReadAt, '', 'an edit means it is read again');
});

test('status page shows Gemini usage', () => {
  const world = withGemini(() => geminiAnswer(facts()));
  world.sandbox.tick();
  world.jobs = [makeJob('a')];
  world.sandbox.tick();
  const data = world.sandbox.getStatusData_();
  assert.equal(data.geminiStatus, 'Working');
  assert.equal(data.geminiUsedToday, 1);
  assert.equal(data.jobsReadByGemini, 1);
  assert.match(data.profilesReadByGemini, /Off until/);
  assert.match(renderStatus(data), /Requests today/);
});

