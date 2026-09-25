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
