// Run: node scripts/test-browse-filter-core.js
//
// The Browse filter rules (public/js/browse-filter-core.js): URLs, matching,
// counts, 0-options, price bands, the one-grid order, the PS Plus section, and
// what the filter bar and filter panel show.
const assert = require('assert');
const C = require('../public/js/browse-filter-core');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const bands = { low: 200, high: 300 };
const g = (id, title, o) => Object.assign({
  id, title, text: title.toLowerCase(), tier: null, ps4: false, ps5: true, genres: [], from: 249,
  avail: true, availPs4: false, isNew: false, buy: false, bundle: false, home: 'other'
}, o || {});
const games = [
  g(1, 'Elden Ring', { tier: '2', genres: ['Action', 'RPG'], from: 249, home: 'cat-2' }),
  g(2, 'Tekken 8', { tier: '2', genres: ['Fighting'], ps4: true, availPs4: true, from: 249, isNew: true, home: 'cat-2' }),
  g(3, 'Callisto', { tier: '3', genres: ['Horror'], from: 199, avail: false, buy: true, home: 'cat-3' }),
  g(4, 'GTA V', { tier: '4', genres: ['Action'], ps4: true, from: 149, home: 'cat-4' }),
  g(5, 'Main Account', { tier: null, bundle: true, genres: [], from: 299, text: 'main account\nelden ring', home: 'bundles' }),
  g(6, 'Astro Bot', { tier: '1', genres: ['Platformer'], from: 399, home: 'cat-1' })
];
const psplus = [
  { k: 'a', n: 'Days Gone', c: '', ps4: true, ps5: false, g: 'Action', j: false },
  { k: 'b', n: 'Returnal', c: '', ps4: false, ps5: true, g: 'Shooter', j: true },
  { k: 'c', n: 'Ghost of Tsushima', c: '', ps4: true, ps5: true, g: 'Action', j: false }
];
const ctx = {
  bands,
  tiers: [{ id: '1', name: 'New Games' }, { id: '2', name: 'Deluxe' }, { id: '3', name: 'Special' }, { id: '4', name: 'Regular' }],
  genres: C.genreList(games), psplusFrom: 159, psplusAvail: true, psplusAvailPs4: false
};
const st = q => C.parseState(q);
const ids = r => r.site.map(f => f.id);
const chip = (v, group, value) => v.groups.find(x => x.key === group).chips.find(c => c.value === String(value));

console.log('\nURL');
ok('parses every group and writes it back in a stable order', () => {
  const s = st({ search: ' ring ', avail: '1', new: '1', tier: '2,3,x', psplus: '1', console: 'ps4,ps9', genre: 'Action,RPG', price: 'low,mid,huge' });
  assert.deepStrictEqual(s, { search: 'ring', avail: true, isNew: true, buy: false, bundle: false, tiers: ['2', '3'], psplus: true, consoles: ['ps4'], genres: ['Action', 'RPG'], prices: ['low', 'mid'] });
  assert.strictEqual(C.toQuery(s), 'search=ring&avail=1&new=1&tier=2,3&psplus=1&console=ps4&genre=Action,RPG&price=low,mid');
  assert.deepStrictEqual(st(Object.fromEntries(new URLSearchParams(C.toQuery(s)))), s, 'round trip');
});
ok('old links keep working', () => {
  assert.deepStrictEqual(st({ ps4: '1' }).consoles, ['ps4']);
  assert.deepStrictEqual(st({ platform: 'PS4' }).consoles, ['ps4']);
  const unit = st({ unit: 'ps4' });
  assert.ok(unit.avail && unit.consoles[0] === 'ps4');
  assert.ok(st({ unit: 'ps5' }).avail && !st({ unit: 'ps5' }).consoles.length);
  assert.ok(st({ newOnly: '1' }).isNew);
  assert.deepStrictEqual(st({ genre: 'Horror' }).genres, ['Horror']);
  assert.deepStrictEqual(st({ genre: ['Action', 'Horror'] }).genres, ['Action', 'Horror'], 'repeated params');
});
ok('genres with commas or slashes split into parts; names with spaces survive the URL', () => {
  assert.deepStrictEqual(C.genreParts('Action, RPG / Horror'), ['Action', 'RPG', 'Horror']);
  assert.deepStrictEqual(C.genreParts(''), []);
  const s = C.toggle(C.emptyState(), 'genre', 'Role Playing Games');
  assert.strictEqual(C.href(s), '/browse?genre=Role%20Playing%20Games');
  assert.deepStrictEqual(st(Object.fromEntries(new URLSearchParams(C.toQuery(s)))).genres, ['Role Playing Games']);
});
ok('tiers and genres with no chip are dropped, so an old link cannot hide everything', () => {
  const s = C.cleanState(st({ tier: '2,99', genre: 'Action,Nope' }), ctx);
  assert.deepStrictEqual([s.tiers, s.genres], [['2'], ['Action']]);
});
ok('toggle flips one chip and leaves the rest', () => {
  let s = C.toggle(C.emptyState(), 'tier', '2');
  s = C.toggle(s, 'show', 'avail');
  s = C.toggle(s, 'tier', 'psplus');
  assert.deepStrictEqual([s.tiers, s.avail, s.psplus], [['2'], true, true]);
  s = C.toggle(s, 'tier', '2');
  assert.deepStrictEqual(s.tiers, []);
  assert.strictEqual(C.selectedCount(s), 2);
});

