# Search-Requests Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The nav search shows approved game requests as their own result section, and its empty state offers to request the game instead of dead-ending at Messenger.

**Architecture:** `/api/search-index` becomes async and appends approved requests (guarded so a MongoDB failure degrades to no requested section, never a broken index). `/requests` accepts an optional `?title=` to prefill the request form, and each board row gets an anchor id so search results can deep-link to a specific row. `nav.ejs`'s client-side renderer gains a fourth result section and a new empty state.

**Tech Stack:** Node/Express, EJS, vanilla client-side JS (no new dependencies).

## Global Constraints

- Only requests with `status === 'approved'` are searchable — `pending` stays unmoderated/invisible, `stocked` is already a normal catalogue result, `rejected` is excluded.
- `/api/search-index`'s requests lookup MUST be wrapped so a MongoDB error yields zero requested entries, not a failed response — an unhandled throw here would break the entire nav search site-wide, not just the new section. This is the single highest-priority constraint in this plan.
- Requested-section index entries carry exactly `{ t, v, u, y: 'requested', img }` — no `p`/`pr`/`s` fields, which have no meaning for a request.
- The Requested section renders whenever a request matches, alongside any other matching sections — never only in the empty state.
- The empty state's button order is: Request this game (primary) → Message Us (secondary) → Browse All Games (tertiary). "Request this game" links to `/requests?title=<the exact text typed>`.
- No new POST endpoint. Voting/requesting still goes through the existing `/requests/add` and `/requests/:slug/vote` routes, unchanged.
- `views/partials/order-queue.ejs`, `lib/requests.js`'s existing exports, and the requests board's vote/moderation logic are not touched by this plan.

---

### Task 1: `/requests?title=` prefill and per-row anchor ids

