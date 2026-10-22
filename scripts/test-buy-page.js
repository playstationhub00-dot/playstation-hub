// Run: node scripts/test-buy-page.js
//
// The Buy shop as the server renders it: the storefront (header and search,
// the owner's spotlight with sold-out and gone picks skipped, a shelf per tab
// with its first items, stickers, stock tags, promo prices, box sets, the
// kept bottom cards and the order error banner) and the catalog (tabs and
// counts, each tab's grid order, best-seller stickers, box sets, sort and
// search in the address, filters and their chips, the filter panel, the
// empty grid, the facts handed to the page script). The rules themselves:
// scripts/test-buy-catalog-core.js and scripts/test-buy-view.js.
// Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory
// sessions, a made-up admin password); the project's games.json and the
// database are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4633;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buy-page-'));
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '/uploads/' + id + '.png', renters: 1,
  nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 1, trophy_slots: 1
}, extra || {});
const slots = (nt, tr) => ({ non_trophy: { enabled: true, status: nt }, trophy: { enabled: true, status: tr }, ps4_primary: { enabled: false, status: 'open' } });
const acc = (id, name, gameIds, o) => Object.assign({ id, label: name, public_name: name, email: '', for_sale: true, game_ids: gameIds, slots: slots('open', 'open') }, o || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  site_settings: {
    promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100, buy_promo_enabled: true, buy_promo_pct: 10 },
    buy_spotlight: [{ kind: 'game', id: 4 }, { kind: 'box', id: 2 }, { kind: 'game', id: 6 }, { kind: 'box', id: 1 }]
  },
  games: [
    game(1, 'Zzyzx Astro', { buy_nt_price: 999, buy_tr_price: 1499, renters: 2, genre: 'Platformer', release_date: '2024-09-06' }),
    game(2, 'Zzyzx Elden', { buy_nt_price: 1999, renters: 5, genre: 'Action, RPG', platform: 'PS4/PS5' }),
    game(3, 'Zzyzx Tekken', { buy_tr_price: 2499, genre: 'Fighting' }),
    game(4, 'Zzyzx Callisto', { buy_nt_price: 1299, renters: 0, genre: 'Horror' }),
    game(5, 'Zzyzx Plain & <Co>', { buy_nt_price: 499, renters: 3, platform: 'PS4' }),
    game(6, 'Zzyzx NoBuy'),
    game(7, 'Zzyzx Full', { buy_nt_price: 899, renters: 4, non_trophy_slots: 0, trophy_slots: 0 })
  ],
  accounts: [
    acc(1, 'Zzyzx Box Big', [1, 2, 3], { price_permanent_nt: 3000, price_permanent_tr: 3600 }),
    acc(2, 'Zzyzx Box Gone', [6, 7], { price_permanent_nt: 1500, price_permanent_tr: 1800, slots: slots('buyed', 'rented') }),
    acc(3, 'Zzyzx NoBuy', [6], { price_permanent_nt: 700 }),
    acc(4, 'Zzyzx Hidden Box', [1, 2], { for_sale: false, price_permanent_nt: 900 })
  ],
  customers: [
    { id: 1, game_id: 3, status: 'bought', customer_name: 'Zzyzx A' }, { id: 2, game_id: 3, status: 'bought', customer_name: 'Zzyzx B' },
    { id: 3, game_id: 5, status: 'bought', customer_name: 'Zzyzx C' }
  ],
  reviews: [{ id: 1, name: 'Zzyzx Reviewer', text: 'Smooth purchase', rating: 5, visible: true, private: false, created_at: '2026-10-01T00:00:00.000Z' }]
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
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.end();
  });
}
async function page(p) { const r = await call(p); assert.strictEqual(r.status, 200, p); return r.body; }
function between(html, startId, endId) {
  const i = html.indexOf('id="' + startId + '"');
  assert.ok(i >= 0, startId + ' found');
  const j = endId ? html.indexOf('id="' + endId + '"', i) : html.length;
  return html.slice(i, j);
}
const opening = (html, id) => { const i = html.indexOf('id="' + id + '"'); return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1); };
const unamp = s => s.replace(/&amp;/g, '&');
const titles = html => [...html.matchAll(/<span class="shop-title">([^<]*)<\/span>/g)].map(m => m[1].replace('Zzyzx ', ''));
const boxNames = html => [...html.matchAll(/<span class="shop-box-name">([^<]*)<\/span>/g)].map(m => m[1].replace('Zzyzx ', ''));
const shelf = (html, key) => { const i = html.indexOf('id="shelf-' + key + '"'); assert.ok(i >= 0, key); return html.slice(i, html.indexOf('</section>', i)); };
const card = (html, slug) => { const m = new RegExp('<a href="/game/' + slug + '\\?mode=buy" class="shop-card">[\\s\\S]*?</a>').exec(html); assert.ok(m, slug); return m[0]; };
const shown = (html, grid, attr) => [...between(html, grid).split('</div>\n</div>')[0].matchAll(new RegExp('<div class="shop-item" data-' + attr + '="(\\d+)"( hidden)?>', 'g'))].filter(m => !m[2]).map(m => Number(m[1]));
const tabs = html => [...between(html, 'scTabs', 'scBar').matchAll(/<a class="bf-tab( on)?" data-tab="([\w-]+)" href="([^"]*)"[^>]*>([^<]*?) <span class="bf-tab-n">(\d+)<\/span><\/a>/g)]
  .map(m => ({ key: m[2], on: !!m[1], href: unamp(m[3]), count: Number(m[5]) }));
