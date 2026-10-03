// Run: node scripts/test-swap-charge.js
//
// lib/swap-charge.js: a game swap during a rental costs extra only when the
// owner switches the charge on, and an extra charged by an earlier swap can be
// taken back.
const assert = require('assert');
const sc = require('../lib/swap-charge');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

console.log('\nswapPrice');
ok('new game costs more, charge off: price stays what was paid, nothing charged', () => {
  assert.deepStrictEqual(sc.swapPrice({ pricePaid: 599, refPrice: 629, submittedPrice: 599, charge: false }),
    { finalPrice: 599, topUp: 0, waived: 30 });
});
ok('charge off ignores a price the form still carries from before', () => {
  assert.strictEqual(sc.swapPrice({ pricePaid: 599, refPrice: 629, submittedPrice: 629, charge: false }).finalPrice, 599);
});
ok('new game costs more, charge on: the difference is added', () => {
  assert.deepStrictEqual(sc.swapPrice({ pricePaid: 599, refPrice: 629, submittedPrice: 629, charge: true }),
    { finalPrice: 629, topUp: 30, waived: 0 });
});
ok('charge on uses the server price even if the form sent less', () => {
  assert.strictEqual(sc.swapPrice({ pricePaid: 599, refPrice: 629, submittedPrice: 599, charge: true }).finalPrice, 629);
});
ok('cheaper or equal new game: never a refund, never a charge', () => {
  assert.deepStrictEqual(sc.swapPrice({ pricePaid: 699, refPrice: 629, submittedPrice: 699, charge: true }),
    { finalPrice: 699, topUp: 0, waived: 0 });
  assert.deepStrictEqual(sc.swapPrice({ pricePaid: 629, refPrice: 629, submittedPrice: 629, charge: false }),
    { finalPrice: 629, topUp: 0, waived: 0 });
});

console.log('\nwaiveLastTopUp');
const marco = () => ({
  id: 7, customer_name: 'Marco Gilbas', price: 629,
  payments: [
    { amount: 599, date: '2026-09-20', kind: 'rental' },
    { amount: 30, date: '2026-10-02', kind: 'extension' }
  ],
  swap_history: [{
    at: '2026-10-02T05:12:00.000Z', from_game_title: 'Old Game', to_game_title: 'Black Flag',
    price_before: 599, new_game_price: 629, price_after: 629, top_up: 30
  }]
});

ok("removes that swap's payment, lowers the price and marks the swap as waived", () => {
  const patch = sc.waiveLastTopUp(marco());
  assert.strictEqual(patch.waived, 30);
  assert.strictEqual(patch.price, 599);
  assert.deepStrictEqual(patch.payments, [{ amount: 599, date: '2026-09-20', kind: 'rental' }]);
  const s = patch.swap_history[0];
  assert.strictEqual(s.top_up, 0);
  assert.strictEqual(s.top_up_waived, 30);
  assert.strictEqual(s.price_after, 599);
  assert.strictEqual(s.from_game_title, 'Old Game', 'the rest of the swap record is kept');
});
ok('the input record is not modified', () => {
  const c = marco();
  sc.waiveLastTopUp(c);
  assert.strictEqual(c.payments.length, 2);
  assert.strictEqual(c.swap_history[0].top_up, 30);
});
ok('nothing to take back: no swap, or the last swap charged nothing', () => {
  assert.strictEqual(sc.waiveLastTopUp({ price: 699, payments: [] }), null);
  const c = marco();
  c.swap_history.push({ at: '2026-10-03T00:00:00.000Z', top_up: 0 });
  assert.strictEqual(sc.waiveLastTopUp(c), null);
  assert.strictEqual(sc.waiveLastTopUp(null), null);
});
ok("the swap's payment can't be found (different amount or day): nothing is changed", () => {
  const a = marco();
  a.payments[1].amount = 50;
  assert.strictEqual(sc.waiveLastTopUp(a), null);
  const b = marco();
  b.payments[1].date = '2026-10-05';
  assert.strictEqual(sc.waiveLastTopUp(b), null);
  const c = marco();
  c.payments[1].kind = 'rental';
  assert.strictEqual(sc.waiveLastTopUp(c), null);
});
ok('only one matching payment is removed when two look alike', () => {
  const c = marco();
  c.price = 659;
  c.payments.push({ amount: 30, date: '2026-10-02', kind: 'extension' });
  const patch = sc.waiveLastTopUp(c);
  assert.strictEqual(patch.payments.length, 2);
  assert.strictEqual(patch.price, 629);
});

console.log('\n' + passed + ' assertions passed\n');