console.log('\nmatching');
ok('groups narrow each other; chips inside a group widen', () => {
  assert.deepStrictEqual(ids(C.results(games, [], st({ tier: '2,3' }), ctx)), [1, 2, 3]);
  assert.deepStrictEqual(ids(C.results(games, [], st({ tier: '2,3', genre: 'Horror,RPG' }), ctx)), [1, 3]);
  assert.deepStrictEqual(ids(C.results(games, [], st({ genre: 'Action' }), ctx)), [1, 4]);
});
ok('console: PS4 and PS5 chips, and "Available now" means a PS4 slot when only PS4 is on', () => {
  assert.deepStrictEqual(ids(C.results(games, [], st({ console: 'ps4' }), ctx)), [2, 4]);
  assert.deepStrictEqual(ids(C.results(games, [], st({ console: 'ps4', avail: '1' }), ctx)), [2], 'GTA V has no PS4 slot free');
  assert.deepStrictEqual(ids(C.results(games, [], st({ console: 'ps4,ps5', avail: '1' }), ctx)), [1, 2, 4, 5, 6]);
});
ok('search matches title, description and bundle contents', () => {
  assert.deepStrictEqual(ids(C.results(games, [], st({ search: 'ELDEN' }), ctx)), [1, 5]);
});
ok('price bands use the card price', () => {
  assert.strictEqual(C.bandOf(199, bands), 'low');
  assert.strictEqual(C.bandOf(200, bands), 'mid');
  assert.strictEqual(C.bandOf(299, bands), 'mid');
  assert.strictEqual(C.bandOf(300, bands), 'high');
  assert.strictEqual(C.bandOf(null, bands), null);
  assert.deepStrictEqual(ids(C.results(games, [], st({ price: 'low' }), ctx)), [3, 4]);
  assert.deepStrictEqual(['low', 'mid', 'high'].map(b => C.bandLabel(b, bands)), ['Under ₱200', '₱200–299', '₱300+']);
});
ok('price band settings: two whole numbers, low below high, else the defaults', () => {
  assert.deepStrictEqual(C.parseBands('150', ' 250 '), { low: 150, high: 250 });
  assert.strictEqual(C.parseBands('300', '300'), null);
  assert.strictEqual(C.parseBands('0', '100'), null);
  assert.strictEqual(C.parseBands('abc', '100'), null);
  assert.strictEqual(C.parseBands('99.5', '200'), null);
  assert.deepStrictEqual(C.normalizeBands(undefined), { low: 200, high: 300 });
  assert.deepStrictEqual(C.normalizeBands({ low: 500, high: 100 }), { low: 200, high: 300 });
});

