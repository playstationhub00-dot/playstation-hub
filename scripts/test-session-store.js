// Plain assert-based tests for the admin session store. No test framework in
// this project by design — run with `node scripts/test-session-store.js`.
//
// No database: a fake collection stands in for Mongo, which is what lets the
// failure paths be tested at all. Those matter more than the happy path here —
// a session store that throws takes the admin login down with it.
const assert = require('assert');
const store = require('../lib/session-store');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }
async function checkAsync(name, fn) { await fn(); passed++; console.log('  ok - ' + name); }

function fakeDb(rows) {
  const data = rows || {};
  return {
    collection: () => ({
      _data: data,
      async findOne(q) { return data[q._id] || null; },
      async updateOne(q, upd, opts) {
        const cur = data[q._id] || {};
        if (!data[q._id] && !(opts && opts.upsert)) return;
        data[q._id] = Object.assign({ _id: q._id }, cur, upd.$set);
      },
      async deleteOne(q) { delete data[q._id]; },
      async createIndex() { return 'expires_1'; }
    })
  };
}

check('an explicit SESSION_SECRET wins', () => {
  assert.deepStrictEqual(store.resolveSecret({ SESSION_SECRET: 's3cret', MONGODB_URI: 'mongodb://x' }),
    { secret: 's3cret', source: 'env' });
});

check('without one, the secret derives from MONGODB_URI and is stable', () => {
  const a = store.resolveSecret({ MONGODB_URI: 'mongodb://example/db' });
  const b = store.resolveSecret({ MONGODB_URI: 'mongodb://example/db' });
  assert.strictEqual(a.source, 'derived');
  // The whole point: same input, same secret, so cookies survive a restart.
  assert.strictEqual(a.secret, b.secret);
  // And it is not just the URL echoed back somewhere it could leak.
  assert.ok(!a.secret.includes('example'));
  assert.strictEqual(a.secret.length, 64);
});

check('a different database gets a different secret', () => {
  assert.notStrictEqual(
    store.resolveSecret({ MONGODB_URI: 'mongodb://a' }).secret,
    store.resolveSecret({ MONGODB_URI: 'mongodb://b' }).secret
  );
});

check('with neither variable it falls back to random-per-boot', () => {
  const a = store.resolveSecret({});
  const b = store.resolveSecret({});
  assert.strictEqual(a.source, 'ephemeral');
  assert.notStrictEqual(a.secret, b.secret);
});

check('expiry follows the cookie maxAge, not a fixed guess', () => {
  const d = store.expiryOf({ cookie: { maxAge: 60000 } });
  const delta = d.getTime() - Date.now();
  assert.ok(delta > 55000 && delta <= 60000, 'got ' + delta);
  // A session with no cookie info still gets a sane expiry rather than NaN.
  assert.ok(store.expiryOf({}).getTime() > Date.now());
  assert.ok(store.expiryOf(null).getTime() > Date.now());
});

(async () => {
  await checkAsync('a session round-trips through set and get', async () => {
    const db = fakeDb(); const s = store.createStore(async () => db);
    await new Promise(r => s.set('abc', { isAdmin: true, cookie: { maxAge: 60000 } }, r));
    const got = await new Promise((res, rej) => s.get('abc', (e, v) => e ? rej(e) : res(v)));
    assert.strictEqual(got.isAdmin, true);
  });

  await checkAsync('destroy removes it', async () => {
    const db = fakeDb(); const s = store.createStore(async () => db);
    await new Promise(r => s.set('abc', { isAdmin: true, cookie: { maxAge: 60000 } }, r));
    await new Promise(r => s.destroy('abc', r));
    const got = await new Promise(res => s.get('abc', (e, v) => res(v)));
    assert.strictEqual(got, null);
  });

  await checkAsync('an expired row is never served, even if the sweep missed it', async () => {
    const rows = { old: { _id: 'old', data: '{"isAdmin":true}', expires: new Date(Date.now() - 1000) } };
    const db = fakeDb(rows); const s = store.createStore(async () => db);
    const got = await new Promise(res => s.get('old', (e, v) => res(v)));
    assert.strictEqual(got, null);
    // ...and it is cleaned up on the way past.
    assert.strictEqual(rows.old, undefined);
  });

  await checkAsync('no database means "no session", never a crash', async () => {
    // The important one. If Mongo is down the owner logs in again, which is
    // exactly today's behaviour — the admin panel must not fall over.
    const s = store.createStore(async () => null);
    const got = await new Promise(res => s.get('abc', (e, v) => res(v)));
    assert.strictEqual(got, null);
    await new Promise(r => s.set('abc', { cookie: {} }, r));
    await new Promise(r => s.destroy('abc', r));
    await new Promise(r => s.touch('abc', { cookie: {} }, r));
    assert.strictEqual(await s.ensureIndexes(), false);
  });

  await checkAsync('a database that throws is survivable too', async () => {
    const s = store.createStore(async () => { throw new Error('connection refused'); });
    const got = await new Promise(res => s.get('abc', (e, v) => res(v)));
    assert.strictEqual(got, null);
    await new Promise(r => s.set('abc', { cookie: {} }, r));
    await new Promise(r => s.touch('abc', { cookie: {} }, r));
    await new Promise(r => s.destroy('abc', r));
  });

  await checkAsync('corrupt stored JSON does not throw', async () => {
    const rows = { bad: { _id: 'bad', data: '{not json', expires: new Date(Date.now() + 60000) } };
    const db = fakeDb(rows); const s = store.createStore(async () => db);
    const got = await new Promise(res => s.get('bad', (e, v) => res(v)));
    assert.strictEqual(got, null);
  });

  await checkAsync('touch extends expiry without rewriting the session data', async () => {
    const rows = {};
    const db = fakeDb(rows); const s = store.createStore(async () => db);
    await new Promise(r => s.set('abc', { isAdmin: true, cookie: { maxAge: 1000 } }, r));
    const before = rows.abc.expires;
    await new Promise(r => s.touch('abc', { cookie: { maxAge: 600000 } }, r));
    assert.ok(rows.abc.expires > before);
    assert.strictEqual(rows.abc.data, '{"isAdmin":true,"cookie":{"maxAge":1000}}');
  });

  console.log('\n' + passed + ' assertions passed');
})();
