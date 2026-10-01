# Visitor → Messenger Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin funnel count only real visitors and Messenger taps, add a "What game are you looking for?" search to the homepage, and make the game page's main button "Message us about this game".

**Architecture:** Pure helper modules (`lib/visitor-filter.js`, `lib/tracking.js`, `lib/visitor-funnel.js`, and browser-side `public/js/*-core.js`-style files that also `require()` in Node) hold the logic and are unit-tested. `server.js` gets a thinner visitor middleware, two beacon routes and a rewired dashboard block; views gain one partial and a reworked rent box. New data lives in three lowdb keys (`visitor_skips`, `message_taps`, `search_misses`).

**Tech Stack:** Node, Express, EJS, lowdb v1 (`games.json`), plain browser JS, no new dependencies. Tests are plain `node scripts/test-*.js` files using `assert`.

Spec: `docs/superpowers/specs/2026-10-02-visitor-to-messenger-design.md`

## Global Constraints

- Work directly on `main`; commit per task; **push only when the owner says "push"**.
- Commit messages end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- **Line endings** (use the Edit tool or the provided edit scripts; verify with `file`): `server.js` is CRLF with a UTF-8 BOM; `views/partials/nav.ejs`, `views/partials/footer.ejs`, `views/partials/admin/dashboard/site.ejs` and `public/css/style.css` are CRLF; `views/index.ejs` is LF with a BOM; `views/game-detail.ejs`, `public/js/game-detail.js`, `lib/*` and every new file are LF.
- **Tests never touch real data:** boot tests use a temp `DATA_DIR` and `MONGODB_URI=''`; they never read or write the project's `games.json` and never reach a database. Never log in to the real admin or production site. (`scripts/test-admin-visitors-render.js` logs in to its own throwaway instance with a password it generates.)
- New tracking never issues a cookie, ignores robots and visitors with no `ph_sid` cookie, and always answers `204`.
- Messenger links stay `http://m.me/PlaystationHub00`.
- Percentages: "Viewed a game", "Messaged us" and "Ordered on website" are shares of **Landed**; "Paid" is a share of Ordered.
- Allowed `source` values for a Message Us tap: `nav, fab, hero, footer, game, search, search-empty, other`.
- Caps: `message_taps` 50,000 rows; `search_misses` 20,000 rows; `visitors` stays 200,000.
- Known unrelated failure: `scripts/test-requests-page.js` fails before and after this work. Report it, do not fix it.
- Helper edit scripts are scratch files in `.superpowers/tmp-edits/` (git-excluded). Never commit them; delete the folder at the end of the task that used it (Task 7 does a final cleanup check).

## File Structure

| File | Responsibility |
|---|---|
| `lib/visitor-filter.js` (new) | Classify a request as `page` / `action` / `bot` / `system` |
| `lib/tracking.js` (new) | Validate and de-duplicate the two beacons' input |
| `lib/visitor-funnel.js` (new) | Session summaries, funnel windows, "asked-about" and "misses" lists for the dashboard |
| `public/js/message-taps.js` (new) | Global listener: tap on any `m.me/PlaystationHub00` link → beacon |
| `public/js/dashboard-visitors.js` (new) | Markup for the dashboard's visitor cards |
| `public/js/home-search-core.js` (new) | Pure matching / status text for the homepage search |
| `public/js/home-search.js` (new) | Draws the homepage search |
| `public/js/messenger-text.js` (new) | The prefilled Messenger message for a game page |
| `views/partials/home-search.ejs`, `public/css/home-search.css` (new) | Homepage strip |
| `server.js` | Middleware, beacon routes, `slotsFreeFor`, dashboard block |
| `views/partials/nav.ejs`, `footer.ejs` | Load the tap script; tag links with `data-track-source` |
| `views/partials/admin/dashboard/site.ejs`, `public/css/style.css` | Dashboard cards + styles; game-page rent box styles |
| `views/index.ejs` | Include the strip + stylesheet |
| `views/game-detail.ejs`, `public/js/game-detail.js` | Messenger-first rent box |

---

### Task 1: Visitor request classifier

**Files:**
- Create: `lib/visitor-filter.js`
- Test: `scripts/test-visitor-filter.js`

**Interfaces:**
- Produces: `isBotUserAgent(ua: string|undefined): boolean`, `isWebhookPath(path): boolean` (`/webhook`, `/webhooks/*`), `isSystemPath(path): boolean` (webhook paths + `/api/*`), `classifyRequest({ method, path, userAgent }): 'system'|'bot'|'action'|'page'`. Tasks 2 and 4 consume these.

- [ ] **Step 1: Write the test**

Create `scripts/test-visitor-filter.js`:

````js
// Run: node scripts/test-visitor-filter.js
const assert = require('assert');
const f = require('../lib/visitor-filter');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FB_IAB = 'Mozilla/5.0 (Linux; Android 13; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.40.108;]';

console.log('\nisBotUserAgent');
ok('empty / missing user-agent is a bot', () => {
  assert.strictEqual(f.isBotUserAgent(''), true);
  assert.strictEqual(f.isBotUserAgent(undefined), true);
  assert.strictEqual(f.isBotUserAgent('   '), true);
});
ok('robots and preview fetchers are bots', () => {
  for (const ua of [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A', 'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)', 'UptimeRobot/2.0', 'curl/8.4.0',
    'python-requests/2.31.0', 'Mozilla/5.0 HeadlessChrome/124.0', 'Pingdom.com_bot_version_1.4',
    'Go-http-client/2.0', 'node-fetch/1.0', 'TelegramBot (like TwitterBot)'
  ]) assert.strictEqual(f.isBotUserAgent(ua), true, ua);
});
ok('real phone browsers, including the Facebook in-app browser, are not bots', () => {
  assert.strictEqual(f.isBotUserAgent(IPHONE), false);
  assert.strictEqual(f.isBotUserAgent(FB_IAB), false);
});

console.log('\npaths');
ok('webhooks are webhook paths; /api/* is system but not a webhook', () => {
  assert.strictEqual(f.isWebhookPath('/webhook'), true);
  assert.strictEqual(f.isWebhookPath('/webhooks/paymongo'), true);
  assert.strictEqual(f.isWebhookPath('/api/search-index'), false);
  assert.strictEqual(f.isSystemPath('/api/search-index'), true);
  assert.strictEqual(f.isSystemPath('/api/track/message'), true);
  assert.strictEqual(f.isSystemPath('/browse'), false);
  assert.strictEqual(f.isSystemPath('/webhookish'), false);
});

