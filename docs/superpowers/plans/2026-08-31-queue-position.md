# Queue Position for Fall in Line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a customer waiting for a rented-out game how many people are ahead of them and what number they are, and let them upgrade to Priority without losing the time they have already waited.

**Architecture:** All ordering, masking and expiry rules live in one new pure module, `lib/queue.js`, which takes plain order objects and returns ordered rows. `lib/orders.js` gains a single query helper that fetches queue-eligible orders for a game; every page then calls `buildQueue()` on the result so the game page, the PS Plus page, the customer's order page and the admin card can never disagree about who is where. The upgrade path reuses the existing payment flow entirely — it only flips flags and hops one new state transition.

**Tech Stack:** Node + Express 4, EJS templates, MongoDB (via `lib/orders.js`), lowdb for catalogue data, plain CSS in one stylesheet. No test framework — tests are plain `assert` scripts run with `node`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-31-queue-position-design.md` (commit `16f44a7`). It governs; this plan implements it.
- Work directly on `main`. No worktree, no feature branch. Commit after each task.
- `QUEUE_EXPIRY_DAYS` is **30**. Free entries older than that stop counting; **priority (`reserved`) entries never expire**.
- Queues are scoped per `account_type`: `nt`, `tr`, `ps4`.
- Ordering is: `reserved` tier first, then everything else; within a tier `created_at` ascending; `ref` breaks ties.
- Masking: `"Michael Dela Cruz"` → `"Michael D."`. One-word names shown as-is. Blank → `"Guest"`. First word over 14 chars truncated with `…`. Never re-case a name.
- Unpaid Priority orders are **not** in the queue, **unless** they carry `upgraded_from_waitlist`.
- No new npm dependencies.
- CSS goes in `public/css/style.css` using the `ql-` prefix, matching the existing `gd-` / `ord-` / `oq-` convention.
- This project has no test framework by design. Tests are plain `assert` scripts under `scripts/`, run with `node scripts/<name>.js`, exiting non-zero on the first failure.
- Copy uses the peso sign `₱` and sentence case, matching the existing pages.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/queue.js` **(create)** | Every queue rule as pure functions over plain order objects. No DB, no Express. |
| `scripts/test-queue.js` **(create)** | Plain-assert tests for `lib/queue.js`. |
| `views/partials/queue-line.ejs` **(create)** | The count strip + popout modal + the client JS that re-renders them per type. Shared by all three customer pages. |
| `lib/orders.js` **(modify)** | One query helper (`listQueueCandidates`) and one new allowed transition (`waitlisted` → `awaiting_payment`). |
| `scripts/test-orders.js` **(modify)** | Fix the already-failing `STATES` assertion; add transition tests. |
| `server.js` **(modify)** | `/game/:slug` becomes async and loads queues; `/ps-plus/rent` likewise; `/order/:ref` computes position; new `POST /order/:ref/upgrade-priority`. |
| `views/game-detail.ejs` **(modify)** | Renders the partial in both no-slot branches. |
| `views/psplus-rent.ejs` **(modify)** | Renders the partial in the no-slot branch. |
| `views/order-status.ejs` **(modify)** | Position headline, count strip, upgrade card. |
| `views/partials/order-queue.ejs` **(modify)** | Admin waitlist card sorted in queue order with position numbers. |
| `public/css/style.css` **(modify)** | `ql-` styles for the strip, modal and upgrade card. |

---

## Task 1: Queue rules module

**Files:**
- Create: `lib/queue.js`
- Create: `scripts/test-queue.js`
- Modify: `scripts/test-orders.js:14-19` (fix the stale `STATES` assertion, which fails on `main` today)

**Interfaces:**
- Consumes: nothing — this is the base layer.
- Produces, all exported from `lib/queue.js`:
  - `QUEUE_EXPIRY_DAYS` — the number `30`
  - `inQueue(order, now)` → `boolean`
  - `isExpired(order, now)` → `boolean`
  - `maskName(raw)` → `string`
  - `buildQueue(orders, now)` → `{ nt: Row[], tr: Row[], ps4: Row[] }` where `Row` is `{ ref, position, tier, name, joinedAt, sessionId }`, `tier` being `'priority' | 'free'`
  - `positionOf(rows, ref)` → `number | null`
  - `aheadOf(rows, ref)` → `{ total, priority } | null`
  - `upgradedPosition(rows, ref)` → `number | null` — the position this ref would take if its ₱100 cleared right now

- [ ] **Step 1: Fix the pre-existing broken assertion in `scripts/test-orders.js`**

`node scripts/test-orders.js` fails on `main` right now. It asserts eight states, but `reserved` and `waitlisted` were added later. Replace lines 14–19:

```js
check('exposes the ten lifecycle states in order', () => {
  assert.deepStrictEqual(orders.STATES, [
    'awaiting_payment', 'verifying_payment', 'awaiting_qr', 'qr_pending',
    'active', 'awaiting_return', 'verifying_return', 'closed', 'reserved',
    'waitlisted'
  ]);
});
```

- [ ] **Step 2: Confirm the existing suite is green again**

Run: `node scripts/test-orders.js`
Expected: ends with `N assertions passed`, exit code 0.

- [ ] **Step 3: Write the failing tests**

Create `scripts/test-queue.js`:

