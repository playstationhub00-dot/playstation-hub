// Messenger Platform pieces that have to be right before any reply is sent:
// the verify handshake, the signature over the raw body, and which events
// are actually a customer talking.
//
// Env names follow what Meta's dashboard asks Michael to copy (FB_*), and
// fall back to the names this app already used (MESSENGER_*) so a deploy
// does not go silent before those are renamed.

const crypto = require('crypto');

function config(env) {
  const e = env || {};
  return {
    verifyToken: e.FB_VERIFY_TOKEN || e.MESSENGER_VERIFY_TOKEN || 'playstation_hub_verify',
    pageToken: e.FB_PAGE_ACCESS_TOKEN || e.MESSENGER_PAGE_TOKEN || '',
    appSecret: e.FB_APP_SECRET || e.MESSENGER_APP_SECRET || '',
    // Page Inbox, the app id Meta documents for handing a thread to a human
    // in Business Suite. Override if Meta issues a different one.
    inboxAppId: e.FB_PAGE_INBOX_APP_ID || '263902037430900'
  };
}

function verifyChallenge({ mode, token, challenge, expected }) {
  if (mode === 'subscribe' && token && expected && token === expected && challenge) {
    return { ok: true, challenge: String(challenge) };
  }
  return { ok: false };
}

function verifySignature(appSecret, rawBody, header) {
  if (!appSecret) return { ok: false, reason: 'no_secret' };
  const h = String(header || '');
  const m = /^sha256=([a-f0-9]+)$/i.exec(h);
  if (!m || rawBody == null) return { ok: false, reason: 'missing' };
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(m[1].toLowerCase(), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true };
}

// Echoes are the Page's own replies coming back. A customer message is in
// entry.messaging only while this app owns the thread. After pass_thread_control
// the Page Inbox owns it, and the same message arrives in entry.standby —
// dropping those is how a resumed chat stays silent. pass_thread_control,
// take_thread_control, and request_thread_control have no message body.
// Referral-only events are returned so the order-link pairing still runs.
function controlOf(event) {
  if (event.pass_thread_control) return 'pass_thread_control';
  if (event.take_thread_control) return 'take_thread_control';
  if (event.request_thread_control) return 'request_thread_control';
  return null;
}

function readEvent(event, standby) {
  if (!event || !event.sender || !event.sender.id) return null;
  if (event.message && event.message.is_echo) return null;
  const referral = (event.referral && event.referral.ref)
    || (event.postback && event.postback.referral && event.postback.referral.ref)
    || null;
  const control = controlOf(event);
  const body = control ? event[control] || {} : null;
  const base = {
    psid: String(event.sender.id),
    referral: referral ? String(referral) : null,
    standby: !!standby,
    control,
    metadata: body && body.metadata ? String(body.metadata) : null,
    newOwnerAppId: body && (body.new_owner_app_id || body.requested_owner_app_id)
      ? String(body.new_owner_app_id || body.requested_owner_app_id)
      : null,
    previousOwnerAppId: body && body.previous_owner_app_id ? String(body.previous_owner_app_id) : null
  };
  if (event.message) {
    const attachments = Array.isArray(event.message.attachments) && event.message.attachments.length > 0;
    return Object.assign(base, {
      text: String(event.message.text || ''),
      attachments,
      reply: true,
      control: null
    });
  }
  if (control || referral) {
    return Object.assign(base, { text: '', attachments: false, reply: false });
  }
  return null;
}

function inboundEvents(body) {
  if (!body || body.object !== 'page') return [];
  const out = [];
  (body.entry || []).forEach(entry => {
    (entry.messaging || []).forEach(event => {
      const row = readEvent(event, false);
      if (row) out.push(row);
    });
    (entry.standby || []).forEach(event => {
      const row = readEvent(event, true);
      if (row) out.push(row);
    });
  });
  return out;
}

// answer: this app owns the thread, run the bot (a paused thread stays quiet).
// take_then_answer: Page Inbox still owns it, but the pause flag is clear, so
// take control and then answer. record_only: Inbox owns a paused chat — keep
// the line on the admin card and do not talk over the person. note_control:
// handover webhook, log it, no customer text to answer.
function decideInbound(event, paused) {
  if (!event) return 'ignore';
  if (event.reply && event.standby) return paused ? 'record_only' : 'take_then_answer';
  if (event.reply) return 'answer';
  if (event.control) return 'note_control';
  return 'ignore';
}

function graphError(body) {
  let parsed = body;
  if (typeof body === 'string') {
    if (!body.trim()) return null;
    try { parsed = JSON.parse(body); } catch (e) { return null; }
  }
  if (!parsed || !parsed.error) return null;
  const err = parsed.error;
  const code = Number(err.code);
  const subcode = Number(err.error_subcode);
  const message = String(err.message || '')
    .replace(/access_token=[^&\s]+/gi, 'access_token=redacted')
    .slice(0, 300);
  return {
    code: Number.isFinite(code) ? code : null,
    subcode: Number.isFinite(subcode) ? subcode : null,
    message
  };
}

function graphErrorSummary(result) {
  const r = result || {};
  if (r.reason === 'no_token') return 'Page token is missing.';
  if (r.reason === 'network') return 'Could not reach Messenger.';
  const err = r.error || graphError(r.body);
  if (err && err.message) {
    const bits = [];
    if (err.code != null) bits.push(String(err.code));
    if (err.subcode != null) bits.push(String(err.subcode));
    const code = bits.length ? ' (' + bits.join('/') + ')' : '';
    return (err.message + code).slice(0, 180);
  }
  if (r.status && Number(r.status) !== 200) return 'Messenger returned HTTP ' + r.status + '.';
  return 'Messenger did not return this chat.';
}

// Website resumes skip Graph. Messenger must hear success from
// take_thread_control before the pause flag is cleared.
async function resumeMessenger({ channel, externalId, take }) {
  if (channel !== 'messenger') return { ok: true };
  const taken = await take(externalId);
  if (!taken || taken.ok !== true) return { ok: false, error: graphErrorSummary(taken) };
  return { ok: true };
}

function sendText(psid, text) {
  return {
    recipient: { id: String(psid) },
    message: { text: String(text || '').slice(0, 2000) }
  };
}

function passThreadControl(psid, targetAppId) {
  return {
    recipient: { id: String(psid) },
    target_app_id: String(targetAppId),
    metadata: 'playstation-hub support handoff'
  };
}

function takeThreadControl(psid) {
  return {
    recipient: { id: String(psid) },
    metadata: 'playstation-hub support resumed'
  };
}

module.exports = {
  config, verifyChallenge, verifySignature, inboundEvents, decideInbound,
  graphError, graphErrorSummary, resumeMessenger,
  sendText, passThreadControl, takeThreadControl
};
