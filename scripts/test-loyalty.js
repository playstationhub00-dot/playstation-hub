// Run: node scripts/test-loyalty.js
//
// Loyalty offers are computed from the rental ledger, not stored as a second
// copy of who rented what. These cases pin that computation: which rows count,
// how punches and the rebook window add up, and how a redemption or a name
// link changes what the admin sees. No server, no database.
const assert = require('assert');
const L = require('../lib/loyalty');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

function rental(partial) {
  return Object.assign({
    id: 1,
    customer_name: 'Ana Cruz',
    game_title: 'Astro Bot',
    account_type: 'nt',
    status: 'done',
    start_date: '2026-01-01',
    end_date: '2026-01-08',
    price: 199,
    payments: [{ amount: 199, date: '2026-01-01', kind: 'rental' }],
    order_ref: ''
  }, partial);
}

function five(name) {
  return [1, 2, 3, 4, 5].map(n => rental({
    id: n,
    customer_name: name || 'Ana Cruz',
    game_title: 'Game ' + n,
    start_date: '2026-0' + n + '-01',
    end_date: '2026-0' + n + '-08',
    order_ref: 'PH-000' + n
  }));
}

const emptyId = { aliases: {}, rows: {} };

console.log('\nnames and dates');

ok('names match with case and extra whitespace folded', () => {
  assert.strictEqual(L.normalizeName('  Ana   CRUZ '), 'ana cruz');
  assert.strictEqual(L.normalizeName(null), '');
});

ok('a UTC evening is already the next day in Manila', () => {
  assert.strictEqual(L.manilaToday(new Date('2026-10-13T20:00:00.000Z')), '2026-10-14');
});

ok('calendar dates add and subtract without a timezone shift', () => {
  assert.strictEqual(L.addDays('2026-10-01', 7), '2026-10-08');
  assert.strictEqual(L.daysBetween('2026-10-01', '2026-10-08'), 7);
  assert.strictEqual(L.formatYmd('2026-10-08'), 'Oct 8, 2026');
});

ok('a timestamp prints in Asia/Manila', () => {
  assert.strictEqual(L.formatManila('2026-10-13T16:30:00.000Z'), 'Oct 14, 2026, 12:30 AM');
});

console.log('\nwhat counts as a paid rental');

ok('an explicit empty payments list is unpaid even when price is set', () => {
  const built = L.build([rental({ payments: [], price: 199 })], { today: '2026-10-14' });
  assert.strictEqual(built.profiles.length, 0);
});

ok('a legacy row with a price and no payments array counts as paid', () => {
  const row = rental({ payments: undefined, price: 199 });
  delete row.payments;
  const built = L.build([row], { today: '2026-10-14' });
  assert.strictEqual(built.profiles[0].rentalCount, 1);
});

ok('a purchase and a reservation do not earn a punch', () => {
  const built = L.build([
    rental({ id: 1, status: 'bought', payments: [{ amount: 999, date: '2026-01-01', kind: 'purchase' }] }),
    rental({ id: 2, status: 'reservation', payments: [{ amount: 100, date: '2026-01-01', kind: 'reservation' }] })
  ], { today: '2026-10-14' });
  assert.strictEqual(built.profiles.length, 0);
});

ok('a price that was adjusted back to zero is not a paid rental', () => {
  const built = L.build([
    rental({ payments: [{ amount: 199, date: '2026-01-01', kind: 'rental' }, { amount: -199, date: '2026-01-02', kind: 'adjustment' }] })
  ], { today: '2026-10-14' });
  assert.strictEqual(built.profiles.length, 0);
});

ok('an extension is the same rental, not a second punch', () => {
  const built = L.build([
    rental({ payments: [
      { amount: 199, date: '2026-01-01', kind: 'rental' },
      { amount: 199, date: '2026-01-08', kind: 'extension' }
    ] })
  ], { today: '2026-10-14' });
  assert.strictEqual(built.profiles[0].rentalCount, 1);
  assert.strictEqual(built.profiles[0].punches, 1);
});

