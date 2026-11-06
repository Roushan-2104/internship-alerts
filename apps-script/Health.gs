function findProblems_(feed, errors) {
  var problems = {};
  if (feed.error) problems.feed = 'Could not read jobs.json: ' + feed.error;
  if (feed.payload) {
    var ageHours = (Date.now() - new Date(feed.payload.generatedAt).getTime()) / 3600000;
    if (!(ageHours <= CONFIG.STALE_AFTER_HOURS)) {
      problems.stale = 'jobs.json has not updated for ' + Math.round(ageHours) + ' hours. GitHub Actions may have stopped.';
    }
    Object.keys(feed.payload.sources || {}).forEach(function (name) {
      var source = feed.payload.sources[name];
      if (!source.ok) problems['source:' + name] = name + ' failed: ' + (source.error || 'unknown error');
    });
  }
  if (MailApp.getRemainingDailyQuota() <= CONFIG.QUOTA_ALERT_REMAINING) {
    problems.quota = 'Only ' + MailApp.getRemainingDailyQuota() + ' email recipients left today.';
  }
  (errors || []).forEach(function (message) {
    if (message.indexOf('health:') !== 0) problems['step:' + message.split(':')[0]] = message;
  });
  return problems;
}

/** Sends one email when a problem starts and one when it clears, so an outage can't flood the inbox. */
function checkHealth_(feed, errors) {
  var problems = findProblems_(feed, errors);
  var open = JSON.parse(prop_('OPEN_INCIDENTS') || '{}');
  Object.keys(problems).forEach(function (key) {
    if (!open[key]) {
      alertOwner_('Problem: ' + key, problems[key]);
      open[key] = new Date().toISOString();
    }
  });
  Object.keys(open).forEach(function (key) {
    if (!problems[key]) {
      alertOwner_('Fixed: ' + key, 'This problem has cleared. It started at ' + open[key] + '.');
      delete open[key];
    }
  });
  setProp_('OPEN_INCIDENTS', JSON.stringify(open));
  setProp_('CURRENT_PROBLEMS', JSON.stringify(problems));
  if (feed.payload) {
    setProp_('LAST_FEED', JSON.stringify({ generatedAt: feed.payload.generatedAt, sources: feed.payload.sources }));
  }
}

function alertOwner_(subject, message) {
  log_('ALERT', 'health', subject + ': ' + message);
  if (MailApp.getRemainingDailyQuota() > 0) {
    MailApp.sendEmail({ to: CONFIG.ALERT_EMAIL, subject: '[Internship Alerts] ' + subject, body: message, name: CONFIG.SENDER_NAME });
  }
}

/** If this weekly email stops arriving, Apps Script itself has stopped. */
function sendHeartbeat() {
  var data = getStatusData_();
  var body = [
    'Internship Alerts is still running.',
    'Status: ' + data.overall,
    'Last run: ' + data.lastTickAt,
    'Active students: ' + data.studentsActive,
    'Open jobs: ' + data.jobsOpen,
    'Emails waiting: ' + data.queuePending
  ].join('\n');
  MailApp.sendEmail({ to: CONFIG.ALERT_EMAIL, subject: '[Internship Alerts] Still running', body: body, name: CONFIG.SENDER_NAME });
}

function getStatusData_() {
  var today = new Date().toISOString().slice(0, 10);
  var students = readTable_('Students');
  var jobs = readTable_('Jobs');
  var queue = readTable_('Queue');
  var matches = readTable_('Matches');
  var problems = JSON.parse(prop_('CURRENT_PROBLEMS') || '{}');
  var feed = JSON.parse(prop_('LAST_FEED') || '{"sources":{}}');
  var quota = MailApp.getRemainingDailyQuota();
  var warnings = [];

  var form = FormApp.openById(prop_('FORM_ID'));
  var hasResume = form.getItems().some(function (item) { return item.getType() === FormApp.ItemType.FILE_UPLOAD; });
  if (!hasResume) warnings.push('The resume upload question has not been added to the form yet.');

  var failed = queue.filter(function (row) { return row.status === 'failed'; }).length;
  if (failed) warnings.push(failed + ' email(s) failed after retries.');
  var lastTick = prop_('LAST_TICK_AT');
  if (!lastTick || daysSince_(lastTick) > 2 / 24) warnings.push('The script has not completed a run in the last 2 hours.');

  var problemList = Object.keys(problems).map(function (key) { return problems[key]; });
  return {
    overall: problemList.length ? 'Red' : warnings.length ? 'Yellow' : 'Green',
    problems: problemList,
    warnings: warnings,
    lastTickAt: lastTick || 'Never',
    feedGeneratedAt: feed.generatedAt || 'Never',
    sources: Object.keys(feed.sources).map(function (name) {
      var source = feed.sources[name];
      return { name: name, ok: source.ok, count: source.count, error: source.error || '' };
    }),
    jobsOpen: jobs.filter(function (job) { return isTrue_(job.open); }).length,
    jobsNewToday: jobs.filter(function (job) { return String(job.firstSeen).slice(0, 10) === today; }).length,
    checkEligibility: matches.filter(function (m) { return m.status === 'unclear' && m.channel !== 'none'; }).length,
    quotaRemaining: quota,
    sentToday: queue.filter(function (row) { return String(row.sentAt).slice(0, 10) === today; }).length,
    queuePending: queue.filter(function (row) { return row.status === 'pending'; }).length,
    studentsActive: students.filter(function (s) { return s.status === 'active'; }).length,
    studentsPaused: students.filter(function (s) { return s.status === 'paused'; }).length,
    profilesUpdatedThisWeek: students.filter(function (s) { return daysSince_(s.updatedAt) <= 7; }).length,
    githubPending: students.filter(function (s) { return s.status === 'active' && s.githubUser && !s.githubScannedAt; }).length,
    githubFailed: students.filter(function (s) { return s.githubError; }).length,
    resumeFailed: students.filter(function (s) { return s.resumeError; }).length,
    logs: readTable_('Logs').filter(function (row) { return row.level !== 'INFO'; }).slice(-20).reverse()
  };
}

/** Status page. The deployment is set to "Only myself", so Google enforces who can open it. */
function doGet() {
  var template = HtmlService.createTemplateFromFile('Status');
  template.data = getStatusData_();
  return template.evaluate().setTitle('Internship Alerts Status');
}
