# Coming soon — "Update from PlayStation" — Design

Date: 2026-10-10 · Status: approved by owner

## Problem

The owner adds every upcoming game by hand (Games → Coming soon → + Add New → Upcoming
Game): title, date, platform, genre, cover, description, gallery, prices, slots. They
also have to notice delays and fix dates themselves. They asked for a button that
finds PlayStation's upcoming games and adds them.

## Decisions made with the owner

- **Review before adding.** Update shows a list of new games, all ticked. The owner
  unticks any they don't want and presses one button. Nothing is saved before that.
- **One set of prices and slots** for every game added in that batch, typed above the
  list and pre-filled from the last upcoming game the owner added.
- **Date changes too.** Games already in Coming soon whose PlayStation date moved, or
  that were TBA and now have a date, are listed with a tick. Only the date changes.
- **Details pulled from PlayStation:** title, release date, platform, genre, cover
  image, description, and up to 6 screenshots for the gallery.

## Source (verified 2026-10-10, read only)

PlayStation's site-search index (Algolia), the same public search-only key and index
already in `lib/psplus-title-search.js` (`crawler_en-us`). One query:

- `query=` (empty), `hitsPerPage=200`
- `filters=pageType:game AND releaseDateTimestamp > <now in ms>`
- `attributesToRetrieve=productName,releaseDateTimestamp,platforms,genre,conceptId,publisher,image,productType`

On 2026-10-10 it returned 19 games (Oct 15, 2026 → Apr 8, 2027), each with a concept
id and a 1024×1024 key art on `image.api.playstation.com`. Games with no announced
date are not in it; those stay manual.

Per game, `lib/psn-game.js` `fetchGameInfo({ psn_link: 'https://store.playstation.com/en-us/concept/<id>' })`
already returns `description`, `genres` and `screenshots` from the store page
(checked on 5 upcoming games: descriptions 904–3,797 chars, 5–12 screenshots each).

Rejected sources: the PlayStation Store "Coming soon" pages (rendered in the browser
through a private GraphQL API whose query hashes change, and full of tiny indie
titles) and the PlayStation Blog's monthly posts (free text).

No PlayStation account, login or session is used anywhere.

## Admin UI (Games → Coming soon)

- A **"🔄 Update from PlayStation"** button beside **+ Add New**, shown on the Coming
  soon tab. It POSTs `/admin/upcoming/psn/refresh` (the button reads "Checking…"
  while it waits).
- The server builds a preview, keeps it in memory under a random token for 30
  minutes (same pattern as the PS Plus catalog: `catalogPreviews` in `server.js`),
  and redirects to `/admin?tab=games&psn_upcoming=<token>`. `public/js/admin-games.js`
  opens the Coming soon sub-tab when that parameter is present.
