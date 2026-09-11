# Late Order Fallback — Design

**Date:** 2026-09-12
**Status:** Approved for planning

## The problem

A customer pays on the website. The owner is asleep, away, or their phone is
dead. Nothing in the system notices, nothing tells the customer, and the
customer has no way out.

Three specific failures exist in the code today:

**1. The "we're online" badge is a promise nobody is keeping.** `owner_online`
is a manual toggle (`server.js:3532`, read at `server.js:2347`). The order page
renders *"🟢 We're online right now — send your code and we'll sign you in
straight away"* (`views/order-status.ejs:331`). An owner who falls asleep
without flipping it keeps making that promise to every paying customer all
night.

**2. The sign-in loop has no exit.** A customer sends a code, the order enters
`qr_pending` with a ten-minute window, `expireStaleQrs()` bounces it back to
`awaiting_qr`, and the page asks for a fresh code. Nothing counts the
repetitions. A customer who has already paid can grind that loop all night and
never once be told it is not going to happen tonight.

**3. Nothing ages, and nothing fires without the owner.** The Telegram alert
goes out once, when the code arrives (`server.js:3119`, `server.js:3142`). The
notification bell ranks it critical, but only when the owner opens the panel.
There is no refund path for the customer at all: `/admin/orders/:ref/refunded`
only marks a refund the owner already made by hand.

There is also a prerequisite problem. The only contact field collected is
`fb_name`, a Facebook display name (`server.js:1937`) — no email, no phone —
and there is no order lookup anywhere. The URL is the credential. A customer
who closes their browser and loses the link cannot get back to their order at
all. Any fallback panel built on the order page is invisible to them until
that is fixed.

## Goals

- A paid customer always knows where they stand, without the owner acting.
- A paid customer who has waited too long can get their money back on their own.
- The owner learns about it on a channel that does not require them to be
  looking at the admin panel.
- A customer can return to their order from any device.
- The site stops promising service it cannot deliver.

## Non-goals

- **No automatic money movement.** The refund button files the debt; the owner
  moves the money. An auto-refund on a timer is one bug away from refunding a
  customer who is already playing, and this project never handles payment
  credentials.
- **No new contact field.** No email or phone collection, no sending
  infrastructure. Deferred deliberately — see Out of scope.
- **No web push.** A separate, already-written spec covers it
  (`docs/superpowers/specs/2026-09-05-customer-web-push-design.md`).

## Decisions

| Question | Decision |
|---|---|
| What does a waiting customer get? | A choice: keep waiting, or cancel and be refunded. |
| How are hours defined? | A default open/close, plus a per-day override including "closed today". |
| What happens on the refund click? | The order is cancelled immediately and the debt appears in the bell. |
| How does a customer get back in? | Session cookie list, plus a typeable order code for any device. |
| Refund timing promise | "We'll start it within 24 hours", plus an honest per-method landing time. |
| Late threshold | 45 open minutes. |
| Hard cap | 12 real hours, regardless of hours. |

## Architecture

One new pure module does the time arithmetic. Everything else is fields on the
order, routes, and view states. This follows the existing shape of the codebase:
pure logic in `lib/*.js` with plain-`assert` tests in `scripts/test-*.js`, and
side effects in `server.js`.

### `lib/service-window.js` (new, pure)

No network, no database, no environment reads. The caller passes the config in.

Config, stored at `site_settings.service_hours`:

```js
{
  default:   { open: '14:00', close: '02:00' },
  overrides: {
    '2026-09-12': { open: '16:00', close: '23:00' },
    '2026-09-13': { closed: true }
  },
  late_after_open_minutes: 45,
  hard_cap_hours: 12
}
```

Times are Manila (UTC+8), which has no DST. When `close <= open` the window
spans midnight: it runs from `open` on that day to `close` the next day.

Exported functions:

- `hoursFor(dateStr, config)` → `{ open, close, closed }`. An override for that
  date wins outright; otherwise the default applies.
- `isOpenAt(date, config)` → boolean.
- `nextOpenAt(date, config)` → `Date | null`. Searches forward up to 14 days;
  returns `null` if every day in that span is closed.
- `openMinutesBetween(from, to, config)` → number. The load-bearing function:
  minutes between two instants that fall inside open hours.