ok('refunding an extension leaves the punch; cancelling the rental removes it', () => {
  const extended = L.build([
    rental({ status: 'renting', payments: [
      { amount: 619, date: '2026-09-27', kind: 'rental' },
      { amount: 819, date: '2026-10-01', kind: 'extension' },
      { amount: -819, date: '2026-10-25', kind: 'refund' }
    ] })
  ], { today: '2026-10-25' });
  assert.strictEqual(extended.profiles[0].punches, 1);
  const cancelled = L.build([
    rental({ status: 'cancelled', payments: [
      { amount: 1438, date: '2026-09-27', kind: 'rental' },
      { amount: -819, date: '2026-10-25', kind: 'refund' }
    ] }),
    rental({ id: 2, status: 'refunded', payments: [
      { amount: 199, date: '2026-02-01', kind: 'rental' },
      { amount: -199, date: '2026-02-02', kind: 'refund' }
    ] })
  ], { today: '2026-10-25' });
  assert.strictEqual(cancelled.profiles.length, 0);
});

console.log('\npunch card');

ok('every 5th paid rental earns one free 7-day rental, then progress resets', () => {
  const built = L.build(five(), { today: '2026-10-14' });
  const p = built.profiles[0];
  assert.strictEqual(p.rentalCount, 5);
  assert.strictEqual(p.punches, 5);
  assert.strictEqual(p.progress, 0);
  assert.strictEqual(p.every, 5);
  assert.strictEqual(p.toNext, 5);
  assert.strictEqual(p.earned, 1);
  assert.strictEqual(p.availablePunch, 1);
  assert.strictEqual(p.redeemedPunch, 0);
  assert.strictEqual(p.hasReward, true);
  assert.strictEqual(p.settings.reward_days, 7);
});

ok('the 6th rental is one punch toward the next reward', () => {
  const rows = five().concat([rental({ id: 6, start_date: '2026-06-01', end_date: '2026-06-08' })]);
  const p = L.build(rows, { today: '2026-10-14' }).profiles[0];
  assert.strictEqual(p.punches, 6);
  assert.strictEqual(p.progress, 1);
  assert.strictEqual(p.toNext, 4);
  assert.strictEqual(p.earned, 1);
  assert.strictEqual(p.availablePunch, 1);
});

ok('case and whitespace differences are already the same customer', () => {
  const rows = [
    rental({ id: 1, customer_name: 'Ana Cruz', start_date: '2026-01-01' }),
    rental({ id: 2, customer_name: ' ana   cruz ', start_date: '2026-02-01' })
  ];
  const built = L.build(rows, { today: '2026-10-14' });
  assert.strictEqual(built.profiles.length, 1);
  assert.strictEqual(built.profiles[0].rentalCount, 2);
  assert.strictEqual(built.profiles[0].name, 'Ana Cruz');
});

ok('a trophy rental counts as two punches only when that offer is on', () => {
  const rows = [1, 2, 3].map(n => rental({
    id: n, customer_name: 'Ben Uy', account_type: 'tr',
    start_date: '2026-0' + n + '-02', end_date: '2026-0' + n + '-09'
  }));
  const off = L.build(rows, { today: '2026-10-14' }).profiles[0];
  assert.strictEqual(off.punches, 3);
  assert.strictEqual(off.earned, 0);
  assert.strictEqual(off.hasReward, false);
  const on = L.build(rows, {
    today: '2026-10-14',
    settings: Object.assign({}, L.DEFAULT_SETTINGS, { trophy_double: true })
  }).profiles[0];
  assert.strictEqual(on.punches, 6);
  assert.strictEqual(on.earned, 1);
  assert.strictEqual(on.progress, 1);
  assert.strictEqual(on.hasReward, true);
});

ok('PS4 primary stays one punch when trophy rentals count double', () => {
  const p = L.build([rental({ account_type: 'ps4' })], {
    today: '2026-10-14',
    settings: Object.assign({}, L.DEFAULT_SETTINGS, { trophy_double: true })
  }).profiles[0];
  assert.strictEqual(p.punches, 1);
});

