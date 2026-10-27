# Account slot renter history — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the admin Accounts tab, the slot popup (for example PS Plus deluxe 3 · Trophy) shows that slot's renter history. It covers who started, who left and why, who moved in or out, who swapped games, and the owner's own status changes, newest first.

**Architecture:**
- **The rules** are pure and live in the new `lib/slot-history.js`:
  - what a slot change means;
  - how each line reads;
  - how many lines a slot keeps.
- **The data:** `server.js` gets a `slot_history` list in the lowdb data file and one save step, `saveAccountSlots(account, before, ctx)`. Every write to `accounts[].slots` goes through it, each with its reason.
- **The route:** `GET /admin/accounts/:id/slot/:type/history` serves one slot's lines.
- **The popup:** `public/js/admin-accounts.js` loads those lines when the slot popup opens.

**Tech Stack:** Express + lowdb, EJS templates, plain browser JS (no build step), plain CSS. Tests are `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-27-account-slot-renter-history-design.md` (amended after this plan's dry run).

**How this plan was checked.** Every file in this plan was dry-run in a scratch copy of the current `main`:
- Each new or changed test fails first and then passes.
- The full suite stays green apart from `scripts/test-upcoming-psn-page-public.js`, which also fails before this work.

A browser check ran on a throwaway instance (the Task 5 launcher), with a made-up admin password and 16 seeded lines on PS Plus deluxe 3 · Trophy.
- **1280px:** the popup shows, under the status form:
  - the green Now line ("Now: Zzyzx Juan Cruz · PS Plus Deluxe · since … · ends …");
  - the 10 newest lines;
  - "History starts …" and "Show all (16)". "Show all" lists all 16.
- **An untouched slot** shows "Nothing recorded yet."
- **Setting PS Plus deluxe 3 · Trophy to Maintenance** in the popup added "Set to Maintenance · changed by hand" and "Zzyzx Juan Cruz left · cleared by hand · rented … · PS Plus Deluxe".
- **375px:** the popup is 341px wide inside a 375px page. Long lines wrap and nothing scrolls sideways.
- **Errors:** none in the console.

## Global Constraints

- Work directly on `main` and do not switch branches. **Push only when the owner says "push".**
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Line endings:**
  - `server.js` is CRLF + UTF-8 BOM.
  - `public/css/style.css` is CRLF (a test checks every line).
  - These files are LF: `views/partials/admin/accounts.ejs`, `public/js/admin-accounts.js`, `scripts/test-accounts-template.js`, `scripts/test-admin-accounts-filter.js` and the new files.
  - The edit scripts (via `.superpowers/tmp-edits/rep.js`) keep each file's endings and BOM.
  - Git stores LF blobs (`core.autocrlf=true`).
- **Data** (lowdb data file, beside `accounts`):
  - `slot_history`: a list of lines, each `{ id, account_id, slot, at, kind, how, … }`.
  - `nextSlotHistoryId`.
  - `slot_history_started_at`: set once, the first time the server starts with this, and never changed.
  - Each `account_id` + `slot` keeps its newest 100 lines (`slotHistory.KEEP`).
  - Deleting an account deletes its lines.
- **Every write to `accounts[].slots` goes through `saveAccountSlots(account, before, ctx)`.**
  - `before` is `snapshotSlots(account)`, taken before any slot is touched. `getAccount()` returns the stored row itself, so slots change in place.
  - The one exception is the account edit form, which only turns slot types on or off and is not recorded.
- **`ctx.how`** is one of `new`, `cleared`, `returned`, `refunded`, `restored`, `customer_deleted`, `moved`.
  - `ctx.other` is `{ account_id, account_label, slot }` on a move.
  - `ctx.swap` is `{ from, to }` when the game changed.
  - `ctx.game` is the arriving renter's game, used when the customer row isn't updated yet.
- **The history route** is `GET /admin/accounts/:id/slot/:type/history`, behind `requireAuth`.
  - It returns `{ now: { title, detail } | null, lines: [{ date, title, detail, kind }], total, started }`, newest first.
  - An unknown account or type gets a 404 JSON.
- **Copy, verbatim:** the line wording is pinned by `scripts/test-slot-history.js`. The popup text:
  - the heading `🕘 History`;
  - `Now: ` before the current renter;
  - `Show all (N)`;
  - `History starts <Mon D, YYYY>`;
  - `Nothing recorded yet.`, `Loading…` and `Couldn't load history`.
- **The popup builds its lines with `textContent` only.** Names and games are typed by hand.
- **Test data:** tests use a temp `DATA_DIR`, a blank `MONGODB_URI`, the in-memory session store, a made-up admin password, made-up names and an in-memory orders collection. Never touch the project's `games.json` or a database.
- **Known unrelated failure:** `scripts/test-upcoming-psn-page-public.js`. Report it; do not fix it.
- **Edit scripts:** they live in `.superpowers/tmp-edits/` (git-ignored). Never commit them. Task 5 removes the folder.
- **Committing:** always `git add` explicit paths. The untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.

## Files

| File | Task | Change |
|---|---|---|
| `lib/slot-history.js` (new) | 1 | `diff`, `describe`, `historyView`, `trim`, dates |
| `scripts/test-slot-history.js` (new) | 1 | The rules |
| `server.js` | 2, 3 | `slot_history` data, `snapshotSlots`, `saveAccountSlots`, `slotRef`; the history route; the slot popup; account delete (2). The three slot helpers and every customer caller (3) |
| `scripts/test-slot-history-routes.js` (new) | 2 | Popup, history route, account delete |
| `scripts/test-slot-history-customers.js` (new) | 3 | Add, move, swap, bought, done, refund and undo, delete, bundle purchase |
| `views/partials/admin/accounts.ejs` | 4 | History section in the slot popup |
| `public/js/admin-accounts.js` | 4 | `historyRows`, load and render |
| `public/css/style.css` | 4 | `.acc-hist*` |
| `scripts/test-accounts-template.js`, `scripts/test-admin-accounts-filter.js` | 4 | The markup and `historyRows` |

---

### Task 1: The rules — `lib/slot-history.js`

**Files:**
- Create: `scripts/test-slot-history.js`, `lib/slot-history.js`

**Interfaces:**
- Consumes: nothing.
- Produces (`require('./lib/slot-history')`):
  - `TYPES`, `KEEP` (100), `TYPE_LABEL` and `STATUS_LABEL`.
  - `renterKey(slot)` → `'id:<n>'`, `'name:<lowercased>'` or `null`.
  - `diff(before, after, ctx, gameOf)` → line objects without `id`, `account_id`, `slot` or `at`.
  - `trim(list, accountId, slot, keep?)` → list.
  - `manilaDate(v)`, `shortDate(v)` ("Oct 27") and `longDate(v)` ("Oct 27, 2026").
  - `describe(line)` → `{ date, title, detail, kind }`.
  - `nowLine(slot, game)` → `{ title, detail } | null`.
  - `historyView({ entries, slot, game, startedAt })` → `{ now, lines, total, started }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-slot-history.js`:

````js
// Run: node scripts/test-slot-history.js
//
// The rules behind an account slot's renter history (lib/slot-history.js):
// which lines a slot change makes, how each line reads in the slot popup, and
// how many lines a slot keeps. Pure — no server, no data file.
const assert = require('assert');
const sh = require('../lib/slot-history');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const slot = (status, extra) => Object.assign({ enabled: true, status, renter_id: null, renter_name: '', start: '', end: '' }, extra || {});
const juan = slot('rented', { renter_id: 7, renter_name: 'Juan Cruz', start: '2026-10-02', end: '2026-11-01' });
const games = { 7: 'Elden Ring', 8: 'GTA V' };
const gameOf = id => games[id] || '';
const AT = '2026-10-27T04:00:00.000Z'; // Oct 27, noon in Manila
const at = e => Object.assign({ at: AT }, e);

console.log('\ndiff()');

ok('a renter taking an open slot: one "in" line, how new, with their game and dates', () => {
  assert.deepStrictEqual(sh.diff(slot('open'), juan, { how: 'new' }, gameOf), [
    { kind: 'in', how: 'new', renter_id: 7, renter_name: 'Juan Cruz', game_title: 'Elden Ring', start: '2026-10-02', end: '2026-11-01' }
  ]);
});

ok('a bought slot arrives as how bought', () => {
  const bought = slot('buyed', { renter_id: 7, renter_name: 'Juan Cruz' });
  assert.strictEqual(sh.diff(slot('open'), bought, { how: 'new' }, gameOf)[0].how, 'bought');
});

ok('a renter leaving: one "out" line with the reason, their game and start; Open is not repeated', () => {
  ['returned', 'cleared', 'refunded', 'customer_deleted'].forEach(how => {
    assert.deepStrictEqual(sh.diff(juan, slot('open'), { how }, gameOf), [
      { kind: 'out', how, renter_id: 7, renter_name: 'Juan Cruz', game_title: 'Elden Ring', start: '2026-10-02', end: '2026-11-01' }
    ], how);
  });
});

ok('an unknown reason for leaving reads as cleared by hand', () => {
  assert.strictEqual(sh.diff(juan, slot('open'), { how: 'new' }, gameOf)[0].how, 'cleared');
});

ok('cleared straight into Maintenance: the renter leaves and the new status is noted', () => {
  assert.deepStrictEqual(sh.diff(juan, slot('maintenance'), { how: 'cleared' }, gameOf).map(e => e.kind + ':' + (e.how || e.status)),
    ['out:cleared', 'status:maintenance']);
});

ok('one renter replaced by another: out for the first, in for the second', () => {
  const pedro = slot('rented', { renter_id: 8, renter_name: 'Pedro Reyes', start: '2026-10-27', end: '2026-11-03' });
  assert.deepStrictEqual(sh.diff(juan, pedro, { how: 'cleared' }, gameOf).map(e => e.kind + ':' + e.how + ':' + e.renter_name),
    ['out:cleared:Juan Cruz', 'in:new:Pedro Reyes']);
});

ok('a move carries the other slot, and a game swap rides along on both sides', () => {
  const ctx = { how: 'moved', other: { account_id: 2, account_label: 'PS Plus deluxe 2', slot: 'trophy' }, swap: { from: 'Elden Ring', to: 'GTA V' }, game: 'GTA V' };
  const out = sh.diff(juan, slot('open'), ctx, gameOf)[0];
  assert.deepStrictEqual(out, {
    kind: 'out', how: 'moved', renter_id: 7, renter_name: 'Juan Cruz', game_title: 'Elden Ring', start: '2026-10-02', end: '2026-11-01',
    other_account_id: 2, other_account_label: 'PS Plus deluxe 2', other_slot: 'trophy', from_game: 'Elden Ring', to_game: 'GTA V'
  });
  const inn = sh.diff(slot('open'), juan, ctx, gameOf)[0];
  assert.strictEqual(inn.how, 'moved');
  assert.strictEqual(inn.game_title, 'GTA V', 'ctx.game wins over the not-yet-updated customer row');
  assert.strictEqual(inn.other_account_label, 'PS Plus deluxe 2');
});

ok('a refund undone brings the renter back as how restored', () => {
  assert.strictEqual(sh.diff(slot('open'), juan, { how: 'restored' }, gameOf)[0].how, 'restored');
});

ok('same renter, game changed: one swap line', () => {
  assert.deepStrictEqual(sh.diff(juan, juan, { swap: { from: 'Elden Ring', to: 'GTA V' } }, gameOf), [
    { kind: 'swap', renter_id: 7, renter_name: 'Juan Cruz', from_game: 'Elden Ring', to_game: 'GTA V' }
  ]);
});

ok('same renter, rented to bought: a status line naming them', () => {
  const bought = Object.assign({}, juan, { status: 'buyed', start: '', end: '' });
  assert.deepStrictEqual(sh.diff(juan, bought, {}, gameOf), [{ kind: 'status', status: 'buyed', renter_id: 7, renter_name: 'Juan Cruz' }]);
});

ok('no renter either side, status changed by hand: a status line', () => {
  assert.deepStrictEqual(sh.diff(slot('open'), slot('maintenance'), { how: 'cleared' }, gameOf), [{ kind: 'status', status: 'maintenance' }]);
});

ok('nothing that matters changed: no lines (end date, name spelling, same game)', () => {
  assert.deepStrictEqual(sh.diff(juan, Object.assign({}, juan, { end: '2026-11-08' }), {}, gameOf), []);
  assert.deepStrictEqual(sh.diff(juan, Object.assign({}, juan, { renter_name: 'Juan dela Cruz' }), {}, gameOf), []);
  assert.deepStrictEqual(sh.diff(juan, juan, { swap: { from: 'Elden Ring', to: 'Elden Ring' } }, gameOf), []);
  assert.deepStrictEqual(sh.diff(slot('open'), slot('open'), {}, gameOf), []);
});

ok('a typed name with no linked customer counts as a renter; a different name is a different renter', () => {
  const typed = slot('rented', { renter_name: 'Walk-in Ana' });
  assert.deepStrictEqual(sh.diff(slot('open'), typed, { how: 'cleared' }, gameOf).map(e => e.kind + ':' + e.how), ['in:new']);
  const other = slot('rented', { renter_name: 'Walk-in Bea' });
  assert.deepStrictEqual(sh.diff(typed, other, { how: 'cleared' }, gameOf).map(e => e.kind + ':' + e.renter_name), ['out:Walk-in Ana', 'in:Walk-in Bea']);
  assert.deepStrictEqual(sh.diff(typed, slot('rented', { renter_name: 'walk-in ana ' }), {}, gameOf), [], 'case and spaces do not count');
});

console.log('\ndescribe()');

ok('lines read the way the slot popup shows them', () => {
  const d = e => { const r = sh.describe(at(e)); return [r.date, r.title, r.detail].join(' | '); };
  assert.strictEqual(d({ kind: 'in', how: 'new', renter_name: 'Juan Cruz', game_title: 'Elden Ring', start: '2026-10-02', end: '2026-11-01' }),
    'Oct 27 | Juan Cruz started | Elden Ring · ends Nov 1');
  assert.strictEqual(d({ kind: 'in', how: 'bought', renter_name: 'Juan Cruz', game_title: 'Elden Ring' }), 'Oct 27 | Juan Cruz bought it | Elden Ring');
  assert.strictEqual(d({ kind: 'in', how: 'moved', renter_name: 'Maria Santos', other_account_label: 'PS Plus deluxe 4 JAPAN', other_slot: 'trophy', game_title: 'PS Plus Deluxe' }),
    'Oct 27 | Maria Santos moved in | from PS Plus deluxe 4 JAPAN · Trophy · PS Plus Deluxe');
  assert.strictEqual(d({ kind: 'in', how: 'restored', renter_name: 'Juan Cruz', game_title: 'Elden Ring' }), 'Oct 27 | Juan Cruz came back | refund undone · Elden Ring');
  assert.strictEqual(d({ kind: 'out', how: 'returned', renter_name: 'Maria Santos', start: '2026-10-02', game_title: 'PS Plus Deluxe' }),
    'Oct 27 | Maria Santos left | returned · rented Oct 2 → Oct 27 · PS Plus Deluxe');
  assert.strictEqual(d({ kind: 'out', how: 'cleared', renter_name: 'Walk-in Ana', start: '2026-10-20' }), 'Oct 27 | Walk-in Ana left | cleared by hand · rented Oct 20 → Oct 27');
  assert.strictEqual(d({ kind: 'out', how: 'refunded', renter_name: 'Juan Cruz' }), 'Oct 27 | Juan Cruz left | refunded');
  assert.strictEqual(d({ kind: 'out', how: 'customer_deleted', renter_name: 'Juan Cruz' }), 'Oct 27 | Juan Cruz left | customer deleted');
  assert.strictEqual(d({ kind: 'out', how: 'moved', renter_name: 'Pedro Reyes', other_account_label: 'PS Plus deluxe 2', other_slot: 'trophy', start: '2026-09-30' }),
    'Oct 27 | Pedro Reyes moved | to PS Plus deluxe 2 · Trophy · rented Sep 30 → Oct 27');
  assert.strictEqual(d({ kind: 'out', how: 'moved', renter_name: 'Juan Cruz', other_account_label: 'Main 3', other_slot: 'non_trophy', from_game: 'Elden Ring', to_game: 'GTA V' }),
    'Oct 27 | Juan Cruz moved | to Main 3 · Non-Trophy · swapped Elden Ring → GTA V');
  assert.strictEqual(d({ kind: 'swap', renter_name: 'Maria Santos', from_game: 'Elden Ring', to_game: 'GTA V' }),
    'Oct 27 | Maria Santos swapped game | Elden Ring → GTA V · stayed on this slot');
  assert.strictEqual(d({ kind: 'status', status: 'maintenance' }), 'Oct 27 | Set to Maintenance | changed by hand');
  assert.strictEqual(d({ kind: 'status', status: 'buyed', renter_id: 7, renter_name: 'Juan Cruz' }), 'Oct 27 | Set to Bought | Juan Cruz');
  assert.strictEqual(d({ kind: 'status', status: 'na' }), 'Oct 27 | Set to Not available | changed by hand');
});

ok('dates are Manila dates: 8pm UTC on Oct 26 is Oct 27 in Manila', () => {
  assert.strictEqual(sh.shortDate('2026-10-26T20:00:00.000Z'), 'Oct 27');
  assert.strictEqual(sh.shortDate('2026-10-02'), 'Oct 2');
  assert.strictEqual(sh.longDate('2026-10-26T20:00:00.000Z'), 'Oct 27, 2026');
  assert.strictEqual(sh.shortDate(''), '');
});

console.log('\nhistoryView()');

ok('the Now line, the lines newest first as given, the count and the start date', () => {
  const v = sh.historyView({
    entries: [at({ kind: 'status', status: 'maintenance' }), at({ kind: 'in', how: 'new', renter_name: 'Juan Cruz' })],
    slot: juan, game: 'Elden Ring', startedAt: '2026-10-27T01:00:00.000Z'
  });
  assert.deepStrictEqual(v.now, { title: 'Juan Cruz', detail: 'Elden Ring · since Oct 2 · ends Nov 1' });
  assert.deepStrictEqual(v.lines.map(l => l.title), ['Set to Maintenance', 'Juan Cruz started']);
  assert.strictEqual(v.total, 2);
  assert.strictEqual(v.started, 'Oct 27, 2026');
});

ok('no Now line on an empty slot; a bought slot says bought', () => {
  assert.strictEqual(sh.historyView({ entries: [], slot: slot('open'), game: '', startedAt: '' }).now, null);
  const bought = slot('buyed', { renter_id: 7, renter_name: 'Juan Cruz' });
  assert.deepStrictEqual(sh.nowLine(bought, 'Elden Ring'), { title: 'Juan Cruz', detail: 'Elden Ring · bought' });
});

console.log('\ntrim()');

ok('keeps a slot\'s newest 100 lines and leaves other slots alone', () => {
  const list = [];
  for (let i = 1; i <= 103; i++) list.push({ id: i, account_id: 3, slot: 'trophy' });
  list.push({ id: 200, account_id: 3, slot: 'non_trophy' }, { id: 201, account_id: 4, slot: 'trophy' });
  const kept = sh.trim(list, 3, 'trophy');
  const mine = kept.filter(e => e.account_id === 3 && e.slot === 'trophy');
  assert.strictEqual(mine.length, 100);
  assert.strictEqual(mine[0].id, 4, 'the three oldest went');
  assert.ok(kept.some(e => e.id === 200) && kept.some(e => e.id === 201));
  const small = list.slice(0, 5);
  assert.strictEqual(sh.trim(small, 3, 'trophy'), small, 'under the cap the list comes back as it was');
  assert.strictEqual(sh.KEEP, 100);
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-slot-history.js` → FAIL `Error: Cannot find module '../lib/slot-history'`.

- [ ] **Step 3: Write the rules**

Create `lib/slot-history.js`:

````js
// Renter history for one account slot (an account's Trophy, Non-Trophy or PS4
// Primary slot), kept pure so it can be tested: what changed between a slot's
// before and after, how each history line reads, and how many lines a slot
// keeps. server.js saveAccountSlots() stores what diff() returns in the
// slot_history list; GET /admin/accounts/:id/slot/:type/history reads it back
// through historyView().
//
// A slot only ever holds its current renter, and the customer row does not say
// which account it used, so this log is the only record of who had a slot
// before. It starts empty on the day it shipped (slot_history_started_at).

const TYPES = ['trophy', 'non_trophy', 'ps4_primary'];
const KEEP = 100;
const TYPE_LABEL = { trophy: 'Trophy', non_trophy: 'Non-Trophy', ps4_primary: 'PS4 Primary' };
const STATUS_LABEL = { open: 'Open', rented: 'Rented', buyed: 'Bought', maintenance: 'Maintenance', na: 'Not available' };
const OUT_HOWS = ['returned', 'cleared', 'refunded', 'customer_deleted', 'moved'];
const OUT_TEXT = { returned: 'returned', cleared: 'cleared by hand', refunded: 'refunded', customer_deleted: 'customer deleted' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Who is on a slot: the linked customer when there is one, else the name typed
// in the slot popup. null when nobody is.
function renterKey(slot) {
  const s = slot || {};
  if (s.renter_id != null && s.renter_id !== '') return 'id:' + s.renter_id;
  const name = String(s.renter_name || '').trim().toLowerCase();
  return name ? 'name:' + name : null;
}

// Copies only the fields that have a value, so stored lines stay small.
function clean(entry) {
  const out = {};
  Object.keys(entry).forEach(k => {
    const v = entry[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  });
  return out;
}

function moveFields(ctx) {
  if (ctx.how !== 'moved' || !ctx.other) return {};
  return { other_account_id: ctx.other.account_id, other_account_label: ctx.other.account_label, other_slot: ctx.other.slot };
}

function swapFields(ctx) {
  const sw = ctx.swap;
  if (!sw || !sw.from || !sw.to || sw.from === sw.to) return null;
  return { from_game: sw.from, to_game: sw.to };
}

// The history lines one slot change makes. `before` and `after` are the slot
// objects as stored ({ status, renter_id, renter_name, start, end }); `ctx`
// says why it changed:
//   how   — 'new' (someone took it), 'cleared' (the owner changed it in the
//           slot popup), 'returned', 'refunded', 'restored' (refund undone),
//           'customer_deleted', or 'moved' (put on another slot)
//   other — { account_id, account_label, slot } on a move: the slot they came
//           from or went to
//   swap  — { from, to } game titles when the rental's game changed
//   game  — the arriving renter's game, when the customer row is not updated
//           yet (Customers edit saves the row after the slots)
// `gameOf(renter_id)` looks up a linked customer's game title.
// Returns plain objects; the caller adds id, account_id, slot and at.
function diff(before, after, ctx, gameOf) {
  const b = before || {};
  const a = after || {};
  const c = ctx || {};
  const game = id => (id != null && typeof gameOf === 'function' ? (gameOf(id) || '') : '');
  const bk = renterKey(b);
  const ak = renterKey(a);
  const lines = [];

  if (bk !== ak) {
    if (bk) {
      lines.push(clean(Object.assign({
        kind: 'out',
        how: OUT_HOWS.includes(c.how) ? c.how : 'cleared',
        renter_id: b.renter_id, renter_name: b.renter_name,
        game_title: game(b.renter_id), start: b.start, end: b.end
      }, moveFields(c), c.how === 'moved' ? swapFields(c) : null)));
    }
    if (ak) {
      const how = c.how === 'moved' ? 'moved'
        : c.how === 'restored' ? 'restored'
          : (a.status === 'buyed' ? 'bought' : 'new');
      lines.push(clean(Object.assign({
        kind: 'in', how,
        renter_id: a.renter_id, renter_name: a.renter_name,
        game_title: c.game || game(a.renter_id), start: a.start, end: a.end
      }, moveFields(c), c.how === 'moved' ? swapFields(c) : null)));
    }
    // A slot left empty on something other than Open (Maintenance, Not
    // available) says so; leaving it Open is what a renter leaving means.
    if (!ak && b.status !== a.status && !(bk && a.status === 'open')) {
      lines.push(clean({ kind: 'status', status: a.status }));
    }
    return lines;
  }

  if (bk) {
    const sw = swapFields(c);
    if (sw) lines.push(clean(Object.assign({ kind: 'swap', renter_id: a.renter_id, renter_name: a.renter_name }, sw)));
    if (b.status !== a.status) lines.push(clean({ kind: 'status', status: a.status, renter_id: a.renter_id, renter_name: a.renter_name }));
    return lines;
  }

  if (b.status !== a.status) lines.push(clean({ kind: 'status', status: a.status }));
  return lines;
}

// Drops the oldest lines of one slot past `keep`. `list` is the whole
// slot_history list, oldest first; other slots' lines are left alone.
function trim(list, accountId, slot, keep) {
  const max = keep == null ? KEEP : keep;
  const mine = (list || []).filter(e => e.account_id === accountId && e.slot === slot);
  if (mine.length <= max) return list;
  const drop = new Set(mine.slice(0, mine.length - max).map(e => e.id));
  return list.filter(e => !drop.has(e.id));
}

// A YYYY-MM-DD date stays as it is; an ISO time becomes its Manila date.
function manilaDate(v) {
  const s = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  return new Date(t + 8 * 3600000).toISOString().slice(0, 10);
}

function shortDate(v) {
  const d = manilaDate(v);
  if (!d) return '';
  const p = d.split('-').map(Number);
  return MONTHS[p[1] - 1] + ' ' + p[2];
}

function longDate(v) {
  const d = manilaDate(v);
  return d ? shortDate(d) + ', ' + d.slice(0, 4) : '';
}

const join = parts => parts.filter(Boolean).join(' · ');

function who(e) {
  return e.renter_name || (e.renter_id != null ? 'Customer #' + e.renter_id : 'Someone');
}

function otherLabel(e) {
  return e.other_account_label ? e.other_account_label + ' · ' + (TYPE_LABEL[e.other_slot] || e.other_slot || '') : '';
}

function swapText(e) {
  return e.from_game && e.to_game ? 'swapped ' + e.from_game + ' → ' + e.to_game : '';
}

function span(e) {
  return e.start ? 'rented ' + shortDate(e.start) + ' → ' + shortDate(e.at) : '';
}

// One stored line → what the popup shows: { date, title, detail, kind }.
function describe(e) {
  const name = who(e);
  let title = '';
  let detail = '';
  if (e.kind === 'in') {
    if (e.how === 'moved') { title = name + ' moved in'; detail = join([otherLabel(e) ? 'from ' + otherLabel(e) : '', swapText(e) || e.game_title]); }
    else if (e.how === 'restored') { title = name + ' came back'; detail = join(['refund undone', e.game_title]); }
    else if (e.how === 'bought') { title = name + ' bought it'; detail = join([e.game_title]); }
    else { title = name + ' started'; detail = join([e.game_title, e.end ? 'ends ' + shortDate(e.end) : '']); }
  } else if (e.kind === 'out') {
    if (e.how === 'moved') { title = name + ' moved'; detail = join([otherLabel(e) ? 'to ' + otherLabel(e) : '', swapText(e), span(e)]); }
    else { title = name + ' left'; detail = join([OUT_TEXT[e.how] || OUT_TEXT.cleared, span(e), e.game_title]); }
  } else if (e.kind === 'swap') {
    title = name + ' swapped game';
    detail = join([e.from_game + ' → ' + e.to_game, 'stayed on this slot']);
  } else {
    title = 'Set to ' + (STATUS_LABEL[e.status] || e.status || '');
    detail = e.renter_name || (e.renter_id != null ? who(e) : 'changed by hand');
  }
  return { date: shortDate(e.at), title, detail, kind: e.kind || 'status' };
}

// The current renter, for the popup's "Now" line. null on an empty slot.
function nowLine(slot, game) {
  const s = slot || {};
  if (!renterKey(s)) return null;
  return {
    title: who(s),
    detail: join([
      game,
      s.status === 'buyed' ? 'bought' : (s.start ? 'since ' + shortDate(s.start) : ''),
      s.status === 'rented' && s.end ? 'ends ' + shortDate(s.end) : ''
    ])
  };
}

// Everything the slot popup's History section needs. `entries` are this
// slot's stored lines, newest first.
function historyView({ entries, slot, game, startedAt }) {
  const list = entries || [];
  return {
    now: nowLine(slot, game),
    lines: list.map(describe),
    total: list.length,
    started: longDate(startedAt)
  };
}

module.exports = {
  TYPES, KEEP, TYPE_LABEL, STATUS_LABEL,
  renterKey, diff, trim, manilaDate, shortDate, longDate, describe, nowLine, historyView
};
````

- [ ] **Step 4: Run it and watch it pass**

Run: `node scripts/test-slot-history.js` → `18 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/slot-history.js scripts/test-slot-history.js
git commit -m "Accounts: rules for a slot's renter history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Record slot changes, and serve a slot's history

**Files:**
- Create: `scripts/test-slot-history-routes.js`, `.superpowers/tmp-edits/rep.js`, `.superpowers/tmp-edits/edit-slot-history-core.js`
- Modify (edit script): `server.js`

**Interfaces:**
- Consumes:
  - From Task 1: `slotHistory.diff`, `trim`, `renterKey` and `historyView`.
  - Already in `server.js`: `getAccount`, `getCustomer`, `ACCOUNT_SLOT_TYPES` and `requireAuth`.
- Produces (in `server.js`, used by Task 3):
  - `snapshotSlots(account)` → a deep copy of `account.slots`.
  - `saveAccountSlots(account, before, ctx)`: writes the slots, appends the `diff` lines with `{ id, account_id, slot, at }`, trims, and calls `db.write()`.
  - `slotRef('accId:type')` → `{ account_id, account_label, slot }`.
  - The data keys `slot_history`, `nextSlotHistoryId` and `slot_history_started_at`.
  - `GET /admin/accounts/:id/slot/:type/history` (Task 4's popup calls it).
- **The slot popup route also changes:** a different renter now starts today. It used to inherit the previous renter's start date.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-slot-history-routes.js`:

````js
// Run: node scripts/test-slot-history-routes.js
//
// Renter history for an account slot, through the real server: changes made
// in the slot popup (POST /admin/accounts/:id/slot/:type) are recorded, GET
// /admin/accounts/:id/slot/:type/history returns them newest first with the
// current renter and the day the log began, and deleting an account deletes
// its lines. The history request is admin-only.
//
// Throwaway only: a temp DATA_DIR, a blank MONGODB_URI, an in-memory session
// store, a made-up admin password and made-up names.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const sh = require('../lib/slot-history');

const PORT = 4666;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-history-routes-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const off = { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
const open = { enabled: true, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  games: [{ id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 }],
  customers: [
    { id: 7, customer_name: 'Zzyzx Juan', game_id: 4, game_title: 'PS Plus Deluxe', account_type: 'tr', status: 'renting', days: 30, start_date: '2026-10-01', end_date: '2026-10-31', price: 799 },
    { id: 8, customer_name: 'Zzyzx Pedro', game_id: 4, game_title: 'PS Plus Deluxe', account_type: 'tr', status: 'renting', days: 30, start_date: '2026-10-01', end_date: '2026-10-31', price: 799 }
  ],
  accounts: [
    { id: 3, label: 'Zzyzx PS Plus 3', game_ids: [4], slots: { trophy: open, non_trophy: off, ps4_primary: off } },
    { id: 9, label: 'Zzyzx Other', game_ids: [4], slots: { trophy: open, non_trophy: off, ps4_primary: off } }
  ],
  nextAccountId: 10
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'slot-history-routes-test';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers),
      timeout: 20000
    }, res => {
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
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const ledger = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const today = sh.manilaDate(new Date().toISOString());
// The slot popup stores a renter's start as the server's (UTC) date.
const startDay = new Date().toISOString().slice(0, 10);

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

(async () => {
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

  const login = await call('POST', '/admin/login', { headers: FORM, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in');
  const auth = extra => Object.assign({ Cookie: cookie }, extra || {});
  async function setSlot(accountId, type, fields) {
    const r = await call('POST', '/admin/accounts/' + accountId + '/slot/' + type, { headers: auth(FORM), body: form(fields) });
    assert.strictEqual(r.status, 302);
    assert.ok(/msg=slot_updated/.test(r.headers.location), r.headers.location);
  }
  async function history(accountId, type) {
    const r = await call('GET', '/admin/accounts/' + accountId + '/slot/' + type + '/history', { headers: auth({ Accept: 'application/json' }) });
    assert.strictEqual(r.status, 200, r.body);
    return JSON.parse(r.body);
  }

  try {
    console.log('\nthe history request');
    await ok('an untouched slot: no lines, no Now line, and the day the log began', async () => {
      const h = await history(3, 'trophy');
      assert.deepStrictEqual(h.lines, []);
      assert.strictEqual(h.now, null);
      assert.strictEqual(h.total, 0);
      assert.strictEqual(h.started, sh.longDate(today));
      assert.ok(ledger().slot_history_started_at, 'the start date is stored');
    });
    await ok('refuses anyone not logged in as admin', async () => {
      const r = await call('GET', '/admin/accounts/3/slot/trophy/history', { headers: { Accept: 'application/json' } });
      assert.strictEqual(r.status, 401);
      assert.ok(!r.body.includes('"lines"'));
    });
    await ok('an unknown account or slot type is a 404', async () => {
      assert.strictEqual((await call('GET', '/admin/accounts/3/slot/bogus/history', { headers: auth({ Accept: 'application/json' }) })).status, 404);
      assert.strictEqual((await call('GET', '/admin/accounts/99/slot/trophy/history', { headers: auth({ Accept: 'application/json' }) })).status, 404);
    });

    console.log('\nchanges made in the slot popup');
    await ok('renting the slot to a customer: a "started" line and the Now line', async () => {
      await setSlot(3, 'trophy', { status: 'rented', renter_id: '7', days: '30' });
      const h = await history(3, 'trophy');
      assert.deepStrictEqual(h.lines.map(l => l.title), ['Zzyzx Juan started']);
      assert.ok(h.lines[0].detail.startsWith('PS Plus Deluxe · ends '), h.lines[0].detail);
      assert.strictEqual(h.now.title, 'Zzyzx Juan');
      assert.ok(h.now.detail.startsWith('PS Plus Deluxe · since ' + sh.shortDate(startDay) + ' · ends '), h.now.detail);
    });
    await ok('changing only the days writes nothing new', async () => {
      await setSlot(3, 'trophy', { status: 'rented', renter_id: '7', days: '45' });
      assert.strictEqual((await history(3, 'trophy')).total, 1);
    });
    await ok('setting it to Maintenance: the renter was cleared by hand, then the new status', async () => {
      await setSlot(3, 'trophy', { status: 'maintenance' });
      const h = await history(3, 'trophy');
      assert.deepStrictEqual(h.lines.map(l => l.title), ['Set to Maintenance', 'Zzyzx Juan left', 'Zzyzx Juan started']);
      assert.ok(h.lines[1].detail.startsWith('cleared by hand · rented ' + sh.shortDate(startDay) + ' → '), h.lines[1].detail);
      assert.strictEqual(h.now, null);
    });
    await ok('Open again, then a different renter takes over from Juan', async () => {
      await setSlot(3, 'trophy', { status: 'open' });
      await setSlot(3, 'trophy', { status: 'rented', renter_id: '7', days: '30' });
      await setSlot(3, 'trophy', { status: 'rented', renter_id: '8', days: '30' });
      const h = await history(3, 'trophy');
      assert.deepStrictEqual(h.lines.slice(0, 4).map(l => l.title), ['Zzyzx Pedro started', 'Zzyzx Juan left', 'Zzyzx Juan started', 'Set to Open']);
      assert.strictEqual(h.now.title, 'Zzyzx Pedro');
    });
    await ok('a new renter gets their own start date, not the one before them', async () => {
      const slot = ledger().accounts.find(a => a.id === 3).slots.trophy;
      assert.strictEqual(slot.renter_id, 8);
      assert.strictEqual(slot.start, startDay);
    });
    await ok('each line is stored with its account, slot and time; another account\'s slot is untouched', async () => {
      const rows = ledger().slot_history;
      assert.ok(rows.length >= 7);
      rows.forEach(e => {
        assert.strictEqual(e.account_id, 3);
        assert.strictEqual(e.slot, 'trophy');
        assert.ok(e.id && e.at && e.kind);
      });
      assert.strictEqual((await history(9, 'trophy')).total, 0);
    });

    console.log('\ndeleting an account');
    await ok('takes its history lines with it', async () => {
      await setSlot(9, 'trophy', { status: 'maintenance' });
      assert.strictEqual((await history(9, 'trophy')).total, 1);
      const r = await call('POST', '/admin/accounts/delete/3', { headers: auth(FORM), body: '' });
      assert.strictEqual(r.status, 302);
      const rows = ledger().slot_history;
      assert.ok(!rows.some(e => e.account_id === 3), 'account 3\'s lines are gone');
      assert.strictEqual(rows.filter(e => e.account_id === 9).length, 1, 'account 9 keeps its own');
    });

    console.log('\n' + passed + ' assertions passed\n');
  } catch (e) {
    console.error(e);
    cleanup();
    process.exit(1);
  }
  cleanup();
  process.exit(0);
})();
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-slot-history-routes.js` → FAIL with an `AssertionError` whose message is the 404 page `Cannot GET /admin/accounts/3/slot/trophy/history`.

- [ ] **Step 3: The save step, the route and the popup**

Create `.superpowers/tmp-edits/rep.js`. It keeps a file's BOM and CRLF, and fails loudly on a missing or repeated anchor. Every later task reuses it:

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

Create `.superpowers/tmp-edits/edit-slot-history-core.js`:

````js
// Slot renter history, part 1 (server.js): the slot_history list and its start
// date, the one save step every slot write goes through (saveAccountSlots),
// the slot popup's route using it, GET /admin/accounts/:id/slot/:type/history,
// and deleting an account's lines with the account. Keeps server.js's BOM and
// CRLF.
const rep = require('./rep');
const S = 'server.js';

rep(S,
`const rentPricing = require('./lib/rent-pricing');
`,
`const rentPricing = require('./lib/rent-pricing');
const slotHistory = require('./lib/slot-history');
`);

rep(S,
`if (db.get('nextAccountId').value() === undefined) db.set('nextAccountId', 1).write();
`,
`if (db.get('nextAccountId').value() === undefined) db.set('nextAccountId', 1).write();
// Renter history for account slots (lib/slot-history.js). The start date is
// stamped once, the first time the server runs with it, for the slot popup's
// "History starts …" line: nothing before it was recorded.
if (db.get('slot_history').value() === undefined) db.set('slot_history', []).write();
if (db.get('nextSlotHistoryId').value() === undefined) db.set('nextSlotHistoryId', 1).write();
if (!db.get('slot_history_started_at').value()) db.set('slot_history_started_at', new Date().toISOString()).write();
`);

rep(S,
`  db.set('nextAccountId', id + 1).write();
  return id;
}
`,
`  db.set('nextAccountId', id + 1).write();
  return id;
}

// A copy of an account's slots to compare against after a change. Take it
// before touching any slot: getAccount() hands back the stored row itself, so
// its slots change in place the moment a caller edits them.
function snapshotSlots(account) {
  return JSON.parse(JSON.stringify((account && account.slots) || {}));
}

// Saves an account's slots and records what changed in slot_history. Every
// write to accounts[].slots goes through here, so the renter history sees each
// change whichever screen made it. \`before\` is snapshotSlots() from before the
// change; \`ctx\` says why (lib/slot-history.js diff()).
function saveAccountSlots(account, before, ctx) {
  const at = new Date().toISOString();
  const gameOf = id => { const c = getCustomer(id); return c ? (c.game_title || '') : ''; };
  const lines = [];
  ACCOUNT_SLOT_TYPES.forEach(t => {
    slotHistory.diff(before && before[t], account.slots[t], ctx || {}, gameOf)
      .forEach(e => lines.push(Object.assign({ account_id: account.id, slot: t, at }, e)));
  });
  db.get('accounts').find({ id: account.id }).assign({ slots: account.slots }).value();
  if (lines.length) {
    let list = (db.get('slot_history').value() || []).slice();
    let nextId = db.get('nextSlotHistoryId').value() || 1;
    lines.forEach(e => { list.push(Object.assign({ id: nextId++ }, e)); });
    new Set(lines.map(e => e.slot)).forEach(t => { list = slotHistory.trim(list, account.id, t); });
    db.set('slot_history', list).set('nextSlotHistoryId', nextId).value();
  }
  db.write();
}

// "accId:type" → the other side of a move, the way slot_history stores it.
function slotRef(assignStr) {
  const [idPart, type] = String(assignStr || '').split(':');
  const account = getAccount(idPart);
  return { account_id: account ? account.id : parseInt(idPart), account_label: account ? account.label : '', slot: type };
}
`);

// The slot popup: snapshot first, keep a new renter's own start date, save
// through the history step.
rep(S,
`  const slot = account.slots[type];
  const newStatus = ACCOUNT_STATUSES.includes(status) ? status : slot.status;
`,
`  const before = snapshotSlots(account);
  const slot = account.slots[type];
  const newStatus = ACCOUNT_STATUSES.includes(status) ? status : slot.status;
`);

rep(S,
`      slot.start = slot.start || new Date().toISOString().slice(0, 10);
`,
`      // A different renter starts today; the same one keeps their start date.
      // (It used to carry the previous renter's start over to the new one.)
      const sameRenter = slotHistory.renterKey(before[type]) === slotHistory.renterKey(slot);
      slot.start = (sameRenter && slot.start) || new Date().toISOString().slice(0, 10);
`);

rep(S,
`  db.get('accounts').find({ id: parseInt(req.params.id) }).assign({ slots: account.slots }).write();
  res.redirect('/admin?tab=accounts&msg=slot_updated');
});
`,
`  // A change made here is the owner's own: a renter it takes off was cleared
  // by hand.
  saveAccountSlots(account, before, { how: 'cleared' });
  res.redirect('/admin?tab=accounts&msg=slot_updated');
});

// The slot popup's History section (public/js/admin-accounts.js asks for it
// when the popup opens): this slot's lines newest first, its current renter
// and the day the log began.
app.get('/admin/accounts/:id/slot/:type/history', requireAuth, (req, res) => {
  const account = getAccount(req.params.id);
  const type = req.params.type;
  if (!account || !ACCOUNT_SLOT_TYPES.includes(type)) return res.status(404).json({ error: 'not_found' });
  const entries = (db.get('slot_history').value() || [])
    .filter(e => e.account_id === account.id && e.slot === type)
    .reverse();
  const slot = account.slots[type];
  const renter = slot && slot.renter_id ? getCustomer(slot.renter_id) : null;
  res.json(slotHistory.historyView({
    entries, slot,
    game: renter ? (renter.game_title || '') : '',
    startedAt: db.get('slot_history_started_at').value()
  }));
});
`);

rep(S,
`  db.get('accounts').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?tab=accounts&msg=account_deleted');
`,
`  db.get('accounts').remove({ id: parseInt(req.params.id) }).write();
  db.get('slot_history').remove(e => e.account_id === parseInt(req.params.id)).write();
  res.redirect('/admin?tab=accounts&msg=account_deleted');
`);

console.log('edited server.js');
````

Run: `node .superpowers/tmp-edits/edit-slot-history-core.js` → `edited server.js`.
Then: `file server.js` → still `UTF-8 (with BOM) text … with CRLF line terminators`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-slot-history-routes.js && node scripts/test-slot-history.js && node scripts/test-accounts-template.js` → `10`, `18`, `14 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add server.js scripts/test-slot-history-routes.js
git commit -m "Accounts: record each slot change and serve a slot's history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Customers and orders record their slot changes too

**Files:**
- Create: `scripts/test-slot-history-customers.js`, `.superpowers/tmp-edits/edit-slot-history-customers.js`
- Modify (edit script): `server.js`

**Interfaces:**
- Consumes: from Task 2, `snapshotSlots`, `saveAccountSlots`, `slotRef` and the history route. `.superpowers/tmp-edits/rep.js`.
- Produces: optional `history` fields on the existing slot helpers:
  - `applyAccountAssignment(assignStr, { customerId, customerName, status, endDate, history })`, defaulting to `{ how: 'new' }`.
  - `freeAccountSlotsForCustomer(customerId, history)`, defaulting to `{ how: 'returned' }`.
  - `refreshAccountAssignment(assignStr, { customerName, endDate, status, history })`, defaulting to `{}`.
- **Callers:**
  - Customers edit: `moved` with `other`, `swap` and `game`; `swap` on the same slot; `returned`; `cleared` when the slot is removed.
  - Status change: `returned`.
  - Refund and undo: `refunded` / `restored`.
  - `removeCustomerRecord`: `customer_deleted`.
  - A paid bundle purchase: `new`, which reads as "bought it".

- [ ] **Step 1: Write the failing test**

Create `scripts/test-slot-history-customers.js`:

````js
// Run: node scripts/test-slot-history-customers.js
//
// Renter history for account slots, when the change comes from the Customers
// tab and the order flow rather than the slot popup: adding a customer onto a
// slot, moving them to another account's slot, the free game swap (with and
// without a move), renting → bought, marking them done, a refund and its undo,
// deleting a customer, and a paid bundle purchase taking its slot. Each writes
// the matching line through the real routes, read back with GET
// /admin/accounts/:id/slot/:type/history.
//
// Throwaway only: a temp DATA_DIR, a blank MONGODB_URI, an in-memory session
// store, a made-up admin password, made-up names and an in-memory orders
// collection.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4667;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-history-customers-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const off = { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
const open = { enabled: true, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
const price = { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 };
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  games: [
    Object.assign({ id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5' }, price),
    Object.assign({ id: 6, title: 'Zzyzx Racer', platform: 'PS5' }, price)
  ],
  customers: [],
  nextCustomerId: 20,
  accounts: [
    { id: 3, label: 'Zzyzx PS Plus 3', game_ids: [4], slots: { trophy: open, non_trophy: off, ps4_primary: off } },
    { id: 5, label: 'Zzyzx PS Plus 5', game_ids: [4, 6], slots: { trophy: open, non_trophy: off, ps4_primary: off } },
    { id: 9, label: 'Zzyzx Bundle', game_ids: [6], for_sale: true, public_name: 'Zzyzx Pack', slots: { trophy: open, non_trophy: off, ps4_primary: off } }
  ],
  nextAccountId: 10
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'slot-history-customers-test';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const stored = [];

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers),
      timeout: 20000
    }, res => {
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
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const ledger = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const customerNamed = name => ledger().customers.find(c => c.customer_name === name);

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

(async () => {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  const orders = require('../lib/orders');
  orders.getByRef = async ref => stored.find(o => o.ref === ref) || null;
  orders.transition = async (ref, to, patch) => {
    const o = stored.find(x => x.ref === ref);
    if (!o) return null;
    Object.assign(o, patch || {}, { state: to });
    return o;
  };
  orders.setCustomerId = async (ref, id) => { const o = stored.find(x => x.ref === ref); if (o) o.customer_id = id; return !!o; };

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const login = await call('POST', '/admin/login', { headers: FORM, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in');
  const auth = extra => Object.assign({ Cookie: cookie }, extra || {});
  async function post(p, fields, expect) {
    const r = await call('POST', p, { headers: auth(FORM), body: form(fields) });
    assert.strictEqual(r.status, 302, r.body);
    if (expect) assert.ok(expect.test(r.headers.location), r.headers.location);
  }
  async function history(accountId) {
    const r = await call('GET', '/admin/accounts/' + accountId + '/slot/trophy/history', { headers: auth({ Accept: 'application/json' }) });
    assert.strictEqual(r.status, 200, r.body);
    return JSON.parse(r.body);
  }
  const newest = async accountId => (await history(accountId)).lines[0];
  function addCustomer(name, assign) {
    return post('/admin/customers/add', {
      customer_name: name, game_id: '4', days: '30', account_type: 'tr', status: 'renting',
      start_date: day(0), end_date: day(30), price: '799', notes: '', account_assign: assign
    }, /msg=customer_added/);
  }
  function editCustomer(id, gameId, assign) {
    return post('/admin/customers/edit/' + id, {
      customer_name: 'Zzyzx Maria', game_id: String(gameId), days: '30', account_type: 'tr', status: 'renting',
      start_date: day(0), end_date: day(30), price: '799', notes: '', account_assign: assign
    }, /msg=customer_updated/);
  }

  try {
    console.log('\nCustomers: add, move, swap');
    let maria;
    await ok('adding a customer onto a slot: "started" with their game', async () => {
      await addCustomer('Zzyzx Maria', '3:trophy');
      maria = customerNamed('Zzyzx Maria');
      const h = await history(3);
      assert.deepStrictEqual(h.lines.map(l => l.title), ['Zzyzx Maria started']);
      assert.ok(h.lines[0].detail.startsWith('PS Plus Deluxe · ends '), h.lines[0].detail);
      assert.strictEqual(h.now.title, 'Zzyzx Maria');
    });
    await ok('moving them to another account\'s slot: "moved" on the old slot, "moved in" on the new', async () => {
      await editCustomer(maria.id, 4, '5:trophy');
      const out = await newest(3);
      assert.strictEqual(out.title, 'Zzyzx Maria moved');
      assert.ok(out.detail.startsWith('to Zzyzx PS Plus 5 · Trophy · rented '), out.detail);
      const inn = await newest(5);
      assert.strictEqual(inn.title, 'Zzyzx Maria moved in');
      assert.strictEqual(inn.detail, 'from Zzyzx PS Plus 3 · Trophy · PS Plus Deluxe');
      assert.strictEqual((await history(3)).now, null);
    });
    await ok('changing only their game: a swap line, and the Now line shows the new game', async () => {
      await editCustomer(maria.id, 6, '5:trophy');
      const h = await history(5);
      assert.strictEqual(h.lines[0].title, 'Zzyzx Maria swapped game');
      assert.strictEqual(h.lines[0].detail, 'PS Plus Deluxe → Zzyzx Racer · stayed on this slot');
      assert.ok(h.now.detail.startsWith('Zzyzx Racer · since '), h.now.detail);
    });
    await ok('a game swap onto another account\'s slot: both move lines name the swap', async () => {
      await editCustomer(maria.id, 4, '3:trophy');
      const out = await newest(5);
      assert.strictEqual(out.title, 'Zzyzx Maria moved');
      assert.ok(out.detail.startsWith('to Zzyzx PS Plus 3 · Trophy · swapped Zzyzx Racer → PS Plus Deluxe · rented '), out.detail);
      const inn = await newest(3);
      assert.strictEqual(inn.title, 'Zzyzx Maria moved in');
      assert.strictEqual(inn.detail, 'from Zzyzx PS Plus 5 · Trophy · swapped Zzyzx Racer → PS Plus Deluxe');
    });
    await ok('an edit that changes nothing about the slot writes nothing', async () => {
      const before = (await history(3)).total;
      await editCustomer(maria.id, 4, '3:trophy');
      assert.strictEqual((await history(3)).total, before);
    });

    console.log('\nCustomers: status, refund, delete');
    await ok('renting → bought: a status line naming them', async () => {
      await post('/admin/customers/status/' + maria.id, { status: 'bought' }, /msg=customer_updated/);
      const line = await newest(3);
      assert.deepStrictEqual([line.title, line.detail], ['Set to Bought', 'Zzyzx Maria']);
    });
    await ok('marked done: "left — returned"', async () => {
      await post('/admin/customers/status/' + maria.id, { status: 'done' }, /msg=customer_updated/);
      const line = await newest(3);
      assert.strictEqual(line.title, 'Zzyzx Maria left');
      assert.ok(line.detail.startsWith('returned · rented '), line.detail);
      assert.ok(line.detail.endsWith('· PS Plus Deluxe'), line.detail);
    });
    let bea;
    await ok('a rental refund frees the slot as "refunded"', async () => {
      await addCustomer('Zzyzx Bea', '5:trophy');
      bea = customerNamed('Zzyzx Bea');
      await post('/admin/customers/' + bea.id + '/refund', {
        confirm: 'yes', scope: 'rental', method: 'gcash', date: day(0), amount: '0'
      }, /msg=refund_saved/);
      const line = await newest(5);
      assert.strictEqual(line.title, 'Zzyzx Bea left');
      assert.ok(line.detail.startsWith('refunded · rented '), line.detail);
    });
    await ok('undoing the refund brings them back', async () => {
      const refundId = customerNamed('Zzyzx Bea').refunds[0].id;
      await post('/admin/customers/' + bea.id + '/refund', { confirm: 'yes', action: 'undo', refund_id: refundId }, /msg=refund_undone/);
      const line = await newest(5);
      assert.deepStrictEqual([line.title, line.detail], ['Zzyzx Bea came back', 'refund undone · PS Plus Deluxe']);
    });
    await ok('deleting the customer: "left — customer deleted"', async () => {
      await post('/admin/customers/delete/' + bea.id, {});
      const line = await newest(5);
      assert.strictEqual(line.title, 'Zzyzx Bea left');
      assert.ok(line.detail.startsWith('customer deleted · rented '), line.detail);
    });

    console.log('\na paid bundle purchase');
    await ok('signing the buyer in takes the slot: "bought it"', async () => {
      stored.push({
        ref: 'PH-4100', url_key: 'kb', state: 'qr_pending', is_buy: true, account_id: 9, slot_type: 'tr',
        game_id: 'bundle_9', game_title: 'Zzyzx Pack', account_type: 'tr', amount_due: 4500, deposit_due: 0,
        fb_name: 'Zzyzx Buyer', created_at: new Date().toISOString()
      });
      await post('/admin/orders/PH-4100/advance', {});
      const h = await history(9);
      assert.strictEqual(h.lines[0].title, 'Zzyzx Buyer bought it');
      assert.deepStrictEqual(h.now, { title: 'Zzyzx Buyer', detail: 'Zzyzx Pack · bought' });
    });

    console.log('\n' + passed + ' assertions passed\n');
  } catch (e) {
    console.error(e);
    cleanup();
    process.exit(1);
  }
  cleanup();
  process.exit(0);
})();
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-slot-history-customers.js` → FAIL `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` with `+ []` against `- [ 'Zzyzx Maria started' ]`. Adding a customer writes no line yet.

- [ ] **Step 3: The customer flows**

Create `.superpowers/tmp-edits/edit-slot-history-customers.js`:

````js
// Slot renter history, part 2 (server.js): the customer flows. The three slot
// helpers (applyAccountAssignment, freeAccountSlotsForCustomer,
// refreshAccountAssignment) save through saveAccountSlots and take a `history`
// reason, and each caller passes its own: Customers edit (moved, game swap,
// returned), the status change (returned), refund and undo (refunded,
// restored), deleting a customer (customer_deleted) and a paid bundle purchase.
// Keeps server.js's BOM and CRLF.
const rep = require('./rep');
const S = 'server.js';

// ── The three helpers ──
rep(S,
`function applyAccountAssignment(assignStr, { customerId, customerName, status, endDate }) {`,
`function applyAccountAssignment(assignStr, { customerId, customerName, status, endDate, history }) {`);

rep(S,
`  if (status === 'bought') { slot.status = 'buyed'; slot.start = ''; slot.end = ''; }
  else { slot.status = 'rented'; slot.start = new Date().toISOString().slice(0, 10); slot.end = endDate || ''; }
  slot.renter_id = customerId;
  slot.renter_name = customerName;
  account.slots[type] = slot;
  db.get('accounts').find({ id: account.id }).assign({ slots: account.slots }).write();
  return true;
}
`,
`  const before = snapshotSlots(account);
  if (status === 'bought') { slot.status = 'buyed'; slot.start = ''; slot.end = ''; }
  else { slot.status = 'rented'; slot.start = new Date().toISOString().slice(0, 10); slot.end = endDate || ''; }
  slot.renter_id = customerId;
  slot.renter_name = customerName;
  account.slots[type] = slot;
  // \`history\` is the reason slot_history records (lib/slot-history.js diff());
  // a plain assignment is someone new taking the slot.
  saveAccountSlots(account, before, history || { how: 'new' });
  return true;
}
`);

rep(S,
`function freeAccountSlotsForCustomer(customerId) {
  let anyChanged = false;
  getAccounts().forEach(acc => {
    let changed = false;
    ACCOUNT_SLOT_TYPES.forEach(t => {
      if (acc.slots[t] && acc.slots[t].renter_id === customerId) {
        acc.slots[t] = blankSlot(acc.slots[t].enabled);
        changed = true;
      }
    });
    if (changed) {
      db.get('accounts').find({ id: acc.id }).assign({ slots: acc.slots }).value();
      anyChanged = true;
    }
  });
  if (anyChanged) db.write();
}
`,
`// \`history\` is why they left, for slot_history: 'returned' unless the caller
// says otherwise ('refunded', 'customer_deleted', 'moved' with the slot they
// went to).
function freeAccountSlotsForCustomer(customerId, history) {
  getAccounts().forEach(acc => {
    if (!ACCOUNT_SLOT_TYPES.some(t => acc.slots[t] && acc.slots[t].renter_id === customerId)) return;
    const before = snapshotSlots(acc);
    ACCOUNT_SLOT_TYPES.forEach(t => {
      if (acc.slots[t] && acc.slots[t].renter_id === customerId) acc.slots[t] = blankSlot(acc.slots[t].enabled);
    });
    saveAccountSlots(acc, before, history || { how: 'returned' });
  });
}
`);

rep(S,
`function refreshAccountAssignment(assignStr, { customerName, endDate, status }) {`,
`function refreshAccountAssignment(assignStr, { customerName, endDate, status, history }) {`);

rep(S,
`  slot.renter_name = customerName;
  // Keep slot.status in sync when the customer toggles between renting ↔ bought on the same slot.
`,
`  const before = snapshotSlots(account);
  slot.renter_name = customerName;
  // Keep slot.status in sync when the customer toggles between renting ↔ bought on the same slot.
`);

rep(S,
`  else if (slot.status === 'rented' && endDate) slot.end = endDate;
  account.slots[type] = slot;
  db.get('accounts').find({ id: account.id }).assign({ slots: account.slots }).write();
  return true;
}
`,
`  else if (slot.status === 'rented' && endDate) slot.end = endDate;
  account.slots[type] = slot;
  // Same renter: only a game swap (history.swap) or renting ↔ bought makes a line.
  saveAccountSlots(account, before, history || {});
  return true;
}
`);

// ── Customers edit: moves, game swaps, returns ──
rep(S,
`  if (!isActive) {
    // No longer renting/bought → free whatever slot was linked
    if (priorAssign) freeAccountSlotsForCustomer(customerId);
  } else if (submittedAssign !== priorAssign) {
    // Assignment target changed (or game/type changed under it) → free old, apply new
    if (priorAssign) freeAccountSlotsForCustomer(customerId);
    if (submittedAssign) {
      slotAssignFailed = !applyAccountAssignment(submittedAssign, { customerId, customerName: finalCustomerName, status, endDate: finalEndDate });
    }
  } else if (priorAssign) {
    // Same slot as before → refresh name/end date/status (renting ↔ bought), keep original start date
    slotAssignFailed = !refreshAccountAssignment(priorAssign, { customerName: finalCustomerName, endDate: finalEndDate, status });
  }
`,
`  // For the slot history: the game this edit leaves them on, and a swap when
  // that is not the game they had (the free game change).
  const editGame = !isUpcomingNew ? (getGame(game_id) || getGame(existing.game_id)) : null;
  const editSwap = !wasUpcoming && editGame && editGame.id !== existing.game_id
    ? { from: existing.game_title, to: editGame.title } : null;
  const editGameTitle = editGame ? editGame.title : existing.game_title;
  if (!isActive) {
    // No longer renting/bought → free whatever slot was linked
    if (priorAssign) freeAccountSlotsForCustomer(customerId, { how: 'returned' });
  } else if (submittedAssign !== priorAssign) {
    // Assignment target changed (or game/type changed under it) → free old,
    // apply new. Both slots record the move, with the game swap if there was one.
    if (priorAssign) {
      freeAccountSlotsForCustomer(customerId, submittedAssign
        ? { how: 'moved', other: slotRef(submittedAssign), swap: editSwap }
        : { how: 'cleared' });
    }
    if (submittedAssign) {
      slotAssignFailed = !applyAccountAssignment(submittedAssign, {
        customerId, customerName: finalCustomerName, status, endDate: finalEndDate,
        history: priorAssign
          ? { how: 'moved', other: slotRef(priorAssign), swap: editSwap, game: editGameTitle }
          : { how: 'new', game: editGameTitle }
      });
    }
  } else if (priorAssign) {
    // Same slot as before → refresh name/end date/status (renting ↔ bought), keep original start date
    slotAssignFailed = !refreshAccountAssignment(priorAssign, {
      customerName: finalCustomerName, endDate: finalEndDate, status, history: { swap: editSwap }
    });
  }
`);

// ── Status change ──
rep(S,
`  if (wasActive && !isActive) {
    freeAccountSlotsForCustomer(parseInt(req.params.id));
  } else if (wasActive && isActive && existing.status !== status) {`,
`  if (wasActive && !isActive) {
    freeAccountSlotsForCustomer(parseInt(req.params.id), { how: 'returned' });
  } else if (wasActive && isActive && existing.status !== status) {`);

// ── Refund and undo ──
rep(S,
`      adjustLegacySlots(existing, +1);
      freeAccountSlotsForCustomer(existing.id);
`,
`      adjustLegacySlots(existing, +1);
      freeAccountSlotsForCustomer(existing.id, { how: 'refunded' });
`);

rep(S,
`            status: entry.prev_status,
            endDate: result.patch.end_date
          });`,
`            status: entry.prev_status,
            endDate: result.patch.end_date,
            history: { how: 'restored' }
          });`);

// ── Deleting a customer ──
rep(S,
`  freeAccountSlotsForCustomer(parseInt(id));
  db.get('customers').remove({ id: parseInt(id) }).write();`,
`  freeAccountSlotsForCustomer(parseInt(id), { how: 'customer_deleted' });
  db.get('customers').remove({ id: parseInt(id) }).write();`);

// ── A paid bundle purchase taking its slot ──
rep(S,
`      const account = getAccount(order.account_id);
      if (account) {
        const slotKey = order.slot_type === 'tr' ? 'trophy' : 'non_trophy';`,
`      const account = getAccount(order.account_id);
      if (account) {
        const before = snapshotSlots(account);
        const slotKey = order.slot_type === 'tr' ? 'trophy' : 'non_trophy';`);

rep(S,
`        account.slots[slotKey] = slot;
        db.get('accounts').find({ id: account.id }).assign({ slots: account.slots }).write();`,
`        account.slots[slotKey] = slot;
        saveAccountSlots(account, before, { how: 'new' });`);

console.log('edited server.js');
````

Run: `node .superpowers/tmp-edits/edit-slot-history-customers.js` → `edited server.js`.
Then: `file server.js` → still BOM + CRLF.
Then: `grep -n "assign({ slots" server.js` → one line only, inside `saveAccountSlots`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-slot-history-customers.js && node scripts/test-slot-history-routes.js` → `11`, `10 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add server.js scripts/test-slot-history-customers.js
git commit -m "Accounts: customer moves, game swaps, returns, refunds and deletes go into the slot history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The History section in the slot popup

**Files:**
- Create: `.superpowers/tmp-edits/edit-slot-history-ui-tests.js`, `.superpowers/tmp-edits/edit-slot-history-ui.js`
- Modify (edit scripts): `scripts/test-accounts-template.js`, `scripts/test-admin-accounts-filter.js`, `views/partials/admin/accounts.ejs`, `public/js/admin-accounts.js`, `public/css/style.css`

**Interfaces:**
- Consumes:
  - The route from Task 2, and its JSON `{ now, lines, total, started }`.
  - In `admin-accounts.js`: `initModals`, `openSlot(id, type)`, `byId` and `window.__accFilter`.
  - `.superpowers/tmp-edits/rep.js`.
- Produces:
  - The markup ids `accSlotHistory`, `accHistNow`, `accHistList`, `accHistStarted` and `accHistMore`.
  - `window.__accFilter.historyRows(view, showAll)` → `{ rows, more }`.
  - The CSS `.acc-hist*`.

- [ ] **Step 1: Write the failing tests**

Create `.superpowers/tmp-edits/edit-slot-history-ui-tests.js`:

````js
// Slot renter history, part 3, the tests first: the slot popup's History
// markup (scripts/test-accounts-template.js) and the rule for how many lines
// it shows (scripts/test-admin-accounts-filter.js). Keeps each file's line
// endings.
const rep = require('./rep');

rep('scripts/test-accounts-template.js',
`console.log('\\nno accounts yet');
`,
`console.log('\\nslot popup history');

ok('the slot popup has the History section the script fills in, below the status form', () => {
  const box = html.slice(html.indexOf('id="accSlotModal"'));
  ['id="accSlotHistory"', 'id="accHistNow"', 'id="accHistList"', 'id="accHistStarted"', 'id="accHistMore"']
    .forEach(s => assert.ok(box.includes(s), s));
  assert.ok(box.indexOf('id="accSlotHistory"') > box.indexOf('</form>'), 'below the form');
  assert.ok(/id="accHistNow"[^>]*hidden/.test(box), 'the Now line starts hidden');
  assert.ok(/id="accHistMore"[^>]*hidden/.test(box), 'Show all starts hidden');
  assert.ok(box.includes('aria-live="polite"'));
});

console.log('\\nno accounts yet');
`);

rep('scripts/test-admin-accounts-filter.js',
`ok('admin.ejs loads admin-accounts.js with a cache-busting ?v=', () => {
`,
`console.log('\\nhistoryRows()');

ok('the slot popup shows the newest ten lines and offers the rest', () => {
  const lines = Array.from({ length: 14 }, (_, i) => ({ date: 'Oct ' + (27 - i), title: 'line ' + i, detail: '' }));
  const first = plain(F.historyRows({ lines }, false));
  assert.strictEqual(first.rows.length, 10);
  assert.strictEqual(first.rows[0].title, 'line 0');
  assert.strictEqual(first.more, 'Show all (14)');
  const all = plain(F.historyRows({ lines }, true));
  assert.strictEqual(all.rows.length, 14);
  assert.strictEqual(all.more, '');
});

ok('ten lines or fewer: no Show all; no history at all is an empty list', () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ title: 'line ' + i }));
  assert.strictEqual(plain(F.historyRows({ lines: ten }, false)).more, '');
  assert.deepStrictEqual(plain(F.historyRows(null, false)), { rows: [], more: '' });
});

ok('admin.ejs loads admin-accounts.js with a cache-busting ?v=', () => {
`);

console.log('edited test-accounts-template.js, test-admin-accounts-filter.js');
````

Run: `node .superpowers/tmp-edits/edit-slot-history-ui-tests.js` → `edited test-accounts-template.js, test-admin-accounts-filter.js`.

- [ ] **Step 2: Run them and watch them fail**

- Run: `node scripts/test-accounts-template.js` → FAIL `AssertionError [ERR_ASSERTION]: id="accSlotHistory"`.
- Run: `node scripts/test-admin-accounts-filter.js` → FAIL `TypeError: F.historyRows is not a function`.

- [ ] **Step 3: The section, its script and its styles**

Create `.superpowers/tmp-edits/edit-slot-history-ui.js`:

````js
// Slot renter history, part 3: the History section in the Accounts tab's slot
// popup. views/partials/admin/accounts.ejs gets the empty section,
// public/js/admin-accounts.js fetches GET /admin/accounts/:id/slot/:type/history
// when the popup opens and fills it in, and public/css/style.css styles it.
// Keeps each file's line endings.
const rep = require('./rep');

rep('views/partials/admin/accounts.ejs',
`          <button type="submit" class="qa-btn qa-gold">Update slot</button>
        </div>
      </form>
`,
`          <button type="submit" class="qa-btn qa-gold">Update slot</button>
        </div>
      </form>
      <%# Filled in by public/js/admin-accounts.js from
          GET /admin/accounts/:id/slot/:type/history when the popup opens. %>
      <div class="acc-hist" id="accSlotHistory" aria-live="polite">
        <div class="acc-hist-head">🕘 History</div>
        <div class="acc-hist-now" id="accHistNow" hidden></div>
        <ol class="acc-hist-list" id="accHistList"></ol>
        <div class="acc-hist-foot">
          <span id="accHistStarted"></span>
          <button type="button" class="acc-hist-more" id="accHistMore" hidden></button>
        </div>
      </div>
`);

const J = 'public/js/admin-accounts.js';

rep(J,
`  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  window.__accFilter = {`,
`  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  var HISTORY_SHOWN = 10;

  // The slot popup's History list: the newest ten lines unless "Show all" was
  // pressed, and that button's label ('' when nothing is left to show).
  function historyRows(view, showAll) {
    var lines = (view && view.lines) || [];
    var rows = showAll ? lines : lines.slice(0, HISTORY_SHOWN);
    var more = !showAll && lines.length > HISTORY_SHOWN ? 'Show all (' + lines.length + ')' : '';
    return { rows: rows, more: more };
  }

  window.__accFilter = {`);

rep(J,
`    isFiltering: isFiltering,
    plural: plural
  };`,
`    isFiltering: isFiltering,
    plural: plural,
    historyRows: historyRows
  };`);

rep(J,
`    var slotForm = byId('accSlotForm');
`,
`    var slotForm = byId('accSlotForm');
    var hist = {
      now: byId('accHistNow'), list: byId('accHistList'),
      started: byId('accHistStarted'), more: byId('accHistMore')
    };
    var histView = null;
    var histToken = 0;
`);

rep(J,
`    function openSlot(id, type) {
`,
`    // Built with textContent only: names and games are typed by hand and
    // must show as text.
    function histLine(line) {
      var li = document.createElement('li');
      li.className = 'acc-hist-line';
      var date = document.createElement('span');
      date.className = 'acc-hist-date';
      date.textContent = line.date || '';
      var body = document.createElement('span');
      body.className = 'acc-hist-body';
      var title = document.createElement('b');
      title.textContent = line.title || '';
      body.appendChild(title);
      if (line.detail) {
        var detail = document.createElement('span');
        detail.className = 'acc-hist-detail';
        detail.textContent = line.detail;
        body.appendChild(detail);
      }
      li.appendChild(date);
      li.appendChild(body);
      return li;
    }

    function histMessage(text) {
      histView = null;
      hist.now.hidden = true;
      hist.list.textContent = '';
      var li = document.createElement('li');
      li.className = 'acc-hist-empty';
      li.textContent = text;
      hist.list.appendChild(li);
      hist.more.hidden = true;
      hist.started.textContent = '';
    }

    function renderHistory(view, showAll) {
      histView = view;
      hist.now.textContent = '';
      hist.now.hidden = !view.now;
      if (view.now) {
        var label = document.createElement('b');
        label.textContent = 'Now: ';
        hist.now.appendChild(label);
        hist.now.appendChild(document.createTextNode(view.now.title + (view.now.detail ? ' · ' + view.now.detail : '')));
      }
      var shown = historyRows(view, showAll);
      hist.list.textContent = '';
      shown.rows.forEach(function (line) { hist.list.appendChild(histLine(line)); });
      if (!shown.rows.length) {
        var empty = document.createElement('li');
        empty.className = 'acc-hist-empty';
        empty.textContent = 'Nothing recorded yet.';
        hist.list.appendChild(empty);
      }
      hist.more.textContent = shown.more;
      hist.more.hidden = !shown.more;
      hist.started.textContent = view.started ? 'History starts ' + view.started : '';
    }

    // Asks the server for this slot's history. A popup reopened on another
    // slot before the answer came back ignores the stale answer.
    function loadHistory(id, type) {
      if (!hist.list || typeof fetch !== 'function') return;
      var token = ++histToken;
      histMessage('Loading…');
      fetch('/admin/accounts/' + encodeURIComponent(id) + '/slot/' + encodeURIComponent(type) + '/history', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (view) {
        if (token === histToken) renderHistory(view, false);
      }).catch(function () {
        if (token === histToken) histMessage("Couldn't load history");
      });
    }

    function openSlot(id, type) {
`);

rep(J,
`      syncSlotFields();
      open(slotModal);
    }
`,
`      syncSlotFields();
      loadHistory(id, type);
      open(slotModal);
    }
`);

rep(J,
`    slotForm.elements.status.addEventListener('change', syncSlotFields);
`,
`    slotForm.elements.status.addEventListener('change', syncSlotFields);
    if (hist.more) {
      hist.more.addEventListener('click', function () {
        if (histView) renderHistory(histView, true);
      });
    }
`);

const C = 'public/css/style.css';

rep(C,
`.acc-public-name { margin-top:0.55rem; }
`,
`.acc-public-name { margin-top:0.55rem; }
/* Slot popup: the slot's renter history (lib/slot-history.js), fetched when
   the popup opens. */
.acc-hist { border-top:1px solid #1f1f1f; padding:0.85rem 1.1rem 1rem; }
.acc-hist-head { font-size:0.63rem; text-transform:uppercase; letter-spacing:0.6px; color:#5a5a5a; font-weight:800; margin-bottom:0.5rem; }
.acc-hist-now { background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.3); color:#86efac; border-radius:8px; padding:0.45rem 0.65rem; font-size:0.78rem; margin-bottom:0.5rem; overflow-wrap:anywhere; }
.acc-hist-list { list-style:none; margin:0; padding:0; }
.acc-hist-line { display:grid; grid-template-columns:3.4rem minmax(0, 1fr); gap:0.5rem; padding:0.45rem 0; border-bottom:1px solid #1a1a1a; font-size:0.78rem; }
.acc-hist-date { color:#666; white-space:nowrap; }
.acc-hist-body b { color:#ddd; font-weight:700; }
.acc-hist-detail { display:block; color:#888; margin-top:0.1rem; overflow-wrap:anywhere; }
.acc-hist-empty { color:#666; font-size:0.78rem; padding:0.35rem 0; }
.acc-hist-foot { display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-top:0.55rem; font-size:0.7rem; color:#555; }
.acc-hist-more { background:none; border:0; padding:0; color:var(--ps-blue); font-weight:700; font-size:0.72rem; font-family:inherit; cursor:pointer; }
`);

rep(C,
`body.light-mode .acc-act { background:#f2f4f7; border-color:#e0e4e8; color:#4b5259; }
`,
`body.light-mode .acc-act { background:#f2f4f7; border-color:#e0e4e8; color:#4b5259; }
body.light-mode .acc-hist { border-top-color:#eef0f2; }
body.light-mode .acc-hist-line { border-bottom-color:#f0f2f4; }
body.light-mode .acc-hist-body b { color:#14171a; }
body.light-mode .acc-hist-now { background:#ecfdf5; border-color:#a7f3d0; color:#166534; }
`);

console.log('edited accounts.ejs, admin-accounts.js, style.css');
````

Run: `node .superpowers/tmp-edits/edit-slot-history-ui.js` → `edited accounts.ejs, admin-accounts.js, style.css`.
Then: `file public/css/style.css` → still `with CRLF line terminators`.

- [ ] **Step 4: Run them and watch them pass**

Run: `node scripts/test-accounts-template.js && node scripts/test-admin-accounts-filter.js` → `15`, `22 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add views/partials/admin/accounts.ejs public/js/admin-accounts.js public/css/style.css scripts/test-accounts-template.js scripts/test-admin-accounts-filter.js
git commit -m "Accounts: the slot popup shows the slot's renter history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Full suite, browser check and clean-up

Run by the controller, which has the built-in browser. Throwaway instance only. The password is made up and written to a git-ignored file.

**Files:**
- Create: `.superpowers/tmp-edits/serve-slot-history-review.js`
- Temporarily modify, outside the repo: `C:\Users\michael\Desktop\claude code\.claude\launch.json`. Add one entry, then remove it.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: nothing to commit.

- [ ] **Step 1: Run the whole suite**

Run: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"`
Expected: only `FAIL scripts/test-upcoming-psn-page-public.js` and `failed: 1`.

- [ ] **Step 2: Start the throwaway instance**

Create `.superpowers/tmp-edits/serve-slot-history-review.js`:

````js
// Throwaway review instance for the slot renter history, on port 4650: a temp
// DATA_DIR, a blank MONGODB_URI, made-up names, and a made-up admin password
// written to review-password.txt beside this file. PS Plus deluxe 3 · Trophy
// has 16 seeded history lines, so "Show all" shows; PS Plus deluxe 1 · Trophy
// has none. Runs from any folder:
//   node <repo>/.superpowers/tmp-edits/serve-slot-history-review.js
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-slothist-'));
const PASSWORD = 'review-' + Math.random().toString(36).slice(2, 8);
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };
const slot = (status, extra) => Object.assign({ enabled: true, status, renter_id: null, renter_name: '', start: '', end: '' }, extra || {});
const price = { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 };

