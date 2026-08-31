# Queue Position for Fall in Line — Design

**Goal:** Show a customer waiting for a rented-out game how many people are ahead
of them and what number they are, and let them buy their way up the line without
losing the time they have already waited.

**Status:** approved 2026-08-31. Follows on from
`2026-08-31-noslot-fall-in-line-priority-design.md`, which built the Fall in Line
and Priority options this spec makes legible.

## Problem

A Fall in Line entry today is a black box. The customer submits their Facebook
name, lands on an order page that says "We'll message you the moment a slot opens
up," and has no idea whether that means tomorrow or next month, or whether the
₱100 Priority option would have been worth paying. The owner has the same problem
in reverse: the admin waitlist card sorts newest-first, the exact reverse of the
order people should be served in.

## What the customer sees

Three surfaces, one shared source of truth.

**Game page, no-slot card.** A single compact strip below the "No slots
available right now" banner:

    [icon]  4 in line for trophy                      View list
            Join now and you'll be #5

The strip is scoped to whichever account-type pill is selected and re-renders
client-side when the pill changes, the same way the rest of that card already
does. It renders only where the no-slot UI renders — both the per-type card and
the all-types-full card. With nobody waiting, the strip does not render at all.

**Popout.** "View list" opens a modal over the page showing the selected type's
queue only. Rows read `#3 · Carlo M. · Aug 28`, priority rows carry a star icon,
and the viewer's own row (when they have one) is highlighted and shows their full
unmasked name with "(you)". Footer: "Priority holders are served first." Closes
on the close button, on backdrop click, and on Escape.

**Their order page.** The headline becomes "You're #5 in line" with
"Trophy, monthly. We'll message you." beneath it, plus the same count strip and
popout, plus the upgrade card described below.

**Admin.** The waitlist card in `views/partials/order-queue.ejs` gains position
numbers and its sort flips from newest-first to queue order. This is what makes
the customer-facing numbers true — an owner serving from the top of today's list
serves the most recently joined person while the site tells that person they are
last.

## Queue rules

**Membership.** An order is in a game's queue when its `game_id` matches, it has
neither `upcoming_game_id` nor `is_buy` set (those are Coming Soon pre-orders,
which share the `reserved` state but are a different queue), and either:

- its state is `reserved` (paid Priority) or `waitlisted` (free Fall in Line), or
- it carries `upgraded_from_waitlist` and is mid-payment for the ₱100 upgrade
  (`awaiting_payment`, `verifying_payment` or `payment_rejected`).

A Priority order that has never been a waitlist entry and has not yet been paid
for is **not** in the queue. Unpaid money does not buy a place in line.

**Tiers and order.** `reserved` orders form the priority tier and sort first;
everything else forms the free tier. Within each tier, `created_at` ascending —
oldest first, so #1 is whoever has waited longest. `ref` breaks ties so the
ordering is deterministic.

**Scope.** Queues are per `account_type` (`nt`, `tr`, `ps4`). A Trophy slot
opening only helps Trophy waiters, so a combined count would overstate how many
people are genuinely ahead.

**PS Plus.** The PS Plus rent page renders the same `noslot-options` partial with
`game_id: 'psplus'` and creates waitlist entries through the same route, so it
gets the same count strip and popout with no special-casing. Its queue is keyed
on the literal id `'psplus'` and has only the `nt` and `tr` types.

**Expiry.** A free-tier entry whose `created_at` is more than **30 days** old
stops counting. This is a display filter only — nothing is deleted, and the admin
card still shows the row. 30 days is one full monthly rental cycle; an entry that
has outlasted one has almost certainly been abandoned. **Priority entries never
expire** — somebody paid for that place and must not be dropped silently.

**Name masking.** `"Michael Dela Cruz"` becomes `"Michael D."`. One-word names
are shown as-is. A blank or whitespace-only name falls back to `"Guest"`. A first
word longer than 14 characters is truncated with an ellipsis. Names are never
re-cased. The viewer's own row is exempt and shows the full stored name.

**Self-identification.** Orders already store `session_id`. A row whose
`session_id` matches the current request's is the viewer's own — no login needed.
On the order page the match is by `ref` instead, which is stronger.

## Upgrading to Priority

