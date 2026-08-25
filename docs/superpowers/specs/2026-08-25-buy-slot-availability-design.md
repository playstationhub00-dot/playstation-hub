# Buy Slot Availability — Design

**Date:** 2026-08-25
**Status:** Approved

Stop offering Permanent Access on a single game whose account slot has already
been sold or taken offline.

## The problem

Rent availability derives from account slot state. `gameAccountSummary()`
(`server.js`) counts only slots with `status === 'open'` as available, so a
sold or offline slot correctly disappears from the rent side.

Buy availability derives from **price alone**, at every surface:

| Surface | Gate | Reads slot state? |
|---|---|---|
| `/buy` singles list (`server.js`) | `buy_nt_price > 0 \|\| buy_tr_price > 0` | no |
| Detail buy panel (`views/game-detail.ejs`) | `buyNt > 0 \|\| buyTr > 0` | no |
| `POST /order/buy`, single branch (`server.js`) | game + type + price | no |

The bundle branch of that same route does check, with a comment explaining
why — "Re-check availability at order time — the page a customer loaded may be
stale." The correct pattern already exists a few lines above the broken one.

Reproduced live: **Black Myth Wukong** shows "Sold Out" on its cover and "Full
Slot" on both rent types, while both Permanent Access cards remain purchasable
at ₱999 and ₱1499. **Marvel's Spider-Man 2** behaves the same at ₱799.

The `buyed` state is reachable today: `applyAccountAssignment()` sets it
whenever the owner marks a customer as `bought`, which is the documented path
for a Messenger-arranged sale.

## The rule

A buy type is offered when **any** of these holds for its slot type:

- The game has no linked account slot of that type at all — the "set up on
  order" case, where the account is created after the first sale. This
  behaviour is deliberate and must not regress.
- At least one enabled slot of that type is `open` or `rented`.

It is blocked when the game **has** linked slots of that type and every one of
them is `buyed`, `na`, or `maintenance`.

`rented` deliberately stays sellable: a rental ends on a known date, so
permanent access can still be sold and handed over afterward. Only a slot that
is genuinely gone — sold, unavailable, or under maintenance — removes the
offer.

Each buy type is judged independently: `buy_nt_price` against the `non_trophy`
slot, `buy_tr_price` against the `trophy` slot. A game whose non-trophy account
is sold while its trophy account is open keeps offering the trophy tier only.

## How it's built

**`sellable` joins the summary.** `gameAccountSummary()` and
`buildAccountSummaryMap()` gain a per-type `sellable` count: enabled slots whose
status is `open` or `rented`. The existing `available` and `total` counts and
every current reader of them are unchanged.

**One shared predicate.** `buyTypeSellable(summary, slotKey)` implements the
rule above once and is exposed through `app.locals`, the established way this
project shares helpers with EJS (`computeAvailability`, `gameAccountSummary`).
All three surfaces call it, so the rule cannot drift between them — which is
exactly how this bug arose.

**Server-side re-check.** The single-game branch of `POST /order/buy` calls the
same predicate and redirects to `/buy?order_error=sold` when it fails, matching
the bundle branch's existing behaviour. Hiding a card is presentation; the route
is what actually prevents the sale.

## Out of scope

- **Auto-marking a slot `buyed` when a web single-game sale completes.** The
  single-game order does not record `account_id`/`slot_type`, so
  `server.js`'s activation step cannot flip a slot the way a bundle sale does.
  That is a real second defect, but fixing it needs its own decision about what
  should happen when the only slot is currently `rented` — marking it `buyed`
  would overwrite the live renter. Tracked as follow-up work, not bundled here.
- No change to rent availability, to the bundle buy path, or to the "set up on
  order" behaviour.
- No change to how `buyed` is set today via the admin customer flow.

## Verification

Live on `https://playstation-hub.com` after deploy:

- Black Myth Wukong and Marvel's Spider-Man 2 still offer Permanent Access,
  because their slots are `rented` rather than sold — confirming the chosen
  policy did not over-block.
- A game with no linked account still offers Permanent Access ("set up on
  order" behaviour intact).
- Marking a slot `buyed` in the admin panel removes that tier from the game's
  buy panel and from `/buy`, while leaving the other tier offered if it is open.
- Posting to `/order/buy` for a blocked type redirects to `/buy?order_error=sold`
  instead of creating an order.
- No console errors.
