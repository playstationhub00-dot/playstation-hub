# Orders: "Cancel selected" and a 30-day cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner can tick rows on the By game board and cancel them in one go. A daily-style sweep cancels unpaid orders and free waiting-list entries left untouched for 30 days. Priority entries and unpaid Quick Adds are never touched.

**Architecture:**
- **Rules:** a new pure helper, `lib/order-cleanup.js`, holds them: what may be cancelled, what is stale, the setting, form refs, and a sweep with its database calls passed in.
- **Routes and timers (`server.js`):**
  - `POST /admin/orders/bulk-cancel` cancels the ticked rows.
  - A separate 5-minute timer runs the sweep.
  - The Payment reminders settings route saves the cleanup switch and days.
- **Views:** the board gets checkboxes, a "Select all" per card and one bulk form shown as a bar. The ledger, Settings and the admin toasts get their new text.
- **Browser:** `public/js/admin-orders.js` keeps the bar in step with the ticks.

**Tech Stack:** Express + EJS templates, plain browser JS (no build step), plain CSS. Tests are `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-24-orders-bulk-cancel-and-cleanup-design.md` (amended after this plan's dry run).

**How this plan was checked.** Every file in this plan was dry-run in a scratch copy of the current `main`:
- Each new or changed test fails first and then passes.
- The full suite stays green apart from `scripts/test-upcoming-psn-page-public.js`, which also fails before this work.

A browser check ran on a throwaway instance with made-up By game entries:
- **Select all:** "Select all in this card" on Onimusha Trophy ticked its 4 rows. Unticking one left the box half-ticked and the bar at "3 selected".
- **Submit:** the confirm read "Cancel 3 selected orders? … the records stay in All orders". The toast said "🚫 Cancelled 3 orders.", and the card dropped to "1 waiting".
- **Settings:** Payment reminders shows "Clean up old entries" ticked, with "Clean up after (days)" at 30.
- **Phone, 375px:** the bar fits the screen and nothing scrolls sideways.
- **Errors:** none in the console or the server log.

## Global Constraints

- Work directly on `main` and do not switch branches. **Push only when the owner says "push".**
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Line endings:**
  - `server.js` is CRLF + UTF-8 BOM.
  - These files are CRLF: `views/admin.ejs`, `views/partials/admin/settings.ejs`, `views/partials/admin/orders/ledger.ejs`, `views/partials/admin/orders/needs-you.ejs`, `public/css/style.css` (a test checks every line), `scripts/test-orders-template.js`.
  - These files are LF: `public/js/admin-orders.js`, `scripts/test-admin-orders-filter.js` and the new files.
  - The edit scripts (via `.superpowers/tmp-edits/rep.js`) keep each file's endings and BOM.
  - Git stores LF blobs (`core.autocrlf=true`).
- **Cancellable:** state `awaiting_payment`, `payment_rejected` or `waitlisted`, and not an owner-recorded unpaid Quick Add (`quickAddSettle.isOwnerRecordedUnpaid`). ⭐ `reserved` never is. Bulk and cleanup use this one rule.
- **Cancelling:**
  - It always goes to `cancelled` (never delete), pinned to the state just read: `orders.transition(ref, 'cancelled', patch, { from: [order.state] })`.
  - The bulk patch is `{ cancel_reason: 'owner_bulk' }`.
  - The cleanup patch is `{ cancel_reason: 'stale', stale_days: <days> }`.
- **Cleanup setting:**
  - It lives in `site_settings.payment_reminders` as `cleanup_enabled` and `cleanup_days`.
  - Unset means on at 30. Days are whole numbers clamped to 7–365.
  - The save route rewrites the whole object, so it must include both fields.
- **Stale:** cancellable and `now - lastActivity >= days`. Last activity is the latest `state_history[].at`, else `created_at`; an unreadable date is never stale.
- **Bulk refs:** the form field is `refs`, one or many. Only `PH-<digits>` refs are used; they are upper-cased, deduplicated and capped at 200.
- **Bulk redirect:**
  - It goes to `/admin?tab=orders&msg=orders_bulk_cancelled&n=<cancelled>&skipped=<refs − cancelled>`.
  - When nothing usable was sent, it goes to `msg=orders_bulk_none`.
- **Copy, verbatim:**
  - **Toasts:** `🚫 Cancelled <n> order(s).` plus ` <k> skipped — they changed meanwhile.`, and `Nothing was selected.`
  - **Board:**
    - The bar reads `<n> selected`, with `🚫 Cancel selected` and `Clear`.
    - The confirm reads `Cancel <n> selected order(s)?\n\nThey leave the board; the records stay in All orders.`
    - The select-all label is `Select all in this card`.
  - **Settings:**
    - The switch is `Clean up old entries`, with the note `Cancels unpaid orders and free waiting-list entries with no activity for this many days. Priority (paid) entries and unpaid Quick Adds are never touched. The records stay in All orders.`
    - The days field is `Clean up after (days)`.
  - **Ledger:** `Cancelled · <stale_days>+ days`.
- **Test data:** tests use a temp `DATA_DIR`, a blank `MONGODB_URI`, the in-memory session store, a made-up admin password and an in-memory orders collection. Never touch the project's `games.json` or a database.
- **Known unrelated failure:** `scripts/test-upcoming-psn-page-public.js`. Report it; do not fix it.
- **Edit scripts:** they live in `.superpowers/tmp-edits/` (git-ignored). Never commit them. Task 5 removes the folder.
- **Committing:** always `git add` explicit paths. The untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.
- **Pushing:** the cleanup starts **on**. The first sweep after a deploy, about 5 minutes after start, cancels everything already past 30 days. Do not push mid-plan.

## Files

| File | Task | Change |
|---|---|---|
| `lib/order-cleanup.js` (new) | 1 | Rules, refs, sweep |
| `scripts/test-order-cleanup.js` (new) | 1 | The rules and the sweep with fakes |
| `server.js` | 2, 3 | `POST /admin/orders/bulk-cancel`; cleanup timer; settings route keeps the cleanup fields |
| `views/admin.ejs` | 2 | Two toasts |
| `scripts/test-orders-bulk-cancel.js` (new) | 2 | The real bulk route |
| `views/partials/admin/settings.ejs` | 3 | Switch + days |
| `views/partials/admin/orders/ledger.ejs` | 3 | `Cancelled · N+ days` |
| `scripts/test-order-cleanup-wiring.js` (new) | 3 | The real timer, setting and ledger |
| `views/partials/admin/orders/needs-you.ejs` | 4 | Checkboxes, select-all, bulk form/bar |
| `public/css/style.css` | 4 | `.oq-pick*`, `.oq-bulk-*` |
| `scripts/test-orders-template.js` | 4 | The markup |
| `public/js/admin-orders.js` | 5 | `bulkLabel`, `bulkConfirm`, `initBulk` |
| `scripts/test-admin-orders-filter.js` | 5 | The wording |

---

### Task 1: The rules — `lib/order-cleanup.js`

**Files:**
- Create: `scripts/test-order-cleanup.js`, `lib/order-cleanup.js`

**Interfaces:**
- Consumes: `require('./quick-add-settle').isOwnerRecordedUnpaid(order)` (existing).
- Produces (`require('./lib/order-cleanup')`):
  - `CANCELLABLE_STATES` (`['awaiting_payment', 'payment_rejected', 'waitlisted']`), plus `DEFAULT_DAYS`, `MIN_DAYS`, `MAX_DAYS` and `MAX_REFS`.
  - `normalizeCleanup(raw)` → `{ enabled, days }`.
  - `lastActivity(order)` → ms, or `null`.
  - `isCancellable(order)` → boolean.
  - `staleOrders(orders, settings, now)` → orders.
  - `parseRefs(raw)` → `string[]`.
  - `runCleanup({ now, settings, listCandidates, cancel })` → `{ examined, cancelled[, overlapped] }`. `cancel(order, days)` returns truthy when it cancelled.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-order-cleanup.js`:

````js
// Run: node scripts/test-order-cleanup.js
//
// lib/order-cleanup.js: which orders the owner may cancel from the By game
// board ("Cancel selected") and which the 30-day cleanup cancels on its own —
// unpaid orders and free waiting-list entries, never a priority (paid) entry
// or an unpaid Quick Add — plus the cleanup setting and the sweep itself,
// driven with fakes.
// See docs/superpowers/specs/2026-10-24-orders-bulk-cancel-and-cleanup-design.md.
const assert = require('assert');
const cleanup = require('../lib/order-cleanup');

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const NOW = new Date('2026-10-25T00:00:00.000Z');
const daysAgo = d => new Date(NOW.getTime() - d * 86400000).toISOString();
const o = (ref, state, created_at, extra) => Object.assign({ ref, state, created_at }, extra || {});

(async () => {
  await ok('the setting: unset means on at 30 days; days are whole and kept within 7-365', async () => {
    assert.deepStrictEqual(cleanup.normalizeCleanup(undefined), { enabled: true, days: 30 });
    assert.deepStrictEqual(cleanup.normalizeCleanup({}), { enabled: true, days: 30 });
    assert.deepStrictEqual(cleanup.normalizeCleanup({ cleanup_enabled: false, cleanup_days: 45 }), { enabled: false, days: 45 });
    assert.deepStrictEqual(cleanup.normalizeCleanup({ cleanup_days: '14.6' }), { enabled: true, days: 15 });
    assert.strictEqual(cleanup.normalizeCleanup({ cleanup_days: 2 }).days, 7);
    assert.strictEqual(cleanup.normalizeCleanup({ cleanup_days: 9999 }).days, 365);
    assert.strictEqual(cleanup.normalizeCleanup({ cleanup_days: 'abc' }).days, 30);
    assert.strictEqual(cleanup.normalizeCleanup({ cleanup_days: '' }).days, 30);
  });

  await ok('last activity is the latest state change, else the day it was made; unreadable is null', async () => {
    assert.strictEqual(cleanup.lastActivity(o('A', 'payment_rejected', daysAgo(40), {
      state_history: [{ state: 'awaiting_payment', at: daysAgo(40) }, { state: 'payment_rejected', at: daysAgo(3) }, { state: 'x', at: 'nope' }]
    })), Date.parse(daysAgo(3)));
    assert.strictEqual(cleanup.lastActivity(o('B', 'waitlisted', daysAgo(31))), Date.parse(daysAgo(31)));
    assert.strictEqual(cleanup.lastActivity(o('C', 'waitlisted', 'not a date')), null);
    assert.strictEqual(cleanup.lastActivity(null), null);
  });

  await ok('cancellable: unpaid, payment rejected and free entries — not priority, not an unpaid Quick Add, not paid', async () => {
    assert.strictEqual(cleanup.isCancellable(o('A', 'awaiting_payment')), true);
    assert.strictEqual(cleanup.isCancellable(o('B', 'payment_rejected')), true);
    assert.strictEqual(cleanup.isCancellable(o('C', 'waitlisted')), true);
    ['reserved', 'verifying_payment', 'awaiting_qr', 'active', 'closed', 'cancelled'].forEach(state =>
      assert.strictEqual(cleanup.isCancellable(o('D', state)), false, state));
    assert.strictEqual(cleanup.isCancellable(o('E', 'awaiting_payment', '', { settle_state: 'active' })), false, 'unpaid Quick Add');
    assert.strictEqual(cleanup.isCancellable(o('F', 'awaiting_payment', '', { customer_id: 12 })), false, 'unpaid Quick Add (older kind)');
    assert.strictEqual(cleanup.isCancellable(null), false);
  });

  await ok('stale: cancellable and quiet for at least the set days; off means nothing', async () => {
    const list = [
      o('PH-0001', 'awaiting_payment', daysAgo(30)),
      o('PH-0002', 'awaiting_payment', daysAgo(29.9)),
      o('PH-0003', 'waitlisted', daysAgo(75)),
      o('PH-0004', 'reserved', daysAgo(90)),
      o('PH-0005', 'payment_rejected', daysAgo(60), { state_history: [{ state: 'payment_rejected', at: daysAgo(2) }] }),
      o('PH-0006', 'awaiting_payment', daysAgo(60), { settle_state: 'active' }),
      o('PH-0007', 'active', daysAgo(90)),
      o('PH-0008', 'waitlisted', 'garbage'),
      null
    ];
    assert.deepStrictEqual(cleanup.staleOrders(list, {}, NOW).map(x => x.ref), ['PH-0001', 'PH-0003']);
    assert.deepStrictEqual(cleanup.staleOrders(list, { cleanup_days: 60 }, NOW).map(x => x.ref), ['PH-0003']);
    assert.deepStrictEqual(cleanup.staleOrders(list, { cleanup_enabled: false }, NOW), []);
  });

  await ok('refs from a form: one or many, PH-numbers only, upper-cased, no repeats, at most 200', async () => {
    assert.deepStrictEqual(cleanup.parseRefs('ph-0145'), ['PH-0145']);
    assert.deepStrictEqual(cleanup.parseRefs(['PH-0145', 'PH-0146', 'PH-0145', 'x', '<b>', '', null, 7]), ['PH-0145', 'PH-0146']);
    assert.deepStrictEqual(cleanup.parseRefs(undefined), []);
    const many = Array.from({ length: 250 }, (_, i) => 'PH-' + String(1000 + i));
    assert.strictEqual(cleanup.parseRefs(many).length, 200);
  });

  await ok('the sweep cancels each stale order with its days, and only when switched on', async () => {
    const list = [o('PH-0011', 'awaiting_payment', daysAgo(40)), o('PH-0012', 'waitlisted', daysAgo(5)), o('PH-0013', 'waitlisted', daysAgo(31))];
    const calls = [];
    const deps = settings => ({
      now: NOW, settings,
      listCandidates: async () => list,
      cancel: async (order, days) => { calls.push(order.ref + '@' + days); return order.ref !== 'PH-0013'; }
    });
    assert.deepStrictEqual(await cleanup.runCleanup(deps({})), { examined: 3, cancelled: 1 });
    assert.deepStrictEqual(calls, ['PH-0011@30', 'PH-0013@30']);
    calls.length = 0;
    assert.deepStrictEqual(await cleanup.runCleanup(deps({ cleanup_enabled: false })), { examined: 0, cancelled: 0 });
    assert.deepStrictEqual(calls, []);
  });

  await ok('a failing cancel does not stop the rest, and two sweeps never overlap', async () => {
    const list = [o('PH-0021', 'awaiting_payment', daysAgo(40)), o('PH-0022', 'awaiting_payment', daysAgo(40))];
    const done = [];
    let release;
    const gate = new Promise(r => { release = r; });
    const first = cleanup.runCleanup({
      now: NOW, settings: {},
      listCandidates: async () => { await gate; return list; },
      cancel: async order => { if (order.ref === 'PH-0021') throw new Error('db down'); done.push(order.ref); return true; }
    });
    const second = await cleanup.runCleanup({ now: NOW, settings: {}, listCandidates: async () => list, cancel: async () => true });
    assert.deepStrictEqual(second, { examined: 0, cancelled: 0, overlapped: true });
    release();
    assert.deepStrictEqual(await first, { examined: 2, cancelled: 1 });
    assert.deepStrictEqual(done, ['PH-0022']);
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-order-cleanup.js` → FAIL `Error: Cannot find module '../lib/order-cleanup'`.

- [ ] **Step 3: Write the helper**

Create `lib/order-cleanup.js`:

````js
// Admin → Orders → By game: clearing old entries. The owner can tick rows and
// "Cancel selected" (POST /admin/orders/bulk-cancel), and a sweep cancels the
// ones that have sat untouched for the set number of days. Both only ever
// cancel — the record stays in All orders — and both stop at the same line:
// unpaid orders and free waiting-list entries, never a ⭐ priority entry
// (somebody paid ₱100 for that place) and never an unpaid Quick Add (a real
// rental that still owes money). Pure rules plus a sweep with its database
// calls passed in, like lib/payment-reminders.js.
// See docs/superpowers/specs/2026-10-24-orders-bulk-cancel-and-cleanup-design.md.

const quickAddSettle = require('./quick-add-settle');

// The states POST /admin/orders/:ref/cancel accepts.
const CANCELLABLE_STATES = Object.freeze(['awaiting_payment', 'payment_rejected', 'waitlisted']);
const DEFAULT_DAYS = 30;
const MIN_DAYS = 7;
const MAX_DAYS = 365;
const MAX_REFS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const REF_RE = /^PH-\d{4,}$/;

// Stored beside the payment-reminder settings. Unset means on at 30 days —
// the owner asked for the cleanup — and only a literal false turns it off.
function normalizeCleanup(raw) {
  const s = raw || {};
  let days = s.cleanup_days;
  if (days === undefined || days === null || days === '') days = DEFAULT_DAYS;
  else days = Math.round(Number(days));
  if (!Number.isFinite(days)) days = DEFAULT_DAYS;
  days = Math.max(MIN_DAYS, Math.min(MAX_DAYS, days));
  return { enabled: s.cleanup_enabled !== false, days };
}

// The last time anything happened to the order: its latest state change, or
// the day it was made when it has no history. null when no date can be read,
// so an order with a broken date is never treated as old.
function lastActivity(order) {
  if (!order) return null;
  let latest = NaN;
  (Array.isArray(order.state_history) ? order.state_history : []).forEach(h => {
    const t = Date.parse((h && h.at) || '');
    if (!isNaN(t) && (isNaN(latest) || t > latest)) latest = t;
  });
  if (isNaN(latest)) latest = Date.parse(order.created_at || '');
  return isNaN(latest) ? null : latest;
}

function isCancellable(order) {
  return !!order && CANCELLABLE_STATES.includes(order.state) && !quickAddSettle.isOwnerRecordedUnpaid(order);
}

function staleOrders(orders, settings, now) {
  const s = normalizeCleanup(settings);
  if (!s.enabled) return [];
  const at = now instanceof Date ? now.getTime() : Date.parse(now || '') || Date.now();
  return (orders || []).filter(o => {
    if (!isCancellable(o)) return false;
    const t = lastActivity(o);
    return t !== null && at - t >= s.days * DAY_MS;
  });
}

// The refs a "Cancel selected" form sent: one value or many, PH-numbers only.
function parseRefs(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  list.forEach(r => {
    if (typeof r !== 'string') return;
    const ref = r.trim().toUpperCase();
    if (REF_RE.test(ref) && out.indexOf(ref) === -1 && out.length < MAX_REFS) out.push(ref);
  });
  return out;
}

let sweeping = false;

// deps: { now, settings, listCandidates() → orders, cancel(order, days) → truthy
// when it cancelled }. One order failing does not stop the rest; a sweep that
// starts while another is running does nothing.
async function runCleanup(deps) {
  const d = deps || {};
  if (sweeping) return { examined: 0, cancelled: 0, overlapped: true };
  const s = normalizeCleanup(d.settings);
  if (!s.enabled) return { examined: 0, cancelled: 0 };
  sweeping = true;
  try {
    const list = (await d.listCandidates()) || [];
    let cancelled = 0;
    for (const order of staleOrders(list, d.settings, d.now)) {
      try {
        if (await d.cancel(order, s.days)) cancelled++;
      } catch (e) { /* one bad order must not stop the rest */ }
    }
    return { examined: list.length, cancelled };
  } finally {
    sweeping = false;
  }
}

module.exports = {
  CANCELLABLE_STATES, DEFAULT_DAYS, MIN_DAYS, MAX_DAYS, MAX_REFS,
  normalizeCleanup, lastActivity, isCancellable, staleOrders, parseRefs, runCleanup
};
````

- [ ] **Step 4: Run it and watch it pass**

Run: `node scripts/test-order-cleanup.js` → `7 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/order-cleanup.js scripts/test-order-cleanup.js
git commit -m "Orders: rules for cancelling old entries in bulk and by a 30-day cleanup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: "Cancel selected" — the route and its toasts

**Files:**
- Create: `scripts/test-orders-bulk-cancel.js`, `.superpowers/tmp-edits/rep.js`, `.superpowers/tmp-edits/edit-bulk-route.js`
- Modify (edit script): `server.js`, `views/admin.ejs`

**Interfaces:**
- Consumes:
  - From Task 1: `parseRefs` and `isCancellable`.
  - Already present: `orders.getByRef(ref)`, `orders.transition(ref, to, patch, { from })`, `requireAuth`, `asyncRoute`, and in `views/admin.ejs` the toast helpers `psnCount(key)` and `psnPlural(n, word)`.
- Produces:
  - `const orderCleanup = require('./lib/order-cleanup')` at the top of `server.js` (Task 3 uses it).
  - `POST /admin/orders/bulk-cancel` (field `refs`).
  - Toast keys `orders_bulk_cancelled` and `orders_bulk_none`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-orders-bulk-cancel.js`:

````js
// Run: node scripts/test-orders-bulk-cancel.js
//
// "Cancel selected" on Admin → Orders → By game, through the real route
// (POST /admin/orders/bulk-cancel) and the real lib/orders.js: unpaid orders,
// payment-rejected ones and free waiting-list entries are cancelled; a priority
// entry, a rental and an unpaid Quick Add are skipped; the redirect carries the
// counts for the toast. Boots a throwaway instance (temp DATA_DIR, blank
// MONGODB_URI, in-memory sessions, a made-up admin password) with an in-memory
// orders collection; the project's games.json, the database and the real admin
// are never touched.
// See docs/superpowers/specs/2026-10-24-orders-bulk-cancel-and-cleanup-design.md.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4644;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-bulk-cancel-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [Object.assign({ id: 1, title: 'Zzyzx Bulk', platform: 'PS5', genre: 'Action', cover_image: '', renters: 3, non_trophy_slots: 0, trophy_slots: 0 }, price)]
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
// URLSearchParams repeats a key for an array, as a browser form does.
const encode = o => {
  const p = new URLSearchParams();
  Object.keys(o).forEach(k => [].concat(o[k]).forEach(v => p.append(k, v)));
  return p.toString();
};
const post = (p, o, headers) => call('POST', p, { headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}), body: encode(o) });

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

