# Rent / Browse — one catalog with tabs, search and sort — Design

Date: 2026-10-11 · Status: approved by owner

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
3. **Tab row** — pills in the order above; the active tab is gold. On phones the row
   scrolls sideways. Search box and tab row stay pinned under the site header while
   scrolling (as the filter bar is today).
4. **Results bar** — "<Tab name> · N games", the active filter chips (existing chip
   bar), **Sort** menu, **Filters** button (existing panel, unchanged).
5. **When a tier is filtered** — that tier's admin-written description above the grid.
6. **Grid** — existing `partials/game-card` (or `partials/upcoming-card` on Coming
   soon); 6 a row on computers, 2 on phones (existing `.rentals-grid`).
7. **Empty state** — "No games match. Clear filters" (button clears search + filters,
   keeps the tab).

Removed from Browse: the Coming soon slider, the per-tier and Account bundles
sections, and the PS Plus monthly entries block (that information stays on
`/ps-plus`).

## Tabs

| Tab | `?tab=` | Games | Default sort |
|---|---|---|---|
| All games | (none) / `all` | every rentable game | Most rented |
| Most rented | `most-rented` | every game; #1–#10 rank badges on the first ten while sorted by Most rented | Most rented |
| New releases | `new` | games the homepage counts as new releases (same rule as `home.newGames`) | Newest |
| Coming soon | `coming-soon` | every Coming soon game (`sortUpcoming` order) with Reserve | Release date (soonest; TBA last) |
| Deals | `deals` | every game whose own discount beats the site promo (same rule as the homepage "Loot drops", no 12 cap) | Biggest discount |
| Available now | `available` | games with a free slot now (the existing "Available now" rule) | Most rented |
| Buy to keep | `buy` | games with a buy price on sale (existing "Can buy" rule) | Most rented |
| Bundles | `bundles` | account bundles (existing rule) | Most rented |
| PS Plus Deluxe | `psplus` | one "PS Plus Deluxe — hundreds of games, from ₱X/week · Rent" card, then the PS Plus catalog (the grid Browse already renders for the PS Plus filter) | A–Z |

- **"Most rented"** ranking = the homepage Top rented rule extended to every game:
  rentals started in the last 30 days, then all-time `renters`, then title.
- **Sort menu** options: Most rented, Newest, Price low→high, Price high→low, A–Z;
  Coming soon offers Release date and A–Z; Deals adds Biggest discount; PS Plus
  Deluxe offers A–Z only. `?sort=` keeps the choice in the address.
- Each tab shows its own count; tabs with no games are hidden (except All games).
- Filters still combine with any tab (e.g. Most rented + PS4 + Under ₱200). The
  existing filter state in the address (`price`, `console`, `genre`, `tier`, …) is
  unchanged, so old links (homepage quick picks) keep working and open All games.

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
  agree. Each game's facts gain `rank` (most-rented position), `added` (date for
  Newest), `deal` (discount %), and Coming soon items get their own facts
  (`release`, …).
- **Server (`GET /browse`):** reads `tab`, `sort`, `search` with the existing
  filters, renders the active tab's grid in final order, and hands the browser the
  facts it needs (`browseData`, as now).
- **Browser (`public/js/browse.js`):** tab clicks, search typing and sort changes
  update the grid in place (no reload) and the address bar (`history.replaceState`),
  exactly like filters do today.
- **Homepage links** updated as in the table above.

## Error handling

- Unknown `tab` → All games; unknown `sort` → the tab's default; blank search →
  none.
- A tab with no games is hidden; if the address asks for a hidden tab, All games.

## Testing

Throwaway instance (temp `DATA_DIR`, blank `MONGODB_URI`, in-memory sessions), no
real data.

- Unit (`scripts/test-browse-filter-core.js` or a new
  `scripts/test-browse-catalog-core.js`): each tab's membership, every sort order
  (Most rented ties, Newest, prices, A–Z, release date with TBA last, biggest
  discount), search matching, tab + filter combinations, unknown tab/sort fallback.
- Page (`scripts/test-browse-page.js` updated + a new catalog page test): tab row
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
