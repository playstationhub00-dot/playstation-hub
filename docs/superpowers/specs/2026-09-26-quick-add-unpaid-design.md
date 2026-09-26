# Quick Add: Unpaid Customers — Design

**Date:** 2026-09-26
**Status:** Approved in brainstorming, pending spec review

**Scope:**
- Quick Add (`POST /admin/quick-add`)
- A new "💸 Not paid yet" panel in Customers → Needs attention
- One shared settle step used by every payment path
- Sales totals that still read `customer.price`

## Problem

When the owner uses Quick Add and picks **Paid already? → Not yet**:

- **The order is created in `awaiting_payment` and the customer row gets `payments: []`.** Recorded payments drive the dashboard's money figures, so the unpaid order is already kept out of them. The customer keeps their slot and dates, so they can play straight away.
- **It shows up only in Orders → Follow-ups.** That is the collapsed group for website visitors who abandoned checkout. Its copy message says "Saw you started an order with us", which is wrong for someone the owner set up personally.
- **Confirming the payment later never reaches sales.**
  - The only button for it is Follow-ups' **✅ Mark paid**. It moves the order to `awaiting_qr` ("send us your sign-in code"), even though the customer is already playing. It never adds a payment to the customer row, so the money is never counted anywhere.
  - The same happens if the customer pays through their own order link, by the QR Ph checkout or an uploaded proof the owner approves. The order jumps to `awaiting_qr` and no payment is recorded.
- **Two places count `customer.price` as money earned, paid or not:**
  - the Games tab Money column (`lib/games-view.js` `earningsByGame`)
  - the phone admin page `/admin/app` (`totalRevenue`, `monthRevenue`)

## Goals

- An unpaid Quick Add is listed under **Customers → Needs attention → 💸 Not paid yet** until it is paid.
- Nothing about it counts as sales until payment is confirmed. From then on it counts, **dated the day it is confirmed**.
- **Any way the money arrives settles it the same way:**
  - the owner's **Confirm paid**
  - the customer's QR Ph checkout
  - an uploaded proof the owner approves
  - the old **Mark paid**

  Settling records the payment and moves the order to the state it would have had if it had been paid at Quick Add.
- The owner picks the payment method when confirming.
- A copy-ready payment reminder is available on each row.

## Non-goals

- **No change to how a paid Quick Add works.**
- **No change to the Orders ledger or the "money this month" tile.** Both group orders by the month the order was placed. A Sep 28 Quick Add paid on Oct 2 appears under September there, while the payment-based dashboard charts count it in October. This is existing behaviour and is left alone.
- **No partial payments.** Confirm paid records the full amount still owed.
- **No new way to cancel an unpaid Quick Add.** The customers table's existing Delete already removes the customer and its order.
- **No change to website checkout orders.** A customer who ordered on the site and has not paid is still a Follow-up.

## Design

### Quick Add

When **Not yet** is chosen, the order is created in `awaiting_payment` exactly as today. It also stores `settle_state`, the state it would have been born in had it been paid. This uses the same rule the paid path already applies:

| Situation | `settle_state` |
|---|---|
| Coming Soon game | `reserved` |
| Finished | `closed` |
| Not signed in yet (`signed_in === 'no'`) | `awaiting_qr` |
| Otherwise | `active` |

The customer row is written as today: status, slot and dates as chosen, `payments: []`.

### Which orders are "owner-recorded and unpaid"

An order is owner-recorded and unpaid when both hold:

- its state is `awaiting_payment`, `verifying_payment` or `payment_rejected`, and
- it has a `settle_state` or a `customer_id`.

Website checkout orders never have a customer record before they are paid; the record is created when the owner signs them in or confirms a reservation. So this cannot catch a website Follow-up. Unpaid Quick Adds created before this change have a `customer_id` but no `settle_state`, so they are caught too.

### Settling

`settleTarget(order, customer)` returns `order.settle_state` when it is set. Otherwise it works the target out from the customer row:

| Customer `status` | Target |
|---|---|
| `renting` | `active` |
| `bought` | `active` |
| `done` | `closed` |
| `reservation` | `reserved` |
| anything else | `active` |

