// Decides whether a posting is relevant, and tags its role type, area of work and location.

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|manager|head|director|vp|architect|expert)\b/i;
const STUDENT_MARKER = /\b(intern|internship|trainee|apprentice|fresher|freshers|entry.?level|students?|college|campus|graduates?)\b/i;
// Titles that say outright they're for graduates aren't treated as senior, even with "Manager" in them.
const EXPLICIT_GRAD = /new.?grad|university grad|graduate (program|programme|hire)|campus|fresher|entry.?level|early career/i;
const PART_TIME = /part.?time|contract|contractual|freelance|temporary/i;

const ROLE_RULES = [
  ['research', /student researcher|research (assistant|intern|associate|fellow)/i],
  ['internship', /\b(intern|internship|co-?op)\b|\bsummer (analyst|associate)\b/i],
  // "GET" (Graduate Engineer Trainee) only counts in capitals, so the word "get" doesn't match.
  ['apprentice', { test: (text) => /\b(apprentice|apprenticeship|trainee|traineeship)\b/i.test(text) || /\bGET\b/.test(text) }],
  ['newGrad', /new.?grad|university grad|(graduate|grad) (engineer|trainee|program|programme|hire|analyst)|freshers?\b|entry.?level|early career|campus (hire|hiring)|\bjunior\b|\b(software (engineer|developer)|sde|engineer|developer|analyst|data scientist|data analyst)\s*[-–]?\s*(I|1)\b(?![\s-]*[I\d])|associate (software|engineer|developer|product manager)/i],
];

// Jobs that run a programme or hire students, rather than being for students.
const STAFF_NOUN = /\b(manager|director|recruiter|coordinator|lead|head|partner|specialist|advisor|officer)s?\b/i;
const HIRING_STAFF = /\b(recruiter|recruiting|hiring|talent acquisition)\b/i;
const STUDENT_WORD = /\b(intern|internship|interns|trainee|apprentice|apprenticeship|student|researcher)\b/gi;

/** "Intern Recruiter" or "Internship Program Manager" name the job after the student word. */
function isStaffRole(title) {
  // Entry-level titles that happen to contain a staff word.
  if (/associate product manager|\bAPM\b/i.test(title)) return false;
  if (EXPLICIT_GRAD.test(title) && !HIRING_STAFF.test(title)) return false;
  // "Manager, Internship Programs" runs a programme.
  if (/intern(ship)? programs?\b/i.test(title) && STAFF_NOUN.test(title)) return true;
  let lastStudentWord = -1;
  for (const found of title.matchAll(STUDENT_WORD)) lastStudentWord = found.index;
  const staff = title.match(STAFF_NOUN);
  if (!staff) return false;
  let lastStaff = -1;
  for (const found of title.matchAll(new RegExp(STAFF_NOUN.source, 'gi'))) lastStaff = found.index;
  return lastStaff > lastStudentWord;
}

/**
 * Returns the role type, or null when the posting isn't a student or early-career role.
 * Part-time and contract roles only count when they're also student-level.
 */
export function classifyRole(title, employmentType = '') {
  const text = `${title} ${employmentType}`;
  const match = ROLE_RULES.find(([, pattern]) => pattern.test(text));
  if (match) {
    if (isStaffRole(title)) return null;
    // "Senior Research Associate" or "Postdoctoral Research Fellow" aren't student research.
    if (match[0] === 'research' && (SENIOR.test(title) || /postdoc|post-doc/i.test(title))) return null;
    // "Senior Associate Software Engineer" or "Engineering Manager I" aren't early-career.
    const entryTitle = EXPLICIT_GRAD.test(title) || /^associate product manager\b|\bAPM\b/i.test(title);
    if (match[0] === 'newGrad' && (HIRING_STAFF.test(title) || (SENIOR.test(title) && !entryTitle))) return null;
    return match[0];
  }
  if (PART_TIME.test(text) && STUDENT_MARKER.test(title)) return 'partTime';
  return null;
}

export function isPartTime(title, employmentType = '') {
  return PART_TIME.test(`${title} ${employmentType}`);
}

