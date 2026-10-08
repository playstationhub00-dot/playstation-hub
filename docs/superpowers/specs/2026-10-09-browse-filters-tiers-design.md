# Browse redesign: combinable filters, tier pills, PS Plus in results — Design

Date: 2026-10-09 · Status: approved by owner; amended after the plan's dry run

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

- **Combining:** different groups narrow (AND); two chips in one group widen (OR).
  Every chip is a toggle.
- **Groups:** Show · Tier · Console (PS4, PS5) · Genre (every genre) · Price (bands).
- **0-result chips stay visible**, dimmed and dashed, and cannot be tapped.
- **Price bands** come from two cut-offs the owner sets in admin (default 200 and 300).
- **Layout (option A):** no filter on → today's sections (one per tier), max 6 cards per
  row; any filter on → one grid of every match, max 6 per row, sorted by tier (admin
  order) then A–Z.
- **Show/Hide filters:** open on computers ("Hide filters" link), hidden behind a
  "Filters · N on" button on phones.
- **Instant filtering** (no reload) with the address bar kept in sync.
- **Tier pill** (coloured pill above the title) on every game card and on the game page.
- **Tier descriptions** written by the owner in admin, shown under tier headings and in a
  "What are tiers?" panel.
- **"New" badge and chip renamed "Just added".** "New" then means only the New Games tier.
- **PS Plus Deluxe games** appear in their own section under the results whenever a
  filter or search is on, plus a "PS Plus Deluxe" chip in the Tier group.

## Out of scope

- Changing what a price category is, how games are priced, or the per-game discounts.
- Homepage layout (its rows only gain the tier pill on their cards and the "Just added"
  wording).
- The PS Plus page (`/ps-plus`) itself.
- Merging similar genre names automatically ("RPG" vs "Role Playing Games"): a PS Plus
  game only matches a Genre chip whose name equals its PlayStation genre.

## Filters

### Groups and chips (in this order)

| Group | Chips | Matches a site game when… |
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

### Counts and 0-chips

- Each chip shows how many games the customer would see if that chip were **toggled
  on** with every other selection kept (for a chip already on: the current result
  count). That is the site games — or, when only PS Plus games would show ("PS Plus
  Deluxe" the only Tier chip on), the PS Plus games.
- A chip that is off and would give 0 is rendered dimmed/dashed, `aria-disabled`, and
  cannot be tapped. A chip that is on is always tappable (to turn it off).
- Tier "PS Plus Deluxe" counts PS Plus games instead (see below).
- Every chip is always rendered — nothing hides because of its count under the current
  filters. A chip is left out only when nothing in the whole library could ever match it
  (no "Bundles" chip when there are no bundles at all, no "PS Plus Deluxe" chip when the
  PS Plus list is empty); a group with no chips is left out.

### Bar under the chips

"N games found" · "Clear all" (shown when anything is on, keeps nothing) · on computers
"Hide filters" / "Show filters" at the right.

### Show / hide

- Computers (≥ 768px): filters open; "Hide filters" collapses the chip groups to one line
  "Filters · N on".
- Phones (< 768px): start collapsed as a "Filters · N on" button; tapping opens the
  groups in place. Opening/closing does not change the URL. The choice is not remembered.

### Instant filtering and URLs

- One pure module, `public/js/browse-filter-core.js` (UMD, same pattern as
  `home-search-core.js`), holds: URL ⇄ state parsing, matching, counting, price banding,
  sorting. `server.js` requires it for the first render; the page loads it for taps.
- The server renders every site game card once (each wrapped in `.bf-item[data-id]`) and
  embeds, as JSON, the facts the core needs for each game (tier id, PS4/PS5, genres,
  from-price, available-now, available-on-PS4, just-added, can-buy, bundle, title, search
  text, home section), the PS Plus list and the current state. Tapping a chip re-runs the
  core in the browser, moves the existing cards between their home sections and the one
  grid, updates counts/0-states, and `history.replaceState`s the URL. No network request.
- URL params: `tier=2,3` · `console=ps4,ps5` · `genre=Action,Horror` (each name URL-encoded) ·
  `price=low,mid,high` · `avail=1` · `new=1` · `buy=1` · `bundle=1` · `search=…` ·
  `psplus=1` (the PS Plus Deluxe tier chip).
- Old links keep working: `ps4=1` → console=ps4; `newOnly=1` → new=1; single
  `genre=Horror` already fits; `unit=ps4|ps5` and `platform=PS4` keep today's meaning.
- Without JavaScript the server-rendered site results are already correct for the URL;
  chips are real links (built by the core) so it still works, just with reloads. The PS
  Plus section needs the page script (it is drawn from the embedded list).

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
  - Tier: no Tier chip on → shown; PS Plus Deluxe chip on → shown; other Tier chips on
    without PS Plus → hidden.
- **PS Plus Deluxe as the only Tier chip:** site games are not shown at all — the site
  grid, its "N games found" line and the "No games found" message are omitted, and the
  bar reads "N PS Plus games". With PS Plus plus other Tier chips on, both the site grid
  (those tiers) and the PS Plus section show.
- **Card:** cover (or a plain title tile), gold "PS Plus" pill, name, "via PS Plus ·
  from ₱X". Links to `/ps-plus?game=<key>` (the PS Plus page opens that game's sheet;
  monthly-only tiles have keys there too). Drawn by `public/js/browse.js`.
