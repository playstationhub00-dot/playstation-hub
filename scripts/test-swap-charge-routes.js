// Run: node scripts/test-swap-charge-routes.js
//
// Game swaps through the real admin routes: a swap to a pricier game charges
// nothing unless the owner switches the charge on, and a charge from an earlier
// swap can be removed from the Customers tab. Boots a throwaway instance (temp
// DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin password);
// the project's games.json, the database and the real admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4598;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-charge-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const game = (id, title, nt30) => ({ id, title, platform: 'PS5', nt_price_7d: 349, nt_price_30d: nt30, tr_price_7d: 399, tr_price_30d: 799, non_trophy_slots: 3, trophy_slots: 3 });
const renter = (id, name, extra) => Object.assign({
  id, customer_name: name, game_id: 1, game_title: 'Cheap Game', days: 30, account_type: 'nt',
  start_date: '2026-09-20', end_date: '2026-10-20', price: 540, status: 'renting', notes: '',
  payments: [{ amount: 540, date: '2026-09-20', kind: 'rental' }]
}, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 } },
  // Cheap Game monthly 600 → 540 with the promo; Pricey Game 699 → 629. Difference ₱89.
  games: [game(1, 'Cheap Game', 600), game(2, 'Pricey Game', 699)],
  customers: [
    renter(11, 'Free Swapper'),
    renter(12, 'Paid Swapper'),
    renter(13, 'Already Charged', {
      game_id: 2, game_title: 'Pricey Game', price: 629,
      payments: [{ amount: 540, date: '2026-09-20', kind: 'rental' }, { amount: 89, date: '2026-10-02', kind: 'extension' }],
      swap_history: [{ at: '2026-10-02T03:00:00.000Z', from_game_id: 1, from_game_title: 'Cheap Game', to_game_id: 2, to_game_title: 'Pricey Game', price_before: 540, new_game_price: 629, price_after: 629, top_up: 89 }]
    })
  ],
  nextCustomerId: 20
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const readDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const cust = id => readDb().customers.find(c => c.id === id);

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
const form = o => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

