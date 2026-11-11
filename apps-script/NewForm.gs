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

var NEXT_STEP_CHOICES = {
  FINISH: 'Finish now (you can add more later with your personal link)',
  MORE: 'Add preferences and experience to get better matches',
  PAUSE: 'Pause or delete my alerts'
};

/**
 * Page 1 takes about a minute and can be submitted straight away. Preferences and experience
 * are optional pages, and pausing or deleting is a page of its own, reached from page 1.
 */
function createNewForm_() {
  var form = FormApp.create('Internship Alerts Sign-up');
  form.setDescription('Get alerts about new internships and early-career roles in India that match you. It takes about a minute. '
    + 'Sign in with your personal Gmail, as college inboxes can filter these emails.');
  // Google confirms the email from the sign-in, so students don't type it and can't sign up someone else.
  try {
    form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED);
  } catch (error) {
    form.setCollectEmail(true);
  }
  form.setAllowResponseEdits(true);
  form.setConfirmationMessage('You are signed up. Check your Gmail for a confirmation, and mark it "Not spam" if needed.');

  form.addTextItem().setTitle(FORM_TITLES.NAME).setRequired(true);
  form.addMultipleChoiceItem().setTitle(FORM_TITLES.DEGREE).setRequired(true)
    .setChoiceValues(["Bachelor's (BTech, BE, BSc, BCA and similar)", "Master's", 'PhD', 'Diploma', 'Other']);
  var thisYear = new Date().getFullYear();
  var years = [];
  for (var i = 0; i <= 6; i++) years.push(String(thisYear + i));
  form.addListItem().setTitle(FORM_TITLES.GRAD_YEAR).setRequired(true).setChoiceValues(years);
  form.addParagraphTextItem().setTitle(FORM_TITLES.SKILLS).setHelpText('For example: Python, SQL, React').setRequired(true);
  form.addMultipleChoiceItem().setTitle(FORM_TITLES.CHANNEL).setHelpText('Email if you skip this. For Telegram, we email you a link to connect.')
    .setChoiceValues(CHANNEL_CHOICES.map(function (pair) { return pair[0]; }));
  form.addCheckboxItem().setTitle(FORM_TITLES.CONSENT).setRequired(true).setChoiceValues([CONSENT_TEXT]);
  var nextStep = form.addMultipleChoiceItem().setTitle(FORM_TITLES.NEXT_STEP).setRequired(true);

  var preferencesPage = form.addPageBreakItem().setTitle('What you want (optional)').setHelpText('Leave any of these blank to get everything that matches you.');
  form.addCheckboxItem().setTitle(FORM_TITLES.ROLE_TYPES).setChoiceValues(CHOICES.ROLE_TYPES.map(function (pair) { return pair[0]; }));
  form.addCheckboxItem().setTitle(FORM_TITLES.LOCATIONS).setChoiceValues(CHOICES.LOCATIONS.map(function (pair) { return pair[0]; }));
  form.addCheckboxItem().setTitle(FORM_TITLES.AREAS).setChoiceValues(CHOICES.AREAS);
  form.addMultipleChoiceItem().setTitle(FORM_TITLES.FREQUENCY).setHelpText('Daily if you skip this. Priority roles are always sent straight away.')
    .setChoiceValues(CHOICES.FREQUENCY.map(function (pair) { return pair[0]; }));

  form.addPageBreakItem().setTitle('Your experience (optional)').setHelpText('This helps match you better.');
  form.addParagraphTextItem().setTitle(FORM_TITLES.EXPERIENCE_AND_PROJECTS).setHelpText('Internships, projects, competitions or anything you have built. Do not paste code or anything confidential.');
  form.addTextItem().setTitle(FORM_TITLES.GITHUB).setHelpText('For example: https://github.com/yourname');
  form.addTextItem().setTitle(FORM_TITLES.ALWAYS_COMPANIES).setHelpText('Separate with commas. You get every role you are eligible for at these companies.');
  form.addTextItem().setTitle(FORM_TITLES.NEVER_COMPANIES).setHelpText('Separate with commas. You never get roles from these companies.');

  // Finishing page 3 submits, so it never runs on into the pause page.
  var pausePage = form.addPageBreakItem().setTitle('Pause or delete').setGoToPage(FormApp.PageNavigationType.SUBMIT);
  form.addMultipleChoiceItem().setTitle(FORM_TITLES.STATUS).setRequired(true)
    .setChoiceValues([ALERT_STATUS.ACTIVE, ALERT_STATUS.PAUSED, ALERT_STATUS.DELETE]);

  nextStep.setChoices([
    nextStep.createChoice(NEXT_STEP_CHOICES.FINISH, FormApp.PageNavigationType.SUBMIT),
    nextStep.createChoice(NEXT_STEP_CHOICES.MORE, preferencesPage),
    nextStep.createChoice(NEXT_STEP_CHOICES.PAUSE, pausePage)
  ]);
  return form;
}

/**
 * Replaces the pre-launch form with the short version. The old one only holds test sign-ups,
 * which the launch reset deletes anyway, so it is moved to the trash.
 */
function replaceWithShortForm_() {
  if (isLaunched_()) throw new Error('The form is already live, so it is not replaced automatically.');
  var oldId = prop_('NEW_FORM_ID');
  setProp_('NEW_FORM_ID', createNewForm_().getId());
  if (oldId) {
    try {
      FormApp.openById(oldId).setAcceptingResponses(false);
      DriveApp.getFileById(oldId).setTrashed(true);
    } catch (error) {
      log_('WARN', 'form', 'Could not remove the previous form: ' + error.message);
    }
  }
  installTriggers_(prop_('FORM_ID'));
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

/**
 * Brings a sign-up form made by an earlier version up to date without recreating it, so
 * questions added by hand (such as the resume upload) are kept.
 */
function upgradeNewForm_() {
  if (!prop_('NEW_FORM_ID')) {
    setupNewForm();
    return;
  }
  var form = FormApp.openById(prop_('NEW_FORM_ID'));
  var find = function (title) { return form.getItems().filter(function (item) { return item.getTitle() === title; })[0]; };

  var verified = false;
  try {
    form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED);
    verified = true;
  } catch (error) {
    log_('WARN', 'form', 'Could not turn on verified email collection: ' + error.message);
  }
  // The email comes from the Google sign-in, so the typed question goes, but only once that works.
  var typedEmail = find(FORM_TITLES.EMAIL);
  if (typedEmail && verified) form.deleteItem(typedEmail);

  if (!find(FORM_TITLES.CHANNEL)) {
    form.addMultipleChoiceItem().setTitle(FORM_TITLES.CHANNEL)
      .setHelpText('For Telegram, we email you a link to connect. Until you connect, alerts come by email.')
      .setChoiceValues(CHANNEL_CHOICES.map(function (pair) { return pair[0]; }));
    var frequency = find(FORM_TITLES.FREQUENCY);
    if (frequency) form.moveItem(form.getItems().length - 1, frequency.getIndex() + 1);
  }

  // The separate resume form from an earlier version is closed and removed.
  var resumeFormId = prop_('RESUME_FORM_ID');
  if (resumeFormId) {
    try {
      FormApp.openById(resumeFormId).setAcceptingResponses(false);
      DriveApp.getFileById(resumeFormId).setTrashed(true);
    } catch (error) {
      log_('WARN', 'form', 'Could not remove the old resume form: ' + error.message);
    }
    setProp_('RESUME_FORM_ID', '');
  }
  installTriggers_(prop_('FORM_ID'));
}