const hist = [];
let id = 1;
const push = (n, e) => hist.push(Object.assign({ id: id++, account_id: 3, slot: 'trophy', at: iso(n) }, e));
push(-26, { kind: 'status', status: 'maintenance' });
push(-25, { kind: 'status', status: 'open' });
['Zzyzx Ana Reyes', 'Zzyzx Pedro Lim', 'Zzyzx Bea Tan', 'Zzyzx Carlo Go', 'Zzyzx Dina Uy', 'Zzyzx Eli Sy'].forEach((name, i) => {
  const start = -24 + i * 3;
  push(start, { kind: 'in', how: 'new', renter_name: name, game_title: 'PS Plus Deluxe', start: day(start), end: day(start + 7) });
  push(start + 2, { kind: 'out', how: i % 2 ? 'returned' : 'cleared', renter_name: name, game_title: 'PS Plus Deluxe', start: day(start) });
});
push(-4, { kind: 'in', how: 'moved', renter_id: 21, renter_name: 'Zzyzx Juan Cruz', game_title: 'PS Plus Deluxe', start: day(-3), end: day(27),
  other_account_id: 4, other_account_label: 'PS Plus deluxe 4 JAPAN', other_slot: 'trophy', from_game: 'Elden Ring', to_game: 'PS Plus Deluxe' });
