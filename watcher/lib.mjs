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
  const checkedSources = new Set();

  for (const result of results) {
    const zeroFailure = result.ok && result.requireJobs && result.jobs.length === 0;
    const ok = result.ok && !zeroFailure;
    sourceStatus[result.name] = {
      ok,
      count: result.ok ? result.jobs.length : 0,
      checkedAt: nowIso,
      error: result.error || (zeroFailure ? 'Zero jobs found: the page may have changed or blocked us' : null),
    };
    if (!ok) continue;
    if (result.authoritative !== false) checkedSources.add(result.name);

    for (const incoming of result.jobs) {
      seenThisRun.add(incoming.id);
      const existing = jobs.get(incoming.id);
      if (existing) {
        const sources = [...new Set([...(existing.sources || [existing.source]), result.name])];
        const merged = { ...existing, ...incoming, sources, firstSeen: existing.firstSeen, lastSeen: nowIso, open: true };
        // A Google listing card is shorter than the detail page, so details already read are kept.
        if (existing.detailVersion) {
          for (const field of ['minQualifications', 'preferredQualifications', 'responsibilities', 'aboutRole', 'deadline']) merged[field] = existing[field];
        }
        jobs.set(incoming.id, merged);
        continue;
      }
      const print = fingerprint(incoming);
      const windowMs = options.repostWindowDays * DAY_MS;
      const earlier = [...jobs.values()].find(
        (job) => job.fingerprint === print && now - new Date(job.lastSeen) <= windowMs,
      );
      jobs.set(incoming.id, {
        ...incoming,
        sources: [result.name],
        fingerprint: print,
        firstSeen: nowIso,
        lastSeen: nowIso,
        open: true,
        repostOf: earlier ? earlier.id : null,
      });
    }
  }

  const retentionMs = options.closedJobRetentionDays * DAY_MS;
  const sourcesThisRun = new Set(results.map((result) => result.name));
  for (const [id, job] of jobs) {
    const jobSources = job.sources || [job.source];
    // A job closes only when a full listing it came from was read successfully without it,
    // or when every source it came from has been removed, such as a company taken off the sheet.
    const fullListingChecked = jobSources.some((name) => checkedSources.has(name));
    const sourcesRemoved = !jobSources.some((name) => sourcesThisRun.has(name));
    if ((fullListingChecked || sourcesRemoved) && !seenThisRun.has(id)) job.open = false;
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

// Some boards escape their text twice, so this repeats until nothing changes.
function decodeEntities(text) {
  let current = String(text || '');
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decodeOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function decodeOnce(text) {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&rsquo;/g, '’').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&amp;/g, '&');
}

// Order matters: "preferred qualifications" must win over "qualifications".
const SECTION_RULES = [
  ['skip', /benefit|perk|why join|why you|why this|what we offer|we offer|compensation|salary|pay range|equal (employment|opportunity)|office location|in.?office|hybrid work|how to apply|interview process|additional information|company description|key trait|performance metric|non.negotiable|reporting|faq|how we work|life as an|life at|culture|our values|learn more/i],
  ['preferred', /prefer|nice.to.have|good.to.have|bonus|would be a plus|added advantage|pluses/i],
  ['requirements', /minimum|must.?have|mandatory|require|qualification|who you are|looking for|you have|you bring|you.ll need|you need|skill|eligib|ideal candidate|about you|candidate profile/i],
  ['responsibilities', /responsib|what you.?ll|what you will|you will|on the job|day.to.day|what will you|the work|your impact|key result/i],
  ['aboutRole', /about the (role|job|position|internship|opportunity)|the role|role overview|your role|job (description|summary|overview)|position (overview|summary)|the opportunity|internship (details|overview)/i],
];

export function classifyHeading(heading) {
  const match = SECTION_RULES.find(([, pattern]) => pattern.test(heading));
  return match ? match[0] : 'other';
}

const BULLET = '\u0001';

function looksLikeHeading(line) {
  return line.length <= 60 && !/[.!?]$/.test(line) && classifyHeading(line) !== 'other';
}

/** Turns a job description into named sections, so nothing lands under the wrong heading. */
export function parseDescription(html, limits = { aboutRole: 1500, responsibilities: 2000, minQualifications: 3000, preferredQualifications: 1500, fullText: 8000 }) {
  const text = decodeEntities(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<div class="content-(intro|conclusion)">[\s\S]*?<\/div>/gi, ' ')
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, inner) => `\n##${inner.replace(/<[^>]+>/g, ' ')}\n`)
    .replace(/<(p|div)[^>]*>\s*(?:<(?:strong|b|u|em|span)[^>]*>\s*)+([^<]{2,90})(?:\s*<\/(?:strong|b|u|em|span)>)+\s*(?:<br\s*\/?>\s*)*<\/\1>/gi, (_, __, inner) => `\n##${inner}\n`)
    // List items are marked, so a bullet such as "Strong communication skills" is never taken as a heading.
    .replace(/<li[^>]*>/gi, `\n${BULLET}`)
    .replace(/<\/(p|div|li|ul|ol|tr)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const sections = [{ kind: 'intro', lines: [] }];
  for (const raw of text.split('\n')) {
    const isBullet = raw.includes(BULLET);
    const line = raw.replace(BULLET, '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (isBullet && !line.startsWith('##')) {
      sections.at(-1).lines.push(line.replace(/^[•·▪◦\-*–]\s+/, ''));
      continue;
    }
    const marked = line.startsWith('##');
    const value = line.replace(/^##\s*/, '').replace(/[:\s]+$/, '').trim();
    if (!value) continue;
    // Some postings mark whole sentences as headings, which are really text.
    const isHeading = marked ? value.length <= 70 && !/[.!]$/.test(value) : looksLikeHeading(value);
    if (isHeading) {
      const current = sections.at(-1).kind;
      const kind = classifyHeading(value);
      // "1. Inventory ownership" under "Key Responsibilities" is a sub-heading, so it stays there.
      const isSubHeading = kind === 'other' && !/^(about|who we are|company|our |the team)/i.test(value)
        && ['responsibilities', 'requirements', 'preferred'].includes(current);
      if (!isSubHeading) sections.push({ kind, lines: [] });
    } else {
      sections.at(-1).lines.push(value.replace(/^[•·▪◦\-*–]\s+/, ''));
    }
  }

  const collect = (kind) => sections.filter((section) => section.kind === kind).flatMap((section) => section.lines).join('\n');
  const cap = (value, limit) => {
    if (value.length <= limit) return value;
    const cut = value.slice(0, limit);
    return cut.slice(0, Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. ') + 1, 1)).trim();
  };
  // With no named sections, what's left after the company text is the best description available.
  const hasSections = collect('aboutRole') || collect('responsibilities') || collect('requirements');
  return {
    aboutRole: cap(collect('aboutRole') || (hasSections ? '' : collect('intro')), limits.aboutRole),
    responsibilities: cap(collect('responsibilities'), limits.responsibilities),
    minQualifications: cap(collect('requirements'), limits.minQualifications),
    preferredQualifications: cap(collect('preferred'), limits.preferredQualifications),
    fullText: cap(sections.flatMap((section) => section.lines).join('\n'), limits.fullText),
  };
}

