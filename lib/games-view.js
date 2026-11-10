// Admin → Games tab: the row data the list renders, worked out once on the
// server so the template only draws it.
//
// The slot counts and the New / Sold out flags use the same rules the customer
// site uses — lib/availability.js and the NEW badge's window. "Not rented yet"
// follows real rental records (a payment, a live rental, or the renters
// counter), so the chip cannot sit next to money the game has already earned.
const gameDiscount = require('./game-discount');
const computeAvailability = require('./availability');
const queue = require('./queue');

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
//
// Money is what was actually received — the row's recorded payments — not its
// price: an unpaid Quick Add has a price but no payment yet, and earns
// nothing until that payment is confirmed. A paid row's payments add up to
// its price, so paid rows read exactly as before.
function earningsByGame(customers) {
  const map = new Map();
  (customers || []).forEach(c => {
    if (!c || c.game_id == null || c.game_id === '') return;
    const received = (Array.isArray(c.payments) ? c.payments : [])
      .reduce((s, p) => s + num(p && p.amount), 0);
    if (received <= 0) return;
    const key = String(c.game_id);
    const cur = map.get(key) || { earned: 0, txns: 0 };
    cur.earned += received;
    cur.txns += 1;
    map.set(key, cur);
  });
  return map;
}

// Live rentals and any record that proves the game has been rented. Cancelled
// rows with no payment are not a rental. Coming Soon and PS Plus ids never
// match a catalogue game.
function activityByGame(customers) {
  const map = new Map();
  (customers || []).forEach(c => {
    if (!c || c.game_id == null || c.game_id === '') return;
    const key = String(c.game_id);
    if (key.indexOf('upcoming_') === 0 || key === 'psplus') return;
    const cur = map.get(key) || { active: 0, records: 0 };
    const status = String(c.status || '');
    const paid = (Array.isArray(c.payments) ? c.payments : []).some(p => num(p && p.amount) > 0);
    if (status === 'renting') cur.active += 1;
    if (paid || status === 'renting' || status === 'bought' || status === 'completed' || status === 'reservation') {
      cur.records += 1;
    }
    map.set(key, cur);
  });
  return map;
}

// Priority reservations and the free waiting list, from the order queue the
// game page already uses. Pre-orders (Coming Soon, permanent buys) are not
// this line. `queues` may be a Map from queueByGame().
function queueByGame(orderList, now) {
  const at = now instanceof Date ? now : new Date(now || Date.now());
  const map = new Map();
  (orderList || []).forEach(o => {
    if (!o || o.game_id == null || o.game_id === '') return;
    if (!queue.inQueue(o, at)) return;
    const key = String(o.game_id);
    const cur = map.get(key) || { reserved: 0, waitlist: 0 };
    if (o.state === 'reserved') cur.reserved += 1;
    else cur.waitlist += 1;
    map.set(key, cur);
  });
  return map;
}

function lineFor(queues, id) {
  if (!queues) return { reserved: 0, waitlist: 0 };
  if (typeof queues.get === 'function') return queues.get(String(id)) || { reserved: 0, waitlist: 0 };
  return queues[String(id)] || queues[id] || { reserved: 0, waitlist: 0 };
}

function rentalState(totalFree, activity, line, neverRented) {
  const active = activity.active || 0;
  const reserved = line.reserved || 0;
  const waiting = line.waitlist || 0;
  let label = 'Available';
  let tone = 'stocked';
  if (totalFree === 0) { label = 'Full'; tone = 'sold'; }
  else if (totalFree === 1) { label = '1 slot left'; tone = 'urgent'; }
  else if (active > 0) { label = 'Rented now'; tone = 'rented'; }
  else if (neverRented) { label = 'Not rented yet'; tone = 'never'; }
  const bits = [];
  if (active) bits.push(active + ' active');
  if (reserved) bits.push(reserved + ' reserved');
  if (waiting) bits.push(waiting + ' waiting');
  if (!bits.length && neverRented) bits.push('0 rentals ever');
  return { label, tone, detail: bits.join(' · '), active, reserved, waiting };
}

function slotCap(summaryType) {
  const total = summaryType && Number(summaryType.total);
  return total > 0 ? total : null;
}

function newWindow(game, nowMs) {
  const added = game.created_at ? Date.parse(game.created_at) : NaN;
  if (!Number.isFinite(added)) return { isNew: false, daysLeft: null };
  const windowDays = game.new_window_days || DEFAULT_NEW_WINDOW_DAYS;
  const daysSince = Math.floor((nowMs - added) / DAY_MS);
  if (daysSince >= windowDays) return { isNew: false, daysLeft: null };
  return { isNew: true, daysLeft: windowDays - daysSince };
}

function gameRows(games, customers, accountSummaryMap, now, queues) {
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const money = earningsByGame(customers);
  const activity = activityByGame(customers);
  const summaries = accountSummaryMap || {};
  return (games || []).filter(Boolean).map(g => {
    const sum = summaries[g.id] || null;
    const avail = computeAvailability(g, sum, {});
    const fresh = newWindow(g, nowMs);
    const earned = money.get(String(g.id)) || { earned: 0, txns: 0 };
    const act = activity.get(String(g.id)) || { active: 0, records: 0 };
    const line = lineFor(queues, g.id);
    const cost = num(g.cost);
    const categoryName = g._category_name || '';
    const isBundle = !!g.is_bundle;
    // "20% monthly", "no discount weekly · 20% monthly" — the game's own % from
    // Settings → Game discounts (lib/game-discount.js); '' when it has none.
    const discountTag = [[7, 'weekly'], [30, 'monthly']]
      .map(([d, label]) => {
        const own = gameDiscount.ownPct(g, d);
        return own === null ? '' : (own === 0 ? 'no discount ' + label : own + '% ' + label);
      })
      .filter(Boolean).join(' · ');
    const status = {
      isNew: fresh.isNew,
      daysLeft: fresh.daysLeft,
      // A hand-typed renters count, a stocked flag, a recorded payment, or a
      // live rental all mean it has been rented. Earnings and this chip then
      // agree.
      neverRented: !num(g.renters) && !g.stocked && earned.txns === 0 && act.records === 0,
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
      discountTag,
      slots: {
        nt: avail.ntSlots, tr: avail.trSlots, ps4: avail.ps4Slots,
        ntCap: sum ? slotCap(sum.non_trophy) : null,
        trCap: sum ? slotCap(sum.trophy) : null,
        ps4Cap: sum ? slotCap(sum.ps4_primary) : null,
        showPs4: avail.showPs4, total: avail.totalSlots
      },
      rental: rentalState(avail.totalSlots, act, line, status.neverRented),
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
  const pending = rows.filter(r => r.status === 'pending').length;
  // Pending still needs approve/reject. Approved still needs "mark stocked".
  const needsAction = rows.filter(r => r.status === 'pending' || r.status === 'approved').length;
  return { total: rows.length, pending, needsAction };
}

module.exports = {
  DEFAULT_NEW_WINDOW_DAYS, gameRows, chipCounts, upcomingRows, requestSummary,
  queueByGame, activityByGame
};