**Files:**
- Modify: `server.js:860-870` (the `GET /requests` handler)
- Modify: `views/requests.ejs` (title input, each row's wrapper div)

**Interfaces:**
- Consumes: nothing new — `req.query.title`, already-available Express behavior.
- Produces: `views/requests.ejs` now expects a `prefillTitle` local (string, may be `''`) from its render call — Task 2 does not touch this render call, so no other task depends on this exact name, but keep it consistent if referenced elsewhere later.

- [ ] **Step 1: Pass the query title through in the route**

In `server.js`, find:

```js
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
```

Replace with:

```js
app.get('/requests', async (req, res) => {
  const rows = await gameRequests.listPublic();
  res.render('requests', {
    requests: rows,
    firstName: gameRequests.firstName,
    settings: getSiteSettings(),
    announcement: getAnnouncement(),
    announcements: getAnnouncements(),
    msg: req.query.msg || null,
    prefillTitle: (req.query.title || '').slice(0, 200)
  });
});
```

The `.slice(0, 200)` caps an arbitrarily long query string from ever being reflected into the page — this value only ever fills a text input's `value` attribute, but capping it costs nothing and removes any need to think about it further.

- [ ] **Step 2: Prefill the title input**

In `views/requests.ejs`, find:

```ejs
      <input type="text" name="title" id="reqTitle" placeholder="Game title" autocomplete="off" required>
```

Replace with:

```ejs
      <input type="text" name="title" id="reqTitle" placeholder="Game title" autocomplete="off" required value="<%= prefillTitle %>">
```

EJS's `<%= %>` HTML-escapes automatically, so a title containing `"` or `<` cannot break out of the attribute — no extra escaping needed here.

- [ ] **Step 3: Give each board row an anchor id**

In `views/requests.ejs`, find:

```ejs
  <div class="req-row<%= r.status === 'stocked' ? ' req-row-stocked' : '' %>">
```

Replace with:

```ejs
  <div class="req-row<%= r.status === 'stocked' ? ' req-row-stocked' : '' %>" id="req-<%= r.slug %>">
```

`r.slug` is already a URL-safe slug (produced by `gameRequests.slugify()` at creation time — see `lib/requests.js`), so it's safe to use directly as an id with no escaping concerns.

- [ ] **Step 4: Verify the view compiles and renders**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const ejs = require('ejs');
const path = require('path');
const html = ejs.render(
  require('fs').readFileSync('views/requests.ejs', 'utf8'),
  {
    requests: [{ slug: 'test-game', title: 'Test Game', status: 'approved', voters: [{fb_name:'Ana Cruz'}], cover_image: '' }],
    firstName: n => String(n||'').split(' ')[0],
    settings: { title: 'Test', favicon_path: '/f.svg' },
    announcement: null, announcements: [], msg: null,
    prefillTitle: 'persona 3 reloaded',
    assetV: 'x'
  },
  { filename: path.resolve('views/requests.ejs') }
);
console.log(html.includes('value=\"persona 3 reloaded\"') ? 'PREFILL_OK' : 'PREFILL_MISSING');
console.log(html.includes('id=\"req-test-game\"') ? 'ANCHOR_OK' : 'ANCHOR_MISSING');
"
```

Expected: `PREFILL_OK` and `ANCHOR_OK`.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add server.js views/requests.ejs
git commit -m "Add ?title= prefill and per-row anchors to the requests board"
```

---

### Task 2: Add approved requests to `/api/search-index`, with a failure guard

**Files:**
- Modify: `server.js:2178-2223` (`GET /api/search-index`)

**Interfaces:**
- Consumes: `gameRequests.listPublic()` (already exists — returns approved+stocked rows, ranked by vote count; `lib/requests.js:58`). This task must filter to `status === 'approved'` itself, since `listPublic()` also includes `stocked` rows (which belong in the catalogue result, not the requested one).
- Produces: the JSON array returned by `/api/search-index` now includes zero or more entries shaped `{ t, v, u, y: 'requested', img }`, appended after the existing `psplusMonthly` entries. `views/partials/nav.ejs` (Task 3) consumes this shape.

- [ ] **Step 1: Make the route async and append guarded requested entries**

In `server.js`, find:

```js
app.get('/api/search-index', (req, res) => {
```

Replace with:

```js
app.get('/api/search-index', async (req, res) => {
```

Find the end of the handler:

```js
  res.json([...available, ...soon, ...psplus, ...psplusMonthly]);
});
```

Replace with:

```js
  // Approved requests only — pending is unmoderated text that must never reach
  // a public page, stocked is already a catalogue entry and would just
  // duplicate that row. Wrapped so a MongoDB failure yields no requested
  // section rather than breaking this entire endpoint: an unhandled throw
  // here would silently disable nav search sitewide, a far worse outcome
  // than the requested section simply being absent for one request.
  let requested = [];
  try {
    const approvedRequests = (await gameRequests.listPublic()).filter(r => r.status === 'approved');
    requested = approvedRequests.map(r => ({
      t: r.title, v: (r.voters || []).length, u: '/requests#req-' + r.slug,
      y: 'requested', img: r.cover_image || ''
    }));
  } catch (e) {
    console.error('[search-index] requests lookup failed', e.message);
  }

  res.json([...available, ...soon, ...psplus, ...psplusMonthly, ...requested]);
});
```

- [ ] **Step 2: Verify the route still starts and the shape is correct**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -c server.js && echo SYNTAX_OK
```

Expected: `SYNTAX_OK`

- [ ] **Step 3: Verify the guard actually catches a thrown error**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
async function run() {
  const gameRequests = { listPublic: async () => { throw new Error('mongo down'); } };
  let requested = [];
  try {
    const approvedRequests = (await gameRequests.listPublic()).filter(r => r.status === 'approved');
    requested = approvedRequests.map(r => ({ t: r.title, v: (r.voters||[]).length, u: '/requests#req-'+r.slug, y: 'requested', img: r.cover_image||'' }));
  } catch (e) {
    console.error('[search-index] requests lookup failed', e.message);
  }
  console.log('requested array on failure:', JSON.stringify(requested));
}
run();
"
```

Expected: prints the error to stderr, then `requested array on failure: []` — proving the failure path degrades to an empty array rather than propagating.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add server.js
git commit -m "Add approved requests to the search index, guarded against DB failure"
```

---

### Task 3: Render the Requested section and the new empty state in nav search

**Files:**
- Modify: `views/partials/nav.ejs` (the `render(term)` function and the empty-state block)
- Modify: `public/css/style.css` (one new badge class)

**Interfaces:**
- Consumes: the `y: 'requested'` entries produced by Task 2, shaped `{ t, v, u, y, img }`.
- Produces: nothing consumed by a later task — this is the plan's last task.

- [ ] **Step 1: Add the Requested section to `render(term)`**

In `views/partials/nav.ejs`, find:

```js
    const now = matches.filter(x => x.y === 'now').slice(0, 6);
    const psplus = matches.filter(x => x.y === 'psplus').slice(0, 3);
    const soon = matches.filter(x => x.y === 'soon').slice(0, 3);
```

Replace with:

```js
    const now = matches.filter(x => x.y === 'now').slice(0, 6);
    const psplus = matches.filter(x => x.y === 'psplus').slice(0, 3);
    const soon = matches.filter(x => x.y === 'soon').slice(0, 3);
    const requested = matches.filter(x => x.y === 'requested').slice(0, 3);
```

Find:

```js
    if (soon.length) {
      h += '<div class="navsearch-head">Coming soon</div>';
      soon.forEach(x => {
        const soonThumb = x.img ? '<img src="' + x.img + '" alt="" loading="lazy">' : '🔜';
        h += '<a class="navsearch-item" href="' + x.u + '"><div class="navsearch-thumb">' + soonThumb + '</div>' +
          '<div class="navsearch-body"><div class="navsearch-title">' + hl(x.t, t) + '</div>' +
          '<div class="navsearch-meta"><span>' + x.p + '</span><span>' + x.d + '</span></div></div>' +
          '<span class="navsearch-badge-soon">SOON</span></a>';
      });
    }
```

Immediately after that block, add:

```js
    if (requested.length) {
      h += '<div class="navsearch-head">Requested by customers</div>';
      requested.forEach(x => {
        const reqThumb = x.img ? '<img src="' + x.img + '" alt="" loading="lazy">' : '🙋';
        h += '<a class="navsearch-item" href="' + x.u + '"><div class="navsearch-thumb">' + reqThumb + '</div>' +
          '<div class="navsearch-body"><div class="navsearch-title">' + hl(x.t, t) + '</div>' +
          '<div class="navsearch-meta"><span>' + x.v + ' vote' + (x.v !== 1 ? 's' : '') + '</span></div></div>' +
          '<span class="navsearch-badge-requested">REQUESTED</span></a>';
      });
    }
```

- [ ] **Step 2: Include `requested` in the "see all results" count check**

Find:

```js
    } else if (matches.length > now.length + psplus.length + soon.length) {
      h += '<a class="navsearch-all" href="/browse?search=' + encodeURIComponent(term.trim()) + '">See all ' + matches.length + ' results →</a>';
    }
