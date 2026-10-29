// Run: node scripts/test-site-theme.js
//
// The holiday pick Michael saved (site_settings.theme) used to be what the
// homepage rendered, via html[data-theme] and public/css/theme-<name>.css.
// The scheduled presets are the one system now. This boots the real homepage
// with that saved pick still set and checks the approved Halloween design,
// the ?theme= preview, and that the old stylesheets are not linked.
// The old CSS files stay in the repo; their rules stay scoped.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const siteTheme = require('../lib/site-theme');

const PORT = 4668;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'site-theme-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const ROOT = path.join(__dirname, '..');

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { theme: 'halloween' },
  games: [
    { id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799, non_trophy_slots: 1, trophy_slots: 1 },
    { id: 5, title: 'Zzyzx Racer', platform: 'PS5', genre: 'Racing', cover_image: '/uploads/racer.png', release_date: '2026-10-20', created_at: '2026-10-22T00:00:00.000Z', nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 1, trophy_slots: 1 }
  ],
  upcoming: [{
    id: 1, title: 'Zzyzx Soon', platform: 'PS5', release_date: '2026-11-20', cover_image: '/uploads/soon.png',
    non_trophy_slots: 1, trophy_slots: 1, nt_price_7d: 349, nt_price_30d: 799
  }]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'site-theme-test';
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
const PUBLIC = ['/', '/game/zzyzx-racer', '/ps-plus/rent', '/browse'];

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

// Every rule's selector in a theme file, outside @keyframes.
function selectors(css) {
  const out = [];
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const noKeyframes = noComments.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const re = /([^{}]+)\{/g;
  let m;
  while ((m = re.exec(noKeyframes))) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@')) continue;
    sel.split(',').forEach(s => out.push(s.trim()));
  }
  return out;
}

