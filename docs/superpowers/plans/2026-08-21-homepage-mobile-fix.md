# Homepage Mobile Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the hero on mobile, roughly halve the mobile page length, and make small controls reliably tappable.

**Architecture:** Three edits, all in `public/css/style.css`, all inside or adjacent to the existing `@media (max-width: 600px)` block. No template, route, or JavaScript changes.

**Tech Stack:** Plain CSS. No build step — `public/css/style.css` is served directly, cache-busted by `assetV`.

## Global Constraints

- All three changes are mobile-only except the tap-target minimum, which is scoped inside a mobile media query anyway.
- Do not unhide `#heroSlideshow`. That legacy slideshow (`views/index.ejs:19`) stays hidden on mobile deliberately.
- Do not change section order, pricing, availability, routes, or any template.
- The four game sections stay separate — no consolidation, per the spec's "what deliberately does not change".
- Every measurement claimed as "after" must be taken from the live site, not asserted.

## Baseline (measured live, 2026-08-21, 390×844)

Re-measure these after deploying to confirm the change did what it claims:

| Metric | Before |
|---|---|
| Page height | 7,566px (9.0 screens) |
| Hero visible | No (`display: none`) |
| New Releases section | 1,385px |
| Most Popular section | 1,385px |
| Tap targets under 40px | 16 |
| Horizontal overflow | None |

---

### Task 1: Restore the hero on mobile

Two rules in the same media block currently contradict each other: line 1222 gives
`.home-page .hero` an explicit `order: 10` (placing it first in the mobile flex
order), while line 570 hides it outright. This task resolves that in favour of
showing it.

**Files:**
- Modify: `public/css/style.css:569-571`

**Interfaces:**
- Consumes: nothing.
- Produces: `.hero-v2` becomes visible below 600px. The existing mobile hero styling at `public/css/style.css:443-461` (720px and 480px breakpoints) begins applying for the first time — it was written for this element but has never taken effect because the element was hidden.

- [ ] **Step 1: Narrow the hiding rule**

Find this block (currently `public/css/style.css:569-571`):

```css
@media (max-width: 600px) {
  .home-page .hero, .home-page #heroSlideshow { display: none; }
}
```

Replace with:

```css
@media (max-width: 600px) {
  /* Only the legacy slideshow hides on mobile. .hero-v2 also carries .hero, so
     listing .hero here hid the entire value proposition — headline, ₱199 price,
     stats, payment badges, and both CTAs — from every phone visitor. The mobile
     hero styling at the 720px/480px breakpoints was written for it and only now
     starts applying. See .home-page .hero { order: 10 } below, which always
     intended the hero to sit first on mobile. */
  .home-page #heroSlideshow { display: none; }
}
```

- [ ] **Step 2: Confirm the legacy slideshow is still hidden and the hero is not**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && sed -n '569,578p' public/css/style.css
```

Expected: the block contains `.home-page #heroSlideshow { display: none; }` and **no** `.home-page .hero` in that selector list.

---

### Task 2: Cap mobile game grids at four

On mobile, `#newReleasesSection` and `#mostPopularSection` turn their sliders into
two-column grids that render every game — ten cards, five rows, 1,385px each.

**Files:**
- Modify: `public/css/style.css` — add a rule inside the existing `@media (max-width: 600px)` block that starts at line 1194

**Interfaces:**
- Consumes: the grid layout defined at `public/css/style.css:1250-1254`.
- Produces: only the first four `.slider-card-wrap` children render in those two sections on mobile. Desktop is untouched.

- [ ] **Step 1: Add the cap**

Find this rule (currently `public/css/style.css:1250-1254`):

```css
  #mostPopularSection .upcoming-slider,
  #newReleasesSection .upcoming-slider {
    display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem;
    overflow: visible; padding: 0;
  }
```

Immediately after it, add:

```css
  /* Two rows is enough to show what the catalogue looks like. Rendering all ten
     made each of these sections 1,385px — together 37% of the mobile page. The
     rest stay one tap away behind the section's existing "View All" link. */
  #mostPopularSection .slider-card-wrap:nth-child(n+5),
  #newReleasesSection .slider-card-wrap:nth-child(n+5) { display: none; }
```

