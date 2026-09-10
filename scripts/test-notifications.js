// Run: node scripts/test-notifications.js
const assert = require('assert');
const n = require('../lib/notifications');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const NOW = new Date('2026-09-10T12:00:00Z');
const empty = { orderQueue: [], needsReminder: [], unlinkedRentals: [], refundsOwed: [], reviewQueue: [], paymongoHealth: null, now: NOW };

console.log('\nbuild() — empty and defensive');

ok('nothing to do returns an empty list', () => {
  const r = n.build(empty);
  assert.deepStrictEqual(r.items, []);
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.criticalCount, 0);
});

ok('missing inputs do not throw', () => {
  const r = n.build({});
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.criticalCount, 0);
});

ok('null entries inside a list are skipped', () => {
  const r = n.build(Object.assign({}, empty, { orderQueue: [null, undefined] }));
  assert.strictEqual(r.count, 0);
});

console.log('\nbuild() — order queue');

ok('a sign-in code awaiting send is critical and carries its expiry', () => {
  const r = n.build(Object.assign({}, empty, {
    orderQueue: [{ ref: 'PH-1', state: 'qr_pending', fb_name: 'Ana', game_title: 'Elden Ring', qr_expires_at: '2026-09-10T12:07:00Z' }]
  }));
  assert.strictEqual(r.items.length, 1);
  const it = r.items[0];
  assert.strictEqual(it.kind, 'qr_pending');
  assert.strictEqual(it.urgency, 'critical');
  assert.strictEqual(it.tab, 'orders');
  assert.strictEqual(it.ref, 'PH-1');
  assert.strictEqual(it.expiresAt, '2026-09-10T12:07:00Z');
  assert.ok(it.sub.includes('Ana'), 'names the customer: ' + it.sub);
  assert.ok(it.sub.includes('Elden Ring'), 'names the game: ' + it.sub);
});

ok('a payment awaiting approval is critical and shows the amount owed', () => {
  const r = n.build(Object.assign({}, empty, {
    orderQueue: [{ ref: 'PH-2', state: 'verifying_payment', fb_name: 'Ben', game_title: 'GT7', amount_due: 150, deposit_due: 50 }]
  }));
  assert.strictEqual(r.items[0].urgency, 'critical');
  assert.ok(r.items[0].sub.includes('200'), 'amount_due + deposit_due: ' + r.items[0].sub);
});

ok('a paypal order shows the fee-inclusive total it actually asked for', () => {
  const r = n.build(Object.assign({}, empty, {
    orderQueue: [{ ref: 'PH-3', state: 'verifying_payment', payment_method: 'paypal', amount_due: 150, deposit_due: 50, paypal_expected: 232 }]
  }));
  assert.ok(r.items[0].sub.includes('232'), 'uses paypal_expected: ' + r.items[0].sub);
  assert.ok(!r.items[0].sub.includes('200'), 'not the peso figure nobody was asked for');
});

ok('a return awaiting check is a warning, not critical', () => {
  const r = n.build(Object.assign({}, empty, {
    orderQueue: [{ ref: 'PH-4', state: 'verifying_return', fb_name: 'Cara' }]
  }));
  assert.strictEqual(r.items[0].urgency, 'warn');
  assert.strictEqual(r.items[0].kind, 'verifying_return');
});

ok('an unknown order state is ignored rather than rendered blank', () => {
  const r = n.build(Object.assign({}, empty, { orderQueue: [{ ref: 'PH-5', state: 'active' }] }));
  assert.strictEqual(r.count, 0);
});

console.log('\nbuild() — rentals due back');

ok('overdue is critical and says how many days', () => {
  const r = n.build(Object.assign({}, empty, {
    needsReminder: [{ dl: -3, kind: 'expiry_overdue', overdueBy: 3, c: { customer_name: 'Dee', game_title: 'FIFA' } }]
  }));
  assert.strictEqual(r.items[0].urgency, 'critical');
  assert.strictEqual(r.items[0].tab, 'customers');
  assert.ok(r.items[0].title.includes('3 day'), 'says the overdue span: ' + r.items[0].title);
});

