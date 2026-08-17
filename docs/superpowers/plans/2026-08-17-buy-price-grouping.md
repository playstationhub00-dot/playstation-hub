# Buy Page Price Grouping and Stock Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group `/buy`'s single-game cards into price-point sections, mark not-yet-stocked games with an amber badge instead of a separate section, and add an opt-in "Available today" filter.

**Architecture:** Task 1 adds a pure grouping function to `server.js` and wires it into the existing `/buy` route. Task 2 renders the sections in `views/buy.ejs`, adds the badge CSS to `public/css/style.css`, and adds a small inline `<script>` for the client-side filter toggle.

**Tech Stack:** Node/Express, EJS, plain CSS, vanilla JS (no build step, no framework).

## Global Constraints

- No changes to `views/partials/game-card.ejs` — `/buy`'s card markup is inlined in `views/buy.ejs` and stays that way, per the spec's "What deliberately does not change."
- No changes to `/order/buy`, `lib/orders.js`, or any order-lifecycle code.
- Pending detection reuses the existing signal verbatim: `!game.renters && !game.stocked` (the same test `views/game-detail.ejs` already uses, driven by the existing `POST /admin/games/:id/stocked` toggle). No new field, no new admin UI.
- Section labels are exact price points (`₱999`), not fuzzy ranges, except the merged trailing group (`₱X and up`).
- `MIN_GROUP = 3` — a price point needs at least 3 games to stand alone; anything below that at the top of the price range merges into the trailing group.
- The pending badge text is exactly `Set up on order`, matching the existing copy in `views/game-detail.ejs`.
- The filter is off by default; the full catalog (including pending games) renders on page load with no JS required to see it.

---

### Task 1: Server-side price grouping and pending detection

**Files:**
- Modify: `server.js:1175-1185` (the `singleGames` mapping inside the `/buy` route) and `server.js:1186-1190` (the `res.render` call)

**Interfaces:**
- Consumes: nothing new — reads the existing `allGames` array (from `getGames()`) and the existing `promo`/`buyPromo` values already computed earlier in the route.
- Produces: a new local function `groupSingleGamesByPrice(games)` used only inside this route (not exported to `app.locals` — no other route or view needs it), and two new keys passed to `res.render('buy', ...)`:
  - `priceGroups`: `Array<{ label: string, minPrice: number, count: number, games: Array<SingleGame> }>`, ordered ascending by `minPrice`, where `SingleGame` is the same per-game object shape the route already builds (`id, title, cover_image, price, was, slug, platform, genre, cover_focal_x, cover_focal_y`) plus one new field: `pending: boolean`.
  - `pendingCount`: `number` — total count of pending games across all groups, for the filter's own logic in Task 2.

- [ ] **Step 1: Add the `pending` flag to each single-game object**

In `server.js`, find the existing `singleGames` mapping (around line 1175):

```js
  const singleGames = allGames
    .filter(g => (g.buy_nt_price || 0) > 0 || (g.buy_tr_price || 0) > 0)
    .map(g => {
      const base = g.buy_nt_price > 0 ? g.buy_nt_price : g.buy_tr_price;
      const final = buyPromo ? Math.round(base * (1 - promo.buy_promo_pct / 100)) : base;
      return {
        id: g.id, title: g.title, cover_image: g.cover_image, price: final, was: buyPromo ? base : null, slug: gameSlug(g.title),
        platform: g.platform, genre: g.genre,
        cover_focal_x: g.cover_focal_x, cover_focal_y: g.cover_focal_y
      };
    });
```

Replace the returned object with one that adds `pending`:

```js
  const singleGames = allGames
    .filter(g => (g.buy_nt_price || 0) > 0 || (g.buy_tr_price || 0) > 0)
    .map(g => {
      const base = g.buy_nt_price > 0 ? g.buy_nt_price : g.buy_tr_price;
      const final = buyPromo ? Math.round(base * (1 - promo.buy_promo_pct / 100)) : base;
      return {
        id: g.id, title: g.title, cover_image: g.cover_image, price: final, was: buyPromo ? base : null, slug: gameSlug(g.title),
        platform: g.platform, genre: g.genre,
        cover_focal_x: g.cover_focal_x, cover_focal_y: g.cover_focal_y,
        pending: !g.renters && !g.stocked
      };
    });
```

