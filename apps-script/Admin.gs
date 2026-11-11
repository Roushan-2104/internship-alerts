// One-time admin actions, run automatically by the next tick after a code push, so setup
// doesn't depend on someone clicking Run. Each runs once; its result is logged.

var ADMIN_ACTIONS = [
  { id: 'create-new-form-v1', run: function () { setupNewForm(); } },
  // Adds new column headers and makes every column plain text, so Sheets can't change values.
  { id: 'refresh-tables-v2', run: function () { createTables_(prop_('SPREADSHEET_ID')); } },
  // Adds the 5-minute quickTick trigger alongside the existing ones.
  { id: 'install-quick-tick-v1', run: function () { installTriggers_(prop_('FORM_ID')); } },
  // A form made by the earlier two-form version lacked the Telegram question and verified email.
  { id: 'upgrade-new-form-v2', run: function () { upgradeNewForm_(); } },
  // Students who chose Telegram before the link was being sent reliably get it now.
  { id: 'send-missing-telegram-links-v1', run: function () { sendMissingTelegramLinks_(); } }
];

/** The reset deletes every student's data. It only runs when this exact phrase is in CONFIG. */
var RESET_PHRASE = 'DELETE ALL STUDENT DATA';

function runAdminActions_() {
  ADMIN_ACTIONS.concat(CONFIG.RESET_AND_LAUNCH === RESET_PHRASE ? [{ id: 'reset-and-launch-v1', run: resetAndLaunch_ }] : [])
    .forEach(function (action) {
      var key = 'ADMIN_DONE_' + action.id;
      if (prop_(key)) return;
      action.run();
      setProp_(key, new Date().toISOString());
      log_('INFO', 'admin', 'Ran admin action ' + action.id);
    });
}

function isLaunched_() {
  return prop_('LAUNCHED') === 'yes';
}

/**
 * Deletes all student data, closes the old form, and switches to the new form with every
 * role type. Open jobs are matched again as new, so new sign-ups get them once.
 */
function resetAndLaunch_() {
  var newFormId = prop_('NEW_FORM_ID');
  if (!newFormId) throw new Error('The new form does not exist yet.');

  readTable_('Students').forEach(function (student) { removeFile_(student.resumeFileId); });
  [prop_('FORM_ID'), newFormId].forEach(function (formId) {
    if (formId) FormApp.openById(formId).deleteAllResponses();
  });
  // Uploaded resumes live in Drive folders the forms create, separate from the responses.
  var folders = DriveApp.searchFolders('title contains "(File responses)" and trashed = false');
  while (folders.hasNext()) {
    var folder = folders.next();
    var files = folder.getFiles();
    while (files.hasNext()) removeFile_(files.next().getId());
  }
  // Clearing (not deleting) rows works however large a tab has grown, and is safe to repeat.
  ['Students', 'Matches', 'Queue', 'Jobs', 'Skills'].forEach(function (name) {
    var sheet = sheet_(name);
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, TABLES[name].length).clearContent();
  });

  var oldFormId = prop_('FORM_ID');
  if (oldFormId && oldFormId !== newFormId) {
    var oldForm = FormApp.openById(oldFormId);
    oldForm.setAcceptingResponses(false);
    oldForm.setCustomClosedFormMessage('This form has moved. Please sign up again here: ' + FormApp.openById(newFormId).getPublishedUrl());
    setProp_('OLD_FORM_ID', oldFormId);
  }
  setProp_('FORM_ID', newFormId);
  setProp_('LAUNCHED', 'yes');
  installTriggers_(newFormId);
  log_('INFO', 'admin', 'All student data was deleted and the new form is live.');
}
