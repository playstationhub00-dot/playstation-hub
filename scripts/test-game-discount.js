// Run: node scripts/test-game-discount.js
const assert = require('assert');
const gd = require('../lib/game-discount');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const SITE_ON = { enabled: true, discounts: { 7: 0, 30: 10 } };
const SITE_OFF = { enabled: false, discounts: { 7: 0, 30: 10 } };

console.log('\ndiscountPct');
ok("a game's own % replaces the site promo (never stacks)", () => {
  assert.strictEqual(gd.discountPct({ discounts: { 30: 20 } }, 30, SITE_ON), 20);
});
ok('empty / missing / null follows the site promo', () => {
  assert.strictEqual(gd.discountPct({}, 30, SITE_ON), 10);
  assert.strictEqual(gd.discountPct({ discounts: { 30: null } }, 30, SITE_ON), 10);
  assert.strictEqual(gd.discountPct({ discounts: { 30: '' } }, 30, SITE_ON), 10);
  assert.strictEqual(gd.discountPct({ discounts: { 7: 15 } }, 30, SITE_ON), 10, 'other duration set only');
  assert.strictEqual(gd.discountPct(null, 30, SITE_ON), 10);
});
ok('0 means no discount for that game', () => {
  assert.strictEqual(gd.discountPct({ discounts: { 30: 0 } }, 30, SITE_ON), 0);
});
ok('site promo off: own % still applies, everything else is full price', () => {
  assert.strictEqual(gd.discountPct({ discounts: { 30: 20 } }, 30, SITE_OFF), 20);
  assert.strictEqual(gd.discountPct({}, 30, SITE_OFF), 0);
  assert.strictEqual(gd.discountPct({}, 30, null), 0);
});
ok('stored values are clamped and rounded', () => {
  assert.strictEqual(gd.discountPct({ discounts: { 30: 150 } }, 30, SITE_ON), 100);
  assert.strictEqual(gd.discountPct({ discounts: { 30: -5 } }, 30, SITE_ON), 0);
  assert.strictEqual(gd.discountPct({ discounts: { 30: '19.6' } }, 30, SITE_ON), 20);
  assert.strictEqual(gd.discountPct({ discounts: { 30: 'abc' } }, 30, SITE_ON), 10, 'junk follows the site promo');
});

console.log('\nhasOwnDiscount / sitePct');
ok('own vs site', () => {
  assert.strictEqual(gd.hasOwnDiscount({ discounts: { 30: 0 } }, 30), true);
  assert.strictEqual(gd.hasOwnDiscount({ discounts: { 30: null } }, 30), false);
  assert.strictEqual(gd.hasOwnDiscount({}, 7), false);
  assert.strictEqual(gd.sitePct(SITE_ON, 30), 10);
  assert.strictEqual(gd.sitePct(SITE_OFF, 30), 0);
});

console.log('\nspecialDeal');
ok('own % above the site promo is a deal; Monthly wins a tie', () => {
  assert.deepStrictEqual(gd.specialDeal({ discounts: { 30: 20 } }, SITE_ON), { days: 30, pct: 20 });
  assert.deepStrictEqual(gd.specialDeal({ discounts: { 7: 10, 30: 20 } }, SITE_ON), { days: 30, pct: 20 }, 'gain 10 vs 10 → monthly');
  assert.deepStrictEqual(gd.specialDeal({ discounts: { 7: 15, 30: 15 } }, SITE_ON), { days: 7, pct: 15 }, 'weekly gains 15, monthly 5');
});
ok('equal to or below the site promo is not a deal', () => {
  assert.strictEqual(gd.specialDeal({ discounts: { 30: 10 } }, SITE_ON), null);
  assert.strictEqual(gd.specialDeal({ discounts: { 30: 0 } }, SITE_ON), null);
  assert.strictEqual(gd.specialDeal({}, SITE_ON), null);
});
ok('with the site promo off, any own % above 0 is a deal', () => {
  assert.deepStrictEqual(gd.specialDeal({ discounts: { 30: 10 } }, SITE_OFF), { days: 30, pct: 10 });
});

console.log('\ncleanInput / applyPct');
ok('table boxes', () => {
  assert.strictEqual(gd.cleanInput(''), null);
  assert.strictEqual(gd.cleanInput('  '), null);
  assert.strictEqual(gd.cleanInput('abc'), null);
  assert.strictEqual(gd.cleanInput('20'), 20);
  assert.strictEqual(gd.cleanInput('0'), 0);
  assert.strictEqual(gd.cleanInput('250'), 100);
  assert.strictEqual(gd.cleanInput('-3'), 0);
  assert.strictEqual(gd.cleanInput(undefined), null);
});
ok('price rounding matches the rest of the site', () => {
  assert.strictEqual(gd.applyPct(799, 20), 639);
  assert.strictEqual(gd.applyPct(799, 10), 719);
  assert.strictEqual(gd.applyPct(799, 0), 799);
  assert.strictEqual(gd.applyPct(0, 50), 0);
});

console.log('\n' + passed + ' assertions passed\n');
