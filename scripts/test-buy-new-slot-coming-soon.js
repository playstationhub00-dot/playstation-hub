// Run: node scripts/test-buy-new-slot-coming-soon.js
//
// A Coming Soon game whose type is full: the Rent tab carries the gold "Own it
// instead" strip (filled and shown by public/js/upcoming-detail.js for a full
// type with a permanent price), the Buy Permanent tab tags that type as a new
// slot with its pre-order note, and a game with no permanent price gets
// neither. Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI,
// in-memory sessions); the project's games.json and the database are never
// touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4638;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buy-new-slot-cs-'));
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
const up = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', release_date: '2099-01-01', non_trophy_slots: 2, trophy_slots: 1 }, price, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  site_settings: { promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 } },
  games: [],
  upcoming: [
    up(1, 'Zzyzx Soon', { buy_nt_price: 1299, buy_tr_price: 1999 }),
    up(2, 'Zzyzx Rent Only')
  ],
  // One Trophy reservation each: Trophy is full on both.
  customers: [
    { id: 1, customer_name: 'Zzyzx Early', game_id: 'upcoming_1', game_title: 'Zzyzx Soon', account_type: 'tr', status: 'reservation', price: 899, payments: [] },
    { id: 2, customer_name: 'Zzyzx Early', game_id: 'upcoming_2', game_title: 'Zzyzx Rent Only', account_type: 'tr', status: 'reservation', price: 899, payments: [] }
  ]
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
const slice = (html, from, to) => {
  const i = html.indexOf(from);
  assert.ok(i >= 0, from + ' found');
  return html.slice(i, html.indexOf(to, i));
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
  let ok = false;
  while (Date.now() < deadline) {
    try { await get('/admin/login'); ok = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(ok, 'server did not come up within 15s');

  const soon = await get('/upcoming/zzyzx-soon-1');
  assert.strictEqual(soon.status, 200);
  const page = soon.body;

  await okAsync('the Rent tab carries the "Own it instead" strip, filled in by the page script', async () => {
    const rent = slice(page, 'id="udRentPanel"', '<!-- /udRentPanel -->');
    assert.ok(rent.includes('<div class="ud-own-strip" id="udOwnStrip" hidden>'));
    assert.ok(rent.includes('<b><span class="ud-own-type"></span> is full?</b> Own it instead — we\'ll add a new <span class="ud-own-type"></span> slot for you.'));
    assert.ok(rent.includes('<button type="button" class="ud-own-go" id="udOwnGo" onclick="ownInstead()"></button>'));
    assert.ok(rent.indexOf('id="udOwnStrip"') < rent.indexOf('id="durGrid"'), 'above the durations');
    assert.ok(page.includes('const BUY_FINAL = { nt: 1299, tr: 1999 };'), 'the permanent prices it quotes');
  });
  await okAsync('the page script shows it for a full type with a permanent price and opens Buy Permanent on that type', async () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'upcoming-detail.js'), 'utf8');
    assert.ok(/function updateOwnStrip\(\)[\s\S]*getSlots\(\) === 0 && price > 0/.test(js));
    assert.ok(/'Buy ₱' \+ price \+ ' →'/.test(js));
    assert.ok(/function ownInstead\(\)[\s\S]*setUpcomingMode\('buy'\);[\s\S]*selectUdBuyType\(selectedType\);/.test(js));
    assert.ok(/function onTypeChange\(\)[\s\S]*?updateOwnStrip\(\);[\s\S]*?\n\}/.test(js), 'follows the selected type');
    assert.ok(/\nupdateOwnStrip\(\);\n/.test(js.replace(/\r\n/g, '\n')), 'set on load');
  });
  await okAsync('Buy Permanent tags the full type as a new slot, with its pre-order note', async () => {
    const buy = slice(page, 'id="udBuyPanel"', '<!-- /udBuyPanel -->');
    const tr = slice(buy, 'id="udBuyTrCard"', 'ONE-TIME');
    assert.ok(tr.includes('<span class="gd-type-status gd-status-newslot">🆕 New slot · set up on order</span>'));
    assert.ok(!slice(buy, 'id="udBuyNtCard"', 'ONE-TIME').includes('gd-status-newslot'), 'Non-Trophy still has slots');
    assert.ok(buy.includes('<div class="gd-newslot-note" id="udBuyNewSlotNote-tr" hidden>🆕 Pre-order now. On release day we set up a fresh Trophy slot for you and message you.</div>'));
    assert.ok(!buy.includes('udBuyNewSlotNote-nt'));
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'upcoming-detail.js'), 'utf8');
    assert.ok(js.includes("document.getElementById('udBuyNewSlotNote-' + t)"), 'selectUdBuyType shows the picked type\'s note');
  });
  await okAsync('no permanent price: no strip', async () => {
    const r = await get('/upcoming/zzyzx-rent-only-2');
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body.includes('id="udOwnStrip"'));
  });
  await okAsync('the strip styles', async () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.ok(/\.ud-own-strip \{/.test(css) && /\.ud-own-strip\[hidden\] \{ display: none; \}/.test(css) && /\.ud-own-go \{/.test(css));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
