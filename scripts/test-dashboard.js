// Plain assert-based tests for the dashboard metrics. No test framework in this
// project by design — run with `node scripts/test-dashboard.js`, which exits
// non-zero on the first failed assertion.
//
// Every function here is pure: collections in, derived numbers out. `now` is
// always injected, so a test never depends on the day it runs.
const assert = require('assert');
const dash = require('../lib/dashboard');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

const NOW = new Date('2026-09-07T12:00:00.000Z');

// ── period ranges ────────────────────────────────────────────────────────────
check('this month starts on the first and includes today', () => {
  const r = dash.periodRange('month', NOW);
  assert.strictEqual(r.from, '2026-09-01');
  assert.strictEqual(r.to, '2026-09-30');
  assert.strictEqual(r.label, 'September 2026');
});

check('three months reaches back over a month boundary', () => {
  const r = dash.periodRange('3m', NOW);
  assert.strictEqual(r.from, '2026-07-01');
  assert.strictEqual(r.to, '2026-09-30');
});

check('year covers the whole calendar year', () => {
  const r = dash.periodRange('year', NOW);
  assert.strictEqual(r.from, '2026-01-01');
  assert.strictEqual(r.to, '2026-12-31');
});

// All-time has to match everything, including rows dated before this app existed.
check('all time has no bounds', () => {
  const r = dash.periodRange('all', NOW);
  assert.strictEqual(r.from, null);
  assert.strictEqual(r.to, null);
  assert.strictEqual(dash.inPeriod('2019-01-01', r), true);
});

check('an unknown period falls back to this month rather than throwing', () => {
  assert.deepStrictEqual(dash.periodRange('nonsense', NOW), dash.periodRange('month', NOW));
});

check('inPeriod is inclusive at both ends and rejects junk dates', () => {
  const r = dash.periodRange('month', NOW);
  assert.strictEqual(dash.inPeriod('2026-09-01', r), true);
  assert.strictEqual(dash.inPeriod('2026-09-30', r), true);
  assert.strictEqual(dash.inPeriod('2026-08-31', r), false);
  assert.strictEqual(dash.inPeriod('', r), false);
  assert.strictEqual(dash.inPeriod(null, r), false);
});

// ── money ────────────────────────────────────────────────────────────────────
const CUSTOMERS = [
  { id: 1, customer_name: 'Ana Cruz', game_id: 10, game_title: 'A', status: 'done',
    payments: [{ amount: 300, date: '2026-09-02' }, { amount: 150, date: '2026-08-20' }] },
  { id: 2, customer_name: 'ana cruz', game_id: 11, game_title: 'B', status: 'renting',
    payments: [{ amount: 400, date: '2026-09-05' }] },
  { id: 3, customer_name: 'Ben Uy', game_id: 10, game_title: 'A', status: 'bought',
    payments: [{ amount: 2500, date: '2026-09-06', kind: 'purchase' }] },
  { id: 4, customer_name: 'Cara Lim', game_id: 12, game_title: 'C', status: 'done',
    payments: [{ amount: 200, date: '2026-05-01' }] }
];

check('collected sums only payments dated inside the period', () => {
  const r = dash.periodRange('month', NOW);
  const c = dash.collected(CUSTOMERS, r);
  assert.strictEqual(c.total, 3200);   // 300 + 400 + 2500
  assert.strictEqual(c.count, 3);
});

// A purchase is revenue too, but the owner needs the split to see whether
// sales are actually growing or rentals are carrying everything.
check('rentals and sales are split by the buying customer, not the payment', () => {
  const r = dash.periodRange('month', NOW);
  const s = dash.rentalVsSales(CUSTOMERS, r);
  assert.strictEqual(s.rental, 700);
  assert.strictEqual(s.sales, 2500);
  assert.strictEqual(s.rentalPct, 22);   // 700 / 3200
});

check('an empty period reports zero without dividing by zero', () => {
  const s = dash.rentalVsSales([], dash.periodRange('month', NOW));
  assert.strictEqual(s.rental, 0);
  assert.strictEqual(s.sales, 0);
  assert.strictEqual(s.rentalPct, 0);
});

// ── deposits ─────────────────────────────────────────────────────────────────
check('deposits held counts money taken that has not gone back', () => {
  const orders = [
    { state: 'active', deposit_due: 100, deposit_refunded: false },
    { state: 'closed', deposit_due: 100, deposit_refunded: false },
    { state: 'closed', deposit_due: 100, deposit_refunded: true },
    { state: 'cancelled', deposit_due: 100, deposit_refunded: false },
    { state: 'active', deposit_due: 0, deposit_refunded: false }
  ];
  const d = dash.depositsHeld(orders);
  assert.strictEqual(d.count, 2);
  assert.strictEqual(d.amount, 200);
});

