// Run: node scripts/test-games-template.js
//
// Renders views/partials/admin/games.ejs (the shell plus the four partials
// under views/partials/admin/games/) with fixture data built by the real
// lib/games-view.js, and checks what the Games tab and
// public/js/admin-games.js rely on: the sub-tabs and their counts, each row's
// cells and data-* attributes, the ⋯ menus and their confirm prompts, the
// Coming soon rows, and that every Requests and Price category form survived
// the move.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const gv = require('../lib/games-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'views', 'partials', 'admin', 'games.ejs');
const NOW = new Date('2026-09-26T04:00:00.000Z');
const daysAgo = n => new Date(NOW.getTime() - n * 86400000 - 3600000).toISOString();

// Newest first, as the admin route sorts them.
const GAMES = [
  { id: 3, title: 'Ghost of Yōtei', platform: 'PS5', genre: 'Action', created_at: daysAgo(8), cover_image: '/uploads/goy.webp',
    non_trophy_slots: 2, trophy_slots: 1, renters: 0, nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549,
    cost: 1000, _category_name: 'New Games' },
  { id: 2, title: "Marvel's Spider-Man 2", platform: 'PS4/PS5', genre: 'Action', created_at: daysAgo(90),
    non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 1, renters: 12, stocked: true,
    nt_price_7d: 149, nt_price_30d: 349, tr_price_7d: 199, tr_price_30d: 399, buy_nt_price: 999, cost: 500 },
  { id: 1, title: 'Tekken 8', platform: 'PS5', genre: 'Fighting', created_at: daysAgo(200), is_bundle: true,
    non_trophy_slots: 0, trophy_slots: 0, renters: 8, nt_price_7d: 99, nt_price_30d: 249, tr_price_7d: 149, tr_price_30d: 299 }
];
// Money is what was received — each row's payments — not its price.
const CUSTOMERS = [
  { game_id: 2, payments: [{ amount: 349 }] }, { game_id: '2', payments: [{ amount: 349 }] },
  { game_id: 1, payments: [{ amount: 249 }] }, { game_id: 'upcoming_15', payments: [{ amount: 449 }] }
];
const UPCOMING = [
  { id: 15, title: 'Phantom Blade Zero', platform: 'PS5', release_date: '2026-09-09', non_trophy_slots: 2, trophy_slots: 1,
    nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549 }
];
const REQUESTS = [
  { slug: 'astro-bot', title: 'Astro Bot', status: 'pending', voters: [{ fb_name: 'Ana Cruz', at: '2026-09-20T00:00:00Z' }] },
  { slug: 'elden-ring', title: 'Elden Ring', status: 'approved', voters: [] }
];
const CATEGORIES = [
  { id: 1, name: 'New Games', nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549 }
];

function render(opts) {
  const o = Object.assign({ games: GAMES, upcoming: UPCOMING, requests: REQUESTS, msg: 'cat_added' }, opts || {});
  const rows = gv.gameRows(o.games, CUSTOMERS, {}, NOW);
  const gamesView = {
    rows,
    counts: gv.chipCounts(rows),
    upcoming: gv.upcomingRows(o.upcoming, { '15': 3 }, '2026-09-26'),
    requests: gv.requestSummary(o.requests)
  };
  return ejs.render(fs.readFileSync(FILE, 'utf8'), {
    gamesView, games: o.games, gameRequestRows: o.requests, priceCategories: CATEGORIES, msg: o.msg
  }, { filename: FILE });
}

