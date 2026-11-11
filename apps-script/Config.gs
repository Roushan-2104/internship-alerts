var CONFIG = {
  EXPECTED_ACCOUNT: 'internshipalerts.roushan@gmail.com',
  JOBS_URL: 'https://raw.githubusercontent.com/Roushan-2104/internship-alerts/main/data/jobs.json',
  WORKFLOW_DISPATCH_URL: 'https://api.github.com/repos/Roushan-2104/internship-alerts/actions/workflows/watch.yml/dispatches',
  WATCHER_FRESH_MINUTES: 20,
  // Until the relaunch, only these role types are stored and emailed, and remote-only roles are skipped.
  LIVE_ROLE_TYPES: ['internship', 'apprentice', 'research'],
  LIVE_REMOTE_ROLES: false,
  GEMINI_MODEL: 'gemini-3.5-flash-lite',
  // Google doesn't publish free-tier limits, so these stay well below what they're likely to be.
  GEMINI_DAILY_LIMIT: 200,
  GEMINI_READS_PER_TICK: 8,
  GEMINI_MIN_GAP_MS: 4500,
  GEMINI_PAUSE_MINUTES: 60,
  // How long a new job waits to be read by Gemini before the rules match it instead.
  AI_WAIT_MINUTES: 90,
  AI_WAIT_MINUTES_PRIORITY: 20,
  // Off until the new form asks students to agree to Gemini reading their profile.
  AI_READS_PROFILES: false,
  COMPANIES_SOURCE_URL: 'https://raw.githubusercontent.com/Roushan-2104/internship-alerts/main/config/watch.json',
  SENDER_NAME: 'Internship Alerts',
  ALERT_EMAIL: 'internshipalerts.roushan@gmail.com',

  TICK_BUDGET_MS: 100000,
  STALE_AFTER_HOURS: 2,
  GITHUB_SCANS_PER_TICK: 3,
  GITHUB_RESCAN_DAYS: 7,
  RESUME_READS_PER_TICK: 1,
  JOBS_PER_TICK: 10,
  QUOTA_ALERT_REMAINING: 20,
  QUOTA_RESERVED_FOR_INSTANT: 20,
  QUOTA_MIN_FOR_REMINDERS: 40,
  REMINDER_EVERY_DAYS: 75,
  MAX_SEND_ATTEMPTS: 3,
  DIGEST_FIRST_HOUR_IST: 9,
  DIGEST_WINDOW_HOURS: 12,
  LOG_ROWS_KEPT: 500
};

var FORM_TITLES = {
  NAME: 'Full name',
  EMAIL: 'Personal Gmail address',
  DEGREE: 'Degree',
  GRAD_YEAR: 'Expected graduation year',
  SKILLS: 'Skills (separate with commas)',
  EXPERIENCE: 'Experience',
  PROJECTS: 'Projects',
  PRIVATE_PROJECTS: 'Private projects you are working on',
  GITHUB: 'GitHub profile link',
  INTERESTS: 'Roles you are interested in',
  RESUME: 'Resume (optional)',
  STATUS: 'Alert status',
  CONSENT: 'Consent'
};

var ALERT_STATUS = {
  ACTIVE: 'Keep sending me alerts',
  PAUSED: 'Pause alerts',
  DELETE: 'Stop alerts and delete my data'
};

var TABLES = {
  Students: ['responseId', 'status', 'name', 'email', 'degree', 'gradYear', 'skills', 'experience', 'projects',
    'privateProjects', 'github', 'interests', 'resumeFileId', 'editUrl', 'githubUser', 'githubSkills',
    'githubScannedAt', 'githubError', 'resumeSkills', 'resumeReadFileId', 'resumeError', 'lastReminderAt',
    'createdAt', 'updatedAt', 'lastDigestDate', 'ai', 'aiReadAt', 'resumeText'],
  Jobs: ['id', 'title', 'company', 'location', 'url', 'priority', 'deadline', 'minQualifications',
    'preferredQualifications', 'firstSeen', 'processedAt', 'open', 'repostOf', 'aboutRole', 'responsibilities', 'fullText', 'roleType', 'ai', 'aiReadAt', 'aiError'],
  Matches: ['key', 'jobId', 'responseId', 'status', 'score', 'channel', 'reason', 'quote', 'createdAt'],
  Queue: ['queueId', 'type', 'responseId', 'email', 'jobId', 'checkEligibility', 'status', 'attempts', 'createdAt',
    'sentAt', 'error'],
  Skills: ['skill', 'aliases'],
  Logs: ['time', 'level', 'area', 'message']
};