// ── ad cost ──────────────────────────────────────────────────────────────────
check('ad cost per rental divides spend by rentals started', () => {
  const logs = [{ key: '2026-09', ad_spend: 500 }, { key: '2026-08', ad_spend: 900 }];
  const a = dash.adCost(logs, dash.periodRange('month', NOW), 20);
  assert.strictEqual(a.spend, 500);
  assert.strictEqual(a.perRental, 25);
});

check('ad cost with no rentals reports spend but no per-rental figure', () => {
  const a = dash.adCost([{ key: '2026-09', ad_spend: 500 }], dash.periodRange('month', NOW), 0);
  assert.strictEqual(a.spend, 500);
  assert.strictEqual(a.perRental, null);
});

// ── payment mix ──────────────────────────────────────────────────────────────
check('payment mix groups paid orders by method, biggest first', () => {
  const orders = [
    { state: 'active', payment_method: 'gcash', amount_due: 300, deposit_due: 100, created_at: '2026-09-02T00:00:00Z' },
    { state: 'closed', payment_method: 'gcash', amount_due: 300, deposit_due: 0, created_at: '2026-09-03T00:00:00Z' },
    { state: 'active', payment_method: 'qrph', amount_due: 500, deposit_due: 0, created_at: '2026-09-04T00:00:00Z' },
    { state: 'awaiting_payment', payment_method: 'maya', amount_due: 900, deposit_due: 0, created_at: '2026-09-04T00:00:00Z' },
    { state: 'active', payment_method: null, amount_due: 100, deposit_due: 0, created_at: '2026-09-04T00:00:00Z' }
  ];
  const mix = dash.paymentMix(orders, dash.periodRange('month', NOW));
  assert.strictEqual(mix.length, 3);
  assert.strictEqual(mix[0].method, 'gcash');
  assert.strictEqual(mix[0].count, 2);
  assert.strictEqual(mix[0].amount, 700);
  // An unpaid order is not a payment method anyone chose to pay with.
  assert.ok(!mix.some(m => m.method === 'maya'));
  // A paid order with no method recorded still has to be visible somewhere.
  assert.ok(mix.some(m => m.method === 'unrecorded'));
});

// ── slots ────────────────────────────────────────────────────────────────────
check('slot utilisation counts only enabled slots', () => {
  const accounts = [
    { slots: { trophy: { enabled: true, status: 'rented' }, non_trophy: { enabled: true, status: 'open' }, ps4_primary: { enabled: false, status: 'open' } } },
    { slots: { trophy: { enabled: true, status: 'buyed' }, non_trophy: { enabled: true, status: 'open' }, ps4_primary: { enabled: true, status: 'maintenance' } } }
  ];
  const u = dash.slotUtilisation(accounts);
  assert.strictEqual(u.total, 5);
  assert.strictEqual(u.filled, 2);   // rented + buyed
  assert.strictEqual(u.idle, 2);     // the two open ones
  assert.strictEqual(u.pct, 40);
});

check('no accounts yields zeroes, not NaN', () => {
  const u = dash.slotUtilisation([]);
  assert.strictEqual(u.total, 0);
  assert.strictEqual(u.pct, 0);
});

// ── payback ──────────────────────────────────────────────────────────────────
const GAMES = [
  { id: 10, title: 'A', cost: 1000 },
  { id: 11, title: 'B', cost: 500 },
  { id: 12, title: 'C', cost: 0 },
  { id: 13, title: 'D' }
];

// Matched on game_id: a renamed game must keep its earnings history.
check('payback divides lifetime revenue by the recorded cost', () => {
  const p = dash.gamePayback(GAMES, CUSTOMERS);
  const a = p.rows.find(r => r.id === 10);
  assert.strictEqual(a.revenue, 2950);          // 300 + 150 + 2500
  assert.strictEqual(a.cost, 1000);
  assert.strictEqual(a.multiple, 2.95);
  const b = p.rows.find(r => r.id === 11);
  assert.strictEqual(b.multiple, 0.8);          // 400 / 500
});

check('games with no cost are excluded and counted separately', () => {
  const p = dash.gamePayback(GAMES, CUSTOMERS);
  assert.strictEqual(p.rows.length, 2);
  assert.strictEqual(p.missingCost, 2);         // C has cost 0, D has none
  assert.ok(!p.rows.some(r => r.id === 12 || r.id === 13));
});

