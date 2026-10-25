// Run: node scripts/test-orders-bulk-cancel.js
//
// "Cancel selected" on Admin → Orders → By game, through the real route
// (POST /admin/orders/bulk-cancel) and the real lib/orders.js: unpaid orders,
// payment-rejected ones and free waiting-list entries are cancelled; a priority
// entry, a rental and an unpaid Quick Add are skipped; the redirect carries the
// counts for the toast. Boots a throwaway instance (temp DATA_DIR, blank
// MONGODB_URI, in-memory sessions, a made-up admin password) with an in-memory
// orders collection; the project's games.json, the database and the real admin
// are never touched.
// See docs/superpowers/specs/2026-10-24-orders-bulk-cancel-and-cleanup-design.md.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4644;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-bulk-cancel-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [Object.assign({ id: 1, title: 'Zzyzx Bulk', platform: 'PS5', genre: 'Action', cover_image: '', renters: 3, non_trophy_slots: 0, trophy_slots: 0 }, price)]
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
// URLSearchParams repeats a key for an array, as a browser form does.
const encode = o => {
  const p = new URLSearchParams();
  Object.keys(o).forEach(k => [].concat(o[k]).forEach(v => p.append(k, v)));
  return p.toString();
};
const post = (p, o, headers) => call('POST', p, { headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}), body: encode(o) });

// A minimal in-memory Mongo: the orders collection honours equality, $in and
// $exists filters, sort/limit cursors and $set/$push updates, which is all
// lib/orders.js asks of it. Every other collection is empty.
function matches(doc, filter) {
  return Object.keys(filter || {}).every(k => {
    const want = filter[k];
    if (want && typeof want === 'object' && !Array.isArray(want)) {
      if ('$in' in want) return want.$in.includes(doc[k]);
      if ('$exists' in want) return (doc[k] !== undefined) === want.$exists;
      return false;
    }
    return doc[k] === want;
  });
}
function cursor(rows) {
  const c = {
    sort(spec) {
      const [k, dir] = Object.entries(spec)[0];
      rows = rows.slice().sort((a, b) => String(a[k] || '').localeCompare(String(b[k] || '')) * dir);
      return c;
    },
    limit(n) { rows = rows.slice(0, n); return c; },
    async toArray() { return rows.map(r => JSON.parse(JSON.stringify(r))); },
    async next() { return rows[0] ? JSON.parse(JSON.stringify(rows[0])) : null; }
  };
  return c;
}
const docs = [];
const ordersCol = {
  async findOne(f) { const d = docs.find(x => matches(x, f)); return d ? JSON.parse(JSON.stringify(d)) : null; },
  find(f) { return cursor(docs.filter(x => matches(x, f))); },
  async insertOne(d) { docs.push(JSON.parse(JSON.stringify(d))); },
  async updateOne(f, u) {
    const d = docs.find(x => matches(x, f));
    if (!d) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(d, u.$set || {});
    Object.keys(u.$push || {}).forEach(k => { d[k] = (d[k] || []).concat([u.$push[k]]); });
    return { matchedCount: 1, modifiedCount: 1 };
  },
  async updateMany() { return { matchedCount: 0, modifiedCount: 0 }; },
  async findOneAndUpdate() { return null; },
  async countDocuments(f) { return docs.filter(x => matches(x, f)).length; }
};
const emptyCol = {
  async findOne() { return null; }, find() { return cursor([]); }, async insertOne() {},
  async updateOne() { return { matchedCount: 0, modifiedCount: 0 }; }, async updateMany() { return { matchedCount: 0, modifiedCount: 0 }; },
  async findOneAndUpdate() { return null; }, async countDocuments() { return 0; }
};

