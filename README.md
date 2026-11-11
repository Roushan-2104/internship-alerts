# Internship Alerts

Watches internship and early-career listings in India and alerts students about new roles that match them, by email, Telegram or both. Priority roles are sent straight away, and everything else goes in a daily or weekly digest.

- **GitHub Actions (public):** Playwright reads job sources and publishes `data/jobs.json`, which holds public job data only. Apps Script starts each run. The workflow's own schedule is a backup, because GitHub doesn't guarantee when scheduled runs start.
- **Google Apps Script (private):** handles the sign-up form, student profiles, GitHub scans, resume reading, Gemini, matching, Gmail, Telegram, health alerts and the status page.

No domain is needed. Three keys live only in Script Properties, never in this repo:

| Property | What it's for |
|---|---|
| `GITHUB_DISPATCH_TOKEN` | Starts the watcher |
| `GEMINI_API_KEY` | Reads jobs, and the profiles of students who agreed |
| `TELEGRAM_BOT_TOKEN` | Sends Telegram alerts |

## Rules the watcher must follow

Google's `robots.txt` disallows paginated job result URLs (`page=`) for all crawlers, and Google's terms prohibit automated access that breaks those rules. The watcher therefore reads only the first page of a filtered search and refuses any `page=` URL. If a search ever fills its first page, narrow the filters rather than paginating. Re-check `robots.txt` from time to time, as it can change.

YC's website terms ban scraping, so YC startups are only included through their own public job boards.

## How setup works now

Code goes live with `clasp push --force` from this folder. One-time setup steps are **admin actions** in `apps-script/Admin.gs`: the next 30-minute run carries out each one once and logs it, so nobody has to click Run.

### The sign-up form

There is one form, and its first page takes about a minute: name, degree, graduation year, skills, how to get alerts, and consent. Students then choose to finish, add preferences and experience on two optional pages, or pause or delete their alerts on a page of its own. Students sign in with Google, which confirms their email, so nobody can sign up, replace or delete someone else.

The form is created automatically. One step has to be done by hand, because Google doesn't let scripts create file-upload questions:

1. Open the form's edit link (it's in the Apps Script log, or find "Internship Alerts Sign-up" in Google Forms).
2. On the **Your experience** page, add a **File upload** question titled exactly `Resume (optional)`. Leave it not required.

The status page shows a warning until this question exists.

### Telegram

1. Create a bot with **@BotFather** and save its token as `TELEGRAM_BOT_TOKEN`.
2. Set `TELEGRAM_BOT_USERNAME` in `Config.gs` to the bot's username, then push.

Students who choose Telegram get a connect link in their confirmation email. Until they connect, alerts come by email. The script reads the bot's messages on each run, so it needs no public web address.

### Launch and reset

Before launch, the old form keeps working, and new-grad and most remote roles are held back. Launch deletes **every** student's data and switches to the new form, so it only runs after the owner confirms. To launch, set `RESET_AND_LAUNCH` in `Config.gs` to the exact phrase in `Admin.gs` and push.

The next run then:
- deletes all form responses, resumes, students, matches, queued emails, stored jobs and learned skills;
- closes the old form with a message pointing to the new one;
- turns on all role types.

Open jobs then come back as new. Everyone who signs up afterwards gets the open jobs that match them once, in their first digest.

### Status page

**Deploy > New deployment > Web app**, with "Execute as: Me" and "Who has access: Only myself". Bookmark the URL. Use **Manage deployments** to publish code changes to it.

## What students receive

- **Instant alert:** a new priority role, usually within about an hour.
- **Digest:** daily, or weekly on Sundays, as each student chooses. It's sent from the student's assigned hour (between 9 AM and 9 PM India time), and lists new matches or says there are no new openings. Jobs found after it goes out wait for the next one.
- **Preferences:** students can choose role types, locations, areas of work and companies. These are strict, except that eligible priority roles always go out unless the student excluded that company.

Every active student gets a daily email. Personal Gmail allows about 100 recipients a day and 20 are held back for instant alerts, so this fits about 80 students. Past that, digests with jobs go first and "no openings" emails are dropped for the day.

To preview the emails, run `sendTestEmails` from the editor. The samples go to the alerts inbox only.

To send waiting digests straight away, run `sendDigestNow`. **This emails every active student who has matches waiting**, ignoring their assigned hour.

## GitHub token

Apps Script reads this from the `GITHUB_DISPATCH_TOKEN` script property. Never put it in a project file, because this repo is public.

Create it at <https://github.com/settings/personal-access-tokens/new>, limited to this repo, with **Actions: Read and write** and nothing else. Save it in **Project Settings > Script Properties**.

It expires on the date you chose when creating it. When it does, you get a `step:watcher` problem email: create a new token and replace the value.

## Changing things

| To change | Edit |
|---|---|
| Priority role names | `priorityTitles` in `config/watch.json` |
| Companies | The **Internship Alerts Companies** spreadsheet (see below) |
| Skill synonyms | The `Skills` sheet. New skill names students type appear there with **approved** blank. Set it to `yes` to use one for everyone, or list extra names in `aliases` |
| Limits and timing | `CONFIG` in `apps-script/Config.gs` |

Companies are read from the **Internship Alerts Companies** spreadsheet, which is published as CSV and contains nothing else. Set **Enabled** to `no` to pause a company. To add one, fill in Company, Type (`greenhouse`, `lever`, `ashby` or `smartrecruiters`) and Board, which is the name in its careers URL. Changes reach the watcher within about 30 minutes.

Check the board really belongs to that company, as names can collide. If the sheet can't be read, the watcher uses `companies` in `config/watch.json` and raises a `Companies sheet` alert, so keep that list roughly in step.

```json
{ "type": "greenhouse", "name": "Example", "company": "Example", "board": "example", "requireJobs": false }
```

Companies with their own careers systems, such as Amazon, Microsoft or Flipkart, need a custom reader.

YC's website terms ban robots and scraping, so the watcher doesn't read `ycombinator.com` or `workatastartup.com`. YC startups are only included through their own public job boards, which is why many are missing. Students can check Work at a Startup themselves.

## When something breaks

You get one email when a problem starts and one when it clears, plus a "Still running" email every Monday. If that Monday email stops arriving, check Apps Script first.

| Alert | Likely cause | Fix |
|---|---|---|
| `sources:...` | One or more job sources failed (one alert covers them all) | Check the Actions log. For a company, check its board in the Companies sheet; for Google, update `watcher/sources.mjs` |
| `step:watcher` | The GitHub token expired or lost access | Create a new token (see above) |
| `stale` | The watcher ran but failed, or runs aren't starting | Check the Actions tab and re-enable the workflow if needed |
| `feed` | `JOBS_URL` is wrong, or the repo is private | Open the URL while signed out |
| `quota` | Close to the daily email limit | Digests wait for the next day and instant alerts still go |

## Development

Code changes go live with `clasp push --force` from this folder, once `clasp login` has been run as the alerts account. `.clasp.json` stays out of Git.

```bash
npm install
npx playwright install chromium
npm test
npm run watch
```

The Apps Script tests run the real script files against in-memory fakes of Google's services. They don't prove that Google's own services behave the same way, so do the first test above after any large change.
