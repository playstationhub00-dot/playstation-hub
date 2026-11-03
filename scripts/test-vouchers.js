// Run: node scripts/test-vouchers.js
//
// MONTHLY10 is a promo-code record on the existing promo list. These checks
// cover the rules checkout re-validates: monthly only, expiry at the end of
// Nov 30 Philippines time, one use per customer, no stacking with a second
// code or with Rewards / the ₱50 comeback discount, whole-peso rounding, and
// a deposit that is never discounted.
const assert = require('assert');
const vouchers = require('../lib/vouchers');
const promos = require('../lib/promos');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const offer = vouchers.monthly10Offer();
const liveDay = new Date('2026-11-03T04:00:00.000Z'); // Nov 3, 12:00 Manila
const lastMinute = new Date('2026-11-30T15:59:00.000Z'); // Nov 30, 23:59 Manila
const nextDay = new Date('2026-11-30T16:00:00.000Z'); // Dec 1, 00:00 Manila

function ask(over) {
  return vouchers.quote(Object.assign({
    code: 'MONTHLY10',
    days: 30,
    base: 799,
    deposit: 100,
    now: liveDay,
    offers: [offer],
    name: 'Ana Cruz'
  }, over || {}));
}

console.log('\nseed');

ok('MONTHLY10 is inserted once and not rewritten after that', () => {
  const first = vouchers.seedMonthly10([], false);
  assert.strictEqual(first.added, true);
  assert.strictEqual(first.seeded, true);
  const row = first.offers[0];
  assert.strictEqual(row.code, 'MONTHLY10');
  assert.strictEqual(row.discount_pct, 10);
  assert.strictEqual(row.duration_days, 30);
  assert.strictEqual(row.once_per_customer, true);
  assert.strictEqual(row.exclude_loyalty, true);
  assert.strictEqual(row.ends_on, '2026-11-30');
  assert.strictEqual(row.enabled, true);
  const again = vouchers.seedMonthly10(first.offers, true);
  assert.strictEqual(again.added, false);
  assert.strictEqual(again.offers.length, 1);
});

ok('a deleted code stays deleted, and an edited code is not duplicated', () => {
  assert.strictEqual(vouchers.seedMonthly10([], true).offers.length, 0);
  const custom = vouchers.seedMonthly10([{
    id: 'p9', title: 'Mine', text: 'Edited.', enabled: true, code: 'monthly10', discount_pct: 15
  }], false);
  assert.strictEqual(custom.added, false);
  assert.strictEqual(custom.offers.length, 1);
  assert.strictEqual(custom.offers[0].title, 'Mine');
  assert.strictEqual(custom.offers[0].discount_pct, 15);
});

ok('saving the admin form keeps the code fields', () => {
  const saved = promos.saveOffer([], {
    title: 'MONTHLY10',
    text: '10% off monthly rentals with code MONTHLY10.',
    terms: 'Monthly only.',
    ends_on: '2026-11-30',
    enabled: 'on',
    code: 'monthly10',
    discount_pct: '10',
    duration_days: '30',
    once_per_customer: 'on',
    exclude_loyalty: 'on'
  }, { nextId: 4 });
  assert.strictEqual(saved.ok, true);
  const row = promos.normalizeList(saved.offers)[0];
  assert.strictEqual(row.code, 'MONTHLY10');
  assert.strictEqual(row.discount_pct, 10);
  assert.strictEqual(row.duration_days, 30);
  assert.strictEqual(row.once_per_customer, true);
  assert.strictEqual(row.exclude_loyalty, true);
  const edited = promos.saveOffer(saved.offers, {
    id: row.id, title: 'MONTHLY10', text: 'Still on.', enabled: 'on'
  }, { nextId: saved.nextId });
  assert.strictEqual(edited.offers[0].code, 'MONTHLY10');
  assert.strictEqual(edited.offers[0].discount_pct, 10);
});

ok('a code does not flip the automatic monthly-percent flag or the card badge', () => {
  const live = promos.liveOffers({ stored: [offer], loyaltySettings: { punch_enabled: false, rebook_enabled: false }, games: [], today: '2026-11-03' });
  assert.strictEqual(promos.monthlyDiscountLive(live), null);
  assert.strictEqual(promos.badgeFor(live, 7), null);
  assert.strictEqual(promos.bannerOffer(live), null);
  assert.strictEqual(promos.checkoutLines(live, 7, null).length, 0);
  assert.ok(live.some(o => o.code === 'MONTHLY10'));
});

