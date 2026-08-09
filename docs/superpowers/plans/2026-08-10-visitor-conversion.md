# Visitor Conversion: Friction Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-built on-site order flow the primary path on the game detail page instead of Messenger, fix the silent order-form bounce that cost a real order attempt, close the gap where completed web orders never become customer records, and add the instrumentation needed to tell whether any of this worked.

**Architecture:** All four changes are additive edits to existing, working code — no new routes, no new collections, no new state machine transitions. Task 1 flips CSS/markup/JS in `views/game-detail.ejs` and shows the existing `order_error` query param that the server already sets but the view has never rendered. Task 2 adds one write inside the existing `/admin/orders/:ref/advance` handler. Task 3 adds a read-only panel to the existing order-queue partial using the existing `orders.listByStates()` function. Task 4 adds a one-line computed readout to the same partial, reading the existing `visitors` collection.

**Tech Stack:** Express.js + EJS server-rendered views, vanilla JS (no framework, no bundler), lowdb for `customers`/`visitors`, MongoDB for `orders` (via `lib/orders.js`, already built). No test framework in this project; verification is `node -c server.js`, EJS tag-balance / CSS brace-balance greps, and live smoke-testing on Railway after deploy — the project's established convention.

## Global Constraints

- The Messenger path must remain fully functional and one tap away — demoted, never removed (spec: "The change").
- The CTA button's price must be the same total already computed for the order summary (`base − discount + deposit`) — never a second, independently-computed figure (spec: "The button carries the live total").
- The disabled/incomplete state (no type or duration picked yet) must stay visibly disabled with the copy `Pick an account type and duration first`, not just silently unclickable (spec: "The disabled state is preserved").
- `order_error=1` must render a visible message near the booking panel; `order_error=rate` (the existing rate-limit case, redirected to `/browse`, not the game page) is unrelated and out of scope for this plan (spec: "Fix the silent order-form bounce").
- A customer record must be created exactly once per order when it reaches `active` — re-running the advance action (a retried request, a lost race) must never create a duplicate. Store `customer_id` on the order and check it first (spec: "Idempotency is required").
- The ₱100 refundable deposit is never revenue: it must not appear in the created customer's `price` field or in its `payments` array (spec: "The refundable ₱100 deposit is not revenue").
- Only orders that reach `active` **after this change ships** create customer records. PH-0003 and any other pre-existing order are not backfilled (spec: "Out of scope").
- The abandoned-orders panel and the funnel readout are the measurement instruments for the decision rule recorded in the spec (order-start rate ≥4% → keep, 1–4% → iterate, Messenger inquiries −30% and rentals <21 → revert) — they must report real counts, not placeholders, since the rule cannot be evaluated otherwise.
- `node -c server.js` must exit 0 after every server.js change.
- EJS tag-balance (`<%` count == `%>` count) must be verified for every `.ejs` file touched.
- CSS brace-balance must be verified for `public/css/style.css` before committing.
- No local dev server exists — live verification happens against https://playstation-hub.com after `git push` (Railway auto-deploys, ~60-90s).

---

### Task 1: Flip the CTA hierarchy and fix the silent bounce

**Files:**
- Modify: `views/game-detail.ejs:273-290` (booking panel markup), `views/game-detail.ejs:437-443` (mobile sticky bar), `views/game-detail.ejs:706-740` (`updateCtaState()`), `views/game-detail.ejs:746-796` (`syncStickyBar()`), `views/game-detail.ejs:798-824` (`handleStickyBarClick()`)
- Modify: `public/css/style.css:667-677` (booking panel styles), plus new rules for the order form's primary treatment and the error banner

**Interfaces:**
- Consumes: `game.id`, `computeRentTotal(type, days)` (existing client-side function, `views/game-detail.ejs:466-472`), `AVAIL` (existing client-side object), the existing `#gdOrderForm` POSTing to `/order/create` (server-side, unchanged in this task).
- Produces: nothing new consumed by later tasks — this task is self-contained to the game detail page.

