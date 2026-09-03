// Plain assert-based tests for the PayPal surcharge maths. No test framework
// in this project by design — run with `node scripts/test-surcharge.js`, which
// exits non-zero on the first failed assertion.
const assert = require('assert');
const sur = require('../lib/surcharge');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

// The live defaults, so these tests fail if a default silently changes.
const CFG = { percent: 4.4, fixedPeso: 15, payoutUsd: 0.50, rate: 62.58 };

check('a 249 rental produces the documented breakdown', () => {
  const q = sur.computeSurcharge(249, CFG);
  assert.strictEqual(q.base, 249);
  assert.strictEqual(q.feePeso, 26);      // ceil(10.956) = 11, + 15
  assert.strictEqual(q.payoutPeso, 32);   // ceil(0.50 * 62.58) = ceil(31.29)
  assert.strictEqual(q.total, 307);
});

check('a whole-number percentage does not gain a phantom peso', () => {
  // THE regression test. 1500 * 4.4 / 100 evaluates to 66.00000000000001 in
  // JavaScript, so a naive Math.ceil yields 67 and charges the customer a peso
  // that does not exist. Correct answers here are 81 and 1613, never 82/1614.
  const q = sur.computeSurcharge(1500, CFG);
  assert.strictEqual(q.feePeso, 81);
  assert.strictEqual(q.payoutPeso, 32);
  assert.strictEqual(q.total, 1613);
});

check('a genuine fraction still rounds up', () => {
  // 10.956 must become 11, not 10 — under-recovering is the failure mode.
  assert.strictEqual(sur.computeSurcharge(249, { percent: 4.4, fixedPeso: 0, payoutUsd: 0, rate: 62.58 }).feePeso, 11);
});

check('percent 0 gives a pure flat fee', () => {
  const q = sur.computeSurcharge(249, { percent: 0, fixedPeso: 40, payoutUsd: 0, rate: 62.58 });
  assert.strictEqual(q.feePeso, 40);
  assert.strictEqual(q.total, 289);
});

check('a zero fixed fee and zero payout give a pure percentage', () => {
  const q = sur.computeSurcharge(1000, { percent: 5, fixedPeso: 0, payoutUsd: 0, rate: 62.58 });
  assert.strictEqual(q.feePeso, 50);
  assert.strictEqual(q.payoutPeso, 0);
  assert.strictEqual(q.total, 1050);
});

check('a zero amount carries no fees at all', () => {
  // An order with nothing to send must not display a fee-only total.
  assert.deepStrictEqual(sur.computeSurcharge(0, CFG), { base: 0, feePeso: 0, payoutPeso: 0, total: 0 });
});

check('unusable inputs become zero instead of throwing', () => {
  // This runs inside a page render. A blank or mistyped settings field must
  // never take the order page down for every customer.
  assert.strictEqual(sur.computeSurcharge(-50, CFG).total, 0);
  assert.strictEqual(sur.computeSurcharge(NaN, CFG).total, 0);
  assert.strictEqual(sur.computeSurcharge(undefined, CFG).total, 0);
  assert.strictEqual(sur.computeSurcharge(249, {}).total, 249);
  assert.strictEqual(sur.computeSurcharge(249, null).total, 249);
  assert.strictEqual(sur.computeSurcharge(249, { percent: 'abc', fixedPeso: NaN, payoutUsd: -1, rate: 62.58 }).total, 249);
});

check('a negative rate cannot produce a negative payout', () => {
  assert.strictEqual(sur.computeSurcharge(249, { percent: 0, fixedPeso: 0, payoutUsd: 0.5, rate: -62 }).payoutPeso, 0);
});

console.log('\n' + passed + ' assertions passed');
