// PayMongo adapter. Its whole job is to turn PayMongo's shapes into the small
// normalised event lib/gateway.js decides on, and to build the checkout request.
// Every money rule lives in lib/gateway.js, not here — so replacing PayMongo
// means rewriting this file and nothing else.
//
// Pure functions only: no network calls, no key material, no environment reads.
// The caller passes the secret in. That keeps this file fully testable and means
// a key never sits in module state.
//
// See docs/superpowers/specs/2026-09-02-online-payments-design.md (Phase 1).

const crypto = require('crypto');

const CHECKOUT_SESSIONS_URL = 'https://api.paymongo.com/v1/checkout_sessions';

// The event PayMongo emits when a hosted checkout is actually paid. Other
// event types exist and are deliberately ignored — only this one moves money.
const PAID_EVENT = 'checkout_session.payment.paid';

// Which mode the configured key puts the site in. PayMongo encodes this in the
// key prefix, and nothing else in this codebase distinguishes the two — so this
// is the single place that decides whether the site is taking real money, and
// what the admin badge reports. Anything unrecognised reads as 'unknown' rather
// than guessing 'test', because guessing wrong in that direction would tell the
// owner they are safe while real payments are running.
function keyMode(secretKey) {
  const k = String(secretKey || '');
  if (!k) return 'none';
  if (k.indexOf('sk_live_') === 0) return 'live';
  if (k.indexOf('sk_test_') === 0) return 'test';
  return 'unknown';
}

// PayMongo authenticates with HTTP Basic, secret key as the username and an
// empty password.
function authHeader(secretKey) {
  return 'Basic ' + Buffer.from(String(secretKey || '') + ':').toString('base64');
}

// Amounts go to PayMongo in centavos — 10000 is ₱100. The conversion itself
// lives in lib/gateway.js so there is exactly one implementation of it.
function checkoutPayload(order, opts) {
  const o = opts || {};
  const amountCentavos = Math.round(Number(o.amountCentavos) || 0);
  return {
    data: {
      attributes: {
        line_items: [{
          name: o.lineName || (order.game_title || 'Rental'),
          amount: amountCentavos,
          currency: 'PHP',
          quantity: 1
        }],
        payment_method_types: o.paymentMethods || ['gcash', 'paymaya', 'card'],
        success_url: o.successUrl,
        cancel_url: o.cancelUrl,
        description: o.description || ('Order ' + order.ref),
        // Sent twice on purpose. reference_number is what PayMongo surfaces in
        // their dashboard, so the owner can match a payment to an order by eye;
        // metadata is what comes back on the webhook. Losing either one still
        // leaves a way to identify the order.
        reference_number: order.ref,
        metadata: { order_ref: order.ref }
      }
    }
  };
}

// Parses the Paymongo-Signature header into the pieces needed to verify it.
//
// PayMongo's documentation describes two incompatible schemes across pages: a
// plain HMAC of the raw body, and an older composite header of the form
//   t=<timestamp>,te=<test signature>,li=<live signature>
// where the signed string is "<timestamp>.<body>" rather than the body alone.
// Both are handled rather than guessed at, because picking the wrong one either
// rejects every genuine webhook or — far worse — accepts forged ones. Which
// scheme is live must be confirmed against a real captured payload before this
// goes anywhere near live keys.
function parseSignatureHeader(header) {
  const raw = String(header == null ? '' : header).trim();
  if (!raw) return null;
  if (raw.indexOf('=') === -1) {
    // Plain scheme: the header is the signature and the body is signed as-is.
    return { scheme: 'plain', timestamp: null, signatures: [raw] };
  }
  const parts = {};
  raw.split(',').forEach(chunk => {
    const i = chunk.indexOf('=');
    if (i === -1) return;
    parts[chunk.slice(0, i).trim()] = chunk.slice(i + 1).trim();
  });
  const signatures = [parts.te, parts.li].filter(Boolean);
  if (!parts.t || !signatures.length) return null;
  return { scheme: 'composite', timestamp: parts.t, signatures };
}

function hmac(secret, payload) {
  return crypto.createHmac('sha256', String(secret || '')).update(payload, 'utf8').digest('hex');
}

// Constant-time compare so a wrong signature cannot be discovered a byte at a
// time. Length is checked first because timingSafeEqual throws on a mismatch.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// rawBody MUST be the exact bytes PayMongo sent. Express's JSON middleware
// re-serialises the body, and any byte that shifts — key order, spacing —
// breaks the signature on a perfectly legitimate request.
function verifySignature(rawBody, header, secret) {
  if (!secret) return false;
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  const body = typeof rawBody === 'string' ? rawBody : String(rawBody || '');
  const signed = parsed.scheme === 'composite' ? (parsed.timestamp + '.' + body) : body;
  const expected = hmac(secret, signed);
  return parsed.signatures.some(sig => safeEqual(expected, sig));
}

function firstDefined() {
  for (let i = 0; i < arguments.length; i++) {
    if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== '') return arguments[i];
  }
  return null;
}

// Flattens PayMongo's nested envelope into the shape lib/gateway.js decides on.
// Written defensively across both places the order reference can appear, since
// a payment whose order cannot be identified is the one failure that loses money
// silently.
function normalizeEvent(payload) {
  const root = (payload && payload.data) || {};
  const rootAttrs = root.attributes || {};
  const inner = rootAttrs.data || {};
  const attrs = inner.attributes || {};

  const type = rootAttrs.type || '';
  const orderRef = firstDefined(
    attrs.reference_number,
    (attrs.metadata || {}).order_ref,
    (rootAttrs.metadata || {}).order_ref
  );

  // On a paid checkout session the settled amount lives on the payment, with
  // the session's own amount as the fallback.
  const payments = attrs.payments || [];
  const paymentAmount = payments.length ? (payments[0].attributes || {}).amount : undefined;

  return {
    id: root.id || null,
    type,
    orderRef,
    amountCentavos: Math.round(Number(firstDefined(paymentAmount, attrs.amount, 0)) || 0),
    paid: type === PAID_EVENT
  };
}

module.exports = {
  CHECKOUT_SESSIONS_URL, PAID_EVENT,
  keyMode, authHeader, checkoutPayload, parseSignatureHeader, verifySignature, normalizeEvent
};
