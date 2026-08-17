# Game Card Text Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep game card text readable over bright cover art by deepening the existing scrim gradient and adding a text shadow, with no template changes.

**Architecture:** CSS-only change to four existing rules in `public/css/style.css`. The card markup (`views/partials/game-card.ejs`, `views/buy.ejs`) already shares the `.gc2-card` / `.gc2-scrim` / `.gc2-body` / `.gc2-cta` class names, so one file change reaches every card surface: browse, homepage sliders, PS Plus, and buy.

**Tech Stack:** Plain CSS, no build step. EJS templates are untouched, so no compile check is needed beyond the existing server syntax check.

## Global Constraints

- No template (`.ejs`) file changes — this is CSS-only, per the spec's "What changes" section.
- No layout, spacing, type size, or color changes beyond the four rules named below.
- No changes to `.gc2-badge-*`, `.gc2-bundle-note`, `.gc2-buy-price`, cover images, or any other card element.
- No `backdrop-filter` or adaptive/per-image scrims — explicitly out of scope per the spec.

---

### Task 1: Deepen scrim and add text shadow

**Files:**
- Modify: `public/css/style.css:2199-2200` (`.gc2-scrim`, `.gc2-scrim-dim`)
- Modify: `public/css/style.css:2209` (`.gc2-body`)
- Modify: `public/css/style.css:2241-2245` (`.gc2-cta`, `.gc2-cta-reserve`)

**Interfaces:**
- Consumes: nothing — this is a leaf CSS change with no JS or template dependency.
- Produces: nothing new is consumed elsewhere. No class names change; only existing rule bodies are edited, so `views/partials/game-card.ejs` and `views/buy.ejs` pick up the new appearance automatically with zero edits to either file.

- [ ] **Step 1: Replace `.gc2-scrim`**

Current (`public/css/style.css:2199`):

```css
.gc2-scrim { position: absolute; inset: 0; background: linear-gradient(to bottom, transparent 38%, rgba(0,0,0,0.62) 60%, rgba(0,0,0,0.95) 100%); }
```

Replace with:

```css
.gc2-scrim {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom,
    transparent 20%,
    rgba(0,0,0,0.42) 44%,
    rgba(0,0,0,0.86) 72%,
    rgba(0,0,0,0.97) 100%);
}
```

- [ ] **Step 2: Replace `.gc2-scrim-dim`**

Current (`public/css/style.css:2200`):

```css
.gc2-scrim-dim { background: linear-gradient(rgba(10,10,10,0.55), rgba(10,10,10,0.55)), linear-gradient(to bottom, transparent 38%, rgba(0,0,0,0.68) 60%, rgba(0,0,0,0.96) 100%); }
```

Replace with:

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

- [ ] **Step 3: Add text shadow to `.gc2-body`**

Current (`public/css/style.css:2209`):

```css
.gc2-body { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; padding: 0.85rem; display: flex; flex-direction: column; gap: 0.3rem; }
```

Replace with:

```css
.gc2-body {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; padding: 0.85rem;
  display: flex; flex-direction: column; gap: 0.3rem;
  text-shadow: 0 1px 3px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.6);
}
```

- [ ] **Step 4: Reset the shadow on the solid CTA pill, restore a tight one on the outlined variant**

Current (`public/css/style.css:2241-2245`):

```css
.gc2-cta {
  background: #fff; color: #12081f; font-size: 0.72rem; font-weight: 800; padding: 0.4rem 0.8rem;
  border-radius: 20px; white-space: nowrap; flex-shrink: 0;
}
.gc2-cta-reserve { background: transparent; color: #a78bfa; border: 1px solid #4a2a8a; }
```

Replace with:

```css
.gc2-cta {
  background: #fff; color: #12081f; font-size: 0.72rem; font-weight: 800; padding: 0.4rem 0.8rem;
  border-radius: 20px; white-space: nowrap; flex-shrink: 0;
  text-shadow: none;
}
.gc2-cta-reserve { background: transparent; color: #a78bfa; border: 1px solid #4a2a8a; text-shadow: 0 1px 3px rgba(0,0,0,0.9); }
```

- [ ] **Step 5: Verify no other CSS rule sets `text-shadow` on these selectors elsewhere in the file**

Run:

```bash
grep -n "gc2-scrim\|gc2-body\|gc2-cta" public/css/style.css
```

Expected: only the rules edited above (and any unrelated `.gc2-cta-*` variants like `.gc2-cta-reserve` you did not touch) — no duplicate `.gc2-scrim` or `.gc2-body` block elsewhere in the file that would silently override these changes via later cascade order.

- [ ] **Step 6: Commit**

```bash
git add public/css/style.css
git commit -m "Deepen card scrim and add text shadow for legibility over bright covers"
```

- [ ] **Step 7: Deploy and verify live**

```bash
git push origin main
```

Poll until the deploy has rolled over (the CSS is versioned via `assetV`, so no manual cache-busting is needed):

```bash
for i in 1 2 3 4 5 6; do curl -s "https://playstation-hub.com/css/style.css?v=live" | grep -q "rgba(0,0,0,0.86) 72%" && echo "FOUND at attempt $i" && break; echo "attempt $i: not yet"; sleep 15; done
```

Then, using the Browser tool:
1. Navigate to `https://playstation-hub.com/browse`.
2. Find a card with bright cover art low-contrast text was reported on (e.g. `007 First Light`, if still listed) or any card near the bottom of a light-colored cover.
3. Zoom/screenshot the card and confirm the platform line, title, price, and CTA are all legible against the art.
4. Confirm the solid white Rent/Buy pill text has no visible shadow smudge.
5. Find or simulate a "Reserve" (fully-booked) card and confirm its text remains legible — this exercises `.gc2-scrim-dim` and `.gc2-cta-reserve`.
6. Spot-check the homepage (`/`) sliders and one bundle card on `/buy` for the same treatment, confirming the shared class names carried the change through without any template edits.
