// Run: node scripts/test-psplus-routes.js
//
// Boots the real server in-process (the pattern of
// scripts/test-order-routes-error-handling.js), puts a few games in the PS
// Plus catalog store's in-memory copy, and checks the two public routes that
// read it: GET /ps-plus opens the right tab and lists the games, and GET
// /api/search-index offers them as "Included in PS Plus Deluxe". Both are
// public GETs — no admin login. Also checks the nav links PS Plus in both
// menus.
//
// The server runs against a throwaway DATA_DIR (a fresh games.json it creates
// itself, deleted afterwards) and with MONGODB_URI blanked, so neither the
// project's games.json nor any database is ever touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4591;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'psplus-routes-'));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: p, timeout: 8000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
  });
}

async function main() {
  require('../server.js');
  const store = require('../lib/psplus-catalog-store');
  const { OWNER_DEFAULTS } = require('../lib/psplus-catalog');
  const game = (id, name, extra) => Object.assign({}, OWNER_DEFAULTS, {
    key: 'c:' + id, source: 'feed', concept_id: String(id), name, name_raw: name, lists: ['catalog'],
    image_url: 'https://image.api.playstation.com/' + id + '.png', platforms: ['PS5'], genres: ['ACTION'],
    release_date: '2020-01-01', store_url: 'https://store.playstation.com/en-id/concept/' + id, first_seen_at: '2026-09-27T00:00:00.000Z'
  }, extra || {});

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/ps-plus'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');
  store._reset([
    game(900001, 'Zzyzx Test Quest'),
    game(900002, 'Zzyzx Hidden Game', { hidden: true })
  ]);

  console.log('\nGET /ps-plus');

  await okAsync('opens on All Games, with the games in its list', async () => {
    const r = await get('/ps-plus');
    assert.strictEqual(r.status, 200);
    assert.ok(/data-panel="games" id="ppc-panel-games" role="tabpanel">/.test(r.body), 'All Games open');
    assert.ok(r.body.includes('"n":"Zzyzx Test Quest"'));
    assert.ok(!r.body.includes('Zzyzx Hidden Game'), 'a hidden game is not on the page');
    assert.ok(r.body.includes('/css/psplus-catalog.css'));
  });

  await okAsync('?tab=pricing and a ?month= deep link open their tabs', async () => {
    assert.ok(/data-panel="pricing" id="ppc-panel-pricing" role="tabpanel">/.test((await get('/ps-plus?tab=pricing')).body));
    assert.ok(/data-panel="monthly" id="ppc-panel-monthly" role="tabpanel">/.test((await get('/ps-plus?month=1')).body));
    assert.ok(/data-panel="games" id="ppc-panel-games" role="tabpanel">/.test((await get('/ps-plus?tab=nonsense')).body));
  });

  await okAsync('the nav shows PS Plus, marked as the current page', async () => {
    const r = await get('/ps-plus');
    assert.strictEqual((r.body.match(/<a href="\/ps-plus" class="active">PS Plus<\/a>/g) || []).length, 2, 'desktop menu and phone drawer');
  });

  console.log('\nGET /api/search-index');

  await okAsync('offers visible catalog games as included in PS Plus Deluxe', async () => {
    const r = await get('/api/search-index');
    assert.strictEqual(r.status, 200);
    const index = JSON.parse(r.body);
    const hit = index.find(x => x.t === 'Zzyzx Test Quest');
    assert.deepStrictEqual(hit, {
      t: 'Zzyzx Test Quest', p: 'Included in PS Plus Deluxe', u: '/ps-plus?game=c%3A900001',
      y: 'psplus', img: 'https://image.api.playstation.com/900001.png?w=120'
    });
    assert.ok(!index.some(x => x.t === 'Zzyzx Hidden Game'));
  });

  console.log('\nnav source');

  await okAsync('both menus link PS Plus between Buy and Requests', async () => {
    const nav = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'nav.ejs'), 'utf8');
    assert.strictEqual((nav.match(/>Buy<\/a>\r?\n\s*<a href="\/ps-plus" class="<%= navActive === 'psplus' \? 'active' : '' %>">PS Plus<\/a>\r?\n\s*<a href="\/requests"/g) || []).length, 2);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