- [ ] **Step 1: Restructure the booking panel markup**

In `views/game-detail.ejs`, replace the block from the `<% if (!allUnavail) { %>` CTA section through the closing `</div>` of `#ctaValidationMsg` (currently lines 273-290):

```ejs
        <% if (!allUnavail) { %>
        <!-- Primary: order on the site. Runs the name field and the price
             button as one action — no separate "or" section. -->
        <form method="POST" action="/order/create" class="gd-order-form" id="gdOrderForm">
          <input type="hidden" name="game_id" value="<%= game.id %>">
          <input type="hidden" name="account_type" id="orderType" value="">
          <input type="hidden" name="days" id="orderDays" value="">
          <input type="text" name="fb_name" id="orderFbName" class="gd-order-name" placeholder="Your Facebook name" required>
          <button type="submit" class="gd-order-btn gd-cta-wait" id="ctaBtn" disabled>Pick an account type</button>
          <div class="gd-order-sub" id="ctaSub" style="display:none;">Pay via GCash or Maya · no account needed</div>
        </form>

        <!-- Secondary: Messenger, always one tap away -->
        <a href="#" class="gd-cta-link" id="ctaMsgLink" onclick="return handleMessageUs(event)">or message us on Facebook instead</a>
        <div class="gd-cta-hint" id="ctaHint" style="display:none;">Send us: <strong>Game name · Days · Trophy or Non-Trophy</strong></div>

        <div id="ctaValidationMsg" style="display:none;text-align:center;margin-top:0.5rem;font-size:0.82rem;color:#ef4444;font-weight:600;"></div>
        <% if (order_error === '1') { %>
        <div class="gd-order-error">⚠️ Please pick an account type and duration, and enter your Facebook name, before continuing.</div>
        <% } %>
```

This removes the old grey "or book on the site" divider entirely, moves the Facebook name input above the primary button, renames `#ctaBtn` from an `<a>` to a `<button>` (it now submits the order form directly instead of navigating to Messenger), and adds a new `#ctaMsgLink` — a plain link — to carry the Messenger action that `#ctaBtn` used to own.

**Important:** `#ctaBtn` changes from an `<a>` to a `<button type="submit">` inside `#gdOrderForm`. Its `onclick="return handleMessageUs(event)"` is removed — clicking it now submits the order form natively. The Messenger action moves to the new `#ctaMsgLink` anchor, which keeps `handleMessageUs(event)` as its `onclick` exactly as `#ctaBtn` had it before.

- [ ] **Step 2: Update `updateCtaState()` for the new element roles**

In `views/game-detail.ejs`, replace `updateCtaState()` (currently lines 706-740):

```js
function updateCtaState() {
  const ctaBtn = document.getElementById('ctaBtn');
  const ctaSub = document.getElementById('ctaSub');
  const ctaHint = document.getElementById('ctaHint');
  const ctaMsgLink = document.getElementById('ctaMsgLink');
  const reserveSection = document.getElementById('reserveSection');
  if (!ctaBtn) return;

  const oType = document.getElementById('orderType');
  const oDays = document.getElementById('orderDays');
  if (oType) oType.value = selectedType || '';
  if (oDays) oDays.value = selectedDays || '';

  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (selectedType && !hasSlot) {
    ctaBtn.style.display = 'none';
    if (ctaSub) ctaSub.style.display = 'none';
    if (ctaHint) ctaHint.style.display = 'none';
    if (ctaMsgLink) ctaMsgLink.style.display = 'none';
    if (reserveSection) reserveSection.style.display = '';
    return;
  }
  ctaBtn.style.display = '';
  if (ctaMsgLink) ctaMsgLink.style.display = '';
  if (reserveSection) reserveSection.style.display = 'none';

  if (!selectedType) {
    ctaBtn.textContent = 'Pick an account type';
    ctaBtn.classList.add('gd-cta-wait');
    ctaBtn.disabled = true;
    if (ctaSub) ctaSub.style.display = 'none';
    if (ctaHint) ctaHint.style.display = 'none';
  } else if (!selectedDays) {
    ctaBtn.textContent = 'Pick a duration';
    ctaBtn.classList.add('gd-cta-wait');
    ctaBtn.disabled = true;
    if (ctaSub) ctaSub.style.display = 'none';
    if (ctaHint) ctaHint.style.display = 'none';
  } else {
    const rt = computeRentTotal(selectedType, selectedDays);
    ctaBtn.textContent = '🎮 Rent now — ₱' + rt.total;
    ctaBtn.classList.remove('gd-cta-wait');
    ctaBtn.disabled = false;
    if (ctaSub) ctaSub.style.display = '';
    if (ctaHint) ctaHint.style.display = '';
  }
}
```

