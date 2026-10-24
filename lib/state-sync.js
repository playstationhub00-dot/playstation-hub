// Coalesces lowdb saves into occasional MongoDB state-document replacements.
//
// Railway bills the bytes this process sends to Atlas. Replacing the whole
// state document on every page view was most of that bill, so writes now wait
// and share one upload:
//   - customers, payments, settings, promos, catalog, accounts: within 2s
//   - promo events, messenger contacts, support threads: within 45s
//   - anything already uploaded: not sent again
// A deploy (SIGTERM/SIGINT) and a quiet exit flush whatever is still waiting,
// so the 2s/45s windows apply to a hard crash, not to a restart.
const crypto = require('crypto');

const ANALYTICS_KEYS = ['visitors', 'visitor_skips', 'message_taps', 'search_misses'];
const ANALYTICS_SET = new Set(ANALYTICS_KEYS);
// High-volume, reconstructable-enough logs. Losing the last 45s of these on
// a hard crash is the trade for not uploading the catalogue on every message.
const DEFERRED_KEYS = ['promo_events', 'messenger_contacts', 'support_threads'];
const DEFERRED_SET = new Set(DEFERRED_KEYS);

const INTERVAL_MS = 45000;
const CRITICAL_MS = 2000;
const SUMMARY_MS = 60 * 60 * 1000;

function stripAnalytics(state) {
  const out = {};
  if (!state || typeof state !== 'object') return out;
  for (const key of Object.keys(state)) {
    if (!ANALYTICS_SET.has(key)) out[key] = state[key];
  }
  return out;
}

function encodeStateDocument(data) {
  const doc = { _id: 'db', data };
  const json = JSON.stringify(doc);
  return { doc, json, bytes: Buffer.byteLength(json) };
}

function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function defaultSetTimer(fn, ms) {
  const timer = setTimeout(fn, ms);
  if (timer.unref) timer.unref();
  return timer;
}

