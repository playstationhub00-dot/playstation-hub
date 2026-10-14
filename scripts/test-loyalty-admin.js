// Run: node scripts/test-loyalty-admin.js
//
// The Loyalty tab on a throwaway server: who qualifies, the reward badge on
// a live customer, marking a reward redeemed, and merging two names. Temp
// DATA_DIR, no Mongo, in-memory sessions. The project's database is not touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 47221;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loyalty-admin-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);

function manilaToday() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function addDays(ymd, n) {
  const parts = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const today = manilaToday();
function paid(partial) {
  const start = partial.start_date;
  return Object.assign({
    customer_name: 'Ana Cruz',
    game_title: 'Astro Bot',
    account_type: 'nt',
    status: 'done',
    days: 7,
    price: 199,
    payments: [{ amount: 199, date: start, kind: 'rental' }],
    order_ref: ''
  }, partial);
}

const customers = [1, 2, 3, 4].map(i => {
  const end = addDays(today, -20 - (i - 1) * 40);
  const start = addDays(end, -7);
  return paid({
    id: i, game_title: 'Game ' + i, start_date: start, end_date: end, status: 'done', order_ref: 'PH-100' + i
  });
});
customers.push(paid({
  id: 5, game_title: 'Game 5', start_date: today, end_date: addDays(today, 7),
  status: 'renting', order_ref: 'PH-1005'
}));
const caraStart = addDays(today, -8);
customers.push(paid({
  id: 6, customer_name: 'Cara Lim', game_title: 'Returnal',
  start_date: caraStart, end_date: addDays(today, -1), status: 'renting', order_ref: 'PH-2001'
}));
customers.push(paid({
  id: 7, customer_name: 'Cara L', game_title: 'Old Game',
  start_date: addDays(today, -80), end_date: addDays(today, -73), status: 'done'
}));
[1, 2, 3].forEach(i => {
  const end = addDays(today, -15 - (i - 1) * 40);
  const start = addDays(end, -7);
  customers.push(paid({
    id: 10 + i, customer_name: 'Ben Uy', game_title: 'Trophy ' + i, account_type: 'tr',
    start_date: start, end_date: end, status: 'done'
  }));
});
customers.push({
  id: 20, customer_name: 'Dee Unpaid', game_title: 'Unpaid', account_type: 'nt', status: 'renting',
  start_date: addDays(today, -2), end_date: addDays(today, 5), price: 199, payments: [], days: 7
});
customers.push({
  id: 21, customer_name: 'Eve Buyer', game_title: 'Bought', account_type: 'nt', status: 'bought',
  start_date: addDays(today, -10), end_date: '', price: 999,
  payments: [{ amount: 999, date: addDays(today, -10), kind: 'purchase' }]
});

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  customers: customers,
  nextCustomerId: 30
}));

