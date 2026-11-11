# Internship Alerts

Watches internship listings and emails students about new roles that match their profile, with instant alerts for priority roles and one digest a day.

- **GitHub Actions (public):** Playwright reads job sources and publishes `data/jobs.json`. It holds job data only. Apps Script starts each run, and the workflow's own schedule is a backup, because GitHub doesn't guarantee when scheduled runs start.
- **Google Apps Script (private):** handles the form, student profiles, GitHub scans, resume reading, matching, Gmail, health alerts and the status page.

No domain is needed. The only key is one GitHub token, limited to this repo, which lets Apps Script start the watcher.

## Rules the watcher must follow

Google's `robots.txt` disallows paginated job result URLs (`page=`) for all crawlers, and Google's terms prohibit automated access that breaks those rules. The watcher therefore reads only the first page of a filtered search and refuses any `page=` URL. If a search ever fills its first page, narrow the filters rather than paginating. Re-check `robots.txt` from time to time, as it can change.

## Setup

### 1. Apps Script project

Sign in to Google as `internshipalerts.roushan@gmail.com`, open <https://script.google.com> and create a project. `setup()` refuses to run from any other account.

1. In **Project Settings**, turn on "Show appsscript.json", then replace that file with `apps-script/appsscript.json`.
2. Add every `.gs` file from `apps-script/`, plus an HTML file named `Status` containing `Status.html`.
3. Run `setup` and click Allow. The execution log shows the links for the data sheet and form.

### 2. Resume question

Google doesn't allow scripts to create file-upload questions, so add this one by hand:

1. Open the form's edit link from the log.
2. Add a **File upload** question titled exactly `Resume (optional)`. Leave it not required.
3. Move it above "Alert status".

Adding it means everyone must sign in to Google to fill in the form. The status page shows a warning until this question exists.

### 3. Status page

**Deploy > New deployment > Web app**, with "Execute as: Me" and "Who has access: Only myself". Bookmark the URL. Use **Manage deployments** to publish later code changes.

### 4. First test

Fill in the form yourself, then run `tick` from the editor. You should get a confirmation email, and the status page should show one active student.

The first sync records jobs that are already open without emailing anyone. Only jobs that appear later are matched.

## What students receive

- **Instant alert:** a new priority role, usually within about an hour.
- **Daily digest:** one email per India date, sent from the student's assigned hour (between 9 AM and 9 PM). It lists new matches, or says there are no new openings. Jobs found after it goes out wait for the next day.

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
| Skill synonyms | The `Skills` sheet: list extra names in `aliases`, separated by commas |
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
| `source:...` with zero jobs | Page changed or blocked the watcher | Check the Actions log, then update `watcher/sources.mjs` |
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
