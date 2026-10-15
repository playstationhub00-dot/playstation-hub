// What the Buy shop (GET /buy, GET /buy/catalog) works out before its rules
// file (public/js/buy-catalog-core.js) takes over: how many times each game
// has been bought, the best-selling order, and the admin's spotlight picks —
// reading them from the admin form and turning them into the storefront's
// slides. Pure: server.js passes in the games, customers and settings.
// See docs/superpowers/specs/2026-10-11-buy-game-shop-design.md.

const SPOTLIGHT_MAX = 5;
const SPOTLIGHT_FALLBACK = 3;

// Purchases per game: customer records filed as 'bought', by game id.
function saleCounts(customers) {
  const out = {};
  (customers || []).forEach(c => {
    if (!c || c.status !== 'bought') return;
    const id = Number(c.game_id);
    if (!Number.isInteger(id)) return;
    out[id] = (out[id] || 0) + 1;
  });
  return out;
}

// Game ids, best selling first: most purchases, then the Rent "Most rented"
// order (rentalOrder: games, most rented first), then title.
function bestSellingOrder(games, counts, rentalOrder) {
  const rentPos = new Map((rentalOrder || []).map((g, i) => [Number(g.id), i]));
  const pos = g => (rentPos.has(Number(g.id)) ? rentPos.get(Number(g.id)) : Infinity);
  return (games || []).slice()
    .sort((a, b) => ((counts[b.id] || 0) - (counts[a.id] || 0)) || (pos(a) - pos(b)) || a.title.localeCompare(b.title))
    .map(g => Number(g.id));
}

// The admin form's slide_1..slide_5 ("game:12" / "box:3") → picks in order;
// blanks, anything not on offer and repeats are dropped.
function readSpotlightForm(body, choices) {
  const b = body || {};
  const games = new Set((choices.games || []).map(Number));
  const boxes = new Set((choices.boxes || []).map(Number));
  const out = [];
  for (let i = 1; i <= SPOTLIGHT_MAX; i++) {
    const m = /^(game|box):(\d+)$/.exec(String(b['slide_' + i] || ''));
    if (!m) continue;
    const pick = { kind: m[1], id: Number(m[2]) };
    if (!(pick.kind === 'game' ? games : boxes).has(pick.id)) continue;
    if (out.some(p => p.kind === pick.kind && p.id === pick.id)) continue;
    out.push(pick);
  }
  return out;
}

// The storefront's spotlight slides: the picks still for sale (a game in the
// shop; a box set with a tier that can be bought), in order; when none are
// left, the first 3 best sellers. Each slide is { kind, item }.
function spotlight(picks, shop, bestIds) {
  const gameById = new Map((shop.games || []).map(f => [Number(f.id), f]));
  const boxById = new Map((shop.boxes || []).map(b => [Number(b.id), b]));
  const slides = [];
  (Array.isArray(picks) ? picks : []).forEach(p => {
    if (!p || slides.length >= SPOTLIGHT_MAX) return;
    const item = p.kind === 'game' ? gameById.get(Number(p.id)) : p.kind === 'box' ? boxById.get(Number(p.id)) : null;
    if (!item || (p.kind === 'box' && !item.open)) return;
    if (slides.some(s => s.kind === p.kind && s.item === item)) return;
    slides.push({ kind: p.kind, item });
  });
  if (slides.length) return slides;
  return (bestIds || []).map(id => gameById.get(Number(id))).filter(Boolean)
    .slice(0, SPOTLIGHT_FALLBACK).map(item => ({ kind: 'game', item }));
}

module.exports = { SPOTLIGHT_MAX, SPOTLIGHT_FALLBACK, saleCounts, bestSellingOrder, readSpotlightForm, spotlight };
