# PS Plus Deluxe game catalog: design

**Date:** 2026-09-27
**Status:** approved in brainstorming. Awaiting written-spec review.

**Mockups** (brainstorm companion, local only): `.superpowers/brainstorm/1836-1790445991/content/`
- `layout.html` (A chosen)
- `card-tap-v2.html` (A chosen)
- `design-customer-v2.html`
- `design-admin.html`

## Problem

Customers who rent PS Plus Deluxe can't see which games it includes.

**The `/ps-plus` page today** shows pricing, the owner's hand-made "🔥 Most Played" list and the owner's monthly entries. For everything else it sends customers away:
- a "Browse All PS Plus Games" button to playstation.com;
- a "📩 PM us for full list of games available" note.

**The page is not in the top menu.** The menu is Home · Rent · Buy · Requests · How It Works.

The owner wants the whole Deluxe catalog on their own site, in its own PS Plus tab, together with the monthly games they add.

## Goals

- **A PS Plus item in the top menu.** It opens `/ps-plus` on a searchable, filterable **All Games** tab listing every game in PS Plus Deluxe:
  - Game Catalog;
  - Classics;
  - Ubisoft+ Classics;
  - the owner's monthly games.
- **PlayStation's own data.** Each game shows its cover and platform from PlayStation, and a tap opens a quick-view sheet with a **Rent PS Plus Deluxe** button.
- **The owner keeps the list current with one admin button.**
  - "Refresh from PlayStation" previews what's new, leaving and updated.
  - Nothing changes until **Apply**.
  - A broken fetch can never wipe the list.
- **Owner choices survive every refresh:** hide a game, link it to a game the owner also rents on its own, replace its cover, add a game by hand.
- **Site search finds catalog games** and labels them "Included in PS Plus Deluxe".

## Non-goals

- **No automatic or scheduled refresh.** The owner chose the button.
- **No page per game.** The owner chose the quick-view sheet. PlayStation's data has no descriptions to fill one.
- **The homepage is unchanged.**
- **One region only: Indonesia (`en-id`).** The locale is one constant, so switching to Singapore (`en-sg`) later is a one-line change.
- **No change to how monthly entries are stored or edited.**

## Source data

PlayStation's own game finder on `https://www.playstation.com/en-id/ps-plus/games/` reads four JSON lists from:

```
https://www.playstation.com/bin/imagic/gameslist?locale=en-id&categoryList=<list>
```

| Our list | `categoryList` | Games on 2026-09-27 |
|---|---|---|
| `catalog` | `plus-games-list` | 388 |
| `classics` | `plus-classics-list` | 151 |
| `ubisoft` | `ubisoft-classics-list` | 67 |
| (monthly suggestion only) | `plus-monthly-games-list` | 6 |

**Response shape.**
- Each response is an array of letter groups, `[{ catalogKey: 'A', count, games: [...] }, …]`.
- Each game has `{ conceptId, name, nameEn, conceptUrl, imageUrl, genre[], ageRating, device[] ('PS4'/'PS5'), releaseDate (ISO), productId, streamingSupported }`.
- Every game on 2026-09-27 had a `name`, an `imageUrl` and a `conceptId`.

**Why this feed and not the A–Z list on that page.**
- That page's A–Z list has only 211 titles.
- It misses God of War, Spider-Man, Ghost of Tsushima, Horizon, The Last of Us, Returnal and Demon's Souls.
- It has no covers or platforms.

**Overlaps and duplicates.**
- **Duplicates within a list.** The same `conceptId` can appear twice within one list, for example FINAL FANTASY VII REMAKE INTERGRADE in two language versions (22 such cases in `catalog`).
- **Overlaps across lists.** A game can be in more than one list. All 66 Ubisoft+ games are also in the Game Catalog.
- **After merging by `conceptId`**, there were **519 unique games** on 2026-09-27: 299 catalog only, 66 catalog + ubisoft, 149 classics, plus monthly overlap. Every count shown to customers is a count of unique visible games, never a sum of the list sizes.

**The monthly list is not stored as catalog games.** It feeds only the "Create <Month Year> entry" suggestion (see Admin).

**A sample of all four lists is saved as a test fixture** (`scripts/fixtures/psplus-feed/*.json`), so tests never touch the network.