check('payback is ordered worst first, because that is the one to act on', () => {
  const p = dash.gamePayback(GAMES, CUSTOMERS);
  assert.strictEqual(p.rows[0].id, 11);
});

// ── customers ────────────────────────────────────────────────────────────────
check('repeat rate folds names case-insensitively', () => {
  const r = dash.repeatRate(CUSTOMERS);
  assert.strictEqual(r.unique, 3);      // ana cruz twice, ben, cara
  assert.strictEqual(r.repeat, 1);
  assert.strictEqual(r.pct, 33);
});

check('repeat rate on an empty list does not divide by zero', () => {
  assert.strictEqual(dash.repeatRate([]).pct, 0);
});

check('top spenders sum every payment for one person', () => {
  const t = dash.topSpenders(CUSTOMERS, dash.periodRange('all', NOW), 2);
  assert.strictEqual(t.length, 2);
  assert.strictEqual(t[0].name, 'Ben Uy');
  assert.strictEqual(t[0].total, 2500);
  assert.strictEqual(t[1].total, 850);   // Ana's 300 + 150 + 400
});

check('dormant lists people whose last payment is older than the cutoff', () => {
  const d = dash.dormant(CUSTOMERS, 60, NOW);
  // Cara last paid 2026-05-01, well past 60 days; Ana and Ben paid this month.
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].name, 'Cara Lim');
  assert.ok(d[0].daysSince > 60);
});

// ── reviews ──────────────────────────────────────────────────────────────────
check('review stats average only what is published, and count what is not', () => {
  const reviews = [
    { rating: 5, visible: true }, { rating: 4, visible: true },
    { rating: 1, visible: false }, { rating: 5, visible: false }
  ];
  const r = dash.reviewStats(reviews);
  assert.strictEqual(r.avg, 4.5);
  assert.strictEqual(r.count, 2);
  assert.strictEqual(r.pending, 2);
});

check('no reviews reports null average rather than zero stars', () => {
  const r = dash.reviewStats([]);
  assert.strictEqual(r.avg, null);
  assert.strictEqual(r.count, 0);
});

// ── most rented ──────────────────────────────────────────────────────────────
check('most rented counts rentals started in the period, biggest first', () => {
  const dated = CUSTOMERS.map(c => Object.assign({ start_date: '2026-09-03' }, c));
  const t = dash.topRented(dated, dash.periodRange('month', NOW), 5);
  assert.strictEqual(t[0][0], 'A');
  assert.strictEqual(t[0][1], 2);
});

// Real records do go without a start date. All-time must still see them, or the
// chart quietly disagrees with the customer list underneath it.
check('all time counts undated rentals; a bounded period cannot place them', () => {
  const undated = [{ game_title: 'A' }, { game_title: 'A' }, { game_title: 'B' }];
  const all = dash.topRented(undated, dash.periodRange('all', NOW), 5);
  assert.deepStrictEqual(all[0], ['A', 2]);
  assert.strictEqual(dash.topRented(undated, dash.periodRange('month', NOW), 5).length, 0);
});

// ── prior period ─────────────────────────────────────────────────────────────
// A trend arrow needs the equivalent window immediately before the current one:
// this month vs last month, this year vs last year.
check('prior period for a month is the whole previous month', () => {
  const cur = dash.periodRange('month', NOW);
  const prev = dash.priorPeriodRange(cur);
  assert.strictEqual(prev.from, '2026-08-01');
  assert.strictEqual(prev.to, '2026-08-31');
  assert.strictEqual(prev.label, 'August 2026');
});

check('prior period for three months is the three months before that', () => {
  const cur = dash.periodRange('3m', NOW);   // 2026-07-01 .. 2026-09-30
  const prev = dash.priorPeriodRange(cur);
  assert.strictEqual(prev.from, '2026-04-01');
  assert.strictEqual(prev.to, '2026-06-30');
});

check('prior period for a year is the previous calendar year', () => {
  const prev = dash.priorPeriodRange(dash.periodRange('year', NOW));
  assert.strictEqual(prev.from, '2025-01-01');
  assert.strictEqual(prev.to, '2025-12-31');
});

// "All time" has no window, so it has no "before" — a trend arrow makes no sense.
check('all time has no prior period', () => {
  assert.strictEqual(dash.priorPeriodRange(dash.periodRange('all', NOW)), null);
});

