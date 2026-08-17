# Bundle vs. Contents Catalog Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move bundle-flagged games into their own "Account bundles" section above the price-tier sections on `/browse`, and mark every game contained in a bundle with a disclosure note showing what renting it actually includes.

**Architecture:** A new `findBundleContaining(game)` helper (the inverse of the existing `resolveBundleInfo(game)`) resolves which bundle, if any, a given game belongs to. `game-card.ejs` calls it to render the disclosure note wherever cards render (browse, home sliders, everywhere the partial is used). `/browse`'s route/view splits its already-filtered `games` array into bundle and non-bundle lists before the existing category-grouping logic runs, and renders the bundle list in a new section using the same card partial and grid classes the category sections already use.

**Tech Stack:** Express.js route + EJS views, matching every existing pattern in this codebase (`app.locals`-exposed helper functions callable by name from templates, `.games-grid` + `partials/game-card` for card grids).

## Global Constraints

- `findBundleContaining(game)` must return `null` for a game that is itself flagged `is_bundle` — a bundle never claims to be contained in something.
- The disclosure marker on a contained game's card is **plain text, not a separate clickable link**. `.gc2-card` (the card element used everywhere in this codebase — browse, home sliders, PS Plus) is itself a single `<a>` wrapping the entire card. Nesting a second `<a>` inside it is invalid HTML and would break click behavior in some browsers. Restructuring `.gc2-card` to support an inner link is out of scope — it is shared by every card on the site, not just bundle-related ones. The marker communicates the relationship; clicking anywhere on the card (as today) still opens that game's own detail page.
- The marker copy is exactly `"Comes with N more"` where `N = bundle count − 1` (the contained game itself is one of the bundle's games, so it doesn't count itself as "more").
- `/browse`'s existing category-grouping logic, section headers, per-category game counts, and "Price Starts at ₱X" lines must be unchanged in behavior — they simply run against a smaller, bundle-excluded game list.
- No changes to `/order/create`, the rental order flow, pricing computation, or `gameAccountSummary()`/`buildAccountSummaryMap()` — display-only feature.
- When there are zero bundle-flagged games in the catalog, `/browse` must render identically to before this plan (no empty "Account bundles" section, no visual change).

---

### Task 1: `findBundleContaining` helper

**Files:**
- Modify: `server.js` (new helper function + `app.locals` export)

**Interfaces:**
- Produces: `findBundleContaining(game)` → `{ bundleGame, count } | null`. `bundleGame` is the bundle's own catalog game object (has `.title`, used by Task 2 to build the link-free slug reference — actually not linked per Global Constraints, but `bundleGame.title` may still be useful context); `count` is the bundle's total game count (same `count` `resolveBundleInfo` returns for the bundle game itself).
- Produces: `app.locals.findBundleContaining` — exposed the same way `app.locals.resolveBundleInfo` already is, so EJS templates call it directly by name with no import.
- Consumes: `resolveBundleInfo(game)` (`server.js:1123`, already defined) and `getGames()` (`server.js:437`) — both pre-existing, unchanged.

- [ ] **Step 1: Add `findBundleContaining` immediately after `resolveBundleInfo`'s `app.locals` export**

In `server.js`, the existing code (currently lines 1123-1132) reads:

```javascript
function resolveBundleInfo(game) {
  if (!game.is_bundle || !game.bundle_account_id) return null;
  const acc = getAccount(game.bundle_account_id);
  if (!acc) return null;
  const allGames = getGames();
  const games = buildBundleGames(acc, allGames).filter(g => g.id !== game.id);
  return { account: acc, games, count: games.length };
}
app.locals.resolveBundleInfo = (game) => resolveBundleInfo(game);
```

Insert this immediately after that block (before the blank line preceding `app.get('/buy', ...)`):

```javascript
// The inverse of resolveBundleInfo: given an ordinary game, finds the bundle (if
// any) that contains it, so its catalog card can disclose "renting this gets you
// the whole account." A bundle game itself never resolves to a parent bundle.
function findBundleContaining(game) {
  if (game.is_bundle) return null;
  const allGames = getGames();
  for (const g of allGames) {
    if (!g.is_bundle) continue;
    const info = resolveBundleInfo(g);
    if (info && info.games.some(cg => cg.id === game.id)) {
      return { bundleGame: g, count: info.count };
    }
  }
  return null;
}
app.locals.findBundleContaining = (game) => findBundleContaining(game);
```

