// Run: node scripts/test-ps4-primary-price.js
//
// PS4 Primary is charged at the Trophy week and month prices, plus the same
// refundable deposit as Trophy. A 30-day promo, a ₱50 rebook, and a punch-card
// credit all apply on top of that Trophy price. quoteRent prices a new order.
// It does not read or rewrite an order that was already saved.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rentPricing = require('../lib/rent-pricing');
const loyalty = require('../lib/loyalty');
const reservations = require('../lib/reservations');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

// Hogwarts Legacy, the catalogue shape the support bot already quotes:
// Non-Trophy ₱249 / ₱499, Trophy ₱299 / ₱599. Deposit ₱100.
const game = {
  nt_price_7d: 249, nt_price_30d: 499,
  tr_price_7d: 299, tr_price_30d: 599
};

console.log('\nPS4 Primary weekly and monthly');

ok('a week with no promo is the Trophy price plus the deposit', () => {
  const q = rentPricing.quoteRent(game, 'ps4', 7, 0, 100);
  assert.strictEqual(q.priceType, 'tr');
  assert.strictEqual(q.amountDue, 299);
  assert.strictEqual(q.depositDue, 100);
  assert.strictEqual(q.total, 399);
  const trophy = rentPricing.quoteRent(game, 'tr', 7, 0, 100);
  assert.strictEqual(q.amountDue, trophy.amountDue);
  assert.strictEqual(q.depositDue, trophy.depositDue);
});

ok('a month with no promo is the Trophy month price plus the deposit', () => {
  const q = rentPricing.quoteRent(game, 'ps4', 30, 0, 100);
  assert.strictEqual(q.amountDue, 599);
  assert.strictEqual(q.depositDue, 100);
  assert.strictEqual(q.total, 699);
});

ok('a 10% monthly promo comes off the Trophy month price, and the deposit stays', () => {
  const q = rentPricing.quoteRent(game, 'ps4', 30, 10, 100);
  assert.strictEqual(q.amountDue, 539);
  assert.strictEqual(q.depositDue, 100);
  assert.strictEqual(q.total, 639);
  const week = rentPricing.quoteRent(game, 'ps4', 7, 0, 100);
  assert.strictEqual(week.amountDue, 299);
});

ok('Non-Trophy stays on its own price and has no deposit', () => {
  const q = rentPricing.quoteRent(game, 'nt', 7, 0, 100);
  assert.strictEqual(q.amountDue, 249);
  assert.strictEqual(q.depositDue, 0);
  assert.strictEqual(q.total, 249);
});

console.log('\nloyalty on top of the Trophy price');

ok('a ₱50 rebook comes off the Trophy week, not the Non-Trophy week', () => {
  const q = rentPricing.quoteRent(game, 'ps4', 7, 0, 100);
  const adj = loyalty.adjustedRent(q.amountDue, { kind: 'rebook', amount: 50 }, { days: 7 });
  assert.strictEqual(adj.amountDue, 249);
  assert.strictEqual(adj.credited, 50);
  assert.strictEqual(q.depositDue, 100);
});

ok('a punch card makes a 7-day PS4 Primary rental free and credits the Trophy week', () => {
  const q = rentPricing.quoteRent(game, 'ps4', 7, 0, 100);
  const adj = loyalty.adjustedRent(q.amountDue, { kind: 'punch', days: 7 }, { days: 7 });
  assert.strictEqual(adj.amountDue, 0);
  assert.strictEqual(adj.credited, 299);
});

ok('a punch card on a promo month credits the Trophy week, not the Non-Trophy week', () => {
  const week = rentPricing.quoteRent(game, 'ps4', 7, 0, 100);
  const month = rentPricing.quoteRent(game, 'ps4', 30, 10, 100);
  const adj = loyalty.adjustedRent(month.amountDue, { kind: 'punch', days: 7 }, {
    days: 30,
    weekValue: week.amountDue
  });
  assert.strictEqual(adj.amountDue, 240);
  assert.strictEqual(adj.credited, 299);
  assert.strictEqual(month.depositDue, 100);
});

console.log('\ncoming soon and the server call sites');

ok('a PS4 Primary reservation uses the Trophy list price and the deposit', () => {
  const r = reservations.preorderPricing(game, 'ps4', 30, { deposit: 100 });
  assert.strictEqual(r.base, 599);
  assert.strictEqual(r.deposit, 100);
  assert.strictEqual(r.total, 699);
  assert.strictEqual(r.amountDue, 699);
});

ok('new rental quotes no longer read the Non-Trophy fields for PS4 Primary', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(!/priceType = type === 'ps4' \? 'nt'/.test(src));
  assert.ok(!/priceType = order\.account_type === 'ps4' \? 'nt'/.test(src));
  assert.ok(!/account_type === 'tr' \? 'tr' : 'nt'/.test(src));
  assert.ok(!/ps4Fallback \? 'nt'/.test(src));
  assert.ok(/buyType = type === 'ps4' \? 'nt'/.test(src), 'a permanent PS4 sale still has no Trophy buy field');
});

console.log('\n' + passed + ' assertions passed\n');
