# Stocked Toggle + Custom New-Game Countdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin (1) mark a game as stocked so its game-detail page stops showing the "Set up on order" notice regardless of rental history, and (2) set a per-game override for how many days the new-game countdown runs, instead of the fixed 11 days.

**Architecture:** Two new optional fields on a game (`stocked` boolean, `new_window_days` number), both absent on every existing game today. Task 1 wires the stocked toggle: a new POST route, an admin table button, and a one-line change to the `neverRented` condition in `game-detail.ejs` that already gates the not-yet-stocked notice. Task 2 wires the custom countdown: a form field in both add/edit admin forms, a write-through in both POST routes, and updating the three places (flagged in an existing `server.js` comment) that hardcode the 11-day window to read the per-game value first.

**Tech Stack:** Express.js + EJS server-rendered views, lowdb for `games`, no test framework (this project's established convention) — verification is EJS tag-balance greps, `node -c server.js`, and live smoke-testing on Railway after deploy.

## Global Constraints

- Both new fields are optional and default to "unset" — every existing game must behave identically to today until an admin explicitly acts on it.
- `game.stocked` only affects the not-yet-stocked notice in `views/game-detail.ejs`. It must NOT affect the `✨ NEW` badge, the `⏳ Days Left!` badge, the "Newly Added Only" filter, or the New Arrivals poster group — those stay governed purely by `created_at` age (spec: "the two concepts are independent by design").
- `game.new_window_days`, when unset/0/blank, falls back to the existing `NEW_GAME_WINDOW_DAYS = 11` constant. The constant itself does not change.
- Reaching the countdown's end (whatever its length) stays purely cosmetic — no new behavior is added there. This plan does not touch what happens at zero, only what determines when zero is reached.
- The stocked toggle has no confirmation dialog (unlike Delete) — it's a reversible, low-risk action.
- EJS tag-balance (`<%` count == `%>` count) must hold for `views/admin.ejs`, `views/edit.ejs`, `views/game-detail.ejs`, and `views/partials/game-card.ejs` after every change.
- `node -c server.js` must exit 0 after every server.js change.
- No local dev server exists; live verification happens against https://playstation-hub.com after `git push` (Railway auto-deploys, ~60-90s).

---

### Task 1: Stocked toggle

**Files:**
- Modify: `server.js` (new route, near the existing `/admin/games/:id/description` route at line 2121-2127)
- Modify: `views/admin.ejs` (action-btns in the Games table, around line 1266-1273)
- Modify: `views/game-detail.ejs` (the `neverRented` line inside the availability `<% %>` block)

**Interfaces:**
- Consumes: nothing from another task.
- Produces: `game.stocked` (boolean field on a game document) — read by `views/game-detail.ejs`'s `neverRented` computation. No later task in this plan consumes it directly, but Task 2's countdown fields are independent and don't interact with this one.

- [ ] **Step 1: Add the toggle route**

In `server.js`, immediately after the existing `/admin/games/:id/description` route (ends at line 2127 with `res.json({ ok: true, id: game.id, title: game.title });\n});`), add:

```js
// Toggles "the account is stocked and ready" independent of rental history — clears
// the not-yet-stocked notice on game-detail.ejs without touching the new-game
// countdown, which stays governed purely by created_at (the two are independent).
app.post('/admin/games/:id/stocked', requireAuth, (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.redirect('/admin');
  db.get('games').find({ id: parseInt(req.params.id) }).assign({ stocked: !game.stocked }).write();
  res.redirect('/admin?msg=updated');
});
```

This mirrors the existing `/admin/delete/:id` route's pattern: plain form POST, `requireAuth`, redirect back to `/admin` (not JSON) — appropriate here because the button lives in a normal HTML form, not an AJAX call like `/admin/games/:id/description` uses.

- [ ] **Step 2: Add the toggle button to the admin Games table**

In `views/admin.ejs`, find the action-btns block in the Games table (currently lines 1266-1273):

```ejs
              <td>
                <div class="action-btns">
                  <a href="/admin/edit/<%= game.id %>" class="btn-edit">✏️ Edit</a>
                  <form method="POST" action="/admin/delete/<%= game.id %>" style="display:inline" onsubmit="return confirm('Delete <%= game.title.replace(/'/g, "\\'") %>?')">
                    <button type="submit" class="btn-delete">🗑 Delete</button>
                  </form>
                </div>
              </td>
```

Replace it with:

```ejs
              <td>
                <div class="action-btns">
                  <a href="/admin/edit/<%= game.id %>" class="btn-edit">✏️ Edit</a>
                  <form method="POST" action="/admin/games/<%= game.id %>/stocked" style="display:inline">
                    <button type="submit" class="btn-edit" style="<%= game.stocked ? 'background:rgba(34,197,94,0.15);color:#22c55e;border-color:rgba(34,197,94,0.3);' : '' %>"><%= game.stocked ? '📦 Stocked ✓' : '📦 Mark stocked' %></button>
                  </form>
                  <form method="POST" action="/admin/delete/<%= game.id %>" style="display:inline" onsubmit="return confirm('Delete <%= game.title.replace(/'/g, "\\'") %>?')">
                    <button type="submit" class="btn-delete">🗑 Delete</button>
                  </form>
                </div>
              </td>
```

The button reuses the existing `.btn-edit` class for base styling (this project doesn't have a dedicated neutral-action button class) and adds an inline green tint only when `game.stocked` is true, so the two states are visually distinguishable without a new CSS class.

- [ ] **Step 3: Wire `game.stocked` into the not-yet-stocked notice**

In `views/game-detail.ejs`, find this line (added by the previous plan, inside the availability `<% %>` block):

```ejs
  const neverRented = !game.renters;
```

Replace it with:

```ejs
  const neverRented = !game.renters && !game.stocked;
```

No other line in this block needs to change — `trNotStocked`, `ntNotStocked`, `ps4NotStocked`, and `anyNotStocked` all derive from `neverRented`, so this one-line change is the entire effect described in the spec.

- [ ] **Step 4: Verify EJS balance and server.js syntax**

Run: count `<%` occurrences and `%>` occurrences in `views/admin.ejs` — must be equal.

Run: count `<%` occurrences and `%>` occurrences in `views/game-detail.ejs` — must be equal.

Run: `node -c server.js` — expect exit 0.

- [ ] **Step 5: Commit**

```bash
git add server.js views/admin.ejs views/game-detail.ejs
git commit -F - <<'MSGEOF'
Add a stocked toggle to clear the not-yet-stocked notice manually

Lets an admin mark a game's account as ready even with zero renters,
independent of the new-game countdown - a game can be fully available
and still show as a promoted new arrival for the rest of its window.
MSGEOF
```

---

### Task 2: Custom new-game countdown

**Files:**
- Modify: `server.js` (the `/admin/add` and `/admin/edit/:id` POST routes, and `isAddedThisMonth()`)
- Modify: `views/admin.ejs` (add-game form field near line 1092, and the Games table's `gIsNewThisMonth`/`gDaysLeft` computation around lines 1197-1200)
- Modify: `views/edit.ejs` (edit-game form field near line 57)
- Modify: `views/partials/game-card.ejs` (the `gcIsNew`/`gcNewDaysLeft` computation around lines 36-38)

**Interfaces:**
- Consumes: nothing from Task 1 — fully independent field.
- Produces: `game.new_window_days` (number field on a game document, optional). Read wherever the 11-day window is currently checked; no later task consumes it.

- [ ] **Step 1: Add the form field to the add-game form**

In `views/admin.ejs`, find this line (currently line 1092):

```ejs
          <div class="form-group"><label>Current Renters</label><input type="number" name="renters" value="0" min="0"></div>
```

Immediately after it, insert:

```ejs
          <div class="form-group"><label>New Game Countdown (days) <span style="color:#555;font-size:0.7rem;">(blank = site default, 11)</span></label><input type="number" name="new_window_days" value="" min="1" placeholder="11"></div>
```

- [ ] **Step 2: Add the form field to the edit-game form**

In `views/edit.ejs`, find this line (currently line 57):

```ejs
        <div class="form-group">
          <label>Current Renters</label>
          <input type="number" name="renters" value="<%= game.renters %>" min="0">
        </div>
```

Immediately after it, insert:

```ejs
        <div class="form-group">
          <label>New Game Countdown (days) <span style="color:#555;font-size:0.7rem;">(blank = site default, 11)</span></label>
          <input type="number" name="new_window_days" value="<%= game.new_window_days || '' %>" min="1" placeholder="11">
        </div>
```

- [ ] **Step 3: Write `new_window_days` on both routes**

In `server.js`, in the `/admin/add` route (currently starting line 1999), find the destructuring line:

```js
  const { title, platform, available_slots, renters,
    nt_price_7d, nt_price_30d,
    tr_price_7d, tr_price_30d,
    buy_nt_price, buy_tr_price,
    genre, description, release_date, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    price_category_id, price_mode, cost, link_label, link_url } = req.body;
```

Add `new_window_days` to the destructured list (after `renters`):

```js
  const { title, platform, available_slots, renters, new_window_days,
    nt_price_7d, nt_price_30d,
    tr_price_7d, tr_price_30d,
    buy_nt_price, buy_tr_price,
    genre, description, release_date, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    price_category_id, price_mode, cost, link_label, link_url } = req.body;
```

Then in the `db.get('games').push({...})` object in that same route, add this line right after `renters: parseInt(renters) || 0,`:

```js
    new_window_days: parseInt(new_window_days) > 0 ? parseInt(new_window_days) : null,
```

Repeat the same two edits in the `/admin/edit/:id` route (currently starting line 2055): add `new_window_days` to its destructuring line (after `renters`), and add the same `new_window_days: parseInt(new_window_days) > 0 ? parseInt(new_window_days) : null,` line to its `db.get('games').find(...).assign({...})` object, right after `renters: parseInt(renters),`.

The `> 0 ? ... : null` guard is what implements "blank/0 clears the override back to the default" from the spec — `parseInt('')` is `NaN`, and `NaN > 0` is `false`, so an empty submission stores `null`.

- [ ] **Step 4: Update the three sites that read the fixed 11-day window**

In `server.js`, find (currently lines 2744-2753):

```js
// A game counts as "new" for a fixed 11 days after created_at — not tied to calendar
// month boundaries, so a game added on the 28th still gets the full window instead of
// losing its NEW badge two days later at month-end. Same rule duplicated (with this
// comment) in partials/game-card.ejs and admin.ejs's Added column — keep all three in sync.
const NEW_GAME_WINDOW_DAYS = 11;
function isAddedThisMonth(game) {
  if (!game.created_at) return false;
  const daysSinceAdded = Math.floor((Date.now() - new Date(game.created_at).getTime()) / 86400000);
  return daysSinceAdded < NEW_GAME_WINDOW_DAYS;
}
```

Replace it with:

```js
// A game counts as "new" for a fixed 11 days after created_at by default — not tied to
// calendar month boundaries, so a game added on the 28th still gets the full window
// instead of losing its NEW badge two days later at month-end. A game's own
// new_window_days overrides this default when set (admin-configurable per game). Same
// rule duplicated (with this comment) in partials/game-card.ejs and admin.ejs's Added
// column — keep all three in sync.
const NEW_GAME_WINDOW_DAYS = 11;
function isAddedThisMonth(game) {
  if (!game.created_at) return false;
  const windowDays = game.new_window_days || NEW_GAME_WINDOW_DAYS;
  const daysSinceAdded = Math.floor((Date.now() - new Date(game.created_at).getTime()) / 86400000);
  return daysSinceAdded < windowDays;
}
```

In `views/partials/game-card.ejs`, find (currently lines 34-38):

```ejs
  // NEW badge lasts a fixed 11 days from created_at — same window used by the Admin
  // "Added" column and the New Arrivals poster group (server.js NEW_GAME_WINDOW_DAYS).
  const gcDaysSinceAdded = game.created_at ? Math.floor((Date.now() - new Date(game.created_at).getTime()) / 86400000) : null;
  const gcIsNew = gcDaysSinceAdded !== null && gcDaysSinceAdded < 11;
  const gcNewDaysLeft = gcIsNew ? 11 - gcDaysSinceAdded : null;
```

Replace it with:

```ejs
  // NEW badge lasts a fixed 11 days from created_at by default — same window used by
  // the Admin "Added" column and the New Arrivals poster group (server.js
  // NEW_GAME_WINDOW_DAYS), overridable per game via game.new_window_days.
  const gcWindowDays = game.new_window_days || 11;
  const gcDaysSinceAdded = game.created_at ? Math.floor((Date.now() - new Date(game.created_at).getTime()) / 86400000) : null;
  const gcIsNew = gcDaysSinceAdded !== null && gcDaysSinceAdded < gcWindowDays;
  const gcNewDaysLeft = gcIsNew ? gcWindowDays - gcDaysSinceAdded : null;
```

In `views/admin.ejs`, find (currently lines 1193-1200):

```ejs
              // Fixed 11-day "new" window from created_at — same rule as the site-wide
              // NEW badge and New Arrivals poster group (server.js NEW_GAME_WINDOW_DAYS).
              // Days-left is how much runway remains to see if the game gets any renters
              // before deciding whether to keep restocking it.
              const gAddedDate = game.created_at ? new Date(game.created_at) : null;
              const gDaysSinceAdded = gAddedDate ? Math.floor((Date.now() - gAddedDate.getTime()) / 86400000) : null;
              const gIsNewThisMonth = gDaysSinceAdded !== null && gDaysSinceAdded < 11;
              const gDaysLeft = gIsNewThisMonth ? 11 - gDaysSinceAdded : null;
```

Replace it with:

```ejs
              // Fixed 11-day "new" window from created_at by default — same rule as the
              // site-wide NEW badge and New Arrivals poster group (server.js
              // NEW_GAME_WINDOW_DAYS), overridable per game via game.new_window_days.
              // Days-left is how much runway remains to see if the game gets any renters
              // before deciding whether to keep restocking it.
              const gWindowDays = game.new_window_days || 11;
              const gAddedDate = game.created_at ? new Date(game.created_at) : null;
              const gDaysSinceAdded = gAddedDate ? Math.floor((Date.now() - gAddedDate.getTime()) / 86400000) : null;
              const gIsNewThisMonth = gDaysSinceAdded !== null && gDaysSinceAdded < gWindowDays;
              const gDaysLeft = gIsNewThisMonth ? gWindowDays - gDaysSinceAdded : null;
```

- [ ] **Step 5: Verify EJS balance and server.js syntax**

Run: count `<%` occurrences and `%>` occurrences in `views/admin.ejs`, `views/edit.ejs`, and `views/partials/game-card.ejs` — each file's counts must be equal.

Run: `node -c server.js` — expect exit 0.

Run: search `server.js` for `new_window_days` — expect matches in the `isAddedThisMonth` function, the `/admin/add` destructuring line, the `/admin/add` push object, the `/admin/edit/:id` destructuring line, and the `/admin/edit/:id` assign object (5 occurrences).

- [ ] **Step 6: Commit**

```bash
git add server.js views/admin.ejs views/edit.ejs views/partials/game-card.ejs
git commit -F - <<'MSGEOF'
Allow a per-game override of the new-game countdown length

The 11-day window was hardcoded in three places that a comment
already flagged as needing to stay in sync. All three now check
game.new_window_days first, falling back to the same 11-day default -
reaching zero stays exactly as cosmetic as it was before this change.
MSGEOF
```

---

### Task 3: Deploy and verify live

**Files:** none (deploy + verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-2.

- [ ] **Step 1: Push to trigger the Railway deploy**

```bash
git push origin main
```

- [ ] **Step 2: Wait for the deploy**

Run: `until curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/ | grep -q 200; do sleep 5; done; echo done`

- [ ] **Step 3: Verify the stocked toggle clears the not-yet-stocked notice**

Open `/admin` → Games tab. Find MARVEL Tōkon: Fighting Souls (or another never-rented, un-stocked game). Click "📦 Mark stocked" — confirm the button becomes "📦 Stocked ✓" (green) and the page redirects back with `msg=updated`.

Open that game's detail page (`/game/marvel-t-kon-fighting-souls`). Confirm the amber "Be the first to rent this" banner is gone, and both rental type pills read "Available" instead of "Set up on order".

Confirm the `✨ NEW` and `⏳ Days Left!` badges on its game card (`/browse`) are unaffected — still showing, unchanged by the stocked toggle.

Click "📦 Stocked ✓" again to toggle it back off, and confirm the game-detail page's notice reappears — the toggle is reversible.

- [ ] **Step 4: Verify the custom countdown field**

In `/admin` → Games tab, click Edit on a game. Confirm the new "New Game Countdown (days)" field appears near "Current Renters", showing blank (not "0") for a game that has never had it set.

Set it to `3` and save. Confirm in the Games table that this game's "Added" column now shows a days-left count consistent with a 3-day window (e.g. if it was added N days ago, show `3-N`d left, or `—` if N ≥ 3) rather than the default 11-day count it showed before.

Open `/admin` → Add New Game form. Confirm the same field appears there too, and add a test game with `new_window_days` set to `1`. Confirm the new game's card on `/browse` shows `⏳ 1 Day Left!`. Delete this test game afterward via the admin Delete button.

- [ ] **Step 5: Confirm nothing else broke**

Open `/browse` and confirm the "🆕 Newly Added Only" filter still works normally. Open a game whose `new_window_days` is still unset and confirm its NEW/Days-Left badges still read the same as before this change (11-day default, unaffected).

- [ ] **Step 6: Report results to the user**

Summarize what was verified in Steps 3-5, with a screenshot of the stocked toggle in both states and the custom countdown field, and flag anything that didn't match expectations before considering this plan complete.
