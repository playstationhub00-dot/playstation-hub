// Run: node scripts/test-slot-history-customers.js
//
// Renter history for account slots, when the change comes from the Customers
// tab and the order flow rather than the slot popup: adding a customer onto a
// slot, moving them to another account's slot, the free game swap (with and
// without a move), renting → bought, marking them done, a refund and its undo,
// deleting a customer, and a paid bundle purchase taking its slot. Each writes
// the matching line through the real routes, read back with GET
// /admin/accounts/:id/slot/:type/history.
//
// Throwaway only: a temp DATA_DIR, a blank MONGODB_URI, an in-memory session
// store, a made-up admin password, made-up names and an in-memory orders
// collection.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4667;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-history-customers-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const off = { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
const open = { enabled: true, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
const price = { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 };
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  games: [
    Object.assign({ id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5' }, price),
    Object.assign({ id: 6, title: 'Zzyzx Racer', platform: 'PS5' }, price)
  ],
  customers: [],
  nextCustomerId: 20,
  accounts: [
    { id: 3, label: 'Zzyzx PS Plus 3', game_ids: [4], slots: { trophy: open, non_trophy: off, ps4_primary: off } },
    { id: 5, label: 'Zzyzx PS Plus 5', game_ids: [4, 6], slots: { trophy: open, non_trophy: off, ps4_primary: off } },
    { id: 9, label: 'Zzyzx Bundle', game_ids: [6], for_sale: true, public_name: 'Zzyzx Pack', slots: { trophy: open, non_trophy: off, ps4_primary: off } }
  ],
  nextAccountId: 10
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'slot-history-customers-test';
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
const customerNamed = name => ledger().customers.find(c => c.customer_name === name);

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
  orders.getByRef = async ref => stored.find(o => o.ref === ref) || null;
  orders.transition = async (ref, to, patch) => {
    const o = stored.find(x => x.ref === ref);
    if (!o) return null;
    Object.assign(o, patch || {}, { state: to });
    return o;
  };
  orders.setCustomerId = async (ref, id) => { const o = stored.find(x => x.ref === ref); if (o) o.customer_id = id; return !!o; };

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const login = await call('POST', '/admin/login', { headers: FORM, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in');
  const auth = extra => Object.assign({ Cookie: cookie }, extra || {});
  async function post(p, fields, expect) {
    const r = await call('POST', p, { headers: auth(FORM), body: form(fields) });
    assert.strictEqual(r.status, 302, r.body);
    if (expect) assert.ok(expect.test(r.headers.location), r.headers.location);
  }
  async function history(accountId) {
    const r = await call('GET', '/admin/accounts/' + accountId + '/slot/trophy/history', { headers: auth({ Accept: 'application/json' }) });
    assert.strictEqual(r.status, 200, r.body);
    return JSON.parse(r.body);
  }
  const newest = async accountId => (await history(accountId)).lines[0];
  function addCustomer(name, assign) {
    return post('/admin/customers/add', {
      customer_name: name, game_id: '4', days: '30', account_type: 'tr', status: 'renting',
      start_date: day(0), end_date: day(30), price: '799', notes: '', account_assign: assign
    }, /msg=customer_added/);
  }
  function editCustomer(id, gameId, assign) {
    return post('/admin/customers/edit/' + id, {
      customer_name: 'Zzyzx Maria', game_id: String(gameId), days: '30', account_type: 'tr', status: 'renting',
      start_date: day(0), end_date: day(30), price: '799', notes: '', account_assign: assign
    }, /msg=customer_updated/);
  }

  try {
    console.log('\nCustomers: add, move, swap');
    let maria;
    await ok('adding a customer onto a slot: "started" with their game', async () => {
      await addCustomer('Zzyzx Maria', '3:trophy');
      maria = customerNamed('Zzyzx Maria');
      const h = await history(3);
      assert.deepStrictEqual(h.lines.map(l => l.title), ['Zzyzx Maria started']);
      assert.ok(h.lines[0].detail.startsWith('PS Plus Deluxe · ends '), h.lines[0].detail);
      assert.strictEqual(h.now.title, 'Zzyzx Maria');
    });
    await ok('moving them to another account\'s slot: "moved" on the old slot, "moved in" on the new', async () => {
      await editCustomer(maria.id, 4, '5:trophy');
      const out = await newest(3);
      assert.strictEqual(out.title, 'Zzyzx Maria moved');
      assert.ok(out.detail.startsWith('to Zzyzx PS Plus 5 · Trophy · rented '), out.detail);
      const inn = await newest(5);
      assert.strictEqual(inn.title, 'Zzyzx Maria moved in');
      assert.strictEqual(inn.detail, 'from Zzyzx PS Plus 3 · Trophy · PS Plus Deluxe');
      assert.strictEqual((await history(3)).now, null);
    });
    await ok('changing only their game: a swap line, and the Now line shows the new game', async () => {
      await editCustomer(maria.id, 6, '5:trophy');
      const h = await history(5);
      assert.strictEqual(h.lines[0].title, 'Zzyzx Maria swapped game');
      assert.strictEqual(h.lines[0].detail, 'PS Plus Deluxe → Zzyzx Racer · stayed on this slot');
      assert.ok(h.now.detail.startsWith('Zzyzx Racer · since '), h.now.detail);
    });
    await ok('a game swap onto another account\'s slot: both move lines name the swap', async () => {
      await editCustomer(maria.id, 4, '3:trophy');
      const out = await newest(5);
      assert.strictEqual(out.title, 'Zzyzx Maria moved');
      assert.ok(out.detail.startsWith('to Zzyzx PS Plus 3 · Trophy · swapped Zzyzx Racer → PS Plus Deluxe · rented '), out.detail);
      const inn = await newest(3);
      assert.strictEqual(inn.title, 'Zzyzx Maria moved in');
      assert.strictEqual(inn.detail, 'from Zzyzx PS Plus 5 · Trophy · swapped Zzyzx Racer → PS Plus Deluxe');
    });
    await ok('an edit that changes nothing about the slot writes nothing', async () => {
      const before = (await history(3)).total;
      await editCustomer(maria.id, 4, '3:trophy');
      assert.strictEqual((await history(3)).total, before);
    });

    console.log('\nCustomers: status, refund, delete');
    await ok('renting → bought: a status line naming them', async () => {
      await post('/admin/customers/status/' + maria.id, { status: 'bought' }, /msg=customer_updated/);
      const line = await newest(3);
      assert.deepStrictEqual([line.title, line.detail], ['Set to Bought', 'Zzyzx Maria']);
    });
    await ok('marked done: "left — returned"', async () => {
      await post('/admin/customers/status/' + maria.id, { status: 'done' }, /msg=customer_updated/);
      const line = await newest(3);
      assert.strictEqual(line.title, 'Zzyzx Maria left');
      assert.ok(line.detail.startsWith('returned · rented '), line.detail);
      assert.ok(line.detail.endsWith('· PS Plus Deluxe'), line.detail);
    });
    let bea;
    await ok('a rental refund frees the slot as "refunded"', async () => {
      await addCustomer('Zzyzx Bea', '5:trophy');
      bea = customerNamed('Zzyzx Bea');
      await post('/admin/customers/' + bea.id + '/refund', {
        confirm: 'yes', scope: 'rental', method: 'gcash', date: day(0), amount: '0'
      }, /msg=refund_saved/);
      const line = await newest(5);
      assert.strictEqual(line.title, 'Zzyzx Bea left');
      assert.ok(line.detail.startsWith('refunded · rented '), line.detail);
    });
    await ok('undoing the refund brings them back', async () => {
      const refundId = customerNamed('Zzyzx Bea').refunds[0].id;
      await post('/admin/customers/' + bea.id + '/refund', { confirm: 'yes', action: 'undo', refund_id: refundId }, /msg=refund_undone/);
      const line = await newest(5);
      assert.deepStrictEqual([line.title, line.detail], ['Zzyzx Bea came back', 'refund undone · PS Plus Deluxe']);
    });
    await ok('deleting the customer: "left — customer deleted"', async () => {
      await post('/admin/customers/delete/' + bea.id, {});
      const line = await newest(5);
      assert.strictEqual(line.title, 'Zzyzx Bea left');
      assert.ok(line.detail.startsWith('customer deleted · rented '), line.detail);
    });

    console.log('\na paid bundle purchase');
    await ok('signing the buyer in takes the slot: "bought it"', async () => {
      stored.push({
        ref: 'PH-4100', url_key: 'kb', state: 'qr_pending', is_buy: true, account_id: 9, slot_type: 'tr',
        game_id: 'bundle_9', game_title: 'Zzyzx Pack', account_type: 'tr', amount_due: 4500, deposit_due: 0,
        fb_name: 'Zzyzx Buyer', created_at: new Date().toISOString()
      });
      await post('/admin/orders/PH-4100/advance', {});
      const h = await history(9);
      assert.strictEqual(h.lines[0].title, 'Zzyzx Buyer bought it');
      assert.deepStrictEqual(h.now, { title: 'Zzyzx Buyer', detail: 'Zzyzx Pack · bought' });
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
