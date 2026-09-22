// Run: node scripts/test-order-routes-error-handling.js
//
// Proves the asyncRoute() wrapper actually works at runtime, not just that
// the source text looks right (scripts/test-order-routes-wrapped.js covers
// that half). Boots the real server in-process, monkey-patches
// orders.getByRef to throw, and confirms GET /order/:ref — a public,
// unauthenticated route, chosen specifically so this test never needs an
// admin login — responds with a real HTTP status instead of hanging.
//
// Before the fix: this test times out, because nothing ever calls
// next(err) for a route that isn't wrapped. That timeout IS the proof this
// test is non-vacuous, not a flaw in the test.
const assert = require('assert');
const http = require('http');

const PORT = 4589;
process.env.PORT = String(PORT);

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path, timeout: 5000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out — the route hung instead of responding')); });
  });
}

async function main() {
  // Requiring server.js runs its whole top-level setup, including
  // app.listen(PORT, ...) — this is what actually starts the server this
  // test talks to.
  require('../server.js');

  // orders.getByRef is looked up on this same object at request time by
  // every route in server.js (a property lookup, not a captured copy), so
  // patching it here reaches the real route handlers.
  const orders = require('../lib/orders');
  const originalGetByRef = orders.getByRef;
  orders.getByRef = async () => { throw new Error('simulated MongoDB failure'); };

  try {
    // Wait for the server to actually be listening before hitting it.
    const deadline = Date.now() + 10000;
    let up = false;
    while (Date.now() < deadline) {
      try { await get('/'); up = true; break; }
      catch { await new Promise(r => setTimeout(r, 200)); }
    }
    assert.ok(up, 'server did not come up within 10s');

    console.log('\nGET /order/:ref with a throwing orders.getByRef');

    const res = await get('/order/PH-0001');
    console.log('  ok - responded with a real HTTP status instead of hanging: ' + res.statusCode);
    assert.ok(res.statusCode >= 200 && res.statusCode < 600, 'expected a real HTTP status code, got ' + res.statusCode);
    console.log('\n1 assertion passed\n');
  } finally {
    orders.getByRef = originalGetByRef;
  }
  // require('../server.js') left an open HTTP server listening, which would
  // otherwise keep this process alive forever — nothing else in this test
  // needs the event loop open once the assertion above has run.
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
