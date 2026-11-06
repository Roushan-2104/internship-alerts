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

/** Sends instant alerts first, then digests spread across the day, then reminders. */
function sendQueued_(deadline) {
  var pending = readTable_('Queue').filter(function (row) { return row.status === 'pending'; });
  if (!pending.length) return;
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

  var hour = istHour_();
  var byStudent = {};
  ofType('digest').forEach(function (row) { (byStudent[row.responseId] = byStudent[row.responseId] || []).push(row); });
  Object.keys(byStudent).forEach(function (responseId) {
    var rows = byStudent[responseId];
    var student = students[responseId];
    if (!student || hour < digestHour(student.email) || !hasRoom(CONFIG.QUOTA_RESERVED_FOR_INSTANT)) return;
    var items = rows.filter(function (row) { return jobs[row.jobId]; }).map(function (row) {
      return { job: jobs[row.jobId], checkEligibility: isTrue_(row.checkEligibility) };
    });
    if (items.length) attemptSend_(rows, student.email, buildDigestEmail(items, student.editUrl));
  });

  ofType('reminder').forEach(function (row) {
    var student = students[row.responseId];
    if (student && hasRoom(CONFIG.QUOTA_MIN_FOR_REMINDERS)) {
      attemptSend_([row], row.email, buildReminderEmail(student.name, student.editUrl));
    }
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
