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
    };
  }
}

/** Builds a sandbox running the real script files on in-memory fakes of Google's services. */
export function createWorld({ configured = true } = {}) {
  const world = {
    sent: [], props: {}, sheets: {}, quota: 100, hour: 12, account: 'internshipalerts.roushan@gmail.com',
    fetch: () => ({ code: 404, body: '' }), fetched: [], trashed: [], deletedResponses: [], triggers: [],
    formItems: [], ocrText: 'Skills: Python and Docker', ocrFails: false, created: 0,
  };
  const book = {
    getId: () => 'sheet-id',
    getUrl: () => 'https://sheet',
    getSheetByName: (name) => world.sheets[name] || null,
    insertSheet: (name) => { world.sheets[name] = new FakeSheet(); return world.sheets[name]; },
    deleteSheet: () => {},
  };
  const form = chain({
    getId: () => 'form-id',
    getEditUrl: () => 'https://edit',
    getPublishedUrl: () => 'https://share',
    getItems: () => world.formItems,
    deleteResponse: (id) => world.deletedResponses.push(id),
  });
  const triggerBuilder = (name) => chain({ create: () => world.triggers.push(name) });
  const sandbox = {
    console,
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => world.props[k] ?? null, setProperty: (k, v) => { world.props[k] = String(v); } }) },
    SpreadsheetApp: { create: () => book, openById: () => book },
    FormApp: { create: () => form, openById: () => form, createTextValidation: () => chain(), ItemType: { FILE_UPLOAD: 'FILE_UPLOAD' } },
    MailApp: {
      getRemainingDailyQuota: () => world.quota,
      sendEmail: (message) => { if (world.mailFails) throw new Error('mail down'); world.quota -= 1; world.sent.push(message); },
    },
    UrlFetchApp: {
      fetch: (url) => {
        world.fetched.push(url);
        const result = world.fetch(url);
        return { getResponseCode: () => result.code, getContentText: () => result.body };
      },
    },
    Utilities: { getUuid: () => `id-${++world.created}`, formatDate: () => String(world.hour) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => world.account }) },
    DriveApp: { getFileById: (id) => ({ setTrashed: () => world.trashed.push(id) }) },
    Drive: { Files: { copy: () => { if (world.ocrFails) throw new Error('OCR failed'); return { id: 'temp-doc' }; } } },
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
  return {
    getId: () => id,
    getEditResponseUrl: () => `https://edit/${id}`,
    getItemResponses: () => Object.entries(answers)
      .filter(([, value]) => value !== undefined)
      .map(([title, value]) => ({ getItem: () => ({ getTitle: () => title }), getResponse: () => value })),
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
