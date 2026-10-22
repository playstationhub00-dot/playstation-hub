// Run: node scripts/test-buy-new-slot-orders.js
//
// A full type still sells permanently: the checkout takes the order and marks
// it new_slot (a bundle's taken slot still refuses), a Coming Soon pre-order of
// a full type is marked too, the Buy shop keeps the game listed as "Set up on
// order", the customer's order page says a slot is being added, and the owner
// sees "New slot needed" on the Orders tab and "New slot to add" in Needs you
// now. Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory
// sessions, a made-up admin password, an in-memory order store); the
// project's games.json, the database and the real admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4636;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buy-new-slot-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const game = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', genre: 'Action', cover_image: '', non_trophy_slots: 1, trophy_slots: 1, renters: 1 }, price, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [
    game(1, 'Zzyzx Rented', { renters: 3, non_trophy_slots: 0, trophy_slots: 0, buy_nt_price: 999, buy_tr_price: 1499 }),
    game(2, 'Zzyzx Free', { renters: 2, buy_nt_price: 799 }),
    game(3, 'Zzyzx Fresh', { renters: 0, buy_nt_price: 599 })
  ],
  accounts: [{
    id: 1, label: 'Zzyzx Box', public_name: 'Zzyzx Box', for_sale: true, game_ids: [3], price_permanent_nt: 900, price_permanent_tr: 1100,
    slots: { non_trophy: { enabled: true, status: 'open' }, trophy: { enabled: true, status: 'buyed' }, ps4_primary: { enabled: false, status: 'open' } }
  }],
  upcoming: [Object.assign({ id: 1, title: 'Zzyzx Soon', platform: 'PS5', release_date: '2099-01-01', non_trophy_slots: 2, trophy_slots: 1, buy_nt_price: 1299, buy_tr_price: 1999 }, price)],
  customers: [{ id: 1, customer_name: 'Zzyzx Early', game_id: 'upcoming_1', game_title: 'Zzyzx Soon', account_type: 'tr', status: 'reservation', price: 899, payments: [] }]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method, headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers), timeout: 20000 }, res => {
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
const post = (p, o, headers) => call('POST', p, { headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}), body: form(o) });

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  // An in-memory order store instead of the database.
  const stored = [];
  const orders = require('../lib/orders');
  orders.create = async fields => {
    const order = Object.assign({ ref: 'PH-' + (9000 + stored.length), url_key: 'k' + stored.length, state: 'awaiting_payment', created_at: new Date().toISOString(), deposit_due: 0 }, fields);
    stored.push(order);
    return order;
  };
  orders.getByRef = async ref => stored.find(o => o.ref === ref) || null;
  orders.listByStates = async states => stored.filter(o => !states || states.includes(o.state));
  orders.expireStaleQrs = async () => {};
  orders.advanceEndedRentals = async () => {};

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');
  const last = () => stored[stored.length - 1];

  await okAsync('checkout: a full type is sold and marked new_slot; an in-stock type is not', async () => {
    const r = await post('/order/buy', { kind: 'game', game_id: '1', account_type: 'tr', fb_name: 'Zzyzx Juan' });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.startsWith('/order/PH-'), 'to the order page, not order_error=sold: ' + r.headers.location);
    assert.deepStrictEqual([last().game_title, last().account_type, last().amount_due, last().is_buy, last().new_slot], ['Zzyzx Rented', 'tr', 1499, true, true]);
    await post('/order/buy', { kind: 'game', game_id: '2', account_type: 'nt', fb_name: 'Zzyzx Ana' });
    assert.deepStrictEqual([last().game_title, 'new_slot' in last()], ['Zzyzx Free', false]);
    await post('/order/buy', { kind: 'game', game_id: '3', account_type: 'nt', fb_name: 'Zzyzx Bea' });
    assert.strictEqual('new_slot' in last(), false, 'never stocked is set up on order already, not a new slot');
  });
  await okAsync('a bundle\'s taken slot still refuses', async () => {
    const before = stored.length;
    const r = await post('/order/buy', { kind: 'bundle', account_id: '1', slot_type: 'tr', fb_name: 'Zzyzx Cy' });
    assert.strictEqual(r.headers.location, '/buy?order_error=sold');
    assert.strictEqual(stored.length, before);
  });
  await okAsync('a Coming Soon pre-order of a full type is marked new_slot', async () => {
    await post('/order/reserve', { kind: 'buy', game_id: '1', account_type: 'tr', fb_name: 'Zzyzx Dee' });
    assert.deepStrictEqual([last().game_title, last().is_buy, last().upcoming_game_id, last().new_slot], ['Zzyzx Soon', true, 1, true]);
    await post('/order/reserve', { kind: 'buy', game_id: '1', account_type: 'nt', fb_name: 'Zzyzx Eve' });
    assert.strictEqual('new_slot' in last(), false, 'Non-Trophy still has slots');
  });
  await okAsync('the Buy shop keeps a full game, set up on order, off Ready today', async () => {
    const all = (await call('GET', '/buy/catalog')).body;
    const card = /<a href="\/game\/zzyzx-rented\?mode=buy" class="shop-card">[\s\S]*?<\/a>/.exec(all);
    assert.ok(card, 'listed');
    assert.ok(card[0].includes('<span class="shop-stock shop-wait">Set up on order</span>') && card[0].includes('₱999'));
    const ready = (await call('GET', '/buy/catalog?tab=ready-today')).body;
    assert.ok(/data-id="1" hidden>/.test(ready) && /data-id="2">/.test(ready), 'Ready today shows only in-stock games');
  });
  await okAsync('the customer\'s order page says a new slot is being added', async () => {
    const o = stored[0];
    const page = (await call('GET', '/order/' + o.ref + '?k=' + o.url_key)).body;
    assert.ok(page.includes('<div class="ord-newslot">🆕 We\'re adding a new Trophy slot for you — we\'ll message you on Facebook when it\'s ready.</div>'));
    const plain = stored[1];
    assert.ok(!(await call('GET', '/order/' + plain.ref + '?k=' + plain.url_key)).body.includes('ord-newslot'));
    o.state = 'active';
    assert.ok(!(await call('GET', '/order/' + o.ref + '?k=' + o.url_key)).body.includes('ord-newslot'), 'gone once set up');
    o.state = 'awaiting_payment';
  });
  await okAsync('the owner: New slot needed on the order, New slot to add once it is paid', async () => {
    const login = await post('/admin/login', { password: TEST_PASSWORD });
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    stored[0].state = 'awaiting_qr';
    const admin = (await call('GET', '/admin?tab=orders', { headers: { Cookie: cookie } })).body;
    assert.ok(admin.includes('<span class="oq-newslot-flag">🆕 New slot needed — add a Trophy account for Zzyzx Rented</span>'), 'the ledger row');
    assert.ok(admin.includes('New slot to add') && admin.includes('PH-9000 · Zzyzx Juan · Zzyzx Rented · Trophy'), 'Needs you now');
    stored[0].state = 'qr_pending';
    const doNow = (await call('GET', '/admin?tab=orders', { headers: { Cookie: cookie } })).body;
    assert.ok(doNow.includes('<span class="oq-badge oq-badge-newslot">🆕 New slot needed — add a Trophy account for Zzyzx Rented</span>'), 'the Do now card');
    stored[0].state = 'active';
    const done = (await call('GET', '/admin?tab=orders', { headers: { Cookie: cookie } })).body;
    assert.ok(!done.includes('New slot to add') && done.includes('<span class="oq-newslot-flag">🆕 New slot</span>'), 'set up: off Needs you now, the ledger keeps a short tag');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
