// Run: node scripts/test-psplus-title-search.js
//
// lib/psplus-title-search.js — finding a real PlayStation cover for one of the
// owner's monthly picks by title, against a stubbed fetch (no network). Real
// hit shapes below are trimmed copies of what PlayStation's own search index
// actually returns for these exact titles (captured 2026-09-27).
const assert = require('assert');
const search = require('../lib/psplus-title-search');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function hit(productName, image, url) {
  return { productName, pageType: 'game', image: image ? [image] : [], url: url || '' };
}
function stub(json) { return async () => ({ ok: true, status: 200, json: async () => json }); }
const results = hits => ({ results: [{ hits }] });

console.log('\npickHit()');

ok('prefers a hit whose title actually contains the query over the top-ranked one', () => {
  const hits = [hit('EA SPORTS™ College Football 26'), hit('EA SPORTS™ Madden NFL 26')];
  assert.strictEqual(search.pickHit(hits, 'Madden NFL 26').productName, 'EA SPORTS™ Madden NFL 26');
});

ok('falls back to the top hit when nothing matches by name', () => {
  assert.strictEqual(search.pickHit([hit('Something Else')], 'Totally Different Game').productName, 'Something Else');
});

ok('no hits at all is null, not a throw', () => {
  assert.strictEqual(search.pickHit([], 'X'), null);
  assert.strictEqual(search.pickHit(null, 'X'), null);
});

console.log('\nsearchCover() with a stubbed fetch');

(async () => {
  await okAsync('a real match returns its cover and store/info link', async () => {
    const r = await search.searchCover('Stray', { fetchImpl: stub(results([
      hit('Stray', 'https://image.api.playstation.com/vulcan/ap/rnd/202206/0300/E2vZwVaDJbhLZpJo7Q10IyYo.png', 'https://www.playstation.com/en-us/games/stray/')
    ])) });
    assert.deepStrictEqual(r, {
      ok: true, name: 'Stray',
      image_url: 'https://image.api.playstation.com/vulcan/ap/rnd/202206/0300/E2vZwVaDJbhLZpJo7Q10IyYo.png',
      store_url: 'https://www.playstation.com/en-us/games/stray/'
    });
  });

  await okAsync('a cover or link from anywhere else is dropped, not passed through', async () => {
    const r = await search.searchCover('Chained Echoes', { fetchImpl: stub(results([
      hit('Chained Echoes', 'https://evil.example/x.png', 'https://evil.example/game')
    ])) });
    assert.deepStrictEqual([r.ok, r.image_url, r.store_url], [true, '', '']);
  });

  await okAsync('no hits: not found, not thrown', async () => {
    const r = await search.searchCover('Some Totally Made Up Title Xyzzy', { fetchImpl: stub(results([])) });
    assert.deepStrictEqual(r, { ok: false, reason: 'no_match' });
  });

  await okAsync('an empty title is refused before any request', async () => {
    assert.deepStrictEqual(await search.searchCover('  '), { ok: false, reason: 'empty_title' });
    assert.deepStrictEqual(await search.searchCover(null), { ok: false, reason: 'empty_title' });
  });

  await okAsync('every fetch failure comes back as { ok: false, reason }, never a throw', async () => {
    assert.deepStrictEqual(await search.searchCover('X', { fetchImpl: async () => ({ ok: false, status: 500 }) }), { ok: false, reason: 'http_500' });
    assert.deepStrictEqual(await search.searchCover('X', { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }) }), { ok: false, reason: 'bad_json' });
    assert.deepStrictEqual(await search.searchCover('X', { fetchImpl: async () => { throw new TypeError('fetch failed'); } }), { ok: false, reason: 'network' });
    const hang = (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    });
    assert.deepStrictEqual(await search.searchCover('X', { fetchImpl: hang, timeoutMs: 20 }), { ok: false, reason: 'timeout' });
  });

  await okAsync('the request asks Algolia for games only, by this exact query text', async () => {
    let seenUrl, seenBody, seenHeaders;
    await search.searchCover('Madden NFL 26', {
      fetchImpl: async (url, opts) => {
        seenUrl = url; seenBody = JSON.parse(opts.body); seenHeaders = opts.headers;
        return { ok: true, status: 200, json: async () => results([hit('EA SPORTS™ Madden NFL 26')]) };
      }
    });
    assert.strictEqual(seenUrl, 'https://uls2j1qb99-dsn.algolia.net/1/indexes/*/queries');
    assert.strictEqual(seenBody.requests[0].indexName, 'crawler_en-us');
    assert.ok(seenBody.requests[0].params.includes('query=Madden%20NFL%2026'));
    assert.ok(seenBody.requests[0].params.includes('filters=pageType%3Agame'));
    assert.strictEqual(seenHeaders['X-Algolia-Application-Id'], 'ULS2J1QB99');
    assert.ok(seenHeaders['X-Algolia-API-Key']);
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
