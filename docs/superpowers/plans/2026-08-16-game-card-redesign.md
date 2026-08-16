# Available-Games Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the available-games card's boxy layout (bordered price panel, five cover badges, two equal buttons, emoji icons) with a 2:3 poster card matching the existing Coming Soon card's visual language — full-bleed cover, bottom scrim, everything overlaid on the art, one CTA.

**Architecture:** Rewrite `views/partials/game-card.ejs` in place (same include signature, same call sites) and add a new CSS block reusing/extending the existing `.cs-*` (Coming Soon) classes rather than duplicating them. No server.js or data-model changes — all logic (`computeAvailability`, promo pricing, new-game window) already exists in the current partial and is kept as-is; only the markup and CSS around it change.

**Tech Stack:** Express, EJS, vanilla CSS (no build step — `public/css/style.css` is served directly).

## Global Constraints

- Buy is indicated by an ∞ icon in the slots row only — no second CTA button (per approved design).
- Three visual states: Open (no top-left badge), Last slot (red "Last slot" badge, `isLastSlot` = existing `totalSlots === 1`), Rented (dimmed art, muted title, "Free in Nd" or plain "Rented" fallback, outlined "Reserve" CTA instead of filled "Rent", `allUnavail` = existing `totalSlots === 0`).
- No icon fonts — this codebase loads none today. All icons are small inline stroke-based SVGs (`fill="none" stroke="currentColor" stroke-width="1.6"`), matching the existing style already used in `.game-cover-placeholder svg`.
- The card keeps its single click-through to `/game/<slug>` — no "See all N prices" link, no separate price panel.
- All 4 existing call sites (`views/browse.ejs` ×2, `views/index.ejs` ×2) keep calling the partial exactly as they do today — this plan does not touch those files.
- Untouched: Coming Soon cards, game-detail page, PS Plus cards, admin views, server.js.

---

### Task 1: Rewrite the card partial and its CSS

**Files:**
- Modify: `views/partials/game-card.ejs` (full rewrite of the markup below the existing `<%...%>` logic block — the logic block itself, lines computing `gcAvailability`, `gcStartPrice`, `gcIsNew`, etc., is kept as-is)
- Modify: `public/css/style.css` (new block added after the existing `.cs-*` Coming Soon card rules, ~line 2196, before the `/* HOW IT WORKS PAGE */` comment)

**Interfaces:**
- Consumes (all already computed in the existing `<%...%>` block at the top of `game-card.ejs` — do not recompute, just use):
  - `ntSlots`, `trSlots`, `ps4Slots`, `showPs4`, `hasTrophy`, `allUnavail`, `totalSlots` (numbers/booleans from `computeAvailability`)
  - `ntDaysLeft`, `trDaysLeft`, `ps4DaysLeft` (numbers or `null` — next-availability day counts)
  - `isLastSlot` (boolean, `totalSlots === 1`), `noSlot` (boolean, `totalSlots === 0` — same as `allUnavail`, both names already exist in the file)
  - `hasBuy` (boolean), `gameSlug` (string), `game` (the full game object: `.title`, `.platform`, `.genre`, `.cover_image`, `.cover_focal_x`, `.cover_focal_y`)
  - `gcStartPrice` (number or `null`), `gcStartWas` (number or `null` — pre-promo price, only set if different from `gcStartPrice`)
  - `gcIsNew` (boolean)
- Produces: no new interface — the partial's include signature (`{ game }`, optionally `{ game, showPriceStart: true }` from the sliders) is unchanged. `showPriceStart` becomes unused by the new markup (price is always shown); leave the callers passing it alone, just don't reference it in the new template.

- [ ] **Step 1: Replace the card markup in `game-card.ejs`**

Keep every line of the existing `<%...%>` computation block at the top of the file (from `const gcSum = ...` through `const gcShowDaysLeft = ...`) exactly as-is. Replace everything from `<div class="game-card" style="cursor:default;">` to the final closing `</div>` with:

```html
<a href="/game/<%= gameSlug %>" class="game-card gc2-card">
  <% if (game.cover_image) { %>
    <img src="<%= game.cover_image %>" alt="<%= game.title %>" class="gc2-cover" loading="lazy" decoding="async" style="object-position: <%= game.cover_focal_x != null ? game.cover_focal_x : 50 %>% <%= game.cover_focal_y != null ? game.cover_focal_y : 50 %>%;">
  <% } else { %>
    <div class="gc2-cover-placeholder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
      </svg>
      <span>No Image</span>
    </div>
  <% } %>
  <div class="gc2-scrim<%= allUnavail ? ' gc2-scrim-dim' : '' %>"></div>

  <% if (isLastSlot) { %>
    <div class="gc2-badge gc2-badge-last">Last slot</div>
  <% } else if (allUnavail) { %>
    <div class="gc2-badge gc2-badge-rented">Rented</div>
  <% } %>
  <% if (gcIsNew) { %>
    <div class="gc2-badge gc2-badge-new">New</div>
  <% } %>

  <div class="gc2-body">
    <div class="gc2-plat"><%= game.platform %><%= game.genre ? ' · ' + game.genre.split('/')[0].trim() : '' %></div>
    <div class="gc2-title<%= allUnavail ? ' gc2-title-muted' : '' %>"><%= game.title %></div>

    <% if (allUnavail) { %>
      <div class="gc2-status gc2-status-muted">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="gc2-icon"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
        <% const gcNextDays = [ntDaysLeft, trDaysLeft, ps4DaysLeft].filter(d => d != null && d > 0); %>
        <% if (gcNextDays.length) { %>Free in <%= Math.min(...gcNextDays) %>d<% } else { %>Rented<% } %>
      </div>
    <% } else { %>
      <div class="gc2-status">
        <% if (ntSlots > 0) { %>
        <span class="gc2-slot gc2-slot-ok">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="gc2-icon"><rect x="2" y="8" width="20" height="10" rx="4"/><path d="M7 11v4M5 13h4"/><circle cx="16" cy="12" r="1"/><circle cx="18" cy="14" r="1"/></svg>
          <%= ntSlots %>
        </span>
        <% } %>
        <% if (hasTrophy && trSlots > 0) { %>
        <span class="gc2-slot gc2-slot-tr">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="gc2-icon"><path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 5H5a2 2 0 0 0 2 4M16 5h3a2 2 0 0 1-2 4"/><path d="M12 13v3M9 20h6M10 20v-2h4v2"/></svg>
          <%= trSlots %>
        </span>
        <% } else if (showPs4 && ps4Slots > 0) { %>
        <span class="gc2-slot gc2-slot-ps4">PS4</span>
        <% } %>
        <% if (hasBuy) { %>
        <span class="gc2-slot gc2-slot-buy" title="Also available to buy permanently">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="gc2-icon"><path d="M6 9a3 3 0 1 0 0 6c1.5 0 2.5-1 3-2l2-2c.5-1 1.5-2 3-2a3 3 0 1 1 0 6c-1.5 0-2.5-1-3-2l-2-2c-.5-1-1.5-2-3-2z"/></svg>
        </span>
        <% } %>
      </div>
    <% } %>

    <div class="gc2-foot">
      <% if (gcStartPrice) { %>
      <div class="gc2-price">from <b>₱<%= gcStartPrice %></b><% if (gcStartWas) { %><s class="gc2-price-was">₱<%= gcStartWas %></s><% } %></div>
      <% } else { %>
      <div class="gc2-price">See pricing</div>
      <% } %>
      <div class="gc2-cta<%= allUnavail ? ' gc2-cta-reserve' : '' %>"><%= allUnavail ? 'Reserve' : 'Rent' %></div>
    </div>
  </div>
</a>
```

- [ ] **Step 2: Add the CSS block**

Append this block to `public/css/style.css` immediately before the `/* HOW IT WORKS PAGE */` comment (the one right after the existing `.cs-cta` rule, ~line 2196):

