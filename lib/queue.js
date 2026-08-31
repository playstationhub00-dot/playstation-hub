// Queue position rules for Fall in Line / Priority. Kept as pure functions over
// plain order objects — no database access and no Express — so the game page,
// the PS Plus page, the customer's order page and the admin card all read one
// implementation and can never disagree about who is where in line.
//
// See docs/superpowers/specs/2026-08-31-queue-position-design.md.

// A free entry that has outlasted a full monthly rental cycle has almost
// certainly been abandoned, so it stops counting against everyone behind it.
// This is a DISPLAY filter only: nothing is deleted and the admin card still
// shows the row. Paid priority entries are deliberately exempt — somebody paid
// ₱100 for that place and must never be dropped silently.
const QUEUE_EXPIRY_DAYS = 30;

// The two states that hold a place in line: a confirmed ₱100 reservation, and
// a free Fall in Line entry.
const QUEUE_STATES = Object.freeze(['reserved', 'waitlisted']);

// Mid-payment states that hold a place ONLY on an order that is an upgrading
// waitlist entry. A priority order that was never a waitlist entry and has not
// been paid for yet is not in the queue — unpaid money buys no place. Without
// this list an upgrading customer would vanish from the line the moment they
// clicked upgrade and reappear only once the payment cleared.
const UPGRADE_PENDING_STATES = Object.freeze([
  'awaiting_payment', 'verifying_payment', 'payment_rejected'
]);

const TYPES = Object.freeze(['nt', 'tr', 'ps4']);

// Age in whole-ish days. An order with no parseable created_at reports 0 rather
// than Infinity: failing open keeps a real person in the line when their
// timestamp is missing, where failing closed would silently delete them.
function ageDays(order, now) {
  const t = Date.parse((order && order.created_at) || '');
  if (isNaN(t)) return 0;
  return (now.getTime() - t) / 86400000;
}

// Coming Soon pre-orders and permanent purchases share the 'reserved' state
// with priority reservations but belong to a different queue entirely.
function isPreorder(order) {
  return !!(order && (order.upcoming_game_id || order.is_buy));
}

function tierOf(order) {
  return order && order.state === 'reserved' ? 'priority' : 'free';
}

function inQueue(order, now) {
  if (!order || isPreorder(order)) return false;
  const at = now instanceof Date ? now : new Date(now || Date.now());
  if (QUEUE_STATES.includes(order.state)) {
    if (order.state === 'reserved') return true;
    return ageDays(order, at) <= QUEUE_EXPIRY_DAYS;
  }
  if (order.upgraded_from_waitlist && UPGRADE_PENDING_STATES.includes(order.state)) {
    return ageDays(order, at) <= QUEUE_EXPIRY_DAYS;
  }
  return false;
}

// True only for a free entry that has aged out — the one case where the
// customer's own order page should offer "message us to rejoin" instead of a
// position. Never true for a paid entry, which does not expire.
function isExpired(order, now) {
  if (!order || order.state !== 'waitlisted') return false;
  const at = now instanceof Date ? now : new Date(now || Date.now());
  return ageDays(order, at) > QUEUE_EXPIRY_DAYS;
}

// "Michael Dela Cruz" -> "Michael D." — enough for someone to recognise their
// own row, not enough to identify a stranger. Names are never re-cased: this
// renders what the customer typed, only shorter.
function maskName(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!s) return 'Guest';
  const parts = s.split(' ');
  const first = parts[0].length > 14 ? parts[0].slice(0, 14) + '…' : parts[0];
  if (parts.length === 1) return first;
  return first + ' ' + parts[parts.length - 1][0] + '.';
}

function compareEntries(a, b) {
  const ta = tierOf(a) === 'priority' ? 0 : 1;
  const tb = tierOf(b) === 'priority' ? 0 : 1;
  if (ta !== tb) return ta - tb;
  const da = Date.parse(a.created_at || '') || 0;
  const db = Date.parse(b.created_at || '') || 0;
  if (da !== db) return da - db;
  return String(a.ref).localeCompare(String(b.ref));
}

// Groups queue-eligible orders by account type and numbers them. Rows are
// already masked, so a caller can hand them straight to a template without
// having to remember to hide anything.
function buildQueue(orders, now) {
  const at = now instanceof Date ? now : new Date(now || Date.now());
  const out = { nt: [], tr: [], ps4: [] };
  (orders || []).forEach(o => {
    if (!inQueue(o, at)) return;
    if (TYPES.includes(o.account_type)) out[o.account_type].push(o);
  });
  TYPES.forEach(type => {
    out[type] = out[type].sort(compareEntries).map((o, i) => ({
      ref: o.ref,
      position: i + 1,
      tier: tierOf(o),
      name: maskName(o.fb_name),
      joinedAt: o.created_at || null,
      sessionId: o.session_id || null
    }));
  });
  return out;
}

function positionOf(rows, ref) {
  const row = (rows || []).find(r => r.ref === ref);
  return row ? row.position : null;
}

// How many people are in front of this ref, and how many of those paid. Drives
// the "2 ahead of you paid priority" line on the customer's order page.
function aheadOf(rows, ref) {
  const list = rows || [];
  const me = list.find(r => r.ref === ref);
  if (!me) return null;
  const ahead = list.filter(r => r.position < me.position);
  return { total: ahead.length, priority: ahead.filter(r => r.tier === 'priority').length };
}

// The position this ref would take if its ₱100 cleared right now. Upgrading
// keeps created_at, so an upgrader is ranked among priority holders by when
// they FIRST fell in line — which can place them above someone who paid more
// recently. Counting the priority tier and adding one would understate that.
function upgradedPosition(rows, ref) {
  const list = rows || [];
  const me = list.find(r => r.ref === ref);
  if (!me) return null;
  const mine = Date.parse(me.joinedAt || '') || 0;
  const ahead = list.filter(r => {
    if (r.tier !== 'priority') return false;
    const t = Date.parse(r.joinedAt || '') || 0;
    if (t !== mine) return t < mine;
    return String(r.ref).localeCompare(String(ref)) < 0;
  });
  return ahead.length + 1;
}

module.exports = {
  QUEUE_EXPIRY_DAYS, QUEUE_STATES, UPGRADE_PENDING_STATES, TYPES,
  inQueue, isExpired, maskName, buildQueue, positionOf, aheadOf, upgradedPosition
};
