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
  site_settings: {
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
    const marks = ['class="hm-top"', 'class="hm-wrap hm-power-wrap"', 'aria-label="Quick picks"', 'id="topRented"', 'id="newReleasesSection"',
      'id="specialDealsSection"', 'id="comingSoon"', 'id="psplus"', 'id="players"', 'id="reviewsSection"', 'id="how"', '<footer'];
    const at = marks.map(m => home.indexOf(m));
    at.forEach((x, i) => assert.ok(x > 0 && (i === 0 || x > at[i - 1]), marks[i] + ' in order'));
  });
  await okAsync('the old sections are gone, and payment methods are listed only in the footer', async () => {
    ['Which account type is for you?', 'Three ways to play', 'Why Rent From Us', 'Ways to Pay', 'Browse by Price Tier', 'Most Popular', 'hero-v2', 'Rent Longer. Save More.', 'spotlight-section']
      .forEach(t => assert.ok(!home.includes(t), t));
    assert.ok(home.indexOf('GCash') > home.indexOf('<footer'), 'GCash only after the footer starts');
  });
  await okAsync('a game card is on the page before "Choose your player"', async () => {
    assert.ok(home.indexOf('class="game-card') > 0 && home.indexOf('class="game-card') < home.indexOf('id="players"'));
  });

  console.log('\ntop');
  await okAsync('one-line tagline from the hero text, with the compact search beside it', async () => {
    const head = slice(home, 'class="hm-head"', 'class="hm-stage');
    assert.ok(head.includes('<h1 class="hm-tagline">Rent the Latest <span style="color:#F0A500;">PS5 &amp; PS4</span> Games</h1>'));
    assert.ok(head.includes('class="hs hs-compact" id="homeSearch"') && head.includes('id="hsInput"'));
    assert.ok(!home.includes('class="hs-chip"') && !home.includes('Old subtitle'));
  });
  await okAsync('banner: the pinned game first, then the newest releases with cover art, then the owner\'s slides', async () => {
    const banner = slice(home, 'id="hmBanner"', '<aside');
    const slides = [...banner.matchAll(/<a class="hm-slide" href="\/game\/([a-z-]+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(slides, ['zzyzx-delta', 'zzyzx-alpha', 'zzyzx-bravo'], 'unknown pin and the coverless game skipped');
    assert.ok(banner.includes('<a class="hm-slide hm-slide-promo" href="/browse"><img src="/uploads/promo.png" alt="Summer sale"><span class="hm-slide-caption">Summer sale</span></a>'));
    assert.strictEqual((banner.match(/class="hm-dot( on)?"/g) || []).length, 4, '3 games + 1 owner slide');
    assert.ok(slice(banner, 'href="/game/zzyzx-alpha"', '</a>').includes('<span class="tier-pill tier-blue">New Games</span>'));
    assert.ok(slice(banner, 'href="/game/zzyzx-alpha"', '</a>').includes('Weekly from <b>₱349</b>'));
  });
  await okAsync('Top rented beside the banner: last 30 days first, then all-time renters, top 5', async () => {
    const board = slice(home, 'class="hm-board"', '</ol>');
    const titles = [...board.matchAll(/class="hm-board-title">([^<]+)</g)].map(m => m[1]);
    assert.deepStrictEqual(titles, ['Zzyzx Alpha', 'Zzyzx Bravo', 'Zzyzx Echo', 'Zzyzx Charlie'], 'Delta has never been rented');
    assert.ok(board.includes('<span class="hm-rk hm-rk-1">1</span>'));
    assert.deepStrictEqual(cardSlugs(slice(home, 'id="topRented"', 'id="newReleasesSection"')), ['zzyzx-alpha', 'zzyzx-bravo', 'zzyzx-echo', 'zzyzx-charlie']);
    assert.ok(slice(home, 'id="topRented"', 'id="newReleasesSection"').includes('<span class="hm-medal hm-rk-1">#1</span>'));
  });
  await okAsync('Power-up from the site promo, and the trust line', async () => {
    const power = slice(home, 'class="hm-wrap hm-power-wrap"', '</section>');
    assert.ok(power.includes('Rent 30 days → <b>10% off</b>, automatically'));
    assert.ok(power.includes('<li>✓ Ready in minutes</li>') && /<li>✓ \d+ players<\/li>/.test(power));
    assert.ok(!power.includes('recommend us'), 'no reviews yet, so no recommend figure');
  });
  await okAsync('quick picks jump to the blocks and open filtered Browse', async () => {
    const picks = [...slice(home, 'aria-label="Quick picks"', '</div>').matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(picks, ['#newReleasesSection', '#specialDealsSection', '#psplus', '#comingSoon', '/browse?price=low', '/browse?console=ps4', '/browse?genre=Action', '/browse?genre=Horror']);
  });

  console.log('\nshelves and blocks');
  await okAsync('new releases newest first; deals at their deal price; Coming soon with its marker', async () => {
    assert.deepStrictEqual(cardSlugs(slice(home, 'id="newReleasesSection"', 'id="specialDealsSection"')), ['zzyzx-alpha', 'zzyzx-bravo', 'zzyzx-charlie']);
    assert.ok(slice(home, 'id="specialDealsSection"', '<!-- UPCOMING GAMES').includes('Monthly <b>₱599</b>'));
    assert.ok(slice(home, 'id="comingSoon"', '</h2>').includes('<span class="hm-mark hm-sq">□</span>Coming soon'));
  });
  await okAsync('PS Plus card with its weekly price and most-played strip', async () => {
    const ps = slice(home, 'id="psplus"', 'id="players"');
    assert.ok(ps.includes('from <b>₱159</b> / week') && ps.includes('<span>God of War</span>'));
  });
  await okAsync('Choose your player: starting prices and the deposit', async () => {
    const pl = slice(home, 'id="players"', 'id="reviewsSection"');
    ['from ₱399', 'from ₱349', 'from ₱999', 'from ₱159/week', '₱100 refundable deposit'].forEach(t => assert.ok(pl.includes(t), t));
  });
  await okAsync('Achievements: games count and starting price; How to play with the questions', async () => {
    const ach = slice(home, 'id="reviewsSection"', 'id="how"');
    assert.ok(ach.includes('<b>5</b><span>games to play</span>') && ach.includes('<b>₱349</b><span>starting price</span>'));
    const how = slice(home, 'id="how"', '<footer');
    assert.ok(how.includes('Do I need to give you my PSN password?') && how.includes('When do I get my ₱100 deposit back?'));
  });
  await okAsync('the page loads its own styles and banner script; the old phone re-ordering is gone', async () => {
    assert.ok(/<link rel="stylesheet" href="\/css\/home\.css\?v=[^"]+">/.test(home) && /<script src="\/js\/home\.js\?v=[^"]+"><\/script>/.test(home));
    assert.strictEqual((await call('GET', '/css/home.css')).status, 200);
    assert.strictEqual((await call('GET', '/js/home.js')).status, 200);
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(!css.includes('.home-page #newReleasesSection { order'), 'no order re-sorting left');
  });

  console.log('\npromo off');
  await okAsync('with the site promo off the Power-up line disappears', async () => {
    const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(TEST_PASSWORD) });
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    await call('POST', '/admin/promo', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: 'discount_7=0&discount_30=10&deposit=100' });
    const off = (await call('GET', '/')).body;
    assert.ok(!off.includes('class="hm-power"') && off.includes('<li>✓ Ready in minutes</li>'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
