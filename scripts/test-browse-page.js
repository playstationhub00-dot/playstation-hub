// Run: node scripts/test-browse-page.js
//
// The Browse catalog as the server renders it for a URL: the search box, the
// tab row (counts, hidden empty tabs, the active tab), each tab's grid in its
// order, #1–#10 badges on Most rented, Coming soon cards, the PS Plus Deluxe
// tab, the Sort menu, filters on top of a tab, the filter bar and panel, a
// tier's description, the empty grid, old links, and the facts handed to the
// page script. The rules themselves: scripts/test-browse-filter-core.js.
// Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory
// sessions, a stubbed PS Plus list); the project's games.json and the
// database are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4616;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-page-'));
const daysAgo = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
// A local calendar date d days from today — the Coming soon card counts days in local time.
const daysAhead = d => {
  const t = new Date(Date.now() + d * 86400000);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
};
const price = (nt7, nt30, tr7, tr30) => ({ nt_price_7d: nt7, nt_price_30d: nt30, tr_price_7d: tr7, tr_price_30d: tr30 });
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '/uploads/' + id + '.png',
  non_trophy_slots: 1, trophy_slots: 1, renters: 0, created_at: '2020-01-01T00:00:00.000Z'
}, price(349, 799, 399, 899), extra || {});
const up = (id, title, release_date) => Object.assign({
  id, title, platform: 'PS5', release_date, cover_image: '/uploads/up' + id + '.png', non_trophy_slots: 1, trophy_slots: 1
}, price(349, 1099, 0, 0));
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
    game(1, 'Zzyzx Astro', { price_category_id: 1, genre: 'Platformer', release_date: daysAgo(5) }),
    game(2, 'Zzyzx Elden', { price_category_id: 2, genre: 'Action, RPG', release_date: '2022-02-25', renters: 9 }),
    game(3, 'Zzyzx Tekken', { price_category_id: 2, genre: 'Fighting', platform: 'PS4/PS5', ps4_primary_slots: 1, release_date: '2024-01-26', renters: 3, discounts: { 7: 40 } }),
    game(4, 'Zzyzx Callisto', { price_category_id: 3, genre: 'Horror', platform: 'PS4/PS5', non_trophy_slots: 0, trophy_slots: 0, buy_nt_price: 999 }),
    game(5, 'Zzyzx Plain', Object.assign({ platform: 'PS4', description: 'Old </script><b>favourite', release_date: 'TBA', renters: 1 }, price(149, 349, 199, 449))),
    game(6, 'PS Plus Deluxe', { genre: '' })
  ],
  customers: [{ id: 1, game_id: 3, start_date: daysAgo(2), status: 'renting' }],
  upcoming: [up(1, 'Zzyzx Wolverine', daysAhead(30)), up(2, 'Zzyzx Fable', 'TBA'), up(3, 'Zzyzx Marvel', daysAhead(5))]
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
// The HTML between an element's id and the next element id given.
function between(html, startId, endId) {
  const i = html.indexOf('id="' + startId + '"');
  assert.ok(i >= 0, startId + ' found');
  const j = endId ? html.indexOf('id="' + endId + '"', i) : html.length;
  return html.slice(i, j);
}
const opening = (html, id) => { const i = html.indexOf('id="' + id + '"'); return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1); };
const unamp = s => s.replace(/&amp;/g, '&');
// The game cards the grid shows, in order (hidden ones wait for another tab).
const shown = html => [...between(html, 'bfGrid', 'bfSoonGrid').matchAll(/<div class="bf-item" data-id="(\d+)"( hidden)?>/g)].filter(m => !m[2]).map(m => Number(m[1]));
const allCards = html => [...between(html, 'bfGrid', 'bfSoonGrid').matchAll(/<div class="bf-item" data-id="(\d+)"/g)].map(m => Number(m[1]));
const soonShown = html => [...between(html, 'bfSoonGrid', 'bfPsplus').matchAll(/<div class="bf-item" data-soon="(\d+)"( hidden)?>/g)].filter(m => !m[2]).map(m => Number(m[1]));
const tabs = html => [...between(html, 'bfTabs', 'bfBar').matchAll(/<a class="bf-tab( on)?" data-tab="([\w-]+)" href="([^"]*)"[^>]*>([^<]*?) <span class="bf-tab-n">(\d+)<\/span><\/a>/g)]
  .map(m => ({ key: m[2], on: !!m[1], href: unamp(m[3]), label: m[4], count: Number(m[5]) }));
