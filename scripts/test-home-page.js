// Run: node scripts/test-home-page.js
//
// The "arcade store" homepage as the server renders it: the blocks in order,
// the tagline and compact search, the banner (pins first, cover art only, the
// owner's slides after), Top rented, the Power-up and trust lines, quick picks,
// the game shelves, Coming soon, PS Plus, Choose your player, Achievements,
// How to play, and the old sections gone. Boots a throwaway instance (temp
// DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin password);
// the project's games.json, the database and the real admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4618;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-page-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const daysAgo = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const prices = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '/uploads/' + id + '.png',
  non_trophy_slots: 1, trophy_slots: 1, renters: 0, created_at: '2020-01-01T00:00:00.000Z'
}, prices, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  migrations: ['theme-presets-2026-10-29'],
  site_settings: {
    themes: { base: 'classic', presets: { halloween: { start: '', end: '', line1: '', highlight: '', line2: '' }, christmas: { start: '', end: '', line1: '', highlight: '', line2: '' } } },
    promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 },
    hero_text: { line1: 'Rent the Latest', highlight: 'PS5 & PS4', line2: 'Games', subtitle: 'Old subtitle', title_size: 55, highlight_color: '#F0A500', subtitle_color: '#aaaaaa' },
    hero_slides: [{ id: 1, path: '/uploads/promo.png', caption: 'Summer sale', link: '/browse' }],
    home_banner_ids: [4, 99],
    payment_methods: [{ key: 'gcash', label: 'GCash', enabled: true }]
  },
  price_categories: [Object.assign({ id: 1, name: 'New Games' }, prices), Object.assign({ id: 2, name: 'Deluxe' }, prices)],
  psplus_prices: { nt_price_7d: 159, tr_price_7d: 199 },
  psplus_popular: [{ id: 1, title: 'God of War', cover_image: '/uploads/gow.png', rank: 1 }],
  upcoming: [{ id: 1, title: 'Zzyzx Future', platform: 'PS5', release_date: '2027-01-01', non_trophy_slots: 2, trophy_slots: 0, nt_price_7d: 699, nt_price_30d: 999 }],
  games: [
    game(1, 'Zzyzx Alpha', { release_date: daysAgo(9), price_category_id: 1, renters: 3 }),
    game(2, 'Zzyzx Bravo', { release_date: daysAgo(20), price_category_id: 2, genre: 'Action, RPG', renters: 8 }),
    game(3, 'Zzyzx Charlie', { release_date: daysAgo(30), cover_image: '', genre: 'Horror', renters: 1 }),
    game(4, 'Zzyzx Delta', { platform: 'PS4/PS5', genre: 'Horror', buy_nt_price: 999 }),
    game(5, 'Zzyzx Echo', { discounts: { 7: null, 30: 25 }, renters: 2 })
  ],
  customers: [
    { id: 1, customer_name: 'Ana', game_id: 1, game_title: 'Zzyzx Alpha', days: 7, start_date: daysAgo(5), end_date: daysAgo(-2), status: 'renting', price: 349, payments: [] },
    { id: 2, customer_name: 'Ben', game_id: 1, game_title: 'Zzyzx Alpha', days: 7, start_date: daysAgo(3), end_date: daysAgo(-4), status: 'renting', price: 349, payments: [] },
    { id: 3, customer_name: 'Cy', game_id: 2, game_title: 'Zzyzx Bravo', days: 30, start_date: daysAgo(40), end_date: daysAgo(10), status: 'returned', price: 719, payments: [] }
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method, headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers), timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}
// The HTML from an element's id (or a marker string) to the next given marker.
function slice(html, from, to) {
  const i = html.indexOf(from);
  assert.ok(i >= 0, from + ' found');
  const j = to ? html.indexOf(to, i + from.length) : html.length;
  return html.slice(i, j < 0 ? html.length : j);
}
const cardSlugs = html => [...html.matchAll(/href="\/game\/([a-z0-9-]+)" class="game-card/g)].map(m => m[1]);

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
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const r = await call('GET', '/');
  const home = r.body;
  console.log('\nlayout');
  await okAsync('the blocks render in order, the same on every screen size', async () => {
    assert.strictEqual(r.status, 200);
    assert.ok(home.includes('<body class="home2">'));
    const marks = ['id="announcementBar"', '<nav>', 'id="annBanner"', 'class="hm-tagline"', 'id="homeSearch"', 'id="newReleasesSection"',
      'id="comingSoon"', 'id="specialDealsSection"', 'id="how"', 'id="players"', 'id="topRented"', 'id="psplus"', 'id="reviewsSection"', '<footer'];
    const at = marks.map(m => home.indexOf(m));
    at.forEach((x, i) => assert.ok(x > 0 && (i === 0 || x > at[i - 1]), marks[i] + ' in order'));
  });
  await okAsync('the old sections are gone, and the reservation hero has no price', async () => {
    ['Which account type is for you?', 'Three ways to play', 'Why Rent From Us', 'Ways to Pay', 'Browse by Price Tier', 'Most Popular', 'hero-v2', 'Rent Longer. Save More.', 'spotlight-section', 'id="hmBanner"', '100% safe', 'no risk', 'always 10% off']
      .forEach(t => assert.ok(!home.includes(t), t));
    const hero = slice(home, 'id="annBanner"', 'id="find"');
    assert.ok(!hero.includes('₱'), 'no price on the reservation card');
    assert.ok(hero.includes('Reserve on Messenger') && hero.includes('Browse new games'));
  });
  await okAsync('a game card is on the page before "Choose your player"', async () => {
    assert.ok(home.indexOf('class="game-card') > 0 && home.indexOf('class="game-card') < home.indexOf('id="players"'));
  });

  console.log('\ntop');
  await okAsync('one-line tagline from the hero text, with the compact search under the hero', async () => {
    assert.ok(home.includes('<h1 class="hm-tagline">PlayStation Hub · Rent the Latest <span style="color:#F0A500;">PS5 &amp; PS4</span> Games</h1>'));
    assert.ok(home.includes('class="hs hs-compact" id="homeSearch"') && home.includes('id="hsInput"'));
    assert.ok(!home.includes('class="hs-chip"') && !home.includes('Old subtitle'));
    assert.ok(home.includes('Sold out? Fall in line for free'));
    assert.ok(home.includes('Every 5th paid rental is a free 7-day rental.'));
  });
  await okAsync('the Now playing slider is gone; new releases keep cover art and the tier', async () => {
    const row = slice(home, 'id="newReleasesSection"', 'id="comingSoon"');
    assert.ok(row.includes('href="/game/zzyzx-alpha"'));
    assert.ok(row.includes('<span class="tier-pill tier-blue">New Games</span>'));
    assert.ok(row.includes('Rent now'));
  });
  await okAsync('Top rented this month: last 30 days first, then all-time renters', async () => {
    const titles = [...slice(home, 'id="topRented"', 'id="psplus"').matchAll(/href="\/game\/([a-z0-9-]+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(titles, ['zzyzx-alpha', 'zzyzx-bravo', 'zzyzx-echo', 'zzyzx-charlie'], 'Delta has never been rented');
  });
  await okAsync('the trust line is under the search, with no recommend figure yet', async () => {
    const find = slice(home, 'id="find"', 'id="shelves"');
    assert.ok(!find.includes('10% off'), 'the 10% line stays hidden until a monthly promo is live');
    assert.ok(!home.includes(', automatically'));
    assert.ok(find.includes('<li><span class="hm-tick" aria-hidden="true">✓</span> Ready in minutes</li>') && /<li><span class="hm-tick" aria-hidden="true">✓<\/span> \d+ players<\/li>/.test(find));
    assert.ok(!find.includes('recommend us'), 'no reviews yet, so no recommend figure');
  });
  await okAsync('quick picks jump to the blocks and open filtered Browse', async () => {
    const picksNav = slice(home, 'aria-label="Quick picks"', '</nav>');
    const picks = [...picksNav.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(picks, ['#newReleasesSection', '#specialDealsSection', '#psplus', '#comingSoon', '/browse?price=low', '/browse?console=ps4', '/browse?genre=Action', '/browse?genre=Horror']);
    ['New releases', 'Deals', 'PS Plus', 'Coming soon', 'Plays on PS4', 'Action', 'Horror'].forEach(label => {
      assert.ok(picksNav.includes('>' + label + '</a>'), label);
    });
    assert.ok(!/<a\b[^>]*>\s*<\/a>/.test(picksNav), 'every chip has text');
  });

  console.log('\nshelves and blocks');
  await okAsync('new releases newest first; deals at their deal price; Coming soon with its marker and no price', async () => {
    assert.deepStrictEqual(cardSlugs(slice(home, 'id="newReleasesSection"', 'id="comingSoon"')), ['zzyzx-alpha', 'zzyzx-bravo', 'zzyzx-charlie']);
    assert.ok(slice(home, 'id="newReleasesSection"', '</h2>').includes('<a class="hm-viewall" href="/browse?tab=new">View all ›</a>'), 'View all opens the New releases tab');
    assert.ok(slice(home, 'id="specialDealsSection"', 'id="how"').includes('Monthly <b>₱599</b>'));
    assert.ok(slice(home, 'id="comingSoon"', '</h2>').includes('<span aria-hidden="true" class="hm-mark hm-sq">□</span>Coming soon'));
    const soon = slice(home, 'id="comingSoon"', 'id="specialDealsSection"');
    assert.ok(soon.includes('Reserve a slot') && soon.includes('>Reserve</div>'));
    assert.ok(!soon.includes('₱'), 'coming soon cards have no price');
  });
  await okAsync('PS Plus card with its weekly price and most-played strip', async () => {
    const ps = slice(home, 'id="psplus"', 'id="reviewsSection"');
    assert.ok(ps.includes('from <b>₱159</b> / week') && ps.includes('<span>God of War</span></a>'));
    assert.ok(ps.includes('class="hr-ps-band"') && ps.includes('/gow.png'), 'logo band and the game cover');
    assert.ok(ps.includes('href="/ps-plus/rent"') && ps.includes('href="/ps-plus"'));
  });
  await okAsync('Choose your player: catalogue prices, the deposit, and no PS4 price', async () => {
    const pl = slice(home, 'id="players"', 'id="topRented"');
    ['from ₱399', 'from ₱349', 'from ₱999', '₱100 refundable deposit', 'Ask about PS4 Primary', 'Free 3-hour try'].forEach(t => assert.ok(pl.includes(t), t));
    assert.ok(pl.includes('from <b>₱159</b> / week') === false);
    const ps4 = pl.slice(pl.indexOf('PS4 Primary'));
    assert.ok(!ps4.slice(0, ps4.indexOf('</a>')).includes('from ₱'), 'PS4 Primary card has no price');
  });
  await okAsync('Achievements: games count and starting price; questions stay on the page', async () => {
    const ach = slice(home, 'id="reviewsSection"', 'class="hr-cta"');
    assert.ok(ach.includes('<b>5</b><span>games to play</span>') && ach.includes('<b>₱349</b><span>starting price</span>'));
    assert.ok(ach.includes('Do I need to give you my PSN password?') && ach.includes('When do I get my ₱100 deposit back?'));
    assert.ok(ach.includes('href="/faq"'));
  });
  await okAsync('a short start-here bar under the games links the rental guides with plain anchors', async () => {
    const at = home.indexOf('id="startHere"');
    assert.ok(home.indexOf('class="game-card') < at && at < home.indexOf('id="how"'));
    const bar = slice(home, 'id="startHere"', 'id="how"');
    assert.ok(bar.includes('New to renting? Start here'));
    assert.ok(bar.includes('<a href="/how-it-works">How renting works</a>'));
    assert.ok(bar.includes('<a href="/guides/trophy-vs-non-trophy-vs-ps4-primary">Trophy vs Non-Trophy vs PS4 Primary</a>'));
    assert.ok(bar.includes('<a href="/guides/ps-plus-deluxe-vs-renting">PS Plus Deluxe vs renting</a>'));
    assert.strictEqual((home.match(/<a href="\/guides" class="">Guides<\/a>/g) || []).length, 2, 'desktop menu and phone drawer');
    assert.ok(home.includes('<a href="/guides">Guides</a>'), 'footer');
  });
  await okAsync('the page loads its own styles and banner script; the old phone re-ordering is gone', async () => {
    assert.ok(/<link rel="stylesheet" href="\/css\/home\.css\?v=[^"]+">/.test(home) && /<script src="\/js\/home\.js\?v=[^"]+"><\/script>/.test(home));
    assert.strictEqual((await call('GET', '/css/home.css')).status, 200);
    assert.strictEqual((await call('GET', '/js/home.js')).status, 200);
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(!css.includes('.home-page #newReleasesSection { order'), 'no order re-sorting left');
  });

  console.log('\nseo parity');
  await okAsync('internal links, headings, and JSON-LD types from the previous homepage are still there', async () => {
    [
      'href="/"', 'href="/browse"', 'href="/buy"', 'href="/ps-plus"', 'href="/ps-plus/rent"', 'href="/requests"',
      'href="/how-it-works"', 'href="/how-to-sign-in"', 'href="/guides"', 'href="/faq"', 'href="/announcements"',
      'href="/guides/trophy-vs-non-trophy-vs-ps4-primary"', 'href="/guides/ps-plus-deluxe-vs-renting"',
      'href="/browse?tab=new"', 'href="/browse?tab=coming-soon"', 'href="/browse?tab=most-rented"',
      'href="/browse?price=low"', 'href="/browse?console=ps4"', 'href="/#how"',
      'https://m.me/PlaystationHub00', 'https://facebook.com/PlaystationHub00',
      'class="social-icon facebook"', 'class="social-icon messenger"'
    ].forEach(t => assert.ok(home.includes(t), t));
    [
      'PlayStation Hub', 'What game are you looking for?', 'New releases', 'Coming soon', 'Loot drops',
      'PS Plus Deluxe', 'Choose your player', 'Achievements unlocked', 'New to renting? Start here',
      'How to play', 'How renting works', 'Questions', 'Top rented', 'Players trust us'
    ].forEach(t => assert.ok(home.includes(t), t));
    const types = [...home.matchAll(/"@type":"([^"]+)"/g)].map(m => m[1]);
    ['FAQPage', 'OnlineStore', 'WebSite', 'Question'].forEach(t => assert.ok(types.includes(t), t));
    assert.ok(home.includes('Do I need to give you my PSN password?'));
    assert.ok(home.includes('Can I try a game before I pay?'));
  });

  console.log('\npromo off');
  await okAsync('the 10% line appears only while a monthly promo is live, then hides when the site promo is off', async () => {
    const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(TEST_PASSWORD) });
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    await call('POST', '/admin/promos/save', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: 'title=' + encodeURIComponent('Monthly 10%') + '&text=' + encodeURIComponent('10% off monthly rentals.') + '&badge=' + encodeURIComponent('10% off') + '&enabled=on' });
    const on = (await call('GET', '/')).body;
    assert.ok(on.includes('Rent 30 days → <b>10% off</b> while the monthly promo is on'));
    assert.ok(!on.includes(', automatically'));
    await call('POST', '/admin/promo', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: 'discount_7=0&discount_30=10&deposit=100' });
    const off = (await call('GET', '/')).body;
    assert.ok(!off.includes('class="hm-power"') && off.includes('<li><span class="hm-tick" aria-hidden="true">✓</span> Ready in minutes</li>'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