push(-1, { kind: 'swap', renter_id: 21, renter_name: 'Zzyzx Juan Cruz', from_game: 'Elden Ring', to_game: 'PS Plus Deluxe' });

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: PASSWORD,
  games: [
    Object.assign({ id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5', non_trophy_slots: 0, trophy_slots: 0 }, price),
    Object.assign({ id: 6, title: 'Zzyzx Racer', platform: 'PS5' }, price)
  ],
  customers: [
    { id: 21, customer_name: 'Zzyzx Juan Cruz', game_id: 4, game_title: 'PS Plus Deluxe', account_type: 'tr', status: 'renting', days: 30, start_date: day(-3), end_date: day(27), price: 799 },
    { id: 22, customer_name: 'Zzyzx Maria Santos', game_id: 4, game_title: 'PS Plus Deluxe', account_type: 'nt', status: 'renting', days: 30, start_date: day(-8), end_date: day(22), price: 699 }
  ],
  nextCustomerId: 30,
  accounts: [1, 2, 3, 4, 5].map(n => ({
    id: n, label: n === 4 ? 'PS Plus deluxe 4 JAPAN' : 'PS Plus deluxe ' + n, game_ids: [4],
    slots: n === 3
      ? { trophy: slot('rented', { renter_id: 21, renter_name: 'Zzyzx Juan Cruz', start: day(-3), end: day(27) }),
          non_trophy: slot('rented', { renter_id: 22, renter_name: 'Zzyzx Maria Santos', start: day(-8), end: day(22) }),
          ps4_primary: slot('open') }
      : { trophy: slot(n === 1 ? 'maintenance' : 'open'), non_trophy: slot('open'), ps4_primary: slot('open') }
  })),
  nextAccountId: 6,
  slot_history: hist,
  nextSlotHistoryId: id,
  slot_history_started_at: iso(-27)
}));
fs.writeFileSync(path.join(__dirname, 'review-password.txt'), PASSWORD);