- `waitStage({ waitingSince, now, config })` →
  `{ stage, openMinutes, realHours, nextOpen }` where `stage` is one of
  `'on_time' | 'closed_waiting' | 'late'`.

Stage rules, evaluated in this order:

1. `late` if `openMinutes >= late_after_open_minutes` **or**
   `realHours >= hard_cap_hours`.
2. `closed_waiting` if not late and `!isOpenAt(now, config)`.
3. `on_time` otherwise.

**Failure mode: fail open.** A missing or malformed config is treated as open
24/7. The consequence is that waits are counted in real time and the feature
still fires — honest, if slightly eager. The alternative (treating a broken
config as permanently closed) would silently disable the whole feature, which
is the failure this project exists to remove. The config is seeded with a
default on first read, so the fallback path should never be reached in practice.

### `lib/claim-code.js` (new, pure)

Generates and normalizes the typeable order code.

Alphabet is Crockford Base32: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — 32
characters, excluding `I`, `L`, `O` and `U`. Codes are 8 characters, displayed
as two groups of four (`K7M4-QP9X`). That is 32^8 ≈ 1.1 trillion combinations.

The strength matters on its own merits because rate limiting is weak here:
carrier-grade NAT means many unrelated Philippine mobile users share one public
IP, which the codebase already notes at `server.js:96`. The code must not depend
on a per-IP limit that cannot tell customers apart.

- `generate()` → an 8-character code. Uses `crypto.randomInt` per character to
  avoid the modulo bias `randomBytes(n) % 32` would introduce.
- `normalize(raw)` → uppercase, strip everything outside `[A-Z0-9]`, then apply
  Crockford's decode mapping: `O` → `0`, `I` → `1`, `L` → `1`. Returns `''` for
  non-string, non-number input, matching how `lib/signin-code.js:28` guards
  against `String({})` producing a plausible-looking run of characters.
- `isValid(raw)` → `normalize(raw).length === 8` and every character is in the
  alphabet.

### New order fields

| Field | Type | Set when | Cleared when |
|---|---|---|---|
| `owner_wait_since` | ISO string | First entry into `verifying_payment` or `qr_pending`, only if not already set | On reaching `active`, `reserved`, `closed`, `cancelled`, or `payment_rejected` |
| `owner_wait_alerted` | boolean | The escalation Telegram fired | Same as above |
| `wait_ack_until` | ISO string | Customer clicks "I'll keep waiting" (now + 2h) | Same as above |
| `claim_code` | string(8) | Lazily, first time the order is viewed | Never |
| `refund_requested_at` | ISO string | Customer clicks cancel-and-refund | Never |
| `refund_settled` | boolean | Owner marks the refund sent | Never |

**`owner_wait_since` is sticky, and that is the entire point.** Measured from
"entered current state", an order caught in the `qr_pending` → `awaiting_qr`
expiry loop would restart its clock every ten minutes and could never become
late — the feature would silently never fire. It is stamped once, when the
owner first becomes the blocker, and cleared only when the owner delivers.
`expireStaleQrs()` must not touch it. This is asserted by test, not left to
convention.

Note it starts when the *owner* becomes the blocker, not at payment. An order
sitting in `awaiting_qr` with no code sent is waiting on the customer, and the
clock has not started. Once the clock is running, it keeps running through
later `awaiting_qr` bounces, because the field is already set.

`refund_settled` is deliberately separate from the existing `deposit_refunded`
(`lib/orders.js:320`). A returned deposit and a cancelled-order refund are two
different debts with two different lists; sharing a field would make one clear
the other.

### Routes

| Route | Purpose |
|---|---|
| `GET /find` | The order-code lookup form. |
| `POST /find` | Code → redirect to `/order/:ref?k=<url_key>`. Generic failure. |
| `GET /my-orders` | Orders matching the caller's `ph_sid` cookie. |
| `POST /order/:ref/cancel-refund` | Cancel and record the refund debt. |
| `POST /order/:ref/still-waiting` | Set `wait_ack_until` to now + 2h. |
| `POST /admin/orders/:ref/refund-settled` | Owner marks the refund sent. |