ok('with the punch card switched off, nobody has a punch reward available', () => {
  const p = L.build(five(), {
    today: '2026-10-14',
    settings: Object.assign({}, L.DEFAULT_SETTINGS, { punch_enabled: false })
  }).profiles[0];
  assert.strictEqual(p.earned, 1);
  assert.strictEqual(p.availablePunch, 0);
  assert.strictEqual(p.hasReward, false);
});

console.log('\nrebook discount');

ok('a customer is eligible for 7 days after their last rental ends', () => {
  const p = L.build([
    rental({ id: 1, end_date: '2026-10-01', start_date: '2026-09-24' })
  ], { today: '2026-10-04' }).profiles[0];
  assert.strictEqual(p.rebook.eligible, true);
  assert.strictEqual(p.rebook.expires, '2026-10-08');
  assert.strictEqual(p.rebook.amount, 50);
  assert.strictEqual(p.hasReward, true);
});

ok('the day the window closes is still eligible, the next day is not', () => {
  const row = [rental({ id: 1, end_date: '2026-10-01', start_date: '2026-09-24' })];
  assert.strictEqual(L.build(row, { today: '2026-10-08' }).profiles[0].rebook.eligible, true);
  assert.strictEqual(L.build(row, { today: '2026-10-09' }).profiles[0].rebook.eligible, false);
});

ok('starting a new rental inside the window earns the discount on that rental', () => {
  const p = L.build([
    rental({ id: 1, start_date: '2026-09-24', end_date: '2026-10-01', game_title: 'Old' }),
    rental({ id: 2, start_date: '2026-10-03', end_date: '2026-10-10', game_title: 'New', status: 'renting' })
  ], { today: '2026-10-04' }).profiles[0];
  assert.strictEqual(p.rebook.eligible, false);
  assert.strictEqual(p.rebook.unredeemed, 1);
  assert.strictEqual(p.rebook.opportunities[0].key, '1->2');
  assert.strictEqual(p.rebook.opportunities[0].rental_id, 2);
  assert.strictEqual(p.hasReward, true);
});

ok('eight days later is too late, and overlapping the previous rental does not count', () => {
  const late = L.build([
    rental({ id: 1, start_date: '2026-09-01', end_date: '2026-09-08' }),
    rental({ id: 2, start_date: '2026-09-16', end_date: '2026-09-23' })
  ], { today: '2026-10-01' }).profiles[0];
  assert.strictEqual(late.rebook.unredeemed, 0);
  assert.strictEqual(late.rebook.eligible, false);
  const overlap = L.build([
    rental({ id: 1, start_date: '2026-09-01', end_date: '2026-09-20' }),
    rental({ id: 2, start_date: '2026-09-10', end_date: '2026-09-17' })
  ], { today: '2026-09-12' }).profiles[0];
  assert.strictEqual(overlap.rebook.unredeemed, 0);
  assert.ok(!overlap.rebook.opportunities.some(o => o.key === '1->2'));
});

ok('with the rebook offer switched off, the window is not a reward', () => {
  const p = L.build([
    rental({ id: 1, end_date: '2026-10-01', start_date: '2026-09-24' })
  ], {
    today: '2026-10-04',
    settings: Object.assign({}, L.DEFAULT_SETTINGS, { rebook_enabled: false })
  }).profiles[0];
  assert.strictEqual(p.rebook.eligible, false);
  assert.strictEqual(p.hasReward, false);
});

console.log('\nredeeming');

ok('marking a punch reward redeemed records who, when, which rental, and the amount', () => {
  const built = L.build(five(), { today: '2026-10-14' });
  const plan = L.planRedemption(built.profiles[0], {
    choice: 'punch:1',
    rental_id: '5',
    order_ref: 'PH-0005',
    amount: '0',
    note: 'free week'
  }, '2026-10-14T02:00:00.000Z');
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.record.by, 'admin');
  assert.strictEqual(plan.record.at, '2026-10-14T02:00:00.000Z');
  assert.strictEqual(plan.record.rental_id, 5);
  assert.strictEqual(plan.record.order_ref, 'PH-0005');
  assert.strictEqual(plan.record.amount, 0);
  assert.strictEqual(plan.record.days, 7);
  assert.strictEqual(plan.record.kind, 'punch');
  assert.strictEqual(plan.record.note, 'free week');
  const after = L.build(five(), { today: '2026-10-14', redemptions: [plan.record] }).profiles[0];
  assert.strictEqual(after.availablePunch, 0);
  assert.strictEqual(after.redeemedPunch, 1);
  assert.strictEqual(after.hasReward, false);
  assert.strictEqual(after.redemptions.length, 1);
});

