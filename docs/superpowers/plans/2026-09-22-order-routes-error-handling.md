# Order Routes Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap all 18 order-route handlers that call `orders.getByRef`/`orders.create` with no error handling, so a thrown MongoDB error produces a real HTTP response instead of hanging the request forever.

**Architecture:** A small `asyncRoute(fn)` helper routes a rejected promise from an async Express handler into `next(err)`, which the app's existing error middleware (`server.js:6819`, unchanged by this plan) already turns into a visible response. Applied by wrapping only the final handler argument of each of the 18 route declarations, verified with a scripted, deterministic transformation rather than 18 hand-edited call sites.

**Tech Stack:** Node.js, Express 4, plain `node` test scripts with `assert` (this project's convention).

## Global Constraints

- Direct-on-main workflow, no worktree isolation (established practice in this repo).
- Exactly these 18 route declarations are touched — the same 18 the approved spec (`docs/superpowers/specs/2026-09-22-order-routes-error-handling-design.md`) lists. No other route in `server.js` is touched, including the 4 additional `/admin/orders/:ref/*` routes found while preparing this plan (`refunded`, `sync-end-date`, `fix-purchase`, `delete`) — those call different functions (`markRefunded`, `setRentalWindow`, `repairPurchase`, and a delete handler), not `getByRef`/`create`, and are explicitly out of this spec's scope. Report them as a new finding once this plan is done, exactly as `/requests`'s TTFB fix reported this list in the first place.
- No changes to the existing error middleware at `server.js:6819` — the spec verified its current behavior is safe for all 18 routes' real clients.
- `server.js` uses a UTF-8 BOM and CRLF line endings — verified directly (`buf.slice(0,3)` is `ef bb bf`, and the body contains `\r\n`). Any script that rewrites the file must preserve both, or introduce a large, unrelated line-ending diff across the whole file.
- Never log into the site's admin panel. This plan's behavioral test uses a public, unauthenticated route (`GET /order/:ref`) specifically so it never needs one.

---

### Task 1: Add `asyncRoute`, wrap all 18 routes, source-level test

**Files:**
- Modify: `server.js` (add the helper near the top; wrap all 18 route declarations via the script in Step 3)
- Test: `scripts/test-order-routes-wrapped.js` (new)

**Interfaces:**
- Produces: `asyncRoute(fn)` — a function taking an Express async handler `(req, res, next) => Promise`, returning a standard Express handler `(req, res, next) => void` that routes any rejection to `next(err)`. Available at module scope in `server.js`, used identically at all 18 call sites.
- Consumes: nothing from other tasks — this is the only task.

This is one task, not 18, because the transformation is a single atomic, scripted, all-or-nothing operation (the script in Step 3 either wraps all 18 correctly or throws before writing anything) — there is no meaningful partial state to review between routes.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-order-routes-wrapped.js`:

```js
// Run: node scripts/test-order-routes-wrapped.js
//
// Source-level guard, the same pattern scripts/test-order-reserve-promo.js
// already uses: confirms each of the 18 routes flagged in
// docs/superpowers/specs/2026-09-22-order-routes-error-handling-design.md
// actually wraps its handler in asyncRoute(...), matched against the real
// wrapped code shape rather than a bare substring that could false-pass on
// an unrelated comment.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// The exact 18 route-opening lines this fix targets, in their wrapped form.
// Kept as a flat list (not derived from anything else) so this test can
// never accidentally agree with a bug in the code it's checking.
const wrappedRoutes = [
  `app.get('/order/:ref', asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/payment-proof', uploadOrderFile.single('proof'), asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/upgrade-priority', asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/review', asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/pay', asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/payment-link', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/quick-add', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/create-manual', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/webhooks/paymongo', asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/qr', uploadOrderFile.single('qr'), asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/signin-code', express.urlencoded({ extended: false }), asyncRoute(async (req, res) => {`,
  `app.post('/order/:ref/return-proof', uploadOrderFile.single('proof'), asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/advance', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/reject', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/mark-paid', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/priority-paid', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/undo-priority', requireAuth, asyncRoute(async (req, res) => {`,
  `app.post('/admin/orders/:ref/cancel', requireAuth, asyncRoute(async (req, res) => {`,
];

console.log('\nasyncRoute() helper');

ok('server.js defines asyncRoute', () => {
  assert.ok(/function asyncRoute\(fn\)/.test(src), 'no `function asyncRoute(fn)` found in server.js');
});

console.log('\nall 18 order routes are wrapped');

for (const line of wrappedRoutes) {
  ok('wrapped: ' + line.slice(0, 60) + (line.length > 60 ? '…' : ''), () => {
    assert.ok(src.includes(line), 'expected this exact wrapped line in server.js:\n' + line);
  });
}

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-order-routes-wrapped.js`
Expected: FAIL — the `asyncRoute` assertion fails first (the helper doesn't exist yet), before any of the 18 wrapped-line assertions even run.

- [ ] **Step 3: Add the helper**

In `server.js`, immediately after the line `const PORT = process.env.PORT || 3000;`, add:

```js

// Express 4 does not catch a rejected promise inside an async route handler
// — it just hangs, since nothing ever calls next(err). This routes any such
// rejection into the existing error middleware below instead. See
// docs/superpowers/specs/2026-09-22-order-routes-error-handling-design.md.
function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
```

(If Task work from an earlier phase already added other lines directly after `const PORT = ...` — e.g. the `_mongo`/`_getMongoDb` wiring from the `/requests` TTFB fix — add this block immediately after that existing block instead, not in between it and `const PORT`. Where exactly this lands among other top-level declarations doesn't matter; it only needs to be defined before line ~2345, its first use, which every placement at the top of the file satisfies.)

- [ ] **Step 4: Wrap all 18 routes with a verified, scripted transformation**

Manually editing 18 structurally-identical call sites risks a mismatched
brace on at least one of them. Instead, save this script to the project's
scratchpad directory as `wrap-routes.js` and run it once against `server.js`
directly. It was verified against a full copy of the real file before being
included in this plan: it produced exactly 18 wraps, a clean `node -c`
syntax check, and a diff of exactly 36 changed lines (18 routes × 2 lines
each) with no other changes.

```js
const fs = require('fs');
const path = process.argv[2] || 'server.js';
const raw = fs.readFileSync(path, 'utf8');
const hasBOM = raw.charCodeAt(0) === 0xFEFF;
const body = hasBOM ? raw.slice(1) : raw;
const usesCRLF = body.includes('\r\n');
const lines = body.split(usesCRLF ? '\r\n' : '\n');

const targets = [
  `app.get('/order/:ref', async (req, res) => {`,
  `app.post('/order/:ref/payment-proof', uploadOrderFile.single('proof'), async (req, res) => {`,
  `app.post('/order/:ref/upgrade-priority', async (req, res) => {`,
  `app.post('/order/:ref/review', async (req, res) => {`,
  `app.post('/order/:ref/pay', async (req, res) => {`,
  `app.post('/admin/orders/:ref/payment-link', requireAuth, async (req, res) => {`,
  `app.post('/admin/quick-add', requireAuth, async (req, res) => {`,
  `app.post('/admin/orders/create-manual', requireAuth, async (req, res) => {`,
  `app.post('/webhooks/paymongo', async (req, res) => {`,
  `app.post('/order/:ref/qr', uploadOrderFile.single('qr'), async (req, res) => {`,
  `app.post('/order/:ref/signin-code', express.urlencoded({ extended: false }), async (req, res) => {`,
  `app.post('/order/:ref/return-proof', uploadOrderFile.single('proof'), async (req, res) => {`,
  `app.post('/admin/orders/:ref/advance', requireAuth, async (req, res) => {`,
  `app.post('/admin/orders/:ref/reject', requireAuth, async (req, res) => {`,
  `app.post('/admin/orders/:ref/mark-paid', requireAuth, async (req, res) => {`,
  `app.post('/admin/orders/:ref/priority-paid', requireAuth, async (req, res) => {`,
  `app.post('/admin/orders/:ref/undo-priority', requireAuth, async (req, res) => {`,
  `app.post('/admin/orders/:ref/cancel', requireAuth, async (req, res) => {`,
];

let wrapped = 0;
const usedLines = new Set();

for (const target of targets) {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!usedLines.has(i) && lines[i] === target) { idx = i; break; }
  }
  if (idx === -1) throw new Error('target line not found (already wrapped, or text drifted): ' + target);
  usedLines.add(idx);

  const asyncMarker = 'async (req, res) => {';
  const asyncPos = lines[idx].indexOf(asyncMarker);
  if (asyncPos === -1) throw new Error('no async (req, res) => { marker on: ' + target);
  lines[idx] = lines[idx].slice(0, asyncPos) + 'asyncRoute(' + lines[idx].slice(asyncPos);

  let depth = 0;
  let started = false;
  let closeLine = -1;
  for (let i = idx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; }
    }
    if (started && depth === 0) { closeLine = i; break; }
  }
  if (closeLine === -1) throw new Error('no matching close found for: ' + target);

  if (lines[closeLine].trim() !== '});') {
    throw new Error('expected close line to be exactly "});", got: ' + JSON.stringify(lines[closeLine]) + ' for: ' + target);
  }
  lines[closeLine] = lines[closeLine].replace('});', '}));');
  wrapped++;
}

