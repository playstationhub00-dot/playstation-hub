// Run: node scripts/test-site-theme.js
//
// Holiday themes (Halloween, Christmas) for the public site. The owner picks
// one in Admin → Settings (POST /admin/settings/theme); public pages then mark
// <html data-theme> and load public/css/theme-<name>.css, and the admin panel
// never does. Also checks both theme stylesheets keep every rule scoped to
// their theme and stop the animation for visitors who ask for less motion.
//
// Throwaway only: a temp DATA_DIR, a blank MONGODB_URI, an in-memory session
// store, a made-up admin password and made-up games.
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
  games: [
    { id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799, non_trophy_slots: 1, trophy_slots: 1 },
    { id: 5, title: 'Zzyzx Racer', platform: 'PS5', genre: 'Racing', nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 1, trophy_slots: 1 }
  ]
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
    console.log('\nthe site');
    await ok('no theme set: public pages look as they did, with no theme mark or stylesheet', async () => {
      for (const p of PUBLIC) {
        const r = await call('GET', p);
        assert.strictEqual(r.status, 200, p);
        assert.ok(!r.body.includes('data-theme') && !r.body.includes('/css/theme-'), p);
      }
    });
    await ok('saving refuses anyone not logged in', async () => {
      const r = await call('POST', '/admin/settings/theme', { headers: FORM, body: form({ theme: 'halloween' }) });
      assert.ok(r.status === 302 || r.status === 401, String(r.status));
      assert.ok(!ledger().site_settings || !ledger().site_settings.theme);
    });

    const login = await call('POST', '/admin/login', { headers: FORM, body: form({ password: TEST_PASSWORD }) });
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    assert.ok(cookie, 'logged in');
    const save = async theme => {
      const r = await call('POST', '/admin/settings/theme', { headers: Object.assign({ Cookie: cookie }, FORM), body: form({ theme }) });
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.headers.location, '/admin?tab=settings&msg=theme_saved');
    };

    for (const name of siteTheme.THEMES) {
      await ok(name + ': saved, then every public page marks it and loads its stylesheet', async () => {
        await save(name);
        assert.strictEqual(ledger().site_settings.theme, name);
        for (const p of PUBLIC) {
          const r = await call('GET', p);
          assert.ok(r.body.includes("<script>document.documentElement.setAttribute('data-theme', '" + name + "');</script>"), p);
          assert.ok(new RegExp('<link rel="stylesheet" href="/css/theme-' + name + '\\.css\\?v=[^"]+">').test(r.body), p);
        }
      });
      await ok(name + ': the admin panel stays plain, and Settings shows it picked', async () => {
        const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
        assert.strictEqual(r.status, 200);
        assert.ok(!r.body.includes('/css/theme-') && !r.body.includes("setAttribute('data-theme'"));
        assert.ok(r.body.includes('<form method="POST" action="/admin/settings/theme">'));
        assert.ok(r.body.includes('<option value="' + name + '" selected>'), 'picked in the form');
        assert.ok(r.body.includes("theme_saved:'🎨 Theme saved.'"));
        const css = await call('GET', '/css/theme-' + name + '.css');
        assert.strictEqual(css.status, 200);
      });
    }

    await ok('an unknown value saves as no theme, and the site goes back to normal', async () => {
      await save('easter');
      assert.strictEqual(ledger().site_settings.theme, '');
      const r = await call('GET', '/');
      assert.ok(!r.body.includes('data-theme') && !r.body.includes('/css/theme-'));
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