function createStateSync(options) {
  const opts = options || {};
  const getState = opts.getState;
  const persist = opts.persist;
  const enabled = opts.enabled !== false;
  const isReady = opts.isReady || (() => true);
  const shouldStrip = opts.shouldStrip || (() => true);
  const log = opts.log || console.log;
  const onError = opts.onError || (() => {});
  const setTimer = opts.setTimer || defaultSetTimer;
  const clearTimer = opts.clearTimer || (id => clearTimeout(id));
  const now = opts.now || Date.now;
  const intervalMs = opts.intervalMs || INTERVAL_MS;
  const criticalMs = opts.criticalMs != null ? opts.criticalMs : CRITICAL_MS;
  const summaryEveryMs = opts.summaryEveryMs || SUMMARY_MS;
  const shutdownWaitMs = opts.shutdownWaitMs || 8000;

  let analyticsDepth = 0;
  let dirty = false;
  let wantCritical = false;
  let timer = null;
  let timerDue = 0;
  let summaryTimer = null;
  let lastHash = null;
  let lastCritical = null;
  let tail = Promise.resolve();
  let hour = { syncs: 0, bytes: 0 };
  let bound = false;

  function buildPayload() {
    const raw = getState() || {};
    const data = shouldStrip() ? stripAnalytics(raw) : Object.assign({}, raw);
    const critical = {};
    for (const key of Object.keys(data)) {
      if (!DEFERRED_SET.has(key)) critical[key] = data[key];
    }
    const encoded = encodeStateDocument(data);
    return {
      data,
      bytes: encoded.bytes,
      hash: sha(encoded.json),
      criticalHash: sha(JSON.stringify(critical))
    };
  }

  function schedule(delay) {
    dirty = true;
    const due = now() + delay;
    // A timer that is already sooner (a payment waiting 2s, while a chat
    // message arrives) stays. A later one is pulled forward.
    if (timer && timerDue <= due) return;
    if (timer) clearTimer(timer);
    let id;
    id = setTimer(() => {
      clearTimer(id);
      if (timer === id) {
        timer = null;
        timerDue = 0;
      }
      return flush();
    }, delay);
    timer = id;
    timerDue = due;
  }

  function afterWrite() {
    if (!enabled || analyticsDepth > 0) return;
    const payload = buildPayload();
    if (lastHash && payload.hash === lastHash) return;
    const critical = !lastCritical || payload.criticalHash !== lastCritical;
    if (critical) wantCritical = true;
    dirty = true;
    schedule(wantCritical ? criticalMs : intervalMs);
  }

  function withAnalytics(fn) {
    analyticsDepth++;
    try { return fn(); }
    finally { analyticsDepth--; }
  }

  function flush(options) {
    const job = tail.then(() => doFlush(options || {}));
    tail = job.then(() => {}, () => {});
    return job;
  }

  async function doFlush(options) {
    const force = !!options.force;
    const shutdown = !!options.shutdown;
    if (!enabled) return { skipped: true, ok: false, reason: 'disabled' };
    if (!isReady() && !shutdown) {
      // Boot is still copying the visitor log out of the state document.
      // Sending now would either be too early or race that copy.
      schedule(Math.min(intervalMs, 5000));
      return { skipped: true, ok: false, reason: 'not-ready' };
    }
    const payload = buildPayload();
    if (!force && lastHash && payload.hash === lastHash) {
      dirty = false;
      wantCritical = false;
      return { skipped: true, ok: true, reason: 'unchanged', bytes: payload.bytes };
    }
    if (!dirty && !force) return { skipped: true, ok: true, reason: 'clean' };

    dirty = false;
    wantCritical = false;
    try {
      await persist({ data: payload.data, bytes: payload.bytes });
      lastHash = payload.hash;
      lastCritical = payload.criticalHash;
      hour.syncs++;
      hour.bytes += payload.bytes;
      log('[mongo] synced ' + payload.bytes + ' bytes');
      return { skipped: false, ok: true, bytes: payload.bytes };
    } catch (e) {
      dirty = true;
      const message = e && e.message ? e.message : String(e);
      log('[mongo sync error] ' + message);
      try { onError(e); } catch (ignore) { /* reset must not hide the sync failure */ }
      schedule(intervalMs);
      return { skipped: false, ok: false, error: message };
    }
  }

  function captureBaseline() {
    if (!enabled) return;
    const payload = buildPayload();
    lastHash = payload.hash;
    lastCritical = payload.criticalHash;
    dirty = false;
    wantCritical = false;
  }

  function startHourlySummary() {
    if (!enabled || summaryTimer) return;
    const tick = () => {
      log('[mongo] hourly syncs=' + hour.syncs + ' bytes=' + hour.bytes);
      hour = { syncs: 0, bytes: 0 };
      summaryTimer = setTimer(tick, summaryEveryMs);
    };
    summaryTimer = setTimer(tick, summaryEveryMs);
  }

  function bindProcess(proc) {
    if (bound || !proc) return;
    bound = true;
    let shuttingDown = false;
    function shutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      const finish = () => {
        if (typeof proc.exit === 'function') proc.exit(signal === 'SIGINT' ? 130 : 0);
      };
      let timeoutId = null;
      const limited = new Promise(resolve => {
        timeoutId = setTimer(() => resolve('timeout'), shutdownWaitMs);
      });
      Promise.race([
        flush({ shutdown: true }).then(() => 'flushed', () => 'error'),
        limited
      ]).then(() => {
        if (timeoutId != null) clearTimer(timeoutId);
        finish();
      }, finish);
    }
    proc.on('SIGTERM', () => shutdown('SIGTERM'));
    proc.on('SIGINT', () => shutdown('SIGINT'));
    proc.on('beforeExit', () => {
      if (dirty) flush({ shutdown: true });
    });
  }

  return {
    afterWrite,
    withAnalytics,
    flush,
    captureBaseline,
    startHourlySummary,
    bindProcess,
    isDirty: () => dirty,
    stats: () => ({ syncs: hour.syncs, bytes: hour.bytes })
  };
}

module.exports = {
  createStateSync,
  stripAnalytics,
  encodeStateDocument,
  ANALYTICS_KEYS,
  DEFERRED_KEYS,
  INTERVAL_MS,
  CRITICAL_MS
};
