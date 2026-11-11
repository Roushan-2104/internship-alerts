// Telegram alerts. Students connect by opening a link with a secret code from their email.
// The script polls Telegram on each run, so no public web address is needed.

var TELEGRAM_API = 'https://api.telegram.org/bot';
var TELEGRAM_MAX_CHARS = 3900;

function telegramToken_() {
  return prop_('TELEGRAM_BOT_TOKEN');
}

function telegramReady_() {
  return Boolean(telegramToken_() && CONFIG.TELEGRAM_BOT_USERNAME);
}

function telegramLink_(student) {
  if (!telegramReady_() || !student.telegramCode) return '';
  return 'https://t.me/' + CONFIG.TELEGRAM_BOT_USERNAME + '?start=' + student.telegramCode;
}

function wantsTelegram_(student) {
  return student.channel === 'telegram' || student.channel === 'both';
}

/** Email is used unless the student chose Telegram only and has connected it. */
function needsEmail_(student) {
  if (student.channel === 'telegram' && student.telegramChatId && telegramReady_()) return false;
  return true;
}

function callTelegram_(method, payload) {
  var response = UrlFetchApp.fetch(TELEGRAM_API + telegramToken_() + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify(payload)
  });
  var body = {};
  try {
    body = JSON.parse(response.getContentText());
  } catch (error) {
    body = {};
  }
  // The token is part of the URL, so errors are reported by code only, never with the URL.
  return { code: response.getResponseCode(), body: body };
}

/** Plain text only, so nothing in a job title can be read as formatting or a command. */
function sendTelegram_(chatId, text) {
  var chunks = [];
  var rest = String(text);
  while (rest.length > TELEGRAM_MAX_CHARS) {
    var cut = rest.lastIndexOf('\n', TELEGRAM_MAX_CHARS);
    if (cut < 1000) cut = TELEGRAM_MAX_CHARS;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  chunks.push(rest);
  for (var i = 0; i < chunks.length; i++) {
    var result = callTelegram_('sendMessage', { chat_id: chatId, text: chunks[i], disable_web_page_preview: true });
    if (result.code === 403) return 'blocked';
    if (result.code !== 200) throw new Error('Telegram returned HTTP ' + result.code);
  }
  return 'sent';
}

/**
 * Reads new messages sent to the bot. "/start CODE" connects a student, "/stop" disconnects.
 * Anything else gets a short help reply.
 */
function pollTelegram_() {
  if (!telegramReady_()) return;
  var offset = Number(prop_('TELEGRAM_OFFSET') || 0);
  var result = callTelegram_('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message'] });
  if (result.code === 401) throw new Error('Telegram rejected the bot token. Create a new one with BotFather and update TELEGRAM_BOT_TOKEN.');
  if (result.code !== 200 || !result.body.ok) throw new Error('Telegram returned HTTP ' + result.code);
  var updates = result.body.result || [];
  if (!updates.length) return;
  var students = readTable_('Students');
  updates.forEach(function (update) {
    // Saved before handling, so a failure can't make the same message repeat on every run.
    offset = Math.max(offset, update.update_id + 1);
    setProp_('TELEGRAM_OFFSET', String(offset));
    try {
      handleTelegramUpdate_(update, students);
    } catch (error) {
      log_('WARN', 'telegram', 'A Telegram message could not be handled: ' + error.message);
    }
  });
}

function handleTelegramUpdate_(update, students) {
  {
    var message = update.message;
    if (!message || !message.chat || message.chat.type !== 'private' || typeof message.text !== 'string') return;
    var chatId = String(message.chat.id);
    var start = message.text.match(/^\/start\s+([A-Za-z0-9]{8,40})\s*$/);
    if (start) {
      var student = students.filter(function (row) { return row.telegramCode && String(row.telegramCode) === start[1]; })[0];
      if (!student) {
        sendTelegram_(chatId, 'This link is not valid. Use the Telegram link from your sign-up email.');
        return;
      }
      students.forEach(function (row) {
        if (String(row.telegramChatId) === chatId && row.responseId !== student.responseId) {
          row.telegramChatId = '';
          updateRow_('Students', row);
        }
      });
      student.telegramChatId = chatId;
      updateRow_('Students', student);
      sendTelegram_(chatId, 'Connected. You will get internship alerts here. Send /stop to disconnect.');
    } else if (/^\/stop\b/.test(message.text)) {
      students.filter(function (row) { return String(row.telegramChatId) === chatId; }).forEach(function (row) {
        row.telegramChatId = '';
        updateRow_('Students', row);
      });
      sendTelegram_(chatId, 'Disconnected. Alerts will come by email instead.');
    } else {
      sendTelegram_(chatId, 'This bot sends internship alerts. To connect, open the Telegram link from your sign-up email.');
    }
  }
}

/**
 * Sends one message the way the student chose. Returns true when it reached them by at least
 * one route. A student who blocked the bot is disconnected and falls back to email.
 */
function deliver_(student, message) {
  var reached = false;
  if (wantsTelegram_(student) && student.telegramChatId && telegramReady_()) {
    var outcome = sendTelegram_(student.telegramChatId, message.subject + '\n\n' + message.body);
    if (outcome === 'sent') {
      reached = true;
    } else {
      student.telegramChatId = '';
      updateRow_('Students', student);
      log_('WARN', 'telegram', 'A student blocked the bot, so they were switched back to email.');
    }
  }
  if (needsEmail_(student) || !reached) {
    try {
      sendMail_(student.email, message);
      reached = true;
    } catch (error) {
      // Already delivered on Telegram, so the row isn't retried (which would repeat that message).
      if (!reached) throw error;
      log_('WARN', 'email', 'Email failed after Telegram delivered: ' + error.message);
    }
  }
  return reached;
}
