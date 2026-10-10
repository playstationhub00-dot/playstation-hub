// Run: node scripts/test-admin-upcoming-psn-page.js
//
// Coming soon → "Update from PlayStation": what the admin page shows — the
// button, the list to tick (including "Get PlayStation info"), the expired and
// up-to-date states, the toasts —
// and that the gold button's browser script agrees with the server's words.
// Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory
// sessions, a made-up admin password) with PlayStation's list stubbed, so
// nothing reaches PlayStation, a database, or the real admin.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');

const PORT = 4622;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-upcoming-psn-page-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
// Games 1 and 2 already have fresh PlayStation info; 3 (none) and 4 (older
// than 7 days, PlayStation id known) are offered under "Get PlayStation info".
const FRESH_PSN = { fetched_at: new Date().toISOString() };
const upcoming = [
  { id: 1, title: 'Zzyzx Moved Game', platform: 'PS5', release_date: '2026-10-29', created_at: '2026-09-01T00:00:00.000Z', nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1, psn: FRESH_PSN },
  { id: 2, title: 'Zzyzx Tba Game', platform: 'PS5', release_date: 'TBA', created_at: '2026-08-01T00:00:00.000Z', psn: FRESH_PSN },
  { id: 3, title: 'Zzyzx Needs Info', platform: 'PS5', release_date: 'TBA' },
  { id: 4, title: 'Zzyzx Old Info', platform: 'PS5', release_date: 'TBA', psn_concept_id: '444', psn: { fetched_at: '2026-01-01T00:00:00.000Z' } }
];
const games = [{ id: 50, title: 'Zzyzx Out Already', platform: 'PS5', nt_price_7d: 100 }];
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD, games, upcoming, nextUpcomingId: 10,
  site_settings: { upcoming_psn_skipped: ['103'] }
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

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
const tokenOf = r => (/psn_upcoming=([0-9a-f]+)/.exec(r.headers.location || '') || [])[1];
// The Coming soon sub-tab's own markup, so matches elsewhere on the page don't count.
const soonPanel = html => {
  const start = html.indexOf('data-gm-panel="soon"');
  assert.ok(start !== -1, 'Coming soon panel present');
  return html.slice(start, html.indexOf('data-gm-panel="requests"', start));
};

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const feedGame = (id, title, release_date, extra) => Object.assign({
  concept_id: String(id), title, raw_title: title, release_date, platform: 'PS5', genres: ['Action'],
  publisher: 'Zzyzx Pub', image_url: 'https://image.api.playstation.com/' + id + '.png'
}, extra || {});

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  const knob = {
    feed: [
      feedGame(101, 'Zzyzx New One', '2026-10-15', { genres: ['Role Playing Game (RPG)'] }),
      feedGame(102, 'Zzyzx <b>Bold</b> Name', '2026-11-01', { platform: 'PS4/PS5', image_url: '' }),
      feedGame(103, 'Zzyzx Skipped One', '2026-12-01'),
      feedGame(104, 'Zzyzx Moved Game', '2026-11-12'),
      feedGame(105, 'Zzyzx Tba Game', '2027-01-15'),
      feedGame(106, 'Zzyzx Out Already', '2027-02-01')
    ]
  };
  require('../lib/upcoming-psn-feed').fetchUpcoming = async () => ({ ok: true, games: knob.feed.slice() });
  require('../lib/psn-game').fetchGameInfo = async () => ({ ok: true, psn: { description: 'Stub', screenshots: [], fetched_at: new Date().toISOString() } });
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in to the throwaway instance');
  const get = p => call('GET', p, { headers: { Cookie: cookie } });
  const refresh = () => call('POST', '/admin/upcoming/psn/refresh', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: '' });
  const post = (p, body) => call('POST', p, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body });

  console.log('\nbutton');
  await okAsync('Coming soon has the Update button, and no list until a check', async () => {
    const soon = soonPanel((await get('/admin?tab=games')).body);
    assert.ok(soon.includes('action="/admin/upcoming/psn/refresh"'));
    assert.ok(soon.includes('🔄 Update from PlayStation'));
    assert.ok(!soon.includes('id="gmpForm"'));
  });

  const token = tokenOf(await refresh());
  const page = (await get('/admin?tab=games&psn_upcoming=' + token)).body;
  const soon = soonPanel(page);
  console.log('\nthe list');
  ok('new games ticked, skipped ones unticked and last, each with an editable title, date and platform', () => {
    assert.ok(soon.includes('New on PlayStation (3)'));
    assert.ok(/name="add" value="101"[^>]*data-gmp-add checked/.test(soon));
    assert.ok(/name="add" value="102"[^>]*data-gmp-add checked/.test(soon));
    assert.ok(/name="add" value="103"[^>]*data-gmp-add aria-label/.test(soon), '103 unticked');
    assert.ok(soon.indexOf('value="102"') < soon.indexOf('value="103"'), 'skipped last');
    assert.ok(soon.includes('Skipped before · Zzyzx Pub · Action'));
    assert.ok(soon.includes('name="title_101" value="Zzyzx New One"'));
    assert.ok(soon.includes('Zzyzx Pub · RPG'));
    assert.ok(soon.includes('Oct 15, 2026') && soon.includes('PS4/PS5'));
    assert.ok(soon.includes('src="https://image.api.playstation.com/101.png"'));
  });
  ok('titles from PlayStation are escaped', () => {
    assert.ok(soon.includes('Zzyzx &lt;b&gt;Bold&lt;/b&gt; Name'));
    assert.ok(!soon.includes('<b>Bold</b>'));
  });
  ok('prices and slots are pre-filled from the last upcoming game added, and say so', () => {
    for (const [k, v] of [['nt_price_7d', 349], ['nt_price_30d', 1099], ['tr_price_7d', 449], ['tr_price_30d', 1299], ['non_trophy_slots', 3], ['trophy_slots', 1]]) {
      assert.ok(soon.includes('name="' + k + '" min="0" step="1" value="' + v + '"'), k);
    }
    assert.ok(soon.includes('Filled in from Zzyzx Moved Game, the last upcoming game you added.'));
  });
  ok('date changes, ticked, old → new', () => {
    assert.ok(soon.includes('Release date changed (2)'));
    assert.ok(/name="date" value="1"[^>]*checked/.test(soon));
    assert.ok(soon.includes('Oct 29, 2026 →') && soon.includes('Nov 12, 2026'));
    assert.ok(soon.includes('TBA →') && soon.includes('Jan 15, 2027'));
  });
  ok('get PlayStation info: games with none or old info, ticked, matched or searched by name', () => {
    assert.ok(soon.includes('Get PlayStation info (2)'));
    assert.ok(/name="info" value="3"[^>]*data-gmp-info checked/.test(soon));
    assert.ok(/name="info" value="4"[^>]*data-gmp-info checked/.test(soon));
    assert.ok(!/name="info" value="1"/.test(soon) && !/name="info" value="2"/.test(soon), 'fresh info is not offered');
    const three = soon.slice(soon.indexOf('name="info" value="3"'), soon.indexOf('name="info" value="4"'));
    assert.ok(three.includes('Zzyzx Needs Info') && three.includes('Will search by name'));
    assert.ok(soon.slice(soon.indexOf('name="info" value="4"')).includes('Matched on PlayStation'));
    assert.ok(soon.includes('Trailer, screenshots, rating and game info from PlayStation. Your own description and pictures stay.'));
  });
  ok('already on the site, the gold button\'s words and the cancel form', () => {
    assert.ok(soon.includes('Already on your site (3)</b> · Zzyzx Moved Game, Zzyzx Tba Game, Zzyzx Out Already'));
    assert.ok(soon.includes('data-gmp-apply>Add 2 games · update 2 dates · get info for 2 games</button>'));
    assert.ok(soon.includes('name="token" value="' + token + '"'));
    assert.ok(soon.includes('action="/admin/upcoming/psn/cancel" id="gmpCancel" data-no-loading="1"'));
  });

  console.log('\nother states');
  await okAsync('an expired or unknown list says so and offers the button again', async () => {
    const s = soonPanel((await get('/admin?tab=games&psn_upcoming=deadbeef')).body);
    assert.ok(s.includes('That list expired'));
    assert.ok(!s.includes('id="gmpForm"'));
  });
  await okAsync('nothing new → up to date, no gold button', async () => {
    knob.feed = [feedGame(104, 'Zzyzx Moved Game', '2026-10-29')];
    // Games 3 and 4 get their info first, so nothing at all is left to do.
    const filled = await post('/admin/upcoming/psn/apply', form({ token: tokenOf(await refresh()), info: '3' }) + '&info=4');
    assert.ok(filled.headers.location.includes('msg=psn_upcoming_applied&added=0&dates=0&info=2&missing=0'));
    const s = soonPanel((await get('/admin?tab=games&psn_upcoming=' + tokenOf(await refresh()))).body);
    assert.ok(s.includes("You're up to date — nothing new on PlayStation."));
    assert.ok(!s.includes('data-gmp-apply'));
    assert.ok(s.includes('>Close</button>'));
  });
  ok('the page carries the toasts, the loading words and the script', () => {
    assert.ok(page.includes("psn_upcoming_applied:'✅ {summary}'"));
    assert.ok(page.includes("psnCount('info') ? 'got info for ' + psnPlural(psnCount('info'), 'game') : ''"));
    assert.ok(page.includes("psn_upcoming_preview:'games'"));
    assert.ok(page.includes("'/admin/upcoming/psn/apply':'⏳ Adding games from PlayStation — this can take a minute...'"));
    assert.ok(page.includes('<script src="/js/admin-upcoming-psn.js?v='));
  });

  console.log('\nbrowser scripts');
  ok('admin-upcoming-psn.js words match lib/upcoming-psn.js for every count', () => {
    const sandbox = { console };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin-upcoming-psn.js'), 'utf8'), sandbox);
    const { applyLabel } = require('../lib/upcoming-psn');
    for (let a = 0; a < 4; a++) for (let d = 0; d < 4; d++) for (let i = 0; i < 4; i++) {
      assert.strictEqual(sandbox.__gmpApplyLabel(a, d, i), applyLabel(a, d, i), a + '/' + d + '/' + i);
    }
  });
  ok('admin-games.js opens Coming soon for every psn_upcoming_ message', () => {
    const sandbox = { console };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin-games.js'), 'utf8'), sandbox);
    for (const m of ['psn_upcoming_preview', 'psn_upcoming_applied', 'psn_upcoming_partial', 'psn_upcoming_nothing', 'psn_upcoming_cancelled']) {
      assert.strictEqual(sandbox.__gamesFilter.subtabForMessage(m), 'soon', m);
    }
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