console.log('\nclassifyRequest');
ok('classes', () => {
  assert.strictEqual(f.classifyRequest({ method: 'GET', path: '/browse', userAgent: IPHONE }), 'page');
  assert.strictEqual(f.classifyRequest({ method: 'HEAD', path: '/', userAgent: IPHONE }), 'page');
  assert.strictEqual(f.classifyRequest({ method: 'POST', path: '/order/create', userAgent: IPHONE }), 'action');
  assert.strictEqual(f.classifyRequest({ method: 'GET', path: '/', userAgent: 'facebookexternalhit/1.1' }), 'bot');
  assert.strictEqual(f.classifyRequest({ method: 'GET', path: '/api/search-index', userAgent: IPHONE }), 'system');
  assert.strictEqual(f.classifyRequest({ method: 'POST', path: '/webhooks/paymongo', userAgent: '' }), 'system');
  assert.strictEqual(f.classifyRequest({ method: undefined, path: '/', userAgent: IPHONE }), 'page');
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-visitor-filter.js`
Expected: FAIL — `Cannot find module '../lib/visitor-filter'`.

- [ ] **Step 3: Write the module**

Create `lib/visitor-filter.js`:

````js
// Decides which incoming requests count as visitors. Robots, link-preview
// fetchers, uptime pings and system traffic (payment / Messenger webhooks and
// the site's own /api calls) must not become "sessions" on the dashboard.
// Pure: no database, no Express — server.js calls classifyRequest() per request.

// Case-insensitive fragments of known non-human user-agents.
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegram|bingpreview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|go-http-client|okhttp|axios|node-fetch/i;

function isBotUserAgent(ua) {
  const s = String(ua == null ? '' : ua).trim();
  return !s || BOT_UA.test(s);
}

function isWebhookPath(p) {
  const s = String(p == null ? '' : p);
  return s === '/webhook' || s.startsWith('/webhooks/');
}

// Webhooks, plus /api/* (called by real browsers for search, tracking, etc. —
// never a page view).
function isSystemPath(p) {
  const s = String(p == null ? '' : p);
  return isWebhookPath(s) || s.startsWith('/api/');
}

// 'system' | 'bot' | 'action' (a human form post etc.) | 'page' (a human page view)
function classifyRequest({ method, path, userAgent }) {
  if (isSystemPath(path)) return 'system';
  if (isBotUserAgent(userAgent)) return 'bot';
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' ? 'page' : 'action';
}

module.exports = { isBotUserAgent, isWebhookPath, isSystemPath, classifyRequest };
````

- [ ] **Step 4: Run it and watch it pass**

Run: `node scripts/test-visitor-filter.js`
Expected: `5 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/visitor-filter.js scripts/test-visitor-filter.js
git commit -m "Classify requests so robots and system traffic are not visitors

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Honest visitor recording and the two tracking beacons

**Files:**
- Create: `lib/tracking.js`, `scripts/test-tracking.js`, `scripts/test-visitor-tracking.js`
- Modify: `server.js` (CRLF + BOM — via the edit script below)

**Interfaces:**
- Consumes: Task 1's `visitorFilter.classifyRequest`, `isWebhookPath`, `isBotUserAgent`.
- Produces: `tracking.cleanSource(s)`, `cleanPage(p)`, `gameSlugFromPage(page)`, `cleanQuery(q)`, `recentDuplicate(rows, key, nowMs, windowMs)`; in `server.js`: lowdb keys `visitor_skips` (`{ 'YYYY-MM-DD': n }`), `message_taps` (`{ date, time, session_id, page, game, source }`), `search_misses` (`{ date, time, session_id, q }`), `pushCapped(key, row, cap)`, `countSkippedVisit()`, routes `POST /api/track/message` and `POST /api/track/search-miss` (both `204`). Tasks 3, 4 and 5 consume these.

- [ ] **Step 1: Write the unit test for `lib/tracking.js`**

Create `scripts/test-tracking.js`:

````js
// Run: node scripts/test-tracking.js
const assert = require('assert');
const t = require('../lib/tracking');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

console.log('\ncleanSource');
ok('allowed values pass, anything else becomes other', () => {
  assert.strictEqual(t.cleanSource('game'), 'game');
  assert.strictEqual(t.cleanSource('search-empty'), 'search-empty');
  assert.strictEqual(t.cleanSource('<script>'), 'other');
  assert.strictEqual(t.cleanSource(undefined), 'other');
});

console.log('\ncleanPage');
ok('keeps a site path and drops query / hash', () => {
  assert.strictEqual(t.cleanPage('/game/god-of-war?x=1#top'), '/game/god-of-war');
  assert.strictEqual(t.cleanPage('/'), '/');
});
ok('rejects non-paths, protocol-relative urls and long values', () => {
  assert.strictEqual(t.cleanPage('https://evil.test/'), null);
  assert.strictEqual(t.cleanPage('//evil.test/'), null);
  assert.strictEqual(t.cleanPage(42), null);
  assert.strictEqual(t.cleanPage('/' + 'a'.repeat(200)), null);
});

console.log('\ngameSlugFromPage');
ok('extracts the slug of a game page only', () => {
  assert.strictEqual(t.gameSlugFromPage('/game/resident-evil-requiem'), 'resident-evil-requiem');
  assert.strictEqual(t.gameSlugFromPage('/game/resident-evil-requiem/'), 'resident-evil-requiem');
  assert.strictEqual(t.gameSlugFromPage('/browse'), null);
  assert.strictEqual(t.gameSlugFromPage('/game/'), null);
  assert.strictEqual(t.gameSlugFromPage('/upcoming/foo-3'), null);
});

console.log('\ncleanQuery');
ok('normalizes, limits and rejects short queries', () => {
  assert.strictEqual(t.cleanQuery('  God   OF\tWar '), 'god of war');
  assert.strictEqual(t.cleanQuery('ab'), '');
  assert.strictEqual(t.cleanQuery(7), '');
  assert.strictEqual(t.cleanQuery('x'.repeat(100)).length, 60);
});

console.log('\nrecentDuplicate');
ok('same key inside the window is a duplicate; outside or different is not', () => {
  const now = Date.parse('2026-10-02T10:00:00.000Z');
  const rows = [
    { time: '2026-10-02T09:58:00.000Z', session_id: 's1', game: 'a', source: 'game' },
    { time: '2026-10-02T09:59:40.000Z', session_id: 's1', game: 'b', source: 'game' }
  ];
  assert.strictEqual(t.recentDuplicate(rows, { session_id: 's1', game: 'b', source: 'game' }, now, 60000), true);
  assert.strictEqual(t.recentDuplicate(rows, { session_id: 's1', game: 'a', source: 'game' }, now, 60000), false, 'older than the window');
  assert.strictEqual(t.recentDuplicate(rows, { session_id: 's2', game: 'b', source: 'game' }, now, 60000), false, 'other session');
  assert.strictEqual(t.recentDuplicate([], { session_id: 's1' }, now, 60000), false);
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Write the boot test**

Create `scripts/test-visitor-tracking.js`:

````js
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
  headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': IPHONE, Cookie: 'ph_sid=sess-aaa' }, extra || {}),
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
      { date: 0, time: 0, session_id: 'sess-aaa', page: '/game/zzyzx-test-quest', game: 'zzyzx-test-quest', source: 'game' });
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
    const a = await call('POST', '/api/track/message', beacon({ page: '/', source: 'nav' }, { 'User-Agent': FB_BOT, Cookie: 'ph_sid=sess-bot' }));
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
    assert.strictEqual(rows[0].session_id, 'sess-aaa');
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
````

- [ ] **Step 3: Run both and watch them fail**

Run: `node scripts/test-tracking.js` → FAIL `Cannot find module '../lib/tracking'`.
Run: `node scripts/test-visitor-tracking.js` → FAIL (first failing assertion: a robot page view is still recorded / gets a cookie).

- [ ] **Step 4: Create `lib/tracking.js`**

````js
// Validation and de-duplication for the two small tracking beacons the public
// site sends (a Message Us tap, a search that found nothing). Pure: server.js
// does the reading of cookies and writing of rows.

// Where on the site a Messenger link sits. Anything else is stored as 'other'.
const SOURCES = ['nav', 'fab', 'hero', 'footer', 'game', 'search', 'search-empty', 'other'];

function cleanSource(s) {
  return SOURCES.includes(s) ? s : 'other';
}

// A site-relative path, query and hash dropped. null for anything else.
function cleanPage(p) {
  if (typeof p !== 'string') return null;
  const s = p.split('#')[0].split('?')[0];
  if (!s.startsWith('/') || s.startsWith('//') || s.length > 200) return null;
  return s;
}

// '/game/<slug>' → '<slug>', anything else → null.
function gameSlugFromPage(page) {
  const m = /^\/game\/([a-z0-9-]+)\/?$/.exec(String(page || ''));
  return m ? m[1] : null;
}

// A search phrase worth keeping: lower-cased, single-spaced, ≤ 60 chars,
// at least 3 characters. '' when it is not.
function cleanQuery(q) {
  if (typeof q !== 'string') return '';
  const s = q.toLowerCase().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  return s.length >= 3 ? s : '';
}

// True when `rows` already holds a row with the same session_id and every
// other `key` field, recorded within windowMs of nowMs. Rows are appended in
// time order, so only the tail is scanned.
function recentDuplicate(rows, key, nowMs, windowMs) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (nowMs - Date.parse(r.time) > windowMs) return false;
    if (Object.keys(key).every(k => r[k] === key[k])) return true;
  }
  return false;
}

module.exports = { SOURCES, cleanSource, cleanPage, gameSlugFromPage, cleanQuery, recentDuplicate };
````

- [ ] **Step 5: Edit `server.js` with the helper script**

Create `.superpowers/tmp-edits/rep.js` (CRLF/BOM-safe single replace used by every edit script in this plan):

````js
// scratch helper: rep(file, oldLF, newLF) — CRLF/BOM-safe single replace
const fs = require('fs');
module.exports = function rep(file, oldS, newS) {
  let s = fs.readFileSync(file, 'utf8');
  const crlf = s.includes('\r\n');
  const o = crlf ? oldS.replace(/\n/g, '\r\n') : oldS;
  const n = crlf ? newS.replace(/\n/g, '\r\n') : newS;
  const i = s.indexOf(o);
  if (i < 0) throw new Error('anchor not found in ' + file + ': ' + oldS.slice(0, 60));
  if (s.indexOf(o, i + 1) >= 0) throw new Error('anchor not unique in ' + file + ': ' + oldS.slice(0, 60));
  fs.writeFileSync(file, s.slice(0, i) + n + s.slice(i + o.length));
};
````

Create `.superpowers/tmp-edits/edit-task2.js`. It (a) requires the two libs, (b) adds the three `db.defaults` keys, (c) replaces the visitor middleware with the classifier-based version plus `pushCapped` / `countSkippedVisit`, (d) adds the two beacon routes just above `GET /api/search-index`:

````js
const rep = require('./rep');
const F = 'server.js';
rep(F, "const psplusMonthlyCoversStore = require('./lib/psplus-monthly-covers-store');\n",
"const psplusMonthlyCoversStore = require('./lib/psplus-monthly-covers-store');\nconst visitorFilter = require('./lib/visitor-filter');\nconst tracking = require('./lib/tracking');\n");
rep(F, "  visitors: [],\n  messenger_contacts: [],",
"  visitors: [],\n  visitor_skips: {},\n  message_taps: [],\n  search_misses: [],\n  messenger_contacts: [],");
rep(F, `const PAGE_LABELS = { '/': 'Home', '/browse': 'Browse Games', '/ps-plus': 'PS Plus Deluxe', '/how-it-works': 'How It Works' };
app.use((req, res, next) => {
  const reqPath = req.path;
  // Only track public pages, not admin/assets/uploads
  if (reqPath.startsWith('/admin') || reqPath.startsWith('/uploads') || reqPath.startsWith('/css') || reqPath.startsWith('/js') || reqPath.includes('.')) return next();
  const pageLabel = PAGE_LABELS[reqPath] || reqPath;
  const ip = require('crypto').createHash('sha256').update(clientIp(req)).digest('hex');
  const sid = sessionId(req, res);
  // Later route handlers in this same request (e.g. POST /order/create in
  // Task 2) read this instead of calling sessionId() a second time, so
  // there's exactly one place per request that decides "who is this."
  req.sessionId = sid;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  db.get('visitors').push({ date: today, time: now, path: reqPath, page: pageLabel, ip, session_id: sid }).write();
`, `const PAGE_LABELS = { '/': 'Home', '/browse': 'Browse Games', '/ps-plus': 'PS Plus Deluxe', '/how-it-works': 'How It Works' };

// Appends a row to a lowdb array and trims it to its newest \`cap\` rows —
// lowdb rewrites the whole file per write, so every growing log needs a ceiling.
function pushCapped(key, row, cap) {
  db.get(key).push(row).write();
  const all = db.get(key).value();
  if (all.length > cap) db.set(key, all.slice(all.length - cap)).write();
}

// One more robot / webhook hit that was deliberately not counted as a visitor.
function countSkippedVisit() {
  const day = new Date().toISOString().slice(0, 10);
  const skips = db.get('visitor_skips').value() || {};
  db.set(['visitor_skips', day], (skips[day] || 0) + 1).write();
}

app.use((req, res, next) => {
  const reqPath = req.path;
  // Only track public pages, not admin/assets/uploads
  if (reqPath.startsWith('/admin') || reqPath.startsWith('/uploads') || reqPath.startsWith('/css') || reqPath.startsWith('/js') || reqPath.includes('.')) return next();
  // Robots, link-preview fetchers and system traffic (webhooks, /api/*) are not
  // visitors: no row and no session cookie, so each hit can no longer open a
  // phantom session. Robots and webhooks are tallied so the dashboard can say
  // how many it ignored; /api/* is just the site talking to itself.
  const cls = visitorFilter.classifyRequest({ method: req.method, path: reqPath, userAgent: req.get('user-agent') });
  if (cls === 'bot' || (cls === 'system' && visitorFilter.isWebhookPath(reqPath))) countSkippedVisit();
  if (cls === 'bot' || cls === 'system') return next();
  const sid = sessionId(req, res);
  // Later route handlers in this same request (e.g. POST /order/create in
  // Task 2) read this instead of calling sessionId() a second time, so
  // there's exactly one place per request that decides "who is this."
  req.sessionId = sid;
  // A form post is a human action, not a page view: it keeps the session but
  // adds no visit row.
  if (cls === 'action') return next();
  const pageLabel = PAGE_LABELS[reqPath] || reqPath;
  const ip = require('crypto').createHash('sha256').update(clientIp(req)).digest('hex');
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  db.get('visitors').push({ date: today, time: now, path: reqPath, page: pageLabel, ip, session_id: sid }).write();
`);
rep(F, "app.get('/api/search-index', async (req, res) => {",
`// ── Tracking beacons ─────────────────────────────────────────────────────────
// Sent by the public pages (see partials/nav.ejs and public/js/home-search.js).
// They never issue a cookie, ignore robots and visitors with no session yet,
// and always answer 204 so tracking can never affect a page.
function trackingSession(req) {
  if (visitorFilter.isBotUserAgent(req.get('user-agent'))) return null;
  return getCookie(req, SESSION_COOKIE) || null;
}

// A tap on any Message Us / m.me link.
app.post('/api/track/message', express.json({ limit: '2kb' }), (req, res) => {
  try {
    const sid = trackingSession(req);
    const body = req.body || {};
    const page = tracking.cleanPage(body.page);
    if (sid && page) {
      const slug = tracking.gameSlugFromPage(page);
      const game = slug && getGames().some(g => gameSlug(g.title) === slug) ? slug : null;
      const source = tracking.cleanSource(body.source);
      const nowMs = Date.now();
      if (!tracking.recentDuplicate(db.get('message_taps').value(), { session_id: sid, game, source }, nowMs, 60000)) {
        const iso = new Date(nowMs).toISOString();
        pushCapped('message_taps', { date: iso.slice(0, 10), time: iso, session_id: sid, page, game, source }, 50000);
      }
    }
  } catch (e) {
    console.error('[track] message failed', e.message);
  }
  res.status(204).end();
});

// A homepage search that found nothing.
app.post('/api/track/search-miss', express.json({ limit: '2kb' }), (req, res) => {
  try {
    const sid = trackingSession(req);
    const q = tracking.cleanQuery((req.body || {}).q);
    if (sid && q) {
      const nowMs = Date.now();
      if (!tracking.recentDuplicate(db.get('search_misses').value(), { session_id: sid, q }, nowMs, 24 * 60 * 60 * 1000)) {
        const iso = new Date(nowMs).toISOString();
        pushCapped('search_misses', { date: iso.slice(0, 10), time: iso, session_id: sid, q }, 20000);
      }
    }
  } catch (e) {
    console.error('[track] search-miss failed', e.message);
  }
  res.status(204).end();
});

app.get('/api/search-index', async (req, res) => {`);
console.log('edited');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-task2.js` → prints `edited`.
Then: `node --check server.js && file server.js` → must still say `UTF-8 (with BOM) text` and `CRLF`.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `node scripts/test-tracking.js` → `6 assertions passed`.
Run: `node scripts/test-visitor-tracking.js` → `12 assertions passed`.
Run: `node scripts/test-psplus-routes.js` → still passes (search index untouched).

- [ ] **Step 7: Commit**

```bash
git add lib/tracking.js scripts/test-tracking.js scripts/test-visitor-tracking.js server.js
git commit -m "Stop counting robots and system hits as visitors; add tap and search-miss beacons

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Count Message Us taps site-wide

**Files:**
- Create: `public/js/message-taps.js`, `scripts/test-message-taps.js`
- Modify: `views/partials/nav.ejs`, `views/partials/footer.ejs` (both CRLF — via the edit script)

**Interfaces:**
- Consumes: `POST /api/track/message` from Task 2 (body `{ page, source }`).
- Produces: every page that includes the nav loads `/js/message-taps.js`; links may carry `data-track-source`.

- [ ] **Step 1: Write the test**

Create `scripts/test-message-taps.js`:

````js
// Run: node scripts/test-message-taps.js
//
// public/js/message-taps.js with a stubbed browser: which clicks send a beacon,
// what it carries, and that nav / footer links are tagged and the script is
// loaded by the nav.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const sent = [];
global.location = { pathname: '/game/zzyzx-test-quest' };
// Node defines a read-only global navigator, so it has to be replaced explicitly.
Object.defineProperty(global, 'navigator', { configurable: true, value: { sendBeacon: (url, blob) => { sent.push({ url, blob }); return true; } } });
global.document = { addEventListener() {} };
const taps = require('../public/js/message-taps.js');

function link(href, source) {
  const a = { getAttribute: n => (n === 'href' ? href : n === 'data-track-source' ? source || null : null) };
  return { target: { closest: sel => (sel === 'a[href]' ? a : null) } };
}
async function lastBody() { return JSON.parse(await sent[sent.length - 1].blob.text()); }

async function main() {
  console.log('\nmessage-taps.js');

  ok('a tap on an m.me link sends one beacon to /api/track/message', () => {
    taps.onTap(link('http://m.me/PlaystationHub00?text=Hi'));
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].url, '/api/track/message');
    assert.strictEqual(sent[0].blob.type, 'application/json');
  });

  const body = await lastBody();
  ok('it carries the page path and defaults the source to other', () => {
    assert.deepStrictEqual(body, { page: '/game/zzyzx-test-quest', source: 'other' });
  });

  ok('data-track-source is passed along', async () => {
    taps.onTap(link('https://m.me/PlaystationHub00', 'fab'));
    assert.strictEqual(sent.length, 2);
  });
  assert.deepStrictEqual(await lastBody(), { page: '/game/zzyzx-test-quest', source: 'fab' });

  ok('other links and non-link clicks send nothing', () => {
    taps.onTap(link('/browse'));
    taps.onTap(link('http://m.me/SomeoneElse'));
    taps.onTap({ target: { closest: () => null } });
    taps.onTap(undefined);
    assert.strictEqual(sent.length, 2);
  });

  console.log('\nnav and footer markup');
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', f), 'utf8');
  const nav = read('nav.ejs');
  const footer = read('footer.ejs');

  ok('the nav loads the tap script', () => {
    assert.ok(/<script src="\/js\/message-taps\.js\?v=<%= assetV %>" defer><\/script>/.test(nav));
  });
  ok('nav buttons, the phone button and the footer links are tagged', () => {
    assert.strictEqual((nav.match(/class="nav-cta" data-track-source="nav"/g) || []).length, 2);
    assert.ok(/class="mobile-fab" data-track-source="fab"/.test(nav));
    assert.ok(/class="navsearch-empty-btn2" data-track-source="search-empty"/.test(nav));
    assert.ok(/class="social-icon messenger" data-track-source="footer"/.test(footer));
    assert.ok(/rel="noopener" data-track-source="footer">Message Us on Messenger/.test(footer));
  });

  console.log('\n' + passed + ' assertions passed\n');
}
main().catch(e => { console.error(e); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-message-taps.js` → FAIL `Cannot find module '../public/js/message-taps.js'`.

- [ ] **Step 3: Create the script**

Create `public/js/message-taps.js`:

````js
// Counts taps on any Messenger link (m.me/PlaystationHub00) so the admin
// dashboard can show "Messaged us". Loaded by partials/nav.ejs on every public
// page. Never delays or blocks the link: it only fires a small beacon.
//
// A link may say where it sits with data-track-source="nav|fab|footer|game|
// search|search-empty"; anything else is recorded as "other". The server works
// out the game from the page path, so game pages need no extra attributes.
(function () {
  var MESSENGER = /m\.me\/PlaystationHub00/i;

  function send(payload) {
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/track/message', new Blob([body], { type: 'application/json' }))) return;
    } catch (e) { /* fall through to fetch */ }
    try {
      fetch('/api/track/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    } catch (e) { /* tracking must never break a page */ }
  }

  function onTap(e) {
    var a = e && e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !MESSENGER.test(a.getAttribute('href') || '')) return;
    send({ page: location.pathname, source: a.getAttribute('data-track-source') || 'other' });
  }

  if (typeof document !== 'undefined') {
    // Capture phase: a page script that stops propagation cannot hide the tap.
    document.addEventListener('click', onTap, true);
    document.addEventListener('auxclick', onTap, true);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { onTap: onTap, send: send };
})();
````

- [ ] **Step 4: Tag the links and load the script**

Create `.superpowers/tmp-edits/edit-task3.js` (counts every replacement and fails loudly if an anchor appears the wrong number of times):

````js
const fs = require('fs');
function sub(file, pairs, counts) {
  let s = fs.readFileSync(file, 'utf8');
  pairs.forEach(([from, to], i) => {
    const n = s.split(from).length - 1;
    if (n !== counts[i]) throw new Error(file + ': expected ' + counts[i] + ' of ' + from + ', found ' + n);
    s = s.split(from).join(to);
  });
  fs.writeFileSync(file, s);
}
sub('views/partials/nav.ejs', [
  ['class="nav-cta">', 'class="nav-cta" data-track-source="nav">'],
  ['class="mobile-fab" aria-label', 'class="mobile-fab" data-track-source="fab" aria-label'],
  ['rel="noopener" class="navsearch-empty-btn2">', 'rel="noopener" class="navsearch-empty-btn2" data-track-source="search-empty">'],
  ['})();\r\n</script>\r\n', '})();\r\n</script>\r\n<script src="/js/message-taps.js?v=<%= assetV %>" defer></script>\r\n']
], [2, 1, 1, 1]);
sub('views/partials/footer.ejs', [
  ['class="social-icon messenger"', 'class="social-icon messenger" data-track-source="footer"'],
  ['rel="noopener">Message Us on Messenger', 'rel="noopener" data-track-source="footer">Message Us on Messenger']
], [1, 1]);
console.log('edited');
````

Run: `node .superpowers/tmp-edits/edit-task3.js` → `edited`. Then `file views/partials/nav.ejs views/partials/footer.ejs` → both still CRLF.

- [ ] **Step 5: Run the test and watch it pass**

Run: `node scripts/test-message-taps.js` → `6 assertions passed`.

- [ ] **Step 6: Commit**

```bash
git add public/js/message-taps.js scripts/test-message-taps.js views/partials/nav.ejs views/partials/footer.ejs
git commit -m "Count every tap on a Messenger link

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Funnel numbers (library)

**Files:**
- Create: `lib/visitor-funnel.js`
- Test: `scripts/test-visitor-funnel.js`

**Interfaces:**
- Consumes: Task 1's `isSystemPath`.
- Produces: `buildSessionSummaries({ visitors, taps, orderedSessionIds: Set, paidSessionIds: Set }) → summary[]` (`{ startDate, browsed, viewedGame, messaged, ordered, paid, exitPath, rows }`); `buildWindow({ summaries, taps, misses, skips, inWindow(dateStr), resolveGame(slug) → {title, cover, slots}|null }) → { funnel[5], exitPages, browsed, skipped, asked: { games[≤5], other }, misses[≤5] }`. Task 5 consumes `buildSessionSummaries` and `buildWindow`.

- [ ] **Step 1: Write the test**

Create `scripts/test-visitor-funnel.js`:

````js
// Run: node scripts/test-visitor-funnel.js
const assert = require('assert');
const f = require('../lib/visitor-funnel');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const row = (sid, path, date) => ({ session_id: sid, path, date: date || '2026-10-02', page: path });
const NONE = new Set();

console.log('\nbuildSessionSummaries');

ok('system paths are ignored and a session left with no rows disappears', () => {
  const s = f.buildSessionSummaries({
    visitors: [row('a', '/'), row('a', '/api/search-index'), row('hook', '/webhooks/paymongo'), row('hook2', '/webhook')],
    taps: [], orderedSessionIds: NONE, paidSessionIds: NONE
  });
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].exitPath, '/', 'the /api row is not the exit page');
});

