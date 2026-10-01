# Visitor → Messenger conversion (Parts 1–3) — Design

Date: 2026-10-02 · Status: draft for owner review

Part 4 (PlayStation game overview: trailer, screenshots, overview, details) is a separate
spec written after this one ships. It is approved as "Option A, trailer on top" and is not
covered here.

## Problem

The admin Funnel card shows 413 sessions landed, 229 (55%) viewed a game, **0** started an
order, 0 paid. Only 37 of 413 sessions (9%) browsed the catalog.

What the code and the owner's answers show:

1. **"Landed" is inflated.** The visitor middleware (`server.js`, "Visitor tracking
   middleware") records every request that is not under `/admin`, `/uploads`, `/css`, `/js`
   and has no `.` in the path — any method, any user-agent, and it issues a fresh session
   cookie each time. PayMongo webhook POSTs (`/webhooks/paymongo`), Messenger webhook POSTs
   (`/webhook`), the nav search's `/api/search-index` fetch, link-preview robots
   (Facebook, WhatsApp), search crawlers and uptime pings each become their own "session".
2. **The real conversion is invisible.** The owner confirmed customers rent through
   Messenger. Nothing counts a Messenger tap, so "0 started order" says nothing about
   actual demand.
3. **The game page pushes the wrong action.** The big button is the website order form
   (0 orders). Messenger is a small link ("or message us on Facebook instead") that
   refuses to open until a rental duration is picked (`handleMessageUs`) and is hidden
   (`updateCtaState`) whenever the selected type has no slot.
4. **Visitors who name a game have no way to ask for it.** Traffic is mostly from the
   Facebook page and posts landing on the homepage; people arrive with a game in mind.

## Goal

Three changes, one release:

- **Part 1 — Honest numbers.** Stop counting robots and system traffic; count Messenger
  taps as a funnel step; show which games people ask about.
- **Part 2 — Homepage search.** A "What game are you looking for?" box on the homepage
  with live availability.
- **Part 3 — Messenger-first game page.** A big "Message us about this game" button that
  always works.

Success looks like: the Funnel card reflects human sessions only, shows a "Messaged us"
count, and the owner can see which games drive Messenger taps.

## Out of scope

- Reading actual Messenger chats or linking taps to conversations (the Messenger webhook
  stays as is). Taps are counted, chats are not.
- Changing the website order flow, queue / fall-in-line / priority options, or payments.
- Rewriting past data. Old robot visits cannot be told apart (no user-agent was stored);
  only old system-path rows are filtered out of the dashboard.
- Part 4 (PlayStation overview).

## Part 1 — Honest numbers

### 1a. What gets recorded

New module `lib/visitor-filter.js` (pure, unit-tested):

- `isBotUserAgent(ua)` — true for an empty UA or one matching known robots/preview
  fetchers/uptime tools: `bot`, `crawl`, `spider`, `slurp`, `facebookexternalhit`, `facebot`,
  `whatsapp`, `telegram`, `bingpreview`, `headless`, `lighthouse`, `pingdom`, `uptime`,
  `monitor`, `curl`, `wget`, `python-requests`, `go-http-client`, `okhttp`, `axios`, `node-fetch`
  (case-insensitive).
- `classifyRequest({ method, path, userAgent })` returns one of:
  - `'system'` — path is `/webhook`, starts with `/webhooks/`, or starts with `/api/`
  - `'bot'` — `isBotUserAgent` is true
  - `'action'` — a human request that is not a page view (method is not GET/HEAD)
  - `'page'` — a human GET page view

The visitor middleware changes to:

| Class | Visit row | Session cookie / `req.sessionId` | Skip counter |
|---|---|---|---|
| `page` | recorded (as today) | issued, `req.sessionId` set | – |
| `action` | **not** recorded | issued, `req.sessionId` set (order routes read it) | – |
| `bot` | not recorded | **not** issued, `req.sessionId` undefined (routes already use `req.sessionId \|\| null`) | +1 |
| `system` | not recorded | not issued | +1 only for `/webhook`, `/webhooks/*` (not `/api/*`, which real browsers call) |

The existing asset/admin/uploads exclusions stay. The 200,000-row cap stays.

**Skip counter.** New lowdb key `visitor_skips`: `{ 'YYYY-MM-DD': n }` (UTC date, same as
visits). Written with the same `db.write()` pattern as visits. Defaults to `{}`.

### 1b. Messenger taps

**Client.** One script in `views/partials/nav.ejs` (every page with the nav, which is every
public page): a delegated `click` and `auxclick` listener on `document` for
`a[href*="m.me/PlaystationHub00"]`. On a tap it sends
`navigator.sendBeacon('/api/track/message', Blob({page, source}))` with
`{ page: location.pathname, source }`, falling back to `fetch(..., { keepalive: true })`.
`source` comes from the link's `data-track-source` (default `'other'`; values: `nav`, `fab`,
`hero`, `footer`, `game`, `search`, `search-empty`, `other`). Never blocks or delays the
link.

