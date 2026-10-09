# Homepage Redesign ("Arcade Store") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 17-section homepage with the "arcade store" layout: compact search + one-line tagline, "Now playing" banner with a Top rented list, Power-up and trust lines, quick picks, game shelves, Coming soon, PS Plus card, Choose your player, Achievements, How to play + FAQ — in plain top-to-bottom order on every screen size.

**Architecture:** A pure `lib/home-view.js` decides what the blocks show (banner games, Top rented ranking, Power-up, trust figures, starting prices, quick genres); `server.js` `GET /` passes it as `home`. `views/index.ejs` is rewritten to include one partial per block from `views/partials/home/`, styled by `public/css/home.css`; `public/js/home.js` drives the banner. Admin gets a "Homepage banner" picker (`site_settings.home_banner_ids`).

**Tech Stack:** Node, Express, EJS, lowdb v1, plain CSS/JS. Tests are `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-10-homepage-arcade-store-design.md`

## Global Constraints

- Work directly on `main`; commit per task; **push only when the owner says "push"**.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Line endings** (the provided scripts keep them; verify with `file`): `server.js` CRLF + UTF-8 BOM; `views/index.ejs` LF + BOM; `public/css/style.css`, `views/partials/admin/settings.ejs`, `views/partials/upcoming-section.ejs` CRLF; `views/admin.ejs`, `views/partials/admin/content.ejs`, `views/partials/home-search.ejs` and every new file LF.
- **Tests never touch real data:** boot tests use a temp `DATA_DIR`, `MONGODB_URI=''`, an in-memory session store and a made-up admin password; nothing reaches the project's `games.json`, a database or the real admin.
- Blocks, in order: announcement + popup · menu · top (search, tagline, banner, Top rented list on computers) · Power-up + trust · quick picks · Top rented row (phones) · △ New releases · ○ Loot drops (deals) · □ Coming soon · ✕ PS Plus Deluxe · Choose your player · 🏆 Achievements unlocked · How to play + FAQ · footer. No CSS `order` re-sorting.
- Markers: △ `#3EA37A` · ○ `#E0565B` · ✕ `#5B8DEF` · □ `#D98AC0`; gold stays `var(--ps-blue)` (#F0A500).
- Banner: owner's pins (`site_settings.home_banner_ids`, max 5) first, then newest released games; cover art required; then the owner's `hero_slides`.
- Top rented: rentals started in the last 30 days, ties and fill-up by all-time `renters`, never-rented games left out, max 10 (phones: row #1–#10; computers: top 5 beside the banner).
- Tagline = `hero_text.line1` + `highlight` (in `highlight_color`) + `line2`; subtitle no longer shown.
- Payment methods appear only in the footer. Removed: hero, account-type explainer, "Three ways to play", "Why rent from us", "Ways to pay", price-tier cards, spotlight, Most popular, Most played in PS Plus section, promo ladder, `.home-page` order rules, `public/js/index-1.js`–`index-3.js`.
- Unchanged: prices, orders, other pages; game cards, review strip, Coming soon cards and modals are reused.
- Known unrelated failure: `scripts/test-requests-page.js`. Report it, do not fix it.
- Scratch edit scripts live in `.superpowers/tmp-edits/` (git-ignored); never commit them; Task 4 removes the folder.

## File Structure

| File | Responsibility |
|---|---|
| `lib/home-view.js` (new) | `weeklyFrom`, `bannerGames`, `topRented`, `powerUp`, `trust`, `playerPrices`, `quickGenres` |
| `server.js` | `GET /` builds `home`; `POST /admin/home-banner` |
| `views/index.ejs` | Rewritten: includes the blocks in order |
| `views/partials/home/top.ejs`, `power.ejs`, `quick-picks.ejs`, `game-row.ejs`, `psplus.ejs`, `players.ejs`, `achievements.ejs`, `how-faq.ejs` (new) | One block each |
| `public/css/home.css`, `public/js/home.js` (new) | Homepage styles; banner dots/arrows/auto-advance |
| `views/partials/home-search.ejs`, `views/partials/upcoming-section.ejs` | `compact` search mode; `homeMarker` heading |
| `views/partials/admin/content.ejs`, `views/partials/admin/settings.ejs`, `views/admin.ejs`, `public/css/style.css` | Banner picker, notes, toast; old order rules removed |

---

### Task 1: What the homepage shows (library)

**Files:**
- Create: `lib/home-view.js`, `scripts/test-home-view.js`

**Interfaces:**
- Produces: `BANNER_MAX` (5), `TOP_MAX` (10), `TOP_WINDOW_DAYS` (30), `weeklyFrom(game, promo) → number|null`, `bannerGames(games, pinIds, newest) → game[]`, `topRented(games, customers, now) → game[]`, `powerUp(promo) → { pct, days } | null`, `trust(recommend, renterCount) → { recommendPct: number|null, renters: string|null }`, `playerPrices(games, psplusFrom) → { trophy, nonTrophy, buy, psplus }` (numbers or null), `quickGenres(games) → string[]`. Uses `lib/game-discount.js` and `public/js/browse-filter-core.js` (`genreParts`).

- [ ] **Step 1: Write the test**

Create `scripts/test-home-view.js`:

````js
// Run: node scripts/test-home-view.js
//
// What the homepage blocks show (lib/home-view.js): banner games, Top rented,
// the Power-up line, trust figures, "Choose your player" prices, quick genres.
const assert = require('assert');
const H = require('../lib/home-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const g = (id, title, o) => Object.assign({ id, title, cover_image: '/c/' + id + '.png', nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, renters: 0 }, o || {});
const now = new Date('2026-10-10T12:00:00Z');
const daysAgo = d => new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10);

ok('weekly price: the cheaper weekly price after the game\'s own discount or the site promo', () => {
  assert.strictEqual(H.weeklyFrom(g(1, 'A'), null), 349);
  assert.strictEqual(H.weeklyFrom(g(1, 'A', { discounts: { 7: 20 } }), null), 279);
  assert.strictEqual(H.weeklyFrom(g(1, 'A'), { enabled: true, discounts: { 7: 10, 30: 0 } }), 314);
  assert.strictEqual(H.weeklyFrom(g(1, 'A', { nt_price_7d: 0, tr_price_7d: 0 }), null), null);
});

ok('banner: pins first in order, then newest; cover art required; no repeats; at most 5', () => {
  const games = [g(1, 'A'), g(2, 'B'), g(3, 'C', { cover_image: '' }), g(4, 'D'), g(5, 'E'), g(6, 'F'), g(7, 'G')];
  const newest = [games[6], games[1], games[2], games[3], games[4], games[5]];
  assert.deepStrictEqual(H.bannerGames(games, [4, 99, '1', 3], newest).map(x => x.id), [4, 1, 7, 2, 5], 'unknown id 99 and coverless 3 skipped');
  assert.deepStrictEqual(H.bannerGames(games, undefined, newest).map(x => x.id), [7, 2, 4, 5, 6]);
  assert.deepStrictEqual(H.bannerGames(games, [], []), []);
});

ok('top rented: last 30 days first, ties and the rest by all-time renters, unrented left out', () => {
  const games = [g(1, 'Alpha', { renters: 50 }), g(2, 'Bravo', { renters: 5 }), g(3, 'Charlie', { renters: 9 }), g(4, 'Delta', { renters: 0 }), g(5, 'Echo', { renters: 9 })];
  const customers = [
    { game_id: 2, start_date: daysAgo(3) }, { game_id: 2, start_date: daysAgo(10) },
    { game_id: 3, start_date: daysAgo(29) }, { game_id: 5, start_date: daysAgo(1) },
    { game_id: 1, start_date: daysAgo(31) }, { game_id: 4, start_date: daysAgo(40) },
    { game_id: 1, start_date: 'not a date' }, { game_id: 3, start_date: '2099-01-01' }
  ];
  assert.deepStrictEqual(H.topRented(games, customers, now).map(x => x.title), ['Bravo', 'Charlie', 'Echo', 'Alpha']);
  const many = Array.from({ length: 14 }, (_, i) => g(i + 1, 'G' + String(i).padStart(2, '0'), { renters: 20 - i }));
  assert.strictEqual(H.topRented(many, [], now).length, 10);
});

ok('power-up: the biggest promo discount, the longer duration on a tie, nothing when off', () => {
  assert.deepStrictEqual(H.powerUp({ enabled: true, discounts: { 7: 0, 30: 10 } }), { pct: 10, days: 30 });
  assert.deepStrictEqual(H.powerUp({ enabled: true, discounts: { 7: 15, 30: 10 } }), { pct: 15, days: 7 });
  assert.deepStrictEqual(H.powerUp({ enabled: true, discounts: { 7: 10, 30: 10 } }), { pct: 10, days: 30 });
  assert.strictEqual(H.powerUp({ enabled: false, discounts: { 30: 10 } }), null);
  assert.strictEqual(H.powerUp({ enabled: true, discounts: { 7: 0, 30: 0 } }), null);
  assert.strictEqual(H.powerUp(undefined), null);
});

ok('trust figures: recommend % and renters, missing or zero left out', () => {
  assert.deepStrictEqual(H.trust({ up: 11, total: 11, pct: 100 }, { n: 300, plus: true }), { recommendPct: 100, renters: '300+' });
  assert.deepStrictEqual(H.trust({ up: 0, total: 0, pct: 0 }, { n: 0, plus: false }), { recommendPct: null, renters: null });
  assert.deepStrictEqual(H.trust(null, { n: 1200, plus: true }), { recommendPct: null, renters: '1,200+' });
});

ok('player prices: lowest trophy, non-trophy, buy and PS Plus weekly', () => {
  const games = [g(1, 'A', { nt_price_7d: 199, tr_price_7d: 249, buy_nt_price: 999 }), g(2, 'B', { buy_tr_price: 499, nt_price_30d: 0 })];
  assert.deepStrictEqual(H.playerPrices(games, 159), { trophy: 249, nonTrophy: 199, buy: 499, psplus: 159 });
  assert.deepStrictEqual(H.playerPrices([g(1, 'A')], 0), { trophy: 399, nonTrophy: 349, buy: null, psplus: null });
});

ok('quick genres: the two genres with the most games, at least 2 each', () => {
  const games = [g(1, 'A', { genre: 'Action, RPG' }), g(2, 'B', { genre: 'Action' }), g(3, 'C', { genre: 'Horror/Action' }), g(4, 'D', { genre: 'Horror' }), g(5, 'E', { genre: 'Sports' })];
  assert.deepStrictEqual(H.quickGenres(games), ['Action', 'Horror']);
  assert.deepStrictEqual(H.quickGenres([g(1, 'A', { genre: 'Sports' })]), []);
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-home-view.js` → FAIL `Cannot find module '../lib/home-view'`.

- [ ] **Step 3: Create the library**

Create `lib/home-view.js`:

````js
// What the homepage's blocks show (views/partials/home/*): which games lead the
// "Now playing" banner, the Top rented ranking, the Power-up promo line, the
// trust figures, the "Choose your player" prices and the quick-pick genres.
// Pure — server.js GET / passes it the games, customers, promo and settings.
// See docs/superpowers/specs/2026-10-10-homepage-arcade-store-design.md.
const gameDiscount = require('./game-discount');
const browseCore = require('../public/js/browse-filter-core');

const BANNER_MAX = 5;
const TOP_MAX = 10;
const TOP_WINDOW_DAYS = 30;

// The cheapest weekly price a customer pays, after the game's own discount or
// the site promo — the same rule as the game card's prices. null when none.
function weeklyFrom(game, promo) {
  const pct = gameDiscount.discountPct(game, 7, promo);
  const finals = [game.nt_price_7d, game.tr_price_7d]
    .filter(p => p > 0)
    .map(p => gameDiscount.applyPct(p, pct));
  return finals.length ? Math.min(...finals) : null;
}

// Banner games: the owner's pins first (in their order), then the newest
// releases; only games with cover art, no repeats, at most 5.
function bannerGames(games, pinIds, newest) {
  const byId = new Map((games || []).map(g => [Number(g.id), g]));
  const out = [];
  const add = g => {
    if (g && g.cover_image && !out.includes(g) && out.length < BANNER_MAX) out.push(g);
  };
  (Array.isArray(pinIds) ? pinIds : []).forEach(id => add(byId.get(Number(id))));
  (newest || []).forEach(g => add(byId.get(Number(g.id))));
  return out;
}

// Top rented: rentals started in the last 30 days (customer records), ties and
// the rest of the list by the all-time renters figure. Games nobody has rented
// are left out.
function topRented(games, customers, now) {
  const since = (now || new Date()).getTime() - TOP_WINDOW_DAYS * 86400000;
  const recent = new Map();
  (customers || []).forEach(c => {
    const t = Date.parse(c && c.start_date);
    if (!c || c.game_id == null || isNaN(t) || t < since || t > (now || new Date()).getTime()) return;
    const id = Number(c.game_id);
    recent.set(id, (recent.get(id) || 0) + 1);
  });
  return (games || [])
    .map(g => ({ g, n: recent.get(Number(g.id)) || 0, all: Number(g.renters) || 0 }))
    .filter(x => x.n > 0 || x.all > 0)
    .sort((a, b) => (b.n - a.n) || (b.all - a.all) || a.g.title.localeCompare(b.g.title))
    .slice(0, TOP_MAX)
    .map(x => x.g);
}

// The Power-up line: the site promo's biggest rental discount and its
// duration (the longer one on a tie), or null when there is nothing to say.
function powerUp(promo) {
  if (!promo || !promo.enabled || !promo.discounts) return null;
  let best = null;
  [7, 30].forEach(days => {
    const pct = Number(promo.discounts[days]) || 0;
    if (pct > 0 && (!best || pct >= best.pct)) best = { pct, days };
  });
  return best;
}

// Trust figures from the review stats; a missing or zero figure is null.
function trust(recommend, renterCount) {
  return {
    recommendPct: recommend && recommend.total > 0 ? recommend.pct : null,
    renters: renterCount && renterCount.n > 0 ? renterCount.n.toLocaleString('en-US') + (renterCount.plus ? '+' : '') : null
  };
}

// "Choose your player" starting prices (catalogue prices, before discounts).
function playerPrices(games, psplusFrom) {
  const min = keys => {
    const v = (games || []).flatMap(g => keys.map(k => Number(g[k]) || 0).filter(p => p > 0));
    return v.length ? Math.min(...v) : null;
  };
  return {
    trophy: min(['tr_price_7d', 'tr_price_30d']),
    nonTrophy: min(['nt_price_7d', 'nt_price_30d']),
    buy: min(['buy_nt_price', 'buy_tr_price']),
    psplus: psplusFrom > 0 ? psplusFrom : null
  };
}

// Up to two genres with the most games (at least 2 each) for the quick picks.
function quickGenres(games) {
  const count = new Map();
  (games || []).forEach(g => browseCore.genreParts(g.genre).forEach(p => count.set(p, (count.get(p) || 0) + 1)));
  return [...count.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([name]) => name);
}

module.exports = { BANNER_MAX, TOP_MAX, TOP_WINDOW_DAYS, weeklyFrom, bannerGames, topRented, powerUp, trust, playerPrices, quickGenres };
````

- [ ] **Step 4: Run it and watch it pass**

Run: `node scripts/test-home-view.js` → `7 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/home-view.js scripts/test-home-view.js
git commit -m "Homepage view rules: banner games, top rented, power-up, trust, starting prices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Homepage data and the admin "Homepage banner" picker

**Files:**
- Create: `scripts/test-home-banner-admin.js`
- Modify (via the edit script): `server.js`, `views/admin.ejs`, `views/partials/admin/content.ejs`, `views/partials/admin/settings.ejs`, `public/css/style.css`

**Interfaces:**
- Consumes: Task 1's `lib/home-view.js`; existing `reviewBlockLocals`, `psplusFromWeekly`, `getBrowseBands`, `newReleasesRaw`, `homeCustomers` in `GET /`.
- Produces: `GET /` render local `home = { banner: [{ game, weekly }], topRented: [{ game, weekly }], powerUp, trust, prices, quickGenres, newGames, bands: { low, high }, hasPs4 }` (all other locals unchanged; review locals now come from `homeReviews`). `POST /admin/home-banner` (requireAuth; fields `banner_1`..`banner_5`; saves `site_settings.home_banner_ids`; redirects `/admin?tab=content&msg=home_banner_saved`). Toast `home_banner_saved` → content tab. The old `views/index.ejs` keeps rendering until Task 3.

- [ ] **Step 1: Write the test**

Create `scripts/test-home-banner-admin.js` (port 4617):

````js
// Run: node scripts/test-home-banner-admin.js
//
// Admin → Content → Homepage banner: the picker, saving up to 5 game ids
// (blanks, unknown ids and repeats dropped), the login, the toast, and the
// notes on the hero text and the old hero background. Boots a throwaway
// instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up
// admin password); the project's games.json, the database and the real admin
// are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4617;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-banner-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const game = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', cover_image: '/uploads/' + id + '.png', nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 1, trophy_slots: 1 }, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 }, home_banner_ids: [2] },
  games: [game(1, 'Zzyzx Alpha'), game(2, 'Zzyzx Bravo'), game(3, 'Zzyzx Charlie', { cover_image: '' })]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const pinsInDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8')).site_settings.home_banner_ids;

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
    const r = await call('POST', '/admin/home-banner', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: form({ banner_1: '1' }) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
    assert.deepStrictEqual(pinsInDb(), [2]);
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const post = o => call('POST', '/admin/home-banner', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o) });

  await okAsync('the picker: five slots, every game A–Z, the current pin selected, coverless games marked', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('id="sec-home-banner"') && r.body.includes('href="#sec-home-banner"'));
    assert.strictEqual((r.body.match(/<select name="banner_\d">/g) || []).length, 5);
    assert.ok(r.body.includes('<option value="2" selected>Zzyzx Bravo</option>'));
    assert.ok(r.body.includes('<option value="3">Zzyzx Charlie (no cover art)</option>'));
    assert.ok(r.body.indexOf('>Zzyzx Alpha<') < r.body.indexOf('>Zzyzx Bravo<'));
  });
  await okAsync('saves the picked games in order, dropping blanks, unknown games and repeats', async () => {
    const r = await post({ banner_1: '3', banner_2: '', banner_3: '1', banner_4: '1', banner_5: '99' });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.endsWith('tab=content&msg=home_banner_saved'));
    assert.deepStrictEqual(pinsInDb(), [3, 1]);
    await post({});
    assert.deepStrictEqual(pinsInDb(), [], 'all blank clears the pins');
  });
  await okAsync('the toast, and the notes on the hero text and the old hero background', async () => {
    const r = await call('GET', '/admin?tab=content&msg=home_banner_saved', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes("home_banner_saved:'✅ Homepage banner saved'") && r.body.includes("home_banner_saved:'content'"));
    assert.ok(r.body.includes('The homepage tagline: Line 1 + highlighted text + Line 2, on one line'));
    assert.ok(r.body.includes('Home Page Hero Background <span style="color:#888;font-weight:400;">— not used by the new homepage</span>'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-home-banner-admin.js` → FAIL at "saving needs the admin login" (`404 !== 302`, no route yet).

- [ ] **Step 3: Apply the edits**

Create `.superpowers/tmp-edits/rep.js` (keeps BOM and CRLF; fails loudly on a missing or repeated anchor; Task 3 reuses it):

````js
// Edit helpers for the plan's scripts (run from the repo root). All of them
// keep a file's UTF-8 BOM and CRLF line endings exactly as they were.
//   rep(file, from, to)               — replace the one occurrence of `from`
//                                       (written with \n); throws if it is
//                                       missing or appears more than once.
//   rep.between(file, start, end, to) — replace from `start` (included) up to
//                                       `end` (kept); each must appear once.
//   rep.put(file, text)               — replace the whole file with `text`.
const fs = require('fs');

function read(file) {
  let s = fs.readFileSync(file, 'utf8');
  const bom = s.charCodeAt(0) === 0xfeff;
  if (bom) s = s.slice(1);
  const crlf = s.includes('\r\n');
  if (crlf) s = s.replace(/\r\n/g, '\n');
  return { s, bom, crlf };
}

function write(file, f, s) {
  if (f.crlf) s = s.replace(/\n/g, '\r\n');
  fs.writeFileSync(file, (f.bom ? '﻿' : '') + s);
}

function once(file, s, m) {
  const n = s.split(m).length - 1;
  if (n !== 1) throw new Error(file + ': expected 1 match, found ' + n + ' for: ' + m.slice(0, 80));
}

function rep(file, from, to) {
  const f = read(file);
  once(file, f.s, from);
  write(file, f, f.s.replace(from, () => to));
}

rep.between = function between(file, start, end, to) {
  const f = read(file);
  once(file, f.s, start);
  once(file, f.s, end);
  const i = f.s.indexOf(start), j = f.s.indexOf(end);
  if (j < i) throw new Error(file + ': end marker comes before start marker');
  write(file, f, f.s.slice(0, i) + to + f.s.slice(j));
};

rep.put = function put(file, text) {
  write(file, read(file), text.replace(/\r\n/g, '\n'));
};

module.exports = rep;
````

Create `.superpowers/tmp-edits/edit-home-data.js`:

````js
// Homepage data and the admin "Homepage banner" picker (run from the repo root).
const rep = require('./rep');

// ── server.js ────────────────────────────────────────────────────────────────
rep('server.js', `const browseCore = require('./public/js/browse-filter-core');
`, `const browseCore = require('./public/js/browse-filter-core');
const homeView = require('./lib/home-view');
`);

rep('server.js', `  res.render('index', Object.assign({ featured, specialDeals, games: all, upcoming: upcomingForLoop, psplusPopular, psplusPrices, psplusSlug: homePsplusSlug, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s, promo: s.promo, priceCategories: getPriceCategories(), accountSummaryMap: buildAccountSummaryMap(), activeRenters, gamesPurchased, newReleases, payViaGateway: !!process.env.PAYMONGO_SECRET_KEY },
    reviewBlockLocals('')));`, `  // The arcade-store homepage blocks (lib/home-view.js, views/partials/home/*).
  const homeReviews = reviewBlockLocals('');
  const withWeekly = g => ({ game: g, weekly: homeView.weeklyFrom(g, s.promo) });
  const home = {
    banner: homeView.bannerGames(all, s.home_banner_ids, newReleasesRaw).map(withWeekly),
    topRented: homeView.topRented(all, homeCustomers, new Date()).map(withWeekly),
    powerUp: homeView.powerUp(s.promo),
    trust: homeView.trust(homeReviews.recommend, homeReviews.renterCount),
    prices: homeView.playerPrices(all, psplusFromWeekly()),
    quickGenres: homeView.quickGenres(all),
    newGames: newReleasesRaw,
    bands: getBrowseBands(),
    hasPs4: all.some(g => g.platform === 'PS4' || g.platform === 'PS4/PS5')
  };
  res.render('index', Object.assign({ home, featured, specialDeals, games: all, upcoming: upcomingForLoop, psplusPopular, psplusPrices, psplusSlug: homePsplusSlug, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s, promo: s.promo, priceCategories: getPriceCategories(), accountSummaryMap: buildAccountSummaryMap(), activeRenters, gamesPurchased, newReleases, payViaGateway: !!process.env.PAYMONGO_SECRET_KEY },
    homeReviews));`);

rep('server.js', `app.post('/admin/hero-text', requireAuth, (req, res) => {`, `// Admin → Content → Homepage banner: up to 5 games shown first in the
// homepage's "Now playing" banner (lib/home-view.js bannerGames). Fields
// banner_1..banner_5 hold game ids; blanks, unknown ids and repeats are dropped.
app.post('/admin/home-banner', requireAuth, (req, res) => {
  const b = req.body || {};
  const known = new Set(getGames().map(g => Number(g.id)));
  const ids = [];
  for (let i = 1; i <= homeView.BANNER_MAX; i++) {
    const id = parseInt(b['banner_' + i], 10);
    if (known.has(id) && !ids.includes(id)) ids.push(id);
  }
  db.set('site_settings.home_banner_ids', ids).write();
  res.redirect('/admin?tab=content&msg=home_banner_saved');
});

app.post('/admin/hero-text', requireAuth, (req, res) => {`);

// ── admin.ejs: toast ─────────────────────────────────────────────────────────
rep('views/admin.ejs', "popup_saved:'content',", "popup_saved:'content', home_banner_saved:'content',");
rep('views/admin.ejs', "const messages = { price_bands_saved:", "const messages = { home_banner_saved:'✅ Homepage banner saved', price_bands_saved:");

// ── content.ejs: the picker, and what the hero text now feeds ────────────────
const C = 'views/partials/admin/content.ejs';
rep(C, `      <a href="#sec-hero-text">Hero text</a>
`, `      <a href="#sec-home-banner">Homepage banner</a>
      <a href="#sec-hero-text">Hero text</a>
`);
rep(C, `    <!-- HERO TEXT EDITOR -->
`, `    <!-- HOMEPAGE BANNER — games pinned to the front of the "Now playing" banner -->
    <% const hbIds = settings.home_banner_ids || []; const hbGames = [...games].sort((a, b) => a.title.localeCompare(b.title)); %>
    <div class="adm-card" id="sec-home-banner">
      <div class="adm-card-head" style="border-left:3px solid #f0a500;">
        <div class="sa-left">
          <div class="sa-icon" style="background:rgba(240,165,0,0.15);">🎞️</div>
          <div>
            <div class="sa-title">Homepage banner</div>
            <div class="sa-desc">Games shown first in the homepage's "Now playing" banner</div>
          </div>
        </div>
      </div>
      <div class="adm-card-body">
        <p class="gdt-note">Pick up to 5 games, in order. Games without cover art are skipped. Empty slots fill up with the newest releases; your hero slides play after the games.</p>
        <form method="POST" action="/admin/home-banner" class="hb-form">
          <% for (let i = 0; i < 5; i++) { %>
          <label class="hb-row"><span>Slide <%= i + 1 %></span>
            <select name="banner_<%= i + 1 %>">
              <option value="">— Newest release —</option>
              <% hbGames.forEach(g => { %><option value="<%= g.id %>"<%= hbIds[i] === g.id ? ' selected' : '' %>><%= g.title %><%= g.cover_image ? '' : ' (no cover art)' %></option><% }) %>
            </select>
          </label>
          <% } %>
          <div><button type="submit" class="btn btn-primary">Save banner</button></div>
        </form>
      </div>
    </div>

    <!-- HERO TEXT EDITOR -->
`);
rep(C, `<div class="sa-desc">Edit headline, subtitle, colors & font size</div>`,
  `<div class="sa-desc">The homepage tagline: Line 1 + highlighted text + Line 2, on one line (subtitle and font size are no longer shown)</div>`);

// ── settings.ejs: the old hero background ────────────────────────────────────
rep('views/partials/admin/settings.ejs', `<label>Home Page Hero Background</label>`,
  `<label>Home Page Hero Background <span style="color:#888;font-weight:400;">— not used by the new homepage</span></label>`);

// ── style.css: the picker ────────────────────────────────────────────────────
rep('public/css/style.css', `.pb-form input[type=number] { width: 90px; margin-left: 0.3rem; }
`, `.pb-form input[type=number] { width: 90px; margin-left: 0.3rem; }
/* Admin → Content → Homepage banner. */
.hb-form { display: grid; gap: 0.5rem; max-width: 560px; }
.hb-row { display: flex; align-items: center; gap: 0.75rem; font-size: 0.85rem; color: #ccc; }
.hb-row span { width: 60px; flex-shrink: 0; }
.hb-row select { flex: 1; min-width: 0; }
`);
console.log('edited');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-home-data.js` → `edited`.
Then: `node --check server.js && file server.js views/admin.ejs views/partials/admin/content.ejs views/partials/admin/settings.ejs public/css/style.css` → line endings unchanged.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-home-banner-admin.js` → `4 assertions passed`.
Run: `node scripts/test-home-search.js && node scripts/test-game-discount-pricing.js && node scripts/test-tier-pill.js` → all pass (the old homepage still renders).

- [ ] **Step 5: Commit**

```bash
git add scripts/test-home-banner-admin.js server.js views/admin.ejs views/partials/admin/content.ejs views/partials/admin/settings.ejs public/css/style.css
git commit -m "Homepage data for the new blocks; admin Homepage banner picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The new homepage

**Files:**
- Create: `views/partials/home/top.ejs`, `power.ejs`, `quick-picks.ejs`, `game-row.ejs`, `psplus.ejs`, `players.ejs`, `achievements.ejs`, `how-faq.ejs`; `public/css/home.css`; `public/js/home.js`; `scripts/test-home-page.js`
- Modify (via the edit scripts): `views/index.ejs` (rewritten), `views/partials/home-search.ejs`, `views/partials/upcoming-section.ejs`, `public/css/style.css`, `scripts/test-game-discount-pricing.js`, `scripts/test-home-search.js`, `scripts/test-homepage-carousel.js`, `scripts/test-js-extraction-index.js`
- Delete: `public/js/index-1.js`, `public/js/index-2.js`, `public/js/index-3.js`

**Interfaces:**
- Consumes: Task 2's `home` local and every existing `GET /` local; `partials/game-card`, `partials/review-block`, `partials/upcoming-section`, `partials/home-search`, `gameTier` (app local), `public/js/index-4.js` (modals, Coming soon drift).
- Produces: page ids `hmBanner`, `hmSlides`, `hmPrev`, `hmNext`, `hmDots`, `topRented`, `newReleasesSection`, `specialDealsSection`, `comingSoon`, `psplus`, `players`, `reviewsSection`, `how`; body class `home2`; `home-search` local `compact`; `upcoming-section` local `homeMarker`.

- [ ] **Step 1: Write the test**

Create `scripts/test-home-page.js` (port 4618):

````js
// Run: node scripts/test-home-page.js
//
// The "arcade store" homepage as the server renders it: the blocks in order,
// the tagline and compact search, the banner (pins first, cover art only, the
// owner's slides after), Top rented, the Power-up and trust lines, quick picks,
// the game shelves, Coming soon, PS Plus, Choose your player, Achievements,
// How to play, and the old sections gone. Boots a throwaway instance (temp
// DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin password);
// the project's games.json, the database and the real admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4618;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-page-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const daysAgo = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const prices = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '/uploads/' + id + '.png',
  non_trophy_slots: 1, trophy_slots: 1, renters: 0, created_at: '2020-01-01T00:00:00.000Z'
}, prices, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: {
    promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 },
    hero_text: { line1: 'Rent the Latest', highlight: 'PS5 & PS4', line2: 'Games', subtitle: 'Old subtitle', title_size: 55, highlight_color: '#F0A500', subtitle_color: '#aaaaaa' },
    hero_slides: [{ id: 1, path: '/uploads/promo.png', caption: 'Summer sale', link: '/browse' }],
    home_banner_ids: [4, 99],
    payment_methods: [{ key: 'gcash', label: 'GCash', enabled: true }]
  },
  price_categories: [Object.assign({ id: 1, name: 'New Games' }, prices), Object.assign({ id: 2, name: 'Deluxe' }, prices)],
  psplus_prices: { nt_price_7d: 159, tr_price_7d: 199 },
  psplus_popular: [{ id: 1, title: 'God of War', cover_image: '/uploads/gow.png', rank: 1 }],
  upcoming: [{ id: 1, title: 'Zzyzx Future', platform: 'PS5', release_date: '2027-01-01', non_trophy_slots: 2, trophy_slots: 0, nt_price_7d: 699, nt_price_30d: 999 }],
  games: [
    game(1, 'Zzyzx Alpha', { release_date: daysAgo(9), price_category_id: 1, renters: 3 }),
    game(2, 'Zzyzx Bravo', { release_date: daysAgo(20), price_category_id: 2, genre: 'Action, RPG', renters: 8 }),
    game(3, 'Zzyzx Charlie', { release_date: daysAgo(30), cover_image: '', genre: 'Horror', renters: 1 }),
    game(4, 'Zzyzx Delta', { platform: 'PS4/PS5', genre: 'Horror', buy_nt_price: 999 }),
    game(5, 'Zzyzx Echo', { discounts: { 7: null, 30: 25 }, renters: 2 })
  ],
  customers: [
    { id: 1, customer_name: 'Ana', game_id: 1, game_title: 'Zzyzx Alpha', days: 7, start_date: daysAgo(5), end_date: daysAgo(-2), status: 'renting', price: 349, payments: [] },
    { id: 2, customer_name: 'Ben', game_id: 1, game_title: 'Zzyzx Alpha', days: 7, start_date: daysAgo(3), end_date: daysAgo(-4), status: 'renting', price: 349, payments: [] },
    { id: 3, customer_name: 'Cy', game_id: 2, game_title: 'Zzyzx Bravo', days: 30, start_date: daysAgo(40), end_date: daysAgo(10), status: 'returned', price: 719, payments: [] }
  ]
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
// The HTML from an element's id (or a marker string) to the next given marker.
function slice(html, from, to) {
  const i = html.indexOf(from);
  assert.ok(i >= 0, from + ' found');
  const j = to ? html.indexOf(to, i + from.length) : html.length;
  return html.slice(i, j < 0 ? html.length : j);
}
const cardSlugs = html => [...html.matchAll(/href="\/game\/([a-z0-9-]+)" class="game-card/g)].map(m => m[1]);

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

  const r = await call('GET', '/');
  const home = r.body;
  console.log('\nlayout');
  await okAsync('the blocks render in order, the same on every screen size', async () => {
    assert.strictEqual(r.status, 200);
    assert.ok(home.includes('<body class="home2">'));
    const marks = ['class="hm-top"', 'class="hm-wrap hm-power-wrap"', 'aria-label="Quick picks"', 'id="topRented"', 'id="newReleasesSection"',
      'id="specialDealsSection"', 'id="comingSoon"', 'id="psplus"', 'id="players"', 'id="reviewsSection"', 'id="how"', '<footer'];
    const at = marks.map(m => home.indexOf(m));
    at.forEach((x, i) => assert.ok(x > 0 && (i === 0 || x > at[i - 1]), marks[i] + ' in order'));
  });
  await okAsync('the old sections are gone, and payment methods are listed only in the footer', async () => {
    ['Which account type is for you?', 'Three ways to play', 'Why Rent From Us', 'Ways to Pay', 'Browse by Price Tier', 'Most Popular', 'hero-v2', 'Rent Longer. Save More.', 'spotlight-section']
      .forEach(t => assert.ok(!home.includes(t), t));
    assert.ok(home.indexOf('GCash') > home.indexOf('<footer'), 'GCash only after the footer starts');
  });
  await okAsync('a game card is on the page before "Choose your player"', async () => {
    assert.ok(home.indexOf('class="game-card') > 0 && home.indexOf('class="game-card') < home.indexOf('id="players"'));
  });

  console.log('\ntop');
  await okAsync('one-line tagline from the hero text, with the compact search beside it', async () => {
    const head = slice(home, 'class="hm-head"', 'class="hm-stage');
    assert.ok(head.includes('<h1 class="hm-tagline">Rent the Latest <span style="color:#F0A500;">PS5 &amp; PS4</span> Games</h1>'));
    assert.ok(head.includes('class="hs hs-compact" id="homeSearch"') && head.includes('id="hsInput"'));
    assert.ok(!home.includes('class="hs-chip"') && !home.includes('Old subtitle'));
  });
  await okAsync('banner: the pinned game first, then the newest releases with cover art, then the owner\'s slides', async () => {
    const banner = slice(home, 'id="hmBanner"', '<aside');
    const slides = [...banner.matchAll(/<a class="hm-slide" href="\/game\/([a-z-]+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(slides, ['zzyzx-delta', 'zzyzx-alpha', 'zzyzx-bravo'], 'unknown pin and the coverless game skipped');
    assert.ok(banner.includes('<a class="hm-slide hm-slide-promo" href="/browse"><img src="/uploads/promo.png" alt="Summer sale"><span class="hm-slide-caption">Summer sale</span></a>'));
    assert.strictEqual((banner.match(/class="hm-dot( on)?"/g) || []).length, 4, '3 games + 1 owner slide');
    assert.ok(slice(banner, 'href="/game/zzyzx-alpha"', '</a>').includes('<span class="tier-pill tier-blue">New Games</span>'));
    assert.ok(slice(banner, 'href="/game/zzyzx-alpha"', '</a>').includes('Weekly from <b>₱349</b>'));
  });
  await okAsync('Top rented beside the banner: last 30 days first, then all-time renters, top 5', async () => {
    const board = slice(home, 'class="hm-board"', '</ol>');
    const titles = [...board.matchAll(/class="hm-board-title">([^<]+)</g)].map(m => m[1]);
    assert.deepStrictEqual(titles, ['Zzyzx Alpha', 'Zzyzx Bravo', 'Zzyzx Echo', 'Zzyzx Charlie'], 'Delta has never been rented');
    assert.ok(board.includes('<span class="hm-rk hm-rk-1">1</span>'));
    assert.deepStrictEqual(cardSlugs(slice(home, 'id="topRented"', 'id="newReleasesSection"')), ['zzyzx-alpha', 'zzyzx-bravo', 'zzyzx-echo', 'zzyzx-charlie']);
    assert.ok(slice(home, 'id="topRented"', 'id="newReleasesSection"').includes('<span class="hm-medal hm-rk-1">#1</span>'));
  });
  await okAsync('Power-up from the site promo, and the trust line', async () => {
    const power = slice(home, 'class="hm-wrap hm-power-wrap"', '</section>');
    assert.ok(power.includes('Rent 30 days → <b>10% off</b>, automatically'));
    assert.ok(power.includes('<li>✓ Ready in minutes</li>') && /<li>✓ \d+ players<\/li>/.test(power));
    assert.ok(!power.includes('recommend us'), 'no reviews yet, so no recommend figure');
  });
  await okAsync('quick picks jump to the blocks and open filtered Browse', async () => {
    const picks = [...slice(home, 'aria-label="Quick picks"', '</div>').matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(picks, ['#newReleasesSection', '#specialDealsSection', '#psplus', '#comingSoon', '/browse?price=low', '/browse?console=ps4', '/browse?genre=Action', '/browse?genre=Horror']);
  });

  console.log('\nshelves and blocks');
  await okAsync('new releases newest first; deals at their deal price; Coming soon with its marker', async () => {
    assert.deepStrictEqual(cardSlugs(slice(home, 'id="newReleasesSection"', 'id="specialDealsSection"')), ['zzyzx-alpha', 'zzyzx-bravo', 'zzyzx-charlie']);
    assert.ok(slice(home, 'id="specialDealsSection"', '<!-- UPCOMING GAMES').includes('Monthly <b>₱599</b>'));
    assert.ok(slice(home, 'id="comingSoon"', '</h2>').includes('<span class="hm-mark hm-sq">□</span>Coming soon'));
  });
  await okAsync('PS Plus card with its weekly price and most-played strip', async () => {
    const ps = slice(home, 'id="psplus"', 'id="players"');
    assert.ok(ps.includes('from <b>₱159</b> / week') && ps.includes('<span>God of War</span>'));
  });
  await okAsync('Choose your player: starting prices and the deposit', async () => {
    const pl = slice(home, 'id="players"', 'id="reviewsSection"');
    ['from ₱399', 'from ₱349', 'from ₱999', 'from ₱159/week', '₱100 refundable deposit'].forEach(t => assert.ok(pl.includes(t), t));
  });
  await okAsync('Achievements: games count and starting price; How to play with the questions', async () => {
    const ach = slice(home, 'id="reviewsSection"', 'id="how"');
    assert.ok(ach.includes('<b>5</b><span>games to play</span>') && ach.includes('<b>₱349</b><span>starting price</span>'));
    const how = slice(home, 'id="how"', '<footer');
    assert.ok(how.includes('Do I need to give you my PSN password?') && how.includes('When do I get my ₱100 deposit back?'));
  });
  await okAsync('the page loads its own styles and banner script; the old phone re-ordering is gone', async () => {
    assert.ok(/<link rel="stylesheet" href="\/css\/home\.css\?v=[^"]+">/.test(home) && /<script src="\/js\/home\.js\?v=[^"]+"><\/script>/.test(home));
    assert.strictEqual((await call('GET', '/css/home.css')).status, 200);
    assert.strictEqual((await call('GET', '/js/home.js')).status, 200);
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(!css.includes('.home-page #newReleasesSection { order'), 'no order re-sorting left');
  });

  console.log('\npromo off');
  await okAsync('with the site promo off the Power-up line disappears', async () => {
    const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(TEST_PASSWORD) });
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    await call('POST', '/admin/promo', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: 'discount_7=0&discount_30=10&deposit=100' });
    const off = (await call('GET', '/')).body;
    assert.ok(!off.includes('class="hm-power"') && off.includes('<li>✓ Ready in minutes</li>'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-home-page.js` → FAIL at "the blocks render in order" (old page: no `<body class="home2">`).

- [ ] **Step 3: Create the blocks, styles and banner script**

Create `views/partials/home/top.ejs`:

````ejs
<%#
  Top of the homepage: the search, the one-line tagline, the "Now playing"
  banner and — on computers — the Top rented list beside it.
  Banner: up to 5 games (owner's pins, then newest releases; lib/home-view.js)
  followed by the owner's uploaded hero slides. Slides scroll natively, so a
  phone can swipe them; public/js/home.js adds dots, arrows and auto-advance.
  Locals: home, settings, featured.
%>
<%
  const hmText = settings.hero_text || {};
  const hmSlug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const hmPromoSlides = (settings.hero_slides || []).filter(sl => sl && sl.path);
  const hmSlideCount = home.banner.length + hmPromoSlides.length;
%>
<section class="hm-top">
  <div class="hm-wrap">
    <div class="hm-head">
      <h1 class="hm-tagline"><%= hmText.line1 %> <span style="color:<%= hmText.highlight_color || '#F0A500' %>;"><%= hmText.highlight %></span> <%= hmText.line2 %></h1>
      <%- include('../home-search', { featured, compact: true }) %>
    </div>
    <% if (hmSlideCount || home.topRented.length) { %>
    <div class="hm-stage<%= hmSlideCount ? '' : ' hm-stage-solo' %>">
      <% if (hmSlideCount) { %>
      <div class="hm-banner" id="hmBanner" role="region" aria-roledescription="carousel" aria-label="Now playing">
        <div class="hm-slides" id="hmSlides">
          <% home.banner.forEach(b => {
            const g = b.game;
            const tier = (!g.is_bundle && typeof gameTier === 'function') ? gameTier(g) : null; %>
          <a class="hm-slide" href="/game/<%= hmSlug(g.title) %>">
            <img src="<%= g.cover_image %>" alt="" style="object-position: <%= g.cover_focal_x != null ? g.cover_focal_x : 50 %>% <%= g.cover_focal_y != null ? g.cover_focal_y : 50 %>%;">
            <span class="hm-slide-shade"></span>
            <span class="hm-slide-body">
              <span class="hm-kicker">▶ Now playing</span>
              <span class="hm-slide-title"><%= g.title %></span>
              <span class="hm-slide-meta">
                <% if (tier) { %><span class="tier-pill tier-<%= tier.color %>"><%= tier.name %></span><% } %>
                <% if (b.weekly) { %><span>Weekly from <b>₱<%= b.weekly %></b></span><% } %>
              </span>
              <span class="hm-btn">Rent now</span>
            </span>
          </a>
          <% }) %>
          <% hmPromoSlides.forEach(sl => { %>
          <% if (sl.link) { %>
          <a class="hm-slide hm-slide-promo" href="<%= sl.link %>"><img src="<%= sl.path %>" alt="<%= sl.caption || 'Promo' %>"><% if (sl.caption) { %><span class="hm-slide-caption"><%= sl.caption %></span><% } %></a>
          <% } else { %>
          <div class="hm-slide hm-slide-promo"><img src="<%= sl.path %>" alt="<%= sl.caption || 'Promo' %>"><% if (sl.caption) { %><span class="hm-slide-caption"><%= sl.caption %></span><% } %></div>
          <% } %>
          <% }) %>
        </div>
        <% if (hmSlideCount > 1) { %>
        <button type="button" class="hm-arrow hm-arrow-prev" id="hmPrev" aria-label="Previous slide">&#8249;</button>
        <button type="button" class="hm-arrow hm-arrow-next" id="hmNext" aria-label="Next slide">&#8250;</button>
        <div class="hm-dots" id="hmDots">
          <% for (let i = 0; i < hmSlideCount; i++) { %><button type="button" class="hm-dot<%= i === 0 ? ' on' : '' %>" aria-label="Slide <%= i + 1 %>"></button><% } %>
        </div>
        <% } %>
      </div>
      <% } %>
      <% if (home.topRented.length) { %>
      <aside class="hm-aside" aria-label="Top rented this month">
        <div class="hm-aside-head"><span class="hm-mark hm-tri">△</span><b>Top rented</b><span>this month</span></div>
        <ol class="hm-board">
          <% home.topRented.slice(0, 5).forEach((t, i) => { %>
          <li><a href="/game/<%= hmSlug(t.game.title) %>"><span class="hm-rk hm-rk-<%= i + 1 %>"><%= i + 1 %></span><span class="hm-board-title"><%= t.game.title %></span><% if (t.weekly) { %><span class="hm-board-price">₱<%= t.weekly %></span><% } %></a></li>
          <% }) %>
        </ol>
      </aside>
      <% } %>
    </div>
    <% } %>
  </div>
</section>
````

Create `views/partials/home/power.ejs`:

````ejs
<%#
  The Power-up line (the site promo in one sentence; hidden when the promo is
  off) and the trust line (only the figures that exist). Locals: home.
%>
<section class="hm-wrap hm-power-wrap">
  <% if (home.powerUp) { %>
  <a class="hm-power" href="/browse"><span class="hm-power-tag">⚡ Power-up</span><span class="hm-power-text">Rent <%= home.powerUp.days %> days → <b><%= home.powerUp.pct %>% off</b>, automatically</span><span class="hm-power-go">See games ›</span></a>
  <% } %>
  <ul class="hm-trust">
    <% if (home.trust.renters) { %><li>✓ <%= home.trust.renters %> players</li><% } %>
    <% if (home.trust.recommendPct != null) { %><li>✓ <%= home.trust.recommendPct %>% recommend us</li><% } %>
    <li>✓ Ready in minutes</li>
    <li>✓ No password needed</li>
  </ul>
</section>
````

Create `views/partials/home/quick-picks.ejs`:

````ejs
<%#
  Quick picks: the four PlayStation-symbol chips jump to the matching block on
  this page; the rest open a filtered Browse. A chip only shows when there is
  something behind it. Locals: home, specialDeals, upcoming, psplusPopular.
%>
<%# A div, not <nav>: the site styles every nav element as the sticky menu bar. %>
<div class="hm-wrap hm-picks" role="navigation" aria-label="Quick picks">
  <% if (home.newGames.length) { %><a class="hm-pick hm-pick-tri" href="#newReleasesSection"><span class="hm-mark hm-tri">△</span>New releases</a><% } %>
  <% if (specialDeals.length) { %><a class="hm-pick hm-pick-cir" href="#specialDealsSection"><span class="hm-mark hm-cir">○</span>Deals</a><% } %>
  <% if (home.prices.psplus || psplusPopular.length) { %><a class="hm-pick hm-pick-x" href="#psplus"><span class="hm-mark hm-x">✕</span>PS Plus</a><% } %>
  <% if (upcoming.length) { %><a class="hm-pick hm-pick-sq" href="#comingSoon"><span class="hm-mark hm-sq">□</span>Coming soon</a><% } %>
  <a class="hm-pick" href="/browse?price=low">Under ₱<%= home.bands.low %></a>
  <% if (home.hasPs4) { %><a class="hm-pick" href="/browse?console=ps4">Plays on PS4</a><% } %>
  <% home.quickGenres.forEach(gn => { %><a class="hm-pick" href="/browse?genre=<%= encodeURIComponent(gn) %>"><%= gn %></a><% }) %>
</div>
````

Create `views/partials/home/game-row.ejs`:

````ejs
<%#
  A shelf of game cards: a swipe row on phones, up to 6 a row on computers
  (public/css/home.css). Used for Top rented (phones), New releases and Loot
  drops. Locals: id, mark ('tri' | 'cir' | 'x' | 'sq'), title, sub, games,
  viewAll (href or ''), ranked (badge #1..), dealPrice, extraClass.
%>
<% const hmMarks = { tri: '△', cir: '○', x: '✕', sq: '□' }; %>
<section class="hm-wrap hm-sec<%= typeof extraClass !== 'undefined' && extraClass ? ' ' + extraClass : '' %>" id="<%= id %>">
  <h2 class="hm-title"><span class="hm-mark hm-<%= mark %>"><%= hmMarks[mark] %></span><%= title %><% if (sub) { %> <span class="hm-sub"><%= sub %></span><% } %><% if (viewAll) { %><a class="hm-viewall" href="<%= viewAll %>">View all ›</a><% } %></h2>
  <div class="hm-row">
    <% games.forEach((game, i) => { %><div class="hm-cell"><% if (ranked) { %><span class="hm-medal hm-rk-<%= i + 1 %>">#<%= i + 1 %></span><% } %><%- include('../game-card', { game, showPriceStart: true, dealPrice: !!dealPrice }) %></div><% }) %>
  </div>
</section>
````

Create `views/partials/home/psplus.ejs`:

````ejs
<%#
  PS Plus Deluxe in one card: what it is, its weekly price, and a strip of the
  most-played PS Plus games. Locals: home, psplusPopular, psplusSlug.
%>
<% if (home.prices.psplus || psplusPopular.length) { %>
<section class="hm-wrap hm-sec" id="psplus">
  <div class="hm-psplus">
    <div class="hm-psplus-info">
      <h2 class="hm-title hm-title-plain"><span class="hm-mark hm-x">✕</span>PS Plus Deluxe</h2>
      <p>Hundreds of games on one account — play any of them for the length of your rental.</p>
      <% if (home.prices.psplus) { %><div class="hm-psplus-price">from <b>₱<%= home.prices.psplus %></b> / week</div><% } %>
      <a class="hm-btn" href="/ps-plus">See the games</a>
    </div>
    <% if (psplusPopular.length) { %>
    <div class="hm-psplus-strip" aria-label="Most played on PS Plus">
      <% psplusPopular.slice(0, 6).forEach(p => { %>
      <a class="hm-ps-tile" href="<%= psplusSlug ? '/game/' + psplusSlug : '/ps-plus' %>">
        <% if (p.cover_image) { %><img src="<%= p.cover_image %>" alt="" loading="lazy" decoding="async"><% } %>
        <span><%= p.title %></span>
      </a>
      <% }) %>
    </div>
    <% } %>
  </div>
</section>
<% } %>
````

Create `views/partials/home/players.ejs`:

````ejs
<%#
  "Choose your player": the ways to play side by side with their starting
  prices (lib/home-view.js playerPrices). Buy and PS Plus only show when they
  have a price. Locals: home, promo.
%>
<% const hmDeposit = (promo && promo.deposit) || 0; %>
<section class="hm-wrap hm-sec" id="players">
  <h2 class="hm-title">Choose your player</h2>
  <div class="hm-players">
    <a class="hm-player" href="/browse">
      <span class="hm-player-name">Trophy</span>
      <span class="hm-player-line">Plays on your own profile — trophies and saves stay yours.<% if (hmDeposit) { %> ₱<%= hmDeposit %> refundable deposit.<% } %></span>
      <% if (home.prices.trophy) { %><span class="hm-player-price">from ₱<%= home.prices.trophy %></span><% } %>
    </a>
    <a class="hm-player" href="/browse">
      <span class="hm-player-name">Non-trophy</span>
      <span class="hm-player-line">Plays on our account — the cheapest way, no deposit.</span>
      <% if (home.prices.nonTrophy) { %><span class="hm-player-price">from ₱<%= home.prices.nonTrophy %></span><% } %>
    </a>
    <% if (home.prices.buy) { %>
    <a class="hm-player" href="/buy">
      <span class="hm-player-name">Buy</span>
      <span class="hm-player-line">Keep it for good — no return date.</span>
      <span class="hm-player-price">from ₱<%= home.prices.buy %></span>
    </a>
    <% } %>
    <% if (home.prices.psplus) { %>
    <a class="hm-player" href="/ps-plus">
      <span class="hm-player-name">PS Plus</span>
      <span class="hm-player-line">A whole catalogue on one rental.</span>
      <span class="hm-player-price">from ₱<%= home.prices.psplus %>/week</span>
    </a>
    <% } %>
  </div>
  <p class="hm-foot">You never give us your password — you sign our account into your console with a code from your own screen. <a href="/how-it-works">See how it works</a></p>
</section>
````

Create `views/partials/home/achievements.ejs`:

````ejs
<%#
  "Achievements unlocked": the shop's figures as trophies, then the same review
  strip every other page shows. Locals: home, games, reviews, reviewStats,
  recommend, reviewBadge, reviewDisplayName, renterCount.
%>
<% const hmStart = [home.prices.nonTrophy, home.prices.trophy].filter(Boolean); %>
<section class="hm-wrap hm-sec" id="reviewsSection">
  <h2 class="hm-title">🏆 Achievements unlocked</h2>
  <div class="hm-trophies">
    <% if (home.trust.recommendPct != null) { %><div class="hm-trophy"><b><%= home.trust.recommendPct %>%</b><span>would recommend us</span></div><% } %>
    <% if (home.trust.renters) { %><div class="hm-trophy"><b><%= home.trust.renters %></b><span>players served</span></div><% } %>
    <div class="hm-trophy"><b><%= games.length %></b><span>games to play</span></div>
    <% if (hmStart.length) { %><div class="hm-trophy"><b>₱<%= Math.min(...hmStart) %></b><span>starting price</span></div><% } %>
  </div>
  <% if ((reviews && reviews.length > 0) || (recommend && recommend.total > 0)) { %>
  <%- include('../review-block', { reviews, reviewStats, recommend, reviewBadge, reviewDisplayName, renterCount }) %>
  <% } %>
</section>
````

Create `views/partials/home/how-faq.ejs`:

````ejs
<%#
  How to play (the four steps) and the questions that stop a first order.
  Locals: promo.
%>
<% const hmDep = (promo && promo.deposit) || 0; %>
<section class="hm-wrap hm-sec" id="how">
  <div class="hm-howfaq">
    <div>
      <h2 class="hm-title">How to play</h2>
      <ol class="hm-steps">
        <li><b>Pick a game</b><span>Choose from our PS5 and PS4 digital library.</span></li>
        <li><b>Choose weekly or monthly</b><span>Longer rentals cost less per day.</span></li>
        <li><b>Sign in with a code</b><span>Our account signs into your console — no password shared.</span></li>
        <li><b>Play</b><span>The slot frees up for the next player when you're done.</span></li>
      </ol>
    </div>
    <div>
      <h2 class="hm-title">Questions</h2>
      <div class="faq-list">
        <details class="faq-item">
          <summary>Do I need to give you my PSN password?</summary>
          <p>No, and we never ask for it. You bring up the sign-in screen on your own console and send us the code from it — that signs <em>our</em> account into <em>your</em> console. Your password never leaves your hands.</p>
        </details>
        <details class="faq-item">
          <summary>Can I try a game before I pay?</summary>
          <p>Yes — three hours free, on our account, before you commit to renting or buying. Message us and we'll set it up.</p>
        </details>
        <% if (hmDep) { %>
        <details class="faq-item">
          <summary>When do I get my ₱<%= hmDep %> deposit back?</summary>
          <p>As soon as you return the account at the end of your rental. It only applies to Trophy accounts. If you return late, ₱<%= (promo && promo.late_fee_per_day) || 0 %> a day comes out of it — return on time and you get the full amount back.</p>
        </details>
        <% } %>
        <details class="faq-item">
          <summary>What happens when my rental ends?</summary>
          <p>You sign our account out of your console and send us a quick screenshot to confirm. That frees the slot for the next person, and releases your deposit if you paid one.</p>
        </details>
        <details class="faq-item">
          <summary>What if there are no slots left for the game I want?</summary>
          <p>You can join the line for free and we'll message you the moment one opens, or pay a small priority fee to move ahead of everyone on the free list. Either way you keep your place — you can see exactly where you are in the queue.</p>
        </details>
      </div>
    </div>
  </div>
</section>
````

Create `public/css/home.css`:

````css
/* The "arcade store" homepage (views/index.ejs, views/partials/home/*).
   Blocks stack in source order on every screen size. */

.home2 { --hm-tri: #3EA37A; --hm-cir: #E0565B; --hm-x: #5B8DEF; --hm-sq: #D98AC0; }
.hm-wrap { max-width: 1400px; margin: 0 auto; padding-left: 2rem; padding-right: 2rem; box-sizing: border-box; }
.hm-sec { padding-top: 2.5rem; }
.hm-sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* PlayStation-symbol markers */
.hm-mark { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 1.35em; height: 1.35em; border-radius: 50%; border: 1.5px solid currentColor; font-size: 0.72em; font-weight: 800; line-height: 1; margin-right: 0.5rem; }
.hm-tri { color: var(--hm-tri); }
.hm-cir { color: var(--hm-cir); }
.hm-x { color: var(--hm-x); }
.hm-sq { color: var(--hm-sq); }

.hm-title { display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem; margin: 0 0 1rem; font-size: 1.35rem; font-weight: 900; color: #fff; }
.hm-sub { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-left: 0.35rem; }
.hm-viewall { margin-left: auto; font-size: 0.8rem; font-weight: 700; color: var(--ps-blue); text-decoration: none; }
.hm-btn { display: inline-flex; align-items: center; justify-content: center; background: var(--ps-blue); color: #111; font-weight: 800; font-size: 0.85rem; border-radius: 999px; padding: 0.55rem 1.2rem; text-decoration: none; white-space: nowrap; }

/* ── Top: search, tagline, banner, Top rented list ── */
.hm-top { padding-top: 1rem; }
.hm-head { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem; }
.hm-head .hs { order: -1; max-width: none; margin: 0; padding: 0; text-align: left; }
.hm-tagline { margin: 0; font-size: 1.35rem; font-weight: 900; line-height: 1.2; color: #fff; }
.hs-compact .hs-input { padding: 0.65rem 1.1rem; font-size: 0.95rem; border-width: 1.5px; box-shadow: none; }
@media (min-width: 900px) {
  .hm-head { flex-direction: row; align-items: center; justify-content: space-between; gap: 2rem; }
  .hm-head .hs { order: 0; flex: 0 1 420px; }
  .hm-tagline { font-size: 1.8rem; }
}

.hm-stage { display: grid; gap: 1rem; }
@media (min-width: 900px) {
  .hm-stage { grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr); align-items: stretch; }
  .hm-stage-solo { grid-template-columns: minmax(0, 1fr); }
}
.hm-banner { position: relative; border-radius: 16px; overflow: hidden; background: var(--bg-card); }
.hm-slides { position: relative; display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; height: 100%; }
.hm-slides::-webkit-scrollbar { display: none; }
.hm-slide { position: relative; flex: 0 0 100%; scroll-snap-align: start; aspect-ratio: 16 / 9; min-height: 190px; display: block; color: #fff; text-decoration: none; overflow: hidden; }
@media (min-width: 900px) { .hm-slide { aspect-ratio: auto; height: 340px; } }
.hm-slide img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hm-slide-shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0) 80%), linear-gradient(0deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 55%); }
.hm-slide-body { position: absolute; left: 1.1rem; right: 1.1rem; bottom: 1.1rem; display: flex; flex-direction: column; align-items: flex-start; gap: 0.4rem; }
.hm-kicker { font-size: 0.68rem; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: var(--ps-blue); }
.hm-slide-title { font-size: 1.3rem; font-weight: 900; line-height: 1.15; text-shadow: 0 2px 10px rgba(0,0,0,0.6); }
@media (min-width: 900px) { .hm-slide-body { left: 2rem; bottom: 2rem; max-width: 60%; } .hm-slide-title { font-size: 2rem; } }
.hm-slide-meta { display: flex; align-items: center; gap: 0.6rem; font-size: 0.85rem; color: #ddd; }
.hm-slide-meta b { color: var(--ps-blue); font-size: 1.05em; }
.hm-slide-caption { position: absolute; left: 1rem; bottom: 1rem; background: rgba(0,0,0,0.6); padding: 0.35rem 0.75rem; border-radius: 8px; font-weight: 700; }
.hm-arrow { position: absolute; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border-radius: 50%; border: 1px solid #333; background: rgba(20,20,20,0.8); color: #fff; font-size: 1.6rem; line-height: 1; cursor: pointer; display: none; }
.hm-arrow-prev { left: 0.6rem; }
.hm-arrow-next { right: 0.6rem; }
@media (hover: hover) and (min-width: 900px) { .hm-arrow { display: flex; align-items: center; justify-content: center; } }
.hm-dots { position: absolute; right: 1rem; bottom: 0.9rem; display: flex; gap: 0.35rem; }
.hm-dot { width: 8px; height: 8px; padding: 0; border-radius: 50%; border: none; background: rgba(255,255,255,0.35); cursor: pointer; }
.hm-dot.on { background: var(--ps-blue); width: 20px; border-radius: 4px; }

.hm-aside { display: none; background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 1rem 1.1rem; }
@media (min-width: 900px) { .hm-aside { display: block; } }
.hm-aside-head { display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.6rem; font-size: 1rem; color: #fff; }
.hm-aside-head span:last-child { font-size: 0.8rem; color: var(--text-secondary); }
.hm-board { list-style: none; margin: 0; padding: 0; }
.hm-board li a { display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem 0.2rem; border-bottom: 1px solid var(--border); color: #eee; text-decoration: none; font-size: 0.9rem; }
.hm-board li:last-child a { border-bottom: none; }
.hm-board li a:hover .hm-board-title { color: var(--ps-blue); }
.hm-board-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.hm-board-price { color: var(--ps-blue); font-weight: 800; }
.hm-rk { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 900; background: #222; color: #ccc; }
.hm-rk-1 { background: #F0A500; color: #1a1200; }
.hm-rk-2 { background: #C9CED6; color: #1b1e22; }
.hm-rk-3 { background: #C98B4E; color: #1f1206; }

/* ── Power-up + trust ── */
.hm-power-wrap { padding-top: 1rem; }
.hm-power { display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem 0.75rem; background: rgba(240,165,0,0.08); border: 1px solid rgba(240,165,0,0.35); border-radius: 12px; padding: 0.7rem 1rem; color: #eee; text-decoration: none; font-size: 0.92rem; }
.hm-power-tag { font-weight: 900; color: var(--ps-blue); }
.hm-power-text b { color: #fff; }
.hm-power-go { margin-left: auto; font-weight: 800; color: var(--ps-blue); font-size: 0.85rem; }
.hm-trust { list-style: none; margin: 0.6rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.35rem 1.1rem; font-size: 0.82rem; color: var(--text-secondary); }

/* ── Quick picks ── */
.hm-picks { display: flex; gap: 0.5rem; overflow-x: auto; scrollbar-width: none; padding-top: 1.1rem; padding-bottom: 0.25rem; }
.hm-picks::-webkit-scrollbar { display: none; }
.hm-pick { flex-shrink: 0; display: inline-flex; align-items: center; white-space: nowrap; background: var(--bg-card); border: 1px solid #2a2a2a; border-radius: 999px; padding: 0.45rem 0.9rem; color: #ddd; font-size: 0.82rem; font-weight: 700; text-decoration: none; }
.hm-pick .hm-mark { margin-right: 0.4rem; }
.hm-pick:hover { border-color: #444; color: #fff; }
.hm-pick-tri { border-color: rgba(62,163,122,0.5); }
.hm-pick-cir { border-color: rgba(224,86,91,0.5); }
.hm-pick-x { border-color: rgba(91,141,239,0.5); }
.hm-pick-sq { border-color: rgba(217,138,192,0.5); }

/* ── Game shelves: swipe row on phones, up to 6 a row on computers ── */
.hm-row { display: flex; gap: 0.75rem; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; padding-bottom: 0.25rem; }
.hm-row::-webkit-scrollbar { display: none; }
.hm-cell { position: relative; flex: 0 0 44%; max-width: 200px; scroll-snap-align: start; }
@media (min-width: 700px) {
  .hm-row { display: grid; overflow: visible; grid-template-columns: repeat(auto-fill, minmax(max(170px, calc((100% - 6.25rem) / 6)), 1fr)); gap: 1.25rem; }
  .hm-cell { max-width: none; }
  .hm-row > .hm-cell:nth-child(n+7) { display: none; }
}
@media (min-width: 900px) { .hm-phone-only { display: none; } }
.hm-medal { position: absolute; z-index: 3; top: -0.45rem; left: -0.35rem; min-width: 28px; height: 22px; padding: 0 0.35rem; border-radius: 11px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 900; background: #2a2a2a; color: #eee; box-shadow: 0 2px 6px rgba(0,0,0,0.5); }
.hm-medal.hm-rk-1 { background: #F0A500; color: #1a1200; }
.hm-medal.hm-rk-2 { background: #C9CED6; color: #1b1e22; }
.hm-medal.hm-rk-3 { background: #C98B4E; color: #1f1206; }
.hm-row { padding-top: 0.5rem; }

/* Coming soon (partials/upcoming-section) keeps its own look; spacing to match. */
.home2 .section[data-upcoming] { padding: 2.5rem 2rem 0; }
.home2 .section-title::after { content: none; }
.home2 .section[data-upcoming] .section-title { font-size: 1.35rem; font-weight: 900; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 1rem; }
.home2 .section[data-upcoming] .section-viewall { margin-left: auto; background: none; border: none; padding: 0; color: var(--ps-blue); font-size: 0.8rem; }

/* ── PS Plus Deluxe ── */
.hm-psplus { display: grid; gap: 1.25rem; background: linear-gradient(135deg, rgba(91,141,239,0.12), rgba(91,141,239,0.02)); border: 1px solid rgba(91,141,239,0.4); border-radius: 16px; padding: 1.25rem; }
@media (min-width: 900px) { .hm-psplus { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); align-items: center; padding: 1.75rem; } }
.hm-title-plain { margin-bottom: 0.4rem; }
.hm-psplus-info p { margin: 0 0 0.6rem; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5; }
.hm-psplus-price { margin-bottom: 0.9rem; color: #ddd; }
.hm-psplus-price b { color: var(--ps-blue); font-size: 1.35rem; }
.hm-psplus-strip { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(96px, 1fr); gap: 0.6rem; overflow-x: auto; scrollbar-width: none; }
.hm-psplus-strip::-webkit-scrollbar { display: none; }
.hm-ps-tile { position: relative; display: block; aspect-ratio: 3 / 4; border-radius: 10px; overflow: hidden; background: #1c1f26; color: #fff; text-decoration: none; }
.hm-ps-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hm-ps-tile span { position: absolute; left: 0; right: 0; bottom: 0; padding: 1.4rem 0.45rem 0.4rem; font-size: 0.7rem; font-weight: 700; line-height: 1.25; background: linear-gradient(0deg, rgba(0,0,0,0.85), rgba(0,0,0,0)); }

/* ── Choose your player ── */
.hm-players { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; }
@media (min-width: 900px) { .hm-players { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; } }
.hm-player { display: flex; flex-direction: column; gap: 0.35rem; background: var(--bg-card); border: 1px solid #262626; border-radius: 14px; padding: 1rem; color: #eee; text-decoration: none; transition: border-color 0.15s, transform 0.15s; }
.hm-player:hover { border-color: var(--ps-blue); transform: translateY(-2px); }
.hm-player-name { font-weight: 900; font-size: 1rem; color: #fff; }
.hm-player-line { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.45; flex: 1; }
.hm-player-price { font-weight: 800; color: var(--ps-blue); }
.hm-foot { margin: 0.9rem 0 0; font-size: 0.85rem; color: var(--text-secondary); }
.hm-foot a { color: var(--ps-blue); }

/* ── Achievements ── */
.hm-trophies { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem; }
@media (min-width: 900px) { .hm-trophies { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); } }
.hm-trophy { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.15rem; padding: 1rem 0.5rem; border-radius: 14px; border: 1px solid rgba(240,165,0,0.35); background: rgba(240,165,0,0.06); }
.hm-trophy b { font-size: 1.5rem; font-weight: 900; color: var(--ps-blue); }
.hm-trophy span { font-size: 0.78rem; color: var(--text-secondary); }

/* ── How to play + questions ── */
.hm-howfaq { display: grid; gap: 1.5rem; padding-bottom: 3rem; }
@media (min-width: 900px) { .hm-howfaq { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 3rem; } }
.hm-steps { list-style: none; margin: 0; padding: 0; counter-reset: hmstep; display: grid; gap: 0.75rem; }
.hm-steps li { counter-increment: hmstep; position: relative; padding-left: 2.6rem; display: flex; flex-direction: column; gap: 0.15rem; }
.hm-steps li::before { content: counter(hmstep); position: absolute; left: 0; top: 0; width: 1.8rem; height: 1.8rem; border-radius: 50%; background: rgba(240,165,0,0.12); border: 1px solid rgba(240,165,0,0.45); color: var(--ps-blue); font-weight: 900; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; }
.hm-steps b { color: #fff; }
.hm-steps span { color: var(--text-secondary); font-size: 0.85rem; }

@media (max-width: 600px) {
  .hm-wrap, .home2 .section[data-upcoming] { padding-left: 1rem; padding-right: 1rem; }
  .hm-sec { padding-top: 2rem; }
  .hm-title, .home2 .section[data-upcoming] .section-title { font-size: 1.15rem; }
}
````

Create `public/js/home.js`:

````js
// The homepage "Now playing" banner (views/partials/home/top.ejs). The slides
// are a native scroll-snap row, so phones swipe them without help; this adds
// the dots, the arrows and a gentle auto-advance that stops for good once the
// visitor touches the banner, and never runs for reduced-motion users.
(function () {
  var root = document.getElementById('hmBanner');
  var track = document.getElementById('hmSlides');
  if (!root || !track) return;
  var slides = track.children;
  var n = slides.length;
  if (n < 2) return;
  var dots = root.querySelectorAll('.hm-dot');
  var cur = 0, timer = null, hovered = false, touched = false;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mark() {
    Array.prototype.forEach.call(dots, function (d, i) { d.classList.toggle('on', i === cur); });
  }
  function go(i) {
    cur = (i + n) % n;
    track.scrollTo({ left: slides[cur].offsetLeft, behavior: 'smooth' });
    mark();
  }
  // Keep the dots right when the visitor swipes.
  var settle = null;
  track.addEventListener('scroll', function () {
    clearTimeout(settle);
    settle = setTimeout(function () {
      var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i !== cur && i >= 0 && i < n) { cur = i; mark(); }
    }, 80);
  }, { passive: true });

  function stop() { touched = true; clearInterval(timer); }
  Array.prototype.forEach.call(dots, function (d, i) { d.addEventListener('click', function () { stop(); go(i); }); });
  var prev = document.getElementById('hmPrev'), next = document.getElementById('hmNext');
  if (prev) prev.addEventListener('click', function () { stop(); go(cur - 1); });
  if (next) next.addEventListener('click', function () { stop(); go(cur + 1); });
  track.addEventListener('touchstart', stop, { passive: true });
  root.addEventListener('mouseenter', function () { hovered = true; });
  root.addEventListener('mouseleave', function () { hovered = false; });

  if (!reduced) {
    timer = setInterval(function () {
      if (!touched && !hovered && !document.hidden) go(cur + 1);
    }, 6000);
  }
})();
````

- [ ] **Step 4: Apply the page edits**

Create `.superpowers/tmp-edits/index.ejs` (the new `views/index.ejs`; the script writes it with the file's BOM):

````ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Playstation Hub — PS5/PS4 Game Rentals</title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
  <link rel="stylesheet" href="/css/home-search.css?v=<%= assetV %>">
  <link rel="stylesheet" href="/css/home.css?v=<%= assetV %>">
  <meta name="facebook-domain-verification" content="noj6ccmsehjq0v2oeq2e716fgyaqq0" />
</head>
<body class="home2">

<%#
  The "arcade store" homepage — docs/superpowers/specs/2026-10-10-homepage-arcade-store-design.md.
  Blocks render top to bottom in this order on every screen size (no CSS
  re-ordering); each lives in views/partials/home/. What they show is worked
  out in lib/home-view.js and passed as `home` by server.js GET /.
%>
<%- include('partials/announcement') %>
<%- include('partials/popup') %>
<%- include('partials/nav', { active: 'home' }) %>

<%- include('partials/home/top', { home, settings, featured }) %>
<%- include('partials/home/power', { home }) %>
<%- include('partials/home/quick-picks', { home, specialDeals, upcoming, psplusPopular }) %>

<%# Phones only — on computers the same list sits beside the banner. %>
<% if (home.topRented.length) { %>
<%- include('partials/home/game-row', { id: 'topRented', mark: 'tri', title: 'Top rented', sub: 'this month', games: home.topRented.map(t => t.game), viewAll: '', ranked: true, dealPrice: false, extraClass: 'hm-phone-only' }) %>
<% } %>

<% if (home.newGames.length) { %>
<%- include('partials/home/game-row', { id: 'newReleasesSection', mark: 'tri', title: 'New releases', sub: '', games: home.newGames, viewAll: '/browse', ranked: false, dealPrice: false }) %>
<% } %>

<% if (specialDeals.length) { %>
<%- include('partials/home/game-row', { id: 'specialDealsSection', mark: 'cir', title: 'Loot drops', sub: 'special deals', games: specialDeals, viewAll: '', ranked: false, dealPrice: true }) %>
<% } %>

<!-- UPCOMING GAMES (COMING SOON) -->
<%- include('partials/upcoming-section', { upcoming: upcoming.slice(0, 6), noBorderTop: true, viewAllHref: '/browse#comingSoon', homeMarker: true }) %>

<%- include('partials/home/psplus', { home, psplusPopular, psplusSlug }) %>
<%- include('partials/home/players', { home, promo }) %>
<%- include('partials/home/achievements', { home, games, reviews, reviewStats, recommend: (typeof recommend !== 'undefined' ? recommend : null), reviewBadge, reviewDisplayName, renterCount }) %>
<%- include('partials/home/how-faq', { promo }) %>

<%- include('partials/footer') %>

<!-- RESERVE MODAL -->
<div class="modal-overlay" id="reserveModal">
  <div class="modal">
    <div style="font-size:1.5rem;margin-bottom:0.5rem;">🔔</div>
    <h2>Reserve a Slot</h2>
    <div id="reserveGameTitle" style="font-weight:700;font-size:1rem;color:#a855f7;margin:0.5rem 0 1rem;"></div>
    <div style="background:#111;border:1px solid #222;border-radius:10px;padding:1rem;margin-bottom:1.25rem;text-align:left;">
      <div style="font-size:0.82rem;color:#bbb;line-height:1.7;margin-bottom:0.75rem;">
        This game is not yet available but you can <strong style="color:#fff;">reserve your slot now</strong>. Message us on Facebook to lock in your reservation!
      </div>
      <div style="font-size:0.78rem;color:var(--ps-blue);font-weight:700;margin-bottom:0.25rem;">📘 Message us on Facebook:</div>
      <div style="font-size:0.8rem;color:#888;">Include the game name and your preferred rental duration.</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeReserveModal()" style="flex:1;">Cancel</button>
      <a href="http://m.me/PlaystationHub00" target="_blank" rel="noopener"
        class="btn" style="flex:1;text-align:center;background:linear-gradient(135deg,#4a0080,#7b2ff7);color:#fff;font-weight:700;border-radius:50px;padding:0.75rem 1.75rem;text-decoration:none;"
        onclick="closeReserveModal()">📘 Message Us</a>
    </div>
  </div>
</div>

<%- include('partials/rent-modal') %>

<script>
// Promo config from server
const _rentPromo = { enabled: <%- promo.enabled ? 'true' : 'false' %>, discounts: { 10: <%= (promo.discounts && promo.discounts[10]) || 0 %>, 15: <%= (promo.discounts && promo.discounts[15]) || 0 %>, 30: <%= (promo.discounts && promo.discounts[30]) || 0 %> } };
const _buyPromo  = { enabled: <%- promo.buy_promo_enabled ? 'true' : 'false' %>, pct: <%= promo.buy_promo_pct || 0 %> };
</script>
<script src="/js/index-4.js?v=<%= assetV %>"></script>
<script src="/js/home.js?v=<%= assetV %>"></script>
</body>
</html>
````

Create `.superpowers/tmp-edits/edit-home-page.js`:

````js
// The new homepage templates (run from the repo root; index.ejs sits next to
// this script).
const fs = require('fs');
const path = require('path');
const rep = require('./rep');

// ── views/index.ejs (LF + BOM) ───────────────────────────────────────────────
rep.put('views/index.ejs', fs.readFileSync(path.join(__dirname, 'index.ejs'), 'utf8'));

// ── Search: a compact mode for the top of the new homepage ───────────────────
const HS = 'views/partials/home-search.ejs';
rep(HS, `<% const hsChips = (featured || []).filter(g => g.cover_image).slice(0, 4); %>
<section class="hs" id="homeSearch" aria-label="Find a game">
  <h2 class="hs-title">What game are you looking for?</h2>
  <p class="hs-sub">See right away if it's free.</p>`, `<% const hsChips = (featured || []).filter(g => g.cover_image).slice(0, 4); %>
<%# compact: just the search field (the homepage's Top rented list does the chips' job). %>
<% const hsCompact = typeof compact !== 'undefined' && compact; %>
<section class="hs<%= hsCompact ? ' hs-compact' : '' %>" id="homeSearch" aria-label="Find a game">
  <h2 class="hs-title<%= hsCompact ? ' hm-sr' : '' %>">What game are you looking for?</h2>
  <% if (!hsCompact) { %><p class="hs-sub">See right away if it's free.</p><% } %>`);
rep(HS, `  <% if (hsChips.length) { %>`, `  <% if (hsChips.length && !hsCompact) { %>`);

// ── Coming soon: the homepage's □ marker ─────────────────────────────────────
rep('views/partials/upcoming-section.ejs', `    <span style="display:inline-flex;align-items:center;gap:0.5rem;">
      <span style="background:linear-gradient(135deg,#7b2ff7,#f107a3);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-size:1.1em;">🔜</span>
      Coming Soon
    </span>
    <span style="font-size:0.8rem;font-weight:500;color:#666;margin-left:0.5rem;">Open for Reservation</span>`, `    <% if (typeof homeMarker !== 'undefined' && homeMarker) { %>
    <span style="display:inline-flex;align-items:center;"><span class="hm-mark hm-sq">□</span>Coming soon</span>
    <span class="hm-sub">reserve a slot</span>
    <% } else { %>
    <span style="display:inline-flex;align-items:center;gap:0.5rem;">
      <span style="background:linear-gradient(135deg,#7b2ff7,#f107a3);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-size:1.1em;">🔜</span>
      Coming Soon
    </span>
    <span style="font-size:0.8rem;font-weight:500;color:#666;margin-left:0.5rem;">Open for Reservation</span>
    <% } %>`);

// ── style.css: the old homepage's phone re-ordering is gone ──────────────────
rep.between('public/css/style.css',
  `  /* In a column flex container, cross-axis (width) stretch doesn't reliably override`,
  `  /* Stats bar (63+ Games / ₱249 Starting Price / etc.) is desktop trust-signal`,
  '');
console.log('edited');
````

Run: `node .superpowers/tmp-edits/edit-home-page.js` → `edited`.
Then delete the scripts that only the old sections used: `git rm public/js/index-1.js public/js/index-2.js public/js/index-3.js`.
Then: `file views/index.ejs views/partials/home-search.ejs views/partials/upcoming-section.ejs public/css/style.css` → index.ejs UTF-8 with BOM (LF); upcoming-section and style.css CRLF; home-search LF.

- [ ] **Step 5: Bring the older homepage tests up to the new layout**

Create `.superpowers/tmp-edits/edit-home-tests.js`:

````js
// Older tests that described the previous homepage, brought up to the arcade-
// store layout (run from the repo root).
const rep = require('./rep');

// Special deals: the order-17 phone rule is gone; the row is simply in place.
rep('scripts/test-game-discount-pricing.js', `  await okAsync('on phones the row sits after New Releases, not above the hero', async () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(css.includes('.home-page #specialDealsSection { order: 17; }'));
  });`, `  await okAsync('the row sits below the top of the page on every screen (no CSS re-ordering)', async () => {
    assert.ok(home.body.indexOf('id="specialDealsSection"') > home.body.indexOf('class="hm-top"'));
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(!css.includes('#specialDealsSection { order'), 'no phone re-ordering rule');
  });`);

// Search: now the compact field at the top of the homepage, without chips.
rep('scripts/test-home-search.js', `// and checks the homepage: the "What game are you looking for?" strip sits
// above the hero with Popular chips built from the most-rented games, loads its
// stylesheet and scripts, and /api/search-index carries the fields the search
// draws (slots, price). The drawing script's ids must exist in the partial.`, `// and checks the homepage: the search is the compact field at the top of the
// page (no Popular chips — the Top rented list does that job), loads its
// stylesheet and scripts, and /api/search-index carries the fields the search
// draws (slots, price). The drawing script's ids must exist in the partial.`);
rep('scripts/test-home-search.js', `  await okAsync('the homepage renders with the search strip above the hero', async () => {
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
  });`, `  await okAsync('the homepage renders the compact search at the top, beside the tagline', async () => {
    assert.strictEqual(home.status, 200);
    const strip = home.body.indexOf('id="homeSearch"');
    assert.ok(strip > home.body.indexOf('class="hm-head"') && strip < home.body.indexOf('aria-label="Quick picks"'), 'in the top block');
    assert.ok(home.body.includes('class="hs hs-compact" id="homeSearch"'));
    assert.ok(home.body.includes('<h2 class="hs-title hm-sr">What game are you looking for?</h2>'), 'heading kept for screen readers');
    assert.ok(home.body.includes('id="hsInput"') && home.body.includes('id="hsResults"') && home.body.includes('id="hsDim"'));
  });

  await okAsync('no Popular chips on the compact search', async () => {
    assert.ok(!home.body.includes('class="hs-chip"') && !home.body.includes('Popular right now'));
  });`);

// Carousel guards: the homepage rows are now shelves (home.css) and the
// banner picks its own covered games (lib/home-view.js).
rep('scripts/test-homepage-carousel.js', `ok('New Releases renders six', () => {
  assert.ok(/newReleases\\.slice\\(0,\\s*6\\)\\.forEach/.test(src),
    'the New Releases row still slices to 6');
});

ok('but the hero still draws from the whole list', () => {
  // heroGames takes six that HAVE cover art. Capping the shared list would
  // leave the hero short whenever one of the top six has no artwork.
  const hero = src.match(/const heroGames\\s*=\\s*heroSource[^;]+;/);
  assert.ok(hero, 'heroGames is still built from heroSource');
  assert.ok(/const heroSource\\s*=\\s*\\(newReleases[^;]+;/.test(src),
    'and heroSource is the uncapped newReleases');
});`, `ok('New releases shows at most six a row on computers', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'home.css'), 'utf8');
  assert.ok(css.includes('.hm-row > .hm-cell:nth-child(n+7) { display: none; }'), 'shelves cap at six');
});

ok('but the banner draws its own covered games from the whole list', () => {
  // Capping the shared list would leave the banner short whenever one of the
  // top six has no artwork.
  assert.ok(/include\\('partials\\/home\\/top'/.test(src), 'the banner block is on the page');
  const hv = fs.readFileSync(path.join(__dirname, '..', 'lib', 'home-view.js'), 'utf8');
  assert.ok(/g && g\\.cover_image/.test(hv), 'bannerGames requires cover art');
});`);

// Extracted scripts: the old hero slideshow (index-1), PS Plus collapse
// (index-2) and promo countdown (index-3) went with their sections.
rep('scripts/test-js-extraction-index.js', `console.log('\\nindex.ejs — 4 inline blocks extracted to public/js/index-1..4.js');

for (const n of [1, 2, 3, 4]) {
  ok('public/js/index-' + n + '.js exists', () => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'public', 'js', 'index-' + n + '.js')), 'missing index-' + n + '.js');
  });
  ok('index-' + n + '.js has no leftover EJS tags', () => {
    const js = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'index-' + n + '.js'), 'utf8');
    assert.ok(!js.includes('<%'), 'an EJS tag was left in index-' + n + '.js');
  });
  ok('index.ejs requests index-' + n + '.js with the version query, in document order', () => {
    assert.ok(
      new RegExp('<script src="\\\\/js\\\\/index-' + n + '\\\\.js\\\\?v=<%=\\\\s*assetV\\\\s*%>"><\\\\/script>').test(viewSrc),
      'index.ejs does not request /js/index-' + n + '.js with ?v=<%= assetV %>'
    );
  });
}

ok('the 4 script tags still appear in their original relative order', () => {
  const positions = [1, 2, 3, 4].map(n => viewSrc.indexOf('/js/index-' + n + '.js'));
  assert.ok(positions.every(p => p !== -1), 'not all 4 script references found');
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1], 'index-' + (i + 1) + '.js appears before index-' + i + '.js — order changed');
  }
});`, `console.log('\\nindex.ejs — the remaining extracted script, public/js/index-4.js');

ok('public/js/index-4.js exists with no leftover EJS tags', () => {
  const js = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'index-4.js'), 'utf8');
  assert.ok(!js.includes('<%'), 'an EJS tag was left in index-4.js');
});
ok('index.ejs requests index-4.js and then home.js, with the version query', () => {
  assert.ok(/<script src="\\/js\\/index-4\\.js\\?v=<%=\\s*assetV\\s*%>"><\\/script>/.test(viewSrc));
  assert.ok(viewSrc.indexOf('/js/index-4.js') < viewSrc.indexOf('/js/home.js'));
});
ok('the old hero, PS Plus collapse and promo countdown scripts are gone with their sections', () => {
  [1, 2, 3].forEach(n => {
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, 'public', 'js', 'index-' + n + '.js')), 'index-' + n + '.js still exists');
    assert.ok(!viewSrc.includes('/js/index-' + n + '.js'), 'index.ejs still requests index-' + n + '.js');
  });
});`);
console.log('edited');
````

Run: `node .superpowers/tmp-edits/edit-home-tests.js` → `edited`.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `node scripts/test-home-page.js` → `14 assertions passed`.
Run: `node scripts/test-game-discount-pricing.js && node scripts/test-home-search.js && node scripts/test-homepage-carousel.js && node scripts/test-js-extraction-index.js && node scripts/test-tier-pill.js && node scripts/test-home-banner-admin.js && node scripts/test-game-discount-admin.js` → all pass (12, 5, 14, 5, 10, 4, 8).

- [ ] **Step 7: Commit**

```bash
git add views/index.ejs views/partials/home public/css/home.css public/js/home.js scripts/test-home-page.js views/partials/home-search.ejs views/partials/upcoming-section.ejs public/css/style.css scripts/test-game-discount-pricing.js scripts/test-home-search.js scripts/test-homepage-carousel.js scripts/test-js-extraction-index.js
git commit -m "Homepage redesign: arcade store layout, one block per partial

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(The `git rm` from Step 4 is part of this commit.)

---

### Task 4: Full regression and cleanup

**Files:** none changed.

- [ ] **Step 1: Run every test file and list failures**

```bash
fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail of $(ls scripts/test-*.js | wc -l)"
```
Expected: only `FAIL scripts/test-requests-page.js`, `failed: 1 of 103`.

- [ ] **Step 2: Remove the scratch scripts and check the tree**

```bash
rm -rf .superpowers/tmp-edits && git status --short
```
Expected: no output except possibly the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.

Do not push; tell the owner it is ready: Admin → Content → Homepage banner to pin up to 5 games; the tagline comes from Admin → Content → Hero text.
