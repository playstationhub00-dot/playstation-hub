# Session-Based Visitor Tracking + Funnel View — Design

**Date:** 2026-08-10
**Status:** Approved design, pending implementation plan

## The problem

The visitor tracker records one row per HTTP request, keyed by IP address, with no concept of "this is the same person across multiple pages." Two failures follow from that:

1. **The IP itself was wrong until 2026-08-10.** The app sits behind Cloudflare; the tracker read `x-forwarded-for`, whose first hop through Cloudflare's proxy is one of Cloudflare's own edge addresses, not the visitor's. A live sample showed 39 of 40 recent "unique" IPs were Cloudflare ranges. This was fixed separately (commit `634cd66`, reading `CF-Connecting-IP` first) and is not part of this plan — but it only fixed *which* address gets recorded, not the deeper problem below.

2. **IP was never going to be a valid visitor identity in the Philippines even once correct.** Globe and Smart both use carrier-grade NAT — many unrelated mobile users legitimately share one public IP at the same time. Grouping by IP means merging strangers into one "visitor" and splitting one real person across several, with no way to tell which is happening.

The practical cost: there is no way today to answer "how many distinct people visited, and where did each one stop." The admin dashboard reports raw pageview counts and calls them visitors. The conversion-rate work shipped 2026-08-09 (game-page CTA flip, order-start-rate readout) inherited this — its denominator is real page-hit counts, but "unique visitors" anywhere else in the dashboard is not a trustworthy number.

## What changes

### 1. A first-party session cookie, no new dependency

On any request without a `ph_sid` cookie, the server generates one (`crypto.randomBytes(16).toString('hex')`) and sets it — `httpOnly`, `sameSite: 'lax'`, 30-day max age, refreshed on every request so the 30 days count from the *last* visit, not the first. A returning visitor a week later is still the same session; a new browser is a new one.

Express does not parse `Cookie` headers without the `cookie-parser` middleware. This project has no build step and consistently avoids dependencies where plain code suffices — reading and writing one cookie by hand is under ten lines, so no new package is added. `req.headers.cookie` is parsed with a small helper; the response uses `res.setHeader('Set-Cookie', ...)` directly.

### 2. IP is hashed, not stored raw

While editing the tracking middleware, `visitors[].ip` moves from the raw address to `sha256(ip)`. The value is still useful for grouping and abuse detection (the rate limiter keeps working identically, since it hashes independently of what's displayed) but is no longer a plaintext address sitting in a lowdb file behind one shared admin password. This is a natural inclusion here, not a separate task, since the same line of code is already being touched.

### 3. Funnel stages are derived, not separately tracked

No new "current stage" field is written per session. Each stage is computed from data that already exists, at read time:

| Stage | Derived from |
|---|---|
| Landed | First `visitors` row for a `session_id` |
| Browsed | Any row in the session with `path === '/browse'` |
| Viewed a game | Any row in the session with `path` starting `/game/` |
| Started an order | An order exists (`lib/orders.js`) whose `session_id` matches |
| Paid | That order's state is anything past `awaiting_payment`/`verifying_payment`/`payment_rejected` (same "completed" definition already used by the weekly funnel readout shipped 2026-08-10) |

**Orders need one new field to make the "Started" and "Paid" stages possible at all:** `session_id`, stamped onto the order document in `orders.create()`, read from the `ph_sid` cookie at the moment `/order/create` handles the request — mirroring exactly how `fb_name` and the auto-generated `url_key` are already set at creation. Without this, an order can never be linked back to the browsing session that produced it.

### 4. Only sessions from launch forward are counted

`visitors` rows and `orders` created before this ships have no `session_id`. The funnel view only counts sessions where a `session_id` exists — nothing is backfilled, inferred, or guessed at retroactively. This is the same rule Task 2 of the conversion-rate work used for linking orders to customer records: new data is correct; old data is left alone rather than corrupted by a best-effort guess.

### 5. The admin view: funnel + top exit pages

A new subsection under the existing Visitors tab, with two parts:

**Funnel drop-off**, session-scoped (post-launch sessions only), using the exact five stages above:

```
Landed          412 sessions
Browsed          98  (24%)
Viewed a game    61  (62%)
Started order     4  (7%)
Paid              1  (25%)
```

Each percentage is relative to the row above it (conversion at that specific step), not to the top of the funnel — so "62%" answers "of people who browsed, how many viewed a game," which is the actionable number; a percent-of-total figure would bury exactly where the biggest single drop happens.

**Top exit pages** — for each session, the `path` of its most recent row stands in for "the last page this person looked at" (there's no way to detect a tab close directly, so the last page recorded before the session goes quiet is the closest available proxy), grouped and ranked by frequency across all post-launch sessions:

```
/game/007-first-light        18 sessions
/browse                      11 sessions
/                              9 sessions
```

This is the direct answer to "why don't they order" that the funnel's percentages can only gesture at — if a large share of exits happen on one specific game page or one specific step of the booking panel, that names the actual friction point instead of leaving it a guess.

## What deliberately does not change

- **The Cloudflare IP fix** (`634cd66`) is already shipped and is a prerequisite this design builds on, not part of this plan.
- **No individual-session drill-down UI.** The design doc that proposed this work noted that at this traffic volume, individual journeys are worth eyeballing — but that's a `db.get('visitors').value()` filter an admin can already run by hand if needed; it does not need a dedicated view for v1.
- **No change to the existing weekly funnel readout** ("N started · N completed · N abandoned · X% of game-page visits") shipped with the conversion-rate work. That reads from `orders` directly and stays exactly as built; this plan adds a second, complementary view scoped to browsing sessions, not a replacement.
- **No third-party analytics.** Rejected during design — an external tool would mean maintaining two systems instead of fixing the first-party one that already exists and already feeds the rest of the admin dashboard.
- **No cross-device identity.** A session is a browser, not a person. Someone who browses on their phone and later orders from a laptop is two sessions. This is a known, accepted limitation of first-party cookies and is not solvable without login accounts, which are explicitly out of scope for this business (per the earlier rental-orders-v1 design: "no customer accounts").

## Out of scope

- Backfilling `session_id` onto historical `visitors` or `orders` rows.
- Any UI beyond the funnel counts and the top-exit-pages list (no charts, no date-range picker beyond what the existing Visitors tab already has).
- Deduplicating the weekly conversion-rate readout's pageview-based denominator to use sessions instead — that was explicitly deferred by the site owner during the conversion-rate work and is not reopened here.
