import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { mergeRun } from './lib.mjs';
import { readAshby, readGoogle, readGoogleDetail, readGreenhouse, readLever, readSmartRecruiters } from './sources.mjs';
import { companiesToSources, parseCsv } from './classify.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JOBS_FILE = process.env.JOBS_FILE || resolve(root, 'data/jobs.json');
// Raising this re-reads stored Google jobs once when more fields are collected.
const DETAIL_VERSION = 2;

async function loadState() {
  try {
    return JSON.parse(await readFile(JOBS_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { jobs: [] };
    throw error;
  }
}

async function readSource(source, config, page) {
  try {
    let jobs;
    if (source.type === 'google') jobs = await readGoogle(page, source, config);
    else if (source.type === 'greenhouse') jobs = await readGreenhouse(source, config);
    else if (source.type === 'lever') jobs = await readLever(source, config);
    else if (source.type === 'ashby') jobs = await readAshby(source, config);
    else if (source.type === 'smartrecruiters') jobs = await readSmartRecruiters(source, config);
    else throw new Error(`Unknown source type: ${source.type}`);
    return { ...baseResult(source), ok: true, jobs };
  } catch (error) {
    return { ...baseResult(source), ok: false, jobs: [], error: error.message };
  }
}

function baseResult(source) {
  return {
    name: source.name,
    company: source.company,
    requireJobs: Boolean(source.requireJobs),
    // A filtered search can't prove a job closed; only full listings can.
    authoritative: source.keep !== 'priority',
  };
}

// Detail pages are only requested for new jobs, within a per-run cap, and retried a limited number of times.
async function fillGoogleDetails(state, page, config) {
  let fetched = 0;
  for (const job of state.jobs) {
    if (fetched >= config.maxDetailFetchesPerRun) break;
    const needsDetail = job.id.startsWith('google-') && job.open && job.detailVersion !== DETAIL_VERSION
      && (job.detailAttempts || 0) < config.maxDetailAttempts;
    if (!needsDetail) continue;
    fetched += 1;
    job.detailAttempts = (job.detailAttempts || 0) + 1;
    try {
      const detail = await readGoogleDetail(page, job.url);
      job.minQualifications = detail.minQualifications || job.minQualifications;
      job.preferredQualifications = detail.preferredQualifications;
      job.deadline = detail.deadline;
      job.aboutRole = detail.aboutRole;
      job.responsibilities = detail.responsibilities;
      job.detailVersion = DETAIL_VERSION;
      job.detailAttempts = 0;
      delete job.detailError;
    } catch (error) {
      job.detailError = error.message;
    }
    await sleep(config.delayBetweenRequestsMs);
  }
}

/**
 * Reads companies from the published Companies sheet. If it can't be read or has no
 * usable rows, the list in config/watch.json is used and the problem is reported.
 */
async function loadCompanies(config) {
  const fallback = config.companies.map((c) => ({ ...c, name: c.company, requireJobs: false }));
  if (!config.companiesCsvUrl) return { sources: fallback, status: null };
  try {
    const response = await fetch(config.companiesCsvUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { sources, problems } = companiesToSources(parseCsv(await response.text()));
    if (!sources.length) throw new Error('no usable rows');
    return { sources, status: { ok: true, count: sources.length, error: problems.length ? problems.join(' | ').slice(0, 500) : null } };
  } catch (error) {
    return { sources: fallback, status: { ok: false, count: fallback.length, error: `Could not read the Companies sheet (${error.message}), so the saved list was used` } };
  }
}

async function main() {
  const config = JSON.parse(await readFile(resolve(root, 'config/watch.json'), 'utf8'));
  const previous = await loadState();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const companies = await loadCompanies(config);
    const results = [];
    for (const source of [...config.sources, ...companies.sources]) {
      results.push(await readSource(source, config, page));
      // Google pages get a longer pause than the job board APIs.
      await sleep(source.type === 'google' ? config.delayBetweenRequestsMs : config.delayBetweenApiRequestsMs);
    }
    const next = mergeRun(previous, results, config);
    if (companies.status) next.sources['Companies sheet'] = { ...companies.status, checkedAt: next.generatedAt };
    await fillGoogleDetails(next, page, config);
    await mkdir(dirname(JOBS_FILE), { recursive: true });
    await writeFile(JOBS_FILE, `${JSON.stringify(next, null, 2)}\n`);

    for (const [name, status] of Object.entries(next.sources)) {
      console.log(`${status.ok ? 'OK  ' : 'FAIL'} ${name}: ${status.count} job(s)${status.error ? ` - ${status.error}` : ''}`);
    }
    console.log(`Stored ${next.jobs.length} job(s), ${next.jobs.filter((job) => job.open).length} open.`);
    // One startup's board failing shouldn't fail the whole run. It still reaches you as a health alert.
    const required = config.sources.filter((source) => source.requireJobs);
    if (required.some((source) => !next.sources[source.name].ok)) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