// Runs the edit page's own inline script against a stub of the elements it
// touches. Option prices mirror the seeded games.
function swapBox(html) {
  const vm = require('vm');
  const m = /<script>\s*(const CUST_ORIGINAL_GAME_ID[\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'edit page script found');
  const els = {};
  const mk = (id, extra) => (els[id] = Object.assign({
    id, value: '', hidden: false, readOnly: false, textContent: '', innerHTML: '',
    setAttribute() {}, removeAttribute() {}, focus() {}
  }, extra || {}));
  const opt = (value, title, nt30) => ({ value, textContent: title, dataset: { title, nt7: '349', nt30: String(nt30), tr7: '399', tr30: '799', buynt: '0', buytr: '0' } });
  const options = [{ value: '', textContent: '', dataset: {} }, opt('1', 'Cheap Game', 600), opt('2', 'Pricey Game', 699)];
  mk('cust_game', { value: '1', options, selectedIndex: 1 });
  mk('cust_price', { value: 540 });
  mk('cust_swap_charge', { value: '0' });
  mk('cust_swap_panel', { hidden: true });
  ['cust_swap_from', 'cust_swap_to', 'cust_swap_result', 'cust_end', 'cust_custom_days', 'cust_days_group'].forEach(id => mk(id));
  mk('cust_status', { value: 'renting' });
  mk('cust_type', { value: 'nt' });
  mk('cust_days', { value: '30' });
  mk('cust_start', { value: '2026-09-20' });
  const ctx = vm.createContext({ console, document: { getElementById: id => els[id] || null } });
  vm.runInContext(m[1], ctx);
  const run = code => vm.runInContext(code, ctx);
  return {
    els, run,
    select(id) {
      els.cust_game.value = id;
      els.cust_game.selectedIndex = options.findIndex(o => o.value === id);
      run('renderCustSwapPanel()');
    }
  };
}

async function main() {
  // Sessions normally live in MongoDB, which this test does not have.
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
  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in to the throwaway instance');
  const post = (p, o) => call('POST', p, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o || {}) });
  const swapTo2 = extra => Object.assign({
    customer_name: 'x', game_id: '2', days: '30', account_type: 'nt', start_date: '2026-09-20', end_date: '2026-10-20',
    price: '629', status: 'renting', notes: ''
  }, extra || {});

  console.log('\nthe edit page swap box (its real script, stub page)');
  const editHtml = (await call('GET', '/admin/customers/edit/11', { headers: { Cookie: cookie } })).body;
  const box = swapBox(editHtml);
  await okAsync('picking the pricier game: no extra by default, price stays and is locked', async () => {
    box.select('2');
    assert.strictEqual(box.els.cust_swap_panel.hidden, false);
    assert.ok(box.els.cust_swap_result.innerHTML.includes('No extra charge'));
    assert.ok(box.els.cust_swap_result.innerHTML.includes('Charge ₱89 more'));
    assert.strictEqual(String(box.els.cust_price.value), '540');
    assert.strictEqual(box.els.cust_swap_charge.value, '0');
    assert.strictEqual(box.els.cust_price.readOnly, true);
  });
  await okAsync('Charge on adds the difference; off again takes it away', async () => {
    box.run('toggleCustSwapCharge()');
    assert.ok(box.els.cust_swap_result.innerHTML.includes('Customer pays <strong>₱89</strong> more'));
    assert.strictEqual(String(box.els.cust_price.value), '629');
    assert.strictEqual(box.els.cust_swap_charge.value, '1');
    box.run('toggleCustSwapCharge()');
    assert.strictEqual(String(box.els.cust_price.value), '540');
    assert.strictEqual(box.els.cust_swap_charge.value, '0');
  });
  await okAsync('weekly is priced too (it used to say "enter manually")', async () => {
    box.els.cust_days.value = '7';
    box.run('renderCustSwapPanel()');
    assert.ok(!box.els.cust_swap_result.innerHTML.includes('enter the new total manually'));
    assert.ok(box.els.cust_swap_result.innerHTML.includes('No additional payment'), 'weekly ₱349 is less than the ₱540 paid');
    box.els.cust_days.value = '30';
  });
  await okAsync('back to the original game: box hides, price restored and editable; a new target starts uncharged', async () => {
    box.select('2');
    box.run('toggleCustSwapCharge()');
    box.select('1');
    assert.strictEqual(box.els.cust_swap_panel.hidden, true);
    assert.strictEqual(String(box.els.cust_price.value), '540');
    assert.strictEqual(box.els.cust_price.readOnly, false);
    assert.strictEqual(box.els.cust_swap_charge.value, '0');
    box.select('2');
    assert.strictEqual(box.els.cust_swap_charge.value, '0');
  });

  console.log('\nswapping to a pricier game');
  await okAsync('charge off (the default): the price stays, no payment, the swap notes what was let go', async () => {
    const r = await post('/admin/customers/edit/11', swapTo2({ customer_name: 'Free Swapper' }));
    assert.strictEqual(r.status, 302);
    const c = cust(11);
    assert.strictEqual(c.game_id, 2);
    assert.strictEqual(c.price, 540);
    assert.deepStrictEqual(c.payments, [{ amount: 540, date: '2026-09-20', kind: 'rental' }]);
    const s = c.swap_history[0];
    assert.strictEqual(s.top_up, 0);
    assert.strictEqual(s.top_up_waived, 89);
    assert.strictEqual(s.price_after, 540);
  });
  await okAsync('charge on: the difference is recorded as a payment dated today', async () => {
    await post('/admin/customers/edit/12', swapTo2({ customer_name: 'Paid Swapper', swap_charge: '1', price: '540' }));
    const c = cust(12);
    assert.strictEqual(c.price, 629, 'the server adds the difference even if the form sent the old price');
    assert.strictEqual(c.payments.length, 2);
    assert.deepStrictEqual({ amount: c.payments[1].amount, kind: c.payments[1].kind }, { amount: 89, kind: 'extension' });
    assert.strictEqual(c.swap_history[0].top_up, 89);
  });

  console.log('\nremoving a charge an earlier swap made');
  await okAsync('the Customers tab offers Remove beside a charged swap only', async () => {
    const r = await call('GET', '/admin?tab=customers', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('action="/admin/customers/13/swap-waive"'), 'charged swap has the button');
    assert.ok(r.body.includes('Remove ₱89'));
    assert.ok(!r.body.includes('action="/admin/customers/11/swap-waive"'), 'a free swap has none');
  });
  await okAsync('Remove takes the payment off and lowers the price', async () => {
    const r = await post('/admin/customers/13/swap-waive');
    assert.ok(r.headers.location.endsWith('msg=swap_waived'));
    const c = cust(13);
    assert.strictEqual(c.price, 540);
    assert.deepStrictEqual(c.payments, [{ amount: 540, date: '2026-09-20', kind: 'rental' }]);
    assert.strictEqual(c.swap_history[0].top_up, 0);
    assert.strictEqual(c.swap_history[0].top_up_waived, 89);
  });
  await okAsync('pressing it again changes nothing', async () => {
    const r = await post('/admin/customers/13/swap-waive');
    assert.ok(r.headers.location.endsWith('msg=swap_waive_none'));
    assert.strictEqual(cust(13).price, 540);
  });
  await okAsync('an unknown customer or a logged-out request is refused', async () => {
    assert.ok((await post('/admin/customers/999/swap-waive')).headers.location.endsWith('msg=error'));
    const anon = await call('POST', '/admin/customers/12/swap-waive', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
    assert.ok(anon.headers.location.includes('/admin/login'));
    assert.strictEqual(cust(12).price, 629);
  });

  console.log('\nthe edit page');
  await okAsync('carries the charge switch and prices weekly and monthly swaps', async () => {
    const r = await call('GET', '/admin/customers/edit/11', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('name="swap_charge" id="cust_swap_charge" value="0"'));
    assert.ok(/discounts: \{"7":0,"30":10\}/.test(r.body), 'discounts keyed by the durations the shop sells');
    assert.ok(r.body.includes('function toggleCustSwapCharge()'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
