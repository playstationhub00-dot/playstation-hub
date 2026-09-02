// Plain assert-based tests for the payment-gateway decision rules. No test
// framework in this project by design — run with `node scripts/test-gateway.js`,
// which exits non-zero on the first failed assertion.
//
// These cover the rules that guard real money: replay protection, underpayment,
// and the states where a payment may be applied at all. They run without any
// provider credentials, which is the whole point of keeping the decision logic
// free of the PayMongo SDK.
const assert = require('assert');
const gw = require('../lib/gateway');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

function order(over) {
  return Object.assign({
    ref: 'PH-0039', state: 'awaiting_payment', amount_due: 349, deposit_due: 100
  }, over);
}

function event(over) {
  return Object.assign({
    id: 'evt_abc123', orderRef: 'PH-0039', amountCentavos: 44900, paid: true
  }, over);
}

check('pesos convert to centavos, not the other way round', () => {
  // Getting this backwards would accept ₱3.49 for a ₱349 rental.
  assert.strictEqual(gw.toCentavos(349), 34900);
  assert.strictEqual(gw.toCentavos(0), 0);
  assert.strictEqual(gw.toCentavos(1.5), 150);
  assert.strictEqual(gw.toCentavos(null), 0);
  assert.strictEqual(gw.toCentavos('349'), 34900);
});

check('amount due is the rent plus the deposit', () => {
  assert.strictEqual(gw.amountDueCentavos(order()), 44900);
  assert.strictEqual(gw.amountDueCentavos(order({ deposit_due: 0 })), 34900);
  assert.strictEqual(gw.amountDueCentavos(null), 0);
});

check('a replayed event is ignored', () => {
  // Gateways retry until they get a 200. Processing twice would double-record.
  const out = gw.decide({ event: event(), order: order(), processedIds: ['evt_abc123'] });
  assert.strictEqual(out.action, 'duplicate');
});

check('a fresh event id is not treated as a replay', () => {
  const out = gw.decide({ event: event({ id: 'evt_new' }), order: order(), processedIds: ['evt_abc123'] });
  assert.strictEqual(out.action, 'accept');
});

check('an unsettled payment is not accepted', () => {
  const out = gw.decide({ event: event({ paid: false }), order: order(), processedIds: [] });
  assert.strictEqual(out.action, 'not_paid');
});

check('a payment with no matching order is surfaced, not discarded', () => {
  // Money that arrived for an order we cannot find is the case that must never
  // be silently swallowed.
  const out = gw.decide({ event: event(), order: null, processedIds: [] });
  assert.strictEqual(out.action, 'unknown_order');
});

check('only awaiting_payment and payment_rejected accept a payment', () => {
  assert.strictEqual(gw.decide({ event: event(), order: order({ state: 'awaiting_payment' }), processedIds: [] }).action, 'accept');
  assert.strictEqual(gw.decide({ event: event(), order: order({ state: 'payment_rejected' }), processedIds: [] }).action, 'accept');
  ['active', 'awaiting_qr', 'qr_pending', 'closed', 'cancelled', 'reserved', 'waitlisted', 'verifying_payment']
    .forEach(state => {
      const out = gw.decide({ event: event(), order: order({ state }), processedIds: [] });
      assert.strictEqual(out.action, 'not_payable', state + ' should not accept a payment');
    });
});

check('underpayment is never accepted', () => {
  // Paying ₱100 towards a ₱449 order must not hand over an account.
  const out = gw.decide({ event: event({ amountCentavos: 10000 }), order: order(), processedIds: [] });
  assert.strictEqual(out.action, 'short');
  assert.strictEqual(out.shortBy, 34900);
  assert.strictEqual(out.due, 44900);
  assert.strictEqual(out.paid, 10000);
});

check('one centavo short is still short', () => {
  const out = gw.decide({ event: event({ amountCentavos: 44899 }), order: order(), processedIds: [] });
  assert.strictEqual(out.action, 'short');
  assert.strictEqual(out.shortBy, 1);
});

check('overpayment is accepted but flagged', () => {
  const out = gw.decide({ event: event({ amountCentavos: 50000 }), order: order(), processedIds: [] });
  assert.strictEqual(out.action, 'accept_over');
  assert.strictEqual(out.overBy, 5100);
});

check('exact payment is accepted', () => {
  const out = gw.decide({ event: event(), order: order(), processedIds: [] });
  assert.strictEqual(out.action, 'accept');
  assert.strictEqual(out.due, out.paid);
});

check('a missing amount counts as zero, not as paid in full', () => {
  const out = gw.decide({ event: event({ amountCentavos: undefined }), order: order(), processedIds: [] });
  assert.strictEqual(out.action, 'short');
});

check('duplicate check runs before anything else', () => {
  // A replay of a payment for an order that has since moved on must report the
  // replay, not a state error — otherwise retries look like a different fault.
  const out = gw.decide({
    event: event(), order: order({ state: 'active' }), processedIds: ['evt_abc123']
  });
  assert.strictEqual(out.action, 'duplicate');
});

check('order ref from metadata accepts only the PH-NNNN shape', () => {
  // Metadata round-trips through the provider, so it is untrusted by the time
  // it comes back — the same guard the Messenger ref path uses.
  assert.strictEqual(gw.orderRefFrom({ order_ref: 'PH-0039' }), 'PH-0039');
  assert.strictEqual(gw.orderRefFrom({ order_ref: 'ph-0039' }), 'PH-0039');
  assert.strictEqual(gw.orderRefFrom({ order_ref: 'PH-12' }), null);
  assert.strictEqual(gw.orderRefFrom({ order_ref: { $ne: null } }), null);
  assert.strictEqual(gw.orderRefFrom({}), null);
  assert.strictEqual(gw.orderRefFrom(null), null);
});

check('an empty event id is not matched against the processed list', () => {
  assert.strictEqual(gw.isDuplicateEvent(['evt_a'], ''), false);
  assert.strictEqual(gw.isDuplicateEvent(['evt_a'], null), false);
  assert.strictEqual(gw.isDuplicateEvent([], 'evt_a'), false);
  assert.strictEqual(gw.isDuplicateEvent(['evt_a'], 'evt_a'), true);
});

console.log('\n' + passed + ' assertions passed');
