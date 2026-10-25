// Run: node scripts/test-order-cleanup-wiring.js
//
// The 30-day cleanup as server.js wires it: its own timer runs
// lib/order-cleanup.js against the real lib/orders.js, cancelling stale unpaid
// orders and free waiting-list entries (cancel_reason 'stale', with the days)
// and leaving priority entries, unpaid Quick Adds and fresh ones alone; the
// switch and days in Settings → Payment reminders save beside the reminder
// fields and turn it off; the ledger reads "Cancelled · 30+ days". The test
// catches the server's timers as they are created and runs only the cleanup
// one by hand, so no reminder is ever sent. Boots a throwaway instance (temp
// DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin password)
// with an in-memory orders collection; the project's games.json, the database
// and the real admin are never touched.
// See docs/superpowers/specs/2026-10-24-orders-bulk-cancel-and-cleanup-design.md.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4645;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'order-cleanup-wiring-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [Object.assign({ id: 1, title: 'Zzyzx Old', platform: 'PS5', genre: 'Action', cover_image: '', renters: 3, non_trophy_slots: 0, trophy_slots: 0 }, price)]
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
const post = (p, o, headers) => call('POST', p, { headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}), body: new URLSearchParams(o).toString() });

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

const daysAgo = d => new Date(Date.now() - d * 86400000).toISOString();
const entry = (ref, state, age, extra) => Object.assign({
  ref, state, game_id: 1, game_title: 'Zzyzx Old', account_type: 'tr', days: 30, fb_name: 'Zzyzx ' + ref.slice(3),
  url_key: 'k' + ref.slice(3), created_at: daysAgo(age), amount_due: 899, deposit_due: 0,
  state_history: [{ state, at: daysAgo(age) }]
}, extra || {});
docs.push(
  entry('PH-0701', 'awaiting_payment', 40),
  entry('PH-0702', 'awaiting_payment', 5),
  entry('PH-0703', 'waitlisted', 31, { amount_due: 0, is_waitlist: true }),
  entry('PH-0704', 'reserved', 90, { amount_due: 100, is_reservation: true }),
  entry('PH-0705', 'awaiting_payment', 60, { settle_state: 'active' })
);
const byRef = ref => docs.find(d => d.ref === ref);
const waitFor = async (cond, ms) => {
  const end = Date.now() + (ms || 3000);
  while (Date.now() < end) { if (cond()) return true; await new Promise(r => setTimeout(r, 25)); }
  return cond();
};

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  // Catch every timer the server creates; only the cleanup one is ever run here.
  const realSetInterval = global.setInterval;
  const timers = [];
  global.setInterval = function (fn, ms, ...rest) { timers.push(fn); return realSetInterval.call(this, fn, ms, ...rest); };
  try { require('../server.js'); } finally { global.setInterval = realSetInterval; }
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

  const runCleanup = timers.find(fn => String(fn).includes('orderCleanup.runCleanup'));
  await okAsync('the cleanup has its own timer in server.js', async () => {
    assert.ok(runCleanup, 'a setInterval callback runs orderCleanup.runCleanup');
    assert.ok(!String(runCleanup).includes('paymentReminders.runSweep'), 'separate from the reminder sweep');
  });

  await okAsync('on by default: stale unpaid and free entries are cancelled; priority, Quick Add and fresh ones stay', async () => {
    runCleanup();
    assert.ok(await waitFor(() => byRef('PH-0701').state === 'cancelled' && byRef('PH-0703').state === 'cancelled'), 'stale ones cancelled');
    ['PH-0701', 'PH-0703'].forEach(ref => {
      const o = byRef(ref);
      assert.deepStrictEqual([o.cancel_reason, o.stale_days, o.state_history[o.state_history.length - 1].state], ['stale', 30, 'cancelled'], ref);
    });
    assert.deepStrictEqual(['PH-0702', 'PH-0704', 'PH-0705'].map(ref => byRef(ref).state), ['awaiting_payment', 'reserved', 'awaiting_payment']);
  });

  const login = await post('/admin/login', { password: TEST_PASSWORD });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const page = async () => (await call('GET', '/admin?tab=settings', { headers: { Cookie: cookie } })).body;

  await okAsync('the ledger says how old a cleaned-up order was', async () => {
    const admin = (await call('GET', '/admin?tab=orders', { headers: { Cookie: cookie } })).body;
    const i = admin.indexOf('<td class="oq-lref">PH-0701</td>');
    assert.ok(i > 0, 'PH-0701 in the ledger');
    assert.ok(admin.slice(i, admin.indexOf('</tr>', i)).includes('<span class="oq-st-dot"></span>Cancelled · 30+ days</span>'));
  });

  await okAsync('Settings shows the switch on at 30 days before anything is saved', async () => {
    const html = await page();
    assert.ok(/<input type="checkbox" name="cleanup_enabled" checked>/.test(html));
    assert.ok(html.includes('<input type="number" name="cleanup_days" min="7" max="365" step="1" value="30">'));
  });

  await okAsync('saving the reminder settings keeps the cleanup fields; off means nothing is cancelled', async () => {
    const r = await post('/admin/settings/payment-reminders', { enabled: 'on', hold_hours: '24', cleanup_days: '45' }, { Cookie: cookie });
    assert.strictEqual(r.headers.location, '/admin?tab=settings&msg=reminders_saved');
    const html = await page();
    assert.ok(/<input type="checkbox" name="cleanup_enabled" >/.test(html), 'switched off');
    assert.ok(html.includes('name="cleanup_days" min="7" max="365" step="1" value="45"'));
    docs.push(entry('PH-0706', 'awaiting_payment', 50));
    runCleanup();
    await new Promise(res => setTimeout(res, 300));
    assert.strictEqual(byRef('PH-0706').state, 'awaiting_payment');
    await post('/admin/settings/payment-reminders', { enabled: 'on', hold_hours: '24', cleanup_enabled: 'on', cleanup_days: '3' }, { Cookie: cookie });
    assert.ok((await page()).includes('name="cleanup_days" min="7" max="365" step="1" value="7"'), 'days kept within 7-365');
    runCleanup();
    assert.ok(await waitFor(() => byRef('PH-0706').state === 'cancelled'));
    assert.strictEqual(byRef('PH-0706').stale_days, 7);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
