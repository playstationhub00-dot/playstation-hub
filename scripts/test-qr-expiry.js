// Run: node scripts/test-qr-expiry.js
//
// Covers the sweep that retires a sign-in code once its ten minutes are up,
// and the stamp it leaves behind so the customer's page can say what happened.
//
// expireStaleQrs talks to Mongo, so this injects a fake collection through the
// same init(getDb) seam the server uses. The fake understands only what the
// sweep actually asks for — equality and $lt on find, $set and $push on a
// ref+state filter — which is the whole point: anything the sweep starts
// relying on beyond that will fail loudly here rather than in production.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const orders = require('../lib/orders');

let passed = 0;
function ok(desc, fn) { return fn().then(() => { passed++; console.log('  ok - ' + desc); }); }

function matches(doc, query) {
  return Object.keys(query).every(k => {
    const cond = query[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$lt' in cond) return doc[k] != null && doc[k] < cond.$lt;
      throw new Error('fake collection got an operator it does not implement: ' + JSON.stringify(cond));
    }
    return doc[k] === cond;
  });
}

function fakeDb(docs) {
  const col = {
    find: (q) => ({ toArray: async () => docs.filter(d => matches(d, q)).map(d => Object.assign({}, d)) }),
    findOne: async (q) => {
      const d = docs.find(x => matches(x, q));
      return d ? Object.assign({}, d) : null;
    },
    updateOne: async (q, u) => {
      const d = docs.find(x => matches(x, q));
      if (!d) return { matchedCount: 0 };
      Object.assign(d, u.$set || {});
      if (u.$push) Object.keys(u.$push).forEach(k => { (d[k] = d[k] || []).push(u.$push[k]); });
      return { matchedCount: 1 };
    }
  };
  return { docs, collection: () => col };
}

function pending(over) {
  return Object.assign({
    ref: 'PH-0101', url_key: 'k', state: 'qr_pending',
    game_id: 4, game_title: 'Elden Ring Nightreign', account_type: 'nt',
    qr_image: '/uploads/qr-0101.png',
    // Long gone: a code posted well over its ten-minute life ago.
    qr_expires_at: '2020-01-01T00:00:00.000Z',
    state_history: []
  }, over || {});
}

const run = [];

run.push(() => ok('a code past its window goes back to awaiting_qr', async () => {
  const db = fakeDb([pending()]);
  orders.init(async () => db);
  assert.strictEqual(await orders.expireStaleQrs(), 1);
  assert.strictEqual(db.docs[0].state, 'awaiting_qr');
}));

run.push(() => ok('and says so, which is the whole reason the customer is told', async () => {
  const db = fakeDb([pending()]);
  orders.init(async () => db);
  await orders.expireStaleQrs();
  const o = db.docs[0];
  // Without this stamp the page just reappears asking for a code, reading as
  // though the first was never received.
  assert.ok(o.qr_expired_at, 'qr_expired_at must be stamped');
  assert.ok(!isNaN(Date.parse(o.qr_expired_at)), 'and be a real timestamp: ' + o.qr_expired_at);
  assert.strictEqual(o.qr_expired_count, 1);
}));

run.push(() => ok('the dead code and its countdown are cleared', async () => {
  const db = fakeDb([pending()]);
  orders.init(async () => db);
  await orders.expireStaleQrs();
  // Leaving these would show the customer a countdown for a code that can no
  // longer work, on the very page telling them it expired.
  assert.strictEqual(db.docs[0].qr_image, null);
  assert.strictEqual(db.docs[0].qr_expires_at, null);
}));

run.push(() => ok('a second expiry counts up rather than starting over', async () => {
  // Drives the wording: "the one you sent" the first time, "the last one you
  // sent" after that.
  const db = fakeDb([pending({ qr_expired_count: 2 })]);
  orders.init(async () => db);
  await orders.expireStaleQrs();
  assert.strictEqual(db.docs[0].qr_expired_count, 3);
}));

run.push(() => ok('a count left as rubbish by an older record still moves forward', async () => {
  const db = fakeDb([pending({ qr_expired_count: 'lots' })]);
  orders.init(async () => db);
  await orders.expireStaleQrs();
  assert.strictEqual(db.docs[0].qr_expired_count, 1, 'not NaN');
}));

run.push(() => ok('a code still inside its window is left alone', async () => {
  const future = new Date(Date.now() + 9 * 60 * 1000).toISOString();
  const db = fakeDb([pending({ qr_expires_at: future })]);
  orders.init(async () => db);
  assert.strictEqual(await orders.expireStaleQrs(), 0);
  assert.strictEqual(db.docs[0].state, 'qr_pending');
  assert.strictEqual(db.docs[0].qr_expired_at, undefined, 'nothing to explain yet');
}));

run.push(() => ok('orders in other states are never swept', async () => {
  const db = fakeDb([
    pending({ ref: 'PH-0102', state: 'active' }),
    pending({ ref: 'PH-0103', state: 'awaiting_qr' }),
    pending({ ref: 'PH-0104', state: 'closed' })
  ]);
  orders.init(async () => db);
  assert.strictEqual(await orders.expireStaleQrs(), 0);
  db.docs.forEach(d => assert.strictEqual(d.qr_expired_at, undefined, d.ref));
}));

run.push(() => ok('sending a fresh code leaves qr_pending, so the notice goes', async () => {
  // The notice is gated on state awaiting_qr. Nothing has to clear the stamp:
  // submitting a new code moves the order on, and the only edge back to
  // awaiting_qr is this sweep itself.
  const db = fakeDb([pending()]);
  orders.init(async () => db);
  await orders.expireStaleQrs();
  const back = await orders.transition('PH-0101', 'qr_pending', {
    qr_image: '/uploads/qr-0101-b.png',
    qr_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  assert.ok(back, 'awaiting_qr -> qr_pending is a real edge');
  assert.strictEqual(db.docs[0].state, 'qr_pending');
  assert.ok(db.docs[0].qr_expired_at, 'the stamp stays for the count, harmlessly');
}));

run.push(() => ok('several stale codes are all swept, and counted', async () => {
  const db = fakeDb([pending({ ref: 'PH-0101' }), pending({ ref: 'PH-0102' }), pending({ ref: 'PH-0103' })]);
  orders.init(async () => db);
  assert.strictEqual(await orders.expireStaleQrs(), 3);
  db.docs.forEach(d => assert.strictEqual(d.state, 'awaiting_qr', d.ref));
}));

run.push(() => ok('no database means no crash on a page load', async () => {
  orders.init(async () => null);
  assert.strictEqual(await orders.expireStaleQrs(), 0);
}));

run.push(() => ok('the page reads the same field the sweep writes', async () => {
  // A rename on either side would silently stop the notice from ever showing,
  // and nothing else in the app would complain.
  const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'order-status.ejs'), 'utf8');
  assert.ok(src.indexOf('order.qr_expired_at') !== -1,
    'order-status.ejs no longer gates the expired notice on order.qr_expired_at');
  assert.ok(src.indexOf('order.qr_expired_count') !== -1,
    'order-status.ejs no longer varies its wording on order.qr_expired_count');
  assert.ok(src.indexOf('ord-expired') !== -1, 'the notice markup is gone');
}));

(async () => {
  for (const t of run) await t();
  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
