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
    // Only rows the owner approved, or added with aliases, count for everyone.
    if (!skill || !(/^yes$/i.test(String(row.approved || '')) || String(row.aliases || '').trim())) return;
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
// Words too common to count as skills, even if a student types them.
var COMMON_WORDS = ['and', 'the', 'with', 'for', 'team', 'teamwork', 'work', 'good', 'basic', 'basics', 'knowledge', 'skills', 'other', 'etc', 'learning', 'communication', 'english', 'hindi', 'hardworking', 'leadership'];

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
    } else if (token.length >= 3 && token.length <= 30 && /^[A-Za-z0-9 .+#\-]+$/.test(token) && COMMON_WORDS.indexOf(lower) === -1 && unknown.indexOf(lower) === -1) {
      unknown.push(lower);
    }
  });
  return { known: known, unknown: unknown };
}

function studentSkillSet(student, synonyms) {
  var parsed = parseStudentSkills(student.skills, synonyms);
  var written = [student.experience, student.projects, student.privateProjects, student.interests].join('\n');
  var all = parsed.known.concat(parsed.unknown).concat(extractSkills(written, synonyms));
  var profileFacts = parseFacts_(student.ai);
  var aiSkills = profileFacts && profileFacts.skills ? profileFacts.skills.map(function (skill) {
    var found = extractSkills(skill, synonyms);
    return found.length ? found[0] : skill;
  }) : [];
  String(student.githubSkills || '').split(',').concat(String(student.resumeSkills || '').split(','), aiSkills).forEach(function (skill) {
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
  // "MS" alone often means Microsoft ("MS Excel"), so it only counts next to degree words.
  if (/\bmaster(['’]?s)\b|\bM\.?Tech\b|\bM\.S\b|\bMS (in|degree|program)\b|\b(BS|B\.S\.?)\s*\/\s*MS\b/.test(text) || /\bmaster(['’]?s)\b/i.test(text)) levels.push('Master');
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
  if ((/\bon or after\b/i.test(sentence) || /\bor (later|after)\b/i.test(sentence)) && years.length === 1) return year >= years[0];
  if (/\b(or earlier|or before)\b/i.test(sentence) && years.length === 1) return year <= years[0];
  if (/\b(after)\b/i.test(sentence) && years.length === 1) return year > years[0];
  if (/\b(between|from)\b/i.test(sentence) && years.length === 2) {
    return year >= Math.min(years[0], years[1]) && year <= Math.max(years[0], years[1]);
  }
  return years.indexOf(year) !== -1;
}

function parseFacts_(value) {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (error) {
    return null;
  }
}

var LEVEL_NAMES = { Bachelor: 'bachelor', Master: 'master', PhD: 'phd' };

/** Uses Gemini's facts when it found any. Returns null to fall back to the rules. */
function eligibilityFromFacts_(job, student) {
  var facts = parseFacts_(job.ai);
  if (!facts) return null;
  var quote = facts.evidence || '';
  var level = degreeLevel_(student.degree);
  var studentLevel = level === 'Other' && /diploma/i.test(student.degree) ? 'diploma' : LEVEL_NAMES[level] || 'other';
  if (isTrue_(job.remote) && facts.openToIndia === 'no') {
    return { status: 'not_eligible', reason: 'Remote role not open to people in India', quote: quote };
  }
  if (facts.degreeLevels.length && facts.degreeLevels.indexOf('any') === -1 && facts.degreeLevels.indexOf(studentLevel) === -1) {
    // A Master's or PhD student may still qualify for a Bachelor's-level role, so they're asked to check.
    var rank = { diploma: 1, bachelor: 2, master: 3, phd: 4 };
    var highestAccepted = Math.max.apply(null, facts.degreeLevels.map(function (l) { return rank[l] || 0; }));
    if ((rank[studentLevel] || 0) > highestAccepted && highestAccepted >= 2) {
      return { status: 'unclear', reason: 'Posting names a lower degree level', quote: quote };
    }
    return { status: 'not_eligible', reason: 'Degree level is ' + facts.degreeLevels.join(' or ') + ' only', quote: quote };
  }
  if (job.roleType === 'newGrad' && facts.minYearsExperience > 0 && !facts.freshersWelcome) {
    return { status: 'not_eligible', reason: 'Needs ' + facts.minYearsExperience + ' year(s) of experience', quote: quote };
  }
  var year = Number(student.gradYear);
  if (year && (facts.gradYearMin || facts.gradYearMax)) {
    var fits = (!facts.gradYearMin || year >= facts.gradYearMin) && (!facts.gradYearMax || year <= facts.gradYearMax);
    return fits
      ? { status: 'eligible', reason: 'Graduation year fits', quote: quote }
      : { status: 'not_eligible', reason: 'Graduation year does not fit', quote: quote };
  }
  return noYearStated_(job, quote);
}

var NO_YEAR_REASON = 'Posting does not state a graduation year';

function noYearStated_(job, quote) {
  return { status: 'unclear', reason: NO_YEAR_REASON, quote: quote };
}

/**
 * Most internships name no graduation year because any current student can apply, so a missing
 * year is only worth a "check eligibility" label on new-grad roles, which depend on the year.
 */
function needsEligibilityLabel_(result, job) {
  if (result.status !== 'unclear') return false;
  return result.reason !== NO_YEAR_REASON || job.roleType === 'newGrad';
}

/** Returns eligible, unclear or not_eligible, with the sentence that decided it. */
function evaluateEligibility(job, student) {
  var fromFacts = eligibilityFromFacts_(job, student);
  if (fromFacts) return fromFacts;
  return eligibilityFromRules_(job, student);
}

function eligibilityFromRules_(job, student) {
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
  return noYearStated_(job, levelQuote);
}

// Which areas of work a student's skills point to, used when a posting names no skills to compare.
var SKILL_AREAS = [
  [['engineering', 'product', 'research'], /python|java|javascript|typescript|react|angular|node|c\+\+|\bc\b|\bgo\b|golang|rust|kotlin|swift|android|flutter|html|css|django|flask|spring|\bgit\b|docker|kubernetes|aws|azure|gcp|linux|dsa|data structures|algorithm|software|backend|frontend|full.?stack|devops/i],
  [['data and ai', 'engineering', 'product', 'research'], /machine learning|\bml\b|\bai\b|deep learning|\bnlp\b|computer vision|\bdata\b|sql|pandas|numpy|tensorflow|pytorch|scikit|statistics|tableau|power ?bi|analytics|\bllm/i],
  [['design'], /figma|photoshop|illustrator|canva|\bui\b|\bux\b|design|after effects|premiere|blender|indesign|typography/i],
  [['marketing'], /marketing|\bseo\b|content|social media|copywriting|branding/i],
  [['sales and business'], /sales|business development|\bcrm\b|negotiat/i],
  [['operations'], /operations|supply chain|logistics|project management/i],
  [['finance'], /financ|accounting|tally|excel|valuation/i],
  [['people'], /recruit|\bhr\b|human resources/i],
  [['hardware', 'engineering'], /embedded|vlsi|verilog|arduino|electronic|matlab|autocad|solidworks|mechanical|\bcad\b|pcb|robotics/i],
  [['legal'], /\blaw\b|legal/i]
];

function skillAreas_(skills) {
  var text = skills.join(', ');
  var areas = [];
  SKILL_AREAS.forEach(function (rule) {
    if (rule[1].test(text)) rule[0].forEach(function (area) { if (areas.indexOf(area) === -1) areas.push(area); });
  });
  return areas;
}

/**
 * A posting that names no skills can't be compared on skills, so it's kept only when its area
 * suits the student: an area they chose, or, if they chose none, one their skills point to.
 */
function areaSuits_(job, student, skills) {
  if (splitList_(student.areas).length) return true; // Their chosen areas were already checked.
  var jobAreas = splitList_(job.areas).map(function (area) { return area.toLowerCase(); });
  if (!jobAreas.length || jobAreas.indexOf('other') !== -1) return true;
  var mine = skillAreas_(skills);
  if (!mine.length) return true;
  return jobAreas.some(function (area) { return mine.indexOf(area) !== -1; });
}

function matchScore(job, student, synonyms) {
  var jobSkills = extractSkills([job.title, job.minQualifications, job.preferredQualifications, job.responsibilities, job.minQualifications ? '' : job.fullText].join('\n'), synonyms);
  var facts = parseFacts_(job.ai);
  if (facts && facts.skills.length) {
    // Gemini's skill names are mapped onto the same synonym groups students' skills use.
    jobSkills = facts.skills.map(function (skill) {
      var found = extractSkills(skill, synonyms);
      return found.length ? found[0] : skill;
    }).filter(function (skill, index, all) { return all.indexOf(skill) === index; });
  }
  var mine = studentSkillSet(student, synonyms);
  var shared = jobSkills.filter(function (skill) { return mine.indexOf(skill) !== -1; });
  return { score: shared.length, jobSkillCount: jobSkills.length, shared: shared, studentSkills: mine };
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
  var preference = preferenceCheck_(job, student);
  // Preferences are strict, except that eligible priority roles still go out unless the company was excluded.
  if (!preference.ok && (preference.absolute || !priority)) {
    route.reason = preference.reason;
    return route;
  }
  if (preference.always && !priority) {
    route.channel = 'digest';
    route.checkEligibility = needsEligibilityLabel_(result, job);
    return route;
  }
  if (priority) {
    route.channel = 'instant';
    route.checkEligibility = needsEligibilityLabel_(result, job);
    return route;
  }
  if (match.score > 0 || (match.jobSkillCount === 0 && areaSuits_(job, student, match.studentSkills))) {
    route.channel = 'digest';
    route.checkEligibility = needsEligibilityLabel_(result, job);
  } else {
    route.reason = match.jobSkillCount === 0 ? 'Area does not suit the student' : 'No shared skills';
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
  { field: 'aboutRole', heading: 'About the role', paragraphs: true, maxChars: 300 },
  { field: 'responsibilities', heading: "What you'll do", maxItems: 3 },
  { field: 'minQualifications', heading: 'What they ask for', maxItems: 5 },
  { field: 'preferredQualifications', heading: 'Nice to have', maxItems: 3 }
];

var ROLE_LABELS = { internship: 'Internship', apprentice: 'Apprenticeship or trainee', newGrad: 'New-grad role', research: 'Student research', partTime: 'Part-time or contract' };

function jobKind_(job) {
  var parts = [ROLE_LABELS[job.roleType] || 'Internship'];
  if (isTrue_(job.partTime) && job.roleType !== 'partTime') parts.push('part-time or contract');
  if (isTrue_(job.remote)) parts.push('remote');
  return parts.join(', ');
}

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
    + '<h2 style="margin:0 0 4px;font-size:18px">' + escapeHtml(job.title) + '</h2>'
    + '<p style="margin:0 0 8px;color:#444">' + escapeHtml(job.company) + ' | ' + escapeHtml(job.location) + ' | ' + escapeHtml(jobKind_(job)) + '</p>'
    + '<p style="margin:0"><b>Deadline:</b> ' + escapeHtml(job.deadline || 'Not listed') + '</p>'
    + (checkEligibility ? '<p style="margin:8px 0 0"><b>Check eligibility:</b> the posting does not clearly say whether you qualify, so read it before applying.</p>' : '')
    + sections + missing
    + (shortened ? '<p style="margin:0 0 8px;color:#555">Shortened for this email. The posting has the full details.</p>' : '')
    + '<p style="margin:12px 0 0"><a href="' + escapeHtml(safeUrl_(job.url)) + '">View the posting and apply</a></p></div>';
}

function jobBlockText_(job, checkEligibility) {
  var parts = [job.title, job.company + ' | ' + job.location + ' | ' + jobKind_(job), 'Deadline: ' + (job.deadline || 'Not listed')];
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
  parts.push('', 'Apply: ' + safeUrl_(job.url));
  return parts.join('\n');
}

function footerHtml_(editUrl) {
  return '<hr><p style="color:#555;font-size:13px">To add preferences, update your profile, pause alerts, or delete your data, use '
    + '<a href="' + escapeHtml(safeUrl_(editUrl)) + '">your personal link</a>. Please do not share it: anyone with it can change your answers.</p>';
}

function footerText_(editUrl) {
  return '\n--\nAdd preferences, update your profile, pause alerts, or delete your data: ' + editUrl + '\nPlease do not share this link.';
}

function buildInstantEmail(job, editUrl, checkEligibility) {
  return {
    subject: job.title + ' at ' + job.company + ' is open: apply now',
    htmlBody: '<p>This role is open. Please apply with the details they ask for below.</p>' + jobBlockHtml_(job, checkEligibility) + footerHtml_(editUrl),
    body: 'This role is open. Please apply with the details they ask for below.\n\n' + jobBlockText_(job, checkEligibility) + footerText_(editUrl)
  };
}

/** Long digests show the first jobs in full and list the rest by title, to stay readable on a phone. */
function buildDigestEmail(items, editUrl) {
  var count = items.length;
  var full = items.slice(0, CONFIG.DIGEST_MAX_FULL_JOBS);
  var rest = items.slice(CONFIG.DIGEST_MAX_FULL_JOBS);
  var restHtml = rest.length ? '<h2 style="font-size:18px">More matches</h2><ul>' + rest.map(function (item) {
    return '<li><a href="' + escapeHtml(safeUrl_(item.job.url)) + '">' + escapeHtml(item.job.title) + '</a>, ' + escapeHtml(item.job.company) + '</li>';
  }).join('') + '</ul>' : '';
  var restText = rest.length ? '\n\nMORE MATCHES\n' + rest.map(function (item) { return '- ' + item.job.title + ', ' + item.job.company + ': ' + safeUrl_(item.job.url); }).join('\n') : '';
  var intro = 'These new roles match your profile. Please apply with the details they ask for.';
  return {
    subject: count + (count === 1 ? ' new role' : ' new roles') + ' matched to your profile',
    htmlBody: '<div lang="en" style="font-size:16px;line-height:1.5"><p>' + intro + '</p>'
      + full.map(function (item) { return jobBlockHtml_(item.job, item.checkEligibility); }).join('') + restHtml + footerHtml_(editUrl) + '</div>',
    body: intro + '\n\n' + full.map(function (item) { return jobBlockText_(item.job, item.checkEligibility); }).join('\n\n') + restText + footerText_(editUrl)
  };
}

function buildNoOpeningsEmail(name, editUrl, weekly) {
  var period = weekly ? 'this week' : 'today';
  var intro = 'Hi ' + name + ', there are no new openings matching your profile ' + period + '. We will keep watching.';
  return {
    subject: 'No new openings ' + period,
    htmlBody: '<p>' + escapeHtml(intro) + '</p>' + footerHtml_(editUrl),
    body: intro + footerText_(editUrl)
  };
}

function buildConfirmationEmail(name, editUrl, unknownCompanies, telegramLink) {
  var intro = 'Hi ' + name + ', you are signed up for internship alerts. You will only get emails about new roles that match your profile.';
  var spam = 'If this email is in spam, please mark it "Not spam" so you do not miss an alert.';
  var telegram = telegramLink ? 'To get alerts on Telegram, open this link and press Start. Until then, alerts come by email.' : '';
  var unknown = unknownCompanies ? 'We could not find these companies in our list, so they have no effect yet: ' + unknownCompanies + '. Check the spelling with your personal link.' : '';
  return {
    subject: 'You are signed up for internship alerts',
    htmlBody: '<div lang="en" style="font-size:16px;line-height:1.5"><p>' + escapeHtml(intro) + '</p><p><b>' + escapeHtml(spam) + '</b></p>'
      + (telegram ? '<p>' + escapeHtml(telegram) + ' <a href="' + escapeHtml(safeUrl_(telegramLink)) + '">Connect Telegram</a></p>' : '')
      + (unknown ? '<p>' + escapeHtml(unknown) + '</p>' : '') + footerHtml_(editUrl) + '</div>',
    body: intro + '\n\n' + spam + (telegram ? '\n\n' + telegram + ' ' + telegramLink : '') + (unknown ? '\n\n' + unknown : '') + footerText_(editUrl)
  };
}

function buildUnknownCompaniesEmail(name, editUrl, unknownCompanies) {
  var text = 'Hi ' + name + ', your changes are saved. We could not find these companies in our list, so they have no effect yet: ' + unknownCompanies + '. Check the spelling with your personal link.';
  return {
    subject: 'Please check the company names you entered',
    htmlBody: '<div lang="en" style="font-size:16px;line-height:1.5"><p>' + escapeHtml(text) + '</p>' + footerHtml_(editUrl) + '</div>',
    body: text + footerText_(editUrl)
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

function buildTelegramLinkEmail(name, editUrl, link) {
  var text = 'Hi ' + name + ', you chose Telegram alerts. Open this link in Telegram and press Start to connect. Until then, alerts come by email.';
  return {
    subject: 'Connect Telegram to get your alerts there',
    htmlBody: '<div lang="en" style="font-size:16px;line-height:1.5"><p>' + escapeHtml(text) + '</p><p><a href="' + escapeHtml(safeUrl_(link)) + '">Connect Telegram</a></p>' + footerHtml_(editUrl) + '</div>',
    body: text + '\n\n' + link + footerText_(editUrl)
  };
}

