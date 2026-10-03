// Game swaps during a rental. A swap to a pricier game costs extra only when
// the owner switches the charge on — customers who rented under a promo are
// often swapped for free. Pure: server.js's customer-edit route and the
// Customers tab's "Remove" action call these.

// pricePaid       the rental's price before the swap
// refPrice        the new game at the same duration and type, promo applied
//                 (server.js computeSwapReferencePrice)
// submittedPrice  the edit form's price field
// charge          the owner switched "Charge ₱X more" on
// Returns { finalPrice, topUp, waived }: topUp is what was charged, waived is
// the difference that was let go. A swap to a cheaper game is never refunded.
function swapPrice({ pricePaid, refPrice, submittedPrice, charge }) {
  const paid = Number(pricePaid) || 0;
  const diff = Math.max(0, (Number(refPrice) || 0) - paid);
  if (diff === 0) return { finalPrice: Math.max(Number(submittedPrice) || 0, paid), topUp: 0, waived: 0 };
  if (charge) return { finalPrice: paid + diff, topUp: diff, waived: 0 };
  return { finalPrice: paid, topUp: 0, waived: diff };
}

// Takes back the extra the LAST swap charged: drops the payment that swap
// recorded (kind 'extension', the top-up amount, dated the swap's day — see
// lib/payments.js priceDeltaPayment) and lowers the running price by the same
// amount. Returns { price, payments, swap_history, waived }, or null when the
// last swap charged nothing or its payment can't be found — nothing is
// changed then, so price and payments can never disagree.
function waiveLastTopUp(customer) {
  const history = (customer && customer.swap_history) || [];
  if (!history.length) return null;
  const last = history[history.length - 1];
  const amount = Number(last && last.top_up) || 0;
  if (amount <= 0) return null;
  const day = String(last.at || '').slice(0, 10);
  const payments = (customer.payments || []).slice();
  const at = payments.findIndex(p => p && p.kind === 'extension' && Number(p.amount) === amount && p.date === day);
  if (at < 0) return null;
  payments.splice(at, 1);
  const swap_history = history.slice(0, -1).concat([Object.assign({}, last, {
    top_up: 0,
    top_up_waived: amount,
    price_after: Math.max(0, (Number(last.price_after) || 0) - amount)
  })]);
  return { price: Math.max(0, (Number(customer.price) || 0) - amount), payments, swap_history, waived: amount };
}

module.exports = { swapPrice, waiveLastTopUp };
