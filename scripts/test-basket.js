// Run: node scripts/test-basket.js
//
// Basket totals are recomputed on the server. MONTHLY10 is the existing code:
// 10% off monthly lines only, deposit not discounted. Temp catalogue only.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const basket = require('../lib/basket');
const vouchers = require('../lib/vouchers');

const NOW = new Date('2026-11-26T04:00:00Z');
const games = [
  { id: 1, title: 'PS Plus Deluxe', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 },
  { id: 2, title: 'Silent Hill f', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 },
  { id: 3, title: 'Phantom Blade Zero', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 }
];
const picks = [
  { game_id: 1, account_type: 'nt', days: 30, price: 1 },
  { game_id: 2, account_type: 'tr', days: 7, price: 5 },
  { game_id: 3, account_type: 'nt', days: 7, price: 9 }
];

let passed = 0;
function ok(desc, fn) {
  fn();
  passed++;
  console.log('  ok - ' + desc);
}

ok('MONTHLY10 on a mixed basket matches the owner example', () => {
  const priced = basket.priceLines(games, picks, 100);
  const quoted = basket.applyCode(priced, {
    code: 'monthly10',
    offers: [vouchers.monthly10Offer()],
    now: NOW
  });
  assert.strictEqual(quoted.ok, true);
  assert.strictEqual(quoted.subtotal, 1447);
  assert.strictEqual(quoted.discount, 69.9);
  assert.strictEqual(quoted.deposit, 100);
  assert.strictEqual(quoted.amount_due, 1377.1);
  assert.strictEqual(quoted.total, 1477.1);
  assert.strictEqual(quoted.labels.total, '1,477.10');
  assert.strictEqual(quoted.labels.subtotal, '1,447');
  assert.strictEqual(basket.formatPeso(1547), '1,547');
  assert.strictEqual(basket.formatPeso(69.9), '69.90');
  assert.strictEqual(quoted.lines[1].price, 399);
  assert.ok(quoted.note.includes('₱69.90 from PS Plus Deluxe (₱699)'));
  assert.ok(quoted.note.includes('Weekly lines are unchanged'));
});

ok('a bad code is rejected and a second code cannot replace the maths by itself', () => {
  const priced = basket.priceLines(games, picks, 100);
  const bad = basket.applyCode(priced, { code: 'NOPE', offers: [vouchers.monthly10Offer()], now: NOW });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.message, 'Code not valid');
  assert.strictEqual(bad.discount, 0);
  const weeklyOnly = basket.priceLines(games, [
    { game_id: 2, account_type: 'tr', days: 7 },
    { game_id: 3, account_type: 'nt', days: 7 }
  ], 100);
  const monthly = basket.applyCode(weeklyOnly, { code: 'MONTHLY10', offers: [vouchers.monthly10Offer()], now: NOW });
  assert.strictEqual(monthly.ok, false);
  assert.strictEqual(monthly.error, 'monthly_only');
});

ok('the same game is priced once, and a non-trophy line has no deposit', () => {
  const priced = basket.priceLines(games, picks.concat([{ game_id: 1, account_type: 'tr', days: 7 }]), 100);
  assert.strictEqual(priced.lines.length, 3);
  assert.strictEqual(priced.lines[0].deposit, 0);
  assert.strictEqual(priced.lines[1].deposit, 100);
  assert.strictEqual(priced.lines[2].deposit, 0);
});

const PORT = 4719;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-basket-'));
const offer = Object.assign({}, vouchers.monthly10Offer(), { ends_on: '2099-12-31' });
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-basket',
  games: games.map(g => Object.assign({
    platform: 'PS4/PS5', genre: 'Action', cover_image: '',
    non_trophy_slots: 2, trophy_slots: g.id === 2 ? 1 : 2, ps4_primary_slots: 1,
    release_date: '', renters: 0, price_category_id: 1,
    created_at: '2024-01-01T00:00:00.000Z'
  }, g, { id: g.id, title: g.title })),
  price_categories: [{ id: 1, name: 'New Games', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 }],
  games_full: [],
  site_settings: {
    promo: { deposit: 100, discounts: { 10: 0, 15: 0, 30: 0 }, late_fee_per_day: 20 },
    promos: [offer],
    monthly10_seeded: true,
    payment_methods: [
      { key: 'gcash', label: 'GCash', account_name: 'TEST', account_number: '09170000001', qr_image: '', enabled: true },
      { key: 'maya', label: 'Maya', account_name: 'TEST', account_number: '09170000002', qr_image: '', enabled: true },
      { key: 'qrph', label: 'QR Ph', account_name: 'TEST', account_number: '', qr_image: '/uploads/test-qr.png', enabled: true },
      { key: 'paypal', label: 'PayPal', account_name: 'TEST', account_number: 'test@example.com', qr_image: '', enabled: true },
      { key: 'bank', label: 'Bank transfer', account_name: 'TEST', account_number: '000111', qr_image: '', enabled: true }
    ]
  }
}));
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8')), {
  games: JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8')).games.concat([{
    id: 4, title: 'TEST Full Game', platform: 'PS5', genre: 'Action', cover_image: '',
    non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 0,
    nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799,
    price_category_id: 1, release_date: '', renters: 0, created_at: '2024-01-01T00:00:00.000Z'
  }])
})));

function call(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host: 'localhost', port: PORT, path: p, method,
      headers: Object.assign({
        'X-Forwarded-Proto': 'https',
        'User-Agent': 'Mozilla/5.0 test'
      }, data ? {
        'Content-Type': typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json',
        'Content-Length': Buffer.byteLength(data)
      } : {}, headers || {})
    }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out, headers: res.headers }));
    });
    req.on('error', reject);
    if (data) req.end(data); else req.end();
  });
}

