# Rent / Browse — one catalog with tabs, search and sort — Design

Date: 2026-10-11 · Status: approved by owner; amended after the plan's dry run

Builds on `2026-10-09-browse-filters-tiers-design.md` (filters panel, chip bar,
tier pills) and the arcade-store homepage.

## Problem

The live Browse page (`/browse`) is ~10,500px tall on a computer: a Coming soon
slider (19 games), Account bundles (2), then one section per price tier (New Games
17, Deluxe 13, Special 8, Regular 20), then PS Plus monthly entries. There is no
search box and no sort, so a customer cannot see "the most rented games" or "every
deal" as one list, and every homepage "View all" lands on the top of that long page
(`/browse`, `/browse#comingSoon`).

## Decisions made with the owner

- **Layout A:** one page — a search box, a row of collection **tabs** (each a ready
  filter), and **one grid**; Filters (existing panel) and a **Sort** menu work on
  top of any tab.
- **Tabs:** All games · Most rented · New releases · Coming soon · Deals · Available
  now · Buy to keep · Bundles · PS Plus Deluxe. Price, PS4/PS5, genre and tier stay
  in Filters.
- **All games:** one grid with Sort — Most rented (default), Newest, Price low→high,
  Price high→low, A–Z. Tier tags on every card keep tiers visible.
- **Coming soon "View all":** every Coming soon game on the site (not PlayStation
  games that were never added).
- **Search box** above the tabs.

## The page

Top to bottom (`views/browse.ejs`):

