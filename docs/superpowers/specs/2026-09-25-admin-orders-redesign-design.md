# Admin Orders Tab Redesign — Design

**Date:** 2026-09-25
**Status:** Approved in brainstorming, pending spec review
**Scope:** `views/partials/admin/orders.ejs`, `views/partials/order-queue.ejs` (split into three partials), `views/admin.ejs` (sidebar badge + script tag), new `public/js/admin-orders.js`, `public/css/style.css` (`oq-*` rules), `views/partials/admin/notif-bell.ejs` (two stale comments), tests.

## Problem

The Orders tab stacks ten separate blocks top to bottom: a Quick Add button with a description sentence, four stat cards, a full-width payment-gateway banner, an export link, a full-width "I'm online" box, the Needs You queue, the All Orders ledger, and then three more full sections (deposits to refund, started-but-didn't-pay, waiting for a slot).

The owner's verdict: **too much information**. Some blocks aren't needed and others are just indicators dressed up as sections. Specifically:

- The four stat cards each repeat something the page already shows: the queue count, the ledger's chip counts, the ledger's collected total.
- The gateway banner is red and full-width even when healthy. It reads as an error when it's really a status dot.
- Refunds, follow-ups and the waitlist are all things that want a click from the owner, but they're spread across three zones below the ledger, so the owner scrolls past the whole ledger to find them.
- Rows carry every possible action as a full button (a follow-up row has five), so the rare and destructive ones (Delete, Cancel) are as loud as the main one.
- The **"Out on rent" chip count** reads a live total across *all* orders, but clicking the chip only filters the orders in the selected period. So the number beside the chip can differ from the rows it shows.
- The ledger is a wide table that scrolls sideways on a phone.

## Goals

- **Three blocks instead of ten:** an indicator strip, one Needs You section, and the All Orders ledger.
- **One place for everything actionable,** grouped by kind of work.
- **Indicators take a line, not a section.** The gateway pill goes loud only when something is actually wrong.
- **Quieter rows:** each row shows its main action or two, and the rest sit behind a menu.
- **A Type filter** (Rentals / Purchases / Reservations) on the ledger, alongside the existing period, status chips and search.
- **Filter state survives the reload** that follows every action, matching the Accounts tab.
- **Usable on phone.**

## Non-goals

- No change to any POST route, its URL, field names, confirm prompts, or redirect targets.
- No change to how orders, states, the waitlist order (`queueRules`), or refunds work.
- No change to the server-side lists themselves (`orderQueue`, `refundsOwed`, `abandonedOrders`, `waitlistOrders`, `ledgerGroups`, `ledgerStats`), except that the template now reads them differently.
- No change to the funnel numbers' definitions (`startedCount`, `abandonedCount`, `orderStartRate`). Only where they're displayed moves.
- No new data sources, and no bulk actions.

## Design

### Page structure

```
[⚡ Quick Add]                     ● Online   ● LIVE · webhook ok   ⬇ Export
────────────────────────────────────────────────────────────────────────────
NEEDS YOU  3
  ▾ Do now (2)
  ▾ Refunds owed (1)
  ▸ Follow-ups (10) · 10 of 30 started this week · 1.4% of game views
  ▸ Waitlist (12)
────────────────────────────────────────────────────────────────────────────
ALL ORDERS  86 · 58 completed · ₱37,959 · Last 3 months
[Period ▾] [🔍 Search ref, name or game…] [Type ▾]
[All 86] [🎮 Out on rent 54] [✅ Completed 58] [⚠ Didn't pay 27] [🚫 Cancelled 1]
(month-grouped table)
```

### 1. Indicator strip

One row with the Quick Add button on the left and three small indicators on the right. It replaces the Quick Add description sentence, the four stat cards, the gateway banner, the export block and the online box.

- **Quick Add:** the existing `⚡ Quick Add` button (`qaOpen()`), unchanged, without the description sentence.
- **Online:** a compact switch pill labelled `Online`. It is the same form as today: `POST /admin/online`, a checkbox named `online` that submits on change, checked from `settings.owner_online`. Green dot when on, grey when off. The full sentence ("show a live banner to customers waiting to send a QR") moves into the pill's `title` tooltip.
- **Gateway:** rendered only when `paymongoMode !== 'none'`, as today.
  - **Healthy or no webhook yet:** a small pill. Its text is `● LIVE` or `● TEST` (or `● Unrecognised key`), then ` · webhook ok` when there is at least one success, or ` · no webhook yet` when there is none. The full detail line (verified count and last-seen time) goes in the `title` tooltip.
  - **Broken** (`pmBroken`, the existing rule): the pill turns red with a ⚠. The existing full warning sentence renders as a red line directly under the strip. This is the only case where the gateway takes more than a pill.
  - The `LIVE` pill in the healthy state is **not** red. A green dot means live and fine, and red is reserved for broken.
- **Export:** a small `⬇ Export` link to `/admin/api/orders-export` with the `download` attribute. The explanatory sentence moves into its `title`.

**Removed:** the four stat cards (`.oq-stats`). Where their information goes:

| Stat card | Now shown in |
|---|---|
| Needs you (`ledgerStats.needsYou`) | Needs You headline count (redefined, see below) |
| Out on rent (`ledgerStats.out`) | Ledger "Out on rent" chip (count corrected to the period, see Ledger) |
| Completed · period, ₱ collected | Ledger header line |
| Didn't pay · 7d, of N started, % of game views | Follow-ups group heading |

### 2. Needs You: one section, four groups

Heading: `NEEDS YOU <n>`, where **n = Do now count + Refunds owed count**. Follow-ups and Waitlist never "finish" the way a payment check does, so they carry their counts in their own headings and don't inflate the headline.

The **sidebar Orders badge** in `views/admin.ejs` shows the same `n` (currently `orderQueue.length` only) and is hidden when `n` is 0, as today.

Groups in this fixed order. **A group with zero rows is not rendered.** When all four are empty, the section shows the single line `Nothing waiting on you right now.`

| # | Group | Source list | Row order | Default |
|---|---|---|---|---|
| 1 | **Do now** | `orderQueue` (states `verifying_payment`, `qr_pending`, `verifying_return`) | `qr_pending` first, then oldest `created_at` first. This is the existing `sortedQueue` rule, unchanged | Expanded |
| 2 | **Refunds owed** | `refundsOwed` | as supplied | Expanded |
| 3 | **Follow-ups** | `abandonedOrders` | newest `created_at` first (existing) | Collapsed |
| 4 | **Waitlist** | `waitlistOrders` | the existing `sortedWaitlist` rule (game+type, priority tier, oldest first, ref) | Collapsed |

- **Group headings** are `<details>`/`<summary>` elements, so collapse works without JavaScript. The heading shows the group name, its count, and for Follow-ups the funnel line: `<abandonedCount> of <startedCount> started this week` plus ` · <orderStartRate>% of game views` when `orderStartRate !== null`.
- **Remembered state:** when the owner opens or closes a group, the choice is stored in `localStorage` under `oqGroups` (an object of group key → open boolean) and re-applied on load. It falls back to the defaults above, and every storage access is wrapped in try/catch.

**Row content per group** (unchanged information, restyled):

- **Do now:**
  - The ref, and the badges shown today: reservation, purchase, `QUEUE_LABEL`, the QR countdown `.oq-timer`.
  - Game · type · duration · total (including the reservation wording).
  - FB name, and the `open chat →` link when a `psid` is present.
  - Payment proof or receipt link, the sign-in code with its copy button, the QR link, the return proof link.
- **Refunds owed:** ref, ₱ deposit, FB name · game.
- **Follow-ups:** ref, FB name, game · type · duration · ₱ total, `payment rejected` marker, `open chat →`, and the age ("3h ago").
- **Waitlist:** queue position (`#n` / `—` / `#?`), ref, FB name, game · type · duration · Priority-or-Free · `waiting 30+ days`, and the age.

**Actions: primary buttons visible, the rest behind a ⋯ menu.** The ⋯ menu is a `<details class="oq-more">` whose panel holds the same `<form>` elements as today, with their existing `onsubmit` confirm prompts, byte-for-byte.

| Group | Visible | In ⋯ menu |
|---|---|---|
| Do now | the advance button (`queueAction(o)` label) | `Can't find it` (only when `verifying_payment`), `Delete` |
| Refunds owed | `Sent it` | — (no menu) |
| Follow-ups | `📋 Copy`, `✅ Mark paid` | `💳 Payment link` (only when `PAYMONGO_SECRET_KEY` is set), `Cancel`, `Delete` |
| Waitlist (free entry) | `📋 Copy`, `⭐ Priority paid` | `Remove` |
| Waitlist (priority entry) | `📋 Copy` | `↩ Undo priority` (only when `upgraded_from_waitlist`) |

When a row has no ⋯ items (for example a priority waitlist row that wasn't upgraded from the waitlist), no ⋯ control is rendered.

### 3. All Orders ledger

**Header line:** `ALL ORDERS <total> · <paidCount> paid · ₱<paidTotal> · <periodLabel>`, all from `ledgerStats` (`total`, `paidCount`, `paidTotal`) and the existing `periodLabel`.

It says **paid**, not "completed": `paidCount` counts every paid order, rentals still out included, which is more than the ✅ Completed chip shows. For the same reason, the month header subtotals change their word from "completed" to "paid". Only the word changes; the numbers are the same.

**Toolbar row:**
- **Period:** the existing `<select name="operiod">` GET form that submits on change. Same options, same server behaviour.
- **Search:** the existing box (ref, FB name, game title), case-insensitive.
- **Type (new):** `All types` / `Rentals` / `Purchases` / `Reservations`. The classification is:
  - `reservation` when `o.is_reservation` is true. This includes Coming Soon pre-orders and priority reservations.
  - `purchase` when `o.is_buy` is true and `o.is_reservation` is not.
  - `rental` otherwise.
- **Status chips:** All / 🎮 Out on rent / ✅ Completed / ⚠ Didn't pay / 🚫 Cancelled. The row grouping rule (`grp`: `cancelled` / `unpaid` / `out` / `paid`) is the existing one, unchanged.
  - **Every chip count is computed from the rows loaded for the period**, so it always equals the number of rows the chip shows when Type and Search are at their defaults.
  - **Consequence:** the "Out on rent" count changes from the all-orders live total to the in-period count, which fixes the inconsistency described in Problem.
  - All chip counts are computed in the template from the same `grp` classification each row uses.

**Table:** unchanged columns, grouping and row content: month header rows with their completed count and peso subtotal, Ref / Customer / Game / Rental / Dates / Total / Status, the deposit and duplicate-slot notes in the status cell, and the 📋 / ↩ / 🗑 icon actions with their existing confirms.

**Filtering behaviour** (client-side, over rows already loaded for the period):
- A row shows when it matches the active chip **and** the Type **and** the search.
- A month header row hides when all of its rows are hidden.
- `No orders match these filters.` plus a `Clear filters` link replaces the table body when nothing matches.
- **Persistence:** chip, type and search are written to `sessionStorage` under `oqLedger` on every change and restored on load. The page lands back on the same filtered ledger after any action's redirect, and all storage access is wrapped in try/catch. The period is already persisted by its URL parameter and is not stored.

### 4. Phone layout (≤ 640px)

- **Indicator strip:** the Quick Add button is full width on its own line, with the three indicator pills wrapping on the line below.
- **Needs You rows:** text block first, then the visible buttons and the ⋯ menu in a row beneath it.
- **Ledger toolbar:** Period, Search and Type stack full-width, and the chips wrap.
- **Ledger rows** become cards with no horizontal scroll:
  - line 1: ref · status pill
  - line 2: customer · game
  - line 3: rental · dates · total
  - line 4: deposit / duplicate notes and the icon actions
- **Month headers** stay as full-width separators.

## Architecture

### Template split

`views/partials/order-queue.ejs` (585 lines) is replaced by three partials under `views/partials/admin/orders/`:

| File | Contains |
|---|---|
| `strip.ejs` | Quick Add button, online pill, gateway pill (+ broken warning line), export link |
| `needs-you.ejs` | Headline, the four groups, their rows and ⋯ menus |
| `ledger.ejs` | Header line, toolbar, chips, table, empty/no-match states |

`views/partials/admin/orders.ejs` includes the three in that order. `views/partials/order-queue.ejs` is deleted, since `orders.ejs` is its only includer (verified by grep).

### Client script: `public/js/admin-orders.js` (new)

This moves the partial's inline `<script>` out, following the Accounts tab pattern. It is loaded from `views/admin.ejs` with the `?v=<%= assetV %>` cache-buster.

It contains:
- The QR countdown loop over `.oq-timer`, unchanged in behaviour.
- The age formatter over `.oq-ab-age`, unchanged.
- The `💳 Payment link` click handler, unchanged: it posts to `/admin/orders/:ref/payment-link` and copies with a fallback.
- Ledger filtering: chip, type and search, plus month-header hiding, the no-match state and `sessionStorage` persistence.
- Group open/closed memory in `localStorage`.

The **pure pieces** are exposed as `window.__oqFilter` for a `vm`-sandbox test, the same way as `admin-accounts.js`:
- `normalizeLedgerState(raw)`: untrusted storage in, safe state out; unknown values fall back to defaults.
- `orderType(order)`: `'rental' | 'purchase' | 'reservation'`, per the rule above.
- `rowMatches(row, state)`

The DOM wiring is skipped when there is no `document`, so the file loads cleanly in the test sandbox.

**The QR countdown and "x ago" loops run page-wide, not just inside the Orders tab.** The dashboard overview (`views/partials/admin/dashboard/overview.ejs`) renders its own `.oq-timer` and has no loop of its own; it has always been ticked by this orders script. Ledger filtering and group memory attach only when their elements exist.

The global `.rem-copy` click handler in `views/partials/admin/customers.ejs` stays where it is. Rows keep using `.rem-copy` for their copy buttons.

### Ledger row data

Each ledger `<tr>` carries:
- `data-g`: the chip group, as today.
- `data-t`: `rental` / `purchase` / `reservation`, computed in the template with the same rule as `orderType()`.
- `data-s`: the lower-cased search haystack, as today.

### CSS

The `oq-*` rules in `public/css/style.css` are updated for the new layout. Rules for removed markup are deleted rather than left behind:
- the stat cards (`.oq-stats`, `.oq-stat*`)
- the gateway banner block (`.oq-pm*`, replaced by pill rules)
- the export block (`.oq-export`)
- the online box (`.oq-online-form`, `.oq-online-toggle`, replaced by pill rules)
- the three standalone zone wrappers (`.oq-refunds*`, `.oq-abandoned*`), since those rows now render inside the Needs You groups
- **dead rules nothing renders:** `.oq-manual-*` (an old manual-order form) and `.oq-funnel*`

Several `oq-*` rules serve other templates and **must stay**:
- `.oq-alert-*`: the Settings tab's alert self-test
- `.oq-count`: the sidebar Orders badge
- `.oq-timer`: also used by the dashboard overview
- `.oq-wl-pos`: this is outside the orders block

Every other `oq-*` class is used only by the orders template (verified by grep). Light-mode overrides are added for the new surfaces, following the Accounts tab's light-mode block.

### Other touch points

- **`views/admin.ejs`:** the sidebar Orders badge reads `orderQueue.length + refundsOwed.length`. One new `<script>` tag for `admin-orders.js`.
- **`views/partials/admin/notif-bell.ejs`:** two comments name `order-queue.ejs` as the owner of the `.oq-timer` loop. They are updated to name `public/js/admin-orders.js`. Comment-only change.
- **`server.js`:** no change.

## Error handling

- **Server behaviour is unchanged.** Every action posts to the same route with the same fields and confirm prompt, and redirects exactly as today.
- **Client:**
  - Storage failures fall back to the defaults: all chip, all types, empty search, groups at their default open state.
  - `<details>` groups and ⋯ menus work without JavaScript. Only persistence and ledger filtering need the script.
  - If the script fails to load, the page still shows every order and every button.

## Testing

- **`scripts/test-admin-orders-filter.js` (new):** loads `public/js/admin-orders.js` in a `vm` sandbox with no DOM and checks:
  - `orderType()` for rental, purchase, priority reservation, and Coming Soon pre-order (`is_buy` + `is_reservation` → `reservation`)
  - `rowMatches()` for each chip, each type, search case and trimming, and all three combined
  - `normalizeLedgerState()` for garbage input
  - that `admin.ejs` loads the script with `?v=`
- **`scripts/test-orders-template.js` (new):** renders the three partials through `views/partials/admin/orders.ejs` with fixture locals and checks:
  - the headline count equals Do now + Refunds
  - empty groups are not rendered, and the all-empty state renders
  - Follow-ups and Waitlist render collapsed, Do now and Refunds expanded
  - the Follow-ups heading carries the funnel line
  - every existing POST form action and confirm prompt is still present:
    - `/advance`, `/reject`, `/delete`, `/refunded`, `/mark-paid`, `/cancel`, `/priority-paid`, `/undo-priority`
    - `/admin/online` and the `operiod` form
  - Delete, Cancel and Can't find it render inside `.oq-more`; primary buttons render outside it
  - the gateway pill is not red when healthy, and is red with the warning line when `pmBroken`
  - no gateway markup when `paymongoMode === 'none'`
  - the chip counts equal the per-group row counts of the fixture
  - every ledger row has `data-t`
  - no inline executable `<script>` remains in the three partials
- **The existing suites** (`test-admin-tabs.js`, `test-static-caching.js`, `test-templates.js`, etc.) must still pass.
- **Browser check:** orders live in the production MongoDB, so the browser check **does not use a live server's orders**. The partials are rendered with fixture orders into a local static page, alongside the real `style.css`, `admin-searchable-select.js` and `admin-orders.js`, then checked at desktop and 375px widths:
  - groups collapse and remember their state
  - ⋯ menus open
  - chips, type and search combine
  - filters survive a reload
  - the gateway pill states render
  - no horizontal scroll on phone
  - no console errors

  The real admin panel is never logged into, and no real order is created or changed.
