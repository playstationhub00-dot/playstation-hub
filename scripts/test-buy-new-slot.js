// Run: node scripts/test-buy-new-slot.js
//
// Buying permanently when a type is full: the rule for each account type
// (lib/availability.js buyOption — buyable when it has a permanent price, in
// stock when a slot can be handed over now, otherwise a new slot the owner
// adds), and the "New slot to add" item in Needs you now (lib/notifications.js).
// See docs/superpowers/specs/2026-10-22-buy-when-full-new-slot-design.md.
const assert = require('assert');
const { buyOption } = require('../lib/availability');
const notifications = require('../lib/notifications');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const summary = (total, sellable) => ({ trophy: { total, sellable } });

ok('a type with a permanent price and a slot to hand over is in stock', () => {
  assert.deepStrictEqual(buyOption(summary(2, 1), 'trophy', null, 1999), { buyable: true, inStock: true, newSlot: false });
  assert.deepStrictEqual(buyOption(null, 'trophy', { everStocked: true, avail: true }, 1999), { buyable: true, inStock: true, newSlot: false }, 'a legacy slot free now');
});

ok('every slot rented out, sold or offline: still buyable, as a new slot', () => {
  assert.deepStrictEqual(buyOption(summary(2, 0), 'trophy', null, 1999), { buyable: true, inStock: false, newSlot: true }, 'linked accounts sold or offline');
  assert.deepStrictEqual(buyOption(null, 'trophy', { everStocked: true, avail: false }, '1999'), { buyable: true, inStock: false, newSlot: true }, 'legacy slots all rented');
});

ok('never stocked is in stock as before (its account is made on the first sale)', () => {
  assert.deepStrictEqual(buyOption(null, 'trophy', { everStocked: false, avail: false }, 999), { buyable: true, inStock: true, newSlot: false });
});

ok('no permanent price: not buyable at all', () => {
  [0, null, undefined, '', -5].forEach(p => {
    assert.deepStrictEqual(buyOption(summary(2, 0), 'trophy', null, p), { buyable: false, inStock: false, newSlot: false }, String(p));
  });
});

ok('Needs you now: one "New slot to add" per paid new-slot order not yet set up', () => {
  const list = [
    { ref: 'PH-1', state: 'awaiting_qr', new_slot: true, fb_name: 'Juan D.', game_title: 'Elden Ring', account_type: 'tr' },
    { ref: 'PH-2', state: 'qr_pending', new_slot: true, fb_name: 'Ana', game_title: 'GTA V', account_type: 'nt', qr_expires_at: '2026-10-22T10:00:00.000Z' },
    { ref: 'PH-3', state: 'awaiting_payment', new_slot: true, fb_name: 'Unpaid', game_title: 'X', account_type: 'tr' },
    { ref: 'PH-4', state: 'verifying_payment', new_slot: true, fb_name: 'Checking', game_title: 'X', account_type: 'tr' },
    { ref: 'PH-5', state: 'active', new_slot: true, fb_name: 'Done', game_title: 'X', account_type: 'tr' },
    { ref: 'PH-6', state: 'reserved', new_slot: true, fb_name: 'Not released yet', game_title: 'X', account_type: 'tr' },
    { ref: 'PH-7', state: 'awaiting_qr', fb_name: 'In stock', game_title: 'X', account_type: 'tr' },
    { ref: 'PH-8', state: 'cancelled', new_slot: true, fb_name: 'Gone', game_title: 'X', account_type: 'tr' },
    null
  ];
  const pending = notifications.pendingNewSlots(list);
  assert.deepStrictEqual(pending.map(o => o.ref), ['PH-1', 'PH-2']);
  const built = notifications.build({ newSlotOrders: pending });
  const items = built.items.filter(i => i.kind === 'new_slot');
  assert.deepStrictEqual(items.map(i => [i.id, i.urgency, i.icon, i.title, i.sub, i.tab, i.ref]), [
    ['new_slot:PH-1', 'warn', '🆕', 'New slot to add', 'PH-1 · Juan D. · Elden Ring · Trophy', 'orders', 'PH-1'],
    ['new_slot:PH-2', 'warn', '🆕', 'New slot to add', 'PH-2 · Ana · GTA V · Non-Trophy', 'orders', 'PH-2']
  ]);
  assert.ok(notifications.RANK.new_slot > notifications.RANK.verifying_payment, 'after the critical payment queue');
  assert.deepStrictEqual(notifications.pendingNewSlots(undefined), []);
});

console.log('\n' + passed + ' assertions passed\n');
