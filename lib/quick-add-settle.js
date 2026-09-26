// Unpaid Quick Adds: the owner recorded a rental, purchase or reservation that
// has not been paid yet. Nothing about it counts as sales until the money
// arrives. However it arrives — the owner's Confirm paid, the customer's QR Ph
// checkout, an uploaded proof the owner approves, or the old Mark paid — it is
// settled the same way: the order moves to the state it would have had if it
// had been paid at Quick Add, and the payment is recorded on the customer row,
// dated the day it was confirmed.
//
// Pure functions only; server.js applies them.

const PRE_PAYMENT_STATES = Object.freeze(['awaiting_payment', 'verifying_payment', 'payment_rejected']);
const SETTLE_TARGETS = Object.freeze(['active', 'awaiting_qr', 'closed', 'reserved']);

// A website checkout never has a customer record before it is paid — the
// record is created when the owner signs them in or confirms a reservation —
// so a customer_id on an unpaid order means the owner created it by hand.
// settle_state marks every unpaid Quick Add made since that field existed.
function isOwnerRecordedUnpaid(order) {
  if (!order || !PRE_PAYMENT_STATES.includes(order.state)) return false;
  return !!(order.settle_state || order.customer_id);
}

// For unpaid Quick Adds created before settle_state existed.
const STATUS_TARGET = Object.freeze({ renting: 'active', bought: 'active', done: 'closed', reservation: 'reserved' });

function settleTarget(order, customer) {
  const saved = order && order.settle_state;
  const target = SETTLE_TARGETS.includes(saved) ? saved
    : (STATUS_TARGET[customer && customer.status] || 'active');
  // A Coming Soon reservation whose game was released before it was paid is
  // an ordinary order for the released game now (lib/release.js clears its
  // upcoming_game_id): paid, it waits for its sign-in code like every other
  // released reservation, not in 'reserved' for a game that is already out.
  if (target === 'reserved' && !(order && order.upcoming_game_id)) return 'awaiting_qr';
  return target;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// What is still owed on the customer row, so the row's payments add up to its
// price again once settled. The deposit is not sales — a paid Quick Add
// records the rent alone too.
function settlementPayment(order, customer, today) {
  const o = order || {};
  let owed;
  if (customer) {
    const already = (Array.isArray(customer.payments) ? customer.payments : [])
      .reduce((s, p) => s + num(p && p.amount), 0);
    owed = num(customer.price) - already;
  } else {
    owed = num(o.amount_due);
  }
  const amount = Math.max(0, owed);
  if (!amount) return null;
  const kind = o.upcoming_game_id ? 'reservation' : (o.is_buy ? 'purchase' : 'rent');
  return { amount, date: today, kind };
}

function reminderMessage({ fbName, owed, gameTitle, ref, link }) {
  const first = String(fbName || '').trim().split(/\s+/)[0] || 'there';
  return '👋 Hi ' + first + '! Friendly reminder — ₱' + num(owed).toLocaleString('en-US')
    + ' for ' + gameTitle + ' (' + ref + ') is still unpaid.\n\n'
    + (link
      ? 'You can pay here: ' + link + '\nor just reply here once you\'ve sent it. Thank you!'
      : 'Just reply here once you\'ve sent it. Thank you!');
}

module.exports = {
  PRE_PAYMENT_STATES, SETTLE_TARGETS,
  isOwnerRecordedUnpaid, settleTarget, settlementPayment, reminderMessage
};
