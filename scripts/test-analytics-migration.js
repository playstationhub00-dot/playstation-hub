// Run: node scripts/test-analytics-migration.js
//
// Moves visitors, skip counters, message taps and search misses out of the
// Mongo state document. A fake collection records the writes. Running the
// migration twice must not double the rows or the skip counts.
const assert = require('assert');
const {
  createAnalyticsStore, trimAnalytics, selectHydration, hasAnalytics, migrationId, CAPS, COLLECTIONS, RETENTION_MS
} = require('../lib/analytics-store');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }
async function checkAsync(name, fn) { await fn(); passed++; console.log('  ok - ' + name); }

function memoryCollection() {
  const docs = new Map();
  const indexes = [];
  return {
    docs, indexes,
    async insertOne(doc) { docs.set(doc._id || ('id-' + docs.size), Object.assign({}, doc)); },
    async insertMany(list) { for (const doc of list) await this.insertOne(doc); },
    async bulkWrite(ops) {
      for (const op of ops) {
        const spec = op.updateOne;
        const id = spec.filter._id;
        if (!docs.has(id)) {
          const row = Object.assign({ _id: id }, spec.update.$setOnInsert || {});
          docs.set(id, row);
        }
      }
    },
    async updateOne(filter, update, opts) {
      const id = filter._id;
      let doc = docs.get(id);
      const inserted = !doc;
      if (!doc) {
        if (!opts || !opts.upsert) return;
        doc = { _id: id };
        docs.set(id, doc);
      }
      if (inserted && update.$setOnInsert) {
        for (const k of Object.keys(update.$setOnInsert)) {
          if (doc[k] === undefined) doc[k] = update.$setOnInsert[k];
        }
      }
      if (update.$inc) {
        for (const k of Object.keys(update.$inc)) doc[k] = (doc[k] || 0) + update.$inc[k];
      }
      if (update.$max) {
        for (const k of Object.keys(update.$max)) doc[k] = Math.max(doc[k] || 0, update.$max[k]);
      }
      if (update.$set) Object.assign(doc, update.$set);
    },
    find() {
      const all = [...docs.values()];
      const cursor = {
        _rows: all,
        sort() { return this; },
        limit() { return this; },
        async toArray() { return this._rows.map(r => Object.assign({}, r)); }
      };
      return cursor;
    },
    async deleteMany(filter) {
      const lt = filter && filter.time && filter.time.$lt;
      for (const [id, doc] of docs) {
        if (lt != null && doc.time < lt) docs.delete(id);
      }
    },
    async createIndex(spec, opts) { indexes.push({ spec, opts: opts || {} }); }
  };
}

function fakeDb() {
  const cols = {};
  const names = [];
  return {
    names,
    cols,
    async collection(name) {
      names.push(name);
      if (!cols[name]) cols[name] = memoryCollection();
      return cols[name];
    }
  };
}

function sampleState() {
  return {
    games: [{ id: 1, title: 'Kept' }],
    customers: [{ id: 4, payments: [{ amount: 100 }] }],
    visitors: [
      { date: '2026-10-01', time: '2026-10-01T01:00:00.000Z', path: '/', page: 'Home', ip: 'a', session_id: 's1', utm_campaign: 'launch' },
      { date: '2026-10-02', time: '2026-10-02T01:00:00.000Z', path: '/browse', page: 'Browse Games', ip: 'b', session_id: 's2' }
    ],
    visitor_skips: { '2026-10-01': 4, '2026-10-02': 1 },
    message_taps: [
      { date: '2026-10-02', time: '2026-10-02T02:00:00.000Z', session_id: 's2', page: '/game/elden-ring', game: 'elden-ring', source: 'game' }
    ],
    search_misses: [
      { date: '2026-10-02', time: '2026-10-02T03:00:00.000Z', session_id: 's2', q: 'elden ring' }
    ]
  };
}