```js
// Plain assert-based tests for the queue rules. No test framework in this
// project by design — run with `node scripts/test-queue.js`, which exits
// non-zero on the first failed assertion.
const assert = require('assert');
const queue = require('../lib/queue');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

const NOW = new Date('2026-08-31T12:00:00.000Z');

// Days before NOW, as the ISO string orders store in created_at.
function daysAgo(n) {
  return new Date(NOW.getTime() - n * 86400000).toISOString();
}

function entry(over) {
  return Object.assign({
    ref: 'PH-0001',
    game_id: 5,
    account_type: 'tr',
    state: 'waitlisted',
    fb_name: 'Test User',
    created_at: daysAgo(1),
    session_id: 'sess-1'
  }, over);
}

check('masks a two-word name to first name plus last initial', () => {
  assert.strictEqual(queue.maskName('Michael Dela Cruz'), 'Michael C.');
  assert.strictEqual(queue.maskName('Jenny Reyes'), 'Jenny R.');
});

check('leaves a one-word name alone and never re-cases a name', () => {
  assert.strictEqual(queue.maskName('carlo'), 'carlo');
  assert.strictEqual(queue.maskName('MARIA santos'), 'MARIA s.');
});

check('falls back to Guest for a blank name', () => {
  assert.strictEqual(queue.maskName(''), 'Guest');
  assert.strictEqual(queue.maskName('   '), 'Guest');
  assert.strictEqual(queue.maskName(null), 'Guest');
  assert.strictEqual(queue.maskName(undefined), 'Guest');
});

check('truncates a very long first word', () => {
  assert.strictEqual(queue.maskName('Bartholomewesque Santos'), 'Bartholomewesq… S.');
});

check('collapses runs of whitespace before masking', () => {
  assert.strictEqual(queue.maskName('  Michael   Dela   Cruz  '), 'Michael C.');
});

check('a free entry counts until it is 30 days old', () => {
  assert.strictEqual(queue.inQueue(entry({ created_at: daysAgo(29) }), NOW), true);
  assert.strictEqual(queue.inQueue(entry({ created_at: daysAgo(30) }), NOW), true);
  assert.strictEqual(queue.inQueue(entry({ created_at: daysAgo(31) }), NOW), false);
});

check('a paid priority entry never expires', () => {
  const old = entry({ state: 'reserved', created_at: daysAgo(400) });
  assert.strictEqual(queue.inQueue(old, NOW), true);
});

check('an entry with no created_at is kept rather than silently dropped', () => {
  // A data glitch must not delete a real person from the line. Failing open is
  // the safe direction here.
  assert.strictEqual(queue.inQueue(entry({ created_at: null }), NOW), true);
});

check('an unpaid priority order that was never a waitlist entry is excluded', () => {
  assert.strictEqual(queue.inQueue(entry({ state: 'awaiting_payment' }), NOW), false);
  assert.strictEqual(queue.inQueue(entry({ state: 'verifying_payment' }), NOW), false);
});

check('an upgrading waitlist entry stays in the queue while it pays', () => {
  const up = { upgraded_from_waitlist: true };
  assert.strictEqual(queue.inQueue(entry(Object.assign({ state: 'awaiting_payment' }, up)), NOW), true);
  assert.strictEqual(queue.inQueue(entry(Object.assign({ state: 'verifying_payment' }, up)), NOW), true);
  assert.strictEqual(queue.inQueue(entry(Object.assign({ state: 'payment_rejected' }, up)), NOW), true);
});

check('pre-orders are a different queue and are excluded', () => {
  assert.strictEqual(queue.inQueue(entry({ state: 'reserved', upcoming_game_id: 9 }), NOW), false);
  assert.strictEqual(queue.inQueue(entry({ state: 'reserved', is_buy: true }), NOW), false);
});

check('closed and cancelled orders hold no place', () => {
  assert.strictEqual(queue.inQueue(entry({ state: 'cancelled' }), NOW), false);
  assert.strictEqual(queue.inQueue(entry({ state: 'closed' }), NOW), false);
  assert.strictEqual(queue.inQueue(entry({ state: 'active' }), NOW), false);
});

check('priority sorts above free regardless of join time', () => {
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0002', state: 'waitlisted', created_at: daysAgo(20) }),
    entry({ ref: 'PH-0003', state: 'reserved', created_at: daysAgo(2) })
  ], NOW).tr;
  assert.deepStrictEqual(rows.map(r => r.ref), ['PH-0003', 'PH-0002']);
  assert.deepStrictEqual(rows.map(r => r.tier), ['priority', 'free']);
  assert.deepStrictEqual(rows.map(r => r.position), [1, 2]);
});

check('within a tier the oldest entry is number one', () => {
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0002', created_at: daysAgo(2) }),
    entry({ ref: 'PH-0003', created_at: daysAgo(9) }),
    entry({ ref: 'PH-0004', created_at: daysAgo(5) })
  ], NOW).tr;
  assert.deepStrictEqual(rows.map(r => r.ref), ['PH-0003', 'PH-0004', 'PH-0002']);
});

check('ties break on ref so the order is deterministic', () => {
  const same = daysAgo(3);
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0009', created_at: same }),
    entry({ ref: 'PH-0007', created_at: same })
  ], NOW).tr;
  assert.deepStrictEqual(rows.map(r => r.ref), ['PH-0007', 'PH-0009']);
});

check('each account type is counted separately', () => {
  const q = queue.buildQueue([
    entry({ ref: 'PH-0002', account_type: 'tr' }),
    entry({ ref: 'PH-0003', account_type: 'nt' }),
    entry({ ref: 'PH-0004', account_type: 'nt' }),
    entry({ ref: 'PH-0005', account_type: 'ps4' })
  ], NOW);
  assert.strictEqual(q.tr.length, 1);
  assert.strictEqual(q.nt.length, 2);
  assert.strictEqual(q.ps4.length, 1);
});

check('an unknown account type is dropped rather than crashing', () => {
  const q = queue.buildQueue([entry({ account_type: 'bogus' })], NOW);
  assert.deepStrictEqual(Object.keys(q).sort(), ['nt', 'ps4', 'tr']);
  assert.strictEqual(q.tr.length + q.nt.length + q.ps4.length, 0);
});

check('a row carries a masked name and the raw session id', () => {
  const row = queue.buildQueue([entry({ fb_name: 'Aira Santos', session_id: 'abc' })], NOW).tr[0];
  assert.strictEqual(row.name, 'Aira S.');
  assert.strictEqual(row.sessionId, 'abc');
  assert.strictEqual(row.tier, 'free');
});

check('positionOf finds a ref and returns null for one that is absent', () => {
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0002', created_at: daysAgo(9) }),
    entry({ ref: 'PH-0003', created_at: daysAgo(4) })
  ], NOW).tr;
  assert.strictEqual(queue.positionOf(rows, 'PH-0003'), 2);
  assert.strictEqual(queue.positionOf(rows, 'PH-9999'), null);
  assert.strictEqual(queue.positionOf([], 'PH-0002'), null);
});

check('aheadOf splits the people in front into paid and total', () => {
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0002', state: 'reserved', created_at: daysAgo(9) }),
    entry({ ref: 'PH-0003', state: 'reserved', created_at: daysAgo(7) }),
    entry({ ref: 'PH-0004', created_at: daysAgo(8) }),
    entry({ ref: 'PH-0005', created_at: daysAgo(3) })
  ], NOW).tr;
  assert.deepStrictEqual(queue.aheadOf(rows, 'PH-0005'), { total: 3, priority: 2 });
  assert.deepStrictEqual(queue.aheadOf(rows, 'PH-0002'), { total: 0, priority: 0 });
  assert.strictEqual(queue.aheadOf(rows, 'PH-9999'), null);
});

check('upgradedPosition ranks an upgrader by their original join time', () => {
  // PH-0004 fell in line 8 days ago — LONGER than the priority holder who paid
  // 7 days ago. Because upgrading keeps created_at, clearing the ₱100 must put
  // them at #2, ahead of that holder. Counting priority rows and adding one
  // would wrongly say #3.
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0002', state: 'reserved', created_at: daysAgo(9) }),
    entry({ ref: 'PH-0003', state: 'reserved', created_at: daysAgo(7) }),
    entry({ ref: 'PH-0004', created_at: daysAgo(8) }),
    entry({ ref: 'PH-0005', created_at: daysAgo(3) })
  ], NOW).tr;
  assert.deepStrictEqual(rows.map(r => r.ref), ['PH-0002', 'PH-0003', 'PH-0004', 'PH-0005']);
  assert.strictEqual(queue.upgradedPosition(rows, 'PH-0004'), 2);
  // PH-0005 is the newest of all, so it lands behind both paid holders.
  assert.strictEqual(queue.upgradedPosition(rows, 'PH-0005'), 3);
  assert.strictEqual(queue.upgradedPosition(rows, 'PH-9999'), null);
});

check('upgrading with nobody paid ahead of you takes the top spot', () => {
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0004', created_at: daysAgo(8) }),
    entry({ ref: 'PH-0005', created_at: daysAgo(3) })
  ], NOW).tr;
  assert.strictEqual(queue.upgradedPosition(rows, 'PH-0005'), 1);
});

check('isExpired only ever fires on a stale free entry', () => {
  assert.strictEqual(queue.isExpired(entry({ created_at: daysAgo(31) }), NOW), true);
  assert.strictEqual(queue.isExpired(entry({ created_at: daysAgo(10) }), NOW), false);
  assert.strictEqual(queue.isExpired(entry({ state: 'reserved', created_at: daysAgo(400) }), NOW), false);
  assert.strictEqual(queue.isExpired(entry({ state: 'active', created_at: daysAgo(400) }), NOW), false);
});

console.log('\n' + passed + ' assertions passed');
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node scripts/test-queue.js`
Expected: FAIL — `Cannot find module '../lib/queue'`.

