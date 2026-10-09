// What the homepage's blocks show (views/partials/home/*): which games lead the
// "Now playing" banner, the Top rented ranking, the Power-up promo line, the
// trust figures, the "Choose your player" prices and the quick-pick genres.
// Pure — server.js GET / passes it the games, customers, promo and settings.
// See docs/superpowers/specs/2026-10-10-homepage-arcade-store-design.md.
const gameDiscount = require('./game-discount');
const browseCore = require('../public/js/browse-filter-core');

const BANNER_MAX = 5;
const TOP_MAX = 10;
const TOP_WINDOW_DAYS = 30;

// The cheapest weekly price a customer pays, after the game's own discount or
// the site promo — the same rule as the game card's prices. null when none.
function weeklyFrom(game, promo) {
  const pct = gameDiscount.discountPct(game, 7, promo);
  const finals = [game.nt_price_7d, game.tr_price_7d]
    .filter(p => p > 0)
    .map(p => gameDiscount.applyPct(p, pct));
  return finals.length ? Math.min(...finals) : null;
}

// Banner games: the owner's pins first (in their order), then the newest
// releases; only games with cover art, no repeats, at most 5.
function bannerGames(games, pinIds, newest) {
  const byId = new Map((games || []).map(g => [Number(g.id), g]));
  const out = [];
  const add = g => {
    if (g && g.cover_image && !out.includes(g) && out.length < BANNER_MAX) out.push(g);
  };
  (Array.isArray(pinIds) ? pinIds : []).forEach(id => add(byId.get(Number(id))));
  (newest || []).forEach(g => add(byId.get(Number(g.id))));
  return out;
}

// Top rented: rentals started in the last 30 days (customer records), ties and
// the rest of the list by the all-time renters figure. Games nobody has rented
// are left out.
function topRented(games, customers, now) {
  const since = (now || new Date()).getTime() - TOP_WINDOW_DAYS * 86400000;
  const recent = new Map();
  (customers || []).forEach(c => {
    const t = Date.parse(c && c.start_date);
    if (!c || c.game_id == null || isNaN(t) || t < since || t > (now || new Date()).getTime()) return;
    const id = Number(c.game_id);
    recent.set(id, (recent.get(id) || 0) + 1);
  });
  return (games || [])
    .map(g => ({ g, n: recent.get(Number(g.id)) || 0, all: Number(g.renters) || 0 }))
    .filter(x => x.n > 0 || x.all > 0)
    .sort((a, b) => (b.n - a.n) || (b.all - a.all) || a.g.title.localeCompare(b.g.title))
    .slice(0, TOP_MAX)
    .map(x => x.g);
}

// The Power-up line: the site promo's biggest rental discount and its
// duration (the longer one on a tie), or null when there is nothing to say.
function powerUp(promo) {
  if (!promo || !promo.enabled || !promo.discounts) return null;
  let best = null;
  [7, 30].forEach(days => {
    const pct = Number(promo.discounts[days]) || 0;
    if (pct > 0 && (!best || pct >= best.pct)) best = { pct, days };
  });
  return best;
}

// Trust figures from the review stats; a missing or zero figure is null.
function trust(recommend, renterCount) {
  return {
    recommendPct: recommend && recommend.total > 0 ? recommend.pct : null,
    renters: renterCount && renterCount.n > 0 ? renterCount.n.toLocaleString('en-US') + (renterCount.plus ? '+' : '') : null
  };
}

// "Choose your player" starting prices (catalogue prices, before discounts).
function playerPrices(games, psplusFrom) {
  const min = keys => {
    const v = (games || []).flatMap(g => keys.map(k => Number(g[k]) || 0).filter(p => p > 0));
    return v.length ? Math.min(...v) : null;
  };
  return {
    trophy: min(['tr_price_7d', 'tr_price_30d']),
    nonTrophy: min(['nt_price_7d', 'nt_price_30d']),
    buy: min(['buy_nt_price', 'buy_tr_price']),
    psplus: psplusFrom > 0 ? psplusFrom : null
  };
}

// Up to two genres with the most games (at least 2 each) for the quick picks.
function quickGenres(games) {
  const count = new Map();
  (games || []).forEach(g => browseCore.genreParts(g.genre).forEach(p => count.set(p, (count.get(p) || 0) + 1)));
  return [...count.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([name]) => name);
}

module.exports = { BANNER_MAX, TOP_MAX, TOP_WINDOW_DAYS, weeklyFrom, bannerGames, topRented, powerUp, trust, playerPrices, quickGenres };
