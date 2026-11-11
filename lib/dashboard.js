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
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MANILA_MS = 8 * 60 * 60 * 1000;

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
// A cancelled purchase must stay on the sales side. Flipping its status to
// cancelled would otherwise move the original sale into rentals and only
// subtract the refund there.
function moneySide(customer) {
  if (!customer) return 'rental';
  if (customer.status === 'bought') return 'sales';
  const prev = customer.cancellation && customer.cancellation.prev_status;
  if ((customer.status === 'cancelled' || customer.status === 'refunded') && prev === 'bought') return 'sales';
  return 'rental';
}

function rentalVsSales(customers, range) {
  let rental = 0, sales = 0;
  eachPayment(customers, range, (p, c) => {
    const amt = Number(p.amount) || 0;
    if (moneySide(c) === 'sales') sales += amt; else rental += amt;
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
//
// Each group carries the orders that make it up, not just the total: a bar
// chart the owner cannot check against anything is a number to take on faith.
// Building the list in the same pass that builds the total is what keeps them
// from disagreeing — a separate "detail" query re-filtering the same orders
// could drift from this one and show a total the rows underneath it don't add
// up to.
const UNPAID_STATES = Object.freeze(['awaiting_payment', 'verifying_payment', 'payment_rejected', 'cancelled']);
function paymentMix(orders, range) {
  const by = {};
  (orders || []).forEach(o => {
    if (!o || UNPAID_STATES.includes(o.state)) return;
    if (!inPeriod(o.created_at, range)) return;
    // A paid order with no method recorded is still money in; hiding it would
    // make the mix add up to less than the period's takings.
    const key = String(o.payment_method || '').trim().toLowerCase() || 'unrecorded';
    if (!by[key]) by[key] = { method: key, count: 0, amount: 0, orders: [] };
    by[key].count++;
    const amount = (Number(o.amount_due) || 0) + (Number(o.deposit_due) || 0);
    by[key].amount += amount;
    by[key].orders.push({
      ref: o.ref || '', name: o.fb_name || '', game: o.game_title || '',
      amount, date: o.created_at || ''
    });
  });
  Object.values(by).forEach(g => g.orders.sort((a, b) => String(b.date).localeCompare(String(a.date))));
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

// What each month's games cost, for the dashboard's per-month profit tile.
//
// A game's cost is charged to ONE month — the month it was acquired — not to
// every month it earns in. That distinction is the whole reason the old Net
// Profit figure was removed (see money.ejs): charging every game ever bought
// against a single month's revenue put two different clocks in one number.
//
// release_date first, created_at as the fallback: release_date is when the
// game (and so the purchase) landed, but it is not always filled in, and a
// cost with no month at all would quietly disappear from every total.
function monthlyGameCost(games) {
  const byMonth = {};
  const items = {};
  let missingCost = 0;
  let undated = 0;

  (games || []).forEach(g => {
    const cost = Number(g && g.cost) || 0;
    if (cost <= 0) { missingCost++; return; }
    const when = String((g && g.release_date) || (g && g.created_at) || '');
    const key = when.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) { undated++; return; }
    byMonth[key] = (byMonth[key] || 0) + cost;
    (items[key] = items[key] || []).push({ id: g.id, title: g.title, cost });
  });

  return { byMonth, items, missingCost, undated, total: (games || []).length };
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
    // A cancelled rental is no longer a rental of that game. An extension
    // refund leaves the row 'renting', so it still counts once.
    if (c.status === 'cancelled' || c.status === 'refunded') return;
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
        // A refund is money going out, not a visit. Dating "last paid" off it
        // would make a cancellation look like a customer who just came back.
        if (!p || p.kind === 'refund' || (Number(p.amount) || 0) <= 0) return;
        const d = String(p.date || '').slice(0, 10);
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

// Asia/Manila wall clock. The server's own timezone is not the shop's, so a
// greeting read off `Date#getHours()` says "Good morning" at 1pm in Manila.
function manilaCalendar(now) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  const shifted = new Date(d.getTime() + MANILA_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  };
}

function manilaGreeting(now) {
  const p = manilaCalendar(now);
  const hour = p.hour;
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const utcMidnight = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const hh = hour % 12 || 12;
  const min = String(p.minute).padStart(2, '0');
  const line = WEEKDAYS[utcMidnight.getUTCDay()] + ', ' + p.d + ' ' + MONTH_SHORT[p.m - 1]
    + ' · ' + hh + ':' + min + ' ' + (hour < 12 ? 'AM' : 'PM') + ' (Asia/Manila)';
  return { greeting, line };
}

function daysInclusive(fromYmd, toYmd) {
  const ms = Date.parse(toYmd + 'T00:00:00Z') - Date.parse(fromYmd + 'T00:00:00Z');
  if (!Number.isFinite(ms)) return 0;
  return Math.round(ms / 86400000) + 1;
}

function addDays(ymdStr, n) {
  const [y, m, d] = String(ymdStr || '').split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// A month that has only just started must not be compared with the whole of
// last month: "down 95%" on day 3 is the calendar, not the shop. When the
// current window is still open, `compare` is the same stretch of the previous
// window (same number of days, clamped to that month). A finished window has
// nothing to soften, so compare is null and the caller uses the full prior.
function collectionPace(range, now) {
  const empty = { partial: false, day: null, days: null, note: '', compare: null };
  if (!range || !range.from || !range.to || range.key === 'all') return empty;
  const p = manilaCalendar(now);
  const today = ymd(p.y, p.m, p.d);
  if (today < range.from || today >= range.to) return empty;
  const prior = priorPeriodRange(range);
  if (!prior) return empty;

  if (range.key === 'month') {
    const days = lastDayOfMonth(p.y, p.m);
    const [py, pm] = prior.from.split('-').map(Number);
    const pd = Math.min(p.d, lastDayOfMonth(py, pm));
    const label = MONTH_NAMES[pm - 1] + ' 1-' + pd;
    return {
      partial: true,
      day: p.d,
      days,
      note: 'Day ' + p.d + ' of ' + days + '. Compared with ' + label + ', not the whole previous month.',
      compare: { from: prior.from, to: ymd(py, pm, pd), label }
    };
  }

  if (range.key === 'year') {
    const pd = Math.min(p.d, lastDayOfMonth(p.y - 1, p.m));
    const label = MONTH_SHORT[p.m - 1] + ' ' + pd + ', ' + (p.y - 1);
    return {
      partial: true,
      day: p.d,
      days: null,
      note: 'Year so far, through ' + MONTH_SHORT[p.m - 1] + ' ' + p.d + '. Compared with the same dates last year, not the whole year.',
      compare: { from: prior.from, to: ymd(p.y - 1, p.m, pd), label }
    };
  }

  const elapsed = daysInclusive(range.from, today);
  let to = addDays(prior.from, elapsed - 1);
  if (to > prior.to) to = prior.to;
  return {
    partial: true,
    day: p.d,
    days: null,
    note: 'This window is still open (through ' + MONTH_SHORT[p.m - 1] + ' ' + p.d + '). Compared with the same number of days just before it, not three full months.',
    compare: { from: prior.from, to, label: prior.label }
  };
}

// Payment methods share one written form. An unknown key used to be shouted
// in capitals ("GATEWAY") next to the sentence-case "Not recorded".
const METHOD_LABELS = Object.freeze({
  gcash: 'GCash',
  maya: 'Maya',
  paypal: 'PayPal',
  bank: 'Bank transfer',
  manual: 'Cash / other',
  gateway: 'Gateway',
  qrph: 'QR Ph',
  card: 'Card',
  unrecorded: 'Not recorded',
  unknown: 'Not recorded',
  none: 'Not recorded'
});

function paymentMethodLabel(method, methods) {
  const key = String(method == null ? '' : method).trim().toLowerCase();
  if (!key || METHOD_LABELS[key] === 'Not recorded') return 'Not recorded';
  const list = Array.isArray(methods) ? methods : [];
  const hit = list.find(m => m && String(m.key || '').trim().toLowerCase() === key);
  const saved = hit && String(hit.label || '').trim();
  if (saved) return saved;
  if (METHOD_LABELS[key]) return METHOD_LABELS[key];
  return key.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());
}

// Slot picture for the Games & slots tab. Reads slotView when the accounts
// page has already decorated the row, otherwise the raw slots. Withdrawn is
// maintenance or not available. Overdue stays inside rented so the slices
// still add up to the total. Reserved is not a status we store.
function slotPicture(accounts) {
  const byType = {
    non_trophy: { key: 'non_trophy', label: 'Non-Trophy', total: 0, rented: 0 },
    trophy: { key: 'trophy', label: 'Trophy', total: 0, rented: 0 },
    ps4_primary: { key: 'ps4_primary', label: 'PS4 Primary', total: 0, rented: 0 }
  };
  const totals = { total: 0, rented: 0, open: 0, bought: 0, withdrawn: 0, overdue: 0 };
  (accounts || []).forEach(a => {
    SLOT_TYPES.forEach(t => {
      const view = a && a.slotView && a.slotView[t];
      const raw = a && a.slots && a.slots[t];
      const s = view || raw;
      if (!s || !s.enabled) return;
      totals.total++;
      if (byType[t]) byType[t].total++;
      if (s.status === 'rented') {
        totals.rented++;
        if (byType[t]) byType[t].rented++;
        if (s.due === 'overdue') totals.overdue++;
      } else if (s.status === 'open') {
        totals.open++;
      } else if (s.status === 'buyed') {
        totals.bought++;
      } else if (s.status === 'maintenance' || s.status === 'na') {
        totals.withdrawn++;
      }
    });
  });
  return {
    total: totals.total,
    rented: totals.rented,
    open: totals.open,
    bought: totals.bought,
    withdrawn: totals.withdrawn,
    overdue: totals.overdue,
    pct: pct(totals.rented + totals.bought, totals.total),
    byType: [byType.non_trophy, byType.trophy, byType.ps4_primary]
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
  manilaCalendar, manilaGreeting, collectionPace, paymentMethodLabel, slotPicture,
  collected, rentalVsSales, depositsHeld, adCost, paymentMix,
  slotUtilisation, gamePayback, monthlyGameCost, topRented, accountsSlotUse, recentActivity,
  repeatRate, topSpenders, dormant, reviewStats
};
