// What the PS Plus Deluxe game list looks like to customers (/ps-plus, All
// Games tab) and to the owner (admin PS Plus tab): which tag a game carries,
// which of the owner's own games it links to, which month's Monthly tag it
// gets, and the compact rows both pages render from. Pure functions over what
// lib/psplus-catalog-store.js holds — nothing here reads or writes the store.
const { matchKey, STORED_LISTS } = require('./psplus-catalog');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LIST_LABELS = Object.freeze({ catalog: 'Game Catalog', classics: 'Classics', ubisoft: 'Ubisoft+ Classics' });

// The one tag on a card: the most specific list the game is in.
function primaryTag(lists) {
  const l = lists || [];
  if (l.includes('classics')) return 'classics';
  if (l.includes('ubisoft')) return 'ubisoft';
  return 'catalog';
}

// "ROLE_PLAYING_GAMES" → "Role Playing Games".
function prettyGenre(genres) {
  const g = (genres || [])[0];
  if (!g) return '';
  return String(g).toLowerCase().split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// The owner's own cover wins; otherwise PlayStation's, resized by its CDN.
function coverUrl(game, width) {
  if (game && game.cover_override) return game.cover_override;
  if (game && game.image_url) return game.image_url + '?w=' + width;
  return '';
}

// The owner's game this catalog game links to ("Also for rent"), or null.
// Automatic by default (same matchKey as the owner's game title); once the
// owner picks one — or "none" — in the admin, that choice stands.
function resolveRentLink(game, siteGames) {
  const list = Array.isArray(siteGames) ? siteGames : [];
  if (game.rent_override) {
    if (game.rent_game_id == null) return null;
    return list.find(g => g && String(g.id) === String(game.rent_game_id)) || null;
  }
  const k = matchKey(game.name || game.name_raw);
  if (!k) return null;
  return list.find(g => g && g.title && matchKey(g.title) === k) || null;
}

// The owner's month entries (lowdb 'psplus': { id, year, month, games_list })
// are the only source of Monthly tags. Each non-empty games_list line is one
// monthly game; the newest entry wins when a game appears in several. A line
// that matches a catalog game tags that game; any other line becomes a tile.
function monthlyTags(entries, games) {
  const byKey = new Map();
  (games || []).forEach(g => {
    const k = matchKey(g.name || g.name_raw);
    if (!k) return;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(g.key);
  });
  const newestFirst = [...(entries || [])].sort((a, b) => (b.year - a.year) || (b.month - a.month));
  const tagByKey = new Map();
  const tiles = [];
  const seen = new Set();
  newestFirst.forEach(entry => {
    const label = (MONTHS[(entry.month || 1) - 1] || '') + ' ' + entry.year;
    String(entry.games_list || '').split('\n').map(s => s.trim()).filter(Boolean).forEach((line, i) => {
      const k = matchKey(line);
      if (!k || seen.has(k)) return;
      seen.add(k);
      const keys = byKey.get(k);
      if (keys) keys.forEach(key => tagByKey.set(key, label));
      else tiles.push({ key: 'mo:' + entry.id + ':' + i, name: line, label });
    });
  });
  return { tagByKey, tiles };
}

const byName = (a, b) => a.n.localeCompare(b.n, 'en', { sensitivity: 'base' });

// The customer page payload: every visible game plus the monthly-only tiles,
// A–Z, in short keys (the page embeds it as JSON), with the chip counts.
//   k key · n name · i PlayStation cover (no size) · c owner cover · p platforms
//   l lists · t tag · m monthly label · g genre · r release date · f first seen
//   s store link · rent { u, t } · tile (monthly-only)
function buildPublicCatalog({ games, siteGames, entries, slugFor }) {
  const visible = (games || []).filter(g => g && !g.hidden);
  const monthly = monthlyTags(entries, visible);
  const items = visible.map(g => {
    const link = resolveRentLink(g, siteGames);
    return {
      k: g.key, n: g.name || g.name_raw || '', i: g.cover_override ? '' : (g.image_url || ''), c: g.cover_override || '',
      p: g.platforms || [], l: g.lists || [], t: primaryTag(g.lists), m: monthly.tagByKey.get(g.key) || '',
      g: prettyGenre(g.genres), r: g.release_date || '', f: String(g.first_seen_at || '').slice(0, 10),
      s: g.source === 'feed' ? (g.store_url || '') : '',
      rent: link ? { u: '/game/' + slugFor(link.title), t: link.title } : null
    };
  });
  monthly.tiles.forEach(t => items.push({
    k: t.key, n: t.name, i: '', c: '', p: [], l: [], t: 'monthly', m: t.label, g: '', r: '', f: '', s: '', rent: null, tile: true
  }));
  items.sort(byName);
  const counts = { all: items.length, catalog: 0, classics: 0, ubisoft: 0, monthly: 0, rent: 0 };
  items.forEach(it => {
    STORED_LISTS.forEach(l => { if (it.l.includes(l)) counts[l] += 1; });
    if (it.m) counts.monthly += 1;
    if (it.rent) counts.rent += 1;
  });
  return { items, counts };
}

// The admin table rows (every game, hidden too) and the header counts.
//   k key · n name · img cover (sized) · p platforms · t tag · h hidden · hn note
//   ro rent chosen by owner · rg chosen game id · rt linked title · man hand-added
//   co owner cover set
function buildAdminCatalog({ games, siteGames, entries, meta, now }) {
  const all = (games || []).filter(Boolean);
  const monthly = monthlyTags(entries, all.filter(g => !g.hidden));
  const rows = all.map(g => {
    const link = resolveRentLink(g, siteGames);
    return {
      k: g.key, n: g.name || g.name_raw || '', img: coverUrl(g, 80), p: g.platforms || [], t: primaryTag(g.lists),
      h: !!g.hidden, hn: g.hidden_note || '', ro: !!g.rent_override, rg: g.rent_game_id == null ? null : g.rent_game_id,
      rt: link ? link.title : '', man: g.source === 'manual', co: !!g.cover_override
    };
  }).sort(byName);
  const counts = { catalog: 0, classics: 0, ubisoft: 0, monthly: monthly.tagByKey.size + monthly.tiles.length, hidden: 0, rent: 0, manual: 0 };
  all.forEach(g => STORED_LISTS.forEach(l => { if ((g.lists || []).includes(l)) counts[l] += 1; }));
  rows.forEach(r => {
    if (r.h) counts.hidden += 1;
    if (r.rt) counts.rent += 1;
    if (r.man) counts.manual += 1;
  });
  const last = meta && meta.last_refreshed_at ? new Date(meta.last_refreshed_at) : null;
  const daysAgo = last && !isNaN(last) ? Math.max(0, Math.floor(((now || new Date()) - last) / 86400000)) : null;
  return { rows, counts, lastRefreshedAt: last && !isNaN(last) ? last.toISOString() : '', daysAgo };
}

// The Refresh preview, ready to render: at most `cap` games per column, and a
// leaving game flagged when it is also in the owner's Most Played list.
function previewView(preview, mostPlayedTitles, cap) {
  const most = new Set((mostPlayedTitles || []).map(matchKey).filter(Boolean));
  const card = g => ({ n: g.name || g.name_raw, img: coverUrl(g, 80), p: g.platforms || [], t: primaryTag(g.lists),
    most: most.has(matchKey(g.name || g.name_raw)) });
  const d = preview.diff;
  const lists = STORED_LISTS.map(l => Object.assign({ list: l, label: LIST_LABELS[l] }, preview.safety[l]));
  const held = lists.filter(l => l.state === 'failed' || l.state === 'blocked');
  return {
    lists, held, warned: lists.filter(l => l.state === 'warn'),
    added: d.added.slice(0, cap).map(card), addedMore: Math.max(0, d.added.length - cap), addedCount: d.added.length,
    leaving: d.leaving.slice(0, cap).map(card), leavingMore: Math.max(0, d.leaving.length - cap), leavingCount: d.leaving.length,
    leavingInMostPlayed: d.leaving.filter(g => most.has(matchKey(g.name || g.name_raw))).length,
    updatedCount: d.updated.length, unchanged: d.unchanged,
    appliedCount: preview.applied.length
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// PlayStation's monthly games, offered as a ready-made month entry — only when
// the owner has no entry for the current Manila month yet. `today` is the
// Manila date 'YYYY-MM-DD' (orders.manilaDate()).
function monthSuggestion(names, entries, today) {
  if (!names || !names.length) return null;
  const [year, month] = String(today || '').split('-').map(Number);
  if (!year || !month) return null;
  if ((entries || []).some(e => Number(e.year) === year && Number(e.month) === month)) return null;
  return { year, month, monthName: MONTH_NAMES[month - 1], names: names.slice() };
}

module.exports = {
  MONTHS, LIST_LABELS, primaryTag, prettyGenre, coverUrl, resolveRentLink, monthlyTags,
  buildPublicCatalog, buildAdminCatalog, previewView, monthSuggestion
};
