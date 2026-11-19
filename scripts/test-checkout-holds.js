// Run: node scripts/test-checkout-holds.js
//
// Hold expiry, slot counts, voucher apply / hidden when full, both checkout
// paths, and screenshot upload checks. Orders stay in memory (ORDERS_MEMORY=1)
// and the catalogue is a temp copy. Nothing here talks to a real database.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const holds = require('../lib/holds');
const payments = require('../lib/checkout-payments');

let passed = 0;
function ok(desc, fn) {
  fn();
  passed++;
  console.log('  ok - ' + desc);
}

console.log('\nhold rules');

ok('a fresh awaiting_payment order holds its slot', () => {
  const exp = holds.plan(new Date('2026-11-19T00:00:00.000Z')).expires;
  const order = { state: 'awaiting_payment', account_type: 'nt', game_id: 1, slot_hold_expires_at: exp };
  assert.strictEqual(holds.consumesSlot(order, new Date('2026-11-19T00:10:00.000Z')), true);
  assert.strictEqual(holds.statusOf(order, new Date('2026-11-19T00:10:00.000Z')), 'holding');
});

ok('the slot returns when the 15 minutes pass and no screenshot was sent', () => {
  const exp = holds.plan(new Date('2026-11-19T00:00:00.000Z')).expires;
  const order = { state: 'awaiting_payment', account_type: 'nt', game_id: 1, slot_hold_expires_at: exp };
  const later = new Date('2026-11-19T00:15:01.000Z');
  assert.strictEqual(holds.consumesSlot(order, later), false);
  assert.strictEqual(holds.statusOf(order, later), 'expired');
});

ok('a submitted screenshot keeps the slot until the owner confirms', () => {
  const order = { state: 'verifying_payment', account_type: 'nt', game_id: 1, payment_proof: '/uploads/x.webp', slot_hold_expires_at: '2020-01-01T00:00:00.000Z' };
  assert.strictEqual(holds.consumesSlot(order, new Date()), true);
  assert.strictEqual(holds.statusOf(order, new Date()), 'submitted');
});

ok('owner confirmation and a rejected payment both stop holding the slot', () => {
  assert.strictEqual(holds.consumesSlot({ state: 'awaiting_qr', slot_hold_expires_at: '2099-01-01T00:00:00.000Z' }, new Date()), false);
  assert.strictEqual(holds.consumesSlot({ state: 'reserved', slot_hold_expires_at: '2099-01-01T00:00:00.000Z' }, new Date()), false);
  assert.strictEqual(holds.consumesSlot({ state: 'payment_rejected', slot_hold_expires_at: '2099-01-01T00:00:00.000Z' }, new Date()), false);
});

ok('a free line does not take a slot', () => {
  assert.strictEqual(holds.consumesSlot({
    state: 'waitlisted', hold_for_line: true, is_waitlist: true, account_type: 'nt', game_id: 1
  }, new Date()), false);
});

ok('active holds reduce the number the page shows', () => {
  const avail = { ntSlots: 2, trSlots: 1, ps4Slots: 0, showPs4: false, ntAvail: true, trAvail: true, ps4Avail: true };
  const next = holds.applyCounts(avail, { nt: 2, tr: 0, ps4: 0 });
  assert.strictEqual(next.ntSlots, 0);
  assert.strictEqual(next.ntAvail, false);
  assert.strictEqual(next.trSlots, 1);
  assert.strictEqual(next.totalSlots, 1);
});

console.log('\npayment details');

function withoutPaymentEnv(fn) {
  const saved = {};
  ['GCASH', 'MAYA', 'QRPH', 'PAYPAL', 'BANK'].forEach(key => {
    ['NAME', 'NUMBER', 'QR'].forEach(field => {
      const name = 'PAYMENT_' + key + '_' + field;
      saved[name] = process.env[name];
      delete process.env[name];
    });
  });
  try { fn(); }
  finally {
    Object.keys(saved).forEach(name => {
      if (saved[name] == null) delete process.env[name];
      else process.env[name] = saved[name];
    });
  }
}

ok('customers get no payment methods when nothing is configured', () => {
  withoutPaymentEnv(() => {
    const rows = payments.publicMethods({
      payment_methods: [{ key: 'gcash', enabled: false, account_number: '09170000000' }]
    });
    assert.deepStrictEqual(rows, []);
  });
});

