# Online Payments — Design

**Goal:** Let customers pay on the site through a real payment gateway, so
paying stops meaning "send money to a stranger's personal number".

**Status:** drafted 2026-09-02, restructured into phases the same day.
**Phase 1 is not ready to build** — blocked on a merchant account (see
Prerequisites). Written now so implementation can start the day that clears.
**Phase 2 is deliberately not scheduled** — see the decision gate.

## Why

Today the site displays a personal GCash number and a QR image, asks the
customer to send money to it, and then asks them to prove they did. Sending
money to a stranger's personal number is precisely the act a nervous buyer
balks at, and roughly half of started orders never get paid.

A recognised checkout is not mainly about automation. It is the trust signal
the business currently earns by hand.

## Two phases, and why they are separate

The original draft of this spec did both at once: add the gateway **and**
reorder the lifecycle so customers are signed in before they pay. They have
been split, because doing both together is two risky changes where one removes
the reason for the other.

The reorder exists to solve a trust problem — handing over the game first is
how a stranger becomes convinced the business is real. **The gateway solves
that same problem**, without costing a slot every time someone doesn't pay. Ship
it first and the reorder may turn out to be unnecessary.

Splitting also buys a measurement that is otherwise impossible. "Half don't pay"
currently has at least two explanations: paying is scary, or the site asks
before it delivers. Ship the gateway alone and the answer separates cleanly.
Change both at once and it stays permanently ambiguous which one worked.

---

# Phase 1 — Payment gateway

The order lifecycle is **unchanged**. Customers still pay before being signed
in; the only difference is how they pay.

## Prerequisites — blocking

A merchant account with **PayMongo** or **Xendit**, approved before this can go
live. Requires business registration documents, government ID, and bank
details, and takes days to weeks on the provider's side. Everything below can be
built and sandbox-tested first, but nothing ships without it.

Fees are roughly 2–3.5% per transaction depending on method and provider, and
come out of margin on every rental. On a ₱349 weekly rental that is ₱8–12.

## Payment flow

1. The order reaches `awaiting_payment`, exactly as it does today.
2. The order page shows a **Pay now** button alongside the existing manual
   GCash/Maya details.
3. The button creates a payment intent with the gateway and redirects to hosted
   checkout — GCash, Maya, or card. The site never handles card details, which
   keeps PCI scope out of this codebase entirely.
4. On success the gateway redirects back to the order page.
5. **The webhook is the source of truth**, not the redirect. A customer closing
   the tab mid-redirect must not lose a payment that actually completed, and a
   crafted redirect URL must not be able to mark an order paid.
6. The webhook verifies the provider's signature, matches the intent to its
   order, and transitions `awaiting_payment → verifying_payment → awaiting_qr`
   automatically — the same path the owner walks manually today, so no new
   states and no changed transitions.

**Idempotency:** gateways retry webhooks. Handling the same event twice must not
double-record a payment or re-fire notifications, so each event id is recorded
and replays are ignored.

**Reconciliation:** every intent stores its order ref and every order stores its
intent id, so a payment arriving without a matching order surfaces in admin
rather than vanishing.

**The manual path stays.** Some customers will not have a card or e-wallet
ready, gateways have outages, and the owner needs it for their own bookings. It
already works; removing it would be effort, not saving.

## What Phase 1 does not change

- No new order states.
- No payment deadline, reminders, or slot revocation — none of it is needed
  while payment still comes first.
- No change to deposits, refunds, or how slots are allocated.

## Build status

**Provider chosen: PayMongo.** Philippines-native, covers GCash, Maya and cards,
simpler onboarding at this size.

**Done (2026-09-02)** — `lib/gateway.js` and `scripts/test-gateway.js`, 15
assertions, no credentials required to run:

- Peso↔centavo conversion, isolated and tested because inverting it would accept
  ₱3.49 for a ₱349 rental.
- Amount due as rent plus deposit.
- Replay detection on the provider's event id, checked *before* any other rule
  so a retry never reports as a state error.
- `PAYABLE_STATES` — only `awaiting_payment` and `payment_rejected`; every other
  state is asserted to reject a payment.
- Underpayment never accepted, down to a single centavo.
- Overpayment accepted but flagged with the difference.
- A payment with no matching order surfaced rather than discarded.
- Order refs from intent metadata validated through `orders.parseOrderRef`,
  since metadata round-trips through the provider and returns untrusted.

**Blocked on merchant keys** — the PayMongo adapter, whose only jobs are:

1. Verify the webhook signature.
2. Normalise the payload into `{ id, orderRef, amountCentavos, paid }`.
3. Create a payment intent with `order_ref` in metadata and redirect to hosted
   checkout.

