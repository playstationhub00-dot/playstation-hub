# Orders: one "By game" board for Waitlist and Follow-ups — Design

Date: 2026-10-24 · Status: approved by owner (visual proposal B approved); amended after the plan's dry run (2026-10-24)

## Problem

Admin → Orders → Needs you lists **Follow-ups** (orders started but not paid, 52 on
the owner's screen) and **Waitlist** (free and ⭐ priority entries, 16) as two flat
lists that mix every game and account type. When a slot opens for one game and type,
the owner has to scan both lists to find the people for it.

## Decisions made with the owner

- **Layout B:** Follow-ups and Waitlist merge into one **"By game"** board with one
  card per game + account type. Each card holds that slot's waiting people and its
  started-but-unpaid orders.
- **Order:** cards whose game + type has a free slot right now come first, tagged
  **🟢 N slot(s) free**. Then the rest, most people first.
- **Folding:** every card is one line until tapped; cards with a free slot start open.
  The page remembers which cards the owner opened or closed.

## The board

- Replaces the Follow-ups and Waitlist groups in
  `views/partials/admin/orders/needs-you.ejs`, in the same place (after Refunds owed).
  **Do now**, **Just released** and **Refunds owed** are unchanged above it.
- Heading: `By game` with the total count, then a quiet line:
  `<W> waiting · <F> didn't pay` followed by the existing weekly funnel line
  (`14 of 36 started this week · 3.3% of game views`) when there is one.
- The board itself is a collapsible group like the others (`data-oq-group="bygame"`),
  starting open.
- Nothing to show (no waitlist, no follow-ups): the board is not rendered, as empty
  groups are today.

## Cards

- One card per **game_id + account_type**:
  - released game (`game_id` is the game's number),
  - PS Plus (`game_id` `psplus`),
  - Coming Soon (`upcoming_<id>`),
  - box set (`bundle_<id>`).
- **Card line:** game title, a type tag (`Trophy` amber, `Non-Trophy` purple,
  `PS4 Primary` grey), the slot tag when there is one, and on the right
  `<w> waiting · <f> didn't pay` (a zero part is left out). A Coming Soon card adds
  `Coming Soon`; a box-set card adds `Box set`.
- **Inside a card:**
  - **Waiting · <w>**: the current Waitlist rows, unchanged — position, ref, name,
    age, meta line, 📋 Copy, ✅ Slot given, ⭐ Priority paid (free rows), ⋯ (Edit name,
    Undo priority / Remove). Ordered as now: ⭐ priority first, then oldest first.
  - **Started, didn't pay · <f>**: the current Follow-up rows, unchanged — ref,
    reminder badge, name, age, meta (duration or One-time purchase, total, payment
    rejected, open chat), 📋 Copy, ✅ Mark paid, ⋯ (Payment link, Cancel, Delete).
    Newest first, as now.
  - A section with no rows is left out.
- The game title and type move to the card line, so a row's meta line drops them
  (it keeps duration, tier/total and the rest).

## Slot check ("🟢 N slot(s) free")

- **Released game:** `computeAvailability(game, accountSummary, legacyDays)` — the
  same numbers the game page shows — `ntSlots` / `trSlots` / `ps4Slots` for the
  card's type. Free when above 0.
- **PS Plus:** `getPsplusSlots()` `nt_slots` / `tr_slots` / `ps4_slots`.
- **Coming Soon and box sets:** no slot tag (a Coming Soon game is not out; a box-set
  slot is sold, not rented).
- A game that no longer exists: no tag; the card still shows, titled from the orders.
- Tag text: `🟢 1 slot free` / `🟢 2 slots free`.

## Card order and folding

1. Cards with a free slot, most people first.
2. Then the rest, most people first (waiting + didn't pay).
3. Ties: game title A→Z, then Trophy, Non-Trophy, PS4 Primary.

A card is a `<details>` that starts open when it has a free slot, folded otherwise.
`public/js/admin-orders.js` remembers each card's open/closed state in
`localStorage['oqCards']` under its `game_id|type` key (keys must match
`^[A-Za-z0-9_]{1,40}|(tr|nt|ps4)$`, values booleans, at most 300 kept). The group
memory (`oqGroups`) swaps its `followups` and `waitlist` keys for `bygame`; old saved
values for those two are dropped. A remembered state wins over the default. Storage
blocked: defaults apply.

Rows keep a coloured left edge so the two kinds read apart inside a card: grey for
waiting (`.oq-row-wait`), amber for didn't pay (`.oq-row-follow`), as the two old
groups had. On a phone (600px and narrower) the card's counts drop onto their own line
under the title and tags.

## Structure

- New pure helper `lib/needs-you-board.js`: `buildBoard({ waitlist, followUps,
  slotsFree })` → sorted cards `{ key, gameId, type, title, kind, slotsFree, waiting,
  followUps }`, and `kindOf(gameId)`. `kind` is `game`, `psplus`, `upcoming` or
  `bundle`. A missing or unknown type counts as Non-Trophy; a missing title is
  `Unknown game`. No Express, no database — unit-testable.
- `server.js`'s `/admin` route (the only one that renders the Orders tab) computes
  `slotsFree` (`{ '<game_id>|<type>': n }`) for the games that appear in the waitlist
  and follow-ups, calls `buildBoard`, and passes the cards to the view as
  `orderBoard`. The view only renders.
- `needs-you.ejs` renders the board from the cards; row markup is the existing row
  markup minus the game/type in the meta line.

## Unchanged

Every button, route, form, confirm prompt and copied message (the Copy messages
still name the game and type). Headline count (Do now + Refunds). Queue positions
(`queuePosition` from `queueRules.forAdminPanel`). The notification bell.

## Testing

Throwaway data only (fixtures, temp `DATA_DIR`, blank `MONGODB_URI`, in-memory
sessions, a made-up password); never the real orders or database.

- `buildBoard` unit tests: grouping by game + type across the four kinds; waiting
  ordered priority-then-oldest; follow-ups newest first; free-slot cards first; then
  most people; tie order; counts; empty sections; a missing game.
- Test files: `scripts/test-needs-you-board.js` (the helper),
  `scripts/test-orders-by-game.js` (the real `/admin` route with an in-memory order
  store), `scripts/test-admin-orders-filter.js` (card and group memory), and
  `scripts/test-orders-template.js` (markup).
- Template tests (`scripts/test-orders-template.js`): the board replaces the two
  groups; card lines, tags and counts; free-slot cards open, others folded; every
  existing POST form and confirm prompt still present; rare actions still behind ⋯.
- Slot check: a released game with a free slot gets the tag; a full one doesn't;
  PS Plus uses its slot counts; Coming Soon and box sets never do.
- Browser check on a throwaway instance at 1280px and 375px.
- Full suite green except the known `scripts/test-upcoming-psn-page-public.js`.

## Out of scope

- Changing what counts as a follow-up or a waitlist entry.
- Messaging everyone in a card at once.
- Changing the ledger (All orders) below.

## Rollout

Direct on `main`, pushed when the owner says push.
