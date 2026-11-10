// Run: node scripts/test-orders-mark-paid.js
//
// Mark paid stores a chosen payment method and refuses to save without one.
// The order drawer masks the shop's payment number and never includes it raw.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const markPaid = require('../lib/mark-paid-method');
const detail = require('../lib/order-detail');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

ok('the five ways the shop already records a payment are always offered', () => {
  assert.deepStrictEqual(markPaid.choices([]).map(m => m.key), ['gcash', 'maya', 'paypal', 'bank', 'manual']);
  assert.deepStrictEqual(markPaid.choices([]).map(m => m.label), ['GCash', 'Maya', 'PayPal', 'Bank transfer', 'Cash/Other']);
});

ok('a saved label wins, and an extra stored method is kept', () => {
  const list = markPaid.choices([
    { key: 'bank', label: 'Bank Transfer' },
    { key: 'qrph', label: 'QR Ph' }
  ]);
  assert.strictEqual(list.find(m => m.key === 'bank').label, 'Bank Transfer');
  assert.ok(list.some(m => m.key === 'qrph' && m.label === 'QR Ph'));
});

ok('an empty or unknown method does not become manual', () => {
  assert.strictEqual(markPaid.resolve('', []), null);
  assert.strictEqual(markPaid.resolve('   ', []), null);
  assert.strictEqual(markPaid.resolve('bitcoin', []), null);
  assert.strictEqual(markPaid.resolve('manual', []), 'manual');
  assert.strictEqual(markPaid.resolve(' GCash ', []), 'gcash');
});

ok('the mark-paid route stores the chosen method and rejects a missing one', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = src.indexOf("app.post('/admin/orders/:ref/mark-paid'");
  const end = src.indexOf("app.post('/admin/orders/:ref/priority-paid'");
  const block = src.slice(start, end);
  assert.ok(block.includes('markPaidMethod.resolve('));
  assert.ok(block.includes("msg=order_method_required"));
  assert.ok(block.includes('payment_method: method'));
  assert.ok(!block.includes("patch.payment_method = 'manual'"));
  assert.ok(!block.includes('order.payment_method || \'manual\''));
});

const GCASH = '09171234567';
const order = {
  ref: 'PH-0310', state: 'active', fb_name: 'Sample Customer', game_title: 'Sample Game',
  account_type: 'nt', days: 30, amount_due: 699, deposit_due: 100, payment_method: 'gcash',
  phone: '09180001111', psn_id: 'Sample_PSN', start_date: '2026-11-03', end_date: '2026-12-03',
  state_history: [{ state: 'awaiting_payment', at: '2026-11-01T00:00:00Z' }, { state: 'active', at: '2026-11-03T00:00:00Z' }]
};

ok('the drawer view masks the payment number and keeps the raw value out', () => {
  const view = detail.view(order, {
    paymentMethods: [{ key: 'gcash', label: 'GCash', account_number: GCASH }],
    customer: { id: 4, customer_name: 'Sample Customer', status: 'renting', phone: '09180001111', psn_id: 'Sample_PSN' }
  });
  const packed = JSON.stringify(view);
  assert.strictEqual(view.paidToMask, '09•• ••• ••67');
  assert.strictEqual(view.paidToReveal, 'gcash');
  assert.ok(!packed.includes(GCASH));
  assert.strictEqual(view.customer, 'Sample Customer');
  assert.strictEqual(view.psn, 'Sample_PSN');
  assert.strictEqual(view.phone, '09180001111');
  assert.strictEqual(view.game, 'Sample Game');
  assert.strictEqual(view.rental, 'Non-Trophy · Monthly');
  assert.strictEqual(view.deposit, '₱100 · not refunded');
  assert.strictEqual(view.method, 'GCash');
  assert.strictEqual(view.history.length, 2);
  assert.strictEqual(view.extend.id, '4');
});

ok('a bank number is masked too, and a missing number is left blank', () => {
  const bank = detail.view({ payment_method: 'bank' }, {
    paymentMethods: [{ key: 'bank', label: 'Bank Transfer', account_number: '1234567890' }]
  });
  assert.strictEqual(bank.paidToReveal, 'bank');
  assert.ok(bank.paidToMask.includes('•'));
  assert.ok(!JSON.stringify(bank).includes('1234567890'));
  const none = detail.view({ payment_method: 'manual' }, { paymentMethods: [] });
  assert.strictEqual(none.paidToMask, '');
  assert.strictEqual(none.method, 'Cash/Other');
  assert.strictEqual(none.phone, 'Not recorded');
  assert.strictEqual(none.psn, 'Not recorded');
});

console.log('\n' + passed + ' assertions passed\n');
