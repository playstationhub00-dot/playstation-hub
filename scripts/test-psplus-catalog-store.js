// Run: node scripts/test-psplus-catalog-store.js
//
// lib/psplus-catalog-store.js against a fake MongoDB (just enough of find,
// findOne, bulkWrite, replaceOne, updateOne and deleteOne) and in memory-only
// mode. Checks the in-memory copy pages read from always matches what was
// written, that a failed write leaves it untouched, and that the owner-field
// route can't be used to change anything PlayStation sends.
const assert = require('assert');
const store = require('../lib/psplus-catalog-store');
const { OWNER_DEFAULTS } = require('../lib/psplus-catalog');

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function fakeDb({ failWrites } = {}) {
  const cols = { psplus_catalog: new Map(), psplus_catalog_meta: new Map() };
  const fail = () => { if (failWrites) throw new Error('simulated MongoDB failure'); };
  const collection = name => {
    const docs = cols[name];
    return {
      find: () => ({ toArray: async () => [...docs.values()].map(d => Object.assign({}, d)) }),
      findOne: async f => { const d = docs.get(f._id); return d ? Object.assign({}, d) : null; },
      bulkWrite: async ops => {
        fail();
        ops.forEach(op => {
          if (op.replaceOne) docs.set(op.replaceOne.filter._id, Object.assign({}, op.replaceOne.replacement));
          if (op.deleteOne) docs.delete(op.deleteOne.filter._id);
        });
      },
      replaceOne: async (f, doc) => { fail(); docs.set(f._id, Object.assign({}, doc)); },
      updateOne: async (f, u) => {
        fail();
        const d = docs.get(f._id);
        if (!d) return { matchedCount: 0 };
        Object.assign(d, u.$set);
        return { matchedCount: 1 };
      },
      deleteOne: async f => { fail(); docs.delete(f._id); }
    };
  };
  return { db: { collection }, cols };
}

function game(id, name, extra) {
  return Object.assign({}, OWNER_DEFAULTS, { key: 'c:' + id, source: 'feed', concept_id: String(id), name, name_raw: name,
    lists: ['catalog'], image_url: 'https://image.api.playstation.com/' + id + '.png', platforms: ['PS5'], genres: [],
    release_date: '', store_url: '', first_seen_at: '2026-09-27T00:00:00.000Z', updated_at: '2026-09-27T00:00:00.000Z' }, extra || {});
}

