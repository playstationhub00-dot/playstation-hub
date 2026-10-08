// Run: node scripts/test-browse-page.js
//
// The Browse page as the server renders it for a URL: tier sections with no
// filter, one grid in tier order while filtering, the sticky filter bar's
// removable chips and count, the filter panel's sections, rows, counts and
// 0-options (a plain GET form), old links, the price bands from Settings, "PS
// Plus Deluxe" alone, and the facts and PS Plus games handed to the page script.
// The draft/apply rules are the same module (scripts/test-browse-filter-core.js).
// Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a
// stubbed PS Plus list); the project's games.json and the database are never
// touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4616;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-page-'));
const price = (nt7, nt30, tr7, tr30) => ({ nt_price_7d: nt7, nt_price_30d: nt30, tr_price_7d: tr7, tr_price_30d: tr30 });
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '/uploads/' + id + '.png',
  non_trophy_slots: 1, trophy_slots: 1, renters: 1, created_at: '2020-01-01T00:00:00.000Z'
}, price(349, 799, 399, 899), extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 }, browse_price_bands: { low: 180, high: 300 } },
  price_categories: [
    Object.assign({ id: 1, name: 'New Games' }, price(399, 899, 449, 999)),
    Object.assign({ id: 2, name: 'Deluxe', description: 'Big recent AAA games' }, price(249, 599, 299, 699)),
    Object.assign({ id: 3, name: 'Special', pill_color: 'pink' }, price(199, 499, 249, 549))
  ],
  psplus_prices: { nt_price_7d: 159, tr_price_7d: 199 },
  psplus_slots: { nt_slots: 1, tr_slots: 0, ps4_slots: 0 },
  games: [
    game(1, 'Zzyzx Astro', { price_category_id: 1, genre: 'Platformer', created_at: new Date().toISOString() }),
    game(2, 'Zzyzx Elden', { price_category_id: 2, genre: 'Action, RPG' }),
    game(3, 'Zzyzx Tekken', { price_category_id: 2, genre: 'Fighting', platform: 'PS4/PS5', ps4_primary_slots: 1 }),
    game(4, 'Zzyzx Callisto', { price_category_id: 3, genre: 'Horror', platform: 'PS4/PS5', non_trophy_slots: 0, trophy_slots: 0, buy_nt_price: 999 }),
    game(5, 'Zzyzx Plain', Object.assign({ platform: 'PS4', description: 'Old </script><b>favourite' }, price(149, 349, 199, 449)))
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.end();
  });
}
async function page(p) { const r = await call(p); assert.strictEqual(r.status, 200, p); return r.body; }
// The HTML between an element's id and the next element id from `ids`.
function between(html, startId, endId) {
  const i = html.indexOf('id="' + startId + '"');
  assert.ok(i >= 0, startId + ' found');
  const j = endId ? html.indexOf('id="' + endId + '"', i) : html.length;
  return html.slice(i, j);
}
const opening = (html, id) => { const i = html.indexOf('id="' + id + '"'); return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1); };
const cardIds = html => [...html.matchAll(/class="bf-item" data-id="(\d+)"/g)].map(m => Number(m[1]));
// The filter panel's row for an option, and its count.
function optHtml(html, group, value) {
  const m = new RegExp('<label class="bf-opt[^"]*" data-group="' + group + '" data-value="' + value + '">[\\s\\S]*?</label>').exec(html);
  assert.ok(m, 'option ' + group + '/' + value);
  return m[0];
}
const optCount = (html, group, value) => Number(/<span class="bf-n">(\d+)<\/span>/.exec(optHtml(html, group, value))[1]);
const barChips = html => [...between(html, 'bfChips', 'resultsCount').matchAll(/<a class="bf-chip-x" data-group="(\w+)" data-value="([^"]*)" href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(m => ({ group: m[1], value: m[2], href: m[3], label: m[4] }));
const countOf = html => /<span class="results-count" id="resultsCount">([^<]*)<\/span>/.exec(html)[1];
function browseData(html) {
  const m = /<script type="application\/json" id="browseData">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'embedded data');
  return JSON.parse(m[1]);
}

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  // A small PS Plus Deluxe list instead of the database copy.
  const today = new Date().toISOString();
  require('../lib/psplus-catalog-store').all = () => [
    { key: 'days-gone', name: 'Days Gone', image_url: 'https://image.test/dg.png', platforms: ['PS4'], genres: ['ACTION'], lists: ['catalog'], first_seen_at: '2020-01-01T00:00:00.000Z' },
    { key: 'returnal', name: 'Returnal', image_url: '', platforms: ['PS5'], genres: ['SHOOTER'], lists: ['catalog'], first_seen_at: today },
    { key: 'hidden-one', name: 'Hidden One', platforms: ['PS5'], genres: [], lists: ['catalog'], hidden: true }
  ];
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\nno filter');
  const all = await page('/browse');
  await okAsync('a section per tier in admin order, then Other games, each with its cards', async () => {
    const sec = between(all, 'bfSections', 'bfResults');
    const order = ['cat-section-1', 'cat-section-2', 'cat-section-3', 'cat-section-uncategorized'].map(id => sec.indexOf('id="' + id + '"'));
    assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), JSON.stringify(order));
    assert.deepStrictEqual(cardIds(sec), [1, 2, 3, 4, 5]);
    assert.ok(sec.includes('<p class="cat-desc">Big recent AAA games</p>'));
    assert.ok(!opening(all, 'bfSections').includes('hidden') && opening(all, 'bfResults').includes('hidden'));
  });
  await okAsync('the filter bar: a Filters button, no chips yet, and the count', async () => {
    assert.ok(opening(all, 'bfOpen').includes('href="#bfPanel"') && !opening(all, 'bfOpen').includes('bf-has'));
    assert.deepStrictEqual(barChips(all), []);
    assert.strictEqual(countOf(all), '5 games');
    assert.ok(all.indexOf('id="bfBar"') < all.indexOf('id="bfSections"'), 'above the games');
  });
  await okAsync('the panel: a form with every option the library supports, no Bundles without bundles', async () => {
    const panel = between(all, 'bfPanel', 'bfUpcoming');
    assert.ok(opening(all, 'bfPanel').includes('role="dialog"') && opening(all, 'bfPanel').includes('aria-modal="true"'));
    assert.ok(opening(all, 'bfForm').includes('method="get" action="/browse"'));
    const show = [...panel.matchAll(/data-group="show" data-value="(\w+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(show, ['avail', 'new', 'buy']);
    assert.deepStrictEqual([...panel.matchAll(/<section class="bf-sec" data-group="(\w+)">/g)].map(m => m[1]), ['show', 'tier', 'console', 'genre', 'price']);
    assert.ok(optHtml(all, 'show', 'new').includes('<input type="checkbox" name="new" value="1">'));
    assert.ok(optHtml(all, 'tier', 'psplus').includes('name="psplus" value="1"'));
    assert.ok(optHtml(all, 'genre', 'RPG').includes('name="genre" value="RPG"'));
    assert.strictEqual(optCount(all, 'genre', 'Action'), 2, '"Action, RPG" counts as Action');
    assert.ok(between(all, 'bfGo', 'bfUpcoming').startsWith('id="bfGo">Show 5 games</button>'));
  });
  await okAsync('tier rows show the colour, description and starting price; PS Plus its weekly price', async () => {
    const deluxe = optHtml(all, 'tier', '2');
    assert.ok(deluxe.includes('<span class="tier-dot tier-purple" aria-hidden="true"></span>'));
    assert.ok(deluxe.includes('Deluxe<span class="bf-opt-sub">Big recent AAA games · from ₱249</span>'));
    assert.ok(optHtml(all, 'tier', '3').includes('tier-pink') && optHtml(all, 'tier', '3').includes('<span class="bf-opt-sub">from ₱199</span>'));
    assert.ok(optHtml(all, 'tier', 'psplus').includes('<span class="bf-opt-sub">Hundreds of games, one account · from ₱159/week</span>'));
  });
  await okAsync('price options use the cut-offs from Settings and the card price', async () => {
    assert.ok(optHtml(all, 'price', 'low').includes('Under ₱180<'));
    assert.deepStrictEqual(['low', 'mid', 'high'].map(b => optCount(all, 'price', b)), [1, 3, 1]);
    assert.ok(optHtml(all, 'price', 'mid').includes('₱180–299<'));
  });

  console.log('\nfiltering');
  const f = await page('/browse?tier=2,3&console=ps4');
  await okAsync('one grid of the matches, tier order then A–Z; sections hidden', async () => {
    assert.deepStrictEqual(cardIds(between(f, 'bfGrid', 'bfPsplus')), [3, 4]);
    assert.ok(opening(f, 'bfSections').includes('hidden') && !opening(f, 'bfResults').includes('hidden'));
    assert.ok(opening(f, 'bfUpcoming').includes('hidden') && opening(f, 'bfPsMonthly').includes('hidden'));
    assert.deepStrictEqual(cardIds(f).sort(), [1, 2, 3, 4, 5], 'every card is still on the page once');
  });
  await okAsync('the bar: "Filters · 3", a chip per filter that removes just that one, Clear all, the count', async () => {
    assert.ok(opening(f, 'bfOpen').includes('bf-has') && between(f, 'bfOpenN', 'bfChips').startsWith('id="bfOpenN"> · 3</span>'));
    assert.deepStrictEqual(barChips(f), [
      { group: 'tier', value: '2', href: '/browse?tier=3&amp;console=ps4', label: 'Deluxe ✕' },
      { group: 'tier', value: '3', href: '/browse?tier=2&amp;console=ps4', label: 'Special ✕' },
      { group: 'console', value: 'ps4', href: '/browse?tier=2,3', label: 'PS4 ✕' }
    ]);
    assert.ok(between(f, 'bfChips', 'resultsCount').includes('<a class="bf-clear" href="/browse" data-clear-all="1">Clear all</a>'));
    assert.strictEqual(countOf(f), '2 games');
  });
  await okAsync('the panel starts from the applied filters: ticked, counts if ticked, dimmed 0-options', async () => {
    assert.ok(optHtml(f, 'tier', '2').includes(' checked') && optHtml(f, 'console', 'ps4').includes(' checked'));
    assert.ok(opening(f, 'bfPanel').includes('role="dialog"'));
    assert.strictEqual(optCount(f, 'genre', 'Horror'), 1);
    const plat = optHtml(f, 'genre', 'Platformer');
    assert.ok(plat.includes('bf-opt-zero') && plat.includes(' disabled>'));
    assert.strictEqual(optCount(f, 'console', 'ps5'), 3, 'PS4 or PS5 in Deluxe/Special');
    assert.ok(!between(f, 'bfPanel', 'bfUpcoming').includes('data-clear="tier" hidden'), 'Tier has a Clear');
    assert.ok(between(f, 'bfPanel', 'bfUpcoming').includes('data-clear="genre" hidden'), 'Genre has nothing to clear');
    assert.ok(between(f, 'bfGo', 'bfUpcoming').startsWith('id="bfGo">Show 2 games</button>'));
  });
  await okAsync('old links and the plain form\'s repeated fields keep working', async () => {
    const old = await page('/browse?ps4=1&newOnly=1');
    assert.ok(optHtml(old, 'console', 'ps4').includes(' checked') && optHtml(old, 'show', 'new').includes(' checked'));
    assert.strictEqual(countOf(old), '0 games', 'no PS4 game was just added');
    assert.ok(between(old, 'bfGo', 'bfUpcoming').startsWith('id="bfGo" disabled>No games match</button>'));
    const form = await page('/browse?tier=2&tier=3&console=ps4');
    assert.deepStrictEqual(cardIds(between(form, 'bfGrid', 'bfPsplus')), [3, 4]);
    const gone = await page('/browse?tier=99&genre=Nope');
    assert.ok(!opening(gone, 'bfSections').includes('hidden') && countOf(gone) === '5 games', 'a deleted tier in an old link is dropped');
  });
  await okAsync('a search shows as a removable chip and rides along in the form', async () => {
    const p = await page('/browse?search=elden&genre=Action');
    assert.deepStrictEqual(barChips(p).map(c => c.label), ['Action ✕', '&#34;elden&#34; ✕'], 'shown as "elden" ✕');
    assert.strictEqual(barChips(p)[1].href, '/browse?genre=Action');
    assert.ok(between(p, 'bfPanel', 'bfUpcoming').includes('<input type="hidden" name="search" value="elden">'));
  });

  console.log('\nPS Plus Deluxe');
  await okAsync('the page script gets the PS Plus list, the account price and availability', async () => {
    const d = browseData(all);
    assert.deepStrictEqual(d.psplus.map(p => p.k), ['days-gone', 'returnal'], 'hidden games left out');
    assert.deepStrictEqual(d.psplus[0], { k: 'days-gone', n: 'Days Gone', c: 'https://image.test/dg.png?w=240', ps4: true, ps5: false, g: 'Action', j: false });
    assert.strictEqual(d.psplus[1].j, true, 'joined today = just added');
    assert.deepStrictEqual([d.ctx.psplusFrom, d.ctx.psplusAvail, d.ctx.psplusAvailPs4], [159, true, false]);
    assert.deepStrictEqual(d.ctx.bands, { low: 180, high: 300 });
  });
  await okAsync('"PS Plus Deluxe" alone shows no site games and counts PS Plus games', async () => {
    const p = await page('/browse?psplus=1');
    assert.strictEqual(countOf(p), '2 PS Plus games');
    assert.ok(opening(p, 'bfResults').includes('hidden'));
    assert.strictEqual(optCount(p, 'genre', 'Action'), 1, 'Days Gone');
    assert.ok(between(p, 'bfGo', 'bfUpcoming').startsWith('id="bfGo">Show 2 PS Plus games</button>'));
  });
  await okAsync('a search only PS Plus has says so instead of "No games found"', async () => {
    const p = await page('/browse?search=returnal');
    assert.ok(between(p, 'bfEmpty', 'bfGrid').includes('None of our own games match — but these PS Plus games do.'));
    assert.ok(!opening(p, 'bfEmpty').includes('hidden'));
  });

  console.log('\npage script');
  await okAsync('facts for every game, safely embedded, plus the scripts and styles', async () => {
    const d = browseData(all);
    const elden = d.games.find(g => g.id === 2);
    assert.deepStrictEqual([elden.tier, elden.genres, elden.from, elden.home], ['2', ['Action', 'RPG'], 249, 'cat-2']);
    assert.deepStrictEqual(d.state, { search: '', avail: false, isNew: false, buy: false, bundle: false, tiers: [], psplus: false, consoles: [], genres: [], prices: [] });
    assert.ok(all.includes('\\u003c/script>\\u003cb>favourite'), 'a description cannot close the script');
    assert.ok(d.games.find(g => g.id === 5).text.includes('</script><b>favourite'));
    ['/js/browse-filter-core.js', '/js/browse.js', '/css/browse-filters.css'].forEach(src => assert.ok(all.includes(src + '?v='), src));
    assert.strictEqual((await call('/js/browse.js')).status, 200);
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'browse-filters.css'), 'utf8');
    assert.ok(css.includes('minmax(max(200px, calc((100% - 5rem) / 6)), 1fr)'), 'at most 6 a row');
  });
  await okAsync('the PS Plus page still shows its weekly price', async () => {
    const r = await call('/ps-plus');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('<b>₱159</b><span>/ week</span>'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
