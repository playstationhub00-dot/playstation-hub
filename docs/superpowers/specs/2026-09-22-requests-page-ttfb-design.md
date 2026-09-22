# /requests Page TTFB — Design

**Date:** 2026-09-22
**Status:** Approved for implementation
**Scope:** Phase 3 of the performance effort. Phases 1 (static asset caching) and 2 (inline JS extraction) are complete, deployed, and verified.

## Goal

`docs/superpowers/specs/2026-09-22-static-asset-caching-design.md`'s "Deferred"
section flagged `/requests` as 2.5x slower than any other public page (0.78s vs
~0.3s TTFB) despite being the smallest page, and guessed a missing MongoDB
index as the likely culprit while being honest that round-trip latency was the
more probable dominant cause. This phase re-measures, finds the real cause, and
fixes it.

## What re-measurement found

Fresh measurements against production, taken today, 3 runs per route:

| Route | Backing store | TTFB range |
|---|---|---|
| `/`, `/browse`, `/buy` | lowdb only | 0.31–0.34s, consistent |
| `/requests` | MongoDB (`game_requests`) | **0.76s – 4.43s** |
| `/ps-plus/rent` | MongoDB (`orders`, via queue) | **1.0s – 1.7s** |

Two things the original spec didn't have: `/ps-plus/rent` is *also* slow, and
it was never flagged before — it touches MongoDB through a completely
different collection (`orders`, not `game_requests`) via
`orders.listQueueCandidates()`. And the variance on `/requests` (0.76s to
4.43s across three consecutive runs) doesn't look like a missing-index
problem — a bad query plan is slow *consistently*, not by a factor of 6x
between identical requests seconds apart.

Every lowdb-only route is fast and stable; every MongoDB-touching route is
slow and unstable, regardless of which collection it queries. That pattern
points at the shared connection layer, not any one query.

## Root cause

`server.js`'s `_getMongoDb()` — the single connection getter shared by
`orders.init`, `gameRequests.init`, and the admin session store — does a
`ping` round-trip to Atlas **before every single call**, and if that ping
fails, does a **full reconnect** (new TLS handshake + auth) before
continuing:

```js
if (_mongoSaveClient) {
  try { await _mongoSaveClient.db('admin').command({ ping: 1 }); }
  catch { try { await _mongoSaveClient.close(); } catch {} _mongoSaveClient = null; }
}
if (!_mongoSaveClient) {
  _mongoSaveClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await _mongoSaveClient.connect();
}
```

This runs on **every** call from **every** Mongo-backed route — the ping
explains the ~0.3–1s baseline tax over the lowdb-only routes' ~0.3s, and an
occasional failed ping triggering a full reconnect (TLS + auth, capped by
`serverSelectionTimeoutMS: 8000`) explains the multi-second outliers.

**Why it's there, and why it's now in the wrong place.** Traced via
`git log -S` to commit `0373e09`, which added it for `syncToMongo()` — a
fire-and-forget background write that runs after every lowdb `db.write()`.
An extra few hundred milliseconds there is genuinely free: nothing is
waiting on it. `orders.init(_getMongoDb)` and `gameRequests.init(_getMongoDb)`
were wired up in later commits (`0c63867`, `fd41805`) for a good reason — one
connection pool for the whole app, not a second one just for orders — but
that reuse silently carried the ping tax into the synchronous hot path of
every real page render. Nobody was tracking that consequence at either
point; it only shows up now, measured.

**Whether removing the ping is actually safe.** The MongoDB Node driver in
use (`mongodb@7.4.0`) already performs its own background server monitoring
and automatic reconnection on the retained `MongoClient` — that's what a
long-lived client is *for*, and it's the officially recommended usage
pattern (connect once, reuse forever, let the driver handle transient
network issues). The hand-rolled ping-and-reconnect in `_getMongoDb()` is a
strictly weaker, hand-rolled duplicate of what the driver already does for
free: if the real underlying connectivity is broken, the actual
data-bearing operation fails either way, ping or no ping — the ping only
detects that one round-trip earlier, at the cost of paying it on literally
every call, forever, including the 99.9% of calls where nothing was wrong.

## A second, independent finding

