# Order Routes Error Handling — Design

**Date:** 2026-09-22
**Status:** Approved for implementation
**Scope:** Fixes the finding flagged during the `/requests` TTFB investigation (`docs/superpowers/specs/2026-09-22-requests-page-ttfb-design.md`): 19 `orders.getByRef`/`orders.create` call sites across `server.js` with no error handling.

## Goal

If any of these 19 calls throws — a genuine MongoDB hiccup, not a "not found" (which they already handle) — the request hangs forever with no response. This is the same bug class already found and fixed once this session (the `promo` variable in `/order/reserve`). Fix all 19 at once, consistently.

## What's actually there

19 call sites map to 18 distinct routes (`/order/:ref/review` has two unguarded calls in one handler):

- **8 public customer routes**: order status page, payment-proof upload, priority upgrade, review, pay, QR upload, sign-in code, return-proof upload
- **1 webhook**: `/webhooks/paymongo`
- **9 admin routes** (`requireAuth`): quick-add, create-manual, payment-link, advance, reject, mark-paid, priority-paid, undo-priority, cancel

Every one of the 18 route declarations ends its argument list the same way —
`..., async (req, res) => { ... }` — confirmed by reading each declaration
directly, not assumed.

## The actual mechanism (why this is worth fixing this way, not ad hoc)

Express 4 does not catch a rejected promise thrown inside an `async` route
handler. `server.js` already has both halves of the *general* safety net:

- An error-handling middleware at `server.js:6819` that logs and responds —
  either a redirect (for known multer file errors) or
  `res.status(500).send('Something went wrong. Please try again.')` — but
  only for errors that actually reach it via `next(err)`.
- A `process.on('unhandledRejection', ...)` handler (documented at
  `server.js:6843`) that keeps the *site* alive by not crashing the process,
  but explicitly does nothing for the *individual request* that threw — it
  only logs.

The gap is entirely in the middle: these 19 calls throw, nothing calls
`next(err)`, so the existing error middleware never fires and the request
just hangs. No new error-handling machinery is needed — only routing these
19 rejections into what already exists.

## Design

### A small wrapper, applied to all 18 routes

```js
// Express 4 does not catch a rejected promise inside an async route handler
// — it just hangs, since nothing ever calls next(err). This routes any such
// rejection into the existing error middleware below instead.
function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
```

Applied by wrapping only the final handler argument, leaving any preceding
middleware (`requireAuth`, `uploadOrderFile.single(...)`,
`express.urlencoded(...)`) untouched:

```js
app.get('/order/:ref', asyncRoute(async (req, res) => { ... }));
app.post('/order/:ref/payment-proof', uploadOrderFile.single('proof'), asyncRoute(async (req, res) => { ... }));
app.post('/admin/orders/:ref/advance', requireAuth, asyncRoute(async (req, res) => { ... }));
```

No changes to the existing error middleware at `server.js:6819` — verified
below that its current behavior is safe for every one of these 19 routes as
they're actually used today.

### Fail loud, not silently — confirmed, not just asserted

A payment upload, an admin state transition, or a webhook event must never
silently no-op. This design doesn't add any new fallback logic per route —
it relies entirely on the existing middleware's `500` response (or its
redirect for known upload errors), which is already a visible failure, never
a silent one.

### Verified: the existing plain-text/HTML `500` response is safe for every one of these 19 routes' real clients

Three of the nine admin routes (`payment-link`, `quick-add`, `create-manual`)
return JSON on success. A generic HTML `500` body could, in principle, break
a client that unconditionally calls `r.json()` on the response — checked
directly rather than assumed:

- `views/partials/admin/quick-add.ejs:482-515` — calls `r.json()`
  unconditionally, but the whole chain is wrapped in a `.catch()`
  (line 511) that degrades to a plain "Something went wrong" message. Safe.
- `views/partials/order-queue.ejs:543-582` — same shape, same outer
  `.catch()` (line 578) covering the JSON-parse failure. Safe.
- `create-manual` has no client-side caller anywhere in `views/` — grepped
  the whole tree, found only the server-side route definition itself. Not a
  live client-facing risk today.

The six redirect-style admin routes (`advance`, `reject`, `mark-paid`,
`priority-paid`, `undo-priority`, `cancel`) and the eight public
form-submission routes are unaffected either way — a browser navigating to
whatever the server returns renders an HTML error page exactly as designed,
no JSON parsing involved.

The webhook is a special case worth naming: PayMongo (and payment gateways
generally) retry on a `5xx` response. A `500` from the wrapper is the
*correct* signal to send them, not a fallback to work around — this fix
makes a currently-silent hang into exactly the behavior a well-behaved
webhook handler should have had already.

## Explicitly out of scope

- **Making the shared error middleware JSON-aware for JSON-returning
  routes.** Checked and found unnecessary — every real client already
  degrades safely (see above). Doing this anyway would be solving a problem
  that doesn't exist for any route this fix touches.
- **Per-route custom error messages.** Rejected during brainstorming in
  favor of the uniform wrapper — confirmed as the chosen approach.
- **Any other unguarded async route in `server.js` outside these 19 sites.**
  This fixes exactly the finding that was flagged; a broader audit of the
  whole file is a separate, larger effort not asked for here.
- **`orders.noteWebhook(false).catch(() => {})`-style calls already
  deliberately swallowed** in the webhook handler (`server.js:3207, 3210`) —
  those are intentional non-fatal telemetry, not part of this fix.

## Testing

Two complementary checks, reusing exactly the two testing idioms already
established in this project rather than inventing a third:

**1. Source-level guard** (`scripts/test-order-routes-wrapped.js`), the same
pattern `scripts/test-order-reserve-promo.js` already uses for "is this
declared correctly" — for each of the 18 route declarations, confirms the
final handler argument is wrapped in `asyncRoute(...)`, matched on the
actual code pattern (not a bare substring that could false-positive on a
comment).

**2. One real behavioral check** (extends
`scripts/test-static-caching.js`'s pattern of booting the real server and
making real requests): boot the server, monkey-patch `orders.getByRef` to
throw for one specific ref, hit one real route end-to-end, and confirm it
returns a real HTTP response within a bounded time — not a hang. This
proves the wrapper mechanism itself works for at least one representative
case; the source-level check proves all 18 routes actually use it.

## Verification

1. Run both new tests; prove each fails against the pre-fix code.
2. Run the full `scripts/test-*.js` suite — no regressions.
3. Local boot check — no `MONGODB_URI` locally means these routes' Mongo
   calls already resolve to `null`/empty today rather than throwing, so the
   wrapper changes nothing observable about local dev; confirm the server
   still boots and these routes still respond normally.
4. Deploy, then confirm via curl that a normal request to a few of these
   routes (that don't require real order data or an admin login) still
   behaves identically — this fix must be invisible on the happy path.

## Risks

| Risk | Mitigation |
|---|---|
| A JSON-consuming admin client breaks on the generic HTML error body | Checked directly: both live fetch-based callers already have an outer `.catch()` that degrades safely; the third route has no live client |
| The wrapper changes behavior on the happy path | It only affects what happens when the wrapped function *rejects* — a resolving handler runs exactly as before |
| Missed a 20th unguarded site | The 19 sites are the exact list already enumerated and verified via `grep` in the prior investigation; this spec fixes precisely that list |

## Success criteria

- All 18 route declarations wrap their final handler in `asyncRoute(...)`
- A thrown error in any of these routes now produces a real, visible HTTP
  response (matching the existing error middleware's established behavior)
  instead of hanging
- No behavior change on any successful request
- Full test suite green, including the two new tests
