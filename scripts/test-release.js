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
