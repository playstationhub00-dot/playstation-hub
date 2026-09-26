// Run: node scripts/test-quick-add-settle.js
//
// Unpaid Quick Adds: which orders they are, where each settles once paid, the
// payment line to record, and the reminder the owner copies. Pure rules —
// server.js applies them to every payment path.
const assert = require('assert');
const qs = require('../lib/quick-add-settle');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

console.log('\nisOwnerRecordedUnpaid()');

ok('an unpaid Quick Add with a saved target is listed, in every pre-payment state', () => {
  ['awaiting_payment', 'verifying_payment', 'payment_rejected'].forEach(state => {
    assert.strictEqual(qs.isOwnerRecordedUnpaid({ state, settle_state: 'active' }), true, state);
  });
});

ok('an older unpaid Quick Add is caught through its customer record', () => {
  assert.strictEqual(qs.isOwnerRecordedUnpaid({ state: 'awaiting_payment', customer_id: 12 }), true);
});

ok('a website checkout that has not paid yet is not', () => {
  assert.strictEqual(qs.isOwnerRecordedUnpaid({ state: 'awaiting_payment' }), false);
  assert.strictEqual(qs.isOwnerRecordedUnpaid({ state: 'awaiting_payment', upgraded_from_waitlist: true }), false);
});

ok('paid or finished orders never are', () => {
  assert.strictEqual(qs.isOwnerRecordedUnpaid({ state: 'active', customer_id: 12, settle_state: 'active' }), false);
  assert.strictEqual(qs.isOwnerRecordedUnpaid({ state: 'cancelled', customer_id: 12 }), false);
  assert.strictEqual(qs.isOwnerRecordedUnpaid(null), false);
});

console.log('\nsettleTarget()');

ok('the target saved at Quick Add wins', () => {
  assert.strictEqual(qs.settleTarget({ settle_state: 'awaiting_qr' }, { status: 'renting' }), 'awaiting_qr');
  assert.strictEqual(qs.settleTarget({ settle_state: 'closed' }, null), 'closed');
});

ok('an older order falls back to the customer row', () => {
  assert.strictEqual(qs.settleTarget({}, { status: 'renting' }), 'active');
  assert.strictEqual(qs.settleTarget({}, { status: 'bought' }), 'active');
  assert.strictEqual(qs.settleTarget({}, { status: 'done' }), 'closed');
  assert.strictEqual(qs.settleTarget({ upcoming_game_id: 15 }, { status: 'reservation' }), 'reserved');
  assert.strictEqual(qs.settleTarget({}, { status: 'something else' }), 'active');
  assert.strictEqual(qs.settleTarget({}, null), 'active');
});

ok('a saved target outside the allowed list is ignored', () => {
  assert.strictEqual(qs.settleTarget({ settle_state: 'cancelled' }, { status: 'done' }), 'closed');
});

ok('a reservation whose game was released before it was paid waits for its sign-in code instead', () => {
  assert.strictEqual(qs.settleTarget({ settle_state: 'reserved', upcoming_game_id: 15 }, { status: 'reservation' }), 'reserved');
  assert.strictEqual(qs.settleTarget({ settle_state: 'reserved', upcoming_game_id: null }, { status: 'reservation' }), 'awaiting_qr');
  assert.strictEqual(qs.settleTarget({}, { status: 'reservation' }), 'awaiting_qr');
});

console.log('\nsettlementPayment()');

ok('records what the customer row still owes, dated the day it is confirmed', () => {
  assert.deepStrictEqual(
    qs.settlementPayment({ amount_due: 349 }, { price: 349, payments: [] }, '2026-09-26'),
    { amount: 349, date: '2026-09-26', kind: 'rent' }
  );
});

ok('takes off anything already recorded on the row', () => {
  assert.strictEqual(qs.settlementPayment({}, { price: 500, payments: [{ amount: 200 }] }, '2026-09-26').amount, 300);
});

ok('a reservation and a purchase are recorded as such', () => {
  assert.strictEqual(qs.settlementPayment({ upcoming_game_id: 15 }, { price: 449, payments: [] }, '2026-09-26').kind, 'reservation');
  assert.strictEqual(qs.settlementPayment({ is_buy: true }, { price: 1299, payments: [] }, '2026-09-26').kind, 'purchase');
});

ok('nothing owed records nothing', () => {
  assert.strictEqual(qs.settlementPayment({}, { price: 349, payments: [{ amount: 349 }] }, '2026-09-26'), null);
  assert.strictEqual(qs.settlementPayment({}, { price: 0, payments: [] }, '2026-09-26'), null);
});

ok('with no customer row it falls back to the order amount', () => {
  assert.strictEqual(qs.settlementPayment({ amount_due: 249 }, null, '2026-09-26').amount, 249);
});

console.log('\nreminderMessage()');

ok('the reminder, with a link to pay', () => {
  assert.strictEqual(
    qs.reminderMessage({ fbName: 'Ana Cruz', owed: 1500, gameTitle: 'Ghost of Yotei', ref: 'PH-0301', link: 'https://playstation-hub.com/order/PH-0301?k=abc' }),
    '👋 Hi Ana! Friendly reminder — ₱1,500 for Ghost of Yotei (PH-0301) is still unpaid.\n\n'
      + 'You can pay here: https://playstation-hub.com/order/PH-0301?k=abc\n'
      + 'or just reply here once you\'ve sent it. Thank you!'
  );
});

ok('without a link it just asks them to reply', () => {
  assert.strictEqual(
    qs.reminderMessage({ fbName: '', owed: 349, gameTitle: 'Tekken 8', ref: 'PH-0302', link: '' }),
    '👋 Hi there! Friendly reminder — ₱349 for Tekken 8 (PH-0302) is still unpaid.\n\n'
      + 'Just reply here once you\'ve sent it. Thank you!'
  );
});

console.log('\n' + passed + ' assertions passed\n');
