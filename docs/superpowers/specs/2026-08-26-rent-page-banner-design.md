# Rent Page Branded Banner (Phase 1) — Design

**Date:** 2026-08-26
**Status:** Approved

Give regular game pages the same branded banner the Coming Soon reservation
page has: a purple gradient band carrying a status pill, platform and genre
chips, the game title, and a black bar pairing a status line with the logo.

## Scope boundary

This is **Phase 1 of two**. It changes only the top of the page. The rent/buy
toggle, price header, rental type cards, duration picker, order form, buy
panel, and the cover/gallery slider column are all untouched — nothing about
how a customer rents or buys anything changes.

Phase 2 (the poster + card two-column layout and the compact single-card
booking style) is deliberately deferred: the rent page carries a mode toggle,
three expandable rental types, not-stocked and no-slot banners, and a bundle
dropdown that the reservation card never had, and restructuring all of that
belongs in its own design pass once this ships and the direction is confirmed.

## The change

**A banner above the existing layout.** Inserted between `.gd-back` and
`.gd-layout` in `views/game-detail.ejs`, reusing the reservation page's
`.usd-hero` markup and classes verbatim so the two pages are visually
identical by construction rather than by two copies that can drift.

**The title and genre row move up into it.** `views/game-detail.ejs` currently
renders `.gd-genres` (genre tags plus a "Released <date>" chip) and
`<h1 class="gd-title">` inside the right-hand `.gd-detail-col`. Both are
removed from there and re-rendered inside the banner. This is a move, not a
copy — the page must never show two titles. The `.gd-genres`, `.gd-genre-tag`,
`.gd-release-date` and `.gd-title` CSS rules all stay, because
`views/psplus-rent.ejs` still uses them.

**Status pill in place of "COMING SOON".** Derived from availability the
template already computes:

| Condition | Pill | Class |
|---|---|---|
| `allUnavail` | SOLD OUT | `.usd-badge-off` |
| `isLastSlot` | LAST SLOT | `.usd-badge-warn` |
| otherwise | AVAILABLE | `.usd-badge-ok` |

**Black bar content — urgency when it exists, date otherwise.** Evaluated in
this order:

1. `allUnavail` → "Sold out — all slots rented", in the danger colour
2. `isLastSlot` → "Only 1 slot left", in the danger colour
3. a real `release_date` (not blank, not `TBA`) → "Released <Mon D, YYYY>"
4. otherwise → "<n> slots available"

Rule 4 exists so the bar is never half-empty on a game with no recorded
release date. The logo sits at the right of the bar exactly as on the
reservation page.

**Container geometry needs one modifier.** `.gd-page` has
`padding: 1.5rem 1.25rem 3rem` — horizontal padding on the container itself —
while `.usd-page` has none and lets `.usd-hero` run full-bleed. A `.gdh-hero`
modifier class cancels that padding with negative margins and re-applies a
matching `1.25rem` inside `.usd-hero-in` and `.usd-hero-foot`, so the banner
spans the full 960px container while its title aligns exactly with the page
content below it.

## Out of scope

- No change to the rent/buy toggle, price header, type cards, duration grid,
  order form, buy panel, or gallery slider.
- No change to `views/upcoming-detail.ejs` or `views/psplus-rent.ejs`.
- The game description (`.gd-desc`) stays where it is in the right column —
  moving it is Phase 2's concern.
- No new page-level layout: `.gd-layout` keeps its current two-column shape.

## Verification

Live on `https://playstation-hub.com/game/<slug>` after deploy:

- The banner renders with the purple gradient, chips, title, and the black bar
  with the logo right-aligned.
- The title appears exactly **once** on the page — confirming the move, not a
  copy.
- A fully-rented game shows the SOLD OUT pill and "Sold out — all slots
  rented".
- A one-slot game shows LAST SLOT and "Only 1 slot left".
- An available game with a release date shows AVAILABLE and "Released <date>".
- The banner spans the full container width and its title aligns with the
  content below it.
- The rent/buy toggle, type selection, duration picker, and order form all
  behave exactly as before.
- `views/psplus-rent.ejs` still renders its own title and genre tags
  correctly, proving the retained CSS was not disturbed.
- No console errors.
