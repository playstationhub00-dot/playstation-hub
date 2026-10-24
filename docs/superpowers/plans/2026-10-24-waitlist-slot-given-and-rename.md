# Waitlist "Slot given" and "Edit name" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner can mark a waiting customer's slot as given, which takes them off the public line. The owner can also correct the name on any waitlist entry.

**Architecture:**
- **New owner routes:** `POST /admin/orders/:ref/slot-given` and `POST /admin/orders/:ref/rename`. Both act only on a free (`waitlisted`) or priority (`reserved`) entry that is not a pre-order.
- **Slot given:** it moves the order to `cancelled` with `slot_given_at` set. The state machine gains a `reserved → cancelled` edge for this. The admin ledger and the customer's order page read `slot_given_at` and say "Slot given" instead of "Cancelled".
- **Edit name:** it saves only `fb_name`, through a new `orders.setName`. The typed name is cleaned by a new `cleanFbName` in `lib/names.js`.
- **Admin Waitlist rows:** each row gets a visible "✅ Slot given" button and an "✏️ Edit name" form in its ⋯ menu.

**Tech Stack:** Express + EJS templates, plain browser JS (no build step), plain CSS. Tests are `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-24-waitlist-slot-given-and-rename-design.md` (amended after this plan's dry run).

**How this plan was checked.** Every file in this plan was dry-run in a scratch copy of the current `main`:
- Each new or changed test fails first and then passes.
- The full suite stays green apart from `scripts/test-upcoming-psn-page-public.js`, which also fails before this work.

A browser check ran on a throwaway instance. It had one full game, a made-up Trophy line (priority "Marvin Reyes", then "Mark Lim", "Gemry Tan" and two "Adrian Bautista" entries) and an in-memory order store:
- **Admin at 1280px:** every Waitlist row shows 📋 Copy, ✅ Slot given and, on free rows, ⭐ Priority paid. ⋯ opens ✏️ Edit name, prefilled.
- **Edit name:** saving "Adrian Bernardo" renamed that row and kept its place.
- **Slot given:** on Marvin, the line moved up, the ledger read "✅ Slot given ₱100", the period's paid total went to ₱0 and the toast "✅ Slot given — off the waiting list." showed.
- **Phone, 375px:** the buttons wrap onto two lines, the menu fits the screen and nothing scrolls sideways.
- **Customer side:** Marvin's order page reads "✅ Slot given / You're all set — this waiting-list entry is closed." The public Trophy line lists 4 waiting, without him.
- **Errors:** none in the console or the server log.

Three changes came out of that check and are already in the files below:
- The order page no longer shows "To send now" or "₱799 remaining" for a slot given.
- The Edit name form is wider (`min-width: 230px`).
- It drops its divider when it is the only item in the menu.

## Global Constraints

- Work directly on `main` and do not switch branches. **Push only when the owner says "push".**
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Line endings:**
  - `server.js` is CRLF + UTF-8 BOM in the working tree.
  - These files are CRLF: `lib/orders.js`, `scripts/test-orders.js`, `views/admin.ejs`, `views/order-status.ejs`, `views/partials/admin/orders/needs-you.ejs`, `views/partials/admin/orders/ledger.ejs`, `public/css/style.css`.
  - These files are LF: `lib/names.js`, `scripts/test-orders-template.js` and the new test files.
  - The edit scripts (via `.superpowers/tmp-edits/rep.js`) keep each file's endings and BOM.
  - Git stores LF blobs (`core.autocrlf=true`), so a CRLF working copy is expected.
- **Which orders the two actions apply to:** state `waitlisted` or `reserved`, and not a pre-order (`queueRules.isPreorder(order)` is false — no `upcoming_game_id`, not `is_buy`). The server enforces this, not just the button. Anything else redirects with `msg=order_bad_state` and changes nothing.
- **Slot given:** transition to `cancelled` with `slot_given_at` (ISO timestamp). This drops a priority ₱100 from every paid readout, because Quick Add already holds the full rent. Redirects: `/admin?tab=orders&msg=order_slot_given`, or `msg=order_stale` if the transition fails.
- **Edit name:** the name is trimmed with inner whitespace collapsed and must be 1–80 characters, else `msg=order_name_bad`. Only `fb_name` changes; ref, state and `created_at` (the place in line) never do. Success redirects to `msg=order_renamed`.
- **Copy, verbatim:**
  - Button: `✅ Slot given`.
  - Confirm: `Mark the slot as given to <name> (<ref>)?\n\nThey leave the line and the record is kept. A ₱100 priority fee stops counting as money — it's already in the rent you recorded.`
  - Menu label: `✏️ Edit name`, with a `Save` button.
  - Ledger status: `✅ Slot given`.
  - Order page title and sub: `✅ Slot given` / `You're all set — this waiting-list entry is closed.`
  - Toasts: `✅ Slot given — off the waiting list.`, `✏️ Name updated.`, `❌ Enter a name (up to 80 characters).`
- **Unchanged:** Remove (still "Cancelled"), ⭐ Priority paid, Undo priority, Quick Add, Coming Soon reservations and buy pre-orders.
- **Test data:** tests use a temp `DATA_DIR`, a blank `MONGODB_URI`, the in-memory session store, a made-up admin password and an in-memory orders collection. Never touch the project's `games.json` or a database.
- **Known unrelated failure:** `scripts/test-upcoming-psn-page-public.js`. Report it; do not fix it.
- **Edit scripts:** they live in `.superpowers/tmp-edits/` (git-ignored). Never commit them. Task 3 removes the folder.
- **Committing:** always `git add` explicit paths. The untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.

## Files

| File | Task | Change |
|---|---|---|
| `lib/orders.js` | 1 | `reserved → cancelled` edge; `setName(ref, name)` |
| `lib/names.js` | 1 | `cleanFbName(raw)` |
| `scripts/test-orders.js` | 1 | The "ways out of reserved" check now includes Slot given |
| `scripts/test-waitlist-slot-given-rules.js` (new) | 1 | The edge, `cleanFbName`, `setName` |
| `server.js` | 2 | `isWaitlistEntry`; `POST /admin/orders/:ref/slot-given` and `/rename` |
| `views/admin.ejs` | 2 | Three toasts |
| `views/order-status.ejs` | 2 | "Slot given" title/sub; no money asked on a slot given |
| `scripts/test-waitlist-admin.js` (new) | 2 | The routes end to end |
| `views/partials/admin/orders/needs-you.ejs` | 3 | ✅ Slot given button; ✏️ Edit name in every row's ⋯ menu |
| `views/partials/admin/orders/ledger.ejs` | 3 | "✅ Slot given" status |
| `public/css/style.css` | 3 | `.oq-btn-given`, `.oq-rename*` |
| `scripts/test-orders-template.js` | 3 | Checks for the button, the form and the ledger label |

---

### Task 1: The rules — closing a priority entry, cleaning and saving a name

**Files:**
- Create: `scripts/test-waitlist-slot-given-rules.js`, `.superpowers/tmp-edits/rep.js`, `.superpowers/tmp-edits/edit-waitlist-rules.js`
- Modify (edit script): `lib/orders.js`, `lib/names.js`, `scripts/test-orders.js`

**Interfaces:**
- Consumes: `queueRules.QUEUE_STATES` (`['reserved', 'waitlisted']`, already required in `lib/orders.js` as `queueRules`).
- Produces:
  - `orders.canTransition('reserved', 'cancelled') === true`.
  - `orders.setName(ref, name)` → `Promise<boolean>`. It saves `fb_name` only when the order's state is `waitlisted` or `reserved`, and returns false for a bad ref, an unknown order, an order not in line or an empty name.
  - `require('./lib/names').cleanFbName(raw)` → the cleaned string, or `null`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-waitlist-slot-given-rules.js`:

````js
// Run: node scripts/test-waitlist-slot-given-rules.js
//
// The rules behind the owner's two new Waitlist actions: "Slot given" closes a
// priority entry, so 'reserved' may now move to 'cancelled'; "Edit name" cleans
// the typed name (lib/names.js cleanFbName) and saves only fb_name, only on an
// order that is still in line (lib/orders.js setName). Runs the real setName
// against a fake Mongo collection that honours the ref + state filter.
// See docs/superpowers/specs/2026-10-24-waitlist-slot-given-and-rename-design.md.
const assert = require('assert');
const orders = require('../lib/orders');
const { cleanFbName } = require('../lib/names');

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function fakeDb(docs) {
  return {
    collection() {
      return {
        async findOne(filter) { return docs.find(d => d.ref === filter.ref) || null; },
        async updateOne(filter, update) {
          const d = docs.find(x => x.ref === filter.ref);
          const stateOk = d && (!filter.state || (filter.state.$in ? filter.state.$in.includes(d.state) : filter.state === d.state));
          if (!d || !stateOk) return { matchedCount: 0, modifiedCount: 0 };
          Object.assign(d, update.$set || {});
          return { matchedCount: 1, modifiedCount: 1 };
        }
      };
    }
  };
}

(async () => {
  await ok('a priority entry can be closed (Slot given); a free one already could', async () => {
    assert.strictEqual(orders.canTransition('reserved', 'cancelled'), true);
    assert.strictEqual(orders.canTransition('waitlisted', 'cancelled'), true);
  });

  await ok('cleanFbName trims, collapses spaces and allows 1-80 characters', async () => {
    assert.strictEqual(cleanFbName('  Adrian   Bautista '), 'Adrian Bautista');
    assert.strictEqual(cleanFbName('x'.repeat(80)), 'x'.repeat(80));
    [undefined, null, '', '   ', 'x'.repeat(81)].forEach(v => assert.strictEqual(cleanFbName(v), null, String(v)));
  });

  await ok('setName saves only fb_name on an order still in line', async () => {
    const docs = [
      { ref: 'PH-0301', state: 'waitlisted', fb_name: 'Adrian B', created_at: '2026-10-20T00:00:00Z' },
      { ref: 'PH-0302', state: 'reserved', fb_name: 'Marvin', created_at: '2026-10-22T00:00:00Z' },
      { ref: 'PH-0303', state: 'active', fb_name: 'Ana' }
    ];
    orders.init(() => fakeDb(docs));
    assert.strictEqual(await orders.setName('PH-0301', 'Adrian Bautista'), true);
    assert.deepStrictEqual(docs[0], { ref: 'PH-0301', state: 'waitlisted', fb_name: 'Adrian Bautista', created_at: '2026-10-20T00:00:00Z' });
    assert.strictEqual(await orders.setName('PH-0302', 'Marvin Reyes'), true);
    assert.strictEqual(docs[1].fb_name, 'Marvin Reyes');
    assert.strictEqual(await orders.setName('PH-0303', 'Someone Else'), false, 'not in line');
    assert.strictEqual(docs[2].fb_name, 'Ana');
    assert.strictEqual(await orders.setName('PH-9999', 'Nobody'), false, 'no such order');
    assert.strictEqual(await orders.setName('nope', 'Nobody'), false, 'not a ref');
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-waitlist-slot-given-rules.js` → FAIL `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:` / `false !== true` (the `reserved → cancelled` edge does not exist yet).

- [ ] **Step 3: Add the edge, `cleanFbName` and `setName`**

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

Create `.superpowers/tmp-edits/edit-waitlist-rules.js`:

````js
// Task 1: a priority entry may be closed ('reserved' -> 'cancelled', used only by
// POST /admin/orders/:ref/slot-given), cleanFbName for the owner's Edit name,
// and orders.setName, which saves fb_name on an order still in line. Keeps each
// file's line endings.
const rep = require('./rep');
const O = 'lib/orders.js';

rep(O,
`  // The undo edge exits to undo a mis-click on the owner's "priority paid"
  // button, which promotes a free waitlist entry when the ₱100 arrived over
  // Messenger. Without it that button is a one-way door: 'cancelled' does not
  // accept 'reserved', so the only remedy would be deleting the order and
  // losing the customer's ref, position and history.
  //`,
`  // The undo edge exits to undo a mis-click on the owner's "priority paid"
  // button, which promotes a free waitlist entry when the ₱100 arrived over
  // Messenger. Without it that button is a one-way door: the only remedy would
  // be deleting the order and losing the customer's ref, position and history.
  //
  // The 'cancelled' edge is the owner's "Slot given": the priority customer got
  // their account (recorded separately with Quick Add, full rent included), so
  // the entry leaves the line and its ₱100 stops counting as paid. Like undo it
  // must never reach a Coming Soon reservation or a buy pre-order, so
  // POST /admin/orders/:ref/slot-given refuses pre-orders (queue.isPreorder)
  // and is the only caller.
  //`);

rep(O,
`  reserved:          ['waitlisted', 'awaiting_qr'],`,
`  reserved:          ['waitlisted', 'awaiting_qr', 'cancelled'],`);

rep(O,
`// Attaches a Messenger PSID to an order.`,
`// The owner's "Edit name" on a Waitlist row. Saves only fb_name, and only while
// the order still holds a place in line ('waitlisted' or 'reserved') — the
// filter pins that, so a stale form can never rename a rental. Not a lifecycle
// move, so no transition() and no state_history entry. The name arrives already
// cleaned (lib/names.js cleanFbName).
async function setName(ref, name) {
  const col = await _col('orders');
  if (!col) return false;
  const clean = parseOrderRef(ref);
  if (!clean || !name) return false;
  const r = await col.updateOne(
    { ref: clean, state: { $in: queueRules.QUEUE_STATES.slice() } },
    { $set: { fb_name: String(name) } }
  );
  return r.matchedCount > 0;
}

// Attaches a Messenger PSID to an order.`);

rep(O,
`  expireStaleQrs, advanceEndedRentals, markRefunded, setCustomerId, linkPsid, deleteOrder,`,
`  expireStaleQrs, advanceEndedRentals, markRefunded, setCustomerId, setName, linkPsid, deleteOrder,`);

rep('lib/names.js',
`module.exports = { maskName };`,
`// A name the owner types into "Edit name" on a Waitlist row: trimmed, inner
// whitespace collapsed, 1-80 characters. Returns null for anything else so the
// route can refuse it without saving.
function cleanFbName(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/\\s+/g, ' ');
  return s && s.length <= 80 ? s : null;
}

module.exports = { maskName, cleanFbName };`);

const T = 'scripts/test-orders.js';
rep(T,
`  // The one edge out of 'reserved', so POST /admin/orders/:ref/undo-priority
  // is not a one-way door. 'cancelled' does not accept 'reserved', so without
  // this the only remedy for a mis-click would be deleting the order.`,
`  // The edge back to the free list, so POST /admin/orders/:ref/undo-priority
  // is not a one-way door. Without it the only remedy for a mis-click would be
  // deleting the order.`);
rep(T,
`check('undo and release are the only ways out of reserved', () => {
  // 'reserved' is a resting state. Two edges leave it: undo-priority back to
  // 'waitlisted', and releasing a Coming Soon game, which moves its paid
  // reservations to 'awaiting_qr' (POST /admin/upcoming/release/:id, via
  // lib/release.js). Anything else still fails here so the next change is a
  // deliberate decision too.
  ['active', 'qr_pending', 'awaiting_payment', 'verifying_payment', 'closed', 'cancelled']`,
`check('undo, release and slot given are the only ways out of reserved', () => {
  // 'reserved' is a resting state. Three edges leave it: undo-priority back to
  // 'waitlisted', releasing a Coming Soon game, which moves its paid
  // reservations to 'awaiting_qr' (POST /admin/upcoming/release/:id, via
  // lib/release.js), and the owner's Slot given, which closes a priority entry
  // as 'cancelled' (POST /admin/orders/:ref/slot-given). Anything else still
  // fails here so the next change is a deliberate decision too.
  assert.strictEqual(orders.canTransition('reserved', 'cancelled'), true);
  ['active', 'qr_pending', 'awaiting_payment', 'verifying_payment', 'closed']`);

console.log('edited orders.js, names.js, test-orders.js');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-waitlist-rules.js` → `edited orders.js, names.js, test-orders.js`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-waitlist-slot-given-rules.js && node scripts/test-orders.js && node scripts/test-queue.js` → `3`, `20`, `33 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/orders.js lib/names.js scripts/test-orders.js scripts/test-waitlist-slot-given-rules.js
git commit -m "Waitlist: a priority entry can be closed as slot given; cleanFbName and orders.setName for Edit name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The two owner routes, their toasts and the customer's order page

**Files:**
- Create: `scripts/test-waitlist-admin.js`, `.superpowers/tmp-edits/edit-waitlist-server.js`
- Modify (edit script): `server.js`, `views/admin.ejs`, `views/order-status.ejs`

**Interfaces:**
- Consumes:
  - From Task 1: `orders.transition(ref, 'cancelled', patch)` (now legal from `reserved`), `orders.setName(ref, name)`, `cleanFbName(raw)`.
  - Already present: `queueRules.QUEUE_STATES`, `queueRules.isPreorder(order)`, `requireAuth` and `asyncRoute` in `server.js`.
  - `.superpowers/tmp-edits/rep.js` (Task 1).
- Produces:
  - `POST /admin/orders/:ref/slot-given` and `POST /admin/orders/:ref/rename` (form field `fb_name`).
  - Order field `slot_given_at`, which Task 3's ledger reads.
  - Toast keys `order_slot_given`, `order_renamed`, `order_name_bad`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-waitlist-admin.js`:

````js
// Run: node scripts/test-waitlist-admin.js
//
// The owner's two new Waitlist actions, end to end through the real routes and
// the real lib/orders.js: "Slot given" (POST /admin/orders/:ref/slot-given)
// takes a free or priority entry out of the public line, stops a priority ₱100
// counting as paid and tells the customer on their order page; "Edit name"
// (POST /admin/orders/:ref/rename) changes only the name. Both refuse Coming
// Soon reservations, buy pre-orders and anything not in line. Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a
// made-up admin password) with an in-memory orders collection; the project's
// games.json, the database and the real admin are never touched.
// See docs/superpowers/specs/2026-10-24-waitlist-slot-given-and-rename-design.md.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4640;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlist-admin-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [Object.assign({ id: 1, title: 'Zzyzx Line', platform: 'PS5', genre: 'Action', cover_image: '', renters: 4, non_trophy_slots: 0, trophy_slots: 0 }, price)],
  upcoming: [Object.assign({ id: 7, title: 'Zzyzx Soon', platform: 'PS5', release_date: '2099-01-01', non_trophy_slots: 2, trophy_slots: 2, buy_tr_price: 1999 }, price)]
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

const entry = (ref, state, fb_name, created_at, extra) => Object.assign({
  ref, state, fb_name, created_at, url_key: 'k' + ref.slice(3), game_id: 1, game_title: 'Zzyzx Line',
  account_type: 'tr', days: 30, amount_due: 0, deposit_due: 0, is_waitlist: state === 'waitlisted',
  state_history: [{ state, at: created_at }]
}, extra || {});
docs.push(
  entry('PH-0401', 'reserved', 'Marvin Reyes', '2026-10-22T01:00:00.000Z', { is_waitlist: false, is_reservation: true, amount_due: 100, remaining_due: 799, paid_at: '2026-10-22T02:00:00.000Z' }),
  entry('PH-0402', 'waitlisted', 'Mark Lim', '2026-10-18T01:00:00.000Z'),
  entry('PH-0403', 'waitlisted', 'Gemry Tan', '2026-10-20T01:00:00.000Z'),
  entry('PH-0404', 'waitlisted', 'Adrian Bautista', '2026-10-20T02:00:00.000Z'),
  entry('PH-0405', 'waitlisted', 'Adrian Bautista', '2026-10-20T03:00:00.000Z'),
  entry('PH-0406', 'reserved', 'Cy Soon', '2026-10-01T01:00:00.000Z', { game_id: 'upcoming_7', game_title: 'Zzyzx Soon', upcoming_game_id: 7, is_reservation: true, amount_due: 899 }),
  entry('PH-0407', 'reserved', 'Dee Own', '2026-10-01T02:00:00.000Z', { game_id: 'upcoming_7', game_title: 'Zzyzx Soon', upcoming_game_id: 7, is_reservation: true, is_buy: true, days: null, amount_due: 1999 }),
  entry('PH-0408', 'active', 'Eve Renter', '2026-10-02T01:00:00.000Z', { amount_due: 799 })
);
const byRef = ref => docs.find(d => d.ref === ref);

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

  // The Trophy line exactly as the game page hands it to the browser.
  async function trophyLine() {
    const page = (await call('GET', '/game/zzyzx-line')).body;
    const m = /var DATA = (.*);\r?\n/.exec(page);
    assert.ok(m, 'the game page carries the line');
    return JSON.parse(m[1]).tr.map(r => r.position + ' ' + r.name + (r.tier === 'priority' ? ' *' : ''));
  }

  await okAsync('before: Marvin is #1 on priority, then the free entries by join date', async () => {
    assert.deepStrictEqual(await trophyLine(), ['1 Marvin R. *', '2 Mark L.', '3 Gemry T.', '4 Adrian B.', '5 Adrian B.']);
  });

  const login = await post('/admin/login', { password: TEST_PASSWORD });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const admin = (p, o) => post(p, o || {}, { Cookie: cookie });

  await okAsync('signed out, Slot given does nothing', async () => {
    const r = await post('/admin/orders/PH-0401/slot-given', {});
    assert.strictEqual(r.status, 401);
    const form = await post('/admin/orders/PH-0401/slot-given', {}, { Accept: 'text/html' });
    assert.strictEqual(form.status, 302);
    assert.ok(!/msg=order_slot_given/.test(form.headers.location || ''), form.headers.location);
    assert.strictEqual(byRef('PH-0401').state, 'reserved');
  });

  await okAsync('Slot given on the priority entry: out of the line, everyone moves up, the ₱100 stops counting', async () => {
    const r = await admin('/admin/orders/PH-0401/slot-given');
    assert.strictEqual(r.headers.location, '/admin?tab=orders&msg=order_slot_given');
    const o = byRef('PH-0401');
    assert.strictEqual(o.state, 'cancelled');
    assert.ok(!isNaN(Date.parse(o.slot_given_at)), 'slot_given_at is a timestamp');
    assert.strictEqual(orders.isPaid(o.state), false, 'no longer counted as paid');
    assert.deepStrictEqual(o.state_history.map(h => h.state), ['reserved', 'cancelled']);
    assert.deepStrictEqual(await trophyLine(), ['1 Mark L.', '2 Gemry T.', '3 Adrian B.', '4 Adrian B.']);
  });

  await okAsync('Slot given on a free entry works the same way', async () => {
    assert.strictEqual((await admin('/admin/orders/PH-0402/slot-given')).headers.location, '/admin?tab=orders&msg=order_slot_given');
    assert.strictEqual(byRef('PH-0402').state, 'cancelled');
    assert.deepStrictEqual(await trophyLine(), ['1 Gemry T.', '2 Adrian B.', '3 Adrian B.']);
  });

  await okAsync('refused for a Coming Soon reservation, a buy pre-order, a rental and an entry already closed', async () => {
    for (const ref of ['PH-0406', 'PH-0407', 'PH-0408', 'PH-0401']) {
      const before = JSON.stringify(byRef(ref));
      const r = await admin('/admin/orders/' + ref + '/slot-given');
      assert.strictEqual(r.headers.location, '/admin?tab=orders&msg=order_bad_state', ref);
      assert.strictEqual(JSON.stringify(byRef(ref)), before, ref + ' unchanged');
    }
  });

  await okAsync('Edit name: cleaned, saved, shown masked, place in line kept', async () => {
    const r = await admin('/admin/orders/PH-0405/rename', { fb_name: '  Adrian   Bernardo Jr ' });
    assert.strictEqual(r.headers.location, '/admin?tab=orders&msg=order_renamed');
    const o = byRef('PH-0405');
    assert.deepStrictEqual([o.fb_name, o.state, o.created_at], ['Adrian Bernardo Jr', 'waitlisted', '2026-10-20T03:00:00.000Z']);
    assert.deepStrictEqual(await trophyLine(), ['1 Gemry T.', '2 Adrian B.', '3 Adrian J.']);
  });

  await okAsync('Edit name refuses an empty or too-long name, and orders not in line', async () => {
    for (const bad of ['   ', 'x'.repeat(81)]) {
      assert.strictEqual((await admin('/admin/orders/PH-0404/rename', { fb_name: bad })).headers.location, '/admin?tab=orders&msg=order_name_bad');
    }
    assert.strictEqual(byRef('PH-0404').fb_name, 'Adrian Bautista');
    for (const ref of ['PH-0406', 'PH-0408', 'PH-0401']) {
      assert.strictEqual((await admin('/admin/orders/' + ref + '/rename', { fb_name: 'Someone Else' })).headers.location, '/admin?tab=orders&msg=order_bad_state', ref);
      assert.notStrictEqual(byRef(ref).fb_name, 'Someone Else', ref);
    }
  });

  await okAsync('the customer\'s order page says the slot was given; a plain Remove still says cancelled', async () => {
    const given = (await call('GET', '/order/PH-0401?k=k0401')).body;
    assert.ok(given.includes('✅ Slot given'), 'title');
    assert.ok(given.includes('You&#39;re all set — this waiting-list entry is closed.'), 'sub');
    assert.ok(!given.includes('Order cancelled'));
    assert.ok(!given.includes('To send now') && !given.includes('remaining, due'), 'asks for no more money');
    await admin('/admin/orders/PH-0403/cancel');
    const removed = (await call('GET', '/order/PH-0403?k=k0403')).body;
    assert.ok(removed.includes('Order cancelled') && !removed.includes('Slot given'));
  });

  await okAsync('the admin toasts for the three new outcomes', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
    assert.ok(src.includes("order_slot_given:'✅ Slot given — off the waiting list.'"));
    assert.ok(src.includes("order_renamed:'✏️ Name updated.'"));
    assert.ok(src.includes("order_name_bad:'❌ Enter a name (up to 80 characters).'"));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-waitlist-admin.js` → the first check passes, then FAIL `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:` / `404 !== 401` (the route does not exist yet).

- [ ] **Step 3: The routes, the toasts and the order page**

Create `.superpowers/tmp-edits/edit-waitlist-server.js`:

````js
// Task 2: POST /admin/orders/:ref/slot-given and /rename, their admin toasts,
// and the customer's order page wording for a slot given. Keeps server.js's
// BOM and every file's CRLF.
const rep = require('./rep');
const S = 'server.js';

rep(S,
`const queueRules = require('./lib/queue');
`,
`const queueRules = require('./lib/queue');
const { cleanFbName } = require('./lib/names');
`);

rep(S,
`  const r = await orders.transition(order.ref, 'cancelled', {});
  if (!r) return res.redirect('/admin?tab=orders&msg=order_stale');
  res.redirect('/admin?tab=orders&msg=order_cancelled');
}));
`,
`  const r = await orders.transition(order.ref, 'cancelled', {});
  if (!r) return res.redirect('/admin?tab=orders&msg=order_stale');
  res.redirect('/admin?tab=orders&msg=order_cancelled');
}));

