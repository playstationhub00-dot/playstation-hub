// Run: node scripts/test-rent-pricing.js
const assert = require('assert');
const p = require('../lib/rent-pricing');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const TIER = { 7: 199, 30: 599 };

console.log('\namountForDays() — the two durations the site sells');

ok('7 days charges the weekly price exactly', () => {
  const r = p.amountForDays(7, TIER);
  assert.strictEqual(r.amount, 199);
  assert.strictEqual(r.prorated, false);
  assert.strictEqual(r.basis, 'weekly');
});

ok('30 days charges the monthly price exactly', () => {
  const r = p.amountForDays(30, TIER);
  assert.strictEqual(r.amount, 599);
  assert.strictEqual(r.prorated, false);
  assert.strictEqual(r.basis, 'monthly');
});

console.log('\namountForDays() — under a week: pro-rata at the weekly rate');

ok('5 days is five sevenths of the weekly price', () => {
  const r = p.amountForDays(5, TIER);
  assert.strictEqual(r.amount, 142);          // 199/7*5 = 142.14
  assert.strictEqual(r.prorated, true);
  assert.strictEqual(r.basis, 'weekly-prorata');
});

ok('1 day is one seventh', () => {
  assert.strictEqual(p.amountForDays(1, TIER).amount, 28);
});

console.log('\namountForDays() — between the tiers: interpolated, never above the month');

ok('14 days sits between the weekly and monthly price', () => {
  const r = p.amountForDays(14, TIER);
  assert.strictEqual(r.amount, 321);          // 199 + (599-199)*7/23
  assert.strictEqual(r.basis, 'interpolated');
  assert.ok(r.amount > 199 && r.amount < 599);
});

ok('29 days costs LESS than 30 days, which weekly pro-rata got badly wrong', () => {
  const r = p.amountForDays(29, TIER);
  assert.strictEqual(r.amount, 582);
  assert.ok(r.amount < p.amountForDays(30, TIER).amount,
    '29d (' + r.amount + ') must undercut 30d (599) — pro-rating at the weekly rate would have quoted 824');
});

ok('price never goes down as the rental gets longer', () => {
  let prev = 0;
  for (let d = 1; d <= 60; d++) {
    const a = p.amountForDays(d, TIER).amount;
    assert.ok(a >= prev, 'day ' + d + ' (' + a + ') dipped below day ' + (d - 1) + ' (' + prev + ')');
    prev = a;
  }
});

console.log('\namountForDays() — over a month: pro-rata at the monthly rate');

ok('45 days is a month and a half of the monthly rate', () => {
  const r = p.amountForDays(45, TIER);
  assert.strictEqual(r.amount, 899);
  assert.strictEqual(r.basis, 'monthly-prorata');
  assert.strictEqual(r.prorated, true);
});

console.log('\namountForDays() — partial price data');

ok('with only a weekly price, everything pro-rates from the week', () => {
  const r = p.amountForDays(30, { 7: 199, 30: 0 });
  assert.strictEqual(r.amount, 853);
  assert.strictEqual(r.basis, 'weekly-prorata');
});

ok('with only a monthly price, everything pro-rates from the month', () => {
  const r = p.amountForDays(5, { 7: 0, 30: 599 });
  assert.strictEqual(r.amount, 100);
  assert.strictEqual(r.basis, 'monthly-prorata');
});

ok('an exact tier still wins when the other tier is missing', () => {
  assert.strictEqual(p.amountForDays(7, { 7: 199, 30: 0 }).amount, 199);
  assert.strictEqual(p.amountForDays(30, { 7: 0, 30: 599 }).amount, 599);
});

console.log('\namountForDays() — nothing to price on');

ok('no prices at all returns null rather than charging zero', () => {
  assert.strictEqual(p.amountForDays(5, { 7: 0, 30: 0 }), null);
  assert.strictEqual(p.amountForDays(5, {}), null);
  assert.strictEqual(p.amountForDays(5, null), null);
});

ok('a nonsense duration returns null', () => {
  [0, -3, null, undefined, NaN, 'abc', 1.5].forEach(d => {
    assert.strictEqual(p.amountForDays(d, TIER), null, 'days=' + d + ' should not price');
  });
});

ok('amounts are always whole pesos', () => {
  for (let d = 1; d <= 40; d++) {
    const a = p.amountForDays(d, TIER).amount;
    assert.strictEqual(a, Math.round(a), 'day ' + d + ' produced ' + a);
  }
});

console.log('\nisStandard()');

ok('only the durations the site sells are standard', () => {
  assert.strictEqual(p.isStandard(7), true);
  assert.strictEqual(p.isStandard(30), true);
  assert.strictEqual(p.isStandard(5), false);
  assert.strictEqual(p.isStandard(29), false);
});

console.log('\nthe admin form previews the same number the server saves');

// This whole bug was a comment claiming the two agreed. A comment cannot fail a
// build, so the claim is checked here instead: pull the preview's function out
// of the template and run it against the module for every duration.
function previewFn() {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin', 'quick-add.ejs'), 'utf8');
  const m = src.match(/function qaAmountForDays\([\s\S]*?\n  \}/);
  assert.ok(m, 'the preview function is still named qaAmountForDays in quick-add.ejs');
  return new Function(m[0] + '; return qaAmountForDays;')();
}

ok('quick-add.ejs mirrors this module exactly, day for day', () => {
  const preview = previewFn();
  const tiers = [
    { 7: 199, 30: 599 }, { 7: 149, 30: 349 }, { 7: 99, 30: 249 },
    { 7: 199, 30: 0 }, { 7: 0, 30: 599 }, { 7: 500, 30: 500 }
  ];
  tiers.forEach(t => {
    for (let d = 1; d <= 60; d++) {
      const server = p.amountForDays(d, t);
      const client = preview(d, t[7], t[30]);
      assert.strictEqual(client, server ? server.amount : 0,
        'day ' + d + ' at ' + JSON.stringify(t) + ': form shows ' + client
        + ', server saves ' + (server ? server.amount : 0));
    }
  });
});

ok('the form shows 0 exactly when the server refuses to price', () => {
  const preview = previewFn();
  // 0 is what puts the form into its "no price set" state — it has to line up
  // with the server's null, or the form promises a save that gets rejected.
  assert.strictEqual(preview(5, 0, 0), 0);
  assert.strictEqual(p.amountForDays(5, { 7: 0, 30: 0 }), null);
  assert.strictEqual(preview(0, 199, 599), 0);
  assert.strictEqual(p.amountForDays(0, { 7: 199, 30: 599 }), null);
});

console.log('\n' + passed + ' assertions passed\n');
