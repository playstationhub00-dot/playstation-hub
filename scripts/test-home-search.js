// Run: node scripts/test-home-search.js
//
// Boots the real server against a throwaway DATA_DIR and a blank MONGODB_URI
// and checks the homepage: the search is the compact field at the top of the
// page (no Popular chips — the Top rented list does that job), loads its
// stylesheet and scripts, and /api/search-index carries the fields the search
// draws (slots, price). The drawing script's ids must exist in the partial.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4594;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-search-'));
const game = (id, title, renters, cover) => ({
  id, title, platform: 'PS5', renters, cover_image: cover, nt_price_7d: 100 + id, nt_price_30d: 300, tr_price_7d: 120, tr_price_30d: 350
});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  games: [
    game(1, 'Zzyzx One', 50, '/uploads/one.png'),
    game(2, 'Zzyzx Two', 40, '/uploads/two.png'),
    game(3, 'Zzyzx Three', 30, ''),
    game(4, 'Zzyzx Four', 20, '/uploads/four.png'),
    game(5, 'Zzyzx Five', 10, '/uploads/five.png'),
    game(6, 'Zzyzx Six', 5, '/uploads/six.png')
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: p, timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Safari' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
  });
}

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/browse'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\nGET /');
  const home = await get('/');

  await okAsync('the homepage renders the compact search at the top, beside the tagline', async () => {
    assert.strictEqual(home.status, 200);
    const strip = home.body.indexOf('id="homeSearch"');
    assert.ok(strip > home.body.indexOf('class="hm-head"') && strip < home.body.indexOf('aria-label="Quick picks"'), 'in the top block');
    assert.ok(home.body.includes('class="hs hs-compact" id="homeSearch"'));
    assert.ok(home.body.includes('<h2 class="hs-title hm-sr">What game are you looking for?</h2>'), 'heading kept for screen readers');
    assert.ok(home.body.includes('id="hsInput"') && home.body.includes('id="hsResults"') && home.body.includes('id="hsDim"'));
  });

  await okAsync('no Popular chips on the compact search', async () => {
    assert.ok(!home.body.includes('class="hs-chip"') && !home.body.includes('Popular right now'));
  });

  await okAsync('the stylesheet and both scripts are requested', async () => {
    assert.ok(/<link rel="stylesheet" href="\/css\/home-search\.css\?v=[^"]+">/.test(home.body));
    assert.ok(/<script src="\/js\/home-search-core\.js\?v=[^"]+"><\/script>/.test(home.body));
    assert.ok(/<script src="\/js\/home-search\.js\?v=[^"]+" defer><\/script>/.test(home.body));
    for (const f of ['/css/home-search.css', '/js/home-search-core.js', '/js/home-search.js']) assert.strictEqual((await get(f)).status, 200, f);
  });

  console.log('\nGET /api/search-index');
  await okAsync('entries carry slots and a from-price for the search to show', async () => {
    const index = JSON.parse((await get('/api/search-index')).body);
    const one = index.find(x => x.t === 'Zzyzx One');
    assert.ok(one, 'game is in the index');
    assert.strictEqual(one.y, 'now');
    assert.strictEqual(typeof one.s, 'number');
    assert.strictEqual(one.pr, 101);
    assert.strictEqual(one.u, '/game/zzyzx-one');
  });

  console.log('\nscript ids');
  await okAsync('every element id the drawing script reads exists in the partial', async () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'home-search.js'), 'utf8');
    for (const id of [...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1])) {
      assert.ok(home.body.includes('id="' + id + '"'), id + ' missing from the rendered page');
    }
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
