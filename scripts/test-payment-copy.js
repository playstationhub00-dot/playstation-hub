// Run: node scripts/test-payment-copy.js
//
// How It Works, game pages, and the footer share one sentence: GCash or Maya
// locally, PayPal internationally. Card and bank transfer stay in the sentence
// only when that method is actually switched on.
const assert = require('assert');
const pay = require('../lib/payment-copy');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

console.log('\npaymentNote');

ok('the default sentence names local GCash/Maya and international PayPal', () => {
  const s = pay.paymentNote({});
  assert.strictEqual(s, 'GCash or Maya for local customers · PayPal for international customers');
});

ok('card checkout is mentioned only when the online gateway is on', () => {
  const on = pay.paymentNote({ payViaGateway: true });
  assert.ok(on.includes('card checkout is also available'));
  assert.ok(!pay.paymentNote({ payViaGateway: false }).includes('card'));
});

ok('bank transfer is mentioned only when that method is enabled', () => {
  const on = pay.paymentNote({
    payment_methods: [{ key: 'bank', enabled: true }, { key: 'gcash', enabled: true }]
  });
  assert.ok(on.includes('bank transfer is also available'));
  const off = pay.paymentNote({
    payment_methods: [{ key: 'bank', enabled: false }]
  });
  assert.ok(!off.includes('bank'));
});

console.log('\n' + passed + ' assertions passed\n');
