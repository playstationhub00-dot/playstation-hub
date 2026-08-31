// Plain assert-based tests for the queue rules. No test framework in this
// project by design — run with `node scripts/test-queue.js`, which exits
// non-zero on the first failed assertion.
const assert = require('assert');
const queue = require('../lib/queue');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

const NOW = new Date('2026-08-31T12:00:00.000Z');

// Days before NOW, as the ISO string orders store in created_at.
function daysAgo(n) {
  return new Date(NOW.getTime() - n * 86400000).toISOString();
}

function entry(over) {
  return Object.assign({
    ref: 'PH-0001',
    game_id: 5,
    account_type: 'tr',
    state: 'waitlisted',
    fb_name: 'Test User',
    created_at: daysAgo(1),
    session_id: 'sess-1'
  }, over);
}

check('masks a two-word name to first name plus last initial', () => {
  assert.strictEqual(queue.maskName('Michael Dela Cruz'), 'Michael C.');
  assert.strictEqual(queue.maskName('Jenny Reyes'), 'Jenny R.');
});

check('leaves a one-word name alone and never re-cases a name', () => {
  assert.strictEqual(queue.maskName('carlo'), 'carlo');
  assert.strictEqual(queue.maskName('MARIA santos'), 'MARIA s.');
});

check('falls back to Guest for a blank name', () => {
  assert.strictEqual(queue.maskName(''), 'Guest');
  assert.strictEqual(queue.maskName('   '), 'Guest');
  assert.strictEqual(queue.maskName(null), 'Guest');
  assert.strictEqual(queue.maskName(undefined), 'Guest');
});

check('truncates a very long first word', () => {
  assert.strictEqual(queue.maskName('Bartholomewesque Santos'), 'Bartholomewesq… S.');
});

check('collapses runs of whitespace before masking', () => {
  assert.strictEqual(queue.maskName('  Michael   Dela   Cruz  '), 'Michael C.');
});

check('a free entry counts until it is 30 days old', () => {
  assert.strictEqual(queue.inQueue(entry({ created_at: daysAgo(29) }), NOW), true);
  assert.strictEqual(queue.inQueue(entry({ created_at: daysAgo(30) }), NOW), true);
  assert.strictEqual(queue.inQueue(entry({ created_at: daysAgo(31) }), NOW), false);
});

check('a paid priority entry never expires', () => {
  const old = entry({ state: 'reserved', created_at: daysAgo(400) });
  assert.strictEqual(queue.inQueue(old, NOW), true);
});

check('an entry with no created_at is kept rather than silently dropped', () => {
  // A data glitch must not delete a real person from the line. Failing open is
  // the safe direction here.
  assert.strictEqual(queue.inQueue(entry({ created_at: null }), NOW), true);
});

check('an unpaid priority order that was never a waitlist entry is excluded', () => {
  assert.strictEqual(queue.inQueue(entry({ state: 'awaiting_payment' }), NOW), false);
  assert.strictEqual(queue.inQueue(entry({ state: 'verifying_payment' }), NOW), false);
});

check('an upgrading waitlist entry stays in the queue while it pays', () => {
  const up = { upgraded_from_waitlist: true };
  assert.strictEqual(queue.inQueue(entry(Object.assign({ state: 'awaiting_payment' }, up)), NOW), true);
  assert.strictEqual(queue.inQueue(entry(Object.assign({ state: 'verifying_payment' }, up)), NOW), true);
  assert.strictEqual(queue.inQueue(entry(Object.assign({ state: 'payment_rejected' }, up)), NOW), true);
});

check('pre-orders are a different queue and are excluded', () => {
  assert.strictEqual(queue.inQueue(entry({ state: 'reserved', upcoming_game_id: 9 }), NOW), false);
  assert.strictEqual(queue.inQueue(entry({ state: 'reserved', is_buy: true }), NOW), false);
});

check('closed and cancelled orders hold no place', () => {
  assert.strictEqual(queue.inQueue(entry({ state: 'cancelled' }), NOW), false);
  assert.strictEqual(queue.inQueue(entry({ state: 'closed' }), NOW), false);
  assert.strictEqual(queue.inQueue(entry({ state: 'active' }), NOW), false);
});

check('priority sorts above free regardless of join time', () => {
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0002', state: 'waitlisted', created_at: daysAgo(20) }),
    entry({ ref: 'PH-0003', state: 'reserved', created_at: daysAgo(2) })
  ], NOW).tr;
  assert.deepStrictEqual(rows.map(r => r.ref), ['PH-0003', 'PH-0002']);
  assert.deepStrictEqual(rows.map(r => r.tier), ['priority', 'free']);
  assert.deepStrictEqual(rows.map(r => r.position), [1, 2]);
});

check('within a tier the oldest entry is number one', () => {
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0002', created_at: daysAgo(2) }),
    entry({ ref: 'PH-0003', created_at: daysAgo(9) }),
    entry({ ref: 'PH-0004', created_at: daysAgo(5) })
  ], NOW).tr;
  assert.deepStrictEqual(rows.map(r => r.ref), ['PH-0003', 'PH-0004', 'PH-0002']);
});

