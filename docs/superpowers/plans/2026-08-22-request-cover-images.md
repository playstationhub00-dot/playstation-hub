# Request Cover Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every entry on `/requests` gets a cover thumbnail — inherited free from the catalogue where possible, uploaded by the owner otherwise.

**Architecture:** One new field (`cover_image`) on the `game_requests` document. Two free auto-inherit paths (request-creation time from Coming Soon/PS Plus, stock time from the linked game) live in `server.js`, reusing the existing `getUpcoming()`/`getPsplusPopular()`/`getGames()` lookups and `gameSlug()`. A third, manual path is a new admin upload route reusing the existing `upload` multer instance and `processUploadedImage()` helper. Two view changes render the thumbnail (public board) and the upload control (admin).

**Tech Stack:** Node/Express, MongoDB, EJS, multer + sharp (all already in use — no new dependencies).

## Global Constraints

- One new field on the `game_requests` document: `cover_image` (`''` default, a path like `/uploads/1755834000.webp` once set) — matches how `cover_image` is stored on games, upcoming entries, and PS Plus entries elsewhere in this codebase.
- Auto-inherit at request-creation time from a slug match against Coming Soon (`upcoming`) or PS Plus popular (`psplus_popular`) entries. Available-catalogue titles are irrelevant here — they're already blocked from becoming requests by the existing guard in `POST /requests/add`.
- Auto-inherit at stock time from the linked game's `cover_image`, only when `game_id` is set and the request has no cover yet. Never overwrites a cover already set by hand.
- Owner upload is available on **every** row in the admin Game Requests list regardless of status, not only at approval — four requests are already live with no cover and would otherwise be unreachable.
- No remove/delete-image action — replacing a cover covers the realistic case.
- Upload reuses the existing `upload` multer instance (`server.js:279`, 5MB limit, image mimetypes only) and `processUploadedImage(file, maxDim)` (`server.js:303`) at `maxDim = 900`, same as every other cover upload in this app. No new multer instance, no new dependency.
- Public board thumbnail: 40×60 desktop, 32×48 mobile (2:3 ratio, matching `.gc2-card`), `object-fit: cover`. A request with no cover renders a same-sized dashed-border placeholder box, not a missing/collapsed cell — this is what keeps the row-by-row ranking aligned and scannable.
- New admin toast message key `request_image` must be added to **both** the `messages` object and the `msgTabMap` object in `views/admin.ejs` (`server.js:3481` / `server.js:3493` line numbers are approximate — locate by grepping `request_stocked` in that file, which appears in both objects already) — a key present in only one produces either a toast with no tab switch, or a tab switch with no toast.

---

### Task 1: Data layer — `cover_image` field and setter

**Files:**
- Modify: `lib/requests.js`

**Interfaces:**
- Consumes: nothing new — this task only adds to the existing module.
- Produces: `createRequest({ title, fb_name, session_id, cover_image })` now accepts an optional `cover_image` string (defaults to `''`) which is stored on the new document. `setCoverImage(slug, coverImage)` — async function, returns `true`/`false` (matches the `setStatus`/`remove` boolean-return convention already in this file), unconditionally sets `cover_image` on the given slug (no overwrite guard inside this function — callers decide whether to call it, per the "never overwrite a cover set by hand" rule, which server.js enforces by only calling this when appropriate, not by lib/requests.js re-checking).

- [ ] **Step 1: Add `cover_image` to `createRequest`**

In `lib/requests.js`, find:

```js
async function createRequest({ title, fb_name, session_id }) {
```

Replace with:

```js
async function createRequest({ title, fb_name, session_id, cover_image }) {
```

Find the `doc` object inside that function:

```js
  const doc = {
    slug,
    title: clean,
    status: 'pending',
    voters: [{ fb_name: String(fb_name || '').trim(), session_id: session_id || null, at: now }],
    game_id: null,
    created_at: now,
    updated_at: now
  };
```

Replace with:

```js
  const doc = {
    slug,
    title: clean,
    status: 'pending',
    voters: [{ fb_name: String(fb_name || '').trim(), session_id: session_id || null, at: now }],
    game_id: null,
    cover_image: cover_image || '',
    created_at: now,
    updated_at: now
  };
```

- [ ] **Step 2: Add `setCoverImage`**

In `lib/requests.js`, find the `setStatus` function:

```js
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
```

Immediately after it, add:

```js
// Sets or replaces a request's cover image. Called from the admin upload route,
// and from the auto-inherit paths in server.js (request creation, stocking) —
// this function itself has no overwrite guard; the caller decides whether an
// existing cover_image should be left alone.
async function setCoverImage(slug, coverImage) {
  const col = await _col();
  if (!col) return false;
  const r = await col.updateOne(
    { slug },
    { $set: { cover_image: coverImage || '', updated_at: new Date().toISOString() } }
  );
  return r.matchedCount > 0;
}
```

- [ ] **Step 3: Export `setCoverImage`**

Find the `module.exports` block at the bottom of `lib/requests.js`:

```js
module.exports = {
  STATUSES, PUBLIC_STATUSES,
  init, slugify, firstName, ensureIndexes,
  getBySlug, listByStatus, listPublic, listForAdmin,
  createRequest, addVote, setStatus, remove
};
```

Replace with:

```js
module.exports = {
  STATUSES, PUBLIC_STATUSES,
  init, slugify, firstName, ensureIndexes,
  getBySlug, listByStatus, listPublic, listForAdmin,
  createRequest, addVote, setStatus, setCoverImage, remove
};
```

- [ ] **Step 4: Verify the module loads and the shape is correct**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const r = require('./lib/requests.js');
console.log(typeof r.setCoverImage === 'function' ? 'setCoverImage OK' : 'MISSING setCoverImage');
console.log(typeof r.createRequest === 'function' ? 'createRequest OK' : 'MISSING createRequest');
"
```

Expected:
```
setCoverImage OK
createRequest OK
```

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add lib/requests.js
git commit -m "Add cover_image field and setCoverImage to the requests data layer"
```

---

### Task 2: Auto-inherit on creation and on stocking, plus the manual upload route

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `gameRequests.createRequest({ title, fb_name, session_id, cover_image })`, `gameRequests.setCoverImage(slug, coverImage)` from Task 1. Existing `getUpcoming()` (`server.js:446`), `getPsplusPopular()` (`server.js:472`), `getGames()` (`server.js:438`), `gameSlug()`, `upload` (multer instance, `server.js:279`), `processUploadedImage(file, maxDim)` (`server.js:303`).
- Produces: `POST /admin/requests/:slug/image` — new route, consumed by Task 3's admin.ejs form.

- [ ] **Step 1: Auto-inherit from Coming Soon / PS Plus at request-creation time**

In `server.js`, find the `POST /requests/add` handler:

```js
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
```

Replace with:

```js
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

  // Free auto-inherit: if this title matches something already in Coming Soon or
  // PS Plus popular, copy its cover so the request never starts with a blank
  // thumbnail. Available-catalogue titles are excluded by the guard above, so
  // only these two lists are worth checking here.
  const inheritedCover =
    (getUpcoming().find(g => gameSlug(g.title) === slug) || {}).cover_image ||
    (getPsplusPopular().find(g => gameSlug(g.title) === slug) || {}).cover_image ||
    '';

  const r = await gameRequests.createRequest({ title, fb_name, session_id: req.sessionId || null, cover_image: inheritedCover });
```

The rest of the handler (the `if (r.ok)` / `if (r.reason === 'exists')` block) is unchanged.

- [ ] **Step 2: Auto-inherit from the linked game at stock time**

In `server.js`, find:

```js
app.post('/admin/requests/:slug/stock', requireAuth, async (req, res) => {
  const gameId = parseInt(req.body.game_id);
  await gameRequests.setStatus(req.params.slug, 'stocked', {
    game_id: Number.isFinite(gameId) ? gameId : null
  });
  res.redirect('/admin?tab=games&msg=request_stocked');
});
```

Replace with:

```js
app.post('/admin/requests/:slug/stock', requireAuth, async (req, res) => {
  const gameId = parseInt(req.body.game_id);
  const validGameId = Number.isFinite(gameId) ? gameId : null;
  await gameRequests.setStatus(req.params.slug, 'stocked', { game_id: validGameId });

  // Free auto-inherit: a stocked request now has a real catalogue row, which
  // already carries the correct cover — copy it rather than asking the owner to
  // upload art they just uploaded. Only fills a cover that's still empty; never
  // overwrites one already set by hand.
  if (validGameId) {
    const existing = await gameRequests.getBySlug(req.params.slug);
    if (existing && !existing.cover_image) {
      const linkedGame = getGames().find(g => g.id === validGameId);
      if (linkedGame && linkedGame.cover_image) {
        await gameRequests.setCoverImage(req.params.slug, linkedGame.cover_image);
      }
    }
  }

  res.redirect('/admin?tab=games&msg=request_stocked');
});
```

