// Run: node scripts/test-release-wiring.js
//
// The release behaviour itself is tested in scripts/test-release.js against
// in-memory stores — the release route is never run against the production
// database. This checks server.js wires those pieces in, in the right order.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function block(startMarker) {
  const i = SRC.indexOf(startMarker);
  assert.ok(i >= 0, 'server.js still has ' + startMarker);
  const next = SRC.indexOf('\napp.', i + startMarker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}

console.log('\nrelease wiring');

ok('server.js loads lib/release', () => {
  assert.ok(/const releaseLib = require\('\.\/lib\/release'\);/.test(SRC));
});

ok('the release route refuses before writing when orders are unreachable', () => {
  const r = block("app.post('/admin/upcoming/release/:id'");
  assert.ok(r.includes('requireAuth, asyncRoute(async'), 'async route');
  const guard = r.indexOf('await _getMongoDb()');
  const run = r.indexOf('releaseLib.releaseUpcoming(');
  assert.ok(guard > 0 && run > guard, 'the database check comes before the release runs');
  assert.ok(r.includes("msg=release_failed"));
  assert.ok(r.includes("'release_partial'"));
  assert.ok(r.includes("'game_released'"));
});

ok('the release route hands lowdb and the order store to releaseUpcoming', () => {
  const r = block("app.post('/admin/upcoming/release/:id'");
  assert.ok(r.includes('orderStore: orders'));
  assert.ok(r.includes("db.get('games').push(game).write()"));
  assert.ok(r.includes("'upcoming_' + upcomingId"));
  assert.ok(r.includes("db.get('upcoming').remove("));
});

ok('signing in a released reservation updates its existing customer record', () => {
  const a = block("app.post('/admin/orders/:ref/advance'");
  assert.ok(a.includes('if (to === \'active\' && order.customer_id && order.released_at)'));
  assert.ok(a.includes('releaseLib.activatedReservationCustomer('));
});

ok('old Coming Soon links redirect to the released game', () => {
  const u = block("app.get('/upcoming/:slug'");
  const find = u.indexOf('releaseLib.findReleasedGame(');
  const browse = u.indexOf("if (!game) return res.redirect('/browse');");
  assert.ok(find > 0 && browse > find, 'checked before falling back to /browse');
  assert.ok(u.includes("res.redirect(301, '/game/' + gameSlug(released.title))"));
});

ok('the admin page gets the Just released list and the reservation counts', () => {
  assert.ok(SRC.includes("(await orders.listByStates(['awaiting_qr'])).filter(o => o && o.released_at)"));
  assert.ok(SRC.includes('releaseLib.releaseMessage('));
  assert.ok(SRC.includes('refundsOwed, releasedOrders, upcomingReservedCount, abandonedOrders'));
});

console.log('\n' + passed + ' assertions passed\n');
