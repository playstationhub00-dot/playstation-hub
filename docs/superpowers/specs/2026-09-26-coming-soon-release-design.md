# Coming Soon Release — Design

**Date:** 2026-09-26
**Status:** Approved in brainstorming, pending spec review
**Part of:** the admin Games tab overhaul, split into three jobs:
1. Games list layout
2. **This one** — releasing a Coming Soon game
3. Game Requests

This one goes first because it is the only part that can strand customers who have already paid.

## Problem

🚀 **Release** (`POST /admin/upcoming/release/:id`, `server.js`) currently does three things:
- copies the Coming Soon game into a brand-new `games` record with a new id;
- deletes the `upcoming` record;
- redirects.

It does nothing about the people who reserved or pre-ordered the game.

1. **Paid reservations and pre-orders are stranded.** A confirmed reservation has two records:
   - an **order** (MongoDB) in state `reserved`, with `upcoming_game_id` set to the Coming Soon id and `game_id` also set to that id;
   - a **customer record** (lowdb), status `reservation`, `game_id: 'upcoming_<id>'`.

   After release, both still point at a deleted game. Nothing moves them on:
   - the order state machine allows `reserved → waitlisted` only;
   - its own comment says the owner "converts it to a real rental manually once the game releases", but no screen or button for that exists.
2. **Unpaid reservations stay reservations.** An order still in `awaiting_payment`, `verifying_payment` or `payment_rejected` carries `is_reservation` and `upcoming_game_id`. Confirming its payment later sends it to `reserved`, creating a "reservation" for a game that is already out.
3. **Signing in a released reservation would not finish it.** The advance route only builds a customer record at `active` when the order has no `customer_id`. A reservation already has one, so its customer record would stay `status: 'reservation'` forever, and the rental would never count against the game's slots.
4. **The Trophy switch is off on every released game.** The copy never sets `trophy_account`. Every game has both Trophy and Non-Trophy accounts, so a released game wrongly shows Trophy slots as "(off)" and hides its Trophy prices.
5. **Old links dead-end.** `/upcoming/<slug>-<id>` redirects to `/browse` once the Coming Soon record is gone. That affects reservation order pages, shares, and the request board.
6. **Launch day is invisible.** Nothing tells the owner who has to be contacted when a game comes out.

Also worth knowing: Coming Soon ids come from their own counter (`newUpcomingId`), separate from game ids (`newId`). A reservation order's `game_id` holds a Coming Soon id, which can equal an unrelated real game's id. This design re-points every released reservation's `game_id` to the new real game, so released orders stop carrying a colliding id. Unreleased reservations are unchanged.

## Goals

- Releasing a game moves every paid reservation and pre-order into the normal "paid, waiting for their sign-in code" step for the new game, with its customer record re-pointed.
- Unpaid reservations become ordinary orders for the new game.
- Signing in a released reservation turns its existing customer record into a live rental or purchase, with no duplicate record and no second payment.
- A released game always has Trophy switched on.
- Old Coming Soon links redirect to the released game.
- The owner can see and message everyone a release moved.
- Release refuses to run when the order database is unreachable, rather than half-completing.

## Non-goals

- **No automatic release on the release date.** The owner must set up an account first, so release stays a button.
- **No PS4 Primary on Coming Soon games.** A released game starts with PS4 Primary off, and the owner switches it on in Edit for games that have one.
- **No undo for a release.**
- **No change to unreleased reservations**, the reserve/pre-order checkout, or pricing.
- **No automatic account-slot assignment.** The owner assigns a slot at sign-in, exactly as for any web rental today.
- **The rest of the Games tab redesign** (list layout, filters, removing the Trophy on/off switch from the game form) is job 1. This spec touches the Coming Soon rows only to add the reservation count and the "ready to release" nudge.

## Design

### Release, step by step

`POST /admin/upcoming/release/:id` becomes an `asyncRoute` that does the following.

1. **Guard.**
   - If the Coming Soon game doesn't exist, redirect to `/admin?tab=games`.
   - If `await _getMongoDb()` is null (orders unreachable), redirect to `/admin?tab=games&msg=release_failed` **without writing anything**.
2. **Find its orders.** Take every order in `awaiting_payment`, `verifying_payment`, `payment_rejected` or `reserved` whose `upcoming_game_id` equals this Coming Soon id. Compare as numbers, because Quick Add stores it numeric and older orders may carry it as a string.
3. **Create the game** from the Coming Soon record (see *The released game record*).
4. **Move paid ones.** Each `reserved` order transitions to `awaiting_qr`, with patch `{ game_id: <new id>, released_at: <ISO now> }`. `upcoming_game_id` is kept as history.
5. **Convert unpaid ones.** Each pre-payment order gets a new orders-store function, `releaseUnpaidReservation(ref, newGameId)`, which sets:
   - `game_id: <new id>`
   - `is_reservation: false`
   - `upcoming_game_id: null`
   - `release_date: ''`

   The update is pinned to the order still being in one of the three pre-payment states. It becomes an ordinary rental or buy order. Its `amount_due`/`deposit_due` stay as quoted.