- **Many matches:** first 24 shown, then "Show all N" reveals the rest (client-side).
- A game that is both a site game and a PS Plus game may appear in both places.
- **PS Plus Deluxe tier chip count** = matching PS Plus items under the other filters.

## Telling tiers apart

### The tier pill

- `views/partials/game-card.ejs`: a pill above the title with the category name, in the
  category's pill colour. Not shown for games without a category, nor for bundles (which
  already say "Bundle · N games").
- `views/game-detail.ejs`: the same pill in the badge row just above the title.
- Pill colours (fixed palette, readable on the dark card): blue, purple, coral, grey,
  teal, pink; PS Plus is gold and not selectable.

### Admin: price category

Two new fields on the category add/edit forms (`views/partials/admin/games/categories.ejs`,
`POST /admin/price-categories/add|edit/:id`):

- **Pill colour** — "Automatic (from the name)" or one of the six colours. Automatic
  (stored as no colour) picks by name: contains "new" → blue, "deluxe" → purple,
  "special" → coral, otherwise grey. Anything not one of the six → keep the old value
  (edit) / automatic (add). The category row in admin previews its pill.
- **Description** — one line, max 120 characters, trimmed; empty allowed.

### "What are tiers?"

A link at the end of the Tier chip row opens an in-page panel listing each tier (admin
order) with its pill, description and "from ₱X" (lowest from-price of its games), plus a
PS Plus Deluxe row ("from ₱X" weekly). Closes with ✕ or a tap outside.

### "Just added"

The 11-day corner badge text (`gc2-badge-new`) and the Show chip become "Just added".
Its timing is unchanged.

## Admin: price bands

Settings gets a small "Browse price filter" card: two whole numbers A < B (defaults 200,
300), saved to `site_settings.browse_price_bands = { low: A, high: B }` via
`POST /admin/browse-price-bands` (requireAuth). Invalid input (non-numbers, A ≥ B, ≤ 0)
is rejected with an error toast and nothing saved. Chips read "Under ₱A", "₱A–(B−1)",
"₱B+".

## Error handling

- Unknown or malformed URL params are ignored; a tier id or genre the page has no chip
  for (a deleted category or a genre no game has any more) is dropped, so an old link
  never hides every game.
- A PS Plus catalogue that has not loaded (Mongo down) → the PS Plus section and chip are
  simply absent; the rest of Browse works.

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
  order with correct counts and dimmed 0-chips; old `?ps4=1` / `?newOnly=1` links work;
  data attributes present on cards; PS Plus section appears/hides per the rules (PS Plus
  catalogue store stubbed with fixture items).
- `scripts/test-tier-pill.js` — pills on browse cards, homepage cards and the game page;
  none for uncategorised games and bundles; "Just added" wording.
- `scripts/test-admin-tiers.js` — category pill colour/description save (defaults by
  name, invalid input), price band save and rejection, login required.
- Existing tests stay green except the known `scripts/test-requests-page.js`; any
  existing test that asserts the old single-link chips or the "New" badge text is updated
  to the new behaviour.

## Rollout

Direct on `main`, pushed when the owner says push. Until the owner writes tier
descriptions they are simply absent; pill colours default by name; price bands default to
200/300.
