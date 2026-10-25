# Orders: bulk "Cancel selected" and a 30-day cleanup — Design

Date: 2026-10-24 · Status: approved by owner

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
  - For each order it re-reads the order and cancels only when the single Cancel /
    Remove would allow it: state `awaiting_payment`, `payment_rejected` or
    `waitlisted`. The transition is pinned to the state it read
    (`orders.transition(ref, 'cancelled', { cancel_reason: 'owner_bulk' }, { from:
    [state] })`), so an order that was paid or moved in the meantime is skipped.
  - Redirects to `/admin?tab=orders&msg=orders_bulk_cancelled&n=<cancelled>&skipped=<k>`.
  - Toast: `🚫 Cancelled <n> order(s).`, plus ` <k> skipped — they changed meanwhile.`
    when any were skipped.
  - Nothing ticked: redirects with `msg=orders_bulk_none`, toast `Nothing was
    selected.`

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
- **Run:** every 5 minutes, alongside the payment-reminder sweep. It is a separate
  call, so one failing does not stop the other.
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
- Full suite green except the known `scripts/test-upcoming-psn-page-public.js`.

## Out of scope

Bulk Delete, bulk Mark paid, bulk Slot given. Undo of a cancellation. Messaging the
customer when the cleanup cancels.

## Rollout

Direct on `main`, pushed when the owner says push.
