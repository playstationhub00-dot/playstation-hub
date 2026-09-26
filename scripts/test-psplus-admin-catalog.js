// Run: node scripts/test-psplus-admin-catalog.js
//
// Admin PS Plus tab → 🎮 PS Plus Deluxe game list. Renders the real partial
// (views/partials/admin/psplus/catalog.ejs, inside views/partials/admin/psplus.ejs)
// from lib/psplus-catalog-view.js output in its three states — normal, a
// Refresh preview, a preview with a list held back — and checks at source
// level that server.js wires every route behind requireAuth and asyncRoute,
// feeds the partial, and that every toast opens the PS Plus tab.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const view = require('../lib/psplus-catalog-view');
const { OWNER_DEFAULTS } = require('../lib/psplus-catalog');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const SHELL = path.join(ROOT, 'views', 'partials', 'admin', 'psplus.ejs');

function game(id, name, lists, extra) {
  return Object.assign({}, OWNER_DEFAULTS, { key: 'c:' + id, source: 'feed', concept_id: String(id), name, name_raw: name, lists,
    image_url: 'https://image.api.playstation.com/' + id + '.png', platforms: ['PS5', 'PS4'], genres: [], release_date: '',
    store_url: '', first_seen_at: '2026-09-20T00:00:00.000Z', updated_at: '2026-09-20T00:00:00.000Z' }, extra || {});
}
const GAMES = [
  game(1, 'God of War Ragnarök', ['catalog']),
  game(2, 'Ape Escape', ['classics'], { hidden: true, hidden_note: 'not on our region' }),
  game(3, '</script><script>alert(1)</script>', ['catalog'])
];
const SITE = [{ id: 8, title: 'God of War Ragnarök' }];
const NOW = new Date('2026-09-27T05:00:00.000Z');

function catalogLocal(extra) {
  return Object.assign(view.buildAdminCatalog({ games: GAMES, siteGames: SITE, entries: [], meta: { last_refreshed_at: '2026-09-24T02:00:00.000Z' }, now: NOW }),
    { preview: null, previewToken: '', previewExpired: false, monthSuggestion: null, siteGames: SITE }, extra || {});
}
function render(psplusCatalog) {
  return ejs.render(fs.readFileSync(SHELL, 'utf8'), {
    psplusCatalog, psplus: [], psplusPopular: [], psplusPrices: { nt_price_7d: 99, nt_price_30d: 249, tr_price_7d: 149, tr_price_30d: 299 }
  }, { filename: SHELL });
}
function preview(safety, diffExtra) {
  const many = Array.from({ length: 14 }, (_, i) => game(100 + i, 'New Game ' + i, ['catalog']));
  return view.previewView({
    applied: Object.keys(safety).filter(l => safety[l].state === 'ok' || safety[l].state === 'warn'),
    safety,
    diff: Object.assign({ added: many, leaving: [game(1, 'God of War Ragnarök', ['catalog'])], updated: [{}], unchanged: 500 }, diffExtra || {})
  }, ['God of War Ragnarök'], 12);
}
const OK3 = { catalog: { state: 'ok', stored: 388, incoming: 390 }, classics: { state: 'ok', stored: 151, incoming: 151 }, ubisoft: { state: 'ok', stored: 67, incoming: 67 } };

console.log('\nnormal state');

ok('sits at the top of the PS Plus tab, with Refresh and Add by hand', () => {
  const html = render(catalogLocal());
  const card = html.indexOf('id="psplusCatalog"');
  assert.ok(card > 0 && card < html.indexOf('Add Most Played PS Plus Game'), 'the card comes first in the tab');
  assert.ok(html.includes('action="/admin/psplus/catalog/refresh"'));
  assert.ok(html.includes('🔄 Refresh from PlayStation'));
  assert.ok(html.includes('action="/admin/psplus/catalog/add"'));
  assert.ok(html.includes('From PlayStation (Indonesia)'));
  assert.ok(html.includes('last refreshed <b>Sep 24, 2026</b> (3 days ago)'));
});

ok('shows the counts', () => {
  const html = render(catalogLocal());
  assert.ok(html.includes('<b>2</b><span>Game Catalog</span>'));
  assert.ok(html.includes('<b>1</b><span>Classics</span>'));
  assert.ok(html.includes('<b>1</b><span>Hidden by you</span>'));
  assert.ok(html.includes('<b>1</b><span>Also for rent</span>'));
});

ok('the rows travel as JSON the page can never be broken out of', () => {
  const html = render(catalogLocal());
  const m = /<script type="application\/json" id="ppcaData">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'data block present');
  assert.ok(!m[1].includes('</script'), 'a title cannot close the script tag');
  const data = JSON.parse(m[1]);
  assert.strictEqual(data.rows.length, 3);
  assert.deepStrictEqual(data.games, SITE);
  assert.ok(data.rows.some(r => r.n === '</script><script>alert(1)</script>'));
});

ok('the monthly form below has the id the suggestion button fills', () => {
  assert.ok(render(catalogLocal()).includes('id="psplusAddMonthForm"'));
});

ok('never refreshed, nothing stored', () => {
  const html = render(Object.assign(view.buildAdminCatalog({ games: [], siteGames: [], entries: [], meta: {}, now: NOW }),
    { preview: null, previewToken: '', previewExpired: false, monthSuggestion: null, siteGames: [] }));
  assert.ok(html.includes('never refreshed'));
  assert.ok(html.includes('No games yet.'));
  assert.ok(!html.includes('id="ppcaRows"'));
});