This is the same `neverRented` test `views/game-detail.ejs` already uses (`!game.renters && !game.stocked`), applied per single-game entry.

- [ ] **Step 2: Add the grouping function**

Immediately above the `app.get('/buy', ...)` route definition (currently at `server.js:1150`), add:

```js
// Groups /buy's single-game cards into price-point sections, cheapest first.
// Price points with fewer than MIN_GROUP games merge into one trailing "and up"
// group, but only from the top: if the highest price point itself already has
// MIN_GROUP or more games, nothing merges and every price point stands alone.
const MIN_GROUP = 3;
function groupSingleGamesByPrice(games) {
  const byPrice = new Map();
  games.forEach(g => {
    if (!byPrice.has(g.price)) byPrice.set(g.price, []);
    byPrice.get(g.price).push(g);
  });
  const prices = [...byPrice.keys()].sort((a, b) => a - b);
  if (prices.length === 0) return [];

  let mergeFromIndex = prices.length; // no merge by default
  for (let i = prices.length - 1; i >= 0; i--) {
    if (byPrice.get(prices[i]).length < MIN_GROUP && i > 0) {
      mergeFromIndex = i;
    } else {
      break;
    }
  }

  const groups = [];
  for (let i = 0; i < mergeFromIndex; i++) {
    const price = prices[i];
    groups.push({ label: '₱' + price.toLocaleString(), minPrice: price, count: byPrice.get(price).length, games: byPrice.get(price) });
  }
  if (mergeFromIndex < prices.length) {
    const mergedPrices = prices.slice(mergeFromIndex);
    const mergedGames = mergedPrices.flatMap(p => byPrice.get(p));
    const lowest = mergedPrices[0];
    groups.push({ label: '₱' + lowest.toLocaleString() + ' and up', minPrice: lowest, count: mergedGames.length, games: mergedGames });
  }
  return groups;
}
```

Trace through the example in the spec to confirm this is correct before moving on: prices `[499, 799, 999, 1499, 1999, 2499, 4000]` with counts `[3, 6, 12, 5, 11, 1, 1]`.
  - `i=6` (price 4000, count 1): `1 < 3` and `i > 0` → `mergeFromIndex = 6`.
  - `i=5` (price 2499, count 1): `1 < 3` and `i > 0` → `mergeFromIndex = 5`.
  - `i=4` (price 1999, count 11): `11 < 3` is false → `break`.
  - Result: groups for indices 0-4 stand alone (₱499, ₱799, ₱999, ₱1,499, ₱1,999), and prices from index 5 onward (2499, 4000) merge into one `₱2,499 and up` group with `count: 2`. Matches the spec's worked example exactly.

- [ ] **Step 3: Wire the grouping and pending count into the route**

Find the `res.render('buy', ...)` call (around line 1186):

```js
  res.render('buy', {
    bundles, singleGames, buyPromo, buyPromoPct: promo.buy_promo_pct || 0,
    announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s,
    orderError: req.query.order_error || null
  });
```

Replace with:

```js
  const priceGroups = groupSingleGamesByPrice(singleGames);
  const pendingCount = singleGames.filter(g => g.pending).length;
  res.render('buy', {
    bundles, singleGames, priceGroups, pendingCount, buyPromo, buyPromoPct: promo.buy_promo_pct || 0,
    announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s,
    orderError: req.query.order_error || null
  });
```

`singleGames` stays in the render call even though the view will use `priceGroups` for the grid — this keeps the change additive and avoids touching anything else that might read `singleGames` from this render context.

- [ ] **Step 4: Verify server syntax**

Run:

```bash
node -c server.js
```

Expected: no output, exit code 0.

- [ ] **Step 5: Verify the grouping logic against live data**

There is no local dev server and no bundle/game data in the local `games.json` stub, so this cannot be exercised locally. Instead, verify with a throwaway Node script using the exact counts already confirmed live on `/buy` (39 games: `499×3, 799×6, 999×12, 1499×5, 1999×11, 2499×1, 4000×1`):

