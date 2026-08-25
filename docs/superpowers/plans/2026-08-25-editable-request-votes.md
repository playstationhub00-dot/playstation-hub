# Editable Request Votes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin panel's game-request rows let the owner rename or remove an individual voter, so a vote cast under a fake name becomes either usable or gone.

**Architecture:** Two new functions in `lib/requests.js` that address a voter by their `at` timestamp (never by array index), two `requireAuth` routes in `server.js` that call them, and an editable voter list in the admin Games tab. The public board is untouched — it re-reads `voters`, so corrected names appear there for free.

**Tech Stack:** Node/Express, MongoDB (`game_requests` collection), EJS. No new dependencies.

## Global Constraints

- Files touched: `lib/requests.js`, `server.js`, `views/partials/admin/games.ejs`, `views/admin.ejs`. Nothing else.
- A voter is always identified by their `at` timestamp, never by array index — index is racy against a concurrent customer vote.
- A rename sets **only** `fb_name`. `session_id` and `at` must survive untouched, because `_hasVoted()` dedups on `session_id` OR name; clearing it would let a renamed voter vote twice.
- Renaming to a name already present on that same request is refused, case-insensitively.
- A blank or whitespace-only name is refused.
- Both new routes are `requireAuth`, matching every existing `/admin/requests/*` route.
- No vote counter is introduced anywhere — the count stays `voters.length` at every read site.
- `views/requests.ejs` is not edited.

---

### Task 1: Add rename and remove to the data layer

**Files:**
- Modify: `lib/requests.js` (add two functions before `async function remove(slug)`, and extend `module.exports`)

**Interfaces:**
- Consumes: the existing `_col()` helper and the `voters` array shape `{ fb_name, session_id, at }`.
- Produces: `renameVoter(slug, at, newName)` and `removeVoter(slug, at)`, both returning `{ ok: true }` or `{ ok: false, reason }` where reason is one of `'no_db' | 'not_found' | 'no_voter' | 'empty' | 'duplicate'`. Task 2's routes map these reasons to redirect messages.

- [ ] **Step 1: Add the two functions**

In `lib/requests.js`, insert immediately before `async function remove(slug) {`:

```js
// Renames one voter in place, identified by their `at` timestamp rather than
// their position — a customer voting between the admin's page load and submit
// would shift every index and the edit would land on the wrong person.
//
// Only fb_name is written. session_id is deliberately left alone: _hasVoted()
// dedups on session_id OR name, so clearing it would let a renamed voter cast a
// second vote.
async function renameVoter(slug, at, newName) {
  const col = await _col();
  if (!col) return { ok: false, reason: 'no_db' };
  const name = String(newName || '').trim();
  if (!name) return { ok: false, reason: 'empty' };
  const doc = await col.findOne({ slug });
  if (!doc) return { ok: false, reason: 'not_found' };

  const target = (doc.voters || []).find(v => v.at === at);
  if (!target) return { ok: false, reason: 'no_voter' };

  // Same one-vote-per-person rule addVote enforces, applied to the new name so a
  // rename can't merge two real voters into one inflated duplicate.
  const lower = name.toLowerCase();
  const clash = (doc.voters || []).some(v =>
    v.at !== at && String(v.fb_name || '').trim().toLowerCase() === lower
  );
  if (clash) return { ok: false, reason: 'duplicate' };

  const r = await col.updateOne(
    { slug },
    { $set: { 'voters.$[v].fb_name': name, updated_at: new Date().toISOString() } },
    { arrayFilters: [{ 'v.at': at }] }
  );
  return r.matchedCount > 0 ? { ok: true } : { ok: false, reason: 'not_found' };
}

// Drops one voter. The vote count is voters.length everywhere it is read, so the
// admin panel and the public board both decrement with no counter to update.
async function removeVoter(slug, at) {
  const col = await _col();
  if (!col) return { ok: false, reason: 'no_db' };
  const r = await col.updateOne(
    { slug },
    { $pull: { voters: { at } }, $set: { updated_at: new Date().toISOString() } }
  );
  return r.matchedCount > 0 ? { ok: true } : { ok: false, reason: 'not_found' };
}
```

- [ ] **Step 2: Export them**

In `lib/requests.js`, replace this line:

```js
  createRequest, addVote, setStatus, setCoverImage, remove
```

with:

```js
  createRequest, addVote, setStatus, setCoverImage, remove,
  renameVoter, removeVoter
```

