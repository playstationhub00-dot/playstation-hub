// Run: node scripts/test-mongo-connection.js
//
// No live MongoDB: a fake MongoClient constructor stands in for the real
// mongodb package, following the same fake-collection injection pattern
// scripts/test-session-store.js already uses for lib/session-store.js. What
// matters here is call counting and failure recovery, not real query
// results — a live-database test could not prove "exactly one connect()
// call under concurrent callers" any more reliably than this can.
const assert = require('assert');
const { createConnection } = require('../lib/mongo-connection');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }
async function checkAsync(name, fn) { await fn(); passed++; console.log('  ok - ' + name); }

// Records every construction and connect() call so tests can assert on them.
// `behavior` lets a test control what connect() does: 'resolve' (default),
// 'reject-once' (fails the first call, succeeds after), or 'reject-always'.
function makeFakeClientCtor(state) {
  return function FakeMongoClient(uri, opts) {
    state.constructions.push({ uri, opts });
    this._closed = false;
    this.connect = async () => {
      state.connectCalls++;
      if (state.behavior === 'reject-always') throw new Error('connect refused');
      if (state.behavior === 'reject-once' && state.connectCalls === 1) throw new Error('connect refused once');
      return this;
    };
    this.close = async () => { this._closed = true; };
    this.db = (name) => ({ __fakeDbName: name, __client: this });
  };
}

(async () => {
  console.log('\ngetDb() — connects once, reuses the client');

  await checkAsync('with no MONGODB_URI, getDb resolves null and never constructs a client', async () => {
    const state = { constructions: [], connectCalls: 0, behavior: 'resolve' };
    const { getDb } = createConnection({}, makeFakeClientCtor(state));
    const result = await getDb();
    assert.strictEqual(result, null);
    assert.strictEqual(state.constructions.length, 0);
  });

  await checkAsync('a second getDb() call reuses the same client, no second construction', async () => {
    const state = { constructions: [], connectCalls: 0, behavior: 'resolve' };
    const { getDb } = createConnection({ MONGODB_URI: 'mongodb://x' }, makeFakeClientCtor(state));
    const db1 = await getDb();
    const db2 = await getDb();
    assert.strictEqual(state.constructions.length, 1, 'client constructed more than once');
    assert.strictEqual(state.connectCalls, 1, 'connect() called more than once');
    assert.strictEqual(db1.__client, db2.__client, 'the two calls returned different underlying clients');
    assert.strictEqual(db1.__fakeDbName, 'pshub');
  });

  console.log('\ngetDb() — concurrent callers before the first connect() resolves');

  await checkAsync('two concurrent calls produce exactly one construction and one connect()', async () => {
    const state = { constructions: [], connectCalls: 0, behavior: 'resolve' };
    const { getDb } = createConnection({ MONGODB_URI: 'mongodb://x' }, makeFakeClientCtor(state));
    const [db1, db2] = await Promise.all([getDb(), getDb()]);
    assert.strictEqual(state.constructions.length, 1, 'two concurrent callers each started their own MongoClient — the old code\'s race');
    assert.strictEqual(state.connectCalls, 1);
    assert.strictEqual(db1.__client, db2.__client);
  });

  console.log('\ngetDb() — recovery from a failed connect');

  await checkAsync('a failed initial connect does not leave a broken client cached', async () => {
    const state = { constructions: [], connectCalls: 0, behavior: 'reject-once' };
    const { getDb } = createConnection({ MONGODB_URI: 'mongodb://x' }, makeFakeClientCtor(state));
    await assert.rejects(() => getDb(), /connect refused once/);
    const db = await getDb();
    assert.strictEqual(state.constructions.length, 2, 'the retry after a failed connect must construct a fresh client');
    assert.ok(db, 'the retry should succeed and return a db handle');
  });

  console.log('\nreset() — forces the next getDb() call to reconnect');

  await checkAsync('reset() clears the cached client', async () => {
    const state = { constructions: [], connectCalls: 0, behavior: 'resolve' };
    const { getDb, reset } = createConnection({ MONGODB_URI: 'mongodb://x' }, makeFakeClientCtor(state));
    await getDb();
    reset();
    await getDb();
    assert.strictEqual(state.constructions.length, 2, 'getDb() after reset() should construct a new client');
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
