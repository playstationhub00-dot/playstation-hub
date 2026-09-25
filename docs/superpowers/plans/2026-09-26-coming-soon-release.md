# Coming Soon Release Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 🚀 Release move every reservation and pre-order on to sign-in for the new game (never stranding a paying customer), always switch Trophy on, redirect old Coming Soon links, and give the owner a "🚀 Just released" list to message on launch day.

**Architecture:** The release decisions move into a new module, `lib/release.js`. It holds pure functions plus one orchestrator that runs against injected stores, so it is tested without MongoDB, lowdb or a server. `lib/orders.js` gains the `reserved → awaiting_qr` edge and one pinned update for unpaid reservations. `server.js` only wires stores into it and adds a sign-in branch, a redirect, and admin data. The admin and customer pages get small template changes.

**Tech Stack:** Node/Express 4, EJS, lowdb (games, customers, Coming Soon records), MongoDB (orders), vanilla browser JS. Tests are plain `node scripts/test-*.js` with `assert`.

**Spec:** `docs/superpowers/specs/2026-09-26-coming-soon-release-design.md`

## Global Constraints

- **The released game record:**
  - always `trophy_account: true` (every game has both Trophy and Non-Trophy);
  - `ps4_primary_slots: 0`;
  - `released_from_upcoming_id: <Coming Soon id>`;
  - `rank` is not copied;
  - `release_date` `'TBA'` → `''`.
- **Orders a release touches:** only those whose `upcoming_game_id` equals the released Coming Soon id, compared as strings. Available-game priority reservations (`upcoming_game_id` null) are never touched.
  - `reserved` → transition to `awaiting_qr` with patch `{ game_id: <new id>, released_at: <ISO now> }`.
  - `awaiting_payment` / `verifying_payment` / `payment_rejected` → `releaseUnpaidReservation(ref, newGameId)` sets `{ game_id, is_reservation: false, upcoming_game_id: null, release_date: '' }`.
- **Refuse if orders are unreachable:** if `await _getMongoDb()` is null, redirect to `/admin?tab=games&msg=release_failed` before writing anything.
- **Release redirects:**
  - `/admin?tab=orders&msg=game_released`, or
  - `&msg=release_partial` when any order failed to move.
- **Signing in a released reservation** (`to === 'active' && order.customer_id && order.released_at`):
  - updates the existing customer record (status `renting`/`bought`, `game_id`, `days`, dates);
  - **never** adds a payment and **never** creates a second customer record;
  - applies the rental slot counters for a rental only.
- **Message text** (exact):
  `🎮 <game title> is out! Your reservation <ref> is ready.\n\nSend your sign-in code here and we'll set you up: <link>`
  The link base is `message_templates.website_link`, falling back to `SITE_URL`.
- **Needs You "🚀 Just released" group:**
  - group key `released`, placed after Do now and before Refunds owed, open by default;
  - **not** counted in the headline or the sidebar badge;
  - newest release first.
- **Toasts** (exact):
  - `release_failed` → `❌ Could not reach the order database — nothing was released. Try again in a minute.`
  - `release_partial` → `⚠ Released, but some reservations could not be moved — look for orders still marked Reserved in the ledger.`
- **CRLF files — edit only with the Edit tool** (never a scripted whole-file rewrite): `server.js` (also UTF-8 BOM), `views/partials/admin/games.ejs`, `public/css/style.css`, `scripts/test-orders.js`. After editing `server.js`, `git diff --stat server.js` must show only a few dozen lines.
- **Never run the release route against a real database.** Orders live in the production MongoDB, and the release behaviour is covered by the injected-store tests. Never log into the real admin.
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Work directly on `main`. Do not push unless the user asks.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/release.js` | Create | Release decisions (pure) + `releaseUpcoming()` orchestrator over injected stores |
| `scripts/test-release.js` | Create | Unit + orchestration tests for `lib/release.js` |
| `lib/orders.js` | Modify | `reserved → awaiting_qr` edge; `releaseUnpaidReservation()` |
| `scripts/test-orders.js` | Modify | The "only way out of reserved" check updated deliberately; new edge asserted |
| `scripts/test-orders-release.js` | Create | `releaseUnpaidReservation()` against a fake Mongo that honours its filter |
| `server.js` | Modify | Release route; sign-in branch; `/upcoming` redirect; admin data |
| `scripts/test-release-wiring.js` | Create | Source-level checks that `server.js` wires the pieces in the right order |
| `views/partials/admin/games.ejs` | Modify | Coming Soon rows: reserved count, "ready to release" nudge, confirm prompt |
| `views/partials/admin/orders/needs-you.ejs` | Modify | "🚀 Just released" group |
| `public/js/admin-orders.js` | Modify | `released` group key |
| `public/css/style.css` | Modify | One rule for the new group's stripe |
| `views/admin.ejs` | Modify | Two toasts + tab mapping |
| `views/order-status.ejs` | Modify | Released heading; remaining-due wording |
| `scripts/test-release-pages.js` | Create | Renders the Coming Soon rows; checks the customer page copy |
| `scripts/test-orders-template.js` | Modify | Just released group checks |
| `scripts/test-admin-orders-filter.js` | Modify | `released` key accepted |

---

### Task 1: Release logic — `lib/release.js`

**Files:**
- Create: `lib/release.js`
- Test: `scripts/test-release.js`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `lib/release.js`):
  - `PRE_PAYMENT_STATES` = `['awaiting_payment', 'verifying_payment', 'payment_rejected']`
  - `releasedGameRecord(upcoming, newGameId, nowIso) → game object`
  - `partitionReleaseOrders(orders, upcomingId) → { move: order[], convert: order[] }`
  - `releaseMessage({ gameTitle, ref, link }) → string`
  - `activatedReservationCustomer(customer, order, startDate, endDate) → customer (new object)`
  - `findReleasedGame(games, upcomingId) → game | null`
  - `releaseUpcoming({ upcoming, newGameId, now, orderStore, gameStore }) → Promise<{ game, moved: string[], converted: string[], failed: string[], customersRepointed: number }>`
    - `orderStore` = `{ listByStates(states), transition(ref, to, patch), releaseUnpaidReservation(ref, newGameId) }`
    - `gameStore` = `{ addGame(game), repointUpcomingCustomers(upcomingId, newGameId) → number, removeUpcoming(id) }`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-release.js`:

```js
// Run: node scripts/test-release.js
//
// Releasing a Coming Soon game used to copy it and delete the Coming Soon
// record, stranding every reservation on a game that no longer existed. These
// check the release decisions and the orchestrator that applies them — the
// orchestrator against in-memory stores, so no MongoDB, lowdb or server.
const assert = require('assert');
const rel = require('../lib/release');

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const NOW = '2026-09-26T03:00:00.000Z';
const UPCOMING = {
  id: 15, title: 'Phantom Blade Zero', platform: 'PS5', genre: 'Action', description: 'Kung fu punk.',
  cover_image: '/uploads/pbz.webp', gallery: ['/uploads/a.webp'], rank: 3, release_date: '2026-09-09',
  non_trophy_slots: 2, trophy_slots: 1, nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549,
  buy_nt_price: 2499, buy_tr_price: 2999, created_at: '2026-08-01T00:00:00.000Z'
};
const ORDERS = [
  { ref: 'PH-0001', state: 'reserved', upcoming_game_id: 15 },
  { ref: 'PH-0002', state: 'awaiting_payment', upcoming_game_id: 15 },
  { ref: 'PH-0003', state: 'verifying_payment', upcoming_game_id: '15' },
  { ref: 'PH-0004', state: 'payment_rejected', upcoming_game_id: 15 },
  { ref: 'PH-0005', state: 'reserved', upcoming_game_id: null },
  { ref: 'PH-0006', state: 'reserved', upcoming_game_id: 16 },
  { ref: 'PH-0007', state: 'cancelled', upcoming_game_id: 15 },
  { ref: 'PH-0008', state: 'reserved', upcoming_game_id: '15' }
];

function fakeStores(orderList, opts) {
  const o = opts || {};
  const log = [];
  const patches = {};
  return {
    log,
    patches,
    orderStore: {
      async listByStates(states) {
        log.push('list:' + states.join(','));
        return orderList.filter(x => states.includes(x.state));
      },
      async transition(ref, to, patch) {
        log.push('transition:' + ref + '->' + to);
        if ((o.failTransition || []).includes(ref)) return null;
        if (o.throwOn === ref) throw new Error('mongo hiccup');
        patches[ref] = patch;
        return Object.assign({ ref, state: to }, patch);
      },
      async releaseUnpaidReservation(ref, gameId) {
        log.push('convert:' + ref + '->' + gameId);
        return true;
      }
    },
    gameStore: {
      async addGame(game) { log.push('addGame:' + game.id); },
      async repointUpcomingCustomers(upcomingId, gameId) { log.push('repoint:' + upcomingId + '->' + gameId); return 3; },
      async removeUpcoming(id) { log.push('remove:' + id); }
    }
  };
}

(async () => {
  console.log('\nreleasedGameRecord()');

  await ok('copies every Coming Soon field', () => {
    const g = rel.releasedGameRecord(UPCOMING, 77, NOW);
    ['title', 'platform', 'genre', 'description', 'cover_image', 'nt_price_7d', 'nt_price_30d',
     'tr_price_7d', 'tr_price_30d', 'buy_nt_price', 'buy_tr_price', 'non_trophy_slots', 'trophy_slots', 'release_date']
      .forEach(k => assert.strictEqual(g[k], UPCOMING[k], k));
    assert.deepStrictEqual(g.gallery, UPCOMING.gallery);
  });

  await ok('always has Trophy on and PS4 Primary off, with a fresh id and date', () => {
    const g = rel.releasedGameRecord(Object.assign({}, UPCOMING, { trophy_slots: 0, tr_price_7d: 0 }), 77, NOW);
    assert.strictEqual(g.trophy_account, true);
    assert.strictEqual(g.ps4_primary_slots, 0);
    assert.strictEqual(g.id, 77);
    assert.strictEqual(g.created_at, NOW);
    assert.strictEqual(g.featured, false);
    assert.strictEqual(g.renters, 0);
  });

  await ok('remembers the Coming Soon game it came from, and drops rank', () => {
    const g = rel.releasedGameRecord(UPCOMING, 77, NOW);
    assert.strictEqual(g.released_from_upcoming_id, 15);
    assert.strictEqual('rank' in g, false);
  });

  await ok('a TBA release date becomes blank', () => {
    assert.strictEqual(rel.releasedGameRecord(Object.assign({}, UPCOMING, { release_date: 'TBA' }), 77, NOW).release_date, '');
  });

  await ok('does not share the gallery array with the Coming Soon record', () => {
    const g = rel.releasedGameRecord(UPCOMING, 77, NOW);
    g.gallery.push('/uploads/b.webp');
    assert.strictEqual(UPCOMING.gallery.length, 1);
  });

  console.log('\npartitionReleaseOrders()');

  await ok('paid reservations move; unpaid ones convert', () => {
    const p = rel.partitionReleaseOrders(ORDERS, 15);
    assert.deepStrictEqual(p.move.map(o => o.ref), ['PH-0001', 'PH-0008']);
    assert.deepStrictEqual(p.convert.map(o => o.ref), ['PH-0002', 'PH-0003', 'PH-0004']);
  });

  await ok('priority reservations, other games and finished orders are left alone', () => {
    const p = rel.partitionReleaseOrders(ORDERS, 15);
    const touched = p.move.concat(p.convert).map(o => o.ref);
    ['PH-0005', 'PH-0006', 'PH-0007'].forEach(r => assert.ok(!touched.includes(r), r));
  });

  await ok('the Coming Soon id can arrive as a string', () => {
    assert.strictEqual(rel.partitionReleaseOrders(ORDERS, '15').move.length, 2);
  });

  await ok('nothing to partition is two empty lists', () => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rel.partitionReleaseOrders(null, 15))), { move: [], convert: [] });
  });

  console.log('\nreleaseMessage()');

  await ok('the exact message', () => {
    assert.strictEqual(
      rel.releaseMessage({ gameTitle: 'Phantom Blade Zero', ref: 'PH-0142', link: 'https://playstation-hub.com/order/PH-0142?k=abc' }),
      '🎮 Phantom Blade Zero is out! Your reservation PH-0142 is ready.\n\n'
        + 'Send your sign-in code here and we\'ll set you up: https://playstation-hub.com/order/PH-0142?k=abc'
    );
  });

  console.log('\nactivatedReservationCustomer()');

  const CUST = {
    id: 9, customer_name: 'Ana Cruz', game_id: 'upcoming_15', status: 'reservation', days: 30,
    start_date: '', end_date: '', payments: [{ amount: 449, date: '2026-09-01', kind: 'reservation' }]
  };

  await ok('a rental reservation becomes a live rental', () => {
    const c = rel.activatedReservationCustomer(CUST, { game_id: 77, days: 30, is_buy: false }, '2026-09-26', '2026-10-26');
    assert.strictEqual(c.status, 'renting');
    assert.strictEqual(c.game_id, 77);
    assert.strictEqual(c.days, 30);
    assert.strictEqual(c.start_date, '2026-09-26');
    assert.strictEqual(c.end_date, '2026-10-26');
  });

  await ok('a pre-order becomes a purchase with no duration or end date', () => {
    const c = rel.activatedReservationCustomer(CUST, { game_id: 77, days: null, is_buy: true }, '2026-09-26', '');
    assert.strictEqual(c.status, 'bought');
    assert.strictEqual(c.days, null);
    assert.strictEqual(c.end_date, '');
  });

  await ok('never adds a payment and never changes the stored record', () => {
    const c = rel.activatedReservationCustomer(CUST, { game_id: 77, days: 30 }, '2026-09-26', '2026-10-26');
    assert.deepStrictEqual(c.payments, CUST.payments);
    assert.strictEqual(CUST.status, 'reservation');
    assert.strictEqual(CUST.game_id, 'upcoming_15');
  });

  await ok('a string game id on the order is stored as a number', () => {
    assert.strictEqual(rel.activatedReservationCustomer(CUST, { game_id: '77', days: 7 }, '2026-09-26', '2026-10-03').game_id, 77);
  });

  console.log('\nfindReleasedGame()');

  await ok('finds the game a Coming Soon id was released as', () => {
    const games = [{ id: 3, title: 'Tekken 8' }, { id: 77, title: 'Phantom Blade Zero', released_from_upcoming_id: 15 }];
    assert.strictEqual(rel.findReleasedGame(games, '15').id, 77);
  });

  await ok('null when it was never released', () => {
    assert.strictEqual(rel.findReleasedGame([{ id: 3, title: 'Tekken 8' }], 15), null);
    assert.strictEqual(rel.findReleasedGame(null, 15), null);
  });

  console.log('\nreleaseUpcoming() — against in-memory stores');

  await ok('creates the game first, then moves, converts, re-points and removes', async () => {
    const s = fakeStores(ORDERS);
    const r = await rel.releaseUpcoming({ upcoming: UPCOMING, newGameId: 77, now: new Date(NOW), orderStore: s.orderStore, gameStore: s.gameStore });
    assert.deepStrictEqual(s.log, [
      'list:awaiting_payment,verifying_payment,payment_rejected,reserved',
      'addGame:77',
      'transition:PH-0001->awaiting_qr',
      'transition:PH-0008->awaiting_qr',
      'convert:PH-0002->77', 'convert:PH-0003->77', 'convert:PH-0004->77',
      'repoint:15->77',
      'remove:15'
    ]);
    assert.deepStrictEqual(r.moved, ['PH-0001', 'PH-0008']);
    assert.deepStrictEqual(r.converted, ['PH-0002', 'PH-0003', 'PH-0004']);
    assert.deepStrictEqual(r.failed, []);
    assert.strictEqual(r.customersRepointed, 3);
    assert.strictEqual(r.game.id, 77);
    assert.strictEqual(r.game.trophy_account, true);
  });

  await ok('moved orders get the new game id and a released_at stamp', async () => {
    const s = fakeStores(ORDERS);
    await rel.releaseUpcoming({ upcoming: UPCOMING, newGameId: 77, now: new Date(NOW), orderStore: s.orderStore, gameStore: s.gameStore });
    assert.deepStrictEqual(s.patches['PH-0001'], { game_id: 77, released_at: NOW });
  });

  await ok('an order that cannot be moved is reported, and everyone else still moves', async () => {
    const s = fakeStores(ORDERS, { failTransition: ['PH-0001'], throwOn: 'PH-0008' });
    const r = await rel.releaseUpcoming({ upcoming: UPCOMING, newGameId: 77, now: new Date(NOW), orderStore: s.orderStore, gameStore: s.gameStore });
    assert.deepStrictEqual(r.failed, ['PH-0001', 'PH-0008']);
    assert.deepStrictEqual(r.converted, ['PH-0002', 'PH-0003', 'PH-0004']);
    assert.ok(s.log.includes('remove:15'));
  });

  await ok('a game nobody reserved still releases cleanly', async () => {
    const s = fakeStores([]);
    const r = await rel.releaseUpcoming({ upcoming: UPCOMING, newGameId: 77, now: new Date(NOW), orderStore: s.orderStore, gameStore: s.gameStore });
    assert.deepStrictEqual([r.moved, r.converted, r.failed], [[], [], []]);
    assert.deepStrictEqual(s.log.slice(1), ['addGame:77', 'repoint:15->77', 'remove:15']);
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-release.js`
Expected: FAIL — `Cannot find module '../lib/release'`

