# Unpaid Quick Add Customers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Handle an unpaid Quick Add properly:
- list it under Customers → Needs attention → 💸 Not paid yet;
- keep it out of sales until its payment is confirmed;
- settle it the same way however the money arrives: the owner's Confirm paid, the customer's QR Ph checkout, an approved proof, or the old Mark paid.

**Architecture:**
- **A new pure module, `lib/quick-add-settle.js`**, decides whether an order is an unpaid Quick Add, where it goes once paid, and what payment line to record.
- **`lib/orders.js` gains one pinned update**, `settleOwnerRecorded`. It settles only while the order is still unpaid, so the money can never be counted twice.
- **`server.js`** routes all four payment paths through one helper, and builds the panel's data.
- **A new partial** draws the panel.
- **The two places that still counted `price` as earned money** (the Games tab Money column and `/admin/app`) now add up recorded payments.

**Tech Stack:** Node/Express 4, EJS, lowdb (customers), MongoDB (orders). Tests are plain `node scripts/test-*.js` with `assert`.

**Spec:** `docs/superpowers/specs/2026-09-26-quick-add-unpaid-design.md`

## Global Constraints

- **Pre-payment states:** `awaiting_payment`, `verifying_payment`, `payment_rejected`.
- **Allowed settle targets:** `active`, `awaiting_qr`, `closed`, `reserved`.
- **Owner-recorded unpaid** = a pre-payment state **and** (`settle_state` or `customer_id`).
- **`settle_state` at Quick Add:**
  - `reserved` for a Coming Soon game;
  - `closed` for Finished;
  - `awaiting_qr` when `signed_in === 'no'`;
  - otherwise `active`.
- **Fallback when an order has no `settle_state`,** taken from the customer row's status:
  - `renting` → `active`
  - `bought` → `active`
  - `done` → `closed`
  - `reservation` → `reserved`
  - anything else → `active`
- **Released before it was paid:**
  - A target of `reserved` on an order with no `upcoming_game_id` becomes `awaiting_qr`. `lib/release.js` clears `upcoming_game_id` when its game is released.
  - When the customer row is still `status: 'reservation'`, the settle also sets `released_at`. That lists the order with the other released reservations, and lets sign-in turn the reservation row into the rental.
- **The settlement payment:**
  - Amount = customer `price` − sum of its existing `payments`, floored at 0. With no customer row, `order.amount_due`.
  - Date = `orders.manilaDate()` (the day it is confirmed).
  - Kind = `reservation` when `upcoming_game_id` is set, `purchase` when `is_buy`, else `rent`.
  - `null` when the amount is 0.
- **Order of operations:** settle the order first, then record the payment only when the settle returned `true`.
- **Toasts, exact text:**
  - `payment_confirmed` → `✅ Payment confirmed — counted in sales from today.`
  - `payment_confirm_stale` → `❌ That order is no longer waiting for payment — reload and try again.`
  - Both open the `customers` tab.
- **Reminder text, exact:**
  - With a link: `👋 Hi ‹first name›! Friendly reminder — ₱‹owed› for ‹game› (‹ref›) is still unpaid.\n\nYou can pay here: ‹link›\nor just reply here once you've sent it. Thank you!`
  - With no link, the last part becomes `Just reply here once you've sent it. Thank you!`
  - The link base is `message_templates.website_link`, falling back to `SITE_URL`.
- **Panel title:** `💸 Not paid yet (N)`.
- **Panel note:** `Added with Quick Add as not paid. None of this counts in sales until the payment is confirmed — then it counts from that day.`
- **Line endings:**
  - `server.js` is CRLF with a UTF-8 BOM, and `views/partials/admin/customers.ejs` is CRLF. Edit both with the **Edit tool only**, and check with `file` afterwards.
  - Every other file touched is LF.
- **Do not change** the substrings `templateTokens: templates.TOKENS, gamesView, orderQueue,` and `refundsOwed, releasedOrders, upcomingReservedCount, abandonedOrders` in `server.js`. Existing tests check both.
- **Never log into the real admin and never touch production data.** Tests never write the local `games.json`, so route behaviour is covered by pure-function and source-level tests.
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Work directly on `main`. Do not push.
- A full regression run is expected to show only the pre-existing `scripts/test-requests-page.js` failure.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/quick-add-settle.js` | Create | Unpaid Quick Add rules: which orders, where they settle, what payment to record, the reminder |
| `scripts/test-quick-add-settle.js` | Create | Those rules |
| `lib/orders.js` | Modify | `settleOwnerRecorded(ref, toState, patch)`, a pinned update |
| `scripts/test-orders-settle.js` | Create | The pin, against a fake database |
| `server.js` | Modify | Quick Add `settle_state`; `settleQuickAddPayment`; Confirm paid route; advance / mark-paid / webhook hooks; Follow-ups filter; panel data; `/admin/app` revenue |
| `views/admin.ejs` | Modify | Two toasts and their tab mapping |
| `scripts/test-quick-add-unpaid-wiring.js` | Create | Source checks on the settle wiring |
| `views/partials/admin/customers/unpaid.ejs` | Create | The Not paid yet panel |
| `views/partials/admin/customers.ejs` | Modify | Includes the panel; card condition; unpaid tag on the price cell |
| `scripts/test-unpaid-panel.js` | Create | Renders the panel; source checks on its data and include |
| `lib/games-view.js` | Modify | Earnings from payments, not price |
| `scripts/test-games-view.js`, `scripts/test-games-template.js` | Modify | Money fixtures move to `payments` |
| `scripts/test-admin-app-revenue.js` | Create | `/admin/app` revenue reads payments |

---

### Task 1: The rules — `lib/quick-add-settle.js`

**Files:**
- Create: `lib/quick-add-settle.js`
- Test: `scripts/test-quick-add-settle.js`

**Interfaces:**
- Consumes: nothing.
- Produces, exported from `lib/quick-add-settle.js`:
  - `PRE_PAYMENT_STATES`: `['awaiting_payment', 'verifying_payment', 'payment_rejected']`
  - `SETTLE_TARGETS`: `['active', 'awaiting_qr', 'closed', 'reserved']`
  - `isOwnerRecordedUnpaid(order) → boolean`
  - `settleTarget(order, customer) → string`, always one of `SETTLE_TARGETS`
  - `settlementPayment(order, customer, today) → { amount, date, kind } | null`
  - `reminderMessage({ fbName, owed, gameTitle, ref, link }) → string`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-quick-add-settle.js`:

