# Inline JavaScript Extraction — Design

**Date:** 2026-09-22
**Status:** Approved for implementation
**Scope:** Phase 2 of the performance effort. Phase 1 (static asset caching) is complete, deployed, and verified.

## Goal

Stop re-sending page logic that never changes per-visitor. Today the 5 heaviest
public pages ship their JavaScript inline — code that can never be cached,
re-downloaded in full on every single page load. Moving it to external files
lets Phase 1's caching cover it too: a year, immutable, busted only on deploy.

## Measured scope

| File | Inline JS size | Interpolated `const`s |
|---|---|---|
| `views/game-detail.ejs` | 27.5 KB | 9 |
| `views/index.ejs` | 16.0 KB | 6 |
| `views/upcoming-detail.ejs` | 15.5 KB | 9 |
| `views/psplus-rent.ejs` | 8.2 KB | 6 |
| `views/order-status.ejs` | 8.8 KB | 1 |

~76 KB total. These are the 5 heaviest public-facing pages; admin pages and the
smaller public pages (`ps-plus.ejs`, `requests.ejs`, `browse.ejs`, `buy.ejs`,
`bundle.ejs`, each under 3 KB) are out of scope for this phase.

## What the code actually looks like

Each of the 5 files' inline `<script>` blocks is mostly pure logic — event
handlers, DOM updates, fetch calls — interspersed with a handful of `const`
declarations that pull in server-rendered values (prices, promo settings,
gallery counts, availability flags). These are **not** clustered at the top:
in `game-detail.ejs`, `gameTitle` and `gdSlideCount` are declared 456 and 551
lines into a 603-line block. In `upcoming-detail.ejs`, `ALL_FULL` and
`gpSlideCount` are similarly scattered.

Within each file, no two blocks declare the same global name — checked with
`grep -oE '^(const|let|function) \w+' <file> | sort | uniq -d`, empty for all
five. Extracting is therefore safe per file with no cross-block collision risk.

One interpolated `const` is not page-level like the rest: `gameTitle` in
`game-detail.ejs` is declared *inside* `function updateReserveLinks()`
(`views/game-detail.ejs:1028`), not at the top of the script block. Its value
— `game.title` with quotes escaped — is static for the page's whole life, so
hoisting it to a one-time page-level `const` and deleting the inner
declaration is behaviorally identical (same value, computed once instead of
recomputed identically on every call). This is called out explicitly here
because it is a materially different move than the rest: the others add a
new top-level declaration; this one also requires deleting the original
inner one, or the function-local `const` would shadow the hoisted global and
silently negate the change to the exact line it was meant to move.

**This pattern already exists in the codebase.** `game-detail.ejs`,
`upcoming-detail.ejs`, and `psplus-rent.ejs` already split
`RENTAL_DURATIONS` into its own tiny inline `<script>` immediately before the
big logic block, which reads it as an already-declared global — e.g.
`views/game-detail.ejs:572-573`. This design extends that existing, proven
pattern rather than introducing a new one.

## Design

### The extraction pattern, applied per file

1. **Hoist every interpolated `const`** out of the big logic block into one
   small `<script>` at the same position the big block used to start, keeping
   the exact same variable names and EJS expressions. This block stays
   server-rendered and inline — it is genuinely dynamic per-request and cannot
   be cached, but at 10-20 lines it is a rounding error next to what it
   replaces.
2. **Move everything else verbatim** into a new file at
   `public/js/<page-name>.js`, with no rewrites. Because a plain
   `<script src="...">` (no `type="module"`) shares the page's global scope
   exactly like an inline `<script>` does, a bare reference to `RENT_PRICES`
   in the moved code still resolves correctly — the small inline block a few
   lines above it already declared that global.
3. **Load the external file in the exact same document position** the
   original inline `<script>` occupied, with no `defer` or `async`. This is
   the core safety property of this design: execution order and timing are
   byte-for-byte unchanged. The only difference is where the bytes come from.
4. **Version the `<script src>` with `?v=<%= assetV %>`**, identical to every
   other cacheable asset from Phase 1, so it gets the immutable cache and is
   correctly busted on every deploy.

### Why this is the safe choice (Approach A of three considered)

Two alternatives were considered and rejected for this phase:

- **Consolidate into a single `window.PAGE_DATA` object and load with
  `defer`.** Bigger win (non-blocking parse), but changes *when* the code
  runs relative to DOMContentLoaded and relative to the page's other scripts
  — real behavior risk, not just a caching change. Rejected under the
  "safe wins only" risk posture.
- **Serialize data into a `<script type="application/json">` island and
  `JSON.parse` it.** Cleaner (no global pollution), but requires rewriting
  every reference in the moved code from `RENT_PRICES` to
  `PAGE_DATA.RENT_PRICES` — potentially dozens of call sites per file, each
  one a chance for a typo to silently break behavior. Rejected because the
  chosen approach achieves the same caching win with zero rewrites.

