# PS Plus Deluxe rent page, laid out like a game page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/ps-plus/rent` looks and works like a game page. It gets the hero, the framed booking card, the type pills with slot status, "How setup works", the Messenger-first button with its preview, the "Or order here on the website" fold and the phone sticky bar. It keeps PS Plus's own checkout, prices, waiting line and two account types.

**Architecture:**
- **View:** `views/psplus-rent.ejs` is rebuilt from `views/game-detail.ejs`'s markup, classes and element ids.
- **Script:** the page runs the game page's own `public/js/game-detail.js`, unchanged, through the same inline globals (`PRICES`, `AVAIL`, `NEXT_DAYS`, `gameTitle`…), filled with PS Plus values.
- **Route:** `GET /ps-plus/rent` adds `nextDays`, the days until each type frees up, from the PS Plus catalogue row's linked accounts.
- **Retired:** `public/js/psplus-rent.js`, its extraction test, and the old page's `.psr-types` styles.

**Tech Stack:** Express + EJS templates, plain browser JS (no build step), plain CSS. Tests are `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-26-psplus-rent-page-like-game-page-design.md` (amended after this plan's dry run).

**How this plan was checked.** Every file in this plan was dry-run in a scratch copy of the current `main`:
- Each new or changed test fails first and then passes.
- The full suite stays green apart from `scripts/test-upcoming-psn-page-public.js`, which also fails before this work.

A browser check ran on a throwaway instance (the Task 2 launcher), with PS Plus set to Trophy full for 5 more days and one Non-Trophy slot open.
- **1280px:**
  - The cover column (380px) sits beside the booking card (500px).
  - The two pills sit side by side at 225px each, with "🏆 Available in 6 days" under Trophy.
  - Non-Trophy is picked first, and the preview reads "Game: PS Plus Deluxe … Account Type: Non-Trophy Account".
  - Weekly then "Or order here on the website" shows "🎮 Rent now — ₱349". The form posts to `/order/create-psplus`.
  - Picking Trophy hides the Messenger button and shows the get-in-line card (`game_id` `psplus`), with " · Trophy frees up in about 6 days".
- **375px:**
  - The page is 375px wide, so nothing scrolls sideways.
  - The order is poster, About, then the card, the same as a game page.
  - The sticky bar reads "From ₱349 | 💬 Message us".
- **Sold out:**
  - The page shows the "Sold Out" badge and the bar "Sold out — all slots rented".
  - There is one get-in-line card for `psplus`.
  - The sticky bar reads "Fully booked | Get in line".
- **Errors:** none from the page's scripts.

## Global Constraints

- Work directly on `main` and do not switch branches. **Push only when the owner says "push".**
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Game pages are not touched.** `views/game-detail.ejs` and `public/js/game-detail.js` must not change; the PS Plus page reuses them as they are.
- **What PS Plus keeps:**
  - **Checkout:** the form posts to `/order/create-psplus` with `account_type`, `days` and `fb_name` and no `game_id`.
  - **Prices:** from `getPsplusPrices()`.
  - **Slot counts:** from the PS Plus catalogue row's `non_trophy_slots` / `trophy_slots` (else `getPsplusSlots()`), as now.
  - **Waiting line:** `game_id` `'psplus'`.
  - **Account types:** two only, `tr` = "Trophy / PS4 Primary" (adds the ₱100 deposit) and `nt` = "Non-Trophy".
  - **Rent only:** no Buy toggle and no separate PS4 Primary pill.
- **Copy, verbatim:**
  - Hero chips: `SUBSCRIPTION`, `DELUXE`, `PS4/PS5`. Title: `PS Plus Deluxe`.
  - Status badge: `Available`, `Last Slot` or `Sold Out`.
  - Bar text: `Sold out — all slots rented` / `Only 1 slot left` / `<n> slots available`.
  - Left column headings: `About this subscription` and `Info`. Info rows:
    - `Platform` · `PS4 / PS5`
    - `Game swaps` · `Unlimited · 2-day cooldown`
    - `Games` · `Hundreds, including monthly titles`
    - `Catalogue` · `See all games →` (`/ps-plus`)
  - Pills: `Trophy / PS4 Primary`, `Non-Trophy`.
  - Messenger button: tap source `data-track-source="game"`, one of the sources `lib/tracking.js` accepts.
- **Line endings:**
  - `server.js` is CRLF + UTF-8 BOM.
  - These files are CRLF: `views/psplus-rent.ejs`, `public/css/style.css` (a test checks every line), `scripts/test-game-detail-messenger.js`.
  - These files are LF: `scripts/test-psplus-rent-links.js` and the new files.
  - The edit scripts (via `.superpowers/tmp-edits/rep.js`) keep each file's endings and BOM.
  - Git stores LF blobs (`core.autocrlf=true`).
- **Test data:** tests use temp `DATA_DIR`s, a blank `MONGODB_URI` and made-up games. Never touch the project's `games.json` or a database.
- **Known unrelated failure:** `scripts/test-upcoming-psn-page-public.js`. Report it; do not fix it.
- **Edit scripts:** they live in `.superpowers/tmp-edits/` (git-ignored). Never commit them. Task 2 removes the folder.
- **Committing:** always `git add` explicit paths. The untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.

## Files

| File | Task | Change |
|---|---|---|
| `views/psplus-rent.ejs` | 1 | Rebuilt with the game page's markup and ids |
| `server.js` | 1 | `GET /ps-plus/rent` passes `nextDays` |
| `public/css/style.css` | 1 | The dead `.psr-types` block removed |
| `public/js/psplus-rent.js` | 1 | Deleted; `game-detail.js` runs the page |
| `scripts/test-js-extraction-psplus-rent.js` | 1 | Deleted with it |
| `scripts/test-psplus-rent-page.js` (new) | 1 | Three throwaway servers + `game-detail.js` in a vm |
| `scripts/test-game-detail-messenger.js` | 1 | The PS Plus case expects the card layout |
| `scripts/test-psplus-rent-links.js` | 1 | The rent-page case expects the pills |

---

### Task 1: Rebuild `/ps-plus/rent` like a game page

**Files:**
- Create:
  - `scripts/test-psplus-rent-page.js`
  - `.superpowers/tmp-edits/rep.js`
  - `.superpowers/tmp-edits/edit-psplus-tests.js`
  - `.superpowers/tmp-edits/psplus-rent.new.ejs`
  - `.superpowers/tmp-edits/edit-psplus-page.js`
- Modify (edit scripts): `scripts/test-game-detail-messenger.js`, `scripts/test-psplus-rent-links.js`, `server.js`, `public/css/style.css`.
- Replace (edit script): `views/psplus-rent.ejs`, with the text of `psplus-rent.new.ejs`; the CRLF endings are kept.
- Delete (edit script): `public/js/psplus-rent.js`, `scripts/test-js-extraction-psplus-rent.js`.

**Interfaces:**
- Consumes (all already present):
  - In `server.js`: `computeAvailability(game, summary)` → `{ trNext, ntNext, … }` (`lib/availability.js`) and `gameAccountSummary(gameId)`.
  - App locals the view uses: `gameDiscountPct(game, days, promo)`, `rentPriceHtml(game, type, days, promo)`, `RENTAL_DURATIONS`, `assetV`.
  - The partials `head`, `announcement`, `nav`, `swap-line`, `pay-note`, `queue-line` (with `hideStrip`) and `noslot-options` (with `variant: 'card'`), and `footer`.
  - `public/js/messenger-text.js` and `public/js/game-detail.js`. The latter reads the globals `RENTAL_DURATIONS`, `PRICES`, `BUY_PRICES`, `PROMO`, `AVAIL`, `ALL_UNAVAIL`, `NEXT_DAYS`, `gameTitle` and `gdSlideCount`, and the element ids the view copies from `game-detail.ejs`.
- Produces:
  - The view local `nextDays` (`{ tr, nt }`, numbers or `null`).
  - The rebuilt page.

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-psplus-rent-page.js`:

````js
// Run: node scripts/test-psplus-rent-page.js
//
// The PS Plus Deluxe rent page (/ps-plus/rent) is laid out like a game page:
// the same hero, booking card, type pills, setup guide, Messenger-first button,
// "Or order here on the website" fold and phone sticky bar, run by the game
// page's own script. What stays its own: the checkout (/order/create-psplus),
// its prices, its waiting line (game_id 'psplus') and two account types.
//  1. Starts three throwaway servers (temp DATA_DIR, blank MONGODB_URI, made-up
//     games): slots open, one slot left, and sold out. Checks the markup.
//  2. Runs the real public/js/game-detail.js in a vm with the globals the
//     rendered page defines, and checks the message preview and order button.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const psplusPrices = { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 };
const gamePrice = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };

// A local YYYY-MM-DD `n` days from today, and the "days until" the site works
// out for it (lib/availability.js daysUntil).
function localDate(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysUntil(s) { return Math.max(0, Math.ceil((new Date(s + 'T23:59:59') - new Date()) / 86400000)); }
const trEnd = localDate(5);

function fixture(nt, tr, accounts) {
  return {
    site_settings: { promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 } },
    games: [
      Object.assign({ id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5', genre: '', cover_image: '', renters: 9, non_trophy_slots: nt, trophy_slots: tr }, gamePrice),
      Object.assign({ id: 5, title: 'Zzyzx Racer', platform: 'PS5', genre: 'Racing', cover_image: '', renters: 2, non_trophy_slots: 1, trophy_slots: 1 }, gamePrice)
    ],
    psplus_prices: psplusPrices,
    accounts: accounts || []
  };
}
// The one-slot-left case links an account whose Trophy slot is rented until
// trEnd, so the full Trophy pill can say when it frees up.
const rentedTrophy = [{
  id: 1, label: 'Zzyzx PS Plus account', game_ids: [4],
  slots: {
    trophy: { enabled: true, status: 'rented', renter_id: null, renter_name: 'Zzyzx Renter', start: localDate(-25), end: trEnd },
    non_trophy: { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' },
    ps4_primary: { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' }
  }
}];
const SERVERS = {
  open: { port: 4661, data: fixture(1, 1) },
  last: { port: 4662, data: fixture(1, 0, rentedTrophy) },
  sold: { port: 4663, data: fixture(0, 0) }
};

const children = [];
const dirs = [];
function cleanup() {
  children.forEach(c => { try { c.kill(); } catch (e) { /* already gone */ } });
  dirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } });
}

function get(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port, path: p, timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Safari' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
  });
}

async function start(name) {
  const s = SERVERS[name];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psplus-rent-page-' + name + '-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'games.json'), JSON.stringify(s.data));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(s.port), DATA_DIR: dir, MONGODB_URI: '' }),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let err = '';
  child.stderr.on('data', c => { err += c; });
  children.push(child);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { await get(s.port, '/ps-plus/rent'); return; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  throw new Error(name + ' server did not come up within 20s:\n' + err);
}

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

// ── the real game-detail.js in a vm, with the page's own inline globals ──
function inlineScript(html, marker) {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) if (m[1].includes(marker)) return m[1];
  throw new Error('no inline script with ' + marker);
}
function loadPage(html) {
  const els = {};
  const mk = id => (els[id] = {
    id, href: '', textContent: '', innerHTML: '', hidden: false, value: '', disabled: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(k, v) { this.attrs = Object.assign(this.attrs || {}, { [k]: v }); },
    scrollIntoView() {}, focus() {}, click() {}
  });
  ['ctaMsgPrimary', 'ctaMsgMain', 'ctaMsgSub', 'ctaMsgPreview', 'ctaMsgWrap', 'gdOrderBlock', 'orderToggle',
    'gdSbKicker', 'gdSbAmount', 'gdSbBtn', 'ctaBtn', 'ctaSub', 'reserveSection', 'gdOrderForm', 'totalBox',
    'totalRows', 'totalFinal', 'totalRefund', 'totalHint', 'orderType', 'orderDays', 'phAmount', 'phKicker',
    'phRider', 'phWas', 'phSave', 'price-7', 'price-30', 'lineCard', 'lineAsk', 'lineSoon', 'resType', 'resDays'].forEach(mk);
  const amount = html.match(/id="phAmount" data-default-amount="(\d+)"/);
  els.phAmount.dataset = { defaultAmount: amount ? amount[1] : '0', defaultBuyAmount: '0' };
  els.phKicker.dataset = { defaultKicker: 'From' };
  const ctx = {
    console, window: { addEventListener() {}, location: { search: '' } },
    document: { getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    PHMessengerText: require('../public/js/messenger-text.js')
  };
  vm.createContext(ctx);
  vm.runInContext(inlineScript(html, 'const RENTAL_DURATIONS'), ctx);
  vm.runInContext(inlineScript(html, 'const PRICES'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'game-detail.js'), 'utf8'), ctx);
  const dur = d => ({ dataset: { days: String(d) }, classList: { add() {}, remove() {} } });
  return { els, run: code => vm.runInContext(code, ctx), pick: (type, days) => {
    vm.runInContext('onTypeChange({ value: ' + JSON.stringify(type) + ' })', ctx);
    if (days) { ctx.__dur = dur(days); vm.runInContext('onDurChange(__dur)', ctx); }
  } };
}

async function main() {
  await Promise.all(Object.keys(SERVERS).map(start));
  const open = await get(SERVERS.open.port, '/ps-plus/rent');
  const last = await get(SERVERS.last.port, '/ps-plus/rent');
  const sold = await get(SERVERS.sold.port, '/ps-plus/rent');

  console.log('\nrendered page, slots open');
  await okAsync('the game page hero: status badge, chips, title and slot bar', async () => {
    assert.strictEqual(open.status, 200);
    assert.ok(open.body.includes('<body class="gd-page-booking-v2">'));
    assert.ok(open.body.includes('/css/game-psn.css?v='));
    assert.ok(open.body.includes('<div class="usd-hero gdh-hero">'));
    assert.ok(open.body.includes('<span class="usd-badge usd-badge-ok">Available</span>'));
    ['SUBSCRIPTION', 'DELUXE', 'PS4/PS5'].forEach(c => assert.ok(open.body.includes('<span class="usd-plat-chip">' + c + '</span>'), c));
    assert.ok(open.body.includes('<h1 class="usd-title">PS Plus Deluxe</h1>'));
    assert.ok(open.body.includes('<div class="gdh-bar-text">2 slots available</div>'));
  });
  await okAsync('the left column: About this subscription and an Info table that links to the catalogue', async () => {
    assert.ok(open.body.includes('<section class="gpa" id="gpAbout">'));
    assert.ok(open.body.includes('<h2 class="gpa-h">About this subscription</h2>'));
    assert.ok(open.body.includes('Access hundreds of games including monthly titles. Trophy or Non-Trophy — your choice.'));
    assert.ok(open.body.includes('<table class="gpa-info">'));
    assert.ok(open.body.includes('<tr><td>Platform</td><td>PS4 / PS5</td></tr>'));
    assert.ok(open.body.includes('<tr><td>Game swaps</td><td>Unlimited · 2-day cooldown</td></tr>'));
    assert.ok(open.body.includes('<tr><td>Catalogue</td><td><a href="/ps-plus">See all games →</a></td></tr>'));
  });
  await okAsync('the booking card: rent only, no Rent / Buy toggle or buy panel, "From" the cheapest weekly', async () => {
    assert.ok(open.body.includes('<div class="gdh-card">'));
    assert.ok(open.body.includes('<div id="rentPanel">'));
    assert.ok(!open.body.includes('id="toggleRent"') && !open.body.includes('id="toggleBuy"') && !open.body.includes('id="buyPanel"'));
    assert.ok(open.body.includes('<span id="phAmount" data-default-amount="349" data-default-buy-amount="0">₱349</span>'));
  });
  await okAsync('two pills with hidden radios and their slots left', async () => {
    assert.strictEqual((open.body.match(/<label class="gd-type-card gd-type-pill" id="label-(tr|nt)">/g) || []).length, 2);
    assert.strictEqual((open.body.match(/<input type="radio" name="rentalType" value="(tr|nt)" class="gd-type-radio" onchange="onTypeChange\(this\)">/g) || []).length, 2);
    assert.ok(open.body.includes('<span class="gd-type-name">Trophy / PS4 Primary</span>'));
    assert.ok(open.body.includes('<span class="gd-type-name">Non-Trophy</span>'));
    assert.strictEqual((open.body.match(/<span class="gd-slots-left">1 slot left<\/span>/g) || []).length, 2);
    assert.ok(!open.body.includes('value="ps4"'), 'PS4 Primary stays part of Trophy');
    assert.ok(!open.body.includes('psr-types'));
  });
  await okAsync('How setup works, then the duration cards with PS Plus prices and the promo badge', async () => {
    assert.ok(open.body.includes('id="setupToggle"') && open.body.includes('id="setup-tr"') && open.body.includes('id="setup-nt"'));
    assert.ok(open.body.includes('Includes PS4 Primary access.'));
    assert.ok(open.body.includes('<span class="gd-dur-price" id="price-7">₱349</span>'));
    assert.ok(/<span class="gd-dur-price" id="price-30"><span class="gd-dur-price-orig">₱699<\/span> ₱629<\/span>/.test(open.body), 'monthly shows the 10% promo');
    assert.ok(open.body.includes('<span class="gd-dur-promo">10% OFF</span>'));
  });
  await okAsync('the Messenger button and its preview, then the website order folded away', async () => {
    assert.ok(open.body.includes('<a href="http://m.me/PlaystationHub00" target="_blank" rel="noopener" class="gd-msg-primary" id="ctaMsgPrimary" data-track-source="game">'));
    assert.ok(open.body.includes('💬 Message us about this game'));
    assert.ok(open.body.includes('YOUR MESSAGE WILL SAY') && open.body.includes('id="ctaMsgPreview"'));
    assert.ok(open.body.includes('id="orderToggle"') && open.body.includes('Or order here on the website'));
    assert.ok(/<div id="gdOrderBlock" hidden>/.test(open.body));
    assert.ok(open.body.includes('<form method="POST" action="/order/create-psplus" class="gd-order-form" id="gdOrderForm">'));
    assert.ok(open.body.includes('name="account_type" id="orderType"') && open.body.includes('name="days" id="orderDays"') && open.body.includes('name="fb_name" id="orderFbName"'));
    const form = open.body.slice(open.body.indexOf('id="gdOrderForm"'), open.body.indexOf('</form>', open.body.indexOf('id="gdOrderForm"')));
    assert.ok(!form.includes('name="game_id"'), 'no game id on the PS Plus checkout');
    assert.ok(!open.body.includes('or message us on Facebook instead') && !open.body.includes('id="ctaHint"'));
  });
  await okAsync('the per-type get-in-line card is ready for PS Plus, hidden until a full type is picked', async () => {
    assert.ok(open.body.includes('<div id="reserveSection" style="display:none;">'));
    assert.ok(open.body.includes('id="lineCard"'));
    assert.ok(open.body.includes('<input type="hidden" name="game_id" value="psplus">'));
  });
  await okAsync('the phone sticky bar, and the game page scripts in place of psplus-rent.js', async () => {
    assert.ok(open.body.includes('<div class="gd-sticky-bar" id="gdStickyBar">'));
    assert.ok(/<div class="gd-sb-amount" id="gdSbAmount">₱349<\/div>/.test(open.body));
    const a = open.body.indexOf('/js/messenger-text.js?v=');
    const b = open.body.indexOf('/js/game-detail.js?v=');
    assert.ok(a > 0 && b > a);
    assert.ok(!open.body.includes('/js/psplus-rent.js'));
    assert.ok(open.body.includes("const gameTitle = 'PS Plus Deluxe';"));
    assert.ok(open.body.includes('const AVAIL = { nt: true, tr: true, ps4: false };'));
  });

  console.log('\nrendered page, one slot left (Trophy full until ' + trEnd + ')');
  await okAsync('Last Slot badge, bar and banner', async () => {
    assert.strictEqual(last.status, 200);
    assert.ok(last.body.includes('<span class="usd-badge usd-badge-warn">Last Slot</span>'));
    assert.ok(last.body.includes('<div class="gdh-bar-text gdh-bar-urgent">Only 1 slot left</div>'));
    assert.ok(last.body.includes('🔥 Last Slot</div>'));
  });
  await okAsync('the full Trophy pill says Full Slot and when it frees up', async () => {
    const n = daysUntil(trEnd);
    assert.ok(/id="label-tr">[\s\S]*?<span class="gd-type-status gd-status-rented">Full Slot<\/span>/.test(last.body));
    assert.ok(last.body.includes('<span class="gd-avail-soon">🏆 Available in <strong>' + n + ' days</strong></span>'));
    assert.ok(last.body.includes('const NEXT_DAYS = {"tr":' + n + ',"nt":null,"ps4":null};'));
    assert.ok(last.body.includes('const AVAIL = { nt: true, tr: false, ps4: false };'));
  });

  console.log('\nrendered page, sold out');
  await okAsync('Sold Out badge and bar; one get-in-line card for PS Plus is the main action', async () => {
    assert.strictEqual(sold.status, 200);
    assert.ok(sold.body.includes('<span class="usd-badge usd-badge-off">Sold Out</span>'));
    assert.ok(sold.body.includes('<div class="gdh-bar-text gdh-bar-urgent">Sold out — all slots rented</div>'));
    assert.strictEqual((sold.body.match(/<span class="gd-type-status gd-status-rented">Full Slot<\/span>/g) || []).length, 2);
    assert.ok(/<div id="ctaMsgWrap" hidden>/.test(sold.body));
    assert.ok(!sold.body.includes('id="orderToggle"') && !sold.body.includes('id="gdOrderForm"'));
    assert.ok(sold.body.includes('<div id="reserveSectionAll">') && sold.body.includes('id="lineCardAll"'));
    assert.ok(sold.body.includes('<input type="hidden" name="game_id" value="psplus">'));
    assert.ok(/var HIDE_STRIP = true;/.test(sold.body));
    assert.ok(/id="gdSbBtn"[^>]*>💬 Ask us<\/button>/.test(sold.body));
  });

  console.log('\ngame-detail.js on the PS Plus page');
  await okAsync('Trophy, then Weekly: the message names PS Plus Deluxe with the ₱100 deposit on top', async () => {
    const p = loadPage(open.body);
    p.pick('tr', 7);
    assert.strictEqual(p.els.ctaMsgPreview.textContent,
      'Hi! I want to RENT a game 🎮\nGame: PS Plus Deluxe\nAccount Type: Trophy Account\nDuration: 7 Days\nTotal: ₱399 + ₱100 refundable deposit');
    assert.strictEqual(p.els.ctaMsgPrimary.href, 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(p.els.ctaMsgPreview.textContent));
  });
  await okAsync('the order button enables with the total, and the form gets the picks', async () => {
    const p = loadPage(open.body);
    p.pick('tr', 7);
    assert.strictEqual(p.els.ctaBtn.disabled, false);
    assert.strictEqual(p.els.ctaBtn.textContent, '🎮 Rent now — ₱499');
    assert.strictEqual(p.els.orderType.value, 'tr');
    assert.strictEqual(p.els.orderDays.value, 7);
    assert.strictEqual(p.els.totalFinal.textContent, '₱499');
  });
  await okAsync('Non-Trophy has no deposit; Monthly carries the promo', async () => {
    const p = loadPage(open.body);
    p.pick('nt', 30);
    assert.ok(p.els.ctaMsgPreview.textContent.endsWith('\nAccount Type: Non-Trophy Account\nDuration: 30 Days\nTotal: ₱629 (incl. 10% promo discount)'), p.els.ctaMsgPreview.textContent);
    assert.strictEqual(p.els.ctaBtn.textContent, '🎮 Rent now — ₱629');
  });
  await okAsync('picking the full Trophy type on the one-slot page hands over to the get-in-line card', async () => {
    const p = loadPage(last.body);
    p.pick('tr');
    assert.strictEqual(p.els.ctaMsgWrap.hidden, true);
    assert.strictEqual(p.els.reserveSection.style.display, '');
    assert.strictEqual(p.els.orderToggle.style.display, 'none');
    assert.strictEqual(p.els.lineSoon.textContent, ' · Trophy frees up in about ' + daysUntil(trEnd) + ' days');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

Create `.superpowers/tmp-edits/rep.js`. It keeps a file's BOM and CRLF, and fails loudly on a missing or repeated anchor:

````js
// Exact-text edit helpers for this plan's edit scripts. Keep a file's UTF-8
// BOM and CRLF line endings; anchors are written with \n. Throw when an
// anchor is missing or appears more than once, so nothing is half-applied
// silently. Run edit scripts from the repo root.
const fs = require('fs');

function load(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const crlf = body.includes('\r\n');
  return { bom, crlf, text: crlf ? body.replace(/\r\n/g, '\n') : body };
}

function save(file, f, text) {
  const out = f.crlf ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(file, (f.bom ? '﻿' : '') + out);
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function once(file, text, needle) {
  const n = count(text, needle);
  if (n !== 1) throw new Error(file + ': expected 1 match, found ' + n + ' for: ' + needle.slice(0, 80));
  return text.indexOf(needle);
}

// Replaces the one occurrence of `from` with `to`.
function rep(file, from, to) {
  const f = load(file);
  once(file, f.text, from);
  save(file, f, f.text.replace(from, () => to));
}

// Replaces everything from `start` through `end` (both included) with `to`.
rep.between = function (file, start, end, to) {
  const f = load(file);
  const i = once(file, f.text, start);
  const j = f.text.indexOf(end, i + start.length);
  if (j === -1) throw new Error(file + ': end anchor not found after start: ' + end.slice(0, 80));
  save(file, f, f.text.slice(0, i) + to + f.text.slice(j + end.length));
};

// Replaces the whole of `file` with the text of the file `src`, keeping
// `file`'s own BOM and line endings.
rep.put = function (file, src) {
  const f = load(file);
  save(file, f, load(src).text);
};

module.exports = rep;
````

Create `.superpowers/tmp-edits/edit-psplus-tests.js`. The two older tests pinned the old layout; this points them at the new one:

````js
// The two older tests that pinned the PS Plus rent page's classic layout now
// expect the game page's card layout. Keeps each file's line endings.
const rep = require('./rep');

const M = 'scripts/test-game-detail-messenger.js';
rep(M,
`  await okAsync('the PS Plus rent page shares these partials and keeps its classic layout', async () => {
    const r = await get('/ps-plus/rent');
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body.includes('gd-line-card'));
    assert.ok(r.body.includes('or message us on Facebook instead') && r.body.includes('Reserve Now'));
    assert.ok(/var HIDE_STRIP = false;/.test(r.body));
  });
