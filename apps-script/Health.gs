function findProblems_(feed, errors) {
  var problems = {};
  if (feed.error) problems.feed = 'Could not read jobs.json: ' + feed.error;
  if (feed.payload) {
    var ageHours = (Date.now() - new Date(feed.payload.generatedAt).getTime()) / 3600000;
    if (!(ageHours <= CONFIG.STALE_AFTER_HOURS)) {
      problems.stale = 'jobs.json has not updated for ' + Math.round(ageHours) + ' hours. GitHub Actions may have stopped.';
    }
    // One alert for all failing sources, so a flaky board can't use up the email allowance.
    var failing = Object.keys(feed.payload.sources || {}).filter(function (name) { return !feed.payload.sources[name].ok; }).sort();
    if (failing.length) {
      problems['sources:' + failing.join(',').slice(0, 200)] = failing.map(function (name) {
        return name + ' failed: ' + (feed.payload.sources[name].error || 'unknown error');
      }).join('\n');
    }
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
  var today = istDate_();
  var istDay = function (iso) { return iso ? Utilities.formatDate(new Date(iso), 'Asia/Kolkata', 'yyyy-MM-dd') : ''; };
  var students = readTable_('Students');
  var jobs = readTable_('Jobs');
  var queue = readTable_('Queue');
  var matches = readTable_('Matches');
  var problems = JSON.parse(prop_('CURRENT_PROBLEMS') || '{}');
  var feed = JSON.parse(prop_('LAST_FEED') || '{"sources":{}}');
  var quota = MailApp.getRemainingDailyQuota();
  var warnings = [];

  var form = FormApp.openById(prop_('FORM_ID'));
  var hasUpload = function (f) { return f.getItems().some(function (item) { return item.getType() === FormApp.ItemType.FILE_UPLOAD; }); };
  var signUpForm = prop_('NEW_FORM_ID') ? FormApp.openById(prop_('NEW_FORM_ID')) : form;
  if (!hasUpload(signUpForm)) warnings.push('The sign-up form still needs its resume upload question.');
  if (!isLaunched_()) warnings.push('Not launched yet: the old form is still in use, and new-grad and most remote roles are held back.');
  if (prop_('TELEGRAM_BOT_TOKEN') && !CONFIG.TELEGRAM_BOT_USERNAME) warnings.push('Telegram token saved, but the bot username is not set yet.');

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
    jobsNewToday: jobs.filter(function (job) { return istDay(job.firstSeen) === today; }).length,
    checkEligibility: matches.filter(function (m) { return m.status === 'unclear' && m.channel !== 'none'; }).length,
    quotaRemaining: quota,
    sentToday: queue.filter(function (row) { return row.status === 'sent' && istDay(row.sentAt) === today; }).length,
    digestsToday: students.filter(function (s) { return String(s.lastDigestDate) === today; }).length,
    queuePending: queue.filter(function (row) { return row.status === 'pending'; }).length,
    studentsActive: students.filter(function (s) { return s.status === 'active'; }).length,
    studentsPaused: students.filter(function (s) { return s.status === 'paused'; }).length,
    signUpFormUrl: prop_('NEW_FORM_ID') ? FormApp.openById(prop_('NEW_FORM_ID')).getPublishedUrl() : '',
    signUpFormEditUrl: prop_('NEW_FORM_ID') ? FormApp.openById(prop_('NEW_FORM_ID')).getEditUrl() : '',
    launched: isLaunched_(),
    studentsWeekly: students.filter(function (s) { return s.status === 'active' && s.frequency === 'weekly'; }).length,
    studentsTelegram: students.filter(function (s) { return s.status === 'active' && s.telegramChatId; }).length,
    profilesUpdatedThisWeek: students.filter(function (s) { return daysSince_(s.updatedAt) <= 7; }).length,
    githubPending: students.filter(function (s) { return s.status === 'active' && s.githubUser && !s.githubScannedAt; }).length,
    githubFailed: students.filter(function (s) { return s.githubError; }).length,
    resumeFailed: students.filter(function (s) { return s.resumeError; }).length,
    geminiStatus: geminiBlocked_() || 'Working',
    geminiUsedToday: geminiUsedToday_(),
    geminiDailyLimit: CONFIG.GEMINI_DAILY_LIMIT,
    jobsReadByGemini: jobs.filter(function (job) { return job.aiReadAt && !job.aiError; }).length,
    jobsGeminiFailed: jobs.filter(function (job) { return job.aiError; }).length,
    profilesReadByGemini: students.filter(function (s) { return s.aiReadAt && s.ai; }).length + ' read (only students who agreed)',
    logs: readTable_('Logs').filter(function (row) { return row.level !== 'INFO'; }).slice(-20).reverse()
  };
}

/** Status page. The deployment is set to "Only myself", so Google enforces who can open it. */
function doGet() {
  var template = HtmlService.createTemplateFromFile('Status');
  template.data = getStatusData_();
  return template.evaluate().setTitle('Internship Alerts Status');
}