`POST /order/:ref/cancel-refund` requires the matching `url_key`, exactly as the
existing order routes do. It then **re-derives the stage server-side** and
refuses unless the order is still in `verifying_payment`, `qr_pending` or
`awaiting_qr` *and* `waitStage(...) === 'late'`. The client is never trusted: if
the owner signed the customer in thirty seconds before the click landed, the
POST fails harmlessly rather than cancelling a live rental. On success it
transitions to `cancelled` — an edge the state machine already permits from all
three states (`lib/orders.js:32`, `:34`, `:35`) — and sets `refund_requested_at`.

`POST /find` rate limiting: a per-session counter allowing 10 failed attempts
per hour, keyed on `ph_sid` rather than IP for the CGNAT reason above. In-memory
is acceptable; it resets on deploy, and the code's own strength is the real
defence. A wrong code returns a flat "we couldn't find that code" — never
anything that distinguishes "no such code" from "code exists but something else
is wrong", and never a redirect pattern that differs from the not-found case.

`orders.listBySession(sessionId, limit)` is the one new query: `{ session_id }`,
newest first, capped at 20.

### Customer-facing states

The `awaiting_qr` / `qr_pending` region of `views/order-status.ejs` gains three
presentations driven by `waitStage`.

**`closed_waiting`** — heading "We open at 2:00 pm", body explaining there is
nothing to send yet because a sign-in code only lasts about ten minutes and
would expire before anyone reached it. **The code form is collapsed behind a
"Send it anyway" disclosure rather than being the default action.** This is the
real fix for the endless loop: today the page actively invites a code that is
guaranteed to die, saying *"You can still send it — if it expires before we get
to it, we'll ask for a fresh one"* (`views/order-status.ejs:333`). No refund
button in this state.

**`on_time`** — unchanged from today's behaviour.

**`late`** — heading "We haven't got to you yet", body naming the amount paid
and accepting fault, then two actions:

- *I'll keep waiting* → `POST /order/:ref/still-waiting`, quiets the panel for
  two hours and flags the order in the bell as still having someone waiting.
  This distinguishes a late order worth sprinting for from one whose customer
  has gone to bed.
- *Cancel and refund ₱N* → `POST /order/:ref/cancel-refund`.

Under the refund button, two sentences. The first is the owner's promise and is
fixed: **"We'll start your refund within 24 hours."** The second is the landing
time and varies by `payment_method` / `payment_channel`, because the owner does
not control it:

| Payment | Landing sentence |
|---|---|
| `gcash`, `maya`, `bank` (manual) | "It goes straight back to your GCash / Maya / bank once we send it." |
| `paypal` | "PayPal usually returns it within a few days." |
| `paymongo` (gateway) | "Your bank may take up to a week to show it." |

A promise of a fixed total turnaround would be false for gateway and PayPal
payments, where refunds commonly take days regardless of how fast the owner
acts. Splitting the promise keeps the controllable half firm and the
uncontrollable half honest.

While `wait_ack_until` is in the future, the late panel is suppressed: the page
renders the `closed_waiting` presentation if the shop is currently closed, and
the `on_time` presentation otherwise. The stage itself is still `late`
internally, so the bell and the Telegram guard are unaffected — only the
customer's panel is quieted.

### Getting back in

Three routes back, in increasing order of effort:

1. **The link they already have.** Unchanged.
2. **`/my-orders`.** Every order already records `session_id` (`server.js:1981`)
   from the `ph_sid` cookie, which is httpOnly, 30 days, and rolling — re-issued
   with a fresh expiry on every visit (`server.js:100`) — and set by global
   middleware on every public page view (`server.js:453`). No login, no typing.
   Covers the same-device case, which is most of them.
3. **The order code at `/find`.** Any device. Shown on the order page with a
   copy button, and readable aloud over Messenger when a customer says they lost
   their link — a support path that does not exist today.

The order page currently tells customers *"this page stays live, come back to it
any time"* (`views/order-status.ejs:311`) while giving them no way to come back.
That line gains a real destination.

**Naming risk.** The order page will now show two different codes: the sign-in
code read off the customer's console (4–16 characters, whatever PlayStation
generates — `lib/signin-code.js:17`) and our order code. They get distinct
names, distinct positions on the page, and `/find` states outright which one it
wants. Our code always looks the same — eight characters, one dash — which
helps distinguish it on sight.

