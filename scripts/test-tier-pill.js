// Run: node scripts/test-tier-pill.js
//
// Tier pills: the colour and description the owner sets on a price category,
// the pill on game cards (Browse, homepage) and the game page, none for games
// without a category or for bundles, and the "Just added" corner badge. Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a
// made-up admin password); the project's games.json, the database and the real
// admin are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4614;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-pill-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const prices = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '/uploads/' + id + '.png',
  non_trophy_slots: 2, trophy_slots: 2, renters: 20 - id, created_at: '2020-01-01T00:00:00.000Z'
}, prices, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  price_categories: [
    Object.assign({ id: 1, name: 'New Games' }, prices),
    Object.assign({ id: 2, name: 'Deluxe', description: 'Big recent AAA games' }, prices),
    Object.assign({ id: 3, name: 'Special', pill_color: 'pink' }, prices)
  ],
  nextPriceCategoryId: 4,
  games: [
    game(1, 'Zzyzx Deluxe', { price_category_id: 2, created_at: new Date().toISOString() }),
    game(2, 'Zzyzx Special', { price_category_id: 3 }),
    game(3, 'Zzyzx Plain'),
    game(4, 'Zzyzx Bundle', { price_category_id: 2, is_bundle: true })
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const readDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const catById = id => readDb().price_categories.find(c => c.id === id);

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
// The category forms upload a picture, so they post multipart.
function multipart(fields) {
  const b = '----tierpill' + Math.random().toString(16).slice(2);
  const body = Object.keys(fields).map(k => '--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + fields[k] + '\r\n').join('') + '--' + b + '--\r\n';
  return { body, type: 'multipart/form-data; boundary=' + b };
}
// The HTML of the game card (views/partials/game-card.ejs) that links to a
// game, within `html` — not the search shortcut chips that link there too.
function cardFor(html, slug) {
  const i = html.indexOf('href="/game/' + slug + '" class="game-card');
  assert.ok(i >= 0, 'card for ' + slug + ' found');
  return html.slice(i, html.indexOf('</a>', i));
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
  assert.ok(up, 'server did not come up within 15s');

  console.log('\ncards and game page');
  const browse = (await call('GET', '/browse')).body;
  await okAsync('a card carries its tier pill, coloured by name unless the owner picked one', async () => {
    assert.ok(cardFor(browse, 'zzyzx-deluxe').includes('<span class="tier-pill tier-purple">Deluxe</span>'));
    assert.ok(cardFor(browse, 'zzyzx-special').includes('<span class="tier-pill tier-pink">Special</span>'));
  });
  await okAsync('no pill without a category, and none on bundles', async () => {
    assert.ok(!cardFor(browse, 'zzyzx-plain').includes('tier-pill'));
    assert.ok(!cardFor(browse, 'zzyzx-bundle').includes('tier-pill'));
  });
  await okAsync('homepage cards carry the pill too', async () => {
    const home = (await call('GET', '/')).body;
    assert.ok(cardFor(home, 'zzyzx-special').includes('<span class="tier-pill tier-pink">Special</span>'));
  });
  await okAsync('the game page shows the pill above the title', async () => {
    const r = await call('GET', '/game/zzyzx-deluxe');
    assert.strictEqual(r.status, 200);
    const i = r.body.indexOf('<span class="tier-pill tier-purple usd-tier-pill">Deluxe</span>');
    assert.ok(i > 0 && i < r.body.indexOf('<h1 class="usd-title">'));
    assert.ok(!(await call('GET', '/game/zzyzx-plain')).body.includes('usd-tier-pill'));
  });
  await okAsync('the 11-day corner badge reads "Just added"', async () => {
    assert.ok(cardFor(browse, 'zzyzx-deluxe').includes('<div class="gc2-badge gc2-badge-new">Just added</div>'));
    assert.ok(!cardFor(browse, 'zzyzx-special').includes('gc2-badge-new'));
  });

  console.log('\nadmin');
  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(TEST_PASSWORD) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const post = (p, fields, extra) => { const m = multipart(fields); return call('POST', p, { headers: Object.assign({ 'Content-Type': m.type, Cookie: cookie }, extra || {}), body: m.body }); };
  const catFields = o => Object.assign({ name: 'Deluxe', nt_price_7d: '349', nt_price_30d: '799', tr_price_7d: '399', tr_price_30d: '899' }, o);
  await okAsync('the category form offers the colours and the description', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('<option value="teal">Teal</option>'));
    assert.ok(r.body.includes('name="description" value="Big recent AAA games" maxlength="120"'));
    assert.ok(r.body.includes('<option value="pink" selected>Pink</option>'), 'Special shows its picked colour');
  });
  await okAsync('saving sets the colour and a one-line description', async () => {
    const r = await post('/admin/price-categories/edit/2', catFields({ pill_color: 'teal', description: '  Big   AAA\ngames ' }));
    assert.strictEqual(r.status, 302);
    assert.deepStrictEqual([catById(2).pill_color, catById(2).description], ['teal', 'Big AAA games']);
  });
  await okAsync('a colour that is not one of the six keeps the old one; "Automatic" clears it', async () => {
    await post('/admin/price-categories/edit/2', catFields({ pill_color: '#ff0000', description: 'Big AAA games' }));
    assert.strictEqual(catById(2).pill_color, 'teal');
    await post('/admin/price-categories/edit/2', catFields({ pill_color: '', description: 'Big AAA games' }));
    assert.strictEqual(catById(2).pill_color, null);
    assert.ok(cardFor((await call('GET', '/browse')).body, 'zzyzx-deluxe').includes('tier-purple'), 'back to the colour from the name');
  });
  await okAsync('a new category stores its colour and description', async () => {
    await post('/admin/price-categories/add', catFields({ name: 'Classics', pill_color: 'coral', description: 'Older hits' }));
    const added = readDb().price_categories.find(c => c.name === 'Classics');
    assert.deepStrictEqual([added.pill_color, added.description], ['coral', 'Older hits']);
  });
  await okAsync('saving needs the admin login', async () => {
    const m = multipart(catFields({ pill_color: 'pink' }));
    const r = await call('POST', '/admin/price-categories/edit/1', { headers: { 'Content-Type': m.type, Accept: 'text/html' }, body: m.body });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/admin/login');
    assert.strictEqual(catById(1).pill_color, undefined);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
