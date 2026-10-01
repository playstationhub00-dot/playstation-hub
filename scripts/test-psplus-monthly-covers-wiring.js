// Run: node scripts/test-psplus-monthly-covers-wiring.js
//
// Real covers for the owner's monthly picks that match nothing in our stored
// PS Plus lists (lib/psplus-title-search.js + lib/psplus-monthly-covers-store.js).
// Source-level checks, like scripts/test-psplus-admin-catalog.js: server.js
// loads the two new libs, boots the store, wires the fetch route behind
// requireAuth + asyncRoute, skips titles already resolved, feeds the admin
// page an unresolved count, and the admin partial's button uses it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const view = require('../lib/psplus-catalog-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function block(startMarker) {
  const i = SRC.indexOf(startMarker);
  assert.ok(i >= 0, 'server.js still has ' + startMarker);
  const next = SRC.indexOf('\napp.', i + startMarker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}

console.log('\nserver.js wiring');

ok('loads the search and store libs, and boots the store', () => {
  [
    "require('./lib/psplus-title-search')", "require('./lib/psplus-monthly-covers-store')",
    'psplusMonthlyCoversStore.init(_getMongoDb);', 'psplusMonthlyCoversStore.load()'
  ].forEach(s => assert.ok(SRC.includes(s), s));
});

ok('the fetch route is admin-only, wrapped, and skips already-resolved titles', () => {
  const r = block("app.post('/admin/psplus/monthly-covers/fetch', requireAuth,");
  assert.ok(r.includes('asyncRoute(async'));
  assert.ok(r.includes('psplusCatalogView.monthlyTileTitles('));
  assert.ok(r.includes('!psplusMonthlyCoversStore.get(t.key)'), 'only unresolved titles are looked up again');
  assert.ok(r.includes('psplusTitleSearch.searchCover(t.name)'));
  assert.ok(r.includes("'monthly_covers_fetched'") && r.includes("'monthly_covers_nothing'"));
});

ok('/ps-plus feeds buildPublicCatalog the resolved covers', () => {
  const i = SRC.indexOf('const catalog = psplusCatalogView.buildPublicCatalog({');
  const block2 = SRC.slice(i, SRC.indexOf('});', i));
  assert.ok(block2.includes('monthlyCovers: psplusMonthlyCoversStore.all()'));
});

ok('the admin page gets a count of titles still unresolved', () => {
  assert.ok(SRC.includes('monthlyCoversUnresolved: psplusCatalogView.monthlyTileTitles(psplus, psplusCatalogStore.all().filter(g => !g.hidden))'));
});

ok('the two toasts exist and open the PS Plus tab', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'views', 'admin.ejs'), 'utf8');
  ['monthly_covers_fetched', 'monthly_covers_nothing'].forEach(m => {
    assert.ok(admin.includes(m + ":'psplus'"), m + ' tab');
    assert.ok(new RegExp(m + ":'[^']+'").test(admin), m + ' text');
  });
});

console.log('\nadmin partial');

const SHELL = path.join(ROOT, 'views', 'partials', 'admin', 'psplus.ejs');

function render(monthlyCoversUnresolved) {
  const pc = Object.assign(view.buildAdminCatalog({ games: [], siteGames: [], entries: [], meta: {}, now: new Date() }),
    { preview: null, previewToken: '', previewExpired: false, monthSuggestion: null, siteGames: [] });
  return ejs.render(fs.readFileSync(SHELL, 'utf8'), {
    psplusCatalog: pc, psplus: [], psplusPopular: [], monthlyCoversUnresolved,
    psplusPrices: { nt_price_7d: 99, nt_price_30d: 249, tr_price_7d: 149, tr_price_30d: 299 }
  }, { filename: SHELL });
}

ok('the button shows the count and posts to the fetch route, only when there is something to look up', () => {
  const html = render(4);
  assert.ok(html.includes('action="/admin/psplus/monthly-covers/fetch"'));
  assert.ok(html.includes('🖼️ Fetch monthly covers (4)'));
});

ok('nothing to fetch: no button', () => {
  assert.ok(!render(0).includes('/admin/psplus/monthly-covers/fetch'));
});

console.log('\n' + passed + ' assertions passed\n');