- [ ] **Step 3: Write the implementation**

Create `lib/release.js`:

```js
// Releasing a Coming Soon game.
//
// A Coming Soon game and the reservations against it live in two stores: the
// game and customer records in lowdb, the orders in MongoDB. Releasing it
// creates the real game record, moves every paid reservation / pre-order on to
// "paid, waiting for their sign-in code" for that game, turns unpaid ones into
// ordinary orders, re-points the customer records, and only then removes the
// Coming Soon record. Release used to copy the game and delete the Coming Soon
// record, stranding every reservation on a game that no longer existed.
//
// The decisions are pure functions; releaseUpcoming() runs them against
// injected stores so it is tested without MongoDB, lowdb or a server.

const PRE_PAYMENT_STATES = Object.freeze(['awaiting_payment', 'verifying_payment', 'payment_rejected']);

function sameId(a, b) {
  return a != null && b != null && a !== '' && String(a) === String(b);
}

// Every game has both a Trophy and a Non-Trophy account, so Trophy is always
// on. Coming Soon games have no PS4 Primary option; the owner switches it on in
// Edit for the games that have one.
function releasedGameRecord(upcoming, newGameId, nowIso) {
  const u = upcoming || {};
  return {
    id: newGameId,
    title: u.title,
    platform: u.platform || 'PS5',
    genre: u.genre || '',
    description: u.description || '',
    cover_image: u.cover_image || '',
    gallery: Array.isArray(u.gallery) ? u.gallery.slice() : [],
    buy_nt_price: u.buy_nt_price || 0,
    buy_tr_price: u.buy_tr_price || 0,
    non_trophy_slots: u.non_trophy_slots || 0,
    trophy_slots: u.trophy_slots || 0,
    ps4_primary_slots: 0,
    nt_price_7d: u.nt_price_7d || 0,
    nt_price_30d: u.nt_price_30d || 0,
    tr_price_7d: u.tr_price_7d || 0,
    tr_price_30d: u.tr_price_30d || 0,
    trophy_account: true,
    featured: false,
    renters: 0,
    // 'TBA' means it was never announced; the owner fills the real date in.
    release_date: (u.release_date && u.release_date !== 'TBA') ? u.release_date : '',
    released_from_upcoming_id: u.id,
    created_at: nowIso
  };
}

// Only orders for THIS Coming Soon game. An available-game priority
// reservation also rests in 'reserved' but has no upcoming_game_id, so it is
// never selected.
function partitionReleaseOrders(orderList, upcomingId) {
  const move = [];
  const convert = [];
  (orderList || []).forEach(o => {
    if (!o || !sameId(o.upcoming_game_id, upcomingId)) return;
    if (o.state === 'reserved') move.push(o);
    else if (PRE_PAYMENT_STATES.includes(o.state)) convert.push(o);
  });
  return { move, convert };
}

function releaseMessage({ gameTitle, ref, link }) {
  return '🎮 ' + gameTitle + ' is out! Your reservation ' + ref + ' is ready.\n\n'
    + 'Send your sign-in code here and we\'ll set you up: ' + link;
}

// The customer record a reservation already has, turned into the live rental
// or purchase when the owner signs them in. payments are left alone: the
// reservation payment was recorded when it was confirmed.
function activatedReservationCustomer(customer, order, startDate, endDate) {
  const c = Object.assign({}, customer);
  c.status = order.is_buy ? 'bought' : 'renting';
  c.game_id = Number(order.game_id);
  c.days = order.is_buy ? null : (order.days || null);
  c.start_date = startDate;
  c.end_date = order.is_buy ? '' : (endDate || '');
  return c;
}

function findReleasedGame(games, upcomingId) {
  return (games || []).find(g => g && sameId(g.released_from_upcoming_id, upcomingId)) || null;
}

async function releaseUpcoming({ upcoming, newGameId, now, orderStore, gameStore }) {
  const nowIso = (now || new Date()).toISOString();
  const candidates = await orderStore.listByStates(PRE_PAYMENT_STATES.concat(['reserved']));
  const { move, convert } = partitionReleaseOrders(candidates, upcoming.id);

  // The game exists before any order is pointed at it.
  const game = releasedGameRecord(upcoming, newGameId, nowIso);
  await gameStore.addGame(game);

  const moved = [];
  const converted = [];
  const failed = [];
  for (const o of move) {
    let r = null;
    try { r = await orderStore.transition(o.ref, 'awaiting_qr', { game_id: newGameId, released_at: nowIso }); } catch (e) { r = null; }
    (r ? moved : failed).push(o.ref);
  }
  for (const o of convert) {
    let r = false;
    try { r = await orderStore.releaseUnpaidReservation(o.ref, newGameId); } catch (e) { r = false; }
    (r ? converted : failed).push(o.ref);
  }

  const customersRepointed = await gameStore.repointUpcomingCustomers(upcoming.id, newGameId);
  await gameStore.removeUpcoming(upcoming.id);
  return { game, moved, converted, failed, customersRepointed };
}

module.exports = {
  PRE_PAYMENT_STATES,
  releasedGameRecord,
  partitionReleaseOrders,
  releaseMessage,
  activatedReservationCustomer,
  findReleasedGame,
  releaseUpcoming
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-release.js`
Expected: every line `ok - …`, ending `20 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/release.js scripts/test-release.js
git commit -m "$(cat <<'EOF'
Add lib/release: Coming Soon release decisions and orchestrator with tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Order store — the new edge and the unpaid-reservation update

**Files:**
- Modify: `lib/orders.js` (the `reserved:` entry in `ALLOWED` and its comment; a new function; `module.exports`)
- Modify: `scripts/test-orders.js` (CRLF — Edit tool)
- Create: `scripts/test-orders-release.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `orders.canTransition('reserved', 'awaiting_qr') === true`
  - `orders.releaseUnpaidReservation(ref: string, newGameId: number) → Promise<boolean>`. It is `true` only when the order was in `awaiting_payment`/`verifying_payment`/`payment_rejected` and got updated.

- [ ] **Step 1: Write the failing tests**

1a. In `scripts/test-orders.js`, replace this check (it guards exactly this decision, and its comment says so):

```js
check('undoing is the ONLY way out of reserved', () => {
  // 'reserved' is otherwise still a resting state: the owner converts it to a
  // real rental by hand once the game releases. If a later change makes it a
  // general staging state, this fails and the decision gets made deliberately.
  ['active', 'awaiting_qr', 'qr_pending', 'awaiting_payment', 'verifying_payment', 'closed', 'cancelled']
    .forEach(to => {
      assert.strictEqual(orders.canTransition('reserved', to), false, 'reserved should not reach ' + to);
    });
});
```

with:

```js
check('undo and release are the only ways out of reserved', () => {
  // 'reserved' is a resting state. Two edges leave it: undo-priority back to
  // 'waitlisted', and releasing a Coming Soon game, which moves its paid
  // reservations to 'awaiting_qr' (POST /admin/upcoming/release/:id, via
  // lib/release.js). Anything else still fails here so the next change is a
  // deliberate decision too.
  ['active', 'qr_pending', 'awaiting_payment', 'verifying_payment', 'closed', 'cancelled']
    .forEach(to => {
      assert.strictEqual(orders.canTransition('reserved', to), false, 'reserved should not reach ' + to);
    });
});

check('a released Coming Soon reservation can move on to sign-in', () => {
  assert.strictEqual(orders.canTransition('reserved', 'awaiting_qr'), true);
});
```

1b. Create `scripts/test-orders-release.js`:

```js
// Run: node scripts/test-orders-release.js
//
// Exercises the real orders.releaseUnpaidReservation against a fake Mongo
// collection that honours the ref + state filter the way MongoDB does, so the
// "only pre-payment orders" pin is proven in the shipped function.
const orders = require('../lib/orders');
const assert = require('assert');

function fakeDb(doc) {
  const store = { doc };
  return {
    collection() {
      return {
        async updateOne(filter, update) {
          const d = store.doc;
          const refOk = filter.ref === d.ref;
          const stateOk = !filter.state || (filter.state.$in ? filter.state.$in.includes(d.state) : filter.state === d.state);
          if (!refOk || !stateOk) return { matchedCount: 0, modifiedCount: 0 };
          Object.assign(d, update.$set || {});
          return { matchedCount: 1, modifiedCount: 1 };
        }
      };
    },
    _store: store
  };
}

const RESERVATION = { game_id: 15, is_reservation: true, upcoming_game_id: 15, release_date: '2026-09-09', amount_due: 449 };

(async () => {
  let passed = 0;
  function ok(desc) { passed++; console.log('  ok - ' + desc); }

  for (const state of ['awaiting_payment', 'verifying_payment', 'payment_rejected']) {
    const db = fakeDb(Object.assign({ ref: 'PH-0201', state }, RESERVATION));
    orders.init(() => db);
    assert.strictEqual(await orders.releaseUnpaidReservation('PH-0201', 77), true, state);
    const d = db._store.doc;
    assert.strictEqual(d.game_id, 77);
    assert.strictEqual(d.is_reservation, false);
    assert.strictEqual(d.upcoming_game_id, null);
    assert.strictEqual(d.release_date, '');
    assert.strictEqual(d.state, state, 'state is not changed');
    assert.strictEqual(d.amount_due, 449, 'the quoted amount is kept');
    ok('a ' + state + ' reservation becomes an ordinary order for the released game');
  }

  {
    const db = fakeDb(Object.assign({ ref: 'PH-0202', state: 'reserved' }, RESERVATION));
    orders.init(() => db);
    assert.strictEqual(await orders.releaseUnpaidReservation('PH-0202', 77), false);
    assert.strictEqual(db._store.doc.is_reservation, true);
    assert.strictEqual(db._store.doc.game_id, 15);
    ok('a paid reservation is not touched — release transitions those instead');
  }

  {
    const db = fakeDb(Object.assign({ ref: 'PH-0203', state: 'awaiting_payment' }, RESERVATION));
    orders.init(() => db);
    assert.strictEqual(await orders.releaseUnpaidReservation('not a ref', 77), false);
    assert.strictEqual(db._store.doc.game_id, 15);
    ok('a malformed ref is refused');
  }

  {
    orders.init(() => null);
    assert.strictEqual(await orders.releaseUnpaidReservation('PH-0201', 77), false);
    ok('no database means no update, reported as false');
  }

  console.log('\n' + passed + ' assertions passed');
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node scripts/test-orders.js`
Expected: FAIL on `a released Coming Soon reservation can move on to sign-in`.

Run: `node scripts/test-orders-release.js`
Expected: FAIL — `orders.releaseUnpaidReservation is not a function`.

- [ ] **Step 3: Add the edge**

In `lib/orders.js`, replace:

```js
  // Resting state for a confirmed reservation — the owner converts it to a
  // real rental manually once the game releases, outside this state machine.
  //
```

with:

```js
  // Resting state for a confirmed reservation. Releasing a Coming Soon game
  // moves that game's paid reservations on to 'awaiting_qr' — the same "paid,
  // send us your sign-in code" step a normal paid order sits at — which is
  // what the 'awaiting_qr' edge below is for. The release route selects orders
  // by upcoming_game_id, so an available-game priority reservation (which has
  // none) is never moved by it.
  //
```

and replace:

```js
  reserved:          ['waitlisted'],
```

with:

```js
  reserved:          ['waitlisted', 'awaiting_qr'],
```

- [ ] **Step 4: Add `releaseUnpaidReservation`**

In `lib/orders.js`, directly above `module.exports = {`, add:

```js
// A Coming Soon reservation that was never paid (or is still being checked)
// when its game released becomes an ordinary order for the released game:
// confirming its payment then goes straight to sign-in instead of parking it
// in 'reserved' for a game that is already out. Pinned to the pre-payment
// states so it can never rewrite a paid reservation, which release moves with
// a proper transition() instead.
async function releaseUnpaidReservation(ref, newGameId) {
  const col = await _col('orders');
  if (!col) return false;
  const clean = parseOrderRef(ref);
  if (!clean) return false;
  const r = await col.updateOne(
    { ref: clean, state: { $in: ['awaiting_payment', 'verifying_payment', 'payment_rejected'] } },
    { $set: { game_id: newGameId, is_reservation: false, upcoming_game_id: null, release_date: '' } }
  );
  return r.matchedCount > 0;
}

```

Then in `module.exports`, replace:

```js
  repairPurchase, setRentalWindow, syncFromCustomer
```

with:

```js
  repairPurchase, setRentalWindow, syncFromCustomer, releaseUnpaidReservation
```

- [ ] **Step 5: Run the tests**

```bash
node scripts/test-orders.js
node scripts/test-orders-release.js
node scripts/test-orders-window.js
node scripts/test-queue.js
```

Expected:
- `test-orders.js` ends `20 assertions passed`;
- `test-orders-release.js` ends `6 assertions passed`;
- the other two pass as before.

- [ ] **Step 6: Commit**

```bash
git add lib/orders.js scripts/test-orders.js scripts/test-orders-release.js
git commit -m "$(cat <<'EOF'
Let a released Coming Soon reservation move on to sign-in

Adds the reserved -> awaiting_qr edge (used only by the release route) and
releaseUnpaidReservation for reservations not yet paid at release time.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Server wiring

**Files:**
- Modify: `server.js` (CRLF + BOM — Edit tool only), five edits
- Test: `scripts/test-release-wiring.js`

**Interfaces:**
- Consumes:
  - Task 1: `releaseUpcoming`, `activatedReservationCustomer`, `findReleasedGame`, `releaseMessage` (from `lib/release.js`).
  - Task 2: `orders.releaseUnpaidReservation`, and the `reserved → awaiting_qr` edge.
- Produces, for Task 4: the admin render locals `releasedOrders` (orders in `awaiting_qr` with `released_at`, each with `release_msg`) and `upcomingReservedCount` (`{ [upcomingId: string]: number }`). `todayManila` already exists.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-release-wiring.js`:

```js
// Run: node scripts/test-release-wiring.js
//
// The release behaviour itself is tested in scripts/test-release.js against
// in-memory stores — the release route is never run against the production
// database. This checks server.js wires those pieces in, in the right order.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function block(startMarker) {
  const i = SRC.indexOf(startMarker);
  assert.ok(i >= 0, 'server.js still has ' + startMarker);
  const next = SRC.indexOf('\napp.', i + startMarker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}

console.log('\nrelease wiring');

ok('server.js loads lib/release', () => {
  assert.ok(/const releaseLib = require\('\.\/lib\/release'\);/.test(SRC));
});

ok('the release route refuses before writing when orders are unreachable', () => {
  const r = block("app.post('/admin/upcoming/release/:id'");
  assert.ok(r.includes('requireAuth, asyncRoute(async'), 'async route');
  const guard = r.indexOf('await _getMongoDb()');
  const run = r.indexOf('releaseLib.releaseUpcoming(');
  assert.ok(guard > 0 && run > guard, 'the database check comes before the release runs');
  assert.ok(r.includes("msg=release_failed"));
  assert.ok(r.includes("'release_partial'"));
  assert.ok(r.includes("'game_released'"));
});

ok('the release route hands lowdb and the order store to releaseUpcoming', () => {
  const r = block("app.post('/admin/upcoming/release/:id'");
  assert.ok(r.includes('orderStore: orders'));
  assert.ok(r.includes("db.get('games').push(game).write()"));
  assert.ok(r.includes("'upcoming_' + upcomingId"));
  assert.ok(r.includes("db.get('upcoming').remove("));
});

ok('signing in a released reservation updates its existing customer record', () => {
  const a = block("app.post('/admin/orders/:ref/advance'");
  assert.ok(a.includes('if (to === \'active\' && order.customer_id && order.released_at)'));
  assert.ok(a.includes('releaseLib.activatedReservationCustomer('));
});

ok('old Coming Soon links redirect to the released game', () => {
  const u = block("app.get('/upcoming/:slug'");
  const find = u.indexOf('releaseLib.findReleasedGame(');
  const browse = u.indexOf("if (!game) return res.redirect('/browse');");
  assert.ok(find > 0 && browse > find, 'checked before falling back to /browse');
  assert.ok(u.includes("res.redirect(301, '/game/' + gameSlug(released.title))"));
});

ok('the admin page gets the Just released list and the reservation counts', () => {
  assert.ok(SRC.includes("(await orders.listByStates(['awaiting_qr'])).filter(o => o && o.released_at)"));
  assert.ok(SRC.includes('releaseLib.releaseMessage('));
  assert.ok(SRC.includes('refundsOwed, releasedOrders, upcomingReservedCount, abandonedOrders'));
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-release-wiring.js`
Expected: FAIL on `server.js loads lib/release`.

- [ ] **Step 3: Require the module**

In `server.js`, after the line:

```js
const accountsViewLib = require('./lib/accounts-view');
```

add:

```js
const releaseLib = require('./lib/release');
```

- [ ] **Step 4: Replace the release route**

Replace the whole route, from `app.post('/admin/upcoming/release/:id', requireAuth, (req, res) => {` through its closing `});` (the block that pushes a new game, removes the upcoming record and redirects to `/admin?msg=game_released`), with:

```js
// Releases a Coming Soon game: the real game record is created, every paid
// reservation / pre-order moves on to "send us your sign-in code" for it,
// unpaid ones become ordinary orders, and the customer records follow — see
// lib/release.js. The Coming Soon record is removed last.
app.post('/admin/upcoming/release/:id', requireAuth, asyncRoute(async (req, res) => {
  const upcoming = getUpcomingGame(req.params.id);
  if (!upcoming) return res.redirect('/admin?tab=games');
  // Orders live in MongoDB. Without it the reservations cannot be moved, and
  // deleting the Coming Soon record would strand them — so refuse before
  // writing anything.
  if (!(await _getMongoDb())) return res.redirect('/admin?tab=games&msg=release_failed');
  const result = await releaseLib.releaseUpcoming({
    upcoming,
    newGameId: newId(),
    now: new Date(),
    orderStore: orders,
    gameStore: {
      addGame: game => db.get('games').push(game).write(),
      repointUpcomingCustomers: (upcomingId, gameId) => {
        const key = 'upcoming_' + upcomingId;
        const rows = db.get('customers').filter(c => String(c.game_id) === key).value();
        rows.forEach(c => db.get('customers').find({ id: c.id }).assign({ game_id: gameId }).write());
        return rows.length;
      },
      removeUpcoming: id => db.get('upcoming').remove({ id: parseInt(id) }).write()
    }
  });
  if (result.failed.length) {
    console.error('[release] could not move', result.failed.join(', '), 'while releasing', upcoming.title);
  }
  res.redirect('/admin?tab=orders&msg=' + (result.failed.length ? 'release_partial' : 'game_released'));
}));
```

- [ ] **Step 5: Sign-in branch in the advance route**

In `app.post('/admin/orders/:ref/advance', …)`, find the comment that starts:

```js
  // A confirmed Coming Soon reservation goes into the customers table the
```

and insert this block **directly above** it:

```js
  // A reservation released from Coming Soon already has its customer record
  // (made when the reservation was confirmed). Signing them in turns that same
  // record into the live rental or purchase — never a second record, and never
  // a second payment: the reservation payment is already on it.
  if (to === 'active' && order.customer_id && order.released_at) {
    const existing = getCustomer(order.customer_id);
    if (!existing) {
      console.error('[release] customer', order.customer_id, 'for', order.ref, 'is gone — order is active, customer record not updated');
    } else {
      const live = releaseLib.activatedReservationCustomer(existing, order, patch.start_date, patch.end_date);
      db.get('customers').find({ id: existing.id }).assign({
        status: live.status,
        game_id: live.game_id,
        days: live.days,
        start_date: live.start_date,
        end_date: live.end_date
      }).write();
      if (!order.is_buy) {
        const game = getGame(order.game_id);
        if (game) {
          db.get('games').find({ id: game.id }).assign({
            available_slots: Math.max(0, (game.available_slots || 0) - 1),
            renters: (game.renters || 0) + 1
          }).write();
          if (order.account_type === 'tr') adjustTrophySlots(game.id, -1);
          else if (order.account_type === 'ps4') adjustPs4Slots(game.id, -1);
          else adjustNtSlots(game.id, -1);
        }
      }
    }
  }

```

- [ ] **Step 6: Redirect old Coming Soon links**

In `app.get('/upcoming/:slug', …)`, replace:

```js
      return slug === s || slug.startsWith(s + '-');
    });
  }
  if (!game) return res.redirect('/browse');
```

with:

```js
      return slug === s || slug.startsWith(s + '-');
    });
  }
  if (!game && idMatch) {
    // Released since: the Coming Soon record is gone, but reservation order
    // pages, shares and request-board links still point here.
    const released = releaseLib.findReleasedGame(getGames(), idMatch[1]);
    if (released) return res.redirect(301, '/game/' + gameSlug(released.title));
  }
  if (!game) return res.redirect('/browse');
```

- [ ] **Step 7: Admin data**

7a. In `app.get('/admin', …)`, after:

```js
  const refundsOwed = (await orders.listByStates(['closed']))
    .filter(o => (o.deposit_due || 0) > 0 && !o.deposit_refunded);
```

add:

```js
  // Reservations a release just moved on to sign-in, still waiting for the
  // customer's code — the "🚀 Just released" group in Needs You. Each gets a
  // ready-to-paste "it's out" message; the link uses the same site address as
  // the review asks, falling back to SITE_URL.
  const releasedOrders = (await orders.listByStates(['awaiting_qr'])).filter(o => o && o.released_at);
  {
    const tpls = getSiteSettings().message_templates || {};
    const base = String(tpls.website_link || SITE_URL).replace(/\/+$/, '');
    releasedOrders.forEach(o => {
      if (!o.url_key) return;
      o.release_msg = releaseLib.releaseMessage({
        gameTitle: o.game_title, ref: o.ref, link: base + '/order/' + o.ref + '?k=' + o.url_key
      });
    });
  }
```

7b. Directly above the line that starts `  res.render('admin', { qaUpcoming,`, add:

```js
  // Paid reservations per Coming Soon game, for the "N reserved" line and the
  // release confirm prompt. Read from the customer records a confirmed
  // reservation creates (status 'reservation', game_id 'upcoming_<id>').
  const upcomingReservedCount = {};
  customers.forEach(c => {
    const m = /^upcoming_(\d+)$/.exec(String((c && c.game_id) || ''));
    if (m && c.status === 'reservation') upcomingReservedCount[m[1]] = (upcomingReservedCount[m[1]] || 0) + 1;
  });
```

7c. In that same `res.render('admin', { … })` line, replace:

```
orderQueue, gameRequestRows, refundsOwed, abandonedOrders,
```

