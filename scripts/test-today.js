// Run: node scripts/test-today.js
//
// Today is built from records the admin already has. Counts the page cannot
// know (waitlist size, a Reserved slot, GA4) are left out. PS Plus expiry
// uses the date saved on the account, and a blank date stays blank.
const assert = require('assert');
const today = require('../lib/today');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

// 1:30 PM in Asia/Manila is 05:30 UTC. The shop clock is Philippines time.
const NOW = new Date('2026-11-04T05:30:00.000Z');

const ORDERS = ([
  { ref: 'PH-0310', state: 'active', fb_name: 'Customer B', game_title: 'Call of Duty', created_at: '2026-11-03T02:00:00.000Z', state_history: [{ state: 'active', at: '2026-11-04T04:30:00.000Z' }] },
  { ref: 'PH-0281', state: 'awaiting_return', fb_name: 'Customer C', game_title: 'NBA 2K', end_date: '2026-11-03', deposit_due: 100, deposit_refunded: false, created_at: '2026-10-27T02:00:00.000Z', state_history: [{ state: 'awaiting_return', at: '2026-11-04T02:30:00.000Z' }] },
  { ref: 'PH-0280', state: 'verifying_return', fb_name: 'Customer E', game_title: 'Ghost', end_date: '2026-11-02', deposit_due: 0, created_at: '2026-10-20T02:00:00.000Z', state_history: [{ state: 'verifying_return', at: '2026-11-04T01:00:00.000Z' }] },
  { ref: 'PH-0313', state: 'awaiting_payment', fb_name: 'Customer A', game_title: 'Wolverine', created_at: '2026-11-04T04:00:00.000Z', amount_due: 399, deposit_due: 100 },
  { ref: 'PH-0312', state: 'payment_rejected', fb_name: 'Customer D', game_title: 'Wolverine', created_at: '2026-11-03T01:00:00.000Z', amount_due: 399 },
  { ref: 'PH-0200', state: 'awaiting_payment', fb_name: 'Quick Add', game_title: 'Old', created_at: '2026-11-01T01:00:00.000Z', customer_id: 9, settle_state: 'active' },
  { ref: 'PH-0100', state: 'closed', fb_name: 'Customer F', game_title: 'Onimusha', deposit_due: 100, deposit_refunded: false, created_at: '2026-10-01T02:00:00.000Z' },
  { ref: 'PH-0101', state: 'closed', fb_name: 'Customer G', game_title: 'Onimusha', deposit_due: 100, deposit_refunded: true, created_at: '2026-10-01T02:00:00.000Z' },
  { ref: 'PH-0102', state: 'closed', fb_name: 'Customer H', game_title: 'RDR2', deposit_due: 0, deposit_refunded: false, created_at: '2026-10-02T02:00:00.000Z' },
  { ref: 'PH-0090', state: 'waitlisted', fb_name: 'Customer W', game_title: 'Wait', created_at: '2026-11-01T02:00:00.000Z' },
  { ref: 'PH-0091', state: 'cancelled', fb_name: 'Customer X', game_title: 'Nope', created_at: '2026-11-02T02:00:00.000Z', state_history: [{ state: 'cancelled', at: '2026-11-04T00:30:00.000Z' }] },
  { ref: 'PH-NT1', state: 'awaiting_return', account_type: 'nt', fb_name: 'Non Trophy', game_title: 'Swap', deposit_due: 100, deposit_refunded: false, created_at: '2020-01-01T00:00:00.000Z' },
  { ref: 'PH-NT2', state: 'closed', account_type: 'nt', fb_name: 'Non Trophy Two', game_title: 'Swap', deposit_due: 100, deposit_refunded: false, created_at: '2020-01-02T00:00:00.000Z' },
  { ref: 'PH-PS0', state: 'closed', account_type: 'ps4', fb_name: 'PS4 None', game_title: 'Old Game', deposit_due: 0, deposit_refunded: false, created_at: '2020-01-03T00:00:00.000Z' }
]).map(o => Object.assign({ account_type: 'tr' }, o));

const CUSTOMERS = [
  { customer_name: 'Ana', game_title: 'Call of Duty', status: 'renting', start_date: '2026-11-02', end_date: '2026-11-06', payments: [{ amount: 500, date: '2026-11-02' }] },
  { customer_name: 'Ben', game_title: 'Call of Duty', status: 'renting', start_date: '2026-11-01', end_date: '2026-11-03', payments: [{ amount: 200, date: '2026-11-01' }] },
  { customer_name: 'Cara', game_title: 'Wolverine', status: 'renting', start_date: '2026-10-20', end_date: '2026-11-20', payments: [{ amount: 100, date: '2026-11-03' }] },
  { customer_name: 'Dan', game_title: 'Wolverine', status: 'done', start_date: '2026-11-01', end_date: '2026-11-02', payments: [{ amount: 400, date: '2026-10-04' }] },
  { customer_name: 'Eve', game_title: 'Onimusha', status: 'done', start_date: '2026-10-02', end_date: '2026-10-09', payments: [{ amount: 900, date: '2026-10-20' }] }
];

