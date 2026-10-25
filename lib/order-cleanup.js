// Admin → Orders → By game: clearing old entries. The owner can tick rows and
// "Cancel selected" (POST /admin/orders/bulk-cancel), and a sweep cancels the
// ones that have sat untouched for the set number of days. Both only ever
// cancel — the record stays in All orders — and both stop at the same line:
// unpaid orders and free waiting-list entries, never a ⭐ priority entry
// (somebody paid ₱100 for that place) and never an unpaid Quick Add (a real
// rental that still owes money). Pure rules plus a sweep with its database
// calls passed in, like lib/payment-reminders.js.
// See docs/superpowers/specs/2026-10-24-orders-bulk-cancel-and-cleanup-design.md.

const quickAddSettle = require('./quick-add-settle');

// The states POST /admin/orders/:ref/cancel accepts.
const CANCELLABLE_STATES = Object.freeze(['awaiting_payment', 'payment_rejected', 'waitlisted']);
const DEFAULT_DAYS = 30;
const MIN_DAYS = 7;
const MAX_DAYS = 365;
const MAX_REFS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const REF_RE = /^PH-\d{4,}$/;

// Stored beside the payment-reminder settings. Unset means on at 30 days —
// the owner asked for the cleanup — and only a literal false turns it off.
function normalizeCleanup(raw) {
  const s = raw || {};
  let days = s.cleanup_days;
  if (days === undefined || days === null || days === '') days = DEFAULT_DAYS;
  else days = Math.round(Number(days));
  if (!Number.isFinite(days)) days = DEFAULT_DAYS;
  days = Math.max(MIN_DAYS, Math.min(MAX_DAYS, days));
  return { enabled: s.cleanup_enabled !== false, days };
}

// The last time anything happened to the order: its latest state change, or
// the day it was made when it has no history. null when no date can be read,
// so an order with a broken date is never treated as old.
function lastActivity(order) {
  if (!order) return null;
  let latest = NaN;
  (Array.isArray(order.state_history) ? order.state_history : []).forEach(h => {
    const t = Date.parse((h && h.at) || '');
    if (!isNaN(t) && (isNaN(latest) || t > latest)) latest = t;
  });
  if (isNaN(latest)) latest = Date.parse(order.created_at || '');
  return isNaN(latest) ? null : latest;
}

function isCancellable(order) {
  return !!order && CANCELLABLE_STATES.includes(order.state) && !quickAddSettle.isOwnerRecordedUnpaid(order);
}

function staleOrders(orders, settings, now) {
  const s = normalizeCleanup(settings);
  if (!s.enabled) return [];
  const at = now instanceof Date ? now.getTime() : Date.parse(now || '') || Date.now();
  return (orders || []).filter(o => {
    if (!isCancellable(o)) return false;
    const t = lastActivity(o);
    return t !== null && at - t >= s.days * DAY_MS;
  });
}

// The refs a "Cancel selected" form sent: one value or many, PH-numbers only.
function parseRefs(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  list.forEach(r => {
    if (typeof r !== 'string') return;
    const ref = r.trim().toUpperCase();
    if (REF_RE.test(ref) && out.indexOf(ref) === -1 && out.length < MAX_REFS) out.push(ref);
  });
  return out;
}

let sweeping = false;

// deps: { now, settings, listCandidates() → orders, cancel(order, days) → truthy
// when it cancelled }. One order failing does not stop the rest; a sweep that
// starts while another is running does nothing.
async function runCleanup(deps) {
  const d = deps || {};
  if (sweeping) return { examined: 0, cancelled: 0, refs: [], overlapped: true };
  const s = normalizeCleanup(d.settings);
  if (!s.enabled) return { examined: 0, cancelled: 0, refs: [] };
  sweeping = true;
  try {
    const list = (await d.listCandidates()) || [];
    const refs = [];
    for (const order of staleOrders(list, d.settings, d.now)) {
      try {
        if (await d.cancel(order, s.days)) refs.push(order.ref);
      } catch (e) {
        // One bad order must not stop the rest; leave a trace if asked to.
        if (typeof d.onError === 'function') {
          try { d.onError(order, e); } catch (_) { /* the trace itself must never throw */ }
        }
      }
    }
    return { examined: list.length, cancelled: refs.length, refs };
  } finally {
    sweeping = false;
  }
}

module.exports = {
  CANCELLABLE_STATES, DEFAULT_DAYS, MIN_DAYS, MAX_DAYS, MAX_REFS,
  normalizeCleanup, lastActivity, isCancellable, staleOrders, parseRefs, runCleanup
};