with:

```
orderQueue, gameRequestRows, refundsOwed, releasedOrders, upcomingReservedCount, abandonedOrders,
```

- [ ] **Step 8: Verify**

```bash
node --check server.js
git diff --stat server.js
node scripts/test-release-wiring.js
node scripts/test-release.js
node scripts/test-order-routes-error-handling.js
node scripts/test-order-routes-wrapped.js
```

Expected:
- `node --check` prints nothing.
- The diff stat shows `server.js` with about 95 insertions and 33 deletions, not hundreds of changed lines. If it shows hundreds, the line endings were rewritten: run `git checkout -- server.js` and redo the edits with the Edit tool.
- `test-release-wiring.js` ends `6 assertions passed`.
- `test-release.js` ends `20 assertions passed`.
- `test-order-routes-error-handling.js` ends `1 assertion passed`. It boots `server.js` in-process, so it proves the new `require` and routes load. Its stack-trace output above the `ok` line is expected.
- `test-order-routes-wrapped.js` ends `19 assertions passed`.

- [ ] **Step 9: Commit**

```bash
git add server.js scripts/test-release-wiring.js
git commit -m "$(cat <<'EOF'
Wire the release fix: move reservations, finish them at sign-in, redirect

Release refuses when the order database is unreachable, runs through
lib/release, and reports a partial release. Signing in a released
reservation updates its existing customer record without a second payment.
Old /upcoming links redirect to the released game.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Admin and customer pages

**Files:**
- Modify:
  - `views/partials/admin/games.ejs` (CRLF — Edit tool)
  - `views/partials/admin/orders/needs-you.ejs`
  - `public/js/admin-orders.js`
  - `public/css/style.css` (CRLF — Edit tool)
  - `views/admin.ejs`
  - `views/order-status.ejs`
  - `scripts/test-orders-template.js`
  - `scripts/test-admin-orders-filter.js`
- Create: `scripts/test-release-pages.js`

**Interfaces:**
- Consumes (from Task 3): the render locals `releasedOrders`, `upcomingReservedCount`, `todayManila`; and `order.released_at` on orders.
- Produces: the finished pages.

- [ ] **Step 1: Write the failing tests**

1a. Create `scripts/test-release-pages.js`:

```js
// Run: node scripts/test-release-pages.js
//
// The Coming Soon rows of the admin Games tab (rendered for real with
// fixtures), and the customer order page's released wording (checked at
// source level, the same way scripts/test-qr-expiry.js checks that page —
// rendering it needs the whole review/sign-in machinery).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const GAMES = path.join(ROOT, 'views', 'partials', 'admin', 'games.ejs');

function renderGames(over) {
  const upcoming = [
    { id: 15, title: 'Phantom Blade Zero', platform: 'PS5', release_date: '2026-09-09', non_trophy_slots: 2, trophy_slots: 1, nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549 },
    { id: 16, title: "Tom's Game", platform: 'PS5', release_date: '2026-12-01', non_trophy_slots: 1, trophy_slots: 1, nt_price_7d: 199, nt_price_30d: 449 },
    { id: 17, title: 'Mystery Title', platform: 'PS5', release_date: 'TBA', non_trophy_slots: 0, trophy_slots: 0 }
  ];
  const locals = Object.assign({
    games: [], customers: [], upcoming, gameRequestRows: [], priceCategories: [],
    upcomingReservedCount: { '15': 3, '16': 1 }, todayManila: '2026-09-26'
  }, over || {});
  return ejs.render(fs.readFileSync(GAMES, 'utf8'), locals, { filename: GAMES });
}
function row(html, title) {
  const i = html.indexOf('<strong>' + title);
  assert.ok(i >= 0, 'row for ' + title);
  const end = html.indexOf('</tr>', i);
  return html.slice(i, end);
}

const html = renderGames();

console.log('\nComing Soon rows');

ok('each row shows how many paid reservations it has', () => {
  assert.ok(row(html, 'Phantom Blade Zero').includes('3 reserved'));
  assert.ok(row(html, 'Tom&#39;s Game').includes('1 reserved'));
});

ok('a game nobody reserved shows no count', () => {
  assert.ok(!row(html, 'Mystery Title').includes('reserved</div>'));
});

ok('only a game whose release date has passed gets the ready-to-release nudge', () => {
  assert.ok(row(html, 'Phantom Blade Zero').includes('📅 Out since Sep 9, 2026 — ready to release'));
  assert.ok(!row(html, 'Tom&#39;s Game').includes('ready to release'));
  assert.ok(!row(html, 'Mystery Title').includes('ready to release'));
});

ok('the release confirm prompt says how many reservations will move', () => {
  assert.ok(row(html, 'Phantom Blade Zero').includes(' 3 paid reservations will move to sign-in.'));
  assert.ok(row(html, 'Tom&#39;s Game').includes(' 1 paid reservation will move to sign-in.'));
  assert.ok(row(html, 'Mystery Title').includes("to Available Games?')"), 'no sentence when nobody reserved');
});

console.log('\ncustomer order page');

const ORDER_PAGE = fs.readFileSync(path.join(ROOT, 'views', 'order-status.ejs'), 'utf8');

ok('a released reservation gets its own sign-in heading', () => {
  assert.ok(ORDER_PAGE.includes('awaiting_qr:       order.released_at'));
  assert.ok(ORDER_PAGE.includes("title: 'It\\'s out — time to sign in! 🎮'"));
  assert.ok(ORDER_PAGE.includes("' has released. Send your sign-in code below and we\\'ll set you up.'"));
});

ok('a remaining balance is due before sign-in once released', () => {
  assert.ok(ORDER_PAGE.includes("order.released_at ? 'before we sign you in'"));
});

console.log('\n' + passed + ' assertions passed\n');
```

1b. In `scripts/test-orders-template.js`, inside `fixture()`, after the line:

```js
    refundsOwed: [lo('PH-0090', 'closed', { deposit_due: 100, fb_name: 'Dee Santos', game_title: 'Hogwarts Legacy' })],
```

add:

```js
    releasedOrders: [
      lo('PH-0130', 'awaiting_qr', { released_at: '2026-09-25T02:00:00Z', fb_name: 'Ivy Lopez', game_title: 'Phantom Blade Zero', release_msg: '🎮 Phantom Blade Zero is out! Your reservation PH-0130 is ready.' }),
      lo('PH-0131', 'awaiting_qr', { released_at: '2026-09-26T02:00:00Z', fb_name: 'Jon Reyes', game_title: 'Phantom Blade Zero', is_buy: true, days: null, release_msg: '🎮 Phantom Blade Zero is out! Your reservation PH-0131 is ready.' })
    ],
```

In the same file, replace:

```js
  const empty = render({ orderQueue: [], refundsOwed: [], abandonedOrders: [], waitlistOrders: [], ledgerGroups: [] });
```

with:

```js
  const empty = render({ orderQueue: [], refundsOwed: [], releasedOrders: [], abandonedOrders: [], waitlistOrders: [], ledgerGroups: [] });
```

Then insert this, followed by a blank line, before the line `console.log('\nactions and confirm prompts');`:

```js
ok('Just released lists moved reservations newest first, open, with a copy button', () => {
  assert.ok(html.includes('data-oq-group="released" open>'));
  const b = groupBlock(html, 'released');
  assert.deepStrictEqual(refsIn(b), ['PH-0131', 'PH-0130']);
  assert.ok(b.includes('class="oq-btn-ghost rem-copy" data-msg="🎮 Phantom Blade Zero is out! Your reservation PH-0131 is ready."'));
  assert.ok(b.includes('Pre-order'));
  assert.ok(b.includes('Reserve · Monthly'));
});

ok('Just released sits between Do now and Refunds owed', () => {
  const now = html.indexOf('data-oq-group="now"');
  const rel = html.indexOf('data-oq-group="released"');
  const ref = html.indexOf('data-oq-group="refunds"');
  assert.ok(now < rel && rel < ref);
});

