// Run: node scripts/test-reservations.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const reservations = require('../lib/reservations');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const PROMO = { deposit: 100 };
function game(over) {
  return Object.assign({
    nt_price_7d: 349, nt_price_30d: 699,
    tr_price_7d: 449, tr_price_30d: 899
  }, over || {});
}

console.log('\npreorderPricing() — paid in full, nothing owed on release');

ok('a non-trophy weekly reservation is the full list price', () => {
  const r = reservations.preorderPricing(game(), 'nt', 7, PROMO);
  assert.strictEqual(r.base, 349);
  assert.strictEqual(r.deposit, 0, 'no deposit on non-trophy');
  assert.strictEqual(r.total, 349);
  assert.strictEqual(r.amountDue, 349, 'the whole total, not half of it');
  assert.strictEqual(r.remainingDue, 0);
});

ok('amountDue always equals the total, and remainingDue is always zero', () => {
  // The split this project used to charge is gone — nothing is still owed
  // once the game releases, for either duration or account type.
  [7, 30].forEach(d => ['nt', 'tr'].forEach(t => {
    const r = reservations.preorderPricing(game(), t, d, PROMO);
    assert.strictEqual(r.amountDue, r.total,
      t + ' ' + d + 'd: amountDue ' + r.amountDue + ' !== total ' + r.total);
    assert.strictEqual(r.remainingDue, 0);
  }));
});

ok('an odd total is still paid in full, not split into an odd/even pair', () => {
  const r = reservations.preorderPricing(game({ nt_price_7d: 349 }), 'nt', 7, PROMO);
  assert.strictEqual(r.amountDue, 349);
  assert.strictEqual(r.remainingDue, 0);
});

ok('trophy carries the deposit into the total, paid in full with it', () => {
  const r = reservations.preorderPricing(game(), 'tr', 30, PROMO);
  assert.strictEqual(r.base, 899);
  assert.strictEqual(r.deposit, 100);
  assert.strictEqual(r.total, 999);
  assert.strictEqual(r.amountDue, 999);
  assert.strictEqual(r.remainingDue, 0);
});

ok('no promo discount is applied, unlike a released rental', () => {
  // The public reserve route quotes an upcoming game at list price. A quote is
  // a promise; discounting here would charge a different number than the site
  // showed.
  const withPromo = reservations.preorderPricing(game(), 'nt', 30, { deposit: 100, discounts: { 30: 50 }, enabled: true });
  const without = reservations.preorderPricing(game(), 'nt', 30, { deposit: 100 });
  assert.strictEqual(withPromo.amountDue, without.amountDue);
});

console.log('\npreorderPricing() — refusals');

ok('a duration the game has no price for is refused, not guessed', () => {
  assert.strictEqual(reservations.preorderPricing(game({ nt_price_7d: 0 }), 'nt', 7, PROMO), null);
  // Only 7 and 30 exist as fields; a custom duration has nothing to read.
  assert.strictEqual(reservations.preorderPricing(game(), 'nt', 12, PROMO), null);
});

ok('bad input does not throw', () => {
  assert.strictEqual(reservations.preorderPricing(null, 'nt', 7, PROMO), null);
  assert.strictEqual(reservations.preorderPricing(game(), 'nt', 0, PROMO), null);
  assert.strictEqual(reservations.preorderPricing(game(), 'nt', -5, PROMO), null);
  assert.strictEqual(reservations.preorderPricing(game(), 'nt', 7.5, PROMO), null);
  assert.strictEqual(reservations.preorderPricing(game(), 'nt', 7, null).deposit, 0);
});

console.log('\nthe admin form quotes what the server saves');

// The bug this guards against has happened twice in this project: a form
// previewing one number while the save path computed another. Rather than
// trusting a comment that says they agree, this pulls the arithmetic out of
// the template and runs both.
function templateReservation(depositValue) {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'partials', 'admin', 'quick-add.ejs'), 'utf8');

  const baseFn = src.match(/function qaResBase\([\s\S]*?\n  \}/);
  assert.ok(baseFn, 'quick-add.ejs still defines qaResBase');
  const resFn = src.match(/function qaReservation\([\s\S]*?\n  \}/);
  assert.ok(resFn, 'quick-add.ejs still defines qaReservation');

  // Coerced to a number before it is spliced in: everything built into this
  // function body is either our own template source or a literal produced
  // here, and it stays that way.
  // The deposit reaches the real page as a data attribute on the modal;
  // here it is stubbed as the same accessor the template calls.
  // Assembled without escape sequences on purpose: a newline written as an
  // escape inside a generated string is the single most reliable way to get
  // this file mangled by the tooling that edits it.
  const NL = String.fromCharCode(10);
  const code = 'function qaResDepositValue() { return ' + (Number(depositValue) || 0) + '; }' + NL
    + baseFn[0] + NL + resFn[0] + NL
    + 'return { qaResBase: qaResBase, qaReservation: qaReservation };';
  return new Function(code)();
}

ok('the form and the module agree on every price, type and duration', () => {
  const deposits = [0, 100, 250];
  const prices = [0, 1, 99, 349, 449, 699, 899, 2499, 3333];
  let compared = 0;

  deposits.forEach(dep => {
    const form = templateReservation(dep);
    prices.forEach(price => {
      [7, 30].forEach(d => {
        ['nt', 'tr'].forEach(type => {
          const g = {};
          g[type + '_price_' + d + 'd'] = price;

          const server = reservations.preorderPricing(g, type, d, { deposit: dep });
          // Exactly what the option's data attributes carry for this type:
          // the 7d and 30d prices, with only the one under test set.
          const p7 = d === 7 ? price : 0;
          const p30 = d === 30 ? price : 0;
          const shown = form.qaReservation(form.qaResBase(d, p7, p30), type);

          compared++;
          if (!server) {
            assert.strictEqual(shown.amountDue, 0,
              'server refuses to price this, so the form must show nothing: '
              + type + ' ' + d + 'd @' + price + ' dep' + dep);
            return;
          }
          assert.strictEqual(shown.amountDue, server.amountDue,
            'amount due differs for ' + type + ' ' + d + 'd @' + price + ' dep' + dep
            + ': form ' + shown.amountDue + ', server ' + server.amountDue);
          assert.strictEqual(shown.remainingDue, server.remainingDue,
            'remaining due differs for ' + type + ' ' + d + 'd @' + price + ' dep' + dep);
          assert.strictEqual(shown.total, server.total);
        });
      });
    });
  });
  assert.ok(compared >= 100, 'expected a real sweep, compared ' + compared);
});

ok('qaResBase picks the field the server reads, and refuses anything else', () => {
  const form = templateReservation(100);
  assert.strictEqual(form.qaResBase(7, 349, 699), 349);
  assert.strictEqual(form.qaResBase(30, 349, 699), 699);
  // A custom duration has no price field on an upcoming record, which is
  // exactly when the server returns null and asks for an override.
  assert.strictEqual(form.qaResBase(12, 349, 699), 0);
  assert.strictEqual(reservations.preorderPricing(game(), 'nt', 12, PROMO), null);
});

console.log('\n' + passed + ' assertions passed\n');
