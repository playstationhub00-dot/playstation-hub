# Extend on Edit Customer — Design Spec

## Problem

Extending a live rental already works correctly (`⏩ Extend` button on the Customers table, `views/partials/admin/extend.ejs`, `POST /admin/customers/:id/extend`). It prices the extra days off the same promo-adjusted curve a fresh rental uses, adds that amount onto the customer's price, pushes the end date out from their current end date, files a dated `extension` payment, syncs the new end date to the account slot **and** the order, and renders an updated message with a Copy button.

The gap: this action is only reachable from the Customers table row. It is **not** on the Edit Customer page (`GET /admin/customers/edit/:id`, `views/edit-customer.ejs`) — the page an owner is often already on when they realize a rental needs extending. Today the only way to extend from there is to hand-edit the Price and End Date fields on that form and save, which is exactly the untracked, no-message, easy-to-disagree-with path the Extend button was built to replace.

## Approach

No changes to the extend logic itself (`lib/extensions.js`, the `/extend` route, the message template). This is purely: make the existing action reachable from a second page, and fix one hazard that only matters once it's reachable from a page that also edits price/end date directly.

### 1. Share the `.qa-*` modal-shell CSS

The extend modal's markup (`.qa-overlay`, `.qa-box`, `.qa-head`, `.qa-body`, `.qa-foot`, `.qa-btn`, `.qa-price`, `.qa-err`, `.qa-in`, etc. — everything in `extend.ejs` that isn't prefixed `.xt-`) is currently styled by a `<style>` block that lives inside `views/partials/admin/quick-add.ejs` (lines 197–283). `extend.ejs` depends on those rules but doesn't define or import them itself — it only works today because `admin.ejs` happens to include both partials on the same page, so the CSS bleeds across by coincidence of load order. Including `extend.ejs` on a page that doesn't also include `quick-add.ejs` (i.e. `edit-customer.ejs`) would render the modal completely unstyled.

Fix: move that `<style>` block's content into `public/css/style.css` (the global stylesheet both pages already load), so any page that includes `extend.ejs` gets a correctly styled modal regardless of what else is on the page. `.qa-launch` (styling for Quick Add's own launcher button, not used by the extend modal) moves with the rest rather than being split out — splitting one unused selector out isn't worth the extra complexity, and an unused CSS rule on a page that doesn't have the element is harmless.

**Bug found while doing this, fixed in the same move:** `extend.ejs`'s own "Extension saved" success screen (`.qa-done`, `.qa-done-ic`, `.qa-done-t`, `.qa-done-sum`, `.qa-copy-l`, `.qa-copy-box`, `.qa-copy-btn`, `.qa-copy-warn`) has **no CSS anywhere in the codebase** — not in `quick-add.ejs`'s style block (which doesn't use these classes at all) and not in `extend.ejs`'s own block (which only covers `.xt-*`). This screen has been rendering unstyled on the Customers table's existing Extend flow since it shipped. Styled now, in the same global-CSS move, matching the modal's existing dark palette and the established `.qa-ok`/`.qa-price` success-green convention.

### 2. Share the per-customer tier lookup

`server.js`'s `/admin` route already builds `extendTiers` — a map of `customer.id → { p7, p30 }` — through `promotedTier(resolveGamePrices(getGame(c.game_id)), type, promo)`, specifically so the modal's price preview and the save route price off the identical function (the comment at that call site names the exact bug this was built to prevent: two copies drifting). `GET /admin/customers/edit/:id` needs the same `{ p7, p30 }` for the one customer it's rendering.

Fix: extract a small helper — `extendTierFor(customer, promo)` — that both call sites use: `/admin` maps it over every renting customer to build `extendTiers`; the edit-customer route calls it once for the single customer it has. One function, two callers, cannot drift.

### 3. Wire it into Edit Customer

- `edit-customer.ejs` gets `<%- include('partials/admin/extend') %>` (same partial, unchanged) and, next to the existing "Save Changes" / "Cancel" buttons, an `⏩ Extend` button — same `data-*` attributes the table row already sets (`data-id`, `data-name`, `data-game`, `data-end`, `data-p7`, `data-p30`, `data-today`), same `onclick`/class (`cst-extend`) so it fires through the identical delegated click handler `xtOpen(...)` already wired for the table.
- Only rendered when `customer.status === 'renting'` — same guard the table button uses. The route independently rejects anything else regardless (`existing.status !== 'renting'` → `bad_status`), so a stale render can't extend a finished/bought/reservation record either way; this is just keeping the button itself honest about when it does something.
- The click-delegation listener that currently lives in `views/partials/admin/customers.ejs` (`document.addEventListener('click', ...)` for `.cst-extend`) needs to also exist on `edit-customer.ejs` — that page doesn't include `customers.ejs`. Simplest: move that one delegated listener (it's ~10 lines, reads the button's own `data-*` attributes, calls `xtOpen`) into `extend.ejs`'s own script, right alongside `xtOpen` — so any page that includes the extend partial gets the click wiring for free, and `customers.ejs` drops its copy instead of keeping a second one.

### 4. Fix the stale-form hazard

Today, `xtClose()` (the ✕ button, and clicking the overlay backdrop) does **not** reload the page — only `xtDoneClose()` (the "Done" button on the success screen) does. On the Customers table this is a cosmetic gap: the row shows the old end date until the next refresh. On Edit Customer it's a real bug: closing with ✕ after a successful extend leaves the Price and End Date fields showing the *pre-extension* values, and clicking **Save Changes** writes those stale values straight back over the extension that was just saved.

Fix: track whether the modal is currently showing a successful extend (a module-level flag, set true in the `data.ok` branch of `xtSubmit()`, set false in `xtOpen()`). `xtClose()` — the function behind the ✕ button *and* clicking the backdrop — checks that flag: if true, it does what `xtDoneClose()` already does (`location.reload()`) instead of a bare `classList.remove('open')`. The success screen still shows first either way (the flag is only consulted when something closes the modal, not the instant the fetch resolves), so the customer's message and Copy button are unaffected — the only change is that *every* way of dismissing a successful extend now reloads, not just the "Done" button. This fixes both surfaces (Customers table and Edit Customer) from the one change, since both load `extend.ejs`'s shared script.

### Explicitly out of scope

- No changes to `lib/extensions.js`, the `/extend` route's pricing/payment/order-sync logic, or the extension message template.
- No changes to how the Customers table renders or triggers Extend beyond dropping its now-duplicated click listener (behavior is identical, just wired from the shared partial).
- No new database fields, no new routes.

## Testing

- A render check that the `⏩ Extend` button appears on `edit-customer.ejs` for a `renting` customer and not for `done`/`bought`/`reservation`, mirroring the existing table-side behavior.
- A check that `extendTierFor` returns identical `{ p7, p30 }` for a given customer whether called from the `/admin` list-building path or the single-customer edit-page path (the anti-drift guarantee this refactor exists to preserve).
- Browser verification: seed a live rental, open Edit Customer, click Extend, confirm the previewed price/new-end-date, submit, confirm the success screen is now actually styled (proving the CSS-location bug is fixed), close with ✕ (not Done), and confirm the page reloaded with the new price/end date already in the form fields — i.e. the stale-write hazard cannot occur.
- Re-verify the existing Customers-table Extend flow still works unchanged (price preview, submit, message, close) after the CSS move and the shared-listener change — this is the regression risk of touching shared code two features depend on.