console.log('\nchips');
ok('a chip counts what the customer would see if tapped; 0 is dimmed with no link', () => {
  const v = C.view(games, psplus, st({ console: 'ps4' }), ctx);
  assert.strictEqual(chip(v, 'tier', 2).count, 1);
  assert.strictEqual(chip(v, 'genre', 'Horror').count, 0);
  assert.ok(chip(v, 'genre', 'Horror').zero && chip(v, 'genre', 'Horror').href === null);
  assert.strictEqual(chip(v, 'genre', 'Action').href, '/browse?console=ps4&genre=Action');
  assert.ok(chip(v, 'console', 'ps4').on && !chip(v, 'console', 'ps4').zero);
  assert.strictEqual(chip(v, 'console', 'ps4').count, 2, 'an on chip shows the current results');
  assert.strictEqual(chip(v, 'console', 'ps4').href, '/browse', 'tapping it again turns it off');
  assert.strictEqual(chip(v, 'console', 'ps5').count, 6, 'PS4 or PS5');
});
ok('chips only exist for things the library has', () => {
  const v = C.view(games.filter(f => !f.bundle), [], C.emptyState(), ctx);
  const show = v.groups.find(x => x.key === 'show').chips.map(c => c.value);
  assert.deepStrictEqual(show, ['avail', 'new', 'buy'], 'no Bundles chip without bundles');
  assert.ok(!v.groups.find(x => x.key === 'tier').chips.some(c => c.value === 'psplus'), 'no PS Plus chip without PS Plus games');
  assert.deepStrictEqual(v.groups.find(x => x.key === 'genre').chips.map(c => c.value), ['Action', 'Fighting', 'Horror', 'Platformer', 'RPG']);
});

console.log('\nfilter bar and panel');
ok('the bar lists each applied filter with a link that removes just that one', () => {
  const s = st({ tier: '2', psplus: '1', console: 'ps4', genre: 'Action', price: 'low', new: '1', search: 'ring' });
  const chips = C.appliedChips(s, ctx);
  assert.deepStrictEqual(chips.map(c => c.label), ['Just added', 'Deluxe', 'PS Plus Deluxe', 'PS4', 'Action', 'Under ₱200', '"ring"']);
  assert.strictEqual(chips[1].href, '/browse?search=ring&new=1&psplus=1&console=ps4&genre=Action&price=low', 'drops Deluxe only');
  assert.strictEqual(chips[6].href, '/browse?new=1&tier=2&psplus=1&console=ps4&genre=Action&price=low', 'drops the search');
  assert.deepStrictEqual(C.appliedChips(C.emptyState(), ctx), []);
});
ok('a section\'s Clear empties that section only', () => {
  const s = st({ avail: '1', buy: '1', tier: '2', psplus: '1', console: 'ps4', genre: 'Action', price: 'low' });
  const t = C.clearGroup(s, 'tier');
  assert.deepStrictEqual([t.tiers, t.psplus, t.consoles, t.avail], [[], false, ['ps4'], true]);
  const sh = C.clearGroup(s, 'show');
  assert.deepStrictEqual([sh.avail, sh.buy, sh.genres], [false, false, ['Action']]);
});
ok('tick boxes are plain form fields the server already reads', () => {
  assert.deepStrictEqual(C.formField('show', 'new'), { name: 'new', value: '1' });
  assert.deepStrictEqual(C.formField('tier', 'psplus'), { name: 'psplus', value: '1' });
  assert.deepStrictEqual(C.formField('tier', 2), { name: 'tier', value: '2' });
  assert.deepStrictEqual(C.formField('genre', 'Role Playing Games'), { name: 'genre', value: 'Role Playing Games' });
  const s = st({ tier: ['2', '3'], console: ['ps4', 'ps5'], new: '1', psplus: '1' });
  assert.deepStrictEqual([s.tiers, s.consoles, s.isNew, s.psplus], [['2', '3'], ['ps4', 'ps5'], true, true], 'tier=2&tier=3 reads like tier=2,3');
});
ok('the big button and the bar count say what will show', () => {
  const v = s => C.view(games, psplus, st(s), ctx);
  assert.deepStrictEqual(C.applyLabel(v({ tier: '2' })), { text: 'Show 2 games', disabled: false });
  assert.deepStrictEqual(C.applyLabel(v({ tier: '3' })), { text: 'Show 1 game', disabled: false });
  assert.deepStrictEqual(C.applyLabel(v({ psplus: '1' })), { text: 'Show 3 PS Plus games', disabled: false });
  assert.deepStrictEqual(C.applyLabel(v({ search: 'returnal' })), { text: 'Show 1 PS Plus game', disabled: false }, 'only PS Plus has it');
  assert.deepStrictEqual(C.applyLabel(v({ genre: 'Horror', console: 'ps4' })), { text: 'No games match', disabled: true });
  assert.deepStrictEqual(C.applyLabel(v({})), { text: 'Show 6 games', disabled: false });
  assert.strictEqual(C.countText(v({ tier: '2' })), '2 games');
  assert.strictEqual(C.countText(v({ psplus: '1' })), '3 PS Plus games');
});

