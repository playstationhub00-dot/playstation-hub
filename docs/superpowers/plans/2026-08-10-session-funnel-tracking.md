# Session-Based Visitor Tracking + Funnel View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace IP-based visitor identity (unreliable under carrier-grade NAT) with a first-party session cookie, stamp that identity onto orders at creation, and add a funnel + top-exit-pages view to the admin Visitors tab that derives its stages from existing data rather than tracking a new field per visit.

**Architecture:** A single new cookie (`ph_sid`), issued by the existing visitor-tracking middleware using Express's built-in `res.cookie()` (no new dependency — reading it back uses a small hand-written parser, since `req.cookies` requires `cookie-parser`, which this project doesn't have and doesn't need for one value). The cookie value is written onto every `visitors` row and, once read at order-creation time, onto the order document. The funnel and exit-pages view are pure read-time queries against `visitors` and `orders` — no new collection, no new field written per page view beyond the session id itself.

**Tech Stack:** Express.js + EJS server-rendered views, vanilla JS (no framework, no bundler), lowdb for `visitors`, MongoDB for `orders` (via `lib/orders.js`). Node's built-in `crypto` module for the session id (already used the same way in `lib/orders.js` for `url_key`). No test framework in this project; verification is `node -c server.js`, EJS/CSS balance greps, and live smoke-testing on Railway — the established convention.

## Global Constraints

- No new npm dependency. `res.cookie()` writes without `cookie-parser`; reading `req.headers.cookie` is done with a small hand-written parser (spec: "no new dependency").
- The cookie is `httpOnly`, `sameSite: 'lax'`, and refreshed (re-issued with a new expiry) on every request that already carries one — so 30 days counts from the *last* visit, not the first (spec: "refreshed on every visit").
- `visitors[].ip` is stored as `sha256(realIp)`, never the raw address (spec: "IP is hashed, not stored raw"). The rate limiter's `clientIp()` is unaffected — it keeps using the raw address in-memory only, never persisted, so it needs no change.
- Funnel stages are **derived at read time**, not written as a stored field. No task in this plan adds a "current stage" column to any collection (spec: "Funnel stages are derived, not separately tracked").
- Only sessions with a `session_id` count in the new funnel/exit-pages view. Rows and orders from before this ships have none and are excluded — never backfilled, never guessed at (spec: "Only sessions from launch forward are counted").
- The "Paid" stage's definition (order state past `awaiting_payment`/`verifying_payment`/`payment_rejected`) must match the existing weekly conversion-rate readout's "completed" definition exactly, character for character in logic — both are answering the same question and must never silently diverge (spec: "same 'completed' definition already used by the weekly funnel readout").
- The existing weekly funnel readout ("N started · N completed · N abandoned · X% of game-page visits") is not modified by this plan. It keeps its own pageview-based denominator (spec: "No change to the existing weekly funnel readout").
- The existing top-line "unique visitors" KPI cards (Today/7-day/30-day/All-time) keep their current IP-based `Set` dedup logic completely unchanged — hashing `v.ip` doesn't change what gets deduplicated (a hash is a deterministic 1:1 function of the same input), only what the stored value looks like. This plan does not redefine what those specific cards mean; the new funnel view is the corrected measurement, added alongside them, not a replacement.
- `node -c server.js` must exit 0 after every server.js change.
- EJS tag-balance (`<%` count == `%>` count) must be verified for every `.ejs` file touched.
- CSS brace-balance must be verified for `public/css/style.css` before committing, for any task that touches it.
- No local dev server exists — live verification happens against https://playstation-hub.com after `git push` (Railway auto-deploys, ~60-90s).

---

### Task 1: Session cookie + hashed IP storage

