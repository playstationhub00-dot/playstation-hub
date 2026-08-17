# Game Card Text Legibility — Design

**Date:** 2026-08-17
**Status:** Approved

## The problem

Every game card renders its text over the cover art: a platform/genre line, the
title, a price line, and a Rent/Buy pill, all stacked at the bottom of the image.

A gradient scrim already exists (`.gc2-scrim`) to darken that area, but it starts
too low and ramps too late — transparent until 38% down the card, and only
reaching 0.95 opacity at the very bottom edge. Text sitting in the middle of that
band lands on art that is still near full brightness.

On covers with a dark lower third this is invisible. On covers with a bright one —
`007 First Light`, whose art is gold and near-white at the bottom — white text on
pale gold is genuinely hard to read.

## What changes

A CSS-only change. Four rules in `public/css/style.css`, no template edits.

### 1. Deepen the scrim

`.gc2-scrim` moves its ramp up and forward so the text band sits on a dark bed:

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

The four stops are deliberate: the art stays fully clear through the top fifth,
darkening is gradual rather than a visible hard edge, and full darkness arrives at
72% — above where the text starts — rather than at the bottom edge.

### 2. Match the dim variant

`.gc2-scrim-dim` is the fully-booked state: a flat dim layered over the same
gradient. Its gradient layer takes the same stops, so available and unavailable
cards do not drift apart visually.

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

The slightly higher values match the existing rule's pattern, where the dim
variant already ran marginally darker than the base.

### 3. Add a text shadow

`.gc2-body` gains a two-layer shadow, inherited by every text element inside it —
platform line, title, price, status, bundle note:

```css
text-shadow: 0 1px 3px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.6);
```

The tight layer gives glyph edges definition against light pixels; the soft layer
adds a halo that lifts text off busy art. Together they cover the case a scrim
cannot reach without dimming the whole cover: a cover so bright that even a heavy
gradient leaves low contrast.

### 4. Reset it on the solid CTA pill, restore it on the outlined one

`.gc2-cta` is dark text (`#12081f`) on a solid white pill. An inherited dark shadow
smudges it, so it opts out:

```css
.gc2-cta { text-shadow: none; }
```

`.gc2-cta-reserve` is a different case. It carries both classes on one element
(`class="gc2-cta gc2-cta-reserve"`) but overrides the background to transparent,
leaving purple text sitting directly over the cover art — exactly the situation the
shadow exists for. Inheriting the reset would make it *less* readable, so it takes
the shadow back:

```css
.gc2-cta-reserve { text-shadow: 0 1px 3px rgba(0,0,0,0.9); }
```

Only the tight layer, not the soft halo — the pill already has a border defining its
edge, and the halo would bleed past it.

## Scope

All four card surfaces share these class names, so one CSS change covers them:

- `/browse` — via `views/partials/game-card.ejs`
- Homepage sliders — same partial
- PS Plus pages — same partial
- `/buy` — markup inlined in `views/buy.ejs`, same `.gc2-card` / `.gc2-scrim` /
  `.gc2-body` / `.gc2-cta` classes

## What deliberately does not change

- **No template edits.** No `.ejs` file is touched.
- **Badges.** `.gc2-badge-last` / `-rented` / `-new` sit at the card top with their
  own solid backgrounds; they are unaffected and need no shadow.
- **Layout, spacing, type sizes, colors.** Only the scrim gradient and text-shadow.
- **The cover images themselves.** No cropping, focal point, or asset changes.
- **`.gc2-bundle-note` and `.gc2-buy-price`.** They live inside `.gc2-body` and
  inherit the shadow automatically; no per-element rules.

## Out of scope

- A blurred backdrop panel behind the text block. Considered and rejected —
  `backdrop-filter` is costly on long scrolling grids and changes the card's look
  more than the problem warrants.
- Per-cover adaptive scrims (sampling image brightness). Far more machinery than a
  legibility fix needs.
- The bundle page's `.bundle-game-tile` grid, whose titles sit below the cover on a
  solid background rather than over the art.
