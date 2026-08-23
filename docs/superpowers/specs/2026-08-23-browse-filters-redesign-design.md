# Browse Filters Redesign — Design

**Date:** 2026-08-23
**Status:** Approved

Replace `/browse`'s four dropdowns with grouped filter chips carrying live
result counts, and add the filter the page has never had: "what can I rent
right now".

## What the library actually looks like

Measured live against all 55 games, 2026-08-23:

| | |
|---|---|
| Available to rent now | 44 (11 fully booked) |
| Plays on PS5 | 54 — filtering by it excludes one game |
| Plays on PS4 | 21 |
| Can be bought outright | 39 |
| Newly added | 6 |
| Bundles | 3 |
| Genres | Action 37, Horror 6, Sports 5, Co-op 3, Mix 2, Racing 1 |

These numbers are the whole argument for the redesign, so they are recorded
here rather than left implicit.

## What is wrong today

1. **There is no "available now" filter.** The availability dropdown offers only
   "PS4 Primary Available" and "PS5 Trophy/Non-Trophy Available" — internal
   account-type vocabulary. A customer who just wants to see what they can rent
   has to already understand how the accounts work.
2. **Genre barely filters.** Action returns 37 of 55. Racing returns 1. "Mix" is
   not a genre.
3. **The PS5 option is inert.** It returns 54 of 55, because a `PS4/PS5` game
   correctly matches both. Only the PS4 side of that filter carries information.
4. **The Search button does nothing.** Every dropdown already auto-submits via
   `onchange`, and this page has no text input — search arrives only as
   `?search=` from the nav. The button submits an unchanged form.
5. **No filter for buying**, despite 39 of 55 games being purchasable.

## The filters

Three groups. A chip shows its label and its count.

**Show** — multi-select, combined with AND:

| Chip | Matches |
|---|---|
| Available now | any rentable slot open (console-aware, see below) |
| New | `isAddedThisMonth(game)` — the existing 11-day window |
| Can buy | `buy_nt_price > 0` or `buy_tr_price > 0` |
| Bundles | `is_bundle === true` |

"All games" is not a fourth toggle — it is a reset link that clears every Show
chip, shown as selected when none are active.

**Console** — single toggle:

| Chip | Matches |
|---|---|
| Plays on PS4 | `platform` is `PS4` or `PS4/PS5` |

There is deliberately no PS5 chip. It would match 54 of 55 games, which tells a
customer nothing and occupies space that a useful control could use.

**Genre** — single-select, and a genre is only offered if at least 3 games carry
it. Today that yields Action, Horror, Sports, Co-op, and drops Racing (1) and
Mix (2). The threshold is a rule, not a hardcoded list: a genre appears on its
own once the library has enough of it, and disappears if it thins out. Clicking
the selected genre again clears it.

### "Available now" is console-aware

With no console chip active, *available* means any open slot — 44 games.

With **Plays on PS4** active, it means an open **PS4 Primary** slot — 17 games.
A PS4 owner cannot use a free PS5 trophy slot, so counting it as availability
would be a lie in exactly the case where the customer was specific about their
hardware.

The live counts make this visible rather than surprising: tapping Plays on PS4
visibly changes Available now from 44 to 17.

## How counts are computed

Each chip's count is the size of the result set **as if that chip were active**,
alongside the currently active filters, ignoring that chip's own current state.

- A Show chip counts against the other active Show chips plus console plus genre.
- A Genre chip counts against Show plus console, but not against the currently
  selected genre — so genres stay switchable instead of every other genre
  collapsing to zero once one is picked.
- The Console chip counts against Show plus genre.

The practical guarantee: **no chip ever shows a count of zero and no tap ever
lands on an empty page.** A chip whose count would be 0 is not rendered at all.

## Server-rendered, not client-filtered

The chips are ordinary links (`<a href="/browse?avail=1&genre=Horror">`). Each
tap is a normal page load. Filtering and counting both happen in the `/browse`
route.

This is a deliberate choice over filtering in the browser, for one reason that
outweighs the snappier feel: **availability logic would have to be duplicated.**
`computeAvailability()` is non-trivial server-side logic reading account
summaries and slot state. Reimplementing it in client JS would create a second
implementation of the same rule — and this session has already produced two
production bugs from exactly that pattern (Coming Soon slot counts computed two
different ways, and a filter script separated from the markup it served). One
implementation, on the server, is worth a page load.

It also keeps filter URLs shareable and bookmarkable, and keeps the page working
with no JavaScript.

## URL parameters

New: `avail=1`, `buy=1`, `bundle=1`, `ps4=1`.
Kept as-is: `genre=<name>`, `newOnly=1`, `search=<text>`.

`search` is the only parameter any other page links to (nav search's "See all N
results"), and it is unchanged.

Old parameters keep working, so existing bookmarks do not break:

| Old | Now treated as |
|---|---|
| `platform=PS4` | `ps4=1` |
| `platform=PS5` / `platform=PS4/PS5` | ignored (no chip produces it; matched ~all games anyway) |
| `unit=ps4` | `avail=1` + `ps4=1` |
| `unit=ps5` | `avail=1` |

## Default view

Unchanged: all 55 games. "Available now" is the first chip, one tap away.

Defaulting to available-only was considered and rejected: some fully-booked
games can still be bought outright, and hiding them by default would hide
purchasable inventory from the page's own landing state.

## Also changing

The Coming Soon section currently renders only when no filter is active, gated
on `!search && !platform && !genre && !unit && !newOnly`. That condition must be
updated to the new parameter set, or the section will reappear underneath
filtered results.

## Out of scope

- Re-tagging games to fix Action being 67% of the library. That is data entry in
  admin, and only the owner can decide the right genre for each title. The
  3-game threshold is the mitigation, not a fix.
- A price filter. Rent prices span ₱199–349 — too narrow a band for a filter to
  divide usefully.
- Sorting controls. Games stay alphabetical.
- Any change to the game cards themselves, the Coming Soon cards, or the PS Plus
  section.
- Multi-select genres.

## Verification

Live on `https://playstation-hub.com/browse` after deploy:

- Chip counts match reality: Available now 44, Plays on PS4 21, Can buy 39, New
  6, Bundles 3, Action 37, Horror 6, Sports 5, Co-op 3.
- Racing and Mix do not appear as genre chips.
- No PS5 chip appears.
- Tapping Plays on PS4 changes Available now's count from 44 to 17.
- Combining Available now + Horror shows a non-zero count on both, and the
  result count matches the number of cards rendered.
- No chip anywhere shows "· 0".
- `/browse?platform=PS4`, `/browse?unit=ps5`, and `/browse?newOnly=1` all still
  return sensible filtered pages.
- `/browse?search=resident` (the nav's link shape) still works.
- Coming Soon shows on the unfiltered page and is hidden once any chip is active.
- Filters work with JavaScript disabled.
- No console errors.
