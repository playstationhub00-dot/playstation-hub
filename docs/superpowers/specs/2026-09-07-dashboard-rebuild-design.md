# Dashboard Rebuild — Design

**Goal:** Replace the four-section scrolling dashboard with five focused
sub-tabs, and surface nine numbers the app already collects but has never
displayed.

**Status:** drafted 2026-09-07, decisions taken with the owner the same day.

## What the owner said

Asked what job the dashboard does, the owner picked all four: what needs my
action now, am I making money, what should I buy next, is the site working.
Game costs are recorded *sometimes*. Traffic detail should shrink out of the
main view. Periods should be driven by one picker. Content should be split
across sub-tabs rather than one long page.

## The finding

Six things are gathered on every order, customer or account and then never
aggregated anywhere: `payment_method`, per-game `cost` against that game's
own revenue, slot occupancy, repeat customers, request votes, and review
state. Four of them answer money questions the dashboard could not answer.

Meanwhile the page led with website analytics — 840 of its 951 lines — and
its headline "Net Profit" subtracted every game ever bought from the current
period's revenue, which is two different clocks in one number.

## Structure

Five sub-tabs inside the Dashboard panel, as a pill row. Selection lives in
`?sub=` and in localStorage, matching how the main tabs already behave.

| Sub-tab | Contents | Period |
|---|---|---|
| **Now** (default) | 5 action cards; live strip: out on rent, reservations, bought, in queue, collected this month | always live |
| **Money** | collected, rentals vs sales, deposits held, ad cost per rental, monthly bars + month drill-down + ad log, payment mix | picker |
| **Games** | slot utilisation, fully booked, top requests, per-game payback, most rented | picker |
| **Customers** | repeat rate, new vs returning, top spenders, review stats, dormant 60d | picker |
| **Site** | funnel, 14-day chart, top pages, exit pages, visit log — moved intact | own filters |

The picker (`?dperiod=month|3m|year|all`) governs Money, Games and Customers.
Now and Site ignore it: one is live state, the other has its own filters.

## Architecture

**`lib/dashboard.js`** — pure functions taking raw collections, returning
derived shapes. No database, no environment, no dates read from the clock
except through an injected `now`. Paired with `scripts/test-dashboard.js`
using plain `assert`, matching every other lib module in this project.

Nine metrics computed inline in the `/admin` route would push it past 400
lines; this keeps the route a caller.

**`views/partials/admin/dashboard/`** — `now.ejs`, `money.ejs`, `games.ejs`,
`customers.ejs`, `site.ejs`, with `dashboard.ejs` reduced to a shell holding
the pill row. The file is 951 lines today.

**Period is resolved server-side.** One source of truth, testable, and the
same pattern the orders ledger period already uses. The monthly chart and its
month drill-down stay client-side, unchanged — they work and the drill-down
is genuinely interactive.

## Honesty requirements

- **Payback** covers only games with a cost recorded, and states how many
  are missing one, linking to the Games tab. Revenue matches on `game_id`,
  never on title, so renaming a game cannot orphan its history.
- **Repeat rate** is derived from typed customer names, not verified
  identities. The tile says so; the code already carries this caveat on the
  metric being replaced.
- A metric with no data renders as an empty state naming what is missing,
  never as a zero that reads like a real measurement.

## Deleted

- **Net Profit (all-time)** — mixes lifetime capital against period revenue.
- **Total Game Costs** as a lump — replaced by per-game payback.
- **Unique Renters** — counted from typed names; superseded by repeat rate,
  which is the actionable version of the same idea.
- **Insight pills** — generic auto-written advice; the numbers say it better.

## Not building

- A sidebar Traffic tab. The Site sub-tab covers it.
- Any new tracking. Every number here comes from data already stored.
- Changes to the month drill-down, the ad/screenshot log, or the visit
  tracking middleware.
