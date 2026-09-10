// Dashboard metrics. Collections in, derived numbers out.
//
// Pure functions only: no database, no environment, no reading the clock. The
// caller passes `now` where a date matters, which is what lets every number
// here be asserted exactly in scripts/test-dashboard.js without a database or
// a fixed system time.
//
// Money is attributed by PAYMENT date, not by when the rental started. An
// extension paid in September belongs to September even if the rental began in
// June — the owner is asking "what came in this month", not "what did I sign
// up this month". The orders ledger already groups this way.

// ── periods ──────────────────────────────────────────────────────────────────
const PERIODS = Object.freeze(['month', '3m', 'year', 'all']);

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
function lastDayOfMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// An unknown value falls back to the month rather than throwing: this comes
// straight off a query string, so a stale bookmark must not break the page.
function periodRange(period, now) {
  const d = now instanceof Date ? now : new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (period === 'all') return { key: 'all', from: null, to: null, label: 'All time' };
  if (period === 'year') {
    return { key: 'year', from: ymd(y, 1, 1), to: ymd(y, 12, 31), label: String(y) };
  }
  if (period === '3m') {
    const start = new Date(Date.UTC(y, d.getMonth() - 2, 1));
    return {
      key: '3m',
      from: ymd(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
      to: ymd(y, m, lastDayOfMonth(y, m)),
      label: 'Last 3 months'
    };
  }
  return {
    key: 'month',
    from: ymd(y, m, 1),
    to: ymd(y, m, lastDayOfMonth(y, m)),
    label: MONTH_NAMES[m - 1] + ' ' + y
  };
}

// Dates are compared as YYYY-MM-DD strings, which sort correctly and sidestep
// timezone drift entirely — the stored values are already day-resolution.
function inPeriod(dateish, range) {
  if (!range) return false;
  const s = String(dateish || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  if (range.from && s < range.from) return false;
  if (range.to && s > range.to) return false;
  return true;
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

// ── money ────────────────────────────────────────────────────────────────────
function eachPayment(customers, range, fn) {
  (customers || []).forEach(c => {
    ((c && c.payments) || []).forEach(p => {
      if (p && inPeriod(p.date, range)) fn(p, c);
    });
  });
}

function collected(customers, range) {
  let total = 0, count = 0;
  eachPayment(customers, range, p => { total += Number(p.amount) || 0; count++; });
  return { total, count };
}

// Split by the customer's status rather than the payment's own kind: a
// purchase's deposit or top-up should land on the same side of the line as the
// purchase itself.
function rentalVsSales(customers, range) {
  let rental = 0, sales = 0;
  eachPayment(customers, range, (p, c) => {
    const amt = Number(p.amount) || 0;
    if (c.status === 'bought') sales += amt; else rental += amt;
  });
  return { rental, sales, rentalPct: pct(rental, rental + sales) };
}

// Money taken that has not gone back. Cancelled and rejected orders never
// collected anything, so they cannot be holding a deposit.
const DEPOSIT_DEAD_STATES = Object.freeze(['cancelled', 'payment_rejected', 'awaiting_payment', 'verifying_payment']);
function depositsHeld(orders) {
  let amount = 0, count = 0;
  (orders || []).forEach(o => {
    if (!o || o.deposit_refunded) return;
    if (DEPOSIT_DEAD_STATES.includes(o.state)) return;
    const due = Number(o.deposit_due) || 0;
    if (due <= 0) return;
    amount += due; count++;
  });
  return { amount, count };
}

function adCost(monthLogs, range, rentalCount) {
  let spend = 0;
  (monthLogs || []).forEach(l => {
    // A month log is keyed YYYY-MM; treat it as its first day for the range test.
    if (l && inPeriod(String(l.key || '') + '-01', range)) spend += Number(l.ad_spend) || 0;
  });
  return { spend, perRental: rentalCount > 0 ? Math.round(spend / rentalCount) : null };
}

// Which channels the money actually arrived through. Only orders that got paid
// count — an abandoned order names a method nobody paid with.
const UNPAID_STATES = Object.freeze(['awaiting_payment', 'verifying_payment', 'payment_rejected', 'cancelled']);
function paymentMix(orders, range) {
  const by = {};
  (orders || []).forEach(o => {
    if (!o || UNPAID_STATES.includes(o.state)) return;
    if (!inPeriod(o.created_at, range)) return;
    // A paid order with no method recorded is still money in; hiding it would
    // make the mix add up to less than the period's takings.
    const key = String(o.payment_method || '').trim().toLowerCase() || 'unrecorded';
    if (!by[key]) by[key] = { method: key, count: 0, amount: 0 };
    by[key].count++;
    by[key].amount += (Number(o.amount_due) || 0) + (Number(o.deposit_due) || 0);
  });
  return Object.values(by).sort((a, b) => b.count - a.count || b.amount - a.amount);
}

// ── stock ────────────────────────────────────────────────────────────────────
const SLOT_TYPES = Object.freeze(['trophy', 'non_trophy', 'ps4_primary']);
const FILLED_STATUSES = Object.freeze(['rented', 'buyed']);

// Idle is deliberately narrower than "not filled": a slot under maintenance or
// marked unavailable is not capacity going to waste, it is capacity withdrawn.
function slotUtilisation(accounts) {
  let total = 0, filled = 0, idle = 0;
  (accounts || []).forEach(a => {
    SLOT_TYPES.forEach(t => {
      const s = a && a.slots && a.slots[t];
      if (!s || !s.enabled) return;
      total++;
      if (FILLED_STATUSES.includes(s.status)) filled++;
      else if (s.status === 'open') idle++;
    });
  });
  return { total, filled, idle, pct: pct(filled, total) };
}

// Lifetime revenue per game against what the game cost to buy.
//
// Matched on game_id, never on title: titles get corrected and reformatted, and
// a rename must not orphan a game's earnings. Games with no cost recorded are
// counted, not guessed at — a payback figure invented from a missing cost would
// be worse than no figure.
function gamePayback(games, customers) {
  const revenue = {};
  (customers || []).forEach(c => {
    if (!c || c.game_id == null) return;
    const id = c.game_id;
    const sum = ((c.payments) || []).reduce((s, p) => s + (Number(p && p.amount) || 0), 0);
    revenue[id] = (revenue[id] || 0) + sum;
  });

  const rows = [];
  let missingCost = 0;
  (games || []).forEach(g => {
    const cost = Number(g && g.cost) || 0;
    if (cost <= 0) { missingCost++; return; }
    const earned = revenue[g.id] || 0;
    rows.push({
      id: g.id,
      title: g.title,
      cost,
      revenue: earned,
      // Two decimals: the difference between 0.94x and 1.02x is the difference
      // between a game that has paid for itself and one that has not.
      multiple: Math.round((earned / cost) * 100) / 100
    });
  });
  // Worst first: the games that have not earned their cost back are the ones
  // worth a decision.
  rows.sort((a, b) => a.multiple - b.multiple);
  return { rows, missingCost };
}

function topRented(customers, range, limit) {
  const counts = {};
  // An all-time view counts undated rows too. Real records do go without a
  // start date, and silently dropping them would make "most rented, all time"
  // quietly disagree with the customer list. A bounded period cannot place
  // them, so there it excludes them rather than guessing a month.
  const unbounded = !!range && !range.from && !range.to;
  (customers || []).forEach(c => {
    if (!c || !c.game_title) return;
    const when = c.start_date || c.created_at;
    if (!unbounded && !inPeriod(when, range)) return;
    counts[c.game_title] = (counts[c.game_title] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit || 5);
}

// ── customers ────────────────────────────────────────────────────────────────
// Names are typed by hand, so this folds case and whitespace and is still only
// as good as the typing. Every caller labels it as such.
function nameKey(name) { return String(name || '').trim().toLowerCase().replace(/\s+/g, ' '); }

function groupByName(customers) {
  const by = {};
  (customers || []).forEach(c => {
    const k = nameKey(c && c.customer_name);
    if (!k) return;
    (by[k] = by[k] || []).push(c);
  });
  return by;
}

function repeatRate(customers) {
  const by = groupByName(customers);
  const keys = Object.keys(by);
  const repeat = keys.filter(k => by[k].length > 1).length;
  return { unique: keys.length, repeat, pct: pct(repeat, keys.length) };
}

function topSpenders(customers, range, limit) {
  const by = groupByName(customers);
  const rows = Object.keys(by).map(k => {
    let total = 0;
    by[k].forEach(c => {
      ((c.payments) || []).forEach(p => {
        if (p && inPeriod(p.date, range)) total += Number(p.amount) || 0;
      });
    });
    // Display the name as it was most recently typed rather than the folded key.
    return { name: by[k][by[k].length - 1].customer_name, rentals: by[k].length, total };
  });
  return rows.filter(r => r.total > 0).sort((a, b) => b.total - a.total).slice(0, limit || 5);
}

// People who used to pay and have stopped. Anyone who has never paid at all is
// not dormant, they are a record with no money attached — a different problem.
function dormant(customers, days, now) {
  const ref = now instanceof Date ? now : new Date();
  const by = groupByName(customers);
  const out = [];
  Object.keys(by).forEach(k => {
    let last = '';
    by[k].forEach(c => {
      ((c.payments) || []).forEach(p => {
        const d = String((p && p.date) || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > last) last = d;
      });
    });
    if (!last) return;
    const daysSince = Math.floor((ref - new Date(last + 'T00:00:00Z')) / 86400000);
    if (daysSince > days) {
      out.push({ name: by[k][by[k].length - 1].customer_name, lastPaid: last, daysSince });
    }
  });
  return out.sort((a, b) => b.daysSince - a.daysSince);
}

// ── trend ────────────────────────────────────────────────────────────────────
// The window immediately before the current one, same length: this month vs
// last month, this year vs last year. All-time has no "before", so returns null
// and the caller shows no arrow.
function priorPeriodRange(range) {
  if (!range || !range.from || !range.to) return null;
  const [fy, fm, fd] = range.from.split('-').map(Number);
  const [ty, tm] = range.to.split('-').map(Number);
  const monthsSpan = (ty - fy) * 12 + (tm - fm) + 1;
  const prevEnd = new Date(Date.UTC(fy, fm - 1, 0));       // last day of the month before `from`
  const prevStartM = new Date(Date.UTC(fy, fm - 1 - monthsSpan, 1));
  const py = prevEnd.getUTCFullYear();
  const pm = prevEnd.getUTCMonth() + 1;
  const key = monthsSpan === 1 ? 'month' : monthsSpan === 12 ? 'year' : '3m';
  const label = monthsSpan === 1
    ? MONTH_NAMES[pm - 1] + ' ' + py
    : monthsSpan === 12 ? String(py) : 'Previous 3 months';
  return {
    key,
    from: ymd(prevStartM.getUTCFullYear(), prevStartM.getUTCMonth() + 1, 1),
    to: ymd(py, pm, prevEnd.getUTCDate()),
    label
  };
}

// Percent change and a direction word. A rise from zero is "up" but has no
// meaningful percentage, so pct is null there rather than Infinity.
function trend(now, before) {
  const n = Number(now) || 0;
  const b = Number(before) || 0;
  if (b === 0) return { pct: n === 0 ? 0 : null, dir: n === 0 ? 'flat' : 'up' };
  const diff = Math.round(((n - b) / b) * 100);
  return { pct: Math.abs(diff), dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
}

// ── recent activity ──────────────────────────────────────────────────────────
// A newest-first feed of what happened across all orders, from the state_history
// each order already carries. The first awaiting_payment entry is dropped: every
// order has one, and "an order was started" is not news worth a feed row — the
// interesting rows are payments clearing, sign-ins, returns, cancellations.
const ACTIVITY_LABEL = Object.freeze({
  verifying_payment: 'Payment submitted',
  awaiting_qr: 'Payment approved',
  reserved: 'Reservation confirmed',
  qr_pending: 'Sign-in code sent',
  active: 'Signed in — playing',
  awaiting_return: 'Rental ended',
  verifying_return: 'Return submitted',
  closed: 'Rental closed',
  cancelled: 'Order cancelled',
  payment_rejected: 'Payment rejected',
  awaiting_payment: 'Payment resubmitted'
});
function recentActivity(orders, limit) {
  const out = [];
  (orders || []).forEach(o => {
    if (!o) return;
    const hist = Array.isArray(o.state_history) && o.state_history.length
      ? o.state_history
      : [{ state: o.state, at: o.created_at }];
    hist.forEach((h, i) => {
      if (!h || !h.at) return;
      // The opening awaiting_payment is just "started" — skip only that one.
      if (i === 0 && h.state === 'awaiting_payment') return;
      out.push({
        ref: o.ref,
        name: o.fb_name || '',
        game: o.game_title || '',
        state: h.state,
        label: ACTIVITY_LABEL[h.state] || h.state,
        at: h.at
      });
    });
  });
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out.slice(0, limit || 8);
}

// ── accounts slot use ────────────────────────────────────────────────────────
// Fill per account, emptiest first — the ones with idle slots are where the
// owner is carrying cost with no rental against it.
function accountsSlotUse(accounts) {
  return (accounts || []).map(a => {
    let total = 0, filled = 0, idle = 0;
    SLOT_TYPES.forEach(t => {
      const s = a && a.slots && a.slots[t];
      if (!s || !s.enabled) return;
      total++;
      if (FILLED_STATUSES.includes(s.status)) filled++;
      else if (s.status === 'open') idle++;
    });
    return { id: a.id, label: a.label || ('#' + a.id), total, filled, idle, pct: pct(filled, total) };
  }).sort((a, b) => a.pct - b.pct || b.idle - a.idle);
}

// ── reviews ──────────────────────────────────────────────────────────────────
// The average covers published reviews only: an unpublished one is not yet
// something the shop is claiming about itself.
function reviewStats(reviews) {
  const shown = (reviews || []).filter(r => r && r.visible);
  const pending = (reviews || []).filter(r => r && !r.visible).length;
  if (!shown.length) return { avg: null, count: 0, pending };
  const sum = shown.reduce((s, r) => s + (Number(r.rating) || 0), 0);
  return { avg: Math.round((sum / shown.length) * 10) / 10, count: shown.length, pending };
}

module.exports = {
  PERIODS, SLOT_TYPES,
  periodRange, priorPeriodRange, inPeriod, trend,
  collected, rentalVsSales, depositsHeld, adCost, paymentMix,
  slotUtilisation, gamePayback, topRented, accountsSlotUse, recentActivity,
  repeatRate, topSpenders, dormant, reviewStats
};
