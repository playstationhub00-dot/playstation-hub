// Run: node scripts/test-admin-upcoming-psn.js
//
// Coming soon → "Update from PlayStation": the refresh, apply and cancel
// routes. Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI,
// in-memory sessions, a made-up admin password) with PlayStation's list, the
// store-page reader and the image saver replaced by stubs, so nothing reaches
// PlayStation, a database, or the real admin.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4621;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-upcoming-psn-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const upcoming = [
  { id: 1, title: 'Zzyzx Moved Game', platform: 'PS5', release_date: '2026-10-29', created_at: '2026-09-01T00:00:00.000Z', nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1, cover_image: '/uploads/keep.webp' },
  { id: 2, title: 'Zzyzx Tba Game', platform: 'PS5', release_date: 'TBA', created_at: '2026-08-01T00:00:00.000Z' },
  { id: 3, title: 'Zzyzx Same Date', platform: 'PS5', release_date: '2026-12-03', created_at: '2026-07-01T00:00:00.000Z' }
];
const games = [{ id: 50, title: 'Zzyzx Out Already', platform: 'PS5', nt_price_7d: 100 }];
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({ admin_password: TEST_PASSWORD, games, upcoming, nextUpcomingId: 10 }));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const readDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const upcomingById = id => readDb().upcoming.find(x => x.id === id);

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
// Arrays become repeated fields, like ticked checkboxes.
const form = o => Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(x => encodeURIComponent(k) + '=' + encodeURIComponent(x))).join('&');
const tokenOf = r => (/psn_upcoming=([0-9a-f]+)/.exec(r.headers.location || '') || [])[1];

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const feedGame = (id, title, release_date, extra) => Object.assign({
  concept_id: String(id), title, raw_title: title, release_date, platform: 'PS5', genres: ['Action'],
  publisher: 'Pub', image_url: 'https://image.api.playstation.com/' + id + '.png'
}, extra || {});

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  // Stub PlayStation. knob.feed is what the next refresh sees.
  const knob = { feedOk: true, delay: 0 };
  knob.feed = [
    feedGame(101, 'Zzyzx New One', '2026-10-15', { genres: ['Role Playing Game (RPG)'] }),
    feedGame(102, 'Zzyzx New Two', '2026-11-01', { platform: 'PS4/PS5' }),
    feedGame(103, 'Zzyzx Broken Images', '2026-12-01'),
    feedGame(104, 'Zzyzx Moved Game', '2026-11-12'),
    feedGame(105, 'Zzyzx Tba Game', '2027-01-15'),
    feedGame(106, 'Zzyzx Same Date', '2026-12-03'),
    feedGame(107, 'Zzyzx Out Already', '2027-02-01')
  ];
  const feedLib = require('../lib/upcoming-psn-feed');
  feedLib.fetchUpcoming = async () => (knob.feedOk ? { ok: true, games: knob.feed.slice() } : { ok: false, games: [], reason: 'timeout' });
  const infoCalls = [];
  require('../lib/psn-game').fetchGameInfo = async game => {
    infoCalls.push(game.psn_link);
    if (knob.delay) await new Promise(r => setTimeout(r, knob.delay));
    const id = game.psn_link.split('/').pop();
    if (id === '103') return { ok: false, reason: 'timeout' };
    return { ok: true, psn: { description: 'About ' + id, genres: [], screenshots: ['https://image.api.playstation.com/s1-' + id + '.jpg', 'https://image.api.playstation.com/s2-' + id + '.jpg'] } };
  };
  const saved = [];
  require('../lib/remote-image').saveRemoteImage = async (url, opts) => {
    saved.push({ url, uploadsDir: opts && opts.uploadsDir });
    return url.includes('103') ? '' : '/uploads/psn-' + url.split('/').pop() + '.webp';
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\naccess');
  await okAsync('all three routes need the admin login', async () => {
    for (const p of ['refresh', 'apply', 'cancel']) {
      const r = await call('POST', '/admin/upcoming/psn/' + p, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: '' });
      assert.strictEqual(r.status, 302, p);
      assert.ok(r.headers.location.includes('/admin/login'), p);
    }
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in to the throwaway instance');
  const post = (p, o) => call('POST', p, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o || {}) });
  const refresh = () => post('/admin/upcoming/psn/refresh');
  const prices = { nt_price_7d: '299', nt_price_30d: '999', tr_price_7d: '399', tr_price_30d: '1199', non_trophy_slots: '2', trophy_slots: '1' };

  console.log('\nrefresh');
  await okAsync('PlayStation unreachable → message, nothing stored', async () => {
    knob.feedOk = false;
    const r = await refresh();
    knob.feedOk = true;
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_unreachable');
    assert.strictEqual(readDb().upcoming.length, 3);
  });
  let token;
  await okAsync('a check opens the list on the Games tab under a token', async () => {
    const r = await refresh();
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.startsWith('/admin?tab=games&msg=psn_upcoming_preview&psn_upcoming='));
    token = tokenOf(r);
    assert.ok(/^[0-9a-f]{24}$/.test(token));
    assert.strictEqual(readDb().upcoming.length, 3, 'nothing saved by a check');
  });

  console.log('\napply');
  await okAsync('nothing ticked → message, the list stays open', async () => {
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_nothing&psn_upcoming=' + token);
  });
  await okAsync('an unknown token → expired, nothing added', async () => {
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token: 'deadbeef', add: ['101'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_expired');
    assert.strictEqual(readDb().upcoming.length, 3);
  });
  await okAsync('apply adds the ticked games with the typed prices, PlayStation details and saved images', async () => {
    const r = await post('/admin/upcoming/psn/apply', Object.assign({
      token, add: ['101', '103'], title_101: 'Zzyzx New One (Owner Title)', date: ['1', '2']
    }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_partial&added=2&dates=2', 'game 103 has no cover or description');
    const added = readDb().upcoming.filter(x => x.id >= 10);
    assert.deepStrictEqual(added.map(x => [x.id, x.title, x.psn_concept_id]), [[10, 'Zzyzx New One (Owner Title)', '101'], [11, 'Zzyzx Broken Images', '103']]);
    const one = added[0];
    assert.strictEqual(one.release_date, '2026-10-15');
    assert.strictEqual(one.platform, 'PS5');
    assert.strictEqual(one.genre, 'RPG');
    assert.strictEqual(one.description, 'About 101');
    assert.strictEqual(one.cover_image, '/uploads/psn-101.png.webp');
    assert.deepStrictEqual(one.gallery, ['/uploads/psn-s1-101.jpg.webp', '/uploads/psn-s2-101.jpg.webp']);
    assert.deepStrictEqual([one.nt_price_7d, one.nt_price_30d, one.tr_price_7d, one.tr_price_30d, one.non_trophy_slots, one.trophy_slots, one.rank, one.buy_nt_price], [299, 999, 399, 1199, 2, 1, 0, 0]);
    assert.strictEqual(added[1].description, '');
    assert.strictEqual(added[1].cover_image, '');
    assert.strictEqual(added[1].genre, 'Action', 'index genre when the store page failed');
    assert.ok(infoCalls.includes('https://store.playstation.com/en-us/concept/101'));
    assert.ok(saved.length && saved.every(s => s.uploadsDir === path.join(DATA_DIR, 'uploads')), 'images go to the uploads folder');
  });
  await okAsync('ticked date changes update only the date (and link the PlayStation id)', async () => {
    const moved = upcomingById(1);
    assert.strictEqual(moved.release_date, '2026-11-12');
    assert.strictEqual(moved.psn_concept_id, '104');
    assert.deepStrictEqual([moved.nt_price_7d, moved.cover_image, moved.title], [349, '/uploads/keep.webp', 'Zzyzx Moved Game']);
    assert.strictEqual(upcomingById(2).release_date, '2027-01-15');
    assert.strictEqual(upcomingById(3).release_date, '2026-12-03');
  });
  await okAsync('unticked games are remembered as skipped', async () => {
    assert.deepStrictEqual(readDb().site_settings.upcoming_psn_skipped, ['102']);
  });
  await okAsync('the same token again adds nothing', async () => {
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token, add: ['101', '102'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_expired');
    assert.strictEqual(readDb().upcoming.length, 5);
  });
  await okAsync('the next check offers only what is still new; ticking a skipped game adds it and un-skips it', async () => {
    const t2 = tokenOf(await refresh());
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token: t2, add: ['102'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_applied&added=1&dates=0');
    assert.deepStrictEqual(readDb().upcoming.filter(x => x.id >= 10).map(x => x.psn_concept_id), ['101', '103', '102']);
    assert.strictEqual(readDb().upcoming.find(x => x.psn_concept_id === '102').platform, 'PS4/PS5');
    assert.deepStrictEqual(readDb().site_settings.upcoming_psn_skipped, []);
  });
  await okAsync('a game added by hand after the check is not added again', async () => {
    knob.feed.push(feedGame(108, 'Zzyzx Hand Added', '2027-03-01'));
    const t3 = tokenOf(await refresh());
    await post('/admin/upcoming/add', { title: 'Zzyzx Hand Added', platform: 'PS5', release_date: '2027-03-01' });
    const before = readDb().upcoming.length;
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token: t3, add: ['108'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_applied&added=0&dates=0');
    assert.strictEqual(readDb().upcoming.length, before);
  });
  await okAsync('one apply at a time: a second while the first downloads is told it is busy', async () => {
    knob.feed.push(feedGame(109, 'Zzyzx Slow One', '2027-03-02'), feedGame(110, 'Zzyzx Slow Two', '2027-03-03'));
    const ta = tokenOf(await refresh());
    const tb = tokenOf(await refresh());
    knob.delay = 300;
    const first = post('/admin/upcoming/psn/apply', Object.assign({ token: ta, add: ['109'] }, prices));
    await new Promise(r => setTimeout(r, 100));
    const second = await post('/admin/upcoming/psn/apply', Object.assign({ token: tb, add: ['110'] }, prices));
    assert.strictEqual(second.headers.location, '/admin?tab=games&msg=psn_upcoming_busy');
    const r1 = await first;
    knob.delay = 0;
    assert.ok(r1.headers.location.includes('msg=psn_upcoming_applied&added=1'));
    const after = await post('/admin/upcoming/psn/apply', Object.assign({ token: tb, add: ['110'] }, prices));
    assert.ok(after.headers.location.includes('msg=psn_upcoming_applied&added=1'), 'flag cleared afterwards');
  });

  console.log('\ncancel');
  await okAsync('cancel drops the list', async () => {
    const t = tokenOf(await refresh());
    const r = await post('/admin/upcoming/psn/cancel', { token: t });
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_cancelled');
    const again = await post('/admin/upcoming/psn/apply', Object.assign({ token: t, add: ['101'] }, prices));
    assert.strictEqual(again.headers.location, '/admin?tab=games&msg=psn_upcoming_expired');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
