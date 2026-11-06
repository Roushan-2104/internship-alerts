# Internship Alerts

Watches internship listings and emails students only about new roles that match their profile.

- **GitHub Actions (public):** Playwright reads job sources every 30 minutes and publishes `data/jobs.json`. It holds job data only.
- **Google Apps Script (private):** handles the form, student profiles, GitHub scans, resume reading, matching, Gmail, health alerts and the status page.

No API keys or domain are needed.

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

## Changing things

| To change | Edit |
|---|---|
| Priority role names | `priorityTitles` in `config/watch.json` |
| Companies | `sources` in `config/watch.json` (see below) |
| Skill synonyms | The `Skills` sheet: list extra names in `aliases`, separated by commas |
| Limits and timing | `CONFIG` in `apps-script/Config.gs` |

To add a company, find its board name in its careers URL and add one of these to `sources`:

```json
{ "type": "greenhouse", "name": "Example", "company": "Example", "board": "example", "requireJobs": false }
```

```json
{ "type": "lever", "name": "Example", "company": "Example", "board": "example", "requireJobs": false }
```

## When something breaks

You get one email when a problem starts and one when it clears, plus a "Still running" email every Monday. If that Monday email stops arriving, check Apps Script first.

| Alert | Likely cause | Fix |
|---|---|---|
| `source:...` with zero jobs | Page changed or blocked the watcher | Check the Actions log, then update `watcher/sources.mjs` |
| `stale` | GitHub Actions stopped or was disabled | Check the Actions tab and re-enable the workflow |
| `feed` | `JOBS_URL` is wrong, or the repo is private | Open the URL while signed out |
| `quota` | Close to the daily email limit | Digests wait for the next day and instant alerts still go |

## Development

```bash
npm install
npx playwright install chromium
npm test
npm run watch
```

The Apps Script tests run the real script files against in-memory fakes of Google's services. They don't prove that Google's own services behave the same way, so do the first test above after any large change.
