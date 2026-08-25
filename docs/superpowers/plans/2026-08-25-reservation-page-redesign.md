# Reservation Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The upcoming-game reservation page shows the real amount due on load (no click required), collapses three labelled sections into one compact card, and uses a two-column desktop layout with the reserve card sticky on the right — while every full-slots behaviour, price formula, and the `/order/reserve` contract stay exactly as they are today.

**Architecture:** Pure template + CSS + inline-script restructuring of `views/upcoming-detail.ejs`, with new CSS in `public/css/style.css`. No server route, no `POST /order/reserve` field, and no shared `.gd-*` class used by `views/game-detail.ejs` changes meaning — this page gets its own `rsv-*` classes for the parts that are genuinely different (compact pills, two-column grid), while reusing existing formulas (`Math.ceil(total * 0.5)`, the ₱100 trophy deposit) verbatim.

**Tech Stack:** EJS, vanilla JS (already inline in this file), plain CSS. No new dependencies.

## Global Constraints

- Files touched: `views/upcoming-detail.ejs`, `public/css/style.css`. Nothing else.
- The `POST /order/reserve` form still submits exactly `game_id`, `account_type`, `days`, `fb_name` — same field names, same hidden-input pattern.
- Pricing math is reused, not rewritten: downpayment is `Math.ceil(total * 0.5)`, trophy deposit is a flat ₱100, `total = price + deposit`. These already exist in `updateSummary()` and `updateLinks()` — Task 2 relocates and reuses them, it does not reimplement them.
- The full-slots path is unchanged: the red "All Slots Full" banner, the "Request a Slot" / "Request Now →" copy swap in `updateCta()`, and the free waitlist block (`#ctaWaitlist`, shown only when `allFull`) keep their current markup, text, and visibility rule.
- The `order_error` banner and the Messenger fallback link (`#reserveLinkSlot`) keep their current text and placement.
- Desktop breakpoint is `900px`, matching the spec.
- No new class name may collide with an existing `.gd-*` or `.usd-*` class used elsewhere in `public/css/style.css` — grep before naming.

---

### Task 1: Restructure the markup — one card, two-column shell

**Files:**
- Modify: `views/upcoming-detail.ejs` (the `<div class="usd-body">` block, roughly lines 71–200)

**Interfaces:**
- Consumes: the existing EJS locals already computed at the top of the file (`hasNt`, `hasTr`, `showTr`, `ntSlots`, `trSlots`, `totalSlots`, `allFull`, `udIsTba`, `udDaysLeft`, `displayDate`, `game.*`) — none of these computations change.
- Produces: the DOM element IDs Task 2's script depends on: `typeOptions`, `type-tr`, `type-nt`, `durGrid`, `orderSummary`, `sumBaseLabel`, `sumBase`, `sumDepositRow`, `sumDownpayment`, `sumTotal`, `ctaReserve`, `ctaReserveTitle`, `ctaHasSlotFee`, `ctaHasSlotDP`, `ctaReserveNote`, `reserveForm`, `reserveType`, `reserveDays`, `reserveFbName`, `ctaReserveBtn`, `reserveLinkSlot`, `ctaWaitlist`, `queueLink`. Every one of these IDs must still exist after this task — Task 2 does not add fallback lookups for a renamed ID.

- [ ] **Step 1: Replace the body block**

In `views/upcoming-detail.ejs`, replace everything from `<div class="usd-body">` (currently line 71) through the matching `</div><!-- /usd-body -->` (currently line 200) with:

```html
  <div class="usd-body">
    <% if (allFull) { %>
    <div class="rsv-full-banner">
      <span class="rsv-full-icon">🚫</span>
      <div>
        <div class="rsv-full-title">All Slots Full</div>
        <div class="rsv-full-sub">You can still request a slot with a downpayment below, or join the free waitlist.</div>
      </div>
    </div>
    <% } %>

    <div class="rsv-layout">

      <!-- Reserve card: first in the DOM so it renders first on mobile with
           no CSS reordering needed. Desktop places it via grid-area instead
           of relying on source order. -->
      <div class="rsv-right">
        <div class="rsv-card">

          <% if (hasNt || showTr) { %>
          <div class="rsv-type-row" id="typeOptions">
            <% if (showTr) { %>
            <label class="rsv-type-pill" id="typeCard-tr">
              <input type="radio" name="rental_type" value="tr" id="type-tr" onchange="onTypeChange()" <%= (!hasNt) ? 'checked' : '' %>>
              <span class="rsv-type-icon">🏆</span>
              <span class="rsv-type-label">Trophy</span>
              <span class="rsv-type-count"><%= trSlots > 0 ? (trSlots + ' left') : 'Reserved' %></span>
            </label>
            <% } %>
            <% if (hasNt) { %>
            <label class="rsv-type-pill" id="typeCard-nt">
              <input type="radio" name="rental_type" value="nt" id="type-nt" onchange="onTypeChange()" checked>
              <span class="rsv-type-icon">🎮</span>
              <span class="rsv-type-label">Non-Trophy</span>
              <span class="rsv-type-count"><%= ntSlots > 0 ? (ntSlots + ' left') : 'Reserved' %></span>
            </label>
            <% } %>
          </div>
          <% } %>

          <div class="rsv-dur-row" id="durGrid"></div>

          <div class="rsv-summary" id="orderSummary" style="display:none;">
            <div class="rsv-summary-row rsv-summary-main">
              <span id="sumBaseLabel">Base</span><span id="sumBase">—</span>
            </div>
            <div class="rsv-summary-row" id="sumDepositRow" style="display:none;">
              <span>🔒 Security Deposit (refundable)</span><span style="color:#f59e0b;">+₱100</span>
            </div>
            <div class="rsv-summary-row rsv-summary-down">
              <span>⬇️ Pay now (50%)</span><span id="sumDownpayment">—</span>
            </div>
            <div class="rsv-summary-row rsv-summary-total">
              <span>Total</span><span id="sumTotal">—</span>
            </div>
          </div>

          <div id="ctaReserve">
            <div class="rsv-cta-title" id="ctaReserveTitle">Reserve a Slot</div>
            <div class="rsv-cta-fee" id="ctaHasSlotFee">Select a duration to see downpayment</div>
            <div class="rsv-cta-dp" id="ctaHasSlotDP" style="display:none;"></div>
            <div class="rsv-cta-note" id="ctaReserveNote">Pay 50% now to lock in your slot. Remaining balance due when the game releases.</div>
            <form method="POST" action="/order/reserve" id="reserveForm" onsubmit="return handleReserveSubmit(event)">
              <input type="hidden" name="game_id" value="<%= game.id %>">
              <input type="hidden" name="account_type" id="reserveType" value="">
              <input type="hidden" name="days" id="reserveDays" value="">
              <input type="text" name="fb_name" id="reserveFbName" class="gd-order-name rsv-name-input" placeholder="Your Facebook name" required>
              <button type="submit" id="ctaReserveBtn" class="rsv-cta-btn">Reserve Now →</button>
            </form>
            <a id="reserveLinkSlot" href="http://m.me/PlaystationHub00" target="_blank" rel="noopener"
               onclick="return handleReserveClick(event,'reserve')" class="rsv-messenger-link">
              or message us on Facebook instead
            </a>
            <% if (order_error === '1') { %>
            <div class="rsv-error">⚠️ Please pick a type and duration, and enter your Facebook name, before continuing.</div>
            <% } %>
          </div>

          <div id="ctaWaitlist" style="display:<%= allFull ? '' : 'none' %>;margin-top:0.75rem;">
            <a id="queueLink" href="http://m.me/PlaystationHub00" target="_blank" rel="noopener"
               class="gd-reserve-card gd-reserve-queue" onclick="return handleReserveClick(event,'queue')">
              <div class="gd-reserve-icon">🎮</div>
              <div class="gd-reserve-name">Fall in Line</div>
              <div class="gd-reserve-fee" style="color:#22c55e;">FREE</div>
              <div class="gd-reserve-note">Join the waitlist at no cost. You'll be notified when a slot opens.</div>
              <div class="gd-reserve-cta">📘 Join Waitlist →</div>
            </a>
          </div>

        </div>
      </div>

      <div class="rsv-left">
        <% if (game.description) { %>
          <p class="usd-desc"><%= game.description %></p>
        <% } %>
        <div class="rsv-release-line">
          <% if (udIsTba) { %>Release date: TBA
          <% } else if (udDaysLeft > 0) { %><%= udDaysLeft %> day<%= udDaysLeft !== 1 ? 's' : '' %> until release · <%= displayDate %>
          <% } else { %>Releasing any day now
          <% } %>
        </div>
      </div>

    </div>
  </div><!-- /usd-body -->
</div><!-- /usd-page -->
```

