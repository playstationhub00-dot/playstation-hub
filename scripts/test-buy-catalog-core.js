// Run: node scripts/test-buy-catalog-core.js
//
// The Buy shop rules (public/js/buy-catalog-core.js): the URL, which items each
// tab (and so each storefront shelf) holds, the best sellers' top-up, hidden
// tabs, every sort order, search, filters on game tabs only, the filter
// panel's chips, and what the results bar says.
const assert = require('assert');
const C = require('../public/js/buy-catalog-core');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const g = (id, title, o) => Object.assign({
  id, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, text: title.toLowerCase(), cover: '', fx: null, fy: null,
  platform: 'PS5', ps4: false, ps5: true, genres: ['Action'], genre: 'Action', price: 999, was: null,
  nt: true, tr: false, ready: true, sold: 0, order: 99, released: null
}, o || {});
// order is the best-selling order the server builds: sales first, then rentals, then title.
const games = [
  g(1, 'Elden Ring', { price: 1999, sold: 3, order: 2, genres: ['Action', 'RPG'], tr: true, released: '2022-02-25' }),
  g(2, 'GTA V', { sold: 5, order: 1, ps4: true, platform: 'PS4/PS5', released: '2013-09-17' }),
  g(3, 'Spider-Man 2', { price: 2499, order: 4, ready: false, nt: false, tr: true, released: '2023-10-20' }),
  g(4, 'Astro Bot', { price: 1000, order: 5, genres: ['Platformer'], tr: true, released: '2024-09-06' }),
  g(5, 'Bloodborne', { price: 499, sold: 1, order: 3, ps4: true, ps5: false, platform: 'PS4', genres: ['Action', 'RPG'] }),
  g(6, 'Tekken 8', { price: 2000, order: 6, genres: ['Fighting'], released: '2024-01-26' })
];
const box = (id, name, o) => Object.assign({ id, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, text: name.toLowerCase(), gameCount: 2, perGame: null, from: 999, open: true, covers: [], more: 0, tiers: [] }, o || {});
const boxes = [
  box(1, 'PS Hub Main Account', { text: 'ps hub main account\nelden ring\ngta v', gameCount: 12, perGame: 375, from: 4500 }),
  box(2, 'Resident Evil Trilogy', { text: 'resident evil trilogy\nresident evil 2', gameCount: 3, perGame: 500, from: 1499, open: false }),
  box(3, 'Palworld Duo', { from: 899 })
];
const data = { games, boxes };
const st = q => C.parseState(q);
const v = q => C.view(data, C.cleanState(st(q), data));
const chip = (view, group, value) => view.groups.find(x => x.key === group).chips.find(c => c.value === String(value));

console.log('\nURL');
ok('parses tab, sort, search and every filter and writes them back in a stable order', () => {
  const s = st({ tab: 'box-sets', sort: 'az', search: ' x ', console: 'ps4,xbox', genre: 'Action', account: 'tr,zz' });
  assert.strictEqual(C.toQuery(s), 'tab=box-sets&sort=az&search=x&console=ps4&genre=Action&account=tr');
  assert.strictEqual(C.href(C.emptyState()), '/buy/catalog');
});
ok('the tab\'s default order and All games stay out of the address; unknown tab or sort → defaults', () => {
  assert.strictEqual(C.toQuery(st({ tab: 'under-1000', sort: 'price-asc' })), 'tab=under-1000');
  assert.strictEqual(C.toQuery(st({ tab: 'all', sort: 'best-selling' })), '');
  assert.strictEqual(C.toQuery(st({ tab: 'box-sets', sort: 'newest' })), 'tab=box-sets', 'a sort the tab does not offer is dropped');
  assert.strictEqual(st({ tab: 'nope' }).tab, 'all');
  assert.strictEqual(st({ sort: 'cheapest' }).sort, '');
  assert.strictEqual(C.sortOf(st({ tab: '2000-up' })), 'price-asc');
});
ok('clean state drops genres no game has and a tab with nothing in it', () => {
  const s = C.cleanState(st({ tab: 'box-sets', genre: 'Action,Gone' }), { games, boxes: [] });
  assert.deepStrictEqual([s.tab, s.genres], ['all', ['Action']]);
  assert.strictEqual(C.cleanState(st({ tab: 'box-sets' }), data).tab, 'box-sets');
});

