// Run: node scripts/test-tier-style.js
//
// Tier pill colours and descriptions (lib/tier-style.js).
const assert = require('assert');
const T = require('../lib/tier-style');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

ok('a category with no colour picked gets one from its name', () => {
  assert.strictEqual(T.pillColor({ name: 'New Games' }), 'blue');
  assert.strictEqual(T.pillColor({ name: 'Deluxe' }), 'purple');
  assert.strictEqual(T.pillColor({ name: 'Special Price' }), 'coral');
  assert.strictEqual(T.pillColor({ name: 'Regular' }), 'grey');
  assert.strictEqual(T.pillColor({ name: 'Classics' }), 'grey');
});
ok('the owner\'s pick wins; anything else falls back to the name', () => {
  assert.strictEqual(T.pillColor({ name: 'Regular', pill_color: 'teal' }), 'teal');
  assert.strictEqual(T.pillColor({ name: 'Deluxe', pill_color: 'gold' }), 'purple');
  assert.strictEqual(T.cleanColor('pink'), 'pink');
  assert.strictEqual(T.cleanColor('#ff0000'), null);
  assert.strictEqual(T.cleanColor(undefined), null);
});
ok('descriptions are one trimmed line of at most 120 characters', () => {
  assert.strictEqual(T.cleanDescription('  Big   recent\nAAA games  '), 'Big recent AAA games');
  assert.strictEqual(T.cleanDescription(undefined), '');
  assert.strictEqual(T.cleanDescription('x'.repeat(200)).length, 120);
});
ok('a game\'s tier comes from its price category', () => {
  const cats = [{ id: 2, name: 'Deluxe', description: 'Big recent AAA games' }, { id: 3, name: 'Special', pill_color: 'pink' }];
  assert.deepStrictEqual(T.tierOf({ price_category_id: 2 }, cats), { id: 2, name: 'Deluxe', color: 'purple', description: 'Big recent AAA games' });
  assert.deepStrictEqual(T.tierOf({ price_category_id: '3' }, cats), { id: 3, name: 'Special', color: 'pink', description: '' });
  assert.strictEqual(T.tierOf({ price_category_id: 9 }, cats), null, 'deleted category');
  assert.strictEqual(T.tierOf({ price_category_id: null }, cats), null);
  assert.strictEqual(T.tierOf(null, cats), null);
});

console.log('\n' + passed + ' assertions passed\n');
