// Run: node scripts/test-order-reserve-promo.js
//
// Regression guard for a real bug found while testing the reservation-price
// change: a prior refactor (b813100) deleted the `const promo = ...`
// declaration inside POST /order/reserve along with a validation block it
// sat next to, but every branch of that route still reads `promo` — so any
// real submission through it (a rental reservation, Fall in Line, PS Plus,
// or the flat priority fee; every kind except the pre-order branch, which
// prices through computeBuyPricing instead) threw
// `ReferenceError: promo is not defined` and hung with no response. This
// isn't something a template-render or pure-function test can catch — it
// only shows up when the actual route body runs — so this checks the route's
// own source instead: `promo` must be declared (not just read) before the
// branch chain that uses it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

console.log('\nPOST /order/reserve — promo must actually be declared, not just read');

ok('the route body declares promo before the branch chain that reads it', () => {
  const routeStart = src.indexOf("app.post('/order/reserve'");
  assert.ok(routeStart !== -1, 'POST /order/reserve no longer exists at this path');

  const nextRouteStart = src.indexOf('\napp.', routeStart + 20);
  const body = src.slice(routeStart, nextRouteStart === -1 ? src.length : nextRouteStart);

  const declareAt = body.search(/\b(?:const|let|var)\s+promo\s*=/);
  assert.ok(declareAt !== -1, 'no `const/let/var promo =` declaration anywhere in the route body — every branch below still reads it');

  // The branch chain this bug lived in — actual code, not prose, so a comment
  // mentioning "promo" earlier in the file can't produce a false pass here.
  const firstBranchUse = body.search(/if\s*\(isBuyPreorder\)[\s\S]*?reservations\.preorderPricing\(game,\s*type,\s*d,\s*promo\)/);
  assert.ok(firstBranchUse !== -1, 'the reservation branch no longer calls preorderPricing(..., promo) — this test may be stale');
  assert.ok(declareAt < firstBranchUse, 'promo is declared after the branch chain that reads it');
});

ok('the same fix pattern (getSiteSettings().promo || {}) is used, matching every other route', () => {
  const routeStart = src.indexOf("app.post('/order/reserve'");
  const nextRouteStart = src.indexOf('\napp.', routeStart + 20);
  const body = src.slice(routeStart, nextRouteStart === -1 ? src.length : nextRouteStart);
  assert.ok(/getSiteSettings\(\)\.promo\s*\|\|\s*\{\}/.test(body),
    'expected the standard `getSiteSettings().promo || {}` fallback this codebase uses everywhere else');
});

console.log('\n' + passed + ' assertions passed\n');