- [ ] **Step 3: Verify the module loads and exports both functions**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const r = require('./lib/requests');
console.log('renameVoter is function:', typeof r.renameVoter === 'function');
console.log('removeVoter is function:', typeof r.removeVoter === 'function');
"
```

Expected: both `true`.

- [ ] **Step 4: Verify the guard clauses without a database**

`_col()` returns null when no DB is wired, so both functions must fail closed rather than throw:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const r = require('./lib/requests');
r.init(async () => null);
(async () => {
  console.log('rename no_db:', JSON.stringify(await r.renameVoter('x', 'y', 'Name')));
  console.log('rename empty:', JSON.stringify(await r.renameVoter('x', 'y', '   ')));
  console.log('remove no_db:', JSON.stringify(await r.removeVoter('x', 'y')));
})();
"
```

Expected: `rename no_db` is `{"ok":false,"reason":"no_db"}`, `rename empty` is `{"ok":false,"reason":"empty"}`, `remove no_db` is `{"ok":false,"reason":"no_db"}`.

Note the blank-name check runs before the DB lookup, so it reports `empty` even with no DB — that ordering is intentional and is what this step confirms.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add lib/requests.js
git commit -m "Add renameVoter and removeVoter to the game requests data layer"
```

---

### Task 2: Wire the routes and the admin UI

**Files:**
- Modify: `server.js` (add two routes after the `/admin/requests/:slug/image` handler)
- Modify: `views/partials/admin/games.ejs` (replace the read-only voter line)
- Modify: `views/admin.ejs` (add the new messages to the tab map and the toast map)

**Interfaces:**
- Consumes: `gameRequests.renameVoter` / `gameRequests.removeVoter` from Task 1, and the existing `requireAuth` middleware.
- Produces: nothing consumed by a later task — this plan has two tasks.

- [ ] **Step 1: Add the two routes**

In `server.js`, insert immediately after the closing `});` of the `app.post('/admin/requests/:slug/image', ...)` handler:

```js
// Voter-level edits. Customers type their own Facebook name, and some type junk
// ("1"), which both reaches the public board and makes that voter unmessageable
// when the game is stocked. Renaming beats deleting the whole request, which
// would take every legitimate vote with it.
app.post('/admin/requests/:slug/voter/rename', requireAuth, async (req, res) => {
  const r = await gameRequests.renameVoter(req.params.slug, req.body.at, req.body.fb_name);
  const msg = r.ok ? 'voter_renamed'
    : r.reason === 'duplicate' ? 'voter_dupe'
    : r.reason === 'empty' ? 'voter_empty'
    : 'voter_error';
  res.redirect('/admin?tab=games&msg=' + msg);
});

app.post('/admin/requests/:slug/voter/remove', requireAuth, async (req, res) => {
  const r = await gameRequests.removeVoter(req.params.slug, req.body.at);
  res.redirect('/admin?tab=games&msg=' + (r.ok ? 'voter_removed' : 'voter_error'));
});
```

- [ ] **Step 2: Replace the read-only voter line with an editable list**

In `views/partials/admin/games.ejs`, replace these three lines:

```html
              <div style="font-size:0.72rem;color:#666;margin-top:0.25rem;line-height:1.6;">
                <%= (r.voters || []).map(v => v.fb_name).join(', ') || 'no voters' %>
              </div>
```

with:

```html
              <div style="font-size:0.72rem;color:#666;margin-top:0.35rem;display:flex;flex-direction:column;gap:0.3rem;">
                <% if (!(r.voters || []).length) { %>no voters<% } %>
                <% (r.voters || []).forEach(v => { %>
                <div style="display:flex;gap:0.3rem;align-items:center;">
                  <form method="POST" action="/admin/requests/<%= r.slug %>/voter/rename" style="display:flex;gap:0.3rem;align-items:center;">
                    <input type="hidden" name="at" value="<%= v.at %>">
                    <input type="text" name="fb_name" value="<%= v.fb_name %>" style="font-size:0.72rem;background:#141414;border:1px solid #2a2a2a;color:#ccc;border-radius:6px;padding:0.25rem 0.4rem;max-width:160px;">
                    <button type="submit" class="btn-edit" style="font-size:0.68rem;padding:0.25rem 0.6rem;">Save</button>
                  </form>
                  <form method="POST" action="/admin/requests/<%= r.slug %>/voter/remove" style="display:inline" onsubmit="return confirm('Remove this vote?');">
                    <input type="hidden" name="at" value="<%= v.at %>">
                    <button type="submit" class="btn-delete" style="font-size:0.68rem;padding:0.25rem 0.5rem;">✕</button>
                  </form>
                </div>
                <% }) %>
              </div>
