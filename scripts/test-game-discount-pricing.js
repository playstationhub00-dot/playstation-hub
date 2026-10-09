// Run: node scripts/test-game-discount-pricing.js
//
// Per-game discounts reach every page that prices a game's rental. Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a
// made-up admin password) with:
//   Zzyzx Deal    own Monthly 20%           (site promo: Weekly 0%, Monthly 10%)
//   Zzyzx Plain   no own % → site promo
//   Zzyzx Weekly  own Weekly 50%
//   Zzyzx Zero    own Monthly 0% → no discount
//   Zzyzx Unpriced own Monthly 50% but no 30-day prices → no deal, no Infinity/NaN
// The project's games.json, the database and the real admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4612;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'game-discount-pricing-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', cover_image: '/uploads/' + id + '.png',
  nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899,
  non_trophy_slots: 2, trophy_slots: 2, renters: 10 - id
}, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 } },
  games: [
    game(1, 'Zzyzx Deal', { discounts: { 7: null, 30: 20 } }),
    game(2, 'Zzyzx Plain'),
    game(3, 'Zzyzx Weekly', { nt_price_7d: 400, nt_price_30d: 800, tr_price_7d: 450, discounts: { 7: 50, 30: null } }),
    game(4, 'Zzyzx Zero', { discounts: { 7: null, 30: 0 } }),
    game(5, 'Zzyzx Unpriced', { nt_price_30d: 0, tr_price_30d: 0, discounts: { 7: null, 30: 50 } })
  ],
  customers: [{
    id: 1, customer_name: 'Swap Tester', game_id: 2, game_title: 'Zzyzx Plain', days: 30, account_type: 'nt',
    start_date: '2026-10-01', end_date: '2026-10-31', price: 719, status: 'renting', notes: '',
    payments: [{ amount: 719, date: '2026-10-01', kind: 'rental' }]
  }]
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
const get = (p, cookie) => call('GET', p, { headers: cookie ? { Cookie: cookie } : {} });

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }
// The HTML of the card that links to a game, within `html`.
function cardFor(html, slug) {
  const i = html.indexOf('href="/game/' + slug + '"');
  assert.ok(i >= 0, 'card for ' + slug + ' found');
  const end = html.indexOf('</a>', i);
  return html.slice(i, end);
}

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

  console.log('\ngame page');
  await okAsync("a game's own Monthly % replaces the site promo in the page's prices", async () => {
    const r = await get('/game/zzyzx-deal');
    assert.strictEqual(r.status, 200);
    assert.ok(/discounts: \{ 7: 0, 30: 20 \}/.test(r.body), 'PROMO.discounts');
    assert.ok(/enabled: true,/.test(r.body));
    assert.ok(r.body.includes('<span class="gd-dur-promo">20% OFF</span>'));
  });
  await okAsync('a game with no own % follows the site promo', async () => {
    const r = await get('/game/zzyzx-plain');
    assert.ok(/discounts: \{ 7: 0, 30: 10 \}/.test(r.body));
    assert.ok(r.body.includes('<span class="gd-dur-promo">10% OFF</span>'));
  });
  await okAsync('an own 0% means no discount at all', async () => {
    const r = await get('/game/zzyzx-zero');
    assert.ok(/discounts: \{ 7: 0, 30: 0 \}/.test(r.body));
    assert.ok(!r.body.includes('gd-dur-promo'));
  });

  console.log('\ncards and homepage');
  const browse = await get('/browse');
  await okAsync('browse cards carry the deal line only when the own % beats the site promo', async () => {
    assert.ok(cardFor(browse.body, 'zzyzx-deal').includes('🔥 20% OFF · Monthly'));
    assert.ok(cardFor(browse.body, 'zzyzx-weekly').includes('🔥 50% OFF · Weekly'));
    assert.ok(!cardFor(browse.body, 'zzyzx-plain').includes('gc2-deal'));
    assert.ok(!cardFor(browse.body, 'zzyzx-zero').includes('gc2-deal'));
  });
  await okAsync('the Weekly-deal card starts from its discounted weekly price', async () => {
    assert.ok(cardFor(browse.body, 'zzyzx-weekly').includes('from <b>₱200</b>'));
  });
  const home = await get('/');
  await okAsync('the homepage "Special deals" row lists the deals, biggest first, priced at the deal', async () => {
    assert.strictEqual(home.status, 200);
    const start = home.body.indexOf('id="specialDealsSection"');
    assert.ok(start > 0, 'section present');
    const section = home.body.slice(start, home.body.indexOf('<!-- UPCOMING GAMES', start));
    const weekly = section.indexOf('/game/zzyzx-weekly');
    const deal = section.indexOf('/game/zzyzx-deal');
    assert.ok(weekly > 0 && deal > weekly, '50% before 20%');
    assert.ok(!section.includes('/game/zzyzx-plain') && !section.includes('/game/zzyzx-zero'));
    assert.ok(cardFor(section, 'zzyzx-deal').includes('Monthly <b>₱639</b><s class="gc2-price-was">₱799</s>'));
    assert.ok(cardFor(section, 'zzyzx-weekly').includes('Weekly <b>₱200</b><s class="gc2-price-was">₱400</s>'));
  });
  await okAsync('a deal on an unpriced duration shows no Infinity/NaN and no deal line', async () => {
    for (const body of [home.body, browse.body]) assert.ok(!/Infinity|NaN/.test(body));
    assert.ok(cardFor(browse.body, 'zzyzx-unpriced').length > 0);
    assert.ok(!cardFor(browse.body, 'zzyzx-unpriced').includes('gc2-deal'));
  });
  await okAsync('the row sits below the top of the page on every screen (no CSS re-ordering)', async () => {
    assert.ok(home.body.indexOf('id="specialDealsSection"') > home.body.indexOf('class="hm-top"'));
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(!css.includes('#specialDealsSection { order'), 'no phone re-ordering rule');
  });

  console.log('\nfeed');
  await okAsync('the Facebook product feed uses each game\'s own sale price', async () => {
    const r = await get('/feed/meta-catalog.csv');
    const line = label => r.body.split('\n').find(l => l.includes(label)) || '';
    assert.ok(line('Zzyzx Deal — Monthly (Non-Trophy)').includes('639.00 PHP'));
    assert.ok(line('Zzyzx Plain — Monthly (Non-Trophy)').includes('719.00 PHP'));
    assert.ok(line('Zzyzx Weekly — Weekly (Non-Trophy)').includes('200.00 PHP'));
    assert.ok(!line('Zzyzx Zero — Monthly (Non-Trophy)').includes('PHP,7'), 'no sale price');
  });

  console.log('\nadmin pages');
  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(TEST_PASSWORD) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const admin = await get('/admin', cookie);
  await okAsync('Quick Add prices each game with its own % ("Full price" ignores it)', async () => {
    assert.strictEqual(admin.status, 200);
    // The Quick Add picker's option (it carries data-nt7; other pickers don't).
    const opt = id => {
      const m = new RegExp('<option value="' + id + '"\\s+data-nt7=[^>]*>').exec(admin.body);
      return m ? m[0] : '';
    };
    assert.ok(/data-nt30="639"/.test(opt(1)) && /data-nt30f="799"/.test(opt(1)), opt(1).slice(0, 200));
    assert.ok(/data-nt30="719"/.test(opt(2)) && /data-nt30f="799"/.test(opt(2)));
    assert.ok(/data-nt30="799"/.test(opt(4)), 'own 0% → full price even while the site promo is on');
  });
  await okAsync('posters print each game\'s own weekly price', async () => {
    const i = admin.body.indexOf('<div class="poster-tile-title">Zzyzx Weekly</div>');
    assert.ok(i > 0, 'poster tile present');
    assert.ok(admin.body.slice(i, i + 400).includes('from <b>₱200</b>'));
  });
  await okAsync('the swap box knows each game\'s own %', async () => {
    const r = await get('/admin/customers/edit/1', cookie);
    assert.strictEqual(r.status, 200);
    assert.ok(/<option value="1"[\s\S]*?data-pct7="0" data-pct30="20"/.test(r.body));
    assert.ok(/<option value="2"[\s\S]*?data-pct7="0" data-pct30="10"/.test(r.body));
    assert.ok(/<option value="4"[\s\S]*?data-pct7="0" data-pct30="0"/.test(r.body));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
