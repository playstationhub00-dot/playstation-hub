// Run: node scripts/test-game-discount-admin.js
//
// Admin → Settings → Game discounts: the table, its save route and the Games
// list tag, the homepage "Special deals" row disappearing once no game beats
// the site promo, and a game's own % surviving the site promo being switched off.
// Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory
// sessions, a made-up admin password); the project's games.json, the database
// and the real admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4613;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'game-discount-admin-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', cover_image: '/uploads/' + id + '.png',
  nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 2, trophy_slots: 2
}, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 } },
  games: [
    game(1, 'Zzyzx Deal', { discounts: { 7: null, 30: 20 } }),
    game(2, 'Zzyzx Plain'),
    game(3, 'Zzyzx Both', { discounts: { 7: 0, 30: 15 } })
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const readDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const gameById = id => readDb().games.find(g => g.id === id);

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

  console.log('\naccess');
  await okAsync('saving needs the admin login', async () => {
    const r = await call('POST', '/admin/promo/game-discounts', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: form({ d30_2: '50' }) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
    assert.strictEqual(gameById(2).discounts, undefined);
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in to the throwaway instance');
  const post = o => call('POST', '/admin/promo/game-discounts', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o) });

  console.log('\nthe table');
  await okAsync('lists every game A–Z with its own values; empty boxes for the site promo', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('id="sec-game-discounts"') && r.body.includes('href="#sec-game-discounts"'));
    assert.ok(r.body.includes('Site promo: Weekly 0% · Monthly 10% (on).'));
    const both = r.body.indexOf('data-title="zzyzx both"');
    const deal = r.body.indexOf('data-title="zzyzx deal"');
    const plain = r.body.indexOf('data-title="zzyzx plain"');
    assert.ok(both > 0 && deal > both && plain > deal, 'A–Z');
    assert.ok(/name="d30_1" value="20"/.test(r.body));
    assert.ok(/name="d7_1" value=""/.test(r.body));
    assert.ok(/name="d7_3" value="0"/.test(r.body) && /name="d30_3" value="15"/.test(r.body));
    assert.ok(/name="d30_2" value=""/.test(r.body));
    assert.ok(/data-title="zzyzx deal" data-own="1"/.test(r.body) && /data-title="zzyzx plain" data-own="0"/.test(r.body));
    assert.ok(/data-base="799" data-site="10"/.test(r.body), 'monthly price preview inputs');
  });
  await okAsync('the Games list tags games with their own %', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes('<span class="gm-tag gm-tag-discount">% 20% monthly</span>'));
    assert.ok(r.body.includes('<span class="gm-tag gm-tag-discount">% no discount weekly · 15% monthly</span>'));
  });

  console.log('\nsaving');
  await okAsync('sets, clears and clamps; junk becomes "site promo"; a fully empty game is cleared', async () => {
    const r = await post({ d7_1: '', d30_1: '25', d7_2: 'abc', d30_2: '150', d7_3: '', d30_3: '' });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.endsWith('msg=game_discounts_saved'));
    assert.deepStrictEqual(gameById(1).discounts, { 7: null, 30: 25 });
    assert.deepStrictEqual(gameById(2).discounts, { 7: null, 30: 100 });
    assert.strictEqual(gameById(3).discounts, null);
  });
  await okAsync('games not on the submitted form are left alone', async () => {
    await post({ d30_1: '30' });
    assert.deepStrictEqual(gameById(1).discounts, { 7: null, 30: 30 });
    assert.deepStrictEqual(gameById(2).discounts, { 7: null, 30: 100 }, 'untouched');
  });
  await okAsync('the toast is wired to the Settings tab', async () => {
    const r = await call('GET', '/admin?tab=settings&msg=game_discounts_saved', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes("game_discounts_saved:'✅ Game discounts saved'"));
    assert.ok(r.body.includes("game_discounts_saved:'settings'"));
  });

  console.log('\nhomepage row');
  await okAsync('shows while a game beats the site promo, and disappears when none does', async () => {
    assert.ok((await call('GET', '/')).body.includes('id="specialDealsSection"'));
    await post({ d7_1: '', d30_1: '', d7_2: '', d30_2: '10', d7_3: '', d30_3: '' });
    const r = await call('GET', '/');
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body.includes('id="specialDealsSection"'), 'equal to the site promo is not a deal');
  });

  console.log('\nsite promo off');
  await okAsync("a game's own % keeps working when the site promo is switched off", async () => {
    // Zzyzx Plain still has its own 10% Monthly from the step above; Zzyzx Deal follows the site promo.
    const r = await call('POST', '/admin/promo', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form({ discount_7: '0', discount_30: '10', deposit: '100' }) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(readDb().site_settings.promo.enabled, false, 'site promo off');
    assert.ok(/discounts: \{ 7: 0, 30: 10 \}/.test((await call('GET', '/game/zzyzx-plain')).body), 'own 10% still applies');
    assert.ok(/discounts: \{ 7: 0, 30: 0 \}/.test((await call('GET', '/game/zzyzx-deal')).body), 'no own % → full price');
    const home = (await call('GET', '/')).body;
    const start = home.indexOf('id="specialDealsSection"');
    assert.ok(start > 0, 'the own % now beats the (off) site promo → a deal');
    assert.ok(home.slice(start, home.indexOf('<!-- UPCOMING GAMES', start)).includes('/game/zzyzx-plain'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
