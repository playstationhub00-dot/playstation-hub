// Run: node scripts/test-themes-admin.js
//
// Admin → Settings → Themes, as the server renders and saves it. Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions).
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const themes = require('../lib/themes');

const PORT = 4791;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'themes-admin-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: {
    title: 'PlayStation Hub',
    hero_text: {
      line1: 'Rent the Latest', highlight: 'PS5 & PS4', line2: 'Games',
      subtitle: '', title_size: 55, highlight_color: '#F0A500', subtitle_color: '#aaaaaa'
    }
  },
  games: [{
    id: 1, title: 'Phantom Blade Zero', platform: 'PS5', genre: 'Action',
    cover_image: '/uploads/phantom.png', created_at: '2026-10-01T00:00:00.000Z',
    release_date: '2026-10-20',
    non_trophy_slots: 1, trophy_slots: 1, renters: 0,
    nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899
  }]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function readDb() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
}

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

  await okAsync('boot seeds Halloween without a second write of the flag', async () => {
    const state = readDb();
    assert.ok(state.migrations.indexOf(themes.MIGRATION_ID) !== -1);
    assert.strictEqual(state.site_settings.themes.presets.halloween.line1, 'Dare to Play');
    assert.strictEqual(state.site_settings.themes.presets.halloween.end, '2026-11-01T00:00');
    assert.strictEqual(state.site_settings.themes.presets.christmas.end, '2026-12-26T00:00');
    assert.strictEqual(state.site_settings.hero_text.line1, 'Rent the Latest');
  });

  await okAsync('saving themes needs the admin login', async () => {
    const before = readDb().site_settings.themes.presets.halloween.line1;
    const r = await call('POST', '/admin/themes', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
      body: form({ base: 'blue', halloween_line1: 'Changed' })
    });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
    assert.strictEqual(readDb().site_settings.themes.presets.halloween.line1, before);
  });

  const login = await call('POST', '/admin/login', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ password: TEST_PASSWORD })
  });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const post = o => call('POST', '/admin/themes', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: form(o)
  });

  await okAsync('the settings tab shows which theme is live and the seeded headlines', async () => {
    const r = await call('GET', '/admin?tab=settings', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('id="sec-themes"'));
    assert.ok(r.body.includes('Dare to Play'));
    assert.ok(r.body.includes('Unwrap a'));
    assert.ok(r.body.includes('Halloween is live'));
    assert.ok(r.body.includes('Asia/Manila'));
    assert.ok(r.body.includes('name="promo_text"'));
    assert.ok(r.body.includes('MONTHLY10'));
    assert.ok(r.body.includes('href="/?theme=christmas"'));
  });

  await okAsync('the homepage carries Halloween in the HTML, not in a cached color file', async () => {
    const home = await call('GET', '/');
    assert.strictEqual(home.status, 200);
    assert.ok(home.body.includes('data-theme="halloween"') || home.body.includes("dataset.theme=\"halloween\""));
    assert.ok(home.body.includes('id="site-theme"'));
    assert.ok(home.body.includes('--theme-btn:#FF7A00'));
    assert.ok(home.body.includes('Dare to Play'));
    assert.ok(home.body.includes('After Dark'));
    assert.ok(home.body.includes('class="theme-web"'));
    assert.ok(home.body.includes('/logo-hub-light.png'));
    assert.ok(!home.body.includes('/logo-hub-dark.png'));
    assert.ok(!home.body.includes('class="theme-promo-strip"'));
    const css = await call('GET', '/css/themes.css');
    assert.strictEqual(css.status, 200);
    assert.ok(!css.body.includes('--theme-btn:#FF7A00'));
  });

  await okAsync('?theme= previews Sale Mode for that request and does not save it', async () => {
    const home = await call('GET', '/?theme=sale');
    assert.ok(home.body.includes('class="theme-promo-strip"'));
    assert.ok(home.body.includes('<b>MONTHLY10</b>'));
    assert.ok(home.body.includes("dataset.theme=\"sale\"") || home.body.includes('data-theme="sale"'));
    assert.strictEqual(readDb().site_settings.themes.base, 'classic');
    const junk = await call('GET', '/?theme=%3Cscript%3E');
    assert.ok(!junk.body.includes('dataset.theme="<script>"'));
    assert.ok(junk.body.includes("dataset.theme=\"halloween\"") || junk.body.includes('data-theme="halloween"'));
  });

  await okAsync('a save changes the headline and can turn the strip on for every theme', async () => {
    const stored = readDb().site_settings.themes;
    const body = {
      base: 'classic',
      promo_mode: 'on',
      promo_text: 'Use code MONTHLY10 for 10% off monthly rentals.',
      promo_code: 'MONTHLY10'
    };
    themes.IDS.forEach(id => {
      const row = stored.presets[id];
      body[id + '_start'] = row.start || '';
      body[id + '_end'] = row.end || '';
      body[id + '_line1'] = row.line1 || '';
      body[id + '_highlight'] = row.highlight || '';
      body[id + '_line2'] = row.line2 || '';
    });
    body.halloween_line1 = 'Stay';
    body.halloween_highlight = 'Inside';
    const saved = await post(body);
    assert.strictEqual(saved.status, 302);
    assert.ok(saved.headers.location.includes('msg=themes_saved'));
    const after = readDb().site_settings.themes;
    assert.strictEqual(after.presets.halloween.line1, 'Stay');
    assert.strictEqual(after.presets.halloween.highlight, 'Inside');
    assert.strictEqual(after.presets.halloween.end, '2026-11-01T00:00');
    assert.strictEqual(after.presets.christmas.line1, 'Unwrap a');
    assert.strictEqual(after.promo.mode, 'on');
    const home = await call('GET', '/');
    assert.ok(home.body.includes('Stay'));
    assert.ok(home.body.includes('Inside'));
    assert.ok(home.body.includes('class="theme-promo-strip"'));
    const admin = await call('GET', '/admin?tab=settings&msg=themes_saved', { headers: { Cookie: cookie } });
    assert.ok(admin.body.includes('Theme settings saved'));
  });

  console.log('\n' + passed + ' passed');
  cleanup();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  cleanup();
  process.exit(1);
});
