// Finds rentals that were charged for one duration but recorded as another —
// the "paid for a week, given a month" mistake.
//
// This is a "worth a look" list, never a verdict. Two legitimate things look
// identical to an underpriced rental from here: a deliberate price override
// (a discount for a friend), and a game whose tier prices changed after the
// rental started, since the only tier available now is today's. The caller
// presents these as questions, not errors.
//
// Pure: no database, no settings, no clock. The caller resolves each row's
// price tier and passes it in.

const pricing = require('./rent-pricing');

// Rounding in the price curve means an exact match is the wrong test. Two
// pesos absorbs the rounding; 2% absorbs it on the larger monthly figures.
function toleranceFor(expected) {
  return Math.max(2, Math.round(Math.abs(expected) * 0.02));
}

// What the money actually bought. The largest whole-day duration this price
// covers, which is the number that makes the problem legible: "they paid for
// 7 days and hold the account for 30."
function daysCoveredBy(price, tier, maxDays) {
  let best = 0;
  for (let d = 1; d <= maxDays; d++) {
    const p = pricing.amountForDays(d, tier);
    if (!p) continue;
    if (p.amount <= price + toleranceFor(p.amount)) best = d;
  }
  return best;
}

// The rental as it was first written down, before any extension.
//
// Extensions are priced per segment and added on (server.js's extend route does
// newPrice = prevPrice + ext.amount, newDays = prevDays + ext.days), and the sum
// of two segments never equals the single-span price for their total — a 30-day
// rental extended by 7 legitimately costs less than a 37-day rental. Auditing
// the post-extension totals would therefore flag every extended rental. The
// original mistake, if there is one, is in the base rental, so that is what
// gets audited.
function baselineOf(customer) {
  const exts = Array.isArray(customer.extensions) ? customer.extensions : [];
  const first = exts.find(e => e && typeof e.prevDays === 'number' && typeof e.prevPrice === 'number');
  if (first) return { days: first.prevDays, price: first.prevPrice, extended: true };
  return {
    days: Number(customer.days) || 0,
    price: Number(customer.price) || 0,
    extended: exts.length > 0
  };
}

// Null when there is nothing to say: not a live rental, no duration, no price
// recorded, or no tier to judge against.
function check(customer, tier) {
  if (!customer || customer.status !== 'renting') return null;
  const base = baselineOf(customer);
  if (base.days < 1) return null;
  // An unpaid rental is a different problem with a different answer, and the
  // dashboard already tracks money owed. Silence here rather than duplicate it.
  if (base.price <= 0) return null;

  const expected = pricing.amountForDays(base.days, tier);
  if (!expected) return null;

  const shortfall = expected.amount - base.price;
  if (shortfall <= toleranceFor(expected.amount)) return null;

  return {
    id: customer.id,
    customer_name: customer.customer_name || '',
    game_title: customer.game_title || '',
    account_type: customer.account_type || '',
    order_ref: customer.order_ref || '',
    end_date: customer.end_date || '',
    recordedDays: base.days,
    paidPrice: base.price,
    expectedPrice: expected.amount,
    shortfall,
    paidForDays: daysCoveredBy(base.price, tier, base.days),
    extended: base.extended
  };
}

function scan(customers, tierFor) {
  if (!Array.isArray(customers) || typeof tierFor !== 'function') return [];
  const out = [];
  customers.forEach(c => {
    if (!c) return;
    let tier = null;
    try { tier = tierFor(c); } catch (e) { return; }
    if (!tier) return;
    const hit = check(c, tier);
    if (hit) out.push(hit);
  });
  // Biggest gap first: that is the order the owner should work through them in.
  return out.sort((a, b) => b.shortfall - a.shortfall);
}

module.exports = { scan, check, baselineOf, daysCoveredBy, toleranceFor };
