# Bot AI Fallback Toggle — Design

**Date:** 2026-08-17
**Status:** Approved

## The problem

The Messenger bot (`handleMessage` in `server.js`) replies in three layers: keyword
matching (game names, "prices", "how to rent", etc.), then — only if nothing
matches — a Claude-generated reply meant to imitate the owner's voice, then a
generic "didn't understand" menu as the last resort.

The Claude layer's prompt says to imitate the owner's tone based on saved examples
in **Admin → Settings → Bot Training**. That table currently has zero saved
examples, so Claude has no real voice to imitate and invents a generic "young
Filipino shop owner" tone instead — which reads as clearly not the real owner.

The owner wants this AI layer off for now, without losing the keyword-matched bot
that already works correctly.

## What changes

### 1. A new setting, defaulted off

`site_settings.bot_ai_fallback_enabled` (boolean), added to `getSiteSettings()`'s
existing lazy-init pattern — the same pattern every other setting in that function
already uses (check `undefined`, write a default, mirror it onto the in-memory
object). Default value: `false`.

### 2. A checkbox in the existing Bot Training accordion

Placed above the info banner in `views/admin.ejs`'s Bot Training section, since
that is where an owner would naturally look to control this. Label: **"Use AI to
answer unmatched messages"**, with a one-line note: *"Off by default until you've
added training examples above — otherwise replies won't sound like you."*

Its own small form posts to a new route, `POST /admin/settings/bot-ai-fallback`,
which writes the single boolean and redirects back to `?tab=settings`. Kept as its
own route rather than folded into a larger settings-save endpoint, matching how
Bot Training's add/delete already have their own dedicated routes rather than
sharing one with unrelated settings.

### 3. The guard in `handleMessage`

The existing "AI FALLBACK" block (`server.js`, inside `handleMessage`, currently
gated only on `if (apiKey)`) gains a second condition:

```js
const apiKey = process.env.ANTHROPIC_API_KEY;
if (apiKey && getSiteSettings().bot_ai_fallback_enabled) {
  // ...unchanged Claude call...
}
```

When the setting is off, execution falls straight through to the existing "FINAL
FALLBACK" block — the generic menu message already sent today whenever the AI
block throws or the API key is missing. No new fallback text is written; the
existing one already covers this case correctly.

## What deliberately does not change

- **Keyword-matched replies** — game lookups, "prices", "how to rent", upcoming
  titles, and everything else above the AI Fallback block in `handleMessage` — are
  completely untouched and keep working exactly as they do today.
- **Bot Training storage and the add/delete routes.** This spec adds a toggle
  beside them, not a change to how examples are saved.
- **The Claude prompt itself.** If the owner later adds training examples and
  flips the toggle on, the AI fallback behaves exactly as it does in the code
  today — no prompt changes.
- **`/admin/ai-generate`** (the separate AI-assisted content-writing tool used
  elsewhere in the admin panel) — unrelated code path, not touched.

## Out of scope

- Auto-detecting "not enough training examples" and disabling the toggle
  automatically. The owner controls it manually.
- Any Meta/Facebook Page-side settings. This entire issue turned out to be inside
  this app, not a Meta Business Suite conflict — nothing on the Facebook side needs
  to change.
