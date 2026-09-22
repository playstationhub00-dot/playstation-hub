// Run: node scripts/test-order-routes-wrapped.js
//
// Source-level guard, the same pattern scripts/test-order-reserve-promo.js
// already uses: confirms each of the 18 routes flagged in
// docs/superpowers/specs/2026-09-22-order-routes-error-handling-design.md
// actually wraps its handler in asyncRoute(...), matched against the real
// wrapped code shape rather than a bare substring that could false-pass on
// an unrelated comment.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// The exact 18 route-opening lines this fix targets, in their wrapped form.
// Kept as a flat list (not derived from anything else) so this test can
// never accidentally agree with a bug in the code it's checking.
const wrappedRoutes = [
  `app.get('/order/:ref', asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/payment-proof', uploadOrderFile.single('proof'), asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/upgrade-priority', asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/review', asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/pay', asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/payment-link', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/quick-add', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/create-manual', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/webhooks/paymongo', asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/qr', uploadOrderFile.single('qr'), asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/signin-code', express.urlencoded({ extended: false }), asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/return-proof', uploadOrderFile.single('proof'), asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/advance', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/reject', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/mark-paid', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/priority-paid', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/undo-priority', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/cancel', requireAuth, asyncRoute(async (req, res) => {`,
];

console.log('\nasyncRoute() helper');

ok('server.js defines asyncRoute', () => {
  assert.ok(/function asyncRoute\(fn\)/.test(src), 'no `function asyncRoute(fn)` found in server.js');
});

console.log('\nall 18 order routes are wrapped');

for (const line of wrappedRoutes) {
  ok('wrapped: ' + line.slice(0, 60) + (line.length > 60 ? '…' : ''), () => {
    assert.ok(src.includes(line), 'expected this exact wrapped line in server.js:\n' + line);
  });
}

console.log('\n' + passed + ' assertions passed\n');
