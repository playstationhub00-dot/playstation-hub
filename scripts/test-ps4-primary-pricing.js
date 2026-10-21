// Run: node scripts/test-ps4-primary-pricing.js
//
// PS4 Primary is quoted at the Trophy price on the game page. Checkout, the
// order page, the admin ledger, and Quick Add (including a 30-day promo, a
// ₱50 rebook, and a punch-card credit) have to charge that same Trophy price
// plus the refundable deposit. An order already saved keeps the total it was
// stored with.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 47381;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-primary-price-'));
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

// Hogwarts Legacy, the prices the support bot already quotes:
// Non-Trophy 249/499, Trophy 299/599. Deposit 100.
const HOGWARTS = {
  id: 1, title: 'Hogwarts Legacy', platform: 'PS4/PS5',
  nt_price_7d: 249, nt_price_30d: 499, tr_price_7d: 299, tr_price_30d: 599,
  non_trophy_slots: 1, trophy_slots: 1, ps4_primary_slots: 2
};
// Own 20% monthly discount, so a promo still applies when the site promo is off.
const OWN = {
  id: 2, title: 'Spider-Man', platform: 'PS4/PS5',
  nt_price_7d: 200, nt_price_30d: 400, tr_price_7d: 300, tr_price_30d: 700,
  discounts: { 30: 20 },
  non_trophy_slots: 1, trophy_slots: 1, ps4_primary_slots: 1
};

function paid(partial) {
  const start = partial.start_date;
  return Object.assign({
    customer_name: 'Pia Cruz',
    game_title: 'Old Game',
    game_id: 1,
    account_type: 'nt',
    status: 'done',
    days: 7,
    price: 249,
    payments: [{ amount: 249, date: start, kind: 'rental' }]
  }, partial);
}

const customers = [];
for (let i = 1; i <= 5; i++) {
  const end = addDays(today, -40 * i);
  customers.push(paid({ id: i, start_date: addDays(end, -7), end_date: end, order_ref: 'PH-10' + i }));
}
const riaEnd = addDays(today, -1);
customers.push(paid({
  id: 6, customer_name: 'Ria Santos', start_date: addDays(riaEnd, -7), end_date: riaEnd, order_ref: 'PH-1106'
}));
for (let i = 1; i <= 5; i++) {
  const end = addDays(today, -50 * i);
  customers.push(paid({
    id: 10 + i, customer_name: 'Bea Lim', start_date: addDays(end, -7), end_date: end, order_ref: 'PH-12' + i
  }));
}
// Already placed, and undercharged at the Non-Trophy week. The page must keep
// showing this stored total.
customers.push({
  id: 7, customer_name: 'Live PS4', game_title: 'Hogwarts Legacy', game_id: 1,
  account_type: 'ps4', status: 'renting', days: 7, price: 249,
  start_date: today, end_date: addDays(today, 7),
  payments: [{ amount: 249, date: today, kind: 'rental' }],
  order_ref: 'PH-0099'
});

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  nextCustomerId: 20,
  customers,
  games: [HOGWARTS, OWN],
  loyalty_redemptions: [],
  loyalty_next_id: 1,
  site_settings: {
    promo: {
      enabled: false,
      discounts: { 7: 0, 30: 0 },
      deposit: 100,
      late_fee_per_day: 20,
      buy_promo_enabled: false,
      buy_promo_pct: 0
    }
  }
}));

process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'ps4-primary-pricing-test';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const stored = [{
  ref: 'PH-0099', url_key: 'old-key', state: 'awaiting_payment',
  game_id: 1, game_title: 'Hogwarts Legacy', account_type: 'ps4', days: 7,
  amount_due: 249, deposit_due: 100, fb_name: 'Old Customer',
  created_at: new Date().toISOString()
}];

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
const ledger = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));

