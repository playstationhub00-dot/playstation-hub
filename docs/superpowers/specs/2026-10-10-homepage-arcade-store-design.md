# Homepage redesign — "Arcade store" — Design

Date: 2026-10-10 · Status: approved by owner; amended after the plan's dry run

## Problem

A scan of the live homepage (phone 375px and computer 1400px):

- **Too long:** ~8,900px on a phone (≈11 screens), 17 sections plus the footer.
- **No games up front:** on a phone the first game card appears after ~1,850px — the
  announcement (76px), search block (201px), hero (919px) and "Which account type" (586px).
- **Repetition:** payment methods appear 3 times (hero chips, "Ways to pay", footer);
  rent vs buy vs PS Plus is explained 3 times ("Which account type", "Three ways to play",
  "Browse by price tier"); "How it works" is both a button and a section.
- **Monotony:** New releases, Coming soon, Most popular and PS Plus are all the same
  horizontal slider.
- **Trust last:** 300+ renters, 100% recommend and the reviews sit at the bottom.
- **Crowded hero:** headline, two buttons, two feature lines, five pay chips, four stats.
- The phone order is forced with CSS `order` on `.home-page` sections — fragile (the
  Special deals row needed its own order rule).

## Decisions made with the owner

- **Goal:** store-first — a visitor should find a game and rent it; games and prices on
  the first phone screen.
- **Style "C — Arcade store":** laid out like a real shop, with gaming touches — △ ○ ✕ □
  section markers in PlayStation colours, a "Top rented" leaderboard, a "Power-up" promo
  bar, reviews as "Achievements unlocked", "Choose your player".
- **Banner games:** automatic (newest releases with cover art) plus up to 5 owner-pinned
  games shown first; the owner's uploaded hero slides join as extra slides.
- **Tagline:** one line above the banner, from today's admin hero headline fields.

## Look

- Keeps the site's dark background and gold accent (`var(--ps-blue)`, #F0A500).
- Markers (outline circle with the symbol, also used on the quick-pick chips):
  △ green `#3EA37A` · ○ red `#E0565B` · ✕ blue `#5B8DEF` · □ pink `#D98AC0`.
- Section titles keep the site's heading style; a marker sits before the title.
- Game cards (`views/partials/game-card.ejs`, with tier tags) are reused unchanged.

## Page, top to bottom

Every block is its own partial under `views/partials/home/`; `views/index.ejs` includes
them in this order, with no CSS `order` re-sorting on phones.