The `Pick an account type and duration first` copy the spec calls for is the disabled button's own text across both incomplete states (`Pick an account type`, then `Pick a duration`) — matching the existing two-stage wording already in this function, rather than introducing a third, redundant string.

- [ ] **Step 3: Update `syncStickyBar()`'s rent-mode label**

In `views/game-detail.ejs`, inside `syncStickyBar()` (currently lines 746-796), replace the final `else` branch (currently lines 789-794):

```js
  } else {
    const rt = computeRentTotal(selectedType, selectedDays);
    kEl.textContent = 'To send now';
    aEl.textContent = '₱' + rt.total;
    bEl.textContent = 'Rent now';
    bEl.classList.remove('gd-cta-wait');
  }
```

Only the button label changes (`'Message us'` → `'Rent now'`); the kicker/amount logic is untouched.

- [ ] **Step 4: Update `handleStickyBarClick()` to focus the order form instead of clicking `#ctaBtn`**

In `views/game-detail.ejs`, in `handleStickyBarClick()` (currently lines 798-824), replace the final line `document.getElementById('ctaBtn')?.click();` with:

```js
  const nameField = document.getElementById('orderFbName');
  if (nameField) {
    document.getElementById('gdOrderForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nameField.focus();
  } else {
    document.getElementById('ctaBtn')?.click();
  }
```

`#ctaBtn` is now a submit button inside `#gdOrderForm` rather than a standalone link, so a sticky-bar tap with both selections already made should bring the visitor to the name field (per the spec: "tapping it scrolls to and focuses the name input") rather than immediately submitting a form whose required field is still empty.

- [ ] **Step 5: Update the booking-panel CSS**

In `public/css/style.css`, replace the block from `.gd-cta-btn` through `.gd-order-note` (currently lines 667-677):

```css
.gd-order-form { margin-top: 1.25rem; }
.gd-order-name { width: 100%; background: #111; border: 1.5px solid #222; border-radius: 10px; padding: 0.75rem 0.9rem; color: #fff; font-size: 0.9rem; font-family: inherit; margin-bottom: 0.6rem; }
.gd-order-name:focus { outline: none; border-color: var(--ps-blue); }
.gd-order-btn { display: block; width: 100%; text-align: center; background: var(--ps-blue); color: #fff; border: none; padding: 0.9rem; border-radius: 10px; font-weight: 700; font-size: 1rem; font-family: inherit; cursor: pointer; transition: opacity 0.15s; }
.gd-order-btn:hover { opacity: 0.85; }
.gd-order-btn.gd-cta-wait { background: #1a1a1a; color: #666; cursor: not-allowed; }
.gd-order-sub { text-align: center; font-size: 0.75rem; color: #666; margin-top: 0.5rem; }
.gd-cta-link { display: block; text-align: center; font-size: 0.82rem; color: #888; text-decoration: underline; margin-top: 0.75rem; }
.gd-cta-link:hover { color: #aaa; }
.gd-cta-hint { text-align: center; font-size: 0.75rem; color: #444; margin-top: 0.5rem; }
.gd-order-error { text-align: center; font-size: 0.82rem; color: #ef4444; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 0.65rem 0.9rem; margin-top: 0.75rem; font-weight: 600; }
```