const entry = (ref, state, extra) => Object.assign({
  ref, state, game_id: 1, game_title: 'Zzyzx Bulk', account_type: 'tr', days: 30, fb_name: 'Zzyzx ' + ref.slice(3),
  url_key: 'k' + ref.slice(3), created_at: '2026-09-01T01:00:00.000Z', amount_due: 899, deposit_due: 0,
  state_history: [{ state, at: '2026-09-01T01:00:00.000Z' }]
}, extra || {});
docs.push(
  entry('PH-0601', 'awaiting_payment'),
  entry('PH-0602', 'payment_rejected'),
  entry('PH-0603', 'waitlisted', { amount_due: 0, is_waitlist: true }),
  entry('PH-0604', 'reserved', { amount_due: 100, is_reservation: true }),
  entry('PH-0605', 'active'),
  entry('PH-0606', 'awaiting_payment', { settle_state: 'active' }),
  entry('PH-0607', 'awaiting_payment')
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

  await okAsync('signed out, nothing is cancelled', async () => {
    assert.strictEqual((await post('/admin/orders/bulk-cancel', { refs: ['PH-0601'] })).status, 401);
    const form = await post('/admin/orders/bulk-cancel', { refs: ['PH-0601'] }, { Accept: 'text/html' });
    assert.strictEqual(form.status, 302);
    assert.ok(!/msg=orders_bulk/.test(form.headers.location || ''), form.headers.location);
    assert.strictEqual(byRef('PH-0601').state, 'awaiting_payment');
  });

  const login = await post('/admin/login', { password: TEST_PASSWORD });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const admin = o => post('/admin/orders/bulk-cancel', o, { Cookie: cookie });

  await okAsync('unpaid, rejected and free entries are cancelled; priority, a rental and an unpaid Quick Add are skipped', async () => {
    const r = await admin({ refs: ['PH-0601', 'PH-0602', 'PH-0603', 'PH-0604', 'PH-0605', 'PH-0606', 'junk', '<b>'] });
    assert.strictEqual(r.headers.location, '/admin?tab=orders&msg=orders_bulk_cancelled&n=3&skipped=3');
    ['PH-0601', 'PH-0602', 'PH-0603'].forEach(ref => {
      const o = byRef(ref);
      assert.deepStrictEqual([o.state, o.cancel_reason, o.state_history[o.state_history.length - 1].state], ['cancelled', 'owner_bulk', 'cancelled'], ref);
    });
    assert.deepStrictEqual(['PH-0604', 'PH-0605', 'PH-0606'].map(ref => byRef(ref).state), ['reserved', 'active', 'awaiting_payment']);
  });

  await okAsync('one ticked box works too; an already-cancelled one is skipped', async () => {
    assert.strictEqual((await admin({ refs: 'PH-0607' })).headers.location, '/admin?tab=orders&msg=orders_bulk_cancelled&n=1&skipped=0');
    assert.strictEqual(byRef('PH-0607').state, 'cancelled');
    assert.strictEqual((await admin({ refs: 'PH-0607' })).headers.location, '/admin?tab=orders&msg=orders_bulk_cancelled&n=0&skipped=1');
  });

  await okAsync('nothing ticked says so', async () => {
    assert.strictEqual((await admin({})).headers.location, '/admin?tab=orders&msg=orders_bulk_none');
    assert.strictEqual((await admin({ refs: 'nope' })).headers.location, '/admin?tab=orders&msg=orders_bulk_none');
  });

  await okAsync('the admin toasts for both outcomes', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
    assert.ok(src.includes("messages.orders_bulk_cancelled = '🚫 Cancelled ' + psnPlural(bulkN, 'order') + '.' + (bulkSkipped ? ' ' + bulkSkipped + ' skipped — they changed meanwhile.' : '');"));
    assert.ok(src.includes("messages.orders_bulk_none = 'Nothing was selected.';"));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-orders-bulk-cancel.js` → FAIL `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:` / `404 !== 401` (the route does not exist yet).

- [ ] **Step 3: The route and the toasts**

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

Create `.superpowers/tmp-edits/edit-bulk-route.js`:

````js
// Task 2: POST /admin/orders/bulk-cancel ("Cancel selected" on the By game
// board) and its two admin toasts. Keeps server.js's BOM and every file's CRLF.
const rep = require('./rep');
const S = 'server.js';

rep(S,
`const needsYouBoard = require('./lib/needs-you-board');
`,
`const needsYouBoard = require('./lib/needs-you-board');
const orderCleanup = require('./lib/order-cleanup');
`);

rep(S,
`  res.redirect('/admin?tab=orders&msg=order_renamed');
}));
`,
`  res.redirect('/admin?tab=orders&msg=order_renamed');
}));

