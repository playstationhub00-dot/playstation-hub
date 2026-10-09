# Browse redesign: combinable filters, tier pills, PS Plus in results — Design

Date: 2026-10-09 · Status: approved by owner; amended after the plan's dry run; filters moved into a floating panel (owner's follow-up the same day)

## Problem

- Browse filter chips do not combine. Each chip is a plain link that keeps only the
  search box, so tapping "Available now" while "Plays on PS4" is on drops PS4 — yet the
  chip counts are computed as if filters combined, so the numbers lie.
- Filters are hidden: a genre needs 3+ games to get a chip, any chip whose count is 0
  disappears, there is no PS5 chip, no tier chip and no price chip.
- Results are always split into one section per price category (Bundles, New Games,
  Deluxe, Special, Regular, Other), and each grid fits as many cards as the screen allows.
- Nothing on a card tells the customer which tier (price category) a game is in. The
  word "New" means two things: the 11-day corner badge / "New" chip, and the "New Games"
  tier.
- PS Plus Deluxe catalogue games (hundreds, one account rental) never appear in Browse
  results.

## Decisions made with the owner

- **Combining:** different groups narrow (AND); two options in one group widen (OR).
- **Groups:** Show · Tier · Console (PS4, PS5) · Genre (every genre) · Price (bands).
- **0-result options stay visible**, dimmed, and cannot be ticked.
- **Price bands** come from two cut-offs the owner sets in admin (default 200 and 300).
- **Layout (option A):** no filter on → today's sections (one per tier), max 6 cards per
  row; any filter on → one grid of every match, max 6 per row, sorted by tier (admin
  order) then A–Z.