```

- [ ] **Step 3: Register the new messages on the Games tab**

In `views/admin.ejs`, replace this line:

```js
    request_approved:'games', request_rejected:'games', request_stocked:'games', request_deleted:'games', request_image:'games'
```

with:

```js
    request_approved:'games', request_rejected:'games', request_stocked:'games', request_deleted:'games', request_image:'games',
    voter_renamed:'games', voter_removed:'games', voter_dupe:'games', voter_empty:'games', voter_error:'games'
```

- [ ] **Step 4: Add the toast text**

In `views/admin.ejs`, inside the `const messages = { ... }` object literal, replace this fragment:

```js
request_image:'🖼️ Cover image saved!' };
```

with:

```js
request_image:'🖼️ Cover image saved!', voter_renamed:'✅ Voter name updated!', voter_removed:'🗑 Vote removed.', voter_dupe:'❌ That name has already voted for this game!', voter_empty:'❌ Voter name cannot be blank!', voter_error:'❌ Could not update that vote.' };
```

- [ ] **Step 5: Verify both templates compile and the routes are registered**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const ejs = require('ejs'), fs = require('fs');
for (const f of ['views/partials/admin/games.ejs', 'views/admin.ejs']) {
  try { ejs.compile(fs.readFileSync(f, 'utf8')); console.log(f, 'compiles: true'); }
  catch (e) { console.log('COMPILE ERROR in', f, e.message); process.exit(1); }
}
const src = fs.readFileSync('server.js', 'utf8');
console.log('rename route present:', src.includes(\"/admin/requests/:slug/voter/rename\"));
console.log('remove route present:', src.includes(\"/admin/requests/:slug/voter/remove\"));
"
```

Expected: both files compile, both routes `true`.

- [ ] **Step 6: Verify server.js parses**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node --check server.js && echo "server.js parses"
```

Expected: `server.js parses`.

- [ ] **Step 7: Commit and deploy**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add server.js views/partials/admin/games.ejs views/admin.ejs
git commit -m "Let admin rename or remove individual votes on a game request"
git push origin main
```

Poll for the new route, which only exists once the new build is running:

```bash
until curl -s -o /dev/null -w "%{http_code}" -X POST "https://playstation-hub.com/admin/requests/x/voter/remove" | grep -qv "404"; do sleep 15; done; echo "deployed"
```

An unauthenticated POST to the new route should return a redirect to the login page (302), not 404. A 404 means the old build is still running. If this has not flipped after several minutes, the Railway deploy is stuck rather than slow — report that rather than polling silently.

- [ ] **Step 8: Verify live in the admin panel**

Log in to `https://playstation-hub.com/admin`, open the Games tab, expand **Game Requests**, and confirm:

1. Each voter shows as a text input with a **Save** button and a **✕**, replacing the old comma-separated text.
2. Renaming Sudden Strike 4's `1` voter to a real name shows the "Voter name updated!" toast, and the input holds the new name after reload.
3. `/requests` then shows that name in place of `1` in the "requested by" line.
4. Renaming a voter to a name already voting on that same request shows "That name has already voted for this game!" and leaves both names unchanged.
5. Saving a blank name shows "Voter name cannot be blank!" and leaves the name unchanged.
6. Removing a voter shows "Vote removed.", drops the admin count by one, and drops the `/requests` count by one.
7. Zero console errors.

- [ ] **Step 9: Verify the dedup key survived the rename**

This is the constraint most likely to break silently. After renaming a voter, confirm that voter still cannot vote again from their original browser session — the rename must not have cleared `session_id`.

Read the renamed voter's document directly and confirm the fields:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "
const { MongoClient } = require('mongodb');
(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const doc = await c.db().collection('game_requests').findOne({ slug: 'sudden-strike-4' });
  console.log(JSON.stringify((doc && doc.voters) || [], null, 2));
  await c.close();
})();
"
```

Expected: the renamed voter shows the new `fb_name`, and still has its original `at` and a non-null `session_id` if it had one before. If `MONGODB_URI` is not set locally, skip this command and instead confirm in the browser that voting again from the same session is refused with "You've already voted for that one."

- [ ] **Step 10: Report**

Report the feature live, noting the rename path, the remove path, the duplicate and blank refusals, and that `session_id` survived a rename.
