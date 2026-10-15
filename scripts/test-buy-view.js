// Run: node scripts/test-buy-view.js
//
// What the Buy shop works out from the records (lib/buy-view.js): purchases
// per game, the best-selling order, reading the admin's spotlight form, and
// the storefront's spotlight slides.
const assert = require('assert');
const V = require('../lib/buy-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const g = (id, title) => ({ id, title });

ok('purchases per game: only records filed as bought, by game id', () => {
  const counts = V.saleCounts([
    { game_id: 1, status: 'bought' }, { game_id: '1', status: 'bought' }, { game_id: 2, status: 'bought' },
    { game_id: 2, status: 'renting' }, { game_id: 3, status: 'done' }, { game_id: 'upcoming_4', status: 'bought' }, null
  ]);
  assert.deepStrictEqual(counts, { 1: 2, 2: 1 });
  assert.deepStrictEqual(V.saleCounts(undefined), {});
});

ok('best-selling order: most purchases, then most rented, then title', () => {
  const games = [g(1, 'Alpha'), g(2, 'Bravo'), g(3, 'Charlie'), g(4, 'Delta'), g(5, 'Echo')];
  const counts = { 3: 2, 5: 2, 1: 1 };
  const rentalOrder = [g(5, 'Echo'), g(4, 'Delta'), g(2, 'Bravo')];
  assert.deepStrictEqual(V.bestSellingOrder(games, counts, rentalOrder), [5, 3, 1, 4, 2], 'Echo and Charlie tie on sales; Echo is rented more');
  assert.deepStrictEqual(V.bestSellingOrder(games, {}, []), [1, 2, 3, 4, 5], 'nothing sold or rented: A–Z');
});

ok('the admin form: game and box picks in order; blanks, unknown items and repeats dropped', () => {
  const choices = { games: [1, 2, 3], boxes: [7] };
  const picks = V.readSpotlightForm({ slide_1: 'box:7', slide_2: '', slide_3: 'game:2', slide_4: 'game:2', slide_5: 'game:99', slide_6: 'game:1' }, choices);
  assert.deepStrictEqual(picks, [{ kind: 'box', id: 7 }, { kind: 'game', id: 2 }]);
  assert.deepStrictEqual(V.readSpotlightForm({ slide_1: 'box:2', slide_2: 'nonsense', slide_3: 'game:x' }, choices), []);
  assert.deepStrictEqual(V.readSpotlightForm(undefined, choices), []);
});

ok('spotlight: picks still for sale in order; sold-out box sets and gone games skipped', () => {
  const shop = { games: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], boxes: [{ id: 7, open: true }, { id: 8, open: false }] };
  const slides = V.spotlight([{ kind: 'game', id: 3 }, { kind: 'box', id: 8 }, { kind: 'game', id: 99 }, { kind: 'box', id: 7 }, { kind: 'game', id: 3 }], shop, [1, 2]);
  assert.deepStrictEqual(slides.map(s => s.kind + ':' + s.item.id), ['game:3', 'box:7']);
  assert.strictEqual(slides[0].item, shop.games[2], 'the shop\'s own facts');
  const six = [1, 2, 3, 4, 1, 2].map((id, i) => ({ kind: i < 4 ? 'game' : 'box', id }));
  assert.strictEqual(V.spotlight(six, { games: shop.games, boxes: [{ id: 1, open: true }, { id: 2, open: true }] }, []).length, V.SPOTLIGHT_MAX);
});

ok('spotlight fallback: no picks left → the first 3 best sellers', () => {
  const shop = { games: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], boxes: [{ id: 8, open: false }] };
  assert.deepStrictEqual(V.spotlight([{ kind: 'box', id: 8 }], shop, [4, 2, 1, 3]).map(s => s.item.id), [4, 2, 1]);
  assert.deepStrictEqual(V.spotlight(undefined, shop, [9, 3]).map(s => s.item.id), [3]);
  assert.deepStrictEqual(V.spotlight([], { games: [], boxes: [] }, []), []);
});

console.log('\n' + passed + ' assertions passed\n');
