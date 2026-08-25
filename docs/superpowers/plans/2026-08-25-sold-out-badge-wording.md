# Sold-Out Badge Wording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The game card's sold-out badge reads "No slots" instead of "Rented", and the fully-booked clock line reads "No date yet" instead of "Rented", so the card's availability badges speak one vocabulary: Last slot → No slots.

**Architecture:** Three string edits across two files that already exist — the badge text and its class name in `views/partials/game-card.ejs`, the matching selector in `public/css/style.css`. No conditions, counts, dates, or style declarations change. Markup and stylesheet ship in the same deploy, so the class rename has no window where the two disagree.

**Tech Stack:** EJS templates, plain CSS. No new dependencies.

## Global Constraints

- Only `views/partials/game-card.ejs` and `public/css/style.css` are touched.
- Badge text is exactly `No slots` — plural, sentence case, matching the existing sibling badge `Last slot`.
- Clock-line fallback text is exactly `No date yet`.
- CSS class renames from `gc2-badge-rented` to `gc2-badge-noslots`. The declarations inside the rule are copied over byte-for-byte — no visual property changes.
- The `allUnavail` condition, the `gcNextDays` calculation, and the `Free in Xd` branch are untouched.
- `views/bundle.ejs` and `views/buy.ejs` keep their `'Rented'` slot-status labels — those describe a single slot in a tier picker, not card-level availability. Do not edit them.
- Historical plan/spec files under `docs/superpowers/` that mention `gc2-badge-rented` are records of past work. Do not edit them.

---

### Task 1: Rename the badge and the clock-line fallback

**Files:**
- Modify: `views/partials/game-card.ejs:63` (badge markup), `views/partials/game-card.ejs:77` (clock-line fallback)
- Modify: `public/css/style.css:2377` (badge selector)

**Interfaces:**
- Consumes: the existing `allUnavail` local and `.gc2-badge` base class — both unchanged by this task.
- Produces: nothing consumed by a later task — this plan has one task.

- [ ] **Step 1: Change the badge text and class**

In `views/partials/game-card.ejs`, replace this line:

```html
    <div class="gc2-badge gc2-badge-rented">Rented</div>
```

with:

```html
    <div class="gc2-badge gc2-badge-noslots">No slots</div>
```

- [ ] **Step 2: Change the clock-line fallback**

In `views/partials/game-card.ejs`, replace this line:

```html
        <% if (gcNextDays.length) { %>Free in <%= Math.min(...gcNextDays) %>d<% } else { %>Rented<% } %>
```

with:

```html
        <% if (gcNextDays.length) { %>Free in <%= Math.min(...gcNextDays) %>d<% } else { %>No date yet<% } %>
```

Only the `else` branch text changes. The condition and the `Free in Xd` branch stay exactly as written.

- [ ] **Step 3: Rename the CSS selector**

In `public/css/style.css`, replace this line:

```css
.gc2-badge-rented { left: 9px; background: rgba(20,20,20,0.9); color: #999; border: 1px solid rgba(255,255,255,0.16); }
```

with:

```css
.gc2-badge-noslots { left: 9px; background: rgba(20,20,20,0.9); color: #999; border: 1px solid rgba(255,255,255,0.16); }
```

Every declaration is identical — only the selector name changes.

- [ ] **Step 4: Verify no stale references remain in live code**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -rn "gc2-badge-rented" views/ public/
```

Expected: no output. Matches under `docs/` are historical records and are expected to remain.

Then confirm the new name is wired in both files:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -rn "gc2-badge-noslots" views/ public/
```

Expected: exactly two lines — one in `views/partials/game-card.ejs`, one in `public/css/style.css`.

- [ ] **Step 5: Verify the CSS still parses**

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

- [ ] **Step 6: Verify the template still renders**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const ejs = require('ejs');
const src = require('fs').readFileSync('views/partials/game-card.ejs', 'utf8');
try { ejs.compile(src); console.log('game-card.ejs compiles: true'); }
catch (e) { console.log('COMPILE ERROR:', e.message); process.exit(1); }
"
```

Expected: `game-card.ejs compiles: true`.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add views/partials/game-card.ejs public/css/style.css
git commit -m "Rename sold-out card badge from Rented to No slots"
```

- [ ] **Step 8: Deploy**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git push origin main
```

This push also carries commit `50e0055` (the deepened rest-state scrim), whose own deploy had not yet rolled over when this plan was written. Poll for the badge markup rather than the CSS, since the badge is server-rendered HTML:

```bash
until curl -s "https://playstation-hub.com/browse" | grep -q "gc2-badge-noslots"; do sleep 15; done; echo "deployed"
```

If this has not landed after several minutes, the Railway deploy is stuck rather than slow — report that to the user rather than continuing to poll silently.

- [ ] **Step 9: Verify live**

Navigate to `https://playstation-hub.com/browse` with the Browser tool and confirm:

1. The PS Plus Deluxe card — fully booked at the time of writing — shows a **NO SLOTS** badge where it previously read RENTED, in the same top-left position with the same dark styling.
2. Hovering that card reveals its clock line reading **No date yet**, not "Rented".
3. A card with one slot remaining still shows **Last slot**, unchanged.
4. A card with a known return date still shows **Free in Xd**, unchanged.
5. Zero console errors.

Note that the reveal-on-hover behavior means the clock line is only visible on hover at desktop widths — hover the card and screenshot it in one batched tool call, since a separate `browser_evaluate` call does not preserve the synthetic hover state.

- [ ] **Step 10: Report**

Report the change live, noting the badge text, the clock-line text, and that the "Last slot" and "Free in Xd" states were confirmed unchanged.
