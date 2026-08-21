# Admin Content Creation Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a bundle game creatable in one save instead of three pages, and turn the add-content menu into real navigation with grouped form fields.

**Architecture:** Task 1 adds the two missing bundle fields to the add form and to `POST /admin/add`'s handler — the narrow fix for the actual bug, shippable on its own. Tasks 2 and 3 move the add forms out of the 3,660-line `views/admin.ejs` onto their own pages (following the convention `views/edit.ejs` already sets) and convert the add-choice modal's scroll-jump cards into real links.

**Tech Stack:** Node/Express, lowdb, EJS. No new dependencies.

## Spec assumptions re-verified before writing this plan

The spec was written 2026-08-18; two commits touched `server.js` and `views/admin.ejs` since (`f482bf5`, `018b9d1` — both order actions, neither in the add flow). All four assumptions still hold, verified against current code:

| Assumption | Verified |
|---|---|
| `POST /admin/add` does not parse `is_bundle` / `bundle_account_id` | Confirmed — 0 occurrences in the handler body |
| The add-game form has neither field | Confirmed — 0 occurrences in the form block |
| The add-choice modal cards scroll-jump rather than navigate | Confirmed — 3 `scrollIntoView` calls |
| `views/edit.ejs` already establishes the standalone-admin-page convention | Confirmed — `GET /admin/edit/:id` renders it with `{ game, settings, priceCategories, accounts }` |

## Global Constraints

- `admin.ejs` already receives `accounts` in its render locals (`server.js:2506`, `accounts: getAccounts()`), so Task 1 needs no route change to populate the bundle picker.
- The bundle field markup mirrors `views/edit.ejs:215-230` exactly in structure and copy, differing only in element IDs (`add_` prefix instead of `edit_`) and in having no pre-selected state.
- The handler writes the two fields using the same shape `POST /admin/edit/:id` already uses: `is_bundle: is_bundle === 'on'` and `bundle_account_id: is_bundle === 'on' && bundle_account_id ? parseInt(bundle_account_id) : null`.
- Do not touch `cover_focal_x` / `cover_focal_y` (deliberately hardcoded to `50` on create, per the comment at the handler — a focal point cannot be chosen before the cover is visible), `remove_gallery` (nothing to remove on create), or `POST /admin/edit/:id`.
- No business logic changes: pricing maths, availability, and slot handling are untouched.

---

### Task 1: Bundle fields on the add path

The whole point of the sub-project. After this task a bundle is creatable in one save, provided the account already exists.

**Files:**
- Modify: `server.js` — `POST /admin/add` destructure and the `db.get('games').push({...})` object
- Modify: `views/admin.ejs:1275` — insert the bundle field group immediately before the Description field

