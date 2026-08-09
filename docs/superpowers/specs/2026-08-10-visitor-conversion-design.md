# Visitor Conversion: Friction Removal — Design

**Date:** 2026-08-10
**Status:** Approved design, pending implementation plan

## The problem, in real numbers

The site gets real traffic and the business earns real money, but almost none of that traffic converts on the website itself.

| Measure | Value | Source |
|---|---|---|
| Unique visitors (30 days) | 1,304 | visitor tracker |
| Total visits (30 days) | 8,196 | visitor tracker |
| Messenger inquiries / month | ~30 | owner estimate |
| Rentals / month | ~25 | customers dashboard |
| **Visitor → inquiry rate** | **2.3%** | derived |
| **Inquiry → rental rate** | **83%** | derived |
| Average rental value | ₱530 | ₱110,815 ÷ 209 rentals |

The close rate is excellent. The bottleneck is entirely upstream: **97.7% of visitors leave without ever making contact.**

Because the close rate is so high, upstream movement is worth a lot:

> **Every 1 percentage point of contact rate ≈ ₱5,800/month.**
> 1,304 × 1% × 83% close × ₱530 = ₱5,734

Going from 2.3% to 4% — one visitor in twenty-five — would roughly double the business without changing anything about how rentals are sold.

### Why visitors don't convert

Traffic is warm: it comes mostly from the business's own Facebook page, so these people already know the brand. Trust is not the barrier. Friction is.

Today, a visitor on a game page who has already chosen an account type and duration sees:

1. A large primary button → **Messenger**
2. A sticky bar pinned to the bottom of the screen → **Messenger**
3. Below the fold, a grey divider reading *"or book on the site"* → the on-site checkout

The high-friction path (leave the site, open Messenger, compose a message, give your name, wait for a human) owns both prominent surfaces. The low-friction path — the order flow shipped 2026-08-09, which completes in about fifteen seconds — is a whisper below the fold.

For the 97.7% who will not start a conversation, that whisper was the only option available to them.

### Page-level traffic

| Page | All-time visits |
|---|---|
| Home | 2,772 |
| `/upcoming/marvel-s-wolverine-4` | 643 |
| Browse Games | 533 |
| `/game/007-first-light` | 147 |

The second-most-visited page on the site is a game that cannot be rented. Capturing that audience is real opportunity but is **deliberately out of scope here** (see Out of scope).

## What changes

### 1. Flip the CTA hierarchy on the game detail page

Restructure the booking panel so the on-site path is the primary action.

**Current:**
```
[  📘 Message Us on Facebook  ]   <- primary, filled
     Send us: Game · Days · Type
──────  OR BOOK ON THE SITE  ──────
[  Your Facebook name         ]
[  Get my order link →        ]   <- secondary, grey
```

**Proposed:**
```
[  Your Facebook name         ]
[  🎮 Rent now — ₱479         ]   <- primary, filled
   Pay via GCash or Maya · no account needed

   or message us on Facebook instead   <- quiet text link
```

Specific decisions:

- **The name field joins the primary block.** It moves above the button; the "or book on the site" divider is removed. One field, one button, one action.
- **The button carries the live total.** `Rent now — ₱{total}` where `{total}` is the same figure already shown in the order summary (rent + deposit where applicable). "Get my order link" describes a mechanism; the price describes an outcome.
- **Subtext names the payment methods** — `Pay via GCash or Maya · no account needed` — answering "how do I pay?" and "do I need an account?" before either becomes a reason to hesitate.
- **Messenger is demoted, never removed.** It becomes a text link directly beneath the primary button, always one tap away.
- **The disabled state is preserved.** Until both an account type and a duration are chosen the button stays visibly disabled and reads `Pick an account type and duration first`.

**Mobile sticky bar** mirrors the same label. A sticky bar cannot contain a text field, so tapping it scrolls the booking panel into view and focuses the name input.

**This does not cost the Messenger relationship.** The on-site flow already ends in Messenger — the order status page directs the customer there to send payment proof. The owner still receives the conversation; it now begins after the customer has chosen a game, seen the price and paid, rather than from "available po?".

### 2. Fix the silent order-form bounce

Submitting the order form without an account type and duration currently redirects back to the game page with `?order_error=1` and no visible message. On 2026-08-09 a real visitor hit this, returned to the game page, and retried before succeeding — the failure is confirmed, not theoretical.

Two layers:

- **Client:** the primary button stays disabled (existing behaviour, extended to the new hierarchy) until both selections exist.
- **Server:** when the page renders with `?order_error=1`, display a visible error near the booking panel rather than silently returning the visitor to an unchanged page.

### 3. Close the ledger loop: completed orders become customers

**This is a prerequisite for measuring anything, and a correctness fix in its own right.**

`POST /admin/orders/:ref/advance` currently sets `start_date` / `end_date` on the order document when it reaches `active` and stops there. No customer record is written. As a result a completed web rental is absent from:

- total earned, monthly revenue, and net profit
- unique renters and most-rented games
- the "Needs a reminder" expiry panel, so **web renters never receive expiry reminders**

It also forces the owner to retype every web order into Add Customer by hand.

When an order transitions to `active`, write a customer record matching the shape produced by the manual Add Customer route:

| Customer field | Source |
|---|---|
| `customer_name` | `order.fb_name` |
| `game_id` | `order.game_id` |
| `game_title` | `order.game_title` |
| `days` | `order.days` |
| `account_type` | `order.account_type` |
| `start_date` | `order.start_date` (Manila) |
| `end_date` | `order.end_date` (Manila) |
| `price` | `order.amount_due` — **never** including the deposit |
| `status` | `'renting'` |
| `notes` | `Web order {order.ref}` |
| `payments` | `[{ amount: order.amount_due, date: order.start_date, kind: 'rental' }]` |

The refundable ₱100 deposit is not revenue and must be excluded from `price` and `payments`, matching how the manual path records rental price only.

**Two different money figures appear in this spec and the difference is intentional.** The CTA button shows `amount_due + deposit_due` — everything the customer sends now. The customer record stores `amount_due` alone, because the deposit comes back and was never earnings. An implementer should not "reconcile" these; they answer different questions.

Game slot decrement follows the same rule the manual path uses for a `renting` status.

**Idempotency is required.** Store the created customer's id on the order document as `customer_id`. If `order.customer_id` is already set, skip creation. Without this, a double-submitted advance or a retried request produces duplicate customers and double-counts revenue.

### 4. Instrumentation

**"Started but didn't pay" panel** in the admin Orders tab, listing orders in `awaiting_payment` and `payment_rejected`, showing reference, Facebook name, game, account type, duration, amount, and age.

This serves two purposes. It is the **lead list** — the order form captures a Facebook name before payment, so an abandoned order is a named person the owner can look up and message, which matters at ~30 conversations a month. It is also the **measurement instrument**: without it, orders that did not complete are invisible and started-vs-completed cannot be computed.

**Weekly funnel readout** — a single line at the top of the Orders tab:

```
Last 7 days: 12 started · 8 completed · 4 abandoned · 6.2% of game-page visits
```

Game-page visits come from the existing visitor tracker, which already records every `/game/*` path.

## What deliberately does not change

- **Pricing and discounts.** People who make contact buy 83% of the time; price is not the objection.
- **The Messenger sales conversation.** An 83% close rate is the strongest asset in the business.
- **SEO and acquisition.** Traffic is already warm and arriving from the business's own Facebook page.
- **The homepage.** Home → Browse converts at 19% and may be improvable, but the reason is unknown and any change would be guesswork. Revisit once this change has been measured.

## How we will know if it worked

### Three measures, in priority order

**1. Order-start rate — orders created ÷ game-page visits, weekly.**
The primary metric. It measures the CTA change directly and is not distorted by traffic volume or seasonality. Both inputs already exist.

**2. Total monthly rentals.**
The measure that reflects money. Depends on change 3 being in place to be accurate.

**3. Messenger inquiry volume.**
The cannibalisation guardrail. Nothing tracks this today, so it requires the owner to keep a rough weekly tally for six weeks.

### The statistical caveat

Monthly renters across 2026 ran 24, 23, 36, 34, 22, 21, 31 — an average of 27.3 against a range of 21–36. That is roughly **±30% natural variation with no changes at all**, on an average of ₱16.4k/month.

**Monthly revenue therefore cannot confirm this change** unless the effect is very large. A move from 25 to 30 rentals is indistinguishable from an ordinary good month. Detecting a real effect through revenue alone would need roughly a 40% lift and six or more weeks.

This is precisely why measure 1 carries the weight: it responds within days and is not confounded by month-to-month noise.

**August 2026 is not a valid baseline** — it is tracking about 20% below July on a daily basis. Use the seven-month average of 27 renters and ₱16.4k/month.

### Decision rule — fixed in advance

| Outcome | Condition |
|---|---|
| **Keep** | Order-start rate ≥ 4% of game-page visits after two weeks, and total rentals not below 21 |
| **Iterate** | Order-start rate between 1% and 4% — the path works but checkout leaks; use the abandoned-orders panel to locate where |
| **Revert** | Messenger inquiries fall more than 30% **and** total rentals drop below 21 for a full month |

The rule is set before the data arrives so that the result is measured rather than rationalised. The CTA change is presentational and cheap to reverse.

## Out of scope

- Capturing the 643 visits to upcoming games (Marvel's Wolverine and similar). Real opportunity, but Facebook's messaging window makes reliable release-day notification impossible, so it needs its own design.
- Homepage → catalogue conversion.
- Any change to pricing, the Messenger script, acquisition, or the reminder templates.
- Backfilling historical orders into the customers ledger. Only orders activated after this change create customer records; PH-0003 and any earlier order stay as they are.