(async () => {
  console.log('\nlib/site-theme.js');
  await ok('only the listed themes count; anything else is no theme', async () => {
    assert.deepStrictEqual(siteTheme.THEMES, ['halloween', 'christmas']);
    assert.strictEqual(siteTheme.normalizeTheme('halloween'), 'halloween');
    assert.strictEqual(siteTheme.normalizeTheme(' Christmas '), 'christmas');
    ['', null, undefined, 'easter', '../style', '<script>'].forEach(v => assert.strictEqual(siteTheme.normalizeTheme(v), '', String(v)));
  });
  await ok('the admin panel never shows a theme', async () => {
    assert.strictEqual(siteTheme.themeFor('/', { theme: 'halloween' }), 'halloween');
    assert.strictEqual(siteTheme.themeFor('/admin', { theme: 'halloween' }), '');
    assert.strictEqual(siteTheme.themeFor('/admin/login', { theme: 'christmas' }), '');
    assert.strictEqual(siteTheme.themeFor('/', null), '');
  });

  console.log('\nthe theme stylesheets');
  for (const name of siteTheme.THEMES) {
    await ok(name + ': every rule is scoped to html[data-theme="' + name + '"]', async () => {
      const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'theme-' + name + '.css'), 'utf8');
      const sels = selectors(css);
      assert.ok(sels.length > 5, 'found rules');
      sels.forEach(s => assert.ok(s.startsWith('html[data-theme="' + name + '"]'), 'unscoped: ' + s));
    });
    await ok(name + ': the animation stops for visitors who ask for less motion', async () => {
      const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'theme-' + name + '.css'), 'utf8');
      const i = css.indexOf('@media (prefers-reduced-motion: reduce)');
      assert.ok(i > 0);
      assert.ok(/animation:\s*none;\s*display:\s*none;/.test(css.slice(i)));
      assert.ok(/pointer-events:\s*none/.test(css), 'the moving layer never takes a click');
    });
  }

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

  try {
    console.log('\nthe homepage, with the saved holiday pick still set');
    await ok('a fresh boot keeps site_settings.theme and renders the scheduled Halloween design', async () => {
      assert.strictEqual(ledger().site_settings.theme, 'halloween');
      assert.strictEqual(ledger().site_settings.themes.presets.halloween.line1, 'Dare to Play');
      const home = await call('GET', '/');
      assert.strictEqual(home.status, 200);
      assert.ok(home.body.includes('<body class="home2">'));
      assert.ok(home.body.includes('Dare to Play'));
      assert.ok(home.body.includes('After Dark'));
      assert.ok(home.body.includes('#FF7A00'));
      assert.ok(home.body.includes('class="theme-web"'));
      assert.ok(home.body.includes('theme-pumpkin'));
      assert.ok(home.body.includes('>Reserve</div>'));
      assert.ok(!home.body.includes('/css/theme-halloween.css'), 'old stylesheet');
      assert.ok(!home.body.includes("setAttribute('data-theme'"));
      assert.ok(!home.body.includes('#fdba74') && !home.body.includes('#f97316') && !home.body.includes('#4c1d95'));
      assert.ok(!home.body.includes('Rent the Latest'));
    });
    await ok('?theme= previews Christmas and PS Blue without saving or loading the old files', async () => {
      const christmas = await call('GET', '/?theme=christmas');
      assert.ok(christmas.body.includes('Unwrap a'));
      assert.ok(christmas.body.includes('New Adventure'));
      assert.ok(christmas.body.includes('#C8102E'));
      assert.ok(christmas.body.includes('class="theme-garland"'));
      assert.ok(!christmas.body.includes('/css/theme-christmas.css'));
      assert.ok(!christmas.body.includes('Dare to Play'));
      const blue = await call('GET', '/?theme=blue');
      assert.ok(blue.body.includes('#0070D1'));
      assert.ok(blue.body.includes('#4DA6FF'));
      assert.ok(blue.body.includes('Rent the Latest'));
      assert.ok(!blue.body.includes('/css/theme-blue.css'));
      assert.strictEqual(ledger().site_settings.theme, 'halloween');
      assert.strictEqual(ledger().site_settings.themes.base, 'classic');
    });
    await ok('the admin panel does not load a public theme stylesheet', async () => {
      const login = await call('POST', '/admin/login', { headers: FORM, body: form({ password: TEST_PASSWORD }) });
      const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      const r = await call('GET', '/admin?tab=settings', { headers: { Cookie: cookie } });
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.includes('id="sec-themes"'));
      assert.ok(r.body.includes('still saved'));
      assert.ok(!r.body.includes('<form method="POST" action="/admin/settings/theme">'));
      assert.ok(!r.body.includes('/css/theme-halloween.css'));
      assert.ok(!r.body.includes('id="site-theme"'));
    });
    await ok('the old save route still records the pick and does not clear the schedule', async () => {
      const login = await call('POST', '/admin/login', { headers: FORM, body: form({ password: TEST_PASSWORD }) });
      const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      const r = await call('POST', '/admin/settings/theme', { headers: Object.assign({ Cookie: cookie }, FORM), body: form({ theme: 'christmas' }) });
      assert.strictEqual(r.status, 302);
      assert.strictEqual(ledger().site_settings.theme, 'christmas');
      assert.strictEqual(ledger().site_settings.themes.presets.halloween.line1, 'Dare to Play');
      assert.strictEqual(ledger().site_settings.themes.presets.halloween.end, '2026-11-01T00:00');
      const home = await call('GET', '/');
      assert.ok(home.body.includes('Dare to Play'));
      assert.ok(home.body.includes('#FF7A00'));
      assert.ok(!home.body.includes('/css/theme-christmas.css'));
    });

    console.log('\n' + passed + ' assertions passed\n');
  } catch (e) {
    console.error(e);
    cleanup();
    process.exit(1);
  }
  cleanup();
  process.exit(0);
})().catch(e => { console.error(e); cleanup(); process.exit(1); });