process.env.PORT = '4650';
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.chdir(ROOT);
// The admin cookie is Secure: tell the server these local http requests came
// over https, the way the real proxy does.
const origCreate = http.createServer;
http.createServer = function (...args) {
  const handler = args.find(a => typeof a === 'function');
  if (!handler) return origCreate.apply(http, args);
  const wrapped = (req, res) => { req.headers['x-forwarded-proto'] = 'https'; return handler(req, res); };
  return origCreate.apply(http, args.map(a => (a === handler ? wrapped : a)));
};
const sessionStore = require(path.join(ROOT, 'lib/session-store'));
sessionStore.createStore = () => { const s = new (require(path.join(ROOT, 'node_modules/express-session')).MemoryStore)(); s.ensureIndexes = async () => false; return s; };
require(path.join(ROOT, 'server.js'));
const done = () => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } process.exit(0); };
process.on('SIGINT', done);
process.on('SIGTERM', done);
setTimeout(done, 30 * 60 * 1000);
````

Add this entry to the `configurations` array of `C:\Users\michael\Desktop\claude code\.claude\launch.json`. Keep the other entries as they are:

```json
{
  "name": "slothist-review",
  "runtimeExecutable": "node",
  "runtimeArgs": ["C:/Users/michael/Desktop/claude code/playstation-hub/.superpowers/tmp-edits/serve-slot-history-review.js"],
  "port": 4650
}
```

