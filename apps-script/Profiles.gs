/** Fires for new sign-ups and for edits made through a student's personal link. */
function onFormSubmit(e) {
  var lock = LockService.getScriptLock();
  var formId = e.source ? e.source.getId() : prop_('FORM_ID');
  // A run may hold the lock for minutes. Rather than lose the sign-up, the next run handles it.
  if (!lock.tryLock(25000)) {
    var deferred = JSON.parse(prop_('DEFERRED_RESPONSES') || '[]');
    deferred.push({ formId: formId, responseId: e.response.getId() });
    setProp_('DEFERRED_RESPONSES', JSON.stringify(deferred));
    return;
  }
  try {
    handleResponse_(e.response, formId);
  } catch (error) {
    log_('ERROR', 'form', error.message);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function responseFields_(response) {
  var answers = {};
  response.getItemResponses().forEach(function (item) {
    answers[item.getItem().getTitle()] = item.getResponse();
  });
  var resume = answers[FORM_TITLES.RESUME];
  return {
    name: String(answers[FORM_TITLES.NAME] || '').replace(/\s+/g, ' ').trim().slice(0, CONFIG.NAME_MAX_CHARS),
    // The new form confirms the email through Google sign-in. The old form asked for it.
    email: String((response.getRespondentEmail && response.getRespondentEmail()) || answers[FORM_TITLES.EMAIL] || '').trim().toLowerCase(),
    degree: answers[FORM_TITLES.DEGREE] || '',
    gradYear: answers[FORM_TITLES.GRAD_YEAR] || '',
    skills: answers[FORM_TITLES.SKILLS] || '',
    experience: answers[FORM_TITLES.EXPERIENCE] || '',
    projects: answers[FORM_TITLES.PROJECTS] || '',
    privateProjects: answers[FORM_TITLES.PRIVATE_PROJECTS] || '',
    github: String(answers[FORM_TITLES.GITHUB] || '').trim(),
    interests: answers[FORM_TITLES.INTERESTS] || '',
    resumeFileId: Array.isArray(resume) && resume.length ? resume[0] : '',
    alertStatus: answers[FORM_TITLES.STATUS] || ALERT_STATUS.ACTIVE,
    consent: String(answers[FORM_TITLES.CONSENT] || ''),
    roleTypes: roleCodes_(answers[FORM_TITLES.ROLE_TYPES]).join(', '),
    locations: splitList_(answers[FORM_TITLES.LOCATIONS]).join(', '),
    areas: splitList_(answers[FORM_TITLES.AREAS]).join(', '),
    includeCompanies: String(answers[FORM_TITLES.ALWAYS_COMPANIES] || '').trim(),
    excludeCompanies: String(answers[FORM_TITLES.NEVER_COMPANIES] || '').trim(),
    frequency: /weekly/i.test(answers[FORM_TITLES.FREQUENCY] || '') ? 'weekly' : 'daily',
    channel: (CHANNEL_CHOICES.filter(function (pair) { return pair[0] === answers[FORM_TITLES.CHANNEL]; })[0] || ['', 'email'])[1]
  };
}

function handleResponse_(response, formId) {
  var fields = responseFields_(response);
  if (!fields.email) throw new Error('A sign-up had no email address, so it was skipped.');
  var responseId = response.getId();
  var students = readTable_('Students');
  var current = students.filter(function (row) { return row.responseId === responseId; })[0];

  // A second sign-up from the same address replaces the first, so nobody gets duplicate emails.
  // Only a Google-verified email can do this, so nobody can replace or delete someone else.
  var verified = Boolean(response.getRespondentEmail && response.getRespondentEmail());
  var duplicates = verified ? students.filter(function (row) { return row.email === fields.email && row.responseId !== responseId; }) : [];
  var signedUpBefore = Boolean(current) || duplicates.length > 0;
  deleteStudents_(duplicates);

  if (fields.alertStatus === ALERT_STATUS.DELETE) {
    if (current) {
      current = readTable_('Students').filter(function (row) { return row.responseId === responseId; })[0];
      deleteStudents_([current]);
    } else {
      deleteFormResponse_(responseId, formId);
      removeFile_(fields.resumeFileId);
    }
    return;
  }

  var now = new Date().toISOString();
  var record = current ? readTable_('Students').filter(function (row) { return row.responseId === responseId; })[0] : {};
  var wantedTelegramBefore = current ? wantsTelegram_(record) : false;
  var githubChanged = record.github !== fields.github;
  var resumeChanged = String(record.resumeFileId || '') !== String(fields.resumeFileId);
  if (resumeChanged && record.resumeFileId) removeFile_(record.resumeFileId);

  Object.keys(fields).forEach(function (key) { if (key !== 'alertStatus') record[key] = fields[key]; });
  record.responseId = responseId;
  record.formId = formId;
  if (!record.telegramCode) record.telegramCode = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  if (!wantsTelegram_(record)) record.telegramChatId = '';
  record.status = fields.alertStatus === ALERT_STATUS.PAUSED ? 'paused' : 'active';
  record.editUrl = response.getEditResponseUrl();
  record.updatedAt = now;
  if (githubChanged) {
    record.githubUser = parseGithubUsername(fields.github);
    record.githubSkills = '';
    record.githubScannedAt = '';
    record.githubError = fields.github && !record.githubUser ? 'Could not read GitHub link' : '';
  }
  if (resumeChanged) {
    record.resumeSkills = '';
    record.resumeReadFileId = '';
    record.resumeError = '';
    record.resumeText = '';
  }
  // Any edit means Gemini should read the profile again.
  record.aiReadAt = '';
  rememberNewSkills_(fields.skills);
  var unknown = unknownCompanies_([fields.includeCompanies, fields.excludeCompanies].join(','));
  var unknownChanged = unknown.join(', ') !== String(record.unknownCompanies || '');
  record.unknownCompanies = unknown.join(', ');

  if (current) {
    updateRow_('Students', record);
    if (record.status === 'paused') dropPendingFor_(responseId);
    // Unknown company names are told to the student, so a typo doesn't silently do nothing.
    if (unknown.length && unknownChanged) enqueue_('notice', record, '', false);
    // Switching to Telegram sends the connect link straight away.
    if (!wantedTelegramBefore && wantsTelegram_(record) && !record.telegramChatId && telegramLink_(record)) {
      enqueue_('telegram', record, '', false);
      sendConfirmationsNow_();
    }
    return;
  }
  record.createdAt = now;
  record.lastReminderAt = now;
  appendRow_('Students', record);
  if (!signedUpBefore) {
    enqueue_('confirmation', record, '', false);
    // Sent now rather than on the next run, so students hear back within a minute.
    sendConfirmationsNow_();
  }
}

/**
 * New skill names are listed for the owner to approve. They only affect matching for everyone
 * once approved, so junk words can't make every job match.
 */
function rememberNewSkills_(skillField) {
  var rows = readTable_('Skills');
  var listed = rows.map(function (row) { return String(row.skill).toLowerCase(); });
  var parsed = parseStudentSkills(skillField, buildSynonyms(rows));
  parsed.unknown.forEach(function (skill) {
    if (listed.indexOf(skill) === -1) appendRow_('Skills', { skill: skill, aliases: '', approved: '' });
  });
}

function deleteStudents_(records) {
  records.forEach(function (student) {
    // Every queue row for them goes, including sent ones, which hold their email address.
    deleteRows_('Queue', readTable_('Queue').filter(function (row) { return row.responseId === student.responseId; }));
    removeFile_(student.resumeFileId);
    deleteFormResponse_(student.responseId, student.formId);
    var matches = readTable_('Matches').filter(function (row) { return row.responseId === student.responseId; });
    deleteRows_('Matches', matches);
    var fresh = readTable_('Students').filter(function (row) { return row.responseId === student.responseId; });
    deleteRows_('Students', fresh);
  });
}

function dropPendingFor_(responseId) {
  var pending = readTable_('Queue').filter(function (row) {
    return row.responseId === responseId && row.status === 'pending';
  });
  deleteRows_('Queue', pending);
}

function deleteFormResponse_(responseId, formId) {
  try {
    FormApp.openById(formId || prop_('FORM_ID')).deleteResponse(responseId);
  } catch (error) {
    log_('ERROR', 'delete', 'Could not delete a form response: ' + error.message);
  }
}

function trashFile_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (error) {
    log_('ERROR', 'delete', 'Could not delete a resume: ' + error.message);
  }
}

function refreshProfiles_(deadline) {
  var students = readTable_('Students').filter(function (student) { return student.status === 'active'; });
  var synonyms = buildSynonyms(readTable_('Skills'));
  scanGithubBatch_(students, synonyms, deadline);
  readResumeBatch_(students, synonyms, deadline);
  readProfilesBatch_(deadline);
  sweepTempCopies_();
}

function readProfilesBatch_(deadline) {
  if (!CONFIG.AI_READS_PROFILES) return;
  var due = readTable_('Students').filter(function (student) {
    // Only students who agreed to the wording that names Gemini.
    if (!/gemini/i.test(student.consent)) return false;
    // Waits for a pending resume read, so Gemini sees the resume too.
    var resumePending = student.resumeFileId && String(student.resumeReadFileId) !== String(student.resumeFileId);
    return student.status === 'active' && !student.aiReadAt && !resumePending;
  }).slice(0, 3);
  for (var i = 0; i < due.length && Date.now() < deadline; i++) {
    if (!readProfileWithGemini_(due[i])) return;
    updateRow_('Students', due[i]);
  }
}

function scanGithubBatch_(students, synonyms, deadline) {
  var due = students.filter(function (student) {
    return student.githubUser && daysSince_(student.githubScannedAt) >= CONFIG.GITHUB_RESCAN_DAYS;
  }).sort(function (a, b) {
    return String(a.githubScannedAt).localeCompare(String(b.githubScannedAt));
  }).slice(0, CONFIG.GITHUB_SCANS_PER_TICK);

  for (var i = 0; i < due.length && Date.now() < deadline; i++) {
    var student = due[i];
    var url = 'https://api.github.com/users/' + encodeURIComponent(student.githubUser) + '/repos?per_page=100&sort=updated';
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'internship-alerts' } });
    var code = response.getResponseCode();
    if (code === 403 || code === 429) {
      log_('WARN', 'github', 'GitHub rate limit reached; remaining scans wait for the next run.');
      return;
    }
    if (code === 200) {
      student.githubSkills = summarizeGithubRepos(JSON.parse(response.getContentText()), synonyms).join(', ');
      student.githubError = '';
    } else {
      student.githubError = code === 404 ? 'GitHub profile not found' : 'GitHub returned ' + code;
    }
    student.githubScannedAt = new Date().toISOString();
    updateRow_('Students', student);
  }
}