async function main() {
  process.env.MONGODB_URI = '';
  process.env.DATA_DIR = DATA_DIR;
  process.env.PORT = String(PORT);
  process.env.ORDERS_MEMORY = '1';
  process.env.SESSION_SECRET = 'basket-test';
  delete process.env.PAYMONGO_SECRET_KEY;
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  for (let i = 0; i < 40; i++) {
    try { if ((await call('GET', '/')).status === 200) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }

  const home = await call('GET', '/');
  ok('home cards keep Rent now and gain Add to basket, with a header basket', () => {
    assert.strictEqual(home.status, 200);
    assert.ok(home.body.includes('id="navBasketToggle"'));
    assert.ok(home.body.includes('Add to basket'));
    assert.ok(home.body.includes('>Rent now</span>'));
    assert.ok(home.body.includes('Review your order'));
    assert.ok(home.body.includes('placeholder="Enter voucher code"'));
    assert.ok(!home.body.includes('placeholder="MONTHLY10"'));
    assert.ok(!home.body.includes('id="voucherSkip"'));
    assert.ok(!home.body.includes('Card payment'));
    assert.ok(!home.body.includes('TEST Full Game') || !sliceAdd(home.body, 'TEST Full Game').includes('Add to basket'));
  });

  const quoted = await call('POST', '/api/basket/quote', {
    lines: picks,
    code: 'MONTHLY10',
    total: 1
  });
  const quote = JSON.parse(quoted.body);
  ok('the server ignores client prices and returns the example total', () => {
    assert.strictEqual(quoted.status, 200);
    assert.strictEqual(quote.subtotal, 1447);
    assert.strictEqual(quote.discount, 69.9);
    assert.strictEqual(quote.deposit, 100);
    assert.strictEqual(quote.total, 1477.1);
    assert.ok(quote.lines[0].offered.includes('nt'));
    assert.ok(quote.lines[0].offered.includes('tr'));
    assert.ok(quote.lines[0].offered.includes('ps4'));
    assert.strictEqual(quote.lines[0].tier_name, 'New Games');
  });

  const bad = await call('POST', '/api/basket/quote', { lines: picks, code: 'NOTACODE' });
  ok('an unknown code stays invalid', () => {
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(JSON.parse(bad.body).message, 'Code not valid');
  });

  const full = await call('POST', '/api/basket/quote', { lines: [{ game_id: 4, account_type: 'nt', days: 7 }] });
  ok('a full game cannot be added', () => {
    assert.strictEqual(full.status, 400);
    assert.ok(/no free slot|no longer|empty|price/i.test(JSON.parse(full.body).message));
  });

  const placed = await call('POST', '/api/basket/checkout', {
    lines: picks, code: 'MONTHLY10', fb_name: 'TEST Buyer', price: 1
  });
  const order = JSON.parse(placed.body);
  assert.strictEqual(placed.status, 200, placed.body);
  assert.ok(order.ref);
  const page = await call('GET', order.href);
  assert.strictEqual(page.status, 200);
  assert.ok(page.body.includes('PS Plus Deluxe'));
  assert.ok(page.body.includes('Silent Hill f'));
  assert.ok(page.body.includes('Phantom Blade Zero'));
  assert.ok(page.body.includes('MONTHLY10'));
    assert.ok(page.body.includes('1,477.10'));
    assert.ok(page.body.includes('Pay · ₱1,477.10'));
    assert.ok(page.body.includes('Amount: PHP 1,477.10'));
  ['GCash', 'Maya', 'QR Ph', 'PayPal', 'Bank transfer'].forEach(label => assert.ok(page.body.includes(label), label));
  assert.ok(!page.body.includes('Pay now —'));
  const single = await call('POST', '/api/checkout/start', {
    game_id: 3, account_type: 'nt', days: 7, kind: 'rent'
  });
  const one = JSON.parse(single.body);
  assert.strictEqual(single.status, 200, single.body);
  assert.strictEqual(one.summary.amount_due, 349);
  assert.ok(!one.summary.items);
  passed++;
  console.log('  ok - checkout creates one order and keeps the single-game flow');

  const held = await call('POST', '/api/basket/quote', {
    lines: [{ game_id: 2, account_type: 'tr', days: 7 }]
  });
  ok('the trophy line holds its slot', () => {
    assert.strictEqual(held.status, 400);
    assert.match(JSON.parse(held.body).message, /no free slot/);
  });

  const login = await call('POST', '/admin/login', 'password=' + encodeURIComponent('throwaway-basket'));
  const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
  const admin = await call('GET', '/admin', null, { cookie });
  ok('admin Orders lists every item, the hold, and the voucher', () => {
    assert.strictEqual(admin.status, 200);
    assert.ok(admin.body.includes('PS Plus Deluxe'));
    assert.ok(admin.body.includes('Silent Hill f'));
    assert.ok(admin.body.includes('Phantom Blade Zero'));
    assert.ok(admin.body.includes('slot hold'));
    assert.ok(admin.body.includes('MONTHLY10'));
    assert.ok(admin.body.includes('TEST Buyer'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  process.exit(0);
}

function sliceAdd(html, title) {
  const at = html.indexOf(title);
  if (at < 0) return '';
  return html.slice(Math.max(0, at - 400), at + 500);
}

main().catch(e => { console.error(e); process.exit(1); });
