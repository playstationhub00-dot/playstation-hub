# Profit Tile Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's Profit tile clickable to reveal Earned / Game Costs / Ad Spend, with Earned and Game Costs each independently expandable into itemized rows.

**Architecture:** `monthlyGameCost()` grows one new field (`items`, itemized rows alongside its existing `byMonth` totals) using the loop it already has. That's injected client-side as `GAME_COST_ITEMS`, the same pattern `money.ejs` already uses for `GAME_COST_BY_MONTH`. The Earned breakdown needs no new data — `dashPaymentsIn(year, month)` already returns everything needed. All new UI lives in `renderMonthPanel()` and two new small render functions, following the existing `dashRenderTopGamesList` pattern for itemized lists (including its `dashEscapeHtml` convention).

**Tech Stack:** Node.js (`lib/dashboard.js`), EJS + inline client-side JS (`views/partials/admin/dashboard/money.ejs`), plain `node` test scripts with `assert`.

## Global Constraints

- Direct-on-main workflow, no worktree isolation (established practice in this repo).
- `gamePayback()` is not modified.
- Ad Spend is never itemized — `month_logs` stores one `ad_spend` value per month key, there is nothing under it to expand.
- Deposits held are not part of profit and are not touched by this work.
- Any user-supplied text rendered into `innerHTML` (customer name, game title) goes through the existing `dashEscapeHtml()` helper (`money.ejs:242-244`) — the same convention `dashRenderTopGamesList` already uses.
- Never log into the site's admin panel. Verification uses a local scratch copy with `requireAuth` bypassed (test-only, never committed) — this project's established practice.

---

### Task 1: `monthlyGameCost()` grows an `items` field

**Files:**
- Modify: `lib/dashboard.js` (the `monthlyGameCost` function, `lib/dashboard.js:215-230`)
- Test: `scripts/test-dashboard.js` (extend the existing `monthlyGameCost()` test block)

**Interfaces:**
- Produces: `monthlyGameCost(games)` now returns `{ byMonth, items, missingCost, undated, total }`, where `items` is a plain object keyed by `"YYYY-MM"`, values are arrays of `{ id, title, cost }` for every game charged to that month, in the order `games` was iterated. `byMonth`, `missingCost`, `undated`, `total` are unchanged from before.
- Consumes: nothing from other tasks — self-contained.

- [ ] **Step 1: Write the failing tests**

In `scripts/test-dashboard.js`, find the existing `monthlyGameCost()` test block (added in the prior phase) and add these cases immediately after the last one (`'an empty or missing games list does not throw'`), before the final `console.log('\n' + passed + ...)` line:

```js
check('a game charged to a month appears in that month\'s items with id, title, cost', () => {
  const r = dash.monthlyGameCost([
    { id: 7, title: 'Test Game A', cost: 2500, release_date: '2026-09-15' }
  ]);
  assert.deepStrictEqual(r.items, { '2026-09': [{ id: 7, title: 'Test Game A', cost: 2500 }] });
});

check('two games in the same month both appear in items, in iteration order', () => {
  const r = dash.monthlyGameCost([
    { id: 1, title: 'First', cost: 2000, release_date: '2026-09-05' },
    { id: 2, title: 'Second', cost: 1500, release_date: '2026-09-20' }
  ]);
  assert.deepStrictEqual(r.items['2026-09'], [
    { id: 1, title: 'First', cost: 2000 },
    { id: 2, title: 'Second', cost: 1500 }
  ]);
});

check('a costless or undated game does not appear in items for any month', () => {
  const r = dash.monthlyGameCost([
    { id: 1, title: 'No Cost', cost: 0, release_date: '2026-09-01' },
    { id: 2, title: 'No Date', cost: 900 }
  ]);
  assert.deepStrictEqual(r.items, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-dashboard.js`
Expected: FAIL — `r.items` is `undefined`, so `assert.deepStrictEqual(undefined, { '2026-09': [...] })` fails on the first new assertion.

- [ ] **Step 3: Write the implementation**

In `lib/dashboard.js`, replace the entire `monthlyGameCost` function body:

```js
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

with:

```js
function monthlyGameCost(games) {
  const byMonth = {};
  const items = {};
  let missingCost = 0;
  let undated = 0;

  (games || []).forEach(g => {
    const cost = Number(g && g.cost) || 0;
    if (cost <= 0) { missingCost++; return; }
    const when = String((g && g.release_date) || (g && g.created_at) || '');
    const key = when.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) { undated++; return; }
    byMonth[key] = (byMonth[key] || 0) + cost;
    (items[key] = items[key] || []).push({ id: g.id, title: g.title, cost });
  });

  return { byMonth, items, missingCost, undated, total: (games || []).length };
}
```

(Only the doc comment above the function, already in place from the prior phase, stays as-is — it still accurately describes the "one month" rule this extends, not replaces.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-dashboard.js`
Expected: PASS — all prior assertions plus the 3 new ones.

- [ ] **Step 5: Run the full existing test suite**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
```

Expected: no `FAIL:` lines.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard.js scripts/test-dashboard.js
git commit -m "$(cat <<'EOF'
Add itemized items field to monthlyGameCost()

Reuses the function's existing per-game loop rather than a second
pass: alongside the month->total map it already returned, it now also
returns month->[{id,title,cost}] for the games charged to each month —
exactly the same inclusion rule (costed, dated) already applied to the
totals, so a costless or undated game is excluded from items exactly
as it's excluded from byMonth today.

This feeds the dashboard's upcoming expandable Profit tile breakdown.
gamePayback() and every other caller of monthlyGameCost() are
unaffected — this only adds a field.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire `GAME_COST_ITEMS` into the client-side blob

**Files:**
- Modify: `views/partials/admin/dashboard/money.ejs:148-149` (the existing `GAME_COST_BY_MONTH`/`GAME_COST_META` injection block)

**Interfaces:**
- Consumes: `gameCostByMonth.items` — already available server-side from Task 1's change, since `server.js:4125`'s `const gameCostByMonth = dashboard.monthlyGameCost(games);` already computes the whole object and `server.js`'s `res.render` already passes the whole `gameCostByMonth` local to the view (from the prior phase's Task 2) — **no `server.js` change is needed for this task**, only the view needs to read the new field off the object it already has.
- Produces: a client-side constant `GAME_COST_ITEMS`, the `items` map, available to `renderMonthPanel()` and the new render functions in Task 3.

This is separate from Task 1 because it's a different kind of change (wiring, not logic) and separate from Task 3 because Task 3's UI code depends on this constant existing under this exact name — a reviewer could approve "the data is wired through" before ever looking at how it's displayed.

- [ ] **Step 1: Confirm `server.js` already passes the whole object (no code change, a verification step)**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -n "gameCostByMonth" server.js
```

Expected output includes both:
```
  const gameCostByMonth = dashboard.monthlyGameCost(games);
```
and, in the `res.render('admin', { ... })` locals list:
```
dashboardData, monthLogs, gameCostByMonth, dashMetrics,
```

If the second line is missing or reads differently, stop — the prior phase's wiring has changed since this plan was written, and the view won't have `gameCostByMonth.items` to read. (It should not be missing; this is a safety check, not an expected code change.)

- [ ] **Step 2: Add the client-side constant**

In `views/partials/admin/dashboard/money.ejs`, find:

```js
      const GAME_COST_BY_MONTH = <%- JSON.stringify(gameCostByMonth.byMonth).replace(/</g, '\\u003c') %>;
      const GAME_COST_META = <%- JSON.stringify({ missingCost: gameCostByMonth.missingCost, undated: gameCostByMonth.undated, total: gameCostByMonth.total }).replace(/</g, '\\u003c') %>;
```

Replace with:

```js
      const GAME_COST_BY_MONTH = <%- JSON.stringify(gameCostByMonth.byMonth).replace(/</g, '\\u003c') %>;
      const GAME_COST_ITEMS = <%- JSON.stringify(gameCostByMonth.items).replace(/</g, '\\u003c') %>;
      const GAME_COST_META = <%- JSON.stringify({ missingCost: gameCostByMonth.missingCost, undated: gameCostByMonth.undated, total: gameCostByMonth.total }).replace(/</g, '\\u003c') %>;
```

- [ ] **Step 3: Syntax and boot check**

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

Expected: both OK.

