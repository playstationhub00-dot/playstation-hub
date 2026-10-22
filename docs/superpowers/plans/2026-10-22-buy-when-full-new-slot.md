# Buy permanently even when full — the owner adds a new slot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A game type whose slots are all taken can still be bought permanently. The released game page, the Coming Soon page and the Buy shop offer it as a "🆕 New slot · set up on order", the order is marked `new_slot`, and the owner is told to add an account.

**Architecture:** A new `buyOption(summary, slotKey, legacy, price)` in `lib/availability.js` decides every type's state: **buyable** (has a permanent price), **in stock** (the existing `buyTypeSellable` says yes) or **new slot** (buyable but not in stock). The released game page, the Buy shop data and the checkout all use it; the checkout stops refusing a full type and marks the order `new_slot: true`. A Coming Soon pre-order of a type with no rent slots left is marked the same way. `lib/notifications.js` gains a "New slot to add" item. The Orders tab, the customer's order page, the released page's Buy tab and the Coming Soon page show the new-slot wording.

**Tech Stack:** Express + EJS templates, plain browser JS (no build step), plain CSS. Tests are `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-22-buy-when-full-new-slot-design.md` (amended after this plan's dry run).

**How this plan was checked.** Every file in this plan was dry-run in a scratch copy of the current `main`. Each new test fails first and then passes, and the full suite stays green apart from the known `scripts/test-upcoming-psn-page-public.js`, which also fails before this work. A browser check used a throwaway instance with a full released game, a free one, a Coming Soon game with Trophy full, and an in-memory order store:

- **Released page, 1280px and 375px:** both full cards are buyable, tagged and lined, and the note follows the picked type.
- **Test order:** placing one opened its order page with "🆕 We're adding a new Trophy slot for you…".
- **Coming Soon, 1280px and 375px:** picking Trophy (full) shows "🔑 Trophy is full? Own it instead — … Buy ₱1999 →". Tapping it opens Buy Permanent with Trophy picked and the pre-order note.
- **Admin:** the Orders ledger shows "🆕 New slot needed — add a Trophy account for Elden Ring".
- **Errors:** no sideways scroll on phones, and no console or server errors.

Two phone fixes came out of that check and are already in the files below. The tag drops under the card name instead of overflowing, and the strip keeps its key icon on the same line as the text.

## Global Constraints

- Work directly on `main` and do not switch branches. **Push only when the owner says "push".**
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Line endings:**
  - `server.js` is CRLF + UTF-8 BOM in the working tree.
  - These files are CRLF: `lib/availability.js`, `lib/notifications.js`, `public/css/style.css`, `views/game-detail.ejs`, `public/js/game-detail.js`, `views/upcoming-detail.ejs`, `public/js/upcoming-detail.js`, `views/order-status.ejs`, `views/partials/admin/orders/needs-you.ejs`, `views/partials/admin/orders/ledger.ejs`.
  - New test files are LF.
  - The edit scripts (via `.superpowers/tmp-edits/rep.js`) keep each file's endings and BOM.
  - Git stores LF blobs (`core.autocrlf=true`), so a CRLF working copy is expected.
- **The rule, per type** (Non-Trophy `non_trophy`, Trophy `trophy`):
  - **buyable** = permanent price above 0 (Trophy also needs the game to show Trophy).
  - **in stock** = buyable and `buyTypeSellable(...)`.
  - **new slot** = buyable and not in stock.
- **Which games:** every game with a permanent price, with no per-game switch. Price and buy promo are as now. A new slot is "set up on order", with no promised time.
- **Box sets (bundles) are unchanged:** a taken bundle slot still refuses (`/buy?order_error=sold`).
- **Copy, verbatim:**
  - Tag: `🆕 New slot · set up on order`.
  - Card line: `Our Trophy slots are all taken — we'll add a brand-new one just for you.` (Non-Trophy: `Our Non-Trophy slots are all taken — …`).
  - Released-page note: `🆕 <strong>Set up on order:</strong> we buy a fresh Trophy slot for this game after you pay, then message you on Facebook when it's ready. Same price, yours forever.`
  - Coming Soon note: `🆕 Pre-order now. On release day we set up a fresh Trophy slot for you and message you.`
  - Gold strip: `🔑 <b>Trophy is full?</b> Own it instead — we'll add a new Trophy slot for you.` with a `Buy ₱X →` button.
  - Order page: `🆕 We're adding a new Trophy slot for you — we'll message you on Facebook when it's ready.`
  - Admin flag: `🆕 New slot needed — add a Trophy account for <game>`.
  - Needs you now: `New slot to add` with `PH-… · name · game · Trophy`.
- **Orders:** `new_slot: true` only on new-slot orders (the field is absent otherwise). Needs you now lists them while `state` is `awaiting_qr` or `qr_pending`.
- Tests use a temp `DATA_DIR`, a blank `MONGODB_URI`, the in-memory session store, a made-up admin password and an in-memory order store. Never touch the project's `games.json` or a database.
- Known unrelated failure: `scripts/test-upcoming-psn-page-public.js`. Report it; do not fix it.
- Edit scripts live in `.superpowers/tmp-edits/` (git-ignored). Never commit them. Task 4 removes the folder.
- Always `git add` explicit paths: the untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.

## Files

| File | Task | Change |
|---|---|---|
| `lib/availability.js` | 1 | `buyOption` |
| `lib/notifications.js` | 1 | `new_slot` item, `pendingNewSlots` |
| `scripts/test-buy-new-slot.js` (new) | 1 | The rule and the item |
| `server.js` | 2 | `buyOption` in app locals; Buy shop data; `/order/buy` and `/order/reserve` mark `new_slot`; both Needs-you-now builds |
| `views/partials/admin/orders/needs-you.ejs`, `views/partials/admin/orders/ledger.ejs` | 2 | The "New slot needed" flag |
| `views/order-status.ejs` | 2 | The customer's note |
| `public/css/style.css` | 2, 3, 4 | Order flags and note; the card tag and note; the Coming Soon strip |
| `scripts/test-buy-page.js` | 2 | A full game now stays listed |
| `scripts/test-buy-new-slot-orders.js` (new) | 2 | Checkout, pre-order, shop, order page, admin |
| `views/game-detail.ejs`, `public/js/game-detail.js` | 3 | The Buy Permanent tab |
| `scripts/test-buy-new-slot-game-page.js` (new) | 3 | The released page |
| `views/upcoming-detail.ejs`, `public/js/upcoming-detail.js` | 4 | The strip, the Buy tab tag and note |
| `scripts/test-buy-new-slot-coming-soon.js` (new) | 4 | The Coming Soon page |

---

### Task 1: The rule, and the "New slot to add" item

**Files:**
- Create: `scripts/test-buy-new-slot.js`, `.superpowers/tmp-edits/rep.js`, `.superpowers/tmp-edits/edit-new-slot-rules.js`
- Modify (edit script): `lib/availability.js`, `lib/notifications.js`

**Interfaces:**
- Consumes: `buyTypeSellable(summary, slotKey, legacy)` in `lib/availability.js` (unchanged).
- Produces:
  - `require('./lib/availability').buyOption(summary, slotKey, legacy, price)` → `{ buyable, inStock, newSlot }` (booleans).
  - `require('./lib/notifications').pendingNewSlots(orders)` → orders with `new_slot` and state `awaiting_qr` or `qr_pending`.
  - `notifications.build({ newSlotOrders })` adds one item per order: `{ id: 'new_slot:<ref>', kind: 'new_slot', urgency: 'warn', icon: '🆕', title: 'New slot to add', sub: '<ref> · <name> · <game> · Trophy|Non-Trophy', tab: 'orders', ref }`.
  - `RANK.new_slot` = 9.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-buy-new-slot.js`:

````js
// Run: node scripts/test-buy-new-slot.js
//
// Buying permanently when a type is full: the rule for each account type
// (lib/availability.js buyOption — buyable when it has a permanent price, in
// stock when a slot can be handed over now, otherwise a new slot the owner
// adds), and the "New slot to add" item in Needs you now (lib/notifications.js).
// See docs/superpowers/specs/2026-10-22-buy-when-full-new-slot-design.md.
const assert = require('assert');
const { buyOption } = require('../lib/availability');
const notifications = require('../lib/notifications');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const summary = (total, sellable) => ({ trophy: { total, sellable } });

ok('a type with a permanent price and a slot to hand over is in stock', () => {
  assert.deepStrictEqual(buyOption(summary(2, 1), 'trophy', null, 1999), { buyable: true, inStock: true, newSlot: false });
  assert.deepStrictEqual(buyOption(null, 'trophy', { everStocked: true, avail: true }, 1999), { buyable: true, inStock: true, newSlot: false }, 'a legacy slot free now');
});

ok('every slot rented out, sold or offline: still buyable, as a new slot', () => {
  assert.deepStrictEqual(buyOption(summary(2, 0), 'trophy', null, 1999), { buyable: true, inStock: false, newSlot: true }, 'linked accounts sold or offline');
  assert.deepStrictEqual(buyOption(null, 'trophy', { everStocked: true, avail: false }, '1999'), { buyable: true, inStock: false, newSlot: true }, 'legacy slots all rented');
});

ok('never stocked is in stock as before (its account is made on the first sale)', () => {
  assert.deepStrictEqual(buyOption(null, 'trophy', { everStocked: false, avail: false }, 999), { buyable: true, inStock: true, newSlot: false });
});

ok('no permanent price: not buyable at all', () => {
  [0, null, undefined, '', -5].forEach(p => {
    assert.deepStrictEqual(buyOption(summary(2, 0), 'trophy', null, p), { buyable: false, inStock: false, newSlot: false }, String(p));
  });
});

ok('Needs you now: one "New slot to add" per paid new-slot order not yet set up', () => {
  const list = [
    { ref: 'PH-1', state: 'awaiting_qr', new_slot: true, fb_name: 'Juan D.', game_title: 'Elden Ring', account_type: 'tr' },
    { ref: 'PH-2', state: 'qr_pending', new_slot: true, fb_name: 'Ana', game_title: 'GTA V', account_type: 'nt', qr_expires_at: '2026-10-22T10:00:00.000Z' },
    { ref: 'PH-3', state: 'awaiting_payment', new_slot: true, fb_name: 'Unpaid', game_title: 'X', account_type: 'tr' },
    { ref: 'PH-4', state: 'verifying_payment', new_slot: true, fb_name: 'Checking', game_title: 'X', account_type: 'tr' },
    { ref: 'PH-5', state: 'active', new_slot: true, fb_name: 'Done', game_title: 'X', account_type: 'tr' },
    { ref: 'PH-6', state: 'reserved', new_slot: true, fb_name: 'Not released yet', game_title: 'X', account_type: 'tr' },
    { ref: 'PH-7', state: 'awaiting_qr', fb_name: 'In stock', game_title: 'X', account_type: 'tr' },
    { ref: 'PH-8', state: 'cancelled', new_slot: true, fb_name: 'Gone', game_title: 'X', account_type: 'tr' },
    null
  ];
  const pending = notifications.pendingNewSlots(list);
  assert.deepStrictEqual(pending.map(o => o.ref), ['PH-1', 'PH-2']);
  const built = notifications.build({ newSlotOrders: pending });
  const items = built.items.filter(i => i.kind === 'new_slot');
  assert.deepStrictEqual(items.map(i => [i.id, i.urgency, i.icon, i.title, i.sub, i.tab, i.ref]), [
    ['new_slot:PH-1', 'warn', '🆕', 'New slot to add', 'PH-1 · Juan D. · Elden Ring · Trophy', 'orders', 'PH-1'],
    ['new_slot:PH-2', 'warn', '🆕', 'New slot to add', 'PH-2 · Ana · GTA V · Non-Trophy', 'orders', 'PH-2']
  ]);
  assert.ok(notifications.RANK.new_slot > notifications.RANK.verifying_payment, 'after the critical payment queue');
  assert.deepStrictEqual(notifications.pendingNewSlots(undefined), []);
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-buy-new-slot.js` → FAIL `TypeError: buyOption is not a function`.

- [ ] **Step 3: Add the rule and the item**

Create `.superpowers/tmp-edits/rep.js`. It keeps a file's BOM and CRLF, fails loudly on a missing or repeated anchor, and has `rep.between` for block replacements; every later task reuses it:

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

Create `.superpowers/tmp-edits/edit-new-slot-rules.js`:

````js
// Task 1: the buyable / in stock / new slot rule (lib/availability.js) and the
// "New slot to add" item in Needs you now (lib/notifications.js). Keeps both
// files' CRLF.
const rep = require('./rep');

rep('lib/availability.js',
`// The function itself stays the export, so every existing`,
`// Buying a type permanently (Non-Trophy 'non_trophy', Trophy 'trophy'). Any
// type with a permanent price can be bought. It is in stock when a slot can be
// handed over now (buyTypeSellable); otherwise — every slot rented out, sold
// or offline — it is a new slot: the owner buys the game on another account
// after the sale. See docs/superpowers/specs/2026-10-22-buy-when-full-new-slot-design.md.
function buyOption(summary, slotKey, legacy, price) {
  const buyable = Number(price) > 0;
  const inStock = buyable && buyTypeSellable(summary, slotKey, legacy);
  return { buyable, inStock, newSlot: buyable && !inStock };
}

// The function itself stays the export, so every existing`);

rep('lib/availability.js',
`module.exports.buyTypeSellable = buyTypeSellable;`,
`module.exports.buyTypeSellable = buyTypeSellable;
module.exports.buyOption = buyOption;`);

rep('lib/notifications.js',
`  expiry_overdue: 4,
  verifying_return: 10,`,
`  expiry_overdue: 4,
  new_slot: 9,
  verifying_return: 10,`);

rep('lib/notifications.js',
`function ms(t) {`,
`// Paid permanent purchases of a full type (order.new_slot), from payment
// confirmed until the owner activates them: the extra account has to be
// bought first. A Coming Soon pre-order joins once its game is released.
const NEW_SLOT_STATES = Object.freeze(['awaiting_qr', 'qr_pending']);
function pendingNewSlots(list) {
  return (list || []).filter(o => o && o.new_slot && NEW_SLOT_STATES.includes(o.state));
}

function ms(t) {`);

rep('lib/notifications.js',
`  // ── Rentals due back ──`,
`  // ── A full type sold permanently: an account to add ──
  (src.newSlotOrders || []).forEach(o => {
    if (!o) return;
    push({
      id: 'new_slot:' + o.ref, kind: 'new_slot', urgency: 'warn', icon: '🆕',
      title: 'New slot to add',
      sub: detail([o.ref, nameOf(o), o.game_title, o.account_type === 'tr' ? 'Trophy' : 'Non-Trophy']),
      tab: 'orders', ref: o.ref, tie: ms(o.created_at)
    });
  });

  // ── Rentals due back ──`);

rep('lib/notifications.js',
`module.exports = { build, RANK };`,
`module.exports = { build, RANK, pendingNewSlots };`);

console.log('edited availability.js, notifications.js');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-new-slot-rules.js` → `edited availability.js, notifications.js`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-buy-new-slot.js && node scripts/test-notifications.js` → `5`, `46 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/availability.js lib/notifications.js scripts/test-buy-new-slot.js
git commit -m "Buy when full: the buyable / in stock / new slot rule and the New slot to add item

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The shop, the checkout and the owner's flags

**Files:**
- Create: `scripts/test-buy-new-slot-orders.js`, `.superpowers/tmp-edits/edit-new-slot-shop-test.js`, `.superpowers/tmp-edits/edit-new-slot-server.js`, `.superpowers/tmp-edits/edit-new-slot-views.js`
- Modify (edit script): `scripts/test-buy-page.js`, `server.js`, `views/partials/admin/orders/needs-you.ejs`, `views/partials/admin/orders/ledger.ejs`, `views/order-status.ejs`, `public/css/style.css`

**Interfaces:**
- Consumes: `buyOption` and `notifications.pendingNewSlots` (Task 1); in `server.js`: `buyShopData`, `computeAvailability`, `gameAccountSummary`, `resolveUpcomingSlots`, `createOrderNotified`, the `allOrders` list both admin routes already build; `.superpowers/tmp-edits/rep.js` (Task 1).
- Produces:
  - `app.locals.buyOption` (Task 3's template uses it).
  - Order field `new_slot: true`.
  - CSS classes `.oq-badge-newslot`, `.oq-newslot-flag`, `.ord-newslot`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-buy-new-slot-orders.js`:

````js
// Run: node scripts/test-buy-new-slot-orders.js
//
// A full type still sells permanently: the checkout takes the order and marks
// it new_slot (a bundle's taken slot still refuses), a Coming Soon pre-order of
// a full type is marked too, the Buy shop keeps the game listed as "Set up on
// order", the customer's order page says a slot is being added, and the owner
// sees "New slot needed" on the Orders tab and "New slot to add" in Needs you
// now. Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory
// sessions, a made-up admin password, an in-memory order store); the
// project's games.json, the database and the real admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4636;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buy-new-slot-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const game = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', genre: 'Action', cover_image: '', non_trophy_slots: 1, trophy_slots: 1, renters: 1 }, price, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [
    game(1, 'Zzyzx Rented', { renters: 3, non_trophy_slots: 0, trophy_slots: 0, buy_nt_price: 999, buy_tr_price: 1499 }),
    game(2, 'Zzyzx Free', { renters: 2, buy_nt_price: 799 }),
    game(3, 'Zzyzx Fresh', { renters: 0, buy_nt_price: 599 })
  ],
  accounts: [{
    id: 1, label: 'Zzyzx Box', public_name: 'Zzyzx Box', for_sale: true, game_ids: [3], price_permanent_nt: 900, price_permanent_tr: 1100,
    slots: { non_trophy: { enabled: true, status: 'open' }, trophy: { enabled: true, status: 'buyed' }, ps4_primary: { enabled: false, status: 'open' } }
  }],
  upcoming: [Object.assign({ id: 1, title: 'Zzyzx Soon', platform: 'PS5', release_date: '2099-01-01', non_trophy_slots: 2, trophy_slots: 1, buy_nt_price: 1299, buy_tr_price: 1999 }, price)],
  customers: [{ id: 1, customer_name: 'Zzyzx Early', game_id: 'upcoming_1', game_title: 'Zzyzx Soon', account_type: 'tr', status: 'reservation', price: 899, payments: [] }]
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
const form = o => new URLSearchParams(o).toString();
const post = (p, o, headers) => call('POST', p, { headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}), body: form(o) });

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
  // An in-memory order store instead of the database.
  const stored = [];
  const orders = require('../lib/orders');
  orders.create = async fields => {
    const order = Object.assign({ ref: 'PH-' + (9000 + stored.length), url_key: 'k' + stored.length, state: 'awaiting_payment', created_at: new Date().toISOString(), deposit_due: 0 }, fields);
    stored.push(order);
    return order;
  };
  orders.getByRef = async ref => stored.find(o => o.ref === ref) || null;
  orders.listByStates = async states => stored.filter(o => !states || states.includes(o.state));
  orders.expireStaleQrs = async () => {};
  orders.advanceEndedRentals = async () => {};

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');
  const last = () => stored[stored.length - 1];

  await okAsync('checkout: a full type is sold and marked new_slot; an in-stock type is not', async () => {
    const r = await post('/order/buy', { kind: 'game', game_id: '1', account_type: 'tr', fb_name: 'Zzyzx Juan' });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.startsWith('/order/PH-'), 'to the order page, not order_error=sold: ' + r.headers.location);
    assert.deepStrictEqual([last().game_title, last().account_type, last().amount_due, last().is_buy, last().new_slot], ['Zzyzx Rented', 'tr', 1499, true, true]);
    await post('/order/buy', { kind: 'game', game_id: '2', account_type: 'nt', fb_name: 'Zzyzx Ana' });
    assert.deepStrictEqual([last().game_title, 'new_slot' in last()], ['Zzyzx Free', false]);
    await post('/order/buy', { kind: 'game', game_id: '3', account_type: 'nt', fb_name: 'Zzyzx Bea' });
    assert.strictEqual('new_slot' in last(), false, 'never stocked is set up on order already, not a new slot');
  });
  await okAsync('a bundle\'s taken slot still refuses', async () => {
    const before = stored.length;
    const r = await post('/order/buy', { kind: 'bundle', account_id: '1', slot_type: 'tr', fb_name: 'Zzyzx Cy' });
    assert.strictEqual(r.headers.location, '/buy?order_error=sold');
    assert.strictEqual(stored.length, before);
  });
  await okAsync('a Coming Soon pre-order of a full type is marked new_slot', async () => {
    await post('/order/reserve', { kind: 'buy', game_id: '1', account_type: 'tr', fb_name: 'Zzyzx Dee' });
    assert.deepStrictEqual([last().game_title, last().is_buy, last().upcoming_game_id, last().new_slot], ['Zzyzx Soon', true, 1, true]);
    await post('/order/reserve', { kind: 'buy', game_id: '1', account_type: 'nt', fb_name: 'Zzyzx Eve' });
    assert.strictEqual('new_slot' in last(), false, 'Non-Trophy still has slots');
  });
  await okAsync('the Buy shop keeps a full game, set up on order, off Ready today', async () => {
    const all = (await call('GET', '/buy/catalog')).body;
    const card = /<a href="\/game\/zzyzx-rented\?mode=buy" class="shop-card">[\s\S]*?<\/a>/.exec(all);
    assert.ok(card, 'listed');
    assert.ok(card[0].includes('<span class="shop-stock shop-wait">Set up on order</span>') && card[0].includes('₱999'));
    const ready = (await call('GET', '/buy/catalog?tab=ready-today')).body;
    assert.ok(/data-id="1" hidden>/.test(ready) && /data-id="2">/.test(ready), 'Ready today shows only in-stock games');
  });
  await okAsync('the customer\'s order page says a new slot is being added', async () => {
    const o = stored[0];
    const page = (await call('GET', '/order/' + o.ref + '?k=' + o.url_key)).body;
    assert.ok(page.includes('<div class="ord-newslot">🆕 We\'re adding a new Trophy slot for you — we\'ll message you on Facebook when it\'s ready.</div>'));
    const plain = stored[1];
    assert.ok(!(await call('GET', '/order/' + plain.ref + '?k=' + plain.url_key)).body.includes('ord-newslot'));
    o.state = 'active';
    assert.ok(!(await call('GET', '/order/' + o.ref + '?k=' + o.url_key)).body.includes('ord-newslot'), 'gone once set up');
    o.state = 'awaiting_payment';
  });
  await okAsync('the owner: New slot needed on the order, New slot to add once it is paid', async () => {
    const login = await post('/admin/login', { password: TEST_PASSWORD });
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    stored[0].state = 'awaiting_qr';
    const admin = (await call('GET', '/admin?tab=orders', { headers: { Cookie: cookie } })).body;
    assert.ok(admin.includes('<span class="oq-newslot-flag">🆕 New slot needed — add a Trophy account for Zzyzx Rented</span>'), 'the ledger row');
    assert.ok(admin.includes('New slot to add') && admin.includes('PH-9000 · Zzyzx Juan · Zzyzx Rented · Trophy'), 'Needs you now');
    stored[0].state = 'qr_pending';
    const doNow = (await call('GET', '/admin?tab=orders', { headers: { Cookie: cookie } })).body;
    assert.ok(doNow.includes('<span class="oq-badge oq-badge-newslot">🆕 New slot needed — add a Trophy account for Zzyzx Rented</span>'), 'the Do now card');
    stored[0].state = 'active';
    const done = (await call('GET', '/admin?tab=orders', { headers: { Cookie: cookie } })).body;
    assert.ok(!done.includes('New slot to add') && done.includes('<span class="oq-newslot-flag">🆕 New slot</span>'), 'set up: off Needs you now, the ledger keeps a short tag');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

The Buy shop test's "Zzyzx Full" (every slot taken) now stays listed. Create `.superpowers/tmp-edits/edit-new-slot-shop-test.js`:

````js
// Task 2, step 1: the Buy shop test's "Zzyzx Full" (every slot taken) now stays
// listed as "Set up on order" instead of dropping off.
const rep = require('./rep');
const F = 'scripts/test-buy-page.js';

rep(F,
`    assert.ok(shop.includes('placeholder="Search 5 games to own…"'), 'only games that can still be bought');`,
`    assert.ok(shop.includes('placeholder="Search 6 games to own…"'), 'every game with a permanent price, full ones too');`);
rep(F,
`    assert.deepStrictEqual(titles(shelf(shop, 'best-sellers')), ['Tekken', 'Plain &amp; &lt;Co&gt;', 'Elden', 'Astro', 'Callisto'], 'sold first, then the most rented, topped up');`,
`    assert.deepStrictEqual(titles(shelf(shop, 'best-sellers')), ['Tekken', 'Plain &amp; &lt;Co&gt;', 'Elden', 'Full', 'Astro', 'Callisto'], 'sold first, then the most rented, topped up');`);
rep(F,
`    assert.deepStrictEqual(titles(shelf(shop, 'under-1000')), ['Plain &amp; &lt;Co&gt;', 'Astro']);`,
`    assert.deepStrictEqual(titles(shelf(shop, 'under-1000')), ['Plain &amp; &lt;Co&gt;', 'Full', 'Astro']);`);
rep(F,
`    assert.ok(!cards.includes('NoBuy') && !cards.includes('Full') && !shop.includes('Zzyzx Hidden Box'), 'nothing that cannot be bought');`,
`    assert.ok(!cards.includes('NoBuy') && !shop.includes('Zzyzx Hidden Box'), 'nothing without a permanent price');
    assert.ok(card(shop, 'zzyzx-full').includes('<span class="shop-stock shop-wait">Set up on order</span>'), 'every slot taken: still sold, as a new slot');`);
rep(F,
`    assert.deepStrictEqual(tabs(all).map(t => t.key + ' ' + t.count), ['all 5', 'best-sellers 5', 'ready-today 4', 'box-sets 2', 'under-1000 2', '1000-1999 2', '2000-up 1']);`,
`    assert.deepStrictEqual(tabs(all).map(t => t.key + ' ' + t.count), ['all 6', 'best-sellers 6', 'ready-today 4', 'box-sets 2', 'under-1000 3', '1000-1999 2', '2000-up 1']);`);
rep(F,
`    assert.deepStrictEqual(shown(all, 'scGrid', 'id'), [3, 5, 2, 1, 4]);`,
`    assert.deepStrictEqual(shown(all, 'scGrid', 'id'), [3, 5, 2, 7, 1, 4]);`);
rep(F,
`    assert.deepStrictEqual(shown(az, 'scGrid', 'id'), [1, 5]);`,
`    assert.deepStrictEqual(shown(az, 'scGrid', 'id'), [1, 7, 5]);`);
rep(F,
`    assert.deepStrictEqual(shown(odd, 'scGrid', 'id'), [3, 5, 2, 1, 4]);`,
`    assert.deepStrictEqual(shown(odd, 'scGrid', 'id'), [3, 5, 2, 7, 1, 4]);`);

rep(F,
`    assert.ok(/<span class="bf-count" id="scCount">All games · 5 games<\\/span>/.test(all));`,
`    assert.ok(/<span class="bf-count" id="scCount">All games · 6 games<\\/span>/.test(all));`);

console.log('edited test-buy-page.js');
````

Run: `node .superpowers/tmp-edits/edit-new-slot-shop-test.js` → `edited test-buy-page.js`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-buy-new-slot-orders.js` → FAIL `AssertionError [ERR_ASSERTION]: to the order page, not order_error=sold: /buy?order_error=sold`.
Run: `node scripts/test-buy-page.js` → FAIL `AssertionError [ERR_ASSERTION]: every game with a permanent price, full ones too`.

- [ ] **Step 3: The server**

Create `.superpowers/tmp-edits/edit-new-slot-server.js`:

````js
// Task 2: a full type can still be bought permanently. The Buy shop lists it
// (set up on order), the checkout takes the order and marks it new_slot, a
// Coming Soon pre-order of a full type is marked too, and Needs you now gets
// the "New slot to add" items. Keeps server.js's BOM and CRLF.
const rep = require('./rep');
const F = 'server.js';

rep(F,
`const buyTypeSellable = computeAvailability.buyTypeSellable;
`,
`const buyTypeSellable = computeAvailability.buyTypeSellable;
const buyOption = computeAvailability.buyOption;
`);

rep(F,
`app.locals.buyTypeSellable = buyTypeSellable;
`,
`app.locals.buyTypeSellable = buyTypeSellable;
app.locals.buyOption = buyOption;
`);

// ── The Buy shop: every game with a permanent price ──
rep(F,
`      const sum = summaryMap[g.id] || null;
      // Same legacy-fullness rule game-detail.ejs's buy panel judges each type
      // against: a type that has been rented before and has no free legacy
      // slot now drops off instead of still advertising a price.
      const avail = computeAvailability(g, sum);
      const neverRented = !g.renters && !g.stocked;
      const nt = (g.buy_nt_price || 0) > 0 && buyTypeSellable(sum, 'non_trophy', { everStocked: !neverRented, avail: avail.ntAvail });
      const tr = (g.buy_tr_price || 0) > 0 && buyTypeSellable(sum, 'trophy', { everStocked: !neverRented, avail: avail.trAvail });
      return { g, nt, tr, neverRented };
    })
    .filter(x => x.nt || x.tr)
    .map(({ g, nt, tr, neverRented }) => {
      // The cheapest type that can still be bought, after the buy promo.
      const offer = [nt ? buyPricing.priceFor(g, 'nt', promo) : null, tr ? buyPricing.priceFor(g, 'tr', promo) : null]
        .filter(Boolean).sort((a, b) => a.amount - b.amount)[0];`,
`      const sum = summaryMap[g.id] || null;
      // Every type with a permanent price can be bought (lib/availability.js
      // buyOption); one with no slot to hand over now is a new slot the owner
      // adds after the sale, the same rule game-detail.ejs's buy panel uses.
      const avail = computeAvailability(g, sum);
      const neverRented = !g.renters && !g.stocked;
      const nt = buyOption(sum, 'non_trophy', { everStocked: !neverRented, avail: avail.ntAvail }, g.buy_nt_price);
      const tr = buyOption(sum, 'trophy', { everStocked: !neverRented, avail: avail.trAvail }, g.buy_tr_price);
      return { g, nt, tr, neverRented };
    })
    .filter(x => x.nt.buyable || x.tr.buyable)
    .map(({ g, nt, tr, neverRented }) => {
      // The cheapest type that can be bought, after the buy promo.
      const offer = [nt.buyable ? buyPricing.priceFor(g, 'nt', promo) : null, tr.buyable ? buyPricing.priceFor(g, 'tr', promo) : null]
        .filter(Boolean).sort((a, b) => a.amount - b.amount)[0];`);

rep(F,
`        nt: !!nt, tr: !!tr,
        // "Set up on order": never rented and not stocked — the account is made on the first sale.
        ready: !neverRented,`,
`        nt: nt.buyable, tr: tr.buyable,
        // "In stock" when a type can be handed over now and the game has been
        // stocked before. Never stocked (its account is made on the first sale)
        // or full everywhere (every type a new slot) is "Set up on order".
        ready: !neverRented && (nt.inStock || tr.inStock),`);

// ── Checkout: a full type is sold as a new slot ──
rep(F,
`  // Re-check sellability at order time, exactly as the bundle branch above does —
  // the page a customer loaded may be stale, and hiding a card is presentation
  // only. This route is what actually prevents selling an account twice, and
  // the same legacy-fullness rule the detail page's buy panel judges against.
  const slotKey = type === 'tr' ? 'trophy' : 'non_trophy';
  const buySum = gameAccountSummary(game.id);
  const buyAvail = computeAvailability(game, buySum);
  const buyNeverRented = !game.renters && !game.stocked;
  if (!buyTypeSellable(buySum, slotKey, {
    everStocked: !buyNeverRented,
    avail: type === 'tr' ? buyAvail.trAvail : buyAvail.ntAvail
  })) {
    return res.redirect('/buy?order_error=sold');
  }`,
`  // Judged again at order time — the page a customer loaded may be stale. A
  // type with no slot to hand over now is still sold: the order is marked
  // new_slot and the owner adds a slot for this game (Needs you now, Orders
  // tab). Unlike a bundle above, a single game is not one specific slot.
  const slotKey = type === 'tr' ? 'trophy' : 'non_trophy';
  const buySum = gameAccountSummary(game.id);
  const buyAvail = computeAvailability(game, buySum);
  const buyNeverRented = !game.renters && !game.stocked;
  const option = buyOption(buySum, slotKey, {
    everStocked: !buyNeverRented,
    avail: type === 'tr' ? buyAvail.trAvail : buyAvail.ntAvail
  }, base);`);

rep(F,
`      fb_name: name,
      session_id: req.sessionId || null,
      is_buy: true
    });
    res.redirect('/order/' + order.ref + '?k=' + order.url_key);
  } catch (e) {
    console.error('[order buy single]', e.message);`,
`      fb_name: name,
      session_id: req.sessionId || null,
      is_buy: true,
      ...(option.newSlot ? { new_slot: true } : {})
    });
    res.redirect('/order/' + order.ref + '?k=' + order.url_key);
  } catch (e) {
    console.error('[order buy single]', e.message);`);

// ── Coming Soon pre-order of a full type ──
rep(F,
`  let amountDue, depositDue, remainingDue, releaseDate, upcomingGameId;
  if (isBuyPreorder) {`,
`  let amountDue, depositDue, remainingDue, releaseDate, upcomingGameId;
  let newSlot = false;
  if (isBuyPreorder) {`);

rep(F,
`    depositDue = 0;
    amountDue = priced.amountDue;
    remainingDue = 0;
    releaseDate = game.release_date || '';
    upcomingGameId = game.id;`,
`    depositDue = 0;
    amountDue = priced.amountDue;
    remainingDue = 0;
    releaseDate = game.release_date || '';
    upcomingGameId = game.id;
    // No rent slot of this type left on the Coming Soon game: on release the
    // owner sets up a new slot for this buyer.
    const left = resolveUpcomingSlots(game);
    newSlot = (type === 'tr' ? left.trophy_slots : left.non_trophy_slots) === 0;`);

rep(F,
`      release_date: releaseDate,
      remaining_due: remainingDue
    };`,
`      release_date: releaseDate,
      remaining_due: remainingDue,
      ...(newSlot ? { new_slot: true } : {})
    };`);

// ── Needs you now: both places that build the bell ──
rep(F,
`    rentMismatches, paymongoHealth, supportHandoffs, now: dashNowDate
  });`,
`    rentMismatches, paymongoHealth, supportHandoffs, now: dashNowDate,
    newSlotOrders: notifications.pendingNewSlots(allOrders)
  });`);
rep(F,
`    rentMismatches, paymongoHealth, supportHandoffs, now: new Date()
  });`,
`    rentMismatches, paymongoHealth, supportHandoffs, now: new Date(),
    newSlotOrders: notifications.pendingNewSlots(allOrders)
  });`);

console.log('edited server.js');
````

Run: `node .superpowers/tmp-edits/edit-new-slot-server.js` → `edited server.js`.
Then: `file server.js` → still `UTF-8 (with BOM) text … with CRLF line terminators`.

- [ ] **Step 4: The flags and the customer's note**

Create `.superpowers/tmp-edits/edit-new-slot-views.js`:

````js
// Task 2: where a new-slot order shows — the Orders tab (Do now card and the
// ledger row) and the customer's own order page. Keeps each file's CRLF.
const rep = require('./rep');

rep('views/partials/admin/orders/needs-you.ejs',
`        <% if (o.is_buy) { %>
        <span class="oq-badge oq-badge-buy">♾️ Purchase</span>
        <% } %>`,
`        <% if (o.is_buy) { %>
        <span class="oq-badge oq-badge-buy">♾️ Purchase</span>
        <% } %>
        <% if (o.new_slot) { %>
        <span class="oq-badge oq-badge-newslot">🆕 New slot needed — add a <%= nyType(o.account_type) %> account for <%= o.game_title %></span>
        <% } %>`);

rep('views/partials/admin/orders/ledger.ejs',
`        <td class="oq-lgame"><%= o.game_title %></td>`,
`        <td class="oq-lgame"><%= o.game_title %><% if (o.new_slot) { %><span class="oq-newslot-flag"><%= ['active', 'awaiting_return', 'verifying_return', 'closed', 'cancelled', 'payment_rejected'].includes(o.state) ? '🆕 New slot' : '🆕 New slot needed — add a ' + typeLbl + ' account for ' + o.game_title %></span><% } %></td>`);

rep('views/order-status.ejs',
`  <p class="ord-sub"><%= step.sub %></p>
`,
`  <p class="ord-sub"><%= step.sub %></p>
  <% if (order.new_slot && !['active', 'closed', 'cancelled'].includes(order.state)) { %>
  <div class="ord-newslot">🆕 We're adding a new <%= order.account_type === 'tr' ? 'Trophy' : 'Non-Trophy' %> slot for you — we'll message you on Facebook when it's ready.</div>
  <% } %>
