// Run: node scripts/test-admin-psn.js
//
// The admin side of "game info from PlayStation": the Games tab's "Update all"
// route and the per-game section on the edit page. Boots a throwaway instance
// (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin
// password) with lib/psn-game's fetchGameInfo replaced by a stub, so nothing
// reaches PlayStation, a database, or the real admin.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4597;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-psn-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const OLD = new Date(Date.now() - 10 * 86400000).toISOString();
const FRESH = new Date(Date.now() - 1 * 86400000).toISOString();
const g = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', nt_price_7d: 100, nt_price_30d: 300, tr_price_7d: 100, tr_price_30d: 300 }, extra || {});
const games = [
  g(1, 'Zzyzx Known One'),
  g(2, 'Zzyzx Known Stale', { psn: { description: 'old', fetched_at: OLD } }),
  g(3, 'Zzyzx Known Fresh', { psn: { description: 'keep me', fetched_at: FRESH } }),
  g(4, 'Zzyzx Nomatch'),
  g(5, 'Zzyzx Broken'),
  g(6, 'Zzyzx Garbage Date', { psn: { description: 'junk', fetched_at: 'garbage' } })
];
// 65 more, already fetched today: skipped by a normal run, counted by a forced
// one (which is how the 60-per-press cap is exercised).
for (let i = 100; i < 165; i++) games.push(g(i, 'Zzyzx Bulk ' + i, { psn: { description: 'bulk', fetched_at: FRESH } }));
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({ admin_password: TEST_PASSWORD, games }));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.PSN_PAUSE_MS = '0';
process.env.PSN_REFRESH_BUDGET_MS = '400';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const readDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const gameById = id => readDb().games.find(x => x.id === id);

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

