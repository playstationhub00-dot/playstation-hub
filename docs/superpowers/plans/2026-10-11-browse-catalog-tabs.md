# Rent / Browse — one catalog with tabs, search and sort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/browse` becomes one catalog. At the top are a search box and a row of tabs, each a ready-made collection: All games · Most rented · New releases · Coming soon · Deals · Available now · Buy to keep · Bundles · PS Plus Deluxe. Below them sit a results bar with Sort and Filters, then one grid. Each homepage "View all" opens its tab.

**Architecture:** The pure rules file `public/js/browse-filter-core.js` is rewritten around the tabs. It knows which games each tab holds, the Sort orders, search and filters, and it runs on the server and in the browser. `GET /browse` builds each game's facts (now with `rank`, `released` and `deal`), the Coming soon list and the PS Plus Deluxe card. It renders every card once, with the active tab's matches first and the rest hidden. `public/js/browse.js` then shows, hides and orders those same cards for every tab, search, sort and filter change, with no reload. The Most rented order comes from a new `rentalRanking` in `lib/home-view.js`, which the homepage's Top rented now slices.

**Tech Stack:** Express + EJS templates, plain browser JS (no build step), plain CSS. Tests are `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-11-browse-catalog-tabs-design.md` (amended after this plan's dry run).

**How this plan was checked.** Every file in this plan was dry-run in a scratch copy of the current `main`. Each new test fails first and then passes. The full suite stays green apart from the known `scripts/test-requests-page.js`. A browser check used a throwaway instance with 27 made-up games, 8 Coming soon games and 40 stubbed PS Plus games.

At 1280px wide:
- The tab row fits on one line, and the search box, tabs and results bar stay pinned under the menu.
- Tabs, search, Sort, the filter panel, chip removal and "Clear filters" all change the grid with no reload. A page marker survived every change.
- Most rented shows #1–#10 badges.
- PS Plus Deluxe shows the Rent card, 24 games, then "Show all 40".
- The old `/browse#comingSoon` opens the Coming soon tab on page load.
- The homepage "View all" links open their tabs.

At 375px wide:
- Nothing scrolls sideways and the grid is 2 cards a row.
- The search box slides under the menu, and the tabs stay at 64px.
- The tab row scrolls sideways, and a tapped tab scrolls into view.
- "Available now · 23 games" wraps to two lines instead of being cut off.

There were no console or server errors.

## Global Constraints

- Work directly on `main` and do not switch branches. **Push only when the owner says "push".**
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Line endings:**
  - `server.js` and `views/browse.ejs` are CRLF + UTF-8 BOM in the working tree.
  - `public/css/style.css` is CRLF.
  - `views/index.ejs` is LF + BOM.
  - Every other file touched here is LF.
  - The edit scripts (via `.superpowers/tmp-edits/rep.js`) keep each file's endings and BOM. `views/browse.ejs` is replaced through `rep.put`, so it keeps its BOM and CRLF.
  - Replaced JS, CSS and test files are written LF.
  - Git stores LF blobs (`core.autocrlf=true`), so a CRLF working copy is expected.
- **Tabs**, in this order, with `?tab=` keys. Tab membership, before search and filters:
  - `all` — every game.
  - `most-rented` — games anyone has rented, in `rentalRanking` order.
  - `new` — the 20 newest released games: release date ≤ today and not TBA, which is the homepage New releases rule.
  - `coming-soon` — every Coming soon game, in the site's `sortUpcoming` order.
  - `deals` — the game's own deal beats the site promo (`gameDiscount.specialDeal`).
  - `available` — a slot is free now; with PS4 on and PS5 off, a PS4 slot.
  - `buy` — has a buy price.
  - `bundles` — `is_bundle`.
  - `psplus` — the PS Plus Deluxe catalog.
- **Showing tabs:** a tab with no games is hidden (All games always shows). An unknown or hidden `?tab=` → All games.
- **Sort labels:** `discount` "Biggest discount", `most-rented` "Most rented", `newest` "Newest", `price-asc` "Price: low to high", `price-desc` "Price: high to low", `az` "A–Z", `release` "Release date".
- **Sort options per tab:**
  - Game tabs offer Most rented, Newest, Price low→high, Price high→low and A–Z.
  - New releases lists Newest first.
  - Deals adds Biggest discount first.
  - Coming soon offers Release date and A–Z.
  - PS Plus Deluxe has A–Z only, so no Sort menu is shown.
- **Default sorts:** a tab's default sort is the first option it offers. An unknown `?sort=` or one the tab does not offer → the default, and the default never appears in the address.
- **Ties:** ties sort by title. Missing prices and dates go last.
- **Search** matches a game's lowercased text (title, description, bundle games) on game tabs, the title on Coming soon, and the name on PS Plus. `?search=` pre-fills the box.
- **Filters** (tier, console, genre, price) apply on game tabs only. On Coming soon and PS Plus Deluxe, the Filters button and chips are hidden, but the filters stay in the address for the other tabs.
- **#1–#10 rank badges** show only on Most rented in Most rented order.
- **Old links:** `avail=1` / `unit=ps4|ps5` → Available now. `new=1` / `newOnly=1` → New releases. `buy=1` → Buy to keep. `bundle=1` → Bundles. `psplus=1` → PS Plus Deluxe. `ps4=1` / `platform=PS4` / `unit=ps4` → the PS4 chip. `#comingSoon` → the Coming soon tab.
- **Homepage links:**
  - Top rented phone shelf "View all" → `/browse?tab=most-rented`.
  - New releases → `/browse?tab=new`.
  - Coming soon → `/browse?tab=coming-soon`.
  - Everything else stays `/browse`.
- Tests use a temp `DATA_DIR`, a blank `MONGODB_URI`, the in-memory session store and a made-up admin password. Never touch the project's `games.json` or a database.
- Known unrelated failure: `scripts/test-requests-page.js`. Report it; do not fix it.
- Edit scripts live in `.superpowers/tmp-edits/` (git-ignored). Never commit them. Task 3 removes the folder.
- Always `git add` explicit paths: the untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.

## Files

| File | Task | Change |
|---|---|---|
| `lib/home-view.js` | 1 | `rentalRanking` (every rented game, in order); `topRented` is its first 10 |
| `scripts/test-home-view.js` | 1 | Ranking test |
| `public/js/browse-filter-core.js` | 2 | Rewritten: tabs, Sort, search, filters, one `view` |
| `scripts/test-browse-filter-core.js` | 2 | Rewritten |
| `server.js` | 2 | Game facts (`rank`, `released`, `deal`; `isNew`/`home` gone), PS Plus rent link, `GET /browse` |
| `views/browse.ejs` | 2 | Rewritten: search, tabs, results bar, filter panel, one grid |
| `public/js/browse.js` | 2 | Rewritten |
| `public/css/browse-filters.css` | 2 | Rewritten: pinned top block, tabs, Sort, rank badges, PS Plus card |
| `public/css/style.css` | 2 | Old PS Plus monthly entry styles removed |
| `views/partials/upcoming-card.ejs` | 2 | Comment: used by the Coming soon tab |
| `views/partials/upcoming-section.ejs` | 2 | Deleted (only the old Browse page used it) |
| `scripts/test-browse-page.js` | 2 | Rewritten |
| `scripts/test-home-coming-soon-row.js` | 2, 3 | Task 2: Browse's Coming soon tab. Task 3: View all link |
| `views/index.ejs` | 3 | Top rented and New releases View all links |
| `views/partials/home/upcoming-row.ejs` | 3 | Coming soon View all link |
| `scripts/test-home-page.js` | 3 | New releases View all |
| `scripts/test-home-top10.js` | 3 | Phone Top rented View all |

---

### Task 1: The full Most rented order

**Files:**
- Create: `.superpowers/tmp-edits/rep.js` (used by every task), `.superpowers/tmp-edits/edit-ranking-test.js`, `.superpowers/tmp-edits/edit-ranking.js`
- Modify (edit script): `lib/home-view.js`, `scripts/test-home-view.js`

**Interfaces:**
- Consumes: `topRented(games, customers, now)` in `lib/home-view.js` (rentals started in the last 30 days, then all-time `renters`, then title; never-rented left out; `TOP_MAX` = 10).
- Produces: `homeView.rentalRanking(games, customers, now)`. It returns the game objects of every rented game, most rented first, with no cap. `topRented` is now `rentalRanking(...).slice(0, TOP_MAX)`, with the same results as before.

- [ ] **Step 1: Write the failing test**

Create `.superpowers/tmp-edits/rep.js`. It keeps a file's BOM and CRLF, fails loudly on a missing or repeated anchor, and has `rep.between` for block replacements and `rep.put` for whole-file replacements:

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

Create `.superpowers/tmp-edits/edit-ranking-test.js`:

````js
// Task 1, step 1: the failing test for the full rental ranking.
const rep = require('./rep');

rep('scripts/test-home-view.js',
`  assert.strictEqual(H.topRented(many, [], now).length, 10);
});
`,
`  assert.strictEqual(H.topRented(many, [], now).length, 10);
});

ok('rental ranking: the whole Top rented order, every rented game, no cap', () => {
  const many = Array.from({ length: 14 }, (_, i) => g(i + 1, 'G' + String(i).padStart(2, '0'), { renters: 20 - i }));
  many.push(g(15, 'Never', { renters: 0 }));
  const all = H.rentalRanking(many, [{ game_id: 9, start_date: daysAgo(2) }], now);
  assert.strictEqual(all.length, 14, 'never-rented left out');
  assert.deepStrictEqual(all.slice(0, 3).map(x => x.id), [9, 1, 2], 'a rental in the last 30 days comes first');
  assert.deepStrictEqual(H.topRented(many, [{ game_id: 9, start_date: daysAgo(2) }], now), all.slice(0, 10));
});
`);

console.log('edited test-home-view.js');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-ranking-test.js` → `edited test-home-view.js`.

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-home-view.js` → FAIL `TypeError: H.rentalRanking is not a function`.

- [ ] **Step 3: Write the ranking**

Create `.superpowers/tmp-edits/edit-ranking.js`:

````js
// Task 1, step 3: the full rental ranking; Top rented is its first 10.
const rep = require('./rep');

rep('lib/home-view.js',
`// Top rented: rentals started in the last 30 days (customer records), ties and
// the rest of the list by the all-time renters figure. Games nobody has rented
// are left out.
function topRented(games, customers, now) {`,
`// Every game anyone has rented, most rented first: rentals started in the last
// 30 days (customer records), ties and the rest of the list by the all-time
// renters figure, then A–Z. Games nobody has rented are left out. Browse's
// "Most rented" tab shows the whole list, the homepage's Top rented the first 10.
function rentalRanking(games, customers, now) {`);

rep('lib/home-view.js',
`    .sort((a, b) => (b.n - a.n) || (b.all - a.all) || a.g.title.localeCompare(b.g.title))
    .slice(0, TOP_MAX)
    .map(x => x.g);
}
`,
`    .sort((a, b) => (b.n - a.n) || (b.all - a.all) || a.g.title.localeCompare(b.g.title))
    .map(x => x.g);
}

function topRented(games, customers, now) {
  return rentalRanking(games, customers, now).slice(0, TOP_MAX);
}
`);

rep('lib/home-view.js',
`weeklyFrom, bannerGames, topRented, powerUp,`,
`weeklyFrom, bannerGames, rentalRanking, topRented, powerUp,`);

console.log('edited home-view.js');
````

Run: `node .superpowers/tmp-edits/edit-ranking.js` → `edited home-view.js`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-home-view.js` → `8 assertions passed`.
Run: `node scripts/test-home-page.js && node scripts/test-home-top10.js` → `14`, `7 assertions passed` (the homepage's Top rented is unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/home-view.js scripts/test-home-view.js
git commit -m "Most rented: the full ranking; the homepage Top rented is its first 10

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Browse becomes one catalog with tabs, search and sort

The rules file, the route, the template and the page script change together. The old page cannot run on the new rules, so they land in one commit.

**Files:**
- Create (replacing the whole file): `public/js/browse-filter-core.js`, `scripts/test-browse-filter-core.js`, `public/js/browse.js`, `public/css/browse-filters.css`, `scripts/test-browse-page.js`
- Create: `.superpowers/tmp-edits/edit-browse-tests.js`, `.superpowers/tmp-edits/edit-browse-server.js`, `.superpowers/tmp-edits/browse.ejs`, `.superpowers/tmp-edits/edit-browse-page.js`
- Modify (edit script): `server.js`, `views/browse.ejs` (whole file, via `rep.put`), `public/css/style.css`, `views/partials/upcoming-card.ejs`, `scripts/test-home-coming-soon-row.js`
- Delete: `views/partials/upcoming-section.ejs`

**Interfaces:**
- Consumes:
  - `homeView.rentalRanking(games, customers, now)` (Task 1).
  - `gameDiscount.specialDeal(game, promo)` → `{ days, pct }` or `null`.
  - `sortUpcoming`, `resolveUpcomingSlots`, `getUpcoming`, `getCustomers`, `gameSlug`, `tierStyle.pillColor` in `server.js`.
  - `.superpowers/tmp-edits/rep.js` (Task 1).
- Produces:
  - `window.BrowseFilterCore` / `require('public/js/browse-filter-core')`. Its functions are `parseState`, `cleanState(s, ctx, data)`, `tabVisible`, `sortOf`, `toQuery`, `href`, `withTab`, `withSort`, `withSearch`, `clearFilters`, `resetState`, `selectedCount`, `toggle`, `isOn`, `clearGroup`, `appliedChips`, `countText`, `applyLabel`, `parseBands`, `normalizeBands`, `bandOf`, `bandLabel`, `genreParts`, `genreList`, `emptyState` and `view(data, s, ctx)`. Its constants are `TABS`, `PSPLUS_LIMIT` (24), `RANKED_MAX` (10), `NEW_MAX` (20) and `DEFAULT_BANDS`.
  - The state is `{ tab, sort, search, tiers, consoles, genres, prices }`.
  - `data` is `{ games, soon, psplus }`.
  - `view` returns `{ tab, label, kind ('games'|'soon'|'psplus'), sort, sorts, tabs, ids, psplus, count, ranked, filters, groups, notes, selected }`.
  - `server.js`:
    - `browseGameFacts(g, accountSummaryMap, promo, rank, todayIso)` adds `rank`, `released` and `deal`.
    - `browsePsplusData(...)` adds `rent` (the PS Plus Deluxe game's page, or `/ps-plus`).
  - Page ids that `browse.js` relies on:
    - `bfTop`, `bfSearchForm`, `bfSearch`
    - `bfTabs` (`.bf-tab[data-tab]`)
    - `bfBar`, `bfCount`, `bfSortWrap`, `bfSort`, `bfOpen`, `bfOpenN`, `bfChips`
    - `bfPanel`, `bfForm`, `bfClose`, `bfBackdrop`, `bfClearAll`, `bfGo`
    - `bfNotes`, `bfEmpty`, `bfReset`
    - `bfGrid` (`.bf-item[data-id]` with an optional `.bf-rank`), `bfSoonGrid` (`.bf-item[data-soon]`)
    - `bfPsplus`, `bfPsGrid`, `bfPsAll`

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-browse-filter-core.js` (replaces the whole file):

````js
// Run: node scripts/test-browse-filter-core.js
//
// The Browse catalog rules (public/js/browse-filter-core.js): the URL, which
// games each tab holds, hidden tabs, every sort order, search, filters on top
// of a tab, the filter panel's chips and counts, and what the results bar says.
const assert = require('assert');
const C = require('../public/js/browse-filter-core');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const bands = { low: 200, high: 300 };
const g = (id, title, o) => Object.assign({
  id, title, text: title.toLowerCase(), tier: null, ps4: false, ps5: true, genres: [], from: 249,
  avail: true, availPs4: false, buy: false, bundle: false, rank: null, released: null, deal: 0
}, o || {});
const games = [
  g(1, 'Elden Ring', { tier: '2', genres: ['Action', 'RPG'], rank: 2, released: '2024-03-01' }),
  g(2, 'Tekken 8', { tier: '2', genres: ['Fighting'], ps4: true, availPs4: true, rank: 1, released: '2026-09-20', deal: 20 }),
  g(3, 'Callisto', { tier: '3', genres: ['Horror'], from: 199, avail: false, buy: true }),
  g(4, 'GTA V', { tier: '4', genres: ['Action'], ps4: true, from: 149, rank: 3, released: '2013-09-17', deal: 35 }),
  g(5, 'Main Account', { bundle: true, from: 299, text: 'main account\nelden ring' }),
  g(6, 'Astro Bot', { tier: '1', genres: ['Platformer'], from: 399, released: '2026-10-01' }),
  g(7, 'Bloodborne', { ps4: true, ps5: false, genres: ['Action'], from: null, rank: 4, released: '2015-03-24' })
];
const soon = [
  { id: 11, title: 'Wolverine', text: 'wolverine', order: 0 },
  { id: 12, title: 'Death Stranding 2', text: 'death stranding 2', order: 1 },
  { id: 13, title: 'Atomic Heart', text: 'atomic heart', order: 2 }
];
const psplus = [
  { k: 'a', n: 'Days Gone', c: '', ps4: true, ps5: false, g: 'Action' },
  { k: 'b', n: 'Returnal', c: '', ps4: false, ps5: true, g: 'Shooter' },
  { k: 'c', n: 'Ghost of Tsushima', c: '', ps4: true, ps5: true, g: 'Action' }
];
const data = { games, soon, psplus };
const ctx = {
  bands,
  tiers: [{ id: '1', name: 'New Games', desc: '' }, { id: '2', name: 'Deluxe', desc: 'Big recent AAA games' }, { id: '3', name: 'Special', desc: '' }, { id: '4', name: 'Regular', desc: '' }],
  genres: C.genreList(games)
};
const st = q => C.parseState(q);
const v = q => C.view(data, C.cleanState(st(q), ctx, data), ctx);
const chip = (view, group, value) => view.groups.find(x => x.key === group).chips.find(c => c.value === String(value));

console.log('\nURL');
ok('parses tab, sort, search and every filter and writes them back in a stable order', () => {
  const s = st({ tab: 'deals', sort: 'az', search: ' elden ', tier: '2,3,abc', console: 'ps4,xbox', genre: 'Action,RPG', price: 'low,bogus' });
  assert.strictEqual(C.toQuery(s), 'tab=deals&sort=az&search=elden&tier=2,3&console=ps4&genre=Action,RPG&price=low');
  assert.strictEqual(C.href(C.emptyState()), '/browse');
});
ok('the tab\'s default order and All games stay out of the address', () => {
  assert.strictEqual(C.toQuery(st({ tab: 'new', sort: 'newest' })), 'tab=new');
  assert.strictEqual(C.toQuery(st({ tab: 'all', sort: 'most-rented' })), '');
  assert.strictEqual(C.toQuery(st({ tab: 'coming-soon', sort: 'price-asc' })), 'tab=coming-soon', 'a sort the tab does not offer is dropped');
});
ok('unknown tab → All games; unknown sort → the tab\'s default', () => {
  assert.strictEqual(st({ tab: 'nope' }).tab, 'all');
  assert.strictEqual(st({ sort: 'cheapest' }).sort, '');
  assert.strictEqual(C.sortOf(st({ tab: 'deals' })), 'discount');
  assert.strictEqual(C.sortOf(st({ tab: 'psplus', sort: 'newest' })), 'az');
});
ok('old links open their tab: avail, new, newOnly, buy, bundle, psplus, unit; ps4 and platform still pick PS4', () => {
  assert.strictEqual(st({ avail: '1' }).tab, 'available');
  assert.strictEqual(st({ 'new': '1' }).tab, 'new');
  assert.strictEqual(st({ newOnly: '1' }).tab, 'new');
  assert.strictEqual(st({ buy: '1' }).tab, 'buy');
  assert.strictEqual(st({ bundle: '1' }).tab, 'bundles');
  assert.strictEqual(st({ psplus: '1' }).tab, 'psplus');
  assert.deepStrictEqual([st({ unit: 'ps4' }).tab, st({ unit: 'ps4' }).consoles], ['available', ['ps4']]);
  assert.deepStrictEqual(st({ ps4: '1' }).consoles, ['ps4']);
  assert.deepStrictEqual(st({ platform: 'PS4', console: 'ps4' }).consoles, ['ps4']);
  assert.strictEqual(st({ tab: 'deals', avail: '1' }).tab, 'deals', 'an explicit tab wins');
});
ok('clean state drops tiers and genres with no chip and a tab with no games', () => {
  const s = C.cleanState(st({ tab: 'bundles', tier: '2,9', genre: 'Action,Gone' }), ctx, { games: games.filter(f => !f.bundle), soon, psplus });
  assert.deepStrictEqual([s.tab, s.tiers, s.genres], ['all', ['2'], ['Action']]);
  assert.strictEqual(C.cleanState(st({ tab: 'bundles' }), ctx, data).tab, 'bundles');
});

console.log('\nTabs');
ok('each tab holds its own games, in its default order', () => {
  assert.deepStrictEqual(v({}).ids, [2, 1, 4, 7, 6, 3, 5], 'All games: most rented, then the never-rented A–Z');
  assert.deepStrictEqual(v({ tab: 'most-rented' }).ids, [2, 1, 4, 7], 'Most rented: rented games only');
  assert.deepStrictEqual(v({ tab: 'new' }).ids, [6, 2, 1, 7, 4], 'New releases: newest first');
  assert.deepStrictEqual(v({ tab: 'coming-soon' }).ids, [11, 12, 13], 'Coming soon: the site\'s Coming soon order');
  assert.deepStrictEqual(v({ tab: 'deals' }).ids, [4, 2], 'Deals: biggest discount first');
  assert.deepStrictEqual(v({ tab: 'available' }).ids, [2, 1, 4, 7, 6, 5]);
  assert.deepStrictEqual(v({ tab: 'buy' }).ids, [3]);
  assert.deepStrictEqual(v({ tab: 'bundles' }).ids, [5]);
  const ps = v({ tab: 'psplus' });
  assert.deepStrictEqual([ps.ids, ps.psplus.map(p => p.k), ps.kind], [[], ['a', 'c', 'b'], 'psplus'], 'PS Plus Deluxe: A–Z');
});
ok('New releases holds only the 20 newest released games', () => {
  const many = Array.from({ length: 25 }, (_, i) => g(100 + i, 'Game ' + String(i).padStart(2, '0'), { released: '2026-01-' + String(i + 1).padStart(2, '0') }));
  const view = C.view({ games: many, soon: [], psplus: [] }, st({ tab: 'new' }), ctx);
  assert.strictEqual(view.ids.length, C.NEW_MAX);
  assert.deepStrictEqual([view.ids[0], view.ids[19]], [124, 105]);
});
ok('the tab row: every tab with games, its count for the search and filters, its link', () => {
  const view = v({ tab: 'most-rented', search: 'elden', sort: 'az' });
  assert.deepStrictEqual(view.tabs.map(t => t.key), ['all', 'most-rented', 'new', 'coming-soon', 'deals', 'available', 'buy', 'bundles', 'psplus']);
  assert.deepStrictEqual(view.tabs.map(t => t.count), [2, 1, 1, 0, 0, 2, 0, 1, 0]);
  assert.deepStrictEqual(view.tabs.filter(t => t.on).map(t => t.key), ['most-rented']);
  assert.strictEqual(view.tabs.find(t => t.key === 'new').href, '/browse?tab=new&search=elden', 'another tab keeps the search, starts in its own order');
  const bare = C.view({ games: games.filter(f => !f.bundle && !f.deal), soon: [], psplus: [] }, C.emptyState(), ctx);
  assert.deepStrictEqual(bare.tabs.map(t => t.key), ['all', 'most-rented', 'new', 'available', 'buy'], 'tabs with no games are hidden');
});

console.log('\nSort');
ok('the Sort menu offers each tab its own choices, its default first', () => {
  const keys = q => v(q).sorts.map(o => o.key);
  assert.deepStrictEqual(keys({}), ['most-rented', 'newest', 'price-asc', 'price-desc', 'az']);
  assert.deepStrictEqual(keys({ tab: 'new' }), ['newest', 'most-rented', 'price-asc', 'price-desc', 'az']);
  assert.deepStrictEqual(keys({ tab: 'deals' }), ['discount', 'most-rented', 'newest', 'price-asc', 'price-desc', 'az']);
  assert.deepStrictEqual(keys({ tab: 'coming-soon' }), ['release', 'az']);
  assert.deepStrictEqual(keys({ tab: 'psplus' }), ['az']);
  assert.deepStrictEqual(v({ sort: 'az' }).sorts.filter(o => o.on).map(o => o.label), ['A–Z']);
});
ok('every order: ties by title, missing prices and dates last', () => {
  assert.deepStrictEqual(v({ sort: 'newest' }).ids, [6, 2, 1, 7, 4, 3, 5]);
  assert.deepStrictEqual(v({ sort: 'price-asc' }).ids, [4, 3, 1, 2, 5, 6, 7]);
  assert.deepStrictEqual(v({ sort: 'price-desc' }).ids, [6, 5, 1, 2, 3, 4, 7]);
  assert.deepStrictEqual(v({ sort: 'az' }).ids, [6, 7, 3, 1, 4, 5, 2]);
  assert.deepStrictEqual(v({ tab: 'coming-soon', sort: 'az' }).ids, [13, 12, 11]);
  assert.strictEqual(C.href(C.withSort(st({ tab: 'deals' }), 'price-asc')), '/browse?tab=deals&sort=price-asc');
});
ok('#1–#10 badges only on Most rented in Most rented order', () => {
  assert.strictEqual(v({ tab: 'most-rented' }).ranked, true);
  assert.strictEqual(v({ tab: 'most-rented', sort: 'az' }).ranked, false);
  assert.strictEqual(v({}).ranked, false);
});

console.log('\nSearch and filters');
ok('search matches the game\'s text on game tabs, the title on Coming soon, the name on PS Plus', () => {
  assert.deepStrictEqual(v({ search: 'ELDEN' }).ids, [1, 5], 'a bundle matches by the games inside it');
  assert.deepStrictEqual(v({ tab: 'coming-soon', search: 'strand' }).ids, [12]);
  assert.deepStrictEqual(v({ tab: 'psplus', search: 'ghost' }).psplus.map(p => p.k), ['c']);
  assert.strictEqual(C.withSearch(C.emptyState(), '  tekken ').search, 'tekken');
});
ok('filters work on top of a tab', () => {
  assert.deepStrictEqual(v({ tab: 'most-rented', console: 'ps4', price: 'low' }).ids, [4]);
  assert.deepStrictEqual(v({ tab: 'available', console: 'ps4' }).ids, [2], 'PS4 only: a PS4 slot must be free');
  assert.deepStrictEqual(v({ tab: 'available', console: 'ps4,ps5' }).ids, [2, 1, 4, 7, 6, 5]);
  assert.deepStrictEqual(v({ tier: '2', genre: 'RPG' }).ids, [1]);
});
ok('filters do not apply on Coming soon or PS Plus Deluxe (the panel keeps All games\' rows)', () => {
  const cs = v({ tab: 'coming-soon', console: 'ps4' });
  assert.deepStrictEqual([cs.ids, cs.filters, cs.notes], [[11, 12, 13], false, []]);
  assert.strictEqual(chip(cs, 'console', 'ps4').count, 3, 'counted on All games');
  assert.strictEqual(v({ tab: 'psplus', genre: 'Shooter' }).psplus.length, 3);
  assert.strictEqual(v({ tab: 'psplus', genre: 'Action' }).selected, 1, 'the filters are kept for the other tabs');
});
ok('panel chips count what the tab would show; a chip nothing in the library has is left out', () => {
  const view = v({ tab: 'most-rented' });
  assert.deepStrictEqual(view.groups.map(x => x.key), ['tier', 'console', 'genre', 'price']);
  assert.strictEqual(chip(view, 'console', 'ps4').count, 3);
  assert.deepStrictEqual([chip(view, 'tier', '3').count, chip(view, 'tier', '3').zero, chip(view, 'tier', '3').href], [0, true, null]);
  assert.strictEqual(chip(view, 'genre', 'Action').href, '/browse?tab=most-rented&genre=Action');
  const on = v({ tab: 'most-rented', genre: 'Action' });
  assert.deepStrictEqual([chip(on, 'genre', 'Action').on, chip(on, 'genre', 'Action').count], [true, 3]);
  const noBundle = C.view({ games: games.filter(f => f.tier !== '1'), soon, psplus }, C.emptyState(), ctx);
  assert.ok(!noBundle.groups[0].chips.some(c => c.value === '1'));
});
ok('the filter bar: one chip per filter (no search chip); Clear all and the empty grid\'s reset', () => {
  const s = st({ tab: 'deals', sort: 'az', search: 'x', tier: '2', console: 'ps4', genre: 'Action', price: 'low' });
  const chips = C.appliedChips(s, ctx);
  assert.deepStrictEqual(chips.map(c => c.label), ['Deluxe', 'PS4', 'Action', 'Under ₱200']);
  assert.strictEqual(chips[1].href, '/browse?tab=deals&sort=az&search=x&tier=2&genre=Action&price=low');
  assert.strictEqual(C.href(C.clearFilters(s)), '/browse?tab=deals&sort=az&search=x');
  assert.strictEqual(C.href(C.resetState(s)), '/browse?tab=deals&sort=az');
  assert.strictEqual(C.selectedCount(s), 4);
  assert.deepStrictEqual(C.clearGroup(s, 'genre').genres, []);
});
ok('tier descriptions for the filtered tiers that have one', () => {
  assert.deepStrictEqual(v({ tier: '2,3' }).notes, [{ name: 'Deluxe', desc: 'Big recent AAA games' }]);
  assert.deepStrictEqual(v({}).notes, []);
});
ok('the results bar and the panel button', () => {
  assert.strictEqual(C.countText(v({ tab: 'most-rented' })), 'Most rented · 4 games');
  assert.strictEqual(C.countText(v({ tab: 'buy' })), 'Buy to keep · 1 game');
  assert.deepStrictEqual(C.applyLabel(v({ tab: 'deals' })), { text: 'Show 2 games', disabled: false });
  assert.deepStrictEqual(C.applyLabel(v({ search: 'zzz' })), { text: 'No games match', disabled: true });
});

console.log('\nPrice bands');
ok('price bands use the card price', () => {
  assert.strictEqual(C.bandOf(199, bands), 'low');
  assert.strictEqual(C.bandOf(200, bands), 'mid');
  assert.strictEqual(C.bandOf(300, bands), 'high');
  assert.strictEqual(C.bandOf(null, bands), null);
  assert.deepStrictEqual(['low', 'mid', 'high'].map(b => C.bandLabel(b, bands)), ['Under ₱200', '₱200–299', '₱300+']);
});
ok('price band settings: two whole numbers, low below high, else the defaults', () => {
  assert.deepStrictEqual(C.parseBands('150', ' 250 '), { low: 150, high: 250 });
  assert.strictEqual(C.parseBands('300', '300'), null);
  assert.strictEqual(C.parseBands('99.5', '200'), null);
  assert.deepStrictEqual(C.normalizeBands(undefined), { low: 200, high: 300 });
  assert.deepStrictEqual(C.genreParts('Action, RPG/Action'), ['Action', 'RPG']);
});

console.log('\n' + passed + ' assertions passed\n');
````

Create `scripts/test-browse-page.js` (replaces the whole file):

````js
// Run: node scripts/test-browse-page.js
//
// The Browse catalog as the server renders it for a URL: the search box, the
// tab row (counts, hidden empty tabs, the active tab), each tab's grid in its
// order, #1–#10 badges on Most rented, Coming soon cards, the PS Plus Deluxe
// tab, the Sort menu, filters on top of a tab, the filter bar and panel, a
// tier's description, the empty grid, old links, and the facts handed to the
// page script. The rules themselves: scripts/test-browse-filter-core.js.
// Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory
// sessions, a stubbed PS Plus list); the project's games.json and the
// database are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4616;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-page-'));
const daysAgo = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
// A local calendar date d days from today — the Coming soon card counts days in local time.
const daysAhead = d => {
  const t = new Date(Date.now() + d * 86400000);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
};
const price = (nt7, nt30, tr7, tr30) => ({ nt_price_7d: nt7, nt_price_30d: nt30, tr_price_7d: tr7, tr_price_30d: tr30 });
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '/uploads/' + id + '.png',
  non_trophy_slots: 1, trophy_slots: 1, renters: 0, created_at: '2020-01-01T00:00:00.000Z'
}, price(349, 799, 399, 899), extra || {});
const up = (id, title, release_date) => Object.assign({
  id, title, platform: 'PS5', release_date, cover_image: '/uploads/up' + id + '.png', non_trophy_slots: 1, trophy_slots: 1
}, price(349, 1099, 0, 0));
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 }, browse_price_bands: { low: 180, high: 300 } },
  price_categories: [
    Object.assign({ id: 1, name: 'New Games' }, price(399, 899, 449, 999)),
    Object.assign({ id: 2, name: 'Deluxe', description: 'Big recent AAA games' }, price(249, 599, 299, 699)),
    Object.assign({ id: 3, name: 'Special', pill_color: 'pink' }, price(199, 499, 249, 549))
  ],
  psplus_prices: { nt_price_7d: 159, tr_price_7d: 199 },
  psplus_slots: { nt_slots: 1, tr_slots: 0, ps4_slots: 0 },
  games: [
    game(1, 'Zzyzx Astro', { price_category_id: 1, genre: 'Platformer', release_date: daysAgo(5) }),
    game(2, 'Zzyzx Elden', { price_category_id: 2, genre: 'Action, RPG', release_date: '2022-02-25', renters: 9 }),
    game(3, 'Zzyzx Tekken', { price_category_id: 2, genre: 'Fighting', platform: 'PS4/PS5', ps4_primary_slots: 1, release_date: '2024-01-26', renters: 3, discounts: { 7: 40 } }),
    game(4, 'Zzyzx Callisto', { price_category_id: 3, genre: 'Horror', platform: 'PS4/PS5', non_trophy_slots: 0, trophy_slots: 0, buy_nt_price: 999 }),
    game(5, 'Zzyzx Plain', Object.assign({ platform: 'PS4', description: 'Old </script><b>favourite', release_date: 'TBA', renters: 1 }, price(149, 349, 199, 449))),
    game(6, 'PS Plus Deluxe', { genre: '' })
  ],
  customers: [{ id: 1, game_id: 3, start_date: daysAgo(2), status: 'renting' }],
  upcoming: [up(1, 'Zzyzx Wolverine', daysAhead(30)), up(2, 'Zzyzx Fable', 'TBA'), up(3, 'Zzyzx Marvel', daysAhead(5))]
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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.end();
  });
}
async function page(p) { const r = await call(p); assert.strictEqual(r.status, 200, p); return r.body; }
// The HTML between an element's id and the next element id given.
function between(html, startId, endId) {
  const i = html.indexOf('id="' + startId + '"');
  assert.ok(i >= 0, startId + ' found');
  const j = endId ? html.indexOf('id="' + endId + '"', i) : html.length;
  return html.slice(i, j);
}
const opening = (html, id) => { const i = html.indexOf('id="' + id + '"'); return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1); };
const unamp = s => s.replace(/&amp;/g, '&');
// The game cards the grid shows, in order (hidden ones wait for another tab).
const shown = html => [...between(html, 'bfGrid', 'bfSoonGrid').matchAll(/<div class="bf-item" data-id="(\d+)"( hidden)?>/g)].filter(m => !m[2]).map(m => Number(m[1]));
const allCards = html => [...between(html, 'bfGrid', 'bfSoonGrid').matchAll(/<div class="bf-item" data-id="(\d+)"/g)].map(m => Number(m[1]));
const soonShown = html => [...between(html, 'bfSoonGrid', 'bfPsplus').matchAll(/<div class="bf-item" data-soon="(\d+)"( hidden)?>/g)].filter(m => !m[2]).map(m => Number(m[1]));
const tabs = html => [...between(html, 'bfTabs', 'bfBar').matchAll(/<a class="bf-tab( on)?" data-tab="([\w-]+)" href="([^"]*)"[^>]*>([^<]*?) <span class="bf-tab-n">(\d+)<\/span><\/a>/g)]
  .map(m => ({ key: m[2], on: !!m[1], href: unamp(m[3]), label: m[4], count: Number(m[5]) }));
