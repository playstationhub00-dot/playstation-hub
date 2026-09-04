// Telegram adapter for owner alerts. Its whole job is to build the request and
// the message text; the fetch itself lives in server.js beside the other
// outbound calls, matching how lib/paymongo.js is split.
//
// Telegram rather than Messenger for one reason: Messenger only permits a
// message to someone who messaged the Page in the last 24 hours (see the
// /admin/blast error text), so an owner alert on that channel goes silent after
// a quiet day — exactly when the owner is away and needs it. Telegram has no
// such window.
//
// Pure functions only: no network, no key material, no environment reads. The
// caller passes the token in, so it never sits in module state.

const API_BASE = 'https://api.telegram.org/bot';

function apiUrl(token) {
  return API_BASE + String(token || '') + '/sendMessage';
}

function messagePayload(chatId, text) {
  return {
    chat_id: String(chatId || ''),
    text: String(text == null ? '' : text),
    // Without this the admin URL expands into a preview card on every alert,
    // burying the code the owner actually needs to read.
    disable_web_page_preview: true
  };
}

// Both halves or nothing. A half-configured bot should leave the feature simply
// absent rather than logging a failure on every single submission.
function isConfigured(env) {
  const e = env || {};
  return String(e.TELEGRAM_BOT_TOKEN || '').trim() !== ''
      && String(e.TELEGRAM_CHAT_ID || '').trim() !== '';
}

function firstName(full) {
  const s = String(full == null ? '' : full).trim();
  if (!s) return '';
  return s.split(/\s+/)[0];
}

// The message the owner reads on their phone. It carries the code itself rather
// than a nudge to go and look, because the point is to type it straight into the
// PlayStation App without opening the admin panel at all.
//
// Only the customer's first name is included — a push notification lands on a
// lock screen, and there is no reason for a surname to be there.
function formatQrAlert(order, opts) {
  const o = order || {};
  const p = opts || {};
  const lines = ['Sign-in waiting — ' + (o.ref || 'order')];

  if (p.code) lines.push('Code: ' + p.code);
  else lines.push('Photo uploaded — open admin to scan it');

  const who = firstName(o.fb_name);
  const what = String(o.game_title || '').trim();
  const detail = [who, what].filter(Boolean).join(' · ');
  if (detail) lines.push(detail);

  if (p.expiresAt) lines.push('Expires ' + p.expiresAt);
  if (p.adminUrl) lines.push(p.adminUrl);

  return lines.join('\n');
}

module.exports = { API_BASE, apiUrl, messagePayload, isConfigured, formatQrAlert };
