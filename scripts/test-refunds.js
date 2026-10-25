// Run: node scripts/test-refunds.js
//
// Cancel / refund is pure in lib/refunds.js: which extension can be undone,
// what the rental looks like afterwards, and the line the customers table shows.
const assert = require('assert');
const refunds = require('../lib/refunds');

let passed = 0;
function ok(desc, fn) {
  fn();
  passed++;
  console.log('  ok - ' + desc);
}

function juan(extra) {
  return Object.assign({
    id: 7,
    customer_name: 'Juan Paolo Guilot',
    game_title: 'PS Plus Deluxe',
    account_type: 'tr',
    status: 'renting',
    days: 60,
    price: 1438,
    start_date: '2026-09-27',
    end_date: '2026-11-26',
    payments: [
      { amount: 619, date: '2026-09-27', kind: 'rental' },
      { amount: 819, date: '2026-10-01', kind: 'extension' }
    ],
    extensions: [{
      at: '2026-10-01T02:00:00.000Z',
      days: 30,
      amount: 819,
      from_end_date: '2026-10-27',
      end_date: '2026-11-26',
      days_total: 60,
      price_total: 1438
    }]
  }, extra || {});
}

const REFUND = { amount: 819, method: 'gcash', date: '2026-10-25', note: 'cancelled the extra month', at: '2026-10-25T01:00:00.000Z' };

console.log('\nchoices — recorded extension, payment-only extension, or neither');

ok('a saved extension is offered on its own, with the days and the old end date', () => {
  const list = refunds.choices(juan());
  assert.strictEqual(list.recorded.length, 1);
  assert.strictEqual(list.recorded[0].key, 'record:0');
  assert.strictEqual(list.recorded[0].days, 30);
  assert.strictEqual(list.recorded[0].amount, 819);
  assert.strictEqual(list.recorded[0].from_end_date, '2026-10-27');
  assert.strictEqual(list.recorded[0].last, true);
  assert.strictEqual(list.inferred.length, 0, 'the matching extension payment is not offered twice');
  assert.strictEqual(list.manual, false);
});

ok('a price rise with no extension row is still offered, and the days are unknown', () => {
  const row = juan({ extensions: [] });
  const list = refunds.choices(row);
  assert.strictEqual(list.recorded.length, 0);
  assert.strictEqual(list.inferred.length, 1);
  assert.strictEqual(list.inferred[0].key, 'payment:1');
  assert.strictEqual(list.inferred[0].amount, 819);
  assert.strictEqual(list.inferred[0].days, null);
  assert.strictEqual(list.manual, false);
});

ok('a rental whose extension was never split out can still be shortened by hand', () => {
  const row = juan({
    extensions: [],
    payments: [{ amount: 1438, date: '2026-09-27', kind: 'rental' }]
  });
  const list = refunds.choices(row);
  assert.strictEqual(list.manual, true);
  assert.strictEqual(list.canCancelRental, true);
});

ok('two saved extensions are both listed, and only the latest restores its own end date', () => {
  const row = juan({
    days: 67,
    price: 1637,
    end_date: '2026-12-03',
    payments: [
      { amount: 619, date: '2026-09-27', kind: 'rental' },
      { amount: 819, date: '2026-10-01', kind: 'extension' },
      { amount: 199, date: '2026-10-20', kind: 'extension' }
    ],
    extensions: [
      { at: 'a', days: 30, amount: 819, from_end_date: '2026-10-27', end_date: '2026-11-26' },
      { at: 'b', days: 7, amount: 199, from_end_date: '2026-11-26', end_date: '2026-12-03' }
    ]
  });
  const list = refunds.choices(row);
  assert.deepStrictEqual(list.recorded.map(r => r.key), ['record:0', 'record:1']);
  assert.strictEqual(list.recorded[0].last, undefined);
  assert.strictEqual(list.recorded[1].last, true);
});

console.log('\ncancelling Juan Paolo\'s 30-day extension');

ok('the rental stays active, loses 30 days, and the refund is netted on the day it was sent', () => {
  const result = refunds.applyExtension(juan(), Object.assign({ key: 'record:0' }, REFUND));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.status, 'renting');
  assert.strictEqual(result.patch.days, 30);
  assert.strictEqual(result.patch.end_date, '2026-10-27');
  assert.strictEqual(result.patch.price, 619);
  assert.strictEqual(result.patch.extensions[0].cancelled.amount, 819);
  const refund = result.patch.payments[result.patch.payments.length - 1];
  assert.deepStrictEqual(
    { amount: refund.amount, date: refund.date, kind: refund.kind, method: refund.method },
    { amount: -819, date: '2026-10-25', kind: 'refund', method: 'gcash' }
  );
  assert.strictEqual(refunds.paymentSum({ payments: result.patch.payments }), 619);
  assert.strictEqual(result.patch.price, 619, 'price still matches the payments');
  assert.strictEqual(result.line, 'Extension cancelled, ₱819 refunded (GCash) on Oct 25, 2026');
});

