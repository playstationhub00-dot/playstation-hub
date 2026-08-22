# Game Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers request games the catalogue doesn't carry, vote on existing requests, and see the ranking — giving the owner a demand-ordered list and a named waiting list to message when a game is stocked.

**Architecture:** A new `lib/requests.js` owns a MongoDB `game_requests` collection, mirroring the `init(getDbFn)` / `_col()` pattern `lib/orders.js` already uses. Routes in `server.js` expose a public board and admin moderation. A new `views/requests.ejs` renders the board; the matching that prevents duplicate entries runs client-side against the existing `/api/search-index` and is re-checked server-side.

**Tech Stack:** Node/Express, MongoDB (via the existing connection), EJS. No new dependencies.

## Global Constraints

- One document per **title**, never per vote. Vote count is `voters.length`.
- Storage is MongoDB, not the lowdb blob. `lib/orders.js` documents the reason: customer-written data cannot tolerate the blob's last-write-wins behaviour.
- Public board shows **first names only** — the first whitespace-separated token of `fb_name`. Full names appear only in admin.
- Voting on an `approved` title is instant. Creating a **new** title saves as `pending` and is invisible publicly until approved.
- Vote dedup: reject if the same `session_id` is already in `voters`, or the same `fb_name` case-insensitively.
- Rate limit every public write with the existing `rateLimited(bucketKey, ip, max, windowMs)` (`server.js:43`), matching how `/order/create` uses it.
- A title already in the catalogue must never become a request — checked client-side for UX and server-side as the real guard.
- `stocked` entries stay on the public board as "Now available", never deleted automatically.
- Sending notifications to voters is **out of scope**; the list is captured and shown in admin only.

---

### Task 1: The data layer

**Files:**
- Create: `lib/requests.js`

**Interfaces:**
- Consumes: nothing. `init(getDbFn)` is called by Task 2.
- Produces: the module below. Task 2's routes call exactly these names.

- [ ] **Step 1: Create `lib/requests.js`**