- [ ] **Step 2: Verify**

```bash
node -c server.js
```

Must pass with no output.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Add findBundleContaining helper to resolve a game's parent bundle"
```

---

### Task 2: Disclosure marker on contained-game cards

**Files:**
- Modify: `views/partials/game-card.ejs`
- Modify: `public/css/style.css`

**Interfaces:**
- Consumes: `findBundleContaining(game)` from Task 1 (called by name, no import — it's an `app.locals` function).

- [ ] **Step 1: Compute the marker data in `game-card.ejs`**

In `views/partials/game-card.ejs`, the top `<% ... %>` block currently ends with (matching the existing line):

```javascript
  const gcBundle = resolveBundleInfo(game);
%>
```

Change to:

```javascript
  const gcBundle = resolveBundleInfo(game);
  const gcBundleParent = findBundleContaining(game);
%>
```

- [ ] **Step 2: Render the marker below the price/CTA row**

In the same file, the price footer currently ends with (matching the existing lines):

```html
      <div class="gc2-cta<%= allUnavail ? ' gc2-cta-reserve' : '' %>"><%= allUnavail ? 'Reserve' : 'Rent' %></div>
    </div>
```

Change to:

```html
      <div class="gc2-cta<%= allUnavail ? ' gc2-cta-reserve' : '' %>"><%= allUnavail ? 'Reserve' : 'Rent' %></div>
    </div>
    <% if (gcBundleParent) { %>
    <div class="gc2-bundle-note">Comes with <%= gcBundleParent.count - 1 %> more</div>
    <% } %>
```

- [ ] **Step 3: Add the marker's CSS**

In `public/css/style.css`, immediately after line 2241 (`.gc2-cta-reserve { background: transparent; color: #a78bfa; border: 1px solid #4a2a8a; }`), add:

```css
.gc2-bundle-note { font-size: 0.62rem; color: #7fc7e8; margin-top: 0.3rem; }
```

- [ ] **Step 4: Verify**

```bash
node -c server.js
node -e "require('ejs').compile(require('fs').readFileSync('views/partials/game-card.ejs','utf8'))"
```

Both must pass with no output. Then, against the live/deployed site: visit `/browse`, confirm a game known to be on the PS HUB Main Account bundle (e.g. `Tekken 8`) shows "Comes with 11 more" beneath its price/Rent row, confirm the bundle's own card (`PS HUB Main Account`) does NOT show this note (it's excluded by the `!game.is_bundle` check), and confirm an ordinary game with no bundle relationship (e.g. `007 First Light`, unless it happens to be added to a bundle later) shows no note and is visually unchanged.

- [ ] **Step 5: Commit**

```bash
git add views/partials/game-card.ejs public/css/style.css
git commit -m "Show 'Comes with N more' disclosure note on cards contained in a bundle"
```

---

### Task 3: Bundles section on `/browse`

**Files:**
- Modify: `views/browse.ejs`

**Interfaces:**
- Consumes: `resolveBundleInfo(game)` (called by name in the template, same as Task 2 and the pre-existing usage in `game-card.ejs` — already globally available via `app.locals`, no route change needed to pass it through).

- [ ] **Step 1: Split `games` into bundle and non-bundle lists before the category-grouping logic**

In `views/browse.ejs`, the category-grouping block currently starts with (matching the existing lines, inside the `<% } else { %>` branch that renders when there are results):

```javascript
    <%
      // Group games by price category
      const catMap = {};
      const uncategorized = [];
      games.forEach(g => {
```

Change to:

```javascript
    <%
      // Bundle-flagged games get their own section above the price tiers instead
      // of sitting inside them as a peer of the games they contain.
      const bundleGames = games.filter(g => resolveBundleInfo(g));
      const nonBundleGames = games.filter(g => !resolveBundleInfo(g));
      // Group games by price category
      const catMap = {};
      const uncategorized = [];
      nonBundleGames.forEach(g => {
```

- [ ] **Step 2: Render the bundles section immediately before the category loop**

In the same file, the code immediately after the grouping block's closing `%>` currently reads (matching the existing line):