- [ ] **Step 3: Add the manual upload route**

In `server.js`, find the delete route (the last of the four existing `/admin/requests/:slug/*` routes):

```js
app.post('/admin/requests/:slug/delete', requireAuth, async (req, res) => {
  await gameRequests.remove(req.params.slug);
  res.redirect('/admin?tab=games&msg=request_deleted');
});
```

Immediately after it, add:

```js
// Manual cover upload — the only path for a title the catalogue has never heard
// of. Available on every row regardless of status (not just at approval), since
// requests can already be approved with no cover and need a way to get one.
app.post('/admin/requests/:slug/image', requireAuth, upload.single('cover_image'), async (req, res) => {
  if (!req.file) return res.redirect('/admin?tab=games&msg=request_image');
  const coverPath = await processUploadedImage(req.file, 900);
  await gameRequests.setCoverImage(req.params.slug, coverPath);
  res.redirect('/admin?tab=games&msg=request_image');
});
```

- [ ] **Step 4: Verify server.js still parses and starts**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -c server.js && echo SYNTAX_OK
```

Expected: `SYNTAX_OK`

- [ ] **Step 5: Verify the route count**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -c "app.post('/admin/requests/:slug/" server.js
```

Expected: `5` (approve, reject, stock, delete, image)

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add server.js
git commit -m "Add cover-image auto-inherit and manual upload for game requests"
```

---

### Task 3: Public board thumbnail

**Files:**
- Modify: `views/requests.ejs`
- Modify: `public/css/style.css`

**Interfaces:**
- Consumes: `r.cover_image` (string, `''` when unset) on each request row object returned by `gameRequests.listPublic()` (Task 1/2 — the field already exists on every document from here on; older documents created before this plan simply read as `undefined`, which the template must treat the same as `''`).
- Produces: nothing consumed by a later task — this is the last public-facing piece.

- [ ] **Step 1: Add the thumbnail markup**

In `views/requests.ejs`, find:

```ejs
  <% requests.forEach(r => { const votes = (r.voters || []).length; %>
  <div class="req-row<%= r.status === 'stocked' ? ' req-row-stocked' : '' %>">
    <span class="req-votes<%= r.status === 'stocked' ? ' req-votes-stocked' : '' %>"><%= votes %></span>
    <div class="req-main">
```

Replace with:

```ejs
  <% requests.forEach(r => { const votes = (r.voters || []).length; %>
  <div class="req-row<%= r.status === 'stocked' ? ' req-row-stocked' : '' %>">
    <span class="req-votes<%= r.status === 'stocked' ? ' req-votes-stocked' : '' %>"><%= votes %></span>
    <% if (r.cover_image) { %>
      <img class="req-cover" src="<%= r.cover_image %>" alt="">
    <% } else { %>
      <div class="req-cover req-cover-empty">🎮</div>
    <% } %>
    <div class="req-main">
```

The rest of the row (`.req-main` contents, the vote form / Rent button) is unchanged.

- [ ] **Step 2: Verify the EJS compiles**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "require('ejs').compile(require('fs').readFileSync('views/requests.ejs','utf8')); console.log('COMPILE_OK')"
```

Expected: `COMPILE_OK`

- [ ] **Step 3: Add the CSS**

In `public/css/style.css`, find the `.req-row-stocked` rule:

```css
.req-row-stocked { background: rgba(34,197,94,0.07); border-color: rgba(34,197,94,0.3); }
```

Immediately after it, add:

```css
.req-cover { width: 40px; height: 60px; min-width: 40px; border-radius: 5px; object-fit: cover; background: #151515; }
.req-cover-empty { display: flex; align-items: center; justify-content: center; border: 1px dashed #2e2e2e; font-size: 1.1rem; color: #3d3d3d; }
```

Find the existing `@media (max-width: 600px)` block that already contains `.req-row` rules (added when the request-a-game guide was built):

```css
@media (max-width: 600px) {
  .req-row { flex-wrap: wrap; }
  .req-voteform { width: 100%; }
  .req-voteform input { flex: 1; width: auto; }
```

Add one line inside that same block (do not open a second `@media (max-width: 600px)` block):

```css
@media (max-width: 600px) {
  .req-row { flex-wrap: wrap; }
  .req-voteform { width: 100%; }
  .req-voteform input { flex: 1; width: auto; }
  .req-cover { width: 32px; height: 48px; min-width: 32px; }
```

(The remaining lines of that block — the request-a-game guide's `.req-guide*` mobile rules — stay exactly as they are; this just adds one more line before the block's closing `}`.)

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add views/requests.ejs public/css/style.css
git commit -m "Render cover thumbnails on the public request board"
```

---

### Task 4: Admin thumbnail and upload control

**Files:**
- Modify: `views/admin.ejs`

**Interfaces:**
- Consumes: `r.cover_image` on each row from `gameRequests.listForAdmin()` (already flowing through `gameRequestRows` at `server.js:2410`). Posts to `POST /admin/requests/:slug/image` from Task 2.
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Add the thumbnail and upload form to every request row**

In `views/admin.ejs`, find the Game Requests row markup:

```ejs
          <% gameRequestRows.forEach(r => { const votes = (r.voters || []).length; %>
          <div style="display:flex;align-items:flex-start;gap:0.85rem;background:#111;border:1px solid <%= r.status === 'pending' ? '#7a5c00' : '#222' %>;border-radius:10px;padding:0.8rem 1rem;margin-bottom:0.6rem;">
            <span style="font-size:1.1rem;font-weight:900;color:var(--ps-blue);min-width:2rem;text-align:center;"><%= votes %></span>
            <div style="flex:1;min-width:0;">
```

Replace with:

```ejs
          <% gameRequestRows.forEach(r => { const votes = (r.voters || []).length; %>
          <div style="display:flex;align-items:flex-start;gap:0.85rem;background:#111;border:1px solid <%= r.status === 'pending' ? '#7a5c00' : '#222' %>;border-radius:10px;padding:0.8rem 1rem;margin-bottom:0.6rem;">
            <span style="font-size:1.1rem;font-weight:900;color:var(--ps-blue);min-width:2rem;text-align:center;"><%= votes %></span>
            <% if (r.cover_image) { %>
              <img src="<%= r.cover_image %>" alt="" style="width:40px;height:60px;min-width:40px;border-radius:5px;object-fit:cover;background:#151515;">
            <% } else { %>
              <div style="width:40px;height:60px;min-width:40px;border-radius:5px;border:1px dashed #2e2e2e;display:flex;align-items:center;justify-content:center;font-size:1.1rem;color:#3d3d3d;">🎮</div>
            <% } %>
            <div style="flex:1;min-width:0;">
```

Then find the closing of that row's action-buttons div:

```ejs
              <form method="POST" action="/admin/requests/<%= r.slug %>/delete" style="display:inline" onsubmit="return confirm('Delete this request permanently?');"><button type="submit" class="btn-delete">🗑</button></form>
            </div>
          </div>
          <% }) %>
```

Replace with:

```ejs
              <form method="POST" action="/admin/requests/<%= r.slug %>/delete" style="display:inline" onsubmit="return confirm('Delete this request permanently?');"><button type="submit" class="btn-delete">🗑</button></form>
            </div>
          </div>
          <form method="POST" action="/admin/requests/<%= r.slug %>/image" enctype="multipart/form-data" style="display:flex;gap:0.4rem;align-items:center;margin:-0.3rem 0 0.6rem 2.85rem;">
            <input type="file" name="cover_image" accept="image/*" style="font-size:0.72rem;color:#888;max-width:220px;">
            <button type="submit" class="btn-edit" style="font-size:0.72rem;padding:0.3rem 0.7rem;"><%= r.cover_image ? 'Replace cover' : 'Add cover' %></button>
          </form>
          <% }) %>
```

Note this upload form is a sibling of the row `<div>`, not nested inside it — the row div already closed on the line above (`</div>` after the `🗑` form). `margin-left: 2.85rem` roughly aligns it under the title column (past the vote-count and cover columns) without needing a new flex wrapper around the whole row.

- [ ] **Step 2: Add the `request_image` toast key to both objects**

In `views/admin.ejs`, find the `msgTabMap` line:

```js
    request_approved:'games', request_rejected:'games', request_stocked:'games', request_deleted:'games'
```

Replace with:

```js
    request_approved:'games', request_rejected:'games', request_stocked:'games', request_deleted:'games', request_image:'games'
```

Find, in the `messages` object on the next block, this exact fragment:

```
request_stocked:'📦 Marked as stocked!', request_deleted:'🗑 Request deleted.'
```

Replace with:

```
request_stocked:'📦 Marked as stocked!', request_deleted:'🗑 Request deleted.', request_image:'🖼️ Cover image saved!'
```

- [ ] **Step 3: Verify the EJS compiles**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8')); console.log('ADMIN_OK')"
```

Expected: `ADMIN_OK`

- [ ] **Step 4: Verify the toast key landed in both objects**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -oE "request_image" views/admin.ejs | wc -l
```

Expected: `2` (one in `msgTabMap`, one in `messages` — not a line count, an occurrence count, since both could theoretically land on one line)

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add views/admin.ejs
git commit -m "Add cover-image thumbnail and upload control to admin Game Requests"
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
for i in $(seq 1 15); do
  body=$(curl -s "https://playstation-hub.com/requests")
  if echo "$body" | grep -q "req-cover"; then echo "attempt $i: new build live"; break; fi
  echo "attempt $i: still old"; sleep 15
done
```

Polls for the new CSS class specifically, since a bare `/` 200 can be a stale response mid-rollover.

- [ ] **Step 3: Verify the public board with the Browser tool**

Navigate to `https://playstation-hub.com/requests`.

1. Every existing request row shows either a placeholder (dashed box, 🎮) or a real cover — none show a broken image or a missing/collapsed cell.
2. Zero console errors.
3. Resize to 390×844. Confirm the thumbnail shrinks to 32×48 and rows stay readable — no overlap with the title or vote form.

- [ ] **Step 4: Verify Coming-Soon auto-inherit**

1. In the Browser tool, find a title currently in your Coming Soon list (check `/browse` or ask the site for one via `/admin?tab=games` → Upcoming section) that is **not** already a pending/approved/stocked request. Note its exact title and cover.
2. On `/requests`, submit that exact title with a test Facebook name (e.g. `Cover Inherit Test`).
3. In `/admin?tab=games`, expand Game Requests. Confirm the new pending row already shows the Coming Soon game's cover — no upload happened, so this proves the auto-inherit path fired.
4. Delete this test entry via its 🗑 button.

- [ ] **Step 5: Verify manual upload**

1. Submit a genuinely new test title (e.g. `Cover Upload Test 0822`) with a test Facebook name.
2. In admin, find the new pending row — confirm it shows the placeholder, not a cover (this title matches nothing in the catalogue).
3. Use the "Add cover" file input to upload any small test image. Confirm the toast "🖼️ Cover image saved!" appears and the row now shows the uploaded image.
4. Approve the request. Reload `/requests` and confirm the cover appears there too.
5. Delete this test entry from admin afterward.

- [ ] **Step 6: Verify stock-time auto-inherit**

1. Submit one more test title (e.g. `Cover Stock Test 0822`).
2. Approve it in admin.
3. Find an existing game in your catalogue (any one with a cover_image) and note its `game_id` — the simplest way is to check its edit page URL or ask the admin games list for its numeric id.
4. There is currently no UI field to enter `game_id` when clicking "Mark stocked" (the existing form posts no `game_id`), so this step must be done directly:
   ```bash
   curl -s -X POST "https://playstation-hub.com/admin/requests/cover-stock-test-0822/stock" \
     -H "Cookie: <admin session cookie from the browser>" \
     --data-urlencode "game_id=<the numeric id from step 3>"
   ```
   (Copy the admin session cookie from the Browser tool's active `/admin` tab.)
5. Reload `/requests` (or the admin list) and confirm the request now shows the linked game's cover, with no manual upload.
6. Delete this test entry.

- [ ] **Step 7: Confirm no-overwrite behavior**

Using the manual-upload test entry from Step 5 (if not yet deleted — otherwise repeat steps 5.1–5.3 quickly): after it already has an uploaded cover, mark it stocked and link it to a game with a *different* cover. Confirm the request still shows the manually uploaded cover, not the linked game's — proving stock-time inherit only fills an empty `cover_image`, never overwrites one already set.

- [ ] **Step 8: Report to the user**

Confirm the feature is live, summarize what each of the three sources looked like in practice, and note that the four originally-live requests (Persona 3 Reloaded, Sudden Strike 4, Call of Duty Modern Warfare 2, Beast of Reincarnation) still have no cover unless one was added during this verification pass — they're reachable via the same "Add cover" control whenever the owner chooses.