```js
// Customer-submitted game requests. Like orders, these are written by customers
// rather than by the admin, so they live as individual MongoDB documents instead
// of inside the lowdb blob that server.js rewrites wholesale — two people
// requesting at the same moment must not lose one another's write.
//
// One document per TITLE, never per vote: the vote count is voters.length, and
// keeping the voters themselves is what turns the ranking into a waiting list
// the owner can message once a game is stocked.

const STATUSES = Object.freeze(['pending', 'approved', 'stocked', 'rejected']);
// What the public board renders. 'pending' is deliberately absent — a brand-new
// title is invisible until the owner approves it, which is what keeps
// customer-typed text off the storefront.
const PUBLIC_STATUSES = Object.freeze(['approved', 'stocked']);

let _getDb = null;

function init(getDbFn) { _getDb = getDbFn; }

async function _col() {
  if (!_getDb) throw new Error('lib/requests: init(getDb) was never called');
  const db = await _getDb();
  return db ? db.collection('game_requests') : null;
}

// Same normalisation as server.js's gameSlug(), duplicated so this module stays
// usable without importing from server.js (which would be a circular import).
function slugify(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// First whitespace-separated token only. The public board never shows a full name.
function firstName(fbName) {
  return String(fbName || '').trim().split(/\s+/)[0] || 'Someone';
}

function _hasVoted(doc, { fb_name, session_id }) {
  const nameLower = String(fb_name || '').trim().toLowerCase();
  return (doc.voters || []).some(v =>
    (session_id && v.session_id && v.session_id === session_id) ||
    (nameLower && String(v.fb_name || '').trim().toLowerCase() === nameLower)
  );
}

async function getBySlug(slug) {
  const col = await _col();
  if (!col) return null;
  return col.findOne({ slug });
}

async function listByStatus(statuses) {
  const col = await _col();
  if (!col) return [];
  return col.find({ status: { $in: statuses } }).toArray();
}

// Everything the public board shows, ranked by vote count descending.
async function listPublic() {
  const rows = await listByStatus(PUBLIC_STATUSES);
  return rows.sort((a, b) => (b.voters || []).length - (a.voters || []).length);
}

// Everything the admin sees: pending first (they need action), then the rest by votes.
async function listForAdmin() {
  const col = await _col();
  if (!col) return [];
  const rows = await col.find({}).toArray();
  return rows.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (b.status === 'pending' && a.status !== 'pending') return 1;
    return (b.voters || []).length - (a.voters || []).length;
  });
}

// Creates a new pending request with its first vote already recorded.
// Returns { ok: false, reason: 'exists' } if the slug is taken, so the caller can
// redirect the customer to vote on the existing entry instead of duplicating it.
async function createRequest({ title, fb_name, session_id }) {
  const col = await _col();
  if (!col) return { ok: false, reason: 'no_db' };
  const clean = String(title || '').trim();
  if (!clean) return { ok: false, reason: 'empty' };
  const slug = slugify(clean);
  if (!slug) return { ok: false, reason: 'empty' };

  const existing = await col.findOne({ slug });
  if (existing) return { ok: false, reason: 'exists', slug };

  const now = new Date().toISOString();
  const doc = {
    slug,
    title: clean,
    status: 'pending',
    voters: [{ fb_name: String(fb_name || '').trim(), session_id: session_id || null, at: now }],
    game_id: null,
    created_at: now,
    updated_at: now
  };
  try {
    await col.insertOne(doc);
  } catch (e) {
    // Unique index race: someone created the same slug between the findOne and
    // here. Treat it as an existing entry rather than an error.
    if (e && e.code === 11000) return { ok: false, reason: 'exists', slug };
    throw e;
  }
  return { ok: true, doc };
}

// Adds a vote to an existing request. Only 'approved' and 'pending' accept votes —
// a stocked game no longer needs them, and a rejected one should not accumulate.
async function addVote(slug, { fb_name, session_id }) {
  const col = await _col();
  if (!col) return { ok: false, reason: 'no_db' };
  const doc = await col.findOne({ slug });
  if (!doc) return { ok: false, reason: 'not_found' };
  if (!['approved', 'pending'].includes(doc.status)) return { ok: false, reason: 'closed' };
  if (_hasVoted(doc, { fb_name, session_id })) return { ok: false, reason: 'duplicate' };

  const now = new Date().toISOString();
  await col.updateOne(
    { slug },
    {
      $push: { voters: { fb_name: String(fb_name || '').trim(), session_id: session_id || null, at: now } },
      $set: { updated_at: now }
    }
  );
  return { ok: true, count: (doc.voters || []).length + 1 };
}

async function setStatus(slug, status, patch) {
  const col = await _col();
  if (!col) return false;
  if (!STATUSES.includes(status)) return false;
  const r = await col.updateOne(
    { slug },
    { $set: Object.assign({}, patch || {}, { status, updated_at: new Date().toISOString() }) }
  );
  return r.matchedCount > 0;
}

async function remove(slug) {
  const col = await _col();
  if (!col) return false;
  const r = await col.deleteOne({ slug });
  return r.deletedCount > 0;
}

// Called once at startup. Without the unique index two simultaneous createRequest
// calls could both pass the findOne check and insert the same slug twice.
async function ensureIndexes() {
  const col = await _col();
  if (!col) return;
  await col.createIndex({ slug: 1 }, { unique: true });
}

module.exports = {
  STATUSES, PUBLIC_STATUSES,
  init, slugify, firstName, ensureIndexes,
  getBySlug, listByStatus, listPublic, listForAdmin,
  createRequest, addVote, setStatus, remove
};
```

