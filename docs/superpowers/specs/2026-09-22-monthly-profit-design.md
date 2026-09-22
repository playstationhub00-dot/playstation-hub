# Monthly Profit on the Dashboard — Design

**Date:** 2026-09-22
**Status:** Approved for implementation
**Scope:** One new tile in the admin dashboard's month drill-down panel.

## Goal

Show, for a selected month, what was actually made after costs:

```
profit = revenue that month − game costs charged to that month − ad spend that month
```

## The history this has to avoid repeating

This feature existed before and was deliberately removed. The reason is
recorded in `views/partials/admin/dashboard/money.ejs:69-73`:

> Net Profit and Total Game Costs are gone: they subtracted every game ever
> bought from one period's revenue, which is two different clocks in one
> number. Per-game payback on the Games pane answers it honestly.

That objection is correct and this design does not reopen it. The old
version charged *every game ever bought* against *every* period. This one
charges each game's cost to exactly one month — the month it was acquired —
so a month only carries costs it actually incurred. Two different clocks
become one.

The existing `gamePayback()` in `lib/dashboard.js:174` stays exactly as it
is. It answers a different question (has this one game earned its cost
back, all-time) and remains the honest answer to that question.

## Data reality, checked rather than assumed

Checked against the local `games.json`:

- **0 of 12** games have a `cost` recorded
- **0 of 12** games have a `release_date`
- all 12 share one `created_at` day (`2026-06-26`)
- there are no `upcoming` records at all

That last pair makes it clear this local file is a **stale dev fixture, not
production data** — production was serving entirely different games earlier
in this session. So this tells us nothing reliable about what is filled in
production, and the design must work either way rather than assume.

Two existing facts do carry over regardless:

- `lib/dashboard.js:174` already tracks a `missingCost` count and documents
  the principle plainly: *"Games with no cost recorded are counted, not
  guessed at — a payback figure invented from a missing cost would be worse
  than no figure."* This design follows the same rule.
- `MONTH_LOGS` is already built client-side (`money.ejs:144-145`) as a map
  of month key → log, including `ad_spend`. No server change is needed to
  get ad spend into this calculation.

## Design

### 1. Charging a game's cost to a month

A game's cost is charged to the month of its `release_date`, falling back to
`created_at` when `release_date` is not set. A game with a cost but neither
date is charged to no month and counted separately, so its cost can never
silently vanish into a month it doesn't belong to.

Games with no cost recorded (`cost` unset or `<= 0`) contribute nothing and
are counted for the warning line — never guessed at.

### 2. New pure function in `lib/dashboard.js`

Follows this file's existing shape: a pure function, no I/O, unit-tested in
`scripts/test-dashboard.js`.

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

### 3. Server passes it to the view

`server.js` already passes `games` and `monthLogs` to the admin view. Add
one more local — the pre-aggregated result — rather than shipping every
game's cost to the browser.

This matters: `dashboardData` is deliberately a trimmed subset of each
customer, with a comment at `server.js:4125` recording that the customer
list was *1.4MB of the admin page's 1.8MB* before being trimmed. A month →
total map is a handful of numbers; a per-game array would be the same
mistake in miniature.

### 4. The tile

The month drill-down panel's tile row (`money.ejs:116`) goes from
`repeat(5,1fr)` to `repeat(6,1fr)`, adding a Profit tile after Games Bought.

Profit is computed client-side from three values already in scope:

```js
const gameCost = GAME_COST_BY_MONTH[key] || 0;
const adSpend = (MONTH_LOGS[key] && MONTH_LOGS[key].ad_spend) || 0;
const profit = totalEarned - gameCost - adSpend;
```

`totalEarned` is the exact value the Total Earned tile beside it already
shows (`money.ejs:359`, via `dashRevenueInMonth`), so the two tiles can
never disagree about what a month earned.

Coloured green when positive, red when negative — a negative month is a real
and important outcome (a month where a game was bought but hadn't earned
back yet), not an error state to hide.

### 5. The warning line

Directly under the tile row, shown only when something would make the figure
misleading:

- when `missingCost > 0`: `⚠ N of M games have no cost recorded — profit is
  overstated`
- when `undated > 0`: `· N game cost(s) have no date and aren't charged to
  any month`

Both counts come from `monthlyGameCost()`. The wording states the direction
of the error ("overstated"), because a number that is wrong in a known
direction is far more useful than a bare caveat — and because with costs
unfilled, profit equals revenue exactly, which looks like a great month and
means nothing.

## Explicitly out of scope

- **A year-level profit card** next to Total Earned / Rental Revenue / Game
  Sales. Decided against: the month panel is the right granularity, and
  year-level profit re-raises the same clock-mixing question for games
  bought outside the selected year.
- **Changing `gamePayback()`** or the Games pane. It answers a different
  question and stays as-is.
- **A new "date bought" field** on the game form. Considered; rejected in
  favour of `release_date` → `created_at`, which needs no data re-entry
  across the existing catalogue.
- **Backfilling game costs.** This design surfaces how many are missing; it
  does not invent them, and filling them in stays an owner task.
- **Matching revenue to specific games.** Not needed: profit works off month
  totals only, which sidesteps the title-vs-id fragility `gamePayback()`
  documents.

## Testing

`scripts/test-dashboard.js` (existing file) gains cases for
`monthlyGameCost()`:

- a game with `release_date` charges its cost to that month
- a game with no `release_date` falls back to `created_at`
- a game with a cost but neither date counts in `undated` and lands in no month
- a game with no cost counts in `missingCost` and contributes nothing
- two games in the same month sum into one entry
- `monthlyGameCost([])` and `monthlyGameCost(null)` return zeroed results without throwing

A source-level check in the same file confirms the tile's own arithmetic
subtracts both game cost and ad spend, so a future edit can't quietly drop
one of the two terms and leave a figure still labelled Profit.

## Verification

1. Run the new tests; prove they fail before the function exists.
2. Run the full `scripts/test-*.js` suite — no regressions.
3. Boot a local scratch copy with `requireAuth` bypassed (this project's
   established practice — the admin panel is never logged into), seed a
   couple of games with known costs and dates plus a month log with a known
   `ad_spend`, and confirm in a real browser that clicking that month shows
   a Profit tile equal to `earned − cost − adSpend` computed by hand.
4. Confirm the warning line appears with the correct counts when a game has
   no cost, and disappears when every game has one.
5. Confirm a negative profit month renders red rather than breaking.

## Risks

| Risk | Mitigation |
|---|---|
| Profit looks great only because costs are unfilled | The warning line states the direction of the error, and says how many games are missing a cost |
| `created_at` fallback charges a cost to the month the game was *added*, not bought | Documented in the function's own comment; the alternative (dropping the cost entirely) hides money that was really spent |
| Re-introducing the metric that was removed before | The removal's stated objection was per-period double-counting of every game ever bought; this charges each cost to exactly one month, and the original comment is updated so the next reader sees why this version differs |
| Page weight | Server sends a pre-aggregated month → total map, not per-game data — the same trimming discipline `server.js:4125` already records for `dashboardData` |

## Success criteria

- Clicking a month shows a Profit tile = that month's earnings − that
  month's game costs − that month's ad spend
- A month with no recorded costs still shows a figure, with a warning saying
  how many games lack a cost and that profit is overstated
- A negative month renders correctly, in red
- `gamePayback()` and every existing dashboard figure are unchanged
- Full test suite green