| # | Block | Content | Replaces |
|---|---|---|---|
| 1 | Announcement bar | unchanged (`partials/announcement`), plus `partials/popup` | — |
| 2 | Menu | `partials/nav` unchanged; the homepage search (`partials/home-search`) shrinks to a compact search field directly under the menu (phone) / beside the tagline (computer) — same search, results dropdown and tracking | the 201px search block |
| 3 | Tagline | one line: `hero_text.line1` + `hero_text.highlight` (in `highlight_color`) + `hero_text.line2`; admin fields unchanged (subtitle no longer shown) | the big hero headline |
| 4 | "Now playing" banner | swipeable slides, max 5 game slides + the owner's `hero_slides`. Game slide: cover art, "▶ NOW PLAYING", title, tier tag, "Weekly from ₱X" (card price rules: own discount / site promo), "Rent now" → `/game/<slug>`. Auto-advance 6s, pauses on touch/hover; dots; swipe on phones, arrows on computers. On computers the Top-rented list (block 7, top 5) sits to the right of the banner | hero, hero slideshow, custom-background hero |
| 5 | Power-up bar + trust line | "⚡ Power-up · Rent 30 days → 10% off, automatically" built from the site promo (largest discount and its duration; hidden when the promo is off or has no discount) + "✓ 300+ players · ✓ 100% recommend us · ✓ Ready in minutes · ✓ No password needed" (renter count and recommend % from the existing review stats; a figure that is missing or zero is left out) | promo ladder section, hero stats |
| 6 | Quick picks | chips: △ New releases (#newReleasesSection) · ○ Deals (#specialDealsSection, only when deals exist) · ✕ PS Plus (#psplus) · □ Coming soon (#comingSoon) — existing section ids kept · Under ₱A (`/browse?price=low`) · PS4 (`/browse?console=ps4`) · plus up to 2 genres with the most games (`/browse?genre=X`) | — (new) |
| 7 | Top rented | ranked by rentals started in the last 30 days (customer records' `start_date`, per `game_id`), ties and fill-up by all-time `renters`; games only (not upcoming). Phone: swipe row of cards #1–#10 with a rank badge (gold/silver/bronze for 1–3). Computer: top-5 list beside the banner (rank, title, from-price, link) and no separate row | Most popular, "Most rented" spotlight |
| 8 | △ New releases | existing `newReleases` list; phone swipe row, computer up to 6 a row; "View all" → `/browse` | — |
| 9 | ○ Loot drops | existing `specialDeals`; hidden when empty | Special deals |
| 10 | □ Coming soon | existing `partials/upcoming-section` (countdowns, reserve) | — |
| 11 | ✕ PS Plus Deluxe | one card: "Hundreds of games, one account", "from ₱X/week" (`psplusFromWeekly()`), "See games" → `/ps-plus`, plus a strip of the most-played PS Plus games (existing `psplusPopular`, max 6) | Most played in PS Plus |
| 12 | Choose your player | 4 tiles: Trophy (own profile, from ₱ lowest trophy price), Non-trophy (our account, no deposit, from ₱ lowest non-trophy price), Buy (keep it, from ₱ lowest buy price; hidden if nothing is for sale), PS Plus (whole catalogue, from ₱X/week); each links to the matching page; one line under them: "You never give us your password" | Which account type, Three ways to play, Why rent from us, Browse by price tier |
| 13 | 🏆 Achievements unlocked | stat trophies (recommend %, renters, games available, starting price) + the existing `partials/review-block` | What our customers say |
| 14 | How to play + FAQ | the 4 steps (existing copy) then the existing questions (accordion) | How it works, Common questions |
| 15 | Footer | `partials/footer` unchanged — the only list of payment methods | Ways to pay, hero pay chips |

Removed from the homepage: the account-type section, "Three ways to play", "Why rent
from us", price-tier cards, spotlight, Most popular, Most played in PS Plus (as a
section), promo ladder, Ways to pay, the `.home-page` CSS `order` rules, and the scripts only those sections used (`public/js/index-1.js` hero slideshow, `index-2.js` PS Plus collapse, `index-3.js` promo countdown). The page body class becomes `home2`, so leftover `.home-page` rules no longer apply. The reserve and
rent modals the page includes stay.

## Admin

- Settings → Content (where the hero headline is edited) gains **"Homepage banner"**:
  up to 5 games picked from a list, in order. Saved as `site_settings.home_banner_ids`
  (array of game ids). Deleted/unknown ids are skipped at render. The hero background
  setting is no longer used by the homepage (left in admin, marked "not used by the new
  homepage").
- Hero text fields stay; their label says they now feed the one-line tagline.

## Data (server, `GET /`)

The route gains: `bannerGames` (pinned ids first, then newest released games with a
`cover_image`, max 5 game slides), `topRented` (10 games, ranked as above), `powerUp`
(`{ pct, days }` or null), `trust` (`{ renters, recommendPct }`), `playerTiles` (lowest
prices per kind), `quickGenres` (≤2 genre names), `psplusFrom`. Existing locals the
blocks reuse stay (`newReleases`, `specialDeals`, `upcoming`, `psplusPopular`, review
locals, `settings`, `promo`, `accountSummaryMap`). Ranking and selection live in a pure
`lib/home-view.js` so they can be unit-tested.

## Error handling

- Any block whose list is empty is not rendered (no empty headings).
- Banner with no game slides and no uploaded slides → the tagline and the power-up bar
  lead the page.
- Missing cover art: a game without `cover_image` is never a banner slide.

## Testing

All tests use fixtures, a temp `DATA_DIR`, blank `MONGODB_URI`; nothing touches the
project's `games.json`, the database or the real admin.

- `scripts/test-home-view.js` — unit: banner order (pins first, unknown ids skipped, no
  cover → skipped, max 5), top-rented ranking (30-day window, ties by renters, fill-up),
  power-up from promo (off → null), player-tile prices, quick genres.
- `scripts/test-home-page.js` — boots a throwaway instance: blocks render in the order
  above; tagline from hero text; banner slides and prices; top-rented badges; empty deals
  hidden; removed sections gone; payment methods only in the footer; first game card
  appears before the "Choose your player" block; the Power-up line goes when the promo
  is switched off.
- `scripts/test-home-banner-admin.js` — the admin picker, saving ids (blanks, unknown
  ids and repeats dropped), login required, toast and the hero-text / hero-background
  notes.
- Existing tests that assert removed homepage sections are updated; the full suite stays
  green except the known `scripts/test-requests-page.js`.

## Rollout

Direct on `main`, pushed when the owner says push. Until the owner pins banner games, the
banner shows the newest releases with cover art.
