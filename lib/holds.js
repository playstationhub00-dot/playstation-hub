// A checkout hold is not the 24-hour payment-reminder clock (hold_expires_at).
// slot_hold_expires_at is the 15 minutes a customer has to pay or the slot
// goes back on sale. Payment submitted (a screenshot, state verifying_payment)
// keeps the slot until an owner confirms or rejects it.
const HOLD_MS = 15 * 60 * 1000;

function plan(now) {
  const at = now ? new Date(now) : new Date();
  return {
    ms: HOLD_MS,
    expires: new Date(at.getTime() + HOLD_MS).toISOString()
  };
}

// Confirmed, for slot purposes, means the owner has moved the order out of
// the unpaid states (awaiting_qr / reserved / later). verifying_payment is
// "payment submitted, waiting for that confirmation" and still holds the slot.
// awaiting_payment holds the slot only until slot_hold_expires_at.
function consumesSlot(order, now) {
  if (!order || order.is_waitlist || order.hold_for_line) return false;
  if (order.state === 'verifying_payment') return true;
  if (order.state !== 'awaiting_payment') return false;
  if (order.slot_hold_released) return false;
  if (order.payment_proof) return true;
  const t = Date.parse(order.slot_hold_expires_at || '');
  if (!Number.isFinite(t)) return false;
  const at = now ? new Date(now).getTime() : Date.now();
  return t > at;
}

function statusOf(order, now) {
  if (!order || !order.slot_hold_expires_at) return null;
  if (order.payment_proof || order.state === 'verifying_payment') return 'submitted';
  if (order.state !== 'awaiting_payment') return null;
  if (consumesSlot(order, now)) return 'holding';
  return 'expired';
}

function countForGame(orders, gameId, now) {
  const counts = { nt: 0, tr: 0, ps4: 0 };
  const id = String(gameId);
  (orders || []).forEach(order => {
    if (!order || String(order.game_id) !== id) return;
    if (!consumesSlot(order, now)) return;
    if (counts[order.account_type] != null) counts[order.account_type] += 1;
  });
  return counts;
}

function applyCounts(avail, counts) {
  const c = counts || {};
  const ntSlots = Math.max(0, (avail.ntSlots || 0) - (c.nt || 0));
  const trSlots = Math.max(0, (avail.trSlots || 0) - (c.tr || 0));
  const ps4Slots = Math.max(0, (avail.ps4Slots || 0) - (c.ps4 || 0));
  const ntAvail = ntSlots > 0;
  const trAvail = trSlots > 0;
  const ps4Avail = !avail.showPs4 || ps4Slots > 0;
  return Object.assign({}, avail, {
    ntSlots, trSlots, ps4Slots,
    ntAvail, trAvail,
    ps4Avail: avail.showPs4 ? ps4Slots > 0 : avail.ps4Avail,
    allUnavail: !ntAvail && !trAvail && (!avail.showPs4 || !ps4Avail),
    totalSlots: ntSlots + trSlots + (avail.showPs4 ? ps4Slots : 0)
  });
}

module.exports = {
  HOLD_MS, plan, consumesSlot, statusOf, countForGame, applyCounts
};