**Files:**
- Modify: `server.js:314-329` (visitor-tracking middleware), plus a new helper function near the existing `clientIp()` at `server.js:54-60`
- Modify: `views/admin.ejs:2947` and `views/admin.ejs:3048` (Recent Visits table's IP column — displaying a 64-character hash truncated to 15 characters, sized for a dotted-quad address, would show a meaningless fragment; this task fixes that display alongside the change that causes it)

**Interfaces:**
- Produces: `sessionId(req, res)` — a new function in server.js. Reads the `ph_sid` cookie if present (re-issuing it with a fresh 30-day expiry so it never expires on an active visitor), or generates and sets a new one. Returns the session id string. Used by this task's own middleware and by Task 2's `/order/create` route.
- Produces: `visitors[]` rows gain a `session_id` field (string) and their `ip` field changes from a raw address to `sha256(rawIp)` (hex string). Consumed by Task 3.

- [ ] **Step 1: Add the cookie-reading helper and session-id function**

In `server.js`, immediately after the existing `clientIp()` function (currently lines 54-56):

```js
// req.cookies requires the cookie-parser middleware, which this project does
// not have — reading one cookie by hand is a few lines and doesn't justify
// adding a dependency. Express's own res.cookie() handles writing without it.
function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

const SESSION_COOKIE = 'ph_sid';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, rolling

// Identifies a browsing session across page visits, independent of IP —
// carrier-grade NAT means many unrelated mobile users in the Philippines
// legitimately share one public IP, so IP was never going to be a valid
// visitor identity even once correctly captured (see clientIp() above).
// Re-issues the cookie with a fresh expiry on every call so 30 days counts
// from the visitor's LAST visit, not their first.
function sessionId(req, res) {
  let sid = getCookie(req, SESSION_COOKIE);
  if (!sid) sid = require('crypto').randomBytes(16).toString('hex');
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS
  });
  return sid;
}
```

- [ ] **Step 2: Wire the session id and hashed IP into the tracking middleware**

In `server.js`, the visitor-tracking middleware (currently lines 316-324) reads:

```js
app.use((req, res, next) => {
  const reqPath = req.path;
  // Only track public pages, not admin/assets/uploads
  if (reqPath.startsWith('/admin') || reqPath.startsWith('/uploads') || reqPath.startsWith('/css') || reqPath.startsWith('/js') || reqPath.includes('.')) return next();
  const pageLabel = PAGE_LABELS[reqPath] || reqPath;
  const ip = clientIp(req);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  db.get('visitors').push({ date: today, time: now, path: reqPath, page: pageLabel, ip }).write();
```

Replace the `const ip = clientIp(req);` line and the `db.get('visitors').push(...)` call with:

```js
  const ip = require('crypto').createHash('sha256').update(clientIp(req)).digest('hex');
  const sid = sessionId(req, res);
  // Later route handlers in this same request (e.g. POST /order/create in
  // Task 2) read this instead of calling sessionId() a second time, so
  // there's exactly one place per request that decides "who is this."
  req.sessionId = sid;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  db.get('visitors').push({ date: today, time: now, path: reqPath, page: pageLabel, ip, session_id: sid }).write();
```

- [ ] **Step 3: Fix the Recent Visits table's IP column display**

The stored value is now a 64-character hash, not a dotted-quad address — `v.ip.slice(0,15)` (sized for the old format) now shows a meaningless truncated fragment. Since `session_id` is the new, meaningful per-visitor identity, both render sites switch the column to show it instead.

In `views/admin.ejs:2947`, replace:

```ejs
            <td style="color:#555;font-size:0.75rem;font-family:monospace;"><%= v.ip ? v.ip.replace(/^::ffff:/, '').slice(0,15) : '—' %></td>
```

with:

```ejs
            <td style="color:#555;font-size:0.75rem;font-family:monospace;"><%= v.session_id ? v.session_id.slice(0,12) : '—' %></td>
```

In `views/admin.ejs:3048` (the client-side template-literal version fed by `/admin/api/visitors-by-date`, which returns raw `visitors` records and needs no server-side change since it already reflects whatever's in the collection), replace:

```js
            <td style="color:#555;font-size:0.75rem;font-family:monospace;">${v.ip ? v.ip.replace(/^::ffff:/, '').slice(0,15) : '—'}</td>
```

with:

```js
            <td style="color:#555;font-size:0.75rem;font-family:monospace;">${v.session_id ? v.session_id.slice(0,12) : '—'}</td>
```

Also update both table headers from `<th>IP</th>` (currently `views/admin.ejs:2938` and its counterpart in the same table's `<thead>`) to `<th>Session</th>` — there is only one `<thead>` per table (the client-side version reuses the same header), so this is one edit per table, not one per render site.

- [ ] **Step 4: Verify syntax and balance**

Run: `node -c server.js` — expect exit 0.
Run: `grep -o '<%' views/admin.ejs | wc -l` and `grep -o '%>' views/admin.ejs | wc -l` — expect equal.

- [ ] **Step 5: Commit**

```bash
git add server.js views/admin.ejs
git commit -m "$(cat <<'EOF'
Add session cookie identity, hash stored visitor IPs

IP was never a valid visitor identity in the Philippines even once
correctly captured (fixed separately in 634cd66) — Globe and Smart
both use carrier-grade NAT, so many unrelated mobile users legitimately
share one public IP. ph_sid is a first-party cookie, generated with
Node's built-in crypto (no new dependency — req.cookies needs
cookie-parser, which this project doesn't have; reading one cookie by
hand is a few lines), refreshed on every visit so 30 days counts from
the last visit rather than the first.

visitors[].ip moves from the raw address to sha256(ip) — still useful
for grouping, no longer a plaintext address sitting in a lowdb file
behind one shared admin password. The Recent Visits table's IP column
becomes a Session column, since a 64-character hash truncated to 15
characters (sized for a dotted-quad address) was about to become a
meaningless fragment, and session_id is the more useful identity now
anyway.
EOF
)"
```

---

### Task 2: Stamp `session_id` onto orders at creation

**Files:**
- Modify: `server.js` (the `POST /order/create` route, currently lines 1105-1157)
- Modify: `lib/orders.js` (no field-shape change needed — `orders.create(fields)` already spreads whatever fields it's given via `Object.assign`, so `session_id` passes through automatically; this task only needs to confirm that and pass the value in)

**Interfaces:**
- Consumes: `sessionId(req, res)` from Task 1.
- Produces: `order.session_id` (string), read by Task 3's funnel query to link an order back to the browsing session that created it.

- [ ] **Step 1: Confirm `orders.create()` needs no change**

Read `lib/orders.js`'s `create(fields)` function (currently lines 71-98). It builds its base object via `Object.assign({ ref: ..., url_key: ..., state: ..., ... }, fields)` — any key present in the `fields` argument that isn't already in the base object passes through untouched. `session_id` will be such a key. No edit to `lib/orders.js` is needed for this task; this step is verification, not implementation.

- [ ] **Step 2: Pass the session id into the order**

In `server.js`, inside `POST /order/create` (currently lines 1105-1157), the call to `orders.create({...})` currently reads:

```js
    const order = await orders.create({
      game_id: game.id,
      game_title: game.title,
      account_type: type,
      days: d,
      price_tier_name: cat ? cat.name : '',
      price_snapshot: snapshot,
      amount_due: amountDue,
      deposit_due: depositDue,
      fb_name: name
    });
```

Add `session_id: req.sessionId || null,` as a new key inside that object (any position is fine; grouping it near `fb_name` keeps the "who is this" fields together). `req.sessionId` was set once, earlier in the request chain, by the visitor-tracking middleware's `req.sessionId = sid;` line from Task 1 Step 2 — this route reads that value rather than calling `sessionId(req, res)` again, so there's exactly one place per request that decides the session id:

```js
    const order = await orders.create({
      game_id: game.id,
      game_title: game.title,
      account_type: type,
      days: d,
      price_tier_name: cat ? cat.name : '',
      price_snapshot: snapshot,
      amount_due: amountDue,
      deposit_due: depositDue,
      fb_name: name,
      session_id: req.sessionId || null
    });
```

The `|| null` guards the case where the visitor-tracking middleware's path-exclusion (`reqPath.startsWith('/admin')`, etc.) ever changes and stops running for this route — `/order/create` isn't excluded today, but the fallback keeps this line from throwing if that ever changes, and produces a clean `null` (excluded from the funnel, per the "only sessions with a session_id count" rule) rather than a crash.

- [ ] **Step 3: Verify syntax**

Run: `node -c server.js` — expect exit 0.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "$(cat <<'EOF'
Stamp session_id onto orders at creation

Links an order back to the browsing session that produced it, the
same way fb_name and url_key are already set at creation. Reads
req.sessionId, set once by the visitor-tracking middleware earlier in
the request chain, rather than calling sessionId() a second time in
this route — avoids any ambiguity about whether a second call could
observe a different cookie state than the first.

orders.create() needed no change: it already spreads its fields
argument over its base object, so any new key passed in is stored
as-is.
EOF
)"
```

---

### Task 3: Funnel + top exit pages view

**Files:**
- Modify: `server.js` (the `/admin` route, to compute funnel and exit-page data and pass it to the render — same insertion point pattern used for `abandonedOrders`/`startedCount` etc. in the earlier conversion-rate work)
- Modify: `views/admin.ejs` (new subsection inside the existing Visitors tab, after the KPI cards)
- Modify: `public/css/style.css` (styles for the new subsection)

**Interfaces:**
- Consumes: `db.get('visitors').value()` (existing, already read into the `visitors` local passed to every `/admin` render), `orders.listByStates(orders.STATES.concat(orders.TERMINAL))` or equivalent all-states query (existing pattern from the weekly funnel readout task in the conversion-rate plan) to get every order regardless of current state.
- Produces: nothing consumed by a later task — this is the final feature task.

- [ ] **Step 1: Compute funnel and exit-page data in the `/admin` route**

In `server.js`, find where the existing weekly funnel readout's variables (`startedCount`, `completedCount`, etc.) are computed, immediately before `res.render('admin', {...})`. Immediately after that block, insert:

```js
  // Session funnel: derived entirely from visitors[] and orders — no stage is
  // ever written as a field. Only sessions with a session_id count, which
  // means only sessions from 2026-08-10 onward (when this shipped); older
  // rows have none and are correctly excluded, not backfilled.
  const sessionedVisits = visitors.filter(v => v.session_id);
  const sessionIds = [...new Set(sessionedVisits.map(v => v.session_id))];

  const sessionsByPath = {};
  sessionedVisits.forEach(v => {
    (sessionsByPath[v.session_id] = sessionsByPath[v.session_id] || []).push(v);
  });

  const landedCount = sessionIds.length;
  const browsedCount = sessionIds.filter(sid =>
    sessionsByPath[sid].some(v => v.path === '/browse')
  ).length;
  const viewedGameCount = sessionIds.filter(sid =>
    sessionsByPath[sid].some(v => v.path.startsWith('/game/'))
  ).length;

  const allOrders = await orders.listByStates(orders.STATES.concat(orders.TERMINAL));
  const sessionedOrders = allOrders.filter(o => o.session_id);
  const orderedSessionIds = new Set(sessionedOrders.map(o => o.session_id));
  const startedOrderSessionCount = sessionIds.filter(sid => orderedSessionIds.has(sid)).length;

  // Matches the weekly funnel readout's "completed" definition exactly —
  // both answer the same question (did payment get verified) and must not
  // silently diverge.
  const PAID_EXCLUDED_STATES = ['awaiting_payment', 'verifying_payment', 'payment_rejected'];
  const paidSessionIds = new Set(
    sessionedOrders.filter(o => !PAID_EXCLUDED_STATES.includes(o.state)).map(o => o.session_id)
  );
  const paidSessionCount = sessionIds.filter(sid => paidSessionIds.has(sid)).length;

  const sessionFunnel = [
    { label: 'Landed', count: landedCount, pctOfPrev: null },
    { label: 'Browsed', count: browsedCount, pctOfPrev: landedCount > 0 ? Math.round((browsedCount / landedCount) * 100) : null },
    { label: 'Viewed a game', count: viewedGameCount, pctOfPrev: browsedCount > 0 ? Math.round((viewedGameCount / browsedCount) * 100) : null },
    { label: 'Started order', count: startedOrderSessionCount, pctOfPrev: viewedGameCount > 0 ? Math.round((startedOrderSessionCount / viewedGameCount) * 100) : null },
    { label: 'Paid', count: paidSessionCount, pctOfPrev: startedOrderSessionCount > 0 ? Math.round((paidSessionCount / startedOrderSessionCount) * 100) : null }
  ];

  // Top exit pages: the last-recorded path per session stands in for "the
  // last thing this person looked at" — there is no way to detect a tab
  // close directly, so this is the closest available proxy, not a precise
  // measurement.
  const exitPageCounts = {};
  sessionIds.forEach(sid => {
    const rows = sessionsByPath[sid];
    const last = rows[rows.length - 1];
    if (last) exitPageCounts[last.path] = (exitPageCounts[last.path] || 0) + 1;
  });
  const topExitPages = Object.entries(exitPageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([path, count]) => ({ path, count }));
```

Add `sessionFunnel,` and `topExitPages,` as new keys to the `res.render('admin', { ... })` object.

**Note on ordering within `visitors[]`:** `sessionsByPath[sid]` is built by iterating `visitors` in storage order, which is append-order (each new visit is `.push()`-ed), so `rows[rows.length - 1]` is genuinely the most recent row for that session — no explicit sort is needed here.

- [ ] **Step 2: Render the funnel and exit-pages subsection**

In `views/admin.ejs`, inside the Visitors tab (`#tab-visitors`, currently starting at line 2807), find the closing of the KPI cards block (the four `.stat-card` divs, currently ending around line 2880 — search for the `All-Time Visits` stat card and find the `</div>` that closes its containing grid). Immediately after that closing `</div>`, insert:

```ejs
    <!-- Session Funnel + Exit Pages -->
    <div class="vf-section">
      <div class="vf-grid">
        <div class="vf-panel">
          <div class="vf-panel-label">Funnel — sessions since launch</div>
          <% sessionFunnel.forEach((stage, i) => {
            const widthPct = sessionFunnel[0].count > 0 ? Math.max(2, Math.round((stage.count / sessionFunnel[0].count) * 100)) : 0;
          %>
          <div class="vf-row">
            <span class="vf-name"><%= stage.label %></span>
            <div class="vf-bar-track"><div class="vf-bar-fill" style="width:<%= widthPct %>%"></div></div>
            <span class="vf-n">
              <strong><%= stage.count %></strong>
              <% if (stage.pctOfPrev !== null) { %> <span class="vf-pct"><%= stage.pctOfPrev %>%</span><% } %>
            </span>
          </div>
          <% }) %>
          <% if (sessionFunnel[0].count === 0) { %>
          <div class="vf-empty">No tracked sessions yet — this fills in as visitors browse after 2026-08-10.</div>
          <% } %>
        </div>
        <div class="vf-panel">
          <div class="vf-panel-label">Top exit pages</div>
          <% if (!topExitPages.length) { %>
          <div class="vf-empty">Nothing to show yet.</div>
          <% } else { %>
          <% topExitPages.forEach(ep => { %>
          <div class="vf-exit-row">
            <span class="vf-exit-path"><%= ep.path %></span>
            <span class="vf-exit-n"><strong><%= ep.count %></strong> session<%= ep.count !== 1 ? 's' : '' %></span>
          </div>
          <% }) %>
          <% } %>
        </div>
      </div>
    </div>
```

- [ ] **Step 3: Add the styles**

In `public/css/style.css`, append at the end of the file:

```css
.vf-section { margin: 0 0 2rem; }
.vf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
@media (max-width: 820px) { .vf-grid { grid-template-columns: 1fr; } }
.vf-panel { background: #0d0d0d; border: 1px solid #222; border-radius: 12px; padding: 1.1rem 1.25rem; }
.vf-panel-label { font-size: 0.7rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #666; margin-bottom: 0.9rem; }
.vf-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.55rem; }
.vf-name { width: 100px; flex-shrink: 0; font-size: 0.8rem; color: #ccc; }
.vf-bar-track { flex: 1; height: 18px; background: #161616; border-radius: 5px; overflow: hidden; }
.vf-bar-fill { height: 100%; background: linear-gradient(90deg, var(--ps-blue), #3d9dee); border-radius: 5px; }
.vf-n { width: 90px; flex-shrink: 0; text-align: right; font-size: 0.78rem; color: #888; font-variant-numeric: tabular-nums; }
.vf-n strong { color: #ddd; font-weight: 700; }
.vf-pct { color: #f59e0b; font-weight: 700; }
.vf-empty { color: #555; font-size: 0.85rem; padding: 1rem 0; text-align: center; }
.vf-exit-row { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #1a1a1a; font-size: 0.82rem; }
.vf-exit-row:last-child { border-bottom: 0; }
.vf-exit-path { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; color: #ccc; word-break: break-all; }
.vf-exit-n { color: #888; white-space: nowrap; flex-shrink: 0; margin-left: 0.75rem; }
.vf-exit-n strong { color: #f59e0b; font-weight: 700; }
```

- [ ] **Step 4: Verify syntax and balance**

Run: `node -c server.js` — expect exit 0.
Run: `grep -o '<%' views/admin.ejs | wc -l` and `grep -o '%>' views/admin.ejs | wc -l` — expect equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — expect equal.

- [ ] **Step 5: Commit**

```bash
git add server.js views/admin.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Add session funnel and top-exit-pages view to the Visitors tab

Both derived entirely at read time from visitors[] and orders — no
stage is written as a field when a page is visited. Only sessions
with a session_id count (2026-08-10 onward); older rows have none and
are excluded, not backfilled or guessed at.

"Paid" uses the exact same excluded-states definition the weekly
funnel readout already established, so the two views can't silently
disagree about what "completed" means.

Top exit pages uses each session's most recent row as a proxy for
"where they left" — there's no tab-close event to hook into, so this
is the closest available signal, not a precise measurement.
EOF
)"
```

---

### Task 4: Deploy and verify live

**Files:** none (deploy + verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-3.

- [ ] **Step 1: Push to trigger the Railway deploy**

```bash
git push origin main
```

- [ ] **Step 2: Wait for the deploy**

Run: `until curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/ | grep -q 200; do sleep 5; done; echo done`

- [ ] **Step 3: Verify the cookie is issued and persists**

Using the Browser tool, open `https://playstation-hub.com/` in a fresh tab (no existing cookies). Confirm via the browser's dev tools or `document.cookie` that a `ph_sid` cookie now exists, `httpOnly` (won't appear in `document.cookie` — confirm instead via the response headers on the first request, or via a follow-up request reusing the same session showing the *same* value rather than a new one each time). Navigate to a second page in the same tab and confirm the visitor log (see Step 4) shows both hits under the identical `session_id`.

- [ ] **Step 4: Verify visitor rows carry session_id and hashed ip**

In `/admin?tab=visitors` (password from project context), check the Recent Visits table: the column previously labeled "IP" now reads "Session" and shows a short hex fragment, not a dotted-quad address or an obviously-still-an-IP-looking value.

- [ ] **Step 5: Verify an order carries session_id**

Place a real test order through the site (game page → pick type/duration → fill name → submit). In the admin Orders tab, this order should now (per the plan this session's work builds on) still function identically to before — this step is about confirming `session_id` was stamped, not about re-testing the order flow itself. Confirm by checking that the funnel's "Started order" count (Step 6) increments by exactly one after placing this test order, using the same session that browsed to the game page.

- [ ] **Step 6: Verify the funnel and exit-pages view**

Reload `/admin?tab=visitors`. Confirm the new "Funnel — sessions since launch" and "Top exit pages" panels render below the KPI cards, with real counts reflecting the test session from Steps 3-5 (at minimum: Landed ≥ 1, Browsed and/or Viewed a game depending on which pages that session hit, Started order = 1 if the test order in Step 5 was placed in the same session).

- [ ] **Step 7: Confirm the existing weekly funnel readout is unaffected**

In `/admin?tab=orders`, confirm the existing "Last 7 days: N started · N completed · N abandoned · X% of game-page visits" line still renders with its own numbers, unchanged by this plan — this plan adds a second, session-scoped view elsewhere in admin; it does not touch that one.

- [ ] **Step 8: Confirm nothing existing broke**

Load `/`, `/browse`, a game page, and place-then-delete one more test order (using the existing `/admin/orders/:ref/delete` route) to confirm the full order flow — CTA, payment, admin queue — still works end to end after these changes, matching the earlier conversion-rate plan's own verification pattern.

- [ ] **Step 9: Clean up test data**

Delete any test orders created during verification via the existing admin delete route. Test `visitors` rows are harmless and small in number; leave them — they don't misrepresent anything now that the underlying identity is correct.

- [ ] **Step 10: Report results to the user**

Summarize what was verified in Steps 3-9, with a screenshot of the live funnel + exit-pages panel showing real session data, and flag anything that didn't match expectations before considering this plan complete.
