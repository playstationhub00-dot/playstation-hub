// Run: node scripts/test-slot-history-routes.js
//
// Renter history for an account slot, through the real server: changes made
// in the slot popup (POST /admin/accounts/:id/slot/:type) are recorded, GET
// /admin/accounts/:id/slot/:type/history returns them newest first with the
// current renter and the day the log began, and deleting an account deletes
// its lines. The history request is admin-only.
//
// Throwaway only: a temp DATA_DIR, a blank MONGODB_URI, an in-memory session
// store, a made-up admin password and made-up names.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const sh = require('../lib/slot-history');

const PORT = 4666;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-history-routes-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const off = { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
const open = { enabled: true, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  games: [{ id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 }],
  customers: [
    { id: 7, customer_name: 'Zzyzx Juan', game_id: 4, game_title: 'PS Plus Deluxe', account_type: 'tr', status: 'renting', days: 30, start_date: '2026-10-01', end_date: '2026-10-31', price: 799 },
    { id: 8, customer_name: 'Zzyzx Pedro', game_id: 4, game_title: 'PS Plus Deluxe', account_type: 'tr', status: 'renting', days: 30, start_date: '2026-10-01', end_date: '2026-10-31', price: 799 }
  ],
  accounts: [
    { id: 3, label: 'Zzyzx PS Plus 3', game_ids: [4], slots: { trophy: open, non_trophy: off, ps4_primary: off } },
    { id: 9, label: 'Zzyzx Other', game_ids: [4], slots: { trophy: open, non_trophy: off, ps4_primary: off } }
  ],
  nextAccountId: 10
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'slot-history-routes-test';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

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
const today = sh.manilaDate(new Date().toISOString());
// The slot popup stores a renter's start as the server's (UTC) date.
const startDay = new Date().toISOString().slice(0, 10);

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
  async function setSlot(accountId, type, fields) {
    const r = await call('POST', '/admin/accounts/' + accountId + '/slot/' + type, { headers: auth(FORM), body: form(fields) });
    assert.strictEqual(r.status, 302);
    assert.ok(/msg=slot_updated/.test(r.headers.location), r.headers.location);
  }
  async function history(accountId, type) {
    const r = await call('GET', '/admin/accounts/' + accountId + '/slot/' + type + '/history', { headers: auth({ Accept: 'application/json' }) });
    assert.strictEqual(r.status, 200, r.body);
    return JSON.parse(r.body);
  }

  try {
    console.log('\nthe history request');
    await ok('an untouched slot: no lines, no Now line, and the day the log began', async () => {
      const h = await history(3, 'trophy');
      assert.deepStrictEqual(h.lines, []);
      assert.strictEqual(h.now, null);
      assert.strictEqual(h.total, 0);
      assert.strictEqual(h.started, sh.longDate(today));
      assert.ok(ledger().slot_history_started_at, 'the start date is stored');
    });
    await ok('refuses anyone not logged in as admin', async () => {
      const r = await call('GET', '/admin/accounts/3/slot/trophy/history', { headers: { Accept: 'application/json' } });
      assert.strictEqual(r.status, 401);
      assert.ok(!r.body.includes('"lines"'));
    });
    await ok('an unknown account or slot type is a 404', async () => {
      assert.strictEqual((await call('GET', '/admin/accounts/3/slot/bogus/history', { headers: auth({ Accept: 'application/json' }) })).status, 404);
      assert.strictEqual((await call('GET', '/admin/accounts/99/slot/trophy/history', { headers: auth({ Accept: 'application/json' }) })).status, 404);
    });

    console.log('\nchanges made in the slot popup');
    await ok('renting the slot to a customer: a "started" line and the Now line', async () => {
      await setSlot(3, 'trophy', { status: 'rented', renter_id: '7', days: '30' });
      const h = await history(3, 'trophy');
      assert.deepStrictEqual(h.lines.map(l => l.title), ['Zzyzx Juan started']);
      assert.ok(h.lines[0].detail.startsWith('PS Plus Deluxe · ends '), h.lines[0].detail);
      assert.strictEqual(h.now.title, 'Zzyzx Juan');
      assert.ok(h.now.detail.startsWith('PS Plus Deluxe · since ' + sh.shortDate(startDay) + ' · ends '), h.now.detail);
    });
    await ok('changing only the days writes nothing new', async () => {
      await setSlot(3, 'trophy', { status: 'rented', renter_id: '7', days: '45' });
      assert.strictEqual((await history(3, 'trophy')).total, 1);
    });
    await ok('setting it to Maintenance: the renter was cleared by hand, then the new status', async () => {
      await setSlot(3, 'trophy', { status: 'maintenance' });
      const h = await history(3, 'trophy');
      assert.deepStrictEqual(h.lines.map(l => l.title), ['Set to Maintenance', 'Zzyzx Juan left', 'Zzyzx Juan started']);
      assert.ok(h.lines[1].detail.startsWith('cleared by hand · rented ' + sh.shortDate(startDay) + ' → '), h.lines[1].detail);
      assert.strictEqual(h.now, null);
    });
    await ok('Open again, then a different renter takes over from Juan', async () => {
      await setSlot(3, 'trophy', { status: 'open' });
      await setSlot(3, 'trophy', { status: 'rented', renter_id: '7', days: '30' });
      await setSlot(3, 'trophy', { status: 'rented', renter_id: '8', days: '30' });
      const h = await history(3, 'trophy');
      assert.deepStrictEqual(h.lines.slice(0, 4).map(l => l.title), ['Zzyzx Pedro started', 'Zzyzx Juan left', 'Zzyzx Juan started', 'Set to Open']);
      assert.strictEqual(h.now.title, 'Zzyzx Pedro');
    });
    await ok('a new renter gets their own start date, not the one before them', async () => {
      const slot = ledger().accounts.find(a => a.id === 3).slots.trophy;
      assert.strictEqual(slot.renter_id, 8);
      assert.strictEqual(slot.start, startDay);
    });
    await ok('each line is stored with its account, slot and time; another account\'s slot is untouched', async () => {
      const rows = ledger().slot_history;
      assert.ok(rows.length >= 7);
      rows.forEach(e => {
        assert.strictEqual(e.account_id, 3);
        assert.strictEqual(e.slot, 'trophy');
        assert.ok(e.id && e.at && e.kind);
      });
      assert.strictEqual((await history(9, 'trophy')).total, 0);
    });

    console.log('\ndeleting an account');
    await ok('takes its history lines with it', async () => {
      await setSlot(9, 'trophy', { status: 'maintenance' });
      assert.strictEqual((await history(9, 'trophy')).total, 1);
      const r = await call('POST', '/admin/accounts/delete/3', { headers: auth(FORM), body: '' });
      assert.strictEqual(r.status, 302);
      const rows = ledger().slot_history;
      assert.ok(!rows.some(e => e.account_id === 3), 'account 3\'s lines are gone');
      assert.strictEqual(rows.filter(e => e.account_id === 9).length, 1, 'account 9 keeps its own');
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
