# Static Asset Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `public/` and `/uploads` with real HTTP caching instead of `max-age=0`, so repeat visitors stop re-downloading a 217 KB stylesheet and every game cover on every page load.

**Architecture:** Two `express.static` registrations already exist in `server.js` (one for `public/`, one for `/uploads`). Both gain a `setHeaders` option that inspects the request/file and picks between two `Cache-Control` values — a permanent immutable cache for content that is provably stable, and a one-hour cache for everything that can change under the same URL. No new files, no new dependencies, no build step.

**Tech Stack:** Node.js, Express 4 (`express.static`, built on `serve-static`/`send`), plain `node` test scripts (no test framework — this project's existing convention, see `scripts/test-*.js`).

## Global Constraints

- Direct-on-main workflow, no worktree isolation (established practice in this repo).
- `server.js` is the only production file touched, plus one line in each of 6 view files that reference `admin-searchable-select.js`.
- No new npm dependencies.
- Tests are plain Node scripts run with `node scripts/test-*.js`, asserting with the built-in `assert` module and printing `ok - <description>` per assertion (see any existing `scripts/test-*.js` for the pattern).
- The four branding filenames (`favicon-custom<ext>`, `logo-custom<ext>`, `hero-bg-image<ext>`, `hero-bg-video<ext>`) must **never** receive the immutable cache — this is the one correctness-critical rule in this plan, caught and fixed during spec review.
- `CACHE_IMMUTABLE = 'public, max-age=31536000, immutable'` and `CACHE_SHORT = 'public, max-age=3600'` are the only two cache values used anywhere in this plan.
- Never log into the site's admin panel. Admin-page verification happens via a local scratch-copy server with `requireAuth` monkey-patched to `return next()` — test-only, never committed.

---

### Task 1: Cache headers for `public/` and `/uploads`, with the branding exception

**Files:**
- Modify: `server.js:354` (the `public/` static registration)
- Modify: `server.js:409` (the `/uploads` static registration)
- Test: `scripts/test-static-caching.js` (new)

**Interfaces:**
- Produces: two named constants `CACHE_IMMUTABLE` and `CACHE_SHORT`, and a regex `UNVERSIONED_UPLOAD_NAMES`, all defined once near the top of `server.js` alongside the other static-file setup (right before line 354), for later tasks and the test to reference by the same values.
- Consumes: nothing from other tasks — this is the only task.

This is the whole feature; it is one task because the two registrations are five lines apart, share the same two constants, and a reviewer cannot sensibly approve one half without the other (an immutable `/uploads` cache with no branding exception is a real regression, not a partial win).

- [ ] **Step 1: Write the failing test**

Create `scripts/test-static-caching.js`:

```js
// Run: node scripts/test-static-caching.js
//
// Behavioural test, not a source-text guard: spawns the real server on a
// throwaway port, makes real HTTP requests, and asserts the Cache-Control
// header Express actually sent. A source-text check could pass while the
// runtime behavior was wrong (e.g. a typo'd header name) — this can't.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4599;
const REPO_ROOT = path.join(__dirname, '..');

function get(pathAndQuery) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: pathAndQuery, timeout: 5000 }, (res) => {
      res.resume(); // discard body, we only need headers
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out: ' + pathAndQuery)); });
  });
}

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  // Throwaway fixtures inside the real uploads dir, so the real /uploads
  // static handler in server.js serves them. Named so they can't collide
  // with anything real, and removed in the finally block below.
  const uploadsDir = path.join(process.env.DATA_DIR || REPO_ROOT, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const timestampFile = path.join(uploadsDir, '9999999999999-castest.webp');
  const faviconFile = path.join(uploadsDir, 'favicon-custom.png');
  const logoFile = path.join(uploadsDir, 'logo-custom.png');
  const heroImgFile = path.join(uploadsDir, 'hero-bg-image.jpg');
  const heroVidFile = path.join(uploadsDir, 'hero-bg-video.mp4');
  const madeFiles = [timestampFile, faviconFile, logoFile, heroImgFile, heroVidFile];
  const preExisting = madeFiles.filter(fs.existsSync);
  for (const f of madeFiles) if (!fs.existsSync(f)) fs.writeFileSync(f, 'test fixture — safe to delete');

  process.env.PORT = String(PORT);
  const child = require('child_process').spawn(process.execPath, ['server.js'], {
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    // Wait for the server to actually accept connections rather than a fixed
    // sleep, which would be flaky on a slower machine.
    const deadline = Date.now() + 15000;
    let up = false;
    while (Date.now() < deadline) {
      try { await get('/manifest.json'); up = true; break; }
      catch { await new Promise(r => setTimeout(r, 200)); }
    }
    assert.ok(up, 'server did not come up within 15s — check stderr:\n' + (child.stderr.read() || ''));

    console.log('\npublic/ — cached only when the request carries the version query');

    await ok('a versioned stylesheet request is cached for a year, immutable', async () => {
      const res = await get('/css/style.css?v=123');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    });

    await ok('the same file with no version query gets only an hour', async () => {
      const res = await get('/css/style.css');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    await ok('an unrelated unversioned file (manifest.json) also gets an hour', async () => {
      const res = await get('/manifest.json');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    console.log('\n/uploads — cached for a year UNLESS the filename is one of the four branding names');

    await ok('a timestamp-named upload is cached for a year, immutable', async () => {
      const res = await get('/uploads/9999999999999-castest.webp');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    });

    await ok('favicon-custom.png (admin can overwrite this URL) gets only an hour', async () => {
      const res = await get('/uploads/favicon-custom.png');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    await ok('logo-custom.png (admin can overwrite this URL) gets only an hour', async () => {
      const res = await get('/uploads/logo-custom.png');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    await ok('hero-bg-image.jpg (admin can overwrite this URL) gets only an hour', async () => {
      const res = await get('/uploads/hero-bg-image.jpg');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    await ok('hero-bg-video.mp4 (admin can overwrite this URL) gets only an hour', async () => {
      const res = await get('/uploads/hero-bg-video.mp4');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    console.log('\n' + passed + ' assertions passed\n');
  } finally {
    child.kill();
    for (const f of madeFiles) {
      if (!preExisting.includes(f) && fs.existsSync(f)) fs.unlinkSync(f);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-static-caching.js`
Expected: FAIL — every assertion reports the actual header as `public, max-age=0` (or whatever the current default is), not the expected cached value. If the server fails to boot at all, check `MONGO_URL`/`DATA_DIR` env requirements match what a normal local boot needs (see `scripts/test-order-reserve-promo.js` and other existing scripts for this project's local-boot conventions) — the test must reach a real listening server, not merely exit cleanly.

- [ ] **Step 3: Implement the cache headers**

In `server.js`, immediately before line 354 (`app.use(express.static(path.join(__dirname, 'public')));`), add:

```js
// Two cache lifetimes used across every static registration below.
// Immutable is safe only for URLs that are provably unique to their content
// (a version query, or a Date.now()-stamped filename) — see the comments at
// each call site for why a given path qualifies.
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_SHORT = 'public, max-age=3600';
```

Replace line 354:

```js
app.use(express.static(path.join(__dirname, 'public')));
```

with:

```js
// A request carrying ?v=<assetV> (see app.locals.assetV just below) is
// deploy-busted — the URL itself changes on every deploy, so it is safe to
// cache forever. A bare path is not: manifest.json, favicon.svg and the
// default hero-bg-image.webp are all requested unversioned, so caching them
// for a year would hide a real change (e.g. swapping the hero image) from
// returning visitors for up to a year. One hour bounds that instead.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    const hasVersion = !!(res.req && res.req.query && res.req.query.v);
    res.setHeader('Cache-Control', hasVersion ? CACHE_IMMUTABLE : CACHE_SHORT);
  }
}));
```

Replace line 409:

```js
app.use('/uploads', express.static(uploadsDir));
```

with:

```js
// Every /uploads file EXCEPT these four fixed names is written by multer
// with a Date.now()+ext filename (see the diskStorage config above), so its
// URL changes whenever its content does — safe to cache forever. These four
// are the exception: POST /admin/site-settings (server.js, search
// "Handle favicon upload") overwrites them in place under the SAME filename
// every time an admin updates branding, so the URL a browser already cached
// would silently go stale for up to a year if these got the long cache too.
const UNVERSIONED_UPLOAD_NAMES = /^(favicon-custom|logo-custom|hero-bg-image|hero-bg-video)\./;
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    const isBranding = UNVERSIONED_UPLOAD_NAMES.test(path.basename(filePath));
    res.setHeader('Cache-Control', isBranding ? CACHE_SHORT : CACHE_IMMUTABLE);
  }
}));
```

Note: `path` is already required at the top of `server.js` (it's used throughout the file, including two lines above this edit at line 407-408) — no new `require` needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-static-caching.js`
Expected: PASS — all 8 assertions print `ok -`.

- [ ] **Step 5: Run the full existing test suite to confirm no regression**

Run each `node scripts/test-*.js` in `scripts/` (or loop over them). Every one must still pass — this change touches shared middleware registration order, so a broken static-file resolution would show up as failures in unrelated tests that happen to boot the server.

Expected: PASS on every existing script, in addition to the new one.

- [ ] **Step 6: Commit**

```bash
git add server.js scripts/test-static-caching.js
git commit -m "$(cat <<'EOF'
Cache static assets: immutable for versioned/timestamped, 1hr otherwise

express.static served everything with Cache-Control: public, max-age=0,
so every page load re-validated a 217 KB stylesheet and re-downloaded
every game cover. Both registrations now set real cache lifetimes:

- public/: a year, immutable, only when the request carries ?v=<assetV>
  (every view already appends this to style.css); one hour otherwise, so
  an unversioned favicon/manifest/hero-image change still shows up within
  an hour.
- /uploads: a year, immutable, for every Date.now()-named upload (game
  covers, order photos, hero slides) since that filename can never point
  at different content. The four fixed-name branding files that
  POST /admin/site-settings overwrites in place
  (favicon-custom/logo-custom/hero-bg-image/hero-bg-video) are excluded
  and kept at one hour, since their URL does NOT change when an admin
  replaces them — this was caught and fixed during spec review, before
  any code was written.

Verified with a new behavioural test that boots the real server and
asserts the actual Cache-Control header on 8 real requests, including
each of the four branding-file exceptions.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Version `admin-searchable-select.js` so it qualifies for the long cache

**Files:**
- Modify: `views/admin.ejs:472`
- Modify: `views/edit-customer.ejs:284`
- Modify: `views/edit-psplus-popular.ejs:110`
- Modify: `views/edit-psplus.ejs:70`
- Modify: `views/edit-upcoming.ejs:148`
- Modify: `views/edit.ejs:254`
- Test: extend `scripts/test-static-caching.js` from Task 1

**Interfaces:**
- Consumes: `CACHE_IMMUTABLE`/`CACHE_SHORT` behavior from Task 1 (already live — this task only changes which cache tier a URL falls into, not the mechanism).
- Produces: nothing further downstream.

This is its own task because it touches six view files (a different surface than Task 1's `server.js`-only change) and is independently reviewable — a reviewer could approve Task 1's header logic while catching a typo'd path in this one.

- [ ] **Step 1: Write the failing test**

Add to the bottom of `scripts/test-static-caching.js`, inside `main()`, right after the existing `/uploads` block and before the `console.log('\n' + passed ...)` line:

```js
    console.log('\npublic/js — now requested with a version query, same as style.css');

    await ok('admin-searchable-select.js is requested with ?v= in views/admin.ejs', async () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, 'views', 'admin.ejs'), 'utf8');
      assert.ok(
        /admin-searchable-select\.js\?v=<%=\s*assetV\s*%>/.test(src),
        'admin.ejs still requests the script at a bare, unversioned path'
      );
    });

    await ok('the versioned script URL is cached for a year, immutable', async () => {
      const res = await get('/js/admin-searchable-select.js?v=123');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-static-caching.js`
Expected: FAIL on the new `admin.ejs still requests the script at a bare, unversioned path` assertion (the file still has no `?v=`). The second new assertion will actually pass even before this task's fix, since Task 1 already makes `?v=`-bearing requests to any `public/` file immutable regardless of which file it is — that assertion exists to confirm the *view* is the thing this task changes, not the caching mechanism.

- [ ] **Step 3: Update the six view files**

In each of the six files, change:

```html
<script src="/js/admin-searchable-select.js"></script>
```

to:

```html
<script src="/js/admin-searchable-select.js?v=<%= assetV %>"></script>
```

`assetV` is already an `app.locals` value (set in Task 1's edit, just above the `public/` static registration), so it is available in every view with no route changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-static-caching.js`
Expected: PASS — all 10 assertions (8 from Task 1 + 2 new).

- [ ] **Step 5: Run the full existing test suite**

Run each `node scripts/test-*.js`. Expected: PASS on every script, no regressions — in particular any test that renders `admin.ejs` or the five `edit-*.ejs` views should still succeed, confirming the template change didn't break EJS syntax.

- [ ] **Step 6: Commit**

```bash
git add views/admin.ejs views/edit-customer.ejs views/edit-psplus-popular.ejs views/edit-psplus.ejs views/edit-upcoming.ejs views/edit.ejs scripts/test-static-caching.js
git commit -m "$(cat <<'EOF'
Version admin-searchable-select.js so it gets the long cache too

Task 1 made public/ cache for a year whenever a request carries ?v=, but
this was the one file in public/ still requested at a bare path — so it
was falling into the 1-hour tier for no reason, on every admin page that
uses the searchable-select widget. Appends ?v=<%= assetV %>, the same
marker style.css already uses, so it's busted on every deploy exactly
like the stylesheet is.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Audit `hero-bg-image.webp`, and full verification pass

**Files:**
- Investigate: `public/hero-bg-image.webp` (no modification unless a safe reduction is found)
- No new test file — this task is verification, not new behavior

**Interfaces:**
- Consumes: the completed caching behavior from Tasks 1 and 2 (this task verifies the whole feature end-to-end).
- Produces: nothing further — this is the plan's final task.

This is a separate task from Tasks 1-2 because it's investigation-and-verification rather than a code change with its own pass/fail test, and per the spec ("change it only if... otherwise leave it and record the finding") it may end with no diff at all — that's a valid outcome, not an incomplete task.

- [ ] **Step 1: Check the hero image's real dimensions and quality vs. its rendered size**

```bash
node -e "
const sharp = require('sharp');
sharp('public/hero-bg-image.webp').metadata().then(m => {
  console.log('dimensions:', m.width + 'x' + m.height);
  console.log('format:', m.format);
  console.log('size on disk:', require('fs').statSync('public/hero-bg-image.webp').size, 'bytes');
});
"
```

`sharp` is already a project dependency (see `package.json`), no install needed.

- [ ] **Step 2: Compare against how it's actually displayed**

It's rendered as a full-bleed `background-image` with `background-size: cover` (`views/index.ejs:142`). If the file's pixel dimensions are meaningfully larger than any realistic viewport needs (e.g. well above ~2560px wide, which covers the vast majority of desktop displays at 1x and typical laptop displays at 2x), it is being shipped larger than it can ever usefully render.

- [ ] **Step 3: Decide**

- If the dimensions are already reasonable for a full-bleed hero (roughly 1920–2560px on the long edge) and the quality setting looks close to what `processUploadedImage` already uses elsewhere (quality 82, per server.js:330) — leave it. Record in the commit message for this task (or a follow-up note if no commit results) that it was checked and found already appropriately sized.
- If it is meaningfully oversized (e.g. a 4K+ source saved uncompressed), re-encode it with `sharp` at the same quality convention the rest of the codebase uses (quality 82, matching `processUploadedImage`) and at a capped width around 2560px:

```bash
node -e "
const sharp = require('sharp');
sharp('public/hero-bg-image.webp')
  .resize({ width: 2560, withoutEnlargement: true })
  .webp({ quality: 82 })
  .toFile('public/hero-bg-image.new.webp')
  .then(() => console.log('done — compare sizes and open both in a browser before replacing the original'));
"
```

Then visually compare `public/hero-bg-image.webp` and `public/hero-bg-image.new.webp` at full width before deciding whether to replace the original. If replaced, delete the `.new.webp` temp file after copying it over the original.

- [ ] **Step 4: Full verification pass**

Run in order:

1. `node scripts/test-static-caching.js` — expect all assertions to pass.
2. Every `node scripts/test-*.js` in the repo — expect no regressions.
3. Boot check: `PORT=4598 node server.js` locally, confirm it starts cleanly with no uncaught exceptions in the first 15 seconds, then stop it.
4. Copy the repo to the scratch directory, patch `requireAuth` to `return next()` in the copy only (never in the real repo, never committed), seed minimal fixture data if the existing project scripts don't already provide a seeded copy, boot the scratch copy, and using the browser tools:
   - Load the public homepage — confirm styles render correctly and the hero background displays.
   - Load `/browse` and `/buy` — confirm cover images display.
   - Load `/admin` (on the patched scratch copy only) and one page using the searchable-select widget (e.g. edit a customer) — confirm the widget still functions (type to filter, select an option).
   - Check response headers via the browser's network panel or `read_network_requests` for `/css/style.css`, a game cover under `/uploads`, and `/js/admin-searchable-select.js` — confirm each carries the expected `Cache-Control` value from the table in the spec.
5. Confirm deploy-busting still works: touch `public/css/style.css` (e.g. append a comment), restart the scratch server, confirm `assetV` (visible in the stylesheet `<link>` URL's `?v=` value, via page source or `read_page`) changed to a new value.

- [ ] **Step 5: Commit (only if Step 3 produced a file change)**

```bash
git add public/hero-bg-image.webp
git commit -m "$(cat <<'EOF'
Re-encode hero-bg-image.webp at a size that matches how it's displayed

Audited as part of the static-asset-caching work: <fill in the actual
before/after dimensions and file sizes found in Step 1-3>. Re-encoded at
2560px wide / quality 82, matching the compression convention
processUploadedImage() already uses for every other cover on the site.
No visual change at the sizes the page actually renders it — verified
side by side before replacing the original.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

If Step 3 concluded no change was warranted, skip this step — there is nothing to commit, and that is a complete, successful outcome for this task.

- [ ] **Step 6: Report findings for the Phase 2/3 go/no-go**

Summarize, for the human partner:
- The admin-page timings captured during Step 4's scratch-server pass.
- Whether the hero image was changed, and by how much if so.
- That this closes Phase 1 of the spec's three-phase plan, and Phases 2 (inline JS extraction) and 3 (`/requests` TTFB) remain deferred pending a decision to proceed.

---

## Deploy Note

This plan's changes are safe to deploy the same way prior work in this session was deployed: commit, push, then verify the live `Cache-Control` headers with `curl -I` against both `playstation-hub.com` and `playstation-hub-production.up.railway.app` once the custom-domain issue noted in the spec is resolved. Until that domain issue is fixed, verify against the `.up.railway.app` origin only, exactly as this plan's own investigation did.
