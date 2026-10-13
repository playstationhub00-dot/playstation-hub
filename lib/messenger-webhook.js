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

// Echoes are the Page's own replies coming back. Standby events mean the
// Page Inbox currently owns the thread — answering those would talk over
// Michael. Referral-only events are returned so the order-link pairing
// still runs, with no text to reply to.
function inboundEvents(body) {
  if (!body || body.object !== 'page') return [];
  const out = [];
  (body.entry || []).forEach(entry => {
    (entry.messaging || []).forEach(event => {
      if (!event || !event.sender || !event.sender.id) return;
      if (event.message && event.message.is_echo) return;
      const referral = (event.referral && event.referral.ref)
        || (event.postback && event.postback.referral && event.postback.referral.ref)
        || null;
      if (!event.message) {
        if (referral) out.push({ psid: String(event.sender.id), referral: String(referral), text: '', attachments: false, reply: false });
        return;
      }
      const attachments = Array.isArray(event.message.attachments) && event.message.attachments.length > 0;
      const text = String(event.message.text || '');
      out.push({
        psid: String(event.sender.id),
        referral: referral ? String(referral) : null,
        text,
        attachments,
        reply: true
      });
    });
  });
  return out;
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
  config, verifyChallenge, verifySignature, inboundEvents,
  sendText, passThreadControl, takeThreadControl
};
