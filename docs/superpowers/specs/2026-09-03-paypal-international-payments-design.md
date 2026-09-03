# PayPal for International Customers — Design

**Goal:** Let a customer outside the Philippines pay for a rental, using a
method they already have, without building a second payment gateway.

**Status:** drafted 2026-09-03, approved for implementation the same day.
**Not blocked on code** — blocked only on a PayPal Business account existing
(see Prerequisites). Everything below can be built first.

## Why

A real customer abroad asked to pay by PayPal and the sale was lost.

That is the entire justification, and it is deliberately a narrow one. Today
only QRPh is active on the PayMongo account, and QRPh must be scanned with a
Philippine bank or wallet app — so *every* international customer is currently
blocked no matter what they hold. The pending Individual-to-business upgrade
will activate card payments, and PayMongo cards do accept foreign-issued Visa
and Mastercard. That covers most international customers on its own.

It does not cover this one. They asked for PayPal by name, which means a
PayPal balance or a settled habit, and card activation would not have saved
the sale.

## Scope: a payment method, not a gateway

PayMongo does not support PayPal, so an automated PayPal checkout would mean a
second gateway end to end — its own account, checkout call, webhook, signature
scheme, and reconciliation path. PayPal signs webhooks with a certificate
chain rather than the HMAC `lib/paymongo.js` already implements, so almost
none of the existing verification work carries over.

**One lost sale justifies unblocking the path. It does not justify a second
gateway.** PayPal is therefore added as a third *manual* payment method
alongside GCash and Maya, riding the proof-upload rail that already exists:
customer pays, uploads a screenshot, order moves to `verifying_payment`, owner
approves. That flow is already built, already tested, and the owner is already
fluent in operating it.

**Revisit trigger:** if international orders reach roughly one a week, or
manual verification starts costing more than a few minutes a month, automating
it becomes worth costing out. `lib/gateway.js` is provider-agnostic by design
and its `decide()` would need no changes, so this decision is cheap to revise.
The manual method stays as the fallback either way.

## Currency: display USD, charge PHP

The customer sees the price in dollars. The money moves in pesos.

Charging in USD would be worse, not better. A Philippine PayPal account
withdraws to a Philippine bank, so PayPal must convert USD back to PHP on
withdrawal, and it charges roughly 4% above the base rate to do it. Charging
USD therefore converts the money twice — once when the customer pays, again
when the owner withdraws. Charging PHP converts it once, on the customer's
side, and the owner receives clean pesos with no PayPal spread at all.

But "₱307" tells someone in Toronto nothing. So the panel shows the USD
equivalent prominently as an approximation, while the PayPal.Me link stays
denominated in pesos. The customer gets a legible number; the business skips
the 4%.

The USD figure is explicitly **an estimate**. The customer's own bank sets the
rate they actually pay, and it will differ slightly. The panel says so.

## The surcharge never touches the order

This is the decision the rest of the design follows from.

`amount_due` stays ₱249 in the database, always. The surcharge is computed at
**display time**, on the PayPal panel only, and is never written to the order.

Three consequences, all of them the point:

- A customer who opens the PayPal panel and then pays by GCash instead needs
  no reversal, because nothing was mutated.
- The order total stays the single true number everywhere else in the app —
  admin, exports, dashboards, the paid receipt line.
- The surcharge correctly never enters `payments[]`. PayPal takes that money;
  it was never revenue. `lib/payments.js` needs no changes and monthly figures
  stay honest.

The owner verifies the *received* amount against the displayed total when
approving, exactly as they already do for GCash.

## Modules

Two pure modules, each with a plain-`assert` test script, matching the
convention every other money rule in this project follows.

### `lib/surcharge.js`

```js
computeSurcharge(amountPesos, config) -> { base, feePeso, payoutPeso, total }
```

`config` is `{ percent, fixedPeso, payoutUsd, rate }`.

- `feePeso` = `ceil(amountPesos * percent / 100) + fixedPeso`
- `payoutPeso` = `ceil(payoutUsd * rate)`
- `total` = `base + feePeso + payoutPeso`

Every rounding goes **up**, to whole pesos. Silent under-recovery is the
failure mode worth guarding against; over-recovering by a peso is not.