```

Replace with:

```js
    } else if (matches.length > now.length + psplus.length + soon.length + requested.length) {
      h += '<a class="navsearch-all" href="/browse?search=' + encodeURIComponent(term.trim()) + '">See all ' + matches.length + ' results →</a>';
    }
```

Without this change, a search whose results are entirely soaked up by the four visible sections would still show a "See all N results" link claiming there's more, when there isn't — this keeps the check accurate now that a fourth section exists.

- [ ] **Step 3: Replace the empty state**

Find:

```js
    if (!h) {
      h = '<div class="navsearch-empty">' +
        '<div class="navsearch-empty-ico">🔍</div>' +
        '<div class="navsearch-empty-title">No games match &ldquo;' + esc(term.trim()) + '&rdquo;</div>' +
        '<div class="navsearch-empty-sub">We might still be able to get it for you — message us and we\'ll check.</div>' +
        '<div class="navsearch-empty-acts">' +
        '<a href="http://m.me/PlaystationHub00" target="_blank" rel="noopener" class="navsearch-empty-btn">Message Us</a>' +
        '<a href="/browse" class="navsearch-empty-btn2">Browse All Games</a>' +
        '</div></div>';
    }
```

Replace with:

```js
    if (!h) {
      h = '<div class="navsearch-empty">' +
        '<div class="navsearch-empty-ico">🔍</div>' +
        '<div class="navsearch-empty-title">No games match &ldquo;' + esc(term.trim()) + '&rdquo;</div>' +
        '<div class="navsearch-empty-sub">Not in our library yet — request it and we\'ll stock the most-wanted titles first.</div>' +
        '<div class="navsearch-empty-acts">' +
        '<a href="/requests?title=' + encodeURIComponent(term.trim()) + '" class="navsearch-empty-btn">Request this game</a>' +
        '<a href="http://m.me/PlaystationHub00" target="_blank" rel="noopener" class="navsearch-empty-btn2">Message Us</a>' +
        '<a href="/browse" class="navsearch-empty-btn2">Browse All Games</a>' +
        '</div></div>';
    }
