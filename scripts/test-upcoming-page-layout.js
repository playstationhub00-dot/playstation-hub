// Run: node scripts/test-upcoming-page-layout.js
//
// The Coming soon page uses the released-game page's layout (breadcrumb,
// pills, title column, gameplay strip, tabs, booking card) and the reserve
// form still posts the same fields to /order/reserve. Seeded sample games
// only. Nothing here is a real customer.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4766;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'upcoming-layout-'));
const price = { nt_price_7d: 449, nt_price_30d: 899, tr_price_7d: 549, tr_price_30d: 1099, non_trophy_slots: 2, trophy_slots: 1 };
const psn = {
  concept_id: '1', source: 'auto', fetched_at: '2026-11-01T00:00:00.000Z',
  description: 'First sample paragraph.\n\nSecond sample paragraph for the details tab.',
  tagline: 'Sample tagline.', genres: ['Action'], publisher: 'Zzyzx Publishing',
  voices: ['English'], age_rating: 'ESRB Mature', rating: { avg: 4.5, count: 10 },
  screenshots: ['/uploads/layout-a.webp', '/uploads/layout-b.webp'],
  videos: ['/uploads/layout-trailer.mp4']
};
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100, buy_promo_enabled: false, buy_promo_pct: 0 } },
  games: [Object.assign({ id: 2, title: 'Zzyzx Rental', platform: 'PS5', genre: 'Action', release_date: '2026-01-02', cover_image: '/uploads/rent.webp', gallery: ['/uploads/layout-a.webp', '/uploads/layout-b.webp'] }, price)],
  upcoming: [Object.assign({ id: 1, title: 'Zzyzx Horizon', platform: 'PS5', genre: 'Action', release_date: '2026-12-01', cover_image: '/uploads/soon.webp', buy_nt_price: 2499, buy_tr_price: 3499, gallery: ['/uploads/layout-a.webp', '/uploads/layout-b.webp'], psn }, price)],
  customers: []
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'upcoming-layout-test';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(method, p, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test' }, headers || {}), timeout: 20000 }, res => {
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
const get = (p) => call('GET', p);

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function formSlice(html, id) {
  const start = html.indexOf('id="' + id + '"');
  assert.ok(start > 0, id);
  const end = html.indexOf('</form>', start);
  return html.slice(start, end);
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
    try { await get('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const soon = await get('/upcoming/zzyzx-horizon-1');
  assert.strictEqual(soon.status, 200);
  const page = soon.body;

  console.log('\nlayout');
  await okAsync('same two-column page as a released game, with a countdown pill', async () => {
    assert.ok(page.includes('class="gd-page-booking-v2 gp-redesign gp-upcoming"'));
    assert.ok(page.includes('class="gp-grid"') && page.includes('class="gp-hero"') && page.includes('class="gd-detail-col gp-panel"'));
    assert.ok(page.includes('href="/browse">← Back to Catalog</a>'));
    assert.ok(page.includes('href="/browse?tab=coming-soon">Coming soon</a>'));
    assert.ok(page.includes('<h1 class="usd-title">Zzyzx Horizon</h1>'));
    assert.strictEqual((page.match(/<h1\b/g) || []).length, 1);
    assert.ok(page.includes('days until release') || page.includes('Date TBA') || page.includes('Any day now'));
    assert.ok(page.includes('>Coming soon</span>'));
    assert.ok(page.includes('>PS5</span>') && page.includes('>Action</span>'));
    assert.ok(page.includes('<div class="gpa-tagline">Sample tagline.</div>'));
    assert.ok(page.includes('class="gp-clamp">'));
    assert.ok(page.includes('Read more ›'));
    assert.ok(page.includes('class="gp-chips"'));
    assert.ok(page.includes('<b>Release date</b>'));
    assert.ok(page.includes('<b>Publisher</b>Zzyzx Publishing'));
    assert.ok(page.includes('<b>Rating</b>ESRB Mature'));
    assert.ok(!page.includes('class="usd-hero"'));
    assert.ok(!page.includes('class="seo-intro"'));
  });
  await okAsync('gameplay strip and tabs, and no empty FAQ tab', async () => {
    assert.ok(page.includes('data-film') && page.includes('id="gpLightbox"') && page.includes('Gameplay'));
    assert.ok(page.includes('id="gpTabs"') && page.includes('Before you rent') && page.includes('>Details<'));
    assert.ok(page.includes('About this game') && page.includes('<td>Publisher</td><td>Zzyzx Publishing</td>'));
    const tablist = page.slice(page.indexOf('id="gpTabs"'), page.indexOf('id="gpPaneBefore"'));
    assert.ok(!tablist.includes('FAQ') && !page.includes('id="gpPaneFaq"'));
    assert.ok(!tablist.includes('Customer reviews'));
  });

  console.log('\nreserve form');
  await okAsync('the rent form still posts the same fields, with the payment note and Messenger link', async () => {
    const form = formSlice(page, 'reserveForm');
    assert.ok(form.startsWith('id="reserveForm"') || page.slice(page.indexOf('id="reserveForm"') - 80, page.indexOf('id="reserveForm"')).includes('action="/order/reserve"'));
    assert.ok(page.includes('<form method="POST" action="/order/reserve" class="gd-order-form" id="reserveForm"'));
    assert.ok(form.includes('name="game_id" value="1"'));
    assert.ok(form.includes('name="client_token"'));
    assert.ok(form.includes('name="account_type" id="reserveType"'));
    assert.ok(form.includes('name="days" id="reserveDays"'));
    assert.ok(form.includes('name="fb_name" id="reserveFbName"'));
    assert.ok(!form.includes('name="kind"'));
    assert.ok(form.includes('placeholder="Your Facebook name"'));
    assert.ok(page.includes('id="reserveLinkSlot" href="http://m.me/PlaystationHub00"'));
    assert.ok(page.includes('or message us on Facebook instead'));
    assert.ok(page.includes('nothing more due on release'));
    assert.ok(page.includes('GCash or Maya') || page.includes('PayPal'));
    assert.ok(page.includes('const NT_PRICES  = { 7: 449, 30: 899 };'));
    assert.ok(page.includes('const TR_PRICES  = { 7: 549, 30: 1099 };'));
    assert.ok(page.includes('const NT_SLOTS   = 2;'));
    assert.ok(page.includes('const TR_SLOTS   = 1;'));
    assert.ok(!page.includes('id="voucherBox"'));
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'upcoming-detail.js'), 'utf8');
    assert.ok(/isTrophy \? 100 : 0/.test(js), 'trophy deposit is still 100');
    assert.ok(/reserveType'\)\.value = selectedType/.test(js));
    assert.ok(/reserveDays'\)\.value = selectedDays/.test(js));
  });
  await okAsync('Buy permanent still posts kind=buy on the same route', async () => {
    const form = formSlice(page, 'udBuyForm');
    assert.ok(page.includes('<form method="POST" action="/order/reserve" class="gd-order-form" id="udBuyForm"'));
    assert.ok(form.includes('name="kind" value="buy"'));
    assert.ok(form.includes('name="account_type" id="udBuyOrderType"'));
    assert.ok(form.includes('name="fb_name" id="udBuyFbName"'));
    assert.ok(form.includes('name="game_id" value="1"'));
  });
  await okAsync('a reserve POST is accepted with those fields and the same price', async () => {
    const form = formSlice(page, 'reserveForm');
    const token = (form.match(/name="client_token" value="([^"]*)"/) || [])[1];
    assert.ok(token, 'client token');
    // Orders live in Mongo. This process has none, so capture the row the
    // route was about to save instead of writing one.
    const orders = require('../lib/orders');
    let captured = null;
    orders.createOrReuse = async (fields) => {
      captured = fields;
      return { order: { ref: 'ZTEST1', url_key: 'samplekey' }, reused: false };
    };
    const body = new URLSearchParams({ game_id: '1', account_type: 'nt', days: '30', fb_name: 'Zzyzx Tester', client_token: token }).toString();
    const res = await call('POST', '/order/reserve', { 'Content-Type': 'application/x-www-form-urlencoded' }, body);
    assert.strictEqual(res.status, 302, res.headers.location || '');
    assert.strictEqual(res.headers.location, '/order/ZTEST1?k=samplekey&msg=placed');
    assert.ok(captured, 'reserve route did not build an order');
    assert.strictEqual(captured.fb_name, 'Zzyzx Tester');
    assert.strictEqual(captured.account_type, 'nt');
    assert.strictEqual(captured.days, 30);
    assert.strictEqual(String(captured.game_id), '1');
    assert.strictEqual(captured.game_title, 'Zzyzx Horizon');
    assert.strictEqual(captured.amount_due, 899);
    assert.strictEqual(captured.deposit_due, 0);
    assert.strictEqual(captured.remaining_due, 0);
    assert.strictEqual(captured.is_reservation, true);
    assert.strictEqual(captured.is_buy, false);
  });

  console.log('\nrent page');
  await okAsync('a released game page still uses its own booking form', async () => {
    const rent = await get('/game/zzyzx-rental');
    assert.strictEqual(rent.status, 200);
    assert.ok(rent.body.includes('id="rentPanel"') && rent.body.includes('id="toggleRent"'));
    assert.ok(rent.body.includes('action="/order/create"') && rent.body.includes('id="gdOrderForm"'));
    assert.ok(rent.body.includes('data-film') && rent.body.includes('id="gpLightbox"'));
    assert.ok(!rent.body.includes('id="udRentPanel"') && !rent.body.includes('gp-upcoming'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