const eol = usesCRLF ? '\r\n' : '\n';
const out = (hasBOM ? '\uFEFF' : '') + lines.join(eol);
fs.writeFileSync(path, out, 'utf8');
console.log('wrapped', wrapped, 'routes');
```

Run it from the repo root:

```bash
node <scratchpad-path>/wrap-routes.js server.js
```

Expected output: `wrapped 18 routes`. If it throws instead (any of the three
`throw new Error(...)` cases), stop — it means the file no longer matches
what this plan verified, and the 18 target strings or the close-line
assumption need to be re-checked against the current file before
proceeding, not forced through.

- [ ] **Step 5: Verify the transformation**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -c server.js && echo "syntax OK"
git diff --stat server.js
```

Expected: `syntax OK`, and `git diff --stat` reporting exactly one file
changed. Then:

```bash
git diff server.js
```

Read the actual diff rather than checking against a precomputed count (the
exact line total depends on incidental formatting choices made in Step 3,
not worth pinning to a magic number). Confirm it contains exactly: one new
`asyncRoute` function (all added lines, no removals), and for each of the
18 targeted routes, exactly one changed opening line
(`async (req, res) => {` → `asyncRoute(async (req, res) => {`) and one
changed closing line (`});` → `}));`) — nothing else. If anything beyond
that shape appears in the diff, stop and investigate before proceeding.