function orderByRef(ref) {
  const found = stored.filter(o => o.ref === ref);
  assert.strictEqual(found.length, 1, 'order ' + ref);
  return found[0];
}

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
      ref: 'PH-' + String(2000 + stored.length),
      url_key: 'k' + stored.length,
      state: fields.state || 'awaiting_payment',
      created_at: new Date().toISOString(),
      deposit_due: 0
    }, fields);
    stored.push(order);
    return order;
  };
  orders.getByRef = async ref => stored.find(o => o.ref === ref) || null;
  orders.listByStates = async () => stored.slice();

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
  const auth = extra => Object.assign({ Cookie: cookie }, extra || {});

  async function checkout(fields) {
    const before = stored.length;
    const r = await call('POST', '/order/create', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form(Object.assign({ game_id: '1', account_type: 'ps4', fb_name: 'New Renter' }, fields))
    });
    assert.strictEqual(r.status, 302, r.headers.location || r.body);
    assert.ok(stored.length === before + 1, 'order was saved');
    return stored[stored.length - 1];
  }

  try {
    console.log('\ncheckout charges the Trophy price for PS4 Primary');

    await ok('weekly total with no promo is the Trophy week plus the deposit', async () => {
      const order = await checkout({ days: '7' });
      assert.strictEqual(order.amount_due, 299);
      assert.strictEqual(order.deposit_due, 100);
      assert.strictEqual(order.amount_due + order.deposit_due, 399);
    });

    await ok('monthly total with no promo is the Trophy month plus the deposit', async () => {
      const order = await checkout({ days: '30' });
      assert.strictEqual(order.amount_due, 599);
      assert.strictEqual(order.deposit_due, 100);
      assert.strictEqual(order.amount_due + order.deposit_due, 699);
    });

    await ok('a per-game monthly promo comes off the Trophy price, and the week stays full', async () => {
      const week = await checkout({ game_id: '2', days: '7', fb_name: 'Spider Week' });
      const month = await checkout({ game_id: '2', days: '30', fb_name: 'Spider Month' });
      assert.strictEqual(week.amount_due, 300);
      assert.strictEqual(week.deposit_due, 100);
      assert.strictEqual(month.amount_due, 560, '700 minus 20%, not 400 minus 20%');
      assert.strictEqual(month.deposit_due, 100);
      assert.strictEqual(month.amount_due + month.deposit_due, 660);
    });

    const promoOn = await call('POST', '/admin/promo', {
      headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form({
        enabled: 'on', discount_7: '0', discount_30: '10', deposit: '100', late_fee_per_day: '20'
      })
    });
    assert.strictEqual(promoOn.status, 302, 'promo saved');

    await ok('weekly total with a monthly-only promo is still the full Trophy week plus deposit', async () => {
      const order = await checkout({ days: '7', fb_name: 'Promo Week' });
      assert.strictEqual(order.amount_due, 299);
      assert.strictEqual(order.deposit_due, 100);
      assert.strictEqual(order.amount_due + order.deposit_due, 399);
    });

    await ok('monthly total with the 10% promo is the discounted Trophy month plus deposit', async () => {
      const order = await checkout({ days: '30', fb_name: 'Promo Month' });
      assert.strictEqual(order.amount_due, 539, '599 minus 10%');
      assert.strictEqual(order.deposit_due, 100);
      assert.strictEqual(order.amount_due + order.deposit_due, 639);
    });

    await ok('a sold-out PS4 reservation and a free waitlist keep the Trophy month', async () => {
      async function reserve(fields) {
        const before = stored.length;
        const r = await call('POST', '/order/reserve', {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form(Object.assign({ game_id: '1', account_type: 'ps4', days: '30' }, fields))
        });
        assert.strictEqual(r.status, 302, r.headers.location || r.body);
        assert.strictEqual(stored.length, before + 1);
        return stored[stored.length - 1];
      }
      const priority = await reserve({ fb_name: 'Priority PS4', kind: 'priority' });
      assert.strictEqual(priority.amount_due, 100);
      assert.strictEqual(priority.deposit_due, 0);
      assert.strictEqual(priority.remaining_due, 539, '539 rent after 10% plus the 100 deposit, minus the 100 fee');
      const waiting = await reserve({ fb_name: 'Wait PS4', kind: 'queue' });
      assert.strictEqual(waiting.amount_due, 0);
      assert.strictEqual(waiting.deposit_due, 0);
      assert.strictEqual(waiting.remaining_due, 639);
      assert.strictEqual(waiting.is_waitlist, true);
    });

    console.log('\nloyalty discounts apply on top of the Trophy price');

    await ok('a ₱50 rebook comes off the Trophy week, and the deposit stays', async () => {
      const status = await call('GET', '/admin/loyalty/for-name?name=' + encodeURIComponent('Ria Santos'), { headers: auth() });
      const body = JSON.parse(status.body);
      const offer = (body.offers || []).find(o => o.kind === 'rebook');
      assert.ok(offer, 'rebook offer: ' + status.body);
      const r = await call('POST', '/admin/quick-add', {
        headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }),
        body: form({
          customer_name: 'Ria Santos', game_id: '1', account_type: 'ps4', status: 'renting',
          days: '7', paid: 'yes', method: 'gcash', pricing_mode: 'promo', signed_in: 'yes',
          start_date: today, loyalty_choice: offer.choice
        })
      });
      assert.strictEqual(r.status, 200, r.body);
      const saved = JSON.parse(r.body);
      assert.strictEqual(saved.total, 349, '299 - 50 + 100 deposit');
      const order = orderByRef(saved.ref);
      assert.strictEqual(order.amount_due, 249);
      assert.strictEqual(order.deposit_due, 100);
    });

    await ok('a free week on PS4 Primary credits the Trophy week and still adds the deposit', async () => {
      const status = await call('GET', '/admin/loyalty/for-name?name=' + encodeURIComponent('Bea Lim'), { headers: auth() });
      const offer = (JSON.parse(status.body).offers || []).find(o => o.kind === 'punch');
      assert.ok(offer, status.body);
      const r = await call('POST', '/admin/quick-add', {
        headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }),
        body: form({
          customer_name: 'Bea Lim', game_id: '1', account_type: 'ps4', status: 'renting',
          days: '7', paid: 'yes', method: 'gcash', pricing_mode: 'promo', signed_in: 'yes',
          start_date: today, loyalty_choice: offer.choice
        })
      });
      assert.strictEqual(r.status, 200, r.body);
      const saved = JSON.parse(r.body);
      assert.strictEqual(saved.total, 100, 'rent goes to 0, deposit stays');
      const order = orderByRef(saved.ref);
      assert.strictEqual(order.amount_due, 0);
      assert.strictEqual(order.deposit_due, 100);
      const redemption = ledger().loyalty_redemptions.find(row => row.order_ref === saved.ref);
      assert.strictEqual(redemption.amount, 299);
    });

    await ok('a monthly PS4 rental subtracts one Trophy week for the punch card, after the 10% promo', async () => {
      const status = await call('GET', '/admin/loyalty/for-name?name=' + encodeURIComponent('Pia Cruz'), { headers: auth() });
      const offer = (JSON.parse(status.body).offers || []).find(o => o.kind === 'punch');
      assert.ok(offer, status.body);
      const r = await call('POST', '/admin/quick-add', {
        headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }),
        body: form({
          customer_name: 'Pia Cruz', game_id: '1', account_type: 'ps4', status: 'renting',
          days: '30', paid: 'yes', method: 'gcash', pricing_mode: 'promo', signed_in: 'yes',
          start_date: today, loyalty_choice: offer.choice
        })
      });
      assert.strictEqual(r.status, 200, r.body);
      const saved = JSON.parse(r.body);
      // 599 - 10% = 539, minus the Trophy week 299, plus the 100 deposit.
      assert.strictEqual(saved.total, 340, r.body);
      const order = orderByRef(saved.ref);
      assert.strictEqual(order.amount_due, 240);
      assert.strictEqual(order.deposit_due, 100);
      const redemption = ledger().loyalty_redemptions.find(row => row.order_ref === saved.ref);
      assert.ok(redemption, 'punch recorded');
      assert.strictEqual(redemption.amount, 299, 'credited the Trophy week, not 249');
    });

    console.log('\nstored orders stay as they were saved');

    await ok('an order placed at the old price still shows that stored total', async () => {
      const page = await call('GET', '/order/PH-0099?k=old-key');
      assert.strictEqual(page.status, 200);
      assert.ok(page.body.includes('PS4 Primary'));
      assert.ok(page.body.includes('₱249'), page.body.slice(page.body.indexOf('ord-card'), page.body.indexOf('ord-card') + 800));
      assert.ok(page.body.includes('₱349'));
      assert.ok(!page.body.includes('₱399'));
      assert.strictEqual(orderByRef('PH-0099').amount_due, 249);
      assert.strictEqual(orderByRef('PH-0099').deposit_due, 100);
      assert.strictEqual(ledger().customers.find(c => c.id === 7).price, 249);
    });

    await ok('a new PS4 order page shows the Trophy total that checkout stored', async () => {
      const order = stored.find(o => o.fb_name === 'Promo Week');
      assert.ok(order, 'promo week order');
      const page = await call('GET', '/order/' + order.ref + '?k=' + order.url_key);
      assert.strictEqual(page.status, 200);
      assert.ok(page.body.includes('₱299'));
      assert.ok(page.body.includes('₱399'));
      assert.ok(page.body.includes('+₱100'));
    });

    await ok('the admin ledger and the extend quote use the Trophy price without rewriting the old rental', async () => {
      const page = await call('GET', '/admin?tab=orders', { headers: auth() });
      assert.strictEqual(page.status, 200, page.body.slice(0, 300));
      function ledgerRow(ref) {
        const at = page.body.indexOf('oq-lref">' + ref);
        assert.ok(at > 0, ref + ' is on the ledger');
        return page.body.slice(at, at + 900);
      }
      const oldRow = ledgerRow('PH-0099');
      assert.ok(oldRow.includes('PS4 Primary'), oldRow);
      assert.ok(oldRow.includes('₱349'), oldRow);
      const fresh = stored.find(o => o.fb_name === 'Promo Month');
      const freshRow = ledgerRow(fresh.ref);
      assert.ok(freshRow.includes('PS4 Primary'), freshRow);
      assert.ok(freshRow.includes('₱639'), freshRow);
      const extendAt = page.body.indexOf('data-name="Live PS4"');
      assert.ok(extendAt > 0, 'extend button for the live PS4 rental');
      const extend = page.body.slice(extendAt, extendAt + 250);
      assert.ok(/data-p7="299"/.test(extend), extend);
      assert.ok(/data-p30="539"/.test(extend), extend);
      assert.strictEqual(ledger().customers.find(c => c.id === 7).price, 249);
    });

    console.log('\n' + passed + ' assertions passed\n');
  } finally {
    cleanup();
  }
  process.exit(0);
})().catch(e => { console.error(e); cleanup(); process.exit(1); });