## Design

### Customer side: `/ps-plus`

**Top menu.**
- A new **PS Plus** item after Buy, in both the desktop nav and the mobile drawer.
- Active on `/ps-plus` and `/ps-plus/rent`.

**Hero** (compact, replacing today's tall one):
- "PS PLUS DELUXE";
- the unique visible game count;
- "from ₱<lowest weekly price>/week";
- free slots (NT + TR + PS4, from the same source the page uses today);
- a **Rent PS Plus Deluxe →** button linking to `/ps-plus/rent`.

Removed from the hero:
- the "Browse All PS Plus Games" button to playstation.com;
- the "📩 PM us for full list of games available" note.

**Three tabs** (client-side switching, all rendered in the one page). `?tab=games|monthly|pricing` selects the tab, and the default is `games`.

1. **🎮 All Games (N)**
   - Search box.
   - Sort: A–Z (default) · Newest added · Release date.
   - Platform filter: All · PS5 · PS4.
   - Filter chips with counts: All · Game Catalog · Classics · Ubisoft+ · Monthly · 🟢 Also for rent.
   - The owner's existing **🔥 Most Played** row sits above the grid. It shows only in the default state (no search, "All" chip, A–Z sort).
   - Then the heading "All N games" and the grid.
2. **📅 Monthly**: today's month cards and their modal, unchanged.
3. **💰 Pricing & Rent**: today's slot-availability card and price cards, plus the Rent button.

**Game card.**
- Square cover.
- A tag at top-left:
  - CLASSIC (blue) when in `classics`;
  - else UBISOFT+ (grey) when in `ubisoft`;
  - else CATALOG (gold).
- A second, stacked tag **MONTHLY · SEP 2026** (purple) when the game matches one of the owner's monthly entries.
- A green **ALSO FOR RENT** tag in the card body when the game is linked to one of the owner's own games.
- Platform line: "PS5 · PS4". Title: the display name, clamped to two lines.

**Monthly-only tile.**
- A monthly entry line that matches no visible catalog game renders as a purple title tile (no cover) with the MONTHLY tag.

**Quick-view sheet.**
- Tapping a card opens a bottom sheet on phones and a centred popup on desktop. It shows:
  - the cover and title;
  - platforms and the first genre;
  - "✓ Included in PS Plus Deluxe · <list>";
  - a **Rent PS Plus Deluxe · from ₱X/week** button (to `/ps-plus/rent`);
  - when linked, "🎮 We also rent this game on its own → see price" (to `/game/<slug>`);
  - "View on PlayStation Store ↗" (`conceptUrl`), shown only for feed games.
- `?game=<key>` opens that game's sheet on load. Site search uses this.

**Performance.**
- The server embeds a compact JSON array of visible games in the page.
- A small script renders the grid 48 cards at a time as the customer scrolls (IntersectionObserver).
- Search, filters and sort run on that array in the browser.

**Covers.**
- Feed covers load from PlayStation's image CDN at display size: `?w=240` for cards and `?w=600` for the sheet.
- A feed `imageUrl` is used only when it is `https://image.api.playstation.com/…`. Anything else is dropped and the title tile is shown.
- An owner-uploaded cover (`cover_override`, a `/uploads/…` path) always wins.

**Empty state.**
- If the catalog has never been refreshed (or the database was never reachable), All Games shows "The full game list is coming soon". The Monthly and Pricing tabs still work.

**Site search** (`/api/search-index`).
- Every visible catalog game is added as a `y: 'psplus'` entry with the "Included in PS Plus Deluxe" badge, linking to `/ps-plus?game=<key>`.
- The search dropdown keeps its existing cap of 3 results in the PS Plus group. If the owner also rents that game on its own, its normal "now" result still appears in its own group.

### Admin: the PS Plus tab

A new card sits at the top of the existing admin PS Plus tab: **🎮 PS Plus Deluxe game list.**

**Normal state.**
- Header:
  - "From PlayStation (Indonesia) · last refreshed <date> (<n> days ago)" (or "never refreshed");
  - buttons **➕ Add a game by hand** and **🔄 Refresh from PlayStation**.
- Counts: Game Catalog · Classics · Ubisoft+ · Monthly (owner's) · Hidden by you · Also for rent.
- A table of every game (visible and hidden) with:
  - client-side search and chips (All · Hidden · Also for rent · Added by hand);
  - 50 rows at a time, then "Show more".
- Each row has:
  - cover, title, platforms and list tag;
  - an **Also for rent** dropdown of the owner's own games, plus "— none —" and "Automatic";
  - a **Shown** switch, which asks for an optional short note when hiding;
  - **Change cover** (upload, or "Use PlayStation's" to clear the override);
  - **Remove** for hand-added games.

**Refresh preview.** Clicking Refresh fetches the three stored lists and the monthly list, then renders a preview. Nothing is saved yet.
- Pills: **+N new · −N leaving · N updated (cover or name) · N unchanged**.
- New and Leaving columns show cover, name, list tag and platforms. A leaving game that is in Most Played shows "⚠ it's in your Most Played list".
- **Monthly suggestion.** When the monthly list read OK and the owner has no month entry for the current Manila month and year, it shows "📅 PlayStation's monthly games for <Month Year>: <names>. You don't have a <Month> entry yet" with **Create <Mon Year> entry from these**. That button opens the existing Add-month form prefilled (year, month, games list one per line). Nothing is created until the owner submits that form.
- **Cancel** and **Apply changes.**

**Safety rules**, evaluated per list:
- **Failed:** a network error, timeout, non-200 or unparseable JSON. The list is not applied, and "couldn't read <list>" is shown.
- **Empty:** zero games while the stored list has any. The list is **blocked**, not applied, with a red explanation.
- **Big drop:** the list shrinks by **30% or more** compared with the stored count. This gives a yellow warning only, and can still be applied.
- **Apply button:** Apply applies only the lists that are not failed or blocked. Its label becomes "Apply the <n> lists that look OK" when any list is held back.
- **All lists failed:** "Couldn't reach PlayStation — nothing changed." No preview is shown.

**Preview lifetime.**
- The preview (fetched lists plus the computed diff) is held in server memory under a random token for **30 minutes**.
- Apply posts the token. An unknown or expired token, for example after a server restart, gives "That preview expired — refresh again", and nothing is applied.

**What Apply does:**
- Upserts new and updated games.
- Removes games that are no longer in any list that was applied. A game in a held-back list keeps that membership.
- Stamps `first_seen_at` on new games.
- Records `last_refreshed_at`.
- **Never touches** `hidden`, `hidden_note`, `cover_override`, `rent_game_id` or `rent_override` on existing games, and never touches hand-added games.

**Toasts** (with the `psplus` tab mapping in `admin.ejs`):
- `catalog_applied` → "✅ Game list updated."
- `catalog_expired` → "⏳ That preview expired — refresh again."
- `catalog_unreachable` → "❌ Couldn't reach PlayStation — nothing changed."
- `catalog_saved` → "✅ Saved."
- `catalog_error` → "❌ Couldn't save that — try again."

### Title handling

**Display name** (`displayName(raw)`), in this order:
1. Decode HTML entities.
2. Strip `™ ® ©`.
3. Strip platform suffixes and markers: trailing ` PS4 & PS5`, ` PS4™ & PS5™`, ` PS4® & PS5®`, ` PS5`, ` PS4`, ` | PS4 & PS5`, and parentheticals `(PS4 & PS5)`, `(PS5)`, `(PS4)`, `(PlayStation Plus)`.
4. Strip trailing edition markers: ` Standard Edition`, ` Standard Digital Edition`, ` - Digital Standard Edition`, ` - Standard`.
5. Collapse whitespace and trim.

**Match key** (`matchKey(name)`):
1. Start from `displayName`.
2. Lowercase it.
3. Replace every run of characters that are not letters or digits with one space, then trim.

Used for:
- linking a catalog game to one of the owner's games (exact match-key equality against each site game's `matchKey(title)`);
- matching monthly-entry lines to catalog games.

**Duplicate concepts.**
- When the same `conceptId` appears more than once, the first occurrence's data is kept, and memberships are unioned across lists.

### Also for rent

- `rent_override: false` (the default, "Automatic"): the link is recomputed on every Apply and every page render, from `matchKey` equality against the owner's games.
- `rent_override: true`: `rent_game_id` is used as set, and `null` means "none". The owner changes this in the admin row dropdown.
- **A link to a game that no longer exists** renders as no link.

### Monthly games

- **The owner's month entries (`psplus` in lowdb) stay the only source** for the Monthly tag and the Monthly chip.
- For each entry, each non-empty `games_list` line is one monthly game.
- **Newest wins.** When a line matches (by `matchKey`) a visible catalog game, the most recent matching entry's month and year set that game's MONTHLY tag. Unmatched lines become monthly-only tiles. Duplicates across entries collapse to the most recent.

## Architecture

| Unit | Responsibility |
|---|---|
| `lib/psplus-feed.js` | `FEED_LOCALE = 'en-id'`, the `LISTS` map, `feedUrl(list)`, `parseFeed(json)` (flatten letter groups, normalize each game to `{ concept_id, name_raw, name, image_url, platforms, genres, release_date, store_url }`, drop disallowed image hosts), `fetchList(list, { timeoutMs = 15000 })` returning `{ ok, games, reason }`. Uses global `fetch` with `AbortController`. |
| `lib/psplus-catalog.js` | Pure rules: `displayName`, `matchKey`, `mergeFeed(listsResult)` (dedupe by concept, union memberships), `diffCatalog(stored, incoming, listStatus)` returning `{ added, leaving, updated, unchanged }`, `listSafety(storedCounts, incomingCounts, listStatus)` returning per-list `ok / failed / blocked / warn`, `applyPlan(stored, incoming, okLists, now)` returning `{ upserts, removals }` that keeps owner fields, `resolveRentLink(game, siteGames)`, `monthlyTags(entries, visibleGames)` returning `{ tagByKey, tiles }`, `primaryTag(lists)`. |
| `lib/psplus-catalog-store.js` | MongoDB collection `psplus_catalog` (one document per game, `_id` = key `c:<conceptId>` or `m:<n>` for hand-added) plus a `psplus_catalog_meta` document `{ _id: 'meta', last_refreshed_at, locale }`. `init(getDb)`, `load()` (fills the in-memory cache at boot), `all()` (cache), `applyChanges({ upserts, removals, meta })` (bulkWrite, then cache update), `setOwnerFields(key, patch)` (whitelisted fields only), `addManual(game)`, `removeManual(key)`. Without `MONGODB_URI` it runs memory-only (local dev). |
| `server.js` | Requires the three libs. Admin routes (all `requireAuth`, all `asyncRoute`): `POST /admin/psplus/catalog/refresh`, `POST /admin/psplus/catalog/apply`, `POST /admin/psplus/catalog/cancel`, `POST /admin/psplus/catalog/:key/visibility`, `POST /admin/psplus/catalog/:key/rent-link`, `POST /admin/psplus/catalog/:key/cover` (existing `upload.single('cover_image')` + `processUploadedImage`), `POST /admin/psplus/catalog/add`, `POST /admin/psplus/catalog/:key/remove`. The in-memory preview map with its 30-minute expiry. `/ps-plus` gains the catalog payload and the tab. `/api/search-index` gains catalog entries. The admin render gains catalog locals. |
| Views | `views/ps-plus.ejs` restructured into hero plus three tabs, with the grid and sheet script. The new partial `views/partials/psplus-catalog-grid.ejs` holds the grid markup and script. `views/partials/nav.ejs` gets the PS Plus item. The new admin partial `views/partials/admin/psplus/catalog.ejs` holds the card, table and preview. `admin.ejs` gets the toasts. `public/css/style.css` gets `.ppc-*` styles. |

**No new dependencies.** `fetch` and `AbortController` are Node built-ins (Node ≥ 18). The plan confirms the deployed Node version.

## Error handling

- **PlayStation unreachable, per list:** see the safety rules above. Nothing stored changes for a failed or blocked list.
- **MongoDB unavailable:**
  - At boot, the cache stays empty and the customer page shows the empty state.
  - On Apply or owner edits, the route redirects with `catalog_error`, and the cache is updated only after a successful write.
- **An upload that is not an image:** the existing `upload` filter rejects it and the existing `bad_file_type` toast is shown.
- **A malformed `:key`** (not `c:<digits>` or `m:<digits>`): redirect with `catalog_error`.
- **Untrusted text:** all feed text is rendered escaped. EJS uses `<%=`, and the client grid builds nodes with `textContent`. Image URLs from the feed must match `^https://image\.api\.playstation\.com/`.
- **The feed URL is fixed server-side**, built only from the `LISTS` map and `FEED_LOCALE`. No user input reaches it.

## Testing

Plain `node scripts/test-*.js` with `assert`, as this project already does:

- **`test-psplus-feed.js`:**
  - `parseFeed` on the saved fixtures gives the right counts, fields and platform arrays;
  - disallowed image hosts are dropped;
  - `fetchList` with a stubbed `fetch` covers ok, non-200, timeout and bad JSON.
- **`test-psplus-catalog.js`:**
  - `displayName` and `matchKey` cases, including "Ghost of Tsushima DIRECTOR'S CUT (PlayStation Plus)", "Arcade Paradise PS4™ & PS5™" and "Assassin's Creed Valhalla - Digital Standard Edition PS4 & PS5";
  - `mergeFeed` dedupe and overlap: the fixtures give 519 unique games;
  - `diffCatalog` for new, leaving and updated games;
  - `listSafety` for failed, empty (blocked) and 30%-drop (warn) lists;
  - `applyPlan` keeps owner fields, never removes hand-added games, and keeps memberships of held-back lists;
  - `resolveRentLink` for automatic, overridden and deleted-game links;
  - `monthlyTags` for matched lines, unmatched tiles and newest-wins;
  - `primaryTag` priority.
- **`test-psplus-catalog-store.js`:** a fake collection covers `applyChanges`, owner-field whitelisting and memory-only mode.
- **`test-psplus-page.js`:** renders `ps-plus.ejs` and the grid partial from fixtures. It checks the tabs, hero count, chips with counts, the Most Played row, the embedded payload (visible games only, escaped), and that the old playstation.com button and "PM us" note are gone.
- **`test-psplus-admin-catalog.js`:**
  - renders the admin partial in the normal, preview and held-back states;
  - source-level wiring checks: routes present, `requireAuth` and `asyncRoute` wrapped, toasts mapped to the `psplus` tab.
- **Nav and search:**
  - a source check that the nav has the PS Plus item;
  - a test that `/api/search-index` adds catalog entries with the badge, using a stubbed store.
- **Browser check** on fixture-rendered pages, never the live admin or live data:
  - tab switching;
  - search, filters and sort;
  - scroll loading;
  - the quick-view sheet;
  - `?game=` deep links;
  - phone width at 375 px with no horizontal overflow;
  - the admin preview states.

## Refinements made while planning

Settled in `docs/superpowers/plans/2026-09-27-psplus-catalog.md`, after running every code block against a copy of the repo.

- **The pure rules are two files.**
  - `lib/psplus-catalog.js` holds the refresh rules: names, merge, safety, diff, Apply.
  - `lib/psplus-catalog-view.js` holds the display rules: tags, "Also for rent", Monthly tags, the customer and admin shapes, the preview view and the month suggestion.
- **`parseFeed` keeps PlayStation's raw name** (`name_raw`). The cleaned `name` is added when the lists are merged.
- **`displayName` handles more of the real feed's noise:**
  - `[PS4 & PS5]`;
  - "PS5 & PS4" in either order;
  - full-width `＆`;
  - "– PlayStation Hits" with a dash;
  - ": Standard Edition";
  - " full game";
  - trademark marks glued between words ("Far Cry®3" → "Far Cry 3").
- **A list read with 0 games is always `blocked`,** including on the very first refresh.
- **A sixth toast, `catalog_nothing`:** "⛔ Nothing to apply — every list was held back." It is used if Apply is pressed when every list was held back. The preview shows no Apply button in that case.
- **The customer page styles live in their own `public/css/psplus-catalog.css`,** so the site-wide `style.css` is untouched.
- **Site search shows catalog games with "Included in PS Plus Deluxe"** as their meta line, under the existing PS PLUS badge.
- **The route test boots the server on a throwaway `DATA_DIR` with `MONGODB_URI` blank,** so it never touches `games.json` or a database.
- **The real count is 515 unique PlayStation games,** before hidden games and the owner's monthly tiles are applied. The earlier "519" also counted PlayStation's own monthly list, which is not stored.