console.log('\nTabs and shelves');
ok('each tab holds its own items, in its default order', () => {
  assert.deepStrictEqual(v({}).ids, [2, 1, 5, 3, 4, 6], 'All games: best selling');
  assert.deepStrictEqual(v({ tab: 'best-sellers' }).ids, [2, 1, 5, 3, 4, 6], 'sold games, topped up to 10');
  assert.deepStrictEqual(v({ tab: 'ready-today' }).ids, [2, 1, 5, 4, 6], 'not the set-up-on-order game');
  assert.deepStrictEqual(v({ tab: 'box-sets' }).ids, [1, 2, 3], 'best value: price per game, unknown last');
  assert.deepStrictEqual(v({ tab: 'under-1000' }).ids, [5, 2]);
  assert.deepStrictEqual(v({ tab: '1000-1999' }).ids, [4, 1], '₱1,000 is in the middle shelf, ₱1,999 too');
  assert.deepStrictEqual(v({ tab: '2000-up' }).ids, [6, 3], '₱2,000 starts the top shelf');
  assert.strictEqual(v({ tab: 'box-sets' }).kind, 'boxes');
});
ok('best sellers: only sold games once 10 have sold', () => {
  const many = Array.from({ length: 12 }, (_, i) => g(100 + i, 'Game ' + String(i).padStart(2, '0'), { sold: i < 11 ? 12 - i : 0, order: i + 1 }));
  assert.deepStrictEqual(C.bestSellerIds(many), many.slice(0, 11).map(f => f.id));
  assert.deepStrictEqual(C.bestSellerIds(games), [2, 1, 5, 3, 4, 6]);
});
ok('the tab row: every tab with items, its count for the search and filters, its link', () => {
  const view = v({ tab: 'best-sellers', search: 'elden', sort: 'az' });
  assert.deepStrictEqual(view.tabs.map(t => t.key + ' ' + t.count), ['all 1', 'best-sellers 1', 'ready-today 1', 'box-sets 1', 'under-1000 0', '1000-1999 1', '2000-up 0']);
  assert.deepStrictEqual(view.tabs.filter(t => t.on).map(t => t.key), ['best-sellers']);
  assert.strictEqual(view.tabs.find(t => t.key === 'box-sets').href, '/buy/catalog?tab=box-sets&search=elden', 'another tab keeps the search, starts in its own order');
  const cheap = C.view({ games: games.filter(f => f.price < 1000), boxes: [] }, C.emptyState());
  assert.deepStrictEqual(cheap.tabs.map(t => t.key), ['all', 'best-sellers', 'ready-today', 'under-1000'], 'tabs with nothing are hidden');
});
ok('the storefront\'s shelves: every tab but All games, first 10, empty ones left out', () => {
  const sh = C.shelves(data);
  assert.deepStrictEqual(sh.map(x => x.key), ['best-sellers', 'ready-today', 'box-sets', 'under-1000', '1000-1999', '2000-up']);
  assert.deepStrictEqual(sh[2], { key: 'box-sets', label: 'Box sets', kind: 'boxes', count: 3, ids: [1, 2, 3], href: '/buy/catalog?tab=box-sets' });
  const many = Array.from({ length: 14 }, (_, i) => g(200 + i, 'Cheap ' + String(i).padStart(2, '0'), { price: 299, order: i + 1 }));
  const cheap = C.shelves({ games: many, boxes: [] });
  assert.deepStrictEqual(cheap.map(x => x.key + ' ' + x.ids.length + '/' + x.count), ['best-sellers 10/10', 'ready-today 10/14', 'under-1000 10/14']);
});

console.log('\nSort');
ok('the Sort menu offers each tab its own choices, its default first', () => {
  const keys = q => v(q).sorts.map(o => o.key);
  assert.deepStrictEqual(keys({}), ['best-selling', 'price-asc', 'price-desc', 'az', 'newest']);
  assert.deepStrictEqual(keys({ tab: '1000-1999' }), ['price-asc', 'best-selling', 'price-desc', 'az', 'newest']);
  assert.deepStrictEqual(keys({ tab: 'box-sets' }), ['best-value', 'price-asc', 'az']);
  assert.deepStrictEqual(v({ sort: 'az' }).sorts.filter(o => o.on).map(o => o.label), ['A–Z']);
});
ok('every order: ties by title, missing prices and dates last', () => {
  assert.deepStrictEqual(v({ sort: 'price-asc' }).ids, [5, 2, 4, 1, 6, 3]);
  assert.deepStrictEqual(v({ sort: 'price-desc' }).ids, [3, 6, 1, 4, 2, 5]);
  assert.deepStrictEqual(v({ sort: 'az' }).ids, [4, 5, 1, 2, 3, 6]);
  assert.deepStrictEqual(v({ sort: 'newest' }).ids, [4, 6, 3, 1, 2, 5]);
  assert.deepStrictEqual(v({ tab: 'box-sets', sort: 'price-asc' }).ids, [3, 2, 1]);
  assert.deepStrictEqual(v({ tab: 'box-sets', sort: 'az' }).ids, [3, 1, 2]);
  assert.strictEqual(C.href(C.withSort(st({ tab: 'ready-today' }), 'newest')), '/buy/catalog?tab=ready-today&sort=newest');
});
ok('#1–#3 stickers only on Best sellers in best-selling order', () => {
  assert.strictEqual(v({ tab: 'best-sellers' }).ranked, true);
  assert.strictEqual(v({ tab: 'best-sellers', sort: 'az' }).ranked, false);
  assert.strictEqual(v({}).ranked, false);
});

