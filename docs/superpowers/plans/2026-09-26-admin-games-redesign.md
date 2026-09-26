# Admin Games Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the admin Games tab into four remembered sub-tabs with a 6-column game row, status/platform/sort/search filters, and customer-site-accurate slot counts. Also remove three useless form fields (Trophy switch, Available Slots total, Current Renters), make Trophy always offered, and regroup the Add/Edit game forms into five sections.

**Architecture:**
- A new pure module, `lib/games-view.js`, works out every row on the server using the customer site's own rules (`computeAvailability()`, the NEW window, the never-rented check).
- The template split into partials only draws those rows.
- A new client script, `public/js/admin-games.js`, filters, sorts and remembers state from each row's `data-*` attributes. It exposes its rules on `window.__gamesFilter` so tests can run them in a sandbox.
- This mirrors the Orders redesign (`lib` view data, `public/js/admin-orders.js`, `scripts/test-orders-template.js`).

**Tech Stack:** Node/Express 4, EJS, lowdb, vanilla browser JS, one global stylesheet. Tests are plain `node scripts/test-*.js` with `assert`.

**Spec:** `docs/superpowers/specs/2026-09-26-admin-games-redesign-design.md`

## Global Constraints

- **Sub-tab keys:** `all`, `soon`, `requests`, `categories`. Default `all`. Remembered in `localStorage` under `gamesSubtab`.
- **Filter state:** `{ chip, platform, sort, q }`, remembered in `localStorage` under `gamesFilters`.
  - Chips: `all`, `new`, `soldout`, `never`, `bundle`.
  - Platforms: `all`, `PS5`, `PS4`, `PS4/PS5`, matched exactly.
  - Sorts: `newest` (default), `az`, `earned`, `slots`.
  - `q` is capped at 100 characters.
  - **Clear** resets chip, platform and search, but not sort.
- **Messages that open a sub-tab:**
  - `added`, `updated`, `deleted` → `all`
  - `upcoming_added`, `upcoming_updated`, `upcoming_deleted`, `release_failed`, `release_in_progress` → `soon`
  - any `request_*` or `voter_*` → `requests`
  - `cat_added`, `cat_updated`, `cat_deleted` → `categories`
  - Anything else → no override.
- **Row rules, the same as the customer site:**
  - **New:** `created_at` set and `floor((now − created_at) / 1 day) < (new_window_days || 11)`. Days left = window − days since. It is urgent at ≤ 3.
  - **Never rented:** `!renters && !stocked`.
  - **Sold out:** `computeAvailability(game, accountSummaryMap[game.id], {}).totalSlots === 0`.
  - **Slot counts** come from `computeAvailability()`, so linked accounts win. The PS4 chip shows only when `showPs4` is true (platform `PS4` or `PS4/PS5`).
  - **Earned** is the sum of `price` over customers where `String(game_id) === String(game.id)`. **Profit** is earned − (`cost` || 0).
- **Exact copy:**
  - `No games yet. Use + Add New to add one.`
  - `No games match these filters.`
  - `No upcoming games. Use + Add New → Upcoming Game.`
  - `+ New category`
  - `📦 Mark as stocked` / `📦 Clear stocked`
  - Status chips: `NEW · Nd left`, `Never rented`, `Sold out`, `Stocked`
  - Requests label: `Requests (N pending)` when N > 0, else `Requests (total)`.
- **Confirm prompts are unchanged:**
  - Game Delete: `Delete <title>?`
  - Upcoming Delete: `Delete <title>?`
  - Release: `Release '<title>' to Available Games?` followed by ` N paid reservation(s) will move to sign-in.` when N > 0
- **Trophy:** `lib/availability.js` `hasTrophy` is always `true`. Add/Edit save `trophy_account: true` and `trophy_slots: parseInt(trophy_slots) || 0`. Startup migration: `if (g.trophy_account !== true) patch.trophy_account = true;`.
- **Removed form fields:** `trophy_account`, `available_slots`, `renters`.
  - Edit leaves the stored `available_slots` and `renters` untouched.
  - Add stores `renters: 0` and `available_slots` = NT + TR + PS4 slots.
- **Form sections, in this order, in both forms:** `📝 Basics`, `🎮 Slots`, `💰 Prices`, `🖼️ Images`, `🧩 Extras`. Field names and save routes are unchanged.
- **Line endings. Check with `file <path>` after every edit:**
  - `server.js`: CRLF + UTF-8 BOM. **Edit tool only.**
  - `lib/availability.js`: CRLF. **Edit tool only.**
  - `public/css/style.css`: CRLF. **Edit tool only.**
  - `views/partials/admin/games.ejs`: CRLF. Rewritten whole (Task 4) with the Write tool, then normalised with the exact command given there.
  - `views/edit.ejs`: CRLF + BOM. Rewritten whole (Task 6) the same way, with its own command.
  - Every other file touched is LF.
- **Do not change the substring `refundsOwed, releasedOrders, upcomingReservedCount, abandonedOrders`** in `server.js`: `scripts/test-release-wiring.js` checks it.
- **Never log into the real admin and never touch production data.** Browser checks use fixture-rendered static pages only.
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Work directly on `main`. Do not push.
- A full regression run is expected to show only the pre-existing `scripts/test-requests-page.js` failure.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/availability.js` | Modify | Trophy always offered |
| `scripts/test-availability.js` | Modify | +1: a switch-off game still offers Trophy |
| `scripts/test-trophy-always.js` | Create | Source checks: migration, save routes |
| `lib/games-view.js` | Create | Row data for All games and Coming soon; chip counts; request summary |
| `scripts/test-games-view.js` | Create | The row rules |
| `public/js/admin-games.js` | Create | Sub-tabs, filters, sort, memory, ⋯ outside-click, `gmOpenNewCategory()` |
| `scripts/test-admin-games-filter.js` | Create | The client rules in a no-DOM sandbox |
| `views/admin.ejs` | Modify | Loads `admin-games.js` |
| `views/partials/admin/games.ejs` | Rewrite | Shell: sub-tab row, + Add New modal, four panels |
| `views/partials/admin/games/all-games.ejs` | Create | Toolbar and game rows |
| `views/partials/admin/games/coming-soon.ejs` | Create | Upcoming rows |
| `views/partials/admin/games/requests.ejs` | Create | Requests card, moved verbatim |
| `views/partials/admin/games/categories.ejs` | Create | Categories card, moved, new-category form behind `<details>` |
| `server.js` | Modify | Migration; save routes; admin route builds `gamesView` |
| `scripts/test-games-template.js` | Create | Rendered tab checks and wiring |
| `scripts/test-release-pages.js` | Modify | Renders Coming soon through `gamesView` |
| `public/css/style.css` | Modify | `gm-*` rules; `afg-*` form-section rules |
| `views/edit.ejs` | Rewrite | Five sections, three fields removed |
| `views/add-game.ejs` | Rewrite | Five sections, three fields removed |
| `scripts/test-game-form.js` | Create | Both forms and both save routes |

---

### Task 1: Trophy is always offered

**Files:**
- Modify: `lib/availability.js` (CRLF, Edit tool only)
- Modify: `server.js` (CRLF + BOM, Edit tool only): the startup migration line, and the Trophy lines of `POST /admin/add` and `POST /admin/edit/:id`
- Modify: `scripts/test-availability.js`
- Create: `scripts/test-trophy-always.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `computeAvailability(...).hasTrophy === true` for every game. Both save routes store `trophy_account: true`.

- [ ] **Step 1: Write the failing tests**

1a. In `scripts/test-availability.js`, insert this directly above the last line (`console.log('\n' + passed + ' assertions passed\n');`):

```js
console.log('\nTrophy is always offered');

ok('a game saved with the old Trophy switch off still offers Trophy, shown as full at 0 slots', () => {
  const a = computeAvailability({ platform: 'PS5', trophy_account: false, trophy_slots: 0, non_trophy_slots: 2 }, null, {});
  assert.strictEqual(a.hasTrophy, true);
  assert.strictEqual(a.trAvail, false);
  assert.strictEqual(a.trSlots, 0);
});

```

1b. Create `scripts/test-trophy-always.js`:

```js
// Run: node scripts/test-trophy-always.js
//
// Every game has both Trophy and Non-Trophy accounts, so the Trophy switch is
// gone: saving a game always stores Trophy on, and games saved with the old
// switch off are brought into line at startup. The customer-side half (the
// site always offers Trophy) is in scripts/test-availability.js.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function route(marker) {
  const i = SRC.indexOf(marker);
  assert.ok(i >= 0, 'server.js still has ' + marker);
  const next = SRC.indexOf('\napp.', i + marker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}
const ADD_ROUTE = route("app.post('/admin/add', ");
const EDIT_ROUTE = route("app.post('/admin/edit/:id', ");

console.log('\nTrophy always on');

ok('startup brings every game to Trophy on', () => {
  assert.ok(SRC.includes('if (g.trophy_account !== true) patch.trophy_account = true;'));
  assert.ok(!SRC.includes('if (g.trophy_account === undefined) patch.trophy_account = false;'));
});

ok('Add and Edit always save Trophy on, with the slot count as typed', () => {
  [ADD_ROUTE, EDIT_ROUTE].forEach(r => {
    assert.ok(r.includes('trophy_slots: parseInt(trophy_slots) || 0,'));
    assert.ok(r.includes('trophy_account: true,'));
    assert.ok(!r.includes("trophy_account === 'on'"));
  });
});

ok('neither route reads a trophy_account field from the form', () => {
  [ADD_ROUTE, EDIT_ROUTE].forEach(r => assert.ok(!r.includes('release_date, trophy_account, trophy_slots')));
});

ok('availability no longer consults the old switch', () => {
  const lib = fs.readFileSync(path.join(ROOT, 'lib', 'availability.js'), 'utf8');
  assert.ok(!lib.includes('game.trophy_account'));
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node scripts/test-availability.js`
Expected: FAIL on `a game saved with the old Trophy switch off still offers Trophy…`.

Run: `node scripts/test-trophy-always.js`
Expected: FAIL on `startup brings every game to Trophy on`.

- [ ] **Step 3: `lib/availability.js`** (Edit tool)

Replace:

```js
  // trophy_account is an explicit admin override — must not be dropped just because
  // this game also happens to have linked accounts for other slot types.
  const hasTrophy = hasTrophyAcc || !!(game.trophy_account || (game.trophy_slots || 0) > 0);
```

with:

```js
  // Every game has both a Trophy and a Non-Trophy account, so Trophy is always
  // offered. At 0 free Trophy slots it shows as full with the waitlist, the
  // same as Non-Trophy does — it is never hidden.
  const hasTrophy = true;
```

- [ ] **Step 4: `server.js`, four edits** (Edit tool; CRLF + BOM)

4a. The startup migration. Replace:

```js
  if (g.trophy_account === undefined) patch.trophy_account = false;
```

with:

```js
  // Every game has both Trophy and Non-Trophy accounts. The switch that could
  // turn Trophy off is gone, so games saved with it off are brought into line.
  if (g.trophy_account !== true) patch.trophy_account = true;
```

4b. In `POST /admin/add`, replace:

```js
    genre, description, release_date, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    price_category_id, price_mode, cost, link_label, link_url,
```

with:

```js
    genre, description, release_date, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    price_category_id, price_mode, cost, link_label, link_url,
```

and replace:

```js
    trophy_slots: trophy_account === 'on' ? (parseInt(trophy_slots) || 1) : 0,
    trophy_account: trophy_account === 'on',
```

with:

```js
    trophy_slots: parseInt(trophy_slots) || 0,
    // Every game has both Trophy and Non-Trophy accounts.
    trophy_account: true,
```

4c. In `POST /admin/edit/:id`, replace:

```js
    genre, description, release_date, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    remove_gallery, cover_focal_x, cover_focal_y,
```

with:

```js
    genre, description, release_date, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    remove_gallery, cover_focal_x, cover_focal_y,
```

and replace:

```js
    trophy_slots: trophy_account === 'on' ? (parseInt(trophy_slots) || 0) : 0,
    trophy_account: trophy_account === 'on',
```

with:

```js
    trophy_slots: parseInt(trophy_slots) || 0,
    // Every game has both Trophy and Non-Trophy accounts.
    trophy_account: true,
```

The forms still post a `trophy_account` checkbox until Task 6 removes it; the routes now ignore it.

- [ ] **Step 5: Verify**

```bash
node scripts/test-availability.js
node scripts/test-trophy-always.js
node --check server.js
file server.js lib/availability.js
git diff --stat
```

Expected:
- `test-availability.js` ends `17 assertions passed`.
- `test-trophy-always.js` ends `4 assertions passed`.
- `node --check` prints nothing.
- `server.js` is still `UTF-8 (with BOM)` and CRLF; `lib/availability.js` is still CRLF.
- The diff stat shows roughly 10 changed lines in `server.js` and 4 in `lib/availability.js`, not hundreds.

- [ ] **Step 6: Commit**

```bash
git add lib/availability.js server.js scripts/test-availability.js scripts/test-trophy-always.js
git commit -m "$(cat <<'EOF'
Always offer Trophy: every game has both account types

The site no longer hides Trophy on a game saved with the switch off; at 0
slots it shows as full with the waitlist. Saves always store Trophy on, and
startup brings existing games into line.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Row data — `lib/games-view.js`

**Files:**
- Create: `lib/games-view.js`
- Test: `scripts/test-games-view.js`

**Interfaces:**
- Consumes: `lib/availability.js` (`computeAvailability`, unchanged signature). After Task 1 its `hasTrophy` is always true; this module does not use `hasTrophy`.
- Produces (all exported from `lib/games-view.js`):
  - `gameRows(games, customers, accountSummaryMap, now: Date) → row[]`. Each row is:
    ```
    { id, title, platform, genre, cover, categoryName, isBundle,
      slots: { nt, tr, ps4, showPs4, total },
      prices: { nt7, nt30, tr7, tr30, buyNt, buyTr },   // numbers; 0 when missing
      status: { isNew, daysLeft, neverRented, soldOut, stocked },
      chips: string[],                                  // subset of ['new','soldout','never','bundle'], in that order
      money: { earned, txns, cost, profit },
      search }                                          // lowercased "title genre category"
    ```
  - `chipCounts(rows) → { all, new, soldout, never, bundle }`
  - `upcomingRows(upcoming, reservedCount, todayManila) → row[]`. Each row is:
    ```
    { id, title, platform, cover, releaseLabel, reserved, ready, outSince,
      slots: { nt, tr }, prices: { nt7, nt30, tr7, tr30 } }
    ```
  - `requestSummary(gameRequestRows) → { total, pending }`
  - `DEFAULT_NEW_WINDOW_DAYS` (11)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-games-view.js`:

```js
// Run: node scripts/test-games-view.js
//
// The Games tab's row data (lib/games-view.js). Its flags follow the customer
// site's own rules — computeAvailability() for slots and Sold out, the NEW
// badge's window, game-detail.ejs's "not rented yet" check — so these feed it
// the same inputs the site sees.
const assert = require('assert');
const gv = require('../lib/games-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const NOW = new Date('2026-09-26T04:00:00.000Z');
// n whole days ago, plus an hour so the day count is never on a boundary.
const daysAgo = n => new Date(NOW.getTime() - n * 86400000 - 3600000).toISOString();
const GAME = over => Object.assign({
  id: 1, title: 'Tekken 8', platform: 'PS5', genre: 'Fighting', created_at: daysAgo(40),
  non_trophy_slots: 2, trophy_slots: 1, ps4_primary_slots: 0, renters: 3,
  nt_price_7d: 149, nt_price_30d: 349, tr_price_7d: 199, tr_price_30d: 399
}, over || {});
const one = (g, customers, summaries) => gv.gameRows([g], customers || [], summaries || {}, NOW)[0];

console.log('\nnew window');

ok('a game added 10 days ago is new with 1 day left', () => {
  const r = one(GAME({ created_at: daysAgo(10) }));
  assert.strictEqual(r.status.isNew, true);
  assert.strictEqual(r.status.daysLeft, 1);
  assert.ok(r.chips.includes('new'));
});

ok('on day 11 it is no longer new', () => {
  const r = one(GAME({ created_at: daysAgo(11) }));
  assert.strictEqual(r.status.isNew, false);
  assert.strictEqual(r.status.daysLeft, null);
});

ok('a custom new_window_days stretches the window', () => {
  const r = one(GAME({ created_at: daysAgo(11), new_window_days: 30 }));
  assert.strictEqual(r.status.isNew, true);
  assert.strictEqual(r.status.daysLeft, 19);
});

ok('no created_at is never new', () => {
  assert.strictEqual(one(GAME({ created_at: undefined })).status.isNew, false);
});

console.log('\nnever rented');

ok('no renters and not stocked is never rented', () => {
  const r = one(GAME({ renters: 0 }));
  assert.strictEqual(r.status.neverRented, true);
  assert.ok(r.chips.includes('never'));
});

ok('stocked or rented once clears it', () => {
  assert.strictEqual(one(GAME({ renters: 0, stocked: true })).status.neverRented, false);
  assert.strictEqual(one(GAME({ renters: 1 })).status.neverRented, false);
  assert.strictEqual(one(GAME({ renters: 0, stocked: true })).status.stocked, true);
});

console.log('\nslots and sold out');

ok('slot counts come from the hand-typed fields when there are no linked accounts', () => {
  const r = one(GAME());
  assert.deepStrictEqual([r.slots.nt, r.slots.tr, r.slots.total], [2, 1, 3]);
  assert.strictEqual(r.status.soldOut, false);
});

ok('linked accounts win over the hand-typed counts, as on the site', () => {
  const r = one(GAME({ id: 7 }), [], { 7: { non_trophy: { total: 2, available: 0 }, trophy: { total: 1, available: 0 } } });
  assert.deepStrictEqual([r.slots.nt, r.slots.tr], [0, 0]);
  assert.strictEqual(r.status.soldOut, true);
  assert.ok(r.chips.includes('soldout'));
});

ok('PS4 slots do not keep a PS5-only game off Sold out, and the PS4 chip is hidden there', () => {
  const r = one(GAME({ non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 3 }));
  assert.strictEqual(r.status.soldOut, true);
  assert.strictEqual(r.slots.showPs4, false);
  const r2 = one(GAME({ platform: 'PS4/PS5', non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 3 }));
  assert.strictEqual(r2.status.soldOut, false);
  assert.strictEqual(r2.slots.showPs4, true);
});

console.log('\nmoney');

ok('earnings add up every customer record for the game, string or numeric id', () => {
  const r = one(GAME({ id: 5, cost: 1000 }), [
    { game_id: 5, price: 349 }, { game_id: '5', price: 199 }, { game_id: 6, price: 999 }
  ]);
  assert.deepStrictEqual(r.money, { earned: 548, txns: 2, cost: 1000, profit: -452 });
});

ok('Coming Soon and PS Plus records never count toward a game', () => {
  const r = one(GAME({ id: 5 }), [{ game_id: 'upcoming_5', price: 449 }, { game_id: 'psplus', price: 299 }, { game_id: null, price: 50 }]);
  assert.deepStrictEqual([r.money.earned, r.money.txns], [0, 0]);
});

ok('no cost counts as 0', () => {
  assert.strictEqual(one(GAME({ id: 5 }), [{ game_id: 5, price: 349 }]).money.profit, 349);
});

console.log('\nrow shape');

ok('bundle and category show up in the row, its chips and its search text', () => {
  const r = one(GAME({ is_bundle: true, _category_name: 'New Games' }));
  assert.strictEqual(r.isBundle, true);
  assert.strictEqual(r.categoryName, 'New Games');
  assert.ok(r.chips.includes('bundle'));
  assert.strictEqual(r.search, 'tekken 8 fighting new games');
});

ok('missing prices become 0 and missing text becomes blank rather than throwing', () => {
  const r = gv.gameRows([{ id: 9 }], [], {}, NOW)[0];
  assert.deepStrictEqual(r.prices, { nt7: 0, nt30: 0, tr7: 0, tr30: 0, buyNt: 0, buyTr: 0 });
  assert.strictEqual(r.title, '');
  assert.strictEqual(r.cover, '');
});

ok('chip counts tally each flag', () => {
  const rows = gv.gameRows([
    GAME({ id: 1, created_at: daysAgo(2) }),
    GAME({ id: 2, renters: 0 }),
    GAME({ id: 3, non_trophy_slots: 0, trophy_slots: 0, is_bundle: true })
  ], [], {}, NOW);
  assert.deepStrictEqual(gv.chipCounts(rows), { all: 3, new: 1, soldout: 1, never: 1, bundle: 1 });
});

console.log('\nComing soon rows');

ok('ready only once a real release date is on or before today', () => {
  const rows = gv.upcomingRows([
    { id: 15, title: 'A', release_date: '2026-09-26' },
    { id: 16, title: 'B', release_date: '2026-09-27' },
    { id: 17, title: 'C', release_date: 'TBA' },
    { id: 18, title: 'D' }
  ], {}, '2026-09-26');
  assert.deepStrictEqual(rows.map(r => r.ready), [true, false, false, false]);
  assert.strictEqual(rows[0].outSince, 'Sep 26, 2026');
  assert.deepStrictEqual(rows.map(r => r.releaseLabel), ['Sep 26, 2026', 'Sep 27, 2026', 'TBA', '—']);
});

ok('reserved counts are read by id, and missing ones are 0', () => {
  const rows = gv.upcomingRows([{ id: 15, title: 'A' }, { id: 16, title: 'B' }], { '15': 3 }, '2026-09-26');
  assert.deepStrictEqual(rows.map(r => r.reserved), [3, 0]);
});

ok('the request summary counts pending separately', () => {
  assert.deepStrictEqual(gv.requestSummary([{ status: 'pending' }, { status: 'approved' }, { status: 'pending' }]), { total: 3, pending: 2 });
  assert.deepStrictEqual(gv.requestSummary(null), { total: 0, pending: 0 });
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-games-view.js`
Expected: FAIL — `Cannot find module '../lib/games-view'`

- [ ] **Step 3: Write the implementation**

Create `lib/games-view.js`:

```js
// Admin → Games tab: the row data the list renders, worked out once on the
// server so the template only draws it.
//
// The slot counts and the New / Sold out / Never rented flags use the same
// rules the customer site uses — lib/availability.js, the NEW badge's window,
// game-detail.ejs's "not rented yet" check — so the admin list can never
// disagree with what a customer sees for the same game.
const computeAvailability = require('./availability');

const DAY_MS = 86400000;
// Same default as server.js NEW_GAME_WINDOW_DAYS and the site's NEW badge.
const DEFAULT_NEW_WINDOW_DAYS = 11;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// One pass over every customer record, instead of two filter() calls per game.
// Keyed by the string id, so a numeric 7 and a string '7' land together and a
// Coming Soon ('upcoming_5') or PS Plus ('psplus') record never matches a game.
function earningsByGame(customers) {
  const map = new Map();
  (customers || []).forEach(c => {
    if (!c || c.game_id == null || c.game_id === '') return;
    const key = String(c.game_id);
    const cur = map.get(key) || { earned: 0, txns: 0 };
    cur.earned += num(c.price);
    cur.txns += 1;
    map.set(key, cur);
  });
  return map;
}

function newWindow(game, nowMs) {
  const added = game.created_at ? Date.parse(game.created_at) : NaN;
  if (!Number.isFinite(added)) return { isNew: false, daysLeft: null };
  const windowDays = game.new_window_days || DEFAULT_NEW_WINDOW_DAYS;
  const daysSince = Math.floor((nowMs - added) / DAY_MS);
  if (daysSince >= windowDays) return { isNew: false, daysLeft: null };
  return { isNew: true, daysLeft: windowDays - daysSince };
}

function gameRows(games, customers, accountSummaryMap, now) {
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const money = earningsByGame(customers);
  const summaries = accountSummaryMap || {};
  return (games || []).filter(Boolean).map(g => {
    const avail = computeAvailability(g, summaries[g.id] || null, {});
    const fresh = newWindow(g, nowMs);
    const earned = money.get(String(g.id)) || { earned: 0, txns: 0 };
    const cost = num(g.cost);
    const categoryName = g._category_name || '';
    const isBundle = !!g.is_bundle;
    const status = {
      isNew: fresh.isNew,
      daysLeft: fresh.daysLeft,
      // game-detail.ejs: `const neverRented = !game.renters && !game.stocked;`
      neverRented: !g.renters && !g.stocked,
      soldOut: avail.totalSlots === 0,
      stocked: !!g.stocked
    };
    const chips = [];
    if (status.isNew) chips.push('new');
    if (status.soldOut) chips.push('soldout');
    if (status.neverRented) chips.push('never');
    if (isBundle) chips.push('bundle');
    return {
      id: g.id,
      title: g.title || '',
      platform: g.platform || '',
      genre: g.genre || '',
      cover: g.cover_image || '',
      categoryName,
      isBundle,
      slots: { nt: avail.ntSlots, tr: avail.trSlots, ps4: avail.ps4Slots, showPs4: avail.showPs4, total: avail.totalSlots },
      prices: {
        nt7: num(g.nt_price_7d), nt30: num(g.nt_price_30d),
        tr7: num(g.tr_price_7d), tr30: num(g.tr_price_30d),
        buyNt: num(g.buy_nt_price), buyTr: num(g.buy_tr_price)
      },
      status,
      chips,
      money: { earned: earned.earned, txns: earned.txns, cost, profit: earned.earned - cost },
      search: [g.title, g.genre, categoryName].filter(Boolean).join(' ').toLowerCase()
    };
  });
}

function chipCounts(rows) {
  const counts = { all: 0, new: 0, soldout: 0, never: 0, bundle: 0 };
  (rows || []).forEach(r => {
    counts.all++;
    (r.chips || []).forEach(c => { if (counts[c] !== undefined) counts[c]++; });
  });
  return counts;
}

function formatDate(ymd) {
  const d = new Date(ymd + 'T00:00:00');
  return isNaN(d) ? ymd : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Coming soon rows. `ready` is the launch-day nudge: a real release date on
// or before today in Manila (dates compare as YYYY-MM-DD strings).
function upcomingRows(upcoming, reservedCount, todayManila) {
  const counts = reservedCount || {};
  return (upcoming || []).filter(Boolean).map(u => {
    const date = u.release_date || '';
    const isRealDate = !!date && date !== 'TBA';
    const ready = !!(todayManila && isRealDate && date <= todayManila);
    return {
      id: u.id,
      title: u.title || '',
      platform: u.platform || '',
      cover: u.cover_image || '',
      releaseLabel: date === 'TBA' ? 'TBA' : (isRealDate ? formatDate(date) : '—'),
      reserved: num(counts[u.id]),
      ready,
      outSince: ready ? formatDate(date) : '',
      slots: { nt: num(u.non_trophy_slots), tr: num(u.trophy_slots) },
      prices: { nt7: num(u.nt_price_7d), nt30: num(u.nt_price_30d), tr7: num(u.tr_price_7d), tr30: num(u.tr_price_30d) }
    };
  });
}

function requestSummary(requestRows) {
  const rows = (requestRows || []).filter(Boolean);
  return { total: rows.length, pending: rows.filter(r => r.status === 'pending').length };
}

module.exports = { DEFAULT_NEW_WINDOW_DAYS, gameRows, chipCounts, upcomingRows, requestSummary };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-games-view.js`
Expected: every line `ok - …`, ending `18 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/games-view.js scripts/test-games-view.js
git commit -m "$(cat <<'EOF'
Add lib/games-view: Games tab rows built with the site's own rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Client script — `public/js/admin-games.js`

**Files:**
- Create: `public/js/admin-games.js`
- Modify: `views/admin.ejs` (one script tag)
- Test: `scripts/test-admin-games-filter.js`

**Interfaces:**
- Consumes: nothing server-side. At run time it reads the markup Task 4 renders:
  - `#gmShell[data-msg]`
  - `[data-gm-subtab]` buttons and `[data-gm-panel]` panels
  - `#gmList` containing `[data-gm-game]` rows with `data-id`, `data-chips` (space-separated), `data-platform`, `data-s`, `data-title`, `data-earned`, `data-slots`
  - `#gmSearch`, `#gmPlatform`, `#gmSort`
  - `[data-gm-chip]` buttons
  - `#gmShowing`, `#gmShown`, `#gmHead`, `#gmNoMatch`
  - `[data-gm-clear]` links
  - `details.gm-more`
  - `details#gmNewCat`
- Produces:
  - `window.__gamesFilter = { normalizeState, rowMatches, isFiltering, compareRows, normalizeSubtab, subtabForMessage }`
  - `window.gmOpenNewCategory()`, which Task 4's + Add New modal calls.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-admin-games-filter.js`:

```js
// Run: node scripts/test-admin-games-filter.js
//
// The Games tab's filters and sub-tab memory run in the browser. This loads
// the real public/js/admin-games.js into a sandbox with no DOM (its page
// wiring is skipped when there is no document) and checks the rules it
// exposes on window.__gamesFilter.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const FILE = path.join(__dirname, '..', 'public', 'js', 'admin-games.js');

function load() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox);
  assert.ok(sandbox.__gamesFilter, 'admin-games.js exposes window.__gamesFilter');
  return sandbox.__gamesFilter;
}

const F = load();
// Objects made inside the sandbox have another realm's prototypes, so compare
// plain JSON copies rather than the objects themselves.
const plain = o => JSON.parse(JSON.stringify(o));
const st = over => F.normalizeState(Object.assign({}, over));
const row = (chips, platform, s) => ({ chips, platform, s: s || '' });
const DEFAULTS = { chip: 'all', platform: 'all', sort: 'newest', q: '' };

console.log('\nnormalizeState()');

ok('defaults to every game, every platform, newest first, no search', () => {
  assert.deepStrictEqual(plain(F.normalizeState(null)), DEFAULTS);
});

ok('throws away values it does not recognise', () => {
  assert.deepStrictEqual(plain(st({ chip: 'x', platform: 'PS3', sort: 'random', q: 5 })), DEFAULTS);
  assert.deepStrictEqual(plain(F.normalizeState('not an object')), DEFAULTS);
});

ok('keeps valid values and caps the search at 100 characters', () => {
  const s = st({ chip: 'never', platform: 'PS4/PS5', sort: 'earned', q: 'x'.repeat(150) });
  assert.strictEqual(s.chip, 'never');
  assert.strictEqual(s.platform, 'PS4/PS5');
  assert.strictEqual(s.sort, 'earned');
  assert.strictEqual(s.q.length, 100);
});

console.log('\nrowMatches()');

ok('the All chip matches every row', () => {
  assert.strictEqual(F.rowMatches(row([], 'PS5'), st({})), true);
});

ok('each chip matches only rows carrying it', () => {
  ['new', 'soldout', 'never', 'bundle'].forEach(chip => {
    const others = ['new', 'soldout', 'never', 'bundle'].filter(c => c !== chip);
    assert.strictEqual(F.rowMatches(row([chip], 'PS5'), st({ chip })), true, chip);
    assert.strictEqual(F.rowMatches(row(others, 'PS5'), st({ chip })), false, chip);
  });
});

ok('platform matches exactly — PS4 does not match PS4/PS5', () => {
  assert.strictEqual(F.rowMatches(row([], 'PS4/PS5'), st({ platform: 'PS4/PS5' })), true);
  assert.strictEqual(F.rowMatches(row([], 'PS4/PS5'), st({ platform: 'PS4' })), false);
});

ok('search is case-insensitive and ignores surrounding spaces', () => {
  assert.strictEqual(F.rowMatches(row([], 'PS5', 'ghost of yotei action'), st({ q: '  YOTEI ' })), true);
  assert.strictEqual(F.rowMatches(row([], 'PS5', 'ghost of yotei action'), st({ q: 'tekken' })), false);
});

ok('chip, platform and search combine', () => {
  const r = row(['never'], 'PS4', 'hogwarts legacy');
  assert.strictEqual(F.rowMatches(r, st({ chip: 'never', platform: 'PS4', q: 'hog' })), true);
  assert.strictEqual(F.rowMatches(r, st({ chip: 'never', platform: 'PS5', q: 'hog' })), false);
  assert.strictEqual(F.rowMatches(r, st({ chip: 'new', platform: 'PS4', q: 'hog' })), false);
});

ok('isFiltering: chip, platform or search count; sort alone does not', () => {
  assert.strictEqual(F.isFiltering(st({})), false);
  assert.strictEqual(F.isFiltering(st({ sort: 'az' })), false);
  assert.strictEqual(F.isFiltering(st({ q: '   ' })), false);
  assert.strictEqual(F.isFiltering(st({ chip: 'new' })), true);
  assert.strictEqual(F.isFiltering(st({ platform: 'PS5' })), true);
  assert.strictEqual(F.isFiltering(st({ q: 'x' })), true);
});

console.log('\ncompareRows()');

const A = { id: 1, title: 'Tekken 8', earned: 500, slots: 2 };
const B = { id: 2, title: 'Astro Bot', earned: 900, slots: 0 };
const C = { id: 3, title: 'Zelda', earned: 500, slots: 2 };
const order = sort => [A, B, C].slice().sort((a, b) => F.compareRows(a, b, sort)).map(r => r.id);

ok('newest: highest id first', () => {
  assert.deepStrictEqual(order('newest'), [3, 2, 1]);
});

ok('A–Z: by title', () => {
  assert.deepStrictEqual(order('az'), [2, 1, 3]);
});

ok('most earned: highest first, ties newest first', () => {
  assert.deepStrictEqual(order('earned'), [2, 3, 1]);
});

ok('fewest slots: lowest first, ties by title', () => {
  assert.deepStrictEqual(order('slots'), [2, 1, 3]);
});

console.log('\nsub-tabs');

ok('normalizeSubtab keeps the four keys and falls back to all', () => {
  ['all', 'soon', 'requests', 'categories'].forEach(k => assert.strictEqual(F.normalizeSubtab(k), k));
  assert.strictEqual(F.normalizeSubtab('orders'), 'all');
  assert.strictEqual(F.normalizeSubtab(null), 'all');
});

ok('each save message opens the sub-tab it belongs to', () => {
  const cases = {
    added: 'all', updated: 'all', deleted: 'all',
    upcoming_added: 'soon', upcoming_updated: 'soon', upcoming_deleted: 'soon', release_failed: 'soon', release_in_progress: 'soon',
    request_approved: 'requests', request_rejected: 'requests', request_stocked: 'requests', request_deleted: 'requests', request_image: 'requests',
    voter_renamed: 'requests', voter_removed: 'requests', voter_dupe: 'requests', voter_empty: 'requests', voter_error: 'requests',
    cat_added: 'categories', cat_updated: 'categories', cat_deleted: 'categories'
  };
  Object.keys(cases).forEach(m => assert.strictEqual(F.subtabForMessage(m), cases[m], m));
});

ok('messages that belong elsewhere, or none, leave the remembered sub-tab alone', () => {
  ['game_released', 'release_partial', 'customer_added', 'file_too_large', '', null, undefined].forEach(m => {
    assert.strictEqual(F.subtabForMessage(m), null, String(m));
  });
});

console.log('\nwiring');

ok('admin.ejs loads admin-games.js with a cache-busting ?v=', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
  assert.ok(admin.includes('<script src="/js/admin-games.js?v=<%= assetV %>"></script>'));
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-admin-games-filter.js`
Expected: FAIL — `ENOENT` for `public/js/admin-games.js`.

- [ ] **Step 3: Write the script**

Create `public/js/admin-games.js`:

```js
// Admin → Games tab: the sub-tabs (All games · Coming soon · Requests · Price
// categories) and the All games filters — status chip, platform, sort and
// search — all remembered across the reload that follows every action.
// Loaded on the admin page; the page wiring is skipped when there is no
// document (the test sandbox).
(function () {
  'use strict';

  var CHIPS = ['all', 'new', 'soldout', 'never', 'bundle'];
  var PLATFORMS = ['all', 'PS5', 'PS4', 'PS4/PS5'];
  var SORTS = ['newest', 'az', 'earned', 'slots'];
  var SUBTABS = ['all', 'soon', 'requests', 'categories'];
  var FILTER_KEY = 'gamesFilters';
  var SUBTAB_KEY = 'gamesSubtab';

  // A save lands back here with a ?msg=; the sub-tab that action belongs to
  // opens, whatever was open last.
  var MSG_SUBTAB = {
    added: 'all', updated: 'all', deleted: 'all',
    upcoming_added: 'soon', upcoming_updated: 'soon', upcoming_deleted: 'soon',
    release_failed: 'soon', release_in_progress: 'soon',
    cat_added: 'categories', cat_updated: 'categories', cat_deleted: 'categories'
  };

  // Anything read back from storage is untrusted: unknown values fall back to
  // defaults rather than filtering the list down to nothing.
  function normalizeState(raw) {
    var r = raw && typeof raw === 'object' ? raw : {};
    return {
      chip: CHIPS.indexOf(r.chip) !== -1 ? r.chip : 'all',
      platform: PLATFORMS.indexOf(r.platform) !== -1 ? r.platform : 'all',
      sort: SORTS.indexOf(r.sort) !== -1 ? r.sort : 'newest',
      q: typeof r.q === 'string' ? r.q.slice(0, 100) : ''
    };
  }

  // row: { chips: ['new', 'never', …], platform: 'PS5', s: 'lowercased search text' }
  function rowMatches(row, state) {
    if (state.chip !== 'all' && (row.chips || []).indexOf(state.chip) === -1) return false;
    if (state.platform !== 'all' && row.platform !== state.platform) return false;
    var q = String(state.q || '').trim().toLowerCase();
    return !q || String(row.s || '').indexOf(q) !== -1;
  }

  // Sort never hides a row, so it doesn't count as filtering and Clear
  // leaves it alone.
  function isFiltering(state) {
    return state.chip !== 'all' || state.platform !== 'all' || String(state.q || '').trim() !== '';
  }

  // a, b: { id, title, earned, slots }
  function compareRows(a, b, sort) {
    if (sort === 'az') return String(a.title).localeCompare(String(b.title)) || (b.id - a.id);
    if (sort === 'earned') return (b.earned - a.earned) || (b.id - a.id);
    if (sort === 'slots') return (a.slots - b.slots) || String(a.title).localeCompare(String(b.title));
    return b.id - a.id;
  }

  function normalizeSubtab(raw) {
    return SUBTABS.indexOf(raw) !== -1 ? raw : 'all';
  }

  function subtabForMessage(msg) {
    if (typeof msg !== 'string' || !msg) return null;
    if (Object.prototype.hasOwnProperty.call(MSG_SUBTAB, msg)) return MSG_SUBTAB[msg];
    // Every Requests action: approve, reject, stock, delete, cover image, and
    // the voter edits.
    if (/^(request|voter)_/.test(msg)) return 'requests';
    return null;
  }

  window.__gamesFilter = {
    normalizeState: normalizeState,
    rowMatches: rowMatches,
    isFiltering: isFiltering,
    compareRows: compareRows,
    normalizeSubtab: normalizeSubtab,
    subtabForMessage: subtabForMessage
  };

  // ── Page wiring ──────────────────────────────────────────────────────────
  if (typeof document === 'undefined' || !document.getElementById) return;

  function toArray(list) { return Array.prototype.slice.call(list); }

  function readJson(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  function writeJson(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: state just won't persist */ }
  }

  // Closes every other open ⋯ menu when one opens, and closes any open one
  // when the click lands outside all of them.
  document.addEventListener('click', function (e) {
    var clickedMore = e.target.closest && e.target.closest('.gm-more');
    toArray(document.querySelectorAll('.gm-more[open]')).forEach(function (d) {
      if (d !== clickedMore) d.open = false;
    });
  });

  var activateSubtab = function () {};

  function initSubtabs() {
    var shell = document.getElementById('gmShell');
    if (!shell) return;
    var buttons = toArray(shell.querySelectorAll('[data-gm-subtab]'));
    var panels = toArray(shell.querySelectorAll('[data-gm-panel]'));
    activateSubtab = function (key) {
      key = normalizeSubtab(key);
      buttons.forEach(function (b) {
        var on = b.getAttribute('data-gm-subtab') === key;
        b.classList.toggle('gm-subtab-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach(function (p) { p.hidden = p.getAttribute('data-gm-panel') !== key; });
      writeJson(SUBTAB_KEY, key);
    };
    buttons.forEach(function (b) {
      b.addEventListener('click', function () { activateSubtab(b.getAttribute('data-gm-subtab')); });
    });
    // views/admin.ejs strips ?msg= from the URL before this runs, so the
    // template hands it over on data-msg.
    activateSubtab(subtabForMessage(shell.getAttribute('data-msg')) || readJson(SUBTAB_KEY));
  }

  // "+ Add New → Price Category": open the categories sub-tab and its form.
  window.gmOpenNewCategory = function () {
    activateSubtab('categories');
    var form = document.getElementById('gmNewCat');
    if (!form) return;
    form.open = true;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  function initList() {
    var list = document.getElementById('gmList');
    var panel = document.querySelector('[data-gm-panel="all"]');
    var search = document.getElementById('gmSearch');
    var platformSel = document.getElementById('gmPlatform');
    var sortSel = document.getElementById('gmSort');
    if (!list || !panel || !search || !platformSel || !sortSel) return;

    var rows = toArray(list.querySelectorAll('[data-gm-game]')).map(function (el) {
      return {
        el: el,
        chips: (el.getAttribute('data-chips') || '').split(' ').filter(Boolean),
        platform: el.getAttribute('data-platform') || '',
        s: el.getAttribute('data-s') || '',
        id: Number(el.getAttribute('data-id')) || 0,
        title: el.getAttribute('data-title') || '',
        earned: Number(el.getAttribute('data-earned')) || 0,
        slots: Number(el.getAttribute('data-slots')) || 0
      };
    });
    var state = normalizeState(readJson(FILTER_KEY));

    function apply() {
      var shown = 0;
      rows.slice().sort(function (a, b) { return compareRows(a, b, state.sort); }).forEach(function (r) {
        var match = rowMatches(r, state);
        r.el.hidden = !match;
        if (match) shown++;
        list.appendChild(r.el);
      });
      toArray(panel.querySelectorAll('[data-gm-chip]')).forEach(function (c) {
        c.classList.toggle('gm-chip-on', c.getAttribute('data-gm-chip') === state.chip);
      });
      var showing = document.getElementById('gmShowing');
      var shownEl = document.getElementById('gmShown');
      var head = document.getElementById('gmHead');
      var none = document.getElementById('gmNoMatch');
      if (showing) showing.hidden = !isFiltering(state);
      if (shownEl) shownEl.textContent = String(shown);
      if (head) head.hidden = shown === 0;
      if (none) none.hidden = shown !== 0;
      list.hidden = shown === 0;
      writeJson(FILTER_KEY, state);
    }

    search.value = state.q;
    platformSel.value = state.platform;
    sortSel.value = state.sort;
    search.addEventListener('input', function () { state.q = search.value.slice(0, 100); apply(); });
    platformSel.addEventListener('change', function () { state.platform = platformSel.value; apply(); });
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; apply(); });
    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var chip = t.closest('[data-gm-chip]');
      if (chip) { state.chip = chip.getAttribute('data-gm-chip'); apply(); return; }
      if (t.closest('[data-gm-clear]')) {
        e.preventDefault();
        state = normalizeState({ sort: state.sort });
        search.value = '';
        platformSel.value = 'all';
        apply();
      }
    });
    apply();
  }

  function init() {
    initSubtabs();
    initList();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
```

- [ ] **Step 4: Load it from the admin page**

In `views/admin.ejs`, replace:

```html
<script src="/js/admin-orders.js?v=<%= assetV %>"></script>
```

with:

```html
<script src="/js/admin-orders.js?v=<%= assetV %>"></script>
<script src="/js/admin-games.js?v=<%= assetV %>"></script>
```

The Games tab markup this script reads arrives in Task 4. Until then the script finds no `#gmShell` or `#gmList` and does nothing.

- [ ] **Step 5: Run the tests**

```bash
node scripts/test-admin-games-filter.js
node scripts/test-admin-orders-filter.js
node scripts/test-admin-tabs.js
```

Expected:
- `test-admin-games-filter.js` ends `17 assertions passed`.
- The other two pass as before (20 and 10).

- [ ] **Step 6: Commit**

```bash
git add public/js/admin-games.js views/admin.ejs scripts/test-admin-games-filter.js
git commit -m "$(cat <<'EOF'
Add admin-games.js: Games sub-tabs, filters, sort and their memory

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Split and rebuild the Games tab templates

**Files:**
- Rewrite: `views/partials/admin/games.ejs` (CRLF). Write the whole file, then normalise with the command in Step 7.
- Create:
  - `views/partials/admin/games/all-games.ejs`
  - `views/partials/admin/games/coming-soon.ejs`
  - `views/partials/admin/games/requests.ejs` (extracted verbatim)
  - `views/partials/admin/games/categories.ejs` (extracted, one edit)
- Modify: `server.js` (Edit tool): the require, `gamesView`, and the render local
- Modify: `scripts/test-release-pages.js`
- Create: `scripts/test-games-template.js`

**Interfaces:**
- Consumes:
  - Task 2: `gameRows`, `chipCounts`, `upcomingRows`, `requestSummary`.
  - Task 3: the markup contract listed in Task 3's Interfaces, and `window.gmOpenNewCategory`.
- Produces:
  - The render local `gamesView = { rows, counts, upcoming, requests }`. `games.ejs` also reads the existing locals `priceCategories`, `gameRequestRows`, `games` and `msg`.
  - `games.ejs` no longer reads `customers`, `upcoming`, `upcomingReservedCount` or `todayManila`.

- [ ] **Step 1: Write the failing tests**

1a. Create `scripts/test-games-template.js`:

```js
// Run: node scripts/test-games-template.js
//
// Renders views/partials/admin/games.ejs (the shell plus the four partials
// under views/partials/admin/games/) with fixture data built by the real
// lib/games-view.js, and checks what the Games tab and
// public/js/admin-games.js rely on: the sub-tabs and their counts, each row's
// cells and data-* attributes, the ⋯ menus and their confirm prompts, the
// Coming soon rows, and that every Requests and Price category form survived
// the move.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const gv = require('../lib/games-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'views', 'partials', 'admin', 'games.ejs');
const NOW = new Date('2026-09-26T04:00:00.000Z');
const daysAgo = n => new Date(NOW.getTime() - n * 86400000 - 3600000).toISOString();

// Newest first, as the admin route sorts them.
const GAMES = [
  { id: 3, title: 'Ghost of Yōtei', platform: 'PS5', genre: 'Action', created_at: daysAgo(8), cover_image: '/uploads/goy.webp',
    non_trophy_slots: 2, trophy_slots: 1, renters: 0, nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549,
    cost: 1000, _category_name: 'New Games' },
  { id: 2, title: "Marvel's Spider-Man 2", platform: 'PS4/PS5', genre: 'Action', created_at: daysAgo(90),
    non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 1, renters: 12, stocked: true,
    nt_price_7d: 149, nt_price_30d: 349, tr_price_7d: 199, tr_price_30d: 399, buy_nt_price: 999, cost: 500 },
  { id: 1, title: 'Tekken 8', platform: 'PS5', genre: 'Fighting', created_at: daysAgo(200), is_bundle: true,
    non_trophy_slots: 0, trophy_slots: 0, renters: 8, nt_price_7d: 99, nt_price_30d: 249, tr_price_7d: 149, tr_price_30d: 299 }
];
const CUSTOMERS = [
  { game_id: 2, price: 349 }, { game_id: '2', price: 349 }, { game_id: 1, price: 249 }, { game_id: 'upcoming_15', price: 449 }
];
const UPCOMING = [
  { id: 15, title: 'Phantom Blade Zero', platform: 'PS5', release_date: '2026-09-09', non_trophy_slots: 2, trophy_slots: 1,
    nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549 }
];
const REQUESTS = [
  { slug: 'astro-bot', title: 'Astro Bot', status: 'pending', voters: [{ fb_name: 'Ana Cruz', at: '2026-09-20T00:00:00Z' }] },
  { slug: 'elden-ring', title: 'Elden Ring', status: 'approved', voters: [] }
];
const CATEGORIES = [
  { id: 1, name: 'New Games', nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549 }
];

function render(opts) {
  const o = Object.assign({ games: GAMES, upcoming: UPCOMING, requests: REQUESTS, msg: 'cat_added' }, opts || {});
  const rows = gv.gameRows(o.games, CUSTOMERS, {}, NOW);
  const gamesView = {
    rows,
    counts: gv.chipCounts(rows),
    upcoming: gv.upcomingRows(o.upcoming, { '15': 3 }, '2026-09-26'),
    requests: gv.requestSummary(o.requests)
  };
  return ejs.render(fs.readFileSync(FILE, 'utf8'), {
    gamesView, games: o.games, gameRequestRows: o.requests, priceCategories: CATEGORIES, msg: o.msg
  }, { filename: FILE });
}

// One sub-tab's markup: from its data-gm-panel attribute to the next panel.
function panel(html, key) {
  const a = html.indexOf('data-gm-panel="' + key + '"');
  assert.ok(a >= 0, 'panel ' + key);
  const b = html.indexOf('data-gm-panel="', a + 10);
  return html.slice(a, b > 0 ? b : undefined);
}
// One All games row: from its data-gm-game marker to the next row or the
// no-match line. Rows contain their own <details> ⋯ menus, so "up to the
// first closing tag" would cut a row short.
function gameRow(html, id) {
  const a = html.indexOf('data-gm-game data-id="' + id + '"');
  assert.ok(a >= 0, 'row ' + id);
  const ends = ['data-gm-game data-id="', 'id="gmNoMatch"'].map(m => html.indexOf(m, a + 10)).filter(i => i > 0);
  return html.slice(a, Math.min(...ends));
}

const html = render();

console.log('\nsub-tabs');

ok('four sub-tabs with their counts, All games selected and shown first', () => {
  assert.ok(html.includes('data-gm-subtab="all" aria-selected="true">All games <span class="gm-subtab-n">(3)</span>'));
  assert.ok(html.includes('data-gm-subtab="soon" aria-selected="false">Coming soon <span class="gm-subtab-n">(1)</span>'));
  assert.ok(html.includes('data-gm-subtab="requests" aria-selected="false">Requests <span class="gm-subtab-n">(1 pending)</span>'));
  assert.ok(html.includes('data-gm-subtab="categories" aria-selected="false">Price categories <span class="gm-subtab-n">(1)</span>'));
  assert.ok(html.includes('data-gm-panel="all">'));
  ['soon', 'requests', 'categories'].forEach(k => assert.ok(html.includes('data-gm-panel="' + k + '" hidden>'), k));
});

ok('Requests shows its total when nothing is pending', () => {
  assert.ok(render({ requests: [REQUESTS[1]] }).includes('Requests <span class="gm-subtab-n">(1)</span>'));
});

ok("this load's message rides along for the sub-tab script", () => {
  assert.ok(html.includes('id="gmShell" data-msg="cat_added"'));
  assert.ok(render({ msg: null }).includes('id="gmShell" data-msg=""'));
});

ok('+ Add New → Price Category opens the categories form instead of scrolling to it', () => {
  assert.ok(html.includes('window.gmOpenNewCategory()'));
  assert.ok(!html.includes('#add-category-form'));
});

console.log('\nAll games');

ok('toolbar: search, five chips with counts, platform and sort', () => {
  const p = panel(html, 'all');
  assert.ok(p.includes('id="gmSearch"'));
  [['all', 'All', 3], ['new', '🆕 New', 1], ['soldout', '⛔ Sold out', 1], ['never', '💤 Never rented', 1], ['bundle', '📦 Bundles', 1]]
    .forEach(([k, label, n]) => assert.ok(p.includes('data-gm-chip="' + k + '">' + label + ' <span class="gm-chip-n">' + n + '</span>'), k));
  assert.ok(p.includes('<select id="gmPlatform"'));
  ['all', 'PS5', 'PS4', 'PS4/PS5'].forEach(v => assert.ok(p.includes('<option value="' + v + '">'), v));
  assert.ok(p.includes('<select id="gmSort"'));
  ['newest', 'az', 'earned', 'slots'].forEach(v => assert.ok(p.includes('<option value="' + v + '">'), v));
});

