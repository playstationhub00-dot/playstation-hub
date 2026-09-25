# Admin Orders Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the admin Orders tab from ten stacked blocks to three — an indicator strip, one grouped "Needs You" section, and the All Orders ledger with a new Type filter — with quieter rows, persisted filters, and a phone layout.

**Architecture:** `views/partials/order-queue.ejs` (585 lines) is replaced by three focused partials under `views/partials/admin/orders/` that read the same server locals as today. Its inline `<script>` moves to a new `public/js/admin-orders.js`, which exposes its pure filter logic as `window.__oqFilter` for tests. The `oq-*` CSS region in `public/css/style.css` is replaced in one marker-based splice. No server route or server-side list changes.

**Tech Stack:** Node/Express 4, EJS, vanilla browser JS, plain CSS. Tests are plain `node scripts/test-*.js` files using `assert` (no runner). Orders live in the production MongoDB.

**Spec:** `docs/superpowers/specs/2026-09-25-admin-orders-redesign-design.md`

## Global Constraints

- No change to `server.js`, any POST route, its URL, field names, or redirect. Every `onsubmit` confirm prompt is copied **byte-for-byte** from `views/partials/order-queue.ejs`.
- Needs You headline count = `orderQueue.length + refundsOwed.length`. The sidebar Orders badge shows the same number.
- Group keys and defaults: `now` (Do now, open), `refunds` (Refunds owed, open), `followups` (Follow-ups, collapsed), `waitlist` (Waitlist, collapsed). A group with zero rows is not rendered.
- Ledger chip groups (unchanged rule): `cancelled` if state `cancelled`; `unpaid` if `awaiting_payment`/`payment_rejected`; `out` if `awaiting_qr`/`qr_pending`/`active`/`awaiting_return`/`verifying_return`; otherwise `paid`. Chip counts are computed from the loaded ledger rows.
- Order type: `reservation` if `is_reservation`; else `purchase` if `is_buy`; else `rental`.
- Storage: ledger filters in `sessionStorage` key `oqLedger` (`{ chip, type, q }`); group open state in `localStorage` key `oqGroups`. Every storage access wrapped in `try/catch`.
- The `.oq-timer` countdown loop and `.oq-ab-age` formatter run **page-wide** (the dashboard overview's `.oq-timer` depends on it).
- CSS rules that must survive untouched: `.oq-alert-*`, `.oq-count`, `.oq-wl-pos` (outside the replaced region), and `.oq-timer`/`.oq-timer-dead`.
- `public/css/style.css` is CRLF; `server.js` is not edited at all.
- New script tag: `<script src="/js/admin-orders.js?v=<%= assetV %>"></script>`.
- Phone breakpoint: `@media (max-width: 640px)`.
- Never log into the real admin and never touch real orders: the browser check renders fixture orders into a local static page.
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Work directly on `main`. Do not push unless the user asks.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `public/js/admin-orders.js` | Create | `window.__oqFilter` pure logic; page-wide timers/ages; ledger filters; group memory; Payment link button |
| `scripts/test-admin-orders-filter.js` | Create | `vm`-sandbox tests of the pure logic + wiring checks |
| `views/partials/admin/orders/strip.ejs` | Create | Quick Add button, Online pill, gateway pill (+ broken warning), Export link |
| `views/partials/admin/orders/needs-you.ejs` | Create | Headline + the four groups and their rows / ⋯ menus |
| `views/partials/admin/orders/ledger.ejs` | Create | Ledger header, toolbar, chips, table, empty/no-match states |
| `views/partials/admin/orders.ejs` | Rewrite | Includes the three partials |
| `views/partials/order-queue.ejs` | Delete | Replaced by the three partials |
| `scripts/test-orders-template.js` | Create | Renders `orders.ejs` with fixtures and checks structure, forms, counts, CSS coverage |
| `views/admin.ejs` | Modify | Sidebar badge count; script tag |
| `views/partials/admin/notif-bell.ejs` | Modify | Two comments that name `order-queue.ejs` |
| `public/css/style.css` | Modify | Replace the orders `oq-*` region |

---

### Task 1: Pure filter logic — `public/js/admin-orders.js`

**Files:**
- Create: `public/js/admin-orders.js`
- Test: `scripts/test-admin-orders-filter.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `window.__oqFilter = { normalizeLedgerState, orderType, rowMatches, isFiltering, normalizeGroups }`
  - `normalizeLedgerState(raw) → { chip: 'all'|'out'|'paid'|'unpaid'|'cancelled', type: 'all'|'rental'|'purchase'|'reservation', q: string (≤100 chars) }`
  - `orderType(order) → 'rental'|'purchase'|'reservation'`
  - `rowMatches({ g, t, s }, state) → boolean` (`s` is a lower-case haystack)
  - `isFiltering(state) → boolean`
  - `normalizeGroups(raw) → { [key in 'now'|'refunds'|'followups'|'waitlist']?: boolean }`
- The IIFE's shared scope also holds `CHIPS`, `TYPES`, `GROUP_KEYS`, `LEDGER_KEY`, `GROUPS_KEY` for Task 3. The file ends with `})();`; Task 3 inserts the DOM wiring immediately before that line.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-admin-orders-filter.js`:

```js
// Run: node scripts/test-admin-orders-filter.js
//
// The Orders tab's ledger filters and group memory run in the browser. This
// loads the real public/js/admin-orders.js into a sandbox with no DOM (its
// page wiring is skipped when there is no document) and checks the rules it
// exposes on window.__oqFilter.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const FILE = path.join(__dirname, '..', 'public', 'js', 'admin-orders.js');

function load() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox);
  assert.ok(sandbox.__oqFilter, 'admin-orders.js exposes window.__oqFilter');
  return sandbox.__oqFilter;
}

const F = load();
// Objects made inside the sandbox have another realm's prototypes, so compare
// plain JSON copies rather than the objects themselves.
const plain = o => JSON.parse(JSON.stringify(o));
const st = over => F.normalizeLedgerState(Object.assign({}, over));
const row = (g, t, s) => ({ g, t, s: s || '' });

console.log('\nnormalizeLedgerState()');

ok('defaults to every chip, every type, no search', () => {
  assert.deepStrictEqual(plain(F.normalizeLedgerState(null)), { chip: 'all', type: 'all', q: '' });
});

ok('throws away values it does not recognise', () => {
  assert.deepStrictEqual(plain(F.normalizeLedgerState({ chip: 'lost', type: 'lease', q: 7 })),
    { chip: 'all', type: 'all', q: '' });
});

ok('keeps valid values and caps the search at 100 characters', () => {
  const s = F.normalizeLedgerState({ chip: 'out', type: 'purchase', q: 'x'.repeat(150) });
  assert.strictEqual(s.chip, 'out');
  assert.strictEqual(s.type, 'purchase');
  assert.strictEqual(s.q.length, 100);
});

console.log('\norderType()');

ok('a plain order is a rental', () => {
  assert.strictEqual(F.orderType({ state: 'active' }), 'rental');
});

ok('is_buy is a purchase', () => {
  assert.strictEqual(F.orderType({ is_buy: true }), 'purchase');
});

ok('a priority reservation is a reservation', () => {
  assert.strictEqual(F.orderType({ is_reservation: true }), 'reservation');
});

ok('a Coming Soon pre-order (is_buy AND is_reservation) is a reservation, not a purchase', () => {
  assert.strictEqual(F.orderType({ is_buy: true, is_reservation: true, upcoming_game_id: 9 }), 'reservation');
});

ok('a missing order is a rental rather than a crash', () => {
  assert.strictEqual(F.orderType(null), 'rental');
});

console.log('\nrowMatches()');

ok('the All chip matches every group', () => {
  ['out', 'paid', 'unpaid', 'cancelled'].forEach(g => assert.ok(F.rowMatches(row(g, 'rental'), st({})), g));
});

ok('a chip matches only its own group', () => {
  assert.ok(F.rowMatches(row('out', 'rental'), st({ chip: 'out' })));
  assert.ok(!F.rowMatches(row('paid', 'rental'), st({ chip: 'out' })));
});

ok('type narrows to one kind of order', () => {
  assert.ok(F.rowMatches(row('paid', 'purchase'), st({ type: 'purchase' })));
  assert.ok(!F.rowMatches(row('paid', 'rental'), st({ type: 'purchase' })));
});

ok('search is case-insensitive and ignores surrounding spaces', () => {
  const r = row('out', 'rental', 'ph-0171 nash diaz ufc 6');
  assert.ok(F.rowMatches(r, st({ q: '  NASH ' })));
  assert.ok(!F.rowMatches(r, st({ q: 'tekken' })));
});

ok('chip, type and search combine', () => {
  const f = st({ chip: 'paid', type: 'purchase', q: 'nba' });
  assert.ok(F.rowMatches(row('paid', 'purchase', 'ph-0164 eugen nba2k27'), f));
  assert.ok(!F.rowMatches(row('out', 'purchase', 'ph-0164 eugen nba2k27'), f));
  assert.ok(!F.rowMatches(row('paid', 'rental', 'ph-0164 eugen nba2k27'), f));
  assert.ok(!F.rowMatches(row('paid', 'purchase', 'ph-0170 cairus wolverine'), f));
});

console.log('\nisFiltering()');

ok('true for any chip, type or non-blank search; false for defaults and whitespace', () => {
  assert.strictEqual(F.isFiltering(st({})), false);
  assert.strictEqual(F.isFiltering(st({ q: '   ' })), false);
  assert.strictEqual(F.isFiltering(st({ chip: 'out' })), true);
  assert.strictEqual(F.isFiltering(st({ type: 'rental' })), true);
  assert.strictEqual(F.isFiltering(st({ q: 'nba' })), true);
});

console.log('\nnormalizeGroups()');

ok('keeps only known groups with boolean values', () => {
  assert.deepStrictEqual(plain(F.normalizeGroups({ now: false, waitlist: true, followups: 'yes', bogus: true })),
    { now: false, waitlist: true });
});

ok('anything that is not an object is an empty object', () => {
  assert.deepStrictEqual(plain(F.normalizeGroups('x')), {});
  assert.deepStrictEqual(plain(F.normalizeGroups(null)), {});
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-admin-orders-filter.js`
Expected: FAIL — `ENOENT: no such file or directory` for `public/js/admin-orders.js`.

- [ ] **Step 3: Write the implementation**

Create `public/js/admin-orders.js`:

```js
// Admin → Orders tab: ledger filters (status chip, type, search) that persist
// for the session, Needs You group open/closed memory, the QR countdowns and
// "x ago" ages, and the Payment link button. Loaded on the admin page; the
// page wiring is skipped when there is no document (the test sandbox).
(function () {
  'use strict';

  var CHIPS = ['all', 'out', 'paid', 'unpaid', 'cancelled'];
  var TYPES = ['all', 'rental', 'purchase', 'reservation'];
  var GROUP_KEYS = ['now', 'refunds', 'followups', 'waitlist'];
  var LEDGER_KEY = 'oqLedger';
  var GROUPS_KEY = 'oqGroups';

  // Anything read back from storage is untrusted: unknown values fall back to
  // defaults rather than filtering the ledger down to nothing.
  function normalizeLedgerState(raw) {
    var r = raw || {};
    return {
      chip: CHIPS.indexOf(r.chip) !== -1 ? r.chip : 'all',
      type: TYPES.indexOf(r.type) !== -1 ? r.type : 'all',
      q: typeof r.q === 'string' ? r.q.slice(0, 100) : ''
    };
  }

  // A Coming Soon pre-order carries both is_buy and is_reservation; it is a
  // reservation first. views/partials/admin/orders/ledger.ejs applies the same
  // rule when it writes each row's data-t.
  function orderType(order) {
    var o = order || {};
    if (o.is_reservation) return 'reservation';
    if (o.is_buy) return 'purchase';
    return 'rental';
  }

  function rowMatches(row, state) {
    if (state.chip !== 'all' && row.g !== state.chip) return false;
    if (state.type !== 'all' && row.t !== state.type) return false;
    var q = String(state.q || '').trim().toLowerCase();
    return !q || row.s.indexOf(q) !== -1;
  }

  function isFiltering(state) {
    return state.chip !== 'all' || state.type !== 'all' || String(state.q || '').trim() !== '';
  }

  function normalizeGroups(raw) {
    var out = {};
    if (raw && typeof raw === 'object') {
      GROUP_KEYS.forEach(function (k) {
        if (typeof raw[k] === 'boolean') out[k] = raw[k];
      });
    }
    return out;
  }

  window.__oqFilter = {
    normalizeLedgerState: normalizeLedgerState,
    orderType: orderType,
    rowMatches: rowMatches,
    isFiltering: isFiltering,
    normalizeGroups: normalizeGroups
  };
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-admin-orders-filter.js`
Expected: every line `ok - …`, ending `16 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add public/js/admin-orders.js scripts/test-admin-orders-filter.js
git commit -m "$(cat <<'EOF'
Add Orders tab filter rules (chip, type, search, group memory) with tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Split and rebuild the templates

**Files:**
- Create: `views/partials/admin/orders/strip.ejs`, `views/partials/admin/orders/needs-you.ejs`, `views/partials/admin/orders/ledger.ejs`
- Rewrite: `views/partials/admin/orders.ejs`
- Delete: `views/partials/order-queue.ejs`
- Modify: `views/admin.ejs` (sidebar badge only)
- Test: `scripts/test-orders-template.js`

**Interfaces:**
- Consumes: server locals already passed to `admin.ejs` (unchanged): `orderQueue`, `refundsOwed`, `abandonedOrders`, `waitlistOrders`, `ledgerGroups`, `ledgerStats`, `orderPeriod`, `orderPeriods`, `orderYears`, `abandonedCount`, `startedCount`, `orderStartRate`, `paymongoMode`, `paymongoHealth`, `settings`; plus `process.env.PAYMONGO_SECRET_KEY`.
- Produces, for Task 3 (do not rename):
  - Groups: `details.oq-group[data-oq-group="now|refunds|followups|waitlist"]`, `now`/`refunds` rendered with `open`.
  - Rows: `.oq-row`; ⋯ menus: `details.oq-more` > `summary.oq-more-btn` + `.oq-more-menu`.
  - Timers: `span.oq-timer[data-expires]`; ages: `span.oq-ab-age[data-created]`; Payment link: `button.oq-paylink[data-ref]`; copy buttons: `.rem-copy[data-msg]` (handled by the existing global listener in `views/partials/admin/customers.ejs`).
  - Ledger: `#oqSearch`, `#oqType` (`data-ss-skip`), chips `button.oq-chip[data-g="all|out|paid|unpaid|cancelled"]` (the `all` chip starts with `oq-chip-on`), wrapper `#oqLedgerWrap`, table `#oqLedger` with month rows `tr.oq-grp` and order rows `tr.oq-lr[data-g][data-t][data-s]`, no-match `#oqNoMatch` (starts `hidden`) containing `a[data-oq-clear]`.
  - No inline `onclick`/`oninput` handlers on chips or search, and no `<script>` in any of the three partials.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-orders-template.js`:

```js
// Run: node scripts/test-orders-template.js
//
// Renders views/partials/admin/orders.ejs (which includes the three partials
// under views/partials/admin/orders/) with fixture locals, and checks the
// structure the Orders tab and public/js/admin-orders.js rely on: groups and
// their defaults, every existing POST form and confirm prompt, which actions
// sit behind the ⋯ menu, the gateway pill states, and the ledger counts.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'views', 'partials', 'admin', 'orders.ejs');

