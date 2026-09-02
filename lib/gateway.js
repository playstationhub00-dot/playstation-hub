// Payment-gateway decision rules. Pure functions over plain objects — no
// network, no database, no provider SDK — so every safety rule that guards real
// money is testable without touching PayMongo.
//
// The provider adapter (added once merchant keys exist) has exactly two jobs:
// verify the webhook signature, and normalise the provider's payload into the
// small event shape below. Everything after that is decided here, so swapping
// PayMongo for another provider never touches this logic.
//
//   event = {
//     id:             provider's unique event id, for replay detection
//     orderRef:       the PH-NNNN this payment is for, from intent metadata
//     amountCentavos: what the customer actually paid, in centavos
//     paid:           whether the provider considers it settled
//   }
//
// See docs/superpowers/specs/2026-09-02-online-payments-design.md (Phase 1).

const { parseOrderRef } = require('./orders');

// The only states where a gateway payment means anything. An order already
// signed in, active, or cancelled must never be advanced by a late or replayed
// webhook. 'payment_rejected' is included because a customer whose first
// attempt failed can legitimately pay again.
const PAYABLE_STATES = Object.freeze(['awaiting_payment', 'payment_rejected']);

// Gateways work in the smallest currency unit; this app stores whole pesos.
// ₱349 is 34900 centavos, and getting this backwards would silently accept a
// payment of one hundredth the price — so the conversion lives in one place
// with tests on it rather than inline at a call site.
function toCentavos(pesos) {
  return Math.round((Number(pesos) || 0) * 100);
}

// What the customer owes right now: the rent plus any refundable deposit. Both
// are already on the order, and both must be collected for it to count as paid.
function amountDueCentavos(order) {
  if (!order) return 0;
  return toCentavos(order.amount_due || 0) + toCentavos(order.deposit_due || 0);
}

function isDuplicateEvent(processedIds, eventId) {
  if (!eventId) return false;
  return (processedIds || []).indexOf(eventId) !== -1;
}

// Intent metadata round-trips through the provider, so it is attacker-shaped
// input by the time it comes back. Validated through the same parser the
// Messenger ref path uses, which accepts only the exact PH-NNNN form.
function orderRefFrom(metadata) {
  if (!metadata) return null;
  return parseOrderRef(metadata.order_ref);
}

// The single decision point for an incoming payment webhook. Returns an action
// and a reason rather than performing anything, so the caller stays a thin
// wrapper and every branch below is directly testable.
//
// Actions:
//   duplicate      — already processed; do nothing, respond 200 so the gateway stops retrying
//   not_paid       — provider says unsettled; wait for a later event
//   unknown_order  — no such order; surface in admin rather than discard
//   not_payable    — order is not awaiting payment; likely a replay or a double-pay
//   short          — underpaid; do NOT mark paid, needs a human
//   accept         — mark paid and advance the order
//   accept_over    — overpaid; advance, but flag the difference for a refund decision
function decide(input) {
  const opts = input || {};
  const event = opts.event || {};
  const order = opts.order || null;
  const processedIds = opts.processedIds || [];

  if (isDuplicateEvent(processedIds, event.id)) {
    return { action: 'duplicate', reason: 'event already processed' };
  }
  if (!event.paid) {
    return { action: 'not_paid', reason: 'provider has not settled this payment' };
  }
  if (!order) {
    return { action: 'unknown_order', reason: 'no order matches this payment' };
  }
  if (!PAYABLE_STATES.includes(order.state)) {
    return { action: 'not_payable', reason: 'order state is ' + order.state };
  }

  const due = amountDueCentavos(order);
  const paid = Math.round(Number(event.amountCentavos) || 0);

  // Underpayment must never mark an order paid — that would hand over an
  // account for a partial payment and hide the shortfall.
  if (paid < due) {
    return { action: 'short', reason: 'paid less than due', due, paid, shortBy: due - paid };
  }
  if (paid > due) {
    return { action: 'accept_over', reason: 'paid more than due', due, paid, overBy: paid - due };
  }
  return { action: 'accept', reason: 'paid in full', due, paid };
}

module.exports = {
  PAYABLE_STATES,
  toCentavos, amountDueCentavos, isDuplicateEvent, orderRefFrom, decide
};
