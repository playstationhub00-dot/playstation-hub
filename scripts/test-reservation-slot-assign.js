// Run: node scripts/test-reservation-slot-assign.js
//
// Edit Customer → "Assign to Account Slot" says it controls the Accounts
// dashboard. A paid reservation (upcoming game, status reservation, Trophy,
// no dates) saved onto one of several shop accounts must take that account's
// Trophy slot off Open. A later save keeps or moves it. A live rental still
// assigns the same way. Cancelling the reservation frees the slot.
//
// Throwaway only: a temp DATA_DIR, no Mongo, an in-memory session store,
// a made-up admin password, and made-up names. No real customer data.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 47393;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reservation-slot-assign-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const off = { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
const open = { enabled: true, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
const price = { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 };
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

function account(id, label) {
  return {
    id, label, games_text: 'Zzyzx Auto VI', game_ids: [], email: '',
    slots: { trophy: Object.assign({}, open), non_trophy: Object.assign({}, open), ps4_primary: Object.assign({}, off) }
  };
}

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  games: [Object.assign({ id: 6, title: 'Zzyzx Racer', platform: 'PS5' }, price)],
  upcoming: [Object.assign({
    id: 15, title: 'Zzyzx Auto VI', platform: 'PS5', release_date: '2026-11-19',
    non_trophy_slots: 5, trophy_slots: 5
  }, price)],
  customers: [
    {
      id: 40, customer_name: 'Zzyzx Reserve', game_id: 'upcoming_15', game_title: 'Zzyzx Auto VI',
      days: 30, account_type: 'tr', start_date: '', end_date: '', price: 999,
      status: 'reservation', notes: 'Reservation — paid in full',
      created_at: '2026-11-01T00:00:00.000Z', payments: []
    },
    {
      id: 42, customer_name: 'Zzyzx Renter', game_id: 6, game_title: 'Zzyzx Racer',
      days: 30, account_type: 'tr', start_date: day(0), end_date: day(30), price: 799,
      status: 'renting', notes: '', created_at: '2026-11-01T00:00:00.000Z', payments: []
    }
  ],
  nextCustomerId: 50,
  accounts: [1, 2, 3, 4, 5].map(id => account(id, 'Zzyzx Auto ' + id)),
  nextAccountId: 6
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'reservation-slot-assign-test';
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
const slotOf = (accountId, type) => ledger().accounts.find(a => a.id === accountId).slots[type || 'trophy'];
const customer = id => ledger().customers.find(c => c.id === id);

// The Accounts grouped view (the list of chips under each PSN login), not the
// Slots rows above it. Those rows use the same data-acc-slot but a different
// pill: a dated rental says "29d left" there, while this chip carries
// data-status.
function chip(html, accountId, type) {
  const re = new RegExp('<button[^>]*class="acc-chip[^"]*"[^>]*data-acc-slot="' + accountId + ':' + type + '"[^>]*>[\\s\\S]*?<\\/button>');
  const m = html.match(re);
  assert.ok(m, 'missing accounts chip ' + accountId + ':' + type);
  return m[0];
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

  async function post(p, fields) {
    const r = await call('POST', p, { headers: auth(FORM), body: form(fields) });
    assert.strictEqual(r.status, 302, r.body.slice(0, 300));
    return r.headers.location || '';
  }
  async function accountsHtml() {
    const r = await call('GET', '/admin?tab=accounts', { headers: auth() });
    assert.strictEqual(r.status, 200, r.body.slice(0, 400));
    return r.body;
  }
  function reservationFields(patch) {
    return Object.assign({
      customer_name: 'Zzyzx Reserve', game_id: 'upcoming_15', days: '30', account_type: 'tr',
      status: 'reservation', start_date: '', end_date: '', price: '999',
      notes: 'Reservation — paid in full', account_assign: ''
    }, patch);
  }

  try {
    console.log('\nA live rental still assigns from Edit Customer');
    await ok('saving a renting customer onto an open Trophy slot marks that slot rented', async () => {
      const loc = await post('/admin/customers/edit/42', {
        customer_name: 'Zzyzx Renter', game_id: '6', days: '30', account_type: 'tr', status: 'renting',
        start_date: day(0), end_date: day(30), price: '799', notes: '', account_assign: '4:trophy'
      });
      assert.ok(/msg=customer_updated/.test(loc), loc);
      const slot = slotOf(4);
      assert.strictEqual(slot.status, 'rented');
      assert.strictEqual(slot.renter_id, 42);
      assert.strictEqual(slot.renter_name, 'Zzyzx Renter');
      const html = await accountsHtml();
      const rented = chip(html, 4, 'trophy');
      assert.ok(rented.includes('data-status="rented"'), rented);
      assert.ok(!rented.includes('OPEN'), rented);
      assert.ok(rented.includes('Zzyzx Renter'), rented);
    });

    console.log('\nA reservation assigned from Edit Customer');
    await ok('the edit form offers the open Trophy slot on the fifth account', async () => {
      const r = await call('GET', '/admin/customers/edit/40', { headers: auth() });
      assert.strictEqual(r.status, 200, r.body.slice(0, 300));
      assert.ok(r.body.includes('name="account_assign"'), 'assign field');
      assert.ok(r.body.includes('value="5:trophy"'), r.body.includes('Zzyzx Auto 5') ? 'option missing value' : 'account missing');
      assert.ok(/value="reservation"[^>]*>/.test(r.body) || r.body.includes('value="reservation" selected') || r.body.includes('Reservation'), 'status');
    });

    await ok('saving a reservation with no slot picked leaves every Trophy slot open', async () => {
      const loc = await post('/admin/customers/edit/40', reservationFields({ notes: 'still waiting' }));
      assert.ok(/msg=customer_updated/.test(loc), loc);
      assert.strictEqual(customer(40).status, 'reservation');
      assert.strictEqual(customer(40).notes, 'still waiting');
      [1, 2, 3, 5].forEach(id => assert.strictEqual(slotOf(id).status, 'open', 'account ' + id));
    });

    await ok('saving the reservation onto the fifth account takes its Trophy slot off Open', async () => {
      const loc = await post('/admin/customers/edit/40', reservationFields({ account_assign: '5:trophy' }));
      assert.ok(/msg=customer_updated/.test(loc), loc);
      const saved = customer(40);
      assert.strictEqual(saved.status, 'reservation');
      assert.strictEqual(saved.customer_name, 'Zzyzx Reserve');
      const trophy = slotOf(5, 'trophy');
      assert.strictEqual(trophy.status, 'rented', 'Trophy slot stayed ' + trophy.status);
      assert.strictEqual(trophy.renter_id, 40);
      assert.strictEqual(trophy.renter_name, 'Zzyzx Reserve');
      assert.strictEqual(trophy.end, '');
      assert.strictEqual(slotOf(5, 'non_trophy').status, 'open');
      [1, 2, 3].forEach(id => assert.strictEqual(slotOf(id).status, 'open', 'account ' + id));
      const html = await accountsHtml();
      assert.ok(html.includes('Uncategorized'), 'accounts group');
      const taken = chip(html, 5, 'trophy');
      assert.ok(taken.includes('data-status="rented"'), taken);
      assert.ok(taken.includes('RENTED'), taken);
      assert.ok(!taken.includes('OPEN'), taken);
      assert.ok(taken.includes('Zzyzx Reserve'), taken);
      const other = chip(html, 5, 'non_trophy');
      assert.ok(other.includes('data-status="open"') && other.includes('OPEN'), other);
      const untouched = chip(html, 1, 'trophy');
      assert.ok(untouched.includes('OPEN'), untouched);
    });

    await ok('saving the same reservation again keeps the slot and shows the new name', async () => {
      const loc = await post('/admin/customers/edit/40', reservationFields({
        customer_name: 'Zzyzx Reserve B', account_assign: '5:trophy', notes: 'name corrected'
      }));
      assert.ok(/msg=customer_updated/.test(loc), loc);
      assert.strictEqual(customer(40).customer_name, 'Zzyzx Reserve B');
      assert.strictEqual(customer(40).status, 'reservation');
      const trophy = slotOf(5);
      assert.strictEqual(trophy.status, 'rented');
      assert.strictEqual(trophy.renter_id, 40);
      assert.strictEqual(trophy.renter_name, 'Zzyzx Reserve B');
      const html = await accountsHtml();
      const taken = chip(html, 5, 'trophy');
      assert.ok(taken.includes('Zzyzx Reserve B') && taken.includes('RENTED'), taken);
    });

    await ok('moving the reservation to another open account updates both slots', async () => {
      const loc = await post('/admin/customers/edit/40', reservationFields({
        customer_name: 'Zzyzx Reserve B', account_assign: '3:trophy'
      }));
      assert.ok(/msg=customer_updated/.test(loc), loc);
      assert.strictEqual(slotOf(5).status, 'open');
      assert.strictEqual(slotOf(5).renter_id, null);
      const moved = slotOf(3);
      assert.strictEqual(moved.status, 'rented');
      assert.strictEqual(moved.renter_id, 40);
      assert.strictEqual(moved.renter_name, 'Zzyzx Reserve B');
      const html = await accountsHtml();
      assert.ok(chip(html, 5, 'trophy').includes('OPEN'));
      assert.ok(chip(html, 3, 'trophy').includes('RENTED'));
      assert.ok(chip(html, 3, 'trophy').includes('Zzyzx Reserve B'));
    });

    await ok('cancelling the reservation frees the slot it was holding', async () => {
      const loc = await post('/admin/customers/edit/40', reservationFields({
        customer_name: 'Zzyzx Reserve B', status: 'cancelled', account_assign: '3:trophy'
      }));
      assert.ok(/msg=customer_updated/.test(loc), loc);
      assert.strictEqual(customer(40).status, 'cancelled');
      assert.strictEqual(slotOf(3).status, 'open');
      assert.strictEqual(slotOf(3).renter_id, null);
      const html = await accountsHtml();
      assert.ok(chip(html, 3, 'trophy').includes('OPEN'));
      assert.strictEqual(slotOf(4).status, 'rented');
      assert.strictEqual(slotOf(4).renter_name, 'Zzyzx Renter');
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
