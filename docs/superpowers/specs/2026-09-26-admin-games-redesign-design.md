# Admin Games Tab Redesign — Design

**Date:** 2026-09-26
**Status:** Approved in brainstorming, pending spec review
**Scope:**
- `views/partials/admin/games.ejs` (split into a shell plus four partials under `views/partials/admin/games/`)
- `views/edit.ejs` and `views/add-game.ejs` (fields removed, regrouped)
- `lib/availability.js` (Trophy always present)
- New `lib/games-view.js`
- New `public/js/admin-games.js`
- `public/css/style.css` (new `gm-*` rules)
- `views/admin.ejs` (script tag)
- `server.js` (admin route data, add/edit game routes, startup migration)
- Tests

This is job 1 of the Games tab work. Job 2 (the Coming Soon release fix) shipped as 879d630..7ebcafd. Job 3 (Game Requests) comes next and is out of scope here.

## Problem

The Games tab is one long page: All games, then Coming soon, then Requests, then Price categories. The owner scrolls past everything to reach the section they want.

- **The All games table has 14 columns:** Cover, Title, Platform, Added, Released, NT slots, TR slots, PS4 slots, NT prices, TR prices, Cost, Earned, Profit, Actions. It sits in a box that shows five rows at a time, and scrolls sideways on a phone.
- **The filters reset on every reload.** There's search, platform buttons and "New only", but the page reloads after every action. There is also no way to find the games that need attention: sold out, or never rented.
- **The slot numbers in the list can disagree with the site.** The list shows the hand-typed `*_slots` fields. The customer site uses linked-account counts when a game has linked accounts (`computeAvailability()`).
- **Three form fields do nothing useful:**
  - **Trophy Account Available switch.** Every game has both Trophy and Non-Trophy accounts, so the switch only ever hides a Trophy option that should be there.
  - **Available Slots (total).** Nothing on the site reads it; the site uses the per-type counts.
  - **Current Renters, typed by hand.** It only hides the "not rented yet" notice, which the 📦 Stock button already does, and the count updates itself at every sign-in anyway.
- **The Add and Edit forms are in a jumbled order.** For example, Trophy slots sit next to the gallery, far from the other slot counts.
- **The new-price-category form is always on screen:** seven fields at the bottom of the tab.
- **The template scans the whole customers list twice for every game** to work out earnings.

## Goals

- **Sub-tabs:** `All games · Coming soon · Requests · Price categories`, one visible at a time, remembered.
- **A 6-column game row:** Game · Slots left · Prices · Status · Money · Actions. Rare actions sit behind ⋯.
- **Filters that find work:** status chips (All · New · Sold out · Never rented · Bundles), Platform, Sort and search. All are remembered.
- **Slot counts and flags follow the customer site's own rules.**
- **Remove the three useless fields.** Trophy always shows on the customer site.
- **Regroup the Add and Edit forms** into five labelled sections.
- **Usable on a phone.**

## Non-goals

- **Requests stays as it is:** its markup, forms, routes and confirm prompts are unchanged. It only moves into its own sub-tab (job 3 redesigns it).
- **Price category forms, fields and routes are unchanged.** Only the new-category form moves behind a button.
- **No change to any POST route URL, field name or redirect,** except that the add/edit game routes stop reading `trophy_account`, `available_slots` and `renters` from the form.
- **No change to the internal `available_slots` and `renters` counters.** The advance route and Quick Add keep updating them as today.
- **No bulk actions and no new data.**
- **The only change customers see** is that Trophy shows on every game.

## Design

### Page structure