- The preview panel sits at the top of the Coming soon tab:
  1. **New on PlayStation (N)** — one row per game: tick box (ticked), cover thumbnail
     (shown straight from PlayStation's image CDN), editable title, publisher and
     genre in small text, release date (e.g. "Oct 15, 2026"), platform. Games the
     owner skipped in an earlier update come last, unticked, labelled "Skipped before".
  2. **Prices and slots for the games you add** — six number fields: non-trophy weekly,
     non-trophy monthly, trophy weekly, trophy monthly, non-trophy slots, trophy
     slots. Pre-filled from the upcoming game with the newest `created_at`; all 0 when
     there is none. One note line: "Cover, description and up to 6 screenshots come
     from PlayStation."
  3. **Release date changed (N)** — one row per existing game: tick box (ticked), title,
     "old date → new date" ("TBA → Jan 15, 2027" for a TBA game). Note: "Only the date
     changes. Prices, slots, cover and reservations stay."
  4. **Already on your site (N)** — one line listing the titles, no controls.
  5. **Cancel** (POST `/admin/upcoming/psn/cancel`, drops the preview) and the gold
     button **"Add X games · update Y dates"**, which counts the ticks live and reads
     "Adding…" once pressed. It POSTs `/admin/upcoming/psn/apply` with the token, the
     ticked concept ids, the edited titles, the six price/slot fields and the ticked
     date changes.
- Empty sections are left out. With nothing new and no date changes the panel says
  "You're up to date — nothing new on PlayStation." and shows only section 4.

## Rules

**Which PlayStation games count**
- Must have a concept id, a release timestamp after now, and `PS5` and/or `PS4` in
  `platforms`. `productType` must be `FULL_GAME` or `GAME_BUNDLE`.
- Platform: both → `PS4/PS5`; one → that one (the same three values as the add form).
- Release date: the timestamp as a Philippine (Asia/Manila) calendar date, `YYYY-MM-DD`.
- Title cleanup: remove ®, ™ and ©, collapse spaces, drop a trailing "Standard
  Edition". Other edition names (Ultimate, Deluxe…) stay.
- Genre: the store page's first genre, else the index's first; "Role Playing Games"
  → "RPG", "Sport" → "Sports". Blank when neither has one.

**Already on the site** (checked against Coming soon and the available games)
- Same `psn_concept_id`, or the same match key: lower-case, accents removed, ®™©
  removed, a trailing "<word> Edition" dropped for the words `psn-game.titleCandidates`
  already strips (Deluxe, Standard, Ultimate, Digital, Gold, Complete, Premium,
  Definitive, Special), then everything but letters and digits removed.
- A match in Coming soon is checked for a date change; a match in available games is
  only listed under "Already on your site".

**Date change**: an existing Coming soon game matched above whose `release_date` is
`TBA`, blank or different from PlayStation's date.

**Skipped**: concept ids that were in "New on PlayStation" but unticked when the owner
pressed the gold button are saved to `site_settings.upcoming_psn_skipped` (unique, newest
200 kept). Ticking one later adds it and removes it from that list.

## Apply (`POST /admin/upcoming/psn/apply`)

1. Unknown or expired token → `?msg=psn_upcoming_expired`. Nothing ticked →
   `psn_upcoming_nothing`. Another apply still running → `psn_upcoming_busy` (one
   apply at a time, an in-process flag). The token is deleted as the apply starts, so
   a double press cannot add twice.
2. Re-check against what is stored now (the owner may have added a game since the
   preview): a ticked game that now matches an existing one is not added.
3. For each ticked new game, 3 at a time:
   - `fetchGameInfo` for description, genres and screenshots (8s timeout).
   - Cover: the index image; screenshots: the first 6. Each image is downloaded only
     from `https://image.api.playstation.com/`, at most 10 MB, 15s timeout, then saved
     with sharp as WebP (max 900px, quality 82) into the uploads folder, exactly like
     an uploaded picture. A failed download is skipped, never fatal.
   - New record pushed to `db.get('upcoming')` with `newUpcomingId()` and the same
     fields as `/admin/upcoming/add` — title (owner's edit, else cleaned title),
     platform, genre, release_date, description, cover_image, gallery, rank 0, the six
     price/slot numbers (whole numbers ≥ 0), buy prices 0, `created_at` — plus
     `psn_concept_id`.
4. Ticked date changes: set `release_date` (and `psn_concept_id` when it was matched by
   title). Nothing else on the record changes.
5. Save the skipped list, then redirect to the Coming soon tab with
   `psn_upcoming_applied` (all fine) or `psn_upcoming_partial` (some game is missing a
   cover or description) plus `&added=X&dates=Y`; `views/admin.ejs` builds these two
   toasts from those numbers instead of a fixed string. The toast reads "✅ Added X games ·
   updated Y dates" or "⚠ Added X games · updated Y dates — some covers or descriptions
   couldn't be downloaded; add them in Edit."

## Refresh failures

The index unreachable, a timeout or an unexpected reply → redirect with
`psn_upcoming_unreachable`: "❌ Couldn't reach PlayStation — nothing changed." A reply
with zero usable games is not an error: the panel shows "You're up to date".

## Code layout

| File | Job |
|---|---|
| `lib/upcoming-psn-feed.js` (new) | The one index query. `fetchUpcoming({ fetchImpl, now, timeoutMs })` → `{ ok, games, reason }`, never throws; `parseHits(json, now)` pure. Each game: `{ concept_id, title, raw_title, release_date, platform, genres, publisher, image_url }`. |
| `lib/upcoming-psn.js` (new, pure) | `cleanTitle`, `matchKey`, `mapGenre`, `manilaDate`, `buildPreview(upcoming, games, feedGames, skipped)` → `{ fresh, skippedBefore, dateChanges, already, defaults }`, `planApply(preview, form, upcomingNow, gamesNow)` → `{ adds, dateUpdates, skipped }`. |
| `lib/remote-image.js` (new) | `saveRemoteImage(url, { fetchImpl, uploadsDir, maxDim })` → `'/uploads/<name>.webp'` or `''`, never throws. |
| `server.js` | The three routes, the preview map, the busy flag, the admin `GET` passing the preview to the view, the new toast messages and their tab mapping (`games` in `views/admin.ejs`, `soon` in `public/js/admin-games.js`). |
| `views/partials/admin/games/psn-update.ejs` (new) | The panel; included at the top of `games/coming-soon.ejs`. The button lives in `games.ejs` beside + Add New. |
| `public/js/admin-upcoming-psn.js` (new) | Live tick count on the gold button, "Checking…" / "Adding…" states. |
| `public/css/style.css` (CRLF, where the `.gm-*` Games-tab styles live) | Panel styles (`.gmp-*`) in the admin's existing look. |

## Testing

All tests use a temp `DATA_DIR`, blank `MONGODB_URI`, the in-memory session stub and a
made-up admin password; PlayStation is never called — `fetch` is stubbed with fixture
replies. Nothing touches the project's `games.json`, the database or the real admin.

- `scripts/test-upcoming-psn-feed.js` — parse: future-only, PS5/PS4 only, product
  types, platform mapping, Manila date at the day boundary, missing concept id
  dropped, bad shape → `{ ok:false }`, timeout → `{ ok:false, reason:'timeout' }`.
- `scripts/test-upcoming-psn.js` — title cleanup (®™, Standard Edition), match by
  concept id and by key ("Grand Theft Auto VI: Ultimate Edition" = "Grand Theft Auto
  VI Ultimate Edition"; "Fable Standard Edition" = "Fable"), genre map, date changes
  (moved, TBA → date, same date → none), skipped ordering, defaults from the newest
  upcoming game, plan re-check drops a game added after the preview.
- `scripts/test-remote-image.js` — wrong host refused, oversize refused, failed fetch →
  `''`, good PNG → a WebP file in the temp uploads folder.
- `scripts/test-admin-upcoming-psn.js` — boots a throwaway instance: login required on
  all three routes; refresh renders the panel with the four sections; apply adds the
  ticked games with the typed prices and slots, cover and gallery paths, description and
  `psn_concept_id`; unticked ids saved as skipped and shown unticked next time; ticked
  date change updates only the date; expired token, nothing ticked and unreachable
  messages; a second apply with the same token adds nothing.
- The full suite stays green except the known `scripts/test-requests-page.js`.

## Out of scope

- Automatic or scheduled checks (the owner chose a button).
- Games with no announced date (still added by hand).
- Changing anything on a game besides its date, removing games PlayStation dropped,
  and buy prices (still set in Edit).
- Other regions' release dates (the index is the US one; dates are converted to
  Manila time).

## Rollout

Direct on `main`, pushed when the owner says push.
