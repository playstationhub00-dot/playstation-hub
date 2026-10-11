// Run: node scripts/test-browse-filter-core.js
//
// The Browse catalog rules (public/js/browse-filter-core.js): the URL, which
// games each tab holds, hidden tabs, every sort order, search, filters on top
// of a tab, the filter panel's chips and counts, and what the results bar says.
const assert = require('assert');
const C = require('../public/js/browse-filter-core');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const bands = { low: 200, high: 300 };
const g = (id, title, o) => Object.assign({
  id, title, text: title.toLowerCase(), tier: null, ps4: false, ps5: true, genres: [], from: 249,
  avail: true, availPs4: false, buy: false, bundle: false, rank: null, released: null, deal: 0
}, o || {});
const games = [
  g(1, 'Elden Ring', { tier: '2', genres: ['Action', 'RPG'], rank: 2, released: '2024-03-01' }),
  g(2, 'Tekken 8', { tier: '2', genres: ['Fighting'], ps4: true, availPs4: true, rank: 1, released: '2026-09-20', deal: 20 }),
  g(3, 'Callisto', { tier: '3', genres: ['Horror'], from: 199, avail: false, buy: true }),
  g(4, 'GTA V', { tier: '4', genres: ['Action'], ps4: true, from: 149, rank: 3, released: '2013-09-17', deal: 35 }),
  g(5, 'Main Account', { bundle: true, from: 299, text: 'main account\nelden ring' }),
  g(6, 'Astro Bot', { tier: '1', genres: ['Platformer'], from: 399, released: '2026-10-01' }),
  g(7, 'Bloodborne', { ps4: true, ps5: false, genres: ['Action'], from: null, rank: 4, released: '2015-03-24' })
];
const soon = [
  { id: 11, title: 'Wolverine', text: 'wolverine', order: 0 },
  { id: 12, title: 'Death Stranding 2', text: 'death stranding 2', order: 1 },
  { id: 13, title: 'Atomic Heart', text: 'atomic heart', order: 2 }
];
const psplus = [
  { k: 'a', n: 'Days Gone', c: '', ps4: true, ps5: false, g: 'Action' },
  { k: 'b', n: 'Returnal', c: '', ps4: false, ps5: true, g: 'Shooter' },
  { k: 'c', n: 'Ghost of Tsushima', c: '', ps4: true, ps5: true, g: 'Action' }
];
const data = { games, soon, psplus };
const ctx = {
  bands,
  tiers: [{ id: '1', name: 'New Games', desc: '' }, { id: '2', name: 'Deluxe', desc: 'Big recent AAA games' }, { id: '3', name: 'Special', desc: '' }, { id: '4', name: 'Regular', desc: '' }],
  genres: C.genreList(games)
};
const st = q => C.parseState(q);
const v = q => C.view(data, C.cleanState(st(q), ctx, data), ctx);
const chip = (view, group, value) => view.groups.find(x => x.key === group).chips.find(c => c.value === String(value));