```js
// Run: node scripts/test-quick-add-settle.js
//
// Unpaid Quick Adds: which orders they are, where each settles once paid, the
// payment line to record, and the reminder the owner copies. Pure rules —
// server.js applies them to every payment path.
const assert = require('assert');
const qs = require('../lib/quick-add-settle');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

console.log('\nisOwnerRecordedUnpaid()');

ok('an unpaid Quick Add with a saved target is listed, in every pre-payment state', () => {
  ['awaiting_payment', 'verifying_payment', 'payment_rejected'].forEach(state => {
    assert.strictEqual(qs.isOwnerRecordedUnpaid({ state, settle_state: 'active' }), true, state);
  });
});

ok('an older unpaid Quick Add is caught through its customer record', () => {
  assert.strictEqual(qs.isOwnerRecordedUnpaid({ state: 'awaiting_payment', customer_id: 12 }), true);
});

ok('a website checkout that has not paid yet is not', () => {
  assert.strictEqual(qs.isOwnerRecordedUnpaid({ state: 'awaiting_payment' }), false);
  assert.strictEqual(qs.isOwnerRecordedUnpaid({ state: 'awaiting_payment', upgraded_from_waitlist: true }), false);
});

ok('paid or finished orders never are', () => {
  assert.strictEqual(qs.isOwnerRecordedUnpaid({ state: 'active', customer_id: 12, settle_state: 'active' }), false);
  assert.strictEqual(qs.isOwnerRecordedUnpaid({ state: 'cancelled', customer_id: 12 }), false);
  assert.strictEqual(qs.isOwnerRecordedUnpaid(null), false);
});

console.log('\nsettleTarget()');

ok('the target saved at Quick Add wins', () => {
  assert.strictEqual(qs.settleTarget({ settle_state: 'awaiting_qr' }, { status: 'renting' }), 'awaiting_qr');
  assert.strictEqual(qs.settleTarget({ settle_state: 'closed' }, null), 'closed');
});

ok('an older order falls back to the customer row', () => {
  assert.strictEqual(qs.settleTarget({}, { status: 'renting' }), 'active');
  assert.strictEqual(qs.settleTarget({}, { status: 'bought' }), 'active');
  assert.strictEqual(qs.settleTarget({}, { status: 'done' }), 'closed');
  assert.strictEqual(qs.settleTarget({ upcoming_game_id: 15 }, { status: 'reservation' }), 'reserved');
  assert.strictEqual(qs.settleTarget({}, { status: 'something else' }), 'active');
  assert.strictEqual(qs.settleTarget({}, null), 'active');
});

ok('a saved target outside the allowed list is ignored', () => {
  assert.strictEqual(qs.settleTarget({ settle_state: 'cancelled' }, { status: 'done' }), 'closed');
});

ok('a reservation whose game was released before it was paid waits for its sign-in code instead', () => {
  assert.strictEqual(qs.settleTarget({ settle_state: 'reserved', upcoming_game_id: 15 }, { status: 'reservation' }), 'reserved');
  assert.strictEqual(qs.settleTarget({ settle_state: 'reserved', upcoming_game_id: null }, { status: 'reservation' }), 'awaiting_qr');
  assert.strictEqual(qs.settleTarget({}, { status: 'reservation' }), 'awaiting_qr');
});

console.log('\nsettlementPayment()');

ok('records what the customer row still owes, dated the day it is confirmed', () => {
  assert.deepStrictEqual(
    qs.settlementPayment({ amount_due: 349 }, { price: 349, payments: [] }, '2026-09-26'),
    { amount: 349, date: '2026-09-26', kind: 'rent' }
  );
});

ok('takes off anything already recorded on the row', () => {
  assert.strictEqual(qs.settlementPayment({}, { price: 500, payments: [{ amount: 200 }] }, '2026-09-26').amount, 300);
});

ok('a reservation and a purchase are recorded as such', () => {
  assert.strictEqual(qs.settlementPayment({ upcoming_game_id: 15 }, { price: 449, payments: [] }, '2026-09-26').kind, 'reservation');
  assert.strictEqual(qs.settlementPayment({ is_buy: true }, { price: 1299, payments: [] }, '2026-09-26').kind, 'purchase');
});

ok('nothing owed records nothing', () => {
  assert.strictEqual(qs.settlementPayment({}, { price: 349, payments: [{ amount: 349 }] }, '2026-09-26'), null);
  assert.strictEqual(qs.settlementPayment({}, { price: 0, payments: [] }, '2026-09-26'), null);
});

ok('with no customer row it falls back to the order amount', () => {
  assert.strictEqual(qs.settlementPayment({ amount_due: 249 }, null, '2026-09-26').amount, 249);
});

console.log('\nreminderMessage()');

ok('the reminder, with a link to pay', () => {
  assert.strictEqual(
    qs.reminderMessage({ fbName: 'Ana Cruz', owed: 1500, gameTitle: 'Ghost of Yotei', ref: 'PH-0301', link: 'https://playstation-hub.com/order/PH-0301?k=abc' }),
    '👋 Hi Ana! Friendly reminder — ₱1,500 for Ghost of Yotei (PH-0301) is still unpaid.\n\n'
      + 'You can pay here: https://playstation-hub.com/order/PH-0301?k=abc\n'
      + 'or just reply here once you\'ve sent it. Thank you!'
  );
});

ok('without a link it just asks them to reply', () => {
  assert.strictEqual(
    qs.reminderMessage({ fbName: '', owed: 349, gameTitle: 'Tekken 8', ref: 'PH-0302', link: '' }),
    '👋 Hi there! Friendly reminder — ₱349 for Tekken 8 (PH-0302) is still unpaid.\n\n'
      + 'Just reply here once you\'ve sent it. Thank you!'
  );
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-quick-add-settle.js`
Expected: FAIL — `Cannot find module '../lib/quick-add-settle'`

- [ ] **Step 3: Write the module**

Create `lib/quick-add-settle.js`:

```js
// Unpaid Quick Adds: the owner recorded a rental, purchase or reservation that
// has not been paid yet. Nothing about it counts as sales until the money
// arrives. However it arrives — the owner's Confirm paid, the customer's QR Ph
// checkout, an uploaded proof the owner approves, or the old Mark paid — it is
// settled the same way: the order moves to the state it would have had if it
// had been paid at Quick Add, and the payment is recorded on the customer row,
// dated the day it was confirmed.
//
// Pure functions only; server.js applies them.

const PRE_PAYMENT_STATES = Object.freeze(['awaiting_payment', 'verifying_payment', 'payment_rejected']);
const SETTLE_TARGETS = Object.freeze(['active', 'awaiting_qr', 'closed', 'reserved']);

// A website checkout never has a customer record before it is paid — the
// record is created when the owner signs them in or confirms a reservation —
// so a customer_id on an unpaid order means the owner created it by hand.
// settle_state marks every unpaid Quick Add made since that field existed.
function isOwnerRecordedUnpaid(order) {
  if (!order || !PRE_PAYMENT_STATES.includes(order.state)) return false;
  return !!(order.settle_state || order.customer_id);
}

// For unpaid Quick Adds created before settle_state existed.
const STATUS_TARGET = Object.freeze({ renting: 'active', bought: 'active', done: 'closed', reservation: 'reserved' });

function settleTarget(order, customer) {
  const saved = order && order.settle_state;
  const target = SETTLE_TARGETS.includes(saved) ? saved
    : (STATUS_TARGET[customer && customer.status] || 'active');
  // A Coming Soon reservation whose game was released before it was paid is
  // an ordinary order for the released game now (lib/release.js clears its
  // upcoming_game_id): paid, it waits for its sign-in code like every other
  // released reservation, not in 'reserved' for a game that is already out.
  if (target === 'reserved' && !(order && order.upcoming_game_id)) return 'awaiting_qr';
  return target;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// What is still owed on the customer row, so the row's payments add up to its
// price again once settled. The deposit is not sales — a paid Quick Add
// records the rent alone too.
function settlementPayment(order, customer, today) {
  const o = order || {};
  let owed;
  if (customer) {
    const already = (Array.isArray(customer.payments) ? customer.payments : [])
      .reduce((s, p) => s + num(p && p.amount), 0);
    owed = num(customer.price) - already;
  } else {
    owed = num(o.amount_due);
  }
  const amount = Math.max(0, owed);
  if (!amount) return null;
  const kind = o.upcoming_game_id ? 'reservation' : (o.is_buy ? 'purchase' : 'rent');
  return { amount, date: today, kind };
}

function reminderMessage({ fbName, owed, gameTitle, ref, link }) {
  const first = String(fbName || '').trim().split(/\s+/)[0] || 'there';
  return '👋 Hi ' + first + '! Friendly reminder — ₱' + num(owed).toLocaleString('en-US')
    + ' for ' + gameTitle + ' (' + ref + ') is still unpaid.\n\n'
    + (link
      ? 'You can pay here: ' + link + '\nor just reply here once you\'ve sent it. Thank you!'
      : 'Just reply here once you\'ve sent it. Thank you!');
}

module.exports = {
  PRE_PAYMENT_STATES, SETTLE_TARGETS,
  isOwnerRecordedUnpaid, settleTarget, settlementPayment, reminderMessage
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-quick-add-settle.js`
Expected: every line `ok - …`, ending `15 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/quick-add-settle.js scripts/test-quick-add-settle.js
git commit -m "$(cat <<'EOF'
Add lib/quick-add-settle: rules for settling an unpaid Quick Add

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The pinned update — `orders.settleOwnerRecorded`

**Files:**
- Modify: `lib/orders.js` (LF)
- Test: `scripts/test-orders-settle.js`

**Interfaces:**
- Consumes: Task 1's `PRE_PAYMENT_STATES` and `SETTLE_TARGETS` (required from `./quick-add-settle`).
- Produces: `orders.settleOwnerRecorded(ref: string, toState: string, patch: object) → Promise<boolean>`.
  - It returns `true` only when the order was still in a pre-payment state and got updated.
  - It `$set`s `patch` plus `state` and `$push`es `{ state, at }` onto `state_history`.
  - It refuses (returns `false`) a `toState` outside `SETTLE_TARGETS`, a malformed ref, or no database.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-orders-settle.js`:

```js
// Run: node scripts/test-orders-settle.js
//
// orders.settleOwnerRecorded against a fake Mongo collection that honours the
// ref + state filter the way MongoDB does — so the "only while still unpaid"
// pin, which is what stops a payment being counted twice, is proven in the
// shipped function rather than assumed.
const assert = require('assert');
const orders = require('../lib/orders');

function fakeDb(doc) {
  const store = { doc };
  return {
    collection() {
      return {
        async updateOne(filter, update) {
          const d = store.doc;
          if (filter.ref !== d.ref) return { matchedCount: 0 };
          if (filter.state && filter.state.$in && !filter.state.$in.includes(d.state)) return { matchedCount: 0 };
          Object.assign(d, update.$set || {});
          if (update.$push) Object.keys(update.$push).forEach(k => { d[k] = (d[k] || []).concat([update.$push[k]]); });
          return { matchedCount: 1 };
        }
      };
    },
    _store: store
  };
}

(async () => {
  let passed = 0;
  function ok(desc) { passed++; console.log('  ok - ' + desc); }
  const PATCH = { paid_at: '2026-09-26T04:00:00.000Z', payment_channel: 'manual', payment_method: 'gcash' };

  for (const state of ['awaiting_payment', 'verifying_payment', 'payment_rejected']) {
    const db = fakeDb({ ref: 'PH-0301', state, state_history: [{ state: 'awaiting_payment', at: 'x' }] });
    orders.init(() => db);
    assert.strictEqual(await orders.settleOwnerRecorded('PH-0301', 'active', PATCH), true, state);
    const d = db._store.doc;
    assert.strictEqual(d.state, 'active');
    assert.strictEqual(d.payment_method, 'gcash');
    assert.strictEqual(d.state_history.length, 2);
    assert.strictEqual(d.state_history[1].state, 'active');
    ok('an unpaid order in ' + state + ' settles, with its state history kept');
  }

  {
    const db = fakeDb({ ref: 'PH-0302', state: 'active' });
    orders.init(() => db);
    assert.strictEqual(await orders.settleOwnerRecorded('PH-0302', 'closed', PATCH), false);
    assert.strictEqual(db._store.doc.state, 'active');
    ok('an order already paid is left alone — a second settle does nothing');
  }

  {
    const db = fakeDb({ ref: 'PH-0303', state: 'awaiting_payment' });
    orders.init(() => db);
    assert.strictEqual(await orders.settleOwnerRecorded('PH-0303', 'cancelled', PATCH), false);
    assert.strictEqual(db._store.doc.state, 'awaiting_payment');
    ok('a target outside the allowed list is refused');
  }

  {
    const db = fakeDb({ ref: 'PH-0304', state: 'awaiting_payment' });
    orders.init(() => db);
    assert.strictEqual(await orders.settleOwnerRecorded('not a ref', 'active', PATCH), false);
    ok('a malformed ref is refused');
  }

  {
    orders.init(() => null);
    assert.strictEqual(await orders.settleOwnerRecorded('PH-0301', 'active', PATCH), false);
    ok('no database means no settle, reported as false');
  }

  console.log('\n' + passed + ' assertions passed');
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-orders-settle.js`
Expected: FAIL — `orders.settleOwnerRecorded is not a function`.

- [ ] **Step 3: Add the function**

3a. In `lib/orders.js`, after the line:

```js
const queueRules = require('./queue');
```

add:

```js
const quickAddSettle = require('./quick-add-settle');
```

3b. Directly above `module.exports = {`, add:

```js
// Settles an unpaid order the owner recorded by hand with Quick Add — see
// lib/quick-add-settle.js. A pinned direct update rather than transition(): a
// paid Quick Add is born at its true state (active, closed, ...), and an
// unpaid one settles into that same state, which the lifecycle has no edge to
// from 'awaiting_payment'. Pinned to the pre-payment states, so a double-click
// or a payment racing the owner's Confirm paid settles it exactly once — the
// caller records the money only when this returns true.
async function settleOwnerRecorded(ref, toState, patch) {
  if (!quickAddSettle.SETTLE_TARGETS.includes(toState)) return false;
  const col = await _col('orders');
  if (!col) return false;
  const clean = parseOrderRef(ref);
  if (!clean) return false;
  const at = new Date().toISOString();
  const r = await col.updateOne(
    { ref: clean, state: { $in: quickAddSettle.PRE_PAYMENT_STATES.slice() } },
    {
      $set: Object.assign({}, patch || {}, { state: toState }),
      $push: { state_history: { state: toState, at } }
    }
  );
  return r.matchedCount > 0;
}

```

3c. In `module.exports`, replace:

```js
  repairPurchase, setRentalWindow, syncFromCustomer, releaseUnpaidReservation
```

with:

```js
  repairPurchase, setRentalWindow, syncFromCustomer, releaseUnpaidReservation,
  settleOwnerRecorded
```

- [ ] **Step 4: Run the tests**

```bash
node scripts/test-orders-settle.js
node scripts/test-orders.js
node scripts/test-orders-release.js
```

Expected:
- `test-orders-settle.js` ends `7 assertions passed`.
- The other two pass as before (20 and 6).

- [ ] **Step 5: Commit**

```bash
git add lib/orders.js scripts/test-orders-settle.js
git commit -m "$(cat <<'EOF'
Add orders.settleOwnerRecorded: settle an unpaid Quick Add exactly once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Settle wiring in `server.js`

**Files:**
- Modify: `server.js` (CRLF + BOM — Edit tool only)
- Modify: `views/admin.ejs` (LF)
- Test: `scripts/test-quick-add-unpaid-wiring.js`

**Interfaces:**
- Consumes:
  - Task 1: `quickAddSettle.isOwnerRecordedUnpaid`, `settleTarget`, `settlementPayment`.
  - Task 2: `orders.settleOwnerRecorded`.
- Produces:
  - `settleQuickAddPayment(order, { method, channel, extraPatch }) → Promise<{ ok, target }>` in `server.js`.
  - The route `POST /admin/orders/:ref/confirm-paid` with body field `method`.
  - Unpaid Quick Add orders now carry `settle_state`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-quick-add-unpaid-wiring.js`:

```js
// Run: node scripts/test-quick-add-unpaid-wiring.js
//
// An unpaid Quick Add settles the same way whichever way its money arrives.
// The rules are tested in scripts/test-quick-add-settle.js and the pinned
// update in scripts/test-orders-settle.js; this checks server.js routes every
// payment path through the one helper, in the right order. Source-level, like
// scripts/test-release-wiring.js — these routes write customer rows to the
// local lowdb file, which a test must not touch.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function block(startMarker) {
  const i = SRC.indexOf(startMarker);
  assert.ok(i >= 0, 'server.js still has ' + startMarker);
  const next = SRC.indexOf('\napp.', i + startMarker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}
function fnBody(startMarker) {
  const i = SRC.indexOf(startMarker);
  assert.ok(i >= 0, 'server.js still has ' + startMarker);
  const rest = SRC.slice(i);
  const end = rest.search(/\r?\n\}\r?\n/);
  return rest.slice(0, end > 0 ? end : undefined);
}

console.log('\nunpaid Quick Add wiring');

ok('server.js loads lib/quick-add-settle', () => {
  assert.ok(SRC.includes("const quickAddSettle = require('./lib/quick-add-settle');"));
});

ok('Quick Add keeps where an unpaid order belongs, and a paid one is born there', () => {
  const qa = block("app.post('/admin/quick-add', requireAuth,");
  assert.ok(qa.includes("const initialState = paid ? settleState : 'awaiting_payment';"));
  assert.ok(qa.includes('} : { settle_state: settleState },'));
});

ok('the helper settles the order first and records the payment only if that happened', () => {
  const h = fnBody('async function settleQuickAddPayment(');
  const settle = h.indexOf('orders.settleOwnerRecorded(');
  const pay = h.indexOf('quickAddSettle.settlementPayment(');
  assert.ok(settle > 0 && pay > settle, 'settle before recording the payment');
  assert.ok(h.includes('if (!ok) return { ok: false, target };'));
  assert.ok(h.includes('orders.manilaDate()'));
});

ok('a reservation released before it was paid joins the released reservations when settled', () => {
  const h = fnBody('async function settleQuickAddPayment(');
  assert.ok(h.includes("const released = target === 'awaiting_qr' && customer && customer.status === 'reservation';"));
  assert.ok(h.includes('released ? { released_at: nowIso } : {}'));
});

ok('Confirm paid only takes an unpaid Quick Add, and only a known method', () => {
  const r = block("app.post('/admin/orders/:ref/confirm-paid', requireAuth,");
  assert.ok(r.includes('quickAddSettle.isOwnerRecordedUnpaid(order)'));
  assert.ok(r.includes("allowed.includes(req.body.method) ? req.body.method : 'manual'"));
  assert.ok(r.includes("msg=payment_confirm_stale"));
  assert.ok(r.includes("'payment_confirmed'"));
});

ok('an approved proof on an unpaid Quick Add settles before the normal advance', () => {
  const r = block("app.post('/admin/orders/:ref/advance', requireAuth,");
  const hook = r.indexOf("order.state === 'verifying_payment' && quickAddSettle.isOwnerRecordedUnpaid(order)");
  assert.ok(hook > 0 && hook < r.indexOf('let to = ORDER_ADVANCE[order.state];'));
  assert.ok(r.includes('settleQuickAddPayment(order,'));
});

ok('Mark paid settles an unpaid Quick Add before its reservation logic', () => {
  const r = block("app.post('/admin/orders/:ref/mark-paid', requireAuth,");
  const hook = r.indexOf('settleQuickAddPayment(order,');
  assert.ok(hook > 0 && hook < r.indexOf('if (order.is_reservation) {'));
});

ok('the PayMongo webhook settles an unpaid Quick Add before its reservation and sign-in branches', () => {
  const r = block("app.post('/webhooks/paymongo',");
  const hook = r.indexOf('quickAddSettle.isOwnerRecordedUnpaid(order)');
  assert.ok(hook > 0 && hook < r.indexOf('} else if (order.is_reservation) {'));
  assert.ok(r.includes("method: 'gateway', channel: 'paymongo',"));
});

ok('the two toasts exist and open the Customers tab', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'views', 'admin.ejs'), 'utf8');
  assert.ok(admin.includes("payment_confirmed:'customers', payment_confirm_stale:'customers',"));
  assert.ok(admin.includes("payment_confirmed:'✅ Payment confirmed — counted in sales from today.'"));
  assert.ok(admin.includes("payment_confirm_stale:'❌ That order is no longer waiting for payment — reload and try again.'"));
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-quick-add-unpaid-wiring.js`
Expected: FAIL on `server.js loads lib/quick-add-settle`.

- [ ] **Step 3: Require the module** (Edit tool)

After the line:

```js
const gamesViewLib = require('./lib/games-view');
```

add:

```js
const quickAddSettle = require('./lib/quick-add-settle');
```

- [ ] **Step 4: Quick Add stores `settle_state`** (Edit tool)

4a. Replace:

```js
  const initialState = !paid ? 'awaiting_payment'
    : upcomingGame ? 'reserved'
    : status === 'done' ? 'closed'
    : b.signed_in === 'no' ? 'awaiting_qr'
    : 'active';
```

with:

```js
  // Where the order belongs once paid. An unpaid one is born awaiting payment
  // and keeps this as settle_state, so whichever way the money arrives later
  // (lib/quick-add-settle.js) it lands exactly where a paid one would have.
  const settleState = upcomingGame ? 'reserved'
    : status === 'done' ? 'closed'
    : b.signed_in === 'no' ? 'awaiting_qr'
    : 'active';
  const initialState = paid ? settleState : 'awaiting_payment';
```

4b. Replace:

```js
    }, paid ? {
      payment_channel: 'manual', payment_method: method, paid_at: new Date().toISOString()
    } : {}, mode === 'buy' ? { is_buy: true } : {},
```

with:

```js
    }, paid ? {
      payment_channel: 'manual', payment_method: method, paid_at: new Date().toISOString()
    } : { settle_state: settleState }, mode === 'buy' ? { is_buy: true } : {},
```

- [ ] **Step 5: The helper and the Confirm paid route** (Edit tool)

Directly above the line below, which starts the comment block over the Quick Add route (insert above the whole block, not inside it):

```js
// Admin "Create order" for a customer who never touches the site — the owner
```

insert:

```js
// Settles an unpaid Quick Add however its money arrived — the owner's Confirm
// paid, the customer's QR Ph checkout, an uploaded proof the owner approved,
// or the old Mark paid. The order moves to where it would have been had it
// been paid at Quick Add, and ONLY if that move happened is the payment
// recorded on the customer row, dated today — so a double-click or a payment
// racing the owner's click can never count the money twice.
async function settleQuickAddPayment(order, { method, channel, extraPatch }) {
  const customer = order.customer_id ? getCustomer(order.customer_id) : null;
  const target = quickAddSettle.settleTarget(order, customer);
  const nowIso = new Date().toISOString();
  // A reservation whose game was released before it was paid: released_at
  // lists it with the other released reservations waiting for a sign-in code,
  // and lets sign-in turn its reservation row into the live rental.
  const released = target === 'awaiting_qr' && customer && customer.status === 'reservation';
  const ok = await orders.settleOwnerRecorded(order.ref, target, Object.assign({
    paid_at: nowIso,
    payment_channel: channel,
    payment_method: method
  }, released ? { released_at: nowIso } : {}, extraPatch || {}));
  if (!ok) return { ok: false, target };
  if (!customer) {
    console.error('[quick-add settle]', order.ref, 'settled, but customer', order.customer_id, 'is gone — payment not recorded');
    return { ok: true, target };
  }
  const line = quickAddSettle.settlementPayment(order, customer, orders.manilaDate());
  if (line) {
    db.get('customers').find({ id: customer.id })
      .assign({ payments: (customer.payments || []).concat([line]) }).write();
  }
  return { ok: true, target };
}

// "Confirm paid" on a row of Customers → Needs attention → Not paid yet.
app.post('/admin/orders/:ref/confirm-paid', requireAuth, asyncRoute(async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order || !quickAddSettle.isOwnerRecordedUnpaid(order)) {
    return res.redirect('/admin?tab=customers&msg=payment_confirm_stale');
  }
  const allowed = (getSiteSettings().payment_methods || [])
    .filter(m => m && m.enabled).map(m => m.key).concat(['manual']);
  const method = allowed.includes(req.body.method) ? req.body.method : 'manual';
  const r = await settleQuickAddPayment(order, { method, channel: 'manual' });
  res.redirect('/admin?tab=customers&msg=' + (r.ok ? 'payment_confirmed' : 'payment_confirm_stale'));
}));

```

- [ ] **Step 6: The three other payment paths** (Edit tool)

6a. Advance (an approved proof). Replace:

```js
  let to = ORDER_ADVANCE[order.state];
  if (order.is_reservation && order.state === 'verifying_payment') to = 'reserved';
```

with:

```js
  // An approved proof on an unpaid Quick Add: settle it where a paid one would
  // have been, and record the money — see settleQuickAddPayment.
  if (order.state === 'verifying_payment' && quickAddSettle.isOwnerRecordedUnpaid(order)) {
    const r = await settleQuickAddPayment(order, {
      method: order.payment_method || 'manual',
      channel: order.payment_channel || 'proof'
    });
    return res.redirect('/admin?tab=orders&msg=' + (r.ok ? 'order_advanced' : 'order_stale'));
  }
  let to = ORDER_ADVANCE[order.state];
  if (order.is_reservation && order.state === 'verifying_payment') to = 'reserved';
```

6b. Mark paid. Replace:

```js
  if (!['awaiting_payment', 'payment_rejected'].includes(order.state)) {
    return res.redirect('/admin?tab=orders&msg=order_bad_state');
  }
  // Reservation orders (Coming Soon downpayments) have no console to sign
```

with:

```js
  if (!['awaiting_payment', 'payment_rejected'].includes(order.state)) {
    return res.redirect('/admin?tab=orders&msg=order_bad_state');
  }
  if (quickAddSettle.isOwnerRecordedUnpaid(order)) {
    const r = await settleQuickAddPayment(order, { method: order.payment_method || 'manual', channel: 'manual' });
    return res.redirect('/admin?tab=orders&msg=' + (r.ok ? 'order_marked_paid' : 'order_stale'));
  }
  // Reservation orders (Coming Soon downpayments) have no console to sign
```

6c. The PayMongo webhook. Replace:

```js
    if (order.is_reservation) {
      await orders.transition(order.ref, 'verifying_payment', {});
      await orders.transition(order.ref, 'reserved', settlePatch);
    } else {
      await orders.transition(order.ref, 'awaiting_qr', settlePatch);
    }
```

with:

```js
    if (quickAddSettle.isOwnerRecordedUnpaid(order)) {
      // An unpaid Quick Add the customer paid from their own link: settle it
      // where a paid one would have been and record the money.
      await settleQuickAddPayment(order, {
        method: 'gateway', channel: 'paymongo',
        extraPatch: { paid_amount_centavos: decision.paid, overpaid_by_centavos: decision.overBy || 0 }
      });
    } else if (order.is_reservation) {
      await orders.transition(order.ref, 'verifying_payment', {});
      await orders.transition(order.ref, 'reserved', settlePatch);
    } else {
      await orders.transition(order.ref, 'awaiting_qr', settlePatch);
    }
```

- [ ] **Step 7: Toasts — `views/admin.ejs`**

7a. In `msgTabMap`, replace:

```js
    customer_added:'customers', customer_updated:'customers',
```

with:

```js
    payment_confirmed:'customers', payment_confirm_stale:'customers',
    customer_added:'customers', customer_updated:'customers',
```

7b. In `messages`, replace:

```js
customer_added:'👤 Customer added!',
```

with:

```js
payment_confirmed:'✅ Payment confirmed — counted in sales from today.', payment_confirm_stale:'❌ That order is no longer waiting for payment — reload and try again.', customer_added:'👤 Customer added!',
```

- [ ] **Step 8: Verify**

```bash
node --check server.js
node scripts/test-quick-add-unpaid-wiring.js
node scripts/test-paymongo-webhook-reservation.js
node scripts/test-order-routes-error-handling.js
node scripts/test-order-routes-wrapped.js
file server.js
git diff --stat server.js
```

Expected:
- `node --check` prints nothing.
- `test-quick-add-unpaid-wiring.js` ends `9 assertions passed`.
- `test-paymongo-webhook-reservation.js` ends `4 assertions passed`. Its orders have no customer record, so they still take the reservation and sign-in paths.
- `test-order-routes-error-handling.js` ends `1 assertion passed`.
- `test-order-routes-wrapped.js` ends with a pass count and no failure. The new route is `asyncRoute`-wrapped.
- `server.js` is still `UTF-8 (with BOM)` with CRLF, and the diff is about 60 insertions, not hundreds.

- [ ] **Step 9: Commit**

```bash
git add server.js views/admin.ejs scripts/test-quick-add-unpaid-wiring.js
git commit -m "$(cat <<'EOF'
Settle unpaid Quick Adds the same way, however the money arrives

Quick Add stores where an unpaid order belongs (settle_state). Confirm paid,
an approved proof, the old Mark paid and the PayMongo webhook all settle it
through one helper: the order moves to its real state and only then is the
payment recorded on the customer row, dated the day it was confirmed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The Not paid yet panel

**Files:**
- Create: `views/partials/admin/customers/unpaid.ejs` (LF)
- Modify: `views/partials/admin/customers.ejs` (CRLF — Edit tool only)
- Modify: `server.js` (CRLF + BOM — Edit tool only). This covers the Follow-ups filter, the panel data and the render locals.
- Test: `scripts/test-unpaid-panel.js`

**Interfaces:**
- Consumes:
  - Task 1: `quickAddSettle.isOwnerRecordedUnpaid`, `reminderMessage`.
  - Task 3: `POST /admin/orders/:ref/confirm-paid` (body `method`).
- Produces two render locals:
  - `unpaidQuickAdds`: order objects, oldest first, each with `reminder_msg`.
  - `unpaidCustomerIds`: an array of customer ids.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-unpaid-panel.js`:

```js
// Run: node scripts/test-unpaid-panel.js
//
// Customers → Needs attention → 💸 Not paid yet: renders the panel partial
// with fixtures, then checks at source level that the Customers tab includes
// it, tags unpaid rows, and that server.js feeds it and keeps these orders
// out of Orders → Follow-ups.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'views', 'partials', 'admin', 'customers', 'unpaid.ejs');
const SETTINGS = { payment_methods: [
  { key: 'gcash', label: 'GCash', enabled: true },
  { key: 'maya', label: 'Maya', enabled: true },
  { key: 'paypal', label: 'PayPal', enabled: false }
] };
const ROWS = [
  { ref: 'PH-0301', state: 'awaiting_payment', fb_name: 'Ana Cruz', game_title: 'Ghost of Yotei', account_type: 'nt', days: 30,
    amount_due: 349, created_at: '2026-09-20T12:00:00Z', customer_id: 11, settle_state: 'active',
    reminder_msg: '👋 Hi Ana! Friendly reminder — ₱349 for Ghost of Yotei (PH-0301) is still unpaid.' },
  { ref: 'PH-0302', state: 'verifying_payment', fb_name: 'Ben Reyes', game_title: 'Tekken 8', account_type: 'tr', days: null, is_buy: true,
    amount_due: 1299, created_at: '2026-09-22T12:00:00Z', customer_id: 12, payment_proof: '/uploads/proof.png', reminder_msg: 'b' },
  { ref: 'PH-0303', state: 'payment_rejected', fb_name: 'Cai Lim', game_title: 'Phantom Blade Zero', account_type: 'ps4', days: 30,
    upcoming_game_id: 15, amount_due: 449, created_at: '2026-09-24T12:00:00Z', customer_id: 13, reminder_msg: 'c' }
];

function render(rows) {
  return ejs.render(fs.readFileSync(FILE, 'utf8'), { unpaidQuickAdds: rows, settings: SETTINGS }, { filename: FILE });
}
// One row's markup: from the row holding this ref to the next row.
function row(html, ref) {
  const at = html.indexOf('>' + ref + '<');
  assert.ok(at >= 0, 'row ' + ref);
  const start = html.lastIndexOf('class="rem-row"', at);
  const next = html.indexOf('class="rem-row"', at);
  return html.slice(start, next > 0 ? next : undefined);
}

const html = render(ROWS);

console.log('\nthe panel');

ok('nothing unpaid renders nothing', () => {
  assert.ok(!render([]).includes('unpaidPanel'));
});

ok('the title counts the unpaid orders', () => {
  assert.ok(html.includes('💸 Not paid yet (3)'));
  assert.ok(html.includes('None of this counts in sales until the payment is confirmed — then it counts from that day.'));
});

ok('a rental row shows who, which order, what, how much and since when', () => {
  const r = row(html, 'PH-0301');
  assert.ok(r.includes('Ana Cruz'));
  assert.ok(r.includes('Ghost of Yotei · Non-Trophy · 30 days'));
  assert.ok(r.includes('₱349 owed · since Sep 20'));
});

ok('purchases and reservations say so', () => {
  assert.ok(row(html, 'PH-0302').includes('Tekken 8 · Trophy · Purchase'));
  assert.ok(row(html, 'PH-0302').includes('₱1,299 owed'));
  assert.ok(row(html, 'PH-0303').includes('Phantom Blade Zero · PS4 Primary · Reservation'));
});

ok('a sent proof links to its receipt; a rejected payment is tagged', () => {
  assert.ok(row(html, 'PH-0302').includes('📎 Proof sent — <a href="/uploads/proof.png"'));
  assert.ok(row(html, 'PH-0303').includes('payment rejected'));
  assert.ok(!row(html, 'PH-0301').includes('Proof sent'));
  assert.ok(!row(html, 'PH-0301').includes('payment rejected'));
});

ok('Confirm paid posts to the order, offering each enabled method plus Other / cash', () => {
  const r = row(html, 'PH-0301');
  assert.ok(r.includes('action="/admin/orders/PH-0301/confirm-paid"'));
  assert.ok(r.includes('<option value="gcash">GCash</option>'));
  assert.ok(r.includes('<option value="maya">Maya</option>'));
  assert.ok(r.includes('<option value="manual">Other / cash</option>'));
  assert.ok(!r.includes('PayPal'));
  assert.ok(r.includes('>Confirm paid</button>'));
});

ok('Copy reminder carries the reminder text', () => {
  assert.ok(row(html, 'PH-0301').includes('class="rem-copy" data-msg="👋 Hi Ana! Friendly reminder — ₱349 for Ghost of Yotei (PH-0301) is still unpaid."'));
});

console.log('\nwiring');

ok('the Customers tab shows the panel inside Needs attention and tags unpaid rows', () => {
  const src = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'admin', 'customers.ejs'), 'utf8');
  assert.ok(src.includes("<%- include('customers/unpaid') %>"));
  assert.ok(src.includes("(typeof unpaidQuickAdds !== 'undefined' && unpaidQuickAdds.length)"));
  assert.ok(src.includes('unpaidCustomerIds.includes(c.id)'));
});

ok('server.js feeds the panel and keeps these orders out of Follow-ups', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(SRC.includes('.filter(o => !quickAddSettle.isOwnerRecordedUnpaid(o));'));
  assert.ok(SRC.includes('const unpaidQuickAdds = allOrders'));
  assert.ok(SRC.includes('quickAddSettle.reminderMessage({'));
  assert.ok(SRC.includes('rentIgnored, unpaidQuickAdds, unpaidCustomerIds, notifs,'));
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-unpaid-panel.js`
Expected: FAIL — `ENOENT` for `views/partials/admin/customers/unpaid.ejs`.

