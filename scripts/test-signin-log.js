// Run: node scripts/test-signin-log.js
//
// The sign-in log records that the owner signed someone in, or asked for a
// fresh code. It does not store the QR link or the code — those are single-use
// secrets, same rule as the reveal log.
const assert = require('assert');
const log = require('../lib/signin-log');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const NOW = new Date('2026-11-26T08:15:00.000Z');

ok('a signed-in row names the order, the account, the method and the time', () => {
  const next = log.append([], {
    actor: 'admin',
    action: 'signed_in',
    ref: 'PH-2201',
    account_id: 4,
    method: 'qr_link'
  }, NOW);
  assert.strictEqual(next.length, 1);
  assert.strictEqual(next[0].actor, 'admin');
  assert.strictEqual(next[0].action, 'signed_in');
  assert.strictEqual(next[0].ref, 'PH-2201');
  assert.strictEqual(next[0].account_id, 4);
  assert.strictEqual(next[0].method, 'qr_link');
  assert.strictEqual(next[0].at, '2026-11-26T08:15:00.000Z');
});

ok('asking for a fresh code is its own action', () => {
  const next = log.append([], {
    actor: 'admin',
    action: 'ask_fresh',
    ref: 'PH-2201',
    method: 'typed_code'
  }, NOW);
  assert.strictEqual(next[0].action, 'ask_fresh');
  assert.strictEqual(next[0].method, 'typed_code');
  assert.ok(!Object.prototype.hasOwnProperty.call(next[0], 'account_id'));
});

ok('the link and the code are dropped even if a caller passes them', () => {
  const next = log.append([], {
    actor: 'admin',
    action: 'signed_in',
    ref: 'PH-2201',
    method: 'qr_link',
    url: 'https://login.playstation.com/secret',
    qr_signin_url: 'https://login.playstation.com/secret',
    code: 'ABCD1234',
    qr_code: 'ABCD1234'
  }, NOW);
  const raw = JSON.stringify(next[0]);
  assert.ok(!raw.includes('playstation.com'));
  assert.ok(!raw.includes('ABCD1234'));
  assert.ok(!Object.prototype.hasOwnProperty.call(next[0], 'url'));
  assert.ok(!Object.prototype.hasOwnProperty.call(next[0], 'code'));
});

ok('unknown actions and bad refs are refused', () => {
  assert.throws(() => log.append([], { action: 'hacked', ref: 'PH-2201' }, NOW), /unknown/);
  assert.throws(() => log.append([], { action: 'signed_in', ref: '' }, NOW), /ref/);
  assert.throws(() => log.append([], { action: 'signed_in', ref: 'nope' }, NOW), /ref/);
});

ok('the log stays capped', () => {
  let rows = [];
  for (let i = 0; i < log.CAP + 5; i++) {
    rows = log.append(rows, { action: 'ask_fresh', ref: 'PH-' + String(1000 + i) }, NOW);
  }
  assert.strictEqual(rows.length, log.CAP);
  assert.strictEqual(rows[rows.length - 1].ref, 'PH-' + String(1000 + log.CAP + 4));
});

console.log('\n' + passed + ' assertions passed\n');