**The percentage must be rounded to 6 decimal places before ceiling.**
`1500 * 4.4 / 100` evaluates to `66.00000000000001` in JavaScript, and
`Math.ceil` of that is 67 — a phantom peso charged to the customer every time
the percentage happens to land on a whole number. `Math.ceil(+(x).toFixed(6))`
removes it without affecting any genuine fraction.

A base of zero returns all zeros. An order with nothing to send carries no
fees.

`percent: 0` yields a pure flat fee. `fixedPeso: 0` and `payoutUsd: 0` yield a
pure percentage. Non-finite, negative, or missing inputs are treated as zero
rather than throwing — this runs inside a page render.

### `lib/fx.js`

```js
RATE_MIN = 30
RATE_MAX = 120
isSaneRate(n)                        -> boolean
isStale(fetchedAt, now, maxAgeMs)    -> boolean
pesosToUsd(pesos, rate)              -> number, 2 decimal places
pickRate(cache, manualRate, now)     -> { rate, source }   source: 'live' | 'manual'
```

`isSaneRate` is the important one. It rejects anything non-finite, non-positive,
or outside the 30–120 PHP-per-USD band. A broken API response, an HTML error
page, or a redirect body can then never render "$0.02" or "$4,000" on a
checkout panel. The band is deliberately wide — it is a garbage filter, not a
market prediction. Strings are rejected too, including numeric ones — a rate
must arrive as a number or not at all.

`isStale` returns true when `now - fetchedAt >= maxAgeMs`, so a cache sitting
exactly on the threshold is treated as stale. An unparseable or missing
`fetchedAt` is stale. The threshold is 24 hours, matching the source's own
refresh cadence.

`pesosToUsd` rounds to the **nearest** cent, not up. It is labelled an estimate
on the page and the peso figure is the one actually charged, so there is no
under-recovery to guard against here — inflating it would only make the
estimate less accurate.

`pickRate` needs `now` because staleness is its whole job. It returns `'live'`
only for a cache that is both fresh and sane; every other case — stale, insane
rate, malformed, or absent — falls through to `manualRate` and reports
`'manual'`. If `manualRate` is itself insane, it returns `RATE_MIN` so the
caller always receives a usable number and the panel can still render.

## Fetching the rate

The network call lives in `server.js`, beside `createPaymongoCheckout`,
following the split already in place: pure logic in `lib/`, fetches in the
server.

```
fetchUsdPhpRate()
  GET https://open.er-api.com/v6/latest/USD   (no API key, refreshes daily)
  timeout 8000ms
  read rates.PHP, reject unless isSaneRate
  persist site_settings.fx_rate_cache = { rate, fetched_at }
```

**The order page never awaits this call.** If the cached rate is missing or
stale, the page renders immediately with whatever it has and triggers a
background refresh for the next visitor. A slow or dead FX API costs a
slightly old estimate, never a delayed or broken page.

Fallback chain, in order:

1. A fresh cached rate (under 24h old)
2. The last good cached rate, persisted to settings so it survives Railway
   restarts — which are frequent, and would otherwise leave every redeploy
   briefly rate-less
3. The manual rate from admin settings

The manual rate is the floor of that chain and must always be set. It is
seeded with a real value so the feature works before the first fetch ever
succeeds.

## Settings

PayPal joins `site_settings.payment_methods` as a third entry, same shape as
the existing two:

```js
{ key: 'paypal', label: 'PayPal', account_name: '', account_number: '',
  qr_image: '', enabled: false }
```

`account_number` holds the PayPal.Me username or business email. That is a
semantic stretch for a field of that name, and it is chosen anyway: it keeps
the list generic, and it means the existing guard — a method with neither a QR
nor a number can never be enabled, in the `/admin/payment-methods` handler —
works unchanged. The admin form labels the field for what it actually holds.

The admin handler's multer field list gains `qr_paypal`.

Four new numeric settings, defaulting as follows:

| Setting | Default | Meaning |
|---|---|---|
| `paypal_fee_percent` | `4.4` | PayPal's cross-border percentage |
| `paypal_fee_fixed` | `15` | PayPal's fixed per-transaction peso fee |
| `paypal_payout_usd` | `0.50` | Bank withdrawal cost, per order |
| `fx_manual_rate` | `62.50` | Fallback PHP per USD |