const sorts = html => [...between(html, 'scSort', 'scOpen').matchAll(/<option value="([\w-]+)"( selected)?>/g)].map(m => (m[2] ? '*' : '') + m[1]);
const ranks = html => [...between(html, 'scGrid', 'scBoxGrid').matchAll(/<span class="shop-rank shop-rank-(\d)"( hidden)?>/g)].map(m => (m[2] ? 'hidden ' : '') + '#' + m[1]);
function shopData(html) {
  const m = /<script type="application\/json" id="shopData">([\s\S]*?)<\/script>/.exec(html);
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
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const shop = await page('/buy');

  console.log('\nthe storefront');
  await okAsync('the shop header: title, search into the catalog, All games', async () => {
    assert.ok(shop.includes('<span class="shop-kicker">The game shop</span>') && shop.includes('<h1>Buy games · own them forever</h1>'));
    assert.ok(shop.includes('<form class="shop-search" method="get" action="/buy/catalog" role="search">'));
    assert.ok(shop.includes('placeholder="Search 6 games to own…"'), 'every game with a permanent price, full ones too');
    assert.ok(shop.includes('<a class="shop-all" href="/buy/catalog">All games ›</a>'));
    ['/css/shop.css', '/js/home.js', '/js/shop.js'].forEach(src => assert.ok(shop.includes(src + '?v='), src));
  });
  await okAsync('the spotlight: the owner\'s picks in order, sold-out box sets and games not for sale skipped', async () => {
    const spot = between(shop, 'hmBanner', 'shelf-best-sellers');
    assert.deepStrictEqual([...spot.matchAll(/<span class="shop-slide-title">([^<]*)<\/span>/g)].map(m => m[1]), ['Zzyzx Callisto', 'Zzyzx Box Big']);
    assert.ok(spot.includes('<a class="shop-slide" href="/game/zzyzx-callisto?mode=buy">') && spot.includes('<a class="shop-slide" href="/bundle/zzyzx-box-big">'));
    assert.ok(spot.includes('<span class="shop-slide-sticker">₱1,169</span>'), 'a game: its price after the buy promo');
    assert.ok(spot.includes('<span class="shop-slide-sticker">from ₱3,000</span>'), 'a box set: its cheapest open type');
    assert.ok(spot.includes('<span class="shop-stock shop-wait">Set up on order</span>'));
    assert.strictEqual((spot.match(/class="hm-dot/g) || []).length, 2);
    assert.ok(spot.includes('id="hmPrev"') && spot.includes('id="hmSlides"'), 'the homepage banner script drives it');
  });
  await okAsync('a shelf per tab, in order, each with its first items and See all', async () => {
    assert.deepStrictEqual([...shop.matchAll(/<section class="shop-shelf" id="shelf-([\w-]+)">/g)].map(m => m[1]), ['best-sellers', 'ready-today', 'box-sets', 'under-1000', '1000-1999', '2000-up']);
    assert.deepStrictEqual(titles(shelf(shop, 'best-sellers')), ['Tekken', 'Plain &amp; &lt;Co&gt;', 'Elden', 'Full', 'Astro', 'Callisto'], 'sold first, then the most rented, topped up');
    assert.deepStrictEqual(titles(shelf(shop, 'ready-today')), ['Tekken', 'Plain &amp; &lt;Co&gt;', 'Elden', 'Astro']);
    assert.deepStrictEqual(boxNames(shelf(shop, 'box-sets')), ['Box Gone', 'Box Big'], 'best value first; the one-game account and the hidden one left out');
    assert.deepStrictEqual(titles(shelf(shop, 'under-1000')), ['Plain &amp; &lt;Co&gt;', 'Full', 'Astro']);
    assert.deepStrictEqual(titles(shelf(shop, '1000-1999')), ['Callisto', 'Elden']);
    assert.deepStrictEqual(titles(shelf(shop, '2000-up')), ['Tekken']);
    assert.ok(shelf(shop, 'best-sellers').includes('<a class="shop-seeall" href="/buy/catalog?tab=best-sellers">See all ›</a>'));
    assert.ok(shelf(shop, '1000-1999').includes('<span class="shop-note">2 games</span>') && shelf(shop, '1000-1999').includes('href="/buy/catalog?tab=1000-1999"'));
    const cards = titles(shop);
    assert.ok(!cards.includes('NoBuy') && !shop.includes('Zzyzx Hidden Box'), 'nothing without a permanent price');
    assert.ok(card(shop, 'zzyzx-full').includes('<span class="shop-stock shop-wait">Set up on order</span>'), 'every slot taken: still sold, as a new slot');
  });
  await okAsync('cards: best-seller stickers, stock tags, the cheapest type\'s price with the promo base struck', async () => {
    const best = shelf(shop, 'best-sellers');
    assert.deepStrictEqual([...best.matchAll(/<span class="shop-rank shop-rank-(\d)">#\d<\/span>/g)].map(m => m[1]), ['1', '2', '3']);
    const astro = card(shop, 'zzyzx-astro');
    assert.ok(astro.includes('<span class="shop-price">₱899 <s>₱999</s></span>'), 'Non-Trophy is the cheaper type');
    assert.ok(astro.includes('<span class="shop-stock shop-in">In stock</span>') && astro.includes('<span class="shop-meta">PS5 · Platformer</span>'));
    assert.ok(card(shop, 'zzyzx-tekken').includes('₱2,249 <s>₱2,499</s>'), 'Trophy only');
    assert.ok(card(shop, 'zzyzx-callisto').includes('<span class="shop-stock shop-wait">Set up on order</span>'));
  });
  await okAsync('box-set cards: covers, games, price per game, a sticker per type with why it is taken', async () => {
    const gone = /<a href="\/bundle\/zzyzx-box-gone" class="shop-box">[\s\S]*?<\/a>/.exec(shop)[0];
    assert.ok(gone.includes('<span class="shop-meta">2 games · from ₱750 per game</span>'));
    assert.ok(gone.includes('<span class="shop-tier shop-tier-off">Non-Trophy ₱1,500 · Sold</span>') && gone.includes('<span class="shop-tier shop-tier-off">Trophy ₱1,800 · Rented</span>'));
    const big = /<a href="\/bundle\/zzyzx-box-big" class="shop-box">[\s\S]*?<\/a>/.exec(shop)[0];
    assert.strictEqual((big.match(/<img /g) || []).length, 3);
    assert.ok(big.includes('<span class="shop-tier">Non-Trophy ₱3,000</span>'));
  });
  await okAsync('kept: Build your own, Request a game, the reviews; the old price sections are gone', async () => {
    assert.ok(shop.includes('📦 Build your own') && shop.includes('<a href="/requests" class="buy-placeholder-cta">Request a game</a>'));
    assert.ok(shop.includes('id="gdrq"'), 'the reviews strip');
    ['buy-price-section', 'buyAvailToggle', 'Available today only', 'buy-bundle-card'].forEach(t => assert.ok(!shop.includes(t), t));
    assert.ok((await page('/buy?order_error=sold')).includes('That slot just sold — sorry! Pick another below.'));
  });

  console.log('\nthe catalog');
  const all = await page('/buy/catalog');
  await okAsync('the tab row with counts, All games on, every game in best-selling order', async () => {
    assert.deepStrictEqual(tabs(all).map(t => t.key + ' ' + t.count), ['all 6', 'best-sellers 6', 'ready-today 4', 'box-sets 2', 'under-1000 3', '1000-1999 2', '2000-up 1']);
    assert.ok(all.includes('data-tab="all" href="/buy/catalog" aria-current="page"'));
    assert.deepStrictEqual(shown(all, 'scGrid', 'id'), [3, 5, 2, 7, 1, 4]);
    assert.deepStrictEqual(ranks(all), ['hidden #1', 'hidden #2', 'hidden #3'], 'stickers wait for Best sellers');
    assert.ok(all.includes('<a class="shop-back" href="/buy">‹ Back to the shop</a>'));
    assert.ok(opening(all, 'scBoxGrid').includes(' hidden'));
    assert.ok(/<span class="bf-count" id="scCount">All games · 6 games<\/span>/.test(all));
  });
  await okAsync('Best sellers shows #1–#3; Box sets shows box-set cards, its own sorts and no Filters', async () => {
    const best = await page('/buy/catalog?tab=best-sellers');
    assert.deepStrictEqual(ranks(best), ['#1', '#2', '#3']);
    const boxes = await page('/buy/catalog?tab=box-sets');
    assert.deepStrictEqual(shown(boxes, 'scBoxGrid', 'box'), [2, 1]);
    assert.ok(opening(boxes, 'scGrid').includes(' hidden') && opening(boxes, 'scOpen').includes(' hidden'));
    assert.deepStrictEqual(sorts(boxes), ['*best-value', 'price-asc', 'az']);
    assert.ok(/<span class="bf-count" id="scCount">Box sets · 2 box sets<\/span>/.test(boxes));
  });
  await okAsync('price tabs start cheapest first; ?sort= and ?search= are kept', async () => {
    const mid = await page('/buy/catalog?tab=1000-1999');
    assert.deepStrictEqual(shown(mid, 'scGrid', 'id'), [4, 2]);
    assert.deepStrictEqual(sorts(mid), ['*price-asc', 'best-selling', 'price-desc', 'az', 'newest']);
    const az = await page('/buy/catalog?tab=under-1000&sort=az');
    assert.deepStrictEqual(shown(az, 'scGrid', 'id'), [1, 7, 5]);
    assert.strictEqual(tabs(az)[0].href, '/buy/catalog', 'another tab starts in its own order');
    const s = await page('/buy/catalog?search=elden');
    assert.ok(opening(s, 'scSearch').includes('value="elden"'));
    assert.deepStrictEqual(shown(s, 'scGrid', 'id'), [2]);
    assert.deepStrictEqual(tabs(s).map(t => t.count), [1, 1, 1, 1, 0, 1, 0], 'Box Big holds Elden');
  });
  await okAsync('filters on top of a tab, with chips; unknown tab and sort fall back', async () => {
    const ps4 = await page('/buy/catalog?console=ps4');
    assert.deepStrictEqual(shown(ps4, 'scGrid', 'id'), [5, 2]);
    assert.ok(ps4.includes('<a class="bf-chip-x" data-group="console" data-value="ps4" href="/buy/catalog" aria-label="Remove PS4">PS4 ✕</a>'));
    assert.ok(ps4.includes('<span id="scOpenN"> · 1</span>'));
    assert.deepStrictEqual(shown(await page('/buy/catalog?account=tr'), 'scGrid', 'id'), [3, 1]);
    const odd = await page('/buy/catalog?tab=nope&sort=cheapest');
    assert.deepStrictEqual(tabs(odd).filter(t => t.on).map(t => t.key), ['all']);
    assert.deepStrictEqual(shown(odd, 'scGrid', 'id'), [3, 5, 2, 7, 1, 4]);
  });
  await okAsync('nothing matches: the empty grid clears search and filters, keeps the tab', async () => {
    const none = await page('/buy/catalog?tab=ready-today&search=zzzz');
    assert.ok(!opening(none, 'scEmpty').includes(' hidden'));
    assert.ok(none.includes('<a class="btn btn-outline" id="scReset" href="/buy/catalog?tab=ready-today">Clear filters</a>'));
  });
  await okAsync('the filter panel: console, genre and account rows; a plain form that keeps tab, sort and search', async () => {
    const h = await page('/buy/catalog?tab=ready-today&sort=az&search=zzyzx');
    const form = between(h, 'scForm', 'scGo');
    assert.deepStrictEqual([...form.matchAll(/<section class="bf-sec" data-group="(\w+)">/g)].map(m => m[1]), ['console', 'genre', 'account']);
    ['<input type="hidden" name="tab" value="ready-today">', '<input type="hidden" name="sort" value="az">', '<input type="hidden" name="search" value="zzyzx">'].forEach(t => assert.ok(form.includes(t), t));
    assert.ok(/<label class="bf-opt" data-group="account" data-value="tr">[\s\S]*?Trophy[\s\S]*?<input type="checkbox" name="account" value="tr">/.test(form));
  });
  await okAsync('facts for every game and box set, safely embedded, plus the scripts and styles', async () => {
    const d = shopData(all);
    const tekken = d.games.find(g => g.id === 3);
    assert.deepStrictEqual([tekken.price, tekken.was, tekken.nt, tekken.tr, tekken.sold, tekken.order, tekken.ready], [2249, 2499, false, true, 2, 1, true]);
    assert.deepStrictEqual(d.games.find(g => g.id === 4).ready, false);
    assert.deepStrictEqual(d.boxes.map(b => [b.id, b.perGame, b.from, b.open]), [[1, 1000, 3000, true], [2, 750, 1500, false]]);
    assert.deepStrictEqual(d.state, { tab: 'all', sort: '', search: '', consoles: [], genres: [], accounts: [] });
    assert.ok(all.includes('"title":"Zzyzx Plain & \\u003cCo>"'), 'a title cannot close the script');
    ['/css/browse-filters.css', '/css/shop.css', '/js/buy-catalog-core.js', '/js/buy-catalog.js'].forEach(src => assert.ok(all.includes(src + '?v='), src));
    for (const src of ['/js/buy-catalog.js', '/js/shop.js', '/css/shop.css']) assert.strictEqual((await call(src)).status, 200, src);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