ok('due today warns, due tomorrow only informs', () => {
  const r = n.build(Object.assign({}, empty, {
    needsReminder: [
      { dl: 0, kind: 'expiry_today', c: { customer_name: 'Eve' } },
      { dl: 1, kind: 'expiry_tomorrow', c: { customer_name: 'Fay' } }
    ]
  }));
  const today = r.items.find(i => i.kind === 'expiry_today');
  const tomorrow = r.items.find(i => i.kind === 'expiry_tomorrow');
  assert.strictEqual(today.urgency, 'warn');
  assert.strictEqual(tomorrow.urgency, 'info');
});

console.log('\nbuild() — data integrity and money');

ok('a rental with no slot warns, because the site still advertises it free', () => {
  const r = n.build(Object.assign({}, empty, {
    unlinkedRentals: [{ id: 9, customer_name: 'Gus', game_title: 'Onimusha' }]
  }));
  assert.strictEqual(r.items[0].kind, 'no_slot');
  assert.strictEqual(r.items[0].urgency, 'warn');
  assert.strictEqual(r.items[0].tab, 'customers');
});

ok('a deposit owed back warns and names the amount', () => {
  const r = n.build(Object.assign({}, empty, {
    refundsOwed: [{ ref: 'PH-6', fb_name: 'Hana', deposit_due: 100 }]
  }));
  assert.strictEqual(r.items[0].kind, 'refund_owed');
  assert.ok(r.items[0].sub.includes('100'));
});

ok('review asks collapse into one row, not one per person', () => {
  const r = n.build(Object.assign({}, empty, {
    reviewQueue: [{ status: 'todo' }, { status: 'todo' }, { status: 'asked' }, { status: 'reviewed' }]
  }));
  const rows = r.items.filter(i => i.kind === 'review_todo');
  assert.strictEqual(rows.length, 1, 'one grouped row');
  assert.ok(rows[0].title.includes('2'), 'counts only todo: ' + rows[0].title);
  assert.strictEqual(rows[0].urgency, 'info');
});

ok('no review row when nobody is waiting to be asked', () => {
  const r = n.build(Object.assign({}, empty, { reviewQueue: [{ status: 'asked' }] }));
  assert.strictEqual(r.count, 0);
});

console.log('\nbuild() — gateway health');

ok('a webhook failure newer than the last success is critical', () => {
  const r = n.build(Object.assign({}, empty, {
    paymongoHealth: { fail_count: 2, ok_count: 5, last_fail_at: '2026-09-10T11:00:00Z', last_ok_at: '2026-09-09T10:00:00Z' }
  }));
  assert.strictEqual(r.items[0].kind, 'webhook_broken');
  assert.strictEqual(r.items[0].urgency, 'critical');
});

ok('old failures that a later success cleared are history, not an alert', () => {
  const r = n.build(Object.assign({}, empty, {
    paymongoHealth: { fail_count: 2, ok_count: 5, last_fail_at: '2026-09-08T10:00:00Z', last_ok_at: '2026-09-10T11:00:00Z' }
  }));
  assert.strictEqual(r.count, 0);
});

console.log('\nbuild() — ordering and counts');

ok('critical first, then warn, then info', () => {
  const r = n.build(Object.assign({}, empty, {
    reviewQueue: [{ status: 'todo' }],
    unlinkedRentals: [{ id: 1, customer_name: 'Ivy' }],
    orderQueue: [{ ref: 'PH-7', state: 'qr_pending', qr_expires_at: '2026-09-10T12:05:00Z' }]
  }));
  assert.deepStrictEqual(r.items.map(i => i.urgency), ['critical', 'warn', 'info']);
});

ok('within critical, the soonest-expiring sign-in code sorts above a payment', () => {
  const r = n.build(Object.assign({}, empty, {
    orderQueue: [
      { ref: 'PH-8', state: 'verifying_payment' },
      { ref: 'PH-9', state: 'qr_pending', qr_expires_at: '2026-09-10T12:02:00Z' }
    ]
  }));
  assert.strictEqual(r.items[0].ref, 'PH-9', 'the one on a clock goes first');
});

ok('count is every item; criticalCount is only the critical ones', () => {
  const r = n.build(Object.assign({}, empty, {
    orderQueue: [{ ref: 'PH-10', state: 'verifying_payment' }, { ref: 'PH-11', state: 'verifying_return' }],
    needsReminder: [{ dl: 1, kind: 'expiry_tomorrow', c: { customer_name: 'Jo' } }]
  }));
  assert.strictEqual(r.count, 3);
  assert.strictEqual(r.criticalCount, 1);
});