- [ ] **Step 2: Verify the module loads and its pure helpers behave**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -e "
const r = require('./lib/requests.js');
const cases = [
  ['slugify', r.slugify('Grand Theft Auto VI'), 'grand-theft-auto-vi'],
  ['slugify punctuation', r.slugify('Marvel\'s Spider-Man 2'), 'marvel-s-spider-man-2'],
  ['slugify case', r.slugify('ELDEN RING'), 'elden-ring'],
  ['firstName', r.firstName('Juan Dela Cruz'), 'Juan'],
  ['firstName single', r.firstName('Marc'), 'Marc'],
  ['firstName empty', r.firstName(''), 'Someone']
];
let fail = false;
cases.forEach(([label, got, want]) => {
  const ok = got === want;
  if (!ok) fail = true;
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + label + ' -> ' + JSON.stringify(got) + (ok ? '' : ' (want ' + JSON.stringify(want) + ')'));
});
if (typeof r.init !== 'function' || typeof r.createRequest !== 'function') { console.error('FAIL: exports missing'); fail = true; }
process.exit(fail ? 1 : 0);
"
```

Expected: six `PASS` lines, exit 0. Note `marvel-s-spider-man-2` — the apostrophe becomes a separator, which is correct and matches `server.js`'s `gameSlug()` exactly, so a request slug and a catalogue slug for the same title always agree.

- [ ] **Step 3: Verify dedup logic without a database**

`_hasVoted` is internal, so exercise it through the shape it guards:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -e "
// Re-implement the guard's contract to confirm the intended semantics are what
// the module documents: same session OR same name (case-insensitive) blocks.
const voters = [{ fb_name: 'Juan Dela Cruz', session_id: 'abc' }];
const has = (v, fb, sid) => v.some(x =>
  (sid && x.session_id && x.session_id === sid) ||
  (String(fb||'').trim().toLowerCase() && String(x.fb_name||'').trim().toLowerCase() === String(fb||'').trim().toLowerCase()));
const cases = [
  ['same session, different name', has(voters, 'Other Person', 'abc'), true],
  ['different session, same name', has(voters, 'juan dela cruz', 'zzz'), true],
  ['different session and name', has(voters, 'Maria Santos', 'zzz'), false]
];
let fail = false;
cases.forEach(([l, got, want]) => { const ok = got === want; if (!ok) fail = true; console.log((ok?'PASS':'FAIL')+': '+l); });
process.exit(fail?1:0);
"
```

Expected: three `PASS` lines.

- [ ] **Step 4: Commit**

```bash
git add lib/requests.js
git commit -m "Add game requests data layer"
```

---

### Task 2: Routes and wiring

**Files:**
- Modify: `server.js` — require the module at the top beside the other requires, `init` + `ensureIndexes` beside `orders.init(_getMongoDb)` (`server.js:521`), and the five routes

**Interfaces:**
- Consumes: `lib/requests.js` from Task 1 — `init`, `ensureIndexes`, `slugify`, `listPublic`, `listForAdmin`, `getBySlug`, `createRequest`, `addVote`, `setStatus`, `remove`.
- Produces: `GET /requests` (renders `requests` view with `{ requests, settings, announcement, announcements, msg }`), `POST /requests/add`, `POST /requests/:slug/vote`, and admin routes `POST /admin/requests/:slug/approve|reject|stock|delete`. Task 3's view and Task 4's admin section post to exactly these paths.

- [ ] **Step 1: Require the module**

Find where `orders` is required near the top of `server.js`:

```js
const orders = require('./lib/orders');
```

Add immediately after:

```js
const gameRequests = require('./lib/requests');
```

- [ ] **Step 2: Wire init and the unique index**

Find (`server.js:521`):

```js
// Orders persist as their own MongoDB documents, reusing the connection the
// blob sync already maintains rather than opening a second pool.
orders.init(_getMongoDb);
```

Replace with:

```js
// Orders persist as their own MongoDB documents, reusing the connection the
// blob sync already maintains rather than opening a second pool.
orders.init(_getMongoDb);

// Game requests are customer-written too, so they follow orders onto MongoDB
// rather than the blob. The unique slug index is what stops two simultaneous
// requests for the same title creating two rows.
gameRequests.init(_getMongoDb);
gameRequests.ensureIndexes().catch(e => console.error('[requests] ensureIndexes', e.message));
```

- [ ] **Step 3: Add the public routes**

Add these near the other public page routes (anywhere before the admin section is fine; placing them just after the `/how-it-works` route keeps public pages together):

