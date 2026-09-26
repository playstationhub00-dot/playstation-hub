// Run: node scripts/test-psplus-page.js
//
// Renders the real views/ps-plus.ejs (with views/partials/psplus-catalog-grid.ejs)
// from the saved PlayStation feed (scripts/fixtures/psplus-feed/) run through
// the real lib/psplus-catalog.js and lib/psplus-catalog-view.js. Checks the
// three tabs and which one is open, the hero, the filter chips and their
// counts, the Most Played row, the embedded game list, and that the old
// "go to playstation.com" button and "PM us for the list" note are gone.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const feed = require('../lib/psplus-feed');
const cat = require('../lib/psplus-catalog');
const view = require('../lib/psplus-catalog-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const VIEW = path.join(ROOT, 'views', 'ps-plus.ejs');
const FIX = path.join(__dirname, 'fixtures', 'psplus-feed');
const loadList = name => ({ ok: true, games: feed.parseFeed(JSON.parse(fs.readFileSync(path.join(FIX, name + '.json'), 'utf8'))) });
const slugFor = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// What Apply would store on a first refresh of the saved feed.
const STORED = cat.applyPlan([], cat.mergeFeed({ catalog: loadList('catalog'), classics: loadList('classics'), ubisoft: loadList('ubisoft') }),
  ['catalog', 'classics', 'ubisoft'], '2026-09-27T05:00:00.000Z').upserts;
STORED.push(Object.assign({}, cat.OWNER_DEFAULTS, { key: 'c:999999', source: 'feed', name: '</script><b>x</b>', name_raw: 'x', lists: ['catalog'],
  image_url: '', platforms: [], genres: [], release_date: '', store_url: '', first_seen_at: '2026-09-27T05:00:00.000Z' }));
const ENTRIES = [{ id: 4, year: 2026, month: 9, month_name: 'September', games_list: 'God of War Ragnarök\nSome Monthly-Only Game', cover_image: '', notes: '' }];
const SITE = [{ id: 8, title: 'God of War Ragnarök' }];
const POPULAR = [{ id: 1, title: 'Ghost of Tsushima', platform: 'PS5', rank: 1, cover_image: '' }];

function render({ games = STORED, tab = 'games', popular = POPULAR, entries = ENTRIES } = {}) {
  const catalog = view.buildPublicCatalog({ games, siteGames: SITE, entries, slugFor });
  const byYear = { 2026: ENTRIES };
  const html = ejs.render(fs.readFileSync(VIEW, 'utf8'), {
    settings: { title: 'PlayStation Hub', favicon_path: '/favicon.svg', logo_path: '/logo.png' },
    assetV: 'test', announcement: null, announcements: [],
    byYear, years: ['2026'], popular, prices: { nt_price_7d: 120, nt_price_30d: 350, tr_price_7d: 150, tr_price_30d: 450 },
    slots: { nt_slots: 2, tr_slots: 1, ps4_slots: 0 }, psplusGameId: 17, psplusSlug: 'ps-plus-deluxe',
    catalog, activeTab: tab, fromWeekly: 120,
    reviews: [], reviewStats: null, recommend: null, reviewBadge: null, reviewDisplayName: null
  }, { filename: VIEW });
  return { html, catalog };
}
function panelOpen(html, name) {
  const m = new RegExp('data-panel="' + name + '" id="ppc-panel-' + name + '" role="tabpanel"( hidden)?>').exec(html);
  assert.ok(m, name + ' panel present');
  return !m[1];
}

console.log('\ntabs');

ok('three tabs, All Games open by default', () => {
  const { html } = render();
  assert.ok(html.includes('data-tab="games"') && html.includes('data-tab="monthly"') && html.includes('data-tab="pricing"'));
  assert.deepStrictEqual([panelOpen(html, 'games'), panelOpen(html, 'monthly'), panelOpen(html, 'pricing')], [true, false, false]);
  assert.ok(/class="ppc-tab on" data-tab="games"/.test(html));
});

ok('?tab= opens the tab it names', () => {
  const { html } = render({ tab: 'pricing' });
  assert.deepStrictEqual([panelOpen(html, 'games'), panelOpen(html, 'monthly'), panelOpen(html, 'pricing')], [false, false, true]);
  assert.ok(/class="ppc-tab on" data-tab="pricing"/.test(html));
});

ok('each panel holds what it should', () => {
  const { html } = render();
  const games = html.indexOf('id="ppc-panel-games"'), monthly = html.indexOf('id="ppc-panel-monthly"'), pricing = html.indexOf('id="ppc-panel-pricing"');
  assert.ok(html.indexOf('id="pricing"') > pricing && html.indexOf('id="pricing"') < games, 'price cards in Pricing');
  assert.ok(html.indexOf('id="ppcMostPlayed"') > games && html.indexOf('id="ppcGrid"') > games && html.indexOf('id="ppcGrid"') < monthly, 'Most Played and the grid in All Games');
  assert.ok(html.indexOf('psplus-month-card') > monthly, 'month cards in Monthly');
});

console.log('\nhero');

ok('the game count, the weekly price and free slots, with one Rent button', () => {
  const { html, catalog } = render();
  assert.ok(html.includes('<b>' + catalog.counts.all + '</b><span>Games</span>'));
  assert.ok(html.includes('<b>₱120</b><span>/ week</span>'));
  assert.ok(html.includes('<b>● 3</b><span>Slots free</span>'));
  assert.ok(html.includes('<a href="/ps-plus/rent" class="ppc-cta">Rent PS Plus Deluxe →</a>'));
});

ok('the old playstation.com button and "PM us for the list" note are gone', () => {
  const { html } = render();
  assert.ok(!html.includes('Browse All PS Plus Games'));
  assert.ok(!html.includes('www.playstation.com/en-id/ps-plus/games'));
  assert.ok(!html.includes('PM us for full list'));
});

console.log('\nAll Games');

ok('515 PlayStation games plus the monthly-only tile, with chip counts', () => {
  const { html, catalog } = render();
  assert.strictEqual(catalog.counts.all, 517, '515 + the test game + 1 monthly-only tile');
  assert.ok(html.includes('data-f="catalog" aria-pressed="false">Game Catalog <i>' + catalog.counts.catalog + '</i>'));
  assert.ok(html.includes('data-f="classics" aria-pressed="false">Classics <i>149</i>'));
  assert.ok(html.includes('data-f="ubisoft" aria-pressed="false">Ubisoft+ <i>66</i>'));
  assert.ok(html.includes('data-f="monthly" aria-pressed="false">Monthly <i>2</i>'));
  assert.ok(html.includes('data-f="rent" aria-pressed="false">🟢 Also for rent <i>1</i>'));
  assert.ok(html.includes('🎮 All 517 games'));
});

ok('the game list is embedded as JSON a title can never break out of', () => {
  const { html, catalog } = render();
  const m = /<script type="application\/json" id="ppcData">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m);
  assert.ok(!m[1].includes('</script'));
  const items = JSON.parse(m[1]);
  assert.strictEqual(items.length, catalog.counts.all);
  assert.ok(items.some(i => i.n === '</script><b>x</b>'));
  const gow = items.find(i => i.n === 'God of War Ragnarök');
  assert.deepStrictEqual([gow.m, gow.rent.u], ['SEP 2026', '/game/god-of-war-ragnar-k']);
});