Start it with `preview_start`. Open `http://localhost:4650/admin/login`, enter the password from `.superpowers/tmp-edits/review-password.txt`, and open `http://localhost:4650/admin?tab=accounts`.

- [ ] **Step 3: Check the popup at 1280px and 375px**

At 1280px, click PS Plus deluxe 3 · 🏆:
- Under the status form, History shows the green line `Now: Zzyzx Juan Cruz · PS Plus Deluxe · since … · ends …`.
- Then 10 lines, newest first, starting with `Zzyzx Juan Cruz swapped game` (`Elden Ring → PS Plus Deluxe · stayed on this slot`) and `Zzyzx Juan Cruz moved in` (`from PS Plus deluxe 4 JAPAN · Trophy · swapped Elden Ring → PS Plus Deluxe`).
- At the bottom: `History starts …` and `Show all (16)`. Clicking it lists all 16 and hides the button.
- Close the popup and click PS Plus deluxe 1 · 🏆. It shows `Nothing recorded yet.` and no Now line.
- Reopen PS Plus deluxe 3 · 🏆, set Status to Maintenance and click Update slot. Reopen it: the first two lines are `Set to Maintenance` (`changed by hand`) and `Zzyzx Juan Cruz left` (`cleared by hand · rented … · PS Plus Deluxe`).

At 375px (resize to the mobile preset, reload, then open the popup):
- The popup fits the screen and long lines wrap.
- `document.documentElement.scrollWidth` is 375.

The console shows no errors.

- [ ] **Step 4: Tear down and clean up**

- Reset the viewport to the desktop preset, and stop the server with `preview_stop`.
- Remove the `slothist-review` entry from `launch.json`.
- Stopping does not always let the launcher delete its data folder. Delete any leftover throwaway folders: `rm -rf "$TEMP"/review-slothist-*`. Each holds only `games.json` and an empty `uploads`.

```bash
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
