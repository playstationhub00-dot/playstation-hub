# Game Card Hover-Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On hover-capable pointers, a `.gc2-card` shows only its title and price at rest, and reveals the rest of its details (platform/genre, slot chips, buy price, bundle note, CTA) on hover/focus with an opacity+transform slide, matching the approved visual proposal.

**Architecture:** Pure CSS addition inside a `@media (hover: hover) and (pointer: fine)` block, layered on the existing `.gc2-*` classes already shared by the rent card (`views/partials/game-card.ejs`), the buy card (`views/buy.ejs`), and the PS Plus card (`views/partials/psplus-card.ejs`). No template or route changes — every element these rules target already renders in the DOM on all three cards; this only changes which are visible in which state. Cards that don't render a given class (e.g. `views/buy.ejs` has no `.gc2-status`) are unaffected by that rule — the selector simply matches nothing there.

**Tech Stack:** Plain CSS. No new dependencies.

## Global Constraints

- Only `public/css/style.css` is touched. No `.ejs` file, no `server.js`, no JS is added.
- The reveal is scoped to `@media (hover: hover) and (pointer: fine)` — outside that query (touch devices), every element renders exactly as it does today, fully visible at rest, with zero new CSS applying.
- At rest (inside the media query, not hovered/focused): `.gc2-title`, `.gc2-price` (and its wrapper `.gc2-price-col` where present), `.gc2-psplus-note`, and every `.gc2-badge` (New/Last slot/Rented/rank/buy-pending) stay visible. Hidden: `.gc2-plat`, `.gc2-status`, `.gc2-buy-price`, `.gc2-bundle-note`, `.gc2-cta`.
- On `.gc2-card:hover` or `.gc2-card:focus` (the card itself is the `<a>`, so `:focus` is correct — there is no nested focusable child to require `:focus-within`), the hidden elements reveal via `opacity` and `transform` only — never `height`, `max-height`, `padding`, or `margin`, per this project's own layout-transition lint (`public/css/style.css` has been flagged for exactly this pattern elsewhere in this session).
- `.gc2-scrim` (the gradient overlay) becomes lighter/shorter at rest and reverts to its current (already-shipped) gradient on hover/focus. `.gc2-scrim-dim` (the extra darkening used on fully-rented/unavailable cards) is excluded from this lightening — an unavailable card stays dark at rest and on hover, unchanged from today, since that scrim communicates unavailability rather than participating in the reveal.
- `prefers-reduced-motion: reduce` removes the transition entirely (elements still change visibility, just without animating).
- Transition duration ~200ms, matching the spec.

---

### Task 1: Add the hover-reveal CSS

**Files:**
- Modify: `public/css/style.css` (insert new rules immediately after the existing `.gc2-scrim-dim` block, which ends at the line containing `}` right before `.gc2-badge {`)

**Interfaces:**
- Consumes: the existing `.gc2-*` class names already rendered by `views/partials/game-card.ejs`, `views/buy.ejs`, and `views/partials/psplus-card.ejs` — no new classes are introduced, no template changes are needed.
- Produces: nothing consumed by a later task — this plan has one task.

- [ ] **Step 1: Locate the exact insertion point**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -n "^\.gc2-scrim-dim\b" -A 10 public/css/style.css
```

Confirm the block looks like this (current content, for reference — do not change it):

```css
.gc2-scrim-dim {
  background:
    linear-gradient(rgba(10,10,10,0.55), rgba(10,10,10,0.55)),
    linear-gradient(to bottom,
      transparent 20%,
      rgba(0,0,0,0.48) 44%,
      rgba(0,0,0,0.88) 72%,
      rgba(0,0,0,0.98) 100%);
}
```

Note the line number of its closing `}` — the new block goes immediately after it, before the `.gc2-badge {` rule that follows.

- [ ] **Step 2: Insert the hover-reveal block**

Insert the following CSS immediately after `.gc2-scrim-dim`'s closing `}` (before `.gc2-badge {`):

```css
@media (hover: hover) and (pointer: fine) {
  .gc2-card .gc2-scrim {
    background: linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.92) 100%);
  }
  .gc2-card:hover .gc2-scrim,
  .gc2-card:focus .gc2-scrim {
    background: linear-gradient(to bottom,
      transparent 20%,
      rgba(0,0,0,0.42) 44%,
      rgba(0,0,0,0.86) 72%,
      rgba(0,0,0,0.97) 100%);
  }
  .gc2-card .gc2-scrim-dim,
  .gc2-card:hover .gc2-scrim-dim,
  .gc2-card:focus .gc2-scrim-dim {
    background:
      linear-gradient(rgba(10,10,10,0.55), rgba(10,10,10,0.55)),
      linear-gradient(to bottom,
        transparent 20%,
        rgba(0,0,0,0.48) 44%,
        rgba(0,0,0,0.88) 72%,
        rgba(0,0,0,0.98) 100%);
  }

  .gc2-card .gc2-plat,
  .gc2-card .gc2-status,
  .gc2-card .gc2-buy-price,
  .gc2-card .gc2-bundle-note,
  .gc2-card .gc2-cta {
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 0.2s ease, transform 0.2s ease;
    pointer-events: none;
  }
  .gc2-card:hover .gc2-plat,
  .gc2-card:hover .gc2-status,
  .gc2-card:hover .gc2-buy-price,
  .gc2-card:hover .gc2-bundle-note,
  .gc2-card:hover .gc2-cta,
  .gc2-card:focus .gc2-plat,
  .gc2-card:focus .gc2-status,
  .gc2-card:focus .gc2-buy-price,
  .gc2-card:focus .gc2-bundle-note,
  .gc2-card:focus .gc2-cta {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
}

