# Admin Accounts Tab Redesign — Design

**Date:** 2026-09-25
**Status:** Approved in brainstorming, pending spec review
**Scope:** `views/partials/admin/accounts.ejs`, `buildAccountsView()` in `server.js`, new `lib/accounts-view.js`, new `public/js/admin-accounts.js`, `public/css/style.css`, tests.

## Problem

The Accounts tab is where the owner answers two questions many times a day:

1. **Where is an open slot for this game?** (to hand a new renter an account)
2. **Which rentals are ending soon or already overdue?** (to follow up)

The current page answers neither quickly:

- The **Add Account form is permanently expanded** at the top and fills the first screen, pushing the list below the fold.
- The list is **one wide table per price category** (min-width 980px, six columns), which scrolls sideways and forces the owner to hunt across groups for an open slot or an ending rental.
- **Search is text-only.** There is no way to filter by slot status, slot type, or game.
- Changing a slot's status expands an inline `<details>` form **inside the table cell**, stretching the row.
- **Edit is a 320px absolutely-positioned popover** inside the Actions cell that overlaps neighbouring rows.
- Linking catalogue games uses a **Ctrl/Cmd-click multi-select**.
- The "Ending ≤3 days" stat counts `days_left <= 3`, which **silently includes overdue slots** (negative days), so overdue rentals have no number of their own.
- The owner uses this tab **on phone as well as desktop**; the current tables are unusable on a phone.

## Goals

- Answer "open slot for game X" and "who is ending/overdue" in one or two clicks.
- Filter by **slot status**, **slot type**, and **game**, plus free-text search.
- Move Add, Edit and slot-status changes into modals so the page opens straight onto the list.
- Work well on phone widths, not merely "not broken".

## Non-goals

- No change to how slots, statuses, or accounts behave or are stored.
- No new account fields.
- No bulk actions.
- No change to any POST route, its field names, or its redirect targets.
- Price-category filtering (category stays a grouping in the Accounts view, not a filter).
- "For sale" filtering.

## Design

### Page structure (top to bottom)

```
Accounts                                            [+ Add Account]
[Total] [Open] [Rented] [Ending ≤3d] [Overdue]         ← stat cards, clickable
[ Slots | Accounts ]  🔍 search…  Status ▾  Type ▾  Game ▾  ✕ Clear
───────────────────────────────────────────────────────────────────
(list for the active view)
```

