# Admin Panel Reorganisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regroup the admin panel's eight tabs by task (Dashboard, Orders, Games, PS Plus, Customers, Messaging, Site Content, Settings) and extract each into its own partial, per `docs/superpowers/specs/2026-08-22-admin-panel-reorganisation-design.md`.

**Architecture:** `views/admin.ejs` currently contains all eight tab panels inline as one 3,567-line file. Each tab's markup is being extracted to `views/partials/admin/<tab>.ejs` and pulled back in via `<%- include(...) %>`, which inherits the parent's locals automatically — no data plumbing needed. Content moves between tabs by cutting a self-contained accordion block from its old tab's line range and pasting it into the target tab's partial. The client-side tab plumbing (`tabs` array, `msgTabMap`, default tab, legacy-id handling) is rewritten once, in the final phase, after all content has already landed in its new home.

**Tech Stack:** EJS, no new dependencies.

## Global Constraints (verbatim from the spec)

- Eight tabs, same count. Retired tab ids: `announcements`, `visitors`, `security`. New tab ids: `dashboard`, `messaging`, `content`.
- `/admin` opens on `dashboard` by default (was `settings`).
- The Games tab keeps its existing id and label — do not rename it to "Catalogue".
- PS Plus stays a separate tab — do not fold it into Games.
- `mongo-status` and `backfill-images` are NOT dead code and must not be removed — `mongo-status` drives the connection badge in the admin header (`admin.ejs:85`); `backfill-images` is the re-runnable "Optimize All Images Now" button. `backfill-images`'s markup moves to a new Maintenance section in Settings; its route and script are untouched.
- The only deletion in this plan is `/admin/fix-end-dates` — both routes and `views/fix-end-dates.ejs`.
- `LEGACY_TABS = { announcements: 'content', visitors: 'dashboard', security: 'settings' }` must be applied when resolving the initial tab (so an old `localStorage` value or `?tab=` bookmark lands somewhere sensible), and `switchTab` must fall back to `'dashboard'` for any name not in the `tabs` array (so a stale id cannot throw on `.classList` of a `null` element). Both guards must exist before Phase 2 introduces the first retired tab id, per the spec's ordering.
- `month_log_saved` / `month_log_deleted` in `msgTabMap` move to `dashboard` (Month Logs are the Business Dashboard's own script block, not a separate section — confirmed at `admin.ejs:1602-2089`, they share one accordion and one `<script>` tag with the dashboard, there is no separate "Month Logs" markup to relocate).
- `popup_saved`, `signin_step_saved`, `signin_step_deleted`, `announcement` move to `content`.
- `password_changed`, `wrong_password`, `password_mismatch`, `password_too_short` move to `settings`.
- The Sign-In QR Guide's nested-accordion reopen logic (currently `admin.ejs:~3527-3540`, keyed on `msg` starting with `signin_step_`) must move together with the Sign-In QR Guide markup into `content.ejs`'s own init, not stay behind in the shared script.
- Rendered output must be visually and behaviorally identical after Phase 1 (pure extraction, no regrouping yet) — this is the safety checkpoint before any content actually moves.
- `views/partials/order-queue.ejs` does not move and is not touched — it already works and is only included from `admin.ejs`.

---

### Task 1 (Phase 1): Mechanical extraction — all eight tabs into partials, no regrouping

**Files:**
- Create: `views/partials/admin/settings.ejs`, `views/partials/admin/announcements.ejs`, `views/partials/admin/games.ejs`, `views/partials/admin/psplus.ejs`, `views/partials/admin/customers.ejs`, `views/partials/admin/orders.ejs`, `views/partials/admin/visitors.ejs`, `views/partials/admin/security.ejs`
- Modify: `views/admin.ejs` (replace each tab's inline markup with an include; add `LEGACY_TABS` and the `switchTab` guard)

**Interfaces:**
- Consumes: nothing — this task only moves existing markup verbatim.
- Produces: eight working partials at the paths above, each containing exactly one `<div class="tab-panel" id="tab-X">...</div>` block. Later tasks in Phases 2-5 read and further split these files.

This task is pure mechanical extraction. Every tab's *content* is unchanged; only its *location on disk* changes. The line ranges below were measured directly against the current file — verify them yourself with `grep -n 'class="tab-panel"'` before cutting, in case the file has drifted since this plan was written.

- [ ] **Step 1: Extract Settings (lines 108-994)**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
sed -n '108,994p' views/admin.ejs > views/partials/admin/settings.ejs
```

- [ ] **Step 2: Extract Announcements (lines 997-1053)**

```bash
sed -n '997,1053p' views/admin.ejs > views/partials/admin/announcements.ejs
```

- [ ] **Step 3: Extract Games (lines 1056-1454)**

```bash
sed -n '1056,1454p' views/admin.ejs > views/partials/admin/games.ejs
```

- [ ] **Step 4: Extract PS Plus (lines 1457-1580)**

```bash
sed -n '1457,1580p' views/admin.ejs > views/partials/admin/psplus.ejs
```

- [ ] **Step 5: Extract Customers (lines 1583-3093)**

```bash
sed -n '1583,3093p' views/admin.ejs > views/partials/admin/customers.ejs
```

- [ ] **Step 6: Extract Orders (lines 3095-3097)**

```bash
sed -n '3095,3097p' views/admin.ejs > views/partials/admin/orders.ejs
```

- [ ] **Step 7: Extract Visitors (lines 3100-3431)**

```bash
sed -n '3100,3431p' views/admin.ejs > views/partials/admin/visitors.ejs
```

- [ ] **Step 8: Extract Security (lines 3434-3448)**

```bash
sed -n '3434,3448p' views/admin.ejs > views/partials/admin/security.ejs
```

- [ ] **Step 9: Verify all eight partials open and close their own `tab-panel` div**

```bash
for f in settings announcements games psplus customers orders visitors security; do
  echo "--- $f ---"
  head -1 "views/partials/admin/$f.ejs"
  tail -1 "views/partials/admin/$f.ejs"
done
```

Expected: every `head -1` line contains `class="tab-panel" id="tab-<name>"`, and every `tail -1` line is a closing `</div>` (with or without a trailing comment). If any file's first or last line looks wrong, the line range drifted from what this plan assumed — stop and re-measure with `grep -n 'class="tab-panel"'` and `grep -n '/tab-'` against the current `views/admin.ejs`, don't guess.

- [ ] **Step 10: Replace the eight inline blocks in `admin.ejs` with includes**

Delete lines 108-994, 997-1053, 1056-1454, 1457-1580, 1583-3093, 3095-3097, 3100-3431, 3434-3448 from `views/admin.ejs` (working from the bottom of the file upward so earlier line numbers don't shift), replacing each with a single include line. Concretely, in this exact order (bottom to top so line numbers stay valid as you go):

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const fs = require('fs');
const path = 'views/admin.ejs';
let lines = fs.readFileSync(path, 'utf8').split('\n');
// [start, end, includeLine] pairs, 1-indexed inclusive, processed bottom-to-top
const cuts = [
  [3434, 3448, \"  <%- include('partials/admin/security') %>\"],
  [3100, 3431, \"  <%- include('partials/admin/visitors') %>\"],
  [3095, 3097, \"  <%- include('partials/admin/orders') %>\"],
  [1583, 3093, \"  <%- include('partials/admin/customers') %>\"],
  [1457, 1580, \"  <%- include('partials/admin/psplus') %>\"],
  [1056, 1454, \"  <%- include('partials/admin/games') %>\"],
  [997, 1053, \"  <%- include('partials/admin/announcements') %>\"],
  [108, 994, \"  <%- include('partials/admin/settings') %>\"]
];
for (const [start, end, inc] of cuts) {
  lines.splice(start - 1, end - start + 1, inc);
}
fs.writeFileSync(path, lines.join('\n'));
console.log('done, new line count:', lines.length);
"
```

- [ ] **Step 11: Verify `admin.ejs` still compiles and includes resolve**

```bash
node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'), { filename: require('path').resolve('views/admin.ejs') }); console.log('ADMIN_OK')"
```

Expected: `ADMIN_OK`. Passing `filename` is required here — without it, EJS cannot resolve the relative `include()` paths and compilation fails even though the includes themselves are fine.

- [ ] **Step 12: Add the `LEGACY_TABS` map and the `switchTab` null-guard**

In `views/admin.ejs`, find:

```js
const TAB_KEY = 'adminTab';
const tabs = ['settings','announcements','games','customers','orders','psplus','security','visitors'];
```

Replace with:

```js
const TAB_KEY = 'adminTab';
const tabs = ['settings','announcements','games','customers','orders','psplus','security','visitors'];
// Tab ids retired in later phases of the admin reorganisation. A browser that
// still has one of these in localStorage, or a bookmark carrying one in
// ?tab=, must land somewhere real instead of a tab that no longer exists.
const LEGACY_TABS = { announcements: 'content', visitors: 'dashboard', security: 'settings' };
```

Find:

```js
function switchTab(name) {
  tabs.forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t===name);
    document.querySelector('[data-tab='+t+']').classList.toggle('active', t===name);
  });
```

Replace with:

```js
function switchTab(name) {
  // A name outside the current tabs array (a stale id from before a phase of
  // this reorganisation shipped) must not reach getElementById and dereference
  // null — fall back to the landing tab instead of throwing on page load.
  if (!tabs.includes(name)) name = 'dashboard';
  tabs.forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t===name);
    document.querySelector('[data-tab='+t+']').classList.toggle('active', t===name);
  });
```

Find:

```js
  const initial = urlTab || (msg && msgTabMap[msg]) || localStorage.getItem(TAB_KEY) || 'settings';
  switchTab(initial);
```

Replace with:

```js
  const rawInitial = urlTab || (msg && msgTabMap[msg]) || localStorage.getItem(TAB_KEY) || 'settings';
  const initial = LEGACY_TABS[rawInitial] || rawInitial;
  switchTab(initial);
```

This task does not yet change `'dashboard'` doesn't exist as a real tab id until Task 2 — `switchTab`'s new guard falling back to `'dashboard'` is intentionally forward-looking (harmless now since `LEGACY_TABS` only ever maps to ids that will exist by the time they're reachable; `switchTab`'s own guard is dead code until Task 2 lands, which is fine — it must exist *before* Task 2 per the Global Constraints, not be exercised before then).

- [ ] **Step 13: Verify again after the plumbing edit**

```bash
node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'), { filename: require('path').resolve('views/admin.ejs') }); console.log('ADMIN_OK')"
wc -l views/admin.ejs
```

Expected: `ADMIN_OK`, and a line count around 460-480 (down from 3,567).

- [ ] **Step 14: Commit**

```bash
git add views/partials/admin/ views/admin.ejs
git commit -m "Extract admin panel tabs into partials (no content changes)"
```

- [ ] **Step 15: Deploy and verify live**

```bash
git push origin main
for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://playstation-hub.com/admin/login")
  [ "$code" = "200" ] && echo "attempt $i: admin reachable" && break
  echo "attempt $i: $code"; sleep 15
done
```

Then, using the Browser tool: log into `/admin` (password `Ryuzaki2300`), click through all eight tabs in the tab bar, confirm each renders its expected content with no visual difference from before this task, and confirm zero console errors. This is the last point at which the panel's tab *contents* are unchanged from before this plan — a real regression caught here is unambiguously an extraction bug, not a regrouping bug, which narrows debugging later phases considerably.

---

### Task 2 (Phase 2): Dashboard tab — Business Dashboard + Visitor analytics

**Files:**
- Create: `views/partials/admin/dashboard.ejs`
- Modify: `views/admin.ejs` (add the Dashboard tab button and panel include, remove the Visitors tab button, update `tabs` array, update `msgTabMap`, retire `visitors`)
- Modify: `views/partials/admin/customers.ejs` (remove the Business Dashboard block, now that it lives in `dashboard.ejs`)
- Delete: `views/partials/admin/visitors.ejs` (its content is folded into `dashboard.ejs`)

**Interfaces:**
- Consumes: the `LEGACY_TABS` map and `switchTab` guard from Task 1 (this is the first phase that actually introduces a retired id — `visitors` — so this is where those guards are first exercised for real).
- Produces: `dashboard.ejs`, a tab-panel containing Business Dashboard (with its Month Logs script, lines 1602-2089 of the original file, already isolated as its own accordion+script inside `customers.ejs` from Task 1) followed by the full former Visitors tab content.

- [ ] **Step 1: Confirm the Business Dashboard's exact boundaries inside `customers.ejs`**

```bash
grep -n 'settings-accordion\|accordion dashboard\|Business Dashboard' views/partials/admin/customers.ejs | head -5
```

Expected: a `<div class="settings-accordion"` line near the top of the file (this was line 1602 in the original `admin.ejs`, now near line 20 of `customers.ejs` since the file starts at what was line 1583), and a `<!-- /accordion dashboard -->` comment marking its close (was line 1732). Because `customers.ejs` now starts at former line 1583, the accordion's start is at `1602 - 1583 + 1 = 20` and its close is at `1732 - 1583 + 1 = 150` — verify this arithmetic against the grep output before cutting; if `customers.ejs` was re-saved with different line endings the offset could be off by one, so trust the grep, not the arithmetic.

- [ ] **Step 2: Cut the Business Dashboard block out of `customers.ejs` into `dashboard.ejs`**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const fs = require('fs');
const lines = fs.readFileSync('views/partials/admin/customers.ejs', 'utf8').split('\n');
// Locate the accordion start and its matching close comment programmatically
// rather than trusting a hand-computed offset.
const startIdx = lines.findIndex(l => l.includes('settings-accordion') && l.includes('style=\"margin-bottom:1rem;\"'));
const endIdx = lines.findIndex(l => l.includes('/accordion dashboard'));
if (startIdx === -1 || endIdx === -1) { console.error('boundary not found', startIdx, endIdx); process.exit(1); }
const dashboardBlock = lines.slice(startIdx, endIdx + 1);
fs.writeFileSync('views/partials/admin/_dashboard_business_block.tmp', dashboardBlock.join('\n'));
lines.splice(startIdx, endIdx - startIdx + 1);
fs.writeFileSync('views/partials/admin/customers.ejs', lines.join('\n'));
console.log('cut', dashboardBlock.length, 'lines, customers.ejs now', lines.length, 'lines');
"
```

- [ ] **Step 3: Verify the cut left `customers.ejs` starting cleanly at Message Blast**

```bash
head -5 views/partials/admin/customers.ejs
```

Expected: the tab-panel opening div followed shortly by a `<!-- Message Blast -->` comment, with no leftover Business Dashboard markup.

- [ ] **Step 4: Assemble `dashboard.ejs` from the cut block plus the former Visitors tab**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
{
  echo '  <div class="tab-panel" id="tab-dashboard">'
  cat views/partials/admin/_dashboard_business_block.tmp
  echo
  sed -n '2,$p' views/partials/admin/visitors.ejs
} > views/partials/admin/dashboard.ejs
rm views/partials/admin/_dashboard_business_block.tmp
```

The `sed -n '2,$p'` on `visitors.ejs` drops its own `<div class="tab-panel" id="tab-visitors">` opening line (kept everything else, including its closing `</div>`), since `dashboard.ejs` opens with its own `tab-dashboard` div instead.

- [ ] **Step 5: Fix the id on `dashboard.ejs`'s own closing div and verify structure**

```bash
tail -3 views/partials/admin/dashboard.ejs
```

Confirm the last line is a `</div>` — it should already be correct since it's the Visitors tab's original closing div, which needs no id (only the *opening* div carries `id="tab-X"`).

- [ ] **Step 6: Delete the now-unused `visitors.ejs`**

```bash
rm views/partials/admin/visitors.ejs
```

- [ ] **Step 7: Update `admin.ejs` — swap the Visitors include for Dashboard, add the tab button, update `tabs` array**

In `views/admin.ejs`, find the Visitors tab button:

```ejs
    <button class="admin-tab" data-tab="visitors" onclick="switchTab('visitors')">👁️ Visitors</button>
```

Replace with a Dashboard button placed first in the tab bar (find the Settings button, which currently opens the bar, and insert immediately before it):

```ejs
    <button class="admin-tab" data-tab="dashboard" onclick="switchTab('dashboard')">📊 Dashboard</button>
    <button class="admin-tab" data-tab="settings" onclick="switchTab('settings')">⚙️ Settings</button>
```

(This replaces the standalone Settings button line with the two-line block above — Dashboard now comes first, Settings unchanged after it. Delete the old `data-tab="visitors"` button line entirely; do not leave two buttons.)

Find the Visitors include (added in Task 1):

```ejs
  <%- include('partials/admin/visitors') %>
```

Replace with:

```ejs
  <%- include('partials/admin/dashboard') %>
```

Find:

```js
const tabs = ['settings','announcements','games','customers','orders','psplus','security','visitors'];
```

Replace with:

```js
const tabs = ['dashboard','settings','announcements','games','customers','orders','psplus','security'];
```

- [ ] **Step 8: Update `msgTabMap` for the two Month Log keys**

Find:

```js
    month_log_saved:'customers', month_log_deleted:'customers',
```

Replace with:

```js
    month_log_saved:'dashboard', month_log_deleted:'dashboard',
```

- [ ] **Step 9: Update the default-tab fallback in `switchTab`**

Find:

```js
  if (name !== 'settings') q.set('tab', name);
```

Replace with:

```js
  if (name !== 'dashboard') q.set('tab', name);
```

- [ ] **Step 10: Update the initial-tab resolver's final fallback**

Find (this was already touched in Task 1 — confirm it now reads):

```js
  const rawInitial = urlTab || (msg && msgTabMap[msg]) || localStorage.getItem(TAB_KEY) || 'settings';
```

Replace the trailing `'settings'` with `'dashboard'`:

```js
  const rawInitial = urlTab || (msg && msgTabMap[msg]) || localStorage.getItem(TAB_KEY) || 'dashboard';
```

- [ ] **Step 11: Verify `admin.ejs` compiles**

```bash
node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'), { filename: require('path').resolve('views/admin.ejs') }); console.log('ADMIN_OK')"
```

- [ ] **Step 12: Verify no leftover references to the retired `visitors` id**

```bash
grep -n "tab-visitors\|'visitors'" views/admin.ejs
```

Expected: no output (the file should contain zero remaining references — `LEGACY_TABS` maps the *string* `'visitors'` as a *source* key, which is a different, intentional occurrence; if this grep matches that line, that is correct and expected, not a bug).

- [ ] **Step 13: Commit**

```bash
git add views/partials/admin/ views/admin.ejs
git commit -m "Create Dashboard tab: Business Dashboard + Visitor analytics, retire Visitors tab"
```

- [ ] **Step 14: Deploy and verify live**

Same deploy-and-poll pattern as Task 1 Step 15. Then, using the Browser tool:

1. Log into `/admin`. Confirm it lands on the Dashboard tab by default.
2. Confirm Dashboard shows both the Business Dashboard (revenue, profit, live status) and the Visitor analytics (visits chart, most-visited pages, recent visits) in one tab.
3. Confirm Month Logs still work: open a month's drill-down, save a month log, confirm the toast fires and you land on Dashboard (not Customers).
4. Confirm Customers no longer shows the Business Dashboard — only Message Blast, Import, Add New Customer, All Customers.
5. In the browser console, run `localStorage.setItem('adminTab', 'visitors'); location.reload();` — confirm the panel loads without a JS error and lands on Dashboard, not a blank panel. This is the concrete test of the `LEGACY_TABS` guard actually working, not just existing in the code.
6. Zero console errors throughout.

---

### Task 3 (Phase 3): Messaging tab — Message Blast, Message Templates, Bot Training

**Files:**
- Create: `views/partials/admin/messaging.ejs`
- Modify: `views/admin.ejs` (add Messaging tab button and include, update `tabs` array)
- Modify: `views/partials/admin/customers.ejs` (remove the Message Blast block)
- Modify: `views/partials/admin/settings.ejs` (remove the Message Templates and Bot Training blocks)

**Interfaces:**
- Consumes: nothing new from earlier tasks.
- Produces: `messaging.ejs`, containing Message Blast, Message Templates, and Bot Training as three accordions in one tab-panel.

- [ ] **Step 1: Cut Message Blast out of `customers.ejs`**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const fs = require('fs');
const lines = fs.readFileSync('views/partials/admin/customers.ejs', 'utf8').split('\n');
const startIdx = lines.findIndex(l => l.includes('<!-- Message Blast -->'));
const endIdx = lines.findIndex(l => l.includes('/accordion message-blast'));
if (startIdx === -1 || endIdx === -1) { console.error('boundary not found', startIdx, endIdx); process.exit(1); }
const block = lines.slice(startIdx, endIdx + 1);
fs.writeFileSync('views/partials/admin/_messaging_blast.tmp', block.join('\n'));
lines.splice(startIdx, endIdx - startIdx + 1);
fs.writeFileSync('views/partials/admin/customers.ejs', lines.join('\n'));
console.log('cut', block.length, 'lines');
"
```

- [ ] **Step 2: Cut Bot Training out of `settings.ejs`**

```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('views/partials/admin/settings.ejs', 'utf8').split('\n');
const startIdx = lines.findIndex(l => l.includes('<!-- Bot Training -->'));
const endIdx = lines.findIndex(l => l.includes('/accordion bot-training'));
if (startIdx === -1 || endIdx === -1) { console.error('boundary not found', startIdx, endIdx); process.exit(1); }
const block = lines.slice(startIdx, endIdx + 1);
fs.writeFileSync('views/partials/admin/_messaging_bot.tmp', block.join('\n'));
lines.splice(startIdx, endIdx - startIdx + 1);
fs.writeFileSync('views/partials/admin/settings.ejs', lines.join('\n'));
console.log('cut', block.length, 'lines');
"
```

- [ ] **Step 3: Cut Message Templates out of `settings.ejs`**

```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('views/partials/admin/settings.ejs', 'utf8').split('\n');
const startIdx = lines.findIndex(l => l.includes('<!-- Message Templates -->'));
const endIdx = lines.findIndex(l => l.includes('/accordion message templates'));
if (startIdx === -1 || endIdx === -1) { console.error('boundary not found', startIdx, endIdx); process.exit(1); }
const block = lines.slice(startIdx, endIdx + 1);
fs.writeFileSync('views/partials/admin/_messaging_templates.tmp', block.join('\n'));
lines.splice(startIdx, endIdx - startIdx + 1);
fs.writeFileSync('views/partials/admin/settings.ejs', lines.join('\n'));
console.log('cut', block.length, 'lines');
"
```

- [ ] **Step 4: Assemble `messaging.ejs`**

```bash
{
  echo '  <div class="tab-panel" id="tab-messaging">'
  cat views/partials/admin/_messaging_blast.tmp
  echo
  cat views/partials/admin/_messaging_templates.tmp
  echo
  cat views/partials/admin/_messaging_bot.tmp
  echo '  </div>'
} > views/partials/admin/messaging.ejs
rm views/partials/admin/_messaging_blast.tmp views/partials/admin/_messaging_templates.tmp views/partials/admin/_messaging_bot.tmp
```

Order is Message Blast, then Message Templates, then Bot Training — outbound-marketing-first, matching the spec's grouping description.

- [ ] **Step 5: Add the Messaging tab button and include in `admin.ejs`**

Find the Settings tab button (now second in the bar, after Dashboard from Task 2):

```ejs
    <button class="admin-tab" data-tab="settings" onclick="switchTab('settings')">⚙️ Settings</button>
```

Insert immediately after it:

```ejs
    <button class="admin-tab" data-tab="messaging" onclick="switchTab('messaging')">💬 Messaging</button>
```

Find the Settings include:

```ejs
  <%- include('partials/admin/settings') %>
```

Insert immediately after it:

```ejs
  <%- include('partials/admin/messaging') %>
```

Find:

```js
const tabs = ['dashboard','settings','announcements','games','customers','orders','psplus','security'];
```

Replace with:

```js
const tabs = ['dashboard','settings','messaging','announcements','games','customers','orders','psplus','security'];
```

- [ ] **Step 6: Verify `admin.ejs` and both modified partials compile**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'), { filename: require('path').resolve('views/admin.ejs') }); console.log('ADMIN_OK')"
```

- [ ] **Step 7: Commit**

```bash
git add views/partials/admin/ views/admin.ejs
git commit -m "Create Messaging tab: Message Blast, Message Templates, Bot Training"
```

- [ ] **Step 8: Deploy and verify live**

Same deploy-and-poll pattern. Then, using the Browser tool:

1. Confirm Messaging tab shows all three sections, each expandable.
2. Confirm Settings no longer shows Bot Training or Message Templates.
3. Confirm Customers no longer shows Message Blast.
4. Send one test message blast (or confirm the form renders correctly without sending, if sending has real customer-facing side effects — prefer rendering-only verification here given the destructive-action caution this session follows for anything that reaches real customers).
5. Zero console errors.

---

### Task 4 (Phase 4): Site Content tab — homepage content + Announcements

**Files:**
- Create: `views/partials/admin/content.ejs`
- Modify: `views/admin.ejs` (add Site Content tab button and include, remove Announcements tab button, update `tabs` array, update `msgTabMap`, move the Sign-In QR Guide reopen script)
- Modify: `views/partials/admin/settings.ejs` (remove Hero Slides Manager, Promo Settings's Sign-In QR Guide sub-block — see note below, Homepage Popup, Hero Text Editor, Customer Reviews)
- Delete: `views/partials/admin/announcements.ejs` (folded into `content.ejs`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `content.ejs`, containing Hero Slider, Sign-In QR Guide, Homepage Popup, Hero Text, Customer Reviews, and Announcements, in that order.

Note on Sign-In QR Guide: it is its own top-level accordion (`<!-- SIGN-IN QR GUIDE -->` at what was line 434 of the original file, closing before `<!-- HOMEPAGE POPUP -->`), not nested inside Promo Settings — the spec's "Promo & Pricing Rules" wording refers to a separate, adjacent accordion. Cut it as its own block.

- [ ] **Step 1: Cut each Site Content section out of `settings.ejs`, one at a time**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const fs = require('fs');

function cutBlock(filePath, startMarker, endMarker, outPath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const startIdx = lines.findIndex(l => l.includes(startMarker));
  const endIdx = lines.findIndex(l => l.includes(endMarker));
  if (startIdx === -1 || endIdx === -1) { console.error('NOT FOUND', startMarker, startIdx, endIdx); process.exit(1); }
  const block = lines.slice(startIdx, endIdx + 1);
  fs.writeFileSync(outPath, block.join('\n'));
  lines.splice(startIdx, endIdx - startIdx + 1);
  fs.writeFileSync(filePath, lines.join('\n'));
  console.log('cut', block.length, 'lines for', startMarker);
}

const F = 'views/partials/admin/settings.ejs';
cutBlock(F, '<!-- HERO SLIDES MANAGER -->', '/accordion hero-slides', 'views/partials/admin/_content_heroslides.tmp');
cutBlock(F, '<!-- SIGN-IN QR GUIDE -->', '<!-- HOMEPAGE POPUP -->', 'views/partials/admin/_content_signin_raw.tmp');
cutBlock(F, '<!-- HOMEPAGE POPUP -->', '/accordion popup', 'views/partials/admin/_content_popup.tmp');
cutBlock(F, '<!-- HERO TEXT EDITOR -->', '/accordion hero-text', 'views/partials/admin/_content_herotext.tmp');
cutBlock(F, '<!-- CUSTOMER REVIEWS -->', '/accordion reviews', 'views/partials/admin/_content_reviews.tmp');
"
```

The Sign-In QR Guide cut is bounded by the *next* section's opening comment (`<!-- HOMEPAGE POPUP -->`) rather than its own closing comment, because — unlike every other section in this file — it has no `<!-- /accordion ... -->` marker of its own (verify this with `grep -n '/accordion' views/partials/admin/settings.ejs` before running the script above; if a closing marker does exist, use `cutBlock` with that marker instead and drop the following step).

- [ ] **Step 2: Trim the trailing `<!-- HOMEPAGE POPUP -->` comment duplicated by the boundary cut**

The previous step's Sign-In QR Guide cut includes the `<!-- HOMEPAGE POPUP -->` comment line at its end (since that was used as the end boundary), and the Homepage Popup cut also starts with that same line — so it now appears in both temp files. Remove it from the Sign-In QR Guide file only:

```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('views/partials/admin/_content_signin_raw.tmp', 'utf8').split('\n');
if (lines[lines.length - 1].includes('<!-- HOMEPAGE POPUP -->')) lines.pop();
fs.writeFileSync('views/partials/admin/_content_signin.tmp', lines.join('\n'));
"
rm views/partials/admin/_content_signin_raw.tmp
```

- [ ] **Step 3: Verify no five-way overlap or gap**

```bash
for f in heroslides signin popup herotext reviews; do
  echo "--- $f ---"; head -1 "views/partials/admin/_content_$f.tmp"; tail -1 "views/partials/admin/_content_$f.tmp"
done
```

Each should start with its own section comment and end with its own closing marker (or, for `signin`, the line immediately before `<!-- HOMEPAGE POPUP -->`).

- [ ] **Step 4: Assemble `content.ejs`**

```bash
{
  echo '  <div class="tab-panel" id="tab-content">'
  cat views/partials/admin/_content_heroslides.tmp; echo
  cat views/partials/admin/_content_signin.tmp; echo
  cat views/partials/admin/_content_popup.tmp; echo
  cat views/partials/admin/_content_herotext.tmp; echo
  cat views/partials/admin/_content_reviews.tmp; echo
  sed -n '2,$p' views/partials/admin/announcements.ejs
} > views/partials/admin/content.ejs
rm views/partials/admin/_content_heroslides.tmp views/partials/admin/_content_signin.tmp views/partials/admin/_content_popup.tmp views/partials/admin/_content_herotext.tmp views/partials/admin/_content_reviews.tmp
rm views/partials/admin/announcements.ejs
```

Announcements is appended last, same as before (its own opening tab-panel div dropped via `sed -n '2,$p'`, same pattern as Task 2 Step 4).

- [ ] **Step 5: Update `admin.ejs` — tab button, include, `tabs` array, `msgTabMap`**

Find the Announcements tab button:

```ejs
    <button class="admin-tab" data-tab="announcements" onclick="switchTab('announcements')">📢 Announcements</button>
```

Replace with:

```ejs
    <button class="admin-tab" data-tab="content" onclick="switchTab('content')">🖥️ Site Content</button>
```

Find the Announcements include:

```ejs
  <%- include('partials/admin/announcements') %>
```

Replace with:

```ejs
  <%- include('partials/admin/content') %>
```

Find:

```js
const tabs = ['dashboard','settings','messaging','announcements','games','customers','orders','psplus','security'];
```

Replace with:

```js
const tabs = ['dashboard','settings','messaging','content','games','customers','orders','psplus','security'];
```

Find, in `msgTabMap`:

```js
    announcement:'announcements',
```

Replace with:

```js
    announcement:'content',
```

Find:

```js
    settings_saved:'settings', promo_saved:'settings', popup_saved:'settings', password_changed:'security',
    wrong_password:'security', password_mismatch:'security', password_too_short:'security',
    signin_step_saved:'settings', signin_step_deleted:'settings',
```

Replace with:

```js
    settings_saved:'settings', promo_saved:'settings', popup_saved:'content', password_changed:'security',
    wrong_password:'security', password_mismatch:'security', password_too_short:'security',
    signin_step_saved:'content', signin_step_deleted:'content',
```

(`password_*` keys stay `'security'` for now — that tab is retired in Task 5, not this one. Changing them here would point at a tab id that still doesn't exist yet.)

- [ ] **Step 6: Move the Sign-In QR Guide reopen script**

Find, near the end of `admin.ejs`'s script block:

```js
    // Sign-in QR Guide edits happen inside a nested accordion that
    // switchTab/toggleAccordion don't know about — open it explicitly
    // so the admin lands back on the step they just edited.
    if (String(msg).startsWith('signin_step_')) {
      const ssgHeader = document.getElementById('ssgAccordionHeader');
      const ssgBody = document.getElementById('ssgAccordionBody');
      if (ssgHeader && ssgBody) {
```

Read the full `if` block this opens (it continues for a few more lines — read the surrounding 10 lines with `grep -n -A10 "startsWith('signin_step_')" views/admin.ejs` to see its exact end before touching it). This logic can stay exactly where it is in `admin.ejs`'s shared script — it operates on `getElementById`, which works identically regardless of which partial the `ssgAccordionHeader`/`ssgAccordionBody` elements now live inside, since EJS includes are inlined into one HTML document at render time. **No code move is needed here** — only confirm by grep that the ids `ssgAccordionHeader` and `ssgAccordionBody` still exist somewhere in `content.ejs`'s Sign-In QR Guide section after the cut in Step 1:

```bash
grep -n "ssgAccordionHeader\|ssgAccordionBody" views/partials/admin/content.ejs
```

Expected: two matches, both inside the Sign-In QR Guide block.

- [ ] **Step 7: Verify `admin.ejs` compiles**

```bash
node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'), { filename: require('path').resolve('views/admin.ejs') }); console.log('ADMIN_OK')"
```

- [ ] **Step 8: Commit**

```bash
git add views/partials/admin/ views/admin.ejs
git commit -m "Create Site Content tab: hero, popup, reviews, sign-in guide, announcements; retire Announcements tab"
```

- [ ] **Step 9: Deploy and verify live**

Same deploy-and-poll pattern. Then, using the Browser tool:

1. Confirm Site Content shows all five sections plus Announcements.
2. Confirm Settings no longer shows any of them.
3. Edit one Sign-In QR Guide step, save, confirm the toast fires, you land on Site Content, and the Sign-In QR Guide accordion auto-expands to the step you edited (this exercises the reopen script this task deliberately left untouched — the real test of Step 6's reasoning).
4. Save one Homepage Popup change, confirm the toast lands on Site Content.
5. Save one Announcement, confirm the toast lands on Site Content.
6. `localStorage.setItem('adminTab', 'announcements'); location.reload();` in console — confirm no error, lands on Site Content.
7. Zero console errors.

---

### Task 5 (Phase 5): Settings absorbs Change Password + Maintenance section; retire Security tab

**Files:**
- Modify: `views/partials/admin/settings.ejs` (append Change Password from `security.ejs`; add a Maintenance section wrapping the existing Image Optimization block)
- Modify: `views/admin.ejs` (remove Security tab button, update `tabs` array, update `msgTabMap` password keys, update default-tab and any remaining `'security'` string default)
- Delete: `views/partials/admin/security.ejs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `settings.ejs` now containing Site Settings, Maintenance (wrapping Image Optimization), Promo & Pricing Rules, Payment Methods, Change Password — five sections total, matching the spec's target table.

- [ ] **Step 1: Wrap the existing Image Optimization block in a Maintenance heading**

`settings.ejs` already contains the Image Optimization accordion (untouched since Task 1 — verify with `grep -n 'IMAGE OPTIMIZATION' views/partials/admin/settings.ejs`). Find:

```ejs
    <!-- IMAGE OPTIMIZATION -->
    <div class="settings-accordion">
```

Replace with:

```ejs
    <!-- MAINTENANCE -->
    <div style="margin:1.5rem 0 0.75rem;font-size:0.78rem;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;color:#555;">Maintenance</div>
    <!-- IMAGE OPTIMIZATION -->
    <div class="settings-accordion">
```

This is the one genuinely new piece of markup in the whole plan — a section label with no prior equivalent, per the spec's note that Image Optimization currently has no heading of its own.

- [ ] **Step 2: Append Change Password from `security.ejs` onto the end of `settings.ejs`**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const fs = require('fs');
const settingsLines = fs.readFileSync('views/partials/admin/settings.ejs', 'utf8').split('\n');
const securityLines = fs.readFileSync('views/partials/admin/security.ejs', 'utf8').split('\n');
// Drop security.ejs's own opening tab-panel div (line 1) and closing div (last line) —
// its content becomes a section inside settings.ejs's existing tab-panel, not a panel of its own.
const securityBody = securityLines.slice(1, -1);
// settings.ejs's last line is its own closing </div> (the tab-panel close) — insert
// the security body immediately before it, not after.
const closeLine = settingsLines.pop();
const merged = settingsLines.concat(securityBody).concat([closeLine]);
fs.writeFileSync('views/partials/admin/settings.ejs', merged.join('\n'));
console.log('settings.ejs now', merged.length, 'lines');
"
rm views/partials/admin/security.ejs
```

- [ ] **Step 3: Verify the merge didn't duplicate or drop the closing div**

```bash
tail -5 views/partials/admin/settings.ejs
```

Expected: the Change Password form's own markup, followed by exactly one closing `</div>` for the whole tab-panel — not two.

- [ ] **Step 4: Update `admin.ejs` — remove the Security tab button, update `tabs`, remove the Security include**

Find:

```ejs
    <button class="admin-tab" data-tab="security" onclick="switchTab('security')">🔒 Security</button>
```

Delete this line entirely.

Find:

```ejs
  <%- include('partials/admin/security') %>
```

Delete this line entirely (Change Password now renders as part of the Settings include, already present earlier in the file).

Find:

```js
const tabs = ['dashboard','settings','messaging','content','games','customers','orders','psplus','security'];
```

Replace with:

```js
const tabs = ['dashboard','settings','messaging','content','games','customers','orders','psplus'];
```

- [ ] **Step 5: Update the four password keys in `msgTabMap`**

Find:

```js
    settings_saved:'settings', promo_saved:'settings', popup_saved:'content', password_changed:'security',
    wrong_password:'security', password_mismatch:'security', password_too_short:'security',
```

Replace with:

```js
    settings_saved:'settings', promo_saved:'settings', popup_saved:'content', password_changed:'settings',
    wrong_password:'settings', password_mismatch:'settings', password_too_short:'settings',
```

- [ ] **Step 6: Verify `admin.ejs` compiles**

```bash
node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'), { filename: require('path').resolve('views/admin.ejs') }); console.log('ADMIN_OK')"
```

- [ ] **Step 7: Verify no leftover references to the retired `security` id as a tab**

```bash
grep -n "tab-security\|data-tab=\"security\"" views/admin.ejs
```

Expected: no output. (`LEGACY_TABS`'s `security: 'settings'` entry is a source-key string, unaffected by this grep pattern since it targets `data-tab="security"` and `tab-security` specifically, neither of which matches `security:`.)

- [ ] **Step 8: Commit**

```bash
git add views/partials/admin/ views/admin.ejs
git commit -m "Fold Change Password and Maintenance into Settings; retire Security tab"
```

- [ ] **Step 9: Deploy and verify live**

Same deploy-and-poll pattern. Then, using the Browser tool:

1. Confirm Settings now shows Site Settings, Maintenance (with the "Optimize All Images Now" button working), Promo & Pricing Rules, Payment Methods, and Change Password, in that order.
2. Click "Optimize All Images Now" — confirm it still runs and reports a result (this exercises the constraint that `backfill-images` must not be broken by this move).
3. Change the admin password to a test value, confirm the toast lands on Settings, then change it back to `Ryuzaki2300` immediately (do not leave the live site on a test password).
4. `localStorage.setItem('adminTab', 'security'); location.reload();` in console — confirm no error, lands on Settings.
5. Zero console errors.

---

### Task 6 (Phase 6): Delete fix-end-dates, final sweep, and full regression pass

**Files:**
- Delete: `views/fix-end-dates.ejs`
- Modify: `server.js` (remove the `GET /admin/fix-end-dates` and `POST /admin/fix-end-dates` routes)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed elsewhere — this is the plan's final task.

- [ ] **Step 1: Locate and remove both `fix-end-dates` routes**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -n "fix-end-dates" server.js
```

Read the full extent of each route handler this prints (from `app.get(` / `app.post(` down to its closing `});`) using `Read` on `server.js` at those line numbers, then delete both handlers in full with `Edit`. Do not use a blind line-range script for this one — unlike the EJS moves above, route handlers vary in length and a mis-measured cut here would corrupt `server.js`.

- [ ] **Step 2: Delete the view**

```bash
rm views/fix-end-dates.ejs
```

- [ ] **Step 3: Verify no remaining references anywhere in the app**

```bash
grep -rn "fix-end-dates" server.js views/ public/ 2>/dev/null
```

Expected: no output.

- [ ] **Step 4: Verify `server.js` still parses**

```bash
node -c server.js && echo SYNTAX_OK
```

- [ ] **Step 5: Verify final line count and full route/tab inventory**

```bash
wc -l views/admin.ejs
grep -oE "data-tab=\"[a-z]+\"" views/admin.ejs | sort -u
grep -c "app\.\(get\|post\)('/admin" server.js
```

Expected: `views/admin.ejs` under ~480 lines (the shell: head, tab bar, eight includes, loading overlay, and the tab-switching script). Eight distinct `data-tab` values: `dashboard`, `settings`, `messaging`, `content`, `games`, `customers`, `orders`, `psplus` — note `orders` has no `data-tab` button of its own in the current bar (confirm this against the live tab bar structure — if Orders has always been rendered as part of a different element, this count may legitimately show seven `data-tab` buttons plus one differently-marked Orders button; do not force an eighth `data-tab` attribute onto Orders if it never had one). Route count: 92 (94 minus the two deleted `fix-end-dates` routes).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Remove fix-end-dates migration page and routes"
```

- [ ] **Step 7: Deploy**

```bash
git push origin main
for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://playstation-hub.com/admin/login")
  [ "$code" = "200" ] && echo "attempt $i: admin reachable" && break
  echo "attempt $i: $code"; sleep 15
done
```

- [ ] **Step 8: Full regression pass with the Browser tool**

1. Log into `/admin` fresh (clear `localStorage` first with `localStorage.clear()` in console, to test a first-ever visit with no stored tab preference). Confirm it lands on Dashboard.
2. Click through all eight tabs in order: Dashboard, Settings, Messaging, Site Content, Games, Customers, Orders, PS Plus. Confirm each renders its full expected content with no missing sections (cross-check against the spec's target-structure table).
3. Confirm `https://playstation-hub.com/admin/fix-end-dates` now 404s.
4. Confirm the mongo-status connection badge in the header still works (green/amber/red dot).
5. Save one item in each of the four newly-created or newly-merged tabs (Dashboard's Business Dashboard already tested in Task 2; Messaging's Message Templates; Site Content's Customer Reviews; Settings' Payment Methods) and confirm each toast lands on the correct tab.
6. Resize to a mobile viewport and confirm the tab bar still wraps/scrolls usably with eight buttons.
7. Zero console errors across the entire pass.
8. Report final state to the user: line-count reduction in `admin.ejs`, confirmation every tab works, confirmation `fix-end-dates` is gone, and a reminder that lazy tab loading (the 8,597-DOM-node figure) remains explicitly out of scope per the spec.
