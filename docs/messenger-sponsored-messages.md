# Reaching everyone who ever messaged you — Sponsored Messages

**Date:** 2026-08-10
**Type:** Reference guide, no code involved. Set up entirely in Meta Ads Manager.

## Why this exists

Piece 1 fixed the Auto Blast feature so it no longer risks your Page's messaging permission — but that fix also meant it can only reach whoever messaged you in the last 24 hours (usually 0–2 people, per Messenger's own rule, not a bug in the app). There is no code fix for that: Meta gives no API to message someone outside that window unless they've opted into recurring notifications (piece 4, not built yet).

**Sponsored Messages** is Meta's own paid product for exactly this gap. It's an ad type that delivers straight into the Messenger inbox of everyone who has *ever* messaged your Page — including people from months ago, no opt-in required, no 24-hour limit. It's the only Meta-sanctioned way to promotionally reach your full message history.

## How it works

You are not sending a message through your Page's chat — you're buying an ad whose delivery surface is Messenger. Meta bills like any other ad (a budget you set, pay-per-result), and the message lands as a normal-looking Messenger bubble from your Page, with your text, an optional image, and a button.

## Setup steps

1. Go to **[Meta Ads Manager](https://adsmanager.facebook.com)** (you'll need an ad account attached to your Facebook Page — if you don't have one, Ads Manager walks you through creating it, and it costs nothing to set up on its own).
2. **Create** → choose objective **Engagement** → sub-type **Messages**.
3. Under **Ad Setup**, in the "Message destination" section, choose **Sponsored Message** (not "Click to Messenger," which is a different flow for people who haven't messaged you yet).
4. **Audience**: this is the important part. Meta auto-populates the audience as "people who have messaged your Page" — you don't need to build a custom audience. You can layer on standard filters (location, age) if you want, but the base list is already everyone in your message history.
5. **Budget & schedule**: set a total or daily budget. There's no minimum campaign size — you can test with a small amount first (e.g. ₱500–1,000) to see delivery volume before committing more.
6. **Message content**: build the message in Meta's own builder — a text block, an optional image/carousel, and a call-to-action button (e.g. "Visit Website" linking to `https://playstation-hub.com`, or "Send Message" to reopen the conversation).
7. **Review and publish**. Delivery isn't instant — Meta queues sponsored messages and typically delivers over 1–3 days, not all at once.

## Suggested content for this month's promo

Pull the actual numbers from Settings → Promo & Pricing Rules before writing the ad — don't guess the discount percentage or it'll be wrong the moment the promo changes. As of this writing: 10% off 30-day rentals, promo enabled.

A message shape that fits Sponsored Messages' format well:

> 🎮 Miss us? New games just dropped at PlayStation Hub — plus 10% off monthly rentals this month.
>
> [Button: Browse Games → playstation-hub.com/browse]

Keep it short — Sponsored Messages render as a chat bubble, not a landing page. The button does the work of getting them back to the site, where the game cards and promo banner carry the rest of the pitch.

## Cost expectations

Sponsored Messages are priced like any Meta ad — cost-per-result varies by audience size and competition, typically similar to or slightly higher than a standard link-click ad in the same market. There's no fixed platform fee beyond what you set as your budget. Start small, check the results tab in Ads Manager after a day or two (sent, opened, clicked), and scale the budget only once you've confirmed the message and audience are working.

## What this does not replace

- **Piece 3** (the improved copy-paste tool) is still the free, immediate option for the customers you already have a name and rental history for — use it alongside this, not instead of it.
- **Piece 4** (Recurring Notifications opt-in) is still worth building even after running Sponsored Messages campaigns — it's free per-send once someone opts in, whereas Sponsored Messages costs money every time you run a campaign.
- This does not touch anything in the codebase. If you want a "Send Sponsored Message Reminder" note or link surfaced inside the admin panel itself, that would be a small separate feature — let me know if you want that built.