6. **Re-point customer records.** Every customer with `game_id === 'upcoming_<id>'` gets `game_id: <new id>` (numeric). Status is left as `reservation`. This covers reservations with an order, and older Messenger ones entered by hand without an order.
7. **Delete the Coming Soon record.**
8. **Redirect.**
   - `/admin?tab=orders&msg=game_released` normally.
   - `&msg=release_partial` if any order in step 4 or 5 could not be updated (a concurrent state change made its pinned update match nothing). The failing refs are logged with `console.error('[release] …')`.

Steps 3–8 run only after the guard passes. If step 3's write throws, nothing else has happened. The decision logic lives in a new pure module (see Architecture), and the route only wires real stores to it.

### The released game record

It copies every field a Coming Soon game has:
- `title`, `platform`, `genre`, `description`
- `cover_image`, `gallery`
- `nt_price_7d`, `nt_price_30d`, `tr_price_7d`, `tr_price_30d`
- `buy_nt_price`, `buy_tr_price`
- `non_trophy_slots`, `trophy_slots`
- `release_date` (`''` when `'TBA'`, as today)

And sets:

| Field | Value |
|---|---|
| `id` | `newId()` |
| `trophy_account` | **`true`**, always |
| `ps4_primary_slots` | `0` |
| `featured` | `false` |
| `renters` | `0` |
| `created_at` | now (ISO) |
| `released_from_upcoming_id` | the Coming Soon id |

`rank` is not copied; it only orders the Coming Soon list.

### State machine

`lib/orders.js` `ALLOWED.reserved` becomes `['waitlisted', 'awaiting_qr']`. Its comment says the new edge exists for the release route only, and that it is safe there because release selects orders by `upcoming_game_id`. Available-game priority reservations (`upcoming_game_id` null) also rest in `reserved` and are never selected.

### Signing in a released reservation

In `POST /admin/orders/:ref/advance`, one new branch runs when **all** of these hold:
- `to === 'active'`
- the order has a `customer_id`
- the order has `released_at`

The branch updates that existing customer record:
- `status`: `'bought'` if `order.is_buy`, else `'renting'`
- `game_id`: the order's (new, numeric) `game_id`
- `days`: `order.days` (`null` for a pre-order)
- `start_date` / `end_date`: from the patch the route already computes (end `''` for a pre-order)

`payments` are left untouched. The reservation payment was recorded when it was confirmed, so no second payment is added.

For a rental (not `is_buy`), the branch applies the same game counter changes the normal rental branch applies: `available_slots − 1`, `renters + 1`, and the per-type slot decrement. A pre-order gets no counter changes, matching today's purchase branch.

The existing branches keep their `!order.customer_id` guard, so they still skip this order and no second customer record is created.

### Old links

`GET /upcoming/:slug`: when no Coming Soon game matches, look for a game whose `released_from_upcoming_id` equals the id at the end of the slug. If one exists, `301` to `/game/<its slug>`. Otherwise, redirect to `/browse` as today.

### Launch day in the admin

**Coming Soon rows** (`views/partials/admin/games.ejs`, the Coming Soon table only):
- Under the title, `N reserved` when the game has any customer records with `status: 'reservation'` and `game_id: 'upcoming_<id>'`. The server passes a map of counts.
- `📅 Out since <date> — ready to release` when `release_date` is a real date on or before today (Manila).
- The release confirm prompt reads `Release '<title>' to Available Games? N paid reservation(s) will move to sign-in.`, or the current wording when N is 0.

**Needs You → 🚀 Just released** (new group in `views/partials/admin/orders/needs-you.ejs`):
- **Source:** orders in `awaiting_qr` with `released_at` set, newest release first. They are passed as `releasedOrders`, each with a server-built `release_msg`.
- **Placement:** after **Do now**, before **Refunds owed**. The group key is `released`. It is **open by default**, and its open/closed state is remembered like the other groups (`GROUP_KEYS` in `public/js/admin-orders.js` gains `released`).
- **Count:** shown in its own heading; **not** added to the Needs You headline or the sidebar badge.
- **Row contents:**
  - ref
  - FB name
  - game
  - `Reserve · Weekly`/`Monthly`, or `Pre-order`
  - "released Xh ago" (`.oq-ab-age` on `released_at`)
  - a **📋 Copy message** button (`.rem-copy`, `data-msg="<release_msg>"`)
- **No ⋯ menu.** Delete and Cancel for these orders remain available from the ledger.
- A row leaves the group on its own when the customer sends their code (`awaiting_qr → qr_pending`). From then on they appear in **Do now** as a normal sign-in.

The message template:

```
🎮 <game title> is out! Your reservation <ref> is ready.

Send your sign-in code here and we'll set you up: <SITE_URL>/order/<ref>?k=<url_key>
```

The Orders ledger needs no change. A moved order is now `awaiting_qr`, which it already shows as "Out on rent".

