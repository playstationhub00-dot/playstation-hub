# Customer Notifications by Web Push — Design

**Goal:** Tell a customer when a slot opens on a game they are waiting for, when
a new game lands, or when a promo starts — without paying a platform and without
depending on a channel Meta can switch off.

**Status:** drafted 2026-09-05. Blocked only on a VAPID keypair existing (see
Configuration); everything else can be built and tested first.

## Why not Messenger

The site already has a monthly Messenger notification system: a customer taps
"Yes, notify me!", the opt-in is stored in `notification_optins`, and
`/admin/notifications/send` broadcasts to them.

**It no longer works, and cannot be fixed.**

- Meta deprecated Recurring Notifications on 12 January 2026 and switched it off
  on 10 February 2026, everywhere except AU, EU, JP, KR and the UK. The
  Philippines is not on that list.
- The send path uses `tag: 'CONFIRMED_EVENT_UPDATE'`. Since 27 April 2026 that
  tag — along with `ACCOUNT_UPDATE` and `POST_PURCHASE_UPDATE` — returns error
  code 100 on every API request.

The official replacement, Marketing Messages, *is* available in the Philippines
but requires App Review, is restricted to tech providers rather than direct
businesses, needs an ad account with a card on file, and charges per message.
That means paying a provider such as ManyChat, which the owner has ruled out.

What remains on Messenger is the 24-hour window, which `/admin/blast` already
uses. That is useless for someone who joined a waitlist three weeks ago — which
is precisely the person this feature exists to reach.

So the channel changes. Web push costs nothing, needs no approval, and no
platform can withdraw it.

## What this can and cannot reach

Stated plainly, because the limits are real and not fixable by better code:

- **Android Chrome works normally.** The Philippines is Android-dominant, so
  this is most of the traffic.
- **iPhone requires the customer to add the site to their home screen first**
  (iOS 16.4+). Many will not. This is Apple's rule, not a build choice.
- **It only reaches people who visit the site.** Someone who only ever talks to
  the business on Messenger stays unreachable.
- **A refusal is close to permanent.** Browsers remember a blocked prompt and
  give no reliable way to ask again.

This is therefore additive. It does not replace messaging people by hand, and
the waitlist's existing "📋 Copy" button stays exactly as it is.

## Architecture

| Piece | Responsibility |
|---|---|
| `public/sw.js` | Service worker: handles `push` and `notificationclick` |
| `public/site.webmanifest` | Customer-facing manifest, so iOS can install to home screen |
| `lib/push.js` | Pure: subscription validation, audience selection, payload building |
| `scripts/test-push.js` | Plain-assert tests, per project convention |
| `server.js` | VAPID config, subscribe/unsubscribe routes, the send helper |
| `views/` | Permission prompts, and the admin send controls |

The existing `manifest.json` is the **admin** PWA (`start_url: /admin/app`) and
is left alone; the customer site gets its own.

`web-push` is added as a dependency — it handles VAPID signing and the payload
encryption, neither of which is worth hand-rolling.

## Storage

Subscriptions live in lowdb as `push_subscriptions`, following the
`notification_optins` precedent this replaces: same shape of data, same volume,
same Railway volume.

Each record stores the browser's `endpoint` (the stable identity — dedupe is on
this, not on a session), the `keys` needed to encrypt to it, `session_id`, an
`order_ref` when the subscription was created from an order page, and
timestamps.

## Asking for permission

**Never on page load.** Browsers penalise it, customers reflexively block, and a
block is close to permanent. The prompt appears only after an action that makes
the value obvious:

- **Immediately after joining Fall in Line** — the strongest moment on the site.
  They have just told the business exactly what they want and are waiting for
  it; "we'll ping you the moment a slot opens" is the reason they are there.
- **On the order page once paid** — for sign-in and rental updates.
- **A quiet bell control in the footer** — for someone browsing who wants new
  games and promos, with no prompt until they tap it.

## Targeting

- **Slot opened** — only subscriptions whose `order_ref` is currently queued for
  that game *and* account type. The ref is attached at subscribe time rather
  than resolved through a session cookie, so it still matches months later.
- **New game** and **promo** — every subscription.

## The slot-opened trigger is manual

A **"🔔 Notify everyone waiting"** button on the waitlist section, beside the
existing Copy and Priority-paid actions.

Automatic firing on a state change was considered and rejected. A cancelled or
closed order does not reliably mean a slot is free — the account may already be
reassigned — and a push cannot be unsent. A false alarm sends every waiting
customer to a slot that is not there, which costs more trust than a few minutes
of delay. The owner frees the slot and therefore knows; the button asks them to
say so.

Automation can come later, once the copy and the audience have been proven by
hand.

## Removing the dead Messenger feature

Left in place, it is a button that silently fails and dead code that will
confuse the next change. Removed in full:

- the `event.optin` handling and the `NOTIF_DECLINE` quick-reply branch in the
  webhook
- `sendNotificationOptinOffer`, `markNotifOffered`, `getActiveOptins`
- the offer trigger that fires after a bot reply
- `POST /admin/notifications/send` and the optins listing route
- the Notifications panel in `views/partials/admin/messaging.ejs`
- `notification_optins` from the lowdb defaults

**`messenger_contacts` and `/admin/blast` stay.** Contacts are populated
independently on every inbound message, so removing the opt-in code does not
touch the blast audience. Verified before writing this.

Stored `notification_optins` rows are left on disk rather than deleted — they
are a record of who once asked to hear from the business, and no longer reading
them costs nothing.

## Configuration

Three environment variables: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` (a `mailto:` address). With any missing, the feature is simply
absent: no subscribe prompt, no send attempt, no errors — exactly as the
Telegram alerts behave without their token.

The keypair is generated by the owner with
`npx web-push generate-vapid-keys` and pasted straight into Railway. **The
private key never passes through the assistant**, matching how the Telegram bot
token and PayMongo keys were handled.

## Testing

`scripts/test-push.js`, plain `assert`, run with `node`.

Cases: a well-formed subscription is accepted and a malformed one rejected;
dedupe is by endpoint, so re-subscribing the same browser updates rather than
duplicates; audience selection returns only the refs queued for a given game and
account type; broadcast returns every subscription; an empty subscription list
never throws; payload building truncates a long game title rather than emitting
an oversized push; and a missing VAPID config reports "not configured" rather
than attempting a send.

## Not building

- **Automatic slot detection.** Deferred above, deliberately.
- **Paying for Marketing Messages or a provider.** Ruled out by the owner.
- **Email or SMS.** No addresses or numbers are collected today, and SMS costs
  per message.
- **Reaching customers who never visit the site.** Web push cannot, and no free
  channel can. The manual Messenger reply remains the tool for those people.
