// Run: node scripts/test-order-cleanup.js
//
// lib/order-cleanup.js: which orders the owner may cancel from the By game
// board ("Cancel selected") and which the 30-day cleanup cancels on its own —
// unpaid orders and free waiting-list entries, never a priority (paid) entry
// or an unpaid Quick Add — plus the cleanup setting and the sweep itself,
// driven with fakes.
// See docs/superpowers/specs/2026-10-24-orders-bulk-cancel-and-cleanup-design.md.
const assert = require('assert');
const cleanup = require('../lib/order-cleanup');

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const NOW = new Date('2026-10-25T00:00:00.000Z');
const daysAgo = d => new Date(NOW.getTime() - d * 86400000).toISOString();
const o = (ref, state, created_at, extra) => Object.assign({ ref, state, created_at }, extra || {});

(async () => {
  await ok('the setting: unset means on at 30 days; days are whole and kept within 7-365', async () => {
    assert.deepStrictEqual(cleanup.normalizeCleanup(undefined), { enabled: true, days: 30 });
    assert.deepStrictEqual(cleanup.normalizeCleanup({}), { enabled: true, days: 30 });
    assert.deepStrictEqual(cleanup.normalizeCleanup({ cleanup_enabled: false, cleanup_days: 45 }), { enabled: false, days: 45 });
    assert.deepStrictEqual(cleanup.normalizeCleanup({ cleanup_days: '14.6' }), { enabled: true, days: 15 });
    assert.strictEqual(cleanup.normalizeCleanup({ cleanup_days: 2 }).days, 7);
    assert.strictEqual(cleanup.normalizeCleanup({ cleanup_days: 9999 }).days, 365);
    assert.strictEqual(cleanup.normalizeCleanup({ cleanup_days: 'abc' }).days, 30);
    assert.strictEqual(cleanup.normalizeCleanup({ cleanup_days: '' }).days, 30);
  });

  await ok('last activity is the latest state change, else the day it was made; unreadable is null', async () => {
    assert.strictEqual(cleanup.lastActivity(o('A', 'payment_rejected', daysAgo(40), {
      state_history: [{ state: 'awaiting_payment', at: daysAgo(40) }, { state: 'payment_rejected', at: daysAgo(3) }, { state: 'x', at: 'nope' }]
    })), Date.parse(daysAgo(3)));
    assert.strictEqual(cleanup.lastActivity(o('B', 'waitlisted', daysAgo(31))), Date.parse(daysAgo(31)));
    assert.strictEqual(cleanup.lastActivity(o('C', 'waitlisted', 'not a date')), null);
    assert.strictEqual(cleanup.lastActivity(null), null);
  });

  await ok('cancellable: unpaid, payment rejected and free entries — not priority, not an unpaid Quick Add, not paid', async () => {
    assert.strictEqual(cleanup.isCancellable(o('A', 'awaiting_payment')), true);
    assert.strictEqual(cleanup.isCancellable(o('B', 'payment_rejected')), true);
    assert.strictEqual(cleanup.isCancellable(o('C', 'waitlisted')), true);
    ['reserved', 'verifying_payment', 'awaiting_qr', 'active', 'closed', 'cancelled'].forEach(state =>
      assert.strictEqual(cleanup.isCancellable(o('D', state)), false, state));
    assert.strictEqual(cleanup.isCancellable(o('E', 'awaiting_payment', '', { settle_state: 'active' })), false, 'unpaid Quick Add');
    assert.strictEqual(cleanup.isCancellable(o('F', 'awaiting_payment', '', { customer_id: 12 })), false, 'unpaid Quick Add (older kind)');
    assert.strictEqual(cleanup.isCancellable(null), false);
  });

  await ok('stale: cancellable and quiet for at least the set days; off means nothing', async () => {
    const list = [
      o('PH-0001', 'awaiting_payment', daysAgo(30)),
      o('PH-0002', 'awaiting_payment', daysAgo(29.9)),
      o('PH-0003', 'waitlisted', daysAgo(75)),
      o('PH-0004', 'reserved', daysAgo(90)),
      o('PH-0005', 'payment_rejected', daysAgo(60), { state_history: [{ state: 'payment_rejected', at: daysAgo(2) }] }),
      o('PH-0006', 'awaiting_payment', daysAgo(60), { settle_state: 'active' }),
      o('PH-0007', 'active', daysAgo(90)),
      o('PH-0008', 'waitlisted', 'garbage'),
      null
    ];
    assert.deepStrictEqual(cleanup.staleOrders(list, {}, NOW).map(x => x.ref), ['PH-0001', 'PH-0003']);
    assert.deepStrictEqual(cleanup.staleOrders(list, { cleanup_days: 60 }, NOW).map(x => x.ref), ['PH-0003']);
    assert.deepStrictEqual(cleanup.staleOrders(list, { cleanup_enabled: false }, NOW), []);
  });

  await ok('refs from a form: one or many, PH-numbers only, upper-cased, no repeats, at most 200', async () => {
    assert.deepStrictEqual(cleanup.parseRefs('ph-0145'), ['PH-0145']);
    assert.deepStrictEqual(cleanup.parseRefs(['PH-0145', 'PH-0146', 'PH-0145', 'x', '<b>', '', null, 7]), ['PH-0145', 'PH-0146']);
    assert.deepStrictEqual(cleanup.parseRefs(undefined), []);
    const many = Array.from({ length: 250 }, (_, i) => 'PH-' + String(1000 + i));
    assert.strictEqual(cleanup.parseRefs(many).length, 200);
  });

  await ok('the sweep cancels each stale order with its days, and only when switched on', async () => {
    const list = [o('PH-0011', 'awaiting_payment', daysAgo(40)), o('PH-0012', 'waitlisted', daysAgo(5)), o('PH-0013', 'waitlisted', daysAgo(31))];
    const calls = [];
    const deps = settings => ({
      now: NOW, settings,
      listCandidates: async () => list,
      cancel: async (order, days) => { calls.push(order.ref + '@' + days); return order.ref !== 'PH-0013'; }
    });
    assert.deepStrictEqual(await cleanup.runCleanup(deps({})), { examined: 3, cancelled: 1, refs: ["PH-0011"] });
    assert.deepStrictEqual(calls, ['PH-0011@30', 'PH-0013@30']);
    calls.length = 0;
    assert.deepStrictEqual(await cleanup.runCleanup(deps({ cleanup_enabled: false })), { examined: 0, cancelled: 0, refs: [] });
    assert.deepStrictEqual(calls, []);
  });

  await ok('a failing cancel does not stop the rest, and two sweeps never overlap', async () => {
    const list = [o('PH-0021', 'awaiting_payment', daysAgo(40)), o('PH-0022', 'awaiting_payment', daysAgo(40))];
    const done = [];
    let release;
    const gate = new Promise(r => { release = r; });
    const first = cleanup.runCleanup({
      now: NOW, settings: {},
      listCandidates: async () => { await gate; return list; },
      cancel: async order => { if (order.ref === 'PH-0021') throw new Error('db down'); done.push(order.ref); return true; }
    });
    const second = await cleanup.runCleanup({ now: NOW, settings: {}, listCandidates: async () => list, cancel: async () => true });
    assert.deepStrictEqual(second, { examined: 0, cancelled: 0, refs: [], overlapped: true });
    release();
    assert.deepStrictEqual(await first, { examined: 2, cancelled: 1, refs: ['PH-0022'] });
    assert.deepStrictEqual(done, ['PH-0022']);
  });

  await ok('refs lists the cancelled orders in order; false cancels are left out; onError traces a throw and never stops the sweep', async () => {
    const list = [
      o('PH-0031', 'awaiting_payment', daysAgo(40)), o('PH-0032', 'awaiting_payment', daysAgo(40)),
      o('PH-0033', 'waitlisted', daysAgo(40)), o('PH-0034', 'waitlisted', daysAgo(40))
    ];
    const errors = [];
    const res = await cleanup.runCleanup({
      now: NOW, settings: {},
      listCandidates: async () => list,
      cancel: async order => {
        if (order.ref === 'PH-0032') return false;
        if (order.ref === 'PH-0033') throw new Error('db down');
        return true;
      },
      onError: (order, err) => { errors.push(order.ref + ':' + err.message); throw new Error('onError itself broke'); }
    });
    assert.deepStrictEqual(res, { examined: 4, cancelled: 2, refs: ['PH-0031', 'PH-0034'] });
    assert.deepStrictEqual(errors, ['PH-0033:db down']);
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
