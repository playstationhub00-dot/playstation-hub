// One-time catalogue genre corrections, keyed by the public game slug
// (the same title normalisation as server.js gameSlug). The boot path runs
// this once, then stores ID in state.migrations so a later start does not
// put these genres back over an admin edit. A slug that is not in the
// catalogue is logged and skipped; it does not stop the others.

const ID = 'genre-by-slug-2026-10-14';

const GENRES = Object.freeze({
  'a-way-out': 'Adventure, Co-op',
  'assasins-creed-shadows': 'RPG',
  'assasins-creed-shadows-w-dlc': 'RPG',
  'assassin-s-creed-black-flag-resynced': 'Adventure',
  'battlefield-6': 'Shooter',
  'black-myth-wukong': 'RPG',
  'call-of-duty-black-ops-6': 'Shooter',
  'crimson-desert': 'Adventure',
  'dragon-s-dogma-2-dark-arisen': 'RPG',
  'dying-light-the-beast': 'Horror',
  'expedition-33': 'RPG',
  'final-fantasy-16': 'RPG',
  'final-fantasy-7-rebirth': 'RPG',
  'injustice-2': 'Fighting',
  'it-takes-two': 'Adventure, Co-op',
  'khazan-the-first-berseker': 'RPG',
  'marvel-t-kon-fighting-souls': 'Fighting',
  'one-piece-pirate-warriors-4': 'Action',
  'red-dead-redemption-2-ultimate-edition': 'Adventure',
  'resident-evil-2-deluxe-edition': 'Horror',
  'resident-evil-3': 'Horror',
  'resident-evil-4-gold-edition': 'Horror',
  'resident-evil-5-6': 'Horror',
  'saros': 'Shooter',
  'split-fiction': 'Adventure, Co-op',
  'star-wars-squadron': 'Simulation',
  'tekken-7': 'Fighting',
  'tekken-8': 'Fighting',
  'the-blood-of-dawnwalker': 'Adventure'
});

function slugify(title) {
  if (typeof title !== 'string') return '';
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Returns { write, games, migrations, changed, missing }.
// write is false when the marker is already stored, or when games/migrations
// are not lists (left untouched so boot can continue).
function apply(state, log) {
  const say = typeof log === 'function' ? log : function () {};
  const safe = state && typeof state === 'object' ? state : {};
  const gamesIn = safe.games;
  const existing = safe.migrations;
  if (!Array.isArray(gamesIn)) {
    say('[genre] games is not a list — leaving genres unchanged');
    return { write: false, games: gamesIn, migrations: existing, changed: [], missing: [] };
  }
  if (existing != null && !Array.isArray(existing)) {
    say('[genre] migrations is not a list — leaving genres unchanged');
    return { write: false, games: gamesIn, migrations: existing, changed: [], missing: [] };
  }
  const migrations = Array.isArray(existing) ? existing.slice() : [];
  if (migrations.indexOf(ID) !== -1) {
    return { write: false, games: gamesIn, migrations, changed: [], missing: [] };
  }

  const index = new Map();
  gamesIn.forEach((g, i) => {
    if (!g || typeof g !== 'object') return;
    const slug = slugify(g.title);
    if (!slug || !Object.prototype.hasOwnProperty.call(GENRES, slug)) return;
    if (!index.has(slug)) index.set(slug, []);
    index.get(slug).push(i);
  });

  const games = gamesIn.slice();
  const changed = [];
  const missing = [];
  Object.keys(GENRES).forEach(slug => {
    const hits = index.get(slug);
    if (!hits || !hits.length) {
      missing.push(slug);
      say('[genre] missing slug ' + slug + ' — skipped');
      return;
    }
    hits.forEach(i => {
      const g = games[i];
      const next = GENRES[slug];
      if (g.genre === next) return;
      games[i] = Object.assign({}, g, { genre: next });
      changed.push({ id: g.id, slug, from: g.genre == null ? '' : g.genre, to: next });
      say('[genre] ' + slug + ': ' + JSON.stringify(g.genre == null ? '' : g.genre) + ' → ' + JSON.stringify(next));
    });
  });
  migrations.push(ID);
  say('[genre] recorded ' + ID + ' (' + changed.length + ' updated, ' + missing.length + ' missing)');
  return { write: true, games, migrations, changed, missing };
}

module.exports = { ID, GENRES, slugify, apply };
