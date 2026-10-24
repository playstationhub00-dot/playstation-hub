// Run: node scripts/test-orders-by-game.js
//
// Admin → Orders → Needs you → By game, through the real /admin route: the
// Waitlist and the Follow-ups grouped per game + account type, a card's
// "🟢 N slots free" read from the same counts the game page shows (and PS
// Plus's own slot counts), cards with a free slot first and open, Coming Soon
// cards without a slot check. Boots a throwaway instance (temp DATA_DIR, blank
// MONGODB_URI, in-memory sessions, a made-up admin password) with an
// in-memory orders collection; the project's games.json, the database and the
// real admin are never touched.
// See docs/superpowers/specs/2026-10-24-orders-by-game-board-design.md.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4642;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-by-game-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const game = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', genre: 'Action', cover_image: '', renters: 3 }, price, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [
    game(1, 'Zzyzx Free', { non_trophy_slots: 0, trophy_slots: 1 }),
    game(2, 'Zzyzx Full', { non_trophy_slots: 0, trophy_slots: 0 })
  ],
  upcoming: [Object.assign({ id: 7, title: 'Zzyzx Soon', platform: 'PS5', release_date: '2099-01-01', non_trophy_slots: 2, trophy_slots: 2 }, price)],
  psplus_slots: { nt_slots: 2, tr_slots: 0, ps4_slots: 0 }
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

const entry = (ref, state, game_id, game_title, account_type, created_at, extra) => Object.assign({
  ref, state, game_id, game_title, account_type, created_at, fb_name: 'Zzyzx ' + ref.slice(3), url_key: 'k' + ref.slice(3),
  days: 30, amount_due: state === 'waitlisted' ? 0 : 899, deposit_due: 0, is_waitlist: state === 'waitlisted',
  state_history: [{ state, at: created_at }]
}, extra || {});
docs.push(
  entry('PH-0501', 'waitlisted', 1, 'Zzyzx Free', 'tr', '2026-10-20T01:00:00.000Z'),
  entry('PH-0502', 'waitlisted', 2, 'Zzyzx Full', 'tr', '2026-10-18T01:00:00.000Z'),
  entry('PH-0503', 'awaiting_payment', 2, 'Zzyzx Full', 'tr', '2026-10-23T01:00:00.000Z'),
  entry('PH-0504', 'waitlisted', 'psplus', 'PS Plus Deluxe', 'nt', '2026-10-19T01:00:00.000Z', { is_psplus: true }),
  entry('PH-0505', 'awaiting_payment', 'upcoming_7', 'Zzyzx Soon', 'tr', '2026-10-22T01:00:00.000Z', { is_reservation: true }),
  entry('PH-0506', 'waitlisted', 'psplus', 'PS Plus Deluxe', 'tr', '2026-10-19T02:00:00.000Z', { is_psplus: true })
);

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

  const login = await post('/admin/login', { password: TEST_PASSWORD });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const page = (await call('GET', '/admin?tab=orders', { headers: { Cookie: cookie } })).body;
  const start = page.indexOf('data-oq-group="bygame"');
  assert.ok(start > 0, 'the By game board is on the Orders tab');
  const board = page.slice(start, page.indexOf('oq-ledger-h', start));
  const card = key => {
    const i = board.indexOf('data-oq-card="' + key + '"');
    if (i < 0) return '';
    const next = board.indexOf('data-oq-card="', i + 10);
    return board.slice(i, next > 0 ? next : undefined);
  };

  await okAsync('the old Follow-ups and Waitlist groups are replaced by the board', async () => {
    assert.ok(!page.includes('data-oq-group="followups"') && !page.includes('data-oq-group="waitlist"'));
  });

  await okAsync('cards with a free slot first (PS Plus Non-Trophy, Zzyzx Free Trophy), then most people', async () => {
    assert.deepStrictEqual([...board.matchAll(/data-oq-card="([^"]+)"/g)].map(m => m[1]),
      ['psplus|nt', '1|tr', '2|tr', 'psplus|tr', 'upcoming_7|tr']);
  });

  await okAsync('free-slot cards are tagged with the game page\'s and PS Plus\'s counts and start open', async () => {
    assert.ok(card('1|tr').startsWith('data-oq-card="1|tr" open>'));
    assert.ok(card('1|tr').includes('<span class="oq-card-free-tag">🟢 1 slot free</span>'));
    assert.ok(card('psplus|nt').includes('<span class="oq-card-free-tag">🟢 2 slots free</span>'));
  });

  await okAsync('a full game, a full PS Plus type and a Coming Soon game get no tag and start folded', async () => {
    for (const key of ['2|tr', 'psplus|tr', 'upcoming_7|tr']) {
      assert.ok(card(key).startsWith('data-oq-card="' + key + '">'), key + ' folded');
      assert.ok(!card(key).includes('oq-card-free-tag'), key + ' no tag');
    }
    assert.ok(card('2|tr').includes('<span class="oq-card-n">1 waiting · 1 didn&#39;t pay</span>'));
    assert.ok(card('upcoming_7|tr').includes('<span class="oq-card-n">1 didn&#39;t pay · Coming Soon</span>'));
  });

  await okAsync('every person is in their card with their own buttons', async () => {
    assert.ok(card('2|tr').includes('action="/admin/orders/PH-0502/slot-given"'));
    assert.ok(card('2|tr').includes('action="/admin/orders/PH-0503/mark-paid"'));
    assert.ok(card('psplus|nt').includes('action="/admin/orders/PH-0504/slot-given"'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
