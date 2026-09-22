# /requests Page TTFB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the per-call MongoDB ping-and-reconnect tax that makes every Mongo-backed page render slow and unpredictable, and add the missing index plus fail-open read handling on the one path this change removes the safety net from.

**Architecture:** Extract the connection getter from `server.js` into a small, dependency-injectable `lib/mongo-connection.js` module (matching this project's existing `lib/session-store.js` pattern), wire it back into `server.js` with no behavior change to any caller's contract, then make two small, targeted changes in `lib/requests.js`.

**Tech Stack:** Node.js, `mongodb@7.4.0` driver, plain `node` test scripts with `assert` (this project's existing convention — see `scripts/test-session-store.js` for the fake-client injection pattern this plan follows).

## Global Constraints

- Direct-on-main workflow, no worktree isolation (established practice in this repo).
- No new npm dependencies.
- `_getMongoDb`'s contract must not change for any existing caller: an async function taking no arguments, returning a MongoDB `Db` object or `null` if `MONGODB_URI` is unset. `orders.init(_getMongoDb)`, `gameRequests.init(_getMongoDb)`, `sessionStore.createStore(_getMongoDb)`, and the `/admin/mongo-status` route's direct call must all keep working with zero changes to their own code.
- `_getMongoDb` is referenced at `server.js:470` (`sessionStore.createStore(_getMongoDb)`) — its replacement must be defined *before* that line, or a `const`/`let` version hits a temporal-dead-zone `ReferenceError` where the current `function` declaration (hoisted) does not. This is the one correctness-critical placement detail in this plan.
- `lib/requests.js`'s fail-open change is scoped to `listByStatus()` only (which `listPublic()` calls). `listForAdmin()` and every write function (`createRequest`, `addVote`, `setStatus`, `setCoverImage`, `remove`, `renameVoter`, `removeVoter`) are explicitly out of scope and must not change.
- Never log into the site's admin panel. This plan's verification relies on code review and the automated test suite for anything that would otherwise require an admin login.

---

### Task 1: `lib/mongo-connection.js` — the connection module, unit-tested with no live MongoDB

**Files:**
- Create: `lib/mongo-connection.js`
- Test: `scripts/test-mongo-connection.js` (new)

**Interfaces:**
- Produces: `createConnection(env, MongoClientCtor)` → `{ getDb, reset }`, where:
  - `getDb()` is an async function, no arguments, returning a `Db`-like object (whatever `MongoClientCtor` instance's `.db('pshub')` returns) or `null` if `env.MONGODB_URI` is falsy.
  - `reset()` is a sync function that clears the cached client, so the next `getDb()` call reconnects from scratch.
- Consumes: nothing from other tasks — this is the first task, and is fully self-contained.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-mongo-connection.js`:

```js
// Run: node scripts/test-mongo-connection.js
//
// No live MongoDB: a fake MongoClient constructor stands in for the real
// mongodb package, following the same fake-collection injection pattern
// scripts/test-session-store.js already uses for lib/session-store.js. What
// matters here is call counting and failure recovery, not real query
// results — a live-database test could not prove "exactly one connect()
// call under concurrent callers" any more reliably than this can.
const assert = require('assert');
const { createConnection } = require('../lib/mongo-connection');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }
async function checkAsync(name, fn) { await fn(); passed++; console.log('  ok - ' + name); }

// Records every construction and connect() call so tests can assert on them.
// `behavior` lets a test control what connect() does: 'resolve' (default),
// 'reject-once' (fails the first call, succeeds after), or 'reject-always'.
function makeFakeClientCtor(state) {
  return function FakeMongoClient(uri, opts) {
    state.constructions.push({ uri, opts });
    this._closed = false;
    this.connect = async () => {
      state.connectCalls++;
      if (state.behavior === 'reject-always') throw new Error('connect refused');
      if (state.behavior === 'reject-once' && state.connectCalls === 1) throw new Error('connect refused once');
      return this;
    };
    this.close = async () => { this._closed = true; };
    this.db = (name) => ({ __fakeDbName: name, __client: this });
  };
}

(async () => {
  console.log('\ngetDb() — connects once, reuses the client');

  await checkAsync('with no MONGODB_URI, getDb resolves null and never constructs a client', async () => {
    const state = { constructions: [], connectCalls: 0, behavior: 'resolve' };
    const { getDb } = createConnection({}, makeFakeClientCtor(state));
    const result = await getDb();
    assert.strictEqual(result, null);
    assert.strictEqual(state.constructions.length, 0);
  });

  await checkAsync('a second getDb() call reuses the same client, no second construction', async () => {
    const state = { constructions: [], connectCalls: 0, behavior: 'resolve' };
    const { getDb } = createConnection({ MONGODB_URI: 'mongodb://x' }, makeFakeClientCtor(state));
    const db1 = await getDb();
    const db2 = await getDb();
    assert.strictEqual(state.constructions.length, 1, 'client constructed more than once');
    assert.strictEqual(state.connectCalls, 1, 'connect() called more than once');
    assert.strictEqual(db1.__client, db2.__client, 'the two calls returned different underlying clients');
    assert.strictEqual(db1.__fakeDbName, 'pshub');
  });

  console.log('\ngetDb() — concurrent callers before the first connect() resolves');

  await checkAsync('two concurrent calls produce exactly one construction and one connect()', async () => {
    const state = { constructions: [], connectCalls: 0, behavior: 'resolve' };
    const { getDb } = createConnection({ MONGODB_URI: 'mongodb://x' }, makeFakeClientCtor(state));
    const [db1, db2] = await Promise.all([getDb(), getDb()]);
    assert.strictEqual(state.constructions.length, 1, 'two concurrent callers each started their own MongoClient — the old code\'s race');
    assert.strictEqual(state.connectCalls, 1);
    assert.strictEqual(db1.__client, db2.__client);
  });

  console.log('\ngetDb() — recovery from a failed connect');

  await checkAsync('a failed initial connect does not leave a broken client cached', async () => {
    const state = { constructions: [], connectCalls: 0, behavior: 'reject-once' };
    const { getDb } = createConnection({ MONGODB_URI: 'mongodb://x' }, makeFakeClientCtor(state));
    await assert.rejects(() => getDb(), /connect refused once/);
    const db = await getDb();
    assert.strictEqual(state.constructions.length, 2, 'the retry after a failed connect must construct a fresh client');
    assert.ok(db, 'the retry should succeed and return a db handle');
  });

  console.log('\nreset() — forces the next getDb() call to reconnect');

  await checkAsync('reset() clears the cached client', async () => {
    const state = { constructions: [], connectCalls: 0, behavior: 'resolve' };
    const { getDb, reset } = createConnection({ MONGODB_URI: 'mongodb://x' }, makeFakeClientCtor(state));
    await getDb();
    reset();
    await getDb();
    assert.strictEqual(state.constructions.length, 2, 'getDb() after reset() should construct a new client');
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-mongo-connection.js`
Expected: FAIL — `Cannot find module '../lib/mongo-connection'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/mongo-connection.js`:

```js
// One MongoClient for the whole app, connected once and reused forever — the
// officially recommended MongoDB Node driver pattern. The driver's own
// background server monitoring already detects and recovers from a dropped
// connection; pinging before every call (the approach this replaces, which
// used to live inline in server.js as _getMongoDb) duplicated that work at
// the cost of an extra round-trip on every single call. That was the actual
// cause of every MongoDB-backed page (orders, game requests, admin sessions)
// rendering slower and far more inconsistently than the pages that never
// touch it — see docs/superpowers/specs/2026-09-22-requests-page-ttfb-design.md.
function createConnection(env, MongoClientCtor) {
  let client = null;
  let connectPromise = null;

  async function getDb() {
    const uri = (env || {}).MONGODB_URI;
    if (!uri) return null;
    if (!client) {
      // Two requests arriving before the first connect() resolves must not
      // each start their own MongoClient — the second construction would
      // silently leak the first's half-open connection. Sharing one
      // in-flight promise makes every concurrent caller await the SAME
      // connect attempt instead of racing.
      if (!connectPromise) {
        const c = new MongoClientCtor(uri, { serverSelectionTimeoutMS: 8000 });
        connectPromise = c.connect()
          .then(() => {
            client = c;
            console.log('[mongo] Connected to MongoDB Atlas');
            return c;
          })
          .catch(e => {
            // A failed initial connect must not leave connectPromise pointing
            // at a rejected promise forever — the next getDb() call needs to
            // retry construction from scratch, not reuse a dead attempt.
            connectPromise = null;
            throw e;
          });
      }
      await connectPromise;
    }
    return client.db('pshub');
  }

  // Exposed for the caller that already resets on a real operation failure
  // (server.js's syncToMongo) — that behaviour is kept, just retargeted at
  // this module instead of a module-level variable in server.js.
  function reset() {
    client = null;
    connectPromise = null;
  }

  return { getDb, reset };
}

module.exports = { createConnection };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-mongo-connection.js`
Expected: PASS — all 6 assertions.

- [ ] **Step 5: Commit**

```bash
git add lib/mongo-connection.js scripts/test-mongo-connection.js
git commit -m "$(cat <<'EOF'
Add lib/mongo-connection.js: connect once, no per-call ping

Extracted from what will become server.js's old _getMongoDb (removed
in the next commit) so the connection logic is independently testable
without a live MongoDB — same fake-client injection pattern
scripts/test-session-store.js already established for this project.

Fixes a race the old code had alongside removing the ping: two
concurrent callers arriving before the first connect() resolved would
each start their own MongoClient, silently leaking one. Concurrent
callers now share a single in-flight connect promise.

Not yet wired into server.js — that's the next commit, kept separate
so this one is reviewable purely as new, tested code with zero
behavior change to the running app.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire `lib/mongo-connection.js` into `server.js`

**Files:**
- Modify: `server.js:1-31` (add one require)
- Modify: `server.js:33` area (add the connection wiring, before line 470's first use)
- Modify: `server.js:602-635` (remove the old `_getMongoDb`/`_mongoSaveClient`, update `syncToMongo`'s reset call)

**Interfaces:**
- Consumes: `createConnection(env, MongoClientCtor)` from Task 1, exact signature as built there.
- Produces: `_getMongoDb` as a `const` bound to `_mongo.getDb`, available to every existing caller with an identical contract to before.

This is a separate task from Task 1 because it's a different kind of change — wiring existing call sites to a new dependency — and is where the placement-ordering risk described in Global Constraints actually bites; a reviewer should be able to check this diff specifically for that ordering.

- [ ] **Step 1: Add the require**

In `server.js`, after line 30 (`const gameRequests = require('./lib/requests');`) and before line 31 (`const { normalizeCustomerPayments, priceDeltaPayment } = require('./lib/payments');`), add:

```js
const mongoConnection = require('./lib/mongo-connection');
```

(Exact insertion point doesn't matter within the requires block — any line among the existing `require(...)` statements at the top of the file is fine, since none of them depend on execution order relative to each other.)

- [ ] **Step 2: Add the connection wiring before its first use**

Immediately after line 34 (`const PORT = process.env.PORT || 3000;`), add:

```js
// One connection for the whole app — orders, game requests, and admin
// sessions all read through this. See lib/mongo-connection.js for why it
// connects once instead of pinging before every call.
const _mongo = mongoConnection.createConnection(process.env, require('mongodb').MongoClient);
const _getMongoDb = _mongo.getDb;
```

This placement is required, not arbitrary: `server.js:470` (`sessionStore.createStore(_getMongoDb)`) is the first use of `_getMongoDb`, and this wiring must exist as a real value by the time that line runs. The original code got away with defining `_getMongoDb` at line 605 — textually *after* line 470 — only because `async function _getMongoDb() {...}` is a hoisted function declaration. `const _getMongoDb = _mongo.getDb` is **not** hoisted the same way; placing it after line 470 would throw `ReferenceError: Cannot access '_getMongoDb' before initialization` the first time the app boots.

- [ ] **Step 3: Remove the old inline implementation**

Find this block (originally at `server.js:602-619`, but re-check the exact current line numbers after Steps 1-2 shift things down by a few lines):

```js
// MongoDB sync — saves entire db state after every write
let _mongoSaveClient = null;
async function _getMongoDb() {
  if (!process.env.MONGODB_URI) return null;
  const { MongoClient } = require('mongodb');
  // Reconnect if client is gone or connection dropped
  if (_mongoSaveClient) {
    try { await _mongoSaveClient.db('admin').command({ ping: 1 }); }
    catch { try { await _mongoSaveClient.close(); } catch {} _mongoSaveClient = null; }
  }
  if (!_mongoSaveClient) {
    _mongoSaveClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await _mongoSaveClient.connect();
    console.log('[mongo] Connected to MongoDB Atlas');
  }
  return _mongoSaveClient.db('pshub');
}
```

Replace it with just the comment, keeping `syncToMongo()` (which follows immediately after) in place:

```js
// MongoDB sync — saves entire db state after every write
```

- [ ] **Step 4: Update `syncToMongo`'s reset call**

Find (in the `syncToMongo` function that now directly follows the comment from Step 3):

```js
  }).catch(e => {
    console.log('[mongo sync error]', e.message);
    _mongoSaveClient = null; // force reconnect next time
  });
```

Replace with:

```js
  }).catch(e => {
    console.log('[mongo sync error]', e.message);
    _mongo.reset(); // force reconnect next time
  });
```

- [ ] **Step 5: Verify no remaining references to the removed variable**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -n "_mongoSaveClient" server.js
```

Expected: no output (every reference was either removed in Step 3 or updated in Step 4).

- [ ] **Step 6: Syntax check**

```bash
node -c server.js
```

Expected: no output (clean).

- [ ] **Step 7: Local boot check**

```bash
node -e "
const ejs = require('ejs');
" 2>&1
PORT=4592 timeout 15 node server.js
```

Expected: starts cleanly, prints `✅ Playstation Hub running at http://localhost:4592`, no uncaught exceptions. This environment has no `MONGODB_URI` set, so this also exercises the `getDb()` no-URI path for real (`_mongo.getDb()` must return `null` without throwing, exactly like the old code) — the same condition this project's local dev has always run under.

- [ ] **Step 8: Run the full existing test suite**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
```

Expected: no `FAIL:` lines. In particular `scripts/test-session-store.js` (which exercises `sessionStore.createStore`, the function that receives `_getMongoDb` at the ordering-critical line 470) must still pass — this test doesn't touch `server.js` directly, but its passing state, combined with the boot check in Step 7, is the closest this environment can get to proving the wiring is correct without a live MongoDB.

- [ ] **Step 9: Commit**

```bash
git add server.js
git commit -m "$(cat <<'EOF'
Wire lib/mongo-connection.js into server.js, removing the per-call ping

server.js's old _getMongoDb pinged Atlas before every call and did a
full reconnect on a failed ping — a pattern that made every MongoDB-
backed route (orders, game requests, admin sessions) measurably slower
and far more inconsistent than the pages that never touch it. Traced
via git log -S to a fire-and-forget background sync job it was
originally written for, where the extra round-trip was free; orders
and game-requests later reused the same getter for real page renders
and silently inherited the tax.

_getMongoDb is now a thin binding to lib/mongo-connection's getDb,
placed before its first use at line ~470 (sessionStore.createStore) —
required because the original function declaration was hoisted and
this const is not; placing it after that line would throw a
temporal-dead-zone ReferenceError on boot.

No caller's contract changed: orders.init, gameRequests.init,
sessionStore.createStore, and the /admin/mongo-status route all keep
working exactly as before.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `lib/requests.js` — missing index and fail-open read

**Files:**
- Modify: `lib/requests.js:70-73` (`listByStatus`)
- Modify: `lib/requests.js:246-250` (`ensureIndexes`)
- Test: `scripts/test-requests.js` (extend existing file)

**Interfaces:**
- Consumes: nothing from Tasks 1-2 — this task's changes are independent of the connection-layer work and could be reviewed separately.
- Produces: nothing further downstream.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test-requests.js`. This file's existing `check()` helper is synchronous only; add an async variant alongside it, and add the new case after the existing ones (before the final `console.log('\n' + passed + ' assertions passed');` line):

Change:

```js
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }
```

to:

```js
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }
async function checkAsync(name, fn) { await fn(); passed++; console.log('  ok - ' + name); }
```

Then find the file's last line:

```js
console.log('\n' + passed + ' assertions passed');
```

and replace that single line with:

```js
// listByStatus is the one read this page's own TTFB fix (see
// docs/superpowers/specs/2026-09-22-requests-page-ttfb-design.md) removes the
// app's only safety net from — a fake collection whose find() rejects proves
// the page still renders (an empty list) instead of hanging on an unhandled
// rejection, the same class of bug this project already hit once with the
// promo variable in /order/reserve.
(async () => {
  await checkAsync('a Mongo read failure in listByStatus returns an empty list instead of throwing', async () => {
    requests.init(async () => ({
      collection: () => ({
        find: () => ({ toArray: async () => { throw new Error('connection reset'); } })
      })
    }));
    const rows = await requests.listPublic();
    assert.deepStrictEqual(rows, []);
  });

  console.log('\n' + passed + ' assertions passed');
})().catch(e => { console.error(e); process.exit(1); });
```

The async IIFE's own `console.log` at the end replaces the plain one that used to be the last line — it has to run after the new async assertion completes rather than before it, which a bare top-level `console.log` placed after an unawaited async call cannot guarantee.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-requests.js`
Expected: FAIL — `listByStatus` currently lets the fake collection's rejection propagate uncaught, so `requests.listPublic()` rejects instead of resolving to `[]`, and the test's `await checkAsync(...)` throws.

- [ ] **Step 3: Add the missing index**

In `lib/requests.js`, find:

```js
async function ensureIndexes() {
  const col = await _col();
  if (!col) return;
  await col.createIndex({ slug: 1 }, { unique: true });
}
```

Replace with:

```js
async function ensureIndexes() {
  const col = await _col();
  if (!col) return;
  await col.createIndex({ slug: 1 }, { unique: true });
  // listByStatus filters on status for every /requests page load; without
  // this the collection has no index to use for that query at all.
  await col.createIndex({ status: 1 });
}
```

- [ ] **Step 4: Add fail-open handling to `listByStatus`**

Find:

```js
async function listByStatus(statuses) {
  const col = await _col();
  if (!col) return [];
  return col.find({ status: { $in: statuses } }).toArray();
}
```

Replace with:

```js
async function listByStatus(statuses) {
  const col = await _col();
  if (!col) return [];
  // Fails open, never closed — matches lib/session-store.js's documented
  // principle for this exact situation. This is a public read: a customer
  // seeing an empty board for a moment is honest and safe. A route with no
  // error handling here would hang on an unhandled rejection instead, the
  // same class of bug this project already hit once with the promo variable
  // in /order/reserve. Scoped to this one read path deliberately — see
  // docs/superpowers/specs/2026-09-22-requests-page-ttfb-design.md for why
  // listForAdmin() and every write function in this file are NOT changed
  // the same way (a write failing open would silently claim success for
  // something that didn't happen).
  try {
    return await col.find({ status: { $in: statuses } }).toArray();
  } catch (e) {
    console.error('[requests] listByStatus', e.message);
    return [];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node scripts/test-requests.js`
Expected: PASS — all assertions, including the new one.

- [ ] **Step 6: Run the full existing test suite**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
```

Expected: no `FAIL:` lines.

- [ ] **Step 7: Commit**

```bash
git add lib/requests.js scripts/test-requests.js
git commit -m "$(cat <<'EOF'
Add the missing status index; make listByStatus fail open

Two small, independent changes to the one MongoDB read /requests
depends on:

- game_requests had an index on slug only, so every /requests page
  load filtered on status with no index to use. Cheap, safe, and part
  of what the original Phase 1 spec already flagged as worth doing —
  real, if secondary now that the connection-layer fix in the previous
  two commits addresses the dominant cause.
- listByStatus now fails open (logs, returns []) instead of letting a
  Mongo error propagate uncaught. Needed because this same phase's
  connection fix removes the ping-based reconnect that was, until now,
  effectively the only thing standing between a real Mongo hiccup and
  an unhandled-rejection hang on this route — the same class of bug
  already hit once with the promo variable in /order/reserve.
  Deliberately scoped to this one read path: listForAdmin() and every
  write function in this file are unchanged, since a write failing
  open would silently claim success for something that didn't happen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Deploy and production verification

**Files:**
- No new files — this task is deployment and measurement, per the spec's Verification section.

**Interfaces:**
- Consumes: all three previous tasks' completed, committed work.
- Produces: nothing further — this is the plan's final task.

- [ ] **Step 1: Final local check before push**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -c server.js && echo "server.js OK"
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
git status --short
```

Expected: `server.js OK`, no `FAIL:` lines, and `git status` shows a clean tree (everything from Tasks 1-3 already committed).

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Watch the deploy**

Poll `https://playstation-hub-production.up.railway.app/` every 5 seconds for up to a few minutes, watching for the `200 → 502 (restart) → 200` pattern this project has seen on every prior deploy this session, and confirm it settles back to `200`.

- [ ] **Step 4: Re-measure `/requests` and `/ps-plus/rent`, before/after comparison**

```bash
B="https://playstation-hub-production.up.railway.app"
echo "=== post-fix TTFB, 6 runs each ==="
for route in /requests /ps-plus/rent / /browse; do
  for i in 1 2 3 4 5 6; do
    curl -s -o /dev/null -w "$route run$i: ttfb=%{time_starttransfer}s\n" --max-time 15 "$B$route"
  done
done
```

Expected: `/requests` and `/ps-plus/rent` both land in roughly the same tight ~0.3-0.4s range `/` and `/browse` already show, with the run-to-run variance gone — not just a lower average. The pre-fix baseline this compares against (measured earlier this session): `/requests` 0.76s–4.43s, `/ps-plus/rent` 1.0s–1.7s, `/`/`/browse` a consistent ~0.32s.

If the numbers still show high variance after this deploy has fully settled (not just mid-restart), stop and investigate — do not report success on an unconfirmed measurement.

- [ ] **Step 5: Confirm the index took effect and sessions still work, without logging in**

```bash
B="https://playstation-hub-production.up.railway.app"
curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 "$B/admin/login"
```

Expected: `200` — the login page itself renders, which exercises the session middleware (and therefore `_getMongoDb` via the session store) on the exact code path Task 2 changed, without actually logging in.

- [ ] **Step 6: Report**

Summarize for the human partner: the before/after TTFB numbers from Step 4, confirmation that the deploy settled cleanly, and that this closes Phase 3 — all three phases of the original performance effort (static asset caching, inline JS extraction, `/requests` TTFB) are now complete. Also restate the flagged-but-out-of-scope finding from the spec (19 `orders.getByRef`/`orders.create` call sites with no error handling) as a standing item for the human partner to prioritize separately, since it was surfaced but deliberately not fixed in this phase.
