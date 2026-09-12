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


  // ── syncFromCustomer: the customer form's edits reaching the order ─────────
  //
  // The customer row and the order hold the same rental twice, and only the
  // order is what the customer's own link renders. These prove the edit
  // actually lands on it.
  async function checkSync(name, doc, patch, expect) {
    const db = fakeDb(doc);
    orders.init(() => db);
    const ok = await orders.syncFromCustomer('PH-4001', patch);
    assert.strictEqual(ok, true, name + ': should report success');
    Object.keys(expect).forEach(k => {
      assert.strictEqual(db._store.doc[k], expect[k], name + ': ' + k + ' = ' + db._store.doc[k] + ', wanted ' + expect[k]);
    });
    passed++;
    console.log('  ok - ' + name);
  }

  // The reported bug, exactly: a monthly rental moved to weekly left the
  // customer's page showing "Monthly", the monthly price and the old return
  // date, because order-status.ejs reads all three off the order.
  await checkSync('monthly to weekly reaches the order the customer looks at',
    { ref: 'PH-4001', state: 'active', days: 30, amount_due: 349, end_date: future, state_history: [] },
    { days: 7, amount_due: 199, end_date: today },
    { days: 7, amount_due: 199, end_date: today });

  await checkSync('a game swap moves the title the customer sees',
    { ref: 'PH-4001', state: 'active', game_id: 4, game_title: 'Old Game', account_type: 'nt', state_history: [] },
    { game_id: 9, game_title: 'Expedition 33', account_type: 'tr' },
    { game_id: 9, game_title: 'Expedition 33', account_type: 'tr' });

  await checkSync('both dates move together',
    { ref: 'PH-4001', state: 'active', start_date: '2026-09-01', end_date: '2026-09-30', state_history: [] },
    { start_date: '2026-09-11', end_date: '2026-09-18' },
    { start_date: '2026-09-11', end_date: '2026-09-18' });

  await checkSync('lengthening still rescues an order the sweep already took',
    { ref: 'PH-4001', state: 'awaiting_return', days: 7, end_date: past, state_history: [] },
    { days: 30, end_date: future },
    { state: 'active', days: 30, end_date: future });

  // Only the fields the customer form owns. The caller builds this object out
  // of req.body, so anything outside the whitelist must not reach the order.
  {
    const db = fakeDb({ ref: 'PH-4001', state: 'active', days: 7, state_history: [] });
    orders.init(() => db);
    await orders.syncFromCustomer('PH-4001', {
      days: 30, state: 'closed', url_key: 'hijacked', ref: 'PH-9999', customer_id: 77
    });
    assert.strictEqual(db._store.doc.days, 30, 'the allowed field still lands');
    assert.strictEqual(db._store.doc.state, 'active', 'state is not writable through this');
    assert.strictEqual(db._store.doc.url_key, undefined, 'url_key is not writable through this');
    assert.strictEqual(db._store.doc.ref, 'PH-4001', 'ref cannot be reassigned');
    assert.strictEqual(db._store.doc.customer_id, undefined, 'customer_id is not writable through this');
    passed++;
    console.log('  ok - only the customer form\u2019s own fields reach the order');
  }

  // A purchase has no duration and no return date; an order carrying an
  // end_date is what advanceEndedRentals sweeps into "awaiting return".
  await checkSync('a purchase clears the duration and the return date',
    { ref: 'PH-4001', state: 'active', days: 30, end_date: future, state_history: [] },
    { days: null, end_date: '', amount_due: 2499 },
    { days: null, end_date: '', amount_due: 2499 });

  {
    const db = fakeDb({ ref: 'PH-4001', state: 'active', days: 7, state_history: [] });
    orders.init(() => db);
    const ok = await orders.syncFromCustomer('PH-4001', {});
    assert.strictEqual(ok, false, 'an empty patch reports nothing to do');
    passed++;
    console.log('  ok - an edit that changes none of these fields is a no-op');
  }


  // ── the edit route actually calls it ──────────────────────────────────────
  //
  // Source-level, because there is no route harness here: booting server.js
  // needs Mongo and an admin session. It pins the half a unit test cannot —
  // syncFromCustomer working is worth nothing if the form never calls it, and
  // a function nobody calls is exactly how this bug shipped in the first place.
  {
    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = server.indexOf("app.post('/admin/customers/edit/:id'");
    assert.ok(start !== -1, 'the customer edit route is still where it was');
    const body = server.slice(start, server.indexOf('\napp.', start + 10));

    assert.ok(/orders\.syncFromCustomer\(/.test(body),
      'the customer edit route must push its changes onto the order');
    assert.ok(/await orders\.syncFromCustomer\(/.test(body),
      'and await it, or the redirect races the write and a reload shows stale values');
    assert.ok(/app\.post\('\/admin\/customers\/edit\/:id',\s*requireAuth,\s*async/.test(body),
      'which means the handler has to be async');
    // The fields the reported bug was about, plus the rest of what the
    // customer's own page renders off the order.
    ['days', 'amount_due', 'end_date', 'start_date', 'game_title', 'account_type'].forEach(f => {
      assert.ok(body.slice(body.indexOf('syncFromCustomer')).includes(f + ':'),
        'the sync still carries ' + f);
    });
    passed++;
    console.log('  ok - the customer edit route pushes its changes onto the order');
  }

  console.log('\n' + passed + ' checks passed\n');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
