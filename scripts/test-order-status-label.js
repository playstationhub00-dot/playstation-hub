// Run: node scripts/test-order-status-label.js
// The export adds a readable status next to the raw state. The raw state stays.
const assert = require('assert');
const { statusLabel } = require('../lib/order-status-label');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

ok('a free line entry reads In line and keeps the raw state beside it', () => {
  const order = { state: 'waitlisted', is_waitlist: true };
  assert.strictEqual(statusLabel(order), 'In line');
  assert.strictEqual(order.state, 'waitlisted');
});

ok('priority, a pre-order and a purchase each get their own label', () => {
  assert.strictEqual(statusLabel({ state: 'reserved' }), 'Priority');
  assert.strictEqual(statusLabel({ state: 'reserved', upcoming_game_id: 4 }), 'Reserved — awaiting release');
  assert.strictEqual(statusLabel({ state: 'reserved', is_buy: true }), 'Purchased');
});

ok('other states stay readable and an unknown state is left as stored', () => {
  assert.strictEqual(statusLabel({ state: 'awaiting_payment' }), 'Awaiting payment');
  assert.strictEqual(statusLabel({ state: 'closed' }), 'Completed');
  assert.strictEqual(statusLabel({ state: 'custom' }), 'custom');
  assert.strictEqual(statusLabel(null), '');
});

console.log('\n' + passed + ' assertions passed\n');
