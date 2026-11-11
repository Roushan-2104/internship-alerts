/** Run once from the Apps Script editor. Safe to run again: it reuses what already exists. */
function setup() {
  checkConfig_();
  var spreadsheetId = prop_('SPREADSHEET_ID');
  if (!spreadsheetId) {
    spreadsheetId = SpreadsheetApp.create('Internship Alerts Data').getId();
    setProp_('SPREADSHEET_ID', spreadsheetId);
  }
  createTables_(spreadsheetId);

  var formId = prop_('FORM_ID');
  if (!formId) {
    formId = createForm_().getId();
    setProp_('FORM_ID', formId);
  }
  installTriggers_(formId);

  var form = FormApp.openById(formId);
  Logger.log('Data sheet: ' + SpreadsheetApp.openById(spreadsheetId).getUrl());
  Logger.log('Edit form: ' + form.getEditUrl());
  Logger.log('Share form: ' + form.getPublishedUrl());
  Logger.log('Next: add the resume upload question by hand (see README), then deploy the status page.');
}

function checkConfig_() {
  ['JOBS_URL', 'SENDER_NAME', 'ALERT_EMAIL'].forEach(function (key) {
    if (/^REPLACE_/.test(CONFIG[key])) throw new Error('Set CONFIG.' + key + ' in Config.gs before running setup.');
  });
  var account = Session.getEffectiveUser().getEmail();
  if (account !== CONFIG.EXPECTED_ACCOUNT) {
    throw new Error('Running as ' + account + ' but this must run from ' + CONFIG.EXPECTED_ACCOUNT + '.');
  }
}

function createTables_(spreadsheetId) {
  var book = SpreadsheetApp.openById(spreadsheetId);
  Object.keys(TABLES).forEach(function (name) {
    var sheet = book.getSheetByName(name) || book.insertSheet(name);
    // Rewriting the header row adds any new columns when setup runs again after an update.
    if (sheet.getLastRow() === 0) sheet.appendRow(TABLES[name]);
    else sheet.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]);
    // Plain text keeps ids, years and timestamps exactly as written.
    sheet.getRange('A:AZ').setNumberFormat('@');
    sheet.setFrozenRows(1);
  });
  var blank = book.getSheetByName('Sheet1');
  if (blank) book.deleteSheet(blank);
}

function createForm_() {
  var form = FormApp.create('Internship Alerts Sign-up');
  form.setDescription('Get emails about new internships that match your profile. Use a personal Gmail address, as college inboxes can filter these alerts. You can update your answers at any time with the link we email you.');
  form.setAllowResponseEdits(true);
  form.setConfirmationMessage('You are signed up. Check your Gmail for a confirmation with your personal update link, and mark it "Not spam" if needed.');

  form.addTextItem().setTitle(FORM_TITLES.NAME).setRequired(true);
  form.addTextItem().setTitle(FORM_TITLES.EMAIL).setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().setHelpText('Enter a valid email address.').build());
  form.addMultipleChoiceItem().setTitle(FORM_TITLES.DEGREE).setRequired(true)
    .setChoiceValues(["Bachelor's (BTech, BE, BSc, BCA and similar)", "Master's", 'PhD', 'Diploma', 'Other']);
  var thisYear = new Date().getFullYear();
  var years = [];
  for (var i = 0; i <= 6; i++) years.push(String(thisYear + i));
  form.addListItem().setTitle(FORM_TITLES.GRAD_YEAR).setRequired(true).setChoiceValues(years);
  form.addParagraphTextItem().setTitle(FORM_TITLES.SKILLS).setHelpText('For example: Python, SQL, React').setRequired(true);
  form.addParagraphTextItem().setTitle(FORM_TITLES.EXPERIENCE);
  form.addParagraphTextItem().setTitle(FORM_TITLES.PROJECTS);
  form.addParagraphTextItem().setTitle(FORM_TITLES.PRIVATE_PROJECTS).setHelpText('Describe work that is not public on GitHub. Do not paste code or anything confidential.');
  form.addTextItem().setTitle(FORM_TITLES.GITHUB).setHelpText('For example: https://github.com/yourname');
  form.addParagraphTextItem().setTitle(FORM_TITLES.INTERESTS);
  form.addMultipleChoiceItem().setTitle(FORM_TITLES.STATUS).setRequired(true)
    .setChoiceValues([ALERT_STATUS.ACTIVE, ALERT_STATUS.PAUSED, ALERT_STATUS.DELETE]);
  form.addCheckboxItem().setTitle(FORM_TITLES.CONSENT).setRequired(true)
    .setChoiceValues(['I agree to my answers, public GitHub profile and any resume being stored privately and used to match me to internships. I can delete my data at any time.']);
  return form;
}

function installTriggers_(formId) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('sendHeartbeat').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  ScriptApp.newTrigger('onFormSubmit').forForm(formId).onFormSubmit().create();
  var newFormId = prop_('NEW_FORM_ID');
  if (newFormId && newFormId !== formId) ScriptApp.newTrigger('onFormSubmit').forForm(newFormId).onFormSubmit().create();
}

var COMPANY_HEADERS = ['Company', 'Type', 'Board', 'Enabled', 'Group', 'Notes'];

/**
 * Run once from the editor. Creates a separate Companies spreadsheet, so publishing it can
 * never expose student data, and fills it with the current company list from GitHub.
 * Running it again leaves an existing sheet untouched, so your edits are safe.
 */
function setupCompanies() {
  var existingId = prop_('COMPANIES_SHEET_ID');
  if (existingId) {
    Logger.log('Companies sheet already exists: ' + SpreadsheetApp.openById(existingId).getUrl());
    return;
  }
  var response = UrlFetchApp.fetch(CONFIG.COMPANIES_SOURCE_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Could not read the company list from GitHub (HTTP ' + response.getResponseCode() + ').');
  var companies = JSON.parse(response.getContentText()).companies || [];
  if (!companies.length) throw new Error('The company list on GitHub is empty.');

  var book = SpreadsheetApp.create('Internship Alerts Companies');
  var sheet = book.getSheets()[0].setName('Companies');
  var rows = companies.map(function (c) { return [c.company, c.type, c.board, 'yes', c.group || '', '']; });
  sheet.getRange(1, 1, 1, COMPANY_HEADERS.length).setValues([COMPANY_HEADERS]).setFontWeight('bold');
  sheet.getRange(2, 1, rows.length, COMPANY_HEADERS.length).setValues(rows);
  sheet.setFrozenRows(1);
  var typeRule = SpreadsheetApp.newDataValidation().requireValueInList(['greenhouse', 'lever', 'ashby', 'smartrecruiters'], true).setAllowInvalid(false).build();
  var enabledRule = SpreadsheetApp.newDataValidation().requireValueInList(['yes', 'no'], true).setAllowInvalid(false).build();
  sheet.getRange(2, 2, sheet.getMaxRows() - 1, 1).setDataValidation(typeRule);
  sheet.getRange(2, 4, sheet.getMaxRows() - 1, 1).setDataValidation(enabledRule);
  sheet.autoResizeColumns(1, COMPANY_HEADERS.length);

  setProp_('COMPANIES_SHEET_ID', book.getId());
  Logger.log('Created ' + rows.length + ' companies: ' + book.getUrl());
  Logger.log('Next: File > Share > Publish to web > Companies > Comma-separated values (.csv) > Publish, then send the link.');
}

