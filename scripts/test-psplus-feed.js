// Run: node scripts/test-psplus-feed.js
//
// lib/psplus-feed.js against a saved copy of PlayStation's real game-finder
// feed (scripts/fixtures/psplus-feed/, captured 2026-09-27) and a stubbed
// fetch — no network. Checks the parse keeps what the site shows (name,
// cover, platforms, store link) and that every way a fetch can fail comes
// back as { ok: false } instead of throwing or looking like an empty list.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const feed = require('../lib/psplus-feed');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const FIX = path.join(__dirname, 'fixtures', 'psplus-feed');
const load = name => JSON.parse(fs.readFileSync(path.join(FIX, name + '.json'), 'utf8'));

console.log('\nfeedUrl()');

ok('builds the Indonesia URL for each list', () => {
  assert.strictEqual(feed.FEED_LOCALE, 'en-id');
  assert.strictEqual(feed.feedUrl('catalog'), 'https://www.playstation.com/bin/imagic/gameslist?locale=en-id&categoryList=plus-games-list');
  assert.strictEqual(feed.feedUrl('classics'), 'https://www.playstation.com/bin/imagic/gameslist?locale=en-id&categoryList=plus-classics-list');
  assert.strictEqual(feed.feedUrl('ubisoft'), 'https://www.playstation.com/bin/imagic/gameslist?locale=en-id&categoryList=ubisoft-classics-list');
  assert.strictEqual(feed.feedUrl('monthly'), 'https://www.playstation.com/bin/imagic/gameslist?locale=en-id&categoryList=plus-monthly-games-list');
});

ok('refuses a list it does not know', () => {
  assert.throws(() => feed.feedUrl('extra'), /unknown list/);
});

console.log('\nparseFeed() on the saved feed');

ok('reads every game in every list', () => {
  assert.strictEqual(feed.parseFeed(load('catalog')).length, 388);
  assert.strictEqual(feed.parseFeed(load('classics')).length, 151);
  assert.strictEqual(feed.parseFeed(load('ubisoft')).length, 67);
  assert.strictEqual(feed.parseFeed(load('monthly')).length, 6);
});

ok('keeps what the site needs from each game', () => {
  const gow = feed.parseFeed(load('catalog')).find(g => g.name_raw === 'God of War Ragnarök');
  assert.ok(gow, 'God of War Ragnarök is in the catalog');
  assert.ok(/^\d+$/.test(gow.concept_id));
  assert.ok(gow.image_url.startsWith('https://image.api.playstation.com/'));
  assert.deepStrictEqual(gow.platforms, ['PS5', 'PS4']);
  assert.ok(gow.store_url.startsWith('https://store.playstation.com/en-id/concept/'));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(gow.release_date));
  assert.ok(Array.isArray(gow.genres) && gow.genres.length > 0);
});

ok('drops a cover or store link from anywhere else, and a game with no id or name', () => {
  const games = feed.parseFeed([{ catalogKey: 'A', games: [
    { conceptId: 1, name: 'A', imageUrl: 'https://evil.example/x.png', conceptUrl: 'javascript:alert(1)', device: ['PS4'] },
    { conceptId: null, name: 'No id' },
    { conceptId: 2, name: '   ' }
  ] }]);
  assert.strictEqual(games.length, 1);
  assert.strictEqual(games[0].image_url, '');
  assert.strictEqual(games[0].store_url, '');
  assert.deepStrictEqual(games[0].platforms, ['PS4']);
});

ok('a feed in any other shape is unreadable, not empty', () => {
  assert.strictEqual(feed.parseFeed({ games: [] }), null);
  assert.strictEqual(feed.parseFeed(null), null);
  assert.deepStrictEqual(feed.parseFeed([]), []);
});

console.log('\nfetchList() with a stubbed fetch');

function stub(response) { return async () => response; }

(async () => {
  await okAsync('a good response is parsed', async () => {
    const r = await feed.fetchList('classics', { fetchImpl: stub({ ok: true, status: 200, json: async () => load('classics') }) });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.games.length, 151);
  });

  await okAsync('a non-200 response is a failed list', async () => {
    const r = await feed.fetchList('catalog', { fetchImpl: stub({ ok: false, status: 503, json: async () => ({}) }) });
    assert.deepStrictEqual([r.ok, r.reason, r.games.length], [false, 'http_503', 0]);
  });

  await okAsync('a body that is not JSON is a failed list', async () => {
    const r = await feed.fetchList('catalog', { fetchImpl: stub({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }) });
    assert.deepStrictEqual([r.ok, r.reason], [false, 'bad_json']);
  });

  await okAsync('JSON in the wrong shape is a failed list', async () => {
    const r = await feed.fetchList('catalog', { fetchImpl: stub({ ok: true, status: 200, json: async () => ({ error: 'moved' }) }) });
    assert.deepStrictEqual([r.ok, r.reason], [false, 'bad_shape']);
  });

  await okAsync('a network error is a failed list', async () => {
    const r = await feed.fetchList('catalog', { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    assert.deepStrictEqual([r.ok, r.reason], [false, 'network']);
  });

  await okAsync('a fetch that never answers times out', async () => {
    const hang = (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    });
    const r = await feed.fetchList('catalog', { fetchImpl: hang, timeoutMs: 20 });
    assert.deepStrictEqual([r.ok, r.reason], [false, 'timeout']);
  });

  await okAsync('fetchAll reads all four lists by name', async () => {
    const seen = [];
    const r = await feed.fetchAll({ fetchImpl: async url => { seen.push(url); return { ok: true, status: 200, json: async () => [] }; } });
    assert.deepStrictEqual(Object.keys(r).sort(), ['catalog', 'classics', 'monthly', 'ubisoft']);
    assert.strictEqual(seen.length, 4);
    assert.ok(Object.values(r).every(x => x.ok === true));
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