```bash
node -e "
const MIN_GROUP = 3;
function groupSingleGamesByPrice(games) {
  const byPrice = new Map();
  games.forEach(g => { if (!byPrice.has(g.price)) byPrice.set(g.price, []); byPrice.get(g.price).push(g); });
  const prices = [...byPrice.keys()].sort((a, b) => a - b);
  if (prices.length === 0) return [];
  let mergeFromIndex = prices.length;
  for (let i = prices.length - 1; i >= 0; i--) {
    if (byPrice.get(prices[i]).length < MIN_GROUP && i > 0) mergeFromIndex = i; else break;
  }
  const groups = [];
  for (let i = 0; i < mergeFromIndex; i++) {
    const price = prices[i];
    groups.push({ label: '₱' + price.toLocaleString(), minPrice: price, count: byPrice.get(price).length });
  }
  if (mergeFromIndex < prices.length) {
    const mergedPrices = prices.slice(mergeFromIndex);
    const mergedGames = mergedPrices.flatMap(p => byPrice.get(p));
    groups.push({ label: '₱' + mergedPrices[0].toLocaleString() + ' and up', minPrice: mergedPrices[0], count: mergedGames.length });
  }
  return groups;
}
const counts = {499:3,799:6,999:12,1499:5,1999:11,2499:1,4000:1};
let games = [];
Object.entries(counts).forEach(([p, n]) => { for (let i=0;i<n;i++) games.push({price: parseInt(p)}); });
console.log(JSON.stringify(groupSingleGamesByPrice(games), null, 1));
"
```

Expected output: six groups — `₱499` (3), `₱799` (6), `₱999` (12), `₱1,499` (5), `₱1,999` (11), `₱2,499 and up` (2).

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "Group /buy single games by price point and flag not-yet-stocked games"
```

---

### Task 2: Render price sections, pending badge, and filter toggle

**Files:**
- Modify: `views/buy.ejs:70-96` (replace the flat `singleGames` grid with per-group sections)
- Modify: `public/css/style.css` (add badge and filter-toggle rules near the existing `.buy-*` rules, around line 2756-2789)

**Interfaces:**
- Consumes: `priceGroups` and `pendingCount` from Task 1's `res.render('buy', ...)` call — `priceGroups` is `Array<{ label: string, minPrice: number, count: number, games: Array<{ id, title, cover_image, price, was, slug, platform, genre, cover_focal_x, cover_focal_y, pending }> }>`.
- Produces: nothing consumed elsewhere — this is the leaf template/CSS layer.

- [ ] **Step 1: Replace the single-games grid in `views/buy.ejs`**

Find the existing block (currently at `views/buy.ejs:70-96`):

```html
  <% if (singleGames.length) { %>
  <div class="buy-section-label">Single games</div>
  <div class="buy-single-grid">
    <% singleGames.forEach(g => { %>
    <a href="/game/<%= g.slug %>?mode=buy" class="game-card gc2-card">
      <% if (g.cover_image) { %><img src="<%= g.cover_image %>" alt="<%= g.title %>" class="gc2-cover" loading="lazy" decoding="async" style="object-position: <%= g.cover_focal_x != null ? g.cover_focal_x : 50 %>% <%= g.cover_focal_y != null ? g.cover_focal_y : 50 %>%;">
      <% } else { %>
        <div class="gc2-cover-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
          </svg>
          <span>No Image</span>
        </div>
      <% } %>
      <div class="gc2-scrim"></div>
      <div class="gc2-body">
        <div class="gc2-plat"><%= g.platform %><%= g.genre ? ' · ' + g.genre.split('/')[0].trim() : '' %></div>
        <div class="gc2-title"><%= g.title %></div>
        <div class="gc2-foot">
          <div class="gc2-price">from <b>₱<%= g.price %></b><% if (g.was) { %><s class="gc2-price-was">₱<%= g.was %></s><% } %></div>
          <div class="gc2-cta">Buy</div>
        </div>
      </div>
    </a>
    <% }) %>
  </div>
  <% } %>