The ref cannot be the lookup key. Refs are strictly sequential — `PH-0001`,
`PH-0002` (`lib/orders.js:124`) — and the codebase already says why at
`lib/orders.js:140`. If typing a ref opened an order, anyone could enumerate
every order on the site, read names, games and amounts, and click "cancel and
refund" on strangers' rentals. That steals nothing (refunds return to whoever
paid) but it would let anyone kill customers' rentals from a browser.

### Owner-facing changes

**Notification bell.** Rather than adding a second row for an order that
already has one — which would double every late order in the list — the
existing `qr_pending` and `verifying_payment` rows are *upgraded*.
`lib/notifications.js` gains a `lateRefs` input mapping ref → minutes late; a
matching row appends "· late 1h 20m" to its subtitle and sorts above its
non-late peers. Rows for customers who clicked "I'll keep waiting" say so.

One genuinely new kind, `cancel_refund_owed`, for orders cancelled by the
customer with `refund_settled` falsy. The `RANK` map becomes:

```
webhook_broken: 0
unhappy_customer: 1
cancel_refund_owed: 2     // new: money owed to someone who already gave up
qr_pending: 3
verifying_payment: 4
expiry_overdue: 5
verifying_return: 10      // unchanged from here down
```

Renumbering preserves every existing relative ordering, so the current
assertions in `scripts/test-notifications.js` continue to hold.

**Telegram.** A new alert kind `late` is added to `ALERT_KINDS`
(`lib/telegram.js:130`), which is opt-out by default like the others. It fires
once per order, guarded by `owner_wait_alerted`, when a customer loads their
order page and the stage has become `late`. Firing on customer page load is
deliberate: it means the owner is pinged when someone is actively sitting there
waiting, which is exactly when it is worth waking up for.

**Admin settings.** A hours panel: default open and close, plus "today is
different" (open/close) and "closed today". If the owner forgets to set today's
hours, the default applies — forgetting is safe, which is the opposite of how
`owner_online` behaves today.

**The green badge.** `ownerOnline` becomes the conjunction of three things: the
toggle is on, *and* now is inside today's hours, *and* the admin panel has seen
the owner within the last two hours. Owner presence is recorded in a new
`site_settings.owner_seen_at`, written from the authenticated admin middleware
and **throttled to at most one write every five minutes** — lowdb rewrites the
entire JSON file on every write, so an unthrottled write per admin request would
be a real cost.

## Testing

New files, following the existing plain-`assert` convention:

- `scripts/test-service-window.js` — `hoursFor` override precedence and
  "closed today"; `isOpenAt` inside, outside, and exactly on the boundaries;
  midnight-spanning windows; `nextOpenAt` across a closed day and returning
  `null` when every day is closed; `openMinutesBetween` returning zero for a
  span entirely outside hours, the correct partial for a span straddling
  opening time, and the sum across multiple days; all three `waitStage`
  outcomes; the hard cap firing while closed; fail-open on a missing config.
- `scripts/test-claim-code.js` — generated codes are 8 characters drawn only
  from the alphabet; `normalize` maps `O`→`0`, `I`→`1`, `L`→`1`, strips dashes
  and spaces, uppercases; `isValid` rejects empty strings, wrong lengths,
  objects, and characters outside the alphabet.

Extended:

- `scripts/test-notifications.js` — a late ref upgrades its existing row rather
  than adding a second one; an acknowledged wait is labelled; the new
  `cancel_refund_owed` row appears and ranks correctly; existing ordering
  assertions still pass under the renumbered `RANK`.
- `scripts/test-orders.js` — **`owner_wait_since` survives `expireStaleQrs()`.**
  This is the single most important test in the project: without it the feature
  compiles, ships, and never fires. Also: it is stamped once and not overwritten
  on a second entry into an owner-blocked state, and it is cleared on reaching
  `active`.

## Out of scope

- **Contact collection and outbound messaging.** Email or mobile at checkout
  would let the site reach a customer who has closed the tab, and would work
  across devices without a code. It needs a sending channel — an email service
  wired up, or SMS which costs per message in the Philippines — and it puts one
  more field between a customer and paying. Its own project.
- **Web push.** Reaches a customer with no contact details at all, but only if
  they grant permission. Spec already exists at
  `docs/superpowers/specs/2026-09-05-customer-web-push-design.md`.
- **Automated refunds through the PayMongo or PayPal APIs.** The owner moves
  the money.
