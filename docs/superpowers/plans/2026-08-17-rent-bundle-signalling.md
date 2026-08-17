# Rent Bundle Signalling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin mark a catalog game as representing a rentable account bundle, and show that on the catalog card and the game detail page — including the list of games included.

**Architecture:** Two new fields on a game (`is_bundle`, `bundle_account_id`) resolve through a new `resolveBundleInfo(game)` helper that reuses the buy-catalog feature's existing `buildBundleGames(acc, allGames)`. The helper is exposed via `app.locals` so `game-card.ejs` and `game-detail.ejs` can call it directly, the same way they already call `computeAvailability`/`gameAccountSummary` — no route needs to pass bundle data through render calls.

**Tech Stack:** Express.js route handlers + EJS views, matching every existing admin/public route in `server.js`.

## Global Constraints

- `resolveBundleInfo(game)` returns `null` whenever `game.is_bundle` is falsy, `game.bundle_account_id` is falsy, or `getAccount(game.bundle_account_id)` returns nothing — a stale/deleted link silently turns the display off, never throws or shows partial data.
- Reuse `buildBundleGames(acc, allGames)` exactly as defined at `server.js:1086` — do not duplicate or modify it.
- The bundle price footer must read `"<%= gcBundle.count %> games from ₱<%= gcStartPrice %>"` — keep the word "from"; the account still has two tiers at different prices, so a bare price would misstate it.
- No changes to `/order/create`, `/order/reserve`, or any order-lifecycle code — this feature is display-only.
- No changes to the `accounts` collection or its `for_sale`/`public_name` fields — unrelated flag on a different collection for a different surface.
- Bundle marking is added to `views/edit.ejs` only, not the inline add-game form in `views/admin.ejs`.

---

### Task 1: Data model, admin UI, and `resolveBundleInfo` helper

**Files:**
- Modify: `server.js` (new helper function, `app.locals` export, `/admin/edit/:id` GET + POST routes, `/admin/add` POST route)
- Modify: `views/edit.ejs` (new form fields)

**Interfaces:**
- Produces: `resolveBundleInfo(game)` → `{ account, games, count } | null`, defined as a function declaration (hoisted, so later top-level code can reference it regardless of declaration order).
- Produces: `app.locals.resolveBundleInfo` — the same function, exposed to EJS templates. Task 2's `game-card.ejs`/`game-detail.ejs` call `resolveBundleInfo(game)` directly (no `typeof` guard needed inside the partials since this task guarantees the export exists before those views ever render).
- Consumes: `buildBundleGames` (`server.js:1086`), `getAccount` (`server.js:560`), `getGames` (`server.js:437`), `getAccounts` (`server.js:559`) — all pre-existing, unchanged.

- [ ] **Step 1: Add `resolveBundleInfo` and expose it on `app.locals`**

In `server.js`, insert immediately after the `bundleSavings` function (currently ending at line 1117, right before the blank line that precedes `app.get('/buy', ...)`):

```javascript
// Resolves the account bundle a game represents (owner-marked via admin edit),
// for the catalog card and detail page. Returns null the moment the flag is
// off, unset, or the linked account no longer exists — a stale link silently
// turns the bundle display off instead of erroring or showing partial data.
function resolveBundleInfo(game) {
  if (!game.is_bundle || !game.bundle_account_id) return null;
  const acc = getAccount(game.bundle_account_id);
  if (!acc) return null;
  const allGames = getGames();
  const games = buildBundleGames(acc, allGames);
  return { account: acc, games, count: games.length };
}
app.locals.resolveBundleInfo = (game) => resolveBundleInfo(game);
```

- [ ] **Step 2: Add `accounts` to `GET /admin/edit/:id`'s render call**

In `server.js`, the route currently reads:

```javascript
app.get('/admin/edit/:id', requireAuth, (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.redirect('/admin');
  res.render('edit', { game, settings: getSiteSettings(), priceCategories: getPriceCategories() });
});
```

Change the `res.render` call to:

```javascript
  res.render('edit', { game, settings: getSiteSettings(), priceCategories: getPriceCategories(), accounts: getAccounts() });
```

- [ ] **Step 3: Add `is_bundle`/`bundle_account_id` to `POST /admin/edit/:id`**

In `server.js`, the route currently destructures (starting around line 2642):

```javascript
  const { title, platform, available_slots, renters, new_window_days,
    nt_price_7d, nt_price_30d,
    tr_price_7d, tr_price_30d,
    buy_nt_price, buy_tr_price,
    genre, description, release_date, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    remove_gallery, cover_focal_x, cover_focal_y,
    price_category_id, price_mode, cost, link_label, link_url } = req.body;
```

Change to:

```javascript
  const { title, platform, available_slots, renters, new_window_days,
    nt_price_7d, nt_price_30d,
    tr_price_7d, tr_price_30d,
    buy_nt_price, buy_tr_price,
    genre, description, release_date, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    remove_gallery, cover_focal_x, cover_focal_y,
    price_category_id, price_mode, cost, link_label, link_url,
    is_bundle, bundle_account_id } = req.body;
```

