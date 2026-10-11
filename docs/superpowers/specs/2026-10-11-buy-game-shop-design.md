# Buy — a game shop storefront and a full catalog — Design

Date: 2026-10-11 · Status: approved by owner

Builds on the Rent catalog (`2026-10-11-browse-catalog-tabs-design.md`) and the
Buy page's earlier specs (`2026-08-16-buy-catalog-design.md`,
`2026-08-17-buy-price-grouping-design.md`, `2026-08-25-buy-slot-availability-design.md`).

## Problem

`/buy` lists 3 account bundles, then 44 single games split into 8 price-point
sections (₱499, ₱799 … "₱2,299 and up"), with one "Available today only" tick box.
The page is ~6,400px tall and has no search, no sort and no filters. The Rent page
was just rebuilt as an easy catalog. The owner wants Buy just as easy to browse but
with a different vibe: **like actually buying games in a store**.

## Decisions made with the owner

- **Storefront shelves:** a spotlight at the top, then labelled shelves, each with
  "See all ›" into a full catalog.
- **Shelves:** Best sellers · Ready today · Box sets (bundles) · price shelves.
- **Spotlight:** picked by the owner in admin (games and box sets); best sellers until
  then.
- **"See all" / search:** a full catalog view with shelf tabs, search, Sort and Filters,
  in the store look.
- **Look A, "Game shop shelf":** covers standing on wooden shelves, tilted yellow price
  stickers, round "#1" best-seller stickers, green "In stock" / amber "Set up on order"
  tags. Rent stays gold-on-black arcade.
- **Build approach 1:** a separate Buy catalog built like Rent's (its own pure rules
  file shared by server and browser); Rent's code is not touched.

## What a Buy item is (unchanged rules)

The current `GET /buy` rules carry over as they are:

- A **single game** is for sale when its Non-Trophy or Trophy type can still be sold:
  a buy price (`buy_nt_price` / `buy_tr_price`) above 0 **and** `buyTypeSellable(...)`
  with the game's legacy availability (exactly as `server.js` GET /buy does today).
- **Price shown:** the lowest of its sellable types' final prices. When the site buy
  promo is on (`promo.buy_promo_enabled` and `buy_promo_pct` > 0), the final price is
  `round(base × (1 − pct/100))` and the base is shown struck through. *(Change: today
  the card shows the Non-Trophy price first even when Trophy is cheaper.)*
- **"Set up on order"** (amber tag): a game never rented and not stocked
  (`!g.renters && !g.stocked`). Every other for-sale game is **"In stock"** (green tag).
- A **box set** is an account `for_sale` with a Trophy or Non-Trophy slot enabled that
  holds at least one other game (`buildBundleGames` non-empty). Its tiers, prices and
  slot states come from `bundleSlotInfo` as today; a taken tier shows Rented / Sold /
  Unavailable. It links to `/bundle/<slug>`.

## Best sellers

- **Sales:** customer records with `status === 'bought'`, counted per `game_id`.
- **Best-selling order** (used by the Best sellers shelf/tab and the "Best selling"
  sort): most sales first, then the Rent "Most rented" order (`rentalRanking` in
  `lib/home-view.js`), then title.
- **Best sellers shelf/tab:** every for-sale game with at least one sale; when fewer
  than 10 have sold, it is topped up to 10 with the next for-sale games in the
  best-selling order. Positions #1–#3 get round yellow "#1/#2/#3" stickers.

## 1 · The storefront — `GET /buy`

Top to bottom (`views/buy.ejs`, rewritten):

1. **Shop header:** small yellow "THE GAME SHOP" over "Buy games · own them forever",
   a search box ("Search N games to own…", N = for-sale single games) that submits to
   `/buy/catalog?search=…`, and an "All games ›" link to `/buy/catalog`.
2. **Order error banner** (`?order_error=sold|rate|…`), unchanged text.
3. **Spotlight:** up to 5 slides, each a game or a box set:
   - big cover art (a box set uses its first game's cover), "SPOTLIGHT · OWN IT
     FOREVER", name, platform · genre (box set: "N games"), the stock tag (games),
     a tilted yellow price sticker (game: its price; box set: its cheapest open tier),
     and a "Buy now" button (game → `/game/<slug>?mode=buy`, box set → `/bundle/<slug>`);
   - slides scroll natively (swipe on phones), with dots, arrows and auto-advance like
     the homepage banner;
   - which slides: the owner's picks that are still for sale (a game with a sellable
     type; a box set with an open tier), in their order; when none are left, the top 3
     best sellers. No slides → no spotlight.
