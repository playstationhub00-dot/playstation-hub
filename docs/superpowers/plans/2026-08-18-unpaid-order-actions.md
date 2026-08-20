# Unpaid Order Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner two actions on an unpaid order — Mark as paid (for Messenger payments) and Cancel — where today only Delete exists.

**Architecture:** One state-graph widening in `lib/orders.js`, two new Express routes in `server.js` that mirror the existing `reject` route's shape, and two new buttons in `views/partials/order-queue.ejs` alongside the existing Copy/Delete controls on the "Didn't pay" rows.

**Tech Stack:** Node/Express, lowdb (site settings) + MongoDB (orders, via `lib/orders.js`), EJS. No new dependencies.

## Global Constraints

- Mark as paid transitions an order to **`awaiting_qr`**, never `active`. Revenue is recorded later by the existing `POST /admin/orders/:ref/advance` route when the owner signs the customer in — this plan does not touch that route or create any customer record itself.
- Only orders in **`awaiting_payment`** or **`payment_rejected`** may be marked paid or cancelled. Any other state redirects with `msg=order_bad_state`, matching the existing convention set by `POST /admin/orders/:ref/advance` (`server.js:1828-1830`).
- The state-graph change is exactly: add `'awaiting_qr'` to the `ALLOWED` array for both `awaiting_payment` and `payment_rejected` in `lib/orders.js`. No other entry in `ALLOWED` changes.
- Cancel requires a confirm dialog client-side, matching the existing Delete button's pattern (`views/partials/order-queue.ejs:306`).
- No change to `OWNER_STATES`, `PAID_EXCLUDED_STATES`, the "Needs you" queue, the All Orders table, or any customer-facing view.

---

### Task 1: Widen the state graph

**Files:**
- Modify: `lib/orders.js:21-38` (the `ALLOWED` map)

**Interfaces:**
- Consumes: nothing.
- Produces: `orders.canTransition('awaiting_payment', 'awaiting_qr')` and `orders.canTransition('payment_rejected', 'awaiting_qr')` both return `true`. Task 2's routes depend on this.

- [ ] **Step 1: Add the new target to both states**

Find this block in `lib/orders.js`:

```js
const ALLOWED = {
  awaiting_payment:  ['verifying_payment', 'cancelled'],
  // Reservation orders (Coming Soon downpayments) settle into 'reserved'
  // instead of 'awaiting_qr' — there is no console to sign into until the
  // game actually releases.
  verifying_payment: ['awaiting_qr', 'reserved', 'payment_rejected', 'cancelled'],
  payment_rejected:  ['awaiting_payment', 'cancelled'],
  awaiting_qr:       ['qr_pending', 'cancelled'],
```

Replace with:

```js
const ALLOWED = {
  // 'awaiting_qr' lets the owner confirm a payment that arrived outside the
  // site (e.g. Messenger) without routing it through verifying_payment,
  // which would make the owner "verify" a payment they personally just
  // confirmed. See POST /admin/orders/:ref/mark-paid.
  awaiting_payment:  ['verifying_payment', 'awaiting_qr', 'cancelled'],
  // Reservation orders (Coming Soon downpayments) settle into 'reserved'
  // instead of 'awaiting_qr' — there is no console to sign into until the
  // game actually releases.
  verifying_payment: ['awaiting_qr', 'reserved', 'payment_rejected', 'cancelled'],
  payment_rejected:  ['awaiting_payment', 'awaiting_qr', 'cancelled'],
  awaiting_qr:       ['qr_pending', 'cancelled'],
```

- [ ] **Step 2: Verify the change with a direct require check**

