# Rental orders v1 — QR-primary self-service flow

Date: 2026-08-08
Status: Approved

## Problem

Rentals are currently coordinated entirely through Facebook Messenger free text.
The owner is the only record of what was agreed, so:

- A customer can pay without the owner noticing, and sit waiting with no signal
  that anything is wrong.
- Nothing tracks what a customer actually paid, so a later game swap has no
  reliable basis for calculating a top-up.
- Returns and the ₱100 refundable deposit have no audit trail.
- The customer has no way to check their own status without asking.

Volume is under 20 rentals/month. This is therefore a **growth investment**
(removing friction that suppresses demand and making the business look
legitimate), not an efficiency one — it saves roughly 8–10 hours/month at
current volume. Success is measured in rentals going up, not hours going down.

## Decisions taken before this design

Three constraints were settled during brainstorming and shape everything below:

1. **All PSN accounts will have 2FA enabled.** The owner chose account security
   over automation. This means no rental can complete unattended — every
   sign-in needs the owner. Automated credential release is therefore out of
   scope permanently, not deferred.
2. **QR-primary sign-in.** The customer's console displays a sign-in QR, the
   customer uploads it, the owner scans it. The customer never learns the
   account password. This is the most secure option available and is what the
   owner already does manually.
3. **Payment is verified by hand.** Since the owner is already in the loop for
   the QR scan, automated payment confirmation buys nothing in v1. The GCash
   webhook capability is unconfirmed and is deliberately not designed around.

## Approach

Model each rental as an **order** with an explicit state machine. The order is
created on the website, always — Facebook is never an entry point, only an
alternative channel for submitting proof. The customer tracks their order via a
reference-code link with no login. The owner works a single queue filtered to
the states that need them.

Rejected: customer accounts with passwords (a reference link delivers nearly
the same value with no auth surface, no password reset flow, and no stored
credentials to leak — accounts can come later once the flow is proven), and
GCash webhook auto-confirmation (unconfirmed capability, and redundant while
the owner must scan the QR anyway).

## Order lifecycle

Eight states. Each has exactly one party who acts next, which is what makes the
owner queue trustworthy — it is precisely the set of orders in an owner state.

| State | Waiting on | What happens |
|---|---|---|
| `awaiting_payment` | Customer | Order created, amount due shown |
| `verifying_payment` | **Owner** | Proof submitted, owner confirms or rejects |
| `awaiting_qr` | Customer | Payment good; customer prompted for a fresh QR |
| `qr_pending` | **Owner** | QR uploaded, countdown running |
| `active` | — | Signed in, rental running until end date |
| `awaiting_return` | Customer | End date passed, return proof needed |
| `verifying_return` | **Owner** | Return proof submitted, owner confirms |
| `closed` | — | Complete; deposit refund recorded as owed if applicable |

Terminal exits: `cancelled` (owner or customer abandons before `active`) and
`payment_rejected` (owner rejects proof; returns to `awaiting_payment` with a
reason shown to the customer).

### The QR retry loop

`qr_pending` carries a **10-minute countdown**, visible to both parties. PS5
sign-in QR codes expire in minutes, so a QR submitted at 2am and scanned at 8am
is worthless. When the countdown lapses the order returns to `awaiting_qr` and
the customer's status page asks for a fresh upload. The customer may re-upload
without limit.

This is the core mechanism of the design: it means neither party has to be
awake at the same time for the *order* to survive — only for the *scan* to
succeed, and a failed scan costs nothing but a re-upload.

### Owner presence signal

The admin carries an **"I'm online now"** toggle. While on, every status page
in `awaiting_qr` shows a live banner reading "Owner is online — send your QR
now." This is what makes the 10-minute window practically catchable rather than
a coin flip, and it costs one boolean in site settings.

## Data model

### New `orders` collection — real MongoDB documents, not the JSON blob

Every other collection stays exactly where it is. Orders are the sole
exception, and deliberately so: they are money-adjacent and written by
customers, so they cannot tolerate the existing storage model.

The current persistence layer (`server.js:381-402`) serialises the **entire**
database into a single MongoDB document (`{_id:'db', data: <whole state>}`)
and replaces it wholesale on every write, while lowdb rewrites all of
`games.json` in parallel. Two concurrent writers means one silently overwrites
the other. This is not theoretical — during the weekly/monthly migration
session, seven `release_date` values that had been explicitly cleared and
verified blank reappeared with values neither editor had set, which is exactly
this failure mode from two concurrent admin sessions.