console.log('\nURL');
ok('parses tab, sort, search and every filter and writes them back in a stable order', () => {
  const s = st({ tab: 'deals', sort: 'az', search: ' elden ', tier: '2,3,abc', console: 'ps4,xbox', genre: 'Action,RPG', price: 'low,bogus' });
  assert.strictEqual(C.toQuery(s), 'tab=deals&sort=az&search=elden&tier=2,3&console=ps4&genre=Action,RPG&price=low');
  assert.strictEqual(C.href(C.emptyState()), '/browse');
});
ok('the tab\'s default order and All games stay out of the address', () => {
  assert.strictEqual(C.toQuery(st({ tab: 'new', sort: 'newest' })), 'tab=new');
  assert.strictEqual(C.toQuery(st({ tab: 'all', sort: 'most-rented' })), '');
  assert.strictEqual(C.toQuery(st({ tab: 'coming-soon', sort: 'price-asc' })), 'tab=coming-soon', 'a sort the tab does not offer is dropped');
});
ok('unknown tab → All games; unknown sort → the tab\'s default', () => {
  assert.strictEqual(st({ tab: 'nope' }).tab, 'all');
  assert.strictEqual(st({ sort: 'cheapest' }).sort, '');
  assert.strictEqual(C.sortOf(st({ tab: 'deals' })), 'discount');
  assert.strictEqual(C.sortOf(st({ tab: 'psplus', sort: 'newest' })), 'az');
});
ok('old links open their tab: avail, new, newOnly, buy, bundle, psplus, unit; ps4 and platform still pick PS4', () => {
  assert.strictEqual(st({ avail: '1' }).tab, 'available');
  assert.strictEqual(st({ 'new': '1' }).tab, 'new');
  assert.strictEqual(st({ newOnly: '1' }).tab, 'new');
  assert.strictEqual(st({ buy: '1' }).tab, 'buy');
  assert.strictEqual(st({ bundle: '1' }).tab, 'bundles');
  assert.strictEqual(st({ psplus: '1' }).tab, 'psplus');
  assert.deepStrictEqual([st({ unit: 'ps4' }).tab, st({ unit: 'ps4' }).consoles], ['available', ['ps4']]);
  assert.deepStrictEqual(st({ ps4: '1' }).consoles, ['ps4']);
  assert.deepStrictEqual(st({ platform: 'PS4', console: 'ps4' }).consoles, ['ps4']);
  assert.strictEqual(st({ tab: 'deals', avail: '1' }).tab, 'deals', 'an explicit tab wins');
});
ok('clean state drops tiers and genres with no chip and a tab with no games', () => {
  const s = C.cleanState(st({ tab: 'bundles', tier: '2,9', genre: 'Action,Gone' }), ctx, { games: games.filter(f => !f.bundle), soon, psplus });
  assert.deepStrictEqual([s.tab, s.tiers, s.genres], ['all', ['2'], ['Action']]);
  assert.strictEqual(C.cleanState(st({ tab: 'bundles' }), ctx, data).tab, 'bundles');
});

console.log('\nTabs');
ok('each tab holds its own games, in its default order', () => {
  assert.deepStrictEqual(v({}).ids, [2, 1, 4, 7, 6, 3, 5], 'All games: most rented, then the never-rented A–Z');
  assert.deepStrictEqual(v({ tab: 'most-rented' }).ids, [2, 1, 4, 7], 'Most rented: rented games only');
  assert.deepStrictEqual(v({ tab: 'new' }).ids, [6, 2, 1, 7, 4], 'New releases: newest first');
  assert.deepStrictEqual(v({ tab: 'coming-soon' }).ids, [11, 12, 13], 'Coming soon: the site\'s Coming soon order');
  assert.deepStrictEqual(v({ tab: 'deals' }).ids, [4, 2], 'Deals: biggest discount first');
  assert.deepStrictEqual(v({ tab: 'available' }).ids, [2, 1, 4, 7, 6, 5]);
  assert.deepStrictEqual(v({ tab: 'buy' }).ids, [3]);
  assert.deepStrictEqual(v({ tab: 'bundles' }).ids, [5]);
  const ps = v({ tab: 'psplus' });
  assert.deepStrictEqual([ps.ids, ps.psplus.map(p => p.k), ps.kind], [[], ['a', 'c', 'b'], 'psplus'], 'PS Plus Deluxe: A–Z');
});
ok('New releases holds only the 20 newest released games', () => {
  const many = Array.from({ length: 25 }, (_, i) => g(100 + i, 'Game ' + String(i).padStart(2, '0'), { released: '2026-01-' + String(i + 1).padStart(2, '0') }));
  const view = C.view({ games: many, soon: [], psplus: [] }, st({ tab: 'new' }), ctx);
  assert.strictEqual(view.ids.length, C.NEW_MAX);
  assert.deepStrictEqual([view.ids[0], view.ids[19]], [124, 105]);
});
ok('the tab row: every tab with games, its count for the search and filters, its link', () => {
  const view = v({ tab: 'most-rented', search: 'elden', sort: 'az' });
  assert.deepStrictEqual(view.tabs.map(t => t.key), ['all', 'most-rented', 'new', 'coming-soon', 'deals', 'available', 'buy', 'bundles', 'psplus']);
  assert.deepStrictEqual(view.tabs.map(t => t.count), [2, 1, 1, 0, 0, 2, 0, 1, 0]);
  assert.deepStrictEqual(view.tabs.filter(t => t.on).map(t => t.key), ['most-rented']);
  assert.strictEqual(view.tabs.find(t => t.key === 'new').href, '/browse?tab=new&search=elden', 'another tab keeps the search, starts in its own order');
  const bare = C.view({ games: games.filter(f => !f.bundle && !f.deal), soon: [], psplus: [] }, C.emptyState(), ctx);
  assert.deepStrictEqual(bare.tabs.map(t => t.key), ['all', 'most-rented', 'new', 'available', 'buy'], 'tabs with no games are hidden');
});