`.gd-order-btn` reuses the exact colour (`var(--ps-blue)`) and disabled treatment (`background: #1a1a1a; color: #666`) the old `.gd-cta-btn` used, so the primary action's visual weight is unchanged — only which action it performs has moved.

- [ ] **Step 6: Pass `order_error` from the route to the view**

In `server.js:1392`, the `GET /game/:slug` route's render call (the route `/order/create`'s error redirects target) currently reads:

```js
  res.render('game-detail', { game: resolved, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: gdSettings, promo: gdSettings.promo, accountSummary: gameAccountSummary(game.id) });
```

Add `order_error: req.query.order_error || null` to that object:

```js
  res.render('game-detail', { game: resolved, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: gdSettings, promo: gdSettings.promo, accountSummary: gameAccountSummary(game.id), order_error: req.query.order_error || null });
```

so the view's `<% if (typeof order_error !== 'undefined' ...) %>` check in Step 1 has real data rather than always seeing `undefined`.

- [ ] **Step 7: Verify syntax and balance**

Run: `node -c server.js` — expect exit 0.
Run: `grep -o '<%' views/game-detail.ejs | wc -l` and `grep -o '%>' views/game-detail.ejs | wc -l` — expect equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — expect equal.

- [ ] **Step 8: Commit**

```bash
git add views/game-detail.ejs public/css/style.css server.js
git commit -m "$(cat <<'EOF'
Make on-site ordering the primary CTA on the game page

97.7% of visitors never contact the business at all, and both the
primary button and the mobile sticky bar previously sent every one of
them to Messenger — the 15-second on-site order flow sat below a grey
divider reading "or book on the site". Messenger closes at 83% once
someone starts talking, so the bottleneck was entirely upstream of
that conversation.

The order form (name + button) is now the primary action, carrying the
live total ("Rent now — P479") instead of a mechanism-only label. The
button stays visibly disabled with what's still needed until an
account type and duration are picked. Messenger is demoted to a text
link directly underneath, not removed — the on-site flow still ends in
Messenger for payment proof, so the conversation is unchanged, only
where in the process it starts.

Also renders the order_error=1 the server has redirected on since the
order flow shipped, but the game page never displayed — a real visitor
hit this silently on 2026-08-09 and had to retry blind.
EOF
)"
```

---

### Task 2: Write a customer record when an order goes active

**Files:**
- Modify: `server.js:1288-1307` (`POST /admin/orders/:ref/advance`)
- Modify: `lib/orders.js` (add `setCustomerId`, the write that records idempotency)

**Interfaces:**
- Consumes: `orders.transition(ref, toState, patch)`, `orders.getByRef(ref)`, `orders.manilaDate(date)` (all existing, `lib/orders.js`), `newCustomerId()` (existing, `server.js:444-448`), `getGame(id)` (existing, `server.js:356`), `adjustTrophySlots`/`adjustNtSlots`/`adjustPs4Slots` (existing, `server.js:891-913`), `db.get('customers').push(...)` / `db.get('games').find(...).assign(...)` (existing lowdb patterns, mirrored from `server.js:2181-2205`).
- Produces: `order.customer_id` (number), a new field on order documents, read by this same handler on any retry to skip duplicate creation.

- [ ] **Step 1: Add `setCustomerId` to `lib/orders.js`**

In `lib/orders.js`, immediately after `markRefunded` (currently ending around line 179, before `linkPsid`), insert:

```js
// Records the customer-table id an order produced when it went active, so a
// retried or raced advance call never creates a second customer record for
// the same order. Not a lifecycle move, so it bypasses transition().
async function setCustomerId(ref, customerId) {
  const col = await _col('orders');
  if (!col) return false;
  const clean = parseOrderRef(ref);
  if (!clean) return false;
  const r = await col.updateOne({ ref: clean }, { $set: { customer_id: customerId } });
  return r.modifiedCount > 0;
}
```

Add `setCustomerId` to the `module.exports` object at the bottom of the file, alongside the other named exports.

