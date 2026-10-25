# Orders: bulk "Cancel selected" and a 30-day cleanup — Design

Date: 2026-10-24 · Status: approved by owner; amended after the plan's dry run (2026-10-25)

## Problem

The By game board (Admin → Orders → Needs you) holds 54 unpaid follow-ups and 15
waitlist entries. Many are weeks old, all with "Last call" sent, and some are the same
person several times (PH-0145/0146/0147). Removing them means opening ⋯ → Cancel or
Remove on each row, one at a time.

Facts that shape the design:

- An unpaid follow-up does **not** hold a slot. A slot is locked only when the owner
  signs a customer in (Settings → Payment reminders says so). Clearing old follow-ups
  is tidying, not freeing slots.
- A free waitlist entry older than 30 days already drops off the public line
  (`lib/queue.js` `QUEUE_EXPIRY_DAYS`, display only); the admin still lists it with "—".
- The existing "Auto-cancel when the hold ends" switch (off) is tied to the
  customer-facing hold countdown, which can be at most 168 hours. It is a different
  thing and stays as it is.

## Decisions made with the owner

- Removing means **cancelling**: the order leaves the board and stays in the All
  orders ledger. Nothing is deleted.
- Checkboxes with one **Cancel selected** button.
- A **30-day cleanup**, controlled by a Settings switch that starts **on**.
- ⭐ Priority (paid) entries are never removed in bulk or by the cleanup.

## 1 · Checkboxes and "Cancel selected"

- **Which rows get a checkbox:**
  - every Started-didn't-pay row (`awaiting_payment` / `payment_rejected`);
  - every free waitlist row (`waitlisted`).
  - ⭐ Priority rows (`reserved`) get none.
- **Checkbox markup:** `<input type="checkbox" class="oq-pick" name="refs" value="<ref>"
  form="oqBulkForm">`, placed first in the row's top line. The `form` attribute ties it
  to one form outside the rows, so no form is nested in another.
- **Select all:** each card body starts with a "Select all in this card" checkbox
  (`.oq-pick-all`) that ticks or clears that card's row boxes. It only shows when the
  card has at least one pickable row.
- **Action bar:**
  - `<form id="oqBulkForm" method="POST" action="/admin/orders/bulk-cancel">` sits
    after the board.
  - A fixed bar at the bottom of the screen (`.oq-bulk-bar`, hidden until something is
    ticked) reads `<n> selected`, with **🚫 Cancel selected** and **Clear**.
  - Confirm: `Cancel <n> selected orders?\n\nThey leave the board; the records stay in
    All orders.`
  - `public/js/admin-orders.js` keeps the count, the select-all boxes and the bar in
    step with the ticks.
- **Route** `POST /admin/orders/bulk-cancel` (admin only), body `refs` (one or many):
  - Takes at most 200 refs. Any ref that is not `PH-<digits>` is ignored.
  - For each order it re-reads the order and cancels only when
    `lib/order-cleanup.js` `isCancellable` allows it: state `awaiting_payment`,
    `payment_rejected` or `waitlisted`, and not an owner-recorded unpaid Quick Add.
    That is the same rule the cleanup uses, and one step stricter than the single
    Cancel. A Quick Add never shows on the board anyway, so only a hand-made request
    could ask for one. The transition is pinned to the state it read
    (`orders.transition(ref, 'cancelled', { cancel_reason: 'owner_bulk' }, { from:
    [state] })`), so an order that was paid or moved in the meantime is skipped.
  - Redirects to `/admin?tab=orders&msg=orders_bulk_cancelled&n=<cancelled>&skipped=<k>`,
    where `k` is every usable ref that was not cancelled: already cancelled, paid,
    priority, or not found.
  - Toast: `🚫 Cancelled <n> order(s).`, plus ` <k> skipped — they changed meanwhile.`
    when any were skipped.
  - Nothing ticked, or only unusable refs: redirects with `msg=orders_bulk_none`,
    toast `Nothing was selected.`
  - The confirm uses the singular for one (`Cancel 1 selected order?`).
  - Each "Select all" box goes half-ticked when only some of its card's rows are
    ticked.

