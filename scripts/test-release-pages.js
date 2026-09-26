// Run: node scripts/test-release-pages.js
//
// The Coming Soon rows of the admin Games tab (rendered for real with
// fixtures), and the customer order page's released wording (checked at
// source level, the same way scripts/test-qr-expiry.js checks that page —
// rendering it needs the whole review/sign-in machinery).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const GAMES = path.join(ROOT, 'views', 'partials', 'admin', 'games.ejs');

function renderGames(over) {
  const upcoming = [
    { id: 15, title: 'Phantom Blade Zero', platform: 'PS5', release_date: '2026-09-09', non_trophy_slots: 2, trophy_slots: 1, nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549 },
    { id: 16, title: "Tom's Game", platform: 'PS5', release_date: '2026-12-01', non_trophy_slots: 1, trophy_slots: 1, nt_price_7d: 199, nt_price_30d: 449 },
    { id: 17, title: 'Mystery Title', platform: 'PS5', release_date: 'TBA', non_trophy_slots: 0, trophy_slots: 0 }
  ];
  const locals = Object.assign({
    games: [], customers: [], upcoming, gameRequestRows: [], priceCategories: [],
    upcomingReservedCount: { '15': 3, '16': 1 }, todayManila: '2026-09-26'
  }, over || {});
  return ejs.render(fs.readFileSync(GAMES, 'utf8'), locals, { filename: GAMES });
}
function row(html, title) {
  const i = html.indexOf('<strong>' + title);
  assert.ok(i >= 0, 'row for ' + title);
  const end = html.indexOf('</tr>', i);
  return html.slice(i, end);
}

const html = renderGames();

console.log('\nComing Soon rows');

ok('each row shows how many paid reservations it has', () => {
  assert.ok(row(html, 'Phantom Blade Zero').includes('3 reserved'));
  assert.ok(row(html, 'Tom&#39;s Game').includes('1 reserved'));
});

ok('a game nobody reserved shows no count', () => {
  assert.ok(!row(html, 'Mystery Title').includes('reserved</div>'));
});

ok('only a game whose release date has passed gets the ready-to-release nudge', () => {
  assert.ok(row(html, 'Phantom Blade Zero').includes('📅 Out since Sep 9, 2026 — ready to release'));
  assert.ok(!row(html, 'Tom&#39;s Game').includes('ready to release'));
  assert.ok(!row(html, 'Mystery Title').includes('ready to release'));
});

ok('the release confirm prompt says how many reservations will move', () => {
  assert.ok(row(html, 'Phantom Blade Zero').includes(' 3 paid reservations will move to sign-in.'));
  assert.ok(row(html, 'Tom&#39;s Game').includes(' 1 paid reservation will move to sign-in.'));
  assert.ok(row(html, 'Mystery Title').includes("to Available Games?')"), 'no sentence when nobody reserved');
});

console.log('\ncustomer order page');

const ORDER_PAGE = fs.readFileSync(path.join(ROOT, 'views', 'order-status.ejs'), 'utf8');

ok('a released reservation gets its own sign-in heading', () => {
  assert.ok(ORDER_PAGE.includes('awaiting_qr:       order.released_at'));
  assert.ok(ORDER_PAGE.includes("title: 'It\\'s out — time to sign in! 🎮'"));
  assert.ok(ORDER_PAGE.includes("' has released. Send your sign-in code below and we\\'ll set you up.'"));
});

ok('a remaining balance is due before sign-in once released', () => {
  assert.ok(ORDER_PAGE.includes("order.released_at ? 'before we sign you in'"));
});

console.log('\n' + passed + ' assertions passed\n');