4. **Shelves**, in this order, each one wooden row of up to **10** items with a title,
   a short grey note and "See all ›" (to its catalog tab); a shelf with nothing on it is
   left out; phones swipe the row sideways:

   | Shelf | Note | Items | See all → |
   |---|---|---|---|
   | Best sellers | most bought | the Best sellers list | `/buy/catalog?tab=best-sellers` |
   | Ready today | in stock, yours the same day | "In stock" games, best-selling order | `/buy/catalog?tab=ready-today` |
   | Box sets | many games, one account · best value | every box set, best value first | `/buy/catalog?tab=box-sets` |
   | Under ₱1,000 | N games | price < 1,000, cheapest first | `/buy/catalog?tab=under-1000` |
   | ₱1,000 – ₱1,999 | N games | 1,000 ≤ price < 2,000, cheapest first | `/buy/catalog?tab=1000-1999` |
   | ₱2,000 and up | N games | price ≥ 2,000, cheapest first | `/buy/catalog?tab=2000-up` |

5. **Kept at the bottom:** the "📦 Build your own" and "🛒 Don't see it? Request a game"
   cards and the reviews strip (`partials/review-block`), unchanged.

Removed: the 8 price-point sections, `groupSingleGamesByPrice`, and the "Available
today only" tick box (the Ready today shelf/tab replaces it).

### Cards

- **Game card** (`views/partials/shop-card.ejs`, used by shelves and the catalog): the
  cover standing on the shelf, the stock tag top-left, the best-seller sticker top-right
  when ranked, platform · first genre, the title, and the yellow price sticker (struck
  base price when the buy promo is on). The whole card links to `/game/<slug>?mode=buy`.
- **Box-set card** (`views/partials/shop-box.ejs`): up to 4 covers (+N), name · "N
  games", "from ₱X per game" (cheapest tier ÷ games, as today), and one sticker per tier
  ("Non-Trophy ₱X", "Trophy ₱Y"; a taken tier is greyed and struck with its status). The
  card links to `/bundle/<slug>`.

## 2 · The catalog — `GET /buy/catalog`

`views/buy-catalog.ejs` (new), in the same store look:

1. **Pinned top** (like Rent: on computers the whole block stays under the menu; on
   phones the search box slides under the menu and the tabs and results bar stay):
   "‹ Back to the shop" (→ `/buy`), the search box, the tab row, and the results bar
   "<Tab> · N games", Sort, Filters, and the applied filter chips.
2. **Tabs** (`?tab=`), each with its count for the current search and filters; the
   active tab is yellow; a tab with nothing in it at all is hidden (All games always
   shows):

   | Tab | `?tab=` | Holds | Default sort |
   |---|---|---|---|
   | All games | (none) / `all` | every for-sale single game | Best selling |
   | Best sellers | `best-sellers` | the Best sellers list | Best selling |
   | Ready today | `ready-today` | "In stock" games | Best selling |
   | Box sets | `box-sets` | every box set | Best value |
   | Under ₱1,000 | `under-1000` | price < 1,000 | Price: low to high |
   | ₱1,000 – ₱1,999 | `1000-1999` | 1,000 ≤ price < 2,000 | Price: low to high |
   | ₱2,000 and up | `2000-up` | price ≥ 2,000 | Price: low to high |

