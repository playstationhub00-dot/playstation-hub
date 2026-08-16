# Available-Games Card Redesign — Design

**Date:** 2026-08-16
**Status:** Approved

## The problem

The available-games card (`views/partials/game-card.ejs`) and the Coming Soon card (`.upcoming-card` in `views/partials/upcoming-section.ejs`) use two different visual languages on the same pages — a tall boxy card with a bordered price panel vs. a 2:3 poster with everything overlaid on the art. The available-games card also carries five overlapping cover badges, a price box nested inside an already-bordered card, a "See all 4 prices" link that duplicates the card's own click target, two equal-weight buttons (Rent/Buy), and emoji icons that render inconsistently across devices. The one-line title truncates long names (e.g. "Assassin's Creed Black Flag Resynced").

## What changes

### Structure

The available-games card adopts the same 2:3 poster skeleton `.upcoming-card` already uses: full-bleed cover, bottom scrim, all text overlaid on the art. This unifies the two card types and lets them share most of their CSS (`.cs-*` classes extended/reused rather than duplicated as `.gc-*` equivalents).

### Layout, top to bottom

- **Top-left**: a state badge, shown only when there's something worth saying — "Last slot" (red) when exactly one slot remains total, "Rented" (grey) when none remain. A comfortably-available game gets no top-left badge.
- **Top-right**: the "New" pill, shown during the existing new-game window (`gc-isNew` logic, unchanged), same condition as today.
- **Bottom overlay** (on the scrim), stacked:
  1. Platform · Genre on one line, small caps, blue (matches `.cs-plat` styling)
  2. Title, two-line clamp (matches `.cs-title`)
  3. Slots row: colored icon + count per type (🎮→Tabler gamepad icon, 🏆→trophy icon, 🕹️→PS4 icon equivalent), plus an ∞ icon (no count) if the game has a buy price configured
  4. Footer row: "from ₱X" (cheapest promo-applied price, existing `gcStartPrice` logic) on the left, one CTA pill on the right

### States

- **Open** (any slot available, not last): normal render, white "Rent" CTA pill, no top-left badge.
- **Last slot** (`isLastSlot`, existing logic — total slots === 1): red "Last slot" badge, otherwise same as Open.
- **Rented** (`allUnavail`, existing logic — total slots === 0): art dims (overlay tint), title and platform line mute, the slots row is replaced by a single line — "Free in Nd" if the game has next-availability data (existing `ntDaysLeft`/`trDaysLeft`/`ps4DaysLeft`), falling back to plain "Rented" when that data is null — and the CTA becomes an outlined "Reserve" pill instead of the filled "Rent" pill.

### What's removed

- The bordered `.gc-summary` price panel and its nested layout
- The "See all N prices →" link (redundant with the card's own click-through)
- The second Buy button — buying is now indicated by the ∞ icon in the slots row only; the actual buy action lives on the game page (per your choice)
- The full-width `.gc-new-days-left` strip (folded into the top-right New pill; the strip's "X days left" info moves to being visible on the game page instead, since the card no longer has room for a second banner)
- Every emoji badge/icon, replaced with inline SVG icons (confirmed: no icon font is loaded anywhere on the public site today, so this stays dependency-free — small stroke-based SVGs matching the existing placeholder-icon style already used in `.game-cover-placeholder`)

### Scope

One partial (`views/partials/game-card.ejs`), one CSS section (new `.gc2-*` classes or extended `.cs-*` classes — implementation's call which is cleaner given the actual class overlap). Four call sites, all already using this partial, unchanged in how they call it:
- `views/browse.ejs` (2 grids: categorized + uncategorized)
- `views/index.ejs` (2 sliders: New Releases, Featured — both pass `showPriceStart: true`, which becomes a no-op or is removed if the new card always shows price the same way)

Untouched: Coming Soon cards, the game-detail page, PS Plus cards, admin views.

## Self-review

Placeholder scan: none found. Internal consistency: layout/states/removals cross-check without contradiction. Scope: single partial + CSS + 4 unchanged call sites — sized for one implementation plan.

## Notes

- At the homepage slider's fixed 240px width, 2:3 aspect ratio gives ~360px height — shorter than the current card's variable height (260px cover + info block), so sliders get shorter, not taller.
- Cover images will re-crop under the new 2:3 ratio. Existing per-game `cover_focal_x`/`cover_focal_y` fields (already used by the current card) carry over unchanged — no data migration needed, but some games' focal points may need manual adjustment post-launch since the crop window changes.
- The scrim must stay dark enough (matching `.cs-scrim`'s ramp to 94% black) to keep text legible against arbitrary cover art at higher card volume (49+ games vs. Coming Soon's ~5) — this is a real risk noted to the user, not a solved problem, and worth a visual spot-check across several real covers during implementation.
