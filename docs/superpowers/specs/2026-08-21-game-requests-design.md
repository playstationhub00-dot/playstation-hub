# Game Requests — Design

**Date:** 2026-08-21
**Status:** Approved

Customers request a game the catalogue doesn't carry, see what others have
requested, and add their vote. The owner uses the resulting ranking to decide what
to stock next.

## Why the matching matters more than the board

The obvious build — a text box and a list — fails at the one job it exists to do.

Free-typed titles fragment: "GTA 6", "GTA VI", "Grand Theft Auto 6", and "gta six"
become four entries with three votes each instead of one with twelve. Stocking
decisions would then be made from data that understates real demand and ranks the
wrong titles first. A request board with fragmented counts is worse than no board,
because it looks authoritative while being wrong.

Matching input against what already exists is therefore not a refinement of this
feature. It is the feature.

## The second, larger payoff

Capturing a Facebook name with each vote turns the ranking into a **waiting list**.

When a requested game is stocked, the owner has a named list of people who already
asked for it and can message them directly: *"You requested this — it's available
now."* That is warm demand acquired at no cost, and it is plausibly worth more than
the ranking itself.

This is why votes carry a name rather than being anonymous clicks, and why the data
model stores voters rather than a bare counter.

## Storage

A MongoDB collection, `game_requests`, in a new `lib/requests.js` following the
existing `lib/orders.js` pattern — `init(getDbFn)` called from `server.js` beside
`orders.init(_getMongoDb)` (`server.js:521`), and an internal `_col()` helper.

Not the lowdb blob. `lib/orders.js` opens by explaining that orders live in MongoDB
because they are "written by customers and are money-adjacent, so they cannot
tolerate that model's last-write-wins behaviour." Requests are customer-written on
the same basis: two people requesting at the same moment could silently lose one in
the blob. The precedent already exists in this codebase and this follows it.

### Document shape

One document per **title**, not per vote:

```js
{
  slug,                       // normalised key, e.g. "grand-theft-auto-vi"
  title,                      // display title as first submitted
  status,                     // 'pending' | 'approved' | 'stocked' | 'rejected'
  voters: [                   // count is voters.length
    { fb_name, session_id, at }
  ],
  game_id,                    // set when stocked, links to the catalogue entry
  created_at,
  updated_at
}
```

Storing voters as an array is what makes the waiting list possible. A bare counter
would rank titles but could never tell the owner whom to message.

### What is public about a voter

The public board shows **first names only** — "requested by Marc, Aya, Paulo +9" —
derived by taking the first whitespace-separated token of `fb_name`. Never the full
name, and never any contact detail.

Showing names rather than a bare count makes the demand read as real people rather
than a number the site could have invented, and it encourages others to add theirs
to something visible. The full `fb_name` is visible only in the admin panel, which
is where the waiting-list value actually lives.

## Three-way matching

As the customer types, the input is checked against three things in order:

1. **Already in the catalogue.** Show "We already have this" with a link to the
   game. Uses the existing `/api/search-index` endpoint, which already returns every
   available title plus bundle keywords.
2. **Already requested.** Show the existing entry and its current count; the
   customer adds their vote to it. This is what prevents fragmentation.
3. **Neither.** The customer creates a new entry, which is saved as `pending`.

Matching is case-insensitive on a normalised slug, so punctuation and capitalisation
differences collapse together.

## Moderation

Customer-typed text appearing on a public storefront is a real risk. It is handled
by splitting the two actions:

- **Voting on an approved title is instant.** No moderation, because the title text
  was already approved.
- **Creating a new title is `pending`** and invisible publicly until the owner
  approves it.

This closes the window where offensive text could be live, without slowing the
action customers take most often.

## Vote deduplication

A vote is rejected if the same `session_id` already appears in that document's
`voters`, or if the same `fb_name` appears case-insensitively.

`req.sessionId` is already set on every request (`server.js:398`) and already used by
the order flow. This does not stop a determined person using a private window; it is
proportionate to the stake, which is a stocking hint rather than money.

Rate limiting reuses the existing `rateLimited(bucketKey, ip, max, windowMs)` helper
(`server.js:43`), in the same shape `/order/create` already uses.

## Lifecycle when stocked

The owner marks a request stocked from the admin panel and links it to the
catalogue game. The entry stays on the public board as **"Now available"** with a
link, rather than disappearing.

Keeping it visible is deliberate: it demonstrates that requesting actually works,
which is what drives people to request again. A silently vanishing entry teaches the
opposite.

## Surfaces

- **`/requests`** — public board. Approved entries ranked by vote count, stocked
  entries shown as available, a request form at the top.
- **Nav** — a "Requests" link after "Buy".
- **`/buy`** — the existing "Don't see it? Request a game" Messenger link
  (`views/buy.ejs:125`) repoints here.
- **Admin, Games tab** — a Requests section: pending approvals first, then approved
  by vote count, with approve / reject / mark-stocked / delete actions and each
  entry's voter names visible.

## Out of scope

- **Sending the notifications.** The voter list is captured and shown to the owner;
  actually messaging those people is a separate piece of work with its own delivery
  questions.
- **Merging duplicate entries** after the fact. The matching step is designed to
  prevent duplicates at entry; a merge tool is only worth building if that proves
  insufficient in practice.
- Any automatic stocking, ordering, or purchasing triggered by vote counts.
- Editing a request's title after approval.
