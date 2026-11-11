# Rebuild decisions

Decisions made on 11 Nov 2026 for the rebuild. Later phases follow these. Anything not covered here is asked first.

## Reset

- Delete everything once the new version is ready: form responses, student profiles, resumes, jobs, matches and the email queue.
- Confirm the deletion with the owner at that time, since it can't be undone.
- After the reset, everyone signs up again, and all open jobs are matched as new.

## Job search

- **Locations:** Indian cities, plus remote roles that say India-based candidates can apply.
- **Role types:** internships, apprentice and trainee, new-grad full-time, student research, and part-time or contract.
- **Part-time and contract:** only when they're also student-level: internship, trainee, fresher or entry-level.
- **New-grad:** includes titles like "Software Engineer I" and "Junior". Gemini reads the experience needed, and students only see roles needing no experience or welcoming freshers.
- **Duplicate boards:** use the bigger board only.

## Companies

- New companies are found by search and approved by the owner before being added.
- Companies are managed in a "Companies" tab of a Google Sheet. Only that tab is published publicly, as it holds company and board names, which are public anyway.

### Approved on 11 Nov 2026 (28)

| Group | Company | Board type | Board |
|---|---|---|---|
| A | Paytm | lever | paytm |
| A | Atlys | ashby | atlys |
| A | Western Digital | smartrecruiters | westerndigital |
| A | Sigmoid | greenhouse | sigmoid |
| A | Glance | greenhouse | glance |
| A | Composio | ashby | composio |
| B | Swiggy | smartrecruiters | swiggy |
| B | Freshworks | smartrecruiters | freshworks |
| B | Zeta | lever | zeta |
| B | Mindtickle | lever | mindtickle |
| B | DevRev | greenhouse | devrev |
| B | ION | lever | ion |
| B | Ema | ashby | ema |
| B | SpotDraft | ashby | spotdraft |
| B | ServiceNow | smartrecruiters | servicenow |
| B | Observe.AI | greenhouse | observeai |
| B | Bolna | ashby | bolna |
| B | Bosch Group | smartrecruiters | boschgroup |
| B | Tala | lever | tala |
| B | Smallest AI | ashby | smallest |
| B | Pocket FM | lever | pocketfm |
| C | Unacademy | smartrecruiters | unacademy |
| C | Whatfix | smartrecruiters | whatfix |
| C | Cars24 | smartrecruiters | cars24 |
| C | Lendingkart | smartrecruiters | lendingkart |
| C | NoBroker | smartrecruiters | nobroker |
| C | InterviewBit | smartrecruiters | interviewbit |
| C | Newton School | smartrecruiters | newtonschool |

Group A had student roles open when approved. Group B was hiring in India but had no student roles open. Group C had only 1–3 India jobs, and some looked like tests.

**Rejected:** LinkedIn's Lever board, which holds test listings, and Apna's Workable board, whose owner couldn't be confirmed.

**New board type needed:** SmartRecruiters, for 15 companies.

## Students

- **Required:** name, email, graduation year, degree, skills and consent. Everything else is optional.
- **Optional preferences:** role types, locations, areas of work, and companies to always or never include.
- **Email timing:** each student picks daily or weekly. Priority roles still go out instantly to every eligible student.
- **Channels:** each student picks email, Telegram or both. Telegram connects through a link to the bot.
- **Language:** English only, with shorter emails that work on phones and with screen readers.

## AI matching

- **Provider:** Gemini, on its free tier.
- **Approach:** Gemini reads each new job once, and each profile and resume once. Matching then uses those details, which keeps requests low.
- **Fallback:** if Gemini fails or its free tier runs out, matching falls back to the rules instead of stopping.
- **Consent:** the consent question must say profiles and resumes go to Google, which may use free-tier data to improve its products.

## Keys

These go in Script Properties only, never in the repo or chat.

- **GitHub token:** already in use, to start the watcher.
- **Gemini API key:** created by the owner in Google AI Studio, signed in with the alerts account.
- **Telegram bot token:** created by the owner with BotFather.

## Build phases

1. More companies, approved by the owner. **Done.**
2. Watcher: new role types, remote roles open to India, area tags, SmartRecruiters, and companies from the Sheet.
3. Gemini reading for jobs, profiles and resumes, with fallback to rules.
4. New form with preferences and timing, and shorter phone-friendly emails.
5. Telegram alerts.
6. Full test, then the reset and launch of the new form.