```js
// Public request board. Shows approved and stocked entries ranked by votes;
// pending entries stay hidden until the owner approves them.
app.get('/requests', async (req, res) => {
  const rows = await gameRequests.listPublic();
  res.render('requests', {
    requests: rows,
    firstName: gameRequests.firstName,
    settings: getSiteSettings(),
    announcement: getAnnouncement(),
    announcements: getAnnouncements(),
    msg: req.query.msg || null
  });
});

app.post('/requests/add', async (req, res) => {
  if (rateLimited('request_add', clientIp(req), 5, 10 * 60 * 1000)) {
    return res.redirect('/requests?msg=rate');
  }
  const title = (req.body.title || '').trim();
  const fb_name = (req.body.fb_name || '').trim();
  if (!title || !fb_name) return res.redirect('/requests?msg=missing');

  // Guard: never let a game we already stock become a request. The client checks
  // this too for immediate feedback, but the client can be bypassed.
  const slug = gameRequests.slugify(title);
  const already = getGames().find(g => gameSlug(g.title) === slug);
  if (already) return res.redirect('/game/' + slug);

  const r = await gameRequests.createRequest({ title, fb_name, session_id: req.sessionId || null });
  if (r.ok) return res.redirect('/requests?msg=submitted');
  if (r.reason === 'exists') {
    // Someone already asked for this — add their vote rather than refusing.
    const v = await gameRequests.addVote(r.slug, { fb_name, session_id: req.sessionId || null });
    return res.redirect('/requests?msg=' + (v.ok ? 'voted' : v.reason === 'duplicate' ? 'already' : 'error'));
  }
  return res.redirect('/requests?msg=error');
});

app.post('/requests/:slug/vote', async (req, res) => {
  if (rateLimited('request_vote', clientIp(req), 15, 10 * 60 * 1000)) {
    return res.redirect('/requests?msg=rate');
  }
  const fb_name = (req.body.fb_name || '').trim();
  if (!fb_name) return res.redirect('/requests?msg=missing');
  const v = await gameRequests.addVote(req.params.slug, { fb_name, session_id: req.sessionId || null });
  if (v.ok) return res.redirect('/requests?msg=voted');
  return res.redirect('/requests?msg=' + (v.reason === 'duplicate' ? 'already' : v.reason === 'not_found' ? 'error' : 'closed'));
});
```

- [ ] **Step 4: Add the admin routes**

Add these beside the other `requireAuth` admin routes (immediately after the `POST /admin/orders/:ref/cancel` route keeps the customer-written moderation actions together):

```js
app.post('/admin/requests/:slug/approve', requireAuth, async (req, res) => {
  await gameRequests.setStatus(req.params.slug, 'approved', {});
  res.redirect('/admin?tab=games&msg=request_approved');
});

app.post('/admin/requests/:slug/reject', requireAuth, async (req, res) => {
  await gameRequests.setStatus(req.params.slug, 'rejected', {});
  res.redirect('/admin?tab=games&msg=request_rejected');
});

// Marks a request fulfilled and links it to the catalogue entry, so the board can
// show "Now available" with a working link. game_id is optional: the owner may
// stock a game before its catalogue row exists.
app.post('/admin/requests/:slug/stock', requireAuth, async (req, res) => {
  const gameId = parseInt(req.body.game_id);
  await gameRequests.setStatus(req.params.slug, 'stocked', {
    game_id: Number.isFinite(gameId) ? gameId : null
  });
  res.redirect('/admin?tab=games&msg=request_stocked');
});

app.post('/admin/requests/:slug/delete', requireAuth, async (req, res) => {
  await gameRequests.remove(req.params.slug);
  res.redirect('/admin?tab=games&msg=request_deleted');
});
```

- [ ] **Step 5: Verify syntax and route registration**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -c server.js && echo SERVER_OK
grep -c "app.post('/admin/requests/\|app.post('/requests/\|app.get('/requests'" server.js
```

Expected: `SERVER_OK`, then `7` (one GET, two public POSTs, four admin POSTs).

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "Add game request routes and wiring"
```

---

### Task 3: The public board

**Files:**
- Create: `views/requests.ejs`
- Modify: `views/partials/nav.ejs` — a Requests link in **both** places the nav lists Buy (desktop `nav.ejs:12`, mobile drawer `nav.ejs:45`)
- Modify: `views/buy.ejs:125` — repoint the Messenger "Request a game" link

**Interfaces:**
- Consumes: `GET /requests` render locals from Task 2 — `requests` (array of documents), `firstName` (helper), `settings`, `msg`. Posts to `POST /requests/add` and `POST /requests/:slug/vote`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Create `views/requests.ejs`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Request a Game — <%= settings.title %></title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
</head>
<body>
<%- include('partials/announcement') %>
<%- include('partials/nav', { active: 'requests' }) %>