Games, price categories, PS Plus data, and site settings keep the current
lowdb-plus-blob-sync storage, since only the owner writes them and the churn is
low. This keeps the migration contained to one new module rather than a rewrite.

### Order document fields

| Field | Purpose |
|---|---|
| `ref` | Public reference code, format `PH-NNNN` (e.g. `PH-4821`) |
| `state` | One of the eight states above, plus terminal exits |
| `game_id`, `game_title` | What was rented (title denormalised so history survives a game deletion) |
| `account_type` | `nt` / `tr` / `ps4` |
| `days` | 7 or 30 |
| `price_tier_name` | Tier name at time of order, e.g. "New Games" |
| `price_snapshot` | The tier's full price set at time of order — frozen |
| `amount_due` | Rent after promo discount |
| `deposit_due` | ₱100 for `tr`/`ps4`, ₱0 for `nt` (from `site_settings.promo.deposit`) |
| `fb_name` | Customer's Facebook name — **required** |
| `payment_proof` | Uploaded file path, or `null` when proof came via Messenger |
| `payment_channel` | `upload` or `messenger` |
| `qr_image`, `qr_expires_at` | Current QR upload and its deadline |
| `return_proof` | Uploaded file path, or `null` when confirmed via Messenger |
| `deposit_refunded` | Boolean — tracks the debt until the owner marks it paid |
| `start_date`, `end_date` | Rental window, set when the order enters `active` |
| `created_at`, and a `state_history[]` of `{state, at}` | Audit trail |

`price_snapshot` is the requirement to "save the original rent so we know if
they need additional payment if they change account." A tier's prices may
change after an order is placed; freezing them means a later swap compares
against what the customer actually paid. The existing
`computeSwapReferencePrice()` (`server.js:645`) already performs this top-up
calculation for admin-side swaps and consumes the snapshot directly.

## Customer-facing surfaces

Everything lives at `/order/PH-4821`. No login, no password, no account.

- **Status** — current state in plain language, and what is needed from them.
- **Payment step** — two buttons, Messenger prominent:
  - *Send proof on Messenger* — opens `m.me/PlaystationHub00` prefilled with
    the reference code and order details, matching the existing prefilled-link
    pattern already used across the site (`views/game-detail.ejs` and six other
    views).
  - *Upload receipt here* — file upload attached to the order with a timestamp.
- **QR step** — upload control plus the live countdown, and the "Owner is
  online" banner when the toggle is on. **Website-only**: the countdown is the
  entire mechanism, and a QR sitting in a Messenger thread has no expiry
  tracking.
- **Return step** — upload control; may also be satisfied by the owner ticking
  it off after receiving proof via Messenger.

The reference code is displayed prominently so the customer can quote it in
chat.

## Owner-facing surface

One queue in admin, filtered to the three owner states (`verifying_payment`,
`qr_pending`, `verifying_return`), sorted by urgency with live QR countdowns
first. Each row carries everything needed to act plus a one-tap advance.

A separate **outstanding refunds** list shows closed Trophy and PS4 Primary
orders where `deposit_refunded` is false, and persists until the owner marks
each one sent. The system tracks the debt; the owner still sends the money.

The "I'm online now" toggle sits at the top of the queue.

## Out of scope for v1

- Customer accounts, passwords, and login — replaced by the reference link.
- GCash webhook / automated payment confirmation — capability unconfirmed, and
  redundant while the owner must scan the QR regardless.
- Automated credential release — impossible by the 2FA decision, permanently.
- Account and game swaps — these stay manual in admin exactly as they work
  today, per the owner's explicit instruction that v1 covers new rentals only.
- Migrating games, price tiers, PS Plus data, or settings off lowdb.
- Notifications beyond the on-page status and the owner's queue (no email, no
  SMS, no push).

## Rollout

Orders are additive — the existing Messenger flow and the `customers`
collection continue working untouched, so nothing breaks if the order flow sees
no traffic on day one. The "Rent" CTA on game pages gains an order-creating
path alongside the current direct-to-Messenger link, allowing both to run in
parallel until the order flow is proven.
