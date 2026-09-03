// Plain assert-based tests for USD/PHP rate handling. No test framework in
// this project by design — run with `node scripts/test-fx.js`, which exits
// non-zero on the first failed assertion.
//
// No network: pickRate and isStale are fed fabricated caches and clocks, so
// the whole fallback chain is exercised without an FX API existing.
const assert = require('assert');
const fx = require('../lib/fx');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

const NOW = Date.parse('2026-09-03T12:00:00Z');
const fresh = new Date(NOW - 60 * 1000).toISOString();
const old   = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();

check('a plausible rate is sane', () => {
  assert.strictEqual(fx.isSaneRate(62.58), true);
  assert.strictEqual(fx.isSaneRate(30), true);
  assert.strictEqual(fx.isSaneRate(120), true);
});

check('garbage is never sane', () => {
  // The whole point of the band: a broken API response, an HTML error page or
  // a redirect body must never render "$0.02" or "$4,000" on a checkout panel.
  [0, -62, NaN, Infinity, -Infinity, null, undefined, {}, []].forEach(v => {
    assert.strictEqual(fx.isSaneRate(v), false, String(v) + ' should not be sane');
  });
});

check('a numeric string is rejected', () => {
  // A rate arrives as a number or not at all. Accepting '62.58' would mean
  // accepting whatever else a malformed payload put in that field.
  assert.strictEqual(fx.isSaneRate('62.58'), false);
});

check('out-of-band rates are rejected', () => {
  assert.strictEqual(fx.isSaneRate(5), false);
  assert.strictEqual(fx.isSaneRate(5000), false);
  assert.strictEqual(fx.isSaneRate(29.99), false);
  assert.strictEqual(fx.isSaneRate(120.01), false);
});

check('staleness is measured against the threshold inclusively', () => {
  assert.strictEqual(fx.isStale(fresh, NOW, fx.DAY_MS), false);
  assert.strictEqual(fx.isStale(old, NOW, fx.DAY_MS), true);
  // Exactly on the line counts as stale.
  const exact = new Date(NOW - fx.DAY_MS).toISOString();
  assert.strictEqual(fx.isStale(exact, NOW, fx.DAY_MS), true);
  const justUnder = new Date(NOW - fx.DAY_MS + 1000).toISOString();
  assert.strictEqual(fx.isStale(justUnder, NOW, fx.DAY_MS), false);
});

check('an unknown age is never treated as fresh', () => {
  assert.strictEqual(fx.isStale(undefined, NOW, fx.DAY_MS), true);
  assert.strictEqual(fx.isStale('not a date', NOW, fx.DAY_MS), true);
  assert.strictEqual(fx.isStale(null, NOW, fx.DAY_MS), true);
});

check('pesos convert to dollars at the nearest cent', () => {
  // Nearest, not up: this is labelled an estimate and the peso figure is what
  // is actually charged, so inflating it would only make it less accurate.
  assert.strictEqual(fx.pesosToUsd(307, 62.58), 4.91);
  assert.strictEqual(fx.pesosToUsd(1613, 62.58), 25.78);
});

check('conversion refuses to work from an unusable rate', () => {
  assert.strictEqual(fx.pesosToUsd(307, 0), 0);
  assert.strictEqual(fx.pesosToUsd(307, NaN), 0);
  assert.strictEqual(fx.pesosToUsd(307, 5000), 0);
  assert.strictEqual(fx.pesosToUsd(0, 62.58), 0);
  assert.strictEqual(fx.pesosToUsd(-5, 62.58), 0);
});

check('a fresh sane cache is used and reported as live', () => {
  const r = fx.pickRate({ rate: 62.58, fetched_at: fresh }, 60, NOW);
  assert.deepStrictEqual(r, { rate: 62.58, source: 'live' });
});

check('a stale cache falls through to the manual rate', () => {
  const r = fx.pickRate({ rate: 62.58, fetched_at: old }, 60, NOW);
  assert.deepStrictEqual(r, { rate: 60, source: 'manual' });
});

check('a fresh cache holding an insane rate falls through', () => {
  // Freshness alone must not qualify a rate. A recently-cached 0 is still 0.
  const r = fx.pickRate({ rate: 0, fetched_at: fresh }, 60, NOW);
  assert.deepStrictEqual(r, { rate: 60, source: 'manual' });
});

check('no cache at all falls through', () => {
  assert.deepStrictEqual(fx.pickRate(null, 60, NOW), { rate: 60, source: 'manual' });
  assert.deepStrictEqual(fx.pickRate({}, 60, NOW), { rate: 60, source: 'manual' });
});

check('a manual rate from a settings form arrives as a string and still works', () => {
  // Settings come back from an HTML form as strings, so the manual rate is
  // coerced where the API response is not.
  assert.deepStrictEqual(fx.pickRate(null, '62.50', NOW), { rate: 62.5, source: 'manual' });
});

check('an unusable manual rate still yields a usable number', () => {
  // The panel must render regardless. RATE_MIN is the floor of the chain.
  assert.deepStrictEqual(fx.pickRate(null, 0, NOW), { rate: fx.RATE_MIN, source: 'manual' });
  assert.deepStrictEqual(fx.pickRate(null, 'abc', NOW), { rate: fx.RATE_MIN, source: 'manual' });
  assert.deepStrictEqual(fx.pickRate(null, undefined, NOW), { rate: fx.RATE_MIN, source: 'manual' });
});

console.log('\n' + passed + ' assertions passed');
