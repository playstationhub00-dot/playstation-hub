// Run: node scripts/test-mask.js
//
// Visible masking for admin secrets, and the "leave it unchanged" flag the
// settings and account forms send when the owner never revealed the value.
const assert = require('assert');
const mask = require('../lib/mask');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

ok('an email keeps the first letter, the @ and the dot-ending, and hides the rest', () => {
  const out = mask.maskEmail('customer@gmail.com');
  assert.notStrictEqual(out, 'customer@gmail.com');
  assert.ok(out.startsWith('c'), out);
  assert.ok(out.includes('@'), out);
  assert.ok(out.endsWith('.com'), out);
  assert.ok(!out.toLowerCase().includes('ustomer'), out);
  assert.ok(!out.toLowerCase().includes('mail'), out);
  assert.ok(out.includes('•'), out);
});

ok('a short local part is still hidden', () => {
  const out = mask.maskEmail('ab@x.co');
  assert.notStrictEqual(out, 'ab@x.co');
  assert.ok(out.startsWith('a'), out);
  assert.ok(out.endsWith('.co'), out);
  assert.ok(!out.includes('b@'), out);
});

ok('a blank email stays blank', () => {
  assert.strictEqual(mask.maskEmail(''), '');
  assert.strictEqual(mask.maskEmail(null), '');
  assert.strictEqual(mask.maskEmail('   '), '');
});

ok('something that is not an email is masked as a secret, not shown whole', () => {
  const out = mask.maskEmail('not-an-email');
  assert.notStrictEqual(out, 'not-an-email');
  assert.ok(!out.includes('email'), out);
});

ok('a Philippine mobile keeps the first two and last two digits only', () => {
  const out = mask.maskPaymentNumber('09171234567');
  assert.ok(out.startsWith('09'), out);
  assert.ok(out.endsWith('67'), out);
  assert.ok(!out.includes('17123'), out);
  assert.ok(out.includes('•'), out);
});

ok('a spaced or dashed number is masked from its digits', () => {
  const out = mask.maskPaymentNumber('0917-123-4567');
  assert.ok(out.startsWith('09'), out);
  assert.ok(out.endsWith('67'), out);
  assert.ok(!out.includes('123'), out);
});

ok('a PayPal email is masked as an email', () => {
  const out = mask.maskPaymentNumber('shop@paypal.com');
  assert.ok(out.includes('@'), out);
  assert.ok(out.endsWith('.com'), out);
  assert.ok(!out.toLowerCase().includes('shop'), out);
  assert.ok(!out.toLowerCase().includes('paypal'), out);
});

ok('a PayPal handle hides the middle', () => {
  const out = mask.maskPaymentNumber('playstationhub');
  assert.notStrictEqual(out, 'playstationhub');
  assert.ok(out.startsWith('p'), out);
  assert.ok(out.endsWith('b'), out);
  assert.ok(!out.includes('laystation'), out);
});

ok('an empty payment number stays empty', () => {
  assert.strictEqual(mask.maskPaymentNumber(''), '');
  assert.strictEqual(mask.maskPaymentNumber(null), '');
});

ok('GCash, Maya, PayPal and bank transfer are the payment keys that are masked', () => {
  assert.deepStrictEqual(mask.PAYMENT_KEYS, ['gcash', 'maya', 'paypal', 'bank']);
  assert.strictEqual(mask.isMaskedPaymentKey('gcash'), true);
  assert.strictEqual(mask.isMaskedPaymentKey('bank'), true);
  assert.strictEqual(mask.isMaskedPaymentKey('GCash'), true);
  assert.strictEqual(mask.isMaskedPaymentKey('other'), false);
});

ok('keep flag holds the stored secret even if the field was posted empty', () => {
  assert.strictEqual(mask.resolveKeptSecret('', '09171234567', '1'), '09171234567');
  assert.strictEqual(mask.resolveKeptSecret(undefined, 'secret@x.com', true), 'secret@x.com');
});

ok('clearing the flag saves whatever was posted, including a blank', () => {
  assert.strictEqual(mask.resolveKeptSecret('09170000000', '09171234567', '0'), '09170000000');
  assert.strictEqual(mask.resolveKeptSecret('', '09171234567', '0'), '');
  assert.strictEqual(mask.resolveKeptSecret('  new@x.com  ', 'old@x.com', ''), 'new@x.com');
});

ok('a form that never sends the flag still saves a posted value', () => {
  assert.strictEqual(mask.resolveKeptSecret('09170000000', '09171234567', undefined), '09170000000');
});

console.log('\n' + passed + ' assertions passed\n');