ok('viewedGame / messaged / browsed come from rows and taps', () => {
  const s = f.buildSessionSummaries({
    visitors: [row('a', '/'), row('a', '/browse'), row('b', '/'), row('c', '/'), row('d', '/game/x')],
    taps: [{ session_id: 'b', game: 'x', page: '/game/x' }, { session_id: 'c', game: null, page: '/' }],
    orderedSessionIds: NONE, paidSessionIds: NONE
  });
  const by = Object.fromEntries(s.map(x => [x.rows[0].session_id, x]));
  assert.strictEqual(by.a.browsed, true);
  assert.strictEqual(by.a.viewedGame, false);
  assert.strictEqual(by.b.viewedGame, true, 'a tap with a game implies the game was viewed');
  assert.strictEqual(by.b.messaged, true);
  assert.strictEqual(by.c.messaged, true);
  assert.strictEqual(by.c.viewedGame, false, 'a homepage tap does not');
  assert.strictEqual(by.d.viewedGame, true);
  assert.strictEqual(by.d.messaged, false);
});

ok('an ordering session counts as having viewed a game, and paid follows the paid set', () => {
  const s = f.buildSessionSummaries({
    visitors: [row('o', '/')], taps: [], orderedSessionIds: new Set(['o']), paidSessionIds: new Set(['o'])
  });
  assert.deepStrictEqual([s[0].viewedGame, s[0].ordered, s[0].paid], [true, true, true]);
});

console.log('\nwindowMetrics');

ok('five funnel rows; viewed / messaged / ordered are shares of Landed, paid of ordered', () => {
  const mk = o => Object.assign({ startDate: '2026-10-02', browsed: false, viewedGame: false, messaged: false, ordered: false, paid: false, exitPath: '/' }, o);
  const sessions = [mk({}), mk({}), mk({ viewedGame: true }), mk({ viewedGame: true, messaged: true }),
    mk({ viewedGame: true, ordered: true, paid: true }), mk({ viewedGame: true, ordered: true })];
  const m = f.windowMetrics(sessions, 7);
  assert.deepStrictEqual(m.funnel.map(x => x.label), ['Landed', 'Viewed a game', 'Messaged us', 'Ordered on website', 'Paid']);
  assert.deepStrictEqual(m.funnel.map(x => x.count), [6, 4, 1, 2, 1]);
  assert.deepStrictEqual(m.funnel.map(x => x.pctOfPrev), [null, 67, 17, 33, 50]);
  assert.strictEqual(m.skipped, 7);
});

ok('an empty window has null percentages, not NaN', () => {
  const m = f.windowMetrics([], 0);
  assert.strictEqual(m.funnel[0].count, 0);
  assert.ok(m.funnel.slice(1).every(x => x.pctOfPrev === null));
});

console.log('\naskedForWindow / missesForWindow / skippedForWindow');

ok('asked: top games with live info, deleted games and no-game taps counted as other', () => {
  const taps = [
    { date: '2026-10-02', game: 'a' }, { date: '2026-10-02', game: 'a' }, { date: '2026-10-02', game: 'b' },
    { date: '2026-10-02', game: null }, { date: '2026-10-02', game: 'gone' }, { date: '2026-09-01', game: 'b' }
  ];
  const info = { a: { title: 'Game A', cover: '/a.png', slots: 2 }, b: { title: 'Game B', cover: '', slots: 0 } };
  const r = f.askedForWindow(taps, d => d === '2026-10-02', slug => info[slug] || null);
  assert.deepStrictEqual(r.games, [
    { slug: 'a', title: 'Game A', cover: '/a.png', slots: 2, count: 2 },
    { slug: 'b', title: 'Game B', cover: '', slots: 0, count: 1 }
  ]);
  assert.strictEqual(r.other, 2);
});

ok('asked keeps only the top five', () => {
  const taps = 'abcdefg'.split('').map(g => ({ date: 'd', game: g }));
  const r = f.askedForWindow(taps, () => true, s => ({ title: s, cover: '', slots: 0 }));
  assert.strictEqual(r.games.length, 5);
});

ok('misses are counted by phrase, most first, inside the window', () => {
  const m = [{ date: 'd1', q: 'elden ring' }, { date: 'd1', q: 'elden ring' }, { date: 'd1', q: 'hades' }, { date: 'd0', q: 'old' }];
  assert.deepStrictEqual(f.missesForWindow(m, d => d === 'd1'), [{ q: 'elden ring', count: 2 }, { q: 'hades', count: 1 }]);
});

ok('skipped sums the days inside the window', () => {
  assert.strictEqual(f.skippedForWindow({ '2026-10-01': 5, '2026-10-02': 3, '2026-09-01': 100 }, d => d >= '2026-10-01'), 8);
  assert.strictEqual(f.skippedForWindow(undefined, () => true), 0);
});

console.log('\nbuildWindow');

ok('sessions, taps, misses and skips are all cut to the same window', () => {
  const summaries = f.buildSessionSummaries({
    visitors: [row('a', '/game/x', '2026-10-02'), row('b', '/', '2026-09-01')],
    taps: [{ session_id: 'a', game: 'x', date: '2026-10-02' }], orderedSessionIds: NONE, paidSessionIds: NONE
  });
  const w = f.buildWindow({
    summaries, taps: [{ session_id: 'a', game: 'x', date: '2026-10-02' }], misses: [{ date: '2026-10-02', q: 'zelda' }],
    skips: { '2026-10-02': 4, '2026-09-01': 9 }, inWindow: d => d === '2026-10-02',
    resolveGame: () => ({ title: 'X', cover: '', slots: 1 })
  });
  assert.strictEqual(w.funnel[0].count, 1);
  assert.strictEqual(w.funnel[2].count, 1);
  assert.strictEqual(w.skipped, 4);
  assert.strictEqual(w.asked.games[0].slug, 'x');
  assert.deepStrictEqual(w.misses, [{ q: 'zelda', count: 1 }]);
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-visitor-funnel.js` → FAIL `Cannot find module '../lib/visitor-funnel'`.

- [ ] **Step 3: Write the module**

Create `lib/visitor-funnel.js`:

````js
// The admin dashboard's visitor funnel, "Most asked-about games" and
// "Searched, nothing found" cards. Pure: server.js reads the lowdb arrays and
// the orders, calls these, and hands the result to views/partials/admin/
// dashboard/site.ejs. Kept apart from lib/funnel.js, which is the ORDER funnel.
const { isSystemPath } = require('./visitor-filter');

const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) : null);

// One record per session. System paths (/api/*, webhooks) are ignored, which
// also cleans rows recorded before the visitor middleware learned to skip them;
// a session left with no rows disappears.
//   visitors            lowdb 'visitors' rows
//   taps                lowdb 'message_taps' rows
//   orderedSessionIds   Set of session ids that placed an order
//   paidSessionIds      Set of session ids with a paid order
function buildSessionSummaries({ visitors, taps, orderedSessionIds, paidSessionIds }) {
  const rowsBySession = {};
  (visitors || []).forEach(v => {
    if (!v.session_id || isSystemPath(v.path)) return;
    (rowsBySession[v.session_id] = rowsBySession[v.session_id] || []).push(v);
  });
  const tapsBySession = {};
  (taps || []).forEach(t => {
    (tapsBySession[t.session_id] = tapsBySession[t.session_id] || []).push(t);
  });
  return Object.keys(rowsBySession).map(sid => {
    const rows = rowsBySession[sid];
    const sTaps = tapsBySession[sid] || [];
    const ordered = orderedSessionIds.has(sid);
    return {
      // A session belongs to the day it STARTED, so "Landed" is a true total.
      startDate: rows[0].date,
      browsed: rows.some(v => v.path === '/browse'),
      // "OR ordered / OR tapped from a game page" is load-bearing: either can
      // only happen on a game page, so if that page row were ever missing the
      // funnel would otherwise show more orders or taps than game views.
      viewedGame: rows.some(v => v.path.startsWith('/game/')) || ordered || sTaps.some(t => t.game),
      messaged: sTaps.length > 0,
      ordered,
      paid: paidSessionIds.has(sid),
      // No tab-close event exists, so the last row is the closest proxy for
      // "the last thing they looked at".
      exitPath: rows[rows.length - 1].path,
      rows
    };
  });
}

function skippedForWindow(skips, inWindow) {
  return Object.entries(skips || {}).reduce((sum, [day, n]) => sum + (inWindow(day) ? Number(n) || 0 : 0), 0);
}

// Funnel rows. Viewed / Messaged / Ordered are parallel outcomes of a landing,
// so each shows its share of Landed (stage.pctOfPrev); only Paid is a share of
// the row before it (Ordered).
function windowMetrics(sessions, skipped) {
  const landed = sessions.length;
  const count = key => sessions.filter(s => s[key]).length;
  const viewed = count('viewedGame');
  const messaged = count('messaged');
  const ordered = count('ordered');
  const paid = count('paid');
  const browsedCount = count('browsed');
  const exitCounts = {};
  sessions.forEach(s => { exitCounts[s.exitPath] = (exitCounts[s.exitPath] || 0) + 1; });
  return {
    funnel: [
      { label: 'Landed', count: landed, pctOfPrev: null },
      { label: 'Viewed a game', count: viewed, pctOfPrev: pct(viewed, landed) },
      { label: 'Messaged us', count: messaged, pctOfPrev: pct(messaged, landed) },
      { label: 'Ordered on website', count: ordered, pctOfPrev: pct(ordered, landed) },
      { label: 'Paid', count: paid, pctOfPrev: pct(paid, ordered) }
    ],
    exitPages: Object.entries(exitCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, n]) => ({ path, count: n })),
    browsed: { count: browsedCount, total: landed, pct: pct(browsedCount, landed) },
    skipped
  };
}

// Top 5 games by Message Us taps. resolveGame(slug) → { title, cover, slots }
// or null for a game that no longer exists (counted under `other`).
function askedForWindow(taps, inWindow, resolveGame) {
  const counts = {};
  let other = 0;
  (taps || []).forEach(t => {
    if (!inWindow(t.date)) return;
    if (!t.game) { other++; return; }
    counts[t.game] = (counts[t.game] || 0) + 1;
  });
  const games = [];
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([slug, n]) => {
    const g = resolveGame(slug);
    if (!g) { other += n; return; }
    games.push({ slug, title: g.title, cover: g.cover || '', slots: g.slots, count: n });
  });
  return { games: games.slice(0, 5), other };
}

// Top 5 searches that found nothing.
function missesForWindow(misses, inWindow) {
  const counts = {};
  (misses || []).forEach(m => { if (inWindow(m.date)) counts[m.q] = (counts[m.q] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([q, n]) => ({ q, count: n }));
}

// Everything one dashboard window shows. inWindow(date) says whether a
// 'YYYY-MM-DD' day belongs to the window; sessions count on their start day.
function buildWindow({ summaries, taps, misses, skips, inWindow, resolveGame }) {
  const sessions = summaries.filter(s => inWindow(s.startDate));
  return Object.assign(windowMetrics(sessions, skippedForWindow(skips, inWindow)), {
    asked: askedForWindow(taps, inWindow, resolveGame),
    misses: missesForWindow(misses, inWindow)
  });
}

module.exports = { buildSessionSummaries, windowMetrics, askedForWindow, missesForWindow, skippedForWindow, buildWindow };
````

- [ ] **Step 4: Run it and watch it pass**

Run: `node scripts/test-visitor-funnel.js` → `10 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/visitor-funnel.js scripts/test-visitor-funnel.js
git commit -m "Visitor funnel maths: five rows, asked-about games, missed searches

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dashboard — new funnel, "Most asked-about games", "Searched, nothing found"

**Files:**
- Create: `public/js/dashboard-visitors.js`, `scripts/test-dashboard-visitors.js`, `scripts/test-admin-visitors-render.js`
- Modify: `server.js`, `views/partials/admin/dashboard/site.ejs`, `public/css/style.css` (all CRLF — via the edit script)

**Interfaces:**
- Consumes: Task 2's lowdb keys, Task 4's `visitorFunnel.buildSessionSummaries` / `buildWindow`, Task 1's `visitorFilter.isSystemPath`.
- Produces: `slotsFreeFor(g, accountSummaryMap) → number` in `server.js` (shared by `/api/search-index`); `VIS_WINDOWS[...]` windows now carry `funnel` (5 rows), `skipped`, `asked`, `misses`; `window.DashVisitors.{esc, browsedHtml, funnelHtml, askedHtml, missesHtml}`.

- [ ] **Step 1: Write the two tests**

Create `scripts/test-dashboard-visitors.js`:

````js
// Run: node scripts/test-dashboard-visitors.js
//
// public/js/dashboard-visitors.js (the markup for the Site tab's visitor cards)
// and the wiring of views/partials/admin/dashboard/site.ejs and public/css/style.css.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dv = require('../public/js/dashboard-visitors.js');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const win = (extra) => Object.assign({
  funnel: [
    { label: 'Landed', count: 300, pctOfPrev: null },
    { label: 'Viewed a game', count: 200, pctOfPrev: 67 },
    { label: 'Messaged us', count: 42, pctOfPrev: 14 },
    { label: 'Ordered on website', count: 0, pctOfPrev: 0 },
    { label: 'Paid', count: 0, pctOfPrev: null }
  ],
  browsed: { count: 37, total: 300, pct: 12 },
  skipped: 0,
  asked: { games: [], other: 0 },
  misses: []
}, extra || {});

