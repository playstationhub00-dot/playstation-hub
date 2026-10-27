# Account slot renter history — Design

Date: 2026-10-27 · Status: approved by owner (approach A)

## Problem

An account slot (for example PS Plus deluxe 3 · Trophy) only knows its current
renter.
- When the renter leaves, or is moved to another slot, the slot is reset to a
  blank one and nothing is kept.
- The customer row doesn't record which account it used either.

So the owner can't see who had a slot before, who moved in or out, or who
swapped games while on it. The owner wants that history in the Accounts tab,
per account and slot type.

## Decision (approach A)

A separate log, `slot_history`, written by one shared save step that every
slot change goes through.
- The step compares the slot before and after the change and writes what
  happened.
- Each caller passes its reason.
- Because the log lives outside the slot, resetting a slot (`blankSlot`) can't
  wipe it.

**Not chosen:**
- **Storing history on the slot:** every place that blanks or rebuilds a slot
  would have to carry it over.
- **Working it out from Customers:** it misses hand changes and free-text
  renters, and it is lost when a customer is deleted.

**Past history can't be rebuilt.** Today's data doesn't say which account a
finished rental used, so the log starts on the day this ships.

## What the owner sees

Clicking a slot chip opens the slot popup as now. Under the status form, a new
**History** section shows:

- **Now:** a line for the current renter, when there is one: name, game, since
  `start`, ends `end` (or "bought" for a bought slot).
- The 10 newest lines, newest first, then **Show all (N)** for the rest.
- At the bottom: "History starts <date>", the day the log began.

Each line has a date and a short text. The wording:

| What happened | Line |
|---|---|
| A new renter took the slot | **Name started** · game · ends `end` |
| A renter bought the slot | **Name bought it** · game |
| A renter moved in from another slot | **Name moved in** from `<account> · <type>` |
| The rental was marked done | **Name left** — returned · rented `start` → `date` · game |
| The renter was put on another slot | **Name moved** to `<account> · <type>` · rented `start` → `date` |
| The owner cleared the renter in the popup | **Name left** — cleared by hand · rented `start` → `date` |
| The rental was refunded | **Name left** — refunded · rented `start` → `date` |
| A refund was undone | **Name came back** — refund undone |
| The customer was deleted | **Name left** — customer deleted · rented `start` → `date` |
| The game changed, slot kept | **Name swapped game** · `old` → `new` · stayed on this slot |
| A hand status change with no renter | **Set to** Maintenance / Not available / Open |

- The game comes from the linked customer, as it was at that moment. A renter
  typed as free text (no linked customer) shows the name only.
- Dates show as Manila dates ("Oct 27").

## Data

**`slot_history`** is a new list in the lowdb data file, beside `accounts`. One
entry per line:

```
{ id, account_id, slot: 'trophy' | 'non_trophy' | 'ps4_primary', at: ISO time,
  kind: 'in' | 'out' | 'swap' | 'status',
  how: 'new' | 'bought' | 'moved' | 'returned' | 'cleared' | 'refunded'
     | 'restored' | 'customer_deleted' | null,
  renter_id, renter_name, game_title, start, end,
  other_account_id, other_account_label, other_slot,   // moves only
  from_game, to_game,                                  // swaps only
  status }                                             // status lines only
```

- **`slot_history_started_at`** is set once, the first time the server starts
  with this feature, and never changes.
- **Size:** each `account_id` + `slot` keeps its newest 100 entries; older ones
  are dropped when a new one is written.
- **Deleting an account** deletes its entries.

## How it gets recorded

- **Pure rules:** `lib/slot-history.js` (no database) holds them:
  - `diff(before, after, ctx)` turns a slot's before and after into entries;
  - the line wording;
  - the trim.
- **Save step:** `saveAccountSlots(account, ctx)` in `server.js` writes the
  slots and appends the entries `diff` returns for each slot type.
- **`ctx` carries:**
  - `how`;
  - for moves, the other account and slot;
  - for swaps, the old and new game;
  - a lookup for the renter's game title.
- **What `diff` records:**
  - **Renter changed** (a different `renter_id`, or a different name when there
    is no id): an `out` line for the old renter, if any, and an `in` line for
    the new one, if any.
  - **Same renter, game changed** (`ctx` says so): a `swap` line.
  - **No renter before or after, status changed:** a `status` line.
  - **Same renter, status changed** (rented ↔ bought): a `status` line naming
    them.
  - **Only the end date or the name's spelling changed:** nothing.
- **Callers** (every place that writes `accounts[].slots` today) all go
  through the save step, each with its reason:

| Caller | `how` |
|---|---|
| The slot popup (`POST /admin/accounts/:id/slot/:type`) | `cleared` for the old renter; `new`, or `bought` for a Bought status, for a new one; a `status` line otherwise |
| Customers add, Quick Add (`applyAccountAssignment`) | `new` / `bought` |
| Customers edit, slot changed | `moved` on both slots (old: to the new slot; new: from the old slot) |
| Customers edit, game changed on the same slot | `swap` |
| Customers edit or status change to done (`freeAccountSlotsForCustomer`) | `returned` |
| Refund (`freeAccountSlotsForCustomer`) / undo refund (`applyAccountAssignment`) | `refunded` / `restored` |
| Customer delete (`removeCustomerRecord`) | `customer_deleted` |
| A paid web purchase of a bundle slot (order advance) | `bought` |

- **Not recorded:**
  - extensions (the Now line shows the current end date);
  - name-spelling fixes;
  - turning a slot type on or off in the account form.

## Loading

- **`GET /admin/accounts/:id/slot/:type/history`** (admin only) returns:
  - that slot's entries, newest first;
  - the current renter (the Now line);
  - the start date.
- **`public/js/admin-accounts.js`** fetches it when the slot popup opens and
  renders the list. "Show all" reveals the rest without another request.
- **Errors:** if the request fails, the History section says "Couldn't load
  history" and the status form still works.

## Testing

Throwaway only: a temp `DATA_DIR`, a blank `MONGODB_URI`, the in-memory
session store, a made-up admin password and made-up names.

- **`scripts/test-slot-history.js`** tests the pure rules:
  - a renter arrives;
  - a renter leaves, for each `how`;
  - a move;
  - a swap;
  - a status change by hand;
  - rented ↔ bought;
  - nothing changed;
  - an end-date-only change;
  - the line wording;
  - trimming to 100.
- **`scripts/test-slot-history-routes.js`** tests the real routes:
  - the slot popup sets a renter, then clears it;
  - adding a customer onto a slot;
  - editing that customer onto another account's slot (a `moved` line on both);
  - editing only the game (a `swap` line);
  - marking them done (`returned`);
  - deleting a customer;
  - deleting an account (its entries go);
  - the history request returns the lines newest first, with the Now line and
    the start date, and refuses a request that isn't logged in.
- **A browser check** at 1280px and 375px: open a slot, see Now and the
  history, use "Show all".
- **The full suite** stays green except the known
  `scripts/test-upcoming-psn-page-public.js`.

## Out of scope

- Rebuilding history from before the log started.
- Recording extensions and turning slot types on or off.
- A whole-account history panel (the owner chose the per-slot popup).
- Showing history anywhere outside the admin Accounts tab.

## Rollout

Direct on `main`, pushed when the owner says push. The log starts empty on the
day of the deploy.
