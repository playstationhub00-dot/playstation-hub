// Run: node scripts/test-admin-buy-spotlight.js
//
// Admin → Content → Buy page spotlight: the picker (box sets and games with a
// buy price), saving up to 5 picks (blanks, unknown picks and repeats
// dropped), the login, the toast, and the Buy storefront showing the picks —
// or the top 3 best sellers once nothing is picked. Boots a throwaway instance
// (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin
// password); the project's games.json, the database and the real admin are
// never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4634;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buy-spotlight-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const game = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', cover_image: '/uploads/' + id + '.png', renters: 1, nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 1, trophy_slots: 1 }, extra || {});
const slots = { non_trophy: { enabled: true, status: 'open' }, trophy: { enabled: true, status: 'open' }, ps4_primary: { enabled: false, status: 'open' } };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 }, buy_spotlight: [{ kind: 'game', id: 2 }] },
  games: [
    game(1, 'Zzyzx Alpha', { buy_nt_price: 999, renters: 9 }), game(2, 'Zzyzx Bravo', { buy_nt_price: 1499, renters: 5 }),
    game(3, 'Zzyzx Charlie', { buy_tr_price: 1999, renters: 2 }), game(4, 'Zzyzx Delta', { buy_nt_price: 799, renters: 1 }),
    game(5, 'Zzyzx NoPrice')
  ],
  accounts: [
    { id: 1, label: 'Zzyzx Box', public_name: 'Zzyzx Box', for_sale: true, game_ids: [5], price_permanent_nt: 2500, slots },
    { id: 2, label: 'Zzyzx Delta', public_name: 'Zzyzx Delta', for_sale: true, game_ids: [4], price_permanent_nt: 799, slots }
  ],
  customers: [{ id: 1, game_id: 4, game_title: 'Zzyzx Delta', status: 'bought', customer_name: 'Zzyzx A' }]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const picksInDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8')).site_settings.buy_spotlight;

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
const form = o => new URLSearchParams(o).toString();
const slideTitles = html => [...html.matchAll(/<span class="shop-slide-title">([^<]*)<\/span>/g)].map(m => m[1]);

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
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  await okAsync('saving needs the admin login', async () => {
    const r = await call('POST', '/admin/buy-spotlight', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: form({ slide_1: 'game:1' }) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
    assert.deepStrictEqual(picksInDb(), [{ kind: 'game', id: 2 }]);
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const post = o => call('POST', '/admin/buy-spotlight', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o) });

  await okAsync('the picker: five slots, box sets then games with a buy price, the current pick selected', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('id="sec-buy-spotlight"') && r.body.includes('<a href="#sec-buy-spotlight">Buy spotlight</a>'));
    assert.strictEqual((r.body.match(/<select name="slide_\d">/g) || []).length, 5);
    const first = /<select name="slide_1">([\s\S]*?)<\/select>/.exec(r.body)[1];
    assert.ok(first.includes('<option value="">— Best sellers —</option>'));
    assert.ok(first.includes('<option value="box:1">Zzyzx Box</option>'), 'a box set');
    assert.ok(!first.includes('value="box:2"'), 'an account selling one game is not a box set');
    assert.ok(first.includes('<option value="game:2" selected>Zzyzx Bravo</option>'));
    assert.ok(!first.includes('Zzyzx NoPrice'), 'no buy price, nothing to sell');
    assert.ok(first.indexOf('label="Box sets"') < first.indexOf('label="Games"'));
  });
  await okAsync('saves the picks in order, dropping blanks, unknown picks and repeats', async () => {
    const r = await post({ slide_1: 'box:1', slide_2: '', slide_3: 'game:3', slide_4: 'game:3', slide_5: 'game:99' });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.endsWith('tab=content&msg=buy_spotlight_saved'));
    assert.deepStrictEqual(picksInDb(), [{ kind: 'box', id: 1 }, { kind: 'game', id: 3 }]);
    assert.deepStrictEqual(slideTitles((await call('GET', '/buy')).body), ['Zzyzx Box', 'Zzyzx Charlie'], 'the storefront shows them');
  });
  await okAsync('nothing picked: the storefront shows the top 3 best sellers', async () => {
    await post({});
    assert.deepStrictEqual(picksInDb(), []);
    assert.deepStrictEqual(slideTitles((await call('GET', '/buy')).body), ['Zzyzx Delta', 'Zzyzx Alpha', 'Zzyzx Bravo'], 'the one sold first, then the most rented');
  });
  await okAsync('the toast', async () => {
    const r = await call('GET', '/admin?tab=content&msg=buy_spotlight_saved', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes("buy_spotlight_saved:'✅ Buy page spotlight saved'") && r.body.includes("buy_spotlight_saved:'content'"));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
