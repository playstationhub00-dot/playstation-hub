// Run: node scripts/test-psplus-catalog-view.js
//
// lib/psplus-catalog-view.js — what the PS Plus Deluxe game list looks like:
// the tag on each card, the "Also for rent" link to the owner's own game, the
// Monthly tag from the owner's month entries, the customer payload with its
// chip counts, the admin rows, and the Refresh preview.
const assert = require('assert');
const view = require('../lib/psplus-catalog-view');
const { OWNER_DEFAULTS } = require('../lib/psplus-catalog');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

function game(id, name, lists, extra) {
  return Object.assign({}, OWNER_DEFAULTS, {
    key: 'c:' + id, source: 'feed', concept_id: String(id), name, name_raw: name, lists,
    image_url: 'https://image.api.playstation.com/' + id + '.png', platforms: ['PS5', 'PS4'], genres: ['ROLE_PLAYING_GAMES'],
    release_date: '2020-07-17', store_url: 'https://store.playstation.com/en-id/concept/' + id,
    first_seen_at: '2026-09-20T01:00:00.000Z', updated_at: '2026-09-20T01:00:00.000Z'
  }, extra || {});
}
const SITE = [
  { id: 7, title: "Ghost of Tsushima Director's Cut" },
  { id: 8, title: 'God of War Ragnarök' },
  { id: 9, title: 'PS Plus Deluxe' }
];
const slugFor = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

console.log('\nsmall rules');

ok('the tag is the most specific list', () => {
  assert.strictEqual(view.primaryTag(['catalog']), 'catalog');
  assert.strictEqual(view.primaryTag(['catalog', 'ubisoft']), 'ubisoft');
  assert.strictEqual(view.primaryTag(['classics']), 'classics');
  assert.strictEqual(view.primaryTag([]), 'catalog');
});

ok('genres and covers read well', () => {
  assert.strictEqual(view.prettyGenre(['ROLE_PLAYING_GAMES', 'ACTION']), 'Role Playing Games');
  assert.strictEqual(view.prettyGenre([]), '');
  assert.strictEqual(view.coverUrl(game(1, 'A', ['catalog']), 240), 'https://image.api.playstation.com/1.png?w=240');
  assert.strictEqual(view.coverUrl(game(1, 'A', ['catalog'], { cover_override: '/uploads/a.webp' }), 240), '/uploads/a.webp');
  assert.strictEqual(view.coverUrl({ image_url: '' }, 240), '');
});

console.log('\nresolveRentLink()');

ok('links automatically when the title is the same game', () => {
  const g = game(1, 'Ghost of Tsushima DIRECTOR\'S CUT', ['catalog']);
  assert.strictEqual(view.resolveRentLink(g, SITE).id, 7);
  assert.strictEqual(view.resolveRentLink(game(2, 'God of War', ['catalog']), SITE), null);
});

ok("the owner's choice stands: a picked game, or none", () => {
  assert.strictEqual(view.resolveRentLink(game(2, 'God of War', ['catalog'], { rent_override: true, rent_game_id: 8 }), SITE).id, 8);
  assert.strictEqual(view.resolveRentLink(game(1, 'Ghost of Tsushima DIRECTOR\'S CUT', ['catalog'], { rent_override: true, rent_game_id: null }), SITE), null);
});

ok('a link to a game that was deleted is no link', () => {
  assert.strictEqual(view.resolveRentLink(game(2, 'X', ['catalog'], { rent_override: true, rent_game_id: 404 }), SITE), null);
});

console.log('\nmonthlyTags()');

const ENTRIES = [
  { id: 1, year: 2026, month: 8, games_list: 'God of War Ragnarök\nStray' },
  { id: 2, year: 2026, month: 9, games_list: 'God of War Ragnarök PS4 & PS5\n\n  Wobbly Life  ' },
  { id: 3, year: 2025, month: 12, games_list: '' }
];

ok('a monthly line that is a catalog game tags it, newest month winning', () => {
  const r = view.monthlyTags(ENTRIES, [game(8, 'God of War Ragnarök', ['catalog'])]);
  assert.strictEqual(r.tagByKey.get('c:8'), 'SEP 2026');
});

ok('any other line becomes a tile, once', () => {
  const r = view.monthlyTags(ENTRIES, [game(8, 'God of War Ragnarök', ['catalog'])]);
  assert.deepStrictEqual(r.tiles.map(t => [t.name, t.label]), [['Wobbly Life', 'SEP 2026'], ['Stray', 'AUG 2026']]);
  assert.ok(r.tiles.every(t => /^mo:\d+:\d+$/.test(t.key)));
});

