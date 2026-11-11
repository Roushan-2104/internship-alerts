function enqueue_(type, student, jobId, checkEligibility) {
  appendRow_('Queue', {
    queueId: Utilities.getUuid(), type: type, responseId: student.responseId, email: student.email,
    jobId: jobId, checkEligibility: Boolean(checkEligibility), status: 'pending', attempts: 0,
    createdAt: new Date().toISOString(), sentAt: '', error: ''
  });
}

function sendMail_(to, message) {
  MailApp.sendEmail({ to: to, subject: message.subject, body: message.body, htmlBody: message.htmlBody, name: CONFIG.SENDER_NAME });
}

function istHour_() {
  return Number(Utilities.formatDate(new Date(), 'Asia/Kolkata', 'H'));
}

function markResult_(rows, error) {
  rows.forEach(function (row) {
    row.attempts = Number(row.attempts || 0) + 1;
    if (error) {
      row.error = String(error).slice(0, 300);
      row.status = row.attempts >= CONFIG.MAX_SEND_ATTEMPTS ? 'failed' : 'pending';
    } else {
      row.status = 'sent';
      row.sentAt = new Date().toISOString();
      row.error = '';
    }
    updateRow_('Queue', row);
  });
}

function attemptSend_(rows, email, message) {
  try {
    sendMail_(email, message);
    markResult_(rows, null);
    return true;
  } catch (error) {
    markResult_(rows, error.message);
    log_('ERROR', 'email', 'A ' + rows[0].type + ' email failed: ' + error.message);
    return false;
  }
}

function istDate_() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
}

/** Sends instant alerts first, then each student's daily digest, then reminders. */
function sendQueued_(deadline) {
  var pending = readTable_('Queue').filter(function (row) { return row.status === 'pending'; });
  var students = {};
  readTable_('Students').forEach(function (row) { students[row.responseId] = row; });
  var jobs = {};
  readTable_('Jobs').forEach(function (row) { jobs[row.id] = row; });

  var ofType = function (type) { return pending.filter(function (row) { return row.type === type; }); };
  var hasRoom = function (minimum) { return MailApp.getRemainingDailyQuota() > minimum && Date.now() < deadline; };

  ofType('instant').concat(ofType('confirmation')).forEach(function (row) {
    var student = students[row.responseId];
    if (!student || !hasRoom(0)) return;
    if (row.type === 'confirmation') {
      attemptSend_([row], row.email, buildConfirmationEmail(student.name, student.editUrl));
    } else if (jobs[row.jobId]) {
      attemptSend_([row], row.email, buildInstantEmail(jobs[row.jobId], student.editUrl, isTrue_(row.checkEligibility)));
    }
  });

  sendDailyDigests_(students, ofType('digest'), jobs, hasRoom);

  ofType('reminder').forEach(function (row) {
    var student = students[row.responseId];
    if (student && hasRoom(CONFIG.QUOTA_MIN_FOR_REMINDERS)) {
      attemptSend_([row], row.email, buildReminderEmail(student.name, student.editUrl));
    }
  });
}

/**
 * Each active student gets one digest per India date, from their assigned hour. Jobs found
 * after it goes out wait for the next day. Digests with jobs go first, so "no openings"
 * emails are the first to be dropped when the daily limit is close.
 */
function sendDailyDigests_(students, digestRows, jobs, hasRoom, sendNow) {
  var hour = istHour_();
  var today = istDate_();
  var rowsFor = {};
  digestRows.forEach(function (row) {
    if (jobs[row.jobId]) (rowsFor[row.responseId] = rowsFor[row.responseId] || []).push(row);
  });
  var due = Object.keys(students).map(function (id) { return students[id]; }).filter(function (student) {
    if (student.status !== 'active') return false;
    return sendNow || (String(student.lastDigestDate) !== today && hour >= digestHour(student.email));
  });
  var withJobs = due.filter(function (student) { return rowsFor[student.responseId]; });
  var withoutJobs = sendNow ? [] : due.filter(function (student) { return !rowsFor[student.responseId]; });

  withJobs.concat(withoutJobs).forEach(function (student) {
    if (!hasRoom(CONFIG.QUOTA_RESERVED_FOR_INSTANT)) return;
    var rows = rowsFor[student.responseId];
    var sent;
    if (rows) {
      var items = rows.map(function (row) {
        return { job: jobs[row.jobId], checkEligibility: isTrue_(row.checkEligibility) };
      });
      sent = attemptSend_(rows, student.email, buildDigestEmail(items, student.editUrl));
    } else {
      sent = attemptNoOpenings_(student);
    }
    if (sent) {
      student.lastDigestDate = today;
      updateRow_('Students', student);
    }
  });
}

