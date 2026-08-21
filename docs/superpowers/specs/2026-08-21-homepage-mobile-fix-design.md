# Homepage Mobile Fix — Design

**Date:** 2026-08-21
**Status:** Approved

Option A of three presented ("fix and tighten"). B (consolidate the four game
sections behind filter chips) and C (search-first rebuild) were considered and
declined — see the end of this document.

## Measured before designing

Live site, 2026-08-21:

| Metric | Mobile (390×844) | Desktop (1440×900) |
|---|---|---|
| Page height | 7,566px — **9.0 screens** | 5,176px — 5.8 screens |
| Hero | **Hidden** | Visible, 574px |
| New Releases | 1,385px | 404px |
| Most Popular | 1,385px | 404px |
| Why Rent From Us | 861px | 277px |
| Tap targets under 40px | 16 | n/a |
| Horizontal overflow | None | None |

New Releases and Most Popular together are 2,770px — **37% of the mobile page** —
because each renders all 10 games as a five-row two-column grid.

## The hero is hidden on mobile

`views/index.ejs` renders `<section class="hero hero-v2">`. This rule hides it:

```css
@media (max-width: 600px) {
  .home-page .hero, .home-page #heroSlideshow { display: none; }
}
```

Mobile visitors therefore never see the headline, the ₱199 starting price, the
55+ games and 23+ active renters figures, the GCash / Maya / QR Ph / Bank Transfer
badges, or either call to action. They land directly on a grid of game covers with
no stated value proposition.

### This was deliberate, and the reason no longer holds

An initial reading called this an accidental class collision. That was wrong, and
the correction is recorded here rather than quietly dropped. A comment sits directly
above the rule:

> nav (with search) is the new top of page, straight into Most Popular below it.

So the hero was hidden on purpose, on the theory that the nav's search box would
serve as the page's entry point instead.

Checked against the live page at 390px width, **the nav search is not visible**. Its
elements — `.navsearch`, `.navsearch-box`, and the `input` — all compute to `width: 0,
height: 0`; the search is collapsed behind an icon at mobile widths. The premise the
decision rested on is not true on the devices it applies to.

The owner separately confirmed they were not aware the hero was hidden.

## What changes

### 1. Restore the hero on mobile

Narrow the rule so it hides only the legacy slideshow, which is a genuinely separate
element (`<section class="hero-slideshow" id="heroSlideshow">`) and remains
intentionally hidden on mobile:

```css
@media (max-width: 600px) {
  .home-page #heroSlideshow { display: none; }
}
```

Dropping `.home-page .hero` from the selector list is the entire change. The existing
mobile hero styling at the 720px and 480px breakpoints (`public/css/style.css:443-461`)
already handles compaction — it was written for this element and has simply never
applied, because the element was hidden before those rules could matter.

### 2. Cap mobile game grids at four

On mobile the New Releases and Most Popular sliders become two-column grids that
render every game. Limit them to the first four, with the existing "View All" link
carrying the rest.

Four is two rows: enough to show what the catalogue looks like without either
section dominating the page. This removes roughly 2,000px.

The cap is mobile-only. Desktop keeps its horizontal slider showing all ten.

### 3. Enlarge small tap targets

Sixteen interactive elements render under 40px tall on mobile. Raise them to a 44px
minimum touch target, the standard both iOS and Android guidelines use.

## What deliberately does not change

- **The four game sections stay separate.** New Releases, Most Popular, Coming Soon,
  and Most Played in PS Plus look repetitive in an audit, but each answers a
  different question. Merging them behind filter chips assumes customers browse by
  filter rather than by scanning, and there is no evidence for that here.
- **Section order.** Untouched.
- **Desktop layout.** Only the tap-target minimum affects both; the hero fix and the
  four-game cap are mobile-only.
- **The legacy `#heroSlideshow`**, which stays hidden on mobile.
- **Pricing, availability, and every route.** This is presentation only.

## Out of scope

- Option B: consolidating the four game sections into one filtered module.
- Option C: search-first hero rebuild, unified catalogue, sticky mobile CTA bar.
- Making the nav search visible on mobile. It is currently collapsed behind an icon;
  whether that is right is a separate question from whether the hero should exist.
- The "Why Rent From Us" section being 861px on mobile against 277px on desktop. It
  is worth revisiting, but it is a layout redesign rather than a fix, and this spec
  stays on provable defects.
