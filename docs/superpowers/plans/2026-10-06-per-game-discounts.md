# Per-Game Discounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner give selected games their own Weekly / Monthly rent discount that replaces the site promo, everywhere that game's rental is priced, with an admin table and a homepage "Special deals" row.

**Architecture:** A pure `lib/game-discount.js` decides each game's % (`game.discounts = { 7, 30 }`, else the site promo). `server.js` routes every game-priced rental figure through one `rentDiscountPct(game, days, promo)` helper and exposes `gameDiscountPct` / `gameSpecialDeal` to views. An admin table in Settings writes `game.discounts`; the homepage lists games whose own % beats the site promo.

**Tech Stack:** Node, Express, EJS, lowdb v1 (`games.json`). No new dependencies. Tests are plain `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-06-per-game-discounts-design.md`

## Global Constraints

- Work directly on `main`; commit per task; **push only when the owner says "push"**.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Line endings** (the provided edit scripts preserve them; verify with `file`): `server.js` CRLF + UTF-8 BOM; `public/css/style.css`, `views/edit-customer.ejs`, `views/partials/game-card.ejs`, `views/browse.ejs` (also BOM), `views/partials/admin/settings.ejs` CRLF; `views/index.ejs` LF + BOM; `views/game-detail.ejs`, `views/admin.ejs`, `views/partials/admin/games/all-games.ejs`, `lib/*` and every new file LF.
- **Tests never touch real data:** boot tests use a temp `DATA_DIR`, `MONGODB_URI=''`, an in-memory session store and a made-up admin password; nothing reaches the project's `games.json`, a database, or the real admin.
- The rule: a game's own % (0–100) **replaces** the site promo for that duration (never stacks); empty/null = site promo; 0 = no discount; a game's own % works even when the site promo is off; no end dates; rent only (Weekly 7 and Monthly 30).
- Quick Add "Full price" turns off **every** discount, the game's own included (promo object flag `no_discounts: true`).
- Unchanged: the PS Plus Deluxe rent page and its orders (`isPsplus` branches keep `getPromoDiscountPct`), buy promos, the search index "from ₱", the Messenger bot promo text, the poster promo banner, the homepage promo ladder, rentals already made.
- The homepage rent modal (`openRentModal`) has no callers, so it is not touched.
- Known unrelated failure: `scripts/test-requests-page.js`. Report it, do not fix it.
- Scratch edit scripts live in `.superpowers/tmp-edits/` (git-excluded); never commit them; Task 4 removes the folder.

## File Structure

| File | Responsibility |
|---|---|
| `lib/game-discount.js` (new) | The rule: `sitePct`, `ownPct`, `hasOwnDiscount`, `discountPct`, `specialDeal`, `cleanInput`, `applyPct` |
| `server.js` | `rentDiscountPct` helper; every game-priced rental figure; view locals; homepage `specialDeals`; admin table rows + save route |
| `views/game-detail.ejs`, `views/partials/game-card.ejs`, `views/browse.ejs`, `views/index.ejs`, `views/edit-customer.ejs`, `public/css/style.css` | Customer-facing prices, deal line, homepage row, swap box |
| `views/partials/admin/settings.ejs`, `views/admin.ejs`, `lib/games-view.js`, `views/partials/admin/games/all-games.ejs` | Admin table, toast, Games list tag |

---

### Task 1: The discount rule (library)

**Files:**
- Create: `lib/game-discount.js`, `scripts/test-game-discount.js`

**Interfaces:**
- Produces: `sitePct(promo, days) → number`, `ownPct(game, days) → number|null`, `hasOwnDiscount(game, days) → boolean`, `discountPct(game, days, promo) → number`, `specialDeal(game, promo) → { days, pct } | null` (Monthly wins ties), `cleanInput(raw) → number|null` (0–100), `applyPct(base, pct) → number` (`base - round(base*pct/100)`). Tasks 2 and 3 consume these.

- [ ] **Step 1: Write the test**

Create `scripts/test-game-discount.js`:

````js
// Run: node scripts/test-game-discount.js
const assert = require('assert');
const gd = require('../lib/game-discount');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const SITE_ON = { enabled: true, discounts: { 7: 0, 30: 10 } };
const SITE_OFF = { enabled: false, discounts: { 7: 0, 30: 10 } };

console.log('\ndiscountPct');
ok("a game's own % replaces the site promo (never stacks)", () => {
  assert.strictEqual(gd.discountPct({ discounts: { 30: 20 } }, 30, SITE_ON), 20);
});
ok('empty / missing / null follows the site promo', () => {
  assert.strictEqual(gd.discountPct({}, 30, SITE_ON), 10);
  assert.strictEqual(gd.discountPct({ discounts: { 30: null } }, 30, SITE_ON), 10);
  assert.strictEqual(gd.discountPct({ discounts: { 30: '' } }, 30, SITE_ON), 10);
  assert.strictEqual(gd.discountPct({ discounts: { 7: 15 } }, 30, SITE_ON), 10, 'other duration set only');
  assert.strictEqual(gd.discountPct(null, 30, SITE_ON), 10);
});
ok('0 means no discount for that game', () => {
  assert.strictEqual(gd.discountPct({ discounts: { 30: 0 } }, 30, SITE_ON), 0);
});
ok('site promo off: own % still applies, everything else is full price', () => {
  assert.strictEqual(gd.discountPct({ discounts: { 30: 20 } }, 30, SITE_OFF), 20);
  assert.strictEqual(gd.discountPct({}, 30, SITE_OFF), 0);
  assert.strictEqual(gd.discountPct({}, 30, null), 0);
});
ok('stored values are clamped and rounded', () => {
  assert.strictEqual(gd.discountPct({ discounts: { 30: 150 } }, 30, SITE_ON), 100);
  assert.strictEqual(gd.discountPct({ discounts: { 30: -5 } }, 30, SITE_ON), 0);
  assert.strictEqual(gd.discountPct({ discounts: { 30: '19.6' } }, 30, SITE_ON), 20);
  assert.strictEqual(gd.discountPct({ discounts: { 30: 'abc' } }, 30, SITE_ON), 10, 'junk follows the site promo');
});

console.log('\nhasOwnDiscount / sitePct');
ok('own vs site', () => {
  assert.strictEqual(gd.hasOwnDiscount({ discounts: { 30: 0 } }, 30), true);
  assert.strictEqual(gd.hasOwnDiscount({ discounts: { 30: null } }, 30), false);
  assert.strictEqual(gd.hasOwnDiscount({}, 7), false);
  assert.strictEqual(gd.sitePct(SITE_ON, 30), 10);
  assert.strictEqual(gd.sitePct(SITE_OFF, 30), 0);
});

console.log('\nspecialDeal');
ok('own % above the site promo is a deal; Monthly wins a tie', () => {
  assert.deepStrictEqual(gd.specialDeal({ discounts: { 30: 20 } }, SITE_ON), { days: 30, pct: 20 });
  assert.deepStrictEqual(gd.specialDeal({ discounts: { 7: 10, 30: 20 } }, SITE_ON), { days: 30, pct: 20 }, 'gain 10 vs 10 → monthly');
  assert.deepStrictEqual(gd.specialDeal({ discounts: { 7: 15, 30: 15 } }, SITE_ON), { days: 7, pct: 15 }, 'weekly gains 15, monthly 5');
});
ok('equal to or below the site promo is not a deal', () => {
  assert.strictEqual(gd.specialDeal({ discounts: { 30: 10 } }, SITE_ON), null);
  assert.strictEqual(gd.specialDeal({ discounts: { 30: 0 } }, SITE_ON), null);
  assert.strictEqual(gd.specialDeal({}, SITE_ON), null);
});
ok('with the site promo off, any own % above 0 is a deal', () => {
  assert.deepStrictEqual(gd.specialDeal({ discounts: { 30: 10 } }, SITE_OFF), { days: 30, pct: 10 });
});