ok('the same punch reward cannot be redeemed twice, and a reward needs a rental or an order', () => {
  const built = L.build(five(), { today: '2026-10-14' });
  const first = L.planRedemption(built.profiles[0], { choice: 'punch:1', rental_id: '5' }, '2026-10-14T02:00:00.000Z');
  const again = L.build(five(), { today: '2026-10-14', redemptions: [first.record] });
  const second = L.planRedemption(again.profiles[0], { choice: 'punch:1', rental_id: '5' }, '2026-10-14T03:00:00.000Z');
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.error, 'already');
  const bare = L.planRedemption(built.profiles[0], { choice: 'punch:1' }, '2026-10-14T02:00:00.000Z');
  assert.strictEqual(bare.ok, false);
  assert.strictEqual(bare.error, 'need_target');
});

ok('a rebook discount redeems once against the rental that earned it', () => {
  const rows = [
    rental({ id: 1, start_date: '2026-09-24', end_date: '2026-10-01' }),
    rental({ id: 2, start_date: '2026-10-03', end_date: '2026-10-10', status: 'renting', order_ref: 'PH-0099' })
  ];
  const before = L.build(rows, { today: '2026-10-04' }).profiles[0];
  const plan = L.planRedemption(before, { choice: 'rebook:1->2', order_ref: 'PH-0099' }, '2026-10-04T04:00:00.000Z');
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.record.kind, 'rebook');
  assert.strictEqual(plan.record.amount, 50);
  assert.strictEqual(plan.record.opportunity_key, '1->2');
  const after = L.build(rows, { today: '2026-10-04', redemptions: [plan.record] }).profiles[0];
  assert.strictEqual(after.rebook.unredeemed, 0);
  assert.strictEqual(after.hasReward, false);
});

ok('redeeming the open window uses it up, so the rental they start next is not a second discount', () => {
  const first = [rental({ id: 1, start_date: '2026-09-24', end_date: '2026-10-01' })];
  const open = L.build(first, { today: '2026-10-04' }).profiles[0];
  const plan = L.planRedemption(open, { choice: 'rebook:open:1', order_ref: 'PH-0100' }, '2026-10-04T04:00:00.000Z');
  assert.strictEqual(plan.ok, true);
  const later = first.concat([rental({ id: 2, start_date: '2026-10-05', end_date: '2026-10-12', status: 'renting' })]);
  const after = L.build(later, { today: '2026-10-06', redemptions: [plan.record] }).profiles[0];
  assert.strictEqual(after.rebook.unredeemed, 0);
  assert.strictEqual(after.rebook.eligible, false);
});

ok('a free follow-up rental with no payment does not itself earn a punch', () => {
  const rows = five().concat([rental({
    id: 9, start_date: '2026-07-01', end_date: '2026-07-08', price: 0, payments: [], status: 'renting'
  })]);
  const p = L.build(rows, { today: '2026-10-14' }).profiles[0];
  assert.strictEqual(p.rentalCount, 5);
  assert.ok(p.rows.some(r => r.id === 9));
  const plan = L.planRedemption(p, { choice: 'punch:1', rental_id: '9' }, '2026-10-14T02:00:00.000Z');
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.record.rental_id, 9);
});

console.log('\nlinking names');

ok('merging two spellings adds their rentals together', () => {
  const rows = [
    rental({ id: 1, customer_name: 'Ana Cruz' }),
    rental({ id: 2, customer_name: 'Ana C.', start_date: '2026-02-01', end_date: '2026-02-08' })
  ];
  assert.strictEqual(L.build(rows, { today: '2026-10-14' }).profiles.length, 2);
  const merged = L.mergeNames(emptyId, 'Ana C.', 'Ana Cruz');
  assert.strictEqual(merged.ok, true);
  const built = L.build(rows, { today: '2026-10-14', identity: merged.identity });
  assert.strictEqual(built.profiles.length, 1);
  assert.strictEqual(built.profiles[0].rentalCount, 2);
  assert.strictEqual(built.profiles[0].key, 'ana cruz');
});

