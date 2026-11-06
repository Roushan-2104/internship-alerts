/** Fires for new sign-ups and for edits made through a student's personal link. */
function onFormSubmit(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    handleResponse_(e.response);
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
    name: String(answers[FORM_TITLES.NAME] || '').trim(),
    email: String(answers[FORM_TITLES.EMAIL] || '').trim().toLowerCase(),
    degree: answers[FORM_TITLES.DEGREE] || '',
    gradYear: answers[FORM_TITLES.GRAD_YEAR] || '',
    skills: answers[FORM_TITLES.SKILLS] || '',
    experience: answers[FORM_TITLES.EXPERIENCE] || '',
    projects: answers[FORM_TITLES.PROJECTS] || '',
    privateProjects: answers[FORM_TITLES.PRIVATE_PROJECTS] || '',
    github: String(answers[FORM_TITLES.GITHUB] || '').trim(),
    interests: answers[FORM_TITLES.INTERESTS] || '',
    resumeFileId: Array.isArray(resume) && resume.length ? resume[0] : '',
    alertStatus: answers[FORM_TITLES.STATUS] || ALERT_STATUS.ACTIVE
  };
}

function handleResponse_(response) {
  var fields = responseFields_(response);
  var responseId = response.getId();
  var students = readTable_('Students');
  var current = students.filter(function (row) { return row.responseId === responseId; })[0];

  // A second sign-up from the same address replaces the first, so nobody gets duplicate emails.
  var duplicates = students.filter(function (row) { return row.email === fields.email && row.responseId !== responseId; });
  var signedUpBefore = Boolean(current) || duplicates.length > 0;
  deleteStudents_(duplicates);

  if (fields.alertStatus === ALERT_STATUS.DELETE) {
    if (current) {
      current = readTable_('Students').filter(function (row) { return row.responseId === responseId; })[0];
      deleteStudents_([current]);
    } else {
      deleteFormResponse_(responseId);
      trashFile_(fields.resumeFileId);
    }
    return;
  }

  var now = new Date().toISOString();
  var record = current ? readTable_('Students').filter(function (row) { return row.responseId === responseId; })[0] : {};
  var githubChanged = record.github !== fields.github;
  var resumeChanged = String(record.resumeFileId || '') !== String(fields.resumeFileId);
  if (resumeChanged && record.resumeFileId) trashFile_(record.resumeFileId);

  Object.keys(fields).forEach(function (key) { if (key !== 'alertStatus') record[key] = fields[key]; });
  record.responseId = responseId;
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
  }
  rememberNewSkills_(fields.skills);

  if (current) {
    updateRow_('Students', record);
    if (record.status === 'paused') dropPendingFor_(responseId);
    return;
  }
  record.createdAt = now;
  record.lastReminderAt = now;
  appendRow_('Students', record);
  if (!signedUpBefore) enqueue_('confirmation', record, '', false);
}

function rememberNewSkills_(skillField) {
  var rows = readTable_('Skills');
  var parsed = parseStudentSkills(skillField, buildSynonyms(rows));
  parsed.unknown.forEach(function (skill) { appendRow_('Skills', { skill: skill, aliases: '' }); });
}

function deleteStudents_(records) {
  records.forEach(function (student) {
    dropPendingFor_(student.responseId);
    trashFile_(student.resumeFileId);
    deleteFormResponse_(student.responseId);
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

function deleteFormResponse_(responseId) {
  try {
    FormApp.openById(prop_('FORM_ID')).deleteResponse(responseId);
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
      student.resumeSkills = extractSkills(DocumentApp.openById(copyId).getBody().getText(), synonyms).join(', ');
      student.resumeError = '';
    } catch (error) {
      student.resumeError = error.message;
      log_('WARN', 'resume', 'A resume could not be read: ' + error.message);
    }
    if (copyId) trashFile_(copyId);
    student.resumeReadFileId = student.resumeFileId;
    updateRow_('Students', student);
  });
}