- [ ] **Step 3: Create the panel**

Create `views/partials/admin/customers/unpaid.ejs`:

```ejs
<%#
  Customers → Needs attention → Not paid yet: orders the owner added with
  Quick Add as not paid. None of it counts in sales until the payment is
  confirmed — by Confirm paid here, or by the customer paying from their own
  order link — and then it counts from that day (lib/quick-add-settle.js).
%>
<%
  const upRows = (typeof unpaidQuickAdds !== 'undefined' && unpaidQuickAdds) ? unpaidQuickAdds : [];
  const upType = t => t === 'tr' ? 'Trophy' : t === 'ps4' ? 'PS4 Primary' : 'Non-Trophy';
  const upWhat = o => o.upcoming_game_id ? 'Reservation' : o.is_buy ? 'Purchase' : (o.days ? o.days + ' days' : 'Rental');
  const upSince = iso => {
    const d = new Date(iso || '');
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  };
  const upMethods = ((typeof settings !== 'undefined' && settings && settings.payment_methods) || []).filter(m => m && m.enabled);
%>
<% if (upRows.length) { %>
<div class="rem-panel unlinked-panel" id="unpaidPanel">
  <div class="rem-title">💸 Not paid yet (<%= upRows.length %>)</div>
  <div class="unlinked-note">
    Added with Quick Add as not paid. None of this counts in sales until the payment is confirmed — then it counts from that day.
  </div>
  <% upRows.forEach(o => { %>
  <%# Wraps on a phone: the details keep a readable width and the actions
      drop underneath instead of squeezing them into a sliver. %>
  <div class="rem-row" style="flex-wrap:wrap;">
    <div class="rem-info" style="flex:1 1 12rem;">
      <span class="rem-name"><%= o.fb_name || 'Unnamed customer' %></span>
      <span class="rem-badge rem-overdue"><%= o.ref %></span>
      <% if (o.state === 'payment_rejected') { %><span class="rem-badge rem-today">payment rejected</span><% } %>
      <div class="rem-meta"><%= o.game_title || '' %> · <%= upType(o.account_type) %> · <%= upWhat(o) %></div>
      <div class="rem-meta">₱<%= (Number(o.amount_due) || 0).toLocaleString('en-US') %> owed<%= upSince(o.created_at) ? ' · since ' + upSince(o.created_at) : '' %></div>
      <% if (o.state === 'verifying_payment') { %>
      <div class="rem-meta">📎 Proof sent<% if (o.payment_proof) { %> — <a href="<%= o.payment_proof %>" target="_blank" rel="noopener" style="color:var(--ps-blue);">view receipt</a><% } %></div>
      <% } %>
    </div>
    <div style="display:flex;gap:0.35rem;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-left:auto;">
      <form method="POST" action="/admin/orders/<%= o.ref %>/confirm-paid" style="display:inline-flex;gap:0.35rem;align-items:center;margin:0;">
        <select name="method" aria-label="How they paid" style="background:#141414;border:1px solid #2a2a2a;color:#ccc;border-radius:6px;padding:0.3rem 0.4rem;font-size:0.75rem;">
          <% upMethods.forEach(m => { %>
          <option value="<%= m.key %>"><%= m.label %></option>
          <% }) %>
          <option value="manual">Other / cash</option>
        </select>
        <button type="submit" style="background:#16a34a;color:#fff;border:0;border-radius:8px;padding:0.45rem 0.75rem;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">Confirm paid</button>
      </form>
      <button type="button" class="rem-copy" data-msg="<%= o.reminder_msg || '' %>">📋 Copy reminder</button>
    </div>
  </div>
  <% }) %>
</div>
<% } %>
```

- [ ] **Step 4: Put it in the Customers tab — `views/partials/admin/customers.ejs`** (Edit tool)

4a. The card's show condition. Replace:

```ejs
    <% if ((typeof unlinkedRentals !== 'undefined' && unlinkedRentals.length) || needsReminder.length || qaBought.length || qaStaleEnd.length || qaShort.length) { %>
```

with:

```ejs
    <% if ((typeof unpaidQuickAdds !== 'undefined' && unpaidQuickAdds.length) || (typeof unlinkedRentals !== 'undefined' && unlinkedRentals.length) || needsReminder.length || qaBought.length || qaStaleEnd.length || qaShort.length) { %>
```

4b. Its description. Replace:

```ejs
<div class="sa-desc">Rentals due back, and rentals holding a slot the site still shows as free</div>
```

with:

```ejs
<div class="sa-desc">Unpaid Quick Adds, rentals due back, and rentals holding a slot the site still shows as free</div>
```

4c. Include the panel first in the card body. Replace:

```ejs
      <div class="adm-card-body" style="padding:1rem 1.15rem;">
        <%# Rentals occupying no account slot on a game whose availability is
```

with:

```ejs
      <div class="adm-card-body" style="padding:1rem 1.15rem;">
        <%# Money owed first: it is the one thing here that is also missing
            from sales until it is dealt with. %>
        <%- include('customers/unpaid') %>
        <%# Rentals occupying no account slot on a game whose availability is
```

4d. The unpaid tag on the price cell. Replace:

```ejs
              <td style="font-weight:700;color:var(--ps-blue);">₱<%= c.price || 0 %></td>
```

with:

```ejs
              <td style="font-weight:700;color:var(--ps-blue);">₱<%= c.price || 0 %><% if (typeof unpaidCustomerIds !== 'undefined' && unpaidCustomerIds.includes(c.id)) { %> <span class="rem-badge rem-overdue">unpaid</span><% } %></td>
```

- [ ] **Step 5: Feed it from the admin route — `server.js`** (Edit tool)

5a. The Follow-ups filter. Replace:

```js
  const abandonedOrders = await orders.listByStates(['awaiting_payment', 'payment_rejected']);
```

with:

```js
  // Unpaid Quick Adds are listed under Customers → Needs attention → Not paid
  // yet instead; Follow-ups is for website visitors who never finished.
  const abandonedOrders = (await orders.listByStates(['awaiting_payment', 'payment_rejected']))
    .filter(o => !quickAddSettle.isOwnerRecordedUnpaid(o));
```

