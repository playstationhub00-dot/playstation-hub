# Bundle Contents Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each `for_sale` bundle its own shareable page at `/bundle/:slug` listing every included game, and link to it from the `/buy` bundle cards.

**Architecture:** Two small pure functions in `server.js` (`buildBundleGames`, `bundleSavings`) shared between the existing `/buy` route and a new `/bundle/:slug` route, so both compute game counts, covers, and pricing the same way. `/buy`'s bundle card gets its name/covers wrapped in a link to the new page; the tier-picker/buy form stays untouched and still posts from the card itself. The new page reuses the same tier-picker markup.

**Tech Stack:** Express.js route + EJS view, matching every existing public route in this file (`/buy`, `/game/:slug`, `/browse`).

## Global Constraints

- Slug for a bundle is `gameSlug(acc.public_name || acc.label)` — the exact function already defined at `server.js:1156`, reused verbatim, not reimplemented.
- Only accounts with `acc.for_sale === true` resolve on `/bundle/:slug`; anything else redirects to `/buy` (same 404-as-redirect pattern `/game/:slug` already uses at `server.js:1909`).
- A linked game is excluded from a bundle's game list, count, covers, and price sum when its title case-insensitively equals the bundle's own display name (`public_name || label`).
- The price-savings line only renders when **every** included game has a buy price (`buy_nt_price > 0 || buy_tr_price > 0`) **and** the summed per-game price (using `buy_nt_price > 0 ? buy_nt_price : buy_tr_price` per game, the same selection `/buy`'s single-game cards already use at `server.js:1111`) exceeds the bundle's own price for the comparison tier. Otherwise fall back to the existing "from ₱X per game" line — never show a partial or understated total.
- Individual games on the bundle page are not clickable — cover + title only, no link to `/game/:slug`.
- No changes to `/order/buy`, `lib/orders.js`, or the order lifecycle.

---

### Task 1: Shared bundle-building helpers + wire into `/buy`

**Files:**
- Modify: `server.js:1081-1120` (the `/buy` route)
- Modify: `views/buy.ejs:26-39` (bundle card head + covers)

**Interfaces:**
- Produces: `buildBundleGames(acc, allGames)` → `Array<game>` (full game objects from the catalog, self-referential entry excluded, in `acc.game_ids` order).
- Produces: `bundleSlotInfo(acc)` → `{ trophy: {price, open, status} | null, nonTrophy: {price, open, status} | null }`.
- Produces: `bundleSavings(games, bundlePrice)` → `{ sum, save } | null`.
- Consumes (Task 2): all three functions, plus the `bundles` object shape (`id, slug, name, gameCount, perGame, covers, moreCount, trophy, nonTrophy`) that `/buy` builds — Task 2's `/bundle/:slug` route builds the equivalent single-bundle object using the same three helpers.

- [ ] **Step 1: Add the three helper functions immediately above the `/buy` route**

In `server.js`, insert directly before the `app.get('/buy', ...)` line (currently line 1081):

```javascript
// Shared by /buy (summary cards) and /bundle/:slug (full page) so both compute
// game lists and prices the same way. Some accounts (e.g. "PS HUB Main
// Account") have a catalog game entry with the same title as the account
// itself, linked into their own game_ids — that entry is excluded everywhere
// a bundle's game list is shown, so a bundle never appears to contain itself.
function buildBundleGames(acc, allGames) {
  const gameById = id => allGames.find(g => g.id === parseInt(id));
  const displayName = (acc.public_name || acc.label || '').trim().toLowerCase();
  return acc.game_ids
    .map(gameById)
    .filter(Boolean)
    .filter(g => g.title.trim().toLowerCase() !== displayName);
}

function bundleSlotInfo(acc) {
  const trophy = acc.slots.trophy.enabled
    ? { price: acc.price_permanent_tr, open: acc.slots.trophy.status === 'open', status: acc.slots.trophy.status } : null;
  const nonTrophy = acc.slots.non_trophy.enabled
    ? { price: acc.price_permanent_nt, open: acc.slots.non_trophy.status === 'open', status: acc.slots.non_trophy.status } : null;
  return { trophy, nonTrophy };
}

// Sum of what each game would cost bought individually (same NT-first price
// selection /buy's single-game cards use) vs. the bundle's own price. A
// partial sum would understate the bundle and undercut its own pitch, so
// this returns null the moment any game lacks a buy price — callers fall
// back to the plain per-game-count line instead of showing nothing wrong.
function bundleSavings(games, bundlePrice) {
  if (!games.length || !bundlePrice) return null;
  let sum = 0;
  for (const g of games) {
    const price = g.buy_nt_price > 0 ? g.buy_nt_price : g.buy_tr_price;
    if (!price) return null;
    sum += price;
  }
  return sum > bundlePrice ? { sum, save: sum - bundlePrice } : null;
}
```

- [ ] **Step 2: Rewrite the `/buy` route's bundle-building block to use the helpers**

Replace the existing route body (`server.js:1081-1120`) with:

```javascript
app.get('/buy', (req, res) => {
  const allGames = getGames();
  const bundles = getAccounts()
    .filter(acc => acc.for_sale && (acc.slots.trophy.enabled || acc.slots.non_trophy.enabled))
    .map(acc => {
      const games = buildBundleGames(acc, allGames);
      const { trophy, nonTrophy } = bundleSlotInfo(acc);
      const prices = [trophy, nonTrophy].filter(x => x && x.price > 0).map(x => x.price);
      const gameCount = games.length;
      const name = acc.public_name || acc.label;
      return {
        id: acc.id,
        slug: gameSlug(name),
        name,
        gameCount,
        perGame: gameCount > 1 && prices.length ? Math.round(Math.min(...prices) / gameCount) : null,
        covers: games.slice(0, 4),
        moreCount: Math.max(0, gameCount - 4),
        trophy,
        nonTrophy
      };
    });
  const s = getSiteSettings();
  const promo = s.promo || {};
  const buyPromo = promo.buy_promo_enabled && promo.buy_promo_pct > 0;
  const singleGames = allGames
    .filter(g => (g.buy_nt_price || 0) > 0 || (g.buy_tr_price || 0) > 0)
    .map(g => {
      const base = g.buy_nt_price > 0 ? g.buy_nt_price : g.buy_tr_price;
      const final = buyPromo ? Math.round(base * (1 - promo.buy_promo_pct / 100)) : base;
      return { id: g.id, title: g.title, cover_image: g.cover_image, price: final, was: buyPromo ? base : null, slug: gameSlug(g.title) };
    });
  res.render('buy', {
    bundles, singleGames, buyPromo, buyPromoPct: promo.buy_promo_pct || 0,
    announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s,
    orderError: req.query.order_error || null
  });
});
```

Note what changed from the current code: `gameCount` and `covers` now come from `games` (the filtered list) instead of `acc.game_ids` directly, and each bundle object gains a `slug` field. The `moreCount` math (`gameCount - 4`) is unchanged, just now based on the filtered count.

- [ ] **Step 3: Link the bundle card's name and covers to the new page**

In `views/buy.ejs`, the card currently opens (lines 27-39):

```html
    <div class="buy-bundle-card">
      <div class="buy-bundle-head">
        <span class="buy-bundle-name"><%= b.name %></span>
        <span class="buy-bundle-count"><%= b.gameCount %> game<%= b.gameCount !== 1 ? 's' : '' %></span>
      </div>
      <% if (b.perGame) { %><div class="buy-bundle-each">from ₱<%= b.perGame %> per game</div><% } %>
      <div class="buy-bundle-covers">
        <% b.covers.forEach(g => { %>
          <% if (g.cover_image) { %><img src="<%= g.cover_image %>" alt="<%= g.title %>" class="buy-cover-thumb" loading="lazy">
          <% } else { %><div class="buy-cover-thumb buy-cover-placeholder"></div><% } %>
        <% }) %>
        <% if (b.moreCount > 0) { %><div class="buy-cover-thumb buy-cover-more">+<%= b.moreCount %></div><% } %>
      </div>
```

Replace it with (the `<a>` wraps only the head and covers, kept outside the `<form>` that follows so the form's own validity is untouched):

```html
    <div class="buy-bundle-card">
      <a href="/bundle/<%= b.slug %>" class="buy-bundle-link">
        <div class="buy-bundle-head">
          <span class="buy-bundle-name"><%= b.name %></span>
          <span class="buy-bundle-count"><%= b.gameCount %> game<%= b.gameCount !== 1 ? 's' : '' %></span>
        </div>
        <% if (b.perGame) { %><div class="buy-bundle-each">from ₱<%= b.perGame %> per game</div><% } %>
        <div class="buy-bundle-covers">
          <% b.covers.forEach(g => { %>
            <% if (g.cover_image) { %><img src="<%= g.cover_image %>" alt="<%= g.title %>" class="buy-cover-thumb" loading="lazy">
            <% } else { %><div class="buy-cover-thumb buy-cover-placeholder"></div><% } %>
          <% }) %>
          <% if (b.moreCount > 0) { %><div class="buy-cover-thumb buy-cover-more">+<%= b.moreCount %></div><% } %>
        </div>
      </a>
```

Everything from `<%
        const tiers = ...` (the form block) stays exactly as-is, just make sure the closing `</a>` above sits before it and the final `</div>` that closes `.buy-bundle-card` is unchanged.

- [ ] **Step 4: Add a no-underline style for the new link wrapper**

In `public/css/style.css`, immediately after line 2710 (`.buy-bundle-head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; margin-bottom: 0.15rem; }`), add:

```css
.buy-bundle-link { display: block; text-decoration: none; color: inherit; }
```

- [ ] **Step 5: Verify**

```bash
node -c server.js
node -e "require('ejs').compile(require('fs').readFileSync('views/buy.ejs','utf8'))"
```

Both must exit with no output/errors. Then start the app locally or check via the live site once deployed that `/buy` still renders bundle cards with the tier picker working exactly as before, and that the bundle name/covers are now a clickable link (even though `/bundle/:slug` doesn't exist yet — that's fine, Task 2 adds it; confirm the link's `href` looks right, e.g. `/bundle/ps-hub-main-account`).

- [ ] **Step 6: Commit**

```bash
git add server.js views/buy.ejs public/css/style.css
git commit -m "Extract shared bundle-building helpers; link bundle cards to /bundle/:slug"
```

---

### Task 2: `/bundle/:slug` route, view, and styles

**Files:**
- Modify: `server.js` (new route, placed directly after the `/buy` route)
- Create: `views/bundle.ejs`
- Modify: `public/css/style.css` (new `.bundle-*` rules)

**Interfaces:**
- Consumes: `buildBundleGames`, `bundleSlotInfo`, `bundleSavings`, `gameSlug`, `getAccounts`, `getGames`, `getSiteSettings`, `getAnnouncement`, `getAnnouncements` — all from Task 1 / already-existing code, unchanged signatures.
- Consumes: the same `/order/buy` POST route and `slotStatusLabel` inline helper pattern already used in `views/buy.ejs` (the `st === 'rented' ? 'Rented' : ...` ternary) — reimplemented identically in `views/bundle.ejs` since EJS templates don't share local scope across files.

- [ ] **Step 1: Add the `/bundle/:slug` route**

In `server.js`, insert immediately after the closing `});` of the `/buy` route (the route Task 1 rewrote):

```javascript
app.get('/bundle/:slug', (req, res) => {
  const allGames = getGames();
  const acc = getAccounts().find(a => a.for_sale && gameSlug(a.public_name || a.label) === req.params.slug);
  if (!acc) return res.redirect('/buy');
  const name = acc.public_name || acc.label;
  const games = buildBundleGames(acc, allGames);
  const { trophy, nonTrophy } = bundleSlotInfo(acc);
  const prices = [trophy, nonTrophy].filter(x => x && x.price > 0).map(x => x.price);
  const gameCount = games.length;
  const comparePrice = nonTrophy && nonTrophy.price > 0 ? nonTrophy.price : (trophy ? trophy.price : 0);
  const bundle = {
    id: acc.id,
    slug: req.params.slug,
    name,
    gameCount,
    perGame: gameCount > 1 && prices.length ? Math.round(Math.min(...prices) / gameCount) : null,
    savings: bundleSavings(games, comparePrice),
    games,
    trophy,
    nonTrophy
  };
  const s = getSiteSettings();
  res.render('bundle', {
    bundle,
    announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s,
    orderError: req.query.order_error || null
  });
});
```

- [ ] **Step 2: Create `views/bundle.ejs`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= bundle.name %> — Playstation Hub</title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
</head>
<body>
<%- include('partials/announcement') %>
<%- include('partials/nav', { active: 'buy' }) %>

<div class="buy-page bundle-page">
  <div class="bundle-crumb"><a href="/buy">Buy</a> › <%= bundle.name %></div>

  <% if (orderError === 'sold') { %><div class="ord-flash ord-flash-warn">That slot just sold — sorry! Pick another below.</div><% } %>
  <% if (orderError === 'rate') { %><div class="ord-flash ord-flash-warn">Too many attempts, please wait a moment and try again.</div><% } %>
  <% if (orderError && orderError !== 'sold' && orderError !== 'rate') { %><div class="ord-flash ord-flash-warn">Something went wrong, please try again.</div><% } %>

  <div class="bundle-layout">
    <div class="bundle-main">
      <h1 class="bundle-title"><%= bundle.name %></h1>
      <div class="bundle-meta"><%= bundle.gameCount %> game<%= bundle.gameCount !== 1 ? 's' : '' %></div>
      <% if (bundle.savings) { %>
      <div class="bundle-savings">₱<%= bundle.savings.sum.toLocaleString() %> if bought separately — save ₱<%= bundle.savings.save.toLocaleString() %></div>
      <% } else if (bundle.perGame) { %>
      <div class="buy-bundle-each">from ₱<%= bundle.perGame %> per game</div>
      <% } %>

      <div class="bundle-game-grid">
        <% bundle.games.forEach(g => { %>
        <div class="bundle-game-tile">
          <% if (g.cover_image) { %><img src="<%= g.cover_image %>" alt="<%= g.title %>" class="bundle-game-cover" loading="lazy">
          <% } else { %><div class="bundle-game-cover buy-cover-placeholder"></div><% } %>
          <div class="bundle-game-title"><%= g.title %></div>
        </div>
        <% }) %>
      </div>

      <button type="button" class="bundle-copy-btn" id="bundleCopyBtn" onclick="bundleCopyLink()">Copy link to share</button>
    </div>

    <div class="bundle-side">
      <%
        const slotStatusLabel = st => st === 'rented' ? 'Rented' : st === 'buyed' ? 'Sold' : 'Unavailable';
        const tiers = [
          bundle.nonTrophy ? { key: 'nt', label: 'Non-Trophy', slot: bundle.nonTrophy } : null,
          bundle.trophy ? { key: 'tr', label: 'Trophy', slot: bundle.trophy } : null
        ].filter(Boolean);
        const firstOpen = tiers.find(t => t.slot.open);
      %>
      <form method="POST" action="/order/buy" class="buy-bundle-foot">
        <input type="hidden" name="kind" value="bundle">
        <input type="hidden" name="account_id" value="<%= bundle.id %>">
        <div class="buy-tier-row">
          <% tiers.forEach(t => { %>
          <label class="buy-tier<%= t.slot.open ? '' : ' buy-tier-off' %>">
            <input type="radio" name="slot_type" value="<%= t.key %>" data-price="<%= t.slot.price %>"
              <%= t.slot.open ? '' : 'disabled' %><%= firstOpen && firstOpen.key === t.key ? ' checked' : '' %>>
            <span class="buy-tier-label"><%= t.label %></span>
            <span class="buy-tier-price">₱<%= t.slot.price %></span>
            <% if (!t.slot.open) { %><span class="buy-tier-status"><%= slotStatusLabel(t.slot.status) %></span><% } %>
          </label>
          <% }) %>
        </div>
        <% if (firstOpen) { %>
        <input type="text" name="fb_name" placeholder="Your Facebook name" class="buy-slot-name" required>
        <button type="submit" class="buy-slot-btn">Buy ₱<%= firstOpen.slot.price %></button>
        <% } else { %>
        <div class="buy-bundle-none"><%= tiers.length > 1 ? 'Both tiers taken right now' : 'Not available right now' %></div>
        <% } %>
      </form>
    </div>
  </div>
</div>

<%- include('partials/footer') %>
<script>
document.querySelectorAll('.buy-bundle-foot').forEach(function (form) {
  var btn = form.querySelector('.buy-slot-btn');
  var radios = form.querySelectorAll('input[name="slot_type"]');
  function sync() {
    radios.forEach(function (r) { r.closest('.buy-tier').classList.toggle('buy-tier-on', r.checked); });
    var picked = form.querySelector('input[name="slot_type"]:checked');
    if (btn && picked) btn.textContent = 'Buy ₱' + picked.dataset.price;
  }
  radios.forEach(function (r) { r.addEventListener('change', sync); });
  sync();
});
function bundleCopyLink() {
  var btn = document.getElementById('bundleCopyBtn');
  navigator.clipboard.writeText(window.location.href).then(function () {
    var original = btn.textContent;
    btn.textContent = 'Link copied';
    setTimeout(function () { btn.textContent = original; }, 2000);
  });
}
</script>
</body>
</html>
```

- [ ] **Step 3: Add bundle-page CSS**

In `public/css/style.css`, at the end of the file (after the last `.buy-placeholder-amber` rule, `.buy-placeholder-amber .buy-placeholder-cta { border-color: #6a4a12; color: #F0A500; }`), add:

```css
.bundle-crumb { font-size: 0.78rem; color: #888; margin-bottom: 1rem; }
.bundle-crumb a { color: #888; text-decoration: none; }
.bundle-crumb a:hover { color: #F0A500; }
.bundle-layout { display: grid; grid-template-columns: 1fr 280px; gap: 1.5rem; align-items: start; }
.bundle-main { min-width: 0; }
.bundle-title { font-size: 1.3rem; color: #fff; font-weight: 800; margin: 0 0 0.3rem; }
.bundle-meta { font-size: 0.8rem; color: #888; margin-bottom: 0.3rem; }
.bundle-savings { font-size: 0.85rem; color: #F0A500; font-weight: 700; margin-bottom: 1rem; }
.bundle-game-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.7rem; margin-bottom: 1.25rem; }
.bundle-game-tile { display: block; }
.bundle-game-cover { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 6px; margin-bottom: 0.3rem; }
.bundle-game-title { font-size: 0.72rem; color: #ccc; line-height: 1.3; }
.bundle-copy-btn { background: transparent; border: 1px solid #333; color: #a98bff; font-size: 0.78rem; font-weight: 700; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; }
.bundle-side { background: #141414; border: 1px solid #2a2a2a; border-radius: 12px; padding: 0.9rem; position: sticky; top: 1rem; }
@media (max-width: 720px) {
  .bundle-layout { grid-template-columns: 1fr; }
  .bundle-side { position: static; }
}
```

- [ ] **Step 4: Verify**

```bash
node -c server.js
node -e "require('ejs').compile(require('fs').readFileSync('views/bundle.ejs','utf8'))"
```

Both must pass with no output. Then, against the live/deployed site: visit `/buy`, click a bundle's name or covers, confirm it lands on `/bundle/<slug>` showing every game (not capped at 4), the correct tier prices, and that a slug for a `for_sale` account with a matching name resolves while a random slug (or a non-`for_sale` account's slug) redirects to `/buy`. Confirm the copy-link button copies the current URL (check via clipboard read or by pasting after clicking). Confirm the tier picker and Buy button behave identically to the `/buy` card (switching tiers updates the button price, submitting creates an order the same way).

- [ ] **Step 5: Commit**

```bash
git add server.js views/bundle.ejs public/css/style.css
git commit -m "Add /bundle/:slug page showing full bundle contents and per-game pricing"
```

---

### Task 3: Deploy and verify live

**Files:** None (deployment + verification only).

- [ ] **Step 1: Push to `main`**

```bash
git push origin main
```

- [ ] **Step 2: Wait for Railway to roll over, then confirm the deploy is live**

Poll `https://playstation-hub.com/buy` until it returns 200 with the new bundle-card link markup (e.g. `grep -o 'buy-bundle-link' <response>` returns a match), same pattern used for prior deploys this session.

- [ ] **Step 3: Live-verify the full flow**

Using an account already known to be `for_sale` (e.g. "PS Hub Main Account", account id 28, slug `ps-hub-main-account`, from earlier work this session):
- Visit `/buy`, confirm the bundle card's name/covers are a clickable link.
- Click through to `/bundle/ps-hub-main-account`, confirm all 12 non-self-referential games render (13 games minus the self-referential "PS HUB Main Account" entry), covers and titles are correct, and the self-referential entry is absent from both the grid and the game count.
- Confirm the per-game line or savings line renders correctly — as of this session only 2 of the 12 real games have buy prices set, so the savings block should NOT appear; the "from ₱X per game" line should show instead.
- Confirm the tier picker, Buy button, and Copy link button all work exactly as designed.
- Visit `/bundle/does-not-exist` and confirm it redirects to `/buy` rather than erroring.
- Confirm a non-`for_sale` account's slug also redirects to `/buy` (pick any account without `for_sale` ticked, compute its slug, hit it directly).
