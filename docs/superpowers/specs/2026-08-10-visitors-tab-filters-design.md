# Visitors Tab: Period Filters + Nested Funnel — Design

**Date:** 2026-08-10
**Status:** Approved design, pending implementation plan

## The problem

Two issues, discovered together when the session funnel shipped 2026-08-10 and ran against real traffic for the first time.

### 1. The funnel's stages are not nested, and it now visibly reads as broken

Live data from the first day:

| Stage | Sessions |
|---|---|
| Landed | 25 |
| Browsed | 2 |
| Viewed a game | 11 |

`Viewed a game` renders as **550%** — eleven sessions divided by the two that preceded it — with a bar longer than the stage above it. The math is correct; the model is wrong. `/browse` is not a step on the path to viewing a game on this site. Only 2 of 25 sessions touched it, while 11 went straight to a game page, which is exactly what direct links from the business's Facebook page produce.

This was flagged during the session-funnel plan's final review. A clarifying caption was added instead of changing the stages, on the reasoning that the stage order was part of the approved design. With real numbers visible, the caption is not enough: a funnel showing 550% next to an inverted bar reads as a bug regardless of what the caption says.

### 2. The funnel and exit-pages panels cannot be filtered at all

Every neighbouring panel in the Visitors tab (Most Visited Pages, Recent Visits) has Today/Weekly/Monthly/Yearly/All buttons. The two new panels have none — they are permanently "since launch". Separately, clicking a bar in the 14-day chart currently refreshes only the Recent Visits table, leaving every other panel showing a different time window than the one the user just selected. The tab can display four panels describing four different periods simultaneously, with nothing on screen indicating that.

## What changes

### Stage definitions, nested by construction

| Stage | Definition |
|---|---|
| Landed | Every session in the window |
| Viewed a game | Session has any row with `path` starting `/game/` **OR** the session has an order |
| Started order | Session has an order |
| Paid | Session has an order whose state is not in `orders.PAID_EXCLUDED_STATES` |

The **OR the session has an order** clause in "Viewed a game" is deliberate and load-bearing. An order can only be created from a game page, so in practice every ordering session also has a `/game/*` row — but *in practice* is not a guarantee. If that pageview row were ever missing (a tracking gap, a middleware exclusion change, a direct POST), a naive definition would produce `Started order > Viewed a game` and reintroduce a percentage above 100%. Folding the order into the game-view condition makes `Landed ⊇ Viewed a game ⊇ Started order ⊇ Paid` structurally true rather than incidentally true.

Consequences: no percentage can exceed 100%, bar widths are monotonically non-increasing, and the "stages aren't a strictly sequential path" caption added in the previous plan is removed as no longer applicable.

`Paid` continues to read `orders.PAID_EXCLUDED_STATES` — the shared constant introduced when the previous plan's final review caught cancelled orders being counted as paid. This spec does not redefine it.

### "Browsed the catalog" becomes a standalone stat

Displayed above the funnel as a single line — `Browsed the catalog — 2 of 25 sessions (8%)` — not as a funnel stage. The number is genuinely useful (it says the Browse page is nearly unused, which is actionable) but it does not belong in a sequence it isn't part of.

### One computation pass, many windows

Today the funnel walks every sessioned visitor row on each `/admin` render. Adding five periods plus fourteen chart days by repeating that walk would mean nineteen passes over a collection that grows without bound.

Instead, a single pass collapses the raw rows into one compact record per session:

```
{ startDate, browsed, viewedGame, ordered, paid, exitPath }
```

Every window is then derived by filtering that summary array — cheap, because there is one record per session rather than one per pageview. The nineteen result sets (five named periods, fourteen chart dates) are computed from it server-side and shipped to the view as a single JSON object, mirroring how `TP_DATA` already serves Most Visited Pages.

**A session belongs to the date of its first recorded visit.** A session that lands Monday and orders Tuesday counts entirely toward Monday. The alternative — counting a session on every date it was active — would double-count sessions across days and make "Landed" meaningless as a total.

### Filtering behaviour

Both new panels get the same five buttons, styling, and active-state behaviour as the existing panels: **Today / Weekly / Monthly / Yearly / All**. Client-side swap of precomputed data, matching `setTopFilter()`'s existing pattern. No new endpoint, no loading state.

Clicking a bar in the 14-day chart filters **the funnel, exit pages, Most Visited Pages, and Recent Visits together**, so the whole tab describes one window. Recent Visits keeps fetching that day's full row list from the existing `/admin/api/visitors-by-date` endpoint (the server-rendered table only holds the 100 most recent rows overall, so an older day may not appear in it at all); the other three panels read their precomputed per-date entry with no request.

Selecting a period button clears any active date selection, and selecting a date clears the active period button. The existing `📅 <date> — click a filter button above to clear` hint is retained as the affordance for getting back.

Because only the fourteen chart bars are clickable, only those fourteen dates are precomputed. Total payload across all nineteen result sets is a few kilobytes.

## What deliberately does not change

- **`orders.PAID_EXCLUDED_STATES`** and the definition of "paid" — established by the previous plan, shared with the Orders tab's weekly readout, and explicitly not redefined here.
- **The Orders tab's weekly funnel readout** ("N started · N completed · N abandoned · X% of game-page visits"). It has its own pageview-based denominator and its own window, and is untouched.
- **The four KPI cards** at the top of the Visitors tab (Today's Visits / Last 7 Days / Last 30 Days / All-Time). Their IP-based unique-visitor dedup is a known-imperfect legacy measure carried over from before session tracking existed; correcting or removing them is out of scope here.
- **Session identity, the `ph_sid` cookie, IP hashing, and `session_id` stamping on orders** — all shipped in the previous plan and unmodified.
- **The 14-day chart itself** — same bars, same data, same 14-day span. Only its click handler's reach changes.

## Out of scope

- Arbitrary date ranges or a calendar picker; the five named periods plus the fourteen chart days are the whole surface.
- Per-date breakdowns beyond the fourteen chart days (no clickable Yearly/All drilldown).
- Any change to how visits are recorded, or any backfill of pre-launch rows lacking a `session_id` — those remain excluded from every session-scoped panel, as established previously.
- Removing the test-order artifacts (`/order/PH-0005`, `/order/create`) currently visible in the panels. They are real recorded visits and will age out of the Today and Weekly windows naturally.
