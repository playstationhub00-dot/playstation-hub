// Plain assert-based test for the order state machine. No test framework in
// this project by design — run with `node scripts/test-orders.js`, which exits
// non-zero on the first failed assertion.
const assert = require('assert');
const orders = require('../lib/orders');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

check('exposes the ten lifecycle states in order', () => {
  assert.deepStrictEqual(orders.STATES, [
    'awaiting_payment', 'verifying_payment', 'awaiting_qr', 'qr_pending',
    'active', 'awaiting_return', 'verifying_return', 'closed', 'reserved',
    'waitlisted'
  ]);
});

check('owner states are exactly the three that need the owner', () => {
  assert.deepStrictEqual(orders.OWNER_STATES,
    ['verifying_payment', 'qr_pending', 'verifying_return']);
});

check('allows the normal forward path', () => {
  assert.strictEqual(orders.canTransition('awaiting_payment', 'verifying_payment'), true);
  assert.strictEqual(orders.canTransition('verifying_payment', 'awaiting_qr'), true);
  assert.strictEqual(orders.canTransition('awaiting_qr', 'qr_pending'), true);
  assert.strictEqual(orders.canTransition('qr_pending', 'active'), true);
  assert.strictEqual(orders.canTransition('active', 'awaiting_return'), true);
  assert.strictEqual(orders.canTransition('awaiting_return', 'verifying_return'), true);
  assert.strictEqual(orders.canTransition('verifying_return', 'closed'), true);
});

check('allows the QR retry loop back to awaiting_qr', () => {
  assert.strictEqual(orders.canTransition('qr_pending', 'awaiting_qr'), true);
});

check('allows payment rejection back to awaiting_payment', () => {
  assert.strictEqual(orders.canTransition('verifying_payment', 'payment_rejected'), true);
  assert.strictEqual(orders.canTransition('payment_rejected', 'awaiting_payment'), true);
});

check('rejects skipping the queue', () => {
  assert.strictEqual(orders.canTransition('awaiting_payment', 'active'), false);
  assert.strictEqual(orders.canTransition('awaiting_qr', 'closed'), false);
});

check('rejects moving backwards out of active', () => {
  assert.strictEqual(orders.canTransition('active', 'qr_pending'), false);
  assert.strictEqual(orders.canTransition('closed', 'active'), false);
});

check('allows cancelling only before active', () => {
  assert.strictEqual(orders.canTransition('awaiting_payment', 'cancelled'), true);
  assert.strictEqual(orders.canTransition('awaiting_qr', 'cancelled'), true);
  assert.strictEqual(orders.canTransition('active', 'cancelled'), false);
});

check('a rental that has run its course can be asked to return', () => {
  assert.strictEqual(orders.canTransition('active', 'awaiting_return'), true);
});

check('exposes the QR window as ten minutes', () => {
  assert.strictEqual(orders.QR_WINDOW_MS, 600000);
});

check('manilaDate reads the Manila calendar day, not the UTC one', () => {
  // 2026-08-09T17:00:00Z is already 2026-08-10 in Manila (UTC+8). Slicing the
  // ISO string would wrongly say the 9th — this is the bug that shifted every
  // rental end date by a day.
  assert.strictEqual(orders.manilaDate(new Date('2026-08-09T17:00:00Z')), '2026-08-10');
  // And a timestamp that is the same day in both zones must not drift forward.
  assert.strictEqual(orders.manilaDate(new Date('2026-08-09T03:00:00Z')), '2026-08-09');
});

check('parseOrderRef accepts only the PH-NNNN shape', () => {
  assert.strictEqual(orders.parseOrderRef('PH-4821'), 'PH-4821');
  assert.strictEqual(orders.parseOrderRef('  ph-4821 '), 'PH-4821');
  assert.strictEqual(orders.parseOrderRef('PH-12345'), 'PH-12345');
  // Anything a stranger could put in an m.me?ref= URL must be rejected.
  assert.strictEqual(orders.parseOrderRef(''), null);
  assert.strictEqual(orders.parseOrderRef(null), null);
  assert.strictEqual(orders.parseOrderRef('PH-12'), null);
  assert.strictEqual(orders.parseOrderRef('GET_STARTED'), null);
  assert.strictEqual(orders.parseOrderRef({ $ne: null }), null);
});

check('resubmitting after a payment rejection is a valid two-hop path', () => {
  // The payment-proof route resubmit flow: payment_rejected can't jump
  // straight to verifying_payment, so the route hops through awaiting_payment
  // first. Both legs of that hop must be valid transitions.
  assert.strictEqual(orders.canTransition('payment_rejected', 'awaiting_payment'), true);
  assert.strictEqual(orders.canTransition('awaiting_payment', 'verifying_payment'), true);
});

check('a waitlist entry can start paying to upgrade to priority', () => {
  // The Fall in Line -> Priority upgrade hops the order into the ordinary
  // payment flow rather than creating a second order, so the customer keeps
  // their ref, their link and their place in line.
  assert.strictEqual(orders.canTransition('waitlisted', 'awaiting_payment'), true);
  assert.strictEqual(orders.canTransition('waitlisted', 'cancelled'), true);
});

check('a waitlist entry still cannot skip straight to a paid state', () => {
  assert.strictEqual(orders.canTransition('waitlisted', 'reserved'), false);
  assert.strictEqual(orders.canTransition('waitlisted', 'active'), false);
  assert.strictEqual(orders.canTransition('waitlisted', 'awaiting_qr'), false);
});

check('the owner-marked priority upgrade has a legal path end to end', () => {
  // POST /admin/orders/:ref/priority-paid walks exactly these three hops, for a
  // customer who sent the ₱100 over Messenger instead of through the site.
  // Because the direct waitlisted -> reserved edge is (correctly) forbidden
  // above, that route depends on every hop below staying legal — if one is ever
  // removed, the button silently stops working and this fails instead.
  assert.strictEqual(orders.canTransition('waitlisted', 'awaiting_payment'), true);
  assert.strictEqual(orders.canTransition('awaiting_payment', 'verifying_payment'), true);
  assert.strictEqual(orders.canTransition('verifying_payment', 'reserved'), true);
});

check('exposes a queue-candidate query helper', () => {
  assert.strictEqual(typeof orders.listQueueCandidates, 'function');
});

console.log('\n' + passed + ' assertions passed');
