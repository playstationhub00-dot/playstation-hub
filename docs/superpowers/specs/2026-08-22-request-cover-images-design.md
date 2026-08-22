# Cover Images on Game Requests — Design

**Date:** 2026-08-22
**Status:** Approved

Every request on `/requests` gets a cover thumbnail. Covers arrive automatically
where the site already has the artwork, and by owner upload otherwise.

## Where the picture comes from

Three sources, in priority order. The first one that produces an image wins, and
none of them ever overwrite an image already set by hand.

### 1. Auto-inherit at request time (free)

`/api/search-index` (`server.js:2140-2155`) already returns a cover for every
title the site knows: available games (`y: 'now'`), Coming Soon
(`y: 'soon'`), and PS Plus popular (`y: 'psplus'`).

Available titles are irrelevant here — they are blocked from becoming requests
by the existing server-side catalogue guard. But **Coming Soon and PS Plus
entries are not blocked**, and unreleased games are the single most-requested
category. When a submitted title slug-matches an entry in `upcoming` or
`psplus_popular`, its `cover_image` is copied onto the request at creation.

This is the highest-value part of the feature and costs nothing: no upload, no
API, no matching heuristics beyond the `slugify()` comparison the request flow
already performs.

### 2. Auto-inherit at stocking time (free)

When a request is marked stocked and linked to a catalogue `game_id`, the linked
game's `cover_image` is copied onto the request if it still has none. A stocked
request is by definition a game now in the catalogue, so the correct artwork
already exists — asking the owner to upload it again would be duplicated work.

### 3. Owner upload (manual, optional)

For genuinely new titles the site has never heard of, the owner uploads a cover
from the admin Game Requests list. Optional: a request with no image renders a
placeholder rather than a broken layout.

### Rejected: an external games API

RAWG or IGDB would auto-fetch covers for unknown titles, and was considered.
Rejected because customer-typed titles are exactly the input fuzzy matching
handles worst — `gta 6`, `cod mw2`, misspellings — and unreleased games have the
thinnest coverage in those databases. The failure mode is a confidently wrong
cover on a public page, which is worse than no cover. It also adds an API key, a
network dependency, and rate limits to a feature that currently has none.

### Rejected: customer-supplied images

Moderating customer-submitted images on a public storefront is a materially
harder problem than moderating their text, and the approval flow was not built
for it.

## Data

One new field on the `game_requests` document:

```js
cover_image   // '' or a path like '/uploads/1755834000.webp'
```

Empty string default, consistent with how `cover_image` is stored on games,
upcoming entries, and PS Plus entries throughout this codebase.

## Upload pipeline

Reuses `upload` (multer, 5MB limit, image mimetypes only — `server.js:279`) and
`processUploadedImage(file, maxDim)` (`server.js:303`), which downsizes and
re-encodes to WebP. This is the same pipeline the add-game cover field uses.
No new upload machinery.

`maxDim` is 900 for game covers elsewhere; request thumbnails display at 40px
wide, but the same 900 is used rather than introducing a second value — the
board may later show larger art, and re-encoding at a smaller ceiling is
irreversible.

## Public board

The thumbnail sits between the vote count and the title, inside the existing
`.req-row` flex layout:

```
[votes] [40×60 cover] [title + voters] [vote form]
```

Row height grows from roughly 54px to roughly 78px. Desktop thumb is 40×60
(2:3, matching the site's `.gc2-card` poster ratio); mobile drops to 32×48.
Images use `object-fit: cover` so non-poster uploads crop rather than distort.

A poster-grid layout was considered and rejected: the board's job is to show
ranking, and a gallery of covers stops reading as a leaderboard, drops the voter
names, and gets tall on mobile — the page was deliberately tightened for mobile
the same day.

### No-image placeholder

Requests without a cover render a same-sized box with a dashed border and a
muted 🎮 glyph, not a collapsed or missing cell. Keeping the slot occupied
preserves row alignment down the list, which is what makes a ranking scannable.

## Admin

The Game Requests accordion in the admin Games tab gains, on every row:

- The current thumbnail (or placeholder), same 40×60 treatment.
- A file input and Save button posting to a new route.

Available on **every** row regardless of status, not only at approval. Four
requests are already approved and live with no images; an approval-only control
would lock them out permanently and would make a bad cover unfixable.

New route, following the four existing `/admin/requests/:slug/*` routes
(`server.js:2076-2100`):

```
POST /admin/requests/:slug/image
```

`requireAuth`, `upload.single('cover_image')`, then `processUploadedImage`, then
persist. Redirects with a `request_image` message key, which must be added to
**both** the `messages` and `msgTabMap` objects in `views/admin.ejs` — the
established pattern in that file, where a key in only one object produces either
a toast with no tab switch or a tab switch with no toast.

There is no remove action. Replacing an image covers the realistic mistake, and
a delete button on every row is one more way to lose work by mis-tap.

## Out of scope

- Any external image API.
- Customer-supplied images.
- Changing the request, vote, approval, or stocking flows beyond attaching an
  image.
- Backfilling covers for the four existing approved requests automatically —
  they are reachable through the new admin control, and there are four.

## Verification

Live on `https://playstation-hub.com/requests` after deploy:

- A request matching a Coming Soon title shows that title's cover with no manual
  step.
- A request matching nothing shows the placeholder, and the row stays aligned
  with its neighbours.
- Uploading a cover in admin replaces the placeholder on the public board.
- Rows stay readable at a 390px viewport, with the thumbnail, title, and vote
  form all reachable; measured `.req-row` height stays under 100px on mobile.
- Marking a request stocked with a linked game pulls that game's cover.
- No console errors.