**`settlementPayment(order, customer, today)` returns the payment line to record:**
- **Amount:** the customer's `price` minus whatever payments that row already has, floored at 0. With no customer row, it is `order.amount_due`. The deposit is not sales, the same as a paid Quick Add today.
- **Date:** `today` (Manila date, `orders.manilaDate()`).
- **Kind:** `reservation` when the order has an `upcoming_game_id`, `purchase` when `is_buy`, otherwise `rent`. These are the kinds Quick Add already writes.
- It returns `null` when the amount is 0, and then nothing is pushed.

**`orders.settleOwnerRecorded(ref, toState, patch)` is a new function in `lib/orders.js`.**
- It is a single pinned update, filtered on `{ ref, state: { $in: ['awaiting_payment', 'verifying_payment', 'payment_rejected'] } }`.
- It `$set`s `patch` plus `state: toState` and `$push`es `{ state, at }` onto `state_history`.
- `toState` must be one of `active`, `awaiting_qr`, `closed`, `reserved`. Anything else is refused.
- It returns `true` only when a document matched. It is modelled on `releaseUnpaidReservation`.

**`settleQuickAddPayment(order, { method, channel, extraPatch })` is one helper in `server.js`, used by every path:**
1. It works out the target with `settleTarget`.
2. It calls `orders.settleOwnerRecorded(order.ref, target, { paid_at: <now ISO>, payment_channel: channel, payment_method: method, ...extraPatch })`.
3. **Only if that returned `true`**, it pushes the `settlementPayment` line onto the customer row, so a double-click or a race never records a second payment.
4. It returns `{ ok, target }`.

**The four payment paths call it:**

| Path | When | `method` / `channel` |
|---|---|---|
| New `POST /admin/orders/:ref/confirm-paid` | the order is owner-recorded and unpaid | the form's `method` (an enabled payment-method key or `manual`) / `manual` |
| `POST /admin/orders/:ref/advance` | the order is in `verifying_payment` **and** owner-recorded. This branch runs before every other branch in the route and returns. | `order.payment_method \|\| 'manual'` / `order.payment_channel \|\| 'proof'` |
| `POST /admin/orders/:ref/mark-paid` | the order is owner-recorded and unpaid. Branches before the existing logic and returns. | `order.payment_method \|\| 'manual'` / `manual` |
| `POST /webhooks/paymongo`, accept branch | the order is owner-recorded and unpaid. Branches before the reservation / `awaiting_qr` logic. | `gateway` / `paymongo`. `extraPatch` carries `paid_amount_centavos` and `overpaid_by_centavos`. |

**Confirm paid redirects** to `/admin?tab=customers&msg=payment_confirmed`, or to `&msg=payment_confirm_stale` when the settle did not happen. The toasts are:
- `payment_confirmed`: `✅ Payment confirmed — counted in sales from today.`
- `payment_confirm_stale`: `❌ That order is no longer waiting for payment — reload and try again.`

Both map to the `customers` tab in `views/admin.ejs`.

### The panel

This is a new partial, `views/partials/admin/customers/unpaid.ejs`. It is included at the top of the Needs attention card body in `views/partials/admin/customers.ejs`, and the card's show condition gains `unpaidQuickAdds.length`. It reuses the card's existing classes (`rem-panel`, `rem-title`, `unlinked-note`, `rem-row`, `rem-info`, `rem-name`, `rem-badge`, `rem-meta`, `btn-copy`, `rem-copy`), so it needs no new CSS.

**Title and note:**
- Title: `💸 Not paid yet (N)`
- Note: `Added with Quick Add as not paid. None of this counts in sales until the payment is confirmed — then it counts from that day.`

**Each row, oldest first:**
- Name, then the order ref as a badge.
- `‹game› · ‹Non-Trophy|Trophy|PS4 Primary› · ‹N days|Purchase|Reservation›`.
- `₱‹owed› owed · since ‹Mon D›`, where owed is `amount_due`.
- When `verifying_payment`: `📎 Proof sent — ` plus a `view receipt` link to `payment_proof` when there is one.
- When `payment_rejected`: a `payment rejected` tag.
- Actions:
  - A form posting to `/admin/orders/‹ref›/confirm-paid`, holding a method `<select name="method">` (the enabled payment methods from settings, then `Other / cash` = `manual`) and a **Confirm paid** button.
  - A `rem-copy` **📋 Copy reminder** button whose `data-msg` is the reminder.