const countOf = html => /<span class="bf-count" id="bfCount">([^<]*)<\/span>/.exec(html)[1];
const sorts = html => [...between(html, 'bfSort', 'bfOpen').matchAll(/<option value="([\w-]+)"( selected)?>/g)].map(m => (m[2] ? '*' : '') + m[1]);
const barChips = html => [...between(html, 'bfChips', 'bfPanel').matchAll(/<a class="bf-chip-x" data-group="(\w+)" data-value="([^"]*)" href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(m => ({ group: m[1], value: m[2], href: unamp(m[3]), label: m[4] }));
const ranks = html => [...between(html, 'bfGrid', 'bfSoonGrid').matchAll(/<span class="bf-rank bf-rk-(\d+)"( hidden)?>#\d+<\/span>/g)].map(m => (m[2] ? 'hidden ' : '') + '#' + m[1]);
function browseData(html) {
  const m = /<script type="application\/json" id="browseData">([\s\S]*?)<\/script>/.exec(html);
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
  // A small PS Plus Deluxe list instead of the database copy.
  require('../lib/psplus-catalog-store').all = () => [
    { key: 'returnal', name: 'Returnal', image_url: '', platforms: ['PS5'], genres: ['SHOOTER'], lists: ['catalog'] },
    { key: 'days-gone', name: 'Days Gone', image_url: 'https://image.test/dg.png', platforms: ['PS4'], genres: ['ACTION'], lists: ['catalog'] },
    { key: 'hidden-one', name: 'Hidden One', platforms: ['PS5'], genres: [], lists: ['catalog'], hidden: true }
  ];
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const all = await page('/browse');

  console.log('\nthe page');
  await okAsync('title, search box, the tab row with counts (no Bundles tab: there are none), All games on', async () => {
    assert.ok(all.includes('<h1>Browse games</h1>'));
    assert.ok(opening(all, 'bfSearch').includes('placeholder="Search 6 games…"'));
    assert.ok(opening(all, 'bfSearch').includes('value=""'));
    assert.deepStrictEqual(tabs(all).map(t => t.key + ' ' + t.count), ['all 6', 'most-rented 3', 'new 3', 'coming-soon 3', 'deals 1', 'available 5', 'buy 1', 'psplus 2']);
    assert.deepStrictEqual(tabs(all).filter(t => t.on).map(t => t.key), ['all']);
    assert.ok(all.includes('data-tab="all" href="/browse" aria-current="page"'));
    assert.deepStrictEqual(tabs(all).slice(1, 4).map(t => t.href), ['/browse?tab=most-rented', '/browse?tab=new', '/browse?tab=coming-soon']);
    assert.strictEqual(countOf(all), 'All games · 6 games');
  });
  await okAsync('All games: every game, most rented first, then the never-rented A–Z', async () => {
    assert.deepStrictEqual(shown(all), [3, 2, 5, 6, 1, 4]);
    assert.deepStrictEqual(ranks(all), ['hidden #1', 'hidden #2', 'hidden #3'], 'badges wait for the Most rented tab');
    assert.deepStrictEqual(sorts(all), ['*most-rented', 'newest', 'price-asc', 'price-desc', 'az']);
    assert.ok(opening(all, 'bfSoonGrid').includes(' hidden') && opening(all, 'bfPsplus').includes(' hidden'));
    assert.ok(opening(all, 'bfEmpty').includes(' hidden'));
  });
  await okAsync('the old page is gone: no Coming soon slider, tier sections or PS Plus monthly block', async () => {
    ['upcomingSlider', 'slideUpcoming', 'bfSections', 'cat-section', 'psplus-entries', 'psplus-browse-entry', 'Also in PS Plus Deluxe'].forEach(t => assert.ok(!all.includes(t), t));
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'views', 'partials', 'upcoming-section.ejs')));
  });

  console.log('\ntabs');
  await okAsync('Most rented: rented games only, with #1–#10 badges', async () => {
    const h = await page('/browse?tab=most-rented');
    assert.deepStrictEqual(shown(h), [3, 2, 5]);
    assert.deepStrictEqual(allCards(h).sort(), [1, 2, 3, 4, 5, 6], 'every card is on the page for the other tabs');
    assert.deepStrictEqual(ranks(h), ['#1', '#2', '#3']);
    assert.ok(h.includes('data-tab="most-rented" href="/browse?tab=most-rented" aria-current="page"'));
    assert.strictEqual(countOf(h), 'Most rented · 3 games');
    assert.deepStrictEqual(ranks(await page('/browse?tab=most-rented&sort=az')).sort(), ['hidden #1', 'hidden #2', 'hidden #3'], 'only in Most rented order');
  });
  await okAsync('New releases: released games, newest first (TBA and undated left out)', async () => {
    const h = await page('/browse?tab=new');
    assert.deepStrictEqual(shown(h), [1, 3, 2]);
    assert.deepStrictEqual(sorts(h), ['*newest', 'most-rented', 'price-asc', 'price-desc', 'az']);
  });
  await okAsync('Coming soon: every Coming soon game, soonest first, TBA last; no filters', async () => {
    const h = await page('/browse?tab=coming-soon');
    assert.deepStrictEqual(soonShown(h), [3, 1, 2]);
    assert.deepStrictEqual(shown(h), []);
    assert.ok(opening(h, 'bfGrid').includes(' hidden'));
    assert.ok(between(h, 'bfSoonGrid', 'bfPsplus').includes('href="/upcoming/zzyzx-marvel-3" class="game-card upcoming-card'));
    assert.deepStrictEqual(sorts(h), ['*release', 'az']);
    assert.ok(opening(h, 'bfOpen').includes(' hidden'), 'no Filters button');
    assert.strictEqual(countOf(h), 'Coming soon · 3 games');
  });
  await okAsync('Deals, Available now and Buy to keep', async () => {
    assert.deepStrictEqual(shown(await page('/browse?tab=deals')), [3]);
    assert.deepStrictEqual(sorts(await page('/browse?tab=deals')).slice(0, 2), ['*discount', 'most-rented']);
    assert.deepStrictEqual(shown(await page('/browse?tab=available')), [3, 2, 5, 6, 1]);
    assert.deepStrictEqual(shown(await page('/browse?tab=buy')), [4]);
  });
  await okAsync('PS Plus Deluxe: the account to rent, then its games (drawn by the page script), A–Z only', async () => {
    const h = await page('/browse?tab=psplus');
    assert.ok(!opening(h, 'bfPsplus').includes(' hidden'));
    const lead = between(h, 'bfPsplus', 'bfPsGrid');
    assert.ok(lead.includes('<a class="bf-ps-lead" href="/game/ps-plus-deluxe">'));
    assert.ok(lead.includes('Hundreds of games, one account') && lead.includes('from <b>₱159</b>/week') && lead.includes('>Rent</span>'));
    assert.ok(opening(h, 'bfSortWrap').includes(' hidden'), 'one order: no Sort menu');
    assert.deepStrictEqual(browseData(h).psplus.map(p => p.k).sort(), ['days-gone', 'returnal'], 'hidden games left out');
    assert.strictEqual(countOf(h), 'PS Plus Deluxe · 2 games');
  });
  await okAsync('unknown or empty tabs open All games; an unknown sort falls back', async () => {
    const h = await page('/browse?tab=bundles&sort=cheapest');
    assert.deepStrictEqual(tabs(h).filter(t => t.on).map(t => t.key), ['all']);
    assert.deepStrictEqual(shown(h), [3, 2, 5, 6, 1, 4]);
    assert.strictEqual(browseData(h).state.tab, 'all');
  });

  console.log('\nsearch, sort and filters');
  await okAsync('?search= fills the box and narrows the grid and every tab count', async () => {
    const h = await page('/browse?search=elden');
    assert.ok(opening(h, 'bfSearch').includes('value="elden"'));
    assert.deepStrictEqual(shown(h), [2]);
    assert.deepStrictEqual(tabs(h).map(t => t.count), [1, 1, 1, 0, 0, 1, 0, 0]);
    assert.strictEqual(tabs(h)[2].href, '/browse?tab=new&search=elden');
  });
  await okAsync('?sort= orders the grid and stays out of the tab links', async () => {
    const h = await page('/browse?sort=az');
    assert.deepStrictEqual(shown(h), [6, 1, 4, 2, 5, 3]);
    assert.deepStrictEqual(sorts(h), ['most-rented', 'newest', 'price-asc', 'price-desc', '*az']);
    assert.strictEqual(tabs(h)[1].href, '/browse?tab=most-rented');
    assert.deepStrictEqual(shown(await page('/browse?sort=price-asc')), [5, 3, 4, 2, 6, 1], 'Tekken\'s 40% deal makes it ₱149; ties by title');
  });
  await okAsync('filters on top of a tab, with the filter bar\'s chips', async () => {
    const h = await page('/browse?tab=most-rented&console=ps4&price=low');
    assert.deepStrictEqual(shown(h), [3, 5]);
    assert.deepStrictEqual(barChips(h).map(c => c.label + ' ' + c.href), ['PS4 ✕ /browse?tab=most-rented&price=low', 'Under ₱180 ✕ /browse?tab=most-rented&console=ps4']);
    assert.ok(between(h, 'bfChips', 'bfPanel').includes('<a class="bf-clear" href="/browse?tab=most-rented" data-clear-all="1">Clear all</a>'));
    assert.ok(opening(h, 'bfOpen').includes('bf-open bf-has'));
    assert.ok(h.includes('<span id="bfOpenN"> · 2</span>'));
  });
  await okAsync('old links: Show ticks open their tab, PS4 links still pick PS4, quick picks open All games', async () => {
    assert.deepStrictEqual(tabs(await page('/browse?avail=1')).filter(t => t.on).map(t => t.key), ['available']);
    assert.deepStrictEqual(tabs(await page('/browse?newOnly=1')).filter(t => t.on).map(t => t.key), ['new']);
    assert.deepStrictEqual(shown(await page('/browse?unit=ps4')), [3], 'a free PS4 slot');
    const pick = await page('/browse?genre=Horror');
    assert.deepStrictEqual([tabs(pick).filter(t => t.on).map(t => t.key), shown(pick)], [['all'], [4]]);
  });
  await okAsync('a filtered tier shows its description', async () => {
    const h = await page('/browse?tier=2');
    assert.ok(between(h, 'bfNotes', 'bfEmpty').includes('<p class="cat-desc"><b>Deluxe</b> — Big recent AAA games</p>'));
    assert.ok(!between(all, 'bfNotes', 'bfEmpty').includes('cat-desc'));
  });
  await okAsync('nothing matches: the empty grid clears search and filters, keeps the tab', async () => {
    const h = await page('/browse?tab=deals&search=zzzz&console=ps5');
    assert.ok(!opening(h, 'bfEmpty').includes(' hidden'));
    assert.ok(between(h, 'bfEmpty', 'bfGrid').includes('No games match.'));
    assert.ok(between(h, 'bfEmpty', 'bfGrid').includes('<a class="btn btn-outline" id="bfReset" href="/browse?tab=deals">Clear filters</a>'));
  });
  await okAsync('the filter panel: tier, console, genre and price rows; a plain form that keeps tab, sort and search', async () => {
    const h = await page('/browse?tab=deals&sort=az&search=zzyzx');
    const form = between(h, 'bfForm', 'bfGo');
    assert.deepStrictEqual([...form.matchAll(/<section class="bf-sec" data-group="(\w+)">/g)].map(m => m[1]), ['tier', 'console', 'genre', 'price']);
    ['<input type="hidden" name="tab" value="deals">', '<input type="hidden" name="sort" value="az">', '<input type="hidden" name="search" value="zzyzx">'].forEach(t => assert.ok(form.includes(t), t));
    assert.ok(/<label class="bf-opt" data-group="tier" data-value="2">[\s\S]*?Big recent AAA games · from ₱149[\s\S]*?<input type="checkbox" name="tier" value="2">/.test(form));
    assert.ok(!between(all, 'bfForm', 'bfGo').includes('name="tab"'), 'All games needs no tab field');
  });

  console.log('\npage script');
  await okAsync('facts for every game and Coming soon game, safely embedded, plus the scripts and styles', async () => {
    const d = browseData(all);
    const tekken = d.games.find(g => g.id === 3);
    assert.deepStrictEqual([tekken.tier, tekken.rank, tekken.released, tekken.deal, tekken.availPs4], ['2', 1, '2024-01-26', 40, true]);
    assert.deepStrictEqual([d.games.find(g => g.id === 5).released, d.games.find(g => g.id === 1).rank], [null, null]);
    assert.deepStrictEqual(d.soon.map(u => [u.id, u.order]), [[3, 0], [1, 1], [2, 2]]);
    assert.deepStrictEqual(d.state, { tab: 'all', sort: '', search: '', tiers: [], consoles: [], genres: [], prices: [] });
    assert.deepStrictEqual(d.ctx.tiers[1], { id: '2', name: 'Deluxe', desc: 'Big recent AAA games' });
    assert.strictEqual(d.psplusFrom, 159);
    assert.ok(all.includes('\\u003c/script>\\u003cb>favourite'), 'a description cannot close the script');
    ['/js/browse-filter-core.js', '/js/browse.js', '/css/browse-filters.css'].forEach(src => assert.ok(all.includes(src + '?v='), src));
    assert.strictEqual((await call('/js/browse.js')).status, 200);
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'browse.js'), 'utf8');
    assert.ok(js.includes("location.hash === '#comingSoon'"), 'old #comingSoon links open the Coming soon tab');
    assert.ok(js.includes("location.hash = ''"), 'clears the hash so :target un-matches');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'browse-filters.css'), 'utf8');
    assert.ok(css.includes('minmax(max(200px, calc((100% - 5rem) / 6)), 1fr)'), 'at most 6 a row');
    assert.ok(/\.bf-top \{ position: sticky; top: 64px;/.test(css), 'search, tabs and bar pinned under the menu');
    assert.ok(/\.bf-results \[hidden\] \{ display: none; \}/.test(css), 'hidden cards stay hidden');
  });
  await okAsync('the PS Plus page still shows its weekly price', async () => {
    const r = await call('/ps-plus');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('<b>₱159</b><span>/ week</span>'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

Create `.superpowers/tmp-edits/edit-browse-tests.js`:

````js
// Task 3, step 1: the homepage Coming soon test now finds Browse's Coming soon
// games on its Coming soon tab instead of the old slider.
const rep = require('./rep');
const F = 'scripts/test-home-coming-soon-row.js';

rep(F,
`// arrows and no drifting. Browse keeps its own slider, and both pages draw the
// same card (views/partials/upcoming-card.ejs).`,
`// arrows and no drifting. Browse lists them all on its Coming soon tab, and
// both pages draw the same card (views/partials/upcoming-card.ejs).`);

rep(F,
`  const browse = (await get('/browse')).body;`,
`  const browse = (await get('/browse?tab=coming-soon')).body;`);

rep.between(F,
`  ok('Browse keeps its Coming soon slider with arrows and every game', () => {`,
`    assert.deepStrictEqual(upcomingIds(b), [1, 2, 3, 5, 6, 7, 4]);
  });`,
`  ok('Browse\\'s Coming soon tab lists every game in the same order, no slider', () => {
    assert.deepStrictEqual(upcomingIds(slice(browse, 'id="bfSoonGrid"', 'id="bfPsplus"')), [1, 2, 3, 5, 6, 7, 4]);
    assert.ok(!browse.includes('id="upcomingSlider"') && !browse.includes('slideUpcoming'));
  });`);

console.log('edited test-home-coming-soon-row.js');
````

Run: `node .superpowers/tmp-edits/edit-browse-tests.js` → `edited test-home-coming-soon-row.js`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-browse-filter-core.js` → FAIL `AssertionError … + 'search=elden&tier=2,3&console=ps4&genre=Action,RPG&price=low' - 'tab=deals&sort=az&search=elden&…'`.
Run: `node scripts/test-browse-page.js` → FAIL `assert.ok(all.includes('<h1>Browse games</h1>'))`.
Run: `node scripts/test-home-coming-soon-row.js` → FAIL `AssertionError [ERR_ASSERTION]: id="bfSoonGrid" found`.

- [ ] **Step 3: Write the catalog rules**

Create `public/js/browse-filter-core.js` (replaces the whole file):

````js
// The pure half of the Browse catalog: the tabs (ready-made collections), the
// Sort menu, the search box and the filters — reading and writing the URL,
// which games each tab holds and in what order, and what each filter chip
// would give. No DOM here — the server uses it for the first render (server.js
// GET /browse) and public/js/browse.js uses the same rules for every click, so
// the two can never disagree.
//
// data: { games, soon, psplus }
//  - a site game (server.js browseGameFacts):
//    { id, title, text (lowercased search text), tier ('3' | null), ps4, ps5,
//      genres: [..], from (card's "from ₱X" | null), avail, availPs4, buy,
//      bundle, rank (1 = most rented | null when never rented),
//      released ('YYYY-MM-DD' | null), deal (the game's own deal %, 0 if none) }
//  - a Coming soon game: { id, title, text, order (the site's Coming soon order) }
//  - a PS Plus Deluxe game: { k, n (name), c (cover url), ps4, ps5, g (genre) }
// ctx: { bands: { low, high }, tiers: [{ id: '3', name, desc }], genres: [..] }
//
// See docs/superpowers/specs/2026-10-11-browse-catalog-tabs-design.md.
(function (root) {
  var TABS = [
    ['all', 'All games'], ['most-rented', 'Most rented'], ['new', 'New releases'], ['coming-soon', 'Coming soon'],
    ['deals', 'Deals'], ['available', 'Available now'], ['buy', 'Buy to keep'], ['bundles', 'Bundles'], ['psplus', 'PS Plus Deluxe']
  ];
  var SORTS = {
    discount: 'Biggest discount', 'most-rented': 'Most rented', newest: 'Newest', 'price-asc': 'Price: low to high',
    'price-desc': 'Price: high to low', az: 'A–Z', release: 'Release date'
  };
  var GAME_SORTS = ['most-rented', 'newest', 'price-asc', 'price-desc', 'az'];
  var DEFAULT_SORT = { 'new': 'newest', 'coming-soon': 'release', deals: 'discount', psplus: 'az' };
  var CONSOLES = [['ps4', 'PS4'], ['ps5', 'PS5']];
  var PRICES = ['low', 'mid', 'high'];
  var DEFAULT_BANDS = { low: 200, high: 300 };
  var NEW_MAX = 20;
  var RANKED_MAX = 10;
  var PSPLUS_LIMIT = 24;

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

  // A game's genre field is free text ("Action, RPG", "Action/Adventure"): each
  // part is its own genre chip.
  function genreParts(genre) {
    var out = [];
    String(genre == null ? '' : genre).split(/[,/]/).forEach(function (p) {
      p = p.trim();
      if (p && out.indexOf(p) < 0) out.push(p);
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

  // What a tab's grid holds: site games, Coming soon games or PS Plus games.
  function kindOf(tab) { return tab === 'coming-soon' ? 'soon' : tab === 'psplus' ? 'psplus' : 'games'; }

  // The Sort menu's choices for a tab; the tab's default first.
  function sortsFor(tab) {
    if (tab === 'coming-soon') return ['release', 'az'];
    if (tab === 'psplus') return ['az'];
    if (tab === 'deals') return ['discount'].concat(GAME_SORTS);
    if (tab === 'new') return ['newest'].concat(GAME_SORTS.filter(function (k) { return k !== 'newest'; }));
    return GAME_SORTS;
  }
  function defaultSort(tab) { return DEFAULT_SORT[tab] || 'most-rented'; }
  // The order in use: the address's choice when the tab offers it, else the tab's default.
  function sortOf(s) { return sortsFor(s.tab).indexOf(s.sort) >= 0 ? s.sort : defaultSort(s.tab); }

  function emptyState() {
    return { tab: 'all', sort: '', search: '', tiers: [], consoles: [], genres: [], prices: [] };
  }

  function clone(s) {
    return {
      tab: s.tab, sort: s.sort, search: s.search,
      tiers: s.tiers.slice(), consoles: s.consoles.slice(), genres: s.genres.slice(), prices: s.prices.slice()
    };
  }

  // URL query (Express req.query or Object.fromEntries(URLSearchParams)) → state.
  // Old links keep working: the old "Show" ticks (avail=1, new=1, newOnly=1,
  // buy=1, bundle=1) and psplus=1 open their tab; ps4=1, platform=PS4 and
  // unit=ps4|ps5 still work.
  function parseState(q) {
    q = q || {};
    var s = emptyState();
    var unit = first(q.unit);
    var tab = first(q.tab);
    if (isTab(tab)) s.tab = tab;
    else if (first(q.avail) === '1' || unit === 'ps4' || unit === 'ps5') s.tab = 'available';
    else if (first(q['new']) === '1' || first(q.newOnly) === '1') s.tab = 'new';
    else if (first(q.buy) === '1') s.tab = 'buy';
    else if (first(q.bundle) === '1') s.tab = 'bundles';
    else if (first(q.psplus) === '1') s.tab = 'psplus';
    var sort = first(q.sort);
    s.sort = SORTS[sort] ? sort : '';
    var search = first(q.search);
    s.search = String(search == null ? '' : search).trim();
    s.tiers = list(q.tier).filter(function (t) { return /^\d+$/.test(t); });
    s.consoles = list(q.console).filter(function (c) { return c === 'ps4' || c === 'ps5'; });
    if ((first(q.ps4) === '1' || first(q.platform) === 'PS4' || unit === 'ps4') && s.consoles.indexOf('ps4') < 0) s.consoles.push('ps4');
    s.genres = list(q.genre);
    s.prices = list(q.price).filter(function (p) { return PRICES.indexOf(p) >= 0; });
    return s;
  }

  // The newest released games, newest first: the New releases tab.
  function newestIds(games) {
    var out = {};
    (games || []).filter(function (f) { return f.released; })
      .sort(function (a, b) { return cmp(a.released, b.released, -1) || a.title.localeCompare(b.title); })
      .slice(0, NEW_MAX)
      .forEach(function (f) { out[f.id] = true; });
    return out;
  }

  // With the PS4 chip on and PS5 off, "Available now" means a PS4 slot is free.
  function ps4Only(s) { return s.consoles.indexOf('ps4') >= 0 && s.consoles.indexOf('ps5') < 0; }

  function inTab(f, tab, s, newIds) {
    if (tab === 'most-rented') return f.rank != null;
    if (tab === 'new') return !!newIds[f.id];
    if (tab === 'deals') return f.deal > 0;
    if (tab === 'available') return !!(ps4Only(s) ? f.availPs4 : f.avail);
    if (tab === 'buy') return !!f.buy;
    if (tab === 'bundles') return !!f.bundle;
    return true;
  }

  // The tab's own collection, before search and filters.
  function members(data, tab, s, newIds) {
    var k = kindOf(tab);
    if (k === 'soon') return data.soon || [];
    if (k === 'psplus') return data.psplus || [];
    return (data.games || []).filter(function (f) { return inTab(f, tab, s, newIds); });
  }

  // A tab shows only when it holds something (All games always does).
  function tabVisible(data, tab) {
    if (tab === 'all') return true;
    return isTab(tab) && members(data, tab, emptyState(), newestIds(data.games)).length > 0;
  }

  // Drops what the page has no button for — a tier or genre from an old shared
  // link (a deleted category, a genre no game has any more), or a tab with no
  // games — so nothing can silently hide every game.
  function cleanState(s, ctx, data) {
    var n = clone(s);
    var tierIds = (ctx.tiers || []).map(function (t) { return String(t.id); });
    n.tiers = n.tiers.filter(function (t) { return tierIds.indexOf(t) >= 0; });
    n.genres = n.genres.filter(function (g) { return (ctx.genres || []).indexOf(g) >= 0; });
    if (!tabVisible(data, n.tab)) n.tab = 'all';
    return n;
  }

  function toQuery(s) {
    var parts = [];
    if (s.tab && s.tab !== 'all') parts.push('tab=' + s.tab);
    if (sortOf(s) !== defaultSort(s.tab)) parts.push('sort=' + sortOf(s));
    if (s.search) parts.push('search=' + encodeURIComponent(s.search));
    if (s.tiers.length) parts.push('tier=' + s.tiers.join(','));
    if (s.consoles.length) parts.push('console=' + s.consoles.join(','));
    if (s.genres.length) parts.push('genre=' + s.genres.map(encodeURIComponent).join(','));
    if (s.prices.length) parts.push('price=' + s.prices.join(','));
    return parts.join('&');
  }

  function href(s) {
    var q = toQuery(s);
    return '/browse' + (q ? '?' + q : '');
  }

  // Another tab keeps the search and filters and starts in its own default order.
  function withTab(s, tab) {
    var n = clone(s);
    n.tab = tab;
    n.sort = '';
    return n;
  }

  function withSort(s, sort) {
    var n = clone(s);
    n.sort = sort;
    return n;
  }

  function withSearch(s, search) {
    var n = clone(s);
    n.search = String(search == null ? '' : search).trim();
    return n;
  }

  // The filter bar's "Clear all": filters off; tab, order and search stay.
  function clearFilters(s) {
    var n = clone(s);
    n.tiers = []; n.consoles = []; n.genres = []; n.prices = [];
    return n;
  }

  // The empty grid's "Clear filters": search and filters off; the tab stays.
  function resetState(s) {
    var n = clearFilters(s);
    n.search = '';
    return n;
  }

  function selectedCount(s) { return s.tiers.length + s.consoles.length + s.genres.length + s.prices.length; }

  function flip(arr, v) {
    var i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
  }

  function toggle(s, group, value) {
    var n = clone(s);
    value = String(value);
    if (group === 'tier') flip(n.tiers, value);
    else if (group === 'console') flip(n.consoles, value);
    else if (group === 'genre') flip(n.genres, value);
    else if (group === 'price') flip(n.prices, value);
    return n;
  }

  // A section's "Clear" in the filter panel.
  function clearGroup(s, group) {
    var n = clone(s);
    if (group === 'tier') n.tiers = [];
    else if (group === 'console') n.consoles = [];
    else if (group === 'genre') n.genres = [];
    else if (group === 'price') n.prices = [];
    return n;
  }

  function isOn(s, group, value) {
    value = String(value);
    if (group === 'tier') return s.tiers.indexOf(value) >= 0;
    if (group === 'console') return s.consoles.indexOf(value) >= 0;
    if (group === 'genre') return s.genres.indexOf(value) >= 0;
    if (group === 'price') return s.prices.indexOf(value) >= 0;
    return false;
  }

  // Two whole numbers 0 < low < high, or null.
  function parseBands(lowRaw, highRaw) {
    var low = Number(String(lowRaw == null ? '' : lowRaw).trim());
    var high = Number(String(highRaw == null ? '' : highRaw).trim());
    if (!Number.isInteger(low) || !Number.isInteger(high) || low <= 0 || high <= low) return null;
    return { low: low, high: high };
  }

  function normalizeBands(b) {
    return (b && parseBands(b.low, b.high)) || { low: DEFAULT_BANDS.low, high: DEFAULT_BANDS.high };
  }

  function bandOf(price, bands) {
    if (price == null || !(price > 0)) return null;
    if (price < bands.low) return 'low';
    if (price < bands.high) return 'mid';
    return 'high';
  }

  function bandLabel(band, bands) {
    if (band === 'low') return 'Under ₱' + bands.low;
    if (band === 'mid') return '₱' + bands.low + '–' + (bands.high - 1);
    return '₱' + bands.high + '+';
  }

  // The filter bar's removable chips: one per applied filter.
  function appliedChips(s, ctx) {
    var out = [];
    var add = function (group, value, label) { out.push({ group: group, value: String(value), label: label, href: href(toggle(s, group, value)) }); };
    s.tiers.forEach(function (id) {
      var t = (ctx.tiers || []).filter(function (x) { return String(x.id) === id; })[0];
      add('tier', id, t ? t.name : id);
    });
    CONSOLES.forEach(function (d) { if (s.consoles.indexOf(d[0]) >= 0) add('console', d[0], d[1]); });
    s.genres.forEach(function (g) { add('genre', g, g); });
    PRICES.forEach(function (p) { if (s.prices.indexOf(p) >= 0) add('price', p, bandLabel(p, ctx.bands)); });
    return out;
  }

  function searchHit(text, s) {
    var q = s.search.toLowerCase();
    return !q || String(text).toLowerCase().indexOf(q) >= 0;
  }

  function filterHit(f, s, bands) {
    if (s.tiers.length && s.tiers.indexOf(f.tier) < 0) return false;
    if (s.consoles.length && !s.consoles.some(function (c) { return f[c]; })) return false;
    if (s.genres.length && !s.genres.some(function (g) { return f.genres.indexOf(g) >= 0; })) return false;
    if (s.prices.length && s.prices.indexOf(bandOf(f.from, bands)) < 0) return false;
    return true;
  }

  // What the tab shows for the search and (site games only) the filters.
  function matches(data, s, ctx, newIds) {
    var k = kindOf(s.tab);
    return members(data, s.tab, s, newIds).filter(function (x) {
      if (k === 'psplus') return searchHit(x.n, s);
      if (k === 'soon') return searchHit(x.text, s);
      return searchHit(x.text, s) && filterHit(x, s, ctx.bands);
    });
  }

  // a before b (−1) / after (1) by one value, missing values last.
  function cmp(x, y, dir) {
    var nx = x == null, ny = y == null;
    if (nx || ny) return nx === ny ? 0 : (nx ? 1 : -1);
    return x < y ? -dir : x > y ? dir : 0;
  }
  var ORDER = {
    'most-rented': function (a, b) { return cmp(a.rank, b.rank, 1); },
    newest: function (a, b) { return cmp(a.released, b.released, -1); },
    'price-asc': function (a, b) { return cmp(a.from, b.from, 1); },
    'price-desc': function (a, b) { return cmp(a.from, b.from, -1); },
    discount: function (a, b) { return (b.deal || 0) - (a.deal || 0); },
    release: function (a, b) { return a.order - b.order; },
    az: function () { return 0; }
  };
  // Ties (and A–Z) by title; PS Plus games by name.
  function ordered(items, sort) {
    return items.slice().sort(function (a, b) {
      return ORDER[sort](a, b) || String(a.title || a.n).localeCompare(String(b.title || b.n));
    });
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // A filter chip in the panel: how many games the tab would show with it
  // flipped; a chip that would leave nothing is greyed out.
  function chipFor(data, s, ctx, newIds, group, value, label) {
    var on = isOn(s, group, value);
    var count = matches(data, on ? s : toggle(s, group, value), ctx, newIds).length;
    var zero = !on && count === 0;
    return { group: group, value: String(value), label: label, count: count, on: on, zero: zero, href: zero ? null : href(toggle(s, group, value)) };
  }

  // A chip exists only if some game in the whole library has it.
  function exists(data, ctx, newIds, group, value) {
    return matches(data, toggle(emptyState(), group, value), ctx, newIds).length > 0;
  }

  function chipGroups(data, s, ctx, newIds) {
    var groups = [];
    function group(key, label, defs) {
      var chips = defs.filter(function (d) { return exists(data, ctx, newIds, key, d[0]); })
        .map(function (d) { return chipFor(data, s, ctx, newIds, key, d[0], d[1]); });
      if (chips.length) groups.push({ key: key, label: label, chips: chips });
    }
    group('tier', 'Tier', (ctx.tiers || []).map(function (t) { return [String(t.id), t.name]; }));
    group('console', 'Console', CONSOLES);
    group('genre', 'Genre', (ctx.genres || []).map(function (g) { return [g, g]; }));
    group('price', 'Price', PRICES.map(function (p) { return [p, bandLabel(p, ctx.bands)]; }));
    return groups;
  }

  // The admin-written description of each filtered tier that has one.
  function tierNotes(s, ctx) {
    return (ctx.tiers || []).filter(function (t) { return t.desc && s.tiers.indexOf(String(t.id)) >= 0; })
      .map(function (t) { return { name: t.name, desc: t.desc }; });
  }

  // Everything a render needs for one state.
  function view(data, s, ctx) {
    var newIds = newestIds(data.games);
    var kind = kindOf(s.tab);
    var sort = sortOf(s);
    var hits = ordered(matches(data, s, ctx, newIds), sort);
    var games = kind === 'games';
    return {
      tab: s.tab,
      label: tabLabel(s.tab),
      kind: kind,
      sort: sort,
      sorts: sortsFor(s.tab).map(function (k) { return { key: k, label: SORTS[k], on: k === sort }; }),
      tabs: TABS.filter(function (t) { return tabVisible(data, t[0]); }).map(function (t) {
        var other = withTab(s, t[0]);
        return { key: t[0], label: t[1], count: matches(data, other, ctx, newIds).length, on: t[0] === s.tab, href: href(other) };
      }),
      ids: kind === 'psplus' ? [] : hits.map(function (x) { return x.id; }),
      psplus: kind === 'psplus' ? hits : [],
      count: hits.length,
      ranked: s.tab === 'most-rented' && sort === 'most-rented',
      filters: games,
      // The panel's rows stay those of All games where filters do not apply.
      groups: chipGroups(data, games ? s : withTab(s, 'all'), ctx, newIds),
      notes: games ? tierNotes(s, ctx) : [],
      selected: selectedCount(s)
    };
  }

  // The results bar: "Most rented · 12 games".
  function countText(v) { return v.label + ' · ' + plural(v.count, 'game'); }

  // The filter panel's big button for a draft's view.
  function applyLabel(v) {
    return v.count ? { text: 'Show ' + plural(v.count, 'game'), disabled: false } : { text: 'No games match', disabled: true };
  }

  var api = {
    TABS: TABS, PSPLUS_LIMIT: PSPLUS_LIMIT, RANKED_MAX: RANKED_MAX, NEW_MAX: NEW_MAX, DEFAULT_BANDS: DEFAULT_BANDS,
    genreParts: genreParts, genreList: genreList, emptyState: emptyState, parseState: parseState, cleanState: cleanState,
    tabVisible: tabVisible, sortOf: sortOf, toQuery: toQuery, href: href, withTab: withTab, withSort: withSort,
    withSearch: withSearch, clearFilters: clearFilters, resetState: resetState, selectedCount: selectedCount,
    toggle: toggle, isOn: isOn, clearGroup: clearGroup, appliedChips: appliedChips, countText: countText,
    applyLabel: applyLabel, parseBands: parseBands, normalizeBands: normalizeBands, bandOf: bandOf, bandLabel: bandLabel,
    view: view
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BrowseFilterCore = api;
})(typeof window !== 'undefined' ? window : this);
````

Run: `node scripts/test-browse-filter-core.js` → `20 assertions passed`.

- [ ] **Step 4: The route and the game facts**

Create `.superpowers/tmp-edits/edit-browse-server.js`:

````js
// Task 3: GET /browse builds the catalog — each game's tab facts (rank,
// release date, deal), the Coming soon list, the PS Plus Deluxe card — and
// renders the active tab. Keeps server.js's BOM and CRLF.
const rep = require('./rep');
const F = 'server.js';

// The game facts: rank, release date and deal for the tabs and Sort menu.
rep.between(F,
`// Applies the Browse page's filter state to a games array. Shared by the route's`,
`function browseGameFacts(g, accountSummaryMap, promo) {`,
`// ── Browse ───────────────────────────────────────────────────────────────────
// The catalog rules (tabs, sort, search, filters) live in
// public/js/browse-filter-core.js, shared with the page script
// (public/js/browse.js); this builds the facts they read.
// See docs/superpowers/specs/2026-10-11-browse-catalog-tabs-design.md.
// rank: the game's place in the Most rented order (null when never rented);
// todayIso: today's date, for "released" (the homepage New releases rule).
function browseGameFacts(g, accountSummaryMap, promo, rank, todayIso) {`);

rep(F,
`    avail: !!(a.trAvail || a.ntAvail || (a.showPs4 && a.ps4Avail)),
    availPs4: !!(a.showPs4 && a.ps4Avail),
    isNew: isAddedThisMonth(g),
    buy: (g.buy_nt_price || 0) > 0 || (g.buy_tr_price || 0) > 0,
    bundle: !!g.is_bundle,
    home: bundle ? 'bundles' : (cat ? 'cat-' + cat.id : 'other')
  };
}`,
`    avail: !!(a.trAvail || a.ntAvail || (a.showPs4 && a.ps4Avail)),
    availPs4: !!(a.showPs4 && a.ps4Avail),
    buy: (g.buy_nt_price || 0) > 0 || (g.buy_tr_price || 0) > 0,
    bundle: !!g.is_bundle,
    rank: rank || null,
    released: g.release_date && g.release_date !== 'TBA' && g.release_date <= todayIso ? g.release_date : null,
    deal: (gameDiscount.specialDeal(g, promo) || {}).pct || 0
  };
}`);

// The PS Plus tab: the catalog A–Z (no "just added" mark any more) and the
// PS Plus Deluxe game's page for the tab's Rent card.
rep.between(F,
`// Browse's "Also in PS Plus Deluxe" section: the games the /ps-plus page lists,`,
`    items = catalog.items.map(it => ({`,
`// Browse's PS Plus Deluxe tab: the games the /ps-plus page lists, whether the
// PS Plus Deluxe account has a slot free, and its rent page. A catalogue that
// has not loaded simply gives no PS Plus games.
function browsePsplusData(accountSummaryMap) {
  let items = [];
  try {
    const catalog = psplusCatalogView.buildPublicCatalog({
      games: psplusCatalogStore.all(), siteGames: getGames(), entries: getPsplus(), slugFor: gameSlug, monthlyCovers: psplusMonthlyCoversStore.all()
    });
    items = catalog.items.map(it => ({`);
rep(F,
`      ps4: (it.p || []).includes('PS4'), ps5: (it.p || []).includes('PS5'), g: it.g || '', j: !!it.f && it.f >= since
    }));`,
`      ps4: (it.p || []).includes('PS4'), ps5: (it.p || []).includes('PS5'), g: it.g || ''
    }));`);
rep(F,
`  return { items, from: psplusFromWeekly(), avail, availPs4 };
}`,
`  return { items, from: psplusFromWeekly(), avail, availPs4, rent: psGame ? '/game/' + gameSlug(psGame.title) : '/ps-plus' };
}`);

// The route: one catalog — tabs, search, sort, filters, one grid.
rep.between(F,
`app.get('/browse', (req, res) => {`,
`    settings: browseSettings, promo, accountSummaryMap
  });
});`,
`app.get('/browse', (req, res) => {
  const browseSettings = getSiteSettings();
  const promo = browseSettings.promo;
  const accountSummaryMap = buildAccountSummaryMap();
  const allGames = getGames().map(resolveGamePrices).map(resolveSlotDays)
    .sort((a, b) => a.title.localeCompare(b.title));
  const priceCategories = getPriceCategories();
  const ranks = new Map(homeView.rentalRanking(allGames, getCustomers(), new Date()).map((g, i) => [Number(g.id), i + 1]));
  const todayIso = new Date().toISOString().slice(0, 10);
  const facts = allGames.map(g => browseGameFacts(g, accountSummaryMap, promo, ranks.get(Number(g.id)), todayIso));
  const upcoming = sortUpcoming(getUpcoming()).map(resolveUpcomingSlots);
  const soon = upcoming.map((u, i) => ({ id: u.id, title: u.title, text: u.title.toLowerCase(), order: i }));
  const ps = browsePsplusData(accountSummaryMap);
  const ctx = {
    bands: getBrowseBands(),
    tiers: priceCategories.map(c => ({ id: String(c.id), name: c.name, desc: c.description || '' })),
    genres: browseCore.genreList(facts)
  };
  const data = { games: facts, soon, psplus: ps.items };
  const state = browseCore.cleanState(browseCore.parseState(req.query), ctx, data);
  const view = browseCore.view(data, state, ctx);

  // The filter panel's tier rows: coloured dot, description and starting price.
  const tierRows = {};
  priceCategories.forEach(c => {
    const from = facts.filter(f => f.tier === String(c.id) && f.from > 0).map(f => f.from);
    tierRows[String(c.id)] = { color: tierStyle.pillColor(c), sub: [c.description || '', from.length ? 'from ₱' + Math.min(...from) : ''].filter(Boolean).join(' · ') };
  });
  const gamesById = {};
  allGames.forEach(g => { gamesById[g.id] = g; });
  const upcomingById = {};
  upcoming.forEach(u => { upcomingById[u.id] = u; });

  res.render('browse', {
    view, state, facts, soon, gamesById, upcomingById, tierRows,
    applied: browseCore.appliedChips(state, ctx), countText: browseCore.countText(view),
    applyLabel: browseCore.applyLabel(view),
    clearHref: browseCore.href(browseCore.clearFilters(state)), resetHref: browseCore.href(browseCore.resetState(state)),
    psplusCard: { from: ps.from, href: ps.rent },
    browseData: { games: facts, soon, psplus: ps.items, ctx, state, psplusFrom: ps.from },
    announcement: getAnnouncement(), announcements: getAnnouncements(),
    settings: browseSettings, promo, accountSummaryMap
  });
});`);

console.log('edited server.js');
````

Run: `node .superpowers/tmp-edits/edit-browse-server.js` → `edited server.js`.
Then: `file server.js` → still `UTF-8 (with BOM) text … with CRLF line terminators`.

- [ ] **Step 5: The page template**

Create `.superpowers/tmp-edits/browse.ejs` (the new `views/browse.ejs`; the edit script copies it in and keeps the BOM and CRLF):

````ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Browse Games — <%= settings.title %></title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
  <link rel="stylesheet" href="/css/browse-filters.css?v=<%= assetV %>">
  <meta name="facebook-domain-verification" content="noj6ccmsehjq0v2oeq2e716fgyaqq0" />
</head>
<body class="browse-page">

<%- include('partials/announcement') %>
<%- include('partials/nav', { active: 'browse' }) %>

<%#
  One catalog (docs/superpowers/specs/2026-10-11-browse-catalog-tabs-design.md):
  a search box, a row of tabs (ready-made collections), a results bar with the
  filter chips, Sort and Filters, then one grid. The server renders the page for
  the URL (GET /browse); public/js/browse.js then runs every tab, search, sort
  and filter change with the same rules (public/js/browse-filter-core.js),
  showing, hiding and ordering these same cards — no reload.
%>
<div class="browse-header">
  <h1>Browse games</h1>
</div>

<!-- SEARCH, TABS AND RESULTS BAR — pinned under the menu (on phones the search box scrolls away) -->
<div class="bf-top" id="bfTop">
  <div class="bf-top-in">
    <form class="bf-search" id="bfSearchForm" method="get" action="/browse" role="search">
      <% if (view.tab !== 'all') { %><input type="hidden" name="tab" value="<%= view.tab %>"><% } %>
      <input type="search" id="bfSearch" name="search" value="<%= state.search %>" placeholder="Search <%= facts.length %> games…" aria-label="Search games" autocomplete="off" enterkeyhint="search">
    </form>
    <nav class="bf-tabs" id="bfTabs" aria-label="Collections">
      <% view.tabs.forEach(t => { %><a class="bf-tab<%= t.on ? ' on' : '' %>" data-tab="<%= t.key %>" href="<%= t.href %>"<%- t.on ? ' aria-current="page"' : '' %>><%= t.label %> <span class="bf-tab-n"><%= t.count %></span></a><% }) %>
    </nav>
    <div class="bf-bar" id="bfBar">
      <span class="bf-count" id="bfCount"><%= countText %></span>
      <label class="bf-sort" id="bfSortWrap"<%= view.sorts.length > 1 ? '' : ' hidden' %>>
        <span class="bf-sort-l">Sort</span>
        <select id="bfSort" aria-label="Sort games">
          <% view.sorts.forEach(o => { %><option value="<%= o.key %>"<%= o.on ? ' selected' : '' %>><%= o.label %></option><% }) %>
        </select>
      </label>
      <a href="#bfPanel" class="bf-open<%= view.selected ? ' bf-has' : '' %>" id="bfOpen" aria-haspopup="dialog" aria-controls="bfPanel"<%= view.filters ? '' : ' hidden' %>>Filters<span id="bfOpenN"><%= view.selected ? ' · ' + view.selected : '' %></span></a>
      <div class="bf-chips" id="bfChips"<%= view.filters && applied.length ? '' : ' hidden' %>>
        <% applied.forEach(c => { %><a class="bf-chip-x" data-group="<%= c.group %>" data-value="<%= c.value %>" href="<%= c.href %>" aria-label="Remove <%= c.label %>"><%= c.label %> ✕</a><% }) %>
        <% if (applied.length >= 2) { %><a class="bf-clear" href="<%= clearHref %>" data-clear-all="1">Clear all</a><% } %>
      </div>
    </div>
  </div>
</div>

<!-- FILTER PANEL — full screen on phones, a centred pop-up on computers. A plain
     GET form, so it also works (with reloads) without the page script. -->
<div class="bf-panel" id="bfPanel" role="dialog" aria-modal="true" aria-labelledby="bfPanelTitle">
  <a href="#" class="bf-backdrop" id="bfBackdrop" tabindex="-1" aria-hidden="true"></a>
  <form class="bf-sheet" id="bfForm" method="get" action="/browse">
    <div class="bf-head">
      <a href="#" class="bf-x" id="bfClose" aria-label="Close filters">✕</a>
      <h2 id="bfPanelTitle">Filters</h2>
      <button type="button" class="bf-clear-all" id="bfClearAll">Clear all</button>
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
        <% gr.chips.slice(0, 6).forEach(c => { %><%- include('partials/browse-filter-option', { c, ff: { name: c.group, value: c.value }, tr: gr.key === 'tier' ? tierRows[c.value] : null }) %><% }) %>
        <% if (extra.length) { %>
        <details class="bf-more"<%= extra.some(c => c.on) ? ' open' : '' %>>
          <summary>Show all <%= gr.chips.length %></summary>
          <% extra.forEach(c => { %><%- include('partials/browse-filter-option', { c, ff: { name: c.group, value: c.value }, tr: gr.key === 'tier' ? tierRows[c.value] : null }) %><% }) %>
        </details>
        <% } %>
      </section>
      <% }) %>
    </div>
    <div class="bf-foot">
      <button type="submit" class="bf-go" id="bfGo"<%= applyLabel.disabled ? ' disabled' : '' %>><%= applyLabel.text %></button>
    </div>
  </form>
