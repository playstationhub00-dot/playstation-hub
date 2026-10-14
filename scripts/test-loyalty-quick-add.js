// Run: node scripts/test-loyalty-quick-add.js
//
// Quick Add is the form that adds a rental. Typing a name has to show that
// customer's loyalty (same name folding and merge links as the Loyalty tab),
// and applying a reward has to change the price and record the redemption
// against the new rental so it cannot be used twice. Throwaway DATA_DIR, no
// Mongo — order creation is stubbed because orders live only in Mongo.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 47241;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loyalty-qa-'));
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
    game_id: 1,
    account_type: 'nt',
    status: 'done',
    days: 7,
    price: 199,
    payments: [{ amount: 199, date: start, kind: 'rental' }],
    order_ref: ''
  }, partial);
}

const customers = [1, 2, 3, 4, 5].map(i => {
  const end = addDays(today, -40 - (5 - i) * 40);
  return paid({
    id: i,
    start_date: addDays(end, -7),
    end_date: end,
    order_ref: 'PH-10' + i
  });
});
customers.push(paid({
  id: 6,
  customer_name: 'Cara Lim',
  start_date: addDays(today, -8),
  end_date: addDays(today, -1),
  status: 'renting',
  order_ref: 'PH-2001'
}));
[1, 2, 3, 4, 5].forEach(i => {
  const end = addDays(today, -50 - i * 40);
  customers.push(paid({
    id: 10 + i,
    customer_name: 'Ben Uy',
    start_date: addDays(end, -7),
    end_date: end,
    order_ref: 'PH-30' + i
  }));
});

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  nextCustomerId: 40,
  customers,
  games: [{
    id: 1, title: 'Astro Bot', platform: 'PS5',
    nt_price_7d: 199, nt_price_30d: 599, tr_price_7d: 349, tr_price_30d: 899,
    buy_nt_price: 1500, available_slots: 5
  }],
  loyalty_identity: { aliases: { 'ana c.': 'ana cruz' }, rows: {} },
  loyalty_redemptions: [],
  loyalty_next_id: 1,
  site_settings: {
    promo: { enabled: false, no_discounts: true, discounts: { 10: 0, 15: 0, 30: 0 }, deposit: 0, late_fee_per_day: 20, buy_promo_enabled: false, buy_promo_pct: 0 }
  }
}));

process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const orders = require('../lib/orders');
const createdOrders = [];
orders.create = async function (fields) {
  const order = Object.assign({
    ref: 'PH-' + String(9001 + createdOrders.length),
    url_key: 'key' + createdOrders.length
  }, fields);
  createdOrders.push(order);
  return order;
};

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
function ledger() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
}

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function rentalBody(extra) {
  return Object.assign({
    customer_name: 'Ana Cruz',
    game_id: '1',
    account_type: 'nt',
    status: 'renting',
    days: '7',
    paid: 'yes',
    method: 'manual',
    pricing_mode: 'full',
    signed_in: 'yes',
    start_date: today
  }, extra);
}