const lo = (ref, state, extra) => Object.assign({
  ref, state, created_at: '2026-09-15T00:00:00Z', game_title: 'Tekken 8', account_type: 'nt',
  days: 30, amount_due: 349, deposit_due: 0, fb_name: 'Test Person', start_date: '2026-09-15', end_date: '2026-10-15'
}, extra || {});

function fixture(over) {
  const ledgerOrders = [
    lo('PH-0201', 'active'),
    lo('PH-0202', 'closed', { is_buy: true }),
    lo('PH-0203', 'reserved', { is_reservation: true, is_buy: true, upcoming_game_id: 9 }),
    lo('PH-0204', 'awaiting_payment'),
    lo('PH-0205', 'cancelled'),
    lo('PH-0206', 'awaiting_return', { deposit_due: 100 })
  ];
  return Object.assign({
    orderQueue: [
      lo('PH-0101', 'verifying_payment', { created_at: '2026-09-20T01:00:00Z', fb_name: 'Ana Cruz', payment_method: 'gcash', payment_proof: '/uploads/r.png' }),
      lo('PH-0102', 'qr_pending', { created_at: '2026-09-22T01:00:00Z', qr_expires_at: '2026-09-25T10:00:00Z', qr_code: 'ABCD-EFGH', fb_name: 'Ben Reyes', account_type: 'tr', days: 7, deposit_due: 100, psid: '123' }),
      lo('PH-0103', 'verifying_return', { created_at: '2026-09-21T01:00:00Z', return_proof: '/uploads/p.png', fb_name: 'Cai Lim' })
    ],
    refundsOwed: [lo('PH-0090', 'closed', { deposit_due: 100, fb_name: 'Dee Santos', game_title: 'Hogwarts Legacy' })],
    abandonedOrders: [
      lo('PH-0110', 'awaiting_payment', { created_at: '2026-09-20T00:00:00Z', fb_name: 'Eli Tan' }),
      lo('PH-0111', 'payment_rejected', { created_at: '2026-09-24T00:00:00Z', fb_name: 'Fay Ong', account_type: 'tr', days: 7, deposit_due: 100, psid: '456' })
    ],
    waitlistOrders: [
      lo('PH-0120', 'waitlisted', { game_id: 5, created_at: '2026-09-10T00:00:00Z', fb_name: 'Gio Yu', queuePosition: 2 }),
      lo('PH-0121', 'reserved', { game_id: 5, created_at: '2026-09-15T00:00:00Z', fb_name: 'Hana Go', queuePosition: 1, upgraded_from_waitlist: true })
    ],
    ledgerGroups: [{ key: '2026-09', label: '2026-09', paidCount: 4, paidTotal: 1234, orders: ledgerOrders }],
    // `out: 99` is deliberately not the in-period count: the Out on rent chip
    // must count its own rows, not this live all-orders total.
    ledgerStats: { needsYou: 3, qrLive: 1, out: 99, paidCount: 4, paidTotal: 1234, unpaid: 1, cancelled: 1, total: 6 },
    orderPeriod: '',
    orderPeriods: ['2026-09', '2026-08'],
    orderYears: ['2026'],
    abandonedCount: 2,
    startedCount: 5,
    orderStartRate: 12,
    paymongoMode: 'live',
    paymongoHealth: { ok_count: 9, fail_count: 0, last_ok_at: '2026-09-20T03:23:00Z' },
    settings: { owner_online: true, payment_methods: [{ key: 'gcash', label: 'GCash', enabled: true }] }
  }, over || {});
}

function render(over) {
  return ejs.render(fs.readFileSync(FILE, 'utf8'), fixture(over), { filename: FILE });
}

// The Needs You markup for one group: from its data-oq-group attribute up to
// the next group or the ledger heading. Rows contain their own <details> ⋯
// menus, so "up to the first </details>" would cut a group short.
function groupBlock(html, key) {
  const start = html.indexOf('data-oq-group="' + key + '"');
  if (start < 0) return '';
  const ends = ['data-oq-group="', 'oq-ledger-h'].map(m => html.indexOf(m, start + 10)).filter(i => i > 0);
  return html.slice(start, ends.length ? Math.min(...ends) : undefined);
}
const refsIn = s => [...s.matchAll(/class="oq-ref">(PH-\d+)</g)].map(m => m[1]);
const needsYouPart = html => html.slice(0, html.indexOf('oq-ledger-h'));
const menus = s => [...s.matchAll(/<details class="oq-more">([\s\S]*?)<\/details>/g)].map(m => m[1]).join('\n');
const outsideMenus = s => s.replace(/<details class="oq-more">[\s\S]*?<\/details>/g, '');

const html = render();

console.log('\nNeeds You');

ok('headline counts Do now + Refunds only', () => {
  assert.ok(/Needs you <span class="oq-zone-n">4<\/span>/.test(html), 'expected 3 + 1 = 4');
});

ok('Do now: live QR first, then oldest first', () => {
  assert.deepStrictEqual(refsIn(groupBlock(html, 'now')), ['PH-0102', 'PH-0101', 'PH-0103']);
});

ok('Follow-ups newest first; Waitlist priority first', () => {
  assert.deepStrictEqual(refsIn(groupBlock(html, 'followups')), ['PH-0111', 'PH-0110']);
  assert.deepStrictEqual(refsIn(groupBlock(html, 'waitlist')), ['PH-0121', 'PH-0120']);
});

ok('Do now and Refunds start open; Follow-ups and Waitlist start collapsed', () => {
  assert.ok(html.includes('data-oq-group="now" open>'));
  assert.ok(html.includes('data-oq-group="refunds" open>'));
  assert.ok(html.includes('data-oq-group="followups">'));
  assert.ok(html.includes('data-oq-group="waitlist">'));
});

ok('the Follow-ups heading carries the weekly funnel line', () => {
  assert.ok(groupBlock(html, 'followups').includes('2 of 5 started this week · 12% of game views'));
});

ok('the QR countdown and the ages are still rendered for the script to tick', () => {
  assert.ok(html.includes('class="oq-timer" data-expires="2026-09-25T10:00:00Z"'));
  assert.ok(html.includes('class="oq-ab-age" data-created="2026-09-24T00:00:00Z"'));
});

ok('an empty group is not rendered at all', () => {
  const noRefunds = render({ refundsOwed: [] });
  assert.ok(!noRefunds.includes('data-oq-group="refunds"'));
  assert.ok(/Needs you <span class="oq-zone-n">3<\/span>/.test(noRefunds));
});

ok('everything empty: one quiet line and no groups', () => {
  const empty = render({ orderQueue: [], refundsOwed: [], abandonedOrders: [], waitlistOrders: [], ledgerGroups: [] });
  assert.ok(empty.includes('Nothing waiting on you right now.'));
  assert.ok(!empty.includes('data-oq-group='));
  assert.ok(empty.includes('No orders in this period.'));
});

console.log('\nactions and confirm prompts');

ok('every existing POST form is still present', () => {
  ['/admin/orders/PH-0101/advance', '/admin/orders/PH-0101/reject', '/admin/orders/PH-0101/delete',
   '/admin/orders/PH-0090/refunded', '/admin/orders/PH-0110/mark-paid', '/admin/orders/PH-0110/cancel',
   '/admin/orders/PH-0120/priority-paid', '/admin/orders/PH-0121/undo-priority', '/admin/online',
   '/admin/orders/PH-0201/delete'].forEach(a => assert.ok(html.includes('action="' + a + '"'), a));
  assert.ok(html.includes('name="operiod"'));
});

ok('confirm prompts are byte-for-byte the old ones', () => {
  const R = r => '&#34;' + r + '&#34;';
  [
    "return confirm('Permanently delete order ' + " + R('PH-0101') + " + '? Its customer record and money go too. This cannot be undone.');",
    "return confirm('Mark order ' + " + R('PH-0110') + " + ' as paid? Use this when the customer paid outside the site (e.g. Messenger). They\\'ll still need to send their sign-in QR.');",
    "return confirm('Cancel order ' + " + R('PH-0110') + " + '? The customer said no or never followed up. The record is kept, unlike Delete.');",
    "return confirm('Delete order ' + " + R('PH-0110') + " + '? Its customer record and money go too. Use this to clear out duplicate or accidental orders. This cannot be undone.');",
    "return confirm('Mark ' + " + R('PH-0120') + " + ' as priority paid?\\n\\nUse this when they sent the ₱100 outside the site. They move above everyone on a free entry, and the rest of the rent is still owed when a slot opens.');",
    "return confirm('Remove ' + " + R('PH-0120') + " + ' from the waiting list?');",
    "return confirm('Undo priority for ' + " + R('PH-0121') + " + '?\\n\\nThey go back to a free waiting-list entry, keeping their reference and their place in line. Use this if the ₱100 never actually arrived.');",
    "return confirm('Delete order ' + " + R('PH-0201') + " + '? Its customer record and money go too. Use this to clear out test orders or accidental duplicates. This cannot be undone.');"
  ].forEach(p => assert.ok(html.includes('onsubmit="' + p + '"'), p.slice(0, 60)));
});

ok('rare and destructive actions sit behind the ⋯ menu', () => {
  const inMenus = menus(needsYouPart(html));
  ['/PH-0101/reject', '/PH-0101/delete', '/PH-0110/cancel', '/PH-0110/delete', '/PH-0120/cancel', '/PH-0121/undo-priority']
    .forEach(a => assert.ok(inMenus.includes(a), a + ' should be in a ⋯ menu'));
});

ok('main actions stay visible, outside any menu', () => {
  const visible = outsideMenus(needsYouPart(html));
  ['/PH-0101/advance', '/PH-0090/refunded', '/PH-0110/mark-paid', '/PH-0120/priority-paid']
    .forEach(a => assert.ok(visible.includes(a), a + ' should be visible'));
  ['/reject', '/cancel', '/delete', '/undo-priority']
    .forEach(a => assert.ok(!visible.includes(a), a + ' should not be visible outside a menu'));
});

ok('Payment link appears only when a PayMongo key is configured', () => {
  const saved = process.env.PAYMONGO_SECRET_KEY;
  try {
    delete process.env.PAYMONGO_SECRET_KEY;
    assert.ok(!render().includes('oq-paylink'));
    process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
    const withKey = render();
    assert.ok(withKey.includes('class="oq-more-item oq-paylink" data-ref="PH-0110"'));
    assert.ok(menus(withKey).includes('oq-paylink'), 'inside the ⋯ menu');
  } finally {
    if (saved === undefined) delete process.env.PAYMONGO_SECRET_KEY; else process.env.PAYMONGO_SECRET_KEY = saved;
  }
});

console.log('\nindicator strip');

