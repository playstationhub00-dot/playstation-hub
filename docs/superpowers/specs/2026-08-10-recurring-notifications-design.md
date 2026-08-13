# Recurring Notifications Opt-In — Design

**Date:** 2026-08-10
**Status:** Approved (piece 4 of the re-engagement plan)

## The problem

Pieces 1-3 fixed and improved the tools this session already had: the Auto Blast is now compliant but can only reach whoever messaged in the last 24 hours (usually 0-2 people), and the copy-paste tool works on all 436 past customers but requires manual, one-at-a-time sending. Neither builds a list of people who can be legitimately, automatically messaged with a monthly promo going forward. Meta's Recurring Notifications feature is the mechanism for that: a user explicitly opts into a topic and frequency, and the business can send matching that cadence without the 24-hour window or a tag restriction.

## What changes

### Data model

A new lowdb collection, `notification_optins`, kept separate from `messenger_contacts` — opt-in status, frequency, and Meta's token payload are a different concern from "has this PSID ever messaged us," and mixing them would make both harder to reason about.

```js
{
  psid: string,
  opted_in_at: ISO date string,
  frequency: 'MONTHLY',
  topic: 'monthly_promo',
  // Meta's entire webhook payload for the opt-in event, not a hand-picked
  // subset of fields — see "What's uncertain" below for why.
  raw_optin_payload: object,
  status: 'active' | 'send_failed',
  last_sent_at: ISO date string | null
}
```

`messenger_contacts` gains one field: `notif_offered: boolean`, defaulting to unset/false. This is the only change to that existing collection.

### Bot flow — offering the opt-in

The offer is sent as a follow-up after the webhook handler's existing `handleMessage(senderId, text)` call resolves (server.js:3333), not injected into `handleMessage`'s internal branches. Before sending, the handler checks `messenger_contacts` for `notif_offered`; if already true, nothing is sent. If false, the offer is sent and `notif_offered` is set to true immediately — regardless of whether the person responds — so a non-answer doesn't cause the offer to repeat on their next message. This keeps every existing bot reply path in `handleMessage` completely untouched.

The offer message: a Generic Template with one Recurring-Notification-type button (best-effort payload shape, see below) labeled "🔔 Yes, notify me!" with frequency `MONTHLY`, plus a text quick reply "No thanks" with payload `NOTIF_DECLINE`. Declining only sets `notif_offered` (already true from the send) — no separate decline record, since there's nothing further to track once someone won't be asked again.

### Receiving the opt-in confirmation

The `/webhook` handler gains handling for the opt-in confirmation event and for the `NOTIF_DECLINE` postback. On a confirmed opt-in, a `notification_optins` row is created with `status: 'active'` and the entire raw event payload stored.

### What's uncertain, stated plainly

Meta's Recurring Notifications button/token payload shape has changed across platform versions, and this plan is built against my best current understanding of it rather than a verified-live API test. Concretely: the exact field names on the opt-in button (frequency field name, token field name) and the exact request shape for sending a message against a stored token may not match what Meta's API currently expects. To keep a wrong guess from being a silent data-loss bug: the code stores Meta's *entire* raw opt-in webhook payload rather than extracting and keeping only a few named fields, so if the field-name guess is wrong, the real data Meta sent is still recoverable from `raw_optin_payload` without needing anyone to re-opt-in. The send function logs every Graph API response (status + body) rather than assuming a 200 means success matched expectations. **This needs a real opt-in test against the live Page before the first real campaign send** — that's a manual verification step for after this ships, not something this plan can fully close in code.

### Sending a monthly update

A new admin route sends to every `notification_optins` row with `status: 'active'`, using the recurring-notification-token-based send shape (again: best-effort, logged, not asserted-correct). Per-contact failures are caught and logged individually — one bad token doesn't stop the batch — and the route returns `{ sent, failed, total }` matching the exact shape pieces 1 and 3 already established, so the admin UI result rendering is consistent across all three send mechanisms in this section.

### Admin UI

A new subsection inside the existing Message Blast accordion (views/admin.ejs), below Auto Blast and above the Manual Copy-Paste Tool — grouped there because it's a third messaging mechanism, not a separate feature area. Shows: opted-in contact count, a message textarea reusing the same `{promo}`/`{new_games}` server-side tokens from piece 3, a "Send to Opted-In Contacts" button, and a result readout in the same sent/failed/total format as Auto Blast. A visible note states that sends will fail with a logged error until Meta approves the Recurring Notifications permission for this Page, linking to the new doc below.

### New doc

`docs/messenger-recurring-notifications.md`: what Recurring Notifications is, how to request the permission via Meta's App Review dashboard, and the same payload-shape caveat from above — so whoever tests the first real opt-in (owner or a future session) knows exactly what to verify.

## What deliberately does not change

- Every existing branch inside `handleMessage` — the offer is bolted on after the fact, not woven into the bot's actual conversation logic.
- The Auto Blast (piece 1) and Manual Copy-Paste (piece 3) sections — this is a third, additive section, not a replacement for either.
- `messenger_contacts`' existing fields and its role in the 24-hour Auto Blast window — untouched beyond the one new `notif_offered` field.

## Out of scope

- Any UI for the customer to change their opt-in frequency or unsubscribe from within the bot conversation beyond the initial "No thanks" — Meta's own Messenger settings already let a user block/mute a page, and building a custom unsubscribe flow is not needed for a first version.
- Automatically scheduling the monthly send — this plan builds a manual "Send to Opted-In Contacts" button the owner clicks when ready, not a cron job. Automating the send cadence is a separate, later decision once the manual flow is proven to actually deliver.
- Verifying the exact Meta API payload shape against a live sandbox — explicitly called out above as a manual step after this ships, not something resolved in this plan.