(async () => {
  console.log('\nmigration');

  check('migration ids are stable for the same row and index', () => {
    const row = { path: '/', time: '2026-10-01T00:00:00.000Z' };
    assert.strictEqual(migrationId('visitors', row, 3), migrationId('visitors', row, 3));
    assert.notStrictEqual(migrationId('visitors', row, 3), migrationId('visitors', row, 4));
    assert.notStrictEqual(migrationId('visitors', row, 3), migrationId('message_taps', row, 3));
  });

  check('trim empties the four analytics fields and leaves business data', () => {
    const trimmed = trimAnalytics(sampleState());
    assert.deepStrictEqual(trimmed.visitors, []);
    assert.deepStrictEqual(trimmed.visitor_skips, {});
    assert.deepStrictEqual(trimmed.message_taps, []);
    assert.deepStrictEqual(trimmed.search_misses, []);
    assert.deepStrictEqual(trimmed.games, [{ id: 1, title: 'Kept' }]);
    assert.strictEqual(trimmed.customers[0].id, 4);
    assert.strictEqual(hasAnalytics(trimmed), false);
    assert.strictEqual(hasAnalytics(sampleState()), true);
  });

  await checkAsync('migrate copies each row once; a second run does not duplicate it', async () => {
    const db = fakeDb();
    const store = createAnalyticsStore({ getDb: async () => db });
    const state = sampleState();
    const first = await store.migrate(state);
    const second = await store.migrate(state);
    assert.strictEqual(first.changed, true);
    assert.deepStrictEqual(first.copied, { visitors: 2, message_taps: 1, search_misses: 1, skips: 2 });
    assert.strictEqual(second.changed, true);
    assert.strictEqual(db.cols[COLLECTIONS.visitors].docs.size, 2);
    assert.strictEqual(db.cols[COLLECTIONS.message_taps].docs.size, 1);
    assert.strictEqual(db.cols[COLLECTIONS.search_misses].docs.size, 1);
    const skip = db.cols[COLLECTIONS.skips].docs.get('2026-10-01');
    assert.strictEqual(skip.count, 4);
    assert.ok(!db.names.includes('state'), 'migration must not write the state collection');
    // The caller's state document is not mutated; trimming is a separate step.
    assert.strictEqual(state.visitors.length, 2);
  });

  await checkAsync('skip migration uses the higher count, so a later $inc is not wound back', async () => {
    const db = fakeDb();
    const store = createAnalyticsStore({ getDb: async () => db });
    await store.migrate({ visitors: [], message_taps: [], search_misses: [], visitor_skips: { '2026-10-03': 10 } });
    await store.incSkip('2026-10-03', 1);
    await store.migrate({ visitors: [], message_taps: [], search_misses: [], visitor_skips: { '2026-10-03': 10 } });
    assert.strictEqual(db.cols[COLLECTIONS.skips].docs.get('2026-10-03').count, 11);
    await store.migrate({ visitors: [], message_taps: [], search_misses: [], visitor_skips: { '2026-10-03': 40 } });
    assert.strictEqual(db.cols[COLLECTIONS.skips].docs.get('2026-10-03').count, 40);
  });

  await checkAsync('an empty state migrates nothing', async () => {
    const db = fakeDb();
    const store = createAnalyticsStore({ getDb: async () => db });
    const result = await store.migrate({ games: [], visitors: [], visitor_skips: {}, message_taps: [], search_misses: [] });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(db.names.length, 0);
  });

  await checkAsync('with no database, migrate and live writes are no-ops', async () => {
    const store = createAnalyticsStore({ getDb: async () => null });
    const result = await store.migrate(sampleState());
    assert.strictEqual(result.changed, false);
    await store.addRows('visitors', [{ path: '/', time: '2026-10-01T00:00:00.000Z' }]);
    await store.incSkip('2026-10-01');
    assert.strictEqual(await store.hydrate(), null);
  });

  await checkAsync('only the newest rows are copied when a log is over its cap', async () => {
    const db = fakeDb();
    const store = createAnalyticsStore({
      getDb: async () => db,
      caps: { visitors: 2, message_taps: 1, search_misses: 1 }
    });
    await store.migrate({
      visitors: [
        { time: '2026-10-01T00:00:00.000Z', path: '/old' },
        { time: '2026-10-02T00:00:00.000Z', path: '/mid' },
        { time: '2026-10-03T00:00:00.000Z', path: '/new' }
      ],
      message_taps: [],
      search_misses: [],
      visitor_skips: {}
    });
    const paths = [...db.cols[COLLECTIONS.visitors].docs.values()].map(d => d.path).sort();
    assert.deepStrictEqual(paths, ['/mid', '/new']);
  });

  console.log('\nlive writes and hydrate');

  await checkAsync('a live visit is one small insert and never a state replacement', async () => {
    const db = fakeDb();
    const now = Date.parse('2026-10-24T00:00:00.000Z');
    const store = createAnalyticsStore({ getDb: async () => db, now: () => now });
    const row = { date: '2026-10-24', time: '2026-10-24T01:02:03.000Z', path: '/faq', page: 'FAQ', ip: 'abc', session_id: 's' };
    await store.addRows('visitors', [row]);
    await store.incSkip('2026-10-24');
    assert.deepStrictEqual(db.names.filter(n => n === 'state'), []);
    assert.strictEqual(db.cols[COLLECTIONS.visitors].docs.size, 1);
    const saved = [...db.cols[COLLECTIONS.visitors].docs.values()][0];
    assert.strictEqual(saved.path, '/faq');
    assert.strictEqual(saved.session_id, 's');
    assert.ok(saved.expireAt instanceof Date);
    assert.strictEqual(saved.expireAt.getTime() - Date.parse(row.time), RETENTION_MS);
    assert.strictEqual(db.cols[COLLECTIONS.skips].docs.get('2026-10-24').count, 1);
  });

  await checkAsync('hydrate restores the admin shape without mongo bookkeeping fields', async () => {
    const db = fakeDb();
    const store = createAnalyticsStore({ getDb: async () => db });
    const state = sampleState();
    await store.migrate(state);
    // A bot hit that landed after the copy must still show up.
    await store.incSkip('2026-10-02', 2);
    const hydrated = await store.hydrate();
    assert.deepStrictEqual(hydrated.visitors, state.visitors);
    assert.deepStrictEqual(hydrated.message_taps, state.message_taps);
    assert.deepStrictEqual(hydrated.search_misses, state.search_misses);
    assert.deepStrictEqual(hydrated.visitor_skips, { '2026-10-01': 4, '2026-10-02': 3 });
    hydrated.visitors.forEach(v => {
      assert.strictEqual(v._id, undefined);
      assert.strictEqual(v.expireAt, undefined);
      assert.strictEqual(v.ord, undefined);
    });
  });

  check('hydration fills only the logs the local file lost', () => {
    const remote = {
      visitors: [{ path: '/' }],
      message_taps: [{ source: 'nav' }],
      search_misses: [],
      visitor_skips: { '2026-10-01': 2 }
    };
    const empty = selectHydration(
      { visitors: [], message_taps: [], search_misses: [], visitor_skips: {} },
      remote
    );
    assert.deepStrictEqual(empty.visitors, remote.visitors);
    assert.deepStrictEqual(empty.message_taps, remote.message_taps);
    assert.strictEqual(empty.search_misses, undefined);
    assert.deepStrictEqual(empty.visitor_skips, remote.visitor_skips);

    const kept = selectHydration(
      { visitors: [{ path: '/local' }], message_taps: [], search_misses: [], visitor_skips: { '2026-10-09': 1 } },
      remote
    );
    assert.strictEqual(kept.visitors, undefined, 'local rows are the ones just migrated');
    assert.deepStrictEqual(kept.message_taps, remote.message_taps);
    assert.strictEqual(kept.visitor_skips, undefined);
  });

  await checkAsync('dropOlderThan removes only rows older than the retained window', async () => {
    const db = fakeDb();
    const store = createAnalyticsStore({ getDb: async () => db, now: () => Date.parse('2026-10-05T00:00:00.000Z') });
    await store.addRows('message_taps', [
      { time: '2026-10-01T00:00:00.000Z', source: 'old' },
      { time: '2026-10-04T00:00:00.000Z', source: 'keep' }
    ]);
    await store.dropOlderThan('message_taps', '2026-10-04T00:00:00.000Z');
    const left = [...db.cols[COLLECTIONS.message_taps].docs.values()].map(d => d.source);
    assert.deepStrictEqual(left, ['keep']);
  });

  await checkAsync('ensureIndexes asks for a TTL index on the three row collections', async () => {
    const db = fakeDb();
    const store = createAnalyticsStore({ getDb: async () => db });
    await store.ensureIndexes();
    for (const kind of ['visitors', 'message_taps', 'search_misses']) {
      const col = db.cols[COLLECTIONS[kind]];
      const ttl = col.indexes.find(i => i.spec.expireAt === 1 && i.opts.expireAfterSeconds === 0);
      assert.ok(ttl, kind + ' should expire on expireAt');
    }
    assert.ok(CAPS.visitors >= 200000);
    assert.ok(CAPS.message_taps >= 50000);
    assert.ok(CAPS.search_misses >= 20000);
  });

  console.log('\nserver wiring');

  check('visitor and webhook counters go through the analytics gate, not syncToMongo', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const skipStart = src.indexOf('function countSkippedVisit');
    const skipEnd = src.indexOf('app.use((req, res, next)', skipStart);
    const skip = src.slice(skipStart, skipEnd);
    assert.ok(skip.includes('withAnalytics'), 'countSkippedVisit must not mark the state document dirty');
    assert.ok(!src.includes('function syncToMongo'), 'the old per-write sync is gone');
    assert.ok(src.includes('createStateSync'));
    assert.ok(src.includes('createAnalyticsStore'));
    const pushStart = src.indexOf('function pushCapped');
    const push = src.slice(pushStart, src.indexOf('function countSkippedVisit'));
    assert.ok(push.includes('withAnalytics'));
    const hook = src.indexOf('db.write = function()');
    const genre = src.indexOf('genreMigration.apply(');
    assert.ok(hook > 0 && genre > hook, 'genre migration still runs after the mongo save hook');
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