Everything after step 2 is already decided by `gateway.decide()`, so the adapter
stays thin and swapping providers never touches the money rules.

**Also outstanding**, deliberately not built ahead of the API:

- Persisting processed event ids and the intent↔order link. Left until the real
  payload shapes are known rather than guessed.
- The Pay now button on the order page, behind a settings flag.
- The admin reconciliation view for orphaned payments.

## Testing

- `scripts/test-gateway.js` covers the decision rules above — pure functions over
  fixture payloads, no live gateway calls in the suite.
- Signature verification gains its own tests with the adapter, against captured
  PayMongo fixtures.
- Sandbox end-to-end before go-live: successful payment, abandoned checkout,
  duplicate webhook, and a payment for an order that no longer exists.

---

# Decision gate

**Run Phase 1 for about a month before deciding anything about Phase 2.**

The number that matters is the share of started orders that get paid, currently
around 50%.

- **If it climbs materially**, payment friction was the problem, the gateway
  fixed it, and Phase 2 should not be built. It would add real risk for a
  benefit already collected.
- **If it barely moves**, payment friction was not the cause — and the
  sign-in-first hypothesis is worth acting on, because something else is
  stopping people and delivery order is the strongest remaining candidate.

---

# Phase 2 — Sign-in-first ordering

**Only if the decision gate says so.** Recorded in full so nothing is lost, not
because it is scheduled.

## The reordered lifecycle

| Now | After |
|---|---|
| `awaiting_payment` | `awaiting_qr` — customer sends their sign-in QR straight away |
| `verifying_payment` | `qr_pending` — owner signs them in |
| `awaiting_qr` | `active` — customer has the game, and is asked to pay |
| `qr_pending` | `awaiting_payment` — payment link live, gateway checkout |
| `active` | `paid` — gateway confirmed, rental proceeds normally |

`paid` is a genuinely new state. The lifecycle has never needed one, because
payment always came first and `active` therefore implied paid. After the flip
`active` means "has the game, may not have paid", so the two must be
distinguishable. This is the change that ripples furthest through the code.

## The risk this accepts

An unpaid order stops costing a lost sale and starts costing **a real slot** —
someone holding a live account having paid nothing. The mitigations below are
not optional extras; they are what makes the reorder survivable.

- **A payment deadline.** Payment due within a set window (24 hours suggested,
  owner-configurable), shown on the order page from the moment they are signed
  in.
- **Automatic reminders** at the halfway point and on expiry, reusing the
  existing message-template system.
- **Owner-triggered revocation.** Past the deadline the owner can reclaim the
  slot from admin, returning it to the pool and cancelling the order. Never
  automatic — taking back an account is a real act and that judgement stays
  with a person.

Access being revocable is what bounds this risk: the owner controls the PSN
account and can lock a non-payer out. The cost of an unpaid order is days of
blocked availability plus an awkward conversation, not a lost game.

## The safer variant, if Phase 2 happens at all

**Sign-in-first for returning customers only.** A first-time buyer pays first;
someone who has already paid before gets signed in first.

This is the version worth building. The risk is near zero — these people have a
payment history — and it reads to the customer as a loyalty perk rather than an
exposure. It also concentrates the benefit where trust is cheapest to extend.

The cost is a branch in the ordering flow and the "has this person paid before?"
lookup behind it.

## Where the review moment fits

Already built and shipped (2026-09-02): the order page asks for a review once
the customer holds the game, and on submission thanks them and offers to post
the same words to Facebook.

Under Phase 2, payment confirmation lands *after* sign-in, so the customer has
genuinely received the service by then and the payment-confirmation screen
becomes a second legitimate place to surface the ask. Copy and placement on
existing components, not new work.

Under Phase 1 it stays exactly where it is, since payment still precedes
delivery and a review at that point would be a review of nothing.

## Testing

`scripts/test-orders.js` gains the reordered transition table, so an illegal hop
fails a test rather than reaching production.

---

## Out of scope, both phases

- Refunds through the gateway. Deposits stay manual, as now.
- Saved cards or recurring billing.
- Automatic slot revocation. Deliberately owner-triggered.
- Replacing the manual GCash-and-proof path.
- Any change to how deposits are calculated or returned.

## Open questions

- **PayMongo or Xendit?** Both cover GCash, Maya and cards in the Philippines.
  Worth comparing settlement time and per-transaction cost once the business
  documents are ready to submit.
- **Deposit handling.** Whether the refundable Trophy deposit is collected
  through the gateway or stays manual, given refunds are out of scope.
- **Payment window length** — Phase 2 only. 24 hours is a placeholder; the right
  number depends on how quickly customers actually pay once the gateway exists,
  which Phase 1 will reveal.