`);

rep('public/css/style.css',
`.oq-badge-buy { background:#2a0a3a; color:#d9a7f0; }
`,
`.oq-badge-buy { background:#2a0a3a; color:#d9a7f0; }
.oq-badge-newslot { background:#3a2a06; color:#fbbf24; }
.oq-newslot-flag { display: block; margin-top: 2px; font-size: 0.68rem; font-weight: 700; color: #fbbf24; }
`);

rep('public/css/style.css',
`.ord-sub { font-size: 0.9rem; color: #888; margin: 0 0 1.5rem; line-height: 1.6; }
`,
`.ord-sub { font-size: 0.9rem; color: #888; margin: 0 0 1.5rem; line-height: 1.6; }
.ord-newslot { margin: -0.75rem 0 1.25rem; padding: 0.7rem 0.9rem; background: #1a1300; border: 1px solid rgba(251,191,36,0.3); border-radius: 10px; color: #fcd34d; font-size: 0.85rem; line-height: 1.5; }
`);

console.log('edited needs-you.ejs, ledger.ejs, order-status.ejs, style.css');
````

Run: `node .superpowers/tmp-edits/edit-new-slot-views.js` → `edited needs-you.ejs, ledger.ejs, order-status.ejs, style.css`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-buy-new-slot-orders.js && node scripts/test-buy-page.js && node scripts/test-buy-new-slot.js` → `6`, `13`, `5 assertions passed`.
Run the whole suite: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"` → only `FAIL scripts/test-upcoming-psn-page-public.js`, `failed: 1`.

- [ ] **Step 6: Commit**

```bash
git add server.js views/partials/admin/orders/needs-you.ejs views/partials/admin/orders/ledger.ejs views/order-status.ejs public/css/style.css scripts/test-buy-page.js scripts/test-buy-new-slot-orders.js
git commit -m "Buy when full: sell a full type as a new slot, flag it for the owner and tell the customer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The released game page's Buy Permanent tab

**Files:**
- Create: `scripts/test-buy-new-slot-game-page.js`, `.superpowers/tmp-edits/edit-new-slot-game-page.js`
- Modify (edit script): `views/game-detail.ejs`, `public/js/game-detail.js`, `public/css/style.css`

**Interfaces:**
- Consumes: `app.locals.buyOption` (Task 2); in `views/game-detail.ejs`: `sum`, `ntNotStocked`, `trNotStocked`, `ntAvail`, `trAvail`, `hasTrophy`, `buyPromo`; `selectBuyType(type)` in `public/js/game-detail.js`; `.superpowers/tmp-edits/rep.js` (Task 1).
- Produces:
  - CSS classes `.gd-status-newslot` and `.gd-newslot-note`, and the wrapping card header (Task 4's Buy tab uses all three).
  - Element ids `buyNewSlotNote-nt` / `buyNewSlotNote-tr`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-buy-new-slot-game-page.js`:

````js
// Run: node scripts/test-buy-new-slot-game-page.js
//
// A released game's Buy Permanent tab when a type is full: the card stays
// selectable with "🆕 New slot · set up on order" and its own line instead of
// greying out, a type whose linked account was sold now shows the same way,
// the set-up-on-order note appears for the selected new-slot type, and "Nothing
// to buy right now" no longer shows while a permanent price is set. Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions); the
// project's games.json and the database are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4637;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buy-new-slot-page-'));
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const game = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', genre: 'Action', cover_image: '', non_trophy_slots: 1, trophy_slots: 1, renters: 1 }, price, extra || {});
const slots = (nt, tr) => ({ non_trophy: { enabled: true, status: nt }, trophy: { enabled: true, status: tr }, ps4_primary: { enabled: false, status: 'open' } });
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [
    game(1, 'Zzyzx Rented', { renters: 3, non_trophy_slots: 0, trophy_slots: 0, buy_nt_price: 999, buy_tr_price: 1499 }),
    game(2, 'Zzyzx Free', { renters: 2, buy_nt_price: 799, buy_tr_price: 1299 }),
    game(3, 'Zzyzx Sold', { renters: 2, buy_nt_price: 899 }),
    game(4, 'Zzyzx NoBuy', { renters: 2 })
  ],
  // Game 3's only Non-Trophy slot was sold permanently.
  accounts: [{ id: 1, label: 'Zzyzx Acc', public_name: 'Zzyzx Acc', for_sale: false, game_ids: [3], slots: slots('buyed', 'open') }]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.end();
  });
}
const buyPanel = html => {
  const i = html.indexOf('id="buyPanel"');
  assert.ok(i >= 0, 'buy panel');
  return html.slice(i, html.indexOf('<!-- /buyPanel -->', i));
};
const cardOf = (panel, id) => {
  const m = new RegExp('<div class="gd-type-card[^"]*" id="' + id + '"[\\s\\S]*?ONE-TIME</span>').exec(panel);
  assert.ok(m, id);
  return m[0];
};

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
    try { await get('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  await okAsync('every slot rented out: both cards stay buyable, tagged as a new slot', async () => {
    const panel = buyPanel((await get('/game/zzyzx-rented')).body);
    const nt = cardOf(panel, 'buyNtCard');
    assert.ok(nt.includes('onclick="selectBuyType(\'nt\')"') && !nt.includes('gd-type-disabled'));
    assert.ok(nt.includes('<span class="gd-type-status gd-status-newslot">🆕 New slot · set up on order</span>'));
    assert.ok(nt.includes('Our Non-Trophy slots are all taken — we\'ll add a brand-new one just for you.'));
    const tr = cardOf(panel, 'buyTrCard');
    assert.ok(tr.includes('onclick="selectBuyType(\'tr\')"') && tr.includes('Our Trophy slots are all taken — we\'ll add a brand-new one just for you.'));
    assert.ok(!panel.includes('Full Slot') && !panel.includes('Nothing to buy right now'));
    assert.ok(panel.includes('<form method="POST" action="/order/buy"'));
  });
  await okAsync('the set-up-on-order note, one per new-slot type, hidden until that type is picked', async () => {
    const panel = buyPanel((await get('/game/zzyzx-rented')).body);
    assert.ok(panel.includes('<div class="gd-newslot-note" id="buyNewSlotNote-tr" hidden>🆕 <strong>Set up on order:</strong> we buy a fresh Trophy slot for this game after you pay, then message you on Facebook when it\'s ready. Same price, yours forever.</div>'));
    assert.ok(panel.includes('id="buyNewSlotNote-nt" hidden'));
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game-detail.js'), 'utf8');
    assert.ok(js.includes("document.getElementById('buyNewSlotNote-' + t)"), 'selectBuyType shows the picked type\'s note');
  });
  await okAsync('a slot to hand over: no tag, no note', async () => {
    const panel = buyPanel((await get('/game/zzyzx-free')).body);
    assert.ok(!panel.includes('gd-status-newslot') && !panel.includes('gd-newslot-note'));
    assert.ok(cardOf(panel, 'buyNtCard').includes('Played on our account. No trophy tracking. One-time payment, lifetime access.'));
  });
  await okAsync('a sold linked account no longer hides the type: it is a new slot', async () => {
    const panel = buyPanel((await get('/game/zzyzx-sold')).body);
    assert.ok(cardOf(panel, 'buyNtCard').includes('🆕 New slot · set up on order'));
  });
  await okAsync('no permanent price: no Buy Permanent tab, as before', async () => {
    assert.ok(!(await get('/game/zzyzx-nobuy')).body.includes('id="buyPanel"'));
  });
  await okAsync('the new-slot styles', async () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(/\.gd-status-newslot \{[^}]*color: #fbbf24/.test(css) && /\.gd-newslot-note \{/.test(css));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-buy-new-slot-game-page.js` → FAIL `AssertionError [ERR_ASSERTION]: buyNtCard` (the full card is not buyable yet).

- [ ] **Step 3: The Buy Permanent tab**

Create `.superpowers/tmp-edits/edit-new-slot-game-page.js`:

````js
// Task 3: a released game's Buy Permanent tab — a full type stays buyable as a
// new slot (amber tag, its own line, a set-up-on-order note) instead of greying
// out. Keeps each file's CRLF.
const rep = require('./rep');
const V = 'views/game-detail.ejs';

rep.between(V,
`  // Buy is gated on slot state, not just on a price being set: an account already`,
`  const hasBuy = buyNt > 0 || buyTr > 0 || buyNtFull || buyTrFull;`,
`  // Every type with a permanent price can be bought (lib/availability.js
  // buyOption). One with no slot to hand over now — every slot rented out,
  // sold or offline — is a new slot: the owner adds one after the sale, so its
  // card says so instead of being greyed out. The checkout (POST /order/buy)
  // judges the same rule again and marks the order new_slot.
  const buyNtOpt = buyOption(sum, 'non_trophy', { everStocked: !ntNotStocked, avail: ntAvail }, game.buy_nt_price);
  const buyTrOpt = buyOption(sum, 'trophy', { everStocked: !trNotStocked, avail: trAvail }, game.buy_tr_price);
  const buyNt = buyNtOpt.buyable ? Number(game.buy_nt_price) : 0;
  const buyTr = buyTrOpt.buyable ? Number(game.buy_tr_price) : 0;
  const buyNtNew = buyNtOpt.newSlot;
  const buyTrNew = buyTrOpt.newSlot && hasTrophy;
  const hasBuy = buyNt > 0 || buyTr > 0;`);

rep.between(V,
`        <!-- NT Buy card -->`,
`            <div class="gd-type-desc" style="color:#886600;">Every Trophy slot is currently rented out — none free to hand over.</div>
          </div>
        </div>
        <% } %>
`,
`        <!-- NT Buy card — tagged as a new slot when every Non-Trophy slot is taken -->
        <% if (buyNt > 0) { %>
        <div class="gd-type-card" id="buyNtCard" onclick="selectBuyType('nt')" style="cursor:pointer;margin-bottom:0.75rem;border-color:#222;">
          <div style="display:none;"><input type="radio" name="buyType" value="nt" id="buyRadioNt"></div>
          <div class="gd-type-body">
            <div class="gd-type-header">
              <span class="gd-type-icon">🎮</span>
              <span class="gd-type-name">Non-Trophy — Permanent Access</span>
              <% if (buyNtNew) { %><span class="gd-type-status gd-status-newslot">🆕 New slot · set up on order</span><% } %>
            </div>
            <% if (buyNtNew) { %>
            <div class="gd-type-desc">Our Non-Trophy slots are all taken — we'll add a brand-new one just for you.</div>
            <% } else { %>
            <div class="gd-type-desc">Played on our account. No trophy tracking. One-time payment, lifetime access.</div>
            <% } %>
            <div style="display:flex;align-items:center;gap:0.75rem;margin-top:0.75rem;">
              <% if (buyPromo) { %>
                <span style="font-size:0.85rem;color:#555;text-decoration:line-through;">₱<%= buyNt %></span>
              <% } %>
              <span style="font-size:1.5rem;font-weight:900;color:#22c55e;">₱<%= buyNtFinal %></span>
              <span style="font-size:0.72rem;color:#555;background:#1a1a1a;padding:0.2rem 0.5rem;border-radius:20px;">ONE-TIME</span>
            </div>
          </div>
        </div>
        <% } %>

        <!-- TR Buy card — tagged as a new slot when every Trophy slot is taken -->
        <% if (buyTr > 0 && hasTrophy) { %>
        <div class="gd-type-card" id="buyTrCard" onclick="selectBuyType('tr')" style="cursor:pointer;margin-bottom:0.75rem;background:#1a1400;border-color:rgba(255,196,0,0.2);">
          <div style="display:none;"><input type="radio" name="buyType" value="tr" id="buyRadioTr"></div>
          <div class="gd-type-body">
            <div class="gd-type-header">
              <span class="gd-type-icon">🏆</span>
              <span class="gd-type-name" style="color:#ffc400;">Trophy Account — Permanent Access</span>
              <% if (buyTrNew) { %><span class="gd-type-status gd-status-newslot">🆕 New slot · set up on order</span><% } %>
            </div>
            <% if (buyTrNew) { %>
            <div class="gd-type-desc" style="color:#886600;">Our Trophy slots are all taken — we'll add a brand-new one just for you.</div>
            <% } else { %>
            <div class="gd-type-desc" style="color:#886600;">Earn trophies on your own PSN account. Play at your own pace forever.</div>
            <% } %>
            <div style="display:flex;align-items:center;gap:0.75rem;margin-top:0.75rem;">
              <% if (buyPromo) { %>
                <span style="font-size:0.85rem;color:#664d00;text-decoration:line-through;">₱<%= buyTr %></span>
              <% } %>
              <span style="font-size:1.5rem;font-weight:900;color:#ffc400;">₱<%= buyTrFinal %></span>
              <span style="font-size:0.72rem;color:#664d00;background:rgba(255,196,0,0.1);padding:0.2rem 0.5rem;border-radius:20px;">ONE-TIME</span>
            </div>
          </div>
        </div>
        <% } %>

        <!-- What a new slot means — shown by selectBuyType for the picked type only -->
        <% if (buyNtNew) { %>
        <div class="gd-newslot-note" id="buyNewSlotNote-nt" hidden>🆕 <strong>Set up on order:</strong> we buy a fresh Non-Trophy slot for this game after you pay, then message you on Facebook when it's ready. Same price, yours forever.</div>
        <% } %>
        <% if (buyTrNew) { %>
        <div class="gd-newslot-note" id="buyNewSlotNote-tr" hidden>🆕 <strong>Set up on order:</strong> we buy a fresh Trophy slot for this game after you pay, then message you on Facebook when it's ready. Same price, yours forever.</div>
        <% } %>
`);

rep('public/js/game-detail.js',
`  if (trCard) trCard.style.borderColor = type === 'tr' ? '#ffc400' : 'rgba(255,196,0,0.2)';
  const typeField = document.getElementById('buyOrderType');`,
`  if (trCard) trCard.style.borderColor = type === 'tr' ? '#ffc400' : 'rgba(255,196,0,0.2)';
  // A full type sells as a new slot: say what that means for the picked one.
  ['nt', 'tr'].forEach(t => {
    const note = document.getElementById('buyNewSlotNote-' + t);
    if (note) note.hidden = t !== type;
  });
  const typeField = document.getElementById('buyOrderType');`);

rep('public/css/style.css',
`.gd-status-notstocked { background: rgba(245,158,11,0.15); color: #f0a500; }
`,
`.gd-status-notstocked { background: rgba(245,158,11,0.15); color: #f0a500; }
.gd-status-newslot { background: rgba(251,191,36,0.14); color: #fbbf24; border: 1px solid rgba(251,191,36,0.35); }
.gd-newslot-note { margin: -0.25rem 0 1rem; padding: 0.65rem 0.85rem; background: #1a1300; border: 1px solid rgba(251,191,36,0.3); border-radius: 10px; color: #fcd34d; font-size: 0.8rem; line-height: 1.5; }
/* The new-slot tag is long: on a narrow card it drops under the name instead of squeezing it. */
#buyNtCard .gd-type-header, #buyTrCard .gd-type-header,
#udBuyNtCard .gd-type-header, #udBuyTrCard .gd-type-header { flex-wrap: wrap; }
@media (max-width: 600px) {
  #buyNtCard .gd-type-header, #buyTrCard .gd-type-header,
  #udBuyNtCard .gd-type-header, #udBuyTrCard .gd-type-header { display: grid; grid-template-columns: auto 1fr; }
  .gd-type-header > .gd-status-newslot { grid-column: 1 / -1; justify-self: start; margin-left: 0; }
}
`);

console.log('edited game-detail.ejs, game-detail.js, style.css');
````

Run: `node .superpowers/tmp-edits/edit-new-slot-game-page.js` → `edited game-detail.ejs, game-detail.js, style.css`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-buy-new-slot-game-page.js && node scripts/test-buy-new-slot-orders.js` → `6`, `6 assertions passed`.
Run the whole suite (the loop in Task 2, Step 5) → only `FAIL scripts/test-upcoming-psn-page-public.js`, `failed: 1`.

- [ ] **Step 5: Commit**

```bash
git add views/game-detail.ejs public/js/game-detail.js public/css/style.css scripts/test-buy-new-slot-game-page.js
git commit -m "Buy when full: the game page offers a full type as a new slot instead of greying it out

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Coming Soon page

**Files:**
- Create: `scripts/test-buy-new-slot-coming-soon.js`, `.superpowers/tmp-edits/edit-new-slot-coming-soon.js`
- Modify (edit script): `views/upcoming-detail.ejs`, `public/js/upcoming-detail.js`, `public/css/style.css`

**Interfaces:**
- Consumes:
  - In `views/upcoming-detail.ejs`: `udBuyNt`, `udBuyTr`, `udBuyNtFinal`, `udBuyTrFinal`, `udHasBuy`, `ntSlots`, `trSlots`, `showTr`.
  - In `public/js/upcoming-detail.js`: `selectedType`, `getSlots()`, `onTypeChange()`, `setUpcomingMode(mode)`, `selectUdBuyType(type)`.
  - `.gd-status-newslot`, `.gd-newslot-note` and the card header rules (Task 3).
  - `.superpowers/tmp-edits/rep.js` (Task 1).
- Produces:
  - Global `BUY_FINAL` (`{ nt, tr }`, 0 = none) and functions `updateOwnStrip()` and `ownInstead()`.
  - Ids `udOwnStrip`, `udOwnGo`, `udBuyNewSlotNote-nt` / `-tr`.
  - CSS `.ud-own-strip`, `.ud-own-text`, `.ud-own-go`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-buy-new-slot-coming-soon.js`:

````js
// Run: node scripts/test-buy-new-slot-coming-soon.js
//
// A Coming Soon game whose type is full: the Rent tab carries the gold "Own it
// instead" strip (filled and shown by public/js/upcoming-detail.js for a full
// type with a permanent price), the Buy Permanent tab tags that type as a new
// slot with its pre-order note, and a game with no permanent price gets
// neither. Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI,
// in-memory sessions); the project's games.json and the database are never
// touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4638;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buy-new-slot-cs-'));
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const up = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', release_date: '2099-01-01', non_trophy_slots: 2, trophy_slots: 1 }, price, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [],
  upcoming: [
    up(1, 'Zzyzx Soon', { buy_nt_price: 1299, buy_tr_price: 1999 }),
    up(2, 'Zzyzx Rent Only')
  ],
  // One Trophy reservation each: Trophy is full on both.
  customers: [
    { id: 1, customer_name: 'Zzyzx Early', game_id: 'upcoming_1', game_title: 'Zzyzx Soon', account_type: 'tr', status: 'reservation', price: 899, payments: [] },
    { id: 2, customer_name: 'Zzyzx Early', game_id: 'upcoming_2', game_title: 'Zzyzx Rent Only', account_type: 'tr', status: 'reservation', price: 899, payments: [] }
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.end();
  });
}
const slice = (html, from, to) => {
  const i = html.indexOf(from);
  assert.ok(i >= 0, from + ' found');
  return html.slice(i, html.indexOf(to, i));
};

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
  let ok = false;
  while (Date.now() < deadline) {
    try { await get('/admin/login'); ok = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(ok, 'server did not come up within 15s');

  const soon = await get('/upcoming/zzyzx-soon-1');
  assert.strictEqual(soon.status, 200);
  const page = soon.body;

  await okAsync('the Rent tab carries the "Own it instead" strip, filled in by the page script', async () => {
    const rent = slice(page, 'id="udRentPanel"', '<!-- /udRentPanel -->');
    assert.ok(rent.includes('<div class="ud-own-strip" id="udOwnStrip" hidden>'));
    assert.ok(rent.includes('<b><span class="ud-own-type"></span> is full?</b> Own it instead — we\'ll add a new <span class="ud-own-type"></span> slot for you.'));
    assert.ok(rent.includes('<button type="button" class="ud-own-go" id="udOwnGo" onclick="ownInstead()"></button>'));
    assert.ok(rent.indexOf('id="udOwnStrip"') < rent.indexOf('id="durGrid"'), 'above the durations');
    assert.ok(page.includes('const BUY_FINAL = { nt: 1299, tr: 1999 };'), 'the permanent prices it quotes');
  });
  await okAsync('the page script shows it for a full type with a permanent price and opens Buy Permanent on that type', async () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'upcoming-detail.js'), 'utf8');
    assert.ok(/function updateOwnStrip\(\)[\s\S]*getSlots\(\) === 0 && price > 0/.test(js));
    assert.ok(/'Buy ₱' \+ price \+ ' →'/.test(js));
    assert.ok(/function ownInstead\(\)[\s\S]*setUpcomingMode\('buy'\);[\s\S]*selectUdBuyType\(selectedType\);/.test(js));
    assert.ok(/function onTypeChange\(\)[\s\S]*?updateOwnStrip\(\);[\s\S]*?\n\}/.test(js), 'follows the selected type');
    assert.ok(/\nupdateOwnStrip\(\);\n/.test(js.replace(/\r\n/g, '\n')), 'set on load');
  });
  await okAsync('Buy Permanent tags the full type as a new slot, with its pre-order note', async () => {
    const buy = slice(page, 'id="udBuyPanel"', '<!-- /udBuyPanel -->');
    const tr = slice(buy, 'id="udBuyTrCard"', 'ONE-TIME');
    assert.ok(tr.includes('<span class="gd-type-status gd-status-newslot">🆕 New slot · set up on order</span>'));
    assert.ok(!slice(buy, 'id="udBuyNtCard"', 'ONE-TIME').includes('gd-status-newslot'), 'Non-Trophy still has slots');
    assert.ok(buy.includes('<div class="gd-newslot-note" id="udBuyNewSlotNote-tr" hidden>🆕 Pre-order now. On release day we set up a fresh Trophy slot for you and message you.</div>'));
    assert.ok(!buy.includes('udBuyNewSlotNote-nt'));
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'upcoming-detail.js'), 'utf8');
    assert.ok(js.includes("document.getElementById('udBuyNewSlotNote-' + t)"), 'selectUdBuyType shows the picked type\'s note');
  });
  await okAsync('no permanent price: no strip', async () => {
    const r = await get('/upcoming/zzyzx-rent-only-2');
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body.includes('id="udOwnStrip"'));
  });
  await okAsync('the strip styles', async () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(/\.ud-own-strip \{/.test(css) && /\.ud-own-strip\[hidden\] \{ display: none; \}/.test(css) && /\.ud-own-go \{/.test(css));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-buy-new-slot-coming-soon.js` → FAIL `assert.ok(rent.includes('<div class="ud-own-strip" id="udOwnStrip" hidden>'))`.

- [ ] **Step 3: The strip, the tag and the note**

Create `.superpowers/tmp-edits/edit-new-slot-coming-soon.js`:

````js
// Task 4: the Coming Soon page — a gold "Own it instead" strip on the Rent tab
// when the picked type is full and has a permanent price, and the new-slot tag
// and pre-order note on the Buy Permanent tab. Keeps each file's CRLF.
const rep = require('./rep');
const V = 'views/upcoming-detail.ejs';
const J = 'public/js/upcoming-detail.js';

rep(V,
`  const udBuyTrFinal = udBuyPromoOn ? Math.round(udBuyTr * (1 - udPromo.buy_promo_pct / 100)) : udBuyTr;
`,
`  const udBuyTrFinal = udBuyPromoOn ? Math.round(udBuyTr * (1 - udPromo.buy_promo_pct / 100)) : udBuyTr;
  // No rent slot of a type left: pre-ordering it permanently is a new slot the
  // owner sets up on release (POST /order/reserve marks the order new_slot).
  const udNtNew = udBuyNt > 0 && ntSlots === 0;
  const udTrNew = udBuyTr > 0 && showTr && trSlots === 0;
`);

rep(V,
`          <div class="gd-duration-grid" id="durGrid" style="margin-top:0.75rem;"></div>`,
`          <!-- Own it instead: shown by public/js/upcoming-detail.js (updateOwnStrip)
               when the picked type is full and has a permanent price. -->
          <% if (udHasBuy) { %>
          <div class="ud-own-strip" id="udOwnStrip" hidden>
            <span class="ud-own-icon" aria-hidden="true">🔑</span>
            <span class="ud-own-text"><b><span class="ud-own-type"></span> is full?</b> Own it instead — we'll add a new <span class="ud-own-type"></span> slot for you.</span>
            <button type="button" class="ud-own-go" id="udOwnGo" onclick="ownInstead()"></button>
          </div>
          <% } %>

          <div class="gd-duration-grid" id="durGrid" style="margin-top:0.75rem;"></div>`);

rep(V,
`                  <span class="gd-type-name">Non-Trophy — Permanent Access</span>
                </div>`,
`                  <span class="gd-type-name">Non-Trophy — Permanent Access</span>
                  <% if (udNtNew) { %><span class="gd-type-status gd-status-newslot">🆕 New slot · set up on order</span><% } %>
                </div>`);

rep(V,
`                  <span class="gd-type-name" style="color:#ffc400;">Trophy Account — Permanent Access</span>
                </div>`,
`                  <span class="gd-type-name" style="color:#ffc400;">Trophy Account — Permanent Access</span>
                  <% if (udTrNew) { %><span class="gd-type-status gd-status-newslot">🆕 New slot · set up on order</span><% } %>
                </div>`);

rep(V,
`            <div style="background:#0d0d0d;border:1px solid #1a1a1a;border-radius:10px;padding:0.85rem 1rem;margin-bottom:1.25rem;">`,
`            <!-- What a new slot means — shown by selectUdBuyType for the picked type only -->
            <% if (udNtNew) { %>
            <div class="gd-newslot-note" id="udBuyNewSlotNote-nt" hidden>🆕 Pre-order now. On release day we set up a fresh Non-Trophy slot for you and message you.</div>
            <% } %>
            <% if (udTrNew) { %>
            <div class="gd-newslot-note" id="udBuyNewSlotNote-tr" hidden>🆕 Pre-order now. On release day we set up a fresh Trophy slot for you and message you.</div>
            <% } %>

            <div style="background:#0d0d0d;border:1px solid #1a1a1a;border-radius:10px;padding:0.85rem 1rem;margin-bottom:1.25rem;">`);

rep(V,
`const TR_SLOTS   = <%= game.trophy_slots||0 %>;
</script>`,
`const TR_SLOTS   = <%= game.trophy_slots||0 %>;
// Permanent prices after the buy promo, for the "Own it instead" strip (0 = none).
const BUY_FINAL = { nt: <%= udBuyNtFinal %>, tr: <%= showTr ? udBuyTrFinal : 0 %> };
</script>`);

rep(J,
`  syncSetupPanel();
  renderDurButtons();
  updateSummary();
  updateCta();
}

function renderDurButtons() {`,
`  syncSetupPanel();
  renderDurButtons();
  updateSummary();
  updateCta();
  updateOwnStrip();
}

function renderDurButtons() {`);

rep(J,
`  if (trCard) trCard.style.borderColor = type === 'tr' ? '#ffc400' : 'rgba(255,196,0,0.2)';
  const typeField = document.getElementById('udBuyOrderType');`,
`  if (trCard) trCard.style.borderColor = type === 'tr' ? '#ffc400' : 'rgba(255,196,0,0.2)';
  // A full type is pre-ordered as a new slot: say what that means for the picked one.
  ['nt', 'tr'].forEach(t => {
    const note = document.getElementById('udBuyNewSlotNote-' + t);
    if (note) note.hidden = t !== type;
  });
  const typeField = document.getElementById('udBuyOrderType');`);

rep(J,
`// Init
const initChecked = document.querySelector('input[name="rental_type"]:checked');`,
`// ── Own it instead ── the picked type is full but has a permanent price: the
// gold strip on the Rent tab offers to buy it, and the owner adds a new slot.
// See docs/superpowers/specs/2026-10-22-buy-when-full-new-slot-design.md.
function updateOwnStrip() {
  const strip = document.getElementById('udOwnStrip');
  if (!strip) return;
  const price = BUY_FINAL[selectedType] || 0;
  const show = getSlots() === 0 && price > 0;
  strip.hidden = !show;
  if (!show) return;
  const name = selectedType === 'tr' ? 'Trophy' : 'Non-Trophy';
  strip.querySelectorAll('.ud-own-type').forEach(el => { el.textContent = name; });
  document.getElementById('udOwnGo').textContent = 'Buy ₱' + price + ' →';
}

function ownInstead() {
  setUpcomingMode('buy');
  selectUdBuyType(selectedType);
  const panel = document.getElementById('udBuyPanel');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Init
const initChecked = document.querySelector('input[name="rental_type"]:checked');`);

rep(J,
`updateSummary();
updateCta();

// ── Gameplay gallery slider ──`,
`updateSummary();
updateCta();
updateOwnStrip();

// ── Gameplay gallery slider ──`);

rep('public/css/style.css',
`.gd-status-rented { background: rgba(239,68,68,0.15); color: #ef4444; }
`,
`.gd-status-rented { background: rgba(239,68,68,0.15); color: #ef4444; }
/* Coming Soon: "Own it instead" when the picked type is full (views/upcoming-detail.ejs). */
.ud-own-strip { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.75rem; padding: 0.7rem 0.85rem; background: linear-gradient(135deg, rgba(255,196,0,0.14), rgba(255,196,0,0.04)); border: 1px solid rgba(255,196,0,0.4); border-radius: 12px; font-size: 0.82rem; color: #ddd; line-height: 1.4; }
.ud-own-strip[hidden] { display: none; }
.ud-own-strip b { color: #ffc400; }
.ud-own-text { flex: 1; min-width: 0; }
.ud-own-go { margin-left: auto; flex-shrink: 0; background: #ffc400; color: #111; border: none; border-radius: 999px; padding: 0.45rem 0.9rem; font-weight: 900; font-size: 0.8rem; cursor: pointer; white-space: nowrap; }
@media (max-width: 420px) { .ud-own-strip { flex-wrap: wrap; } .ud-own-go { margin-left: 0; width: 100%; } }
`);

console.log('edited upcoming-detail.ejs, upcoming-detail.js, style.css');
````

Run: `node .superpowers/tmp-edits/edit-new-slot-coming-soon.js` → `edited upcoming-detail.ejs, upcoming-detail.js, style.css`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-buy-new-slot-coming-soon.js && node scripts/test-buy-new-slot-game-page.js && node scripts/test-buy-new-slot-orders.js` → `5`, `6`, `6 assertions passed`.
Run the whole suite (the loop in Task 2, Step 5) → only `FAIL scripts/test-upcoming-psn-page-public.js`, `failed: 1`.

- [ ] **Step 5: Commit and clean up**

```bash
git add views/upcoming-detail.ejs public/js/upcoming-detail.js public/css/style.css scripts/test-buy-new-slot-coming-soon.js
git commit -m "Buy when full: Coming Soon offers to own a full type, tagged as a new slot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
