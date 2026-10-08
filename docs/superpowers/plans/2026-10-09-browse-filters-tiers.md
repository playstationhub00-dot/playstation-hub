# Browse Redesign (Filters, Tier Pills, PS Plus in Results) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse filters in a floating panel (full screen on phones, centred pop-up on computers; tick-box rows, live counts, applied on "Show N games") with a sticky filter bar of removable chips, shareable URLs, one 6-per-row results grid while filtering, a coloured tier pill on every game card and the game page, tier descriptions, an "Also in PS Plus Deluxe" section, and the Price-chip cut-offs in Settings.

**Architecture:** One pure UMD module, `public/js/browse-filter-core.js`, holds every filter rule; `server.js` uses it for the first render and `public/js/browse.js` uses it for the panel's draft counts and for applying, moving the server-rendered cards between their tier sections and one grid. The panel is a plain GET form, so it also works without the script. `lib/tier-style.js` decides a tier's pill colour and description; `app.locals.gameTier` exposes it to the card and game page.

**Tech Stack:** Node, Express, EJS, lowdb v1 (`games.json`), plain browser JS (no build). Tests are plain `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-09-browse-filters-tiers-design.md`

## Global Constraints

- Work directly on `main`; commit per task; **push only when the owner says "push"**.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Line endings** (the provided edit scripts keep them; verify with `file`): `server.js` CRLF + UTF-8 BOM; `views/browse.ejs` CRLF + BOM; `views/partials/game-card.ejs`, `views/partials/admin/settings.ejs`, `public/css/style.css` CRLF; `views/game-detail.ejs`, `views/admin.ejs`, `views/partials/admin/games/categories.ejs` and every new file LF.
- **Tests never touch real data:** boot tests use a temp `DATA_DIR`, `MONGODB_URI=''`, an in-memory session store, a made-up admin password and (Browse) a stubbed PS Plus list; nothing reaches the project's `games.json`, a database or the real admin.
- Filters: different groups narrow (AND), options in one group widen (OR); an option that would give 0 stays listed, dimmed, its tick box disabled.
- Groups in order: Show (Available now · Just added · Can buy · Bundles) · Tier (price categories in admin order, then "PS Plus Deluxe") · Console (PS4 · PS5) · Genre (every genre part among the site's games, A–Z) · Price (Under ₱A · ₱A–(B−1) · ₱B+, defaults A=200, B=300).
- No filter: today's sections (Coming soon, Account Bundles, each tier, Other Games, PS Plus monthly). Any filter or search: one grid of matches, tier order then A–Z, max 6 per row (phones 2), then "Also in PS Plus Deluxe" (first 24, "Show all N").
- Filter panel: full screen on phones (< 768px), a centred pop-up (≤ 560px wide, ≤ 85% tall) on computers; header ✕ · "Filters" · "Clear all"; sections with "Clear"; tick-box rows with counts (tier rows: dot + description · from ₱X); more than 6 rows → "Show all N"; ticks are a draft until "Show N games" (live: "Show N PS Plus games", "No games match" disabled); ✕ / Escape / outside tap discards.
- Sticky filter bar under the 64px menu: "Filters · N" button, one removable chip per applied filter (search as `"text" ✕`), "Clear all" at 2+, and "N games" ("N PS Plus games").
- The 11-day "New" corner badge reads "Just added"; "New" now means only the New Games tier.
- Pill colours: blue, purple, coral, grey, teal, pink (+ gold for PS Plus, not selectable); automatic by name: "new" → blue, "deluxe" → purple, "special" → coral, else grey.
- Unchanged: pricing, per-game discounts, the PS Plus page (only its weekly "from" price now comes from a shared helper), homepage layout.
- Known unrelated failure: `scripts/test-requests-page.js`. Report it, do not fix it.
- Scratch edit scripts live in `.superpowers/tmp-edits/` (git-ignored); never commit them; Task 5 removes the folder.

## File Structure

| File | Responsibility |
|---|---|
| `public/js/browse-filter-core.js` (new) | URL ⇄ state, matching site and PS Plus games, chip counts/0-chips, price bands, grid order, `view()` |
| `lib/tier-style.js` (new) | Pill colour (owner's pick or by name), description cleaning, a game's tier |
| `public/js/browse.js` (new) | Filter panel (draft, live counts, apply), filter bar chips, moving cards, PS Plus cards |
| `public/css/browse-filters.css` (new) | Sticky filter bar, floating panel (phone full screen / computer pop-up), 6-per-row cap |
| `views/partials/browse-filter-option.ejs` (new) | One tick-box row of the panel |
| `server.js` | `gameTier` locals; category pill colour/description save; price band setting; new `GET /browse` with `browseGameFacts` / `browsePsplusData` / `psplusFromWeekly` |
| `views/browse.ejs` | Rewritten page: filter bar, filter panel (form), sections, grid, PS Plus section, embedded data |
| `views/partials/game-card.ejs`, `views/game-detail.ejs`, `public/css/style.css` | Tier pill, "Just added", pill colours |
| `views/partials/admin/games/categories.ejs`, `views/partials/admin/settings.ejs`, `views/admin.ejs` | Pill colour + description fields; Browse price filter card; toasts |

---

### Task 1: The filter rules (shared module)

**Files:**
- Create: `public/js/browse-filter-core.js`, `scripts/test-browse-filter-core.js`

**Interfaces:**
- Produces (browser global `BrowseFilterCore`, Node `module.exports`): `PSPLUS_LIMIT` (24), `DEFAULT_BANDS` ({low:200, high:300}), `genreParts(genre) → string[]`, `genreList(facts) → string[]` (A–Z), `emptyState()`, `parseState(query) → state`, `clearGroup(state, group)`, `formField(group, value) → { name, value }`, `appliedChips(state, ctx) → [{ group, value, label, href }]` (search: group `'search'`), `countText(view)`, `applyLabel(view) → { text, disabled }`, `cleanState(state, ctx) → state` (drops tier ids and genres with no chip), `toQuery(state) → string`, `href(state) → '/browse…'`, `selectedCount(state)`, `anyActive(state)`, `toggle(state, group, value) → state` (groups `show|tier|console|genre|price`; show values `avail|new|buy|bundle`; tier value `'psplus'` or a category id string), `isOn`, `parseBands(low, high) → {low, high} | null`, `normalizeBands(b)`, `bandOf(price, bands) → 'low'|'mid'|'high'|null`, `bandLabel(band, bands)`, `siteOn(state)`, `psplusOn(state)`, `matchSite`, `matchPsplus`, `results(facts, psItems, state, ctx) → { site, psplus }`, `chipGroups(...)`, `sortForGrid(facts, tiers)`, `view(facts, psItems, state, ctx) → { active, siteOn, psplusOn, site, grid: [ids], psplus, groups: [{ key, label, chips: [{ group, value, label, count, on, zero, href }] }], selected }`.
- State shape: `{ search, avail, isNew, buy, bundle, tiers: ['2'], psplus, consoles: ['ps4'], genres: ['Action'], prices: ['low'] }`.
- Site fact shape: `{ id, title, text, tier ('2'|null), ps4, ps5, genres, from, avail, availPs4, isNew, buy, bundle, home ('bundles'|'cat-2'|'other') }`. PS Plus item: `{ k, n, c, ps4, ps5, g, j }`. ctx: `{ bands, tiers: [{ id, name }], genres, psplusFrom, psplusAvail, psplusAvailPs4 }`.

- [ ] **Step 1: Write the test**

Create `scripts/test-browse-filter-core.js`:

````js
// Run: node scripts/test-browse-filter-core.js
//
// The Browse filter rules (public/js/browse-filter-core.js): URLs, matching,
// counts, 0-options, price bands, the one-grid order, the PS Plus section, and
// what the filter bar and filter panel show.
const assert = require('assert');
const C = require('../public/js/browse-filter-core');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const bands = { low: 200, high: 300 };
const g = (id, title, o) => Object.assign({
  id, title, text: title.toLowerCase(), tier: null, ps4: false, ps5: true, genres: [], from: 249,
  avail: true, availPs4: false, isNew: false, buy: false, bundle: false, home: 'other'
}, o || {});
const games = [
  g(1, 'Elden Ring', { tier: '2', genres: ['Action', 'RPG'], from: 249, home: 'cat-2' }),
  g(2, 'Tekken 8', { tier: '2', genres: ['Fighting'], ps4: true, availPs4: true, from: 249, isNew: true, home: 'cat-2' }),
  g(3, 'Callisto', { tier: '3', genres: ['Horror'], from: 199, avail: false, buy: true, home: 'cat-3' }),
  g(4, 'GTA V', { tier: '4', genres: ['Action'], ps4: true, from: 149, home: 'cat-4' }),
  g(5, 'Main Account', { tier: null, bundle: true, genres: [], from: 299, text: 'main account\nelden ring', home: 'bundles' }),
  g(6, 'Astro Bot', { tier: '1', genres: ['Platformer'], from: 399, home: 'cat-1' })
];
const psplus = [
  { k: 'a', n: 'Days Gone', c: '', ps4: true, ps5: false, g: 'Action', j: false },
  { k: 'b', n: 'Returnal', c: '', ps4: false, ps5: true, g: 'Shooter', j: true },
  { k: 'c', n: 'Ghost of Tsushima', c: '', ps4: true, ps5: true, g: 'Action', j: false }
];
const ctx = {
  bands,
  tiers: [{ id: '1', name: 'New Games' }, { id: '2', name: 'Deluxe' }, { id: '3', name: 'Special' }, { id: '4', name: 'Regular' }],
  genres: C.genreList(games), psplusFrom: 159, psplusAvail: true, psplusAvailPs4: false
};
const st = q => C.parseState(q);
const ids = r => r.site.map(f => f.id);
const chip = (v, group, value) => v.groups.find(x => x.key === group).chips.find(c => c.value === String(value));

console.log('\nURL');
ok('parses every group and writes it back in a stable order', () => {
  const s = st({ search: ' ring ', avail: '1', new: '1', tier: '2,3,x', psplus: '1', console: 'ps4,ps9', genre: 'Action,RPG', price: 'low,mid,huge' });
  assert.deepStrictEqual(s, { search: 'ring', avail: true, isNew: true, buy: false, bundle: false, tiers: ['2', '3'], psplus: true, consoles: ['ps4'], genres: ['Action', 'RPG'], prices: ['low', 'mid'] });
  assert.strictEqual(C.toQuery(s), 'search=ring&avail=1&new=1&tier=2,3&psplus=1&console=ps4&genre=Action,RPG&price=low,mid');
  assert.deepStrictEqual(st(Object.fromEntries(new URLSearchParams(C.toQuery(s)))), s, 'round trip');
});
ok('old links keep working', () => {
  assert.deepStrictEqual(st({ ps4: '1' }).consoles, ['ps4']);
  assert.deepStrictEqual(st({ platform: 'PS4' }).consoles, ['ps4']);
  const unit = st({ unit: 'ps4' });
  assert.ok(unit.avail && unit.consoles[0] === 'ps4');
  assert.ok(st({ unit: 'ps5' }).avail && !st({ unit: 'ps5' }).consoles.length);
  assert.ok(st({ newOnly: '1' }).isNew);
  assert.deepStrictEqual(st({ genre: 'Horror' }).genres, ['Horror']);
  assert.deepStrictEqual(st({ genre: ['Action', 'Horror'] }).genres, ['Action', 'Horror'], 'repeated params');
});
ok('genres with commas or slashes split into parts; names with spaces survive the URL', () => {
  assert.deepStrictEqual(C.genreParts('Action, RPG / Horror'), ['Action', 'RPG', 'Horror']);
  assert.deepStrictEqual(C.genreParts(''), []);
  const s = C.toggle(C.emptyState(), 'genre', 'Role Playing Games');
  assert.strictEqual(C.href(s), '/browse?genre=Role%20Playing%20Games');
  assert.deepStrictEqual(st(Object.fromEntries(new URLSearchParams(C.toQuery(s)))).genres, ['Role Playing Games']);
});
ok('tiers and genres with no chip are dropped, so an old link cannot hide everything', () => {
  const s = C.cleanState(st({ tier: '2,99', genre: 'Action,Nope' }), ctx);
  assert.deepStrictEqual([s.tiers, s.genres], [['2'], ['Action']]);
});
ok('toggle flips one chip and leaves the rest', () => {
  let s = C.toggle(C.emptyState(), 'tier', '2');
  s = C.toggle(s, 'show', 'avail');
  s = C.toggle(s, 'tier', 'psplus');
  assert.deepStrictEqual([s.tiers, s.avail, s.psplus], [['2'], true, true]);
  s = C.toggle(s, 'tier', '2');
  assert.deepStrictEqual(s.tiers, []);
  assert.strictEqual(C.selectedCount(s), 2);
});

console.log('\nmatching');
ok('groups narrow each other; chips inside a group widen', () => {
  assert.deepStrictEqual(ids(C.results(games, [], st({ tier: '2,3' }), ctx)), [1, 2, 3]);
  assert.deepStrictEqual(ids(C.results(games, [], st({ tier: '2,3', genre: 'Horror,RPG' }), ctx)), [1, 3]);
  assert.deepStrictEqual(ids(C.results(games, [], st({ genre: 'Action' }), ctx)), [1, 4]);
});
ok('console: PS4 and PS5 chips, and "Available now" means a PS4 slot when only PS4 is on', () => {
  assert.deepStrictEqual(ids(C.results(games, [], st({ console: 'ps4' }), ctx)), [2, 4]);
  assert.deepStrictEqual(ids(C.results(games, [], st({ console: 'ps4', avail: '1' }), ctx)), [2], 'GTA V has no PS4 slot free');
  assert.deepStrictEqual(ids(C.results(games, [], st({ console: 'ps4,ps5', avail: '1' }), ctx)), [1, 2, 4, 5, 6]);
});
ok('search matches title, description and bundle contents', () => {
  assert.deepStrictEqual(ids(C.results(games, [], st({ search: 'ELDEN' }), ctx)), [1, 5]);
});
ok('price bands use the card price', () => {
  assert.strictEqual(C.bandOf(199, bands), 'low');
  assert.strictEqual(C.bandOf(200, bands), 'mid');
  assert.strictEqual(C.bandOf(299, bands), 'mid');
  assert.strictEqual(C.bandOf(300, bands), 'high');
  assert.strictEqual(C.bandOf(null, bands), null);
  assert.deepStrictEqual(ids(C.results(games, [], st({ price: 'low' }), ctx)), [3, 4]);
  assert.deepStrictEqual(['low', 'mid', 'high'].map(b => C.bandLabel(b, bands)), ['Under ₱200', '₱200–299', '₱300+']);
});
ok('price band settings: two whole numbers, low below high, else the defaults', () => {
  assert.deepStrictEqual(C.parseBands('150', ' 250 '), { low: 150, high: 250 });
  assert.strictEqual(C.parseBands('300', '300'), null);
  assert.strictEqual(C.parseBands('0', '100'), null);
  assert.strictEqual(C.parseBands('abc', '100'), null);
  assert.strictEqual(C.parseBands('99.5', '200'), null);
  assert.deepStrictEqual(C.normalizeBands(undefined), { low: 200, high: 300 });
  assert.deepStrictEqual(C.normalizeBands({ low: 500, high: 100 }), { low: 200, high: 300 });
});

console.log('\nchips');
ok('a chip counts what the customer would see if tapped; 0 is dimmed with no link', () => {
  const v = C.view(games, psplus, st({ console: 'ps4' }), ctx);
  assert.strictEqual(chip(v, 'tier', 2).count, 1);
  assert.strictEqual(chip(v, 'genre', 'Horror').count, 0);
  assert.ok(chip(v, 'genre', 'Horror').zero && chip(v, 'genre', 'Horror').href === null);
  assert.strictEqual(chip(v, 'genre', 'Action').href, '/browse?console=ps4&genre=Action');
  assert.ok(chip(v, 'console', 'ps4').on && !chip(v, 'console', 'ps4').zero);
  assert.strictEqual(chip(v, 'console', 'ps4').count, 2, 'an on chip shows the current results');
  assert.strictEqual(chip(v, 'console', 'ps4').href, '/browse', 'tapping it again turns it off');
  assert.strictEqual(chip(v, 'console', 'ps5').count, 6, 'PS4 or PS5');
});
ok('chips only exist for things the library has', () => {
  const v = C.view(games.filter(f => !f.bundle), [], C.emptyState(), ctx);
  const show = v.groups.find(x => x.key === 'show').chips.map(c => c.value);
  assert.deepStrictEqual(show, ['avail', 'new', 'buy'], 'no Bundles chip without bundles');
  assert.ok(!v.groups.find(x => x.key === 'tier').chips.some(c => c.value === 'psplus'), 'no PS Plus chip without PS Plus games');
  assert.deepStrictEqual(v.groups.find(x => x.key === 'genre').chips.map(c => c.value), ['Action', 'Fighting', 'Horror', 'Platformer', 'RPG']);
});

console.log('\nfilter bar and panel');
ok('the bar lists each applied filter with a link that removes just that one', () => {
  const s = st({ tier: '2', psplus: '1', console: 'ps4', genre: 'Action', price: 'low', new: '1', search: 'ring' });
  const chips = C.appliedChips(s, ctx);
  assert.deepStrictEqual(chips.map(c => c.label), ['Just added', 'Deluxe', 'PS Plus Deluxe', 'PS4', 'Action', 'Under ₱200', '"ring"']);
  assert.strictEqual(chips[1].href, '/browse?search=ring&new=1&psplus=1&console=ps4&genre=Action&price=low', 'drops Deluxe only');
  assert.strictEqual(chips[6].href, '/browse?new=1&tier=2&psplus=1&console=ps4&genre=Action&price=low', 'drops the search');
  assert.deepStrictEqual(C.appliedChips(C.emptyState(), ctx), []);
});
ok('a section\'s Clear empties that section only', () => {
  const s = st({ avail: '1', buy: '1', tier: '2', psplus: '1', console: 'ps4', genre: 'Action', price: 'low' });
  const t = C.clearGroup(s, 'tier');
  assert.deepStrictEqual([t.tiers, t.psplus, t.consoles, t.avail], [[], false, ['ps4'], true]);
  const sh = C.clearGroup(s, 'show');
  assert.deepStrictEqual([sh.avail, sh.buy, sh.genres], [false, false, ['Action']]);
});
ok('tick boxes are plain form fields the server already reads', () => {
  assert.deepStrictEqual(C.formField('show', 'new'), { name: 'new', value: '1' });
  assert.deepStrictEqual(C.formField('tier', 'psplus'), { name: 'psplus', value: '1' });
  assert.deepStrictEqual(C.formField('tier', 2), { name: 'tier', value: '2' });
  assert.deepStrictEqual(C.formField('genre', 'Role Playing Games'), { name: 'genre', value: 'Role Playing Games' });
  const s = st({ tier: ['2', '3'], console: ['ps4', 'ps5'], new: '1', psplus: '1' });
  assert.deepStrictEqual([s.tiers, s.consoles, s.isNew, s.psplus], [['2', '3'], ['ps4', 'ps5'], true, true], 'tier=2&tier=3 reads like tier=2,3');
});
ok('the big button and the bar count say what will show', () => {
  const v = s => C.view(games, psplus, st(s), ctx);
  assert.deepStrictEqual(C.applyLabel(v({ tier: '2' })), { text: 'Show 2 games', disabled: false });
  assert.deepStrictEqual(C.applyLabel(v({ tier: '3' })), { text: 'Show 1 game', disabled: false });
  assert.deepStrictEqual(C.applyLabel(v({ psplus: '1' })), { text: 'Show 3 PS Plus games', disabled: false });
  assert.deepStrictEqual(C.applyLabel(v({ search: 'returnal' })), { text: 'Show 1 PS Plus game', disabled: false }, 'only PS Plus has it');
  assert.deepStrictEqual(C.applyLabel(v({ genre: 'Horror', console: 'ps4' })), { text: 'No games match', disabled: true });
  assert.deepStrictEqual(C.applyLabel(v({})), { text: 'Show 6 games', disabled: false });
  assert.strictEqual(C.countText(v({ tier: '2' })), '2 games');
  assert.strictEqual(C.countText(v({ psplus: '1' })), '3 PS Plus games');
});

console.log('\nlayout');
ok('no filter: everything, no grid; filter: one grid by tier order, then A–Z', () => {
  const none = C.view(games, psplus, C.emptyState(), ctx);
  assert.ok(!none.active && none.grid.length === 0 && none.site.length === 6 && !none.psplusOn);
  const f = C.view(games, psplus, st({ console: 'ps4,ps5' }), ctx);
  assert.deepStrictEqual(f.grid, [6, 1, 2, 3, 4, 5], 'New Games, Deluxe A–Z, Special, Regular, then no tier');
});

console.log('\nPS Plus Deluxe');
ok('shown while filtering with the same search, genre, console, just-added, price and availability', () => {
  const p = s => C.results(games, psplus, st(s), ctx).psplus.map(x => x.k);
  assert.deepStrictEqual(p({}), [], 'not without a filter');
  assert.deepStrictEqual(p({ genre: 'Action' }), ['a', 'c']);
  assert.deepStrictEqual(p({ search: 'ghost' }), ['c']);
  assert.deepStrictEqual(p({ console: 'ps5' }), ['b', 'c']);
  assert.deepStrictEqual(p({ new: '1' }), ['b']);
  assert.deepStrictEqual(p({ price: 'low' }), ['a', 'b', 'c'], 'PS Plus from ₱159');
  assert.deepStrictEqual(p({ price: 'mid' }), []);
  assert.deepStrictEqual(p({ avail: '1' }), ['a', 'b', 'c']);
  assert.deepStrictEqual(p({ avail: '1', console: 'ps4' }), [], 'no PS4 slot on the PS Plus account');
});
ok('Can buy and Bundles hide it; other tiers hide it unless PS Plus is on too', () => {
  const p = s => C.results(games, psplus, st(s), ctx).psplus.length;
  assert.strictEqual(p({ buy: '1' }), 0);
  assert.strictEqual(p({ bundle: '1' }), 0);
  assert.strictEqual(p({ tier: '2' }), 0);
  assert.strictEqual(p({ tier: '2', psplus: '1' }), 3);
});
ok('"PS Plus Deluxe" alone: no site games, and chips count PS Plus games', () => {
  const v = C.view(games, psplus, st({ psplus: '1' }), ctx);
  assert.ok(!v.siteOn && v.site.length === 0 && v.psplus.length === 3 && v.psplusOn);
  assert.strictEqual(chip(v, 'genre', 'Action').count, 2, 'PS Plus Action games');
  assert.strictEqual(chip(v, 'tier', 'psplus').count, 3);
  assert.strictEqual(chip(v, 'tier', 2).count, 2, 'tapping Deluxe brings back site games');
  const off = C.view(games, psplus, st({ genre: 'Horror' }), ctx);
  assert.strictEqual(chip(off, 'tier', 'psplus').count, 0, 'PS Plus chip counts PS Plus matches');
  assert.ok(chip(off, 'tier', 'psplus').zero);
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-browse-filter-core.js` → FAIL `Cannot find module '../public/js/browse-filter-core'`.

- [ ] **Step 3: Create the module**

Create `public/js/browse-filter-core.js`:

````js
// The pure half of the Browse filters: reading and writing the URL, matching
// games and PS Plus Deluxe games against the selected chips, counting what each
// chip would give, and the order of the one-grid results. No DOM here — the
// server uses it for the first render (server.js GET /browse) and
// public/js/browse.js uses the same rules in the filter panel and the filter
// bar, so the two can never disagree.
//
// A site game's facts (built by server.js browseGameFacts):
//   { id, title, text (lowercased search text), tier ('3' | null), ps4, ps5,
//     genres: [..], from (card's "from ₱X" | null), avail, availPs4, isNew, buy,
//     bundle, home ('bundles' | 'cat-3' | 'other') }
// A PS Plus Deluxe item: { k, n (name), c (cover url), ps4, ps5, g (genre), j (just added) }
// ctx: { bands: { low, high }, tiers: [{ id: '3', name }], genres: [..],
//        psplusFrom, psplusAvail, psplusAvailPs4 }
//
// See docs/superpowers/specs/2026-10-09-browse-filters-tiers-design.md.
(function (root) {
  var SHOW = [['avail', 'Available now'], ['new', 'Just added'], ['buy', 'Can buy'], ['bundle', 'Bundles']];
  var SHOW_KEY = { avail: 'avail', 'new': 'isNew', buy: 'buy', bundle: 'bundle' };
  var CONSOLES = [['ps4', 'PS4'], ['ps5', 'PS5']];
  var PRICES = ['low', 'mid', 'high'];
  var DEFAULT_BANDS = { low: 200, high: 300 };
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

  function emptyState() {
    return { search: '', avail: false, isNew: false, buy: false, bundle: false, tiers: [], psplus: false, consoles: [], genres: [], prices: [] };
  }

  function clone(s) {
    return {
      search: s.search, avail: s.avail, isNew: s.isNew, buy: s.buy, bundle: s.bundle,
      tiers: s.tiers.slice(), psplus: s.psplus, consoles: s.consoles.slice(), genres: s.genres.slice(), prices: s.prices.slice()
    };
  }

  // URL query (Express req.query or Object.fromEntries(URLSearchParams)) → state.
  // Old links keep working: ps4=1, platform=PS4, unit=ps4|ps5, newOnly=1.
  function parseState(q) {
    q = q || {};
    var s = emptyState();
    var search = first(q.search);
    s.search = String(search == null ? '' : search).trim();
    var unit = first(q.unit);
    s.avail = first(q.avail) === '1' || unit === 'ps4' || unit === 'ps5';
    s.isNew = first(q['new']) === '1' || first(q.newOnly) === '1';
    s.buy = first(q.buy) === '1';
    s.bundle = first(q.bundle) === '1';
    s.tiers = list(q.tier).filter(function (t) { return /^\d+$/.test(t); });
    s.psplus = first(q.psplus) === '1';
    s.consoles = list(q.console).filter(function (c) { return c === 'ps4' || c === 'ps5'; });
    if ((first(q.ps4) === '1' || first(q.platform) === 'PS4' || unit === 'ps4') && s.consoles.indexOf('ps4') < 0) s.consoles.push('ps4');
    s.genres = list(q.genre);
    s.prices = list(q.price).filter(function (p) { return PRICES.indexOf(p) >= 0; });
    return s;
  }

  // Drops tiers and genres the page has no chip for (a deleted category or a
  // genre no game has any more, from an old shared link), so they can't
  // silently hide every game with nothing on screen to turn them off.
  function cleanState(s, ctx) {
    var n = clone(s);
    var tierIds = (ctx.tiers || []).map(function (t) { return String(t.id); });
    n.tiers = n.tiers.filter(function (t) { return tierIds.indexOf(t) >= 0; });
    n.genres = n.genres.filter(function (g) { return (ctx.genres || []).indexOf(g) >= 0; });
    return n;
  }

  function toQuery(s) {
    var parts = [];
    if (s.search) parts.push('search=' + encodeURIComponent(s.search));
    if (s.avail) parts.push('avail=1');
    if (s.isNew) parts.push('new=1');
    if (s.buy) parts.push('buy=1');
    if (s.bundle) parts.push('bundle=1');
    if (s.tiers.length) parts.push('tier=' + s.tiers.join(','));
    if (s.psplus) parts.push('psplus=1');
    if (s.consoles.length) parts.push('console=' + s.consoles.join(','));
    if (s.genres.length) parts.push('genre=' + s.genres.map(encodeURIComponent).join(','));
    if (s.prices.length) parts.push('price=' + s.prices.join(','));
    return parts.join('&');
  }

  function href(s) {
    var q = toQuery(s);
    return '/browse' + (q ? '?' + q : '');
  }

  function selectedCount(s) {
    return (s.avail ? 1 : 0) + (s.isNew ? 1 : 0) + (s.buy ? 1 : 0) + (s.bundle ? 1 : 0) +
      s.tiers.length + (s.psplus ? 1 : 0) + s.consoles.length + s.genres.length + s.prices.length;
  }

  function anyActive(s) { return !!s.search || selectedCount(s) > 0; }

  function flip(arr, v) {
    var i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
  }

  function toggle(s, group, value) {
    var n = clone(s);
    value = String(value);
    if (group === 'show' && SHOW_KEY[value]) n[SHOW_KEY[value]] = !n[SHOW_KEY[value]];
    else if (group === 'tier') { if (value === 'psplus') n.psplus = !n.psplus; else flip(n.tiers, value); }
    else if (group === 'console') flip(n.consoles, value);
    else if (group === 'genre') flip(n.genres, value);
    else if (group === 'price') flip(n.prices, value);
    else if (group === 'search') n.search = '';
    return n;
  }

  // A section's "Clear" in the filter panel.
  function clearGroup(s, group) {
    var n = clone(s);
    if (group === 'show') { n.avail = false; n.isNew = false; n.buy = false; n.bundle = false; }
    else if (group === 'tier') { n.tiers = []; n.psplus = false; }
    else if (group === 'console') n.consoles = [];
    else if (group === 'genre') n.genres = [];
    else if (group === 'price') n.prices = [];
    return n;
  }

  // The panel's tick box for an option, as a GET form field (the panel still
  // works as a plain form without the page script).
  function formField(group, value) {
    value = String(value);
    if (group === 'show') return { name: value, value: '1' };
    if (group === 'tier' && value === 'psplus') return { name: 'psplus', value: '1' };
    return { name: group, value: value };
  }

  // The filter bar's removable chips: one per applied option, then the search.
  function appliedChips(s, ctx) {
    var out = [];
    var add = function (group, value, label) { out.push({ group: group, value: String(value), label: label, href: href(toggle(s, group, value)) }); };
    SHOW.forEach(function (d) { if (s[SHOW_KEY[d[0]]]) add('show', d[0], d[1]); });
    s.tiers.forEach(function (id) {
      var t = (ctx.tiers || []).filter(function (x) { return String(x.id) === id; })[0];
      add('tier', id, t ? t.name : id);
    });
    if (s.psplus) add('tier', 'psplus', 'PS Plus Deluxe');
    CONSOLES.forEach(function (d) { if (s.consoles.indexOf(d[0]) >= 0) add('console', d[0], d[1]); });
    s.genres.forEach(function (g) { add('genre', g, g); });
    PRICES.forEach(function (p) { if (s.prices.indexOf(p) >= 0) add('price', p, bandLabel(p, ctx.bands)); });
    if (s.search) add('search', '', '"' + s.search + '"');
    return out;
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // The filter bar's count: site games, or PS Plus games when only those show.
  function countText(v) {
    return v.siteOn ? plural(v.site.length, 'game') : plural(v.psplus.length, 'PS Plus game');
  }

  // The panel's big button for a draft's view.
  function applyLabel(v) {
    if (v.siteOn && v.site.length) return { text: 'Show ' + plural(v.site.length, 'game'), disabled: false };
    if (v.psplusOn && v.psplus.length) return { text: 'Show ' + plural(v.psplus.length, 'PS Plus game'), disabled: false };
    if (!v.active) return { text: 'Show all games', disabled: false };
    return { text: 'No games match', disabled: true };
  }

  function isOn(s, group, value) {
    value = String(value);
    if (group === 'show') return !!s[SHOW_KEY[value]];
    if (group === 'tier') return value === 'psplus' ? s.psplus : s.tiers.indexOf(value) >= 0;
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

  // With the PS4 chip on and PS5 off, "Available now" means a PS4 slot is free.
  function ps4Only(s) { return s.consoles.indexOf('ps4') >= 0 && s.consoles.indexOf('ps5') < 0; }

  // Site games show unless "PS Plus Deluxe" is the only Tier chip on.
  function siteOn(s) { return !(s.psplus && !s.tiers.length); }

  // The PS Plus section shows while filtering, unless Can buy / Bundles is on or
  // other Tier chips are on without "PS Plus Deluxe".
  function psplusOn(s) { return anyActive(s) && !s.buy && !s.bundle && (!s.tiers.length || s.psplus); }

  function matchSite(f, s, bands) {
    var q = s.search.toLowerCase();
    if (q && f.text.indexOf(q) < 0) return false;
    if (s.avail && !(ps4Only(s) ? f.availPs4 : f.avail)) return false;
    if (s.isNew && !f.isNew) return false;
    if (s.buy && !f.buy) return false;
    if (s.bundle && !f.bundle) return false;
    if (s.tiers.length && s.tiers.indexOf(f.tier) < 0) return false;
    if (s.consoles.length && !s.consoles.some(function (c) { return f[c]; })) return false;
    if (s.genres.length && !s.genres.some(function (g) { return f.genres.indexOf(g) >= 0; })) return false;
    if (s.prices.length && s.prices.indexOf(bandOf(f.from, bands)) < 0) return false;
    return true;
  }

  function matchPsplus(p, s, ctx) {
    if (!psplusOn(s)) return false;
    var q = s.search.toLowerCase();
    if (q && String(p.n).toLowerCase().indexOf(q) < 0) return false;
    if (s.avail && !(ps4Only(s) ? ctx.psplusAvailPs4 : ctx.psplusAvail)) return false;
    if (s.isNew && !p.j) return false;
    if (s.consoles.length && !s.consoles.some(function (c) { return p[c]; })) return false;
    if (s.genres.length && s.genres.indexOf(p.g) < 0) return false;
    if (s.prices.length && s.prices.indexOf(bandOf(ctx.psplusFrom, ctx.bands)) < 0) return false;
    return true;
  }

  function results(games, psplus, s, ctx) {
    return {
      site: siteOn(s) ? (games || []).filter(function (f) { return matchSite(f, s, ctx.bands); }) : [],
      psplus: (psplus || []).filter(function (p) { return matchPsplus(p, s, ctx); })
    };
  }

  // What a chip's number means: the games the customer would see. That is the
  // site games, except when only PS Plus games would show.
  function shownCount(games, psplus, s, ctx) {
    var r = results(games, psplus, s, ctx);
    return siteOn(s) ? r.site.length : r.psplus.length;
  }

  function chipFor(games, psplus, s, ctx, group, value, label) {
    var on = isOn(s, group, value);
    var count;
    if (group === 'tier' && value === 'psplus') {
      count = results(games, psplus, on ? s : toggle(s, group, value), ctx).psplus.length;
    } else {
      count = shownCount(games, psplus, on ? s : toggle(s, group, value), ctx);
    }
    var zero = !on && count === 0;
    return { group: group, value: String(value), label: label, count: count, on: on, zero: zero, href: zero ? null : href(toggle(s, group, value)) };
  }

  // A chip exists only if something in the whole library could ever match it
  // (no "Bundles" chip when there are no bundles at all).
  function exists(games, psplus, ctx, group, value) {
    var s = toggle(emptyState(), group, value);
    if (group === 'tier' && value === 'psplus') return (psplus || []).length > 0;
    return shownCount(games, psplus, s, ctx) > 0;
  }

  function chipGroups(games, psplus, s, ctx) {
    var groups = [];
    function group(key, label, defs) {
      var chips = defs.filter(function (d) { return exists(games, psplus, ctx, key, d[0]); })
        .map(function (d) { return chipFor(games, psplus, s, ctx, key, d[0], d[1]); });
      if (chips.length) groups.push({ key: key, label: label, chips: chips });
    }
    group('show', 'Show', SHOW);
    group('tier', 'Tier', (ctx.tiers || []).map(function (t) { return [String(t.id), t.name]; }).concat([['psplus', 'PS Plus Deluxe']]));
    group('console', 'Console', CONSOLES);
    group('genre', 'Genre', (ctx.genres || []).map(function (g) { return [g, g]; }));
    group('price', 'Price', PRICES.map(function (p) { return [p, bandLabel(p, ctx.bands)]; }));
    return groups;
  }

  // The one-grid order while filtering: tier in admin order (no tier last), then A–Z.
  function sortForGrid(list, tiers) {
    var order = {};
    (tiers || []).forEach(function (t, i) { order[String(t.id)] = i; });
    var rank = function (f) { return f.tier != null && order[f.tier] != null ? order[f.tier] : Infinity; };
    return list.slice().sort(function (a, b) { return (rank(a) - rank(b)) || a.title.localeCompare(b.title); });
  }

  // Everything a render needs for one state.
  function view(games, psplus, s, ctx) {
    var r = results(games, psplus, s, ctx);
    var active = anyActive(s);
    return {
      active: active,
      siteOn: siteOn(s),
      psplusOn: active && r.psplus.length > 0,
      site: r.site,
      grid: active ? sortForGrid(r.site, ctx.tiers).map(function (f) { return f.id; }) : [],
      psplus: r.psplus,
      groups: chipGroups(games, psplus, s, ctx),
      selected: selectedCount(s)
    };
  }

  var api = {
    PSPLUS_LIMIT: PSPLUS_LIMIT, DEFAULT_BANDS: DEFAULT_BANDS,
    genreParts: genreParts, genreList: genreList, emptyState: emptyState, parseState: parseState, cleanState: cleanState,
    toQuery: toQuery, href: href, selectedCount: selectedCount, anyActive: anyActive, toggle: toggle, isOn: isOn,
    clearGroup: clearGroup, formField: formField, appliedChips: appliedChips, countText: countText, applyLabel: applyLabel,
    parseBands: parseBands, normalizeBands: normalizeBands, bandOf: bandOf, bandLabel: bandLabel,
    siteOn: siteOn, psplusOn: psplusOn, matchSite: matchSite, matchPsplus: matchPsplus, results: results,
    chipGroups: chipGroups, sortForGrid: sortForGrid, view: view
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BrowseFilterCore = api;
})(typeof window !== 'undefined' ? window : this);
````

- [ ] **Step 4: Run it and watch it pass**

Run: `node scripts/test-browse-filter-core.js` → `20 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add public/js/browse-filter-core.js scripts/test-browse-filter-core.js
git commit -m "Browse filter rules: combinable chips, counts, price bands, PS Plus matching

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tier pills (admin colour and description, cards, game page, "Just added")

**Files:**
- Create: `lib/tier-style.js`, `scripts/test-tier-style.js`, `scripts/test-tier-pill.js`
- Modify (via the edit script): `server.js`, `views/partials/admin/games/categories.ejs`, `views/partials/game-card.ejs`, `views/game-detail.ejs`, `public/css/style.css`

**Interfaces:**
- Produces: `lib/tier-style.js` → `PILL_COLORS`, `DESCRIPTION_MAX` (120), `defaultColor(name)`, `pillColor(cat)`, `cleanColor(raw) → colour|null`, `cleanDescription(raw)`, `tierOf(game, categories) → { id, name, color, description } | null`. In `server.js`: `const tierStyle = require('./lib/tier-style');`, `app.locals.gameTier(game)`, `app.locals.tierPillColor(cat)`, `app.locals.TIER_PILL_COLORS`. Category records gain `pill_color` (null = automatic) and `description`. CSS classes `.tier-pill`, `.tier-blue|purple|coral|grey|teal|pink|gold`, `.usd-tier-pill`.
- Task 3's edit script anchors on the `const tierStyle = require` and `app.locals.TIER_PILL_COLORS` lines added here.

- [ ] **Step 1: Write the tests**

Create `scripts/test-tier-style.js`:

````js
// Run: node scripts/test-tier-style.js
//
// Tier pill colours and descriptions (lib/tier-style.js).
const assert = require('assert');
const T = require('../lib/tier-style');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

ok('a category with no colour picked gets one from its name', () => {
  assert.strictEqual(T.pillColor({ name: 'New Games' }), 'blue');
  assert.strictEqual(T.pillColor({ name: 'Deluxe' }), 'purple');
  assert.strictEqual(T.pillColor({ name: 'Special Price' }), 'coral');
  assert.strictEqual(T.pillColor({ name: 'Regular' }), 'grey');
  assert.strictEqual(T.pillColor({ name: 'Classics' }), 'grey');
});
ok('the owner\'s pick wins; anything else falls back to the name', () => {
  assert.strictEqual(T.pillColor({ name: 'Regular', pill_color: 'teal' }), 'teal');
  assert.strictEqual(T.pillColor({ name: 'Deluxe', pill_color: 'gold' }), 'purple');
  assert.strictEqual(T.cleanColor('pink'), 'pink');
  assert.strictEqual(T.cleanColor('#ff0000'), null);
  assert.strictEqual(T.cleanColor(undefined), null);
});
ok('descriptions are one trimmed line of at most 120 characters', () => {
  assert.strictEqual(T.cleanDescription('  Big   recent\nAAA games  '), 'Big recent AAA games');
  assert.strictEqual(T.cleanDescription(undefined), '');
  assert.strictEqual(T.cleanDescription('x'.repeat(200)).length, 120);
});
ok('a game\'s tier comes from its price category', () => {
  const cats = [{ id: 2, name: 'Deluxe', description: 'Big recent AAA games' }, { id: 3, name: 'Special', pill_color: 'pink' }];
  assert.deepStrictEqual(T.tierOf({ price_category_id: 2 }, cats), { id: 2, name: 'Deluxe', color: 'purple', description: 'Big recent AAA games' });
  assert.deepStrictEqual(T.tierOf({ price_category_id: '3' }, cats), { id: 3, name: 'Special', color: 'pink', description: '' });
  assert.strictEqual(T.tierOf({ price_category_id: 9 }, cats), null, 'deleted category');
  assert.strictEqual(T.tierOf({ price_category_id: null }, cats), null);
  assert.strictEqual(T.tierOf(null, cats), null);
});

console.log('\n' + passed + ' assertions passed\n');
````

Create `scripts/test-tier-pill.js` (boots a throwaway instance on port 4614):

````js
// Run: node scripts/test-tier-pill.js
//
// Tier pills: the colour and description the owner sets on a price category,
// the pill on game cards (Browse, homepage) and the game page, none for games
// without a category or for bundles, and the "Just added" corner badge. Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a
// made-up admin password); the project's games.json, the database and the real
// admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4614;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-pill-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const prices = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '/uploads/' + id + '.png',
  non_trophy_slots: 2, trophy_slots: 2, renters: 20 - id, created_at: '2020-01-01T00:00:00.000Z'
}, prices, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  price_categories: [
    Object.assign({ id: 1, name: 'New Games' }, prices),
    Object.assign({ id: 2, name: 'Deluxe', description: 'Big recent AAA games' }, prices),
    Object.assign({ id: 3, name: 'Special', pill_color: 'pink' }, prices)
  ],
  nextPriceCategoryId: 4,
  games: [
    game(1, 'Zzyzx Deluxe', { price_category_id: 2, created_at: new Date().toISOString() }),
    game(2, 'Zzyzx Special', { price_category_id: 3 }),
    game(3, 'Zzyzx Plain'),
    game(4, 'Zzyzx Bundle', { price_category_id: 2, is_bundle: true })
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const readDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const catById = id => readDb().price_categories.find(c => c.id === id);

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
// The category forms upload a picture, so they post multipart.
function multipart(fields) {
  const b = '----tierpill' + Math.random().toString(16).slice(2);
  const body = Object.keys(fields).map(k => '--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + fields[k] + '\r\n').join('') + '--' + b + '--\r\n';
  return { body, type: 'multipart/form-data; boundary=' + b };
}
// The HTML of the game card (views/partials/game-card.ejs) that links to a
// game, within `html` — not the search shortcut chips that link there too.
function cardFor(html, slug) {
  const i = html.indexOf('href="/game/' + slug + '" class="game-card');
  assert.ok(i >= 0, 'card for ' + slug + ' found');
  return html.slice(i, html.indexOf('</a>', i));
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
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\ncards and game page');
  const browse = (await call('GET', '/browse')).body;
  await okAsync('a card carries its tier pill, coloured by name unless the owner picked one', async () => {
    assert.ok(cardFor(browse, 'zzyzx-deluxe').includes('<span class="tier-pill tier-purple">Deluxe</span>'));
    assert.ok(cardFor(browse, 'zzyzx-special').includes('<span class="tier-pill tier-pink">Special</span>'));
  });
  await okAsync('no pill without a category, and none on bundles', async () => {
    assert.ok(!cardFor(browse, 'zzyzx-plain').includes('tier-pill'));
    assert.ok(!cardFor(browse, 'zzyzx-bundle').includes('tier-pill'));
  });
  await okAsync('homepage cards carry the pill too', async () => {
    const home = (await call('GET', '/')).body;
    assert.ok(cardFor(home, 'zzyzx-special').includes('<span class="tier-pill tier-pink">Special</span>'));
  });
  await okAsync('the game page shows the pill above the title', async () => {
    const r = await call('GET', '/game/zzyzx-deluxe');
    assert.strictEqual(r.status, 200);
    const i = r.body.indexOf('<span class="tier-pill tier-purple usd-tier-pill">Deluxe</span>');
    assert.ok(i > 0 && i < r.body.indexOf('<h1 class="usd-title">'));
    assert.ok(!(await call('GET', '/game/zzyzx-plain')).body.includes('usd-tier-pill'));
  });
  await okAsync('the 11-day corner badge reads "Just added"', async () => {
    assert.ok(cardFor(browse, 'zzyzx-deluxe').includes('<div class="gc2-badge gc2-badge-new">Just added</div>'));
    assert.ok(!cardFor(browse, 'zzyzx-special').includes('gc2-badge-new'));
  });

  console.log('\nadmin');
  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(TEST_PASSWORD) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const post = (p, fields, extra) => { const m = multipart(fields); return call('POST', p, { headers: Object.assign({ 'Content-Type': m.type, Cookie: cookie }, extra || {}), body: m.body }); };
  const catFields = o => Object.assign({ name: 'Deluxe', nt_price_7d: '349', nt_price_30d: '799', tr_price_7d: '399', tr_price_30d: '899' }, o);
  await okAsync('the category form offers the colours and the description', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('<option value="teal">Teal</option>'));
    assert.ok(r.body.includes('name="description" value="Big recent AAA games" maxlength="120"'));
    assert.ok(r.body.includes('<option value="pink" selected>Pink</option>'), 'Special shows its picked colour');
  });
  await okAsync('saving sets the colour and a one-line description', async () => {
    const r = await post('/admin/price-categories/edit/2', catFields({ pill_color: 'teal', description: '  Big   AAA\ngames ' }));
    assert.strictEqual(r.status, 302);
    assert.deepStrictEqual([catById(2).pill_color, catById(2).description], ['teal', 'Big AAA games']);
  });
  await okAsync('a colour that is not one of the six keeps the old one; "Automatic" clears it', async () => {
    await post('/admin/price-categories/edit/2', catFields({ pill_color: '#ff0000', description: 'Big AAA games' }));
    assert.strictEqual(catById(2).pill_color, 'teal');
    await post('/admin/price-categories/edit/2', catFields({ pill_color: '', description: 'Big AAA games' }));
    assert.strictEqual(catById(2).pill_color, null);
    assert.ok(cardFor((await call('GET', '/browse')).body, 'zzyzx-deluxe').includes('tier-purple'), 'back to the colour from the name');
  });
  await okAsync('a new category stores its colour and description', async () => {
    await post('/admin/price-categories/add', catFields({ name: 'Classics', pill_color: 'coral', description: 'Older hits' }));
    const added = readDb().price_categories.find(c => c.name === 'Classics');
    assert.deepStrictEqual([added.pill_color, added.description], ['coral', 'Older hits']);
  });
  await okAsync('saving needs the admin login', async () => {
    const m = multipart(catFields({ pill_color: 'pink' }));
    const r = await call('POST', '/admin/price-categories/edit/1', { headers: { 'Content-Type': m.type, Accept: 'text/html' }, body: m.body });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
    assert.strictEqual(catById(1).pill_color, undefined);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-tier-style.js` → FAIL `Cannot find module '../lib/tier-style'`.
Run: `node scripts/test-tier-pill.js` → FAIL at "a card carries its tier pill…" (no pill yet).

- [ ] **Step 3: Create the library**

Create `lib/tier-style.js`:

````js
// How a price category ("tier") looks to customers: the colour of its pill on
// game cards and the game page, and its one-line description. Set by the owner
// in Admin → Games → Price Categories; a category with no colour picked gets one
// from its name. See docs/superpowers/specs/2026-10-09-browse-filters-tiers-design.md.
const PILL_COLORS = ['blue', 'purple', 'coral', 'grey', 'teal', 'pink'];
const DESCRIPTION_MAX = 120;

function defaultColor(name) {
  const n = String(name == null ? '' : name).toLowerCase();
  if (n.includes('new')) return 'blue';
  if (n.includes('deluxe')) return 'purple';
  if (n.includes('special')) return 'coral';
  return 'grey';
}

function pillColor(cat) {
  if (!cat) return 'grey';
  return PILL_COLORS.includes(cat.pill_color) ? cat.pill_color : defaultColor(cat.name);
}

// A submitted colour, or null when it isn't one of the six.
function cleanColor(raw) {
  return PILL_COLORS.includes(raw) ? raw : null;
}

// One line, spaces squeezed, at most 120 characters.
function cleanDescription(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX);
}

// The tier a card or game page shows, or null (no category, or it was deleted).
function tierOf(game, categories) {
  if (!game || !game.price_category_id) return null;
  const cat = (categories || []).find(c => c.id === Number(game.price_category_id));
  return cat ? { id: cat.id, name: cat.name, color: pillColor(cat), description: cat.description || '' } : null;
}

module.exports = { PILL_COLORS, DESCRIPTION_MAX, defaultColor, pillColor, cleanColor, cleanDescription, tierOf };
````

Run: `node scripts/test-tier-style.js` → `4 assertions passed`.

- [ ] **Step 4: Apply the edits**

Create `.superpowers/tmp-edits/rep.js` (keeps BOM and CRLF; fails loudly on a missing or repeated anchor; Tasks 3 and 4 reuse it):

````js
// Edit helpers for the plan's scripts (run from the repo root). All of them
// keep a file's UTF-8 BOM and CRLF line endings exactly as they were.
//   rep(file, from, to)               — replace the one occurrence of `from`
//                                       (written with \n); throws if it is
//                                       missing or appears more than once.
//   rep.between(file, start, end, to) — replace from `start` (included) up to
//                                       `end` (kept); each must appear once.
//   rep.put(file, text)               — replace the whole file with `text`.
const fs = require('fs');

function read(file) {
  let s = fs.readFileSync(file, 'utf8');
  const bom = s.charCodeAt(0) === 0xfeff;
  if (bom) s = s.slice(1);
  const crlf = s.includes('\r\n');
  if (crlf) s = s.replace(/\r\n/g, '\n');
  return { s, bom, crlf };
}

function write(file, f, s) {
  if (f.crlf) s = s.replace(/\n/g, '\r\n');
  fs.writeFileSync(file, (f.bom ? '﻿' : '') + s);
}

function once(file, s, m) {
  const n = s.split(m).length - 1;
  if (n !== 1) throw new Error(file + ': expected 1 match, found ' + n + ' for: ' + m.slice(0, 80));
}

function rep(file, from, to) {
  const f = read(file);
  once(file, f.s, from);
  write(file, f, f.s.replace(from, () => to));
}

rep.between = function between(file, start, end, to) {
  const f = read(file);
  once(file, f.s, start);
  once(file, f.s, end);
  const i = f.s.indexOf(start), j = f.s.indexOf(end);
  if (j < i) throw new Error(file + ': end marker comes before start marker');
  write(file, f, f.s.slice(0, i) + to + f.s.slice(j));
};

rep.put = function put(file, text) {
  write(file, read(file), text.replace(/\r\n/g, '\n'));
};

module.exports = rep;
````

Create `.superpowers/tmp-edits/edit-bt-tiers.js`:

````js
// Tier pills — admin colour/description, pills on cards and the game page,
// "Just added" (run from the repo root).
const rep = require('./rep');

// ── server.js ────────────────────────────────────────────────────────────────
rep('server.js', `const gameDiscount = require('./lib/game-discount');
`, `const gameDiscount = require('./lib/game-discount');
const tierStyle = require('./lib/tier-style');
`);
rep('server.js', `app.locals.gameDiscountPct = (game, days, promo) => gameDiscount.discountPct(game, days, promo);
`, `app.locals.gameDiscountPct = (game, days, promo) => gameDiscount.discountPct(game, days, promo);
// A game's tier (price category) for its pill: { id, name, color, description } or null.
app.locals.gameTier = (game) => tierStyle.tierOf(game, getPriceCategories());
app.locals.tierPillColor = (cat) => tierStyle.pillColor(cat);
app.locals.TIER_PILL_COLORS = tierStyle.PILL_COLORS;
`);

// Add category: pill colour ('' = from the name) and description.
rep('server.js', `  const { name, nt_price_7d, nt_price_30d, tr_price_7d, tr_price_30d,
    image_width, image_height, image_opacity, image_blend, bg_color, title_color, title_size } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin?msg=error');`, `  const { name, nt_price_7d, nt_price_30d, tr_price_7d, tr_price_30d,
    image_width, image_height, image_opacity, image_blend, bg_color, title_color, title_size,
    pill_color, description } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin?msg=error');`);
rep('server.js', `    title_size: Math.min(40, Math.max(10, parseInt(title_size) || 18)),
  }).write();
  res.redirect('/admin?msg=cat_added');`, `    title_size: Math.min(40, Math.max(10, parseInt(title_size) || 18)),
    // Tier pill (lib/tier-style.js): null colour = picked from the name.
    pill_color: tierStyle.cleanColor(pill_color),
    description: tierStyle.cleanDescription(description),
  }).write();
  res.redirect('/admin?msg=cat_added');`);

// Edit category: '' = back to the colour from the name; anything not one of the
// six keeps the old colour.
rep('server.js', `    image_width, image_height, image_opacity, image_blend, bg_color, title_color, title_size, remove_image } = req.body;`,
`    image_width, image_height, image_opacity, image_blend, bg_color, title_color, title_size, remove_image,
    pill_color, description } = req.body;`);
rep('server.js', `    title_size: Math.min(40, Math.max(10, parseInt(title_size) || cat.title_size || 18)),
  }).write();
  res.redirect('/admin?msg=cat_updated');`, `    title_size: Math.min(40, Math.max(10, parseInt(title_size) || cat.title_size || 18)),
    pill_color: pill_color === '' ? null : (tierStyle.cleanColor(pill_color) || cat.pill_color || null),
    description: description !== undefined ? tierStyle.cleanDescription(description) : (cat.description || ''),
  }).write();
  res.redirect('/admin?msg=cat_updated');`);

// ── Admin: price category forms ──────────────────────────────────────────────
const CAT = 'views/partials/admin/games/categories.ejs';
const pillFields = (selected, desc) => `
                <div class="form-group"><label>Pill Colour <span style="color:#666;font-weight:400;">— tier label on game cards</span></label>
                  <select name="pill_color">
                    <option value=""<%= ${selected} ? '' : ' selected' %>>Automatic (from the name)</option>
                    <% (typeof TIER_PILL_COLORS !== 'undefined' ? TIER_PILL_COLORS : []).forEach(c => { %><option value="<%= c %>"<%= ${selected} === c ? ' selected' : '' %>><%= c[0].toUpperCase() + c.slice(1) %></option><% }) %>
                  </select></div>
                <div class="form-group full"><label>Description <span style="color:#666;font-weight:400;">— one line customers see on Browse, e.g. "Big recent AAA games"</span></label><input type="text" name="description" value="<%= ${desc} %>" maxlength="120"></div>`;
rep(CAT, `<div class="form-group full"><label>Category Name</label><input type="text" name="name" value="<%= cat.name %>" required></div>`,
  `<div class="form-group full"><label>Category Name</label><input type="text" name="name" value="<%= cat.name %>" required></div>` + pillFields('cat.pill_color', "cat.description || ''"));
rep(CAT, `<div class="form-group full"><label>Category Name *</label><input type="text" name="name" placeholder="e.g. New Games, Classic, Special" required></div>`,
  `<div class="form-group full"><label>Category Name *</label><input type="text" name="name" placeholder="e.g. New Games, Classic, Special" required></div>` + pillFields("''", "''"));
// The category row shows its pill as customers will see it.
rep(CAT, `            <span style="font-weight:700;color:#fff;flex:1;"><%= cat.name %></span>`,
  `            <span style="font-weight:700;color:#fff;flex:1;"><%= cat.name %> <span class="tier-pill tier-<%= typeof tierPillColor === 'function' ? tierPillColor(cat) : 'grey' %>"><%= cat.name %></span></span>`);

// ── Game card: pill above the title, "Just added" ────────────────────────────
const GC = 'views/partials/game-card.ejs';
rep(GC, `  const gcBundle = resolveBundleInfo(game);
`, `  const gcBundle = resolveBundleInfo(game);
  // The game's tier pill (lib/tier-style.js) — bundles already say "Bundle · N games".
  const gcTier = (!game.is_bundle && typeof gameTier === 'function') ? gameTier(game) : null;
`);
rep(GC, `  <div class="gc2-body">
    <div class="gc2-plat`, `  <div class="gc2-body">
    <% if (gcTier) { %><span class="tier-pill tier-<%= gcTier.color %>"><%= gcTier.name %></span><% } %>
    <div class="gc2-plat`);
rep(GC, `<div class="gc2-badge gc2-badge-new">New</div>`, `<div class="gc2-badge gc2-badge-new">Just added</div>`);

// ── Game page: pill in the badge row above the title ─────────────────────────
rep('views/game-detail.ejs', `        <span class="usd-plat-chip"><%= game.platform %></span>
`, `        <% const gdTier = (!game.is_bundle && typeof gameTier === 'function') ? gameTier(game) : null; %>
        <% if (gdTier) { %><span class="tier-pill tier-<%= gdTier.color %> usd-tier-pill"><%= gdTier.name %></span><% } %>
        <span class="usd-plat-chip"><%= game.platform %></span>
`);

// ── Pill colours ─────────────────────────────────────────────────────────────
rep('public/css/style.css', `.gc2-deal { font-size: 0.66rem; font-weight: 800; color: #4ade80; }
`, `.gc2-deal { font-size: 0.66rem; font-weight: 800; color: #4ade80; }
/* Tier pill: a game's price category on cards, the game page and Browse
   (lib/tier-style.js). Light fill + darkest text of the same hue. */
.tier-pill { display: inline-block; align-self: flex-start; font-size: 0.62rem; font-weight: 800; letter-spacing: 0.3px; line-height: 1.4; padding: 0.12rem 0.55rem; border-radius: 20px; white-space: nowrap; }
.usd-tier-pill { font-size: 0.72rem; align-self: center; }
.tier-blue { background: #B5D4F4; color: #042C53; }
.tier-purple { background: #CECBF6; color: #26215C; }
.tier-coral { background: #F5C4B3; color: #4A1B0C; }
.tier-grey { background: #D3D1C7; color: #2C2C2A; }
.tier-teal { background: #9FE1CB; color: #04342C; }
.tier-pink { background: #F4C0D1; color: #4B1528; }
.tier-gold { background: #FAC775; color: #412402; }
`);
console.log('edited');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-bt-tiers.js` → `edited`.
Then: `node --check server.js && file server.js views/partials/game-card.ejs views/game-detail.ejs views/partials/admin/games/categories.ejs public/css/style.css` → server.js BOM + CRLF, game-card and style.css CRLF, the other two LF (as before).

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-tier-pill.js` → `10 assertions passed`.
Run: `node scripts/test-templates.js && node scripts/test-game-discount-pricing.js && node scripts/test-game-detail-messenger.js` → all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/tier-style.js scripts/test-tier-style.js scripts/test-tier-pill.js server.js views/partials/admin/games/categories.ejs views/partials/game-card.ejs views/game-detail.ejs public/css/style.css
git commit -m "Tier pills on game cards and the game page; pill colour and description per price category; \"Just added\" badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Settings → Browse price filter

**Files:**
- Create: `scripts/test-admin-price-bands.js`
- Modify (via the edit script): `server.js`, `views/admin.ejs`, `views/partials/admin/settings.ejs`, `public/css/style.css`

**Interfaces:**
- Consumes: Task 1's `parseBands`, `normalizeBands`; Task 2's `const tierStyle = require` / `app.locals.TIER_PILL_COLORS` lines (anchors).
- Produces: in `server.js` — `const browseCore = require('./public/js/browse-filter-core');`, `getBrowseBands() → { low, high }`, `app.locals.browseBands()`, `POST /admin/browse-price-bands` (requireAuth; fields `low`, `high`; saves `site_settings.browse_price_bands`; redirects `msg=price_bands_saved` or `msg=price_bands_invalid`, tab settings). Task 4 uses `browseCore` and `getBrowseBands()`.

- [ ] **Step 1: Write the test**

Create `scripts/test-admin-price-bands.js` (port 4615):

````js
// Run: node scripts/test-admin-price-bands.js
//
// Admin → Settings → Browse price filter: the card, saving the two cut-offs,
// refusing bad ones, and the login. Boots a throwaway instance (temp DATA_DIR,
// blank MONGODB_URI, in-memory sessions, a made-up admin password); the
// project's games.json, the database and the real admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4615;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'price-bands-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: []
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const bandsInDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8')).site_settings.browse_price_bands;

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
    const r = await call('POST', '/admin/browse-price-bands', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: form({ low: '150', high: '250' }) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
    assert.strictEqual(bandsInDb(), undefined);
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const post = o => call('POST', '/admin/browse-price-bands', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o) });

  await okAsync('the Settings card shows the defaults and the chips customers will see', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('id="sec-price-bands"') && r.body.includes('href="#sec-price-bands"'));
    assert.ok(r.body.includes('name="low" value="200"') && r.body.includes('name="high" value="300"'));
    assert.ok(r.body.includes('Customers see: Under ₱200 · ₱200–299 · ₱300+.'));
  });
  await okAsync('saves two whole numbers', async () => {
    const r = await post({ low: '150', high: '250' });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.endsWith('msg=price_bands_saved'));
    assert.deepStrictEqual(bandsInDb(), { low: 150, high: 250 });
    assert.ok((await call('GET', '/admin', { headers: { Cookie: cookie } })).body.includes('Customers see: Under ₱150 · ₱150–249 · ₱250+.'));
  });
  await okAsync('refuses a second number that is not bigger, and anything not a whole number', async () => {
    for (const bad of [{ low: '300', high: '300' }, { low: '0', high: '100' }, { low: 'abc', high: '100' }, { low: '99.5', high: '200' }]) {
      const r = await post(bad);
      assert.ok(r.headers.location.endsWith('msg=price_bands_invalid'), JSON.stringify(bad));
    }
    assert.deepStrictEqual(bandsInDb(), { low: 150, high: 250 }, 'unchanged');
  });
  await okAsync('both messages are wired to the Settings tab', async () => {
    const r = await call('GET', '/admin?tab=settings&msg=price_bands_saved', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes("price_bands_saved:'✅ Price filter saved'"));
    assert.ok(r.body.includes("price_bands_saved:'settings', price_bands_invalid:'settings'"));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-admin-price-bands.js` → FAIL at "saving needs the admin login": `404 !== 302` (no route yet).

- [ ] **Step 3: Apply the edits**

Create `.superpowers/tmp-edits/edit-bt-bands.js` (`rep.js` from Task 2 is already there):

````js
// Settings → Browse price filter: the two cut-offs behind Browse's Price chips
// (run from the repo root).
const rep = require('./rep');

rep('server.js', `const tierStyle = require('./lib/tier-style');
`, `const tierStyle = require('./lib/tier-style');
const browseCore = require('./public/js/browse-filter-core');
`);
rep('server.js', `app.locals.TIER_PILL_COLORS = tierStyle.PILL_COLORS;
`, `app.locals.TIER_PILL_COLORS = tierStyle.PILL_COLORS;
// The Price chip cut-offs on Browse ({ low, high }; defaults 200 / 300).
function getBrowseBands() { return browseCore.normalizeBands(getSiteSettings().browse_price_bands); }
app.locals.browseBands = () => getBrowseBands();
`);
rep('server.js', `// Settings → Game discounts: each game's own Weekly / Monthly % (lib/game-discount.js).`,
`// Settings → Browse price filter. Two whole numbers, the first below the second;
// anything else is refused and nothing is saved.
app.post('/admin/browse-price-bands', requireAuth, (req, res) => {
  const bands = browseCore.parseBands((req.body || {}).low, (req.body || {}).high);
  if (!bands) return res.redirect('/admin?tab=settings&msg=price_bands_invalid');
  db.set('site_settings.browse_price_bands', bands).write();
  res.redirect('/admin?tab=settings&msg=price_bands_saved');
});

// Settings → Game discounts: each game's own Weekly / Monthly % (lib/game-discount.js).`);

rep('views/admin.ejs', "    settings_saved:'settings', promo_saved:'settings', game_discounts_saved:'settings',",
  "    settings_saved:'settings', promo_saved:'settings', game_discounts_saved:'settings', price_bands_saved:'settings', price_bands_invalid:'settings',");
rep('views/admin.ejs', "const messages = { game_discounts_saved:'✅ Game discounts saved',",
  "const messages = { price_bands_saved:'✅ Price filter saved', price_bands_invalid:'Price filter not saved — use two whole numbers, the first smaller than the second', game_discounts_saved:'✅ Game discounts saved',");

const S = 'views/partials/admin/settings.ejs';
rep(S, `      <a href="#sec-game-discounts">Game discounts</a>
`, `      <a href="#sec-game-discounts">Game discounts</a>
      <a href="#sec-price-bands">Browse price filter</a>
`);
rep(S, `    <!-- GAME DISCOUNTS — each game's own Weekly / Monthly % (lib/game-discount.js) -->
`, `    <!-- BROWSE PRICE FILTER — the cut-offs behind Browse's Price chips -->
    <% const pbBands = typeof browseBands === 'function' ? browseBands() : { low: 200, high: 300 }; %>
    <div class="adm-card" id="sec-price-bands">
      <div class="adm-card-head" style="border-left:3px solid #38bdf8;">
        <div class="sa-left">
          <div class="sa-icon" style="background:rgba(56,189,248,0.15);">💸</div>
          <div>
            <div class="sa-title">Browse price filter</div>
            <div class="sa-desc">The cut-offs behind the Price chips on Browse</div>
          </div>
        </div>
      </div>
      <div class="adm-card-body">
        <form method="POST" action="/admin/browse-price-bands" class="pb-form">
          <label>Cheapest chip: under ₱ <input type="number" name="low" value="<%= pbBands.low %>" min="1" step="1" required></label>
          <label>Top chip: ₱ <input type="number" name="high" value="<%= pbBands.high %>" min="2" step="1" required> and up</label>
          <button type="submit" class="btn btn-primary">Save price filter</button>
        </form>
        <p class="gdt-note">Customers see: Under ₱<%= pbBands.low %> · ₱<%= pbBands.low %>–<%= pbBands.high - 1 %> · ₱<%= pbBands.high %>+. Each game counts at the "from ₱" price on its card; PS Plus games at the PS Plus weekly price.</p>
      </div>
    </div>

    <!-- GAME DISCOUNTS — each game's own Weekly / Monthly % (lib/game-discount.js) -->
`);

rep('public/css/style.css', `.gdt-pay { color: #4ade80; font-weight: 700; white-space: nowrap; }
`, `.gdt-pay { color: #4ade80; font-weight: 700; white-space: nowrap; }
/* Admin → Settings → Browse price filter. */
.pb-form { display: flex; gap: 0.75rem 1.25rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.6rem; font-size: 0.85rem; color: #ccc; }
.pb-form input[type=number] { width: 90px; margin-left: 0.3rem; }
`);
console.log('edited');
````

Run: `node .superpowers/tmp-edits/edit-bt-bands.js` → `edited`.
Then: `node --check server.js && file server.js views/admin.ejs views/partials/admin/settings.ejs public/css/style.css` → line endings unchanged.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-admin-price-bands.js` → `5 assertions passed`.
Run: `node scripts/test-game-discount-admin.js && node scripts/test-tier-pill.js` → both pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-admin-price-bands.js server.js views/admin.ejs views/partials/admin/settings.ejs public/css/style.css
git commit -m "Settings: Browse price filter cut-offs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Browse page

**Files:**
- Create: `public/js/browse.js`, `public/css/browse-filters.css`, `views/partials/browse-filter-option.ejs`, `scripts/test-browse-page.js`
- Modify (via the edit script): `server.js` (replaces `applyBrowseFilters` and `GET /browse`; `/ps-plus` uses the shared weekly price), `views/browse.ejs` (rewritten)

**Interfaces:**
- Consumes: Task 1's whole module (`browseCore`); Task 2's `tierStyle` and card pill; Task 3's `browseCore` require and `getBrowseBands()`. Existing server helpers: `computeAvailability`, `resolveBundleInfo`, `getPriceCategory`, `getPriceCategories`, `gameDiscount.applyPct/discountPct`, `isAddedThisMonth`, `psplusCatalogView.buildPublicCatalog`, `psplusCatalogStore.all()`, `psplusMonthlyCoversStore.all()`, `getPsplus()`, `getPsplusPrices()`, `getPsplusSlots()`, `gameSlug`.
- Produces: `browseGameFacts(game, accountSummaryMap, promo)`, `psplusFromWeekly()`, `browsePsplusData(accountSummaryMap) → { items, from, avail, availPs4 }`; page element ids `bfBar`, `bfOpen`, `bfOpenN`, `bfChips`, `resultsCount`, `bfPanel`, `bfBackdrop`, `bfForm`, `bfClose`, `bfClearAll`, `bfGo`, `bfUpcoming`, `bfSections`, `bfResults`, `bfEmpty`, `bfGrid`, `bfPsplus`, `bfPsCount`, `bfPsGrid`, `bfPsAll`, `bfPsMonthly`, `browseData` (JSON); section ids `cat-section-<id>`, `cat-section-bundles`, `cat-section-uncategorized` (homepage tier cards link to these).

- [ ] **Step 1: Write the test**

Create `scripts/test-browse-page.js` (port 4616; stubs the PS Plus list):

````js
// Run: node scripts/test-browse-page.js
//
// The Browse page as the server renders it for a URL: tier sections with no
// filter, one grid in tier order while filtering, the sticky filter bar's
// removable chips and count, the filter panel's sections, rows, counts and
// 0-options (a plain GET form), old links, the price bands from Settings, "PS
// Plus Deluxe" alone, and the facts and PS Plus games handed to the page script.
// The draft/apply rules are the same module (scripts/test-browse-filter-core.js).
// Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a
// stubbed PS Plus list); the project's games.json and the database are never
// touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4616;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-page-'));
const price = (nt7, nt30, tr7, tr30) => ({ nt_price_7d: nt7, nt_price_30d: nt30, tr_price_7d: tr7, tr_price_30d: tr30 });
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '/uploads/' + id + '.png',
  non_trophy_slots: 1, trophy_slots: 1, renters: 1, created_at: '2020-01-01T00:00:00.000Z'
}, price(349, 799, 399, 899), extra || {});
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
    game(1, 'Zzyzx Astro', { price_category_id: 1, genre: 'Platformer', created_at: new Date().toISOString() }),
    game(2, 'Zzyzx Elden', { price_category_id: 2, genre: 'Action, RPG' }),
    game(3, 'Zzyzx Tekken', { price_category_id: 2, genre: 'Fighting', platform: 'PS4/PS5', ps4_primary_slots: 1 }),
    game(4, 'Zzyzx Callisto', { price_category_id: 3, genre: 'Horror', platform: 'PS4/PS5', non_trophy_slots: 0, trophy_slots: 0, buy_nt_price: 999 }),
    game(5, 'Zzyzx Plain', Object.assign({ platform: 'PS4', description: 'Old </script><b>favourite' }, price(149, 349, 199, 449)))
  ]
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
// The HTML between an element's id and the next element id from `ids`.
function between(html, startId, endId) {
  const i = html.indexOf('id="' + startId + '"');
  assert.ok(i >= 0, startId + ' found');
  const j = endId ? html.indexOf('id="' + endId + '"', i) : html.length;
  return html.slice(i, j);
}
const opening = (html, id) => { const i = html.indexOf('id="' + id + '"'); return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1); };
const cardIds = html => [...html.matchAll(/class="bf-item" data-id="(\d+)"/g)].map(m => Number(m[1]));
// The filter panel's row for an option, and its count.
function optHtml(html, group, value) {
  const m = new RegExp('<label class="bf-opt[^"]*" data-group="' + group + '" data-value="' + value + '">[\\s\\S]*?</label>').exec(html);
  assert.ok(m, 'option ' + group + '/' + value);
  return m[0];
}
const optCount = (html, group, value) => Number(/<span class="bf-n">(\d+)<\/span>/.exec(optHtml(html, group, value))[1]);
const barChips = html => [...between(html, 'bfChips', 'resultsCount').matchAll(/<a class="bf-chip-x" data-group="(\w+)" data-value="([^"]*)" href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(m => ({ group: m[1], value: m[2], href: m[3], label: m[4] }));
const countOf = html => /<span class="results-count" id="resultsCount">([^<]*)<\/span>/.exec(html)[1];
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
  const today = new Date().toISOString();
  require('../lib/psplus-catalog-store').all = () => [
    { key: 'days-gone', name: 'Days Gone', image_url: 'https://image.test/dg.png', platforms: ['PS4'], genres: ['ACTION'], lists: ['catalog'], first_seen_at: '2020-01-01T00:00:00.000Z' },
    { key: 'returnal', name: 'Returnal', image_url: '', platforms: ['PS5'], genres: ['SHOOTER'], lists: ['catalog'], first_seen_at: today },
    { key: 'hidden-one', name: 'Hidden One', platforms: ['PS5'], genres: [], lists: ['catalog'], hidden: true }
  ];
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\nno filter');
  const all = await page('/browse');
  await okAsync('a section per tier in admin order, then Other games, each with its cards', async () => {
    const sec = between(all, 'bfSections', 'bfResults');
    const order = ['cat-section-1', 'cat-section-2', 'cat-section-3', 'cat-section-uncategorized'].map(id => sec.indexOf('id="' + id + '"'));
    assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), JSON.stringify(order));
    assert.deepStrictEqual(cardIds(sec), [1, 2, 3, 4, 5]);
    assert.ok(sec.includes('<p class="cat-desc">Big recent AAA games</p>'));
    assert.ok(!opening(all, 'bfSections').includes('hidden') && opening(all, 'bfResults').includes('hidden'));
  });
  await okAsync('the filter bar: a Filters button, no chips yet, and the count', async () => {
    assert.ok(opening(all, 'bfOpen').includes('href="#bfPanel"') && !opening(all, 'bfOpen').includes('bf-has'));
    assert.deepStrictEqual(barChips(all), []);
    assert.strictEqual(countOf(all), '5 games');
    assert.ok(all.indexOf('id="bfBar"') < all.indexOf('id="bfSections"'), 'above the games');
  });
  await okAsync('the panel: a form with every option the library supports, no Bundles without bundles', async () => {
    const panel = between(all, 'bfPanel', 'bfUpcoming');
    assert.ok(opening(all, 'bfPanel').includes('role="dialog"') && opening(all, 'bfPanel').includes('aria-modal="true"'));
    assert.ok(opening(all, 'bfForm').includes('method="get" action="/browse"'));
    const show = [...panel.matchAll(/data-group="show" data-value="(\w+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(show, ['avail', 'new', 'buy']);
    assert.deepStrictEqual([...panel.matchAll(/<section class="bf-sec" data-group="(\w+)">/g)].map(m => m[1]), ['show', 'tier', 'console', 'genre', 'price']);
    assert.ok(optHtml(all, 'show', 'new').includes('<input type="checkbox" name="new" value="1">'));
    assert.ok(optHtml(all, 'tier', 'psplus').includes('name="psplus" value="1"'));
    assert.ok(optHtml(all, 'genre', 'RPG').includes('name="genre" value="RPG"'));
    assert.strictEqual(optCount(all, 'genre', 'Action'), 2, '"Action, RPG" counts as Action');
    assert.ok(between(all, 'bfGo', 'bfUpcoming').startsWith('id="bfGo">Show 5 games</button>'));
  });
  await okAsync('tier rows show the colour, description and starting price; PS Plus its weekly price', async () => {
    const deluxe = optHtml(all, 'tier', '2');
    assert.ok(deluxe.includes('<span class="tier-dot tier-purple" aria-hidden="true"></span>'));
    assert.ok(deluxe.includes('Deluxe<span class="bf-opt-sub">Big recent AAA games · from ₱249</span>'));
    assert.ok(optHtml(all, 'tier', '3').includes('tier-pink') && optHtml(all, 'tier', '3').includes('<span class="bf-opt-sub">from ₱199</span>'));
    assert.ok(optHtml(all, 'tier', 'psplus').includes('<span class="bf-opt-sub">Hundreds of games, one account · from ₱159/week</span>'));
  });
  await okAsync('price options use the cut-offs from Settings and the card price', async () => {
    assert.ok(optHtml(all, 'price', 'low').includes('Under ₱180<'));
    assert.deepStrictEqual(['low', 'mid', 'high'].map(b => optCount(all, 'price', b)), [1, 3, 1]);
    assert.ok(optHtml(all, 'price', 'mid').includes('₱180–299<'));
  });

  console.log('\nfiltering');
  const f = await page('/browse?tier=2,3&console=ps4');
  await okAsync('one grid of the matches, tier order then A–Z; sections hidden', async () => {
    assert.deepStrictEqual(cardIds(between(f, 'bfGrid', 'bfPsplus')), [3, 4]);
    assert.ok(opening(f, 'bfSections').includes('hidden') && !opening(f, 'bfResults').includes('hidden'));
    assert.ok(opening(f, 'bfUpcoming').includes('hidden') && opening(f, 'bfPsMonthly').includes('hidden'));
    assert.deepStrictEqual(cardIds(f).sort(), [1, 2, 3, 4, 5], 'every card is still on the page once');
  });
  await okAsync('the bar: "Filters · 3", a chip per filter that removes just that one, Clear all, the count', async () => {
    assert.ok(opening(f, 'bfOpen').includes('bf-has') && between(f, 'bfOpenN', 'bfChips').startsWith('id="bfOpenN"> · 3</span>'));
    assert.deepStrictEqual(barChips(f), [
      { group: 'tier', value: '2', href: '/browse?tier=3&amp;console=ps4', label: 'Deluxe ✕' },
      { group: 'tier', value: '3', href: '/browse?tier=2&amp;console=ps4', label: 'Special ✕' },
      { group: 'console', value: 'ps4', href: '/browse?tier=2,3', label: 'PS4 ✕' }
    ]);
    assert.ok(between(f, 'bfChips', 'resultsCount').includes('<a class="bf-clear" href="/browse" data-clear-all="1">Clear all</a>'));
    assert.strictEqual(countOf(f), '2 games');
  });
  await okAsync('the panel starts from the applied filters: ticked, counts if ticked, dimmed 0-options', async () => {
    assert.ok(optHtml(f, 'tier', '2').includes(' checked') && optHtml(f, 'console', 'ps4').includes(' checked'));
    assert.ok(opening(f, 'bfPanel').includes('role="dialog"'));
    assert.strictEqual(optCount(f, 'genre', 'Horror'), 1);
    const plat = optHtml(f, 'genre', 'Platformer');
    assert.ok(plat.includes('bf-opt-zero') && plat.includes(' disabled>'));
    assert.strictEqual(optCount(f, 'console', 'ps5'), 3, 'PS4 or PS5 in Deluxe/Special');
    assert.ok(!between(f, 'bfPanel', 'bfUpcoming').includes('data-clear="tier" hidden'), 'Tier has a Clear');
    assert.ok(between(f, 'bfPanel', 'bfUpcoming').includes('data-clear="genre" hidden'), 'Genre has nothing to clear');
    assert.ok(between(f, 'bfGo', 'bfUpcoming').startsWith('id="bfGo">Show 2 games</button>'));
  });
  await okAsync('old links and the plain form\'s repeated fields keep working', async () => {
    const old = await page('/browse?ps4=1&newOnly=1');
    assert.ok(optHtml(old, 'console', 'ps4').includes(' checked') && optHtml(old, 'show', 'new').includes(' checked'));
    assert.strictEqual(countOf(old), '0 games', 'no PS4 game was just added');
    assert.ok(between(old, 'bfGo', 'bfUpcoming').startsWith('id="bfGo" disabled>No games match</button>'));
    const form = await page('/browse?tier=2&tier=3&console=ps4');
    assert.deepStrictEqual(cardIds(between(form, 'bfGrid', 'bfPsplus')), [3, 4]);
    const gone = await page('/browse?tier=99&genre=Nope');
    assert.ok(!opening(gone, 'bfSections').includes('hidden') && countOf(gone) === '5 games', 'a deleted tier in an old link is dropped');
  });
  await okAsync('a search shows as a removable chip and rides along in the form', async () => {
    const p = await page('/browse?search=elden&genre=Action');
    assert.deepStrictEqual(barChips(p).map(c => c.label), ['Action ✕', '&#34;elden&#34; ✕'], 'shown as "elden" ✕');
    assert.strictEqual(barChips(p)[1].href, '/browse?genre=Action');
    assert.ok(between(p, 'bfPanel', 'bfUpcoming').includes('<input type="hidden" name="search" value="elden">'));
  });

  console.log('\nPS Plus Deluxe');
  await okAsync('the page script gets the PS Plus list, the account price and availability', async () => {
    const d = browseData(all);
    assert.deepStrictEqual(d.psplus.map(p => p.k), ['days-gone', 'returnal'], 'hidden games left out');
    assert.deepStrictEqual(d.psplus[0], { k: 'days-gone', n: 'Days Gone', c: 'https://image.test/dg.png?w=240', ps4: true, ps5: false, g: 'Action', j: false });
    assert.strictEqual(d.psplus[1].j, true, 'joined today = just added');
    assert.deepStrictEqual([d.ctx.psplusFrom, d.ctx.psplusAvail, d.ctx.psplusAvailPs4], [159, true, false]);
    assert.deepStrictEqual(d.ctx.bands, { low: 180, high: 300 });
  });
  await okAsync('"PS Plus Deluxe" alone shows no site games and counts PS Plus games', async () => {
    const p = await page('/browse?psplus=1');
    assert.strictEqual(countOf(p), '2 PS Plus games');
    assert.ok(opening(p, 'bfResults').includes('hidden'));
    assert.strictEqual(optCount(p, 'genre', 'Action'), 1, 'Days Gone');
    assert.ok(between(p, 'bfGo', 'bfUpcoming').startsWith('id="bfGo">Show 2 PS Plus games</button>'));
  });
  await okAsync('a search only PS Plus has says so instead of "No games found"', async () => {
    const p = await page('/browse?search=returnal');
    assert.ok(between(p, 'bfEmpty', 'bfGrid').includes('None of our own games match — but these PS Plus games do.'));
    assert.ok(!opening(p, 'bfEmpty').includes('hidden'));
  });

  console.log('\npage script');
  await okAsync('facts for every game, safely embedded, plus the scripts and styles', async () => {
    const d = browseData(all);
    const elden = d.games.find(g => g.id === 2);
    assert.deepStrictEqual([elden.tier, elden.genres, elden.from, elden.home], ['2', ['Action', 'RPG'], 249, 'cat-2']);
    assert.deepStrictEqual(d.state, { search: '', avail: false, isNew: false, buy: false, bundle: false, tiers: [], psplus: false, consoles: [], genres: [], prices: [] });
    assert.ok(all.includes('\\u003c/script>\\u003cb>favourite'), 'a description cannot close the script');
    assert.ok(d.games.find(g => g.id === 5).text.includes('</script><b>favourite'));
    ['/js/browse-filter-core.js', '/js/browse.js', '/css/browse-filters.css'].forEach(src => assert.ok(all.includes(src + '?v='), src));
    assert.strictEqual((await call('/js/browse.js')).status, 200);
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'browse-filters.css'), 'utf8');
    assert.ok(css.includes('minmax(max(200px, calc((100% - 5rem) / 6)), 1fr)'), 'at most 6 a row');
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

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-browse-page.js` → FAIL `bfSections found` (old page).

- [ ] **Step 3: Create the page script and styles**

Create `public/js/browse.js`:

````js
// Browse filters in the page (views/browse.ejs), using the shared rules in
// public/js/browse-filter-core.js on the facts the server embedded:
//  - the filter panel keeps a draft: ticking only updates the panel's counts and
//    its "Show N games" button; that button applies the draft, closing it any
//    other way throws the draft away;
//  - the sticky filter bar's chips drop one filter at once;
//  - applying moves the existing game cards between their tier sections and the
//    one results grid, draws "Also in PS Plus Deluxe" and keeps the URL in step —
//    no reload.
(function () {
  var C = window.BrowseFilterCore;
  var dataEl = document.getElementById('browseData');
  if (!C || !dataEl) return;
  var data = JSON.parse(dataEl.textContent);
  var games = data.games, psplus = data.psplus, ctx = data.ctx;
  var state = data.state, draft = null, showAllPs = false;
  var $ = function (id) { return document.getElementById(id); };
  var each = function (root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); };
  var copy = function (s) { return JSON.parse(JSON.stringify(s)); };
  var panel = $('bfPanel'), form = $('bfForm');

  var cards = {}, homes = {};
  each(document, '.bf-item[data-id]', function (el) { cards[el.getAttribute('data-id')] = el; });
  each(document, '[data-home]', function (el) { homes[el.getAttribute('data-home')] = el; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── The page for the applied filters ──────────────────────────────────────
  function psCard(p) {
    var cover = p.c
      ? '<img src="' + esc(p.c) + '" alt="' + esc(p.n) + '" class="gc2-cover" loading="lazy" decoding="async">'
      : '<div class="gc2-cover-placeholder"><span>' + esc(p.n) + '</span></div>';
    return '<a href="/ps-plus?game=' + encodeURIComponent(p.k) + '" class="game-card gc2-card bf-ps-card">' + cover +
      '<div class="gc2-scrim"></div><div class="gc2-body"><span class="tier-pill tier-gold">PS Plus</span>' +
      '<div class="gc2-title">' + esc(p.n) + '</div>' +
      '<div class="gc2-price">via PS Plus' + (ctx.psplusFrom ? ' · from <b>₱' + ctx.psplusFrom + '</b>' : '') + '</div></div></a>';
  }
  function renderPsplus(v) {
    $('bfPsplus').hidden = !v.psplusOn;
    if (!v.psplusOn) { $('bfPsGrid').innerHTML = ''; return; }
    var shown = showAllPs ? v.psplus : v.psplus.slice(0, C.PSPLUS_LIMIT);
    $('bfPsGrid').innerHTML = shown.map(psCard).join('');
    $('bfPsCount').textContent = v.psplus.length + ' game' + (v.psplus.length === 1 ? '' : 's');
    $('bfPsAll').hidden = shown.length >= v.psplus.length;
    $('bfPsAll').textContent = 'Show all ' + v.psplus.length;
  }
  function renderBar(v) {
    var chips = C.appliedChips(state, ctx);
    $('bfChips').innerHTML = chips.map(function (c) {
      return '<a class="bf-chip-x" data-group="' + esc(c.group) + '" data-value="' + esc(c.value) + '" href="' + esc(c.href) +
        '" aria-label="Remove ' + esc(c.label) + '">' + esc(c.label) + ' ✕</a>';
    }).join('') + (chips.length >= 2 ? '<a class="bf-clear" href="/browse" data-clear-all="1">Clear all</a>' : '');
    $('bfOpenN').textContent = v.selected ? ' · ' + v.selected : '';
    $('bfOpen').classList.toggle('bf-has', v.selected > 0);
    $('resultsCount').textContent = C.countText(v);
  }
  function render() {
    var v = C.view(games, psplus, state, ctx);
    var inGrid = {};
    if (v.active) v.grid.forEach(function (id) { inGrid[id] = true; $('bfGrid').appendChild(cards[id]); });
    games.forEach(function (f) { if (!inGrid[f.id]) homes[f.home].appendChild(cards[f.id]); });
    $('bfSections').hidden = v.active;
    ['bfUpcoming', 'bfPsMonthly'].forEach(function (id) { if ($(id)) $(id).hidden = v.active; });
    $('bfResults').hidden = !(v.active && v.siteOn);
    $('bfEmpty').hidden = !(v.active && v.siteOn && v.site.length === 0);
    $('bfEmpty').textContent = v.psplus.length ? 'None of our own games match — but these PS Plus games do.' : 'No games found. Try a different filter.';
    renderBar(v);
    renderPsplus(v);
  }
  function go(next) {
    state = next;
    showAllPs = false;
    var q = C.toQuery(state);
    history.replaceState(null, '', '/browse' + (q ? '?' + q : ''));
    render();
  }

  // ── The filter panel (a draft until "Show N games") ───────────────────────
  function renderPanel() {
    var v = C.view(games, psplus, draft, ctx);
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
    draft = Object.assign(C.emptyState(), { search: draft.search });
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
    if (e.target.closest('[data-clear-all]')) { e.preventDefault(); go(C.emptyState()); }
  });
  $('bfPsAll').addEventListener('click', function () { showAllPs = true; render(); });

  // A shared link to #bfPanel (or the no-script fallback) opens it properly.
  if (location.hash === '#bfPanel') {
    history.replaceState(null, '', location.pathname + location.search);
    openPanel();
  }
  render();
})();
````

Create `public/css/browse-filters.css`:

````css
/* Browse: the sticky filter bar, the floating filter panel, the one results
   grid and the PS Plus Deluxe section (views/browse.ejs, public/js/browse.js). */

/* ── Filter bar: sticks just under the 64px menu (nav is z-index 100) ── */
.browse-header h1 { margin-bottom: 1rem; }
.bf-bar { position: sticky; top: 64px; z-index: 90; background: rgba(10,10,10,0.94); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-bottom: 1px solid #1a1a1a; }
.bf-bar-in { max-width: 1400px; margin: 0 auto; padding: 0.6rem 2rem; display: flex; align-items: center; gap: 0.5rem; }
.bf-open { flex-shrink: 0; display: inline-flex; align-items: center; background: #141414; border: 1px solid #2a2a2a; border-radius: 20px; color: #fff; font-size: 0.82rem; font-weight: 700; padding: 0.45rem 0.95rem; text-decoration: none; }
.bf-open:hover { border-color: #444; }
.bf-open.bf-has { border-color: var(--ps-blue); color: var(--ps-blue); }
.bf-chips { flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.4rem; overflow-x: auto; scrollbar-width: none; }
.bf-chips::-webkit-scrollbar { display: none; }
.bf-chip-x { flex-shrink: 0; white-space: nowrap; background: rgba(240,165,0,0.12); color: var(--ps-blue); border: 1px solid rgba(240,165,0,0.35); border-radius: 20px; padding: 0.3rem 0.7rem; font-size: 0.76rem; font-weight: 700; text-decoration: none; }
.bf-chip-x:hover { background: rgba(240,165,0,0.2); }
.bf-clear { flex-shrink: 0; white-space: nowrap; color: #888; font-size: 0.76rem; text-decoration: underline; }
.bf-bar .results-count { flex-shrink: 0; margin: 0 0 0 auto; white-space: nowrap; }
@media (max-width: 600px) { .bf-bar-in { padding: 0.5rem 1rem; } }

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

/* ── Results ── */
.cat-head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
.cat-count { font-size: 0.78rem; color: var(--text-secondary); background: #111; border: 1px solid #222; border-radius: 20px; padding: 0.2rem 0.65rem; }
.cat-desc { margin: -1rem 0 1.25rem; color: var(--text-secondary); font-size: 0.85rem; }
.bf-empty { text-align: center; padding: 2rem 1rem; color: var(--text-secondary); }
.bf-ps-sub { font-size: 0.8rem; color: var(--text-secondary); }
.bf-ps-all { margin-top: 1rem; }
.bf-ps-card .gc2-cover-placeholder span { padding: 0 0.75rem; text-align: center; opacity: 0.8; }

/* At most 6 cards a row; phones keep style.css's 2 columns (≤ 600px). */
@media (min-width: 601px) {
  .browse-page .games-grid { grid-template-columns: repeat(auto-fill, minmax(max(200px, calc((100% - 5rem) / 6)), 1fr)); }
}
````

Create `views/partials/browse-filter-option.ejs`:

````ejs
<%# One tick-box row in the Browse filter panel (views/browse.ejs): an option's
    name (tiers: coloured dot and a line with description and starting price),
    what it would show, and its tick box (a GET form field). %>
<label class="bf-opt<%= c.zero ? ' bf-opt-zero' : '' %>" data-group="<%= c.group %>" data-value="<%= c.value %>">
  <% if (tr) { %><span class="tier-dot tier-<%= tr.color %>" aria-hidden="true"></span><% } %>
  <span class="bf-opt-name"><%= c.label %><% if (tr && tr.sub) { %><span class="bf-opt-sub"><%= tr.sub %></span><% } %></span>
  <span class="bf-n"><%= c.count %></span>
  <input type="checkbox" name="<%= ff.name %>" value="<%= ff.value %>"<%= c.on ? ' checked' : '' %><%= c.zero ? ' disabled' : '' %>>
</label>
````

- [ ] **Step 4: Apply the server and template edits**

Create `.superpowers/tmp-edits/browse.ejs` (the new `views/browse.ejs`; the script writes it with the file's CRLF + BOM):

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
  Filters, layout and the PS Plus section follow
  docs/superpowers/specs/2026-10-09-browse-filters-tiers-design.md. The server
  renders the page for the URL (GET /browse); public/js/browse.js then runs the
  filter panel and the filter bar with the same rules
  (public/js/browse-filter-core.js), moving these same cards between their tier
  sections and the one results grid.
%>
<div class="browse-header">
  <h1>Browse Games</h1>
</div>

<!-- FILTER BAR — sticky under the menu: open the panel, drop a filter, the count -->
<div class="bf-bar" id="bfBar">
  <div class="bf-bar-in">
    <a href="#bfPanel" class="bf-open<%= view.selected ? ' bf-has' : '' %>" id="bfOpen" aria-haspopup="dialog" aria-controls="bfPanel">Filters<span id="bfOpenN"><%= view.selected ? ' · ' + view.selected : '' %></span></a>
    <div class="bf-chips" id="bfChips">
      <% applied.forEach(c => { %><a class="bf-chip-x" data-group="<%= c.group %>" data-value="<%= c.value %>" href="<%= c.href %>" aria-label="Remove <%= c.label %>"><%= c.label %> ✕</a><% }) %>
      <% if (applied.length >= 2) { %><a class="bf-clear" href="/browse" data-clear-all="1">Clear all</a><% } %>
    </div>
    <span class="results-count" id="resultsCount"><%= countText %></span>
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
      <% if (search) { %><input type="hidden" name="search" value="<%= search %>"><% } %>
      <% view.groups.forEach(gr => { const extra = gr.chips.slice(6); %>
      <section class="bf-sec" data-group="<%= gr.key %>">
        <div class="bf-sec-head">
          <h3><%= gr.label %></h3>
          <button type="button" class="bf-sec-clear" data-clear="<%= gr.key %>"<%= gr.chips.some(c => c.on) ? '' : ' hidden' %>>Clear</button>
        </div>
        <% gr.chips.slice(0, 6).forEach(c => { %><%- include('partials/browse-filter-option', { c, ff: formField(c.group, c.value), tr: gr.key === 'tier' ? tierRows[c.value] : null }) %><% }) %>
        <% if (extra.length) { %>
        <details class="bf-more"<%= extra.some(c => c.on) ? ' open' : '' %>>
          <summary>Show all <%= gr.chips.length %></summary>
          <% extra.forEach(c => { %><%- include('partials/browse-filter-option', { c, ff: formField(c.group, c.value), tr: gr.key === 'tier' ? tierRows[c.value] : null }) %><% }) %>
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

<!-- UPCOMING GAMES — hidden while filtering -->
<div id="bfUpcoming"<%= view.active ? ' hidden' : '' %>>
<%- include('partials/upcoming-section', { upcoming, noBorderTop: true }) %>
</div>

<div id="section-rentals">
  <!-- No filter on: a section per tier (Bundles, tiers in admin order, Other games) -->
  <div id="bfSections"<%= view.active ? ' hidden' : '' %>>
    <% sections.forEach((s, si) => { %>
    <div class="section cat-section" id="cat-section-<%= s.key === 'other' ? 'uncategorized' : s.key.replace('cat-', '') %>" style="<%= si > 0 || upcoming.length > 0 ? 'padding-top:3rem;' : 'padding-top:2rem;' %>">
      <div class="cat-head">
        <h2 class="section-title" style="margin:0;"><%= s.title %></h2>
        <span class="cat-count"><%= s.count %> <%= s.unit %><%= s.count !== 1 ? 's' : '' %></span>
        <% if (s.from) { %><span class="cat-price-start">🎮 Price Starts at ₱<%= s.from %></span><% } %>
      </div>
      <% if (s.description) { %><p class="cat-desc"><%= s.description %></p><% } %>
      <div class="games-grid rentals-grid" data-home="<%= s.key %>">
        <% (homeIds[s.key] || []).forEach(id => { %><div class="bf-item" data-id="<%= id %>"><%- include('partials/game-card', { game: gamesById[id] }) %></div><% }) %>
      </div>
    </div>
    <% }) %>
  </div>

  <!-- Any filter on: every match in one grid, tier order then A–Z -->
  <div class="section" id="bfResults"<%= view.active && view.siteOn ? '' : ' hidden' %>>
    <p class="bf-empty" id="bfEmpty"<%= view.active && view.siteOn && view.site.length === 0 ? '' : ' hidden' %>><%= view.psplus.length ? 'None of our own games match — but these PS Plus games do.' : 'No games found. Try a different filter.' %></p>
    <div class="games-grid rentals-grid" id="bfGrid">
      <% view.grid.forEach(id => { %><div class="bf-item" data-id="<%= id %>"><%- include('partials/game-card', { game: gamesById[id] }) %></div><% }) %>
    </div>
  </div>

  <!-- Also in PS Plus Deluxe — drawn by public/js/browse.js while filtering -->
  <div class="section" id="bfPsplus" hidden>
    <div class="cat-head">
      <h2 class="section-title" style="margin:0;">Also in PS Plus Deluxe</h2>
      <span class="cat-count" id="bfPsCount"></span>
      <span class="bf-ps-sub">One account, play them all</span>
    </div>
    <div class="games-grid rentals-grid" id="bfPsGrid"></div>
    <button type="button" class="btn btn-outline bf-ps-all" id="bfPsAll" hidden></button>
  </div>
</div>

<!-- PS PLUS MONTHLY GAMES — hidden while filtering -->
<div id="bfPsMonthly"<%= view.active ? ' hidden' : '' %>>
<% if (psplus.length > 0) { %>
<div class="section" id="section-psplus" style="padding-top:3rem;">
  <h2 class="section-title" style="display:flex;align-items:center;gap:0.6rem;">
    <span style="background:linear-gradient(135deg,#FFD700,#ffa500);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">★</span>
    PS Plus Deluxe — Monthly Games
    <a href="/ps-plus" style="font-size:0.8rem;font-weight:500;color:var(--ps-blue);text-decoration:none;margin-left:0.5rem;">View Full Page →</a>
  </h2>
  <p style="color:var(--text-secondary);font-size:0.85rem;margin:-0.5rem 0 1.5rem;">Access these games anytime through a PS Plus Deluxe account rental.</p>
  <div id="psplus-entries">
  <% psplus.forEach(entry => { %>
    <%
      const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
      const mName = monthNames[entry.month] || '';
      const gamesList = (entry.games_list || '').split('\n').map(g => g.trim()).filter(Boolean);
    %>
    <a href="/game/ps-plus-deluxe" class="psplus-browse-entry" data-games="<%= gamesList.join('|').toLowerCase() %>" data-month="<%= mName.toLowerCase() %> <%= entry.year %>" style="text-decoration:none;color:inherit;display:block;">
      <div class="psplus-browse-header">
        <% if (entry.cover_image) { %>
          <img src="<%= entry.cover_image %>" alt="<%= mName %> <%= entry.year %>" class="psplus-browse-cover-wide" loading="lazy" decoding="async">
        <% } else { %>
          <div class="psplus-browse-cover-wide psplus-browse-cover-placeholder" style="display:flex;align-items:center;justify-content:center;">
            <span style="font-size:1.5rem;">★</span>
          </div>
        <% } %>
        <div>
          <div style="font-weight:700;font-size:1rem;color:#FFD700;"><%= mName %> <span style="color:#888;"><%= entry.year %></span></div>
          <div style="font-size:0.75rem;color:#555;margin-top:0.2rem;"><%= gamesList.length %> game<%= gamesList.length !== 1 ? 's' : '' %></div>
          <% if (entry.notes) { %><div style="font-size:0.75rem;color:#666;margin-top:0.15rem;"><%= entry.notes %></div><% } %>
        </div>
        <span class="btn btn-outline" style="margin-left:auto;padding:0.3rem 0.85rem;font-size:0.78rem;white-space:nowrap;">Rent Access →</span>
      </div>
      <div class="psplus-browse-games">
        <% gamesList.forEach(g => { %>
          <span class="psplus-browse-game-tag"><%= g %></span>
        <% }) %>
      </div>
    </a>
  <% }) %>
  </div>
</div>
<% } %>
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

Create `.superpowers/tmp-edits/edit-bt-browse.js`:

````js
// The Browse page: new GET /browse, its game facts and PS Plus data, and the
// new views/browse.ejs (run from the repo root; browse.ejs sits next to this
// script).
const fs = require('fs');
const path = require('path');
const rep = require('./rep');

// ── server.js: replace the old filter function and route ─────────────────────
rep.between('server.js', 'function applyBrowseFilters(games, state, accountSummaryMap) {', '// ── Game Detail Page ──', `// ── Browse ───────────────────────────────────────────────────────────────────
// The filter rules live in public/js/browse-filter-core.js, shared with the
// page script (public/js/browse.js); this builds the facts they read.
// See docs/superpowers/specs/2026-10-09-browse-filters-tiers-design.md.
function browseGameFacts(g, accountSummaryMap, promo) {
  const a = computeAvailability(g, accountSummaryMap[g.id]);
  const bundle = resolveBundleInfo(g);
  const cat = g.price_category_id ? getPriceCategory(g.price_category_id) : null;
  // The card's "from ₱X" (views/partials/game-card.ejs): the cheapest final price
  // across Weekly/Monthly × Non-Trophy/Trophy, after the game's own discount or
  // the site promo.
  const finals = [[g.nt_price_7d, 7], [g.nt_price_30d, 30], ...(a.hasTrophy ? [[g.tr_price_7d, 7], [g.tr_price_30d, 30]] : [])]
    .filter(([base]) => base > 0)
    .map(([base, d]) => gameDiscount.applyPct(base, gameDiscount.discountPct(g, d, promo)));
  return {
    id: g.id,
    title: g.title,
    text: [g.title, g.description || ''].concat(bundle ? bundle.games.map(b => b.title) : []).join('\\n').toLowerCase(),
    tier: cat ? String(cat.id) : null,
    ps4: g.platform === 'PS4' || g.platform === 'PS4/PS5',
    ps5: g.platform === 'PS5' || g.platform === 'PS4/PS5',
    genres: browseCore.genreParts(g.genre),
    from: finals.length ? Math.min(...finals) : null,
    avail: !!(a.trAvail || a.ntAvail || (a.showPs4 && a.ps4Avail)),
    availPs4: !!(a.showPs4 && a.ps4Avail),
    isNew: isAddedThisMonth(g),
    buy: (g.buy_nt_price || 0) > 0 || (g.buy_tr_price || 0) > 0,
    bundle: !!g.is_bundle,
    home: bundle ? 'bundles' : (cat ? 'cat-' + cat.id : 'other')
  };
}

// The PS Plus page's "from ₱X / week": the cheaper weekly PS Plus price.
function psplusFromWeekly() {
  const p = getPsplusPrices() || {};
  const weekly = [p.nt_price_7d, p.tr_price_7d].map(Number).filter(n => n > 0);
  return weekly.length ? Math.min(...weekly) : 0;
}

// Browse's "Also in PS Plus Deluxe" section: the games the /ps-plus page lists,
// and whether the PS Plus Deluxe account has a slot free. A catalogue that has
// not loaded simply gives no PS Plus games.
const PSPLUS_JUST_ADDED_DAYS = 11;
function browsePsplusData(accountSummaryMap) {
  let items = [];
  try {
    const catalog = psplusCatalogView.buildPublicCatalog({
      games: psplusCatalogStore.all(), siteGames: getGames(), entries: getPsplus(), slugFor: gameSlug, monthlyCovers: psplusMonthlyCoversStore.all()
    });
    const since = new Date(Date.now() - PSPLUS_JUST_ADDED_DAYS * 86400000).toISOString().slice(0, 10);
    items = catalog.items.map(it => ({
      k: it.k, n: it.n, c: it.c || (it.i ? it.i + '?w=240' : ''),
      ps4: (it.p || []).includes('PS4'), ps5: (it.p || []).includes('PS5'), g: it.g || '', j: !!it.f && it.f >= since
    }));
  } catch (e) {
    console.error('[browse] PS Plus list', e.message);
  }
  const psGame = getGames().find(g => /ps plus deluxe|playstation plus deluxe/i.test(g.title));
  let avail, availPs4;
  if (psGame) {
    const a = computeAvailability(psGame, accountSummaryMap[psGame.id]);
    avail = !!(a.trAvail || a.ntAvail || (a.showPs4 && a.ps4Avail));
    availPs4 = !!(a.showPs4 && a.ps4Avail);
  } else {
    const sl = getPsplusSlots();
    avail = (sl.nt_slots || 0) + (sl.tr_slots || 0) + (sl.ps4_slots || 0) > 0;
    availPs4 = (sl.ps4_slots || 0) > 0;
  }
  return { items, from: psplusFromWeekly(), avail, availPs4 };
}

app.get('/browse', (req, res) => {
  const browseSettings = getSiteSettings();
  const promo = browseSettings.promo;
  const accountSummaryMap = buildAccountSummaryMap();
  const allGames = getGames().map(resolveGamePrices).map(resolveSlotDays)
    .sort((a, b) => a.title.localeCompare(b.title));
  const priceCategories = getPriceCategories();
  const facts = allGames.map(g => browseGameFacts(g, accountSummaryMap, promo));
  const ps = browsePsplusData(accountSummaryMap);
  const ctx = {
    bands: getBrowseBands(),
    tiers: priceCategories.map(c => ({ id: String(c.id), name: c.name })),
    genres: browseCore.genreList(facts),
    psplusFrom: ps.from, psplusAvail: ps.avail, psplusAvailPs4: ps.availPs4
  };
  const state = browseCore.cleanState(browseCore.parseState(req.query), ctx);
  const view = browseCore.view(facts, ps.items, state, ctx);

  // The unfiltered sections: Bundles, each tier in admin order, Other games —
  // only those with games. Every card has one home section; while filtering,
  // the matches sit in the one grid instead.
  const byHome = {};
  facts.forEach(f => { (byHome[f.home] = byHome[f.home] || []).push(f); });
  const minFrom = list => { const p = list.map(f => f.from).filter(n => n > 0); return p.length ? Math.min(...p) : null; };
  const sections = [{ key: 'bundles', title: 'Account Bundles', unit: 'bundle' }]
    .concat(priceCategories.map(c => ({ key: 'cat-' + c.id, title: c.name, description: c.description || '', color: tierStyle.pillColor(c), unit: 'game' })))
    .concat([{ key: 'other', title: 'Other Games', unit: 'game' }])
    .filter(s => byHome[s.key])
    .map(s => Object.assign(s, { count: byHome[s.key].length, from: s.key === 'bundles' ? null : minFrom(byHome[s.key]) }));
  const inGrid = new Set(view.grid);
  const homeIds = {};
  facts.forEach(f => { if (!inGrid.has(f.id)) (homeIds[f.home] = homeIds[f.home] || []).push(f.id); });
  // The filter panel's tier rows: coloured dot, description and starting price.
  const tierRows = {};
  priceCategories.forEach(c => {
    const sec = sections.find(s => s.key === 'cat-' + c.id);
    tierRows[String(c.id)] = { color: tierStyle.pillColor(c), sub: [c.description || '', sec && sec.from ? 'from ₱' + sec.from : ''].filter(Boolean).join(' · ') };
  });
  tierRows.psplus = { color: 'gold', sub: 'Hundreds of games, one account' + (ps.from ? ' · from ₱' + ps.from + '/week' : '') };
  const gamesById = {};
  allGames.forEach(g => { gamesById[g.id] = g; });

  const upcoming = sortUpcoming(getUpcoming()).map(resolveUpcomingSlots);
  const psplus = [...getPsplus()].sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month);
  res.render('browse', {
    view, sections, homeIds, gamesById, tierRows,
    applied: browseCore.appliedChips(state, ctx), countText: browseCore.countText(view),
    applyLabel: browseCore.applyLabel(view), formField: browseCore.formField, search: state.search,
    browseData: { games: facts, psplus: ps.items, ctx, state },
    upcoming, psplus, priceCategories,
    announcement: getAnnouncement(), announcements: getAnnouncements(),
    settings: browseSettings, promo, accountSummaryMap
  });
});

`);

// /ps-plus shows the same weekly "from" price the Browse PS Plus cards use.
rep('server.js', `  const weeklyPrices = [(getPsplusPrices() || {}).nt_price_7d, (getPsplusPrices() || {}).tr_price_7d].map(Number).filter(n => n > 0);
  const fromWeekly = weeklyPrices.length ? Math.min(...weeklyPrices) : 0;
`, `  const fromWeekly = psplusFromWeekly();
`);

// ── views/browse.ejs ─────────────────────────────────────────────────────────
rep.put('views/browse.ejs', fs.readFileSync(path.join(__dirname, 'browse.ejs'), 'utf8'));
console.log('edited');
````

Run: `node .superpowers/tmp-edits/edit-bt-browse.js` → `edited`.
Then: `node --check server.js && file server.js views/browse.ejs` → both still UTF-8 with BOM and CRLF.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-browse-page.js` → `15 assertions passed`.
Run: `node scripts/test-browse-filter-core.js && node scripts/test-tier-pill.js && node scripts/test-admin-price-bands.js && node scripts/test-game-discount-pricing.js && node scripts/test-home-search.js` → all pass.

- [ ] **Step 6: Commit**

```bash
git add public/js/browse.js public/css/browse-filters.css views/partials/browse-filter-option.ejs scripts/test-browse-page.js server.js views/browse.ejs
git commit -m "Browse: floating filter panel and sticky filter bar, one 6-per-row grid while filtering, tier descriptions, PS Plus Deluxe in results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Full regression and cleanup

**Files:** none changed.

- [ ] **Step 1: Run every test file and list failures**

```bash
fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail of $(ls scripts/test-*.js | wc -l)"
```
Expected: only `FAIL scripts/test-requests-page.js`, `failed: 1 of 99`.

- [ ] **Step 2: Remove the scratch scripts and check the tree**

```bash
rm -rf .superpowers/tmp-edits && git status --short
```
Expected: no output except possibly the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.

Do not push; tell the owner it is ready: Admin → Games → Price Categories to set each tier's pill colour and description; Admin → Settings → Browse price filter for the Price chips.
