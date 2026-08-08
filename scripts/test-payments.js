// Plain assert-based test for payment attribution. No test framework in this
// project by design — run with `node scripts/test-payments.js`, which exits
// non-zero on the first failed assertion.
const assert = require('assert');
const { normalizeCustomerPayments, sumPaymentsInMonth, rentersInMonth, priceDeltaPayment } = require('../lib/payments');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

check('backfills a single payment at the start date', () => {
  const c = normalizeCustomerPayments({ price: 499, start_date: '2026-06-15', created_at: '2026-06-15T02:00:00.000Z' });
  assert.deepStrictEqual(c.payments, [{ amount: 499, date: '2026-06-15', kind: 'rental' }]);
});

check('falls back to created_at when there is no start date', () => {
  const c = normalizeCustomerPayments({ price: 300, start_date: '', created_at: '2026-05-02T08:00:00.000Z' });
  assert.strictEqual(c.payments[0].date, '2026-05-02');
});

check('leaves an existing payments array alone', () => {
  const existing = [{ amount: 100, date: '2026-01-01', kind: 'rental' }];
  const c = normalizeCustomerPayments({ price: 999, start_date: '2026-06-15', payments: existing });
  assert.deepStrictEqual(c.payments, existing);
});

check('a zero-price customer gets no payment row', () => {
  const c = normalizeCustomerPayments({ price: 0, start_date: '2026-06-15' });
  assert.deepStrictEqual(c.payments, []);
});

check('the backfill reproduces the old single-price total', () => {
  const list = [
    normalizeCustomerPayments({ price: 499, start_date: '2026-06-15' }),
    normalizeCustomerPayments({ price: 300, start_date: '2026-06-20' })
  ];
  assert.strictEqual(sumPaymentsInMonth(list, 2026, 5), 799); // month is 0-indexed: 5 = June
});

check('an extension counts in the month it was paid, not the rental month', () => {
  const c = { customer_name: 'Ana', payments: [
    { amount: 499, date: '2026-06-15', kind: 'rental' },
    { amount: 499, date: '2026-08-08', kind: 'extension' }
  ]};
  assert.strictEqual(sumPaymentsInMonth([c], 2026, 5), 499); // June
  assert.strictEqual(sumPaymentsInMonth([c], 2026, 7), 499); // August
});

check('a renter counts in every month they paid in', () => {
  const c = { customer_name: 'Ana', payments: [
    { amount: 499, date: '2026-06-15', kind: 'rental' },
    { amount: 499, date: '2026-08-08', kind: 'extension' }
  ]};
  assert.strictEqual(rentersInMonth([c], 2026, 5), 1);
  assert.strictEqual(rentersInMonth([c], 2026, 7), 1);
  assert.strictEqual(rentersInMonth([c], 2026, 6), 0); // July — no payment
});

check('the same person paying twice in one month counts once', () => {
  const list = [
    { customer_name: 'Ana', payments: [{ amount: 100, date: '2026-08-02', kind: 'rental' }] },
    { customer_name: ' ana ', payments: [{ amount: 100, date: '2026-08-20', kind: 'extension' }] }
  ];
  assert.strictEqual(rentersInMonth(list, 2026, 7), 1);
  assert.strictEqual(sumPaymentsInMonth(list, 2026, 7), 200);
});

check('backfill fallback buckets a late-UTC-evening created_at into the Manila-local month', () => {
  // 2026-05-31T20:00:00.000Z is 2026-06-01 04:00 in Manila (UTC+8) — the old
  // dashboard logic (new Date(created_at).getFullYear()/getMonth(), which
  // reads local time) always bucketed this into June, not May.
  const c = normalizeCustomerPayments({ price: 250, start_date: '', created_at: '2026-05-31T20:00:00.000Z' });
  assert.strictEqual(c.payments[0].date, '2026-06-01');
});

check('a price decrease records a negative adjustment, and payments still sum to the final price', () => {
  const first = priceDeltaPayment(0, 500, { startDate: '2026-07-01' });
  assert.deepStrictEqual(first, { amount: 500, date: '2026-07-01', kind: 'rental' });
  const decrease = priceDeltaPayment(500, 350, { todayDate: '2026-07-10' });
  assert.deepStrictEqual(decrease, { amount: -150, date: '2026-07-10', kind: 'adjustment' });
  const payments = [first, decrease];
  const total = payments.reduce((s, p) => s + p.amount, 0);
  assert.strictEqual(total, 350); // matches the final price after the decrease
});

console.log('\n' + passed + ' assertions passed');
