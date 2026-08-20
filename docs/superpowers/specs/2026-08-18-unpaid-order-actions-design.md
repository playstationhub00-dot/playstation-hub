# Unpaid Order Actions — Design

**Date:** 2026-08-18
**Status:** Approved

## The problem

An order stuck in `awaiting_payment` has exactly one owner action: **Delete**.

Two everyday situations dead-end because of it:

**The customer paid through Messenger.** An order only reaches `verifying_payment`
when the customer uploads a receipt *on their order page*. Pay over Messenger and
they never touch that page, so the order sits in `awaiting_payment` indefinitely. It
never enters the "Needs you" queue, which is built from
`OWNER_STATES = ['verifying_payment', 'qr_pending', 'verifying_return']`
(`lib/orders.js:11`). The owner's only options are to delete the record — losing the
sale from revenue entirely — or leave it looking permanently unpaid.

**The customer cancelled.** `cancelled` is a state the UI already knows how to
render, and the transition graph already permits it. Nothing in the interface can
trigger it.

The main "All orders" table is read-only — ref, customer, game, rental, dates, total,
status, and no actions column.

## What changes

Two owner actions on orders in `awaiting_payment` or `payment_rejected` — the two
states that already populate the "Didn't pay" list.

### 1. Mark as paid → `awaiting_qr`

Not `active`. Landing in `awaiting_qr` drops the order back into the normal pipeline
at precisely the point a site-paid order would occupy: the customer still holds their
`/order/REF?k=…` link, their page advances to the "send your sign-in QR" step, and
the owner signs them in through the existing queue.

**Revenue is recorded by the existing path, not by this action.** The customer record
— the row every revenue, top-games, and completed-orders readout is computed from —
is created in `POST /admin/orders/:ref/advance` when an order becomes `active`
(`server.js:1854`). A Messenger-paid order therefore counts as a real sale at the
same moment as every other order: when the owner signs the customer in. No parallel
accounting path, and no risk of the two disagreeing.

### 2. Cancel → `cancelled`

Confirm dialog, since it is not reversible through the UI.

## State graph change

`transition()` validates every move against `ALLOWED` in `lib/orders.js:21`. Checked
against it:

| Transition | Currently allowed? |
|---|---|
| `awaiting_payment → cancelled` | **Yes** — no change needed |
| `payment_rejected → cancelled` | **Yes** — no change needed |
| `awaiting_payment → awaiting_qr` | **No** |
| `payment_rejected → awaiting_qr` | **No** |

Cancel needs no graph change. Mark-paid does: `awaiting_qr` is added to the allowed
targets for both `awaiting_payment` and `payment_rejected`.

This is a deliberate widening of a safety mechanism on a live order system, so the
reasoning is recorded here rather than left implicit. An owner confirming an
out-of-band payment is semantically the same event as a customer uploading proof plus
the owner approving it — the existing two-hop path
`awaiting_payment → verifying_payment → awaiting_qr` expresses the same outcome. That
route was considered and rejected: it makes the owner "verify" a payment they
personally just confirmed, and turns a routine daily action into two clicks. Widening
the graph by one target per state is the smaller cost.

No other transition is added, removed, or reordered.

## Routes

Two new handlers, mirroring the guard-and-redirect shape of the existing
`POST /admin/orders/:ref/reject` (`server.js:1983`):

- `POST /admin/orders/:ref/mark-paid`
- `POST /admin/orders/:ref/cancel`

Both reject any order whose state is not `awaiting_payment` or `payment_rejected`,
redirecting with `msg=order_bad_state` exactly as the advance route does for an
out-of-sequence order. `transition()` returns `null` on a stale or concurrent write,
which redirects with `msg=order_stale` — the same handling the existing routes use.

## UI

Both buttons join the existing **Copy** and **Delete** controls on the "Didn't pay"
rows (`views/partials/order-queue.ejs:296-312`), where these orders already appear.
No new panel, no change to the read-only All orders table.

## What deliberately does not change

- **Revenue, top-games, and completed-order logic.** Untouched; a marked-paid order
  reaches them through the existing `advance` route.
- **The customer-facing order page and the order lifecycle** beyond the one added
  transition target.
- **The All orders table**, which stays read-only.
- **`OWNER_STATES`** and the "Needs you" queue composition.
- **Delete**, which keeps its current behaviour for genuine duplicates and mistakes.

## Out of scope — a known adjacent gap

If a customer sends their sign-in QR through Messenger rather than the order page,
the order parks in `awaiting_qr`, which has no owner action either — the same class
of dead-end this spec fixes one state earlier.

That gap is pre-existing and is not introduced by this change. It is left alone
deliberately: fixing it means deciding whether the owner can start a rental clock
without a QR on file, which is a separate decision with its own consequences. Worth
revisiting if it turns out to happen often.