- [ ] **Step 5: Write `lib/queue.js`**

```js
// Queue position rules for Fall in Line / Priority. Kept as pure functions over
// plain order objects — no database access and no Express — so the game page,
// the PS Plus page, the customer's order page and the admin card all read one
// implementation and can never disagree about who is where in line.
//
// See docs/superpowers/specs/2026-08-31-queue-position-design.md.

// A free entry that has outlasted a full monthly rental cycle has almost
// certainly been abandoned, so it stops counting against everyone behind it.
// This is a DISPLAY filter only: nothing is deleted and the admin card still
// shows the row. Paid priority entries are deliberately exempt — somebody paid
// ₱100 for that place and must never be dropped silently.
const QUEUE_EXPIRY_DAYS = 30;

// The two states that hold a place in line: a confirmed ₱100 reservation, and
// a free Fall in Line entry.
const QUEUE_STATES = Object.freeze(['reserved', 'waitlisted']);

// Mid-payment states that hold a place ONLY on an order that is an upgrading
// waitlist entry. A priority order that was never a waitlist entry and has not
// been paid for yet is not in the queue — unpaid money buys no place. Without
// this list an upgrading customer would vanish from the line the moment they
// clicked upgrade and reappear only once the payment cleared.
const UPGRADE_PENDING_STATES = Object.freeze([
  'awaiting_payment', 'verifying_payment', 'payment_rejected'
]);

const TYPES = Object.freeze(['nt', 'tr', 'ps4']);

// Age in whole-ish days. An order with no parseable created_at reports 0 rather
// than Infinity: failing open keeps a real person in the line when their
// timestamp is missing, where failing closed would silently delete them.
function ageDays(order, now) {
  const t = Date.parse((order && order.created_at) || '');
  if (isNaN(t)) return 0;
  return (now.getTime() - t) / 86400000;
}

// Coming Soon pre-orders and permanent purchases share the 'reserved' state
// with priority reservations but belong to a different queue entirely.
function isPreorder(order) {
  return !!(order && (order.upcoming_game_id || order.is_buy));
}

function tierOf(order) {
  return order && order.state === 'reserved' ? 'priority' : 'free';
}

function inQueue(order, now) {
  if (!order || isPreorder(order)) return false;
  const at = now instanceof Date ? now : new Date(now || Date.now());
  if (QUEUE_STATES.includes(order.state)) {
    if (order.state === 'reserved') return true;
    return ageDays(order, at) <= QUEUE_EXPIRY_DAYS;
  }
  if (order.upgraded_from_waitlist && UPGRADE_PENDING_STATES.includes(order.state)) {
    return ageDays(order, at) <= QUEUE_EXPIRY_DAYS;
  }
  return false;
}

// True only for a free entry that has aged out — the one case where the
// customer's own order page should offer "message us to rejoin" instead of a
// position. Never true for a paid entry, which does not expire.
function isExpired(order, now) {
  if (!order || order.state !== 'waitlisted') return false;
  const at = now instanceof Date ? now : new Date(now || Date.now());
  return ageDays(order, at) > QUEUE_EXPIRY_DAYS;
}

// "Michael Dela Cruz" -> "Michael D." — enough for someone to recognise their
// own row, not enough to identify a stranger. Names are never re-cased: this
// renders what the customer typed, only shorter.
function maskName(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!s) return 'Guest';
  const parts = s.split(' ');
  const first = parts[0].length > 14 ? parts[0].slice(0, 14) + '…' : parts[0];
  if (parts.length === 1) return first;
  return first + ' ' + parts[parts.length - 1][0] + '.';
}

function compareEntries(a, b) {
  const ta = tierOf(a) === 'priority' ? 0 : 1;
  const tb = tierOf(b) === 'priority' ? 0 : 1;
  if (ta !== tb) return ta - tb;
  const da = Date.parse(a.created_at || '') || 0;
  const db = Date.parse(b.created_at || '') || 0;
  if (da !== db) return da - db;
  return String(a.ref).localeCompare(String(b.ref));
}

// Groups queue-eligible orders by account type and numbers them. Rows are
// already masked, so a caller can hand them straight to a template without
// having to remember to hide anything.
function buildQueue(orders, now) {
  const at = now instanceof Date ? now : new Date(now || Date.now());
  const out = { nt: [], tr: [], ps4: [] };
  (orders || []).forEach(o => {
    if (!inQueue(o, at)) return;
    if (TYPES.includes(o.account_type)) out[o.account_type].push(o);
  });
  TYPES.forEach(type => {
    out[type] = out[type].sort(compareEntries).map((o, i) => ({
      ref: o.ref,
      position: i + 1,
      tier: tierOf(o),
      name: maskName(o.fb_name),
      joinedAt: o.created_at || null,
      sessionId: o.session_id || null
    }));
  });
  return out;
}

function positionOf(rows, ref) {
  const row = (rows || []).find(r => r.ref === ref);
  return row ? row.position : null;
}

// How many people are in front of this ref, and how many of those paid. Drives
// the "2 ahead of you paid priority" line on the customer's order page.
function aheadOf(rows, ref) {
  const list = rows || [];
  const me = list.find(r => r.ref === ref);
  if (!me) return null;
  const ahead = list.filter(r => r.position < me.position);
  return { total: ahead.length, priority: ahead.filter(r => r.tier === 'priority').length };
}

// The position this ref would take if its ₱100 cleared right now. Upgrading
// keeps created_at, so an upgrader is ranked among priority holders by when
// they FIRST fell in line — which can place them above someone who paid more
// recently. Counting the priority tier and adding one would understate that.
function upgradedPosition(rows, ref) {
  const list = rows || [];
  const me = list.find(r => r.ref === ref);
  if (!me) return null;
  const mine = Date.parse(me.joinedAt || '') || 0;
  const ahead = list.filter(r => {
    if (r.tier !== 'priority') return false;
    const t = Date.parse(r.joinedAt || '') || 0;
    if (t !== mine) return t < mine;
    return String(r.ref).localeCompare(String(ref)) < 0;
  });
  return ahead.length + 1;
}

module.exports = {
  QUEUE_EXPIRY_DAYS, QUEUE_STATES, UPGRADE_PENDING_STATES, TYPES,
  inQueue, isExpired, maskName, buildQueue, positionOf, aheadOf, upgradedPosition
};
```

- [ ] **Step 6: Run both test scripts and verify they pass**

Run: `node scripts/test-queue.js && node scripts/test-orders.js`
Expected: both print `N assertions passed`, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add lib/queue.js scripts/test-queue.js scripts/test-orders.js
git commit -m "Add queue position rules module"
```

---

## Task 2: Query helper and the upgrade transition

**Files:**
- Modify: `lib/orders.js:44-49` (the `waitlisted` entry in `ALLOWED`), `lib/orders.js:140-144` (beside `listByStates`), `lib/orders.js:253-258` (exports)
- Test: `scripts/test-orders.js`

**Interfaces:**
- Consumes: `lib/queue.js` exports `QUEUE_STATES` and `UPGRADE_PENDING_STATES` from Task 1.
- Produces: `orders.listQueueCandidates(gameId)` → `Promise<Array>` of raw order documents; and `orders.canTransition('waitlisted', 'awaiting_payment') === true`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-orders.js`, immediately before the final `console.log` line:

```js
check('a waitlist entry can start paying to upgrade to priority', () => {
  // The Fall in Line -> Priority upgrade hops the order into the ordinary
  // payment flow rather than creating a second order, so the customer keeps
  // their ref, their link and their place in line.
  assert.strictEqual(orders.canTransition('waitlisted', 'awaiting_payment'), true);
  assert.strictEqual(orders.canTransition('waitlisted', 'cancelled'), true);
});

check('a waitlist entry still cannot skip straight to a paid state', () => {
  assert.strictEqual(orders.canTransition('waitlisted', 'reserved'), false);
  assert.strictEqual(orders.canTransition('waitlisted', 'active'), false);
  assert.strictEqual(orders.canTransition('waitlisted', 'awaiting_qr'), false);
});

check('exposes a queue-candidate query helper', () => {
  assert.strictEqual(typeof orders.listQueueCandidates, 'function');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/test-orders.js`
Expected: FAIL on the first new assertion — `canTransition('waitlisted', 'awaiting_payment')` returns `false`.

- [ ] **Step 3: Allow the transition**

In `lib/orders.js`, replace the `waitlisted` entry in the `ALLOWED` map (currently `waitlisted: ['cancelled']`, with the comment block above it) so the comment reflects the new exit and the array gains the state:

```js
  // Fall in Line: a free, unpaid entry recorded so the owner can see and
  // message the customer without scrolling chat. Nothing transitions it
  // automatically — the owner starts a fresh real order by hand once a slot
  // opens for that person (same as they already do today from a Messenger
  // DM), and can drop a stale entry via /admin/orders/:ref/cancel.
  //
  // 'awaiting_payment' is the Fall in Line -> Priority upgrade
  // (POST /order/:ref/upgrade-priority). Upgrading in place rather than
  // creating a second order is what lets the customer keep their ref, their
  // order link and — because created_at is untouched — their place in line.
  waitlisted:        ['cancelled', 'awaiting_payment']
```

- [ ] **Step 4: Add the query helper**

In `lib/orders.js`, directly below `listByStates` (which ends around line 144), add:

```js
// Every order that could hold a place in one game's queue. Deliberately broader
// than the queue itself: the membership, expiry and ordering rules all live in
// lib/queue.js, so this stays a dumb fetch and there is exactly one place where
// "who is in line" is decided.
async function listQueueCandidates(gameId) {
  const col = await _col('orders');
  if (!col) return [];
  const states = queueRules.QUEUE_STATES.concat(queueRules.UPGRADE_PENDING_STATES);
  return col.find({
    game_id: gameId,
    state: { $in: states }
  }).sort({ created_at: 1 }).toArray();
}
```

At the top of `lib/orders.js`, beside the existing `const STATES = ...` declarations, add the require:

```js
const queueRules = require('./queue');
```

- [ ] **Step 5: Export the helper**

In the `module.exports` block at the bottom of `lib/orders.js`, add `listQueueCandidates` to the line listing query functions:

```js
  nextRef, create, getByRef, listByStates, listQueueCandidates, transition,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node scripts/test-orders.js && node scripts/test-queue.js`
Expected: both green.

- [ ] **Step 7: Verify the server still boots**

Run: `node -e "require('./lib/orders'); require('./lib/queue'); console.log('modules load')"`
Expected: prints `modules load` — confirms the new `require` did not create a cycle.

- [ ] **Step 8: Commit**

```bash
git add lib/orders.js scripts/test-orders.js
git commit -m "Add queue candidate query and the upgrade transition"
```

---

## Task 3: The shared count strip and popout partial

**Files:**
- Create: `views/partials/queue-line.ejs`
- Modify: `public/css/style.css` (append at end of file)

**Interfaces:**
- Consumes: rows produced by `buildQueue()` from Task 1 — `{ ref, position, tier, name, joinedAt, sessionId }`.
- Produces: a partial included as
  `<%- include('partials/queue-line', { queues, activeType, selfRef, selfSession, suffix }) %>` where:
  - `queues` — `{ nt: Row[], tr: Row[], ps4: Row[] }`
  - `activeType` — `'nt' | 'tr' | 'ps4'`, which queue to show first
  - `selfRef` — the viewer's own order ref, or `null`
  - `selfSession` — the viewer's session id, or `null`
  - `suffix` — a string making element ids unique when the partial renders twice on one page (`''` and `'All'`, matching the existing `noslot-options` convention)
  It also defines `window.qlShow(suffix, type)`, which later tasks call from the type-pill handler to switch which queue is displayed.

- [ ] **Step 1: Create the partial**

Create `views/partials/queue-line.ejs`:

```html
<!-- Count strip + popout list of everyone waiting for one account type.
     Rendered wherever a "no slot" card appears, and on the customer's own order
     page. The strip shows a count only; the names live behind a deliberate tap
     so they are not sitting in public view for anyone who scrolls past.

     `suffix` lets this render twice on one page without id collisions — pass ''
     for the primary block and a second string (e.g. 'All') for the
     all-types-unavailable block, matching partials/noslot-options.ejs. -->
<div class="ql-strip" id="qlStrip<%= suffix %>" style="display:none;"
     role="button" tabindex="0"
     onclick="qlOpen('<%= suffix %>')"
     onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();qlOpen('<%= suffix %>');}">
  <span class="ql-strip-icon">👥</span>
  <div class="ql-strip-text">
    <div class="ql-strip-count" id="qlCount<%= suffix %>"></div>
    <div class="ql-strip-sub" id="qlSub<%= suffix %>"></div>
  </div>
  <span class="ql-strip-link">View list</span>
</div>

<div class="ql-modal" id="qlModal<%= suffix %>" style="display:none;"
     role="dialog" aria-modal="true" aria-labelledby="qlModalTitle<%= suffix %>">
  <div class="ql-modal-backdrop" onclick="qlClose('<%= suffix %>')"></div>
  <div class="ql-modal-card">
    <div class="ql-modal-head">
      <div>
        <div class="ql-modal-title" id="qlModalTitle<%= suffix %>"></div>
        <div class="ql-modal-sub" id="qlModalSub<%= suffix %>"></div>
      </div>
      <button type="button" class="ql-modal-x" aria-label="Close" onclick="qlClose('<%= suffix %>')">✕</button>
    </div>
    <div class="ql-modal-rows" id="qlRows<%= suffix %>"></div>
    <div class="ql-modal-foot">⭐ Priority holders are served first.</div>
  </div>
</div>

<script>
(function(){
  var SUF = <%- JSON.stringify(String(suffix)).replace(/</g, '\\u003c') %>;
  // Names are masked server-side but are still customer-supplied text, so the
  // '<' escape below is what stops a name from closing this script tag.
  var DATA = <%- JSON.stringify(queues || { nt: [], tr: [], ps4: [] }).replace(/</g, '\\u003c') %>;
  var SELF_REF = <%- JSON.stringify(selfRef || null).replace(/</g, '\\u003c') %>;
  var SELF_SESSION = <%- JSON.stringify(selfSession || null).replace(/</g, '\\u003c') %>;
  var LABELS = { nt: 'Non-trophy', tr: 'Trophy', ps4: 'PS4 primary' };

  window.qlState = window.qlState || {};
  window.qlState[SUF] = { type: <%- JSON.stringify(String(activeType)).replace(/</g, '\\u003c') %> };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  function joinedLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  }

  function isSelf(row) {
    if (SELF_REF && row.ref === SELF_REF) return true;
    return !!(SELF_SESSION && row.sessionId && row.sessionId === SELF_SESSION);
  }

  window.qlRender = function(suffix, type) {
    var st = window.qlState[suffix];
    if (!st) return;
    if (type) st.type = type;
    var rows = (DATA && DATA[st.type]) || [];
    var strip = document.getElementById('qlStrip' + suffix);
    if (!strip) return;
    if (!rows.length) { strip.style.display = 'none'; return; }
    strip.style.display = 'flex';

    var label = (LABELS[st.type] || '').toLowerCase();
    var mine = null;
    for (var i = 0; i < rows.length; i++) { if (isSelf(rows[i])) { mine = rows[i]; break; } }

    document.getElementById('qlCount' + suffix).textContent =
      rows.length + (rows.length === 1 ? ' in line for ' : ' in line for ') + label;
    document.getElementById('qlSub' + suffix).textContent = mine
      ? "You're #" + mine.position
      : "Join now and you'll be #" + (rows.length + 1);

    document.getElementById('qlModalTitle' + suffix).textContent = (LABELS[st.type] || '') + ' line';
    document.getElementById('qlModalSub' + suffix).textContent =
      rows.length + (rows.length === 1 ? ' waiting' : ' waiting');

    var html = '';
    rows.forEach(function(r){
      var self = isSelf(r);
      html += '<div class="ql-row' + (self ? ' ql-row-self' : '') + '">'
        +  '<span class="ql-row-pos">#' + r.position + '</span>'
        +  '<span class="ql-row-star">' + (r.tier === 'priority' ? '⭐' : '') + '</span>'
        +  '<span class="ql-row-name">' + esc(r.name) + (self ? ' (you)' : '') + '</span>'
        +  '<span class="ql-row-date">' + esc(joinedLabel(r.joinedAt)) + '</span>'
        + '</div>';
    });
    document.getElementById('qlRows' + suffix).innerHTML = html;
  };

  window.qlShow = function(suffix, type) { window.qlRender(suffix, type); };

  window.qlOpen = function(suffix) {
    var m = document.getElementById('qlModal' + suffix);
    if (m) m.style.display = 'block';
  };
  window.qlClose = function(suffix) {
    var m = document.getElementById('qlModal' + suffix);
    if (m) m.style.display = 'none';
  };

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') window.qlClose(SUF);
  });

  window.qlRender(SUF, null);
})();
</script>
```

