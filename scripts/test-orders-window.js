// Run: node scripts/test-orders-window.js
//
// Exercises the real orders.setRentalWindow against a fake Mongo collection,
// so the awaiting_return recovery is proven in the shipped function rather
// than in a harness stub.
const orders = require('../lib/orders');
const assert = require('assert');

function fakeDb(doc) {
  const store = { doc };
  return {
    collection() {
      return {
        async findOne() { return store.doc; },
        async updateOne(filter, update) {
          const set = update.$set || {};
          Object.assign(store.doc, set);
          if (update.$push && update.$push.state_history) {
            store.doc.state_history = (store.doc.state_history || []).concat(update.$push.state_history);
          }
          return { matchedCount: 1 };
        }
      };
    },
    _store: store
  };
}

const today = orders.manilaDate();
const future = orders.manilaDate(new Date(Date.now() + 7 * 86400000));
const past = orders.manilaDate(new Date(Date.now() - 7 * 86400000));

(async () => {
  let passed = 0;
  async function check(name, doc, patch, expect) {
    const db = fakeDb(doc);
    orders.init(() => db);
    const ok = await orders.setRentalWindow('PH-4001', patch);
    assert.strictEqual(ok, true, name + ': should report success');
    Object.keys(expect).forEach(k => {
      assert.strictEqual(db._store.doc[k], expect[k], name + ': ' + k + ' = ' + db._store.doc[k] + ', wanted ' + expect[k]);
    });
    passed++;
    console.log('  ok - ' + name);
  }

  await check('an active order just moves its window',
    { ref: 'PH-4001', state: 'active', end_date: today, days: 7, state_history: [] },
    { end_date: future, days: 14, amount_due: 298 },
    { state: 'active', end_date: future, days: 14, amount_due: 298 });

  await check('an order the sweep already took comes back to active',
    { ref: 'PH-4001', state: 'awaiting_return', end_date: past, days: 7, state_history: [] },
    { end_date: future, days: 14 },
    { state: 'active', end_date: future });

  await check('a return already submitted also comes back',
    { ref: 'PH-4001', state: 'verifying_return', end_date: past, days: 7, state_history: [] },
    { end_date: future },
    { state: 'active' });

  await check('an extension that still ends in the past leaves the state alone',
    { ref: 'PH-4001', state: 'awaiting_return', end_date: past, days: 7, state_history: [] },
    { end_date: past },
    { state: 'awaiting_return', end_date: past });

  await check('a closed order is not resurrected',
    { ref: 'PH-4001', state: 'closed', end_date: past, days: 7, state_history: [] },
    { end_date: future },
    { state: 'closed' });

  // the recovery must leave an audit trail, not silently rewrite the state
  const db = fakeDb({ ref: 'PH-4001', state: 'awaiting_return', end_date: past, days: 7, state_history: [] });
  orders.init(() => db);
  await orders.setRentalWindow('PH-4001', { end_date: future });
  assert.strictEqual(db._store.doc.state_history.length, 1, 'a state_history entry was pushed');
  assert.strictEqual(db._store.doc.state_history[0].state, 'active');
  passed++;
  console.log('  ok - the move back to active is recorded in state_history');

  console.log('\n' + passed + ' checks passed\n');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