5b. The panel data. After the line:

```js
  const waitlistOrders = queueRules.forAdminPanel(allOrders, new Date());
```

add:

```js
  // Customers → Needs attention → Not paid yet: unpaid Quick Adds, oldest
  // first, each with a copy-ready reminder linking to their own order page
  // (where they can also pay). The link base matches the review asks.
  const unpaidQuickAdds = allOrders
    .filter(o => quickAddSettle.isOwnerRecordedUnpaid(o))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  {
    const tpls = getSiteSettings().message_templates || {};
    const base = String(tpls.website_link || SITE_URL).replace(/\/+$/, '');
    unpaidQuickAdds.forEach(o => {
      o.reminder_msg = quickAddSettle.reminderMessage({
        fbName: o.fb_name, owed: o.amount_due, gameTitle: o.game_title, ref: o.ref,
        link: o.url_key ? base + '/order/' + o.ref + '?k=' + o.url_key : ''
      });
    });
  }
  const unpaidCustomerIds = unpaidQuickAdds.map(o => o.customer_id).filter(id => id != null);
```

5c. In the `res.render('admin', { … })` line, replace:

```
rentIgnored, notifs,
```

with:

```
rentIgnored, unpaidQuickAdds, unpaidCustomerIds, notifs,
```

- [ ] **Step 6: Verify**

```bash
node scripts/test-unpaid-panel.js
node scripts/test-orders-template.js
node scripts/test-games-template.js
node scripts/test-release-wiring.js
node --check server.js
file server.js views/partials/admin/customers.ejs
```

Expected:
- `test-unpaid-panel.js` ends `9 assertions passed`.
- The others pass as before (33, 22, 8).
- `node --check` prints nothing.
- Both files keep their line endings (`server.js` BOM + CRLF, `customers.ejs` CRLF).

- [ ] **Step 7: Commit**

```bash
git add views/partials/admin/customers/unpaid.ejs views/partials/admin/customers.ejs server.js scripts/test-unpaid-panel.js
git commit -m "$(cat <<'EOF'
List unpaid Quick Adds under Customers → Needs attention

A "Not paid yet" panel with Confirm paid (method picked) and a copy-ready
reminder per order, an "unpaid" tag in the customers table, and these
orders no longer mixed into Orders → Follow-ups.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Sales count money received — Games tab and `/admin/app`

**Files:**
- Modify: `lib/games-view.js` (LF)
- Modify: `server.js` (CRLF + BOM, Edit tool only): the `/admin/app` revenue
- Modify: `scripts/test-games-view.js`, `scripts/test-games-template.js` (the money fixtures)
- Create: `scripts/test-admin-app-revenue.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `gameRows(...).money.earned`, which is now the sum of the customer rows' `payments[].amount`. `txns` counts the rows whose payments add up to more than 0.

- [ ] **Step 1: Write the failing tests**

1a. In `scripts/test-games-view.js`, replace the three money tests:

```js
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
```

with:

```js
ok('earnings add up the payments on every customer record for the game, string or numeric id', () => {
  const r = one(GAME({ id: 5, cost: 1000 }), [
    { game_id: 5, payments: [{ amount: 349 }] }, { game_id: '5', payments: [{ amount: 199 }] }, { game_id: 6, payments: [{ amount: 999 }] }
  ]);
  assert.deepStrictEqual(r.money, { earned: 548, txns: 2, cost: 1000, profit: -452 });
});

ok('Coming Soon and PS Plus records never count toward a game', () => {
  const r = one(GAME({ id: 5 }), [
    { game_id: 'upcoming_5', payments: [{ amount: 449 }] }, { game_id: 'psplus', payments: [{ amount: 299 }] }, { game_id: null, payments: [{ amount: 50 }] }
  ]);
  assert.deepStrictEqual([r.money.earned, r.money.txns], [0, 0]);
});

ok('no cost counts as 0', () => {
  assert.strictEqual(one(GAME({ id: 5 }), [{ game_id: 5, payments: [{ amount: 349 }] }]).money.profit, 349);
});

ok('an unpaid row — a price but no payment yet — earns nothing', () => {
  const r = one(GAME({ id: 5 }), [
    { game_id: 5, price: 349, payments: [] },
    { game_id: 5, price: 199, payments: [{ amount: 199 }] }
  ]);
  assert.deepStrictEqual([r.money.earned, r.money.txns], [199, 1]);
});
```

1b. In `scripts/test-games-template.js`, replace:

```js
const CUSTOMERS = [
  { game_id: 2, price: 349 }, { game_id: '2', price: 349 }, { game_id: 1, price: 249 }, { game_id: 'upcoming_15', price: 449 }
];
```

with:

```js
// Money is what was received — each row's payments — not its price.
const CUSTOMERS = [
  { game_id: 2, payments: [{ amount: 349 }] }, { game_id: '2', payments: [{ amount: 349 }] },
  { game_id: 1, payments: [{ amount: 249 }] }, { game_id: 'upcoming_15', payments: [{ amount: 449 }] }
];
```

1c. Create `scripts/test-admin-app-revenue.js`:

```js
// Run: node scripts/test-admin-app-revenue.js
//
// The phone admin page (/admin/app) counts money actually received — the
// recorded payments — not customer prices, so an unpaid Quick Add is not
// revenue until its payment is confirmed. Source-level: the route renders a
// whole page from the local data file.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = SRC.indexOf("app.get('/admin/app', requireAuth,");
assert.ok(start >= 0, 'server.js still has the /admin/app route');
const ROUTE = SRC.slice(start, SRC.indexOf('\napp.', start + 10));

console.log('\n/admin/app revenue');

ok('revenue is added up from recorded payments, not prices', () => {
  assert.ok(ROUTE.includes('(c.payments || []).forEach(p => {'));
  assert.ok(!ROUTE.includes('reduce((s, c) => s + (c.price || 0), 0)'));
});

ok("this month means the payment's own date, in Manila", () => {
  assert.ok(ROUTE.includes('const monthKey = orders.manilaDate().slice(0, 7);'));
  assert.ok(ROUTE.includes("String((p && p.date) || '').slice(0, 7) === monthKey"));
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node scripts/test-games-view.js
node scripts/test-games-template.js
node scripts/test-admin-app-revenue.js
```

Expected:
- `test-games-view.js` fails on the first money test (earned 0, because payments are not read yet).
- `test-games-template.js` fails on `money: earned with its transactions`.
- `test-admin-app-revenue.js` fails on its first check.

- [ ] **Step 3: Earnings from payments — `lib/games-view.js`**

Replace:

```js
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
```

with:

```js
// One pass over every customer record, instead of two filter() calls per game.
// Keyed by the string id, so a numeric 7 and a string '7' land together and a
// Coming Soon ('upcoming_5') or PS Plus ('psplus') record never matches a game.
//
// Money is what was actually received — the row's recorded payments — not its
// price: an unpaid Quick Add has a price but no payment yet, and earns
// nothing until that payment is confirmed. A paid row's payments add up to
// its price, so paid rows read exactly as before.
function earningsByGame(customers) {
  const map = new Map();
  (customers || []).forEach(c => {
    if (!c || c.game_id == null || c.game_id === '') return;
    const received = (Array.isArray(c.payments) ? c.payments : [])
      .reduce((s, p) => s + num(p && p.amount), 0);
    if (received <= 0) return;
    const key = String(c.game_id);
    const cur = map.get(key) || { earned: 0, txns: 0 };
    cur.earned += received;
    cur.txns += 1;
    map.set(key, cur);
  });
  return map;
}
```

- [ ] **Step 4: `/admin/app` revenue — `server.js`** (Edit tool)

Replace:

```js
  const totalRevenue = customers.reduce((s, c) => s + (c.price || 0), 0);
  const thisMonth = now.getMonth(), thisYear = now.getFullYear();
  const monthRevenue = customers.filter(c => {
    const ds = c.start_date || c.created_at;
    if (!ds) return false;
    const d = new Date(c.start_date ? c.start_date + 'T00:00:00' : c.created_at);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).reduce((s, c) => s + (c.price || 0), 0);
```