**Toasts** (`views/admin.ejs` message map):
- `release_failed` (Games tab): `❌ Could not reach the order database — nothing was released. Try again in a minute.`
- `release_partial` (Orders tab): `⚠ Released, but some reservations could not be moved — look for orders still marked Reserved in the ledger.`
- `game_released` keeps its current text. It now opens the Orders tab.

### Customer's order page

`views/order-status.ejs`:
- **The `awaiting_qr` heading.** When `order.released_at` is set, it reads **`It's out — time to sign in! 🎮`**, and the sub line reads *`<game title> has released. Send your sign-in code below and we'll set you up.`* The rest of the step is the normal sign-in step.
- **The `remaining_due` note** (rare: hand-arranged partial payments only). When `order.released_at` is set, it reads `₱X remaining, due before we sign you in.` instead of "due when <game> releases".

## Architecture

### `lib/release.js` (new)

Pure logic, plus one orchestrator with its stores injected. It follows the dependency-injection pattern of `scripts/test-session-store.js`.

- `releasedGameRecord(upcoming, newGameId, nowIso) → game object` (the table above).
- `partitionReleaseOrders(orders, upcomingId) → { move: order[], convert: order[] }`:
  - `move`: state `reserved` and a matching `upcoming_game_id`;
  - `convert`: a pre-payment state and a matching `upcoming_game_id`;
  - everything else is ignored.
- `releaseMessage({ gameTitle, ref, link }) → string` (the template above).
- `activatedReservationCustomer(customer, order, startDate, endDate) → customer`. This is the patched copy for the advance-route branch, and it never touches `payments`.
- `async releaseUpcoming({ upcoming, newGameId, now, orderStore, gameStore }) → { game, moved: ref[], converted: ref[], failed: ref[], customersRepointed: n }`, where:
  - `orderStore` = `{ listByStates, transition, releaseUnpaidReservation }`
  - `gameStore` = `{ addGame(game), repointUpcomingCustomers(upcomingId, newGameId) → n, removeUpcoming(id) }`

  It performs steps 2–7 in order and never throws for a single failed order.

### `lib/orders.js`

- `ALLOWED.reserved` gains `'awaiting_qr'`.
- New `releaseUnpaidReservation(ref, newGameId) → boolean`, pinned to the three pre-payment states. It is added to `module.exports`.

### `server.js`

- The release route wires lowdb and `lib/orders` into `releaseUpcoming` and redirects on its result.
- The advance route gains the released-reservation branch, using `activatedReservationCustomer`.
- `GET /upcoming/:slug` gains the released-game redirect.
- `GET /admin`:
  - passes `releasedOrders` (each with `release_msg`);
  - passes `upcomingReservedCount` (`{ [upcomingId]: n }`);
  - passes today's Manila date if the template needs it (`todayManila` already exists).

## Error handling

- **Order database unreachable:** checked before anything is written. `release_failed`, and nothing changes.
- **A single order can't be moved** (it raced a state change): the release continues for everyone else, the ref is logged, and the redirect is `release_partial`. The order keeps its `upcoming_game_id`, so it stays findable in the ledger as "Reserved".
- **The lowdb write for the new game throws:** `asyncRoute` hands it to the error middleware before any order is touched.
- **The advance-route branch finds no customer record** for `order.customer_id` (deleted by hand): the order still becomes `active` as today, and the branch logs and skips the customer update. It does not invent a new customer, which would double-count a paid reservation.

## Testing

- **`scripts/test-release.js` (new, unit + orchestration):**
  - `releasedGameRecord`: Trophy always on, PS4 0, `TBA` → `''`, `released_from_upcoming_id` set, every Coming Soon field copied.
  - `partitionReleaseOrders`:
    - reserved → move; each pre-payment state → convert;
    - other games' orders, priority reservations (null `upcoming_game_id`) and closed/active orders are ignored;
    - string and number ids both match.
  - `releaseMessage`: the exact text.
  - `activatedReservationCustomer`: `renting` vs `bought`, dates, `payments` untouched, input not mutated.
  - `releaseUpcoming` with in-memory fake stores:
    - moves and converts the right refs, re-points customers, removes the Coming Soon game, creates the game first;
    - a failing `transition` is reported in `failed` while the rest proceed.
- **`scripts/test-orders.js` (existing):** `canTransition('reserved','awaiting_qr')` is true; `canTransition('reserved','active')` is still false.
- **`scripts/test-orders-template.js` (existing):**
  - the Just released group renders its rows open by default with a Copy button;
  - it doesn't render when `releasedOrders` is empty or missing;
  - the headline count is unchanged by it.
- **`scripts/test-admin-orders-filter.js` (existing):** `normalizeGroups` accepts `released`.
- **Browser check** on fixture data, never production (a local static render, like the Orders redesign):
  - the Coming Soon row shows "N reserved" and the "ready to release" nudge;
  - the Just released group and its Copy message;
  - the order page's released heading.
- **The release route itself is not run against a real Mongo.** Its behaviour is covered by the `releaseUpcoming` orchestration test with injected stores.
