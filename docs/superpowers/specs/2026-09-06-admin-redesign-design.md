# Admin Redesign — Design

**Goal:** Make the admin open on what needs the owner *now*, move everything
else into a collapsible left sidebar, and delete the features that no longer
work or no longer earn their place.

**Status:** drafted 2026-09-06, decisions taken with the owner the same day.
Delivered in three stages; each ships working software on its own.

## What the admin looks like today

Eight in-page tabs plus two links that navigate away:

| Tab | Sections |
|---|---|
| Dashboard | Visits (14 days), Most Visited Pages, Recent Visits |
| Settings | Site Settings, Promo & Pricing, Payment Methods, Image Optimization |
| Messaging | Message Blast, Message Templates, Bot Training |
| Site Content | Hero Slider, Sign-In Guide, Popup, Hero Text, Reviews, Ask for reviews |
| Games | Price Categories, Game Requests, All Games, Coming Soon |
| Customers | Import from Excel, Add New Customer, All Customers |
| Orders | the order queue |
| PS Plus | pricing, monthly entries, most played |
| Accounts ↗ | separate page |
| Posters ↗ | separate page |

**The tab named "Dashboard" is website analytics, not business state.** All 840
lines of it are visit counts and page popularity. Nothing in it tells the owner
a sign-in is waiting on a ten-minute clock, a payment needs approving, or a
rental is holding a slot the site is still advertising.

That is the finding the redesign turns on: promoting the current dashboard would
not have helped. It has to be rebuilt before it is worth putting first.

## The three stages

Ordered so each one ships independently and the next has less to work around.

### Stage 1 — Delete

Five features come out in full. Four were chosen by the owner; the fifth
follows from one of those.

**Recurring Notifications.** Meta deprecated the API on 12 January 2026 and
switched it off on 10 February 2026 outside AU/EU/JP/KR/UK, and since 27 April
2026 the `CONFIRMED_EVENT_UPDATE` tag it sends with returns error 100. The
button cannot work and cannot be repaired.

**Message Blast.** Reaches only people who messaged the Page in the last 24
hours. Still functional inside that window; removed because the owner does not
use it.

**Bot Training.** Zero examples stored, and the AI it feeds has never been
switched on.

**The AI auto-reply.** Not on the owner's original list — it follows. The
fallback exists to answer in the owner's voice, and it learns that voice from
`bot_training`. With the training UI gone it would answer in generic AI voice,
which is the outcome the owner explicitly rejected when the alerts were built.
It has never run in production, so nothing is lost. **The keyword bot stays** —
games, prices, how-to-rent and game-name search are untouched.

**Import from Excel.** A migration tool, used once.

#### What must survive

- `messenger_contacts` — populated on every inbound message, independent of
  blast. The data stays even though its only consumer is going.
- `MESSENGER_PAGE_TOKEN` — still used by the bot's own `sendMessage`.
- The keyword bot and its final fallback message.
- `/api/games-export`, which does not use the Excel library.

#### Manifest

Routes: `/admin/blast`, `/admin/blast/contacts`, `/admin/notifications/send`,
`/admin/notifications/optins`, `/admin/bot-training/add`,
`/admin/bot-training/delete/:id`, `/admin/bot-training/import-fb`,
`/admin/settings/bot-ai-fallback`, `/admin/customers/sample`,
`/admin/customers/import`.

Functions: `sendNotificationOptinOffer`, `markNotifOffered`, `getActiveOptins`,
`reachableContacts`, the AI block inside `handleMessage`, the `event.optin`
handler and `NOTIF_DECLINE` branch in the webhook, and the `importUpload`
multer config.

Dependencies: `xlsx` and `@anthropic-ai/sdk` both become unused and are dropped.

Settings and data: `bot_ai_fallback_enabled` stops being read. `bot_training`
and `notification_optins` stop being read; **their stored rows are left on
disk** rather than deleted, because removing a feature is not a reason to
destroy the records it collected.

UI: the Blast, Bot Training and Recurring Notification panels in
`messaging.ejs`, the Import panel in `customers.ejs`, and the `botTraining`
local passed to the admin view.

### Stage 2 — Sidebar

The tab row becomes a collapsible left sidebar in two groups:

**Manage** — Dashboard, Orders, Customers, Games, Accounts
**Set up** — Site content, Messaging, PS Plus, Posters, Settings

Accounts and Posters join as peers instead of links that navigate away and lose
the owner's place. The sidebar collapses to icons on narrow screens; the admin
is used from a phone.

Orders carries a count badge when anything is waiting, because that is the
number worth seeing before choosing where to click.

### Stage 3 — The dashboard worth opening

Replaces the analytics tab as the landing view. Ordered by what costs money when
missed:

1. **Needs you now** — sign-ins waiting with their countdown, payments to
   approve, reminders due today or overdue, and rentals holding an unlinked
   account slot.
2. **Right now** — out on rent, in the queue, money taken this month.
3. **Analytics** — visits and page popularity, moved to their own section,
   unchanged.

Every number here already exists in the codebase; this stage is arrangement, not
new measurement.

## Not building

- **New analytics.** The visit tracking is kept exactly as-is, only relocated.
- **Deleting stored `bot_training` or `notification_optins` rows.** The features
  go; the records they gathered stay.
- **Touching the keyword bot.** Only the AI fallback beneath it is removed.
- **A settings screen for the sidebar.** Two fixed groups, no configuration.