console.log('\nfunnel and note');
ok('the funnel draws one row per stage with counts and percentages', () => {
  const h = dv.funnelHtml(win());
  assert.strictEqual((h.match(/class="vf-row"/g) || []).length, 5);
  assert.ok(h.includes('Messaged us') && h.includes('<strong>42</strong> <span class="vf-pct">14%</span>'));
  assert.ok(h.includes('width:100%') && h.includes('width:14%'));
});
ok('the browsed note names the skipped robot hits only when there are some', () => {
  assert.ok(!/robot/.test(dv.browsedHtml(win())));
  const h = dv.browsedHtml(win({ skipped: 113 }));
  assert.ok(h.includes('<strong>37</strong> of <strong>300</strong>'));
  assert.ok(h.includes('<strong>113</strong> robot / system hits not counted'));
});

console.log('\nasked-about games');
ok('rows show cover, title, free / booked badge and count; plus the no-game line', () => {
  const h = dv.askedHtml(win({ asked: { games: [
    { slug: 'a', title: 'God of War', cover: '/uploads/a.png', slots: 2, count: 11 },
    { slug: 'b', title: 'Spider-Man', cover: '', slots: 0, count: 8 }
  ], other: 17 } }));
  assert.ok(h.includes('<img class="vf-ask-img" src="/uploads/a.png"'));
  assert.ok(h.includes('vf-ask-ok">2 free<'));
  assert.ok(h.includes('vf-ask-no">booked<'));
  assert.ok(h.includes('+ taps with no specific game: 17'));
});
ok('empty state', () => {
  assert.ok(dv.askedHtml(win()).includes('No Message Us taps yet.'));
  assert.ok(dv.askedHtml(undefined).includes('No Message Us taps yet.'));
});
ok('titles are escaped', () => {
  const h = dv.askedHtml(win({ asked: { games: [{ slug: 'x', title: '<img src=x onerror=alert(1)>', cover: '', slots: 1, count: 1 }], other: 0 } }));
  assert.ok(!h.includes('<img src=x'));
  assert.ok(h.includes('&lt;img src=x'));
});

console.log('\nsearched, nothing found');
ok('lists phrases with counts, escaped; empty string when none', () => {
  const h = dv.missesHtml(win({ misses: [{ q: 'elden ring', count: 3 }, { q: '<b>x</b>', count: 1 }] }));
  assert.ok(h.includes('elden ring') && h.includes('<strong>3</strong> searches') && h.includes('<strong>1</strong> search<'));
  assert.ok(!h.includes('<b>x</b>'));
  assert.strictEqual(dv.missesHtml(win()), '');
});

console.log('\nwiring');
const site = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin', 'dashboard', 'site.ejs'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
ok('site.ejs loads the script before its inline block and has both new panels', () => {
  const s = site.indexOf('/js/dashboard-visitors.js?v=<%= assetV %>');
  assert.ok(s > 0, 'script tag present');
  assert.ok(s < site.indexOf('const VIS_WINDOWS'), 'loaded before the inline script that uses it');
  assert.ok(site.includes('id="vfAskedBody"') && site.includes('id="vfMissesBody"') && site.includes('id="vfMissesPanel"'));
  assert.ok(/DashVisitors\.funnelHtml\(win\)/.test(site) && /DashVisitors\.askedHtml\(win\)/.test(site) && /DashVisitors\.missesHtml\(win\)/.test(site));
});
ok('the stylesheet styles the new rows', () => {
  for (const c of ['.vf-ask-row', '.vf-ask-img', '.vf-ask-badge', '.vf-ask-ok', '.vf-ask-no', '.vf-ask-n', '.vf-ask-other']) {
    assert.ok(css.includes(c), c + ' missing from style.css');
  }
});

console.log('\n' + passed + ' assertions passed\n');
````

Create `scripts/test-admin-visitors-render.js` (boots a throwaway instance, swaps in express-session's in-memory store because there is no Mongo, logs in with a password it generates itself, and reads the embedded `VIS_WINDOWS`):

````js
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
````

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-dashboard-visitors.js` → FAIL `Cannot find module '../public/js/dashboard-visitors.js'`.
Run: `node scripts/test-admin-visitors-render.js` → FAIL (funnel labels are the old four).

- [ ] **Step 3: Create the markup module**

Create `public/js/dashboard-visitors.js`:

````js
// HTML for the admin dashboard's visitor cards (Site tab): the funnel, its
// "browsed the catalog" note, "Most asked-about games" and "Searched, nothing
// found". Takes one window object from server.js (VIS_WINDOWS[...]) and returns
// markup; views/partials/admin/dashboard/site.ejs assigns it to innerHTML.
// Everything user-influenced (game titles, search phrases) goes through esc().
(function (root) {
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  function browsedHtml(win) {
    var b = win.browsed;
    var s = 'Browsed the catalog — <strong>' + b.count + '</strong> of <strong>' + b.total +
      '</strong> sessions <span class="vf-browsed-pct">' + (b.pct === null ? '—' : b.pct + '%') + '</span>';
    if (win.skipped > 0) s += ' · <strong>' + win.skipped + '</strong> robot / system hits not counted';
    return s;
  }

  function funnelHtml(win) {
    var top = win.funnel[0].count;
    return win.funnel.map(function (stage) {
      var widthPct = top > 0 ? Math.max(2, Math.round((stage.count / top) * 100)) : 0;
      var pctHtml = stage.pctOfPrev === null ? '' : ' <span class="vf-pct">' + stage.pctOfPrev + '%</span>';
      return '<div class="vf-row">' +
        '<span class="vf-name">' + esc(stage.label) + '</span>' +
        '<div class="vf-bar-track"><div class="vf-bar-fill" style="width:' + widthPct + '%"></div></div>' +
        '<span class="vf-n"><strong>' + stage.count + '</strong>' + pctHtml + '</span>' +
        '</div>';
    }).join('');
  }

  function askedHtml(win) {
    var a = (win && win.asked) || { games: [], other: 0 };
    if (!a.games.length && !a.other) return '<div class="vf-empty">No Message Us taps yet.</div>';
    var rows = a.games.map(function (g) {
      var free = g.slots > 0;
      return '<div class="vf-ask-row">' +
        (g.cover ? '<img class="vf-ask-img" src="' + esc(g.cover) + '" alt="">' : '<span class="vf-ask-img"></span>') +
        '<span class="vf-ask-title">' + esc(g.title) + '</span>' +
        '<span class="vf-ask-badge ' + (free ? 'vf-ask-ok' : 'vf-ask-no') + '">' + (free ? g.slots + ' free' : 'booked') + '</span>' +
        '<span class="vf-ask-n">' + g.count + '</span>' +
        '</div>';
    }).join('');
    if (a.other) rows += '<div class="vf-ask-other">+ taps with no specific game: ' + a.other + '</div>';
    return rows;
  }

  // '' when nothing was searched in vain, so the caller can hide the panel.
  function missesHtml(win) {
    var m = (win && win.misses) || [];
    return m.map(function (x) {
      return '<div class="vf-exit-row"><span class="vf-exit-path">' + esc(x.q) + '</span>' +
        '<span class="vf-exit-n"><strong>' + x.count + '</strong> search' + (x.count !== 1 ? 'es' : '') + '</span></div>';
    }).join('');
  }

  var api = { esc: esc, browsedHtml: browsedHtml, funnelHtml: funnelHtml, askedHtml: askedHtml, missesHtml: missesHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DashVisitors = api;
})(typeof window !== 'undefined' ? window : this);
````

- [ ] **Step 4: Apply the stylesheet, view and server edits**

Create `.superpowers/tmp-edits/edit-task5.js`. It (a) appends the `.vf-ask-*` styles, (b) adds the two new panels and the script tag to `site.ejs` and switches `renderFunnel` / `renderVisWindow` to `DashVisitors`, (c) requires `lib/visitor-funnel`, (d) extracts `slotsFreeFor` from `/api/search-index`, (e) replaces the inline session-summary / window block in the admin route (between the `// ── Visitors tab` marker and `const accountsView = buildAccountsView();`) with calls into the library, and makes "Most Visited Pages" skip system paths:

````js
const fs = require('fs');
const rep = require('./rep');

// ── style.css ──
rep('public/css/style.css',
`.vf-browsed .vf-browsed-pct { color: #a78bfa; font-weight: 700; }
`,
`.vf-browsed .vf-browsed-pct { color: #a78bfa; font-weight: 700; }
.vf-ask-row { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem 0; border-top: 1px solid #161616; }
.vf-ask-row:first-child { border-top: 0; }
.vf-ask-img { width: 30px; height: 30px; border-radius: 6px; object-fit: cover; background: #1a1a1a; flex: none; }
.vf-ask-title { flex: 1; min-width: 0; color: #eee; font-size: 0.82rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vf-ask-badge { font-size: 0.66rem; font-weight: 800; border-radius: 4px; padding: 0.1rem 0.4rem; flex: none; }
.vf-ask-ok { background: rgba(34,197,94,0.15); color: #4ade80; }
.vf-ask-no { background: rgba(239,68,68,0.15); color: #f87171; }
.vf-ask-n { color: #22c55e; font-weight: 800; font-size: 0.85rem; min-width: 1.5rem; text-align: right; flex: none; }
.vf-ask-other { color: #666; font-size: 0.74rem; padding-top: 0.5rem; border-top: 1px solid #161616; margin-top: 0.25rem; }
`);

// ── site.ejs: markup ──
rep('views/partials/admin/dashboard/site.ejs',
`        <div class="vf-panel">
          <div class="vf-panel-label">Top exit pages</div>
          <div id="vfExitBody"></div>
        </div>
      </div>
`,
`        <div class="vf-panel">
          <div class="vf-panel-label">Top exit pages</div>
          <div id="vfExitBody"></div>
        </div>
      </div>
      <div class="vf-grid" style="margin-top:1.25rem;">
        <div class="vf-panel">
          <div class="vf-panel-label">💬 Most asked-about games</div>
          <div id="vfAskedBody"></div>
        </div>
        <div class="vf-panel" id="vfMissesPanel" style="display:none;">
          <div class="vf-panel-label">🔎 Searched, nothing found</div>
          <div id="vfMissesBody"></div>
        </div>
      </div>
`);

// ── site.ejs: script ──
rep('views/partials/admin/dashboard/site.ejs',
`    <script>
    const VIS_WINDOWS =`,
`    <script src="/js/dashboard-visitors.js?v=<%= assetV %>"></script>
    <script>
    const VIS_WINDOWS =`);

rep('views/partials/admin/dashboard/site.ejs',
`      if (!win || win.funnel[0].count === 0) {
        browsedEl.innerHTML = '';
        body.innerHTML = '<div class="vf-empty">No tracked sessions in this period.</div>';
        return;
      }
      const b = win.browsed;
      browsedEl.innerHTML = 'Browsed the catalog — <strong>' + b.count + '</strong> of <strong>' + b.total +
        '</strong> sessions <span class="vf-browsed-pct">' + (b.pct === null ? '—' : b.pct + '%') + '</span>';
      const top = win.funnel[0].count;
      body.innerHTML = win.funnel.map(stage => {
        const widthPct = top > 0 ? Math.max(2, Math.round((stage.count / top) * 100)) : 0;
        const pctHtml = stage.pctOfPrev === null ? '' : ' <span class="vf-pct">' + stage.pctOfPrev + '%</span>';
        return '<div class="vf-row">' +
          '<span class="vf-name">' + stage.label + '</span>' +
          '<div class="vf-bar-track"><div class="vf-bar-fill" style="width:' + widthPct + '%"></div></div>' +
          '<span class="vf-n"><strong>' + stage.count + '</strong>' + pctHtml + '</span>' +
          '</div>';
      }).join('');
    }
`,
`      if (!win || win.funnel[0].count === 0) {
        browsedEl.innerHTML = win && win.skipped > 0 ? '<strong>' + win.skipped + '</strong> robot / system hits not counted' : '';
        body.innerHTML = '<div class="vf-empty">No tracked sessions in this period.</div>';
        return;
      }
      browsedEl.innerHTML = DashVisitors.browsedHtml(win);
      body.innerHTML = DashVisitors.funnelHtml(win);
    }

    // The two cards under the funnel. They follow the same window object, so
    // all of them always describe one period.
    function renderAskedAndMisses(win) {
      document.getElementById('vfAskedBody').innerHTML = DashVisitors.askedHtml(win);
      const missesHtml = DashVisitors.missesHtml(win);
      document.getElementById('vfMissesBody').innerHTML = missesHtml;
      document.getElementById('vfMissesPanel').style.display = missesHtml ? '' : 'none';
    }
`);

rep('views/partials/admin/dashboard/site.ejs',
`      renderFunnel(win);
      renderExitPages(win);`,
`      renderFunnel(win);
      renderAskedAndMisses(win);
      renderExitPages(win);`);

// ── server.js ──
rep('server.js', "const tracking = require('./lib/tracking');\n",
  "const tracking = require('./lib/tracking');\nconst visitorFunnel = require('./lib/visitor-funnel');\n");

// Shared slot count (search index + dashboard "Most asked-about games").
rep('server.js',
`app.get('/api/search-index', async (req, res) => {
  const accountSummaryMap = buildAccountSummaryMap();
  const available = getGames().map(resolveGamePrices).map(resolveSlotDays).map(g => {
    const avail = computeAvailability(g, accountSummaryMap[g.id], { nt: g.nt_days_left, tr: g.tr_days_left, ps4: g.ps4_days_left });
    const slots = avail.ntSlots + avail.trSlots + (avail.showPs4 ? avail.ps4Slots : 0);
`,
`// Open slots across a game's account types. \`g\` must already be run through
// resolveGamePrices and resolveSlotDays. Used by the search index and the admin
// dashboard's "Most asked-about games".
function slotsFreeFor(g, accountSummaryMap) {
  const avail = computeAvailability(g, accountSummaryMap[g.id], { nt: g.nt_days_left, tr: g.tr_days_left, ps4: g.ps4_days_left });
  return avail.ntSlots + avail.trSlots + (avail.showPs4 ? avail.ps4Slots : 0);
}

app.get('/api/search-index', async (req, res) => {
  const accountSummaryMap = buildAccountSummaryMap();
  const available = getGames().map(resolveGamePrices).map(resolveSlotDays).map(g => {
    const slots = slotsFreeFor(g, accountSummaryMap);
`);

// Replace the inline session-summary / window code with lib/visitor-funnel.js.
{
  const file = 'server.js';
  let s = fs.readFileSync(file, 'utf8');
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  const startMarker = '  // ── Visitors tab: session summaries + windowed metrics';
  const endMarker = '  const accountsView = buildAccountsView();';
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker);
  if (a < 0 || b < 0 || b < a || s.indexOf(startMarker, a + 1) >= 0 || s.indexOf(endMarker, b + 1) >= 0) throw new Error('visitors block markers not found / not unique');
  const block = `  // ── Visitors tab: session summaries + windowed metrics ────────────────────
  // The arithmetic lives in lib/visitor-funnel.js so it can be asserted without
  // a database; this route gathers the inputs and cuts the five windows.
  const sessionedOrders = allOrders.filter(o => o.session_id);
  const orderedSessionIds = new Set(sessionedOrders.map(o => o.session_id));
  const paidSessionIds = new Set(
    sessionedOrders
      .filter(o => !orders.PAID_EXCLUDED_STATES.includes(o.state))
      .map(o => o.session_id)
  );
  const messageTaps = db.get('message_taps').value() || [];
  const searchMisses = db.get('search_misses').value() || [];
  const visitorSkips = db.get('visitor_skips').value() || {};
  const sessionSummaries = visitorFunnel.buildSessionSummaries({ visitors, taps: messageTaps, orderedSessionIds, paidSessionIds });

  // Live cover and free-slot count for each game people tapped Message Us
  // from, looked up once per game per page load.
  const askedAccountMap = buildAccountSummaryMap();
  const askedCache = {};
  function resolveAskedGame(slug) {
    if (!(slug in askedCache)) {
      const g = getGames().find(x => gameSlug(x.title) === slug);
      askedCache[slug] = g
        ? { title: g.title, cover: g.cover_image || '', slots: slotsFreeFor(resolveSlotDays(resolveGamePrices(g)), askedAccountMap) }
        : null;
    }
    return askedCache[slug];
  }

  // Most Visited Pages counts PAGE VIEWS, not sessions — it answers "which
  // pages got looked at most", a different question from the session-scoped
  // funnel. It is computed independently over the FULL visitors[] array
  // (filtered by each row's own .date), not over sessionSummaries, so that:
  //   1) "Today's Most Visited Pages" always agrees with the "Today's Visits"
  //      KPI card (both count every row whose date is today), and
  //   2) rows with no session_id (e.g. everything recorded before session
  //      tracking launched) aren't silently dropped from "All-time".
  // System paths (/api/*, webhooks) are never a page someone looked at.
  function topPagesForWindow(dateFilter) {
    const pageCounts = {};
    (visitors || []).forEach(v => {
      if (!dateFilter(v.date) || visitorFilter.isSystemPath(v.path)) return;
      const key = v.page || v.path;
      pageCounts[key] = (pageCounts[key] || 0) + 1;
    });
    return Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }

  const winToday = new Date().toISOString().slice(0, 10);
  const winWeek  = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const winMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const winYear  = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  const visWindow = inWindow => ({
    ...visitorFunnel.buildWindow({ summaries: sessionSummaries, taps: messageTaps, misses: searchMisses, skips: visitorSkips, inWindow, resolveGame: resolveAskedGame }),
    topPages: topPagesForWindow(inWindow)
  });
  const VIS_WINDOWS = {
    today: visWindow(d => d === winToday),
    week:  visWindow(d => d >= winWeek),
    month: visWindow(d => d >= winMonth),
    year:  visWindow(d => d >= winYear),
    all:   visWindow(() => true),
    byDate: {}
  };

  // Only the fourteen chart bars are clickable, so only those dates need a
  // precomputed entry. This mirrors the same fourteen days the view's own
  // vLast14 chart renders.
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    VIS_WINDOWS.byDate[d] = visWindow(vd => vd === d);
  }

`.replace(/\n/g, nl);
  s = s.slice(0, a) + block + s.slice(b);
  fs.writeFileSync(file, s);
}
console.log('edited');
````

