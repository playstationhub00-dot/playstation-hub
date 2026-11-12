// Run: node scripts/test-coming-soon-slot-count.js
//
// The Coming soon page and POST /order/reserve count free Trophy and
// Non-Trophy slots. That count has to match what Admin → Games & accounts →
// Coming soon shows as taken: account slots linked with upcoming_ids that are
// rented or bought, and Bought, Renting and Reservation customers stored as
// upcoming_<id>. A released game can use the same number, and its accounts
// (game_ids) must not be read as this game's slots.
//
// Throwaway only: a temp DATA_DIR, no Mongo, an in-memory session store, and
// made-up names. No real customer data.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4782;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coming-soon-slots-'));
const price = { nt_price_7d: 449, nt_price_30d: 899, tr_price_7d: 549, tr_price_30d: 1099 };

function slot(status, renterId, renterName) {
  return {
    enabled: true,
    status,
    renter_id: renterId == null ? null : renterId,
    renter_name: renterName || '',
    start: status === 'rented' ? '2026-11-01' : '',
    end: status === 'rented' ? '2026-12-01' : ''
  };
}
const open = slot('open', null, '');
const off = { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };

function account(id, label, upcomingIds, trophy, nonTrophy, gameIds) {
  return {
    id, label, games_text: '', email: '',
    game_ids: gameIds || [],
    upcoming_ids: upcomingIds,
    slots: { trophy, non_trophy: nonTrophy, ps4_primary: Object.assign({}, off) }
  };
}