- [ ] **Step 6: Run test to verify it passes**

Run: `node scripts/test-order-routes-wrapped.js`
Expected: PASS — all 19 assertions (1 for the helper + 18 for the wrapped routes).

- [ ] **Step 7: Run the full existing test suite**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
```

Expected: no `FAIL:` lines.

- [ ] **Step 8: Local boot check**

```bash
PORT=4591 timeout 15 node server.js
```

Expected: starts cleanly, prints the running banner, no uncaught exceptions.
This environment has no `MONGODB_URI`, so every one of the 18 routes'
`orders.getByRef`/`orders.create` calls already resolves to `null`/throws
nothing today (per `lib/orders.js:163-169`) — this step confirms wrapping
them changed nothing observable on that already-working path.

- [ ] **Step 9: Commit**

```bash
git add server.js scripts/test-order-routes-wrapped.js
git commit -m "$(cat <<'EOF'
Wrap 18 order routes so a Mongo error responds instead of hanging

Express 4 never catches a rejected promise inside an async route
handler — it just hangs, since nothing calls next(err). server.js
already has both halves of a general safety net (the error middleware
at line ~6819, the unhandledRejection logger) — the gap was only that
these 18 routes' orders.getByRef/orders.create calls never reached
next(err) to trigger it. Same bug class as the promo variable in
/order/reserve, found earlier this session.

