// Trending lane: games people acted on in the last 7 days.
// A rental start counts most, then an order or a request, then a game-page view.
// When that window is empty, the list falls back to the most-rented games
// (or the newest games, when nobody has rented anything). Display only.

const WINDOW_MS = 7 * 86400000;
const WEIGHT = { rental: 3, order: 2, request: 2, view: 1 };
const LIMIT = 24;

function atMs(value) {
  if (value == null || value === '') return NaN;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

function gameId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function add(scores, id, n) {
  const k = gameId(id);
  if (!k || !(n > 0)) return;
  scores.set(k, (scores.get(k) || 0) + n);
}

function inWindow(value, since, now) {
  const t = atMs(value);
  return Number.isFinite(t) && t >= since && t <= now;
}

function fallback(games) {
  const list = (games || []).filter(Boolean);
  const rented = list
    .filter(g => (Number(g.renters) || 0) > 0)
    .sort((a, b) => (Number(b.renters) || 0) - (Number(a.renters) || 0) || String(a.title).localeCompare(String(b.title)));
  if (rented.length) return rented.slice(0, LIMIT);
  return list
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(a.title).localeCompare(String(b.title)))
    .slice(0, LIMIT);
}

// sources: { customers, orders, views, requests, now }
// views and requests are { game_id, at }.
function rank(games, sources) {
  const src = sources || {};
  const nowDate = src.now instanceof Date ? src.now : new Date(src.now || Date.now());
  const now = nowDate.getTime();
  const since = now - WINDOW_MS;
  const scores = new Map();

  (src.customers || []).forEach(c => {
    if (!c || !inWindow(c.start_date, since, now)) return;
    add(scores, c.game_id, WEIGHT.rental);
  });
  (src.orders || []).forEach(o => {
    if (!o || o.state === 'cancelled') return;
    if (!inWindow(o.created_at, since, now)) return;
    add(scores, o.game_id, WEIGHT.order);
  });
  (src.requests || []).forEach(r => {
    if (!r || !inWindow(r.at, since, now)) return;
    add(scores, r.game_id, WEIGHT.request);
  });
  (src.views || []).forEach(v => {
    if (!v || !inWindow(v.at, since, now)) return;
    add(scores, v.game_id, WEIGHT.view);
  });

  const byId = new Map((games || []).filter(Boolean).map(g => [gameId(g.id), g]));
  const hot = [...scores.entries()]
    .map(([id, score]) => ({ game: byId.get(id), score }))
    .filter(row => row.game && row.score > 0)
    .sort((a, b) => b.score - a.score || String(a.game.title).localeCompare(String(b.game.title)))
    .slice(0, LIMIT);

  if (hot.length) {
    return {
      fallback: false,
      games: hot.map(row => row.game),
      scores: hot.map(row => ({ id: row.game.id, score: row.score }))
    };
  }
  return { fallback: true, games: fallback(games), scores: [] };
}

module.exports = { WINDOW_MS, WEIGHT, LIMIT, rank };