// A Waitlist row the owner can act on: a free or priority entry still in line.
// A Coming Soon reservation or a buy pre-order rests in the same 'reserved'
// state for a different reason (it paid for a game, not a place in line), so
// neither action below may ever touch one.
// See docs/superpowers/specs/2026-10-24-waitlist-slot-given-and-rename-design.md.
function isWaitlistEntry(order) {
  return !!order && queueRules.QUEUE_STATES.includes(order.state) && !queueRules.isPreorder(order);
}

// "✅ Slot given": the customer got their account — the rental itself is
// recorded with Quick Add, full rent included — so the entry leaves the line.
// Closed as 'cancelled' with slot_given_at, which also stops a priority ₱100
// counting as paid (it is already inside the Quick Add rent). The ledger and
// the customer's order page read slot_given_at to say "Slot given", not
// "Cancelled".
app.post('/admin/orders/:ref/slot-given', requireAuth, asyncRoute(async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/admin?tab=orders');
  if (!isWaitlistEntry(order)) return res.redirect('/admin?tab=orders&msg=order_bad_state');
  const r = await orders.transition(order.ref, 'cancelled', { slot_given_at: new Date().toISOString() });
  if (!r) return res.redirect('/admin?tab=orders&msg=order_stale');
  res.redirect('/admin?tab=orders&msg=order_slot_given');
}));