**Server.** `POST /api/track/message` (JSON):
- Ignores bots (user-agent) and requests with no `ph_sid` cookie (never issues one).
- Validates: `page` is a string starting with `/`, ≤ 200 chars; `source` is one of the
  allowed values (else `'other'`).
- If `page` is `/game/<slug>` and `<slug>` matches a game (`gameSlug(title)`), `game` =
  that slug; otherwise `game: null`.
- Drops a repeat of the same `session_id` + `game` + `source` within 60 seconds.
- Appends `{ date, time, session_id, page, game, source }` to new lowdb array `message_taps`
  (cap 50,000, oldest dropped). Responds 204.

### 1c. Funnel and dashboard

`server.js` visitor-funnel section (`sessionSummaries`, `visWindowMetrics`) and
`views/partials/admin/dashboard/site.ejs`:

- Rows used for sessions exclude paths starting `/api/` or `/webhook` (this cleans old data
  too). Sessions left with no rows disappear.
- Each session summary gains `messaged` (it has at least one `message_taps` row; taps carry
  `session_id`). A tap on a game page implies the game was viewed: `viewedGame` also becomes
  true for a session with a tap whose `game` is set.
- Funnel rows become **Landed → Viewed a game → Messaged us → Ordered on website → Paid**.
  "Messaged us" and "Ordered on website" are parallel outcomes, so the percentage shown on
  Viewed, Messaged and Ordered is the share of **Landed**; Paid shows its share of Ordered
  as today. (The owner-approved mockup showed Messaged as a share of Viewed; the share of
  Landed is used so it can never exceed 100%.) "Ordered on website" is the old "Started
  order" relabelled.
- The "Browsed the catalog — N of M sessions" note stays. When the window's skipped count
  (sum of `visitor_skips` over its dates) is > 0, the note adds
  "· N robot / system hits not counted".
- New card **"💬 Most asked-about games"** under the funnel: for the window, the top 5
  games by tap count (taps with a `game`), each showing cover, title, live availability
  badge (`N free` green / `booked` red) and its count, plus a muted line "+ taps with no
  specific game: N". Empty state: "No Message Us taps yet." Window handling follows the
  existing `VIS_WINDOWS` structure (today / week / month / year / all / byDate).
- New small card **"🔎 Searched, nothing found"** (Part 2): the top 5 `search_misses`
  queries for the window with counts. Empty state hidden.

**Shared availability helper.** The slot-count computation inside `/api/search-index`
(`computeAvailability(...)` summed over Trophy/Non-Trophy/PS4 per `resolveGamePrices` /
`resolveSlotDays`) is extracted into one function, `slotsFreeFor(game, accountSummaryMap)`,
used by `/api/search-index` and the "Most asked-about games" card. Behavior of the search
index is unchanged (test pinned).

## Part 2 — Homepage search

New partial `views/partials/home-search.ejs`, included by `views/index.ejs` directly above
the hero, for all three hero variants (slideshow, custom background, v2). The hero's H1 and
copy stay where they are.

