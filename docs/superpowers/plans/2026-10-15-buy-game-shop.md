# Buy — a game shop storefront and a full catalog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/buy` becomes a game shop: an owner-picked spotlight, then wooden shelves (Best sellers, Ready today, Box sets, three price shelves), each with "See all ›" into a new full catalog at `/buy/catalog` with shelf tabs, search, Sort and Filters.

**Architecture:** A new pure rules file, `public/js/buy-catalog-core.js`, knows the catalog's tabs, sorts, search and filters, and the storefront's shelves are just each tab's first 10. The server and the browser both use it, the same way Rent's `browse-filter-core.js` works. A new `lib/buy-view.js` counts purchases, builds the best-selling order and turns the admin's spotlight picks into slides. `server.js` gets one builder, `buyShopData()`, for the games and box sets for sale, using the same for-sale rules as today's `/buy`. Both pages use it. The catalog page script shows, hides and orders the cards already on the page, with no reload. The Rent catalog is untouched; the Buy catalog reuses its pinned-bar and filter-panel styles and its tick-box partial.

**Tech Stack:** Express + EJS templates, plain browser JS (no build step), plain CSS. Tests are `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-11-buy-game-shop-design.md` (amended after this plan's dry run).

**How this plan was checked.** Every file in this plan was dry-run in a scratch copy of the current `main`. Each new test fails first and then passes, and the full suite stays green apart from the known `scripts/test-requests-page.js`. A browser check used a throwaway instance with 26 made-up games, 9 made-up purchases and 3 box sets (one sold out).

At 1280px wide:
- The spotlight shows the owner's picks and skips the sold-out box set. Dots, arrows and auto-advance all work.
- Shelves sit on wooden boards with stickers and stock tags, and the shelf arrows scroll each row.
- The catalog shows 6 a row on its shelves. Tabs, Sort, search, the filter panel, chips and "Clear filters" change the grid without reloading (a page marker survived every change).
- Box sets shows the box-set cards, its own sorts and no Filters button.

At 375px wide:
- Nothing scrolls sideways, and the shelves swipe.
- The catalog's tabs stay pinned at 64px under the menu.

There were no console or server errors.

## Global Constraints

- Work directly on `main` and do not switch branches. **Push only when the owner says "push".**
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Line endings:**
  - `server.js` is CRLF + UTF-8 BOM in the working tree.
  - `public/css/style.css` is CRLF.
  - Every other file touched here is LF with no BOM.
  - The edit scripts (via `.superpowers/tmp-edits/rep.js`) keep each file's endings and BOM. New and replaced files are written LF.
  - Git stores LF blobs (`core.autocrlf=true`), so a CRLF working copy is expected.
- **For sale (unchanged from today's `/buy`):** a game is for sale when its Non-Trophy or Trophy type has a buy price above 0 **and** `buyTypeSellable(summary, type, { everStocked, avail })` says yes.
- **Box sets:** an account with `for_sale` and an enabled Trophy or Non-Trophy slot that holds at least one other game (`buildBundleGames` not empty). Its tiers come from `bundleSlotInfo`.
- **Price:** the lowest final price among the types that can still be bought, from `buyPricing.priceFor(game, 'nt'|'tr', promo)`. When the buy promo cuts it, the base price is shown struck through.
- **"Set up on order":** never rented and not stocked (`!g.renters && !g.stocked`). Every other game for sale is "In stock".
- **Best-selling order:** most purchases first (customer records with `status === 'bought'`, per `game_id`), then Rent's `rentalRanking` order, then title.
- **Best sellers:** every game that has sold. While fewer than 10 have sold, the list is topped up to 10 with the next best-selling games. #1–#3 stickers show.
- **Tabs and shelves** (`?tab=`), in this order:
  - `all` — not a shelf.
  - `best-sellers`.
  - `ready-today` — "In stock" games.
  - `box-sets`.
  - `under-1000` — price < 1000.
  - `1000-1999` — 1000 ≤ price < 2000.
  - `2000-up` — price ≥ 2000.
- **Default sorts:** price tabs start on Price low→high, Box sets on Best value, and the rest on Best selling. A tab with nothing in it is hidden (All games always shows).
- **Sort labels:** `best-selling` "Best selling", `price-asc` "Price: low to high", `price-desc` "Price: high to low", `az` "A–Z", `newest` "Newest", `best-value` "Best value".
  - Game tabs offer Best selling, both prices, A–Z and Newest.
  - Box sets offers Best value, Price: low to high and A–Z.
  - Ties sort by title. Missing prices and dates go last.
  - The tab's default never appears in the address.
- **Shelves:** each shelf shows its tab's first **10** in the tab's default order. Empty shelves are left out.
- **Spotlight:** up to **5** of the owner's picks (`site_settings.buy_spotlight`, `[{ kind: 'game' | 'box', id }]`) that are still for sale; a box set must have an open tier. When none are left, it shows the first **3** best sellers.
- **Search** matches a game's lowercased title, or a box set's name plus the titles of its games.
- **Filters** apply on game tabs only: Console (PS4/PS5), Genre, Account (Non-Trophy/Trophy can still be bought). On Box sets the Filters button and chips are hidden.
- Tests use a temp `DATA_DIR`, a blank `MONGODB_URI`, the in-memory session store and a made-up admin password. Never touch the project's `games.json` or a database.
- Known unrelated failure: `scripts/test-requests-page.js`. Report it; do not fix it.
- Edit scripts live in `.superpowers/tmp-edits/` (git-ignored). Never commit them. Task 3 removes the folder.
- Always `git add` explicit paths: the untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.

## Files

| File | Task | Change |
|---|---|---|
| `lib/buy-view.js` (new) | 1 | Purchases per game, best-selling order, reading the spotlight form, the spotlight slides |
| `public/js/buy-catalog-core.js` (new) | 1 | The shop's tabs, shelves, sorts, search, filters, address, `view` |
| `scripts/test-buy-view.js`, `scripts/test-buy-catalog-core.js` (new) | 1 | Their tests |
| `server.js` | 2, 3 | Task 2: `buyBoxSets`, `buyShopData`, `GET /buy`, `GET /buy/catalog` (the old price grouping goes). Task 3: `buySpotlightChoices`, `POST /admin/buy-spotlight` |
| `views/buy.ejs` | 2 | Replaced: the storefront |
| `views/buy-catalog.ejs` (new) | 2 | The catalog |
| `views/partials/shop-card.ejs`, `views/partials/shop-box.ejs` (new) | 2 | A game card and a box-set card |
| `public/js/buy-catalog.js`, `public/js/shop.js` (new) | 2 | Catalog clicks; shelf arrows |
| `public/css/shop.css` (new) | 2 | The shop look |
| `public/css/style.css` | 2 | The old `/buy` page's dead `.buy-*` rules removed |
| `public/js/home.js` | 2 | Comment: it also runs the Buy spotlight |
| `scripts/test-buy-page.js` (new) | 2 | Storefront and catalog |
| `views/partials/admin/content.ejs`, `views/admin.ejs` | 3 | The "Buy page spotlight" card and its saved message |
| `scripts/test-admin-buy-spotlight.js` (new) | 3 | The picker and saving |

---

### Task 1: The shop's rules and best sellers

**Files:**
- Create: `lib/buy-view.js`, `public/js/buy-catalog-core.js`, `scripts/test-buy-view.js`, `scripts/test-buy-catalog-core.js`

**Interfaces:**
- Consumes: nothing from this plan (pure modules).
- Produces:
  - `lib/buy-view.js`:
    - `saleCounts(customers)` → `{ [gameId]: purchases }`.
    - `bestSellingOrder(games, counts, rentalOrder)` → game ids, best selling first.
    - `readSpotlightForm(body, { games: ids, boxes: ids })` → `[{ kind, id }]`.
    - `spotlight(picks, shop, bestIds)` → `[{ kind: 'game'|'box', item }]`.
    - Constants `SPOTLIGHT_MAX` (5) and `SPOTLIGHT_FALLBACK` (3).
  - `public/js/buy-catalog-core.js` (`window.BuyCatalogCore` in the browser):
    - Functions: `parseState`, `cleanState(s, data)`, `tabVisible`, `sortOf`, `toQuery`, `href` (always `/buy/catalog…`), `withTab`, `withSort`, `withSearch`, `clearFilters`, `resetState`, `selectedCount`, `toggle`, `clearGroup`, `isOn`, `appliedChips(s)`, `bestSellerIds(games)`, `view(data, s)`, `shelves(data)`, `countText`, `applyLabel`, `genreList`, `emptyState`.
    - Constants: `TABS`, `BEST_MAX` (10), `SHELF_MAX` (10), `RANKED_MAX` (3).
    - The state is `{ tab, sort, search, consoles, genres, accounts }`.
    - `data` is `{ games, boxes }`, as built by Task 2's `buyShopData()`.
    - `view` returns `{ tab, label, kind ('games'|'boxes'), sort, sorts, tabs, ids, count, ranked, filters, groups, selected }`.
    - `shelves` returns `[{ key, label, kind, count, ids (≤10), href }]`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-buy-view.js`:

````js
// Run: node scripts/test-buy-view.js
//
// What the Buy shop works out from the records (lib/buy-view.js): purchases
// per game, the best-selling order, reading the admin's spotlight form, and
// the storefront's spotlight slides.
const assert = require('assert');
const V = require('../lib/buy-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const g = (id, title) => ({ id, title });

ok('purchases per game: only records filed as bought, by game id', () => {
  const counts = V.saleCounts([
    { game_id: 1, status: 'bought' }, { game_id: '1', status: 'bought' }, { game_id: 2, status: 'bought' },
    { game_id: 2, status: 'renting' }, { game_id: 3, status: 'done' }, { game_id: 'upcoming_4', status: 'bought' }, null
  ]);
  assert.deepStrictEqual(counts, { 1: 2, 2: 1 });
  assert.deepStrictEqual(V.saleCounts(undefined), {});
});

ok('best-selling order: most purchases, then most rented, then title', () => {
  const games = [g(1, 'Alpha'), g(2, 'Bravo'), g(3, 'Charlie'), g(4, 'Delta'), g(5, 'Echo')];
  const counts = { 3: 2, 5: 2, 1: 1 };
  const rentalOrder = [g(5, 'Echo'), g(4, 'Delta'), g(2, 'Bravo')];
  assert.deepStrictEqual(V.bestSellingOrder(games, counts, rentalOrder), [5, 3, 1, 4, 2], 'Echo and Charlie tie on sales; Echo is rented more');
  assert.deepStrictEqual(V.bestSellingOrder(games, {}, []), [1, 2, 3, 4, 5], 'nothing sold or rented: A–Z');
});

ok('the admin form: game and box picks in order; blanks, unknown items and repeats dropped', () => {
  const choices = { games: [1, 2, 3], boxes: [7] };
  const picks = V.readSpotlightForm({ slide_1: 'box:7', slide_2: '', slide_3: 'game:2', slide_4: 'game:2', slide_5: 'game:99', slide_6: 'game:1' }, choices);
  assert.deepStrictEqual(picks, [{ kind: 'box', id: 7 }, { kind: 'game', id: 2 }]);
  assert.deepStrictEqual(V.readSpotlightForm({ slide_1: 'box:2', slide_2: 'nonsense', slide_3: 'game:x' }, choices), []);
  assert.deepStrictEqual(V.readSpotlightForm(undefined, choices), []);
});

ok('spotlight: picks still for sale in order; sold-out box sets and gone games skipped', () => {
  const shop = { games: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], boxes: [{ id: 7, open: true }, { id: 8, open: false }] };
  const slides = V.spotlight([{ kind: 'game', id: 3 }, { kind: 'box', id: 8 }, { kind: 'game', id: 99 }, { kind: 'box', id: 7 }, { kind: 'game', id: 3 }], shop, [1, 2]);
  assert.deepStrictEqual(slides.map(s => s.kind + ':' + s.item.id), ['game:3', 'box:7']);
  assert.strictEqual(slides[0].item, shop.games[2], 'the shop\'s own facts');
  const six = [1, 2, 3, 4, 1, 2].map((id, i) => ({ kind: i < 4 ? 'game' : 'box', id }));
  assert.strictEqual(V.spotlight(six, { games: shop.games, boxes: [{ id: 1, open: true }, { id: 2, open: true }] }, []).length, V.SPOTLIGHT_MAX);
});

ok('spotlight fallback: no picks left → the first 3 best sellers', () => {
  const shop = { games: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], boxes: [{ id: 8, open: false }] };
  assert.deepStrictEqual(V.spotlight([{ kind: 'box', id: 8 }], shop, [4, 2, 1, 3]).map(s => s.item.id), [4, 2, 1]);
  assert.deepStrictEqual(V.spotlight(undefined, shop, [9, 3]).map(s => s.item.id), [3]);
  assert.deepStrictEqual(V.spotlight([], { games: [], boxes: [] }, []), []);
});

console.log('\n' + passed + ' assertions passed\n');
````

Create `scripts/test-buy-catalog-core.js`:

````js
// Run: node scripts/test-buy-catalog-core.js
//
// The Buy shop rules (public/js/buy-catalog-core.js): the URL, which items each
// tab (and so each storefront shelf) holds, the best sellers' top-up, hidden
// tabs, every sort order, search, filters on game tabs only, the filter
// panel's chips, and what the results bar says.
const assert = require('assert');
const C = require('../public/js/buy-catalog-core');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const g = (id, title, o) => Object.assign({
  id, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, text: title.toLowerCase(), cover: '', fx: null, fy: null,
  platform: 'PS5', ps4: false, ps5: true, genres: ['Action'], genre: 'Action', price: 999, was: null,
  nt: true, tr: false, ready: true, sold: 0, order: 99, released: null
}, o || {});
// order is the best-selling order the server builds: sales first, then rentals, then title.
const games = [
  g(1, 'Elden Ring', { price: 1999, sold: 3, order: 2, genres: ['Action', 'RPG'], tr: true, released: '2022-02-25' }),
  g(2, 'GTA V', { sold: 5, order: 1, ps4: true, platform: 'PS4/PS5', released: '2013-09-17' }),
  g(3, 'Spider-Man 2', { price: 2499, order: 4, ready: false, nt: false, tr: true, released: '2023-10-20' }),
  g(4, 'Astro Bot', { price: 1000, order: 5, genres: ['Platformer'], tr: true, released: '2024-09-06' }),
  g(5, 'Bloodborne', { price: 499, sold: 1, order: 3, ps4: true, ps5: false, platform: 'PS4', genres: ['Action', 'RPG'] }),
  g(6, 'Tekken 8', { price: 2000, order: 6, genres: ['Fighting'], released: '2024-01-26' })
];
const box = (id, name, o) => Object.assign({ id, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, text: name.toLowerCase(), gameCount: 2, perGame: null, from: 999, open: true, covers: [], more: 0, tiers: [] }, o || {});
const boxes = [
  box(1, 'PS Hub Main Account', { text: 'ps hub main account\nelden ring\ngta v', gameCount: 12, perGame: 375, from: 4500 }),
  box(2, 'Resident Evil Trilogy', { text: 'resident evil trilogy\nresident evil 2', gameCount: 3, perGame: 500, from: 1499, open: false }),
  box(3, 'Palworld Duo', { from: 899 })
];
const data = { games, boxes };
const st = q => C.parseState(q);
const v = q => C.view(data, C.cleanState(st(q), data));
const chip = (view, group, value) => view.groups.find(x => x.key === group).chips.find(c => c.value === String(value));

console.log('\nURL');
ok('parses tab, sort, search and every filter and writes them back in a stable order', () => {
  const s = st({ tab: 'box-sets', sort: 'az', search: ' x ', console: 'ps4,xbox', genre: 'Action', account: 'tr,zz' });
  assert.strictEqual(C.toQuery(s), 'tab=box-sets&sort=az&search=x&console=ps4&genre=Action&account=tr');
  assert.strictEqual(C.href(C.emptyState()), '/buy/catalog');
});
ok('the tab\'s default order and All games stay out of the address; unknown tab or sort → defaults', () => {
  assert.strictEqual(C.toQuery(st({ tab: 'under-1000', sort: 'price-asc' })), 'tab=under-1000');
  assert.strictEqual(C.toQuery(st({ tab: 'all', sort: 'best-selling' })), '');
  assert.strictEqual(C.toQuery(st({ tab: 'box-sets', sort: 'newest' })), 'tab=box-sets', 'a sort the tab does not offer is dropped');
  assert.strictEqual(st({ tab: 'nope' }).tab, 'all');
  assert.strictEqual(st({ sort: 'cheapest' }).sort, '');
  assert.strictEqual(C.sortOf(st({ tab: '2000-up' })), 'price-asc');
});
ok('clean state drops genres no game has and a tab with nothing in it', () => {
  const s = C.cleanState(st({ tab: 'box-sets', genre: 'Action,Gone' }), { games, boxes: [] });
  assert.deepStrictEqual([s.tab, s.genres], ['all', ['Action']]);
  assert.strictEqual(C.cleanState(st({ tab: 'box-sets' }), data).tab, 'box-sets');
});

console.log('\nTabs and shelves');
ok('each tab holds its own items, in its default order', () => {
  assert.deepStrictEqual(v({}).ids, [2, 1, 5, 3, 4, 6], 'All games: best selling');
  assert.deepStrictEqual(v({ tab: 'best-sellers' }).ids, [2, 1, 5, 3, 4, 6], 'sold games, topped up to 10');
  assert.deepStrictEqual(v({ tab: 'ready-today' }).ids, [2, 1, 5, 4, 6], 'not the set-up-on-order game');
  assert.deepStrictEqual(v({ tab: 'box-sets' }).ids, [1, 2, 3], 'best value: price per game, unknown last');
  assert.deepStrictEqual(v({ tab: 'under-1000' }).ids, [5, 2]);
  assert.deepStrictEqual(v({ tab: '1000-1999' }).ids, [4, 1], '₱1,000 is in the middle shelf, ₱1,999 too');
  assert.deepStrictEqual(v({ tab: '2000-up' }).ids, [6, 3], '₱2,000 starts the top shelf');
  assert.strictEqual(v({ tab: 'box-sets' }).kind, 'boxes');
});
ok('best sellers: only sold games once 10 have sold', () => {
  const many = Array.from({ length: 12 }, (_, i) => g(100 + i, 'Game ' + String(i).padStart(2, '0'), { sold: i < 11 ? 12 - i : 0, order: i + 1 }));
  assert.deepStrictEqual(C.bestSellerIds(many), many.slice(0, 11).map(f => f.id));
  assert.deepStrictEqual(C.bestSellerIds(games), [2, 1, 5, 3, 4, 6]);
});
ok('the tab row: every tab with items, its count for the search and filters, its link', () => {
  const view = v({ tab: 'best-sellers', search: 'elden', sort: 'az' });
  assert.deepStrictEqual(view.tabs.map(t => t.key + ' ' + t.count), ['all 1', 'best-sellers 1', 'ready-today 1', 'box-sets 1', 'under-1000 0', '1000-1999 1', '2000-up 0']);
  assert.deepStrictEqual(view.tabs.filter(t => t.on).map(t => t.key), ['best-sellers']);
  assert.strictEqual(view.tabs.find(t => t.key === 'box-sets').href, '/buy/catalog?tab=box-sets&search=elden', 'another tab keeps the search, starts in its own order');
  const cheap = C.view({ games: games.filter(f => f.price < 1000), boxes: [] }, C.emptyState());
  assert.deepStrictEqual(cheap.tabs.map(t => t.key), ['all', 'best-sellers', 'ready-today', 'under-1000'], 'tabs with nothing are hidden');
});
ok('the storefront\'s shelves: every tab but All games, first 10, empty ones left out', () => {
  const sh = C.shelves(data);
  assert.deepStrictEqual(sh.map(x => x.key), ['best-sellers', 'ready-today', 'box-sets', 'under-1000', '1000-1999', '2000-up']);
  assert.deepStrictEqual(sh[2], { key: 'box-sets', label: 'Box sets', kind: 'boxes', count: 3, ids: [1, 2, 3], href: '/buy/catalog?tab=box-sets' });
  const many = Array.from({ length: 14 }, (_, i) => g(200 + i, 'Cheap ' + String(i).padStart(2, '0'), { price: 299, order: i + 1 }));
  const cheap = C.shelves({ games: many, boxes: [] });
  assert.deepStrictEqual(cheap.map(x => x.key + ' ' + x.ids.length + '/' + x.count), ['best-sellers 10/10', 'ready-today 10/14', 'under-1000 10/14']);
});

console.log('\nSort');
ok('the Sort menu offers each tab its own choices, its default first', () => {
  const keys = q => v(q).sorts.map(o => o.key);
  assert.deepStrictEqual(keys({}), ['best-selling', 'price-asc', 'price-desc', 'az', 'newest']);
  assert.deepStrictEqual(keys({ tab: '1000-1999' }), ['price-asc', 'best-selling', 'price-desc', 'az', 'newest']);
  assert.deepStrictEqual(keys({ tab: 'box-sets' }), ['best-value', 'price-asc', 'az']);
  assert.deepStrictEqual(v({ sort: 'az' }).sorts.filter(o => o.on).map(o => o.label), ['A–Z']);
});
ok('every order: ties by title, missing prices and dates last', () => {
  assert.deepStrictEqual(v({ sort: 'price-asc' }).ids, [5, 2, 4, 1, 6, 3]);
  assert.deepStrictEqual(v({ sort: 'price-desc' }).ids, [3, 6, 1, 4, 2, 5]);
  assert.deepStrictEqual(v({ sort: 'az' }).ids, [4, 5, 1, 2, 3, 6]);
  assert.deepStrictEqual(v({ sort: 'newest' }).ids, [4, 6, 3, 1, 2, 5]);
  assert.deepStrictEqual(v({ tab: 'box-sets', sort: 'price-asc' }).ids, [3, 2, 1]);
  assert.deepStrictEqual(v({ tab: 'box-sets', sort: 'az' }).ids, [3, 1, 2]);
  assert.strictEqual(C.href(C.withSort(st({ tab: 'ready-today' }), 'newest')), '/buy/catalog?tab=ready-today&sort=newest');
});
ok('#1–#3 stickers only on Best sellers in best-selling order', () => {
  assert.strictEqual(v({ tab: 'best-sellers' }).ranked, true);
  assert.strictEqual(v({ tab: 'best-sellers', sort: 'az' }).ranked, false);
  assert.strictEqual(v({}).ranked, false);
});

console.log('\nSearch and filters');
ok('search matches a game\'s title and a box set\'s name or the games inside it', () => {
  assert.deepStrictEqual(v({ search: 'ELDEN' }).ids, [1]);
  assert.deepStrictEqual(v({ tab: 'box-sets', search: 'elden' }).ids, [1]);
  assert.deepStrictEqual(v({ tab: 'box-sets', search: 'resident' }).ids, [2]);
  assert.strictEqual(C.withSearch(C.emptyState(), '  gta ').search, 'gta');
});
ok('filters work on top of a game tab: console, genre, account type', () => {
  assert.deepStrictEqual(v({ console: 'ps4' }).ids, [2, 5]);
  assert.deepStrictEqual(v({ account: 'tr' }).ids, [1, 3, 4]);
  assert.deepStrictEqual(v({ genre: 'RPG' }).ids, [1, 5]);
  assert.deepStrictEqual(v({ tab: '2000-up', account: 'nt' }).ids, [6]);
});
ok('filters do not apply on Box sets (the panel keeps All games\' rows)', () => {
  const b = v({ tab: 'box-sets', console: 'ps4' });
  assert.deepStrictEqual([b.ids, b.filters], [[1, 2, 3], false]);
  assert.strictEqual(chip(b, 'console', 'ps4').count, 2, 'counted on All games');
  assert.strictEqual(b.selected, 1, 'the filters are kept for the other tabs');
});
ok('panel chips count what the tab would show; a chip nothing has is left out', () => {
  const view = v({});
  assert.deepStrictEqual(view.groups.map(x => x.key), ['console', 'genre', 'account']);
  assert.deepStrictEqual(view.groups[1].chips.map(c => c.value), ['Action', 'Fighting', 'Platformer', 'RPG']);
  assert.strictEqual(chip(view, 'account', 'tr').count, 3);
  const top = v({ tab: '2000-up' });
  assert.deepStrictEqual([chip(top, 'console', 'ps4').count, chip(top, 'console', 'ps4').zero, chip(top, 'console', 'ps4').href], [0, true, null]);
  assert.strictEqual(chip(view, 'genre', 'RPG').href, '/buy/catalog?genre=RPG');
});
ok('the filter bar: one chip per filter; Clear all and the empty grid\'s reset', () => {
  const s = st({ tab: 'ready-today', sort: 'az', search: 'x', console: 'ps5', genre: 'Action', account: 'nt' });
  const chips = C.appliedChips(s);
  assert.deepStrictEqual(chips.map(c => c.label), ['PS5', 'Action', 'Non-Trophy']);
  assert.strictEqual(chips[0].href, '/buy/catalog?tab=ready-today&sort=az&search=x&genre=Action&account=nt');
  assert.strictEqual(C.href(C.clearFilters(s)), '/buy/catalog?tab=ready-today&sort=az&search=x');
  assert.strictEqual(C.href(C.resetState(s)), '/buy/catalog?tab=ready-today&sort=az');
  assert.strictEqual(C.selectedCount(s), 3);
  assert.deepStrictEqual(C.clearGroup(s, 'genre').genres, []);
  assert.strictEqual(C.isOn(s, 'account', 'nt'), true);
});
ok('the results bar and the panel button', () => {
  assert.strictEqual(C.countText(v({ tab: 'box-sets' })), 'Box sets · 3 box sets');
  assert.strictEqual(C.countText(v({ tab: 'under-1000' })), 'Under ₱1,000 · 2 games');
  assert.strictEqual(C.countText(v({ tab: '2000-up', console: 'ps5', account: 'tr' })), '₱2,000 and up · 1 game');
  assert.deepStrictEqual(C.applyLabel(v({ tab: 'ready-today' })), { text: 'Show 5 games', disabled: false });
  assert.deepStrictEqual(C.applyLabel(v({ search: 'zzz' })), { text: 'No games match', disabled: true });
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-buy-view.js` → FAIL `Error: Cannot find module '../lib/buy-view'`.
Run: `node scripts/test-buy-catalog-core.js` → FAIL `Error: Cannot find module '../public/js/buy-catalog-core'`.

- [ ] **Step 3: Write the modules**

Create `lib/buy-view.js`:

````js
// What the Buy shop (GET /buy, GET /buy/catalog) works out before its rules
// file (public/js/buy-catalog-core.js) takes over: how many times each game
// has been bought, the best-selling order, and the admin's spotlight picks —
// reading them from the admin form and turning them into the storefront's
// slides. Pure: server.js passes in the games, customers and settings.
// See docs/superpowers/specs/2026-10-11-buy-game-shop-design.md.

const SPOTLIGHT_MAX = 5;
const SPOTLIGHT_FALLBACK = 3;

// Purchases per game: customer records filed as 'bought', by game id.
function saleCounts(customers) {
  const out = {};
  (customers || []).forEach(c => {
    if (!c || c.status !== 'bought') return;
    const id = Number(c.game_id);
    if (!Number.isInteger(id)) return;
    out[id] = (out[id] || 0) + 1;
  });
  return out;
}

// Game ids, best selling first: most purchases, then the Rent "Most rented"
// order (rentalOrder: games, most rented first), then title.
function bestSellingOrder(games, counts, rentalOrder) {
  const rentPos = new Map((rentalOrder || []).map((g, i) => [Number(g.id), i]));
  const pos = g => (rentPos.has(Number(g.id)) ? rentPos.get(Number(g.id)) : Infinity);
  return (games || []).slice()
    .sort((a, b) => ((counts[b.id] || 0) - (counts[a.id] || 0)) || (pos(a) - pos(b)) || a.title.localeCompare(b.title))
    .map(g => Number(g.id));
}

// The admin form's slide_1..slide_5 ("game:12" / "box:3") → picks in order;
// blanks, anything not on offer and repeats are dropped.
function readSpotlightForm(body, choices) {
  const b = body || {};
  const games = new Set((choices.games || []).map(Number));
  const boxes = new Set((choices.boxes || []).map(Number));
  const out = [];
  for (let i = 1; i <= SPOTLIGHT_MAX; i++) {
    const m = /^(game|box):(\d+)$/.exec(String(b['slide_' + i] || ''));
    if (!m) continue;
    const pick = { kind: m[1], id: Number(m[2]) };
    if (!(pick.kind === 'game' ? games : boxes).has(pick.id)) continue;
    if (out.some(p => p.kind === pick.kind && p.id === pick.id)) continue;
    out.push(pick);
  }
  return out;
}

// The storefront's spotlight slides: the picks still for sale (a game in the
// shop; a box set with a tier that can be bought), in order; when none are
// left, the first 3 best sellers. Each slide is { kind, item }.
function spotlight(picks, shop, bestIds) {
  const gameById = new Map((shop.games || []).map(f => [Number(f.id), f]));
  const boxById = new Map((shop.boxes || []).map(b => [Number(b.id), b]));
  const slides = [];
  (Array.isArray(picks) ? picks : []).forEach(p => {
    if (!p || slides.length >= SPOTLIGHT_MAX) return;
    const item = p.kind === 'game' ? gameById.get(Number(p.id)) : p.kind === 'box' ? boxById.get(Number(p.id)) : null;
    if (!item || (p.kind === 'box' && !item.open)) return;
    if (slides.some(s => s.kind === p.kind && s.item === item)) return;
    slides.push({ kind: p.kind, item });
  });
  if (slides.length) return slides;
  return (bestIds || []).map(id => gameById.get(Number(id))).filter(Boolean)
    .slice(0, SPOTLIGHT_FALLBACK).map(item => ({ kind: 'game', item }));
}

module.exports = { SPOTLIGHT_MAX, SPOTLIGHT_FALLBACK, saleCounts, bestSellingOrder, readSpotlightForm, spotlight };
````

Create `public/js/buy-catalog-core.js`:

````js
// The pure half of the Buy shop (views/buy.ejs, views/buy-catalog.ejs): the
// catalog tabs (which double as the storefront's shelves), the Sort menu, the
// search box and the filters — reading and writing the URL, which items each
// tab holds and in what order, and what each filter chip would give. No DOM
// here — the server uses it for the storefront shelves and the catalog's
// first render (server.js GET /buy, GET /buy/catalog) and
// public/js/buy-catalog.js uses the same rules for every click.
//
// data: { games, boxes }
//  - a game for sale (server.js buyShopData):
//    { id, slug, title, text (lowercased search text), cover, fx, fy, platform,
//      ps4, ps5, genres: [..], genre (first part), price (lowest sellable
//      final price), was (base price when the buy promo cuts it | null),
//      nt, tr (that account type can still be bought), ready (in stock),
//      sold (purchases), order (1 = best selling), released ('YYYY-MM-DD' | null) }
//  - a box set: { id, slug, name, text, gameCount, perGame (| null), from,
//      open (a tier can be bought), covers: [{ title, cover }], more, tiers }
//
// See docs/superpowers/specs/2026-10-11-buy-game-shop-design.md.
(function (root) {
  var TABS = [
    ['all', 'All games'], ['best-sellers', 'Best sellers'], ['ready-today', 'Ready today'], ['box-sets', 'Box sets'],
    ['under-1000', 'Under ₱1,000'], ['1000-1999', '₱1,000 – ₱1,999'], ['2000-up', '₱2,000 and up']
  ];
  var SORTS = {
    'best-selling': 'Best selling', 'price-asc': 'Price: low to high', 'price-desc': 'Price: high to low',
    az: 'A–Z', newest: 'Newest', 'best-value': 'Best value'
  };
  var GAME_SORTS = ['best-selling', 'price-asc', 'price-desc', 'az', 'newest'];
  var PRICE_FIRST = ['price-asc', 'best-selling', 'price-desc', 'az', 'newest'];
  var BOX_SORTS = ['best-value', 'price-asc', 'az'];
  var CONSOLES = [['ps4', 'PS4'], ['ps5', 'PS5']];
  var ACCOUNTS = [['nt', 'Non-Trophy'], ['tr', 'Trophy']];
  var BEST_MAX = 10;
  var SHELF_MAX = 10;
  var RANKED_MAX = 3;

  function first(v) { return Array.isArray(v) ? v[0] : v; }

  // "a,b" (or ["a", "b,c"]) → ['a', 'b', 'c'], trimmed, no blanks, no repeats.
  function list(v) {
    var out = [];
    [].concat(v == null ? [] : v).forEach(function (s) {
      String(s).split(',').forEach(function (p) {
        p = p.trim();
        if (p && out.indexOf(p) < 0) out.push(p);
      });
    });
    return out;
  }

  function genreList(games) {
    var seen = [];
    (games || []).forEach(function (f) {
      (f.genres || []).forEach(function (g) { if (seen.indexOf(g) < 0) seen.push(g); });
    });
    return seen.sort(function (a, b) { return a.localeCompare(b); });
  }

  function tabLabel(key) {
    var t = TABS.filter(function (d) { return d[0] === key; })[0];
    return t ? t[1] : '';
  }
  function isTab(key) { return !!tabLabel(key); }
  function kindOf(tab) { return tab === 'box-sets' ? 'boxes' : 'games'; }

  // The Sort menu's choices for a tab; the tab's default first.
  function sortsFor(tab) {
    if (tab === 'box-sets') return BOX_SORTS;
    if (tab === 'under-1000' || tab === '1000-1999' || tab === '2000-up') return PRICE_FIRST;
    return GAME_SORTS;
  }
  function sortOf(s) { var o = sortsFor(s.tab); return o.indexOf(s.sort) >= 0 ? s.sort : o[0]; }

  function emptyState() { return { tab: 'all', sort: '', search: '', consoles: [], genres: [], accounts: [] }; }

  function clone(s) {
    return { tab: s.tab, sort: s.sort, search: s.search, consoles: s.consoles.slice(), genres: s.genres.slice(), accounts: s.accounts.slice() };
  }

  // URL query (Express req.query or Object.fromEntries(URLSearchParams)) → state.
  function parseState(q) {
    q = q || {};
    var s = emptyState();
    var tab = first(q.tab);
    if (isTab(tab)) s.tab = tab;
    var sort = first(q.sort);
    s.sort = SORTS[sort] ? sort : '';
    var search = first(q.search);
    s.search = String(search == null ? '' : search).trim();
    s.consoles = list(q.console).filter(function (c) { return c === 'ps4' || c === 'ps5'; });
    s.genres = list(q.genre);
    s.accounts = list(q.account).filter(function (a) { return a === 'nt' || a === 'tr'; });
    return s;
  }

  // The best sellers: every game that has sold, in best-selling order, topped
  // up to 10 with the next best-selling games while fewer than 10 have sold.
  function bestSellerIds(games) {
    var byOrder = (games || []).slice().sort(function (a, b) { return a.order - b.order; });
    var sold = byOrder.filter(function (f) { return f.sold > 0; });
    var ids = sold.length >= BEST_MAX ? sold : sold.concat(byOrder.filter(function (f) { return !(f.sold > 0); }).slice(0, BEST_MAX - sold.length));
    return ids.map(function (f) { return f.id; });
  }

  function inTab(f, tab, best) {
    if (tab === 'best-sellers') return best.indexOf(f.id) >= 0;
    if (tab === 'ready-today') return !!f.ready;
    if (tab === 'under-1000') return f.price < 1000;
    if (tab === '1000-1999') return f.price >= 1000 && f.price < 2000;
    if (tab === '2000-up') return f.price >= 2000;
    return true;
  }

  function members(data, tab, best) {
    if (kindOf(tab) === 'boxes') return data.boxes || [];
    return (data.games || []).filter(function (f) { return inTab(f, tab, best); });
  }

  // A tab shows only when it holds something (All games always does).
  function tabVisible(data, tab) {
    if (tab === 'all') return true;
    return isTab(tab) && members(data, tab, bestSellerIds(data.games)).length > 0;
  }

  // Drops a genre no game has any more (an old shared link) and a tab with
  // nothing in it, so nothing can silently hide every game.
  function cleanState(s, data) {
    var n = clone(s);
    var genres = genreList(data.games);
    n.genres = n.genres.filter(function (g) { return genres.indexOf(g) >= 0; });
    if (!tabVisible(data, n.tab)) n.tab = 'all';
    return n;
  }

  function toQuery(s) {
    var parts = [];
    if (s.tab && s.tab !== 'all') parts.push('tab=' + s.tab);
    if (sortOf(s) !== sortsFor(s.tab)[0]) parts.push('sort=' + sortOf(s));
    if (s.search) parts.push('search=' + encodeURIComponent(s.search));
    if (s.consoles.length) parts.push('console=' + s.consoles.join(','));
    if (s.genres.length) parts.push('genre=' + s.genres.map(encodeURIComponent).join(','));
    if (s.accounts.length) parts.push('account=' + s.accounts.join(','));
    return parts.join('&');
  }

  function href(s) {
    var q = toQuery(s);
    return '/buy/catalog' + (q ? '?' + q : '');
  }

  // Another tab keeps the search and filters and starts in its own default order.
  function withTab(s, tab) { var n = clone(s); n.tab = tab; n.sort = ''; return n; }
  function withSort(s, sort) { var n = clone(s); n.sort = sort; return n; }
  function withSearch(s, search) { var n = clone(s); n.search = String(search == null ? '' : search).trim(); return n; }

  // The filter bar's "Clear all": filters off; tab, order and search stay.
  function clearFilters(s) { var n = clone(s); n.consoles = []; n.genres = []; n.accounts = []; return n; }

  // The empty grid's "Clear filters": search and filters off; the tab stays.
  function resetState(s) { var n = clearFilters(s); n.search = ''; return n; }

  function selectedCount(s) { return s.consoles.length + s.genres.length + s.accounts.length; }

  var GROUP_FIELD = { console: 'consoles', genre: 'genres', account: 'accounts' };

  function toggle(s, group, value) {
    var n = clone(s);
    var arr = n[GROUP_FIELD[group]];
    if (!arr) return n;
    value = String(value);
    var i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1); else arr.push(value);
    return n;
  }

  function clearGroup(s, group) {
    var n = clone(s);
    if (GROUP_FIELD[group]) n[GROUP_FIELD[group]] = [];
    return n;
  }

  function isOn(s, group, value) {
    var arr = s[GROUP_FIELD[group]];
    return !!arr && arr.indexOf(String(value)) >= 0;
  }

  // The filter bar's removable chips: one per applied filter.
  function appliedChips(s) {
    var out = [];
    var add = function (group, value, label) { out.push({ group: group, value: String(value), label: label, href: href(toggle(s, group, value)) }); };
    CONSOLES.forEach(function (d) { if (s.consoles.indexOf(d[0]) >= 0) add('console', d[0], d[1]); });
    s.genres.forEach(function (g) { add('genre', g, g); });
    ACCOUNTS.forEach(function (d) { if (s.accounts.indexOf(d[0]) >= 0) add('account', d[0], d[1]); });
    return out;
  }

  function searchHit(text, s) {
    var q = s.search.toLowerCase();
    return !q || String(text).toLowerCase().indexOf(q) >= 0;
  }

  function filterHit(f, s) {
    if (s.consoles.length && !s.consoles.some(function (c) { return f[c]; })) return false;
    if (s.genres.length && !s.genres.some(function (g) { return f.genres.indexOf(g) >= 0; })) return false;
    if (s.accounts.length && !s.accounts.some(function (a) { return f[a]; })) return false;
    return true;
  }

  // What the tab shows for the search and (games only) the filters.
  function matches(data, s, best) {
    var boxes = kindOf(s.tab) === 'boxes';
    return members(data, s.tab, best).filter(function (x) {
      return searchHit(x.text, s) && (boxes || filterHit(x, s));
    });
  }

  // a before b (−1) / after (1) by one value, missing values last.
  function cmp(x, y, dir) {
    var nx = x == null, ny = y == null;
    if (nx || ny) return nx === ny ? 0 : (nx ? 1 : -1);
    return x < y ? -dir : x > y ? dir : 0;
  }
  var ORDER = {
    'best-selling': function (a, b) { return cmp(a.order, b.order, 1); },
    'price-asc': function (a, b) { return cmp(a.kind === 'box' ? a.from : a.price, b.kind === 'box' ? b.from : b.price, 1); },
    'price-desc': function (a, b) { return cmp(a.price, b.price, -1); },
    newest: function (a, b) { return cmp(a.released, b.released, -1); },
    'best-value': function (a, b) { return cmp(a.perGame, b.perGame, 1); },
    az: function () { return 0; }
  };
  // Ties (and A–Z) by title; box sets by name.
  function ordered(items, sort) {
    return items.slice().sort(function (a, b) {
      return ORDER[sort](a, b) || String(a.title || a.name).localeCompare(String(b.title || b.name));
    });
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // A filter chip in the panel: how many games the tab would show with it
  // flipped; a chip that would leave nothing is greyed out.
  function chipFor(data, s, best, group, value, label) {
    var on = isOn(s, group, value);
    var count = matches(data, on ? s : toggle(s, group, value), best).length;
    var zero = !on && count === 0;
    return { group: group, value: String(value), label: label, count: count, on: on, zero: zero, href: zero ? null : href(toggle(s, group, value)) };
  }

  // A chip exists only if some game in the whole shop has it.
  function exists(data, best, group, value) {
    return matches(data, toggle(emptyState(), group, value), best).length > 0;
  }

  function chipGroups(data, s, best) {
    var groups = [];
    function group(key, label, defs) {
      var chips = defs.filter(function (d) { return exists(data, best, key, d[0]); })
        .map(function (d) { return chipFor(data, s, best, key, d[0], d[1]); });
      if (chips.length) groups.push({ key: key, label: label, chips: chips });
    }
    group('console', 'Console', CONSOLES);
    group('genre', 'Genre', genreList(data.games).map(function (g) { return [g, g]; }));
    group('account', 'Account', ACCOUNTS);
    return groups;
  }

  // Everything a render needs for one state.
  function view(data, s) {
    var best = bestSellerIds(data.games);
    var kind = kindOf(s.tab);
    var sort = sortOf(s);
    var items = matches(data, s, best);
    if (kind === 'boxes') items = items.map(function (b) { return Object.assign({ kind: 'box' }, b); });
    var hits = ordered(items, sort);
    var games = kind === 'games';
    return {
      tab: s.tab,
      label: tabLabel(s.tab),
      kind: kind,
      sort: sort,
      sorts: sortsFor(s.tab).map(function (k) { return { key: k, label: SORTS[k], on: k === sort }; }),
      tabs: TABS.filter(function (t) { return tabVisible(data, t[0]); }).map(function (t) {
        var other = withTab(s, t[0]);
        return { key: t[0], label: t[1], count: matches(data, other, best).length, on: t[0] === s.tab, href: href(other) };
      }),
      ids: hits.map(function (x) { return x.id; }),
      count: hits.length,
      ranked: s.tab === 'best-sellers' && sort === 'best-selling',
      filters: games,
      // The panel's rows stay those of All games on Box sets, where filters do not apply.
      groups: chipGroups(data, games ? s : withTab(s, 'all'), best),
      selected: selectedCount(s)
    };
  }

  // The storefront's shelves: every tab but All games, its first 10 in its
  // default order (empty ones left out).
  function shelves(data) {
    return TABS.filter(function (t) { return t[0] !== 'all'; }).map(function (t) {
      var v = view(data, withTab(emptyState(), t[0]));
      return { key: t[0], label: t[1], kind: v.kind, count: v.count, ids: v.ids.slice(0, SHELF_MAX), href: href(withTab(emptyState(), t[0])) };
    }).filter(function (sh) { return sh.count > 0; });
  }

  // The results bar: "Best sellers · 10 games" ("Box sets · 3 box sets").
  function countText(v) { return v.label + ' · ' + plural(v.count, v.kind === 'boxes' ? 'box set' : 'game'); }

  // The filter panel's big button for a draft's view.
  function applyLabel(v) {
    return v.count ? { text: 'Show ' + plural(v.count, 'game'), disabled: false } : { text: 'No games match', disabled: true };
  }

  var api = {
    TABS: TABS, BEST_MAX: BEST_MAX, SHELF_MAX: SHELF_MAX, RANKED_MAX: RANKED_MAX,
    genreList: genreList, emptyState: emptyState, parseState: parseState, cleanState: cleanState, tabVisible: tabVisible,
    sortOf: sortOf, toQuery: toQuery, href: href, withTab: withTab, withSort: withSort, withSearch: withSearch,
    clearFilters: clearFilters, resetState: resetState, selectedCount: selectedCount, toggle: toggle, clearGroup: clearGroup,
    isOn: isOn, appliedChips: appliedChips, bestSellerIds: bestSellerIds, view: view, shelves: shelves,
    countText: countText, applyLabel: applyLabel
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BuyCatalogCore = api;
})(typeof window !== 'undefined' ? window : this);
````

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-buy-view.js && node scripts/test-buy-catalog-core.js` → `5`, `16 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/buy-view.js public/js/buy-catalog-core.js scripts/test-buy-view.js scripts/test-buy-catalog-core.js
git commit -m "Buy shop rules: tabs, shelves, sorts, filters, best sellers and the spotlight

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The storefront and the catalog

**Files:**
- Create: `scripts/test-buy-page.js`, `views/buy-catalog.ejs`, `views/partials/shop-card.ejs`, `views/partials/shop-box.ejs`, `public/js/buy-catalog.js`, `public/js/shop.js`, `public/css/shop.css`, `.superpowers/tmp-edits/rep.js`, `.superpowers/tmp-edits/edit-buy-server.js`, `.superpowers/tmp-edits/edit-buy-leftovers.js`
- Create (replacing the whole file): `views/buy.ejs`
- Modify (edit script): `server.js`, `public/css/style.css`, `public/js/home.js`

**Interfaces:**
- Consumes:
  - From Task 1: `buyView.saleCounts`, `buyView.bestSellingOrder`, `buyView.spotlight`, and from `buyCatalogCore`: `shelves`, `bestSellerIds`, `parseState`, `cleanState`, `view`, `appliedChips`, `countText`, `applyLabel`, `href`, `clearFilters`, `resetState`.
  - From `server.js`: `getGames`, `getAccounts`, `getCustomers`, `buildBundleGames`, `bundleSlotInfo`, `buildAccountSummaryMap`, `computeAvailability`, `buyTypeSellable`, `buyPricing.priceFor`, `browseCore.genreParts`, `homeView.rentalRanking`, `gameSlug`, `reviewBlockLocals`.
  - The Rent catalog's `public/css/browse-filters.css` (`.bf-*` classes) and `views/partials/browse-filter-option.ejs`.
  - `public/js/home.js` (driven by the ids `hmBanner`, `hmSlides`, `hmPrev`, `hmNext` and the class `.hm-dot`).
- Produces:
  - `buyBoxSets(allGames)` and `buyShopData()` → `{ games, boxes }` in `server.js`; Task 3 uses `buyBoxSets`.
  - Routes `GET /buy` and `GET /buy/catalog`.
  - The storefront reads `settings.buy_spotlight`.
  - The catalog's ids: `scTop`, `scSearchForm`, `scSearch`, `scTabs`, `scBar`, `scCount`, `scSortWrap`, `scSort`, `scOpen`, `scOpenN`, `scChips`, `scPanel`, `scForm`, `scClose`, `scBackdrop`, `scClearAll`, `scGo`, `scResults`, `scEmpty`, `scReset`, `scGrid` (`.shop-item[data-id]`), `scBoxGrid` (`.shop-item[data-box]`).

- [ ] **Step 1: Write the failing test**

Create `scripts/test-buy-page.js`:

````js
// Run: node scripts/test-buy-page.js
//
// The Buy shop as the server renders it: the storefront (header and search,
// the owner's spotlight with sold-out and gone picks skipped, a shelf per tab
// with its first items, stickers, stock tags, promo prices, box sets, the
// kept bottom cards and the order error banner) and the catalog (tabs and
// counts, each tab's grid order, best-seller stickers, box sets, sort and
// search in the address, filters and their chips, the filter panel, the
// empty grid, the facts handed to the page script). The rules themselves:
// scripts/test-buy-catalog-core.js and scripts/test-buy-view.js.
// Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory
// sessions, a made-up admin password); the project's games.json and the
// database are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4633;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buy-page-'));
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '/uploads/' + id + '.png', renters: 1,
  nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 1, trophy_slots: 1
}, extra || {});
const slots = (nt, tr) => ({ non_trophy: { enabled: true, status: nt }, trophy: { enabled: true, status: tr }, ps4_primary: { enabled: false, status: 'open' } });
const acc = (id, name, gameIds, o) => Object.assign({ id, label: name, public_name: name, email: '', for_sale: true, game_ids: gameIds, slots: slots('open', 'open') }, o || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  site_settings: {
    promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100, buy_promo_enabled: true, buy_promo_pct: 10 },
    buy_spotlight: [{ kind: 'game', id: 4 }, { kind: 'box', id: 2 }, { kind: 'game', id: 6 }, { kind: 'box', id: 1 }]
  },
  games: [
    game(1, 'Zzyzx Astro', { buy_nt_price: 999, buy_tr_price: 1499, renters: 2, genre: 'Platformer', release_date: '2024-09-06' }),
    game(2, 'Zzyzx Elden', { buy_nt_price: 1999, renters: 5, genre: 'Action, RPG', platform: 'PS4/PS5' }),
    game(3, 'Zzyzx Tekken', { buy_tr_price: 2499, genre: 'Fighting' }),
    game(4, 'Zzyzx Callisto', { buy_nt_price: 1299, renters: 0, genre: 'Horror' }),
    game(5, 'Zzyzx Plain & <Co>', { buy_nt_price: 499, renters: 3, platform: 'PS4' }),
    game(6, 'Zzyzx NoBuy'),
    game(7, 'Zzyzx Full', { buy_nt_price: 899, renters: 4, non_trophy_slots: 0, trophy_slots: 0 })
  ],
  accounts: [
    acc(1, 'Zzyzx Box Big', [1, 2, 3], { price_permanent_nt: 3000, price_permanent_tr: 3600 }),
    acc(2, 'Zzyzx Box Gone', [6, 7], { price_permanent_nt: 1500, price_permanent_tr: 1800, slots: slots('buyed', 'rented') }),
    acc(3, 'Zzyzx NoBuy', [6], { price_permanent_nt: 700 }),
    acc(4, 'Zzyzx Hidden Box', [1, 2], { for_sale: false, price_permanent_nt: 900 })
  ],
  customers: [
    { id: 1, game_id: 3, status: 'bought', customer_name: 'Zzyzx A' }, { id: 2, game_id: 3, status: 'bought', customer_name: 'Zzyzx B' },
    { id: 3, game_id: 5, status: 'bought', customer_name: 'Zzyzx C' }
  ],
  reviews: [{ id: 1, name: 'Zzyzx Reviewer', text: 'Smooth purchase', rating: 5, visible: true, private: false, created_at: '2026-10-01T00:00:00.000Z' }]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.end();
  });
}
async function page(p) { const r = await call(p); assert.strictEqual(r.status, 200, p); return r.body; }
function between(html, startId, endId) {
  const i = html.indexOf('id="' + startId + '"');
  assert.ok(i >= 0, startId + ' found');
  const j = endId ? html.indexOf('id="' + endId + '"', i) : html.length;
  return html.slice(i, j);
}
const opening = (html, id) => { const i = html.indexOf('id="' + id + '"'); return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1); };
const unamp = s => s.replace(/&amp;/g, '&');
const titles = html => [...html.matchAll(/<span class="shop-title">([^<]*)<\/span>/g)].map(m => m[1].replace('Zzyzx ', ''));
const boxNames = html => [...html.matchAll(/<span class="shop-box-name">([^<]*)<\/span>/g)].map(m => m[1].replace('Zzyzx ', ''));
const shelf = (html, key) => { const i = html.indexOf('id="shelf-' + key + '"'); assert.ok(i >= 0, key); return html.slice(i, html.indexOf('</section>', i)); };
const card = (html, slug) => { const m = new RegExp('<a href="/game/' + slug + '\\?mode=buy" class="shop-card">[\\s\\S]*?</a>').exec(html); assert.ok(m, slug); return m[0]; };
const shown = (html, grid, attr) => [...between(html, grid).split('</div>\n</div>')[0].matchAll(new RegExp('<div class="shop-item" data-' + attr + '="(\\d+)"( hidden)?>', 'g'))].filter(m => !m[2]).map(m => Number(m[1]));
const tabs = html => [...between(html, 'scTabs', 'scBar').matchAll(/<a class="bf-tab( on)?" data-tab="([\w-]+)" href="([^"]*)"[^>]*>([^<]*?) <span class="bf-tab-n">(\d+)<\/span><\/a>/g)]
  .map(m => ({ key: m[2], on: !!m[1], href: unamp(m[3]), count: Number(m[5]) }));
