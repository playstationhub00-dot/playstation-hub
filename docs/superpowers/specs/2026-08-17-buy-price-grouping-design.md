# Buy Page Price Grouping and Stock Status — Design

**Date:** 2026-08-17
**Status:** Approved

## The problem

`/buy` renders every single-game card in one flat grid — 39 cards today, with no
structure. Two things are missing from it.

**There is no price structure.** The 39 games sit at 7 distinct price points
(₱499×3, ₱799×6, ₱999×12, ₱1,499×5, ₱1,999×11, ₱2,499×1, ₱4,000×1) in arbitrary
order. Someone with a budget has to scan all 39 cards to find what they can afford.
`/browse` already solves this for rentals by grouping into price-tier sections;
`/buy` does not.

**There is no stock signal.** 8 of the 39 games are not stocked — never rented and
not marked stocked, meaning the account does not exist yet and gets created after
the order. Today `/buy` renders those identically to the 31 ready games. The
customer only learns about the delay after clicking through to the detail page.

## Why availability is a marker, not a section

The 8 pending games are:

> Death Stranding 2 · Monster Hunter Wilds · Resident Evil Requiem · Saros ·
> MARVEL Tōkon: Fighting Souls · Dying Light: The Beast · Reanimal ·
> Assassin's Creed Legacy Account

These are the newest and most in-demand titles in the catalog, not leftovers. A
dedicated "pending" section would place them at the bottom of the page and read as
"unavailable, skip these" — burying the strongest demand-generators on the page.

For a permanent purchase this framing is also wrong on the merits: not having the
account yet means a short setup delay, not an inability to sell. The page already
sells exactly that proposition in its "Don't see it? We'll buy it for you" card.

So price becomes the section structure — it is the axis people actually shop on,
and it matches `/browse` — while availability becomes a per-card marker plus an
opt-in filter.

## What changes

### 1. Pending detection

A game is pending when:

```js
!game.renters && !game.stocked
```

This is the existing `neverRented` test from `views/game-detail.ejs`, already
controlled by the admin "📦 Mark stocked" toggle (`POST /admin/games/:id/stocked`).
No new field and no new admin UI: marking a game stocked clears the badge on `/buy`
and the amber notice on the detail page simultaneously.

### 2. Price grouping

Computed server-side in the `/buy` route, extending the existing `singleGames`
mapping rather than moving logic into the view. The route already transforms games
there (price, promo, slug), so the grouping belongs beside it.

Groups are exact price points, ordered ascending — cheapest first, matching how
someone shops to a budget.

**Singleton merging rule.** Let `MIN_GROUP = 3`. Start at the highest price point.
While the current price point holds fewer than `MIN_GROUP` games *and* a lower price
point exists, move it into the trailing group and step down. Stop at the first price
point holding `MIN_GROUP` or more — that point and everything below it keep their own
sections.

The trailing group is labelled `₱X and up`, where X is the lowest price it contains.
If the highest price point is not itself thin, no trailing group forms at all and
every price point stands alone.

Applied to today's catalog: ₱4,000 holds 1 (thin, merge), ₱2,499 holds 1 (thin,
merge), ₱1,999 holds 11 (stop). Result:

| Section | Games |
|---|---|
| ₱499 | 3 |
| ₱799 | 6 |
| ₱999 | 12 |
| ₱1,499 | 5 |
| ₱1,999 | 11 |
| ₱2,499 and up | 2 |

The rule is deterministic and derives from the data at render time, so it stays
correct as stock changes rather than encoding today's numbers. It merges only at the
top end, where the catalog's long tail is; a thin group at the low end keeps its own
section.

Degenerate cases behave sensibly: a catalog with one price point renders one
section, and a catalog where every point is thin merges into a single `₱X and up`.

### 3. Section headers

Mirror the existing `/browse` category-section pattern — the price as the heading,
with a count pill beside it (`12 games`). Same visual family, no new pattern to
introduce.

### 4. Pending badge

Pending cards get a corner badge reading **"Set up on order"** — the exact copy
already used on the detail page's per-row pill — in the `#f0a500` amber of the
existing `.gd-notstocked-*` family.

It uses the established `.gc2-badge` geometry at `left: 9px`. That position is free:
`/buy`'s cards currently render no badges at all.

`/buy`'s card markup is inlined in `views/buy.ejs`, not the shared
`views/partials/game-card.ejs`. The new badge class is therefore scoped to `/buy`
and cannot affect browse, the homepage sliders, or PS Plus.

### 5. "Available today" filter

A toggle above the sections, off by default so the full catalog shows on load.

When on, it hides pending cards, hides any section left with no visible cards, and
rewrites each visible section's count pill to the filtered count so the numbers stay
truthful. Turning it off restores the original counts.

If the filter would leave no games visible at all — only reachable if every game in
the catalog is pending — the sections are replaced by a single line reading
"Everything is set up on order right now." rather than an empty page.

This delivers the separation on demand without permanently demoting the newest
titles.

## What deliberately does not change

- **The bundles section.** Four account bundles at the top, with their own tier and
  price treatment. A different product from single games, and too few to group.
- **The "Build your own" and "Don't see it?" placeholder cards** at the bottom.
- **Pricing, promo maths, or the buy order flow.** `/order/buy` is untouched.
- **The shared card partial.** No change to `views/partials/game-card.ejs`, so no
  other page is affected.
- **Rent-side grouping on `/browse`.** Untouched.

## Out of scope

- A buy-specific stock flag separate from the rent-side `stocked` signal. The
  existing signal is reused deliberately; if a game can ever be rentable but not
  sellable permanently, that is a separate change.
- Sorting controls beyond the price grouping (by name, by newest, by platform).
- Grouping or filtering the bundles section.
- Persisting the filter state across page loads or in the URL.
