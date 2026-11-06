const DAY_MS = 24 * 60 * 60 * 1000;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// All-caps entries such as "STEP" match case-sensitively so the ordinary word "step" does not.
export function matchesPriority(title, priorityTitles) {
  return priorityTitles.some((name) => {
    const caseSensitive = name === name.toUpperCase();
    const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(name)}($|[^A-Za-z0-9])`, caseSensitive ? '' : 'i');
    return pattern.test(title);
  });
}

export function containsKeyword(text, keywords) {
  return keywords.some((word) => new RegExp(`\\b${escapeRegex(word)}\\b`, 'i').test(text));
}

// Google's robots.txt disallows paginated result URLs for all crawlers.
export function assertAllowedGoogleUrl(url) {
  if (new URL(url).searchParams.has('page')) {
    throw new Error(`Refusing paginated URL disallowed by robots.txt: ${url}`);
  }
}

export function fingerprint(job) {
  const clean = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const location = clean(job.location).split(' ').slice(0, 3).join(' ');
  return [clean(job.company), clean(job.title), location].join('|');
}

/**
 * Merges one run into stored state. A failed source leaves its jobs untouched, so an
 * outage can never make jobs look closed or reappear as new.
 */
export function mergeRun(state, results, options, now = new Date()) {
  const nowIso = now.toISOString();
  const jobs = new Map((state.jobs || []).map((job) => [job.id, { ...job }]));
  const sourceStatus = {};
  const seenThisRun = new Set();
  const succeededCompanies = new Set();
  const failedCompanies = new Set();

  for (const result of results) {
    const zeroFailure = result.ok && result.requireJobs && result.jobs.length === 0;
    const ok = result.ok && !zeroFailure;
    sourceStatus[result.name] = {
      ok,
      count: result.ok ? result.jobs.length : 0,
      checkedAt: nowIso,
      error: result.error || (zeroFailure ? 'Zero jobs found: the page may have changed or blocked us' : null),
    };
    if (!ok) {
      failedCompanies.add(result.company);
      continue;
    }
    if (result.authoritative !== false) succeededCompanies.add(result.company);

    for (const incoming of result.jobs) {
      seenThisRun.add(incoming.id);
      const existing = jobs.get(incoming.id);
      if (existing) {
        jobs.set(incoming.id, { ...existing, ...incoming, firstSeen: existing.firstSeen, lastSeen: nowIso, open: true });
        continue;
      }
      const print = fingerprint(incoming);
      const windowMs = options.repostWindowDays * DAY_MS;
      const earlier = [...jobs.values()].find(
        (job) => job.fingerprint === print && now - new Date(job.lastSeen) <= windowMs,
      );
      jobs.set(incoming.id, {
        ...incoming,
        fingerprint: print,
        firstSeen: nowIso,
        lastSeen: nowIso,
        open: true,
        repostOf: earlier ? earlier.id : null,
      });
    }
  }

  const retentionMs = options.closedJobRetentionDays * DAY_MS;
  for (const [id, job] of jobs) {
    const companyChecked = succeededCompanies.has(job.company) && !failedCompanies.has(job.company);
    if (companyChecked && !seenThisRun.has(id)) job.open = false;
    if (!job.open && now - new Date(job.lastSeen) > retentionMs) jobs.delete(id);
  }

  const allOk = Object.values(sourceStatus).every((status) => status.ok);
  return {
    schemaVersion: 1,
    generatedAt: nowIso,
    lastFullSuccessAt: allOk ? nowIso : state.lastFullSuccessAt || null,
    sources: sourceStatus,
    jobs: [...jobs.values()].sort((a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen))),
  };
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/<\/(p|div|li|h\d|ul|ol)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}