These are settings rather than constants because PayPal's published rates
change, and because the first real payment is the only reliable way to learn
what the fee actually lands at. The owner is expected to tune them once real
money has moved.

**A known imprecision, recorded deliberately:** the bank payout fee is charged
per *withdrawal*, not per order. Recovering it per order over-collects once
several PayPal orders are batched into one withdrawal. At the expected volume
of one or two a month this is close enough to correct, and `paypal_payout_usd`
can be set to `0` when that stops being true.

## What the customer sees

On the order page, alongside the existing GCash and Maya panels:

```
PayPal
  Rental                      ₱249
  PayPal & bank fees           ₱58
  ─────────────────────────────────
  Send                        ₱307
                        ≈ $4.91 USD

  [ Pay ₱307 with PayPal ]

  Put PH-0063 in the PayPal note.
```

The two fees are shown as **one combined line**. Itemising ₱26 and ₱32
separately on a ₱249 rental reads as nickel-and-diming and invites
line-by-line argument; one honestly-labelled line carries the same information
without inviting it. The line is named for what it is — PayPal's charge and
the bank transfer cost — and never disguised as part of the rental price.

The button links to `paypal.me/<handle>/<total>PHP`, which pre-fills the
amount so the customer cannot send the wrong figure. The order reference is
displayed prominently with instructions to put it in the PayPal note, since
PayPal.Me cannot force a note.

Below the button, the existing screenshot-upload form takes over completely
unchanged.

If PayPal is not enabled in settings, the panel does not render at all — the
same rule the other methods already follow.

## Admin

The order queue already shows `payment_method`, so a PayPal order is
identifiable with no change. The queue additionally shows the **expected
total including fees** for PayPal orders, so the owner verifies the received
amount against the right number rather than against `amount_due`.

Approve and reject already work. Nothing else changes.

## Testing

`scripts/test-surcharge.js` and `scripts/test-fx.js`, plain `assert`, run with
`node`, exiting non-zero on first failure — matching the existing eight test
scripts.

Surcharge cases, with the defaults above and `rate: 62.58`:

| Input | feePeso | payoutPeso | total |
|---|---|---|---|
| ₱249 rental | 26 | 32 | **307** |
| ₱1,500 buy | 81 | 32 | **1613** |

The ₱1,500 row is the float-error regression test: a naive
`Math.ceil(1500 * 4.4 / 100)` yields 82 and 1614, and those numbers are wrong.

Plus: rounding up rather than down (₱249 at 4.4% is 10.956, which must become
11, not 10); `percent: 0` giving a pure flat fee; `fixedPeso: 0` and
`payoutUsd: 0` giving a pure percentage; a zero amount returning all zeros; and
negative, `NaN`, and missing inputs all treated as zero without throwing.

FX cases: `isSaneRate` accepting 62.58 and rejecting `0`, negative values,
`NaN`, `Infinity`, `'62.58'` as a string, and 5 and 5000 as out-of-band;
`isStale` at exactly the threshold and either side of it, and for a missing
`fetchedAt`; `pesosToUsd` rounding to the nearest two decimals; `pickRate`
returning `'live'` for a fresh sane cache, `'manual'` for a stale one, for a
cache holding an insane rate, and for no cache at all, and returning
`RATE_MIN` when `manualRate` is itself unusable.

## Prerequisites

A **PayPal Business account** — not a personal one. Receiving
goods-and-services payments on a personal account risks a limitation, and
Business is free. The account needs a PayPal.Me handle set up and its default
receiving currency confirmed.

None of this blocks implementation. It blocks enabling the method in settings,
which is a checkbox on the day the account exists.

## Not building

- **Automated PayPal capture or webhooks.** That is the gateway, deliberately
  deferred above.
- **Multi-currency display.** USD only. It is the currency an international
  customer is most likely to reason in, and every additional one is another
  estimate to be wrong about.
- **Per-country fee detection.** The system cannot tell a domestic PayPal
  payment from a cross-border one, so it charges one fee for both and labels
  it "PayPal & bank fees" rather than "international fee" — accurate in both
  cases, and it avoids promising a distinction that cannot be made.
- **Changing `amount_due`, `payments[]`, or anything in `lib/payments.js`.**
  The surcharge is a display concern and stays one.
