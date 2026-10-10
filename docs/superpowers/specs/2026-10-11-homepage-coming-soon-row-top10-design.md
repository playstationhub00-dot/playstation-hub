# Homepage — still Coming soon row, Top rented top 10 — Design

Date: 2026-10-11 · Status: approved by owner; amended after the plan's dry run

## Problem

1. The homepage "Coming soon" block (`views/partials/upcoming-section.ejs`, included
   by `views/index.ejs` with `upcoming.slice(0, 6)`) is a slider with ‹ › arrows that
   drifts on its own (`autoDrift('upcomingSlider', 16, true)` in
   `public/js/index-4.js`). It loops, so the soonest game is not always first (the
   owner's screenshot showed Rayman, 54 days, ahead of Castlevania, 5 days).
2. The computer-only "Top rented this month" box beside the banner
   (`views/partials/home/top.ejs`, `.hm-aside`) lists only #1–#5, as text, with no
   way on to the rest of the games.

## Decisions made with the owner

- Coming soon on the homepage: no movement, no arrows, the same layout as "New
  releases" — up to 6 in a row on computers, a hand-swiped row on phones.
- Top rented box: #1–#10, each with a small cover picture, plus "View all games ›".
  To fit, the banner beside it grows to the box's height (option A, about 470px
  instead of 340px on computers).

## 1. Coming soon row (homepage only)

- `views/index.ejs` shows the homepage's Coming soon games with a new
  `views/partials/home/upcoming-row.ejs`: the same shell as
  `partials/home/game-row.ejs` — `<section class="hm-wrap hm-sec" id="comingSoon">`,
  heading `□ Coming soon` + `reserve a slot` + "View all ›" to
  `/browse#comingSoon`, then `.hm-row` of `.hm-cell`s. No arrows; nothing calls
  `slideUpcoming`.
- Which games: the first 6 of `upcoming` as the route already orders them
  (`sortUpcoming`: owner-ranked first, then soonest release date, TBA last). The
  section is left out when there are none.
- The card markup moves unchanged from `upcoming-section.ejs` into
  `views/partials/upcoming-card.ejs` (locals: `game`). `upcoming-section.ejs` (Browse)
  and `upcoming-row.ejs` (home) both include it, so the two cannot drift apart. Browse
  looks and behaves as before. Only Browse uses `upcoming-section.ejs` now, so its
  homepage-only branches (`homeMarker`, `viewAllHref`) go.
- `public/js/index-4.js` no longer calls `autoDrift('upcomingSlider', …)`;
  `scripts/test-homepage-carousel.js` is updated to match (two drifting rows, none
  reversed; the homepage takes six through `upcoming-row`).
- The `id="comingSoon"` anchor stays on the homepage section (the quick-pick chip
  "□ Coming soon" links to `#comingSoon`).
- CSS (`public/css/home.css`): the card already fills a `.hm-cell` (verified); the
  old `.home2 .section[data-upcoming]` spacing rules match nothing any more and go.

## 2. Top rented box (computers, ≥ 900px)

- Lists `home.topRented` #1–#10 (the list `lib/home-view.js` already builds, up to
  `TOP_MAX` = 10). Each row: rank circle (gold / silver / bronze for 1–3, as now),
  a 30×30px rounded cover (`game.cover_image`, `object-fit: cover`, `loading="lazy"`;
  a dark square when there is none), title (one line, cut with …), weekly price.
- Under the list: **View all games ›** → `/browse`.
- Rows get tighter padding (0.24rem), and the box's padding and heading gap shrink
  a little, so ten fit and the box — and the banner beside it — is about 470px tall
  (469px measured at 1440px wide).
- The banner fills its grid row: on computers each `.hm-slide` is as tall as the
  row (at least 340px) instead of a fixed 340px, so it grows with the box. Slide
  pictures keep `object-fit: cover`.

## 3. Top rented on phones

The phone row (`game-row` with `id: 'topRented'`) already shows #1–#10 as cards. It
gets `viewAll: '/browse'`, so its heading has the same "View all ›" as New releases.

## Testing

Throwaway instance (temp `DATA_DIR`, blank `MONGODB_URI`, in-memory sessions); no
real data.

- `scripts/test-home-page.js` (existing) — updated where it asserts the old Coming
  soon slider or the 5-row box.
- New assertions (same file or a new `scripts/test-home-coming-top10.js`):
  - homepage Coming soon: `.hm-row` with at most 6 cards, soonest first, no
    `upcomingSlider` / slider arrows, View all → `/browse#comingSoon`, empty → absent;
  - `public/js/index-4.js` has no `autoDrift('upcomingSlider'`;
  - Browse still renders its Coming soon slider with the same card markup;
  - Top rented box: 10 rows when 10+ games, rank classes 1–10, a cover `<img>` per
    game with a cover and a placeholder otherwise, "View all games ›" → `/browse`;
  - phone Top rented row has "View all ›" → `/browse`.
- Browser check on the throwaway instance at 1280px and 375px: Coming soon static
  and 6-wide; banner and box the same height with all 10 rows visible; no
  horizontal scroll; no console errors.
- Full suite green except the known `scripts/test-requests-page.js`.

## Out of scope

- Changing what "Top rented" counts, the Browse page's sort, or the Coming soon
  card design.
- The New releases and Most popular drift calls in `index-4.js` (their sliders are
  no longer on the homepage; left as they are).

## Rollout

Direct on `main`, pushed when the owner says push.
