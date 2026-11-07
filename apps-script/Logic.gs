// Pure functions only: no Google services here, so all of this runs in the local tests.

var DEFAULT_SKILLS = [
  ['python', 'py'], ['java'], ['javascript', 'js'], ['typescript', 'ts'], ['C++', 'cpp'], ['C#', 'csharp'], ['C'],
  ['Go', 'golang'], ['rust'], ['kotlin'], ['swift'], ['php'], ['ruby'], ['R'], ['sql', 'mysql', 'postgresql', 'postgres', 'sqlite'],
  ['nosql', 'mongodb', 'mongo', 'firebase'], ['html'], ['css', 'tailwind'], ['react', 'reactjs', 'next.js', 'nextjs'],
  ['angular'], ['vue', 'vuejs'], ['node', 'node.js', 'nodejs', 'express'], ['django'], ['flask', 'fastapi'], ['spring', 'spring boot'],
  ['backend', 'back-end', 'back end'], ['frontend', 'front-end', 'front end'], ['full stack', 'fullstack', 'full-stack'],
  ['android'], ['ios'], ['flutter'], ['react native'], ['machine learning', 'ml', 'deep learning', 'pytorch', 'tensorflow', 'scikit-learn'],
  ['artificial intelligence', 'ai', 'genai', 'llm'], ['nlp', 'natural language'], ['computer vision', 'opencv'], ['data science', 'pandas', 'numpy'],
  ['data structures', 'dsa'], ['algorithms'], ['operating systems', 'os'], ['networking', 'computer networks'], ['linux', 'unix'],
  ['git', 'github'], ['docker'], ['kubernetes', 'k8s'], ['aws'], ['gcp', 'google cloud'], ['azure'], ['cybersecurity', 'security'],
  ['embedded', 'arduino'], ['verilog', 'vhdl']
];

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeRegex_(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Short or word-like names such as Go, C and R only match in exact case in free text.
function aliasFoundIn_(alias, text) {
  var exactCase = alias !== alias.toLowerCase();
  var pattern = new RegExp('(^|[^A-Za-z0-9+#])' + escapeRegex_(alias) + '($|[^A-Za-z0-9+#])', exactCase ? '' : 'i');
  return pattern.test(text);
}

function buildSynonyms(sheetRows) {
  var groups = DEFAULT_SKILLS.map(function (group) { return group.slice(); });
  (sheetRows || []).forEach(function (row) {
    var skill = String(row.skill || '').trim();
    if (!skill) return;
    var aliases = String(row.aliases || '').split(',').map(function (a) { return a.trim(); }).filter(String);
    groups.push([skill].concat(aliases));
  });
  return groups;
}

function extractSkills(text, synonyms) {
  var value = String(text || '');
  var found = [];
  synonyms.forEach(function (group) {
    var hit = group.some(function (alias) { return aliasFoundIn_(alias, value); });
    if (hit && found.indexOf(group[0].toLowerCase()) === -1) found.push(group[0].toLowerCase());
  });
  return found;
}

// Reads the comma-separated skills field, where "go" or "c" clearly mean the language.
function parseStudentSkills(skillField, synonyms) {
  var known = [];
  var unknown = [];
  String(skillField || '').split(/[,;\n]+/).forEach(function (raw) {
    var token = raw.trim();
    if (!token) return;
    var lower = token.toLowerCase();
    var group = synonyms.filter(function (g) {
      return g.some(function (alias) { return alias.toLowerCase() === lower; });
    })[0];
    if (group) {
      if (known.indexOf(group[0].toLowerCase()) === -1) known.push(group[0].toLowerCase());
    } else if (token.length <= 30 && /^[A-Za-z0-9 .+#\-]+$/.test(token) && unknown.indexOf(lower) === -1) {
      unknown.push(lower);
    }
  });
  return { known: known, unknown: unknown };
}

function studentSkillSet(student, synonyms) {
  var parsed = parseStudentSkills(student.skills, synonyms);
  var written = [student.experience, student.projects, student.privateProjects, student.interests].join('\n');
  var all = parsed.known.concat(parsed.unknown).concat(extractSkills(written, synonyms));
  String(student.githubSkills || '').split(',').concat(String(student.resumeSkills || '').split(',')).forEach(function (skill) {
    if (skill.trim()) all.push(skill.trim().toLowerCase());
  });
  return all.filter(function (skill, index) { return all.indexOf(skill) === index; });
}

function sentenceWith_(text, pattern) {
  var parts = String(text || '').split(/\n|(?<=[.;])\s+/);
  for (var i = 0; i < parts.length; i++) {
    if (pattern.test(parts[i])) return parts[i].trim();
  }
  return '';
}

function requiredLevels_(text) {
  var levels = [];
  if (/bachelor|undergraduate|\bB\.?Tech\b|\bB\.E\b|\bB\.?S\b|\bBE\b/.test(text) || /bachelor|undergraduate/i.test(text)) levels.push('Bachelor');
  // Requires the possessive so a title like "Scrum Master" isn't read as a degree.
  if (/\bmaster(['’]?s)\b|\bM\.?Tech\b|\bM\.S\b|\bMS\b/.test(text) || /\bmaster(['’]?s)\b/i.test(text)) levels.push('Master');
  if (/ph\.?d|doctora/i.test(text)) levels.push('PhD');
  return levels;
}

function degreeLevel_(degree) {
  var value = String(degree || '');
  if (/^bachelor/i.test(value)) return 'Bachelor';
  if (/^master/i.test(value)) return 'Master';
  if (/^phd/i.test(value)) return 'PhD';
  return 'Other';
}

function checkGraduationYear_(sentence, year) {
  var years = (sentence.match(/\b20\d{2}\b/g) || []).map(Number);
  if (/\b(before|prior to)\b/i.test(sentence) && years.length === 1) return year < years[0];
  if (/\b(by|no later than)\b/i.test(sentence) && years.length === 1) return year <= years[0];
  if (/\b(after)\b/i.test(sentence) && years.length === 1) return year > years[0];
  if (/\bon or after\b/i.test(sentence) && years.length === 1) return year >= years[0];
  if (/\b(between|from)\b/i.test(sentence) && years.length === 2) {
    return year >= Math.min(years[0], years[1]) && year <= Math.max(years[0], years[1]);
  }
  return years.indexOf(year) !== -1;
}

/** Returns eligible, unclear or not_eligible, with the sentence that decided it. */
function evaluateEligibility(job, student) {
  // Postings without a recognisable requirements section fall back to their full text.
  var qualifications = String(job.minQualifications || job.fullText || '');
  var levelText = job.title + '\n' + qualifications;
  var levels = requiredLevels_(levelText);
  var level = degreeLevel_(student.degree);
  var levelQuote = sentenceWith_(levelText, /bachelor|master|ph\.?d|doctora|undergraduate/i);

  if (levels.length && levels.indexOf('Bachelor') === -1 && (level === 'Bachelor' || level === 'Other')) {
    return { status: 'not_eligible', reason: 'Degree level is ' + levels.join(' or ') + ' only', quote: levelQuote };
  }

  var yearPattern = /(graduat|complet|finish|pass(ing)? out|batch|class of)[^\n]*\b20\d{2}\b|\b20\d{2}\b[^\n]*(graduat|batch)/i;
  var yearQuote = sentenceWith_(qualifications, yearPattern) || sentenceWith_(job.fullText, yearPattern);
  var gradYear = Number(student.gradYear);
  if (yearQuote && gradYear) {
    return checkGraduationYear_(yearQuote, gradYear)
      ? { status: 'eligible', reason: 'Graduation year fits', quote: yearQuote }
      : { status: 'not_eligible', reason: 'Graduation year does not fit', quote: yearQuote };
  }
  return { status: 'unclear', reason: 'Posting does not state a graduation year', quote: levelQuote };
}

function matchScore(job, student, synonyms) {
  var jobSkills = extractSkills([job.title, job.minQualifications, job.preferredQualifications, job.responsibilities, job.minQualifications ? '' : job.fullText].join('\n'), synonyms);
  var mine = studentSkillSet(student, synonyms);
  var shared = jobSkills.filter(function (skill) { return mine.indexOf(skill) !== -1; });
  return { score: shared.length, jobSkillCount: jobSkills.length, shared: shared };
}

/**
 * Eligibility is the hard rule. Skills only filter non-priority roles, and a posting
 * naming no recognised skills is kept rather than hidden.
 */
function routeJob(job, student, synonyms) {
  var result = evaluateEligibility(job, student);
  var match = matchScore(job, student, synonyms);
  var route = { status: result.status, reason: result.reason, quote: result.quote, score: match.score, channel: 'none', checkEligibility: false };
  if (result.status === 'not_eligible') return route;
  var priority = job.priority === true || String(job.priority).toUpperCase() === 'TRUE';
  if (priority) {
    route.channel = 'instant';
    route.checkEligibility = result.status === 'unclear';
    return route;
  }
  var skillsFit = match.score > 0 || match.jobSkillCount === 0;
  if (skillsFit) {
    route.channel = 'digest';
    route.checkEligibility = result.status === 'unclear';
  } else {
    route.reason = 'No shared skills';
  }
  return route;
}

function digestHour(email) {
  var hash = 0;
  String(email).split('').forEach(function (ch) { hash = (hash * 31 + ch.charCodeAt(0)) % 1000003; });
  return CONFIG.DIGEST_FIRST_HOUR_IST + (hash % CONFIG.DIGEST_WINDOW_HOURS);
}

function parseGithubUsername(value) {
  var text = String(value || '').trim();
  var match = text.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/?(?:[?#].*)?$/i)
    || text.match(/^@?([A-Za-z0-9-]{1,39})$/);
  return match ? match[1] : '';
}

function summarizeGithubRepos(repos, synonyms) {
  var text = [];
  (repos || []).forEach(function (repo) {
    if (repo.fork) return;
    text.push(repo.language || '', repo.name || '', repo.description || '', (repo.topics || []).join(', '));
  });
  return extractSkills(text.join('\n'), synonyms);
}

function safeUrl_(url) {
  return /^https?:\/\//i.test(String(url)) ? String(url) : '#';
}

var JOB_SECTIONS = [
  { field: 'aboutRole', heading: 'About the role', paragraphs: true, maxChars: 500 },
  { field: 'responsibilities', heading: "What you'll do", maxItems: 6 },
  { field: 'minQualifications', heading: 'What they ask for', maxItems: 8 },
  { field: 'preferredQualifications', heading: 'Nice to have', maxItems: 4 }
];

function trimToSentence_(text, maxChars) {
  var cut = text.slice(0, maxChars);
  var end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > 0) return cut.slice(0, end + 1).trim();
  return cut.slice(0, cut.lastIndexOf(' ')).trim() + '...';
}

function sectionLines_(job, section) {
  var lines = String(job[section.field] || '').split('\n').map(function (line) {
    // Google's page joins some sentences without a space.
    return line.replace(/([a-z]\.)([A-Z])/g, '$1 $2').trim();
  }).filter(String);
  var shortened = false;
  if (section.maxItems && lines.length > section.maxItems) {
    lines = lines.slice(0, section.maxItems);
    shortened = true;
  }
  if (section.maxChars) {
    var kept = [];
    var used = 0;
    lines.some(function (line) {
      if (used + line.length > section.maxChars) {
        if (!kept.length) {
          kept.push(trimToSentence_(line, section.maxChars));
        }
        shortened = true;
        return true;
      }
      kept.push(line);
      used += line.length;
      return false;
    });
    lines = kept;
  }
  return { lines: lines, shortened: shortened };
}

var HEADING_STYLE = 'margin:12px 0 4px;font-weight:bold';

function jobBlockHtml_(job, checkEligibility) {
  var shortened = false;
  var sections = JOB_SECTIONS.map(function (section) {
    var content = sectionLines_(job, section);
    shortened = shortened || content.shortened;
    if (!content.lines.length) return '';
    var body = section.paragraphs
      ? content.lines.map(function (line) { return '<p style="margin:0 0 6px">' + escapeHtml(line) + '</p>'; }).join('')
      : '<ul style="margin:0 0 8px;padding-left:20px">' + content.lines.map(function (line) { return '<li style="margin:0 0 3px">' + escapeHtml(line) + '</li>'; }).join('') + '</ul>';
    return '<p style="' + HEADING_STYLE + '">' + escapeHtml(section.heading) + '</p>' + body;
  }).join('');
  var missing = sections ? '' : '<p style="margin:12px 0 8px">This posting has no clear sections, so please read the details there.</p>';
  return '<div style="margin:0 0 28px;padding:0 0 20px;border-bottom:1px solid #ddd">'
    + '<h3 style="margin:0 0 4px">' + escapeHtml(job.title) + '</h3>'
    + '<p style="margin:0 0 8px;color:#555">' + escapeHtml(job.company) + ' | ' + escapeHtml(job.location) + '</p>'
    + '<p style="margin:0"><b>Deadline:</b> ' + escapeHtml(job.deadline || 'Not listed') + '</p>'
    + (checkEligibility ? '<p style="margin:8px 0 0"><b>Check eligibility:</b> the posting does not clearly say whether you qualify, so read it before applying.</p>' : '')
    + sections + missing
    + (shortened ? '<p style="margin:0 0 8px;color:#555">Shortened for this email. The posting has the full details.</p>' : '')
    + '<p style="margin:12px 0 0"><a href="' + escapeHtml(safeUrl_(job.url)) + '">View the posting and apply</a></p></div>';
}

function jobBlockText_(job, checkEligibility) {
  var parts = [job.title, job.company + ' | ' + job.location, 'Deadline: ' + (job.deadline || 'Not listed')];
  if (checkEligibility) parts.push('Check eligibility: the posting does not clearly say whether you qualify.');
  var shortened = false;
  JOB_SECTIONS.forEach(function (section) {
    var content = sectionLines_(job, section);
    shortened = shortened || content.shortened;
    if (!content.lines.length) return;
    parts.push('', section.heading.toUpperCase());
    content.lines.forEach(function (line) { parts.push(section.paragraphs ? line : '- ' + line); });
  });
  if (shortened) parts.push('', 'Shortened for this email. The posting has the full details.');
  parts.push('', 'Apply: ' + job.url);
  return parts.join('\n');
}

function footerHtml_(editUrl) {
  return '<hr><p style="color:#555;font-size:13px">To update your profile, pause alerts, or delete your data, use '
    + '<a href="' + escapeHtml(safeUrl_(editUrl)) + '">your personal link</a>. Please do not share it: anyone with it can change your answers.</p>';
}

function footerText_(editUrl) {
  return '\n--\nUpdate your profile, pause alerts, or delete your data: ' + editUrl + '\nPlease do not share this link.';
}

function buildInstantEmail(job, editUrl, checkEligibility) {
  return {
    subject: job.title + ' at ' + job.company + ' is open: apply now',
    htmlBody: '<p>This role is open. Please apply with the details they ask for below.</p>' + jobBlockHtml_(job, checkEligibility) + footerHtml_(editUrl),
    body: 'This role is open. Please apply with the details they ask for below.\n\n' + jobBlockText_(job, checkEligibility) + footerText_(editUrl)
  };
}

function buildDigestEmail(items, editUrl) {
  var count = items.length;
  return {
    subject: count + (count === 1 ? ' new internship' : ' new internships') + ' matched to your profile',
    htmlBody: '<p>These new internships match your profile. Please apply with the details they ask for.</p>'
      + items.map(function (item) { return jobBlockHtml_(item.job, item.checkEligibility); }).join('') + footerHtml_(editUrl),
    body: 'These new internships match your profile. Please apply with the details they ask for.\n\n'
      + items.map(function (item) { return jobBlockText_(item.job, item.checkEligibility); }).join('\n\n') + footerText_(editUrl)
  };
}

function buildNoOpeningsEmail(name, editUrl) {
  var intro = 'Hi ' + name + ', there are no new internship openings matching your profile today. We will keep watching.';
  return {
    subject: 'No new internship openings today',
    htmlBody: '<p>' + escapeHtml(intro) + '</p>' + footerHtml_(editUrl),
    body: intro + footerText_(editUrl)
  };
}

function buildConfirmationEmail(name, editUrl) {
  var intro = 'Hi ' + name + ', you are signed up for internship alerts. You will only get emails about new internships that match your profile.';
  var spam = 'If this email is in spam, please mark it "Not spam" so you do not miss an alert.';
  return {
    subject: 'You are signed up for internship alerts',
    htmlBody: '<p>' + escapeHtml(intro) + '</p><p><b>' + escapeHtml(spam) + '</b></p>' + footerHtml_(editUrl),
    body: intro + '\n\n' + spam + footerText_(editUrl)
  };
}

function buildReminderEmail(name, editUrl) {
  var intro = 'Hi ' + name + ', have you learned anything new or started a new project? Add it to your profile so future matches are better.';
  return {
    subject: 'Anything new to add to your internship profile?',
    htmlBody: '<p>' + escapeHtml(intro) + '</p>' + footerHtml_(editUrl),
    body: intro + footerText_(editUrl)
  };
}
