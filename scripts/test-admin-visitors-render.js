// Run: node scripts/test-admin-visitors-render.js
//
// Boots the real server against a throwaway DATA_DIR (a games.json this test
// writes, with a made-up admin password that exists nowhere else) and a blank
// MONGODB_URI, logs in to THAT instance, and checks the dashboard embeds the new
// visitor windows: five funnel rows, skipped hits, Most asked-about games with
// live availability, and searches that found nothing. Nothing real is touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4593;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-visitors-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const today = new Date().toISOString().slice(0, 10);
const v = (sid, p) => ({ date: today, time: new Date().toISOString(), path: p, page: p, ip: 'x', session_id: sid });
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  games: [{ id: 1, title: 'Zzyzx Test Quest', platform: 'PS5', nt_price_7d: 100, nt_price_30d: 300, cover_image: '/uploads/zzyzx.png' }],
  visitors: [
    v('s1', '/'), v('s1', '/game/zzyzx-test-quest'),
    v('s2', '/'),
    v('s3', '/'), v('s3', '/api/search-index'),
    v('hook', '/webhooks/paymongo')
  ],
  message_taps: [
    { date: today, time: new Date().toISOString(), session_id: 's1', page: '/game/zzyzx-test-quest', game: 'zzyzx-test-quest', source: 'game' },
    { date: today, time: new Date().toISOString(), session_id: 's2', page: '/', game: null, source: 'nav' }
  ],
  search_misses: [{ date: today, time: new Date().toISOString(), session_id: 's2', q: 'elden ring' }],
  visitor_skips: { [today]: 6 }
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method, headers, timeout: 15000 }, res => {
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

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  // Sessions normally live in MongoDB, which this test does not have. Swap in express-session's
  // in-memory store (the only change from production) so logging in to this throwaway instance sticks.
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

  console.log('\nadmin dashboard visitor windows');

  let cookie = '';
  await okAsync('logging in to the throwaway instance works', async () => {
    const r = await call('POST', '/admin/login', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' },
      body: 'password=' + encodeURIComponent(TEST_PASSWORD)
    });
    assert.strictEqual(r.status, 302);
    cookie = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    assert.ok(cookie, 'session cookie');
  });

  await okAsync('the dashboard renders and embeds the new windows', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' } });
    assert.strictEqual(r.status, 200, 'GET /admin should render, got ' + r.status);
    const m = /const VIS_WINDOWS = (\{[\s\S]*?\});\s*\n/.exec(r.body);
    assert.ok(m, 'VIS_WINDOWS is embedded');
    const win = JSON.parse(m[1].replace(/\\u003c/g, '<')).today;
    assert.deepStrictEqual(win.funnel.map(x => x.label), ['Landed', 'Viewed a game', 'Messaged us', 'Ordered on website', 'Paid']);
    assert.deepStrictEqual(win.funnel.map(x => x.count), [3, 1, 2, 0, 0], 'the webhook session is gone; /api row does not make a session');
    assert.strictEqual(win.skipped, 6);
    assert.deepStrictEqual(win.asked.games.map(g => [g.slug, g.title, g.cover, g.count]), [['zzyzx-test-quest', 'Zzyzx Test Quest', '/uploads/zzyzx.png', 1]]);
    assert.strictEqual(typeof win.asked.games[0].slots, 'number');
    assert.strictEqual(win.asked.other, 1);
    assert.deepStrictEqual(win.misses, [{ q: 'elden ring', count: 1 }]);
    assert.ok(!win.topPages.some(([p]) => p.startsWith('/api/') || p.startsWith('/webhooks')), 'system paths are not top pages');
    assert.ok(r.body.includes('/js/dashboard-visitors.js?v='));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