- [ ] **Step 2: Write the customer record inside the advance route**

In `server.js`, replace the `to === 'active'` branch of `POST /admin/orders/:ref/advance` (currently lines 1294-1303):

```js
  const patch = {};
  if (to === 'active') {
    // The rental clock starts when the owner actually signs them in, not when
    // the order was placed — a customer who paid overnight isn't billed for
    // hours they couldn't play. Both dates are Manila dates: on a UTC server
    // an ISO slice reports yesterday for the whole Manila morning.
    const start = new Date();
    const end = new Date(start.getTime() + order.days * 86400000);
    patch.start_date = orders.manilaDate(start);
    patch.end_date = orders.manilaDate(end);
  }
  const r = await orders.transition(order.ref, to, patch);
  if (!r) return res.redirect('/admin?tab=orders&msg=order_stale');

  // A web order is otherwise invisible to the revenue ledger, the expiry
  // reminder panel, and top-games — all of which read the customers table,
  // not the orders collection. order.customer_id makes this idempotent: a
  // retried or raced advance call must never create a second customer.
  if (to === 'active' && !order.customer_id) {
    const game = getGame(order.game_id);
    const customerId = newCustomerId();
    db.get('customers').push({
      id: customerId,
      customer_name: order.fb_name,
      game_id: parseInt(order.game_id),
      game_title: order.game_title,
      days: order.days,
      account_type: order.account_type,
      start_date: patch.start_date,
      end_date: patch.end_date,
      // amount_due only — the refundable deposit is not revenue.
      price: order.amount_due || 0,
      status: 'renting',
      notes: 'Web order ' + order.ref,
      created_at: new Date().toISOString(),
      payments: order.amount_due > 0
        ? [{ amount: order.amount_due, date: patch.start_date, kind: 'rental' }]
        : [],
    }).write();
    if (game) {
      db.get('games').find({ id: game.id }).assign({
        available_slots: Math.max(0, (game.available_slots || 0) - 1),
        renters: (game.renters || 0) + 1
      }).write();
      if (order.account_type === 'tr') adjustTrophySlots(game.id, -1);
      else if (order.account_type === 'ps4') adjustPs4Slots(game.id, -1);
      else adjustNtSlots(game.id, -1);
    }
    await orders.setCustomerId(order.ref, customerId);
  }

  res.redirect('/admin?tab=orders&msg=order_advanced');
```

This mirrors the manual `/admin/customers/add` route's write (`server.js:2181-2205`) field-for-field for the fields that apply — `id`, `customer_name`, `game_id`, `game_title`, `days`, `account_type`, `start_date`, `end_date`, `price`, `status`, `notes`, `created_at`, `payments` — with `notes` carrying the order reference for traceability, exactly as the spec's field table specifies.

- [ ] **Step 2: Verify syntax**

Run: `node -c server.js` — expect exit 0.
Run: `node -c lib/orders.js` — expect exit 0.

- [ ] **Step 3: Commit**

```bash
git add server.js lib/orders.js
git commit -m "$(cat <<'EOF'
Write a customer record when a web order goes active

Advancing an order to active previously only set start_date/end_date
on the order document itself. No customer record was ever created, so
a completed web rental was invisible to revenue, unique renters,
top-games, and — most concretely — the "Needs a reminder" expiry
panel, which reads the customers table. Web renters never received an
expiry reminder.

order.customer_id makes this idempotent: a retried or raced advance
call checks it first and never creates a duplicate customer or
double-counts the sale. The refundable deposit is excluded from price
and payments, matching the manual Add Customer route's rule that only
the rental price is revenue.
EOF
)"
```

---

### Task 3: "Started but didn't pay" panel

**Files:**
- Modify: `views/partials/order-queue.ejs` (new panel)
- Modify: `server.js` (feed abandoned orders into the `/admin` render)
- Modify: `public/css/style.css` (panel styles)

