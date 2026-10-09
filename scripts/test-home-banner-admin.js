// Run: node scripts/test-home-banner-admin.js
//
// Admin → Content → Homepage banner: the picker, saving up to 5 game ids
// (blanks, unknown ids and repeats dropped), the login, the toast, and the
// notes on the hero text and the old hero background. Boots a throwaway
// instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up
// admin password); the project's games.json, the database and the real admin
// are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4617;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-banner-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const game = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', cover_image: '/uploads/' + id + '.png', nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 1, trophy_slots: 1 }, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 }, home_banner_ids: [2] },
  games: [game(1, 'Zzyzx Alpha'), game(2, 'Zzyzx Bravo'), game(3, 'Zzyzx Charlie', { cover_image: '' })]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const pinsInDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8')).site_settings.home_banner_ids;

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

  await okAsync('saving needs the admin login', async () => {
    const r = await call('POST', '/admin/home-banner', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: form({ banner_1: '1' }) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
    assert.deepStrictEqual(pinsInDb(), [2]);
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const post = o => call('POST', '/admin/home-banner', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o) });

  await okAsync('the picker: five slots, every game A–Z, the current pin selected, coverless games marked', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('id="sec-home-banner"') && r.body.includes('href="#sec-home-banner"'));
    assert.strictEqual((r.body.match(/<select name="banner_\d">/g) || []).length, 5);
    assert.ok(r.body.includes('<option value="2" selected>Zzyzx Bravo</option>'));
    assert.ok(r.body.includes('<option value="3">Zzyzx Charlie (no cover art)</option>'));
    assert.ok(r.body.indexOf('>Zzyzx Alpha<') < r.body.indexOf('>Zzyzx Bravo<'));
  });
  await okAsync('saves the picked games in order, dropping blanks, unknown games and repeats', async () => {
    const r = await post({ banner_1: '3', banner_2: '', banner_3: '1', banner_4: '1', banner_5: '99' });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.endsWith('tab=content&msg=home_banner_saved'));
    assert.deepStrictEqual(pinsInDb(), [3, 1]);
    await post({});
    assert.deepStrictEqual(pinsInDb(), [], 'all blank clears the pins');
  });
  await okAsync('the toast, and the notes on the hero text and the old hero background', async () => {
    const r = await call('GET', '/admin?tab=content&msg=home_banner_saved', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes("home_banner_saved:'✅ Homepage banner saved'") && r.body.includes("home_banner_saved:'content'"));
    assert.ok(r.body.includes('The homepage tagline: Line 1 + highlighted text + Line 2, on one line'));
    assert.ok(r.body.includes('Home Page Hero Background <span style="color:#888;font-weight:400;">— not used by the new homepage</span>'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