process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

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
const form = o => new URLSearchParams(o).toString();
function slice(html, from, to) {
  const i = html.indexOf(from);
  assert.ok(i >= 0, from + ' found');
  const j = to ? html.indexOf(to, i + from.length) : html.length;
  return html.slice(i, j < 0 ? html.length : j);
}

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
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  await okAsync('redeeming requires the admin login', async () => {
    const r = await call('POST', '/admin/loyalty/redeem', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
      body: form({ profile_key: 'ana cruz', choice: 'punch:1', rental_id: '5' })
    });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
  });

  const login = await call('POST', '/admin/login', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ password: TEST_PASSWORD })
  });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in');
  const auth = extra => Object.assign({ Cookie: cookie }, extra || {});

  await okAsync('the Loyalty tab lists punches, the rebook expiry, and hides unpaid and purchases', async () => {
    const r = await call('GET', '/admin?tab=loyalty', { headers: auth() });
    assert.strictEqual(r.status, 200);
    const tab = slice(r.body, 'id="tab-loyalty"', 'id="tab-orders"');
    assert.ok(tab.includes('id="loyaltySearch"'));
    assert.ok(tab.includes('id="loyaltyRewardOnly"'));
    assert.ok(tab.includes('Has reward available'));
    assert.ok(tab.includes('Ana Cruz'));
    assert.ok(tab.includes('0/5'));
    assert.ok(tab.includes('data-reward="1"'));
    assert.ok(tab.includes('Cara Lim'));
    assert.ok(tab.includes('₱50 until'));
    assert.ok(!tab.includes('Dee Unpaid'));
    assert.ok(!tab.includes('Eve Buyer'));
    assert.ok(tab.includes('name="punch_every"'));
    assert.ok(/name="punch_every"[^>]*value="5"/.test(tab));
    const customersTab = slice(r.body, 'id="tab-customers"', 'id="tab-loyalty"');
    const ana = customersTab.slice(customersTab.indexOf('Ana Cruz'), customersTab.indexOf('Ana Cruz') + 400);
    assert.ok(ana.includes('loyalty-badge'), 'live customer row shows the reward badge');
    assert.ok(ana.includes('free rental'));
  });

  await okAsync('a reward needs a rental or an order before it can be marked redeemed', async () => {
    const r = await call('POST', '/admin/loyalty/redeem', {
      headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }),
      body: form({ profile_key: 'ana cruz', choice: 'punch:1' })
    });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.includes('msg=loyalty_redeem_rejected'));
  });

  await okAsync('marking the free rental redeemed keeps who, when, the rental, and drops the badge', async () => {
    const r = await call('POST', '/admin/loyalty/redeem', {
      headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }),
      body: form({ profile_key: 'ana cruz', choice: 'punch:1', rental_id: '5', order_ref: 'PH-1005', amount: '0', note: 'free week' })
    });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.includes('msg=loyalty_redeemed'));
    const page = await call('GET', '/admin?tab=loyalty', { headers: auth() });
    const tab = slice(page.body, 'id="tab-loyalty"', 'id="tab-orders"');
    const anaAt = tab.indexOf('data-search="ana cruz');
    const anaRow = tab.slice(Math.max(0, anaAt - 80), anaAt + 2500);
    assert.ok(anaRow.includes('data-reward="0"'));
    assert.ok(anaRow.includes('admin ·'));
    assert.ok(anaRow.includes('rental #5'));
    assert.ok(anaRow.includes('PH-1005'));
    assert.ok(anaRow.includes('free week'));
    const customersTab = slice(page.body, 'id="tab-customers"', 'id="tab-loyalty"');
    const ana = customersTab.slice(customersTab.indexOf('Ana Cruz'), customersTab.indexOf('Ana Cruz') + 250);
    assert.ok(!ana.includes('loyalty-badge'));
  });

  await okAsync('merging a short name into the full name adds the rentals', async () => {
    const r = await call('POST', '/admin/loyalty/merge', {
      headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }),
      body: form({ from_name: 'Cara L', into_name: 'Cara Lim' })
    });
    assert.ok(r.headers.location.includes('msg=loyalty_link_saved'));
    const page = await call('GET', '/admin?tab=loyalty', { headers: auth() });
    const tab = slice(page.body, 'id="tab-loyalty"', 'id="tab-orders"');
    assert.ok(!tab.includes('>Cara L<'));
    const caraAt = tab.indexOf('data-search="cara lim');
    const cara = tab.slice(Math.max(0, caraAt - 40), caraAt + 1200);
    assert.ok(cara.includes('>2</td>'));
    assert.ok(tab.includes('cara l'));
  });

  await okAsync('turning trophy double on makes three trophy rentals a reward', async () => {
    const r = await call('POST', '/admin/loyalty/settings', {
      headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }),
      body: form({
        return_tab: 'loyalty', punch_enabled: 'on', punch_every: '5', reward_days: '7',
        trophy_double: 'on', rebook_enabled: 'on', rebook_amount: '50', rebook_within_days: '7'
      })
    });
    assert.ok(r.headers.location.includes('msg=loyalty_saved'));
    const page = await call('GET', '/admin?tab=loyalty', { headers: auth() });
    const tab = slice(page.body, 'id="tab-loyalty"', 'id="tab-orders"');
    const benAt = tab.indexOf('data-search="ben uy');
    const ben = tab.slice(Math.max(0, benAt - 40), benAt + 1200);
    assert.ok(ben.includes('data-reward="1"'));
    assert.ok(ben.includes('trophy ×2'));
    assert.ok(tab.includes('name="trophy_double"'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  cleanup();
  process.exit(1);
});