// ── trend ────────────────────────────────────────────────────────────────────
check('trend is the percent change, with direction, guarding divide-by-zero', () => {
  assert.deepStrictEqual(dash.trend(120, 100), { pct: 20, dir: 'up' });
  assert.deepStrictEqual(dash.trend(80, 100), { pct: 20, dir: 'down' });
  assert.deepStrictEqual(dash.trend(100, 100), { pct: 0, dir: 'flat' });
  // From nothing to something is a rise, but "∞%" is not a useful number.
  assert.deepStrictEqual(dash.trend(50, 0), { pct: null, dir: 'up' });
  assert.deepStrictEqual(dash.trend(0, 0), { pct: 0, dir: 'flat' });
});

// ── recent activity ──────────────────────────────────────────────────────────
const ACT_ORDERS = [
  { ref: 'PH-1', fb_name: 'Ana Cruz', game_title: 'A', state: 'active',
    state_history: [
      { state: 'awaiting_payment', at: '2026-09-09T10:00:00.000Z' },
      { state: 'verifying_payment', at: '2026-09-09T10:05:00.000Z' },
      { state: 'awaiting_qr', at: '2026-09-09T10:20:00.000Z' },
      { state: 'active', at: '2026-09-09T10:30:00.000Z' }
    ] },
  { ref: 'PH-2', fb_name: 'Ben Uy', game_title: 'B', state: 'verifying_payment',
    state_history: [
      { state: 'awaiting_payment', at: '2026-09-10T08:00:00.000Z' },
      { state: 'verifying_payment', at: '2026-09-10T08:15:00.000Z' }
    ] },
  // No history at all — should still surface as one item at its created time.
  { ref: 'PH-3', fb_name: 'Cara Lim', game_title: 'C', state: 'closed', created_at: '2026-09-08T12:00:00.000Z' }
];

check('recent activity is newest-first across all orders, capped at the limit', () => {
  // Five items total: PH-1 x3 (verify/qr/active), PH-2 x1, PH-3 x1.
  const all = dash.recentActivity(ACT_ORDERS, 20);
  assert.strictEqual(all.length, 5);
  assert.strictEqual(all[0].ref, 'PH-2');           // 2026-09-10 08:15 is newest
  assert.strictEqual(all[0].state, 'verifying_payment');
  assert.strictEqual(all[all.length - 1].ref, 'PH-3'); // 2026-09-08 is oldest
  assert.strictEqual(dash.recentActivity(ACT_ORDERS, 3).length, 3);
});

check('recent activity skips the very first awaiting_payment — it is just "order started"', () => {
  const a = dash.recentActivity(ACT_ORDERS, 20);
  const firstSteps = a.filter(x => x.ref === 'PH-1' && x.state === 'awaiting_payment');
  assert.strictEqual(firstSteps.length, 0);
});

check('recent activity carries a human label, ref, name and time for each item', () => {
  const a = dash.recentActivity(ACT_ORDERS, 1);
  assert.strictEqual(a[0].ref, 'PH-2');
  assert.strictEqual(a[0].name, 'Ben Uy');
  assert.strictEqual(a[0].game, 'B');
  assert.strictEqual(typeof a[0].label, 'string');
  assert.ok(a[0].label.length > 0);
  assert.strictEqual(a[0].at, '2026-09-10T08:15:00.000Z');
});

check('recent activity on no orders is an empty list, not a throw', () => {
  assert.deepStrictEqual(dash.recentActivity([], 5), []);
  assert.deepStrictEqual(dash.recentActivity(null, 5), []);
});

// ── accounts slot use ────────────────────────────────────────────────────────
check('accounts slot use reports fill per account, worst first', () => {
  const accounts = [
    { id: 1, label: 'Full One', slots: { trophy: { enabled: true, status: 'rented' }, non_trophy: { enabled: true, status: 'buyed' }, ps4_primary: { enabled: false, status: 'open' } } },
    { id: 2, label: 'Half One', slots: { trophy: { enabled: true, status: 'rented' }, non_trophy: { enabled: true, status: 'open' }, ps4_primary: { enabled: true, status: 'open' } } },
    { id: 3, label: 'Empty One', slots: { trophy: { enabled: true, status: 'open' }, non_trophy: { enabled: true, status: 'open' }, ps4_primary: { enabled: true, status: 'maintenance' } } }
  ];
  const rows = dash.accountsSlotUse(accounts);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].label, 'Empty One');   // 0 of 3 -> worst
  assert.strictEqual(rows[0].filled, 0);
  assert.strictEqual(rows[0].total, 3);
  assert.strictEqual(rows[1].label, 'Half One');
  assert.strictEqual(rows[1].idle, 2);
  assert.strictEqual(rows[2].label, 'Full One');
  assert.strictEqual(rows[2].filled, 2);
  assert.strictEqual(rows[2].total, 2);             // disabled slot not counted
});

console.log('\n' + passed + ' assertions passed');