console.log('\nSort');
ok('the Sort menu offers each tab its own choices, its default first', () => {
  const keys = q => v(q).sorts.map(o => o.key);
  assert.deepStrictEqual(keys({}), ['most-rented', 'newest', 'price-asc', 'price-desc', 'az']);
  assert.deepStrictEqual(keys({ tab: 'new' }), ['newest', 'most-rented', 'price-asc', 'price-desc', 'az']);
  assert.deepStrictEqual(keys({ tab: 'deals' }), ['discount', 'most-rented', 'newest', 'price-asc', 'price-desc', 'az']);
  assert.deepStrictEqual(keys({ tab: 'coming-soon' }), ['release', 'az']);
  assert.deepStrictEqual(keys({ tab: 'psplus' }), ['az']);
  assert.deepStrictEqual(v({ sort: 'az' }).sorts.filter(o => o.on).map(o => o.label), ['A–Z']);
});
ok('every order: ties by title, missing prices and dates last', () => {
  assert.deepStrictEqual(v({ sort: 'newest' }).ids, [6, 2, 1, 7, 4, 3, 5]);
  assert.deepStrictEqual(v({ sort: 'price-asc' }).ids, [4, 3, 1, 2, 5, 6, 7]);
  assert.deepStrictEqual(v({ sort: 'price-desc' }).ids, [6, 5, 1, 2, 3, 4, 7]);
  assert.deepStrictEqual(v({ sort: 'az' }).ids, [6, 7, 3, 1, 4, 5, 2]);
  assert.deepStrictEqual(v({ tab: 'coming-soon', sort: 'az' }).ids, [13, 12, 11]);
  assert.strictEqual(C.href(C.withSort(st({ tab: 'deals' }), 'price-asc')), '/browse?tab=deals&sort=price-asc');
});
ok('#1–#10 badges only on Most rented in Most rented order', () => {
  assert.strictEqual(v({ tab: 'most-rented' }).ranked, true);
  assert.strictEqual(v({ tab: 'most-rented', sort: 'az' }).ranked, false);
  assert.strictEqual(v({}).ranked, false);
});