ok('online pill mirrors the setting', () => {
  assert.ok(/<input type="checkbox" name="online" onchange="this.form.submit\(\)" checked>/.test(html));
  assert.ok(!/name="online"[^>]*checked/.test(render({ settings: { owner_online: false, payment_methods: [] } })));
});

ok('a healthy live gateway is a quiet pill, not a red banner', () => {
  assert.ok(html.includes('oq-pill-pm oq-pill-ok'));
  assert.ok(html.includes('LIVE · webhook ok'));
  assert.ok(!html.includes('oq-pill-bad'));
  assert.ok(!html.includes('oq-pm-warn'));
});

ok('a failing webhook turns the pill red and adds the warning line', () => {
  const broken = render({ paymongoHealth: { ok_count: 9, fail_count: 2, last_ok_at: '2026-09-20T03:23:00Z', last_fail_at: '2026-09-21T03:23:00Z' } });
  assert.ok(broken.includes('oq-pill-pm oq-pill-bad'));
  assert.ok(broken.includes('class="oq-pm-warn"'));
  assert.ok(broken.includes('PAYMONGO_WEBHOOK_SECRET likely doesn'));
});

ok('no gateway markup at all when PayMongo is not configured', () => {
  const none = render({ paymongoMode: 'none' });
  assert.ok(!none.includes('oq-pill-pm'));
  assert.ok(!none.includes('oq-pm-warn'));
});

ok('the stat cards and the old standalone zones are gone', () => {
  ['oq-stats', 'oq-stat-v', 'class="oq-pm ', 'oq-export', 'oq-online-toggle', 'oq-refunds', 'oq-abandoned']
    .forEach(c => assert.ok(!html.includes(c), c));
});

console.log('\nledger');

ok('header line: total, paid, peso total, period', () => {
  assert.ok(/All orders <span class="oq-zone-n">6<\/span>/.test(html));
  assert.ok(html.includes('4 paid · ₱1,234 · Last 3 months'));
});

ok('chip counts are the rows each chip shows, and add up to All', () => {
  const n = g => {
    const m = html.match(new RegExp('data-g="' + g + '">[^<]*<span class="oq-chip-n">(\\d+)</span>'));
    return m ? Number(m[1]) : null;
  };
  assert.deepStrictEqual([n('all'), n('out'), n('paid'), n('unpaid'), n('cancelled')], [6, 2, 2, 1, 1]);
});

ok('every ledger row carries its type', () => {
  const types = [...html.matchAll(/class="oq-lr" data-g="\w+" data-t="(\w+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(types, ['rental', 'purchase', 'reservation', 'rental', 'rental', 'rental']);
});

ok('month subtotal says paid', () => {
  assert.ok(html.includes('<span class="oq-grp-sum">4 paid · ₱1,234</span>'));
});

ok('type filter stays a native select; no-match state starts hidden', () => {
  assert.ok(html.includes('<select id="oqType" class="oq-type" data-ss-skip'));
  assert.ok(/id="oqNoMatch" hidden>/.test(html));
  assert.ok(html.includes('data-oq-clear'));
});

ok('no inline script, style or old inline handlers', () => {
  assert.ok(!/<script\b/.test(html));
  assert.ok(!/<style\b/.test(html));
  assert.ok(!html.includes('oqChip('));
  assert.ok(!html.includes('oqFilter('));
});

ok('the old monolithic partial is gone', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'views', 'partials', 'order-queue.ejs')));
});

ok('the sidebar badge counts Do now + Refunds', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'views', 'admin.ejs'), 'utf8');
  assert.ok(admin.includes('orderQueue.length + (typeof refundsOwed !== \'undefined\' ? refundsOwed : []).length'));
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-orders-template.js`
Expected: FAIL — the current `orders.ejs` renders the old markup, so the first assertion (`Needs you <span class="oq-zone-n">4</span>`) fails with an `AssertionError`.

- [ ] **Step 3: Create `views/partials/admin/orders/strip.ejs`**

```ejs
<%#
  Top of the Orders tab: Quick Add on the left, three small indicators on the
  right. This replaces the four stat cards, the full-width gateway banner, the
  export block and the online box: each either repeated a number the queue or
  ledger already shows, or was a status that only needs a dot. The gateway
  takes more than a pill only when its webhook is actually failing.
%>
<%
  const pmMode = typeof paymongoMode !== 'undefined' ? paymongoMode : 'none';
  const pmH = (typeof paymongoHealth !== 'undefined' && paymongoHealth) ? paymongoHealth : null;
  const pmFails = pmH ? (pmH.fail_count || 0) : 0;
  const pmOks = pmH ? (pmH.ok_count || 0) : 0;
  // Failures only matter if they are the MOST RECENT thing that happened —
  // old ones from before a secret was fixed are history, not a live problem.
  const pmBroken = pmFails > 0 && (!pmH.last_ok_at || String(pmH.last_fail_at || '') > String(pmH.last_ok_at || ''));
  const pmWhen = t => { if (!t) return 'never'; const d = new Date(t); return isNaN(d) ? 'never' : d.toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); };
  const pmName = pmMode === 'live' ? 'LIVE' : pmMode === 'test' ? 'TEST' : 'Unrecognised key';
  const pmState = pmBroken ? 'webhook failing' : pmOks > 0 ? 'webhook ok' : 'no webhook yet';
  const pmClass = pmBroken ? 'oq-pill-bad' : pmOks > 0 ? 'oq-pill-ok' : 'oq-pill-idle';
  const pmTitle = pmBroken
    ? pmFails + ' webhook signature failure' + (pmFails === 1 ? '' : 's') + ', last ' + pmWhen(pmH.last_fail_at)
    : pmOks > 0 ? 'Webhook healthy · ' + pmOks + ' verified · last ' + pmWhen(pmH.last_ok_at)
    : 'No webhook received yet — the first real payment will confirm it works.';
  const stOnline = !!(settings && settings.owner_online);
%>
<div class="oq-strip">
  <button type="button" class="qa-btn qa-gold oq-strip-add" onclick="qaOpen()">⚡ Quick Add</button>
  <div class="oq-ind">
    <form method="POST" action="/admin/online" class="oq-ind-online">
      <label class="oq-pill<%= stOnline ? ' oq-pill-on' : '' %>" title="I'm online now — show a live banner to customers waiting to send a QR">
        <input type="checkbox" name="online" onchange="this.form.submit()"<%= stOnline ? ' checked' : '' %>>
        <span class="oq-pill-dot"></span>Online
      </label>
    </form>
    <% if (pmMode !== 'none') { %>
    <span class="oq-pill oq-pill-pm <%= pmClass %>" title="<%= pmTitle %>"><span class="oq-pill-dot"></span><%= pmBroken ? '⚠ ' : '' %><%= pmName %> · <%= pmState %></span>
    <% } %>
    <a class="oq-pill oq-pill-link" href="/admin/api/orders-export" download title="Every order with its full state history — for the funnel report.">⬇ Export</a>
  </div>
