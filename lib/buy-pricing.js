// The permanent-purchase price curve. Tiny, but it exists for the same reason
// lib/rent-pricing.js does: the number a page shows and the number the order
// charges have to come from one place.
//
// They did not. The Coming Soon page discounted a pre-order by the buy promo
// while the reserve route charged the undiscounted price, so with the promo
// switched on a customer was shown one figure and billed a larger one.
//
// Pure: no settings read, no clock, no database. The caller passes the promo in.

// A buy promo only counts when it is both switched on and actually a discount.
// A 0% promo left enabled must not round-trip a price through the maths and
// risk drifting it by a peso.
function buyPromoPct(promo) {
  const p = promo || {};
  if (!p.buy_promo_enabled) return 0;
  const pct = Number(p.buy_promo_pct) || 0;
  return pct > 0 && pct <= 100 ? pct : 0;
}

function discountedBuy(base, promo) {
  const b = Number(base) || 0;
  if (b <= 0) return 0;
  const pct = buyPromoPct(promo);
  return pct > 0 ? Math.round(b * (1 - pct / 100)) : b;
}

// The listed price for one account type. PS4 Primary has no buy price of its
// own and borrows Non-Trophy, the same fallback the rental side uses.
// Null, never 0, when nothing is for sale: 0 is a price, absent is not.
function priceFor(game, type, promo) {
  if (!game) return null;
  const field = type === 'tr' ? 'buy_tr_price' : 'buy_nt_price';
  const base = Number(game[field]) || 0;
  if (base <= 0) return null;
  const amount = discountedBuy(base, promo);
  return { base, amount, discounted: amount !== base };
}

module.exports = { buyPromoPct, discountedBuy, priceFor };