Run: `node .superpowers/tmp-edits/edit-task5.js` → `edited`.
Then: `node --check server.js && file server.js public/css/style.css views/partials/admin/dashboard/site.ejs` → all still CRLF; `server.js` still with BOM.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-dashboard-visitors.js` → `8 assertions passed`.
Run: `node scripts/test-admin-visitors-render.js` → `2 assertions passed`.
Run: `node scripts/test-psplus-routes.js && node scripts/test-dashboard.js && node scripts/test-visitor-tracking.js` → all pass.

- [ ] **Step 6: Commit**

```bash
git add public/js/dashboard-visitors.js scripts/test-dashboard-visitors.js scripts/test-admin-visitors-render.js server.js views/partials/admin/dashboard/site.ejs public/css/style.css
git commit -m "Dashboard: honest funnel with Messaged us, most asked-about games, missed searches

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Homepage "What game are you looking for?" search

**Files:**
- Create: `public/js/home-search-core.js`, `public/js/home-search.js`, `public/css/home-search.css`, `views/partials/home-search.ejs`, `scripts/test-home-search-core.js`, `scripts/test-home-search.js`
- Modify: `views/index.ejs` (LF + BOM — via the edit script)

**Interfaces:**
- Consumes: `GET /api/search-index` entries (`{ t, p, y, u, img, s, pr, d, v, k }`), `POST /api/track/search-miss` (Task 2), the global tap listener (Task 3) via `data-track-source="search-empty"`, `featured` (render local of `/`).
- Produces: `window.HomeSearchCore.{ norm, search, statusOf, requestHref, messengerHref }`.

- [ ] **Step 1: Write the tests**

Create `scripts/test-home-search-core.js`:

````js
// Run: node scripts/test-home-search-core.js
const assert = require('assert');
const c = require('../public/js/home-search-core.js');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const INDEX = [
  { t: 'God of War Ragnarök', p: 'PS5', y: 'now', s: 2, pr: 249, u: '/game/god-of-war-ragnarok', img: '/a.png' },
  { t: 'God of War (2018)', p: 'PS4', y: 'now', s: 0, pr: 199, u: '/game/god-of-war-2018', img: '' },
  { t: 'God of War III Remastered', p: 'Included in PS Plus Deluxe', y: 'psplus', u: '/ps-plus?game=c%3A1', img: '' },
  { t: 'Marvel’s Spider-Man', p: 'PS5', y: 'now', s: 1, pr: 299, u: '/game/spider-man', img: '' },
  { t: 'Silent Hill Townfall', p: 'PS5', y: 'soon', d: '2026-11-01', u: '/upcoming/silent-hill-townfall-3', img: '' },
  { t: 'Hades II', y: 'requested', v: 1, u: '/requests#req-hades-ii', img: '' },
  { t: 'PS Hub Main Account', p: 'PS5', y: 'now', s: 3, pr: 500, k: 'Hogwarts Legacy Elden Ring', u: '/game/ps-hub-main-account', img: '' }
];

console.log('\nnorm');
ok('lower-cases, strips accents and punctuation', () => {
  assert.strictEqual(c.norm('  God of War: Ragnarök! '), 'god of war ragnarok');
  assert.strictEqual(c.norm(null), '');
});

console.log('\nsearch');
ok('matches every typed word, title-first', () => {
  const r = c.search(INDEX, 'god of');
  assert.deepStrictEqual(r.map(x => x.t), ['God of War Ragnarök', 'God of War (2018)', 'God of War III Remastered']);
});
ok('rentable games rank ahead of other kinds when equally good', () => {
  const r = c.search(INDEX, 'war');
  // The bundle account matches only through its hidden keywords (Hogwarts), so it comes last.
  assert.deepStrictEqual(r.map(x => x.y), ['now', 'now', 'psplus', 'now']);
  assert.strictEqual(r[3].t, 'PS Hub Main Account');
});
ok('a phrase inside the title ranks below one that starts it', () => {
  const idx = [{ t: 'The God of War', y: 'now', s: 1 }, { t: 'God of War', y: 'now', s: 1 }];
  assert.deepStrictEqual(c.search(idx, 'god of war').map(x => x.t), ['God of War', 'The God of War']);
});
ok('punctuation and accents in the query do not matter', () => {
  assert.strictEqual(c.search(INDEX, 'ragnarok')[0].t, 'God of War Ragnarök');
  assert.strictEqual(c.search(INDEX, 'spider man')[0].u, '/game/spider-man');
});
ok('hidden bundle keywords find the bundle account', () => {
  assert.strictEqual(c.search(INDEX, 'elden ring')[0].t, 'PS Hub Main Account');
});
ok('empty query, no match and the limit', () => {
  assert.deepStrictEqual(c.search(INDEX, '   '), []);
  assert.deepStrictEqual(c.search(INDEX, 'zzzz'), []);
  assert.strictEqual(c.search(INDEX, 'god', 2).length, 2);
  assert.deepStrictEqual(c.search(undefined, 'god'), []);
});

console.log('\nstatusOf');
ok('rentable with slots, singular and plural', () => {
  assert.deepStrictEqual(c.statusOf(INDEX[0]), { kind: 'free', text: '● 2 slots free', price: 'from ₱249' });
  assert.strictEqual(c.statusOf(INDEX[3]).text, '● 1 slot free');
});
ok('fully booked', () => {
  assert.deepStrictEqual(c.statusOf(INDEX[1]), { kind: 'booked', text: '● Fully booked · Fall in line free', price: 'from ₱199' });
});
ok('coming soon, PS Plus and requested', () => {
  assert.deepStrictEqual(c.statusOf(INDEX[4]), { kind: 'soon', text: 'Coming soon · 2026-11-01', price: '' });
  assert.deepStrictEqual(c.statusOf(INDEX[2]), { kind: 'psplus', text: '★ Included in PS Plus Deluxe', price: 'Play via PS Plus' });
  assert.strictEqual(c.statusOf(INDEX[5]).text, 'Requested · 1 vote');
  assert.strictEqual(c.statusOf({ y: 'soon' }).text, 'Coming soon · TBA');
});

console.log('\nlinks');
ok('request and Messenger links carry what was typed', () => {
  assert.strictEqual(c.requestHref(' Elden Ring '), '/requests?title=Elden%20Ring');
  assert.strictEqual(c.messengerHref('Elden Ring'), 'http://m.me/PlaystationHub00?text=' + encodeURIComponent('Hi! Do you have Elden Ring? 🎮'));
});

console.log('\n' + passed + ' assertions passed\n');
````

Create `scripts/test-home-search.js`:

````js
// Run: node scripts/test-home-search.js
//
// Boots the real server against a throwaway DATA_DIR and a blank MONGODB_URI
// and checks the homepage: the "What game are you looking for?" strip sits
// above the hero with Popular chips built from the most-rented games, loads its
// stylesheet and scripts, and /api/search-index carries the fields the search
// draws (slots, price). The drawing script's ids must exist in the partial.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4594;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-search-'));
const game = (id, title, renters, cover) => ({
  id, title, platform: 'PS5', renters, cover_image: cover, nt_price_7d: 100 + id, nt_price_30d: 300, tr_price_7d: 120, tr_price_30d: 350
});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  games: [
    game(1, 'Zzyzx One', 50, '/uploads/one.png'),
    game(2, 'Zzyzx Two', 40, '/uploads/two.png'),
    game(3, 'Zzyzx Three', 30, ''),
    game(4, 'Zzyzx Four', 20, '/uploads/four.png'),
    game(5, 'Zzyzx Five', 10, '/uploads/five.png'),
    game(6, 'Zzyzx Six', 5, '/uploads/six.png')
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: p, timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Safari' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
  });
}

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/browse'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\nGET /');
  const home = await get('/');

  await okAsync('the homepage renders with the search strip above the hero', async () => {
    assert.strictEqual(home.status, 200);
    const strip = home.body.indexOf('id="homeSearch"');
    assert.ok(strip > 0, 'strip present');
    const hero = Math.min(...['class="hero-slideshow"', 'class="hero hero-custom-bg"', 'class="hero hero-v2"', 'id="heroSlideshow"']
      .map(m => home.body.indexOf(m)).filter(i => i > 0));
    assert.ok(strip < hero, 'strip comes before the hero');
    assert.ok(home.body.includes('What game are you looking for?'));
    assert.ok(home.body.includes('id="hsInput"') && home.body.includes('id="hsResults"') && home.body.includes('id="hsDim"'));
  });

  await okAsync('chips are the first four covered most-rented games, linking to their pages', async () => {
    const chips = [...home.body.matchAll(/<a class="hs-chip" href="([^"]+)">/g)].map(m => m[1]);
    assert.deepStrictEqual(chips, ['/game/zzyzx-one', '/game/zzyzx-two', '/game/zzyzx-four', '/game/zzyzx-five']);
  });

  await okAsync('the stylesheet and both scripts are requested', async () => {
    assert.ok(/<link rel="stylesheet" href="\/css\/home-search\.css\?v=[^"]+">/.test(home.body));
    assert.ok(/<script src="\/js\/home-search-core\.js\?v=[^"]+"><\/script>/.test(home.body));
    assert.ok(/<script src="\/js\/home-search\.js\?v=[^"]+" defer><\/script>/.test(home.body));
    for (const f of ['/css/home-search.css', '/js/home-search-core.js', '/js/home-search.js']) assert.strictEqual((await get(f)).status, 200, f);
  });

  console.log('\nGET /api/search-index');
  await okAsync('entries carry slots and a from-price for the search to show', async () => {
    const index = JSON.parse((await get('/api/search-index')).body);
    const one = index.find(x => x.t === 'Zzyzx One');
    assert.ok(one, 'game is in the index');
    assert.strictEqual(one.y, 'now');
    assert.strictEqual(typeof one.s, 'number');
    assert.strictEqual(one.pr, 101);
    assert.strictEqual(one.u, '/game/zzyzx-one');
  });

  console.log('\nscript ids');
  await okAsync('every element id the drawing script reads exists in the partial', async () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'home-search.js'), 'utf8');
    for (const id of [...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1])) {
      assert.ok(home.body.includes('id="' + id + '"'), id + ' missing from the rendered page');
    }
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-home-search-core.js` → FAIL `Cannot find module '../public/js/home-search-core.js'`.
Run: `node scripts/test-home-search.js` → FAIL (`strip present`).

- [ ] **Step 3: Create the pure core**

Create `public/js/home-search-core.js`:

````js
// The pure half of the homepage "What game are you looking for?" search:
// matching a typed phrase against /api/search-index entries and describing
// each hit. No DOM here, so it can be tested; public/js/home-search.js does
// the drawing.
//
// An index entry looks like { t: title, p: platform, y: 'now'|'soon'|'psplus'|
// 'requested', u: url, img, s: open slots, pr: from-price, d: release date,
// v: votes, k: hidden bundle keywords } — see GET /api/search-index.
(function (root) {
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Entries whose title (or hidden bundle keywords) contains every typed word,
  // best first: title starts with the phrase, then title contains the phrase,
  // then the rest; rentable games ('now') ahead of the other kinds on a tie.
  function search(index, query, limit) {
    var q = norm(query);
    if (!q) return [];
    var words = q.split(' ');
    var hits = [];
    (index || []).forEach(function (e, i) {
      var title = norm(e.t);
      var hay = title + ' ' + norm(e.k);
      if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return;
      var rank = title.indexOf(q) === 0 ? 0 : title.indexOf(q) > 0 ? 1 : 2;
      hits.push({ e: e, rank: rank, now: e.y === 'now' ? 0 : 1, i: i });
    });
    hits.sort(function (a, b) { return a.rank - b.rank || a.now - b.now || a.i - b.i; });
    return hits.slice(0, limit || 6).map(function (h) { return h.e; });
  }

  // How a result row describes itself: kind drives the colour, text is the
  // status line, price is the right-hand figure ('' when there is none).
  function statusOf(e) {
    if (e.y === 'now') {
      var price = e.pr ? 'from ₱' + e.pr : '';
      if (e.s > 0) return { kind: 'free', text: '● ' + e.s + ' slot' + (e.s === 1 ? '' : 's') + ' free', price: price };
      return { kind: 'booked', text: '● Fully booked · Fall in line free', price: price };
    }
    if (e.y === 'soon') return { kind: 'soon', text: 'Coming soon · ' + (e.d || 'TBA'), price: '' };
    if (e.y === 'psplus') return { kind: 'psplus', text: '★ Included in PS Plus Deluxe', price: 'Play via PS Plus' };
    if (e.y === 'requested') {
      var v = e.v || 0;
      return { kind: 'requested', text: 'Requested · ' + v + ' vote' + (v === 1 ? '' : 's'), price: '' };
    }
    return { kind: 'other', text: '', price: '' };
  }

  function requestHref(q) { return '/requests?title=' + encodeURIComponent(String(q || '').trim()); }
  function messengerHref(q) {
    return 'http://m.me/PlaystationHub00?text=' + encodeURIComponent('Hi! Do you have ' + String(q || '').trim() + '? 🎮');
  }

  var api = { norm: norm, search: search, statusOf: statusOf, requestHref: requestHref, messengerHref: messengerHref };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HomeSearchCore = api;
})(typeof window !== 'undefined' ? window : this);
````

- [ ] **Step 4: Create the partial, drawing script and stylesheet**

Create `views/partials/home-search.ejs`:

````ejs
<%#
  Homepage "What game are you looking for?" strip, above the hero. Visitors
  mostly arrive with a game in mind; this answers "do you have it, and is it
  free?" before they have to scroll. Results come from /api/search-index (the
  same list the nav search uses) and are drawn by public/js/home-search.js.
  Chips are the first four covered games of `featured`, the list behind the
  Most Popular slider.

  Locals: featured
%>
<% const hsChips = (featured || []).filter(g => g.cover_image).slice(0, 4); %>
<section class="hs" id="homeSearch" aria-label="Find a game">
  <h2 class="hs-title">What game are you looking for?</h2>
  <p class="hs-sub">See right away if it's free.</p>
  <div class="hs-box">
    <input type="search" id="hsInput" class="hs-input" placeholder="Type a game, e.g. God of War" aria-label="Search games" autocomplete="off" enterkeyhint="search">
    <div class="hs-results" id="hsResults" hidden></div>
  </div>
  <% if (hsChips.length) { %>
  <div class="hs-chips-label">🔥 Popular right now</div>
  <div class="hs-chips">
    <% hsChips.forEach(g => { %>
    <a class="hs-chip" href="/game/<%= g.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') %>"><img src="<%= g.cover_image %>" alt="" loading="lazy" decoding="async"><span><%= g.title %></span></a>
    <% }) %>
  </div>
  <% } %>
</section>
<div class="hs-dim" id="hsDim" hidden></div>
<script src="/js/home-search-core.js?v=<%= assetV %>"></script>
<script src="/js/home-search.js?v=<%= assetV %>" defer></script>
````

Create `public/js/home-search.js`:

````js
// Draws the homepage search (views/partials/home-search.ejs). Matching and
// status text live in home-search-core.js. The list is fetched once, on first
// focus, from the same /api/search-index the nav search uses.
(function () {
  var core = window.HomeSearchCore;
  var input = document.getElementById('hsInput');
  var box = document.getElementById('hsResults');
  var dim = document.getElementById('hsDim');
  if (!core || !input || !box || !dim) return;

  var index = null, failed = false, loading = false;
  var missTimer = null, lastMiss = '';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function load(done) {
    if (index || loading) return;
    loading = true;
    fetch('/api/search-index').then(function (r) { return r.json(); })
      .then(function (d) { index = Array.isArray(d) ? d : []; })
      .catch(function () { failed = true; })
      .then(function () { loading = false; if (done) done(); });
  }

  function open() { box.hidden = false; dim.hidden = false; }
  function close() { box.hidden = true; dim.hidden = true; }

  function row(e) {
    var st = core.statusOf(e);
    var a = el('a', 'hs-row' + (st.kind === 'booked' ? ' hs-row-booked' : ''));
    a.href = e.u;
    var img = el('img', 'hs-img');
    img.alt = '';
    if (e.img) img.src = e.img;
    img.loading = 'lazy';
    a.appendChild(img);
    var body = el('span', 'hs-body');
    body.appendChild(el('span', 'hs-name', e.t));
    body.appendChild(el('span', 'hs-meta hs-' + st.kind, st.text));
    a.appendChild(body);
    if (st.price) a.appendChild(el('span', 'hs-price', st.price));
    return a;
  }

  function emptyBlock(q) {
    var d = el('div', 'hs-empty');
    d.appendChild(el('div', 'hs-empty-t', 'Not the one?'));
    var req = el('a', 'hs-btn hs-btn-req', '📝 Request a game');
    req.href = core.requestHref(q);
    var msg = el('a', 'hs-btn hs-btn-msg', '💬 Ask us on Messenger');
    msg.href = core.messengerHref(q);
    msg.target = '_blank';
    msg.rel = 'noopener';
    msg.setAttribute('data-track-source', 'search-empty');
    d.appendChild(req);
    d.appendChild(msg);
    return d;
  }

  // A search that found nothing, reported once it has settled (1.2 s without
  // typing) so half-typed words are never counted.
  function scheduleMiss(q) {
    clearTimeout(missTimer);
    if (q.length < 3 || q === lastMiss) return;
    missTimer = setTimeout(function () {
      if (input.value.trim() !== q) return;
      lastMiss = q;
      var body = JSON.stringify({ q: q });
      try {
        if (navigator.sendBeacon && navigator.sendBeacon('/api/track/search-miss', new Blob([body], { type: 'application/json' }))) return;
        fetch('/api/track/search-miss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
      } catch (err) { /* tracking must never break the page */ }
    }, 1200);
  }

  function render() {
    var q = input.value.trim();
    box.textContent = '';
    if (!q) { close(); return; }
    open();
    if (failed) {
      var f = el('div', 'hs-empty');
      f.appendChild(el('div', 'hs-empty-t', 'Search is unavailable right now.'));
      var all = el('a', 'hs-btn hs-btn-req', 'Browse All Games');
      all.href = '/browse';
      f.appendChild(all);
      box.appendChild(f);
      return;
    }
    if (!index) { box.appendChild(el('div', 'hs-empty-t', 'Loading…')); return; }
    var hits = core.search(index, q, 6);
    if (!hits.length) { box.appendChild(emptyBlock(q)); scheduleMiss(core.norm(q)); return; }
    hits.forEach(function (e) { box.appendChild(row(e)); });
  }

  input.addEventListener('focus', function () { load(render); });
  input.addEventListener('input', function () { load(render); render(); });
  dim.addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  document.addEventListener('click', function (e) { if (!e.target.closest('.hs-box')) close(); });
})();
````

Create `public/css/home-search.css`:

````css
/* Homepage "What game are you looking for?" strip — views/partials/home-search.ejs */
.hs { position: relative; z-index: 30; max-width: 640px; margin: 0 auto; padding: 1.1rem 1rem 0.5rem; text-align: center; }
.hs-title { margin: 0; font-size: 1.15rem; font-weight: 900; color: #fff; }
.hs-sub { margin: 0.2rem 0 0.7rem; font-size: 0.82rem; color: #999; }
.hs-box { position: relative; text-align: left; }
.hs-input { width: 100%; box-sizing: border-box; padding: 0.85rem 1.1rem; border-radius: 50px; border: 2px solid #f0a500; background: #fff; color: #111; font-size: 1rem; font-weight: 600; outline: none; box-shadow: 0 6px 24px rgba(240, 165, 0, 0.22); }
.hs-input::placeholder { color: #888; font-weight: 500; }
.hs-results { position: absolute; left: 0; right: 0; top: calc(100% + 0.5rem); background: #141414; border: 1px solid #2a2a2a; border-radius: 14px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7); overflow: hidden; max-height: 70vh; overflow-y: auto; }
.hs-results[hidden], .hs-dim[hidden] { display: none; }
.hs-dim { position: fixed; inset: 0; z-index: 20; background: rgba(0, 0, 0, 0.45); }
.hs-row { display: flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0.75rem; border-top: 1px solid #1f1f1f; color: #fff; text-decoration: none; }
.hs-row:first-child { border-top: 0; }
.hs-row:hover, .hs-row:focus-visible { background: #1b1b1b; }
.hs-img { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: #222; flex: none; }
.hs-row-booked .hs-img { filter: grayscale(0.6); }
.hs-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.hs-name { font-size: 0.9rem; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hs-meta { font-size: 0.74rem; font-weight: 800; }
.hs-free { color: #22c55e; }
.hs-booked { color: #f87171; }
.hs-soon { color: #60a5fa; }
.hs-psplus { color: #ffd700; }
.hs-requested { color: #a78bfa; }
.hs-price { flex: none; font-size: 0.8rem; font-weight: 800; color: #fff; text-align: right; }
.hs-empty { padding: 0.9rem; text-align: center; }
.hs-empty-t { font-size: 0.82rem; color: #aaa; padding: 0.6rem 0.9rem; }
.hs-empty .hs-empty-t { padding: 0 0 0.5rem; }
.hs-btn { display: inline-block; margin: 0.2rem; padding: 0.5rem 0.9rem; border-radius: 50px; font-size: 0.8rem; font-weight: 800; text-decoration: none; }
.hs-btn-req { background: #1e293b; color: #93c5fd; }
.hs-btn-msg { background: #1877f2; color: #fff; }
.hs-chips-label { margin: 0.9rem 0 0.4rem; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #777; }
.hs-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.4rem; }
.hs-chip { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.2rem 0.75rem 0.2rem 0.2rem; background: #161616; border: 1px solid #2a2a2a; border-radius: 50px; color: #ddd; font-size: 0.78rem; font-weight: 700; text-decoration: none; max-width: 100%; }
.hs-chip img { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; flex: none; }
.hs-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 480px) { .hs-chips { flex-wrap: nowrap; overflow-x: auto; justify-content: flex-start; scrollbar-width: none; } .hs-chip { flex: none; } }
````

- [ ] **Step 5: Include the strip in the homepage**

Create `.superpowers/tmp-edits/edit-task7.js` (adds the stylesheet link and includes the partial directly above the hero, before `const heroSlides`):

````js
const rep = require('./rep');
rep('views/index.ejs',
`  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
`,
`  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
  <link rel="stylesheet" href="/css/home-search.css?v=<%= assetV %>">
`);
rep('views/index.ejs',
`<% const heroSlides = settings.hero_slides && settings.hero_slides.length > 0 ? settings.hero_slides : null; %>
`,
`<%- include('partials/home-search', { featured }) %>

<% const heroSlides = settings.hero_slides && settings.hero_slides.length > 0 ? settings.hero_slides : null; %>
`);
console.log('edited');
````

Run: `node .superpowers/tmp-edits/edit-task7.js` → `edited`. Then `file views/index.ejs` → still `UTF-8 (with BOM)`.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `node scripts/test-home-search-core.js` → `11 assertions passed`.
Run: `node scripts/test-home-search.js` → `5 assertions passed`.
Run: `node scripts/test-js-extraction-index.js && node scripts/test-homepage-carousel.js` → pass.

- [ ] **Step 7: Look at it in a browser (fixture instance, never production)**

Start a throwaway server: `DATA_DIR=$(mktemp -d) MONGODB_URI= PORT=4601 node server.js` with a seeded `games.json` like the one in `scripts/test-home-search.js`; open `http://localhost:4601/` at 390px width. Check: the strip is the first thing under the nav; typing "zz" shows result rows with a free/booked line; typing nonsense shows "Not the one?" with two buttons; Escape closes. Stop the server and delete the temp dir.

- [ ] **Step 8: Commit**