ok('an enabled saved method is listed and a disabled one is not', () => {
  withoutPaymentEnv(() => {
    const rows = payments.publicMethods({
      payment_methods: [
        { key: 'maya', enabled: true, account_number: '09170000000', account_name: 'Hub' },
        { key: 'gcash', enabled: false, account_number: '0999' }
      ]
    });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].key, 'maya');
    assert.strictEqual(rows[0].example, false);
    assert.strictEqual(rows[0].account_number, '09170000000');
  });
});

ok('an env number is a real method', () => {
  withoutPaymentEnv(() => {
    process.env.PAYMENT_BANK_NUMBER = '1234567890';
    process.env.PAYMENT_BANK_NAME = 'Test Bank';
    const rows = payments.publicMethods({ payment_methods: [] });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].key, 'bank');
    assert.strictEqual(rows[0].account_number, '1234567890');
    assert.strictEqual(rows[0].example, false);
  });
});

console.log('\npanel source');

ok('the voucher link is hidden when every slot is full, and a picked full type hides it too', () => {
  const page = fs.readFileSync(path.join(__dirname, '../views/game-detail.ejs'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/game-detail.js'), 'utf8');
  assert.ok(page.includes("allUnavail ? 'hidden' : ''"));
  assert.ok(js.includes('voucherToggle.hidden = isBookedNow()'));
  const checkout = fs.readFileSync(path.join(__dirname, '../public/js/checkout-flow.js'), 'utf8');
  assert.ok(checkout.includes("$('ckPay').hidden = session.methods.length === 0"));
});

ok('checkout stores the screenshot on the existing payment_proof field', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(src.includes("uploadOrderFile.single('proof')"));
  assert.ok(src.includes('payment_proof: proofPath'));
  assert.ok(src.includes('verifying_payment'));
});

const PORT = 4593;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-checkout-'));
const game = {
  id: 99001,
  title: 'Holdtest',
  platform: 'PS5',
  genre: 'Action',
  description: 'Test data for the checkout hold.',
  cover_image: '',
  non_trophy_slots: 1,
  trophy_slots: 0,
  ps4_primary_slots: 0,
  nt_price_7d: 449,
  nt_price_30d: 899,
  tr_price_7d: 0,
  tr_price_30d: 0,
  buy_nt_price: 3299,
  buy_tr_price: 0
};
const fullGame = Object.assign({}, game, {
  id: 99002,
  title: 'Fulltest',
  non_trophy_slots: 0,
  buy_nt_price: 3299
});
const soon = Object.assign({}, game, {
  id: 99003,
  title: 'Soontest',
  release_date: '2027-06-01',
  non_trophy_slots: 1,
  trophy_slots: 0
});

fs.writeFileSync(path.join(dataDir, 'games.json'), JSON.stringify({
  games: [game, fullGame],
  upcoming: [soon],
  nextId: 99100,
  nextUpcomingId: 99100,
  admin_password: 'test-admin',
  customers: [],
  accounts: [],
  reviews: [],
  site_settings: {
    title: 'PlayStation Hub',
    promo: { enabled: false, deposit: 100, late_fee_per_day: 20, buy_promo_enabled: false, buy_promo_pct: 0, discounts: { 7: 0, 30: 0 } },
    payment_methods: [],
    promos: []
  }
}));

process.env.MONGODB_URI = '';
process.env.ORDERS_MEMORY = '1';
process.env.DATA_DIR = dataDir;
process.env.PORT = String(PORT);
process.env.PAYMENT_GCASH_NUMBER = '09171234567';
process.env.PAYMENT_GCASH_NAME = 'Test GCash';

function request(method, urlPath, { json, raw, headers, cookies } = {}) {
  return new Promise((resolve, reject) => {
    const body = raw || (json ? Buffer.from(JSON.stringify(json)) : null);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: Object.assign({
        'content-type': json ? 'application/json' : (headers && headers['content-type']) || 'application/octet-stream',
        'content-length': body ? body.length : 0,
        cookie: cookies || '',
        'x-forwarded-proto': 'https'
      }, headers || {})
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
        resolve({ status: res.statusCode, text, json: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function formBody(fields, file) {
  const boundary = '----ckbound';
  const parts = [];
  Object.keys(fields).forEach(key => {
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + key + '"\r\n\r\n' + fields[key] + '\r\n'));
  });
  if (file) {
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="proof"; filename="' + file.name + '"\r\nContent-Type: ' + file.type + '\r\n\r\n'));
    parts.push(file.buf);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from('--' + boundary + '--\r\n'));
  return { raw: Buffer.concat(parts), type: 'multipart/form-data; boundary=' + boundary };
}

async function main() {
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await request('GET', '/'); up = true; break; }
    catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not start');

  console.log('\npages');
  const openPage = await request('GET', '/game/holdtest');
  assert.strictEqual(openPage.status, 200, openPage.text.slice(0, 400));
  assert.ok(openPage.text.includes('Have a voucher?'));
  assert.ok(openPage.text.includes('id="voucherBox" hidden'));
  assert.ok(openPage.text.includes('checkout-flow.js'));
  assert.ok(!/id="voucherToggle"\s+hidden/.test(openPage.text));
  console.log('  ok - available panel offers a collapsed voucher');
  passed++;

  const fullPage = await request('GET', '/game/fulltest');
  assert.strictEqual(fullPage.status, 200, fullPage.text.slice(0, 400));
  assert.ok(/id="voucherToggle"\s+hidden/.test(fullPage.text));
  assert.ok(fullPage.text.includes('Buy permanent access instead') || fullPage.text.includes('Get in line') || fullPage.text.includes('Fully booked'));
  console.log('  ok - a full game hides the voucher');
  passed++;

  console.log('\norders');
  const weekly = await request('POST', '/api/checkout/start', { json: { game_id: 99001, account_type: 'nt', days: 7, kind: 'rent', promo_code: 'MONTHLY10' } });
  assert.strictEqual(weekly.status, 400, JSON.stringify(weekly.json));
  console.log('  ok - MONTHLY10 is refused on a weekly rental');
  passed++;

  const rented = await request('POST', '/api/checkout/start', { json: { game_id: 99001, account_type: 'nt', days: 30, kind: 'rent', promo_code: 'MONTHLY10' } });
  assert.strictEqual(rented.status, 200, JSON.stringify(rented.json));
  assert.strictEqual(rented.json.summary.total, 809);
  assert.ok(rented.json.hold_expires_at);
  assert.ok(rented.json.methods.some(m => m.key === 'gcash' && m.example === false));
  assert.ok(!JSON.stringify(rented.json.methods).includes('EXAMPLE'));
  assert.ok(!JSON.stringify(rented.json.methods).includes('Set PAYMENT_'));
  console.log('  ok - MONTHLY10 takes ₱899 down to ₱809 and starts a hold');
  passed++;

  const blocked = await request('POST', '/api/checkout/start', { json: { game_id: 99001, account_type: 'nt', days: 30, kind: 'rent' } });
  assert.strictEqual(blocked.status, 409, JSON.stringify(blocked.json));
  console.log('  ok - a second customer cannot take the held slot');
  passed++;

  const line = await request('POST', '/api/checkout/start', { json: { game_id: 99002, account_type: 'nt', days: 30, kind: 'line', fb_name: 'Line Tester' } });
  assert.strictEqual(line.status, 200, JSON.stringify(line.json));
  assert.strictEqual(line.json.hold_expires_at, null);
  const orders = require('../lib/orders');
  const lineOrder = await orders.getByRef(line.json.ref);
  assert.strictEqual(lineOrder.state, 'waitlisted');
  assert.strictEqual(lineOrder.hold_for_line, true);
  console.log('  ok - free line saves a waitlisted order and does not hold a slot');
  passed++;

  const msg = await request('POST', '/api/checkout/' + rented.json.ref + '/messenger', {
    json: { k: rented.json.k, fb_name: 'Ada Tester' }
  });
  assert.strictEqual(msg.status, 200, JSON.stringify(msg.json));
  assert.ok(msg.json.href.indexOf('m.me/PlaystationHub00') !== -1);
  assert.ok(decodeURIComponent(msg.json.href).includes('Ada Tester'));
  assert.ok(decodeURIComponent(msg.json.href).includes(rented.json.ref));
  assert.ok(decodeURIComponent(msg.json.href).includes('Holdtest'));
  const saved = await orders.getByRef(rented.json.ref);
  assert.strictEqual(saved.state, 'awaiting_payment');
  assert.strictEqual(saved.checkout_path, 'messenger');
  console.log('  ok - Messenger path saves the order first and prefills the chat');
  passed++;

  const released = await orders.patch(rented.json.ref, { slot_hold_expires_at: '2020-01-01T00:00:00.000Z' });
  assert.strictEqual(holds.consumesSlot(released, new Date()), false);
  const after = await request('POST', '/api/checkout/start', { json: { game_id: 99001, account_type: 'nt', days: 30, kind: 'rent' } });
  assert.strictEqual(after.status, 200, JSON.stringify(after.json));
  console.log('  ok - an expired hold gives the slot back');
  passed++;

  const late = formBody({ k: rented.json.k, fb_name: 'Ada Tester', method: 'gcash' }, {
    name: 'late.png', type: 'image/png', buf: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  });
  const lateRes = await request('POST', '/api/checkout/' + rented.json.ref + '/proof', {
    raw: late.raw, headers: { 'content-type': late.type }
  });
  assert.strictEqual(lateRes.status, 410, JSON.stringify(lateRes.json));
  console.log('  ok - a screenshot after the hold expires is refused');
  passed++;

  const missing = formBody({ k: after.json.k, fb_name: 'Bea Tester', method: 'gcash' });
  const missingRes = await request('POST', '/api/checkout/' + after.json.ref + '/proof', {
    raw: missing.raw, headers: { 'content-type': missing.type }
  });
  assert.strictEqual(missingRes.status, 400);
  console.log('  ok - submit without a screenshot is refused');
  passed++;

  const textFile = formBody({ k: after.json.k, fb_name: 'Bea Tester', method: 'gcash' }, {
    name: 'notes.txt', type: 'text/plain', buf: Buffer.from('not an image')
  });
  const textRes = await request('POST', '/api/checkout/' + after.json.ref + '/proof', {
    raw: textFile.raw, headers: { 'content-type': textFile.type }
  });
  assert.strictEqual(textRes.status, 400, JSON.stringify(textRes.json));
  console.log('  ok - a non-image upload is refused');
  passed++;

  const png = formBody({ k: after.json.k, fb_name: 'Bea Tester', method: 'gcash' }, {
    name: 'receipt.png', type: 'image/png', buf: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  });
  const paid = await request('POST', '/api/checkout/' + after.json.ref + '/proof', {
    raw: png.raw, headers: { 'content-type': png.type }
  });
  assert.strictEqual(paid.status, 200, JSON.stringify(paid.json));
  const paidOrder = await orders.getByRef(after.json.ref);
  assert.strictEqual(paidOrder.state, 'verifying_payment');
  assert.strictEqual(paidOrder.payment_method, 'gcash');
  assert.ok(String(paidOrder.payment_proof).indexOf('/uploads/') === 0);
  console.log('  ok - a real screenshot is stored with the order');
  passed++;

  // Admin login cookies are stored in Mongo. This test has no database, so
  // the ledger is rendered the same way the Orders tab includes it.
  const ejs = require('ejs');
  const adminHtml = await ejs.renderFile(path.join(__dirname, '../views/partials/admin/orders/ledger.ejs'), {
    orderPeriod: 'all',
    orderYears: ['2026'],
    orderPeriods: ['2026-11'],
    ledgerStats: { total: 2, paidCount: 0, paidTotal: 0 },
    ledgerGroups: [{ key: '2026-11', paidCount: 0, paidTotal: 0, orders: [paidOrder, released, lineOrder] }],
    holdsLib: require('../lib/holds'),
    reminderBadge: () => null
  });
  assert.ok(adminHtml.includes(after.json.ref));
  assert.ok(adminHtml.includes('gcash'));
  assert.ok(adminHtml.includes('Screenshot'));
  assert.ok(adminHtml.includes(line.json.ref));
  assert.ok(adminHtml.includes('In line'));
  assert.ok(adminHtml.includes('hold expired'));
  console.log('  ok - both orders show in admin with method, screenshot and hold');
  passed++;

  console.log('\n' + passed + ' assertions passed\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