Run:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -e "
const orders = require('./lib/orders.js');
const cases = [
  ['awaiting_payment', 'awaiting_qr', true],
  ['payment_rejected', 'awaiting_qr', true],
  ['awaiting_payment', 'cancelled', true],
  ['payment_rejected', 'cancelled', true],
  ['awaiting_payment', 'verifying_payment', true],
  ['awaiting_qr', 'awaiting_payment', false],
  ['closed', 'awaiting_qr', false]
];
let fail = false;
cases.forEach(([from, to, expected]) => {
  const actual = orders.canTransition(from, to);
  const ok = actual === expected;
  if (!ok) fail = true;
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + from + ' -> ' + to + ' expected ' + expected + ' got ' + actual);
});
process.exit(fail ? 1 : 0);
"
```

Expected: seven `PASS` lines, exit code 0. Any `FAIL` means `ALLOWED` was edited incorrectly — re-check Step 1 before continuing.

- [ ] **Step 3: Commit**

```bash
git add lib/orders.js
git commit -m "Allow awaiting_payment and payment_rejected to reach awaiting_qr"
```

---

### Task 2: Add the mark-paid and cancel routes

**Files:**
- Modify: `server.js` (new routes placed directly after the existing `POST /admin/orders/:ref/reject` route, currently at `server.js:1983-1989`)

**Interfaces:**
- Consumes: `orders.getByRef(ref)` and `orders.transition(ref, toState, patch)` from `lib/orders.js`, both already used by every neighboring route in this file. Consumes Task 1's widened `ALLOWED` graph.
- Produces: `POST /admin/orders/:ref/mark-paid` and `POST /admin/orders/:ref/cancel`, both `requireAuth`. Task 3's buttons POST to these exact paths.

- [ ] **Step 1: Add the two routes**

Find this block in `server.js`:

```js
app.post('/admin/orders/:ref/reject', requireAuth, async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/admin?tab=orders');
  const r = await orders.transition(order.ref, 'payment_rejected', { payment_proof: null, payment_channel: null });
  if (!r) return res.redirect('/admin?tab=orders&msg=order_stale');
  res.redirect('/admin?tab=orders&msg=order_rejected');
});
```

Immediately after it, add:

```js
// Confirms a payment that arrived outside the site (e.g. Messenger). Lands
// in awaiting_qr, not active — the customer still needs to send their
// sign-in QR before the rental clock starts. Revenue is recorded later by
// the existing advance route at that point, not here.
app.post('/admin/orders/:ref/mark-paid', requireAuth, async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/admin?tab=orders');
  if (!['awaiting_payment', 'payment_rejected'].includes(order.state)) {
    return res.redirect('/admin?tab=orders&msg=order_bad_state');
  }
  const r = await orders.transition(order.ref, 'awaiting_qr', {});
  if (!r) return res.redirect('/admin?tab=orders&msg=order_stale');
  res.redirect('/admin?tab=orders&msg=order_marked_paid');
});

// Owner-initiated cancellation for an unpaid order — the customer said no,
// or never followed up. Distinct from Delete: this keeps the record (and
// its state_history) instead of removing it.
app.post('/admin/orders/:ref/cancel', requireAuth, async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/admin?tab=orders');
  if (!['awaiting_payment', 'payment_rejected'].includes(order.state)) {
    return res.redirect('/admin?tab=orders&msg=order_bad_state');
  }
  const r = await orders.transition(order.ref, 'cancelled', {});
  if (!r) return res.redirect('/admin?tab=orders&msg=order_stale');
  res.redirect('/admin?tab=orders&msg=order_cancelled');
});
```

- [ ] **Step 2: Verify server syntax**

Run:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -c server.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Verify both routes are registered and correctly ordered relative to reject**

Run:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && grep -n "orders/:ref/reject\|orders/:ref/mark-paid\|orders/:ref/cancel'" server.js
```

Expected: three lines, `reject` first, then `mark-paid`, then `cancel`, each with `requireAuth`.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Add mark-paid and cancel routes for unpaid orders"
```

---

### Task 3: Add the buttons and their toasts

**Files:**
- Modify: `views/partials/order-queue.ejs:304-309` (the "Didn't pay" row's button group)
- Modify: `views/admin.ejs` (the client-side toast dictionary, around line 3610)

**Interfaces:**
- Consumes: `POST /admin/orders/:ref/mark-paid` and `POST /admin/orders/:ref/cancel` from Task 2. Consumes `o.ref` and `o.fb_name`, both already in scope inside the `sortedAbandoned.forEach` loop this block lives in (`views/partials/order-queue.ejs:279`).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add the two buttons**

Find this block in `views/partials/order-queue.ejs`:

```html
      <div class="oq-ab-btns">
        <button type="button" class="btn-copy rem-copy" data-msg="<%= followUpMsg %>" title="Copy follow-up message">📋 Copy</button>
        <form method="POST" action="/admin/orders/<%= o.ref %>/delete" onsubmit="return confirm('Delete order ' + <%= JSON.stringify(o.ref) %> + '? Use this to clear out duplicate or accidental orders. This cannot be undone.');">
          <button type="submit" class="oq-btn-no" title="Delete this order (e.g. a duplicate from the customer re-ordering)">Delete</button>
        </form>
      </div>
