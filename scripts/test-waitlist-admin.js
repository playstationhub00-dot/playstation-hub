// Run: node scripts/test-waitlist-admin.js
//
// The owner's two new Waitlist actions, end to end through the real routes and
// the real lib/orders.js: "Slot given" (POST /admin/orders/:ref/slot-given)
// takes a free or priority entry out of the public line, stops a priority ₱100
// counting as paid and tells the customer on their order page; "Edit name"
// (POST /admin/orders/:ref/rename) changes only the name. Both refuse Coming
// Soon reservations, buy pre-orders and anything not in line. Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a
// made-up admin password) with an in-memory orders collection; the project's
// games.json, the database and the real admin are never touched.
// See docs/superpowers/specs/2026-10-24-waitlist-slot-given-and-rename-design.md.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4640;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlist-admin-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [Object.assign({ id: 1, title: 'Zzyzx Line', platform: 'PS5', genre: 'Action', cover_image: '', renters: 4, non_trophy_slots: 0, trophy_slots: 0 }, price)],
  upcoming: [Object.assign({ id: 7, title: 'Zzyzx Soon', platform: 'PS5', release_date: '2099-01-01', non_trophy_slots: 2, trophy_slots: 2, buy_tr_price: 1999 }, price)]
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

const entry = (ref, state, fb_name, created_at, extra) => Object.assign({
  ref, state, fb_name, created_at, url_key: 'k' + ref.slice(3), game_id: 1, game_title: 'Zzyzx Line',
  account_type: 'tr', days: 30, amount_due: 0, deposit_due: 0, is_waitlist: state === 'waitlisted',
  state_history: [{ state, at: created_at }]
}, extra || {});
docs.push(
  entry('PH-0401', 'reserved', 'Marvin Reyes', '2026-10-22T01:00:00.000Z', { is_waitlist: false, is_reservation: true, amount_due: 100, remaining_due: 799, paid_at: '2026-10-22T02:00:00.000Z' }),
  entry('PH-0402', 'waitlisted', 'Mark Lim', '2026-10-18T01:00:00.000Z'),
  entry('PH-0403', 'waitlisted', 'Gemry Tan', '2026-10-20T01:00:00.000Z'),
  entry('PH-0404', 'waitlisted', 'Adrian Bautista', '2026-10-20T02:00:00.000Z'),
  entry('PH-0405', 'waitlisted', 'Adrian Bautista', '2026-10-20T03:00:00.000Z'),
  entry('PH-0406', 'reserved', 'Cy Soon', '2026-10-01T01:00:00.000Z', { game_id: 'upcoming_7', game_title: 'Zzyzx Soon', upcoming_game_id: 7, is_reservation: true, amount_due: 899 }),
  entry('PH-0407', 'reserved', 'Dee Own', '2026-10-01T02:00:00.000Z', { game_id: 'upcoming_7', game_title: 'Zzyzx Soon', upcoming_game_id: 7, is_reservation: true, is_buy: true, days: null, amount_due: 1999 }),
  entry('PH-0408', 'active', 'Eve Renter', '2026-10-02T01:00:00.000Z', { amount_due: 799 })
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

  // The Trophy line exactly as the game page hands it to the browser.
  async function trophyLine() {
    const page = (await call('GET', '/game/zzyzx-line')).body;
    const m = /var DATA = (.*);\r?\n/.exec(page);
    assert.ok(m, 'the game page carries the line');
    return JSON.parse(m[1]).tr.map(r => r.position + ' ' + r.name + (r.tier === 'priority' ? ' *' : ''));
  }

  await okAsync('before: Marvin is #1 on priority, then the free entries by join date', async () => {
    assert.deepStrictEqual(await trophyLine(), ['1 Marvin R. *', '2 Mark L.', '3 Gemry T.', '4 Adrian B.', '5 Adrian B.']);
  });

  const login = await post('/admin/login', { password: TEST_PASSWORD });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const admin = (p, o) => post(p, o || {}, { Cookie: cookie });

  await okAsync('signed out, Slot given does nothing', async () => {
    const r = await post('/admin/orders/PH-0401/slot-given', {});
    assert.strictEqual(r.status, 401);
    const form = await post('/admin/orders/PH-0401/slot-given', {}, { Accept: 'text/html' });
    assert.strictEqual(form.status, 302);
    assert.ok(!/msg=order_slot_given/.test(form.headers.location || ''), form.headers.location);
    assert.strictEqual(byRef('PH-0401').state, 'reserved');
  });

  await okAsync('signed out, Edit name does nothing', async () => {
    const r = await post('/admin/orders/PH-0402/rename', { fb_name: 'Hacker' }, { Accept: 'text/html' });
    assert.strictEqual(r.status, 302);
    assert.ok(/login/.test(r.headers.location || ''), r.headers.location);
    assert.notStrictEqual(byRef('PH-0402').fb_name, 'Hacker');
  });

  await okAsync('Slot given on the priority entry: out of the line, everyone moves up, the ₱100 stops counting', async () => {
    const r = await admin('/admin/orders/PH-0401/slot-given');
    assert.strictEqual(r.headers.location, '/admin?tab=orders&msg=order_slot_given');
    const o = byRef('PH-0401');
    assert.strictEqual(o.state, 'cancelled');
    assert.ok(!isNaN(Date.parse(o.slot_given_at)), 'slot_given_at is a timestamp');
    assert.strictEqual(orders.isPaid(o.state), false, 'no longer counted as paid');
    assert.deepStrictEqual(o.state_history.map(h => h.state), ['reserved', 'cancelled']);
    assert.deepStrictEqual(await trophyLine(), ['1 Mark L.', '2 Gemry T.', '3 Adrian B.', '4 Adrian B.']);
  });

  await okAsync('Slot given on a free entry works the same way', async () => {
    assert.strictEqual((await admin('/admin/orders/PH-0402/slot-given')).headers.location, '/admin?tab=orders&msg=order_slot_given');
    assert.strictEqual(byRef('PH-0402').state, 'cancelled');
    assert.deepStrictEqual(await trophyLine(), ['1 Gemry T.', '2 Adrian B.', '3 Adrian B.']);
  });

  await okAsync('refused for a Coming Soon reservation, a buy pre-order, a rental and an entry already closed', async () => {
    for (const ref of ['PH-0406', 'PH-0407', 'PH-0408', 'PH-0401']) {
      const before = JSON.stringify(byRef(ref));
      const r = await admin('/admin/orders/' + ref + '/slot-given');
      assert.strictEqual(r.headers.location, '/admin?tab=orders&msg=order_bad_state', ref);
      assert.strictEqual(JSON.stringify(byRef(ref)), before, ref + ' unchanged');
    }
  });

  await okAsync('Edit name: cleaned, saved, shown masked, place in line kept', async () => {
    const r = await admin('/admin/orders/PH-0405/rename', { fb_name: '  Adrian   Bernardo Jr ' });
    assert.strictEqual(r.headers.location, '/admin?tab=orders&msg=order_renamed');
    const o = byRef('PH-0405');
    assert.deepStrictEqual([o.fb_name, o.state, o.created_at], ['Adrian Bernardo Jr', 'waitlisted', '2026-10-20T03:00:00.000Z']);
    assert.deepStrictEqual(await trophyLine(), ['1 Gemry T.', '2 Adrian B.', '3 Adrian J.']);
  });

  await okAsync('Edit name refuses an empty or too-long name, and orders not in line', async () => {
    for (const bad of ['   ', 'x'.repeat(81)]) {
      assert.strictEqual((await admin('/admin/orders/PH-0404/rename', { fb_name: bad })).headers.location, '/admin?tab=orders&msg=order_name_bad');
    }
    assert.strictEqual(byRef('PH-0404').fb_name, 'Adrian Bautista');
    for (const ref of ['PH-0406', 'PH-0407', 'PH-0408', 'PH-0401']) {
      assert.strictEqual((await admin('/admin/orders/' + ref + '/rename', { fb_name: 'Someone Else' })).headers.location, '/admin?tab=orders&msg=order_bad_state', ref);
      assert.notStrictEqual(byRef(ref).fb_name, 'Someone Else', ref);
    }
  });

  await okAsync('the customer\'s order page says the slot was given; a plain Remove still says cancelled', async () => {
    const given = (await call('GET', '/order/PH-0401?k=k0401')).body;
    assert.ok(given.includes('✅ Slot given'), 'title');
    assert.ok(given.includes('You&#39;re all set — this waiting-list entry is closed.'), 'sub');
    assert.ok(!given.includes('Order cancelled'));
    assert.ok(!given.includes('To send now') && !given.includes('remaining, due'), 'asks for no more money');
    await admin('/admin/orders/PH-0403/cancel');
    const removed = (await call('GET', '/order/PH-0403?k=k0403')).body;
    assert.ok(removed.includes('Order cancelled') && !removed.includes('Slot given'));
  });

  await okAsync('the admin toasts for the three new outcomes', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
    assert.ok(src.includes("order_slot_given:'✅ Slot given — off the waiting list.'"));
    assert.ok(src.includes("order_renamed:'✏️ Name updated.'"));
    assert.ok(src.includes("order_name_bad:'❌ Enter a name (up to 80 characters).'"));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
