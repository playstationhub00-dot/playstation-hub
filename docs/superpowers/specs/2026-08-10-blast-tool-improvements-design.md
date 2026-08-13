# Copy-Paste Blast Tool Improvements — Design

**Date:** 2026-08-10
**Status:** Approved (piece 3 of the re-engagement plan)

## The problem

The Manual Copy-Paste Tool (views/admin.ejs:2126-2348) already lists every past customer with a per-person "Copy Msg" button — the one piece of the re-engagement request that works on all 436 names today, no Meta platform limit involved. Three gaps keep it from actually serving this month's promo push:

1. The template only fills `{name}` and `{game}`. The admin has to hand-type the current promo percentage and any new game titles into the textarea, and re-type them again next month when the promo changes.
2. There's no way to target people who haven't rented recently — "Top Renters" filters by total rental count, not recency, so a customer with 5 rentals two years ago ranks above someone who rented once last week.
3. Nothing tracks who's already been messaged. Working down a list of 100+ names with no memory of where you left off risks double-sending or losing your place entirely if the tab closes.

## What changes

### Two new template tokens

`{promo}` and `{new_games}`, rendered server-side into the same textarea the admin already edits — filled in when the page loads, not hardcoded, so next month's promo change requires no template edit.

- `{promo}`: reads `settings.promo` the same way `getPromoDiscountPct` does. Renders as e.g. `10% OFF monthly rentals` when a duration has an active discount, or an empty string when the promo is disabled — mirrors the existing `{deposit_line}` pattern in lib/templates.js, where a token that doesn't apply produces nothing rather than a broken sentence.
- `{new_games}`: reads the same "is this game new" window every other new-game badge in the app uses (`game.new_window_days || 11` days since `created_at`, already established this session for the card badge and admin Added column). Renders as a comma-joined title list, e.g. `MARVEL Tōkon: Fighting Souls, WWE 2K26`, capped at 5 titles to keep the message short; empty string if nothing currently qualifies.

Both are plain string substitution done once server-side before the textarea renders, alongside the existing `{name}`/`{game}` chip hints already shown above the textarea.

### Filter by recency, not just volume

`blastData` gains a `daysSinceLastRental` field, computed from each customer's most recent record's `end_date` (falling back to `start_date` if `end_date` is missing, same fallback pattern already used elsewhere for records without a clean end date). Two new filter buttons join the existing All / Top Renters row: **30+ Days Inactive** and **90+ Days Inactive** — exactly the "past customers who haven't rented again" audience this campaign is for. The filters compose with the existing ones client-side (same pattern as `filterBlastSearch`), not a separate mode.

### Per-customer copied tracking

Clicking "Copy Msg" marks that row visually (dimmed, with a small ✓ Copied badge) and persists the state in `localStorage`, keyed by year-month (e.g. `blastCopied_2026-08`) so the tracked list naturally resets when a new month's campaign starts — no stale "already contacted" state carrying over from an old promo. A **"Show uncopied only"** toggle sits next to the existing filters, and a **"Reset copied list"** button clears the current month's tracking manually if the admin wants to re-run the same batch.

localStorage rather than a server round-trip: this list is a personal working-through-the-list aid for whoever is at the keyboard, not shared campaign state — no other part of the app reads it, and adding a database write for a UI checkbox would be the wrong weight for what this is.

## What deliberately does not change

- The AI Message Generator, the Auto Blast (24h reachable) section above it, and the Excel import tool below it — untouched.
- `{name}` and `{game}` substitution — same as today.
- The existing Top Renters (≥3 rentals) and search filters — kept as-is, the new filters add to the row rather than replacing anything.
- No server-side storage of "who was messaged" — this is a client-side convenience, not a send log. The tool still only copies text to the clipboard; it never calls the Messenger API itself (that's the Auto Blast section's job, and it's bound by the 24h window on purpose per piece 1).

## Out of scope

- Sending directly from this tool via the Messenger API — piece 1 already established why that requires the 24h window or a paid Sponsored Message; this tool stays copy-paste by design.
- Server-side send tracking or analytics on the copy-paste flow.
- A "mark all as copied" bulk action — copying is inherently one-at-a-time (paste into Messenger per person), so tracking follows the same granularity.
