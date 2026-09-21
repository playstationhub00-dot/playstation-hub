# Static Asset Caching — Design

**Date:** 2026-09-22
**Status:** Approved for implementation
**Scope:** Phase 1 of a performance effort. Phases 2 and 3 are deliberately deferred pending measured results from this phase.

## Goal

Stop re-sending assets that never change. Today every page load re-validates a
render-blocking 217 KB stylesheet and re-downloads every game cover, because
`express.static` serves everything with `Cache-Control: public, max-age=0`.

## Measured baseline

Taken 2026-09-22 against the live app. The custom domain was down at the time
(see "Blocking production issue"), so measurements used the Railway origin URL
`https://playstation-hub-production.up.railway.app`.

| Route | TTFB | HTML size |
|---|---|---|
| `/` | 0.31 s | 111 KB |
| `/browse` | 0.31 s | 145 KB |
| `/buy` | 0.32 s | 61 KB |
| `/ps-plus` | 0.30 s | 74 KB |
| `/requests` | 0.78 s | 38 KB |

Asset facts:

- `style.css` — 217 KB raw, 48 KB gzipped, served `Cache-Control: public, max-age=0`
- Homepage carries 28 KB of inline `<script>` and 14.6 KB of inline `<svg>`
- Homepage references 57 images, 42 already `loading="lazy"`
- Responses are already gzipped by Railway's edge (`Content-Encoding: gzip`)
- Game covers are already stored as `.webp` (`processUploadedImage`, server.js:324)

## The two facts this design rests on

**Uploads are content-stable.** `multer.diskStorage` names every upload
`Date.now() + ext` (server.js:295), and `processUploadedImage` converts to
`<same-timestamp>.webp`. Replacing a cover produces a *new* filename and the
record points at the new URL. A given `/uploads/*` URL's bytes therefore never
change, which makes an immutable year-long cache correct by construction rather
than by convention.

**Only `style.css` is version-busted.** `app.locals.assetV` (server.js:360) is
the stylesheet's mtime, and every view requests `/css/style.css?v=<%= assetV %>`.
Nothing else in `public/` carries `?v=` — `manifest.json`,
`admin-searchable-select.js`, `favicon.svg`, `logo.svg`, `logo-custom.png` and
`hero-bg-image.webp` are all requested at bare paths. A blanket long cache would
freeze those for a year, so caching must be conditional on the version marker.

## Design

### 1. Conditional caching for `public/`

`express.static` gains a `setHeaders` callback. A request carrying a `?v=` query
is deploy-busted and gets a permanent cache; anything else gets one hour.

```js
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_SHORT = 'public, max-age=3600';

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    // A ?v= URL changes on every deploy (see app.locals.assetV below), so it can
    // be cached permanently. A bare path cannot — caching an unversioned
    // favicon or hero image for a year would make swapping one invisible.
    res.setHeader('Cache-Control', hasVersionQuery(res.req) ? CACHE_IMMUTABLE : CACHE_SHORT);
  }
}));
```

`setHeaders` is the required hook rather than a preceding middleware: `send`
writes its own `Cache-Control` from its `maxAge` option and would overwrite a
header set earlier in the chain. `setHeaders` runs after that, so it wins.

`hasVersionQuery(req)` reads `req.query.v`. This was verified empirically against
Express 4 before accepting the design: inside `setHeaders`, `res.req` is
populated, `res.req.query.v` reads `123` for `/t.css?v=123` and `undefined` for
`/t.css`, and the two branches emit
`public, max-age=31536000, immutable` and `public, max-age=3600` respectively.
No URL-parsing fallback is needed.

### 2. Immutable caching for `/uploads`

```js
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res) => res.setHeader('Cache-Control', CACHE_IMMUTABLE)
}));
```

Unconditional, justified by the timestamped-filename guarantee above. This is the
largest bandwidth win in the phase — game covers dominate repeat-visit transfer.

The existing `/uploads/jpg/:name` route (server.js:386) sets its own
`max-age=86400` and is registered *before* this handler, so it is unaffected.

### 3. Version the one unversioned script

`views/*.ejs` requests `/js/admin-searchable-select.js` at a bare path. Change it
to `/js/admin-searchable-select.js?v=<%= assetV %>` so it qualifies for the
permanent cache. `assetV` is derived from `style.css`'s mtime, which changes on
every deploy, so the script is busted whenever the site is redeployed.

### 4. Audit `hero-bg-image.webp`