ok('no Just released group when nothing was released', () => {
  assert.ok(!render({ releasedOrders: [] }).includes('data-oq-group="released"'));
  assert.ok(!render({ releasedOrders: undefined }).includes('data-oq-group="released"'));
});
```

1c. In `scripts/test-admin-orders-filter.js`, insert this, followed by a blank line, before the line `console.log('\nwiring');`:

```js
ok('remembers the Just released group too', () => {
  assert.deepStrictEqual(plain(F.normalizeGroups({ released: false })), { released: false });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node scripts/test-release-pages.js
node scripts/test-orders-template.js
node scripts/test-admin-orders-filter.js
```

Expected: each fails.
- `test-release-pages.js` fails on its first check.
- `test-orders-template.js` fails on the Just released check. Its headline check stays at 4, because released orders are not counted.
- `test-admin-orders-filter.js` fails on `remembers the Just released group too`.

- [ ] **Step 3: Coming Soon rows — `views/partials/admin/games.ejs`** (Edit tool)

Replace:

```ejs
                <strong><%= game.title %></strong>
                <div style="font-size:0.72rem;margin-top:0.2rem;"><span style="background:linear-gradient(135deg,#4a0080,#f107a3);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:700;">COMING SOON</span></div>
```

with:

```ejs
                <strong><%= game.title %></strong>
                <div style="font-size:0.72rem;margin-top:0.2rem;"><span style="background:linear-gradient(135deg,#4a0080,#f107a3);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:700;">COMING SOON</span></div>
                <%
                  // Paid reservations on this game, and whether its release date
                  // has passed — the two things that matter on launch day.
                  const csReserved = (typeof upcomingReservedCount !== 'undefined' && upcomingReservedCount[game.id]) || 0;
                  const csToday = typeof todayManila !== 'undefined' ? todayManila : '';
                  const csReady = !!(csToday && game.release_date && game.release_date !== 'TBA' && game.release_date <= csToday);
                %>
                <% if (csReserved) { %><div style="font-size:0.7rem;color:#c9a4ff;font-weight:700;margin-top:0.2rem;"><%= csReserved %> reserved</div><% } %>
                <% if (csReady) { %><div style="font-size:0.7rem;color:#22c55e;font-weight:700;margin-top:0.15rem;">📅 Out since <%= new Date(game.release_date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) %> — ready to release</div><% } %>
```

Then replace:

```ejs
                  <form method="POST" action="/admin/upcoming/release/<%= game.id %>" style="display:inline" onsubmit="return confirm('Release \'<%= game.title.replace(/'/g, "\\'") %>\' to Available Games?')">
```

with:

```ejs
                  <form method="POST" action="/admin/upcoming/release/<%= game.id %>" style="display:inline" onsubmit="return confirm('Release \'<%= game.title.replace(/'/g, "\\'") %>\' to Available Games?<%= csReserved ? ' ' + csReserved + ' paid reservation' + (csReserved === 1 ? '' : 's') + ' will move to sign-in.' : '' %>')">
