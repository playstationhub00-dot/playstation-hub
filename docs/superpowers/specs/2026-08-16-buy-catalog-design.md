# Buy Catalog (Phase 1) — Design

**Date:** 2026-08-16
**Status:** Approved

## The problem

Permanent purchases exist today (`buy_nt_price`/`buy_tr_price` on games, `price_permanent_nt`/`price_permanent_tr` on accounts) but have no public surface — buying is buried behind a mode toggle on the game-detail page, and every purchase is arranged manually over Messenger even though the site already has a full online order/payment/QR-signin flow for rentals. Buying is also operationally simpler than renting (no expiry, no return, no deposit refund), making it a good candidate for self-serve checkout.

This is Phase 1 of a three-phase plan. Phase 1 covers what the owner already owns: a public Buy catalog (account bundles + single games) with online checkout reusing the existing order machinery. Phase 2 (build-your-own bundle pricing) and Phase 3 (made-to-order purchases with a quote-then-pay flow) are out of scope here and will get their own specs.

## What changes

### Data model

Two new fields on the `accounts` collection (`lib` already has `getAccounts()`/`getAccount()`/`normalizeAccount()` — extend `normalizeAccount()` to default these on read, same pattern as the existing `slots`/`game_ids`/`email` defaults):

- `for_sale: boolean` (default `false`) — nothing is public until the owner explicitly opts an account in. New checkbox in the admin accounts add/edit form.
- `public_name: string` (default `''`) — the customer-facing bundle name, separate from the internal `label`. New text field in the same admin form. An account with `for_sale: true` but no `public_name` set falls back to `label` on the public page (so opting in never silently produces a blank card), but the admin form should nudge the owner to fill it in.

No changes to `games` (buy prices already exist), `orders` (see below — reuses the existing shape), or any other collection.

### The `/buy` page

New public route and view, linked from the main nav alongside Browse/PS Plus. Two sections, both computed live from existing data — no caching, no new admin list to maintain beyond the two account fields above:

**Bundles**: every account where `for_sale === true` AND at least one slot is both `enabled` and currently `open`. Card shows: `public_name` (falling back to `label`), the count of `game_ids`, cover-image thumbnails of the first several games on the account (capped, "+N" for the rest, same pattern the game-card redesign just established for overflow), and one row per slot type showing its price (`price_permanent_tr`/`price_permanent_nt`) and status — an `open` slot is buyable; a `rented` or `buyed` slot renders struck-through with its price still visible but the row disabled, so scarcity is visible rather than the whole account disappearing when one slot sells. `ps4_primary` slots are excluded from the public price row (Phase 1 only sells trophy/non-trophy permanent access, matching what `price_permanent_tr`/`price_permanent_nt` already price) but still count toward "at least one open slot" only if enabled and open themselves — actually: only trophy/non-trophy slots gate whether a bundle card appears at all, since those are the only sellable rows shown.

**Single games**: every game with `buy_nt_price > 0` or `buy_tr_price > 0`, rendered as a compact price-only card (cover + price, no slot detail — a single game isn't tied to a specific account until checkout), linking to that game's existing detail page buy panel (unchanged) rather than duplicating the type-selection UI on the Buy page itself.

Below both sections, two static cards (Messenger links, no new logic): "Build your own bundle" and "Don't see it? Request a game" — placeholders for Phases 2 and 3, so the page reads as complete now and gets upgraded in place later without a layout change.

### Checkout

New route `POST /order/buy`, parallel to the existing `/order/create` (rentals) and `/order/reserve` (reservations) — same file, same patterns, same `orders.create()` call. Key differences from a rental order:

- No `days` field — the order stores `days: null` (or omits it; `lib/orders.js`'s `create()` already just spreads whatever fields are passed, no schema enforcement to update).
- `is_buy: true` flag on the order (parallel to the existing `is_reservation`/`is_psplus` flags), used by `order-status.ejs` and the admin queue to show "Buy" framing instead of rental framing (no "Duration" row, no deposit language, total is just the one-time price).
- Two purchase paths, both landing at the same order shape:
  - **Bundle slot**: `account_id` + `slot_type` ('tr' or 'nt') in the request body. Price comes from that account's `price_permanent_tr`/`price_permanent_nt`. Server re-validates the slot is still `open` at order-creation time (race: two customers could load the page before either checks out) — if not, redirect back with an error rather than creating an order for an already-sold slot.
  - **Single game**: `game_id` + `account_type` ('nt' or 'tr'), same shape as today's Messenger buy flow, price from `buy_nt_price`/`buy_tr_price`. No specific account is chosen yet — the owner assigns one at activation, same as they do for rentals today.

Order lifecycle is otherwise unchanged: `awaiting_payment → verifying_payment → awaiting_qr → qr_pending → active`, reusing every existing route (`/order/:ref/payment-proof`, `/order/:ref/qr`, the admin `/admin/orders/:ref/advance`). At `active`:

- `end_date` stays empty (no duration to compute one from). The existing `advanceEndedRentals()` sweep filters on `end_date: { $lt: today, $ne: '' }`, so an empty `end_date` is already naturally excluded — a bought order rests at `active` indefinitely with no new sweep logic needed.
- The customer-creation branch (already present in the `active` advance handler) gets a new condition: `if (order.is_buy) customer.status = 'bought'` instead of `'renting'`, and for the bundle path, marks that specific account's slot `status: 'buyed'` (the admin UI already does this manually today via `/admin/accounts/:id/slot/:type` — same write, just triggered from the order-advance handler instead of a manual admin action).

### What's on the game-detail page

Unchanged. The existing Buy panel (mode toggle, `selectBuyType`, `buyCtaBtn`) still works exactly as today for a single game reached from its own page — Phase 1 does not touch it. The new `/buy` page's single-games section links there rather than reimplementing checkout twice; only the account-bundle path is genuinely new UI and new checkout logic.

## What deliberately does not change

- `games` collection buy-price fields — already correct, just newly surfaced.
- The account model's internal fields (`label`, `email`, `note`, `slots`) — `for_sale`/`public_name` are additive only.
- The game-detail page's existing Buy flow for single games.
- Anything about rentals, reservations, or PS Plus.

## Out of scope (later phases)

- **Phase 2 — Build your own bundle**: customer picks N games, a bundle-pricing rule is needed (the design conversation noted this likely isn't "sum of individual prices minus a discount" but "a slot's price scales with what's put on it," since one buyer occupies one account slot regardless of game count — that rule needs its own design pass).
- **Phase 3 — Made to order**: games the owner doesn't yet own. Needs a quote-then-pay flow (not pay-then-quote, to avoid partial-refund risk on games that turn out delisted/region-locked/mispriced) and a new order state representing "we're purchasing this on your behalf" before it can reach `awaiting_qr`.
- A written "permanent access" policy (what happens if a shared account is lost/banned/reset) — a business decision, not a code change, but should exist before Phase 1 goes live publicly since it's a promise with no end date.
