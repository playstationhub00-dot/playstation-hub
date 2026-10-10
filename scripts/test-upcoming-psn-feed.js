// Run: node scripts/test-upcoming-psn-feed.js
//
// PlayStation's upcoming games list (lib/upcoming-psn-feed.js): the query it
// sends and what it keeps from the reply. fetch is a stub — nothing here
// reaches PlayStation.
const assert = require('assert');
const feed = require('../lib/upcoming-psn-feed');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const NOW = Date.UTC(2026, 9, 10, 4, 0);
const DAY = 86400000;
const hit = (id, name, ts, extra) => Object.assign({
  conceptId: id, productName: name, releaseDateTimestamp: ts, platforms: ['PS5'], genre: ['Action'],
  publisher: ' Pub ', image: ['https://image.api.playstation.com/vulcan/' + id + '.png'], productType: 'FULL_GAME'
}, extra || {});
const reply = hits => ({ results: [{ hits }] });

async function main() {
  console.log('\nquery');
  ok('asks for game pages released after now, 200 at a time, only the fields it uses', () => {
    const body = JSON.parse(feed.queryBody(NOW));
    assert.strictEqual(body.requests[0].indexName, 'crawler_en-us');
    const params = new URLSearchParams(body.requests[0].params);
    assert.strictEqual(params.get('query'), '');
    assert.strictEqual(params.get('hitsPerPage'), '200');
    assert.strictEqual(params.get('filters'), 'pageType:game AND releaseDateTimestamp > ' + NOW);
    assert.strictEqual(params.get('attributesToRetrieve'), 'productName,releaseDateTimestamp,platforms,genre,conceptId,publisher,image,productType');
  });

  console.log('\nparse');
  const games = feed.parseHits(reply([
    hit(30, 'Late Game™', NOW + 90 * DAY),
    hit(10, 'Call of Duty®: Modern Warfare® 4', NOW + 13 * DAY, { productType: 'GAME_BUNDLE', platforms: ['PS4', 'PS5'] }),
    hit('20', 'Fable Standard Edition', NOW + 5 * DAY, { platforms: ['PS4'], image: ['https://evil.example/x.png'] }),
    hit(40, 'Already Out', NOW - DAY),
    hit(41, 'Out Right Now', NOW),
    hit(42, 'No Date', undefined),
    hit(43, 'An Add-on', NOW + DAY, { productType: 'ADD_ON' }),
    hit(44, 'VR Only', NOW + DAY, { platforms: ['PS VR2'] }),
    hit('', 'No Concept', NOW + DAY),
    hit('12ab', 'Odd Concept', NOW + DAY),
    hit(45, '   ', NOW + DAY),
    null
  ]), NOW);
  ok('keeps future full games and bundles on PS5/PS4, sorted by date', () => {
    assert.deepStrictEqual(games.map(g => g.concept_id), ['20', '10', '30']);
  });
  ok('each game: clean title, raw title, Manila date, platform, genres, publisher, PlayStation-hosted image', () => {
    assert.deepStrictEqual(games[1], {
      concept_id: '10', title: 'Call of Duty: Modern Warfare 4', raw_title: 'Call of Duty®: Modern Warfare® 4',
      release_date: '2026-10-23', platform: 'PS4/PS5', genres: ['Action'], publisher: 'Pub',
      image_url: 'https://image.api.playstation.com/vulcan/10.png'
    });
    assert.strictEqual(games[0].title, 'Fable');
    assert.strictEqual(games[0].platform, 'PS4');
    assert.strictEqual(games[0].image_url, '', 'an image from anywhere else is dropped');
  });
  ok('a reply of another shape is null; an empty one is an empty list', () => {
    assert.strictEqual(feed.parseHits({ message: 'Invalid key' }, NOW), null);
    assert.strictEqual(feed.parseHits(null, NOW), null);
    assert.deepStrictEqual(feed.parseHits(reply([]), NOW), []);
  });

  console.log('\nfetch');
  await okAsync('posts the query with the search-only key and returns the games', async () => {
    let seen = null;
    const r = await feed.fetchUpcoming({
      now: () => NOW,
      fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => reply([hit(10, 'A', NOW + DAY)]) }; }
    });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.games.map(g => g.concept_id), ['10']);
    assert.strictEqual(seen.url, 'https://uls2j1qb99-dsn.algolia.net/1/indexes/*/queries');
    assert.strictEqual(seen.init.method, 'POST');
    assert.strictEqual(seen.init.headers['X-Algolia-Application-Id'], 'ULS2J1QB99');
    assert.strictEqual(seen.init.body, feed.queryBody(NOW));
  });
  await okAsync('failures come back as reasons, never thrown', async () => {
    const bad = async impl => (await feed.fetchUpcoming({ now: () => NOW, fetchImpl: impl, timeoutMs: 30 })).reason;
    assert.strictEqual(await bad(async () => ({ ok: false, status: 403 })), 'http_403');
    assert.strictEqual(await bad(async () => ({ ok: true, json: async () => { throw new Error('x'); } })), 'bad_json');
    assert.strictEqual(await bad(async () => ({ ok: true, json: async () => ({ nope: 1 }) })), 'bad_shape');
    assert.strictEqual(await bad(async () => { throw new Error('ECONNRESET'); }), 'network');
    assert.strictEqual(await bad((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    })), 'timeout');
  });

  console.log('\n' + passed + ' assertions passed\n');
}

main().catch(e => { console.error(e); process.exit(1); });
