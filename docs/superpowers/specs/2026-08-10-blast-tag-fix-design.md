# Messenger Blast Tag Fix — Design

**Date:** 2026-08-10
**Status:** Approved

## The problem

`/admin/blast` (server.js:3762-3808) sends to every saved `messenger_contacts` PSID using `messaging_type: 'MESSAGE_TAG'` with `tag: 'HUMAN_AGENT'`. Meta's message-tag policy explicitly excludes promotional content from tagged sends — `HUMAN_AGENT` exists for a human agent replying to an inquiry within 7 days, not for pushing a monthly promo. Sending promotional copy under this tag risks losing page messaging permission, which would break every `m.me` CTA on the site.

Separately, `/admin/blast/contacts` (server.js:3757-3760) reports a bare total contact count, which reads as "how many people this reaches" when the true reachable number — anyone Messenger's 24-hour standard messaging window still covers — is usually much smaller and typically zero for a promo blast run days after the last inbound message.

## What changes

**Send type:** `/admin/blast` switches from `messaging_type: 'MESSAGE_TAG'` + `tag: 'HUMAN_AGENT'` to `messaging_type: 'UPDATE'`, with no `tag` field. `UPDATE` is Meta's standard type for a business-initiated message inside the 24-hour window — it fits an owner-sent promo, unlike `RESPONSE` (replying to a specific message) or any tag (all reserved for narrow non-promotional cases).

**Recipient filter:** the route only sends to contacts whose `last_seen` is within 24 hours of the request, computed server-side from the existing timestamp (`server.js:3331` already updates `last_seen` on every inbound message — no new tracking needed). Contacts outside the window are skipped and counted separately, not attempted and left to fail.

**Contact count endpoint:** `/admin/blast/contacts` returns both `reachable` (last_seen within 24h) and `total` (all-time saved contacts), instead of one combined number.

**Admin UI:** the badge near the Auto Blast button reads `<reachable> reachable now · <total> total contacts`, with a one-line note that Messenger only allows promotional messages within 24 hours of the contact's last message — so the small number reads as the platform's rule, not a bug.

**Empty-reach response:** if zero contacts are inside the window when Send is clicked, the route returns a clear message ("No contacts are inside the 24-hour messaging window right now.") rather than reporting a successful send of zero people, and the button click does not fire any Graph API calls in that case.

## What deliberately does not change

- `messenger_contacts` storage shape and the `last_seen` update logic already in the webhook handler — both already do what this fix needs.
- The per-customer copy-paste "Message Blast" generator (`views/admin.ejs:2082-2219`) — separate feature, separate ticket.
- Any Recurring Notifications / re-engagement opt-in work — out of scope, tracked separately.
- The manual "Copy follow-up message" flow used elsewhere in the admin — untouched.

## Out of scope

- Building an opt-in mechanism to grow the reachable list (Recurring Notifications, a future ticket).
- A Sponsored Messages writeup (separate, no-code deliverable).
- Any change to the copy-paste blast generator's content or filters.