check('ties break on ref so the order is deterministic', () => {
  const same = daysAgo(3);
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0009', created_at: same }),
    entry({ ref: 'PH-0007', created_at: same })
  ], NOW).tr;
  assert.deepStrictEqual(rows.map(r => r.ref), ['PH-0007', 'PH-0009']);
});

check('each account type is counted separately', () => {
  const q = queue.buildQueue([
    entry({ ref: 'PH-0002', account_type: 'tr' }),
    entry({ ref: 'PH-0003', account_type: 'nt' }),
    entry({ ref: 'PH-0004', account_type: 'nt' }),
    entry({ ref: 'PH-0005', account_type: 'ps4' })
  ], NOW);
  assert.strictEqual(q.tr.length, 1);
  assert.strictEqual(q.nt.length, 2);
  assert.strictEqual(q.ps4.length, 1);
});

check('an unknown account type is dropped rather than crashing', () => {
  const q = queue.buildQueue([entry({ account_type: 'bogus' })], NOW);
  assert.deepStrictEqual(Object.keys(q).sort(), ['nt', 'ps4', 'tr']);
  assert.strictEqual(q.tr.length + q.nt.length + q.ps4.length, 0);
});

check('a row carries a masked name and the raw session id', () => {
  const row = queue.buildQueue([entry({ fb_name: 'Aira Santos', session_id: 'abc' })], NOW).tr[0];
  assert.strictEqual(row.name, 'Aira S.');
  assert.strictEqual(row.sessionId, 'abc');
  assert.strictEqual(row.tier, 'free');
});

check('positionOf finds a ref and returns null for one that is absent', () => {
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0002', created_at: daysAgo(9) }),
    entry({ ref: 'PH-0003', created_at: daysAgo(4) })
  ], NOW).tr;
  assert.strictEqual(queue.positionOf(rows, 'PH-0003'), 2);
  assert.strictEqual(queue.positionOf(rows, 'PH-9999'), null);
  assert.strictEqual(queue.positionOf([], 'PH-0002'), null);
});

check('aheadOf splits the people in front into paid and total', () => {
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0002', state: 'reserved', created_at: daysAgo(9) }),
    entry({ ref: 'PH-0003', state: 'reserved', created_at: daysAgo(7) }),
    entry({ ref: 'PH-0004', created_at: daysAgo(8) }),
    entry({ ref: 'PH-0005', created_at: daysAgo(3) })
  ], NOW).tr;
  assert.deepStrictEqual(queue.aheadOf(rows, 'PH-0005'), { total: 3, priority: 2 });
  assert.deepStrictEqual(queue.aheadOf(rows, 'PH-0002'), { total: 0, priority: 0 });
  assert.strictEqual(queue.aheadOf(rows, 'PH-9999'), null);
});

check('upgradedPosition ranks an upgrader by their original join time', () => {
  // PH-0004 fell in line 8 days ago — LONGER than the priority holder who paid
  // 7 days ago. Because upgrading keeps created_at, clearing the ₱100 must put
  // them at #2, ahead of that holder. Counting priority rows and adding one
  // would wrongly say #3.
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0002', state: 'reserved', created_at: daysAgo(9) }),
    entry({ ref: 'PH-0003', state: 'reserved', created_at: daysAgo(7) }),
    entry({ ref: 'PH-0004', created_at: daysAgo(8) }),
    entry({ ref: 'PH-0005', created_at: daysAgo(3) })
  ], NOW).tr;
  assert.deepStrictEqual(rows.map(r => r.ref), ['PH-0002', 'PH-0003', 'PH-0004', 'PH-0005']);
  assert.strictEqual(queue.upgradedPosition(rows, 'PH-0004'), 2);
  // PH-0005 is the newest of all, so it lands behind both paid holders.
  assert.strictEqual(queue.upgradedPosition(rows, 'PH-0005'), 3);
  assert.strictEqual(queue.upgradedPosition(rows, 'PH-9999'), null);
});

check('upgrading with nobody paid ahead of you takes the top spot', () => {
  const rows = queue.buildQueue([
    entry({ ref: 'PH-0004', created_at: daysAgo(8) }),
    entry({ ref: 'PH-0005', created_at: daysAgo(3) })
  ], NOW).tr;
  assert.strictEqual(queue.upgradedPosition(rows, 'PH-0005'), 1);
});

check('isExpired only ever fires on a stale free entry', () => {
  assert.strictEqual(queue.isExpired(entry({ created_at: daysAgo(31) }), NOW), true);
  assert.strictEqual(queue.isExpired(entry({ created_at: daysAgo(10) }), NOW), false);
  assert.strictEqual(queue.isExpired(entry({ state: 'reserved', created_at: daysAgo(400) }), NOW), false);
  assert.strictEqual(queue.isExpired(entry({ state: 'active', created_at: daysAgo(400) }), NOW), false);
});

console.log('\n' + passed + ' assertions passed');