const sorts = html => [...between(html, 'scSort', 'scOpen').matchAll(/<option value="([\w-]+)"( selected)?>/g)].map(m => (m[2] ? '*' : '') + m[1]);
const ranks = html => [...between(html, 'scGrid', 'scBoxGrid').matchAll(/<span class="shop-rank shop-rank-(\d)"( hidden)?>/g)].map(m => (m[2] ? 'hidden ' : '') + '#' + m[1]);
function shopData(html) {
  const m = /<script type="application\/json" id="shopData">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'embedded data');
  return JSON.parse(m[1]);
}

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const shop = await page('/buy');

  console.log('\nthe storefront');
  await okAsync('the shop header: title, search into the catalog, All games', async () => {
    assert.ok(shop.includes('<span class="shop-kicker">The game shop</span>') && shop.includes('<h1>Buy games · own them forever</h1>'));
    assert.ok(shop.includes('<form class="shop-search" method="get" action="/buy/catalog" role="search">'));
    assert.ok(shop.includes('placeholder="Search 5 games to own…"'), 'only games that can still be bought');
    assert.ok(shop.includes('<a class="shop-all" href="/buy/catalog">All games ›</a>'));
    ['/css/shop.css', '/js/home.js', '/js/shop.js'].forEach(src => assert.ok(shop.includes(src + '?v='), src));
  });
  await okAsync('the spotlight: the owner\'s picks in order, sold-out box sets and games not for sale skipped', async () => {
    const spot = between(shop, 'hmBanner', 'shelf-best-sellers');
    assert.deepStrictEqual([...spot.matchAll(/<span class="shop-slide-title">([^<]*)<\/span>/g)].map(m => m[1]), ['Zzyzx Callisto', 'Zzyzx Box Big']);
    assert.ok(spot.includes('<a class="shop-slide" href="/game/zzyzx-callisto?mode=buy">') && spot.includes('<a class="shop-slide" href="/bundle/zzyzx-box-big">'));
    assert.ok(spot.includes('<span class="shop-slide-sticker">₱1,169</span>'), 'a game: its price after the buy promo');
    assert.ok(spot.includes('<span class="shop-slide-sticker">from ₱3,000</span>'), 'a box set: its cheapest open type');
    assert.ok(spot.includes('<span class="shop-stock shop-wait">Set up on order</span>'));
    assert.strictEqual((spot.match(/class="hm-dot/g) || []).length, 2);
    assert.ok(spot.includes('id="hmPrev"') && spot.includes('id="hmSlides"'), 'the homepage banner script drives it');
  });
  await okAsync('a shelf per tab, in order, each with its first items and See all', async () => {
    assert.deepStrictEqual([...shop.matchAll(/<section class="shop-shelf" id="shelf-([\w-]+)">/g)].map(m => m[1]), ['best-sellers', 'ready-today', 'box-sets', 'under-1000', '1000-1999', '2000-up']);
    assert.deepStrictEqual(titles(shelf(shop, 'best-sellers')), ['Tekken', 'Plain &amp; &lt;Co&gt;', 'Elden', 'Astro', 'Callisto'], 'sold first, then the most rented, topped up');
    assert.deepStrictEqual(titles(shelf(shop, 'ready-today')), ['Tekken', 'Plain &amp; &lt;Co&gt;', 'Elden', 'Astro']);
    assert.deepStrictEqual(boxNames(shelf(shop, 'box-sets')), ['Box Gone', 'Box Big'], 'best value first; the one-game account and the hidden one left out');
    assert.deepStrictEqual(titles(shelf(shop, 'under-1000')), ['Plain &amp; &lt;Co&gt;', 'Astro']);
    assert.deepStrictEqual(titles(shelf(shop, '1000-1999')), ['Callisto', 'Elden']);
    assert.deepStrictEqual(titles(shelf(shop, '2000-up')), ['Tekken']);
    assert.ok(shelf(shop, 'best-sellers').includes('<a class="shop-seeall" href="/buy/catalog?tab=best-sellers">See all ›</a>'));
    assert.ok(shelf(shop, '1000-1999').includes('<span class="shop-note">2 games</span>') && shelf(shop, '1000-1999').includes('href="/buy/catalog?tab=1000-1999"'));
    const cards = titles(shop);
    assert.ok(!cards.includes('NoBuy') && !cards.includes('Full') && !shop.includes('Zzyzx Hidden Box'), 'nothing that cannot be bought');
  });
  await okAsync('cards: best-seller stickers, stock tags, the cheapest type\'s price with the promo base struck', async () => {
    const best = shelf(shop, 'best-sellers');
    assert.deepStrictEqual([...best.matchAll(/<span class="shop-rank shop-rank-(\d)">#\d<\/span>/g)].map(m => m[1]), ['1', '2', '3']);
    const astro = card(shop, 'zzyzx-astro');
    assert.ok(astro.includes('<span class="shop-price">₱899 <s>₱999</s></span>'), 'Non-Trophy is the cheaper type');
    assert.ok(astro.includes('<span class="shop-stock shop-in">In stock</span>') && astro.includes('<span class="shop-meta">PS5 · Platformer</span>'));
    assert.ok(card(shop, 'zzyzx-tekken').includes('₱2,249 <s>₱2,499</s>'), 'Trophy only');
    assert.ok(card(shop, 'zzyzx-callisto').includes('<span class="shop-stock shop-wait">Set up on order</span>'));
  });
  await okAsync('box-set cards: covers, games, price per game, a sticker per type with why it is taken', async () => {
    const gone = /<a href="\/bundle\/zzyzx-box-gone" class="shop-box">[\s\S]*?<\/a>/.exec(shop)[0];
    assert.ok(gone.includes('<span class="shop-meta">2 games · from ₱750 per game</span>'));
    assert.ok(gone.includes('<span class="shop-tier shop-tier-off">Non-Trophy ₱1,500 · Sold</span>') && gone.includes('<span class="shop-tier shop-tier-off">Trophy ₱1,800 · Rented</span>'));
    const big = /<a href="\/bundle\/zzyzx-box-big" class="shop-box">[\s\S]*?<\/a>/.exec(shop)[0];
    assert.strictEqual((big.match(/<img /g) || []).length, 3);
    assert.ok(big.includes('<span class="shop-tier">Non-Trophy ₱3,000</span>'));
  });
  await okAsync('kept: Build your own, Request a game, the reviews; the old price sections are gone', async () => {
    assert.ok(shop.includes('📦 Build your own') && shop.includes('<a href="/requests" class="buy-placeholder-cta">Request a game</a>'));
    assert.ok(shop.includes('id="gdrq"'), 'the reviews strip');
    ['buy-price-section', 'buyAvailToggle', 'Available today only', 'buy-bundle-card'].forEach(t => assert.ok(!shop.includes(t), t));
    assert.ok((await page('/buy?order_error=sold')).includes('That slot just sold — sorry! Pick another below.'));
  });

  console.log('\nthe catalog');
  const all = await page('/buy/catalog');
  await okAsync('the tab row with counts, All games on, every game in best-selling order', async () => {
    assert.deepStrictEqual(tabs(all).map(t => t.key + ' ' + t.count), ['all 5', 'best-sellers 5', 'ready-today 4', 'box-sets 2', 'under-1000 2', '1000-1999 2', '2000-up 1']);
    assert.ok(all.includes('data-tab="all" href="/buy/catalog" aria-current="page"'));
    assert.deepStrictEqual(shown(all, 'scGrid', 'id'), [3, 5, 2, 1, 4]);
    assert.deepStrictEqual(ranks(all), ['hidden #1', 'hidden #2', 'hidden #3'], 'stickers wait for Best sellers');
    assert.ok(all.includes('<a class="shop-back" href="/buy">‹ Back to the shop</a>'));
    assert.ok(opening(all, 'scBoxGrid').includes(' hidden'));
    assert.ok(/<span class="bf-count" id="scCount">All games · 5 games<\/span>/.test(all));
  });
  await okAsync('Best sellers shows #1–#3; Box sets shows box-set cards, its own sorts and no Filters', async () => {
    const best = await page('/buy/catalog?tab=best-sellers');
    assert.deepStrictEqual(ranks(best), ['#1', '#2', '#3']);
    const boxes = await page('/buy/catalog?tab=box-sets');
    assert.deepStrictEqual(shown(boxes, 'scBoxGrid', 'box'), [2, 1]);
    assert.ok(opening(boxes, 'scGrid').includes(' hidden') && opening(boxes, 'scOpen').includes(' hidden'));
    assert.deepStrictEqual(sorts(boxes), ['*best-value', 'price-asc', 'az']);
    assert.ok(/<span class="bf-count" id="scCount">Box sets · 2 box sets<\/span>/.test(boxes));
  });
  await okAsync('price tabs start cheapest first; ?sort= and ?search= are kept', async () => {
    const mid = await page('/buy/catalog?tab=1000-1999');
    assert.deepStrictEqual(shown(mid, 'scGrid', 'id'), [4, 2]);
    assert.deepStrictEqual(sorts(mid), ['*price-asc', 'best-selling', 'price-desc', 'az', 'newest']);
    const az = await page('/buy/catalog?tab=under-1000&sort=az');
    assert.deepStrictEqual(shown(az, 'scGrid', 'id'), [1, 5]);
    assert.strictEqual(tabs(az)[0].href, '/buy/catalog', 'another tab starts in its own order');
    const s = await page('/buy/catalog?search=elden');
    assert.ok(opening(s, 'scSearch').includes('value="elden"'));
    assert.deepStrictEqual(shown(s, 'scGrid', 'id'), [2]);
    assert.deepStrictEqual(tabs(s).map(t => t.count), [1, 1, 1, 1, 0, 1, 0], 'Box Big holds Elden');
  });
  await okAsync('filters on top of a tab, with chips; unknown tab and sort fall back', async () => {
    const ps4 = await page('/buy/catalog?console=ps4');
    assert.deepStrictEqual(shown(ps4, 'scGrid', 'id'), [5, 2]);
    assert.ok(ps4.includes('<a class="bf-chip-x" data-group="console" data-value="ps4" href="/buy/catalog" aria-label="Remove PS4">PS4 ✕</a>'));
    assert.ok(ps4.includes('<span id="scOpenN"> · 1</span>'));
    assert.deepStrictEqual(shown(await page('/buy/catalog?account=tr'), 'scGrid', 'id'), [3, 1]);
    const odd = await page('/buy/catalog?tab=nope&sort=cheapest');
    assert.deepStrictEqual(tabs(odd).filter(t => t.on).map(t => t.key), ['all']);
    assert.deepStrictEqual(shown(odd, 'scGrid', 'id'), [3, 5, 2, 1, 4]);
  });
  await okAsync('nothing matches: the empty grid clears search and filters, keeps the tab', async () => {
    const none = await page('/buy/catalog?tab=ready-today&search=zzzz');
    assert.ok(!opening(none, 'scEmpty').includes(' hidden'));
    assert.ok(none.includes('<a class="btn btn-outline" id="scReset" href="/buy/catalog?tab=ready-today">Clear filters</a>'));
  });
  await okAsync('the filter panel: console, genre and account rows; a plain form that keeps tab, sort and search', async () => {
    const h = await page('/buy/catalog?tab=ready-today&sort=az&search=zzyzx');
    const form = between(h, 'scForm', 'scGo');
    assert.deepStrictEqual([...form.matchAll(/<section class="bf-sec" data-group="(\w+)">/g)].map(m => m[1]), ['console', 'genre', 'account']);
    ['<input type="hidden" name="tab" value="ready-today">', '<input type="hidden" name="sort" value="az">', '<input type="hidden" name="search" value="zzyzx">'].forEach(t => assert.ok(form.includes(t), t));
    assert.ok(/<label class="bf-opt" data-group="account" data-value="tr">[\s\S]*?Trophy[\s\S]*?<input type="checkbox" name="account" value="tr">/.test(form));
  });
  await okAsync('facts for every game and box set, safely embedded, plus the scripts and styles', async () => {
    const d = shopData(all);
    const tekken = d.games.find(g => g.id === 3);
    assert.deepStrictEqual([tekken.price, tekken.was, tekken.nt, tekken.tr, tekken.sold, tekken.order, tekken.ready], [2249, 2499, false, true, 2, 1, true]);
    assert.deepStrictEqual(d.games.find(g => g.id === 4).ready, false);
    assert.deepStrictEqual(d.boxes.map(b => [b.id, b.perGame, b.from, b.open]), [[1, 1000, 3000, true], [2, 750, 1500, false]]);
    assert.deepStrictEqual(d.state, { tab: 'all', sort: '', search: '', consoles: [], genres: [], accounts: [] });
    assert.ok(all.includes('"title":"Zzyzx Plain & \\u003cCo>"'), 'a title cannot close the script');
    ['/css/browse-filters.css', '/css/shop.css', '/js/buy-catalog-core.js', '/js/buy-catalog.js'].forEach(src => assert.ok(all.includes(src + '?v='), src));
    for (const src of ['/js/buy-catalog.js', '/js/shop.js', '/css/shop.css']) assert.strictEqual((await call(src)).status, 200, src);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-buy-page.js` → FAIL `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value: assert.ok(shop.includes('<span class="shop-kicker">The game shop</span>') && …)`.

- [ ] **Step 3: The shop's data and routes**

Create `.superpowers/tmp-edits/rep.js`. It keeps a file's BOM and CRLF, fails loudly on a missing or repeated anchor, and has `rep.between` for block replacements and `rep.put` for whole-file replacements. Task 3 reuses it:

````js
// Exact-text edit helpers for this plan's edit scripts. Keep a file's UTF-8
// BOM and CRLF line endings; anchors are written with \n. Throw when an
// anchor is missing or appears more than once, so nothing is half-applied
// silently. Run edit scripts from the repo root.
const fs = require('fs');

function load(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const crlf = body.includes('\r\n');
  return { bom, crlf, text: crlf ? body.replace(/\r\n/g, '\n') : body };
}

function save(file, f, text) {
  const out = f.crlf ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(file, (f.bom ? '﻿' : '') + out);
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function once(file, text, needle) {
  const n = count(text, needle);
  if (n !== 1) throw new Error(file + ': expected 1 match, found ' + n + ' for: ' + needle.slice(0, 80));
  return text.indexOf(needle);
}

// Replaces the one occurrence of `from` with `to`.
function rep(file, from, to) {
  const f = load(file);
  once(file, f.text, from);
  save(file, f, f.text.replace(from, () => to));
}

// Replaces everything from `start` through `end` (both included) with `to`.
rep.between = function (file, start, end, to) {
  const f = load(file);
  const i = once(file, f.text, start);
  const j = f.text.indexOf(end, i + start.length);
  if (j === -1) throw new Error(file + ': end anchor not found after start: ' + end.slice(0, 80));
  save(file, f, f.text.slice(0, i) + to + f.text.slice(j + end.length));
};

// Replaces the whole of `file` with the text of the file `src`, keeping
// `file`'s own BOM and line endings.
rep.put = function (file, src) {
  const f = load(file);
  save(file, f, load(src).text);
};

module.exports = rep;
````

Create `.superpowers/tmp-edits/edit-buy-server.js`:

````js
// Task 2: the Buy shop's data and pages — GET /buy (the storefront) and GET
// /buy/catalog. Keeps server.js's BOM and CRLF.
const rep = require('./rep');
const F = 'server.js';

rep(F,
`const buyPricing = require('./lib/buy-pricing');
`,
`const buyPricing = require('./lib/buy-pricing');
const buyView = require('./lib/buy-view');
const buyCatalogCore = require('./public/js/buy-catalog-core');
`);

// The old /buy: price-point sections, replaced by the shop below.
rep.between(F,
`// Groups /buy's single-game cards into price-point sections, cheapest first.`,
`  }, reviewBlockLocals('')));
});
`,
`// ── Buy: the game shop ───────────────────────────────────────────────────────
// What GET /buy (the storefront) and GET /buy/catalog show: the games that can
// still be bought and the box sets (accounts sold as bundles), with the facts
// the shop rules (public/js/buy-catalog-core.js) read. What counts as for sale
// is unchanged from the old /buy.
// See docs/superpowers/specs/2026-10-11-buy-game-shop-design.md.

// Box sets: an account for sale with a Trophy or Non-Trophy slot enabled that
// holds at least one other game. (An account sold on its own — one game
// permanently — is set up the same way but holds no other game; it already
// has its game card, so it is not a box set.)
function buyBoxSets(allGames) {
  return getAccounts()
    .filter(acc => acc.for_sale && (acc.slots.trophy.enabled || acc.slots.non_trophy.enabled))
    .map(acc => {
      const inside = buildBundleGames(acc, allGames);
      const { trophy, nonTrophy } = bundleSlotInfo(acc);
      const tiers = [
        nonTrophy ? { key: 'nt', label: 'Non-Trophy', price: nonTrophy.price, open: nonTrophy.open, status: nonTrophy.status } : null,
        trophy ? { key: 'tr', label: 'Trophy', price: trophy.price, open: trophy.open, status: trophy.status } : null
      ].filter(Boolean);
      const priced = tiers.filter(t => t.price > 0).map(t => t.price);
      const openPriced = tiers.filter(t => t.open && t.price > 0).map(t => t.price);
      const name = acc.public_name || acc.label;
      return {
        id: acc.id, slug: gameSlug(name), name,
        text: [name].concat(inside.map(g => g.title)).join('\\n').toLowerCase(),
        gameCount: inside.length,
        perGame: inside.length > 1 && priced.length ? Math.round(Math.min(...priced) / inside.length) : null,
        from: openPriced.length ? Math.min(...openPriced) : (priced.length ? Math.min(...priced) : null),
        open: tiers.some(t => t.open),
        covers: inside.slice(0, 4).map(g => ({ title: g.title, cover: g.cover_image || '' })),
        more: Math.max(0, inside.length - 4),
        tiers
      };
    })
    .filter(b => b.gameCount > 0);
}

function buyShopData() {
  const allGames = getGames();
  const promo = getSiteSettings().promo || {};
  const summaryMap = buildAccountSummaryMap();
  const customers = getCustomers();
  const todayIso = new Date().toISOString().slice(0, 10);
  const games = allGames
    .map(g => {
      const sum = summaryMap[g.id] || null;
      // Same legacy-fullness rule game-detail.ejs's buy panel judges each type
      // against: a type that has been rented before and has no free legacy
      // slot now drops off instead of still advertising a price.
      const avail = computeAvailability(g, sum);
      const neverRented = !g.renters && !g.stocked;
      const nt = (g.buy_nt_price || 0) > 0 && buyTypeSellable(sum, 'non_trophy', { everStocked: !neverRented, avail: avail.ntAvail });
      const tr = (g.buy_tr_price || 0) > 0 && buyTypeSellable(sum, 'trophy', { everStocked: !neverRented, avail: avail.trAvail });
      return { g, nt, tr, neverRented };
    })
    .filter(x => x.nt || x.tr)
    .map(({ g, nt, tr, neverRented }) => {
      // The cheapest type that can still be bought, after the buy promo.
      const offer = [nt ? buyPricing.priceFor(g, 'nt', promo) : null, tr ? buyPricing.priceFor(g, 'tr', promo) : null]
        .filter(Boolean).sort((a, b) => a.amount - b.amount)[0];
      const genres = browseCore.genreParts(g.genre);
      return {
        id: g.id, slug: gameSlug(g.title), title: g.title, text: g.title.toLowerCase(),
        cover: g.cover_image || '', fx: g.cover_focal_x != null ? g.cover_focal_x : null, fy: g.cover_focal_y != null ? g.cover_focal_y : null,
        platform: g.platform || '', ps4: g.platform === 'PS4' || g.platform === 'PS4/PS5', ps5: g.platform === 'PS5' || g.platform === 'PS4/PS5',
        genres, genre: genres[0] || '',
        price: offer.amount, was: offer.discounted ? offer.base : null,
        nt: !!nt, tr: !!tr,
        // "Set up on order": never rented and not stocked — the account is made on the first sale.
        ready: !neverRented,
        released: g.release_date && g.release_date !== 'TBA' && g.release_date <= todayIso ? g.release_date : null
      };
    });
  const counts = buyView.saleCounts(customers);
  const order = buyView.bestSellingOrder(games, counts, homeView.rentalRanking(allGames, customers, new Date()));
  games.forEach(f => {
    f.sold = counts[f.id] || 0;
    f.order = order.indexOf(Number(f.id)) + 1;
  });
  return { games, boxes: buyBoxSets(allGames) };
}

const byIdOf = list => { const o = {}; list.forEach(x => { o[x.id] = x; }); return o; };

// The storefront: the spotlight, then a shelf per catalog tab (its first 10).
app.get('/buy', (req, res) => {
  const s = getSiteSettings();
  const shop = buyShopData();
  // A buyer here is committing to a permanent purchase, the highest-trust
  // decision on the site, so the review strip belongs at least as much as on a
  // rental page. No title: this page lists many games at once.
  res.render('buy', Object.assign({
    shop, shelves: buyCatalogCore.shelves(shop),
    spotlight: buyView.spotlight(s.buy_spotlight, shop, buyCatalogCore.bestSellerIds(shop.games)),
    gamesById: byIdOf(shop.games), boxesById: byIdOf(shop.boxes),
    announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s,
    orderError: req.query.order_error || null
  }, reviewBlockLocals('')));
});

// The full catalog: tabs, search, Sort and Filters over the same shop.
app.get('/buy/catalog', (req, res) => {
  const shop = buyShopData();
  const state = buyCatalogCore.cleanState(buyCatalogCore.parseState(req.query), shop);
  const view = buyCatalogCore.view(shop, state);
  res.render('buy-catalog', {
    view, state, shop, gamesById: byIdOf(shop.games), boxesById: byIdOf(shop.boxes),
    applied: buyCatalogCore.appliedChips(state), countText: buyCatalogCore.countText(view),
    applyLabel: buyCatalogCore.applyLabel(view),
    clearHref: buyCatalogCore.href(buyCatalogCore.clearFilters(state)), resetHref: buyCatalogCore.href(buyCatalogCore.resetState(state)),
    shopData: { games: shop.games, boxes: shop.boxes, state },
    announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings()
  });
});
`);

console.log('edited server.js');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-buy-server.js` → `edited server.js`.
Then: `file server.js` → still `UTF-8 (with BOM) text … with CRLF line terminators`.

- [ ] **Step 4: The cards and the two pages**

Create `views/partials/shop-card.ejs`:

````ejs
<%# One game in the Buy shop — on a storefront shelf, in the catalog grid: its
    cover standing on the shelf, the stock tag, a best-seller sticker when
    ranked, platform · genre, the title and the yellow price sticker (the
    base price struck when the buy promo cuts it). Locals: g (a game from
    server.js buyShopData), rank (1–3 or null), hideRank (the catalog shows
    the sticker only on Best sellers in best-selling order). %>
<a href="/game/<%= g.slug %>?mode=buy" class="shop-card">
  <span class="shop-cover">
    <% if (g.cover) { %><img src="<%= g.cover %>" alt="<%= g.title %>" loading="lazy" decoding="async" style="object-position: <%= g.fx != null ? g.fx : 50 %>% <%= g.fy != null ? g.fy : 50 %>%;"><% } else { %><span class="shop-nocover"><%= g.title %></span><% } %>
    <span class="shop-stock <%= g.ready ? 'shop-in' : 'shop-wait' %>"><%= g.ready ? 'In stock' : 'Set up on order' %></span>
    <% if (rank) { %><span class="shop-rank shop-rank-<%= rank %>"<%= hideRank ? ' hidden' : '' %>>#<%= rank %></span><% } %>
  </span>
  <span class="shop-meta"><%= g.platform %><%= g.genre ? ' · ' + g.genre : '' %></span>
  <span class="shop-title"><%= g.title %></span>
  <span class="shop-price">₱<%= g.price.toLocaleString('en-US') %><% if (g.was) { %> <s>₱<%= g.was.toLocaleString('en-US') %></s><% } %></span>
</a>
````

Create `views/partials/shop-box.ejs`:

````ejs
<%# One box set (an account sold as a bundle) in the Buy shop — on the Box
    sets shelf, in the catalog's Box sets tab: up to 4 covers (+N), the name,
    how many games and the price per game, and a yellow sticker per account
    type (greyed and struck, with why, once taken). Links to its bundle page.
    Locals: b (a box set from server.js buyShopData). %>
<a href="/bundle/<%= b.slug %>" class="shop-box">
  <span class="shop-box-covers">
    <% b.covers.forEach(c => { %><% if (c.cover) { %><img src="<%= c.cover %>" alt="<%= c.title %>" loading="lazy" decoding="async"><% } else { %><span class="shop-box-blank"></span><% } %><% }) %>
    <% if (b.more) { %><span class="shop-box-more">+<%= b.more %></span><% } %>
  </span>
  <span class="shop-box-name"><%= b.name %></span>
  <span class="shop-meta"><%= b.gameCount %> game<%= b.gameCount !== 1 ? 's' : '' %><% if (b.perGame) { %> · from ₱<%= b.perGame.toLocaleString('en-US') %> per game<% } %></span>
  <span class="shop-box-tiers">
    <% b.tiers.forEach(t => { %><span class="shop-tier<%= t.open ? '' : ' shop-tier-off' %>"><%= t.label %><% if (t.price > 0) { %> ₱<%= Number(t.price).toLocaleString('en-US') %><% } %><% if (!t.open) { %> · <%= t.status === 'rented' ? 'Rented' : t.status === 'buyed' ? 'Sold' : 'Unavailable' %><% } %></span><% }) %>
  </span>
</a>
````

Create `views/buy.ejs` (replaces the whole file):

````ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Buy Permanent Access — Playstation Hub</title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
  <link rel="stylesheet" href="/css/shop.css?v=<%= assetV %>">
</head>
<body class="shop-page">
<%- include('partials/announcement') %>
<%- include('partials/nav', { active: 'buy' }) %>
<%#
  The Buy storefront (docs/superpowers/specs/2026-10-11-buy-game-shop-design.md):
  the shop header and search, the owner's spotlight, then a wooden shelf per
  catalog tab (its first 10, public/js/buy-catalog-core.js shelves) with "See
  all ›" into /buy/catalog. The spotlight reuses the homepage banner's script
  (public/js/home.js: dots, arrows, auto-advance), so it keeps that banner's ids.
%>
<%
  const notes = { 'best-sellers': 'most bought', 'ready-today': 'in stock, yours the same day', 'box-sets': 'many games, one account · best value' };
  const peso = n => '₱' + Number(n).toLocaleString('en-US');
%>
<div class="buy-page shop">
  <header class="shop-head">
    <div class="shop-head-title">
      <span class="shop-kicker">The game shop</span>
      <h1>Buy games · own them forever</h1>
    </div>
    <form class="shop-search" method="get" action="/buy/catalog" role="search">
      <input type="search" name="search" placeholder="Search <%= shop.games.length %> games to own…" aria-label="Search games to own" autocomplete="off" enterkeyhint="search">
    </form>
    <a class="shop-all" href="/buy/catalog">All games ›</a>
  </header>

  <% if (orderError === 'sold') { %><div class="ord-flash ord-flash-warn">That slot just sold — sorry! Pick another below.</div><% } %>
  <% if (orderError === 'rate') { %><div class="ord-flash ord-flash-warn">Too many attempts, please wait a moment and try again.</div><% } %>
  <% if (orderError && orderError !== 'sold' && orderError !== 'rate') { %><div class="ord-flash ord-flash-warn">Something went wrong, please try again.</div><% } %>

  <% if (spotlight.length) { %>
  <div class="shop-spot" id="hmBanner" role="region" aria-roledescription="carousel" aria-label="Spotlight">
    <div class="shop-slides" id="hmSlides">
      <% spotlight.forEach(sl => { const it = sl.item; const isBox = sl.kind === 'box';
        const cover = isBox ? ((it.covers.find(c => c.cover) || {}).cover || '') : it.cover; %>
      <a class="shop-slide" href="<%= isBox ? '/bundle/' + it.slug : '/game/' + it.slug + '?mode=buy' %>">
        <% if (cover) { %><img src="<%= cover %>" alt="" style="object-position: <%= !isBox && it.fx != null ? it.fx : 50 %>% <%= !isBox && it.fy != null ? it.fy : 50 %>%;"><% } %>
        <span class="shop-slide-shade"></span>
        <span class="shop-slide-body">
          <span class="shop-kicker">Spotlight · own it forever</span>
          <span class="shop-slide-title"><%= isBox ? it.name : it.title %></span>
          <span class="shop-slide-meta">
            <% if (isBox) { %><%= it.gameCount %> game<%= it.gameCount !== 1 ? 's' : '' %> on one account<% } else { %><%= it.platform %><%= it.genre ? ' · ' + it.genre : '' %>
            <span class="shop-stock <%= it.ready ? 'shop-in' : 'shop-wait' %>"><%= it.ready ? 'In stock' : 'Set up on order' %></span><% } %>
          </span>
        </span>
        <% const price = isBox ? it.from : it.price; %>
        <% if (price) { %><span class="shop-slide-sticker"><%= isBox ? 'from ' : '' %><%= peso(price) %></span><% } %>
        <span class="shop-slide-go">Buy now</span>
      </a>
      <% }) %>
    </div>
    <% if (spotlight.length > 1) { %>
    <button type="button" class="shop-arrow shop-arrow-prev" id="hmPrev" aria-label="Previous slide">&#8249;</button>
    <button type="button" class="shop-arrow shop-arrow-next" id="hmNext" aria-label="Next slide">&#8250;</button>
    <div class="shop-dots">
      <% spotlight.forEach((sl, i) => { %><button type="button" class="hm-dot<%= i === 0 ? ' on' : '' %>" aria-label="Slide <%= i + 1 %>"></button><% }) %>
    </div>
    <% } %>
  </div>
  <% } %>

  <% shelves.forEach(sh => { %>
  <section class="shop-shelf" id="shelf-<%= sh.key %>">
    <div class="shop-shelf-head">
      <h2><%= sh.label %></h2>
      <span class="shop-note"><%= notes[sh.key] || sh.count + ' game' + (sh.count !== 1 ? 's' : '') %></span>
      <a class="shop-seeall" href="<%= sh.href %>">See all ›</a>
    </div>
    <div class="shop-row-wrap">
      <button type="button" class="shop-row-arrow shop-row-prev" aria-label="Scroll <%= sh.label %> back">&#8249;</button>
      <div class="shop-row<%= sh.kind === 'boxes' ? ' shop-row-boxes' : '' %>">
        <% sh.ids.forEach((id, i) => { %><% if (sh.kind === 'boxes') { %><%- include('partials/shop-box', { b: boxesById[id] }) %><% } else { %><%- include('partials/shop-card', { g: gamesById[id], rank: sh.key === 'best-sellers' && i < 3 ? i + 1 : null, hideRank: false }) %><% } %><% }) %>
      </div>
      <button type="button" class="shop-row-arrow shop-row-next" aria-label="Scroll <%= sh.label %> on">&#8250;</button>
    </div>
  </section>
  <% }) %>

  <div class="buy-placeholder-grid">
    <div class="buy-placeholder-card">
      <div class="buy-placeholder-title">📦 Build your own</div>
      <p class="buy-placeholder-text">Pick any 3 or more games and save. We put them on one account for you.</p>
      <a href="http://m.me/PlaystationHub00?text=Hi!%20I%20want%20to%20build%20my%20own%20bundle." target="_blank" rel="noopener" class="buy-placeholder-cta">Start building</a>
    </div>
    <div class="buy-placeholder-card buy-placeholder-amber">
      <div class="buy-placeholder-title">🛒 Don't see it?</div>
      <p class="buy-placeholder-text">We'll buy it for you. Pay first, we purchase and set up your account.</p>
      <a href="/requests" class="buy-placeholder-cta">Request a game</a>
    </div>
  </div>

  <%- include('partials/review-block', { reviews: reviews, reviewStats: reviewStats, recommend: (typeof recommend !== 'undefined' ? recommend : null), reviewBadge: reviewBadge, reviewDisplayName: reviewDisplayName }) %>
</div>
<script src="/js/home.js?v=<%= assetV %>"></script>
<script src="/js/shop.js?v=<%= assetV %>"></script>
<%- include('partials/footer') %>
</body>
</html>
````

Create `views/buy-catalog.ejs`:

````ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>All Games to Buy — <%= settings.title %></title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
  <link rel="stylesheet" href="/css/browse-filters.css?v=<%= assetV %>">
  <link rel="stylesheet" href="/css/shop.css?v=<%= assetV %>">
</head>
<body class="shop-page">
<%- include('partials/announcement') %>
<%- include('partials/nav', { active: 'buy' }) %>
<%#
  The Buy catalog (docs/superpowers/specs/2026-10-11-buy-game-shop-design.md):
  "‹ Back to the shop", the search box, the shelf tabs, a results bar with Sort,
  Filters and the filter chips, then one grid on wooden shelves. The pinned top
  block and the filter panel reuse the Rent catalog's styles
  (public/css/browse-filters.css) and its tick-box row partial. The server
  renders the page for the URL (GET /buy/catalog); public/js/buy-catalog.js then
  runs every change with the same rules (public/js/buy-catalog-core.js),
  showing, hiding and ordering these same cards — no reload.
%>
<div class="browse-header shop-cat-head">
  <a class="shop-back" href="/buy">‹ Back to the shop</a>
  <h1>All games to own</h1>
</div>

<!-- SEARCH, TABS AND RESULTS BAR — pinned under the menu (on phones the search box scrolls away) -->
<div class="bf-top" id="scTop">
  <div class="bf-top-in">
    <form class="bf-search" id="scSearchForm" method="get" action="/buy/catalog" role="search">
      <% if (view.tab !== 'all') { %><input type="hidden" name="tab" value="<%= view.tab %>"><% } %>
      <input type="search" id="scSearch" name="search" value="<%= state.search %>" placeholder="Search <%= shop.games.length %> games to own…" aria-label="Search games to own" autocomplete="off" enterkeyhint="search">
    </form>
    <nav class="bf-tabs" id="scTabs" aria-label="Shelves">
      <% view.tabs.forEach(t => { %><a class="bf-tab<%= t.on ? ' on' : '' %>" data-tab="<%= t.key %>" href="<%= t.href %>"<%- t.on ? ' aria-current="page"' : '' %>><%= t.label %> <span class="bf-tab-n"><%= t.count %></span></a><% }) %>
    </nav>
    <div class="bf-bar" id="scBar">
      <span class="bf-count" id="scCount"><%= countText %></span>
      <label class="bf-sort" id="scSortWrap">
        <span class="bf-sort-l">Sort</span>
        <select id="scSort" aria-label="Sort">
          <% view.sorts.forEach(o => { %><option value="<%= o.key %>"<%= o.on ? ' selected' : '' %>><%= o.label %></option><% }) %>
        </select>
      </label>
      <a href="#scPanel" class="bf-open<%= view.selected ? ' bf-has' : '' %>" id="scOpen" aria-haspopup="dialog" aria-controls="scPanel"<%= view.filters ? '' : ' hidden' %>>Filters<span id="scOpenN"><%= view.selected ? ' · ' + view.selected : '' %></span></a>
      <div class="bf-chips" id="scChips"<%= view.filters && applied.length ? '' : ' hidden' %>>
        <% applied.forEach(c => { %><a class="bf-chip-x" data-group="<%= c.group %>" data-value="<%= c.value %>" href="<%= c.href %>" aria-label="Remove <%= c.label %>"><%= c.label %> ✕</a><% }) %>
        <% if (applied.length >= 2) { %><a class="bf-clear" href="<%= clearHref %>" data-clear-all="1">Clear all</a><% } %>
      </div>
    </div>
  </div>
</div>

<!-- FILTER PANEL — full screen on phones, a centred pop-up on computers. A plain
     GET form, so it also works (with reloads) without the page script. -->
<div class="bf-panel" id="scPanel" role="dialog" aria-modal="true" aria-labelledby="scPanelTitle">
  <a href="#" class="bf-backdrop" id="scBackdrop" tabindex="-1" aria-hidden="true"></a>
  <form class="bf-sheet" id="scForm" method="get" action="/buy/catalog">
    <div class="bf-head">
      <a href="#" class="bf-x" id="scClose" aria-label="Close filters">✕</a>
      <h2 id="scPanelTitle">Filters</h2>
      <button type="button" class="bf-clear-all" id="scClearAll">Clear all</button>
    </div>
    <div class="bf-body">
      <% if (view.tab !== 'all') { %><input type="hidden" name="tab" value="<%= view.tab %>"><% } %>
      <% if (view.sort !== view.sorts[0].key) { %><input type="hidden" name="sort" value="<%= view.sort %>"><% } %>
      <% if (state.search) { %><input type="hidden" name="search" value="<%= state.search %>"><% } %>
      <% view.groups.forEach(gr => { const extra = gr.chips.slice(6); %>
      <section class="bf-sec" data-group="<%= gr.key %>">
        <div class="bf-sec-head">
          <h3><%= gr.label %></h3>
          <button type="button" class="bf-sec-clear" data-clear="<%= gr.key %>"<%= gr.chips.some(c => c.on) ? '' : ' hidden' %>>Clear</button>
        </div>
        <% gr.chips.slice(0, 6).forEach(c => { %><%- include('partials/browse-filter-option', { c, ff: { name: c.group, value: c.value }, tr: null }) %><% }) %>
        <% if (extra.length) { %>
        <details class="bf-more"<%= extra.some(c => c.on) ? ' open' : '' %>>
          <summary>Show all <%= gr.chips.length %></summary>
          <% extra.forEach(c => { %><%- include('partials/browse-filter-option', { c, ff: { name: c.group, value: c.value }, tr: null }) %><% }) %>
        </details>
        <% } %>
      </section>
      <% }) %>
    </div>
    <div class="bf-foot">
      <button type="submit" class="bf-go" id="scGo"<%= applyLabel.disabled ? ' disabled' : '' %>><%= applyLabel.text %></button>
    </div>
  </form>
</div>

<%
  // Every item is on the page once; the active tab's matches come first, in
  // order, and the rest wait hidden for another tab.
  const leadGames = view.kind === 'games' ? view.ids : [];
  const gameList = leadGames.map(id => gamesById[id]).concat(shop.games.filter(f => !leadGames.includes(f.id)));
  const leadBoxes = view.kind === 'boxes' ? view.ids : [];
  const boxList = leadBoxes.map(id => boxesById[id]).concat(shop.boxes.filter(b => !leadBoxes.includes(b.id)));
%>
<div class="section bf-results shop" id="scResults">
  <div class="bf-empty" id="scEmpty"<%= view.count ? ' hidden' : '' %>>
    <p>No games match.</p>
    <a class="btn btn-outline" id="scReset" href="<%= resetHref %>">Clear filters</a>
  </div>

  <div class="shop-grid" id="scGrid"<%= view.kind === 'games' ? '' : ' hidden' %>>
    <% gameList.forEach(f => { %><div class="shop-item" data-id="<%= f.id %>"<%= leadGames.includes(f.id) ? '' : ' hidden' %>><%- include('partials/shop-card', { g: f, rank: f.order <= 3 ? f.order : null, hideRank: !view.ranked }) %></div><% }) %>
  </div>

  <div class="shop-grid shop-grid-boxes" id="scBoxGrid"<%= view.kind === 'boxes' ? '' : ' hidden' %>>
    <% boxList.forEach(b => { %><div class="shop-item" data-box="<%= b.id %>"<%= leadBoxes.includes(b.id) ? '' : ' hidden' %>><%- include('partials/shop-box', { b }) %></div><% }) %>
  </div>
</div>

<%- include('partials/footer') %>

<script type="application/json" id="shopData"><%- JSON.stringify(shopData).replace(/</g, '\\u003c') %></script>
<script src="/js/buy-catalog-core.js?v=<%= assetV %>"></script>
<script src="/js/buy-catalog.js?v=<%= assetV %>"></script>
</body>
</html>
````

- [ ] **Step 5: The scripts and styles**

Create `public/js/buy-catalog.js`:

````js
// The Buy catalog in the page (views/buy-catalog.ejs), using the shared rules
// in public/js/buy-catalog-core.js on the facts the server embedded:
//  - tabs, the search box and the Sort menu change the grid at once;
//  - the filter panel keeps a draft: ticking only updates the panel's counts and
//    its "Show N games" button; that button applies the draft, closing it any
//    other way throws the draft away;
//  - the filter bar's chips drop one filter at once;
//  - every change shows, hides and orders the cards already on the page and
//    keeps the URL in step — no reload.
(function () {
  var C = window.BuyCatalogCore;
  var dataEl = document.getElementById('shopData');
  if (!C || !dataEl) return;
  var data = JSON.parse(dataEl.textContent);
  var state = data.state, draft = null;
  var $ = function (id) { return document.getElementById(id); };
  var each = function (root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); };
  var copy = function (s) { return JSON.parse(JSON.stringify(s)); };
  var panel = $('scPanel'), form = $('scForm'), search = $('scSearch');

  var gameCards = {}, boxCards = {};
  each(document, '#scGrid .shop-item[data-id]', function (el) { gameCards[el.getAttribute('data-id')] = el; });
  each(document, '#scBoxGrid .shop-item[data-box]', function (el) { boxCards[el.getAttribute('data-box')] = el; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── The page for the current state ────────────────────────────────────────
  // The tab's matches, in order, at the front of their grid; the rest hidden.
  function place(cards, grid, ids) {
    var on = {};
    ids.forEach(function (id) {
      var el = cards[id];
      if (!el) return;
      on[id] = true;
      el.hidden = false;
      grid.appendChild(el);
    });
    Object.keys(cards).forEach(function (id) { if (!on[id]) cards[id].hidden = true; });
  }
  function renderTabs(v) {
    var byKey = {};
    v.tabs.forEach(function (t) { byKey[t.key] = t; });
    each($('scTabs'), '.bf-tab', function (el) {
      var t = byKey[el.getAttribute('data-tab')];
      if (!t) return;
      el.classList.toggle('on', t.on);
      if (t.on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
      el.href = t.href;
      el.querySelector('.bf-tab-n').textContent = t.count;
    });
  }
  function renderBar(v) {
    $('scCount').textContent = C.countText(v);
    $('scSort').innerHTML = v.sorts.map(function (o) {
      return '<option value="' + o.key + '"' + (o.on ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    var chips = v.filters ? C.appliedChips(state) : [];
    $('scChips').innerHTML = chips.map(function (c) {
      return '<a class="bf-chip-x" data-group="' + esc(c.group) + '" data-value="' + esc(c.value) + '" href="' + esc(c.href) +
        '" aria-label="Remove ' + esc(c.label) + '">' + esc(c.label) + ' ✕</a>';
    }).join('') + (chips.length >= 2 ? '<a class="bf-clear" href="' + esc(C.href(C.clearFilters(state))) + '" data-clear-all="1">Clear all</a>' : '');
    $('scChips').hidden = !chips.length;
    $('scOpen').hidden = !v.filters;
    $('scOpenN').textContent = v.selected ? ' · ' + v.selected : '';
    $('scOpen').classList.toggle('bf-has', v.selected > 0);
  }
  function render() {
    var v = C.view(data, state);
    renderTabs(v);
    renderBar(v);
    place(gameCards, $('scGrid'), v.kind === 'games' ? v.ids : []);
    place(boxCards, $('scBoxGrid'), v.kind === 'boxes' ? v.ids : []);
    $('scGrid').hidden = v.kind !== 'games';
    $('scBoxGrid').hidden = v.kind !== 'boxes';
    each($('scGrid'), '.shop-rank', function (el) { el.hidden = !v.ranked; });
    $('scEmpty').hidden = v.count > 0;
    $('scReset').href = C.href(C.resetState(state));
  }
  function go(next) {
    state = next;
    history.replaceState(null, '', C.href(state));
    render();
  }
  // After a tab change deep down the page, start the new grid from its top.
  function toTop() {
    var y = $('scTop').getBoundingClientRect().top + window.pageYOffset;
    var start = document.querySelector('.shop-cat-head').getBoundingClientRect().bottom + window.pageYOffset;
    if (y > start + 1) window.scrollTo(0, start);
  }

  // ── Tabs, search and sort ─────────────────────────────────────────────────
  $('scTabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.bf-tab');
    // Ctrl/Cmd/Shift-click or a middle click opens the tab's link as usual.
    if (!tab || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    go(C.withTab(state, tab.getAttribute('data-tab')));
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    toTop();
  });
  search.addEventListener('input', function () { go(C.withSearch(state, search.value)); });
  $('scSearchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    search.blur();
  });
  $('scSort').addEventListener('change', function () { go(C.withSort(state, $('scSort').value)); });
  $('scReset').addEventListener('click', function (e) {
    e.preventDefault();
    search.value = '';
    go(C.resetState(state));
  });

  // ── The filter panel (a draft until "Show N games") ───────────────────────
  function renderPanel() {
    var v = C.view(data, draft);
    var byKey = {};
    v.groups.forEach(function (g) { g.chips.forEach(function (c) { byKey[c.group + '|' + c.value] = c; }); });
    each(panel, '.bf-opt', function (row) {
      var c = byKey[row.getAttribute('data-group') + '|' + row.getAttribute('data-value')];
      if (!c) return;
      var box = row.querySelector('input');
      box.checked = c.on;
      box.disabled = c.zero;
      row.classList.toggle('bf-opt-zero', c.zero);
      row.querySelector('.bf-n').textContent = c.count;
    });
    each(panel, '.bf-sec', function (sec) {
      var g = sec.getAttribute('data-group');
      sec.querySelector('.bf-sec-clear').hidden = !v.groups.some(function (x) { return x.key === g && x.chips.some(function (c) { return c.on; }); });
      var more = sec.querySelector('.bf-more');
      if (more && more.querySelector('input:checked')) more.open = true;
    });
    var label = C.applyLabel(v);
    $('scGo').textContent = label.text;
    $('scGo').disabled = label.disabled;
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
  }
  function openPanel() {
    draft = copy(state);
    panel.classList.add('bf-show');
    document.body.classList.add('bf-lock');
    renderPanel();
    document.addEventListener('keydown', onKey);
    $('scClose').focus();
  }
  function closePanel() {
    if (location.hash === '#scPanel') { location.hash = ''; history.replaceState(null, '', location.pathname + location.search); }
    panel.classList.remove('bf-show');
    document.body.classList.remove('bf-lock');
    document.removeEventListener('keydown', onKey);
    draft = null;
    $('scOpen').focus();
  }

  $('scOpen').addEventListener('click', function (e) { e.preventDefault(); openPanel(); });
  [$('scClose'), $('scBackdrop')].forEach(function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); closePanel(); });
  });
  form.addEventListener('change', function (e) {
    var row = e.target.closest('.bf-opt');
    if (!row || !draft) return;
    draft = C.toggle(draft, row.getAttribute('data-group'), row.getAttribute('data-value'));
    renderPanel();
  });
  form.addEventListener('click', function (e) {
    var clear = e.target.closest('[data-clear]');
    if (clear && draft) { draft = C.clearGroup(draft, clear.getAttribute('data-clear')); renderPanel(); }
  });
  $('scClearAll').addEventListener('click', function () {
    if (!draft) return;
    draft = C.clearFilters(draft);
    renderPanel();
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!draft || $('scGo').disabled) return;
    var next = draft;
    closePanel();
    go(next);
  });

  // ── The filter bar's chips ────────────────────────────────────────────────
  $('scChips').addEventListener('click', function (e) {
    var chip = e.target.closest('.bf-chip-x');
    if (chip) { e.preventDefault(); go(C.toggle(state, chip.getAttribute('data-group'), chip.getAttribute('data-value'))); return; }
    if (e.target.closest('[data-clear-all]')) { e.preventDefault(); go(C.clearFilters(state)); }
  });

  // A shared link to #scPanel (or the no-script fallback) opens it properly.
  if (location.hash === '#scPanel') {
    // location.hash = '' (unlike replaceState alone) un-matches CSS :target, so the panel can close.
    location.hash = '';
    history.replaceState(null, '', location.pathname + location.search);
    openPanel();
  }
  render();
})();
````

Create `public/js/shop.js`:

````js
// The Buy storefront's shelves (views/buy.ejs). Each shelf is a native
// sideways-scrolling row, so phones swipe it without help; on computers the
// ‹ › buttons scroll it by about a screen, and each button greys out at its
// end. (The spotlight above runs on public/js/home.js.)
(function () {
  Array.prototype.forEach.call(document.querySelectorAll('.shop-row-wrap'), function (wrap) {
    var row = wrap.querySelector('.shop-row');
    var prev = wrap.querySelector('.shop-row-prev'), next = wrap.querySelector('.shop-row-next');
    if (!row || !prev || !next) return;
    function update() {
      var max = row.scrollWidth - row.clientWidth;
      prev.disabled = row.scrollLeft <= 1;
      next.disabled = row.scrollLeft >= max - 1;
      wrap.classList.toggle('shop-row-fits', max <= 1);
    }
    function by(dir) { row.scrollBy({ left: dir * Math.max(200, row.clientWidth * 0.85), behavior: 'smooth' }); }
    prev.addEventListener('click', function () { by(-1); });
    next.addEventListener('click', function () { by(1); });
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  });
})();
````

Create `public/css/shop.css`:

````css
/* The Buy shop — a game shop rather than Rent's arcade: covers standing on
   wooden shelves, tilted yellow price stickers, round best-seller stickers and
   green "In stock" / amber "Set up on order" tags (views/buy.ejs, the
   storefront; views/buy-catalog.ejs, the catalog; partials/shop-card.ejs and
   shop-box.ejs). The catalog's pinned top block and filter panel come from
   browse-filters.css; only their colours change here. */
.shop-page { --shop-yellow: #FFD23F; --shop-wood: #5a3b1e; --shop-wood-dark: #3a2511; }

@media (max-width: 600px) { .buy-page.shop { padding: 1.25rem 1rem 3rem; } }

/* ── Storefront header ── */
.shop-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1.25rem; margin-bottom: 1.25rem; }
.shop-head-title { flex: 1 1 320px; }
.shop-kicker { display: block; color: var(--shop-yellow); font-size: 0.72rem; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; }
.shop-head h1 { margin: 0.1rem 0 0; font-size: 1.7rem; font-weight: 900; color: #fff; }
.shop-search { flex: 1 1 260px; max-width: 420px; display: flex; }
.shop-search input, .shop-page .bf-search input { flex: 1; min-width: 0; height: 44px; background: #161616 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23888' stroke-width='2' viewBox='0 0 24 24'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") no-repeat 1rem center; border: 1px solid #2a2a2a; border-radius: 999px; color: #fff; font-size: 0.95rem; padding: 0 1rem 0 2.6rem; }
.shop-search input:focus, .shop-page .bf-search input:focus { outline: none; border-color: var(--shop-yellow); }
.shop-all { color: var(--shop-yellow); font-weight: 800; font-size: 0.9rem; text-decoration: none; white-space: nowrap; }

/* ── Spotlight (slides run on public/js/home.js) ── */
.shop-spot { position: relative; border-radius: 16px; overflow: hidden; background: #141414; margin-bottom: 0.5rem; }
.shop-slides { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.shop-slides::-webkit-scrollbar { display: none; }
.shop-slide { position: relative; flex: 0 0 100%; scroll-snap-align: start; min-height: 220px; display: block; color: #fff; text-decoration: none; overflow: hidden; }
@media (min-width: 900px) { .shop-slide { min-height: 320px; } }
.shop-slide img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.shop-slide-shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(0,0,0,0.88) 25%, rgba(0,0,0,0.2) 75%), linear-gradient(0deg, rgba(0,0,0,0.6), transparent 60%); }
.shop-slide-body { position: absolute; left: 1.25rem; right: 1.25rem; bottom: 4.2rem; display: flex; flex-direction: column; gap: 0.3rem; }
@media (min-width: 900px) { .shop-slide-body { left: 2rem; right: 45%; bottom: 2rem; } }
.shop-slide-title { font-size: 1.6rem; font-weight: 900; line-height: 1.15; }
@media (min-width: 900px) { .shop-slide-title { font-size: 2.2rem; } }
.shop-slide-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; color: #ddd; font-size: 0.88rem; }
.shop-slide-meta .shop-stock { position: static; }
.shop-slide-sticker { position: absolute; left: 1.25rem; bottom: 1.2rem; background: var(--shop-yellow); color: #111; font-weight: 900; font-size: 1.1rem; padding: 0.35rem 0.75rem; border-radius: 4px; transform: rotate(-4deg); box-shadow: 0 3px 8px rgba(0,0,0,0.55); }
.shop-slide-go { position: absolute; right: 1.25rem; bottom: 1.2rem; background: var(--shop-yellow); color: #111; font-weight: 900; padding: 0.55rem 1.3rem; border-radius: 999px; }
@media (min-width: 900px) {
  .shop-slide-sticker { left: auto; right: 10.5rem; bottom: 2.1rem; font-size: 1.4rem; }
  .shop-slide-go { right: 2rem; bottom: 2rem; padding: 0.7rem 1.6rem; }
}
.shop-arrow { position: absolute; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border-radius: 50%; border: 1px solid #333; background: rgba(20,20,20,0.8); color: #fff; font-size: 1.6rem; line-height: 1; cursor: pointer; display: none; }
.shop-arrow-prev { left: 0.6rem; }
.shop-arrow-next { right: 0.6rem; }
@media (hover: hover) and (min-width: 900px) { .shop-arrow { display: flex; align-items: center; justify-content: center; } }
.shop-dots { position: absolute; left: 50%; transform: translateX(-50%); bottom: 0.5rem; display: flex; gap: 0.35rem; }
.shop-dots .hm-dot { width: 8px; height: 8px; padding: 0; border-radius: 50%; border: none; background: rgba(255,255,255,0.35); cursor: pointer; }
.shop-dots .hm-dot.on { background: var(--shop-yellow); width: 20px; border-radius: 4px; }

/* ── Stock tags and stickers (shared by every card) ── */
.shop-stock { position: absolute; top: 0.45rem; left: 0.45rem; z-index: 2; font-size: 0.62rem; font-weight: 800; letter-spacing: 0.3px; text-transform: uppercase; padding: 0.15rem 0.45rem; border-radius: 4px; color: #fff; }
.shop-in { background: #16a34a; }
.shop-wait { background: #d97706; }
.shop-rank { position: absolute; top: -0.5rem; right: -0.45rem; z-index: 3; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 900; color: #111; background: var(--shop-yellow); transform: rotate(10deg); box-shadow: 0 2px 6px rgba(0,0,0,0.5); }
.shop-rank-2 { background: #e5e7eb; }
.shop-rank-3 { background: #f2a46b; }

/* ── Shelves ── */
.shop-shelf { margin-top: 2rem; }
.shop-shelf-head { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.6rem; }
.shop-shelf-head h2 { margin: 0; font-size: 1.2rem; font-weight: 900; color: #fff; }
.shop-note { color: #888; font-size: 0.8rem; }
.shop-seeall { margin-left: auto; color: var(--shop-yellow); font-weight: 800; font-size: 0.85rem; text-decoration: none; white-space: nowrap; }
.shop-row-wrap { position: relative; }
.shop-row { display: flex; gap: 1rem; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; padding: 0.7rem 0.5rem 0.75rem; border-bottom: 10px solid var(--shop-wood); box-shadow: 0 7px 0 var(--shop-wood-dark); }
.shop-row::-webkit-scrollbar { display: none; }
.shop-row > * { scroll-snap-align: start; }
.shop-row .shop-card { flex: 0 0 150px; }
.shop-row-boxes .shop-box { flex: 0 0 290px; }
@media (max-width: 600px) {
  .shop-row { gap: 0.75rem; }
  .shop-row .shop-card { flex-basis: 40vw; }
  .shop-row-boxes .shop-box { flex-basis: 78vw; }
}
.shop-row-arrow { position: absolute; top: 40%; z-index: 4; width: 34px; height: 34px; border-radius: 50%; border: 1px solid #333; background: rgba(20,20,20,0.85); color: #fff; font-size: 1.5rem; line-height: 1; cursor: pointer; display: none; }
.shop-row-prev { left: -0.5rem; }
.shop-row-next { right: -0.5rem; }
.shop-row-arrow:disabled { opacity: 0.25; cursor: default; }
@media (hover: hover) and (min-width: 900px) { .shop-row-arrow { display: flex; align-items: center; justify-content: center; } }
.shop-row-fits .shop-row-arrow { display: none; }

/* ── A game card ── */
.shop-card { display: flex; flex-direction: column; gap: 0.2rem; color: #fff; text-decoration: none; }
.shop-cover { position: relative; display: block; aspect-ratio: 3 / 4; border-radius: 6px; background: #1c1c1c; box-shadow: 0 6px 12px rgba(0,0,0,0.45); }
.shop-cover img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 6px; }
.shop-nocover { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 0.75rem; text-align: center; font-weight: 800; font-size: 0.85rem; color: #bbb; background: linear-gradient(160deg, #2a2a2a, #111); border-radius: 6px; }
.shop-card:hover .shop-cover { box-shadow: 0 8px 18px rgba(255,210,63,0.18); }
.shop-meta { color: #888; font-size: 0.7rem; margin-top: 0.35rem; }
.shop-title { font-size: 0.86rem; font-weight: 800; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.shop-price { align-self: flex-start; margin-top: 0.25rem; background: var(--shop-yellow); color: #111; font-weight: 900; font-size: 0.85rem; padding: 0.12rem 0.5rem; border-radius: 3px; transform: rotate(-3deg); box-shadow: 0 2px 4px rgba(0,0,0,0.4); }
.shop-price s { color: #6b5400; font-weight: 600; font-size: 0.75rem; margin-left: 0.2rem; }

/* ── A box set ── */
.shop-box { display: flex; flex-direction: column; gap: 0.3rem; background: #181818; border: 1px solid #2c2c2c; border-radius: 12px; padding: 0.75rem; color: #fff; text-decoration: none; }
.shop-box:hover { border-color: #4a4a4a; }
.shop-box-covers { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; position: relative; }
.shop-box-covers img, .shop-box-blank { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 4px; background: #222; display: block; }
.shop-box-more { position: absolute; right: 0.3rem; bottom: 0.3rem; background: rgba(0,0,0,0.75); color: #fff; font-size: 0.72rem; font-weight: 800; padding: 0.1rem 0.4rem; border-radius: 4px; }
.shop-box-name { font-weight: 900; font-size: 0.95rem; margin-top: 0.3rem; }
.shop-box .shop-meta { margin-top: 0; }
.shop-box-tiers { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.3rem; }
.shop-tier { background: var(--shop-yellow); color: #111; font-weight: 900; font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 3px; transform: rotate(-2deg); }
.shop-tier-off { background: #2a2a2a; color: #888; text-decoration: line-through; transform: none; }

/* ── The catalog ── */
.shop-cat-head h1 { margin: 0.2rem 0 1rem; }
.shop-back { color: var(--shop-yellow); font-weight: 800; font-size: 0.85rem; text-decoration: none; }
.shop-page .bf-tab.on { background: var(--shop-yellow); border-color: var(--shop-yellow); color: #111; }
.shop-page .bf-open.bf-has { border-color: var(--shop-yellow); color: var(--shop-yellow); }
.shop-page .bf-go { background: var(--shop-yellow); }
/* Each row of the grid stands on a wooden shelf: no gap between columns, so
   the cards' shelf strips join up. */
.shop-grid { display: grid; grid-template-columns: repeat(2, 1fr); column-gap: 0; row-gap: 1.6rem; }
@media (min-width: 601px) { .shop-grid { grid-template-columns: repeat(4, 1fr); } }
@media (min-width: 1000px) { .shop-grid { grid-template-columns: repeat(6, 1fr); } }
.shop-grid-boxes { grid-template-columns: 1fr; }
@media (min-width: 601px) { .shop-grid-boxes { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1000px) { .shop-grid-boxes { grid-template-columns: repeat(3, 1fr); } }
.shop-item { padding: 0.7rem 0.5rem 0.75rem; border-bottom: 10px solid var(--shop-wood); box-shadow: 0 7px 0 var(--shop-wood-dark); }
````

Create `.superpowers/tmp-edits/edit-buy-leftovers.js` (the old page's dead `.buy-*` rules in `style.css`, and `home.js`'s comment):

````js
// Task 2: what the old /buy page leaves behind — its styles that nothing uses
// any more (its price sections, bundle cards and availability tick box; the
// bundle page's own .buy-* styles stay) — and home.js's note that it now also
// runs the Buy spotlight. Keeps style.css's CRLF.
const rep = require('./rep');
const F = 'public/css/style.css';

rep(F, `.buy-title { font-size: 1.6rem; font-weight: 800; color: #fff; margin: 0 0 0.2rem; }
.buy-sub { font-size: 0.85rem; color: #888; margin: 0 0 1.75rem; }
.buy-section-label { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: #F0A500; margin: 0 0 0.75rem; }
.buy-bundle-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.85rem; margin-bottom: 2.25rem; }
.buy-bundle-card { background: #141414; border: 1px solid #2a2a2a; border-radius: 12px; padding: 0.9rem; display: flex; flex-direction: column; }
.buy-bundle-head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; margin-bottom: 0.15rem; }
.buy-bundle-link { display: block; text-decoration: none; color: inherit; }
.buy-bundle-name { font-size: 0.92rem; color: #fff; font-weight: 700; }
.buy-bundle-count { font-size: 0.72rem; color: #888; flex-shrink: 0; }
`, '');
rep(F, `.buy-bundle-covers { display: flex; gap: 5px; margin-bottom: 0.7rem; }
.buy-cover-thumb { width: 40px; height: 54px; border-radius: 4px; object-fit: cover; background: #1c1c1c; flex-shrink: 0; }
`, '');
rep(F, `.buy-cover-more { display: flex; align-items: center; justify-content: center; font-size: 0.7rem; color: #888; }
`, '');
rep(F, `.buy-tier-status-open { color: #7fd99a; background: #10251a; }
.buy-tier-buy-btn { display: block; width: 100%; box-sizing: border-box; background: #7b2ff7; color: #fff; font-weight: 700; font-size: 0.8rem; padding: 0.5rem 0; border-radius: 6px; text-align: center; text-decoration: none; }
.buy-tier-buy-btn:hover { background: #8f45f9; }
`, '');
rep(F, `.buy-filter-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
.buy-section-label-plain { margin: 0; }
.buy-avail-toggle { display: flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; color: #aaa; cursor: pointer; user-select: none; }
.buy-avail-toggle input { accent-color: var(--ps-blue); width: 15px; height: 15px; cursor: pointer; }
.buy-price-section { margin-bottom: 1.75rem; }
.buy-price-section-head { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.75rem; }
.buy-price-section-label { font-size: 1.05rem; font-weight: 800; color: #fff; }
.buy-price-section-count { font-size: 0.78rem; color: var(--text-secondary); background: #111; border: 1px solid #222; border-radius: 20px; padding: 0.2rem 0.65rem; }
.buy-badge-pending { left: 9px; background: rgba(240,165,0,0.15); color: #f0a500; border: 1px solid rgba(240,165,0,0.35); }
.buy-empty-filtered { text-align: center; color: #888; font-size: 0.85rem; padding: 2.5rem 0; }
.buy-single-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
`, '');

rep('public/js/home.js',
`// The homepage "Now playing" banner (views/partials/home/top.ejs). The slides`,
`// The homepage "Now playing" banner (views/partials/home/top.ejs), and the Buy
// storefront's spotlight (views/buy.ejs), which uses the same ids. The slides`);

console.log('edited style.css, home.js');
````

Run: `node .superpowers/tmp-edits/edit-buy-leftovers.js` → `edited style.css, home.js`.
Then: `file public/css/style.css` → still `with CRLF line terminators`.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `node scripts/test-buy-page.js` → `13 assertions passed`.
Run: `node scripts/test-buy-view.js && node scripts/test-buy-catalog-core.js && node scripts/test-home-page.js && node scripts/test-browse-page.js` → `5`, `16`, `14`, `18 assertions passed`.
Run the whole suite: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"` → only `FAIL scripts/test-requests-page.js`, `failed: 1`.

- [ ] **Step 7: Commit**

```bash
git add server.js views/buy.ejs views/buy-catalog.ejs views/partials/shop-card.ejs views/partials/shop-box.ejs public/js/buy-catalog.js public/js/shop.js public/css/shop.css public/css/style.css public/js/home.js scripts/test-buy-page.js
git commit -m "Buy: a game shop storefront with shelves, and a full catalog with tabs, search and sort

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Admin — the Buy page spotlight picker

**Files:**
- Create: `scripts/test-admin-buy-spotlight.js`, `.superpowers/tmp-edits/edit-buy-spotlight.js`
- Modify (edit script): `server.js`, `views/partials/admin/content.ejs`, `views/admin.ejs`

**Interfaces:**
- Consumes: `buyBoxSets(allGames)` (Task 2), `buyView.readSpotlightForm` (Task 1), `requireAuth`, `getGames`, `db`, `.superpowers/tmp-edits/rep.js` (Task 2). The admin page's `.hb-form` / `.hb-row` styles (the Homepage banner card's).
- Produces: `buySpotlightChoices()` → `{ boxes: [{ id, name }], games: [{ id, title }] }` (also `app.locals.buySpotlightChoices` for the admin template); `POST /admin/buy-spotlight` saving `site_settings.buy_spotlight`; the message `buy_spotlight_saved`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-admin-buy-spotlight.js`:

````js
// Run: node scripts/test-admin-buy-spotlight.js
//
// Admin → Content → Buy page spotlight: the picker (box sets and games with a
// buy price), saving up to 5 picks (blanks, unknown picks and repeats
// dropped), the login, the toast, and the Buy storefront showing the picks —
// or the top 3 best sellers once nothing is picked. Boots a throwaway instance
// (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin
// password); the project's games.json, the database and the real admin are
// never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4634;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buy-spotlight-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const game = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', cover_image: '/uploads/' + id + '.png', renters: 1, nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 1, trophy_slots: 1 }, extra || {});
const slots = { non_trophy: { enabled: true, status: 'open' }, trophy: { enabled: true, status: 'open' }, ps4_primary: { enabled: false, status: 'open' } };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 }, buy_spotlight: [{ kind: 'game', id: 2 }] },
  games: [
    game(1, 'Zzyzx Alpha', { buy_nt_price: 999, renters: 9 }), game(2, 'Zzyzx Bravo', { buy_nt_price: 1499, renters: 5 }),
    game(3, 'Zzyzx Charlie', { buy_tr_price: 1999, renters: 2 }), game(4, 'Zzyzx Delta', { buy_nt_price: 799, renters: 1 }),
    game(5, 'Zzyzx NoPrice')
  ],
  accounts: [
    { id: 1, label: 'Zzyzx Box', public_name: 'Zzyzx Box', for_sale: true, game_ids: [5], price_permanent_nt: 2500, slots },
    { id: 2, label: 'Zzyzx Delta', public_name: 'Zzyzx Delta', for_sale: true, game_ids: [4], price_permanent_nt: 799, slots }
  ],
  customers: [{ id: 1, game_id: 4, game_title: 'Zzyzx Delta', status: 'bought', customer_name: 'Zzyzx A' }]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const picksInDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8')).site_settings.buy_spotlight;

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method, headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers), timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}
const form = o => new URLSearchParams(o).toString();
const slideTitles = html => [...html.matchAll(/<span class="shop-slide-title">([^<]*)<\/span>/g)].map(m => m[1]);

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  await okAsync('saving needs the admin login', async () => {
    const r = await call('POST', '/admin/buy-spotlight', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: form({ slide_1: 'game:1' }) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
    assert.deepStrictEqual(picksInDb(), [{ kind: 'game', id: 2 }]);
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const post = o => call('POST', '/admin/buy-spotlight', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o) });

  await okAsync('the picker: five slots, box sets then games with a buy price, the current pick selected', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('id="sec-buy-spotlight"') && r.body.includes('<a href="#sec-buy-spotlight">Buy spotlight</a>'));
    assert.strictEqual((r.body.match(/<select name="slide_\d">/g) || []).length, 5);
    const first = /<select name="slide_1">([\s\S]*?)<\/select>/.exec(r.body)[1];
    assert.ok(first.includes('<option value="">— Best sellers —</option>'));
    assert.ok(first.includes('<option value="box:1">Zzyzx Box</option>'), 'a box set');
    assert.ok(!first.includes('value="box:2"'), 'an account selling one game is not a box set');
    assert.ok(first.includes('<option value="game:2" selected>Zzyzx Bravo</option>'));
    assert.ok(!first.includes('Zzyzx NoPrice'), 'no buy price, nothing to sell');
    assert.ok(first.indexOf('label="Box sets"') < first.indexOf('label="Games"'));
  });
  await okAsync('saves the picks in order, dropping blanks, unknown picks and repeats', async () => {
    const r = await post({ slide_1: 'box:1', slide_2: '', slide_3: 'game:3', slide_4: 'game:3', slide_5: 'game:99' });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.endsWith('tab=content&msg=buy_spotlight_saved'));
    assert.deepStrictEqual(picksInDb(), [{ kind: 'box', id: 1 }, { kind: 'game', id: 3 }]);
    assert.deepStrictEqual(slideTitles((await call('GET', '/buy')).body), ['Zzyzx Box', 'Zzyzx Charlie'], 'the storefront shows them');
  });
  await okAsync('nothing picked: the storefront shows the top 3 best sellers', async () => {
    await post({});
    assert.deepStrictEqual(picksInDb(), []);
    assert.deepStrictEqual(slideTitles((await call('GET', '/buy')).body), ['Zzyzx Delta', 'Zzyzx Alpha', 'Zzyzx Bravo'], 'the one sold first, then the most rented');
  });
  await okAsync('the toast', async () => {
    const r = await call('GET', '/admin?tab=content&msg=buy_spotlight_saved', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes("buy_spotlight_saved:'✅ Buy page spotlight saved'") && r.body.includes("buy_spotlight_saved:'content'"));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-admin-buy-spotlight.js` → FAIL on the first check (`saving needs the admin login`): `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 404 !== 302` (the route does not exist yet).

- [ ] **Step 3: Add the picker**

Create `.superpowers/tmp-edits/edit-buy-spotlight.js`:

````js
// Task 3: Admin → Content → Buy page spotlight — what can be picked, saving
// the picks (POST /admin/buy-spotlight), the card next to "Homepage banner"
// and its saved message. Keeps server.js's BOM and CRLF.
const rep = require('./rep');
const F = 'server.js';

rep(F,
`    shopData: { games: shop.games, boxes: shop.boxes, state },
    announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings()
  });
});
`,
`    shopData: { games: shop.games, boxes: shop.boxes, state },
    announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings()
  });
});

// What Admin → Content → Buy page spotlight can pick: box sets for sale and
// games with a buy price, A–Z.
function buySpotlightChoices() {
  return {
    boxes: buyBoxSets(getGames()).map(b => ({ id: b.id, name: b.name })).sort((a, b) => a.name.localeCompare(b.name)),
    games: getGames().filter(g => (g.buy_nt_price || 0) > 0 || (g.buy_tr_price || 0) > 0)
      .map(g => ({ id: g.id, title: g.title })).sort((a, b) => a.title.localeCompare(b.title))
  };
}
app.locals.buySpotlightChoices = buySpotlightChoices;
`);

rep(F,
`  db.set('site_settings.home_banner_ids', ids).write();
  res.redirect('/admin?tab=content&msg=home_banner_saved');
});
`,
`  db.set('site_settings.home_banner_ids', ids).write();
  res.redirect('/admin?tab=content&msg=home_banner_saved');
});

// Admin → Content → Buy page spotlight: up to 5 games or box sets shown first
// on the Buy storefront (lib/buy-view.js). Fields slide_1..slide_5 hold
// "game:<id>" / "box:<id>"; blanks, unknown picks and repeats are dropped.
app.post('/admin/buy-spotlight', requireAuth, (req, res) => {
  const choices = buySpotlightChoices();
  const picks = buyView.readSpotlightForm(req.body, { games: choices.games.map(g => g.id), boxes: choices.boxes.map(b => b.id) });
  db.set('site_settings.buy_spotlight', picks).write();
  res.redirect('/admin?tab=content&msg=buy_spotlight_saved');
});
`);

rep('views/partials/admin/content.ejs',
`      <a href="#sec-home-banner">Homepage banner</a>
`,
`      <a href="#sec-home-banner">Homepage banner</a>
      <a href="#sec-buy-spotlight">Buy spotlight</a>
`);

rep('views/partials/admin/content.ejs',
`          <div><button type="submit" class="btn btn-primary">Save banner</button></div>
        </form>
      </div>
    </div>
`,
`          <div><button type="submit" class="btn btn-primary">Save banner</button></div>
        </form>
      </div>
    </div>

    <!-- BUY PAGE SPOTLIGHT — games or box sets shown first on the Buy storefront -->
    <% const bsPicks = settings.buy_spotlight || []; const bsChoices = buySpotlightChoices(); %>
    <div class="adm-card" id="sec-buy-spotlight">
      <div class="adm-card-head" style="border-left:3px solid #ffd23f;">
        <div class="sa-left">
          <div class="sa-icon" style="background:rgba(255,210,63,0.15);">🛒</div>
          <div>
            <div class="sa-title">Buy page spotlight</div>
            <div class="sa-desc">Games or box sets shown first in the Buy page's spotlight</div>
          </div>
        </div>
      </div>
      <div class="adm-card-body">
        <p class="gdt-note">Pick up to 5, in order. Anything sold out or no longer for sale is skipped on the page. With nothing picked, the spotlight shows the top 3 best sellers.</p>
        <form method="POST" action="/admin/buy-spotlight" class="hb-form">
          <% for (let i = 0; i < 5; i++) { const p = bsPicks[i]; const cur = p ? p.kind + ':' + p.id : ''; %>
          <label class="hb-row"><span>Slide <%= i + 1 %></span>
            <select name="slide_<%= i + 1 %>">
              <option value="">— Best sellers —</option>
              <% if (bsChoices.boxes.length) { %><optgroup label="Box sets">
                <% bsChoices.boxes.forEach(b => { %><option value="box:<%= b.id %>"<%= cur === 'box:' + b.id ? ' selected' : '' %>><%= b.name %></option><% }) %>
              </optgroup><% } %>
              <optgroup label="Games">
                <% bsChoices.games.forEach(g => { %><option value="game:<%= g.id %>"<%= cur === 'game:' + g.id ? ' selected' : '' %>><%= g.title %></option><% }) %>
              </optgroup>
            </select>
          </label>
          <% } %>
          <div><button type="submit" class="btn btn-primary">Save spotlight</button></div>
        </form>
      </div>
    </div>
`);

rep('views/admin.ejs',
`home_banner_saved:'content',`,
`home_banner_saved:'content', buy_spotlight_saved:'content',`);
rep('views/admin.ejs',
`home_banner_saved:'✅ Homepage banner saved',`,
`home_banner_saved:'✅ Homepage banner saved', buy_spotlight_saved:'✅ Buy page spotlight saved',`);

console.log('edited server.js, content.ejs, admin.ejs');
````

Run: `node .superpowers/tmp-edits/edit-buy-spotlight.js` → `edited server.js, content.ejs, admin.ejs`.
Then: `file server.js` → still `UTF-8 (with BOM) text … with CRLF line terminators`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-admin-buy-spotlight.js && node scripts/test-buy-page.js && node scripts/test-home-banner-admin.js` → `5`, `13`, `4 assertions passed`.
Run the whole suite (the loop in Task 2, Step 6) → only `FAIL scripts/test-requests-page.js`, `failed: 1`.

- [ ] **Step 5: Commit and clean up**

```bash
git add server.js views/partials/admin/content.ejs views/admin.ejs scripts/test-admin-buy-spotlight.js
git commit -m "Admin: pick the Buy page spotlight (games and box sets)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
