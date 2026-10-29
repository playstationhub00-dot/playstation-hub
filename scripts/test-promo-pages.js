// Run: node scripts/test-promo-pages.js
//
// Promo visibility on a throwaway server: the banner, /promos, the game
// badge, the checkout line, the FAQ entry, and the admin manager. With
// loyalty off and no live custom promo, none of those show. Expired and
// disabled promos never show. Temp DATA_DIR, no Mongo.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 47241;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-pages-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);

function manilaToday() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function addDays(ymd, n) {
  const parts = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const today = manilaToday();

function lineBlob(body) {
  const lines = JSON.parse(body).lines || [];
  return lines.map(line => (line && typeof line === 'object') ? (line.label + ' ' + line.text) : String(line)).join('\n');
}

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  games: [{
    id: 7, title: 'Elden Ring', platform: 'PS5', genre: 'Action',
    cover_image: '', non_trophy_slots: 2, trophy_slots: 1, renters: 0,
    created_at: '2020-01-01T00:00:00.000Z',
    nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799
  }],
  nextGameId: 8,
  site_settings: {
    title: 'PlayStation Hub',
    logo_path: '/logo.svg',
    favicon_path: '/favicon.svg',
    promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 },
    loyalty: {
      punch_enabled: true, punch_every: 5, reward_days: 7,
      rebook_enabled: true, rebook_amount: 50, rebook_within_days: 7,
      trophy_double: false
    }
  },
  customers: [{
    id: 1, customer_name: 'Ana Cruz', game_title: 'Elden Ring', account_type: 'nt',
    status: 'done', days: 7, price: 349, start_date: addDays(today, -40), end_date: addDays(today, -33),
    payments: [{ amount: 349, date: addDays(today, -40), kind: 'rental' }]
  }, {
    id: 2, customer_name: 'Ana Cruz', game_title: 'Elden Ring', account_type: 'nt',
    status: 'done', days: 7, price: 349, start_date: addDays(today, -20), end_date: addDays(today, -13),
    payments: [{ amount: 349, date: addDays(today, -20), kind: 'rental' }]
  }, {
    id: 3, customer_name: 'Ana Cruz', game_title: 'Elden Ring', account_type: 'nt',
    status: 'done', days: 7, price: 349, start_date: addDays(today, -10), end_date: addDays(today, -3),
    payments: [{ amount: 349, date: addDays(today, -10), kind: 'rental' }]
  }]
}));

process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';

