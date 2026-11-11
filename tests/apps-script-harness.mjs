import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../apps-script');

// Answers any builder call with itself, like FormApp's chained setters.
function chain(extra = {}) {
  const proxy = new Proxy(extra, { get: (target, key) => (key in target ? target[key] : () => proxy) });
  return proxy;
}

class FakeSheet {
  constructor() { this.rows = []; }
  appendRow(row) { this.rows.push([...row]); }
  getLastRow() { return this.rows.length; }
  getDataRange() { return { getValues: () => this.rows.map((row) => [...row]) }; }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  deleteRows(row, count) { this.rows.splice(row - 1, count); }
  setFrozenRows() {}
  getRange(row) {
    return {
      setNumberFormat: () => {},
      setValues: (values) => { this.rows[row - 1] = [...values[0]]; },
      clearContent: () => { this.rows = this.rows.slice(0, row - 1); },
    };
  }
}

/** Builds a sandbox running the real script files on in-memory fakes of Google's services. */
export function createWorld({ configured = true } = {}) {
  const world = {
    sent: [], props: {}, sheets: {}, quota: 100, hour: 0, day: '2026-11-06', weekday: '5', account: 'internshipalerts.roushan@gmail.com',
    fetch: () => ({ code: 404, body: '' }), fetched: [], trashed: [], deletedResponses: [], triggers: [], companyNames: null,
    removed: [], tempCopies: [], dispatches: [], dispatch: { code: 204 }, geminiCalls: [], gemini: null, telegramCalls: [], telegram: null, formItems: [], ocrText: 'Skills: Python and Docker', ocrFails: false, created: 0,
  };
  const book = {
    getSheets: () => [{ getDataRange: () => ({ getValues: () => [['Company'], ...(world.companyNames || []).map((n) => [n])] }) }],
    getId: () => 'sheet-id',
    getUrl: () => 'https://sheet',
    getSheetByName: (name) => world.sheets[name] || null,
    insertSheet: (name) => { world.sheets[name] = new FakeSheet(); return world.sheets[name]; },
    deleteSheet: () => {},
  };
  const makeForm = (id) => {
    const items = id === 'form-id' ? world.formItems : [];
    const addItem = (kind) => () => {
      const item = chain({
        setTitle: (title) => { item.title = title; return item; },
        getTitle: () => item.title,
        getType: () => kind,
        asTextItem: () => chain({ createResponse: (value) => ({ value }) }),
      });
      items.push(item);
      return item;
    };
    const form = chain({
      getId: () => id,
      getEditUrl: () => `https://edit/${id}`,
      getPublishedUrl: () => `https://share/${id}`,
      getItems: () => items,
      deleteResponse: (responseId) => world.deletedResponses.push(`${id}:${responseId}`),
      addTextItem: addItem('TEXT'), addParagraphTextItem: addItem('PARAGRAPH_TEXT'), addCheckboxItem: addItem('CHECKBOX'),
      addMultipleChoiceItem: addItem('MULTIPLE_CHOICE'), addListItem: addItem('LIST'),
      createResponse: () => chain({ withItemResponse: (r) => chain({ toPrefilledUrl: () => `https://resume/${id}?code=${r.value}` }) }),
    });
    world.forms[id] = form;
    return form;
  };
  world.forms = {};
  let created = 0;
  const form = makeForm('form-id');
  const triggerBuilder = (name) => chain({ create: () => world.triggers.push(name) });
  const sandbox = {
    console,
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => world.props[k] ?? null, setProperty: (k, v) => { world.props[k] = String(v); } }) },
    SpreadsheetApp: { create: () => book, openById: () => book },
    FormApp: { create: () => (created++ === 0 ? form : makeForm(`form-${created}`)), openById: (id) => world.forms[id] || form, createTextValidation: () => chain(), ItemType: { FILE_UPLOAD: 'FILE_UPLOAD' } },
    MailApp: {
      getRemainingDailyQuota: () => world.quota,
      sendEmail: (message) => { if (world.mailFails) throw new Error('mail down'); world.quota -= 1; world.sent.push(message); },
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        world.fetched.push(url);
        if (url.includes('api.telegram.org')) {
          const method = url.split('/').pop();
          const payload = JSON.parse(options.payload);
          world.telegramCalls.push({ url, method, payload });
          const answer = world.telegram ? world.telegram(method, payload) : { code: 200, body: { ok: true, result: [] } };
          return { getResponseCode: () => answer.code, getContentText: () => JSON.stringify(answer.body) };
        }
        if (url.includes('generativelanguage.googleapis.com')) {
          world.geminiCalls.push({ url, options });
          const answer = world.gemini ? world.gemini(url, options) : { code: 500, body: '' };
          return { getResponseCode: () => answer.code, getContentText: () => answer.body };
        }
        if (url.includes('/dispatches')) {
          world.dispatches.push(options);
          return { getResponseCode: () => world.dispatch.code, getContentText: () => '' };
        }
        const result = world.fetch(url);
        return { getResponseCode: () => result.code, getContentText: () => result.body };
      },
    },
    Utilities: { sleep: () => {}, getUuid: () => `00000000-0000-4000-8000-${String(++world.created).padStart(12, '0')}`, formatDate: (date, zone, format) => (format === 'H' ? String(world.hour) : format === 'u' ? world.weekday : world.day) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => world.account }) },
    DriveApp: {
      getFileById: (id) => ({ setTrashed: () => world.trashed.push(id) }),
      getFilesByName: () => { const files = [...(world.tempCopies || [])]; world.tempCopies = []; return { hasNext: () => files.length > 0, next: () => { const id = files.shift(); return { getId: () => id }; } }; },
      searchFolders: () => {
        const files = [...(world.uploadFolderFiles || [])];
        let given = false;
        return {
          hasNext: () => !given,
          next: () => { given = true; return { getFiles: () => ({ hasNext: () => files.length > 0, next: () => { const id = files.shift(); return { getId: () => id, setTrashed: () => world.trashed.push(id) }; } }) }; },
        };
      },
    },
    Drive: { Files: { copy: () => { if (world.ocrFails) throw new Error('OCR failed'); return { id: 'temp-doc' }; }, remove: (id) => { world.removed.push(id); world.trashed.push(id); } } },
    DocumentApp: { openById: () => ({ getBody: () => ({ getText: () => world.ocrText }) }) },
    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger: () => {},
      WeekDay: { MONDAY: 1 },
      newTrigger: (name) => triggerBuilder(name),
    },
    HtmlService: {},
  };
  vm.createContext(sandbox);
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.gs'))) {
    vm.runInContext(readFileSync(resolve(dir, file), 'utf8'), sandbox, { filename: file });
  }
  if (configured) {
    sandbox.CONFIG.JOBS_URL = 'https://raw/jobs.json';
    sandbox.CONFIG.SENDER_NAME = 'Test Sender';
    sandbox.CONFIG.ALERT_EMAIL = 'owner@example.com';
  }
  world.sandbox = sandbox;
  world.table = (name) => sandbox.readTable_(name);
  return world;
}