```

Replace with:

```html
      <div class="oq-ab-btns">
        <button type="button" class="btn-copy rem-copy" data-msg="<%= followUpMsg %>" title="Copy follow-up message">📋 Copy</button>
        <form method="POST" action="/admin/orders/<%= o.ref %>/mark-paid" onsubmit="return confirm('Mark order ' + <%= JSON.stringify(o.ref) %> + ' as paid? Use this when the customer paid outside the site (e.g. Messenger). They\'ll still need to send their sign-in QR.');">
          <button type="submit" class="oq-btn-go" title="Confirm this order was paid outside the site">✅ Mark paid</button>
        </form>
        <form method="POST" action="/admin/orders/<%= o.ref %>/cancel" onsubmit="return confirm('Cancel order ' + <%= JSON.stringify(o.ref) %> + '? The customer said no or never followed up. The record is kept, unlike Delete.');">
          <button type="submit" class="oq-btn-no" title="Cancel this order — the customer declined or never paid">Cancel</button>
        </form>
        <form method="POST" action="/admin/orders/<%= o.ref %>/delete" onsubmit="return confirm('Delete order ' + <%= JSON.stringify(o.ref) %> + '? Use this to clear out duplicate or accidental orders. This cannot be undone.');">
          <button type="submit" class="oq-btn-no" title="Delete this order (e.g. a duplicate from the customer re-ordering)">Delete</button>
        </form>
      </div>
```

`.oq-btn-go` and `.oq-btn-no` are existing classes (`public/css/style.css:2588-2589`) — no new CSS is needed. `.oq-btn-go` is the same solid-blue treatment already used elsewhere in this partial for primary actions; `.oq-btn-no` is the existing outline style, already used twice on this exact row for Delete, and reused here for Cancel so the two dismissive actions share one visual language.

- [ ] **Step 2: Add toast entries for the two new messages**

Find this line in `views/admin.ejs` (the client-side `messages` dictionary, around line 3610 — it is one very long single-line object literal):

```js
const messages = { added:'✅ Game added!', updated:'✅ Game updated!', deleted:'🗑 Game deleted!', announcement:'📢 Announcement saved!', upcoming_added:'🔜 Upcoming game added!', upcoming_updated:'✅ Upcoming game updated!', upcoming_deleted:'🗑 Upcoming game deleted!', game_released:'🚀 Game released to Available Games!', psplus_added:'⭐ Monthly entry added!', psplus_updated:'✅ Monthly entry updated!', psplus_deleted:'🗑 Monthly entry deleted!', psplus_prices:'💰 PS Plus prices saved!', popular_added:'🔥 Game added to Most Played!', popular_updated:'✅ Most Played game updated!', popular_deleted:'🗑 Game removed from Most Played!', settings_saved:'⚙️ Settings saved!', promo_saved:'🎉 Promo settings saved!', popup_saved:'🪧 Popup settings saved!', password_changed:'🔒 Password changed!', wrong_password:'❌ Current password is wrong!', password_mismatch:'❌ Passwords do not match!', password_too_short:'❌ Password must be at least 4 characters!', cat_added:'🏷️ Category created!', cat_updated:'🏷️ Category updated!', cat_deleted:'🗑 Category deleted!', customer_added:'👤 Customer added!', customer_updated:'✅ Customer updated!', customer_deleted:'🗑 Customer deleted!', month_log_saved:'📣 Month log saved!', month_log_deleted:'🗑 Month log deleted!', signin_step_saved:'✅ Step saved!', signin_step_deleted:'🗑 Step deleted!' };
```

Replace with the same line plus two new entries appended before the closing `}`:

```js
const messages = { added:'✅ Game added!', updated:'✅ Game updated!', deleted:'🗑 Game deleted!', announcement:'📢 Announcement saved!', upcoming_added:'🔜 Upcoming game added!', upcoming_updated:'✅ Upcoming game updated!', upcoming_deleted:'🗑 Upcoming game deleted!', game_released:'🚀 Game released to Available Games!', psplus_added:'⭐ Monthly entry added!', psplus_updated:'✅ Monthly entry updated!', psplus_deleted:'🗑 Monthly entry deleted!', psplus_prices:'💰 PS Plus prices saved!', popular_added:'🔥 Game added to Most Played!', popular_updated:'✅ Most Played game updated!', popular_deleted:'🗑 Game removed from Most Played!', settings_saved:'⚙️ Settings saved!', promo_saved:'🎉 Promo settings saved!', popup_saved:'🪧 Popup settings saved!', password_changed:'🔒 Password changed!', wrong_password:'❌ Current password is wrong!', password_mismatch:'❌ Passwords do not match!', password_too_short:'❌ Password must be at least 4 characters!', cat_added:'🏷️ Category created!', cat_updated:'🏷️ Category updated!', cat_deleted:'🗑 Category deleted!', customer_added:'👤 Customer added!', customer_updated:'✅ Customer updated!', customer_deleted:'🗑 Customer deleted!', month_log_saved:'📣 Month log saved!', month_log_deleted:'🗑 Month log deleted!', signin_step_saved:'✅ Step saved!', signin_step_deleted:'🗑 Step deleted!', order_marked_paid:'✅ Order marked as paid!', order_cancelled:'🚫 Order cancelled.' };
```

This is the same convention every other admin action already follows in this dictionary — `order_bad_state` and `order_stale` deliberately get no entry, matching how the pre-existing `order_advanced`/`order_rejected` messages already produce no toast today (the `if (text)` guard at the end of this block skips silently when a key is absent). This plan does not add entries for those two, to stay consistent with the existing pattern rather than introduce toasts only for the new routes' happy path.

- [ ] **Step 3: Verify the template compiles**

Run:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -e "require('ejs').compile(require('fs').readFileSync('views/partials/order-queue.ejs','utf8'))" && node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'))"
```