```
[All games 24] [Coming soon 2] [Requests 3 pending] [Price categories 1]      [+ Add New]
─────────────────────────────────────────────────────────────────────────────────────────
All games sub-tab:
[🔍 Search title, genre or category…]
[All 24] [🆕 New 3] [⛔ Sold out 5] [💤 Never rented 2] [📦 Bundles 1]   [Platform ▾] [Sort ▾]
Showing 5 of 24 · Clear
┌ Game ─────────────── Slots left ──── Prices (wk / mo) ── Status ────── Money ───────── ┐
│ ▢ Ghost of Yotei      NT 2  TR 1      NT ₱199 / ₱449     NEW · 4d left  ₱1,340 earned  [Edit] [⋯]
│   PS5 · Action 🏷️New                TR ₱249 / ₱549     Never rented   +₱340 profit
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Sub-tabs

- **Labels:**
  - `All games (N)`
  - `Coming soon (N)`
  - `Requests (N pending)` when there are pending requests, otherwise `Requests (N)`
  - `Price categories (N)`
- **Keys:** `all`, `soon`, `requests`, `categories`. Default: `all`.
- **Memory:** the sub-tab last opened is stored in `localStorage` under `gamesSubtab`.
- **A server message decides which sub-tab opens once,** overriding the remembered one:

  | Message | Opens |
  |---|---|
  | `added`, `updated`, `deleted` | `all` |
  | `upcoming_added`, `upcoming_updated`, `upcoming_deleted`, `release_failed`, `release_in_progress` | `soon` |
  | any `request_*` | `requests` |
  | `cat_added`, `cat_updated`, `cat_deleted` | `categories` |

  `game_released` and `release_partial` already open the Orders tab and are not mapped.
- **+ Add New** stays top right. Its **Price Category** card switches to `categories` and opens the new-category form. The other three cards are unchanged.
- The Games tab's jump links (its `.adm-jump` block) are removed. The `.adm-jump` CSS stays, because the Content and Settings tabs still use it.

### All games sub-tab

#### Toolbar

- **Search** matches, case-insensitively, anywhere in title, genre or price-category name. It is capped at 100 characters.
- **Status chips.** Each shows its count across all games, not just the filtered ones:
  - **All**
  - **🆕 New:** the game is inside its new window. `created_at` is set and fewer than `new_window_days || 11` whole days have passed. This is the same rule as the site's NEW badge.
  - **⛔ Sold out:** `computeAvailability(game, accountSummaryMap[game.id], …).totalSlots === 0`. This is the same check as the site's `fullGameIds()`.
  - **💤 Never rented:** `!game.renters && !game.stocked`. This is the same rule as the "not rented yet" notice on the game page.
  - **📦 Bundles:** `game.is_bundle`.
- **Platform dropdown:** All / PS5 / PS4 / PS4/PS5. It matches `game.platform` exactly.
- **Sort dropdown:**
  - **Newest** (default): `id` descending, today's order
  - **A–Z:** title, locale compare
  - **Most earned:** earned descending, ties by `id` descending
  - **Fewest slots left:** `totalSlots` ascending, ties by title
- **Showing line:** `Showing N of M` whenever any filter narrows the list, followed by a **Clear** link that resets chip, platform and search. Sort is not reset.
- **Memory:** chip, platform, sort and search are stored in `localStorage` under `gamesFilters`.

#### Row

1. **Game.**
   - Cover, or the 🎮 placeholder.
   - Title.
   - `platform · genre`.
   - A 🏷️ chip with the category name when the game has one.
   - A 📦 Bundle chip when `is_bundle`.
2. **Slots left.**
   - An `NT n` chip and a `TR n` chip.
   - A `PS4 n` chip, only when the platform is `PS4` or `PS4/PS5`.
   - A chip at 0 is red.
   - The counts come from `computeAvailability()`, so linked-account counts win over the hand-typed ones.
3. **Prices.**
   - `NT ₱w / ₱m` and `TR ₱w / ₱m`, using the resolved prices (category or custom), as today.
   - A third line `Buy NT ₱x · TR ₱y` when either buy price is above 0. A 0 buy price is left out of that line.
4. **Status.** Stacked chips, in this order, only those that apply:
   - `NEW · Nd left`, red when N ≤ 3
   - `Never rented`
   - `Sold out`
   - `Stocked`
   - A dash when none apply.
5. **Money.**
   - `₱earned earned`, followed by a small `n txn(s)`.
   - Then `+₱profit profit`, or `₱loss at a loss` in red.
   - Earned is the sum of `price` over customers whose `String(game_id) === String(game.id)`.
   - Profit is earned minus `cost || 0`.
6. **Actions.**
   - **✏️ Edit** (`/admin/edit/:id`).
   - **⋯**, holding:
     - **📦 Mark as stocked**, or **📦 Clear stocked** when already stocked. This is the existing `POST /admin/games/:id/stocked`.
     - **🗑 Delete** (`POST /admin/delete/:id`), with today's confirm prompt.

The list is full height; the five-row scroll box goes away. With no games: `No games yet. Use + Add New to add one.` When the filters hide everything: `No games match these filters.` with a Clear link.

### Coming soon sub-tab

The same row style, in these columns:

1. **Game.**
   - Cover, or the 🔜 placeholder.
   - Title.
   - Platform.
   - The existing `N reserved` line.
   - The existing `📅 Out since … — ready to release` line.
2. **Release date.** The formatted date, or `TBA`.
3. **Slots.** NT and TR chips.
4. **Prices.** NT and TR weekly/monthly. A dash when neither is set.
5. **Actions.**
   - **🚀 Release** is the main button. Its confirm prompt is unchanged, including the "N paid reservation(s) will move to sign-in." sentence.
   - **⋯** holds **✏️ Edit** and **🗑 Delete**, with today's confirm prompt.

With nothing coming soon: `No upcoming games. Use + Add New → Upcoming Game.`

### Requests sub-tab

Today's Requests card content, moved over word for word.

### Price categories sub-tab

- The category list (`<details>` per category, with its edit form and Delete) is unchanged.
- The "New price category" form sits inside a `<details>` whose summary is **+ New category**, closed by default. Its fields, defaults and action are unchanged.

### Phone (≤ 640px)

- **Every game or Coming soon row becomes a card:**
  - Cover and title block on top.
  - Slot chips and status chips on one wrapping line.
  - Prices and money side by side.
  - Actions at the bottom.
- The toolbar wraps. Search takes the full width, and the chips scroll sideways inside their own row.
- The sub-tab row scrolls sideways inside itself.
- The page never scrolls sideways.
- The ⋯ menu is anchored to its card, not the button, so it can't run off-screen. This is the lesson from the Orders redesign.

## Add and Edit game forms

### Removed fields

- **Trophy Account Available switch.**
  - Trophy Slots becomes a plain number field, `min="0"`. Add defaults it to `1`, as today.
  - Both routes save `trophy_slots: parseInt(trophy_slots) || 0` and `trophy_account: true`.
- **Available Slots (total).**
  - Edit leaves the stored value as it is.
  - Add stores `available_slots` as NT + TR + PS4 slots at creation.
- **Current Renters.**
  - Edit leaves the stored value as it is.
  - Add stores `renters: 0`.

### Five sections, in this order, in both forms

The sections use the same field names and the same save routes as today.

1. **Basics:** title, platform, genre, release date, description.
2. **Slots:** Non-Trophy slots, Trophy slots, PS4 Primary slots.
   - The PS4 Primary field is hidden when the platform select is `PS5`.
   - It stays in the form, so its value is kept and submitted unchanged.
   - Switching the platform shows or hides it immediately.
3. **Prices:**
   - The category/custom radio and its category select.
   - NT weekly/monthly and TR weekly/monthly.
   - The buy prices.
4. **Images:**
   - Cover image.
   - The focal-point picker (Edit only, as today).
   - The existing gallery with its remove checkboxes (Edit only).
   - Add screenshots.
5. **Extras:**
   - The bundle checkbox and its account select. Add's `?bundle=1` still starts it ticked.
   - New countdown days.
   - Cost.
   - Custom link label and URL.

Existing form behaviour is kept: price-mode toggling, bundle toggling, focal picker, and the `msg` banners.

## Trophy on the customer site

- **`lib/availability.js`:** `hasTrophy` becomes `true` for every game. A game at 0 Trophy slots shows Trophy as full with the waitlist, exactly as Non-Trophy does at 0.
- **`server.js` startup migration:** `if (g.trophy_account === undefined) patch.trophy_account = false;` becomes `if (g.trophy_account !== true) patch.trophy_account = true;`. Existing games that had the switch off are brought into line, so any other code still reading the field agrees.
- **`adjustTrophySlots`** keeps its `trophy_account || newSlots > 0` sync. It is now always true, which is harmless.

## Architecture

### `lib/games-view.js` (new, pure)

- **`gameRows(games, customers, accountSummaryMap, now)` → row[]**
  - Games arrive already resolved by `resolveGamePrices` and `resolveSlotDays`, as the admin route prepares them today.
  - Each row carries:
    - `id`, `title`, `platform`, `genre`, `cover`, `categoryName`, `isBundle`
    - `slots: { nt, tr, ps4, showPs4, total }`
    - `prices: { nt7, nt30, tr7, tr30, buyNt, buyTr }`
    - `status: { isNew, daysLeft, neverRented, soldOut, stocked }`
    - `money: { earned, txns, cost, profit }`
    - `search` (lowercased title, genre and category)
  - Earnings are built in a single pass over `customers` into a map keyed by `String(game_id)`.
  - Customers with non-numeric game ids (`upcoming_5`, `psplus`) never match a game.
- **`chipCounts(rows)` → `{ all, new, soldout, never, bundle }`**
- **`upcomingRows(upcoming, reservedCount, todayManila)` → row[]**
  - Each row carries `id`, `title`, `platform`, `cover`, `releaseLabel` (formatted date, `TBA` or `—`), `reserved`, `ready` / `outSince`, `slots: { nt, tr }` and `prices`.
  - `ready` uses the rule already in the template: a real date on or before today in Manila.
- **`requestSummary(gameRequestRows)` → `{ total, pending }`**

The admin route builds `gamesView = { rows, counts, upcoming, requests }` once and passes it to the render. It reuses the route's existing `games`, `customers`, `upcoming`, `upcomingReservedCount`, `gameRequestRows` and `todayManila`, plus `buildAccountSummaryMap()`.

### `public/js/admin-games.js` (new)

- **Exposed on `window.__gamesFilter` so tests can run the rules without a DOM:**
  - `normalizeState(raw)` → `{ chip, platform, sort, q }`. Unknown values become defaults, and `q` is capped at 100 characters.
  - `rowMatches(rowData, state)`.
  - `compareRows(a, b, sort)`.
  - `normalizeSubtab(raw)`.
  - `subtabForMessage(msg)` → a sub-tab key, or `null`.
- **Page wiring (skipped when there is no `document`):**
  - Reads each row's `data-*` attributes: chip flags, platform, search text, sort keys.
  - Applies the filter and sort, updates the Showing line, and persists state.
  - Switches sub-tabs.
  - Closes an open ⋯ menu on outside click.
- **Storage:** every read and write is wrapped in try/catch. If storage is unavailable, the page works with defaults.
- **Loading:** it is loaded from `views/admin.ejs` with the same `?v=` cache-busting as `admin-orders.js`.

### Templates

- **`views/partials/admin/games.ejs`** (CRLF, Edit tool only) becomes the shell: sub-tab row, + Add New and its modal, and one panel per sub-tab including:
  - `views/partials/admin/games/all-games.ejs`
  - `views/partials/admin/games/coming-soon.ejs`
  - `views/partials/admin/games/requests.ejs` (Requests markup moved verbatim)
  - `views/partials/admin/games/categories.ejs`
- The inline `<script>` with `filterGamesPlatform`, `toggleGamesNewOnly` and `applyGameFilter` is removed.

### CSS

New `gm-*` rules in `public/css/style.css` (CRLF, Edit tool only), covering:
- sub-tabs, toolbar, chips
- row grid, slot and status chips
- the ⋯ menu
- the ≤ 640px card layout

They are dark-theme first, following the `oq-*` rules from the Orders redesign, with the same light-mode care: use `td`-qualified or equally specific selectors wherever an existing rule would otherwise win.

### Server

- **Admin route:** builds `gamesView` and passes it to the render.
- **`POST /admin/add` and `POST /admin/edit/:id`:** the field changes described under "Removed fields".
- **Startup migration:** the one-line `trophy_account` change.
- `server.js` is CRLF with a UTF-8 BOM, so it is edited with the Edit tool only.

## Error handling

- **Rows with missing data still render:**
  - A game with no `created_at` is never New.
  - With no cover it shows the placeholder.
  - With a missing price it shows `₱—`.
  - With no `cost` it counts as 0.
- **A bad saved state is ignored.** A stored filter or sub-tab that is unknown, malformed or not JSON falls back to the defaults.
- **Hidden panels:** a sub-tab whose panel is empty (for example no upcoming games) still opens and shows its empty line.
- **Unmatched customers:** customer rows whose `game_id` matches no game are simply not counted.

## Testing

- **`scripts/test-games-view.js` (new):** the rules in `lib/games-view.js`:
  - New window, including a custom `new_window_days` and the day it expires
  - Never rented (renters/stocked combinations)
  - Sold out, including linked-account counts overriding hand-typed slots, and PS4 slots not counting on a PS5 game
  - Earnings and profit, with string and numeric `game_id` and `upcoming_*`/`psplus` ignored
  - Chip counts
  - The Coming soon ready rule
  - `requestSummary`
- **`scripts/test-admin-games-filter.js` (new):** loads `public/js/admin-games.js` in a sandbox with no DOM and checks:
  - `normalizeState` defaults and caps
  - `rowMatches` for each chip, platform and search, and combinations of them
  - All four sorts, including their tie-breaks
  - `normalizeSubtab`
  - `subtabForMessage` for every mapped message and an unmapped one
- **`scripts/test-games-template.js` (new):** renders `games.ejs` with fixture locals and checks:
  - Sub-tab labels and counts, including the `pending` wording
  - Row columns and chips
  - The PS4 chip only on PS4 platforms
  - ⋯ menu contents and confirm prompts
  - Coming soon rows keep the reserved and ready lines and the exact release confirm prompt
  - Every Requests form, route and confirm prompt is still present
  - The new-category form sits inside the closed + New category `<details>`
  - Every `gm-*` class rendered has a CSS rule
  - `style.css` is still CRLF throughout
- **`scripts/test-game-form.js` (new):** renders `edit.ejs` and `add-game.ejs` with fixtures and checks:
  - No `trophy_account`, `available_slots` or `renters` inputs
  - Every other field name is still present
  - The five section headings, in order
  - The PS4 Primary field has its platform-toggle hook
  - The bundle preset still works
- **`scripts/test-availability.js` (existing):** add the case that a game with `trophy_account: false`, 0 Trophy slots and no linked Trophy accounts has `hasTrophy: true`.
- **`scripts/test-release-pages.js` (existing):** it renders the Coming soon rows, which stop being table rows. Its fixture locals and row helper are updated deliberately; its assertions about the reserved count, the ready nudge and the confirm prompt stay.
- **Server wiring, source-level:**
  - The add/edit routes no longer read `trophy_account`, `available_slots` or `renters` from the body.
  - Both write `trophy_account: true`.
  - Add writes `renters: 0`.
  - The migration line is present.
  - The admin route passes `gamesView`.
- **Browser check:** a fixture-rendered static page of the Games tab and both forms, never the live admin.
  - Desktop and 375px phone.
  - Filters, sort, Clear and sub-tab memory across reload.
  - The ⋯ menu stays on-screen on a phone.
  - No page-level sideways scroll.
  - No console errors.
- **Full regression:** only the pre-existing `scripts/test-requests-page.js` failure is expected.