- [ ] **Step 4: Run the full existing test suite**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
```

Expected: no `FAIL:` lines — this task has no test of its own (pure wiring, covered by Task 1's unit tests and Task 3's browser verification), but must not break anything.

- [ ] **Step 5: Commit**

```bash
git add views/partials/admin/dashboard/money.ejs
git commit -m "$(cat <<'EOF'
Wire GAME_COST_ITEMS into the client-side dashboard blob

Same pattern already used for GAME_COST_BY_MONTH and GAME_COST_META —
no server.js change needed, since it already passes the whole
gameCostByMonth object to the view from the prior phase. No visible
change yet; the UI that reads this lands next.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The expandable breakdown UI

**Files:**
- Modify: `views/partials/admin/dashboard/money.ejs` (markup after the Profit warning div; `renderMonthPanel()`; `window.selectDashMonth`; two new render functions)
- Modify: `public/css/style.css` (one new class, matching the existing `.dash-month-stat` pattern)

**Interfaces:**
- Consumes: `GAME_COST_ITEMS` from Task 2; `GAME_COST_BY_MONTH`, `MONTH_LOGS`, `dashPaymentsIn`, `dashEscapeHtml`, `monthKeyFor` — all pre-existing.
- Produces: nothing further downstream — this is the plan's final task.

- [ ] **Step 1: Add the CSS class for a clickable breakdown line**

In `public/css/style.css`, find:

```css
.dash-month-stat { background: #0d0d0d; border: 1px solid #1e1e1e; border-radius: 8px; padding: 0.6rem 0.5rem; text-align: center; }
```

Add immediately after it:

```css
.dash-profit-line { display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.1rem; cursor: pointer; font-size: 0.75rem; }
.dash-profit-line:hover { background: #0f0f0f; }
.dash-profit-line-label { color: #999; }
.dash-profit-line-val { color: #fff; font-weight: 700; }
.dash-profit-items { padding: 0 0.5rem 0.5rem 0.5rem; }
.dash-profit-item { display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0; font-size: 0.7rem; color: #aaa; border-bottom: 1px solid #161616; }
.dash-profit-item:last-child { border-bottom: none; }
```

- [ ] **Step 2: Make the Profit tile clickable, add the breakdown container**

Find (the tile grid plus the warning div immediately after it):

```html
          <div class="dash-month-stat"><div class="dash-month-val" id="dashMonthProfit" style="color:#22c55e;">₱0</div><div class="dash-month-lbl">Profit</div></div>
        </div>
        <div id="dashMonthProfitWarn" style="display:none;font-size:0.65rem;color:#f59e0b;margin-bottom:0.85rem;"></div>
```

Replace with:

```html
          <div class="dash-month-stat" onclick="toggleProfitBreakdown()" style="cursor:pointer;" title="Click to see the breakdown"><div class="dash-month-val" id="dashMonthProfit" style="color:#22c55e;">₱0</div><div class="dash-month-lbl">Profit ▾</div></div>
        </div>
        <div id="dashMonthProfitWarn" style="display:none;font-size:0.65rem;color:#f59e0b;margin-bottom:0.85rem;"></div>
        <div id="dashProfitBreakdown" style="display:none;background:#0a0a0a;border:1px solid #1e1e1e;border-radius:8px;margin-bottom:0.85rem;padding:0.3rem 0.6rem;">
          <div class="dash-profit-line" onclick="toggleProfitDetail('earned')">
            <span class="dash-profit-line-label">Earned <span id="dashProfitEarnedCaret">▸</span></span>
            <span class="dash-profit-line-val" id="dashProfitEarnedVal" style="color:#22c55e;">₱0</span>
          </div>
          <div id="dashProfitEarnedItems" class="dash-profit-items" style="display:none;"></div>
          <div class="dash-profit-line" onclick="toggleProfitDetail('cost')">
            <span class="dash-profit-line-label">Game Costs <span id="dashProfitCostCaret">▸</span></span>
            <span class="dash-profit-line-val" id="dashProfitCostVal" style="color:#f59e0b;">₱0</span>
          </div>
          <div id="dashProfitCostItems" class="dash-profit-items" style="display:none;"></div>
          <div class="dash-profit-line" style="cursor:default;">
            <span class="dash-profit-line-label">Ad Spend</span>
            <span class="dash-profit-line-val" id="dashProfitAdVal" style="color:#888;">₱0</span>
          </div>
        </div>
```