console.log('\nSearch and filters');
ok('search matches a game\'s title and a box set\'s name or the games inside it', () => {
  assert.deepStrictEqual(v({ search: 'ELDEN' }).ids, [1]);
  assert.deepStrictEqual(v({ tab: 'box-sets', search: 'elden' }).ids, [1]);
  assert.deepStrictEqual(v({ tab: 'box-sets', search: 'resident' }).ids, [2]);
  assert.strictEqual(C.withSearch(C.emptyState(), '  gta ').search, 'gta');
});
ok('filters work on top of a game tab: console, genre, account type', () => {
  assert.deepStrictEqual(v({ console: 'ps4' }).ids, [2, 5]);
  assert.deepStrictEqual(v({ account: 'tr' }).ids, [1, 3, 4]);
  assert.deepStrictEqual(v({ genre: 'RPG' }).ids, [1, 5]);
  assert.deepStrictEqual(v({ tab: '2000-up', account: 'nt' }).ids, [6]);
});
ok('filters do not apply on Box sets (the panel keeps All games\' rows)', () => {
  const b = v({ tab: 'box-sets', console: 'ps4' });
  assert.deepStrictEqual([b.ids, b.filters], [[1, 2, 3], false]);
  assert.strictEqual(chip(b, 'console', 'ps4').count, 2, 'counted on All games');
  assert.strictEqual(b.selected, 1, 'the filters are kept for the other tabs');
});
ok('panel chips count what the tab would show; a chip nothing has is left out', () => {
  const view = v({});
  assert.deepStrictEqual(view.groups.map(x => x.key), ['console', 'genre', 'account']);
  assert.deepStrictEqual(view.groups[1].chips.map(c => c.value), ['Action', 'Fighting', 'Platformer', 'RPG']);
  assert.strictEqual(chip(view, 'account', 'tr').count, 3);
  const top = v({ tab: '2000-up' });
  assert.deepStrictEqual([chip(top, 'console', 'ps4').count, chip(top, 'console', 'ps4').zero, chip(top, 'console', 'ps4').href], [0, true, null]);
  assert.strictEqual(chip(view, 'genre', 'RPG').href, '/buy/catalog?genre=RPG');
});
ok('the filter bar: one chip per filter; Clear all and the empty grid\'s reset', () => {
  const s = st({ tab: 'ready-today', sort: 'az', search: 'x', console: 'ps5', genre: 'Action', account: 'nt' });
  const chips = C.appliedChips(s);
  assert.deepStrictEqual(chips.map(c => c.label), ['PS5', 'Action', 'Non-Trophy']);
  assert.strictEqual(chips[0].href, '/buy/catalog?tab=ready-today&sort=az&search=x&genre=Action&account=nt');
  assert.strictEqual(C.href(C.clearFilters(s)), '/buy/catalog?tab=ready-today&sort=az&search=x');
  assert.strictEqual(C.href(C.resetState(s)), '/buy/catalog?tab=ready-today&sort=az');
  assert.strictEqual(C.selectedCount(s), 3);
  assert.deepStrictEqual(C.clearGroup(s, 'genre').genres, []);
  assert.strictEqual(C.isOn(s, 'account', 'nt'), true);
});
ok('the results bar and the panel button', () => {
  assert.strictEqual(C.countText(v({ tab: 'box-sets' })), 'Box sets · 3 box sets');
  assert.strictEqual(C.countText(v({ tab: 'under-1000' })), 'Under ₱1,000 · 2 games');
  assert.strictEqual(C.countText(v({ tab: '2000-up', console: 'ps5', account: 'tr' })), '₱2,000 and up · 1 game');
  assert.deepStrictEqual(C.applyLabel(v({ tab: 'ready-today' })), { text: 'Show 5 games', disabled: false });
  assert.deepStrictEqual(C.applyLabel(v({ search: 'zzz' })), { text: 'No games match', disabled: true });
});

console.log('\n' + passed + ' assertions passed\n');