console.log('\nlayout');
ok('no filter: everything, no grid; filter: one grid by tier order, then A–Z', () => {
  const none = C.view(games, psplus, C.emptyState(), ctx);
  assert.ok(!none.active && none.grid.length === 0 && none.site.length === 6 && !none.psplusOn);
  const f = C.view(games, psplus, st({ console: 'ps4,ps5' }), ctx);
  assert.deepStrictEqual(f.grid, [6, 1, 2, 3, 4, 5], 'New Games, Deluxe A–Z, Special, Regular, then no tier');
});

console.log('\nPS Plus Deluxe');
ok('shown while filtering with the same search, genre, console, just-added, price and availability', () => {
  const p = s => C.results(games, psplus, st(s), ctx).psplus.map(x => x.k);
  assert.deepStrictEqual(p({}), [], 'not without a filter');
  assert.deepStrictEqual(p({ genre: 'Action' }), ['a', 'c']);
  assert.deepStrictEqual(p({ search: 'ghost' }), ['c']);
  assert.deepStrictEqual(p({ console: 'ps5' }), ['b', 'c']);
  assert.deepStrictEqual(p({ new: '1' }), ['b']);
  assert.deepStrictEqual(p({ price: 'low' }), ['a', 'b', 'c'], 'PS Plus from ₱159');
  assert.deepStrictEqual(p({ price: 'mid' }), []);
  assert.deepStrictEqual(p({ avail: '1' }), ['a', 'b', 'c']);
  assert.deepStrictEqual(p({ avail: '1', console: 'ps4' }), [], 'no PS4 slot on the PS Plus account');
});
ok('Can buy and Bundles hide it; other tiers hide it unless PS Plus is on too', () => {
  const p = s => C.results(games, psplus, st(s), ctx).psplus.length;
  assert.strictEqual(p({ buy: '1' }), 0);
  assert.strictEqual(p({ bundle: '1' }), 0);
  assert.strictEqual(p({ tier: '2' }), 0);
  assert.strictEqual(p({ tier: '2', psplus: '1' }), 3);
});
ok('"PS Plus Deluxe" alone: no site games, and chips count PS Plus games', () => {
  const v = C.view(games, psplus, st({ psplus: '1' }), ctx);
  assert.ok(!v.siteOn && v.site.length === 0 && v.psplus.length === 3 && v.psplusOn);
  assert.strictEqual(chip(v, 'genre', 'Action').count, 2, 'PS Plus Action games');
  assert.strictEqual(chip(v, 'tier', 'psplus').count, 3);
  assert.strictEqual(chip(v, 'tier', 2).count, 2, 'tapping Deluxe brings back site games');
  const off = C.view(games, psplus, st({ genre: 'Horror' }), ctx);
  assert.strictEqual(chip(off, 'tier', 'psplus').count, 0, 'PS Plus chip counts PS Plus matches');
  assert.ok(chip(off, 'tier', 'psplus').zero);
});

console.log('\n' + passed + ' assertions passed\n');
