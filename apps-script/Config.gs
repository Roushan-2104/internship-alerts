var CONFIG = {
  EXPECTED_ACCOUNT: 'internshipalerts.roushan@gmail.com',
  JOBS_URL: 'https://raw.githubusercontent.com/Roushan-2104/internship-alerts/main/data/jobs.json',
  WORKFLOW_DISPATCH_URL: 'https://api.github.com/repos/Roushan-2104/internship-alerts/actions/workflows/watch.yml/dispatches',
  WATCHER_FRESH_MINUTES: 20,
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
    'createdAt', 'updatedAt', 'lastDigestDate'],
  Jobs: ['id', 'title', 'company', 'location', 'url', 'priority', 'deadline', 'minQualifications',
    'preferredQualifications', 'firstSeen', 'processedAt', 'open', 'repostOf', 'aboutRole', 'responsibilities', 'fullText'],
  Matches: ['key', 'jobId', 'responseId', 'status', 'score', 'channel', 'reason', 'quote', 'createdAt'],
  Queue: ['queueId', 'type', 'responseId', 'email', 'jobId', 'checkEligibility', 'status', 'attempts', 'createdAt',
    'sentAt', 'error'],
  Skills: ['skill', 'aliases'],
  Logs: ['time', 'level', 'area', 'message']
};