ok('linking a name to a customer record joins that name to the record\'s person', () => {
  const rows = [
    rental({ id: 12, customer_name: 'Ana Cruz' }),
    rental({ id: 13, customer_name: 'Ana Cruz PH', start_date: '2026-03-01', end_date: '2026-03-08' })
  ];
  const linked = L.linkNameToRow(emptyId, 'Ana Cruz PH', 12, rows);
  assert.strictEqual(linked.ok, true);
  const built = L.build(rows, { today: '2026-10-14', identity: linked.identity });
  assert.strictEqual(built.profiles.length, 1);
  assert.strictEqual(built.profiles[0].rentalCount, 2);
  assert.strictEqual(built.byName['ana cruz ph'], built.profiles[0]);
  assert.strictEqual(built.rewardFor({ name: 'ana cruz ph' }), null);
});

ok('pinning one record moves only that record when two people share a name', () => {
  const rows = [
    rental({ id: 1, customer_name: 'Juan' }),
    rental({ id: 2, customer_name: 'Juan', start_date: '2026-02-01', end_date: '2026-02-08' }),
    rental({ id: 3, customer_name: 'Juan Dela Cruz', start_date: '2026-03-01', end_date: '2026-03-08' })
  ];
  const pinned = L.linkRowToName(emptyId, 2, 'Juan Dela Cruz');
  assert.strictEqual(pinned.ok, true);
  const built = L.build(rows, { today: '2026-10-14', identity: pinned.identity });
  const juan = built.profiles.find(p => p.key === 'juan');
  const full = built.profiles.find(p => p.key === 'juan dela cruz');
  assert.strictEqual(juan.rentalCount, 1);
  assert.strictEqual(full.rentalCount, 2);
  assert.deepStrictEqual(full.rowIds.slice().sort(), [2, 3]);
});

ok('a merge that would loop is refused', () => {
  const once = L.mergeNames(emptyId, 'Ana C.', 'Ana Cruz');
  const back = L.mergeNames(once.identity, 'Ana Cruz', 'Ana C.');
  assert.strictEqual(back.ok, false);
});

ok('removing the link splits them again', () => {
  const merged = L.mergeNames(emptyId, 'Ana C.', 'Ana Cruz');
  const undone = L.removeLink(merged.identity, { alias: 'Ana C.' });
  const rows = [
    rental({ id: 1, customer_name: 'Ana Cruz' }),
    rental({ id: 2, customer_name: 'Ana C.', start_date: '2026-02-01' })
  ];
  assert.strictEqual(L.build(rows, { today: '2026-10-14', identity: undone }).profiles.length, 2);
});

console.log('\nbadges and the customer page');

ok('a reward is found by record id or by the name on an order', () => {
  const built = L.build(five(), { today: '2026-10-14' });
  const byId = built.rewardFor({ rowId: 3 });
  const byName = built.rewardFor({ name: '  ANA cruz' });
  assert.ok(byId && /free rental/.test(byId.title));
  assert.strictEqual(byName.title, byId.title);
  assert.strictEqual(built.rewardFor({ name: 'Nobody' }), null);
});

ok('the order page says how close they are, and the expiry when the rebook window is open', () => {
  const punch = L.customerCopy(L.build(five().slice(0, 4), { today: '2026-10-14' }).profiles[0]);
  assert.strictEqual(punch.show, true);
  assert.ok(punch.punchLine.includes("You're 1 rental away from a free 7-day rental"), punch.punchLine);
  assert.strictEqual(punch.rewardLine, '');
  const ready = L.customerCopy(L.build(five(), { today: '2026-10-14' }).profiles[0]);
  assert.ok(/free 7-day rental waiting/.test(ready.rewardLine));
  const rebook = L.customerCopy(L.build([
    rental({ id: 1, end_date: '2026-10-01', start_date: '2026-09-24' })
  ], { today: '2026-10-04' }).profiles[0]);
  assert.ok(rebook.rebookLine.includes('₱50'));
  assert.ok(rebook.rebookLine.includes('Oct 8, 2026'));
});