`,
`  await okAsync('the PS Plus rent page shares these partials in the same card layout', async () => {
    const r = await get('/ps-plus/rent');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('gd-line-card'));
    assert.ok(!r.body.includes('or message us on Facebook instead') && !r.body.includes('CHOOSE YOUR OPTION'));
    assert.ok(/var HIDE_STRIP = true;/.test(r.body));
  });
`);

const L = 'scripts/test-psplus-rent-links.js';
rep(L,
`// URL, the search index, the product feed) keep /ps-plus. The rent page's
// rental-type cards keep their own stacked look: hidden radios, padding, one
// card per line. Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI).
`,
`// URL, the search index, the product feed) keep /ps-plus. The rent page's
// rental-type cards are the game page's pills, with hidden radios. Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI).
`);
rep(L,
`  await okAsync('the rent page: stacked type cards with hidden radios and their own styles', async () => {
    const r = await get('/ps-plus/rent');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('<div class="gd-type-options psr-types" id="typeOptions">'));
    assert.strictEqual((r.body.match(/<input type="radio" name="rentalType" value="(tr|nt)" class="gd-type-radio" onchange="onTypeChange\\(this\\)">/g) || []).length, 2);
    const css = read('public/css/style.css');
    ['#typeOptions.psr-types {', '.psr-types .gd-type-card {', '.psr-types .gd-type-header {', '.psr-types .gd-type-card.gd-type-selected {']
      .forEach(s => assert.ok(css.includes(s), s));
  });
