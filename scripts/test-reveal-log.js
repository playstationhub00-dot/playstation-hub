// Run: node scripts/test-reveal-log.js
//
// The reveal log records who looked at a masked admin secret, and when.
// It never stores the secret itself.
const assert = require('assert');
const log = require('../lib/reveal-log');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const NOW = new Date('2026-11-04T05:30:00.000Z');

ok('a reveal row names the actor, the kind, the subject and the time', () => {
  const next = log.append([], {
    actor: 'admin',
    kind: 'account_email',
    subject: '14',
    field: 'email'
  }, NOW);
  assert.strictEqual(next.length, 1);
  assert.strictEqual(next[0].actor, 'admin');
  assert.strictEqual(next[0].kind, 'account_email');
  assert.strictEqual(next[0].subject, '14');
  assert.strictEqual(next[0].field, 'email');
  assert.strictEqual(next[0].at, '2026-11-04T05:30:00.000Z');
});

ok('the secret value is dropped even if a caller passes it', () => {
  const next = log.append([], {
    actor: 'admin',
    kind: 'payment_number',
    subject: 'gcash',
    field: 'number',
    value: '09171234567'
  }, NOW);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(next[0], 'value'), false);
  assert.ok(!JSON.stringify(next[0]).includes('0917'));
});

ok('unknown kinds are refused', () => {
  assert.throws(() => log.append([], { kind: 'password', subject: '1' }, NOW));
  assert.throws(() => log.append([], { kind: '', subject: '1' }, NOW));
});

ok('a missing subject is refused', () => {
  assert.throws(() => log.append([], { kind: 'account_email', subject: '  ' }, NOW));
});

ok('the actor falls back to admin and is trimmed', () => {
  const next = log.append([], { kind: 'payment_number', subject: 'maya' }, NOW);
  assert.strictEqual(next[0].actor, 'admin');
  assert.strictEqual(next[0].field, 'number');
});

ok('the log keeps the newest 500 rows', () => {
  let rows = [];
  for (let i = 0; i < 505; i++) {
    rows = log.append(rows, { kind: 'account_email', subject: String(i), actor: 'admin' }, new Date(NOW.getTime() + i * 1000));
  }
  assert.strictEqual(rows.length, 500);
  assert.strictEqual(rows[0].subject, '5');
  assert.strictEqual(rows[rows.length - 1].subject, '504');
});

ok('a non-array log is treated as empty', () => {
  const next = log.append(null, { kind: 'account_email', subject: '3' }, NOW);
  assert.strictEqual(next.length, 1);
});

console.log('\n' + passed + ' assertions passed\n');
