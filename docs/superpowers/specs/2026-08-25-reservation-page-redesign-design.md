# Reservation Page Redesign — Design

**Date:** 2026-08-25
**Status:** Approved

Redesign the upcoming-game reservation page (`views/upcoming-detail.ejs`) to
optimize for completed reservations, by showing the real amount due on load
and using the desktop width that is empty today.

## The problem

The page hides the number a visitor actually cares about. The reserve card
reads "Select a duration to see downpayment" until a type and duration are
both clicked — even when there is only one duration to pick. Three labelled
sections (`SELECT RENTAL TYPE`, `SELECT DURATION`, `CHOOSE YOUR OPTION`) wrap
what is really a two-field decision, and the slot count is stated twice: once
as a standalone chip, again per rental type. On desktop the body is capped at
480px, leaving the right half of the page empty while the page's best asset —
the countdown — appears once in the hero and never again near the CTA.

## The change

**Preselected defaults, price on load.** The page selects a rental type
(non-trophy when available, else trophy) and a duration (the only one when
there is just one, otherwise monthly) as soon as it renders, instead of
waiting for clicks. The reserve card opens already showing "Pay ₱350 now ·
₱349 due on release · ₱699 total" for a game like Marvel's Wolverine. A
game with only one duration shows it as a static line rather than a
single-button "choice". The standalone slot-count chip is dropped; the count
already lives inside each type pill.

**One card, not three sections.** `SELECT RENTAL TYPE`, `SELECT DURATION`,
and `CHOOSE YOUR OPTION` collapse into a single card: compact type pills,
duration inline (or the static line above), the summary, the name field, and
the button — no repeated section chrome.

**Two-column desktop, single-column mobile.** At ≥900px the body splits:
description and release details in a left column, the reserve card in a
sticky right column. The full-bleed hero is untouched — cover art is not
duplicated into a second column. Below 900px it collapses to one column with
the reserve card placed **above** the description, since reserving is the
page's goal.

## What does not change

- **The full-slots path.** The red "All Slots Full" banner, "Request a
  Slot" / "Request Now →" copy, and the free waitlist link all behave exactly
  as today — including the waitlist staying hidden until slots are full. This
  was a deliberate choice: showing it earlier risks diverting people who would
  have paid.
- **The pricing math.** `Math.ceil(total * 0.5)` for the downpayment, the
  ₱100 trophy deposit, and every existing price source (`NT_PRICES`,
  `TR_PRICES`) are reused as-is, not restated.
- **The order contract.** `POST /order/reserve` still receives `game_id`,
  `account_type`, `days`, `fb_name` — no server or route change.
- **Error and fallback behavior.** The `order_error` message and the
  Messenger ("or message us on Facebook instead") link keep their current
  text and placement.

## Scope

- `views/upcoming-detail.ejs` — markup and inline script restructured for
  the single-card layout, preselection, and two-column desktop split.
- `public/css/style.css` — new rules for the desktop two-column layout and
  the compact card. No existing `.gd-*` / `.usd-*` class is repurposed for a
  different meaning — new classes are added where the layout genuinely
  changes.

## Out of scope

- No change to `views/game-detail.ejs` (the rent/buy page) or any of its
  shared `.gd-*` classes beyond what this page already reuses.
- No live-ticking countdown, no scarcity meter tied to the original slot
  total — that was direction B from the visual proposal and was not chosen.
- No change to how a slot becomes reserved, to `resolveUpcomingSlots()`, or
  to the admin upcoming-game editor.

## Verification

Live on `https://playstation-hub.com/upcoming/<slug>` after deploy, using
Marvel's Wolverine (2 slots, Monthly ₱699 only):

- The reserve card shows "₱350 now · ₱349 on release · ₱699 total" on load,
  with no type or duration click required.
- Switching to Trophy updates the total to include the ₱100 deposit and
  recomputes the downpayment.
- At a desktop width the page shows two columns; below 900px it shows one
  column with the reserve card above the description.
- A game with zero slots left still shows the "All Slots Full" banner,
  "Request a Slot" copy, and the waitlist link.
- The Messenger fallback link and `order_error` banner render unchanged.
- No console errors.
