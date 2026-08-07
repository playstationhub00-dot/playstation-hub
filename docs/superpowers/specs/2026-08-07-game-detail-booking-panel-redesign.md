# Game detail booking panel redesign

Date: 2026-08-07
Status: Approved

## Problem

The rent panel on the game detail page (`views/game-detail.ejs`, `.gd-*` classes
in `public/css/style.css`) is 622px tall on a 375px mobile viewport, pushing the
whole right column to 866px — taller than the 812px viewport before any content
below it is reachable. Two measured causes:

- The three account-type cards (`.gd-type-card`) are ~85px each, and roughly
  half of each card's height (150px of 302px total) is the post-booking setup
  text ("Settings → Account → Other → Console Sharing → Enable"), which a
  customer doesn't need while deciding, only after.
- The order summary (`#totalBox`) is `display:none` until both an account type
  and a duration are picked, so price is invisible for the first two decisions
  and the layout jumps when it finally appears.

## Approach

Direction A from three proposed layouts (sticky bar, guided stepper,
price-first dense) — chosen because the page's conversion event is a Messenger
click, not a checkout, so the CTA needs to be reachable at all times rather
than gated behind steps (rejects the stepper) or crammed three-wide at mobile
width (rejects the dense layout).

An interactive HTML preview was built and approved before writing this spec —
see the artifact linked in this session, or reference the structure described
below, which mirrors it exactly.

## Structure

Right column, top to bottom (unchanged pieces marked *as today*):

1. Genre tags + release date — *as today*
2. Title, description, external link — *as today*
3. Rent / Buy Permanent toggle — *as today's behavior*, promoted from inline
   `style="..."` attributes to a `.gd-mode-toggle` class pair so the redesign
   doesn't leave one inline-styled block sitting next to newly-classed ones.
4. **New: price header.** A single row above the type selector:
   `From ₱379` before any selection (the lowest live price across every
   available type × duration combination, computed the same way the game
   card's "Starts at" figure already is — reuse `gcAllPricePairs`'s logic
   rather than re-deriving it). Once a type and duration are both picked, it
   becomes `Weekly · trophy` / `₱499 ₱474` with a `Save ₱25` chip, matching the
   order summary's numbers exactly (same source values, no independent calc).
5. **Changed: account type rows.** Each `.gd-type-card` collapses from ~85px to
   a ~44px single row: icon, name, a slots-left badge when relevant, a status
   pill (Available/Full), and a chevron button. Tapping the row body selects
   the type (still a real `<input type="radio">` under the hood, so keyboard
   and screen-reader behavior is unchanged). Tapping the chevron toggles an
   `aria-expanded` state and reveals a panel below the row containing today's
   description text and the setup steps (or, for an unavailable type, the
   "Next available in N days" line). Selecting and expanding are independent
   actions — selecting a row does not auto-expand it, and expanding a row does
   not select it.
6. Duration cards — *as today*, unchanged.
7. Order summary — *changed default state only*: instead of
   `display:none` pre-selection, it always renders with the base price and
   deposit rows visible, plus a muted hint line ("Pick an account type to see
   your total" / "Pick a duration to see your total"), so nothing pops in or
   shifts layout when both selections are made — only the promo-discount row
   and the final total value change.
8. Inline CTA button — *as today's element*, but its label now tracks state
   instead of being hidden pre-selection: "Pick an account type" → "Pick a
   duration" → "Message us on Facebook". The button stays enabled at every
   state (never `disabled`); clicking it before both selections are made
   scrolls to and shakes the first incomplete step, reusing the existing
   `gd-dur-grid-shake` animation pattern rather than introducing a new one.

## Mobile sticky bar (≤820px only)

A new fixed-position bar, ~64px tall, present for the whole rent-panel scroll
region: running total on the left (mirrors the order summary's total exactly,
one number, one source of truth), CTA button on the right whose label mirrors
the inline CTA's state machine above. This is additive to the inline CTA, not
a replacement — the inline CTA still renders in the flow; the bar is a second,
always-visible surface for the same action.

**Desktop (>820px) gets no sticky bar.** With the compact rows the panel fits
inside a typical viewport, so a persistent bar there would be redundant chrome
with no reachability problem to solve.

### Conflict with the existing floating Messenger button

`.mobile-fab` (`public/css/style.css:291`, `position:fixed; right:16px;
bottom:16px`, shown ≤820px) occupies the same corner the sticky bar's CTA
would sit near. Resolution: **hide `.mobile-fab` specifically on the game
detail page** (a page-scoped selector, e.g. `body.game-detail-page
.mobile-fab { display: none; }` — not a global change to the FAB itself,
which keeps working everywhere else it's used, e.g. browse/home). The sticky
bar's CTA is a strictly more useful version of the same action here, since it
carries the game, selected type, and duration into the prefilled Messenger
text where the FAB does not.

## Buy Permanent mode

When the top toggle is set to Buy: the price header shows the buy price
(no "from" state needed — buy has at most two prices, NT and TR, no duration
axis), the sticky bar's total mirrors the buy total, and the CTA/bar button
text is "Message us on Facebook" once an account type is picked (buy has no
duration step, so the state machine is two states instead of three: "Pick an
account type" → "Message us on Facebook"). No other change to buy-mode logic.

## No-slot / reservation states

Unaffected by this redesign. When a type has no available slot, its row shows
the "Next available in N days" line inside its own expandable panel (moved
from its current position, same content). When every type is full
(`allUnavail`), the existing reserve/queue card section below the panel is
untouched; the sticky bar's CTA becomes "Reserve a slot" and scrolls to that
section instead of triggering the Messenger flow.

## Out of scope

- The cover image / gallery column (left side of `.gd-layout`) — unchanged.
- The reserve/queue card internals (`.gd-reserve-card` and children) —
  unchanged, only how the sticky bar routes to them changes.
- The Rent/Buy toggle's underlying JS logic (`setMode()`) — unchanged, only
  its markup moves from inline styles to classes.
- Admin-side changes — this is a public-page-only redesign.
- Desktop sticky bar — deliberately not built (see above); can be added later
  as a small follow-up if usage data suggests desktop needs it too.

## Estimated impact

Rent panel height on a 375px viewport: **622px → ~420px** (measured against
the interactive preview's proportions). Whole right column drops from 866px
(over the 812px viewport) to roughly 640px (under it), with the CTA reachable
at every scroll position via the sticky bar regardless.