// One sub-tab's markup: from its data-gm-panel attribute to the next panel.
function panel(html, key) {
  const a = html.indexOf('data-gm-panel="' + key + '"');
  assert.ok(a >= 0, 'panel ' + key);
  const b = html.indexOf('data-gm-panel="', a + 10);
  return html.slice(a, b > 0 ? b : undefined);
}
// One All games row: from its data-gm-game marker to the next row or the
// no-match line. Rows contain their own <details> ⋯ menus, so "up to the
// first closing tag" would cut a row short.
function gameRow(html, id) {
  const a = html.indexOf('data-gm-game data-id="' + id + '"');
  assert.ok(a >= 0, 'row ' + id);
  const ends = ['data-gm-game data-id="', 'id="gmNoMatch"'].map(m => html.indexOf(m, a + 10)).filter(i => i > 0);
  return html.slice(a, Math.min(...ends));
}

const html = render();

console.log('\nsub-tabs');

ok('four sub-tabs with their counts, All games selected and shown first', () => {
  assert.ok(html.includes('data-gm-subtab="all" aria-selected="true">All games <span class="gm-subtab-n">(3)</span>'));
  assert.ok(html.includes('data-gm-subtab="soon" aria-selected="false">Coming soon <span class="gm-subtab-n">(1)</span>'));
  assert.ok(html.includes('data-gm-subtab="requests" aria-selected="false">Requests <span class="gm-subtab-n">(1 pending)</span>'));
  assert.ok(html.includes('data-gm-subtab="categories" aria-selected="false">Price categories <span class="gm-subtab-n">(1)</span>'));
  assert.ok(html.includes('data-gm-panel="all">'));
  ['soon', 'requests', 'categories'].forEach(k => assert.ok(html.includes('data-gm-panel="' + k + '" hidden>'), k));
});

ok('Requests shows its total when nothing is pending', () => {
  assert.ok(render({ requests: [REQUESTS[1]] }).includes('Requests <span class="gm-subtab-n">(1)</span>'));
});

ok("this load's message rides along for the sub-tab script", () => {
  assert.ok(html.includes('id="gmShell" data-msg="cat_added"'));
  assert.ok(render({ msg: null }).includes('id="gmShell" data-msg=""'));
});

ok('+ Add New → Price Category opens the categories form instead of scrolling to it', () => {
  assert.ok(html.includes('window.gmOpenNewCategory()'));
  assert.ok(!html.includes('#add-category-form'));
});

console.log('\nAll games');

ok('toolbar: search, five chips with counts, platform and sort', () => {
  const p = panel(html, 'all');
  assert.ok(p.includes('id="gmSearch"'));
  [['all', 'All', 3], ['new', '🆕 New', 1], ['soldout', '⛔ Sold out', 1], ['never', '💤 Never rented', 1], ['bundle', '📦 Bundles', 1]]
    .forEach(([k, label, n]) => assert.ok(p.includes('data-gm-chip="' + k + '">' + label + ' <span class="gm-chip-n">' + n + '</span>'), k));
  assert.ok(p.includes('<select id="gmPlatform"'));
  ['all', 'PS5', 'PS4', 'PS4/PS5'].forEach(v => assert.ok(p.includes('<option value="' + v + '">'), v));
  assert.ok(p.includes('<select id="gmSort"'));
  ['newest', 'az', 'earned', 'slots'].forEach(v => assert.ok(p.includes('<option value="' + v + '">'), v));
});