console.log('\ncleanInput / applyPct');
ok('table boxes', () => {
  assert.strictEqual(gd.cleanInput(''), null);
  assert.strictEqual(gd.cleanInput('  '), null);
  assert.strictEqual(gd.cleanInput('abc'), null);
  assert.strictEqual(gd.cleanInput('20'), 20);
  assert.strictEqual(gd.cleanInput('0'), 0);
  assert.strictEqual(gd.cleanInput('250'), 100);
  assert.strictEqual(gd.cleanInput('-3'), 0);
  assert.strictEqual(gd.cleanInput(undefined), null);
});
ok('price rounding matches the rest of the site', () => {
  assert.strictEqual(gd.applyPct(799, 20), 639);
  assert.strictEqual(gd.applyPct(799, 10), 719);
  assert.strictEqual(gd.applyPct(799, 0), 799);
  assert.strictEqual(gd.applyPct(0, 50), 0);
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-game-discount.js` → FAIL `Cannot find module '../lib/game-discount'`.

- [ ] **Step 3: Create the module**

Create `lib/game-discount.js`:

````js
// Per-game rent discounts. The site promo (site_settings.promo) gives every
// game the same Weekly % and Monthly %; a game may carry its own instead:
//
//   game.discounts = { 7: number | null, 30: number | null }
//
// A number (0–100) REPLACES the site promo for that game and duration — 20
// means 20%, never 10% + 20% — and 0 means no discount. Missing / null means
// the game follows the site promo. A game's own % ignores the site promo's
// on/off switch: turning the site promo off only removes the default.
// Pure; server.js and the views call these through app.locals.

// The site promo's % for a duration (0 when it is off or has none).
function sitePct(promo, days) {
  if (!promo || !promo.enabled || !promo.discounts) return 0;
  return Number(promo.discounts[days]) || 0;
}

// The game's own % for a duration, or null when it follows the site promo.
function ownPct(game, days) {
  const d = game && game.discounts;
  if (!d || typeof d !== 'object') return null;
  const v = d[days];
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function hasOwnDiscount(game, days) {
  return ownPct(game, days) !== null;
}

// The % to take off `game`'s `days`-day price.
function discountPct(game, days, promo) {
  const own = ownPct(game, days);
  return own !== null ? own : sitePct(promo, days);
}

// The duration where the game's own % beats the site promo by the most, as
// { days, pct }, or null when no own % beats it. Monthly wins a tie. Drives
// the homepage "Special deals" row and its ribbon.
function specialDeal(game, promo) {
  let best = null;
  [30, 7].forEach(days => {
    const own = ownPct(game, days);
    if (own === null) return;
    const gain = own - sitePct(promo, days);
    if (gain <= 0) return;
    if (!best || gain > best.gain) best = { days, pct: own, gain };
  });
  return best ? { days: best.days, pct: best.pct } : null;
}

// A table box's value: null for empty or not a number, else 0–100.
function cleanInput(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

// base − round(base × pct / 100): the rounding every price on the site uses.
function applyPct(base, pct) {
  const b = Number(base) || 0;
  return pct > 0 ? b - Math.round(b * pct / 100) : b;
}

module.exports = { sitePct, ownPct, hasOwnDiscount, discountPct, specialDeal, cleanInput, applyPct };
````

- [ ] **Step 4: Run it and watch it pass**

Run: `node scripts/test-game-discount.js` → `11 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/game-discount.js scripts/test-game-discount.js
git commit -m "Per-game discount rule: own % replaces the site promo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Every price of a game's rental uses its own discount

**Files:**
- Create: `scripts/test-game-discount-pricing.js`
- Modify: `server.js`, `views/game-detail.ejs`, `views/partials/game-card.ejs`, `views/browse.ejs`, `views/index.ejs`, `views/edit-customer.ejs`, `public/css/style.css` — via the two edit scripts

**Interfaces:**
- Consumes: Task 1's `discountPct`, `specialDeal`.
- Produces: in `server.js` — `const gameDiscount = require('./lib/game-discount');`, `rentDiscountPct(game, days, promo)` (0 when `promo.no_discounts`), `app.locals.gameDiscountPct(game, days, promo)`, `app.locals.gameSpecialDeal(game, promo)`, `buildPosterGroup(name, games, promo)` (was `discount10`), homepage render local `specialDeals` (array of resolved games, ≤12, biggest % first). Views: game-card local `dealPrice` (boolean), card line `.gc2-deal`, homepage section `#specialDealsSection` (phone order 17), swap-box option attributes `data-pct7` / `data-pct30`. Task 3's CSS edit anchors on the `.gc2-deal` rule added here.

- [ ] **Step 1: Write the test**

Create `scripts/test-game-discount-pricing.js` (boots a throwaway instance with four games — own Monthly 20%, site promo, own Weekly 50%, own Monthly 0% — and checks the game page, browse cards, homepage row, Facebook feed, Quick Add prices, posters and the swap box):

````js
// Run: node scripts/test-game-discount-pricing.js
//
// Per-game discounts reach every page that prices a game's rental. Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a
// made-up admin password) with:
//   Zzyzx Deal    own Monthly 20%           (site promo: Weekly 0%, Monthly 10%)
//   Zzyzx Plain   no own % → site promo
//   Zzyzx Weekly  own Weekly 50%
//   Zzyzx Zero    own Monthly 0% → no discount
// The project's games.json, the database and the real admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4612;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'game-discount-pricing-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', cover_image: '/uploads/' + id + '.png',
  nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899,
  non_trophy_slots: 2, trophy_slots: 2, renters: 10 - id
}, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 } },
  games: [
    game(1, 'Zzyzx Deal', { discounts: { 7: null, 30: 20 } }),
    game(2, 'Zzyzx Plain'),
    game(3, 'Zzyzx Weekly', { nt_price_7d: 400, nt_price_30d: 800, tr_price_7d: 450, discounts: { 7: 50, 30: null } }),
    game(4, 'Zzyzx Zero', { discounts: { 7: null, 30: 0 } })
  ],
  customers: [{
    id: 1, customer_name: 'Swap Tester', game_id: 2, game_title: 'Zzyzx Plain', days: 30, account_type: 'nt',
    start_date: '2026-10-01', end_date: '2026-10-31', price: 719, status: 'renting', notes: '',
    payments: [{ amount: 719, date: '2026-10-01', kind: 'rental' }]
  }]
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
const get = (p, cookie) => call('GET', p, { headers: cookie ? { Cookie: cookie } : {} });

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }
// The HTML of the card that links to a game, within `html`.
function cardFor(html, slug) {
  const i = html.indexOf('href="/game/' + slug + '"');
  assert.ok(i >= 0, 'card for ' + slug + ' found');
  const end = html.indexOf('</a>', i);
  return html.slice(i, end);
}

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

  console.log('\ngame page');
  await okAsync("a game's own Monthly % replaces the site promo in the page's prices", async () => {
    const r = await get('/game/zzyzx-deal');
    assert.strictEqual(r.status, 200);
    assert.ok(/discounts: \{ 7: 0, 30: 20 \}/.test(r.body), 'PROMO.discounts');
    assert.ok(/enabled: true,/.test(r.body));
    assert.ok(r.body.includes('<span class="gd-dur-promo">20% OFF</span>'));
  });
  await okAsync('a game with no own % follows the site promo', async () => {
    const r = await get('/game/zzyzx-plain');
    assert.ok(/discounts: \{ 7: 0, 30: 10 \}/.test(r.body));
    assert.ok(r.body.includes('<span class="gd-dur-promo">10% OFF</span>'));
  });
  await okAsync('an own 0% means no discount at all', async () => {
    const r = await get('/game/zzyzx-zero');
    assert.ok(/discounts: \{ 7: 0, 30: 0 \}/.test(r.body));
    assert.ok(!r.body.includes('gd-dur-promo'));
  });

  console.log('\ncards and homepage');
  const browse = await get('/browse');
  await okAsync('browse cards carry the deal line only when the own % beats the site promo', async () => {
    assert.ok(cardFor(browse.body, 'zzyzx-deal').includes('🔥 20% OFF · Monthly'));
    assert.ok(cardFor(browse.body, 'zzyzx-weekly').includes('🔥 50% OFF · Weekly'));
    assert.ok(!cardFor(browse.body, 'zzyzx-plain').includes('gc2-deal'));
    assert.ok(!cardFor(browse.body, 'zzyzx-zero').includes('gc2-deal'));
  });
  await okAsync('the Weekly-deal card starts from its discounted weekly price', async () => {
    assert.ok(cardFor(browse.body, 'zzyzx-weekly').includes('from <b>₱200</b>'));
  });
  const home = await get('/');
  await okAsync('the homepage "Special deals" row lists the deals, biggest first, priced at the deal', async () => {
    assert.strictEqual(home.status, 200);
    const start = home.body.indexOf('id="specialDealsSection"');
    assert.ok(start > 0, 'section present');
    const section = home.body.slice(start, home.body.indexOf('<!-- UPCOMING GAMES', start));
    const weekly = section.indexOf('/game/zzyzx-weekly');
    const deal = section.indexOf('/game/zzyzx-deal');
    assert.ok(weekly > 0 && deal > weekly, '50% before 20%');
    assert.ok(!section.includes('/game/zzyzx-plain') && !section.includes('/game/zzyzx-zero'));
    assert.ok(cardFor(section, 'zzyzx-deal').includes('Monthly <b>₱639</b><s class="gc2-price-was">₱799</s>'));
    assert.ok(cardFor(section, 'zzyzx-weekly').includes('Weekly <b>₱200</b><s class="gc2-price-was">₱400</s>'));
  });
  await okAsync('on phones the row sits after New Releases, not above the hero', async () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(css.includes('.home-page #specialDealsSection { order: 17; }'));
  });

  console.log('\nfeed');
  await okAsync('the Facebook product feed uses each game\'s own sale price', async () => {
    const r = await get('/feed/meta-catalog.csv');
    const line = label => r.body.split('\n').find(l => l.includes(label)) || '';
    assert.ok(line('Zzyzx Deal — Monthly (Non-Trophy)').includes('639.00 PHP'));
    assert.ok(line('Zzyzx Plain — Monthly (Non-Trophy)').includes('719.00 PHP'));
    assert.ok(line('Zzyzx Weekly — Weekly (Non-Trophy)').includes('200.00 PHP'));
    assert.ok(!line('Zzyzx Zero — Monthly (Non-Trophy)').includes('PHP,7'), 'no sale price');
  });

  console.log('\nadmin pages');
  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(TEST_PASSWORD) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const admin = await get('/admin', cookie);
  await okAsync('Quick Add prices each game with its own % ("Full price" ignores it)', async () => {
    assert.strictEqual(admin.status, 200);
    // The Quick Add picker's option (it carries data-nt7; other pickers don't).
    const opt = id => {
      const m = new RegExp('<option value="' + id + '"\\s+data-nt7=[^>]*>').exec(admin.body);
      return m ? m[0] : '';
    };
    assert.ok(/data-nt30="639"/.test(opt(1)) && /data-nt30f="799"/.test(opt(1)), opt(1).slice(0, 200));
    assert.ok(/data-nt30="719"/.test(opt(2)) && /data-nt30f="799"/.test(opt(2)));
    assert.ok(/data-nt30="799"/.test(opt(4)), 'own 0% → full price even while the site promo is on');
  });
  await okAsync('posters print each game\'s own weekly price', async () => {
    const i = admin.body.indexOf('<div class="poster-tile-title">Zzyzx Weekly</div>');
    assert.ok(i > 0, 'poster tile present');
    assert.ok(admin.body.slice(i, i + 400).includes('from <b>₱200</b>'));
  });
  await okAsync('the swap box knows each game\'s own %', async () => {
    const r = await get('/admin/customers/edit/1', cookie);
    assert.strictEqual(r.status, 200);
    assert.ok(/<option value="1"[\s\S]*?data-pct7="0" data-pct30="20"/.test(r.body));
    assert.ok(/<option value="2"[\s\S]*?data-pct7="0" data-pct30="10"/.test(r.body));
    assert.ok(/<option value="4"[\s\S]*?data-pct7="0" data-pct30="0"/.test(r.body));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-game-discount-pricing.js` → FAIL (the game page still shows `discounts: { 7: 0, 30: 10 }` for Zzyzx Deal).

- [ ] **Step 3: Server edits**

Create `.superpowers/tmp-edits/rep.js` (CRLF/BOM-safe single replace; fails loudly on a missing or repeated anchor):

````js
// scratch helper: rep(file, oldLF, newLF) — CRLF/BOM-safe single replace
const fs = require('fs');
module.exports = function rep(file, oldS, newS) {
  const s = fs.readFileSync(file, 'utf8');
  const crlf = s.includes('\r\n');
  const o = crlf ? oldS.replace(/\n/g, '\r\n') : oldS;
  const n = crlf ? newS.replace(/\n/g, '\r\n') : newS;
  const i = s.indexOf(o);
  if (i < 0) throw new Error('anchor not found in ' + file + ': ' + oldS.slice(0, 70));
  if (s.indexOf(o, i + 1) >= 0) throw new Error('anchor not unique in ' + file + ': ' + oldS.slice(0, 70));
  fs.writeFileSync(file, s.slice(0, i) + n + s.slice(i + o.length));
};
````

Create `.superpowers/tmp-edits/edit-gd-server.js`. It requires the library, adds the view locals, makes `promotedTier` (Quick Add, Messenger orders, Extend) use `rentDiscountPct`, and switches the swap reference, the Facebook feed, website rental orders, fall-in-line and priority totals, the priority upgrade, Quick Add's "Full price" (`no_discounts: true`) and the posters:

````js
// Per-game discounts — server.js edits (run from the repo root).
const rep = require('./rep');
const F = 'server.js';

rep(F, "const swapCharge = require('./lib/swap-charge');\n",
"const swapCharge = require('./lib/swap-charge');\nconst gameDiscount = require('./lib/game-discount');\n");

rep(F, `app.locals.getPromoDiscountPct = (promo, days) => getPromoDiscountPct(promo, days);
`, `app.locals.getPromoDiscountPct = (promo, days) => getPromoDiscountPct(promo, days);
// A specific game's rent discount (its own % if set, else the site promo) — see
// lib/game-discount.js. Every view that prices a game's rental uses this.
app.locals.gameDiscountPct = (game, days, promo) => gameDiscount.discountPct(game, days, promo);
app.locals.gameSpecialDeal = (game, promo) => gameDiscount.specialDeal(game, promo);
`);

// promotedTier: `resolved` is the game record (resolveGamePrices spreads it), so
// its own discounts come along. A promo object marked no_discounts (Quick Add's
// "Full price") turns off every discount, the game's own included.
rep(F, `function promotedTier(resolved, priceType, promo) {
  const tier = {};
  rentPricing.STANDARD_DAYS.forEach(d => {
    tier[d] = rentPricing.discounted(resolved[priceType + '_price_' + d + 'd'] || 0,
                                     getPromoDiscountPct(promo, d));
  });
  return tier;
}`, `function promotedTier(resolved, priceType, promo) {
  const tier = {};
  rentPricing.STANDARD_DAYS.forEach(d => {
    tier[d] = rentPricing.discounted(resolved[priceType + '_price_' + d + 'd'] || 0,
                                     rentDiscountPct(resolved, d, promo));
  });
  return tier;
}

// The % off one game's rental: its own discount if it has one, else the site
// promo (lib/game-discount.js). A promo object carrying no_discounts — Quick
// Add's "Full price" — means none at all, the game's own included, because a
// game's own % deliberately ignores promo.enabled.
function rentDiscountPct(game, days, promo) {
  if (promo && promo.no_discounts) return 0;
  return gameDiscount.discountPct(game, days, promo);
}`);

// Swap reference price.
rep(F, `  const base = resolved[usingType + '_price_' + d + 'd'];
  if (!base) return null;
  const pct = getPromoDiscountPct(promo, d);`, `  const base = resolved[usingType + '_price_' + d + 'd'];
  if (!base) return null;
  const pct = rentDiscountPct(resolved, d, promo);`);

// Meta product feed.
rep(F, `    RENTAL_DURATIONS.forEach(({ days: d, label: durLabel }) => {
      const pct = getPromoDiscountPct(promo, d);
      const cut = v => pct > 0 ? v - Math.round(v * pct / 100) : v;`, `    RENTAL_DURATIONS.forEach(({ days: d, label: durLabel }) => {
      const pct = rentDiscountPct(g, d, promo);
      const cut = v => pct > 0 ? v - Math.round(v * pct / 100) : v;`);

// Website rental order.
rep(F, `  if (!base) return res.redirect('/game/' + gameSlug(game.title) + '?order_error=1');

  const pct = getPromoDiscountPct(promo, d);`, `  if (!base) return res.redirect('/game/' + gameSlug(game.title) + '?order_error=1');

  const pct = rentDiscountPct(game, d, promo);`);

// Fall in line (free) — a catalogue game.
rep(F, `      if (!base) return res.redirect(errRedirect);
      const pct = getPromoDiscountPct(promo, d);
      const rentAfterPromo = pct > 0 ? base - Math.round(base * pct / 100) : base;
      const gameDeposit = (type === 'tr' || type === 'ps4') ? (promo.deposit || 0) : 0;
      remainingDue = rentAfterPromo + gameDeposit;`, `      if (!base) return res.redirect(errRedirect);
      const pct = rentDiscountPct(game, d, promo);
      const rentAfterPromo = pct > 0 ? base - Math.round(base * pct / 100) : base;
      const gameDeposit = (type === 'tr' || type === 'ps4') ? (promo.deposit || 0) : 0;
      remainingDue = rentAfterPromo + gameDeposit;`);

// Priority reservation — a catalogue game.
rep(F, `    if (!base) return res.redirect(errRedirect);
    const pct = getPromoDiscountPct(promo, d);
    const rentAfterPromo = pct > 0 ? base - Math.round(base * pct / 100) : base;
    const gameDeposit = (type === 'tr' || type === 'ps4') ? (promo.deposit || 0) : 0;`, `    if (!base) return res.redirect(errRedirect);
    const pct = rentDiscountPct(game, d, promo);
    const rentAfterPromo = pct > 0 ? base - Math.round(base * pct / 100) : base;
    const gameDeposit = (type === 'tr' || type === 'ps4') ? (promo.deposit || 0) : 0;`);

// Upgrading a free place in line to priority.
rep(F, `  const pct = getPromoDiscountPct(promo, order.days);`,
`  const pct = isPsplus ? getPromoDiscountPct(promo, order.days) : rentDiscountPct(game, order.days, promo);`);

// Quick Add "Full price": no discounts at all, the game's own included.
rep(F, `    ? Object.assign({}, livePromo, { enabled: false, buy_promo_enabled: false })`,
`    ? Object.assign({}, livePromo, { enabled: false, buy_promo_enabled: false, no_discounts: true })`);
rep(F, `  const qaNoPromo = Object.assign({}, qaPromo, { enabled: false, buy_promo_enabled: false });`,
`  const qaNoPromo = Object.assign({}, qaPromo, { enabled: false, buy_promo_enabled: false, no_discounts: true });`);

// Posters: each game's own Weekly % for its "From ₱X".
rep(F, `function buildPosterGroup(name, games, discount10) {
  const density = games.length <= 4 ? 'large' : 'compact';
  const perPage = density === 'large' ? 4 : 12;
  const gamesWithFromPrice = games.map(game => {
    const prices = [game.nt_price_7d, game.tr_price_7d].filter(p => p > 0);
    const rawFrom = prices.length ? Math.min(...prices) : null;
    const fromPrice = rawFrom != null && discount10 > 0 ? Math.round(rawFrom * (1 - discount10 / 100)) : rawFrom;`,
`function buildPosterGroup(name, games, promo) {
  const density = games.length <= 4 ? 'large' : 'compact';
  const perPage = density === 'large' ? 4 : 12;
  const gamesWithFromPrice = games.map(game => {
    const prices = [game.nt_price_7d, game.tr_price_7d].filter(p => p > 0);
    const rawFrom = prices.length ? Math.min(...prices) : null;
    const weeklyPct = rentDiscountPct(game, RENTAL_DURATIONS[0].days, promo);
    const fromPrice = rawFrom != null && weeklyPct > 0 ? Math.round(rawFrom * (1 - weeklyPct / 100)) : rawFrom;`);
rep(F, `  // Weekly is always the cheapest tier, so it's what "From ₱X" shows —
  // apply that duration's promo discount (if any) so the poster stays accurate.
  const discount10 = getPromoDiscountPct(promo, RENTAL_DURATIONS[0].days);
`, `  // Weekly is always the cheapest tier, so it's what "From ₱X" shows —
  // buildPosterGroup applies each game's own Weekly discount (or the site
  // promo's) so the poster stays accurate.
`);
rep(F, `  const posterGroups = groups.map(g => buildPosterGroup(g.name, g.games, discount10));
  if (newArrivalGames.length) posterGroups.unshift(buildPosterGroup('🆕 New Arrivals', newArrivalGames, discount10));`,
`  const posterGroups = groups.map(g => buildPosterGroup(g.name, g.games, promo));
  if (newArrivalGames.length) posterGroups.unshift(buildPosterGroup('🆕 New Arrivals', newArrivalGames, promo));`);
console.log('edited');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-gd-server.js` → `edited`.
Then: `node --check server.js && file server.js` (still BOM + CRLF), and `grep -n "getPromoDiscountPct(" server.js` → only the definition, the `app.locals` line, the PS Plus branches (`/order/create-psplus`, the two `isPsplus` branches in `/order/reserve`, the `isPsplus ?` in the upgrade), the poster `activePromos` banner and the two Messenger bot lines remain.

- [ ] **Step 4: Page edits**

Create `.superpowers/tmp-edits/edit-gd-views.js`. It prices the game page, game cards (plus the "🔥 N% OFF · Monthly" line and the deal price for the homepage row), browse and homepage category prices, the homepage hero and spotlight cards, adds the homepage "Special deals" row (and its `specialDeals` list in the `/` route, and its phone order slot), and gives the swap box each game's own %:

````js
// Per-game discounts — customer pages, the homepage deals row and the swap box
// (run from the repo root).
const rep = require('./rep');

// ── Game page ───────────────────────────────────────────────────────────────
const GD = 'views/game-detail.ejs';
rep(GD, `  ].filter(([base]) => base > 0).map(([base, d]) => {
    const pct = getPromoDiscountPct(promo, d);`, `  ].filter(([base]) => base > 0).map(([base, d]) => {
    const pct = gameDiscountPct(game, d, promo);`);
rep(GD, `const pct = promo.enabled ? ((promo.discounts && promo.discounts[d]) || 0) : 0; %>`,
  `const pct = gameDiscountPct(game, d, promo); %>`);
rep(GD, `const PROMO = {
  enabled: <%= promo.enabled ? 'true' : 'false' %>,
  discounts: { 7: <%= (promo.discounts && promo.discounts[7]) || 0 %>, 30: <%= (promo.discounts && promo.discounts[30]) || 0 %> },`,
`// This game's own discount per duration, or the site promo's when it has none
// (lib/game-discount.js) — already resolved, so it is always "enabled".
const PROMO = {
  enabled: true,
  discounts: { 7: <%= gameDiscountPct(game, 7, promo) %>, 30: <%= gameDiscountPct(game, 30, promo) %> },`);

// ── Game card (browse, homepage sliders) ─────────────────────────────────────
const GC = 'views/partials/game-card.ejs';
rep(GC, `  const gcPromoPct = (d) => (typeof getPromoDiscountPct === 'function') ? getPromoDiscountPct(gcPromo, d) : 0;`,
`  // The game's own discount if it has one, else the site promo's (lib/game-discount.js).
  const gcPromoPct = (d) => (typeof gameDiscountPct === 'function') ? gameDiscountPct(game, d, gcPromo)
    : ((typeof getPromoDiscountPct === 'function') ? getPromoDiscountPct(gcPromo, d) : 0);
  // A discount bigger than the site promo gets its own line on the card; the
  // homepage "Special deals" row (gcShowDealPrice) also prices the card at it.
  const gcDeal = (typeof gameSpecialDeal === 'function') ? gameSpecialDeal(game, gcPromo) : null;
  const gcShowDealPrice = typeof dealPrice !== 'undefined' && dealPrice && gcDeal;`);
rep(GC, `        <% } else if (gcStartPrice) { %>
        <div class="gc2-price">from <b>₱<%= gcStartPrice %></b><% if (gcStartWas) { %><s class="gc2-price-was">₱<%= gcStartWas %></s><% } %></div>`,
`        <% } else if (gcShowDealPrice) { %>
        <% const gcDealBase = Math.min(...[game['nt_price_' + gcDeal.days + 'd'], hasTrophy ? game['tr_price_' + gcDeal.days + 'd'] : 0].filter(p => p > 0)); %>
        <div class="gc2-price"><%= gcDeal.days === 30 ? 'Monthly' : 'Weekly' %> <b>₱<%= gcFinal(gcDealBase, gcDeal.days) %></b><s class="gc2-price-was">₱<%= gcDealBase %></s></div>
        <% } else if (gcStartPrice) { %>
        <div class="gc2-price">from <b>₱<%= gcStartPrice %></b><% if (gcStartWas) { %><s class="gc2-price-was">₱<%= gcStartWas %></s><% } %></div>`);
rep(GC, `        <% if (!gcBundle && gcBuyFrom) { %>`,
`        <% if (gcDeal) { %>
        <div class="gc2-deal">🔥 <%= gcDeal.pct %>% OFF · <%= gcDeal.days === 30 ? 'Monthly' : 'Weekly' %></div>
        <% } %>
        <% if (!gcBundle && gcBuyFrom) { %>`);

// ── Browse: category "price starts at" ──────────────────────────────────────
rep('views/browse.ejs', `          RENTAL_DURATIONS.forEach(({ days: d }) => {
            const pct = getPromoDiscountPct(promo, d);`, `          RENTAL_DURATIONS.forEach(({ days: d }) => {
            const pct = gameDiscountPct(g, d, promo);`);

// ── Homepage ────────────────────────────────────────────────────────────────
const IX = 'views/index.ejs';
rep(IX, `    const pct = getPromoDiscountPct(promo, RENTAL_DURATIONS[0].days);
    const base = g.nt_price_7d || g.tr_price_7d || 0;`, `    const pct = gameDiscountPct(g, RENTAL_DURATIONS[0].days, promo);
    const base = g.nt_price_7d || g.tr_price_7d || 0;`);
rep(IX, `      RENTAL_DURATIONS.forEach(({ days: d }) => {
        const pct = getPromoDiscountPct(promo, d);`, `      RENTAL_DURATIONS.forEach(({ days: d }) => {
        const pct = gameDiscountPct(g, d, promo);`);
rep(IX, `  const spotPct = getPromoDiscountPct(promo, RENTAL_DURATIONS[0].days);`,
  `  const spotPct = gameDiscountPct(spotGame, RENTAL_DURATIONS[0].days, promo);`);
rep(IX, `<!-- UPCOMING GAMES (COMING SOON) -->`, `<!-- SPECIAL DEALS — games whose own discount beats the site promo
     (Admin → Promo & pricing → Game discounts). Hidden when there are none. -->
<% if (typeof specialDeals !== 'undefined' && specialDeals.length) { %>
<div class="section" id="specialDealsSection">
  <h2 class="section-title">🔥 Special deals</h2>
  <div class="upcoming-slider-wrap">
    <button class="slider-arrow slider-arrow-left" onclick="slideSection('dealsSlider',-1)" aria-label="Previous">&#8249;</button>
    <div class="upcoming-slider" id="dealsSlider">
      <% specialDeals.forEach(game => { %><div class="slider-card-wrap" style="min-width:200px;max-width:200px;flex-shrink:0;scroll-snap-align:start;"><%- include('partials/game-card', { game, showPriceStart: true, dealPrice: true }) %></div><% }) %>
    </div>
    <button class="slider-arrow slider-arrow-right" onclick="slideSection('dealsSlider',1)" aria-label="Next">&#8250;</button>
  </div>
</div>
<% } %>

<!-- UPCOMING GAMES (COMING SOON) -->`);

// ── Swap box on the customer edit page ───────────────────────────────────────
const EC = 'views/edit-customer.ejs';
rep(EC, `                data-buynt="<%= g.buy_nt_price || 0 %>" data-buytr="<%= g.buy_tr_price || 0 %>"`,
`                data-buynt="<%= g.buy_nt_price || 0 %>" data-buytr="<%= g.buy_tr_price || 0 %>"
                <% if (typeof gameDiscountPct === 'function') { %>data-pct7="<%= gameDiscountPct(g, 7, settings.promo) %>" data-pct30="<%= gameDiscountPct(g, 30, settings.promo) %>"<% } %>`);
rep(EC, `    const raw = parseFloat(opt.dataset[usingType + days]) || 0;
    if (raw > 0) {
      const pct = CUST_PROMO.enabled ? (CUST_PROMO.discounts[days] || 0) : 0;`,
`    const raw = parseFloat(opt.dataset[usingType + days]) || 0;
    if (raw > 0) {
      // The game's own discount (data-pct7 / data-pct30) when the page carries it,
      // else the site promo — the same number the server records.
      const own = opt.dataset['pct' + days];
      const pct = own !== undefined && own !== '' ? (Number(own) || 0) : (CUST_PROMO.enabled ? (CUST_PROMO.discounts[days] || 0) : 0);`);

// ── Card style ──────────────────────────────────────────────────────────────
rep('public/css/style.css', `.gc2-price b { color: #fff; font-size: 0.92rem; font-weight: 800; }
`, `.gc2-price b { color: #fff; font-size: 0.92rem; font-weight: 800; }
/* A game's own discount beating the site promo (lib/game-discount.js specialDeal). */
.gc2-deal { font-size: 0.66rem; font-weight: 800; color: #4ade80; }
`);

// ── Homepage route: the deals list ──────────────────────────────────────────
rep('server.js', `  res.render('index', Object.assign({ featured, games: all,`,
`  // Games whose own discount beats the site promo, biggest first (lib/game-discount.js).
  const specialDeals = all
    .map(g => ({ g, deal: gameDiscount.specialDeal(g, s.promo) }))
    .filter(x => x.deal)
    .sort((a, b) => b.deal.pct - a.deal.pct || a.g.title.localeCompare(b.g.title))
    .slice(0, 12)
    .map(x => x.g);
  res.render('index', Object.assign({ featured, specialDeals, games: all,`);
console.log('edited');

// Phones lay the homepage out by CSS order, not DOM order: give the deals row
// its slot right after New Releases (15), before Coming Soon (20).
rep('public/css/style.css', `  .home-page #newReleasesSection { order: 15; }
`, `  .home-page #newReleasesSection { order: 15; }
  .home-page #specialDealsSection { order: 17; }
`);
console.log('edited order');
````

Run: `node .superpowers/tmp-edits/edit-gd-views.js` → `edited` then `edited order`.
Then: `node --check server.js && file views/game-detail.ejs views/partials/game-card.ejs views/browse.ejs views/index.ejs views/edit-customer.ejs public/css/style.css` → line endings unchanged.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-game-discount-pricing.js` → `11 assertions passed`.
Run: `node scripts/test-game-detail-messenger.js && node scripts/test-extend-on-edit-customer.js && node scripts/test-swap-charge-routes.js && node scripts/test-rent-pricing.js && node scripts/test-quick-add-form.js && node scripts/test-home-search.js` → all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/test-game-discount-pricing.js server.js views/game-detail.ejs views/partials/game-card.ejs views/browse.ejs views/index.ejs views/edit-customer.ejs public/css/style.css
git commit -m "Per-game discounts apply wherever a game's rental is priced; homepage Special deals row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Admin "Game discounts" table, save route, Games list tag

**Files:**
- Create: `scripts/test-game-discount-admin.js`
- Modify: `server.js`, `views/admin.ejs`, `views/partials/admin/settings.ejs`, `lib/games-view.js`, `views/partials/admin/games/all-games.ejs`, `public/css/style.css` — via the edit script

**Interfaces:**
- Consumes: Task 1's `ownPct`, `hasOwnDiscount`, `cleanInput`; Task 2's `gameDiscount` require in `server.js` and the `.gc2-deal` CSS rule (anchor).
- Produces: `res.locals.gameDiscountRows` (`[{ id, title, d7, d30, own, base30 }]`, A–Z; `''` = site promo); `POST /admin/promo/game-discounts` (requireAuth; fields `d7_<id>` / `d30_<id>`; games absent from the form untouched; both empty → `discounts: null`; redirects `/admin?tab=settings&msg=game_discounts_saved`); toast `game_discounts_saved`; `#sec-game-discounts` card with `#gdtSearch`, `#gdtOwn`; `lib/games-view.js` row field `discountTag` (e.g. `"no discount weekly · 15% monthly"`).

- [ ] **Step 1: Write the test**

Create `scripts/test-game-discount-admin.js` (the table, the save route, the Games list tag, the homepage row disappearing when nothing beats the site promo, and a game's own % still working after the site promo is switched off through the existing `POST /admin/promo`):

````js
// Run: node scripts/test-game-discount-admin.js
//
// Admin → Settings → Game discounts: the table, its save route and the Games
// list tag, the homepage "Special deals" row disappearing once no game beats
// the site promo, and a game's own % surviving the site promo being switched off.
// Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory
// sessions, a made-up admin password); the project's games.json, the database
// and the real admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4613;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'game-discount-admin-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', cover_image: '/uploads/' + id + '.png',
  nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 2, trophy_slots: 2
}, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 } },
  games: [
    game(1, 'Zzyzx Deal', { discounts: { 7: null, 30: 20 } }),
    game(2, 'Zzyzx Plain'),
    game(3, 'Zzyzx Both', { discounts: { 7: 0, 30: 15 } })
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const readDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const gameById = id => readDb().games.find(g => g.id === id);

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

  console.log('\naccess');
  await okAsync('saving needs the admin login', async () => {
    const r = await call('POST', '/admin/promo/game-discounts', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: form({ d30_2: '50' }) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
    assert.strictEqual(gameById(2).discounts, undefined);
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in to the throwaway instance');
  const post = o => call('POST', '/admin/promo/game-discounts', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o) });

  console.log('\nthe table');
  await okAsync('lists every game A–Z with its own values; empty boxes for the site promo', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('id="sec-game-discounts"') && r.body.includes('href="#sec-game-discounts"'));
    assert.ok(r.body.includes('Site promo: Weekly 0% · Monthly 10% (on).'));
    const both = r.body.indexOf('data-title="zzyzx both"');
    const deal = r.body.indexOf('data-title="zzyzx deal"');
    const plain = r.body.indexOf('data-title="zzyzx plain"');
    assert.ok(both > 0 && deal > both && plain > deal, 'A–Z');
    assert.ok(/name="d30_1" value="20"/.test(r.body));
    assert.ok(/name="d7_1" value=""/.test(r.body));
    assert.ok(/name="d7_3" value="0"/.test(r.body) && /name="d30_3" value="15"/.test(r.body));
    assert.ok(/name="d30_2" value=""/.test(r.body));
    assert.ok(/data-title="zzyzx deal" data-own="1"/.test(r.body) && /data-title="zzyzx plain" data-own="0"/.test(r.body));
    assert.ok(/data-base="799" data-site="10"/.test(r.body), 'monthly price preview inputs');
  });
  await okAsync('the Games list tags games with their own %', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes('<span class="gm-tag gm-tag-discount">% 20% monthly</span>'));
    assert.ok(r.body.includes('<span class="gm-tag gm-tag-discount">% no discount weekly · 15% monthly</span>'));
  });

  console.log('\nsaving');
  await okAsync('sets, clears and clamps; junk becomes "site promo"; a fully empty game is cleared', async () => {
    const r = await post({ d7_1: '', d30_1: '25', d7_2: 'abc', d30_2: '150', d7_3: '', d30_3: '' });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.endsWith('msg=game_discounts_saved'));
    assert.deepStrictEqual(gameById(1).discounts, { 7: null, 30: 25 });
    assert.deepStrictEqual(gameById(2).discounts, { 7: null, 30: 100 });
    assert.strictEqual(gameById(3).discounts, null);
  });
  await okAsync('games not on the submitted form are left alone', async () => {
    await post({ d30_1: '30' });
    assert.deepStrictEqual(gameById(1).discounts, { 7: null, 30: 30 });
    assert.deepStrictEqual(gameById(2).discounts, { 7: null, 30: 100 }, 'untouched');
  });
  await okAsync('the toast is wired to the Settings tab', async () => {
    const r = await call('GET', '/admin?tab=settings&msg=game_discounts_saved', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes("game_discounts_saved:'✅ Game discounts saved'"));
    assert.ok(r.body.includes("game_discounts_saved:'settings'"));
  });

  console.log('\nhomepage row');
  await okAsync('shows while a game beats the site promo, and disappears when none does', async () => {
    assert.ok((await call('GET', '/')).body.includes('id="specialDealsSection"'));
    await post({ d7_1: '', d30_1: '', d7_2: '', d30_2: '10', d7_3: '', d30_3: '' });
    const r = await call('GET', '/');
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body.includes('id="specialDealsSection"'), 'equal to the site promo is not a deal');
  });

  console.log('\nsite promo off');
  await okAsync("a game's own % keeps working when the site promo is switched off", async () => {
    // Zzyzx Plain still has its own 10% Monthly from the step above; Zzyzx Deal follows the site promo.
    const r = await call('POST', '/admin/promo', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form({ discount_7: '0', discount_30: '10', deposit: '100' }) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(readDb().site_settings.promo.enabled, false, 'site promo off');
    assert.ok(/discounts: \{ 7: 0, 30: 10 \}/.test((await call('GET', '/game/zzyzx-plain')).body), 'own 10% still applies');
    assert.ok(/discounts: \{ 7: 0, 30: 0 \}/.test((await call('GET', '/game/zzyzx-deal')).body), 'no own % → full price');
    const home = (await call('GET', '/')).body;
    const start = home.indexOf('id="specialDealsSection"');
    assert.ok(start > 0, 'the own % now beats the (off) site promo → a deal');
    assert.ok(home.slice(start, home.indexOf('<!-- UPCOMING GAMES', start)).includes('/game/zzyzx-plain'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-game-discount-admin.js` → FAIL at "saving needs the admin login": `404 !== 302` (the route does not exist yet, so Express answers 404).

- [ ] **Step 3: Apply the admin edits**

Create `.superpowers/tmp-edits/edit-gd-admin.js` (`rep.js` from Task 2 is already there):

````js
// Per-game discounts — admin table, save route, Games list tag (run from the repo root).
const rep = require('./rep');

// ── server.js: the table's rows, and the save route ──────────────────────────
rep('server.js', "  res.locals.psnLastRun = db.get('psn_last_run').value() || null;\n",
`  res.locals.psnLastRun = db.get('psn_last_run').value() || null;
  // Settings → Game discounts table: every game with its own Weekly/Monthly %
  // ('' = follows the site promo) and the monthly base price the preview uses.
  res.locals.gameDiscountRows = getGames().map(resolveGamePrices).map(g => ({
    id: g.id,
    title: g.title,
    d7: gameDiscount.ownPct(g, 7) === null ? '' : gameDiscount.ownPct(g, 7),
    d30: gameDiscount.ownPct(g, 30) === null ? '' : gameDiscount.ownPct(g, 30),
    own: gameDiscount.hasOwnDiscount(g, 7) || gameDiscount.hasOwnDiscount(g, 30),
    base30: g.nt_price_30d || g.tr_price_30d || 0
  })).sort((a, b) => a.title.localeCompare(b.title));
`);

rep('server.js', "// Takes back the extra a game swap charged (Customers tab,",
`// Settings → Game discounts: each game's own Weekly / Monthly % (lib/game-discount.js).
// An empty box means "follow the site promo"; a game with both boxes empty has
// its discounts cleared. Games not on the submitted form are left alone. One
// write for the whole table rather than one per game.
app.post('/admin/promo/game-discounts', requireAuth, (req, res) => {
  const b = req.body || {};
  let changed = 0;
  (db.get('games').value() || []).forEach(g => {
    const k7 = 'd7_' + g.id, k30 = 'd30_' + g.id;
    if (!(k7 in b) && !(k30 in b)) return;
    const d7 = gameDiscount.cleanInput(b[k7]);
    const d30 = gameDiscount.cleanInput(b[k30]);
    const next = (d7 === null && d30 === null) ? null : { 7: d7, 30: d30 };
    if (JSON.stringify(next) !== JSON.stringify(g.discounts || null)) { g.discounts = next; changed++; }
  });
  if (changed) db.write();
  res.redirect('/admin?tab=settings&msg=game_discounts_saved');
});

// Takes back the extra a game swap charged (Customers tab,`);

// ── admin.ejs: toast ─────────────────────────────────────────────────────────
rep('views/admin.ejs', "    settings_saved:'settings', promo_saved:'settings',",
  "    settings_saved:'settings', promo_saved:'settings', game_discounts_saved:'settings',");
rep('views/admin.ejs', "const messages = { swap_waived:", "const messages = { game_discounts_saved:'✅ Game discounts saved', swap_waived:");

// ── settings.ejs: jump link and the table ────────────────────────────────────
const S = 'views/partials/admin/settings.ejs';
rep(S, `      <a href="#sec-promo">Promo & pricing</a>
`, `      <a href="#sec-promo">Promo & pricing</a>
      <a href="#sec-game-discounts">Game discounts</a>
`);
rep(S, `    </div><!-- /accordion promo -->
`, `    </div><!-- /accordion promo -->

    <!-- GAME DISCOUNTS — each game's own Weekly / Monthly % (lib/game-discount.js) -->
    <%
      const gdtRows = typeof gameDiscountRows !== 'undefined' ? gameDiscountRows : [];
      const gdtPromo = settings.promo || {};
      const gdtSite = d => (gdtPromo.enabled && gdtPromo.discounts) ? (Number(gdtPromo.discounts[d]) || 0) : 0;
    %>
    <div class="adm-card" id="sec-game-discounts">
      <div class="adm-card-head" style="border-left:3px solid #22c55e;">
        <div class="sa-left">
          <div class="sa-icon" style="background:rgba(34,197,94,0.15);">🏷️</div>
          <div>
            <div class="sa-title">Game discounts</div>
            <div class="sa-desc">Give some games their own Weekly or Monthly %</div>
          </div>
        </div>
      </div>
      <div class="adm-card-body">
        <p class="gdt-note">Site promo: Weekly <%= gdtSite(7) %>% · Monthly <%= gdtSite(30) %>% (<%= gdtPromo.enabled ? 'on' : 'off' %>).
          Empty box = site promo · 0 = no discount. A game's own % replaces the site promo and keeps working when the site promo is off.</p>
        <div class="gdt-tools">
          <input type="search" id="gdtSearch" placeholder="Search games…" autocomplete="off">
          <label><input type="checkbox" id="gdtOwn"> Only games with their own %</label>
        </div>
        <form method="POST" action="/admin/promo/game-discounts">
          <div class="gdt-wrap">
          <table class="gdt">
            <thead><tr><th>Game</th><th>Weekly %</th><th>Monthly %</th><th>Customer pays (monthly)</th></tr></thead>
            <tbody>
            <% gdtRows.forEach(r => { %>
              <tr data-title="<%= r.title.toLowerCase() %>" data-own="<%= r.own ? '1' : '0' %>">
                <td><%= r.title %></td>
                <td><input type="number" name="d7_<%= r.id %>" value="<%= r.d7 %>" min="0" max="100" placeholder="—" class="gdt-in" aria-label="<%= r.title %> weekly %"></td>
                <td><input type="number" name="d30_<%= r.id %>" value="<%= r.d30 %>" min="0" max="100" placeholder="—" class="gdt-in gdt-in30" data-base="<%= r.base30 %>" data-site="<%= gdtSite(30) %>" aria-label="<%= r.title %> monthly %"></td>
                <td class="gdt-pay"></td>
              </tr>
            <% }) %>
            </tbody>
          </table>
          </div>
          <div class="form-actions" style="margin-top:0.75rem;">
            <button type="submit" class="btn btn-primary" style="background:#22c55e;color:#000;">Save game discounts</button>
          </div>
        </form>
      </div>
    </div>
    <script>
    (function () {
      var search = document.getElementById('gdtSearch');
      var ownOnly = document.getElementById('gdtOwn');
      if (!search || !ownOnly) return;
      var rows = Array.prototype.slice.call(document.querySelectorAll('.gdt tbody tr'));
      // What a customer pays for the monthly Non-Trophy rental: the box's % if
      // filled, else the site promo's — the same rounding the site uses.
      function price(row) {
        var box = row.querySelector('.gdt-in30');
        var base = Number(box.getAttribute('data-base')) || 0;
        var raw = box.value.trim();
        var pct = raw === '' ? Number(box.getAttribute('data-site')) || 0 : Math.min(100, Math.max(0, Math.round(Number(raw) || 0)));
        row.querySelector('.gdt-pay').textContent = base ? '₱' + (pct > 0 ? base - Math.round(base * pct / 100) : base) + (pct > 0 ? ' (' + pct + '% off)' : '') : '—';
      }
      function hasOwn(row) {
        return Array.prototype.some.call(row.querySelectorAll('.gdt-in'), function (i) { return i.value.trim() !== ''; });
      }
      function filter() {
        var q = search.value.trim().toLowerCase();
        rows.forEach(function (row) {
          var show = (!q || row.getAttribute('data-title').indexOf(q) >= 0) && (!ownOnly.checked || hasOwn(row));
          row.hidden = !show;
        });
      }
      rows.forEach(function (row) {
        price(row);
        Array.prototype.forEach.call(row.querySelectorAll('.gdt-in'), function (i) { i.addEventListener('input', function () { price(row); }); });
      });
      search.addEventListener('input', filter);
      ownOnly.addEventListener('change', filter);
    })();
    </script>
`);

// ── style.css: table ─────────────────────────────────────────────────────────
rep('public/css/style.css', `.gc2-deal { font-size: 0.66rem; font-weight: 800; color: #4ade80; }
`, `.gc2-deal { font-size: 0.66rem; font-weight: 800; color: #4ade80; }
/* Admin → Settings → Game discounts table. */
.gdt-note { font-size: 0.8rem; color: #888; margin: 0 0 0.75rem; }
.gdt-tools { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.6rem; font-size: 0.8rem; color: #aaa; }
.gdt-tools input[type=search] { flex: 1; min-width: 180px; }
.gdt-wrap { max-height: 480px; overflow-y: auto; border: 1px solid #1e1e1e; border-radius: 10px; }
.gdt { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.gdt th { position: sticky; top: 0; background: #111; text-align: left; font-size: 0.7rem; color: #777; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.5rem 0.6rem; }
.gdt td { padding: 0.35rem 0.6rem; border-top: 1px solid #1a1a1a; color: #ddd; }
.gdt tr[hidden] { display: none; }
.gdt .gdt-in { width: 70px; padding: 0.3rem 0.4rem; text-align: center; }
.gdt-pay { color: #4ade80; font-weight: 700; white-space: nowrap; }
`);

// ── Games list tag ───────────────────────────────────────────────────────────
rep('lib/games-view.js', `    const categoryName = g._category_name || '';
    const isBundle = !!g.is_bundle;`, `    const categoryName = g._category_name || '';
    const isBundle = !!g.is_bundle;
    // "20% monthly", "no discount weekly · 20% monthly" — the game's own % from
    // Settings → Game discounts (lib/game-discount.js); '' when it has none.
    const discountTag = [[7, 'weekly'], [30, 'monthly']]
      .map(([d, label]) => {
        const own = gameDiscount.ownPct(g, d);
        return own === null ? '' : (own === 0 ? 'no discount ' + label : own + '% ' + label);
      })
      .filter(Boolean).join(' · ');`);
rep('lib/games-view.js', `      categoryName,
      isBundle,`, `      categoryName,
      isBundle,
      discountTag,`);
rep('lib/games-view.js', `const computeAvailability = require('./availability');
`, `const gameDiscount = require('./game-discount');
const computeAvailability = require('./availability');
`);
rep('views/partials/admin/games/all-games.ejs', `        <% if (r.categoryName || r.isBundle) { %>
        <div class="gm-tags">
          <% if (r.categoryName) { %><span class="gm-tag">🏷️ <%= r.categoryName %></span><% } %>`, `        <% if (r.categoryName || r.isBundle || r.discountTag) { %>
        <div class="gm-tags">
          <% if (r.categoryName) { %><span class="gm-tag">🏷️ <%= r.categoryName %></span><% } %>
          <% if (r.discountTag) { %><span class="gm-tag gm-tag-discount">% <%= r.discountTag %></span><% } %>`);
rep('public/css/style.css', `.gm-tag-bundle { color: #d9a7f0; background: #2a0a3a; border-color: #5b2a7a; }
`, `.gm-tag-bundle { color: #d9a7f0; background: #2a0a3a; border-color: #5b2a7a; }
.gm-tag-discount { color: #fbbf24; background: #2a1f05; border-color: #6b4f10; }
`);
console.log('edited');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-gd-admin.js` → `edited`.
Then: `node --check server.js && file server.js views/partials/admin/settings.ejs public/css/style.css lib/games-view.js` → line endings unchanged.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-game-discount-admin.js` → `8 assertions passed`.
Run: `node scripts/test-games-view.js && node scripts/test-games-template.js && node scripts/test-admin-visitors-render.js && node scripts/test-game-discount-pricing.js` → all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-game-discount-admin.js server.js views/admin.ejs views/partials/admin/settings.ejs lib/games-view.js views/partials/admin/games/all-games.ejs public/css/style.css
git commit -m "Admin: Game discounts table in Promo settings; Games list shows each game's own %

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Full regression and cleanup

**Files:** none changed.

- [ ] **Step 1: Run every test file and list failures**

```bash
fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail of $(ls scripts/test-*.js | wc -l)"
```
Expected: only `FAIL scripts/test-requests-page.js`, `failed: 1`.

- [ ] **Step 2: Remove the scratch scripts and check the tree**

```bash
rm -rf .superpowers/tmp-edits && git status --short
```
Expected: no output except possibly the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.

Do not push; tell the owner it is ready: Admin → Settings → Game discounts, type a % next to the games, Save; empty a box to go back to the site promo.