- [ ] **Step 2: Add the styles**

Append to the end of `public/css/style.css`:

```css
/* Queue position: the count strip on a no-slot card and the popout list it
   opens. Blue rather than the card's purple so the strip reads as information
   about the line, not as a third thing to choose. */
.ql-strip { display: flex; align-items: center; gap: 0.6rem; background: #0f1420; border: 1px solid #23324d; border-radius: 10px; padding: 0.6rem 0.7rem; margin-bottom: 0.5rem; cursor: pointer; }
.ql-strip:hover, .ql-strip:focus { border-color: #3b5480; outline: none; }
.ql-strip-icon { font-size: 1rem; line-height: 1; }
.ql-strip-text { flex: 1; min-width: 0; }
.ql-strip-count { font-size: 0.8rem; font-weight: 700; color: #93c5fd; }
.ql-strip-sub { font-size: 0.72rem; color: #64748b; margin-top: 0.1rem; }
.ql-strip-link { font-size: 0.72rem; color: #60a5fa; white-space: nowrap; }

.ql-modal { position: fixed; inset: 0; z-index: 200; }
.ql-modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.6); }
.ql-modal-card { position: relative; margin: 10vh auto 0; max-width: 380px; width: calc(100% - 2rem); background: #111116; border: 1px solid #2c2c34; border-radius: 14px; padding: 0.85rem 0.9rem; max-height: 74vh; overflow-y: auto; }
.ql-modal-head { display: flex; align-items: flex-start; gap: 0.6rem; margin-bottom: 0.6rem; }
.ql-modal-title { font-size: 0.95rem; font-weight: 800; color: #fff; }
.ql-modal-sub { font-size: 0.72rem; color: #64748b; margin-top: 0.1rem; }
.ql-modal-x { margin-left: auto; background: none; border: none; color: #777; font-size: 1rem; cursor: pointer; padding: 0 0.2rem; }
.ql-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0; border-top: 1px solid #23232b; }
.ql-row-pos { font-size: 0.72rem; color: #64748b; width: 1.5rem; flex: none; }
.ql-row-star { width: 1rem; flex: none; font-size: 0.75rem; }
.ql-row-name { font-size: 0.8rem; color: #ddd; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ql-row-date { font-size: 0.72rem; color: #64748b; flex: none; }
.ql-row-self { background: #132a1c; border: 1px solid #22c55e; border-radius: 9px; padding: 0.45rem 0.5rem; margin-top: 0.35rem; }
.ql-row-self .ql-row-name { color: #fff; }
.ql-row-self .ql-row-pos, .ql-row-self .ql-row-date { color: #4ade80; }
.ql-modal-foot { border-top: 1px solid #23232b; margin-top: 0.6rem; padding-top: 0.6rem; font-size: 0.72rem; color: #64748b; }
```

- [ ] **Step 3: Verify the partial compiles**

Run:
```bash
node -e "const ejs=require('ejs'),fs=require('fs');ejs.compile(fs.readFileSync('views/partials/queue-line.ejs','utf8'),{filename:'views/partials/queue-line.ejs'});console.log('compiles OK')"
```
Expected: prints `compiles OK`.

- [ ] **Step 4: Verify it renders with real-shaped data**

Run:
```bash
node -e "
const ejs=require('ejs'),fs=require('fs');
const q=require('./lib/queue');
const rows=q.buildQueue([
 {ref:'PH-1',account_type:'tr',state:'reserved',fb_name:'Michael Dela Cruz',created_at:'2026-08-24T00:00:00Z',session_id:'a'},
 {ref:'PH-2',account_type:'tr',state:'waitlisted',fb_name:'Carlo <script>M',created_at:'2026-08-28T00:00:00Z',session_id:'b'}
], new Date('2026-08-31T12:00:00Z'));
const out=ejs.render(fs.readFileSync('views/partials/queue-line.ejs','utf8'),
 {queues:rows,activeType:'tr',selfRef:null,selfSession:'b',suffix:''},
 {filename:'views/partials/queue-line.ejs'});
if(out.includes('</script>M'))throw new Error('name escaped the script tag');
console.log('renders OK, no script break');
"
```
Expected: prints `renders OK, no script break`. This is the injection guard — a customer whose Facebook name contains markup must not be able to close the inline script.

- [ ] **Step 5: Commit**

```bash
git add views/partials/queue-line.ejs public/css/style.css
git commit -m "Add the queue count strip and popout partial"
```

---

## Task 4: Wire the queue into the game page

**Files:**
- Modify: `server.js:2507-2519` (the `/game/:slug` handler)
- Modify: `views/game-detail.ejs` — two include points (inside `#reserveSection`, around line 344; and inside `#reserveSectionAll`, around line 353) plus the type-pill handler
- Test: manual, via the running dev server

