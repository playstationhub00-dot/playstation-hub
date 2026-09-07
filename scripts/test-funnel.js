// Plain assert-based tests for the order funnel analysis. No test framework in
// this project by design — run with `node scripts/test-funnel.js`.
//
// Every function is pure: orders in, numbers out. Time is read only from the
// state_history each order carries, never from the clock, so a run today and a
// run next month over the same export give identical answers.
const assert = require('assert');
const funnel = require('../lib/funnel');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

// A helper that builds an order the way the app does: a history of states with
// timestamps, in order.
function order(ref, steps, extra) {
  let t = Date.parse('2026-09-01T10:00:00.000Z');
  const history = steps.map(([state, gapMin]) => {
    t += (gapMin || 0) * 60000;
    return { state, at: new Date(t).toISOString() };
  });
  return Object.assign({
    ref,
    state: history[history.length - 1].state,
    state_history: history,
    created_at: history[0].at,
    amount_due: 450, deposit_due: 100
  }, extra || {});
}

// ── reaching a state ─────────────────────────────────────────────────────────
check('an order that reached a state is detected from its history', () => {
  const o = order('A', [['awaiting_payment', 0], ['verifying_payment', 3], ['awaiting_qr', 20]]);
  assert.strictEqual(funnel.everReached(o, 'verifying_payment'), true);
  assert.strictEqual(funnel.everReached(o, 'active'), false);
});

// An order can bounce back — rejected, then paid properly. Reaching a state
// once is what counts, not where it ended up.
check('a state reached then left still counts as reached', () => {
  const o = order('B', [['awaiting_payment', 0], ['verifying_payment', 2], ['payment_rejected', 30], ['awaiting_payment', 1], ['verifying_payment', 5], ['awaiting_qr', 4]]);
  assert.strictEqual(funnel.everReached(o, 'payment_rejected'), true);
  assert.strictEqual(funnel.everReached(o, 'awaiting_qr'), true);
});

// Orders predating state_history must not silently count as "never reached".
check('an order with no history falls back to its current state', () => {
  const o = { ref: 'C', state: 'active', created_at: '2026-09-01T10:00:00.000Z' };
  assert.strictEqual(funnel.everReached(o, 'active'), true);
  assert.strictEqual(funnel.everReached(o, 'closed'), false);
});

check('the first time a state was entered is the one that counts', () => {
  const o = order('D', [['awaiting_payment', 0], ['verifying_payment', 2], ['payment_rejected', 30], ['verifying_payment', 10]]);
  assert.strictEqual(funnel.firstAt(o, 'verifying_payment'), '2026-09-01T10:02:00.000Z');
  assert.strictEqual(funnel.firstAt(o, 'closed'), null);
});

// ── the funnel ───────────────────────────────────────────────────────────────
const ORDERS = [
  // paid and completed
  order('PH-1', [['awaiting_payment', 0], ['verifying_payment', 4], ['awaiting_qr', 12], ['qr_pending', 6], ['active', 8], ['awaiting_return', 100], ['verifying_return', 20], ['closed', 30]]),
  // paid, still out
  order('PH-2', [['awaiting_payment', 0], ['verifying_payment', 9], ['awaiting_qr', 40], ['qr_pending', 5], ['active', 3]]),
  // submitted proof, owner never cleared it
  order('PH-3', [['awaiting_payment', 0], ['verifying_payment', 6]]),
  // never paid at all
  order('PH-4', [['awaiting_payment', 0]]),
  order('PH-5', [['awaiting_payment', 0]]),
  // cancelled before paying
  order('PH-6', [['awaiting_payment', 0], ['cancelled', 200]]),
  // free waitlist entry — not part of the paid path
  order('PH-7', [['waitlisted', 0]], { is_waitlist: true })
];