1. **Title** "Browse games".
2. **Search box** — placeholder "Search N games…"; filters the current tab's grid as
   the customer types (title match, same lowercased text the filters already use).
   `?search=` (the nav search's "See all N results" link) pre-fills it.
3. **Tab row** — pills in the order above, each with its count; the active tab is
   gold. On phones the row scrolls sideways (a tapped tab scrolls into view).
   On computers the search box, tab row and results bar stay pinned under the site
   header while scrolling. On phones the search box slides under the header and the
   tab row and results bar stay pinned (verified at 375px: tabs at 64px).
4. **Results bar** — "<Tab name> · N games", **Sort** menu, **Filters** button
   (existing panel), then the active filter chips on their own line. On phones the
   count wraps to two lines rather than being cut off.
5. **When a tier is filtered** — that tier's admin-written description above the grid.
6. **Grid** — existing `partials/game-card` (or `partials/upcoming-card` on Coming
   soon); the existing Browse grid rule: up to 6 a row (5 at 1280px wide, 6 from
   about 1400px), 2 on phones. Every card is on the page once; the active tab's
   matches come first and the rest wait hidden, so switching tabs needs no reload.
7. **Empty state** — "No games match. Clear filters" (button clears search + filters,
   keeps the tab).

Removed from Browse: the Coming soon slider (`views/partials/upcoming-section.ejs`,
deleted — nothing else includes it), the per-tier and Account bundles sections, and
the PS Plus monthly entries block and its styles in `style.css` (that information
stays on `/ps-plus`).

## Tabs

| Tab | `?tab=` | Games | Default sort |
|---|---|---|---|
| All games | (none) / `all` | every rentable game | Most rented |
| Most rented | `most-rented` | every game anyone has rented (never-rented games are on All games only); #1–#10 rank badges while sorted by Most rented | Most rented |
| New releases | `new` | the 20 newest released games, by the homepage New releases rule (release date on or before today, not TBA); the homepage shelf is its first 10 | Newest |
| Coming soon | `coming-soon` | every Coming soon game with Reserve | Release date = the site's Coming soon order (`sortUpcoming`: owner-ranked first, then soonest, TBA last — the homepage row's order) |
| Deals | `deals` | every game whose own discount beats the site promo (same rule as the homepage "Loot drops", no 12 cap) | Biggest discount |
| Available now | `available` | games with a free slot now (the existing "Available now" rule) | Most rented |
| Buy to keep | `buy` | games with a buy price on sale (existing "Can buy" rule) | Most rented |
| Bundles | `bundles` | account bundles (existing rule) | Most rented |
| PS Plus Deluxe | `psplus` | one "PS Plus Deluxe — Hundreds of games, one account · from ₱X/week · Rent" card (Rent → the PS Plus Deluxe game's page, else `/ps-plus`), then the PS Plus catalog (24, then "Show all N", as Browse already draws it) | A–Z |

- **"Most rented"** ranking = the homepage Top rented rule extended to every rented
  game (`rentalRanking` in `lib/home-view.js`; Top rented is its first 10): rentals
  started in the last 30 days, then all-time `renters`, then title. On other tabs,
  never-rented games follow in A–Z order.
- **Sort menu** options (labels): Most rented, Newest, Price: low to high, Price:
  high to low, A–Z; New releases lists Newest first; Deals adds Biggest discount
  first; Coming soon offers Release date and A–Z; PS Plus Deluxe has A–Z only, so
  no Sort menu shows. Ties go by title; missing prices and dates last. `?sort=`
  keeps the choice in the address (the tab's default is left out); another tab
  starts in its own default order and keeps the search and filters.
- Each tab shows its count for the current search and filters; tabs with no games
  at all are hidden (except All games).
- Filters combine with any game tab (e.g. Most rented + PS4 + Under ₱200). On Coming
  soon and PS Plus Deluxe the Filters button and chips are hidden; the filters stay
  in the address for the other tabs. The panel's old "Show" options and the "PS Plus
  Deluxe" tier option became tabs. The rest of the filter state in the address
  (`price`, `console`, `genre`, `tier`) is unchanged, so old links (homepage quick
  picks) keep working and open All games; old `avail=1`, `unit=ps4|ps5`, `new=1`,
  `newOnly=1`, `buy=1`, `bundle=1` and `psplus=1` links open their tab.

## Links into the catalog

| Link | Goes to |
|---|---|
| Menu "Rent", footer "Browse Games", homepage "View all games ›", Choose your player, Power-up | `/browse` (All games) |
| Homepage Top rented "View all" (phone shelf) | `/browse?tab=most-rented` |
| Homepage New releases "View all" | `/browse?tab=new` |
| Homepage Coming soon "View all" | `/browse?tab=coming-soon` |
| Old `/browse#comingSoon` | opens the Coming soon tab |

## How it is built

- **Rules (pure, shared server + browser):** `public/js/browse-filter-core.js` gains
  the tabs (which games each tab holds), sort orders and search matching, next to
  the filter rules it already has, so the first server render and every click
  agree. Each game's facts gain `rank` (most-rented position), `released` (release
  date, for New releases and Newest) and `deal` (the game's own deal %); `isNew`,
  `home` and the PS Plus "just added" mark are no longer needed. Coming soon games
  get `{ id, title, text, order }`.
- **Server (`GET /browse`):** reads `tab`, `sort`, `search` with the existing
  filters, renders the active tab's grid in final order, and hands the browser the
  facts it needs (`browseData`, as now).
- **Browser (`public/js/browse.js`):** tab clicks, search typing and sort changes
  update the grid in place (no reload) and the address bar (`history.replaceState`),
  exactly like filters do today.
- **Homepage links** updated as in the table above.

## Error handling

- Unknown `tab` → All games; unknown `sort` (or one the tab does not offer) → the
  tab's default; blank search → none.
- No games match: "No games match." and a "Clear filters" button that clears the
  search and filters and keeps the tab.
- A tab with no games is hidden; if the address asks for a hidden tab, All games.

## Testing

Throwaway instance (temp `DATA_DIR`, blank `MONGODB_URI`, in-memory sessions), no
real data.

- Unit (`scripts/test-browse-filter-core.js`, rewritten): each tab's membership, every sort order
  (Most rented ties, Newest, prices, A–Z, release date with TBA last, biggest
  discount), search matching, tab + filter combinations, unknown tab/sort fallback.
- Page (`scripts/test-browse-page.js`, rewritten; `scripts/test-home-coming-soon-row.js`
  checks Browse's Coming soon tab): tab row
  with counts, active tab from `?tab=`, grid order per tab, #1–#10 badges only on
  Most rented, Coming soon cards with Reserve, PS Plus tab card, tier description
  when a tier is filtered, `?search=` pre-fill, removed sections gone, old filter
  links still work, `#comingSoon` → Coming soon tab.
- Homepage tests: View all links point at their tabs.
- Browser check on a throwaway instance at 1280px and 375px: tabs, search, sort and
  filters update the grid without reload; pinned bar; no sideways scroll.
- Full suite green except the known `scripts/test-requests-page.js`.

## Out of scope

- PlayStation games not added to the site; new tab types beyond the nine listed;
  price/PS4/tier tabs (they stay in Filters).
- Changes to game cards, the game pages, or the PS Plus page.

## Rollout

Direct on `main`, pushed when the owner says push.
