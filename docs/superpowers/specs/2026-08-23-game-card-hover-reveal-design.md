# Game Card Hover-Reveal — Design

**Date:** 2026-08-23
**Status:** Approved

Let the cover art breathe. At rest a card shows only its title and starting
price; hovering lifts the card and slides the full details up over the artwork.
On touch devices — where there is no hover and a tap opens the game — the card
keeps showing everything, exactly as it does today.

## The problem

Every card permanently stacks six things over the cover: platform·genre, title,
two slot chips, rent price, buy price, and the CTA button. A dark scrim covers
roughly two-thirds of the artwork at all times to keep that text readable. The
cover — the single most persuasive thing on the card — is mostly hidden behind
its own metadata, on every card, always.

## The interaction

**Desktop (hover-capable pointer):**

- **At rest:** title and "from ₱X" only, near the bottom. A lighter, shorter
  scrim. The platform line, slot chips, buy price, and CTA are present but
  hidden. The corner badges (New / Last slot / Rented) stay visible — they are
  state signals, not details, and they sit in the top corners clear of the
  title.
- **On hover or keyboard focus:** the card lifts and gains the amber glow it
  already has today; the scrim deepens; and the hidden details slide up a few
  pixels while fading in (~200 ms). Price stays put throughout — it is visible
  in both states, so it never jumps.

**Touch (no hover):** the reveal is a desktop-only enhancement. On touch the
card renders every detail at rest, identical to the current card. This is
deliberate and load-bearing: most traffic is mobile, a tap already opens the
game, and hiding price or availability behind a gesture phones don't have would
add friction for the majority of buyers. No new tap gesture is introduced.

Keyboard users get the same reveal as hover, via focus — the card is a link, so
tabbing to it must show what a mouse hover shows.

## Why price is never hidden

Price is the primary decision factor when scanning a grid. Hiding it entirely —
even on desktop, even behind a fast hover — forces a hover-every-card comparison
just to find something affordable. Title plus starting price is the resting
floor; everything else is what the hover adds.

## How it's built: CSS only, no new markup

The card already renders every element into the DOM. Revealing is purely a
matter of which elements are visible in which state, so this is a CSS change
against the existing `gc2-*` classes — no template change, no server change, no
JavaScript.

Two consequences worth stating up front:

- **It applies to every card that uses the shared `gc2-*` classes** — the rent
  cards (`views/partials/game-card.ejs` on `/browse` and the homepage), the buy
  cards (`views/buy.ejs`), and the PS Plus cards (`views/partials/psplus-card.ejs`)
  all share this markup. One CSS change reaches all of them, which is what "all
  game cards" asks for. The build must verify each still reads correctly at rest
  (the PS Plus card shows a "Via PS Plus" note where a rent card shows price —
  that note must be in the resting set, not the hidden set).
- **The reveal must not animate layout properties.** Animating `height`,
  `max-height`, `padding`, or `margin` causes layout thrash (the project's own
  design tooling flags exactly this). The hidden→shown transition uses `opacity`
  and `transform` — and, where a genuine height change is needed, the
  `grid-template-rows: 0fr → 1fr` technique — never an animated box dimension.

The hide-at-rest behaviour is scoped with `@media (hover: hover) and
(pointer: fine)`. On any device outside that query — touch — the rule simply
does not apply, so the card falls back to fully-visible with no extra code.

## Scope

- `public/css/style.css` — the only file changed. New rules on `.gc2-*` for the
  resting/hover states plus the hover-capability media query.

## Out of scope

- No change to card markup, card data, or any route.
- No change to what a click does — cards still navigate to the game page.
- The corner badges, the cover image, focal-point cropping, and the grid layout
  are untouched.
- No per-page variation — the same reveal applies wherever a `gc2-card` renders.

## Verification

Live on `https://playstation-hub.com` after deploy:

- **Desktop `/browse` and homepage:** at rest a card shows title + "from ₱X"
  only; hovering reveals platform, slot chips, buy price, and the Rent/Reserve
  button with a slide-up-and-fade; the card lifts and glows as before.
- **Keyboard:** tabbing to a card reveals the same details as hover.
- **Buy page:** buy cards reveal correctly; the "Set up on order" state and buy
  price still make sense at rest.
- **PS Plus cards:** the "Via PS Plus" line is visible at rest (not hidden with
  the details), and the rank badge stays put.
- **Mobile (≤ a touch viewport):** every card shows full details at rest,
  matching the current design; one tap opens the game; no reveal gesture exists.
- Reduced-motion preference (`prefers-reduced-motion`) drops the slide/fade to
  an instant show, so the reveal never forces motion on someone who opted out.
- No console errors; no layout shift or jank while hovering across a full grid.
