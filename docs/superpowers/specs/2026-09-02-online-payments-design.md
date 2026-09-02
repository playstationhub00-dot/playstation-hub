# Online Payments and Sign-In-First Ordering — Design

**Goal:** Let customers pay on the site through a real payment gateway, and
reorder the rental lifecycle to match how the business actually runs — sign the
customer in first, collect payment second.

**Status:** drafted 2026-09-02. **Not ready to build** — blocked on a merchant
account (see Prerequisites). Written now so implementation can start the day
that clears.

## Why

Two separate problems, one fix.

**The website contradicts the business.** The order lifecycle is
`awaiting_payment → verifying_payment → awaiting_qr → qr_pending → active`:
money first, account second. Actual transactions run the other way — the owner
signs the customer in, *then* collects payment, deliberately, because handing
over the game first is how a stranger becomes convinced the business is real.

Every customer arriving from Messenger has been trained on sign-in-first and
then meets a site demanding payment up front from a seller who hasn't yet
delivered anything. Roughly half of started orders never get paid. That gap is
the most likely explanation.

**Payment itself carries no legitimacy.** Today the site displays a personal
GCash number and a QR image and asks the customer to send money to it, then
prove they did. Sending money to a stranger's personal number is precisely the
act a nervous buyer balks at. A recognised checkout is not just automation — it
is the trust signal the manual sign-in-first workaround was buying.

## Prerequisites — blocking

A merchant account with **PayMongo** or **Xendit**, approved before any of this
can go live. Requires business registration documents, government ID, and bank
details, and takes days to weeks on the provider's side. This work cannot be
finished without it, though everything below can be built and tested in sandbox
first.

Fees are roughly 2–3.5% per transaction depending on method and provider, and
come out of margin on every rental. On a ₱349 weekly rental that is ₱8–12.

## The reordered lifecycle

Current, and the shape after this change:

| Now | After |
|---|---|
| `awaiting_payment` | `awaiting_qr` — customer sends their sign-in QR straight away |
| `verifying_payment` | `qr_pending` — owner signs them in |
| `awaiting_qr` | `active` — customer has the game, and is asked to pay |
| `qr_pending` | `awaiting_payment` — payment link live, gateway checkout |
| `active` | `paid` — gateway confirmed, rental proceeds normally |

The customer receives the account before paying, exactly as the owner does it
manually today.

**The risk this accepts, stated plainly.** An unpaid order now costs a real
slot: the customer holds a live account having paid nothing. Today an unpaid
order costs nothing but a lost sale. At the current ~50% non-payment rate this
would be materially expensive, so the mitigations below are not optional
extras — they are what makes the reorder survivable.

**Mitigations:**

- **A payment deadline.** The account is signed in, and payment is due within a
  set window (24 hours is the suggested default, owner-configurable). The order
  page shows the deadline from the moment they are signed in.
- **Automatic reminders** at the halfway point and on expiry, reusing the
  existing message-template system.
- **Owner-triggered revocation.** Past the deadline the owner can reclaim the
  slot from admin, which returns it to the pool and cancels the order. Not
  automatic — an account is a real thing to take back and that judgement stays
  with the owner.
- **Returning customers only, optionally.** A first-time buyer paying first
  while a known customer is signed in first is the safest version. Recorded here
  as a fallback, not the chosen design.

## Payment flow

1. Owner signs the customer in; order reaches `active`.
2. The order page shows a **Pay now** button and the deadline.
3. The button creates a payment intent with the gateway and redirects to hosted
   checkout — GCash, Maya, or card. The site never handles card details, which
   keeps PCI scope out of this codebase entirely.
4. On success the gateway redirects back to the order page.
5. **The webhook is the source of truth**, not the redirect. A customer closing
   the tab mid-redirect must not lose a payment that actually completed, and a
   crafted redirect URL must not mark an order paid.
6. The webhook verifies the provider's signature, matches the intent to the
   order, and transitions to `paid`.

**Idempotency:** gateways retry webhooks. Handling the same event twice must not
double-record a payment or re-fire notifications, so each event id is recorded
and replays are ignored.

**Reconciliation:** every intent stores its order ref, and every order stores its
intent id, so a payment that arrives without a matching order is visible in
admin rather than silently lost.

## Where the review moment fits

Already built and shipped (2026-09-02): the order page asks for a review once
the customer holds the game, and on submission thanks them and offers to post
the same words to Facebook.

Under the reordered flow, payment confirmation lands *after* sign-in — so the
customer has genuinely received the service by then and the confirmation screen
becomes a legitimate second place to surface the review ask. That is a copy and
placement change to existing components, not new work.

## Out of scope

- Refunds through the gateway. Deposits stay manual, as now.
- Saved cards or recurring billing.
- Automatic slot revocation. Deliberately owner-triggered.
- Replacing manual payment entirely — the existing GCash-and-proof path stays
  as a fallback for customers who prefer it and for the owner's own bookings.
- Any change to how deposits are calculated or returned.

## Testing

- `scripts/test-orders.js` gains the reordered transition table, so an illegal
  hop fails a test rather than reaching production.
- Webhook signature verification, replayed-event handling, and unknown-intent
  handling all covered in a new `scripts/test-payments-gateway.js`, all pure
  functions over fixture payloads — no live gateway calls in the suite.
- Sandbox end-to-end before go-live: successful payment, abandoned checkout,
  duplicate webhook, and a payment for an order that no longer exists.

## Open questions

- **PayMongo or Xendit?** Both cover GCash, Maya and cards in the Philippines.
  Worth comparing on settlement time and per-transaction cost once the business
  documents are ready to submit.
- **Payment window length.** 24 hours is a placeholder; the right number depends
  on how quickly customers actually pay today.
- **Deposit handling.** Whether the refundable Trophy deposit is collected
  through the gateway or stays manual, given refunds are out of scope.
