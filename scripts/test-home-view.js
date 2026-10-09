// Run: node scripts/test-home-view.js
//
// What the homepage blocks show (lib/home-view.js): banner games, Top rented,
// the Power-up line, trust figures, "Choose your player" prices, quick genres.
const assert = require('assert');
const H = require('../lib/home-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const g = (id, title, o) => Object.assign({ id, title, cover_image: '/c/' + id + '.png', nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, renters: 0 }, o || {});
const now = new Date('2026-10-10T12:00:00Z');
const daysAgo = d => new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10);

ok('weekly price: the cheaper weekly price after the game\'s own discount or the site promo', () => {
  assert.strictEqual(H.weeklyFrom(g(1, 'A'), null), 349);
  assert.strictEqual(H.weeklyFrom(g(1, 'A', { discounts: { 7: 20 } }), null), 279);
  assert.strictEqual(H.weeklyFrom(g(1, 'A'), { enabled: true, discounts: { 7: 10, 30: 0 } }), 314);
  assert.strictEqual(H.weeklyFrom(g(1, 'A', { nt_price_7d: 0, tr_price_7d: 0 }), null), null);
});

ok('banner: pins first in order, then newest; cover art required; no repeats; at most 5', () => {
  const games = [g(1, 'A'), g(2, 'B'), g(3, 'C', { cover_image: '' }), g(4, 'D'), g(5, 'E'), g(6, 'F'), g(7, 'G')];
  const newest = [games[6], games[1], games[2], games[3], games[4], games[5]];
  assert.deepStrictEqual(H.bannerGames(games, [4, 99, '1', 3], newest).map(x => x.id), [4, 1, 7, 2, 5], 'unknown id 99 and coverless 3 skipped');
  assert.deepStrictEqual(H.bannerGames(games, undefined, newest).map(x => x.id), [7, 2, 4, 5, 6]);
  assert.deepStrictEqual(H.bannerGames(games, [], []), []);
});

ok('top rented: last 30 days first, ties and the rest by all-time renters, unrented left out', () => {
  const games = [g(1, 'Alpha', { renters: 50 }), g(2, 'Bravo', { renters: 5 }), g(3, 'Charlie', { renters: 9 }), g(4, 'Delta', { renters: 0 }), g(5, 'Echo', { renters: 9 })];
  const customers = [
    { game_id: 2, start_date: daysAgo(3) }, { game_id: 2, start_date: daysAgo(10) },
    { game_id: 3, start_date: daysAgo(29) }, { game_id: 5, start_date: daysAgo(1) },
    { game_id: 1, start_date: daysAgo(31) }, { game_id: 4, start_date: daysAgo(40) },
    { game_id: 1, start_date: 'not a date' }, { game_id: 3, start_date: '2099-01-01' }
  ];
  assert.deepStrictEqual(H.topRented(games, customers, now).map(x => x.title), ['Bravo', 'Charlie', 'Echo', 'Alpha']);
  const many = Array.from({ length: 14 }, (_, i) => g(i + 1, 'G' + String(i).padStart(2, '0'), { renters: 20 - i }));
  assert.strictEqual(H.topRented(many, [], now).length, 10);
});

ok('power-up: the biggest promo discount, the longer duration on a tie, nothing when off', () => {
  assert.deepStrictEqual(H.powerUp({ enabled: true, discounts: { 7: 0, 30: 10 } }), { pct: 10, days: 30 });
  assert.deepStrictEqual(H.powerUp({ enabled: true, discounts: { 7: 15, 30: 10 } }), { pct: 15, days: 7 });
  assert.deepStrictEqual(H.powerUp({ enabled: true, discounts: { 7: 10, 30: 10 } }), { pct: 10, days: 30 });
  assert.strictEqual(H.powerUp({ enabled: false, discounts: { 30: 10 } }), null);
  assert.strictEqual(H.powerUp({ enabled: true, discounts: { 7: 0, 30: 0 } }), null);
  assert.strictEqual(H.powerUp(undefined), null);
});

ok('trust figures: recommend % and renters, missing or zero left out', () => {
  assert.deepStrictEqual(H.trust({ up: 11, total: 11, pct: 100 }, { n: 300, plus: true }), { recommendPct: 100, renters: '300+' });
  assert.deepStrictEqual(H.trust({ up: 0, total: 0, pct: 0 }, { n: 0, plus: false }), { recommendPct: null, renters: null });
  assert.deepStrictEqual(H.trust(null, { n: 1200, plus: true }), { recommendPct: null, renters: '1,200+' });
});

ok('player prices: lowest trophy, non-trophy, buy and PS Plus weekly', () => {
  const games = [g(1, 'A', { nt_price_7d: 199, tr_price_7d: 249, buy_nt_price: 999 }), g(2, 'B', { buy_tr_price: 499, nt_price_30d: 0 })];
  assert.deepStrictEqual(H.playerPrices(games, 159), { trophy: 249, nonTrophy: 199, buy: 499, psplus: 159 });
  assert.deepStrictEqual(H.playerPrices([g(1, 'A')], 0), { trophy: 399, nonTrophy: 349, buy: null, psplus: null });
});

ok('quick genres: the two genres with the most games, at least 2 each', () => {
  const games = [g(1, 'A', { genre: 'Action, RPG' }), g(2, 'B', { genre: 'Action' }), g(3, 'C', { genre: 'Horror/Action' }), g(4, 'D', { genre: 'Horror' }), g(5, 'E', { genre: 'Sports' })];
  assert.deepStrictEqual(H.quickGenres(games), ['Action', 'Horror']);
  assert.deepStrictEqual(H.quickGenres([g(1, 'A', { genre: 'Sports' })]), []);
});

console.log('\n' + passed + ' assertions passed\n');
