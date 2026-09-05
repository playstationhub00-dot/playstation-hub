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

const TYPE_LABELS = { tr: 'Trophy', ps4: 'PS4 Primary', nt: 'Non-Trophy' };

// The three moments an order is worth a buzz, worded so they are distinguishable
// on a lock screen. Only 'review' actually blocks — the other two are for
// information, and reading identically would make the blocking one invisible.
const ORDER_HEADINGS = {
  created: 'New order',
  review: 'Payment to approve',
  paid: 'Paid online'
};

function orderShape(order) {
  const o = order || {};
  const type = TYPE_LABELS[o.account_type] || (o.account_type ? '' : 'Non-Trophy');
  // A purchase has no rental duration, so it says what it is instead.
  const term = o.is_buy ? 'One-time purchase' : (o.days === 7 ? 'Weekly' : 'Monthly');
  return [type, term].filter(Boolean).join(' · ');
}

// A Fall in Line entry carries an amount_due it does not owe yet, so quoting it
// would report money that was never asked for.
function orderMoney(order) {
  const o = order || {};
  if (o.is_waitlist) return 'Free entry';
  const total = (Number(o.amount_due) || 0) + (Number(o.deposit_due) || 0);
  return total > 0 ? '₱' + total : '';
}

function formatOrderAlert(order, opts) {
  const o = order || {};
  const p = opts || {};
  const lines = [(ORDER_HEADINGS[p.kind] || ORDER_HEADINGS.created) + ' — ' + (o.ref || 'order')];

  const who = firstName(o.fb_name);
  const what = String(o.game_title || '').trim();
  const detail = [who, what].filter(Boolean).join(' · ');
  if (detail) lines.push(detail);

  const spec = [orderShape(o), orderMoney(o)].filter(Boolean).join(' · ');
  if (spec) lines.push(spec);

  // Only the paid path can say this: the webhook has already advanced it, so
  // there is nothing for the owner to do beyond knowing the money arrived.
  if (p.kind === 'paid') lines.push('Advanced to sign-in automatically');
  if (p.adminUrl) lines.push(p.adminUrl);

  return lines.join('\n');
}

function formatRequestAlert(request, opts) {
  const r = request || {};
  const p = opts || {};
  const lines = ['Game request — ' + (String(r.title || '').trim() || 'untitled')];
  const who = firstName(r.fb_name);
  if (who) lines.push('Asked by ' + who);
  if (p.adminUrl) lines.push(p.adminUrl);
  return lines.join('\n');
}

// Every alert the owner can switch off, in the order the admin panel lists
// them. The gates, the settings form and its save route all read this, so a
// kind that exists in code but not here would be unswitchable.
const ALERT_KINDS = Object.freeze(['signin', 'order_created', 'order_review', 'order_paid', 'request']);

// Unset means ON, deliberately, in both directions: an owner who never opens
// the panel keeps the behaviour they already had, and a kind added in a later
// release starts working rather than staying silently muted by an old settings
// blob. Only a literal false switches something off, so a mangled write cannot
// mute an alert by accident.
function isAlertEnabled(settings, kind) {
  const alerts = (settings && settings.alerts) || {};
  return alerts[kind] !== false;
}

module.exports = {
  API_BASE, TYPE_LABELS, ORDER_HEADINGS, ALERT_KINDS,
  apiUrl, messagePayload, isConfigured, isAlertEnabled,
  formatQrAlert, formatOrderAlert, formatRequestAlert
};