## 2 · Automatic cleanup

- **Setting:** in Settings → Payment reminders, under the existing switches:
  - a checkbox `Clean up old entries`, saved as `cleanup_enabled`;
  - a number `after (days)`, saved as `cleanup_days`.
  - The note reads: `Cancels unpaid orders and free waiting-list entries with no
    activity for this many days. Priority (paid) entries and unpaid Quick Adds are
    never touched. The records stay in All orders.`
  - **Unset means on, 30 days.** The days are clamped to 7–365.
  - The save route keeps both fields; it already rewrites the whole
    `payment_reminders` object, so they must be included or one save would reset them.
- **Which orders are stale:**
  - a pure helper, `lib/order-cleanup.js` `staleOrders(orders, settings, now)`, picks
    them;
  - state `awaiting_payment`, `payment_rejected` or `waitlisted`;
  - **not** an owner-recorded unpaid Quick Add (`quickAddSettle.isOwnerRecordedUnpaid`);
  - **last activity** at least `days` ago. Last activity is the latest
    `state_history[].at`, or `created_at` when there is no history; an unreadable date
    is never stale.
  - ⭐ `reserved` is never in scope.
- **Run:** every 5 minutes, on its own timer beside the payment-reminder timer, so one
  failing never stops the other. The first run is about 5 minutes after the server
  starts. An order that fails to cancel does not stop the rest, and a sweep that
  starts while one is still running does nothing.
- The days entered in Settings are saved through the same rule (`normalizeCleanup`),
  so the form always shows a value between 7 and 365.
  - Each stale order is cancelled with `{ cancel_reason: 'stale', stale_days: <days> }`,
    pinned to the state it was read in.
  - It logs `[order cleanup] <n> cancelled` when it cancels any.
  - It does nothing when switched off.
- **Ledger:** a cancelled order with `cancel_reason === 'stale'` reads
  `Cancelled · <stale_days>+ days`. Other cancellations keep their labels
  (`Cancelled`, `✅ Slot given`).
- **First run:** because the switch starts on, every entry already past 30 days is
  cancelled on the first sweep after the update.

## Unchanged

The per-row Cancel / Remove / Delete and every other row action. Hold countdown and
"Auto-cancel when the hold ends". The public line, which already hides free entries
past 30 days. Priority entries. Quick Add.

## Testing

Throwaway data only (fixtures, temp `DATA_DIR`, blank `MONGODB_URI`, in-memory sessions
and orders, a made-up password).

- `lib/order-cleanup.js`:
  - settings defaults and clamping;
  - last activity from history or `created_at`;
  - stale versus fresh at the boundary;
  - priority, Quick Add unpaid, paid and active orders never stale;
  - a bad date is never stale.
- Bulk route:
  - cancels eligible refs and skips priority, paid and changed ones;
  - ignores junk refs; caps at 200;
  - redirects with the counts; refuses when signed out.
- Cleanup sweep, through the real wiring: stale entries cancelled with
  `cancel_reason: 'stale'`, fresh ones kept, nothing when switched off.
- Template:
  - checkboxes on follow-up and free waitlist rows only;
  - select-all per card;
  - the bulk form and bar;
  - the ledger label `Cancelled · 30+ days`.
- Settings: the form shows the switch and days; saving keeps them alongside the
  reminder fields.
- Browser check on a throwaway instance at 1280px and 375px.
- Test files:
  - `scripts/test-order-cleanup.js`: the rules and the sweep, with fakes.
  - `scripts/test-orders-bulk-cancel.js`: the real route.
  - `scripts/test-order-cleanup-wiring.js`: it catches the server's timers and runs
    only the cleanup one, then checks the setting and the ledger label.
  - `scripts/test-orders-template.js`: the markup.
  - `scripts/test-admin-orders-filter.js`: the bar's wording.
- Full suite green except the known `scripts/test-upcoming-psn-page-public.js`.

## Out of scope

Bulk Delete, bulk Mark paid, bulk Slot given. Undo of a cancellation. Messaging the
customer when the cleanup cancels.

## Rollout

Direct on `main`, pushed when the owner says push.