ok('rows arrive newest first, each carrying the data the filter script reads', () => {
  const ids = [...html.matchAll(/data-gm-game data-id="(\d+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(ids, ['3', '2', '1']);
  assert.ok(gameRow(html, 3).includes('data-chips="new never" data-platform="PS5" data-s="ghost of yōtei action new games" data-title="Ghost of Yōtei" data-earned="0" data-slots="3"'));
  assert.ok(gameRow(html, 2).includes('data-chips="" data-platform="PS4/PS5"'));
});

ok('game cell: cover, title, platform · genre, category and bundle tags', () => {
  const r3 = gameRow(html, 3);
  assert.ok(r3.includes('<img src="/uploads/goy.webp" class="gm-cover"'));
  assert.ok(r3.includes('class="gm-title">Ghost of Yōtei<'));
  assert.ok(r3.includes('class="gm-sub">PS5 · Action<'));
  assert.ok(r3.includes('🏷️ New Games'));
  assert.ok(!r3.includes('gm-tag-bundle'));
  assert.ok(gameRow(html, 1).includes('class="gm-tag gm-tag-bundle">📦 Bundle<'));
  assert.ok(gameRow(html, 1).includes('class="gm-cover gm-cover-ph">🎮<'));
});

ok('slot chips go red at 0, and PS4 shows only on a PS4 platform', () => {
  const r2 = gameRow(html, 2);
  assert.ok(r2.includes('class="gm-slot gm-slot-zero">NT 0<'));
  assert.ok(r2.includes('class="gm-slot gm-slot-tr gm-slot-zero">TR 0<'));
  assert.ok(r2.includes('class="gm-slot">PS4 1<'));
  const r3 = gameRow(html, 3);
  assert.ok(r3.includes('class="gm-slot">NT 2<'));
  assert.ok(r3.includes('class="gm-slot gm-slot-tr">TR 1<'));
  assert.ok(!r3.includes('>PS4 '));
});

ok('prices: weekly / monthly for NT and TR, and a Buy line only when a buy price is set', () => {
  const r3 = gameRow(html, 3);
  assert.ok(r3.includes('<div>NT ₱199 / ₱449</div>'));
  assert.ok(r3.includes('<div class="gm-tr">TR ₱249 / ₱549</div>'));
  assert.ok(!r3.includes('gm-buy'));
  assert.ok(gameRow(html, 2).includes('<div class="gm-buy">Buy NT ₱999</div>'));
});

ok('status chips: New with days left (urgent at 3 or fewer), Never rented, Sold out, Stocked', () => {
  const r3 = gameRow(html, 3);
  assert.ok(r3.includes('class="gm-st gm-st-new gm-st-urgent">NEW · 3d left<'));
  assert.ok(r3.includes('class="gm-st gm-st-never">Never rented<'));
  assert.ok(gameRow(html, 2).includes('class="gm-st gm-st-stocked">Stocked<'));
  assert.ok(!gameRow(html, 2).includes('Sold out'));
  assert.ok(gameRow(html, 1).includes('class="gm-st gm-st-sold">Sold out<'));
});

ok('money: earned with its transactions, then profit or loss', () => {
  const r2 = gameRow(html, 2);
  assert.ok(r2.includes('₱698 earned <span class="gm-txns">2 txns</span>'));
  assert.ok(r2.includes('<div class="gm-profit">+₱198 profit</div>'));
  assert.ok(gameRow(html, 1).includes('<span class="gm-txns">1 txn</span>'));
  assert.ok(gameRow(html, 3).includes('<div class="gm-profit gm-loss">₱1,000 at a loss</div>'));
});

ok('actions: Edit, and ⋯ holding Stock and Delete with the old confirm prompt', () => {
  const r2 = gameRow(html, 2);
  assert.ok(r2.includes('<a href="/admin/edit/2" class="gm-btn">✏️ Edit</a>'));
  const menu = r2.slice(r2.indexOf('class="gm-more-menu"'));
  assert.ok(menu.includes('action="/admin/games/2/stocked"'));
  assert.ok(menu.includes('📦 Clear stocked'));
  assert.ok(menu.includes('action="/admin/delete/2" onsubmit="return confirm(\'Delete Marvel\\&#39;s Spider-Man 2?\')"'));
  assert.ok(gameRow(html, 3).includes('📦 Mark as stocked'));
});

ok('an empty library and an over-filtered list each get their own line', () => {
  assert.ok(html.includes('id="gmNoMatch" hidden>No games match these filters.'));
  const none = render({ games: [] });
  assert.ok(panel(none, 'all').includes('No games yet. Use + Add New to add one.'));
  assert.ok(!none.includes('id="gmList"'));
});

console.log('\nComing soon');

ok('rows keep the reserved count and the ready-to-release nudge', () => {
  const p = panel(html, 'soon');
  assert.ok(p.includes('class="gm-title">Phantom Blade Zero<'));
  assert.ok(p.includes('<div class="gm-cs-reserved">3 reserved</div>'));
  assert.ok(p.includes('📅 Out since Sep 9, 2026 — ready to release'));
  assert.ok(p.includes('<div class="gm-c-release">Sep 9, 2026</div>'));
});

ok('Release keeps its exact confirm prompt; Edit and Delete sit behind ⋯', () => {
  const p = panel(html, 'soon');
  assert.ok(p.includes("onsubmit=\"return confirm('Release \\'Phantom Blade Zero\\' to Available Games? 3 paid reservations will move to sign-in.')\""));
  const menu = p.slice(p.indexOf('class="gm-more-menu"'));
  assert.ok(menu.includes('href="/admin/upcoming/edit/15"'));
  assert.ok(menu.includes("action=\"/admin/upcoming/delete/15\" onsubmit=\"return confirm('Delete Phantom Blade Zero?')\""));
});

ok('no upcoming games shows the empty line', () => {
  assert.ok(panel(render({ upcoming: [] }), 'soon').includes('No upcoming games. Use + Add New → Upcoming Game.'));
});

console.log('\nRequests and Price categories');

ok('every Requests form, route and confirm prompt survived the move', () => {
  const p = panel(html, 'requests');
  ['/admin/requests/astro-bot/approve', '/admin/requests/astro-bot/reject', '/admin/requests/astro-bot/delete',
   '/admin/requests/astro-bot/image', '/admin/requests/astro-bot/voter/rename', '/admin/requests/astro-bot/voter/remove',
   '/admin/requests/elden-ring/stock']
    .forEach(a => assert.ok(p.includes('action="' + a + '"'), a));
  assert.ok(p.includes("confirm('Remove this vote?')"));
  assert.ok(p.includes("confirm('Delete this request permanently?')"));
  assert.ok(p.includes('<option value="3">Ghost of Yōtei</option>'));
});

ok('the category list is unchanged and the new-category form waits behind + New category', () => {
  const p = panel(html, 'categories');
  assert.ok(p.includes('action="/admin/price-categories/edit/1"'));
  assert.ok(p.includes('<details class="gm-newcat" id="gmNewCat">'));
  assert.ok(p.includes('<summary class="gm-newcat-btn">+ New category</summary>'));
  assert.ok(p.indexOf('action="/admin/price-categories/add"') > p.indexOf('id="gmNewCat"'));
});

console.log('\nwiring');

ok('server.js builds gamesView once and hands it to the admin page', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(SRC.includes("const gamesViewLib = require('./lib/games-view');"));
  assert.ok(SRC.includes('gamesViewLib.gameRows(games, customers, buildAccountSummaryMap(), new Date())'));
  assert.ok(SRC.includes('templateTokens: templates.TOKENS, gamesView, orderQueue,'));
});

ok('the old inline filter script and jump links are gone from the Games tab', () => {
  const src = fs.readFileSync(FILE, 'utf8');
  ['filterGamesPlatform', 'applyGameFilter', 'toggleGamesNewOnly', 'adm-jump'].forEach(s => assert.ok(!src.includes(s), s));
});

console.log('\n' + passed + ' assertions passed\n');
```

1b. `scripts/test-release-pages.js` renders the Coming soon rows, which now come from `gamesView` and are no longer table rows. Update it on purpose.

After the line `const ejs = require('ejs');`, add:

```js
const gamesViewLib = require('../lib/games-view');
```

Then replace:

```js
  const locals = Object.assign({
    games: [], customers: [], upcoming, gameRequestRows: [], priceCategories: [],
    upcomingReservedCount: { '15': 3, '16': 1 }, todayManila: '2026-09-26'
  }, over || {});
  return ejs.render(fs.readFileSync(GAMES, 'utf8'), locals, { filename: GAMES });
}
function row(html, title) {
  const i = html.indexOf('<strong>' + title);
  assert.ok(i >= 0, 'row for ' + title);
  const end = html.indexOf('</tr>', i);
  return html.slice(i, end);
}
```

with:

```js
  // The rows come from lib/games-view.js, exactly as the admin route builds them.
  const locals = Object.assign({
    gamesView: {
      rows: [],
      counts: gamesViewLib.chipCounts([]),
      upcoming: gamesViewLib.upcomingRows(upcoming, { '15': 3, '16': 1 }, '2026-09-26'),
      requests: gamesViewLib.requestSummary([])
    },
    games: [], gameRequestRows: [], priceCategories: [], msg: null
  }, over || {});
  return ejs.render(fs.readFileSync(GAMES, 'utf8'), locals, { filename: GAMES });
}
// One Coming soon row: from the row element holding this title to the next
// row or the next sub-tab panel.
function row(html, title) {
  const i = html.indexOf('class="gm-title">' + title + '<');
  assert.ok(i >= 0, 'row for ' + title);
  const start = html.lastIndexOf('class="gm-row', i);
  const ends = ['class="gm-row', 'data-gm-panel="'].map(m => html.indexOf(m, i)).filter(n => n > 0);
  return html.slice(start, ends.length ? Math.min(...ends) : undefined);
}
```

Its six assertions are unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `node scripts/test-games-template.js`
Expected: FAIL — `gamesView is not defined` (the old template doesn't read it) or the first sub-tab assertion.

Run: `node scripts/test-release-pages.js`
Expected: FAIL on `row for Phantom Blade Zero`.

- [ ] **Step 3: Extract Requests and Price categories verbatim**

Run this from the repo root **before** rewriting `games.ejs`. It copies the two blocks out of the current file unchanged, with LF line endings:

```bash
mkdir -p views/partials/admin/games
node -e "
const fs = require('fs');
const s = fs.readFileSync('views/partials/admin/games.ejs', 'utf8').replace(/\r\n/g, '\n');
const cut = (from, to) => { const a = s.indexOf(from); const b = s.indexOf(to, a); if (a < 0 || b < 0) throw new Error('marker missing: ' + from); return s.slice(a, b); };
fs.writeFileSync('views/partials/admin/games/requests.ejs', cut('<div class=\"adm-card\" id=\"sec-requests\">', '    <!-- GAMES TABLE -->').trimEnd() + '\n');
fs.writeFileSync('views/partials/admin/games/categories.ejs', cut('<div class=\"adm-card\" id=\"sec-categories\">', '<!-- /accordion price-cat -->') + '<!-- /accordion price-cat -->\n');
"
head -1 views/partials/admin/games/requests.ejs views/partials/admin/games/categories.ejs
```

Expected: `requests.ejs` starts `<div class="adm-card" id="sec-requests">` and `categories.ejs` starts `<div class="adm-card" id="sec-categories">`.

- [ ] **Step 4: Put the new-category form behind + New category**

In `views/partials/admin/games/categories.ejs`, replace:

```ejs
            <div style="background:#0a0a0a;border:1px solid #1c1c1c;border-radius:10px;padding:0.9rem 1rem;">
        <div style="font-weight:700;font-size:0.85rem;color:#fff;margin-bottom:0.85rem;">🏷️ New price category</div>
        <div style="padding:1rem;border-top:1px dashed #1a3a1a;">
```

with:

```ejs
      <%# Closed until needed: seven fields the owner fills in rarely. + Add New
          → Price Category opens it (window.gmOpenNewCategory). %>
      <details class="gm-newcat" id="gmNewCat">
        <summary class="gm-newcat-btn">+ New category</summary>
        <div style="padding:1rem;border-top:1px dashed #1a3a1a;">
```

and replace:

```ejs
              <button type="submit" class="btn btn-primary" style="background:#166534;">Create Category</button>
            </div>
          </form>
        </div>
            </div>
```

with:

```ejs
              <button type="submit" class="btn btn-primary" style="background:#166534;">Create Category</button>
            </div>
          </form>
        </div>
      </details>
```

- [ ] **Step 5: Create `views/partials/admin/games/all-games.ejs`**

```ejs
<%#
  All games: one row per game. The row data comes from lib/games-view.js
  (gamesView.rows); public/js/admin-games.js filters and sorts these rows by
  their data-* attributes and remembers the choice.
%>
<%
  const gmRows = gamesView.rows;
  const gmCounts = gamesView.counts;
  const gmPeso = v => v ? '₱' + Number(v).toLocaleString() : '₱—';
  const gmChips = [['all', 'All'], ['new', '🆕 New'], ['soldout', '⛔ Sold out'], ['never', '💤 Never rented'], ['bundle', '📦 Bundles']];
%>
<div class="gm-toolbar">
  <input type="search" id="gmSearch" class="gm-search" placeholder="Search title, genre or category…" maxlength="100" autocomplete="off">
  <div class="gm-chips">
    <% gmChips.forEach(([key, label]) => { %>
    <button type="button" class="gm-chip<%= key === 'all' ? ' gm-chip-on' : '' %>" data-gm-chip="<%= key %>"><%= label %> <span class="gm-chip-n"><%= gmCounts[key] %></span></button>
    <% }) %>
  </div>
  <select id="gmPlatform" class="gm-select" aria-label="Platform">
    <option value="all">All platforms</option>
    <option value="PS5">PS5</option>
    <option value="PS4">PS4</option>
    <option value="PS4/PS5">PS4/PS5</option>
  </select>
  <select id="gmSort" class="gm-select" aria-label="Sort">
    <option value="newest">Newest</option>
    <option value="az">A–Z</option>
    <option value="earned">Most earned</option>
    <option value="slots">Fewest slots left</option>
  </select>
</div>
<div class="gm-showing" id="gmShowing" hidden>Showing <span id="gmShown"><%= gmRows.length %></span> of <%= gmRows.length %> · <a href="#" data-gm-clear>Clear</a></div>

<% if (!gmRows.length) { %>
<div class="gm-empty">No games yet. Use + Add New to add one.</div>
<% } else { %>
<div class="gm-head gm-grid" id="gmHead" aria-hidden="true"><span>Game</span><span>Slots left</span><span>Prices (wk / mo)</span><span>Status</span><span>Money</span><span></span></div>
<div class="gm-list" id="gmList">
  <% gmRows.forEach(r => { %>
  <div class="gm-row gm-grid" data-gm-game data-id="<%= r.id %>" data-chips="<%= r.chips.join(' ') %>" data-platform="<%= r.platform %>" data-s="<%= r.search %>" data-title="<%= r.title %>" data-earned="<%= r.money.earned %>" data-slots="<%= r.slots.total %>">
    <div class="gm-c-game">
      <% if (r.cover) { %><img src="<%= r.cover %>" class="gm-cover" alt="" loading="lazy"><% } else { %><div class="gm-cover gm-cover-ph">🎮</div><% } %>
      <div class="gm-name">
        <div class="gm-title"><%= r.title %></div>
        <div class="gm-sub"><%= r.platform %><%= r.genre ? ' · ' + r.genre : '' %></div>
        <% if (r.categoryName || r.isBundle) { %>
        <div class="gm-tags">
          <% if (r.categoryName) { %><span class="gm-tag">🏷️ <%= r.categoryName %></span><% } %>
          <% if (r.isBundle) { %><span class="gm-tag gm-tag-bundle">📦 Bundle</span><% } %>
        </div>
        <% } %>
      </div>
    </div>
    <div class="gm-c-slots">
      <span class="gm-slot<%= r.slots.nt ? '' : ' gm-slot-zero' %>">NT <%= r.slots.nt %></span>
      <span class="gm-slot gm-slot-tr<%= r.slots.tr ? '' : ' gm-slot-zero' %>">TR <%= r.slots.tr %></span>
      <% if (r.slots.showPs4) { %><span class="gm-slot<%= r.slots.ps4 ? '' : ' gm-slot-zero' %>">PS4 <%= r.slots.ps4 %></span><% } %>
    </div>
    <div class="gm-c-prices">
      <div>NT <%= gmPeso(r.prices.nt7) %> / <%= gmPeso(r.prices.nt30) %></div>
      <div class="gm-tr">TR <%= gmPeso(r.prices.tr7) %> / <%= gmPeso(r.prices.tr30) %></div>
      <% if (r.prices.buyNt > 0 || r.prices.buyTr > 0) { %><div class="gm-buy">Buy <%= [r.prices.buyNt > 0 ? 'NT ' + gmPeso(r.prices.buyNt) : '', r.prices.buyTr > 0 ? 'TR ' + gmPeso(r.prices.buyTr) : ''].filter(Boolean).join(' · ') %></div><% } %>
    </div>
    <div class="gm-c-status">
      <% if (r.status.isNew) { %><span class="gm-st gm-st-new<%= r.status.daysLeft <= 3 ? ' gm-st-urgent' : '' %>">NEW · <%= r.status.daysLeft %>d left</span><% } %>
      <% if (r.status.neverRented) { %><span class="gm-st gm-st-never">Never rented</span><% } %>
      <% if (r.status.soldOut) { %><span class="gm-st gm-st-sold">Sold out</span><% } %>
      <% if (r.status.stocked) { %><span class="gm-st gm-st-stocked">Stocked</span><% } %>
      <% if (!r.status.isNew && !r.status.neverRented && !r.status.soldOut && !r.status.stocked) { %><span class="gm-dash">—</span><% } %>
    </div>
    <div class="gm-c-money">
      <div class="gm-earned">₱<%= r.money.earned.toLocaleString() %> earned <span class="gm-txns"><%= r.money.txns %> txn<%= r.money.txns === 1 ? '' : 's' %></span></div>
      <% if (r.money.profit >= 0) { %><div class="gm-profit">+₱<%= r.money.profit.toLocaleString() %> profit</div><% } else { %><div class="gm-profit gm-loss">₱<%= Math.abs(r.money.profit).toLocaleString() %> at a loss</div><% } %>
    </div>
    <div class="gm-c-actions">
      <a href="/admin/edit/<%= r.id %>" class="gm-btn">✏️ Edit</a>
      <details class="gm-more">
        <summary class="gm-more-btn" title="More actions" aria-label="More actions">⋯</summary>
        <div class="gm-more-menu">
          <form method="POST" action="/admin/games/<%= r.id %>/stocked">
            <button type="submit" class="gm-more-item"><%= r.status.stocked ? '📦 Clear stocked' : '📦 Mark as stocked' %></button>
          </form>
          <form method="POST" action="/admin/delete/<%= r.id %>" onsubmit="return confirm('Delete <%= r.title.replace(/'/g, "\\'") %>?')">
            <button type="submit" class="gm-more-item gm-more-danger">🗑 Delete</button>
          </form>
        </div>
      </details>
    </div>
  </div>
  <% }) %>
</div>
<div class="gm-empty" id="gmNoMatch" hidden>No games match these filters. <a href="#" data-gm-clear>Clear</a></div>
<% } %>
```

- [ ] **Step 6: Create `views/partials/admin/games/coming-soon.ejs`**

```ejs
<%#
  Coming soon: upcoming games in the same row style as All games. The row
  data, including the reserved count and the ready-to-release nudge, comes
  from lib/games-view.js upcomingRows().