169 KB, above the fold on the homepage, render-critical. Confirm it is actually
referenced, then check whether it can be reduced at equal visual quality. Change
it **only** if the reduction is meaningful and produces no visible regression;
otherwise leave it and record the finding. This is an investigation, not a
committed change.

## Explicitly out of scope

Recorded so the reasoning survives, and so these are not silently revisited:

- **Minification.** CSS is 48 KB gzipped; minifying saves roughly 10 KB, and once
  cached for a year that becomes a one-time per-visitor cost. Not worth adding a
  build step or runtime dependency to a project that has neither.
- **`compression` middleware.** Railway's edge already gzips; adding origin-side
  compression burns CPU redoing finished work.
- **CDN, image compression, connection pooling.** Already in place — Cloudflare,
  `.webp` covers, and the MongoDB driver's default pool.
- **Load balancer, code splitting, re-render elimination, input debouncing.** Not
  applicable to a single-service, server-rendered EJS app with no client framework.
- **Server-side / query caching and pagination.** Real options, but they carry
  staleness and behaviour-change risk that this phase's risk budget excludes.
- **Inline JS extraction (Phase 2) and the `/requests` bottleneck (Phase 3).**
  Deferred by decision; see below.

## Deferred, with evidence already gathered

**Phase 2 — inline JS.** 28 KB of inline script ships with every page and can
never be cached. Extracting it would cut roughly 25% from every HTML response.
Deferred because many inline blocks read EJS-injected server values, so the
extraction must separate logic from bindings view by view.

**Phase 3 — `/requests` TTFB.** At 0.78 s it is 2.5× slower than any other public
page while being the smallest. It is the only public page that queries MongoDB.
`listByStatus` runs `find({ status: { $in: [...] } })` (lib/requests.js:70) and the
collection has an index on `slug` only (lib/requests.js:249) — no `status` index.
Adding one is cheap and safe, but the missing index is unlikely to explain the
full gap; MongoDB round-trip latency is the more probable cause, and confirming
that needs measurement against the production database.

## Testing

`scripts/test-static-caching.js` — a behavioural test, not a source-text guard.
It spawns the real server on a test port, issues real requests, asserts the
response headers, and shuts down.

| Request | Expected `Cache-Control` |
|---|---|
| `/css/style.css?v=123` | `public, max-age=31536000, immutable` |
| `/css/style.css` | `public, max-age=3600` |
| `/manifest.json` | `public, max-age=3600` |
| `/uploads/<temp file>` | `public, max-age=31536000, immutable` |

The `/uploads` case creates a throwaway file in `uploadsDir` and removes it
afterwards, so the test does not depend on production data being present.

The test must be proven non-vacuous: stash the change and confirm it fails
against the current code before accepting a pass.

## Verification

1. Run `scripts/test-static-caching.js`; prove it fails without the change.
2. Run the full `scripts/test-*.js` suite — no regressions.
3. Boot a scratch copy with `requireAuth` patched to `return next()` (test-only,
   never committed), seeded with fixture data, and confirm public **and admin**
   pages still render with styles intact.
4. Capture admin-page timings on that scratch server, to inform the Phase 2/3
   go/no-go decision.
5. Confirm deploy-busting still works: touch `style.css`, restart, verify
   `assetV` changes and the stylesheet URL changes with it.
6. After deploy, curl production headers to confirm the values are live.

## Risks

| Risk | Mitigation |
|---|---|
| An unversioned asset cached too long | One-hour ceiling for anything without `?v=` |
| `/uploads` immutability assumption breaks | Only holds while filenames stay timestamped; noted at both the multer config and the static handler |
| Two uploads in the same millisecond collide | Pre-existing, unchanged by this work; out of scope |

## Success criteria

- `/css/style.css?v=…` and `/uploads/*` return a one-year immutable cache
- Unversioned assets under `public/` return `max-age=3600`
- Repeat-visit transfer drops to essentially the HTML alone
- No visual regression on public or admin pages
- Full test suite green

## Blocking production issue (not part of this work)

`playstation-hub.com` returns 404 `Application not found` with
`x-railway-fallback: true`, while `playstation-hub-production.up.railway.app`
serves every route normally. The application is healthy; the **custom domain is
no longer bound to the Railway service**. DNS still resolves to Cloudflare
correctly, so the fault is on the Railway side — a detached domain, or a
plan/credit change that dropped custom domains.

This is unrelated to the performance work and cannot be fixed from the codebase.
It requires the owner to re-attach the domain in the Railway dashboard. Until it
is fixed, no customer can reach the site and performance work cannot be verified
on the real domain.
