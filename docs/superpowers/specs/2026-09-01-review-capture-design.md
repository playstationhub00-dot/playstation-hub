# Review Capture and Display — Design

**Goal:** Turn reviews from a hand-filled admin table into a byproduct of every
rental, and put the resulting proof on the page where customers actually
hesitate.

**Status:** approved 2026-09-01.

## Problem

The reviews system is fully built — admin CRUD, star ratings, ordering, a
`visible` flag — and contains **zero rows in production**. The homepage tells
visitors "24+ Active Renters" and then shows nothing from any of them.

Two separate failures cause this:

1. **Nothing ever asks.** The only way a review can exist is the owner typing it
   into an admin form from memory. There is no moment in the customer's journey
   where they are invited to leave one, so none get written.
2. **The proof is on the wrong page.** Reviews render only in `index.ejs`. Most
   traffic from Facebook groups and ads lands directly on a game page, which is
   also where both measured drop-offs happen (0.5% of game views start an order;
   roughly half of started orders never pay). The social proof sits on a page
   many buyers never open.

## Why reviews stay pooled, not per-game

Per-game reviews were considered and rejected. With ~37 paying customers spread
across 53 games — and rentals concentrating on a handful of popular titles —
most game pages would show zero reviews. An empty review block is *negative*
social proof: it tells a hesitant buyer nobody has ever rented this. It would
damage ~47 pages to improve ~6.

The deciding argument is what the customer is actually asking. On a game page
the question is not "is this game good?" — they already know, which is why they
are there. It is "will this seller deliver, or am I about to lose ₱349 to a
stranger?" That is a question about the business, so business-level proof
answers it and works identically on all 53 pages.

Reviews therefore stay a single pool, shown everywhere, sorted so that any
review mentioning the current game floats to the top.

## Data model

Two fields are added to the existing review shape:

```js
{
  id, name, rating, text, game_rented, order, visible, created_at,
  source: 'facebook' | 'site',   // which badge the card shows
  order_ref: 'PH-0039' | null    // proves the reviewer rented; blocks duplicates
}
```

Existing reviews have neither field. A review with no `source` is treated as
`'facebook'`, which preserves today's display exactly — there is no backfill and
no migration step.

`order_ref` does two jobs: it is the evidence behind the "Verified renter" badge,
and it is how a second submission from the same order link is rejected.

## Customer-facing flow

**The prompt.** Rendered on the customer's own order page (`order-status.ejs`),
below the order card. It shows only when all of these hold:

- `order.state` is one of `active`, `awaiting_return`, `verifying_return`,
  `closed` — that is, the customer has actually received the game. Deliberately
  excludes `awaiting_qr` and `qr_pending` (paid but not yet signed in) and
  `reserved` (nothing played yet).
- no review already exists with this `order_ref`.

The customer picks a star rating and types one sentence. Name and game are taken
from the order, not from input. Beneath the button: "We check every review before
it goes live."

**Note on reach.** No order in production has ever reached `closed` — all 14
current orders sit in `awaiting_payment`, `reserved`, or the out-on-rent states.
Gating on `closed` alone would show the prompt to nobody. The state list above
reaches 8 customers on day one.

**After submitting**, the card is replaced with "Thanks — we'll put this up once
we've checked it." The prompt does not reappear for that order.

**Submission route.** `POST /order/:ref/review`, validating `url_key` the way
every other per-order route does, and rate-limited with the existing
`rateLimited` helper. It writes `visible: false`, `source: 'site'`,
`order_ref: order.ref`, `name: order.fb_name`, `game_rented: order.game_title`,
and the submitted rating and text. Rating is clamped to 1–5; text is trimmed and
capped at 300 characters.

## Display on game pages

`game-detail.ejs` receives the same visible reviews the homepage gets and renders
them directly beneath the order card — next to the price and the button, where
the hesitation happens.

The block shows an aggregate line (`4.9 · 12 renters`), the top three reviews,
and a "See all N reviews" link pointing at `/#reviewsSection`. A dedicated
`/reviews` page is deliberately not built until the review count justifies one.