ok('monthlyTileTitles() lists the same tiles by their lookup key', () => {
  const r = view.monthlyTileTitles(ENTRIES, [game(8, 'God of War Ragnarök', ['catalog'])]);
  assert.deepStrictEqual(r, [{ key: 'wobbly life', name: 'Wobbly Life' }, { key: 'stray', name: 'Stray' }]);
});

console.log('\nbuildPublicCatalog()');

const GAMES = [
  game(1, 'Ghost of Tsushima DIRECTOR\'S CUT', ['catalog']),
  game(2, 'Ape Escape', ['classics'], { platforms: ['PS5', 'PS4'] }),
  game(3, "Assassin's Creed Origins", ['catalog', 'ubisoft'], { platforms: ['PS4'] }),
  game(4, 'Hidden Game', ['catalog'], { hidden: true, hidden_note: 'not on our region' }),
  game(8, 'God of War Ragnarök', ['catalog'], { cover_override: '/uploads/gow.webp' }),
  Object.assign({}, OWNER_DEFAULTS, { key: 'm:1', source: 'manual', name: 'Zeta Hand Added', name_raw: 'Zeta Hand Added', lists: ['catalog'],
    image_url: '', platforms: ['PS5'], genres: [], release_date: '', store_url: 'https://store.playstation.com/x', first_seen_at: '2026-09-27T01:00:00.000Z' })
];

ok('visible games and monthly tiles, A–Z, with the chip counts', () => {
  const c = view.buildPublicCatalog({ games: GAMES, siteGames: SITE, entries: ENTRIES, slugFor });
  assert.deepStrictEqual(c.items.map(i => i.n), ['Ape Escape', "Assassin's Creed Origins", 'Ghost of Tsushima DIRECTOR\'S CUT', 'God of War Ragnarök', 'Stray', 'Wobbly Life', 'Zeta Hand Added']);
  assert.deepStrictEqual(c.counts, { all: 7, catalog: 4, classics: 1, ubisoft: 1, monthly: 3, rent: 2 });
});

ok('each item carries what the card and the sheet show', () => {
  const c = view.buildPublicCatalog({ games: GAMES, siteGames: SITE, entries: ENTRIES, slugFor });
  const ghost = c.items.find(i => i.k === 'c:1');
  assert.deepStrictEqual(ghost, {
    k: 'c:1', n: 'Ghost of Tsushima DIRECTOR\'S CUT', i: 'https://image.api.playstation.com/1.png', c: '', p: ['PS5', 'PS4'],
    l: ['catalog'], t: 'catalog', m: '', g: 'Role Playing Games', r: '2020-07-17', f: '2026-09-20',
    s: 'https://store.playstation.com/en-id/concept/1', rent: { u: '/game/ghost-of-tsushima-director-s-cut', t: "Ghost of Tsushima Director's Cut" }
  });
  const gow = c.items.find(i => i.k === 'c:8');
  assert.deepStrictEqual([gow.i, gow.c, gow.m, gow.rent.u], ['', '/uploads/gow.webp', 'SEP 2026', '/game/god-of-war-ragnar-k']);
  assert.strictEqual(c.items.find(i => i.k === 'c:3').t, 'ubisoft');
  assert.strictEqual(c.items.find(i => i.k === 'm:1').s, '', 'a hand-added game has no PlayStation store link');
  const tile = c.items.find(i => i.n === 'Stray');
  assert.deepStrictEqual([tile.tile, tile.t, tile.m, tile.i, tile.rent], [true, 'monthly', 'AUG 2026', '', null]);
});

ok('a monthly tile with a resolved cover renders like a real card, not a text tile', () => {
  const covers = new Map([['stray', { image_url: 'https://image.api.playstation.com/stray.png', store_url: 'https://www.playstation.com/en-us/games/stray/' }]]);
  const c = view.buildPublicCatalog({ games: GAMES, siteGames: SITE, entries: ENTRIES, slugFor, monthlyCovers: covers });
  const stray = c.items.find(i => i.n === 'Stray');
  assert.deepStrictEqual([stray.tile, stray.i, stray.s, stray.m], [false, 'https://image.api.playstation.com/stray.png', 'https://www.playstation.com/en-us/games/stray/', 'AUG 2026']);
  const wobbly = c.items.find(i => i.n === 'Wobbly Life');
  assert.deepStrictEqual([wobbly.tile, wobbly.i], [true, ''], 'a title with no resolved cover stays a plain tile');
});