```html
    %>
    <% orderedCats.forEach((cat, ci) => { const catMin = catMinPrice(catMap[cat.id].games); %>
```

Change to:

```html
    %>
    <% if (bundleGames.length > 0) { %>
    <div class="section cat-section" id="cat-section-bundles" style="<%= upcoming.length > 0 ? 'padding-top:3rem;' : 'padding-top:2rem;' %>">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.5rem;flex-wrap:wrap;">
        <h2 class="section-title" style="margin:0;">Account Bundles</h2>
        <span style="font-size:0.78rem;color:var(--text-secondary);background:#111;border:1px solid #222;border-radius:20px;padding:0.2rem 0.65rem;"><%= bundleGames.length %> bundle<%= bundleGames.length !== 1 ? 's' : '' %></span>
      </div>
      <div class="games-grid rentals-grid">
        <% bundleGames.forEach(game => { %><%- include('partials/game-card', { game }) %><% }) %>
      </div>
    </div>
    <% } %>
    <% orderedCats.forEach((cat, ci) => { const catMin = catMinPrice(catMap[cat.id].games); %>
```

Note: the `ci > 0` padding-top check inside the `orderedCats.forEach` loop (unchanged, still reads `ci > 0 || upcoming.length > 0`) already handles spacing correctly for the first category section regardless of whether the bundles section rendered above it — no change needed there.

- [ ] **Step 3: Verify**

```bash
node -c server.js
node -e "require('ejs').compile(require('fs').readFileSync('views/browse.ejs','utf8'))"
```

Both must pass with no output. Then, against the live/deployed site: visit `/browse` and confirm:
- An "Account Bundles" section appears above "Deluxe" (or whichever category section previously contained `PS HUB Main Account`), showing exactly the bundle card(s) — `PS HUB Main Account` with its "Bundle · 12 games" line and "Comes with N more"-free (bundle cards never show their own note, per Task 1's `is_bundle` guard).
- The "Deluxe" section's game count dropped by exactly the number of bundle games removed from it (e.g. 18 → 17 if one bundle was in that category), and no longer contains the `PS HUB Main Account` card.
- Every game that's actually on the PS HUB account (Tekken 8, NBA 2K25, Final Fantasy 16, etc.) still appears in its own price-tier section, now showing the "Comes with 11 more" note from Task 2.
- The total results count at the top of the page (`<%= games.length %> games found`) is unchanged — it still counts every game, bundle and non-bundle alike.
- Apply a search or filter (e.g. `/browse?search=tekken`) and confirm both `Tekken 8` and `PS HUB Main Account` still appear (search behavior was already shipped in an earlier change and is unaffected by this plan — this step only confirms no regression).

- [ ] **Step 4: Commit**

```bash
git add views/browse.ejs
git commit -m "Add Account Bundles section to /browse, above the price-tier sections"
```

---

### Task 4: Deploy and verify live

**Files:** None (deployment + verification only).

- [ ] **Step 1: Push to `main`**

```bash
git push origin main
```

- [ ] **Step 2: Wait for Railway to roll over**

Poll `https://playstation-hub.com/browse` until it returns 200 with the new markup (e.g. `curl -s https://playstation-hub.com/browse | grep -q "cat-section-bundles"` succeeds), same pattern used for prior deploys this session.

- [ ] **Step 3: Live-verify the full flow**

Repeat Task 2's and Task 3's live-verification steps against the deployed site (not just the pre-deploy check, since CSS is cache-busted via `assetV` but worth confirming post-deploy regardless): confirm the "Account Bundles" section renders correctly, confirm `PS HUB Main Account`'s card shows no self-referential note, confirm at least 2-3 of its contained games (e.g. `Tekken 8`, `NBA 2K25`, `Final Fantasy 16`) show "Comes with 11 more", confirm the category section counts dropped correctly, and confirm an ordinary non-bundle-related game (e.g. `007 First Light`, assuming it isn't on any bundle account) is visually unchanged from before this plan. Also spot-check the homepage (`/`) sliders, since `game-card.ejs` renders there too — confirm any bundle-contained game appearing in "New Releases" or "Most Popular" also shows the note, and the bundle game itself (if it appears there) does not.