```

Both non-primary buttons reuse the existing `navsearch-empty-btn2` class rather than introducing a third visual weight — the spec calls for a clear primary action, not three tiers of visual emphasis.

- [ ] **Step 4: Add the badge CSS**

In `public/css/style.css`, find:

```css
.navsearch-badge-psplus {
  background: linear-gradient(135deg,#856200,#FFD700); color: #000; font-size: 0.75rem;
  font-weight: 900; padding: 0.14rem 0.45rem; border-radius: 20px; letter-spacing: 0.05em; flex-shrink: 0;
}
```

Immediately after it, add:

```css
.navsearch-badge-requested {
  background: #1a2a3d; color: var(--ps-blue); font-size: 0.75rem;
  font-weight: 900; padding: 0.14rem 0.45rem; border-radius: 20px; letter-spacing: 0.05em; flex-shrink: 0;
  border: 1px solid #2a3f5a;
}
```

A solid-fill badge (matching `.navsearch-badge-soon` and `.navsearch-badge-psplus`'s style) would visually claim the same weight as "this is available" — REQUESTED needs to read as a distinct, lower-certainty state, so it gets an outlined treatment instead of a third gradient fill.

- [ ] **Step 5: Verify the EJS partial still compiles**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "require('ejs').compile(require('fs').readFileSync('views/partials/nav.ejs','utf8'), { filename: require('path').resolve('views/partials/nav.ejs') }); console.log('NAV_OK')"
```

Expected: `NAV_OK`

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add views/partials/nav.ejs public/css/style.css
git commit -m "Render requested-games search section and request-first empty state"
```

---

### Task 4: Deploy and verify end to end

**Files:** none — verification only.

- [ ] **Step 1: Deploy**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git push origin main
```

- [ ] **Step 2: Wait for rollover**

```bash
for i in $(seq 1 15); do
  body=$(curl -s "https://playstation-hub.com/requests")
  if echo "$body" | grep -q "id=\"req-"; then echo "attempt $i: new build live"; break; fi
  echo "attempt $i: still old"; sleep 15
done
```

Polls for the new per-row anchor id, which only exists in the new build — a bare `/` 200 can be a stale response mid-rollover.

- [ ] **Step 3: Confirm at least one approved request exists to test against**

Using the Browser tool, navigate to `https://playstation-hub.com/requests` and note the title and vote count of any approved (non-"Now available", non-pending — pending rows aren't shown publicly at all) entry. If none exist, submit and approve one test entry via `/admin` first (Games tab → Game Requests → Approve), using an obviously-test title.

- [ ] **Step 4: Verify the Requested search section**

On any page, open the nav search (press `/` or click the search icon) and type the approved request's title (or enough of it to match). Confirm:
- A "Requested by customers" section appears with the correct vote count.
- Clicking the row navigates to `/requests` and lands scrolled to that specific row (confirm via the URL fragment `#req-<slug>` and that the row is in view).

- [ ] **Step 5: Verify a request coexists with other matching sections**

Search a term that also matches a catalogue game or Coming Soon title (if the approved test request's title doesn't naturally overlap with anything, pick any other search term with a real "Available now" hit and temporarily use that hit's title as a second request for this test, or skip if no natural overlap exists and note it in the report). Confirm both sections render together, not one replacing the other.

- [ ] **Step 6: Verify pending requests do not leak into search**

In `/admin`, submit a new request with an obviously-test title and leave it pending (do not approve). Search that exact title in the nav — confirm it does **not** appear anywhere in the results (neither as a false "Available now"/"Coming soon" hit nor as "Requested"). Delete this test entry afterward from admin.

- [ ] **Step 7: Verify the new empty state**

Search a string guaranteed to match nothing (e.g. a random string like `zzqxnotarealgametitle123`). Confirm:
- The empty state shows the new sub-copy ("Not in our library yet...").
- Three buttons appear in order: "Request this game" (primary style), "Message Us", "Browse All Games".
- Clicking "Request this game" opens `/requests?title=zzqxnotarealgametitle123` and the title field is prefilled with that exact text.

- [ ] **Step 8: Verify no console errors and no regression to the "see all" link**

Search a term with more than 6 "Available now" matches (or as many sections' worth as exist) to confirm the "See all N results →" link still appears only when genuinely more results exist beyond what's shown, and that its count is accurate. Check the browser console for errors throughout all of the above steps.

- [ ] **Step 9: Report to the user**

Confirm the feature is live with a summary of what was tested, and clean up any test request entries created during verification.