**Interfaces:**
- Consumes: `orders.listByStates(['awaiting_payment', 'payment_rejected'])` (existing function, `lib/orders.js:108-112`).
- Produces: nothing consumed by later tasks — this task is a self-contained read-only panel.

- [ ] **Step 1: Feed abandoned orders into the admin render**

In `server.js`, immediately after the existing `refundsOwed` computation (currently lines 1598-1600, right before `res.render('admin', {...})`), insert:

```js
  // "Started but didn't pay" — every order stuck before payment is verified.
  // The form captures a Facebook name before payment, so each row is a named
  // lead the owner can message directly, not just a statistic.
  const abandonedOrders = await orders.listByStates(['awaiting_payment', 'payment_rejected']);
```

Add `abandonedOrders` as a key to the `res.render('admin', { ... })` object, alongside the existing `orderQueue, refundsOwed,`.

- [ ] **Step 2: Add the panel to the order-queue partial**

In `views/partials/order-queue.ejs`, immediately after the closing `<% } %>` of the "Deposits to refund" block (currently ending at line 100, right before the `<script>` block), insert:

```ejs
<% if (abandonedOrders && abandonedOrders.length) { %>
<div class="oq-abandoned">
  <div class="oq-abandoned-title">⚠ Started but didn't pay (<%= abandonedOrders.length %>)</div>
  <% const sortedAbandoned = [...abandonedOrders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); %>
  <% sortedAbandoned.forEach(o => { %>
  <div class="oq-ab-row">
    <div>
      <span class="oq-ref"><%= o.ref %></span>
      <span class="oq-ab-name"><%= o.fb_name %></span>
      <div class="oq-meta">
        <%= o.game_title %> · <%= o.account_type === 'tr' ? 'Trophy' : o.account_type === 'ps4' ? 'PS4 Primary' : 'Non-Trophy' %>
        · <%= o.days === 7 ? 'Weekly' : 'Monthly' %> · ₱<%= (o.amount_due || 0) + (o.deposit_due || 0) %>
        <% if (o.state === 'payment_rejected') { %>· <span class="oq-ab-rejected">payment rejected</span><% } %>
      </div>
    </div>
    <span class="oq-ab-age" data-created="<%= o.created_at %>">--</span>
  </div>
  <% }) %>
</div>
<% } %>
```

- [ ] **Step 3: Add an age-formatting script**

In `views/partials/order-queue.ejs`, inside the existing `<script>` block's IIFE (currently lines 102-115), immediately after the existing `tick()` function and its `tick(); setInterval(tick, 1000);` calls, add:

```js
  function formatAge() {
    document.querySelectorAll('.oq-ab-age').forEach(function(el){
      var ms = Date.now() - new Date(el.dataset.created).getTime();
      var mins = Math.floor(ms / 60000);
      if (mins < 60) { el.textContent = mins + 'm ago'; return; }
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) { el.textContent = hrs + 'h ago'; return; }
      el.textContent = Math.floor(hrs / 24) + 'd ago';
    });
  }
  formatAge();
```

- [ ] **Step 4: Add the panel styles**

In `public/css/style.css`, append at the end of the file:

```css
.oq-abandoned { margin-top: 2rem; border-top: 1px solid #1a1a1a; padding-top: 1.25rem; }
.oq-abandoned-title { font-size: 0.75rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #f59e0b; margin-bottom: 0.75rem; }
.oq-ab-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; background: #0d0d0d; border: 1px solid #222; border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 0.5rem; }
.oq-ab-name { font-weight: 700; color: #ddd; margin-left: 0.5rem; }
.oq-ab-rejected { color: #ef4444; }
.oq-ab-age { font-size: 0.75rem; color: #666; white-space: nowrap; flex-shrink: 0; }
```

- [ ] **Step 5: Verify syntax and balance**

Run: `node -c server.js` — expect exit 0.
Run: `grep -o '<%' views/partials/order-queue.ejs | wc -l` and `grep -o '%>' views/partials/order-queue.ejs | wc -l` — expect equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — expect equal.

- [ ] **Step 6: Commit**

