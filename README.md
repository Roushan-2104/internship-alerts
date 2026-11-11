# Internship Alerts

Internship Alerts finds new internships and early-career roles in India and tells students about the ones that match them, by email, Telegram or both.

It watches Google's careers site and about 90 companies and startups, reads each posting, checks who can apply, and sends each student only the roles that fit their degree, graduation year, skills and preferences. Priority roles are sent straight away, and everything else arrives in a daily or weekly digest.

It runs on free services: GitHub Actions and a Google account. No server or domain is needed.

## For students

Sign up with the form, which takes about a minute. You sign in with Google, which confirms your email. You give your name, degree, graduation year and skills, and choose how to get alerts.

You can then stop, or add more to get better matches:

- **What you want:** role types (internships, apprenticeships, new-grad, research, part-time), cities or remote, areas of work, and daily or weekly emails.
- **Your experience:** projects, a GitHub link, a resume, and companies to always or never include.

Every email has a personal link to update your answers, pause alerts, or delete all your data.

Each role in an email shows what it is, the deadline, and the posting's own details under clear headings: about the role, what you'll do, what they ask for, and what's nice to have. Roles that don't state who can apply are marked **check eligibility**.

## How it works

```
 Job boards and Google careers         Companies sheet (published CSV)
              \                              /
               v                            v
     GitHub Actions: watcher (public, read-only job)
               |  saves public job data only
               v
         data/jobs.json  (this repo)
               |
               v
     Google Apps Script (private, in the owner's Google account)
       - starts the watcher every 30 minutes
       - Gemini reads each new job once
       - matches jobs to students
       - sends email (Gmail) and Telegram messages
       - health alerts and an owner-only status page
               |
               v
            Students
```

| Part | Where it runs | What it does |
|---|---|---|
| **Watcher** (`watcher/`) | GitHub Actions | Reads job sources with Playwright and public job board APIs (Greenhouse, Lever, Ashby, SmartRecruiters). Keeps student and early-career roles in India, or remote and open to India. Tags each one with its role type and area of work, and splits descriptions into sections |
| **Job data** (`data/jobs.json`) | This repo | Public job data only, updated by the watcher |
| **Alerts service** (`apps-script/`) | Google Apps Script | The sign-up form, student profiles, Gemini, matching, email and Telegram delivery, health alerts and the status page. All student data stays in the owner's private Google account |

### Matching

1. **Eligibility first:** degree level, graduation year and, for new-grad roles, the experience required. Gemini reads each job once to find these. If Gemini is unavailable, rule-based checks are used.
2. **Then preferences:** role types, locations, areas and companies, if the student set any.
3. **Then skills:** for ordinary roles, the student's skills must overlap with the job's, or the job must name none.

Priority roles, such as Google's student software roles, skip the preference and skills filters, but only for eligible students who haven't excluded that company.

## Privacy and data

- **Nothing about students is ever stored in this repo.** It holds only code and public job data.
- **Student data stays in the owner's private Google account:** form answers, profiles, resumes and the alert queue.
- **Gemini:** profiles and resumes are only sent to Google's Gemini if the student agreed to this in the consent question. On Gemini's free tier, Google may use that data to improve its products, and the consent wording says so. Emails, phone numbers and links are removed from resumes first.
- **Deleting:** a student can delete their data at any time from their personal link. That removes their profile, matches, queued and sent-email records, and resume. Resumes are permanently deleted where Google allows, and moved to trash otherwise. Copies of emails already sent stay in the alerts account's Sent folder.
- **Keys:** they live only in the script's private settings, never in this repo.
- **Status page:** only the owner's account can open it.

## Respecting the sites it reads

- **Google careers:** Google's `robots.txt` disallows paginated result pages, so the watcher only reads the first page of narrow searches and refuses any `page=` link.
- **Company job boards:** these are read through their public APIs.
- **YC:** YC's website terms ban scraping, so `ycombinator.com` and `workatastartup.com` are never read. YC startups are only included through their own public job boards.

## What's in this repo

| Path | What it is |
|---|---|
| `watcher/` | The job watcher (Node.js and Playwright) |
| `apps-script/` | The alerts service (Google Apps Script) |
| `config/watch.json` | Google searches, priority role names, and a fallback company list |
| `.github/workflows/watch.yml` | Reads jobs in a read-only job, then saves them in a separate job, with pinned actions |
| `scripts/publish-data.sh` | Saves job data, safely handling two runs that overlap |
| `scripts/monitor.ps1` | A live terminal view of watcher runs and job data |
| `tests/` | Automated tests for the watcher and the Apps Script code |
| `docs/rebuild-decisions.md` | Design decisions and their reasons |

## Run your own copy

You need a GitHub account, a Google account for the alerts service, and Node.js 20 or later.

### 1. Fork and configure

Fork this repo, then replace the owner-specific values:

| File | Setting | Set it to |
|---|---|---|
| `apps-script/Config.gs` | `EXPECTED_ACCOUNT`, `ALERT_EMAIL` | Your alerts Google account |
| `apps-script/Config.gs` | `JOBS_URL`, `WORKFLOW_DISPATCH_URL`, `COMPANIES_SOURCE_URL` | Your fork's paths |
| `apps-script/Config.gs` | `TELEGRAM_BOT_USERNAME` | Your bot's username, or `''` for no Telegram |
| `apps-script/Config.gs` | `RESET_AND_LAUNCH` | `''` until you launch |
| `config/watch.json` | `companiesCsvUrl` | `''` until you publish your own sheet |

### 2. Install the alerts service

```bash
npm install -g @google/clasp
clasp login
```

1. Sign in as your alerts account.
2. Create a project at <https://script.google.com> and turn on the Apps Script API in its user settings.
3. Put the project's ID in a `.clasp.json` in this folder:

   ```json
   { "scriptId": "YOUR_SCRIPT_ID", "rootDir": "apps-script" }
   ```

   This file is gitignored.
4. Push the code:

   ```bash
   clasp push --force
   ```
5. In the Apps Script editor, run `setup` once and click **Allow**. It creates the data spreadsheet and the 30-minute and 5-minute triggers, and refuses to run from any account other than `EXPECTED_ACCOUNT`.
6. **Deploy > New deployment > Web app**, with "Execute as: Me" and "Who has access: Only myself". This is your status page, so bookmark it. The page has a **Run pending setup now** link.

One-time steps after that are **admin actions** in `apps-script/Admin.gs`. The next run carries out each one once, or you can click **Run pending setup now**. They include creating the sign-up form.

### 3. Add the keys

In **Project Settings > Script Properties**:

| Property | What it's for | How to get it |
|---|---|---|
| `GITHUB_DISPATCH_TOKEN` | Starts the watcher, because GitHub's own schedule is unreliable | A fine-grained token limited to your fork, with **Actions: Read and write** only |
| `GEMINI_API_KEY` | Reads jobs, and the profiles of students who agreed | Google AI Studio |
| `TELEGRAM_BOT_TOKEN` | Telegram alerts (optional) | @BotFather |

### 4. Finish the form

Google doesn't let scripts create file upload questions, so add one by hand. On the status page, click **Edit the form**. On the **Your experience** page, add a **File upload** question titled exactly `Resume (optional)`, not required.

### 5. Launch

Until launch, only internship-style roles are emailed, and the original setup form stays in use. To switch to the new form with every role type, set `RESET_AND_LAUNCH` in `Config.gs` to the phrase in `Admin.gs`, then push.

**This deletes all student data**, which costs nothing on a fresh copy. The deletion runs once only.

## Operating it

| To change | Where |
|---|---|
| Companies | The published Companies spreadsheet: set **Enabled** to `no` to pause, or add a row with Company, Type and Board. Run `setupCompanies` once to create it, then publish it as CSV and set `companiesCsvUrl` |
| Priority role names | `priorityTitles` in `config/watch.json` |
| Skill synonyms | The `Skills` tab. New skills students type wait there until you set **approved** to `yes` |
| Limits and timing | `CONFIG` in `apps-script/Config.gs` |

Check that a company's board name really belongs to it before adding it, as names can collide. Companies with their own careers systems, such as Amazon, Microsoft or Flipkart, would need a custom reader.

**Email limits:** personal Gmail allows about 100 recipients a day, and 20 are held back for instant alerts. That fits about 80 students on daily email digests. Telegram-only students don't count. Near the limit, digests with jobs go first.

### Alerts and fixes

The owner gets one email when a problem starts, one when it clears, and a "still running" email every Monday.

| Alert | Likely cause | Fix |
|---|---|---|
| `sources:...` | A job source failed | Check the Actions log. For a company, check its board name |
| `step:watcher` | The GitHub token expired | Create a new token |
| `step:gemini` | The Gemini key is invalid, or the model was retired | Replace the key, or update `GEMINI_MODEL` |
| `step:telegram` | The Telegram token is invalid | Create a new token with @BotFather |
| `stale` | Watcher runs aren't finishing | Check the Actions tab |
| `quota` | Close to the daily email limit | Nothing. Digests wait for the next day |

## Development

```bash
npm install
npx playwright install chromium
npm test          # watcher and Apps Script tests
npm run watch     # one real watcher run, writing data/jobs.json
```

The Apps Script tests run the real `.gs` files against in-memory stand-ins for Google's services. They catch logic errors, but can't prove Google's own services behave the same way, so try a real sign-up after large changes.

Code reaches the live script with `clasp push --force`. Changes to the status page also need a new deployment version, which you can create in **Deploy > Manage deployments**.

## Known limitations

- **Google:** only the first page of each Google search is read, so very broad searches would miss roles.
- **Remote roles:** they're only included when the posting says people in India can apply, which few do.
- **Company coverage:** many YC startups and large companies aren't covered, because they don't use the public job boards supported here.
- **Gemini and rules:** both can misread unusual postings, so roles that are unclear are marked **check eligibility** rather than hidden.
- **Delays:** alerts follow 30-minute checks, so a new priority role usually arrives within about an hour.

## License

[MIT](LICENSE). You're free to use, copy, modify and share this code, including in your own projects, as long as the license notice is kept.