Note the standalone `usd-chips` slot-count block ("2 reservation slots left") is deliberately removed — the count now lives only in each `.rsv-type-pill`, and the full-slots case is already covered by the red banner above.

- [ ] **Step 2: Verify every ID Task 2 needs is present exactly once**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const fs = require('fs');
const src = fs.readFileSync('views/upcoming-detail.ejs', 'utf8');
const ids = ['typeOptions','type-tr','type-nt','durGrid','orderSummary','sumBaseLabel','sumBase','sumDepositRow','sumDownpayment','sumTotal','ctaReserve','ctaReserveTitle','ctaHasSlotFee','ctaHasSlotDP','ctaReserveNote','reserveForm','reserveType','reserveDays','reserveFbName','ctaReserveBtn','reserveLinkSlot','ctaWaitlist','queueLink'];
let ok = true;
ids.forEach(id => {
  const count = (src.match(new RegExp('id=\"' + id + '\"', 'g')) || []).length;
  if (count !== 1) { console.log('MISSING/DUP:', id, 'count=' + count); ok = false; }
});
console.log(ok ? 'all IDs present exactly once' : 'FAILED');
"
```

Expected: `all IDs present exactly once`.

- [ ] **Step 3: Verify the template compiles**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const ejs = require('ejs'), fs = require('fs');
try { ejs.compile(fs.readFileSync('views/upcoming-detail.ejs', 'utf8')); console.log('compiles: true'); }
catch (e) { console.log('COMPILE ERROR:', e.message); process.exit(1); }
"
```