ok('the sheet rents PS Plus Deluxe and quotes the weekly price', () => {
  const { html } = render();
  assert.ok(html.includes('<a class="ppc-sheet-rent" href="/ps-plus/rent">Rent PS Plus Deluxe · from ₱120/week</a>'));
  assert.ok(html.includes('id="ppcSheet" hidden'));
});

ok('no Most Played row when there is none', () => {
  assert.ok(!render({ popular: [] }).html.includes('id="ppcMostPlayed"'));
});

ok('before the first refresh: "coming soon", and the other tabs still work', () => {
  const { html } = render({ games: [], entries: [] });
  assert.ok(html.includes('The full game list is coming soon.'));
  assert.ok(!html.includes('id="ppcGrid"'));
  assert.ok(!html.includes('<span>Games</span>'), 'no game count in the hero');
  assert.ok(html.includes('psplus-month-card'));
});

console.log('\nwiring');

ok('/ps-plus builds the catalog and picks the tab', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const i = SRC.indexOf("app.get('/ps-plus', (req, res) => {");
  const route = SRC.slice(i, SRC.indexOf('\napp.', i + 10));
  assert.ok(route.includes('psplusCatalogView.buildPublicCatalog({'));
  assert.ok(route.includes("(req.query.month ? 'monthly' : 'games')"));
  assert.ok(route.includes('slots, catalog, activeTab, fromWeekly,'));
});

console.log('\n' + passed + ' assertions passed\n');