ok('a partial extension refund gives back only what was typed, and still removes the days', () => {
  const result = refunds.applyExtension(juan(), Object.assign({}, REFUND, { key: 'record:0', amount: 500 }));
  assert.strictEqual(result.patch.days, 30);
  assert.strictEqual(result.patch.end_date, '2026-10-27');
  assert.strictEqual(result.patch.price, 938);
  assert.strictEqual(result.line, 'Extension cancelled, ₱500 of ₱819 refunded (GCash) on Oct 25, 2026');
});

ok('an extension known only as a payment asks for the days and then shortens the same way', () => {
  const row = juan({ extensions: [] });
  const missing = refunds.applyExtension(row, Object.assign({ key: 'payment:1' }, REFUND));
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.error, 'bad_days');
  const result = refunds.applyExtension(row, Object.assign({ key: 'payment:1', days: 30 }, REFUND));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.days, 30);
  assert.strictEqual(result.patch.end_date, '2026-10-27');
  assert.strictEqual(result.patch.price, 619);
  assert.strictEqual(result.patch.payments[1].refunded, result.entry.id, 'that payment is not offered again');
});

ok('a fully merged rental is shortened by the days the owner types', () => {
  const row = juan({
    extensions: [],
    payments: [{ amount: 1438, date: '2026-09-27', kind: 'rental' }]
  });
  const result = refunds.applyExtension(row, Object.assign({ key: 'manual', days: 30 }, REFUND));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.days, 30);
  assert.strictEqual(result.patch.end_date, '2026-10-27');
  assert.strictEqual(result.patch.price, 619);
  assert.strictEqual(result.patch.status, 'renting');
});

ok('removing every remaining day is refused — that is a whole-rental cancel', () => {
  const row = juan({
    extensions: [],
    payments: [{ amount: 1438, date: '2026-09-27', kind: 'rental' }]
  });
  const result = refunds.applyExtension(row, Object.assign({ key: 'manual', days: 60 }, REFUND, { amount: 1438 }));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'whole_rental');
});

ok('a refund larger than what was collected is refused', () => {
  const result = refunds.applyExtension(juan(), Object.assign({}, REFUND, { key: 'record:0', amount: 2000 }));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'too_much');
});

ok('cancelling an earlier extension moves the end date back by its days and leaves the later one', () => {
  const row = juan({
    days: 67,
    price: 1637,
    end_date: '2026-12-03',
    payments: [
      { amount: 619, date: '2026-09-27', kind: 'rental' },
      { amount: 819, date: '2026-10-01', kind: 'extension' },
      { amount: 199, date: '2026-10-20', kind: 'extension' }
    ],
    extensions: [
      { at: 'a', days: 30, amount: 819, from_end_date: '2026-10-27', end_date: '2026-11-26' },
      { at: 'b', days: 7, amount: 199, from_end_date: '2026-11-26', end_date: '2026-12-03' }
    ]
  });
  const result = refunds.applyExtension(row, Object.assign({}, REFUND, { key: 'record:0' }));
  assert.strictEqual(result.patch.days, 37);
  assert.strictEqual(result.patch.end_date, '2026-11-03');
  assert.strictEqual(result.patch.extensions[1].cancelled, undefined);
  assert.ok(result.patch.extensions[0].cancelled);
});

console.log('\nwhole-rental cancel');