function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {} }

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: 'localhost', port: PORT, path: p, method,
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers),
      timeout: 20000
    }, res => {
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
const form = o => new URLSearchParams(o).toString();
function cookieOf(res) {
  return (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
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
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up');

  const home = await call('GET', '/');
  const sid = cookieOf(home);
  assert.ok(sid.includes('ph_sid'), sid);

  await okAsync('the loyalty offers are the banner, the promos page, checkout, and the FAQ', async () => {
    assert.strictEqual(home.status, 200);
    assert.ok(home.body.includes('data-ann-bind="promo-banner"'));
    assert.ok(home.body.includes('Free 7-day rental'));
    const page = await call('GET', '/promos', { headers: { Cookie: sid } });
    assert.strictEqual(page.status, 200);
    assert.ok(page.body.includes('Every 5th paid rental'));
    assert.ok(page.body.includes('Paid rentals only'));
    const game = await call('GET', '/game/elden-ring', { headers: { Cookie: sid } });
    assert.strictEqual(game.status, 200, game.status + ' ' + game.body.slice(0, 180));
    assert.ok(game.body.includes('gd-promo-note'));
    assert.ok(game.body.includes('gd-promo-item'));
    assert.ok((game.body.match(/class="gd-promo-item"/g) || []).length >= 2);
    assert.ok(game.body.includes('Every 5th paid rental'));
    assert.ok(game.body.includes('Free rental'));
    assert.ok(game.body.includes('Rebook'));
    assert.ok(!game.body.includes('gc2-badge-promo'));
    assert.ok(!game.body.includes('usd-badge-promo'));
    const faq = await call('GET', '/faq');
    assert.ok(faq.body.includes('Are there any promos right now?'));
    assert.ok(faq.body.includes('href="/promos"'));
    const named = await call('GET', '/api/promo-line?name=' + encodeURIComponent('Ana Cruz') + '&game=7', { headers: { Cookie: sid } });
    const lines = lineBlob(named.body);
    assert.ok(lines.includes("You're 2 rentals away from a free 7-day rental"), lines);
    assert.ok(lines.includes('Free rental'));
    assert.ok(lines.includes('Rebook'));
    assert.ok(lines.includes('Rebook by '), lines);
    assert.ok(lines.includes('₱50 off'), lines);
  });

  await okAsync('a banner view and a promos page view show on the weekly report', async () => {
    const tracked = await call('POST', '/api/track/promo', {
      headers: { Cookie: sid, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'loyalty-punch' })
    });
    assert.strictEqual(tracked.status, 204);
    const login = await call('POST', '/admin/login', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ password: TEST_PASSWORD })
    });
    const adminCookie = cookieOf(login);
    const admin = await call('GET', '/admin?tab=loyalty', { headers: { Cookie: adminCookie } });
    assert.strictEqual(admin.status, 200);
    assert.ok(admin.body.includes('id="sec-promos"'));
    assert.ok(admin.body.includes('1 banner views'));
    assert.ok(admin.body.includes('1 promos page views'));
    assert.ok(admin.body.includes('Promos this week:'));
    return adminCookie;
  });

  const login = await call('POST', '/admin/login', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ password: TEST_PASSWORD })
  });
  const adminCookie = cookieOf(login);
  const auth = extra => Object.assign({ Cookie: adminCookie }, extra || {});

  await okAsync('turning loyalty off hides every loyalty promo', async () => {
    const saved = await call('POST', '/admin/loyalty/settings', {
      headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form({
        return_tab: 'loyalty', punch_every: '5', reward_days: '7',
        rebook_amount: '50', rebook_within_days: '7'
      })
    });
    assert.ok(saved.headers.location.includes('loyalty_saved'));
    const quiet = await call('GET', '/');
    assert.ok(!quiet.body.includes('data-ann-bind="promo-banner"'), 'offers banner still present');
    assert.ok(!quiet.body.includes('Free 7-day rental'));
    assert.ok(!quiet.body.includes('href="/promos"'));
    const faq = await call('GET', '/faq');
    assert.ok(!faq.body.includes('Are there any promos right now?'));
    const game = await call('GET', '/game/elden-ring');
    assert.ok(!game.body.includes('gd-promo-note'));
    assert.ok(!game.body.includes('usd-badge-promo'));
    const page = await call('GET', '/promos');
    assert.ok(page.body.includes('no promos running right now'));
  });

  await okAsync('a live linked promo shows, and expired or disabled ones do not', async () => {
    const expired = await call('POST', '/admin/promos/save', {
      headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form({
        title: 'Ghost sale', text: 'This ended.', terms: 'Expired terms.',
        starts_on: addDays(today, -10), ends_on: addDays(today, -1), enabled: 'on'
      })
    });
    assert.ok(expired.headers.location.includes('offers_saved'));
    const disabled = await call('POST', '/admin/promos/save', {
      headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form({ title: 'Secret off', text: 'Disabled offer.', terms: 'Off terms.' })
    });
    assert.ok(disabled.headers.location.includes('offers_saved'));
    const live = await call('POST', '/admin/promos/save', {
      headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form({
        title: 'Elden week', text: '₱50 off Elden Ring this week.',
        terms: 'One rental per customer.', badge: 'Promo', featured: 'on', enabled: 'on',
        game_id: '7', starts_on: today, ends_on: addDays(today, 7)
      })
    });
    assert.ok(live.headers.location.includes('offers_saved'));

    const site = await call('GET', '/', { headers: { Cookie: sid } });
    assert.ok(site.body.includes('data-ann-bind="promo-banner"'));
    assert.ok(site.body.includes('Elden week'));
    assert.ok(!site.body.includes('Ghost sale'));
    assert.ok(!site.body.includes('Secret off'));
    assert.ok(!site.body.includes('Expired terms'));
    const page = await call('GET', '/promos');
    assert.ok(page.body.includes('One rental per customer'));
    assert.ok(page.body.includes('Elden Ring'));
    assert.ok(!page.body.includes('Ghost sale'));
    assert.ok(!page.body.includes('Secret off'));
    const game = await call('GET', '/game/elden-ring');
    assert.ok(game.body.includes('usd-badge-promo'));
    assert.ok(game.body.includes('>Promo<'));
    assert.ok(game.body.includes('₱50 off Elden Ring this week.'));
    assert.ok(!game.body.includes('Ghost sale'));
    const browse = await call('GET', '/browse');
    assert.ok(browse.body.includes('gc2-badge-promo'));
    assert.ok(browse.body.includes('>Promo<'));
    const faq = await call('GET', '/faq');
    assert.ok(faq.body.includes('Are there any promos right now?'));

    const named = await call('GET', '/api/promo-line?name=' + encodeURIComponent('Ana Cruz') + '&game=7');
    assert.strictEqual(named.status, 200);
    const lines = lineBlob(named.body);
    assert.ok(lines.includes('₱50 off Elden Ring'), lines);
    assert.ok(!lines.includes('away from a free'), lines);
  });

  await okAsync('loyalty stays hidden while its toggles are off, even if the customer is known', async () => {
    const named = await call('GET', '/api/promo-line?name=' + encodeURIComponent('Ana Cruz') + '&game=8');
    const lines = lineBlob(named.body);
    assert.ok(!lines.includes('away from a free'));
    assert.ok(!lines.includes('Elden week'));
  });

  await okAsync('switching the custom promo off removes it everywhere', async () => {
    const admin = await call('GET', '/admin?tab=loyalty', { headers: auth() });
    assert.ok(admin.body.includes('name="title"'));
    assert.ok(admin.body.includes('value="Elden week"'));
    const at = admin.body.indexOf('value="Elden week"');
    const ids = [...admin.body.slice(0, at).matchAll(/name="id" value="(p\d+)"/g)];
    const id = ids.length ? ids[ids.length - 1][1] : '';
    assert.strictEqual(id, 'p3');
    const off = await call('POST', '/admin/promos/save', {
      headers: auth({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form({
        id, title: 'Elden week', text: '₱50 off Elden Ring this week.',
        terms: 'One rental per customer.', game_id: '7'
      })
    });
    assert.ok(off.headers.location.includes('offers_saved'));
    const site = await call('GET', '/');
    assert.ok(!site.body.includes('id="promoBanner"'));
    assert.ok(!site.body.includes('Elden week'));
    assert.ok(!site.body.includes('Ghost sale'));
    const game = await call('GET', '/game/elden-ring');
    assert.ok(!game.body.includes('usd-badge-promo'));
    assert.ok(!game.body.includes('gd-promo-note'));
    const faq = await call('GET', '/faq');
    assert.ok(!faq.body.includes('Are there any promos right now?'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  cleanup();
  process.exit(1);
});
