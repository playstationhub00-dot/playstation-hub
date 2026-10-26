// Run: node scripts/test-psplus-rent-links.js
//
// PS Plus Deluxe tiles a customer clicks to rent it — the Rent tab's game card
// and its PS Plus "Rent" lead, the home page's slides and top-rented board, the
// home search chips — open the rent page (/ps-plus/rent), not /ps-plus, which
// opens on the games list. Search-engine surfaces (the 301 from the old game
// URL, the search index, the product feed) keep /ps-plus. The rent page's
// rental-type cards are the game page's pills, with hidden radios. Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI).
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4647;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'psplus-rent-links-'));
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  games: [
    Object.assign({ id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5', genre: '', cover_image: '', renters: 9, non_trophy_slots: 1, trophy_slots: 1 }, price),
    Object.assign({ id: 5, title: 'Zzyzx Racer', platform: 'PS5', genre: 'Racing', cover_image: '', renters: 2, non_trophy_slots: 1, trophy_slots: 1 }, price)
  ],
  psplus_prices: { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 }
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: p, timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 test' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
  });
}

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function main() {
  const seo = require('../lib/seo');

  await okAsync('rentPath: PS Plus Deluxe opens its rent page; any other game its own page', async () => {
    assert.strictEqual(seo.rentPath('PS Plus Deluxe'), '/ps-plus/rent');
    assert.strictEqual(seo.rentPath('PlayStation Plus Deluxe'), '/ps-plus/rent');
    assert.strictEqual(seo.rentPath('Elden Ring'), seo.gamePath('Elden Ring'));
    assert.strictEqual(seo.gamePath('PS Plus Deluxe'), '/ps-plus', 'search-engine links unchanged');
  });

  await okAsync('the tiles customers click use rentPath', async () => {
    assert.ok(read('views/partials/game-card.ejs').includes('<a href="<%= seo.rentPath(game.title) %>"'));
    const top = read('views/partials/home/top.ejs');
    assert.ok(top.includes('<a class="hm-slide" href="<%= seo.rentPath(g.title) %>">'));
    assert.ok(top.includes('<li><a href="<%= seo.rentPath(t.game.title) %>">'));
    assert.ok(read('views/partials/home-search.ejs').includes('<a class="hs-chip" href="<%= seo.rentPath(g.title) %>">'));
  });

  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/ps-plus/rent'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  await okAsync('the Rent tab: the PS Plus Deluxe card and the PS Plus "Rent" lead open the rent page', async () => {
    const all = (await get('/browse')).body;
    assert.ok(/<a href="\/ps-plus\/rent" class="game-card[^"]*"/.test(all), 'game card');
    const ps = (await get('/browse?tab=psplus')).body;
    assert.ok(ps.includes('<a class="bf-ps-lead" href="/ps-plus/rent">'), 'lead tile');
  });

  await okAsync('the rent page: the game page type pills with hidden radios; the old stacked-card styles are gone', async () => {
    const r = await get('/ps-plus/rent');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('<div class="gd-type-options" id="typeOptions">'));
    assert.strictEqual((r.body.match(/<input type="radio" name="rentalType" value="(tr|nt)" class="gd-type-radio" onchange="onTypeChange\(this\)">/g) || []).length, 2);
    assert.ok(!read('public/css/style.css').includes('psr-types'));
  });

  await okAsync('search engines still go to /ps-plus', async () => {
    const old = await get('/game/ps-plus-deluxe');
    assert.strictEqual(old.status, 301);
    assert.strictEqual(old.headers.location, '/ps-plus');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
