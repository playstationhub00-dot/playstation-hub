# Search ↔ Requests Integration — Design

**Date:** 2026-08-23
**Status:** Approved

Make the nav search aware of the game-requests board: show approved requests as
their own result section, and turn the dead-end empty state into a request.

## The problem, observed live

Searching "persona 3 reloaded" returns **"No games match"** and offers Messenger —
even though *Persona 3 Reloaded is already on the requests board with a vote*.

Two costs, both real today:

- The customer is told the title is unknown to the business when the business
  already knows it is wanted. They either message the owner (manual work for a
  fact already recorded) or leave.
- Their demand goes uncounted. The request board exists to rank what to stock
  next; a search that ends in Messenger routes that signal away from the ranking
  and into an inbox.

The search box is where intent is highest — someone typing an exact title wants
that specific game. It is the best place in the site to capture a request, and
currently the only place that actively steers away from doing so.

## What becomes searchable

Only requests with status `approved`.

- **`pending` is deliberately excluded.** Pending entries are unmoderated,
  customer-typed text. The requests feature gates them out of the public board
  precisely so unreviewed text never appears on the storefront; putting them in
  the nav search would bypass that gate on every page of the site.
- **`stocked` is excluded** because a stocked request means the game is now in
  the catalogue — it already matches as a normal "Available now" result. Listing
  it twice would just be a duplicate row.
- **`rejected` is excluded**, obviously.

## Search results

A fourth section, alongside the existing three:

| Section | Source | Already exists |
|---|---|---|
| Available now | catalogue | yes |
| PS Plus Deluxe | PS Plus entries | yes |
| Coming soon | upcoming | yes |
| **Requested by customers** | approved requests | **new** |

It renders whenever a request matches — not only when nothing else does. A search
for "call of duty" surfaces both the rentable title and the requested
`Modern Warfare 4`, rather than the request being hidden by any other partial
match.

Each row shows the request's cover image (requests gained `cover_image` earlier),
the title, the vote count as its meta line, and a `REQUESTED` badge. It links to
`/requests#req-<slug>` so the customer lands on that specific row of the board,
not the top of a vote-ranked list the title may sit far down in.

Voting does not happen from the dropdown. A vote requires a Facebook name, and a
name field does not belong in a nav search box on every page. The row's job is to
get them to the board, where the existing vote form already works.

## Empty state

Only fires when nothing matches anywhere — catalogue, PS Plus, upcoming, *and*
requests.

| | Now | After |
|---|---|---|
| Sub-copy | "We might still be able to get it for you — message us and we'll check." | "Not in our library yet — request it and we'll stock the most-wanted titles first." |
| Primary | Message Us | **Request this game** |
| Secondary | Browse All Games | Message Us |
| Tertiary | — | Browse All Games |

"Request this game" links to `/requests?title=<what they typed>`, which prefills
the request form's title field. They add their Facebook name and submit — the
existing flow, with its rate limiting, duplicate matching, and moderation, all
unchanged. No new write endpoint is introduced, and the nav gains no POST.

Messenger stays, demoted. It is the right escape hatch for someone with a
question rather than a request; it is the wrong default for someone naming a
specific title.

## Failure behaviour, which is load-bearing

`/api/search-index` is currently synchronous and has no database dependency.
Adding requests makes it `async` and introduces one.

The requests lookup must be wrapped so that a MongoDB failure degrades to *no
requested section* rather than a failed index. If the lookup throws and is
unhandled, the whole index request fails and **the entire nav search stops
working site-wide** — a far worse outcome than the feature simply being absent.
This is the single most important detail in this document.

`lib/requests.js` already returns `[]` when no database is configured, so the
no-Mongo case is safe by default; the guard is for the connected-but-erroring
case.

## Files

- `server.js` — `/api/search-index` becomes async and appends approved requests
  (wrapped per above); `GET /requests` passes the `?title=` value to the view.
- `views/partials/nav.ejs` — renders the Requested section and the new empty
  state.
- `views/requests.ejs` — each board row gains `id="req-<slug>"`; the title input
  prefills from the passed value.
- `public/css/style.css` — one badge class, matching the existing
  `.navsearch-badge-soon` / `.navsearch-badge-psplus` pattern.

### Index entry shape

Requested entries carry only what their row renders — no `p`/`pr`/`s` fields,
which have no meaning for a request:

```js
{ t: title, v: voteCount, u: '/requests#req-' + slug, y: 'requested', img: cover_image || '' }
```

## Out of scope

- Voting from the search dropdown, for the reason given above.
- Surfacing `pending` requests anywhere public.
- Changing the requests board's own layout, ranking, or vote flow.
- Fuzzy/typo-tolerant matching. Search stays a substring match, exactly as it is
  today — this feature changes what is searched, not how.

## Verification

Live on `https://playstation-hub.com` after deploy:

- Searching `persona 3 reloaded` shows a Requested section with the correct vote
  count, and clicking it lands on that row of `/requests`.
- Searching a title that matches both a catalogue game and a request shows both
  sections.
- Searching genuine nonsense shows the new empty state, and "Request this game"
  opens `/requests` with the title prefilled.
- A pending request's title does **not** appear in search.
- Search still works with the requests lookup failing (verified by inspection of
  the guard, since Mongo cannot be safely broken in production).
- No console errors.
