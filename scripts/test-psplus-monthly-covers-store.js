// Run: node scripts/test-psplus-monthly-covers-store.js
//
// lib/psplus-monthly-covers-store.js against a fake MongoDB collection (same
// fake-collection shape scripts/test-psplus-catalog-store.js uses) and in
// memory-only mode. Checks the in-memory copy pages read from always matches
// what was written, and that "not found" is cached too.
const assert = require('assert');
const store = require('../lib/psplus-monthly-covers-store');

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function fakeDb() {
  const docs = new Map();
  return {
    db: { collection: () => ({
      find: () => ({ toArray: async () => [...docs.values()].map(d => Object.assign({}, d)) }),
      replaceOne: async (f, doc) => { docs.set(f._id, Object.assign({}, doc)); }
    }) },
    docs
  };
}

(async () => {
  console.log('\nwith MongoDB');

  await okAsync('refuses to run before init()', async () => {
    store.init(null);
    await assert.rejects(() => store.load(), /init\(getDb\) was never called/);
  });

  await okAsync('set() writes, and the in-memory copy follows', async () => {
    const { db, docs } = fakeDb();
    store.init(async () => db);
    store._reset([]);
    await store.set('stray', { title: 'Stray', image_url: 'https://image.api.playstation.com/x.png', store_url: 'https://www.playstation.com/en-us/games/stray/', resolved_at: '2026-09-27T05:00:00.000Z' });
    assert.deepStrictEqual(store.get('stray'), { title: 'Stray', image_url: 'https://image.api.playstation.com/x.png', store_url: 'https://www.playstation.com/en-us/games/stray/', resolved_at: '2026-09-27T05:00:00.000Z' });
    assert.strictEqual(docs.get('stray')._id, 'stray');
  });

  await okAsync('a title with no match is cached too, with an empty cover', async () => {
    const { db } = fakeDb();
    store.init(async () => db);
    store._reset([]);
    await store.set('made up game', { title: 'Made Up Game', image_url: '', store_url: '', resolved_at: '2026-09-27T05:00:00.000Z' });
    assert.deepStrictEqual(store.get('made up game'), { title: 'Made Up Game', image_url: '', store_url: '', resolved_at: '2026-09-27T05:00:00.000Z' });
  });

  await okAsync('load() fills the in-memory copy from the database', async () => {
    const { db, docs } = fakeDb();
    docs.set('stray', { _id: 'stray', title: 'Stray', image_url: 'https://image.api.playstation.com/x.png', store_url: '', resolved_at: '2026-09-20T00:00:00.000Z' });
    store.init(async () => db);
    store._reset([]);
    assert.strictEqual(await store.load(), true);
    assert.strictEqual(store.get('stray').title, 'Stray');
    assert.strictEqual(store.get('nope'), null);
  });

  await okAsync('a later search overwrites the earlier one for the same key', async () => {
    const { db } = fakeDb();
    store.init(async () => db);
    store._reset([['stray', { title: 'Stray', image_url: '', store_url: '', resolved_at: 'old' }]]);
    await store.set('stray', { title: 'Stray', image_url: 'https://image.api.playstation.com/new.png', store_url: '', resolved_at: 'new' });
    assert.strictEqual(store.get('stray').image_url, 'https://image.api.playstation.com/new.png');
  });

  console.log('\nwithout MongoDB (local dev)');

  await okAsync('everything works from memory alone', async () => {
    store.init(async () => null);
    store._reset([]);
    assert.strictEqual(await store.load(), false);
    await store.set('stray', { title: 'Stray', image_url: 'https://image.api.playstation.com/x.png', store_url: '', resolved_at: 'x' });
    assert.strictEqual(store.get('stray').image_url, 'https://image.api.playstation.com/x.png');
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
