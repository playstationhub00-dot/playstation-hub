# Recurring Notifications — Setup & Verification

**Date:** 2026-08-10
**Type:** Reference guide for the feature built in this session's piece 4.

## What this is

Meta's Recurring Notifications lets a Messenger user opt into a specific topic and frequency (this bot uses "monthly game drops + promos," frequency MONTHLY) so the Page can message them on that cadence without the 24-hour standard messaging window or a message tag. The bot now offers this once, as a follow-up, after any reply to a new contact.

## Before this will actually send anything

This Page needs Meta's approval for messaging permissions covering Recurring Notifications, on top of whatever basic Messenger permission already lets the bot reply to messages today. In Meta's App Dashboard (developers.facebook.com, your app → App Review → Permissions and Features), look for the messaging-related permission that covers this feature and request it if not already granted. This typically requires:

- Business verification on the Meta Business Account tied to this app (if not already done for the existing bot).
- A completed App Review submission showing how the feature is used (screen recording of the opt-in flow works well).

This can take anywhere from a few days to a few weeks, and approval isn't guaranteed on the first submission. Until it's approved, `/admin/notifications/send` will log a non-200 response from Meta for each attempted send and mark those opt-ins `send_failed` — check the Railway logs for `[notif send]` lines to see the actual rejection reason Meta returns.

## The payload-shape caveat

The button payload sent in `sendNotificationOptinOffer` (server.js) and the send request in `/admin/notifications/send` are written against the current understanding of Meta's Messenger Platform API for this feature — not verified against a live test at the time this was built. Meta has changed the shape of this feature across platform versions before. If a real opt-in test shows Meta rejecting the button (check `[notif optin]` logs) or the send request failing with a schema-related error (not a permission error) in `[notif send]` logs, the field names in those two functions are the first thing to check against Meta's current Send API docs for "Notification Messages" / "Recurring Notifications."

Because `notification_optins.raw_optin_payload` stores Meta's entire opt-in event object, even if the button/send code needs correcting, no real opt-in data collected before the fix is lost — the raw payload is still there to re-derive the correct token/field from.

## Manual verification steps (after this deploys)

1. Message the Page's Facebook account from a personal test account.
2. Confirm the bot's normal reply arrives first, then the notification opt-in offer arrives ~1.5s later.
3. Tap "Yes, notify me!" and check Railway logs for a `[notif optin] confirmed for psid=...` line.
4. In `/admin` → Customers tab → Message Blast → Recurring Notifications section, confirm the opted-in count reads at least 1.
5. Send a test message via "Send to Opted-In Contacts" and check the `[notif send]` log line for the actual Graph API status code and body — a permission-related rejection here is expected until App Review clears; a schema/field-name error means the payload shape needs fixing per the caveat above.
