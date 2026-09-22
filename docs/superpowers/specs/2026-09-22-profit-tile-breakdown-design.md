# Profit Tile Breakdown — Design

**Date:** 2026-09-22
**Status:** Approved for implementation
**Scope:** Makes the dashboard's Profit tile (`docs/superpowers/specs/2026-09-22-monthly-profit-design.md`, deployed) expandable, so the three numbers it subtracts are visible and, for the two composite ones, itemized on demand.

## Goal

A real production screenshot showed September 2026: ₱32,251 earned, ₱600 ad spend, ₱751 profit — implying roughly ₱30,900 in game costs landed in that month, with no way to see that from the tile itself. Clicking Profit should answer "why" without manual arithmetic across other tiles.

## What's confirmed, not assumed

- The screenshot showed **no missing-cost warning**, so production's catalogue has costs and dates recorded for every game with revenue — this breakdown will show real numbers, not the "profit is overstated" case the original spec anticipated for still-unfilled data.
- The "earned" breakdown needs **no new data sent to the client**. `dashPaymentsIn(year, month)` (`money.ejs:187-197`) already returns every payment in a given month as `{ c: customer, p: payment }` pairs — exactly what a breakdown list needs (customer, game, amount, date) — and `dashRevenueInMonth` already sums it for the tile that exists today.
- The "game costs" breakdown **does** need new data: only the aggregated `GAME_COST_BY_MONTH` totals map exists client-side today. Checked the real size impact rather than guessing: itemizing all 12 local games (title, cost, dates) serializes to 1.2 KB. A much larger production catalogue would still be single-digit KB — not a real weight concern, but a deliberate reversal of the original spec's "send totals, not per-game data" choice, so it's named here rather than snuck in.
- Ad spend is **not itemized**, by design, not by omission: `month_logs` stores one `ad_spend` value per month key (`server.js:6091-6099`) — it is already atomic, there is nothing under it to expand into. The existing "Month Log" section further down the same panel already shows the ad count and screenshots for that month.

## Design

### Interaction

The Profit tile becomes clickable. Clicking it reveals three summary lines directly beneath the tile row:

```
Earned         ₱32,251  ⌄
Game Costs     ₱30,900  ⌄
Ad Spend          ₱600
```

`Earned` and `Game Costs` each have their own expand affordance — clicking either one, independently, reveals its itemized list inline underneath that line. Both start collapsed; both can be open at once. `Ad Spend` has no affordance, since there's nothing under it to itemize.

- **Earned**, expanded: one row per payment for the month — customer name, game title, amount, date. Built entirely from `dashPaymentsIn(year, month)`, which already exists.
- **Game Costs**, expanded: one row per game charged to the month — title, cost. Built from a new itemized list alongside the existing totals (see below).

### `monthlyGameCost()` grows one field, not a second function

The function already iterates every game once to build `byMonth`. Adding an `items` map alongside it — month key → array of `{ id, title, cost }` — reuses that same iteration rather than duplicating the logic in a second pass:

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

`gamePayback()` and every other existing caller of `monthlyGameCost()` are unaffected — this only adds a field, nothing existing changes shape.

### Wiring

`server.js` and `money.ejs` already pass `gameCostByMonth.byMonth` to the client as `GAME_COST_BY_MONTH` (`docs/superpowers/plans/2026-09-22-monthly-profit.md`'s Task 2). The same pattern extends to `gameCostByMonth.items` as a new `GAME_COST_ITEMS` client-side constant.

## Explicitly out of scope

- **Itemizing ad spend.** Nothing to itemize — see above.
- **Deposits held as a cost.** Confirmed out: it's money currently being held, not money earned, and folding it into profit would overstate how much of this month's number is really settled. Left as its own stat card, unchanged.
- **A dedicated breakdown page or export.** This is an inline expand on the existing tile, not a new view.

## Testing

`scripts/test-dashboard.js` gains cases for `monthlyGameCost()`'s new `items` field:

- a game charged to a month appears in that month's `items` array with the right `id`, `title`, `cost`
- two games in the same month both appear, in the order they were iterated
- a game with no cost or no usable date does not appear in `items` for any month (mirrors the existing `byMonth` exclusion, checked against the same fixtures)

No new test file — this extends the existing `monthlyGameCost()` test block from the prior phase.

## Verification

1. Run the extended tests; prove the `items` assertions fail before the field exists.
2. Run the full `scripts/test-*.js` suite — no regressions.
3. Real browser check on a local scratch copy (`requireAuth` bypassed, this project's standing practice), seeded with a month containing at least two dated/costed games and at least two payments: click Profit, confirm both summary lines' numbers match the tile's own arithmetic, expand each, confirm the itemized rows sum to the same totals shown next to them.
4. Confirm a month with zero game costs (an empty `items` array for that key) expands to a clear empty state rather than a blank gap.

## Success criteria

- Clicking Profit reveals Earned / Game Costs / Ad Spend with the exact numbers the tile's own arithmetic already uses
- Earned and Game Costs each expand independently into itemized rows that sum to the line above them
- No new data sent for the Earned breakdown. Game Costs sends one itemized row only for games with a usable cost and date (the same games already counted in `GAME_COST_BY_MONTH`'s totals) — costless and undated games are excluded from `items` exactly as they're excluded from `byMonth` today, confirmed by the extended tests
- `gamePayback()` and the rest of the dashboard are unchanged
- Full test suite green