</div>

<%
  // Every card is on the page once; the active tab's matches come first, in
  // order, and the rest wait hidden for another tab.
  const leadGames = view.kind === 'games' ? view.ids : [];
  const gridFacts = leadGames.map(id => facts.find(f => f.id === id)).concat(facts.filter(f => !leadGames.includes(f.id)));
  const leadSoon = view.kind === 'soon' ? view.ids : [];
  const soonList = leadSoon.map(id => soon.find(u => u.id === id)).concat(soon.filter(u => !leadSoon.includes(u.id)));
%>
<div class="section bf-results" id="section-rentals">
  <div class="bf-notes" id="bfNotes"><% view.notes.forEach(n => { %><p class="cat-desc"><b><%= n.name %></b> — <%= n.desc %></p><% }) %></div>

  <div class="bf-empty" id="bfEmpty"<%= view.count ? ' hidden' : '' %>>
    <p>No games match.</p>
    <a class="btn btn-outline" id="bfReset" href="<%= resetHref %>">Clear filters</a>
  </div>

  <div class="games-grid rentals-grid" id="bfGrid"<%= view.kind === 'games' ? '' : ' hidden' %>>
    <% gridFacts.forEach(f => { %><div class="bf-item" data-id="<%= f.id %>"<%= leadGames.includes(f.id) ? '' : ' hidden' %>><% if (f.rank && f.rank <= 10) { %><span class="bf-rank bf-rk-<%= f.rank %>"<%= view.ranked ? '' : ' hidden' %>>#<%= f.rank %></span><% } %><%- include('partials/game-card', { game: gamesById[f.id] }) %></div><% }) %>
  </div>

  <div class="games-grid rentals-grid" id="bfSoonGrid"<%= view.kind === 'soon' ? '' : ' hidden' %>>
    <% soonList.forEach(u => { %><div class="bf-item" data-soon="<%= u.id %>"<%= leadSoon.includes(u.id) ? '' : ' hidden' %>><%- include('partials/upcoming-card', { game: upcomingById[u.id] }) %></div><% }) %>
  </div>

  <div id="bfPsplus"<%= view.kind === 'psplus' ? '' : ' hidden' %>>
    <a class="bf-ps-lead" href="<%= psplusCard.href %>">
      <span class="tier-pill tier-gold">PS Plus Deluxe</span>
      <span class="bf-ps-lead-t">Hundreds of games, one account</span>
      <% if (psplusCard.from) { %><span class="bf-ps-lead-p">from <b>₱<%= psplusCard.from %></b>/week</span><% } %>
      <span class="btn btn-primary bf-ps-lead-go">Rent</span>
    </a>
    <div class="games-grid rentals-grid" id="bfPsGrid"></div>
    <button type="button" class="btn btn-outline bf-ps-all" id="bfPsAll" hidden></button>
  </div>
</div>

<!-- RESERVE MODAL -->
<div class="modal-overlay" id="reserveModal">
  <div class="modal">
    <div style="font-size:1.5rem;margin-bottom:0.5rem;">🔔</div>
    <h2>Reserve a Slot</h2>
    <div id="reserveGameTitle" style="font-weight:700;font-size:1rem;color:#a855f7;margin:0.5rem 0 1rem;"></div>
    <div style="background:#111;border:1px solid #222;border-radius:10px;padding:1rem;margin-bottom:1.25rem;text-align:left;">
      <div style="font-size:0.82rem;color:#bbb;line-height:1.7;margin-bottom:0.75rem;">
        This game is not yet available but you can <strong style="color:#fff;">reserve your slot now</strong>. Message us on Facebook to lock in your reservation!
      </div>
      <div style="font-size:0.78rem;color:var(--ps-blue);font-weight:700;margin-bottom:0.25rem;">📘 Message us on Facebook:</div>
      <div style="font-size:0.8rem;color:#888;">Include the game name and your preferred rental duration.</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeReserveModal()" style="flex:1;">Cancel</button>
      <a href="http://m.me/PlaystationHub00" target="_blank" rel="noopener"
        class="btn" style="flex:1;text-align:center;background:linear-gradient(135deg,#4a0080,#7b2ff7);color:#fff;font-weight:700;border-radius:50px;padding:0.75rem 1.75rem;text-decoration:none;"
        onclick="closeReserveModal()">📘 Message Us</a>
    </div>
  </div>
</div>

<%- include('partials/footer') %>

<%- include('partials/rent-modal') %>

<script type="application/json" id="browseData"><%- JSON.stringify(browseData).replace(/</g, '\\u003c') %></script>
<script src="/js/browse-filter-core.js?v=<%= assetV %>"></script>
<script src="/js/browse.js?v=<%= assetV %>"></script>
<script>
function openReserveModal(title) {
  document.getElementById('reserveGameTitle').textContent = title;
  document.getElementById('reserveModal').classList.add('active');
}
function closeReserveModal() { document.getElementById('reserveModal').classList.remove('active'); }
document.getElementById('reserveModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeReserveModal(); });

function openRentModal(title, nt7, nt30, tr7, tr30, hasTrophy, hasNt) {
  document.getElementById('modalGameTitle').textContent = title;
  document.getElementById('modalNtP10').textContent = '₱' + nt7;
  document.getElementById('modalNtP30').textContent = '₱' + nt30;
  document.getElementById('modalTrP10').textContent = '₱' + tr7;
  document.getElementById('modalTrP30').textContent = '₱' + tr30;
  document.getElementById('modalNtSection').style.display = hasNt ? 'block' : 'none';
  document.getElementById('modalTrophySection').style.display = hasTrophy ? 'block' : 'none';
  document.getElementById('rentModal').classList.add('active');
}
function closeRentModal() { document.getElementById('rentModal').classList.remove('active'); }
document.getElementById('rentModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeRentModal(); });
</script>
</body>
</html>
````

Create `.superpowers/tmp-edits/edit-browse-page.js`:

````js
// Task 3: the new Browse page template (keeping its BOM and CRLF), and the
// leftovers of the old page: the PS Plus monthly entries' styles and the
// Coming soon card's note about the slider.
const rep = require('./rep');

rep.put('views/browse.ejs', '.superpowers/tmp-edits/browse.ejs');

rep.between('public/css/style.css',
`
/* PS PLUS BROWSE ENTRIES */
`,
`  font-weight: 500;
}
`,
``);
rep('public/css/style.css',
`  /* Browse PS Plus monthly — full width 16:9 on mobile */
  .psplus-browse-header { flex-wrap: wrap; }
  .psplus-browse-cover-wide { width: 100%; height: auto; aspect-ratio: 16/9; border-radius: 8px 8px 0 0; margin-bottom: 0.5rem; }
`,
``);

rep('views/partials/upcoming-card.ejs',
`  Used by the Browse page's Coming soon slider (partials/upcoming-section) and
  the homepage's Coming soon row (partials/home/upcoming-row). Locals: game.`,
`  Used by the Browse page's Coming soon tab (views/browse.ejs) and the
  homepage's Coming soon row (partials/home/upcoming-row). Locals: game.`);

console.log('edited browse.ejs, style.css, upcoming-card.ejs');
````

Run: `node .superpowers/tmp-edits/edit-browse-page.js` → `edited browse.ejs, style.css, upcoming-card.ejs`.
Run: `git rm -q views/partials/upcoming-section.ejs` (the old Coming soon slider; nothing includes it any more).
Then: `file views/browse.ejs public/css/style.css` → `browse.ejs` is still `UTF-8 (with BOM) … with CRLF line terminators`, and `style.css` is still `with CRLF line terminators`.

- [ ] **Step 6: The page script and styles**

Create `public/js/browse.js` (replaces the whole file):

````js
// The Browse catalog in the page (views/browse.ejs), using the shared rules in
// public/js/browse-filter-core.js on the facts the server embedded:
//  - tabs, the search box and the Sort menu change the grid at once;
//  - the filter panel keeps a draft: ticking only updates the panel's counts and
//    its "Show N games" button; that button applies the draft, closing it any
//    other way throws the draft away;
//  - the filter bar's chips drop one filter at once;
//  - every change shows, hides and orders the cards already on the page, draws
//    the PS Plus Deluxe games and keeps the URL in step — no reload.
(function () {
  var C = window.BrowseFilterCore;
  var dataEl = document.getElementById('browseData');
  if (!C || !dataEl) return;
  var data = JSON.parse(dataEl.textContent);
  var ctx = data.ctx;
  var state = data.state, draft = null, showAllPs = false;
  var $ = function (id) { return document.getElementById(id); };
  var each = function (root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); };
  var copy = function (s) { return JSON.parse(JSON.stringify(s)); };
  var panel = $('bfPanel'), form = $('bfForm'), search = $('bfSearch');

  var gameCards = {}, soonCards = {};
  each(document, '#bfGrid .bf-item[data-id]', function (el) { gameCards[el.getAttribute('data-id')] = el; });
  each(document, '#bfSoonGrid .bf-item[data-soon]', function (el) { soonCards[el.getAttribute('data-soon')] = el; });

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
  function psCard(p) {
    var cover = p.c
      ? '<img src="' + esc(p.c) + '" alt="' + esc(p.n) + '" class="gc2-cover" loading="lazy" decoding="async">'
      : '<div class="gc2-cover-placeholder"><span>' + esc(p.n) + '</span></div>';
    return '<a href="/ps-plus?game=' + encodeURIComponent(p.k) + '" class="game-card gc2-card bf-ps-card">' + cover +
      '<div class="gc2-scrim"></div><div class="gc2-body"><span class="tier-pill tier-gold">PS Plus</span>' +
      '<div class="gc2-title">' + esc(p.n) + '</div>' +
      '<div class="gc2-price">via PS Plus' + (data.psplusFrom ? ' · from <b>₱' + data.psplusFrom + '</b>' : '') + '</div></div></a>';
  }
  function renderPsplus(v) {
    $('bfPsplus').hidden = v.kind !== 'psplus';
    if (v.kind !== 'psplus') { $('bfPsGrid').innerHTML = ''; return; }
    var shown = showAllPs ? v.psplus : v.psplus.slice(0, C.PSPLUS_LIMIT);
    $('bfPsGrid').innerHTML = shown.map(psCard).join('');
    $('bfPsAll').hidden = shown.length >= v.psplus.length;
    $('bfPsAll').textContent = 'Show all ' + v.psplus.length;
  }
  function renderTabs(v) {
    var byKey = {};
    v.tabs.forEach(function (t) { byKey[t.key] = t; });
    each($('bfTabs'), '.bf-tab', function (el) {
      var t = byKey[el.getAttribute('data-tab')];
      if (!t) return;
      el.classList.toggle('on', t.on);
      if (t.on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
      el.href = t.href;
      el.querySelector('.bf-tab-n').textContent = t.count;
    });
  }
  function renderBar(v) {
    $('bfCount').textContent = C.countText(v);
    $('bfSort').innerHTML = v.sorts.map(function (o) {
      return '<option value="' + o.key + '"' + (o.on ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    $('bfSortWrap').hidden = v.sorts.length < 2;
    var chips = v.filters ? C.appliedChips(state, ctx) : [];
    $('bfChips').innerHTML = chips.map(function (c) {
      return '<a class="bf-chip-x" data-group="' + esc(c.group) + '" data-value="' + esc(c.value) + '" href="' + esc(c.href) +
        '" aria-label="Remove ' + esc(c.label) + '">' + esc(c.label) + ' ✕</a>';
    }).join('') + (chips.length >= 2 ? '<a class="bf-clear" href="' + esc(C.href(C.clearFilters(state))) + '" data-clear-all="1">Clear all</a>' : '');
    $('bfChips').hidden = !chips.length;
    $('bfOpen').hidden = !v.filters;
    $('bfOpenN').textContent = v.selected ? ' · ' + v.selected : '';
    $('bfOpen').classList.toggle('bf-has', v.selected > 0);
  }
  function render() {
    var v = C.view(data, state, ctx);
    renderTabs(v);
    renderBar(v);
    place(gameCards, $('bfGrid'), v.kind === 'games' ? v.ids : []);
    place(soonCards, $('bfSoonGrid'), v.kind === 'soon' ? v.ids : []);
    $('bfGrid').hidden = v.kind !== 'games';
    $('bfSoonGrid').hidden = v.kind !== 'soon';
    each($('bfGrid'), '.bf-rank', function (el) { el.hidden = !v.ranked; });
    $('bfNotes').innerHTML = v.notes.map(function (n) {
      return '<p class="cat-desc"><b>' + esc(n.name) + '</b> — ' + esc(n.desc) + '</p>';
    }).join('');
    $('bfEmpty').hidden = v.count > 0;
    $('bfReset').href = C.href(C.resetState(state));
    renderPsplus(v);
  }
  function go(next) {
    state = next;
    showAllPs = false;
    history.replaceState(null, '', C.href(state));
    render();
  }
  // After a tab change deep down the page, start the new grid from its top.
  function toTop() {
    var y = $('bfTop').getBoundingClientRect().top + window.pageYOffset;
    var start = document.querySelector('.browse-header').getBoundingClientRect().bottom + window.pageYOffset;
    if (y > start + 1) window.scrollTo(0, start);
  }

  // ── Tabs, search and sort ─────────────────────────────────────────────────
  $('bfTabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.bf-tab');
    if (!tab) return;
    e.preventDefault();
    go(C.withTab(state, tab.getAttribute('data-tab')));
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    toTop();
  });
  search.addEventListener('input', function () { go(C.withSearch(state, search.value)); });
  $('bfSearchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    search.blur();
  });
  $('bfSort').addEventListener('change', function () { go(C.withSort(state, $('bfSort').value)); });
  $('bfReset').addEventListener('click', function (e) {
    e.preventDefault();
    search.value = '';
    go(C.resetState(state));
  });

  // ── The filter panel (a draft until "Show N games") ───────────────────────
  function renderPanel() {
    var v = C.view(data, draft, ctx);
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
    $('bfGo').textContent = label.text;
    $('bfGo').disabled = label.disabled;
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
    $('bfClose').focus();
  }
  function closePanel() {
    if (location.hash === '#bfPanel') { location.hash = ''; history.replaceState(null, '', location.pathname + location.search); }
    panel.classList.remove('bf-show');
    document.body.classList.remove('bf-lock');
    document.removeEventListener('keydown', onKey);
    draft = null;
    $('bfOpen').focus();
  }

  $('bfOpen').addEventListener('click', function (e) { e.preventDefault(); openPanel(); });
  [$('bfClose'), $('bfBackdrop')].forEach(function (el) {
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
  $('bfClearAll').addEventListener('click', function () {
    if (!draft) return;
    draft = C.clearFilters(draft);
    renderPanel();
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!draft || $('bfGo').disabled) return;
    var next = draft;
    closePanel();
    go(next);
  });

  // ── The filter bar's chips ────────────────────────────────────────────────
  $('bfChips').addEventListener('click', function (e) {
    var chip = e.target.closest('.bf-chip-x');
    if (chip) { e.preventDefault(); go(C.toggle(state, chip.getAttribute('data-group'), chip.getAttribute('data-value'))); return; }
    if (e.target.closest('[data-clear-all]')) { e.preventDefault(); go(C.clearFilters(state)); }
  });
  $('bfPsAll').addEventListener('click', function () { showAllPs = true; render(); });

  // Old links to the Coming soon slider (/browse#comingSoon) open its tab.
  if (location.hash === '#comingSoon') {
    if (C.tabVisible(data, 'coming-soon')) state = C.withTab(state, 'coming-soon');
    history.replaceState(null, '', C.href(state));
  }
  // A shared link to #bfPanel (or the no-script fallback) opens it properly.
  if (location.hash === '#bfPanel') {
    // location.hash = '' (unlike replaceState alone) un-matches CSS :target, so the panel can close.
    location.hash = '';
    history.replaceState(null, '', location.pathname + location.search);
    openPanel();
  }
  render();
})();
````

Create `public/css/browse-filters.css` (replaces the whole file):

````css
/* Browse: the pinned search box, tabs and results bar, the floating filter
   panel and the one grid (views/browse.ejs, public/js/browse.js). */

/* ── Search, tabs and results bar: pinned just under the 64px menu (nav is
   z-index 100). On phones the block sticks 64px higher, so the search box
   slides under the menu and the tabs and results bar stay. ── */
.browse-header h1 { margin-bottom: 1rem; }
.bf-top { position: sticky; top: 64px; z-index: 90; background: rgba(10,10,10,0.96); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-bottom: 1px solid #1a1a1a; }
.bf-top-in { max-width: 1400px; margin: 0 auto; padding: 10px 2rem 0.55rem; }
.bf-search { display: flex; height: 44px; margin: 0 0 10px; }
.bf-search input { flex: 1; min-width: 0; max-width: 560px; height: 44px; background: #141414 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23888' stroke-width='2' viewBox='0 0 24 24'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") no-repeat 1rem center; border: 1px solid #2a2a2a; border-radius: 999px; color: #fff; font-size: 0.95rem; padding: 0 1rem 0 2.6rem; }
.bf-search input:focus { outline: none; border-color: var(--ps-blue); }
.bf-tabs { display: flex; gap: 0.45rem; overflow-x: auto; scrollbar-width: none; }
.bf-tabs::-webkit-scrollbar { display: none; }
.bf-tab { flex-shrink: 0; white-space: nowrap; display: inline-flex; align-items: center; gap: 0.4rem; background: #141414; border: 1px solid #2a2a2a; border-radius: 999px; color: #ddd; padding: 0.45rem 0.9rem; font-size: 0.84rem; font-weight: 700; text-decoration: none; }
.bf-tab:hover { border-color: #444; color: #fff; }
.bf-tab-n { color: #888; font-size: 0.74rem; font-weight: 600; }
.bf-tab.on { background: var(--ps-blue); border-color: var(--ps-blue); color: #000; }
.bf-tab.on .bf-tab-n { color: rgba(0,0,0,0.65); }
.bf-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.55rem; }
.bf-count { flex: 1; min-width: 0; color: var(--text-secondary); font-size: 0.82rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bf-sort { flex-shrink: 0; display: inline-flex; align-items: center; gap: 0.4rem; color: #888; font-size: 0.78rem; }
.bf-sort select { background: #141414; border: 1px solid #2a2a2a; border-radius: 20px; color: #fff; font-size: 0.8rem; font-weight: 700; padding: 0.4rem 0.6rem; cursor: pointer; }
.bf-open { flex-shrink: 0; display: inline-flex; align-items: center; background: #141414; border: 1px solid #2a2a2a; border-radius: 20px; color: #fff; font-size: 0.82rem; font-weight: 700; padding: 0.45rem 0.95rem; text-decoration: none; }
.bf-open:hover { border-color: #444; }
.bf-open.bf-has { border-color: var(--ps-blue); color: var(--ps-blue); }
.bf-chips { flex-basis: 100%; min-width: 0; display: flex; align-items: center; gap: 0.4rem; overflow-x: auto; scrollbar-width: none; }
.bf-chips::-webkit-scrollbar { display: none; }
.bf-chip-x { flex-shrink: 0; white-space: nowrap; background: rgba(240,165,0,0.12); color: var(--ps-blue); border: 1px solid rgba(240,165,0,0.35); border-radius: 20px; padding: 0.3rem 0.7rem; font-size: 0.76rem; font-weight: 700; text-decoration: none; }
.bf-chip-x:hover { background: rgba(240,165,0,0.2); }
.bf-clear { flex-shrink: 0; white-space: nowrap; color: #888; font-size: 0.76rem; text-decoration: underline; }
.bf-top [hidden] { display: none; }
@media (max-width: 767px) {
  .bf-top { top: 0; }
  .bf-top-in { padding: 10px 1rem 0.5rem; }
  .bf-search input { max-width: none; }
  .bf-sort-l { display: none; }
  /* "Available now · 23 games" beside Sort and Filters: two short lines, never cut. */
  .bf-count { white-space: normal; line-height: 1.25; font-size: 0.78rem; }
}

/* ── Filter panel: hidden until opened (by the page script, or #bfPanel without it) ── */
.bf-panel { display: none; position: fixed; inset: 0; z-index: 2000; align-items: center; justify-content: center; }
.bf-panel.bf-show, .bf-panel:target { display: flex; }
.bf-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.65); }
.bf-sheet { position: relative; display: flex; flex-direction: column; width: min(560px, calc(100% - 2rem)); max-height: 85vh; background: #111; border: 1px solid #222; border-radius: 18px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.6); }
@media (max-width: 767px) {
  .bf-sheet { width: 100%; height: 100%; max-height: none; border: none; border-radius: 0; animation: bf-up 0.2s ease-out; }
}
@keyframes bf-up { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
body.bf-lock { overflow: hidden; }

.bf-head { display: flex; align-items: center; gap: 0.75rem; padding: 1rem 1.25rem; border-bottom: 1px solid #1e1e1e; }
.bf-head h2 { flex: 1; margin: 0; font-size: 1.05rem; font-weight: 800; }
.bf-x { color: #ccc; text-decoration: none; font-size: 1.1rem; line-height: 1; padding: 0.25rem; }
.bf-clear-all { background: #1a1a1a; border: 1px solid #2a2a2a; color: #ccc; border-radius: 20px; padding: 0.35rem 0.85rem; font-size: 0.78rem; font-weight: 600; cursor: pointer; }
.bf-body { flex: 1; overflow-y: auto; padding: 0.25rem 1.25rem 1rem; }

.bf-sec-head { display: flex; justify-content: space-between; align-items: baseline; margin: 1.2rem 0 0.35rem; }
.bf-sec-head h3 { margin: 0; font-size: 1.15rem; font-weight: 900; }
.bf-sec-clear { background: none; border: none; color: #888; text-decoration: underline; font-size: 0.78rem; cursor: pointer; }
.bf-opt { display: flex; align-items: center; gap: 0.65rem; padding: 0.65rem 0; border-bottom: 1px solid #1a1a1a; cursor: pointer; font-size: 0.92rem; color: #e5e5e5; }
.bf-opt-name { flex: 1; min-width: 0; }
.bf-opt-sub { display: block; margin-top: 0.1rem; font-size: 0.74rem; color: #777; }
.bf-opt .bf-n { color: #777; font-size: 0.8rem; }
.bf-opt input { flex-shrink: 0; width: 20px; height: 20px; margin: 0; accent-color: var(--ps-blue); cursor: pointer; }
.bf-opt-zero { opacity: 0.4; cursor: default; }
.bf-opt-zero input { cursor: default; }
.tier-dot { display: inline-block; flex-shrink: 0; width: 10px; height: 10px; border-radius: 50%; }
.bf-more summary { list-style: none; cursor: pointer; color: var(--ps-blue); font-size: 0.82rem; font-weight: 700; padding: 0.65rem 0; }
.bf-more summary::-webkit-details-marker { display: none; }
.bf-more[open] summary { display: none; }

.bf-foot { padding: 0.9rem 1.25rem calc(0.9rem + env(safe-area-inset-bottom)); border-top: 1px solid #1e1e1e; }
.bf-go { width: 100%; background: var(--ps-blue); color: #000; border: none; border-radius: 999px; padding: 0.95rem; font-size: 1rem; font-weight: 800; cursor: pointer; }
.bf-go:disabled { background: #2a2a2a; color: #777; cursor: default; }

/* ── The grid ── */
.bf-results { padding-top: 1.5rem; }
.bf-results [hidden] { display: none; }
.cat-desc { margin: 0 0 1rem; color: var(--text-secondary); font-size: 0.85rem; }
.cat-desc b { color: #ddd; }
.bf-empty { text-align: center; padding: 2rem 1rem; color: var(--text-secondary); }
.bf-empty p { margin: 0 0 1rem; }
.bf-item { position: relative; }
/* #1–#10 on the Most rented tab: gold, silver and bronze for the top three. */
.bf-rank { position: absolute; z-index: 3; top: 0.45rem; left: 0.45rem; min-width: 28px; height: 22px; padding: 0 0.35rem; border-radius: 11px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 900; background: #2a2a2a; color: #eee; box-shadow: 0 2px 6px rgba(0,0,0,0.5); pointer-events: none; }
.bf-rk-1 { background: #F0A500; color: #1a1200; }
.bf-rk-2 { background: #C9CED6; color: #1b1e22; }
.bf-rk-3 { background: #C98B4E; color: #1f1206; }
/* PS Plus Deluxe tab: the account to rent, then its games. */
.bf-ps-lead { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; margin-bottom: 1rem; padding: 1rem 1.25rem; background: linear-gradient(135deg, rgba(240,165,0,0.14), rgba(240,165,0,0.04)); border: 1px solid rgba(240,165,0,0.35); border-radius: 14px; color: #fff; text-decoration: none; }
.bf-ps-lead-t { font-weight: 800; }
.bf-ps-lead-p { color: var(--text-secondary); font-size: 0.85rem; }
.bf-ps-lead-p b { color: var(--ps-blue); }
.bf-ps-lead-go { margin-left: auto; padding: 0.45rem 1.4rem; }
.bf-ps-all { margin-top: 1rem; }
.bf-ps-card .gc2-cover-placeholder span { padding: 0 0.75rem; text-align: center; opacity: 0.8; }

/* At most 6 cards a row; phones keep style.css's 2 columns (≤ 600px). */
@media (min-width: 601px) {
  .browse-page .games-grid { grid-template-columns: repeat(auto-fill, minmax(max(200px, calc((100% - 5rem) / 6)), 1fr)); }
}
````

- [ ] **Step 7: Run the tests and watch them pass**

Run: `node scripts/test-browse-filter-core.js && node scripts/test-browse-page.js && node scripts/test-home-coming-soon-row.js` → `20`, `18`, `8 assertions passed`.
Run the whole suite: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"` → only `FAIL scripts/test-requests-page.js`, `failed: 1`.

- [ ] **Step 8: Commit**

```bash
git add public/js/browse-filter-core.js scripts/test-browse-filter-core.js server.js views/browse.ejs public/js/browse.js public/css/browse-filters.css public/css/style.css views/partials/upcoming-card.ejs scripts/test-browse-page.js scripts/test-home-coming-soon-row.js
git commit -m "Browse: one catalog with tabs, search and sort

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(`views/partials/upcoming-section.ejs` was already staged as deleted by `git rm` in Step 5.)

---

### Task 3: Homepage "View all" links open their tab

**Files:**
- Create: `.superpowers/tmp-edits/edit-viewall-tests.js`, `.superpowers/tmp-edits/edit-viewall.js`
- Modify (edit script): `views/index.ejs`, `views/partials/home/upcoming-row.ejs`, `scripts/test-home-page.js`, `scripts/test-home-top10.js`, `scripts/test-home-coming-soon-row.js`

**Interfaces:**
- Consumes: the `?tab=` keys from Task 2 (`most-rented`, `new`, `coming-soon`); `partials/home/game-row`'s `viewAll` local; `.superpowers/tmp-edits/rep.js` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Create `.superpowers/tmp-edits/edit-viewall-tests.js`:

````js
// Task 4, step 1: the homepage "View all" links open their Browse tab.
const rep = require('./rep');

rep('scripts/test-home-page.js',
`  await okAsync('new releases newest first; deals at their deal price; Coming soon with its marker', async () => {
    assert.deepStrictEqual(cardSlugs(slice(home, 'id="newReleasesSection"', 'id="specialDealsSection"')), ['zzyzx-alpha', 'zzyzx-bravo', 'zzyzx-charlie']);`,
`  await okAsync('new releases newest first; deals at their deal price; Coming soon with its marker', async () => {
    assert.deepStrictEqual(cardSlugs(slice(home, 'id="newReleasesSection"', 'id="specialDealsSection"')), ['zzyzx-alpha', 'zzyzx-bravo', 'zzyzx-charlie']);
    assert.ok(slice(home, 'id="newReleasesSection"', '</h2>').includes('<a class="hm-viewall" href="/browse?tab=new">View all ›</a>'), 'View all opens the New releases tab');`);

rep('scripts/test-home-top10.js',
`// the banner grows to the box's height. On phones the Top rented shelf gets
// the same View all as New releases.`,
`// the banner grows to the box's height. On phones the Top rented shelf's
// View all opens Browse's Most rented tab.`);
rep('scripts/test-home-top10.js',
`  ok('its heading has View all, like New releases', () => {
    const head = slice(home, 'id="topRented"', '</h2>');
    assert.ok(head.includes('<a class="hm-viewall" href="/browse">View all ›</a>'));`,
`  ok('its heading\\'s View all opens the Most rented tab', () => {
    const head = slice(home, 'id="topRented"', '</h2>');
    assert.ok(head.includes('<a class="hm-viewall" href="/browse?tab=most-rented">View all ›</a>'));`);

rep('scripts/test-home-coming-soon-row.js',
`<span class="hm-sub">reserve a slot</span><a class="hm-viewall" href="/browse#comingSoon">View all ›</a></h2>'));`,
`<span class="hm-sub">reserve a slot</span><a class="hm-viewall" href="/browse?tab=coming-soon">View all ›</a></h2>'));`);

console.log('edited test-home-page.js, test-home-top10.js, test-home-coming-soon-row.js');
````

Run: `node .superpowers/tmp-edits/edit-viewall-tests.js` → `edited test-home-page.js, test-home-top10.js, test-home-coming-soon-row.js`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-home-page.js` → FAIL `AssertionError [ERR_ASSERTION]: View all opens the New releases tab`.
Run: `node scripts/test-home-top10.js` and `node scripts/test-home-coming-soon-row.js` → each FAIL `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value` (the old `/browse` and `/browse#comingSoon` links).

- [ ] **Step 3: Change the links**

Create `.superpowers/tmp-edits/edit-viewall.js`:

````js
// Task 4, step 3: the homepage "View all" links open their Browse tab.
const rep = require('./rep');

rep('views/index.ejs',
`games: home.topRented.map(t => t.game), viewAll: '/browse', ranked: true,`,
`games: home.topRented.map(t => t.game), viewAll: '/browse?tab=most-rented', ranked: true,`);
rep('views/index.ejs',
`games: home.newGames, viewAll: '/browse', ranked: false,`,
`games: home.newGames, viewAll: '/browse?tab=new', ranked: false,`);

rep('views/partials/home/upcoming-row.ejs',
`<a class="hm-viewall" href="/browse#comingSoon">View all ›</a>`,
`<a class="hm-viewall" href="/browse?tab=coming-soon">View all ›</a>`);

console.log('edited index.ejs, upcoming-row.ejs');
````

Run: `node .superpowers/tmp-edits/edit-viewall.js` → `edited index.ejs, upcoming-row.ejs`.
Then: `file views/index.ejs` → still `UTF-8 (with BOM) text`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-home-page.js && node scripts/test-home-top10.js && node scripts/test-home-coming-soon-row.js` → `14`, `7`, `8 assertions passed`.
Run the whole suite (the loop in Task 2, Step 7) → only `FAIL scripts/test-requests-page.js`, `failed: 1`.

- [ ] **Step 5: Commit and clean up**

```bash
git add views/index.ejs views/partials/home/upcoming-row.ejs scripts/test-home-page.js scripts/test-home-top10.js scripts/test-home-coming-soon-row.js
git commit -m "Homepage View all links open their Browse tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
