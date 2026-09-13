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

// Masking moved to lib/names.js so reviews can share the exact same rule.
const { maskName } = require('./names');

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

// Excludes a preorder ('reserved' shared with a Coming Soon downpayment or a
// permanent purchase). Exported alongside isPreorder's callers below because
// server.js needs the same rule when it filters the pool of orders this
// module is handed — a queue entry and a preorder both use 'reserved', and
// nothing about the state alone tells them apart.
function isPreorder(order) {
  return !!(order && (order.upcoming_game_id || order.is_buy));
}

// Every order still waiting for a slot, admin-wide across every game — what
// the "Waiting for a slot" panel in views/partials/order-queue.ejs renders.
//
// Positions are computed with buildQueue, the exact function that numbers the
// same order on that customer's OWN page (game page, order page, PS Plus
// page) — so the number an owner sees here can never disagree with the number
// the customer sees. A second implementation of the tier/age ordering, even a
// careful one, could drift from that one the moment either changed; there is
// no way to keep two copies of a sort in step except to have only one.
//
// A mid-upgrade order (paying the ₱100) holds its place in the count — the
// design says it must not vanish from the queue while paying — but is left
// out of the returned rows: it already surfaces in the action queue above
// this panel (server.js's OWNER_STATES), and listing it twice would just be
// the same order asking to be handled in two different places on one screen.
//
// queuePosition is null for a row buildQueue leaves out of the count — a free
// entry idle more than QUEUE_EXPIRY_DAYS. That is a display filter only, so
// the row is still returned (queueExpired: true on it) rather than dropped:
// the admin panel is the one place this project's own design doc says must
// keep showing it, since deleting or hiding it would be the owner losing
// track of someone who might still be waiting.
function forAdminPanel(orders, now) {
  const at = now instanceof Date ? now : new Date(now || Date.now());
  const eligible = (orders || []).filter(o =>
    o && !isPreorder(o) &&
    (QUEUE_STATES.includes(o.state) ||
     (o.upgraded_from_waitlist && UPGRADE_PENDING_STATES.includes(o.state)))
  );
  const byGame = {};
  eligible.forEach(o => { (byGame[o.game_id] = byGame[o.game_id] || []).push(o); });
  return eligible
    .filter(o => QUEUE_STATES.includes(o.state))
    .map(o => {
      const built = buildQueue(byGame[o.game_id], at);
      const row = (built[o.account_type] || []).find(r => r.ref === o.ref);
      return Object.assign({}, o, {
        queuePosition: row ? row.position : null,
        queueExpired: !row && o.state === 'waitlisted'
      });
    });
}

module.exports = {
  QUEUE_EXPIRY_DAYS, QUEUE_STATES, UPGRADE_PENDING_STATES, TYPES,
  inQueue, isExpired, maskName, buildQueue, positionOf, aheadOf, upgradedPosition,
  isPreorder, forAdminPanel
};
