// PlayStation's own PS Plus game-finder data. The public page
// https://www.playstation.com/en-id/ps-plus/games/ builds its game finder from
// these JSON lists — the complete Game Catalog, Classics and Ubisoft+ Classics,
// each game with its cover, platforms and store link — which is far more than
// the 211-title A–Z text list on the same page (that one misses God of War,
// Spider-Man, Ghost of Tsushima and most other first-party games).
//
// Read only when the owner presses "Refresh from PlayStation" in the admin; the
// refresh is previewed and applied by lib/psplus-catalog.js. Nothing here
// touches the database.

// One region for now. Singapore ('en-sg') serves the same feed shape.
const FEED_LOCALE = 'en-id';

// Our list name → PlayStation's categoryList. 'monthly' is never stored as
// catalog games: it only feeds the "Create <Month> entry" suggestion.
const LISTS = Object.freeze({
  catalog: 'plus-games-list',
  classics: 'plus-classics-list',
  ubisoft: 'ubisoft-classics-list',
  monthly: 'plus-monthly-games-list'
});

// Covers are shown straight from PlayStation's image CDN; anything else in the
// feed is dropped rather than rendered on the site.
const IMAGE_HOST = /^https:\/\/image\.api\.playstation\.com\//;
const STORE_HOST = /^https:\/\/store\.playstation\.com\//;

function feedUrl(list) {
  const category = LISTS[list];
  if (!category) throw new Error('lib/psplus-feed: unknown list ' + list);
  return 'https://www.playstation.com/bin/imagic/gameslist?locale=' + FEED_LOCALE + '&categoryList=' + category;
}

// The feed is an array of letter groups: [{ catalogKey: 'A', count, games: [...] }].
// Returns null for any other shape, so a changed feed reads as a failed list
// instead of an empty one.
function parseFeed(json) {
  if (!Array.isArray(json)) return null;
  const games = [];
  json.forEach(group => {
    const list = group && Array.isArray(group.games) ? group.games : [];
    list.forEach(g => {
      if (!g || g.conceptId == null || g.conceptId === '') return;
      const nameRaw = String(g.name || g.nameEn || '').trim();
      if (!nameRaw) return;
      const image = String(g.imageUrl || '');
      const store = String(g.conceptUrl || '');
      const device = Array.isArray(g.device) ? g.device : [];
      const release = String(g.releaseDate || '');
      games.push({
        concept_id: String(g.conceptId),
        name_raw: nameRaw,
        image_url: IMAGE_HOST.test(image) ? image : '',
        // Always PS5 before PS4, whatever order the feed uses.
        platforms: ['PS5', 'PS4'].filter(p => device.includes(p)),
        genres: Array.isArray(g.genre) ? g.genre.map(String) : [],
        release_date: /^\d{4}-\d{2}-\d{2}/.test(release) ? release.slice(0, 10) : '',
        store_url: STORE_HOST.test(store) ? store : ''
      });
    });
  });
  return games;
}

// Never throws: every failure comes back as { ok: false, reason } so the
// refresh can hold that one list back and still offer the others.
async function fetchList(list, { timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(feedUrl(list), {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json' }
    });
    if (!res || !res.ok) return { ok: false, games: [], reason: 'http_' + (res ? res.status : 0) };
    let json;
    try { json = await res.json(); } catch (e) { return { ok: false, games: [], reason: 'bad_json' }; }
    const games = parseFeed(json);
    if (!games) return { ok: false, games: [], reason: 'bad_shape' };
    return { ok: true, games, reason: '' };
  } catch (e) {
    return { ok: false, games: [], reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

// All four lists at once: { catalog: {ok, games, reason}, classics: …, ubisoft: …, monthly: … }.
async function fetchAll(opts) {
  const names = Object.keys(LISTS);
  const results = await Promise.all(names.map(name => fetchList(name, opts)));
  const out = {};
  names.forEach((name, i) => { out[name] = results[i]; });
  return out;
}

module.exports = { FEED_LOCALE, LISTS, feedUrl, parseFeed, fetchList, fetchAll };