%>
<%
  const csRows = gamesView.upcoming;
  const csPeso = v => v ? '₱' + v : '₱—';
%>
<% if (!csRows.length) { %>
<div class="gm-empty">No upcoming games. Use + Add New → Upcoming Game.</div>
<% } else { %>
<div class="gm-head gm-grid-soon" aria-hidden="true"><span>Game</span><span>Release</span><span>Slots</span><span>Prices (wk / mo)</span><span></span></div>
<div class="gm-list">
  <% csRows.forEach(u => { %>
  <div class="gm-row gm-grid-soon" data-gm-soon data-id="<%= u.id %>">
    <div class="gm-c-game">
      <% if (u.cover) { %><img src="<%= u.cover %>" class="gm-cover" alt="" loading="lazy"><% } else { %><div class="gm-cover gm-cover-ph gm-cover-soon">🔜</div><% } %>
      <div class="gm-name">
        <div class="gm-title"><%= u.title %></div>
        <div class="gm-sub"><%= u.platform %> · <span class="gm-soon-tag">Coming soon</span></div>
        <% if (u.reserved) { %><div class="gm-cs-reserved"><%= u.reserved %> reserved</div><% } %>
        <% if (u.ready) { %><div class="gm-cs-ready">📅 Out since <%= u.outSince %> — ready to release</div><% } %>
      </div>
    </div>
    <div class="gm-c-release"><%= u.releaseLabel %></div>
    <div class="gm-c-slots">
      <span class="gm-slot<%= u.slots.nt ? '' : ' gm-slot-zero' %>">NT <%= u.slots.nt %></span>
      <span class="gm-slot gm-slot-tr<%= u.slots.tr ? '' : ' gm-slot-zero' %>">TR <%= u.slots.tr %></span>
    </div>
    <div class="gm-c-prices">
      <% if (u.prices.nt7 || u.prices.nt30) { %><div>NT <%= csPeso(u.prices.nt7) %> / <%= csPeso(u.prices.nt30) %></div><% } %>
      <% if (u.prices.tr7 || u.prices.tr30) { %><div class="gm-tr">TR <%= csPeso(u.prices.tr7) %> / <%= csPeso(u.prices.tr30) %></div><% } %>
      <% if (!(u.prices.nt7 || u.prices.nt30 || u.prices.tr7 || u.prices.tr30)) { %><span class="gm-dash">—</span><% } %>
    </div>
    <div class="gm-c-actions">
      <form method="POST" action="/admin/upcoming/release/<%= u.id %>" onsubmit="return confirm('Release \'<%= u.title.replace(/'/g, "\\'") %>\' to Available Games?<%= u.reserved ? ' ' + u.reserved + ' paid reservation' + (u.reserved === 1 ? '' : 's') + ' will move to sign-in.' : '' %>')">
        <button type="submit" class="gm-btn gm-btn-release">🚀 Release</button>
      </form>
      <details class="gm-more">
        <summary class="gm-more-btn" title="More actions" aria-label="More actions">⋯</summary>
        <div class="gm-more-menu">
          <a href="/admin/upcoming/edit/<%= u.id %>" class="gm-more-item">✏️ Edit</a>
          <form method="POST" action="/admin/upcoming/delete/<%= u.id %>" onsubmit="return confirm('Delete <%= u.title.replace(/'/g, "\\'") %>?')">
            <button type="submit" class="gm-more-item gm-more-danger">🗑 Delete</button>
          </form>
        </div>
      </details>
    </div>
  </div>
  <% }) %>
</div>
<% } %>
```

- [ ] **Step 7: Rewrite the shell `views/partials/admin/games.ejs`**

Replace the whole file (Write tool) with:

```ejs
  <div class="tab-panel" id="tab-games">
<%#
  Games tab: a sub-tab row and one panel per sub-tab. Row data comes from
  lib/games-view.js (gamesView). public/js/admin-games.js switches the
  sub-tabs and runs the All games filters. data-msg carries this load's ?msg=
  because views/admin.ejs strips it from the URL before that script runs.
%>
<%
  const gmReq = gamesView.requests;
  const gmSubtabs = [
    ['all', 'All games', '(' + gamesView.rows.length + ')'],
    ['soon', 'Coming soon', '(' + gamesView.upcoming.length + ')'],
    ['requests', 'Requests', gmReq.pending ? '(' + gmReq.pending + ' pending)' : '(' + gmReq.total + ')'],
    ['categories', 'Price categories', '(' + priceCategories.length + ')']
  ];
%>
    <div class="gm-shell" id="gmShell" data-msg="<%= typeof msg !== 'undefined' && msg ? msg : '' %>">
      <div class="gm-top">
        <div class="gm-subtabs" role="tablist">
          <% gmSubtabs.forEach(([key, label, n], i) => { %>
          <button type="button" class="gm-subtab<%= i === 0 ? ' gm-subtab-on' : '' %>" role="tab" data-gm-subtab="<%= key %>" aria-selected="<%= i === 0 ? 'true' : 'false' %>"><%= label %> <span class="gm-subtab-n"><%= n %></span></button>
          <% }) %>
        </div>
        <button type="button" class="gm-add" onclick="document.getElementById('addChoiceModal').classList.add('open')">+ Add New</button>
      </div>

      <!-- Choice Modal -->
      <div class="add-choice-overlay" id="addChoiceModal" onclick="if(event.target===this)this.classList.remove('open')">
        <div class="add-choice-box">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-weight:800;font-size:1.1rem;color:#fff;">What do you want to add?</span>
            <button onclick="document.getElementById('addChoiceModal').classList.remove('open')" style="background:none;border:none;color:#555;font-size:1.4rem;cursor:pointer;line-height:1;">✕</button>
          </div>
          <div class="add-choice-grid">
            <a class="add-choice-card" href="/admin/add/game">
              <span class="icon">🎮</span>
              <span class="label">New Game</span>
              <span class="desc">A rentable PS5 or PS4 title</span>
            </a>
            <a class="add-choice-card" href="/admin/add/game?bundle=1">
              <span class="icon">📦</span>
              <span class="label">Bundle</span>
              <span class="desc">One entry standing in for a whole account</span>
            </a>
            <a class="add-choice-card" href="/admin/add/upcoming">
              <span class="icon">🔜</span>
              <span class="label">Upcoming Game</span>
              <span class="desc">Not released yet — open for reservations</span>
            </a>
            <a class="add-choice-card" href="#" onclick="document.getElementById('addChoiceModal').classList.remove('open'); if (window.gmOpenNewCategory) window.gmOpenNewCategory(); return false;">
              <span class="icon">🏷️</span>
              <span class="label">Price Category</span>
              <span class="desc">Create a pricing tier shared by multiple games</span>
            </a>
          </div>
        </div>
      </div>

      <div class="gm-panel" data-gm-panel="all">
<%- include('games/all-games') %>
      </div>
      <div class="gm-panel" data-gm-panel="soon" hidden>
<%- include('games/coming-soon') %>
      </div>
      <div class="gm-panel" data-gm-panel="requests" hidden>
<%- include('games/requests') %>
      </div>
      <div class="gm-panel" data-gm-panel="categories" hidden>
<%- include('games/categories') %>
      </div>
    </div>
  </div><!-- /tab-games -->