const ACCOUNTS = [
  { id: 1, slots: {
    trophy: { enabled: true, status: 'rented' },
    non_trophy: { enabled: true, status: 'open' },
    ps4_primary: { enabled: false, status: 'open' }
  } },
  { id: 2, slots: {
    trophy: { enabled: true, status: 'open' },
    non_trophy: { enabled: true, status: 'buyed' },
    ps4_primary: { enabled: true, status: 'maintenance' }
  } }
];

const REQUESTS = [
  { title: 'New one', status: 'pending', created_at: '2026-11-02T00:00:00.000Z' },
  { title: 'Also new', status: 'approved', created_at: '2026-11-03T00:00:00.000Z' },
  { title: 'Old open', status: 'pending', created_at: '2026-09-01T00:00:00.000Z' },
  { title: 'In stock', status: 'stocked', created_at: '2026-11-01T00:00:00.000Z' },
  { title: 'No thanks', status: 'rejected', created_at: '2026-11-01T00:00:00.000Z' }
];

function build(extra) {
  return today.buildToday(Object.assign({
    now: NOW,
    orders: ORDERS,
    customers: CUSTOMERS,
    accounts: ACCOUNTS,
    requests: REQUESTS,
    loyaltyProfiles: [{ hasReward: true }, { hasReward: false }, { hasReward: true }],
    messageCount: 2,
    traffic: { visitors: 40, messaged: 5, paid: 2, botsFiltered: 11 }
  }, extra || {}));
}

ok('afternoon in Manila is Good afternoon, with the shop clock on the line', () => {
  const t = build();
  assert.strictEqual(t.greeting, 'Good afternoon');
  assert.ok(t.when.line.includes('4 Nov'), t.when.line);
  assert.ok(t.when.line.includes('1:30 PM'), t.when.line);
  assert.ok(t.when.line.includes('Asia/Manila'), t.when.line);
});

ok('morning and evening follow the Manila hour', () => {
  assert.strictEqual(today.buildToday({ now: new Date('2026-11-04T00:15:00.000Z') }).greeting, 'Good morning');
  assert.strictEqual(today.buildToday({ now: new Date('2026-11-04T12:00:00.000Z') }).greeting, 'Good evening');
});

ok('needs-you queues are returns, checkout that stalled, and deposits still held', () => {
  const t = build();
  const q = t.queues;
  assert.strictEqual(q.returns.count, 2);
  assert.strictEqual(q.unpaid.count, 2);
  assert.strictEqual(q.unpaid.over24h, 1);
  assert.strictEqual(q.deposits.count, 1);
  assert.strictEqual(q.deposits.amount, 100);
  assert.ok(!t.lists.returns.map(o => o.ref).includes('PH-NT1'));
  assert.ok(!t.lists.deposits.map(o => o.ref).includes('PH-NT2'));
  assert.ok(!t.lists.deposits.map(o => o.ref).includes('PH-PS0'));
});

ok('a PS4 Primary deposit counts, and a PS4 rental with no deposit does not', () => {
  const t = today.buildToday({
    now: NOW,
    orders: [
      { ref: 'PH-P1', state: 'closed', account_type: 'ps4', deposit_due: 100, deposit_refunded: false },
      { ref: 'PH-P2', state: 'verifying_return', account_type: 'ps4', deposit_due: 100 },
      { ref: 'PH-P3', state: 'awaiting_return', account_type: 'ps4', deposit_due: 0 },
      { ref: 'PH-P4', state: 'closed', account_type: 'nt', deposit_due: 100, deposit_refunded: false }
    ]
  });
  assert.strictEqual(t.queues.returns.count, 1);
  assert.strictEqual(t.lists.returns[0].ref, 'PH-P2');
  assert.strictEqual(t.queues.deposits.count, 1);
  assert.strictEqual(t.queues.deposits.amount, 100);
  assert.strictEqual(t.kpis.depositsHeld.ready, 1);
  assert.strictEqual(t.kpis.depositsHeld.amount, 200);
});

ok('a Quick Add the owner recorded is not an unpaid checkout', () => {
  const refs = build().lists.unpaid.map(o => o.ref);
  assert.ok(!refs.includes('PH-0200'));
  assert.ok(refs.includes('PH-0313'));
});

ok('the waitlist is not a Today queue', () => {
  const t = build();
  assert.ok(!t.queues.waitlist);
  assert.ok(t.omitted.includes('waitlist'));
  assert.strictEqual(t.needsYouCount, 3);
});

ok('loyalty, messages and open requests are to review', () => {
  const t = build();
  assert.strictEqual(t.queues.loyalty.count, 2);
  assert.strictEqual(t.queues.messages.count, 2);
  assert.strictEqual(t.queues.requests.count, 3);
  assert.strictEqual(t.queues.requests.newer, 2);
  assert.strictEqual(t.queues.requests.stocked, 1);
  assert.strictEqual(t.toReviewCount, 3);
  assert.ok(t.headline.includes('3 queues need you now'));
  assert.ok(t.headline.includes('3 to review'));
});

