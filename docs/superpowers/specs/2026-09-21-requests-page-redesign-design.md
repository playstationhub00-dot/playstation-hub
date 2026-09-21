# Requests Page Redesign — Design Spec

## Problem

`/requests` (`views/requests.ejs`) has two problems, both purely presentational — no data or route changes needed:

1. **The voting list is a long single-column scroll.** Each `.req-row` is ~90px tall (60px cover + padding + margin). With 11 voting requests that's ~1,000px of vertical scroll before anything else on the page is visible, on a page capped at `.req-page { max-width: 860px; }` — more than half of a typical desktop viewport's width sits unused while the page scrolls.
2. **The "✓ Now available" section (`.req-row-stocked`, server.js:1115-1116, `stockedRequests` in the render locals) already exists but renders dead last**, below every voting row. A customer has to scroll past the entire voting list to discover that a game they (or someone) requested is now rentable. This is the section that turns a request into a rental — it should not be the least visible part of the page.

Both `stockedRequests` and `votingRequests` are already computed and passed to the template (`server.js:1115-1120`); this is a template/CSS-only change.

## Chosen approach: stocked strip + two-column grid

Considered three options (tabs, this one, and a searchable leaderboard for 50+ requests); this one was chosen because it surfaces the stocked games without an extra click and roughly halves the voting-list scroll, at moderate build cost. A searchable/filterable list remains a reasonable future step if the request count grows well past today's ~15, but isn't needed now.

### Page structure (top to bottom)

1. Header (`<h1>`, subtitle) — unchanged
2. Flash messages — unchanged
3. "How it works" 3-step guide (`.req-guide`) + the request form (`.req-form`) — unchanged, same position. Someone landing here cold still needs the explanation before anything else.
4. **`stockedRequests` strip** — moved from last position to immediately after the form. Only rendered when `stockedRequests.length > 0` (same guard as today).
5. **`votingRequests` grid** — same section, now two columns wide at desktop width instead of one.

### The stocked strip

- Horizontal-scrolling row of compact cards, not a grid that grows downward. This is a bonus/payoff section, not the primary list — it should not compete for vertical space with voting, and a customer glancing at the page shouldn't have it push the voting list far down the page even if there are, say, 8 stocked titles at once.
- Each card: cover image (or the existing `🎮` placeholder for a missing cover), title, and a **Rent** button when `r.game_id` is present (identical guard to today's `req-btn-rent` — a stocked request's game record may not always resolve to a live `game_id` if data is inconsistent, so the button stays conditional).
- Drops the "Now available — you asked, we stocked it" per-card caption line in favor of one section-level label ("✓ Now available — you asked, we stocked it") in the section heading, the same way `.req-listhead` already labels the voting list. Per-card space is tight in a horizontal-scroll card; the label doesn't need repeating per card when the whole strip carries it once.
- No vote count shown (unchanged rule from today — "the votes did their job").
- On narrow viewports (≤640px, matching the existing `.req-guide` mobile breakpoint), the horizontal scroll remains but each card is wider so it reads comfortably one-at-a-time while swiping — this is the natural mobile pattern for a horizontal strip, not a layout change.

### The voting grid

- `.req-list` wraps the existing `.req-row` elements in `display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem;` at desktop width.
- Collapses to a single column (`grid-template-columns: 1fr`) at the same ≤640px breakpoint the rest of this page already uses.
- Row content, markup, and per-row classes (`.req-row`, `.req-votes`, `.req-cover`, `.req-main`, `.req-title`, `.req-voters`, `.req-voteform`, `.req-btn`) are **unchanged** — only the parent container becomes a grid instead of implicit block stacking. An odd row count (e.g. 11) leaves the last cell alone in its row on desktop, which is expected grid behavior and needs no special-casing.
- The empty state (`.req-empty`, shown when `votingRequests.length === 0`) is unaffected — it renders outside/instead of the grid exactly as today.

### Page width

`.req-page { max-width: 860px; }` → `max-width: 1100px`. Matches the treatment already used on other content pages in this codebase (e.g. `.gd-page`) rather than introducing a new width convention. Two columns of voting rows need real width to not feel cramped; 860px halved is too narrow for the existing row content (cover + votes + title + voters + button) to sit comfortably.

### Explicitly out of scope

- No changes to `/requests/add`, `/requests/:slug/vote`, rate limiting, dedupe, or any `gameRequests` lib logic.
- No changes to the request form's client-side validation script (bottom of `requests.ejs`).
- No search box or filter chips — not needed at the current request count (~15); can be layered on top of this structure later without a rebuild if the list grows.
- No change to how a request becomes "stocked" (that's an admin-side action, untouched here).

## Testing

- A stub-data render harness exercises `requests.ejs` with `stockedRequests`/`votingRequests` counts of 0, 1, and 11+4 (today's real numbers) to confirm the template doesn't error and the grid/strip render correctly at each count, including the empty-voting-list state.
- Real-browser verification: seed representative data, screenshot at desktop (~1400px) and mobile (~390px) widths, confirm the stocked strip appears above the voting grid, the grid is genuinely two columns at desktop and one at mobile, and the horizontal-scroll strip is scrollable rather than overflowing/clipped.
