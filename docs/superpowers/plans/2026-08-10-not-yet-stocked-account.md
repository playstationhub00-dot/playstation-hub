# Not-Yet-Stocked Account Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the game detail page, tell customers when a rental type's account hasn't been created yet (it gets created after the first booking), instead of showing a plain "Available" pill that implies the account is ready now.

**Architecture:** Pure view-layer change to `views/game-detail.ejs`. Three new `<% %>` booleans (`trNotStocked`, `ntNotStocked`, `ps4NotStocked`) computed from data already available in the route (`game.renters`, `hasTrophyAcc`, `hasNtAcc`, `hasPs4Acc`), one new amber banner rendered when any is true, and a per-row pill/note override applied only to rows whose boolean is true. No server.js or data-model changes — every input already exists.

**Tech Stack:** Express.js + EJS server-rendered views, no test framework (this project's established convention) — verification is EJS tag-balance greps, `node -c server.js`, and live smoke-testing on Railway after deploy.

## Global Constraints

- Detection: a rental type is not-yet-stocked when `game.renters === 0` (or falsy/undefined) **AND** its account flag is false (`!hasTrophyAcc` / `!hasNtAcc` / `!hasPs4Acc`). Both conditions required — checked independently per type.
- Scope is `views/game-detail.ejs` only. Do not touch `views/partials/game-card.ejs`, `views/index.ejs`, `server.js`, or `lib/availability.js` — the account flags and `renters` field already exist and need no new computation.
- Banner copy (verbatim): title `Be the first to rent this`, body `Nobody has rented this yet, so the account isn't made. Book it and we'll have it ready within a few hours — same day.`
- Per-row pill text (verbatim, replaces "Available" only for not-yet-stocked rows): `Set up on order`
- Per-row note (verbatim, only on not-yet-stocked rows): `Not stocked yet — we create the account after you book. Ready the same day.`
- The banner and the existing red `allUnavail` "No Slots Available Right Now" banner are independent — both can render if both conditions are true; do not add mutual-exclusion logic between them.
- A row whose type already has a real account, or has been rented before, is completely unaffected — same "Available"/"Full Slot" pill, no note, as today.
- EJS tag-balance (`<%` count == `%>` count) must hold for `views/game-detail.ejs` after every change.
- `node -c server.js` must exit 0 (sanity check only — this plan doesn't touch server.js, but verifies nothing else broke).
- No local dev server exists; live verification happens against https://playstation-hub.com after `git push` (Railway auto-deploys, ~60-90s).

---

### Task 1: Not-yet-stocked banner and per-row overrides

**Files:**
- Modify: `views/game-detail.ejs:15-25` (availability computation block) and the three rental-type rows (Trophy ~line 175-198, Non-Trophy ~line 200-221, PS4 Primary ~line 223-245)
- Modify: `public/css/style.css` (append banner + pill + note styles)

**Interfaces:**
- Consumes: `game.renters`, `hasTrophyAcc`, `hasNtAcc`, `hasPs4Acc`, `hasTrophy`, `showPs4` — all already destructured from `computeAvailability(game, sum)` in the existing `<% %>` block at the top of the file.
- Produces: nothing consumed by a later task — this is the only task in this plan.

- [ ] **Step 1: Add the three detection booleans**

In `views/game-detail.ejs`, find this existing block (currently lines 15-25):

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
```

Add these three lines immediately after `const trNext = availability.trNext, ntNext = availability.ntNext, ps4Next = availability.ps4Next;` (keep everything else in the block unchanged, including the `buyNt`/`buyTr` lines that follow):

```ejs
  // Not-yet-stocked: this game has never been rented AND no real account is linked
  // for this specific type — the account only gets created after the first booking.
  // Both conditions are required (renters===0 alone would misfire on a game that was
  // pre-stocked with a real account before ever being rented).
  const neverRented = !game.renters;
  const trNotStocked = neverRented && !hasTrophyAcc;
  const ntNotStocked = neverRented && !hasNtAcc;
  const ps4NotStocked = neverRented && !hasPs4Acc;
  const anyNotStocked = trNotStocked || ntNotStocked || ps4NotStocked;
```

- [ ] **Step 2: Add the banner above "SELECT RENTAL TYPE"**

Find this existing line (currently `views/game-detail.ejs:172`):

```ejs
        <div class="gd-section-label" style="margin-top:<%= allUnavail ? '1.25rem' : '0' %>;">SELECT RENTAL TYPE</div>
```

Immediately **before** it, insert:

```ejs
        <% if (anyNotStocked) { %>
        <!-- NOT-YET-STOCKED banner -->
        <div class="gd-notstocked-banner">
          <span class="gd-notstocked-icon">⚡</span>
          <div>
            <div class="gd-notstocked-title">Be the first to rent this</div>
            <div class="gd-notstocked-sub">Nobody has rented this yet, so the account isn't made. Book it and we'll have it ready within a few hours — same day.</div>
          </div>
        </div>
        <% } %>
```

The existing `<div class="gd-section-label" ...>` line stays exactly as it is — its `margin-top` ternary already only reads `allUnavail`, which this task does not touch.

- [ ] **Step 3: Override the Trophy row's pill and add its note**

Find this line inside the Trophy `gd-type-card` block (currently `views/game-detail.ejs:183`):

```ejs
                <span class="gd-type-status <%= trAvail ? 'gd-status-avail' : 'gd-status-rented' %>"><%= trAvail ? 'Available' : 'Full Slot' %></span>
```

Replace it with:

```ejs
                <span class="gd-type-status <%= trNotStocked ? 'gd-status-notstocked' : (trAvail ? 'gd-status-avail' : 'gd-status-rented') %>"><%= trNotStocked ? 'Set up on order' : (trAvail ? 'Available' : 'Full Slot') %></span>
```

Then find the Trophy row's setup-detail paragraph block (currently `views/game-detail.ejs:189-196`):

```ejs
            <div class="gd-type-setup" id="setup-tr" data-open="0">
              <p>✅ Play our games on <strong>YOUR OWN account</strong> and earn trophies on your profile.</p>
              <p style="color:#22c55e;">Setup: Settings → Users and Accounts → Other → Console Sharing and Offline Play → <strong>Enable</strong></p>
              <% const trSoon = trNext != null && trNext > 0 ? trNext : null; %>
              <% if (!trAvail && trSoon != null && trSoon > 0) { %>
              <p class="gd-avail-soon">📅 Next available in <strong><%= trSoon %> day<%= trSoon !== 1 ? 's' : '' %></strong></p>
              <% } %>
            </div>
```

Add this immediately after the `<% } %>` that closes the `gd-avail-soon` conditional, still inside the `gd-type-setup` div:

```ejs
              <% if (trNotStocked) { %>
              <p class="gd-notstocked-note">Not stocked yet — we create the account after you book. Ready the same day.</p>
              <% } %>
```

- [ ] **Step 4: Override the Non-Trophy row's pill and add its note**

Find this line inside the Non-Trophy `gd-type-card` block (currently `views/game-detail.ejs:207`):

```ejs
                <span class="gd-type-status <%= ntAvail ? 'gd-status-avail' : 'gd-status-rented' %>"><%= ntAvail ? 'Available' : 'Full Slot' %></span>
```

Replace it with:

```ejs
                <span class="gd-type-status <%= ntNotStocked ? 'gd-status-notstocked' : (ntAvail ? 'gd-status-avail' : 'gd-status-rented') %>"><%= ntNotStocked ? 'Set up on order' : (ntAvail ? 'Available' : 'Full Slot') %></span>
```

Then find the Non-Trophy row's setup-detail paragraph block (currently `views/game-detail.ejs:213-220`):

```ejs
            <div class="gd-type-setup" id="setup-nt" data-open="0">
              <p>🎮 Play the game on <strong>OUR account</strong> only. Trophies <strong>won't</strong> count on your own profile.</p>
              <p style="color:#888;">Setup: Settings → Users and Accounts → Other → Console Sharing and Offline Play → <strong>leave disabled</strong></p>
              <% const ntSoon = ntNext != null && ntNext > 0 ? ntNext : null; %>
              <% if (!ntAvail && ntSoon != null && ntSoon > 0) { %>
              <p class="gd-avail-soon">📅 Next available in <strong><%= ntSoon %> day<%= ntSoon !== 1 ? 's' : '' %></strong></p>
              <% } %>
            </div>
```

Add this immediately after the `<% } %>` that closes the `gd-avail-soon` conditional, still inside the `gd-type-setup` div:

```ejs
              <% if (ntNotStocked) { %>
              <p class="gd-notstocked-note">Not stocked yet — we create the account after you book. Ready the same day.</p>
              <% } %>