function customer(id, name, gameId, type, status) {
  return {
    id, customer_name: name, game_id: gameId,
    game_title: String(gameId).indexOf('upcoming_') === 0 ? 'Zzyzx Auto VI' : 'Zzyzx Released',
    days: status === 'reservation' ? 0 : 30,
    account_type: type, start_date: '', end_date: '', price: 899, status,
    notes: 'sample', created_at: '2026-11-01T00:00:00.000Z', payments: []
  };
}

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100, buy_promo_enabled: false, buy_promo_pct: 0 } },
  // Released game 1 shares the Coming soon id. Its one open Trophy slot is the
  // trap: a count that reads game_ids reports that slot as free on the
  // Coming soon page.
  games: [Object.assign({ id: 1, title: 'Zzyzx Released', platform: 'PS5', genre: 'Action', trophy_slots: 3, non_trophy_slots: 3, available_slots: 6 }, price)],
  upcoming: [
    Object.assign({
      id: 1, title: 'Zzyzx Auto VI', platform: 'PS5', genre: 'Action', release_date: '2026-11-19',
      description: 'Sample coming soon game.',
      // Owner configured 4 Trophy. Three Reservation customers are the only
      // rows the old count subtracts, so it still says 1 Trophy slot is free
      // while every linked Trophy slot is taken.
      trophy_slots: 4, non_trophy_slots: 5,
      buy_nt_price: 2499, buy_tr_price: 3499
    }, price),
    // No customers. Both linked Trophy slots are marked rented. The configured
    // 2 must not stay on sale.
    Object.assign({ id: 2, title: 'Zzyzx Slot Only', platform: 'PS5', release_date: '2026-12-01', trophy_slots: 2, non_trophy_slots: 1 }, price),
    // Both linked Trophy slots are still open. A Bought customer who is not
    // sitting on either one still holds one.
    Object.assign({ id: 3, title: 'Zzyzx Held Open', platform: 'PS5', release_date: '2026-12-01', trophy_slots: 2, non_trophy_slots: 1 }, price)
  ],
  accounts: [
    account(90, 'Zzyzx Catalogue Box', [], open, slot('rented', null, ''), [1]),
    account(1, 'Zzyzx Auto 1', [1], slot('rented', 1, 'Zzyzx Res One'), open),
    account(2, 'Zzyzx Auto 2', [1], slot('rented', 2, 'Zzyzx Res Two'), open),
    account(3, 'Zzyzx Auto 3', [1], slot('rented', 3, 'Zzyzx Res Three'), slot('rented', 6, 'Zzyzx Nt One')),
    account(4, 'Zzyzx Auto 4', [1], slot('rented', 4, 'Zzyzx Renter'), slot('rented', 7, 'Zzyzx Nt Two')),
    account(5, 'Zzyzx Auto 5', [1], slot('buyed', 5, 'Zzyzx Buyer'), slot('rented', null, 'Zzyzx Nt Three')),
    account(6, 'Zzyzx Slot A', [2], slot('rented', null, ''), open),
    account(7, 'Zzyzx Slot B', [2], slot('buyed', null, ''), open),
    account(8, 'Zzyzx Open A', [3], open, open),
    account(9, 'Zzyzx Open B', [3], open, open)
  ],
  customers: [
    customer(1, 'Zzyzx Res One', 'upcoming_1', 'tr', 'reservation'),
    customer(2, 'Zzyzx Res Two', 'upcoming_1', 'tr', 'reservation'),
    customer(3, 'Zzyzx Res Three', 'upcoming_1', 'tr', 'reservation'),
    customer(4, 'Zzyzx Renter', 'upcoming_1', 'tr', 'renting'),
    customer(5, 'Zzyzx Buyer', 'upcoming_1', 'tr', 'bought'),
    customer(6, 'Zzyzx Nt One', 'upcoming_1', 'nt', 'reservation'),
    customer(7, 'Zzyzx Nt Two', 'upcoming_1', 'nt', 'reservation'),
    customer(8, 'Zzyzx Nt Three', 'upcoming_1', 'nt', 'reservation'),
    // Same number as the Coming soon game, stored as the released game.
    customer(90, 'Zzyzx Catalogue', 1, 'tr', 'renting'),
    customer(10, 'Zzyzx Unassigned', 'upcoming_3', 'tr', 'bought')
  ],
  nextId: 4,
  nextUpcomingId: 4,
  nextCustomerId: 91,
  nextAccountId: 10
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'coming-soon-slot-count-test';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(method, p, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test' }, headers || {}),
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
const get = p => call('GET', p);
const post = fields => call('POST', '/order/reserve', { 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams(fields).toString());

function typeCard(html, id) {
  const m = html.match(new RegExp('id="' + id + '"[\\s\\S]*?<\\/label>'));
  assert.ok(m, 'missing card ' + id);
  return m[0];
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
  const orders = require('../lib/orders');
  const placed = [];
  orders.createOrReuse = async (fields) => {
    placed.push(fields);
    const n = placed.length;
    return { order: { ref: 'ZTEST' + n, url_key: 'samplekey' }, reused: false };
  };

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const soon = await get('/upcoming/zzyzx-auto-vi-1');
  assert.strictEqual(soon.status, 200, soon.body.slice(0, 200));
  const page = soon.body;

  console.log('\ncoming soon page');
  await okAsync('every Trophy slot taken shows Full Slot, and Non-Trophy shows the two still open', async () => {
    const tr = typeCard(page, 'typeCard-tr');
    const nt = typeCard(page, 'typeCard-nt');
    assert.ok(tr.includes('>Full Slot<'), tr);
    assert.ok(!/slot left/.test(tr), tr);
    assert.ok(nt.includes('>2 slots left<'), nt);
    assert.ok(page.includes('const TR_SLOTS   = 0;'));
    assert.ok(page.includes('const NT_SLOTS   = 2;'));
    assert.ok(!page.includes('const TR_SLOTS   = 1;'), 'the overlapping released game\'s open Trophy slot was counted');
  });

  await okAsync('the released game that shares the id still shows its own open Trophy slot', async () => {
    const released = await get('/game/zzyzx-released');
    assert.strictEqual(released.status, 200, released.body.slice(0, 200));
    const tr = typeCard(released.body, 'label-tr');
    assert.ok(tr.includes('1 slot left'), tr);
    assert.ok(tr.includes('Available'), tr);
  });

  await okAsync('a rented or bought account row with no customer is not left on sale', async () => {
    const only = await get('/upcoming/zzyzx-slot-only-2');
    assert.strictEqual(only.status, 200, only.body.slice(0, 200));
    const tr = typeCard(only.body, 'typeCard-tr');
    assert.ok(tr.includes('>Full Slot<'), tr);
    assert.ok(!/slot left/.test(tr), tr);
  });

  await okAsync('a Bought customer who is not on an account row still holds a Trophy slot', async () => {
    const held = await get('/upcoming/zzyzx-held-open-3');
    assert.strictEqual(held.status, 200, held.body.slice(0, 200));
    const tr = typeCard(held.body, 'typeCard-tr');
    assert.ok(tr.includes('>1 slot left<'), tr);
    assert.ok(!tr.includes('2 slots left'), tr);
  });

  console.log('\nreserve');
  await okAsync('POST /order/reserve refuses a Trophy reservation when none are free', async () => {
    const before = placed.length;
    const res = await post({ game_id: '1', account_type: 'tr', days: '30', fb_name: 'Zzyzx Tester' });
    assert.strictEqual(res.status, 302, res.headers.location || res.body.slice(0, 200));
    assert.strictEqual(res.headers.location, '/upcoming/zzyzx-auto-vi-1?order_error=full');
    assert.strictEqual(placed.length, before, 'a full Trophy type still created an order');
    assert.ok((await get('/upcoming/zzyzx-auto-vi-1?order_error=full')).body.includes('no slots left'));
  });

  await okAsync('Non-Trophy, which still has slots, can be reserved', async () => {
    const res = await post({ game_id: '1', account_type: 'nt', days: '30', fb_name: 'Zzyzx Tester' });
    assert.strictEqual(res.status, 302, res.headers.location || '');
    assert.strictEqual(res.headers.location, '/order/ZTEST1?k=samplekey&msg=placed');
    assert.strictEqual(placed[0].account_type, 'nt');
    assert.strictEqual(placed[0].game_title, 'Zzyzx Auto VI');
    assert.strictEqual(placed[0].is_buy, false);
  });

  await okAsync('a permanent pre-order of a full Trophy type is still accepted', async () => {
    const res = await post({ kind: 'buy', game_id: '1', account_type: 'tr', fb_name: 'Zzyzx Preorder' });
    assert.strictEqual(res.status, 302, res.headers.location || '');
    assert.ok(res.headers.location.startsWith('/order/ZTEST2'), res.headers.location);
    assert.strictEqual(placed[1].is_buy, true);
    assert.strictEqual(placed[1].new_slot, true);
    assert.strictEqual(placed[1].account_type, 'tr');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