ok('an expired preview says so', () => {
  assert.ok(render(catalogLocal({ previewExpired: true })).includes('That preview expired'));
});

console.log('\nRefresh preview');

ok('pills, capped columns and the Most Played warning', () => {
  const html = render(catalogLocal({ preview: preview(OK3), previewToken: 'abc123' }));
  assert.ok(html.includes('+ 14 new'));
  assert.ok(html.includes('− 1 leaving'));
  assert.ok(html.includes('1 updated (cover or name)'));
  assert.ok(html.includes('500 unchanged'));
  assert.ok(html.includes('+ 2 more…'));
  assert.ok(html.includes("⚠ it's in your Most Played list"));
  assert.ok(html.includes('nothing is saved until you press Apply'));
});

ok('Apply and Cancel carry the preview token', () => {
  const html = render(catalogLocal({ preview: preview(OK3), previewToken: 'abc123' }));
  assert.ok(/action="\/admin\/psplus\/catalog\/apply"[\s\S]*?name="token" value="abc123"[\s\S]*?Apply changes/.test(html));
  assert.ok(/action="\/admin\/psplus\/catalog\/cancel"[\s\S]*?name="token" value="abc123"/.test(html));
});

ok('a blocked list is explained, and Apply names the lists that look OK', () => {
  const safety = { catalog: { state: 'warn', stored: 388, incoming: 270 }, classics: { state: 'blocked', stored: 151, incoming: 0 }, ubisoft: { state: 'ok', stored: 67, incoming: 67 } };
  const html = render(catalogLocal({ preview: preview(safety), previewToken: 't' }));
  assert.ok(html.includes('Classics came back with 0 games'));
  assert.ok(html.includes('(you have 151)'));
  assert.ok(html.includes('It was <b>not</b> applied'));
  assert.ok(html.includes('Game Catalog lost 30% of its games at once'));
  assert.ok(html.includes('(388 → 270)'));
  assert.ok(html.includes('Apply the 2 lists that look OK'));
});

ok('no Apply button when every list was held back', () => {
  const safety = { catalog: { state: 'failed', stored: 388, incoming: 0 }, classics: { state: 'blocked', stored: 151, incoming: 0 }, ubisoft: { state: 'failed', stored: 67, incoming: 0 } };
  const html = render(catalogLocal({ preview: preview(safety, { added: [], leaving: [], updated: [], unchanged: 0 }), previewToken: 't' }));
  assert.ok(!html.includes('action="/admin/psplus/catalog/apply"'));
  assert.ok(html.includes('Game Catalog couldn&#39;t be read from PlayStation'));
});

ok("PlayStation's monthly games offered as next month's entry", () => {
  const html = render(catalogLocal({ preview: preview(OK3), previewToken: 't',
    monthSuggestion: { year: 2026, month: 10, monthName: 'October', names: ['Chained Echoes', 'Fallout 76'] } }));
  assert.ok(html.includes("PlayStation's monthly games for <b>October 2026</b>: Chained Echoes, Fallout 76."));
  assert.ok(html.includes('data-year="2026" data-month="10" data-games="Chained Echoes\nFallout 76"'));
  assert.ok(html.includes('Create Oct 2026 entry from these'));
});

console.log('\nwiring');

const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function block(startMarker) {
  const i = SRC.indexOf(startMarker);
  assert.ok(i >= 0, 'server.js still has ' + startMarker);
  const next = SRC.indexOf('\napp.', i + startMarker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}

ok('server.js loads the libs and the store at boot', () => {
  ["require('./lib/psplus-feed')", "require('./lib/psplus-catalog')", "require('./lib/psplus-catalog-view')", "require('./lib/psplus-catalog-store')",
    'psplusCatalogStore.init(_getMongoDb);', 'psplusCatalogStore.load()'].forEach(s => assert.ok(SRC.includes(s), s));
});

ok('every catalog route is admin-only and wrapped', () => {
  ['refresh', 'apply', 'cancel', 'add', ':key/visibility', ':key/rent-link', ':key/cover', ':key/remove'].forEach(r => {
    const b = block("app.post('/admin/psplus/catalog/" + r + "', requireAuth,");
    assert.ok(b.includes('asyncRoute(async'), r + ' is wrapped');
  });
});

ok('Apply re-plans against what is stored now and stamps the refresh', () => {
  const b = block("app.post('/admin/psplus/catalog/apply', requireAuth,");
  assert.ok(b.includes('psplusCatalog.applyPlan(psplusCatalogStore.all(), entry.preview.incoming, entry.preview.applied, nowIso)'));
  assert.ok(b.includes('last_refreshed_at: nowIso'));
  assert.ok(b.includes("catalog_expired") && b.includes("catalog_nothing") && b.includes("catalog_error") && b.includes("catalog_applied"));
});

ok('the admin page gets the catalog', () => {
  assert.ok(SRC.includes('psplusSlots: getPsplusSlots(), psplusCatalog: psplusCatalogAdmin,'));
  assert.ok(SRC.includes('psplusCatalogView.buildAdminCatalog({'));
});

ok('every toast exists and opens the PS Plus tab', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'views', 'admin.ejs'), 'utf8');
  ['catalog_applied', 'catalog_expired', 'catalog_unreachable', 'catalog_nothing', 'catalog_saved', 'catalog_error'].forEach(m => {
    assert.ok(admin.includes(m + ":'psplus'"), m + ' tab');
    assert.ok(new RegExp(m + ":'[^']*[^:]'").test(admin.replace(m + ":'psplus'", '')), m + ' text');
  });
});

console.log('\n' + passed + ' assertions passed\n');