const entry = (ref, state, extra) => Object.assign({
  ref, state, game_id: 1, game_title: 'Zzyzx Bulk', account_type: 'tr', days: 30, fb_name: 'Zzyzx ' + ref.slice(3),
  url_key: 'k' + ref.slice(3), created_at: '2026-09-01T01:00:00.000Z', amount_due: 899, deposit_due: 0,
  state_history: [{ state, at: '2026-09-01T01:00:00.000Z' }]
}, extra || {});
docs.push(
  entry('PH-0601', 'awaiting_payment'),
  entry('PH-0602', 'payment_rejected'),
  entry('PH-0603', 'waitlisted', { amount_due: 0, is_waitlist: true }),
  entry('PH-0604', 'reserved', { amount_due: 100, is_reservation: true }),
  entry('PH-0605', 'active'),
  entry('PH-0606', 'awaiting_payment', { settle_state: 'active' }),
  entry('PH-0607', 'awaiting_payment')
);
const byRef = ref => docs.find(d => d.ref === ref);

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
  const orders = require('../lib/orders');
  orders.init(() => ({ collection: name => (name === 'orders' ? ordersCol : emptyCol) }));
  orders.expireStaleQrs = async () => {};
  orders.advanceEndedRentals = async () => {};

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  await okAsync('signed out, nothing is cancelled', async () => {
    assert.strictEqual((await post('/admin/orders/bulk-cancel', { refs: ['PH-0601'] })).status, 401);
    const form = await post('/admin/orders/bulk-cancel', { refs: ['PH-0601'] }, { Accept: 'text/html' });
    assert.strictEqual(form.status, 302);
    assert.ok(!/msg=orders_bulk/.test(form.headers.location || ''), form.headers.location);
    assert.strictEqual(byRef('PH-0601').state, 'awaiting_payment');
  });

  const login = await post('/admin/login', { password: TEST_PASSWORD });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const admin = o => post('/admin/orders/bulk-cancel', o, { Cookie: cookie });

  await okAsync('unpaid, rejected and free entries are cancelled; priority, a rental and an unpaid Quick Add are skipped', async () => {
    const r = await admin({ refs: ['PH-0601', 'PH-0602', 'PH-0603', 'PH-0604', 'PH-0605', 'PH-0606', 'junk', '<b>'] });
    assert.strictEqual(r.headers.location, '/admin?tab=orders&msg=orders_bulk_cancelled&n=3&skipped=3');
    ['PH-0601', 'PH-0602', 'PH-0603'].forEach(ref => {
      const o = byRef(ref);
      assert.deepStrictEqual([o.state, o.cancel_reason, o.state_history[o.state_history.length - 1].state], ['cancelled', 'owner_bulk', 'cancelled'], ref);
    });
    assert.deepStrictEqual(['PH-0604', 'PH-0605', 'PH-0606'].map(ref => byRef(ref).state), ['reserved', 'active', 'awaiting_payment']);
  });

  await okAsync('one ticked box works too; an already-cancelled one is skipped', async () => {
    assert.strictEqual((await admin({ refs: 'PH-0607' })).headers.location, '/admin?tab=orders&msg=orders_bulk_cancelled&n=1&skipped=0');
    assert.strictEqual(byRef('PH-0607').state, 'cancelled');
    assert.strictEqual((await admin({ refs: 'PH-0607' })).headers.location, '/admin?tab=orders&msg=orders_bulk_cancelled&n=0&skipped=1');
  });

  await okAsync('nothing ticked says so', async () => {
    assert.strictEqual((await admin({})).headers.location, '/admin?tab=orders&msg=orders_bulk_none');
    assert.strictEqual((await admin({ refs: 'nope' })).headers.location, '/admin?tab=orders&msg=orders_bulk_none');
  });

  await okAsync('the admin toasts for both outcomes', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
    assert.ok(src.includes("messages.orders_bulk_cancelled = '🚫 Cancelled ' + psnPlural(bulkN, 'order') + '.' + (bulkSkipped ? ' ' + bulkSkipped + ' skipped — they changed meanwhile.' : '');"));
    assert.ok(src.includes("messages.orders_bulk_none = 'Nothing was selected.';"));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