export function feed(jobs, overrides = {}) {
  return {
    code: 200,
    body: JSON.stringify({
      generatedAt: new Date().toISOString(),
      sources: { Google: { ok: true, count: jobs.length } },
      jobs,
      ...overrides,
    }),
  };
}

export function makeJob(id, overrides = {}) {
  return {
    id, title: `${id} Intern`, company: 'Google', location: 'Bengaluru, India', url: `https://jobs/${id}`, priority: false,
    open: true, minQualifications: "Pursuing a Bachelor's degree.\nExperience with Python.", preferredQualifications: '',
    deadline: '', firstSeen: new Date().toISOString(), repostOf: null, ...overrides,
  };
}

export function makeResponse(sandbox, id, overrides = {}) {
  const titles = sandbox.FORM_TITLES;
  const answers = {
    [titles.NAME]: 'Asha',
    [titles.EMAIL]: 'asha@example.com',
    [titles.DEGREE]: "Bachelor's (BTech, BE, BSc, BCA and similar)",
    [titles.GRAD_YEAR]: '2029',
    [titles.SKILLS]: 'Python, SQL',
    [titles.STATUS]: sandbox.ALERT_STATUS.ACTIVE,
    ...overrides,
  };
  delete answers.__formId;
  delete answers.__respondent;
  const respondent = overrides.__respondent;
  delete answers.__respondent;
  return {
    getId: () => id,
    getRespondentEmail: () => respondent || '',
    getEditResponseUrl: () => `https://edit/${id}`,
    getItemResponses: () => Object.entries(answers)
      .filter(([, value]) => value !== undefined)
      .map(([title, value]) => ({ getItem: () => ({ getTitle: () => title }), getResponse: () => value })),
    formId: overrides.__formId,
  };
}

// Compiles Apps Script's template syntax so the status page is really rendered in the tests.
export function renderStatus(data) {
  const source = readFileSync(resolve(dir, 'Status.html'), 'utf8');
  const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let code = 'let out = "";\n';
  let last = 0;
  for (const match of source.matchAll(/<\?(=?)([\s\S]*?)\?>/g)) {
    code += `out += ${JSON.stringify(source.slice(last, match.index))};\n`;
    code += match[1] ? `out += escape(${match[2]});\n` : `${match[2]}\n`;
    last = match.index + match[0].length;
  }
  code += `out += ${JSON.stringify(source.slice(last))};\nreturn out;`;
  return new Function('data', 'escape', code)(data, escape);
}