While tracing every call site of the connection this phase touches: **19 of
21** `orders.getByRef`/`orders.create` call sites across `server.js`, and
`/requests`'s own call to `gameRequests.listPublic()`, have **no error
handling** around their MongoDB access. Right now, the ping-and-reconnect
pattern this phase removes is effectively the *only* thing standing between
a real Mongo hiccup and an unhandled-rejection hang on those routes — the
same class of bug found earlier this session with the `promo` variable in
`/order/reserve`.

This is real and worth fixing properly, but it is a pre-existing, wide
(19+ call sites), separate concern from "make `/requests` fast" — each route
needs its own decision about fail-open vs. fail-closed. Per direction: this
phase fixes only `/requests`'s own read path (the one this phase's own
change removes the safety net from) and **flags** the other 19 for separate,
later work rather than bundling a much larger, differently-scoped change in
here.

## Design

### 1. Extract the connection getter into `lib/mongo-connection.js`

Same shape as this project's existing `lib/session-store.js`/`lib/orders.js`/
`lib/requests.js` — a small, dependency-injectable module, not because the
logic needs to grow, but because it needs to be genuinely testable without a
real MongoDB (none is available in this sandboxed environment), following the
exact fake-collection injection pattern `scripts/test-session-store.js`
already established for this project.

```js
// lib/mongo-connection.js
//
// One MongoClient for the whole app, connected once and reused forever — the
// officially recommended MongoDB Node driver pattern. The driver's own
// background server monitoring already detects and recovers from a dropped
// connection; pinging before every call (the previous approach, in
// server.js's old _getMongoDb) duplicated that work at the cost of an extra
// round-trip on every single call, which is what made every Mongo-backed
// page render slower and more variable than the pages that never touch it.
function createConnection(env, MongoClientCtor) {
  let client = null;
  let connectPromise = null;

  async function getDb() {
    const uri = (env || {}).MONGODB_URI;
    if (!uri) return null;
    if (!client) {
      // Two requests arriving before the first connect() resolves must not
      // each start their own MongoClient — the second would silently leak
      // the first's half-open connection. Sharing one in-flight promise
      // makes every concurrent caller await the SAME connect attempt.
      if (!connectPromise) {
        const c = new MongoClientCtor(uri, { serverSelectionTimeoutMS: 8000 });
        connectPromise = c.connect()
          .then(() => { client = c; console.log('[mongo] Connected to MongoDB Atlas'); return c; })
          .catch(e => { connectPromise = null; throw e; });
      }
      await connectPromise;
    }
    return client.db('pshub');
  }

  // Exposed for syncToMongo()'s existing catch block, which already resets
  // on a real write failure — that behaviour is kept, just retargeted at
  // this module instead of a module-level variable in server.js.
  function reset() { client = null; connectPromise = null; }

  return { getDb, reset };
}

module.exports = { createConnection };
```

### 2. Wire it into server.js — a clean swap

```js
const mongoConnection = require('./lib/mongo-connection');
const { MongoClient } = require('mongodb');
const _mongo = mongoConnection.createConnection(process.env, MongoClient);
const _getMongoDb = _mongo.getDb;
```

