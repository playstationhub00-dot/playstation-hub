# Not-Yet-Stocked Account Notice — Design

**Date:** 2026-08-10
**Status:** Approved

## The problem

Games are added to the catalog with a manually-entered slot count before an actual account exists for them — the account only gets created once someone books the game (see MARVEL Tōkon: Fighting Souls, live with "Trophy · Available · 1 slot" despite no account being stocked). The game detail page currently has no way to tell a customer this: the green "Available" pill and slot count are indistinguishable from a real, ready-to-play account. A customer can pay expecting instant access and instead wait for account setup, with no warning anywhere on the page.

## Detection

A rental type counts as **not-yet-stocked** when both are true:
- `game.renters === 0` (this game has never been rented — the same signal the existing `⏳ Days Left!` card badge already uses)
- The corresponding account flag from `computeAvailability()` is false for that type: `!hasTrophyAcc` for Trophy, `!hasNtAcc` for Non-Trophy, `!hasPs4Acc` for PS4 Primary

Both conditions are required. `renters === 0` alone would misfire on a game that was pre-stocked with a real account before its first rental — that game is genuinely ready, and the account flags correctly say so, keeping it out of this state. Checked independently per rental type: a game can be not-yet-stocked for Trophy while Non-Trophy already has a linked account and displays normally.

## What changes

Scope: `views/game-detail.ejs` only. Game cards, the browse grid, and the order status page after booking are untouched — their "Available"/"Full Slot" pills and the `⏳ Days Left!` card badge keep their current behavior. This spec only changes what the detail page's rent panel shows.

**Amber banner**, shown above "SELECT RENTAL TYPE" when at least one rental type is not-yet-stocked:

> ⚡ **Be the first to rent this**
> Nobody has rented this yet, so the account isn't made. Book it and we'll have it ready within a few hours — same day.

**Per-row pill override**, only on rows where that specific type is not-yet-stocked: the pill that normally reads "Available" reads **"Set up on order"** instead (same visual slot/styling family, amber instead of green — matching the banner's color). A one-line note appears under that row:

> Not stocked yet — we create the account after you book. Ready the same day.

A row for a type that already has a real account (or has been rented before) is completely unaffected — same "Available"/"Full Slot" pill as today, no note.

## Interaction with the existing "No Slots Available" banner

Mutually exclusive by construction, not by extra logic: the existing red banner (`allUnavail`) only fires when every rental type has zero slots available — a full-catalog game with no free room right now. The new amber banner fires per-type on the not-yet-stocked condition above, which is orthogonal to slot counts (a not-yet-stocked type still reports a manually-set slot count, so `allUnavail` reads it as available). In practice a newly added game will show the amber banner with normal-looking slot pills underneath (now overridden to "Set up on order"); a fully-booked established game will show the red banner as it does today. A game could theoretically show both if it happened to be both never-rented and fully slotted elsewhere, but that's not a state this spec needs to special-case — each banner's own existing/new condition governs independently and both can render if both are true.

## Out of scope

- The order status page after someone books a not-yet-stocked game (no "we're setting up your account" messaging there — that's a separate change to the order lifecycle).
- Game cards, browse grid, and any other surface that reads `hasTrophyAcc`/`hasNtAcc`/`hasPs4Acc` or `renters` — all keep their current "Available"/"Full Slot" wording.
- Any change to `computeAvailability()`'s return shape or the underlying account-linking system — this spec only reads the existing flags.