- **Floating filter panel** (like a shopping app's "Filters" screen): opened from a
  "Filters" button, full screen on phones, a centred pop-up on computers. Options are
  tick-box rows with counts; each section has its own "Clear"; the panel has "Clear all".
- **Applied on "Show N games":** ticks are a draft until the big bottom button is tapped;
  the button counts live. Closing the panel any other way throws the draft away.
- **Sticky filter bar** under the menu: the "Filters" button, one removable chip per
  active filter (tap ✕ to drop it at once), "Clear all", and the result count.
- **No reload** when filters change, with the address bar kept in sync.
- **Tier pill** (coloured pill above the title) on every game card and on the game page.
- **Tier descriptions** written by the owner in admin, shown under tier headings and on
  each tier's row in the filter panel (with its starting price).
- **"New" badge and chip renamed "Just added".** "New" then means only the New Games tier.
- **PS Plus Deluxe games** appear in their own section under the results whenever a
  filter or search is on, plus a "PS Plus Deluxe" option in the Tier group.

## Out of scope

- Changing what a price category is, how games are priced, or the per-game discounts.
- Homepage layout (its rows only gain the tier pill on their cards and the "Just added"
  wording).
- The PS Plus page (`/ps-plus`) itself.
- Merging similar genre names automatically ("RPG" vs "Role Playing Games"): a PS Plus
  game only matches a Genre chip whose name equals its PlayStation genre.

## Filters

In the rules below a "chip" is one filter option (a tick-box row in the panel); the
removable chips in the filter bar are the options currently applied.

### Groups and options (in this order)

| Group | Options | Matches a site game when… |
|---|---|---|
| Show | Available now | a slot is free (today's rule: with only the PS4 chip on, a PS4 slot must be free) |
| | Just added | added within its New window (`new_window_days`, default 11 days) — today's `isAddedThisMonth` |
| | Can buy | it has a buy price (today's rule) |
| | Bundles | it is a bundle (today's rule) |
| Tier | one chip per price category, admin order | `price_category_id` is that category |
| | PS Plus Deluxe (gold) | never — it selects the PS Plus section (below) |
| Console | PS4 | `platform` is `PS4` or `PS4/PS5` |
| | PS5 | `platform` is `PS5` or `PS4/PS5` |
| Genre | every genre among the site's games, A–Z; a game's free-text `genre` is split on "," and "/" ("Action, RPG" → Action, RPG) | one of its genre parts equals the chip |
| Price | Under ₱A · ₱A–(B−1) · ₱B+ | the card's "from ₱X" price falls in the band |

- **"From" price** = exactly the number the card shows: the cheapest final price across
  Weekly/Monthly × Non-Trophy/Trophy (Trophy only when the game has trophy slots), after
  the game's own discount or the site promo (`gameDiscountPct`). Games with no price fall
  in no band.
- Games with no price category match no Tier chip (they still appear when no Tier chip is
  on).

### Combining

- Within a group, selected chips are OR'd; across groups, AND'd; a group with nothing
  selected does not filter. Search (title, description, bundle contents — today's rule)
  is AND'd with everything.
- Console + Available now: "with only the PS4 chip on" means PS4 is selected and PS5 is
  not; otherwise "available" means any slot type is free (today's rule).

### Counts and 0-options

- Each option shows how many games the customer would see if that option were **ticked**
  in the panel's current draft, every other tick kept (for an option already ticked: the
  draft's result count). That is the site games — or, when only PS Plus games would show
  ("PS Plus Deluxe" the only Tier option ticked), the PS Plus games.
- An option that is not ticked and would give 0 is dimmed and its tick box disabled. A
  ticked option can always be unticked.
- Tier "PS Plus Deluxe" counts PS Plus games instead (see below).
- Every option is always listed — nothing hides because of its count. An option is left
  out only when nothing in the whole library could ever match it (no "Bundles" when there
  are no bundles at all, no "PS Plus Deluxe" when the PS Plus list is empty); a section
  with no options is left out.

### The filter bar

- Directly under the menu bar, above the games, and it stays there while scrolling
  (`position: sticky` just below the 64px menu).
- Contents: a "Filters" button ("Filters · N" when N options are on) that opens the
  panel; one removable chip per applied option ("Deluxe ✕", "PS4 ✕", "Under ₱200 ✕", and a
  search as `"elden" ✕`) — tapping one removes that filter at once, no panel; "Clear all"
  when two or more filters are on; at the right "N games" ("N PS Plus games" when only
  PS Plus games show).

### The filter panel

- **Phones (< 768px):** full screen, slides up. **Computers:** a centred pop-up up to
  560px wide and 85% of the screen tall, the games dimmed behind it.
- **Header:** ✕ (closes) · "Filters" · "Clear all" (unticks everything — still a draft).
  **Footer:** the big "Show N games" button. Only the middle scrolls; the page behind does
  not scroll while the panel is open.
- **Sections** in order Show · Tier · Console · Genre · Price, each with its title and a
  "Clear" link (shown when something in it is ticked). One row per option: name, count,
  tick box. Tier rows also show the tier's coloured dot and a second line with its
  description and "from ₱X" (the lowest card price among its games); the PS Plus Deluxe
  row reads "Hundreds of games, one account · from ₱X/week". A section with more than 6
  rows shows 6 then "Show all N" (ticked options always show).
- **Draft until applied:** ticking only changes the panel — counts and the button update
  live: "Show 10 games"; "Show 36 PS Plus games" when only PS Plus games would show; "No
  games match" (not tappable) when nothing would. "Show N games" applies the draft (games
  and URL update, panel closes). ✕, Escape or tapping outside (computers) closes and
  throws the draft away. Opening again starts from the applied filters.
- **Accessibility:** `role="dialog"`, `aria-modal="true"`, labelled "Filters"; focus moves
  into the panel on open and back to the Filters button on close; tick boxes are real
  checkboxes with labels.
- **Without JavaScript** the panel is a plain GET form to `/browse` (checkbox names
  `avail`, `new`, `buy`, `bundle`, `tier`, `psplus`, `console`, `genre`, `price`); the
  Filters button is a link to `#bfPanel`, which CSS shows (`:target`), and its button
  reloads the page with the result. Repeated params (`tier=2&tier=3`) read like
  `tier=2,3`.

### Instant filtering and URLs

- One pure module, `public/js/browse-filter-core.js` (UMD, same pattern as
  `home-search-core.js`), holds: URL ⇄ state parsing, matching, counting, price banding,
  sorting. `server.js` requires it for the first render; the page loads it for taps.
- The server renders every site game card once (each wrapped in `.bf-item[data-id]`) and
  embeds, as JSON, the facts the core needs for each game (tier id, PS4/PS5, genres,
  from-price, available-now, available-on-PS4, just-added, can-buy, bundle, title, search
  text, home section), the PS Plus list and the current state. The panel re-runs the core
  on its draft for the live counts; applying (or removing a chip) re-runs it on the new
  state, moves the existing cards between their home sections and the one grid, redraws
  the bar, and `history.replaceState`s the URL. No network request.
- URL params: `tier=2,3` · `console=ps4,ps5` · `genre=Action,Horror` (each name URL-encoded) ·
  `price=low,mid,high` · `avail=1` · `new=1` · `buy=1` · `bundle=1` · `search=…` ·
  `psplus=1` (the PS Plus Deluxe tier chip).
- Old links keep working: `ps4=1` → console=ps4; `newOnly=1` → new=1; single
  `genre=Horror` already fits; `unit=ps4|ps5` and `platform=PS4` keep today's meaning.
- Without JavaScript the server-rendered site results are already correct for the URL and
  the panel works as a form (above), just with reloads. The PS Plus section needs the
  page script (it is drawn from the embedded list).

## Results layout

- **No filter and no search:** unchanged order — Coming soon, Account Bundles, one
  section per tier (admin order), Other games, PS Plus monthly. Each section heading gets
  the tier's description underneath when one is set.
- **Any filter or search:** Coming soon, the tier sections and the PS Plus monthly
  section are replaced by one grid of every matching site game, sorted by tier (admin
  order; no tier last) then title A–Z. Bundles sort with their tier like any game. Then
  the PS Plus section (below).
- **Grid width:** all Browse game grids cap at 6 columns (`repeat(auto-fill, minmax(…))`
  with a max width so a 7th column never fits); phones stay at 2 columns.
- "No games found" message when the site grid is empty, unless the PS Plus section has
  matches (then a short "None of our own games match — but these PS Plus games do").

## "Also in PS Plus Deluxe" section

- **Source:** the public PS Plus catalogue the `/ps-plus` page uses
  (`psplusCatalogView.buildPublicCatalog` items: catalogue games plus monthly-only
  tiles), visible items only.
- **Shown** when any filter or search is on, below the site grid, titled
  "Also in PS Plus Deluxe · N games · one account, play them all". Hidden when N is 0.
- **Filter rules for PS Plus items:**
  - Search: name contains the query (same normalisation as the site search).
  - Console: item `platforms` includes PS4 / PS5 (an item with no platform info matches
    neither chip when a Console chip is on).
  - Genre: item genre (`prettyGenre`, e.g. "Action", "Role Playing Games") equals a
    selected genre chip.
  - Available now: the PS Plus Deluxe account has a free slot (the availability of the
    site's "PS Plus Deluxe" game entry, the one `/ps-plus` reads slots from); else none.
  - Just added: `first_seen_at` within the last 11 days.
  - Can buy or Bundles on: section hidden (PS Plus games cannot be bought or bundled).
  - Price: every item uses the PS Plus "from ₱X" weekly price shown on `/ps-plus`.
  - Tier: no Tier option on → shown; PS Plus Deluxe on → shown; other Tier options on
    without PS Plus → hidden.
- **PS Plus Deluxe as the only Tier option:** site games are not shown at all — the site
  grid and the "No games found" message are omitted, and the bar reads "N PS Plus
  games". With PS Plus plus other Tier options on, both the site grid (those tiers) and
  the PS Plus section show.
- **Card:** cover (or a plain title tile), gold "PS Plus" pill, name, "via PS Plus ·
  from ₱X". Links to `/ps-plus?game=<key>` (the PS Plus page opens that game's sheet;
  monthly-only tiles have keys there too). Drawn by `public/js/browse.js`.
- **Many matches:** first 24 shown, then "Show all N" reveals the rest (client-side).
- A game that is both a site game and a PS Plus game may appear in both places.
- **PS Plus Deluxe tier option count** = matching PS Plus items under the other filters.

## Telling tiers apart

### The tier pill

- `views/partials/game-card.ejs`: a pill above the title with the category name, in the
  category's pill colour. Not shown for games without a category, nor for bundles (which
  already say "Bundle · N games").
- `views/game-detail.ejs`: the same pill in the badge row just above the title.
- Pill colours (fixed palette, readable on the dark card): blue, purple, coral, grey,
  teal, pink; PS Plus is gold and not selectable.
- **Pill look (owner's follow-up, option A):** a solid tag with white uppercase text,
  0.6px letter spacing and a small drop shadow (`0 2px 6px rgba(0,0,0,.45)`), and
  `text-shadow: none` — the card body's dark text glow (`.gc2-body`) must not reach the
  tag (that glow is what made the first pale pills hard to read). Solid fills: blue
  `#2563EB`, purple `#7C3AED`, coral `#C2410C`, grey `#57534E`, teal `#0F766E`, pink
  `#DB2777`, all with white text; PS Plus gold `#F0A500` with dark `#1A1200` text. The
  colour names (and so the admin choices and the automatic-by-name rule) are unchanged;
  the filter panel's tier dots take the same solid colours.

### Admin: price category

Two new fields on the category add/edit forms (`views/partials/admin/games/categories.ejs`,
`POST /admin/price-categories/add|edit/:id`):

- **Pill colour** — "Automatic (from the name)" or one of the six colours. Automatic
  (stored as no colour) picks by name: contains "new" → blue, "deluxe" → purple,
  "special" → coral, otherwise grey. Anything not one of the six → keep the old value
  (edit) / automatic (add). The category row in admin previews its pill.
- **Description** — one line, max 120 characters, trimmed; empty allowed.

### Tier descriptions

Shown under each tier's section heading on Browse (no filter on) and on each tier's row
in the filter panel, with "from ₱X" (lowest card price among its games). There is no
separate "What are tiers?" box.

### "Just added"

The 11-day corner badge text (`gc2-badge-new`) and the Show option become "Just added".
Its timing is unchanged.

## Admin: price bands

Settings gets a small "Browse price filter" card: two whole numbers A < B (defaults 200,
300), saved to `site_settings.browse_price_bands = { low: A, high: B }` via
`POST /admin/browse-price-bands` (requireAuth). Invalid input (non-numbers, A ≥ B, ≤ 0)
is rejected with an error toast and nothing saved. Options read "Under ₱A", "₱A–(B−1)",
"₱B+".

## Error handling

- Unknown or malformed URL params are ignored; a tier id or genre the page has no chip
  for (a deleted category or a genre no game has any more) is dropped, so an old link
  never hides every game.
- A PS Plus catalogue that has not loaded (Mongo down) → the PS Plus section and option
  are simply absent; the rest of Browse works.

## Testing

All tests use fixtures, a temp `DATA_DIR`, blank `MONGODB_URI`, an in-memory session
store and a made-up admin password; nothing touches the project's `games.json`, the
database or the real admin.

- `scripts/test-browse-filter-core.js` — the pure module: URL parse/serialize (incl. old
  params), AND across groups / OR within, counts and 0-chips, console + available rule,
  price bands from from-prices, tier sort then A–Z, PS Plus item rules (each filter,
  tier-chip combinations, Can buy/Bundles hide), "Show all" limit.
- `scripts/test-browse-page.js` — boots a throwaway instance: unfiltered page keeps tier
  sections with descriptions; `?tier=…&console=ps4&genre=…` renders one grid in the right
  order; the bar's removable chips and count; the panel's sections, rows, counts, dimmed
  0-options, tier rows with description and price, form names, "Show N games"; old
  `?ps4=1` / `?newOnly=1` links and repeated params work; PS Plus section rules (PS Plus
  catalogue store stubbed with fixture items).
- `scripts/test-tier-pill.js` — pills on browse cards, homepage cards and the game page;
  none for uncategorised games and bundles; "Just added" wording; category pill colour /
  description save (defaults by name, invalid input, login required).
- `scripts/test-admin-price-bands.js` — price band save and rejection, login required.
- Existing tests stay green except the known `scripts/test-requests-page.js`; any
  existing test that asserts the old single-link chips or the "New" badge text is updated
  to the new behaviour.

## Rollout

Direct on `main`, pushed when the owner says push. Until the owner writes tier
descriptions they are simply absent; pill colours default by name; price bands default to
200/300.
