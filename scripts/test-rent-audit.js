// Run: node scripts/test-rent-audit.js
const assert = require('assert');
const audit = require('../lib/rent-audit');
const pricing = require('../lib/rent-pricing');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const TIER = { 7: 149, 30: 349 };
const tierFor = () => TIER;

function renter(over) {
  return Object.assign({
    id: 1, customer_name: 'Ana', game_title: 'Elden Ring', account_type: 'nt',
    status: 'renting', days: 7, price: 149, end_date: '2026-09-19', order_ref: 'PH-0142'
  }, over);
}

console.log('\nthe case this exists for');

ok('a weekly price on a monthly rental is caught', () => {
  const r = audit.check(renter({ days: 30, price: 149 }), TIER);
  assert.ok(r, 'should flag');
  assert.strictEqual(r.recordedDays, 30);
  assert.strictEqual(r.paidPrice, 149);
  assert.strictEqual(r.expectedPrice, 349);
  assert.strictEqual(r.shortfall, 200);
  assert.strictEqual(r.paidForDays, 7, 'their money covers exactly a week');
});

ok('it names who and what, so the row is actionable', () => {
  const r = audit.check(renter({ days: 30, price: 149 }), TIER);
  assert.strictEqual(r.customer_name, 'Ana');
  assert.strictEqual(r.game_title, 'Elden Ring');
  assert.strictEqual(r.order_ref, 'PH-0142');
  assert.strictEqual(r.end_date, '2026-09-19');
});

console.log('\nrentals that are fine stay silent');

ok('a correctly priced weekly rental', () => {
  assert.strictEqual(audit.check(renter({ days: 7, price: 149 }), TIER), null);
});

ok('a correctly priced monthly rental', () => {
  assert.strictEqual(audit.check(renter({ days: 30, price: 349 }), TIER), null);
});

ok('a correctly priced custom duration', () => {
  const fair = pricing.amountForDays(12, TIER).amount;
  assert.strictEqual(audit.check(renter({ days: 12, price: fair }), TIER), null);
});

ok('someone who overpaid is not dragged into this list', () => {
  assert.strictEqual(audit.check(renter({ days: 7, price: 400 }), TIER), null);
});

ok('a peso or two of rounding is not a finding', () => {
  const fair = pricing.amountForDays(19, TIER).amount;
  assert.strictEqual(audit.check(renter({ days: 19, price: fair - 2 }), TIER), null);
});

console.log('\nthings that are not this problem');

ok('a finished rental is history, not a live overcharge', () => {
  assert.strictEqual(audit.check(renter({ status: 'done', days: 30, price: 149 }), TIER), null);
});

ok('a bought game has no duration to be wrong about', () => {
  assert.strictEqual(audit.check(renter({ status: 'bought', days: null, price: 149 }), TIER), null);
});

ok('an unpaid rental is a different problem with a different answer', () => {
  assert.strictEqual(audit.check(renter({ days: 30, price: 0 }), TIER), null);
});

ok('a game with no prices set cannot be judged', () => {
  assert.strictEqual(audit.check(renter({ days: 30, price: 149 }), { 7: 0, 30: 0 }), null);
});

console.log('\nextensions must not become false alarms');

ok('an extended rental is judged on the rental it started as', () => {
  // 30 days at 349, extended by 7 for 149: totals are days 37, price 498.
  // Judging 37 days against the single-span curve expects 430 and would call
  // this underpaid, which it is not — the two segments were each priced right.
  const r = audit.check(renter({
    days: 37, price: 498,
    extensions: [{ days: 7, amount: 149, prevDays: 30, prevPrice: 349 }]
  }), TIER);
  assert.strictEqual(r, null, 'a properly extended rental is not a finding');
});

ok('but a bad base rental is still caught underneath an extension', () => {
  const r = audit.check(renter({
    days: 37, price: 298,
    extensions: [{ days: 7, amount: 149, prevDays: 30, prevPrice: 149 }]
  }), TIER);
  assert.ok(r, 'the original week-for-a-month is still visible');
  assert.strictEqual(r.recordedDays, 30, 'audits the base, not the total');
  assert.strictEqual(r.paidPrice, 149);
  assert.strictEqual(r.shortfall, 200);
  assert.strictEqual(r.extended, true, 'flagged so the owner knows it was extended since');
});

ok('several extensions still resolve to the original base', () => {
  const r = audit.check(renter({
    days: 51, price: 447,
    extensions: [
      { days: 7, amount: 149, prevDays: 30, prevPrice: 149 },
      { days: 14, amount: 149, prevDays: 37, prevPrice: 298 }
    ]
  }), TIER);
  assert.strictEqual(r.recordedDays, 30, 'the first entry holds the original');
  assert.strictEqual(r.paidPrice, 149);
});

console.log('\nscan()');

