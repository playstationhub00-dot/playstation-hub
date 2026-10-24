# Waitlist: "Slot given" and "Edit name" — Design

Date: 2026-10-24 · Status: approved by owner; amended after the plan's dry run (2026-10-24)

## Problem

The public line on a game page (the "Trophy line" popout) is built from orders in
`waitlisted` (free Fall in Line entry) or `reserved` (₱100 priority) state —
`lib/queue.js`. The owner manages it from Admin → Orders → Needs you now →
Waitlist (`views/partials/admin/orders/needs-you.ejs`):

- Free rows: 📋 Copy, ⭐ Priority paid, ⋯ Remove (`POST /admin/orders/:ref/cancel`).
- Priority rows: 📋 Copy and, only when `upgraded_from_waitlist`, ⋯ Undo priority.

Two gaps:

1. **No way to say "this person got their slot".** The owner hands the account over
   and records the rental with Quick Add (full rent, ₱100 priority included). The
   waitlist entry stays. A priority entry never expires and has no Remove, so the
   served customer sits at #1 forever and everyone behind is shown one place too
   far back. (Live case: Marvin R., #1 ⭐ on Call of Duty: Modern Warfare 4.)
2. **No way to fix a submitted name.** Typos and nicknames show on the public line
   as typed (masked by `lib/names.js` `maskName`). Duplicate entries from the same
   person can already be dropped with Remove; the owner did not know, and also wants
   to correct names.

## Decisions made with the owner

- The rental is recorded with Quick Add, separately. "Slot given" only closes the
  waitlist entry; it never creates or moves a rental.
- Quick Add records the **full rent**, ₱100 priority included. So a priority entry's
  ₱100 must **stop** counting as money received once the slot is given, or it is
  counted twice.
- Approach A: a "✅ Slot given" button on every waitlist row, free and priority.
  Plus "✏️ Edit name" in each row's ⋯ menu.
- The two "Adrian B." rows are one person who joined twice — handled with the
  existing Remove; no new duplicate-merging feature.

## 1 · ✅ Slot given

- **Where:** a visible button on every Waitlist row in Needs you now, next to
  📋 Copy, labelled `✅ Slot given`.
- **Confirm:** `Mark the slot as given to <name> (<ref>)?\n\nThey leave the line and
  the record is kept. A ₱100 priority fee stops counting as money — it's already in
  the rent you recorded.`
- **Route:** `POST /admin/orders/:ref/slot-given` (admin only).
  - Allowed when the order is in `waitlisted` or `reserved` **and** is not a
    pre-order (`queueRules.isPreorder(order)` is false — no `upcoming_game_id`, not
    `is_buy`). Anything else redirects with `msg=order_bad_state` and changes
    nothing. The server check is the guard; the button's absence is not.
  - Transition to `cancelled` with `slot_given_at` (ISO timestamp) set on the order.
  - Redirects to `/admin?tab=orders&msg=order_slot_given` (a stale transition gives
    `msg=order_stale`, as the sibling routes do).
  - Both routes share one guard in `server.js`, `isWaitlistEntry(order)` — in
    `queueRules.QUEUE_STATES` and not `queueRules.isPreorder(order)`.
  - Signed out, `requireAuth` answers as it does for every admin route: a form post
    goes to the login page, a background post gets 401. Nothing changes either way.
- **State machine (`lib/orders.js`):** add `cancelled` to `reserved`'s allowed
  targets. The route above is the only owner path that uses it for a `reserved`
  order; its pre-order guard keeps Coming Soon reservations and buy pre-orders out.
  The comment on `reserved` is updated to say so.
- **Effects:**
  - The entry leaves the public line and the admin Waitlist (`inQueue` only counts
    `waitlisted` / `reserved`); everyone behind moves up.
  - `cancelled` is in `PAID_EXCLUDED_STATES`, so a priority entry's ₱100 drops out of
    every paid/money readout (matches the "full rent in Quick Add" decision).
  - Not added to any refunds list (refunds read `closed` orders only).
- **Orders ledger** (`views/partials/admin/orders/ledger.ejs`): an order with
  `slot_given_at` shows the status label `✅ Slot given` instead of `Cancelled`. It
  stays in the Cancelled chip group.
- **Customer's order page** (`views/order-status.ejs`): an order with
  `slot_given_at` uses the title `✅ Slot given` and the sub `You're all set — this
  waiting-list entry is closed.` instead of `Order cancelled` / `This order is no
  longer active.` It also stops asking for money: no "To send now" total and no
  "₱X remaining, due once your slot opens" note on a slot given (the rent was taken
  when the account was handed over).
- A plain Remove stays exactly as it is (no `slot_given_at`, still "Cancelled").

## 2 · ✏️ Edit name

- **Where:** the ⋯ menu on every Waitlist row (free and priority). Priority rows
  that had no menu (not upgraded from a free entry) now get one, holding Edit name.
- **Form:** an inline form at the top of the menu — the label `✏️ Edit name`, a text
  input prefilled with the current `fb_name` (`maxlength="80"`, `required`, id
  `oqName-<ref>`) and a Save button. It is at least 230px wide so a full name fits,
  and drops its divider when it is the only item in the menu.
- **Route:** `POST /admin/orders/:ref/rename` (admin only) with `fb_name`.
  - Trimmed, inner whitespace collapsed; must be 1–80 characters
    (`lib/names.js` `cleanFbName`, which returns null otherwise). Empty or too long
    redirects with `msg=order_name_bad` and changes nothing.
  - Allowed for the same orders as Slot given (`waitlisted` / `reserved`, not a
    pre-order); otherwise `msg=order_bad_state`.
  - Saves only `fb_name` through a new `orders.setName(ref, name)`: no state change,
    no history entry, and its update is itself pinned to `waitlisted` / `reserved`, so
    a stale form can never rename a rental.
  - Redirects to `/admin?tab=orders&msg=order_renamed`.
- **Effects:** ref, state, `created_at` and therefore the place in line are
  untouched. The public line shows the new name masked as usual
  ("Adrian Bautista" → "Adrian B.").

## Admin messages

New flash messages beside the existing `order_*` ones:

- `order_slot_given` — "✅ Slot given — off the waiting list."
- `order_renamed` — "✏️ Name updated."
- `order_name_bad` — "❌ Enter a name (up to 80 characters)."

## Unchanged

Remove, ⭐ Priority paid, Undo priority, Quick Add, the customer's own Join / Upgrade,
queue ordering and expiry rules, Coming Soon reservations and buy pre-orders.

## Testing

Throwaway instance only (temp `DATA_DIR`, blank `MONGODB_URI`, in-memory sessions, a
made-up admin password, an in-memory order store). Never the real orders or database.

- Slot given on a free row and on a priority row: the order is `cancelled` with
  `slot_given_at`; the public line drops it and the next person moves up; the ₱100
  priority order no longer counts as paid.
- Slot given refused (`order_bad_state`, order unchanged) for a Coming Soon
  reservation, a buy pre-order and an `active` order.
- Ledger shows "✅ Slot given"; a plain Remove still shows "Cancelled".
- Customer order page shows the Slot given title and sub.
- Rename: changes the public masked name, keeps the position; empty and 81-character
  names are refused; a pre-order is refused.
- The Waitlist row renders the Slot given button and the Edit name form on free and
  priority rows.
- Test files: `scripts/test-waitlist-slot-given-rules.js` (the edge, `cleanFbName`,
  `setName`), `scripts/test-waitlist-admin.js` (the routes end to end, the public line,
  the order page, the toasts), and new checks in `scripts/test-orders-template.js`
  (the button, the form, the ledger label, the styles). `scripts/test-orders.js`'s
  "ways out of reserved" check now includes Slot given.
- Browser check on the throwaway instance at 1280px and 375px.
- Full suite green except the known `scripts/test-upcoming-psn-page-public.js`.

## Out of scope

- Linking a waitlist entry to its Quick Add customer automatically.
- Detecting or merging duplicate entries.
- Editing anything other than the name.

## Rollout

Direct on `main`, pushed when the owner says push.
