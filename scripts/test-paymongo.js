// Plain assert-based tests for the PayMongo adapter. No test framework in this
// project by design — run with `node scripts/test-paymongo.js`, which exits
// non-zero on the first failed assertion.
//
// No credentials and no network: signatures are computed here with a dummy
// secret, so the verification logic is exercised for real without a PayMongo
// account existing.
const assert = require('assert');
const crypto = require('crypto');
const pm = require('../lib/paymongo');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

const SECRET = 'whsk_test_dummy_secret';
const BODY = '{"data":{"id":"evt_1","attributes":{"type":"checkout_session.payment.paid"}}}';

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

check('basic auth header is the secret key as username with empty password', () => {
  assert.strictEqual(pm.authHeader('sk_test_abc'), 'Basic ' + Buffer.from('sk_test_abc:').toString('base64'));
  // Never throws on a missing key — the caller decides how to handle that.
  assert.strictEqual(typeof pm.authHeader(undefined), 'string');
});

check('checkout payload carries the amount in centavos and both order references', () => {
  const body = pm.checkoutPayload(
    { ref: 'PH-0039', game_title: 'Ghost of Yotei' },
    { amountCentavos: 44900, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }
  );
  const a = body.data.attributes;
  assert.strictEqual(a.line_items[0].amount, 44900);
  assert.strictEqual(a.line_items[0].currency, 'PHP');
  assert.strictEqual(a.line_items[0].quantity, 1);
  assert.strictEqual(a.line_items[0].name, 'Ghost of Yotei');
  // Both, so a payment stays identifiable if either is dropped.
  assert.strictEqual(a.reference_number, 'PH-0039');
  assert.strictEqual(a.metadata.order_ref, 'PH-0039');
  assert.strictEqual(a.success_url, 'https://x/ok');
  // QRPh first: it is the one active on this account today, and it is what a
  // GCash or Maya user scans while those wallets await their own approval.
  assert.deepStrictEqual(a.payment_method_types, ['qrph', 'gcash', 'paymaya', 'card']);
});

check('a valid plain-scheme signature verifies', () => {
  assert.strictEqual(pm.verifySignature(BODY, sign(SECRET, BODY), SECRET), true);
});

check('a valid composite-scheme signature verifies', () => {
  // Older PayMongo scheme: "t=<ts>,te=<sig>" where the signed string is ts.body
  const ts = '1756800000';
  const header = 't=' + ts + ',te=' + sign(SECRET, ts + '.' + BODY) + ',li=deadbeef';
  assert.strictEqual(pm.verifySignature(BODY, header, SECRET), true);
});

check('the live signature slot also verifies', () => {
  const ts = '1756800000';
  const header = 't=' + ts + ',te=deadbeef,li=' + sign(SECRET, ts + '.' + BODY);
  assert.strictEqual(pm.verifySignature(BODY, header, SECRET), true);
});

check('a forged signature is rejected', () => {
  assert.strictEqual(pm.verifySignature(BODY, 'f'.repeat(64), SECRET), false);
  const ts = '1756800000';
  assert.strictEqual(pm.verifySignature(BODY, 't=' + ts + ',te=' + 'f'.repeat(64), SECRET), false);
});

check('a tampered body is rejected even with a signature that was once valid', () => {
  // The exact attack signature verification exists to stop: replay a real
  // signature against a body whose amount has been edited upward.
  const good = sign(SECRET, BODY);
  const tampered = BODY.replace('evt_1', 'evt_2');
  assert.strictEqual(pm.verifySignature(tampered, good, SECRET), false);
});

check('the wrong secret is rejected', () => {
  assert.strictEqual(pm.verifySignature(BODY, sign('other_secret', BODY), SECRET), false);
});

check('a missing secret or header never verifies', () => {
  assert.strictEqual(pm.verifySignature(BODY, sign(SECRET, BODY), ''), false);
  assert.strictEqual(pm.verifySignature(BODY, '', SECRET), false);
  assert.strictEqual(pm.verifySignature(BODY, null, SECRET), false);
  assert.strictEqual(pm.verifySignature(BODY, 't=123', SECRET), false);
});

check('signature comparison does not throw on a length mismatch', () => {
  // timingSafeEqual throws when buffers differ in length; a short signature
  // must return false rather than crash the webhook handler.
  assert.strictEqual(pm.verifySignature(BODY, 'abc', SECRET), false);
});

check('header parsing recognises both schemes', () => {
  assert.strictEqual(pm.parseSignatureHeader('abc123').scheme, 'plain');
  const c = pm.parseSignatureHeader('t=111,te=aaa,li=bbb');
  assert.strictEqual(c.scheme, 'composite');
  assert.strictEqual(c.timestamp, '111');
  assert.deepStrictEqual(c.signatures, ['aaa', 'bbb']);
  assert.strictEqual(pm.parseSignatureHeader(''), null);
  assert.strictEqual(pm.parseSignatureHeader('  '), null);
});

check('a paid checkout event normalises to the shape gateway.decide expects', () => {
  const event = pm.normalizeEvent({
    data: {
      id: 'evt_abc',
      attributes: {
        type: 'checkout_session.payment.paid',
        data: {
          id: 'cs_1',
          attributes: {
            reference_number: 'PH-0039',
            amount: 44900,
            payments: [{ attributes: { amount: 44900 } }]
          }
        }
      }
    }
  });
  assert.deepStrictEqual(event, { id: 'evt_abc', type: 'checkout_session.payment.paid', orderRef: 'PH-0039', amountCentavos: 44900, paid: true });
});

check('the order ref falls back to metadata when reference_number is absent', () => {
  const event = pm.normalizeEvent({
    data: {
      id: 'evt_abc',
      attributes: {
        type: 'checkout_session.payment.paid',
        data: { attributes: { metadata: { order_ref: 'PH-0041' }, amount: 34900 } }
      }
    }
  });
  assert.strictEqual(event.orderRef, 'PH-0041');
  assert.strictEqual(event.amountCentavos, 34900);
});

check('any other event type is not marked paid', () => {
  const event = pm.normalizeEvent({
    data: { id: 'evt_x', attributes: { type: 'checkout_session.payment.failed', data: { attributes: { reference_number: 'PH-0039' } } } }
  });
  assert.strictEqual(event.paid, false);
});

check('a malformed payload normalises without throwing', () => {
  assert.strictEqual(pm.normalizeEvent({}).paid, false);
  assert.strictEqual(pm.normalizeEvent(null).orderRef, null);
  assert.strictEqual(pm.normalizeEvent({ data: {} }).amountCentavos, 0);
});

check('keyMode reports which mode the configured key puts the site in', () => {
  assert.strictEqual(pm.keyMode('sk_live_abc123'), 'live');
  assert.strictEqual(pm.keyMode('sk_test_abc123'), 'test');
  assert.strictEqual(pm.keyMode(''), 'none');
  assert.strictEqual(pm.keyMode(undefined), 'none');
  assert.strictEqual(pm.keyMode(null), 'none');
});

check('an unrecognised key never reads as safe', () => {
  // Guessing 'test' for something unparseable would tell the owner no real
  // money is moving while it might well be. 'unknown' makes them look.
  assert.strictEqual(pm.keyMode('pk_live_abc'), 'unknown');
  assert.strictEqual(pm.keyMode('garbage'), 'unknown');
  assert.strictEqual(pm.keyMode('SK_LIVE_ABC'), 'unknown');
  assert.strictEqual(pm.keyMode(' sk_live_abc'), 'unknown');
});

console.log('\n' + passed + ' assertions passed');