// "Cancel selected" on the By game board: the owner ticked several unpaid
// orders or free waiting-list entries. Each is read again and cancelled only
// while lib/order-cleanup.js still allows it, pinned to the state just read,
// so one that was paid or moved meanwhile is skipped rather than cancelled.
// Cancelled, not deleted: the records stay in All orders.
// See docs/superpowers/specs/2026-10-24-orders-bulk-cancel-and-cleanup-design.md.
app.post('/admin/orders/bulk-cancel', requireAuth, asyncRoute(async (req, res) => {
  const refs = orderCleanup.parseRefs(req.body.refs);
  if (!refs.length) return res.redirect('/admin?tab=orders&msg=orders_bulk_none');
  let cancelled = 0;
  for (const ref of refs) {
    const order = await orders.getByRef(ref);
    if (!orderCleanup.isCancellable(order)) continue;
    const r = await orders.transition(order.ref, 'cancelled', { cancel_reason: 'owner_bulk' }, { from: [order.state] });
    if (r) cancelled++;
  }
  res.redirect('/admin?tab=orders&msg=orders_bulk_cancelled&n=' + cancelled + '&skipped=' + (refs.length - cancelled));
}));
`);

rep('views/admin.ejs',
`    messages.support_control_failed = '❌ Messenger still has this chat. The bot was not resumed — the reason is on the card.';
`,
`    messages.support_control_failed = '❌ Messenger still has this chat. The bot was not resumed — the reason is on the card.';
    // "Cancel selected" on the By game board carries its counts in the URL too.
    const bulkN = psnCount('n');
    const bulkSkipped = psnCount('skipped');
    messages.orders_bulk_cancelled = '🚫 Cancelled ' + psnPlural(bulkN, 'order') + '.' + (bulkSkipped ? ' ' + bulkSkipped + ' skipped — they changed meanwhile.' : '');
    messages.orders_bulk_none = 'Nothing was selected.';