```

- [ ] **Step 5: Override the PS4 Primary row's pill and add its note**

Find this line inside the PS4 Primary `gd-type-card` block (currently `views/game-detail.ejs:231`):

```ejs
                <span class="gd-type-status <%= ps4Avail ? 'gd-status-avail' : 'gd-status-rented' %>"><%= ps4Avail ? 'Available' : 'Full Slot' %></span>
```

Replace it with:

```ejs
                <span class="gd-type-status <%= ps4NotStocked ? 'gd-status-notstocked' : (ps4Avail ? 'gd-status-avail' : 'gd-status-rented') %>"><%= ps4NotStocked ? 'Set up on order' : (ps4Avail ? 'Available' : 'Full Slot') %></span>
```

Then find the PS4 Primary row's setup-detail paragraph block (currently `views/game-detail.ejs:237-243`):

```ejs
            <div class="gd-type-setup" id="setup-ps4" data-open="0">
              <p>🕹️ Set our account as <strong>PS4 primary</strong> — play on your PS4 and earn trophies on your own profile.</p>
              <p style="color:#22c55e;">Setup: Settings → Account Management → Activate as Your Primary PS4 → <strong>Activate</strong></p>
              <% if (!ps4Avail && ps4Next != null && ps4Next > 0) { %>
              <p class="gd-avail-soon">📅 Next available in <strong><%= ps4Next %> day<%= ps4Next !== 1 ? 's' : '' %></strong></p>
              <% } %>
            </div>