**Strip:** small heading "What game are you looking for?", sub-line "See right away if it's
free.", a large rounded search input, then a "🔥 Popular right now" row of up to 4
chips (cover + title, linking to `/game/<slug>`). The chips are the first four games with a
cover from `featured`, the list that feeds the homepage "Most Popular" slider; the row is
omitted if there are none.

**Behavior** (`public/js/home-search.js`, loaded only on the homepage):
- Fetches `/api/search-index` once, on first focus (same endpoint and caching as the nav
  search). No new endpoint.
- Matches on every typed word against title (and the existing hidden bundle keywords `k`),
  diacritic- and punctuation-insensitive; shows up to 6 results, a dimmed backdrop, closes on
  Escape or outside tap.
- Result row = cover, title, one status line, price:
  - `y: 'now'` and `s > 0` → "● N slot(s) free" (green) · platform · "from ₱pr"
  - `y: 'now'` and `s === 0` → "● Fully booked · Fall in line free" (red), dimmed cover
  - `y: 'soon'` → "Coming soon · <date>"
  - `y: 'psplus'` → "★ Included in PS Plus Deluxe" · "Play via PS Plus"
  - `y: 'requested'` → "Requested · N votes"
  - each links to the entry's `u`.
- **No match:** "Not the one?" with two buttons — **Request a game** (`/requests?title=<typed>`,
  the existing prefill) and **Ask us on Messenger** (`m.me` link with text
  `Hi! Do you have <typed>? 🎮`, `data-track-source="search-empty"`).
- **Miss logging:** after 1.2 s without typing, if the query has ≥ 3 characters and zero
  results, `POST /api/track/search-miss` `{ q }` once per session+query. Server: ignores bots
  and cookie-less requests, normalizes (lowercase, trim, collapse spaces, ≤ 60 chars), appends
  `{ date, time, session_id, q }` to new lowdb array `search_misses` (cap 20,000), 204.
- Tapping a result is a normal navigation, so it is counted by the existing visit tracking
  as a game-page view. No separate event.

The nav's existing search icon and dropdown are unchanged.

## Part 3 — Messenger-first game page

`views/game-detail.ejs` and `public/js/game-detail.js` (rent panel only; buy panel and
PS Plus pages untouched).