const AREA_RULES = [
  ['hardware', /hardware|electronic|electrical|mechanical|manufacturing|silicon|embedded|robotics|vlsi|firmware|semiconductor/i],
  ['data and AI', /\bdata\b|machine learning|\bml\b|\bai\b|analytics|scientist|\bnlp\b|computer vision|deep learning/i],
  ['engineering', /engineer|developer|\bsde\b|software|backend|frontend|full.?stack|devops|\bsre\b|\bqa\b|testing|security|mobile|android|\bios\b|cloud|infrastructure|technical/i],
  ['design', /design|\bux\b|\bui\b|graphic|video edit|illustrat/i],
  ['product', /product (manager|management|analyst|ops|intern)|\bapm\b|associate product/i],
  ['marketing', /marketing|content|brand|social media|growth|\bseo\b|communication|influencer|public relations|\bpr\b/i],
  ['sales and business', /sales|business development|account (manager|executive|strategist)|\bbd\b|partnership|customer success|pre.?sales|counsel(l)?or/i],
  ['operations', /operations|\bops\b|supply|logistics|fulfil|inventory|procurement|program|project|founder.?s office|strategy|consult/i],
  ['finance', /financ|accounting|accountant|payroll|audit|\btax\b|treasury|investment/i],
  ['people', /\bhr\b|people|talent|recruit|human resources|trainer/i],
  ['research', /research/i],
  ['legal', /legal|compliance|policy/i],
];

/** Area tags from the title, with the department as a second clue. */
export function tagAreas(title, department = '') {
  const fromTitle = AREA_RULES.filter(([, pattern]) => pattern.test(title)).map(([area]) => area);
  if (fromTitle.length) return fromTitle;
  const fromDepartment = AREA_RULES.filter(([, pattern]) => pattern.test(department)).map(([area]) => area);
  return fromDepartment.length ? fromDepartment : ['other'];
}

const INDIA_PLACES = /\b(india|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|mumbai|chennai|noida|delhi|new delhi|ncr|kolkata|ahmedabad|jaipur|kochi|chandigarh|indore|coimbatore|thiruvananthapuram|trivandrum|mysuru|mysore|vadodara|nagpur|bhubaneswar|lucknow)\b/i;
const REMOTE = /\b(remote|anywhere|work from home|wfh|distributed)\b/i;
const REMOTE_OPEN_TO_INDIA = /(remote|anywhere|work from home)[^.\n]{0,60}\b(india|apac|asia)\b|\b(india|apac|asia)\b[^.\n]{0,40}(remote|anywhere|work from home)|anywhere in (the )?world|any ?where in india/i;

/**
 * Indian locations count. Remote roles only count when the location or description
 * says India-based people can apply.
 */
export function placeFor(location, description = '') {
  if (INDIA_PLACES.test(location)) return { relevant: true, remote: REMOTE.test(location) };
  if (!REMOTE.test(location)) return { relevant: false, remote: false };
  const openToIndia = REMOTE_OPEN_TO_INDIA.test(location) || REMOTE_OPEN_TO_INDIA.test(description);
  return { relevant: openToIndia, remote: true };
}

/** Parses a published Google Sheets CSV, including quoted cells. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header = [], ...body] = rows.filter((r) => r.some((value) => value.trim()));
  const keys = header.map((name) => name.trim().toLowerCase());
  return body.map((values) => Object.fromEntries(keys.map((key, index) => [key, (values[index] || '').trim()])));
}

const BOARD_TYPES = new Set(['greenhouse', 'lever', 'ashby', 'smartrecruiters']);

/** Turns Companies sheet rows into sources. Rows marked "no" in the enabled column are skipped. */
export function companiesToSources(rows) {
  const problems = [];
  const sources = [];
  for (const row of rows) {
    const type = (row.type || '').toLowerCase();
    if (/^(no|false|0|off)$/i.test(row.enabled || '')) continue;
    if (!row.company || !row.board || !BOARD_TYPES.has(type)) {
      problems.push(`Skipped a row: ${JSON.stringify(row)}`);
      continue;
    }
    sources.push({ type, name: row.company, company: row.company, board: row.board, group: row.group || '', requireJobs: false });
  }
  return { sources, problems };
}
