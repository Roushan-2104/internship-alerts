import { assertAllowedGoogleUrl, containsKeyword, htmlToText, matchesPriority } from './lib.mjs';

export async function readGoogle(page, source, config) {
  assertAllowedGoogleUrl(source.url);
  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const cards = await page.evaluate(() => {
    const listFrom = (heading) => {
      let node = heading ? heading.nextElementSibling : null;
      while (node && node.tagName !== 'UL') node = node.nextElementSibling;
      return node ? [...node.querySelectorAll('li')].map((li) => li.textContent.trim()).join('\n') : '';
    };
    const found = new Map();
    for (const link of document.querySelectorAll('a[href*="jobs/results/"]')) {
      const match = link.href.match(/jobs\/results\/(\d+)-[^?#]*/);
      const card = link.closest('li');
      const heading = card && card.querySelector('h3');
      if (!match || !heading || found.has(match[1])) continue;
      const placeIcon = [...card.querySelectorAll('i')].find((icon) => icon.textContent.trim() === 'place');
      const qualificationHeading = [...card.querySelectorAll('h4')]
        .find((h4) => /minimum qualifications/i.test(h4.textContent));
      found.set(match[1], {
        rawId: match[1],
        title: heading.textContent.trim(),
        url: link.href.split('?')[0],
        location: placeIcon ? placeIcon.parentElement.textContent.replace('place', '').trim() : '',
        minQualifications: listFrom(qualificationHeading),
      });
    }
    return [...found.values()];
  });

  return cards
    .filter((card) => source.keep !== 'priority' || matchesPriority(card.title, config.priorityTitles))
    .map(({ rawId, ...card }) => ({
      ...card,
      id: `google-${rawId}`,
      company: source.company,
      source: source.name,
      priority: matchesPriority(card.title, config.priorityTitles),
    }));
}

export async function readGoogleDetail(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return page.evaluate(() => {
    const listAfter = (pattern) => {
      const heading = [...document.querySelectorAll('h3')].find((h3) => pattern.test(h3.textContent));
      let node = heading ? heading.nextElementSibling : null;
      while (node && node.tagName !== 'UL') node = node.nextElementSibling;
      return node ? [...node.querySelectorAll('li')].map((li) => li.textContent.trim()).join('\n') : '';
    };
    // The notice is visually collapsed, so innerText misses it.
    const deadline = document.body.textContent
      .match(/complete\s+your\s+application\s+before\s+([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i);
    return {
      minQualifications: listAfter(/^minimum qualifications/i),
      preferredQualifications: listAfter(/^preferred qualifications/i),
      deadline: deadline ? deadline[1].replace(/\s+/g, ' ').trim() : '',
    };
  });
}

function toJob(source, config, fields) {
  return {
    ...fields,
    company: source.company,
    source: source.name,
    priority: matchesPriority(fields.title, config.priorityTitles),
    preferredQualifications: '',
    deadline: '',
  };
}

function keepAtsJob(job, config) {
  return containsKeyword(job.title, config.internKeywords) && containsKeyword(job.location, config.locationKeywords);
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

export async function readGreenhouse(source, config) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}/jobs?content=true`;
  const data = await fetchJson(url);
  return data.jobs
    .map((job) => toJob(source, config, {
      id: `greenhouse-${source.board}-${job.id}`,
      title: job.title,
      url: job.absolute_url,
      location: job.location?.name || '',
      minQualifications: htmlToText(job.content).slice(0, 3000),
    }))
    .filter((job) => keepAtsJob(job, config));
}

export async function readLever(source, config) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(source.board)}?mode=json`;
  const data = await fetchJson(url);
  return data
    .map((job) => toJob(source, config, {
      id: `lever-${source.board}-${job.id}`,
      title: job.text,
      url: job.hostedUrl,
      location: job.categories?.location || '',
      minQualifications: String(job.descriptionPlain || '').slice(0, 3000),
    }))
    .filter((job) => keepAtsJob(job, config));
}
