/** Runs every 30 minutes. Each step is isolated, so one failure doesn't stop the others. */
function tick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  var deadline = Date.now() + CONFIG.TICK_BUDGET_MS;
  var errors = [];
  var run = function (area, step) {
    try {
      step();
    } catch (error) {
      errors.push(area + ': ' + error.message);
      log_('ERROR', area, error.message);
    }
  };
  var feed = { payload: null, error: null };
  try {
    run('admin', function () { runAdminActions_(); });
    run('signups', function () { processDeferredResponses_(); });
    run('signups', function () { processDeferredResponses_(); });
    run('jobs', function () { syncJobs_(feed, deadline); });
    run('watcher', function () { startWatcher_(feed); });
    run('gemini', function () { readJobsWithGemini_(deadline); });
    run('matching', function () { matchNewJobs_(deadline, false); });
    run('backfill', function () { backfillNewStudents_(deadline); });
    run('telegram', function () { pollTelegram_(); });
    run('profiles', function () { refreshProfiles_(deadline); });
    run('email', function () { sendQueued_(deadline); });
    run('reminders', function () { queueReminders_(); });
    run('cleanup', function () { pruneOldRows_(feed); });
    run('cleanup', function () { pruneOldRows_(feed); });
    run('health', function () { checkHealth_(feed, errors); });
    setProp_('LAST_TICK_AT', new Date().toISOString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * GitHub's own schedule isn't dependable, so this run asks GitHub to start the watcher.
 * It skips the request if job data is already fresh, which avoids double runs if the
 * schedule also fires. Throwing here reaches the owner as a failure alert.
 */
function startWatcher_(feed) {
  if (feed.payload) {
    var ageMinutes = (Date.now() - new Date(feed.payload.generatedAt).getTime()) / 60000;
    if (ageMinutes < CONFIG.WATCHER_FRESH_MINUTES) return;
  }
  var token = prop_('GITHUB_DISPATCH_TOKEN');
  if (!token) throw new Error('GITHUB_DISPATCH_TOKEN is missing from Script Properties.');

  var response = UrlFetchApp.fetch(CONFIG.WORKFLOW_DISPATCH_URL, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: JSON.stringify({ ref: 'main' })
  });
  var code = response.getResponseCode();
  if (code >= 200 && code < 300) return;
  if (code === 401) throw new Error('GitHub rejected the token (HTTP 401). It may have expired: create a new one and update Script Properties.');
  if (code === 403 || code === 404) throw new Error('GitHub refused to start the watcher (HTTP ' + code + '). Check the token has Actions read and write access to this repo.');
  throw new Error('GitHub could not start the watcher (HTTP ' + code + ').');
}

/** Jobs from before role types existed have no roleType and are treated as internships. */
function isLiveJob_(job) {
  if (isLaunched_()) return true;
  if (job.roleType && CONFIG.LIVE_ROLE_TYPES.indexOf(job.roleType) === -1) return false;
  if (job.remote && !CONFIG.LIVE_REMOTE_ROLES && !/india|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|mumbai|chennai|noida|delhi/i.test(job.location)) return false;
  return true;
}

function syncJobs_(feed, deadline) {
  var response;
  try {
    response = UrlFetchApp.fetch(CONFIG.JOBS_URL, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error('HTTP ' + response.getResponseCode());
    feed.payload = JSON.parse(response.getContentText());
    if (!Array.isArray(feed.payload.jobs)) throw new Error('jobs list is missing');
  } catch (error) {
    feed.error = error.message;
    return;
  }

  var stored = readTable_('Jobs');
  var byId = {};
  stored.forEach(function (row) { byId[row.id] = row; });

  // The first sync records what is already open, so launch day doesn't send a backlog.
  var firstSync = !prop_('FIRST_SYNC_DONE');
  feed.payload.jobs.filter(isLiveJob_).forEach(function (job) {
    job.areas = Array.isArray(job.areas) ? job.areas.join(', ') : job.areas;
    var row = byId[job.id];
    if (row) {
      var open = job.open !== false;
      var fields = ['minQualifications', 'preferredQualifications', 'aboutRole', 'responsibilities', 'fullText', 'deadline', 'roleType', 'areas', 'remote', 'partTime'];
      var changed = isTrue_(row.open) !== open;
      fields.forEach(function (field) {
        // An empty value still counts, so old messy text can't stay behind.
        if (job[field] !== undefined && cellString_(row[field]) !== cellString_(job[field])) {
          row[field] = job[field];
          changed = true;
        }
      });
      if (changed) {
        row.open = open;
        updateRow_('Jobs', row);
      }
      return;
    }
    var record = {
      id: job.id, title: job.title, company: job.company, location: job.location, url: job.url,
      priority: Boolean(job.priority), roleType: job.roleType || '', deadline: job.deadline || '', minQualifications: job.minQualifications || '',
      preferredQualifications: job.preferredQualifications || '', aboutRole: job.aboutRole || '',
      responsibilities: job.responsibilities || '', fullText: job.fullText || '', firstSeen: job.firstSeen || new Date().toISOString(),
      processedAt: firstSync || job.repostOf || job.open === false ? 'skipped' : '', open: job.open !== false, repostOf: job.repostOf || '',
      areas: job.areas || '', remote: Boolean(job.remote), partTime: Boolean(job.partTime)
    };
    appendRow_('Jobs', record);
  });
  if (firstSync) setProp_('FIRST_SYNC_DONE', 'true');
}

/**
 * A new job waits for Gemini to read it, unless Gemini is unavailable or the wait is over,
 * so matching never stalls. sendNow skips the wait.
 */
function readyToMatch_(job, sendNow) {
  if (job.aiReadAt || sendNow || geminiBlocked_()) return true;
  var waitMinutes = isTrue_(job.priority) ? CONFIG.AI_WAIT_MINUTES_PRIORITY : CONFIG.AI_WAIT_MINUTES;
  var stored = new Date(job.firstSeen).getTime();
  return !stored || Date.now() - stored > waitMinutes * 60000;
}

function matchNewJobs_(deadline, sendNow) {
  var waiting = readTable_('Jobs').filter(function (job) {
    return !job.processedAt && readyToMatch_(job, sendNow);
  }).slice(0, CONFIG.JOBS_PER_TICK);
  if (!waiting.length) return;
  var students = readTable_('Students').filter(function (student) { return student.status === 'active'; });
  var synonyms = buildSynonyms(readTable_('Skills'));
  var existing = {};
  readTable_('Matches').forEach(function (match) { existing[match.key] = true; });

  waiting.forEach(function (job) {
    if (Date.now() > deadline) return;
    // A job that closed while waiting is never sent.
    if (!isTrue_(job.open)) {
      job.processedAt = 'skipped';
      updateRow_('Jobs', job);
      return;
    }
    // A job that closed while waiting is never sent.
    if (!isTrue_(job.open)) {
      job.processedAt = 'skipped';
      updateRow_('Jobs', job);
      return;
    }
    var finished = students.every(function (student) {
      if (Date.now() > deadline) return false;
      var key = job.id + '|' + student.responseId;
      if (existing[key]) return true;
      var route = routeJob(job, student, synonyms);
      appendRow_('Matches', {
        key: key, jobId: job.id, responseId: student.responseId, status: route.status, score: route.score,
        channel: route.channel, reason: route.reason, quote: route.quote, createdAt: new Date().toISOString()
      });
      existing[key] = true;
      if (route.channel !== 'none') {
        enqueue_(route.channel, student, job.id, route.checkEligibility);
      }
      return true;
    });
    if (finished) {
      job.processedAt = new Date().toISOString();
      updateRow_('Jobs', job);
    }
  });
}

/**
 * After launch, each new student is matched once against the jobs already open, so people
 * who sign up later still get them. Backlog matches go in the digest, never as instant alerts.
 */
function backfillNewStudents_(deadline) {
  if (!isLaunched_()) return;
  var students = readTable_('Students').filter(function (student) { return student.status === 'active' && !student.backfilledAt; });
  if (!students.length) return;
  var openJobs = readTable_('Jobs').filter(function (job) {
    return isTrue_(job.open) && job.processedAt && job.processedAt !== 'skipped';
  });
  var synonyms = buildSynonyms(readTable_('Skills'));
  var existing = {};
  readTable_('Matches').forEach(function (match) { existing[match.key] = true; });
  for (var i = 0; i < students.length && Date.now() < deadline; i++) {
    var student = students[i];
    openJobs.forEach(function (job) {
      if (Date.now() > deadline) return;
      var key = job.id + '|' + student.responseId;
      if (existing[key]) return;
      var route = routeJob(job, student, synonyms);
      var channel = route.channel === 'none' ? 'none' : 'digest';
      appendRow_('Matches', {
        key: key, jobId: job.id, responseId: student.responseId, status: route.status, score: route.score,
        channel: channel, reason: route.reason, quote: route.quote, createdAt: new Date().toISOString()
      });
      existing[key] = true;
      if (channel === 'digest') enqueue_('digest', student, job.id, route.checkEligibility);
    });
    if (Date.now() > deadline) return;
    student.backfilledAt = new Date().toISOString();
    updateRow_('Students', student);
  }
}

/**
 * Keeps the tabs small: sent, dropped and failed queue rows older than 30 days go, and so do
 * closed jobs no longer in the watcher's data, with their matches.
 */
function pruneOldRows_(feed) {
  var oldQueue = readTable_('Queue').filter(function (row) {
    return row.status !== 'pending' && daysSince_(row.sentAt || row.createdAt) > CONFIG.KEEP_SENT_DAYS;
  });
  deleteRows_('Queue', oldQueue);
  if (!feed.payload) return;
  var inFeed = {};
  feed.payload.jobs.forEach(function (job) { inFeed[job.id] = true; });
  var goneJobs = readTable_('Jobs').filter(function (job) { return !inFeed[job.id] && !isTrue_(job.open); });
  if (!goneJobs.length) return;
  var goneIds = {};
  goneJobs.forEach(function (job) { goneIds[job.id] = true; });
  deleteRows_('Matches', readTable_('Matches').filter(function (match) { return goneIds[match.jobId]; }));
  deleteRows_('Jobs', goneJobs);
}

/**
 * Runs every 5 minutes. Light work only: sign-ups that arrived while the script was busy,
 * waiting confirmations, and Telegram messages. Skips quietly if the main run is going.
 */
function quickTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    [processDeferredResponses_, sendConfirmationsNow_, pollTelegram_].forEach(function (step) {
      try {
        step();
      } catch (error) {
        log_('ERROR', 'quick', error.message);
      }
    });
  } finally {
    lock.releaseLock();
  }
}