Then in the `db.get('games').find({...}).assign({ ... })` object, add these two fields (place them right after `cost: parseInt(cost) || 0,`):

```javascript
    is_bundle: is_bundle === 'on',
    bundle_account_id: bundle_account_id ? parseInt(bundle_account_id) : null,
```

- [ ] **Step 4: Add the bundle fields to `views/edit.ejs`**

In `views/edit.ejs`, insert a new `.form-group full` block immediately before the existing Description field (currently):

```html
        <div class="form-group full">
          <label>Description</label>
          <textarea name="description"><%= game.description || '' %></textarea>
        </div>
```

Insert this block right before it:

```html
        <div class="form-group full">
          <label>
            <input type="checkbox" name="is_bundle" id="edit_bundle_chk" <%= game.is_bundle ? 'checked' : '' %>
              onchange="document.getElementById('edit_bundle_account').style.display = this.checked ? 'block' : 'none';">
            📦 This game represents an account bundle
          </label>
          <div id="edit_bundle_account" style="display:<%= game.is_bundle ? 'block' : 'none' %>;margin-top:0.5rem;">
            <label>Bundle account</label>
            <select name="bundle_account_id">
              <option value="">— Select account —</option>
              <% accounts.forEach(acc => { %>
              <option value="<%= acc.id %>" <%= game.bundle_account_id === acc.id ? 'selected' : '' %>><%= acc.label %></option>
              <% }) %>
            </select>
          </div>
        </div>
```

- [ ] **Step 5: Verify**

```bash
node -c server.js
node -e "require('ejs').compile(require('fs').readFileSync('views/edit.ejs','utf8'))"
```

Both must pass with no output. Then, against the live/deployed site: log into `/admin`, open Edit on the "PS HUB Main Account" game, confirm the new checkbox and account dropdown appear, tick the checkbox, select the "PS HUB Main Account" account from the dropdown (the account, not the game — same label, different record), save, and confirm the edit page reloads with the checkbox still ticked and that account still selected (proving the POST route persisted both fields and the GET route round-trips them).

- [ ] **Step 6: Commit**

```bash
git add server.js views/edit.ejs
git commit -m "Add is_bundle/bundle_account_id fields, admin UI, and resolveBundleInfo helper"
```

---

### Task 2: Catalog card and detail page display

**Files:**
- Modify: `views/partials/game-card.ejs`
- Modify: `views/game-detail.ejs`
- Modify: `public/css/style.css`

