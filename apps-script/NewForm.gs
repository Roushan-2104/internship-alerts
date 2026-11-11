// The one sign-up form. Students sign in with Google, which confirms their email, and can
// upload a resume on the same form.

var CONSENT_TEXT = 'I agree to my answers, public GitHub profile and any resume being stored privately and used to match me with jobs. '
  + 'They are also sent to Google\'s Gemini AI to read my skills. On Gemini\'s free tier, Google may use this data to improve its products. '
  + 'I can delete my data at any time.';

var CHANNEL_CHOICES = [['Email', 'email'], ['Telegram', 'telegram'], ['Email and Telegram', 'both']];

/** Creates the new sign-up form once. Run by an admin action, or by hand from the editor. */
function setupNewForm() {
  var formId = prop_('NEW_FORM_ID');
  if (!formId) {
    formId = createNewForm_().getId();
    setProp_('NEW_FORM_ID', formId);
  }
  installTriggers_(prop_('FORM_ID'));
  var form = FormApp.openById(formId);
  Logger.log('New sign-up form (share at launch): ' + form.getPublishedUrl());
  Logger.log('Edit new form: ' + form.getEditUrl());
  Logger.log('Next: add a File upload question titled exactly "' + FORM_TITLES.RESUME + '", not required.');
  return form;
}

function createNewForm_() {
  var form = FormApp.create('Internship Alerts Sign-up');
  form.setDescription('Get alerts about new internships and early-career roles in India that match you. Only the first page is required. '
    + 'Sign in with your personal Gmail, as college inboxes can filter these emails. You can change your answers any time with the link we email you.');
  // Google confirms the email from the sign-in, so students don't type it and can't sign up someone else.
  try {
    form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED);
  } catch (error) {
    form.setCollectEmail(true);
  }
  form.setAllowResponseEdits(true);
  form.setConfirmationMessage('You are signed up. Check your Gmail for a confirmation, and mark it "Not spam" if needed.');

  form.addSectionHeaderItem().setTitle('About you (required)');
  form.addTextItem().setTitle(FORM_TITLES.NAME).setRequired(true);
  form.addMultipleChoiceItem().setTitle(FORM_TITLES.DEGREE).setRequired(true)
    .setChoiceValues(["Bachelor's (BTech, BE, BSc, BCA and similar)", "Master's", 'PhD', 'Diploma', 'Other']);
  var thisYear = new Date().getFullYear();
  var years = [];
  for (var i = 0; i <= 6; i++) years.push(String(thisYear + i));
  form.addListItem().setTitle(FORM_TITLES.GRAD_YEAR).setRequired(true).setChoiceValues(years);
  form.addParagraphTextItem().setTitle(FORM_TITLES.SKILLS).setHelpText('For example: Python, SQL, React').setRequired(true);
  form.addCheckboxItem().setTitle(FORM_TITLES.CONSENT).setRequired(true).setChoiceValues([CONSENT_TEXT]);

  form.addPageBreakItem().setTitle('What you want (optional)').setHelpText('Leave any of these blank to get everything that matches you.');
  form.addCheckboxItem().setTitle(FORM_TITLES.ROLE_TYPES).setChoiceValues(CHOICES.ROLE_TYPES.map(function (pair) { return pair[0]; }));
  form.addCheckboxItem().setTitle(FORM_TITLES.LOCATIONS).setChoiceValues(CHOICES.LOCATIONS.map(function (pair) { return pair[0]; }));
  form.addCheckboxItem().setTitle(FORM_TITLES.AREAS).setChoiceValues(CHOICES.AREAS);
  form.addTextItem().setTitle(FORM_TITLES.ALWAYS_COMPANIES).setHelpText('Separate with commas. You get every role you are eligible for at these companies, even outside your other choices.');
  form.addTextItem().setTitle(FORM_TITLES.NEVER_COMPANIES).setHelpText('Separate with commas. You never get roles from these companies.');
  form.addMultipleChoiceItem().setTitle(FORM_TITLES.FREQUENCY).setHelpText('Priority roles are always sent straight away.')
    .setChoiceValues(CHOICES.FREQUENCY.map(function (pair) { return pair[0]; }));
  form.addMultipleChoiceItem().setTitle(FORM_TITLES.CHANNEL).setHelpText('For Telegram, we email you a link to connect. Until you connect, alerts come by email.')
    .setChoiceValues(CHANNEL_CHOICES.map(function (pair) { return pair[0]; }));

  form.addPageBreakItem().setTitle('Your experience (optional)').setHelpText('This helps match you better.');
  form.addParagraphTextItem().setTitle(FORM_TITLES.EXPERIENCE);
  form.addParagraphTextItem().setTitle(FORM_TITLES.PROJECTS);
  form.addParagraphTextItem().setTitle(FORM_TITLES.PRIVATE_PROJECTS).setHelpText('Describe work that is not public. Do not paste code or anything confidential.');
  form.addTextItem().setTitle(FORM_TITLES.GITHUB).setHelpText('For example: https://github.com/yourname');
  form.addParagraphTextItem().setTitle(FORM_TITLES.INTERESTS);
  form.addMultipleChoiceItem().setTitle(FORM_TITLES.STATUS).setHelpText('Use this later to pause alerts or delete your data.')
    .setChoiceValues([ALERT_STATUS.ACTIVE, ALERT_STATUS.PAUSED, ALERT_STATUS.DELETE]);
  return form;
}

/** Company names from the Companies sheet, plus Google, for checking what students typed. */
function knownCompanies_() {
  var sheetId = prop_('COMPANIES_SHEET_ID');
  if (!sheetId) return null;
  var names = ['Google'];
  var rows = SpreadsheetApp.openById(sheetId).getSheets()[0].getDataRange().getValues().slice(1);
  rows.forEach(function (row) { if (row[0]) names.push(String(row[0])); });
  return names;
}

function unknownCompanies_(typed) {
  var known = knownCompanies_();
  if (!known) return [];
  return splitList_(typed).filter(function (name) { return !companyListed_(name, known) && !known.some(function (k) { return companyListed_(k, [name]); }); });
}