Wrapped every one of the 18 flagged route declarations in a small
asyncRoute() helper, applied by a verified scripted transformation
(the exact script this repo's plan doc records, checked beforehand
against a full copy of the file: 18 wraps, clean syntax check, exactly
36 changed lines and nothing else) rather than 18 hand-edited call
sites, since a hand-matched closing brace across 18 structurally
identical routes is exactly the kind of edit a script verifies more
reliably than a human re-reading each one.

No changes to the existing error middleware — the design spec already
verified its generic response is safe for every one of these routes'
real clients.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Real behavioral proof the wrapper works end-to-end

**Files:**
- Test: `scripts/test-order-routes-error-handling.js` (new)

**Interfaces:**
- Consumes: `asyncRoute` and the wrapped `GET /order/:ref` route from Task 1 — this task doesn't modify `server.js` further, only proves Task 1's change works at runtime, not just in source text.
- Produces: nothing further.

Task 1's test proves all 18 routes are *wrapped*; it can't prove the wrapper actually *works* against a real thrown error without booting the real app and forcing a real throw. This task is separate because it exercises a materially different thing (runtime behavior vs. source shape) and needs its own pass/fail gate — Task 1 could be fully correct in its source-level test while still having a bug in `asyncRoute`'s actual logic that only a live request would reveal.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-order-routes-error-handling.js`:

```js
// Run: node scripts/test-order-routes-error-handling.js
//
// Proves the asyncRoute() wrapper actually works at runtime, not just that
// the source text looks right (scripts/test-order-routes-wrapped.js covers
// that half). Boots the real server in-process, monkey-patches
// orders.getByRef to throw, and confirms GET /order/:ref — a public,
// unauthenticated route, chosen specifically so this test never needs an
// admin login — responds with a real HTTP status instead of hanging.
//
// Before the fix: this test times out, because nothing ever calls
// next(err) for a route that isn't wrapped. That timeout IS the proof this
// test is non-vacuous, not a flaw in the test.
const assert = require('assert');
const http = require('http');

const PORT = 4589;
process.env.PORT = String(PORT);

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path, timeout: 5000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out — the route hung instead of responding')); });
  });
}

async function main() {
  // Requiring server.js runs its whole top-level setup, including
  // app.listen(PORT, ...) — this is what actually starts the server this
  // test talks to.
  require('../server.js');

  // orders.getByRef is looked up on this same object at request time by
  // every route in server.js (a property lookup, not a captured copy), so
  // patching it here reaches the real route handlers.
  const orders = require('../lib/orders');
  const originalGetByRef = orders.getByRef;
  orders.getByRef = async () => { throw new Error('simulated MongoDB failure'); };

  try {
    // Wait for the server to actually be listening before hitting it.
    const deadline = Date.now() + 10000;
    let up = false;
    while (Date.now() < deadline) {
      try { await get('/'); up = true; break; }
      catch { await new Promise(r => setTimeout(r, 200)); }
    }
    assert.ok(up, 'server did not come up within 10s');

    console.log('\nGET /order/:ref with a throwing orders.getByRef');

    const res = await get('/order/PH-0001');
    console.log('  ok - responded with a real HTTP status instead of hanging: ' + res.statusCode);
    assert.ok(res.statusCode >= 200 && res.statusCode < 600, 'expected a real HTTP status code, got ' + res.statusCode);
    console.log('\n1 assertion passed\n');
  } finally {
    orders.getByRef = originalGetByRef;
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails against the pre-fix code**

This test can only prove itself non-vacuous by failing against the *un-wrapped* route. Temporarily undo Task 1's wrap on just this one route to check:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git stash
node scripts/test-order-routes-error-handling.js
```

Expected: FAIL — `request timed out — the route hung instead of responding`, after roughly 5 seconds (the request timeout). Then restore Task 1's work:

```bash
git stash pop
```

- [ ] **Step 3: Run test to verify it passes against the fixed code**

```bash
node scripts/test-order-routes-error-handling.js
```

