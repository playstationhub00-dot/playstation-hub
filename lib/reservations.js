// What a Coming Soon game costs to reserve before it exists.
//
// Two different things are called a reservation, and they price differently:
//
//   Pre-order (permanent)   paid in full now, nothing owed on release
//   Rental reservation      half now, half when the game actually launches
//
// This module owns the second one. The first is lib/buy-pricing.js, which the
// same page uses — see POST /order/reserve, where both branches sit together.
//
// Pure: no database, no settings read, no clock. The caller passes the game
// record and the promo in.
//
// Deliberately NOT the released-game rental rules, and the differences are
// real rather than oversights to tidy up:
//
//   - Prices come off the upcoming record's own fields. An upcoming game has
//     no price category to resolve, so there is nothing to resolve through.
//   - No promo discount. A Coming Soon reservation is quoted at list price by
//     the public flow, and a quote is a promise; charging a different number
//     in the admin form than the site quoted would be the same preview-vs-save
//     split that has bitten this project twice.
//   - The deposit applies to Trophy only, where a released rental charges it
//     for PS4 Primary too. Upcoming records carry no PS4 price field, so there
//     is no PS4 reservation to charge one on.

// Half, rounded up — so an odd total leaves the SMALLER half owed on release
// rather than the larger. The customer pays the extra peso now, when they are
// already paying, instead of being surprised by it on launch day.
function preorderPricing(game, type, days, promo) {
  if (!game) return null;
  const d = Number(days);
  if (!Number.isInteger(d) || d < 1) return null;

  const base = Number(game[type + '_price_' + d + 'd']) || 0;
  if (base <= 0) return null;

  const deposit = type === 'tr' ? (Number(promo && promo.deposit) || 0) : 0;
  const total = base + deposit;
  const amountDue = Math.ceil(total * 0.5);

  return {
    base,
    deposit,
    total,
    amountDue,
    remainingDue: total - amountDue
  };
}

module.exports = { preorderPricing };