**Primary button.** Directly under the type and duration pickers, a full-width Messenger-blue
button:
- game has any open slot → "💬 Message us about this game" (sub-line "Opens Messenger ·
  we reply fastest there")
- every type is full (`allUnavail`) → "💬 Ask us about this game" (sub-line "We'll tell you
  when it frees up — or suggest a similar one")

It **always opens** Messenger. `handleMessageUs` loses its "please select a rental duration"
gating, and `updateCtaState` no longer hides it when the selected type has no slot.

**Prefilled message** (built in `updateReserveLinks`, as today; type and duration are
optional):
- open slot: `Hi! I want to RENT a game 🎮 / Game: <title> / [Account Type: …] / [Duration: …]
  / [Total: ₱… (incl. promo %) + ₱… refundable deposit]` — same wording as today.
- fully booked: `Hi! I'm interested in <title> 🎮 / I saw it's fully booked — when is the
  next slot?` plus the type and duration lines if picked.
A read-only "YOUR MESSAGE WILL SAY" preview under the button mirrors this text and updates
as they pick.

**Account type and duration** pickers keep working unchanged; nothing requires them for the
Messenger path, and the preview shows what each pick adds to the message.

**Website order becomes secondary.** The name field, "To send now" summary box and gold
pay button move into a collapsed block opened by an outlined button "Or order here on the
website" (sub-line "Pay by GCash / Maya / card"). Opening it shows today's order form
unchanged, including validation and the `ctaValidationMsg` messages for that path. When the
selected type has no slot the order block stays hidden as today.

**Removed:** the small "or message us on Facebook instead" link (`#ctaMsgLink`) and the
"Send us: Game name · Days · …" hint (`#ctaHint`), both replaced by the primary button and
preview.

**Mobile sticky bar** (`#gdStickyBar`, ≤ 820px): left side keeps the existing kicker/amount
("From ₱<price>", or the selected total once chosen); the right button is the same Messenger
action, short enough for the bar ("💬 Message us" / "💬 Ask us"); tapping it taps the big button, so
the href and the tracking are the same. It no longer drives the website-order button.

**No-slot options** (`reserveSection`, queue line, priority reserve) stay unchanged.

**Tracking.** All `m.me` links on the page are caught by the global listener (Part 1b); the
primary and sticky buttons carry `data-track-source="game"`. The game comes from the page
path, so no extra attributes are needed.

## Data and storage

All new data lives in the existing lowdb `games.json` (synced to Mongo like `visitors`):

| Key | Shape | Cap |
|---|---|---|
| `visitor_skips` | `{ 'YYYY-MM-DD': n }` | none (one number per day) |
| `message_taps` | `[{ date, time, session_id, page, game, source }]` | 50,000 |
| `search_misses` | `[{ date, time, session_id, q }]` | 20,000 |

`db.defaults` gains the three keys. No personal data is stored beyond the existing hashed
session id; no Facebook identity is available or recorded.

## Error handling

- Tracking endpoints and the beacon never affect page behavior: failures are swallowed
  client-side; server routes respond 204 even when a record is dropped.
- Missing `/api/search-index` (network failure) leaves the homepage strip showing the
  "Popular right now" chips and, on typing, a "Search unavailable — Browse All Games" line linking
  to `/browse`.
- A game with no Messenger page configured: links keep using the existing hard-coded
  `m.me/PlaystationHub00`, as every other page does today.

## Testing

All tests use a temp `DATA_DIR`, blank `MONGODB_URI`, and fixtures; none touch the
project's `games.json` or any database.

- `scripts/test-visitor-filter.js` — `isBotUserAgent`, `classifyRequest` tables.
- `scripts/test-visitor-tracking.js` — boot the app: a human GET records a row and cookie;
  a bot GET, `/webhook` and `/webhooks/paymongo` POSTs and `/api/search-index` record no row
  and no cookie; skip counter increments for bot and webhook only; a human POST to an order
  route records no row but `req.sessionId` is set.
- `scripts/test-message-taps.js` — `POST /api/track/message`: valid game page tap stored with
  slug; unknown slug → `game: null`; bad `page`/`source` handled; bot and cookie-less
  ignored; 60-second dedupe; cap.
- `scripts/test-search-misses.js` — same pattern for `/api/track/search-miss`.
- `scripts/test-visitor-funnel.js` — fixtures through the funnel code: system paths drop out
  of old data; `messaged` and "viewed via tap" logic; row order and percentages; skipped-hits
  note; "Most asked-about" ordering and availability badge; misses list.
- `scripts/test-home-search.js` — rendered homepage contains the strip in each hero variant;
  `public/js/home-search.js` matching and status-line functions (extracted pure helpers) on
  fixture index entries.
- `scripts/test-game-detail-messenger.js` — rendered game page: primary button present for
  available and fully-booked fixtures, correct label; no `#ctaMsgLink`; order block collapsed
  by default; message text builder with and without type/duration; sticky bar uses the same
  href.
- Existing `test-js-extraction-game-detail.js` and the search-index test are updated, and the
  full suite must stay green except the known `scripts/test-requests-page.js` failure.

## Rollout

Direct on `main`, pushed when the owner says push; no schema migration. The funnel starts
counting "Messaged us" and skipped hits from deploy day; earlier days show 0 for those.
Verification is on fixture-rendered pages (never the production admin or data).

## Decisions made with the owner

- Most rent happens through Messenger; traffic arrives mostly from the Facebook page and
  posts to the homepage; visitors usually name a game.
- Approach B: numbers + homepage search + Messenger-first game page.
- Messenger-first on the game page; website order stays as a secondary option.
- Build order: Parts 1–3 now, Part 4 (PlayStation overview) next.

## Small differences from the approved mockups

- Homepage: the search strip sits directly above the hero rather than between the hero's
  headline and buttons, because the hero has three owner-selectable variants and its H1
  should not move.
- Funnel: "Messaged us" percentage is a share of Landed (not of Viewed), and Paid stays as a
  fifth row.