```

- [ ] **Step 4: Just released group — `views/partials/admin/orders/needs-you.ejs`**

4a. Replace:

```ejs
  Needs You: every row that wants a click from the owner, in four groups —
  Do now, Refunds owed, Follow-ups (started but didn't pay) and Waitlist.
```

with:

```ejs
  Needs You: every row that wants a click from the owner, in five groups —
  Do now, Just released (reservations a release moved on to sign-in),
  Refunds owed, Follow-ups (started but didn't pay) and Waitlist.
```

4b. Replace:

```ejs
  const nyRefunds = refundsOwed || [];
```

with:

```ejs
  const nyRefunds = refundsOwed || [];
  // Moved on to sign-in by a release and still waiting for the customer's code.
  // Newest release first. Not counted in the headline: after the owner sends
  // the message, it is the customer's move.
  const nyReleased = [...(typeof releasedOrders !== 'undefined' && releasedOrders ? releasedOrders : [])]
    .sort((a, b) => String(b.released_at || '').localeCompare(String(a.released_at || '')));
```

4c. Replace:

```ejs
<% if (!nyDoNow.length && !nyRefunds.length && !nyFollowUps.length && !nyWaitlist.length) { %>
```

with:

```ejs
<% if (!nyDoNow.length && !nyReleased.length && !nyRefunds.length && !nyFollowUps.length && !nyWaitlist.length) { %>
```

4d. Insert **directly above** the line `<% if (nyRefunds.length) { %>`:

```ejs
<% if (nyReleased.length) { %>
<details class="oq-group oq-group-released" data-oq-group="released" open>
  <summary class="oq-group-h"><span class="oq-group-name">🚀 Just released</span><span class="oq-group-n"><%= nyReleased.length %></span><span class="oq-group-sub">waiting for their sign-in code</span></summary>
  <% nyReleased.forEach(o => { %>
  <div class="oq-row">
    <div class="oq-main">
      <div class="oq-top">
        <span class="oq-ref"><%= o.ref %></span>
        <span class="oq-ab-name"><%= o.fb_name %></span>
        <span class="oq-ab-age" data-created="<%= o.released_at %>">--</span>
      </div>
      <div class="oq-meta">
        <%= o.game_title %> · <%= nyType(o.account_type) %> · <%= o.is_buy ? 'Pre-order' : 'Reserve · ' + (o.days === 7 ? 'Weekly' : 'Monthly') %>
      </div>
    </div>
    <div class="oq-actions">
      <% if (o.release_msg) { %>
      <button type="button" class="oq-btn-ghost rem-copy" data-msg="<%= o.release_msg %>" title="Copy the 'it's out' message for this customer">📋 Copy message</button>
      <% } %>
    </div>
  </div>
  <% }) %>
</details>
<% } %>

```

- [ ] **Step 5: Group memory, stripe, toasts**

5a. In `public/js/admin-orders.js`, replace:

```js
  var GROUP_KEYS = ['now', 'refunds', 'followups', 'waitlist'];
```

with:

```js
  var GROUP_KEYS = ['now', 'released', 'refunds', 'followups', 'waitlist'];
```

5b. In `public/css/style.css` (Edit tool), after the line:

```css
.oq-group-waitlist .oq-row { border-left:3px solid #3a3a3a; }
```

add:

```css
.oq-group-released .oq-row { border-left:3px solid #22c55e; }
```

5c. In `views/admin.ejs`, in the `msgTabMap` object, replace:

```js
    upcoming_added:'games', upcoming_updated:'games', upcoming_deleted:'games',
```

with:

```js
    upcoming_added:'games', upcoming_updated:'games', upcoming_deleted:'games',
    game_released:'orders', release_partial:'orders', release_failed:'games',
```

and in the `messages` object, replace:

```js
game_released:'🚀 Game released to Available Games!'
```

with:

```js
game_released:'🚀 Game released to Available Games!', release_failed:'❌ Could not reach the order database — nothing was released. Try again in a minute.', release_partial:'⚠ Released, but some reservations could not be moved — look for orders still marked Reserved in the ledger.'
```

- [ ] **Step 6: Customer order page — `views/order-status.ejs`**

Replace:

```ejs
    awaiting_qr:       { title: 'Ready for sign-in',       sub: 'Bring up the sign-in screen on your console and send us the code.' },
```

with:

```ejs
    // A reservation that just released lands here too, after waiting on a
    // release date rather than a payment — so it says the game is out.
    awaiting_qr:       order.released_at
                         ? { title: 'It\'s out — time to sign in! 🎮', sub: order.game_title + ' has released. Send your sign-in code below and we\'ll set you up.' }
                         : { title: 'Ready for sign-in',       sub: 'Bring up the sign-in screen on your console and send us the code.' },
```

and replace:

```ejs
    <div class="ord-refund-note">📅 ₱<%= order.remaining_due %> remaining, due <%= order.upcoming_game_id ? 'when ' + order.game_title + ' releases' + (order.release_date ? ' (' + order.release_date + ')' : '') : 'once your slot opens' %>.</div>
```

with:

```ejs
    <div class="ord-refund-note">📅 ₱<%= order.remaining_due %> remaining, due <%= order.released_at ? 'before we sign you in' : order.upcoming_game_id ? 'when ' + order.game_title + ' releases' + (order.release_date ? ' (' + order.release_date + ')' : '') : 'once your slot opens' %>.</div>
```

- [ ] **Step 7: Run the tests**

```bash
node scripts/test-release-pages.js
node scripts/test-orders-template.js
node scripts/test-admin-orders-filter.js
node scripts/test-js-extraction-order-status.js
node scripts/test-admin-tabs.js
```

Expected:
- `test-release-pages.js` ends `6 assertions passed`;
- `test-orders-template.js` ends `33 assertions passed` (its CSS check now also covers `.oq-group-released`);
- `test-admin-orders-filter.js` ends `20 assertions passed`;
- the other two pass as before.

- [ ] **Step 8: Commit**

```bash
git add views/partials/admin/games.ejs views/partials/admin/orders/needs-you.ejs public/js/admin-orders.js public/css/style.css views/admin.ejs views/order-status.ejs scripts/test-release-pages.js scripts/test-orders-template.js scripts/test-admin-orders-filter.js
git status --short
git commit -m "$(cat <<'EOF'
Show launch day: reserved counts, ready-to-release nudge, Just released list

The Coming Soon rows show paid reservations and a nudge once the release
date passes; the release prompt says how many will move. Needs You gains a
Just released group with a copy-ready "it's out" message per customer, and
the customer's page says the game is out.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

`git status --short` before committing should show only these files, plus the long-standing untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` (not part of this work — leave it).

---

### Task 5: Browser check with fixtures, and regression

No changes to the real repo unless a defect is found. If one is, fix it, re-run the affected tests, and commit separately. **Nothing here uses a live server's data.** Orders are in the production MongoDB, and the release route is never run against it.

**Files:**
- Scratch only (substitute the session scratchpad path for `$SCRATCH`):
  - `$SCRATCH/rel-check/build.js`
  - `$SCRATCH/rel-check/serve.js`
  - `$SCRATCH/rel-check/page.html`

- [ ] **Step 1: Build a fixture page**

Create `$SCRATCH/rel-check/build.js`:

```js
// Renders the real Coming Soon rows and the real Orders tab with fixture data.
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/michael/Desktop/claude code/playstation-hub';
const ejs = require(REPO + '/node_modules/ejs');

const now = Date.now();
const iso = ms => new Date(now - ms).toISOString();
const today = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
const lo = (ref, state, extra) => Object.assign({
  ref, state, created_at: iso(3 * 86400e3), game_title: 'Phantom Blade Zero', account_type: 'nt',
  days: 30, amount_due: 449, deposit_due: 0, fb_name: 'Test Person', start_date: '', end_date: ''
}, extra || {});

const gamesFile = path.join(REPO, 'views/partials/admin/games.ejs');
const games = ejs.render(fs.readFileSync(gamesFile, 'utf8'), {
  games: [], customers: [], gameRequestRows: [], priceCategories: [], todayManila: today,
  upcoming: [
    { id: 15, title: 'Phantom Blade Zero', platform: 'PS5', release_date: '2026-09-09', non_trophy_slots: 2, trophy_slots: 1, nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549 },
    { id: 16, title: 'Ghost of Yotei DLC', platform: 'PS5', release_date: '2026-12-01', non_trophy_slots: 1, trophy_slots: 1, nt_price_7d: 199, nt_price_30d: 449 }
  ],
  upcomingReservedCount: { '15': 3 }
}, { filename: gamesFile });

const ordersFile = path.join(REPO, 'views/partials/admin/orders.ejs');
const msg = r => '🎮 Phantom Blade Zero is out! Your reservation ' + r + ' is ready.\n\nSend your sign-in code here and we\'ll set you up: https://playstation-hub.com/order/' + r + '?k=abc';
const orders = ejs.render(fs.readFileSync(ordersFile, 'utf8'), {
  orderQueue: [lo('PH-0101', 'verifying_payment', { created_at: iso(5 * 3600e3), fb_name: 'Ana Cruz', payment_method: 'gcash' })],
  releasedOrders: [
    lo('PH-0130', 'awaiting_qr', { released_at: iso(2 * 3600e3), fb_name: 'Ivy Lopez', release_msg: msg('PH-0130') }),
    lo('PH-0131', 'awaiting_qr', { released_at: iso(20 * 60e3), fb_name: 'Jon Reyes', is_buy: true, days: null, release_msg: msg('PH-0131') })
  ],
  refundsOwed: [], abandonedOrders: [], waitlistOrders: [],
  ledgerGroups: [], ledgerStats: { total: 0, paidCount: 0, paidTotal: 0 },
  orderPeriod: '', orderPeriods: [], orderYears: [],
  abandonedCount: 0, startedCount: 0, orderStartRate: null,
  paymongoMode: 'none', paymongoHealth: null,
  settings: { owner_online: false, payment_methods: [] }
}, { filename: ordersFile });

fs.writeFileSync(path.join(__dirname, 'page.html'), `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/style.css">
<style>body{background:#0a0a0a;color:#fff;padding:16px;font-family:system-ui}.tab-panel{display:block}</style>
</head><body class="admin-body">${games.replace('class="tab-panel"', 'class="tab-panel active"')}
${orders.replace('class="tab-panel"', 'class="tab-panel active"')}
<script src="/js/admin-orders.js"></script>
</body></html>`);
console.log('wrote page.html');
```

Create `$SCRATCH/rel-check/serve.js`:

```js
const http = require('http');
const fs = require('fs');
const REPO = 'C:/Users/michael/Desktop/claude code/playstation-hub';
const routes = {
  '/': [__dirname + '/page.html', 'text/html'],
  '/css/style.css': [REPO + '/public/css/style.css', 'text/css'],
  '/js/admin-orders.js': [REPO + '/public/js/admin-orders.js', 'application/javascript']
};
http.createServer((req, res) => {
  const r = routes[req.url.split('?')[0]];
  if (!r) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': r[1] + '; charset=utf-8' });
  fs.createReadStream(r[0]).pipe(res);
}).listen(4591, () => console.log('fixture page on 4591'));
```

```bash
cd "$SCRATCH/rel-check" && node build.js && (node serve.js > serve.log 2>&1 &) ; sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4591/
```

Expected: `wrote page.html` then `200`.

- [ ] **Step 2: Check it (Browser pane, `http://localhost:4591/`)**

1. **Coming Soon rows:**
   - Phantom Blade Zero shows `3 reserved` and `📅 Out since Sep 9, 2026 — ready to release`.
   - The December game shows neither.
2. **The Release button:** don't let the form submit. Read its prompt with `javascript_tool`: `document.querySelector('form[action="/admin/upcoming/release/15"]').getAttribute('onsubmit')`. It includes `3 paid reservations will move to sign-in.`
3. **Needs You:**
   - `NEEDS YOU 1` (Do now only).
   - A **🚀 Just released 2** group sits between Do now and the rest, open, with the green left stripe.
   - PH-0131 (Pre-order, "20m ago") is above PH-0130 ("Reserve · Monthly", "2h ago").
   - Each has **📋 Copy message**.
4. **Group memory:** close the Just released group and reload. It stays closed. Then `localStorage.clear()` and reload, and it is open again.
5. `read_console_messages` with `onlyErrors: true` → none.
6. **Phone:** `resize_window` preset `mobile`, then reload.
   - The rows stack.
   - `document.documentElement.scrollWidth <= innerWidth`.
   - Reset with preset `desktop`.

- [ ] **Step 3: Clean up**

```bash
for pid in $(netstat -ano | grep ':4591' | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //F //PID "$pid"; done
rm -rf "$SCRATCH/rel-check"
cd "C:/Users/michael/Desktop/claude code/playstation-hub" && git status --short
```

Expected: nothing from this task (only the long-standing untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`).

- [ ] **Step 4: Full regression run**

```bash
cd "C:/Users/michael/Desktop/claude code/playstation-hub"
for f in scripts/test-*.js; do timeout 120 node "$f" > "$SCRATCH/out.txt" 2>&1 || { echo "FAILED: $f"; tail -20 "$SCRATCH/out.txt"; }; done
```

Expected: no `FAILED:` line except `scripts/test-requests-page.js`. That one already failed before this work (confirmed against commit `24f41e0`) and is out of scope, so report it rather than fixing it.