Every existing call site — `orders.init(_getMongoDb)`,
`gameRequests.init(_getMongoDb)`, the session store's `getDb`, `syncToMongo()`
— keeps working unchanged, since they only ever depended on `_getMongoDb`'s
behavior (an async function returning a db handle or null), never on where it
was defined. `syncToMongo()`'s existing `_mongoSaveClient = null; // force
reconnect next time` becomes `_mongo.reset()`.

### 3. Add the missing index

In `lib/requests.js`'s `ensureIndexes()`, alongside the existing unique
`slug` index:

```js
await col.createIndex({ status: 1 });
```

Cheap, safe, and matches what the original Phase 1 spec already recommended
— real, if secondary now that the connection tax is understood as the
dominant cause.

### 4. Fail-open, scoped to exactly the path this phase depends on

`lib/requests.js`'s `listByStatus()` (which `listPublic()` calls, which
`/requests` calls) gets a try/catch that logs and returns `[]` on failure,
matching the "fails open, never closed" principle `session-store.js` already
documents for this exact class of problem:

```js
async function listByStatus(statuses) {
  const col = await _col();
  if (!col) return [];
  try {
    return await col.find({ status: { $in: statuses } }).toArray();
  } catch (e) {
    console.error('[requests] listByStatus', e.message);
    return [];
  }
}
```

Deliberately **not** applied to `listForAdmin()` (a different caller, out of
this phase's scope) or to any write function (`createRequest`, `addVote`,
`setStatus`, ...) — a write failing open would silently claim success for
something that didn't happen, a fundamentally different risk than a read
falling back to an empty list.

## Explicitly out of scope

- **The other 19 `orders.getByRef`/`orders.create` call sites with no error
  handling.** Real, found during this investigation, and reported above —
  but each needs its own fail-open/fail-closed decision, and bundling a
  19-site change into a page-speed fix is a scope change beyond what was
  asked. Left for separate, later work.
- **`listForAdmin()`** and any other `lib/requests.js` function besides the
  one path `/requests` actually calls.
- **Changing `serverSelectionTimeoutMS`** or other connection-pool tuning —
  the ping removal addresses the measured problem; tuning timeouts without a
  measured need would be a guess.

## Testing

`scripts/test-mongo-connection.js` — a real behavioral unit test, no live
MongoDB required, following the exact fake-client injection pattern already
established in `scripts/test-session-store.js`'s `fakeDb()`:

- Connects once; a second `getDb()` call reuses the same client without
  calling the constructor again.
- Two concurrent `getDb()` calls issued before the first connect resolves
  produce exactly one `MongoClientCtor` construction and one `connect()`
  call — the race the old code was vulnerable to.
- A failed initial `connect()` does not leave a broken client cached: the
  next `getDb()` call retries construction rather than reusing the failed
  instance forever.
- `reset()` clears the cached client, and the next `getDb()` call
  reconnects.
- No `MONGODB_URI` returns `null` without touching the constructor at all
  (unchanged behavior, still must hold).

`scripts/test-requests.js` (existing) gains a case for `listByStatus`'s new
fail-open behavior: a fake collection whose `find().toArray()` rejects
still returns `[]` from `listPublic()`, and logs, rather than throwing.

## Verification

1. Run the new and updated tests; prove each fails against the pre-fix code.
2. Run the full `scripts/test-*.js` suite — no regressions.
3. Local boot check — `_getMongoDb`'s behavior with no `MONGODB_URI` set
   (this sandboxed environment's actual condition) must be unchanged: returns
   `null`, no throw, matching today's local-dev experience exactly.
4. Code-review (not live-test — no admin login will be performed) that the
   session store's `getDb` usage is unaffected: it calls the same function
   with the same contract, and this phase changes nothing about session
   document shape or the store's own logic.
5. Deploy, then re-measure `/requests` and `/ps-plus/rent` TTFB over many
   runs against production, the same way the regression was originally
   found — confirm both the baseline drops and the wild run-to-run variance
   disappears, not just that the average looks better.
6. Watch Railway's public health during the deploy exactly as done for
   Phases 1 and 2.

## Risks

| Risk | Mitigation |
|---|---|
| Removing the ping masks a genuinely dead connection for longer | Analyzed above: the ping doesn't change the ultimate failure mode, only whether the tax is paid on 100% of calls or 0%. A truly broken connection still fails on the real query either way. |
| The connect-race fix changes behavior under real concurrent cold-start load | Covered by a dedicated test asserting exactly one `connect()` call under concurrent callers |
| Fail-open on `/requests` hides a real outage from the owner | The `console.error` line preserves visibility in logs; scoped to a read-only public page where "show nothing" is honest and safe, unlike a write silently claiming success |
| The other 19 unguarded call sites remain a latent risk | Explicitly flagged above as a separate, reportable finding — not silently left undocumented |

## Success criteria

- `/requests` and `/ps-plus/rent` TTFB drop to roughly the same range as the
  lowdb-only pages, with the run-to-run variance gone, not just the average
  improved
- `lib/mongo-connection.js` is independently unit-tested without a live
  MongoDB, following this project's established fake-client pattern
- No behavior change to orders, game requests, or admin sessions — verified
  by the full existing suite plus code review of the session store's usage
- Full test suite green
