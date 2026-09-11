// Run: node scripts/test-extensions.js
const assert = require('assert');
const ext = require('../lib/extensions');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const TIER = { 7: 199, 30: 599 };

console.log('\nnextEnd() — where the extra days are counted from');

ok('a rental with days left keeps them: extends from its own end date', () => {
  // 3 days left, add 7 -> they get all 10. Counting from today would quietly
  // take back the days they already paid for.
  assert.strictEqual(ext.nextEnd('2026-09-14', 7, '2026-09-11'), '2026-09-21');
});

ok('an already-expired rental extends from today, not from the old date', () => {
  // Counting from an end date that has passed would hand them days that are
  // already gone — a 7-day extension bought today would expire in 3 days.
  assert.strictEqual(ext.nextEnd('2026-09-08', 7, '2026-09-11'), '2026-09-18');
});

ok('ending exactly today extends from today', () => {
  assert.strictEqual(ext.nextEnd('2026-09-11', 7, '2026-09-11'), '2026-09-18');
});

ok('a missing end date falls back to today', () => {
  assert.strictEqual(ext.nextEnd('', 7, '2026-09-11'), '2026-09-18');
  assert.strictEqual(ext.nextEnd(null, 30, '2026-09-11'), '2026-10-11');
});

ok('crossing a month and a year boundary', () => {
  assert.strictEqual(ext.nextEnd('2026-09-28', 7, '2026-09-25'), '2026-10-05');
  assert.strictEqual(ext.nextEnd('2026-12-28', 7, '2026-12-20'), '2027-01-04');
});

ok('a nonsense duration returns null rather than a wrong date', () => {
  [0, -3, null, undefined, NaN, 'abc', 1.5].forEach(d => {
    assert.strictEqual(ext.nextEnd('2026-09-14', d, '2026-09-11'), null, 'days=' + d);
  });
});

console.log('\nbuild() — the whole extension, priced and dated');

ok('prices the extra days off the same curve as a fresh rental', () => {
  const e = ext.build({ currentEnd: '2026-09-14', days: 7, today: '2026-09-11', tier: TIER });
  assert.strictEqual(e.days, 7);
  assert.strictEqual(e.amount, 199);
  assert.strictEqual(e.endDate, '2026-09-21');
  assert.strictEqual(e.prorated, false);
});

ok('a custom duration is pro-rated, same as Quick Add', () => {
  const e = ext.build({ currentEnd: '2026-09-14', days: 5, today: '2026-09-11', tier: TIER });
  assert.strictEqual(e.amount, 142);          // 199/7*5
  assert.strictEqual(e.prorated, true);
});

ok('an override wins over the computed price', () => {
  const e = ext.build({ currentEnd: '2026-09-14', days: 7, today: '2026-09-11', tier: TIER, override: 150 });
  assert.strictEqual(e.amount, 150);
  assert.strictEqual(e.overridden, true);
});

ok('an override of zero is honoured — a free extension is a real thing', () => {
  const e = ext.build({ currentEnd: '2026-09-14', days: 7, today: '2026-09-11', tier: TIER, override: 0 });
  assert.strictEqual(e.amount, 0);
  assert.strictEqual(e.overridden, true);
});

ok('no price data and no override cannot be priced', () => {
  const e = ext.build({ currentEnd: '2026-09-14', days: 7, today: '2026-09-11', tier: { 7: 0, 30: 0 } });
  assert.strictEqual(e, null);
});

ok('no price data but an override is fine', () => {
  const e = ext.build({ currentEnd: '2026-09-14', days: 7, today: '2026-09-11', tier: {}, override: 250 });
  assert.strictEqual(e.amount, 250);
  assert.strictEqual(e.endDate, '2026-09-21');
});

ok('a bad duration produces nothing at all', () => {
  assert.strictEqual(ext.build({ currentEnd: '2026-09-14', days: 0, today: '2026-09-11', tier: TIER }), null);
  assert.strictEqual(ext.build({ currentEnd: '2026-09-14', days: -1, today: '2026-09-11', tier: TIER, override: 99 }), null);
});

console.log('\nrecord() — what gets stored on the customer');

ok('carries everything the message and the history need', () => {
  const r = ext.record({
    days: 7, amount: 199, fromEnd: '2026-09-14', endDate: '2026-09-21',
    prevDays: 30, prevPrice: 599, at: '2026-09-11T02:00:00Z'
  });
  assert.strictEqual(r.days, 7);
  assert.strictEqual(r.amount, 199);
  assert.strictEqual(r.from_end_date, '2026-09-14');
  assert.strictEqual(r.end_date, '2026-09-21');
  assert.strictEqual(r.days_total, 37, 'previous days plus the extension');
  assert.strictEqual(r.price_total, 798, 'previous price plus the extension');
  assert.strictEqual(r.at, '2026-09-11T02:00:00Z');
});

ok('totals survive a customer with no prior days or price', () => {
  const r = ext.record({ days: 7, amount: 199, fromEnd: '', endDate: '2026-09-18' });
  assert.strictEqual(r.days_total, 7);
  assert.strictEqual(r.price_total, 199);
  assert.ok(r.at, 'stamps a time even when none was passed');
});

console.log('\n' + passed + ' assertions passed\n');
