// Per-game rent discounts. The site promo (site_settings.promo) gives every
// game the same Weekly % and Monthly %; a game may carry its own instead:
//
//   game.discounts = { 7: number | null, 30: number | null }
//
// A number (0–100) REPLACES the site promo for that game and duration — 20
// means 20%, never 10% + 20% — and 0 means no discount. Missing / null means
// the game follows the site promo. A game's own % ignores the site promo's
// on/off switch: turning the site promo off only removes the default.
// Pure; server.js and the views call these through app.locals.

// The site promo's % for a duration (0 when it is off or has none).
function sitePct(promo, days) {
  if (!promo || !promo.enabled || !promo.discounts) return 0;
  return Number(promo.discounts[days]) || 0;
}

// The game's own % for a duration, or null when it follows the site promo.
function ownPct(game, days) {
  const d = game && game.discounts;
  if (!d || typeof d !== 'object') return null;
  const v = d[days];
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function hasOwnDiscount(game, days) {
  return ownPct(game, days) !== null;
}

// The % to take off `game`'s `days`-day price.
function discountPct(game, days, promo) {
  const own = ownPct(game, days);
  return own !== null ? own : sitePct(promo, days);
}

// The duration where the game's own % beats the site promo by the most, as
// { days, pct }, or null when no own % beats it. Monthly wins a tie. Drives
// the homepage "Special deals" row and its ribbon.
function specialDeal(game, promo) {
  let best = null;
  [30, 7].forEach(days => {
    const own = ownPct(game, days);
    if (own === null) return;
    const gain = own - sitePct(promo, days);
    if (gain <= 0) return;
    if (!best || gain > best.gain) best = { days, pct: own, gain };
  });
  return best ? { days: best.days, pct: best.pct } : null;
}

// A table box's value: null for empty or not a number, else 0–100.
function cleanInput(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

// base − round(base × pct / 100): the rounding every price on the site uses.
function applyPct(base, pct) {
  const b = Number(base) || 0;
  return pct > 0 ? b - Math.round(b * pct / 100) : b;
}

module.exports = { sitePct, ownPct, hasOwnDiscount, discountPct, specialDeal, cleanInput, applyPct };