// "✏️ Edit name": fixes a typo or nickname on a Waitlist row. Only fb_name
// changes — ref, state and created_at, and so the place in line, stay put. The
// public line shows the new name masked as usual.
app.post('/admin/orders/:ref/rename', requireAuth, asyncRoute(async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/admin?tab=orders');
  if (!isWaitlistEntry(order)) return res.redirect('/admin?tab=orders&msg=order_bad_state');
  const name = cleanFbName(req.body.fb_name);
  if (!name) return res.redirect('/admin?tab=orders&msg=order_name_bad');
  if (!(await orders.setName(order.ref, name))) return res.redirect('/admin?tab=orders&msg=order_stale');
  res.redirect('/admin?tab=orders&msg=order_renamed');
}));
`);

rep('views/admin.ejs',
`order_cancelled:'🚫 Order cancelled.'`,
`order_cancelled:'🚫 Order cancelled.', order_slot_given:'✅ Slot given — off the waiting list.', order_renamed:'✏️ Name updated.', order_name_bad:'❌ Enter a name (up to 80 characters).'`);

rep('views/order-status.ejs',
`    cancelled:         { title: 'Order cancelled',         sub: 'This order is no longer active.' },`,
`    // The owner's "Slot given" closes a waiting-list entry the same way, but the
    // customer got their account — so it must not read as a refusal.
    cancelled:         order.slot_given_at
                         ? { title: '✅ Slot given',          sub: 'You\\'re all set — this waiting-list entry is closed.' }
                         : { title: 'Order cancelled',         sub: 'This order is no longer active.' },`);

// A slot given is settled — the rent, priority fee included, was taken when the
// account was handed over — so the page must not ask for money any more.
rep('views/order-status.ejs',
`    <% } else if (!order.is_waitlist) { %>
    <div class="ord-total"><span>To send now</span>`,
`    <% } else if (!order.is_waitlist && !order.slot_given_at) { %>
    <div class="ord-total"><span>To send now</span>`);

rep('views/order-status.ejs',
`    <% if (order.is_reservation && order.remaining_due > 0) { %>`,
`    <% if (order.is_reservation && order.remaining_due > 0 && !order.slot_given_at) { %>`);

console.log('edited server.js, admin.ejs, order-status.ejs');
````

Run: `node .superpowers/tmp-edits/edit-waitlist-server.js` → `edited server.js, admin.ejs, order-status.ejs`.
Then: `file server.js` → still `UTF-8 (with BOM) text … with CRLF line terminators`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-waitlist-admin.js && node scripts/test-waitlist-slot-given-rules.js` → `9`, `3 assertions passed`.
Run the whole suite: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"` → only `FAIL scripts/test-upcoming-psn-page-public.js`, `failed: 1`.

- [ ] **Step 5: Commit**

```bash
git add server.js views/admin.ejs views/order-status.ejs scripts/test-waitlist-admin.js
git commit -m "Waitlist: Slot given and Edit name routes, their toasts, and a Slot given order page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Waitlist row's button and Edit name form, and the ledger label

**Files:**
- Create: `.superpowers/tmp-edits/edit-waitlist-template-test.js`, `.superpowers/tmp-edits/edit-waitlist-views.js`
- Modify (edit script): `scripts/test-orders-template.js`, `views/partials/admin/orders/needs-you.ejs`, `views/partials/admin/orders/ledger.ejs`, `public/css/style.css`

**Interfaces:**
- Consumes:
  - The routes `POST /admin/orders/:ref/slot-given` and `/rename` and the order field `slot_given_at` (Task 2).
  - In `needs-you.ejs`: the Waitlist loop's `o` and `wlPriority`.
  - In `ledger.ejs`: `stLbl`.
  - In `scripts/test-orders-template.js`: `render`, `lo`, `groupBlock`, `menus`, `outsideMenus`, `html`, `ROOT`.
  - `.superpowers/tmp-edits/rep.js` (Task 1).
- Produces: CSS classes `.oq-btn-given`, `.oq-rename`, `.oq-rename-lbl`, `.oq-rename-input`, `.oq-rename-save`; input ids `oqName-<ref>`.

- [ ] **Step 1: Write the failing checks**

Create `.superpowers/tmp-edits/edit-waitlist-template-test.js`:

````js
// Task 3, step 1: checks for the Waitlist row's ✅ Slot given button and
// ✏️ Edit name form, and the ledger's "✅ Slot given" label, added to the
// existing Orders tab template test. Keeps the file's line endings.
const rep = require('./rep');

rep('scripts/test-orders-template.js',
`console.log('\\nindicator strip');`,
`console.log('\\nwaitlist: slot given and edit name');

ok('✅ Slot given is a visible button on free and priority rows, with its confirm', () => {
  const R = r => '&#34;' + r + '&#34;';
  const visible = outsideMenus(groupBlock(html, 'waitlist'));
  [['PH-0120', 'Gio Yu'], ['PH-0121', 'Hana Go']].forEach(([ref, name]) => {
    assert.ok(visible.includes('action="/admin/orders/' + ref + '/slot-given"'), ref);
    assert.ok(visible.includes("onsubmit=\\"return confirm('Mark the slot as given to ' + " + R(name) + " + ' (' + " + R(ref) + " + ')?\\\\n\\\\nThey leave the line and the record is kept. A ₱100 priority fee stops counting as money — it\\\\'s already in the rent you recorded.');\\""), ref + ' confirm');
  });
  assert.strictEqual((visible.match(/<button type="submit" class="oq-btn-given" title="They got their account — take them off the waiting list">✅ Slot given<\\/button>/g) || []).length, 2);
});

ok('✏️ Edit name sits in every Waitlist row\\'s ⋯ menu, prefilled with the name', () => {
  const inMenus = menus(groupBlock(html, 'waitlist'));
  [['PH-0120', 'Gio Yu'], ['PH-0121', 'Hana Go']].forEach(([ref, name]) => {
    assert.ok(inMenus.includes('<form method="POST" action="/admin/orders/' + ref + '/rename" class="oq-rename">'), ref);
    assert.ok(inMenus.includes('<input type="text" id="oqName-' + ref + '" name="fb_name" value="' + name + '" maxlength="80" required class="oq-rename-input">'), ref + ' input');
  });
  assert.ok(!outsideMenus(groupBlock(html, 'waitlist')).includes('/rename'), 'not outside the menu');
  // A priority entry that was paid on the site (never a free entry) had no
  // menu at all before; it gets one now, holding Edit name but no Undo.
  const paidOnSite = render({ waitlistOrders: [lo('PH-0122', 'reserved', { game_id: 5, fb_name: 'Ivo Paz', queuePosition: 1 })] });
  const m = menus(groupBlock(paidOnSite, 'waitlist'));
  assert.ok(m.includes('action="/admin/orders/PH-0122/rename"') && !m.includes('undo-priority'));
});

ok('the ledger says ✅ Slot given for a slot given, Cancelled for a plain cancel', () => {
  const ledger = render({ ledgerGroups: [{ key: '2026-10', label: '2026-10', paidCount: 0, paidTotal: 0, orders: [
    lo('PH-0207', 'cancelled', { slot_given_at: '2026-10-24T03:00:00Z' }),
    lo('PH-0208', 'cancelled')
  ] }] });
  const row = ref => { const i = ledger.indexOf('<td class="oq-lref">' + ref + '</td>'); assert.ok(i > 0, ref); return ledger.slice(i, ledger.indexOf('</tr>', i)); };
  assert.ok(row('PH-0207').includes('<span class="oq-st oq-st-dead"><span class="oq-st-dot"></span>✅ Slot given</span>'));
  assert.ok(row('PH-0208').includes('<span class="oq-st oq-st-dead"><span class="oq-st-dot"></span>Cancelled</span>'));
});

ok('the new controls are styled', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  ['.oq-btn-given {', '.oq-rename {', '.oq-rename-input {', '.oq-rename-save {'].forEach(s => assert.ok(css.includes(s), s));
});

console.log('\\nindicator strip');`);

console.log('edited test-orders-template.js');
````

Run: `node .superpowers/tmp-edits/edit-waitlist-template-test.js` → `edited test-orders-template.js`.

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-orders-template.js` → FAIL `AssertionError [ERR_ASSERTION]: PH-0120` (there is no Slot given button yet).

- [ ] **Step 3: The button, the form, the label and the styles**

Create `.superpowers/tmp-edits/edit-waitlist-views.js`:

````js
// Task 3: the Waitlist row's ✅ Slot given button and ✏️ Edit name form
// (views/partials/admin/orders/needs-you.ejs), the ledger's "✅ Slot given"
// label, and their styles. Keeps each file's CRLF.
const rep = require('./rep');
const N = 'views/partials/admin/orders/needs-you.ejs';

rep(N,
`    const wlPriority = o.state === 'reserved';
    // A priority row has a menu only when the upgrade can be undone; a free
    // row always has Remove.
    const wlHasMenu = wlPriority ? !!o.upgraded_from_waitlist : true;
  %>`,
`    const wlPriority = o.state === 'reserved';
  %>`);

rep(N,
`      <button type="button" class="oq-btn-ghost rem-copy" data-msg="<%= wlMsg %>" title="Copy slot-open message">📋 Copy</button>
      <% if (!wlPriority) { %>`,
`      <button type="button" class="oq-btn-ghost rem-copy" data-msg="<%= wlMsg %>" title="Copy slot-open message">📋 Copy</button>
      <%# They got their account (the rental is recorded with Quick Add), so the
          entry leaves the line. A priority ₱100 stops counting as money because
          the Quick Add rent already includes it. %>
      <form method="POST" action="/admin/orders/<%= o.ref %>/slot-given" onsubmit="return confirm('Mark the slot as given to ' + <%= JSON.stringify(o.fb_name || '') %> + ' (' + <%= JSON.stringify(o.ref) %> + ')?\\n\\nThey leave the line and the record is kept. A ₱100 priority fee stops counting as money — it\\'s already in the rent you recorded.');">
        <button type="submit" class="oq-btn-given" title="They got their account — take them off the waiting list">✅ Slot given</button>
      </form>
      <% if (!wlPriority) { %>`);

rep(N,
`      <% if (wlHasMenu) { %>
      <details class="oq-more">
        <summary class="oq-more-btn" title="More actions" aria-label="More actions">⋯</summary>
        <div class="oq-more-menu">
          <% if (wlPriority) { %>`,
`      <details class="oq-more">
        <summary class="oq-more-btn" title="More actions" aria-label="More actions">⋯</summary>
        <div class="oq-more-menu">
          <%# Fixes a typo or nickname. Only the name changes — the ref and the
              place in line stay put. %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/rename" class="oq-rename">
            <label class="oq-rename-lbl" for="oqName-<%= o.ref %>">✏️ Edit name</label>
            <input type="text" id="oqName-<%= o.ref %>" name="fb_name" value="<%= o.fb_name %>" maxlength="80" required class="oq-rename-input">
            <button type="submit" class="oq-rename-save">Save</button>
          </form>
          <% if (wlPriority && o.upgraded_from_waitlist) { %>`);

rep(N,
`          <% } else { %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/cancel" onsubmit="return confirm('Remove ' + <%= JSON.stringify(o.ref) %> + ' from the waiting list?');">
            <button type="submit" class="oq-more-item oq-more-danger" title="Remove this waitlist entry">Remove</button>
          </form>
          <% } %>
        </div>
      </details>
      <% } %>`,
`          <% } else if (!wlPriority) { %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/cancel" onsubmit="return confirm('Remove ' + <%= JSON.stringify(o.ref) %> + ' from the waiting list?');">
            <button type="submit" class="oq-more-item oq-more-danger" title="Remove this waitlist entry">Remove</button>
          </form>
          <% } %>
        </div>
      </details>`);

rep('views/partials/admin/orders/ledger.ejs',
`           const stLbl = o.state === 'cancelled' ? 'Cancelled'`,
`           const stLbl = o.state === 'cancelled' ? (o.slot_given_at ? '✅ Slot given' : 'Cancelled')`);

rep('public/css/style.css',
`.oq-btn-pri:hover { background: rgba(245,158,11,0.12); border-color: #f59e0b; }
`,
`.oq-btn-pri:hover { background: rgba(245,158,11,0.12); border-color: #f59e0b; }
/* Slot given: the Waitlist row's main action — green, outlined like Priority paid. */
.oq-btn-given { background: transparent; color: #22c55e; border: 1px solid rgba(34,197,94,0.4); border-radius: 9px; padding: 0.5rem 0.9rem; font-weight: 700; font-size: 0.78rem; cursor: pointer; font-family: inherit; white-space: nowrap; }
.oq-btn-given:hover { background: rgba(34,197,94,0.12); border-color: #22c55e; }
`);

rep('public/css/style.css',
`.oq-more-danger:hover { background: rgba(239,68,68,0.12); color: #fca5a5; }
`,
`.oq-more-danger:hover { background: rgba(239,68,68,0.12); color: #fca5a5; }
/* ✏️ Edit name inside a Waitlist row's ⋯ menu. */
.oq-rename { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; min-width: 230px; padding: 0.4rem 0.5rem 0.5rem; border-bottom: 1px solid #222; margin-bottom: 0.15rem; }
.oq-rename:last-child { border-bottom: 0; margin-bottom: 0; }
.oq-rename-lbl { width: 100%; color: #ccc; font-size: 0.8rem; font-weight: 600; }
.oq-rename-input { flex: 1; min-width: 0; width: 9rem; background: #0d0d0d; border: 1px solid #2a2a2a; border-radius: 7px; padding: 0.4rem 0.5rem; color: #fff; font-size: 0.8rem; font-family: inherit; }
.oq-rename-save { background: var(--ps-blue); color: #fff; border: 0; border-radius: 7px; padding: 0.4rem 0.7rem; font-weight: 800; font-size: 0.78rem; cursor: pointer; font-family: inherit; }
body.light-mode .oq-rename { border-bottom-color: #e5e5e5; }
body.light-mode .oq-rename-lbl { color: #333; }
body.light-mode .oq-rename-input { background: #fff; border-color: #ccc; color: #111; }
`);

console.log('edited needs-you.ejs, ledger.ejs, style.css');
````

Run: `node .superpowers/tmp-edits/edit-waitlist-views.js` → `edited needs-you.ejs, ledger.ejs, style.css`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-orders-template.js && node scripts/test-waitlist-admin.js` → `37`, `9 assertions passed`.
Run the whole suite (the loop in Task 2, Step 4) → only `FAIL scripts/test-upcoming-psn-page-public.js`, `failed: 1`.

- [ ] **Step 5: Commit and clean up**

```bash
git add views/partials/admin/orders/needs-you.ejs views/partials/admin/orders/ledger.ejs public/css/style.css scripts/test-orders-template.js
git commit -m "Waitlist: a Slot given button and an Edit name form on every row; the ledger says Slot given

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