check('the funnel counts each stage and excludes free waitlist entries', () => {
  const f = funnel.build(ORDERS);
  const by = {};
  f.stages.forEach(s => { by[s.key] = s; });
  assert.strictEqual(f.total, 6);              // PH-7 excluded
  assert.strictEqual(by.started.count, 6);
  assert.strictEqual(by.submitted.count, 3);   // PH-1, 2, 3
  assert.strictEqual(by.confirmed.count, 2);   // PH-1, 2
  assert.strictEqual(by.fulfilled.count, 2);
});

check('each stage reports its share of the start and of the stage before it', () => {
  const f = funnel.build(ORDERS);
  const submitted = f.stages.find(s => s.key === 'submitted');
  assert.strictEqual(submitted.pctOfStart, 50);   // 3 of 6
  assert.strictEqual(submitted.pctOfPrev, 50);
  const confirmed = f.stages.find(s => s.key === 'confirmed');
  assert.strictEqual(confirmed.pctOfStart, 33);   // 2 of 6
  assert.strictEqual(confirmed.pctOfPrev, 67);    // 2 of 3
});

check('drop-off is the count lost at each step', () => {
  const f = funnel.build(ORDERS);
  assert.strictEqual(f.stages.find(s => s.key === 'submitted').dropped, 3);
  assert.strictEqual(f.stages.find(s => s.key === 'confirmed').dropped, 1);
});

check('an empty order list produces zeroes rather than NaN', () => {
  const f = funnel.build([]);
  assert.strictEqual(f.total, 0);
  assert.strictEqual(f.stages[0].pctOfStart, 0);
});

// ── where orders die ─────────────────────────────────────────────────────────
// The point of the whole exercise: not that orders are lost, but exactly where.
check('stalled orders are grouped by the state they are stuck in', () => {
  const d = funnel.deathPoints(ORDERS);
  const by = {};
  d.forEach(r => { by[r.state] = r; });
  assert.strictEqual(by.awaiting_payment.count, 2);   // PH-4, PH-5
  assert.strictEqual(by.verifying_payment.count, 1);  // PH-3
  assert.strictEqual(by.cancelled.count, 1);          // PH-6
  // Orders that are progressing or finished are not deaths.
  assert.ok(!by.closed);
  assert.ok(!by.active);
});

check('death points are ordered worst first', () => {
  const d = funnel.deathPoints(ORDERS);
  assert.strictEqual(d[0].state, 'awaiting_payment');
});

// ── timing ───────────────────────────────────────────────────────────────────
// Median, not mean: one order paid three days late would drag an average into
// uselessness, and the question is what a typical customer does.
check('median minutes between two states, over the orders that made it', () => {
  const t = funnel.timing(ORDERS, 'awaiting_payment', 'verifying_payment');
  assert.strictEqual(t.n, 3);          // PH-1 (4), PH-2 (9), PH-3 (6)
  assert.strictEqual(t.median, 6);
  assert.strictEqual(t.min, 4);
  assert.strictEqual(t.max, 9);
});

check('timing ignores orders that never made the transition', () => {
  const t = funnel.timing(ORDERS, 'qr_pending', 'active');
  assert.strictEqual(t.n, 2);
  assert.strictEqual(t.median, 5.5);   // PH-1 (8), PH-2 (3) -> median of two is their mean
});

check('a transition nobody made reports n=0 and no median', () => {
  const t = funnel.timing(ORDERS, 'closed', 'active');
  assert.strictEqual(t.n, 0);
  assert.strictEqual(t.median, null);
});

// The owner is a step in their own funnel. Separating "waiting on the customer"
// from "waiting on me" is what turns this from a report into a decision.
check('owner latency measures only the steps the owner controls', () => {
  const w = funnel.ownerWait(ORDERS);
  // verifying_payment -> awaiting_qr : PH-1 waited 12, PH-2 waited 40
  assert.strictEqual(w.checkPayment.n, 2);
  assert.strictEqual(w.checkPayment.median, 26);
  // qr_pending -> active : PH-1 8, PH-2 3
  assert.strictEqual(w.signIn.n, 2);
});

console.log('\n' + passed + ' assertions passed');
