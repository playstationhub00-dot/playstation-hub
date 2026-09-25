// Run: node scripts/test-accounts-view.js
//
// The Accounts tab's slot logic: which slots are urgent, what their pill says,
// and the stat-card counts. Pure, so every boundary is checked here rather
// than by clicking through the admin panel.
const assert = require('assert');
const av = require('../lib/accounts-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const TODAY = '2026-09-25';
function slot(status, end, extra) {
  return Object.assign({ enabled: true, status, renter_id: null, renter_name: '', start: '', end: end || '' }, extra || {});
}
function account(id, label, slots) {
  const slotView = {};
  ['trophy', 'non_trophy', 'ps4_primary'].forEach(t => {
    slotView[t] = av.decorateSlot(slots[t] || slot('open', '', { enabled: false }), TODAY);
  });
  return { id, label, slotView };
}

console.log('\ndaysUntil()');

ok('0 on the end date itself, 1 the day before, -1 the day after', () => {
  assert.strictEqual(av.daysUntil('2026-09-25', TODAY), 0);
  assert.strictEqual(av.daysUntil('2026-09-26', TODAY), 1);
  assert.strictEqual(av.daysUntil('2026-09-24', TODAY), -1);
});

ok('crosses a month boundary', () => {
  assert.strictEqual(av.daysUntil('2026-10-02', TODAY), 7);
});

ok('null for a missing or malformed date', () => {
  assert.strictEqual(av.daysUntil('', TODAY), null);
  assert.strictEqual(av.daysUntil('26/09/2026', TODAY), null);
  assert.strictEqual(av.daysUntil('2026-09-26', ''), null);
});

console.log('\ndecorateSlot() — due state, urgency, pill');

ok('overdue vs ending boundary at -1, 0, 3, 4', () => {
  const d = end => av.decorateSlot(slot('rented', end), TODAY);
  assert.strictEqual(d('2026-09-24').due, 'overdue');
  assert.strictEqual(d('2026-09-25').due, 'ending');
  assert.strictEqual(d('2026-09-28').due, 'ending');
  assert.strictEqual(d('2026-09-29').due, '');
});

ok('pill text for each rented case', () => {
  const p = end => av.decorateSlot(slot('rented', end), TODAY).pill;
  assert.strictEqual(p('2026-09-23'), 'OVERDUE 2d');
  assert.strictEqual(p('2026-09-25'), 'ENDS TODAY');
  assert.strictEqual(p('2026-09-26'), '1d left');
  assert.strictEqual(p('2026-10-05'), '10d left');
  assert.strictEqual(p(''), 'RENTED');
});

ok('non-rented pills use the status name, and buyed reads BOUGHT', () => {
  assert.strictEqual(av.decorateSlot(slot('open'), TODAY).pill, 'OPEN');
  assert.strictEqual(av.decorateSlot(slot('buyed'), TODAY).pill, 'BOUGHT');
  assert.strictEqual(av.decorateSlot(slot('maintenance'), TODAY).pill, 'MAINTENANCE');
  assert.strictEqual(av.decorateSlot(slot('na'), TODAY).pill, 'NOT AVAILABLE');
});

ok('an end date left on a non-rented slot does not make it due', () => {
  const s = av.decorateSlot(slot('open', '2026-09-20'), TODAY);
  assert.strictEqual(s.days_left, null);
  assert.strictEqual(s.due, '');
});

ok('urgency bucket for every status', () => {
  const u = (st, end) => av.decorateSlot(slot(st, end), TODAY).urgency;
  assert.strictEqual(u('rented', '2026-09-24'), 1);
  assert.strictEqual(u('rented', '2026-09-30'), 2);
  assert.strictEqual(u('rented', ''), 3);
  assert.strictEqual(u('open'), 4);
  assert.strictEqual(u('buyed'), 5);
  assert.strictEqual(u('maintenance'), 6);
  assert.strictEqual(u('na'), 7);
});

ok('does not mutate the stored slot', () => {
  const raw = slot('rented', '2026-09-24');
  av.decorateSlot(raw, TODAY);
  assert.strictEqual(raw.due, undefined);
  assert.strictEqual(raw.pill, undefined);
  assert.strictEqual(raw.days_left, undefined);
});

console.log('\nflattenSlots() — urgency order');

const fixture = [
  account(1, 'Zeta Pack', { trophy: slot('open'), non_trophy: slot('rented', '2026-09-27', { renter_name: 'Ben' }), ps4_primary: slot('na') }),
  account(2, 'Alpha Pack', { trophy: slot('rented', '2026-09-22', { renter_name: 'Ana' }), non_trophy: slot('open'), ps4_primary: slot('buyed') }),
  account(3, 'Mid Pack', { trophy: slot('rented', ''), non_trophy: slot('maintenance'), ps4_primary: slot('rented', '2026-09-26') }),
  account(4, 'Off Pack', {})
];

ok('overdue, then soonest ending, then undated rentals, then open/bought/maintenance/na', () => {
  const rows = av.flattenSlots(fixture);
  assert.deepStrictEqual(rows.map(r => r.account_label + ':' + r.type), [
    'Alpha Pack:trophy',
    'Mid Pack:ps4_primary',
    'Zeta Pack:non_trophy',
    'Mid Pack:trophy',
    'Alpha Pack:non_trophy',
    'Zeta Pack:trophy',
    'Alpha Pack:ps4_primary',
    'Mid Pack:non_trophy',
    'Zeta Pack:ps4_primary'
  ]);
});

ok('disabled slots are left out entirely', () => {
  const rows = av.flattenSlots(fixture);
  assert.ok(!rows.some(r => r.account_id === 4));
  assert.strictEqual(rows.length, 9);
});

ok('ties on label fall back to slot type order, then account id', () => {
  const twins = [
    account(8, 'Same', { non_trophy: slot('open'), trophy: slot('open') }),
    account(7, 'Same', { trophy: slot('open') })
  ];
  assert.deepStrictEqual(av.flattenSlots(twins).map(r => r.account_id + ':' + r.type),
    ['7:trophy', '8:trophy', '8:non_trophy']);
});

ok('rows carry what the template renders', () => {
  const row = av.flattenSlots(fixture)[0];
  assert.strictEqual(row.account_id, 2);
  assert.strictEqual(row.account_label, 'Alpha Pack');
  assert.strictEqual(row.renter_name, 'Ana');
  assert.strictEqual(row.end, '2026-09-22');
  assert.strictEqual(row.pill, 'OVERDUE 3d');
  assert.strictEqual(row.due, 'overdue');
  assert.strictEqual(row.enabled, true);
});

ok('empty or missing input is an empty list', () => {
  assert.deepStrictEqual(av.flattenSlots([]), []);
  assert.deepStrictEqual(av.flattenSlots(null), []);
});

console.log('\nslotStats()');

ok('counts enabled slots only, with ending and overdue disjoint', () => {
  assert.deepStrictEqual(av.slotStats(fixture), { total: 9, open: 2, rented: 4, ending: 2, overdue: 1 });
});

ok('rented still includes the ending and overdue ones', () => {
  const s = av.slotStats(fixture);
  assert.ok(s.rented >= s.ending + s.overdue);
});

ok('no accounts is all zeroes', () => {
  assert.deepStrictEqual(av.slotStats([]), { total: 0, open: 0, rented: 0, ending: 0, overdue: 0 });
  assert.deepStrictEqual(av.slotStats(null), { total: 0, open: 0, rented: 0, ending: 0, overdue: 0 });
});

console.log('\n' + passed + ' assertions passed\n');
