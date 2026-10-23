// Run: node scripts/test-buy-new-slot-game-page.js
//
// A released game's Buy Permanent tab when a type is full: the card stays
// selectable with "🆕 New slot · set up on order" and its own line instead of
// greying out, a type whose linked account was sold now shows the same way,
// the set-up-on-order note appears for the selected new-slot type, and "Nothing
// to buy right now" no longer shows while a permanent price is set. Boots a
// throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory sessions); the
// project's games.json and the database are never touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4637;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buy-new-slot-page-'));
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const game = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', genre: 'Action', cover_image: '', non_trophy_slots: 1, trophy_slots: 1, renters: 1 }, price, extra || {});
const slots = (nt, tr) => ({ non_trophy: { enabled: true, status: nt }, trophy: { enabled: true, status: tr }, ps4_primary: { enabled: false, status: 'open' } });
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [
    game(1, 'Zzyzx Rented', { renters: 3, non_trophy_slots: 0, trophy_slots: 0, buy_nt_price: 999, buy_tr_price: 1499 }),
    game(2, 'Zzyzx Free', { renters: 2, buy_nt_price: 799, buy_tr_price: 1299 }),
    game(3, 'Zzyzx Sold', { renters: 2, buy_nt_price: 899 }),
    game(4, 'Zzyzx NoBuy', { renters: 2 })
  ],
  // Game 3's only Non-Trophy slot was sold permanently.
  accounts: [{ id: 1, label: 'Zzyzx Acc', public_name: 'Zzyzx Acc', for_sale: false, game_ids: [3], slots: slots('buyed', 'open') }]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.end();
  });
}
const buyPanel = html => {
  const i = html.indexOf('id="buyPanel"');
  assert.ok(i >= 0, 'buy panel');
  return html.slice(i, html.indexOf('<!-- /buyPanel -->', i));
};
const cardOf = (panel, id) => {
  const m = new RegExp('<div class="gd-type-card[^"]*" id="' + id + '"[\\s\\S]*?ONE-TIME</span>').exec(panel);
  assert.ok(m, id);
  return m[0];
};

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
    try { await get('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  await okAsync('every slot rented out: both cards stay buyable, tagged as a new slot', async () => {
    const panel = buyPanel((await get('/game/zzyzx-rented')).body);
    const nt = cardOf(panel, 'buyNtCard');
    assert.ok(nt.includes('onclick="selectBuyType(\'nt\')"') && !nt.includes('gd-type-disabled'));
    assert.ok(!nt.includes('gd-status-newslot'), 'the new-slot wording lives in What You Get, not on the card');
    assert.ok(nt.includes('Our Non-Trophy slots are all taken — we\'ll add a brand-new one just for you.'));
    const tr = cardOf(panel, 'buyTrCard');
    assert.ok(tr.includes('onclick="selectBuyType(\'tr\')"') && tr.includes('Our Trophy slots are all taken — we\'ll add a brand-new one just for you.'));
    assert.ok(!panel.includes('Full Slot') && !panel.includes('Nothing to buy right now'));
    assert.ok(panel.includes('<form method="POST" action="/order/buy"'));
  });
  await okAsync('the set-up-on-order note, one per new-slot type, hidden until that type is picked', async () => {
    const panel = buyPanel((await get('/game/zzyzx-rented')).body);
    assert.ok(panel.includes('<div class="gd-newslot-note" style="margin:0;" id="buyNewSlotNote-tr" hidden>🆕 <strong>Set up on order:</strong> we buy a fresh Trophy slot for this game after you pay, then message you on Facebook when it\'s ready. Same price, yours forever.</div>'));
    assert.ok(panel.includes('id="buyNewSlotNote-nt" hidden'));
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game-detail.js'), 'utf8');
    assert.ok(js.includes("document.getElementById('buyNewSlotNote-' + t)"), 'selectBuyType shows the picked type\'s note');
  });
  await okAsync('a slot to hand over: no tag, no note', async () => {
    const panel = buyPanel((await get('/game/zzyzx-free')).body);
    assert.ok(!panel.includes('gd-status-newslot') && !panel.includes('gd-newslot-note'));
    assert.ok(cardOf(panel, 'buyNtCard').includes('Played on our account. No trophy tracking. One-time payment, lifetime access.'));
  });
  await okAsync('a sold linked account no longer hides the type: it is a new slot', async () => {
    const panel = buyPanel((await get('/game/zzyzx-sold')).body);
    assert.ok(cardOf(panel, 'buyNtCard').includes('Our Non-Trophy slots are all taken') && panel.includes('id="buyNewSlotNote-nt"'));
  });
  await okAsync('no permanent price: no Buy Permanent tab, as before', async () => {
    assert.ok(!(await get('/game/zzyzx-nobuy')).body.includes('id="buyPanel"'));
  });
  await okAsync('the new-slot styles', async () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(/\.gd-status-newslot \{[^}]*color: #fbbf24/.test(css) && /\.gd-newslot-note \{/.test(css));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
