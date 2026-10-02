# Game overview from PlayStation (Part 4) — Design

Date: 2026-10-02 · Status: draft for owner review

Follows `2026-10-02-visitor-to-messenger-design.md` (Parts 1–3, shipped). The layout was
chosen by the owner: **Option A, trailer on top**.

## Problem

Game pages show a poster, a short description if the owner typed one, and gameplay
screenshots only if the owner uploaded them. A visitor deciding whether to rent has no
trailer, overview, genre or release information unless the owner enters it by hand for
every game.

## Goal

Each game page shows, pulled automatically from PlayStation's own store and refreshed with
an admin button (the way the PS Plus list refreshes): a **trailer and screenshots**
gallery, an **overview**, a **★ rating**, and a **Game info** table (release date, genre,
publisher, size, platform, voice languages, age rating).

## Decisions made with the owner

- Source: PlayStation Store (PSN). Layout A: trailer first, rent box right under it.
- **The owner's own entries win.** PlayStation fills only what the owner left empty
  (description, genre, release date, screenshots). Clearing a field is how the owner hands
  it back to PlayStation. The owner's uploaded cover/poster is never replaced.
- Buttons: **both** an "Update all from PlayStation" button on the Games list and a
  per-game button on the game's edit page (with a box to paste the right PS Store link when
  the automatic match is wrong).
- Size: from another site if possible, otherwise typed by hand — see below.

## Findings that shape the design

Checked against the live PlayStation site (read-only, public pages):

- PlayStation's search index (the Algolia index `lib/psplus-title-search.js` already uses)
  returns, per game: `conceptId`, title, `releaseDateTimestamp`, `genre[]`, `publisher`,
  `platforms[]`, `contentRating`, and a short `description`.
- The store page `https://store.playstation.com/en-us/concept/<conceptId>` embeds the full
  data in its HTML: `descriptions[]` (SHORT and LONG), `media[]` with `role` SCREENSHOT
  (images, ~10 per game) and PREVIEW (trailer `.mp4` files on `vulcan.dl.playstation.net`),
  `starRating { averageRating, totalRatingsCount }`, `spokenLanguages`, `localizedGenres`,
  `releaseDate`, `contentRating`.
- **Download size is not published by PlayStation** on either page. Third-party trackers
  that list it (PSPrices, PSDeals, PlatPrices) answer automated requests with a Cloudflare
  block (HTTP 403), and a legacy PlayStation catalogue endpoint returns sizes for PS4 titles
  only (nothing for PS5). So an automatic size lookup is not reliable. As the owner asked
  ("use another site, and if it stops working fall back to typing it"), Size is a **manual
  field** with a hook for an automatic source (below) rather than a feature that silently
  breaks.

## Out of scope

- Automatic download-size lookup from a third-party site (blocked today; the manual field
  and the `size_gb` hook make adding one later a one-function change).
- Per-region store pages or translations (English, US store only).
- Upcoming ("coming soon") and PS Plus pages, requests, and the buy panel layout.
- Re-hosting PlayStation images or videos on our server (they are linked, not copied).

## Data

A new optional object on each game in lowdb `games.json`:

```
game.psn = {
  concept_id,            // string, PlayStation's id
  store_url,             // https://store.playstation.com/en-us/concept/<id>
  matched_title,         // what PlayStation calls it, shown in admin to catch wrong matches
  source: 'auto'|'manual',   // manual = owner pasted the link
  fetched_at,            // ISO time of the last successful fetch
  description,           // LONG description as clean text paragraphs
  tagline,               // SHORT description
  genres: [],            // e.g. ['Action']
  release_date,          // 'YYYY-MM-DD'
  publisher,
  voices: [],            // language names
  age_rating,            // e.g. 'Mature 17+'
  rating: { avg, count } | null,
  screenshots: [],       // image URLs (image.api.playstation.com only)
  videos: [],            // trailer URLs (vulcan.dl.playstation.net only)
  poster_frames: []      // optional image per video, may be empty
}
game.size_gb             // owner-typed number, optional (new field on the edit form)
```

`psn` is replaced as a whole on each successful fetch; a failed fetch leaves the previous
`psn` untouched. No existing field is modified by an update.

**What the page shows** is resolved at render time: owner value if present, else
`psn` value. Description → `game.description || psn.description`; genre → `game.genre ||
psn.genres.join(' / ')`; release date → `game.release_date || psn.release_date`;
screenshots → `game.gallery` if any, else `psn.screenshots`; videos → `psn.videos`;
size → `game.size_gb`; rating, publisher, voices, age rating → `psn` only.

## Fetching

New `lib/psn-game.js` (never throws; every failure is `{ ok: false, reason }`):

- `findConcept(title, { fetchImpl })` — reuses the search from `lib/psplus-title-search.js`
  to get the `conceptId`. Extend that module to also return `conceptId`, `genre`,
  `releaseDateTimestamp`, `publisher`, `contentRating`.