`.slider-card-wrap` is the correct target rather than `.game-card`: the wrapper is
the direct grid child (confirmed earlier this session when a width mismatch between
wrapper and card caused an overlap bug), so hiding the card alone would leave an
empty grid cell behind.

- [ ] **Step 2: Verify the selector matches the real DOM structure**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && grep -n 'slider-card-wrap' views/index.ejs | head -3
```

Expected: three lines showing `<div class="slider-card-wrap" ...>` wrapping each card in the New Releases, Most Popular, and PS Plus sliders. This confirms `.slider-card-wrap` is the grid child being capped.

---

### Task 3: Enlarge small tap targets

Sixteen controls render under 40px tall on mobile. They are not one homogeneous
group, and a blanket `min-height: 44px` would be wrong for some — so they are
handled by kind.

Measured breakdown:

| Selector | Count | Height | Kind |
|---|---|---|---|
| `a.(unclassed)` in footer | 7 | 18px | Text links, 10–11px apart |
| `a.section-viewall` | 2 | 31px | "View All" |
| `button.section-toggle-btn` | 2 | 28px | "▾" collapse toggles |
| `a.social-icon` | 2 | 38px | Footer social icons |
| `button.navicon-btn` | 1 | 36px | Nav icon |
| `a.spotlight-link` | 1 | 36px | "Visit PS Plus website" |
| `a.logo` | 1 | 36px | Nav logo |

**Files:**
- Modify: `public/css/style.css` — add rules inside the existing `@media (max-width: 600px)` block that starts at line 1194

**Interfaces:**
- Consumes: nothing.
- Produces: no new classes. Only padding and `min-height` on existing selectors.

- [ ] **Step 1: Add the tap-target rules**

Inside the `@media (max-width: 600px)` block (append near its end, before the
closing brace), add:

```css
  /* Touch targets. iOS and Android both guide a 44px minimum. Controls get
     min-height; footer text links get vertical padding instead, so the tap area
     grows without changing the type size. */
  .navicon-btn,
  .section-toggle-btn,
  .section-viewall,
  .social-icon,
  .spotlight-link {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  footer .footer-links a,
  footer .footer-col a {
    display: inline-block;
    padding: 0.65rem 0;
    line-height: 1.2;
  }
```

- [ ] **Step 2: Confirm the footer link selectors exist**

The footer rule targets classes that must actually be present, or it silently does
nothing.

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && grep -oE 'class="[^"]*footer[^"]*"' views/partials/footer.ejs | sort -u
```

Expected: a list including a links container class. If neither `.footer-links` nor
`.footer-col` appears, substitute the actual container class found here into the
rule from Step 1 before continuing — do not leave a selector that matches nothing.

---

### Task 4: Deploy and verify against the baseline

**Files:** none — verification only.

- [ ] **Step 1: Check the stylesheet parses**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -e "
const css = require('fs').readFileSync('public/css/style.css','utf8');
const o = (css.match(/\{/g)||[]).length, c = (css.match(/\}/g)||[]).length;
if (o !== c) { console.error('BRACE MISMATCH: ' + o + ' open vs ' + c + ' close'); process.exit(1); }
console.log('OK: braces balanced (' + o + ')');
"
```

Expected: `OK: braces balanced (N)`. A mismatch means a rule was inserted outside or across a media-query boundary.

- [ ] **Step 2: Commit and deploy**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add public/css/style.css
git commit -m "Restore mobile hero, cap mobile game grids at four, enlarge tap targets"
git push origin main
```

- [ ] **Step 3: Wait for rollover**

```bash
for i in $(seq 1 12); do
  curl -s "https://playstation-hub.com/css/style.css" | grep -q "nth-child(n+5)" && echo "css live (attempt $i)" && break
  echo "attempt $i"; sleep 20
done
```

A Railway deploy can briefly 502 mid-rollover, and `/` may return 200 from the old
instance — polling the stylesheet for the new selector is the reliable signal.

- [ ] **Step 4: Re-measure on mobile and compare to the baseline**

Using the Browser tool: resize to 390×844, navigate to `https://playstation-hub.com/`,
then evaluate:

```js
() => {
  const hero = document.querySelector('.hero-v2');
  const sec = id => { const e = document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().height) : null; };
  const smallTargets = [...document.querySelectorAll('a,button')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.height < 40;
  }).length;
  const visibleCards = id => [...document.querySelectorAll('#' + id + ' .slider-card-wrap')]
    .filter(w => getComputedStyle(w).display !== 'none').length;
  return JSON.stringify({
    pageHeight: Math.round(document.body.scrollHeight),
    screens: (document.body.scrollHeight / window.innerHeight).toFixed(1),
    heroVisible: hero ? getComputedStyle(hero).display !== 'none' : false,
    heroHeight: hero ? Math.round(hero.getBoundingClientRect().height) : 0,
    newReleasesHeight: sec('newReleasesSection'),
    mostPopularHeight: sec('mostPopularSection'),
    newReleasesVisibleCards: visibleCards('newReleasesSection'),
    mostPopularVisibleCards: visibleCards('mostPopularSection'),
    tapTargetsUnder40: smallTargets,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
  }, null, 1);
}
```

Expected against the baseline:

| Metric | Before | Expected after |
|---|---|---|
| `heroVisible` | false | **true** |
| `newReleasesVisibleCards` | 10 | **4** |
| `mostPopularVisibleCards` | 10 | **4** |
| `newReleasesHeight` | 1,385px | roughly 600px |
| `mostPopularHeight` | 1,385px | roughly 600px |
| `pageHeight` | 7,566px | roughly 5,000–5,600px |
| `tapTargetsUnder40` | 16 | **0**, or only `a.logo` |
| `horizontalOverflow` | false | **false** (must not regress) |

If `tapTargetsUnder40` is above zero, print which elements remain and decide per
element whether it is a genuine miss or an acceptable exception — do not force the
number to zero by inflating something that should not grow.

- [ ] **Step 5: Confirm the hero renders correctly, not just visibly**

Still at 390×844, check the hero's contents actually fit and read well:

```js
() => {
  const h = document.querySelector('.hero-v2');
  return JSON.stringify({
    height: Math.round(h.getBoundingClientRect().height),
    headline: h.querySelector('h1')?.textContent.trim().replace(/\s+/g,' '),
    ctas: [...h.querySelectorAll('.hero-actions a')].map(a => ({ text: a.textContent.trim(), h: Math.round(a.getBoundingClientRect().height) })),
    statsVisible: !!h.querySelector('.hero-stats') && getComputedStyle(h.querySelector('.hero-stats')).display !== 'none',
    payVisible: !!h.querySelector('.hero-pay-methods') && getComputedStyle(h.querySelector('.hero-pay-methods')).display !== 'none',
    overflowsViewport: h.getBoundingClientRect().height > window.innerHeight
  }, null, 1);
}
```

Expected: headline present, CTAs present and at least 44px tall, and
`overflowsViewport` false — the hero should introduce the page without filling the
whole screen. Note that `.hero-actions` is hidden at 480px and below by an existing
rule (`public/css/style.css:551`); if the CTAs are missing at 390px, that rule is the
cause. Report it rather than silently changing it, since it is a separate deliberate
decision from the one this plan reverses.

- [ ] **Step 6: Confirm desktop did not regress**

Resize to 1440×900, reload, and evaluate:

```js
() => {
  const vis = id => [...document.querySelectorAll('#' + id + ' .slider-card-wrap')]
    .filter(w => getComputedStyle(w).display !== 'none').length;
  return JSON.stringify({
    pageHeight: Math.round(document.body.scrollHeight),
    newReleasesCards: vis('newReleasesSection'),
    mostPopularCards: vis('mostPopularSection'),
    heroVisible: getComputedStyle(document.querySelector('.hero-v2')).display !== 'none'
  }, null, 1);
}
```

Expected: both card counts back to **10**, hero visible, page height near the 5,176px
baseline. The four-card cap must not leak past 600px.