with:

```js
  // Money actually received: recorded payments, not prices — an unpaid Quick
  // Add has a price but no payment until it is confirmed. The month is the
  // payment's own date (Manila), the same attribution the main dashboard's
  // money charts use.
  const monthKey = orders.manilaDate().slice(0, 7);
  let totalRevenue = 0, monthRevenue = 0;
  customers.forEach(c => (c.payments || []).forEach(p => {
    const amt = Number(p && p.amount) || 0;
    totalRevenue += amt;
    if (String((p && p.date) || '').slice(0, 7) === monthKey) monthRevenue += amt;
  }));
```

- [ ] **Step 5: Run the tests**

```bash
node scripts/test-games-view.js
node scripts/test-games-template.js
node scripts/test-admin-app-revenue.js
node --check server.js
file server.js
```

Expected:
- `test-games-view.js` ends `19 assertions passed`.
- `test-games-template.js` ends `22 assertions passed`.
- `test-admin-app-revenue.js` ends `2 assertions passed`.
- `node --check` prints nothing.
- `server.js` is still BOM + CRLF.

- [ ] **Step 6: Commit**

```bash
git add lib/games-view.js server.js scripts/test-games-view.js scripts/test-games-template.js scripts/test-admin-app-revenue.js
git commit -m "$(cat <<'EOF'
Count only money received in the Games tab and /admin/app

Both added up customer prices, so an unpaid Quick Add counted as earned.
They now sum recorded payments; paid customers read exactly as before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Browser check with fixtures, and regression

No changes to the repo unless a defect is found. If one is, fix it, re-run the affected tests, and commit separately. **Nothing here touches the live admin or production data.**

**Files:**
- Scratch only (substitute the session scratchpad path for `$SCRATCH`):
  - `$SCRATCH/unpaid-check/build.js`
  - `$SCRATCH/unpaid-check/serve.js`
  - the generated `page.html`

- [ ] **Step 1: Build the fixture page**

Create `$SCRATCH/unpaid-check/build.js`:

```js
// Renders the real Not paid yet panel with fixture orders, inside the Needs
// attention card markup, plus the copy handler the Customers tab uses.
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/michael/Desktop/claude code/playstation-hub';
const ejs = require(REPO + '/node_modules/ejs');
const qs = require(REPO + '/lib/quick-add-settle');

const now = Date.now();
const iso = d => new Date(now - d * 86400000).toISOString();
const rows = [
  { ref: 'PH-0301', state: 'awaiting_payment', fb_name: 'Ana Cruz', game_title: 'Ghost of Yotei', account_type: 'nt', days: 30, amount_due: 349, created_at: iso(6), customer_id: 11, settle_state: 'active', url_key: 'abc' },
  { ref: 'PH-0302', state: 'verifying_payment', fb_name: 'Ben Reyes', game_title: 'Tekken 8', account_type: 'tr', days: null, is_buy: true, amount_due: 1299, created_at: iso(4), customer_id: 12, payment_proof: '/uploads/proof.png', url_key: 'def' },
  { ref: 'PH-0303', state: 'payment_rejected', fb_name: 'Cai Lim', game_title: 'Phantom Blade Zero', account_type: 'ps4', days: 30, upcoming_game_id: 15, amount_due: 449, created_at: iso(2), customer_id: 13 }
];
rows.forEach(o => {
  o.reminder_msg = qs.reminderMessage({ fbName: o.fb_name, owed: o.amount_due, gameTitle: o.game_title, ref: o.ref,
    link: o.url_key ? 'https://playstation-hub.com/order/' + o.ref + '?k=' + o.url_key : '' });
});
const file = path.join(REPO, 'views/partials/admin/customers/unpaid.ejs');
const panel = ejs.render(fs.readFileSync(file, 'utf8'), {
  unpaidQuickAdds: rows,
  settings: { payment_methods: [{ key: 'gcash', label: 'GCash', enabled: true }, { key: 'maya', label: 'Maya', enabled: true }] }
}, { filename: file });

fs.writeFileSync(path.join(__dirname, 'page.html'), '<!DOCTYPE html><html><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css">'
  + '<style>body{background:#0a0a0a;color:#fff;padding:16px;font-family:system-ui}'
  + '.adm-card{border:1px solid #1c1c1c;border-radius:14px;overflow:hidden;background:#0a0a0a}'
  + '.adm-card-head{padding:0.8rem 1.15rem;background:#111;border-left:3px solid #ef4444;font-weight:700}</style></head><body>'
  + '<div class="adm-card"><div class="adm-card-head">⚠️ Needs attention</div><div style="padding:1rem 1.15rem;">' + panel + '</div></div>'
  + '<script>document.addEventListener("click",function(e){var b=e.target.closest(".rem-copy");if(!b)return;window.__copied=b.dataset.msg;b.textContent="✅ Copied";});'
  + 'document.addEventListener("submit",function(e){e.preventDefault();window.__submitted=e.target.getAttribute("action")+" method="+e.target.method.value;});</script>'
  + '</body></html>');
console.log('wrote page.html');
```

Create `$SCRATCH/unpaid-check/serve.js`:

```js
const http = require('http');
const fs = require('fs');
const REPO = 'C:/Users/michael/Desktop/claude code/playstation-hub';
const routes = {
  '/': [__dirname + '/page.html', 'text/html'],
  '/css/style.css': [REPO + '/public/css/style.css', 'text/css']
};
http.createServer((req, res) => {
  const r = routes[req.url.split('?')[0]];
  if (!r) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': r[1] + '; charset=utf-8' });
  fs.createReadStream(r[0]).pipe(res);
}).listen(4594, () => console.log('fixture page on 4594'));
```

```bash
cd "$SCRATCH/unpaid-check" && node build.js && (node serve.js > serve.log 2>&1 &) ; sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4594/
```

Expected: `wrote page.html` then `200`.

- [ ] **Step 2: Check it (Browser pane, `http://localhost:4594/`)**

1. **The panel.**
   - The title reads `💸 Not paid yet (3)`.
   - Ana Cruz's row reads `Ghost of Yotei · Non-Trophy · 30 days` and `₱349 owed · since …`.
   - Ben Reyes shows `Purchase`, `₱1,299 owed` and `📎 Proof sent — view receipt`.
   - Cai Lim shows `Reservation` and a `payment rejected` tag.
2. **Confirm paid.** Pick `Maya` on Ana's row and click **Confirm paid**. The page's own submit handler blocks the real post. Then `javascript_tool`: `window.__submitted` is `/admin/orders/PH-0301/confirm-paid method=maya`.
3. **Copy reminder.** Click **📋 Copy reminder** on Ana's row. `window.__copied` starts `👋 Hi Ana! Friendly reminder — ₱349 for Ghost of Yotei (PH-0301) is still unpaid.` and contains `You can pay here: https://playstation-hub.com/order/PH-0301?k=abc`. Cai Lim's reminder (no link) ends `Just reply here once you've sent it. Thank you!`
4. **Console.** `read_console_messages` with `onlyErrors: true` shows none.
5. **Phone.** Use `resize_window` with width 375 and height 812, then reload.
   - `innerWidth === 375` and `document.documentElement.scrollWidth <= visualViewport.width`.
   - Each row's actions wrap under its text, with nothing off-screen.
   - Reset with preset `desktop`.

- [ ] **Step 3: Clean up**

```bash
for pid in $(netstat -ano | grep ':4594' | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //F //PID "$pid"; done
rm -rf "$SCRATCH/unpaid-check"
cd "C:/Users/michael/Desktop/claude code/playstation-hub" && git status --short
```

Expected: nothing from this task. Only the long-standing untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` shows.

- [ ] **Step 4: Full regression run**

```bash
cd "C:/Users/michael/Desktop/claude code/playstation-hub"
for f in scripts/test-*.js; do timeout 120 node "$f" > "$SCRATCH/out.txt" 2>&1 || { echo "FAILED: $f"; tail -20 "$SCRATCH/out.txt"; }; done
```

Expected: no `FAILED:` line except `scripts/test-requests-page.js`. That one already failed before this work and is out of scope, so report it rather than fixing it.
