# Buy Catalog (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public `/buy` page listing account bundles (opted-in accounts with open slots) and single games, with online checkout that reuses the existing order/payment/QR-signin lifecycle end-to-end.

**Architecture:** Two new fields on `accounts` (`for_sale`, `public_name`) gate what's public. One new route+view for the catalog page. One new order-creation route (`POST /order/buy`) parallel to the existing `/order/create`/`/order/reserve`/`/order/create-psplus`. The shared owner-queue advance handler (`/admin/orders/:ref/advance`) gains an `is_buy` branch alongside its existing `is_psplus`/regular-game branches.

**Tech Stack:** Express, EJS, lowdb.

## Global Constraints

- Nothing is public until an account has `for_sale: true` — default `false`, opt-in only.
- `public_name` is a separate field from the internal `label`; falls back to `label` if unset so an opted-in account never renders blank.
- Only `trophy`/`non_trophy` slots are sold publicly in Phase 1 — `ps4_primary` is excluded from the public price row.
- A `rented` or `buyed` slot still renders on its bundle card (struck through, disabled), not hidden — visible scarcity.
- Buy orders have no `days`/`end_date` — reuses the existing order lifecycle unchanged; `end_date: ''` is already excluded by the existing `advanceEndedRentals()` sweep (`end_date: { $lt: today, $ne: '' }`), so no new sweep logic.
- Single-game buy price applies the existing `promo.buy_promo_enabled`/`buy_promo_pct` discount (matching what the game-detail page's Buy panel already quotes). Bundle/account prices are flat — accounts have no promo field, so no discount applies there.
- "Build your own bundle" and "Request a game" are static Messenger-link cards in Phase 1 — no new logic.
- Server-side re-validates a bundle slot is still `open` at order-creation time (race: two customers viewing a stale page).

---

### Task 1: Account fields + admin form

**Files:**
- Modify: `server.js` — `normalizeAccount()` (~line 535), `POST /admin/accounts/add` (~line 3184), `POST /admin/accounts/edit/:id` (~line 3207)
- Modify: `views/accounts.ejs` — the "+ Add Account" form (~line 102-123) and the inline edit form (~line 226-244)

**Interfaces:**
- Produces: every account object returned by `getAccounts()`/`getAccount()` now always has `for_sale: boolean` and `public_name: string` (defaulted by `normalizeAccount()`, same pattern as its existing `email`/`game_ids` defaults).

- [ ] **Step 1: Default the two fields in `normalizeAccount()`**

In `server.js`, find:
```js
function normalizeAccount(a) {
  if (!a) return a;
  a.slots = a.slots || {};
  ACCOUNT_SLOT_TYPES.forEach(t => {
    if (!a.slots[t]) a.slots[t] = blankSlot(true);
    if (!ACCOUNT_STATUSES.includes(a.slots[t].status)) a.slots[t].status = 'open';
  });
  a.game_ids = Array.isArray(a.game_ids) ? a.game_ids : [];
  a.email = a.email || '';
  return a;
}
```
Add two lines before `return a;`:
```js
  a.for_sale = a.for_sale === true;
  a.public_name = a.public_name || '';
```

- [ ] **Step 2: Accept the fields on account creation**

In `server.js`, find `app.post('/admin/accounts/add', ...)`:
```js
app.post('/admin/accounts/add', requireAuth, (req, res) => {
  const { label, games_text, game_ids, note, email, price_permanent_tr, price_permanent_nt,
    enable_trophy, enable_non_trophy, enable_ps4_primary } = req.body;
  if (!label || !label.trim()) return res.redirect('/admin/accounts?msg=error');
  db.get('accounts').push({
    id: newAccountId(),
    label: label.trim(),
    games_text: games_text || '',
    game_ids: parseGameIds(game_ids),
    note: note || '',
    email: (email || '').trim(),
    price_permanent_tr: parseInt(price_permanent_tr) || 5000,
    price_permanent_nt: parseInt(price_permanent_nt) || 4500,
    slots: {
      trophy: blankSlot(enable_trophy !== undefined),
      non_trophy: blankSlot(enable_non_trophy !== undefined),
      ps4_primary: blankSlot(enable_ps4_primary !== undefined)
    },
    created_at: new Date().toISOString()
  }).write();
  res.redirect('/admin/accounts?msg=account_added');
});
```
Replace with:
```js
app.post('/admin/accounts/add', requireAuth, (req, res) => {
  const { label, games_text, game_ids, note, email, price_permanent_tr, price_permanent_nt,
    enable_trophy, enable_non_trophy, enable_ps4_primary, for_sale, public_name } = req.body;
  if (!label || !label.trim()) return res.redirect('/admin/accounts?msg=error');
  db.get('accounts').push({
    id: newAccountId(),
    label: label.trim(),
    games_text: games_text || '',
    game_ids: parseGameIds(game_ids),
    note: note || '',
    email: (email || '').trim(),
    price_permanent_tr: parseInt(price_permanent_tr) || 5000,
    price_permanent_nt: parseInt(price_permanent_nt) || 4500,
    for_sale: for_sale === 'on',
    public_name: (public_name || '').trim(),
    slots: {
      trophy: blankSlot(enable_trophy !== undefined),
      non_trophy: blankSlot(enable_non_trophy !== undefined),
      ps4_primary: blankSlot(enable_ps4_primary !== undefined)
    },
    created_at: new Date().toISOString()
  }).write();
  res.redirect('/admin/accounts?msg=account_added');
});
```

- [ ] **Step 3: Accept the fields on account edit**

In `server.js`, find `app.post('/admin/accounts/edit/:id', ...)`:
```js
app.post('/admin/accounts/edit/:id', requireAuth, (req, res) => {
  const { label, games_text, game_ids, note, email, price_permanent_tr, price_permanent_nt,
    enable_trophy, enable_non_trophy, enable_ps4_primary } = req.body;
  const existing = getAccount(req.params.id);
  if (!existing) return res.redirect('/admin/accounts?msg=error');
  const slots = existing.slots;
  slots.trophy.enabled = enable_trophy !== undefined;
  slots.non_trophy.enabled = enable_non_trophy !== undefined;
  slots.ps4_primary.enabled = enable_ps4_primary !== undefined;
  db.get('accounts').find({ id: parseInt(req.params.id) }).assign({
    label: (label || existing.label).trim(),
    games_text: games_text !== undefined ? games_text : existing.games_text,
    game_ids: parseGameIds(game_ids),
    note: note !== undefined ? note : existing.note,
    email: email !== undefined ? email.trim() : existing.email,
    price_permanent_tr: price_permanent_tr !== undefined && price_permanent_tr !== '' ? (parseInt(price_permanent_tr) || 0) : existing.price_permanent_tr,
    price_permanent_nt: price_permanent_nt !== undefined && price_permanent_nt !== '' ? (parseInt(price_permanent_nt) || 0) : existing.price_permanent_nt,
    slots
  }).write();
  res.redirect('/admin/accounts?msg=account_updated');
});
```
Replace with:
```js
app.post('/admin/accounts/edit/:id', requireAuth, (req, res) => {
  const { label, games_text, game_ids, note, email, price_permanent_tr, price_permanent_nt,
    enable_trophy, enable_non_trophy, enable_ps4_primary, for_sale, public_name } = req.body;
  const existing = getAccount(req.params.id);
  if (!existing) return res.redirect('/admin/accounts?msg=error');
  const slots = existing.slots;
  slots.trophy.enabled = enable_trophy !== undefined;
  slots.non_trophy.enabled = enable_non_trophy !== undefined;
  slots.ps4_primary.enabled = enable_ps4_primary !== undefined;
  db.get('accounts').find({ id: parseInt(req.params.id) }).assign({
    label: (label || existing.label).trim(),
    games_text: games_text !== undefined ? games_text : existing.games_text,
    game_ids: parseGameIds(game_ids),
    note: note !== undefined ? note : existing.note,
    email: email !== undefined ? email.trim() : existing.email,
    price_permanent_tr: price_permanent_tr !== undefined && price_permanent_tr !== '' ? (parseInt(price_permanent_tr) || 0) : existing.price_permanent_tr,
    price_permanent_nt: price_permanent_nt !== undefined && price_permanent_nt !== '' ? (parseInt(price_permanent_nt) || 0) : existing.price_permanent_nt,
    for_sale: for_sale === 'on',
    public_name: public_name !== undefined ? public_name.trim() : existing.public_name,
    slots
  }).write();
  res.redirect('/admin/accounts?msg=account_updated');
});
```

- [ ] **Step 4: Add the fields to the "+ Add Account" form**

In `views/accounts.ejs`, find this line inside the add form's `.acc-edit-grid`:
```html
        <div><label>Internal note</label><input type="text" name="note" placeholder="reminders, misc info..."></div>
```
Add immediately after it (still inside `.acc-edit-grid`):
```html
        <div style="grid-column:1/-1;"><label>Public bundle name (leave blank to hide from Buy page)</label><input type="text" name="public_name" placeholder="e.g. Sports Pack"></div>
```
Then find the add form's slot-toggles block:
```html
      <div class="slot-toggles">
        <label><input type="checkbox" name="enable_trophy" checked> 🏆 Trophy slot</label>
        <label><input type="checkbox" name="enable_non_trophy" checked> 🎮 Non-Trophy slot</label>
        <label><input type="checkbox" name="enable_ps4_primary" checked> 🕹️ PS4 Primary slot</label>
      </div>
```
Add immediately after that closing `</div>`, still inside the `<form>`, before the submit button:
```html
      <label style="display:flex;align-items:center;gap:6px;margin-top:0.5rem;cursor:pointer;">
        <input type="checkbox" name="for_sale"> 🛒 List on the public Buy page
      </label>
```

- [ ] **Step 5: Add the fields to the inline edit form**

In `views/accounts.ejs`, find this line inside the edit form:
```html
                    <div><label>Note</label><input type="text" name="note" value="<%= acc.note %>"></div>
```
Add immediately after it:
```html
                    <div><label>Public bundle name</label><input type="text" name="public_name" value="<%= acc.public_name %>" placeholder="leave blank to hide"></div>
```
Then find the edit form's slot checkboxes:
```html
                    <label><input type="checkbox" name="enable_trophy" <%= acc.slots.trophy.enabled?'checked':'' %>> 🏆</label>
                    <label><input type="checkbox" name="enable_non_trophy" <%= acc.slots.non_trophy.enabled?'checked':'' %>> 🎮</label>
                    <label><input type="checkbox" name="enable_ps4_primary" <%= acc.slots.ps4_primary.enabled?'checked':'' %>> 🕹️</label>
```
Add immediately after the third line:
```html
                    <label><input type="checkbox" name="for_sale" <%= acc.for_sale?'checked':'' %>> 🛒 For sale</label>
```

- [ ] **Step 6: Verify**

Run: `node -c server.js` (expect no output) and `node -e "require('ejs').compile(require('fs').readFileSync('views/accounts.ejs','utf8')); console.log('OK')"` (expect `OK`).

- [ ] **Step 7: Commit**

```bash
git add server.js views/accounts.ejs
git commit -m "feat: for_sale/public_name fields on accounts, admin form"
```

---

### Task 2: Public `/buy` page

**Files:**
- Create: `views/buy.ejs`
- Modify: `server.js` — new `app.get('/buy', ...)` route (place it near `app.get('/browse', ...)`)
- Modify: `views/partials/nav.ejs` — add the nav link (both `.nav-links` and `.nav-drawer` blocks)

**Interfaces:**
- Consumes: `getAccounts()`, `getGames()`, `getSiteSettings()`, `getAnnouncement()`, `getAnnouncements()` (all existing helpers)
- Produces: no new interface consumed by later tasks — this view is a leaf. Checkout forms on this page post to `/order/buy`, built in Task 3; write the form actions now, they'll resolve once Task 3 lands.

- [ ] **Step 1: Add the route**

In `server.js`, add near `app.get('/browse', ...)`:
```js
app.get('/buy', (req, res) => {
  const allGames = getGames();
  const gameById = id => allGames.find(g => g.id === parseInt(id));
  const bundles = getAccounts()
    .filter(acc => acc.for_sale && ((acc.slots.trophy.enabled && acc.slots.trophy.status === 'open') || (acc.slots.non_trophy.enabled && acc.slots.non_trophy.status === 'open')))
    .map(acc => ({
      id: acc.id,
      name: acc.public_name || acc.label,
      gameCount: acc.game_ids.length,
      covers: acc.game_ids.map(gameById).filter(Boolean).slice(0, 4),
      moreCount: Math.max(0, acc.game_ids.length - 4),
      trophy: acc.slots.trophy.enabled ? { price: acc.price_permanent_tr, open: acc.slots.trophy.status === 'open' } : null,
      nonTrophy: acc.slots.non_trophy.enabled ? { price: acc.price_permanent_nt, open: acc.slots.non_trophy.status === 'open' } : null
    }));
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
    announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s
  });
});
```

- [ ] **Step 2: Create the view**

Write `views/buy.ejs`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Buy Permanent Access — Playstation Hub</title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
<%- include('partials/announcement') %>
<%- include('partials/nav', { active: 'buy' }) %>

<div class="buy-page">
  <h1 class="buy-title">Buy permanently</h1>
  <p class="buy-sub">Own it forever. No return date, no weekly fee.</p>

  <% if (bundles.length) { %>
  <div class="buy-section-label">Account bundles — best value</div>
  <div class="buy-bundle-grid">
    <% bundles.forEach(b => { %>
    <div class="buy-bundle-card">
      <div class="buy-bundle-head">
        <span class="buy-bundle-name"><%= b.name %></span>
        <span class="buy-bundle-count"><%= b.gameCount %> game<%= b.gameCount !== 1 ? 's' : '' %></span>
      </div>
      <div class="buy-bundle-covers">
        <% b.covers.forEach(g => { %>
          <% if (g.cover_image) { %><img src="<%= g.cover_image %>" alt="<%= g.title %>" class="buy-cover-thumb" loading="lazy">
          <% } else { %><div class="buy-cover-thumb buy-cover-placeholder"></div><% } %>
        <% }) %>
        <% if (b.moreCount > 0) { %><div class="buy-cover-thumb buy-cover-more">+<%= b.moreCount %></div><% } %>
      </div>
      <% if (b.nonTrophy) { %>
      <form method="POST" action="/order/buy" class="buy-slot-row<%= !b.nonTrophy.open ? ' buy-slot-sold' : '' %>">
        <input type="hidden" name="kind" value="bundle">
        <input type="hidden" name="account_id" value="<%= b.id %>">
        <input type="hidden" name="slot_type" value="nt">
        <span class="buy-slot-label">🎮 Non-Trophy</span>
        <span class="buy-slot-price">₱<%= b.nonTrophy.price %></span>
        <% if (b.nonTrophy.open) { %>
        <input type="text" name="fb_name" placeholder="Your Facebook name" class="buy-slot-name" required>
        <button type="submit" class="buy-slot-btn">Buy</button>
        <% } else { %><span class="buy-slot-status">Sold</span><% } %>
      </form>
      <% } %>
      <% if (b.trophy) { %>
      <form method="POST" action="/order/buy" class="buy-slot-row<%= !b.trophy.open ? ' buy-slot-sold' : '' %>">
        <input type="hidden" name="kind" value="bundle">
        <input type="hidden" name="account_id" value="<%= b.id %>">
        <input type="hidden" name="slot_type" value="tr">
        <span class="buy-slot-label">🏆 Trophy</span>
        <span class="buy-slot-price">₱<%= b.trophy.price %></span>
        <% if (b.trophy.open) { %>
        <input type="text" name="fb_name" placeholder="Your Facebook name" class="buy-slot-name" required>
        <button type="submit" class="buy-slot-btn">Buy</button>
        <% } else { %><span class="buy-slot-status">Sold</span><% } %>
      </form>
      <% } %>
    </div>
    <% }) %>
  </div>
  <% } %>

  <% if (singleGames.length) { %>
  <div class="buy-section-label">Single games</div>
  <div class="buy-single-grid">
    <% singleGames.forEach(g => { %>
    <a href="/game/<%= g.slug %>?mode=buy" class="buy-single-card">
      <% if (g.cover_image) { %><img src="<%= g.cover_image %>" alt="<%= g.title %>" class="buy-single-cover" loading="lazy">
      <% } else { %><div class="buy-single-cover buy-cover-placeholder"></div><% } %>
      <div class="buy-single-price">₱<%= g.price %><% if (g.was) { %> <s class="buy-single-was">₱<%= g.was %></s><% } %></div>
    </a>
    <% }) %>
  </div>
  <% } %>

  <div class="buy-placeholder-grid">
    <div class="buy-placeholder-card">
      <div class="buy-placeholder-title">📦 Build your own</div>
      <p class="buy-placeholder-text">Pick any 3 or more games and save. We put them on one account for you.</p>
      <a href="http://m.me/PlaystationHub00?text=Hi!%20I%20want%20to%20build%20my%20own%20bundle." target="_blank" rel="noopener" class="buy-placeholder-cta">Start building</a>
    </div>
    <div class="buy-placeholder-card buy-placeholder-amber">
      <div class="buy-placeholder-title">🛒 Don't see it?</div>
      <p class="buy-placeholder-text">We'll buy it for you. Pay first, we purchase and set up your account.</p>
      <a href="http://m.me/PlaystationHub00?text=Hi!%20I%20want%20to%20request%20a%20game%20to%20buy." target="_blank" rel="noopener" class="buy-placeholder-cta">Request a game</a>
    </div>
  </div>
</div>

<%- include('partials/footer') %>
</body>
</html>
```

- [ ] **Step 3: Add CSS**

Append to `public/css/style.css`:
```css
/* BUY PAGE */
.buy-page { max-width: 1000px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
.buy-title { font-size: 1.6rem; font-weight: 800; color: #fff; margin: 0 0 0.2rem; }
.buy-sub { font-size: 0.85rem; color: #888; margin: 0 0 1.75rem; }
.buy-section-label { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: #F0A500; margin: 0 0 0.75rem; }
.buy-bundle-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.85rem; margin-bottom: 2.25rem; }
.buy-bundle-card { background: #141414; border: 1px solid #2a2a2a; border-radius: 12px; padding: 0.9rem; }
.buy-bundle-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.6rem; }
.buy-bundle-name { font-size: 0.92rem; color: #fff; font-weight: 700; }
.buy-bundle-count { font-size: 0.72rem; color: #888; }
.buy-bundle-covers { display: flex; gap: 5px; margin-bottom: 0.7rem; }
.buy-cover-thumb { width: 40px; height: 54px; border-radius: 4px; object-fit: cover; background: #1c1c1c; flex-shrink: 0; }
.buy-cover-placeholder { background: linear-gradient(135deg, #1a1a2e, #111); }
.buy-cover-more { display: flex; align-items: center; justify-content: center; font-size: 0.7rem; color: #888; }
.buy-slot-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0; border-top: 1px solid #222; flex-wrap: wrap; }
.buy-slot-sold { opacity: 0.55; }
.buy-slot-label { font-size: 0.76rem; color: #ccc; flex-shrink: 0; }
.buy-slot-price { font-size: 0.82rem; color: #fff; font-weight: 700; margin-left: auto; }
.buy-slot-status { font-size: 0.72rem; color: #666; }
.buy-slot-name { flex-basis: 100%; background: #0d0d0d; border: 1px solid #222; border-radius: 6px; padding: 0.4rem 0.6rem; color: #fff; font-size: 0.8rem; }
.buy-slot-btn { flex-basis: 100%; background: #7b2ff7; color: #fff; font-weight: 700; font-size: 0.8rem; padding: 0.5rem 0; border: none; border-radius: 6px; cursor: pointer; }
.buy-single-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 0.6rem; margin-bottom: 2rem; }
.buy-single-card { display: block; text-decoration: none; }
.buy-single-cover { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 8px; margin-bottom: 0.35rem; }
.buy-single-price { font-size: 0.8rem; color: #fff; font-weight: 700; }
.buy-single-was { font-size: 0.7rem; color: #555; font-weight: 400; margin-left: 0.3rem; }
.buy-placeholder-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.85rem; }
.buy-placeholder-card { background: #10141c; border: 1px solid #24304a; border-radius: 12px; padding: 1rem; }
.buy-placeholder-amber { background: #1a1206; border-color: #4a3410; }
.buy-placeholder-title { font-size: 0.85rem; color: #fff; font-weight: 700; margin-bottom: 0.3rem; }
.buy-placeholder-text { font-size: 0.76rem; color: #888; line-height: 1.5; margin: 0 0 0.75rem; }
.buy-placeholder-cta { display: block; text-align: center; font-size: 0.76rem; border: 1px solid #2f4468; color: #7fb3ff; padding: 0.5rem 0; border-radius: 6px; text-decoration: none; }
.buy-placeholder-amber .buy-placeholder-cta { border-color: #6a4a12; color: #F0A500; }
```

- [ ] **Step 4: Add the nav link**

In `views/partials/nav.ejs`, find:
```html
    <a href="/ps-plus" class="<%= navActive === 'psplus' ? 'active' : '' %>">PS Plus Deluxe</a>
```
This line appears twice (main nav + drawer). After each occurrence, add:
```html
    <a href="/buy" class="<%= navActive === 'buy' ? 'active' : '' %>">Buy</a>
```

- [ ] **Step 5: Verify**

Run: `node -c server.js` and `node -e "require('ejs').compile(require('fs').readFileSync('views/buy.ejs','utf8')); console.log('OK')"`.

- [ ] **Step 6: Commit**

```bash
git add server.js views/buy.ejs views/partials/nav.ejs public/css/style.css
git commit -m "feat: public /buy catalog page (bundles + single games)"
```

---

### Task 3: Checkout route + order lifecycle integration

**Files:**
- Modify: `server.js` — new `app.post('/order/buy', ...)` route (place near `/order/create`), the shared advance handler (~line 1541-1610), `app.get('/order/:ref', ...)` route (no change needed — `signinSteps`/other context already passed; `is_buy` just needs to flow through `order` object which is already passed whole)
- Modify: `views/order-status.ejs` — `STEP_COPY`/row labels need an `is_buy` branch
- Modify: `views/partials/order-queue.ejs` — badge for buy orders, matching the existing `is_reservation`/`is_psplus` badge pattern

**Interfaces:**
- Consumes: `getAccount(id)`, `ACCOUNT_SLOT_TYPES`, `getSiteSettings()`, `getPromoDiscountPct`, `orders.create()`, `newCustomerId()` (all existing)
- Produces: orders created by this route carry `is_buy: true`, and either (`account_id` + `slot_type`: `'tr'|'nt'`) for a bundle purchase or (`game_id` + `account_type`: `'nt'|'tr'`) for a single-game purchase — `game_title` is always set (account's public name or game title).

- [ ] **Step 1: Add the checkout route**

In `server.js`, add near `app.post('/order/create', ...)`:
```js
// Creates a permanent-purchase order — either a specific account's open slot
// (bundle) or a single game (account assigned by the owner at activation,
// same as rentals already work). No days/end_date: reuses the existing
// order lifecycle unchanged, and an empty end_date is already excluded by
// advanceEndedRentals()'s own filter, so a bought order simply rests at
// 'active' forever with no new sweep logic.
app.post('/order/buy', async (req, res) => {
  if (rateLimited('order_create', clientIp(req), 10, 10 * 60 * 1000)) {
    return res.redirect('/buy?order_error=rate');
  }
  const { kind, fb_name } = req.body;
  const name = (fb_name || '').trim();
  if (!name) return res.redirect('/buy?order_error=1');

  if (kind === 'bundle') {
    const { account_id, slot_type } = req.body;
    const account = getAccount(account_id);
    const type = ['tr', 'nt'].includes(slot_type) ? slot_type : null;
    if (!account || !account.for_sale || !type) return res.redirect('/buy?order_error=1');
    const slotKey = type === 'tr' ? 'trophy' : 'non_trophy';
    const slot = account.slots[slotKey];
    // Re-check availability at order time — the page a customer loaded may be stale.
    if (!slot || !slot.enabled || slot.status !== 'open') return res.redirect('/buy?order_error=sold');
    const price = type === 'tr' ? account.price_permanent_tr : account.price_permanent_nt;
    if (!price) return res.redirect('/buy?order_error=1');
    try {
      const order = await orders.create({
        game_id: 'bundle_' + account.id,
        game_title: account.public_name || account.label,
        account_type: type,
        days: null,
        amount_due: price,
        deposit_due: 0,
        fb_name: name,
        session_id: req.sessionId || null,
        is_buy: true,
        account_id: account.id,
        slot_type: type
      });
      res.redirect('/order/' + order.ref + '?k=' + order.url_key);
    } catch (e) {
      console.error('[order buy bundle]', e.message);
      res.redirect('/buy?order_error=1');
    }
    return;
  }

  // Single game
  const { game_id, account_type } = req.body;
  const game = getGame(game_id);
  const type = ['nt', 'tr'].includes(account_type) ? account_type : null;
  if (!game || !type) return res.redirect('/buy?order_error=1');
  const base = type === 'tr' ? (game.buy_tr_price || 0) : (game.buy_nt_price || 0);
  if (!base) return res.redirect('/buy?order_error=1');
  const s = getSiteSettings();
  const promo = s.promo || {};
  const price = (promo.buy_promo_enabled && promo.buy_promo_pct > 0)
    ? Math.round(base * (1 - promo.buy_promo_pct / 100)) : base;
  try {
    const order = await orders.create({
      game_id: game.id,
      game_title: game.title,
      account_type: type,
      days: null,
      amount_due: price,
      deposit_due: 0,
      fb_name: name,
      session_id: req.sessionId || null,
      is_buy: true
    });
    res.redirect('/order/' + order.ref + '?k=' + order.url_key);
  } catch (e) {
    console.error('[order buy single]', e.message);
    res.redirect('/buy?order_error=1');
  }
});
```

- [ ] **Step 2: Guard the `active`-transition date math for orders with no `days`**

In `server.js`, find (inside `app.post('/admin/orders/:ref/advance', ...)`):
```js
  if (to === 'active') {
    // The rental clock starts when the owner actually signs them in, not when
    // the order was placed — a customer who paid overnight isn't billed for
    // hours they couldn't play. Both dates are Manila dates: on a UTC server
    // an ISO slice reports yesterday for the whole Manila morning.
    const start = new Date();
    const end = new Date(start.getTime() + order.days * 86400000);
    patch.start_date = orders.manilaDate(start);
    patch.end_date = orders.manilaDate(end);
  }
```
Replace with:
```js
  if (to === 'active') {
    // The rental clock starts when the owner actually signs them in, not when
    // the order was placed — a customer who paid overnight isn't billed for
    // hours they couldn't play. Both dates are Manila dates: on a UTC server
    // an ISO slice reports yesterday for the whole Manila morning.
    const start = new Date();
    patch.start_date = orders.manilaDate(start);
    // A buy order has no days — it has no end date either, and stays active
    // indefinitely (advanceEndedRentals() already skips rows with end_date: '').
    if (order.days) {
      const end = new Date(start.getTime() + order.days * 86400000);
      patch.end_date = orders.manilaDate(end);
    } else {
      patch.end_date = '';
    }
  }
```

- [ ] **Step 3: Add the `is_buy` branch to customer creation**

In `server.js`, find the block starting `if (to === 'active' && !order.customer_id) {` (the one that computes `const game = order.is_psplus ? null : getGame(order.game_id);` and pushes to `db.get('customers')`). Immediately before that whole `if (to === 'active' && !order.customer_id) { ... }` block, insert a new sibling block handling buy orders first, then change the existing block's condition so the two never both fire:

Replace:
```js
  if (to === 'active' && !order.customer_id) {
    const game = order.is_psplus ? null : getGame(order.game_id);
```
with:
```js
  if (to === 'active' && !order.customer_id && order.is_buy) {
    // Permanent purchase — no rental clock, status 'bought' instead of
    // 'renting'. A bundle-slot purchase also flips that specific account
    // slot to 'buyed', mirroring what the admin UI already does manually
    // for a Messenger-arranged sale (POST /admin/accounts/:id/slot/:type).
    const customerId = newCustomerId();
    db.get('customers').push({
      id: customerId,
      customer_name: order.fb_name,
      game_id: order.game_id,
      game_title: order.game_title,
      days: null,
      account_type: order.account_type,
      start_date: patch.start_date,
      end_date: '',
      price: order.amount_due || 0,
      status: 'bought',
      notes: 'Web purchase ' + order.ref,
      created_at: new Date().toISOString(),
      payments: order.amount_due > 0
        ? [{ amount: order.amount_due, date: patch.start_date, kind: 'purchase' }]
        : [],
    }).write();
    if (order.account_id && order.slot_type) {
      const account = getAccount(order.account_id);
      if (account) {
        const slotKey = order.slot_type === 'tr' ? 'trophy' : 'non_trophy';
        const slot = account.slots[slotKey];
        slot.status = 'buyed';
        slot.renter_id = customerId;
        slot.renter_name = order.fb_name;
        slot.start = ''; slot.end = '';
        account.slots[slotKey] = slot;
        db.get('accounts').find({ id: account.id }).assign({ slots: account.slots }).write();
      }
    }
    const linked = await orders.setCustomerId(order.ref, customerId);
    if (!linked) {
      console.error('[order->customer] setCustomerId failed for', order.ref, '— customer', customerId, 'created but not linked, re-advance could duplicate it');
    }
  }

  if (to === 'active' && !order.customer_id && !order.is_buy) {
    const game = order.is_psplus ? null : getGame(order.game_id);
```

Note: the existing block's closing brace stays exactly where it already is — only its opening condition (`if (to === 'active' && !order.customer_id) {` → `if (to === 'active' && !order.customer_id && !order.is_buy) {`) and the new block above it change. Do not touch anything inside the existing block's body.

- [ ] **Step 4: Add `is_buy` copy to `order-status.ejs`**

In `views/order-status.ejs`, find the `STEP_COPY` object (the one with `awaiting_payment`, `verifying_payment`, `awaiting_qr`, etc. keys) and the `rentLabel` line beneath it:
```js
  const rentLabel = order.is_reservation ? (order.upcoming_game_id ? 'Reservation downpayment' : 'Priority reservation fee') : 'Rent';
```
Replace with:
```js
  const rentLabel = order.is_buy ? 'Purchase price' : (order.is_reservation ? (order.upcoming_game_id ? 'Reservation downpayment' : 'Priority reservation fee') : 'Rent');
```
Find the `active` STEP_COPY entry:
```js
    active:            { title: 'You\'re all set',         sub: 'Enjoy the game. Return the account by your end date.' },
```
This entry is shared by rentals and purchases (both reach `active`); a buy order's sub-line is wrong ("Return the account" doesn't apply to something you own). Change the `active` block in the rendered body — find:
```html
  <% if (order.state === 'active') { %>
  <div class="ord-step">
    <div class="ord-step-label">You're renting now</div>
    <div class="ord-row"><span>Rented since</span><span><%= order.start_date %></span></div>
    <div class="ord-row"><span>Return by</span><span><%= order.end_date %></span></div>
  </div>
  <% } %>
```
Replace with:
```html
  <% if (order.state === 'active' && order.is_buy) { %>
  <div class="ord-step">
    <div class="ord-step-label">It's yours</div>
    <p class="ord-help">Purchased on <%= order.start_date %>. No return date — enjoy it.</p>
  </div>
  <% } else if (order.state === 'active') { %>
  <div class="ord-step">
    <div class="ord-step-label">You're renting now</div>
    <div class="ord-row"><span>Rented since</span><span><%= order.start_date %></span></div>
    <div class="ord-row"><span>Return by</span><span><%= order.end_date %></span></div>
  </div>
  <% } %>
```
Also update the `STEP_COPY.active` sub-line so the header above the card is accurate for both cases — find:
```js
    active:            { title: 'You\'re all set',         sub: 'Enjoy the game. Return the account by your end date.' },
```
Replace with:
```js
    active:            { title: 'You\'re all set',         sub: order.is_buy ? 'It\'s yours — enjoy!' : 'Enjoy the game. Return the account by your end date.' },
```

- [ ] **Step 5: Badge buy orders in the admin owner queue**

In `views/partials/order-queue.ejs`, find:
```html
        <% if (o.is_reservation) { %>
        <span class="oq-badge" style="background:#3a1a5c;color:#c9a4ff;"><%= o.upcoming_game_id ? '🔜 Coming Soon reservation' : '⭐ Priority reservation' %></span>
        <% } %>
```
Add immediately after that closing `<% } %>`:
```html
        <% if (o.is_buy) { %>
        <span class="oq-badge" style="background:#2a0a3a;color:#d9a7f0;">♾️ Purchase</span>
        <% } %>
```

- [ ] **Step 6: Verify**

Run: `node -c server.js` and
```bash
node -e "
const ejs = require('ejs');
const fs = require('fs');
['views/order-status.ejs','views/partials/order-queue.ejs'].forEach(f => { ejs.compile(fs.readFileSync(f,'utf8')); console.log(f, 'OK'); });
"
```
Expect both `OK` and no `node -c` output.

- [ ] **Step 7: Commit**

```bash
git add server.js views/order-status.ejs views/partials/order-queue.ejs
git commit -m "feat: online checkout for permanent purchases (bundle slots + single games)"
```

---

### Task 4: Deploy and verify live

**Files:** none (verification only)

- [ ] **Step 1: Push to main**

```bash
git push
```

- [ ] **Step 2: Wait for Railway rollover**

Poll `curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/` every ~10s until `200`, then wait ~25-30s more.

- [ ] **Step 3: Set up one real test account for sale**

Log into `/admin` (password `Ryuzaki2300`) → Accounts. Edit an existing account (or add a throwaway one): tick "For sale", set a public bundle name, confirm at least one of its Trophy/Non-Trophy slots is enabled and status `open`, link a couple of `game_ids` if it has none. Note the account's id and which slot is open.

- [ ] **Step 4: Verify the `/buy` page live**

Visit `https://playstation-hub.com/buy`. Confirm: the test account's bundle card appears with its public name (not internal label), cover thumbnails, the open slot showing a Buy button and price, and any non-enabled/non-open slot either absent (if disabled) or struck-through with "Sold" (if enabled but not open). Confirm the Single games section lists every game with a buy price. Confirm the two placeholder cards render and their Messenger links open correctly. Confirm the `/buy` nav link is present and highlights active.

- [ ] **Step 5: Verify bundle checkout end-to-end**

Submit the test account's open-slot Buy form with a test name. Confirm it lands on `/order/<ref>?k=...` showing "Purchase price" (not "Rent"), the correct price, no duration row. Confirm the account's slot the request targeted no longer shows as available on `/buy` (a second load of the page should now show it sold, since the order hasn't confirmed payment yet — check the plan's re-validation logic: at this stage the slot is still `open` server-side, only the checkout re-check happens at order-creation, not immediately reserving it — note this as expected Phase-1 behavior, not a bug, and mention it in the final report).

Advance the order through the admin queue exactly like prior order-type tests this session (`/order/:ref/payment-proof` with `channel=messenger`, then `/admin/orders/:ref/advance` through to `active` — for buy orders `active` is reached directly from `qr_pending` after a QR upload, same as rentals; use the same synthetic-image-upload technique established earlier in this session for the QR step). Confirm: the order badge in the admin queue reads "♾️ Purchase", the order reaches `active` and shows "It's yours" with no return-date row, a customer record was created with `status: 'bought'`, and the account's slot now shows `buyed` in `/admin/accounts`. Clean up the test order/customer afterward and restore the slot to `open`.

- [ ] **Step 6: Verify single-game checkout**

Find a game with a buy price on `/buy`, click through to its game-detail page's Buy panel (confirm the link lands correctly with `?mode=buy`), and separately submit a test single-game purchase via `/order/buy` (kind not `bundle`) directly to confirm the promo-aware pricing matches what the game-detail page quotes for the same game. Clean up the test order afterward.