```

Replace it with:

```html
  <% if (priceGroups.length) { %>
  <div class="buy-filter-row">
    <div class="buy-section-label buy-section-label-plain">Single games</div>
    <% if (pendingCount > 0) { %>
    <label class="buy-avail-toggle">
      <input type="checkbox" id="buyAvailToggle" onchange="buyToggleAvailability(this.checked)">
      <span>Available today only</span>
    </label>
    <% } %>
  </div>
  <% priceGroups.forEach(group => { %>
  <div class="buy-price-section" data-group-count="<%= group.count %>" data-group-pending="<%= group.games.filter(g => g.pending).length %>">
    <div class="buy-price-section-head">
      <span class="buy-price-section-label"><%= group.label %></span>
      <span class="buy-price-section-count" data-full-count="<%= group.count %>"><%= group.count %> game<%= group.count !== 1 ? 's' : '' %></span>
    </div>
    <div class="buy-single-grid">
      <% group.games.forEach(g => { %>
      <a href="/game/<%= g.slug %>?mode=buy" class="game-card gc2-card<%= g.pending ? ' buy-card-pending' : '' %>" data-pending="<%= g.pending %>">
        <% if (g.cover_image) { %><img src="<%= g.cover_image %>" alt="<%= g.title %>" class="gc2-cover" loading="lazy" decoding="async" style="object-position: <%= g.cover_focal_x != null ? g.cover_focal_x : 50 %>% <%= g.cover_focal_y != null ? g.cover_focal_y : 50 %>%;">
        <% } else { %>
          <div class="gc2-cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
            <span>No Image</span>
          </div>
        <% } %>
        <div class="gc2-scrim"></div>
        <% if (g.pending) { %><div class="gc2-badge buy-badge-pending">Set up on order</div><% } %>
        <div class="gc2-body">
          <div class="gc2-plat"><%= g.platform %><%= g.genre ? ' · ' + g.genre.split('/')[0].trim() : '' %></div>
          <div class="gc2-title"><%= g.title %></div>
          <div class="gc2-foot">
            <div class="gc2-price">from <b>₱<%= g.price %></b><% if (g.was) { %><s class="gc2-price-was">₱<%= g.was %></s><% } %></div>
            <div class="gc2-cta">Buy</div>
          </div>
        </div>
      </a>
      <% }) %>
    </div>
  </div>
  <% }) %>
  <div class="buy-empty-filtered" id="buyEmptyFiltered" style="display:none;">Everything is set up on order right now.</div>
  <% } %>