(`dash-profit-line` sets `cursor: pointer` by default in the CSS from Step 1; the Ad Spend line overrides it inline to `cursor:default` since it has no click handler — it is deliberately not wrapped in a `toggleProfitDetail(...)` call, matching the design's "ad spend is atomic, nothing to expand" decision.)

- [ ] **Step 3: Reset breakdown state when the selected month changes**

Find:

```js
      window.selectDashMonth = function(year, month) {
        dashSelectedMonth = { year, month };
        dashMonthLogEditMode = false;
        renderDashChart(year);
        renderMonthPanel();
      };
```

Replace with:

```js
      window.selectDashMonth = function(year, month) {
        dashSelectedMonth = { year, month };
        dashMonthLogEditMode = false;
        dashProfitBreakdownOpen = false;
        dashProfitEarnedOpen = false;
        dashProfitCostOpen = false;
        renderDashChart(year);
        renderMonthPanel();
      };
```

Then find:

```js
      let dashSelectedMonth = null; // { year, month } or null
```

Replace with:

```js
      let dashSelectedMonth = null; // { year, month } or null
      let dashProfitBreakdownOpen = false;
      let dashProfitEarnedOpen = false;
      let dashProfitCostOpen = false;
```

- [ ] **Step 4: Populate the breakdown lines and add the toggle/render functions**

Find, in `renderMonthPanel()`:

```js
        const warnEl = document.getElementById('dashMonthProfitWarn');
        if (warnEl) {
          const parts = [];
          if (GAME_COST_META.missingCost > 0) {
            parts.push('⚠ ' + GAME_COST_META.missingCost + ' of ' + GAME_COST_META.total + ' games have no cost recorded — profit is overstated');
          }
          if (GAME_COST_META.undated > 0) {
            parts.push(GAME_COST_META.undated + ' game cost' + (GAME_COST_META.undated !== 1 ? 's have no date and aren\'t' : ' has no date and isn\'t') + ' charged to any month');
          }
          if (parts.length) {
            warnEl.textContent = parts.join(' · ');
            warnEl.style.display = '';
          } else {
            warnEl.style.display = 'none';
          }
        }
```

Add immediately after this block and before the line that follows it, `dashRenderTopGamesList(document.getElementById('dashMonthTopGames'), dashTopGames(list, 5), 'No rentals this month');` (still inside `renderMonthPanel()`):

```js

        // Breakdown lines — the three numbers the Profit tile above already
        // subtracts. Earned and Game Costs are independently expandable;
        // Ad Spend is not (see the CSS/markup: it has no click handler and
        // no caret) because month_logs stores one ad_spend value per month —
        // there is nothing under it to itemize.
        setText('dashProfitEarnedVal', '₱' + totalEarned.toLocaleString());
        setText('dashProfitCostVal', '₱' + gameCost.toLocaleString());
        setText('dashProfitAdVal', '₱' + adSpend.toLocaleString());
        renderProfitBreakdownState();
```

- [ ] **Step 5: Add the four new functions**

Find `window.clearMonthSelection` (right after `window.selectDashMonth`, already read in Step 3 above) and add these four new functions immediately before it:

```js
      window.toggleProfitBreakdown = function() {
        dashProfitBreakdownOpen = !dashProfitBreakdownOpen;
        renderProfitBreakdownState();
      };
      window.toggleProfitDetail = function(which) {
        if (which === 'earned') dashProfitEarnedOpen = !dashProfitEarnedOpen;
        if (which === 'cost') dashProfitCostOpen = !dashProfitCostOpen;
        renderProfitBreakdownState();
      };
      function renderProfitBreakdownState() {
        const outer = document.getElementById('dashProfitBreakdown');
        if (outer) outer.style.display = dashProfitBreakdownOpen ? '' : 'none';
        if (!dashProfitBreakdownOpen || !dashSelectedMonth) return;
        const { year, month } = dashSelectedMonth;

        const earnedCaret = document.getElementById('dashProfitEarnedCaret');
        const earnedItemsEl = document.getElementById('dashProfitEarnedItems');
        if (earnedCaret) earnedCaret.textContent = dashProfitEarnedOpen ? '▾' : '▸';
        if (earnedItemsEl) {
          earnedItemsEl.style.display = dashProfitEarnedOpen ? '' : 'none';
          if (dashProfitEarnedOpen) renderProfitEarnedItems(year, month);
        }

        const costCaret = document.getElementById('dashProfitCostCaret');
        const costItemsEl = document.getElementById('dashProfitCostItems');
        if (costCaret) costCaret.textContent = dashProfitCostOpen ? '▾' : '▸';
        if (costItemsEl) {
          costItemsEl.style.display = dashProfitCostOpen ? '' : 'none';
          if (dashProfitCostOpen) renderProfitCostItems(year, month);
        }
      }
      function renderProfitEarnedItems(year, month) {
        const el = document.getElementById('dashProfitEarnedItems');
        if (!el) return;
        const payments = dashPaymentsIn(year, month);
        if (!payments.length) {
          el.innerHTML = '<div style="color:#444;font-size:0.7rem;padding:0.4rem 0;">No payments this month</div>';
          return;
        }
        el.innerHTML = payments.map(function (x) {
          return '<div class="dash-profit-item"><span>' + dashEscapeHtml(x.c.customer_name || 'Unknown') + ' — ' + dashEscapeHtml(x.c.game_title || '') + '</span><span>₱' + (x.p.amount || 0).toLocaleString() + '</span></div>';
        }).join('');
      }
      function renderProfitCostItems(year, month) {
        const el = document.getElementById('dashProfitCostItems');
        if (!el) return;
        const key = monthKeyFor(year, month);
        const rows = GAME_COST_ITEMS[key] || [];
        if (!rows.length) {
          el.innerHTML = '<div style="color:#444;font-size:0.7rem;padding:0.4rem 0;">No games charged this month</div>';
          return;
        }
        el.innerHTML = rows.map(function (r) {
          return '<div class="dash-profit-item"><span>' + dashEscapeHtml(r.title || '') + '</span><span>₱' + (r.cost || 0).toLocaleString() + '</span></div>';
        }).join('');
      }
```

- [ ] **Step 6: Syntax and boot check**

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

- [ ] **Step 7: Run the full existing test suite**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
```

Expected: no `FAIL:` lines.

- [ ] **Step 8: Real browser verification**

Copy the repo to the scratch directory, patch `requireAuth` to `return next()` in the copy only (test-only, never committed, never done on the real repo), seed `games.json` with:
- at least 2 games with `cost` and `release_date` both set, landing in the same month
- at least 2 customer payments in that same month (different `customer_name`/`game_title`/`amount`/`date`)
- a `month_logs` entry for that month with a known `ad_spend`

Boot the scratch copy, and using the browser tools:
- Open the Dashboard's Money tab, click the seeded month.
- Confirm the Profit tile's own value is unchanged from before this task (this task only adds UI around it, never changes the arithmetic).
- Click the Profit tile: confirm the breakdown panel opens showing Earned / Game Costs / Ad Spend, and that the three values match `totalEarned`, `gameCost`, `adSpend` as already computed by the existing (unmodified) profit calculation in `renderMonthPanel()`.
- Click "Earned": confirm it expands to list both seeded payments, each row showing customer name, game title, and amount, summing to the Earned line above it.
- Click "Game Costs": confirm it expands to list both seeded games with their costs, summing to the Game Costs line above it.
- Confirm "Ad Spend" has no caret and does not respond to a click.
- Click "Earned" again: confirm it collapses. Click the Profit tile again: confirm the whole breakdown collapses.
- Select a different month with no seeded game costs: confirm "Game Costs" expands to the "No games charged this month" empty state rather than a blank gap.
- Confirm no console errors throughout.

- [ ] **Step 9: Commit**

```bash
git add views/partials/admin/dashboard/money.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Make the Profit tile expandable into an Earned/Cost/Ad Spend breakdown

Clicking Profit reveals the three numbers its own arithmetic already
subtracts. Earned and Game Costs each expand independently into
itemized rows — Earned from the existing dashPaymentsIn() (no new data
needed), Game Costs from the new GAME_COST_ITEMS blob. Ad Spend has no
expand affordance by design: month_logs stores one value per month,
there's nothing under it to itemize.

Collapse state resets whenever a different month is selected, matching
the existing convention for dashMonthLogEditMode in selectDashMonth.

Verified in a real browser against seeded fixture data: two payments
and two costed games in the same month, confirming both breakdown
lists sum to the values shown next to them, and a separate month with
no game costs confirming the itemized list's empty state.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