`);

console.log('edited server.js, admin.ejs');
````

Run: `node .superpowers/tmp-edits/edit-bulk-route.js` → `edited server.js, admin.ejs`.
Then: `file server.js` → still `UTF-8 (with BOM) text … with CRLF line terminators`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-orders-bulk-cancel.js && node scripts/test-order-cleanup.js` → `5`, `7 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add server.js views/admin.ejs scripts/test-orders-bulk-cancel.js
git commit -m "Orders: Cancel selected route for the By game board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The 30-day cleanup — timer, setting and ledger label

**Files:**
- Create: `scripts/test-order-cleanup-wiring.js`, `.superpowers/tmp-edits/edit-cleanup-wiring.js`
- Modify (edit script): `server.js`, `views/partials/admin/settings.ejs`, `views/partials/admin/orders/ledger.ejs`

**Interfaces:**
- Consumes:
  - From Task 1: `normalizeCleanup`, `runCleanup` and `CANCELLABLE_STATES`.
  - From Task 2: `orderCleanup` in `server.js`.
  - Already present: `getSiteSettings()`, `orders.listByStates(states)`, `orders.transition(…)`, `paymentReminders.SWEEP_INTERVAL_MS`, and the payment-reminder settings form and route.
  - `.superpowers/tmp-edits/rep.js` (Task 2).
- Produces:
  - The settings fields `cleanup_enabled` and `cleanup_days`.
  - Order fields `cancel_reason: 'stale'` and `stale_days`.
  - The ledger label `Cancelled · <stale_days>+ days`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-order-cleanup-wiring.js`:

````js
// Run: node scripts/test-order-cleanup-wiring.js
//
// The 30-day cleanup as server.js wires it: its own timer runs
// lib/order-cleanup.js against the real lib/orders.js, cancelling stale unpaid
// orders and free waiting-list entries (cancel_reason 'stale', with the days)
// and leaving priority entries, unpaid Quick Adds and fresh ones alone; the
// switch and days in Settings → Payment reminders save beside the reminder
// fields and turn it off; the ledger reads "Cancelled · 30+ days". The test
// catches the server's timers as they are created and runs only the cleanup
// one by hand, so no reminder is ever sent. Boots a throwaway instance (temp
// DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin password)
// with an in-memory orders collection; the project's games.json, the database
// and the real admin are never touched.
// See docs/superpowers/specs/2026-10-24-orders-bulk-cancel-and-cleanup-design.md.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4645;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'order-cleanup-wiring-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [Object.assign({ id: 1, title: 'Zzyzx Old', platform: 'PS5', genre: 'Action', cover_image: '', renters: 3, non_trophy_slots: 0, trophy_slots: 0 }, price)]
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

const daysAgo = d => new Date(Date.now() - d * 86400000).toISOString();
const entry = (ref, state, age, extra) => Object.assign({
  ref, state, game_id: 1, game_title: 'Zzyzx Old', account_type: 'tr', days: 30, fb_name: 'Zzyzx ' + ref.slice(3),
  url_key: 'k' + ref.slice(3), created_at: daysAgo(age), amount_due: 899, deposit_due: 0,
  state_history: [{ state, at: daysAgo(age) }]
}, extra || {});
docs.push(
  entry('PH-0701', 'awaiting_payment', 40),
  entry('PH-0702', 'awaiting_payment', 5),
  entry('PH-0703', 'waitlisted', 31, { amount_due: 0, is_waitlist: true }),
  entry('PH-0704', 'reserved', 90, { amount_due: 100, is_reservation: true }),
  entry('PH-0705', 'awaiting_payment', 60, { settle_state: 'active' })
);
const byRef = ref => docs.find(d => d.ref === ref);
const waitFor = async (cond, ms) => {
  const end = Date.now() + (ms || 3000);
  while (Date.now() < end) { if (cond()) return true; await new Promise(r => setTimeout(r, 25)); }
  return cond();
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
  // Catch every timer the server creates; only the cleanup one is ever run here.
  const realSetInterval = global.setInterval;
  const timers = [];
  global.setInterval = function (fn, ms, ...rest) { timers.push(fn); return realSetInterval.call(this, fn, ms, ...rest); };
  try { require('../server.js'); } finally { global.setInterval = realSetInterval; }
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

  const runCleanup = timers.find(fn => String(fn).includes('orderCleanup.runCleanup'));
  await okAsync('the cleanup has its own timer in server.js', async () => {
    assert.ok(runCleanup, 'a setInterval callback runs orderCleanup.runCleanup');
    assert.ok(!String(runCleanup).includes('paymentReminders.runSweep'), 'separate from the reminder sweep');
  });

  await okAsync('on by default: stale unpaid and free entries are cancelled; priority, Quick Add and fresh ones stay', async () => {
    runCleanup();
    assert.ok(await waitFor(() => byRef('PH-0701').state === 'cancelled' && byRef('PH-0703').state === 'cancelled'), 'stale ones cancelled');
    ['PH-0701', 'PH-0703'].forEach(ref => {
      const o = byRef(ref);
      assert.deepStrictEqual([o.cancel_reason, o.stale_days, o.state_history[o.state_history.length - 1].state], ['stale', 30, 'cancelled'], ref);
    });
    assert.deepStrictEqual(['PH-0702', 'PH-0704', 'PH-0705'].map(ref => byRef(ref).state), ['awaiting_payment', 'reserved', 'awaiting_payment']);
  });

  const login = await post('/admin/login', { password: TEST_PASSWORD });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const page = async () => (await call('GET', '/admin?tab=settings', { headers: { Cookie: cookie } })).body;

  await okAsync('the ledger says how old a cleaned-up order was', async () => {
    const admin = (await call('GET', '/admin?tab=orders', { headers: { Cookie: cookie } })).body;
    const i = admin.indexOf('<td class="oq-lref">PH-0701</td>');
    assert.ok(i > 0, 'PH-0701 in the ledger');
    assert.ok(admin.slice(i, admin.indexOf('</tr>', i)).includes('<span class="oq-st-dot"></span>Cancelled · 30+ days</span>'));
  });

  await okAsync('Settings shows the switch on at 30 days before anything is saved', async () => {
    const html = await page();
    assert.ok(/<input type="checkbox" name="cleanup_enabled" checked>/.test(html));
    assert.ok(html.includes('<input type="number" name="cleanup_days" min="7" max="365" step="1" value="30">'));
  });

  await okAsync('saving the reminder settings keeps the cleanup fields; off means nothing is cancelled', async () => {
    const r = await post('/admin/settings/payment-reminders', { enabled: 'on', hold_hours: '24', cleanup_days: '45' }, { Cookie: cookie });
    assert.strictEqual(r.headers.location, '/admin?tab=settings&msg=reminders_saved');
    const html = await page();
    assert.ok(/<input type="checkbox" name="cleanup_enabled" >/.test(html), 'switched off');
    assert.ok(html.includes('name="cleanup_days" min="7" max="365" step="1" value="45"'));
    docs.push(entry('PH-0706', 'awaiting_payment', 50));
    runCleanup();
    await new Promise(res => setTimeout(res, 300));
    assert.strictEqual(byRef('PH-0706').state, 'awaiting_payment');
    await post('/admin/settings/payment-reminders', { enabled: 'on', hold_hours: '24', cleanup_enabled: 'on', cleanup_days: '3' }, { Cookie: cookie });
    assert.ok((await page()).includes('name="cleanup_days" min="7" max="365" step="1" value="7"'), 'days kept within 7-365');
    runCleanup();
    assert.ok(await waitFor(() => byRef('PH-0706').state === 'cancelled'));
    assert.strictEqual(byRef('PH-0706').stale_days, 7);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-order-cleanup-wiring.js` → FAIL `AssertionError [ERR_ASSERTION]: a setInterval callback runs orderCleanup.runCleanup`.

- [ ] **Step 3: Wire the cleanup**

Create `.superpowers/tmp-edits/edit-cleanup-wiring.js`:

````js
// Task 3: the 30-day cleanup — its own timer in server.js, its switch and days
// in Settings → Payment reminders (saved beside the reminder fields), and the
// ledger label "Cancelled · <days>+ days". Keeps server.js's BOM and every
// file's CRLF.
const rep = require('./rep');
const S = 'server.js';

rep(S,
`  db.set('site_settings.payment_reminders', {
    enabled: req.body.enabled === 'on',
    hold_hours: hold,
    auto_cancel: req.body.auto_cancel === 'on'
  }).write();`,
`  db.set('site_settings.payment_reminders', {
    enabled: req.body.enabled === 'on',
    hold_hours: hold,
    auto_cancel: req.body.auto_cancel === 'on',
    // The By game board's cleanup (lib/order-cleanup.js) is saved here too —
    // this object is rewritten whole, so leaving them out would reset them.
    cleanup_enabled: req.body.cleanup_enabled === 'on',
    cleanup_days: orderCleanup.normalizeCleanup({ cleanup_days: req.body.cleanup_days }).days
  }).write();`);

rep(S,
`if (paymentReminderTimer.unref) paymentReminderTimer.unref();
`,
`if (paymentReminderTimer.unref) paymentReminderTimer.unref();

// The By game board's cleanup: unpaid orders and free waiting-list entries with
// no activity for the set number of days (Settings → Payment reminders, on at
// 30 unless switched off) are cancelled — never deleted, never a priority entry
// or an unpaid Quick Add (lib/order-cleanup.js). Its own timer, so a failure
// here never stops the reminders; each cancel is pinned to the state the order
// was read in.
const orderCleanupTimer = setInterval(() => {
  orderCleanup.runCleanup({
    now: new Date(),
    settings: getSiteSettings().payment_reminders,
    listCandidates: () => orders.listByStates(orderCleanup.CANCELLABLE_STATES.slice()),
    cancel: async (order, days) => !!(await orders.transition(order.ref, 'cancelled',
      { cancel_reason: 'stale', stale_days: days }, { from: [order.state] }))
  }).then(r => {
    if (r && r.cancelled) console.log('[order cleanup]', r.cancelled, 'cancelled');
  }).catch(e => console.error('[order cleanup]', e && e.message ? e.message : e));
}, paymentReminders.SWEEP_INTERVAL_MS);
if (orderCleanupTimer.unref) orderCleanupTimer.unref();
`);

const V = 'views/partials/admin/settings.ejs';
rep(V,
`          const prHours = (pr.hold_hours === 0 || pr.hold_hours) ? pr.hold_hours : 24;
`,
`          const prHours = (pr.hold_hours === 0 || pr.hold_hours) ? pr.hold_hours : 24;
          // The By game board's cleanup: on at 30 days unless saved otherwise.
          const prClean = pr.cleanup_enabled !== false;
          const prCleanDays = Number(pr.cleanup_days) || 30;
`);
rep(V,
`          <button type="submit" class="oq-alert-btn" style="margin-top:0.5rem;">Save reminder settings</button>`,
`          <label class="oq-alert-row">
            <input type="checkbox" name="cleanup_enabled" <%= prClean ? 'checked' : '' %>>
            <span>
              <span class="oq-alert-name">Clean up old entries</span>
              <span class="oq-alert-note">Cancels unpaid orders and free waiting-list entries with no activity for this many days. Priority (paid) entries and unpaid Quick Adds are never touched. The records stay in All orders.</span>
            </span>
          </label>
          <label class="pm-field" style="margin-top:0.5rem;">
            <span>Clean up after (days)</span>
            <input type="number" name="cleanup_days" min="7" max="365" step="1" value="<%= prCleanDays %>">
          </label>
          <button type="submit" class="oq-alert-btn" style="margin-top:0.5rem;">Save reminder settings</button>`);

rep('views/partials/admin/orders/ledger.ejs',
`           const stLbl = o.state === 'cancelled' ? (o.slot_given_at ? '✅ Slot given' : 'Cancelled')`,
`           const stLbl = o.state === 'cancelled'
                         ? (o.slot_given_at ? '✅ Slot given'
                           : o.cancel_reason === 'stale' ? 'Cancelled · ' + (o.stale_days || 30) + '+ days'
                           : 'Cancelled')`);

console.log('edited server.js, settings.ejs, ledger.ejs');
````

Run: `node .superpowers/tmp-edits/edit-cleanup-wiring.js` → `edited server.js, settings.ejs, ledger.ejs`.
Then: `file server.js` → still BOM + CRLF.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-order-cleanup-wiring.js && node scripts/test-orders-bulk-cancel.js && node scripts/test-orders-template.js` → `5`, `5`, `42 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add server.js views/partials/admin/settings.ejs views/partials/admin/orders/ledger.ejs scripts/test-order-cleanup-wiring.js
git commit -m "Orders: a 30-day cleanup of old unpaid and free waiting-list entries, switchable in Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Checkboxes, "Select all" and the bar on the board

**Files:**
- Create: `.superpowers/tmp-edits/edit-bulk-template-test.js`, `.superpowers/tmp-edits/edit-bulk-view.js`
- Modify (edit script): `scripts/test-orders-template.js`, `views/partials/admin/orders/needs-you.ejs`, `public/css/style.css`

**Interfaces:**
- Consumes:
  - The route `POST /admin/orders/bulk-cancel` (Task 2).
  - In `needs-you.ejs`: the card loop's `card`, `cardCount` and the waiting loop's `wlPriority`.
  - In `scripts/test-orders-template.js`: `render`, `lo`, `html`, `groupBlock`, `outsideMenus`, `ROOT`.
  - `.superpowers/tmp-edits/rep.js` (Task 2).
- Produces:
  - The checkbox markup `<input type="checkbox" class="oq-pick" name="refs" value="<ref>" form="oqBulkForm" aria-label="Select <ref>">`.
  - The select-all box `<input type="checkbox" class="oq-pick-all">`.
  - `<form id="oqBulkForm" … class="oq-bulk-bar" hidden>` with `#oqBulkN` and `#oqBulkClear`.
  - CSS for all of these.

- [ ] **Step 1: Write the failing checks**

Create `.superpowers/tmp-edits/edit-bulk-template-test.js`:

````js
// Task 4, step 1: Orders tab template checks for "Cancel selected" — a
// checkbox on every follow-up and free waitlist row (never a priority one), a
// "Select all in this card" box, the one bulk form the boxes point at — and the
// new styles. Keeps the file's line endings.
const rep = require('./rep');

rep('scripts/test-orders-template.js',
`console.log('\\nwaitlist: slot given and edit name');`,
`console.log('\\nCancel selected');

const pick = ref => '<input type="checkbox" class="oq-pick" name="refs" value="' + ref + '" form="oqBulkForm" aria-label="Select ' + ref + '">';

ok('a checkbox on every follow-up and free waitlist row, outside the ⋯ menus; none on a priority entry', () => {
  const visible = outsideMenus(groupBlock(html, 'bygame'));
  ['PH-0110', 'PH-0111', 'PH-0120'].forEach(ref => assert.ok(visible.includes(pick(ref)), ref));
  assert.ok(!html.includes('value="PH-0121" form="oqBulkForm"'), 'priority PH-0121 has no checkbox');
});

ok('each card with something to pick has a Select all box; a priority-only card has none', () => {
  const board = groupBlock(html, 'bygame');
  const all = '<label class="oq-pick-all-row"><input type="checkbox" class="oq-pick-all"> Select all in this card</label>';
  assert.strictEqual(board.split(all).length - 1, 2, 'one per card');
  const onlyPriority = render({ abandonedOrders: [], waitlistOrders: [lo('PH-0122', 'reserved', { game_id: 5, fb_name: 'Ivo Paz', queuePosition: 1 })] });
  assert.ok(!onlyPriority.includes('oq-pick'));
});

ok('one bulk form, hidden until something is ticked, after the board; no board means no form', () => {
  const form = '<form id="oqBulkForm" method="POST" action="/admin/orders/bulk-cancel" class="oq-bulk-bar" hidden>';
  assert.strictEqual(html.split(form).length - 1, 1);
  assert.ok(html.indexOf(form) > html.indexOf('data-oq-group="bygame"'));
  assert.ok(html.includes('<span class="oq-bulk-n" id="oqBulkN">0 selected</span>'));
  assert.ok(html.includes('<button type="submit" class="oq-bulk-go">🚫 Cancel selected</button>'));
  assert.ok(html.includes('<button type="button" class="oq-bulk-clear" id="oqBulkClear">Clear</button>'));
  assert.ok(!render({ waitlistOrders: [], abandonedOrders: [] }).includes('oqBulkForm'));
});

ok('the bar and the boxes are styled, in light mode too', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  ['.oq-pick {', '.oq-pick-all-row {', '.oq-bulk-bar {', '.oq-bulk-bar[hidden] {', '.oq-bulk-go {', '.oq-bulk-clear {',
   'body.light-mode .oq-bulk-bar {'].forEach(s => assert.ok(css.includes(s), s));
});

console.log('\\nwaitlist: slot given and edit name');`);

console.log('edited test-orders-template.js');
````

Run: `node .superpowers/tmp-edits/edit-bulk-template-test.js` → `edited test-orders-template.js`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-orders-template.js` → FAIL `AssertionError [ERR_ASSERTION]: PH-0110` (no checkboxes yet).

- [ ] **Step 3: The markup and its styles**

Create `.superpowers/tmp-edits/edit-bulk-view.js`:

````js
// Task 4: "Cancel selected" markup on the By game board — a checkbox on every
// follow-up and free waitlist row, a "Select all in this card" box, and the
// one bulk form (shown as a bar) the boxes point at — and its styles. Keeps
// each file's CRLF.
const rep = require('./rep');
const N = 'views/partials/admin/orders/needs-you.ejs';

rep(N,
`    ].filter(Boolean).join(' · ');
  %>
  <details class="oq-card`,
`    ].filter(Boolean).join(' · ');
    // A ⭐ priority entry is never cancelled in bulk, so it gets no checkbox.
    const cardPickable = card.followUps.length + card.waiting.filter(o => o.state !== 'reserved').length;
  %>
  <details class="oq-card`);

rep(N,
`    <div class="oq-card-body">
  <% if (card.waiting.length) { %>`,
`    <div class="oq-card-body">
  <% if (cardPickable) { %>
  <label class="oq-pick-all-row"><input type="checkbox" class="oq-pick-all"> Select all in this card</label>
  <% } %>
  <% if (card.waiting.length) { %>`);

rep(N,
`            counted toward anyone's position. %>
        <span class="oq-wl-pos">`,
`            counted toward anyone's position. %>
        <% if (!wlPriority) { %><input type="checkbox" class="oq-pick" name="refs" value="<%= o.ref %>" form="oqBulkForm" aria-label="Select <%= o.ref %>"><% } %>
        <span class="oq-wl-pos">`);

rep(N,
`  <div class="oq-row oq-row-follow">
    <div class="oq-main">
      <div class="oq-top">
        <span class="oq-ref"><%= o.ref %></span>`,
`  <div class="oq-row oq-row-follow">
    <div class="oq-main">
      <div class="oq-top">
        <input type="checkbox" class="oq-pick" name="refs" value="<%= o.ref %>" form="oqBulkForm" aria-label="Select <%= o.ref %>">
        <span class="oq-ref"><%= o.ref %></span>`);

rep(N,
`  <% } %>
    </div>
  </details>
  <% }) %>
</details>
<% } %>`,
`  <% } %>
    </div>
  </details>
  <% }) %>
</details>
<%# "Cancel selected": every checkbox above points here with form="oqBulkForm",
    so no form sits inside another. public/js/admin-orders.js shows this bar
    once something is ticked, keeps its count and asks before it submits. %>
<form id="oqBulkForm" method="POST" action="/admin/orders/bulk-cancel" class="oq-bulk-bar" hidden>
  <span class="oq-bulk-n" id="oqBulkN">0 selected</span>
  <button type="submit" class="oq-bulk-go">🚫 Cancel selected</button>
  <button type="button" class="oq-bulk-clear" id="oqBulkClear">Clear</button>
</form>
<% } %>`);

rep('public/css/style.css',
`.oq-row-follow { border-left: 3px solid #f59e0b; }
`,
`.oq-row-follow { border-left: 3px solid #f59e0b; }
/* Cancel selected: row checkboxes, a select-all per card, and the bar. */
.oq-pick { width: 1rem; height: 1rem; margin: 0 0.15rem 0 0; accent-color: var(--ps-blue); cursor: pointer; flex-shrink: 0; }
.oq-pick-all-row { display: flex; align-items: center; gap: 0.45rem; font-size: 0.75rem; font-weight: 700; color: #888; margin: 0.15rem 0.15rem 0.55rem; cursor: pointer; width: fit-content; }
.oq-pick-all { width: 1rem; height: 1rem; accent-color: var(--ps-blue); cursor: pointer; }
.oq-bulk-bar { position: fixed; left: 50%; bottom: 1rem; transform: translateX(-50%); z-index: 60; display: flex; align-items: center; gap: 0.6rem; background: #151515; border: 1px solid #333; border-radius: 14px; padding: 0.6rem 0.75rem 0.6rem 1rem; box-shadow: 0 12px 32px rgba(0,0,0,0.55); max-width: calc(100vw - 1.5rem); }
.oq-bulk-bar[hidden] { display: none; }
.oq-bulk-n { font-weight: 800; font-size: 0.85rem; color: #eee; white-space: nowrap; }
.oq-bulk-go { background: #ef4444; color: #fff; border: 0; border-radius: 9px; padding: 0.5rem 0.9rem; font-weight: 800; font-size: 0.8rem; cursor: pointer; font-family: inherit; white-space: nowrap; }
.oq-bulk-clear { background: transparent; color: #bbb; border: 1px solid #333; border-radius: 9px; padding: 0.45rem 0.8rem; font-weight: 700; font-size: 0.78rem; cursor: pointer; font-family: inherit; }
body.light-mode .oq-bulk-bar { background: #fff; border-color: #ddd; box-shadow: 0 12px 32px rgba(0,0,0,0.15); }
body.light-mode .oq-bulk-n { color: #111; }
body.light-mode .oq-bulk-clear { color: #444; border-color: #ccc; }
body.light-mode .oq-pick-all-row { color: #555; }
`);

console.log('edited needs-you.ejs, style.css');
````

Run: `node .superpowers/tmp-edits/edit-bulk-view.js` → `edited needs-you.ejs, style.css`.

- [ ] **Step 4: Run them and watch them pass**

Run: `node scripts/test-orders-template.js` → `46 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add views/partials/admin/orders/needs-you.ejs public/css/style.css scripts/test-orders-template.js
git commit -m "Orders: checkboxes, Select all and a Cancel selected bar on the By game board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The bar follows the ticks

**Files:**
- Create: `.superpowers/tmp-edits/edit-bulk-js-test.js`, `.superpowers/tmp-edits/edit-bulk-js.js`
- Modify (edit script): `scripts/test-admin-orders-filter.js`, `public/js/admin-orders.js`

**Interfaces:**
- Consumes: the markup from Task 4 (`input.oq-pick`, `input.oq-pick-all`, `#oqBulkForm`, `#oqBulkN`, `#oqBulkClear`, `details[data-oq-card]`); `toArray` in `admin-orders.js`; `.superpowers/tmp-edits/rep.js` (Task 2).
- Produces:
  - `window.__oqFilter.bulkLabel(n)` and `bulkConfirm(n)`.
  - `initBulk()`, called from `init()`.

- [ ] **Step 1: Write the failing tests**

Create `.superpowers/tmp-edits/edit-bulk-js-test.js`:

````js
// Task 5, step 1: tests for the "Cancel selected" wording in
// public/js/admin-orders.js — the bar's count and the confirm prompt.
// Keeps the file's line endings.
const rep = require('./rep');

rep('scripts/test-admin-orders-filter.js',
`console.log('\\nwiring');`,
`console.log('\\nCancel selected');

ok('the bar counts what is ticked', () => {
  assert.strictEqual(F.bulkLabel(0), '0 selected');
  assert.strictEqual(F.bulkLabel(3), '3 selected');
});

ok('the confirm names how many and says the records stay', () => {
  assert.strictEqual(F.bulkConfirm(1), 'Cancel 1 selected order?\\n\\nThey leave the board; the records stay in All orders.');
  assert.strictEqual(F.bulkConfirm(3), 'Cancel 3 selected orders?\\n\\nThey leave the board; the records stay in All orders.');
});

console.log('\\nwiring');`);

console.log('edited test-admin-orders-filter.js');
````

Run: `node .superpowers/tmp-edits/edit-bulk-js-test.js` → `edited test-admin-orders-filter.js`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-admin-orders-filter.js` → FAIL `TypeError: F.bulkLabel is not a function`.

- [ ] **Step 3: The behaviour**

Create `.superpowers/tmp-edits/edit-bulk-js.js`:

````js
// Task 5: public/js/admin-orders.js drives "Cancel selected" — the bar shows
// once something is ticked and counts it, each card's "Select all" ticks or
// clears that card, Clear unticks everything, and submitting asks first.
// Keeps the file's line endings.
const rep = require('./rep');
const J = 'public/js/admin-orders.js';

rep(J,
`  window.__oqFilter = {`,
`  // "Cancel selected" on the By game board: the bar's count and the question
  // asked before anything is cancelled.
  function bulkLabel(n) {
    return n + ' selected';
  }

  function bulkConfirm(n) {
    return 'Cancel ' + n + ' selected order' + (n === 1 ? '' : 's') +
      '?\\n\\nThey leave the board; the records stay in All orders.';
  }

  window.__oqFilter = {`);

rep(J,
`    normalizeCards: normalizeCards
  };`,
`    normalizeCards: normalizeCards,
    bulkLabel: bulkLabel,
    bulkConfirm: bulkConfirm
  };`);

rep(J,
`  // Each By game card re-opens or folds the way the owner last left it; a`,
`  // "Cancel selected": the row checkboxes all belong to #oqBulkForm (their
  // form attribute), so ticking them is all the form needs. This keeps the bar,
  // its count and each card's "Select all" box in step with the ticks.
  function initBulk() {
    var form = document.getElementById('oqBulkForm');
    if (!form) return;
    var label = document.getElementById('oqBulkN');
    function picks(root) { return toArray((root || document).querySelectorAll('input.oq-pick')); }
    function ticked() { return picks().filter(function (p) { return p.checked; }).length; }
    function update() {
      var n = ticked();
      form.hidden = n === 0;
      if (label) label.textContent = bulkLabel(n);
      toArray(document.querySelectorAll('details[data-oq-card]')).forEach(function (card) {
        var all = card.querySelector('input.oq-pick-all');
        if (!all) return;
        var mine = picks(card);
        var on = mine.filter(function (p) { return p.checked; }).length;
        all.checked = mine.length > 0 && on === mine.length;
        all.indeterminate = on > 0 && on < mine.length;
      });
    }
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.classList) return;
      if (t.classList.contains('oq-pick-all')) {
        var card = t.closest('details[data-oq-card]');
        if (card) picks(card).forEach(function (p) { p.checked = t.checked; });
      }
      if (t.classList.contains('oq-pick') || t.classList.contains('oq-pick-all')) update();
    });
    var clear = document.getElementById('oqBulkClear');
    if (clear) {
      clear.addEventListener('click', function () {
        picks().forEach(function (p) { p.checked = false; });
        update();
      });
    }
    form.addEventListener('submit', function (e) {
      var n = ticked();
      if (!n || !window.confirm(bulkConfirm(n))) e.preventDefault();
    });
    // A reload can bring ticks back; show the bar for them.
    update();
  }

  // Each By game card re-opens or folds the way the owner last left it; a`);

rep(J,
`    initCards();
    initLedger();`,
`    initCards();
    initBulk();
    initLedger();`);

console.log('edited admin-orders.js');
````

Run: `node .superpowers/tmp-edits/edit-bulk-js.js` → `edited admin-orders.js`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-admin-orders-filter.js` → `26 assertions passed`.
Run the whole suite: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"` → only `FAIL scripts/test-upcoming-psn-page-public.js`, `failed: 1`.

- [ ] **Step 5: Commit and clean up**

```bash
git add public/js/admin-orders.js scripts/test-admin-orders-filter.js
git commit -m "Orders: the Cancel selected bar follows the ticks and asks before cancelling

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