console.log('\nSearch and filters');
ok('search matches the game\'s text on game tabs, the title on Coming soon, the name on PS Plus', () => {
  assert.deepStrictEqual(v({ search: 'ELDEN' }).ids, [1, 5], 'a bundle matches by the games inside it');
  assert.deepStrictEqual(v({ tab: 'coming-soon', search: 'strand' }).ids, [12]);
  assert.deepStrictEqual(v({ tab: 'psplus', search: 'ghost' }).psplus.map(p => p.k), ['c']);
  assert.strictEqual(C.withSearch(C.emptyState(), '  tekken ').search, 'tekken');
});
ok('filters work on top of a tab', () => {
  assert.deepStrictEqual(v({ tab: 'most-rented', console: 'ps4', price: 'low' }).ids, [4]);
  assert.deepStrictEqual(v({ tab: 'available', console: 'ps4' }).ids, [2], 'PS4 only: a PS4 slot must be free');
  assert.deepStrictEqual(v({ tab: 'available', console: 'ps4,ps5' }).ids, [2, 1, 4, 7, 6, 5]);
  assert.deepStrictEqual(v({ tier: '2', genre: 'RPG' }).ids, [1]);
});
ok('filters do not apply on Coming soon or PS Plus Deluxe (the panel keeps All games\' rows)', () => {
  const cs = v({ tab: 'coming-soon', console: 'ps4' });
  assert.deepStrictEqual([cs.ids, cs.filters, cs.notes], [[11, 12, 13], false, []]);
  assert.strictEqual(chip(cs, 'console', 'ps4').count, 3, 'counted on All games');
  assert.strictEqual(v({ tab: 'psplus', genre: 'Shooter' }).psplus.length, 3);
  assert.strictEqual(v({ tab: 'psplus', genre: 'Action' }).selected, 1, 'the filters are kept for the other tabs');
});
ok('panel chips count what the tab would show; a chip nothing in the library has is left out', () => {
  const view = v({ tab: 'most-rented' });
  assert.deepStrictEqual(view.groups.map(x => x.key), ['tier', 'console', 'genre', 'price']);
  assert.strictEqual(chip(view, 'console', 'ps4').count, 3);
  assert.deepStrictEqual([chip(view, 'tier', '3').count, chip(view, 'tier', '3').zero, chip(view, 'tier', '3').href], [0, true, null]);
  assert.strictEqual(chip(view, 'genre', 'Action').href, '/browse?tab=most-rented&genre=Action');
  const on = v({ tab: 'most-rented', genre: 'Action' });
  assert.deepStrictEqual([chip(on, 'genre', 'Action').on, chip(on, 'genre', 'Action').count], [true, 3]);
  const noBundle = C.view({ games: games.filter(f => f.tier !== '1'), soon, psplus }, C.emptyState(), ctx);
  assert.ok(!noBundle.groups[0].chips.some(c => c.value === '1'));
});
ok('the filter bar: one chip per filter (no search chip); Clear all and the empty grid\'s reset', () => {
  const s = st({ tab: 'deals', sort: 'az', search: 'x', tier: '2', console: 'ps4', genre: 'Action', price: 'low' });
  const chips = C.appliedChips(s, ctx);
  assert.deepStrictEqual(chips.map(c => c.label), ['Deluxe', 'PS4', 'Action', 'Under ₱200']);
  assert.strictEqual(chips[1].href, '/browse?tab=deals&sort=az&search=x&tier=2&genre=Action&price=low');
  assert.strictEqual(C.href(C.clearFilters(s)), '/browse?tab=deals&sort=az&search=x');
  assert.strictEqual(C.href(C.resetState(s)), '/browse?tab=deals&sort=az');
  assert.strictEqual(C.selectedCount(s), 4);
  assert.deepStrictEqual(C.clearGroup(s, 'genre').genres, []);
});
ok('tier descriptions for the filtered tiers that have one', () => {
  assert.deepStrictEqual(v({ tier: '2,3' }).notes, [{ name: 'Deluxe', desc: 'Big recent AAA games' }]);
  assert.deepStrictEqual(v({}).notes, []);
});
ok('the results bar and the panel button', () => {
  assert.strictEqual(C.countText(v({ tab: 'most-rented' })), 'Most rented · 4 games');
  assert.strictEqual(C.countText(v({ tab: 'buy' })), 'Buy to keep · 1 game');
  assert.deepStrictEqual(C.applyLabel(v({ tab: 'deals' })), { text: 'Show 2 games', disabled: false });
  assert.deepStrictEqual(C.applyLabel(v({ search: 'zzz' })), { text: 'No games match', disabled: true });
});

console.log('\nPrice bands');
ok('price bands use the card price', () => {
  assert.strictEqual(C.bandOf(199, bands), 'low');
  assert.strictEqual(C.bandOf(200, bands), 'mid');
  assert.strictEqual(C.bandOf(300, bands), 'high');
  assert.strictEqual(C.bandOf(null, bands), null);
  assert.deepStrictEqual(['low', 'mid', 'high'].map(b => C.bandLabel(b, bands)), ['Under ₱200', '₱200–299', '₱300+']);
});
ok('price band settings: two whole numbers, low below high, else the defaults', () => {
  assert.deepStrictEqual(C.parseBands('150', ' 250 '), { low: 150, high: 250 });
  assert.strictEqual(C.parseBands('300', '300'), null);
  assert.strictEqual(C.parseBands('99.5', '200'), null);
  assert.deepStrictEqual(C.normalizeBands(undefined), { low: 200, high: 300 });
  assert.deepStrictEqual(C.genreParts('Action, RPG/Action'), ['Action', 'RPG']);
});

console.log('\n' + passed + ' assertions passed\n');
