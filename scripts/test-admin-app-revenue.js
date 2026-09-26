// Run: node scripts/test-admin-app-revenue.js
//
// The phone admin page (/admin/app) counts money actually received — the
// recorded payments — not customer prices, so an unpaid Quick Add is not
// revenue until its payment is confirmed. Source-level: the route renders a
// whole page from the local data file.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = SRC.indexOf("app.get('/admin/app', requireAuth,");
assert.ok(start >= 0, 'server.js still has the /admin/app route');
const ROUTE = SRC.slice(start, SRC.indexOf('\napp.', start + 10));

console.log('\n/admin/app revenue');

ok('revenue is added up from recorded payments, not prices', () => {
  assert.ok(ROUTE.includes('(c.payments || []).forEach(p => {'));
  assert.ok(!ROUTE.includes('reduce((s, c) => s + (c.price || 0), 0)'));
});

ok("this month means the payment's own date, in Manila", () => {
  assert.ok(ROUTE.includes('const monthKey = orders.manilaDate().slice(0, 7);'));
  assert.ok(ROUTE.includes("String((p && p.date) || '').slice(0, 7) === monthKey"));
});

console.log('\n' + passed + ' assertions passed\n');
