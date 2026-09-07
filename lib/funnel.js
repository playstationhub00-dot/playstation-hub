// Order funnel analysis. Orders in, numbers out.
//
// Pure functions only: no database, no clock. Every measurement is read from
// the state_history each order already carries, so the same export analysed
// today and next year gives the same answer.
//
// The point of this module is not "how many orders were lost" — the app
// already shows that. It is WHERE they were lost, and HOW LONG the customer
// waited first, split by whether they were waiting on themselves or on the
// owner. Only the second of those is something the owner can fix.

// Free "Fall in Line" entries never owed money, so counting them as orders
// that failed to pay would slander a feature that is working as designed.
function paidPath(orders) {
  return (orders || []).filter(o => o && !o.is_waitlist && o.state !== 'waitlisted');
}

function history(order) {
  const h = (order && order.state_history) || [];
  if (h.length) return h;
  // Orders created before state_history existed still know where they ended up.
  if (order && order.state) return [{ state: order.state, at: order.created_at || null }];
  return [];
}

function everReached(order, state) {
  return history(order).some(h => h && h.state === state);
}

// The FIRST entry into a state. An order that was rejected and paid again
// visited verifying_payment twice; the first visit is when the customer acted.
function firstAt(order, state) {
  const row = history(order).find(h => h && h.state === state);
  return row && row.at ? row.at : null;
}

function everReachedAny(order, states) {
  return states.some(s => everReached(order, s));
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

// ── the funnel ───────────────────────────────────────────────────────────────
// Four stages, chosen because each one is a different party's decision:
//   started    the customer chose a game and a tier
//   submitted  the customer actually sent money and said so
//   confirmed  the owner checked it and let the order through
//   fulfilled  the customer got the thing they paid for
//
// Deliberately stops at "fulfilled" rather than "closed": a purchase never
// closes, and a rental closing is a month later, so including it would measure
// the calendar rather than the checkout.
const STAGES = Object.freeze([
  { key: 'started', label: 'Order started', states: null },
  { key: 'submitted', label: 'Payment submitted', states: ['verifying_payment', 'awaiting_qr', 'reserved', 'qr_pending', 'active', 'awaiting_return', 'verifying_return', 'closed'] },
  { key: 'confirmed', label: 'Payment confirmed', states: ['awaiting_qr', 'reserved', 'qr_pending', 'active', 'awaiting_return', 'verifying_return', 'closed'] },
  { key: 'fulfilled', label: 'Playing / delivered', states: ['active', 'reserved', 'awaiting_return', 'verifying_return', 'closed'] }
]);

function build(orders) {
  const rows = paidPath(orders);
  const total = rows.length;
  let prev = total;
  const stages = STAGES.map(stage => {
    const count = stage.states === null ? total : rows.filter(o => everReachedAny(o, stage.states)).length;
    const out = {
      key: stage.key,
      label: stage.label,
      count,
      pctOfStart: pct(count, total),
      pctOfPrev: pct(count, prev),
      dropped: Math.max(prev - count, 0)
    };
    prev = count;
    return out;
  });
  return { total, stages };
}

// ── where orders die ─────────────────────────────────────────────────────────
// An order is "dead" if it is sitting in a state it cannot leave on its own:
// terminal, or stalled before the money cleared. Orders still moving through
// fulfilment are not failures, they are in progress.
const DEAD_STATES = Object.freeze(['awaiting_payment', 'verifying_payment', 'payment_rejected', 'cancelled']);

function deathPoints(orders) {
  const by = {};
  paidPath(orders).forEach(o => {
    if (!DEAD_STATES.includes(o.state)) return;
    if (!by[o.state]) by[o.state] = { state: o.state, count: 0, value: 0 };
    by[o.state].count++;
    by[o.state].value += (Number(o.amount_due) || 0) + (Number(o.deposit_due) || 0);
  });
  return Object.values(by).sort((a, b) => b.count - a.count || b.value - a.value);
}

// ── timing ───────────────────────────────────────────────────────────────────
function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 10) / 10;
}

// Minutes between first entering `from` and first entering `to`, over the
// orders that made that move. Median rather than mean: one customer who paid
// three days late would drag an average somewhere no real customer lives.
function timing(orders, from, to) {
  const mins = [];
  paidPath(orders).forEach(o => {
    const a = firstAt(o, from);
    const b = firstAt(o, to);
    if (!a || !b) return;
    const delta = (Date.parse(b) - Date.parse(a)) / 60000;
    if (!isFinite(delta) || delta < 0) return;
    mins.push(delta);
  });
  return {
    n: mins.length,
    median: median(mins),
    min: mins.length ? Math.round(Math.min(...mins) * 10) / 10 : null,
    max: mins.length ? Math.round(Math.max(...mins) * 10) / 10 : null
  };
}

// The two steps where the customer is waiting on the OWNER, not the other way
// round. These are the only delays the owner can shorten, which makes them the
// only ones worth measuring separately.
function ownerWait(orders) {
  return {
    checkPayment: timing(orders, 'verifying_payment', 'awaiting_qr'),
    signIn: timing(orders, 'qr_pending', 'active')
  };
}

module.exports = {
  STAGES, DEAD_STATES,
  paidPath, history, everReached, everReachedAny, firstAt,
  build, deathPoints, timing, ownerWait, median
};
