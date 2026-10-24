// Run: node scripts/test-state-sync.js
//
// Debounced Mongo state sync. No live database: a fake timer and a persist
// function stand in for Atlas. What matters is that writes coalesce, critical
// records flush on a short timer, unchanged state never hits the network, and
// a shutdown flushes whatever is still dirty.
const assert = require('assert');
const { EventEmitter } = require('events');
const { createStateSync, stripAnalytics, encodeStateDocument } = require('../lib/state-sync');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }
async function checkAsync(name, fn) { await fn(); passed++; console.log('  ok - ' + name); }

function timers() {
  const items = [];
  let n = 1;
  return {
    items,
    setTimer(fn, ms) {
      const id = n++;
      items.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimer(id) {
      const t = items.find(x => x.id === id);
      if (t) t.cleared = true;
    },
    pending() { return items.filter(t => !t.cleared); }
  };
}

function harness(overrides) {
  const clock = timers();
  const calls = [];
  let active = 0;
  let maxActive = 0;
  let release = null;
  const logs = [];
  const state = overrides.state || {
    games: [{ id: 1, title: 'Kept' }],
    customers: [],
    promo_events: [],
    visitors: [{ path: '/old' }],
    visitor_skips: { '2026-10-01': 3 },
    message_taps: [{ q: 'no' }],
    search_misses: [{ q: 'x' }]
  };
  let hold = false;
  const sync = createStateSync(Object.assign({
    getState: () => state,
    enabled: true,
    isReady: () => true,
    intervalMs: 45000,
    criticalMs: 2000,
    summaryEveryMs: 3600000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    log: (msg) => logs.push(msg),
    persist: async (payload) => {
      active++;
      maxActive = Math.max(maxActive, active);
      calls.push(payload);
      if (hold) await new Promise(r => { release = () => { active--; r(); }; });
      else active--;
    }
  }, overrides.sync || {}));
  return {
    clock, calls, logs, state, sync,
    maxActive: () => maxActive,
    hold(v) { hold = v; },
    release() { const fn = release; release = null; fn(); }
  };
}

(async () => {
  console.log('\nstripAnalytics');

  check('analytics keys are removed and everything else is kept', () => {
    const out = stripAnalytics({
      games: [{ id: 1 }],
      visitors: [{ path: '/' }],
      visitor_skips: { '2026-10-01': 2 },
      message_taps: [{}],
      search_misses: [{}],
      customers: [{ id: 4 }]
    });
    assert.deepStrictEqual(Object.keys(out).sort(), ['customers', 'games']);
    assert.deepStrictEqual(out.games, [{ id: 1 }]);
    assert.deepStrictEqual(out.customers, [{ id: 4 }]);
  });

  console.log('\ncoalesce and classify');

  await checkAsync('the first real state change is scheduled on the critical timer, once', async () => {
    const h = harness({});
    h.sync.afterWrite();
    h.sync.afterWrite();
    const pending = h.clock.pending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].ms, 2000);
    assert.strictEqual(h.calls.length, 0);
  });

  await checkAsync('firing the timer syncs a stripped document once and logs its byte size', async () => {
    const h = harness({});
    h.sync.afterWrite();
    await h.clock.pending()[0].fn();
    assert.strictEqual(h.calls.length, 1);
    assert.deepStrictEqual(h.calls[0].data.games, [{ id: 1, title: 'Kept' }]);
    assert.strictEqual(h.calls[0].data.visitors, undefined);
    assert.strictEqual(h.calls[0].data.visitor_skips, undefined);
    assert.strictEqual(h.calls[0].data.message_taps, undefined);
    assert.strictEqual(h.calls[0].data.search_misses, undefined);
    const expected = encodeStateDocument(h.calls[0].data).bytes;
    assert.strictEqual(h.calls[0].bytes, expected);
    assert.ok(h.logs.some(l => l.includes('synced ' + expected + ' bytes')), h.logs.join('\n'));
  });

  await checkAsync('a second write of the same state does not schedule another sync', async () => {
    const h = harness({});
    h.sync.afterWrite();
    await h.clock.pending()[0].fn();
    const n = h.clock.items.length;
    h.sync.afterWrite();
    assert.strictEqual(h.clock.pending().length, 0);
    assert.strictEqual(h.clock.items.length, n);
    assert.strictEqual(h.calls.length, 1);
  });

  await checkAsync('only a deferred key waits for the long interval', async () => {
    const h = harness({});
    h.sync.afterWrite();
    await h.clock.pending()[0].fn();
    h.state.promo_events = [{ id: 1 }];
    h.sync.afterWrite();
    const pending = h.clock.pending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].ms, 45000);
  });

  await checkAsync('a critical change pulls an already waiting deferred sync forward', async () => {
    const h = harness({});
    h.sync.afterWrite();
    await h.clock.pending()[0].fn();
    h.state.promo_events = [{ id: 1 }];
    h.sync.afterWrite();
    assert.strictEqual(h.clock.pending()[0].ms, 45000);
    h.state.customers = [{ id: 9, payments: [{ amount: 100 }] }];
    h.sync.afterWrite();
    const pending = h.clock.pending();
    assert.strictEqual(pending.length, 1, 'the long timer should have been replaced');
    assert.strictEqual(pending[0].ms, 2000);
  });

  await checkAsync('analytics writes do not schedule a sync', async () => {
    const h = harness({});
    h.sync.afterWrite();
    await h.clock.pending()[0].fn();
    h.sync.withAnalytics(() => {
      h.state.visitors = h.state.visitors.concat([{ path: '/new' }]);
      h.state.visitor_skips = { '2026-10-24': 8 };
      h.sync.afterWrite();
    });
    assert.strictEqual(h.clock.pending().length, 0);
    assert.strictEqual(h.calls.length, 1);
  });

  console.log('\noverlap, unchanged, not-ready');

  await checkAsync('a sync that starts while another is in flight waits, then runs', async () => {
    const h = harness({});
    h.hold(true);
    h.sync.afterWrite();
    const first = h.clock.pending()[0].fn();
    await Promise.resolve();
    assert.strictEqual(h.calls.length, 1);
    h.state.customers = [{ id: 2 }];
    h.sync.afterWrite();
    const secondTimer = h.clock.pending()[0];
    const second = secondTimer.fn();
    await Promise.resolve();
    assert.strictEqual(h.calls.length, 1, 'the second sync must not start yet');
    assert.strictEqual(h.maxActive(), 1);
    h.hold(false);
    h.release();
    await first;
    await second;
    assert.strictEqual(h.calls.length, 2);
    assert.strictEqual(h.maxActive(), 1);
    assert.deepStrictEqual(h.calls[1].data.customers, [{ id: 2 }]);
  });

  await checkAsync('flush does nothing when the stripped document is unchanged', async () => {
    const h = harness({});
    h.sync.afterWrite();
    await h.clock.pending()[0].fn();
    const again = await h.sync.flush();
    assert.strictEqual(again.reason, 'unchanged');
    assert.strictEqual(h.calls.length, 1);
  });

  await checkAsync('force still writes when nothing changed', async () => {
    const h = harness({});
    h.sync.afterWrite();
    await h.clock.pending()[0].fn();
    const again = await h.sync.flush({ force: true });
    assert.strictEqual(again.skipped, false);
    assert.strictEqual(h.calls.length, 2);
  });

  await checkAsync('sync is held until ready, then a later flush sends the change', async () => {
    let ready = false;
    const h = harness({ sync: { isReady: () => ready } });
    h.state.customers = [{ id: 3 }];
    h.sync.afterWrite();
    const held = await h.clock.pending()[0].fn();
    assert.strictEqual(held.reason, 'not-ready');
    assert.strictEqual(h.calls.length, 0);
    assert.strictEqual(h.sync.isDirty(), true);
    ready = true;
    await h.sync.flush();
    assert.strictEqual(h.calls.length, 1);
    assert.deepStrictEqual(h.calls[0].data.customers, [{ id: 3 }]);
  });

  await checkAsync('a failed persist stays dirty, reports the error, and retries later', async () => {
    const clock = timers();
    const logs = [];
    let attempts = 0;
    const errors = [];
    const state = { games: [{ id: 1 }], customers: [{ id: 1 }] };
    const sync = createStateSync({
      getState: () => state,
      enabled: true,
      isReady: () => true,
      intervalMs: 45000,
      criticalMs: 2000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      log: (msg) => logs.push(msg),
      onError: (e) => errors.push(e.message),
      persist: async () => {
        attempts++;
        if (attempts === 1) throw new Error('socket hang up');
      }
    });
    sync.afterWrite();
    const first = await clock.pending()[0].fn();
    assert.strictEqual(first.ok, false);
    assert.strictEqual(errors[0], 'socket hang up');
    assert.strictEqual(sync.isDirty(), true);
    assert.ok(logs.some(l => l.includes('socket hang up')));
    const retry = clock.pending().find(t => t.ms === 45000);
    assert.ok(retry, 'a retry should be scheduled on the normal interval');
    await retry.fn();
    assert.strictEqual(attempts, 2);
    assert.strictEqual(sync.isDirty(), false);
  });

  console.log('\nshutdown and hourly summary');

  await checkAsync('SIGTERM flushes a pending change and then exits', async () => {
    const h = harness({});
    h.state.customers = [{ id: 7 }];
    h.sync.afterWrite();
    const proc = new EventEmitter();
    let code = null;
    proc.exit = (c) => { code = c; };
    h.sync.bindProcess(proc);
    proc.emit('SIGTERM');
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    assert.strictEqual(h.calls.length, 1);
    assert.deepStrictEqual(h.calls[0].data.customers, [{ id: 7 }]);
    assert.strictEqual(code, 0);
  });

  await checkAsync('SIGINT flushes and exits 130', async () => {
    const h = harness({});
    h.state.site_settings = { title: 'PlayStation Hub' };
    h.sync.afterWrite();
    const proc = new EventEmitter();
    let code = null;
    proc.exit = (c) => { code = c; };
    h.sync.bindProcess(proc);
    proc.emit('SIGINT');
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    assert.strictEqual(h.calls.length, 1);
    assert.strictEqual(code, 130);
  });

  await checkAsync('beforeExit flushes without exiting', async () => {
    const h = harness({});
    h.state.accounts = [{ id: 1 }];
    h.sync.afterWrite();
    const proc = new EventEmitter();
    let code = null;
    proc.exit = (c) => { code = c; };
    h.sync.bindProcess(proc);
    proc.emit('beforeExit');
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    assert.strictEqual(h.calls.length, 1);
    assert.strictEqual(code, null);
  });

  await checkAsync('a clean process does not sync again on SIGTERM', async () => {
    const h = harness({});
    h.sync.afterWrite();
    await h.clock.pending()[0].fn();
    const proc = new EventEmitter();
    let code = null;
    proc.exit = (c) => { code = c; };
    h.sync.bindProcess(proc);
    proc.emit('SIGTERM');
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    assert.strictEqual(h.calls.length, 1);
    assert.strictEqual(code, 0);
  });

  await checkAsync('an hourly line reports how many syncs ran and how many bytes they sent', async () => {
    const h = harness({});
    h.sync.startHourlySummary();
    h.sync.afterWrite();
    await h.clock.pending().find(t => t.ms === 2000).fn();
    const bytes = h.calls[0].bytes;
    const hourly = h.clock.pending().find(t => t.ms === 3600000);
    assert.ok(hourly);
    hourly.fn();
    const line = h.logs.find(l => l.includes('hourly'));
    assert.ok(line, h.logs.join('\n'));
    assert.ok(line.includes('syncs=1'), line);
    assert.ok(line.includes('bytes=' + bytes), line);
    const next = h.clock.pending().find(t => t.ms === 3600000);
    next.fn();
    const zeros = h.logs.filter(l => l.includes('hourly'));
    assert.ok(zeros[zeros.length - 1].includes('syncs=0'), zeros[zeros.length - 1]);
  });

  await checkAsync('disabled sync (no MONGODB_URI) never persists', async () => {
    const h = harness({ sync: { enabled: false } });
    h.state.customers = [{ id: 1 }];
    h.sync.afterWrite();
    assert.strictEqual(h.clock.pending().length, 0);
    const result = await h.sync.flush({ force: true });
    assert.strictEqual(result.reason, 'disabled');
    assert.strictEqual(h.calls.length, 0);
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