- The explanatory paragraph at the top of the current tab is removed.
- **`days_left` definition (applies everywhere in this spec):** whole calendar days from today's date in Asia/Manila to the slot's end date — `0` = ends today, `1` = tomorrow, `-1` = ended yesterday. This replaces the tab's use of `slotDaysLeft()`, which rounds up to end-of-day in *server* time (UTC), so a slot ending today read "1d left" and the day after read "0d left". `slotView.days_left` is read only by this tab (verified by grep), so the swap has no other consumer, and `slotDaysLeft()` is deleted once unused.
- **Stat cards** — Total slots, Open, Rented, Ending ≤3d, Overdue. Counts cover enabled slots only (same as today).
  - **Ending ≤3d** = status `rented` and `0 <= days_left <= 3`.
  - **Overdue** = status `rented` and `days_left < 0`.
  - These two are disjoint (today's "Ending" includes overdue — this is the fix).
  - Clicking **Open / Rented / Ending ≤3d / Overdue** sets the Status filter to that value and switches to the Slots view. Clicking **Total** clears the Status filter. The card matching the active Status filter is visually highlighted.
- **View toggle** — segmented control, `Slots` | `Accounts`. **Slots is the default** on first visit; the last-used view is remembered in `localStorage` (wrapped in try/catch; falls back to Slots).
- **Filter bar** — search input, Status select, Type select, Game select, and a "✕ Clear" link shown only when any filter is active.

### Slots view (default)

One row per **enabled** slot across all accounts. Disabled slots are excluded (they are not in use; they remain visible as dim chips in the Accounts view).

**Sort order (urgency), then tiebreakers:**

| Rank | Bucket | Within bucket |
|---|---|---|
| 1 | Overdue — `rented`, `days_left < 0` | most overdue first (`days_left` ascending) |
| 2 | Rented with end date — `rented`, `days_left >= 0` | soonest first (`days_left` ascending) |
| 3 | Rented, no end date — `rented`, `days_left == null` | account label A→Z |
| 4 | Open | account label A→Z |
| 5 | Bought (`buyed`) | account label A→Z |
| 6 | Maintenance | account label A→Z |
| 7 | Not available (`na`) | account label A→Z |

Ties after the label fall back to slot type order Trophy → Non-Trophy → PS4 Primary, so the order is fully deterministic.

**Row content:**

| Cell | Content |
|---|---|
| Status | coloured pill (reuses existing `st-*` colours). Rented rows show the countdown in the pill: `OVERDUE 2d`, `ENDS TODAY`, `1d left`, `3d left`. Clicking the pill opens the **slot modal**. |
| Type | 🏆 Trophy / 🎮 Non-Trophy / 🕹️ PS4 Primary |
| Game | first linked game's cover thumb + title, plus `+N` when the account has more linked games. If no linked games, the account's `games_text` (truncated). |
| Account | account label (+ email in muted text on desktop) |
| Renter | linked customer name, or `—` |
| Date | rented: end date; bought: `—`; otherwise `—` |

A slot rents the whole account, so the Game cell deliberately shows the **account's** games, and the Game filter matches any account that contains the chosen game.

### Accounts view

One compact row per account, still **grouped under price-category headers** in the existing category order (`sortCategoryNames`), accounts A→Z within a group.

```
New Games (28)
[covers] PSHub NBA Pack       🏆 OPEN  🎮 RENTED·3d  🕹️ —     ₱5,000 / ₱4,500   🛒   Edit  Delete
         ✉ pshub.nba@gmail.com · NBA 2K27, Tekken 8, +1 · 📝 note
```

- Up to 4 overlapping cover thumbs (as today), label, and a single muted meta line: email, linked game titles (first 2 + `+N`), note. `games_text` is shown when there are no linked games.
- **Three slot chips** in one cell, in fixed order Trophy / Non-Trophy / PS4. Enabled chips show status (+ countdown when rented) and open the slot modal on click. Disabled slots render as a dim, non-clickable `—` chip.
- Permanent prices `₱TR / ₱NT`.
- 🛒 badge when `for_sale` is true.
- **Edit** opens the account modal pre-filled; **Delete** keeps the existing `confirm()` + POST form.
- Group headers show the count of **visible** accounts and hide entirely when no account in the group matches.
- No `min-width` table; no horizontal scroll.

### Filters and search

All filtering is client-side over data already rendered into the page (~50 accounts / ~150 slots — no server round trips).

| Filter | Control | Values |
|---|---|---|
| Search | text input | case-insensitive substring over account label, email, `games_text`, linked game titles, renter name |
| Status | native `<select data-ss-skip>` | All, Open, Rented, Ending ≤3d, Overdue, Bought, Maintenance, Not available |
| Type | native `<select data-ss-skip>` | All, Trophy, Non-Trophy, PS4 Primary |
| Game | `<select>` (auto-upgraded to type-to-search by the existing `admin-searchable-select.js`) | All games, then every catalogue game A→Z |

- Status "Rented" matches every `rented` slot (including ending and overdue). "Ending ≤3d" and "Overdue" are the narrower subsets defined above.
- Status and Type use `data-ss-skip` so they stay compact native selects (native pickers on phones); Game is the only one long enough to need search.
- **Slots view:** a row shows when it matches every active filter.
- **Accounts view:** an account shows when it matches Search and Game **and** at least one of its enabled slots matches Status and Type. Within a shown account, chips that do not match Status/Type are dimmed (not hidden), so the matching slot stands out.
- A result count ("12 slots" / "5 accounts") sits beside the filters; an empty state ("No slots match these filters" + Clear link) replaces the list when nothing matches.
- **Persistence:** the filter state (search, status, type, game, view) is written to `sessionStorage` on change and restored on load, so the owner lands back on the same filtered list after any save/redirect back to `/admin?tab=accounts`. All storage access is wrapped in try/catch and the page works without it.

### Modals

All three reuse the existing `.qa-overlay` / `.qa-box` / `.qa-head` / `.qa-body` / `.qa-foot` shell from `public/css/style.css` (the Quick Add modal), including Escape-to-close and click-outside-to-close.

**Add / Edit Account modal** (one form, two modes)

- Title "Add Account" / "Edit Account"; form `action` switches between `/admin/accounts/add` and `/admin/accounts/edit/:id`.
- Fields (same names as today): `label` (required), `email`, `games_text`, `game_ids`, `price_permanent_tr` (default 5000 on add), `price_permanent_nt` (default 4500 on add), `note`, `public_name`, `enable_trophy` / `enable_non_trophy` / `enable_ps4_primary` (default checked on add), `for_sale`.
- **Linked games picker** replaces the Ctrl-click multi-select: a search box above a scrollable checklist of all catalogue games (`Title (Platform)`), each a `<input type="checkbox" name="game_ids" value="<id>">`. Typing filters the checklist; checked games appear above it as removable chips. Posting repeated `game_ids` keys is already handled by `parseGameIds()` (array, or single string for one box). Unchecking every box posts no `game_ids`, which clears links — identical to today's multi-select behaviour.
- Edit pre-fills from a JSON blob of the account's editable fields embedded in the page (escaped for safe inclusion in a `<script type="application/json">` block), rather than rendering one hidden form per account as today.

**Slot modal**

- Header names the slot: "🏆 Trophy — PSHub NBA Pack".
- Posts to `/admin/accounts/:id/slot/:type` with the existing fields `status`, `renter_id`, `days`, `end_date`.
- Renter picker shows only for `rented` / `buyed`; days + end date show only for `rented` — same conditions as today's inline form. The modal markup is server-rendered with the page, so `admin-searchable-select.js` upgrades the renter `<select>` to type-to-search on its normal page-load init; pre-filling sets `.value`, which that helper already keeps in sync. The status `<select>` carries `data-ss-skip` (five options, native is better).
- Pre-filled from the slot's current status, renter and end date.

### Phone layout (≤ 640px)

- Stat cards become a single horizontally scrolling row.
- View toggle stays visible; the filter bar collapses to the search input + a **"Filters (n)"** button that expands a panel holding Status, Type, Game and Clear. `n` = number of active non-search filters.
- **Slots rows** stack as compact cards: status pill + type on the first line; cover + game title + account label on the second; renter + date on the third.
- **Accounts rows** stack: covers + label + meta; then the three chips; then prices, 🛒 and actions.
- Modals already fit phones (`width:min(580px,100%)`, scrollable overlay).

## Architecture

### Server — `lib/accounts-view.js` (new, pure)

Pure functions, no DB or clock access (the caller passes `today` as a `YYYY-MM-DD` Manila date), following the `lib/dashboard.js` pattern:

- `daysUntil(end, today)` → integer calendar days, or `null` for a missing/malformed date.
- `decorateSlot(slot, today)` → a copy of the slot with `days_left` (rented slots only, else `null`), `due` (`'overdue' | 'ending' | ''`), `urgency` and `pill` added.
- `slotUrgency(slot)` → numeric bucket rank 1–7 per the sort table above.
- `slotPillLabel(slot)` → the pill text (`OVERDUE 2d`, `ENDS TODAY`, `1d left`, `OPEN`, `BOUGHT`, …).
- `flattenSlots(accounts)` → array of `{ account_id, account_label, type, status, enabled, end, days_left, renter_id, renter_name }` for **enabled** slots only, sorted by urgency → `days_left` (buckets 1–2) → account label → type order.
- `slotStats(accounts)` → `{ total, open, rented, ending, overdue }` with the disjoint Ending/Overdue definitions above.

`buildAccountsView()` in `server.js` keeps building `accounts` and `groups` exactly as today and adds:

```js
return { accounts, groups, slots: accountsView.flattenSlots(accounts),
         stats: accountsView.slotStats(accounts), STATUSES: ACCOUNT_STATUSES };
```

The `stats` object keeps its existing keys (`total`, `open`, `rented`, `ending`) and gains `overdue`; `ending` changes meaning to exclude overdue. The Accounts tab is the only reader of `accountsView.stats` (verified by grep on 2026-09-25; the dashboard reads `accountsView.accounts`), so the meaning change has no other consumer. The inline stats loop in `buildAccountsView()` is replaced by the `slotStats()` call.

### Template — `views/partials/admin/accounts.ejs` (rewritten)

- Renders header, stat cards, toggle, filter bar, both view containers, and the modals' markup.
- Each Slots row and each Accounts row carries `data-*` attributes the client filter reads: `data-status`, `data-type`, `data-days-left`, `data-game-ids` (comma-separated), `data-search` (pre-lowercased haystack), `data-account-id`.
- Embeds one `<script type="application/json" id="accData">` with per-account edit fields and per-slot modal fields, JSON-escaped so a label or note containing `</script>` cannot break out.
- The inline `<style>` block moves into `public/css/style.css` under an `acc-` prefix; old unused `acc-*` rules are removed rather than left behind.

### Client — `public/js/admin-accounts.js` (new)

Loaded from `views/admin.ejs` with the existing `?v=<%= assetV %>` cache-buster. Load order relative to `admin-searchable-select.js` does not matter: every select on the tab (Game filter, slot-modal renter) is server-rendered and upgraded by that script's own page-load init; the rest carry `data-ss-skip`.

Responsibilities:
- Pure `matchesSlot(slotData, filters)` and `matchesAccount(accountData, slotDataList, filters)` predicates (exported on `window.__accFilter` for the test harness).
- Apply filters → toggle row visibility, dim non-matching chips, update group headers/counts, result count, empty state, active stat card, "Filters (n)" badge.
- View toggle + `localStorage` last view; `sessionStorage` filter persistence.
- Open/close/pre-fill the account modal and slot modal; the game-checklist search + chips.

No inline `<script>` remains in `accounts.ejs`.

## Error handling

- Unchanged server behaviour: invalid add/edit/slot posts redirect with `msg=account_error` exactly as today.
- Client: missing or unparsable `#accData` JSON → Edit and slot modals are disabled (buttons hidden) and the list still renders and filters; storage failures are swallowed and defaults used.

## Testing

- **`scripts/test-accounts-view.js`** (new, unit): urgency bucket for every status; overdue vs ending boundary at `days_left` = −1, 0, 3, 4; rented with `null` end sorts after dated rentals; disabled slots excluded from `flattenSlots` and from `slotStats`; deterministic tie order (label, then type); `slotStats` Ending and Overdue are disjoint and `rented` includes both.
- **`scripts/test-admin-accounts-filter.js`** (new): loads `public/js/admin-accounts.js` in a `vm` sandbox with a stub DOM (same approach as `scripts/test-quick-add-form.js`) and asserts the filter predicates — each Status value, Type, Game, search over renter name, Accounts-view "any slot matches" rule.
- Existing suites that touch admin rendering (`test-admin-tabs.js`, `test-templates.js`, `test-dashboard*.js`) must still pass.
- **Browser check** on a scratch copy with `requireAuth` bypassed (never the real admin), at desktop and 375px widths: default Slots view order, each filter, stat-card shortcuts, view toggle memory, filter persistence across a slot save, add/edit/slot modals submit correctly, no console errors. Saves that write data are only exercised against local lowdb fixtures, never production MongoDB.
