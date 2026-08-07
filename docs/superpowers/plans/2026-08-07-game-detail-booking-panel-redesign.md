# Game Detail Booking Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the rent/buy booking panel on `views/game-detail.ejs` so the rental type selector's setup instructions move behind a chevron, a price is visible before any selection, the order summary stops popping in/out, and a mobile sticky bar keeps the CTA always reachable.

**Architecture:** This is a pure front-end change — one EJS view (`views/game-detail.ejs`) and its stylesheet (`public/css/style.css`). No `server.js` changes are needed: `getPromoDiscountPct` and `RENTAL_DURATIONS` are already exposed to every view via `app.locals` (confirmed at `server.js:20-25,241`), and the route (`server.js:1076-1088`) already passes everything the new markup needs (`game`, `promo`, `settings`).

**Tech Stack:** Express.js + EJS server-rendered views, vanilla JS (no framework, no bundler), hand-written CSS in one global stylesheet. No local dev server and no test framework — verification happens live on Railway (`git push` → wait ~70s → check https://playstation-hub.com with curl/the Browser tool), same as every other change in this project.

## Global Constraints

- Weekly = 7 days, Monthly = 30 days (already the case sitewide — not part of this change, just context for reading `RENTAL_DURATIONS`).
- Direction A only: no stepper, no three-across dense tiles (spec: Approach).
- Setup/console-sharing text moves behind a chevron on each account-type row — expandable, not deleted (spec: Structure item 5).
- Price header shows the cheapest live price before any selection, the exact selected price once type + duration are both chosen — same numbers as the order summary, never computed independently twice (spec: Structure item 4).
- Order summary is never `display:none` — always renders base price, discount row (when applicable), and a deposit row (even when the amount is ₱0), plus a hint line when incomplete, so nothing shifts layout when it fills in (spec: Structure item 7).
- The inline CTA button is never hidden pre-selection; its label tracks state: "Pick an account type" → "Pick a duration" → "📘 Message us on Facebook". It stays enabled at every state; clicking it early scrolls to and shakes the first incomplete step using the existing `gd-dur-grid-shake` class (spec: Structure item 8).
- Mobile sticky bar (≤820px only, matching the project's existing mobile breakpoint used by `.mobile-fab`): total on the left, CTA on the right, mirrors the inline CTA's state machine. No sticky bar above 820px (spec: Mobile sticky bar).
- `.mobile-fab` (`public/css/style.css:291`) must be hidden specifically on the game detail page via a page-scoped selector — not a global change to the FAB itself (spec: Conflict with the existing floating Messenger button).
- Buy Permanent mode: price header shows the buy price, sticky bar mirrors the buy total, two-state CTA machine ("Pick an account type" → "📘 Message us on Facebook", no duration step) (spec: Buy Permanent mode).
- No-slot / reservation states, the reserve/queue card internals, and the cover/gallery column are unchanged (spec: No-slot states, Out of scope).
- EJS tag-balance (`<%` count == `%>` count) must be verified for `views/game-detail.ejs` before every commit — established project convention.
- CSS brace-balance must be verified for `public/css/style.css` before every commit — established project convention.
- After deploying, verify live via the Browser tool against https://playstation-hub.com — no local dev server exists for this project.

---

### Task 1: Shared price header (rent + buy)

**Files:**
- Modify: `views/game-detail.ejs:15-30` (top calc block — add the rent "from" price calc)
- Modify: `views/game-detail.ejs:107-120` (insert price header markup after the mode toggle, before the `RENT PANEL` comment)
- Modify: `views/game-detail.ejs:372-433` (buy-flow script block — extend `updateBuyLink`/`selectBuyType`, add buy price header sync)
- Modify: `views/game-detail.ejs:394-404` (`setMode` — sync the header on tab switch)
- Modify: `public/css/style.css` (new `.gd-price-header` rule block, placed near the existing `.gd-section-label` rule at `public/css/style.css:582`)

**Interfaces:**
- Consumes: `getPromoDiscountPct(promo, days)` (already `app.locals`, used identically at `server.js`-rendered views like `views/partials/game-card.ejs:22`); `hasTrophy`, `promo`, `game.nt_price_7d`/`nt_price_30d`/`tr_price_7d`/`tr_price_30d` (all already available in this file's top calc block or passed by the route).
- Produces: server-side EJS local `gdFromPrice` (number) — the cheapest live rent price across every available type × duration, used both as the header's initial SSR content and read back by later tasks if needed. Client-side JS function `updatePriceHeader()` — called by rent-flow code (Task 3) whenever `selectedType`/`selectedDays` change. Client-side JS function `updateBuyPriceHeader()` — called by buy-flow code whenever `selectedBuyType` changes. DOM ids: `phKicker`, `phAmount` (with `data-default-kicker`/`data-default-amount` attributes holding the SSR "from" values), `phWas`, `phSave`.

- [ ] **Step 1: Add the server-side "from" price calculation**

In `views/game-detail.ejs`, find the top calc block (lines 15-30):

```ejs
<%
  // ── Availability: from linked accounts (phase 2) or legacy per-game counts, per slot type ──
  const sum = typeof accountSummary !== 'undefined' ? accountSummary : null;
  const availability = computeAvailability(game, sum);
  const { ntSlots, trSlots, ps4Slots, ntAvail, trAvail, ps4Avail, hasTrophy, showPs4, allUnavail, hasTrophyAcc, hasNtAcc, hasPs4Acc, totalSlots } = availability;
  const isLastSlot = totalSlots === 1;
  const noSlot = totalSlots === 0;
  const trLeft = trSlots, ntLeft = ntSlots, ps4Left = ps4Slots;
  const trNext = availability.trNext, ntNext = availability.ntNext, ps4Next = availability.ps4Next;
  const buyNt = game.buy_nt_price || 0;
  const buyTr = game.buy_tr_price || 0;
  const hasBuy = buyNt > 0 || buyTr > 0;
  const buyPromo = promo.buy_promo_enabled && promo.buy_promo_pct > 0;
  const buyNtFinal = buyPromo ? Math.round(buyNt * (1 - promo.buy_promo_pct / 100)) : buyNt;
  const buyTrFinal = buyPromo ? Math.round(buyTr * (1 - promo.buy_promo_pct / 100)) : buyTr;
%>
```

Add these lines immediately before the closing `%>`:

```ejs
  // Cheapest live rent price across every available type/duration combo — the
  // "From ₱X" the price header shows before a type+duration are both picked.
  // Same base data and discount math as game-card.ejs's gcAllPricePairs, kept
  // in sync deliberately: this header must never show a different number
  // than the card that linked here.
  const gdPricePairs = [
    [game.nt_price_7d, 7], [game.nt_price_30d, 30],
    ...(hasTrophy ? [[game.tr_price_7d, 7], [game.tr_price_30d, 30]] : [])
  ].filter(([base]) => base > 0).map(([base, d]) => {
    const pct = getPromoDiscountPct(promo, d);
    return { base, final: pct > 0 ? base - Math.round(base * pct / 100) : base };
  });
  const gdFromPrice = gdPricePairs.length ? gdPricePairs.reduce((a, b) => b.final < a.final ? b : a).final : 0;
```

- [ ] **Step 2: Insert the shared price header markup**

Find the mode toggle block (lines 107-119):

```ejs
      <!-- ══ TOP TOGGLE: Rent / Buy Permanent ══ -->
      <div style="display:flex;background:#111;border:1px solid #222;border-radius:12px;padding:4px;margin-bottom:1.5rem;gap:4px;">
        <button id="toggleRent" onclick="setMode('rent')"
          style="flex:1;padding:0.7rem;border-radius:9px;border:none;cursor:pointer;font-weight:800;font-size:0.9rem;background:var(--ps-blue);color:#000;transition:all 0.15s;letter-spacing:0.3px;">
          ⏱️ Rent
        </button>
        <% if (hasBuy) { %>
        <button id="toggleBuy" onclick="setMode('buy')"
          style="flex:1;padding:0.7rem;border-radius:9px;border:none;cursor:pointer;font-weight:800;font-size:0.9rem;background:transparent;color:#555;transition:all 0.15s;letter-spacing:0.3px;">
          ♾️ Buy Permanent
        </button>
        <% } %>
      </div>
```

Immediately after this block's closing `</div>` (and before the `RENT PANEL` comment on line 121), insert:

```ejs
      <!-- ══ PRICE HEADER: shared by rent and buy modes ══ -->
      <div class="gd-price-header">
        <div>
          <div class="gd-ph-kicker" id="phKicker" data-default-kicker="From">From</div>
          <div class="gd-ph-amount">
            <span id="phAmount" data-default-amount="<%= gdFromPrice %>">₱<%= gdFromPrice %></span>
          </div>
        </div>
        <div class="gd-ph-save-wrap">
          <span class="gd-ph-was" id="phWas" style="display:none;"></span>
          <span class="gd-ph-save" id="phSave" style="display:none;"></span>
        </div>
      </div>
```

- [ ] **Step 3: Add the CSS for `.gd-price-header`**

In `public/css/style.css`, find the `.gd-section-label` rule (around line 582):

```css
.gd-section-label { font-size: 0.75rem; font-weight: 800; letter-spacing: 1.2px; color: #555; text-transform: uppercase; margin-bottom: 0.75rem; }
```

Immediately after it, insert:

```css
.gd-price-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 0.75rem; background: #0d0d0d; border: 1px solid #222; border-radius: 12px; padding: 0.8rem 0.95rem; margin-bottom: 1.25rem; }
.gd-ph-kicker { font-size: 0.7rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #555; margin-bottom: 0.15rem; }
.gd-ph-amount { font-size: 1.55rem; font-weight: 900; color: var(--ps-blue); letter-spacing: -0.01em; line-height: 1; }
.gd-ph-save-wrap { text-align: right; }
.gd-ph-was { display: block; font-size: 0.78rem; color: #555; text-decoration: line-through; margin-bottom: 0.2rem; }
.gd-ph-save { display: inline-block; font-size: 0.7rem; font-weight: 800; color: #22c55e; background: rgba(34,197,94,0.13); padding: 0.15rem 0.4rem; border-radius: 5px; }
```

- [ ] **Step 4: Add `updatePriceHeader()` (rent) and wire it into the buy flow**

In `views/game-detail.ejs`'s `<script>` block, find `updateBuyLink()` (lines 420-433):

```js
function updateBuyLink() {
  const btn = document.getElementById('buyCtaBtn');
  if (!btn || !selectedBuyType) return;
  const gameTitle = '<%= game.title.replace(/'/g, "\\'") %>';
  const typeLabel = selectedBuyType === 'tr' ? 'Trophy Account' : 'Non-Trophy Account';
  const price = BUY_PRICES[selectedBuyType];
  const msg = [
    'Hi! I want to BUY PERMANENT ACCESS ♾️',
    'Game: ' + gameTitle,
    'Account Type: ' + typeLabel,
    'Price: ₱' + price
  ].join('\n');
  btn.href = 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(msg);
}
```

Add these two new functions immediately after it:

```js
// Shared by both modes — writes the same 4 DOM nodes the price header owns.
// Called with `null` for was/save to reset to the plain "From ₱X" state.
function setPriceHeader(kicker, amount, was, save) {
  const kEl = document.getElementById('phKicker');
  const amtEl = document.getElementById('phAmount');
  const wasEl = document.getElementById('phWas');
  const saveEl = document.getElementById('phSave');
  if (!kEl) return;
  kEl.textContent = kicker;
  amtEl.textContent = '₱' + amount;
  if (was != null && save != null) {
    wasEl.textContent = '₱' + was; wasEl.style.display = '';
    saveEl.textContent = 'Save ₱' + save; saveEl.style.display = '';
  } else {
    wasEl.style.display = 'none'; saveEl.style.display = 'none';
  }
}

function resetPriceHeader() {
  const kEl = document.getElementById('phKicker');
  const amtEl = document.getElementById('phAmount');
  if (!kEl) return;
  setPriceHeader(kEl.dataset.defaultKicker, amtEl.dataset.defaultAmount, null, null);
}

function updateBuyPriceHeader() {
  if (!selectedBuyType) { resetPriceHeader(); return; }
  const typeName = selectedBuyType === 'tr' ? 'trophy · permanent' : 'non-trophy · permanent';
  setPriceHeader(typeName, BUY_PRICES[selectedBuyType], null, null);
}
```

Then find `selectBuyType()` (lines 407-418):

```js
function selectBuyType(type) {
  selectedBuyType = type;
  ['nt','tr'].forEach(t => {
    const card = document.getElementById('buyNtCard'  .replace('nt', t === 'nt' ? 'Nt' : 'Tr'));
    // fix: use correct IDs
  });
  const ntCard = document.getElementById('buyNtCard');
  const trCard = document.getElementById('buyTrCard');
  if (ntCard) ntCard.style.borderColor = type === 'nt' ? '#22c55e' : '#222';
  if (trCard) trCard.style.borderColor = type === 'tr' ? '#ffc400' : 'rgba(255,196,0,0.2)';
  updateBuyLink();
}
```

Add a call to the new function at the end (the dead `['nt','tr'].forEach` loop with the `// fix: use correct IDs` comment is pre-existing dead code — leave it exactly as-is, this task does not touch it):

```js
function selectBuyType(type) {
  selectedBuyType = type;
  ['nt','tr'].forEach(t => {
    const card = document.getElementById('buyNtCard'  .replace('nt', t === 'nt' ? 'Nt' : 'Tr'));
    // fix: use correct IDs
  });
  const ntCard = document.getElementById('buyNtCard');
  const trCard = document.getElementById('buyTrCard');
  if (ntCard) ntCard.style.borderColor = type === 'nt' ? '#22c55e' : '#222';
  if (trCard) trCard.style.borderColor = type === 'tr' ? '#ffc400' : 'rgba(255,196,0,0.2)';
  updateBuyLink();
  updateBuyPriceHeader();
}
```

- [ ] **Step 5: Sync the header when `setMode()` switches tabs**

Find `setMode()` (lines 394-404):

```js
function setMode(mode) {
  currentMode = mode;
  const isRent = mode === 'rent';
  document.getElementById('rentPanel').style.display = isRent ? 'block' : 'none';
  const buyPanel = document.getElementById('buyPanel');
  if (buyPanel) buyPanel.style.display = isRent ? 'none' : 'block';
  document.getElementById('toggleRent').style.background = isRent ? 'var(--ps-blue)' : 'transparent';
  document.getElementById('toggleRent').style.color = isRent ? '#000' : '#555';
  const tb = document.getElementById('toggleBuy');
  if (tb) { tb.style.background = isRent ? 'transparent' : 'linear-gradient(135deg,#7b2ff7,#f107a3)'; tb.style.color = isRent ? '#555' : '#fff'; }
}
```

Add one line at the end, before the closing `}`:

```js
function setMode(mode) {
  currentMode = mode;
  const isRent = mode === 'rent';
  document.getElementById('rentPanel').style.display = isRent ? 'block' : 'none';
  const buyPanel = document.getElementById('buyPanel');
  if (buyPanel) buyPanel.style.display = isRent ? 'none' : 'block';
  document.getElementById('toggleRent').style.background = isRent ? 'var(--ps-blue)' : 'transparent';
  document.getElementById('toggleRent').style.color = isRent ? '#000' : '#555';
  const tb = document.getElementById('toggleBuy');
  if (tb) { tb.style.background = isRent ? 'transparent' : 'linear-gradient(135deg,#7b2ff7,#f107a3)'; tb.style.color = isRent ? '#555' : '#fff'; }
  if (isRent) { updateTotal(); } else { updateBuyPriceHeader(); }
}
```

`updateTotal()` doesn't exist yet in a form that calls `updatePriceHeader()` — that wiring is Task 3's job. For this task, calling the pre-existing `updateTotal()` here is enough to not break anything (it's already called elsewhere); Task 3 will make it also refresh the price header, and at that point `setMode('rent')` will correctly refresh the header too, without needing to touch this line again.

- [ ] **Step 6: Verify EJS tag balance and CSS brace balance**

Run: `grep -o '<%' views/game-detail.ejs | wc -l` and `grep -o '%>' views/game-detail.ejs | wc -l` — must be equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — must be equal.

- [ ] **Step 7: Commit**

```bash
git add views/game-detail.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Add shared price header to game detail booking panel

Introduces a price header above the rent/buy toggle that shows the
cheapest live price before any selection, and the exact selected
price once a type and duration (or buy type) are chosen. Shared
between rent and buy modes so switching tabs keeps it in sync.
EOF
)"
```

---

### Task 2: Compact account-type rows with expandable setup

**Files:**
- Modify: `views/game-detail.ejs:137-195` (the three `.gd-type-card` blocks: Trophy, Non-Trophy, PS4 Primary)
- Modify: `public/css/style.css:583-597` (existing `.gd-type-*` rules — extend, don't remove; the `label`/`disabled` rules stay, since Task 1's step 5 note about `id="label-tr"` still applying means the outer element keeps that id and the `gd-type-selected`/`gd-type-disabled` classes still target it)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: a `toggleTypeSetup(id)` JS function later tasks don't depend on (self-contained); the outer wrapper for each type keeps its existing `id="label-tr"` / `id="label-nt"` / `id="label-ps4"` and `.gd-type-card` class, so `onTypeChange()`'s existing `document.getElementById('label-' + selectedType)?.classList.add('gd-type-selected')` (line 456, untouched by this task) keeps working with no code change.

- [ ] **Step 1: Replace the three type-card blocks**

Find the full block from `<!-- SELECT RENTAL TYPE -->` through the closing of the `.gd-type-options` div (lines 137-195):

```ejs
        <!-- SELECT RENTAL TYPE -->
        <div class="gd-section-label" style="margin-top:<%= allUnavail ? '1.25rem' : '0' %>;">SELECT RENTAL TYPE</div>
        <div class="gd-type-options" id="typeOptions">

          <% if (hasTrophy) { %>
          <label class="gd-type-card" id="label-tr">
            <input type="radio" name="rentalType" value="tr" onchange="onTypeChange(this)">
            <div class="gd-type-body">
              <div class="gd-type-header">
                <span class="gd-type-icon">🏆</span>
                <span class="gd-type-name">Trophy</span>
                <span class="gd-type-status <%= trAvail ? 'gd-status-avail' : 'gd-status-rented' %>"><%= trAvail ? 'Available' : 'Full Slot' %></span>
                <% if (hasTrophyAcc && trAvail) { %><span class="gd-slots-left"><%= trLeft %> slot<%= trLeft !== 1 ? 's' : '' %> left</span><% } %>
              </div>
              <div class="gd-type-desc">✅ Play our games on <strong>YOUR OWN account</strong> and earn trophies on your profile.<br><span style="color:#22c55e;">Setup: Settings → Account → Other → Console Sharing → <strong>ENABLE</strong></span></div>
              <% const trSoon = trNext != null && trNext > 0 ? trNext : null; %>
              <% if (!trAvail && trSoon != null && trSoon > 0) { %>
              <div class="gd-avail-soon">📅 Next available in <strong><%= trSoon %> day<%= trSoon !== 1 ? 's' : '' %></strong></div>
              <% } %>
            </div>
          </label>
          <% } %>

          <label class="gd-type-card" id="label-nt">
            <input type="radio" name="rentalType" value="nt" onchange="onTypeChange(this)">
            <div class="gd-type-body">
              <div class="gd-type-header">
                <span class="gd-type-icon">🎮</span>
                <span class="gd-type-name">Non-Trophy</span>
                <span class="gd-type-status <%= ntAvail ? 'gd-status-avail' : 'gd-status-rented' %>"><%= ntAvail ? 'Available' : 'Full Slot' %></span>
                <% if (hasNtAcc && ntAvail) { %><span class="gd-slots-left"><%= ntLeft %> slot<%= ntLeft !== 1 ? 's' : '' %> left</span><% } %>
              </div>
              <div class="gd-type-desc">🎮 Play the game on <strong>OUR account</strong> only. Trophies <strong>won't</strong> count on your own profile.<br><span style="color:#888;">Setup: Settings → Account → Other → Console Sharing → <strong>DON'T enable</strong></span></div>
              <% const ntSoon = ntNext != null && ntNext > 0 ? ntNext : null; %>
              <% if (!ntAvail && ntSoon != null && ntSoon > 0) { %>
              <div class="gd-avail-soon">📅 Next available in <strong><%= ntSoon %> day<%= ntSoon !== 1 ? 's' : '' %></strong></div>
              <% } %>
            </div>
          </label>

          <% if (showPs4) { %>
          <label class="gd-type-card" id="label-ps4">
            <input type="radio" name="rentalType" value="ps4" onchange="onTypeChange(this)">
            <div class="gd-type-body">
              <div class="gd-type-header">
                <span class="gd-type-icon">🕹️</span>
                <span class="gd-type-name">PS4 Primary</span>
                <span class="gd-type-status <%= ps4Avail ? 'gd-status-avail' : 'gd-status-rented' %>"><%= ps4Avail ? 'Available' : 'Full Slot' %></span>
                <% if (hasPs4Acc && ps4Avail) { %><span class="gd-slots-left"><%= ps4Left %> slot<%= ps4Left !== 1 ? 's' : '' %> left</span><% } %>
              </div>
              <div class="gd-type-desc">🕹️ Set our account as <strong>PS4 primary</strong> — play on your PS4 and earn trophies on your own profile.<br><span style="color:#22c55e;">Setup: Settings → Account → Other → Console Sharing → <strong>ENABLE</strong> (on PS4)</span></div>
              <% if (!ps4Avail && ps4Next != null && ps4Next > 0) { %>
              <div class="gd-avail-soon">📅 Next available in <strong><%= ps4Next %> day<%= ps4Next !== 1 ? 's' : '' %></strong></div>
              <% } %>
            </div>
          </label>
          <% } %>

        </div>
```

Replace it with:

```ejs
        <!-- SELECT RENTAL TYPE -->
        <div class="gd-section-label" style="margin-top:<%= allUnavail ? '1.25rem' : '0' %>;">SELECT RENTAL TYPE</div>
        <div class="gd-type-options" id="typeOptions">

          <% if (hasTrophy) { %>
          <div class="gd-type-card" id="label-tr">
            <div class="gd-type-row">
              <label class="gd-type-row-label">
                <input type="radio" name="rentalType" value="tr" class="gd-type-radio" onchange="onTypeChange(this)">
                <span class="gd-type-icon">🏆</span>
                <span class="gd-type-name">Trophy</span>
                <% if (hasTrophyAcc && trAvail) { %><span class="gd-slots-left"><%= trLeft %> slot<%= trLeft !== 1 ? 's' : '' %> left</span><% } %>
                <span class="gd-type-status <%= trAvail ? 'gd-status-avail' : 'gd-status-rented' %>"><%= trAvail ? 'Available' : 'Full Slot' %></span>
              </label>
              <button type="button" class="gd-type-chev" aria-expanded="false" aria-label="Setup details for Trophy" onclick="toggleTypeSetup('tr')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
            <div class="gd-type-setup" id="setup-tr" data-open="0">
              <p>✅ Play our games on <strong>YOUR OWN account</strong> and earn trophies on your profile.</p>
              <p style="color:#22c55e;">Setup: Settings → Account → Other → Console Sharing → <strong>ENABLE</strong></p>
              <% const trSoon = trNext != null && trNext > 0 ? trNext : null; %>
              <% if (!trAvail && trSoon != null && trSoon > 0) { %>
              <p class="gd-avail-soon">📅 Next available in <strong><%= trSoon %> day<%= trSoon !== 1 ? 's' : '' %></strong></p>
              <% } %>
            </div>
          </div>
          <% } %>

          <div class="gd-type-card" id="label-nt">
            <div class="gd-type-row">
              <label class="gd-type-row-label">
                <input type="radio" name="rentalType" value="nt" class="gd-type-radio" onchange="onTypeChange(this)">
                <span class="gd-type-icon">🎮</span>
                <span class="gd-type-name">Non-Trophy</span>
                <% if (hasNtAcc && ntAvail) { %><span class="gd-slots-left"><%= ntLeft %> slot<%= ntLeft !== 1 ? 's' : '' %> left</span><% } %>
                <span class="gd-type-status <%= ntAvail ? 'gd-status-avail' : 'gd-status-rented' %>"><%= ntAvail ? 'Available' : 'Full Slot' %></span>
              </label>
              <button type="button" class="gd-type-chev" aria-expanded="false" aria-label="Setup details for Non-Trophy" onclick="toggleTypeSetup('nt')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
            <div class="gd-type-setup" id="setup-nt" data-open="0">
              <p>🎮 Play the game on <strong>OUR account</strong> only. Trophies <strong>won't</strong> count on your own profile.</p>
              <p style="color:#888;">Setup: Settings → Account → Other → Console Sharing → <strong>DON'T enable</strong></p>
              <% const ntSoon = ntNext != null && ntNext > 0 ? ntNext : null; %>
              <% if (!ntAvail && ntSoon != null && ntSoon > 0) { %>
              <p class="gd-avail-soon">📅 Next available in <strong><%= ntSoon %> day<%= ntSoon !== 1 ? 's' : '' %></strong></p>
              <% } %>
            </div>
          </div>

          <% if (showPs4) { %>
          <div class="gd-type-card" id="label-ps4">
            <div class="gd-type-row">
              <label class="gd-type-row-label">
                <input type="radio" name="rentalType" value="ps4" class="gd-type-radio" onchange="onTypeChange(this)">
                <span class="gd-type-icon">🕹️</span>
                <span class="gd-type-name">PS4 Primary</span>
                <% if (hasPs4Acc && ps4Avail) { %><span class="gd-slots-left"><%= ps4Left %> slot<%= ps4Left !== 1 ? 's' : '' %> left</span><% } %>
                <span class="gd-type-status <%= ps4Avail ? 'gd-status-avail' : 'gd-status-rented' %>"><%= ps4Avail ? 'Available' : 'Full Slot' %></span>
              </label>
              <button type="button" class="gd-type-chev" aria-expanded="false" aria-label="Setup details for PS4 Primary" onclick="toggleTypeSetup('ps4')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
            <div class="gd-type-setup" id="setup-ps4" data-open="0">
              <p>🕹️ Set our account as <strong>PS4 primary</strong> — play on your PS4 and earn trophies on your own profile.</p>
              <p style="color:#22c55e;">Setup: Settings → Account → Other → Console Sharing → <strong>ENABLE</strong> (on PS4)</p>
              <% if (!ps4Avail && ps4Next != null && ps4Next > 0) { %>
              <p class="gd-avail-soon">📅 Next available in <strong><%= ps4Next %> day<%= ps4Next !== 1 ? 's' : '' %></strong></p>
              <% } %>
            </div>
          </div>
          <% } %>

        </div>
```

- [ ] **Step 2: Add the `toggleTypeSetup()` JS function**

In the `<script>` block, find `onTypeChange()` (around line 453). Add the new function immediately before it:

```js
// Expand/collapse a type row's setup panel. Independent of selecting that
// type — the chevron button is a sibling of the <label>, not a descendant,
// so clicking it never fires the label's native radio-click forwarding.
function toggleTypeSetup(id) {
  const panel = document.getElementById('setup-' + id);
  const chev = panel && panel.previousElementSibling.querySelector('.gd-type-chev');
  if (!panel || !chev) return;
  const open = panel.dataset.open === '1';
  panel.dataset.open = open ? '0' : '1';
  chev.setAttribute('aria-expanded', String(!open));
}
```

- [ ] **Step 3: Add CSS for the compact row and setup panel**

In `public/css/style.css`, find the existing type-card rules (around lines 583-597):

```css
.gd-type-options { display: flex; flex-direction: column; gap: 0.6rem; }
.gd-type-card { display: flex; align-items: flex-start; gap: 0.75rem; background: #111; border: 1.5px solid #222; border-radius: 12px; padding: 0.85rem 1rem; cursor: pointer; transition: border-color 0.15s; }
.gd-type-card:hover:not(.gd-type-disabled) { border-color: #444; }
.gd-type-card.gd-type-selected { border-color: var(--ps-blue); background: rgba(0,112,209,0.06); }
.gd-type-card.gd-type-disabled { opacity: 0.45; cursor: not-allowed; }
.gd-type-card input[type="radio"] { margin-top: 3px; accent-color: var(--ps-blue); flex-shrink: 0; }
.gd-type-body { flex: 1; min-width: 0; }
.gd-type-header { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem; flex-wrap: wrap; }
.gd-type-icon { font-size: 0.9rem; }
.gd-type-name { font-weight: 700; font-size: 0.95rem; }
.gd-type-status { font-size: 0.75rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 4px; margin-left: auto; }
.gd-status-avail { background: rgba(34,197,94,0.15); color: #22c55e; }
.gd-status-rented { background: rgba(239,68,68,0.15); color: #ef4444; }
.gd-slots-left { font-size: 0.75rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; background: rgba(0,112,209,0.15); color: #38bdf8; margin-left: 0.35rem; }
.gd-type-desc { font-size: 0.78rem; color: #666; line-height: 1.5; }
```

Change `.gd-type-card` to drop the flex/padding/cursor rules that no longer apply to the outer wrapper (the row inside now owns those), and add the new rules. Replace the whole block above with:

```css
.gd-type-options { display: flex; flex-direction: column; gap: 0.6rem; }
.gd-type-card { background: #111; border: 1.5px solid #222; border-radius: 12px; overflow: hidden; transition: border-color 0.15s; }
.gd-type-card:hover:not(.gd-type-disabled) { border-color: #444; }
.gd-type-card.gd-type-selected { border-color: var(--ps-blue); background: rgba(0,112,209,0.06); }
.gd-type-card.gd-type-disabled { opacity: 0.45; }
.gd-type-row { display: flex; align-items: center; }
.gd-type-row-label { display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0; padding: 0.7rem 0.75rem; cursor: pointer; }
.gd-type-row-label:focus-within { outline: 2px solid var(--ps-blue); outline-offset: -2px; border-radius: 8px; }
.gd-type-radio { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.gd-type-icon { font-size: 0.9rem; flex-shrink: 0; }
.gd-type-name { font-weight: 700; font-size: 0.95rem; }
.gd-type-status { font-size: 0.75rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 4px; margin-left: auto; flex-shrink: 0; }
.gd-status-avail { background: rgba(34,197,94,0.15); color: #22c55e; }
.gd-status-rented { background: rgba(239,68,68,0.15); color: #ef4444; }
.gd-slots-left { font-size: 0.75rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; background: rgba(0,112,209,0.15); color: #38bdf8; flex-shrink: 0; }
.gd-type-chev { background: transparent; border: 0; color: #555; cursor: pointer; padding: 0.5rem 0.7rem; line-height: 0; flex-shrink: 0; }
.gd-type-chev:hover { color: #fff; }
.gd-type-chev svg { transition: transform 0.2s; }
.gd-type-chev[aria-expanded="true"] svg { transform: rotate(180deg); }
.gd-type-setup { display: none; padding: 0 0.75rem 0.75rem 2.65rem; font-size: 0.78rem; color: #666; line-height: 1.55; }
.gd-type-setup[data-open="1"] { display: block; }
.gd-type-setup p { margin: 0 0 0.35rem; }
.gd-type-setup p:last-child { margin-bottom: 0; }
```

Leave the pre-existing `.gd-avail-soon` rule (defined further down the file) untouched — it's reused as-is inside `.gd-type-setup` now instead of inside `.gd-type-body`.

- [ ] **Step 4: Verify EJS tag balance and CSS brace balance**

Run the same two checks as Task 1, Step 6, against both files.

- [ ] **Step 5: Commit**

```bash
git add views/game-detail.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Collapse account-type cards to compact rows with expandable setup

Each rental-type card shrinks from ~85px to a single-line row (icon,
name, status, slots-left, chevron). The console-sharing setup steps
and "next available" line move into a collapsible panel behind the
chevron, cutting roughly 150px of always-visible height that customers
only need after booking, not while deciding.
EOF
)"
```

---

### Task 3: Persistent order summary + CTA state machine

**Files:**
- Modify: `views/game-detail.ejs:209-225` (order summary + CTA markup)
- Modify: `views/game-detail.ejs:452-507` (`onTypeChange`, `onDurChange`, `updateTotal` — rewrite; introduces `updateCtaState`)
- Modify: `public/css/style.css:615-624` (`.gd-total-*`, `.gd-cta-btn` rules — extend)

**Interfaces:**
- Consumes: `setPriceHeader()` / `resetPriceHeader()` from Task 1 (called from the rewritten `updateTotal()`).
- Produces: `updateCtaState()` — called by `onTypeChange`/`onDurChange` in this task, and by Task 5's sticky-bar sync function.

- [ ] **Step 1: Remove `display:none` from the order summary and add a hint element**

Find (lines 209-217):

```ejs
        <!-- TOTAL BREAKDOWN -->
        <div class="gd-total-box" id="totalBox" style="display:none;">
          <div class="gd-total-label">ORDER SUMMARY</div>
          <div class="gd-total-rows" id="totalRows"></div>
          <div class="gd-total-final">
            <span>Total</span>
            <span id="totalFinal" style="color:var(--ps-blue);font-size:1.2rem;font-weight:900;"></span>
          </div>
        </div>
```

Replace with:

```ejs
        <!-- TOTAL BREAKDOWN -->
        <div class="gd-total-box" id="totalBox">
          <div class="gd-total-label">ORDER SUMMARY</div>
          <div class="gd-total-rows" id="totalRows"></div>
          <div class="gd-total-final">
            <span>Total</span>
            <span id="totalFinal" style="color:var(--ps-blue);font-size:1.2rem;font-weight:900;"></span>
          </div>
          <div class="gd-total-hint" id="totalHint" style="display:none;"></div>
        </div>
```

- [ ] **Step 2: Give the CTA a "waiting" style and keep it always in the DOM**

Find (lines 219-225):

```ejs
        <% if (!allUnavail) { %>
        <!-- CTA: Message Us (available slot) -->
        <a href="#" class="gd-cta-btn" id="ctaBtn" style="display:none;" onclick="return handleMessageUs(event)">
          📘 Message Us on Facebook
        </a>
        <div class="gd-cta-hint" id="ctaHint" style="display:none;">Send us: <strong>Game name · Days · Trophy or Non-Trophy</strong></div>
        <div id="ctaValidationMsg" style="display:none;text-align:center;margin-top:0.5rem;font-size:0.82rem;color:#ef4444;font-weight:600;"></div>
```

Replace with (same `style="display:none;"` removed from `ctaBtn` — the JS will manage its visibility going forward, but it now starts visible with wait-state text rather than hidden):

```ejs
        <% if (!allUnavail) { %>
        <!-- CTA: Message Us (available slot) -->
        <a href="#" class="gd-cta-btn gd-cta-wait" id="ctaBtn" onclick="return handleMessageUs(event)">
          Pick an account type
        </a>
        <div class="gd-cta-hint" id="ctaHint" style="display:none;">Send us: <strong>Game name · Days · Trophy or Non-Trophy</strong></div>
        <div id="ctaValidationMsg" style="display:none;text-align:center;margin-top:0.5rem;font-size:0.82rem;color:#ef4444;font-weight:600;"></div>
```

- [ ] **Step 3: Rewrite `onTypeChange`, `onDurChange`, `updateTotal`; add `updateCtaState`**

Find (lines 452-507):

```js
// ── Rent flow ──
function onTypeChange(radio) {
  selectedType = radio.value;
  document.querySelectorAll('.gd-type-card').forEach(c => c.classList.remove('gd-type-selected'));
  document.getElementById('label-' + selectedType)?.classList.add('gd-type-selected');
  updatePrices();
  updateTotal();
  updateReserveLinks();
  const hasSlot = AVAIL[selectedType] !== false;
  const ctaBtn = document.getElementById('ctaBtn');
  const ctaHint = document.getElementById('ctaHint');
  const reserveSection = document.getElementById('reserveSection');
  if (ctaBtn) ctaBtn.style.display = hasSlot ? '' : 'none';
  if (ctaHint) ctaHint.style.display = hasSlot ? '' : 'none';
  if (reserveSection) reserveSection.style.display = hasSlot ? 'none' : '';
}

function onDurChange(btn) {
  selectedDays = parseInt(btn.dataset.days);
  document.querySelectorAll('.gd-dur-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateTotal();
  updateReserveLinks();
}

function updatePrices() {
  if (!selectedType) return;
  RENTAL_DURATIONS.forEach(d => {
    const el = document.getElementById('price-' + d);
    if (!el) return;
    const base = PRICES[selectedType][d];
    const pct = promoPctFor(d);
    if (pct > 0) {
      const final = base - Math.round(base * pct / 100);
      el.innerHTML = '<span class="gd-dur-price-orig">₱' + base + '</span> ₱' + final;
    } else {
      el.textContent = '₱' + base;
    }
  });
}

function updateTotal() {
  const box = document.getElementById('totalBox');
  if (!selectedType || !selectedDays) { if(box) box.style.display = 'none'; return; }
  const base = PRICES[selectedType][selectedDays];
  const pct = promoPctFor(selectedDays);
  const discount = pct > 0 ? Math.round(base * pct / 100) : 0;
  const deposit  = (selectedType === 'tr' || selectedType === 'ps4') ? PROMO.deposit : 0;
  const total    = base - discount + deposit;
  let rows = `<div class="gd-total-row"><span>Base (${selectedDays} days)</span><span>₱${base}</span></div>`;
  if (discount > 0) rows += `<div class="gd-total-row gd-total-disc"><span>🎉 ${pct}% OFF (${selectedDays}-day promo)</span><span>-₱${discount}</span></div>`;
  if (deposit  > 0) rows += `<div class="gd-total-row gd-total-dep"><span>🔒 Security Deposit (refundable)</span><span>+₱${deposit}</span></div>`;
  document.getElementById('totalRows').innerHTML = rows;
  document.getElementById('totalFinal').textContent = '₱' + total;
  box.style.display = 'block';
}
```

Replace with:

```js
// ── Rent flow ──
function onTypeChange(radio) {
  selectedType = radio.value;
  document.querySelectorAll('.gd-type-card').forEach(c => c.classList.remove('gd-type-selected'));
  document.getElementById('label-' + selectedType)?.classList.add('gd-type-selected');
  updatePrices();
  updateTotal();
  updateReserveLinks();
  updateCtaState();
}

function onDurChange(btn) {
  selectedDays = parseInt(btn.dataset.days);
  document.querySelectorAll('.gd-dur-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateTotal();
  updateReserveLinks();
  updateCtaState();
}

function updatePrices() {
  if (!selectedType) return;
  RENTAL_DURATIONS.forEach(d => {
    const el = document.getElementById('price-' + d);
    if (!el) return;
    const base = PRICES[selectedType][d];
    const pct = promoPctFor(d);
    if (pct > 0) {
      const final = base - Math.round(base * pct / 100);
      el.innerHTML = '<span class="gd-dur-price-orig">₱' + base + '</span> ₱' + final;
    } else {
      el.textContent = '₱' + base;
    }
  });
}

// Order summary is always visible now — this fills it with the exact
// selection once both are picked, or the cheapest "from" figure plus a
// hint line while incomplete, so the box never pops in/out or resizes
// beyond its own row content changing.
function updateTotal() {
  const rowsEl = document.getElementById('totalRows');
  const finalEl = document.getElementById('totalFinal');
  const hintEl = document.getElementById('totalHint');
  if (!rowsEl || !finalEl) return;

  let base, discount = 0, deposit = 0, pct = 0, baseLabel = 'Base';

  if (selectedType && selectedDays) {
    base = PRICES[selectedType][selectedDays];
    pct = promoPctFor(selectedDays);
    discount = pct > 0 ? Math.round(base * pct / 100) : 0;
    deposit = (selectedType === 'tr' || selectedType === 'ps4') ? PROMO.deposit : 0;
    baseLabel = 'Base (' + selectedDays + ' days)';
    updatePriceHeaderFromSelection(base, discount);
  } else {
    const amtEl = document.getElementById('phAmount');
    base = amtEl ? parseInt(amtEl.dataset.defaultAmount, 10) : 0;
    resetPriceHeader();
  }

  const total = base - discount + deposit;
  let rows = `<div class="gd-total-row"><span>${baseLabel}</span><span>₱${base}</span></div>`;
  if (discount > 0) rows += `<div class="gd-total-row gd-total-disc"><span>🎉 ${pct}% OFF</span><span>-₱${discount}</span></div>`;
  rows += `<div class="gd-total-row gd-total-dep"><span>🔒 Security Deposit (refundable)</span><span>+₱${deposit}</span></div>`;
  rowsEl.innerHTML = rows;
  finalEl.textContent = '₱' + total;

  if (hintEl) {
    if (!selectedType) { hintEl.textContent = 'Pick an account type to see your exact total.'; hintEl.style.display = ''; }
    else if (!selectedDays) { hintEl.textContent = 'Pick a duration to see your exact total.'; hintEl.style.display = ''; }
    else { hintEl.style.display = 'none'; }
  }
}

// Small bridge to Task 1's setPriceHeader(), kept separate from updateTotal
// so this task doesn't need to know Task 1's exact signature inline twice.
function updatePriceHeaderFromSelection(base, discount) {
  const durName = selectedDays === 7 ? 'Weekly' : 'Monthly';
  const typeName = selectedType === 'tr' ? 'trophy' : selectedType === 'ps4' ? 'PS4 primary' : 'non-trophy';
  const final = base - discount;
  setPriceHeader(durName + ' · ' + typeName, final, discount > 0 ? base : null, discount > 0 ? discount : null);
}

// CTA label tracks how much is left to pick. Never disabled — an incomplete
// click scrolls to and shakes the first missing step (see handleMessageUs).
function updateCtaState() {
  const ctaBtn = document.getElementById('ctaBtn');
  const ctaHint = document.getElementById('ctaHint');
  const reserveSection = document.getElementById('reserveSection');
  if (!ctaBtn) return;

  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (selectedType && !hasSlot) {
    ctaBtn.style.display = 'none';
    if (ctaHint) ctaHint.style.display = 'none';
    if (reserveSection) reserveSection.style.display = '';
    return;
  }
  ctaBtn.style.display = '';
  if (reserveSection) reserveSection.style.display = 'none';

  if (!selectedType) {
    ctaBtn.textContent = 'Pick an account type';
    ctaBtn.classList.add('gd-cta-wait');
    if (ctaHint) ctaHint.style.display = 'none';
  } else if (!selectedDays) {
    ctaBtn.textContent = 'Pick a duration';
    ctaBtn.classList.add('gd-cta-wait');
    if (ctaHint) ctaHint.style.display = 'none';
  } else {
    ctaBtn.textContent = '📘 Message Us on Facebook';
    ctaBtn.classList.remove('gd-cta-wait');
    if (ctaHint) ctaHint.style.display = '';
  }
}
```

- [ ] **Step 4: Add CSS for the hint line and the CTA's waiting style**

Find (around lines 615-624):

```css
.gd-total-box { background: #0d0d0d; border: 1px solid #222; border-radius: 12px; padding: 1rem 1.1rem; margin-top: 1.25rem; }
.gd-total-label { font-size: 0.75rem; font-weight: 800; letter-spacing: 1px; color: #444; text-transform: uppercase; margin-bottom: 0.65rem; }
.gd-total-rows { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0.75rem; border-bottom: 1px solid #1a1a1a; padding-bottom: 0.75rem; }
.gd-total-row { display: flex; justify-content: space-between; font-size: 0.82rem; color: #888; }
.gd-total-disc { color: #22c55e; }
.gd-total-dep { color: #f59e0b; }
.gd-total-final { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 0.9rem; color: #fff; }
.gd-cta-btn { display: block; width: 100%; text-align: center; background: var(--ps-blue); color: #fff; padding: 0.9rem; border-radius: 10px; font-weight: 700; font-size: 1rem; text-decoration: none; margin-top: 1.25rem; transition: opacity 0.15s; }
.gd-cta-btn:hover { opacity: 0.85; }
.gd-cta-hint { text-align: center; font-size: 0.75rem; color: #444; margin-top: 0.5rem; }
```

Add these two rules after `.gd-total-final` and after `.gd-cta-btn:hover` respectively:

```css
.gd-total-hint { font-size: 0.75rem; color: #555; margin-top: 0.6rem; text-align: center; }
```

```css
.gd-cta-btn.gd-cta-wait { background: #1a1a1a; color: #666; }
```

- [ ] **Step 5: Verify EJS tag balance and CSS brace balance**

Same checks as prior tasks.

- [ ] **Step 6: Commit**

```bash
git add views/game-detail.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Make order summary always visible and give the CTA a label state machine

The order summary no longer toggles display:none — it always shows a
base price, deposit row, and hint line, so nothing pops in or shifts
layout once a type and duration are both picked. The CTA button stays
visible at every state, with its label tracking what's still missing
("Pick an account type" -> "Pick a duration" -> "Message Us on
Facebook") instead of being hidden until both selections are made.
EOF
)"
```

---

### Task 4: Mobile sticky bar + hide the floating Messenger button on this page

**Files:**
- Modify: `views/game-detail.ejs:32` (`<div class="gd-page">` — add a page-scoped body-equivalent hook)
- Modify: `views/game-detail.ejs:366-369` (insert sticky bar markup after `.gd-layout` closes, before `</div>` for `.gd-page`)
- Modify: `views/game-detail.ejs:394-404` (`setMode`) and the buy-flow/rent-flow functions touched in Tasks 1 and 3 — add sticky-bar sync calls
- Modify: `views/game-detail.ejs`'s `DOMContentLoaded` handler (lines 569-582) — add initial sync call
- Modify: `public/css/style.css` (new `.gd-sticky-bar` rule block; a page-scoped override for `.mobile-fab`; bottom padding on `.gd-page` at the existing 820px breakpoint)

**Interfaces:**
- Consumes: `selectedType`, `selectedDays`, `selectedBuyType`, `currentMode`, `AVAIL`, `PRICES`, `BUY_PRICES`, `promoPctFor()`, `PROMO.deposit` (all already module-level globals in this file); `updateCtaState()` from Task 3 is NOT called by the bar directly — the bar keeps its own compact state logic since its button text differs slightly ("Message us" vs "📘 Message Us on Facebook") and it must also cover buy mode, which `updateCtaState()` doesn't.
- Produces: `syncStickyBar()` — called from `onTypeChange`, `onDurChange` (Task 3), `selectBuyType` (Task 1), `setMode` (Task 1), and once at `DOMContentLoaded`.

- [ ] **Step 1: Add a page-scoped class to the outer page wrapper**

This project's `<body>` tag has no page-identifying class anywhere in `views/game-detail.ejs` (confirmed: `<body>` at line 11 is bare). Rather than add a `body` class — which would require touching the shared `partials/nav.ejs`/`partials/announcement.ejs` include order — scope everything to the existing outermost wrapper this page already has. Find line 32:

```ejs
<div class="gd-page">
```

Change to:

```ejs
<div class="gd-page gd-page-booking-v2">
```

- [ ] **Step 2: Insert the sticky bar markup**

Find the end of `.gd-layout` (lines 366-369):

```ejs
    </div>
  </div>
</div>

<%- include('partials/footer') %>
```

Replace with:

```ejs
    </div>
  </div>

  <!-- ══ MOBILE STICKY BAR (≤820px) ══ -->
  <div class="gd-sticky-bar" id="gdStickyBar">
    <div class="gd-sb-info">
      <div class="gd-sb-kicker" id="gdSbKicker">From</div>
      <div class="gd-sb-amount" id="gdSbAmount">₱<%= gdFromPrice %></div>
    </div>
    <button type="button" class="gd-sb-btn" id="gdSbBtn" onclick="handleStickyBarClick()">Pick a type</button>
  </div>
</div>

<%- include('partials/footer') %>
```

- [ ] **Step 3: Add `syncStickyBar()` and `handleStickyBarClick()`**

In the `<script>` block, add these two functions right after `updateCtaState()` (the function Task 3 defines):

```js
// Mirrors whichever mode is active (rent or buy) into the fixed bottom bar.
// Kept independent from updateCtaState()/updateBuyPriceHeader() because its
// button copy is shorter ("Message us" vs "📘 Message Us on Facebook") and
// it has to represent both modes, not just rent.
function syncStickyBar() {
  const kEl = document.getElementById('gdSbKicker');
  const aEl = document.getElementById('gdSbAmount');
  const bEl = document.getElementById('gdSbBtn');
  if (!kEl) return;

  if (currentMode === 'buy') {
    if (!selectedBuyType) {
      const amtEl = document.getElementById('phAmount');
      kEl.textContent = 'From';
      aEl.textContent = '₱' + (amtEl ? amtEl.dataset.defaultAmount : '0');
      bEl.textContent = 'Pick a type';
      bEl.classList.add('gd-cta-wait');
    } else {
      const typeName = selectedBuyType === 'tr' ? 'Trophy · permanent' : 'Non-trophy · permanent';
      kEl.textContent = typeName;
      aEl.textContent = '₱' + BUY_PRICES[selectedBuyType];
      bEl.textContent = 'Message us';
      bEl.classList.remove('gd-cta-wait');
    }
    return;
  }

  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (selectedType && !hasSlot) {
    kEl.textContent = 'No slot right now';
    const amtEl = document.getElementById('phAmount');
    aEl.textContent = '₱' + (amtEl ? amtEl.dataset.defaultAmount : '0');
    bEl.textContent = 'Reserve a slot';
    bEl.classList.remove('gd-cta-wait');
    return;
  }
  if (!selectedType) {
    const amtEl = document.getElementById('phAmount');
    kEl.textContent = 'From';
    aEl.textContent = '₱' + (amtEl ? amtEl.dataset.defaultAmount : '0');
    bEl.textContent = 'Pick a type';
    bEl.classList.add('gd-cta-wait');
  } else if (!selectedDays) {
    kEl.textContent = 'Pick a duration';
    aEl.textContent = '';
    bEl.textContent = 'Pick a duration';
    bEl.classList.add('gd-cta-wait');
  } else {
    const base = PRICES[selectedType][selectedDays];
    const pct = promoPctFor(selectedDays);
    const discount = pct > 0 ? Math.round(base * pct / 100) : 0;
    const deposit = (selectedType === 'tr' || selectedType === 'ps4') ? PROMO.deposit : 0;
    kEl.textContent = 'Total';
    aEl.textContent = '₱' + (base - discount + deposit);
    bEl.textContent = 'Message us';
    bEl.classList.remove('gd-cta-wait');
  }
}

function handleStickyBarClick() {
  if (currentMode === 'buy') {
    if (!selectedBuyType) {
      document.getElementById('buyNtCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    document.getElementById('buyCtaBtn')?.click();
    return;
  }
  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (selectedType && !hasSlot) {
    document.getElementById('reserveSection')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!selectedType || !selectedDays) {
    const target = !selectedType ? document.getElementById('typeOptions') : document.getElementById('durationGrid');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightDurationGrid();
    return;
  }
  document.getElementById('ctaBtn')?.click();
}
```

- [ ] **Step 4: Wire `syncStickyBar()` into every state-change function**

Add a `syncStickyBar();` call at the end of each of these four functions (they already exist from Tasks 1 and 3 — this step only adds one line to each, at the very end of the function body, before the closing `}`):

- `onTypeChange(radio)` (Task 3) — after `updateCtaState();`
- `onDurChange(btn)` (Task 3) — after `updateCtaState();`
- `selectBuyType(type)` (Task 1) — after `updateBuyPriceHeader();`
- `setMode(mode)` (Task 1) — after the `if (isRent) { updateTotal(); } else { updateBuyPriceHeader(); }` line

- [ ] **Step 5: Call `syncStickyBar()` once on initial load**

Find the `DOMContentLoaded` handler (lines 569-582):

```js
window.addEventListener('DOMContentLoaded', () => {
  const preferred = (AVAIL.tr ? document.querySelector('input[name="rentalType"][value="tr"]') : null)
    || (AVAIL.nt ? document.querySelector('input[name="rentalType"][value="nt"]') : null)
    || (AVAIL.ps4 ? document.querySelector('input[name="rentalType"][value="ps4"]') : null)
    || document.querySelector('input[name="rentalType"]');
  if (preferred) { preferred.checked = true; onTypeChange(preferred); }
  updateReserveLinks();
  // Auto-switch to buy tab if ?mode=buy
  if (new URLSearchParams(window.location.search).get('mode') === 'buy') {
    const buyBtn = document.getElementById('toggleBuy');
    if (buyBtn) setMode('buy');
  }
});
```

`onTypeChange(preferred)` already calls `syncStickyBar()` per Step 4, and `setMode('buy')` already calls it too — so the only gap is the case where `preferred` is falsy (no rentable type exists at all, i.e. `allUnavail` is true, in which case `typeOptions` isn't even rendered per the existing `<% if (allUnavail) %>` branch elsewhere in the file). Add a fallback call so the bar isn't left with its raw SSR "From" text in every case:

```js
window.addEventListener('DOMContentLoaded', () => {
  const preferred = (AVAIL.tr ? document.querySelector('input[name="rentalType"][value="tr"]') : null)
    || (AVAIL.nt ? document.querySelector('input[name="rentalType"][value="nt"]') : null)
    || (AVAIL.ps4 ? document.querySelector('input[name="rentalType"][value="ps4"]') : null)
    || document.querySelector('input[name="rentalType"]');
  if (preferred) { preferred.checked = true; onTypeChange(preferred); }
  else { syncStickyBar(); }
  updateReserveLinks();
  // Auto-switch to buy tab if ?mode=buy
  if (new URLSearchParams(window.location.search).get('mode') === 'buy') {
    const buyBtn = document.getElementById('toggleBuy');
    if (buyBtn) setMode('buy');
  }
});
```

- [ ] **Step 6: Add CSS for the sticky bar, the FAB override, and bottom padding**

In `public/css/style.css`, find the existing mobile breakpoint block that shows `.mobile-fab` (around line 297):

```css
@media (max-width: 820px) {
  .nav-links { display: none; }
  .nav-hamburger { display: flex; }
  .mobile-fab { display: flex; }
  .navicons .nav-cta, .navicons .navicon-btn[href="/admin"] { display: none; }
```

Do not modify this block. Instead, add a new rule block anywhere after it in file order (specificity, not source order, decides the override — two classes beats one):

```css
.gd-sticky-bar { display: none; }
@media (max-width: 820px) {
  .gd-page-booking-v2.gd-page-booking-v2 .mobile-fab { display: none; }
  .gd-page-booking-v2 { padding-bottom: 78px; }
  .gd-sticky-bar {
    display: flex; align-items: center; gap: 0.85rem;
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 145;
    background: rgba(10,10,12,0.97); backdrop-filter: blur(12px);
    border-top: 1px solid #222; padding: 0.7rem 0.9rem;
  }
  .gd-sb-info { flex: 1; min-width: 0; }
  .gd-sb-kicker { font-size: 0.65rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #555; }
  .gd-sb-amount { font-size: 1.05rem; font-weight: 900; color: var(--ps-blue); line-height: 1.25; }
  .gd-sb-btn {
    background: var(--ps-blue); color: #fff; border: 0; border-radius: 10px;
    padding: 0.7rem 0.95rem; font-weight: 800; font-size: 0.85rem; white-space: nowrap;
    cursor: pointer; font-family: inherit;
  }
  .gd-sb-btn.gd-cta-wait { background: #1a1a1a; color: #666; }
}
```

`.gd-page-booking-v2.gd-page-booking-v2 .mobile-fab` repeats the class deliberately — a doubled single-class selector has specificity (0,2,0), which beats the existing `.mobile-fab { display:flex }` rule's (0,1,0) inside the same media query regardless of source order, without needing `!important`.

- [ ] **Step 7: Verify EJS tag balance and CSS brace balance**

Same checks as prior tasks.

- [ ] **Step 8: Commit**

```bash
git add views/game-detail.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Add mobile sticky booking bar, hide floating Messenger button on this page

A fixed bottom bar (<=820px only) mirrors the running total and CTA
state from both rent and buy modes, so the action is reachable at any
scroll position. The site-wide floating Messenger bubble is hidden on
this page specifically, since the sticky bar's button is a strictly
more useful version of the same action here.
EOF
)"
```

---

### Task 5: Deploy and verify live

**Files:** none (deploy + verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-4.

- [ ] **Step 1: Push to trigger the Railway deploy**

```bash
git push origin main
```

- [ ] **Step 2: Wait for the deploy**

Run: `until curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/ | grep -q 200; do sleep 5; done; echo done`

- [ ] **Step 3: Verify the price header, compact rows, and order summary on desktop**

Use the Browser tool at 1280px width. Navigate to a live game detail page (pick any slug from `curl -s https://playstation-hub.com/feed/meta-catalog.csv`). Confirm:
- A price header reads "From ₱X" before any selection, matching the cheapest price visible in the duration/type combinations below it.
- Each account-type row is a single compact line; clicking a chevron reveals the setup text without selecting that type; clicking the row itself selects it and does not toggle the setup panel open.
- The order summary box is visible immediately (not appearing/disappearing), showing a hint line until both a type and duration are picked, then showing the exact breakdown with no layout jump.
- The CTA button's text changes through "Pick an account type" → "Pick a duration" → "📘 Message Us on Facebook" as selections are made.

- [ ] **Step 4: Verify the mobile sticky bar**

Use the Browser tool's `resize_window` to the mobile preset (375×812). Reload the same game page. Confirm:
- A fixed bar sits at the bottom of the viewport showing "From ₱X" and a "Pick a type" button.
- The site's floating Messenger bubble (bottom-right circular button, present on other pages) is NOT visible on this page.
- Scrolling the page keeps the bar fixed in place.
- Selecting a type and duration updates the bar's total and button text to "Message us".
- Tapping the bar's button before making both selections scrolls to and shakes the relevant section instead of doing nothing.

- [ ] **Step 5: Verify Buy Permanent mode**

On the same page (mobile or desktop), switch to the "Buy Permanent" tab (only present on games with a buy price — check `buyNtFinal`/`buyTrFinal` in the feed, or use `?mode=buy` in the URL). Confirm the price header and sticky bar (mobile) both switch to buy pricing, and selecting Non-Trophy or Trophy updates both to the correct one-time price.

- [ ] **Step 6: Verify a no-slot game is unaffected**

Find a game in the feed where every type shows `out of stock`, or a game whose types all show "Full Slot" on its detail page. Confirm the reserve/queue cards still render and work as before, and that the sticky bar's button reads "Reserve a slot" and scrolls to that section.

- [ ] **Step 7: Report results to the user**

Summarize what was verified in Steps 3-6, with a screenshot of both the desktop and mobile views, and flag anything that didn't match expectations before considering this plan complete.