</div>
<% if (pmMode !== 'none' && pmBroken) { %>
<div class="oq-pm-warn">⚠ <%= pmFails %> webhook signature failure<%= pmFails === 1 ? '' : 's' %>, last <%= pmWhen(pmH.last_fail_at) %> — PAYMONGO_WEBHOOK_SECRET likely doesn't match this mode, so paid orders won't advance on their own.</div>
<% } %>
```

- [ ] **Step 4: Create `views/partials/admin/orders/needs-you.ejs`**

```ejs
<%#
  Needs You: every row that wants a click from the owner, in four groups —
  Do now, Refunds owed, Follow-ups (started but didn't pay) and Waitlist.
  Each row's content, forms, routes and confirm prompts are the ones its old
  standalone zone had; only the grouping and the button weight changed. Rare
  or destructive actions sit behind the ⋯ menu. public/js/admin-orders.js
  remembers which groups are open.
%>
<%
  const nyType = t => t === 'tr' ? 'Trophy' : t === 'ps4' ? 'PS4 Primary' : 'Non-Trophy';
  const QUEUE_ACTION = {
    verifying_payment: 'Payment confirmed',
    qr_pending: 'Signed them in',
    verifying_return: 'Return confirmed'
  };
  const QUEUE_LABEL = {
    verifying_payment: 'Check payment',
    qr_pending: 'Scan QR',
    verifying_return: 'Check return'
  };
  // A reservation payment settles into 'reserved' rather than moving on to
  // a console sign-in — the button text differs from a rental's, even though
  // both sit in verifying_payment.
  const queueAction = o => (o.is_reservation && o.state === 'verifying_payment') ? 'Reservation confirmed' : QUEUE_ACTION[o.state];
  // Live QR windows first — they are the only rows with a deadline.
  const nyDoNow = [...(orderQueue || [])].sort((a, b) => {
    if (a.state === 'qr_pending' && b.state !== 'qr_pending') return -1;
    if (b.state === 'qr_pending' && a.state !== 'qr_pending') return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });
  const nyRefunds = refundsOwed || [];
  const nyFollowUps = [...(abandonedOrders || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  // Priority first, then free — the tier order queueRules.buildQueue numbers
  // them in, so this list can never show a priority customer beneath a free
  // entry. Within a tier, oldest first. Grouped per game + account type,
  // because that is the scope a slot actually opens in.
  const nyWaitlist = [...(waitlistOrders || [])].sort((a, b) => {
    const ka = String(a.game_id) + '|' + a.account_type;
    const kb = String(b.game_id) + '|' + b.account_type;
    if (ka !== kb) return ka < kb ? -1 : 1;
    const ta = a.state === 'reserved' ? 0 : 1;
    const tb = b.state === 'reserved' ? 0 : 1;
    if (ta !== tb) return ta - tb;
    const da = Date.parse(a.created_at || '') || 0;
    const db = Date.parse(b.created_at || '') || 0;
    if (da !== db) return da - db;
    return String(a.ref).localeCompare(String(b.ref));
  });
  // Only the groups that have to be cleared count toward the headline (and
  // the sidebar badge in views/admin.ejs). Follow-ups and the waitlist never
  // "finish" the way a payment check does, so they carry their own counts.
  const nyCount = nyDoNow.length + nyRefunds.length;
  const nyMethods = ((settings && settings.payment_methods) || []).filter(m => m.enabled).map(m => m.label);
  const nyPayLine = nyMethods.length
    ? 'We accept ' + nyMethods.join(' and ') + ' — just reply here and we\'ll send you the QR and get you set up right away.'
    : 'Just reply here and we\'ll help you get set up.';
  const nyStarted = typeof startedCount !== 'undefined' ? startedCount : 0;
  const nyRate = typeof orderStartRate !== 'undefined' ? orderStartRate : null;
  const nyFunnel = nyStarted
    ? abandonedCount + ' of ' + nyStarted + ' started this week' + (nyRate !== null ? ' · ' + nyRate + '% of game views' : '')
    : '';
%>
<div class="oq-zone oq-zone-act">Needs you <span class="oq-zone-n"><%= nyCount %></span></div>

<% if (!nyDoNow.length && !nyRefunds.length && !nyFollowUps.length && !nyWaitlist.length) { %>
<div class="oq-empty">Nothing waiting on you right now.</div>
<% } %>

<% if (nyDoNow.length) { %>
<details class="oq-group oq-group-now" data-oq-group="now" open>
  <summary class="oq-group-h"><span class="oq-group-name">Do now</span><span class="oq-group-n"><%= nyDoNow.length %></span></summary>
  <% nyDoNow.forEach(o => { %>
  <div class="oq-row oq-<%= o.state %>">
    <div class="oq-main">
      <div class="oq-top">
        <span class="oq-ref"><%= o.ref %></span>
        <% if (o.is_reservation) { %>
        <span class="oq-badge oq-badge-res"><%= o.upcoming_game_id ? '🔜 Coming Soon reservation' : '⭐ Priority reservation' %></span>
        <% } %>
        <% if (o.is_buy) { %>
        <span class="oq-badge oq-badge-buy">♾️ Purchase</span>
        <% } %>
        <span class="oq-badge"><%= QUEUE_LABEL[o.state] %></span>
        <% if (o.state === 'qr_pending' && o.qr_expires_at) { %>
        <span class="oq-timer" data-expires="<%= o.qr_expires_at %>">--:--</span>
        <% } %>
      </div>
      <div class="oq-meta">
        <%= o.game_title %> · <%= nyType(o.account_type) %>
        · <%= o.is_buy ? 'One-time purchase' : (o.days === 7 ? 'Weekly' : 'Monthly') %> · ₱<%= (o.amount_due || 0) + (o.deposit_due || 0) %><%= o.is_reservation ? (o.upcoming_game_id ? ' reservation, paid in full' + ((o.remaining_due || 0) > 0 ? ' (₱' + o.remaining_due + ' still due on release)' : '') : ' priority fee (₱' + (o.remaining_due || 0) + ' when slot opens)') : '' %>
      </div>
      <div class="oq-fb">
        FB: <strong><%= o.fb_name %></strong>
        <% if (o.psid) { %>
          <a class="oq-thread" href="https://www.facebook.com/messages/t/<%= o.psid %>" target="_blank" rel="noopener">open chat →</a>
        <% } %>
      </div>
      <% if (o.state === 'verifying_payment') { %>
        <div class="oq-proof">
          <% if (o.payment_method) { %><span class="oq-method"><%= o.payment_method.toUpperCase() %></span><% } %>
          <% if (o.paypal_expected) { %><span class="oq-expected">expect ₱<%= o.paypal_expected %></span><% } %>
          <% if (o.payment_proof) { %>
            <a href="<%= o.payment_proof %>" target="_blank" rel="noopener">View receipt →</a>
          <% } else { %>
            <span class="oq-via-fb">Says they sent it on Messenger — check your inbox</span>
          <% } %>
        </div>
      <% } %>
      <% if (o.state === 'qr_pending' && o.qr_code) { %>
        <%# Typed codes go straight into the PlayStation App, so the code itself
            is the thing the owner needs — big enough to read at a glance and
            one tap to copy, rather than a link to open. %>
        <div class="oq-proof oq-signin-code">
          <code class="oq-code"><%= o.qr_code %></code>
          <button type="button" class="rem-copy oq-code-copy" data-msg="<%= o.qr_code %>" title="Copy this sign-in code">📋 Copy</button>
        </div>
      <% } else if (o.state === 'qr_pending' && o.qr_image) { %>
        <div class="oq-proof"><a href="<%= o.qr_image %>" target="_blank" rel="noopener">Open QR to scan →</a></div>
      <% } %>
      <% if (o.state === 'verifying_return' && o.return_proof) { %>
        <div class="oq-proof"><a href="<%= o.return_proof %>" target="_blank" rel="noopener">View return proof →</a></div>
      <% } %>
    </div>
    <div class="oq-actions">
      <form method="POST" action="/admin/orders/<%= o.ref %>/advance">
        <button type="submit" class="oq-btn-go"><%= queueAction(o) %></button>
      </form>
      <details class="oq-more">
        <summary class="oq-more-btn" title="More actions" aria-label="More actions">⋯</summary>
        <div class="oq-more-menu">
          <% if (o.state === 'verifying_payment') { %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/reject">
            <button type="submit" class="oq-more-item">Can't find it</button>
          </form>
          <% } %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/delete" onsubmit="return confirm('Permanently delete order ' + <%= JSON.stringify(o.ref) %> + '? Its customer record and money go too. This cannot be undone.');">
            <button type="submit" class="oq-more-item oq-more-danger">Delete</button>
          </form>
        </div>
      </details>
    </div>
  </div>
  <% }) %>
</details>
<% } %>

<% if (nyRefunds.length) { %>
<details class="oq-group oq-group-refunds" data-oq-group="refunds" open>
  <summary class="oq-group-h"><span class="oq-group-name">Refunds owed</span><span class="oq-group-n"><%= nyRefunds.length %></span></summary>
  <% nyRefunds.forEach(o => { %>
  <div class="oq-row">
    <div class="oq-main">
      <div class="oq-top">
        <span class="oq-ref"><%= o.ref %></span>
        <span class="oq-refund-amt">₱<%= o.deposit_due %></span>
      </div>
      <div class="oq-fb">FB: <strong><%= o.fb_name %></strong> · <%= o.game_title %></div>
    </div>
    <div class="oq-actions">
      <form method="POST" action="/admin/orders/<%= o.ref %>/refunded">
        <button type="submit" class="oq-btn-go">Sent it</button>
      </form>
    </div>
  </div>
  <% }) %>
</details>
<% } %>

<% if (nyFollowUps.length) { %>
<details class="oq-group oq-group-followups" data-oq-group="followups">
  <summary class="oq-group-h"><span class="oq-group-name">Follow-ups</span><span class="oq-group-n"><%= nyFollowUps.length %></span><% if (nyFunnel) { %><span class="oq-group-sub"><%= nyFunnel %></span><% } %></summary>
  <% nyFollowUps.forEach(o => {
    const abTypeLabel = nyType(o.account_type);
    const abDurLabel = o.is_buy ? 'One-time purchase' : (o.days === 7 ? 'Weekly' : 'Monthly');
    const abTotal = (o.amount_due || 0) + (o.deposit_due || 0);
    const firstName = (o.fb_name || '').trim().split(/\s+/)[0] || 'there';
    const followUpMsg = '👋 Hi ' + firstName + '! Saw you started an order with us —\n\n'
      + '🎮 ' + o.game_title + ' (' + abTypeLabel + ')\n'
      + (o.is_buy ? '🛒 One-time purchase\n' : '⏱ ' + abDurLabel + ' rental\n')
      + '💰 Total: ₱' + abTotal + (o.deposit_due > 0 ? ' (₱' + (o.amount_due || 0) + ' rent + ₱' + o.deposit_due + ' refundable deposit)' : '') + '\n'
      + '🔖 Reference: ' + o.ref + '\n\n'
      + 'Still want it? ' + nyPayLine + '\n\n'
      + 'No worries if you changed your mind, just let us know!';
  %>
  <div class="oq-row">
    <div class="oq-main">
      <div class="oq-top">
        <span class="oq-ref"><%= o.ref %></span>
        <span class="oq-ab-name"><%= o.fb_name %></span>
        <span class="oq-ab-age" data-created="<%= o.created_at %>">--</span>
      </div>
      <div class="oq-meta">
        <%= o.game_title %> · <%= abTypeLabel %> · <%= abDurLabel %> · ₱<%= abTotal %>
        <% if (o.state === 'payment_rejected') { %>· <span class="oq-ab-rejected">payment rejected</span><% } %>
        <%# Only present when they arrived via the Messenger bot; a customer who
            typed straight into the website has no psid to open a thread with. %>
        <% if (o.psid) { %>· <a class="oq-thread" href="https://www.facebook.com/messages/t/<%= o.psid %>" target="_blank" rel="noopener">open chat →</a><% } %>
      </div>
    </div>
    <div class="oq-actions">
      <button type="button" class="oq-btn-ghost rem-copy" data-msg="<%= followUpMsg %>" title="Copy follow-up message">📋 Copy</button>
      <form method="POST" action="/admin/orders/<%= o.ref %>/mark-paid" onsubmit="return confirm('Mark order ' + <%= JSON.stringify(o.ref) %> + ' as paid? Use this when the customer paid outside the site (e.g. Messenger). They\'ll still need to send their sign-in QR.');">
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
</details>
<% } %>

<% if (nyWaitlist.length) { %>
<details class="oq-group oq-group-waitlist" data-oq-group="waitlist">
  <summary class="oq-group-h"><span class="oq-group-name">Waitlist</span><span class="oq-group-n"><%= nyWaitlist.length %></span></summary>
  <% nyWaitlist.forEach(o => {
    const wlTypeLabel = nyType(o.account_type);
    const wlDurLabel = o.days === 7 ? 'Weekly' : 'Monthly';
    const wlFirstName = (o.fb_name || '').trim().split(/\s+/)[0] || 'there';
    const wlMsg = '👋 Hi ' + wlFirstName + '! A slot just opened up for ' + o.game_title + ' (' + wlTypeLabel + ', ' + wlDurLabel + ') —\n\n'
      + 'Still want it? Reply here and we\'ll get you set up.\n\n'
      + '🔖 Reference: ' + o.ref;
    const wlPriority = o.state === 'reserved';
    // A priority row has a menu only when the upgrade can be undone; a free
    // row always has Remove.
    const wlHasMenu = wlPriority ? !!o.upgraded_from_waitlist : true;
  %>
  <div class="oq-row">
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
        <%= o.game_title %> · <%= wlTypeLabel %> · <%= wlDurLabel %> ·
        <%= wlPriority ? '⭐ Priority — paid' : 'Free entry' %><%= o.queueExpired ? ' · waiting 30+ days' : '' %>
      </div>
    </div>
    <div class="oq-actions">
      <button type="button" class="oq-btn-ghost rem-copy" data-msg="<%= wlMsg %>" title="Copy slot-open message">📋 Copy</button>
      <% if (!wlPriority) { %>
      <%# For a ₱100 that arrived over Messenger or GCash rather than through
          the site. Confirms first because it books money and moves them above
          everyone still on a free entry. %>
      <form method="POST" action="/admin/orders/<%= o.ref %>/priority-paid" onsubmit="return confirm('Mark ' + <%= JSON.stringify(o.ref) %> + ' as priority paid?\n\nUse this when they sent the ₱100 outside the site. They move above everyone on a free entry, and the rest of the rent is still owed when a slot opens.');">
        <button type="submit" class="oq-btn-pri" title="They paid the ₱100 priority fee outside the site">⭐ Priority paid</button>
      </form>
      <% } %>
      <% if (wlHasMenu) { %>
      <details class="oq-more">
        <summary class="oq-more-btn" title="More actions" aria-label="More actions">⋯</summary>
        <div class="oq-more-menu">
          <% if (wlPriority) { %>
          <%# Undo puts them back on the free list at their original join date.
              Only offered on the flag the priority upgrade itself sets. %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/undo-priority" onsubmit="return confirm('Undo priority for ' + <%= JSON.stringify(o.ref) %> + '?\n\nThey go back to a free waiting-list entry, keeping their reference and their place in line. Use this if the ₱100 never actually arrived.');">
            <button type="submit" class="oq-more-item" title="Put this customer back on the free waiting list">↩ Undo priority</button>
          </form>
          <% } else { %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/cancel" onsubmit="return confirm('Remove ' + <%= JSON.stringify(o.ref) %> + ' from the waiting list?');">
            <button type="submit" class="oq-more-item oq-more-danger" title="Remove this waitlist entry">Remove</button>
          </form>
          <% } %>
        </div>
      </details>
      <% } %>
    </div>
  </div>
  <% }) %>
</details>
<% } %>
```

- [ ] **Step 5: Create `views/partials/admin/orders/ledger.ejs`**

```ejs
<%#
  All Orders: every order in the selected period, grouped by month. The period
  reloads from the server; the status chip, the type and the search filter the
  loaded rows in public/js/admin-orders.js and persist for the browser session.
  Each chip counts the rows it would show, so the five chips add up to All.
%>
<%
  const PERIOD_LABEL = p => {
    if (p === 'all') return 'All time';
    if (/^\d{4}$/.test(p)) return p;
    const [y, m] = p.split('-');
    return new Date(Number(y), Number(m) - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };
  const periodLabel = orderPeriod ? PERIOD_LABEL(orderPeriod) : 'Last 3 months';
  const OUT_STATES = ['awaiting_qr', 'qr_pending', 'active', 'awaiting_return', 'verifying_return'];
  const lgGroup = o => o.state === 'cancelled' ? 'cancelled'
    : ['awaiting_payment', 'payment_rejected'].includes(o.state) ? 'unpaid'
    : OUT_STATES.includes(o.state) ? 'out' : 'paid';
  // Same rule as orderType() in public/js/admin-orders.js: a Coming Soon
  // pre-order carries is_buy too, but it is a reservation first.
  const lgType = o => o.is_reservation ? 'reservation' : o.is_buy ? 'purchase' : 'rental';
  const lgOrders = ledgerGroups.flatMap(gr => gr.orders);
  const lgCount = g => lgOrders.filter(o => lgGroup(o) === g).length;
%>
<div class="oq-zone oq-zone-all oq-ledger-h">
  All orders <span class="oq-zone-n"><%= ledgerStats.total %></span>
  <span class="oq-zone-sub"><%= ledgerStats.paidCount %> paid · ₱<%= ledgerStats.paidTotal.toLocaleString() %> · <%= periodLabel %></span>
</div>

<div class="oq-ledger-bar">
  <form method="GET" action="/admin" class="oq-period">
    <input type="hidden" name="tab" value="orders">
    <label for="oqPeriod">Period</label>
    <select name="operiod" id="oqPeriod" onchange="this.form.submit()">
      <option value="" <%= orderPeriod === '' ? 'selected' : '' %>>Last 3 months</option>
      <option value="all" <%= orderPeriod === 'all' ? 'selected' : '' %>>All time</option>
      <% if (orderYears.length) { %>
      <optgroup label="By year">
        <% orderYears.forEach(y => { %>
        <option value="<%= y %>" <%= orderPeriod === y ? 'selected' : '' %>><%= y %></option>
        <% }) %>
      </optgroup>
      <optgroup label="By month">
        <% orderPeriods.forEach(p => { %>
        <option value="<%= p %>" <%= orderPeriod === p ? 'selected' : '' %>><%= PERIOD_LABEL(p) %></option>
        <% }) %>
      </optgroup>
      <% } %>
    </select>
  </form>
  <input type="search" id="oqSearch" class="oq-search" placeholder="Search ref, name or game…" autocomplete="off">
  <select id="oqType" class="oq-type" data-ss-skip aria-label="Order type">
    <option value="all">All types</option>
    <option value="rental">Rentals</option>
    <option value="purchase">Purchases</option>
    <option value="reservation">Reservations</option>
  </select>
</div>

<div class="oq-chips">
  <button type="button" class="oq-chip oq-chip-on" data-g="all">All <span class="oq-chip-n"><%= lgOrders.length %></span></button>
  <button type="button" class="oq-chip" data-g="out">🎮 Out on rent <span class="oq-chip-n"><%= lgCount('out') %></span></button>
  <button type="button" class="oq-chip" data-g="paid">✅ Completed <span class="oq-chip-n"><%= lgCount('paid') %></span></button>
  <button type="button" class="oq-chip" data-g="unpaid">⚠ Didn't pay <span class="oq-chip-n"><%= lgCount('unpaid') %></span></button>
  <button type="button" class="oq-chip" data-g="cancelled">🚫 Cancelled <span class="oq-chip-n"><%= lgCount('cancelled') %></span></button>
</div>

<% if (!ledgerGroups.length) { %>
  <div class="oq-empty">No orders in this period.</div>
<% } else { %>
<div class="oq-tw" id="oqLedgerWrap">
  <table class="oq-tbl" id="oqLedger">
    <thead>
      <tr>
        <th>Ref</th><th>Customer</th><th>Game</th><th>Rental</th>
        <th>Dates</th><th>Total</th><th>Status</th><th></th>
      </tr>
    </thead>
    <tbody>
      <% ledgerGroups.forEach(g => { %>
      <tr class="oq-grp" data-grp="<%= g.key %>">
        <td colspan="8">
          <%= PERIOD_LABEL(g.key) %>
          <span class="oq-grp-sum"><%= g.paidCount %> paid · ₱<%= g.paidTotal.toLocaleString() %></span>
        </td>
      </tr>
      <% g.orders.forEach(o => {
           const paid = !['awaiting_payment','verifying_payment','payment_rejected','cancelled'].includes(o.state);
           const grp = lgGroup(o);
           const out = grp === 'out';
           const typeLbl = o.account_type === 'tr' ? 'Trophy' : o.account_type === 'ps4' ? 'PS4 Primary' : 'Non-Trophy';
           const durLbl = o.is_buy ? 'One-time purchase' : (o.days === 7 ? 'Weekly' : 'Monthly');
           const total = (o.amount_due || 0) + (o.deposit_due || 0);
           const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
           const dates = o.start_date ? fmt(o.start_date) + (o.end_date ? ' – ' + fmt(o.end_date) : '') : '—';
           const stCls = grp === 'cancelled' ? 'oq-st-dead' : grp === 'unpaid' ? 'oq-st-wait' : out ? 'oq-st-live' : 'oq-st-done';
           const stLbl = o.state === 'cancelled' ? 'Cancelled'
                       : o.state === 'payment_rejected' ? 'Payment rejected'
                       : o.state === 'awaiting_payment' ? 'Awaiting payment'
                       : o.state === 'closed' ? 'Completed'
                       : o.state === 'reserved' ? (o.upcoming_game_id ? 'Reserved — awaiting release' : 'Priority — awaiting a slot')
                       : out ? 'Out on rent' : 'Completed';
           // Bundle slots aren't locked until an order reaches 'active', so two
           // customers can both pay for the same slot before anyone notices —
           // flagged here for manual review. Limited to the loaded period.
           const dupSlotCount = (o.is_buy && o.account_id && o.slot_type)
             ? lgOrders.filter(x => x.ref !== o.ref && x.account_id === o.account_id && x.slot_type === o.slot_type
                 && !['closed','cancelled','payment_rejected'].includes(x.state)).length
             : 0;
      %>
      <tr class="oq-lr" data-g="<%= grp %>" data-t="<%= lgType(o) %>"
          data-s="<%= (o.ref + ' ' + (o.fb_name||'') + ' ' + (o.game_title||'')).toLowerCase() %>">
        <td class="oq-lref"><%= o.ref %></td>
        <td class="oq-lcust"><%= o.fb_name %></td>
        <td class="oq-lgame"><%= o.game_title %></td>
        <td class="oq-lmeta"><%= typeLbl %> · <%= durLbl %></td>
        <td class="oq-lnum oq-ldates"><%= dates %></td>
        <td class="oq-lnum oq-ltot">₱<%= total.toLocaleString() %></td>
        <td class="oq-lst">
          <span class="oq-st <%= stCls %>"><span class="oq-st-dot"></span><%= stLbl %></span>
          <% if (paid && (o.deposit_due || 0) > 0) { %>
            <div class="oq-dep <%= o.deposit_refunded ? 'oq-dep-ok' : '' %>">
              <%= o.deposit_refunded ? 'Deposit refunded' : 'Deposit not refunded' %>
            </div>
          <% } %>
          <% if (dupSlotCount > 0) { %>
            <div class="oq-dep" title="Multiple live orders are claiming the same slot — verify before fulfilling and refund manually if needed.">
              ⚠ Duplicate slot claim — <%= dupSlotCount %> other order<%= dupSlotCount > 1 ? 's' : '' %> for this slot
            </div>
          <% } %>
        </td>
        <td class="oq-lact">
          <%# Only present on orders that can actually be reviewed and haven't
              been yet — server.js attaches review_msg, and its absence is the
              whole condition. %>
          <% if (o.review_msg) { %>
          <button type="button" class="rem-copy" data-msg="<%= o.review_msg %>" title="Copy a review request for this customer">📋</button>
          <% } %>
          <%# Only on orders the priority-paid button created — a Coming Soon
              reservation rests in the same state but paid for a game, not a
              queue place, and must not be undoable into a free entry. %>
          <% if (o.state === 'reserved' && o.upgraded_from_waitlist) { %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/undo-priority" onsubmit="return confirm('Undo priority for ' + <%= JSON.stringify(o.ref) %> + '?\n\nThey go back to a free waiting-list entry, keeping their reference and their place in line. Use this if the ₱100 never actually arrived.');">
            <button type="submit" class="oq-lact-undo" title="Put this customer back on the free waiting list">↩</button>
          </form>
          <% } %>
          <form method="POST" action="/admin/orders/<%= o.ref %>/delete" onsubmit="return confirm('Delete order ' + <%= JSON.stringify(o.ref) %> + '? Its customer record and money go too. Use this to clear out test orders or accidental duplicates. This cannot be undone.');">
            <button type="submit" class="oq-lact-del" title="Delete this order">🗑</button>
          </form>
        </td>
      </tr>
      <% }) %>
      <% }) %>
    </tbody>
  </table>
</div>
<div class="oq-empty" id="oqNoMatch" hidden>No orders match these filters. <a href="#" data-oq-clear>Clear filters</a></div>
<% } %>
```

- [ ] **Step 6: Rewrite `views/partials/admin/orders.ejs` and delete the old partial**

Replace the whole of `views/partials/admin/orders.ejs` with:

```ejs
  <div class="tab-panel" id="tab-orders">
    <%- include('orders/strip') %>
    <%- include('orders/needs-you') %>
    <%- include('orders/ledger') %>
  </div>
```

Then:

```bash
git rm views/partials/order-queue.ejs
```

- [ ] **Step 7: Sidebar badge in `views/admin.ejs`**

In `views/admin.ejs`, inside the Orders sidebar button, replace exactly:

```ejs
<% if (orderQueue.length) { %><span class="oq-count"><%= orderQueue.length %></span><% } %>
```

with:

```ejs
<% const oqBadge = orderQueue.length + (typeof refundsOwed !== 'undefined' ? refundsOwed : []).length; %><% if (oqBadge) { %><span class="oq-count"><%= oqBadge %></span><% } %>
```

- [ ] **Step 8: Run the template test**

Run: `node scripts/test-orders-template.js`
Expected: every line `ok - …`, ending `26 assertions passed`.

Also run `node scripts/test-admin-tabs.js` and `node scripts/test-admin-orders-filter.js` — both still pass.

- [ ] **Step 9: Commit**

```bash
git add views/partials/admin/orders.ejs views/partials/admin/orders/strip.ejs views/partials/admin/orders/needs-you.ejs views/partials/admin/orders/ledger.ejs views/admin.ejs scripts/test-orders-template.js
git status --short
git commit -m "$(cat <<'EOF'
Rebuild the Orders tab: indicator strip, grouped Needs You, tidier ledger

Replaces views/partials/order-queue.ejs with three partials. Refunds,
follow-ups and the waitlist join the Do now queue as groups; rare and
destructive row actions move behind a menu; every chip now counts the
rows it shows, so they add up to All. No route or confirm prompt changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

`git status --short` before the commit should show the deleted `views/partials/order-queue.ejs` (staged by `git rm`), the four modified/new templates, `views/admin.ejs` and the new test — plus the long-standing untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`, which is not part of this work (leave it alone).

---

### Task 3: Page behaviour — timers, groups, ledger filters, Payment link

**Files:**
- Modify: `public/js/admin-orders.js` — insert the DOM section immediately before the final `})();`
- Modify: `views/admin.ejs` — one `<script>` line
- Modify: `views/partials/admin/notif-bell.ejs` — two comments
- Test: `scripts/test-admin-orders-filter.js` (append checks)

**Interfaces:**
- Consumes: from Task 1 (same IIFE scope) — `normalizeLedgerState`, `rowMatches`, `normalizeGroups`, `LEDGER_KEY`, `GROUPS_KEY`. From Task 2 — every id / class / attribute listed in Task 2's "Produces".
- Produces: the working page.

- [ ] **Step 1: Write the failing checks**

In `scripts/test-admin-orders-filter.js`, insert before the final `console.log('\n' + passed + ' assertions passed\n');` line:

```js
console.log('\nwiring');

ok('admin.ejs loads admin-orders.js with a cache-busting ?v=', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
  assert.ok(/<script src="\/js\/admin-orders\.js\?v=<%=\s*assetV\s*%>"><\/script>/.test(src));
});

ok('the file still loads cleanly with no DOM (wiring skipped, rules still exposed)', () => {
  const again = load();
  assert.strictEqual(typeof again.rowMatches, 'function');
});

ok('the notification bell no longer points at the deleted order-queue.ejs', () => {
  const bell = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin', 'notif-bell.ejs'), 'utf8');
  assert.ok(!bell.includes('order-queue.ejs'));
  assert.ok(bell.includes('public/js/admin-orders.js'));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/test-admin-orders-filter.js`
Expected: FAIL on `admin.ejs loads admin-orders.js with a cache-busting ?v=`.

- [ ] **Step 3: Script tag**

In `views/admin.ejs`, directly after:

```html
<script src="/js/admin-accounts.js?v=<%= assetV %>"></script>
```

add:

```html
<script src="/js/admin-orders.js?v=<%= assetV %>"></script>
```

- [ ] **Step 4: Notification bell comments**

In `views/partials/admin/notif-bell.ejs`, replace:

```ejs
              <%# Deliberately NOT .oq-timer: order-queue.ejs runs its own sweep
                  over that class, and two loops writing one element fight over
                  the text and the expired styling. %>
```

with:

```ejs
              <%# Deliberately NOT .oq-timer: public/js/admin-orders.js runs its
                  own sweep over that class, and two loops writing one element
                  fight over the text and the expired styling. %>
```

and replace:

```js
  // The sign-in countdowns. order-queue.ejs runs the same loop for its own
  // rows, but it only exists inside the Orders tab — the bell is on every
  // page, so it owns the timers it renders.
```

with:

```js
  // The sign-in countdowns. public/js/admin-orders.js runs the same loop over
  // .oq-timer, but only views/admin.ejs loads it — the bell is on every admin
  // page, so it owns the timers it renders.
```

- [ ] **Step 5: DOM wiring**

In `public/js/admin-orders.js`, insert immediately before the final `})();` line (after the `window.__oqFilter = { … };` statement):

```js

  // ── Page wiring ──────────────────────────────────────────────────────────
  if (typeof document === 'undefined' || !document.getElementById) return;

  function toArray(list) { return Array.prototype.slice.call(list); }

  function readJson(store, key) {
    try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; }
  }

  function writeJson(store, key, value) {
    try { store.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: state just won't persist */ }
  }

  // Page-wide on purpose: the dashboard overview renders an .oq-timer too and
  // has no loop of its own.
  function tick() {
    toArray(document.querySelectorAll('.oq-timer')).forEach(function (el) {
      var left = new Date(el.getAttribute('data-expires')).getTime() - Date.now();
      if (left <= 0) { el.textContent = 'expired'; el.classList.add('oq-timer-dead'); return; }
      var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      el.textContent = m + ':' + String(s).padStart(2, '0') + ' left';
    });
  }

  function formatAges() {
    toArray(document.querySelectorAll('.oq-ab-age')).forEach(function (el) {
      var ms = Date.now() - new Date(el.getAttribute('data-created')).getTime();
      var mins = Math.floor(ms / 60000);
      if (mins < 60) { el.textContent = mins + 'm ago'; return; }
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) { el.textContent = hrs + 'h ago'; return; }
      el.textContent = Math.floor(hrs / 24) + 'd ago';
    });
  }

  // Re-applies the owner's own open/closed choice per Needs You group; a
  // group they never touched keeps the default the template rendered.
  function initGroups() {
    var saved = normalizeGroups(readJson(window.localStorage, GROUPS_KEY));
    toArray(document.querySelectorAll('details[data-oq-group]')).forEach(function (d) {
      var key = d.getAttribute('data-oq-group');
      if (Object.prototype.hasOwnProperty.call(saved, key)) d.open = saved[key];
      d.addEventListener('toggle', function () {
        var cur = normalizeGroups(readJson(window.localStorage, GROUPS_KEY));
        cur[key] = d.open;
        writeJson(window.localStorage, GROUPS_KEY, cur);
      });
    });
  }

  function initLedger() {
    var table = document.getElementById('oqLedger');
    var search = document.getElementById('oqSearch');
    var typeSel = document.getElementById('oqType');
    var panel = document.getElementById('tab-orders');
    if (!table || !search || !typeSel || !panel) return;

    var state = normalizeLedgerState(readJson(window.sessionStorage, LEDGER_KEY));

    function apply() {
      var shown = 0;
      toArray(table.querySelectorAll('tr.oq-lr')).forEach(function (r) {
        var match = rowMatches({
          g: r.getAttribute('data-g') || '',
          t: r.getAttribute('data-t') || '',
          s: r.getAttribute('data-s') || ''
        }, state);
        r.hidden = !match;
        if (match) shown++;
      });
      // A month header with every row filtered out is noise, so hide it too.
      toArray(table.querySelectorAll('tr.oq-grp')).forEach(function (h) {
        var n = h.nextElementSibling, any = false;
        while (n && !n.classList.contains('oq-grp')) {
          if (n.classList.contains('oq-lr') && !n.hidden) { any = true; break; }
          n = n.nextElementSibling;
        }
        h.hidden = !any;
      });
      toArray(panel.querySelectorAll('.oq-chip')).forEach(function (c) {
        c.classList.toggle('oq-chip-on', c.getAttribute('data-g') === state.chip);
      });
      var wrap = document.getElementById('oqLedgerWrap');
      var none = document.getElementById('oqNoMatch');
      if (wrap) wrap.hidden = shown === 0;
      if (none) none.hidden = shown !== 0;
      writeJson(window.sessionStorage, LEDGER_KEY, state);
    }

    search.value = state.q;
    typeSel.value = state.type;
    search.addEventListener('input', function () { state.q = search.value; apply(); });
    typeSel.addEventListener('change', function () { state.type = typeSel.value; apply(); });
    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var chip = t.closest('.oq-chip');
      if (chip) { state.chip = chip.getAttribute('data-g'); apply(); return; }
      if (t.closest('[data-oq-clear]')) {
        e.preventDefault();
        state = normalizeLedgerState(null);
        search.value = '';
        typeSel.value = 'all';
        apply();
      }
    });
    apply();
  }

  // "💳 Payment link" — asks the server for a fresh PayMongo checkout session
  // for this order, then copies the URL, falling back to a visible textarea
  // where the clipboard API is refused (plain http).
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.oq-paylink');
    if (!btn) return;
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '… creating link';
    fetch('/admin/orders/' + encodeURIComponent(btn.getAttribute('data-ref')) + '/payment-link', { method: 'POST' })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok || !res.body.ok) {
          btn.textContent = res.body && res.body.reason === 'stale' ? '⚠ already paid/stale' : '⚠ failed — retry';
          setTimeout(function () { btn.textContent = original; }, 2500);
          return;
        }
        var url = res.body.url;
        function flashDone() {
          btn.textContent = '✅ Copied — paste in Messenger';
          setTimeout(function () { btn.textContent = original; }, 2500);
        }
        function fallback() {
          var ta = document.createElement('textarea');
          ta.value = url;
          ta.style.cssText = 'position:fixed;left:1rem;right:1rem;bottom:1rem;height:4rem;z-index:9999;font-size:0.8rem;';
          document.body.appendChild(ta);
          ta.select();
          var copied = false;
          try { copied = document.execCommand('copy'); } catch (err) { copied = false; }
          if (copied) { ta.remove(); flashDone(); }
          else { btn.textContent = '⬇ copy from the box'; setTimeout(function () { ta.remove(); btn.textContent = original; }, 15000); }
        }
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(url).then(flashDone).catch(fallback);
        } else {
          fallback();
        }
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = '⚠ failed — retry';
        setTimeout(function () { btn.textContent = original; }, 2500);
      });
  });

  function init() {
    tick();
    setInterval(tick, 1000);
    formatAges();
    initGroups();
    initLedger();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
```

- [ ] **Step 6: Run the tests**

```bash
node scripts/test-admin-orders-filter.js
node scripts/test-orders-template.js
node scripts/test-static-caching.js
node scripts/test-admin-tabs.js
```

Expected: `test-admin-orders-filter.js` ends `19 assertions passed`; the others pass as before (`test-orders-template.js` still `26 assertions passed`).

- [ ] **Step 7: Commit**

```bash
git add public/js/admin-orders.js views/admin.ejs views/partials/admin/notif-bell.ejs scripts/test-admin-orders-filter.js
git commit -m "$(cat <<'EOF'
Wire the Orders tab: ledger filters that persist, group memory, timers

The QR countdown loop stays page-wide because the dashboard overview's
countdown has always relied on it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Styles — replace the orders `oq-*` region

**Files:**
- Modify: `public/css/style.css` — replace the region from the line `.oq-online-form { margin-bottom: 1.25rem; }` through the line `body.light-mode .oq-empty { color: #888; }` (inclusive)
- Test: `scripts/test-orders-template.js` (append checks)

**Interfaces:**
- Consumes: the class names rendered by Task 2's partials.
- Produces: final styling. The rules **before** the region (`.oq-alert-*`) and **after** it (`.vf-*`, and `.oq-wl-pos` further down) are untouched.

- [ ] **Step 1: Write the failing checks**

In `scripts/test-orders-template.js`, insert before the final `console.log('\n' + passed + ' assertions passed\n');` line:

```js
console.log('\nstyles');

const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');

ok('every oq- class the tab renders has a rule', () => {
  // Hooks, not styling: state classes (oq-verifying_payment, …) and the
  // classes scripts and tests select on (oq-pill-pm, oq-group-name,
  // oq-code-copy, oq-ledger-h, oq-paylink).
  const HOOKS = /^oq-(verifying_payment|verifying_return|awaiting_\w+|pill-pm|group-name|code-copy|ledger-h|paylink)$/;
  const rendered = new Set([...html.matchAll(/class="([^"]*)"/g)]
    .flatMap(m => m[1].split(/\s+/))
    .filter(c => /^oq-/.test(c) && !HOOKS.test(c)));
  const missing = [...rendered].filter(c => !CSS.includes('.' + c));
  assert.deepStrictEqual(missing, []);
});

ok('rules for removed markup and dead rules are gone', () => {
  ['.oq-stats', '.oq-stat-v', '.oq-pm {', '.oq-pm-live', '.oq-export', '.oq-online-form', '.oq-online-toggle',
   '.oq-manual-', '.oq-funnel', '.oq-refunds {', '.oq-refund-row', '.oq-abandoned', '.oq-ab-row', '.oq-ab-right',
   '.oq-ab-btns', '.oq-sv-act', '.oq-sv-wait']
    .forEach(r => assert.ok(!CSS.includes(r), r + ' should be removed'));
});

ok('rules other templates rely on are still there', () => {
  ['.oq-alert-test', '.oq-alert-btn', '.oq-count', '.oq-wl-pos', '.oq-timer', '.oq-timer-dead']
    .forEach(r => assert.ok(CSS.includes(r), r));
});

ok('style.css is still CRLF throughout', () => {
  const lf = CSS.split('\n').length - 1;
  const crlf = CSS.split('\r\n').length - 1;
  assert.strictEqual(lf, crlf, 'every newline is CRLF');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/test-orders-template.js`
Expected: FAIL on `every oq- class the tab renders has a rule` (missing classes such as `oq-strip`, `oq-pill`, `oq-group`, `oq-more`).

- [ ] **Step 3: Write the new block to a temporary file**

Create `oq-block.tmp.css` in the repo root (it is deleted in Step 5) with exactly:

```css
/* ── Orders tab ──────────────────────────────────────────────────────────
   Markup: views/partials/admin/orders/{strip,needs-you,ledger}.ejs.
   Behaviour: public/js/admin-orders.js. */

/* Indicator strip: Quick Add, then small status pills. */
.oq-strip { display:flex; align-items:center; justify-content:space-between; gap:0.75rem; flex-wrap:wrap; margin-bottom:1rem; }
.oq-ind { display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap; }
.oq-ind-online { margin:0; }
.oq-pill { position:relative; display:inline-flex; align-items:center; gap:0.4rem; background:#111; border:1px solid #262626; border-radius:20px; padding:0.32rem 0.75rem; font-size:0.74rem; font-weight:700; color:#999; white-space:nowrap; text-decoration:none; }
.oq-pill input { position:absolute; opacity:0; width:0; height:0; }
.oq-pill-dot { width:7px; height:7px; border-radius:50%; background:#555; flex-shrink:0; }
.oq-ind-online .oq-pill { cursor:pointer; }
.oq-ind-online .oq-pill:focus-within { outline:2px solid var(--ps-blue); outline-offset:2px; }
.oq-pill-on { color:#d1fae5; border-color:rgba(34,197,94,0.45); }
.oq-pill-on .oq-pill-dot, .oq-pill-ok .oq-pill-dot { background:#22c55e; }
.oq-pill-idle .oq-pill-dot { background:#777; }
.oq-pill-bad { color:#fecaca; border-color:#ef4444; background:rgba(239,68,68,0.12); }
.oq-pill-bad .oq-pill-dot { background:#ef4444; }
.oq-pill-link { color:var(--ps-blue); cursor:pointer; }
.oq-pill-link:hover { border-color:var(--ps-blue); }
.oq-pm-warn { background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.4); border-radius:10px; color:#fca5a5; font-size:0.76rem; line-height:1.5; padding:0.55rem 0.85rem; margin:-0.4rem 0 1rem; }

/* Zone headings: Needs you / All orders. */
.oq-zone { display: flex; align-items: center; gap: 0.5rem; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; margin: 1.75rem 0 0.75rem; }
.oq-zone:first-child { margin-top: 0; }
.oq-zone-act { color: var(--ps-blue); margin-top: 0.5rem; }
.oq-zone-all { color: #8a8a8a; }
.oq-zone-n { font-variant-numeric: tabular-nums; color: #5a5a5a; font-weight: 700; }
.oq-zone-sub { margin-left: auto; font-size: 0.66rem; letter-spacing: 0.04em; text-transform: none; color: #5a5a5a; font-weight: 600; }
.oq-empty { color: #555; font-size: 0.9rem; padding: 2rem 0; text-align: center; }
.oq-empty a { color: var(--ps-blue); font-weight: 700; }

/* Needs You groups. */
.oq-group { margin-bottom: 0.6rem; }
.oq-group-h { display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; list-style:none; cursor:pointer; padding:0.45rem 0.1rem; font-size:0.8rem; font-weight:800; color:#ddd; }
.oq-group-h::-webkit-details-marker { display:none; }
.oq-group-h::before { content:'▸'; color:#666; font-size:0.7rem; transition:transform 0.15s; }
.oq-group[open] > .oq-group-h::before { transform:rotate(90deg); }
.oq-group-n { font-variant-numeric:tabular-nums; background:#1a1a1a; color:#aaa; border-radius:20px; padding:0.05rem 0.5rem; font-size:0.7rem; }
.oq-group-sub { font-size:0.7rem; font-weight:600; color:#666; }
.oq-group-now .oq-row { border-left:3px solid var(--ps-blue); }
.oq-group-refunds .oq-row, .oq-group-followups .oq-row { border-left:3px solid #f59e0b; }
.oq-group-waitlist .oq-row { border-left:3px solid #3a3a3a; }

/* Rows, shared by all four groups. */
.oq-row { display: flex; gap: 1rem; align-items: flex-start; background: #0d0d0d; border: 1px solid #222; border-radius: 12px; padding: 0.8rem 1rem; margin-bottom: 0.5rem; }
.oq-qr_pending { border-color: rgba(0,112,209,0.4); }
.oq-main { flex: 1; min-width: 0; }
.oq-top { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.35rem; }
.oq-ref { font-weight: 900; color: var(--ps-blue); font-size: 0.95rem; }
.oq-badge { font-size: 0.7rem; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; background: #1a1a1a; color: #888; padding: 0.15rem 0.5rem; border-radius: 5px; }
.oq-badge-res { background:#3a1a5c; color:#c9a4ff; }
.oq-badge-buy { background:#2a0a3a; color:#d9a7f0; }
.oq-timer { font-size: 0.75rem; font-weight: 800; color: #f59e0b; font-variant-numeric: tabular-nums; }
.oq-timer-dead { color: #ef4444; }
.oq-meta { font-size: 0.82rem; color: #888; margin-bottom: 0.25rem; }
.oq-fb { font-size: 0.8rem; color: #666; }
.oq-fb strong { color: #aaa; }
.oq-thread { color: var(--ps-blue); margin-left: 0.4rem; font-size: 0.76rem; }
.oq-proof { margin-top: 0.5rem; font-size: 0.8rem; }
.oq-proof a { color: var(--ps-blue); }
/* The typed sign-in code, sized to be read off the screen while typing it into
   the PlayStation App on a phone. */
.oq-signin-code { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.oq-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 1.05rem; font-weight: 800; letter-spacing: 0.14em; color: #fff;
  background: #111; border: 1px solid #2a2a2a; border-radius: 8px; padding: 0.3rem 0.6rem;
}
.oq-signin-code .rem-copy { padding: 0.3rem 0.6rem; font-size: 0.75rem; }
.oq-method { background: #1a1a1a; color: #aaa; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.5px; padding: 0.1rem 0.4rem; border-radius: 4px; margin-right: 0.4rem; }
/* The fee-inclusive figure a PayPal customer was actually asked to send. */
.oq-expected { font-size: 0.75rem; opacity: 0.75; margin-left: 0.4rem; white-space: nowrap; }
.oq-via-fb { color: #f59e0b; }
.oq-refund-amt { font-weight: 900; color: #f59e0b; }
.oq-ab-name { font-weight: 700; color: #ddd; }
.oq-ab-rejected { color: #ef4444; }
.oq-ab-age { font-size: 0.72rem; color: #666; white-space: nowrap; margin-left: auto; }
.oq-actions { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
.oq-actions form { margin: 0; }
.oq-btn-go { background: var(--ps-blue); color: #fff; border: 0; border-radius: 9px; padding: 0.6rem 0.9rem; font-weight: 800; font-size: 0.82rem; cursor: pointer; font-family: inherit; white-space: nowrap; }
.oq-btn-ghost { background: transparent; color: #bbb; border: 1px solid #2a2a2a; border-radius: 9px; padding: 0.5rem 0.8rem; font-weight: 700; font-size: 0.78rem; cursor: pointer; font-family: inherit; white-space: nowrap; }
.oq-btn-ghost:hover { border-color: #444; color: #fff; }
/* Priority-paid. Amber to match the ⭐ tier everywhere else on the site, and
   outlined so it does not outrank the primary action on rows that have one. */
.oq-btn-pri { background: transparent; color: #f59e0b; border: 1px solid rgba(245,158,11,0.4); border-radius: 9px; padding: 0.5rem 0.9rem; font-weight: 700; font-size: 0.78rem; cursor: pointer; font-family: inherit; white-space: nowrap; }
.oq-btn-pri:hover { background: rgba(245,158,11,0.12); border-color: #f59e0b; }
.oq-count { background: var(--ps-blue); color: #fff; border-radius: 20px; padding: 0.05rem 0.4rem; font-size: 0.7rem; font-weight: 900; margin-left: 0.3rem; }

/* ⋯ menu for rare or destructive row actions. */
.oq-more { position: relative; }
.oq-more-btn { list-style: none; cursor: pointer; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border: 1px solid #2a2a2a; border-radius: 9px; color: #888; font-weight: 900; font-size: 1rem; line-height: 1; }
.oq-more-btn::-webkit-details-marker { display: none; }
.oq-more-btn:hover, .oq-more[open] > .oq-more-btn { border-color: #444; color: #fff; }
.oq-more-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 170px; background: #141414; border: 1px solid #2a2a2a; border-radius: 10px; padding: 0.3rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 0.15rem; }
.oq-more-menu form { margin: 0; }
.oq-more-item { display: block; width: 100%; text-align: left; background: none; border: 0; border-radius: 7px; padding: 0.5rem 0.65rem; color: #ccc; font-size: 0.8rem; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
.oq-more-item:hover { background: #1e1e1e; color: #fff; }
.oq-more-danger { color: #f87171; }
.oq-more-danger:hover { background: rgba(239,68,68,0.12); color: #fca5a5; }

/* Ledger controls. */
.oq-ledger-bar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.7rem; }
.oq-period { display: flex; align-items: center; gap: 0.45rem; margin: 0; }
.oq-period label { font-size: 0.68rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #5a5a5a; }
.oq-period select { background: #141414; border: 1px solid #2a2a2a; border-radius: 8px; color: #ddd; padding: 0.38rem 0.65rem; font-size: 0.78rem; font-family: inherit; }
.oq-search { flex: 1; min-width: 180px; max-width: 280px; background: #141414; border: 1px solid #2a2a2a; border-radius: 8px; color: #fff; padding: 0.4rem 0.75rem; font-size: 0.78rem; font-family: inherit; }
.oq-search::placeholder { color: #4a4a4a; }
.oq-type { background: #141414; border: 1px solid #2a2a2a; border-radius: 8px; color: #ddd; padding: 0.38rem 0.65rem; font-size: 0.78rem; font-family: inherit; }
.oq-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.8rem; }
.oq-chip { background: transparent; border: 1px solid #2a2a2a; border-radius: 20px; padding: 0.28rem 0.7rem; font-size: 0.74rem; font-weight: 700; color: #8a8a8a; cursor: pointer; font-family: inherit; white-space: nowrap; }
.oq-chip:hover { border-color: #3a3a3a; color: #bbb; }
.oq-chip-on { background: var(--ps-blue); color: #000; border-color: var(--ps-blue); }
.oq-chip-n { font-variant-numeric: tabular-nums; opacity: 0.7; margin-left: 0.24rem; }

/* Ledger table. */
.oq-tw { overflow-x: auto; border: 1px solid #222; border-radius: 10px; }
.oq-tbl { width: 100%; border-collapse: collapse; font-size: 0.78rem; min-width: 680px; }
.oq-tbl th { text-align: left; font-size: 0.63rem; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; color: #5a5a5a; padding: 0.6rem 0.7rem; background: #111; border-bottom: 1px solid #222; white-space: nowrap; }
.oq-tbl td { padding: 0.6rem 0.7rem; border-bottom: 1px solid #1a1a1a; color: #8a8a8a; vertical-align: middle; }
.oq-tbl tr:last-child td { border-bottom: 0; }
.oq-grp td { background: #101010; border-bottom: 1px solid #222; font-size: 0.66rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #5a5a5a; padding: 0.45rem 0.7rem; }
.oq-grp-sum { float: right; color: #7c8794; font-variant-numeric: tabular-nums; }
.oq-lref { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-weight: 800; color: var(--ps-blue); white-space: nowrap; }
.oq-lcust { color: #d8d8d8; font-weight: 650; }
.oq-lgame { color: #c4c4c4; }
.oq-lmeta { white-space: nowrap; }
.oq-lnum { font-variant-numeric: tabular-nums; white-space: nowrap; }
.oq-ldates { white-space: nowrap; }
.oq-ltot { color: #fff; font-weight: 800; }
.oq-lst { min-width: 0; }
.oq-lact { text-align: right; white-space: nowrap; }
.oq-lact form { display: inline-block; }
.oq-lact-del { background: none; border: 1px solid #2a2a2a; border-radius: 7px; color: #666; font-size: 0.8rem; line-height: 1; padding: 0.32rem 0.5rem; cursor: pointer; font-family: inherit; }
.oq-lact-del:hover { border-color: #ef4444; color: #ef4444; }
/* Undo priority: amber on hover because it walks back the amber priority
   action rather than destroying anything. */
.oq-lact-undo { background: none; border: 1px solid #2a2a2a; border-radius: 7px; color: #666; font-size: 0.8rem; line-height: 1; padding: 0.32rem 0.5rem; cursor: pointer; font-family: inherit; margin-right: 0.3rem; }
.oq-lact-undo:hover { border-color: #f59e0b; color: #f59e0b; }
.oq-lact .rem-copy { background: none; border: 1px solid #2a2a2a; border-radius: 7px; color: #666; font-size: 0.8rem; font-weight: 400; line-height: 1; padding: 0.32rem 0.5rem; margin-right: 0.3rem; }
.oq-lact .rem-copy:hover { border-color: #f59e0b; color: #f59e0b; }
.oq-st { display: inline-flex; align-items: center; gap: 0.32rem; font-size: 0.7rem; font-weight: 700; white-space: nowrap; }
.oq-st-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: currentColor; }
.oq-st-live { color: #22c55e; }
.oq-st-done { color: #7c8794; }
.oq-st-wait { color: #f59e0b; }
.oq-st-dead { color: #ef4444; }
.oq-dep { font-size: 0.65rem; color: #f59e0b; margin-top: 0.15rem; }
.oq-dep-ok { color: #7c8794; }
/* [hidden] loses to any class that sets display, so filtered rows need this. */
.oq-tw[hidden], .oq-lr[hidden], .oq-grp[hidden], .oq-empty[hidden] { display: none !important; }

@media (max-width: 640px) {
  .oq-strip-add { width: 100%; }
  .oq-row { flex-direction: column; gap: 0.6rem; position: relative; }
  .oq-actions { justify-content: flex-start; width: 100%; }
  /* Anchored to the row card, not the ⋯ button: the button can sit anywhere
     from the left edge to mid-row, so a menu anchored to it ran off one side
     of the screen or the other. */
  .oq-more { position: static; }
  .oq-more-menu { left: 0.8rem; right: 0.8rem; top: calc(100% - 0.4rem); min-width: 0; }
  .oq-ledger-bar { flex-direction: column; align-items: stretch; }
  .oq-period { width: 100%; }
  .oq-period select, .oq-period .ss-wrap { flex: 1; }
  .oq-search { max-width: none; width: 100%; }
  .oq-type { width: 100%; }
  .oq-tw { overflow: visible; border: 0; }
  .oq-tbl { min-width: 0; }
  .oq-tbl thead { display: none; }
  .oq-tbl, .oq-tbl tbody, .oq-grp, .oq-grp td { display: block; }
  .oq-grp td { border-radius: 8px; margin-top: 0.6rem; }
  .oq-lr { display: grid; grid-template-columns: auto 1fr auto; grid-template-areas: "ref ref st" "cust game game" "meta dates tot" "act act act"; gap: 0.3rem 0.6rem; background: #0d0d0d; border: 1px solid #222; border-radius: 10px; padding: 0.65rem 0.8rem; margin-top: 0.45rem; }
  .oq-lr td { padding: 0; border: 0; }
  .oq-lref { grid-area: ref; }
  .oq-lst { grid-area: st; justify-self: end; text-align: right; }
  .oq-lcust { grid-area: cust; }
  .oq-lgame { grid-area: game; text-align: right; }
  .oq-lmeta { grid-area: meta; white-space: normal; }
  .oq-ldates { grid-area: dates; text-align: center; }
  .oq-ltot { grid-area: tot; text-align: right; }
  .oq-lact { grid-area: act; text-align: left; }
}

/* Orders: light mode. */
body.light-mode .oq-row,
body.light-mode .oq-pill,
body.light-mode .oq-more-menu { background: #fff; border-color: #ddd; }
body.light-mode .oq-pill { color: #555; }
body.light-mode .oq-pill-on { color: #166534; }
body.light-mode .oq-pill-bad { color: #b91c1c; background: #fef2f2; }
body.light-mode .oq-pm-warn { color: #b91c1c; background: #fef2f2; }
body.light-mode .oq-group-h { color: #14171a; }
body.light-mode .oq-group-n { background: #eef0f2; color: #555; }
body.light-mode .oq-more-item { color: #333; }
body.light-mode .oq-more-item:hover { background: #f2f4f7; color: #111; }
body.light-mode .oq-more-danger { color: #dc2626; }
body.light-mode .oq-btn-ghost { color: #555; border-color: #ccc; }
body.light-mode .oq-zone-n,
body.light-mode .oq-zone-sub,
body.light-mode .oq-period label,
body.light-mode .oq-tbl th,
body.light-mode .oq-grp td { color: #777; }
body.light-mode .oq-zone-all { color: #555; }
body.light-mode .oq-meta,
body.light-mode .oq-tbl td { color: #555; }
body.light-mode .oq-fb { color: #777; }
body.light-mode .oq-fb strong,
body.light-mode .oq-ab-name { color: #111; }
/* td-qualified so they outrank `.oq-tbl td` above — without it the customer,
   game and total all rendered in the same grey as everything else. */
body.light-mode .oq-tbl td.oq-lcust,
body.light-mode .oq-tbl td.oq-lgame,
body.light-mode .oq-tbl td.oq-ltot { color: #111; }
body.light-mode .oq-tw,
body.light-mode .oq-tbl th { border-color: #ddd; }
body.light-mode .oq-tbl td { border-bottom-color: #eee; }
body.light-mode .oq-tbl th,
body.light-mode .oq-grp td { background: #f6f7f9; }
body.light-mode .oq-lact-del,
body.light-mode .oq-lact-undo,
body.light-mode .oq-lact .rem-copy { border-color: #ddd; color: #999; }
body.light-mode .oq-lact-del:hover { border-color: #ef4444; color: #ef4444; }
body.light-mode .oq-lact-undo:hover,
body.light-mode .oq-lact .rem-copy:hover { border-color: #f59e0b; color: #f59e0b; }
body.light-mode .oq-period select,
body.light-mode .oq-search,
body.light-mode .oq-type { background: #f8f9fa; border-color: #ccc; color: #111; }
body.light-mode .oq-chip { border-color: #ccc; color: #555; }
body.light-mode .oq-chip-on { background: var(--ps-blue); color: #000; border-color: var(--ps-blue); }
body.light-mode .oq-badge { background: #eee; color: #555; }
body.light-mode .oq-empty { color: #888; }
@media (max-width: 640px) { body.light-mode .oq-lr { background: #fff; border-color: #ddd; } }
```

- [ ] **Step 4: Splice it in (CRLF-preserving)**

Run from the repo root:

```bash
node - <<'EOF'
const fs = require('fs');
const cssPath = 'public/css/style.css';
const css = fs.readFileSync(cssPath, 'utf8');
const START = '.oq-online-form { margin-bottom: 1.25rem; }';
const END = 'body.light-mode .oq-empty { color: #888; }';
const s = css.indexOf(START);
const e = css.indexOf(END);
if (s < 0 || e < 0 || e < s) throw new Error('region markers not found — stop and report');
if (css.indexOf(START, s + 1) !== -1 || css.indexOf(END, e + 1) !== -1) throw new Error('markers not unique — stop and report');
const block = fs.readFileSync('oq-block.tmp.css', 'utf8').replace(/\r?\n/g, '\r\n').replace(/(\r\n)+$/, '');
fs.writeFileSync(cssPath, css.slice(0, s) + block + css.slice(e + END.length));
console.log('replaced', e + END.length - s, 'chars with', block.length);
EOF
```

- [ ] **Step 5: Clean up and check**

```bash
rm oq-block.tmp.css
file public/css/style.css
git diff --stat public/css/style.css
```

Expected: `file` reports `with CRLF line terminators` and does **not** mention `LF` separately; the diff touches only `public/css/style.css`; `git status --short` shows no `oq-block.tmp.css`.

- [ ] **Step 6: Run the tests**

```bash
node scripts/test-orders-template.js
node scripts/test-admin-orders-filter.js
node scripts/test-static-caching.js
```

Expected: `test-orders-template.js` ends `30 assertions passed`; the others pass as before.

- [ ] **Step 7: Commit**

```bash
git add public/css/style.css scripts/test-orders-template.js
git status --short
git commit -m "$(cat <<'EOF'
Restyle the Orders tab: pills, grouped queue, ⋯ menus, phone ledger cards

Drops the rules for the removed stat cards, gateway banner, export and
online boxes, the old standalone zones, and the long-dead manual-order
and funnel rules. Settings' alert rules, the sidebar badge, the waitlist
position and the timer rules the dashboard uses are kept.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Browser verification with fixture orders

No code changes to the real repo unless a defect is found (then fix it, re-run the Task 2–4 tests, and commit the fix separately). Orders live in the production MongoDB, so **no live server's orders are used**: the partials are rendered with fixture orders into a static page served locally.

**Files:**
- Scratch only, under the session scratchpad (substitute its real path for `$SCRATCH`): `$SCRATCH/oq-check/build.js`, `$SCRATCH/oq-check/serve.js`, `$SCRATCH/oq-check/page.html`

- [ ] **Step 1: Build script**

Create `$SCRATCH/oq-check/build.js`:

```js
// Renders the real Orders partials with fixture orders into page.html.
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/michael/Desktop/claude code/playstation-hub';
const ejs = require(REPO + '/node_modules/ejs');

const now = Date.now();
const iso = ms => new Date(now - ms).toISOString();
const lo = (ref, state, extra) => Object.assign({
  ref, state, created_at: iso(3 * 86400e3), game_title: 'Tekken 8', account_type: 'nt',
  days: 30, amount_due: 349, deposit_due: 0, fb_name: 'Test Person', start_date: '2026-09-15', end_date: '2026-10-15'
}, extra || {});
const ledgerOrders = [
  lo('PH-0201', 'active', { fb_name: 'Nash Diaz', game_title: 'UFC 6' }),
  lo('PH-0202', 'closed', { is_buy: true, fb_name: 'Eugen Emillano', game_title: 'NBA2K27', amount_due: 2999 }),
  lo('PH-0203', 'reserved', { is_reservation: true, is_buy: true, upcoming_game_id: 9, fb_name: 'Arlloyd Paredes', game_title: 'The Blood of Dawnwalker' }),
  lo('PH-0204', 'awaiting_payment', { fb_name: 'Cairus Villacora', game_title: "Marvel's Wolverine" }),
  lo('PH-0205', 'cancelled'),
  lo('PH-0206', 'awaiting_return', { deposit_due: 100, fb_name: 'サンガラン マリ セデール', game_title: 'The Blood of Dawnwalker' })
];
const locals = {
  orderQueue: [
    lo('PH-0101', 'verifying_payment', { created_at: iso(5 * 3600e3), fb_name: 'Ana Cruz', payment_method: 'gcash', payment_proof: '/uploads/r.png' }),
    lo('PH-0102', 'qr_pending', { created_at: iso(3600e3), qr_expires_at: new Date(now + 9 * 60e3).toISOString(), qr_code: 'ABCD-EFGH', fb_name: 'Ben Reyes', account_type: 'tr', days: 7, deposit_due: 100, psid: '123' })
  ],
  refundsOwed: [lo('PH-0090', 'closed', { deposit_due: 100, fb_name: 'Dee Santos', game_title: 'Hogwarts Legacy' })],
  abandonedOrders: [
    lo('PH-0110', 'awaiting_payment', { created_at: iso(2 * 86400e3), fb_name: 'Eli Tan' }),
    lo('PH-0111', 'payment_rejected', { created_at: iso(4 * 3600e3), fb_name: 'Fay Ong', account_type: 'tr', days: 7, deposit_due: 100, psid: '456' })
  ],
  waitlistOrders: [
    lo('PH-0120', 'waitlisted', { game_id: 5, created_at: iso(10 * 86400e3), fb_name: 'Gio Yu', queuePosition: 2 }),
    lo('PH-0121', 'reserved', { game_id: 5, created_at: iso(8 * 86400e3), fb_name: 'Hana Go', queuePosition: 1, upgraded_from_waitlist: true })
  ],
  ledgerGroups: [{ key: '2026-09', label: '2026-09', paidCount: 4, paidTotal: 3947, orders: ledgerOrders }],
  ledgerStats: { needsYou: 2, qrLive: 1, out: 54, paidCount: 4, paidTotal: 3947, unpaid: 1, cancelled: 1, total: 6 },
  orderPeriod: '', orderPeriods: ['2026-09', '2026-08'], orderYears: ['2026'],
  abandonedCount: 10, startedCount: 30, orderStartRate: 1.4,
  paymongoMode: 'live',
  paymongoHealth: process.argv[2] === 'broken'
    ? { ok_count: 9, fail_count: 2, last_ok_at: iso(5 * 86400e3), last_fail_at: iso(86400e3) }
    : { ok_count: 9, fail_count: 0, last_ok_at: iso(5 * 86400e3) },
  settings: { owner_online: true, payment_methods: [{ key: 'gcash', label: 'GCash', enabled: true }] }
};
process.env.PAYMONGO_SECRET_KEY = 'sk_test_fixture';
const file = path.join(REPO, 'views/partials/admin/orders.ejs');
const body = ejs.render(fs.readFileSync(file, 'utf8'), locals, { filename: file })
  .replace('class="tab-panel"', 'class="tab-panel active"');
fs.writeFileSync(path.join(__dirname, 'page.html'), `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/style.css">
<style>body{background:#0a0a0a;color:#fff;padding:16px;font-family:system-ui}.tab-panel{display:block}</style>
</head><body class="admin-body">${body}
<button class="rem-copy" hidden></button>
<script src="/js/admin-searchable-select.js"></script>
<script src="/js/admin-orders.js"></script>
<script>function qaOpen(){ window.__qa = (window.__qa || 0) + 1; }</script>
</body></html>`);
console.log('wrote page.html (' + (process.argv[2] || 'healthy') + ' gateway)');
```

Create `$SCRATCH/oq-check/serve.js`:

```js
const http = require('http');
const fs = require('fs');
const REPO = 'C:/Users/michael/Desktop/claude code/playstation-hub';
const routes = {
  '/': [__dirname + '/page.html', 'text/html'],
  '/css/style.css': [REPO + '/public/css/style.css', 'text/css'],
  '/js/admin-searchable-select.js': [REPO + '/public/js/admin-searchable-select.js', 'application/javascript'],
  '/js/admin-orders.js': [REPO + '/public/js/admin-orders.js', 'application/javascript']
};
http.createServer((req, res) => {
  const r = routes[req.url.split('?')[0]];
  if (!r) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': r[1] + '; charset=utf-8' });
  fs.createReadStream(r[0]).pipe(res);
}).listen(4590, () => console.log('fixture page on 4590'));
```

- [ ] **Step 2: Build and serve**

```bash
cd "$SCRATCH/oq-check" && node build.js && (node serve.js > serve.log 2>&1 &) ; sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4590/
```

Expected: `wrote page.html (healthy gateway)` then `200`.

- [ ] **Step 3: Desktop checks (Browser pane at `http://localhost:4590/`, width ≥ 1100px)**

1. Three blocks only: strip, Needs You, All Orders. No stat cards, no full-width gateway box, no export or online boxes.
2. Strip: `⚡ Quick Add` left; `● Online` (green), `● LIVE · webhook ok` (green dot, **not red**), `⬇ Export` right. Hover tooltips carry the old sentences.
3. `NEEDS YOU 3`. Do now (2, open): PH-0102 on top with a ticking `m:ss left` countdown and the sign-in code; PH-0101 below. Refunds owed (1, open). Follow-ups (2, **collapsed**) heading reads `10 of 30 started this week · 1.4% of game views`. Waitlist (2, **collapsed**).
4. ⋯ on PH-0101 opens a menu with `Can't find it` and a red `Delete`; ⋯ on a follow-up shows `💳 Payment link`, `Cancel`, `Delete`. Visible buttons: `Payment confirmed`, `Sent it`, `📋 Copy` + `✅ Mark paid`, `📋 Copy` + `⭐ Priority paid`.
5. Open Waitlist, reload: it stays open. Close Do now, reload: it stays closed.
6. Ledger header `ALL ORDERS 6 · 4 paid · ₱3,947 · Last 3 months`. Chips `All 6 · Out on rent 2 · Completed 2 · Didn't pay 1 · Cancelled 1`.
7. Chip Out on rent → 2 rows. Type Purchases with All chip → 1 row (PH-0202); Reservations → PH-0203. Search `nash` → PH-0201. A combination with no match shows `No orders match these filters. Clear filters`, and Clear restores everything.
8. Set chip Out on rent + search `ufc`, reload: both are restored and still applied.
9. `read_console_messages` with `onlyErrors: true` → none.

- [ ] **Step 4: Broken gateway**

```bash
cd "$SCRATCH/oq-check" && node build.js broken
```

Reload: the gateway pill is red with `⚠ LIVE · webhook failing`, and the red warning line with `PAYMONGO_WEBHOOK_SECRET likely doesn't match this mode` sits under the strip. Rebuild healthy afterwards: `node build.js`.

- [ ] **Step 5: Phone checks (`resize_window` preset `mobile`, reload)**

1. Quick Add is full width; the three pills wrap beneath it.
2. Needs You rows stack text over buttons. Open **every** group, then check every ⋯ menu stays on screen — measure it rather than eyeballing, via `javascript_tool`:
   `[...document.querySelectorAll('.oq-more')].map(m => { m.open = true; const r = m.querySelector('.oq-more-menu').getBoundingClientRect(); m.open = false; return r.left >= 0 && r.right <= innerWidth; })` → all `true`.
3. Ledger toolbar stacks Period / Search / Type full width; chips wrap.
4. Ledger rows are cards (ref + status / customer + game / rental + dates + total / actions), with no horizontal page scroll: `document.documentElement.scrollWidth <= window.innerWidth` via `javascript_tool`.
5. If a screenshot comes back squeezed or duplicated, it is the pane's emulation auto-clearing — re-apply the preset and re-screenshot.
6. Add `light-mode` to `document.body.classList` via `javascript_tool` and confirm rows, pills, menus and chips stay readable; remove it again.
7. Reset with preset `desktop`.

- [ ] **Step 6: Clean up**

```bash
for pid in $(netstat -ano | grep ':4590' | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //F //PID "$pid"; done
rm -rf "$SCRATCH/oq-check"
cd "C:/Users/michael/Desktop/claude code/playstation-hub" && git status --short
```

Expected: `git status --short` shows nothing from this task (only the long-standing untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`).

- [ ] **Step 7: Full regression run**

```bash
cd "C:/Users/michael/Desktop/claude code/playstation-hub"
for f in scripts/test-*.js; do timeout 120 node "$f" > "$SCRATCH/out.txt" 2>&1 || { echo "FAILED: $f"; tail -20 "$SCRATCH/out.txt"; }; done
```

Expected: no `FAILED:` lines except `scripts/test-requests-page.js`, which already failed before this work began (confirmed against commit `24f41e0` during the Accounts redesign) and is out of scope — report it, don't fix it here.