**Interfaces:**
- Consumes: `orders.listQueueCandidates(gameId)` (Task 2), `queue.buildQueue(orders, now)` (Task 1), the `queue-line` partial and `window.qlShow(suffix, type)` (Task 3).
- Produces: `game-detail.ejs` receives a `queues` local. Nothing later depends on this task.

- [ ] **Step 1: Make the route async and load the queues**

In `server.js`, replace the `/game/:slug` handler:

```js
app.get('/game/:slug', async (req, res) => {
  const param = req.params.slug;
  // Support both numeric ID (old links) and slug
  let game = /^\d+$/.test(param)
    ? getGame(parseInt(param))
    : getGames().find(g => gameSlug(g.title) === param);
  if (!game) return res.redirect('/browse');
  // Redirect numeric URLs to slug URL
  if (/^\d+$/.test(param)) return res.redirect(301, '/game/' + gameSlug(game.title));
  const resolved = resolveGamePrices(resolveSlotDays(game));
  const gdSettings = getSiteSettings();
  // Who is waiting for each account type. A database outage returns [] rather
  // than throwing, so the page keeps rendering without the queue strip.
  let queues = { nt: [], tr: [], ps4: [] };
  try {
    queues = queueRules.buildQueue(await orders.listQueueCandidates(game.id), new Date());
  } catch (e) { console.error('[game queue]', e.message); }
  res.render('game-detail', { game: resolved, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: gdSettings, promo: gdSettings.promo, accountSummary: gameAccountSummary(game.id), order_error: req.query.order_error || null, queues, selfSession: req.sessionId || null });
});
```

- [ ] **Step 2: Require the queue module in `server.js`**

Find the line that requires the orders library (`const orders = require('./lib/orders');`) and add directly beneath it:

```js
const queueRules = require('./lib/queue');
```

- [ ] **Step 3: Include the partial in both no-slot branches**

In `views/game-detail.ejs`, inside `<div id="reserveSection" style="display:none;">`, immediately after the `.gd-noslot-banner` block that closes just before `<div class="gd-section-label" style="margin-top:1rem;">CHOOSE YOUR OPTION</div>`, insert:

```html
          <%- include('partials/queue-line', { queues: queues, activeType: 'tr', selfRef: null, selfSession: selfSession, suffix: '' }) %>
```

Then inside `<div id="reserveSectionAll">`, immediately before the `<div class="gd-section-label" style="margin-top:1.5rem;">CHOOSE YOUR OPTION</div>` line, insert:

```html
        <%- include('partials/queue-line', { queues: queues, activeType: (trAvail ? 'tr' : (ntAvail ? 'nt' : 'tr')), selfRef: null, selfSession: selfSession, suffix: 'All' }) %>
```

- [ ] **Step 4: Point the type-pill handler at the strip**

`views/game-detail.ejs` already has an `onTypeChange`-style handler that runs when a rental-type pill is clicked and calls `updateCtaState()`. Locate the function that sets the selected type (it is the one that writes to `document.getElementById('orderType')`), and add as its final statement:

```js
  // Swap the queue strip and popout to the newly selected account type. Both
  // partial instances are updated because only one of them is ever on the page.
  if (typeof qlShow === 'function') { qlShow('', t); qlShow('All', t); }
```

where `t` is that function's existing account-type variable (`'nt'`, `'tr'` or `'ps4'`). If the variable has another name in that scope, use that name — do not introduce a new one.

- [ ] **Step 5: Verify the template compiles**

Run:
```bash
node -e "const ejs=require('ejs'),fs=require('fs');ejs.compile(fs.readFileSync('views/game-detail.ejs','utf8'),{filename:'views/game-detail.ejs'});console.log('compiles OK')"
```
Expected: prints `compiles OK`.

- [ ] **Step 6: Verify in the browser**

