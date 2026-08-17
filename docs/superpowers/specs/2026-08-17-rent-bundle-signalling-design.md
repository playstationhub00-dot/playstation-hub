# Rent Bundle Signalling — Design

**Date:** 2026-08-17
**Status:** Approved

## The problem

`PS HUB Main Account` rents for ₱299/week and includes 12 games, while a single game like `007 First Light` rents for ₱349/week. The site currently shows no difference between them — the bundle account renders as an ordinary one-game card, so its customers can't see it's a materially better deal, and the detail page's description ("Call of duty black ops 6") is a leftover single-game description, not an account description.

Renting the account gets the customer all 12 games for the rental period (confirmed with the owner) — this is the strongest offer on the site and it's currently invisible.

## What changes

### Data model

Two new fields on the `games` collection, plain fields with no `normalizeGame()` pass (the codebase has none today — reads already assume defaults via `|| 0`/`|| ''`, and these two follow the same pattern):

- `is_bundle: boolean` (default `false`) — set only via admin edit.
- `bundle_account_id: number | null` (default `null`) — which account's `game_ids` this catalog entry represents.

No changes to the `accounts` collection. This reuses the existing `game_ids` on an account as the single source of truth for what's included — the same array the buy-catalog feature's bundle pages already read.

### Resolving a bundle

New helper in `server.js`, placed beside the existing `buildBundleGames`/`bundleSlotInfo`/`bundleSavings` helpers from the buy-catalog feature (reused here, not duplicated):

```js
function resolveBundleInfo(game) {
  if (!game.is_bundle || !game.bundle_account_id) return null;
  const acc = getAccount(game.bundle_account_id);
  if (!acc) return null;
  const allGames = getGames();
  const games = buildBundleGames(acc, allGames);
  return { account: acc, games, count: games.length };
}
```

Returns `null` whenever the flag is off, the linked account was deleted, or the id doesn't resolve — a stale link silently turns the bundle display off rather than erroring. Exposed as `app.locals.resolveBundleInfo` (same pattern as the existing `app.locals.gameAccountSummary`), so `game-card.ejs` and `game-detail.ejs` can call it directly without every route that renders a card needing to compute and pass it through.

### Admin: marking a game as a bundle

Added to `views/edit.ejs` only (not the inline add-game form on `admin.ejs`) — an owner adds the game normally first, then edits it once the account exists to link it. New fields:

- Checkbox: "This game represents an account bundle" (`is_bundle`).
- A `<select name="bundle_account_id">` listing every account (id + label), shown/enabled only when the checkbox is on — same show/hide pattern the form already uses for `trophy_account` → trophy slot fields.

`GET /admin/edit/:id` gains `accounts: getAccounts()` in its render call. `POST /admin/edit/:id` parses and assigns `is_bundle: is_bundle === 'on'` and `bundle_account_id: bundle_account_id ? parseInt(bundle_account_id) : null`.

### Catalog card (`views/partials/game-card.ejs`)

Calls `resolveBundleInfo(game)` (via the exposed `app.locals` function, same call style as the partial's existing `computeAvailability` and `gameAccountSummary` calls). When it returns non-null:

- The platform/genre line (`.gc2-plat`) is replaced with `Bundle · <%= gcBundle.count %> games`, styled with a new light-blue color (`.gc2-plat-bundle`) instead of the usual amber — the same slot every card has, so the differently-colored line is what catches the eye scanning a grid, without adding a new badge that competes with the existing "Last slot"/"Rented"/"New" corner badges.
- The price footer's `from ₱X` becomes `<%= gcBundle.count %> games from ₱X` — keeping the "from" qualifier since the account still has two tiers (Non-Trophy/Trophy) at different prices, matching the earlier lesson from the buy-page single-game cards (a bare price without "from" implies a flat rate that isn't the whole story).
- No change to the cover art, slot-count chips, corner badges, or CTA — those stay exactly as they render for any other game.

Nothing else on the card changes when `resolveBundleInfo` returns `null` (every non-bundle game, i.e. all of them today except this one).

### Game detail page (`views/game-detail.ejs`)

When `resolveBundleInfo(game)` is non-null, a "Games included" section is inserted between the existing description block and the Rent/Buy toggle — reusing the `.bundle-game-grid`/`.bundle-game-tile`/`.bundle-game-cover`/`.bundle-game-title` CSS classes already built for the `/bundle/:slug` page (no new grid CSS needed), so the same games-grid treatment is visually consistent between the buy-bundle page and the rent-bundle detail page.

Nothing about the existing price header, rent-type selector, duration picker, or order flow changes — this section is purely informational, inserted above them.

## What doesn't change

- The `accounts` collection and its existing `for_sale`/`public_name` fields (from the buy-catalog feature) — entirely unrelated flag, on a different collection, for a different surface (buying a slot vs. renting the account).
- `buildBundleGames`, `bundleSlotInfo`, `bundleSavings` — reused verbatim, not modified.
- The add-game admin form (`admin.ejs`) — bundle marking is edit-only.
- Order creation, `/order/create`, `/order/reserve`, or any part of the rental lifecycle — a bundle-flagged game rents through the exact same flow as any other game today; this feature only adds *display*.
- The existing single-game description field is not auto-rewritten by this feature — the owner is expected to update `PS HUB Main Account`'s description themselves via the admin form, now that it's editable with the bundle context visible.

## Out of scope

- Home-page featuring/promotion of bundle accounts (e.g. a dedicated "Best Value" section) — a separate, later decision once this ships and the owner sees it live.
- Any change to how a bundle account's *rental price* is computed — it already uses the account's own `nt_price_7d`/`nt_price_30d`/etc. fields exactly like every other game; this spec only changes what's displayed around that price.
