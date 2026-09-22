# Monthly Profit Tile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Profit tile to the dashboard's month drill-down panel: `month revenue − that month's game costs − that month's ad spend`.

**Architecture:** A new pure function `monthlyGameCost(games)` in `lib/dashboard.js` (same shape as its neighbours — no I/O, unit-tested directly), called once server-side and passed to the admin view as a small pre-aggregated map, then read client-side by `money.ejs`'s existing `renderMonthPanel()` alongside the `MONTH_LOGS` blob it already reads for ad spend.

**Tech Stack:** Node.js (`lib/dashboard.js`), EJS + inline client-side JS (`views/partials/admin/dashboard/money.ejs`), plain `node` test scripts with `assert` (this project's convention — see `scripts/test-dashboard.js`).

## Global Constraints

- Direct-on-main workflow, no worktree isolation (established practice in this repo).
- `lib/dashboard.js`'s existing `gamePayback()` function is not modified.
- A game's cost is charged to the month of `release_date`, falling back to `created_at` when `release_date` is absent. A game with a cost but neither date contributes to no month and is counted in `undated`, never silently dropped or guessed into a month.
- A game with no cost (`cost` unset or `<= 0`) contributes nothing and is counted in `missingCost`.
- The server sends a pre-aggregated month → total map to the client, not per-game data — matches the trimming discipline already documented at `server.js:4125` for `dashboardData`.
- Profit tile: green when `>= 0`, red when negative — a negative month is a real, valid outcome, not an error state.
- Never log into the site's admin panel. Task 3's verification uses a local scratch copy with `requireAuth` bypassed (test-only, never committed) — this project's established practice.

---

### Task 1: `monthlyGameCost()` in `lib/dashboard.js`

**Files:**
- Modify: `lib/dashboard.js` (add the function; add it to `module.exports`)
- Test: `scripts/test-dashboard.js` (extend existing file)

**Interfaces:**
- Produces: `monthlyGameCost(games)` → `{ byMonth, missingCost, undated, total }`, where:
  - `byMonth` is a plain object keyed by `"YYYY-MM"`, values are the summed cost of every game charged to that month
  - `missingCost` is a count of games with no usable cost (`cost` unset or `<= 0`)
  - `undated` is a count of games that have a cost but neither `release_date` nor `created_at` parses to a `YYYY-MM` prefix
  - `total` is `(games || []).length`, for the view's "N of M games" wording
- Consumes: nothing from other tasks — this is the first task, fully self-contained.

- [ ] **Step 1: Write the failing tests**

Open `scripts/test-dashboard.js` and find the closing `console.log('\n' + passed + ...)` line at the end of the file (or the last `check(...)`/`ok(...)` call — match this file's existing helper name, whichever it is). Add these cases immediately before that final summary line, matching the file's existing style (its own `check`/`ok` helper, not a new one):

```js
console.log('\nmonthlyGameCost()');

check('a game with a release_date charges its cost to that month', () => {
  const r = dash.monthlyGameCost([
    { id: 1, cost: 2500, release_date: '2026-09-15', created_at: '2026-01-01T00:00:00.000Z' }
  ]);
  assert.deepStrictEqual(r.byMonth, { '2026-09': 2500 });
  assert.strictEqual(r.missingCost, 0);
  assert.strictEqual(r.undated, 0);
});

check('a game with no release_date falls back to created_at', () => {
  const r = dash.monthlyGameCost([
    { id: 1, cost: 1800, created_at: '2026-03-10T04:00:00.000Z' }
  ]);
  assert.deepStrictEqual(r.byMonth, { '2026-03': 1800 });
});

check('a game with a cost but neither date is counted in undated, not charged to any month', () => {
  const r = dash.monthlyGameCost([
    { id: 1, cost: 900 }
  ]);
  assert.deepStrictEqual(r.byMonth, {});
  assert.strictEqual(r.undated, 1);
  assert.strictEqual(r.missingCost, 0);
});

check('a game with no cost is counted in missingCost and contributes nothing', () => {
  const r = dash.monthlyGameCost([
    { id: 1, cost: 0, release_date: '2026-09-01' },
    { id: 2, release_date: '2026-09-01' }
  ]);
  assert.deepStrictEqual(r.byMonth, {});
  assert.strictEqual(r.missingCost, 2);
  assert.strictEqual(r.total, 2);
});

check('two games in the same month sum into one entry', () => {
  const r = dash.monthlyGameCost([
    { id: 1, cost: 2000, release_date: '2026-09-05' },
    { id: 2, cost: 1500, release_date: '2026-09-20' }
  ]);
  assert.deepStrictEqual(r.byMonth, { '2026-09': 3500 });
});

check('an empty or missing games list does not throw', () => {
  assert.deepStrictEqual(dash.monthlyGameCost([]), { byMonth: {}, missingCost: 0, undated: 0, total: 0 });
  assert.deepStrictEqual(dash.monthlyGameCost(null), { byMonth: {}, missingCost: 0, undated: 0, total: 0 });
});
```

Before adding this, check the top of `scripts/test-dashboard.js` for how it imports the module (likely `const dash = require('../lib/dashboard');` or similar) and match that exact variable name in the snippet above — do not introduce a second import.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-dashboard.js`
Expected: FAIL — `dash.monthlyGameCost is not a function`.

- [ ] **Step 3: Write the implementation**

In `lib/dashboard.js`, add immediately after the closing `}` of `gamePayback()` (the function ending in `return { rows, missingCost };`):

```js
// What each month's games cost, for the dashboard's per-month profit tile.
//
// A game's cost is charged to ONE month — the month it was acquired — not to
// every month it earns in. That distinction is the whole reason the old Net
// Profit figure was removed (see money.ejs): charging every game ever bought
// against a single month's revenue put two different clocks in one number.
//
// release_date first, created_at as the fallback: release_date is when the
// game (and so the purchase) landed, but it is not always filled in, and a
// cost with no month at all would quietly disappear from every total.
function monthlyGameCost(games) {
  const byMonth = {};
  let missingCost = 0;
  let undated = 0;

  (games || []).forEach(g => {
    const cost = Number(g && g.cost) || 0;
    if (cost <= 0) { missingCost++; return; }
    const when = String((g && g.release_date) || (g && g.created_at) || '');
    const key = when.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) { undated++; return; }
    byMonth[key] = (byMonth[key] || 0) + cost;
  });

  return { byMonth, missingCost, undated, total: (games || []).length };
}
```

Then update the `module.exports` block:

```js
module.exports = {
  PERIODS, SLOT_TYPES,
  periodRange, priorPeriodRange, inPeriod, trend,
  collected, rentalVsSales, depositsHeld, adCost, paymentMix,
  slotUtilisation, gamePayback, monthlyGameCost, topRented, accountsSlotUse, recentActivity,
  repeatRate, topSpenders, dormant, reviewStats
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-dashboard.js`
Expected: PASS — all prior assertions plus the 6 new ones.

- [ ] **Step 5: Run the full existing test suite**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
```

Expected: no `FAIL:` lines.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard.js scripts/test-dashboard.js
git commit -m "$(cat <<'EOF'
Add monthlyGameCost() to lib/dashboard.js

Pure function, tested like its neighbours: sums each game's cost into
the month it was acquired (release_date, falling back to created_at),
so the dashboard's upcoming profit tile can charge a month only the
costs it actually incurred rather than every game ever bought. Games
with no cost or no usable date are counted (missingCost, undated)
rather than guessed into a month or silently dropped.

gamePayback() is untouched — it answers a different question
(all-time payback per game) and stays the honest answer to that one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire `gameCostByMonth` into `server.js` and the client-side blob

**Files:**
- Modify: `server.js:4124` area (compute `gameCostByMonth`) and the `res.render('admin', {...})` locals list (`server.js:4611`)
- Modify: `views/partials/admin/dashboard/money.ejs` (inject as a client-side constant, same pattern as `MONTH_LOGS`)

**Interfaces:**
- Consumes: `monthlyGameCost(games)` from Task 1, exact return shape `{ byMonth, missingCost, undated, total }`.
- Produces: a client-side JS constant `GAME_COST_BY_MONTH` (the `byMonth` map) and `GAME_COST_META` (`{ missingCost, undated, total }`), both available to `renderMonthPanel()` in the same file — used by Task 3.

This is a separate task from Task 1 because it's a different kind of change — wiring a tested function into the request/render path — and Task 3 (the actual tile) depends on both this task's client-side constants existing under exactly these names.

- [ ] **Step 1: Compute it server-side**

In `server.js`, find:

```js
  const monthLogs = getMonthLogs();
```

Add immediately after it:

```js
  const gameCostByMonth = dashboard.monthlyGameCost(games);
```

(`games` is already in scope at this point in the route — it's the same `games` passed to `dashboard.gamePayback(games, customers)` later in this same handler.)

- [ ] **Step 2: Pass it to the view**

In the same route's `res.render('admin', { ... })` call, find:

```js
dashboardData, monthLogs,
```

Replace with:

```js
dashboardData, monthLogs, gameCostByMonth,
```

- [ ] **Step 3: Inject it client-side**

In `views/partials/admin/dashboard/money.ejs`, find:

```js
      const MONTH_LOGS = {};
      (<%- JSON.stringify(monthLogs).replace(/</g, '\\u003c') %>).forEach(function(m) { MONTH_LOGS[m.key] = m; });
```

Add immediately after it:

```js
      const GAME_COST_BY_MONTH = <%- JSON.stringify(gameCostByMonth.byMonth).replace(/</g, '\\u003c') %>;
      const GAME_COST_META = <%- JSON.stringify({ missingCost: gameCostByMonth.missingCost, undated: gameCostByMonth.undated, total: gameCostByMonth.total }).replace(/</g, '\\u003c') %>;
```

- [ ] **Step 4: Syntax check and boot check**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -c server.js && echo "server.js OK"
node -e "
const ejs = require('ejs');
try {
  ejs.compile(require('fs').readFileSync('views/admin.ejs', 'utf8'));
  console.log('admin.ejs (includes money.ejs) EJS syntax OK');
} catch (e) { console.error('EJS SYNTAX ERROR:', e.message); process.exit(1); }
"
```

Expected: both print their OK line. (`views/admin.ejs` is checked, not `money.ejs` directly, because `money.ejs` is an EJS partial — `<% include %>`-only syntax errors inside a partial can be invisible when compiling it standalone; compiling the page that includes it exercises the real render path.)

- [ ] **Step 5: Run the full existing test suite**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
```

Expected: no `FAIL:` lines — this task has no new test of its own (it's wiring, covered by Task 1's unit tests plus Task 3's browser verification), but must not break anything already passing.

- [ ] **Step 6: Commit**

```bash
git add server.js views/partials/admin/dashboard/money.ejs
git commit -m "$(cat <<'EOF'
Wire gameCostByMonth into the admin dashboard

Computed once server-side from the same games list gamePayback()
already uses, passed to the view, and injected client-side as
GAME_COST_BY_MONTH / GAME_COST_META — the same pattern money.ejs
already uses for MONTH_LOGS. Sends a pre-aggregated month totals map,
not per-game data, matching the trimming discipline server.js already
documents for dashboardData (1.4MB of the page before it was trimmed).

No visible change yet — the Profit tile that reads these lands next.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The Profit tile and warning line

**Files:**
- Modify: `views/partials/admin/dashboard/money.ejs` (tile grid, `renderMonthPanel()`)

**Interfaces:**
- Consumes: `GAME_COST_BY_MONTH`, `GAME_COST_META` from Task 2; the existing `MONTH_LOGS` map (already in this file, keyed the same way, `ad_spend` field); the existing `totalEarned` value `renderMonthPanel()` already computes via `dashRevenueInMonth(year, month)`.
- Produces: nothing further downstream — this is the plan's final task.

- [ ] **Step 1: Widen the tile grid and add the Profit tile**

Find:

```html
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:0.5rem;margin-bottom:0.85rem;">
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthEarned" style="color:#22c55e;">₱0</div><div class="dash-month-lbl">Total Earned</div></div>
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthTransactions" style="color:#fff;">0</div><div class="dash-month-lbl">Transactions</div></div>
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthRenters" style="color:#fbbf24;">0</div><div class="dash-month-lbl">Unique Renters</div></div>
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthReservations" style="color:#c084fc;">0</div><div class="dash-month-lbl">Reservations</div></div>
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthBuys" style="color:#60a5fa;">0</div><div class="dash-month-lbl">Games Bought</div></div>
        </div>
```

Replace with:

```html
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:0.5rem;margin-bottom:0.4rem;">
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthEarned" style="color:#22c55e;">₱0</div><div class="dash-month-lbl">Total Earned</div></div>
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthTransactions" style="color:#fff;">0</div><div class="dash-month-lbl">Transactions</div></div>
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthRenters" style="color:#fbbf24;">0</div><div class="dash-month-lbl">Unique Renters</div></div>
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthReservations" style="color:#c084fc;">0</div><div class="dash-month-lbl">Reservations</div></div>
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthBuys" style="color:#60a5fa;">0</div><div class="dash-month-lbl">Games Bought</div></div>
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthProfit" style="color:#22c55e;">₱0</div><div class="dash-month-lbl">Profit</div></div>
        </div>
        <div id="dashMonthProfitWarn" style="display:none;font-size:0.65rem;color:#f59e0b;margin-bottom:0.85rem;"></div>
```

(`margin-bottom` on the grid changes from `0.85rem` to `0.4rem` because the new warning line sits directly under it and carries its own `0.85rem` bottom margin — this keeps the same total gap above the "Most Rented This Month" heading that follows, rather than stacking two full margins.)

- [ ] **Step 2: Compute and render profit in `renderMonthPanel()`**

Find:

```js
      function renderMonthPanel() {
        if (!dashSelectedMonth) return;
        const { year, month } = dashSelectedMonth;
        const list = dashFilterMonth(year, month);
        const totalEarned = dashRevenueInMonth(year, month);
        const reservations = list.filter(c => c.status === 'reservation');
        const buys = list.filter(c => c.status === 'bought');
        const stillRenting = DASH_DATA.filter(c => dashOverlapsMonth(c, year, month));

        setText('dashMonthTitle', '📅 ' + MONTH_LONG[month] + ' ' + year);
        setText('dashMonthEarned', '₱' + totalEarned.toLocaleString());
        setText('dashMonthTransactions', list.length);
        setText('dashMonthRenters', dashRentersInMonth(year, month));
        setText('dashMonthReservations', reservations.length);
        setText('dashMonthBuys', buys.length);
        setText('dashMonthStillRenting', stillRenting.length);
        setText('dashMonthStillRentingS', stillRenting.length !== 1 ? 's were' : ' was');
```

Replace with:

```js
      function renderMonthPanel() {
        if (!dashSelectedMonth) return;
        const { year, month } = dashSelectedMonth;
        const list = dashFilterMonth(year, month);
        const totalEarned = dashRevenueInMonth(year, month);
        const reservations = list.filter(c => c.status === 'reservation');
        const buys = list.filter(c => c.status === 'bought');
        const stillRenting = DASH_DATA.filter(c => dashOverlapsMonth(c, year, month));

        setText('dashMonthTitle', '📅 ' + MONTH_LONG[month] + ' ' + year);
        setText('dashMonthEarned', '₱' + totalEarned.toLocaleString());
        setText('dashMonthTransactions', list.length);
        setText('dashMonthRenters', dashRentersInMonth(year, month));
        setText('dashMonthReservations', reservations.length);
        setText('dashMonthBuys', buys.length);
        setText('dashMonthStillRenting', stillRenting.length);
        setText('dashMonthStillRentingS', stillRenting.length !== 1 ? 's were' : ' was');

        // Profit: revenue minus the cost of games charged to THIS month minus
        // this month's ad spend. Both cost terms are keyed the same way
        // MONTH_LOGS already is ("YYYY-MM"), built once server-side by
        // lib/dashboard.js's monthlyGameCost() and getMonthLogs().
        const profitKey = monthKeyFor(year, month);
        const gameCost = GAME_COST_BY_MONTH[profitKey] || 0;
        const adSpend = (MONTH_LOGS[profitKey] && MONTH_LOGS[profitKey].ad_spend) || 0;
        const profit = totalEarned - gameCost - adSpend;
        const profitEl = document.getElementById('dashMonthProfit');
        setText('dashMonthProfit', (profit < 0 ? '-₱' : '₱') + Math.abs(profit).toLocaleString());
        if (profitEl) profitEl.style.color = profit < 0 ? '#ef4444' : '#22c55e';

        const warnEl = document.getElementById('dashMonthProfitWarn');
        if (warnEl) {
          const parts = [];
          if (GAME_COST_META.missingCost > 0) {
            parts.push('⚠ ' + GAME_COST_META.missingCost + ' of ' + GAME_COST_META.total + ' games have no cost recorded — profit is overstated');
          }
          if (GAME_COST_META.undated > 0) {
            parts.push(GAME_COST_META.undated + ' game cost' + (GAME_COST_META.undated !== 1 ? 's have' : ' has') + ' no date and aren\'t charged to any month');
          }
          if (parts.length) {
            warnEl.textContent = parts.join(' · ');
            warnEl.style.display = '';
          } else {
            warnEl.style.display = 'none';
          }
        }
```

This reuses the existing `monthKeyFor(year, month)` helper already defined in this file (`money.ejs:146`: `function monthKeyFor(year, month) { return year + '-' + String(month + 1).padStart(2, '0'); }`) — confirmed to produce exactly the `"YYYY-MM"` format `GAME_COST_BY_MONTH` and `MONTH_LOGS` are both keyed by, so the profit calculation never has its own, second implementation of that format to drift out of sync with the rest of the file.

- [ ] **Step 3: Syntax and boot check**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -c server.js && echo "server.js OK"
node -e "
const ejs = require('ejs');
try {
  ejs.compile(require('fs').readFileSync('views/admin.ejs', 'utf8'));
  console.log('admin.ejs EJS syntax OK');
} catch (e) { console.error('EJS SYNTAX ERROR:', e.message); process.exit(1); }
"
```

Expected: both OK.

- [ ] **Step 4: Run the full existing test suite**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
```

Expected: no `FAIL:` lines.

- [ ] **Step 5: Real browser verification**

Copy the repo to the scratch directory, patch `requireAuth` to `return next()` in the copy only (test-only, never committed, never done on the real repo), seed `games.json` with at least:
- one game with `cost` and `release_date` both set, in a month that also has a customer payment recorded (so `dashRevenueInMonth` returns a non-zero figure for that month)
- one game with `cost` set but no `release_date` and no usable `created_at`
- one game with no `cost` at all
- a `month_logs` entry for that same month with a known `ad_spend`

Boot the scratch copy, and using the browser tools:
- Open the Dashboard's Money tab, click the month containing the seeded data.
- Confirm the Profit tile shows exactly `totalEarned − gameCost − adSpend` computed by hand from the seeded numbers.
- Confirm the warning line appears and states both the missing-cost count and the undated count correctly.
- Confirm the Profit tile is green for this scenario (make the seeded revenue exceed cost + ad spend); then adjust the seed so cost exceeds revenue and confirm the tile turns red and the value shows a leading `-₱`.
- Confirm no console errors on the Dashboard tab.

- [ ] **Step 6: Commit**

```bash
git add views/partials/admin/dashboard/money.ejs
git commit -m "$(cat <<'EOF'
Add the Profit tile to the dashboard's month drill-down panel

profit = that month's revenue − that month's game costs (from
monthlyGameCost(), keyed the same way MONTH_LOGS already is) − that
month's ad spend. Green when >= 0, red when negative — a negative
month is a real, valid outcome, not an error state.

A warning line appears under the tile row whenever it would be
misleading: how many games have no cost recorded (profit is
overstated in that case, stated plainly) and how many have a cost but
no date to charge it to. With every game's cost filled in and dated,
the warning disappears on its own.

Verified in a real browser against seeded fixture data covering all
four cases: a dated/costed game, an undated one, a costless one, and
both a profit and a loss month.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