const countOf = html => /<span class="bf-count" id="bfCount">([^<]*)<\/span>/.exec(html)[1];
const sorts = html => [...between(html, 'bfSort', 'bfOpen').matchAll(/<option value="([\w-]+)"( selected)?>/g)].map(m => (m[2] ? '*' : '') + m[1]);
const barChips = html => [...between(html, 'bfChips', 'bfPanel').matchAll(/<a class="bf-chip-x" data-group="(\w+)" data-value="([^"]*)" href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(m => ({ group: m[1], value: m[2], href: unamp(m[3]), label: m[4] }));
const ranks = html => [...between(html, 'bfGrid', 'bfSoonGrid').matchAll(/<span class="bf-rank bf-rk-(\d+)"( hidden)?>#\d+<\/span>/g)].map(m => (m[2] ? 'hidden ' : '') + '#' + m[1]);
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
  require('../lib/psplus-catalog-store').all = () => [
    { key: 'returnal', name: 'Returnal', image_url: '', platforms: ['PS5'], genres: ['SHOOTER'], lists: ['catalog'] },
    { key: 'days-gone', name: 'Days Gone', image_url: 'https://image.test/dg.png', platforms: ['PS4'], genres: ['ACTION'], lists: ['catalog'] },
    { key: 'hidden-one', name: 'Hidden One', platforms: ['PS5'], genres: [], lists: ['catalog'], hidden: true }
  ];
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const all = await page('/browse');

  console.log('\nthe page');
  await okAsync('title, search box, the tab row with counts (no Bundles tab: there are none), All games on', async () => {
    assert.ok(all.includes('<h1>Browse games</h1>'));
    assert.ok(opening(all, 'bfSearch').includes('placeholder="Search 6 games…"'));
    assert.ok(opening(all, 'bfSearch').includes('value=""'));
    assert.deepStrictEqual(tabs(all).map(t => t.key + ' ' + t.count), ['all 6', 'most-rented 3', 'new 3', 'coming-soon 3', 'deals 1', 'available 5', 'buy 1', 'psplus 2']);
    assert.deepStrictEqual(tabs(all).filter(t => t.on).map(t => t.key), ['all']);
    assert.ok(all.includes('data-tab="all" href="/browse" aria-current="page"'));
    assert.deepStrictEqual(tabs(all).slice(1, 4).map(t => t.href), ['/browse?tab=most-rented', '/browse?tab=new', '/browse?tab=coming-soon']);
    assert.strictEqual(countOf(all), 'All games · 6 games');
  });
  await okAsync('All games: every game, most rented first, then the never-rented A–Z', async () => {
    assert.deepStrictEqual(shown(all), [3, 2, 5, 6, 1, 4]);
    assert.deepStrictEqual(ranks(all), ['hidden #1', 'hidden #2', 'hidden #3'], 'badges wait for the Most rented tab');
    assert.deepStrictEqual(sorts(all), ['*most-rented', 'newest', 'price-asc', 'price-desc', 'az']);
    assert.ok(opening(all, 'bfSoonGrid').includes(' hidden') && opening(all, 'bfPsplus').includes(' hidden'));
    assert.ok(opening(all, 'bfEmpty').includes(' hidden'));
  });
  await okAsync('the old page is gone: no Coming soon slider, tier sections or PS Plus monthly block', async () => {
    ['upcomingSlider', 'slideUpcoming', 'bfSections', 'cat-section', 'psplus-entries', 'psplus-browse-entry', 'Also in PS Plus Deluxe'].forEach(t => assert.ok(!all.includes(t), t));
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'views', 'partials', 'upcoming-section.ejs')));
  });

  console.log('\ntabs');
  await okAsync('Most rented: rented games only, with #1–#10 badges', async () => {
    const h = await page('/browse?tab=most-rented');
    assert.deepStrictEqual(shown(h), [3, 2, 5]);
    assert.deepStrictEqual(allCards(h).sort(), [1, 2, 3, 4, 5, 6], 'every card is on the page for the other tabs');
    assert.deepStrictEqual(ranks(h), ['#1', '#2', '#3']);
    assert.ok(h.includes('data-tab="most-rented" href="/browse?tab=most-rented" aria-current="page"'));
    assert.strictEqual(countOf(h), 'Most rented · 3 games');
    assert.deepStrictEqual(ranks(await page('/browse?tab=most-rented&sort=az')).sort(), ['hidden #1', 'hidden #2', 'hidden #3'], 'only in Most rented order');
  });
  await okAsync('New releases: released games, newest first (TBA and undated left out)', async () => {
    const h = await page('/browse?tab=new');
    assert.deepStrictEqual(shown(h), [1, 3, 2]);
    assert.deepStrictEqual(sorts(h), ['*newest', 'most-rented', 'price-asc', 'price-desc', 'az']);
  });
  await okAsync('Coming soon: every Coming soon game, soonest first, TBA last; no filters', async () => {
    const h = await page('/browse?tab=coming-soon');
    assert.deepStrictEqual(soonShown(h), [3, 1, 2]);
    assert.deepStrictEqual(shown(h), []);
    assert.ok(opening(h, 'bfGrid').includes(' hidden'));
    assert.ok(between(h, 'bfSoonGrid', 'bfPsplus').includes('href="/upcoming/zzyzx-marvel-3" class="game-card upcoming-card'));
    assert.deepStrictEqual(sorts(h), ['*release', 'az']);
    assert.ok(opening(h, 'bfOpen').includes(' hidden'), 'no Filters button');
    assert.strictEqual(countOf(h), 'Coming soon · 3 games');
  });
  await okAsync('Deals, Available now and Buy to keep', async () => {
    assert.deepStrictEqual(shown(await page('/browse?tab=deals')), [3]);
    assert.deepStrictEqual(sorts(await page('/browse?tab=deals')).slice(0, 2), ['*discount', 'most-rented']);
    assert.deepStrictEqual(shown(await page('/browse?tab=available')), [3, 2, 5, 6, 1]);
    assert.deepStrictEqual(shown(await page('/browse?tab=buy')), [4]);
  });
  await okAsync('PS Plus Deluxe: the account to rent, then its games (drawn by the page script), A–Z only', async () => {
    const h = await page('/browse?tab=psplus');
    assert.ok(!opening(h, 'bfPsplus').includes(' hidden'));
    const lead = between(h, 'bfPsplus', 'bfPsGrid');
    assert.ok(lead.includes('<a class="bf-ps-lead" href="/ps-plus/rent">'), 'the lead says Rent, so it opens the rent page');
    assert.ok(lead.includes('Hundreds of games, one account') && lead.includes('from <b>₱159</b>/week') && lead.includes('>Rent</span>'));
    assert.ok(opening(h, 'bfSortWrap').includes(' hidden'), 'one order: no Sort menu');
    assert.deepStrictEqual(browseData(h).psplus.map(p => p.k).sort(), ['days-gone', 'returnal'], 'hidden games left out');
    assert.strictEqual(countOf(h), 'PS Plus Deluxe · 2 games');
  });
  await okAsync('unknown or empty tabs open All games; an unknown sort falls back', async () => {
    const h = await page('/browse?tab=bundles&sort=cheapest');
    assert.deepStrictEqual(tabs(h).filter(t => t.on).map(t => t.key), ['all']);
    assert.deepStrictEqual(shown(h), [3, 2, 5, 6, 1, 4]);
    assert.strictEqual(browseData(h).state.tab, 'all');
  });

  console.log('\nsearch, sort and filters');
  await okAsync('?search= fills the box and narrows the grid and every tab count', async () => {
    const h = await page('/browse?search=elden');
    assert.ok(opening(h, 'bfSearch').includes('value="elden"'));
    assert.deepStrictEqual(shown(h), [2]);
    assert.deepStrictEqual(tabs(h).map(t => t.count), [1, 1, 1, 0, 0, 1, 0, 0]);
    assert.strictEqual(tabs(h)[2].href, '/browse?tab=new&search=elden');
  });
  await okAsync('?sort= orders the grid and stays out of the tab links', async () => {
    const h = await page('/browse?sort=az');
    assert.deepStrictEqual(shown(h), [6, 1, 4, 2, 5, 3]);
    assert.deepStrictEqual(sorts(h), ['most-rented', 'newest', 'price-asc', 'price-desc', '*az']);
    assert.strictEqual(tabs(h)[1].href, '/browse?tab=most-rented');
    assert.deepStrictEqual(shown(await page('/browse?sort=price-asc')), [5, 3, 4, 2, 6, 1], 'Tekken\'s 40% deal makes it ₱149; ties by title');
  });
  await okAsync('filters on top of a tab, with the filter bar\'s chips', async () => {
    const h = await page('/browse?tab=most-rented&console=ps4&price=low');
    assert.deepStrictEqual(shown(h), [3, 5]);
    assert.deepStrictEqual(barChips(h).map(c => c.label + ' ' + c.href), ['PS4 ✕ /browse?tab=most-rented&price=low', 'Under ₱180 ✕ /browse?tab=most-rented&console=ps4']);
    assert.ok(between(h, 'bfChips', 'bfPanel').includes('<a class="bf-clear" href="/browse?tab=most-rented" data-clear-all="1">Clear all</a>'));
    assert.ok(opening(h, 'bfOpen').includes('bf-open bf-has'));
    assert.ok(h.includes('<span id="bfOpenN"> · 2</span>'));
  });
  await okAsync('old links: Show ticks open their tab, PS4 links still pick PS4, quick picks open All games', async () => {
    assert.deepStrictEqual(tabs(await page('/browse?avail=1')).filter(t => t.on).map(t => t.key), ['available']);
    assert.deepStrictEqual(tabs(await page('/browse?newOnly=1')).filter(t => t.on).map(t => t.key), ['new']);
    assert.deepStrictEqual(shown(await page('/browse?unit=ps4')), [3], 'a free PS4 slot');
    const pick = await page('/browse?genre=Horror');
    assert.deepStrictEqual([tabs(pick).filter(t => t.on).map(t => t.key), shown(pick)], [['all'], [4]]);
  });
  await okAsync('a filtered tier shows its description', async () => {
    const h = await page('/browse?tier=2');
    assert.ok(between(h, 'bfNotes', 'bfEmpty').includes('<p class="cat-desc"><b>Deluxe</b> — Big recent AAA games</p>'));
    assert.ok(!between(all, 'bfNotes', 'bfEmpty').includes('cat-desc'));
  });
  await okAsync('nothing matches: the empty grid clears search and filters, keeps the tab', async () => {
    const h = await page('/browse?tab=deals&search=zzzz&console=ps5');
    assert.ok(!opening(h, 'bfEmpty').includes(' hidden'));
    assert.ok(between(h, 'bfEmpty', 'bfGrid').includes('No games match.'));
    assert.ok(between(h, 'bfEmpty', 'bfGrid').includes('<a class="btn btn-outline" id="bfReset" href="/browse?tab=deals">Clear filters</a>'));
  });
  await okAsync('the filter panel: tier, console, genre and price rows; a plain form that keeps tab, sort and search', async () => {
    const h = await page('/browse?tab=deals&sort=az&search=zzyzx');
    const form = between(h, 'bfForm', 'bfGo');
    assert.deepStrictEqual([...form.matchAll(/<section class="bf-sec" data-group="(\w+)">/g)].map(m => m[1]), ['tier', 'console', 'genre', 'price']);
    ['<input type="hidden" name="tab" value="deals">', '<input type="hidden" name="sort" value="az">', '<input type="hidden" name="search" value="zzyzx">'].forEach(t => assert.ok(form.includes(t), t));
    assert.ok(/<label class="bf-opt" data-group="tier" data-value="2">[\s\S]*?Big recent AAA games · from ₱149[\s\S]*?<input type="checkbox" name="tier" value="2">/.test(form));
    assert.ok(!between(all, 'bfForm', 'bfGo').includes('name="tab"'), 'All games needs no tab field');
  });

  console.log('\npage script');
  await okAsync('facts for every game and Coming soon game, safely embedded, plus the scripts and styles', async () => {
    const d = browseData(all);
    const tekken = d.games.find(g => g.id === 3);
    assert.deepStrictEqual([tekken.tier, tekken.rank, tekken.released, tekken.deal, tekken.availPs4], ['2', 1, '2024-01-26', 40, true]);
    assert.deepStrictEqual([d.games.find(g => g.id === 5).released, d.games.find(g => g.id === 1).rank], [null, null]);
    assert.deepStrictEqual(d.soon.map(u => [u.id, u.order]), [[3, 0], [1, 1], [2, 2]]);
    assert.deepStrictEqual(d.state, { tab: 'all', sort: '', search: '', tiers: [], consoles: [], genres: [], prices: [] });
    assert.deepStrictEqual(d.ctx.tiers[1], { id: '2', name: 'Deluxe', desc: 'Big recent AAA games' });
    assert.strictEqual(d.psplusFrom, 159);
    assert.ok(all.includes('\\u003c/script>\\u003cb>favourite'), 'a description cannot close the script');
    ['/js/browse-filter-core.js', '/js/browse.js', '/css/browse-filters.css'].forEach(src => assert.ok(all.includes(src + '?v='), src));
    assert.strictEqual((await call('/js/browse.js')).status, 200);
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'browse.js'), 'utf8');
    assert.ok(js.includes("location.hash === '#comingSoon'"), 'old #comingSoon links open the Coming soon tab');
    assert.ok(js.includes("location.hash = ''"), 'clears the hash so :target un-matches');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'browse-filters.css'), 'utf8');
    const gridCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(gridCss.includes('.games-grid, .buy-single-grid { grid-template-columns: repeat(10, minmax(0, 1fr)); }'), 'ten cards a row on a wide screen');
    assert.ok(/\.bf-top \{ position: sticky; top: 64px;/.test(css), 'search, tabs and bar pinned under the menu');
    assert.ok(/\.bf-results \[hidden\] \{ display: none; \}/.test(css), 'hidden cards stay hidden');
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
