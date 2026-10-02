// Run: node scripts/test-visitor-tracking.js
//
// Boots the real server in-process (the pattern of scripts/test-psplus-routes.js)
// against a throwaway DATA_DIR and a blank MONGODB_URI, then checks which
// requests become visitor rows / sessions and how the two tracking beacons
// (/api/track/message, /api/track/search-miss) store or drop what they get.
// The project's own games.json and every database stay untouched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4592;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'visitor-tracking-'));
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  games: [{ id: 1, title: 'Zzyzx Test Quest', platform: 'PS5', nt_price_7d: 100, nt_price_30d: 300 }]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FB_BOT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const SID_A = 'a'.repeat(32);
let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method, headers, timeout: 8000 }, res => {
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
const readDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const setCookie = r => (r.headers['set-cookie'] || []).join(';');
const beacon = (o, extra) => ({
  headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': IPHONE, Cookie: 'ph_sid=' + SID_A }, extra || {}),
  body: JSON.stringify(o)
});

async function main() {
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/browse', { headers: { 'User-Agent': IPHONE } }); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');
  const baseRows = readDb().visitors.length; // the readiness probe above is a human GET

  console.log('\nvisitor middleware');

  await okAsync('a human page view is recorded and gets a session cookie', async () => {
    const r = await call('GET', '/how-it-works', { headers: { 'User-Agent': IPHONE } });
    assert.ok(/ph_sid=/.test(setCookie(r)), 'cookie issued');
    const rows = readDb().visitors;
    assert.strictEqual(rows.length, baseRows + 1);
    assert.strictEqual(rows[rows.length - 1].path, '/how-it-works');
  });

  await okAsync('a robot page view records nothing, issues no cookie, and is tallied', async () => {
    const before = readDb();
    const r = await call('GET', '/', { headers: { 'User-Agent': FB_BOT } });
    assert.ok(!/ph_sid=/.test(setCookie(r)), 'no cookie for a robot');
    const after = readDb();
    assert.strictEqual(after.visitors.length, before.visitors.length);
    const day = new Date().toISOString().slice(0, 10);
    assert.strictEqual((after.visitor_skips[day] || 0) - ((before.visitor_skips || {})[day] || 0), 1);
  });

  await okAsync('webhook posts record nothing, issue no cookie, and are tallied', async () => {
    const before = readDb();
    const day = new Date().toISOString().slice(0, 10);
    const a = await call('POST', '/webhook', { headers: { 'Content-Type': 'application/json', 'User-Agent': IPHONE }, body: '{}' });
    const b = await call('POST', '/webhooks/paymongo', { headers: { 'Content-Type': 'application/json', 'User-Agent': 'PayMongo' }, body: '{}' });
    assert.ok(!/ph_sid=/.test(setCookie(a)) && !/ph_sid=/.test(setCookie(b)));
    const after = readDb();
    assert.strictEqual(after.visitors.length, before.visitors.length);
    assert.strictEqual((after.visitor_skips[day] || 0) - ((before.visitor_skips || {})[day] || 0), 2);
  });

  await okAsync('/api/search-index by a human records nothing, issues no cookie, is not tallied', async () => {
    const before = readDb();
    const day = new Date().toISOString().slice(0, 10);
    const r = await call('GET', '/api/search-index', { headers: { 'User-Agent': IPHONE } });
    assert.strictEqual(r.status, 200);
    assert.ok(!/ph_sid=/.test(setCookie(r)));
    const after = readDb();
    assert.strictEqual(after.visitors.length, before.visitors.length);
    assert.strictEqual(after.visitor_skips[day] || 0, (before.visitor_skips || {})[day] || 0);
  });

  await okAsync('a human form post keeps a session but adds no visit row', async () => {
    const before = readDb().visitors.length;
    const r = await call('POST', '/order/create', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': IPHONE },
      body: 'game_id=999999&account_type=nt&days=7&fb_name=Test'
    });
    assert.ok(/ph_sid=/.test(setCookie(r)), 'session cookie still issued');
    assert.strictEqual(readDb().visitors.length, before);
  });

  console.log('\nPOST /api/track/message');

  await okAsync('a tap on a game page is stored with the game slug', async () => {
    const r = await call('POST', '/api/track/message', beacon({ page: '/game/zzyzx-test-quest?x=1', source: 'game' }));
    assert.strictEqual(r.status, 204);
    const taps = readDb().message_taps;
    assert.strictEqual(taps.length, 1);
    assert.deepStrictEqual(Object.assign({}, taps[0], { date: 0, time: 0 }),
      { date: 0, time: 0, session_id: SID_A, page: '/game/zzyzx-test-quest', game: 'zzyzx-test-quest', source: 'game' });
  });

  await okAsync('the same tap again within 60 seconds is dropped', async () => {
    await call('POST', '/api/track/message', beacon({ page: '/game/zzyzx-test-quest', source: 'game' }));
    assert.strictEqual(readDb().message_taps.length, 1);
  });

  await okAsync('a different source is stored; an unknown game or a non-game page gets game null', async () => {
    await call('POST', '/api/track/message', beacon({ page: '/game/no-such-game', source: 'nav' }));
    await call('POST', '/api/track/message', beacon({ page: '/', source: 'fab' }));
    const taps = readDb().message_taps;
    assert.strictEqual(taps.length, 3);
    assert.strictEqual(taps[1].game, null);
    assert.strictEqual(taps[2].game, null);
    assert.strictEqual(taps[2].source, 'fab');
  });

  await okAsync('a bad page is ignored; a bad source is stored as other', async () => {
    await call('POST', '/api/track/message', beacon({ page: 'https://evil.test', source: 'game' }));
    await call('POST', '/api/track/message', beacon({ page: '/browse', source: '<x>' }));
    const taps = readDb().message_taps;
    assert.strictEqual(taps.length, 4);
    assert.strictEqual(taps[3].source, 'other');
  });

  await okAsync('robots and visitors with no session cookie are ignored (still 204)', async () => {
    const a = await call('POST', '/api/track/message', beacon({ page: '/', source: 'nav' }, { 'User-Agent': FB_BOT, Cookie: 'ph_sid=' + 'b'.repeat(32) }));
    const nocookie = beacon({ page: '/', source: 'hero' });
    delete nocookie.headers.Cookie;
    const b = await call('POST', '/api/track/message', nocookie);
    assert.strictEqual(a.status, 204);
    assert.strictEqual(b.status, 204);
    assert.ok(!/ph_sid=/.test(setCookie(b)), 'the beacon never issues a cookie');
    assert.strictEqual(readDb().message_taps.length, 4);
  });

  console.log('\nPOST /api/track/search-miss');

  await okAsync('a missed search is stored normalized, once per session', async () => {
    await call('POST', '/api/track/search-miss', beacon({ q: '  Elden   RING ' }));
    await call('POST', '/api/track/search-miss', beacon({ q: 'elden ring' }));
    await call('POST', '/api/track/search-miss', beacon({ q: 'ab' }));
    const rows = readDb().search_misses;
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].q, 'elden ring');
    assert.strictEqual(rows[0].session_id, SID_A);
  });

  await okAsync('robots and cookie-less visitors are ignored', async () => {
    await call('POST', '/api/track/search-miss', beacon({ q: 'hollow knight' }, { 'User-Agent': FB_BOT }));
    const nocookie = beacon({ q: 'hollow knight' });
    delete nocookie.headers.Cookie;
    await call('POST', '/api/track/search-miss', nocookie);
    assert.strictEqual(readDb().search_misses.length, 1);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
