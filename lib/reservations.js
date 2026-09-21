// What a Coming Soon game costs to reserve before it exists.
//
// Both ways of getting on a not-yet-released game are paid in full up front
// now — a permanent pre-order (lib/buy-pricing.js, used by the same page —
// see POST /order/reserve, where both branches sit together) and the rental
// reservation this module owns. They used to differ (the rental reservation
// split into half now, half on release), but the release-day balance was
// dropped: nothing is still owed once the game launches, for either kind.
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
function preorderPricing(game, type, days, promo) {
  if (!game) return null;
  const d = Number(days);
  if (!Number.isInteger(d) || d < 1) return null;

  const base = Number(game[type + '_price_' + d + 'd']) || 0;
  if (base <= 0) return null;

  const deposit = type === 'tr' ? (Number(promo && promo.deposit) || 0) : 0;
  const total = base + deposit;

  return {
    base,
    deposit,
    total,
    // Paid in full now — kept as its own field (rather than every caller
    // reading `total` directly) so nothing downstream has to know the split
    // was ever removed: amount_due, remaining_due and every "remaining ₱X
    // due on release" line elsewhere already key off exactly these two names.
    amountDue: total,
    remainingDue: 0
  };
}

module.exports = { preorderPricing };