### Verification that the move is truly byte-identical

For each file, after extraction: diff the original inline block (captured
before editing) against the concatenation of {hoisted data block +
`public/js/<page>.js`}, modulo only the physical relocation and the
`<script>`/`<script src>` wrapper lines. Any difference beyond that is a bug
introduced during the move, not an intentional change — this phase makes no
logic changes.

## Explicitly out of scope

- **Admin pages** (`admin.ejs` at 16.2 KB, `edit-customer.ejs` at 6.2 KB, and
  others). Deferred — a separate, smaller pass, not customer-facing.
- **The smaller public pages** (`ps-plus.ejs`, `requests.ejs`, `browse.ejs`,
  `buy.ejs`, `bundle.ejs`) — each under 3 KB inline, the win is marginal next
  to the risk of touching 5 more files.
- **`defer`/`async` loading, bundling, or any consolidation of the 5 new files
  into one.** Each stays a separate file matching its originating view — this
  phase is extraction only, not a build pipeline.
- **Any logic change, cleanup, or refactor of the moved code**, per the
  confirmed "safe wins only" posture, even where something looks odd while
  moving it. A finding worth acting on gets flagged, not silently fixed.

## Testing

Per file, a behavioural test extending the pattern from
`scripts/test-static-caching.js`: boot the real server, request the page,
confirm the external script tag is present with the correct `?v=` value and a
200 response, and confirm the file no longer contains the moved code inline
(a source-text check that the specific extracted function/handler names are
no longer present in the `.ejs` file's own text, only in the new `.js` file).

This is necessarily lighter than a full behavioral replay of every extracted
interaction — full behavioral coverage for 5 pages' worth of JS is a browser
task, covered in Verification below, not something a fast Node script can
assert cheaply. The Node test's job is to catch a bad extraction (wrong
file, wrong version marker, code left behind) fast; the browser pass catches
a wrong extraction (behavior actually changed).

## Verification

For each of the 5 files, after extraction:

1. Run the file's new Node test; prove it fails before the extraction and
   passes after.
2. Run the full `scripts/test-*.js` suite — no regressions.
3. On a local scratch copy (`requireAuth` bypassed, test-only, never
   committed — this project's established practice for admin-page checks;
   these 5 pages are public so no bypass is even needed here), load the real
   page in the browser and exercise the actual interactive surface the
   moved code drives: for `game-detail.ejs`, changing rental
   duration/type and confirming the price updates; for `index.ejs`, whatever
   the homepage's inline scripts drive (confirmed per-file during
   implementation); for `upcoming-detail.ejs`, the reservation summary
   updating as duration/type changes; for `psplus-rent.ejs`, the same
   pattern; for `order-status.ejs`, the "already paid" modal dismissal —
   the IIFE at `views/order-status.ejs:491-513` shows a one-time modal keyed
   by `localStorage`, confirm it still shows once and stays dismissed on
   reload after being closed.
4. Confirm via the browser's network panel that the external `.js` file
   loads with `Cache-Control: public, max-age=31536000, immutable` (Phase 1's
   header logic already covers any versioned `public/` request — no further
   caching code needed here).
5. Confirm no console errors on page load or during the interaction above.

## Risks

| Risk | Mitigation |
|---|---|
| A hoisted `const` was missed, left behind, or duplicated | Per-file diff check (see "Verification that the move is truly byte-identical") before committing each file |
| A function-local interpolated const (like `gameTitle`) gets hoisted without deleting the original inner declaration, so the inner one silently shadows the hoisted global | Called out explicitly above with its exact line; the per-file task in the plan must delete the inner declaration, not just add the outer one |
| An interpolated value's surrounding JS expression breaks when physically moved (e.g. it referenced a same-block local declared between it and where it's hoisted to) | Manually inspected the actual context of every interpolated value in all 5 files during spec review (not just grepped for name collisions): `game-detail.ejs`'s 9 are page-level except `gameTitle` (handled above); `upcoming-detail.ejs`'s `ALL_FULL` and `gpSlideCount` are page-level despite being mid-block; `order-status.ejs`'s single interpolation sits inside a self-contained IIFE with no external references, the simplest case of the five. None reference a same-block JS-only local. |
| Execution timing changes | Explicitly avoided: no `defer`/`async`, external `<script src>` placed in the exact document position the inline block occupied |
| A file this phase doesn't touch (an admin page, or a smaller public page) already references a global one of these 5 files declares | Out of scope for this phase; would only matter if two views load in the same document, which none of these do (each is a full page render) |

## Success criteria

- All 5 files' large inline `<script>` blocks are replaced by a small
  EJS-rendered data block plus a versioned `<script src>`
- No behavior change: every interactive feature on all 5 pages works
  identically to before, verified in a real browser
- The 5 new files are served with the immutable cache from Phase 1
- Full test suite green, including the 5 new per-file tests
- ~76 KB moves from "re-sent every page load" to "cached for a year"