```

Notes on this markup:
  - `data-pending="<%= g.pending %>"` on each card and `data-group-count` / `data-group-pending` on each section are read by the Step 3 script — nothing else consumes them.
  - The badge reuses the existing `.gc2-badge` positioning class (`left: 9px; top: 9px`) plus a new `.buy-badge-pending` for color, matching how `.gc2-badge-last` / `.gc2-badge-rented` / `.gc2-badge-new` already layer a variant class on top of `.gc2-badge`.
  - `buy-section-label-plain` is added so the existing `.buy-section-label` (used unmodified for "Account bundles — best value") doesn't need `justify-content` changes — this variant sits inside the new flex row instead.

- [ ] **Step 2: Add CSS for the pending badge, section headers, and filter toggle**

In `public/css/style.css`, find the existing `.buy-single-grid` rule (around line 2786):

```css
.buy-single-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
```

Directly above it, add:

```css
.buy-filter-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
.buy-section-label-plain { margin: 0; }
.buy-avail-toggle { display: flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; color: #aaa; cursor: pointer; user-select: none; }
.buy-avail-toggle input { accent-color: var(--ps-blue); width: 15px; height: 15px; cursor: pointer; }
.buy-price-section { margin-bottom: 1.75rem; }
.buy-price-section-head { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.75rem; }
.buy-price-section-label { font-size: 1.05rem; font-weight: 800; color: #fff; }
.buy-price-section-count { font-size: 0.78rem; color: var(--text-secondary); background: #111; border: 1px solid #222; border-radius: 20px; padding: 0.2rem 0.65rem; }
.buy-badge-pending { left: 9px; background: rgba(240,165,0,0.15); color: #f0a500; border: 1px solid rgba(240,165,0,0.35); }
.buy-empty-filtered { text-align: center; color: #888; font-size: 0.85rem; padding: 2.5rem 0; }
```

These reuse existing tokens (`var(--ps-blue)`, `var(--text-secondary)`) and match the `#111`/`#222` card-count-pill pattern already used on `/browse`'s "Account Bundles" section header (`views/browse.ejs`), so the new section headers look consistent with the rest of the site without inventing a new visual language.

- [ ] **Step 3: Add the filter toggle script**

In `views/buy.ejs`, find the closing `</div>` of `.buy-page` and the `<%- include('partials/footer') %>` line (currently at the end of the file, around line 110-112):

```html
</div>

<%- include('partials/footer') %>
</body>
</html>
```

Replace with:

```html
</div>

<script>
function buyToggleAvailability(showOnly) {
  const sections = document.querySelectorAll('.buy-price-section');
  let anyVisible = false;
  sections.forEach(function (section) {
    const cards = section.querySelectorAll('.gc2-card');
    let visibleInSection = 0;
    cards.forEach(function (card) {
      const isPending = card.dataset.pending === 'true';
      const hide = showOnly && isPending;
      card.style.display = hide ? 'none' : '';
      if (!hide) visibleInSection++;
    });
    section.style.display = visibleInSection > 0 ? '' : 'none';
    if (visibleInSection > 0) anyVisible = true;
    const countEl = section.querySelector('.buy-price-section-count');
    if (countEl) {
      const fullCount = parseInt(countEl.dataset.fullCount, 10);
      const shown = showOnly ? visibleInSection : fullCount;
      countEl.textContent = shown + (shown !== 1 ? ' games' : ' game');
    }
  });
  const empty = document.getElementById('buyEmptyFiltered');
  if (empty) empty.style.display = (showOnly && !anyVisible) ? '' : 'none';
}
</script>

<%- include('partials/footer') %>
</body>
</html>
```

This script only runs client-side after a checkbox change — the page renders fully (all sections, all cards, correct counts) with JS disabled, satisfying the Global Constraint that the filter is off by default and not required to see the catalog.

- [ ] **Step 4: Verify EJS compiles**

Run:

```bash
node -e "require('ejs').compile(require('fs').readFileSync('views/buy.ejs','utf8'))"
```

Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add views/buy.ejs public/css/style.css
git commit -m "Render /buy price sections with pending badge and availability filter"
```

- [ ] **Step 6: Deploy and verify live**

```bash
git push origin main
```

Poll until the deploy has rolled over:

```bash
for i in 1 2 3 4 5 6; do curl -s "https://playstation-hub.com/buy" | grep -q "buy-price-section" && echo "FOUND at attempt $i" && break; echo "attempt $i: not yet"; sleep 15; done
```

Then, using the Browser tool:
1. Navigate to `https://playstation-hub.com/buy`.
2. Confirm the single-games area now renders as separate price-labeled sections (e.g. `₱499`, `₱799`, `₱999`, `₱1,499`, `₱1,999`, `₱2,499 and up`) each with a count pill, in ascending price order.
3. Confirm the total number of single-game cards across all sections still equals 39 (or whatever the live count is at verification time) — no game silently dropped or duplicated by the grouping.
4. Confirm cards for games known to be pending (e.g. `Saros`, `Monster Hunter Wilds`) show the amber "Set up on order" badge in the card's top-left corner, and cards for stocked games show no badge.
5. Confirm the bundles section and the "Build your own" / "Don't see it?" cards at the bottom are unchanged.
6. Click the "Available today only" checkbox: confirm pending cards disappear, any section that becomes empty disappears, and the remaining count pills update to reflect only visible cards.
7. Uncheck it: confirm everything returns to the original full state with original counts.
8. Spot-check on a mobile viewport (resize to ~390px width) that the filter row and section headers wrap sensibly and remain usable.