console.log('\nsettings');

ok('defaults are a punch every 5, a free 7-day rental, and ₱50 within 7 days', () => {
  const s = L.normalizeSettings(undefined);
  assert.strictEqual(s.punch_enabled, true);
  assert.strictEqual(s.punch_every, 5);
  assert.strictEqual(s.reward_days, 7);
  assert.strictEqual(s.rebook_enabled, true);
  assert.strictEqual(s.rebook_amount, 50);
  assert.strictEqual(s.rebook_within_days, 7);
  assert.strictEqual(s.trophy_double, false);
});

ok('the settings form clamps numbers and reads the checkboxes', () => {
  const s = L.settingsFromForm({
    punch_enabled: 'on',
    punch_every: '0',
    reward_days: '14',
    rebook_amount: '75',
    rebook_within_days: '3',
    trophy_double: 'on'
  });
  assert.strictEqual(s.punch_enabled, true);
  assert.strictEqual(s.punch_every, 1);
  assert.strictEqual(s.reward_days, 14);
  assert.strictEqual(s.rebook_enabled, false);
  assert.strictEqual(s.rebook_amount, 75);
  assert.strictEqual(s.rebook_within_days, 3);
  assert.strictEqual(s.trophy_double, true);
});

console.log('\nadding a rental');

ok('the add-rental form describes a new name as 0 punches', () => {
  const s = L.addFormStatus(null, L.DEFAULT_SETTINGS);
  assert.strictEqual(s.known, false);
  assert.strictEqual(s.headline, 'New customer, 0 punches');
  assert.ok(s.lines.indexOf('New customer, 0 punches') >= 0);
  assert.ok(s.lines.some(l => l.includes('0 paid rentals') && l.includes('0/5') && l.includes('free 7-day')));
  assert.ok(s.lines.some(l => /no rebook discount open/i.test(l)));
  assert.deepStrictEqual(s.offers, []);
});

ok('with both offers off, the add form does not talk about punches', () => {
  const s = L.addFormStatus(null, Object.assign({}, L.DEFAULT_SETTINGS, {
    punch_enabled: false, rebook_enabled: false
  }));
  assert.strictEqual(s.headline, 'Loyalty offers are off');
  assert.deepStrictEqual(s.offers, []);
  assert.ok(!s.lines.join(' ').toLowerCase().includes('punch'));
});

ok('the add form shows punches, progress, and an open rebook expiry', () => {
  const built = L.build([
    rental({ id: 1, start_date: '2026-09-24', end_date: '2026-10-01' })
  ], { today: '2026-10-04' });
  const s = L.addFormStatus(built.profiles[0]);
  assert.strictEqual(s.known, true);
  assert.ok(s.lines.some(l => l.includes('1 paid rental') && l.includes('1 punch')));
  assert.ok(s.lines.some(l => l.includes('1/5') && l.includes('free 7-day')));
  assert.ok(s.lines.some(l => l.includes('₱50') && l.includes('Oct 8, 2026')));
  assert.strictEqual(s.offers.length, 1);
  assert.strictEqual(s.offers[0].kind, 'rebook');
  assert.ok(s.offers[0].choice.indexOf('rebook:open:') === 0);
  assert.strictEqual(s.offers[0].amount, 50);
  assert.strictEqual(s.offers[0].expires, '2026-10-08');
});

ok('a finished punch card offers the free rental on the add form', () => {
  const built = L.build(five(), { today: '2026-10-14' });
  const s = L.addFormStatus(built.profiles[0]);
  assert.ok(s.lines.some(l => l.includes('5 paid rentals') && l.includes('5 punches')));
  assert.ok(s.lines.some(l => l.includes('1 free rental available')));
  assert.ok(s.lines.some(l => /no rebook discount open/i.test(l)));
  const punch = s.offers.find(o => o.kind === 'punch');
  assert.ok(punch);
  assert.strictEqual(punch.choice, 'punch:1');
  assert.strictEqual(punch.days, 7);
  assert.ok(!s.offers.some(o => o.kind === 'rebook'));
});

