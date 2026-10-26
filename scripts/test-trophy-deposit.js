// Run: node scripts/test-trophy-deposit.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const reservations = require('../lib/reservations');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

check('a Trophy priority fee is ₱100 now, and the deposit is in the balance, not a second charge', () => {
  // Rent after promo 599, deposit 100. Pay 100 now. The rest is (599 - 100) + 100 = 599.
  // Lifetime total is 699, which is the rent plus the deposit. depositDue stays 0
  // so the ₱100 fee is not also stored as a refundable deposit.
  const fee = reservations.priorityFeeSplit(599, 100);
  assert.deepStrictEqual(fee, { amountDue: 100, depositDue: 0, remainingDue: 599 });
  assert.strictEqual(fee.amountDue + fee.remainingDue, 599 + 100);
});

check('a Non-Trophy priority fee does not invent a deposit', () => {
  const fee = reservations.priorityFeeSplit(349, 0);
  assert.deepStrictEqual(fee, { amountDue: 100, depositDue: 0, remainingDue: 249 });
});

check('a rent smaller than the fee does not make the balance negative', () => {
  const fee = reservations.priorityFeeSplit(80, 100);
  assert.strictEqual(fee.amountDue, 100);
  assert.strictEqual(fee.depositDue, 0);
  assert.strictEqual(fee.remainingDue, 100);
});

check('a full Trophy checkout still adds the deposit on top of the rent', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const create = server.slice(server.indexOf("app.post('/order/create'"), server.indexOf("app.post('/order/buy'"));
  assert.ok(create.includes("(type === 'tr' || type === 'ps4') ? (promo.deposit || 0) : 0"));
  assert.ok(create.includes('deposit_due: depositDue'));
  const psplus = server.slice(server.indexOf("app.post('/order/create-psplus'"), server.indexOf("app.post('/order/reserve'"));
  assert.ok(psplus.includes("(type === 'tr' || type === 'ps4') ? (promo.deposit || 0) : 0"));
});

check('priority reservations and waitlist upgrades use the same split', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(server.includes('reservations.priorityFeeSplit(rentAfterPromo, psplusDeposit)'));
  assert.ok(server.includes('reservations.priorityFeeSplit(rentAfterPromo, gameDeposit)'));
  assert.ok(server.includes('reservations.priorityFeeSplit(rentAfterPromo, deposit)'));
  const page = fs.readFileSync(path.join(__dirname, '..', 'views', 'order-status.ejs'), 'utf8');
  assert.ok(page.includes('including the ₱'));
  assert.ok(page.includes('refundable deposit'));
});

console.log('\n' + passed + ' assertions passed');