The aggregate counts **every visible review**, not only those mentioning this
game — it describes the business, which is the whole basis for pooling. The same
figure therefore appears on every game page, and the count in "See all N" matches
it.

Sort order: reviews whose `game_rented` matches this game's title first, then by
the existing `order` field, then newest first.

**When there are no visible reviews the block does not render at all**, matching
how the homepage section already behaves. There is never an empty state.

## Admin

Pending reviews (`visible: false`) get their own block at the top of the existing
Customer Reviews accordion in `views/partials/admin/content.ejs`, with a count
badge and an Approve button. Approve reuses the existing
`POST /admin/reviews/toggle/:id` route — no new route is needed, the pending
items are simply surfaced where the owner will see them instead of being mixed
into the main list.

## Honesty fixes

The review section is currently labelled "Real reviews from Facebook" and every
card carries a Facebook badge, while the only way to create a review is an admin
form. Once customers can submit from the site, that claim is definitively false —
on the one section whose entire purpose is establishing trust.

Three copy changes, all in existing files:

| Location | From | To |
|---|---|---|
| `index.ejs` heading | "Real reviews from Facebook" | "What our customers say" |
| `admin/content.ejs` accordion description | "sourced from your Facebook page" | "Shown on your homepage and game pages" |
| `admin/content.ejs` add-form heading | "➕ Add Review from Facebook" | "➕ Add a review" |

The badge moves per-card: Facebook blue where `source === 'facebook'`, green
"Verified renter" where `source === 'site'`. "Verified renter" is the stronger
claim of the two — it asserts a paid order exists behind the review, which
Facebook cannot.

The admin add form gains a source selector so reviews genuinely copied from
Facebook can still be marked as such. It defaults to `facebook`, since copying a
real Facebook comment is what that form is for — matching both its current
labelling and how every existing review should be treated.

## Architecture

`lib/reviews.js` — pure functions over plain review objects, no database access
and no Express, matching the `lib/queue.js` pattern already in the codebase:

- `REVIEWABLE_STATES` — the four order states that may be prompted
- `canPrompt(order, reviews)` → `boolean` — state gate plus duplicate check
- `hasReviewed(reviews, ref)` → `boolean`
- `badgeFor(review)` → `'facebook' | 'verified'` — with the missing-field default
- `sortForGame(reviews, gameTitle)` → ordered array
- `aggregate(reviews)` → `{ count, average }` — average rounded to one decimal
- `normalize({ rating, text })` → `{ rating, text }` — clamps rating to 1–5,
  trims text and caps at 300 characters

Reviews live in lowdb alongside the catalogue, so none of this depends on
MongoDB.

## Failure modes

- **No visible reviews.** Neither the game-page block nor the homepage section
  renders. No empty state is ever shown.
- **Junk or hostile submission.** It is written with `visible: false` and never
  reaches the site until approved. EJS escapes on output as everywhere else.
- **Duplicate submission.** Rejected by the `order_ref` check; the customer sees
  the "thanks, we're checking it" state rather than an error.
- **Order deleted after its review.** `order_ref` is a plain string, not a
  reference, so the review survives intact and still displays.
- **A game with no reviews mentioning it.** Falls back to the shared pool, which
  is the normal case and the reason the pool is shared.

## Testing

`scripts/test-reviews.js`, plain asserts run with `node`, matching the project's
no-framework convention: the state gate accepting exactly the four reviewable
states, duplicate rejection by ref, `badgeFor` defaulting a missing `source` to
Facebook, game-title matching floating the right review to the top, aggregate
rounding, and `normalize` clamping an out-of-range rating and over-long text.

## Out of scope

- A dedicated `/reviews` page. The "see all" link points at the homepage section.
- Per-game review pools, for the reasons argued above.
- Editing a review after submission, by customer or owner. Approve or delete.
- Automatic review requests over Messenger. The prompt lives on the order page
  the customer already visits.
- Photo or video reviews.
