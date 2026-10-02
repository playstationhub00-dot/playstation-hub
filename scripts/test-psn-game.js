// Run: node scripts/test-psn-game.js
//
// lib/psn-game.js: parsing a store page (against scripts/fixtures/psn-concept.html,
// a trimmed invented copy of the real page shape) and fetching with a stubbed
// fetch. Nothing here reaches PlayStation.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const psn = require('../lib/psn-game');

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const PAGE = fs.readFileSync(path.join(__dirname, 'fixtures', 'psn-concept.html'), 'utf8');

// A fetch stub: the search index answers with `hits`, store pages with `page`.
function stubFetch({ hits = [], page = PAGE, searchStatus = 200, pageStatus = 200, throwOn = null } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (throwOn && url.includes(throwOn)) { const e = new Error('boom'); e.name = 'TypeError'; throw e; }
    if (url.includes('algolia')) {
      return { ok: searchStatus === 200, status: searchStatus, json: async () => ({ results: [{ hits }] }) };
    }
    return { ok: pageStatus === 200, status: pageStatus, text: async () => page };
  };
  impl.calls = calls;
  return impl;
}

async function main() {
  console.log('\ncleanLink / titleCandidates / cleanDescription');
  await ok('only PlayStation Store concept / product links are accepted', async () => {
    assert.strictEqual(psn.cleanLink(' https://store.playstation.com/en-ph/concept/10015533 '), 'https://store.playstation.com/en-ph/concept/10015533');
    assert.strictEqual(psn.cleanLink('https://store.playstation.com/en-us/product/UP0102-PPSA30803_00-REREQUIEM0000000'), 'https://store.playstation.com/en-us/product/UP0102-PPSA30803_00-REREQUIEM0000000');
    assert.strictEqual(psn.cleanLink('https://evil.example/en-us/concept/1'), '');
    assert.strictEqual(psn.cleanLink('http://store.playstation.com/en-us/concept/1'), '');
    assert.strictEqual(psn.cleanLink('https://store.playstation.com/en-us/concept/1?x=1'), '');
    assert.strictEqual(psn.cleanLink(undefined), '');
  });
  await ok('an edition suffix adds a base-name candidate', async () => {
    assert.deepStrictEqual(psn.titleCandidates('Control Resonant Deluxe Edition'), ['Control Resonant Deluxe Edition', 'Control Resonant']);
    assert.deepStrictEqual(psn.titleCandidates('Hades II'), ['Hades II']);
    assert.deepStrictEqual(psn.titleCandidates('Game: Ultimate Edition'), ['Game: Ultimate Edition', 'Game']);
  });
  await ok('descriptions become clean paragraphs without store fine print', async () => {
    const t = psn.cleanDescription('Line one.<br/><br/>Two &amp; <b>three</b>.<br/>&quot;Four&quot;<br/><br/> *There are other bundles. Be careful.<br/>');
    assert.strictEqual(t, 'Line one.\n\nTwo & three.\n"Four"');
    assert.strictEqual(psn.cleanDescription(''), '');
    assert.strictEqual(psn.cleanDescription('There are other bundles that include this product.'), '');
  });

  console.log('\nparseConceptPage');
  const p = psn.parseConceptPage(PAGE);
  await ok('reads the overview, tagline and details', async () => {
    assert.strictEqual(p.concept_id, '900001');
    assert.strictEqual(p.matched_title, 'Zzyzx Quest');
    assert.strictEqual(p.tagline, 'Dig deep. Dig far.');
    assert.strictEqual(p.description, 'A new era of digging begins.\n\nExplore every cave & tunnel.\nFight "the Deep".');
    assert.deepStrictEqual(p.genres, ['Action', 'Adventure']);
    assert.strictEqual(p.release_date, '2026-02-27');
    assert.strictEqual(p.publisher, 'Zzyzx Games, Inc.');
    assert.strictEqual(p.age_rating, 'ESRB Mature');
    assert.deepStrictEqual(p.rating, { avg: 4.9, count: 103548 });
  });
  await ok('voices are language names, unknown codes and repeats dropped', async () => {
    assert.deepStrictEqual(p.voices, ['English', 'Japanese', 'Latin American Spanish']);
  });
  await ok('media keeps only PlayStation hosts, without repeats, in page order', async () => {
    assert.deepStrictEqual(p.screenshots, [
      'https://image.api.playstation.com/vulcan/ap/rnd/1/shot1.jpg',
      'https://image.api.playstation.com/vulcan/ap/rnd/1/shot2.jpg'
    ]);
    assert.deepStrictEqual(p.videos, [
      'https://vulcan.dl.playstation.net/img/rnd/1/trailer1.mp4',
      'https://vulcan.dl.playstation.net/img/rnd/1/trailer2.mp4'
    ]);
  });
  await ok('media is capped at 12 screenshots and 3 videos', async () => {
    let many = '';
    for (let i = 0; i < 20; i++) many += '{"__typename":"Media","role":"SCREENSHOT","type":"IMAGE","url":"https://image.api.playstation.com/s' + i + '.jpg"},';
    for (let i = 0; i < 6; i++) many += '{"__typename":"Media","role":"PREVIEW","type":"VIDEO","url":"https://vulcan.dl.playstation.net/v' + i + '.mp4"},';
    const r = psn.parseConceptPage(many);
    assert.strictEqual(r.screenshots.length, 12);
    assert.strictEqual(r.videos.length, 3);
  });
  await ok('a page with nothing usable is null, not an empty record', async () => {
    assert.strictEqual(psn.parseConceptPage('<html>Just a moment...</html>'), null);
    assert.strictEqual(psn.parseConceptPage(''), null);
    assert.strictEqual(psn.parseConceptPage(undefined), null);
  });

  console.log('\nfetchGameInfo');
  const HIT = { productName: 'Zzyzx Quest', conceptId: '900001' };
  const NOW = () => new Date('2026-10-02T10:00:00.000Z');
  await ok('title search then page fetch gives a full record', async () => {
    const f = stubFetch({ hits: [HIT] });
    const r = await psn.fetchGameInfo({ title: 'Zzyzx Quest' }, { fetchImpl: f, now: NOW });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.psn.source, 'auto');
    assert.strictEqual(r.psn.store_url, 'https://store.playstation.com/en-us/concept/900001');
    assert.strictEqual(r.psn.fetched_at, '2026-10-02T10:00:00.000Z');
    assert.strictEqual(r.psn.description.startsWith('A new era'), true);
    assert.strictEqual(f.calls[1].url, 'https://store.playstation.com/en-us/concept/900001');
    assert.ok(/Mozilla/.test(f.calls[1].init.headers['User-Agent']));
  });
  await ok('a pasted store link wins over the search and is marked manual', async () => {
    const f = stubFetch({ hits: [] });
    const r = await psn.fetchGameInfo({ title: 'Anything', psn_link: 'https://store.playstation.com/en-ph/concept/900001' }, { fetchImpl: f, now: NOW });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.psn.source, 'manual');
    assert.strictEqual(f.calls.length, 1, 'no search call');
    assert.strictEqual(f.calls[0].url, 'https://store.playstation.com/en-ph/concept/900001');
  });
  await ok('a hit for a different game is not a match', async () => {
    const f = stubFetch({ hits: [{ productName: 'College Football 26', conceptId: '5' }] });
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: 'Madden NFL 26' }, { fetchImpl: f }), { ok: false, reason: 'no_match' });
  });
  await ok('an exact title match beats a longer title that merely contains it', async () => {
    const f = stubFetch({ hits: [{ productName: "Marvel's Spider-Man 2", conceptId: '22' }, { productName: "Marvel's Spider-Man", conceptId: '11' }] });
    assert.deepStrictEqual(await psn.searchConcept("Marvel's Spider-Man", { fetchImpl: f }), { ok: true, concept_id: '11' });
    const g = stubFetch({ hits: [{ productName: "Marvel's Spider-Man 2", conceptId: '22' }] });
    assert.deepStrictEqual(await psn.searchConcept("Marvel's Spider-Man", { fetchImpl: g }), { ok: true, concept_id: '22' }, 'still falls back to contains');
  });
  await ok('an edition title falls back to the base name', async () => {
    let n = 0;
    const f = async (url, init) => {
      if (url.includes('algolia')) {
        n++;
        const q = decodeURIComponent(JSON.parse(init.body).requests[0].params);
        return { ok: true, status: 200, json: async () => ({ results: [{ hits: /Deluxe/.test(q) ? [] : [HIT] }] }) };
      }
      return { ok: true, status: 200, text: async () => PAGE };
    };
    const r = await psn.fetchGameInfo({ title: 'Zzyzx Quest Deluxe Edition' }, { fetchImpl: f });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(n, 2);
  });
  await ok('failures come back as reasons and never throw', async () => {
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: 'X' }, { fetchImpl: stubFetch({ searchStatus: 500 }) }), { ok: false, reason: 'http_500' });
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: 'Zzyzx Quest' }, { fetchImpl: stubFetch({ hits: [HIT], pageStatus: 403 }) }), { ok: false, reason: 'http_403' });
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: 'Zzyzx Quest' }, { fetchImpl: stubFetch({ hits: [HIT], page: '<html>Just a moment...</html>' }) }), { ok: false, reason: 'empty_page' });
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: 'Zzyzx Quest' }, { fetchImpl: stubFetch({ hits: [HIT], throwOn: 'store.playstation' }) }), { ok: false, reason: 'network' });
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: '' }, { fetchImpl: stubFetch() }), { ok: false, reason: 'empty_title' });
  });

  console.log('\n' + passed + ' assertions passed\n');
}
main().catch(e => { console.error(e); process.exit(1); });
