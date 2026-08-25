# Sold-Out Badge Wording — Design

**Date:** 2026-08-25
**Status:** Approved

Rename the game card's sold-out badge from "Rented" to "No slots", so the
availability badges speak one vocabulary: **Last slot → No slots**.

## The problem

The card's two availability badges describe the same scale in two different
languages. One slot left reads "Last slot" — counting slots. Zero slots left
reads "Rented" — a different concept entirely. A customer scanning the grid has
to translate between two mental models to read one scale.

"Rented" carries two further problems:

- **It is overloaded.** The site already uses "Rented" for the customer's *own*
  active rental — "Rented since" on the order status page, "Game Rented" in
  admin. On a card it can read as *"I rented this"* rather than *"this is
  unavailable to you."*
- **It is inaccurate for non-game accounts.** PS Plus Deluxe is a subscription,
  not something rented in the video-store sense. The same applies to bundles.

A fully-booked card with no known return date also renders the word twice —
once in the corner badge, once in the clock line.

## The change

Three edits, no logic changes.

**The badge** (`views/partials/game-card.ejs`, the `allUnavail` branch):
`Rented` → `No slots`. Plural: there are multiple slots, so "No slot" would be
wrong. The `allUnavail` condition that triggers the badge is untouched.

**The clock line** (`views/partials/game-card.ejs`, inside the `allUnavail`
body status): the no-date fallback `Rented` → `No date yet`. This line sits
beside a clock icon and answers *"when will this be free?"* — its sibling
branch reads "Free in 5d", so the fallback should answer the same question
rather than restate the badge. The "Free in Xd" branch is untouched.

**The CSS class** : `gc2-badge-rented` → `gc2-badge-noslots`, in
`views/partials/game-card.ejs` and `public/css/style.css`. The declarations
inside the rule do not change — this only stops the class name from describing
something the badge no longer says. Both files deploy together, so there is no
window where markup and stylesheet disagree.

## Out of scope

- `views/bundle.ejs` and `views/buy.ejs` each map a slot status to the label
  `'Rented'`. Those describe *one specific slot* in a tier picker, where "this
  slot is rented" is accurate and singular. They are not the card-level
  availability scale this design fixes, and they keep their current wording.
- No condition, count, date calculation, or badge styling changes.
- The "Last slot" and "New" badges are untouched.

## Verification

Live on `https://playstation-hub.com` after deploy:

- On `/browse`, the PS Plus Deluxe card (currently fully booked) shows a
  **NO SLOTS** badge in place of RENTED.
- That card's clock line reads **No date yet**, not "Rented".
- A card with one slot remaining still reads **Last slot**, unchanged.
- A card with a known return date still reads **Free in Xd**, unchanged.
- The badge keeps its existing dark styling and top-left position — the class
  rename changes no visual property.
- No console errors.