function readResumeBatch_(students, synonyms, deadline) {
  var due = students.filter(function (student) {
    return student.resumeFileId && String(student.resumeReadFileId) !== String(student.resumeFileId);
  }).slice(0, CONFIG.RESUME_READS_PER_TICK);

  due.forEach(function (student) {
    if (Date.now() > deadline) return;
    var copyId = '';
    try {
      // Converting to a Google Doc runs Drive's text recognition, which also handles scanned PDFs.
      var copy = Drive.Files.copy({ name: 'resume-text-temp', mimeType: 'application/vnd.google-apps.document' }, student.resumeFileId, { ocrLanguage: 'en' });
      copyId = copy.id;
      var text = DocumentApp.openById(copyId).getBody().getText();
      student.resumeSkills = extractSkills(text, synonyms).join(', ');
      student.resumeText = text.slice(0, 20000);
      student.aiReadAt = '';
      student.resumeError = '';
    } catch (error) {
      student.resumeError = error.message;
      log_('WARN', 'resume', 'A resume could not be read: ' + error.message);
    }
    if (copyId) removeFile_(copyId);
    student.resumeReadFileId = student.resumeFileId;
    updateRow_('Students', student);
  });
}

/** Handles sign-ups that arrived while a run held the lock. Runs inside tick, which has the lock. */
function processDeferredResponses_() {
  var deferred = JSON.parse(prop_('DEFERRED_RESPONSES') || '[]');
  if (!deferred.length) return;
  setProp_('DEFERRED_RESPONSES', '[]');
  deferred.forEach(function (item) {
    try {
      handleResponse_(FormApp.openById(item.formId).getResponse(item.responseId), item.formId);
    } catch (error) {
      log_('ERROR', 'form', 'A delayed sign-up could not be processed: ' + error.message);
    }
  });
}

/** Permanent deletion where possible, so personal files don't sit in the trash for 30 days. */
function removeFile_(fileId) {
  if (!fileId) return;
  try {
    Drive.Files.remove(fileId);
  } catch (error) {
    trashFile_(fileId);
  }
}

/** Temporary resume copies left by a run that was cut off. */
function sweepTempCopies_() {
  var files = DriveApp.getFilesByName('resume-text-temp');
  while (files.hasNext()) removeFile_(files.next().getId());
}