**Interfaces:**
- Consumes: `resolveBundleInfo(game)` from Task 1, called directly in both views (it's an `app.locals` function, so EJS resolves it by name with no import).
- Consumes: `.bundle-game-grid`/`.bundle-game-tile`/`.bundle-game-cover`/`.bundle-game-title` CSS classes, already defined at `public/css/style.css:2754-2757` from the earlier bundle-contents-page feature — reused verbatim, not redefined.

- [ ] **Step 1: Compute bundle info in `game-card.ejs`**

In `views/partials/game-card.ejs`, the top `<%  ... %>` block currently ends with (around line 41-42):

```javascript
  const gcNeverRented = (game.renters || 0) === 0;
  const gcShowDaysLeft = gcIsNew && gcNeverRented;
%>
```

Change to:

```javascript
  const gcNeverRented = (game.renters || 0) === 0;
  const gcShowDaysLeft = gcIsNew && gcNeverRented;
  const gcBundle = resolveBundleInfo(game);
%>
```

- [ ] **Step 2: Swap the platform line for the bundle line**

In the same file, the platform/genre line currently reads:

```html
    <div class="gc2-plat"><%= game.platform %><%= game.genre ? ' · ' + game.genre.split('/')[0].trim() : '' %></div>
```

Change to:

```html
    <div class="gc2-plat<%= gcBundle ? ' gc2-plat-bundle' : '' %>"><%= gcBundle ? ('Bundle · ' + gcBundle.count + ' games') : (game.platform + (game.genre ? ' · ' + game.genre.split('/')[0].trim() : '')) %></div>
```

- [ ] **Step 3: Swap the price line for the bundle price line**

In the same file, the price footer currently reads:

```html
      <% if (gcStartPrice) { %>
      <div class="gc2-price">from <b>₱<%= gcStartPrice %></b><% if (gcStartWas) { %><s class="gc2-price-was">₱<%= gcStartWas %></s><% } %></div>
      <% } else { %>
      <div class="gc2-price">See pricing</div>
      <% } %>
```

Change to:

```html
      <% if (gcBundle && gcStartPrice) { %>
      <div class="gc2-price"><%= gcBundle.count %> games from <b>₱<%= gcStartPrice %></b><% if (gcStartWas) { %><s class="gc2-price-was">₱<%= gcStartWas %></s><% } %></div>
      <% } else if (gcStartPrice) { %>
      <div class="gc2-price">from <b>₱<%= gcStartPrice %></b><% if (gcStartWas) { %><s class="gc2-price-was">₱<%= gcStartWas %></s><% } %></div>
      <% } else { %>
      <div class="gc2-price">See pricing</div>
      <% } %>
```

- [ ] **Step 4: Add the bundle plat-line color to CSS**

In `public/css/style.css`, immediately after line 2207 (`.gc2-plat { font-size: 0.62rem; font-weight: 700; color: var(--ps-blue); text-transform: uppercase; letter-spacing: 0.6px; }`), add:

```css
.gc2-plat-bundle { color: #7fc7e8; }
```

- [ ] **Step 5: Add the "Games included" section to `game-detail.ejs`**

In `views/game-detail.ejs`, find the block (currently lines 131-133):

```html
      <h1 class="gd-title"><%= game.title %></h1>
      <% if (game.description) { %><p class="gd-desc"><%= game.description %></p><% } %>
      <% if (game.link_url) { %><a href="<%= game.link_url %>" target="_blank" rel="noopener" class="spotlight-link" style="display:inline-block;margin-bottom:1.25rem;">🔗 <%= game.link_label || 'Learn More' %> →</a><% } %>
```

Insert this block immediately after it, before the `<!-- ══ TOP TOGGLE: Rent / Buy Permanent ══ -->` comment:

```html
      <%
        const gdBundle = resolveBundleInfo(game);
      %>
      <% if (gdBundle) { %>
      <div style="margin-bottom:1.25rem;">
        <div class="gd-section-label">GAMES INCLUDED — <%= gdBundle.count %> TOTAL</div>
        <div class="bundle-game-grid">
          <% gdBundle.games.forEach(g => { %>
          <div class="bundle-game-tile">
            <% if (g.cover_image) { %><img src="<%= g.cover_image %>" alt="<%= g.title %>" class="bundle-game-cover" loading="lazy">
            <% } else { %><div class="bundle-game-cover buy-cover-placeholder"></div><% } %>
            <div class="bundle-game-title"><%= g.title %></div>
          </div>
          <% }) %>
        </div>
      </div>
      <% } %>
```

- [ ] **Step 6: Verify**

```bash
node -c server.js
node -e "require('ejs').compile(require('fs').readFileSync('views/partials/game-card.ejs','utf8'))"
node -e "require('ejs').compile(require('fs').readFileSync('views/game-detail.ejs','utf8'))"
```

All three must pass with no output. Then, against the live/deployed site (after confirming Task 1's admin steps were saved for "PS HUB Main Account" — if not yet done, do it now as part of this verification): visit `/browse` and `/` and confirm the PS HUB Main Account card shows "Bundle · 12 games" in the platform-line color and "12 games from ₱299" in the price footer, with cover art, slot chips, corner badges ("Last slot"/"Rented" if applicable), and the Rent CTA all unchanged from a normal card. Visit `/game/ps-hub-main-account` and confirm the "Games included" section renders all 12 non-self-referential games (same count and list the `/bundle/ps-hub-main-account` page from the earlier buy-catalog feature already shows), positioned above the Rent/Buy toggle, and that the rest of the page (price header, rental type selector, duration picker, reservation box) is unchanged. Confirm a normal, non-bundle game's card and detail page are pixel-identical to before this change (e.g. `007 First Light`).

- [ ] **Step 7: Commit**

```bash
git add views/partials/game-card.ejs views/game-detail.ejs public/css/style.css
git commit -m "Show bundle badge, games-included grid, and adjusted pricing line for bundle games"
```

---

### Task 3: Deploy and verify live

**Files:** None (deployment + verification only).

- [ ] **Step 1: Push to `main`**

```bash
git push origin main
```

- [ ] **Step 2: Wait for Railway to roll over**

Poll `https://playstation-hub.com/browse` until it returns 200 with the new markup (e.g. `curl -s https://playstation-hub.com/browse | grep -q "gc2-plat-bundle"` succeeds), same pattern used for prior deploys this session.

- [ ] **Step 3: Live-verify the full flow**

Log into `/admin`, mark "PS HUB Main Account" as a bundle linked to its account (if not already done during Task 1/2 verification — confirm it's still set after the deploy, since a redeploy does not touch data). Then:
- Visit `/browse` and `/`, confirm the card shows "Bundle · 12 games" and "12 games from ₱299" (or whatever the current live NT price is).
- Visit `/game/ps-hub-main-account`, confirm the games-included grid renders correctly above the pricing/rent flow, and that renting still works exactly as before (the order form, duration picker, and CTA are untouched — no need to complete a real test order, just confirm the controls render and are interactive).
- Confirm an ordinary game (e.g. `007 First Light`) is visually unchanged on both `/browse` and its own detail page.
- Confirm the admin edit page's checkbox + account dropdown still round-trip correctly after the deploy.