Start the dev server and open a game whose slots are all rented (Tekken 8 was fully rented as of this plan's writing; if it is not, pick any game whose type pills all read "Full slot").

Confirm:
1. The strip appears below the no-slot banner and above "Choose your option", reading `N in line for trophy` / `Join now and you'll be #N+1`.
2. Clicking a different type pill changes the count and the label.
3. Clicking the strip opens the popout with numbered rows, ⭐ on priority rows, and dates.
4. Escape, the ✕, and a backdrop click all close it.
5. A game with nobody waiting shows no strip at all.
6. The browser console is clean.

- [ ] **Step 7: Commit**

```bash
git add server.js views/game-detail.ejs
git commit -m "Show the queue count and list on the game page"
```

---

## Task 5: Wire the queue into the PS Plus page

**Files:**
- Modify: `server.js:1007-1021` (the `/ps-plus/rent` handler)
- Modify: `views/psplus-rent.ejs:116-117` (the no-slot include point) and its type-pill handler

**Interfaces:**
- Consumes: everything from Tasks 1–3. PS Plus orders carry the literal `game_id` `'psplus'` and only ever use types `nt` and `tr`.
- Produces: nothing later depends on this task.

- [ ] **Step 1: Make the route async and load the queue**

In `server.js`, change `app.get('/ps-plus/rent', (req, res) => {` to `app.get('/ps-plus/rent', async (req, res) => {`, and replace its final `res.render(...)` line with:

```js
  // PS Plus waitlist entries are created with the literal game_id 'psplus' by
  // POST /order/reserve, so the same queue rules apply with no special-casing.
  let queues = { nt: [], tr: [], ps4: [] };
  try {
    queues = queueRules.buildQueue(await orders.listQueueCandidates('psplus'), new Date());
  } catch (e) { console.error('[psplus queue]', e.message); }
  res.render('psplus-rent', { prices, slots, psplusCover, promo: settings.promo, announcement: getAnnouncement(), announcements: getAnnouncements(), settings, order_error: req.query.order_error || null, queues, selfSession: req.sessionId || null });
```

- [ ] **Step 2: Include the partial**

In `views/psplus-rent.ejs`, immediately before the line
`<div class="gd-section-label" style="margin-top:1.5rem;">CHOOSE YOUR OPTION</div>`
(the one at roughly line 116, above the `noslot-options` include with `suffix: ''`), insert:

```html
      <%- include('partials/queue-line', { queues: queues, activeType: 'tr', selfRef: null, selfSession: selfSession, suffix: '' }) %>
```

- [ ] **Step 3: Point the PS Plus type handler at the strip**

`views/psplus-rent.ejs` has its own type-selection function mirroring the game page's. Add as its final statement, using that function's existing type variable:

```js
  if (typeof qlShow === 'function') qlShow('', t);
```

- [ ] **Step 4: Verify the template compiles**

Run:
```bash
node -e "const ejs=require('ejs'),fs=require('fs');ejs.compile(fs.readFileSync('views/psplus-rent.ejs','utf8'),{filename:'views/psplus-rent.ejs'});console.log('compiles OK')"
```
Expected: prints `compiles OK`.

- [ ] **Step 5: Verify in the browser**

Open `/ps-plus/rent` with PS Plus slots full. Confirm the strip and popout behave exactly as on the game page, and that switching between Trophy and Non-trophy changes the count. Console clean.

- [ ] **Step 6: Commit**

```bash
git add server.js views/psplus-rent.ejs
git commit -m "Show the queue count and list on the PS Plus page"
```

---

## Task 6: Position and list on the customer's own order page

**Files:**
- Modify: `server.js` — the `/order/:ref` handler (the `res.render('order-status', {...})` call)
- Modify: `views/order-status.ejs:15` (the `waitlisted` entry in `STEP_COPY`) and `views/order-status.ejs:87-88` (after the `.ord-card` closing `</div>`)

**Interfaces:**
- Consumes: `orders.listQueueCandidates` (Task 2); `queue.buildQueue`, `queue.positionOf`, `queue.aheadOf`, `queue.isExpired` (Task 1); the `queue-line` partial (Task 3).
- Produces: `order-status.ejs` receives locals `queueRows` (`Row[]`), `queuePos` (`number | null`), `queueAhead` (`{ total, priority } | null`) and `queueExpired` (`boolean`). Task 7 renders the upgrade card inside the same block.

- [ ] **Step 1: Load the queue in the order route**

In `server.js`, inside the `/order/:ref` handler, after the `const s = getSiteSettings();` line and before `res.render('order-status', ...)`, insert:

```js
  // Where this customer sits in line, for a Fall in Line or Priority order.
  // Pre-orders and ordinary rentals get nulls and render nothing.
  let queueRows = [], queuePos = null, queueAhead = null, queueExpired = false;
  try {
    const built = queueRules.buildQueue(await orders.listQueueCandidates(order.game_id), new Date());
    queueRows = built[order.account_type] || [];
    queuePos = queueRules.positionOf(queueRows, order.ref);
    queueAhead = queueRules.aheadOf(queueRows, order.ref);
    queueExpired = queueRules.isExpired(order, new Date());
  } catch (e) { console.error('[order queue]', e.message); }
```

Then add the four locals to the `res.render('order-status', { ... })` object:

```js
    queueRows, queuePos, queueAhead, queueExpired,
```

- [ ] **Step 2: Make the headline show the position**

In `views/order-status.ejs`, replace the `waitlisted` line of `STEP_COPY` (currently line 15) with:

```js
    waitlisted:        { title: queueExpired ? 'Still want this? 👋' : (queuePos ? 'You\'re #' + queuePos + ' in line' : 'You\'re on the list! 👥'),
                          sub: queueExpired
                            ? 'Your entry has been waiting over 30 days. Message us to confirm you still want it and we\'ll put you back in line.'
                            : 'We\'ll message you the moment a slot opens up.' },
```

- [ ] **Step 3: Render the strip and list**

In `views/order-status.ejs`, immediately after the `</div>` that closes `.ord-card` (line 87) and before the `<% if (order.state === 'awaiting_payment' || order.state === 'payment_rejected') { %>` line, insert:

```html
  <% if (queueRows && queueRows.length && queuePos && !queueExpired) { %>
  <%- include('partials/queue-line', { queues: { nt: order.account_type === 'nt' ? queueRows : [], tr: order.account_type === 'tr' ? queueRows : [], ps4: order.account_type === 'ps4' ? queueRows : [] }, activeType: order.account_type, selfRef: order.ref, selfSession: null, suffix: '' }) %>
  <% } %>
```

The partial is keyed by account type, so the single relevant queue is placed in its own slot and the other two are empty — the order page never switches types.

- [ ] **Step 4: Verify the template compiles**

Run:
```bash
node -e "const ejs=require('ejs'),fs=require('fs');ejs.compile(fs.readFileSync('views/order-status.ejs','utf8'),{filename:'views/order-status.ejs'});console.log('compiles OK')"
```
Expected: prints `compiles OK`.

- [ ] **Step 5: Verify in the browser**

Join the Fall in Line queue on a full game, follow the redirect to `/order/PH-xxxx?k=...`, and confirm:
1. The headline reads `You're #N in line`.
2. The strip below the order card reads the count and `You're #N`.
3. The popout highlights your own row in green with your **full** name and `(you)`.
4. An ordinary paid rental's order page shows no strip at all.
5. Console clean.

- [ ] **Step 6: Commit**

```bash
git add server.js views/order-status.ejs
git commit -m "Show queue position on the customer's order page"
```

---

## Task 7: Upgrade from Fall in Line to Priority

**Files:**
- Modify: `server.js` — new route, placed directly after the `POST /order/:ref/payment-proof` handler
- Modify: `views/order-status.ejs` — the upgrade card, inserted after the queue strip block from Task 6
- Modify: `public/css/style.css` — append the upgrade-card styles

**Interfaces:**
- Consumes: `queueRows`, `queuePos`, `queueExpired` locals (Task 6); `orders.transition` and the `waitlisted` → `awaiting_payment` transition (Task 2); `queue.upgradedPosition` and `queue.isExpired` (Task 1).
- Produces: `POST /order/:ref/upgrade-priority`. Nothing later depends on this task.

- [ ] **Step 1: Add the upgrade route**

In `server.js`, directly after the `app.post('/order/:ref/payment-proof', ...)` handler ends, insert:

```js
// Fall in Line -> Priority. Upgrades the customer's EXISTING order in place
// rather than cancelling it and creating a new one, which is what lets them
// keep their ref, their order link and — because created_at is never touched —
// their place in line. Everything after this hop is existing machinery: the
// order page renders the payment step because the state is awaiting_payment,
// and the admin approve route already sends any is_reservation order from
// verifying_payment into 'reserved'.
app.post('/order/:ref/upgrade-priority', async (req, res) => {
  if (rateLimited('order_create', clientIp(req), 10, 10 * 60 * 1000)) {
    return res.redirect('/browse?order_error=rate');
  }
  const order = await orders.getByRef(req.params.ref);
  if (!order || !order.url_key || req.body.k !== order.url_key) return res.redirect('/browse');
  const back = '/order/' + order.ref + '?k=' + order.url_key;
  // Only a live free entry can be upgraded. An expired one is asked to message
  // us instead, and anything already paid for has nothing to upgrade.
  if (order.state !== 'waitlisted') return res.redirect(back + '&msg=stale');
  if (queueRules.isExpired(order, new Date())) return res.redirect(back + '&msg=stale');

  // Recompute from CURRENT prices and promo rather than trusting the
  // remaining_due stored when they joined — a promo may have started or ended
  // in the meantime, and the paid paths all quote today's price.
  const s = getSiteSettings();
  const promo = s.promo || {};
  const isPsplus = order.game_id === 'psplus';
  const game = isPsplus ? null : getGame(order.game_id);
  if (!isPsplus && !game) return res.redirect(back + '&msg=stale');
  const priceType = order.account_type === 'ps4' ? 'nt' : order.account_type;
  const base = isPsplus
    ? (getPsplusPrices()[priceType + '_price_' + order.days + 'd'] || 0)
    : (resolveGamePrices(game)[priceType + '_price_' + order.days + 'd'] || 0);
  if (!base) return res.redirect(back + '&msg=stale');
  const pct = getPromoDiscountPct(promo, order.days);
  const rentAfterPromo = pct > 0 ? base - Math.round(base * pct / 100) : base;
  const deposit = (order.account_type === 'tr' || order.account_type === 'ps4') ? (promo.deposit || 0) : 0;

  const updated = await orders.transition(order.ref, 'awaiting_payment', {
    amount_due: 100,
    deposit_due: 0,
    is_reservation: true,
    is_waitlist: false,
    // Keeps this order in the queue at its original free position while the
    // ₱100 is in flight, so an upgrading customer never disappears from the
    // line. lib/queue.js reads this flag.
    upgraded_from_waitlist: true,
    remaining_due: Math.max(0, rentAfterPromo - 100) + deposit
  });
  if (!updated) return res.redirect(back + '&msg=stale');
  res.redirect(back + '&msg=upgrade_started');
});
```

- [ ] **Step 2: Add the upgrade card to the order page**

In `views/order-status.ejs`, immediately after the queue-strip block added in Task 6, insert:

```html
  <% if (order.state === 'waitlisted' && !queueExpired && queuePos) { %>
  <%
    const upTarget = queueRules.upgradedPosition(queueRows, order.ref);
  %>
  <div class="ord-upgrade">
    <form method="POST" action="/order/<%= order.ref %>/upgrade-priority">
      <input type="hidden" name="k" value="<%= order.url_key %>">
      <button type="submit" class="ord-upgrade-btn">Upgrade to priority — ₱100</button>
    </form>
    <div class="ord-upgrade-sub">
      <% if (upTarget < queuePos) { %>
        Moves you to #<%= upTarget %>. Deducted from your total rent.
      <% } else { %>
        Priority holders are served first. Deducted from your total rent.
      <% } %>
    </div>
  </div>
  <% } %>
```

`queueRules` must be available to this template. In `server.js`, add it to the `res.render('order-status', { ... })` locals alongside the queue values:

```js
    queueRules,
```

- [ ] **Step 3: Add the confirmation flash**

In `views/order-status.ejs`, beside the other `msg` flash lines (around line 60), add:

```html
  <% if (msg === 'upgrade_started') { %><div class="ord-flash">Upgraded to priority — send the ₱100 below and we'll move you up.</div><% } %>
```

- [ ] **Step 4: Add the styles**

Append to `public/css/style.css`:

```css
/* Fall in Line -> Priority upgrade card on the customer's own order page. */
.ord-upgrade { background: #1a0d2e; border: 1px solid #4c2a7a; border-radius: 12px; padding: 0.8rem 0.85rem; margin-bottom: 1.5rem; }
.ord-upgrade-btn { display: block; width: 100%; background: #6d28d9; color: #fff; font-weight: 800; font-size: 0.9rem; padding: 0.75rem; border: none; border-radius: 50px; cursor: pointer; font-family: inherit; }
.ord-upgrade-btn:hover { background: #7c3aed; }
.ord-upgrade-sub { font-size: 0.75rem; color: #c4b5fd; text-align: center; margin-top: 0.5rem; line-height: 1.55; }
```

- [ ] **Step 5: Verify the template compiles**

Run:
```bash
node -e "const ejs=require('ejs'),fs=require('fs');ejs.compile(fs.readFileSync('views/order-status.ejs','utf8'),{filename:'views/order-status.ejs'});console.log('compiles OK')"
```
Expected: prints `compiles OK`.

- [ ] **Step 6: Verify the whole upgrade round trip in the browser**

1. Join Fall in Line on a full game. Note your position, say #5.
2. On your order page, click **Upgrade to priority — ₱100**.
3. Confirm the page reloads showing the flash, the ₱100 payment step, and the GCash/Maya panel — the same UI a normal priority reservation shows.
4. Reload the game page and confirm the count has **not** dropped: you are still counted, still at #5, because the ₱100 has not been confirmed.
5. In admin, mark that order paid.
6. Reload your order page: the state is now `reserved`, and your position has moved up into the priority tier at the number the button promised.
7. Confirm the upgrade button no longer appears.
8. Confirm re-posting the upgrade to an already-upgraded ref redirects with `msg=stale` and changes nothing.

- [ ] **Step 7: Run the full test suite**

Run: `node scripts/test-queue.js && node scripts/test-orders.js && node scripts/test-payments.js && node scripts/test-templates.js`
Expected: all four green.

- [ ] **Step 8: Commit**

```bash
git add server.js views/order-status.ejs public/css/style.css
git commit -m "Let a Fall in Line customer upgrade to priority in place"
```

---

## Task 8: Admin waitlist card in queue order

**Files:**
- Modify: `views/partials/order-queue.ejs:322-356` (the waitlist card)

**Interfaces:**
- Consumes: `queue.buildQueue` is *not* used here — the admin card lists entries across many games at once, so it sorts with the same rule applied inline. It consumes nothing from other tasks.
- Produces: nothing.

- [ ] **Step 1: Flip the sort and add position numbers**

In `views/partials/order-queue.ejs`, replace the sort line (currently `const sortedWaitlist = [...waitlistOrders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));`) with:

```js
    // Queue order, not recency: oldest first, matching what the customer is
    // told on the game page. Sorting newest-first (as this did) meant serving
    // from the top of this list served the most recently joined person while
    // the site told them they were last. Positions are per game + account type,
    // because that is the scope a slot actually opens in.
    const sortedWaitlist = [...waitlistOrders].sort((a, b) => {
      const da = Date.parse(a.created_at || '') || 0;
      const db = Date.parse(b.created_at || '') || 0;
      if (da !== db) return da - db;
      return String(a.ref).localeCompare(String(b.ref));
    });
    const wlSeen = {};
```

- [ ] **Step 2: Compute and render each row's position**

Inside the `sortedWaitlist.forEach(o => { ... })` block, after the existing `const wlDurLabel = ...` line, add:

```js
    const wlKey = String(o.game_id) + '|' + o.account_type;
    wlSeen[wlKey] = (wlSeen[wlKey] || 0) + 1;
    const wlPos = wlSeen[wlKey];
```

Then in the row markup, change the reference line so the position leads:

```html
      <span class="oq-wl-pos">#<%= wlPos %></span>
      <span class="oq-ref"><%= o.ref %></span>
```

- [ ] **Step 3: Add the position style**

Append to `public/css/style.css`:

```css
/* Queue position on the admin waiting-for-a-slot card. Numbers are per game
   and account type, matching what the customer is shown. */
.oq-wl-pos { display: inline-block; min-width: 1.6rem; font-weight: 800; font-size: 0.78rem; color: #f0a500; margin-right: 0.3rem; }
```

- [ ] **Step 4: Verify the template compiles**

Run:
```bash
node -e "const ejs=require('ejs'),fs=require('fs');ejs.compile(fs.readFileSync('views/partials/order-queue.ejs','utf8'),{filename:'views/partials/order-queue.ejs'});console.log('compiles OK')"
```
Expected: prints `compiles OK`.

- [ ] **Step 5: Verify in admin**

Open `/admin` and check the "Waiting for a slot" card. Confirm the longest-waiting entry is at the top with `#1`, that two people waiting on different games each start at `#1`, and that two people on the same game and type read `#1` and `#2` in join order matching what those customers see on their own order pages.

- [ ] **Step 6: Commit**

```bash
git add views/partials/order-queue.ejs public/css/style.css
git commit -m "Sort the admin waitlist in queue order with positions"
```

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: queue rules and masking → Task 1; membership query and the transition → Task 2; count strip, popout, expiry copy → Tasks 3, 4, 6; PS Plus → Task 5; upgrade flow → Task 7; admin ordering → Task 8; failure modes → the `try`/`catch` in Tasks 4, 5, 6 plus the `listQueueCandidates` no-database guard in Task 2; testing → Task 1's `scripts/test-queue.js` and the `test-orders.js` fix.

**Deliberately not built** (spec "Out of scope"): no automatic notification when a slot opens, no auto-promotion of whoever is #1, no queue for Coming Soon pre-orders, and expired entries are never deleted — expiry is presentation only.

**Known risk.** Task 4 Step 4 and Task 5 Step 3 patch an existing type-selection function whose variable name must be read from the file rather than assumed. If that variable is not obvious, find the function by searching for `orderType` in `views/game-detail.ejs` and use whatever local it assigns.
