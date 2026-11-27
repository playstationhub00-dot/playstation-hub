// Run: node scripts/test-payment-copy.js
//
// How It Works, game pages, and the footer share one sentence: GCash or Maya
// locally, PayPal internationally, and bank transfer. Card checkout is never
// named.
const assert = require('assert');
const pay = require('../lib/payment-copy');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

console.log('\npaymentNote');

ok('the customer sentence names GCash, Maya, PayPal and bank transfer', () => {
  const s = 'GCash or Maya for local customers · PayPal for international customers · bank transfer is also available';
  assert.strictEqual(pay.paymentNote({}), s);
  assert.strictEqual(pay.paymentNote({ payViaGateway: true, payment_methods: [{ key: 'bank', enabled: false }] }), s);
  assert.ok(!s.toLowerCase().includes('card'));
});

console.log('\n' + passed + ' assertions passed\n');