ok('a merged spelling uses the same profile the Loyalty tab would', () => {
  const merged = L.mergeNames(emptyId, 'Ana C.', 'Ana Cruz');
  const built = L.build(five(), { today: '2026-10-14', identity: merged.identity });
  const s = L.addFormStatus(built.profileFor({ name: '  ana   c. ' }));
  assert.strictEqual(s.known, true);
  assert.strictEqual(s.rentalCount, 5);
  assert.ok(s.offers.some(o => o.choice === 'punch:1'));
});

ok('switching the punch card off removes the free rental from the add form', () => {
  const built = L.build(five(), {
    today: '2026-10-14',
    settings: Object.assign({}, L.DEFAULT_SETTINGS, { punch_enabled: false })
  });
  const s = L.addFormStatus(built.profiles[0]);
  assert.ok(!s.offers.some(o => o.kind === 'punch'));
  assert.ok(!s.lines.join(' ').toLowerCase().includes('punch'));
  assert.ok(s.lines.some(l => l.includes('5 paid rentals')));
});

ok('a free 7-day rental zeros a 7-day price and credits that value off a longer one', () => {
  const offer = { kind: 'punch', days: 7, choice: 'punch:1' };
  const week = L.adjustedRent(199, offer, { days: 7, weekValue: 199 });
  assert.strictEqual(week.amountDue, 0);
  assert.strictEqual(week.credited, 199);
  const month = L.adjustedRent(599, offer, { days: 30, weekValue: 199 });
  assert.strictEqual(month.amountDue, 400);
  assert.strictEqual(month.credited, 199);
  const tiny = L.adjustedRent(100, offer, { days: 30, weekValue: 199 });
  assert.strictEqual(tiny.amountDue, 0);
  assert.strictEqual(tiny.credited, 100);
});

ok('the rebook discount subtracts ₱50 and never goes below zero', () => {
  const offer = { kind: 'rebook', amount: 50, choice: 'rebook:open:1' };
  const priced = L.adjustedRent(199, offer, {});
  assert.strictEqual(priced.amountDue, 149);
  assert.strictEqual(priced.credited, 50);
  const small = L.adjustedRent(40, offer, {});
  assert.strictEqual(small.amountDue, 0);
  assert.strictEqual(small.credited, 40);
});

ok('applying a reward the customer does not have is refused', () => {
  const built = L.build([
    rental({ id: 1, start_date: '2026-09-24', end_date: '2026-10-01' })
  ], { today: '2026-10-04' });
  const profile = built.profiles[0];
  const open = L.offerByChoice(profile, L.addFormStatus(profile).offers[0].choice);
  assert.strictEqual(open.kind, 'rebook');
  assert.strictEqual(L.offerByChoice(profile, 'punch:1'), null);
  const missing = L.prepareApply(null, 'punch:1', { amountDue: 199, days: 7, mode: 'rent' });
  assert.strictEqual(missing.ok, false);
  const purchase = L.prepareApply(profile, open.choice, { amountDue: 199, days: 7, mode: 'buy' });
  assert.strictEqual(purchase.ok, false);
  assert.strictEqual(purchase.error, 'not_rental');
  const noCredit = L.prepareApply(L.build(five(), { today: '2026-10-14' }).profiles[0], 'punch:1', {
    amountDue: 599, days: 30, mode: 'rent', weekValue: 0
  });
  assert.strictEqual(noCredit.ok, false);
  assert.strictEqual(noCredit.error, 'no_credit');
  const applied = L.prepareApply(profile, open.choice, { amountDue: 199, days: 7, mode: 'rent' });
  assert.strictEqual(applied.ok, true);
  assert.strictEqual(applied.amountDue, 149);
  assert.strictEqual(applied.credited, 50);
});

console.log('\n' + passed + ' assertions passed\n');