ok('every item carries the fields the bell renders', () => {
  const r = n.build(Object.assign({}, empty, {
    orderQueue: [{ ref: 'PH-12', state: 'verifying_payment', fb_name: 'Kit' }],
    needsReminder: [{ dl: -1, kind: 'expiry_overdue', overdueBy: 1, c: { customer_name: 'Lee' } }],
    unlinkedRentals: [{ id: 2, customer_name: 'Mo' }],
    refundsOwed: [{ ref: 'PH-13', deposit_due: 50 }],
    reviewQueue: [{ status: 'todo' }]
  }));
  assert.strictEqual(r.items.length, 5);
  r.items.forEach(it => {
    ['id', 'kind', 'urgency', 'icon', 'title', 'sub', 'tab'].forEach(f => {
      assert.ok(it[f] !== undefined && it[f] !== '', it.kind + ' is missing ' + f);
    });
    assert.ok(['critical', 'warn', 'info'].includes(it.urgency), 'valid urgency');
  });
});

ok('ids are unique so the panel can key its rows', () => {
  const r = n.build(Object.assign({}, empty, {
    orderQueue: [{ ref: 'PH-14', state: 'verifying_payment' }, { ref: 'PH-15', state: 'verifying_payment' }],
    unlinkedRentals: [{ id: 3, customer_name: 'Nel' }, { id: 4, customer_name: 'Ora' }]
  }));
  const ids = r.items.map(i => i.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate ids: ' + ids.join(','));
});

ok('a missing name never renders the word undefined', () => {
  const r = n.build(Object.assign({}, empty, {
    orderQueue: [{ ref: 'PH-16', state: 'verifying_payment' }],
    unlinkedRentals: [{ id: 5 }]
  }));
  r.items.forEach(it => {
    assert.ok(!/undefined|null|NaN/.test(it.title + ' ' + it.sub), 'clean text: ' + it.title + ' / ' + it.sub);
  });
});

console.log('\nbuild() — unhappy customers');

ok('a thumbs-down review that is not handled yet is critical', () => {
  const r = n.build(Object.assign({}, empty, {
    negativeReviews: [{ id: 3, name: 'Pia', game_rented: 'GT7', order_ref: 'PH-20', text: 'Slow reply.' }]
  }));
  assert.strictEqual(r.items[0].kind, 'unhappy_customer');
  assert.strictEqual(r.items[0].urgency, 'critical');
  assert.strictEqual(r.items[0].tab, 'content');
  assert.ok(r.items[0].sub.includes('Pia'), 'names them: ' + r.items[0].sub);
});

ok('a thumbs down with no comment still raises a row', () => {
  const r = n.build(Object.assign({}, empty, { negativeReviews: [{ id: 4, name: 'Rex' }] }));
  assert.strictEqual(r.count, 1);
  assert.ok(!/undefined|null/.test(r.items[0].sub), 'clean: ' + r.items[0].sub);
});

ok('an unhappy customer outranks a waiting payment', () => {
  // Someone who told us it went badly is the most perishable thing on the
  // list: every hour that passes makes it harder to put right.
  const r = n.build(Object.assign({}, empty, {
    orderQueue: [{ ref: 'PH-21', state: 'verifying_payment' }],
    negativeReviews: [{ id: 5, name: 'Sam' }]
  }));
  assert.strictEqual(r.items[0].kind, 'unhappy_customer');
});

ok('nothing is raised when there are no negative reviews', () => {
  assert.strictEqual(n.build(Object.assign({}, empty, { negativeReviews: [] })).count, 0);
  assert.strictEqual(n.build(Object.assign({}, empty, { negativeReviews: null })).count, 0);
});

console.log('\nbuild() — orphaned orders');

ok('an order with no customer record is a warning, tab orders', () => {
  const r = n.build(Object.assign({}, empty, {
    orphanedOrders: [{ ref: 'PH-0080', fb_name: 'Luis Mallari', game_title: 'NBA2K27', amount_due: 399, deposit_due: 0, state: 'active' }]
  }));
  assert.strictEqual(r.items.length, 1);
  const it = r.items[0];
  assert.strictEqual(it.kind, 'orphaned_order');
  assert.strictEqual(it.urgency, 'warn');
  assert.strictEqual(it.tab, 'orders');
  assert.strictEqual(it.ref, 'PH-0080');
  assert.ok(it.sub.includes('Luis Mallari'), 'names the customer: ' + it.sub);
  assert.ok(it.sub.includes('399'), 'names the money still counted: ' + it.sub);
});

ok('the deposit counts toward the money still on the books', () => {
  const r = n.build(Object.assign({}, empty, {
    orphanedOrders: [{ ref: 'PH-9', amount_due: 200, deposit_due: 100, state: 'closed' }]
  }));
  assert.ok(r.items[0].sub.includes('300'), 'amount_due + deposit_due: ' + r.items[0].sub);
});

ok('a thin orphan record never renders undefined', () => {
  const r = n.build(Object.assign({}, empty, { orphanedOrders: [{ ref: 'PH-1' }] }));
  assert.strictEqual(r.count, 1);
  assert.ok(!/undefined|null|NaN/.test(r.items[0].title + ' ' + r.items[0].sub), r.items[0].sub);
});

ok('each orphan gets its own row with a unique id', () => {
  const r = n.build(Object.assign({}, empty, {
    orphanedOrders: [{ ref: 'PH-1', state: 'active' }, { ref: 'PH-2', state: 'active' }]
  }));
  assert.strictEqual(r.items.length, 2);
  assert.notStrictEqual(r.items[0].id, r.items[1].id);
});

ok('nothing is raised when there are no orphans', () => {
  assert.strictEqual(n.build(Object.assign({}, empty, { orphanedOrders: [] })).count, 0);
  assert.strictEqual(n.build(Object.assign({}, empty, { orphanedOrders: null })).count, 0);
  assert.strictEqual(n.build(Object.assign({}, empty, { orphanedOrders: [null] })).count, 0);
});

ok('an orphan sorts below a real payment to approve but is still listed', () => {
  const r = n.build(Object.assign({}, empty, {
    orderQueue: [{ ref: 'PH-5', state: 'verifying_payment' }],
    orphanedOrders: [{ ref: 'PH-0080', state: 'active', amount_due: 399 }]
  }));
  assert.strictEqual(r.items[0].kind, 'verifying_payment');
  assert.strictEqual(r.items[1].kind, 'orphaned_order');
});

console.log('\nbuild() — purchases wrongly filed as rentals');

ok('a bought order still carrying an end date is a warning', () => {
  const r = n.build(Object.assign({}, empty, {
    boughtWithDuration: [{ ref: 'PH-0091', fb_name: 'Walid', game_title: 'Onimusha', end_date: '2026-09-18', days: 7 }]
  }));
  assert.strictEqual(r.items.length, 1);
  const it = r.items[0];
  assert.strictEqual(it.kind, 'bought_with_duration');
  assert.strictEqual(it.urgency, 'warn');
  assert.strictEqual(it.tab, 'customers');
  assert.strictEqual(it.ref, 'PH-0091');
  assert.ok(it.sub.includes('Walid'), 'names them: ' + it.sub);
  assert.ok(/return/i.test(it.title + ' ' + it.sub), 'says what goes wrong: ' + it.title + ' / ' + it.sub);
});

ok('a thin record never renders undefined', () => {
  const r = n.build(Object.assign({}, empty, { boughtWithDuration: [{ ref: 'PH-1' }] }));
  assert.strictEqual(r.count, 1);
  assert.ok(!/undefined|null|NaN/.test(r.items[0].title + ' ' + r.items[0].sub), r.items[0].sub);
});

ok('one row per affected purchase, unique ids', () => {
  const r = n.build(Object.assign({}, empty, {
    boughtWithDuration: [{ ref: 'PH-1' }, { ref: 'PH-2' }]
  }));
  assert.strictEqual(r.items.length, 2);
  assert.notStrictEqual(r.items[0].id, r.items[1].id);
});

ok('nothing is raised when every purchase is filed correctly', () => {
  assert.strictEqual(n.build(Object.assign({}, empty, { boughtWithDuration: [] })).count, 0);
  assert.strictEqual(n.build(Object.assign({}, empty, { boughtWithDuration: null })).count, 0);
  assert.strictEqual(n.build(Object.assign({}, empty, { boughtWithDuration: [null] })).count, 0);
});

console.log('\n' + passed + ' assertions passed\n');