```css
/* AVAILABLE GAME CARD v2 — poster layout matching .upcoming-card */
.gc2-card {
  position: relative;
  display: block;
  aspect-ratio: 2 / 3;
  height: auto !important;
  padding: 0;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--border);
  text-decoration: none;
  color: inherit;
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}
.gc2-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(240,165,0,0.15); border-color: rgba(240,165,0,0.25); }
.gc2-cover, .gc2-cover-placeholder {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block;
}
.gc2-cover-placeholder {
  background: linear-gradient(135deg, #111 0%, #1a1a2e 100%);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem; color: #333;
}
.gc2-cover-placeholder svg { width: 40px; height: 40px; opacity: 0.4; }
.gc2-cover-placeholder span { font-size: 0.7rem; opacity: 0.5; }
.gc2-scrim { position: absolute; inset: 0; background: linear-gradient(to bottom, transparent 38%, rgba(0,0,0,0.62) 60%, rgba(0,0,0,0.95) 100%); }
.gc2-scrim-dim { background: linear-gradient(rgba(10,10,10,0.55), rgba(10,10,10,0.55)), linear-gradient(to bottom, transparent 38%, rgba(0,0,0,0.68) 60%, rgba(0,0,0,0.96) 100%); }
.gc2-badge {
  position: absolute; top: 9px; z-index: 2;
  font-size: 0.62rem; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase;
  padding: 0.22rem 0.55rem; border-radius: 20px;
}
.gc2-badge-last { left: 9px; background: #dc2626; color: #fff; box-shadow: 0 2px 10px rgba(220,38,38,0.5); animation: gc-pulse 1.6s ease-in-out infinite; }
.gc2-badge-rented { left: 9px; background: rgba(20,20,20,0.9); color: #999; border: 1px solid rgba(255,255,255,0.16); }
.gc2-badge-new { right: 9px; background: linear-gradient(135deg, var(--ps-blue), #FFD700); color: #000; box-shadow: 0 2px 8px rgba(240,165,0,0.5); }
.gc2-body { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; padding: 0.85rem; display: flex; flex-direction: column; gap: 0.3rem; }
.gc2-plat { font-size: 0.62rem; font-weight: 700; color: var(--ps-blue); text-transform: uppercase; letter-spacing: 0.6px; }
.gc2-title {
  font-size: 0.92rem; font-weight: 800; line-height: 1.22; color: #fff; letter-spacing: -0.01em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.gc2-title-muted { color: #999; }
.gc2-status { display: flex; align-items: center; gap: 0.55rem; }
.gc2-status-muted { font-size: 0.7rem; color: #888; display: flex; align-items: center; gap: 0.3rem; }
.gc2-slot { display: inline-flex; align-items: center; gap: 0.2rem; font-size: 0.72rem; font-weight: 700; }
.gc2-slot-ok { color: #22c55e; }
.gc2-slot-tr { color: #ffc400; }
.gc2-slot-ps4 { color: #60a5fa; font-size: 0.62rem; border: 1px solid currentColor; padding: 0 0.25rem; border-radius: 3px; }
.gc2-slot-buy { color: #a78bfa; }
.gc2-icon { width: 13px; height: 13px; flex-shrink: 0; }
.gc2-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-top: 0.15rem; }
.gc2-price { font-size: 0.72rem; color: rgba(255,255,255,0.75); }
.gc2-price b { color: #fff; font-size: 0.92rem; font-weight: 800; }
.gc2-price-was { margin-left: 0.3rem; font-size: 0.66rem; color: rgba(255,255,255,0.4); }
.gc2-cta {
  background: #fff; color: #12081f; font-size: 0.72rem; font-weight: 800; padding: 0.4rem 0.8rem;
  border-radius: 20px; white-space: nowrap; flex-shrink: 0;
}
.gc2-cta-reserve { background: transparent; color: #a78bfa; border: 1px solid #4a2a8a; }
```

Note: `.gc-pulse` (the `@keyframes gc-pulse` used by `.gc2-badge-last`) already exists in the file from the current card's `.gc-slot-banner-last` rule — do not redefine it.

- [ ] **Step 3: Verify EJS compiles**

Run: `node -e "require('ejs').compile(require('fs').readFileSync('views/partials/game-card.ejs','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Verify the 4 call sites still compile with the changed partial**

Run: `node -e "
const ejs = require('ejs');
const fs = require('fs');
['views/browse.ejs','views/index.ejs'].forEach(f => { ejs.compile(fs.readFileSync(f,'utf8')); console.log(f, 'OK'); });
"`
Expected: both print `OK`. (This only validates each file's own EJS syntax, not that the include resolves correctly — that's confirmed live in Task 2.)

- [ ] **Step 5: Verify server syntax**

Run: `node -c server.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add views/partials/game-card.ejs public/css/style.css
git commit -m "feat: redesign available-games card as a poster matching Coming Soon"
```

---

### Task 2: Deploy and verify live

**Files:** none (verification only)

- [ ] **Step 1: Push to main**

```bash
git push
```

- [ ] **Step 2: Wait for Railway rollover, then confirm the deploy is live**

Poll `curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/` every ~10s until it returns `200`, then wait an additional ~25-30s for the new instance to fully take over.

- [ ] **Step 3: Verify the browse grid**

Visit `https://playstation-hub.com/browse`. Confirm cards render as 2:3 posters, titles are legible against their cover art (spot-check several different covers — this is the scrim-legibility risk flagged in the spec), slot icons show the right counts, and clicking a card goes to its game page.

- [ ] **Step 4: Verify all three states**

Find (or temporarily create via the admin edit-game form, then revert) one game in each state:
- **Open**: no top-left badge, white "Rent" CTA.
- **Last slot** (`non_trophy_slots + trophy_slots + ps4_primary_slots === 1` total across whichever types the game offers): red "Last slot" badge.
- **Rented** (all relevant slot counts at 0): dimmed art, muted title, "Free in Nd" or "Rented" text, outlined "Reserve" CTA.

If no live game is currently in Last-slot or Rented state, use the same temporary-edit-then-revert technique established earlier this session (`/admin/edit/:id`, change a slot count, screenshot/verify, change it back).

- [ ] **Step 5: Verify the homepage sliders**

Visit `https://playstation-hub.com/`. Confirm the New Releases and Featured sliders render the same card at the sliders' fixed 240px width without clipping or overflow, and that the shorter overall height (per the spec's aspect-ratio math) doesn't break the slider's scroll/arrow behavior.

- [ ] **Step 6: Verify the Buy indicator**

Find a game with `hasBuy` true (a `buy_nt_price` or `buy_tr_price` configured). Confirm the ∞ icon appears in its slots row and that clicking the card still goes to the game page (where the actual Buy action lives), not directly into a buy flow.
