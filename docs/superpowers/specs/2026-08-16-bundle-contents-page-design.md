# Bundle Contents Page — Design

**Date:** 2026-08-16
**Status:** Approved

## The problem

The `/buy` bundle cards show only 4 cover thumbnails and a "+N" for the rest. A customer can't see what's actually included before buying a permanent slot on a shared account — and there's no way to send someone a link to a specific bundle over Messenger, which is how sales actually happen on this site.

## What changes

### New route: `GET /bundle/:slug`

`:slug` is `gameSlug(public_name || label)` — the same slugging function already used for games (`server.js:1156`). Only accounts where `for_sale === true` resolve; everything else (not for sale, or no matching slug) returns 404. This keeps the URL from becoming a way to browse non-public inventory.

If two `for_sale` accounts happen to slug to the same value, the route resolves the first match in account order. Not solved in code — the admin is expected to keep public names distinct, same as it already should keep game titles distinct for the existing per-game slugs.

**Page contents:**
- Breadcrumb: `Buy › <bundle name>`
- Bundle name (`public_name || label`), same fallback the `/buy` card already uses
- Game count and the per-game/savings line (see below)
- Full cover grid — every included game, cover + title, no thumbnail cap
- The same tier picker + name field + Buy button + `/order/buy` form used on the `/buy` card today, unchanged
- "Copy link" button that copies the page's own URL to the clipboard, for pasting into Messenger
- Sold-out state: tiers show Rented/Sold same as `/buy`; if no tier is open, the buy form is replaced by the same "Both tiers taken right now" / "Not available right now" footer already on the card

### Self-referential game entries

Some accounts (e.g. "PS HUB Main Account") have a catalog game entry with the same title as the account itself, and that game is linked in `game_ids`. Any linked game whose title case-insensitively equals the account's `public_name` or `label` is excluded from: the displayed list, the game count, and the price-total math. No catalog changes — this is filtered at render time in the `/bundle/:slug` route, using the same filter for the count/list that `/buy`'s card-building code will also need (see below).

This same exclusion applies to the `gameCount` and cover thumbnails already shown on the `/buy` card, since right now a self-referential entry inflates that count too. `/buy`'s existing bundle-building code in `server.js` gets the same filter applied.

### Price-savings block

Shown only when **every** non-self-referential game on the account has a buy price (`buy_nt_price > 0 || buy_tr_price > 0`) **and** the sum of those prices exceeds the bundle's own price for the tier being compared. Per game, the price used is `buy_nt_price > 0 ? buy_nt_price : buy_tr_price` — the exact same selection the `/buy` single-game cards already use (`server.js:1089`), so the "separately" total is the same number a customer would see if they priced each game individually on `/buy` today. When shown, it reads:

> ₱\<sum\> if bought separately — save ₱\<sum - bundle price\>

using the Non-Trophy bundle price as the comparison baseline (if only Trophy is enabled, use that instead). If either condition fails — any game unpriced, or the sum doesn't beat the bundle price — the block doesn't render, and the existing "from ₱X per game" line (already shipped on `/buy`) is shown instead. No partial-sum display, no explicit "some prices missing" messaging — it silently degrades to the current copy.

This means the block requires zero code changes to "turn on" for a given bundle — it starts showing itself once an admin finishes pricing that account's games in the existing admin/games UI.

### Linking from `/buy`

The bundle card's name and cover grid become a link to `/bundle/:slug`. The tier picker, name field, and Buy button stay exactly where they are and keep working in place — only the top portion of the card (name + covers) is wrapped in an `<a>`, kept outside the existing `<form>` so the form's validity isn't affected. This preserves one-click buying from the `/buy` grid; the bundle page is for browsing depth, not a required detour.

### What doesn't change

- `/order/buy` and the order lifecycle — the bundle page's buy form posts to the same route with the same fields.
- Games are not individually clickable on the bundle page (per the approved question round) — covers and titles only, no link to `/game/<slug>`, to avoid routing a bundle buyer into a cheaper single-game rent flow.
- No search/filter within the bundle page.
- No changes to how single games (non-bundle) are displayed on `/buy`.

## Out of scope

- Deduplicating `public_name` across accounts (admin discipline, not code).
- A written policy on how much account content to expose publicly — this feature is a product decision to expose more than today; no additional gating beyond `for_sale` is being added.