ok('rows arrive newest first, each carrying the data the filter script reads', () => {
  const ids = [...html.matchAll(/data-gm-game data-id="(\d+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(ids, ['3', '2', '1']);
  assert.ok(gameRow(html, 3).includes('data-chips="new never" data-platform="PS5" data-s="ghost of yōtei action new games" data-title="Ghost of Yōtei" data-earned="0" data-slots="3"'));
  assert.ok(gameRow(html, 2).includes('data-chips="" data-platform="PS4/PS5"'));
});

ok('game cell: cover, title, platform · genre, category and bundle tags', () => {
  const r3 = gameRow(html, 3);
  assert.ok(r3.includes('<img src="/uploads/goy.webp" class="gm-cover"'));
  assert.ok(r3.includes('class="gm-title">Ghost of Yōtei<'));
  assert.ok(r3.includes('class="gm-sub">PS5 · Action<'));
  assert.ok(r3.includes('🏷️ New Games'));
  assert.ok(!r3.includes('gm-tag-bundle'));
  assert.ok(gameRow(html, 1).includes('class="gm-tag gm-tag-bundle">📦 Bundle<'));
  assert.ok(gameRow(html, 1).includes('class="gm-cover gm-cover-ph">🎮<'));
});

ok('slot chips go red at 0, and PS4 shows only on a PS4 platform', () => {
  const r2 = gameRow(html, 2);
  assert.ok(r2.includes('class="gm-slot gm-slot-zero">NT 0<'));
  assert.ok(r2.includes('class="gm-slot gm-slot-tr gm-slot-zero">TR 0<'));
  assert.ok(r2.includes('class="gm-slot">PS4 1<'));
  const r3 = gameRow(html, 3);
  assert.ok(r3.includes('class="gm-slot">NT 2<'));
  assert.ok(r3.includes('class="gm-slot gm-slot-tr">TR 1<'));
  assert.ok(!r3.includes('>PS4 '));
});

ok('prices: weekly / monthly for NT and TR, and a Buy line only when a buy price is set', () => {
  const r3 = gameRow(html, 3);
  assert.ok(r3.includes('<div>NT ₱199 / ₱449</div>'));
  assert.ok(r3.includes('<div class="gm-tr">TR ₱249 / ₱549</div>'));
  assert.ok(!r3.includes('gm-buy'));
  assert.ok(gameRow(html, 2).includes('<div class="gm-buy">Buy NT ₱999</div>'));
});

ok('status chips: New with days left (urgent at 3 or fewer), Never rented, Sold out, Stocked', () => {
  const r3 = gameRow(html, 3);
  assert.ok(r3.includes('class="gm-st gm-st-new gm-st-urgent">NEW · 3d left<'));
  assert.ok(r3.includes('class="gm-st gm-st-never">Never rented<'));
  assert.ok(gameRow(html, 2).includes('class="gm-st gm-st-stocked">Stocked<'));
  assert.ok(!gameRow(html, 2).includes('Sold out'));
  assert.ok(gameRow(html, 1).includes('class="gm-st gm-st-sold">Sold out<'));
});

ok('money: earned with its transactions, then profit or loss', () => {
  const r2 = gameRow(html, 2);
  assert.ok(r2.includes('₱698 earned <span class="gm-txns">2 txns</span>'));
  assert.ok(r2.includes('<div class="gm-profit">+₱198 profit</div>'));
  assert.ok(gameRow(html, 1).includes('<span class="gm-txns">1 txn</span>'));
  assert.ok(gameRow(html, 3).includes('<div class="gm-profit gm-loss">₱1,000 at a loss</div>'));
});

ok('actions: Edit, and ⋯ holding Stock and Delete with the old confirm prompt', () => {
  const r2 = gameRow(html, 2);
  assert.ok(r2.includes('<a href="/admin/edit/2" class="gm-btn">✏️ Edit</a>'));
  const menu = r2.slice(r2.indexOf('class="gm-more-menu"'));
  assert.ok(menu.includes('action="/admin/games/2/stocked"'));
  assert.ok(menu.includes('📦 Clear stocked'));
  assert.ok(menu.includes('action="/admin/delete/2" onsubmit="return confirm(\'Delete Marvel\\&#39;s Spider-Man 2?\')"'));
  assert.ok(gameRow(html, 3).includes('📦 Mark as stocked'));
});

ok('an empty library and an over-filtered list each get their own line', () => {
  assert.ok(html.includes('id="gmNoMatch" hidden>No games match these filters.'));
  const none = render({ games: [] });
  assert.ok(panel(none, 'all').includes('No games yet. Use + Add New to add one.'));
  assert.ok(!none.includes('id="gmList"'));
});

console.log('\nComing soon');

ok('rows keep the reserved count and the ready-to-release nudge', () => {
  const p = panel(html, 'soon');
  assert.ok(p.includes('class="gm-title">Phantom Blade Zero<'));
  assert.ok(p.includes('<div class="gm-cs-reserved">3 reserved</div>'));
  assert.ok(p.includes('📅 Out since Sep 9, 2026 — ready to release'));
  assert.ok(p.includes('<div class="gm-c-release">Sep 9, 2026</div>'));
});

ok('Release keeps its exact confirm prompt; Edit and Delete sit behind ⋯', () => {
  const p = panel(html, 'soon');
  assert.ok(p.includes("onsubmit=\"return confirm('Release \\'Phantom Blade Zero\\' to Available Games? 3 paid reservations will move to sign-in.')\""));
  const menu = p.slice(p.indexOf('class="gm-more-menu"'));
  assert.ok(menu.includes('href="/admin/upcoming/edit/15"'));
  assert.ok(menu.includes("action=\"/admin/upcoming/delete/15\" onsubmit=\"return confirm('Delete Phantom Blade Zero?')\""));
});

ok('no upcoming games shows the empty line', () => {
  assert.ok(panel(render({ upcoming: [] }), 'soon').includes('No upcoming games. Use + Add New → Upcoming Game.'));
});

console.log('\nRequests and Price categories');

ok('every Requests form, route and confirm prompt survived the move', () => {
  const p = panel(html, 'requests');
  ['/admin/requests/astro-bot/approve', '/admin/requests/astro-bot/reject', '/admin/requests/astro-bot/delete',
   '/admin/requests/astro-bot/image', '/admin/requests/astro-bot/voter/rename', '/admin/requests/astro-bot/voter/remove',
   '/admin/requests/elden-ring/stock']
    .forEach(a => assert.ok(p.includes('action="' + a + '"'), a));
  assert.ok(p.includes("confirm('Remove this vote?')"));
  assert.ok(p.includes("confirm('Delete this request permanently?')"));
  assert.ok(p.includes('<option value="3">Ghost of Yōtei</option>'));
});

ok('the category list is unchanged and the new-category form waits behind + New category', () => {
  const p = panel(html, 'categories');
  assert.ok(p.includes('action="/admin/price-categories/edit/1"'));
  assert.ok(p.includes('<details class="gm-newcat" id="gmNewCat">'));
  assert.ok(p.includes('<summary class="gm-newcat-btn">+ New category</summary>'));
  assert.ok(p.indexOf('action="/admin/price-categories/add"') > p.indexOf('id="gmNewCat"'));
});

console.log('\nwiring');

ok('server.js builds gamesView once and hands it to the admin page', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(SRC.includes("const gamesViewLib = require('./lib/games-view');"));
  assert.ok(SRC.includes('gamesViewLib.gameRows(games, customers, buildAccountSummaryMap(), new Date())'));
  assert.ok(SRC.includes('templateTokens: templates.TOKENS, gamesView, orderQueue,'));
});

ok('the old inline filter script and jump links are gone from the Games tab', () => {
  const src = fs.readFileSync(FILE, 'utf8');
  ['filterGamesPlatform', 'applyGameFilter', 'toggleGamesNewOnly', 'adm-jump'].forEach(s => assert.ok(!src.includes(s), s));
});

console.log('\nstyles');

const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');

ok('every gm- class the tab renders has a rule', () => {
  const rendered = new Set([...html.matchAll(/class="([^"]*)"/g)]
    .flatMap(m => m[1].split(/\s+/))
    .filter(c => /^gm-/.test(c)));
  const missing = [...rendered].filter(c => !CSS.includes('.' + c));
  assert.deepStrictEqual(missing, []);
});

ok('style.css is still CRLF throughout', () => {
  const lf = CSS.split('\n').length - 1;
  const crlf = CSS.split('\r\n').length - 1;
  assert.strictEqual(lf, crlf, 'every newline is CRLF');
});

console.log('\n' + passed + ' assertions passed\n');