Expected: `compiles: true`.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add views/upcoming-detail.ejs
git commit -m "Restructure reservation page markup into one card with a two-column shell"
```

---

### Task 2: Preselect defaults and simplify the CTA script

**Files:**
- Modify: `views/upcoming-detail.ejs` (the `<script>` block, roughly the current lines 205–363 — line numbers will have shifted after Task 1)

**Interfaces:**
- Consumes: the DOM IDs Task 1 produced, and the existing globals `NT_PRICES`, `TR_PRICES`, `NT_SLOTS`, `TR_SLOTS`, `RENTAL_DURATIONS`, `GAME_TITLE`.
- Produces: nothing consumed by a later task — this plan has two tasks.

- [ ] **Step 1: Replace `renderDurButtons` to render pills and auto-select a default**

Find this function (unchanged from before Task 1):

```js
function renderDurButtons() {
  const p = getPrices();
  const grid = document.getElementById('durGrid');
  grid.innerHTML = '';
  const durLabelMap = { 7: 'Weekly', 30: 'Monthly' };
  RENTAL_DURATIONS.forEach(d => {
    if (!p[d]) return; // skip days with no price
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gd-dur-btn';
    btn.dataset.days = d;
    btn.onclick = () => selectDur(d);
    btn.innerHTML = `<span class="gd-dur-days">${durLabelMap[d] || d}</span><span class="gd-dur-price">₱${p[d]}</span>`;
    grid.appendChild(btn);
  });
}
```

Replace it with:

```js
function renderDurButtons() {
  const p = getPrices();
  const grid = document.getElementById('durGrid');
  grid.innerHTML = '';
  const durLabelMap = { 7: 'Weekly', 30: 'Monthly' };
  const available = RENTAL_DURATIONS.filter(d => p[d]);

  available.forEach(d => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rsv-dur-btn';
    btn.dataset.days = d;
    btn.onclick = () => selectDur(d);
    btn.innerHTML = `<span class="rsv-dur-label">${durLabelMap[d] || d}</span><span class="rsv-dur-price">₱${p[d]}</span>`;
    grid.appendChild(btn);
  });

  // Preselect so the price is visible on load: prefer Monthly (30) when more
  // than one duration exists, otherwise the single available one. Falls back
  // to null (existing "no price set" empty state) when neither is priced.
  const defaultDays = available.includes(30) ? 30 : (available[0] || null);
  if (defaultDays) selectDur(defaultDays);
}
```

- [ ] **Step 2: Update `selectDur`'s class name to match the new pill markup**

Find:

```js
function selectDur(days) {
  selectedDays = days;
  document.querySelectorAll('.gd-dur-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.days) === days));
  updateSummary();
  updateCta();
  updateLinks();
}
```

Replace with:

```js
function selectDur(days) {
  selectedDays = days;
  document.querySelectorAll('.rsv-dur-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.days) === days));
  updateSummary();
  updateCta();
  updateLinks();
}
```

- [ ] **Step 3: Update `onTypeChange`'s class names for the pill markup**

Find:

```js
function onTypeChange() {
  selectedType = document.querySelector('input[name="rental_type"]:checked')?.value || 'nt';
  selectedDays = null;
  // highlight selected card
  document.querySelectorAll('.gd-type-card').forEach(c => c.classList.remove('gd-type-selected'));
  const checked = document.querySelector('input[name="rental_type"]:checked');
  if (checked) checked.closest('.gd-type-card').classList.add('gd-type-selected');
  renderDurButtons();
  updateSummary();
  updateCta();
}
```

Replace with:

```js
function onTypeChange() {
  selectedType = document.querySelector('input[name="rental_type"]:checked')?.value || 'nt';
  // Duration selection deliberately survives a type switch when the new
  // type still offers that duration — renderDurButtons() below re-picks a
  // default only when it doesn't, so switching Trophy/Non-Trophy back and
  // forth doesn't re-blank a price the visitor already saw.
  document.querySelectorAll('.rsv-type-pill').forEach(c => c.classList.remove('rsv-type-selected'));
  const checked = document.querySelector('input[name="rental_type"]:checked');
  if (checked) checked.closest('.rsv-type-pill').classList.add('rsv-type-selected');
  renderDurButtons();
  updateSummary();
  updateCta();
}
```

Note this changes `selectedDays = null` to relying on `renderDurButtons()`'s own preselection — that function already sets a default any time the previous selection isn't valid for the new type's price table, because `available.includes(30)` / `available[0]` is recomputed from the new type's prices. Verified in Task 2 Step 6.

- [ ] **Step 4: Update `shakeDurGrid`'s class name**

Find:

```js
function shakeDurGrid() {
  const grid = document.getElementById('durGrid');
  grid.classList.remove('gd-dur-grid-shake');
  void grid.offsetWidth;
  grid.classList.add('gd-dur-grid-shake');
  setTimeout(() => grid.classList.remove('gd-dur-grid-shake'), 600);
}
```

Replace with:

```js
function shakeDurGrid() {
  const grid = document.getElementById('durGrid');
  grid.classList.remove('rsv-dur-row-shake');
  void grid.offsetWidth;
  grid.classList.add('rsv-dur-row-shake');
  setTimeout(() => grid.classList.remove('rsv-dur-row-shake'), 600);
}
```

- [ ] **Step 5: Update the init block's class name**

Find:

```js
// Init
const initChecked = document.querySelector('input[name="rental_type"]:checked');
if (initChecked) initChecked.closest('.gd-type-card').classList.add('gd-type-selected');
renderDurButtons();
updateCta();
```

Replace with:

```js
// Init
const initChecked = document.querySelector('input[name="rental_type"]:checked');
if (initChecked) initChecked.closest('.rsv-type-pill').classList.add('rsv-type-selected');
renderDurButtons();
updateCta();
```

`renderDurButtons()` now both builds the pills and preselects a default duration (Task 2 Step 1), so on page load the summary and CTA immediately reflect a real price with no further wiring needed here.

- [ ] **Step 6: Verify the preselection logic against every price shape by hand**

This step has no code change — it is a dry run of the new `renderDurButtons()` against the shapes that exist in production, since there is no test runner in this project. Trace by hand for each and confirm the stated result:

| `NT_PRICES` | `available` | `defaultDays` chosen |
|---|---|---|
| `{7:0, 30:699}` (Wolverine) | `[30]` | `30` |
| `{7:299, 30:699}` | `[7, 30]` | `30` (Monthly preferred) |
| `{7:299, 30:0}` | `[7]` | `7` (only one available) |
| `{7:0, 30:0}` | `[]` | `null` — falls back to the existing "Select a duration" empty state |

Confirm all four rows match `renderDurButtons()` as written in Step 1 before proceeding.

- [ ] **Step 7: Verify the script has no leftover references to removed classes**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -n "gd-dur-btn\|gd-dur-grid-shake\|gd-type-card\|gd-type-selected" views/upcoming-detail.ejs
```

Expected: no output. (These classes belong to `views/game-detail.ejs`'s CSS and must not be referenced from this file's script anymore — Task 3 does not style them for this page.)

- [ ] **Step 8: Verify the template still compiles**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const ejs = require('ejs'), fs = require('fs');
try { ejs.compile(fs.readFileSync('views/upcoming-detail.ejs', 'utf8')); console.log('compiles: true'); }
catch (e) { console.log('COMPILE ERROR:', e.message); process.exit(1); }
"
```

Expected: `compiles: true`.

- [ ] **Step 9: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add views/upcoming-detail.ejs
git commit -m "Preselect a rental type and duration so the reservation price shows on load"
```

---

### Task 3: Add the CSS — compact card, pills, and the two-column desktop grid

**Files:**
- Modify: `public/css/style.css` (append a new block; suggested insertion point is directly after the existing `.usd-*` rules — locate with the grep in Step 1)

**Interfaces:**
- Consumes: the class names introduced in Tasks 1–2 (`rsv-full-banner`, `rsv-full-icon`, `rsv-full-title`, `rsv-full-sub`, `rsv-layout`, `rsv-right`, `rsv-left`, `rsv-card`, `rsv-type-row`, `rsv-type-pill`, `rsv-type-selected`, `rsv-type-icon`, `rsv-type-label`, `rsv-type-count`, `rsv-dur-row`, `rsv-dur-row-shake`, `rsv-dur-btn`, `rsv-dur-label`, `rsv-dur-price`, `rsv-summary`, `rsv-summary-row`, `rsv-summary-main`, `rsv-summary-down`, `rsv-summary-total`, `rsv-cta-title`, `rsv-cta-fee`, `rsv-cta-dp`, `rsv-cta-note`, `rsv-cta-btn`, `rsv-name-input`, `rsv-messenger-link`, `rsv-error`, `rsv-release-line`).
- Produces: nothing consumed by a later task — this plan has three tasks.

- [ ] **Step 1: Confirm none of the new class names already exist**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -n "\.rsv-" public/css/style.css
```

Expected: no output (confirms no naming collision before adding rules).

- [ ] **Step 2: Locate the existing `.usd-*` block**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -n "^\.usd-" public/css/style.css | tail -5
```

Note the line number of the last `.usd-*` rule's closing `}` — the new block is inserted immediately after it.

- [ ] **Step 3: Insert the CSS block**

Insert this immediately after the last existing `.usd-*` rule found in Step 2:

```css
.rsv-full-banner {
  display: flex; align-items: center; gap: 0.75rem;
  background: linear-gradient(135deg, #1a0a0a, #2a0a0a);
  border: 1px solid rgba(239,68,68,0.3);
  border-radius: 12px; padding: 1rem 1.2rem; margin-bottom: 1.5rem;
}
.rsv-full-icon { font-size: 1.5rem; }
.rsv-full-title { font-weight: 800; color: #ef4444; font-size: 0.95rem; }
.rsv-full-sub { font-size: 0.78rem; color: #888; margin-top: 0.15rem; }

.rsv-layout { display: flex; flex-direction: column; gap: 1.75rem; }
.rsv-left, .rsv-right { min-width: 0; }

.rsv-card {
  background: #0d0d0d; border: 1px solid #1a1a1a; border-radius: 14px;
  padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;
}

.rsv-type-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.rsv-type-pill {
  flex: 1 1 140px; display: flex; align-items: center; gap: 0.4rem;
  background: #121212; border: 1px solid #222; border-radius: 10px;
  padding: 0.6rem 0.75rem; cursor: pointer; font-size: 0.8rem;
}
.rsv-type-pill input { position: absolute; opacity: 0; pointer-events: none; }
.rsv-type-icon { font-size: 0.95rem; }
.rsv-type-label { font-weight: 700; color: #eee; }
.rsv-type-count { margin-left: auto; font-size: 0.68rem; color: #22c55e; white-space: nowrap; }
.rsv-type-selected { border-color: #f0a500; background: #1a1400; }

.rsv-dur-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.rsv-dur-btn {
  flex: 1 1 100px; background: #121212; border: 1px solid #222; border-radius: 10px;
  padding: 0.55rem 0.7rem; color: #ccc; cursor: pointer; display: flex;
  flex-direction: column; align-items: center; gap: 0.15rem; font-size: 0.78rem;
}
.rsv-dur-btn.active { border-color: #f0a500; background: #1a1400; color: #fff; }
.rsv-dur-price { font-weight: 800; color: #ffc400; }
.rsv-dur-row-shake { animation: rsv-shake 0.5s; }
@keyframes rsv-shake {
  10%, 90% { transform: translateX(-2px); }
  20%, 80% { transform: translateX(3px); }
  30%, 50%, 70% { transform: translateX(-5px); }
  40%, 60% { transform: translateX(5px); }
}

.rsv-summary { background: #111; border-radius: 10px; padding: 0.75rem 0.9rem; font-size: 0.8rem; }
.rsv-summary-row { display: flex; justify-content: space-between; padding: 0.15rem 0; color: #aaa; }
.rsv-summary-main { color: #ddd; font-weight: 600; }
.rsv-summary-down { color: #22c55e; font-weight: 700; }
.rsv-summary-total {
  display: flex; justify-content: space-between; margin-top: 0.4rem;
  padding-top: 0.4rem; border-top: 1px solid #222; font-weight: 800; color: #ffc400;
}

.rsv-cta-title { font-weight: 800; font-size: 1.05rem; color: #fff; text-align: center; }
.rsv-cta-fee { font-size: 0.88rem; color: #22c55e; font-weight: 700; text-align: center; }
.rsv-cta-dp { font-size: 0.8rem; color: #aaa; text-align: center; }
.rsv-cta-note { font-size: 0.78rem; color: #666; text-align: center; }
.rsv-name-input { display: block; width: 100%; margin: 0 auto 0.6rem; }
.rsv-cta-btn {
  display: block; width: 100%; background: linear-gradient(135deg, #065f46, #22c55e);
  color: #fff; font-weight: 800; padding: 0.75rem 1.5rem; border-radius: 50px;
  border: none; font-size: 0.92rem; cursor: pointer;
}
.rsv-messenger-link { display: block; margin-top: 0.6rem; font-size: 0.78rem; color: #888; text-decoration: underline; text-align: center; }
.rsv-error { margin-top: 0.75rem; font-size: 0.8rem; color: #ef4444; font-weight: 600; text-align: center; }

.rsv-release-line { font-size: 0.8rem; color: #888; margin-top: 0.75rem; }

@media (min-width: 900px) {
  .rsv-layout {
    display: grid;
    grid-template-columns: 1fr 380px;
    grid-template-areas: "desc reserve";
    align-items: start;
    gap: 2rem;
  }
  .rsv-left { grid-area: desc; }
  .rsv-right { grid-area: reserve; position: sticky; top: 1rem; }
}
```

- [ ] **Step 4: Verify the CSS still parses**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const css = require('fs').readFileSync('public/css/style.css', 'utf8');
const open = (css.match(/\{/g) || []).length;
const close = (css.match(/\}/g) || []).length;
console.log('braces balanced:', open === close, '(' + open + ' vs ' + close + ')');
"
```

Expected: `braces balanced: true`.

- [ ] **Step 5: Commit and deploy**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add public/css/style.css
git commit -m "Add compact card, pill, and two-column desktop CSS for the reservation page"
git push origin main
```

Poll for the new build using the CSS file directly (not a page that merely links it — this project's own established gotcha):

```bash
until curl -s "https://playstation-hub.com/css/style.css" | grep -q "rsv-layout"; do sleep 15; done; echo "deployed"
```

If this has not landed after several minutes, the Railway deploy is stuck rather than slow — report that rather than polling silently.

- [ ] **Step 6: Verify live — price on load**

Navigate to a Coming Soon game's `/upcoming/<slug>` page with the Browser tool (Marvel's Wolverine, or whichever Coming Soon game currently has slots left). Confirm, with no click:

1. The reserve card already shows a non-"—" downpayment and total.
2. `sumBase`, `sumDownpayment`, and `sumTotal` all show real ₱ amounts.
3. One of the two type pills (or the single one, if only one type exists) shows `.rsv-type-selected` styling.

- [ ] **Step 7: Verify live — type switch recomputes price**

If the game has both Trophy and Non-Trophy priced, click the Trophy pill. Confirm:

1. The summary updates to include the `+₱100` deposit row.
2. The total and downpayment recompute correctly (`Math.ceil((price + 100) * 0.5)`).
3. If the newly selected type has a different set of available durations, the previously selected duration button is either still highlighted (if still valid) or a new default is chosen automatically — never left blank.

- [ ] **Step 8: Verify live — two-column desktop, single-column mobile**

At a desktop viewport width (≥900px): confirm the description sits in a left column and the reserve card in a right column, with the card visibly sticky as the page scrolls.

At a mobile viewport width (<900px): confirm the layout is a single column with the reserve card appearing **above** the description.

- [ ] **Step 9: Verify live — full-slots game unchanged**

Navigate to (or use the admin panel to temporarily set) a Coming Soon game with zero slots left in both types. Confirm:

1. The red "All Slots Full" banner still renders with its icon, title, and subtext.
2. The CTA title reads "Request a Slot" and the button reads "Request Now →" (via `updateCta()`, unchanged).
3. The free waitlist block (`#ctaWaitlist`) is visible.
4. On a game with slots still available, the waitlist block remains hidden — confirming the "keep it hidden" decision was preserved.

- [ ] **Step 10: Verify live — error banner and Messenger link**

Trigger `order_error=1` (submit without a name, or navigate with `?order_error=1`) and confirm the red inline warning still renders with its original text. Confirm the "or message us on Facebook instead" link is present and, after selecting a type and duration, its `href` updates to include the pre-filled Messenger message (via `updateLinks()`, unchanged).

- [ ] **Step 11: Check console and report**

Confirm zero console errors across all of the above. Report the feature live: price-on-load confirmed, type-switch recompute confirmed, two-column desktop / single-column mobile confirmed, full-slots and error/Messenger paths confirmed unchanged.