console.log('\nrules');

ok('₱799 monthly minus 10% is ₱80 off, deposit stays ₱100, total ₱819', () => {
  assert.strictEqual(vouchers.pesoDiscount(799, 10), 80);
  const q = ask();
  assert.strictEqual(q.ok, true);
  assert.strictEqual(q.discount, 80);
  assert.strictEqual(q.amount_due, 719);
  assert.strictEqual(q.deposit, 100);
  assert.strictEqual(q.total, 819);
  const settled = vouchers.settle(q);
  assert.strictEqual(settled.amount_due, 719);
  assert.strictEqual(settled.deposit_due, 100);
  assert.strictEqual(settled.promo_code, 'MONTHLY10');
  assert.strictEqual(settled.promo_discount, 80);
  assert.notStrictEqual(q.amount_due, 719 - 50);
});

ok('a non-trophy rental has no deposit to discount', () => {
  const q = ask({ deposit: 0 });
  assert.strictEqual(q.deposit, 0);
  assert.strictEqual(q.amount_due, 719);
  assert.strictEqual(q.total, 719);
});

ok('rounding is to the nearest peso', () => {
  assert.strictEqual(vouchers.pesoDiscount(333, 10), 33);
  assert.strictEqual(vouchers.pesoDiscount(795, 10), 80);
  assert.strictEqual(vouchers.pesoDiscount(794, 10), 79);
});

ok('MONTHLY10 works on monthly rentals only', () => {
  const q = ask({ days: 7 });
  assert.strictEqual(q.ok, false);
  assert.strictEqual(q.error, 'monthly_only');
  assert.strictEqual(q.message, 'MONTHLY10 works on monthly rentals only. Switch to Monthly?');
  assert.strictEqual(q.action, 'Switch to Monthly?');
  assert.strictEqual(vouchers.settle(q), null);
});

ok('the code is valid at 23:59 Manila on Nov 30 and dead at midnight', () => {
  assert.strictEqual(ask({ now: lastMinute }).ok, true);
  const expired = ask({ now: nextDay });
  assert.strictEqual(expired.ok, false);
  assert.strictEqual(expired.error, 'expired');
  assert.ok(expired.message.includes('Nov 30, 2026'));
});

ok('turning the promo off or leaving it disabled rejects the code', () => {
  const off = ask({ offers: [Object.assign({}, offer, { enabled: false })] });
  assert.strictEqual(off.ok, false);
  assert.strictEqual(off.error, 'disabled');
});

ok('one use per customer, and a cancelled order does not use it up', () => {
  const used = ask({
    priorOrders: [{ fb_name: 'ana   cruz', promo_code: 'MONTHLY10', state: 'active' }]
  });
  assert.strictEqual(used.ok, false);
  assert.strictEqual(used.error, 'used');
  const cancelled = ask({
    priorOrders: [{ fb_name: 'Ana Cruz', promo_code: 'MONTHLY10', state: 'cancelled' }]
  });
  assert.strictEqual(cancelled.ok, true);
  const other = ask({
    name: 'Ben Reyes',
    priorOrders: [{ fb_name: 'Ana Cruz', promo_code: 'MONTHLY10', state: 'awaiting_payment' }]
  });
  assert.strictEqual(other.ok, true);
});

ok('a second code does not stack, and neither does Rewards or the ₱50 comeback', () => {
  const second = ask({ code: 'COMEBACK50', appliedCode: 'MONTHLY10' });
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.error, 'one_code');
  assert.strictEqual(second.message, 'Only one code per order. Remove MONTHLY10 first if you\'d like to use this one instead.');
  assert.strictEqual(vouchers.settle(second), null);
  const loyalty = ask({ loyaltyBlocked: true });
  assert.strictEqual(loyalty.ok, false);
  assert.strictEqual(loyalty.error, 'loyalty');
  assert.ok(loyalty.message.includes('₱50'));
  assert.ok(loyalty.message.includes('Rewards'));
});

ok('an unknown code is rejected', () => {
  const q = ask({ code: 'NOPE' });
  assert.strictEqual(q.ok, false);
  assert.strictEqual(q.error, 'unknown');
});

console.log('\n' + passed + ' assertions passed\n');
