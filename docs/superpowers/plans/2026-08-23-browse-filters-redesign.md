# Browse Filters Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/browse`'s four dropdowns with grouped filter chips (Show / Console / Genre) carrying live, never-zero result counts, including the "Available now" filter the page has never had.

**Architecture:** One shared filter function in `server.js` applies a given filter-state object to the game list; the route calls it once for the actual page results, then once per candidate chip (with that one chip's flag flipped) to compute that chip's count. `views/browse.ejs` renders whichever chips have a nonzero count as plain `<a>` links carrying the full query string — no client-side filtering, no JS dependency.

**Tech Stack:** Node/Express, EJS, plain CSS. No new dependencies.

## Global Constraints

- New query params: `avail=1`, `buy=1`, `bundle=1`, `ps4=1`. Kept unchanged: `genre=<name>`, `newOnly=1`, `search=<text>`.
- Backward compatibility for old bookmarked URLs: `platform=PS4` → treated as `ps4=1`; `platform=PS5`/`platform=PS4/PS5` → ignored (no chip ever produces these, and they matched almost every game); `unit=ps4` → treated as `avail=1&ps4=1`; `unit=ps5` → treated as `avail=1`.
- "Available now" is console-aware: with no console chip active it means "any of trophy/non-trophy/PS4 slots open" (`avail.trAvail || avail.ntAvail || (avail.showPs4 && avail.ps4Avail)`); with `ps4=1` active it means specifically `avail.showPs4 && avail.ps4Avail`.
- No PS5 console chip — it matched 54 of 55 games and is intentionally omitted.
- A genre only renders as a chip if at least 3 games in the **unfiltered** library carry it — the threshold is computed once against all games, not against the currently filtered set.
- Every chip's count is computed as if that one chip were toggled on, combined with every other **currently active** filter (Show chips other than itself, Console, Genre) — never combined with its own current state. A chip whose resulting count is 0 is not rendered.
- No chip may ever show `· 0`. No filter combination reachable by tapping a rendered chip may return zero results.
- Filtering happens entirely server-side via plain links; the page must produce correct, complete results with JavaScript disabled.
- The Coming Soon section's gating condition must be updated to the new full parameter set, or it will incorrectly reappear under filtered results.

---

### Task 1: Shared filter function and updated `/browse` route

**Files:**
- Modify: `server.js` (the `GET /browse` handler, currently at the line containing `app.get('/browse', (req, res) => {`)

**Interfaces:**
- Consumes: `getGames`, `resolveGamePrices`, `resolveSlotDays`, `resolveBundleInfo`, `computeAvailability`, `buildAccountSummaryMap`, `isAddedThisMonth`, `sortUpcoming`, `getUpcoming`, `resolveUpcomingSlots`, `getPsplus`, `getPriceCategories`, `getSiteSettings`, `getAnnouncement`, `getAnnouncements` — all already defined elsewhere in `server.js`, unchanged.
- Produces: `applyBrowseFilters(games, state, accountSummaryMap)` — a new module-scope function taking the full games array, a filter-state object `{ avail, buy, bundle, ps4, genre, newOnly, search }` (each boolean except `genre`/`search`, which are strings or `''`), and the account summary map; returns the filtered array. Task 1's route calls this to build the page's own results; the chip-count computation added at the end of this task also calls it. No other task depends on this function's name or shape — this is the plan's only task touching `server.js`.

- [ ] **Step 1: Write `applyBrowseFilters`**

In `server.js`, find:

```js
app.get('/browse', (req, res) => {
  const { search, platform, genre, unit, newOnly } = req.query;
  const accountSummaryMap = buildAccountSummaryMap();
  let games = getGames().map(resolveGamePrices).map(resolveSlotDays);
  if (search) {
    const q = search.toLowerCase();
    // A bundle also matches on the titles it contains, so searching a game that's
    // only inside the bundle still surfaces it here as well as in the nav search.
    const bundleContains = (g) => {
      const b = resolveBundleInfo(g);
      return b ? b.games.some(bg => bg.title.toLowerCase().includes(q)) : false;
    };
    games = games.filter(g =>
      g.title.toLowerCase().includes(q) ||
      (g.description && g.description.toLowerCase().includes(q)) ||
      bundleContains(g)
    );
  }
  if (platform) games = games.filter(g => g.platform === platform || g.platform === 'PS4/PS5');
  if (genre) games = games.filter(g => g.genre === genre);
  // Availability-by-unit filter: PS4 = has an open PS4 Primary slot;
  // PS5 = has an open Trophy or Non-Trophy slot, regardless of PS4 Primary status.
  if (unit === 'ps4' || unit === 'ps5') {
    games = games.filter(g => {
      const avail = computeAvailability(g, accountSummaryMap[g.id]);
      return unit === 'ps4' ? (avail.showPs4 && avail.ps4Avail) : (avail.trAvail || avail.ntAvail);
    });
  }
  // Same 11-day "new" window as the site-wide NEW badge (isAddedThisMonth, server.js).
  if (newOnly === '1') games = games.filter(isAddedThisMonth);
  games.sort((a, b) => a.title.localeCompare(b.title));
  const genres = [...new Set(getGames().map(g => g.genre).filter(Boolean))].sort();
  const upcoming = sortUpcoming(getUpcoming()).map(resolveUpcomingSlots);
  // PS Plus monthly entries sorted newest first
  const psplus = [...getPsplus()].sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month);
  const priceCategories = getPriceCategories();
  const browseSettings = getSiteSettings();
  res.render('browse', { games, search: search || '', platform: platform || '', genre: genre || '', unit: unit || '', newOnly: newOnly || '', genres, upcoming, psplus, priceCategories, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: browseSettings, promo: browseSettings.promo, accountSummaryMap });
});
```

Replace the entire block with:

```js
// Applies the Browse page's filter state to a games array. Shared by the route's
// own result set and by the per-chip count computation below it, so there is
// exactly one implementation of what each filter means — the alternative (one
// copy for "what results show" and a second copy for "what count each chip
// displays") is exactly the kind of duplicated-logic bug that has already
// shipped twice this session (Coming Soon slot counts, a filter script split
// from its markup).
function applyBrowseFilters(games, state, accountSummaryMap) {
  let out = games;
  if (state.search) {
    const q = state.search.toLowerCase();
    const bundleContains = (g) => {
      const b = resolveBundleInfo(g);
      return b ? b.games.some(bg => bg.title.toLowerCase().includes(q)) : false;
    };
    out = out.filter(g =>
      g.title.toLowerCase().includes(q) ||
      (g.description && g.description.toLowerCase().includes(q)) ||
      bundleContains(g)
    );
  }
  if (state.ps4) out = out.filter(g => g.platform === 'PS4' || g.platform === 'PS4/PS5');
  if (state.genre) out = out.filter(g => g.genre === state.genre);
  if (state.avail) {
    out = out.filter(g => {
      const avail = computeAvailability(g, accountSummaryMap[g.id]);
      // Console-aware: a PS4 owner cannot use a free PS5 trophy/non-trophy slot,
      // so with the PS4 chip active, "available" must mean PS4 Primary is open —
      // not "available on some slot type this customer cannot use."
      return state.ps4 ? (avail.showPs4 && avail.ps4Avail) : (avail.trAvail || avail.ntAvail || (avail.showPs4 && avail.ps4Avail));
    });
  }
  if (state.buy) out = out.filter(g => (g.buy_nt_price || 0) > 0 || (g.buy_tr_price || 0) > 0);
  if (state.bundle) out = out.filter(g => !!g.is_bundle);
  if (state.newOnly) out = out.filter(isAddedThisMonth);
  return out;
}

app.get('/browse', (req, res) => {
  const search = req.query.search || '';
  const genre = req.query.genre || '';
  const newOnly = req.query.newOnly === '1';
  // Backward compatibility for bookmarks/links using the old dropdown params.
  // platform=PS5 / platform=PS4/PS5 is dropped entirely — no chip ever produces
  // it, and it matched 54 of 55 games, carrying no real filtering information.
  const legacyUnit = req.query.unit;
  const avail = req.query.avail === '1' || legacyUnit === 'ps4' || legacyUnit === 'ps5';
  const ps4 = req.query.ps4 === '1' || req.query.platform === 'PS4' || legacyUnit === 'ps4';
  const buy = req.query.buy === '1';
  const bundle = req.query.bundle === '1';

  const accountSummaryMap = buildAccountSummaryMap();
  const allGames = getGames().map(resolveGamePrices).map(resolveSlotDays);
  const state = { search, genre, newOnly, avail, ps4, buy, bundle };

  let games = applyBrowseFilters(allGames, state, accountSummaryMap);
  games.sort((a, b) => a.title.localeCompare(b.title));

  // Per-chip counts: each computed with that one chip's flag flipped on, every
  // other currently-active filter left as-is, and never combined with its own
  // current state — this is what keeps a selected filter switchable instead of
  // making every other option in its own group collapse to zero.
  function countWith(overrides) {
    return applyBrowseFilters(allGames, Object.assign({}, state, overrides), accountSummaryMap).length;
  }
  const showChips = [
    { key: 'avail', label: 'Available now', href: 'avail=1', count: countWith({ avail: true }) },
    { key: 'newOnly', label: 'New', href: 'newOnly=1', count: countWith({ newOnly: true }) },
    { key: 'buy', label: 'Can buy', href: 'buy=1', count: countWith({ buy: true }) },
    { key: 'bundle', label: 'Bundles', href: 'bundle=1', count: countWith({ bundle: true }) }
  ].filter(c => c.count > 0);
  const consoleChips = [
    { key: 'ps4', label: 'Plays on PS4', href: 'ps4=1', count: countWith({ ps4: true }) }
  ].filter(c => c.count > 0);
  // A genre only ever appears if the UNFILTERED library has at least 3 games in
  // it — computed once against allGames, not against the currently filtered
  // set, so the chip list doesn't shrink further as other filters are applied.
  const genreCounts = {};
  allGames.forEach(g => { if (g.genre) genreCounts[g.genre] = (genreCounts[g.genre] || 0) + 1; });
  const eligibleGenres = Object.keys(genreCounts).filter(g => genreCounts[g] >= 3).sort();
  const genreChips = eligibleGenres.map(g => ({
    key: 'genre', label: g, href: 'genre=' + encodeURIComponent(g),
    // Counted against every active filter except genre itself, so switching
    // between genres stays possible rather than every other genre reading 0
    // once one is selected.
    count: countWith({ genre: g })
  })).filter(c => c.count > 0);

  const upcoming = sortUpcoming(getUpcoming()).map(resolveUpcomingSlots);
  const psplus = [...getPsplus()].sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month);
  const priceCategories = getPriceCategories();
  const browseSettings = getSiteSettings();
  const anyFilterActive = !!(search || genre || newOnly || avail || ps4 || buy || bundle);
  res.render('browse', {
    games, search, genre, newOnly, avail, ps4, buy, bundle, anyFilterActive,
    showChips, consoleChips, genreChips,
    upcoming, psplus, priceCategories,
    announcement: getAnnouncement(), announcements: getAnnouncements(),
    settings: browseSettings, promo: browseSettings.promo, accountSummaryMap
  });
});
```

- [ ] **Step 2: Verify the route still starts and behaves on a few URLs**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -c server.js && echo SYNTAX_OK
```

Expected: `SYNTAX_OK`

- [ ] **Step 3: Verify chip counts and backward compatibility against the real deployed data**

This app has no local dev server with real data (established this session — `games.json` locally is a stale 12-game fixture; production has 55). Verification of the actual numbers happens live in Task 3. For now, confirm the function is syntactically sound and self-consistent:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
function isAddedThisMonth(g) { return !!g._new; }
function computeAvailability(g) {
  return { trAvail: (g.trophy_slots||0) > 0, ntAvail: (g.non_trophy_slots||0) > 0, showPs4: g.platform !== 'PS5', ps4Avail: (g.ps4_primary_slots||0) > 0 };
}
function resolveBundleInfo() { return null; }
function buildAccountSummaryMap() { return {}; }

function applyBrowseFilters(games, state, accountSummaryMap) {
  let out = games;
  if (state.search) {
    const q = state.search.toLowerCase();
    out = out.filter(g => g.title.toLowerCase().includes(q));
  }
  if (state.ps4) out = out.filter(g => g.platform === 'PS4' || g.platform === 'PS4/PS5');
  if (state.genre) out = out.filter(g => g.genre === state.genre);
  if (state.avail) {
    out = out.filter(g => {
      const avail = computeAvailability(g, accountSummaryMap[g.id]);
      return state.ps4 ? (avail.showPs4 && avail.ps4Avail) : (avail.trAvail || avail.ntAvail || (avail.showPs4 && avail.ps4Avail));
    });
  }
  if (state.buy) out = out.filter(g => (g.buy_nt_price || 0) > 0 || (g.buy_tr_price || 0) > 0);
  if (state.bundle) out = out.filter(g => !!g.is_bundle);
  if (state.newOnly) out = out.filter(isAddedThisMonth);
  return out;
}

const games = [
  { title: 'A', platform: 'PS5', trophy_slots: 1, non_trophy_slots: 0, ps4_primary_slots: 0, genre: 'Action' },
  { title: 'B', platform: 'PS4/PS5', trophy_slots: 0, non_trophy_slots: 0, ps4_primary_slots: 1, genre: 'Action' },
  { title: 'C', platform: 'PS4', trophy_slots: 0, non_trophy_slots: 0, ps4_primary_slots: 0, genre: 'Racing' }
];

// With no console chip, 'A' and 'B' are available (2). With ps4=1, only 'B' is (its PS4 slot is open; 'A' has no PS4 slots at all since PS5-only games have showPs4=false).
console.log('avail only:', applyBrowseFilters(games, { avail: true }, {}).map(g=>g.title).join(','), '(expect A,B)');
console.log('avail+ps4:', applyBrowseFilters(games, { avail: true, ps4: true }, {}).map(g=>g.title).join(','), '(expect B)');
console.log('genre Racing:', applyBrowseFilters(games, { genre: 'Racing' }, {}).map(g=>g.title).join(','), '(expect C)');
"
```

Expected output lines match the `(expect ...)` annotations exactly.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add server.js
git commit -m "Rework /browse into filter chips with live counts, server-side"
```

---

### Task 2: Chip markup in `views/browse.ejs`, and CSS

**Files:**
- Modify: `views/browse.ejs` (the `<form class="filters">` block, and the Coming Soon gating condition)
- Modify: `public/css/style.css` (new chip styles)

**Interfaces:**
- Consumes: `showChips`, `consoleChips`, `genreChips` (each an array of `{ key, label, href, count }`), `anyFilterActive` (boolean), `search`, `genre`, `newOnly`, `avail`, `ps4`, `buy`, `bundle` — all produced by Task 1's route.
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Replace the filter form**

In `views/browse.ejs`, find:

```ejs
<div class="browse-header">
  <h1>Browse Games</h1>
  <form class="filters" method="GET" action="/browse">
    <% if (search) { %><input type="hidden" name="search" value="<%= search %>"><% } %>
    <select class="filter-select" name="platform" onchange="this.form.submit()">
      <option value="">All Platforms</option>
      <option value="PS5" <%= platform === 'PS5' ? 'selected' : '' %>>PS5</option>
      <option value="PS4" <%= platform === 'PS4' ? 'selected' : '' %>>PS4</option>
      <option value="PS4/PS5" <%= platform === 'PS4/PS5' ? 'selected' : '' %>>PS4/PS5</option>
    </select>
    <select class="filter-select" name="genre" onchange="this.form.submit()">
      <option value="">All Genres</option>
      <% genres.forEach(g => { %>
        <option value="<%= g %>" <%= genre === g ? 'selected' : '' %>><%= g %></option>
      <% }) %>
    </select>
    <select class="filter-select" name="unit" onchange="this.form.submit()">
      <option value="">Any Availability</option>
      <option value="ps4" <%= unit === 'ps4' ? 'selected' : '' %>>🕹️ PS4 Primary Available</option>
      <option value="ps5" <%= unit === 'ps5' ? 'selected' : '' %>>🏆 PS5 Trophy/Non-Trophy Available</option>
    </select>
    <select class="filter-select" name="newOnly" onchange="this.form.submit()">
      <option value="">All Games</option>
      <option value="1" <%= newOnly === '1' ? 'selected' : '' %>>🆕 Newly Added Only</option>
    </select>
    <button type="submit" class="filter-btn">Search</button>
    <% if (search || platform || genre || unit || newOnly) { %>
      <a href="/browse" class="btn-outline btn" style="padding:0.65rem 1rem;font-size:0.875rem;">Clear</a>
    <% } %>
  </form>
  <div class="results-count" id="resultsCount"><%= games.length %> game<%= games.length !== 1 ? 's' : '' %> found</div>
</div>
```

Replace with:

```ejs
<div class="browse-header">
  <h1>Browse Games</h1>
  <div class="chipfilters">
    <% if (showChips.length) { %>
    <div class="chipfilters-group">
      <div class="chipfilters-label">Show</div>
      <div class="chipfilters-row">
        <a href="/browse<%= search ? '?search=' + encodeURIComponent(search) : '' %>" class="chip<%= !anyFilterActive ? ' chip-active' : '' %>">All games</a>
        <% showChips.forEach(c => { %>
          <a href="/browse?<%= c.href %><%= search ? '&search=' + encodeURIComponent(search) : '' %>" class="chip<%=
            (c.key === 'avail' && avail) || (c.key === 'newOnly' && newOnly) || (c.key === 'buy' && buy) || (c.key === 'bundle' && bundle)
              ? ' chip-active' : '' %>"><%= c.label %> · <%= c.count %></a>
        <% }) %>
      </div>
    </div>
    <% } %>
    <% if (consoleChips.length) { %>
    <div class="chipfilters-group">
      <div class="chipfilters-label">Console</div>
      <div class="chipfilters-row">
        <% consoleChips.forEach(c => { %>
          <a href="/browse?<%= c.href %><%= search ? '&search=' + encodeURIComponent(search) : '' %>" class="chip<%= ps4 ? ' chip-active' : '' %>"><%= c.label %> · <%= c.count %></a>
        <% }) %>
      </div>
    </div>
    <% } %>
    <% if (genreChips.length) { %>
    <div class="chipfilters-group">
      <div class="chipfilters-label">Genre</div>
      <div class="chipfilters-row">
        <% genreChips.forEach(c => { %>
          <% const isSelected = genre === c.label; %>
          <a href="<%= isSelected ? '/browse' + (search ? '?search=' + encodeURIComponent(search) : '') : '/browse?' + c.href + (search ? '&search=' + encodeURIComponent(search) : '') %>" class="chip<%= isSelected ? ' chip-active' : '' %>"><%= c.label %> · <%= c.count %></a>
        <% }) %>
      </div>
    </div>
    <% } %>
  </div>
  <div class="results-count" id="resultsCount"><%= games.length %> game<%= games.length !== 1 ? 's' : '' %> found</div>
</div>
```

- [ ] **Step 2: Update the Coming Soon gating condition**

In `views/browse.ejs`, find:

```ejs
<% if (!search && !platform && !genre && !unit && !newOnly) { %>
```

Replace with:

```ejs
<% if (!anyFilterActive) { %>
```

- [ ] **Step 3: Verify the view compiles with the new locals**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const ejs = require('ejs');
const path = require('path');
const html = ejs.render(
  require('fs').readFileSync('views/browse.ejs', 'utf8'),
  {
    games: [], search: '', genre: '', newOnly: false, avail: false, ps4: false, buy: false, bundle: false,
    anyFilterActive: false,
    showChips: [{ key:'avail', label:'Available now', href:'avail=1', count:44 }],
    consoleChips: [{ key:'ps4', label:'Plays on PS4', href:'ps4=1', count:21 }],
    genreChips: [{ key:'genre', label:'Action', href:'genre=Action', count:37 }],
    upcoming: [], psplus: [], priceCategories: [],
    announcement: null, announcements: [], settings: { title:'T', favicon_path:'/f.svg' }, promo: {},
    accountSummaryMap: {}, assetV: 'x'
  },
  { filename: path.resolve('views/browse.ejs') }
);
console.log(html.includes('Available now · 44') ? 'SHOW_CHIP_OK' : 'SHOW_CHIP_MISSING');
console.log(html.includes('Plays on PS4 · 21') ? 'CONSOLE_CHIP_OK' : 'CONSOLE_CHIP_MISSING');
console.log(html.includes('Action · 37') ? 'GENRE_CHIP_OK' : 'GENRE_CHIP_MISSING');
console.log(html.includes('typeof eval') ? 'DEAD_CODE_STILL_PRESENT' : 'DEAD_CODE_REMOVED_OK');
"
```

Expected: `SHOW_CHIP_OK`, `CONSOLE_CHIP_OK`, `GENRE_CHIP_OK`, `DEAD_CODE_REMOVED_OK`.

- [ ] **Step 4: Add chip CSS**

In `public/css/style.css`, find the `.filters` / `.filter-select` rules (search for `.filter-select` to locate them) and add the following new block immediately after that section — do not delete the old `.filters`/`.filter-select`/`.filter-btn` rules yet in this step, since removing them is a separate, easily-reverted cleanup (see Step 6):

```css
.chipfilters { display: flex; flex-direction: column; gap: 0.6rem; margin: 1rem 0; }
.chipfilters-label { font-size: 0.7rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: #666; margin-bottom: 0.35rem; }
.chipfilters-row { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.25rem; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
.chipfilters-row::-webkit-scrollbar { display: none; }
.chip {
  flex-shrink: 0; display: inline-flex; align-items: center; white-space: nowrap;
  background: #141414; border: 1px solid #2a2a2a; border-radius: 20px;
  padding: 0.5rem 0.9rem; font-size: 0.8rem; font-weight: 600; color: #ccc;
  text-decoration: none; transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.chip:hover { border-color: #444; color: #fff; }
.chip-active { background: var(--ps-blue); color: #000; border-color: var(--ps-blue); }
```

- [ ] **Step 5: Remove the now-unused dropdown CSS**

Search `public/css/style.css` for `.filter-select` and `.filter-btn`. If these classes are not referenced anywhere else in the codebase, delete their rule blocks. Verify with:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -rn "filter-select\|filter-btn" views/ public/css/style.css
```

If the only remaining matches after this step's edit are inside `public/css/style.css` itself with no corresponding `views/` usage, the CSS classes are safe to delete — remove them. If any `views/*.ejs` file still uses `filter-select` or `filter-btn` (for example a different page's own filter form), leave the CSS in place and note this in the task report; do not delete CSS still in use elsewhere.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add views/browse.ejs public/css/style.css
git commit -m "Replace browse filter dropdowns with filter chips"
```

---

### Task 3: Deploy and verify end to end

**Files:** none — verification only.

- [ ] **Step 1: Deploy**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git push origin main
```

- [ ] **Step 2: Wait for rollover**

```bash
for i in $(seq 1 15); do
  body=$(curl -s "https://playstation-hub.com/browse")
  if echo "$body" | grep -q "chipfilters"; then echo "attempt $i: new build live"; break; fi
  echo "attempt $i: still old"; sleep 15
done
```

- [ ] **Step 3: Verify chip counts match the real library**

Using the Browser tool, navigate to `https://playstation-hub.com/browse`. Confirm the chip labels read (values may have shifted slightly since this plan's numbers were measured, but should be close):
- Show: All games, Available now, New, Can buy, Bundles
- Console: Plays on PS4 (no "Plays on PS5" chip anywhere)
- Genre: Action, Horror, Sports, Co-op present; Racing and Mix absent

Cross-check at least the Available now count against a live fetch:

```js
const r = await fetch('/api/search-index');
const j = await r.json();
const now = j.filter(x => x.y === 'now');
now.filter(g => g.s > 0).length; // compare to the "Available now" chip's count
```

- [ ] **Step 4: Verify no chip ever shows a zero and no combination dead-ends**

Click Available now, then click Plays on PS4. Confirm the Available now count visibly changes (it should drop, since PS4-only availability is a stricter subset). Confirm no chip anywhere on the page reads "· 0" at any point during this sequence.

- [ ] **Step 5: Verify old bookmarked URLs still work**

Navigate directly to each of:
- `https://playstation-hub.com/browse?platform=PS4` — should show the same result set as clicking "Plays on PS4" today.
- `https://playstation-hub.com/browse?unit=ps4` — should show the same result set as Available now + Plays on PS4 combined.
- `https://playstation-hub.com/browse?unit=ps5` — should show the same result set as Available now alone.
- `https://playstation-hub.com/browse?newOnly=1` — should show the same result set as clicking New.
- `https://playstation-hub.com/browse?search=resident` (the exact shape nav search's "See all results" link produces) — should still filter by that search term and show the chips reflecting counts within that search.

- [ ] **Step 6: Verify Coming Soon gating**

Confirm the Coming Soon section appears on the unfiltered `/browse` page, and disappears the moment any chip (including just Genre or just Console) is active.

- [ ] **Step 7: Verify with JavaScript disabled**

Using the Browser tool's ability to inspect network/console, confirm no chip or the results count relies on any `<script>` execution — every chip is a plain `<a href>` and the results count is rendered server-side in the initial HTML (verify via `curl` or "view source" rather than the live DOM, since the live DOM includes JS-added content from unrelated site-wide scripts like the nav search).

```bash
curl -s "https://playstation-hub.com/browse?avail=1" | grep -o "[0-9]* games\? found"
```

Expected: a plain-text count baked into the raw HTML response.

- [ ] **Step 8: Verify no console errors**

Click through all three chip groups on the live page, checking the browser console after each interaction.

- [ ] **Step 9: Report to the user**

Confirm the feature is live, report the actual measured counts (which may differ slightly from this plan's numbers if the library changed), and confirm old bookmarks still resolve correctly.
