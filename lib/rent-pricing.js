// What a rental costs for a duration the site does not sell.
//
// The public site offers exactly two durations, 7 and 30 days, and every price
// field on a game is named for one of them. The admin's Quick Add form has a
// "Custom…" duration for hand-arranged deals — a 5-day loan, a 45-day one — and
// it needs a number to charge. This module is that number, kept pure so the
// admin form's live preview and the server that saves the order can be shown to
// agree instead of merely claimed to.
//
// The curve, given a weekly price p7 and a monthly price p30:
//
//   d < 7        pro-rata at the weekly rate      p7 * d / 7
//   d = 7        the weekly price
//   7 < d < 30   straight line from p7 to p30
//   d = 30       the monthly price
//   d > 30       pro-rata at the monthly rate     p30 * d / 30
//
// The middle case is the one worth explaining. Pro-rating everything under 30
// days at the WEEKLY rate — the obvious rule, and the one the form used to
// preview — quotes 29 days at ₱824 when 30 days costs ₱599, because the weekly
// rate is deliberately the expensive one. Interpolating between the two tiers
// keeps the price rising with the rental and keeps every custom quote inside
// the two prices the customer could have picked themselves.

const STANDARD_DAYS = Object.freeze([7, 30]);

// A promo percentage off a tier price. Lives here so the save path, the admin
// form's option data, and anything else that quotes a rental all round the
// discount the same way.
function discounted(base, pct) {
  const b = Number(base) || 0;
  const p = Number(pct) || 0;
  if (!b || p <= 0) return b;
  return b - Math.round(b * p / 100);
}

function isStandard(days) {
  return STANDARD_DAYS.includes(days);
}

function amountForDays(days, tier) {
  const d = Number(days);
  if (!Number.isInteger(d) || d < 1) return null;

  const p7 = Number(tier && tier[7]) || 0;
  const p30 = Number(tier && tier[30]) || 0;
  if (!p7 && !p30) return null;

  // An exact tier is never derived — charge the price as set.
  if (d === 7 && p7) return { amount: p7, prorated: false, basis: 'weekly' };
  if (d === 30 && p30) return { amount: p30, prorated: false, basis: 'monthly' };

  // With one tier missing there is only one rate to work from, whatever the
  // duration. Better a pro-rata quote off the tier that exists than refusing
  // to price a game whose other field was never filled in.
  if (!p30) return { amount: Math.round(p7 * d / 7), prorated: true, basis: 'weekly-prorata' };
  if (!p7) return { amount: Math.round(p30 * d / 30), prorated: true, basis: 'monthly-prorata' };

  if (d < 7) return { amount: Math.round(p7 * d / 7), prorated: true, basis: 'weekly-prorata' };
  if (d > 30) return { amount: Math.round(p30 * d / 30), prorated: true, basis: 'monthly-prorata' };

  return {
    amount: Math.round(p7 + (p30 - p7) * (d - 7) / 23),
    prorated: true,
    basis: 'interpolated'
  };
}

// PS4 Primary has no price fields of its own. A new rental uses the Trophy
// week and month prices, the same numbers the game page already shows.
// Non-Trophy stays on its own fields. Anything else is not a rental type.
function accountPriceType(type) {
  if (type === 'tr' || type === 'ps4') return 'tr';
  if (type === 'nt') return 'nt';
  return null;
}

// Trophy and PS4 Primary both take the refundable deposit. Non-Trophy does not.
function chargesDeposit(type) {
  return type === 'tr' || type === 'ps4';
}

// A new 7-day or 30-day rental. `pct` is the promo percent already chosen for
// that duration (0 when none is on). The deposit is added after the percent,
// and it is not itself discounted. This quotes a new order. It does not read
// or rewrite an amount already stored on an order.
function quoteRent(resolved, type, days, pct, depositAmount) {
  const priceType = accountPriceType(type);
  const d = Number(days);
  if (!priceType || !STANDARD_DAYS.includes(d)) return null;
  const base = Number(resolved && resolved[priceType + '_price_' + d + 'd']) || 0;
  if (base <= 0) return null;
  const amountDue = discounted(base, pct);
  const depositDue = chargesDeposit(type) ? (Number(depositAmount) || 0) : 0;
  return { priceType, base, amountDue, depositDue, total: amountDue + depositDue };
}

module.exports = {
  STANDARD_DAYS, isStandard, discounted, amountForDays,
  accountPriceType, chargesDeposit, quoteRent
};
