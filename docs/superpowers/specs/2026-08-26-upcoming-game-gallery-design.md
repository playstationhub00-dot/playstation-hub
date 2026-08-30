# Upcoming Game Gallery — Design

**Date:** 2026-08-26
**Status:** Approved

Let the owner upload gameplay screenshots for a Coming Soon game, and show
them as a full-width slider under the reserve card.

## The problem

Regular (already-released) games have a complete gallery pipeline: multi-file
upload in the admin form, WebP processing, remove-with-checkbox in the edit
form, cleanup on delete, and a slider on the game detail page with arrows,
dots, thumbnails, swipe, and autoplay. Upcoming games never got any of this —
`views/add-upcoming.ejs` and `views/edit-upcoming.ejs` only ever collect a
single `cover_image`, and `views/upcoming-detail.ejs` has nowhere to show
gameplay art at all.

Two related gaps exist in the current upcoming-game routes that this design
also closes, because a gallery makes them load-bearing instead of
theoretical:

- `/admin/upcoming/release/:id` copies a promoted game into the live `games`
  table field by field and does not copy `gallery` — every screenshot
  uploaded while a game was Coming Soon would be silently discarded the
  moment it releases.
- `/admin/upcoming/delete/:id` only unlinks `cover_image` on disk, so gallery
  files would be orphaned by a delete.

## The change

**Admin — ports the existing games pattern, not a new one.** Both
`/admin/upcoming/add` and `/admin/upcoming/edit/:id` switch from
`upload.single('cover_image')` to `upload.fields([{ name: 'cover_image',
maxCount: 1 }, { name: 'gallery', maxCount: 10 }])`, matching the games
routes exactly. The edit route reuses the same remove-then-append logic and
the same ownership guard: a `remove_gallery` entry naming a file that isn't
in *this* game's own gallery is ignored, so a tampered form can't delete
another game's images. `views/add-upcoming.ejs` gains a multi-file "Gameplay
Screenshots" input; `views/edit-upcoming.ejs` gains the existing-image list
with Remove checkboxes plus an add-more input, both modeled on `views/edit.ejs`.

**Page — a "Gameplay" section under the two-column layout.** When
`game.gallery` has at least one image, `views/upcoming-detail.ejs` renders a
full-width slider below `.rsv-layout`: one large 16:9 image with arrows,
dots, and thumbnails, matching the existing `.gd-slider` / `.gd-dot` /
`.gd-thumb` CSS classes byte-for-byte — no new CSS is needed for the visual
chrome, only a small amount for the section's own heading and spacing. A game
with no gallery renders no section at all, so every existing Coming Soon page
is visually unchanged.

**Implementation choice: a small duplicated slider script, not a shared
extraction.** The rent page's slider script (`gdGo`/`gdMove` in
`views/game-detail.ejs`) is intertwined with rent-specific overlays — the
platform badge, the Last Slot / Sold Out banner, and cover-vs-gallery
focal-point handling for slide 0. None of that applies to a pure gameplay
gallery. Because the underlying CSS classes are already generic and shared,
duplicating the ~30-line control script under new function names (`gpGo`/
`gpMove`) is a smaller, lower-risk change than refactoring the working,
conversion-critical rent page into a shared component. The rent page is not
touched at all.

**The two gaps are closed as part of this work**, not deferred:
`/admin/upcoming/release/:id` now copies `game.gallery || []` into the pushed
`games` row; `/admin/upcoming/delete/:id` now unlinks every file in
`game.gallery` in addition to `cover_image`.

## Out of scope

- No shared slider component or partial — see the implementation choice
  above.
- No click-to-enlarge lightbox (a placement option that was not chosen).
- No change to the regular game gallery pipeline, its routes, or its
  templates.
- No change to `views/upcoming-detail.ejs`'s poster, hero banner, or reserve
  card beyond adding the new section below them.

## Verification

Live on `https://playstation-hub.com` after deploy:

- Uploading 3 screenshots to a Coming Soon game (e.g. Marvel's Wolverine) via
  the admin edit form shows a "Gameplay" section on its `/upcoming/<slug>`
  page with all 3 images reachable via arrows, dots, and thumbnails.
- A Coming Soon game with no gallery shows no "Gameplay" section — the page
  is pixel-identical to before this change.
- Removing a screenshot via its checkbox in the edit form removes it from
  disk and from the page.
- Releasing a Coming Soon game with a gallery carries the gallery into the
  new `games` row, and it appears on that game's regular detail page slider.
- Deleting a Coming Soon game with a gallery leaves no orphaned files in
  `public/uploads`.
- The rent page's own slider (`/game/<slug>`) behaves exactly as it did
  before this change — unaffected by this work.
- No console errors.
