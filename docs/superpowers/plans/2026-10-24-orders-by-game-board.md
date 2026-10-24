# Orders "By game" board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin → Orders → Needs you shows the Waitlist and the Follow-ups as one "By game" board, with one card per game + account type. Cards with a free slot come first, tagged and open.

**Architecture:**
- **Grouping:** a new pure helper, `lib/needs-you-board.js` `buildBoard({ waitlist, followUps, slotsFree })`. It groups and orders the two lists into cards.
- **Server:** the `/admin` route works out each card's free slots from the counts the game page uses (`computeAvailability`) and from PS Plus's slot counts. It passes the cards to the view as `orderBoard`.
- **View:** `views/partials/admin/orders/needs-you.ejs` renders the cards in place of the two old groups. The row markup is unchanged.
- **Memory:** `public/js/admin-orders.js` remembers which cards are open.

**Tech Stack:** Express + EJS templates, plain browser JS (no build step), plain CSS. Tests are `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-24-orders-by-game-board-design.md` (amended after this plan's dry run).

**How this plan was checked.** Every file in this plan was dry-run in a scratch copy of the current `main`:
- Each new or changed test fails first and then passes.
- The full suite stays green apart from `scripts/test-upcoming-psn-page-public.js`, which also fails before this work.

A browser check ran on a throwaway instance with made-up entries modelled on the owner's screenshot:
- **Data:** Onimusha Trophy, Marvel's Wolverine Non-Trophy with 1 free slot, Wolverine Trophy, NBA2K27 both types, and a Ghost of Yotei Coming Soon follow-up.
- **Order and tags:** Wolverine Non-Trophy came first, tagged "🟢 1 slot free", and opened. The rest followed folded, most people first, with "1 didn't pay · Coming Soon" on the Coming Soon card.
- **Memory:** opening Onimusha and closing Wolverine survived a reload.
- **Actions:** ✅ Slot given inside a card worked. The card went to "1 waiting · 2 didn't pay".
- **Phone, 375px:** the slot tag and counts drop under the title, the buttons wrap, and nothing scrolls sideways.
- **Errors:** none in the console or the server log.

## Global Constraints

- Work directly on `main` and do not switch branches. **Push only when the owner says "push".**
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Line endings:**
  - `server.js` is CRLF + UTF-8 BOM.
  - These files are CRLF: `views/partials/admin/orders/needs-you.ejs`, `public/css/style.css` (a test checks every line), `scripts/test-orders-template.js`.
  - These files are LF: `public/js/admin-orders.js`, `scripts/test-admin-orders-filter.js` and the new files.
  - The edit scripts (via `.superpowers/tmp-edits/rep.js`) keep each file's endings and BOM.
  - Git stores LF blobs (`core.autocrlf=true`).
- **Cards:**
  - There is one card per `game_id + account_type`. Card keys look like `3|nt`, `psplus|tr`, `upcoming_4|tr` and `bundle_2|nt`.
  - A missing or unknown type counts as `nt`, and a missing title shows as `Unknown game`.
  - `kind` is `game` (a number id), `psplus`, `upcoming` or `bundle`.
- **Order of cards:** a free slot first, then most people (waiting + didn't pay), then title A–Z, then Trophy, Non-Trophy, PS4 Primary.
- **Order inside a card:**
  - **Waiting:** ⭐ priority (`reserved`) first, then oldest, then ref.
  - **Follow-ups:** newest first, then ref.
- **Free slots:**
  - Only `game` and `psplus` cards have them.
  - For a game, they come from `computeAvailability(game, accountSummary)` `ntSlots` / `trSlots` / `ps4Slots`. A PS4 Primary slot counts only when `showPs4`.
  - For PS Plus, they come from `getPsplusSlots()` `nt_slots` / `tr_slots` / `ps4_slots`.
  - Coming Soon, box-set and deleted-game cards never have them.
- **Copy, verbatim:**
  - Group heading: `By game`, with the total.
  - Group sub line: `<W> waiting · <F> didn't pay · <weekly funnel line>`. A zero part is left out.
  - Card counts: `<w> waiting · <f> didn't pay`, plus ` · Coming Soon` or ` · Box set`.
  - Free-slot tag: `🟢 1 slot free` / `🟢 2 slots free`.
  - Section labels: `Waiting · <w>` and `Started, didn't pay · <f>`.
- **Open state:**
  - The board group (`data-oq-group="bygame"`) starts open.
  - A card starts open only when it has a free slot.
  - Memory lives in `localStorage` (`oqGroups` for groups, `oqCards` for cards). Card keys must match `^[A-Za-z0-9_]{1,40}\|(tr|nt|ps4)$`, values must be booleans, and at most 300 are kept.
- **Unchanged:** every row's buttons, routes, forms, confirm prompts and copied messages. Only the meta line drops the game and type, which the card already shows. Do now, Just released, Refunds owed and the ledger are unchanged.
- **Test data:** tests use a temp `DATA_DIR`, a blank `MONGODB_URI`, the in-memory session store, a made-up admin password and an in-memory orders collection. Never touch the project's `games.json` or a database.
- **Known unrelated failure:** `scripts/test-upcoming-psn-page-public.js`. Report it; do not fix it.
- **Edit scripts:** they live in `.superpowers/tmp-edits/` (git-ignored). Never commit them. Task 4 removes the folder.
- **Committing:** always `git add` explicit paths. The untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.
- **Between Tasks 2 and 4,** the view expects `orderBoard`, which the server only passes from Task 4. The board is missing from a running admin until Task 4 lands. Do not push mid-plan.

## Files

| File | Task | Change |
|---|---|---|
| `lib/needs-you-board.js` (new) | 1 | `buildBoard`, `kindOf` |
| `scripts/test-needs-you-board.js` (new) | 1 | Grouping, ordering, free slots |
| `views/partials/admin/orders/needs-you.ejs` | 2 | The board replaces Follow-ups + Waitlist |
| `public/css/style.css` | 2 | `.oq-card*`, `.oq-row-wait`, `.oq-row-follow`, `.oq-group-bygame` |
| `scripts/test-orders-template.js` | 2 | The board's markup |
| `public/js/admin-orders.js` | 3 | `bygame` group key; `normalizeCards`, `initCards` |
| `scripts/test-admin-orders-filter.js` | 3 | Group and card memory |
| `server.js` | 4 | Free slots per card; `orderBoard` to the view |
| `scripts/test-orders-by-game.js` (new) | 4 | The real `/admin` route |

---

### Task 1: The grouping — `lib/needs-you-board.js`

**Files:**
- Create: `scripts/test-needs-you-board.js`, `lib/needs-you-board.js`

**Interfaces:**
- Consumes: nothing. The inputs are plain order objects with `ref`, `state`, `game_id`, `game_title`, `account_type` and `created_at`.
- Produces:
  - `require('./lib/needs-you-board').buildBoard({ waitlist, followUps, slotsFree })` → an array of cards `{ key, gameId, type, kind, title, slotsFree, waiting, followUps }`, sorted.
  - `kindOf(gameId)` → `'game' | 'psplus' | 'upcoming' | 'bundle'`.
  - `slotsFree` is `{ '<game_id>|<type>': n }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-needs-you-board.js`:

````js
// Run: node scripts/test-needs-you-board.js
//
// lib/needs-you-board.js buildBoard: the Waitlist and the Follow-ups grouped
// into one card per game + account type for Admin → Orders → Needs you → By
// game. Cards with a free slot first, then most people; inside a card the
// waiting people priority-then-oldest and the follow-ups newest first.
// See docs/superpowers/specs/2026-10-24-orders-by-game-board-design.md.
const assert = require('assert');
const { buildBoard } = require('../lib/needs-you-board');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const o = (ref, game_id, game_title, account_type, state, created_at, extra) =>
  Object.assign({ ref, game_id, game_title, account_type, state, created_at }, extra || {});

const waitlist = [
  o('PH-0189', 3, "Marvel's Wolverine", 'nt', 'reserved', '2026-09-29T00:00:00Z'),
  o('PH-0186', 3, "Marvel's Wolverine", 'nt', 'waitlisted', '2026-09-27T00:00:00Z'),
  o('PH-0182', 3, "Marvel's Wolverine", 'tr', 'waitlisted', '2026-09-27T00:00:00Z'),
  o('PH-0256', 1, 'Onimusha: Way of the Sword', 'tr', 'waitlisted', '2026-10-22T00:00:00Z'),
  o('PH-0087', 1, 'Onimusha: Way of the Sword', 'tr', 'waitlisted', '2026-09-07T00:00:00Z'),
  o('PH-0300', 'psplus', 'PS Plus Deluxe', 'nt', 'waitlisted', '2026-10-01T00:00:00Z')
];
const followUps = [
  o('PH-0261', 3, "Marvel's Wolverine", 'nt', 'awaiting_payment', '2026-10-23T00:00:00Z'),
  o('PH-0247', 3, "Marvel's Wolverine", 'nt', 'payment_rejected', '2026-10-21T00:00:00Z'),
  o('PH-0250', 'upcoming_4', 'Ghost of Yotei', 'tr', 'awaiting_payment', '2026-10-20T00:00:00Z', { is_reservation: true }),
  o('PH-0251', 'bundle_2', 'Spider-Man Box', 'nt', 'awaiting_payment', '2026-10-19T00:00:00Z', { is_buy: true }),
  o('PH-0252', 9, 'NBA2K27', 'nt', 'awaiting_payment', '2026-10-18T00:00:00Z')
];

ok('one card per game + account type, across games, PS Plus, Coming Soon and box sets', () => {
  const cards = buildBoard({ waitlist, followUps, slotsFree: {} });
  assert.deepStrictEqual(cards.map(c => c.key).sort(),
    ['1|tr', '3|nt', '3|tr', '9|nt', 'bundle_2|nt', 'psplus|nt', 'upcoming_4|tr']);
  const kinds = Object.fromEntries(cards.map(c => [c.key, c.kind]));
  assert.deepStrictEqual([kinds['3|nt'], kinds['psplus|nt'], kinds['upcoming_4|tr'], kinds['bundle_2|nt']], ['game', 'psplus', 'upcoming', 'bundle']);
  const w = cards.find(c => c.key === '3|nt');
  assert.deepStrictEqual([w.gameId, w.type, w.title], [3, 'nt', "Marvel's Wolverine"]);
});

ok('inside a card: waiting priority first then oldest; follow-ups newest first', () => {
  const w = buildBoard({ waitlist, followUps }).find(c => c.key === '3|nt');
  assert.deepStrictEqual(w.waiting.map(x => x.ref), ['PH-0189', 'PH-0186']);
  assert.deepStrictEqual(w.followUps.map(x => x.ref), ['PH-0261', 'PH-0247']);
  const on = buildBoard({ waitlist }).find(c => c.key === '1|tr');
  assert.deepStrictEqual(on.waiting.map(x => x.ref), ['PH-0087', 'PH-0256']);
  assert.deepStrictEqual(on.followUps, []);
});

ok('cards with a free slot first, then most people, then title A-Z, then Trophy, Non-Trophy, PS4', () => {
  const cards = buildBoard({ waitlist, followUps, slotsFree: { '9|nt': 1, '1|tr': 0 } });
  assert.deepStrictEqual(cards.map(c => c.key),
    ['9|nt', '3|nt', '1|tr', 'upcoming_4|tr', '3|tr', 'psplus|nt', 'bundle_2|nt']);
  const tie = buildBoard({ waitlist: [
    o('A1', 5, 'Same', 'nt', 'waitlisted', '2026-10-01T00:00:00Z'),
    o('A2', 5, 'Same', 'tr', 'waitlisted', '2026-10-01T00:00:00Z'),
    o('A3', 6, 'Alpha', 'ps4', 'waitlisted', '2026-10-01T00:00:00Z')
  ] });
  assert.deepStrictEqual(tie.map(c => c.key), ['6|ps4', '5|tr', '5|nt']);
});

ok('slotsFree counts only for released games and PS Plus, never below zero', () => {
  const cards = buildBoard({ waitlist, followUps, slotsFree: { '3|nt': 2, 'psplus|nt': 1, 'upcoming_4|tr': 3, 'bundle_2|nt': 1, '1|tr': -1 } });
  const free = Object.fromEntries(cards.map(c => [c.key, c.slotsFree]));
  assert.deepStrictEqual(free, { '3|nt': 2, 'psplus|nt': 1, 'upcoming_4|tr': 0, 'bundle_2|nt': 0, '1|tr': 0, '3|tr': 0, '9|nt': 0 });
});

ok('empty or missing input gives no cards; a missing title and type still group', () => {
  assert.deepStrictEqual(buildBoard(), []);
  assert.deepStrictEqual(buildBoard({ waitlist: null, followUps: [null] }), []);
  const [c] = buildBoard({ followUps: [o('PH-0400', 77, '', undefined, 'awaiting_payment', '2026-10-01T00:00:00Z')] });
  assert.deepStrictEqual([c.key, c.type, c.title], ['77|nt', 'nt', 'Unknown game']);
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-needs-you-board.js` → FAIL `Error: Cannot find module '../lib/needs-you-board'`.

- [ ] **Step 3: Write the helper**

Create `lib/needs-you-board.js`:

````js
// Admin → Orders → Needs you → "By game": the Waitlist and the Follow-ups
// (started but not paid) grouped into one card per game + account type — the
// scope a slot actually opens in, so everyone the owner may message about one
// slot sits together. Pure: no Express, no database. server.js passes the
// cards to views/partials/admin/orders/needs-you.ejs, which only renders.
// See docs/superpowers/specs/2026-10-24-orders-by-game-board-design.md.

// Trophy, Non-Trophy, PS4 Primary: the order two cards of one game sit in.
const TYPE_ORDER = ['tr', 'nt', 'ps4'];

// What an order's game_id says about where it came from. Only a released game
// and PS Plus have slots that can be "free right now".
function kindOf(gameId) {
  const id = String(gameId);
  if (id === 'psplus') return 'psplus';
  if (id.indexOf('upcoming_') === 0) return 'upcoming';
  if (id.indexOf('bundle_') === 0) return 'bundle';
  return 'game';
}

const time = o => Date.parse((o && o.created_at) || '') || 0;
const byRef = (a, b) => String(a.ref).localeCompare(String(b.ref));

// The line's own order (queueRules.buildQueue): ⭐ priority first, then oldest.
function waitingOrder(a, b) {
  const ta = a.state === 'reserved' ? 0 : 1;
  const tb = b.state === 'reserved' ? 0 : 1;
  return (ta - tb) || (time(a) - time(b)) || byRef(a, b);
}

// Follow-ups newest first, as the old Follow-ups list was.
function followUpOrder(a, b) {
  return (time(b) - time(a)) || byRef(a, b);
}

// `slotsFree` maps '<game_id>|<type>' to how many slots of that type are free
// now (server.js reads the same counts the game page shows). Cards with a free
// slot come first, then the most people, then title A-Z, then Trophy before
// Non-Trophy before PS4 Primary.
function buildBoard(input) {
  const { waitlist, followUps, slotsFree } = input || {};
  const free = slotsFree || {};
  const cards = new Map();
  function cardFor(o) {
    const type = TYPE_ORDER.indexOf(o.account_type) !== -1 ? o.account_type : 'nt';
    const key = String(o.game_id) + '|' + type;
    if (!cards.has(key)) {
      cards.set(key, {
        key, gameId: o.game_id, type, kind: kindOf(o.game_id),
        title: o.game_title || 'Unknown game', slotsFree: 0, waiting: [], followUps: []
      });
    }
    return cards.get(key);
  }
  (waitlist || []).forEach(o => { if (o) cardFor(o).waiting.push(o); });
  (followUps || []).forEach(o => { if (o) cardFor(o).followUps.push(o); });

  const out = Array.from(cards.values());
  out.forEach(c => {
    const hasSlots = c.kind === 'game' || c.kind === 'psplus';
    c.slotsFree = hasSlots ? Math.max(0, Math.floor(Number(free[c.key]) || 0)) : 0;
    c.waiting.sort(waitingOrder);
    c.followUps.sort(followUpOrder);
  });
  const people = c => c.waiting.length + c.followUps.length;
  return out.sort((a, b) =>
    ((b.slotsFree > 0) - (a.slotsFree > 0)) ||
    (people(b) - people(a)) ||
    a.title.localeCompare(b.title) ||
    (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)));
}

module.exports = { buildBoard, kindOf };
````

- [ ] **Step 4: Run it and watch it pass**

Run: `node scripts/test-needs-you-board.js` → `5 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/needs-you-board.js scripts/test-needs-you-board.js
git commit -m "Orders: buildBoard groups the waitlist and follow-ups per game and account type

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The board in the Orders tab

**Files:**
- Create: `.superpowers/tmp-edits/rep.js`, `.superpowers/tmp-edits/edit-board-template-test.js`, `.superpowers/tmp-edits/edit-board-view.js`
- Modify (edit script): `scripts/test-orders-template.js`, `views/partials/admin/orders/needs-you.ejs`, `public/css/style.css`

**Interfaces:**
- Consumes:
  - `buildBoard` (Task 1).
  - The view's existing helpers `nyType`, `nyPayLine`, `nyFunnel` and `reminderBadge`.
  - The row markup of the old Follow-ups and Waitlist groups.
- Produces:
  - The view reads the local `orderBoard` (the cards from `buildBoard`; absent means no board).
  - Markup hooks: `data-oq-group="bygame"`, `<details class="oq-card[ oq-card-free]" data-oq-card="<key>"[ open]>`.
  - CSS classes `.oq-card`, `.oq-card-free`, `.oq-card-h`, `.oq-card-title`, `.oq-card-type`, `.oq-card-type-tr`, `.oq-card-type-nt`, `.oq-card-type-ps4`, `.oq-card-free-tag`, `.oq-card-n`, `.oq-card-body`, `.oq-card-lbl`, `.oq-row-wait`, `.oq-row-follow`, `.oq-group-bygame`.

- [ ] **Step 1: Write the failing checks**

Create `.superpowers/tmp-edits/rep.js`. It keeps a file's BOM and CRLF, fails loudly on a missing or repeated anchor, and every later task reuses it:

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

Create `.superpowers/tmp-edits/edit-board-template-test.js`:

````js
// Task 2, step 1: the Orders tab template test for the "By game" board that
// replaces the Follow-ups and Waitlist groups. The fixture builds the board
// with the real lib/needs-you-board.js, the way server.js does. Keeps the
// file's line endings.
const rep = require('./rep');
const T = 'scripts/test-orders-template.js';

rep(T,
`const ejs = require('ejs');
`,
`const ejs = require('ejs');
const { buildBoard } = require('../lib/needs-you-board');
`);

rep(T,
`      lo('PH-0110', 'awaiting_payment', { created_at: '2026-09-20T00:00:00Z', fb_name: 'Eli Tan' }),
      lo('PH-0111', 'payment_rejected', { created_at: '2026-09-24T00:00:00Z', fb_name: 'Fay Ong', account_type: 'tr', days: 7, deposit_due: 100, psid: '456' })`,
`      lo('PH-0110', 'awaiting_payment', { game_id: 5, created_at: '2026-09-20T00:00:00Z', fb_name: 'Eli Tan' }),
      lo('PH-0111', 'payment_rejected', { game_id: 5, created_at: '2026-09-24T00:00:00Z', fb_name: 'Fay Ong', account_type: 'tr', days: 7, deposit_due: 100, psid: '456' })`);

rep(T,
`    settings: { owner_online: true, payment_methods: [{ key: 'gcash', label: 'GCash', enabled: true }] }
  }, over || {});
}`,
`    settings: { owner_online: true, payment_methods: [{ key: 'gcash', label: 'GCash', enabled: true }] }
  }, over || {});
  // server.js builds the board from these same two lists; a test that passes
  // its own orderBoard (or slotsFree) keeps it.
  if (!f.orderBoard) {
    f.orderBoard = buildBoard({ waitlist: f.waitlistOrders, followUps: f.abandonedOrders, slotsFree: f.slotsFree || {} });
  }
  return f;
}`);

rep(T,
`function fixture(over) {
  const ledgerOrders = [`,
`function fixture(over) {
  let f;
  const ledgerOrders = [`);

rep(T,
`  return Object.assign({
    orderQueue: [`,
`  f = Object.assign({
    orderQueue: [`);

rep.between(T,
`ok('Follow-ups newest first; Waitlist priority first', () => {`,
`  assert.ok(groupBlock(html, 'followups').includes('2 of 5 started this week · 12% of game views'));
});`,
`ok('By game: one card per game + type; waiting priority first, then follow-ups newest first', () => {
  const board = groupBlock(html, 'bygame');
  assert.deepStrictEqual(refsIn(board), ['PH-0121', 'PH-0120', 'PH-0110', 'PH-0111']);
  assert.deepStrictEqual([...board.matchAll(/data-oq-card="([^"]+)"/g)].map(m => m[1]), ['5|nt', '5|tr']);
});

ok('Do now, Refunds and By game start open; the old Follow-ups and Waitlist groups are gone', () => {
  assert.ok(html.includes('data-oq-group="now" open>'));
  assert.ok(html.includes('data-oq-group="refunds" open>'));
  assert.ok(html.includes('data-oq-group="bygame" open>'));
  assert.ok(!html.includes('data-oq-group="followups"') && !html.includes('data-oq-group="waitlist"'));
});

ok('the By game heading: total, waiting and didn\\'t-pay counts, then the weekly funnel line', () => {
  const h = /<summary class="oq-group-h"><span class="oq-group-name">By game<\\/span>[\\s\\S]*?<\\/summary>/.exec(groupBlock(html, 'bygame'))[0];
  assert.ok(h.includes('<span class="oq-group-n">4</span>'));
  assert.ok(h.includes('<span class="oq-group-sub">2 waiting · 2 didn&#39;t pay · 2 of 5 started this week · 12% of game views</span>'));
});`);

rep(T,
`  const visible = outsideMenus(groupBlock(html, 'waitlist'));`,
`  const visible = outsideMenus(groupBlock(html, 'bygame'));`);
rep(T,
`  const inMenus = menus(groupBlock(html, 'waitlist'));`,
`  const inMenus = menus(groupBlock(html, 'bygame'));`);
rep(T,
`  assert.ok(!outsideMenus(groupBlock(html, 'waitlist')).includes('/rename'), 'not outside the menu');`,
`  assert.ok(!outsideMenus(groupBlock(html, 'bygame')).includes('/rename'), 'not outside the menu');`);
rep(T,
`  const m = menus(groupBlock(paidOnSite, 'waitlist'));`,
`  const m = menus(groupBlock(paidOnSite, 'bygame'));`);

rep(T,
`console.log('\\nwaitlist: slot given and edit name');`,
`console.log('\\nBy game cards');

// One card's markup, from its <details> to the next card or the board's end.
function cardBlock(s, key) {
  const start = s.indexOf('data-oq-card="' + key + '"');
  if (start < 0) return '';
  const next = s.indexOf('data-oq-card="', start + 10);
  return s.slice(start, next > 0 ? next : undefined);
}

ok('a card line: title, type tag and counts; a section per kind of person', () => {
  const nt = cardBlock(html, '5|nt');
  assert.ok(nt.includes('<span class="oq-card-title">Tekken 8</span>'));
  assert.ok(nt.includes('<span class="oq-card-type oq-card-type-nt">Non-Trophy</span>'));
  assert.ok(nt.includes('<span class="oq-card-n">2 waiting · 1 didn&#39;t pay</span>'));
  assert.ok(nt.includes('<div class="oq-card-lbl">Waiting · 2</div>') && nt.includes('<div class="oq-card-lbl">Started, didn\\'t pay · 1</div>'));
  const tr = cardBlock(html, '5|tr');
  assert.ok(tr.includes('<span class="oq-card-type oq-card-type-tr">Trophy</span>') && tr.includes('<span class="oq-card-n">1 didn&#39;t pay</span>'));
  assert.ok(!tr.includes('Waiting ·'), 'no empty section');
});

ok('rows drop the game and type the card already shows; the copied messages keep them', () => {
  const nt = cardBlock(html, '5|nt');
  assert.ok(!/<div class="oq-meta">\\s*Tekken 8/.test(nt), 'no game in the meta line');
  assert.ok(/<div class="oq-meta">\\s*Monthly ·\\s*⭐ Priority — paid/.test(nt));
  assert.ok(/<div class="oq-meta">\\s*Monthly · ₱349/.test(nt));
  assert.ok(nt.includes('A slot just opened up for Tekken 8 (Non-Trophy, Monthly)'));
  assert.ok(nt.includes('🎮 Tekken 8 (Non-Trophy)'));
});

ok('a card with a free slot is tagged, goes first and starts open; the others start folded', () => {
  const freeHtml = render({ slotsFree: { '5|tr': 2 } });
  const board = groupBlock(freeHtml, 'bygame');
  assert.deepStrictEqual([...board.matchAll(/data-oq-card="([^"]+)"/g)].map(m => m[1]), ['5|tr', '5|nt']);
  assert.ok(board.includes('<details class="oq-card oq-card-free" data-oq-card="5|tr" open>'));
  assert.ok(cardBlock(freeHtml, '5|tr').includes('<span class="oq-card-free-tag">🟢 2 slots free</span>'));
  assert.ok(board.includes('<details class="oq-card" data-oq-card="5|nt">'));
  const one = render({ slotsFree: { '5|nt': 1 } });
  assert.ok(cardBlock(one, '5|nt').includes('🟢 1 slot free</span>'));
});

ok('Coming Soon and box-set cards say so; nothing to show means no board', () => {
  const kinds = render({ waitlistOrders: [], abandonedOrders: [
    lo('PH-0140', 'awaiting_payment', { game_id: 'upcoming_4', game_title: 'Ghost of Yotei', account_type: 'tr', is_reservation: true }),
    lo('PH-0141', 'awaiting_payment', { game_id: 'bundle_2', game_title: 'Spider-Man Box', is_buy: true, days: null })
  ] });
  assert.ok(cardBlock(kinds, 'upcoming_4|tr').includes('<span class="oq-card-n">1 didn&#39;t pay · Coming Soon</span>'));
  assert.ok(cardBlock(kinds, 'bundle_2|nt').includes('<span class="oq-card-n">1 didn&#39;t pay · Box set</span>'));
  assert.ok(!render({ waitlistOrders: [], abandonedOrders: [] }).includes('data-oq-group="bygame"'));
});

console.log('\\nwaitlist: slot given and edit name');`);

console.log('edited test-orders-template.js');
````

Run: `node .superpowers/tmp-edits/edit-board-template-test.js` → `edited test-orders-template.js`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-orders-template.js` → FAIL `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` (there is no By game board yet).

- [ ] **Step 3: The board and its styles**

Create `.superpowers/tmp-edits/edit-board-view.js`:

````js
// Task 2: the "By game" board replaces the Follow-ups and Waitlist groups in
// views/partials/admin/orders/needs-you.ejs — one card per game + account type
// from the `orderBoard` local (lib/needs-you-board.js) — and its styles. Row
// markup, forms and prompts are the old lists' own; only the meta line drops
// the game and type the card already shows. Keeps each file's line endings.
const rep = require('./rep');
const N = 'views/partials/admin/orders/needs-you.ejs';

rep(N,
`  Needs You: every row that wants a click from the owner, in five groups —
  Do now, Just released (reservations a release moved on to sign-in),
  Refunds owed, Follow-ups (started but didn't pay) and Waitlist.`,
`  Needs You: every row that wants a click from the owner, in four groups —
  Do now, Just released (reservations a release moved on to sign-in),
  Refunds owed, and By game: the Waitlist and the Follow-ups (started but
  didn't pay) as one card per game + account type (lib/needs-you-board.js).`);

rep.between(N,
`  const nyFollowUps = [...(abandonedOrders || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));`,
`    return String(a.ref).localeCompare(String(b.ref));
  });`,
`  // Waitlist + Follow-ups, already grouped and ordered by server.js with
  // lib/needs-you-board.js: cards with a free slot first, then most people.
  const nyBoard = (typeof orderBoard !== 'undefined' && orderBoard) || [];
  const nyWaitingN = nyBoard.reduce((n, c) => n + c.waiting.length, 0);
  const nyFollowN = nyBoard.reduce((n, c) => n + c.followUps.length, 0);`);

rep(N,
`  // Only the groups that have to be cleared count toward the headline (and
  // the sidebar badge in views/admin.ejs). Follow-ups and the waitlist never
  // "finish" the way a payment check does, so they carry their own counts.`,
`  // Only the groups that have to be cleared count toward the headline (and
  // the sidebar badge in views/admin.ejs). Follow-ups and the waitlist never
  // "finish" the way a payment check does, so the By game board carries its
  // own counts.`);

rep(N,
`<% if (!nyDoNow.length && !nyReleased.length && !nyRefunds.length && !nyFollowUps.length && !nyWaitlist.length) { %>`,
`<% if (!nyDoNow.length && !nyReleased.length && !nyRefunds.length && !nyBoard.length) { %>`);

rep.between(N,
`<% if (nyFollowUps.length) { %>`,
`          <% } %>
        </div>
      </details>
    </div>
  </div>
  <% }) %>
</details>
<% } %>`,
`<% if (nyBoard.length) { %>
<%# One card per game + account type: who is waiting for that slot and who
    started an order for it but didn't pay. A card with a free slot starts
    open; public/js/admin-orders.js remembers each card the owner opens or
    closes, keyed by its data-oq-card. %>
<details class="oq-group oq-group-bygame" data-oq-group="bygame" open>
  <summary class="oq-group-h"><span class="oq-group-name">By game</span><span class="oq-group-n"><%= nyWaitingN + nyFollowN %></span><span class="oq-group-sub"><%= [nyWaitingN ? nyWaitingN + ' waiting' : '', nyFollowN ? nyFollowN + " didn't pay" : '', nyFunnel].filter(Boolean).join(' · ') %></span></summary>
  <% nyBoard.forEach(card => {
    const cardCount = [
      card.waiting.length ? card.waiting.length + ' waiting' : '',
      card.followUps.length ? card.followUps.length + " didn't pay" : '',
      card.kind === 'upcoming' ? 'Coming Soon' : card.kind === 'bundle' ? 'Box set' : ''
    ].filter(Boolean).join(' · ');
  %>
  <details class="oq-card<%= card.slotsFree ? ' oq-card-free' : '' %>" data-oq-card="<%= card.key %>"<%= card.slotsFree ? ' open' : '' %>>
    <summary class="oq-card-h">
      <span class="oq-card-title"><%= card.title %></span>
      <span class="oq-card-type oq-card-type-<%= card.type %>"><%= nyType(card.type) %></span>
      <% if (card.slotsFree) { %><span class="oq-card-free-tag">🟢 <%= card.slotsFree %> slot<%= card.slotsFree === 1 ? '' : 's' %> free</span><% } %>
      <span class="oq-card-n"><%= cardCount %></span>
    </summary>
    <div class="oq-card-body">
  <% if (card.waiting.length) { %>
  <div class="oq-card-lbl">Waiting · <%= card.waiting.length %></div>
  <% card.waiting.forEach(o => {
    const wlTypeLabel = nyType(o.account_type);
    const wlDurLabel = o.days === 7 ? 'Weekly' : 'Monthly';
    const wlFirstName = (o.fb_name || '').trim().split(/\\s+/)[0] || 'there';
    const wlMsg = '👋 Hi ' + wlFirstName + '! A slot just opened up for ' + o.game_title + ' (' + wlTypeLabel + ', ' + wlDurLabel + ') —\\n\\n'
      + 'Still want it? Reply here and we\\'ll get you set up.\\n\\n'
      + '🔖 Reference: ' + o.ref;
    const wlPriority = o.state === 'reserved';
  %>
  <div class="oq-row oq-row-wait">
    <div class="oq-main">
      <div class="oq-top">
        <%# queuePosition comes from queueRules.buildQueue on the server — the
            exact function that numbers this same order on the customer's own
            page. null means an expired free entry: still shown, but no longer
            counted toward anyone's position. %>
        <span class="oq-wl-pos"><%= o.queuePosition ? '#' + o.queuePosition : (o.queueExpired ? '—' : '#?') %></span>
        <span class="oq-ref"><%= o.ref %></span>
        <span class="oq-ab-name"><%= o.fb_name %></span>
        <span class="oq-ab-age" data-created="<%= o.created_at %>">--</span>
      </div>
      <div class="oq-meta">
        <%= wlDurLabel %> ·
        <%= wlPriority ? '⭐ Priority — paid' : 'Free entry' %><%= o.queueExpired ? ' · waiting 30+ days' : '' %>
      </div>
    </div>
    <div class="oq-actions">
      <button type="button" class="oq-btn-ghost rem-copy" data-msg="<%= wlMsg %>" title="Copy slot-open message">📋 Copy</button>
      <%# They got their account (the rental is recorded with Quick Add), so the
          entry leaves the line. A priority ₱100 stops counting as money because
          the Quick Add rent already includes it. %>
      <form method="POST" action="/admin/orders/<%= o.ref %>/slot-given" onsubmit="return confirm('Mark the slot as given to ' + <%= JSON.stringify(o.fb_name || '') %> + ' (' + <%= JSON.stringify(o.ref) %> + ')?\\n\\nThey leave the line and the record is kept. A ₱100 priority fee stops counting as money — it\\'s already in the rent you recorded.');">
        <button type="submit" class="oq-btn-given" title="They got their account — take them off the waiting list">✅ Slot given</button>
      </form>
      <% if (!wlPriority) { %>
      <%# For a ₱100 that arrived over Messenger or GCash rather than through
          the site. Confirms first because it books money and moves them above
          everyone still on a free entry. %>
      <form method="POST" action="/admin/orders/<%= o.ref %>/priority-paid" onsubmit="return confirm('Mark ' + <%= JSON.stringify(o.ref) %> + ' as priority paid?\\n\\nUse this when they sent the ₱100 outside the site. They move above everyone on a free entry, and the rest of the rent is still owed when a slot opens.');">
        <button type="submit" class="oq-btn-pri" title="They paid the ₱100 priority fee outside the site">⭐ Priority paid</button>
      </form>
      <% } %>
      <details class="oq-more">
        <summary class="oq-more-btn" title="More actions" aria-label="More actions">⋯</summary>
        <div class="oq-more-menu">
          <%# Fixes a typo or nickname. Only the name changes — the ref and the
              place in line stay put. %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/rename" class="oq-rename">
            <label class="oq-rename-lbl" for="oqName-<%= o.ref %>">✏️ Edit name</label>
            <input type="text" id="oqName-<%= o.ref %>" name="fb_name" value="<%= o.fb_name %>" maxlength="80" required class="oq-rename-input">
            <button type="submit" class="oq-rename-save">Save</button>
          </form>
          <% if (wlPriority && o.upgraded_from_waitlist) { %>
          <%# Undo puts them back on the free list at their original join date.
              Only offered on the flag the priority upgrade itself sets. %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/undo-priority" onsubmit="return confirm('Undo priority for ' + <%= JSON.stringify(o.ref) %> + '?\\n\\nThey go back to a free waiting-list entry, keeping their reference and their place in line. Use this if the ₱100 never actually arrived.');">
            <button type="submit" class="oq-more-item" title="Put this customer back on the free waiting list">↩ Undo priority</button>
          </form>
          <% } else if (!wlPriority) { %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/cancel" onsubmit="return confirm('Remove ' + <%= JSON.stringify(o.ref) %> + ' from the waiting list?');">
            <button type="submit" class="oq-more-item oq-more-danger" title="Remove this waitlist entry">Remove</button>
          </form>
          <% } %>
        </div>
      </details>
    </div>
  </div>
  <% }) %>
  <% } %>
  <% if (card.followUps.length) { %>
  <div class="oq-card-lbl">Started, didn't pay · <%= card.followUps.length %></div>
  <% card.followUps.forEach(o => {
    const abTypeLabel = nyType(o.account_type);
    const abDurLabel = o.is_buy ? 'One-time purchase' : (o.days === 7 ? 'Weekly' : 'Monthly');
    const abTotal = (o.amount_due || 0) + (o.deposit_due || 0);
    const firstName = (o.fb_name || '').trim().split(/\\s+/)[0] || 'there';
    const followUpMsg = '👋 Hi ' + firstName + '! Saw you started an order with us —\\n\\n'
      + '🎮 ' + o.game_title + ' (' + abTypeLabel + ')\\n'
      + (o.is_buy ? '🛒 One-time purchase\\n' : '⏱ ' + abDurLabel + ' rental\\n')
      + '💰 Total: ₱' + abTotal + (o.deposit_due > 0 ? ' (₱' + (o.amount_due || 0) + ' rent + ₱' + o.deposit_due + ' refundable deposit)' : '') + '\\n'
      + '🔖 Reference: ' + o.ref + '\\n\\n'
      + 'Still want it? ' + nyPayLine + '\\n\\n'
      + 'No worries if you changed your mind, just let us know!';
  %>
  <div class="oq-row oq-row-follow">
    <div class="oq-main">
      <div class="oq-top">
        <span class="oq-ref"><%= o.ref %></span>
        <% const reminded = (typeof reminderBadge === 'function') ? reminderBadge(o) : null; %>
        <% if (reminded) { %><span class="rem-badge <%= reminded === 'last_call' ? 'rem-today' : 'rem-tomorrow' %>"><%= reminded === 'last_call' ? 'Last call' : 'Reminded' %></span><% } %>
        <span class="oq-ab-name"><%= o.fb_name %></span>
        <span class="oq-ab-age" data-created="<%= o.created_at %>">--</span>
      </div>
      <div class="oq-meta">
        <%= abDurLabel %> · ₱<%= abTotal %>
        <% if (o.state === 'payment_rejected') { %>· <span class="oq-ab-rejected">payment rejected</span><% } %>
        <%# Only present when they arrived via the Messenger bot; a customer who
            typed straight into the website has no psid to open a thread with. %>
        <% if (o.psid) { %>· <a class="oq-thread" href="https://www.facebook.com/messages/t/<%= o.psid %>" target="_blank" rel="noopener">open chat →</a><% } %>
      </div>
    </div>
    <div class="oq-actions">
      <button type="button" class="oq-btn-ghost rem-copy" data-msg="<%= followUpMsg %>" title="Copy follow-up message">📋 Copy</button>
      <form method="POST" action="/admin/orders/<%= o.ref %>/mark-paid" onsubmit="return confirm('Mark order ' + <%= JSON.stringify(o.ref) %> + ' as paid? Use this when the customer paid outside the site (e.g. Messenger). They\\'ll still need to send their sign-in QR.');">
        <button type="submit" class="oq-btn-go" title="Confirm this order was paid outside the site">✅ Mark paid</button>
      </form>
      <details class="oq-more">
        <summary class="oq-more-btn" title="More actions" aria-label="More actions">⋯</summary>
        <div class="oq-more-menu">
          <% if (process.env.PAYMONGO_SECRET_KEY) { %>
          <button type="button" class="oq-more-item oq-paylink" data-ref="<%= o.ref %>" title="Create a PayMongo checkout link and copy it — paste into Messenger">💳 Payment link</button>
          <% } %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/cancel" onsubmit="return confirm('Cancel order ' + <%= JSON.stringify(o.ref) %> + '? The customer said no or never followed up. The record is kept, unlike Delete.');">
            <button type="submit" class="oq-more-item" title="Cancel this order — the customer declined or never paid">Cancel</button>
          </form>
          <form method="POST" action="/admin/orders/<%= o.ref %>/delete" onsubmit="return confirm('Delete order ' + <%= JSON.stringify(o.ref) %> + '? Its customer record and money go too. Use this to clear out duplicate or accidental orders. This cannot be undone.');">
            <button type="submit" class="oq-more-item oq-more-danger" title="Delete this order (e.g. a duplicate from the customer re-ordering)">Delete</button>
          </form>
        </div>
      </details>
    </div>
  </div>
  <% }) %>
  <% } %>
    </div>
  </details>
  <% }) %>
</details>
<% } %>`);

const C = 'public/css/style.css';
rep(C,
`.oq-group-refunds .oq-row, .oq-group-followups .oq-row { border-left:3px solid #f59e0b; }
.oq-group-waitlist .oq-row { border-left:3px solid #3a3a3a; }
`,
`.oq-group-refunds .oq-row { border-left:3px solid #f59e0b; }
/* By game: one card per game + account type (views/partials/admin/orders/needs-you.ejs). */
.oq-group-bygame { margin-top: 0.2rem; }
.oq-card { background: #111; border: 1px solid #242424; border-radius: 12px; margin-bottom: 0.5rem; }
.oq-card-free { border-color: rgba(34,197,94,0.45); }
.oq-card-h { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; list-style: none; cursor: pointer; padding: 0.65rem 0.85rem; }
.oq-card-h::-webkit-details-marker { display: none; }
.oq-card-h::before { content: '▸'; color: #666; font-size: 0.7rem; transition: transform 0.15s; }
.oq-card[open] > .oq-card-h::before { transform: rotate(90deg); }
.oq-card-title { font-weight: 800; color: #f2f2f2; font-size: 0.88rem; }
.oq-card-type { font-size: 0.7rem; font-weight: 700; border-radius: 20px; padding: 0.08rem 0.55rem; }
.oq-card-type-tr { background: rgba(255,196,0,0.12); color: #ffc400; }
.oq-card-type-nt { background: rgba(124,92,255,0.15); color: #b9a6ff; }
.oq-card-type-ps4 { background: #1e1e1e; color: #aaa; }
.oq-card-free-tag { font-size: 0.7rem; font-weight: 800; border-radius: 20px; padding: 0.08rem 0.55rem; background: rgba(34,197,94,0.15); color: #22c55e; }
.oq-card-n { margin-left: auto; font-size: 0.72rem; font-weight: 600; color: #888; white-space: nowrap; }
.oq-card-body { padding: 0 0.7rem 0.3rem; }
.oq-card-lbl { font-size: 0.66rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #777; margin: 0.35rem 0.15rem 0.45rem; }
.oq-row-wait { border-left: 3px solid #3a3a3a; }
.oq-row-follow { border-left: 3px solid #f59e0b; }
body.light-mode .oq-card { background: #fff; border-color: #e2e2e2; }
body.light-mode .oq-card-free { border-color: rgba(22,163,74,0.5); }
body.light-mode .oq-card-title { color: #111; }
body.light-mode .oq-card-n, body.light-mode .oq-card-lbl { color: #666; }
@media (max-width: 600px) { .oq-card-n { margin-left: 0; width: 100%; white-space: normal; } }
`);
console.log('edited needs-you.ejs, style.css');
````

Run: `node .superpowers/tmp-edits/edit-board-view.js` → `edited needs-you.ejs, style.css`.

- [ ] **Step 4: Run them and watch them pass**

Run: `node scripts/test-orders-template.js && node scripts/test-needs-you-board.js` → `41`, `5 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add views/partials/admin/orders/needs-you.ejs public/css/style.css scripts/test-orders-template.js
git commit -m "Orders: one By game board with a card per game and account type replaces Follow-ups and Waitlist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Remember which cards are open

**Files:**
- Create: `.superpowers/tmp-edits/edit-board-memory-test.js`, `.superpowers/tmp-edits/edit-board-memory.js`
- Modify (edit script): `scripts/test-admin-orders-filter.js`, `public/js/admin-orders.js`

**Interfaces:**
- Consumes: `details[data-oq-card]` and `details[data-oq-group="bygame"]` (Task 2); `.superpowers/tmp-edits/rep.js` (Task 2).
- Produces:
  - `GROUP_KEYS` = `['now', 'released', 'refunds', 'bygame']`.
  - `window.__oqFilter.normalizeCards(raw)` → `{ key: boolean }`.
  - Card memory in `localStorage['oqCards']`.

- [ ] **Step 1: Write the failing tests**

Create `.superpowers/tmp-edits/edit-board-memory-test.js`:

````js
// Task 3, step 1: tests for the By game board's open/closed memory in
// public/js/admin-orders.js — the group list now has 'bygame' instead of
// 'followups' and 'waitlist', and each card remembers its own state under its
// game_id|type key (normalizeCards). Keeps the file's line endings.
const rep = require('./rep');
const T = 'scripts/test-admin-orders-filter.js';

rep(T,
`ok('keeps only known groups with boolean values', () => {
  assert.deepStrictEqual(plain(F.normalizeGroups({ now: false, waitlist: true, followups: 'yes', bogus: true })),
    { now: false, waitlist: true });
});`,
`ok('keeps only known groups with boolean values', () => {
  assert.deepStrictEqual(plain(F.normalizeGroups({ now: false, bygame: true, refunds: 'yes', bogus: true })),
    { now: false, bygame: true });
});

ok('the old Follow-ups and Waitlist groups are forgotten — the By game board replaced them', () => {
  assert.deepStrictEqual(plain(F.normalizeGroups({ followups: true, waitlist: false })), {});
});`);

rep(T,
`console.log('\\nwiring');`,
`console.log('\\nnormalizeCards()');

ok('keeps game_id|type keys with boolean values, for every kind of card', () => {
  assert.deepStrictEqual(plain(F.normalizeCards({
    '3|nt': true, '12|tr': false, 'psplus|ps4': true, 'upcoming_4|tr': false, 'bundle_2|nt': true
  })), { '3|nt': true, '12|tr': false, 'psplus|ps4': true, 'upcoming_4|tr': false, 'bundle_2|nt': true });
});

ok('drops anything else: other values, unknown types, odd keys', () => {
  assert.deepStrictEqual(plain(F.normalizeCards({
    '3|nt': 'yes', '3|xx': true, '3': true, '<b>|nt': true, '3|tr|x': true, '7|tr': false
  })), { '7|tr': false });
  assert.deepStrictEqual(plain(F.normalizeCards(null)), {});
  assert.deepStrictEqual(plain(F.normalizeCards('x')), {});
});

ok('keeps at most 300 cards so the memory cannot grow without end', () => {
  const many = {};
  for (let i = 0; i < 400; i++) many[i + '|nt'] = true;
  assert.strictEqual(Object.keys(plain(F.normalizeCards(many))).length, 300);
});

console.log('\\nwiring');`);

console.log('edited test-admin-orders-filter.js');
````

Run: `node .superpowers/tmp-edits/edit-board-memory-test.js` → `edited test-admin-orders-filter.js`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-admin-orders-filter.js` → FAIL `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` (`bygame` is not a known group yet).

- [ ] **Step 3: The memory**

Create `.superpowers/tmp-edits/edit-board-memory.js`:

````js
// Task 3: public/js/admin-orders.js remembers the By game board — the group
// key 'bygame' replaces 'followups' and 'waitlist', and every card keeps its
// own open/closed state under its game_id|type key. Keeps the file's endings.
const rep = require('./rep');
const J = 'public/js/admin-orders.js';

rep(J,
`// for the session, Needs You group open/closed memory, the QR countdowns and`,
`// for the session, Needs You group and By game card open/closed memory, the QR countdowns and`);

rep(J,
`  var GROUP_KEYS = ['now', 'released', 'refunds', 'followups', 'waitlist'];
  var LEDGER_KEY = 'oqLedger';
  var GROUPS_KEY = 'oqGroups';`,
`  var GROUP_KEYS = ['now', 'released', 'refunds', 'bygame'];
  var LEDGER_KEY = 'oqLedger';
  var GROUPS_KEY = 'oqGroups';
  // By game cards (views/partials/admin/orders/needs-you.ejs data-oq-card):
  // '<game_id>|<type>', e.g. '3|nt', 'psplus|tr', 'upcoming_4|tr'.
  var CARDS_KEY = 'oqCards';
  var CARD_KEY_RE = /^[A-Za-z0-9_]{1,40}\\|(tr|nt|ps4)$/;
  var MAX_CARDS = 300;`);

rep(J,
`  window.__oqFilter = {`,
`  // Same rule for the cards: only well-formed keys with boolean values, and a
  // cap so years of games cannot grow the stored object without end.
  function normalizeCards(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    var n = 0;
    Object.keys(raw).forEach(function (k) {
      if (n >= MAX_CARDS) return;
      if (CARD_KEY_RE.test(k) && typeof raw[k] === 'boolean') { out[k] = raw[k]; n++; }
    });
    return out;
  }

  window.__oqFilter = {`);

rep(J,
`    normalizeGroups: normalizeGroups
  };`,
`    normalizeGroups: normalizeGroups,
    normalizeCards: normalizeCards
  };`);

rep(J,
`  function initLedger() {`,
`  // Each By game card re-opens or folds the way the owner last left it; a
  // card they never touched keeps the template's default (open when a slot
  // is free).
  function initCards() {
    var saved = normalizeCards(readJson('local', CARDS_KEY));
    toArray(document.querySelectorAll('details[data-oq-card]')).forEach(function (d) {
      var key = d.getAttribute('data-oq-card');
      if (Object.prototype.hasOwnProperty.call(saved, key)) d.open = saved[key];
      d.addEventListener('toggle', function () {
        var cur = normalizeCards(readJson('local', CARDS_KEY));
        cur[key] = d.open;
        writeJson('local', CARDS_KEY, normalizeCards(cur));
      });
    });
  }

  function initLedger() {`);

rep(J,
`    initGroups();
    initLedger();`,
`    initGroups();
    initCards();
    initLedger();`);

console.log('edited admin-orders.js');
````

Run: `node .superpowers/tmp-edits/edit-board-memory.js` → `edited admin-orders.js`.

- [ ] **Step 4: Run them and watch them pass**

Run: `node scripts/test-admin-orders-filter.js` → `24 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add public/js/admin-orders.js scripts/test-admin-orders-filter.js
git commit -m "Orders: remember which By game cards are open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The server builds the board, with free slots

**Files:**
- Create: `scripts/test-orders-by-game.js`, `.superpowers/tmp-edits/edit-board-server.js`
- Modify (edit script): `server.js`

**Interfaces:**
- Consumes:
  - `buildBoard` and `kindOf` (Task 1), and the view's `orderBoard` local (Task 2).
  - In `server.js`: `waitlistOrders`, `abandonedOrders`, `buildAccountSummaryMap()`, `getPsplusSlots()`, `getGame(id)` and `computeAvailability(game, summary)`.
  - `.superpowers/tmp-edits/rep.js` (Task 2).
- Produces: `orderBoard` passed to `res.render('admin', …)`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-orders-by-game.js`:

````js
// Run: node scripts/test-orders-by-game.js
//
// Admin → Orders → Needs you → By game, through the real /admin route: the
// Waitlist and the Follow-ups grouped per game + account type, a card's
// "🟢 N slots free" read from the same counts the game page shows (and PS
// Plus's own slot counts), cards with a free slot first and open, Coming Soon
// cards without a slot check. Boots a throwaway instance (temp DATA_DIR, blank
// MONGODB_URI, in-memory sessions, a made-up admin password) with an
// in-memory orders collection; the project's games.json, the database and the
// real admin are never touched.
// See docs/superpowers/specs/2026-10-24-orders-by-game-board-design.md.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4642;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-by-game-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const game = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', genre: 'Action', cover_image: '', renters: 3 }, price, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [
    game(1, 'Zzyzx Free', { non_trophy_slots: 0, trophy_slots: 1 }),
    game(2, 'Zzyzx Full', { non_trophy_slots: 0, trophy_slots: 0 })
  ],
  upcoming: [Object.assign({ id: 7, title: 'Zzyzx Soon', platform: 'PS5', release_date: '2099-01-01', non_trophy_slots: 2, trophy_slots: 2 }, price)],
  psplus_slots: { nt_slots: 2, tr_slots: 0, ps4_slots: 0 }
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
const post = (p, o, headers) => call('POST', p, { headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}), body: new URLSearchParams(o).toString() });

// A minimal in-memory Mongo: the orders collection honours equality, $in and
// $exists filters, sort/limit cursors and $set/$push updates, which is all
// lib/orders.js asks of it. Every other collection is empty.
function matches(doc, filter) {
  return Object.keys(filter || {}).every(k => {
    const want = filter[k];
    if (want && typeof want === 'object' && !Array.isArray(want)) {
      if ('$in' in want) return want.$in.includes(doc[k]);
      if ('$exists' in want) return (doc[k] !== undefined) === want.$exists;
      return false;
    }
    return doc[k] === want;
  });
}
function cursor(rows) {
  const c = {
    sort(spec) {
      const [k, dir] = Object.entries(spec)[0];
      rows = rows.slice().sort((a, b) => String(a[k] || '').localeCompare(String(b[k] || '')) * dir);
      return c;
    },
    limit(n) { rows = rows.slice(0, n); return c; },
    async toArray() { return rows.map(r => JSON.parse(JSON.stringify(r))); },
    async next() { return rows[0] ? JSON.parse(JSON.stringify(rows[0])) : null; }
  };
  return c;
}
const docs = [];
const ordersCol = {
  async findOne(f) { const d = docs.find(x => matches(x, f)); return d ? JSON.parse(JSON.stringify(d)) : null; },
  find(f) { return cursor(docs.filter(x => matches(x, f))); },
  async insertOne(d) { docs.push(JSON.parse(JSON.stringify(d))); },
  async updateOne(f, u) {
    const d = docs.find(x => matches(x, f));
    if (!d) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(d, u.$set || {});
    Object.keys(u.$push || {}).forEach(k => { d[k] = (d[k] || []).concat([u.$push[k]]); });
    return { matchedCount: 1, modifiedCount: 1 };
  },
  async updateMany() { return { matchedCount: 0, modifiedCount: 0 }; },
  async findOneAndUpdate() { return null; },
  async countDocuments(f) { return docs.filter(x => matches(x, f)).length; }
};
const emptyCol = {
  async findOne() { return null; }, find() { return cursor([]); }, async insertOne() {},
  async updateOne() { return { matchedCount: 0, modifiedCount: 0 }; }, async updateMany() { return { matchedCount: 0, modifiedCount: 0 }; },
  async findOneAndUpdate() { return null; }, async countDocuments() { return 0; }
};

const entry = (ref, state, game_id, game_title, account_type, created_at, extra) => Object.assign({
  ref, state, game_id, game_title, account_type, created_at, fb_name: 'Zzyzx ' + ref.slice(3), url_key: 'k' + ref.slice(3),
  days: 30, amount_due: state === 'waitlisted' ? 0 : 899, deposit_due: 0, is_waitlist: state === 'waitlisted',
  state_history: [{ state, at: created_at }]
}, extra || {});
docs.push(
  entry('PH-0501', 'waitlisted', 1, 'Zzyzx Free', 'tr', '2026-10-20T01:00:00.000Z'),
  entry('PH-0502', 'waitlisted', 2, 'Zzyzx Full', 'tr', '2026-10-18T01:00:00.000Z'),
  entry('PH-0503', 'awaiting_payment', 2, 'Zzyzx Full', 'tr', '2026-10-23T01:00:00.000Z'),
  entry('PH-0504', 'waitlisted', 'psplus', 'PS Plus Deluxe', 'nt', '2026-10-19T01:00:00.000Z', { is_psplus: true }),
  entry('PH-0505', 'awaiting_payment', 'upcoming_7', 'Zzyzx Soon', 'tr', '2026-10-22T01:00:00.000Z', { is_reservation: true }),
  entry('PH-0506', 'waitlisted', 'psplus', 'PS Plus Deluxe', 'tr', '2026-10-19T02:00:00.000Z', { is_psplus: true })
);

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
  const orders = require('../lib/orders');
  orders.init(() => ({ collection: name => (name === 'orders' ? ordersCol : emptyCol) }));
  orders.expireStaleQrs = async () => {};
  orders.advanceEndedRentals = async () => {};

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const login = await post('/admin/login', { password: TEST_PASSWORD });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const page = (await call('GET', '/admin?tab=orders', { headers: { Cookie: cookie } })).body;
  const start = page.indexOf('data-oq-group="bygame"');
  assert.ok(start > 0, 'the By game board is on the Orders tab');
  const board = page.slice(start, page.indexOf('oq-ledger-h', start));
  const card = key => {
    const i = board.indexOf('data-oq-card="' + key + '"');
    if (i < 0) return '';
    const next = board.indexOf('data-oq-card="', i + 10);
    return board.slice(i, next > 0 ? next : undefined);
  };

  await okAsync('the old Follow-ups and Waitlist groups are replaced by the board', async () => {
    assert.ok(!page.includes('data-oq-group="followups"') && !page.includes('data-oq-group="waitlist"'));
  });

  await okAsync('cards with a free slot first (PS Plus Non-Trophy, Zzyzx Free Trophy), then most people', async () => {
    assert.deepStrictEqual([...board.matchAll(/data-oq-card="([^"]+)"/g)].map(m => m[1]),
      ['psplus|nt', '1|tr', '2|tr', 'psplus|tr', 'upcoming_7|tr']);
  });

  await okAsync('free-slot cards are tagged with the game page\'s and PS Plus\'s counts and start open', async () => {
    assert.ok(card('1|tr').startsWith('data-oq-card="1|tr" open>'));
    assert.ok(card('1|tr').includes('<span class="oq-card-free-tag">🟢 1 slot free</span>'));
    assert.ok(card('psplus|nt').includes('<span class="oq-card-free-tag">🟢 2 slots free</span>'));
  });

  await okAsync('a full game, a full PS Plus type and a Coming Soon game get no tag and start folded', async () => {
    for (const key of ['2|tr', 'psplus|tr', 'upcoming_7|tr']) {
      assert.ok(card(key).startsWith('data-oq-card="' + key + '">'), key + ' folded');
      assert.ok(!card(key).includes('oq-card-free-tag'), key + ' no tag');
    }
    assert.ok(card('2|tr').includes('<span class="oq-card-n">1 waiting · 1 didn&#39;t pay</span>'));
    assert.ok(card('upcoming_7|tr').includes('<span class="oq-card-n">1 didn&#39;t pay · Coming Soon</span>'));
  });

  await okAsync('every person is in their card with their own buttons', async () => {
    assert.ok(card('2|tr').includes('action="/admin/orders/PH-0502/slot-given"'));
    assert.ok(card('2|tr').includes('action="/admin/orders/PH-0503/mark-paid"'));
    assert.ok(card('psplus|nt').includes('action="/admin/orders/PH-0504/slot-given"'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-orders-by-game.js` → FAIL `AssertionError [ERR_ASSERTION]: the By game board is on the Orders tab`.

- [ ] **Step 3: Build the board in the route**

Create `.superpowers/tmp-edits/edit-board-server.js`:

````js
// Task 4: server.js builds the By game board for Admin → Orders — the
// Waitlist and the Follow-ups grouped by lib/needs-you-board.js, with each
// card's free slots read from the same counts the game page shows — and hands
// it to the view as `orderBoard`. Keeps server.js's BOM and CRLF.
const rep = require('./rep');
const S = 'server.js';

rep(S,
`const { cleanFbName } = require('./lib/names');
`,
`const { cleanFbName } = require('./lib/names');
const needsYouBoard = require('./lib/needs-you-board');
`);

rep(S,
`  const waitlistOrders = queueRules.forAdminPanel(allOrders, new Date());
`,
`  const waitlistOrders = queueRules.forAdminPanel(allOrders, new Date());
  // Needs you → By game: the Waitlist and the Follow-ups as one card per game
  // + account type. A card's "🟢 N slots free" uses the same per-type counts
  // the game page shows (computeAvailability) and PS Plus's own slot counts;
  // Coming Soon and box-set cards never get one (lib/needs-you-board.js).
  // See docs/superpowers/specs/2026-10-24-orders-by-game-board-design.md.
  const boardSlotsFree = {};
  {
    const SLOT_FIELD = { nt: 'ntSlots', tr: 'trSlots', ps4: 'ps4Slots' };
    const summaries = buildAccountSummaryMap();
    const psplusSlots = getPsplusSlots();
    waitlistOrders.concat(abandonedOrders).forEach(o => {
      const type = SLOT_FIELD[o.account_type] ? o.account_type : 'nt';
      const key = String(o.game_id) + '|' + type;
      if (key in boardSlotsFree) return;
      const kind = needsYouBoard.kindOf(o.game_id);
      if (kind === 'psplus') {
        boardSlotsFree[key] = Number(psplusSlots[type + '_slots']) || 0;
      } else if (kind === 'game') {
        const g = getGame(o.game_id);
        const avail = g ? computeAvailability(g, summaries[g.id]) : null;
        // A PS4 Primary slot never shows on a PS5-only game, so it is never free there.
        boardSlotsFree[key] = avail && (type !== 'ps4' || avail.showPs4) ? (avail[SLOT_FIELD[type]] || 0) : 0;
      }
    });
  }
  const orderBoard = needsYouBoard.buildBoard({ waitlist: waitlistOrders, followUps: abandonedOrders, slotsFree: boardSlotsFree });
`);

rep(S,
`reminderBadge: paymentReminders.reminderBadge, waitlistOrders, startedCount,`,
`reminderBadge: paymentReminders.reminderBadge, waitlistOrders, orderBoard, startedCount,`);

console.log('edited server.js');
````

Run: `node .superpowers/tmp-edits/edit-board-server.js` → `edited server.js`.
Then: `file server.js` → still `UTF-8 (with BOM) text … with CRLF line terminators`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-orders-by-game.js && node scripts/test-orders-template.js && node scripts/test-admin-orders-filter.js && node scripts/test-needs-you-board.js` → `5`, `41`, `24`, `5 assertions passed`.
Run the whole suite: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"` → only `FAIL scripts/test-upcoming-psn-page-public.js`, `failed: 1`.

- [ ] **Step 5: Commit and clean up**

```bash
git add server.js scripts/test-orders-by-game.js
git commit -m "Orders: the admin route builds the By game board with each card's free slots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