```bash
git add server.js views/partials/order-queue.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Add "Started but didn't pay" panel to the owner queue

Orders in awaiting_payment or payment_rejected were previously
invisible everywhere in admin — the owner queue only ever showed the
three states that need owner action. An order abandoned before payment
is a named lead: the form captures the Facebook name before payment,
so every row here is someone the owner can look up and message.

This is also the measurement instrument the conversion plan's decision
rule depends on — without it, started-vs-completed orders can't be
counted, so a traffic problem and a checkout problem look identical.
EOF
)"
```

---

### Task 4: Weekly funnel readout

**Files:**
- Modify: `server.js` (compute the week's counts)
- Modify: `views/partials/order-queue.ejs` (render the readout line)
- Modify: `public/css/style.css` (readout style)

**Interfaces:**
- Consumes: `orders.listByStates(orders.STATES)` (existing, all eight lifecycle states, to count every order created in the window regardless of current state), the existing `visitors` local already computed and passed to `res.render('admin', {...})` (`server.js:1577`).
- Produces: nothing consumed by later tasks — this is the final task in the plan.

- [ ] **Step 1: Compute the week's funnel counts**

In `server.js`, immediately after the `abandonedOrders` computation added in Task 3 (right before `res.render('admin', {...})`), insert:

```js
  // Weekly funnel readout: how many orders started, how many completed
  // (reached active or beyond), and what fraction that is of game-page
  // traffic in the same window. The single number the conversion plan's
  // decision rule is measured against.
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const allRecentOrders = (await orders.listByStates(orders.STATES))
    .filter(o => new Date(o.created_at) >= weekAgo);
  const startedCount = allRecentOrders.length;
  const completedCount = allRecentOrders.filter(o =>
    !['awaiting_payment', 'verifying_payment', 'payment_rejected'].includes(o.state)
  ).length;
  const abandonedCount = startedCount - completedCount;
  const weekAgoStr = orders.manilaDate(weekAgo);
  const gamePageVisits = (visitors || []).filter(v =>
    v.path && v.path.startsWith('/game/') && v.date >= weekAgoStr
  ).length;
  const orderStartRate = gamePageVisits > 0
    ? ((startedCount / gamePageVisits) * 100).toFixed(1)
    : null;
```

This must be placed after `const visitors = db.get('visitors').value();` (already at `server.js:1577`, well before this insertion point) so `visitors` is in scope.

Add `startedCount, completedCount, abandonedCount, orderStartRate,` as keys to the `res.render('admin', { ... })` object.

- [ ] **Step 2: Render the readout**

In `views/partials/order-queue.ejs`, insert at the very top of the file, before the existing `<% const QUEUE_ACTION = {...} %>` block:

```ejs
<div class="oq-funnel">
  Last 7 days: <strong><%= startedCount %> started</strong> ·
  <strong><%= completedCount %> completed</strong> ·
  <span class="oq-funnel-ab"><%= abandonedCount %> abandoned</span>
  <% if (orderStartRate !== null) { %> · <span class="oq-funnel-rate"><%= orderStartRate %>%</span> of game-page visits<% } %>
</div>
```

- [ ] **Step 3: Add the readout style**

In `public/css/style.css`, append at the end of the file:

```css
.oq-funnel { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.82rem; background: #0d0d0d; border: 1px solid #222; border-radius: 8px; padding: 0.6rem 0.9rem; color: #9aa4b0; margin-bottom: 1.25rem; overflow-x: auto; white-space: nowrap; }
.oq-funnel strong { color: #ddd; font-weight: 700; }
.oq-funnel-ab { color: #f59e0b; font-weight: 700; }
.oq-funnel-rate { color: var(--ps-blue); font-weight: 700; }
```

- [ ] **Step 4: Verify syntax and balance**

Run: `node -c server.js` — expect exit 0.
Run: `grep -o '<%' views/partials/order-queue.ejs | wc -l` and `grep -o '%>' views/partials/order-queue.ejs | wc -l` — expect equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — expect equal.

- [ ] **Step 5: Commit**

```bash
git add server.js views/partials/order-queue.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Add weekly funnel readout to the owner queue

One line — started, completed, abandoned, and the fraction of
game-page visits that started an order — computed from the orders
collection and the existing visitor tracker. This is the number the
conversion plan's decision rule (>=4% keep, 1-4% iterate, guardrail on
Messenger volume + total rentals to revert) is actually measured
against; monthly revenue alone can't distinguish the effect from the
21-36 renter natural swing already seen across 2026.
EOF
)"
```

---

### Task 5: Deploy and verify live

**Files:** none (deploy + verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-4.

- [ ] **Step 1: Push to trigger the Railway deploy**

```bash
git push origin main
```

- [ ] **Step 2: Wait for the deploy**

Run: `until curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/ | grep -q 200; do sleep 5; done; echo done`

- [ ] **Step 3: Verify the new CTA on a live game page**

Using the Browser tool, open a live game page (any slug from `curl -s https://playstation-hub.com/feed/meta-catalog.csv`). Confirm:
- Before picking a type/duration: the primary button reads "Pick an account type" and is visibly disabled.
- After picking Trophy + Weekly (or any combination): the button reads "🎮 Rent now — ₱<exact total shown in the order summary above it>", and the subtext "Pay via GCash or Maya · no account needed" appears.
- "or message us on Facebook instead" appears beneath the button as a plain text link, and clicking it opens Messenger exactly as the old primary button did.
- Resize to mobile width: the sticky bar reads "Rent now — ₱<total>"; tapping it before the name field is filled scrolls to and focuses the name input rather than submitting.

- [ ] **Step 4: Verify the order_error banner**

Navigate directly to `https://playstation-hub.com/game/<any-slug>?order_error=1`. Confirm the red "⚠️ Please pick an account type and duration..." banner renders near the booking panel — this was previously silent.

- [ ] **Step 5: Verify the customer-record write**

Place a real test order through the flow (name, type, duration, submit — reaches `/order/PH-NNNN?k=...`). In `/admin` (password from project context), open the Orders tab, submit "I already sent it on Messenger", advance it through to `active` using the queue's action buttons. Then:
- Reload `/admin?tab=customers`, expand "All Customers", and confirm a new row exists with `notes` reading `Web order PH-NNNN`, the correct game/type/duration/price (rent only, no deposit), and matching start/end dates.
- Confirm the game's available slot count decremented by one.
- Click "Signed them in" (or the equivalent advance action) a second time if the UI allows re-submission, or re-POST to the same advance route directly, and confirm no second customer record was created (idempotency).

- [ ] **Step 6: Verify the abandoned-orders panel and funnel readout**

Place a second test order and stop after creation (do not submit payment proof). Reload `/admin?tab=orders`. Confirm:
- The new order appears under "⚠ Started but didn't pay" with its Facebook name, game, type, duration, amount, and an age like "1m ago".
- The top-of-tab funnel line shows a started count that includes both test orders and a completed count that includes the first (now active) order.

- [ ] **Step 7: Clean up test orders and customer records**

Using the existing `/admin/orders/:ref/delete` route, delete both test orders created during verification. If Step 5 created a customer record, remove it via the existing Edit/Delete controls in the Customers tab so verification data doesn't pollute the real revenue ledger.

- [ ] **Step 8: Confirm nothing existing broke**

Load `/`, `/browse`, and a game page with `mode=buy` (the Buy Permanent panel, untouched by this plan). Confirm the Buy flow's CTA and sticky bar still work exactly as before — this plan touches only the Rent panel's CTA elements, but `syncStickyBar()` and `handleStickyBarClick()` are shared between both modes, so the Buy path is the one most likely to regress silently.

- [ ] **Step 9: Report results to the user**

Summarize what was verified in Steps 3-8, with a screenshot of the new game-page CTA (both disabled and ready states) and the admin funnel readout, and flag anything that didn't match expectations before considering this plan complete.
