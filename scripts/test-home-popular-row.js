// Run: node scripts/test-home-popular-row.js
//
// Popular games sits between New releases and Coming soon, in the same order
// as Browse → Most popular. Temp catalogue only.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4688;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-popular-'));
const daysAgo = n => {
  const t = new Date(Date.now() - n * 86400000);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
};
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '',
  non_trophy_slots: 2, trophy_slots: 1, ps4_primary_slots: 0,
  nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799,
  release_date: '2024-01-01', renters: 0, created_at: '2024-01-01T00:00:00.000Z'
}, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-popular',
  games: [
    game(1, 'Zzyzx New One', { release_date: daysAgo(2), renters: 1 }),
    game(2, 'Zzyzx Recent', { release_date: '', renters: 1, non_trophy_slots: 2, trophy_slots: 1 }),
    game(3, 'Zzyzx All Time', { release_date: '', renters: 40, non_trophy_slots: 0, trophy_slots: 0 }),
    game(5, 'Zzyzx Backfill', { release_date: '', renters: 2 }),
    game(4, 'Zzyzx Never', { release_date: '', renters: 0 })
  ],
  upcoming: [{
    id: 9, title: 'Zzyzx Soon', platform: 'PS5', release_date: '2027-06-01',
    cover_image: '', non_trophy_slots: 1, trophy_slots: 1
  }],
  customers: [
    { id: 1, customer_name: 'A', game_id: 1, game_title: 'Zzyzx New One', status: 'renting', start_date: daysAgo(1) },
    { id: 2, customer_name: 'B', game_id: 1, game_title: 'Zzyzx New One', status: 'done', start_date: daysAgo(2) },
    { id: 3, customer_name: 'C', game_id: 1, game_title: 'Zzyzx New One', status: 'done', start_date: daysAgo(2) },
    { id: 4, customer_name: 'D', game_id: 2, game_title: 'Zzyzx Recent', status: 'renting', start_date: daysAgo(3) },
    { id: 5, customer_name: 'E', game_id: 2, game_title: 'Zzyzx Recent', status: 'done', start_date: daysAgo(4) }
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.ORDERS_MEMORY = '1';
process.env.SESSION_SECRET = 'popular-test';

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: PORT, path: p, headers: { 'User-Agent': 'Mozilla/5.0 test' } }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    }).on('error', reject);
  });
}
function slice(html, from, to) {
  const i = html.indexOf(from);
  assert.ok(i >= 0, from);
  const j = to ? html.indexOf(to, i + from.length) : html.length;
  return html.slice(i, j < 0 ? html.length : j);
}

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  for (let i = 0; i < 40; i++) {
    try { if ((await get('/admin/login')).status === 200) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  const home = (await get('/')).body;
  const newAt = home.indexOf('id="newReleasesSection"');
  const popAt = home.indexOf('id="popularGamesSection"');
  const soonAt = home.indexOf('id="comingSoon"');
  ok('Popular games sits under New releases and above Coming soon', () => {
    assert.ok(newAt > 0 && popAt > newAt && soonAt > popAt);
  });
  const popular = slice(home, 'id="popularGamesSection"', 'id="comingSoon"');
  ok('the heading, subtitle, and Most popular link are the browse lane', () => {
    assert.ok(popular.includes('>Popular games</h2>'));
    assert.ok(popular.includes('Most rented by players'));
    assert.ok(popular.includes('href="/browse?tab=most-rented"'));
  });
  ok('a new release that is also heavily rented stays in New releases and Popular backfills', () => {
    const fresh = slice(home, 'id="newReleasesSection"', 'id="popularGamesSection"');
    const titles = [...popular.matchAll(/class="gc-title-text">([^<]+)</g)].map(m => m[1]);
    assert.ok(fresh.includes('Zzyzx New One'));
    assert.ok(!popular.includes('Zzyzx New One'));
    assert.strictEqual(titles[0], 'PS Plus Deluxe');
    assert.strictEqual(titles.filter(t => t === 'PS Plus Deluxe').length, 1);
    assert.deepStrictEqual(titles.slice(1), ['Zzyzx Recent', 'Zzyzx All Time', 'Zzyzx Backfill']);
    assert.ok(popular.includes('href="/ps-plus/rent"'));
    assert.ok(popular.includes('Rent now') || popular.includes('Join the line'));
    assert.ok(!popular.includes('Zzyzx Never'));
  });
  const browse = await get('/browse?tab=most-rented');
  ok('Browse most rented still lists the new release', () => {
    assert.strictEqual(browse.status, 200);
    assert.ok(browse.body.includes('Zzyzx New One'));
  });
  console.log('\n' + passed + ' assertions passed\n');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
