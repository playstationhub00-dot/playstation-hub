// Run: node scripts/test-messenger-text.js
const assert = require('assert');
const m = require('../public/js/messenger-text.js');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

console.log('\nbuildMessage');
ok('nothing picked: just the game', () => {
  assert.strictEqual(m.buildMessage({ title: 'Resident Evil Requiem' }), 'Hi! I want to RENT a game 🎮\nGame: Resident Evil Requiem');
});
ok('type and duration picked: both lines and the total, same wording as before', () => {
  assert.strictEqual(m.buildMessage({
    title: 'Resident Evil Requiem', typeLabel: 'Trophy Account', daysLabel: '7 Days',
    totalLine: 'Total: ₱399 + ₱100 refundable deposit'
  }), 'Hi! I want to RENT a game 🎮\nGame: Resident Evil Requiem\nAccount Type: Trophy Account\nDuration: 7 Days\nTotal: ₱399 + ₱100 refundable deposit');
});
ok('only a type picked', () => {
  assert.strictEqual(m.buildMessage({ title: 'X', typeLabel: 'Non-Trophy Account' }), 'Hi! I want to RENT a game 🎮\nGame: X\nAccount Type: Non-Trophy Account');
});
ok('booked: asks about the next slot, keeps type and duration, drops the total', () => {
  assert.strictEqual(m.buildMessage({ title: 'X', booked: true }), 'Hi! I\'m interested in X 🎮\nI saw it\'s fully booked — when is the next slot?');
  assert.strictEqual(m.buildMessage({ title: 'X', booked: true, typeLabel: 'Trophy Account', daysLabel: '30 Days', totalLine: 'Total: ₱1' }),
    'Hi! I\'m interested in X 🎮\nI saw it\'s fully booked — when is the next slot?\nAccount Type: Trophy Account\nDuration: 30 Days');
});
ok('no options at all does not throw', () => {
  assert.ok(m.buildMessage().includes('RENT'));
});

console.log('\nmessengerHref');
ok('opens the page with the text URL-encoded', () => {
  assert.strictEqual(m.messengerHref('Hi! Game: A & B\nx'), 'http://m.me/PlaystationHub00?text=' + encodeURIComponent('Hi! Game: A & B\nx'));
});

console.log('\n' + passed + ' assertions passed\n');