```bash
git add public/js/home-search-core.js public/js/home-search.js public/css/home-search.css views/partials/home-search.ejs views/index.ejs scripts/test-home-search-core.js scripts/test-home-search.js
git commit -m "Homepage: search by game name with live availability

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Messenger-first game page, then final regression

**Files:**
- Create: `public/js/messenger-text.js`, `scripts/test-messenger-text.js`, `scripts/test-game-detail-messenger.js`
- Modify: `views/game-detail.ejs`, `public/js/game-detail.js` (both LF), `public/css/style.css` (CRLF)

**Interfaces:**
- Consumes: global tap listener (Task 3) — the big button carries `data-track-source="game"`.
- Produces: `window.PHMessengerText.{ buildMessage({ title, typeLabel, daysLabel, totalLine, booked }), messengerHref(text) }`; in `game-detail.js`: `isBookedNow()`, `toggleOrderBlock(forceOpen?)`; elements `#ctaMsgPrimary`, `#ctaMsgMain`, `#ctaMsgSub`, `#ctaMsgPreview`, `#orderToggle`, `#gdOrderBlock`. Removed: `#ctaMsgLink`, `#ctaHint`, `handleMessageUs`.

- [ ] **Step 1: Write the tests**

Create `scripts/test-messenger-text.js`:

````js
// Run: node scripts/test-messenger-text.js
const assert = require('assert');
const m = require('../public/js/messenger-text.js');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

console.log('\nbuildMessage');
ok('nothing picked: just the game', () => {
  assert.strictEqual(m.buildMessage({ title: 'Resident Evil Requiem' }), 'Hi! I want to RENT a game 🎮\nGame: Resident Evil Requiem');
});
ok('type and duration picked: both lines and the total, same wording as before', () => {
  assert.strictEqual(m.buildMessage({
    title: 'Resident Evil Requiem', typeLabel: 'Trophy Account', daysLabel: '7 Days',
    totalLine: 'Total: ₱399 + ₱100 refundable deposit'
  }), 'Hi! I want to RENT a game 🎮\nGame: Resident Evil Requiem\nAccount Type: Trophy Account\nDuration: 7 Days\nTotal: ₱399 + ₱100 refundable deposit');
});
ok('only a type picked', () => {
  assert.strictEqual(m.buildMessage({ title: 'X', typeLabel: 'Non-Trophy Account' }), 'Hi! I want to RENT a game 🎮\nGame: X\nAccount Type: Non-Trophy Account');
});
ok('booked: asks about the next slot, keeps type and duration, drops the total', () => {
  assert.strictEqual(m.buildMessage({ title: 'X', booked: true }), 'Hi! I\'m interested in X 🎮\nI saw it\'s fully booked — when is the next slot?');
  assert.strictEqual(m.buildMessage({ title: 'X', booked: true, typeLabel: 'Trophy Account', daysLabel: '30 Days', totalLine: 'Total: ₱1' }),
    'Hi! I\'m interested in X 🎮\nI saw it\'s fully booked — when is the next slot?\nAccount Type: Trophy Account\nDuration: 30 Days');
});
ok('no options at all does not throw', () => {
  assert.ok(m.buildMessage().includes('RENT'));
});

console.log('\nmessengerHref');
ok('opens the page with the text URL-encoded', () => {
  assert.strictEqual(m.messengerHref('Hi! Game: A & B\nx'), 'http://m.me/PlaystationHub00?text=' + encodeURIComponent('Hi! Game: A & B\nx'));
});

console.log('\n' + passed + ' assertions passed\n');
````

Create `scripts/test-game-detail-messenger.js` (boots a throwaway instance for the markup, then runs `game-detail.js` in a vm with a stub DOM):

````js
// Run: node scripts/test-game-detail-messenger.js
//
// The Messenger-first rent box on a game page. Two parts:
//  1. Boots the real server against a throwaway DATA_DIR (blank MONGODB_URI) and
//     checks the rendered markup for a game with open slots and a fully booked
//     one.
//  2. Runs public/js/game-detail.js in a vm with a stub DOM to check the message
//     preview, link, labels, order toggle and sticky bar.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');

const PORT = 4595;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-messenger-'));
const base = { platform: 'PS5', nt_price_7d: 399, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 799, non_trophy_slots: 0, trophy_slots: 0 };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  games: [
    Object.assign({ id: 1, title: 'Zzyzx Open Game', non_trophy_slots: 2, trophy_slots: 1 }, base, { non_trophy_slots: 2, trophy_slots: 1 }),
    Object.assign({ id: 2, title: 'Zzyzx Booked Game' }, base)
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: p, timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Safari' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
  });
}

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

