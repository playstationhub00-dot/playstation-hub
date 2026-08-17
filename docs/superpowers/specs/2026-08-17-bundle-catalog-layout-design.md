# Bundle vs. Contents Catalog Layout — Design

**Date:** 2026-08-17
**Status:** Approved

## The problem

The `/browse` Deluxe section currently lists 18 cards, but they are not 18 distinct products. One of them is `PS HUB Main Account` (a 12-game bundle) and roughly a dozen others are the individual games that live *on that same account*.

Confirmed with the owner: renting any of those individual games hands the customer **the same physical PS HUB account**, with all 12 games on it, at the same ₱299 tier. There is one account, not thirteen.

Two consequences follow:

1. **The layout is confusing.** A bundle card sits in the middle of its own contents as a visual peer, with nothing indicating the relationship.
2. **The single-game cards under-describe what they sell.** A customer renting "Tekken 8" believes they are getting one game; they actually receive an account with twelve. This is a pleasant surprise rather than a bait-and-switch, but it is unstated, and it means the site is failing to advertise its own strongest offer at the exact moment a customer is deciding.

Availability is already correct and needs no change — `gameAccountSummary()` aggregates slots per account, so occupying the PS HUB account already marks every game on it unavailable simultaneously.

## What changes

### 1. Bundles move to their own section on `/browse`

A new "Account bundles" section renders above the price-tier sections (Deluxe, Special, Regular, Other Games), mirroring the structure `/buy` already uses. Any game where `resolveBundleInfo(game)` is non-null is pulled out of its price-category group and rendered there instead.

The price-tier sections keep their existing grouping logic, headers, game counts, and "Price Starts at ₱X" lines — they simply no longer contain bundle cards, and their counts drop accordingly (Deluxe goes from 18 to 17).

The bundle section is omitted entirely when no bundles exist, so the page is unchanged for a catalog with no bundle-flagged games.

### 2. Contained games carry a disclosure marker

Any game that belongs to a bundle account gets a small marker on its catalog card reading **"Comes with 11 more"** (i.e. `bundleCount - 1`), linking through to the bundle's page.

The copy is deliberately not "also available in a bundle" — that would imply the bundle is a separate, more expensive upsell. It isn't: renting this card *is* renting the account. The marker states what the customer actually receives.

This applies wherever `partials/game-card.ejs` renders, so `/browse` and the homepage sliders both get it with no per-page work.

### 3. New resolver: which bundle contains this game

A new helper beside the existing `resolveBundleInfo`:

```js
function findBundleContaining(game) { ... }
```

Returns `{ bundleGame, count } | null` — the bundle's own catalog game (for the link target and slug) and its game count. It scans games flagged `is_bundle`, resolves each one's account, and returns the first whose `game_ids` include this game's id. Returns `null` for a game that is itself a bundle (a bundle never markets itself as contained in something).

Exposed via `app.locals` alongside `resolveBundleInfo`, so templates call it directly.

Cost is bounded: the scan short-circuits on the first bundle match, and only games actually flagged `is_bundle` trigger an account lookup — with one bundle in the catalog this is a single extra lookup per contained card.

## What deliberately does not change

- **Individual games stay rentable and stay listed.** They are real discovery entry points — someone searching "Tekken 8" finds it, and now learns it comes with eleven more. Hiding them was considered and rejected: it removes findable inventory to solve a presentation problem.
- **Availability computation.** `gameAccountSummary()` / `buildAccountSummaryMap()` already aggregate per account and already handle shared-account availability correctly.
- **Pricing.** No price field, tier, or promo logic changes. The contained games and the bundle already price identically because they are the same account.
- **The order flow.** `/order/create` and the rental lifecycle are untouched; this is display-only.
- **The bundle's own card and detail page** — the "Bundle · 12 games" plat line, "12 games from ₱299" price line, and collapsible games-included grid all stay exactly as they are.
- **Search.** Bundle-contents keyword search (nav + browse) already ships and is unaffected.

## Out of scope

- A dedicated bundles section on the homepage — `/browse` first; revisit once this is live.
- Any change to how the owner prices bundles versus single games.
- Deduplicating the underlying catalog data (i.e. deleting the individual game entries) — they are load-bearing for search, SEO, and per-game detail pages.