```

Then put its CRLF line endings back and check:

```bash
node -e "const fs=require('fs');const f='views/partials/admin/games.ejs';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))"
file views/partials/admin/games.ejs
```

Expected: `… with CRLF line terminators`.

- [ ] **Step 8: `server.js`, three edits** (Edit tool; CRLF + BOM)

8a. After:

```js
const releaseLib = require('./lib/release');
```

add:

```js
const gamesViewLib = require('./lib/games-view');
```

8b. Directly above the line that starts `  res.render('admin', { qaUpcoming,`, add:

```js
  // Games tab rows, worked out once here with the customer site's own slot
  // and status rules — see lib/games-view.js.
  const gamesViewRows = gamesViewLib.gameRows(games, customers, buildAccountSummaryMap(), new Date());
  const gamesView = {
    rows: gamesViewRows,
    counts: gamesViewLib.chipCounts(gamesViewRows),
    upcoming: gamesViewLib.upcomingRows(upcoming, upcomingReservedCount, todayManila),
    requests: gamesViewLib.requestSummary(gameRequestRows)
  };
```

8c. In that same `res.render('admin', { … })` line, replace:

```
templateTokens: templates.TOKENS, orderQueue,
```

with:

```
templateTokens: templates.TOKENS, gamesView, orderQueue,
```

Leave the rest of the line alone. In particular, `refundsOwed, releasedOrders, upcomingReservedCount, abandonedOrders` must stay exactly as it is.

- [ ] **Step 9: Run the tests**

```bash
node scripts/test-games-template.js
node scripts/test-release-pages.js
node scripts/test-release-wiring.js
node scripts/test-admin-tabs.js
node --check server.js
node scripts/test-order-routes-error-handling.js
file server.js views/partials/admin/games.ejs
git diff --stat server.js
```

Expected:
- `test-games-template.js` ends `20 assertions passed`.
- `test-release-pages.js` ends `6 assertions passed`.
- `test-release-wiring.js` ends `8 assertions passed`.
- `test-admin-tabs.js` ends `10 assertions passed`.
- `node --check` prints nothing.
- `test-order-routes-error-handling.js` ends `1 assertion passed`. It boots `server.js`, so it proves the new require loads.
- Both files keep their line endings (`server.js` BOM + CRLF, `games.ejs` CRLF).
- `server.js` shows about 11 insertions and 1 deletion.

- [ ] **Step 10: Commit**

```bash
git add views/partials/admin/games.ejs views/partials/admin/games server.js scripts/test-games-template.js scripts/test-release-pages.js
git status --short
git commit -m "$(cat <<'EOF'
Split the Games tab into sub-tabs and rebuild its rows

All games gets the 6-column row (game, slots, prices, status, money,
actions) with its toolbar; Coming soon uses the same row; Requests and
Price categories move into their own sub-tabs unchanged, with the
new-category form behind + New category. Row data comes from
lib/games-view.js.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

`git status --short` before committing should show only these paths plus the long-standing untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` (not part of this work — leave it).

---

### Task 5: Styles — the `gm-*` rules

**Files:**
- Modify: `public/css/style.css` (CRLF, Edit tool only)
- Modify: `scripts/test-games-template.js` (+2 assertions)

**Interfaces:**
- Consumes: every `gm-*` class Task 4's templates render.
- Produces: styling only.

- [ ] **Step 1: Write the failing test**

In `scripts/test-games-template.js`, replace the last line:

```js
console.log('\n' + passed + ' assertions passed\n');
```

with:

```js
console.log('\nstyles');

const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');

ok('every gm- class the tab renders has a rule', () => {
  const rendered = new Set([...html.matchAll(/class="([^"]*)"/g)]
    .flatMap(m => m[1].split(/\s+/))
    .filter(c => /^gm-/.test(c)));
  const missing = [...rendered].filter(c => !CSS.includes('.' + c));
  assert.deepStrictEqual(missing, []);
});

ok('style.css is still CRLF throughout', () => {
  const lf = CSS.split('\n').length - 1;
  const crlf = CSS.split('\r\n').length - 1;
  assert.strictEqual(lf, crlf, 'every newline is CRLF');
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-games-template.js`
Expected: FAIL on `every gm- class the tab renders has a rule`, with a list of missing classes.

- [ ] **Step 3: Add the rules**

In `public/css/style.css`, after the line:

```css
@media (max-width: 640px) { body.light-mode .oq-lr { background: #fff; border-color: #ddd; } }
```

insert a blank line and then:

```css
/* ── Admin → Games tab (views/partials/admin/games.ejs + games/*.ejs) ── */
.gm-shell { min-width: 0; }
.gm-top { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 1rem; }
.gm-subtabs { display: flex; gap: 0.35rem; overflow-x: auto; scrollbar-width: none; min-width: 0; }
.gm-subtabs::-webkit-scrollbar { display: none; }
.gm-subtab { background: transparent; border: 1px solid #262626; border-radius: 20px; padding: 0.42rem 0.9rem; font-size: 0.8rem; font-weight: 700; color: #8a8a8a; cursor: pointer; font-family: inherit; white-space: nowrap; }
.gm-subtab:hover { border-color: #3a3a3a; color: #ccc; }
.gm-subtab-on { background: #fff; color: #000; border-color: #fff; }
.gm-subtab-n { font-variant-numeric: tabular-nums; opacity: 0.6; font-weight: 600; }
.gm-add { flex-shrink: 0; background: var(--ps-blue); color: #000; border: 0; border-radius: 50px; padding: 0.55rem 1.2rem; font-weight: 800; font-size: 0.85rem; cursor: pointer; font-family: inherit; white-space: nowrap; }

.gm-toolbar { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.7rem; }
.gm-search { flex: 1; min-width: 200px; max-width: 320px; background: #141414; border: 1px solid #2a2a2a; border-radius: 8px; color: #fff; padding: 0.45rem 0.8rem; font-size: 0.8rem; font-family: inherit; }
.gm-search::placeholder { color: #4a4a4a; }
.gm-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.gm-chip { background: transparent; border: 1px solid #2a2a2a; border-radius: 20px; padding: 0.3rem 0.72rem; font-size: 0.74rem; font-weight: 700; color: #8a8a8a; cursor: pointer; font-family: inherit; white-space: nowrap; }
.gm-chip:hover { border-color: #3a3a3a; color: #bbb; }
.gm-chip-on { background: var(--ps-blue); color: #000; border-color: var(--ps-blue); }
.gm-chip-n { font-variant-numeric: tabular-nums; opacity: 0.7; margin-left: 0.2rem; }
.gm-select { background: #141414; border: 1px solid #2a2a2a; border-radius: 8px; color: #ddd; padding: 0.4rem 0.65rem; font-size: 0.78rem; font-family: inherit; }
.gm-showing { font-size: 0.76rem; color: #666; margin: 0 0 0.6rem; }
.gm-showing a, .gm-empty a { color: var(--ps-blue); font-weight: 700; }

/* Rows: All games (6 columns) and Coming soon (5), same card look. */
.gm-grid { display: grid; grid-template-columns: minmax(0, 2.4fr) minmax(0, 1.2fr) minmax(0, 1.5fr) minmax(0, 1.2fr) minmax(0, 1.2fr) auto; gap: 0.9rem; align-items: center; }
.gm-grid-soon { display: grid; grid-template-columns: minmax(0, 2.6fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.5fr) auto; gap: 0.9rem; align-items: center; }
.gm-head { font-size: 0.63rem; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; color: #5a5a5a; padding: 0 1rem 0.45rem; }
.gm-list { display: flex; flex-direction: column; gap: 0.45rem; }
.gm-row { position: relative; background: #0d0d0d; border: 1px solid #222; border-radius: 12px; padding: 0.7rem 1rem; }
.gm-c-game { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.gm-cover { width: 40px; height: 54px; border-radius: 6px; object-fit: cover; flex-shrink: 0; background: #151515; }
.gm-cover-ph { display: flex; align-items: center; justify-content: center; font-size: 1.1rem; border: 1px dashed #2e2e2e; box-sizing: border-box; }
.gm-cover-soon { background: #1a0030; border-color: #3a1a5c; }
.gm-name { min-width: 0; }
.gm-title { font-weight: 800; color: #fff; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gm-sub { font-size: 0.74rem; color: #777; margin-top: 0.1rem; }
.gm-tags { display: flex; gap: 0.3rem; flex-wrap: wrap; margin-top: 0.3rem; }
.gm-tag { font-size: 0.66rem; font-weight: 700; color: #22c55e; background: #0a2a0a; border: 1px solid #166534; border-radius: 20px; padding: 0.05rem 0.45rem; }
.gm-tag-bundle { color: #d9a7f0; background: #2a0a3a; border-color: #5b2a7a; }
.gm-soon-tag { color: #c9a4ff; font-weight: 700; }
.gm-cs-reserved { font-size: 0.7rem; color: #c9a4ff; font-weight: 700; margin-top: 0.2rem; }
.gm-cs-ready { font-size: 0.7rem; color: #22c55e; font-weight: 700; margin-top: 0.15rem; }
.gm-c-slots, .gm-c-status { display: flex; gap: 0.3rem; flex-wrap: wrap; align-items: center; }
.gm-slot { font-size: 0.72rem; font-weight: 800; font-variant-numeric: tabular-nums; color: #ccc; background: #161616; border: 1px solid #2a2a2a; border-radius: 6px; padding: 0.12rem 0.45rem; white-space: nowrap; }
.gm-slot-tr { color: #ffc400; }
.gm-slot-zero { color: #f87171; border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.08); }
.gm-c-prices { font-size: 0.76rem; color: #aaa; line-height: 1.6; font-variant-numeric: tabular-nums; }
.gm-tr { color: #ffc400; }
.gm-buy { color: #c084fc; }
.gm-c-release { font-size: 0.8rem; color: #aaa; }
.gm-st { font-size: 0.68rem; font-weight: 800; border-radius: 6px; padding: 0.12rem 0.45rem; white-space: nowrap; }
.gm-st-new { color: #7dd3fc; background: rgba(0,112,209,0.14); }
.gm-st-urgent { color: #fca5a5; background: rgba(239,68,68,0.14); }
.gm-st-never { color: #fbbf24; background: rgba(245,158,11,0.12); }
.gm-st-sold { color: #f87171; background: rgba(239,68,68,0.12); }
.gm-st-stocked { color: #4ade80; background: rgba(34,197,94,0.12); }
.gm-dash { color: #444; }
.gm-c-money { font-size: 0.76rem; line-height: 1.55; font-variant-numeric: tabular-nums; }
.gm-earned { color: #22c55e; font-weight: 800; }
.gm-txns { color: #555; font-weight: 600; font-size: 0.68rem; }
.gm-profit { color: var(--ps-blue); font-weight: 700; }
.gm-loss { color: #ef4444; }
.gm-c-actions { display: flex; align-items: center; gap: 0.4rem; justify-content: flex-end; }
.gm-c-actions form { margin: 0; }
.gm-btn { display: inline-flex; align-items: center; background: transparent; color: #ccc; border: 1px solid #2a2a2a; border-radius: 9px; padding: 0.45rem 0.75rem; font-weight: 700; font-size: 0.78rem; cursor: pointer; font-family: inherit; white-space: nowrap; text-decoration: none; }
.gm-btn:hover { border-color: #444; color: #fff; }
.gm-btn-release { background: linear-gradient(135deg, #065f46, #22c55e); color: #fff; border: 0; }
.gm-btn-release:hover { color: #fff; filter: brightness(1.08); }

/* ⋯ menu for Stock / Delete (All games) and Edit / Delete (Coming soon). */
.gm-more { position: relative; }
.gm-more-btn { list-style: none; cursor: pointer; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border: 1px solid #2a2a2a; border-radius: 9px; color: #888; font-weight: 900; font-size: 1rem; line-height: 1; box-sizing: border-box; }
.gm-more-btn::-webkit-details-marker { display: none; }
.gm-more-btn:hover, .gm-more[open] > .gm-more-btn { border-color: #444; color: #fff; }
.gm-more-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 170px; background: #141414; border: 1px solid #2a2a2a; border-radius: 10px; padding: 0.3rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 0.15rem; }
.gm-more-menu form { margin: 0; }
.gm-more-item { display: block; width: 100%; box-sizing: border-box; text-align: left; background: none; border: 0; border-radius: 7px; padding: 0.5rem 0.65rem; color: #ccc; font-size: 0.8rem; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; text-decoration: none; }
.gm-more-item:hover { background: #1e1e1e; color: #fff; }
.gm-more-danger { color: #f87171; }
.gm-more-danger:hover { background: rgba(239,68,68,0.12); color: #fca5a5; }

.gm-empty { color: #555; font-size: 0.9rem; padding: 2rem 0; text-align: center; }
.gm-newcat { background: #0a0a0a; border: 1px solid #1c1c1c; border-radius: 10px; }
.gm-newcat-btn { list-style: none; cursor: pointer; padding: 0.8rem 1rem; font-weight: 800; font-size: 0.85rem; color: #22c55e; }
.gm-newcat-btn::-webkit-details-marker { display: none; }
/* [hidden] loses to any class that sets display, so filtered rows need this. */
.gm-panel[hidden], .gm-row[hidden], .gm-list[hidden], .gm-head[hidden], .gm-showing[hidden], .gm-empty[hidden] { display: none !important; }

@media (max-width: 640px) {
  /* nowrap keeps this a single-line flex container, so the chip row is
     stretched to the toolbar's width and scrolls inside it. With wrap, the
     line would size to the unwrapped chips and widen the whole page. */
  .gm-toolbar { flex-direction: column; align-items: stretch; flex-wrap: nowrap; }
  .gm-search { max-width: none; width: 100%; box-sizing: border-box; }
  .gm-chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
  .gm-chips::-webkit-scrollbar { display: none; }
  .gm-select { width: 100%; }
  .gm-head { display: none; }
  .gm-grid, .gm-grid-soon { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "game game" "slots slots" "status status" "prices money" "act act"; gap: 0.55rem 0.8rem; align-items: start; }
  .gm-c-game { grid-area: game; }
  .gm-c-slots { grid-area: slots; }
  .gm-c-status, .gm-c-release { grid-area: status; }
  .gm-c-prices { grid-area: prices; }
  .gm-c-money { grid-area: money; text-align: right; }
  .gm-c-actions { grid-area: act; justify-content: flex-start; }
  .gm-title { white-space: normal; }
  /* Anchored to the card, not the ⋯ button: the button can sit anywhere
     along the row, so a menu anchored to it could run off-screen. */
  .gm-more { position: static; }
  .gm-more-menu { left: 0.8rem; right: 0.8rem; top: calc(100% - 0.4rem); min-width: 0; }
}

/* Games tab: light mode. */
body.light-mode .gm-row,
body.light-mode .gm-more-menu,
body.light-mode .gm-newcat { background: #fff; border-color: #ddd; }
body.light-mode .gm-title { color: #111; }
body.light-mode .gm-sub,
body.light-mode .gm-c-prices,
body.light-mode .gm-c-release { color: #555; }
body.light-mode .gm-head,
body.light-mode .gm-showing,
body.light-mode .gm-empty,
body.light-mode .gm-txns { color: #777; }
body.light-mode .gm-subtab,
body.light-mode .gm-chip { border-color: #ccc; color: #555; }
body.light-mode .gm-subtab-on { background: #111; color: #fff; border-color: #111; }
body.light-mode .gm-chip-on { background: var(--ps-blue); color: #000; border-color: var(--ps-blue); }
body.light-mode .gm-search,
body.light-mode .gm-select { background: #f8f9fa; border-color: #ccc; color: #111; }
body.light-mode .gm-slot { background: #f6f7f9; border-color: #ddd; color: #333; }
body.light-mode .gm-slot-tr,
body.light-mode .gm-tr { color: #b45309; }
body.light-mode .gm-slot-zero { color: #dc2626; border-color: #fecaca; background: #fef2f2; }
body.light-mode .gm-btn,
body.light-mode .gm-more-btn { border-color: #ccc; color: #555; }
body.light-mode .gm-btn-release { color: #fff; border: 0; }
body.light-mode .gm-more-item { color: #333; }
body.light-mode .gm-more-item:hover { background: #f2f4f7; color: #111; }
body.light-mode .gm-more-danger { color: #dc2626; }
body.light-mode .gm-earned { color: #15803d; }
```

- [ ] **Step 4: Run the tests**

```bash
node scripts/test-games-template.js
node scripts/test-orders-template.js
file public/css/style.css
```

Expected:
- `test-games-template.js` ends `22 assertions passed`.
- `test-orders-template.js` still ends `33 assertions passed`. Its own CRLF check covers the same file.
- `file` reports CRLF.

- [ ] **Step 5: Commit**

```bash
git add public/css/style.css scripts/test-games-template.js
git commit -m "$(cat <<'EOF'
Style the Games tab: sub-tabs, toolbar, row cards, phone layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Add and Edit game forms

**Files:**
- Rewrite: `views/edit.ejs` (CRLF + BOM). Write the whole file, then normalise with the command in Step 4.
- Rewrite: `views/add-game.ejs` (LF, Write tool)
- Modify: `public/css/style.css` (CRLF, Edit tool): the `afg-*` rules move here from `add-game.ejs`
- Modify: `server.js` (Edit tool): the `available_slots` / `renters` handling in both save routes
- Create: `scripts/test-game-form.js`

**Interfaces:**
- Consumes: Task 1's route changes. The Trophy lines are already `trophy_slots: parseInt(trophy_slots) || 0,` and `trophy_account: true,`.
- Produces: forms that post every field under its old name except `trophy_account`, `available_slots` and `renters`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-game-form.js`:

```js
// Run: node scripts/test-game-form.js
//
// The Add and Edit game forms: the three fields that did nothing are gone,
// every other field still posts under its old name, and the rest sits in five
// labelled sections. Plus the two save routes in server.js, checked at source
// level the way scripts/test-release-wiring.js checks that file.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const SETTINGS = { title: 'PlayStation Hub', favicon_path: '/favicon.svg', logo_path: '/logo.svg', payment_methods: [] };
const GAME = {
  id: 7, title: "Marvel's Spider-Man 2", platform: 'PS5', genre: 'Action', release_date: '2023-10-20',
  non_trophy_slots: 2, trophy_slots: 1, ps4_primary_slots: 0,
  nt_price_7d: 149, nt_price_30d: 349, tr_price_7d: 199, tr_price_30d: 399, buy_nt_price: 0, buy_tr_price: 0,
  cost: 2000, new_window_days: null, description: 'Swing.', link_label: '', link_url: '',
  cover_image: '/uploads/sm2.webp', gallery: []
};

function render(file, locals) {
  const f = path.join(ROOT, 'views', file);
  return ejs.render(fs.readFileSync(f, 'utf8'), Object.assign({
    settings: SETTINGS, priceCategories: [], accounts: [{ id: 1, label: 'Account A', game_ids: [7] }], msg: null, assetV: '1'
  }, locals), { filename: f });
}
const EDIT = render('edit.ejs', { game: GAME });
const ADD = render('add-game.ejs', { presetBundle: false });
const ADD_BUNDLE = render('add-game.ejs', { presetBundle: true });

const REMOVED = ['trophy_account', 'available_slots', 'renters'];
const KEPT = ['title', 'platform', 'genre', 'release_date', 'description', 'non_trophy_slots', 'trophy_slots', 'ps4_primary_slots',
  'price_mode', 'price_category_id', 'nt_price_7d', 'nt_price_30d', 'tr_price_7d', 'tr_price_30d', 'buy_nt_price', 'buy_tr_price',
  'cover_image', 'gallery', 'is_bundle', 'bundle_account_id', 'new_window_days', 'cost', 'link_label', 'link_url'];
const SECTIONS = ['📝 Basics', '🎮 Slots', '💰 Prices', '🖼️ Images', '🧩 Extras'];

// The markup of one form section: from its title to the next section's title.
function section(html, title) {
  const a = html.indexOf('<span class="afg-title">' + title + '</span>');
  assert.ok(a >= 0, 'section ' + title);
  const b = html.indexOf('<span class="afg-title">', a + 10);
  return html.slice(a, b > 0 ? b : undefined);
}

console.log('\nremoved fields');

ok('neither form has the Trophy switch, the total-slots field or the renters field', () => {
  [['edit', EDIT], ['add', ADD]].forEach(([name, html]) => {
    REMOVED.forEach(f => assert.ok(!html.includes('name="' + f + '"'), name + ' still has ' + f));
    assert.ok(!html.includes('toggle-switch'), name + ' still has a toggle switch');
  });
});

console.log('\nkept fields');

ok('every other field still posts under its old name, in both forms', () => {
  [['edit', EDIT], ['add', ADD]].forEach(([name, html]) => {
    KEPT.forEach(f => assert.ok(html.includes('name="' + f + '"'), name + ' lost ' + f));
  });
});

ok('Edit keeps the focal-point fields and fills in the saved values', () => {
  assert.ok(EDIT.includes('name="cover_focal_x"') && EDIT.includes('name="cover_focal_y"'));
  assert.ok(EDIT.includes('name="trophy_slots" value="1" min="0"'));
  assert.ok(EDIT.includes('value="Marvel&#39;s Spider-Man 2"'));
});

ok('Add starts Trophy at 1 and allows 0', () => {
  assert.ok(ADD.includes('name="trophy_slots" value="1" min="0"'));
});

console.log('\nsections');

ok('both forms have the five sections, in order', () => {
  [['edit', EDIT], ['add', ADD]].forEach(([name, html]) => {
    const at = SECTIONS.map(s => html.indexOf('<span class="afg-title">' + s + '</span>'));
    assert.ok(at.every(n => n >= 0), name + ' is missing a section: ' + at);
    assert.deepStrictEqual(at.slice().sort((a, b) => a - b), at, name + ' sections are out of order');
  });
});

ok('each field sits in its section', () => {
  [['📝 Basics', 'description'], ['🎮 Slots', 'trophy_slots'], ['🎮 Slots', 'ps4_primary_slots'], ['💰 Prices', 'buy_tr_price'],
   ['🖼️ Images', 'gallery'], ['🧩 Extras', 'is_bundle'], ['🧩 Extras', 'cost'], ['🧩 Extras', 'link_url'], ['🧩 Extras', 'new_window_days']]
    .forEach(([s, f]) => {
      assert.ok(section(EDIT, s).includes('name="' + f + '"'), 'edit: ' + f + ' not in ' + s);
      assert.ok(section(ADD, s).includes('name="' + f + '"'), 'add: ' + f + ' not in ' + s);
    });
});

console.log('\nPS4 Primary');

ok('PS4 Primary hides on a PS5 game and follows the platform select', () => {
  assert.ok(EDIT.includes('<select name="platform" onchange="gfPlatformChanged(this.value)">'));
  assert.ok(EDIT.includes('id="gf_ps4" style="display:none;"'));
  assert.ok(render('edit.ejs', { game: Object.assign({}, GAME, { platform: 'PS4/PS5' }) }).includes('id="gf_ps4" style=""'));
  assert.ok(ADD.includes('id="gf_ps4" style="display:none;"'));
  [EDIT, ADD].forEach(html => assert.ok(html.includes('function gfPlatformChanged(v)')));
});

console.log('\nbundle preset');

ok('?bundle=1 still starts with the bundle box ticked and Extras open', () => {
  assert.ok(ADD_BUNDLE.includes('id="add_bundle_chk" checked'));
  assert.ok(ADD_BUNDLE.includes('id="afg_extras" open>'));
  assert.ok(!ADD.includes('id="add_bundle_chk" checked'));
  assert.ok(ADD.includes('id="afg_extras">'));
});

ok('the section styles live in style.css, not inline in the Add page', () => {
  const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  ['.afg-sec {', '.afg-head {', '.afg-title', '.afg-body {', '.afg-sec[open] > .afg-head .afg-arrow'].forEach(r => assert.ok(CSS.includes(r), r));
  assert.ok(!fs.readFileSync(path.join(ROOT, 'views', 'add-game.ejs'), 'utf8').includes('<style>'));
});

console.log('\nsave routes (server.js)');

const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function route(marker) {
  const i = SRC.indexOf(marker);
  assert.ok(i >= 0, 'server.js still has ' + marker);
  const next = SRC.indexOf('\napp.', i + marker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}
const ADD_ROUTE = route("app.post('/admin/add', ");
const EDIT_ROUTE = route("app.post('/admin/edit/:id', ");

ok('neither route reads the removed fields from the form', () => {
  [ADD_ROUTE, EDIT_ROUTE].forEach(r => {
    assert.ok(!/available_slots,\s*renters/.test(r));
    assert.ok(!r.includes('parseInt(available_slots)'));
    assert.ok(!r.includes('parseInt(renters)'));
  });
});

ok('Edit leaves the stored total and renters alone', () => {
  assert.ok(!EDIT_ROUTE.includes('available_slots:'));
  assert.ok(!EDIT_ROUTE.includes('renters:'));
});

ok('Add starts at 0 renters with the total set from the slot counts', () => {
  assert.ok(ADD_ROUTE.includes('renters: 0,'));
  assert.ok(ADD_ROUTE.includes('available_slots: (parseInt(non_trophy_slots) || 0) + (parseInt(trophy_slots) || 0) + (parseInt(ps4_primary_slots) || 0),'));
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-game-form.js`
Expected: FAIL on `neither form has the Trophy switch…`.

- [ ] **Step 3: Section styles into `public/css/style.css`** (Edit tool)

Before the line:

```css
.vf-section { margin: 0 0 2rem; }
```

insert:

```css
/* Add / Edit game form sections (views/add-game.ejs, views/edit.ejs). Each
   section is a <details>, so it opens and closes without any script. */
.afg-sec { border: 1px solid #222; border-radius: 14px; overflow: hidden; margin-bottom: 0.75rem; }
.afg-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.85rem 1.25rem; cursor: pointer; user-select: none; background: #111; list-style: none; }
.afg-head::-webkit-details-marker { display: none; }
.afg-head:hover { background: #161616; }
.afg-text { min-width: 0; }
.afg-title { display: block; font-weight: 700; font-size: 0.9rem; color: #fff; }
.afg-desc { display: block; font-size: 0.72rem; color: #555; margin-top: 0.1rem; }
.afg-arrow { color: #555; font-size: 0.8rem; transition: transform 0.2s; }
.afg-sec[open] > .afg-head .afg-arrow { transform: rotate(180deg); }
.afg-body { padding: 1.25rem; }

```

- [ ] **Step 4: Rewrite `views/edit.ejs`**

Replace the whole file (Write tool) with:

```ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edit Game — <%= settings.title %></title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
</head>
<body>

<nav>
  <a href="/" class="logo"><img src="<%= settings.logo_path %>" alt="<%= settings.title %>" /></a>
  <div class="nav-links">
    <a href="/browse">Browse Games</a>
    <a href="/admin" class="admin-btn">Admin Panel</a>
  </div>
</nav>

<div class="edit-container">
  <a href="/admin" class="back-link">← Back to Admin</a>
  <h1>Edit Game</h1>

  <%- include('partials/upload-error-banner', { msg, nothingSavedNote: 'None of the changes below were saved — please fix the picture and re-enter the rest.' }) %>

  <%
    const isCategory = !!game.price_category_id;
    // PS4 Primary only exists on a game that runs on PS4. The field stays in
    // the form either way, so a PS5 game keeps whatever value it already has.
    const showPs4 = game.platform === 'PS4' || game.platform === 'PS4/PS5';
  %>
  <form method="POST" action="/admin/edit/<%= game.id %>" enctype="multipart/form-data">

    <details class="afg-sec" open>
      <summary class="afg-head"><span class="afg-text"><span class="afg-title">📝 Basics</span><span class="afg-desc">Title, platform, genre, release date, description</span></span><span class="afg-arrow">▼</span></summary>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group full">
            <label>Game Title *</label>
            <input type="text" name="title" value="<%= game.title %>" required>
          </div>
          <div class="form-group">
            <label>Platform</label>
            <select name="platform" onchange="gfPlatformChanged(this.value)">
              <option value="PS5" <%= game.platform === 'PS5' ? 'selected' : '' %>>PS5</option>
              <option value="PS4" <%= game.platform === 'PS4' ? 'selected' : '' %>>PS4</option>
              <option value="PS4/PS5" <%= game.platform === 'PS4/PS5' ? 'selected' : '' %>>PS4/PS5</option>
            </select>
          </div>
          <div class="form-group">
            <label>Genre</label>
            <input type="text" name="genre" value="<%= game.genre || '' %>">
          </div>
          <div class="form-group">
            <label>📅 Release Date <span style="color:#555;font-size:0.7rem;">(when the game launched — powers "New Releases")</span></label>
            <input type="date" name="release_date" value="<%= (game.release_date && game.release_date !== 'TBA') ? game.release_date : '' %>">
          </div>
          <div class="form-group full">
            <label>Description</label>
            <textarea name="description"><%= game.description || '' %></textarea>
          </div>
        </div>
      </div>
    </details>

    <details class="afg-sec" open>
      <summary class="afg-head"><span class="afg-text"><span class="afg-title">🎮 Slots</span><span class="afg-desc">How many accounts you have for each type</span></span><span class="afg-arrow">▼</span></summary>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group">
            <label>🎮 Non-Trophy Slots</label>
            <input type="number" name="non_trophy_slots" value="<%= game.non_trophy_slots || 0 %>" min="0">
          </div>
          <div class="form-group">
            <label>🏆 Trophy Slots</label>
            <input type="number" name="trophy_slots" value="<%= game.trophy_slots || 0 %>" min="0">
          </div>
          <div class="form-group" id="gf_ps4" style="<%= showPs4 ? '' : 'display:none;' %>">
            <label>🕹️ PS4 Primary Slots</label>
            <input type="number" name="ps4_primary_slots" value="<%= game.ps4_primary_slots || 0 %>" min="0">
          </div>
        </div>
      </div>
    </details>

    <details class="afg-sec" open>
      <summary class="afg-head"><span class="afg-text"><span class="afg-title">💰 Prices</span><span class="afg-desc">Rent tiers and buy prices</span></span><span class="afg-arrow">▼</span></summary>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group full">
            <label>Pricing</label>
            <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;">
              <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-weight:600;">
                <input type="radio" name="price_mode" value="category" id="edit_mode_cat" onchange="toggleEditPriceMode(this.value)" <%= isCategory ? 'checked' : '' %> <%= priceCategories.length ? '' : 'disabled' %>>
                🏷️ Use Category
              </label>
              <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-weight:600;">
                <input type="radio" name="price_mode" value="custom" id="edit_mode_custom" onchange="toggleEditPriceMode(this.value)" <%= !isCategory ? 'checked' : '' %>>
                ✏️ Custom Price
              </label>
            </div>
            <div id="edit_cat_section" style="display:<%= isCategory ? 'block' : 'none' %>;">
              <select name="price_category_id" style="width:100%;">
                <option value="">— Select a category —</option>
                <% priceCategories.forEach(cat => { %>
                <option value="<%= cat.id %>" <%= game.price_category_id === cat.id ? 'selected' : '' %>><%= cat.name %> (NT: ₱<%= cat.nt_price_7d %>/₱<%= cat.nt_price_30d %>)</option>
                <% }) %>
              </select>
            </div>
          </div>
          <div id="edit_custom_prices" style="display:<%= !isCategory ? 'contents' : 'none' %>;">
            <div class="form-group full" style="margin-bottom:0;">
              <label style="color:#aaa;">🎮 Non-Trophy Prices (₱)</label>
            </div>
            <div class="form-group"><label>Weekly</label><input type="number" name="nt_price_7d" value="<%= game.nt_price_7d || 149 %>" min="1"></div>
            <div class="form-group"><label>Monthly</label><input type="number" name="nt_price_30d" value="<%= game.nt_price_30d || 349 %>" min="1"></div>
            <div class="form-group full" style="margin-bottom:0;">
              <label style="color:#ffc400;">🏆 Trophy Account Prices (₱) <span style="font-weight:400;color:#664d00;font-size:0.78rem;">— +₱100 deposit not included here</span></label>
            </div>
            <div class="form-group"><label>Weekly</label><input type="number" name="tr_price_7d" value="<%= game.tr_price_7d || 199 %>" min="1"></div>
            <div class="form-group"><label>Monthly</label><input type="number" name="tr_price_30d" value="<%= game.tr_price_30d || 399 %>" min="1"></div>
          </div>
          <div class="form-group full" style="margin-bottom:0;">
            <label style="color:#a855f7;">♾️ Buy Permanent Access Prices (₱) <span style="font-weight:400;color:#555;font-size:0.78rem;">— leave 0 to hide Buy option</span></label>
          </div>
          <div class="form-group">
            <label>🎮 Non-Trophy Buy Price</label>
            <input type="number" name="buy_nt_price" value="<%= game.buy_nt_price || 0 %>" min="0" placeholder="e.g. 999">
          </div>
          <div class="form-group">
            <label>🏆 Trophy Buy Price</label>
            <input type="number" name="buy_tr_price" value="<%= game.buy_tr_price || 0 %>" min="0" placeholder="e.g. 1199">
          </div>
        </div>
      </div>
    </details>

    <details class="afg-sec" open>
      <summary class="afg-head"><span class="afg-text"><span class="afg-title">🖼️ Images</span><span class="afg-desc">Cover image and gameplay gallery</span></span><span class="afg-arrow">▼</span></summary>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group full">
            <label>Cover Image <span style="color:#555;font-size:0.75rem;">(blank = keep current)</span></label>
            <% if (game.cover_image) { %>
              <img src="<%= game.cover_image %>" style="width:60px;border-radius:6px;margin-bottom:0.5rem;">
            <% } %>
            <input type="file" name="cover_image" accept="image/*" style="padding:0.5rem;" onchange="var fp = document.getElementById('focalPicker'); if (fp) fp.style.display = this.files.length ? 'none' : '';">
          </div>

          <% if (game.cover_image) { %>
          <div class="form-group full" id="focalPicker">
            <label>🎯 Cover Position <span style="color:#555;font-size:0.75rem;">— click the part of the image you want kept visible when it's cropped in cards, the game page, and posters</span></label>
            <div id="focalImgWrap" style="position:relative;display:inline-block;max-width:360px;border-radius:8px;overflow:hidden;cursor:crosshair;border:1px solid #222;">
              <img id="focalImg" src="<%= game.cover_image %>" style="display:block;width:100%;height:auto;">
              <div id="focalDot" style="position:absolute;width:22px;height:22px;border-radius:50%;background:rgba(0,112,209,0.35);border:2px solid var(--ps-blue);box-shadow:0 0 0 2px rgba(0,0,0,0.6);transform:translate(-50%,-50%);pointer-events:none;left:<%= game.cover_focal_x != null ? game.cover_focal_x : 50 %>%;top:<%= game.cover_focal_y != null ? game.cover_focal_y : 50 %>%;"></div>
            </div>
            <div style="margin-top:0.4rem;">
              <button type="button" class="btn btn-outline" style="padding:0.3rem 0.7rem;font-size:0.72rem;" onclick="resetFocal()">Reset to Center</button>
            </div>
            <input type="hidden" name="cover_focal_x" id="cover_focal_x" value="<%= game.cover_focal_x != null ? game.cover_focal_x : 50 %>">
            <input type="hidden" name="cover_focal_y" id="cover_focal_y" value="<%= game.cover_focal_y != null ? game.cover_focal_y : 50 %>">
          </div>
          <script>
          (function() {
            const wrap = document.getElementById('focalImgWrap');
            const dot = document.getElementById('focalDot');
            const xInput = document.getElementById('cover_focal_x');
            const yInput = document.getElementById('cover_focal_y');
            function setFromEvent(e) {
              const rect = wrap.getBoundingClientRect();
              const clientX = e.touches ? e.touches[0].clientX : e.clientX;
              const clientY = e.touches ? e.touches[0].clientY : e.clientY;
              let x = ((clientX - rect.left) / rect.width) * 100;
              let y = ((clientY - rect.top) / rect.height) * 100;
              x = Math.min(100, Math.max(0, Math.round(x)));
              y = Math.min(100, Math.max(0, Math.round(y)));
              dot.style.left = x + '%';
              dot.style.top = y + '%';
              xInput.value = x;
              yInput.value = y;
            }
            wrap.addEventListener('click', setFromEvent);
          })();
          function resetFocal() {
            document.getElementById('focalDot').style.left = '50%';
            document.getElementById('focalDot').style.top = '50%';
            document.getElementById('cover_focal_x').value = 50;
            document.getElementById('cover_focal_y').value = 50;
          }
          </script>
          <% } %>

          <div class="form-group full">
            <label>🖼️ Gameplay Gallery <span style="color:#555;font-size:0.78rem;">— shown as a slider on the game page</span></label>
            <% const gal = game.gallery || []; %>
            <% if (gal.length) { %>
            <div style="display:flex;flex-wrap:wrap;gap:0.6rem;margin:0.75rem 0;">
              <% gal.forEach(img => { %>
              <label style="position:relative;cursor:pointer;display:block;">
                <img src="<%= img %>" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid #222;display:block;">
                <span style="display:flex;align-items:center;gap:0.3rem;justify-content:center;margin-top:0.3rem;font-size:0.72rem;color:#ef4444;font-weight:600;">
                  <input type="checkbox" name="remove_gallery" value="<%= img %>" style="width:auto;margin:0;"> Remove
                </span>
              </label>
              <% }) %>
            </div>
            <div style="font-size:0.72rem;color:#555;margin-bottom:0.5rem;">Tick <strong>Remove</strong> to delete a screenshot when you save.</div>
            <% } else { %>
            <div style="font-size:0.8rem;color:#555;margin:0.5rem 0;">No gameplay screenshots yet. Add some below 👇</div>
            <% } %>
            <label style="font-size:0.8rem;color:#aaa;">Add screenshots <span style="color:#555;">(you can select multiple, up to 10)</span></label>
            <input type="file" name="gallery" accept="image/*" multiple style="padding:0.5rem;">
          </div>
        </div>
      </div>
    </details>

    <details class="afg-sec" id="afg_extras" open>
      <summary class="afg-head"><span class="afg-text"><span class="afg-title">🧩 Extras</span><span class="afg-desc">Bundle, new countdown, cost, custom link</span></span><span class="afg-arrow">▼</span></summary>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group full">
            <label>
              <input type="checkbox" name="is_bundle" id="edit_bundle_chk" <%= game.is_bundle ? 'checked' : '' %>
                onchange="document.getElementById('edit_bundle_account').style.display = this.checked ? 'block' : 'none'; if (!this.checked) document.querySelector('#edit_bundle_account select').value = '';">
              📦 This game represents an account bundle
            </label>
            <div id="edit_bundle_account" style="display:<%= game.is_bundle ? 'block' : 'none' %>;margin-top:0.5rem;">
              <label>Bundle account</label>
              <select name="bundle_account_id">
                <option value="">— Select account —</option>
                <% accounts.forEach(acc => { %>
                <option value="<%= acc.id %>" <%= (game.is_bundle && game.bundle_account_id === acc.id) ? 'selected' : '' %>><%= acc.label %> (#<%= acc.id %>, <%= (acc.game_ids || []).length %> games)</option>
                <% }) %>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>New Game Countdown (days) <span style="color:#555;font-size:0.7rem;">(blank = site default, 11)</span></label>
            <input type="number" name="new_window_days" value="<%= game.new_window_days || '' %>" min="1" placeholder="11">
          </div>
          <div class="form-group">
            <label>Game Cost (₱) <span style="color:#555;font-size:0.72rem;">what you paid</span></label>
            <input type="number" name="cost" value="<%= game.cost || 0 %>" min="0">
          </div>
          <div class="form-group">
            <label>🔗 Custom Link Label <span style="color:#555;font-weight:500;">(optional)</span></label>
            <input type="text" name="link_label" value="<%= game.link_label || '' %>" placeholder="e.g. Visit PS Plus website">
          </div>
          <div class="form-group">
            <label>🔗 Custom Link URL <span style="color:#555;font-weight:500;">(optional)</span></label>
            <input type="url" name="link_url" value="<%= game.link_url || '' %>" placeholder="https://...">
          </div>
        </div>
      </div>
    </details>

    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Save Changes</button>
      <a href="/admin" class="btn btn-outline">Cancel</a>
    </div>
  </form>
</div>

<script>
function toggleEditPriceMode(v) {
  document.getElementById('edit_cat_section').style.display = v==='category' ? 'block' : 'none';
  document.getElementById('edit_custom_prices').style.display = v==='category' ? 'none' : 'contents';
}
// PS4 Primary only applies to a game that runs on PS4 — the same rule the
// customer site uses to decide whether to show it.
function gfPlatformChanged(v) {
  document.getElementById('gf_ps4').style.display = (v === 'PS4' || v === 'PS4/PS5') ? '' : 'none';
}
</script>
<script src="/js/admin-searchable-select.js?v=<%= assetV %>"></script>
<%- include('partials/footer') %>
</body>
</html>
```

Then restore its CRLF line endings and its UTF-8 BOM, and check:

```bash
node -e "const fs=require('fs');const f='views/edit.ejs';const s=fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'').replace(/\r?\n/g,'\r\n');fs.writeFileSync(f,'\uFEFF'+s)"
file views/edit.ejs
```

Expected: `… UTF-8 (with BOM) text … with CRLF line terminators`.

- [ ] **Step 5: Rewrite `views/add-game.ejs`**

Replace the whole file (Write tool, LF) with:

```ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Add Game — <%= settings.title %></title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
</head>
<body>

<nav>
  <a href="/" class="logo"><img src="<%= settings.logo_path %>" alt="<%= settings.title %>" /></a>
  <div class="nav-links">
    <a href="/browse">Browse Games</a>
    <a href="/admin" class="admin-btn">Admin Panel</a>
  </div>
</nav>

<div class="edit-container">
  <a href="/admin?tab=games" class="back-link">← Back to Admin</a>
  <h1>Add New Game</h1>

  <%- include('partials/upload-error-banner', { msg, nothingSavedNote: "Nothing was saved — please pick a different picture and re-enter the game's details." }) %>

  <form method="POST" action="/admin/add" enctype="multipart/form-data">

    <details class="afg-sec" open>
      <summary class="afg-head"><span class="afg-text"><span class="afg-title">📝 Basics</span><span class="afg-desc">Title, platform, genre, release date, description</span></span><span class="afg-arrow">▼</span></summary>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group full"><label>Game Title *</label><input type="text" name="title" placeholder="e.g. God of War Ragnarök" required></div>
          <div class="form-group">
            <label>Platform</label>
            <select name="platform" onchange="gfPlatformChanged(this.value)"><option value="PS5">PS5</option><option value="PS4">PS4</option><option value="PS4/PS5">PS4/PS5</option></select>
          </div>
          <div class="form-group"><label>Genre</label><input type="text" name="genre" placeholder="e.g. Action, RPG, Horror"></div>
          <div class="form-group"><label>📅 Release Date <span style="color:#555;font-size:0.7rem;">(when the game launched — powers "New Releases")</span></label><input type="date" name="release_date"></div>
          <div class="form-group full"><label>Description (optional)</label><textarea name="description" placeholder="Short description of the game..."></textarea></div>
        </div>
      </div>
    </details>

    <details class="afg-sec" open>
      <summary class="afg-head"><span class="afg-text"><span class="afg-title">🎮 Slots</span><span class="afg-desc">How many accounts you have for each type</span></span><span class="afg-arrow">▼</span></summary>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group"><label>🎮 Non-Trophy Slots</label><input type="number" name="non_trophy_slots" value="1" min="0"></div>
          <div class="form-group"><label>🏆 Trophy Slots</label><input type="number" name="trophy_slots" value="1" min="0"></div>
          <div class="form-group" id="gf_ps4" style="display:none;"><label>🕹️ PS4 Primary Slots</label><input type="number" name="ps4_primary_slots" value="0" min="0"></div>
        </div>
      </div>
    </details>

    <details class="afg-sec" open>
      <summary class="afg-head"><span class="afg-text"><span class="afg-title">💰 Prices</span><span class="afg-desc">Rent tiers and buy prices</span></span><span class="afg-arrow">▼</span></summary>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group full">
            <label>Pricing</label>
            <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;">
              <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-weight:600;">
                <input type="radio" name="price_mode" value="category" id="add_mode_cat" onchange="toggleAddPriceMode(this.value)" <%= priceCategories.length ? '' : 'disabled' %>>
                🏷️ Use Category
              </label>
              <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-weight:600;">
                <input type="radio" name="price_mode" value="custom" id="add_mode_custom" onchange="toggleAddPriceMode(this.value)" checked>
                ✏️ Custom Price
              </label>
            </div>
            <div id="add_cat_section" style="display:none;">
              <select name="price_category_id" style="width:100%;">
                <option value="">— Select a category —</option>
                <% priceCategories.forEach(cat => { %>
                <option value="<%= cat.id %>"><%= cat.name %> (NT: ₱<%= cat.nt_price_7d %>/₱<%= cat.nt_price_30d %>)</option>
                <% }) %>
              </select>
            </div>
          </div>
          <div id="add_custom_prices" style="display:contents;">
            <div class="form-group full" style="margin-bottom:0;"><label style="color:#aaa;">🎮 Non-Trophy Prices (₱)</label></div>
            <div class="form-group"><label>Weekly</label><input type="number" name="nt_price_7d" value="149" min="1"></div>
            <div class="form-group"><label>Monthly</label><input type="number" name="nt_price_30d" value="349" min="1"></div>
            <div class="form-group full" style="margin-bottom:0;"><label style="color:#ffc400;">🏆 Trophy Account Prices (₱) <span style="font-weight:400;color:#664d00;font-size:0.78rem;">— +₱100 deposit not included here</span></label></div>
            <div class="form-group"><label>Weekly</label><input type="number" name="tr_price_7d" value="199" min="1"></div>
            <div class="form-group"><label>Monthly</label><input type="number" name="tr_price_30d" value="399" min="1"></div>
          </div>
          <div class="form-group full" style="margin-bottom:0;">
            <label style="color:#a855f7;">♾️ Buy Permanent Access Prices (₱) <span style="font-weight:400;color:#555;font-size:0.78rem;">— leave 0 to hide Buy option</span></label>
          </div>
          <div class="form-group"><label>🎮 Non-Trophy Buy Price</label><input type="number" name="buy_nt_price" value="0" min="0" placeholder="e.g. 999"></div>
          <div class="form-group"><label>🏆 Trophy Buy Price</label><input type="number" name="buy_tr_price" value="0" min="0" placeholder="e.g. 1199"></div>
        </div>
      </div>
    </details>

    <details class="afg-sec">
      <summary class="afg-head"><span class="afg-text"><span class="afg-title">🖼️ Images</span><span class="afg-desc">Cover image and gameplay gallery</span></span><span class="afg-arrow">▼</span></summary>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group"><label>Cover Image</label><input type="file" name="cover_image" accept="image/*" style="padding:0.5rem;"></div>
          <div class="form-group full"><label>🖼️ Gameplay Gallery <span style="color:#555;font-size:0.75rem;">(optional — select multiple screenshots, shown as a slider)</span></label><input type="file" name="gallery" accept="image/*" multiple style="padding:0.5rem;"></div>
          <div class="form-group full" style="font-size:0.78rem;color:#666;">The cover's focal point is set later via Edit, once the image is visible.</div>
        </div>
      </div>
    </details>

    <details class="afg-sec" id="afg_extras"<%= presetBundle ? ' open' : '' %>>
      <summary class="afg-head"><span class="afg-text"><span class="afg-title">🧩 Extras</span><span class="afg-desc">Bundle, new countdown, cost, custom link</span></span><span class="afg-arrow">▼</span></summary>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group full">
            <label>
              <input type="checkbox" name="is_bundle" id="add_bundle_chk" <%= presetBundle ? 'checked' : '' %>
                onchange="document.getElementById('add_bundle_account').style.display = this.checked ? 'block' : 'none'; if (!this.checked) { const s = document.querySelector('#add_bundle_account select'); if (s) s.value = ''; }">
              📦 This game represents an account bundle
            </label>
            <div id="add_bundle_account" style="display:<%= presetBundle ? 'block' : 'none' %>;margin-top:0.5rem;">
              <label>Bundle account</label>
              <% if (accounts.length) { %>
              <select name="bundle_account_id">
                <option value="">— Select account —</option>
                <% accounts.forEach(acc => { %>
                <option value="<%= acc.id %>"><%= acc.label %> (#<%= acc.id %>, <%= (acc.game_ids || []).length %> games)</option>
                <% }) %>
              </select>
              <% } else { %>
              <div style="font-size:0.8rem;color:#888;line-height:1.6;">
                No accounts exist yet — <a href="/admin/accounts" style="color:var(--ps-blue);">create one first</a>, then come back and link it here.
              </div>
              <% } %>
            </div>
          </div>
          <div class="form-group"><label>New Game Countdown (days) <span style="color:#555;font-size:0.7rem;">(blank = site default, 11)</span></label><input type="number" name="new_window_days" value="" min="1" placeholder="11"></div>
          <div class="form-group"><label>Game Cost (₱) <span style="color:#555;font-size:0.72rem;">what you paid</span></label><input type="number" name="cost" value="0" min="0" placeholder="e.g. 2500"></div>
          <div class="form-group"><label>🔗 Custom Link Label (optional)</label><input type="text" name="link_label" placeholder="e.g. Visit PS Plus website"></div>
          <div class="form-group"><label>🔗 Custom Link URL (optional)</label><input type="url" name="link_url" placeholder="https://..."></div>
        </div>
      </div>
    </details>

    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Add Game</button>
      <a href="/admin?tab=games" class="btn btn-outline">Cancel</a>
    </div>
  </form>
</div>

<script>
function toggleAddPriceMode(v) {
  document.getElementById('add_cat_section').style.display = v === 'category' ? 'block' : 'none';
  document.getElementById('add_custom_prices').style.display = v === 'category' ? 'none' : 'contents';
}
// PS4 Primary only applies to a game that runs on PS4 — the same rule the
// customer site uses to decide whether to show it.
function gfPlatformChanged(v) {
  document.getElementById('gf_ps4').style.display = (v === 'PS4' || v === 'PS4/PS5') ? '' : 'none';
}
</script>

</body>
</html>
```

- [ ] **Step 6: The save routes, `server.js`** (Edit tool; CRLF + BOM)

6a. In `POST /admin/add`, replace:

```js
app.post('/admin/add', upload.fields([{ name: 'cover_image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }]), requireAuth, async (req, res) => {
  const { title, platform, available_slots, renters, new_window_days,
```

with:

```js
app.post('/admin/add', upload.fields([{ name: 'cover_image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }]), requireAuth, async (req, res) => {
  const { title, platform, new_window_days,
```

and replace:

```js
    available_slots: parseInt(available_slots) || 1,
    renters: parseInt(renters) || 0,
```

with:

```js
    // Not shown anywhere on the site; kept as the running total the order
    // routes count down. Starts at every slot the game was added with.
    available_slots: (parseInt(non_trophy_slots) || 0) + (parseInt(trophy_slots) || 0) + (parseInt(ps4_primary_slots) || 0),
    // Counts itself up at every sign-in; 📦 Stock is the manual override.
    renters: 0,
```

6b. In `POST /admin/edit/:id`, replace:

```js
app.post('/admin/edit/:id', upload.fields([{ name: 'cover_image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }]), requireAuth, async (req, res) => {
  const { title, platform, available_slots, renters, new_window_days,
```

with:

```js
app.post('/admin/edit/:id', upload.fields([{ name: 'cover_image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }]), requireAuth, async (req, res) => {
  const { title, platform, new_window_days,
```

and replace:

```js
    gallery,
    available_slots: parseInt(available_slots),
    renters: parseInt(renters),
```

with:

```js
    gallery,
    // The stored running total and renter count are left as they are: the
    // form no longer has those fields (see POST /admin/add).
```

- [ ] **Step 7: Run the tests**

```bash
node scripts/test-game-form.js
node scripts/test-trophy-always.js
node scripts/test-games-template.js
node --check server.js
node scripts/test-order-routes-error-handling.js
file server.js views/edit.ejs views/add-game.ejs public/css/style.css
git diff --stat server.js
```

Expected:
- `test-game-form.js` ends `12 assertions passed`.
- `test-trophy-always.js` ends `4 assertions passed`.
- `test-games-template.js` ends `22 assertions passed`.
- `node --check` prints nothing.
- `test-order-routes-error-handling.js` ends `1 assertion passed`.
- Line endings are kept: `server.js` BOM + CRLF, `edit.ejs` BOM + CRLF, `add-game.ejs` LF, `style.css` CRLF.
- `server.js` shows about 8 insertions and 6 deletions.

- [ ] **Step 8: Commit**

```bash
git add views/edit.ejs views/add-game.ejs public/css/style.css server.js scripts/test-game-form.js
git commit -m "$(cat <<'EOF'
Regroup the game forms into five sections and drop three dead fields

The Trophy switch, Available Slots (total) and Current Renters are gone;
Edit leaves the stored counters alone and Add starts them from the slot
counts. Both forms now read Basics, Slots, Prices, Images, Extras, and PS4
Primary only shows for a game that runs on PS4.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Browser check with fixtures, and regression

No changes to the repo unless a defect is found. If one is, fix it, re-run the affected tests, and commit separately. **Nothing here uses a live server's data or logs into the admin.**

**Files:**
- Scratch only (substitute the session scratchpad path for `$SCRATCH`):
  - `$SCRATCH/gm-check/build.js`
  - `$SCRATCH/gm-check/serve.js`
  - the generated `tab.html`, `edit.html`, `add.html`

- [ ] **Step 1: Build the fixture pages**

Create `$SCRATCH/gm-check/build.js`:

```js
// Renders the real Games tab and both game forms with fixture data.
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/michael/Desktop/claude code/playstation-hub';
const ejs = require(REPO + '/node_modules/ejs');
const gv = require(REPO + '/lib/games-view');

const now = new Date();
const daysAgo = n => new Date(now.getTime() - n * 86400000 - 3600000).toISOString();
const today = new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const P = { nt_price_7d: 149, nt_price_30d: 349, tr_price_7d: 199, tr_price_30d: 399 };
const games = [
  Object.assign({ id: 6, title: 'Ghost of Yōtei', platform: 'PS5', genre: 'Action', created_at: daysAgo(2), non_trophy_slots: 2, trophy_slots: 1, renters: 0, cost: 1500, _category_name: 'New Games' }, P),
  Object.assign({ id: 5, title: 'Astro Bot', platform: 'PS5', genre: 'Platformer', created_at: daysAgo(9), non_trophy_slots: 1, trophy_slots: 0, renters: 2, cost: 900 }, P),
  Object.assign({ id: 4, title: "Marvel's Spider-Man 2", platform: 'PS4/PS5', genre: 'Action', created_at: daysAgo(90), non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 1, renters: 12, stocked: true, buy_nt_price: 999, cost: 500 }, P),
  Object.assign({ id: 3, title: 'Tekken 8', platform: 'PS5', genre: 'Fighting', created_at: daysAgo(200), non_trophy_slots: 0, trophy_slots: 0, renters: 8, is_bundle: true }, P),
  Object.assign({ id: 2, title: 'Hogwarts Legacy', platform: 'PS4', genre: 'RPG', created_at: daysAgo(300), non_trophy_slots: 1, trophy_slots: 1, ps4_primary_slots: 0, renters: 0 }, P),
  Object.assign({ id: 1, title: 'God of War Ragnarök', platform: 'PS5', genre: 'Action', created_at: daysAgo(400), non_trophy_slots: 3, trophy_slots: 2, renters: 15, cost: 2000 }, P)
];
const customers = [4, 4, 1, 1, 1, 1, 1, 1].map(id => ({ game_id: id, price: 349 }))
  .concat([{ game_id: 5, price: 149 }, { game_id: 3, price: 249 }]);
const upcoming = [
  { id: 16, title: 'Wolverine', platform: 'PS5', release_date: '2026-12-01', non_trophy_slots: 1, trophy_slots: 1, nt_price_7d: 199, nt_price_30d: 449 },
  { id: 15, title: 'Phantom Blade Zero', platform: 'PS5', release_date: '2026-09-09', non_trophy_slots: 2, trophy_slots: 1, nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549 }
];
const requests = [
  { slug: 'astro-bot-2', title: 'Astro Bot 2', status: 'pending', voters: [{ fb_name: 'Ana Cruz', at: '2026-09-20T00:00:00Z' }] },
  { slug: 'elden-ring', title: 'Elden Ring', status: 'approved', voters: [] }
];
const categories = [{ id: 1, name: 'New Games', nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549 }];

const rows = gv.gameRows(games, customers, {}, now);
const gamesView = { rows, counts: gv.chipCounts(rows), upcoming: gv.upcomingRows(upcoming, { '15': 3 }, today), requests: gv.requestSummary(requests) };
const file = path.join(REPO, 'views/partials/admin/games.ejs');
const tab = ejs.render(fs.readFileSync(file, 'utf8'), { gamesView, games, gameRequestRows: requests, priceCategories: categories, msg: null }, { filename: file });
// The + Add New modal's rules live in views/admin.ejs's own <style>.
const overlayCss = '.add-choice-overlay{display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.7);align-items:center;justify-content:center}'
  + '.add-choice-overlay.open{display:flex}.add-choice-box{background:#111;border:1px solid #222;border-radius:20px;padding:2rem;width:min(480px,92vw)}'
  + '.add-choice-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-top:1.25rem}';
fs.writeFileSync(path.join(__dirname, 'tab.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<link rel="stylesheet" href="/css/style.css"><style>body{background:#0a0a0a;color:#fff;padding:16px;font-family:system-ui}.tab-panel{display:block}' + overlayCss + '</style></head>'
  + '<body><script>if (location.search.indexOf("light") !== -1) document.body.classList.add("light-mode");</script>'
  + tab + '<script src="/js/admin-games.js"></script></body></html>');

const settings = { title: 'PlayStation Hub', favicon_path: '/favicon.svg', logo_path: '/logo.svg', payment_methods: [] };
function page(view, locals) {
  const f = path.join(REPO, 'views', view);
  return ejs.render(fs.readFileSync(f, 'utf8'), Object.assign({ settings, priceCategories: categories, accounts: [{ id: 1, label: 'Account A', game_ids: [1, 2] }], msg: null, assetV: 'dev' }, locals), { filename: f });
}
fs.writeFileSync(path.join(__dirname, 'edit.html'), page('edit.ejs', { game: games[2] }));
fs.writeFileSync(path.join(__dirname, 'add.html'), page('add-game.ejs', { presetBundle: false }));
console.log('wrote tab.html, edit.html, add.html');
```

Create `$SCRATCH/gm-check/serve.js`:

```js
const http = require('http');
const fs = require('fs');
const REPO = 'C:/Users/michael/Desktop/claude code/playstation-hub';
const routes = {
  '/': [__dirname + '/tab.html', 'text/html'],
  '/edit': [__dirname + '/edit.html', 'text/html'],
  '/add': [__dirname + '/add.html', 'text/html'],
  '/css/style.css': [REPO + '/public/css/style.css', 'text/css'],
  '/js/admin-games.js': [REPO + '/public/js/admin-games.js', 'application/javascript'],
  '/js/admin-searchable-select.js': [REPO + '/public/js/admin-searchable-select.js', 'application/javascript']
};
http.createServer((req, res) => {
  const r = routes[req.url.split('?')[0]];
  if (!r) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': r[1] + '; charset=utf-8' });
  fs.createReadStream(r[0]).pipe(res);
}).listen(4592, () => console.log('fixture pages on 4592'));
```

```bash
cd "$SCRATCH/gm-check" && node build.js && (node serve.js > serve.log 2>&1 &) ; sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4592/
```

Expected: `wrote tab.html, edit.html, add.html` then `200`.

- [ ] **Step 2: Check the Games tab (Browser pane, `http://localhost:4592/`)**

Start with `localStorage.clear()` and a reload.

1. **Sub-tabs.**
   - All games is selected, showing `(6)`. Coming soon shows `(2)`, Requests `(1 pending)`, Price categories `(1)`.
   - Click **Coming soon**: only its panel shows.
   - Reload: Coming soon is still open.
   - Click **All games** again.
2. **Rows.**
   - Six rows, newest first: Ghost of Yōtei … God of War Ragnarök.
   - Ghost of Yōtei shows `NEW · 9d left`, `Never rented`, and `₱1,500 at a loss`.
   - Spider-Man 2 shows red `NT 0` and `TR 0` chips, `PS4 1`, `Stocked`, and `Buy NT ₱999`.
   - Tekken 8 shows `Sold out` and a Bundle tag.
   - Hogwarts Legacy shows a `PS4 0` chip (red).
3. **Filters.**
   - Click **💤 Never rented**: only Ghost of Yōtei and Hogwarts Legacy remain, and the `Showing 2 of 6 · Clear` line appears.
   - Set Platform to `PS4`: only Hogwarts Legacy remains.
   - Clear.
   - Type `action` in search: Ghost of Yōtei, Spider-Man 2 and God of War remain.
   - Clear.
4. **Sort.**
   - **Most earned**: God of War first (₱2,094), then Spider-Man 2 (₱698).
   - **A–Z**: Astro Bot first.
   - **Fewest slots left**: the sold-out Tekken 8 first.
   - Reload: the sort is remembered. Click Clear: the sort stays and the filters reset.
5. **No match.** Type `zzz`: `No games match these filters.` shows, and its Clear link restores the list.
6. **⋯ menu.**
   - Open a row's ⋯: it holds `📦 Mark as stocked` (or `📦 Clear stocked`) and `🗑 Delete`.
   - Click elsewhere: it closes. Don't submit either form.
7. **+ Add New → Price Category.** The Price categories sub-tab opens with the `+ New category` form expanded.
8. **Coming soon.**
   - Phantom Blade Zero shows `3 reserved` and `📅 Out since Sep 9, 2026 — ready to release`.
   - Read the Release prompt with `javascript_tool` instead of clicking: `document.querySelector('form[action="/admin/upcoming/release/15"]').getAttribute('onsubmit')` includes `3 paid reservations will move to sign-in.`
9. **Console.** `read_console_messages` with `onlyErrors: true` shows none.
10. **Phone.** Use `resize_window` preset `mobile`, then reload.
    - `innerWidth === 375` and `document.documentElement.scrollWidth <= visualViewport.width`. In mobile emulation an over-wide element widens the layout viewport itself, so comparing against `innerWidth` alone can hide an overflow.
    - Rows are cards.
    - Open a ⋯ menu: `getBoundingClientRect()` of `.gm-more[open] .gm-more-menu` has `left >= 0` and `right <= innerWidth`.
    - Reset with preset `desktop`.
11. **Light mode.** Open `http://localhost:4592/?light`: rows are white cards and the text is readable.

- [ ] **Step 3: Check the forms (`/edit` and `/add`)**

1. `/edit` shows five open sections: Basics, Slots, Prices, Images, Extras.
   - There's no Trophy switch, no Available Slots and no Current Renters.
   - PS4 Primary is visible, because the fixture is PS4/PS5.
   - Change Platform to PS5: PS4 Primary hides. Change it back: it reappears, still holding its value.
2. `/add`:
   - Basics, Slots and Prices are open; Images and Extras are closed.
   - PS4 Primary is hidden until Platform is PS4 or PS4/PS5.
   - Clicking a section header opens and closes it.
3. No console errors on either page.

- [ ] **Step 4: Clean up**

```bash
for pid in $(netstat -ano | grep ':4592' | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //F //PID "$pid"; done
rm -rf "$SCRATCH/gm-check"
cd "C:/Users/michael/Desktop/claude code/playstation-hub" && git status --short
```

Expected: nothing from this task. Only the long-standing untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` shows.

- [ ] **Step 5: Full regression run**

```bash
cd "C:/Users/michael/Desktop/claude code/playstation-hub"
for f in scripts/test-*.js; do timeout 120 node "$f" > "$SCRATCH/out.txt" 2>&1 || { echo "FAILED: $f"; tail -20 "$SCRATCH/out.txt"; }; done
```

Expected: no `FAILED:` line except `scripts/test-requests-page.js`. That one already failed before this work and is out of scope, so report it rather than fixing it.