`,
`  await okAsync('the rent page: the game page type pills with hidden radios; the old stacked-card styles are gone', async () => {
    const r = await get('/ps-plus/rent');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('<div class="gd-type-options" id="typeOptions">'));
    assert.strictEqual((r.body.match(/<input type="radio" name="rentalType" value="(tr|nt)" class="gd-type-radio" onchange="onTypeChange\\(this\\)">/g) || []).length, 2);
    assert.ok(!read('public/css/style.css').includes('psr-types'));
  });
`);

console.log('edited test-game-detail-messenger.js, test-psplus-rent-links.js');
````

Run: `node .superpowers/tmp-edits/edit-psplus-tests.js` → `edited test-game-detail-messenger.js, test-psplus-rent-links.js`.

- [ ] **Step 2: Run them and watch them fail**

- Run: `node scripts/test-psplus-rent-page.js` → FAIL `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:` / `assert.ok(open.body.includes('<body class="gd-page-booking-v2">'))`.
- Run: `node scripts/test-game-detail-messenger.js` → FAIL at `assert.ok(r.body.includes('gd-line-card'))`.
- Run: `node scripts/test-psplus-rent-links.js` → FAIL at `assert.ok(r.body.includes('<div class="gd-type-options" id="typeOptions">'))`.

- [ ] **Step 3: Rebuild the page**

Create `.superpowers/tmp-edits/psplus-rent.new.ejs`, the new page:

````html
<!DOCTYPE html>
<html lang="en">
<head>
  <%- include('partials/head', { page: 'ps-plus', canonicalPath: '/ps-plus/rent', title: 'Rent PS Plus Deluxe | PlayStation Hub' }) %>
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
  <link rel="stylesheet" href="/css/game-psn.css?v=<%= assetV %>">
</head>
<body class="gd-page-booking-v2">
<%- include('partials/announcement') %>
<%- include('partials/nav', { active: 'psplus' }) %>

<%#
  PS Plus Deluxe, laid out like a game page (views/game-detail.ejs): the same
  hero, booking card, type pills, setup guide, Messenger-first button and
  "Or order here on the website" fold, with the same element ids, so it runs
  on the game page's own script (public/js/game-detail.js) and cannot drift
  from it. What stays PS Plus's own: the checkout (/order/create-psplus), its
  prices, its waiting line (game_id 'psplus') and two account types — Trophy
  / PS4 Primary ('tr', with the deposit) and Non-Trophy ('nt'). Rent only.
  See docs/superpowers/specs/2026-10-26-psplus-rent-page-like-game-page-design.md.
%>
<%
  const ntSlots  = slots.nt_slots || 0;
  const trSlots  = slots.tr_slots || 0;
  const trAvail  = trSlots > 0;
  const ntAvail  = ntSlots > 0;
  const allUnavail = !trAvail && !ntAvail;
  const totalSlots = trSlots + ntSlots;
  const isLastSlot = totalSlots === 1;
  const psNext = (typeof nextDays !== 'undefined' && nextDays) ? nextDays : { tr: null, nt: null };
  const trNext = psNext.tr, ntNext = psNext.nt;
  const psStatus = allUnavail
    ? { label: 'Sold Out', cls: 'usd-badge-off' }
    : (isLastSlot ? { label: 'Last Slot', cls: 'usd-badge-warn' } : { label: 'Available', cls: 'usd-badge-ok' });
  let psBarText, psBarUrgent = false;
  if (allUnavail) { psBarText = 'Sold out — all slots rented'; psBarUrgent = true; }
  else if (isLastSlot) { psBarText = 'Only 1 slot left'; psBarUrgent = true; }
  else { psBarText = totalSlots + ' slots available'; }
  // Cheapest live rent across both types and durations — the "From ₱X" the
  // price header and the sticky bar show before anything is picked.
  const psPairs = [
    [prices.nt_price_7d, 7], [prices.nt_price_30d, 30], [prices.tr_price_7d, 7], [prices.tr_price_30d, 30]
  ].filter(([base]) => base > 0).map(([base, d]) => {
    const pct = gameDiscountPct(prices, d, promo);
    return pct > 0 ? base - Math.round(base * pct / 100) : base;
  });
  const psFromPrice = psPairs.length ? Math.min(...psPairs) : 0;
%>

<div class="gd-page">
  <div class="gd-back"><a href="/ps-plus">← Back to PS Plus</a></div>

  <div class="usd-hero gdh-hero">
    <div class="usd-hero-placeholder"></div>
    <div class="usd-hero-scrim"></div>
    <div class="usd-hero-in">
      <div class="usd-badge-row">
        <span class="usd-badge <%= psStatus.cls %>"><%= psStatus.label %></span>
        <span class="usd-plat-chip">SUBSCRIPTION</span>
        <span class="usd-plat-chip">DELUXE</span>
        <span class="usd-plat-chip">PS4/PS5</span>
      </div>
      <h1 class="usd-title">PS Plus Deluxe</h1>
      <div class="usd-hero-foot">
        <div class="gdh-bar-text<%= psBarUrgent ? ' gdh-bar-urgent' : '' %>"><%= psBarText %></div>
        <img src="<%= settings.logo_path %>" alt="" aria-hidden="true" class="usd-hero-brand" width="230" height="56">
      </div>
    </div>
  </div>

  <div class="gd-layout">

    <!-- LEFT: the PS Plus cover, then what it is and the facts a game page
         shows under "Game info". -->
    <div class="gd-cover-col">
      <% if (psplusCover) { %>
      <img src="<%= psplusCover %>" alt="PS Plus Deluxe" class="gd-cover gdh-poster" width="760" height="1140"
        onerror="this.style.display='none';document.getElementById('psCoverFallback').style.display='flex'">
      <% } %>
      <div id="psCoverFallback" class="gd-cover gd-cover-placeholder" style="display:<%= psplusCover ? 'none' : 'flex' %>;background:linear-gradient(135deg,#1a1000,#2a1f00);align-items:center;justify-content:center;">
        <div style="text-align:center;">
          <div style="font-size:3rem;">🏆</div>
          <div style="font-size:1rem;font-weight:900;color:#FFD700;margin-top:0.5rem;">PS PLUS</div>
          <div style="font-size:0.8rem;color:#886600;">DELUXE</div>
        </div>
      </div>
      <div class="gd-platform-badge">PS4/PS5</div>
      <% if (isLastSlot) { %>
        <div class="gc-slot-banner gc-slot-banner-last" style="z-index:3;">🔥 Last Slot</div>
      <% } else if (allUnavail) { %>
        <div class="gc-slot-banner gc-slot-banner-none" style="z-index:3;">Sold Out</div>
      <% } %>
      <section class="gpa" id="gpAbout">
        <h2 class="gpa-h">About this subscription</h2>
        <div class="gpa-text" id="gpaText">
          <p><%- include('partials/swap-line') %></p>
          <p>Access hundreds of games including monthly titles. Trophy or Non-Trophy — your choice.</p>
        </div>
        <h2 class="gpa-h">Info</h2>
        <table class="gpa-info">
          <tr><td>Platform</td><td>PS4 / PS5</td></tr>
          <tr><td>Game swaps</td><td>Unlimited · 2-day cooldown</td></tr>
          <tr><td>Games</td><td>Hundreds, including monthly titles</td></tr>
          <tr><td>Catalogue</td><td><a href="/ps-plus">See all games →</a></td></tr>
        </table>
      </section>
    </div>

    <!-- RIGHT: the booking card -->
    <div class="gd-detail-col">
      <div class="gdh-card">

      <!-- ══ PRICE HEADER ══ -->
      <div class="gd-price-header">
        <div>
          <div class="gd-ph-kicker" id="phKicker" data-default-kicker="From">From</div>
          <div class="gd-ph-amount">
            <span id="phAmount" data-default-amount="<%= psFromPrice %>" data-default-buy-amount="0">₱<%= psFromPrice %></span>
          </div>
          <div class="gd-ph-rider" id="phRider" style="display:none;"></div>
        </div>
        <div class="gd-ph-save-wrap">
          <span class="gd-ph-was" id="phWas" style="display:none;"></span>
          <span class="gd-ph-save" id="phSave" style="display:none;"></span>
        </div>
      </div>

      <!-- Rent only: PS Plus has no Buy Permanent, so there is no toggle and
           #rentPanel is always the panel showing. -->
      <div id="rentPanel">

        <div class="gd-type-options" id="typeOptions">
          <label class="gd-type-card gd-type-pill" id="label-tr">
            <input type="radio" name="rentalType" value="tr" class="gd-type-radio" onchange="onTypeChange(this)">
            <span class="gd-type-icon">🏆</span>
            <span class="gd-type-name">Trophy / PS4 Primary</span>
            <% if (trAvail) { %><span class="gd-slots-left"><%= trSlots %> slot<%= trSlots !== 1 ? 's' : '' %> left</span><% } %>
            <span class="gd-type-status <%= trAvail ? 'gd-status-avail' : 'gd-status-rented' %>"><%= trAvail ? 'Available' : 'Full Slot' %></span>
          </label>
          <label class="gd-type-card gd-type-pill" id="label-nt">
            <input type="radio" name="rentalType" value="nt" class="gd-type-radio" onchange="onTypeChange(this)">
            <span class="gd-type-icon">🎮</span>
            <span class="gd-type-name">Non-Trophy</span>
            <% if (ntAvail) { %><span class="gd-slots-left"><%= ntSlots %> slot<%= ntSlots !== 1 ? 's' : '' %> left</span><% } %>
            <span class="gd-type-status <%= ntAvail ? 'gd-status-avail' : 'gd-status-rented' %>"><%= ntAvail ? 'Available' : 'Full Slot' %></span>
          </label>
        </div>

        <%
          // One slot per pill, in pill order, so each "Available in N days"
          // lands under its own card (same reasoning as views/game-detail.ejs).
          const soonSlots = [
            (!trAvail && trNext != null && trNext > 0) ? { icon: '🏆', days: trNext } : null,
            (!ntAvail && ntNext != null && ntNext > 0) ? { icon: '🎮', days: ntNext } : null
          ];
        %>
        <% if (soonSlots.some(s => s)) { %>
        <div class="gd-avail-soon-row">
          <% soonSlots.forEach(s => { %>
          <% if (s) { %>
          <span class="gd-avail-soon"><%= s.icon %> Available in <strong><%= s.days %> day<%= s.days !== 1 ? 's' : '' %></strong></span>
          <% } else { %>
          <span class="gd-avail-soon" aria-hidden="true" style="visibility:hidden;"></span>
          <% } %>
          <% }) %>
        </div>
        <% } %>

        <button type="button" class="gd-setup-toggle" id="setupToggle" aria-expanded="false" onclick="toggleSetupPanel()">
          <span>How setup works</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="gd-type-setup" id="typeSetupWrap" data-open="0">
          <div class="gd-setup-block" id="setup-tr">
            <p>✅ Play on <strong>YOUR OWN account</strong> and earn trophies on your profile. Includes PS4 Primary access.</p>
            <p style="color:#22c55e;">Setup: Settings → Users and Accounts → Other → Console Sharing and Offline Play → <strong>Enable</strong></p>
            <% if (!trAvail && trNext != null && trNext > 0) { %>
            <p class="gd-avail-soon">📅 Next available in <strong><%= trNext %> day<%= trNext !== 1 ? 's' : '' %></strong></p>
            <% } %>
          </div>
          <div class="gd-setup-block" id="setup-nt">
            <p>🎮 Play on <strong>OUR account</strong> only. Trophies <strong>won't</strong> count on your own profile.</p>
            <p style="color:#888;">Setup: Settings → Users and Accounts → Other → Console Sharing and Offline Play → <strong>leave disabled</strong></p>
            <p style="color:#888;">On PS4, choose <strong>Do Not Activate</strong> if you are prompted.</p>
            <% if (!ntAvail && ntNext != null && ntNext > 0) { %>
            <p class="gd-avail-soon">📅 Next available in <strong><%= ntNext %> day<%= ntNext !== 1 ? 's' : '' %></strong></p>
            <% } %>
          </div>
        </div>

        <div class="gd-duration-grid" id="durationGrid" style="margin-top:0.75rem;">
          <% RENTAL_DURATIONS.forEach(({ days: d, label: durLabel }) => { const pct = gameDiscountPct(prices, d, promo); %>
          <button class="gd-dur-btn" data-days="<%= d %>" onclick="onDurChange(this)">
            <span class="gd-dur-days"><%= durLabel %></span>
            <span class="gd-dur-price" id="price-<%= d %>"><%- rentPriceHtml(prices, 'nt', d, promo) %></span>
            <% if (pct > 0) { %><span class="gd-dur-promo"><%= pct %>% OFF</span><% } %>
          </button>
          <% }) %>
        </div>

        <div id="ctaMsgWrap"<%= allUnavail ? ' hidden' : '' %>>
        <a href="http://m.me/PlaystationHub00" target="_blank" rel="noopener" class="gd-msg-primary" id="ctaMsgPrimary" data-track-source="game">
          <span class="gd-msg-main" id="ctaMsgMain"><%= allUnavail ? '💬 Ask us about this game' : '💬 Message us about this game' %></span>
          <span class="gd-msg-sub" id="ctaMsgSub"><%= allUnavail ? "We'll tell you when it frees up — or suggest a similar one" : 'Opens Messenger · we reply fastest there' %></span>
        </a>
        <div class="gd-msg-preview">
          <div class="gd-msg-preview-label">YOUR MESSAGE WILL SAY</div>
          <div class="gd-msg-preview-text" id="ctaMsgPreview"></div>
        </div>
        </div><!-- /ctaMsgWrap -->
        <% if (!allUnavail) { %>
        <button type="button" class="gd-alt-order" id="orderToggle" aria-expanded="<%= order_error === '1' ? 'true' : 'false' %>" aria-controls="gdOrderBlock" onclick="toggleOrderBlock()">
          Or order here on the website
          <small><%- include('partials/pay-note').trim() %></small>
        </button>
        <div id="gdOrderBlock"<%= order_error === '1' ? '' : ' hidden' %>>
        <% } %>

        <div class="gd-total-box" id="totalBox">
          <div class="gd-total-label">ORDER SUMMARY</div>
          <div class="gd-total-rows" id="totalRows"></div>
          <div class="gd-total-final">
            <span>To send now</span>
            <span id="totalFinal" style="color:var(--ps-blue);font-size:1.2rem;font-weight:900;"></span>
          </div>
          <div class="gd-total-refund" id="totalRefund" style="display:none;"></div>
          <div class="gd-total-hint" id="totalHint" style="display:none;"></div>
        </div>

        <% if (!allUnavail) { %>
        <form method="POST" action="/order/create-psplus" class="gd-order-form" id="gdOrderForm">
          <input type="hidden" name="account_type" id="orderType" value="">
          <input type="hidden" name="days" id="orderDays" value="">
          <input type="text" name="fb_name" id="orderFbName" class="gd-order-name" placeholder="Your Facebook name" required autocomplete="off">
          <button type="submit" class="gd-order-btn gd-cta-wait" id="ctaBtn" disabled>Pick an account type</button>
          <div class="gd-order-sub" id="ctaSub" style="display:none;"><%- include('partials/pay-note').trim() %></div>
        </form>
        </div><!-- /gdOrderBlock -->

        <div id="ctaValidationMsg" style="display:none;text-align:center;margin-top:0.5rem;font-size:0.82rem;color:#ef4444;font-weight:600;"></div>
        <% if (order_error === '1') { %>
        <div class="gd-order-error">⚠️ Please pick an account type and duration, and enter your Facebook name, before continuing.</div>
        <% } %>

        <div id="reserveSection" style="display:none;">
          <%- include('partials/queue-line', { queues: queues, activeType: 'tr', selfRef: null, suffix: '', hideStrip: true }) %>
          <%- include('partials/noslot-options', { game_id: 'psplus', suffix: '', resValMsgId: 'reserveValidationMsg2', variant: 'card' }) %>
        </div>
        <% } else { %>
        <div id="reserveSectionAll">
        <%- include('partials/queue-line', { queues: queues, activeType: 'tr', selfRef: null, suffix: 'All', hideStrip: true }) %>
        <%- include('partials/noslot-options', { game_id: 'psplus', suffix: 'All', resValMsgId: 'reserveValidationMsg1', variant: 'card' }) %>
        </div>
        <% } %>

      </div><!-- /rentPanel -->

      </div><!-- /gdh-card -->
    </div>
  </div>

  <div class="gd-sticky-bar" id="gdStickyBar">
    <div class="gd-sb-info">
      <div class="gd-sb-kicker" id="gdSbKicker">From</div>
      <div class="gd-sb-amount" id="gdSbAmount">₱<%= psFromPrice %></div>
    </div>
    <button type="button" class="gd-sb-btn" id="gdSbBtn" onclick="handleStickyBarClick()"><%= allUnavail ? '💬 Ask us' : '💬 Message us' %></button>
  </div>
</div>

<%- include('partials/footer') %>

<script>const RENTAL_DURATIONS = <%- JSON.stringify(RENTAL_DURATIONS.map(d => d.days)) %>;</script>
<script>
// The globals public/js/game-detail.js reads, filled with PS Plus's own
// prices: two types (no separate PS4 Primary) and nothing to buy.
const PRICES = {
  nt: { 7: <%= prices.nt_price_7d %>, 30: <%= prices.nt_price_30d %> },
  tr: { 7: <%= prices.tr_price_7d %>, 30: <%= prices.tr_price_30d %> }
};
const BUY_PRICES = { nt: 0, tr: 0 };
const PROMO = {
  enabled: true,
  discounts: { 7: <%= gameDiscountPct(prices, 7, promo) %>, 30: <%= gameDiscountPct(prices, 30, promo) %> },
  deposit: <%= promo.deposit %>
};
const AVAIL = { nt: <%= ntAvail ? 'true' : 'false' %>, tr: <%= trAvail ? 'true' : 'false' %>, ps4: false };
const ALL_UNAVAIL = <%= allUnavail ? 'true' : 'false' %>;
const NEXT_DAYS = <%- JSON.stringify({ tr: trNext != null ? trNext : null, nt: ntNext != null ? ntNext : null, ps4: null }) %>;
const gameTitle = 'PS Plus Deluxe';
const gdSlideCount = 0;
</script>
<script src="/js/messenger-text.js?v=<%= assetV %>"></script>
<script src="/js/game-detail.js?v=<%= assetV %>"></script>
</body>
</html>
````

Create `.superpowers/tmp-edits/edit-psplus-page.js`:

````js
// The PS Plus Deluxe rent page, rebuilt like a game page: GET /ps-plus/rent
// passes how many days until each type frees up, views/psplus-rent.ejs is
// replaced with the new layout (psplus-rent.new.ejs beside this script), and
// the old page script and its extraction test retire. Keeps server.js's BOM
// and CRLF, and the view's CRLF.
const fs = require('fs');
const path = require('path');
const rep = require('./rep');
const S = 'server.js';

rep(S,
`  const psplusCover = psplusGame && psplusGame.cover_image ? psplusGame.cover_image : '';
`,
`  const psplusCover = psplusGame && psplusGame.cover_image ? psplusGame.cover_image : '';
  // Days until each type frees up — "Available in N days" under a full type and
  // in the get-in-line card — from the catalogue row's linked accounts: the same
  // numbers a game page shows (lib/availability.js).
  let nextDays = { tr: null, nt: null };
  if (psplusGame) {
    const a = computeAvailability(psplusGame, gameAccountSummary(psplusGame.id));
    nextDays = { tr: a.trNext != null ? a.trNext : null, nt: a.ntNext != null ? a.ntNext : null };
  }