**The reminder text:** `👋 Hi ‹first name›! Friendly reminder — ₱‹owed› for ‹game› (‹ref›) is still unpaid.\n\nYou can pay here: ‹link›\nor just reply here once you've sent it. Thank you!` The link is `‹website_link || SITE_URL›/order/‹ref›?k=‹url_key›`. When the order has no `url_key`, the "You can pay here" line is left out.

### The customers table

The price cell adds `<span class="rem-badge rem-overdue">unpaid</span>` for a customer whose id is in `unpaidCustomerIds`.

### Follow-ups

`abandonedOrders` drops owner-recorded unpaid orders, so website Follow-ups are the only thing left in that group.

### Sales totals

- **Games tab.** `lib/games-view.js` `earningsByGame` sums each customer row's `payments[].amount` instead of `price`. `txns` counts the rows whose payments add up to more than 0. A paid customer's payments add up to its price, so nothing changes for paid customers.
- **`/admin/app`.**
  - `totalRevenue` is the sum of every recorded payment.
  - `monthRevenue` is the sum of payments whose `date` falls in the current Manila month (`YYYY-MM`). This is the same payment-based attribution the main dashboard already uses.

## Architecture

- **New `lib/quick-add-settle.js`**, pure, exporting:
  - `PRE_PAYMENT_STATES`
  - `SETTLE_TARGETS`
  - `isOwnerRecordedUnpaid(order)`
  - `settleTarget(order, customer)`
  - `settlementPayment(order, customer, today)`
  - `reminderMessage({ fbName, owed, gameTitle, ref, link })`
- **`lib/orders.js`** gains and exports `settleOwnerRecorded`.
- **`server.js`:**
  - Quick Add stores `settle_state`.
  - The `settleQuickAddPayment` helper.
  - The new route.
  - Four hooks: advance, mark-paid, webhook, and the Follow-ups filter.
  - The admin data `unpaidQuickAdds` (each row carrying `reminder_msg`) and `unpaidCustomerIds`, passed to the render.
  - `/admin/app` revenue.
- **`views/partials/admin/customers.ejs`** includes the panel and shows the price tag.
- **`views/admin.ejs`** gets the toasts and the tab mapping.

**Line endings:**
- `server.js` is CRLF with a UTF-8 BOM, and `views/partials/admin/customers.ejs` is CRLF. Both are edited with the Edit tool only.
- The new files are LF.

## Error handling

- **A settle that finds the order already paid** (double-click, or the webhook got there first) does nothing and records no payment. Confirm paid shows the stale toast.
- **A missing customer row** (deleted by hand) still settles the order. There is no row to record the payment on, and the server logs it.
- **An unknown `method`** posted to Confirm paid falls back to `manual`.
- **A settle target outside `SETTLE_TARGETS`** is refused by `settleOwnerRecorded`.

## Testing

- **`scripts/test-quick-add-settle.js` (new).** The pure rules:
  - `isOwnerRecordedUnpaid`: a web Follow-up is excluded; a legacy Quick Add caught through `customer_id` is included; paid states are excluded.
  - `settleTarget`: the saved target wins; each customer-status fallback.
  - `settlementPayment`: amount = price − existing payments; the three kinds; `null` at 0.
  - `reminderMessage`: with and without a link.
- **`scripts/test-orders-settle.js` (new).** `settleOwnerRecorded` against a fake database that honours the filter:
  - it settles from each of the three unpaid states
  - it refuses once already paid
  - it refuses a target outside the allowed list
  - it pushes `state_history`
  - it returns false with no database
- **`scripts/test-quick-add-unpaid-wiring.js` (new).** Source-level checks:
  - Quick Add stores `settle_state`
  - the helper settles before pushing the payment
  - all four hooks call it, and each branch comes before the path's existing logic
  - the Follow-ups filter
  - the `/admin/app` revenue reads payments
  - the toasts
- **`scripts/test-unpaid-panel.js` (new).** Renders the partial with fixtures:
  - title and count
  - the row text
  - the proof-sent and rejected variants
  - the Confirm paid form action and method options
  - the copy button's reminder text
- **`scripts/test-games-view.js` and `scripts/test-games-template.js` (existing).** Money fixtures move from `price` to `payments`. A new case covers an unpaid row counting nothing.
- **Browser check** on a fixture-rendered Customers tab: the panel, the table tag, and the copy button. Never the live admin.
- **Full regression.** Only the pre-existing `scripts/test-requests-page.js` failure is expected.