async function main() {
  // Sessions normally live in MongoDB, which this test does not have: swap in
  // express-session's in-memory store (the only difference from production).
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  // Stub PlayStation: known titles succeed, "Nomatch" has no game unless a store link is pasted, "Broken" fails.
  const psnGame = require('../lib/psn-game');
  const fetched = [];
  const knob = { delay: 0, throwTitle: '' };
  psnGame.fetchGameInfo = async game => {
    if (knob.delay) await new Promise(r => setTimeout(r, knob.delay));
    if (knob.throwTitle && game.title.includes(knob.throwTitle)) throw new Error('unexpected');
    fetched.push({ id: game.id, link: game.psn_link || '' });
    if (!game.psn_link && /Nomatch/.test(game.title)) return { ok: false, reason: 'no_match' };
    if (/Broken/.test(game.title)) return { ok: false, reason: 'network' };
    return {
      ok: true,
      psn: {
        source: game.psn_link ? 'manual' : 'auto', fetched_at: new Date().toISOString(),
        store_url: 'https://store.playstation.com/en-us/concept/1', matched_title: game.title,
        description: 'fresh for ' + game.title, videos: [], screenshots: []
      }
    };
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\naccess');
  await okAsync('both routes need the admin login', async () => {
    const a = await call('POST', '/admin/games/psn/refresh', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: '' });
    const b = await call('POST', '/admin/games/1/psn', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: form({ action: 'update' }) });
    assert.strictEqual(a.status, 302);
    assert.ok(a.headers.location.includes('/admin/login'));
    assert.strictEqual(b.status, 302);
    assert.ok(b.headers.location.includes('/admin/login'));
    assert.strictEqual(fetched.length, 0);
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in to the throwaway instance');
  const post = (p, o) => call('POST', p, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o || {}) });

  console.log('\nUpdate all from PlayStation');
  await okAsync('fetches games never fetched or older than 7 days, skips the fresh ones', async () => {
    const r = await post('/admin/games/psn/refresh');
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.includes('msg=psn_refreshed'));
    assert.deepStrictEqual(fetched.map(f => f.id).sort((a, b) => a - b), [1, 2, 4, 5, 6]);
    assert.strictEqual(gameById(1).psn.description, 'fresh for Zzyzx Known One');
    assert.strictEqual(gameById(2).psn.description, 'fresh for Zzyzx Known Stale');
    assert.strictEqual(gameById(3).psn.description, 'keep me', 'fresh game untouched');
  });
  await okAsync('a game with no match or a failed fetch keeps its data and is listed in the last run', async () => {
    assert.strictEqual(gameById(4).psn, undefined);
    assert.strictEqual(gameById(5).psn, undefined);
    const run = readDb().psn_last_run;
    assert.strictEqual(run.updated, 3);
    assert.deepStrictEqual(run.nomatch, ['Zzyzx Nomatch']);
    assert.deepStrictEqual(run.failed, ['Zzyzx Broken']);
    assert.strictEqual(run.remaining, 0);
  });
  await okAsync('the Games tab shows the button and the last run', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('Update all from PlayStation'));
    assert.ok(/updated <strong[^>]*>3<\/strong>/.test(r.body));
    assert.ok(r.body.includes('Zzyzx Nomatch') && r.body.includes('Zzyzx Broken'));
  });
  await okAsync('pressing it again straight away only retries games that have no data', async () => {
    fetched.length = 0;
    await post('/admin/games/psn/refresh');
    assert.deepStrictEqual(fetched.map(f => f.id).sort((a, b) => a - b), [4, 5]);
  });
  await okAsync('force re-fetches fresh games too, but at most 60 per press, and says how many are left', async () => {
    fetched.length = 0;
    await post('/admin/games/psn/refresh', { force: '1' });
    assert.strictEqual(fetched.length, 60);
    assert.deepStrictEqual(fetched.slice(0, 5).map(f => f.id), [1, 2, 3, 4, 5], 'in catalogue order');
    assert.strictEqual(readDb().psn_last_run.remaining, 11);
  });
  await okAsync('a game whose fetched_at does not parse is treated as due', async () => {
    assert.strictEqual(gameById(6).psn.description, 'fresh for Zzyzx Garbage Date');
  });
  await okAsync('an unexpected exception counts as failed, the loop continues and the run is still recorded', async () => {
    fetched.length = 0;
    knob.throwTitle = 'Known One';
    await post('/admin/games/psn/refresh', { force: '1' });
    knob.throwTitle = '';
    const run = readDb().psn_last_run;
    assert.ok(run.failed.includes('Zzyzx Known One'));
    assert.ok(run.updated > 1, 'later games still processed');
  });
  await okAsync('stops at the time budget, reports the rest as remaining; a second press meanwhile is told it is busy', async () => {
    knob.delay = 150;
    const first = post('/admin/games/psn/refresh', { force: '1' });
    await new Promise(r => setTimeout(r, 100));
    const second = await post('/admin/games/psn/refresh', { force: '1' });
    assert.ok(second.headers.location.includes('msg=psn_busy'));
    const r1 = await first;
    knob.delay = 0;
    assert.ok(r1.headers.location.includes('msg=psn_refreshed'));
    const run = readDb().psn_last_run;
    const processed = run.updated + run.nomatch.length + run.failed.length;
    assert.ok(processed >= 1 && processed < 10, 'stopped early: ' + processed);
    assert.strictEqual(run.remaining, 71 - processed);
    const after = await post('/admin/games/psn/refresh', { force: '1' });
    assert.ok(after.headers.location.includes('msg=psn_refreshed'), 'flag cleared afterwards');
  });

  console.log('\nGame edit page');
  await okAsync('the edit page has the PlayStation section', async () => {
    const r = await call('GET', '/admin/edit/1', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('PlayStation info') && r.body.includes('name="psn_link"') && r.body.includes('name="size_gb"'));
    assert.ok(r.body.includes('value="update"') && r.body.includes('Remove PlayStation info'));
  });
  await okAsync('save link and size: stored, nothing fetched', async () => {
    fetched.length = 0;
    const r = await post('/admin/games/4/psn', { action: 'save', psn_link: 'https://store.playstation.com/en-us/concept/123', size_gb: '54.34' });
    assert.ok(r.headers.location.endsWith('/admin/edit/4?msg=psn_saved'));
    assert.strictEqual(gameById(4).psn_link, 'https://store.playstation.com/en-us/concept/123');
    assert.strictEqual(gameById(4).size_gb, 54.3);
    assert.strictEqual(fetched.length, 0);
  });
  await okAsync('update uses the pasted link and stores the result', async () => {
    const r = await post('/admin/games/4/psn', { action: 'update', psn_link: 'https://store.playstation.com/en-us/concept/123', size_gb: '54.3' });
    assert.ok(r.headers.location.endsWith('/admin/edit/4?msg=psn_updated'));
    assert.strictEqual(fetched[fetched.length - 1].link, 'https://store.playstation.com/en-us/concept/123');
    assert.strictEqual(gameById(4).psn.source, 'manual');
  });
  await okAsync('a link that is not a PlayStation Store link is refused and changes nothing', async () => {
    const r = await post('/admin/games/4/psn', { action: 'save', psn_link: 'https://evil.example/x', size_gb: '10' });
    assert.ok(r.headers.location.endsWith('/admin/edit/4?msg=psn_badlink'));
    assert.strictEqual(gameById(4).size_gb, 54.3);
  });
  await okAsync('a failed fetch reports it and keeps what was stored', async () => {
    const a = await post('/admin/games/5/psn', { action: 'update' });
    assert.ok(a.headers.location.endsWith('/admin/edit/5?msg=psn_failed'));
    assert.strictEqual(gameById(5).psn, undefined);
    assert.ok(gameById(4).psn, 'game 4 keeps its data');
  });
  await okAsync('size is validated and remove clears the stored info', async () => {
    await post('/admin/games/1/psn', { action: 'save', size_gb: '9999' });
    assert.strictEqual(gameById(1).size_gb, null);
    const r = await post('/admin/games/1/psn', { action: 'remove' });
    assert.ok(r.headers.location.endsWith('/admin/edit/1?msg=psn_removed'));
    assert.strictEqual(gameById(1).psn, null);
    assert.strictEqual((await post('/admin/games/999/psn', { action: 'save' })).headers.location, '/admin');
  });
  await okAsync('the banner text shows for a message', async () => {
    const r = await call('GET', '/admin/edit/4?msg=psn_nomatch', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes('PlayStation has no game with that name'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