`);

rep(S,
`res.render('psplus-rent', { prices, slots, psplusCover, promo: settings.promo,`,
`res.render('psplus-rent', { prices, slots, psplusCover, nextDays, promo: settings.promo,`);

rep.put('views/psplus-rent.ejs', path.join(__dirname, 'psplus-rent.new.ejs'));

// The old page's stacked type cards (.psr-types) are gone; the new page uses
// the game page's pills and their styles.
rep.between('public/css/style.css',
  '/* PS Plus Deluxe rent page (views/psplus-rent.ejs): its type cards keep a\n',
  'body.light-mode .psr-types .gd-type-card.gd-type-selected { background: #fff8e6; }\n',
  '');

fs.unlinkSync('public/js/psplus-rent.js');
fs.unlinkSync('scripts/test-js-extraction-psplus-rent.js');

console.log('edited server.js, psplus-rent.ejs, style.css; removed psplus-rent.js and its extraction test');
````

Run: `node .superpowers/tmp-edits/edit-psplus-page.js` → `edited server.js, psplus-rent.ejs, style.css; removed psplus-rent.js and its extraction test`.
Then: `file server.js views/psplus-rent.ejs public/css/style.css` → `server.js` still `UTF-8 (with BOM) text … with CRLF line terminators`; the other two still `with CRLF line terminators`.
Then: `git diff --stat -- views/game-detail.ejs public/js/game-detail.js` → nothing.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-psplus-rent-page.js && node scripts/test-game-detail-messenger.js && node scripts/test-psplus-rent-links.js` → `15`, `17`, `5 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add views/psplus-rent.ejs server.js public/css/style.css public/js/psplus-rent.js scripts/test-js-extraction-psplus-rent.js scripts/test-psplus-rent-page.js scripts/test-game-detail-messenger.js scripts/test-psplus-rent-links.js
git commit -m "PS Plus Deluxe rent page: the game page's layout and script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git show --stat HEAD
```
Expected `git show --stat`: the two deleted files show as deleted, and nothing else besides the eight paths above.

---

### Task 2: Full suite, browser check and clean-up

Run by the controller, which has the built-in browser. Throwaway instances only.

**Files:**
- Create: `.superpowers/tmp-edits/serve-psplus-review.js`
- Temporarily modify, outside the repo: `C:\Users\michael\Desktop\claude code\.claude\launch.json`. Add two entries, then remove them.

**Interfaces:**
- Consumes: the rebuilt page from Task 1.
- Produces: nothing to commit.

- [ ] **Step 1: Run the whole suite**

Run: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"`
Expected: only `FAIL scripts/test-upcoming-psn-page-public.js` and `failed: 1`.

- [ ] **Step 2: Start two throwaway instances**

Create `.superpowers/tmp-edits/serve-psplus-review.js`:

````js
// Throwaway review instance for the PS Plus Deluxe rent page: a temp DATA_DIR,
// a blank MONGODB_URI and made-up games; no admin login. Runs from any folder:
//   node <repo>/.superpowers/tmp-edits/serve-psplus-review.js last   → port 4648
//   node <repo>/.superpowers/tmp-edits/serve-psplus-review.js sold   → port 4649
// 'last': Trophy is full (a linked account rents it out for 5 more days) and
// one Non-Trophy slot is open. 'sold': both types are full. No cover image, so
// the gold fallback tile shows.
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const CASE = process.argv[2] === 'sold' ? 'sold' : 'last';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-psplus-'));
const end = (() => { const d = new Date(); d.setDate(d.getDate() + 5); return d.toISOString().slice(0, 10); })();
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const off = { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  site_settings: { promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 } },
  games: [
    Object.assign({ id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5', genre: '', cover_image: '', renters: 9, non_trophy_slots: CASE === 'sold' ? 0 : 1, trophy_slots: 0 }, price),
    Object.assign({ id: 5, title: 'Zzyzx Racer', platform: 'PS5', genre: 'Racing', cover_image: '', renters: 2, non_trophy_slots: 1, trophy_slots: 1 }, price)
  ],
  accounts: [{
    id: 1, label: 'Zzyzx PS Plus account', game_ids: [4],
    slots: { trophy: { enabled: true, status: 'rented', renter_id: null, renter_name: 'Zzyzx Renter', start: '', end }, non_trophy: off, ps4_primary: off }
  }],
  psplus_prices: { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 }
}));
process.env.PORT = CASE === 'sold' ? '4649' : '4648';
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.chdir(ROOT);
const sessionStore = require(path.join(ROOT, 'lib/session-store'));
sessionStore.createStore = () => { const s = new (require(path.join(ROOT, 'node_modules/express-session')).MemoryStore)(); s.ensureIndexes = async () => false; return s; };
require(path.join(ROOT, 'server.js'));
const done = () => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } process.exit(0); };
process.on('SIGINT', done); process.on('SIGTERM', done);
setTimeout(done, 30 * 60 * 1000);
````

Add these two entries to the `configurations` array of `C:\Users\michael\Desktop\claude code\.claude\launch.json`. Keep the other entries as they are:

```json
{
  "name": "psplus-review-last",
  "runtimeExecutable": "node",
  "runtimeArgs": ["C:/Users/michael/Desktop/claude code/playstation-hub/.superpowers/tmp-edits/serve-psplus-review.js", "last"],
  "port": 4648
},
{
  "name": "psplus-review-sold",
  "runtimeExecutable": "node",
  "runtimeArgs": ["C:/Users/michael/Desktop/claude code/playstation-hub/.superpowers/tmp-edits/serve-psplus-review.js", "sold"],
  "port": 4649
}
```

Start `psplus-review-last` with `preview_start`, and open `http://localhost:4648/ps-plus/rent`.

- [ ] **Step 3: Check one slot left, at 1280px and 375px**

At 1280px:
- The hero shows `Last Slot`, `SUBSCRIPTION`, `DELUXE`, `PS4/PS5`, `PS Plus Deluxe` and `Only 1 slot left`.
- The gold PS PLUS fallback tile stands in for the cover, with About and Info under it.
- The card sits beside the cover column. It has two equal pills side by side, and "🏆 Available in 5 days" or "6 days" (depending on the hour) under Trophy, which says `Full Slot`.
- Non-Trophy is picked first. "How setup works" opens to the Non-Trophy text.
- The preview reads `Hi! I want to RENT a game 🎮` / `Game: PS Plus Deluxe` / `Account Type: Non-Trophy Account`.
- Click Weekly, then "Or order here on the website". The button reads `🎮 Rent now — ₱349`, and `#gdOrderForm` posts to `/order/create-psplus`.
- Click Trophy. The Messenger button hides, and the get-in-line card shows with " · Trophy frees up in about 5 days" or "6 days", matching the pill. Its form carries `game_id` `psplus`.

At 375px (resize to the mobile preset and reload):
- `document.documentElement.scrollWidth` is 375.
- The order is poster, About, then the card.
- The sticky bar shows `From ₱349` and `💬 Message us`.

The console shows no script errors.

- [ ] **Step 4: Check sold out**

Start `psplus-review-sold` and open `http://localhost:4649/ps-plus/rent`:
- The hero shows `Sold Out` and `Sold out — all slots rented`.
- Both pills say `Full Slot`.
- There is no Messenger button and no website order.
- There is one get-in-line card (`#lineCardAll`, `game_id` `psplus`).
- The sticky bar at 375px reads `Fully booked` and `Get in line`.

- [ ] **Step 5: Tear down and clean up**

- Reset the viewport to the desktop preset, and stop both servers with `preview_stop`.
- Remove the two `psplus-review-*` entries from `launch.json`.
- Stopping does not always let the launcher delete its data folder. Delete any leftover throwaway folders: `rm -rf "$TEMP"/review-psplus-*`. Each holds only `games.json` and an empty `uploads`.

```bash
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