ok('a hidden game is nowhere on the customer page', () => {
  const c = view.buildPublicCatalog({ games: GAMES, siteGames: SITE, entries: [], slugFor });
  assert.ok(!c.items.some(i => i.k === 'c:4'));
});

ok('an empty list is an empty page, not an error', () => {
  assert.deepStrictEqual(view.buildPublicCatalog({ games: [], siteGames: [], entries: [], slugFor }).counts,
    { all: 0, catalog: 0, classics: 0, ubisoft: 0, monthly: 0, rent: 0 });
});

console.log('\nbuildAdminCatalog()');

ok('every game, hidden too, with the header counts', () => {
  const a = view.buildAdminCatalog({ games: GAMES, siteGames: SITE, entries: ENTRIES, meta: { last_refreshed_at: '2026-09-24T02:00:00.000Z' }, now: new Date('2026-09-27T05:00:00.000Z') });
  assert.strictEqual(a.rows.length, 6);
  assert.deepStrictEqual(a.counts, { catalog: 5, classics: 1, ubisoft: 1, monthly: 3, hidden: 1, rent: 2, manual: 1 });
  assert.deepStrictEqual([a.lastRefreshedAt, a.daysAgo], ['2026-09-24T02:00:00.000Z', 3]);
  const hidden = a.rows.find(r => r.k === 'c:4');
  assert.deepStrictEqual([hidden.h, hidden.hn, hidden.img], [true, 'not on our region', 'https://image.api.playstation.com/4.png?w=80']);
  const gow = a.rows.find(r => r.k === 'c:8');
  assert.deepStrictEqual([gow.co, gow.rt, gow.ro, gow.rg], [true, 'God of War Ragnarök', false, null]);
  assert.strictEqual(a.rows.find(r => r.k === 'm:1').man, true);
});

ok('never refreshed', () => {
  const a = view.buildAdminCatalog({ games: [], siteGames: [], entries: [], meta: {}, now: new Date() });
  assert.deepStrictEqual([a.lastRefreshedAt, a.daysAgo, a.rows.length], ['', null, 0]);
});

console.log('\npreviewView()');

ok('caps each column, counts the rest, and flags Most Played games that are leaving', () => {
  const many = Array.from({ length: 15 }, (_, i) => game(100 + i, 'New ' + i, ['catalog']));
  const preview = {
    applied: ['catalog', 'ubisoft'],
    safety: { catalog: { state: 'ok', stored: 5, incoming: 20 }, classics: { state: 'blocked', stored: 151, incoming: 0 }, ubisoft: { state: 'warn', stored: 67, incoming: 40 } },
    diff: { added: many, leaving: [game(1, 'Ghost of Tsushima DIRECTOR\'S CUT', ['catalog']), game(2, 'Ape Escape', ['classics'])], updated: [{}, {}, {}], unchanged: 598 }
  };
  const v = view.previewView(preview, ["Ghost of Tsushima Director's Cut"], 12);
  assert.deepStrictEqual([v.added.length, v.addedMore, v.addedCount], [12, 3, 15]);
  assert.deepStrictEqual([v.leavingCount, v.leavingInMostPlayed, v.leaving[0].most, v.leaving[1].most], [2, 1, true, false]);
  assert.deepStrictEqual([v.updatedCount, v.unchanged, v.appliedCount], [3, 598, 2]);
  assert.deepStrictEqual(v.held.map(l => [l.list, l.state, l.label]), [['classics', 'blocked', 'Classics']]);
  assert.deepStrictEqual(v.warned.map(l => l.list), ['ubisoft']);
});

console.log('\nmonthSuggestion()');

ok("offers PlayStation's monthly games only when this month has no entry yet", () => {
  const names = ['Chained Echoes', 'Fallout 76'];
  assert.deepStrictEqual(view.monthSuggestion(names, ENTRIES, '2026-10-02'),
    { year: 2026, month: 10, monthName: 'October', names: ['Chained Echoes', 'Fallout 76'] });
  assert.strictEqual(view.monthSuggestion(names, ENTRIES, '2026-09-27'), null, 'September already has an entry');
  assert.strictEqual(view.monthSuggestion([], ENTRIES, '2026-10-02'), null, 'nothing to suggest');
});

console.log('\n' + passed + ' assertions passed\n');
