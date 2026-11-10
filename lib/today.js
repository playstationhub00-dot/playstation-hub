// The Today page: queues and figures the owner can act on, built only from
// records the admin already stores. Pure — the route passes collections and
// `now`, and every number here is what scripts/test-today.js asserts.
//
// Left out on purpose, because the shop does not store them yet:
//   waitlist counts as their own queue, a Reserved slot state,
//   PS Plus expiry dates, and Google Analytics traffic.
// A shop visit log, when the route has one, is shown as the shop's own log.

const dashboard = require('./dashboard');
const quickAddSettle = require('./quick-add-settle');
const returnsLib = require('./returns');

const MANILA_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const OMITTED = Object.freeze(['waitlist', 'reserved-slot', 'psplus-expiry', 'ga4']);

function manilaParts(now) {
  const shifted = new Date(now.getTime() + MANILA_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  const pad = n => String(n).padStart(2, '0');
  const ymd = y + '-' + pad(m) + '-' + pad(d);
  const utcMidnight = new Date(Date.UTC(y, m - 1, d));
  const hh = hour % 12 || 12;
  return {
    y, m, d, hour, minute, ymd,
    line: WEEKDAYS[utcMidnight.getUTCDay()] + ', ' + d + ' ' + MONTHS[m - 1]
      + ' · ' + hh + ':' + pad(minute) + ' ' + (hour < 12 ? 'AM' : 'PM') + ' (Asia/Manila)'
  };
}

function greetingFor(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function pad(n) { return String(n).padStart(2, '0'); }

function lastDay(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function daysFrom(todayYmd, otherYmd) {
  const a = Date.parse(todayYmd + 'T00:00:00Z');
  const b = Date.parse(String(otherYmd || '') + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function headline(needs, review) {
  const head = needs === 0
    ? 'Nothing needs you right now'
    : needs + ' queue' + (needs === 1 ? ' needs' : 's need') + ' you now';
  if (!review) return head;
  return head + ', ' + review + ' to review';
}

function ago(at, now) {
  const t = Date.parse(at || '');
  if (!Number.isFinite(t)) return '';
  const min = Math.round((now.getTime() - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + ' h ago';
  const day = Math.round(hr / 24);
  return day + ' d ago';
}

function activityBadge(state) {
  switch (state) {
    case 'awaiting_qr': return { label: 'Paid', kind: 'ok' };
    case 'verifying_payment': return { label: 'Payment to check', kind: 'wa' };
    case 'active': return { label: 'Signed in', kind: 'in' };
    case 'qr_pending': return { label: 'Waiting for sign-in', kind: 'in' };
    case 'reserved': return { label: 'Reserved', kind: 'in' };
    case 'awaiting_return':
    case 'verifying_return': return { label: 'Ended', kind: 'wa' };
    case 'closed': return { label: 'Completed', kind: 'nu' };
    case 'cancelled': return { label: 'Cancelled', kind: 'nu' };
    case 'payment_rejected':
    case 'awaiting_payment': return { label: "Didn't pay", kind: 'er' };
    default: return { label: state || 'Updated', kind: 'nu' };
  }
}

function typeLabel(t) {
  if (t === 'tr') return 'Trophy';
  if (t === 'ps4') return 'PS4 Primary';
  return 'Non-Trophy';
}

function planLabel(o) {
  if (!o) return '';
  if (o.is_buy) return 'Buy';
  if (o.days === 7) return 'Weekly';
  if (o.days === 30) return 'Monthly';
  return '';
}

function slim(o) {
  return {
    ref: o.ref || '',
    name: o.fb_name || '',
    game: o.game_title || '',
    accountType: typeLabel(o.account_type),
    plan: planLabel(o),
    amount: (Number(o.amount_due) || 0) + (Number(o.deposit_due) || 0),
    deposit: Number(o.deposit_due) || 0,
    end: o.end_date || ''
  };
}

function buildToday(input) {
  const src = input || {};
  const now = src.now instanceof Date ? src.now : new Date();
  const when = manilaParts(now);
  const orders = src.orders || [];
  const customers = src.customers || [];
  const accounts = src.accounts || [];
  const requests = src.requests || [];

  // Trophy, plus PS4 Primary only when the order recorded a deposit. Same
  // rule as the Returns & deposits page, so the queues and the sidebar
  // badge are not counting Non-Trophy rentals.
  const tracked = orders.filter(returnsLib.tracksDeposit);
  const returns = tracked.filter(o => o.state === 'awaiting_return' || o.state === 'verifying_return');
  const unpaid = orders.filter(o =>
    o && (o.state === 'awaiting_payment' || o.state === 'payment_rejected')
    && !quickAddSettle.isOwnerRecordedUnpaid(o)
  );
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  const over24h = unpaid.filter(o => {
    const t = Date.parse(o.created_at || '');
    return Number.isFinite(t) && t < dayAgo;
  }).length;

  const depositRows = tracked.filter(o =>
    o.state === 'closed' && (Number(o.deposit_due) || 0) > 0 && !o.deposit_refunded
  );
  const depositSum = depositRows.reduce((s, o) => s + (Number(o.deposit_due) || 0), 0);

  const loyaltyReady = (src.loyaltyProfiles || []).filter(p => p && p.hasReward).length;
  const messages = Number(src.messageCount) || 0;

  const weekAgo = now.getTime() - 7 * 86400000;
  const openRequests = requests.filter(r => r && r.status !== 'stocked' && r.status !== 'rejected');
  const newer = openRequests.filter(r => {
    const t = Date.parse(r.created_at || '');
    return Number.isFinite(t) && t >= weekAgo;
  }).length;
  const stocked = requests.filter(r => r && r.status === 'stocked').length;

  const needsYou = [];
  if (returns.length) needsYou.push('returns');
  if (unpaid.length) needsYou.push('unpaid');
  if (depositRows.length) needsYou.push('deposits');
  const toReview = [];
  if (loyaltyReady) toReview.push('loyalty');
  if (messages) toReview.push('messages');
  if (openRequests.length) toReview.push('requests');

  const monthFrom = when.y + '-' + pad(when.m) + '-01';
  const monthTo = when.ymd;
  const prev = new Date(Date.UTC(when.y, when.m - 2, 1));
  const py = prev.getUTCFullYear();
  const pm = prev.getUTCMonth() + 1;
  const prevDay = Math.min(when.d, lastDay(py, pm));
  const priorFrom = py + '-' + pad(pm) + '-01';
  const priorTo = py + '-' + pad(pm) + '-' + pad(prevDay);
  const collectedNow = dashboard.collected(customers, { from: monthFrom, to: monthTo });
  const collectedPrior = dashboard.collected(customers, { from: priorFrom, to: priorTo });

  let endingSoon = 0;
  let overdue = 0;
  const renting = customers.filter(c => c && c.status === 'renting');
  renting.forEach(c => {
    const dl = daysFrom(when.ymd, c.end_date);
    if (dl == null) return;
    if (dl < 0) overdue++;
    else if (dl <= 3) endingSoon++;
  });

  const held = dashboard.depositsHeld(tracked);
  const slots = dashboard.slotUtilisation(accounts);
  const monthEnd = when.y + '-' + pad(when.m) + '-' + pad(lastDay(when.y, when.m));
  const top = dashboard.topRented(customers, { from: monthFrom, to: monthEnd }, 4);

  const activity = dashboard.recentActivity(orders, 4).map(row => ({
    ref: row.ref,
    name: row.name,
    game: row.game,
    at: row.at,
    ago: ago(row.at, now),
    badge: activityBadge(row.state)
  }));

  let traffic = null;
  if (src.traffic && typeof src.traffic === 'object') {
    traffic = {
      visitors: Number(src.traffic.visitors) || 0,
      messaged: Number(src.traffic.messaged) || 0,
      paid: Number(src.traffic.paid) || 0,
      botsFiltered: Number(src.traffic.botsFiltered) || 0,
      source: 'shop'
    };
  }

  return {
    when,
    greeting: greetingFor(when.hour),
    headline: headline(needsYou.length, toReview.length),
    needsYouCount: needsYou.length,
    toReviewCount: toReview.length,
    queues: {
      returns: { count: returns.length, tone: 'needs' },
      unpaid: { count: unpaid.length, over24h, tone: 'needs' },
      deposits: { count: depositRows.length, amount: depositSum, tone: 'needs' },
      loyalty: { count: loyaltyReady, tone: 'review' },
      messages: { count: messages, tone: 'review' },
      requests: { count: openRequests.length, newer, stocked, tone: 'review' }
    },
    lists: {
      returns: returns.slice(0, 50).map(slim),
      unpaid: unpaid.slice(0, 50).map(slim),
      deposits: depositRows.slice(0, 50).map(slim)
    },
    kpis: {
      collected: {
        total: collectedNow.total,
        prior: collectedPrior.total,
        fromDay: 1,
        toDay: when.d,
        monthLabel: MONTHS[when.m - 1]
      },
      outOnRent: { count: renting.length, endingSoon, overdue },
      depositsHeld: { amount: held.amount, ready: depositRows.length, readyAmount: depositSum },
      slots: { filled: slots.filled, total: slots.total, open: slots.idle }
    },
    activity,
    topRented: top,
    traffic,
    omitted: OMITTED.slice()
  };
}

function peso(n) {
  const v = Math.round(Number(n) || 0);
  return '₱' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

module.exports = { buildToday, peso, OMITTED };