<div class="req-page">
  <h1 class="req-h1">Request a game</h1>
  <p class="req-sub">Tell us what you want next. The most requested games get stocked first.</p>

  <% if (msg === 'submitted') { %><div class="ord-flash">Thanks — we'll review it and add it to the list.</div><% } %>
  <% if (msg === 'voted') { %><div class="ord-flash">Your vote has been counted.</div><% } %>
  <% if (msg === 'already') { %><div class="ord-flash ord-flash-warn">You've already voted for that one.</div><% } %>
  <% if (msg === 'missing') { %><div class="ord-flash ord-flash-warn">Please fill in both the game title and your Facebook name.</div><% } %>
  <% if (msg === 'rate') { %><div class="ord-flash ord-flash-warn">Too many requests — please wait a few minutes.</div><% } %>
  <% if (msg === 'closed') { %><div class="ord-flash ord-flash-warn">That request is already closed.</div><% } %>
  <% if (msg === 'error') { %><div class="ord-flash ord-flash-warn">Something went wrong. Please try again.</div><% } %>

  <form method="POST" action="/requests/add" class="req-form" id="reqForm">
    <div class="req-field">
      <input type="text" name="title" id="reqTitle" placeholder="Game title" autocomplete="off" required>
      <div class="req-hint" id="reqHint"></div>
    </div>
    <input type="text" name="fb_name" placeholder="Your Facebook name" required>
    <button type="submit" class="btn btn-primary">Request</button>
  </form>

  <div class="req-listhead">
    <span class="req-listtitle">Most requested</span>
    <span class="req-count"><%= requests.length %> game<%= requests.length !== 1 ? 's' : '' %></span>
  </div>

  <% if (!requests.length) { %>
    <div class="req-empty">No requests yet — be the first to ask for a game.</div>
  <% } %>

  <% requests.forEach(r => { const votes = (r.voters || []).length; %>
  <div class="req-row<%= r.status === 'stocked' ? ' req-row-stocked' : '' %>">
    <span class="req-votes<%= r.status === 'stocked' ? ' req-votes-stocked' : '' %>"><%= votes %></span>
    <div class="req-main">
      <div class="req-title"><%= r.title %></div>
      <% if (r.status === 'stocked') { %>
        <div class="req-stocked-note">Now available — you asked, we stocked it</div>
      <% } else { %>
        <div class="req-voters">
          requested by <%= (r.voters || []).slice(0, 3).map(v => firstName(v.fb_name)).join(', ') %><% if (votes > 3) { %> +<%= votes - 3 %><% } %>
        </div>
      <% } %>
    </div>
    <% if (r.status === 'stocked' && r.game_id) { %>
      <a href="/game/<%= r.slug %>" class="req-btn req-btn-rent">Rent</a>
    <% } else if (r.status !== 'stocked') { %>
      <form method="POST" action="/requests/<%= r.slug %>/vote" class="req-voteform">
        <input type="text" name="fb_name" placeholder="Your name" required>
        <button type="submit" class="req-btn">Vote</button>
      </form>
    <% } %>
  </div>
  <% }) %>
</div>

<%- include('partials/footer') %>

<script>
// Immediate feedback while typing: tell the customer if we already stock the game,
// or if someone has already requested it, so they vote instead of creating a
// duplicate. The server re-checks both — this is convenience, not the guard.
(function () {
  var input = document.getElementById('reqTitle');
  var hint = document.getElementById('reqHint');
  if (!input || !hint) return;
  var catalog = null;
  // `<` is escaped to < so a title containing "</script>" cannot break out
  // of this block. Titles are customer-typed, and although only approved ones
  // reach this page, the escape means approving a hostile title can never turn
  // into script injection.
  var requested = <%- JSON.stringify(requests.map(r => ({ slug: r.slug, title: r.title, votes: (r.voters || []).length }))).replace(/</g, '\\u003c') %>;

  function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  fetch('/api/search-index').then(function (r) { return r.json(); })
    .then(function (d) { catalog = d; }).catch(function () { catalog = []; });

  input.addEventListener('input', function () {
    var v = input.value.trim();
    if (v.length < 3) { hint.textContent = ''; hint.className = 'req-hint'; return; }
    var slug = slugify(v);

    var owned = (catalog || []).find(function (g) { return g.y === 'now' && slugify(g.t) === slug; });
    if (owned) {
      hint.innerHTML = 'We already have this — <a href="' + owned.u + '">rent it here</a>.';
      hint.className = 'req-hint req-hint-have';
      return;
    }
    var already = requested.find(function (r) { return r.slug === slug; });
    if (already) {
      hint.textContent = already.votes + ' ' + (already.votes === 1 ? 'person has' : 'people have') + ' already requested this — submitting adds your vote.';
      hint.className = 'req-hint req-hint-dupe';
      return;
    }
    hint.textContent = '';
    hint.className = 'req-hint';
  });
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Add the page styles**

Append to `public/css/style.css`:

```css
/* REQUEST BOARD */
.req-page { max-width: 860px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
.req-h1 { font-size: 1.9rem; font-weight: 900; margin-bottom: 0.35rem; }
.req-sub { color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.75rem; }
.req-form { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 2rem; align-items: flex-start; }
.req-field { flex: 1 1 240px; }
.req-form input {
  width: 100%; background: #141414; border: 1px solid #2a2a2a; border-radius: 9px;
  padding: 0.7rem 0.9rem; color: #fff; font-size: 0.9rem; font-family: inherit;
}
.req-form > input { flex: 1 1 180px; width: auto; }
.req-form button { flex-shrink: 0; min-height: 44px; }
.req-hint { font-size: 0.76rem; margin-top: 0.4rem; line-height: 1.5; min-height: 1rem; }
.req-hint-have { color: #22c55e; }
.req-hint-dupe { color: var(--ps-blue); }
.req-listhead { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.85rem; }
.req-listtitle { font-size: 1rem; font-weight: 800; color: #fff; }
.req-count { font-size: 0.75rem; color: var(--text-secondary); background: #111; border: 1px solid #222; border-radius: 20px; padding: 0.15rem 0.6rem; }
.req-empty { color: #666; font-size: 0.88rem; padding: 2rem 0; text-align: center; }
.req-row { display: flex; align-items: center; gap: 0.85rem; background: #111; border: 1px solid #222; border-radius: 10px; padding: 0.7rem 0.9rem; margin-bottom: 0.5rem; }
.req-row-stocked { background: rgba(34,197,94,0.07); border-color: rgba(34,197,94,0.3); }
.req-votes { font-size: 1.05rem; font-weight: 900; color: var(--ps-blue); min-width: 2rem; text-align: center; }
.req-votes-stocked { color: #22c55e; }
.req-main { flex: 1; min-width: 0; }
.req-title { font-size: 0.9rem; font-weight: 700; color: #fff; }
.req-voters { font-size: 0.72rem; color: #666; margin-top: 0.1rem; }
.req-stocked-note { font-size: 0.72rem; color: #22c55e; font-weight: 700; margin-top: 0.1rem; }
.req-voteform { display: flex; gap: 0.4rem; align-items: center; flex-shrink: 0; }
.req-voteform input { width: 110px; background: #141414; border: 1px solid #2a2a2a; border-radius: 20px; padding: 0.45rem 0.7rem; color: #fff; font-size: 0.78rem; font-family: inherit; }
.req-btn { background: #fff; color: #12081f; border: 0; border-radius: 20px; padding: 0.45rem 1rem; font-size: 0.78rem; font-weight: 800; cursor: pointer; font-family: inherit; white-space: nowrap; text-decoration: none; display: inline-block; min-height: 36px; line-height: 1.6; }
.req-btn-rent { background: #22c55e; color: #04120a; }
@media (max-width: 600px) {
  .req-row { flex-wrap: wrap; }
  .req-voteform { width: 100%; }
  .req-voteform input { flex: 1; width: auto; }
}
```

- [ ] **Step 3: Add the nav link in both places**

`views/partials/nav.ejs` lists Buy twice — once in the desktop bar (line 12) and once in the mobile drawer (line 45). Both need the new link, or it will be missing on one of the two.

After **each** of these lines:

```html
    <a href="/buy" class="<%= navActive === 'buy' ? 'active' : '' %>">Buy</a>
```

add:

```html
    <a href="/requests" class="<%= navActive === 'requests' ? 'active' : '' %>">Requests</a>
```

- [ ] **Step 4: Repoint the Buy page's request link**

In `views/buy.ejs`, find (line 125):

```html
      <a href="http://m.me/PlaystationHub00?text=Hi!%20I%20want%20to%20request%20a%20game%20to%20buy." target="_blank" rel="noopener" class="buy-placeholder-cta">Request a game</a>
```

Replace with:

```html
      <a href="/requests" class="buy-placeholder-cta">Request a game</a>
```

- [ ] **Step 5: Verify templates compile and the nav link landed twice**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "require('ejs').compile(require('fs').readFileSync('views/requests.ejs','utf8'))" && echo REQUESTS_OK
node -e "require('ejs').compile(require('fs').readFileSync('views/partials/nav.ejs','utf8'))" && echo NAV_OK
node -e "require('ejs').compile(require('fs').readFileSync('views/buy.ejs','utf8'))" && echo BUY_OK
grep -c 'href="/requests"' views/partials/nav.ejs
```

Expected: three OK lines, then `2` for the nav count. A `1` means only one of the two nav locations was updated.

- [ ] **Step 6: Commit**

```bash
git add views/requests.ejs views/partials/nav.ejs views/buy.ejs public/css/style.css
git commit -m "Add public game request board"
```

---

### Task 4: Admin moderation

**Files:**
- Modify: `server.js` — pass requests into the admin render
- Modify: `views/admin.ejs` — a Requests accordion in the Games tab, and toast entries

**Interfaces:**
- Consumes: `gameRequests.listForAdmin()` from Task 1, and the four admin routes from Task 2.
- Produces: nothing consumed later.

- [ ] **Step 1: Pass requests into the admin view**

The `/admin` route's handler is `async` already (it awaits `orders.listByStates`). Find the line that builds `orderQueue`:

```js
  const orderQueue = await orders.listByStates(orders.OWNER_STATES);
```

Add immediately after:

```js
  const gameRequestRows = await gameRequests.listForAdmin();
```

Then find the `res.render('admin', { ... })` call and add `gameRequestRows,` to its object — placing it directly after `orderQueue,` keeps related data together.

- [ ] **Step 2: Add the Requests accordion to the Games tab**

In `views/admin.ejs`, immediately before the `<!-- GAMES TABLE` comment in the Games tab, add:

```html
    <!-- GAME REQUESTS -->
    <div class="settings-accordion">
      <div class="settings-accordion-header" onclick="toggleAccordion(this)" style="border-left:3px solid #22c55e;">
        <div class="sa-left">
          <div class="sa-icon" style="background:rgba(34,197,94,0.15);">🙋</div>
          <div>
            <div class="sa-title">Game Requests (<%= gameRequestRows.length %>)</div>
            <div class="sa-desc">What customers are asking for — approve new ones, mark stocked when you add them</div>
          </div>
        </div><span class="sa-arrow">▼</span>
      </div>
      <div class="settings-accordion-body">
        <div style="padding:1rem 1.25rem;">
          <% if (!gameRequestRows.length) { %>
            <div style="color:#666;font-size:0.85rem;padding:1rem 0;">No requests yet.</div>
          <% } %>
          <% gameRequestRows.forEach(r => { const votes = (r.voters || []).length; %>
          <div style="display:flex;align-items:flex-start;gap:0.85rem;background:#111;border:1px solid <%= r.status === 'pending' ? '#7a5c00' : '#222' %>;border-radius:10px;padding:0.8rem 1rem;margin-bottom:0.6rem;">
            <span style="font-size:1.1rem;font-weight:900;color:var(--ps-blue);min-width:2rem;text-align:center;"><%= votes %></span>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;color:#fff;font-size:0.9rem;">
                <%= r.title %>
                <span style="font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;margin-left:0.4rem;color:<%= r.status === 'pending' ? '#f59e0b' : r.status === 'approved' ? 'var(--ps-blue)' : r.status === 'stocked' ? '#22c55e' : '#666' %>;"><%= r.status %></span>
              </div>
              <div style="font-size:0.72rem;color:#666;margin-top:0.25rem;line-height:1.6;">
                <%= (r.voters || []).map(v => v.fb_name).join(', ') || 'no voters' %>
              </div>
            </div>
            <div style="display:flex;gap:0.35rem;flex-wrap:wrap;flex-shrink:0;">
              <% if (r.status === 'pending') { %>
              <form method="POST" action="/admin/requests/<%= r.slug %>/approve" style="display:inline"><button type="submit" class="btn-edit" style="background:rgba(34,197,94,0.15);color:#22c55e;">Approve</button></form>
              <form method="POST" action="/admin/requests/<%= r.slug %>/reject" style="display:inline"><button type="submit" class="btn-edit">Reject</button></form>
              <% } %>
              <% if (r.status === 'approved') { %>
              <form method="POST" action="/admin/requests/<%= r.slug %>/stock" style="display:inline" onsubmit="return confirm('Mark <%= r.title.replace(/'/g, "\\'") %> as stocked? It will show as Now available on the request board.');"><button type="submit" class="btn-edit" style="background:rgba(34,197,94,0.15);color:#22c55e;">Mark stocked</button></form>
              <% } %>
              <form method="POST" action="/admin/requests/<%= r.slug %>/delete" style="display:inline" onsubmit="return confirm('Delete this request permanently?');"><button type="submit" class="btn-delete">🗑</button></form>
            </div>
          </div>
          <% }) %>
        </div>
      </div>
    </div>
```

- [ ] **Step 3: Add toast entries**

In `views/admin.ejs`, find the client-side `messages` dictionary (a single long line, currently ending `signin_step_deleted:'🗑 Step deleted!', order_marked_paid:'✅ Order marked as paid!', order_cancelled:'🚫 Order cancelled.' };`) and append four entries before the closing brace so it ends:

```js
order_marked_paid:'✅ Order marked as paid!', order_cancelled:'🚫 Order cancelled.', request_approved:'✅ Request approved!', request_rejected:'🚫 Request rejected.', request_stocked:'📦 Marked as stocked!', request_deleted:'🗑 Request deleted.' };
```

Then find the `msgTabMap` object in the same script and add the four keys so the panel switches to the Games tab afterwards:

```js
    signin_step_saved:'settings', signin_step_deleted:'settings',
    request_approved:'games', request_rejected:'games', request_stocked:'games', request_deleted:'games'
```

- [ ] **Step 4: Verify**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -c server.js && echo SERVER_OK
node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'))" && echo ADMIN_OK
grep -oE "request_(approved|rejected|stocked|deleted)" views/admin.ejs | sort -u | wc -l
```

Expected: `SERVER_OK`, `ADMIN_OK`, then `4`.

- [ ] **Step 5: Commit**

```bash
git add server.js views/admin.ejs
git commit -m "Add game request moderation to admin"
```

---

### Task 5: Deploy and verify end to end

**Files:** none — verification only.

- [ ] **Step 1: Deploy**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git push origin main
```

- [ ] **Step 2: Wait for rollover**

```bash
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://playstation-hub.com/requests")
  [ "$code" = "200" ] && echo "live (attempt $i)" && break
  echo "attempt $i: $code"; sleep 20
done
```

A Railway deploy can 502 briefly mid-rollover, and `/` may answer 200 from the old instance — poll `/requests` specifically, since it only exists on the new build.

- [ ] **Step 3: Verify the board renders and the MongoDB index exists**

Using the Browser tool, navigate to `https://playstation-hub.com/requests` and confirm the page renders with the form, the "Most requested" heading, and the empty-state line. Then check the nav shows a Requests link.

- [ ] **Step 4: Submit one real request and confirm the full lifecycle**

This writes a real row, which is acceptable here — unlike an order it costs nothing and can be deleted from admin afterwards. Use an obviously-test title so it is easy to remove.

1. On `/requests`, type a title you do **not** stock. Confirm no hint appears.
2. Type a title you **do** stock (e.g. `007 First Light`). Confirm the hint reads "We already have this" with a working link, in green.
3. Submit the test title with a Facebook name. Confirm the redirect shows "Thanks — we'll review it".
4. Confirm it does **not** appear on the public board (it is `pending`).
5. Log into `/admin` (password `Ryuzaki2300`; sessions drop on every redeploy), open the Games tab, expand Game Requests. Confirm the entry appears with status `pending`, vote count 1, and the voter's full name.
6. Click Approve. Confirm the toast, then reload `/requests` and confirm it now appears publicly, showing the voter's **first name only**.
7. On `/requests`, vote for it using a *different* name. Confirm the count goes to 2.
8. Vote again with the same name. Confirm it is rejected with "You've already voted for that one."
9. In admin, click Mark stocked and confirm. Reload `/requests` and confirm the row is green and reads "Now available".
10. In admin, delete the test entry and confirm it disappears from both views.

- [ ] **Step 5: Confirm the duplicate-title guard**

Submit a request whose title differs only in punctuation or case from the test entry (e.g. `Test Game` vs `test game!`). Confirm the hint recognises it as already requested and that submitting adds a vote rather than creating a second row — this is the behaviour the whole feature depends on.

- [ ] **Step 6: Report to the user**

Give them the URL, confirm the lifecycle works, and note that voter notifications are not built — the names are captured and visible in admin so they can message people manually.
