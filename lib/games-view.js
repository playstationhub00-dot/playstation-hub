// Admin → Games tab: the row data the list renders, worked out once on the
// server so the template only draws it.
//
// The slot counts and the New / Sold out / Never rented flags use the same
// rules the customer site uses — lib/availability.js, the NEW badge's window,
// game-detail.ejs's "not rented yet" check — so the admin list can never
// disagree with what a customer sees for the same game.
const computeAvailability = require('./availability');

const DAY_MS = 86400000;
// Same default as server.js NEW_GAME_WINDOW_DAYS and the site's NEW badge.
const DEFAULT_NEW_WINDOW_DAYS = 11;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// One pass over every customer record, instead of two filter() calls per game.
// Keyed by the string id, so a numeric 7 and a string '7' land together and a
// Coming Soon ('upcoming_5') or PS Plus ('psplus') record never matches a game.
function earningsByGame(customers) {
  const map = new Map();
  (customers || []).forEach(c => {
    if (!c || c.game_id == null || c.game_id === '') return;
    const key = String(c.game_id);
    const cur = map.get(key) || { earned: 0, txns: 0 };
    cur.earned += num(c.price);
    cur.txns += 1;
    map.set(key, cur);
  });
  return map;
}

function newWindow(game, nowMs) {
  const added = game.created_at ? Date.parse(game.created_at) : NaN;
  if (!Number.isFinite(added)) return { isNew: false, daysLeft: null };
  const windowDays = game.new_window_days || DEFAULT_NEW_WINDOW_DAYS;
  const daysSince = Math.floor((nowMs - added) / DAY_MS);
  if (daysSince >= windowDays) return { isNew: false, daysLeft: null };
  return { isNew: true, daysLeft: windowDays - daysSince };
}

function gameRows(games, customers, accountSummaryMap, now) {
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const money = earningsByGame(customers);
  const summaries = accountSummaryMap || {};
  return (games || []).filter(Boolean).map(g => {
    const avail = computeAvailability(g, summaries[g.id] || null, {});
    const fresh = newWindow(g, nowMs);
    const earned = money.get(String(g.id)) || { earned: 0, txns: 0 };
    const cost = num(g.cost);
    const categoryName = g._category_name || '';
    const isBundle = !!g.is_bundle;
    const status = {
      isNew: fresh.isNew,
      daysLeft: fresh.daysLeft,
      // game-detail.ejs: `const neverRented = !game.renters && !game.stocked;`
      neverRented: !g.renters && !g.stocked,
      soldOut: avail.totalSlots === 0,
      stocked: !!g.stocked
    };
    const chips = [];
    if (status.isNew) chips.push('new');
    if (status.soldOut) chips.push('soldout');
    if (status.neverRented) chips.push('never');
    if (isBundle) chips.push('bundle');
    return {
      id: g.id,
      title: g.title || '',
      platform: g.platform || '',
      genre: g.genre || '',
      cover: g.cover_image || '',
      categoryName,
      isBundle,
      slots: { nt: avail.ntSlots, tr: avail.trSlots, ps4: avail.ps4Slots, showPs4: avail.showPs4, total: avail.totalSlots },
      prices: {
        nt7: num(g.nt_price_7d), nt30: num(g.nt_price_30d),
        tr7: num(g.tr_price_7d), tr30: num(g.tr_price_30d),
        buyNt: num(g.buy_nt_price), buyTr: num(g.buy_tr_price)
      },
      status,
      chips,
      money: { earned: earned.earned, txns: earned.txns, cost, profit: earned.earned - cost },
      search: [g.title, g.genre, categoryName].filter(Boolean).join(' ').toLowerCase()
    };
  });
}

function chipCounts(rows) {
  const counts = { all: 0, new: 0, soldout: 0, never: 0, bundle: 0 };
  (rows || []).forEach(r => {
    counts.all++;
    (r.chips || []).forEach(c => { if (counts[c] !== undefined) counts[c]++; });
  });
  return counts;
}

function formatDate(ymd) {
  const d = new Date(ymd + 'T00:00:00');
  return isNaN(d) ? ymd : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Coming soon rows. `ready` is the launch-day nudge: a real release date on
// or before today in Manila (dates compare as YYYY-MM-DD strings).
function upcomingRows(upcoming, reservedCount, todayManila) {
  const counts = reservedCount || {};
  return (upcoming || []).filter(Boolean).map(u => {
    const date = u.release_date || '';
    const isRealDate = !!date && date !== 'TBA';
    const ready = !!(todayManila && isRealDate && date <= todayManila);
    return {
      id: u.id,
      title: u.title || '',
      platform: u.platform || '',
      cover: u.cover_image || '',
      releaseLabel: date === 'TBA' ? 'TBA' : (isRealDate ? formatDate(date) : '—'),
      reserved: num(counts[u.id]),
      ready,
      outSince: ready ? formatDate(date) : '',
      slots: { nt: num(u.non_trophy_slots), tr: num(u.trophy_slots) },
      prices: { nt7: num(u.nt_price_7d), nt30: num(u.nt_price_30d), tr7: num(u.tr_price_7d), tr30: num(u.tr_price_30d) }
    };
  });
}

function requestSummary(requestRows) {
  const rows = (requestRows || []).filter(Boolean);
  return { total: rows.length, pending: rows.filter(r => r.status === 'pending').length };
}

module.exports = { DEFAULT_NEW_WINDOW_DAYS, gameRows, chipCounts, upcomingRows, requestSummary };
