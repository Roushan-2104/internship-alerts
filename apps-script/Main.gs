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
    run('profiles', function () { refreshProfiles_(deadline); });
    run('email', function () { sendQueued_(deadline); });
    run('reminders', function () { queueReminders_(); });
    run('health', function () { checkHealth_(feed, errors); });
    setProp_('LAST_TICK_AT', new Date().toISOString());
  } finally {
    lock.releaseLock();
  }
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
  feed.payload.jobs.forEach(function (job) {
    var row = byId[job.id];
    if (row) {
      var open = job.open !== false;
      var details = job.minQualifications || row.minQualifications;
      if (isTrue_(row.open) !== open || String(row.minQualifications) !== String(details)
        || String(row.deadline) !== String(job.deadline || row.deadline)) {
        row.open = open;
        row.minQualifications = details;
        row.preferredQualifications = job.preferredQualifications || row.preferredQualifications;
        row.deadline = job.deadline || row.deadline;
        updateRow_('Jobs', row);
      }
      return;
    }
    var record = {
      id: job.id, title: job.title, company: job.company, location: job.location, url: job.url,
      priority: Boolean(job.priority), deadline: job.deadline || '', minQualifications: job.minQualifications || '',
      preferredQualifications: job.preferredQualifications || '', firstSeen: job.firstSeen || new Date().toISOString(),
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
