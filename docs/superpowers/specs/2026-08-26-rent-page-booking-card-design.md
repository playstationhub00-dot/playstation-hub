# Rent Page Booking Card (Phase 2) — Design

**Date:** 2026-08-26
**Status:** Approved

Wrap the rent page's booking column in a contained card and compact the
rental-type rows into side-by-side pills, matching the reservation page —
without changing what a customer pays or how an order is submitted.

## Guiding constraint

This page takes money. The order-summary math (`updateTotal`, `totalRows`),
the order form, the price header, and the buy panel are **not touched**. The
change is presentation plus one narrowly-scoped setup-panel mechanism.

Crucially, the JS contract for type selection is preserved rather than
rewritten. `onTypeChange(radio)` reads `radio.value`, clears
`.gd-type-selected` from every `.gd-type-card`, and re-applies it to
`#label-<type>`. The new pills keep all three of those: the same radio
`name="rentalType"` and `value`, the same `.gd-type-card` class, and the same
`#label-tr` / `#label-nt` / `#label-ps4` ids. `onTypeChange` therefore keeps
working with a single added line.

## The change

**A contained booking card.** The rent and buy panels plus the mode toggle sit
inside a new `.gdh-card` container styled like the reservation page's
`.rsv-card` — dark surface, hairline border, 14px radius. The page keeps its
existing two-column shape; only the right column gains the card.

**Type rows become pills.** Each rental type renders as a compact pill
carrying its icon, name, slots-left, and status, laid out side by side and
wrapping when there are three. The pill keeps every JS hook listed above and
adds a `.gd-type-pill` class for styling. `.gd-type-pill` is scoped so it
cannot leak onto the buy panel's cards, which also carry `.gd-type-card`.

**Setup guides consolidate into one expander.** Today each type embeds its own
always-present accordion with a chevron. These move into a single
`#typeSetupWrap` below the pills, holding the same three `#setup-tr` /
`#setup-nt` / `#setup-ps4` blocks with their existing copy intact — Trophy's
"enable console sharing", Non-Trophy's "leave disabled", PS4's "activate
primary", plus each type's next-available and not-stocked notes. Only the
selected type's block is displayed, so no information is lost; it is revealed
on selection instead of being three separate permanent accordions.

Two JS changes support this, and only these two:

- `toggleTypeSetup(id)` is replaced by `toggleSetupPanel()`, which opens and
  closes the single shared wrapper. The old function's reliance on
  `panel.previousElementSibling.querySelector('.gd-type-chev')` disappears
  along with the per-card chevrons.
- `onTypeChange` gains one call, `syncSetupPanel()`, which shows the selected
  type's block and hides the other two. Every existing line in that function
  is unchanged.

## Out of scope

- No change to `updateTotal`, `updatePrices`, `totalRows`, the order summary,
  or any price or deposit calculation.
- No change to the order form, its fields, `POST /order/create`, the
  reservation/waitlist blocks, or the Messenger fallback.
- No change to the buy panel, the rent/buy toggle logic, the price header, the
  gallery slider, or the Phase 1 banner.
- No change to `views/upcoming-detail.ejs` or `views/psplus-rent.ejs`.

## Verification

Live on `https://playstation-hub.com/game/<slug>` after deploy:

- The booking column renders as one contained card.
- The type pills render side by side; selecting one highlights it and updates
  the price, exactly as before.
- The setup expander shows the selected type's instructions, and switching
  type swaps the content — Trophy shows console-sharing, Non-Trophy shows
  "leave disabled".
- On a game with a PS4 type, all three pills render and select correctly.
- Duration selection, the order summary total, and the deposit line are
  numerically identical to before the change for the same selections.
- The order form still submits, and the CTA enable/disable behaviour is
  unchanged.
- The rent/buy toggle still switches panels, and the buy panel's own cards are
  visually unaffected by the pill styling.
- A fully-rented game still shows the priority reservation and waitlist block.
- No console errors.
