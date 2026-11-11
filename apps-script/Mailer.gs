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

/** Sends by the student's chosen route. emailOnly is for messages that must carry their edit link. */
function attemptSend_(rows, student, message, emailOnly) {
  try {
    if (emailOnly) sendMail_(student.email, message);
    else deliver_(student, message);
    markResult_(rows, null);
    return true;
  } catch (error) {
    markResult_(rows, error.message);
    log_('ERROR', 'email', 'A ' + rows[0].type + ' message failed: ' + error.message);
    return false;
  }
}

/** 1 is Monday and 7 is Sunday, in India time. */
function istWeekday_() {
  return Number(Utilities.formatDate(new Date(), 'Asia/Kolkata', 'u'));
}

function istDate_() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
}

/** Sends instant alerts first, then each student's digest, then reminders. */
function sendQueued_(deadline) {
  var pending = readTable_('Queue').filter(function (row) { return row.status === 'pending'; });
  var students = {};
  readTable_('Students').forEach(function (row) { students[row.responseId] = row; });
  var jobs = {};
  readTable_('Jobs').forEach(function (row) { jobs[row.id] = row; });

  // Rows that can never be sent are dropped, so they don't wait forever.
  pending = pending.filter(function (row) {
    var job = jobs[row.jobId];
    var dead = !students[row.responseId] || ((row.type === 'instant' || row.type === 'digest') && (!job || !isTrue_(job.open)));
    if (dead) {
      row.status = 'dropped';
      updateRow_('Queue', row);
    }
    return !dead;
  });
  var ofType = function (type) { return pending.filter(function (row) { return row.type === type; }); };
  var hasRoom = function (minimum) { return MailApp.getRemainingDailyQuota() > minimum && Date.now() < deadline; };
  // Telegram-only students don't use the Gmail allowance.
  var roomFor = function (student, minimum) { return Date.now() < deadline && (!needsEmail_(student) || hasRoom(minimum)); };

  ofType('notice').forEach(function (row) {
    var student = students[row.responseId];
    if (student && student.unknownCompanies && hasRoom(CONFIG.QUOTA_RESERVED_FOR_INSTANT)) {
      attemptSend_([row], student, buildUnknownCompaniesEmail(student.name, student.editUrl, student.unknownCompanies), true);
    } else if (student && !student.unknownCompanies) {
      markResult_([row], null);
    }
  });

  ofType('confirmation').forEach(function (row) {
    var student = students[row.responseId];
    if (!student || !hasRoom(CONFIG.QUOTA_RESERVED_FOR_INSTANT)) return;
    attemptSend_([row], student, buildConfirmationEmail(student.name, student.editUrl, student.unknownCompanies, wantsTelegram_(student) ? telegramLink_(student) : ''), true);
  });

  ofType('instant').forEach(function (row) {
    var student = students[row.responseId];
    if (!student || !jobs[row.jobId] || !roomFor(student, 0)) return;
    attemptSend_([row], student, buildInstantEmail(jobs[row.jobId], student.editUrl, isTrue_(row.checkEligibility)));
  });

  sendDailyDigests_(students, ofType('digest'), jobs, roomFor);

  ofType('reminder').forEach(function (row) {
    var student = students[row.responseId];
    if (student && roomFor(student, CONFIG.QUOTA_MIN_FOR_REMINDERS)) {
      attemptSend_([row], student, buildReminderEmail(student.name, student.editUrl));
    }
  });
}

/**
 * Each active student gets one digest per India date (weekly students on Sundays), from their
 * assigned hour. Jobs found after it goes out wait for the next one. Digests with jobs go
 * first, so "no openings" messages are the first to be dropped when the daily limit is close.
 */
function sendDailyDigests_(students, digestRows, jobs, roomFor, sendNow) {
  var hour = istHour_();
  var today = istDate_();
  var rowsFor = {};
  digestRows.forEach(function (row) {
    if (jobs[row.jobId]) (rowsFor[row.responseId] = rowsFor[row.responseId] || []).push(row);
  });
  var due = Object.keys(students).map(function (id) { return students[id]; }).filter(function (student) {
    if (student.status !== 'active') return false;
    if (sendNow) return true;
    if (student.frequency === 'weekly' && istWeekday_() !== 7) return false;
    return String(student.lastDigestDate) !== today && hour >= digestHour(student.email);
  });
  var withJobs = due.filter(function (student) { return rowsFor[student.responseId]; });
  var withoutJobs = sendNow ? [] : due.filter(function (student) { return !rowsFor[student.responseId]; });

  withJobs.concat(withoutJobs).forEach(function (student) {
    if (!roomFor(student, CONFIG.QUOTA_RESERVED_FOR_INSTANT)) return;
    var rows = rowsFor[student.responseId];
    var sent;
    if (rows) {
      var items = rows.map(function (row) {
        return { job: jobs[row.jobId], checkEligibility: isTrue_(row.checkEligibility) };
      });
      sent = attemptSend_(rows, student, buildDigestEmail(items, student.editUrl));
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
    deliver_(student, buildNoOpeningsEmail(student.name, student.editUrl, student.frequency === 'weekly'));
    return true;
  } catch (error) {
    log_('ERROR', 'email', 'A no-openings message failed: ' + error.message);
    return false;
  }
}

/**
 * Run by hand from the editor. Fetches the latest jobs, matches all of them, and sends any
 * waiting digests to every active student straight away, ignoring their assigned hour. A
 * student with nothing waiting gets nothing, so this can't send a second "no openings".
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
    var sentBefore = readTable_('Queue').filter(function (row) { return row.type === 'digest' && row.status === 'sent'; }).length;
    var roomFor = function (student, minimum) {
      return Date.now() < deadline && (!needsEmail_(student) || MailApp.getRemainingDailyQuota() > minimum);
    };
    sendDailyDigests_(students, waiting, jobs, roomFor, true);
    var studentsReached = {};
    readTable_('Queue').filter(function (row) { return row.type === 'digest' && row.status === 'sent'; }).slice(sentBefore)
      .forEach(function (row) { studentsReached[row.responseId] = true; });

    var summary = {
      jobsNotYetMatched: unmatched(),
      matchedJobsWaiting: waiting.length,
      digestsSent: Object.keys(studentsReached).length,
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

/** Sends waiting sign-up confirmations only. Called right after a sign-up and by quickTick. */
function sendConfirmationsNow_() {
  var waiting = readTable_('Queue').filter(function (row) { return (row.type === 'confirmation' || row.type === 'telegram') && row.status === 'pending'; });
  if (!waiting.length) return;
  var students = {};
  readTable_('Students').forEach(function (row) { students[row.responseId] = row; });
  waiting.forEach(function (row) {
    var student = students[row.responseId];
    if (!student || MailApp.getRemainingDailyQuota() <= CONFIG.QUOTA_RESERVED_FOR_INSTANT) return;
    if (row.type === 'telegram') {
      if (student.telegramChatId || !telegramLink_(student)) return markResult_([row], null);
      return attemptSend_([row], student, buildTelegramLinkEmail(student.name, student.editUrl, telegramLink_(student)), true);
    }
    attemptSend_([row], student, buildConfirmationEmail(student.name, student.editUrl, student.unknownCompanies, wantsTelegram_(student) ? telegramLink_(student) : ''), true);
  });
}
