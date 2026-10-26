// Run: node scripts/test-refund-routes.js
//
// Cancel / Refund through the real admin route, on a throwaway database.
// MONGODB_URI is blank, so this checks the lowdb write the Mongo sync uploads
// — the same db.write() path, with sync disabled rather than a second store.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4623;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-routes-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);

const juan = {
  id: 7,
  customer_name: 'Juan Paolo Guilot',
  game_id: 1,
  game_title: 'PS Plus Deluxe',
  days: 60,
  account_type: 'tr',
  start_date: '2026-09-27',
  end_date: '2026-11-26',
  price: 1438,
  status: 'renting',
  notes: '',
  payments: [
    { amount: 619, date: '2026-09-27', kind: 'rental' },
    { amount: 819, date: '2026-10-01', kind: 'extension' }
  ],
  extensions: [{
    at: '2026-10-01T02:00:00.000Z',
    days: 30,
    amount: 819,
    from_end_date: '2026-10-27',
    end_date: '2026-11-26',
    days_total: 60,
    price_total: 1438
  }]
};
const merged = {
  id: 8,
  customer_name: 'Merged Record',
  game_id: 1,
  game_title: 'PS Plus Deluxe',
  days: 60,
  account_type: 'nt',
  start_date: '2026-09-27',
  end_date: '2026-11-26',
  price: 1438,
  status: 'renting',
  notes: '',
  payments: [{ amount: 1438, date: '2026-09-27', kind: 'rental' }]
};

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [{
    id: 1, title: 'PS Plus Deluxe', platform: 'PS5',
    nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 899,
    non_trophy_slots: 2, trophy_slots: 0, available_slots: 2
  }],
  customers: [juan, merged],
  nextCustomerId: 9,
  accounts: [{
    id: 1, label: 'PSN-1', game_ids: [1],
    slots: {
      trophy: { enabled: true, status: 'rented', renter_id: 7, renter_name: 'Juan Paolo Guilot', start: '2026-09-27', end: '2026-11-26' },
      non_trophy: { enabled: true, status: 'open', renter_id: null, renter_name: '', start: '', end: '' },
      ps4_primary: { enabled: true, status: 'open', renter_id: null, renter_name: '', start: '', end: '' }
    }
  }]
}));

process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';

const readDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const cust = id => readDb().customers.find(c => c.id === id);
const slot = () => readDb().accounts[0].slots.trophy;

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: 'localhost', port: PORT, path: p, method,
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
const form = o => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v == null ? '' : v)).join('&');

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');
  const login = await call('POST', '/admin/login', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ password: TEST_PASSWORD })
  });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in');
  const auth = { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' };
  const post = (p, fields) => call('POST', p, { headers: auth, body: form(fields) });

  console.log('\ncustomers page');
  const page = await call('GET', '/admin?tab=customers', { headers: { Cookie: cookie } });
  assert.strictEqual(page.status, 200);

  await ok('the row has Cancel / Refund, and Cancelled and Refunded are filters', async () => {
    assert.ok(page.body.includes('Cancel / Refund'));
    assert.ok(page.body.includes('id="cf-cancelled"'));
    assert.ok(page.body.includes('id="cf-refunded"'));
    assert.ok(page.body.includes('Juan Paolo Guilot'));
    assert.ok(page.body.includes('record:0'), 'the saved 30-day extension is offered');
  });

  console.log('\nextension refund');
  await ok('a missing confirmation changes nothing', async () => {
    const res = await post('/admin/customers/7/refund', {
      scope: 'extension', extension_key: 'record:0', amount: 819, method: 'gcash', date: '2026-10-25'
    });
    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.location.includes('refund_unconfirmed'));
    assert.strictEqual(cust(7).days, 60);
    assert.strictEqual(cust(7).price, 1438);
  });

  await ok('cancelling the 30-day extension keeps the rental and frees the extra month', async () => {
    const res = await post('/admin/customers/7/refund', {
      confirm: 'yes', scope: 'extension', extension_key: 'record:0',
      amount: 819, method: 'gcash', date: '2026-10-25', note: 'extra month'
    });
    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.location.includes('refund_saved'), res.headers.location);
    const c = cust(7);
    assert.strictEqual(c.status, 'renting');
    assert.strictEqual(c.days, 30);
    assert.strictEqual(c.end_date, '2026-10-27');
    assert.strictEqual(c.price, 619);
    assert.strictEqual(c.payments.reduce((s, p) => s + p.amount, 0), 619);
    assert.strictEqual(c.payments[c.payments.length - 1].kind, 'refund');
    assert.strictEqual(c.extensions[0].cancelled.method, 'gcash');
    assert.strictEqual(slot().end, '2026-10-27');
    assert.strictEqual(slot().status, 'rented');
    assert.strictEqual(readDb().games[0].trophy_slots, 0, 'the account is still in use');
  });

  await ok('the customers table shows the audit line and the row is still Renting', async () => {
    const again = await call('GET', '/admin?tab=customers', { headers: { Cookie: cookie } });
    assert.ok(again.body.includes('Extension cancelled, ₱819 refunded (GCash) on Oct 25, 2026'));
    assert.ok(again.body.includes('extra month'));
    assert.ok(again.body.includes('data-status="renting"'));
  });

  await ok('undo puts the extension back, including the account end date', async () => {
    const id = cust(7).refunds[0].id;
    const res = await post('/admin/customers/7/refund', { confirm: 'yes', action: 'undo', refund_id: id });
    assert.ok(res.headers.location.includes('refund_undone'), res.headers.location);
    const c = cust(7);
    assert.strictEqual(c.days, 60);
    assert.strictEqual(c.end_date, '2026-11-26');
    assert.strictEqual(c.price, 1438);
    assert.strictEqual(c.status, 'renting');
    assert.ok(!c.extensions[0].cancelled);
    assert.ok(!c.payments.some(p => p.kind === 'refund'));
    assert.strictEqual(slot().end, '2026-11-26');
  });

  console.log('\nmerged extension and whole-rental cancel');
  await ok('a rental with no extension row can still be shortened by the days typed', async () => {
    const res = await post('/admin/customers/8/refund', {
      confirm: 'yes', scope: 'extension', extension_key: 'manual', days: 30,
      amount: 819, method: 'maya', date: '2026-10-25', note: ''
    });
    assert.ok(res.headers.location.includes('refund_saved'), res.headers.location);
    const c = cust(8);
    assert.strictEqual(c.status, 'renting');
    assert.strictEqual(c.days, 30);
    assert.strictEqual(c.end_date, '2026-10-27');
    assert.strictEqual(c.price, 619);
  });

  await ok('cancelling the whole rental frees the PSN slot and keeps the original price on the record', async () => {
    const res = await post('/admin/customers/7/refund', {
      confirm: 'yes', scope: 'rental', extension_key: 'rental',
      amount: 819, method: 'gcash', date: '2026-10-25', note: ''
    });
    assert.ok(res.headers.location.includes('refund_saved'), res.headers.location);
    const c = cust(7);
    assert.strictEqual(c.status, 'cancelled');
    assert.strictEqual(c.price, 619);
    assert.strictEqual(c.cancellation.gross, 1438);
    assert.strictEqual(c.days, 60, 'the original duration stays on the record');
    assert.strictEqual(slot().status, 'open');
    assert.strictEqual(slot().renter_id, null);
    assert.strictEqual(readDb().games[0].trophy_slots, 1);
    const again = await call('GET', '/admin?tab=customers', { headers: { Cookie: cookie } });
    assert.ok(again.body.includes('data-status="cancelled"'));
    assert.ok(again.body.includes('paid ₱1438'));
    assert.ok(!again.body.includes('data-status="renting">') || again.body.includes('Merged Record'));
  });

  await ok('undoing the cancellation puts Juan back on the same slot', async () => {
    const id = cust(7).cancellation.id;
    const res = await post('/admin/customers/7/refund', { confirm: 'yes', action: 'undo', refund_id: id });
    assert.ok(res.headers.location.includes('refund_undone'), res.headers.location);
    const c = cust(7);
    assert.strictEqual(c.status, 'renting');
    assert.strictEqual(c.price, 1438);
    assert.strictEqual(c.cancellation, null);
    assert.strictEqual(slot().status, 'rented');
    assert.strictEqual(slot().renter_id, 7);
    assert.strictEqual(readDb().games[0].trophy_slots, 0);
  });

  console.log('\n' + passed + ' assertions passed\n');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