@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: reduce) {
  .gc2-card .gc2-plat,
  .gc2-card .gc2-status,
  .gc2-card .gc2-buy-price,
  .gc2-card .gc2-bundle-note,
  .gc2-card .gc2-cta {
    transition: none;
  }
}
```

- [ ] **Step 3: Verify no syntax errors and no unrelated rule was disturbed**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const css = require('fs').readFileSync('public/css/style.css', 'utf8');
const open = (css.match(/\{/g) || []).length;
const close = (css.match(/\}/g) || []).length;
console.log('braces balanced:', open === close, '(' + open + ' vs ' + close + ')');
console.log('has hover-reveal block:', css.includes('@media (hover: hover) and (pointer: fine)'));
console.log('has reduced-motion override:', css.includes('prefers-reduced-motion: reduce'));
"
```

Expected: `braces balanced: true`, both feature lines `true`.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add public/css/style.css
git commit -m "Add hover-reveal to game cards: title+price at rest, full details on hover/focus"
```

- [ ] **Step 5: Deploy**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git push origin main
for i in $(seq 1 15); do
  body=$(curl -s "https://playstation-hub.com/browse")
  if echo "$body" | grep -q "hover: hover"; then echo "attempt $i: new build live"; break; fi
  echo "attempt $i: still old"; sleep 15
done
```

- [ ] **Step 6: Verify on desktop with the Browser tool**

Navigate to `https://playstation-hub.com/browse` at a desktop viewport (mouse-capable).

1. At rest, a card shows only the title and "from ₱X" (plus any corner badge). Platform line, slot chips, buy price, and the CTA pill are not visible.
2. Hovering a card: the card lifts (existing `translateY(-4px)` behavior, unchanged), the scrim visibly deepens, and platform/slots/buy-price/CTA slide up and fade in over roughly 200ms.
3. Moving the mouse away returns the card to the rest state.
4. Tab-focus a card via keyboard: the same reveal appears (confirms `:focus`, not just `:hover`).
5. Check computed styles during the transition (e.g. via `getComputedStyle`) confirm only `opacity` and `transform` are animating — no `height`/`padding`/`margin` transition.

- [ ] **Step 7: Verify the PS Plus card and the Buy card**

1. On `/` or `/ps-plus`, a "Most Played" card shows title + "Via PS Plus" at rest (not hidden — `.gc2-psplus-note` was never added to the hidden list), and reveals the platform/genre line plus the CTA on hover. The rank badge (`#1`, `#2`, ...) stays visible at all times.
2. On `/buy`, a single-game buy card shows title + "from ₱X" at rest and reveals platform/genre plus the Buy CTA on hover. A "Set up on order" badge (if present) stays visible at all times, in both states.

- [ ] **Step 8: Verify an unavailable/rented card stays dark**

Find a card in the "Rented" state (full scrim via `.gc2-scrim-dim`). Confirm it looks the same — fully dark, muted title — both at rest and on hover; it does not lighten at rest the way a normal card does.

- [ ] **Step 9: Verify mobile is completely unaffected**

Resize to a mobile viewport (or use the Browser tool's mobile emulation). Confirm every card shows full details at rest — platform, slot chips, price, buy price, CTA all visible with no hover needed — identical to the card's appearance before this change. Tapping a card still navigates directly to the game page.

- [ ] **Step 10: Verify reduced motion**

Emulate `prefers-reduced-motion: reduce` (Browser tool or OS-level setting) and confirm hovering a card still reveals/hides its details, just without the animated slide — an instant show/hide.

- [ ] **Step 11: Check console and report**

Confirm zero console errors across all of the above. Report the feature live, noting all three card types (rent, buy, PS Plus) were verified, plus the rented-card and reduced-motion edge cases.
