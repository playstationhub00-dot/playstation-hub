# Stocked Toggle + Custom New-Game Countdown — Design

**Date:** 2026-08-10
**Status:** Approved

## The problem

Yesterday's not-yet-stocked notice (`views/game-detail.ejs`) shows an amber "Set up on order" pill on any rental type that is both never-rented and has no linked account. That's correct for a game that genuinely has no account yet, but there's no way to clear it once you *have* created the account ahead of demand — the notice stays until the game's first rental, even if it's actually ready to go.

Separately, every newly added game gets the same fixed 11-day "new" countdown (`NEW_GAME_WINDOW_DAYS` in `server.js`), with no way to shorten or extend it per game.

## What changes

### 1. Two new optional fields on a game

- `game.stocked` (boolean, default falsy/absent) — admin-set override meaning "the account exists, this rental type is genuinely available regardless of rental history."
- `game.new_window_days` (number, default falsy/absent, falls back to `NEW_GAME_WINDOW_DAYS = 11`) — per-game override for how many days the countdown runs.

Both are opt-in. Every existing game has neither field set, so behavior is byte-for-byte unchanged until an admin acts on a specific game.

### 2. "Mark as stocked" toggle

A button in the admin Games table's action column, alongside the existing Edit/Delete buttons: `📦 Mark stocked` when `!game.stocked`, `📦 Stocked ✓` when `game.stocked` — clicking either state posts to `POST /admin/games/:id/stocked` and flips the boolean. No confirmation dialog (unlike Delete) — this is a reversible, low-risk toggle.

The only consumer of `game.stocked` is the not-yet-stocked detection in `views/game-detail.ejs`, which changes from:

```js
const neverRented = !game.renters;
```

to:

```js
const neverRented = !game.renters && !game.stocked;
```

This one-line change is the entire effect: `trNotStocked`/`ntNotStocked`/`ps4NotStocked`/`anyNotStocked` all derive from `neverRented`, so marking a game stocked clears the amber banner and flips every "Set up on order" pill back to "Available" simultaneously, with no other code path to touch.

`game.stocked` deliberately does not affect the new-game countdown, the `✨ NEW` badge, the `⏳ Days Left!` card badge, or the "Newly Added Only" filter — those all stay governed purely by `created_at` age. A game can be marked stocked and still show as a promoted new arrival for the rest of its window; the two concepts are independent by design.

### 3. Custom countdown length

A number input in both the add-game and edit-game admin forms, labeled "New game countdown (days)", placed near the existing "Current Renters" field, defaulting to empty (meaning: use the site default of 11). Saved as `game.new_window_days` when non-empty and greater than 0; saving it empty/0 clears the override back to the default.

Three call sites currently hardcode the 11-day window and are explicitly flagged (`server.js:2744-2747`) as needing to stay in sync — all three switch to reading the per-game override with the same fallback:

- `server.js`'s `isAddedThisMonth(game)` — becomes `daysSinceAdded < (game.new_window_days || NEW_GAME_WINDOW_DAYS)`
- `views/partials/game-card.ejs`'s `gcIsNew`/`gcNewDaysLeft` computation
- `views/admin.ejs`'s Games table "Added" column (`gIsNewThisMonth`/`gDaysLeft`)

`NEW_GAME_WINDOW_DAYS = 11` stays as the shared fallback constant; nothing about the fixed value itself changes, only that each site now checks for a per-game override first. The `server.js:2744-2747` comment block gets a line added noting the override, so a future change to the constant doesn't miss this file.

### 4. Countdown reaching zero — unchanged

Confirmed with the user: stays purely cosmetic, exactly as it behaves today. At day N (11 by default, or the custom value): the `✨ NEW` badge and `⏳ Days Left!` badge disappear, the game drops out of the "🆕 Newly Added Only" browse filter and the New Arrivals poster group, and the admin Games table's Added column reads `—`. The game remains listed, rentable, and otherwise fully normal. No new behavior is added at zero — this spec only makes the *length* of that countdown configurable, not what happens when it ends.

## Known interaction, not a defect

A never-rented, un-stocked game with a long custom countdown (e.g. 90 days) shows the "Set up on order" notice for the entire window and indefinitely after it expires, since that notice is governed by `renters`/`stocked`, not by the countdown. The `stocked` toggle is the intended fix — but it's a manual admin action, so a game that's actually been stocked but never explicitly marked will keep showing the notice. This is expected given the design in this spec, not something this spec needs to solve.

## Out of scope

- Any change to what happens when the countdown reaches zero (confirmed: stays cosmetic).
- Auto-detecting "stocked" from account-linking data — this is a manual admin toggle only, independent of the accounts system.
- Bulk-editing `stocked` or `new_window_days` across multiple games at once.
- Any change to the not-yet-stocked banner/pill copy from yesterday's shipped feature — only the `neverRented` condition that gates it changes.
