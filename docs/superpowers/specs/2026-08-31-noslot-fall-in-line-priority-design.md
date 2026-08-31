# No-slot options: Fall in Line + Priority — Design

## Problem

When a rental type has no open slot, the rent page (`game-detail.ejs`), PS Plus
page (`psplus-rent.ejs`), and Coming Soon page each show a "CHOOSE YOUR
OPTION" block. It has its own Facebook name field, a purple Priority
Reservation card (₱100 fee, posts to `/order/reserve`, creates a real order),
and a small "Not ready to pay? Join the free waitlist" text link buried below
a divider. The waitlist link is Messenger-only — nothing is recorded
server-side, so the owner cannot see who's waiting except by scrolling chat.

This block is copy-pasted four times (twice in `game-detail.ejs` — per-type
and all-types-full — and twice in `psplus-rent.ejs`), byte-for-byte
identical.

## Scope

- `views/game-detail.ejs` — both no-slot blocks
- `views/psplus-rent.ejs` — both no-slot blocks
- New shared partial: `views/partials/noslot-options.ejs`
- `server.js` — `/order/reserve` gains a `kind=queue` branch
- `lib/orders.js` — new `waitlisted` state
- `views/order-status.ejs` — a `waitlisted` step + suppressing the ₱0 payment
  card rows
- `views/admin.ejs` / `views/partials/order-queue.ejs` — a new "Waiting for a
  slot" list, modeled on the existing "Started but didn't pay" list
- Coming Soon (`upcoming-detail.ejs`) is explicitly **out of scope** — its
  waitlist card stays a Messenger link, unchanged. That page has no
  "no slot" concept in the same sense (nothing has released yet), and folding
  it in was flagged as the widest option and not selected.

## UI

Replace the "This type has no slot right now" block's second half with:

```
[ ⭐ Priority        ] [ 👥 Fall in line   ]
[ ₱100 · skip line   ] [ Free · get notified]
   (selected by default)

<one line of copy that swaps with the selection>

[ Your Facebook name                        ]
[         Reserve now — ₱100 →              ]   <- label/price follow selection
or message us on Facebook instead
```

Selecting a card toggles a hidden `kind` field between `''` (Priority, same
as today) and `queue` (Fall in Line), swaps the explanation line and the
button's label. One name field, one button, one submit path
(`POST /order/reserve`) for both. Duration selection is still required for
both options (unchanged from today) — it tells the owner what the person
actually wants, and reuses the existing validation path.

## Data model

`lib/orders.js`: add `'waitlisted'` to `STATES`, with `ALLOWED.waitlisted =
['cancelled']` (owner can drop an entry; nothing else transitions out of it
automatically — the owner manually starts a fresh order when a slot opens
for that person, same as they do today from a Messenger DM).

`waitlisted` is **not** added to `OWNER_STATES` (it has no completing
action), **not** added to `PAID_EXCLUDED_STATES` changes (it's already
excluded — `isPaid()` returns false for anything not explicitly paid, and
₱0 due means nothing to reconcile either way), and **is** excluded from the
two funnel/ledger sources explicitly:

- `allRecentOrders` (feeds started/completed/abandoned/start-rate) — filter
  out `state === 'waitlisted'`
- `ledgerOrders` (feeds the ledger table and its stat tiles) — same filter

## `/order/reserve` route

`kind` already distinguishes `buy` from ordinary reservations. Add a third
value, `queue`:

```
kind === 'buy'   -> isBuyPreorder (existing)
kind === 'queue' -> isWaitlist (new)
kind === ''      -> ordinary Priority reservation (existing, unchanged)
```

For `isWaitlist`:
- `amount_due = 0`, `deposit_due = 0`
- `remaining_due` = full rent total (base + any trophy deposit) — nothing
  collected now, everything due once a slot actually opens and the owner
  starts the real order
- order created with `state: 'waitlisted'` (overriding `create()`'s
  `awaiting_payment` default) and `is_waitlist: true`
- `is_reservation` stays `false` — a waitlist entry is not a reservation, it
  has no downpayment

Priority path is unchanged: `kind === ''`, `is_reservation: true`,
`amount_due: 100`, same as the current code.

## Order status page

`STEP_COPY` gains a `waitlisted` entry:
```
{ title: "You're on the list! 👥",
  sub: "We'll message you the moment a slot opens up." }
```
The payment-instructions block stays gated on
`awaiting_payment`/`payment_rejected`, so it never renders for a waitlisted
order without extra guarding. The order summary card's deposit/refund/
remaining-balance rows are conditioned on their existing `> 0` checks, except
the "To send now ₱<%= totalDue %>" line, which always renders — add
`<% if (!order.is_waitlist) { %>` around it so a free entry doesn't show
"To send now ₱0".

## Admin — waiting list

A new list on the admin orders view, directly under "⚠ Started but didn't
pay", same shape: name, game, type/duration, a Messenger link, and a
"Remove" action that transitions the order to `cancelled`. Sourced from
`orders.listByStates(['waitlisted'])`. Not merged into `orderQueue` (built
from `OWNER_STATES`, which are states with a completing action — a waitlist
entry has none, so it would never leave that list on its own).

## Non-goals

- The ₱100 Priority fee stays hardcoded, per the earlier decision.
- No new admin setting, no change to the reservation flow's pricing math.
- Coming Soon's separate Fall in Line card is untouched.