(async () => {
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
  const auth = extra => Object.assign({ Cookie: cookie, Accept: 'application/json' }, extra || {});

  try {
    await ok('a brand-new name is 0 punches, and a merged spelling matches the Loyalty tab', async () => {
      const fresh = await call('GET', '/admin/loyalty/for-name?name=' + encodeURIComponent('Bea Santos'), { headers: auth() });
      assert.strictEqual(fresh.status, 200);
      const freshBody = JSON.parse(fresh.body);
      assert.strictEqual(freshBody.headline, 'New customer, 0 punches');
      assert.deepStrictEqual(freshBody.offers, []);

      const alias = await call('GET', '/admin/loyalty/for-name?name=' + encodeURIComponent('  ANA   c. '), { headers: auth() });
      const aliasBody = JSON.parse(alias.body);
      assert.strictEqual(aliasBody.known, true);
      assert.strictEqual(aliasBody.rentalCount, 5);
      assert.strictEqual(aliasBody.punches, 5);
      assert.ok(aliasBody.lines.some(l => l.includes('1 free rental available')));
      assert.ok(aliasBody.offers.some(o => o.choice === 'punch:1'));

      const cara = await call('GET', '/admin/loyalty/for-name?name=' + encodeURIComponent('cara lim'), { headers: auth() });
      const caraBody = JSON.parse(cara.body);
      assert.ok(caraBody.lines.some(l => l.includes('₱50') && l.includes('until')));
      assert.strictEqual(caraBody.rebookOpen, true);
      assert.ok(caraBody.offers.some(o => o.kind === 'rebook' && o.choice.indexOf('rebook:open:') === 0));
    });

    await ok('applying the free rental on a longer booking credits the 7-day price and records it once', async () => {
      const r = await call('POST', '/admin/quick-add', {
        headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: form(rentalBody({ days: '30', loyalty_choice: 'punch:1' }))
      });
      assert.strictEqual(r.status, 200, r.body);
      const body = JSON.parse(r.body);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.total, 400);
      assert.ok(body.loyalty && /free 7-day/i.test(body.loyalty));
      const db = ledger();
      const row = db.customers.find(c => c.id === 40);
      assert.ok(row, 'new rental row');
      assert.strictEqual(row.price, 400);
      assert.strictEqual(row.customer_name, 'Ana Cruz');
      assert.strictEqual(db.loyalty_redemptions.length, 1);
      const rec = db.loyalty_redemptions[0];
      assert.strictEqual(rec.kind, 'punch');
      assert.strictEqual(rec.reward_index, 1);
      assert.strictEqual(rec.rental_id, 40);
      assert.strictEqual(rec.order_ref, body.ref);
      assert.strictEqual(rec.profile_key, 'ana cruz');
      assert.strictEqual(rec.amount, 199);

      const again = await call('POST', '/admin/quick-add', {
        headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: form(rentalBody({ days: '7', loyalty_choice: 'punch:1', customer_name: 'Ana C.' }))
      });
      assert.strictEqual(again.status, 400, again.body);
      const againBody = JSON.parse(again.body);
      assert.strictEqual(againBody.ok, false);
      assert.strictEqual(ledger().loyalty_redemptions.length, 1);
      assert.strictEqual(ledger().customers.filter(c => c.id >= 40).length, 1);
    });

    await ok('applying the open rebook discount subtracts ₱50 and links the redemption to the new rental', async () => {
      const lookup = await call('GET', '/admin/loyalty/for-name?name=' + encodeURIComponent('Cara Lim'), { headers: auth() });
      const choice = JSON.parse(lookup.body).offers.find(o => o.kind === 'rebook').choice;
      const r = await call('POST', '/admin/quick-add', {
        headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: form(rentalBody({ customer_name: 'Cara Lim', days: '7', loyalty_choice: choice }))
      });
      assert.strictEqual(r.status, 200, r.body);
      const body = JSON.parse(r.body);
      assert.strictEqual(body.total, 149);
      const db = ledger();
      const row = db.customers.find(c => c.customer_name === 'Cara Lim' && c.id !== 6);
      assert.ok(row);
      assert.strictEqual(row.price, 149);
      const rec = db.loyalty_redemptions.find(x => x.kind === 'rebook');
      assert.ok(rec);
      assert.strictEqual(rec.rental_id, row.id);
      assert.strictEqual(rec.order_ref, body.ref);
      assert.strictEqual(rec.opportunity_key, choice.slice('rebook:'.length));
      assert.strictEqual(rec.amount, 50);
      const after = await call('GET', '/admin/loyalty/for-name?name=' + encodeURIComponent('Cara Lim'), { headers: auth() });
      const afterBody = JSON.parse(after.body);
      assert.strictEqual(afterBody.rebookOpen, false);
      assert.ok(!afterBody.offers.some(o => o.choice === choice));
    });

    await ok('a purchase cannot spend a rental reward', async () => {
      const before = ledger().loyalty_redemptions.length;
      const customersBefore = ledger().customers.length;
      const r = await call('POST', '/admin/quick-add', {
        headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: form(rentalBody({
          customer_name: 'Ben Uy',
          status: 'bought',
          loyalty_choice: 'punch:1'
        }))
      });
      assert.strictEqual(r.status, 400, r.body);
      assert.ok(/rental with dates/i.test(JSON.parse(r.body).message));
      assert.strictEqual(ledger().loyalty_redemptions.length, before);
      assert.strictEqual(ledger().customers.length, customersBefore);
    });

    await ok('a free 7-day rental sets the new rental price to 0', async () => {
      const r = await call('POST', '/admin/quick-add', {
        headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: form(rentalBody({ customer_name: 'Ben Uy', days: '7', loyalty_choice: 'punch:1' }))
      });
      assert.strictEqual(r.status, 200, r.body);
      const body = JSON.parse(r.body);
      assert.strictEqual(body.total, 0);
      const row = ledger().customers.find(c => c.customer_name === 'Ben Uy' && c.id >= 40);
      assert.ok(row);
      assert.strictEqual(row.price, 0);
      assert.deepStrictEqual(row.payments, []);
      const rec = ledger().loyalty_redemptions.find(x => x.rental_id === row.id);
      assert.ok(rec && rec.kind === 'punch');
    });

    console.log('\n' + passed + ' assertions passed\n');
  } catch (err) {
    console.error(err);
    passed = -1;
  } finally {
    cleanup();
    process.exit(passed === 5 ? 0 : 1);
  }
})().catch(err => {
  console.error(err);
  cleanup();
  process.exit(1);
});
