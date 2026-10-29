// Run: node scripts/test-order-dedupe.js
const assert = require('assert');
const orders = require('../lib/orders');

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok - ' + name); });
}

function match(row, q) {
  if (!q) return true;
  return Object.keys(q).every(key => {
    const want = q[key];
    if (want && typeof want === 'object') {
      if (Array.isArray(want.$in)) return want.$in.includes(row[key]);
      if (want.$gte != null) return String(row[key]) >= String(want.$gte);
      return false;
    }
    return row[key] === want;
  });
}

function fakeDb() {
  const cols = { orders: [], counters: [] };
  function collection(name) {
    const rows = cols[name] || (cols[name] = []);
    return {
      findOne: async (q) => rows.find(row => match(row, q)) || null,
      find(q) {
        return { toArray: async () => rows.filter(row => match(row, q)) };
      },
      insertOne: async (doc) => {
        if (doc.client_token && rows.some(row => row.client_token === doc.client_token)) {
          const err = new Error('duplicate client_token');
          err.code = 11000;
          throw err;
        }
        rows.push(doc);
        return { insertedId: rows.length };
      },
      updateOne: async (filter, update) => {
        const row = rows.find(r => match(r, filter));
        if (!row) return { modifiedCount: 0 };
        if (update.$unset) Object.keys(update.$unset).forEach(k => { delete row[k]; });
        return { modifiedCount: 1 };
      },
      findOneAndUpdate: async (filter, update, opts) => {
        let row = rows.find(r => match(r, filter));
        if (!row && opts && opts.upsert) {
          row = { _id: filter._id };
          rows.push(row);
        }
        if (!row) return null;
        if (update.$inc) {
          Object.keys(update.$inc).forEach(k => { row[k] = (row[k] || 0) + update.$inc[k]; });
        }
        return row;
      },
      createIndex: async () => 'orders_client_token'
    };
  }
  return {
    cols,
    collection: async (name) => collection(name)
  };
}

const NOW = new Date('2026-10-14T02:00:00.000Z');
const rent = (extra) => Object.assign({
  fb_name: 'Ana Cruz',
  game_id: 27,
  game_title: 'NBA 2K27',
  account_type: 'tr',
  days: 7,
  amount_due: 399,
  deposit_due: 100
}, extra);

(async () => {
  const db = fakeDb();
  orders.init(async () => db);

  await check('a second submit of the same rental returns the first order', async () => {
    const first = await orders.createOrReuse(rent({ client_token: 'abc123def456' }), NOW);
    const second = await orders.createOrReuse(rent({ client_token: 'abc123def456' }), new Date(NOW.getTime() + 1000));
    assert.strictEqual(first.reused, false);
    assert.strictEqual(first.order.created_at, NOW.toISOString());
    assert.strictEqual(second.reused, true);
    assert.strictEqual(second.order.ref, first.order.ref);
    assert.strictEqual(db.cols.orders.length, 1);
  });

  await check('the same customer, game, type and days within two minutes collapses even with a new token', async () => {
    const again = await orders.createOrReuse(rent({ client_token: 'ffff00001111' }), new Date(NOW.getTime() + 3000));
    assert.strictEqual(again.reused, true);
    assert.strictEqual(db.cols.orders.length, 1);
  });

  await check('a different game, a different type, or a later order is a new order', async () => {
    const otherGame = await orders.createOrReuse(rent({ game_id: 8, client_token: '1111aaaabbbb' }), NOW);
    const otherType = await orders.createOrReuse(rent({ account_type: 'nt', deposit_due: 0, client_token: '2222aaaabbbb' }), NOW);
    const later = await orders.createOrReuse(rent({ client_token: '3333aaaabbbb' }), new Date(NOW.getTime() + orders.DEDUPE_WINDOW_MS + 1000));
    assert.strictEqual(otherGame.reused, false);
    assert.strictEqual(otherType.reused, false);
    assert.strictEqual(later.reused, false);
    assert.notStrictEqual(later.order.ref, otherGame.order.ref);
  });

  await check('names match ignoring case and extra spaces', async () => {
    const hit = await orders.createOrReuse(rent({ fb_name: '  ana   cruz ', client_token: '4444aaaabbbb' }), new Date(NOW.getTime() + 5000));
    assert.strictEqual(hit.reused, true);
  });

  await check('the same token can place a new order once the first one is cancelled', async () => {
    const first = await orders.createOrReuse(rent({
      fb_name: 'Eva Ramos', game_id: 9, client_token: '9999aaaabbbb'
    }), NOW);
    first.order.state = 'cancelled';
    const next = await orders.createOrReuse(rent({
      fb_name: 'Eva Ramos', game_id: 9, client_token: '9999aaaabbbb'
    }), new Date(NOW.getTime() + 1000));
    assert.strictEqual(next.reused, false);
    assert.notStrictEqual(next.order.ref, first.order.ref);
    assert.strictEqual(next.order.client_token, '9999aaaabbbb');
    assert.strictEqual(first.order.client_token, undefined);
  });

  await check('a cancelled order does not block a fresh one', async () => {
    db.cols.orders.forEach(row => {
      if (row.fb_name === 'Ana Cruz' && row.game_id === 27 && row.account_type === 'tr') row.state = 'cancelled';
    });
    const fresh = await orders.createOrReuse(rent({ client_token: '5555aaaabbbb' }), new Date(NOW.getTime() + 2000));
    assert.strictEqual(fresh.reused, false);
    assert.strictEqual(fresh.order.state, 'awaiting_payment');
  });

  await check('two overlapping creates share one insert', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const orig = db.collection;
    // Slow the insert the real create() performs, after the in-flight lock is taken.
    const ordersCol = await db.collection('orders');
    const insert = ordersCol.insertOne;
    ordersCol.insertOne = async (doc) => {
      await gate;
      return insert(doc);
    };
    db.collection = async (name) => (name === 'orders' ? ordersCol : orig(name));
    const a = orders.createOrReuse(rent({
      fb_name: 'Bea Lim', game_id: 'psplus', game_title: 'PS Plus Deluxe', client_token: '6666aaaabbbb'
    }), NOW);
    const b = orders.createOrReuse(rent({
      fb_name: 'Bea Lim', game_id: 'psplus', game_title: 'PS Plus Deluxe', client_token: '7777aaaabbbb'
    }), NOW);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.strictEqual(ra.order.ref, rb.order.ref);
    assert.ok(ra.reused !== rb.reused);
    db.collection = orig;
    ordersCol.insertOne = insert;
  });

  await check('a replay of the same token still resolves after the window, while the order is open', async () => {
    const first = await orders.createOrReuse(rent({
      fb_name: 'Cy Diaz', game_id: 3, client_token: '8888aaaabbbb'
    }), NOW);
    const replay = await orders.createOrReuse(rent({
      fb_name: 'Cy Diaz', game_id: 3, client_token: '8888aaaabbbb'
    }), new Date(NOW.getTime() + orders.DEDUPE_WINDOW_MS + 5000));
    assert.strictEqual(replay.reused, true);
    assert.strictEqual(replay.order.ref, first.order.ref);
  });

  await check('a junk token is ignored rather than stored', async () => {
    const placed = await orders.createOrReuse(rent({
      fb_name: 'Dee Santos', game_id: 4, client_token: 'not a token'
    }), NOW);
    assert.strictEqual(placed.order.client_token, undefined);
    assert.strictEqual(orders.cleanClientToken('not a token'), '');
    assert.strictEqual(orders.cleanClientToken('abc123def456'), 'abc123def456');
  });

  console.log('\n' + passed + ' assertions passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