ok('a partial refund keeps the record, drops it out of the active statuses, and remembers the original price', () => {
  const result = refunds.applyRental(juan(), Object.assign({}, REFUND, { amount: 819 }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.status, 'cancelled');
  assert.strictEqual(result.patch.price, 619);
  assert.strictEqual(result.patch.cancellation.gross, 1438);
  assert.strictEqual(result.patch.days, undefined, 'days stay on the record');
  assert.strictEqual(refunds.paymentSum({ payments: result.patch.payments }), 619);
  assert.strictEqual(result.line, 'Rental cancelled, ₱819 refunded (GCash) on Oct 25, 2026');
});

ok('giving back everything collected is Refunded, and the price goes to zero', () => {
  const result = refunds.applyRental(juan(), Object.assign({}, REFUND, { amount: 1438 }));
  assert.strictEqual(result.patch.status, 'refunded');
  assert.strictEqual(result.patch.price, 0);
  assert.strictEqual(result.patch.cancellation.gross, 1438);
  assert.strictEqual(result.line, 'Rental refunded, ₱1,438 refunded (GCash) on Oct 25, 2026');
});

ok('the deposit is not added to the default collected amount', () => {
  assert.strictEqual(refunds.paymentSum(juan()), 1438);
  const payload = refunds.formPayload(juan(), '2026-10-25');
  assert.strictEqual(payload.net, 1438);
  assert.strictEqual(payload.accountType, 'tr');
});

ok('a finished rental can be refunded, but not by cancelling an extension', () => {
  const row = juan({ status: 'done' });
  const ext = refunds.applyExtension(row, Object.assign({ key: 'record:0' }, REFUND));
  assert.strictEqual(ext.error, 'bad_status');
  const whole = refunds.applyRental(row, REFUND);
  assert.strictEqual(whole.patch.status, 'cancelled');
});

console.log('\nundo and edit');

ok('undoing the extension puts the days, the end date and the price back', () => {
  const applied = refunds.applyExtension(juan(), Object.assign({ key: 'record:0' }, REFUND));
  const restored = Object.assign({}, juan(), applied.patch);
  const result = refunds.undo(restored, applied.entry.id);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.kind, 'undo-extension');
  assert.strictEqual(result.patch.days, 60);
  assert.strictEqual(result.patch.end_date, '2026-11-26');
  assert.strictEqual(result.patch.price, 1438);
  assert.strictEqual(result.patch.status, 'renting');
  assert.strictEqual(result.patch.extensions[0].cancelled, undefined);
  assert.ok(!result.patch.payments.some(p => p.kind === 'refund'));
  assert.strictEqual(result.patch.payments[1].refunded, undefined);
});

ok('undo is refused once a later change has moved the end date', () => {
  const applied = refunds.applyExtension(juan(), Object.assign({ key: 'record:0' }, REFUND));
  const later = Object.assign({}, juan(), applied.patch, { days: 37, end_date: '2026-11-03' });
  const result = refunds.undo(later, applied.entry.id);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'changed');
});

ok('editing a refund changes the amount and the month it counts in, not the days', () => {
  const applied = refunds.applyExtension(juan(), Object.assign({ key: 'record:0' }, REFUND));
  const current = Object.assign({}, juan(), applied.patch);
  const result = refunds.edit(current, {
    refund_id: applied.entry.id, amount: 700, method: 'maya', date: '2026-10-26', note: 'sent the rest later'
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.price, 738);
  assert.strictEqual(result.entry.method, 'maya');
  assert.strictEqual(result.patch.payments.find(p => p.kind === 'refund').amount, -700);
  assert.strictEqual(result.patch.payments.find(p => p.kind === 'refund').date, '2026-10-26');
  assert.strictEqual(result.line, 'Extension cancelled, ₱700 of ₱819 refunded (Maya) on Oct 26, 2026');
});

ok('undoing a whole-rental cancel restores the previous status and the original price', () => {
  const applied = refunds.applyRental(juan(), Object.assign({}, REFUND, { amount: 819 }));
  const current = Object.assign({}, juan(), applied.patch);
  const result = refunds.undo(current, applied.entry.id);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.status, 'renting');
  assert.strictEqual(result.patch.price, 1438);
  assert.strictEqual(result.patch.cancellation, null);
  assert.strictEqual(refunds.paymentSum({ payments: result.patch.payments }), 1438);
});

ok('editing a partial whole-rental refund up to the full amount flips the status to Refunded', () => {
  const applied = refunds.applyRental(juan(), Object.assign({}, REFUND, { amount: 819 }));
  const current = Object.assign({}, juan(), applied.patch);
  const result = refunds.edit(current, {
    refund_id: applied.entry.id, amount: 1438, method: 'gcash', date: '2026-10-25', note: ''
  });
  assert.strictEqual(result.patch.status, 'refunded');
  assert.strictEqual(result.patch.price, 0);
  assert.strictEqual(result.patch.cancellation.gross, 1438);
});

ok('a missing method or a bad date is refused before anything is written', () => {
  assert.strictEqual(refunds.applyRental(juan(), { amount: 100, method: '', date: '2026-10-25' }).error, 'bad_method');
  assert.strictEqual(refunds.applyRental(juan(), { amount: 100, method: 'cash', date: '2026-10-25' }).error, 'bad_method');
  assert.strictEqual(refunds.applyRental(juan(), { amount: 100, method: 'paypal', date: '25/10/2026' }).error, 'bad_date');
});

console.log('\n' + passed + ' assertions passed\n');
