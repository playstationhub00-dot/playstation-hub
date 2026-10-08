// Run: node scripts/test-admin-price-bands.js
//
// Admin → Settings → Browse price filter: the card, saving the two cut-offs,
// refusing bad ones, and the login. Boots a throwaway instance (temp DATA_DIR,
// blank MONGODB_URI, in-memory sessions, a made-up admin password); the
// project's games.json, the database and the real admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4615;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'price-bands-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: []
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const bandsInDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8')).site_settings.browse_price_bands;

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
    const r = await call('POST', '/admin/browse-price-bands', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: form({ low: '150', high: '250' }) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
    assert.strictEqual(bandsInDb(), undefined);
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const post = o => call('POST', '/admin/browse-price-bands', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o) });

  await okAsync('the Settings card shows the defaults and the chips customers will see', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('id="sec-price-bands"') && r.body.includes('href="#sec-price-bands"'));
    assert.ok(r.body.includes('name="low" value="200"') && r.body.includes('name="high" value="300"'));
    assert.ok(r.body.includes('Customers see: Under ₱200 · ₱200–299 · ₱300+.'));
  });
  await okAsync('saves two whole numbers', async () => {
    const r = await post({ low: '150', high: '250' });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.endsWith('msg=price_bands_saved'));
    assert.deepStrictEqual(bandsInDb(), { low: 150, high: 250 });
    assert.ok((await call('GET', '/admin', { headers: { Cookie: cookie } })).body.includes('Customers see: Under ₱150 · ₱150–249 · ₱250+.'));
  });
  await okAsync('refuses a second number that is not bigger, and anything not a whole number', async () => {
    for (const bad of [{ low: '300', high: '300' }, { low: '0', high: '100' }, { low: 'abc', high: '100' }, { low: '99.5', high: '200' }]) {
      const r = await post(bad);
      assert.ok(r.headers.location.endsWith('msg=price_bands_invalid'), JSON.stringify(bad));
    }
    assert.deepStrictEqual(bandsInDb(), { low: 150, high: 250 }, 'unchanged');
  });
  await okAsync('both messages are wired to the Settings tab', async () => {
    const r = await call('GET', '/admin?tab=settings&msg=price_bands_saved', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes("price_bands_saved:'✅ Price filter saved'"));
    assert.ok(r.body.includes("price_bands_saved:'settings', price_bands_invalid:'settings'"));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
