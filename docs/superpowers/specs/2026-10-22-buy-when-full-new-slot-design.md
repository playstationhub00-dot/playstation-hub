# Buy permanently even when full — the owner adds a new slot — Design

Date: 2026-10-22 · Status: approved by owner (visual proposal approved)

## Problem

When every slot of a game's account type is taken, customers cannot buy that type
permanently:

- **Released game page** (`views/game-detail.ejs`, Buy Permanent tab): a full type's
  card is greyed out — "Full Slot · Every Trophy slot is currently rented out — none
  free to hand over" — and a type whose linked account was sold is hidden entirely.
  With every type full the tab says "Nothing to buy right now".
- **Buy shop** (`/buy`, `/buy/catalog`): a game drops off once no type can be sold
  (`buyShopData` keeps only `buyTypeSellable` types).
- **Checkout** (`POST /order/buy`, single game): refuses the order
  (`/buy?order_error=sold`, "That slot just sold").
- **Coming Soon page** (`views/upcoming-detail.ejs`): the Rent tab shows "Full Slot"
  and offers only a paid request or the waitlist; nothing points to Buy Permanent.

The owner can always buy the game on another account, so a full type is a sale
being turned away.

## Decisions made with the owner

- **Where:** released game pages, Coming Soon pages, and the Buy shop and catalog.
- **Which games:** every game with a permanent price for that type — automatic, no
  per-game switch.
- **Price and wait:** the usual permanent price (buy promo applies as now). The new
  slot is **"set up on order"**; the owner messages the customer when it is ready. No
  promised time.
- **Look:** the approved visual proposal (amber "🆕 New slot · set up on order" tag,
  gold "Own it instead" strip on the Coming Soon Rent tab, "New slot needed" flag in
  admin).

## The rule

For each account type a game sells permanently (Non-Trophy, Trophy):

- **Buyable** = the game has a permanent price above 0 for that type. (Trophy also
  needs the game to show Trophy at all, as now.)
- **In stock** = buyable and `buyTypeSellable(...)` says a slot can be handed over now
  (the existing rule, unchanged).
- **New slot** = buyable but not in stock — every slot of that type is rented out,
  sold, or offline. The customer can still buy it; the owner adds a slot.

Box sets (account bundles) are **not** included: they sell a specific account's slot,
so a taken bundle slot stays taken.

## 1 · Released game page — Buy Permanent tab

- A type that is a **new slot** is shown as a normal, selectable card (not greyed) with
  an amber pill **"🆕 New slot · set up on order"** and the line "Our Trophy slots are
  all taken — we'll add a brand-new one just for you." (Non-Trophy: "Our Non-Trophy
  slots are all taken — …").
- When the selected type is a new slot, a note shows under the cards: "🆕 **Set up on
  order:** we buy a fresh Trophy slot for this game after you pay, then message you on
  Facebook when it's ready. Same price, yours forever." The note hides for an in-stock
  type.
- Types whose linked account was sold, which are hidden today, now show as new-slot
  cards too.
- The "Nothing to buy right now" box is no longer reachable for a game with a
  permanent price (every priced type is buyable); it stays only for the case of no
  buyable type.
- The buy form, button and checkout flow are unchanged.

## 2 · Coming Soon page

- **Rent tab:** when the selected type shows "Full Slot" and the game has a permanent
  price for that type, a gold strip appears above the duration cards: "🔑 **Trophy is
  full?** Own it instead — we'll add a new Trophy slot for you. **Buy ₱X →**" (₱X = that
  type's permanent price after the buy promo). Tapping it switches to Buy Permanent with
  that type selected. The strip follows the selected type; the Full Slot pill, the paid
  request and the waitlist stay as they are.
- **Buy Permanent tab:** a type with no rent slots left gets the same amber pill, and
  when selected the note "🆕 Pre-order now. On release day we set up a fresh Trophy slot
  for you and message you." Pre-orders were already allowed when full; only the wording
  and the order flag are new.

## 3 · Buy shop and catalog

- A game is listed whenever it has a permanent price for any type (not only when a type
  can be sold now). `nt` / `tr` facts mean "has a permanent price for that type".
- **In stock** (green tag) when some type is in stock and the game has been stocked
  before; otherwise **Set up on order** (the amber tag the shop already uses). A game
  that is full everywhere therefore shows "Set up on order".
- The **Ready today** shelf/tab keeps holding "In stock" games only, so full games
  appear on the other shelves and tabs but not there.
- The card price is the cheapest permanent price among its buyable types, as now.

## 4 · Checkout

- `POST /order/buy` (single game) no longer refuses a type that cannot be sold now: it
  creates the order as usual, with **`new_slot: true`** on the order. In-stock orders
  are unchanged (no field, or `false`).
- `POST /order/reserve` with `kind=buy` (Coming Soon pre-order) sets `new_slot: true`
  when that type's Coming Soon slots (`resolveUpcomingSlots`) are 0 at order time.
- Bundle purchases (`POST /order/buy` for a box set) keep refusing a taken slot.
- The customer's order page shows, for a `new_slot` order: "🆕 We're adding a new
  Trophy slot for you — we'll message you on Facebook when it's ready."

## 5 · Admin

- **Orders tab:** a `new_slot` order's row shows the amber flag "🆕 New slot needed —
  add a Trophy account for Elden Ring" (type and game from the order).
- **Needs you now** (`lib/notifications.js`): a new item kind `new_slot` (icon 🆕,
  urgency warn) — "New slot to add" with "PH-… · name · game · Trophy" — for each
  `new_slot` order from the moment its payment is confirmed until it is activated or
  cancelled. Pre-orders (Coming Soon) show it once their game is released.
- Activation is unchanged: the owner adds the account in Accounts as they do today, then
  activates the order.

## Error handling

- A game with no permanent price for a type: that type stays hidden, as today.
- Stale page: the order route decides `new_slot` from live slot state at order time, so
  a slot freed (or taken) after the page loaded is handled correctly.
- Unchanged everywhere else: rentals, Fall in Line, bundles, PS Plus.

## Testing

Throwaway instance (temp `DATA_DIR`, blank `MONGODB_URI`, in-memory sessions, a made-up
admin password); never the project's `games.json` or a database. Orders are stubbed
where a route needs the order store.

- Unit: the buyable / in stock / new slot decision for each case (priced + free slot,
  priced + legacy full, priced + linked account sold, unpriced, never stocked); the
  `new_slot` notification item.
- Released game page: a full type renders the selectable card with the pill and line;
  the note text; a sold linked-account type now appears; no "Nothing to buy" with
  prices set.
- Coming Soon page: the gold strip appears only for a full type with a permanent price,
  with the right price and type; the Buy tab pill and note.
- Buy shop: a fully full game stays listed with "Set up on order", is absent from Ready
  today, and keeps its price.
- Checkout: `/order/buy` on a full type creates an order with `new_slot: true`; an
  in-stock type has none; a taken bundle slot still refuses.
- Admin: the order flag and the Needs-you-now item.
- Browser check on the throwaway instance at 1280px and 375px.
- Full suite green except known pre-existing failures.

## Out of scope

- Creating the extra account automatically, or changing the game's slot counts.
- A separate price or a promised setup time for new slots.
- Box sets, rentals and PS Plus.

## Rollout

Direct on `main`, pushed when the owner says push.