3. **Sort** (`?sort=`; a tab's default is left out of the address):
   - game tabs: Best selling, Price: low to high, Price: high to low, A–Z, Newest
     (release date on or before today, newest first; undated last);
   - Box sets: Best value (lowest price per game), Price: low to high, A–Z;
   - ties by title; missing prices and dates last;
   - #1–#3 stickers show on Best sellers while sorted by Best selling.
4. **Search** (`?search=`): lowercased title for games; name plus the titles of the
   games inside for box sets (so "resident evil" counts on the Box sets tab).
5. **Filters** (game tabs only; hidden on Box sets, kept in the address): Console
   (PS4 / PS5, from `platform`), Genre (each part of the free-text genre, as Rent),
   Account (Non-Trophy / Trophy = that type can still be bought). A filter panel with
   counts and a "Show N games" button, as on Rent; applied filters show as removable
   chips.
6. **Grid:** game cards (or box-set cards on Box sets), 6 a row on computers, 2 on
   phones, each row on the wooden shelf.
7. **Behaviour:** tabs, search, Sort and Filters update the grid at once (no reload)
   and keep the address in step (`history.replaceState`). Unknown `tab` → All games;
   unknown `sort` → the tab's default. Nothing matches → "No games match." and "Clear
   filters" (clears search and filters, keeps the tab).

## 3 · Admin — the spotlight picker

- Admin → Content gets a **"Buy page spotlight"** card next to "Homepage banner": five
  dropdowns "Slide 1…5", each with "— Best sellers —" (blank) and two groups, "Box sets"
  (for-sale box sets) and "Games" (games with a buy price), and "Save spotlight".
- `POST /admin/buy-spotlight` (admin only) saves `site_settings.buy_spotlight` as up to
  5 picks in order, `{ kind: 'game' | 'box', id }`; blanks, unknown ids and repeats are
  dropped. Redirects to `/admin?tab=content&msg=buy_spotlight_saved`.

## How it is built

- **`lib/buy-view.js`** (new, pure): `bestSellerOrder(games, customers, rentalOrder)`
  (sales per game, then rental order, then title), `bestSellers(order, saleCounts)`
  (sold games, topped up to 10) and `spotlight(picks, items, fallback)` (picks still for
  sale, else the top 3 best sellers).
- **`public/js/buy-catalog-core.js`** (new, pure, shared by server and browser, like
  Rent's `browse-filter-core.js`): tabs, sorts, search, filters, the address
  (`parseState` / `toQuery` / `href`) and one `view(data, state, ctx)`.
- **`server.js`:** one builder for Buy's data (the for-sale games and box sets with their
  facts: id, slug, title, search text, cover, platform, PS4/PS5, genres, price, base
  price, Non-Trophy/Trophy sellable, ready, sales, best-seller rank, release date; box
  sets with tiers and price per game) used by `GET /buy` and `GET /buy/catalog`; the
  `POST /admin/buy-spotlight` route. `/bundle/:slug`, game pages and checkout are
  unchanged; `/buy?order_error=…` redirects keep landing on the storefront.
- **Views:** `views/buy.ejs` (rewritten), `views/buy-catalog.ejs` (new),
  `views/partials/shop-card.ejs` and `views/partials/shop-box.ejs` (new),
  `views/partials/admin/content.ejs` (spotlight card).
- **Browser:** `public/js/buy-catalog.js` (catalog clicks, filter panel, chips) and a
  small storefront script (spotlight dots/arrows/auto-advance, shelf arrows).
- **Styles:** `public/css/shop.css` (new): wooden shelves, stickers, stock tags,
  spotlight, pinned catalog top, at most 6 a row on computers, 2 on phones.

## Error handling

- No for-sale games and no box sets → the storefront shows only the header, the
  "Build your own" / "Request a game" cards and the reviews; the catalog shows the empty
  state.
- A spotlight pick deleted or sold out → skipped; an unknown `tab` or `sort` → defaults;
  blank search → none.

## Testing

Throwaway instance (temp `DATA_DIR`, blank `MONGODB_URI`, in-memory sessions, a made-up
admin password); never the project's `games.json` or a database.

- Unit `scripts/test-buy-view.js`: sales counting, best-selling order and ties, the
  top-up to 10, spotlight picks / skipping / fallback.
- Unit `scripts/test-buy-catalog-core.js`: each tab's membership, price boundaries
  (999 / 1,000 / 1,999 / 2,000), every sort, search (box sets by their games), filters
  (and hidden on Box sets), unknown tab/sort, the address.
- Page `scripts/test-buy-page.js`: storefront header, spotlight (picks, skip, fallback),
  each shelf's items, order and "See all" link, empty shelves left out, stock tags and
  prices (promo struck), box-set tiers, kept bottom cards, order error banner; catalog
  tabs and counts, active tab, grid order, stickers, Box sets cards, search pre-fill,
  filter panel, empty state, embedded data escaped.
- Admin `scripts/test-admin-buy-spotlight.js`: the card renders; saving keeps valid picks
  in order and drops blanks, unknown ids and repeats; admin login required.
- Browser check on the throwaway instance at 1280px and 375px: storefront shelves swipe,
  spotlight slides, catalog tabs/search/sort/filters without reload, no sideways scroll,
  no console errors.
- Full suite green except the known `scripts/test-requests-page.js`.

## Out of scope

- Per-game buy discounts (a "Deals" shelf), a cart or buying several games at once.
- Changes to game pages, `/bundle/…` pages, checkout, or the Rent catalog.

## Rollout

Direct on `main`, pushed when the owner says push.