ok('an empty board says nothing needs you', () => {
  const t = today.buildToday({ now: NOW, orders: [], customers: [], accounts: [], requests: [] });
  assert.strictEqual(t.needsYouCount, 0);
  assert.strictEqual(t.toReviewCount, 0);
  assert.strictEqual(t.headline, 'Nothing needs you right now');
});

ok('one queue is singular', () => {
  const t = today.buildToday({
    now: NOW,
    orders: [{ ref: 'PH-1', state: 'awaiting_payment', created_at: '2026-11-04T05:00:00.000Z', fb_name: 'A', game_title: 'G' }]
  });
  assert.strictEqual(t.headline, '1 queue needs you now');
});

ok('collected is this month so far, compared with the same days last month', () => {
  const c = build().kpis.collected;
  assert.strictEqual(c.total, 800);
  assert.strictEqual(c.prior, 400);
  assert.strictEqual(c.fromDay, 1);
  assert.strictEqual(c.toDay, 4);
  assert.strictEqual(c.monthLabel, 'Nov');
});

ok('out on rent counts live rentals, ones ending within 3 days, and overdue ones', () => {
  const o = build().kpis.outOnRent;
  assert.strictEqual(o.count, 3);
  assert.strictEqual(o.endingSoon, 1);
  assert.strictEqual(o.overdue, 1);
});

ok('slots in use skip a Reserved state and disabled slots', () => {
  const s = build().kpis.slots;
  assert.strictEqual(s.filled, 2);
  assert.strictEqual(s.total, 5);
  assert.strictEqual(s.open, 2);
  assert.strictEqual(s.reserved, undefined);
  assert.ok(build().omitted.includes('reserved-slot'));
});

ok('deposits held follow the dashboard rule, and the refund queue is the closed ones', () => {
  const d = build().kpis.depositsHeld;
  assert.ok(d.amount >= 100);
  assert.strictEqual(d.ready, 1);
  assert.strictEqual(d.readyAmount, 100);
});

ok('recent activity uses plain words and skips the opening unpaid row', () => {
  const rows = build().activity;
  const signed = rows.find(r => r.ref === 'PH-0310');
  assert.ok(signed);
  assert.strictEqual(signed.badge.label, 'Signed in');
  const ended = rows.find(r => r.ref === 'PH-0281');
  assert.strictEqual(ended.badge.label, 'Ended');
  const cancelled = rows.find(r => r.ref === 'PH-0091');
  assert.strictEqual(cancelled.badge.label, 'Cancelled');
  assert.ok(rows.every(r => r.badge.label !== 'awaiting_payment'));
});

ok('most rented this month is counted from rentals that started in November', () => {
  const top = build().topRented;
  assert.strictEqual(top[0][0], 'Call of Duty');
  assert.strictEqual(top[0][1], 2);
});

ok('shop visit numbers are passed through, and GA4 is marked as not available', () => {
  const t = build();
  assert.strictEqual(t.traffic.visitors, 40);
  assert.strictEqual(t.traffic.messaged, 5);
  assert.strictEqual(t.traffic.paid, 2);
  assert.strictEqual(t.traffic.botsFiltered, 11);
  assert.strictEqual(t.traffic.source, 'shop');
  assert.ok(t.omitted.includes('ga4'));
  assert.ok(!t.omitted.includes('psplus-expiry'));
  assert.ok(t.omitted.includes('waitlist'));
  assert.ok(t.omitted.includes('reserved-slot'));
  assert.strictEqual(t.psplusExpiring.count, 0);
});

ok('PS Plus expiry lists only saved dates, and only when they are due', () => {
  const t = build({ accounts: [
    { id: 7, label: 'Account #07', psplus_expires: '2026-11-06' },
    { id: 8, label: 'Later', psplus_expires: '2026-12-01' },
    { id: 9, label: 'Blank', psplus_expires: '' },
    { id: 10, label: 'No field' },
    { id: 11, label: 'Yesterday', psplus_expires: '2026-11-03' },
    { id: 12, label: 'Bad', psplus_expires: 'soon' }
  ]});
  assert.strictEqual(t.psplusExpiring.count, 2);
  assert.strictEqual(t.psplusExpiring.soonest.label, 'Yesterday');
  assert.strictEqual(t.psplusExpiring.soonest.when, '1 day ago');
  assert.strictEqual(t.psplusExpiring.items[1].label, 'Account #07');
  assert.strictEqual(t.psplusExpiring.items[1].when, 'in 2 days');
  assert.strictEqual(today.cleanPsplusExpiry('2026-02-31'), '');
  assert.strictEqual(today.cleanPsplusExpiry(''), '');
});

ok('missing traffic is a later-update placeholder, not a zero pretending to be GA4', () => {
  const t = build({ traffic: null });
  assert.strictEqual(t.traffic, null);
});

console.log('\n' + passed + ' assertions passed\n');