An "Upgrade to priority — ₱100" card on the customer's own order page, shown only
while their order is `waitlisted` and unexpired. Sub-line: "Moves you to #3.
Deducted from your rent." — the target position is computed live, not hardcoded.

`POST /order/:ref/upgrade-priority` validates `url_key` the way every other
per-order route does, rate-limits like `/order/create`, requires state
`waitlisted`, and rejects expired entries (those get "message us to rejoin"
instead of an upgrade button). It then patches the order to
`amount_due: 100`, `is_reservation: true`, `is_waitlist: false`,
`upgraded_from_waitlist: true`, recomputes `remaining_due` from **current**
prices and promo minus the ₱100, and transitions `waitlisted` to
`awaiting_payment`.

Everything after that is existing machinery. The order page's payment step
renders because the state is `awaiting_payment`; the customer sends proof through
the flow they would have used anyway; and `server.js:2144` already routes any
`is_reservation` order from `verifying_payment` into `reserved` on approval, so
the admin side needs no change at all.

Two consequences worth stating plainly:

- **They keep their `created_at`**, so once the ₱100 clears they are ranked among
  priority holders by when they first fell in line — a customer waiting since
  Aug 24 lands above a priority holder who joined Aug 30.
- **They never drop out of the queue while paying.** The `upgraded_from_waitlist`
  membership clause holds them at their original free-tier position until the
  payment is confirmed; they only move up, never off.

If the payment is rejected or abandoned they simply stay where they were. There
is deliberately no "cancel upgrade" path back to `waitlisted` — the owner can
already cancel a stuck entry, and the customer's visible position is unchanged
either way.

## Architecture

`/game/:slug` is currently a synchronous handler with no database read. It
becomes `async` and performs one query for the game's queue-eligible orders,
which is passed to the view as `queues: { nt, tr, ps4 }` with rows already
ordered and masked server-side. The type-pill swap stays pure client-side JS,
reading an embedded constant exactly as the existing `AVAIL` and `ALL_UNAVAIL`
constants do.

Rejected: a public `GET /api/queue/:gameId` endpoint. It would keep the route
synchronous but adds an enumerable endpoint that dumps queue data for every game
in the catalogue, plus a round trip and a loading state, for no gain.

**`lib/queue.js`** holds every rule above as pure functions over plain order
objects — no database access, no Express, so it is testable with plain asserts:

- `QUEUE_EXPIRY_DAYS` — 30
- `inQueue(order, now)` — the membership clause
- `maskName(raw)` — the masking rule
- `buildQueue(orders, now)` — returns `{ nt, tr, ps4 }`, each an ordered array of
  `{ ref, position, tier, name, joinedAt, sessionId }`
- `positionOf(queue, ref)` — a number, or `null` when absent

`lib/orders.js` gains one query helper for fetching a game's queue-eligible
orders and one new allowed transition, `waitlisted` to `awaiting_payment`.

## Failure modes

- **No database.** `listByStates` already returns `[]` when Mongo is absent. The
  count strip and popout do not render; the existing Fall in Line and Priority
  card is untouched. No error page.
- **Empty queue.** Nothing renders — the customer is simply first.
- **Expired own entry.** Their order page replaces the position with "Your spot
  has been waiting over 30 days — message us to confirm you still want it," and
  hides the upgrade button.
- **Blank or hostile `fb_name`.** Falls back to `Guest`; EJS escapes on output as
  everywhere else in this project.

## Testing

`scripts/test-queue.js`, plain asserts, matching this project's no-framework
convention: tier ordering, oldest-first within a tier, the 30-day cutoff applying
to free entries but never to priority ones, pre-orders excluded, unpaid
non-upgrade priority excluded, pending upgrades held at their free position,
masking edge cases, and `positionOf` returning `null` for an absent ref.

`scripts/test-orders.js` is **already failing on main** — it asserts `STATES` has
eight entries, but `reserved` and `waitlisted` were added later and the test was
never updated. Unrelated to this feature; fixed here because this work adds
assertions to the same file.

## Out of scope

- Notifying the queue automatically when a slot opens. The owner still messages
  people by hand, exactly as today.
- Auto-serving or auto-promoting the top of the queue.
- Any queue for Coming Soon pre-orders, which keep their separate Messenger-only
  waitlist card.
- Deleting or archiving expired entries. Expiry is presentation only.