```

Add this immediately after the `<% } %>` that closes the `gd-avail-soon` conditional, still inside the `gd-type-setup` div:

```ejs
              <% if (ps4NotStocked) { %>
              <p class="gd-notstocked-note">Not stocked yet — we create the account after you book. Ready the same day.</p>
              <% } %>
```

- [ ] **Step 6: Append the CSS**

In `public/css/style.css`, append at the end of the file:

```css
.gd-notstocked-banner {
  display: flex; align-items: flex-start; gap: 0.75rem;
  background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.22); border-radius: 10px;
  padding: 0.75rem 0.9rem; margin-bottom: 0.9rem;
}
.gd-notstocked-icon { font-size: 1.05rem; line-height: 1; flex-shrink: 0; }
.gd-notstocked-title { font-size: 0.82rem; font-weight: 700; color: #f0a500; margin-bottom: 0.2rem; }
.gd-notstocked-sub { font-size: 0.75rem; color: #8a8a8a; line-height: 1.55; }
.gd-status-notstocked { background: rgba(245,158,11,0.15); color: #f0a500; }
.gd-notstocked-note { margin-top: 0.45rem; font-size: 0.75rem; color: #7a7a7a; line-height: 1.55; }
```

`.gd-status-notstocked` follows the same pattern as the existing `.gd-status-avail`/`.gd-status-rented` rules (`style.css:629-630`) — same `.gd-type-status` base class provides padding/border-radius/font-size, this rule only sets the background/color pair.

- [ ] **Step 7: Verify EJS balance and server.js syntax**

Run: count `<%` occurrences and `%>` occurrences in `views/game-detail.ejs` — must be equal (each `<% if (...) { %> ... <% } %>` pair added in Steps 2-5 contributes one opening and one closing tag each, so the file's balance is preserved by construction, but verify the count directly rather than trusting that reasoning alone).

Run: `node -c server.js` — expect exit 0 (this task doesn't touch server.js, but confirms nothing else broke).

- [ ] **Step 8: Commit**

```bash
git add views/game-detail.ejs public/css/style.css
git commit -F - <<'MSGEOF'
Show a not-yet-stocked notice on never-rented game accounts

Games can be added to the catalog with a manual slot count before an
account actually exists for them — that only happens after the first
booking. The detail page's "Available" pill couldn't distinguish a
real, ready account from one that doesn't exist yet, so a customer
could pay expecting instant access and instead wait for setup with no
warning anywhere on the page.

Adds an amber banner plus a per-row "Set up on order" pill override,
scoped to rental types that are both never-rented and have no linked
account. Game cards, the browse grid, and the order status page are
untouched.
MSGEOF
```

---

### Task 2: Deploy and verify live

**Files:** none (deploy + verification only)

**Interfaces:**
- Consumes: everything from Task 1.

- [ ] **Step 1: Push to trigger the Railway deploy**

```bash
git push origin main
```

- [ ] **Step 2: Wait for the deploy**

Run: `until curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/ | grep -q 200; do sleep 5; done; echo done`

- [ ] **Step 3: Verify the banner and pill on a never-rented game with no linked account**

Open `/game/marvel-tokon-fighting-souls` (or another game currently showing "Available" despite zero renters and no linked account — confirm via `/admin` → Games that `renters` is 0/blank for the chosen game). Confirm:
- The amber "Be the first to rent this" banner renders above "SELECT RENTAL TYPE".
- Every rental type row that has no linked account shows the "Set up on order" pill (not "Available"), amber-colored.
- Expanding that row's setup details (the chevron) shows the "Not stocked yet — we create the account after you book. Ready the same day." note.

- [ ] **Step 4: Verify a normally-stocked game is unaffected**

Open a game detail page for a game that has been rented before (`renters > 0`) or has a real linked account. Confirm no amber banner appears, and every pill still reads "Available"/"Full Slot" exactly as before this change.

- [ ] **Step 5: Verify game cards and browse grid are unaffected**

Open `/browse` and the homepage. Confirm the game card for the never-rented game from Step 3 still shows its normal "Available" pill/slot count (unchanged) — this plan intentionally does not touch the card, only the detail page.

- [ ] **Step 6: Report results to the user**

Summarize what was verified in Steps 3-5, with a screenshot of the live banner and pill, and flag anything that didn't match expectations before considering this plan complete.