- `parseConceptPage(html)` — pure: extracts the fields above from the page's embedded data
  with defensive lookups, cleans the LONG description (turns `<br/>` into paragraph breaks,
  strips tags/entities, drops store fine print such as lines starting with `*` or
  "There are other bundles…"), keeps only allow-listed hosts for media URLs
  (`image.api.playstation.com`, `vulcan.dl.playstation.net`), limits to 12 screenshots and
  3 videos.
- `fetchGameInfo(game, { fetchImpl })` — resolves the concept (a pasted `store_url` wins,
  otherwise search by title), downloads the page with a browser-like `User-Agent` and an
  8-second timeout, parses it, and returns `{ ok: true, psn }`. A title with an edition
  suffix ("Deluxe Edition") falls back to the base name if the first search misses.
- The match guard from `pickHit` stays: a hit whose title neither contains nor is contained
  by ours is treated as no match rather than silently attaching a wrong game.

## Admin

- **Games list:** an "Update all from PlayStation" button (POST
  `/admin/games/psn/refresh`). It processes games one at a time with a short pause (about
  300 ms) and a cap of 60 games per click; it skips games already fetched in the last 7
  days unless `?force=1`, and flashes "Updated N · No match: M · Failed: K" with the
  titles that failed. Follows the pattern of the existing monthly-covers route.
- **Game edit page:** a "PlayStation info" section showing the matched title (linked), last
  fetched time, an **Update from PlayStation** button, a **PS Store link** box (paste a
  `store.playstation.com/…/concept/<id>` or `…/product/…` URL to override the match, saved
  with `source: 'manual'`), a **Size (GB)** number box, and "Remove PlayStation info".
- All routes `requireAuth`, same flash-message style as the rest of the admin.

## Public page (Option A)

`views/game-detail.ejs` (+ a new partial `views/partials/game-psn.ejs` and
`public/css/game-psn.css`, `public/js/game-media.js`):

- **Top:** if the game has any video or screenshot (owner's or PlayStation's), the media
  block replaces the static poster: a 16:9 player area with a **▶ TRAILER** badge and a
  "1 / N" counter, plus a thumbnail strip (videos first, then screenshots); swipe or tap a
  thumbnail to switch. The trailer is a `<video controls playsinline preload="none">` with a
  poster image, so no video bytes load until the visitor taps ▶. If there is nothing, the
  current poster layout is unchanged.
- **Under the title:** tagline (italic) and "★ 4.9 on PlayStation Store · 103,548 ratings"
  when a rating exists.
- **Rent box:** unchanged, directly under the media.
- **About this game:** the overview text, first ~4 lines with a "Read more" toggle.
- **Game info table:** Release date, Genre, Publisher, Size (shown only when `size_gb` is
  set, as "NN GB"), Platform, Voice, Age rating — each row omitted when unknown.
- Missing data is simply omitted: a game PlayStation does not know renders as today.
- Desktop keeps the two-column layout: media, About and Game info in the left column; the
  rent box on the right.
- Structured data: the game page's existing description meta/`og:description` use the
  resolved description (truncated to 160 characters).

## Error handling

- A failed or blocked fetch never alters stored data and never breaks the admin page; the
  flash message names what failed.
- Public rendering never calls PlayStation: it reads only stored data, so a PlayStation
  outage cannot slow or break a game page. Images/videos are hotlinked; if one fails to
  load the thumbnail is hidden and the rest still work.
- Media URLs outside the allow-listed hosts are dropped at parse time, so stored data cannot
  point the page at arbitrary hosts.

## Testing

Tests use fixtures (a saved copy of a real concept page's relevant data, trimmed), a temp
`DATA_DIR`, blank `MONGODB_URI`, and an injected `fetchImpl`; nothing reaches PlayStation or a
database.

- `scripts/test-psn-game.js` — `parseConceptPage` on the fixture (fields, fine-print
  stripping, host allow-list, caps), `fetchGameInfo` with stubbed fetch (match, no match,
  pasted URL wins, wrong-match guard, HTTP/timeout failure leaves `{ ok: false }`).
- `scripts/test-game-psn-view.js` — resolution rules (owner wins, PlayStation fills, nothing
  → unchanged page), media ordering, partial markup for each case, "Read more" threshold.
- `scripts/test-admin-psn-routes.js` — boots a throwaway instance (the pattern of
  `scripts/test-admin-visitors-render.js`): refresh route with stubbed fetching updates
  `psn` only, respects the 7-day skip and the 60-game cap, flash text; edit-page save of
  `size_gb` and pasted link; failure leaves old data.
- Existing `test-js-extraction-game-detail.js` and game-detail tests stay green.

## Rollout

Direct on `main`, pushed when the owner says push. No migration: games without `psn` look as
today. After deploy the owner presses "Update all from PlayStation" once; it fills the
catalogue in a few minutes (a 60-game cap per click, repeat for larger catalogues).
Verification on fixture-rendered pages only, never the production admin or data.
