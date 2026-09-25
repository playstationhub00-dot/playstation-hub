# Admin Accounts Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the admin Accounts tab around two views (Slots, sorted by urgency; Accounts, compact rows grouped by price category) with status / type / game filters, search, clickable stat cards, and modals for Add/Edit account and slot status — usable on phone and desktop.

**Architecture:** Slot urgency, pill text and stat counts move into a new pure module `lib/accounts-view.js` that `buildAccountsView()` in `server.js` calls. `views/partials/admin/accounts.ejs` is rewritten to server-render both views, the filter bar and both modals, with every row carrying `data-*` attributes. A new `public/js/admin-accounts.js` does all filtering client-side over those attributes, and fills/opens the modals from one embedded JSON blob. The four existing POST routes are untouched.

**Tech Stack:** Node/Express 4, EJS, lowdb (accounts live in `games.json`), vanilla browser JS, plain CSS. Tests are plain `node scripts/test-*.js` files using `assert` (no test runner).

**Spec:** `docs/superpowers/specs/2026-09-25-admin-accounts-redesign-design.md`

## Global Constraints

- No change to any POST route, its field names, or its redirect targets: `/admin/accounts/add`, `/admin/accounts/edit/:id`, `/admin/accounts/delete/:id`, `/admin/accounts/:id/slot/:type`.
- `days_left` = whole calendar days from today's Asia/Manila date to the slot end date (`0` = ends today, `-1` = ended yesterday). **Ending ≤3d** = rented and `0 <= days_left <= 3`. **Overdue** = rented and `days_left < 0`. The two are disjoint.
- Slots view sort: Overdue (most overdue first) → rented with end date (soonest first) → rented, no end date → Open → Bought (`buyed`) → Maintenance → Not available (`na`); ties by account label A→Z, then type Trophy → Non-Trophy → PS4 Primary, then account id.
- Disabled slots never appear in the Slots view or the stat counts.
- `server.js` is UTF-8 **with BOM** and **CRLF** line endings. Edit it only with the Edit tool (never a scripted rewrite), and check `git diff --stat server.js` shows only the lines you meant to change. `public/css/style.css` is also CRLF — append with the Edit tool, not `cat >>`.
- Browser storage: filters in `sessionStorage` under key `accFilters`, last view in `localStorage` under key `accView`. Every storage read/write is wrapped in `try/catch` and the page works without storage.
- Status and Type filter `<select>`s and the slot-modal status `<select>` carry `data-ss-skip`. The Game filter and the slot-modal renter `<select>` do not (they get type-to-search from the existing `public/js/admin-searchable-select.js`).
- New script tag uses the cache-buster: `<script src="/js/admin-accounts.js?v=<%= assetV %>"></script>`.
- Phone breakpoint: `@media (max-width: 640px)`.
- Never log into the real admin panel. Browser checks run on a scratch copy of the repo with `requireAuth` patched to `return next();` — that patch is never made in, or committed to, the real repo.
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Work directly on `main` (this project's established practice). Do not push unless the user asks.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/accounts-view.js` | Create | Pure slot logic: `daysUntil`, `dueState`, `slotUrgency`, `slotPillLabel`, `decorateSlot`, `flattenSlots`, `slotStats` |
| `scripts/test-accounts-view.js` | Create | Unit tests for the module above |
| `public/js/admin-accounts.js` | Create | Filter predicates (exposed as `window.__accFilter`), filter/view DOM wiring, both modals |
| `scripts/test-admin-accounts-filter.js` | Create | Runs `admin-accounts.js` in a `vm` sandbox and tests the predicates; checks the script tag |
| `views/partials/admin/accounts.ejs` | Rewrite | Header, stat cards, toolbar, Slots view, Accounts view, empty states, JSON blob, both modals |
| `scripts/test-accounts-template.js` | Create | Renders the partial with fixture data and checks rows, escaping, attributes |
| `server.js` | Modify | `require` the new lib; `buildAccountsView()` uses it; delete now-unused `slotDaysLeft()` |
| `public/css/style.css` | Modify | New `acc-*` / `slot-pill` / `st-*` rules (moved out of the partial's inline `<style>`), phone and light-mode rules |
| `views/admin.ejs` | Modify | One `<script>` tag for `admin-accounts.js` |

---

### Task 1: Pure slot logic — `lib/accounts-view.js`

**Files:**
- Create: `lib/accounts-view.js`
- Test: `scripts/test-accounts-view.js`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `lib/accounts-view.js`):
  - `daysUntil(end: string, today: string) → number | null`
  - `dueState(slot) → 'overdue' | 'ending' | ''` (slot needs `status`, `days_left`)
  - `slotUrgency(slot) → 1..7`
  - `slotPillLabel(slot) → string`
  - `decorateSlot(slot, today) → { ...slot, days_left, due, urgency, pill }` (non-mutating)
  - `flattenSlots(accounts) → Array<{ account_id, account_label, type, status, enabled: true, end, days_left, due, urgency, pill, renter_id, renter_name }>` where `accounts` = `[{ id, label, slotView: { trophy, non_trophy, ps4_primary } }]` with each slot already passed through `decorateSlot`
  - `slotStats(accounts) → { total, open, rented, ending, overdue }` (same input shape)
  - `TYPES` = `['trophy', 'non_trophy', 'ps4_primary']`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-accounts-view.js`:

```js
// Run: node scripts/test-accounts-view.js
//
// The Accounts tab's slot logic: which slots are urgent, what their pill says,
// and the stat-card counts. Pure, so every boundary is checked here rather
// than by clicking through the admin panel.
const assert = require('assert');
const av = require('../lib/accounts-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const TODAY = '2026-09-25';
function slot(status, end, extra) {
  return Object.assign({ enabled: true, status, renter_id: null, renter_name: '', start: '', end: end || '' }, extra || {});
}
function account(id, label, slots) {
  const slotView = {};
  ['trophy', 'non_trophy', 'ps4_primary'].forEach(t => {
    slotView[t] = av.decorateSlot(slots[t] || slot('open', '', { enabled: false }), TODAY);
  });
  return { id, label, slotView };
}

console.log('\ndaysUntil()');

ok('0 on the end date itself, 1 the day before, -1 the day after', () => {
  assert.strictEqual(av.daysUntil('2026-09-25', TODAY), 0);
  assert.strictEqual(av.daysUntil('2026-09-26', TODAY), 1);
  assert.strictEqual(av.daysUntil('2026-09-24', TODAY), -1);
});

ok('crosses a month boundary', () => {
  assert.strictEqual(av.daysUntil('2026-10-02', TODAY), 7);
});

ok('null for a missing or malformed date', () => {
  assert.strictEqual(av.daysUntil('', TODAY), null);
  assert.strictEqual(av.daysUntil('26/09/2026', TODAY), null);
  assert.strictEqual(av.daysUntil('2026-09-26', ''), null);
});

console.log('\ndecorateSlot() — due state, urgency, pill');

ok('overdue vs ending boundary at -1, 0, 3, 4', () => {
  const d = end => av.decorateSlot(slot('rented', end), TODAY);
  assert.strictEqual(d('2026-09-24').due, 'overdue');
  assert.strictEqual(d('2026-09-25').due, 'ending');
  assert.strictEqual(d('2026-09-28').due, 'ending');
  assert.strictEqual(d('2026-09-29').due, '');
});

ok('pill text for each rented case', () => {
  const p = end => av.decorateSlot(slot('rented', end), TODAY).pill;
  assert.strictEqual(p('2026-09-23'), 'OVERDUE 2d');
  assert.strictEqual(p('2026-09-25'), 'ENDS TODAY');
  assert.strictEqual(p('2026-09-26'), '1d left');
  assert.strictEqual(p('2026-10-05'), '10d left');
  assert.strictEqual(p(''), 'RENTED');
});

ok('non-rented pills use the status name, and buyed reads BOUGHT', () => {
  assert.strictEqual(av.decorateSlot(slot('open'), TODAY).pill, 'OPEN');
  assert.strictEqual(av.decorateSlot(slot('buyed'), TODAY).pill, 'BOUGHT');
  assert.strictEqual(av.decorateSlot(slot('maintenance'), TODAY).pill, 'MAINTENANCE');
  assert.strictEqual(av.decorateSlot(slot('na'), TODAY).pill, 'NOT AVAILABLE');
});

ok('an end date left on a non-rented slot does not make it due', () => {
  const s = av.decorateSlot(slot('open', '2026-09-20'), TODAY);
  assert.strictEqual(s.days_left, null);
  assert.strictEqual(s.due, '');
});

ok('urgency bucket for every status', () => {
  const u = (st, end) => av.decorateSlot(slot(st, end), TODAY).urgency;
  assert.strictEqual(u('rented', '2026-09-24'), 1);
  assert.strictEqual(u('rented', '2026-09-30'), 2);
  assert.strictEqual(u('rented', ''), 3);
  assert.strictEqual(u('open'), 4);
  assert.strictEqual(u('buyed'), 5);
  assert.strictEqual(u('maintenance'), 6);
  assert.strictEqual(u('na'), 7);
});

ok('does not mutate the stored slot', () => {
  const raw = slot('rented', '2026-09-24');
  av.decorateSlot(raw, TODAY);
  assert.strictEqual(raw.due, undefined);
  assert.strictEqual(raw.pill, undefined);
  assert.strictEqual(raw.days_left, undefined);
});

console.log('\nflattenSlots() — urgency order');

const fixture = [
  account(1, 'Zeta Pack', { trophy: slot('open'), non_trophy: slot('rented', '2026-09-27', { renter_name: 'Ben' }), ps4_primary: slot('na') }),
  account(2, 'Alpha Pack', { trophy: slot('rented', '2026-09-22', { renter_name: 'Ana' }), non_trophy: slot('open'), ps4_primary: slot('buyed') }),
  account(3, 'Mid Pack', { trophy: slot('rented', ''), non_trophy: slot('maintenance'), ps4_primary: slot('rented', '2026-09-26') }),
  account(4, 'Off Pack', {})
];

ok('overdue, then soonest ending, then undated rentals, then open/bought/maintenance/na', () => {
  const rows = av.flattenSlots(fixture);
  assert.deepStrictEqual(rows.map(r => r.account_label + ':' + r.type), [
    'Alpha Pack:trophy',
    'Mid Pack:ps4_primary',
    'Zeta Pack:non_trophy',
    'Mid Pack:trophy',
    'Alpha Pack:non_trophy',
    'Zeta Pack:trophy',
    'Alpha Pack:ps4_primary',
    'Mid Pack:non_trophy',
    'Zeta Pack:ps4_primary'
  ]);
});

ok('disabled slots are left out entirely', () => {
  const rows = av.flattenSlots(fixture);
  assert.ok(!rows.some(r => r.account_id === 4));
  assert.strictEqual(rows.length, 9);
});

ok('ties on label fall back to slot type order, then account id', () => {
  const twins = [
    account(8, 'Same', { non_trophy: slot('open'), trophy: slot('open') }),
    account(7, 'Same', { trophy: slot('open') })
  ];
  assert.deepStrictEqual(av.flattenSlots(twins).map(r => r.account_id + ':' + r.type),
    ['7:trophy', '8:trophy', '8:non_trophy']);
});

ok('rows carry what the template renders', () => {
  const row = av.flattenSlots(fixture)[0];
  assert.strictEqual(row.account_id, 2);
  assert.strictEqual(row.account_label, 'Alpha Pack');
  assert.strictEqual(row.renter_name, 'Ana');
  assert.strictEqual(row.end, '2026-09-22');
  assert.strictEqual(row.pill, 'OVERDUE 3d');
  assert.strictEqual(row.due, 'overdue');
  assert.strictEqual(row.enabled, true);
});

ok('empty or missing input is an empty list', () => {
  assert.deepStrictEqual(av.flattenSlots([]), []);
  assert.deepStrictEqual(av.flattenSlots(null), []);
});

console.log('\nslotStats()');

ok('counts enabled slots only, with ending and overdue disjoint', () => {
  assert.deepStrictEqual(av.slotStats(fixture), { total: 9, open: 2, rented: 4, ending: 2, overdue: 1 });
});

ok('rented still includes the ending and overdue ones', () => {
  const s = av.slotStats(fixture);
  assert.ok(s.rented >= s.ending + s.overdue);
});

ok('no accounts is all zeroes', () => {
  assert.deepStrictEqual(av.slotStats([]), { total: 0, open: 0, rented: 0, ending: 0, overdue: 0 });
  assert.deepStrictEqual(av.slotStats(null), { total: 0, open: 0, rented: 0, ending: 0, overdue: 0 });
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-accounts-view.js`
Expected: FAIL — `Error: Cannot find module '../lib/accounts-view'`

- [ ] **Step 3: Write the implementation**

Create `lib/accounts-view.js`:

```js
// The admin Accounts tab's slot logic, kept pure so it can be tested: which
// slots are urgent, what their pill says, and the stat-card counts.
//
// days_left here is whole calendar days from `today` (a YYYY-MM-DD date in
// Asia/Manila, passed in by the caller) to the slot's end date: 0 = ends
// today, 1 = tomorrow, -1 = ended yesterday. The tab used to use server.js's
// slotDaysLeft(), which rounds up to end-of-day in server time (UTC), so a
// slot ending today read "1d left" and the day after read "0d left".

const TYPE_ORDER = { trophy: 0, non_trophy: 1, ps4_primary: 2 };
const TYPES = Object.keys(TYPE_ORDER);
const STATUS_LABEL = { open: 'OPEN', rented: 'RENTED', buyed: 'BOUGHT', maintenance: 'MAINTENANCE', na: 'NOT AVAILABLE' };
const ENDING_WITHIN_DAYS = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysUntil(end, today) {
  if (!DATE_RE.test(String(end || '')) || !DATE_RE.test(String(today || ''))) return null;
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}

// Only a rented slot with an end date can be overdue or ending.
function dueState(slot) {
  const s = slot || {};
  if (s.status !== 'rented' || s.days_left == null) return '';
  if (s.days_left < 0) return 'overdue';
  if (s.days_left <= ENDING_WITHIN_DAYS) return 'ending';
  return '';
}

function slotUrgency(slot) {
  const s = slot || {};
  if (s.status === 'rented') {
    if (s.days_left == null) return 3;
    return s.days_left < 0 ? 1 : 2;
  }
  if (s.status === 'open') return 4;
  if (s.status === 'buyed') return 5;
  if (s.status === 'maintenance') return 6;
  return 7;
}

function slotPillLabel(slot) {
  const s = slot || {};
  if (s.status === 'rented' && s.days_left != null) {
    if (s.days_left < 0) return 'OVERDUE ' + (-s.days_left) + 'd';
    if (s.days_left === 0) return 'ENDS TODAY';
    return s.days_left + 'd left';
  }
  return STATUS_LABEL[s.status] || STATUS_LABEL.na;
}

function decorateSlot(slot, today) {
  const s = Object.assign({}, slot);
  s.days_left = s.status === 'rented' ? daysUntil(s.end, today) : null;
  s.due = dueState(s);
  s.urgency = slotUrgency(s);
  s.pill = slotPillLabel(s);
  return s;
}

function compareSlotRows(a, b) {
  if (a.urgency !== b.urgency) return a.urgency - b.urgency;
  if (a.urgency <= 2 && a.days_left !== b.days_left) return a.days_left - b.days_left;
  const byLabel = String(a.account_label).localeCompare(String(b.account_label));
  if (byLabel) return byLabel;
  if (a.type !== b.type) return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  return a.account_id - b.account_id;
}

function flattenSlots(accounts) {
  const rows = [];
  (accounts || []).forEach(a => {
    TYPES.forEach(type => {
      const s = a && a.slotView && a.slotView[type];
      if (!s || !s.enabled) return;
      rows.push({
        account_id: a.id,
        account_label: a.label || '',
        type,
        status: s.status,
        enabled: true,
        end: s.end || '',
        days_left: s.days_left,
        due: s.due,
        urgency: s.urgency,
        pill: s.pill,
        renter_id: s.renter_id || null,
        renter_name: s.renter_name || ''
      });
    });
  });
  return rows.sort(compareSlotRows);
}

function slotStats(accounts) {
  const stats = { total: 0, open: 0, rented: 0, ending: 0, overdue: 0 };
  (accounts || []).forEach(a => TYPES.forEach(type => {
    const s = a && a.slotView && a.slotView[type];
    if (!s || !s.enabled) return;
    stats.total++;
    if (s.status === 'open') stats.open++;
    if (s.status === 'rented') {
      stats.rented++;
      if (s.due === 'ending') stats.ending++;
      if (s.due === 'overdue') stats.overdue++;
    }
  }));
  return stats;
}

module.exports = { daysUntil, dueState, slotUrgency, slotPillLabel, decorateSlot, flattenSlots, slotStats, TYPES };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-accounts-view.js`
Expected: every line `ok - …`, ending `17 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/accounts-view.js scripts/test-accounts-view.js
git commit -m "$(cat <<'EOF'
Add lib/accounts-view: slot urgency, pill text and stats for the Accounts tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Client filter predicates — `public/js/admin-accounts.js`

**Files:**
- Create: `public/js/admin-accounts.js`
- Test: `scripts/test-admin-accounts-filter.js`

**Interfaces:**
- Consumes: nothing (row data shapes are defined here and produced by the Task 3 template).
- Produces: `window.__accFilter = { normalizeState, statusMatches, chipMatches, slotMatches, accountMatches, activeFilterCount, isFiltering, plural }`
  - Filter state: `{ view: 'slots'|'accounts', q: string, status: 'all'|'open'|'rented'|'ending'|'overdue'|'buyed'|'maintenance'|'na', type: 'all'|'trophy'|'non_trophy'|'ps4_primary', game: '' | '<digits>' }`
  - Slot/chip item: `{ status, due: 'overdue'|'ending'|'', type, gameIds: string[], search: string (lower-case), disabled: boolean }`
  - `normalizeState(raw, fallbackView) → state`
  - `slotMatches(item, state) → boolean`
  - `accountMatches(accountItem, chipItems, state) → boolean`
  - `chipMatches(chipItem, state) → boolean`
  - `activeFilterCount(state) → number` (status, type, game — not search)
  - `isFiltering(state) → boolean` (any filter or non-blank search)
  - `plural(n, word) → string`
- The file ends with the IIFE's closing `})();`. Task 4 inserts the DOM wiring immediately before that line.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-admin-accounts-filter.js`:

```js
// Run: node scripts/test-admin-accounts-filter.js
//
// The Accounts tab filters run in the browser. This loads the real
// public/js/admin-accounts.js into a sandbox with no DOM (its DOM wiring is
// skipped when there is no document) and checks the filter rules it exposes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const FILE = path.join(__dirname, '..', 'public', 'js', 'admin-accounts.js');

function load() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox);
  assert.ok(sandbox.__accFilter, 'admin-accounts.js exposes window.__accFilter');
  return sandbox.__accFilter;
}

const F = load();
// Objects made inside the sandbox have another realm's prototypes, so compare
// plain JSON copies rather than the objects themselves.
const plain = o => JSON.parse(JSON.stringify(o));
const state = over => F.normalizeState(Object.assign({}, over));
function item(status, due, type, gameIds, search) {
  return { status, due: due || '', type, gameIds: gameIds || [], search: search || '', disabled: false };
}

console.log('\nnormalizeState()');

ok('defaults to the Slots view with nothing filtered', () => {
  assert.deepStrictEqual(plain(F.normalizeState(null)), { view: 'slots', q: '', status: 'all', type: 'all', game: '' });
});

ok('falls back to the remembered view only when the session has none', () => {
  assert.strictEqual(F.normalizeState({}, 'accounts').view, 'accounts');
  assert.strictEqual(F.normalizeState({ view: 'slots' }, 'accounts').view, 'slots');
});

ok('throws away values it does not recognise', () => {
  const s = F.normalizeState({ view: 'grid', status: 'lost', type: 'ps6', game: '12; drop', q: 5 }, 'nope');
  assert.deepStrictEqual(plain(s), { view: 'slots', q: '', status: 'all', type: 'all', game: '' });
});

ok('keeps valid values, game as a string', () => {
  const s = F.normalizeState({ view: 'accounts', status: 'overdue', type: 'trophy', game: 12, q: 'nba' });
  assert.deepStrictEqual(plain(s), { view: 'accounts', q: 'nba', status: 'overdue', type: 'trophy', game: '12' });
});

console.log('\nslotMatches() — status');

ok('Rented matches every rented slot, including ending and overdue', () => {
  const f = state({ status: 'rented' });
  assert.ok(F.slotMatches(item('rented', '', 'trophy'), f));
  assert.ok(F.slotMatches(item('rented', 'ending', 'trophy'), f));
  assert.ok(F.slotMatches(item('rented', 'overdue', 'trophy'), f));
  assert.ok(!F.slotMatches(item('open', '', 'trophy'), f));
});

ok('Ending and Overdue are the narrow subsets and never overlap', () => {
  assert.ok(F.slotMatches(item('rented', 'ending', 'trophy'), state({ status: 'ending' })));
  assert.ok(!F.slotMatches(item('rented', 'overdue', 'trophy'), state({ status: 'ending' })));
  assert.ok(F.slotMatches(item('rented', 'overdue', 'trophy'), state({ status: 'overdue' })));
  assert.ok(!F.slotMatches(item('rented', '', 'trophy'), state({ status: 'overdue' })));
});

ok('every plain status matches only itself', () => {
  ['open', 'buyed', 'maintenance', 'na'].forEach(st => {
    assert.ok(F.slotMatches(item(st, '', 'trophy'), state({ status: st })), st);
    assert.ok(!F.slotMatches(item('rented', '', 'trophy'), state({ status: st })), st + ' vs rented');
  });
});

console.log('\nslotMatches() — type, game, search');

ok('type narrows to one slot type', () => {
  assert.ok(F.slotMatches(item('open', '', 'trophy'), state({ type: 'trophy' })));
  assert.ok(!F.slotMatches(item('open', '', 'non_trophy'), state({ type: 'trophy' })));
});

ok('game matches any account that contains it', () => {
  assert.ok(F.slotMatches(item('open', '', 'trophy', ['3', '12']), state({ game: '12' })));
  assert.ok(!F.slotMatches(item('open', '', 'trophy', ['3']), state({ game: '12' })));
});

ok('search is case-insensitive and ignores surrounding spaces', () => {
  const s = item('rented', '', 'trophy', [], 'pshub nba pack ana cruz nba 2k27');
  assert.ok(F.slotMatches(s, state({ q: '  Ana CRUZ ' })));
  assert.ok(!F.slotMatches(s, state({ q: 'tekken' })));
});

ok('all filters together: an open Trophy slot for game 12', () => {
  const f = state({ status: 'open', type: 'trophy', game: '12' });
  assert.ok(F.slotMatches(item('open', '', 'trophy', ['12']), f));
  assert.ok(!F.slotMatches(item('open', '', 'non_trophy', ['12']), f));
  assert.ok(!F.slotMatches(item('rented', '', 'trophy', ['12']), f));
  assert.ok(!F.slotMatches(item('open', '', 'trophy', ['7']), f));
});

console.log('\naccountMatches() — Accounts view');

const acct = { gameIds: ['12'], search: 'pshub nba pack' };
const chips = [
  { status: 'open', due: '', type: 'trophy', disabled: false },
  { status: 'rented', due: 'ending', type: 'non_trophy', disabled: false },
  { status: 'open', due: '', type: 'ps4_primary', disabled: true }
];

ok('with no status or type filter every account shows, even one with only disabled slots', () => {
  assert.ok(F.accountMatches(acct, chips, state({})));
  assert.ok(F.accountMatches(acct, [{ status: 'open', due: '', type: 'trophy', disabled: true }], state({})));
});

ok('shows when ANY enabled slot matches status and type together', () => {
  assert.ok(F.accountMatches(acct, chips, state({ status: 'ending' })));
  assert.ok(F.accountMatches(acct, chips, state({ status: 'open', type: 'trophy' })));
  assert.ok(!F.accountMatches(acct, chips, state({ status: 'open', type: 'non_trophy' })),
    'open and non-trophy are true of different slots');
});

ok('a disabled slot never counts as a match', () => {
  assert.ok(!F.accountMatches(acct, chips, state({ type: 'ps4_primary' })));
});

ok('game and search apply to the account as a whole', () => {
  assert.ok(!F.accountMatches(acct, chips, state({ game: '7' })));
  assert.ok(!F.accountMatches(acct, chips, state({ q: 'tekken' })));
  assert.ok(F.accountMatches(acct, chips, state({ q: 'NBA', status: 'open' })));
});

console.log('\ncounts');

ok('Filters (n) counts status, type and game but not search', () => {
  assert.strictEqual(F.activeFilterCount(state({ q: 'nba' })), 0);
  assert.strictEqual(F.activeFilterCount(state({ status: 'open', type: 'trophy', game: '3' })), 3);
});

ok('isFiltering is true for a search alone, false for whitespace', () => {
  assert.strictEqual(F.isFiltering(state({ q: 'nba' })), true);
  assert.strictEqual(F.isFiltering(state({ q: '   ' })), false);
  assert.strictEqual(F.isFiltering(state({})), false);
});

ok('plural', () => {
  assert.strictEqual(F.plural(1, 'slot'), '1 slot');
  assert.strictEqual(F.plural(0, 'account'), '0 accounts');
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-admin-accounts-filter.js`
Expected: FAIL — `ENOENT: no such file or directory` for `public/js/admin-accounts.js`

- [ ] **Step 3: Write the implementation**

Create `public/js/admin-accounts.js`:

```js
// Admin → Accounts tab: filters, the Slots/Accounts view toggle, and the
// account and slot modals. Loaded on every admin page; the DOM wiring only
// runs when the tab's markup is present, and never in the test sandbox.
(function () {
  'use strict';

  var STATUS_VALUES = ['all', 'open', 'rented', 'ending', 'overdue', 'buyed', 'maintenance', 'na'];
  var TYPE_VALUES = ['all', 'trophy', 'non_trophy', 'ps4_primary'];
  var VIEWS = ['slots', 'accounts'];
  var FILTER_KEY = 'accFilters';
  var VIEW_KEY = 'accView';

  function isAll(v) { return !v || v === 'all'; }

  // Anything read back from storage is untrusted: unknown values fall back to
  // defaults rather than filtering the list down to nothing.
  function normalizeState(raw, fallbackView) {
    var r = raw || {};
    var view = VIEWS.indexOf(r.view) !== -1 ? r.view
      : (VIEWS.indexOf(fallbackView) !== -1 ? fallbackView : 'slots');
    return {
      view: view,
      q: typeof r.q === 'string' ? r.q.slice(0, 100) : '',
      status: STATUS_VALUES.indexOf(r.status) !== -1 ? r.status : 'all',
      type: TYPE_VALUES.indexOf(r.type) !== -1 ? r.type : 'all',
      game: /^\d+$/.test(String(r.game == null ? '' : r.game)) ? String(r.game) : ''
    };
  }

  // "Rented" means every rented slot; "Ending" and "Overdue" are the narrower
  // subsets the template marks with data-due.
  function statusMatches(status, due, want) {
    if (isAll(want)) return true;
    if (want === 'ending' || want === 'overdue') return status === 'rented' && due === want;
    return status === want;
  }

  function chipMatches(chip, f) {
    return statusMatches(chip.status, chip.due, f.status) && (isAll(f.type) || chip.type === f.type);
  }

  function textAndGameMatch(item, f) {
    if (f.game && item.gameIds.indexOf(String(f.game)) === -1) return false;
    var q = String(f.q || '').trim().toLowerCase();
    return !q || item.search.indexOf(q) !== -1;
  }

  function slotMatches(item, f) {
    return chipMatches(item, f) && textAndGameMatch(item, f);
  }

  // An account shows when it matches search and game, and at least one of its
  // enabled slots matches status and type together.
  function accountMatches(account, chips, f) {
    if (!textAndGameMatch(account, f)) return false;
    if (isAll(f.status) && isAll(f.type)) return true;
    return chips.some(function (c) { return !c.disabled && chipMatches(c, f); });
  }

  function activeFilterCount(f) {
    return (isAll(f.status) ? 0 : 1) + (isAll(f.type) ? 0 : 1) + (f.game ? 1 : 0);
  }

  function isFiltering(f) {
    return activeFilterCount(f) > 0 || String(f.q || '').trim() !== '';
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  window.__accFilter = {
    normalizeState: normalizeState,
    statusMatches: statusMatches,
    chipMatches: chipMatches,
    slotMatches: slotMatches,
    accountMatches: accountMatches,
    activeFilterCount: activeFilterCount,
    isFiltering: isFiltering,
    plural: plural
  };
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-admin-accounts-filter.js`
Expected: every line `ok - …`, ending `18 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add public/js/admin-accounts.js scripts/test-admin-accounts-filter.js
git commit -m "$(cat <<'EOF'
Add Accounts tab filter rules (status, type, game, search) with tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Server wiring, template rewrite and CSS

**Files:**
- Modify: `server.js` — add a `require` next to line 22 (`const dashboard = require('./lib/dashboard');`); delete `slotDaysLeft()` (lines 748–754); rewrite the body of `buildAccountsView()` (starts ~line 5845)
- Rewrite: `views/partials/admin/accounts.ejs` (entire file)
- Modify: `public/css/style.css` — append one block at the end of the file
- Test: `scripts/test-accounts-template.js`

**Interfaces:**
- Consumes: from Task 1 — `decorateSlot(slot, today)`, `flattenSlots(accounts)`, `slotStats(accounts)`.
- Produces, for Task 4 (element ids and attributes the JS reads — do not rename):
  - Root `#tab-accounts`. Header button `[data-acc-add]`. Stat cards `button.acc-stat[data-acc-stat="all|open|rented|ending|overdue"]`.
  - When at least one account exists: toolbar with `[data-acc-view="slots|accounts"]` buttons, `#accSearch`, `#accFilterBtn` containing `#accFilterBtnCount`, `#accFilterPanel` holding `#accStatus`, `#accType`, `#accGame`, `a#accClear[data-acc-clear]`; `#accCount`; `#accSlotsView` with `.acc-srow` rows; `#accAccountsView` (starts `hidden`) with `.acc-group` > `.acc-group-count` and `.acc-arow` rows containing `.acc-chip` elements; `#accEmpty` > `#accEmptyMsg` + `a#accEmptyClear[data-acc-clear]`.
  - When no accounts exist: `#accNone` instead of the toolbar and both views.
  - Row attributes: `.acc-srow` → `data-status data-due data-type data-game-ids data-search`; `.acc-arow` → `data-game-ids data-search`; enabled `.acc-chip` → `data-type data-status data-due data-acc-slot="<id>:<type>"`; disabled `.acc-chip` → `data-type data-disabled="1"`. Slots-view pill → `data-acc-slot="<id>:<type>"`. Edit button → `data-acc-edit="<id>"`.
  - `<script type="application/json" id="accData">` → `{ accounts: { "<id>": { label, email, games_text, note, game_ids: number[], price_permanent_tr, price_permanent_nt, public_name, for_sale, slots: { trophy|non_trophy|ps4_primary: { enabled, status, renter_id, end } } } } }`
  - Account modal: `#accModal` (`.qa-overlay`), `#accModalTitle`, `form#accForm` with fields `label, email, games_text, note, price_permanent_tr, price_permanent_nt, public_name, enable_trophy, enable_non_trophy, enable_ps4_primary, for_sale`, checkboxes `input[name="game_ids"][data-title]` inside `label.acc-gpick-item`, `#accGameSearch`, `#accGameChips`, `#accModalSubmit`, close controls `[data-acc-close]`.
  - Slot modal: `#accSlotModal` (`.qa-overlay`), `#accSlotTitle`, `form#accSlotForm` with `select[name=status]`, `select[name=renter_id]`, `input[name=days]`, `input[name=end_date]`, wrappers `#accSlotRenterWrap`, `#accSlotDatesWrap`, close controls `[data-acc-close]`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-accounts-template.js`:

```js
// Run: node scripts/test-accounts-template.js
//
// Renders views/partials/admin/accounts.ejs with fixture data built by the
// real lib/accounts-view.js, and checks the markup the client script relies on.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const av = require('../lib/accounts-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const FILE = path.join(__dirname, '..', 'views', 'partials', 'admin', 'accounts.ejs');
const TODAY = '2026-09-25';
const TYPES = ['trophy', 'non_trophy', 'ps4_primary'];

function slot(status, end, extra) {
  return Object.assign({ enabled: true, status, renter_id: null, renter_name: '', start: '', end: end || '' }, extra || {});
}
function account(id, label, slots, extra) {
  const a = Object.assign({
    id, label, email: '', games_text: '', note: '', game_ids: [],
    price_permanent_tr: 5000, price_permanent_nt: 4500, for_sale: false, public_name: '', slots: {}
  }, extra || {});
  TYPES.forEach(t => { a.slots[t] = slots[t] || slot('open', '', { enabled: false }); });
  a.slotView = {};
  TYPES.forEach(t => { a.slotView[t] = av.decorateSlot(a.slots[t], TODAY); });
  a.category_name = 'New Games';
  return a;
}
function render(accounts) {
  const accountsView = {
    accounts,
    groups: accounts.length ? [{ name: 'New Games', accounts }] : [],
    slots: av.flattenSlots(accounts),
    stats: av.slotStats(accounts),
    STATUSES: ['open', 'rented', 'buyed', 'na', 'maintenance']
  };
  const games = [
    { id: 12, title: 'NBA 2K27', platform: 'PS5', cover_image: '/uploads/nba.webp' },
    { id: 3, title: 'Tekken 8', platform: 'PS5', cover_image: '' }
  ];
  const customers = [{ id: 40, customer_name: 'Ana Cruz' }];
  return ejs.render(fs.readFileSync(FILE, 'utf8'), { accountsView, games, customers }, { filename: FILE });
}

const EVIL = 'Pack </script><script>alert(1)</script>';
const accounts = [
  account(1, 'Zeta Pack', {
    trophy: slot('open'),
    non_trophy: slot('rented', '2026-09-27', { renter_id: 40, renter_name: 'Ana Cruz' })
  }, { game_ids: [12, 3], email: 'z@x.com' }),
  account(2, EVIL, { trophy: slot('rented', '2026-09-22') }, { game_ids: [3], note: 'n </script>' })
];
const html = render(accounts);

console.log('\nSlots view');

ok('one row per enabled slot, most urgent first', () => {
  const rows = [...html.matchAll(/class="acc-srow" data-status="(\w+)" data-due="(\w*)" data-type="(\w+)"/g)]
    .map(m => m[1] + ':' + m[2] + ':' + m[3]);
  assert.deepStrictEqual(rows, ['rented:overdue:trophy', 'rented:ending:non_trophy', 'open::trophy']);
});

ok('game ids ride on the rows for the Game filter', () => {
  assert.ok(html.includes('data-game-ids="12,3"'));
});

ok('search haystacks are lower-case and include the renter', () => {
  assert.ok(/data-search="[^"]*ana cruz[^"]*"/.test(html));
  const hays = [...html.matchAll(/data-search="([^"]*)"/g)].map(m => m[1]);
  assert.ok(hays.length > 0);
  hays.forEach(h => assert.strictEqual(h, h.toLowerCase()));
});

console.log('\nAccounts view');

ok('one row per account', () => {
  assert.strictEqual((html.match(/class="acc-arow"/g) || []).length, 2);
});

ok('disabled slots render as dim, non-clickable chips', () => {
  assert.ok(html.includes('<span class="acc-chip slot-pill st-disabled" data-type="ps4_primary" data-disabled="1"'));
});

ok('enabled chips open the slot modal', () => {
  assert.ok(html.includes('data-acc-slot="1:non_trophy"'));
});

console.log('\nstats, filters, data');

ok('stat cards include Overdue, with ending and overdue counted apart', () => {
  assert.ok(/data-acc-stat="overdue"[^]*?<span class="val">1<\/span>/.test(html));
  assert.ok(/data-acc-stat="ending"[^]*?<span class="val">1<\/span>/.test(html));
});

ok('status and type filters stay native selects; the game filter is searchable', () => {
  assert.ok(html.includes('<select id="accStatus" data-ss-skip'));
  assert.ok(html.includes('<select id="accType" data-ss-skip'));
  assert.ok(/<select id="accGame"(?![^>]*data-ss-skip)[^>]*>/.test(html));
});

ok('the account data survives a label that tries to close the script tag', () => {
  const m = html.match(/<script type="application\/json" id="accData">([\s\S]*?)<\/script>/);
  assert.ok(m, 'accData block present');
  assert.ok(!m[1].includes('</script'), 'no raw </script> inside the JSON');
  const data = JSON.parse(m[1]);
  assert.strictEqual(data.accounts['2'].label, EVIL);
  assert.strictEqual(data.accounts['2'].note, 'n </script>');
  assert.deepStrictEqual(data.accounts['1'].game_ids, [12, 3]);
  assert.strictEqual(data.accounts['1'].slots.non_trophy.renter_id, 40);
  assert.strictEqual(data.accounts['1'].slots.ps4_primary.enabled, false);
});

ok('labels are HTML-escaped everywhere else', () => {
  assert.ok(!html.includes('<script>alert(1)</script>'));
});

ok('no inline <style> and no executable inline <script> left in the partial', () => {
  assert.ok(!/<style/.test(html));
  const scripts = html.match(/<script(?![^>]*type="application\/json")[^>]*>/g) || [];
  assert.deepStrictEqual(scripts, []);
});

ok('the slot modal lists customers for the renter picker', () => {
  assert.ok(/<select class="qa-in" name="renter_id">[\s\S]*?<option value="40">Ana Cruz<\/option>/.test(html));
  assert.ok(html.includes('<select class="qa-in" name="status" data-ss-skip>'));
});

ok('the account modal offers every catalogue game as a checkbox', () => {
  assert.ok(html.includes('name="game_ids" value="12" data-title="NBA 2K27"'));
  assert.ok(html.includes('name="game_ids" value="3" data-title="Tekken 8"'));
});

console.log('\nno accounts yet');

ok('a friendly empty state, no list markup, and the Add modal still present', () => {
  const empty = render([]);
  assert.ok(empty.includes('id="accNone"'));
  assert.ok(!empty.includes('id="accSlotsView"'));
  assert.ok(empty.includes('id="accModal"'));
  assert.ok(empty.includes('data-acc-add'));
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-accounts-template.js`
Expected: FAIL — the old partial reads `accountsView.stats.ending` fine but has no `acc-srow`, so the first assertion fails with an `AssertionError` (actual `[]`).

- [ ] **Step 3: Wire `buildAccountsView()` to the new module (server.js)**

Use the Edit tool for all three edits (CRLF + BOM must survive).

3a. After the line `const dashboard = require('./lib/dashboard');` add:

```js
const accountsViewLib = require('./lib/accounts-view');
```

3b. Delete these lines entirely (the function becomes unused):

```js
// Days until a slot's end date (null if no end date). Negative = expired.
function slotDaysLeft(slot) {
  if (!slot || !slot.end) return null;
  const end = new Date(slot.end + 'T23:59:59');
  if (isNaN(end)) return null;
  return Math.ceil((end - new Date()) / 86400000);
}
```

3c. In `buildAccountsView()`, replace:

```js
  const accounts = getAccounts().map(a => {
    const slotView = {};
    ACCOUNT_SLOT_TYPES.forEach(t => {
      slotView[t] = { ...a.slots[t], days_left: slotDaysLeft(a.slots[t]) };
    });
```

with:

```js
  // days_left, due state, urgency and pill text come from lib/accounts-view,
  // counted in Manila calendar days so "ENDS TODAY" means today in the PH.
  const today = orders.manilaDate();
  const accounts = getAccounts().map(a => {
    const slotView = {};
    ACCOUNT_SLOT_TYPES.forEach(t => {
      slotView[t] = accountsViewLib.decorateSlot(a.slots[t], today);
    });
```

and replace:

```js
  // Summary stats
  const stats = { total: 0, open: 0, rented: 0, ending: 0 };
  accounts.forEach(a => ACCOUNT_SLOT_TYPES.forEach(t => {
    const s = a.slotView[t];
    if (!s.enabled) return;
    stats.total++;
    if (s.status === 'open') stats.open++;
    if (s.status === 'rented') { stats.rented++; if (s.days_left != null && s.days_left <= 3) stats.ending++; }
  }));
  return { accounts, groups, stats, STATUSES: ACCOUNT_STATUSES };
```

with:

```js
  return {
    accounts,
    groups,
    slots: accountsViewLib.flattenSlots(accounts),
    stats: accountsViewLib.slotStats(accounts),
    STATUSES: ACCOUNT_STATUSES
  };
```

Then run:

```bash
grep -n "slotDaysLeft" server.js
node --check server.js
git diff --stat server.js
```

Expected: `grep` prints nothing; `node --check` prints nothing; the diff stat shows `server.js` with roughly 15 insertions and 20 deletions — not hundreds (hundreds means line endings were rewritten; undo with `git checkout -- server.js` and redo with the Edit tool).

- [ ] **Step 4: Rewrite the partial**

Replace the whole of `views/partials/admin/accounts.ejs` with:

```ejs
<div class="tab-panel" id="tab-accounts">
<%
  // Admin → Accounts. Two views over the same data: Slots (one row per
  // enabled slot, most urgent first) and Accounts (one row per account,
  // grouped by price category). Filtering, the view toggle and both modals
  // are in public/js/admin-accounts.js; styles are the acc-* block in
  // public/css/style.css.
  const ACC_TYPES = ['trophy', 'non_trophy', 'ps4_primary'];
  const ACC_TYPE_LABEL = { trophy: '🏆 Trophy', non_trophy: '🎮 Non-Trophy', ps4_primary: '🕹️ PS4 Primary' };
  const ACC_TYPE_ICON = { trophy: '🏆', non_trophy: '🎮', ps4_primary: '🕹️' };
  const ACC_STATUS_OPTIONS = [['open', 'Open'], ['rented', 'Rented'], ['buyed', 'Bought'], ['maintenance', 'Maintenance'], ['na', 'Not available']];
  const accGames = [...games].sort((a, b) => a.title.localeCompare(b.title));
  const accGameById = {};
  accGames.forEach(g => { accGameById[g.id] = g; });
  const accById = {};
  accountsView.accounts.forEach(a => { accById[a.id] = a; });
  const accTitles = a => a.game_ids.map(id => (accGameById[id] ? accGameById[id].title : '')).filter(Boolean);
  const accPillClass = s => 'st-' + (s.due || s.status);
  const accShortDate = d => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
  const accHaystack = (a, renters) => [a.label, a.email, a.games_text, accTitles(a).join(' '), renters].join(' ').toLowerCase();
  const accData = { accounts: {} };
  accountsView.accounts.forEach(a => {
    const slots = {};
    ACC_TYPES.forEach(t => {
      const s = a.slotView[t];
      slots[t] = { enabled: !!s.enabled, status: s.status, renter_id: s.renter_id || null, end: s.end || '' };
    });
    accData.accounts[a.id] = {
      label: a.label, email: a.email || '', games_text: a.games_text || '', note: a.note || '',
      game_ids: a.game_ids, price_permanent_tr: a.price_permanent_tr, price_permanent_nt: a.price_permanent_nt,
      public_name: a.public_name || '', for_sale: !!a.for_sale, slots
    };
  });
  const accStats = accountsView.stats;
%>

  <div class="acc-head">
    <div>
      <div class="acc-title">Accounts</div>
      <div class="acc-sub">Each PSN account and its Trophy / Non-Trophy / PS4 Primary slots.</div>
    </div>
    <button type="button" class="btn btn-primary acc-add-btn" data-acc-add>+ Add Account</button>
  </div>

  <div class="acc-stats">
    <button type="button" class="acc-stat acc-stat-total" data-acc-stat="all"><span class="lbl">Total slots</span><span class="val"><%= accStats.total %></span></button>
    <button type="button" class="acc-stat acc-stat-open" data-acc-stat="open"><span class="lbl">Open</span><span class="val"><%= accStats.open %></span></button>
    <button type="button" class="acc-stat acc-stat-rented" data-acc-stat="rented"><span class="lbl">Rented</span><span class="val"><%= accStats.rented %></span></button>
    <button type="button" class="acc-stat acc-stat-ending" data-acc-stat="ending"><span class="lbl">Ending ≤3 days</span><span class="val"><%= accStats.ending %></span></button>
    <button type="button" class="acc-stat acc-stat-overdue" data-acc-stat="overdue"><span class="lbl">Overdue</span><span class="val"><%= accStats.overdue %></span></button>
  </div>

  <% if (!accountsView.accounts.length) { %>
  <div class="acc-empty" id="accNone">No accounts yet — use <b>+ Add Account</b> to create your first one.</div>
  <% } else { %>

  <div class="acc-toolbar">
    <div class="acc-views" role="group" aria-label="View">
      <button type="button" data-acc-view="slots" class="on" aria-pressed="true">Slots</button>
      <button type="button" data-acc-view="accounts" aria-pressed="false">Accounts</button>
    </div>
    <input type="search" id="accSearch" class="acc-search" placeholder="Search account, game, email or renter…" autocomplete="off">
    <button type="button" id="accFilterBtn" class="acc-filter-btn">Filters<span id="accFilterBtnCount"></span></button>
    <div class="acc-filters" id="accFilterPanel">
      <select id="accStatus" data-ss-skip aria-label="Slot status">
        <option value="all">All statuses</option>
        <option value="open">Open</option>
        <option value="rented">Rented</option>
        <option value="ending">Ending ≤3 days</option>
        <option value="overdue">Overdue</option>
        <option value="buyed">Bought</option>
        <option value="maintenance">Maintenance</option>
        <option value="na">Not available</option>
      </select>
      <select id="accType" data-ss-skip aria-label="Slot type">
        <option value="all">All types</option>
        <option value="trophy">🏆 Trophy</option>
        <option value="non_trophy">🎮 Non-Trophy</option>
        <option value="ps4_primary">🕹️ PS4 Primary</option>
      </select>
      <div class="acc-game-filter">
        <select id="accGame" aria-label="Game">
          <option value="">All games</option>
          <% accGames.forEach(g => { %><option value="<%= g.id %>"><%= g.title %></option><% }) %>
        </select>
      </div>
      <a href="#" id="accClear" class="acc-clear" data-acc-clear hidden>✕ Clear</a>
    </div>
    <span id="accCount" class="acc-count"></span>
  </div>

  <div id="accSlotsView" class="acc-slots">
    <div class="acc-shead" aria-hidden="true">
      <span>Status</span><span>Type</span><span>Game</span><span>Account</span><span>Renter</span><span>Ends</span>
    </div>
    <% accountsView.slots.forEach(s => {
         const a = accById[s.account_id];
         const titles = accTitles(a);
         const first = a.game_ids.length ? (accGameById[a.game_ids[0]] || null) : null;
    %>
    <div class="acc-srow" data-status="<%= s.status %>" data-due="<%= s.due %>" data-type="<%= s.type %>" data-game-ids="<%= a.game_ids.join(',') %>" data-search="<%= accHaystack(a, s.renter_name) %>">
      <button type="button" class="slot-pill <%= accPillClass(s) %>" data-acc-slot="<%= a.id %>:<%= s.type %>"><%= s.pill %></button>
      <span class="acc-s-type"><%= ACC_TYPE_LABEL[s.type] %></span>
      <span class="acc-s-game">
        <% if (first && first.cover_image) { %><img src="<%= first.cover_image %>" alt="" class="acc-s-cover" loading="lazy"><% } else { %><span class="acc-s-cover acc-cover-placeholder">🎮</span><% } %>
        <span class="acc-s-gtitle"><%= titles[0] || a.games_text || '—' %><% if (titles.length > 1) { %> <span class="acc-more">+<%= titles.length - 1 %></span><% } %></span>
      </span>
      <span class="acc-s-acc"><b><%= a.label %></b><% if (a.email) { %><span class="acc-s-email"><%= a.email %></span><% } %></span>
      <span class="acc-s-renter"><%= s.renter_name || '—' %></span>
      <span class="acc-s-date"><%= s.status === 'rented' && s.end ? accShortDate(s.end) : '—' %></span>
    </div>
    <% }) %>
  </div>

  <div id="accAccountsView" class="acc-accounts" hidden>
    <% accountsView.groups.forEach(group => { %>
    <div class="acc-group">
      <div class="acc-group-title"><%= group.name %> <span class="acc-group-count">(<%= group.accounts.length %>)</span></div>
      <% group.accounts.forEach(a => {
           const titles = accTitles(a);
           const renters = ACC_TYPES.map(t => a.slotView[t].renter_name || '').join(' ');
           const gamesLine = titles.length
             ? titles.slice(0, 2).join(', ') + (titles.length > 2 ? ' +' + (titles.length - 2) : '')
             : (a.games_text || '');
           const meta = [a.email ? '✉ ' + a.email : '', gamesLine, a.note ? '📝 ' + a.note : ''].filter(Boolean);
      %>
      <div class="acc-arow" data-game-ids="<%= a.game_ids.join(',') %>" data-search="<%= accHaystack(a, renters) %>">
        <div class="acc-a-main">
          <div class="acc-covers">
            <% a.game_ids.slice(0, 4).forEach(id => { const g = accGameById[id]; %>
              <% if (g && g.cover_image) { %><img src="<%= g.cover_image %>" alt="" class="acc-cover-thumb" loading="lazy" title="<%= g.title %>"><% } else { %><span class="acc-cover-thumb acc-cover-placeholder">🎮</span><% } %>
            <% }) %>
            <% if (!a.game_ids.length) { %><span class="acc-cover-thumb acc-cover-placeholder">🎮</span><% } %>
          </div>
          <div class="acc-a-text">
            <div class="acc-name"><%= a.label %><% if (a.for_sale) { %> <span class="acc-sale" title="Listed on the Buy page">🛒</span><% } %></div>
            <% if (meta.length) { %><div class="acc-meta"><%= meta.join(' · ') %></div><% } %>
          </div>
        </div>
        <div class="acc-a-chips">
          <% ACC_TYPES.forEach(t => { const s = a.slotView[t]; %>
            <% if (s.enabled) { %>
            <button type="button" class="acc-chip slot-pill <%= accPillClass(s) %>" data-type="<%= t %>" data-status="<%= s.status %>" data-due="<%= s.due %>" data-acc-slot="<%= a.id %>:<%= t %>" title="<%= ACC_TYPE_LABEL[t] %><%= s.renter_name ? ' — ' + s.renter_name : '' %>"><%= ACC_TYPE_ICON[t] %> <%= s.pill %></button>
            <% } else { %>
            <span class="acc-chip slot-pill st-disabled" data-type="<%= t %>" data-disabled="1" title="<%= ACC_TYPE_LABEL[t] %> — disabled"><%= ACC_TYPE_ICON[t] %> —</span>
            <% } %>
          <% }) %>
        </div>
        <div class="acc-a-price">₱<%= Number(a.price_permanent_tr || 0).toLocaleString('en-US') %> / ₱<%= Number(a.price_permanent_nt || 0).toLocaleString('en-US') %></div>
        <div class="acc-a-actions">
          <button type="button" class="acc-act" data-acc-edit="<%= a.id %>">Edit</button>
          <form method="POST" action="/admin/accounts/delete/<%= a.id %>" onsubmit="return confirm('Delete this account?');">
            <button type="submit" class="acc-act acc-act-del">Delete</button>
          </form>
        </div>
      </div>
      <% }) %>
    </div>
    <% }) %>
  </div>

  <div class="acc-empty" id="accEmpty" hidden><span id="accEmptyMsg">Nothing matches these filters.</span> <a href="#" id="accEmptyClear" data-acc-clear>Clear filters</a></div>
  <% } %>

  <script type="application/json" id="accData"><%- JSON.stringify(accData).replace(/</g, '\\u003c') %></script>

  <div class="qa-overlay" id="accModal">
    <div class="qa-box" role="dialog" aria-modal="true" aria-labelledby="accModalTitle">
      <div class="qa-head">
        <span>🗂️</span>
        <span class="qa-title" id="accModalTitle">Add Account</span>
        <button type="button" class="qa-x" data-acc-close aria-label="Close">✕</button>
      </div>
      <form method="POST" action="/admin/accounts/add" id="accForm">
        <div class="qa-body">
          <div class="qa-l">Account label *</div>
          <input class="qa-in" type="text" name="label" placeholder="e.g. PSHub Main Account" required>

          <div class="qa-l">Linked catalogue games</div>
          <div class="acc-gchips" id="accGameChips" hidden></div>
          <input class="qa-in" type="search" id="accGameSearch" placeholder="Search games to link…" autocomplete="off">
          <div class="acc-gpick">
            <% accGames.forEach(g => { %>
            <label class="acc-gpick-item"><input type="checkbox" name="game_ids" value="<%= g.id %>" data-title="<%= g.title %>"> <%= g.title %> <span class="acc-gpick-plat"><%= g.platform %></span></label>
            <% }) %>
          </div>
          <div class="qa-hint">Linked games power the game-card availability and the Game filter.</div>

          <div class="qa-l">Games in this account (free text, internal)</div>
          <textarea class="qa-in" name="games_text" rows="2" placeholder="e.g. NBA 2K25, Tekken 8, Call of Duty BO6…"></textarea>

          <div class="acc-fields">
            <label class="qa-sub">Account email<input class="qa-in" type="email" name="email" placeholder="e.g. pshub.account1@gmail.com"></label>
            <label class="qa-sub">Internal note<input class="qa-in" type="text" name="note" placeholder="reminders, misc info…"></label>
            <label class="qa-sub">Trophy permanent price (₱)<input class="qa-in" type="number" name="price_permanent_tr" min="0"></label>
            <label class="qa-sub">Non-Trophy permanent price (₱)<input class="qa-in" type="number" name="price_permanent_nt" min="0"></label>
          </div>

          <div class="qa-l">Slots on this account</div>
          <div class="acc-toggles">
            <label><input type="checkbox" name="enable_trophy"> 🏆 Trophy</label>
            <label><input type="checkbox" name="enable_non_trophy"> 🎮 Non-Trophy</label>
            <label><input type="checkbox" name="enable_ps4_primary"> 🕹️ PS4 Primary</label>
          </div>

          <div class="qa-l">Buy page</div>
          <div class="acc-toggles">
            <label><input type="checkbox" name="for_sale"> 🛒 List on the public Buy page</label>
          </div>
          <label class="qa-sub acc-public-name">Public bundle name (blank hides it from the Buy page)<input class="qa-in" type="text" name="public_name" placeholder="e.g. Sports Pack"></label>
        </div>
        <div class="qa-foot">
          <span class="qa-grow"></span>
          <button type="button" class="qa-btn qa-ghost" data-acc-close>Cancel</button>
          <button type="submit" class="qa-btn qa-gold" id="accModalSubmit">Create account</button>
        </div>
      </form>
    </div>
  </div>

  <div class="qa-overlay" id="accSlotModal">
    <div class="qa-box acc-slot-box" role="dialog" aria-modal="true" aria-labelledby="accSlotTitle">
      <div class="qa-head">
        <span>🎛️</span>
        <span class="qa-title" id="accSlotTitle">Slot</span>
        <button type="button" class="qa-x" data-acc-close aria-label="Close">✕</button>
      </div>
      <form method="POST" action="/admin/accounts" id="accSlotForm">
        <div class="qa-body">
          <div class="qa-l">Status</div>
          <select class="qa-in" name="status" data-ss-skip>
            <% ACC_STATUS_OPTIONS.forEach(([value, label]) => { %><option value="<%= value %>"><%= label %></option><% }) %>
          </select>

          <div id="accSlotRenterWrap" hidden>
            <div class="qa-l">Customer (optional)</div>
            <select class="qa-in" name="renter_id">
              <option value="">— No linked customer —</option>
              <% customers.forEach(c => { %><option value="<%= c.id %>"><%= c.customer_name %></option><% }) %>
            </select>
          </div>

          <div id="accSlotDatesWrap" hidden>
            <div class="qa-l">Rental length</div>
            <div class="qa-g2">
              <label class="qa-sub">Days from today<input class="qa-in" type="number" name="days" min="1" placeholder="e.g. 30"></label>
              <label class="qa-sub">…or end date<input class="qa-in" type="date" name="end_date"></label>
            </div>
            <div class="qa-hint">If both are filled, the end date wins.</div>
          </div>
        </div>
        <div class="qa-foot">
          <span class="qa-grow"></span>
          <button type="button" class="qa-btn qa-ghost" data-acc-close>Cancel</button>
          <button type="submit" class="qa-btn qa-gold">Update slot</button>
        </div>
      </form>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Run the template test**

Run: `node scripts/test-accounts-template.js`
Expected: every line `ok - …`, ending `14 assertions passed`.

- [ ] **Step 6: Add the styles**

Read the last 5 lines of `public/css/style.css` with the Read tool, then use the Edit tool to append the block below after the file's final rule (keeps CRLF endings):

```css

/* ── Admin: Accounts tab ─────────────────────────────────────────────────
   Two views over the same slots (views/partials/admin/accounts.ejs); the
   filters and modals are public/js/admin-accounts.js. The modals reuse the
   Quick Add .qa-* shell above. */
.acc-head { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin:0.25rem 0 1rem; }
.acc-title { font-size:1.15rem; font-weight:900; color:#fff; }
.acc-sub { font-size:0.78rem; color:#777; margin-top:0.15rem; }
.acc-add-btn { white-space:nowrap; }

.acc-stats { display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:0.6rem; margin-bottom:1rem; }
.acc-stat { display:flex; flex-direction:column; align-items:flex-start; gap:0.15rem; background:#15151d; border:1px solid #23232e; border-radius:10px; padding:0.65rem 0.9rem; cursor:pointer; text-align:left; font-family:inherit; transition:border-color 0.15s; }
.acc-stat:hover { border-color:#3a3a48; }
.acc-stat.on { border-color:var(--ps-blue); box-shadow:inset 0 0 0 1px var(--ps-blue); }
.acc-stat .lbl { font-size:0.7rem; color:#888; font-weight:700; }
.acc-stat .val { font-size:1.45rem; font-weight:900; color:#fff; line-height:1.1; }
.acc-stat-open .lbl, .acc-stat-open .val { color:#4ade80; }
.acc-stat-rented .lbl, .acc-stat-rented .val { color:#f87171; }
.acc-stat-ending .lbl, .acc-stat-ending .val { color:#fbbf24; }
.acc-stat-overdue .lbl, .acc-stat-overdue .val { color:#fb7185; }

.acc-toolbar { display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.85rem; }
.acc-views { display:inline-flex; background:#111119; border:1px solid #2a2a35; border-radius:9px; padding:3px; }
.acc-views button { background:none; border:0; color:#999; font-weight:800; font-size:0.8rem; padding:0.4rem 0.9rem; border-radius:7px; cursor:pointer; font-family:inherit; }
.acc-views button.on { background:var(--ps-blue); color:#000; }
.acc-search { flex:1 1 220px; min-width:0; max-width:340px; padding:0.55rem 0.8rem; background:#15151d; border:1px solid #2a2a35; border-radius:8px; color:#fff; font-size:0.84rem; font-family:inherit; }
.acc-search:focus { outline:none; border-color:var(--ps-blue); }
.acc-filters { display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; }
.acc-filters select { padding:0.5rem 0.6rem; background:#15151d; border:1px solid #2a2a35; border-radius:8px; color:#fff; font-size:0.8rem; font-family:inherit; }
.acc-game-filter { width:220px; }
.acc-clear { font-size:0.78rem; color:#f87171; text-decoration:none; font-weight:700; }
.acc-count { font-size:0.75rem; color:#777; margin-left:auto; }
.acc-filter-btn { display:none; }

.acc-slots, .acc-accounts { display:flex; flex-direction:column; gap:0.35rem; }
.acc-slots[hidden], .acc-accounts[hidden], .acc-srow[hidden], .acc-arow[hidden], .acc-group[hidden],
.acc-empty[hidden], .acc-clear[hidden], .acc-gchips[hidden], .acc-gpick-item[hidden] { display:none !important; }
.acc-shead, .acc-srow { display:grid; grid-template-columns:128px 118px minmax(0, 1.6fr) minmax(0, 1.2fr) minmax(0, 1fr) 70px; gap:0.75rem; align-items:center; }
.acc-shead { padding:0 0.8rem 0.2rem; font-size:0.66rem; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; color:#666; }
.acc-srow { background:#111119; border:1px solid #1f1f2a; border-radius:10px; padding:0.5rem 0.8rem; font-size:0.8rem; color:#ddd; }
.acc-srow > .slot-pill { justify-self:start; }
.acc-s-type { color:#aaa; white-space:nowrap; }
.acc-s-game { display:flex; align-items:center; gap:0.5rem; min-width:0; }
.acc-s-cover { width:28px; height:38px; border-radius:4px; object-fit:cover; flex-shrink:0; }
.acc-s-gtitle { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.acc-s-acc { display:flex; flex-direction:column; min-width:0; }
.acc-s-acc b { color:#fbbf24; font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.acc-s-email { font-size:0.68rem; color:#777; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.acc-s-renter { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.acc-s-date { color:#aaa; white-space:nowrap; }
.acc-more { color:#777; font-size:0.72rem; }

.slot-pill { display:inline-flex; align-items:center; justify-content:center; gap:0.25rem; border:none; border-radius:6px; padding:6px 8px; font-size:0.68rem; font-weight:800; letter-spacing:0.4px; cursor:pointer; white-space:nowrap; font-family:inherit; }
button.slot-pill:hover { filter:brightness(1.15); }
.st-open { background:#166534; color:#dcfce7; }
.st-rented { background:#991b1b; color:#fee2e2; }
.st-ending { background:#c2410c; color:#ffedd5; }
.st-overdue { background:#be123c; color:#fff1f2; box-shadow:inset 0 0 0 1px #fb7185; }
.st-buyed { background:#1e40af; color:#dbeafe; }
.st-na { background:#6b21a8; color:#f3e8ff; }
.st-maintenance { background:#92620a; color:#fef3c7; }
.st-disabled { background:#1a1a22; color:#555; cursor:default; }

.acc-group { display:flex; flex-direction:column; gap:0.35rem; margin-bottom:1rem; }
.acc-group-title { font-size:0.95rem; font-weight:800; color:#fff; padding-bottom:0.35rem; border-bottom:2px solid #23232e; margin-bottom:0.2rem; }
.acc-group-count { font-size:0.76rem; color:#666; font-weight:500; }
.acc-arow { display:grid; grid-template-columns:minmax(0, 1fr) auto 130px auto; gap:0.9rem; align-items:center; background:#111119; border:1px solid #1f1f2a; border-radius:10px; padding:0.6rem 0.8rem; }
.acc-a-main { display:flex; align-items:center; gap:0.65rem; min-width:0; }
.acc-covers { display:flex; flex-shrink:0; }
.acc-cover-thumb { width:32px; height:44px; border-radius:5px; border:1.5px solid #23232e; margin-left:-10px; object-fit:cover; box-shadow:0 1px 4px rgba(0,0,0,0.4); }
.acc-cover-thumb:first-child { margin-left:0; }
.acc-cover-placeholder { background:#1a1a24; display:inline-flex; align-items:center; justify-content:center; font-size:0.8rem; color:#444; }
.acc-a-text { min-width:0; }
.acc-name { font-weight:800; color:#fbbf24; font-size:0.86rem; }
.acc-sale { font-size:0.8rem; }
.acc-meta { font-size:0.7rem; color:#777; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.acc-a-chips { display:flex; gap:0.35rem; }
.acc-chip { min-width:92px; }
.acc-chip-dim { opacity:0.28; }
.acc-a-price { font-size:0.74rem; color:#bbb; text-align:right; white-space:nowrap; }
.acc-a-actions { display:flex; gap:0.35rem; }
.acc-a-actions form { margin:0; }
.acc-act { font-size:0.7rem; padding:0.35rem 0.65rem; border-radius:6px; border:1px solid #333; background:#1a1a22; color:#ccc; cursor:pointer; font-family:inherit; }
.acc-act:hover { color:#fff; border-color:#555; }
.acc-act-del { border-color:rgba(239,68,68,0.4); color:#f87171; }
.acc-empty { text-align:center; color:#777; padding:2rem; background:#111119; border-radius:12px; font-size:0.85rem; }
.acc-empty a { color:var(--ps-blue); font-weight:700; }
.acc-readonly [data-acc-add], .acc-readonly [data-acc-edit] { display:none; }
.acc-readonly [data-acc-slot] { pointer-events:none; cursor:default; }

.acc-gpick { max-height:180px; overflow-y:auto; border:1px solid #2a2a2a; border-radius:8px; margin-top:0.4rem; background:#0a0a0a; }
.acc-gpick-item { display:flex; align-items:center; gap:0.5rem; padding:0.4rem 0.65rem; font-size:0.8rem; color:#ccc; cursor:pointer; border-bottom:1px solid #161616; }
.acc-gpick-item:last-child { border-bottom:0; }
.acc-gpick-item:hover { background:#141414; }
.acc-gpick-plat { margin-left:auto; font-size:0.68rem; color:#666; }
.acc-gchips { display:flex; flex-wrap:wrap; gap:0.35rem; margin-bottom:0.45rem; }
.acc-gchip { background:rgba(240,165,0,0.12); border:1px solid rgba(240,165,0,0.4); color:#f0a500; border-radius:20px; padding:0.25rem 0.65rem; font-size:0.72rem; font-weight:700; cursor:pointer; font-family:inherit; }
.acc-fields { display:grid; grid-template-columns:1fr 1fr; gap:0.45rem; margin-top:0.55rem; }
.acc-toggles { display:flex; gap:1rem; flex-wrap:wrap; font-size:0.82rem; color:#ccc; }
.acc-toggles label { display:flex; align-items:center; gap:0.4rem; cursor:pointer; }
.acc-public-name { margin-top:0.55rem; }

@media (max-width: 640px) {
  .acc-head { align-items:flex-start; }
  .acc-sub { display:none; }
  .acc-stats { display:flex; overflow-x:auto; scrollbar-width:none; gap:0.5rem; }
  .acc-stats::-webkit-scrollbar { display:none; }
  .acc-stat { flex:0 0 auto; min-width:104px; }
  .acc-toolbar { gap:0.45rem; }
  .acc-views { order:1; }
  .acc-filter-btn { order:2; display:inline-flex; align-items:center; margin-left:auto; background:#15151d; border:1px solid #2a2a35; color:#ddd; border-radius:8px; padding:0.45rem 0.8rem; font-weight:700; font-size:0.8rem; font-family:inherit; cursor:pointer; }
  .acc-search { order:3; flex:1 1 100%; max-width:none; }
  .acc-filters { order:4; display:none; width:100%; flex-direction:column; align-items:stretch; background:#111119; border:1px solid #23232e; border-radius:10px; padding:0.6rem; }
  .acc-filters.open { display:flex; }
  .acc-filters select, .acc-game-filter { width:100%; }
  .acc-count { order:5; margin-left:0; }
  .acc-shead { display:none; }
  .acc-srow { grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); grid-template-areas:"pill type" "game acc" "renter date"; gap:0.4rem 0.6rem; }
  .acc-srow > .slot-pill { grid-area:pill; }
  .acc-s-type { grid-area:type; justify-self:end; }
  .acc-s-game { grid-area:game; }
  .acc-s-acc { grid-area:acc; text-align:right; }
  .acc-s-renter { grid-area:renter; color:#aaa; }
  .acc-s-date { grid-area:date; justify-self:end; }
  .acc-arow { grid-template-columns:1fr auto; grid-template-areas:"main main" "chips chips" "price actions"; gap:0.5rem; }
  .acc-a-main { grid-area:main; }
  .acc-a-chips { grid-area:chips; }
  .acc-chip { flex:1 1 0; min-width:0; }
  .acc-a-price { grid-area:price; text-align:left; }
  .acc-a-actions { grid-area:actions; }
  .acc-meta { white-space:normal; }
  .acc-fields { grid-template-columns:1fr; }
}

body.light-mode .acc-title, body.light-mode .acc-group-title { color:#14171a; }
body.light-mode .acc-stat, body.light-mode .acc-srow, body.light-mode .acc-arow, body.light-mode .acc-views,
body.light-mode .acc-search, body.light-mode .acc-filters select, body.light-mode .acc-empty, body.light-mode .acc-filter-btn { background:#fff; border-color:#e4e7eb; color:#14171a; }
body.light-mode .acc-stat-total .val { color:#14171a; }
body.light-mode .acc-name, body.light-mode .acc-s-acc b { color:#b45309; }
body.light-mode .acc-act { background:#f2f4f7; border-color:#e0e4e8; color:#4b5259; }
```

- [ ] **Step 7: Run the related suites**

Run each and confirm it ends with `assertions passed` and no failures:

```bash
node scripts/test-accounts-view.js
node scripts/test-accounts-template.js
node scripts/test-admin-accounts-filter.js
node scripts/test-dashboard.js
node scripts/test-admin-tabs.js
node scripts/test-order-routes-error-handling.js
```

`test-order-routes-error-handling.js` boots the real `server.js` in-process, so it also proves the new `require` and the edited `buildAccountsView()` load without error.

- [ ] **Step 8: Commit**

```bash
git add server.js views/partials/admin/accounts.ejs public/css/style.css scripts/test-accounts-template.js
git status --short
git commit -m "$(cat <<'EOF'
Rebuild the Accounts tab markup: Slots and Accounts views, filter bar, modals

buildAccountsView() now takes urgency, pill text and stats from
lib/accounts-view, counting days in Manila calendar days, and adds an
Overdue count so "Ending <=3 days" no longer hides overdue rentals.
slotDaysLeft() had no other caller and is removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

`git status --short` before the commit should list only those four files as staged (plus the long-standing untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`, which is not part of this work — leave it alone).

---

### Task 4: Filter, view-toggle and modal behaviour

**Files:**
- Modify: `public/js/admin-accounts.js` — insert the DOM section immediately before the file's final `})();`
- Modify: `views/admin.ejs` — one line after `<script src="/js/admin-searchable-select.js?v=<%= assetV %>"></script>`
- Test: `scripts/test-admin-accounts-filter.js` (append one check)

**Interfaces:**
- Consumes: from Task 2 — `normalizeState`, `chipMatches`, `slotMatches`, `accountMatches`, `activeFilterCount`, `isFiltering`, `plural`, `FILTER_KEY`, `VIEW_KEY`, `isAll` (all in the same IIFE scope). From Task 3 — every id/attribute listed in Task 3's "Produces".
- Produces: the working page; nothing new for later tasks.

- [ ] **Step 1: Write the failing check**

In `scripts/test-admin-accounts-filter.js`, insert before the final `console.log('\n' + passed + ' assertions passed\n');` line:

```js
console.log('\nwiring');

ok('admin.ejs loads admin-accounts.js with a cache-busting ?v=', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
  assert.ok(/<script src="\/js\/admin-accounts\.js\?v=<%=\s*assetV\s*%>"><\/script>/.test(src));
});

ok('the file still loads cleanly with no DOM (wiring is skipped, rules still exposed)', () => {
  const again = load();
  assert.strictEqual(typeof again.slotMatches, 'function');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-admin-accounts-filter.js`
Expected: FAIL on `admin.ejs loads admin-accounts.js with a cache-busting ?v=` (AssertionError).

- [ ] **Step 3: Add the script tag**

In `views/admin.ejs`, directly after:

```html
<script src="/js/admin-searchable-select.js?v=<%= assetV %>"></script>
```

add:

```html
<script src="/js/admin-accounts.js?v=<%= assetV %>"></script>
```

- [ ] **Step 4: Add the DOM wiring**

In `public/js/admin-accounts.js`, insert this block immediately before the final `})();` line (after the `window.__accFilter = { … };` statement):

```js

  // ── DOM wiring ───────────────────────────────────────────────────────────
  // Everything below touches the page. It runs only when the Accounts tab's
  // markup exists; the test sandbox has no document, so it is skipped there.

  var TYPE_LABEL = { trophy: '🏆 Trophy', non_trophy: '🎮 Non-Trophy', ps4_primary: '🕹️ PS4 Primary' };

  function byId(id) { return document.getElementById(id); }

  function readStore(store, key) {
    try { return store.getItem(key); } catch (e) { return null; }
  }

  function writeStore(store, key, value) {
    try { store.setItem(key, value); } catch (e) { /* storage blocked: filters just won't persist */ }
  }

  function itemFrom(el) {
    return {
      status: el.getAttribute('data-status') || '',
      due: el.getAttribute('data-due') || '',
      type: el.getAttribute('data-type') || '',
      disabled: el.getAttribute('data-disabled') === '1',
      gameIds: (el.getAttribute('data-game-ids') || '').split(',').filter(Boolean),
      search: el.getAttribute('data-search') || ''
    };
  }

  function toArray(list) { return Array.prototype.slice.call(list); }

  // Returns a click handler for the filter controls, or null when there is no
  // list on the page (no accounts yet).
  function initFilters(root) {
    var slotsView = byId('accSlotsView');
    var accountsView = byId('accAccountsView');
    if (!slotsView || !accountsView) return null;

    var search = byId('accSearch');
    var statusSel = byId('accStatus');
    var typeSel = byId('accType');
    var gameSel = byId('accGame');

    var stored = null;
    try { stored = JSON.parse(readStore(window.sessionStorage, FILTER_KEY) || 'null'); } catch (e) { stored = null; }
    var state = normalizeState(stored, readStore(window.localStorage, VIEW_KEY));

    function syncControls() {
      search.value = state.q;
      statusSel.value = state.status;
      typeSel.value = state.type;
      gameSel.value = state.game;
      // A remembered game that no longer exists leaves the select on nothing;
      // adopt that rather than silently filtering everything out.
      state.game = gameSel.value || '';
    }

    function applySlots() {
      var visible = 0;
      toArray(slotsView.querySelectorAll('.acc-srow')).forEach(function (row) {
        var show = slotMatches(itemFrom(row), state);
        row.hidden = !show;
        if (show) visible++;
      });
      return visible;
    }

    function applyAccounts() {
      var visible = 0;
      var dimming = !isAll(state.status) || !isAll(state.type);
      toArray(accountsView.querySelectorAll('.acc-group')).forEach(function (group) {
        var inGroup = 0;
        toArray(group.querySelectorAll('.acc-arow')).forEach(function (row) {
          var chipEls = toArray(row.querySelectorAll('.acc-chip'));
          var chips = chipEls.map(itemFrom);
          var show = accountMatches(itemFrom(row), chips, state);
          row.hidden = !show;
          chipEls.forEach(function (el, i) {
            el.classList.toggle('acc-chip-dim', show && dimming && !chips[i].disabled && !chipMatches(chips[i], state));
          });
          if (show) inGroup++;
        });
        group.hidden = inGroup === 0;
        var count = group.querySelector('.acc-group-count');
        if (count) count.textContent = '(' + inGroup + ')';
        visible += inGroup;
      });
      return visible;
    }

    function apply() {
      var onSlots = state.view === 'slots';
      slotsView.hidden = !onSlots;
      accountsView.hidden = onSlots;
      toArray(root.querySelectorAll('[data-acc-view]')).forEach(function (btn) {
        var on = btn.getAttribute('data-acc-view') === state.view;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      var visible = onSlots ? applySlots() : applyAccounts();
      var filtering = isFiltering(state);
      var noun = onSlots ? 'slot' : 'account';

      byId('accCount').textContent = plural(visible, noun);
      byId('accEmpty').hidden = visible !== 0;
      byId('accEmptyMsg').textContent = filtering ? 'No ' + noun + 's match these filters.' : 'Nothing to show here yet.';
      byId('accEmptyClear').hidden = !filtering;
      byId('accClear').hidden = !filtering;
      toArray(root.querySelectorAll('[data-acc-stat]')).forEach(function (card) {
        card.classList.toggle('on', card.getAttribute('data-acc-stat') === state.status);
      });
      var n = activeFilterCount(state);
      byId('accFilterBtnCount').textContent = n ? ' (' + n + ')' : '';

      writeStore(window.sessionStorage, FILTER_KEY, JSON.stringify(state));
      writeStore(window.localStorage, VIEW_KEY, state.view);
    }

    function clearFilters() {
      state.q = '';
      state.status = 'all';
      state.type = 'all';
      state.game = '';
      syncControls();
      apply();
    }

    search.addEventListener('input', function () { state.q = search.value; apply(); });
    statusSel.addEventListener('change', function () { state.status = statusSel.value; apply(); });
    typeSel.addEventListener('change', function () { state.type = typeSel.value; apply(); });
    gameSel.addEventListener('change', function () { state.game = gameSel.value || ''; apply(); });

    syncControls();
    apply();

    return function handleClick(target, e) {
      var viewBtn = target.closest('[data-acc-view]');
      if (viewBtn) { state.view = viewBtn.getAttribute('data-acc-view'); apply(); return true; }
      var stat = target.closest('[data-acc-stat]');
      if (stat) {
        state.status = stat.getAttribute('data-acc-stat');
        state.view = 'slots';
        syncControls();
        apply();
        return true;
      }
      if (target.closest('[data-acc-clear]')) { e.preventDefault(); clearFilters(); return true; }
      if (target.closest('#accFilterBtn')) { byId('accFilterPanel').classList.toggle('open'); return true; }
      return false;
    };
  }

  // Returns { openAccount, openSlot }, or null when the embedded data is
  // missing or unreadable — the list still renders and filters, but the edit
  // controls are hidden rather than opening an empty form.
  function initModals(root) {
    var data = null;
    var blob = byId('accData');
    try { data = JSON.parse(blob ? blob.textContent : 'null'); } catch (e) { data = null; }
    var accModal = byId('accModal');
    var slotModal = byId('accSlotModal');
    if (!data || !data.accounts || !accModal || !slotModal) {
      root.classList.add('acc-readonly');
      return null;
    }

    var accForm = byId('accForm');
    var gameSearch = byId('accGameSearch');
    var gameChips = byId('accGameChips');
    var gameBoxes = toArray(accForm.querySelectorAll('input[name="game_ids"]'));
    var slotForm = byId('accSlotForm');

    function open(overlay) { overlay.classList.add('open'); }
    function close(overlay) { overlay.classList.remove('open'); }

    function renderGameChips() {
      gameChips.innerHTML = '';
      gameBoxes.filter(function (b) { return b.checked; }).forEach(function (b) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'acc-gchip';
        chip.setAttribute('data-uncheck', b.value);
        chip.textContent = b.getAttribute('data-title') + ' ✕';
        gameChips.appendChild(chip);
      });
      gameChips.hidden = gameChips.children.length === 0;
    }

    function filterGameList() {
      var q = gameSearch.value.trim().toLowerCase();
      gameBoxes.forEach(function (b) {
        var item = b.closest('.acc-gpick-item');
        item.hidden = q !== '' && b.getAttribute('data-title').toLowerCase().indexOf(q) === -1;
      });
    }

    function setField(name, value) {
      var el = accForm.elements[name];
      if (el) el.value = value == null ? '' : value;
    }

    function setCheck(name, on) {
      var el = accForm.elements[name];
      if (el) el.checked = !!on;
    }

    function openAccount(id) {
      var a = id ? data.accounts[id] : null;
      if (id && !a) return;
      accForm.action = a ? '/admin/accounts/edit/' + id : '/admin/accounts/add';
      byId('accModalTitle').textContent = a ? 'Edit Account' : 'Add Account';
      byId('accModalSubmit').textContent = a ? 'Save changes' : 'Create account';
      setField('label', a ? a.label : '');
      setField('email', a ? a.email : '');
      setField('games_text', a ? a.games_text : '');
      setField('note', a ? a.note : '');
      setField('price_permanent_tr', a ? a.price_permanent_tr : 5000);
      setField('price_permanent_nt', a ? a.price_permanent_nt : 4500);
      setField('public_name', a ? a.public_name : '');
      setCheck('enable_trophy', a ? a.slots.trophy.enabled : true);
      setCheck('enable_non_trophy', a ? a.slots.non_trophy.enabled : true);
      setCheck('enable_ps4_primary', a ? a.slots.ps4_primary.enabled : true);
      setCheck('for_sale', a ? a.for_sale : false);
      var linked = a ? a.game_ids.map(String) : [];
      gameBoxes.forEach(function (b) { b.checked = linked.indexOf(b.value) !== -1; });
      gameSearch.value = '';
      filterGameList();
      renderGameChips();
      open(accModal);
      setTimeout(function () { accForm.elements.label.focus(); }, 50);
    }

    function syncSlotFields() {
      var st = slotForm.elements.status.value;
      byId('accSlotRenterWrap').hidden = !(st === 'rented' || st === 'buyed');
      byId('accSlotDatesWrap').hidden = st !== 'rented';
    }

    function openSlot(id, type) {
      var a = data.accounts[id];
      var s = a && a.slots[type];
      if (!s || !s.enabled) return;
      slotForm.action = '/admin/accounts/' + id + '/slot/' + type;
      byId('accSlotTitle').textContent = TYPE_LABEL[type] + ' — ' + a.label;
      slotForm.elements.status.value = s.status;
      slotForm.elements.renter_id.value = s.renter_id ? String(s.renter_id) : '';
      slotForm.elements.days.value = '';
      slotForm.elements.end_date.value = s.end || '';
      syncSlotFields();
      open(slotModal);
    }

    slotForm.elements.status.addEventListener('change', syncSlotFields);
    gameSearch.addEventListener('input', filterGameList);
    accForm.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'game_ids') renderGameChips();
    });
    gameChips.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-uncheck]');
      if (!chip) return;
      var value = chip.getAttribute('data-uncheck');
      gameBoxes.forEach(function (b) { if (b.value === value) b.checked = false; });
      renderGameChips();
    });
    [accModal, slotModal].forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.closest('[data-acc-close]')) close(overlay);
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      close(accModal);
      close(slotModal);
    });

    return { openAccount: openAccount, openSlot: openSlot };
  }

  function init() {
    var root = byId('tab-accounts');
    if (!root || root.getAttribute('data-acc-init')) return;
    root.setAttribute('data-acc-init', '1');

    var modals = initModals(root);
    var handleFilterClick = initFilters(root);

    root.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (handleFilterClick && handleFilterClick(t, e)) return;
      if (!modals) return;
      if (t.closest('[data-acc-add]')) { modals.openAccount(null); return; }
      var edit = t.closest('[data-acc-edit]');
      if (edit) { modals.openAccount(edit.getAttribute('data-acc-edit')); return; }
      var slotBtn = t.closest('[data-acc-slot]');
      if (slotBtn) {
        var parts = slotBtn.getAttribute('data-acc-slot').split(':');
        modals.openSlot(parts[0], parts[1]);
      }
    });
  }

  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
```

- [ ] **Step 5: Run the tests**

```bash
node scripts/test-admin-accounts-filter.js
node scripts/test-accounts-template.js
node scripts/test-static-caching.js
node scripts/test-admin-tabs.js
```

Expected: `test-admin-accounts-filter.js` ends `20 assertions passed`; the other three pass as before.

- [ ] **Step 6: Commit**

```bash
git add public/js/admin-accounts.js views/admin.ejs scripts/test-admin-accounts-filter.js
git commit -m "$(cat <<'EOF'
Wire the Accounts tab: filters, view toggle, stat shortcuts and modals

Filters persist for the browser session so saving a slot lands back on
the same filtered list; the last view is remembered across visits.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Browser verification on a scratch copy

No code changes to the real repo in this task unless a defect is found (then fix it in the real repo, re-run Task 3–4 tests, and commit the fix separately). All paths below use the session scratchpad; substitute its real path for `$SCRATCH`.

**Files:**
- Scratch only: `$SCRATCH/acc-check/` (a copy of the repo), `$SCRATCH/seed-accounts.js`

- [ ] **Step 1: Make the scratch copy and bypass auth there only**

```bash
rm -rf "$SCRATCH/acc-check"
cp -r "C:/Users/michael/Desktop/claude code/playstation-hub" "$SCRATCH/acc-check"
```

In `$SCRATCH/acc-check/server.js` (the copy — never the real repo), use the Edit tool to change:

```js
function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/admin/login');
}
```

to:

```js
function requireAuth(req, res, next) {
  return next();
}
```

- [ ] **Step 2: Seed test accounts into the copy's `games.json`**

The local fixture has zero accounts. Create `$SCRATCH/seed-accounts.js`:

```js
// Seeds varied accounts into a SCRATCH copy's games.json for a visual check.
const fs = require('fs');
const file = process.argv[2];
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const addDays = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const games = db.games || [];
const g = i => (games[i] ? [games[i].id] : []);
const cust = (db.customers || [])[0];
const slot = (status, end, enabled) => ({
  enabled: enabled !== false, status, renter_id: status === 'rented' && cust ? cust.id : null,
  renter_name: status === 'rented' ? (cust ? cust.customer_name : 'Walk-in') : '', start: end ? today : '', end: end || ''
});
db.accounts = [
  { id: 1, label: 'Seed Overdue Pack', game_ids: [...g(0), ...g(1), ...g(2)], email: 'overdue@seed.test', slots: { trophy: slot('rented', addDays(-2)), non_trophy: slot('open'), ps4_primary: slot('na') } },
  { id: 2, label: 'Seed Ending Pack', game_ids: g(1), slots: { trophy: slot('rented', addDays(0)), non_trophy: slot('rented', addDays(3)), ps4_primary: slot('open', '', false) } },
  { id: 3, label: 'Seed Long Rental', game_ids: g(2), note: 'long note to check wrapping on phones', slots: { trophy: slot('rented', addDays(20)), non_trophy: slot('rented', ''), ps4_primary: slot('maintenance') } },
  { id: 4, label: 'Seed Open Pack', game_ids: [...g(3), ...g(4)], for_sale: true, public_name: 'Seed Bundle', slots: { trophy: slot('open'), non_trophy: slot('open'), ps4_primary: slot('buyed') } }
].map(a => Object.assign({ games_text: '', note: '', email: '', price_permanent_tr: 5000, price_permanent_nt: 4500, for_sale: false, public_name: '', created_at: new Date().toISOString() }, a));
db.nextAccountId = 5;
fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log('seeded', db.accounts.length, 'accounts; today (Manila) =', today);
```

Run:

```bash
node "$SCRATCH/seed-accounts.js" "$SCRATCH/acc-check/games.json"
```

Expected: `seeded 4 accounts; today (Manila) = <date>`.

- [ ] **Step 3: Boot the copy**

```bash
cd "$SCRATCH/acc-check" && PORT=4588 node server.js > "$SCRATCH/acc-check.log" 2>&1 &
sleep 3; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4588/admin?tab=accounts"
```

Expected: `200`.

- [ ] **Step 4: Desktop checks (Browser pane, `http://localhost:4588/admin?tab=accounts`)**

Check each and note pass/fail:
1. Slots view is shown by default. Row order: Seed Overdue Pack Trophy (`OVERDUE 2d`) → Seed Ending Pack Trophy (`ENDS TODAY`) → Seed Ending Pack Non-Trophy (`3d left`) → Seed Long Rental Trophy (`20d left`) → Seed Long Rental Non-Trophy (`RENTED`, no end date) → the Open rows (A→Z by account) → Bought → Maintenance → Not available. No row for Seed Ending Pack PS4 (disabled).
2. Stat cards read Total 11, Open 3, Rented 5, Ending ≤3 days 2, Overdue 1. Clicking **Overdue** leaves one row and highlights that card; clicking **Total** shows all again.
3. Status = Open + Type = Trophy leaves only the Open Trophy rows. Game filter (type a game title) narrows to accounts that link it. Search for the seeded customer's name finds their rentals. **✕ Clear** appears only while filtering and resets everything.
4. Switch to **Accounts**: rows grouped under category headers; each shows three chips; Seed Ending Pack PS4 chip is a dim `—`; Seed Open Pack shows 🛒. With Status = Open active, non-open chips are dimmed and accounts with no open slot are hidden; group counts update.
5. Click a status pill → slot modal titled e.g. `🏆 Trophy — Seed Open Pack`. Change to Rented, pick a customer by typing, set 7 days, **Update slot**. The page reloads to the Accounts tab with the **same view and filters still applied**, the toast says `✅ Slot updated!`, and the row shows `7d left` (or `6d left` late in the Manila evening — the unchanged save route computes "days from today" in server UTC time; that is existing behaviour, not a defect of this work).
6. **Edit** on Seed Open Pack → modal pre-filled (label, prices, linked games as chips, 🛒 checked). Search games in the picker, tick one, remove one via its chip ✕, **Save changes** → toast `✅ Account updated!` and the row reflects it.
7. **+ Add Account** → empty form with prices 5000 / 4500 and all three slot toggles checked. Create one → it appears.
8. Reload the page: last view is remembered. Escape and clicking the backdrop close each modal.
9. `read_console_messages` with `onlyErrors: true` → no errors.

- [ ] **Step 5: Phone checks (375×812 via `resize_window` preset `mobile`, then reload)**

1. Stat cards scroll sideways; the toolbar shows view toggle + **Filters** button + full-width search; Status/Type/Game are hidden until **Filters** is tapped; with two filters active the button reads `Filters (2)`.
2. Slots rows are 3-line cards (pill + type / game + account / renter + date) with no horizontal page scroll (`document.documentElement.scrollWidth <= 375` via `javascript_tool`).
3. Accounts rows stack: covers + name + meta, then the three chips on one line, then prices + Edit/Delete.
4. Both modals fit the screen and scroll.
5. If the pane's emulated size gets auto-cleared (a squeezed, duplicated screenshot), re-apply the preset and re-screenshot — that is a Browser-pane artifact, not an app bug.
6. Switch the admin to **Light** mode (top-right toggle) and confirm rows, stat cards and filters are readable, then switch back to dark.
7. Reset with `resize_window` preset `desktop`.

- [ ] **Step 6: Clean up**

```bash
for pid in $(netstat -ano | grep ':4588' | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //F //PID "$pid"; done
rm -rf "$SCRATCH/acc-check" "$SCRATCH/seed-accounts.js" "$SCRATCH/acc-check.log"
cd "C:/Users/michael/Desktop/claude code/playstation-hub" && git status --short
```

Expected: `git status --short` in the real repo shows nothing from this task (only the long-standing untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`). Confirm `grep -n "return next();" server.js` in the real repo does **not** show the auth bypass inside `requireAuth`.

- [ ] **Step 7: Full regression run**

```bash
cd "C:/Users/michael/Desktop/claude code/playstation-hub"
for f in scripts/test-*.js; do echo "== $f"; timeout 120 node "$f" > "$SCRATCH/out.txt" 2>&1 || { echo "FAILED: $f"; tail -20 "$SCRATCH/out.txt"; }; done
```

Expected: no `FAILED:` lines. (A suite that needs a live network or MongoDB and fails for that reason alone should be reported, not "fixed". `timeout` stops any suite that boots a server and forgets to exit from hanging the loop.)
