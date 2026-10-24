// Run: node scripts/test-reminder-cancel-guard.js
//
// The payment-reminder sweep's auto-cancel (server.js: orders.transition(ref,
// 'cancelled', {cancel_reason:'hold_expired'}, {from:['awaiting_payment']}))
// acts on a list fetched earlier. 'reserved' -> 'cancelled' is now a legal edge
// (owner's Slot given), so without the from-guard an order paid mid-sweep would
// be cancelled as hold_expired, erasing a real payment.
const assert = require('assert');
const orders = require('../lib/orders');

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function fakeDb(docs) {
  return {
    collection() {
      return {
        async findOne(filter) { return docs.find(d => d.ref === filter.ref) || null; },
        async updateOne(filter, update) {
          const d = docs.find(x => x.ref === filter.ref);
          const stateOk = d && (!filter.state || (filter.state.$in ? filter.state.$in.includes(d.state) : filter.state === d.state));
          if (!d || !stateOk) return { matchedCount: 0, modifiedCount: 0 };
          Object.assign(d, update.$set || {});
          return { matchedCount: 1, modifiedCount: 1 };
        }
      };
    }
  };
}

// Exactly the sweep's cancel wiring in server.js.
const sweepCancel = async (ref) => !!(await orders.transition(ref, 'cancelled', { cancel_reason: 'hold_expired' }, { from: ['awaiting_payment'] }));

(async () => {
  const docs = [
    { ref: 'PH-0501', state: 'awaiting_payment' },
    { ref: 'PH-0502', state: 'reserved' }
  ];
  orders.init(() => fakeDb(docs));

  await ok('sweep cancel refuses an order that was paid (now reserved)', async () => {
    assert.strictEqual(await sweepCancel('PH-0502'), false);
    assert.strictEqual(docs[1].state, 'reserved');
    assert.strictEqual(docs[1].cancel_reason, undefined);
  });

  await ok('sweep cancel still cancels an awaiting_payment order', async () => {
    assert.strictEqual(await sweepCancel('PH-0501'), true);
    assert.strictEqual(docs[0].state, 'cancelled');
    assert.strictEqual(docs[0].cancel_reason, 'hold_expired');
  });

  await ok('without opts.from, Slot given style reserved -> cancelled still works', async () => {
    assert.ok(await orders.transition('PH-0502', 'cancelled'));
    assert.strictEqual(docs[1].state, 'cancelled');
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
