// Run: node scripts/test-orders-settle.js
//
// orders.settleOwnerRecorded against a fake Mongo collection that honours the
// ref + state filter the way MongoDB does — so the "only while still unpaid"
// pin, which is what stops a payment being counted twice, is proven in the
// shipped function rather than assumed.
const assert = require('assert');
const orders = require('../lib/orders');

function fakeDb(doc) {
  const store = { doc };
  return {
    collection() {
      return {
        async updateOne(filter, update) {
          const d = store.doc;
          if (filter.ref !== d.ref) return { matchedCount: 0 };
          if (filter.state && filter.state.$in && !filter.state.$in.includes(d.state)) return { matchedCount: 0 };
          Object.assign(d, update.$set || {});
          if (update.$push) Object.keys(update.$push).forEach(k => { d[k] = (d[k] || []).concat([update.$push[k]]); });
          return { matchedCount: 1 };
        }
      };
    },
    _store: store
  };
}

(async () => {
  let passed = 0;
  function ok(desc) { passed++; console.log('  ok - ' + desc); }
  const PATCH = { paid_at: '2026-09-26T04:00:00.000Z', payment_channel: 'manual', payment_method: 'gcash' };

  for (const state of ['awaiting_payment', 'verifying_payment', 'payment_rejected']) {
    const db = fakeDb({ ref: 'PH-0301', state, state_history: [{ state: 'awaiting_payment', at: 'x' }] });
    orders.init(() => db);
    assert.strictEqual(await orders.settleOwnerRecorded('PH-0301', 'active', PATCH), true, state);
    const d = db._store.doc;
    assert.strictEqual(d.state, 'active');
    assert.strictEqual(d.payment_method, 'gcash');
    assert.strictEqual(d.state_history.length, 2);
    assert.strictEqual(d.state_history[1].state, 'active');
    ok('an unpaid order in ' + state + ' settles, with its state history kept');
  }

  {
    const db = fakeDb({ ref: 'PH-0302', state: 'active' });
    orders.init(() => db);
    assert.strictEqual(await orders.settleOwnerRecorded('PH-0302', 'closed', PATCH), false);
    assert.strictEqual(db._store.doc.state, 'active');
    ok('an order already paid is left alone — a second settle does nothing');
  }

  {
    const db = fakeDb({ ref: 'PH-0303', state: 'awaiting_payment' });
    orders.init(() => db);
    assert.strictEqual(await orders.settleOwnerRecorded('PH-0303', 'cancelled', PATCH), false);
    assert.strictEqual(db._store.doc.state, 'awaiting_payment');
    ok('a target outside the allowed list is refused');
  }

  {
    const db = fakeDb({ ref: 'PH-0304', state: 'awaiting_payment' });
    orders.init(() => db);
    assert.strictEqual(await orders.settleOwnerRecorded('not a ref', 'active', PATCH), false);
    ok('a malformed ref is refused');
  }

  {
    orders.init(() => null);
    assert.strictEqual(await orders.settleOwnerRecorded('PH-0301', 'active', PATCH), false);
    ok('no database means no settle, reported as false');
  }

  console.log('\n' + passed + ' assertions passed');
})().catch(e => { console.error(e); process.exit(1); });