ok('worst gap first', () => {
  const rows = audit.scan([
    renter({ id: 1, days: 14, price: 149 }),
    renter({ id: 2, days: 30, price: 149 }),
    renter({ id: 3, days: 7, price: 149 })
  ], tierFor);
  assert.deepStrictEqual(rows.map(r => r.id), [2, 1], 'id 3 is fine and absent');
});

ok('bad input does not throw', () => {
  assert.deepStrictEqual(audit.scan(null, tierFor), []);
  assert.deepStrictEqual(audit.scan([null, undefined], tierFor), []);
  assert.deepStrictEqual(audit.scan([renter()], null), []);
});

ok('a game that cannot be resolved is skipped, not crashed on', () => {
  const rows = audit.scan([renter({ days: 30, price: 149 })], () => { throw new Error('no game'); });
  assert.deepStrictEqual(rows, []);
});

ok('a null tier skips that row without skipping the rest', () => {
  const rows = audit.scan(
    [renter({ id: 1, days: 30, price: 149 }), renter({ id: 2, days: 30, price: 149 })],
    c => (c.id === 1 ? null : TIER)
  );
  assert.deepStrictEqual(rows.map(r => r.id), [2]);
});

console.log('\ndismissing a row the owner has judged');

ok('a dismissed row stops being raised', () => {
  const c = renter({ days: 30, price: 149 });
  assert.ok(audit.check(c, TIER), 'flagged before');
  c.price_audit_ok = { days: 30, price: 149, at: '2026-09-12T10:00:00Z' };
  assert.strictEqual(audit.check(c, TIER), null, 'silent after');
});

ok('the dismissal only covers the rental it was made about', () => {
  // The owner says "₱149 for 30 days was deliberate". If the rental is later
  // re-priced or re-dated, that judgement no longer applies to what is there
  // now, and the row comes back rather than staying quietly dismissed.
  const c = renter({ days: 30, price: 149, price_audit_ok: { days: 30, price: 149 } });
  assert.strictEqual(audit.check(c, TIER), null);

  c.days = 60;
  assert.ok(audit.check(c, TIER), 'a longer booking is a new question');

  const c2 = renter({ days: 30, price: 149, price_audit_ok: { days: 30, price: 149 } });
  c2.price = 100;
  assert.ok(audit.check(c2, TIER), 'a changed price is a new question');
});

ok('a bare true is honoured as permanent', () => {
  const c = renter({ days: 30, price: 149, price_audit_ok: true });
  assert.strictEqual(audit.check(c, TIER), null);
  c.days = 60;
  assert.strictEqual(audit.check(c, TIER), null, 'never re-raised at the owner');
});

ok('clearing it with null brings the row back', () => {
  // The undo route writes null rather than deleting the key, because lodash
  // unset() returns a boolean and would corrupt the lowdb write.
  const c = renter({ days: 30, price: 149, price_audit_ok: null });
  assert.ok(audit.check(c, TIER), 'null means not dismissed');
  assert.deepStrictEqual(audit.dismissedRows([c]), [], 'and it is not listed as ignored');
});

ok('junk in the field does not dismiss anything', () => {
  assert.ok(audit.check(renter({ days: 30, price: 149, price_audit_ok: 'yes' }), TIER));
  assert.ok(audit.check(renter({ days: 30, price: 149, price_audit_ok: 0 }), TIER));
});

ok('scan leaves dismissed rows out of the list and the bell', () => {
  const rows = audit.scan([
    renter({ id: 1, days: 30, price: 149 }),
    renter({ id: 2, days: 30, price: 149, price_audit_ok: { days: 30, price: 149 } })
  ], tierFor);
  assert.deepStrictEqual(rows.map(r => r.id), [1]);
});

console.log('\ndismissedRows()');

ok('lists what was ignored, so it can be undone', () => {
  const rows = audit.dismissedRows([
    renter({ id: 5, customer_name: 'Bryce', days: 30, price: 600, price_audit_ok: { days: 30, price: 600, at: '2026-09-12T10:00:00Z' } }),
    renter({ id: 6, customer_name: 'Nobody', days: 30, price: 149 })
  ]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, 5);
  assert.strictEqual(rows[0].customer_name, 'Bryce');
  assert.strictEqual(rows[0].recordedDays, 30);
  assert.strictEqual(rows[0].paidPrice, 600);
  assert.strictEqual(rows[0].at, '2026-09-12T10:00:00Z');
});

ok('a finished rental is not listed as ignored', () => {
  const rows = audit.dismissedRows([renter({ id: 7, status: 'done', price_audit_ok: true })]);
  assert.deepStrictEqual(rows, []);
});

ok('bad input does not throw', () => {
  assert.deepStrictEqual(audit.dismissedRows(null), []);
  assert.deepStrictEqual(audit.dismissedRows([null, undefined]), []);
});

console.log('\n' + passed + ' assertions passed\n');
