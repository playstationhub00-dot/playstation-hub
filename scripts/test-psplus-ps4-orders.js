// Run: node scripts/test-psplus-ps4-orders.js
//
// PS Plus Deluxe can be rented as PS4 Primary, its own type next to Trophy and
// Non-Trophy. Like on a game page it costs the Trophy price plus the
// refundable deposit. Checks every PS Plus order path that names a type:
// checkout, the free waiting line, the ₱100 priority line, the customer's
// upgrade from free to priority, and the owner signing a renter in (which
// takes the slot off PS4 Primary, not Non-Trophy).
//
// Throwaway only: a temp DATA_DIR, a blank MONGODB_URI, an in-memory session
// store, a made-up admin password and an in-memory orders collection.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4665;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'psplus-ps4-orders-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 } },
  games: [{
    id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5', genre: '', cover_image: '', renters: 9,
    nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899,
    non_trophy_slots: 3, trophy_slots: 3, ps4_primary_slots: 2
  }],
  psplus_prices: { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 }
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'psplus-ps4-orders-test';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const stored = [];

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers),
      timeout: 20000
    }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}
const form = o => new URLSearchParams(o).toString();
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const ledger = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

(async () => {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  const orders = require('../lib/orders');
  orders.create = async function (fields) {
    const order = Object.assign({
      ref: 'PH-' + String(3000 + stored.length),
      url_key: 'k' + stored.length,
      state: 'awaiting_payment',
      created_at: new Date().toISOString(),
      deposit_due: 0
    }, fields);
    stored.push(order);
    return order;
  };
  orders.getByRef = async ref => stored.find(o => o.ref === ref) || null;
  orders.transition = async (ref, to, patch) => {
    const o = stored.find(x => x.ref === ref);
    if (!o) return null;
    Object.assign(o, patch || {}, { state: to });
    return o;
  };
  orders.setCustomerId = async (ref, id) => { const o = stored.find(x => x.ref === ref); if (o) o.customer_id = id; return !!o; };
  orders.setHoldExpiry = async () => true;

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  async function post(p, fields) {
    const before = stored.length;
    const r = await call('POST', p, { headers: FORM, body: form(fields) });
    assert.strictEqual(r.status, 302, r.headers.location || r.body);
    assert.ok(!/order_error/.test(r.headers.location || ''), 'redirected to ' + r.headers.location);
    assert.strictEqual(stored.length, before + 1, 'an order was saved');
    return stored[stored.length - 1];
  }

  try {
    console.log('\nPS Plus checkout');
    await ok('PS4 Primary, weekly: the Trophy week plus the deposit', async () => {
      const o = await post('/order/create-psplus', { account_type: 'ps4', days: '7', fb_name: 'Zzyzx Renter' });
      assert.strictEqual(o.game_id, 'psplus');
      assert.strictEqual(o.account_type, 'ps4');
      assert.strictEqual(o.amount_due, 399);
      assert.strictEqual(o.deposit_due, 100);
    });
    await ok('PS4 Primary, monthly: the Trophy month after the 10% promo, plus the deposit', async () => {
      const o = await post('/order/create-psplus', { account_type: 'ps4', days: '30', fb_name: 'Zzyzx Renter' });
      assert.strictEqual(o.amount_due, 719);
      assert.strictEqual(o.deposit_due, 100);
    });
    await ok('Trophy and Non-Trophy are priced as before', async () => {
      const tr = await post('/order/create-psplus', { account_type: 'tr', days: '7', fb_name: 'Zzyzx Renter' });
      assert.deepStrictEqual([tr.amount_due, tr.deposit_due], [399, 100]);
      const nt = await post('/order/create-psplus', { account_type: 'nt', days: '7', fb_name: 'Zzyzx Renter' });
      assert.deepStrictEqual([nt.amount_due, nt.deposit_due], [349, 0]);
    });

    console.log('\nPS Plus waiting line');
    let free;
    await ok('a free PS4 Primary entry owes the Trophy month plus the deposit later', async () => {
      free = await post('/order/reserve', { game_id: 'psplus', account_type: 'ps4', days: '30', fb_name: 'Zzyzx Waiter', kind: 'queue' });
      assert.strictEqual(free.state, 'waitlisted');
      assert.strictEqual(free.account_type, 'ps4');
      assert.strictEqual(free.amount_due, 0);
      assert.strictEqual(free.remaining_due, 819);
    });
    await ok('a ₱100 PS4 Primary priority entry owes the rest plus the deposit', async () => {
      const o = await post('/order/reserve', { game_id: 'psplus', account_type: 'ps4', days: '7', fb_name: 'Zzyzx Priority', kind: '' });
      assert.strictEqual(o.amount_due, 100);
      assert.strictEqual(o.remaining_due, 399);
    });
    await ok('upgrading the free entry to priority prices it at the Trophy month', async () => {
      const r = await call('POST', '/order/' + free.ref + '/upgrade-priority', { headers: FORM, body: form({ k: free.url_key }) });
      assert.strictEqual(r.status, 302);
      assert.ok(/msg=upgrade_started/.test(r.headers.location), r.headers.location);
      assert.strictEqual(free.state, 'awaiting_payment');
      assert.strictEqual(free.amount_due, 100);
      assert.strictEqual(free.remaining_due, 719);
    });

    console.log('\nsigning a PS4 Primary renter in');
    await ok('takes the slot off PS4 Primary, not Non-Trophy', async () => {
      const login = await call('POST', '/admin/login', { headers: FORM, body: form({ password: TEST_PASSWORD }) });
      const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      assert.ok(cookie, 'logged in');
      stored.push({
        ref: 'PH-3900', url_key: 'kq', state: 'qr_pending', game_id: 'psplus', game_title: 'PS Plus Deluxe',
        account_type: 'ps4', days: 7, amount_due: 399, deposit_due: 100, fb_name: 'Zzyzx Signed', is_psplus: true,
        created_at: new Date().toISOString()
      });
      const r = await call('POST', '/admin/orders/PH-3900/advance', { headers: Object.assign({ Cookie: cookie }, FORM), body: '' });
      assert.strictEqual(r.status, 302);
      assert.ok(/msg=order_advanced|tab=orders/.test(r.headers.location), r.headers.location);
      const db = ledger();
      const c = db.customers.find(x => x.order_ref === 'PH-3900');
      assert.ok(c, 'a customer row was made');
      assert.strictEqual(c.account_type, 'ps4');
      const row = db.games.find(g => g.id === 4);
      assert.strictEqual(row.ps4_primary_slots, 1);
      assert.strictEqual(row.non_trophy_slots, 3);
    });

    console.log('\n' + passed + ' assertions passed\n');
  } catch (e) {
    console.error(e);
    cleanup();
    process.exit(1);
  }
  cleanup();
  process.exit(0);
})();