function attemptNoOpenings_(student) {
  try {
    sendMail_(student.email, buildNoOpeningsEmail(student.name, student.editUrl));
    return true;
  } catch (error) {
    log_('ERROR', 'email', 'A no-openings email failed: ' + error.message);
    return false;
  }
}

/**
 * Run by hand from the editor. Fetches the latest jobs, matches all of them, and sends any
 * waiting digests to every active student straight away, ignoring their assigned hour. A
 * student with nothing waiting gets no email, so this can't send a second "no openings".
 */
function sendDigestNow() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another run is in progress. Try again in a minute.');
  try {
    var deadline = Date.now() + 240000;
    var feed = { payload: null, error: null };
    syncJobs_(feed, deadline);
    if (feed.error) throw new Error('Could not read job data: ' + feed.error);
    var unmatched = function () {
      return readTable_('Jobs').filter(function (job) { return !job.processedAt; }).length;
    };
    while (unmatched() > 0 && Date.now() < deadline) matchNewJobs_(deadline, true);

    var students = {};
    readTable_('Students').forEach(function (row) { students[row.responseId] = row; });
    var jobs = {};
    readTable_('Jobs').forEach(function (row) { jobs[row.id] = row; });
    var waiting = readTable_('Queue').filter(function (row) { return row.type === 'digest' && row.status === 'pending'; });
    var before = MailApp.getRemainingDailyQuota();
    var hasRoom = function (minimum) { return MailApp.getRemainingDailyQuota() > minimum && Date.now() < deadline; };
    sendDailyDigests_(students, waiting, jobs, hasRoom, true);

    var summary = {
      jobsNotYetMatched: unmatched(),
      matchedJobsWaiting: waiting.length,
      digestEmailsSent: before - MailApp.getRemainingDailyQuota(),
      activeStudents: Object.keys(students).filter(function (id) { return students[id].status === 'active'; }).length
    };
    Logger.log(JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    lock.releaseLock();
  }
}

/** Run by hand from the editor. Sends samples of each job email to the alerts inbox only. */
function sendTestEmails() {
  var job = {
    title: 'Sample Software Intern (test only)', company: 'Example Company', location: 'Bengaluru, India',
    url: 'https://example.com/sample-job', deadline: 'Not listed',
    aboutRole: 'This sample shows how each section of a job appears in your emails.',
    responsibilities: 'Build internal tools.\nWork with a mentor.',
    minQualifications: "Pursuing a Bachelor's degree.\nExperience with Python.",
    preferredQualifications: 'Experience with SQL.'
  };
  var editUrl = 'https://example.com/your-personal-link';
  [
    buildInstantEmail(job, editUrl, true),
    buildDigestEmail([{ job: job, checkEligibility: false }], editUrl),
    buildNoOpeningsEmail('Test', editUrl)
  ].forEach(function (message) {
    message.subject = '[Test] ' + message.subject;
    sendMail_(CONFIG.ALERT_EMAIL, message);
  });
}

function queueReminders_() {
  readTable_('Students').forEach(function (student) {
    if (student.status === 'active' && daysSince_(student.lastReminderAt) >= CONFIG.REMINDER_EVERY_DAYS) {
      enqueue_('reminder', student, '', false);
      student.lastReminderAt = new Date().toISOString();
      updateRow_('Students', student);
    }
  });
}