**Interfaces:**
- Consumes: `accounts` (already in `admin.ejs`'s render locals).
- Produces: games created through the add form can carry `is_bundle: true` and a `bundle_account_id`, which `resolveBundleInfo()` and `findBundleContaining()` in `server.js` already consume unchanged.

- [ ] **Step 1: Add the two fields to the handler's destructure**

In `server.js`, find:

```js
    price_category_id, price_mode, cost, link_label, link_url } = req.body;
```

Replace with:

```js
    price_category_id, price_mode, cost, link_label, link_url,
    is_bundle, bundle_account_id } = req.body;
```

- [ ] **Step 2: Persist the two fields on the created game**

In the same handler, find the tail of the `db.get('games').push({...})` object:

```js
    release_date: (release_date || '').trim(),
    created_at: new Date().toISOString()
  }).write();
```

Replace with:

```js
    release_date: (release_date || '').trim(),
    // Marks this catalog entry as standing in for a whole account. Same shape
    // POST /admin/edit/:id writes, so a game created as a bundle here is
    // indistinguishable from one flagged as a bundle later via Edit.
    is_bundle: is_bundle === 'on',
    bundle_account_id: is_bundle === 'on' && bundle_account_id ? parseInt(bundle_account_id) : null,
    created_at: new Date().toISOString()
  }).write();
```

- [ ] **Step 3: Add the bundle field group to the add form**

In `views/admin.ejs`, find this line (currently line 1275):

```html
          <div class="form-group full"><label>Description (optional)</label><textarea name="description" placeholder="Short description of the game..."></textarea></div>
```

Insert immediately **before** it:

```html
          <div class="form-group full">
            <label>
              <input type="checkbox" name="is_bundle" id="add_bundle_chk"
                onchange="document.getElementById('add_bundle_account').style.display = this.checked ? 'block' : 'none'; if (!this.checked) { const s = document.querySelector('#add_bundle_account select'); if (s) s.value = ''; }">
              📦 This game represents an account bundle
            </label>
            <div id="add_bundle_account" style="display:none;margin-top:0.5rem;">
              <label>Bundle account</label>
              <% if (accounts.length) { %>
              <select name="bundle_account_id">
                <option value="">— Select account —</option>
                <% accounts.forEach(acc => { %>
                <option value="<%= acc.id %>"><%= acc.label %> (#<%= acc.id %>, <%= (acc.game_ids || []).length %> games)</option>
                <% }) %>
              </select>
              <% } else { %>
              <div style="font-size:0.8rem;color:#888;line-height:1.6;">
                No accounts exist yet — <a href="/admin/accounts" style="color:var(--ps-blue);">create one first</a>, then come back and link it here.
              </div>
              <% } %>
            </div>
          </div>
```

The empty-accounts branch is deliberate: an empty `<select>` would be a silent dead end, so the missing prerequisite is shown instead.

- [ ] **Step 4: Verify server syntax and template compile**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -c server.js && echo SERVER_OK && node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'))" && echo EJS_OK
```

Expected: `SERVER_OK` then `EJS_OK`.

- [ ] **Step 5: Verify the handler now reads and writes both fields**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && sed -n "/app.post('\/admin\/add'/,/^});/p" server.js | grep -cE "is_bundle|bundle_account_id"
```

Expected: `4` — twice in the destructure line, twice in the push object.

- [ ] **Step 6: Commit**

```bash
git add server.js views/admin.ejs
git commit -m "Allow creating a bundle game in one save from the add form"
```

- [ ] **Step 7: Deploy and verify live**

```bash
git push origin main
```

Poll for rollover:

```bash
for i in 1 2 3 4 5 6 7 8; do
  curl -s -o /dev/null -w "%{http_code}" "https://playstation-hub.com/" | grep -q 200 && echo "up (attempt $i)" && break
  echo "attempt $i"; sleep 20
done
```

Then with the Browser tool: log in at `https://playstation-hub.com/admin` (password `Ryuzaki2300` — admin sessions drop on every redeploy), open the Games tab, expand "Add New Game", and confirm the "📦 This game represents an account bundle" checkbox appears above Description. Tick it and confirm the account picker appears populated with real accounts. **Do not submit** — creating a real game writes to the production catalog.

---

### Task 2: Add-game moves to its own page

**Files:**
- Create: `views/add-game.ejs`
- Modify: `server.js` — new `GET /admin/add/game` route beside the existing `GET /admin/edit/:id` (`server.js:2726`)
- Modify: `views/admin.ejs` — delete the now-relocated inline form (the `<div id="add-game-form" class="form-card">` block and its enclosing accordion)

**Interfaces:**
- Consumes: Task 1's bundle field markup, moved into the new page as-is.
- Produces: `GET /admin/add/game` renders the form; `?bundle=1` pre-expands and pre-ticks the bundle section. Task 3's modal card links here.

- [ ] **Step 1: Add the route**

In `server.js`, immediately after the `GET /admin/edit/:id` route (which ends at line 2730), add:

```js
app.get('/admin/add/game', requireAuth, (req, res) => {
  res.render('add-game', {
    settings: getSiteSettings(),
    priceCategories: getPriceCategories(),
    accounts: getAccounts(),
    presetBundle: req.query.bundle === '1'
  });
});
```

- [ ] **Step 2: Create `views/add-game.ejs`**

Model the page shell on `views/edit.ejs` (same head, nav, and container), with the form body being the block currently at `views/admin.ejs:1198-1284` reorganised into five accordion sections. Create the file with exactly this content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Add Game — <%= settings.title %></title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
  <style>
    .afg-sec { border:1px solid #222; border-radius:14px; overflow:hidden; margin-bottom:0.75rem; }
    .afg-head { display:flex; align-items:center; justify-content:space-between; padding:0.85rem 1.25rem; cursor:pointer; user-select:none; background:#111; }
    .afg-head:hover { background:#161616; }
    .afg-title { font-weight:700; font-size:0.9rem; color:#fff; }
    .afg-desc { font-size:0.72rem; color:#555; margin-top:0.1rem; }
    .afg-arrow { color:#555; font-size:0.8rem; transition:transform 0.2s; }
    .afg-body { display:none; padding:1.25rem; }
    .afg-body.open { display:block; }
    .afg-head.open .afg-arrow { transform:rotate(180deg); }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo"><img src="<%= settings.logo_path %>" alt="<%= settings.title %>" /></a>
  <div class="nav-links">
    <a href="/browse">Browse Games</a>
    <a href="/admin" class="admin-btn">Admin Panel</a>
  </div>
</nav>

<div class="edit-container">
  <a href="/admin?tab=games" class="back-link">← Back to Admin</a>
  <h1>Add New Game</h1>

  <form method="POST" action="/admin/add" enctype="multipart/form-data">

    <div class="afg-sec">
      <div class="afg-head open" onclick="afgToggle(this)">
        <div><div class="afg-title">🎮 Basics</div><div class="afg-desc">Title, platform, genre, description</div></div>
        <span class="afg-arrow">▼</span>
      </div>
      <div class="afg-body open">
        <div class="form-grid">
          <div class="form-group full"><label>Game Title *</label><input type="text" name="title" placeholder="e.g. God of War Ragnarök" required></div>
          <div class="form-group">
            <label>Platform</label>
            <select name="platform"><option value="PS5">PS5</option><option value="PS4">PS4</option><option value="PS4/PS5">PS4/PS5</option></select>
          </div>
          <div class="form-group"><label>Genre</label><input type="text" name="genre" placeholder="e.g. Action, RPG, Horror"></div>
          <div class="form-group"><label>📅 Release Date <span style="color:#555;font-size:0.7rem;">(when the game launched — powers "New Releases")</span></label><input type="date" name="release_date"></div>
          <div class="form-group"><label>New Game Countdown (days) <span style="color:#555;font-size:0.7rem;">(blank = site default, 11)</span></label><input type="number" name="new_window_days" value="" min="1" placeholder="11"></div>
          <div class="form-group full"><label>Description (optional)</label><textarea name="description" placeholder="Short description of the game..."></textarea></div>
          <div class="form-group"><label>🔗 Custom Link Label (optional)</label><input type="text" name="link_label" placeholder="e.g. Visit PS Plus website"></div>
          <div class="form-group"><label>🔗 Custom Link URL (optional)</label><input type="url" name="link_url" placeholder="https://..."></div>
        </div>
      </div>
    </div>

    <div class="afg-sec">
      <div class="afg-head open" onclick="afgToggle(this)">
        <div><div class="afg-title">💰 Pricing</div><div class="afg-desc">Rent tiers, buy prices, and what you paid</div></div>
        <span class="afg-arrow">▼</span>
      </div>
      <div class="afg-body open">
        <div class="form-grid">
          <div class="form-group full">
            <label>Pricing</label>
            <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;">
              <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-weight:600;">
                <input type="radio" name="price_mode" value="category" id="add_mode_cat" onchange="toggleAddPriceMode(this.value)" <%= priceCategories.length ? '' : 'disabled' %>>
                🏷️ Use Category
              </label>
              <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-weight:600;">
                <input type="radio" name="price_mode" value="custom" id="add_mode_custom" onchange="toggleAddPriceMode(this.value)" checked>
                ✏️ Custom Price
              </label>
            </div>
            <div id="add_cat_section" style="display:none;">
              <select name="price_category_id" style="width:100%;">
                <option value="">— Select a category —</option>
                <% priceCategories.forEach(cat => { %>
                <option value="<%= cat.id %>"><%= cat.name %> (NT: ₱<%= cat.nt_price_7d %>/₱<%= cat.nt_price_30d %>)</option>
                <% }) %>
              </select>
            </div>
          </div>
          <div id="add_custom_prices">
            <div class="form-group full" style="margin-bottom:0;"><label style="color:#aaa;">🎮 Non-Trophy Prices (₱)</label></div>
            <div class="form-group"><label>Weekly</label><input type="number" name="nt_price_7d" value="149" min="1"></div>
            <div class="form-group"><label>Monthly</label><input type="number" name="nt_price_30d" value="349" min="1"></div>
            <div class="form-group full" style="margin-bottom:0;"><label style="color:#ffc400;">🏆 Trophy Account Prices (₱) <span style="font-weight:400;color:#664d00;font-size:0.78rem;">— +₱100 deposit not included here</span></label></div>
            <div class="form-group"><label>Weekly</label><input type="number" name="tr_price_7d" value="199" min="1"></div>
            <div class="form-group"><label>Monthly</label><input type="number" name="tr_price_30d" value="399" min="1"></div>
          </div>
          <div class="form-group full" style="margin-top:0.5rem;padding-top:1rem;border-top:1px solid #1a1a1a;margin-bottom:0;">
            <label style="color:#a855f7;font-weight:700;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;">♾️ Buy Permanent Access Prices (₱) <span style="font-weight:400;color:#555;font-size:0.78rem;text-transform:none;letter-spacing:0;">— leave 0 to hide Buy option</span></label>
          </div>
          <div class="form-group"><label>🎮 Non-Trophy Buy Price</label><input type="number" name="buy_nt_price" value="0" min="0" placeholder="e.g. 999"></div>
          <div class="form-group"><label>🏆 Trophy Buy Price</label><input type="number" name="buy_tr_price" value="0" min="0" placeholder="e.g. 1199"></div>
          <div class="form-group"><label>Game Cost (₱) <span style="color:#555;font-size:0.72rem;">what you paid</span></label><input type="number" name="cost" value="0" min="0" placeholder="e.g. 2500"></div>
        </div>
      </div>
    </div>

    <div class="afg-sec">
      <div class="afg-head" onclick="afgToggle(this)">
        <div><div class="afg-title">🖼️ Media</div><div class="afg-desc">Cover image and gameplay gallery</div></div>
        <span class="afg-arrow">▼</span>
      </div>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group"><label>Cover Image</label><input type="file" name="cover_image" accept="image/*" style="padding:0.5rem;"></div>
          <div class="form-group full"><label>🖼️ Gameplay Gallery <span style="color:#555;font-size:0.75rem;">(optional — select multiple screenshots, shown as a slider)</span></label><input type="file" name="gallery" accept="image/*" multiple style="padding:0.5rem;"></div>
          <div class="form-group full" style="font-size:0.78rem;color:#666;">The cover's focal point is set later via Edit, once the image is visible.</div>
        </div>
      </div>
    </div>

    <div class="afg-sec">
      <div class="afg-head" onclick="afgToggle(this)">
        <div><div class="afg-title">📦 Stock &amp; slots</div><div class="afg-desc">How many accounts you have, and current renters</div></div>
        <span class="afg-arrow">▼</span>
      </div>
      <div class="afg-body">
        <div class="form-grid">
          <div class="form-group"><label>🎮 Non-Trophy Slots</label><input type="number" name="non_trophy_slots" value="1" min="0"></div>
          <div class="form-group"><label>Available Slots <span style="color:#555;font-size:0.7rem;">(total)</span></label><input type="number" name="available_slots" value="1" min="0"></div>
          <div class="form-group"><label>Current Renters</label><input type="number" name="renters" value="0" min="0"></div>
          <div class="form-group"><label>🕹️ PS4 Primary Slots</label><input type="number" name="ps4_primary_slots" value="0" min="0"></div>
          <div class="form-group" style="justify-content:center;">
            <label>Trophy Account Available</label>
            <label class="toggle-switch"><input type="checkbox" name="trophy_account" id="add_trophy_chk" onchange="document.getElementById('add_trophy_slots').style.display=this.checked?'block':'none'"><span class="toggle-slider"></span></label>
          </div>
          <div class="form-group" id="add_trophy_slots" style="display:none;">
            <label>Trophy Account Slots <span style="color:#ffc400;font-size:0.72rem;">🏆 how many accounts</span></label>
            <input type="number" name="trophy_slots" value="1" min="1" max="20">
          </div>
        </div>
      </div>
    </div>

    <div class="afg-sec">
      <div class="afg-head<%= presetBundle ? ' open' : '' %>" onclick="afgToggle(this)">
        <div><div class="afg-title">📦 Bundle</div><div class="afg-desc">Link this entry to a whole account</div></div>
        <span class="afg-arrow">▼</span>
      </div>
      <div class="afg-body<%= presetBundle ? ' open' : '' %>">
        <div class="form-grid">
          <div class="form-group full">
            <label>
              <input type="checkbox" name="is_bundle" id="add_bundle_chk" <%= presetBundle ? 'checked' : '' %>
                onchange="document.getElementById('add_bundle_account').style.display = this.checked ? 'block' : 'none'; if (!this.checked) { const s = document.querySelector('#add_bundle_account select'); if (s) s.value = ''; }">
              📦 This game represents an account bundle
            </label>
            <div id="add_bundle_account" style="display:<%= presetBundle ? 'block' : 'none' %>;margin-top:0.5rem;">
              <label>Bundle account</label>
              <% if (accounts.length) { %>
              <select name="bundle_account_id">
                <option value="">— Select account —</option>
                <% accounts.forEach(acc => { %>
                <option value="<%= acc.id %>"><%= acc.label %> (#<%= acc.id %>, <%= (acc.game_ids || []).length %> games)</option>
                <% }) %>
              </select>
              <% } else { %>
              <div style="font-size:0.8rem;color:#888;line-height:1.6;">
                No accounts exist yet — <a href="/admin/accounts" style="color:var(--ps-blue);">create one first</a>, then come back and link it here.
              </div>
              <% } %>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Add Game</button>
      <a href="/admin?tab=games" class="btn btn-outline">Cancel</a>
    </div>
  </form>
</div>

<script>
function afgToggle(head) {
  const body = head.nextElementSibling;
  body.classList.toggle('open');
  head.classList.toggle('open');
}
function toggleAddPriceMode(v) {
  document.getElementById('add_cat_section').style.display = v === 'category' ? 'block' : 'none';
  document.getElementById('add_custom_prices').style.display = v === 'category' ? 'none' : 'contents';
}
</script>

</body>
</html>
```

Two notes on what changed while moving:

The original had a `<script>` tag containing `toggleAddPriceMode` sitting **inside** the `.form-grid` (`views/admin.ejs:1246-1251`). Scripts inside a CSS grid are harmless but fragile to move; it has been lifted to the page's single bottom `<script>` block.

The accordion uses a page-local `afgToggle` rather than admin.ejs's `toggleAccordion`, because that function lives inside admin.ejs and is not available on a standalone page.

- [ ] **Step 3: Remove the relocated form from admin.ejs**

In `views/admin.ejs`, delete the entire block from the `<!-- ADD GAME FORM -->` comment (currently line 1189) through the `</div></div><!-- /accordion add-game -->` line (currently line 1286) inclusive. That removes the accordion wrapper and the form it contained.

- [ ] **Step 4: Verify both files**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -c server.js && echo SERVER_OK
node -e "require('ejs').compile(require('fs').readFileSync('views/add-game.ejs','utf8'))" && echo ADDGAME_OK
node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'))" && echo ADMIN_OK
```

Expected: all three OK lines.

- [ ] **Step 5: Verify no field was lost in the move**

Every `name="..."` the old form submitted must still be present on the new page.

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -e "
const fs = require('fs');
const page = fs.readFileSync('views/add-game.ejs','utf8');
const expected = ['title','platform','genre','release_date','new_window_days','description','link_label','link_url','price_mode','price_category_id','nt_price_7d','nt_price_30d','tr_price_7d','tr_price_30d','buy_nt_price','buy_tr_price','cost','cover_image','gallery','non_trophy_slots','available_slots','renters','ps4_primary_slots','trophy_account','trophy_slots','is_bundle','bundle_account_id'];
const missing = expected.filter(n => !page.includes('name=\"' + n + '\"'));
if (missing.length) { console.error('MISSING FIELDS: ' + missing.join(', ')); process.exit(1); }
console.log('OK: all ' + expected.length + ' fields present');
"
```

Expected: `OK: all 27 fields present`. Any missing field means the move dropped an input, which would silently stop saving that value.

- [ ] **Step 6: Commit**

```bash
git add server.js views/add-game.ejs views/admin.ejs
git commit -m "Move add-game onto its own page with grouped field sections"
```

---

### Task 3: Add-upcoming page, and real navigation from the modal

**Files:**
- Create: `views/add-upcoming.ejs`
- Modify: `server.js` — new `GET /admin/add/upcoming` route
- Modify: `views/admin.ejs:1073-1088` — the add-choice grid, and delete the relocated upcoming form

**Interfaces:**
- Consumes: `GET /admin/add/game` from Task 2 (the Game and Bundle cards link to it).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add the route**

In `server.js`, immediately after the `GET /admin/add/game` route added in Task 2, add:

```js
app.get('/admin/add/upcoming', requireAuth, (req, res) => {
  res.render('add-upcoming', { settings: getSiteSettings() });
});
```

- [ ] **Step 2: Create `views/add-upcoming.ejs`**

The upcoming form has no accordion grouping — it is 15 fields and already readable. It moves as-is onto a page shell matching Task 2's.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Add Upcoming Game — <%= settings.title %></title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
</head>
<body>

<nav>
  <a href="/" class="logo"><img src="<%= settings.logo_path %>" alt="<%= settings.title %>" /></a>
  <div class="nav-links">
    <a href="/browse">Browse Games</a>
    <a href="/admin" class="admin-btn">Admin Panel</a>
  </div>
</nav>

<div class="edit-container">
  <a href="/admin?tab=games" class="back-link">← Back to Admin</a>
  <h1>Add Upcoming Game</h1>

  <div class="form-card">
    <form method="POST" action="/admin/upcoming/add" enctype="multipart/form-data">
      <div class="form-grid">
        <div class="form-group full"><label>Game Title *</label><input type="text" name="title" placeholder="e.g. GTA VI" required></div>
        <div class="form-group">
          <label>Platform</label>
          <select name="platform"><option value="PS5">PS5</option><option value="PS4">PS4</option><option value="PS4/PS5">PS4/PS5</option></select>
        </div>
        <div class="form-group"><label>Genre</label><input type="text" name="genre" placeholder="e.g. Open World, RPG"></div>
        <div class="form-group">
          <label>Expected Release Date</label>
          <div style="display:flex;flex-direction:column;gap:0.5rem;">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem;font-weight:600;">
              <input type="checkbox" id="add_tba" name="release_date_tba" onchange="toggleAddTba(this.checked)">
              Mark as TBA (date unknown)
            </label>
            <input type="date" name="release_date" id="add_date_input" style="width:100%;">
            <input type="hidden" name="release_date_tba_val" id="add_tba_hidden" value="">
          </div>
        </div>
        <div class="form-group"><label>Cover Image</label><input type="file" name="cover_image" accept="image/*" style="padding:0.5rem;"></div>
        <div class="form-group full"><label>Description (optional)</label><textarea name="description" placeholder="Short description..."></textarea></div>
        <div class="form-group"><label>🔥 Hot Rank <span style="color:#555;font-size:0.75rem;">(0 = none, 1 = #1 most hyped)</span></label><input type="number" name="rank" min="0" value="0" placeholder="0"></div>
      </div>

      <div style="margin:1.25rem 0 0.5rem;font-size:0.85rem;font-weight:700;color:#a78bfa;letter-spacing:0.5px;">🎮 SLOTS &amp; PRICING (for when released)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;">
        <div style="background:#111;border:1px solid #222;border-radius:10px;padding:1rem;">
          <div style="font-weight:700;font-size:0.82rem;color:#ccc;margin-bottom:0.75rem;">🎮 Non-Trophy</div>
          <div class="form-grid" style="gap:0.6rem;">
            <div class="form-group"><label style="font-size:0.75rem;">Slots</label><input type="number" name="non_trophy_slots" min="0" value="1" style="width:100%;"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Weekly Price (₱)</label><input type="number" name="nt_price_7d" min="0" placeholder="e.g. 149" style="width:100%;"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Monthly Price (₱)</label><input type="number" name="nt_price_30d" min="0" placeholder="e.g. 299" style="width:100%;"></div>
          </div>
        </div>
        <div style="background:#111;border:1px solid #222;border-radius:10px;padding:1rem;">
          <div style="font-weight:700;font-size:0.82rem;color:#ffc400;margin-bottom:0.75rem;">🏆 Trophy</div>
          <div class="form-grid" style="gap:0.6rem;">
            <div class="form-group"><label style="font-size:0.75rem;">Slots</label><input type="number" name="trophy_slots" min="0" value="0" style="width:100%;"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Weekly Price (₱)</label><input type="number" name="tr_price_7d" min="0" placeholder="e.g. 199" style="width:100%;"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Monthly Price (₱)</label><input type="number" name="tr_price_30d" min="0" placeholder="e.g. 349" style="width:100%;"></div>
          </div>
        </div>
      </div>

      <div class="form-actions" style="margin-top:1.25rem;">
        <button type="submit" class="btn btn-primary">Add Upcoming Game</button>
        <a href="/admin?tab=games" class="btn btn-outline">Cancel</a>
      </div>
    </form>
  </div>
</div>

<script>
function toggleAddTba(checked) {
  const inp = document.getElementById('add_date_input'), hid = document.getElementById('add_tba_hidden');
  inp.disabled = checked; inp.style.opacity = checked ? '0.3' : '1'; hid.value = checked ? 'TBA' : '';
}
</script>

</body>
</html>
```

- [ ] **Step 3: Replace the modal's three scroll-jump cards with four real links**

In `views/admin.ejs`, find the `<div class="add-choice-grid">` block (currently line 1073) and replace the entire block through its closing `</div>` with:

```html
        <div class="add-choice-grid">
          <a class="add-choice-card" href="/admin/add/game">
            <span class="icon">🎮</span>
            <span class="label">New Game</span>
            <span class="desc">A rentable PS5 or PS4 title</span>
          </a>
          <a class="add-choice-card" href="/admin/add/game?bundle=1">
            <span class="icon">📦</span>
            <span class="label">Bundle</span>
            <span class="desc">One entry standing in for a whole account</span>
          </a>
          <a class="add-choice-card" href="/admin/add/upcoming">
            <span class="icon">🔜</span>
            <span class="label">Upcoming Game</span>
            <span class="desc">Not released yet — open for reservations</span>
          </a>
          <a class="add-choice-card" href="#add-category-form" onclick="document.getElementById('addChoiceModal').classList.remove('open');setTimeout(()=>document.getElementById('add-category-form').scrollIntoView({behavior:'smooth'}),50)">
            <span class="icon">🏷️</span>
            <span class="label">Price Category</span>
            <span class="desc">A pricing tier games can share</span>
          </a>
        </div>
```

Price Category keeps its scroll-jump deliberately: it is a small three-field form that the spec explicitly left inline, so there is no page to navigate to.

- [ ] **Step 4: Widen the modal grid from three columns to four**

In `views/admin.ejs`, find (currently line 20):

```css
    .add-choice-grid { display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;margin-top:1.25rem; }
```

Replace with:

```css
    .add-choice-grid { display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-top:1.25rem; }
```

Two columns rather than four: the modal box is `min(480px,92vw)` wide, so four cards across would be roughly 100px each and crush the descriptions. A 2×2 grid reads better at that width.

- [ ] **Step 5: Remove the relocated upcoming form from admin.ejs**

Delete the `<div id="add-upcoming-form" class="form-card" ...>` block through its matching closing `</div>`, along with the `<script>` containing `toggleAddTba` that sits inside it. Leave the "Coming Soon Games" accordion header and the upcoming games table beneath it intact.

- [ ] **Step 6: Verify everything compiles and the scroll-jumps are gone**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -c server.js && echo SERVER_OK
node -e "require('ejs').compile(require('fs').readFileSync('views/add-upcoming.ejs','utf8'))" && echo ADDUPC_OK
node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'))" && echo ADMIN_OK
echo "--- remaining scrollIntoView (expect 1, the price-category card) ---"
grep -c "scrollIntoView" views/admin.ejs
```

Expected: three OK lines, then `1`.

- [ ] **Step 7: Commit and deploy**

```bash
git add server.js views/add-upcoming.ejs views/admin.ejs
git commit -m "Add upcoming page and turn the add menu into real navigation"
git push origin main
```

- [ ] **Step 8: Verify live**

Poll for rollover:

```bash
for i in 1 2 3 4 5 6 7 8; do
  curl -s -o /dev/null -w "%{http_code}" "https://playstation-hub.com/admin/add/game" | grep -qE "302|200" && echo "route live (attempt $i)" && break
  echo "attempt $i"; sleep 20
done
```

A `302` is expected when unauthenticated — it proves the route exists and `requireAuth` fired.

Then with the Browser tool, logged in:
1. Games tab → click Add. Confirm the modal shows **four** cards in a 2×2 grid: New Game, Bundle, Upcoming Game, Price Category.
2. Click **Bundle**. Confirm it navigates to `/admin/add/game?bundle=1`, that the Bundle section is expanded, and the checkbox is already ticked with the account picker visible.
3. Click **New Game** from the modal. Confirm `/admin/add/game` loads with Bundle collapsed and unticked, and that Basics and Pricing are open while Media, Stock and Bundle are collapsed.
4. Expand every section and confirm no field is visually missing or overlapping.
5. Click **Upcoming Game** and confirm `/admin/add/upcoming` renders with the TBA checkbox working (ticking it should grey out the date input).
6. Back on `/admin?tab=games`, confirm the old inline "Add New Game" accordion is gone and the games table below still renders normally.
7. **Do not submit any of these forms** — that writes real rows to the production catalog.
