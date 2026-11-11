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
    run('jobs', function () { syncJobs_(feed, deadline); });
    run('watcher', function () { startWatcher_(feed); });
    run('profiles', function () { refreshProfiles_(deadline); });
    run('email', function () { sendQueued_(deadline); });
    run('reminders', function () { queueReminders_(); });
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
    var row = byId[job.id];
    if (row) {
      var open = job.open !== false;
      var fields = ['minQualifications', 'preferredQualifications', 'aboutRole', 'responsibilities', 'fullText', 'deadline'];
      var changed = isTrue_(row.open) !== open;
      fields.forEach(function (field) {
        // An empty value still counts, so old messy text can't stay behind.
        if (job[field] !== undefined && String(row[field]) !== String(job[field])) {
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
      priority: Boolean(job.priority), deadline: job.deadline || '', minQualifications: job.minQualifications || '',
      preferredQualifications: job.preferredQualifications || '', aboutRole: job.aboutRole || '',
      responsibilities: job.responsibilities || '', fullText: job.fullText || '', firstSeen: job.firstSeen || new Date().toISOString(),
      processedAt: firstSync || job.repostOf || job.open === false ? 'skipped' : '', open: job.open !== false, repostOf: job.repostOf || ''
    };
    appendRow_('Jobs', record);
  });
  if (firstSync) setProp_('FIRST_SYNC_DONE', 'true');
  matchNewJobs_(deadline);
}

function matchNewJobs_(deadline) {
  var waiting = readTable_('Jobs').filter(function (job) { return !job.processedAt; }).slice(0, CONFIG.JOBS_PER_TICK);
  if (!waiting.length) return;
  var students = readTable_('Students').filter(function (student) { return student.status === 'active'; });
  var synonyms = buildSynonyms(readTable_('Skills'));
  var existing = {};
  readTable_('Matches').forEach(function (match) { existing[match.key] = true; });

  waiting.forEach(function (job) {
    if (Date.now() > deadline) return;
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