Expected: PASS — `1 assertion passed`, with a real status code printed (the exact code depends on how far the error middleware's own logic runs against a route with no order loaded yet — any real HTTP status is correct here, since the point is that one arrives at all).

- [ ] **Step 4: Run the full existing test suite**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
```

Expected: no `FAIL:` lines. In particular, this test's own server instance must shut down cleanly enough that it doesn't interfere with later test files in the same loop — if the loop hangs after this test, that means the child process from `require('../server.js')` kept the event loop alive; note this and report it rather than silently working around it, since it may mean the test needs an explicit `process.exit(0)` at the end (the test as written relies on the script's own natural exit once `main()` resolves and no server-close call is pending — Node exits once the event loop empties, but an open HTTP server keeps it alive, so confirm this in practice and add `process.exit(0)` at the end of `main()`'s try block if the script doesn't exit on its own within a few seconds).

- [ ] **Step 5: Commit**

```bash
git add scripts/test-order-routes-error-handling.js
git commit -m "$(cat <<'EOF'
Add a real behavioral test for the asyncRoute wrapper

scripts/test-order-routes-wrapped.js proves all 18 routes are wrapped
in source; this proves the wrapper actually works at runtime. Boots
the real server in-process, monkey-patches orders.getByRef to throw,
and confirms GET /order/:ref — chosen because it's public and
unauthenticated, so this test never needs an admin login — responds
with a real HTTP status instead of hanging.

Verified non-vacuous by stashing the wrap and confirming this test
fails with a real timeout against the pre-fix code, not just against a
hypothetical.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Deploy and production verification

**Files:**
- No new files — deployment and measurement, per the spec's Verification section.

**Interfaces:**
- Consumes: Tasks 1-2's completed, committed work.
- Produces: nothing further — this is the plan's final task.

- [ ] **Step 1: Final local check before push**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -c server.js && echo "server.js OK"
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
git status --short
```

Expected: `server.js OK`, no `FAIL:` lines, clean tree.

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Watch the deploy**

Poll `https://playstation-hub-production.up.railway.app/` every 5 seconds,
watching for the `200 → 502 (restart) → 200` pattern seen on every prior
deploy this session, and confirm it settles back to `200`. This deploy's
restart may take longer than a typical one has this session (observed up to
several minutes on at least two earlier deploys) — do not report success on
a single early `200` without confirming stability across several checks a
short while after, exactly as the `/requests` TTFB fix's own deploy
required before its numbers could be trusted.

- [ ] **Step 4: Confirm the happy path is unaffected**

```bash
B="https://playstation-hub-production.up.railway.app"
curl -s -o /dev/null -w "/ -> %{http_code}\n" --max-time 10 "$B/"
curl -s -o /dev/null -w "/browse -> %{http_code}\n" --max-time 10 "$B/browse"
curl -s -o /dev/null -w "/admin/login -> %{http_code}\n" --max-time 10 "$B/admin/login"
```

Expected: all `200`. This fix only changes behavior on a *thrown* error —
a normal request to any of these should look identical to before.

None of the 18 wrapped routes can be safely exercised end-to-end on
production without either a real order reference (which would mean
creating one) or an admin login — both out of bounds per this project's
standing rules. The source-level test (Task 1) and the local behavioral
test (Task 2) are what actually prove the fix works; this step only
confirms the deploy itself didn't break anything on the paths that can be
checked without either of those.

- [ ] **Step 5: Report**

Summarize for the human partner: confirmation the deploy settled cleanly
and the happy-path routes are unaffected, and that this closes the
`/requests` TTFB investigation's flagged finding. Also report the 4
additional `/admin/orders/:ref/*` routes found while preparing this plan
(`refunded`, `sync-end-date`, `fix-purchase`, `delete`) that call different
order functions (not `getByRef`/`create`) and share the same underlying
bug class (an unguarded async Express handler) but were out of this
spec's explicit scope — a new, smaller finding for the human partner to
prioritize separately, exactly as this whole fix was itself once a flagged
finding from an earlier phase.