(async () => {
  console.log('\nwith MongoDB');

  await okAsync('refuses to run before init()', async () => {
    store.init(null);
    await assert.rejects(() => store.load(), /init\(getDb\) was never called/);
  });

  await okAsync('Apply writes, and the in-memory copy follows', async () => {
    const { db, cols } = fakeDb();
    store.init(async () => db);
    store._reset([]);
    await store.applyChanges({ upserts: [game(1, 'A'), game(2, 'B')], removals: [], meta: { last_refreshed_at: '2026-09-27T05:00:00.000Z', locale: 'en-id' } });
    assert.deepStrictEqual(store.all().map(g => g.key).sort(), ['c:1', 'c:2']);
    assert.strictEqual(cols.psplus_catalog.get('c:1')._id, 'c:1');
    assert.deepStrictEqual(store.meta(), { last_refreshed_at: '2026-09-27T05:00:00.000Z', locale: 'en-id' });
    await store.applyChanges({ upserts: [game(2, 'B2')], removals: ['c:1'] });
    assert.deepStrictEqual(store.all().map(g => [g.key, g.name]), [['c:2', 'B2']]);
    assert.ok(!cols.psplus_catalog.has('c:1'));
    assert.strictEqual(store.meta().locale, 'en-id', 'meta kept when a write carries none');
  });

  await okAsync('load() fills the in-memory copy from the database', async () => {
    const { db, cols } = fakeDb();
    cols.psplus_catalog.set('c:5', Object.assign({ _id: 'c:5' }, game(5, 'Loaded')));
    cols.psplus_catalog_meta.set('meta', { _id: 'meta', last_refreshed_at: '2026-09-20T00:00:00.000Z', locale: 'en-id' });
    store.init(async () => db);
    store._reset([]);
    assert.strictEqual(await store.load(), true);
    assert.deepStrictEqual(store.all().map(g => g.key), ['c:5']);
    assert.ok(!('_id' in store.all()[0]));
    assert.strictEqual(store.meta().last_refreshed_at, '2026-09-20T00:00:00.000Z');
  });

  await okAsync('a failed write leaves the in-memory copy untouched', async () => {
    const { db } = fakeDb({ failWrites: true });
    store.init(async () => db);
    store._reset([game(1, 'A')]);
    await assert.rejects(() => store.applyChanges({ upserts: [game(2, 'B')], removals: ['c:1'] }), /simulated/);
    assert.deepStrictEqual(store.all().map(g => g.key), ['c:1']);
    await assert.rejects(() => store.setOwnerFields('c:1', { hidden: true }), /simulated/);
    assert.strictEqual(store.get('c:1').hidden, false);
  });

  await okAsync('owner fields only — nothing PlayStation sends can be changed', async () => {
    const { db, cols } = fakeDb();
    store.init(async () => db);
    store._reset([]);
    await store.applyChanges({ upserts: [game(1, 'A')], removals: [] });
    assert.strictEqual(await store.setOwnerFields('c:1', { hidden: true, hidden_note: 'not on our region', name: 'Hacked', image_url: 'x' }), true);
    const g = store.get('c:1');
    assert.deepStrictEqual([g.hidden, g.hidden_note, g.name, g.image_url], [true, 'not on our region', 'A', 'https://image.api.playstation.com/1.png']);
    assert.strictEqual(cols.psplus_catalog.get('c:1').name, 'A');
    assert.strictEqual(await store.setOwnerFields('c:1', { name: 'Hacked' }), false, 'a patch with no owner field does nothing');
    assert.strictEqual(await store.setOwnerFields('c:99', { hidden: true }), false, 'no such game');
    assert.strictEqual(await store.setOwnerFields('../etc', { hidden: true }), false, 'not a key');
  });

  await okAsync('games added by hand get their own keys and can be removed; PlayStation games cannot', async () => {
    const { db, cols } = fakeDb();
    store.init(async () => db);
    store._reset([game(1, 'A')]);
    const a = await store.addManual({ name: '  My Game ', list: 'classics', platforms: ['PS4', 'PS5'], cover_override: '/uploads/m.webp' }, '2026-09-27T06:00:00.000Z');
    const b = await store.addManual({ name: 'Second', list: 'catalog', platforms: [] });
    assert.deepStrictEqual([a.key, a.name, a.lists, a.platforms, a.source, a.cover_override, a.first_seen_at],
      ['m:1', 'My Game', ['classics'], ['PS5', 'PS4'], 'manual', '/uploads/m.webp', '2026-09-27T06:00:00.000Z']);
    assert.strictEqual(b.key, 'm:2');
    assert.ok(cols.psplus_catalog.has('m:1'));
    assert.strictEqual(await store.addManual({ name: '', list: 'catalog' }), null);
    assert.strictEqual(await store.addManual({ name: 'X', list: 'monthly' }), null);
    assert.strictEqual(await store.removeManual('m:1'), true);
    assert.strictEqual(await store.removeManual('c:1'), false);
    assert.strictEqual(await store.removeManual('m:77'), false);
    assert.deepStrictEqual(store.all().map(g => g.key).sort(), ['c:1', 'm:2']);
  });

  console.log('\nwithout MongoDB (local dev)');

  await okAsync('everything works from memory alone', async () => {
    store.init(async () => null);
    store._reset([]);
    assert.strictEqual(await store.load(), false);
    await store.applyChanges({ upserts: [game(1, 'A')], removals: [], meta: { last_refreshed_at: 'x', locale: 'en-id' } });
    assert.strictEqual(await store.setOwnerFields('c:1', { rent_override: true, rent_game_id: 7 }), true);
    assert.deepStrictEqual([store.get('c:1').rent_game_id, store.meta().locale], [7, 'en-id']);
    assert.ok(store.isKey('c:12') && store.isKey('m:3') && !store.isKey('mo:1:0') && !store.isKey('c:1;x'));
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