Expected: no output, exit code 0.

- [ ] **Step 4: Verify the new routes and toast keys are all present in the edited files**

Run:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && grep -c "orders/<%= o.ref %>/mark-paid\|orders/<%= o.ref %>/cancel" views/partials/order-queue.ejs
grep -c "order_marked_paid\|order_cancelled" views/admin.ejs
```

Expected: first command prints `2`, second prints `2` (each key appears once in `msgTabMap` is not required — only in `messages` — so `2` total occurrences of the two literal strings is correct here since neither was added to `msgTabMap`).

- [ ] **Step 5: Commit**

```bash
git add views/partials/order-queue.ejs views/admin.ejs
git commit -m "Add Mark paid and Cancel buttons to unpaid orders, with toasts"
```

- [ ] **Step 6: Deploy and verify live**

```bash
git push origin main
```

Poll until the deploy has rolled over:

```bash
for i in 1 2 3 4 5 6 7 8; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "https://playstation-hub.com/admin/orders/PH-0000/mark-paid")
  [ "$code" = "302" ] && echo "route live at attempt $i (redirected — expected, PH-0000 doesn't exist)" && break
  echo "attempt $i: $code"; sleep 20
done
```

A `302` (redirect) confirms the route exists and is reachable — a nonexistent ref just redirects to `/admin?tab=orders` per the routes' own `if (!order)` guard, which is expected and harmless. A `404` means the deploy has not rolled over yet; a `401`/`403` would mean the auth guard fired, which is also fine since it proves the route exists but requires login (this poll is unauthenticated).

Then, using the Browser tool:
1. Navigate to `https://playstation-hub.com/admin`, log in (password `Ryuzaki2300` — admin sessions expire after every redeploy).
2. Go to Orders. Confirm the "Started but didn't pay" section shows **Mark paid** and **Cancel** buttons alongside Copy and Delete on every row.
3. Pick one real `awaiting_payment` order from that list (or, if none exist, use the admin panel to note a real ref from a test — do not fabricate an order against production). Click **Mark paid**, confirm the dialog. Confirm the toast reads "Order marked as paid!" and the order disappears from the "Didn't pay" list.
4. `awaiting_qr` is not in `OWNER_STATES`, so the order will **not** appear in the "Needs you" queue — this is expected, matching every other order sitting in `awaiting_qr` today (the owner queue only surfaces `verifying_payment`, `qr_pending`, `verifying_return`). Confirm instead, in the "All Orders" table, that the order's status now reads **"Out on rent"** (`views/partials/order-queue.ejs:197-208`: `awaiting_qr` is included in the `out` state list, so it takes the `out ? 'Out on rent' : 'Completed'` label and the `oq-st-live` styling) — this is the correct, if slightly optimistic-looking, label for an order still waiting on the customer's QR.
5. On a second `awaiting_payment` or `payment_rejected` order, click **Cancel**, confirm the dialog, confirm the toast reads "Order cancelled." and the row now displays under whatever grouping `cancelled` orders use in the All Orders table (per `views/partials/order-queue.ejs`'s existing `grp === 'cancelled'` branch).
6. Confirm clicking Mark paid or Cancel on an order already in a later state (e.g. by attempting the action twice, or via a direct POST replay) redirects without error and does not corrupt the order — the second attempt should be a no-op guarded by the `order_bad_state` check.
