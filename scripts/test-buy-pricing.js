// Run: node scripts/test-buy-pricing.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const buy = require('../lib/buy-pricing');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const OFF = { buy_promo_enabled: false, buy_promo_pct: 20 };
const ON = { buy_promo_enabled: true, buy_promo_pct: 10 };

console.log('\nbuyPromoPct()');

ok('off unless switched on AND an actual discount', () => {
  assert.strictEqual(buy.buyPromoPct(OFF), 0, 'disabled means no discount');
  assert.strictEqual(buy.buyPromoPct({ buy_promo_enabled: true, buy_promo_pct: 0 }), 0);
  assert.strictEqual(buy.buyPromoPct(ON), 10);
});

ok('nonsense percentages are ignored rather than applied', () => {
  assert.strictEqual(buy.buyPromoPct({ buy_promo_enabled: true, buy_promo_pct: -5 }), 0);
  assert.strictEqual(buy.buyPromoPct({ buy_promo_enabled: true, buy_promo_pct: 150 }), 0);
  assert.strictEqual(buy.buyPromoPct({ buy_promo_enabled: true, buy_promo_pct: 'abc' }), 0);
  assert.strictEqual(buy.buyPromoPct(null), 0);
});

console.log('\ndiscountedBuy()');

ok('takes the promo off', () => {
  assert.strictEqual(buy.discountedBuy(2499, ON), 2249);
  assert.strictEqual(buy.discountedBuy(799, ON), 719);
});

ok('leaves the price alone when there is no promo', () => {
  assert.strictEqual(buy.discountedBuy(2499, OFF), 2499);
  assert.strictEqual(buy.discountedBuy(2499, null), 2499);
});

ok('a 0% promo returns the exact original, not a rounded round-trip', () => {
  assert.strictEqual(buy.discountedBuy(333, { buy_promo_enabled: true, buy_promo_pct: 0 }), 333);
});

ok('nothing priced stays nothing', () => {
  assert.strictEqual(buy.discountedBuy(0, ON), 0);
  assert.strictEqual(buy.discountedBuy(null, ON), 0);
});

console.log('\npriceFor()');

ok('reads the right field per type, PS4 borrowing Non-Trophy', () => {
  const g = { buy_nt_price: 799, buy_tr_price: 999 };
  assert.strictEqual(buy.priceFor(g, 'nt', OFF).amount, 799);
  assert.strictEqual(buy.priceFor(g, 'tr', OFF).amount, 999);
  assert.strictEqual(buy.priceFor(g, 'ps4', OFF).amount, 799, 'PS4 borrows Non-Trophy');
});

ok('null when that type is not for sale, because 0 is a price and absent is not', () => {
  assert.strictEqual(buy.priceFor({ buy_nt_price: 0, buy_tr_price: 999 }, 'nt', OFF), null);
  assert.strictEqual(buy.priceFor(null, 'nt', OFF), null);
});

ok('reports both figures so a page can show the saving', () => {
  const r = buy.priceFor({ buy_nt_price: 2499 }, 'nt', ON);
  assert.strictEqual(r.base, 2499);
  assert.strictEqual(r.amount, 2249);
  assert.strictEqual(r.discounted, true);
  assert.strictEqual(buy.priceFor({ buy_nt_price: 2499 }, 'nt', OFF).discounted, false);
});

console.log('\nthe pre-order a customer sees is the pre-order they are charged');

// The bug this module exists for: upcoming-detail.ejs discounted the displayed
// pre-order price while the reserve route charged the raw one. Both sides are
// checked here rather than trusted.
ok('the Coming Soon page computes what this module computes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'upcoming-detail.ejs'), 'utf8');
  const m = src.match(/udBuyNtFinal\s*=\s*([^;]+);/);
  assert.ok(m, 'upcoming-detail.ejs still derives udBuyNtFinal');
  const expr = m[1];
  const fn = new Function('udBuyPromoOn', 'udBuyNt', 'udPromo', 'return ' + expr + ';');
  [0, 1, 799, 2499, 3333].forEach(base => {
    [OFF, ON, { buy_promo_enabled: true, buy_promo_pct: 25 }].forEach(promo => {
      const on = !!(promo.buy_promo_enabled && promo.buy_promo_pct > 0);
      const page = fn(on, base, promo);
      const mine = buy.discountedBuy(base, promo);
      assert.strictEqual(page, mine,
        'base ' + base + ' at ' + JSON.stringify(promo) + ': page shows ' + page + ', module says ' + mine);
    });
  });
});

ok('the reserve route prices a pre-order through the shared helper', () => {
  // A static check, because the branch lives inside an Express route. It reads
  // the raw buy_* fields directly once more and the customer is billed a price
  // the page never quoted.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const m = src.match(/if \(isBuyPreorder\) \{[\s\S]*?\n  \} else if \(isUpcoming\)/);
  assert.ok(m, 'the isBuyPreorder branch is still where it was');
  assert.ok(!/game\.buy_(tr|nt)_price/.test(m[0]),
    'the pre-order branch must not read buy_nt_price / buy_tr_price raw — that is the drift');
  assert.ok(/computeBuyPricing|buyPricing\./.test(m[0]),
    'it should price through the shared buy helper');
});

console.log('\n' + passed + ' assertions passed\n');
