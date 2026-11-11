function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function sheet_(name) {
  return SpreadsheetApp.openById(prop_('SPREADSHEET_ID')).getSheetByName(name);
}

/** The text a value is stored as. Booleans become TRUE/FALSE, so comparisons are stable. */
function cellString_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

// Stops student-entered text from being treated as a spreadsheet formula.
function safeCell_(value) {
  var text = cellString_(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function readTable_(name) {
  var values = sheet_(name).getDataRange().getValues();
  var headers = TABLES[name];
  return values.slice(1).map(function (cells, index) {
    var row = { _row: index + 2 };
    headers.forEach(function (header, column) { row[header] = cells[column] === undefined ? '' : cells[column]; });
    return row;
  });
}

function appendRow_(name, record) {
  sheet_(name).appendRow(TABLES[name].map(function (header) { return safeCell_(record[header]); }));
}

function updateRow_(name, record) {
  var headers = TABLES[name];
  var cells = headers.map(function (header) { return safeCell_(record[header]); });
  sheet_(name).getRange(record._row, 1, 1, headers.length).setValues([cells]);
}

// Deletes from the bottom up so earlier row numbers stay valid.
function deleteRows_(name, records) {
  var sheet = sheet_(name);
  records.map(function (record) { return record._row; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (row) { sheet.deleteRow(row); });
}

function log_(level, area, message) {
  try {
    var sheet = sheet_('Logs');
    sheet.appendRow([new Date().toISOString(), level, area, safeCell_(String(message).slice(0, 1000))]);
    var extra = sheet.getLastRow() - 1 - CONFIG.LOG_ROWS_KEPT;
    if (extra > 0) sheet.deleteRows(2, extra);
  } catch (error) {
    Logger.log(level + ' ' + area + ' ' + message + ' (log write failed: ' + error + ')');
  }
}

function isTrue_(value) {
  return value === true || String(value).toUpperCase() === 'TRUE';
}

function daysSince_(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}