// ── stub DOM for game-detail.js ──
function loadPage({ allUnavail, avail }) {
  const els = {};
  const clicks = [];
  const mk = id => (els[id] = {
    id, href: '', textContent: '', hidden: false, value: '', disabled: false,
    style: {}, dataset: { defaultAmount: '399', defaultBuyAmount: '0' },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(k, v) { this.attrs = Object.assign(this.attrs || {}, { [k]: v }); },
    scrollIntoView() {},
    click() { clicks.push(id); }
  });
  ['ctaMsgPrimary', 'ctaMsgMain', 'ctaMsgSub', 'ctaMsgPreview', 'gdOrderBlock', 'orderToggle', 'gdSbKicker', 'gdSbAmount', 'gdSbBtn',
    'ctaBtn', 'ctaSub', 'reserveSection', 'gdOrderForm', 'totalBox', 'orderType', 'orderDays', 'phAmount'].forEach(mk);
  const ctx = {
    console, window: { addEventListener() {}, location: { search: '' } },
    document: { getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    PRICES: { nt: { 7: 399, 30: 799 }, tr: { 7: 399, 30: 799 }, ps4: { 7: 399, 30: 799 } },
    BUY_PRICES: { nt: 0, tr: 0 },
    PROMO: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 },
    AVAIL: avail, ALL_UNAVAIL: allUnavail, gameTitle: 'Zzyzx Open Game', gdSlideCount: 0, RENTAL_DURATIONS: [7, 30],
    PHMessengerText: require('../public/js/messenger-text.js')
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game-detail.js'), 'utf8'), ctx);
  return { ctx, els, clicks, run: code => vm.runInContext(code, ctx) };
}

async function main() {
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/browse'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\nrendered page, open game');
  const open = await get('/game/zzyzx-open-game');
  await okAsync('has the big Messenger button, preview, collapsed website order, and no old link or hint', async () => {
    assert.strictEqual(open.status, 200);
    assert.ok(/<a href="http:\/\/m\.me\/PlaystationHub00" target="_blank" rel="noopener" class="gd-msg-primary" id="ctaMsgPrimary" data-track-source="game">/.test(open.body));
    assert.ok(open.body.includes('💬 Message us about this game'));
    assert.ok(open.body.includes('YOUR MESSAGE WILL SAY') && open.body.includes('id="ctaMsgPreview"'));
    assert.ok(/<div id="gdOrderBlock" hidden>/.test(open.body), 'order block starts collapsed');
    assert.ok(open.body.includes('id="orderToggle"') && open.body.includes('Or order here on the website'));
    assert.ok(open.body.includes('id="gdOrderForm"'), 'the website order form is still there');
    assert.ok(!open.body.includes('id="ctaMsgLink"') && !open.body.includes('id="ctaHint"'));
    assert.ok(/id="gdSbBtn"[^>]*>💬 Message us<\/button>/.test(open.body));
  });
  await okAsync('loads messenger-text.js before game-detail.js', async () => {
    const a = open.body.indexOf('/js/messenger-text.js?v=');
    const b = open.body.indexOf('/js/game-detail.js?v=');
    assert.ok(a > 0 && b > a);
  });
  await okAsync('a failed website order (?order_error=1) reopens the order block', async () => {
    const r = await get('/game/zzyzx-open-game?order_error=1');
    assert.ok(/<div id="gdOrderBlock">/.test(r.body));
    assert.ok(/aria-expanded="true"/.test(r.body));
  });

  console.log('\nrendered page, fully booked game');
  await okAsync('says Ask us, has no website-order toggle or block, keeps the queue options', async () => {
    const r = await get('/game/zzyzx-booked-game');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('💬 Ask us about this game'));
    assert.ok(/We(&#39;|')ll tell you when it frees up/.test(r.body), 'EJS escapes the apostrophe');
    assert.ok(!r.body.includes('id="orderToggle"') && !r.body.includes('id="gdOrderBlock"'));
    assert.ok(r.body.includes('id="reserveSectionAll"'));
    assert.ok(/id="gdSbBtn"[^>]*>💬 Ask us<\/button>/.test(r.body));
  });

  console.log('\ngame-detail.js, open game');
  await okAsync('nothing picked: the link and preview name only the game', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: true, ps4: false } });
    p.run('updateReserveLinks()');
    const text = 'Hi! I want to RENT a game 🎮\nGame: Zzyzx Open Game';
    assert.strictEqual(p.els.ctaMsgPreview.textContent, text);
    assert.strictEqual(p.els.ctaMsgPrimary.href, 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(text));
    assert.strictEqual(p.els.ctaMsgMain.textContent, '💬 Message us about this game');
  });
  await okAsync('type and duration picked: they and the total join the message', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: true, ps4: false } });
    p.run("selectedType = 'tr'; selectedDays = 30; updateReserveLinks()");
    assert.strictEqual(p.els.ctaMsgPreview.textContent,
      'Hi! I want to RENT a game 🎮\nGame: Zzyzx Open Game\nAccount Type: Trophy Account\nDuration: 30 Days\nTotal: ₱819 (incl. 10% promo discount) + ₱100 refundable deposit');
  });
  await okAsync('picking a full type switches the wording to a next-slot question', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: false, ps4: false } });
    p.run("selectedType = 'tr'; updateReserveLinks()");
    assert.ok(p.els.ctaMsgPreview.textContent.startsWith("Hi! I'm interested in Zzyzx Open Game"));
    assert.strictEqual(p.els.ctaMsgMain.textContent, '💬 Ask us about this game');
  });
  await okAsync('the website-order toggle opens and closes the block', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: true, ps4: false } });
    p.els.gdOrderBlock.hidden = true;
    p.run('toggleOrderBlock()');
    assert.strictEqual(p.els.gdOrderBlock.hidden, false);
    assert.strictEqual(p.els.orderToggle.attrs['aria-expanded'], 'true');
    p.run('toggleOrderBlock()');
    assert.strictEqual(p.els.gdOrderBlock.hidden, true);
    assert.strictEqual(p.els.orderToggle.attrs['aria-expanded'], 'false');
  });
  await okAsync('a type with no slot hides the website-order toggle; a type with a slot shows it', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: false, ps4: false } });
    p.run("selectedType = 'tr'; updateCtaState()");
    assert.strictEqual(p.els.orderToggle.style.display, 'none');
    p.run("selectedType = 'nt'; updateCtaState()");
    assert.strictEqual(p.els.orderToggle.style.display, '');
  });
  await okAsync('the sticky bar button is the Messenger button, never "waiting"', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: true, ps4: false } });
    p.run('syncStickyBar()');
    assert.strictEqual(p.els.gdSbBtn.textContent, '💬 Message us');
    assert.strictEqual(p.els.gdSbKicker.textContent, 'From');
    p.run("selectedType = 'nt'; selectedDays = 7; syncStickyBar()");
    assert.strictEqual(p.els.gdSbKicker.textContent, 'Your total');
    assert.strictEqual(p.els.gdSbAmount.textContent, '₱399');
    p.run('handleStickyBarClick()');
    assert.deepStrictEqual(p.clicks, ['ctaMsgPrimary'], 'tapping the bar taps the big button');
  });

  console.log('\ngame-detail.js, fully booked game');
  await okAsync('every type full: Ask us wording from the start', async () => {
    const p = loadPage({ allUnavail: true, avail: { nt: false, tr: false, ps4: false } });
    p.run('updateReserveLinks(); syncStickyBar()');
    assert.ok(p.els.ctaMsgPreview.textContent.includes('fully booked'));
    assert.strictEqual(p.els.gdSbBtn.textContent, '💬 Ask us');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-messenger-text.js` → FAIL `Cannot find module '../public/js/messenger-text.js'`.
Run: `node scripts/test-game-detail-messenger.js` → FAIL (`id="ctaMsgPrimary"` missing).

- [ ] **Step 3: Create the message builder**

Create `public/js/messenger-text.js`:

````js
// The message a customer sends when they tap "Message us about this game" on a
// game page, and the m.me link that opens it prefilled. Pure, so it can be
// tested; public/js/game-detail.js keeps the button, the preview and the link
// in step with what they have picked. Type and duration are optional.
(function (root) {
  // opts: { title, typeLabel, daysLabel, totalLine, booked }
  //   booked — nothing can be rented right now, so the message asks about the
  //   next slot instead of placing a rental request.
  function buildMessage(opts) {
    var o = opts || {};
    var lines = o.booked
      ? ['Hi! I\'m interested in ' + o.title + ' 🎮', 'I saw it\'s fully booked — when is the next slot?']
      : ['Hi! I want to RENT a game 🎮', 'Game: ' + o.title];
    if (o.typeLabel) lines.push('Account Type: ' + o.typeLabel);
    if (o.daysLabel) lines.push('Duration: ' + o.daysLabel);
    if (o.totalLine && !o.booked) lines.push(o.totalLine);
    return lines.join('\n');
  }

  function messengerHref(text) {
    return 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(text);
  }

  var api = { buildMessage: buildMessage, messengerHref: messengerHref };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PHMessengerText = api;
})(typeof window !== 'undefined' ? window : this);
````

- [ ] **Step 4: Rework the rent box**

Create `.superpowers/tmp-edits/edit-task9.js`. It (a) inserts the big button, the message preview, the "Or order here on the website" toggle and the opening `<div id="gdOrderBlock">` before the price summary in `game-detail.ejs`, closes the block after the form and removes `#ctaMsgLink` / `#ctaHint`, (b) makes the sticky bar button Messenger, (c) loads `messenger-text.js` before `game-detail.js`, (d) in `game-detail.js` adds `isBookedNow` / `toggleOrderBlock`, rewrites `updateCtaState` (no hint/link handling; hides the toggle for a full type), switches the rent half of `syncStickyBar` and `handleStickyBarClick` to the Messenger button, builds the link/preview/labels in `updateReserveLinks` and deletes `handleMessageUs`, (e) appends the new rent-box styles to `style.css`:

````js
const fs = require('fs');
const rep = require('./rep');

function repBetween(file, startMarker, endMarker, replacement) {
  const s = fs.readFileSync(file, 'utf8');
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a + 1);
  if (a < 0 || b < 0) throw new Error('markers not found: ' + startMarker.slice(0, 50) + ' … ' + endMarker.slice(0, 50));
  if (s.indexOf(startMarker, a + 1) >= 0) throw new Error('start marker not unique: ' + startMarker.slice(0, 50));
  fs.writeFileSync(file, s.slice(0, a) + replacement + s.slice(b));
}

// ── views/game-detail.ejs ────────────────────────────────────────────────
const V = 'views/game-detail.ejs';
rep(V, `        <!-- TOTAL BREAKDOWN -->
        <div class="gd-total-box" id="totalBox">`,
`        <!-- PRIMARY: Messenger. It always opens, whatever has (or has not) been
             picked; a picked type and duration just fill in the message. -->
        <a href="http://m.me/PlaystationHub00" target="_blank" rel="noopener" class="gd-msg-primary" id="ctaMsgPrimary" data-track-source="game">
          <span class="gd-msg-main" id="ctaMsgMain"><%= allUnavail ? '💬 Ask us about this game' : '💬 Message us about this game' %></span>
          <span class="gd-msg-sub" id="ctaMsgSub"><%= allUnavail ? "We'll tell you when it frees up — or suggest a similar one" : 'Opens Messenger · we reply fastest there' %></span>
        </a>
        <div class="gd-msg-preview">
          <div class="gd-msg-preview-label">YOUR MESSAGE WILL SAY</div>
          <div class="gd-msg-preview-text" id="ctaMsgPreview"></div>
        </div>
        <% if (!allUnavail) { %>
        <!-- SECONDARY: order on the website. Tapping opens the price summary,
             name field and pay button below. -->
        <button type="button" class="gd-alt-order" id="orderToggle" aria-expanded="<%= order_error === '1' ? 'true' : 'false' %>" aria-controls="gdOrderBlock" onclick="toggleOrderBlock()">
          Or order here on the website
          <small>Pay by GCash / Maya / card</small>
        </button>
        <div id="gdOrderBlock"<%= order_error === '1' ? '' : ' hidden' %>>
        <% } %>

        <!-- TOTAL BREAKDOWN -->
        <div class="gd-total-box" id="totalBox">`);

rep(V, `        <!-- Primary: order on the site. Runs the name field and the price
             button as one action — no separate "or" section. -->`,
`        <!-- Website order: the name field and the price button run as one
             action. Lives inside #gdOrderBlock, opened by #orderToggle. -->`);

rep(V, `        </form>

        <!-- Secondary: Messenger, always one tap away -->
        <a href="#" class="gd-cta-link" id="ctaMsgLink" onclick="return handleMessageUs(event)">or message us on Facebook instead</a>
        <div class="gd-cta-hint" id="ctaHint" style="display:none;">Send us: <strong>Game name · Days · Trophy or Non-Trophy</strong></div>
`,
`        </form>
        </div><!-- /gdOrderBlock -->
`);

rep(V, `onclick="handleStickyBarClick()">Pick a type</button>`, `onclick="handleStickyBarClick()"><%= allUnavail ? '💬 Ask us' : '💬 Message us' %></button>`);
rep(V, `<script src="/js/game-detail.js?v=<%= assetV %>"></script>`,
`<script src="/js/messenger-text.js?v=<%= assetV %>"></script>
<script src="/js/game-detail.js?v=<%= assetV %>"></script>`);

// ── public/js/game-detail.js ─────────────────────────────────────────────
const J = 'public/js/game-detail.js';

repBetween(J, '// CTA label tracks how much is left to pick.', '// Mirrors whichever mode is active',
`// Booked = nothing can be rented right now for what they are looking at: every
// type is full, or the type they picked is. The Messenger message then asks
// about the next slot instead of requesting a rental.
function isBookedNow() {
  return ALL_UNAVAIL || (!!selectedType && AVAIL[selectedType] === false);
}

// Opens / closes the website-order block (price summary, name field, pay
// button). Messenger is the main way to rent; this is the second option.
function toggleOrderBlock(forceOpen) {
  const block = document.getElementById('gdOrderBlock');
  const btn = document.getElementById('orderToggle');
  if (!block) return;
  const open = typeof forceOpen === 'boolean' ? forceOpen : block.hidden;
  block.hidden = !open;
  if (btn) btn.setAttribute('aria-expanded', String(open));
  if (open) block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// The website-order block's button label tracks how much is left to pick.
// Never disabled — an incomplete click scrolls to and shakes the first missing
// step. (The Messenger button above it has no such gate; see updateReserveLinks.)
function updateCtaState() {
  const ctaBtn = document.getElementById('ctaBtn');
  const ctaSub = document.getElementById('ctaSub');
  const reserveSection = document.getElementById('reserveSection');
  // The rent form and the price summary both belong to a booking that cannot
  // happen when the selected type has no slot. Hiding the whole form (not
  // just its button) is what removes the stranded, unlabelled name input that
  // used to sit above the no-slot banner with nothing to submit it.
  const orderForm = document.getElementById('gdOrderForm');
  const totalBox = document.getElementById('totalBox');
  const orderToggle = document.getElementById('orderToggle');
  // Every type full: #gdOrderForm and #ctaBtn were never rendered, so the
  // logic below (which reads them) doesn't apply — only #totalBox needs
  // hiding here, matching the per-type no-slot case above it.
  // The reserve form's hidden type/days fields exist in two flavours: the
  // suffix:'' instance (per-type no-slot) and the suffix:'All' instance (every
  // type sold out). Keep whichever ones are in the DOM in sync with the
  // current selection — including in the ALL_UNAVAIL branch, which returns
  // early below before the suffix:'' writes further down.
  ['', 'All'].forEach(function (sfx) {
    const rt = document.getElementById('resType' + sfx);
    const rd = document.getElementById('resDays' + sfx);
    if (rt) rt.value = selectedType || '';
    if (rd) rd.value = selectedDays || '';
  });

  if (ALL_UNAVAIL) {
    if (totalBox) totalBox.style.display = 'none';
    return;
  }
  if (!ctaBtn) return;

  const oType = document.getElementById('orderType');
  const oDays = document.getElementById('orderDays');
  if (oType) oType.value = selectedType || '';
  if (oDays) oDays.value = selectedDays || '';

  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (selectedType && !hasSlot) {
    ctaBtn.style.display = 'none';
    if (ctaSub) ctaSub.style.display = 'none';
    // Quoting "To send now ₱349" for a type that cannot be booked reads as a
    // price for something unavailable, so the summary goes with the form — and
    // so does the toggle that would open them.
    if (orderForm) orderForm.style.display = 'none';
    if (totalBox) totalBox.style.display = 'none';
    if (orderToggle) orderToggle.style.display = 'none';
    if (reserveSection) reserveSection.style.display = '';
    return;
  }
  ctaBtn.style.display = '';
  if (orderForm) orderForm.style.display = '';
  if (totalBox) totalBox.style.display = '';
  if (orderToggle) orderToggle.style.display = '';
  if (reserveSection) reserveSection.style.display = 'none';

  if (!selectedType) {
    ctaBtn.textContent = 'Pick an account type';
    ctaBtn.classList.add('gd-cta-wait');
    ctaBtn.disabled = true;
    if (ctaSub) ctaSub.style.display = 'none';
  } else if (!selectedDays) {
    ctaBtn.textContent = 'Pick a duration';
    ctaBtn.classList.add('gd-cta-wait');
    ctaBtn.disabled = true;
    if (ctaSub) ctaSub.style.display = 'none';
  } else {
    const rt = computeRentTotal(selectedType, selectedDays);
    ctaBtn.textContent = '🎮 Rent now — ₱' + rt.total;
    ctaBtn.classList.remove('gd-cta-wait');
    ctaBtn.disabled = false;
    if (ctaSub) ctaSub.style.display = '';
  }
}

`);

// The rent half of syncStickyBar: the bar's button is now the Messenger button.
repBetween(J, `  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (selectedType && !hasSlot) {
    // The bar has to quote what its button actually leads to`, 'function handleStickyBarClick() {',
`  // The bar's button is the same Messenger action as the big button on the
  // page, so it is never "waiting" — only the figure on its left changes.
  bEl.classList.remove('gd-cta-wait');
  bEl.textContent = isBookedNow() ? '💬 Ask us' : '💬 Message us';
  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (selectedType && !hasSlot) {
    // The figure quotes what getting in line costs — not the rent price, which
    // is the one thing you cannot do for this type. Priority is a flat ₱100;
    // Fall in Line is free.
    const kindEl = document.querySelector('.gd-noslot-options input[id^="resKind"]');
    const isQueue = !!kindEl && kindEl.value === 'queue';
    kEl.textContent = 'No slot right now';
    aEl.textContent = isQueue ? 'Free' : '₱100';
  } else if (!selectedType || !selectedDays) {
    const amtEl = document.getElementById('phAmount');
    kEl.textContent = 'From';
    aEl.textContent = '₱' + (amtEl ? amtEl.dataset.defaultAmount : '0');
  } else {
    const rt = computeRentTotal(selectedType, selectedDays);
    kEl.textContent = 'Your total';
    aEl.textContent = '₱' + rt.total;
  }
}

`);

repBetween(J, `  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (selectedType && !hasSlot) {
    (document.getElementById('reserveSection')`, 'function updateReserveLinks() {',
`  // Rent mode: the bar's button is the Messenger button.
  document.getElementById('ctaMsgPrimary')?.click();
}

`);

rep(J, `  const ctaMsgLink = document.getElementById('ctaMsgLink');
  if (ctaMsgLink) {
    ctaMsgLink.href = 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(['Hi! I want to RENT a game 🎮','Game: '+gameTitle,typeLabel?'Account Type: '+typeLabel:'',daysLabel?'Duration: '+daysLabel:'',totalLine].filter(Boolean).join('\\n'));
  }
`,
`  // The big Messenger button, its preview and its wording. Type and duration
  // are optional: whatever is picked is added to the message.
  const booked = isBookedNow();
  const msgText = PHMessengerText.buildMessage({ title: gameTitle, typeLabel, daysLabel, totalLine, booked });
  const msgLink = document.getElementById('ctaMsgPrimary');
  if (msgLink) msgLink.href = PHMessengerText.messengerHref(msgText);
  const msgMain = document.getElementById('ctaMsgMain');
  if (msgMain) msgMain.textContent = booked ? '💬 Ask us about this game' : '💬 Message us about this game';
  const msgSub = document.getElementById('ctaMsgSub');
  if (msgSub) msgSub.textContent = booked ? "We'll tell you when it frees up — or suggest a similar one" : 'Opens Messenger · we reply fastest there';
  const msgPreview = document.getElementById('ctaMsgPreview');
  if (msgPreview) msgPreview.textContent = msgText;
`);

repBetween(J, 'function handleMessageUs(e) {', 'function showValidation(msg) {', '');

// ── public/css/style.css ─────────────────────────────────────────────────
rep('public/css/style.css',
`.gd-cta-hint { text-align: center; font-size: 0.75rem; color: #444; margin-top: 0.5rem; }
`,
`.gd-cta-hint { text-align: center; font-size: 0.75rem; color: #444; margin-top: 0.5rem; }
/* Messenger-first rent box: the big button, the preview of what it sends, and the
   secondary "order on the website" toggle. */
.gd-msg-primary { display: block; text-align: center; text-decoration: none; margin-top: 0.9rem; padding: 0.95rem 0.8rem; border-radius: 14px; background: linear-gradient(90deg, #1877f2, #7b3fe4); color: #fff; box-shadow: 0 8px 24px rgba(24, 119, 242, 0.3); }
.gd-msg-primary:hover { opacity: 0.92; }
.gd-msg-main { display: block; font-size: 1.05rem; font-weight: 900; }
.gd-msg-sub { display: block; margin-top: 0.15rem; font-size: 0.74rem; font-weight: 600; opacity: 0.85; }
.gd-msg-preview { margin-top: 0.6rem; padding: 0.55rem 0.7rem; background: #16202f; border: 1px dashed #2d4a73; border-radius: 10px; }
.gd-msg-preview-label { font-size: 0.62rem; font-weight: 800; letter-spacing: 0.06em; color: #7fb1ff; margin-bottom: 0.2rem; }
.gd-msg-preview-text { font-size: 0.76rem; line-height: 1.5; color: #b7cbe6; white-space: pre-line; overflow-wrap: anywhere; }
.gd-alt-order { display: block; width: 100%; margin-top: 0.7rem; padding: 0.65rem; background: transparent; border: 1px solid #333; border-radius: 12px; color: #ddd; font-size: 0.85rem; font-weight: 800; cursor: pointer; text-align: center; }
.gd-alt-order small { display: block; margin-top: 0.1rem; font-size: 0.7rem; font-weight: 600; color: #777; }
.gd-alt-order:hover { border-color: #555; }
#gdOrderBlock { margin-top: 0.75rem; }
#gdOrderBlock[hidden] { display: none; }
`);
console.log('edited');
````

Run: `node .superpowers/tmp-edits/edit-task9.js` → `edited`.
Then: `node --check public/js/game-detail.js && file views/game-detail.ejs public/js/game-detail.js public/css/style.css` → the first two LF, `style.css` CRLF. `grep -n "ctaMsgLink\|ctaHint\|handleMessageUs" views/game-detail.ejs public/js/game-detail.js` → no output.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-messenger-text.js` → `6 assertions passed`.
Run: `node scripts/test-game-detail-messenger.js` → `11 assertions passed`.
Run: `node scripts/test-js-extraction-game-detail.js` → `7 assertions passed`.

- [ ] **Step 6: Look at it in a browser (fixture instance, never production)**

Start a throwaway server as in Task 6 step 7 with the two games from `scripts/test-game-detail-messenger.js`; open `/game/zzyzx-open-game` and `/game/zzyzx-booked-game` at 390px. Check: big blue button under the pickers, preview text updates as you pick a type/duration, "Or order here on the website" opens the name field and pay button, the bottom bar shows "💬 Message us" (or "💬 Ask us" on the booked game) and tapping it opens the same Messenger link; no horizontal scroll. Stop the server and delete the temp dir.

- [ ] **Step 7: Commit**

```bash
git add public/js/messenger-text.js scripts/test-messenger-text.js scripts/test-game-detail-messenger.js views/game-detail.ejs public/js/game-detail.js public/css/style.css
git commit -m "Game page: Message us is the main button; website order is secondary

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Full regression and cleanup**

Run every test file and list failures:

```bash
fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail of $(ls scripts/test-*.js | wc -l)"
```
Expected: `FAIL scripts/test-requests-page.js` only (pre-existing), `failed: 1`.

Then remove the scratch edit scripts and confirm the working tree is clean:

```bash
rm -rf .superpowers/tmp-edits && git status --short
```
Expected: no output except possibly the untracked, unrelated `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.

Do not push; tell the owner it is ready and wait for "push".
