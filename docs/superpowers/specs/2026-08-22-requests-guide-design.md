# Request-a-Game Guide — Design

**Date:** 2026-08-22
**Status:** Approved

A three-step strip on `/requests` that explains what happens after a customer
submits a request. It sits above the form, costs under 110px of mobile height,
and replaces nothing.

## Why the guide is about the aftermath, not the form

The form is two text boxes and a button. Nobody is confused about how to type.

What the page cannot currently tell anyone:

- A new title is saved as `pending` and stays invisible until it is approved.
  Without this, "I requested a game and it never showed up" arrives in
  Messenger as a complaint about a bug that isn't one.
- Typing a title someone already requested adds a vote instead of creating a
  second row. The type-ahead already does this, but silently — the guide makes
  the behaviour legible before the customer starts typing.
- Vote counts decide stocking order. This is the reason to vote at all.
- The Facebook name field exists so the owner can message the requester when
  the game is stocked. Unexplained, it reads as an arbitrary data grab and
  invites junk input, which destroys the waiting list the field exists to build.

Each step carries exactly one of these. The guide is expectation-setting, not
instructions.

## The three steps

| # | Title | Text |
|---|-------|------|
| 1 | Ask for it | Already listed? Vote instead. |
| 2 | We check it | Appears once approved. |
| 3 | We message you | Use your real Facebook name. |

Step 3's number badge is green (`#22c55e`), matching the "Now available"
treatment already used for stocked rows. The other two are `--ps-blue`. The
colour shift marks the payoff step rather than decorating the sequence.

### One set of text, both breakpoints

The step text is written once in the template and shrinks with CSS. It is not
duplicated per breakpoint and there is no mobile-only copy.

This is a real constraint on the wording, not a note: at a 375px viewport the
three-column grid gives each cell roughly 100px, so any subtitle longer than
about 30 characters wraps into a tall column and defeats the compactness the
layout exists for. The strings in the table above are already sized to fit.
Anyone editing them later must keep them within that budget.

Duplicating the markup to give desktop longer sentences was considered and
rejected: two copies of the same message drift apart the first time one is
edited alone.

## Placement

Between the flash messages and the form:

```
h1 → subtitle → flash messages → GUIDE → form → "Most requested" list
```

Above the form, so a first-time visitor reads it before typing. Below the
flash, so that a customer who has just submitted sees "Thanks — we'll review
it" at the top of the page rather than under a guide they have already read.

## Layout

Three equal columns at every width — `repeat(3, minmax(0, 1fr))` — inside a
single bordered container matching the existing `.req-row` treatment
(`background: #111`, `border: 1px solid #222`, `border-radius: 10px`).

Desktop keeps the number badge and title on one line with the description
below, left-aligned. Below 600px the cells centre-align, font sizes drop, and
the badge shrinks — the column count never changes.

A full border is used rather than a single-sided accent stripe, consistent
with every other card on the site.

## What this does not include

- **No dismiss or collapse control.** It would need persistence to be worth
  anything, and a strip this small does not justify storing per-visitor state.
- **No copy on `/buy` or `/how-it-works`.** The guide lives on one page. `/buy`
  already links here, so arrivals have context.
- **No change to the form, the type-ahead, the vote flow, or the admin panel.**
  This is additive: one markup block and one CSS block.
- **No automated messaging.** Step 3 describes something the owner does
  manually from the admin voter list. Building the notification itself remains
  out of scope, as it was for the requests feature.

## Files

- `views/requests.ejs` — insert the guide markup between the flash-message
  block and `<form class="req-form">`.
- `public/css/style.css` — add `.req-guide*` rules beside the existing `.req-*`
  block (around line 2908), plus a `max-width: 600px` override.

## Verification

Live on `https://playstation-hub.com/requests` after deploy:

- Guide renders three across at 1440px and at 390px.
- Measured height of `.req-guide` at 390px is under 110px.
- The form remains within the first viewport at 390px.
- Submitting a request still shows the flash above the guide.
- No console errors.
