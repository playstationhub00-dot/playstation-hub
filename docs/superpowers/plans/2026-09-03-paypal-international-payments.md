# PayPal for International Customers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer outside the Philippines pay by PayPal, seeing the price in USD while the money moves in PHP, with PayPal and bank fees recovered at display time.

**Architecture:** PayPal is added as a third *manual* payment method beside GCash and Maya, riding the existing screenshot-upload rail — no second gateway, no webhooks. Two new pure modules (`lib/surcharge.js`, `lib/fx.js`) hold all the money and rate maths; the FX network call lives in `server.js` beside `createPaymongoCheckout`, matching the existing split. The surcharge is computed at render time and is **never written to an order**.

**Tech Stack:** Node + Express + EJS, lowdb for settings, plain `assert` test scripts run with `node` (no test framework — project convention).

**Spec:** `docs/superpowers/specs/2026-09-03-paypal-international-payments-design.md`

## Global Constraints

- `amount_due`, `payments[]`, and `lib/payments.js` are **never modified**. The surcharge is a display concern and stays one.
- Every peso rounding goes **up**. Under-recovery is the failure mode being guarded against.
- **Percentages must round to 6 decimals before ceiling.** `Math.ceil(1500 * 4.4 / 100)` returns 67, not 66 — float error invents a peso whenever the percentage lands on a whole number. Use `Math.ceil(+(x).toFixed(6))`.
- The FX rate band is `RATE_MIN = 30`, `RATE_MAX = 120` PHP per USD. Anything outside is rejected as garbage.
- FX staleness threshold is 24 hours. Stale at exactly the threshold.
- **No render ever awaits the FX fetch.** Pages render with the cached or manual rate and refresh in the background.
- Defaults: `paypal_fee_percent` = `4.4`, `paypal_fee_fixed` = `15`, `paypal_payout_usd` = `0.50`, `fx_manual_rate` = `62.50`.
- FX source: `https://open.er-api.com/v6/latest/USD`, no API key, 8000ms timeout.
- New lib modules are pure: no network, no database, no environment reads.
- Test scripts follow the existing house style (see `scripts/test-paymongo.js`): a `check(name, fn)` helper, `passed++`, a final count line, exiting non-zero on first failure.
- Work directly on `main`. Commit after each task.

---

### Task 1: `lib/surcharge.js` — the fee maths

**Files:**
- Create: `lib/surcharge.js`
- Test: `scripts/test-surcharge.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `computeSurcharge(amountPesos, config) -> { base, feePeso, payoutPeso, total }` where `config` is `{ percent, fixedPeso, payoutUsd, rate }`. All four returned values are whole-number pesos.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-surcharge.js`:

```js
// Plain assert-based tests for the PayPal surcharge maths. No test framework
// in this project by design — run with `node scripts/test-surcharge.js`, which
// exits non-zero on the first failed assertion.
const assert = require('assert');
const sur = require('../lib/surcharge');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

// The live defaults, so these tests fail if a default silently changes.
const CFG = { percent: 4.4, fixedPeso: 15, payoutUsd: 0.50, rate: 62.58 };

check('a 249 rental produces the documented breakdown', () => {
  const q = sur.computeSurcharge(249, CFG);
  assert.strictEqual(q.base, 249);
  assert.strictEqual(q.feePeso, 26);      // ceil(10.956) = 11, + 15
  assert.strictEqual(q.payoutPeso, 32);   // ceil(0.50 * 62.58) = ceil(31.29)
  assert.strictEqual(q.total, 307);
});

check('a whole-number percentage does not gain a phantom peso', () => {
  // THE regression test. 1500 * 4.4 / 100 evaluates to 66.00000000000001 in
  // JavaScript, so a naive Math.ceil yields 67 and charges the customer a peso
  // that does not exist. Correct answers here are 81 and 1613, never 82/1614.
  const q = sur.computeSurcharge(1500, CFG);
  assert.strictEqual(q.feePeso, 81);
  assert.strictEqual(q.payoutPeso, 32);
  assert.strictEqual(q.total, 1613);
});

check('a genuine fraction still rounds up', () => {
  // 10.956 must become 11, not 10 — under-recovering is the failure mode.
  assert.strictEqual(sur.computeSurcharge(249, { percent: 4.4, fixedPeso: 0, payoutUsd: 0, rate: 62.58 }).feePeso, 11);
});

check('percent 0 gives a pure flat fee', () => {
  const q = sur.computeSurcharge(249, { percent: 0, fixedPeso: 40, payoutUsd: 0, rate: 62.58 });
  assert.strictEqual(q.feePeso, 40);
  assert.strictEqual(q.total, 289);
});

check('a zero fixed fee and zero payout give a pure percentage', () => {
  const q = sur.computeSurcharge(1000, { percent: 5, fixedPeso: 0, payoutUsd: 0, rate: 62.58 });
  assert.strictEqual(q.feePeso, 50);
  assert.strictEqual(q.payoutPeso, 0);
  assert.strictEqual(q.total, 1050);
});

check('a zero amount carries no fees at all', () => {
  // An order with nothing to send must not display a fee-only total.
  assert.deepStrictEqual(sur.computeSurcharge(0, CFG), { base: 0, feePeso: 0, payoutPeso: 0, total: 0 });
});

check('unusable inputs become zero instead of throwing', () => {
  // This runs inside a page render. A blank or mistyped settings field must
  // never take the order page down for every customer.
  assert.strictEqual(sur.computeSurcharge(-50, CFG).total, 0);
  assert.strictEqual(sur.computeSurcharge(NaN, CFG).total, 0);
  assert.strictEqual(sur.computeSurcharge(undefined, CFG).total, 0);
  assert.strictEqual(sur.computeSurcharge(249, {}).total, 249);
  assert.strictEqual(sur.computeSurcharge(249, null).total, 249);
  assert.strictEqual(sur.computeSurcharge(249, { percent: 'abc', fixedPeso: NaN, payoutUsd: -1, rate: 62.58 }).total, 249);
});

check('a negative rate cannot produce a negative payout', () => {
  assert.strictEqual(sur.computeSurcharge(249, { percent: 0, fixedPeso: 0, payoutUsd: 0.5, rate: -62 }).payoutPeso, 0);
});

console.log('\n' + passed + ' assertions passed');
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node scripts/test-surcharge.js
```

Expected: FAIL — `Cannot find module '../lib/surcharge'`.

- [ ] **Step 3: Write the implementation**

Create `lib/surcharge.js`:

```js
// International payment surcharge — what a PayPal customer is asked to send on
// top of the rental price, covering what PayPal and the bank take out.
//
// Pure functions over numbers: no settings read, no database, no network, so
// the money maths is testable without booting the app.
//
// This is a DISPLAY concern and must stay one. Nothing here is ever written to
// an order — amount_due stays the rental price, and this only decides what the
// PayPal panel asks for. See
// docs/superpowers/specs/2026-09-03-paypal-international-payments-design.md.

// Anything unusable becomes 0 rather than throwing. This runs inside a page
// render, and a blank or mistyped settings field must not take the order page
// down for every customer.
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Ceiling with the float error taken out first. 1500 * 4.4 / 100 evaluates to
// 66.00000000000001, and Math.ceil of that is 67 — a phantom peso charged
// every time the percentage lands on a whole number. Rounding to 6 decimals
// first removes it while leaving every genuine fraction alone.
function ceilPeso(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(Number(n.toFixed(6)));
}

// Every rounding goes UP. Under-recovering silently is the failure worth
// guarding against; over-recovering by a peso is not.
function computeSurcharge(amountPesos, config) {
  const c = config || {};
  const base = Math.round(num(amountPesos));
  // Nothing to send means nothing to charge fees on.
  if (base <= 0) return { base: 0, feePeso: 0, payoutPeso: 0, total: 0 };
  const feePeso = ceilPeso(base * num(c.percent) / 100) + ceilPeso(num(c.fixedPeso));
  const payoutPeso = ceilPeso(num(c.payoutUsd) * num(c.rate));
  return { base, feePeso, payoutPeso, total: base + feePeso + payoutPeso };
}

module.exports = { computeSurcharge };
```

- [ ] **Step 4: Run it to verify it passes**

```bash
node scripts/test-surcharge.js
```

Expected: PASS, `8 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/surcharge.js scripts/test-surcharge.js && git commit -m "feat: PayPal surcharge maths with float-error guard"
```

---

### Task 2: `lib/fx.js` — rate sanity and the fallback chain

**Files:**
- Create: `lib/fx.js`
- Test: `scripts/test-fx.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `RATE_MIN` (30), `RATE_MAX` (120), `DAY_MS`, `isSaneRate(n)`, `isStale(fetchedAt, now, maxAgeMs)`, `pesosToUsd(pesos, rate)`, `pickRate(cache, manualRate, now) -> { rate, source }` where `source` is `'live'` or `'manual'` and `cache` is `{ rate, fetched_at }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-fx.js`:

```js
// Plain assert-based tests for USD/PHP rate handling. No test framework in
// this project by design — run with `node scripts/test-fx.js`, which exits
// non-zero on the first failed assertion.
//
// No network: pickRate and isStale are fed fabricated caches and clocks, so
// the whole fallback chain is exercised without an FX API existing.
const assert = require('assert');
const fx = require('../lib/fx');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

const NOW = Date.parse('2026-09-03T12:00:00Z');
const fresh = new Date(NOW - 60 * 1000).toISOString();
const old   = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();

check('a plausible rate is sane', () => {
  assert.strictEqual(fx.isSaneRate(62.58), true);
  assert.strictEqual(fx.isSaneRate(30), true);
  assert.strictEqual(fx.isSaneRate(120), true);
});

check('garbage is never sane', () => {
  // The whole point of the band: a broken API response, an HTML error page or
  // a redirect body must never render "$0.02" or "$4,000" on a checkout panel.
  [0, -62, NaN, Infinity, -Infinity, null, undefined, {}, []].forEach(v => {
    assert.strictEqual(fx.isSaneRate(v), false, String(v) + ' should not be sane');
  });
});

check('a numeric string is rejected', () => {
  // A rate arrives as a number or not at all. Accepting '62.58' would mean
  // accepting whatever else a malformed payload put in that field.
  assert.strictEqual(fx.isSaneRate('62.58'), false);
});

check('out-of-band rates are rejected', () => {
  assert.strictEqual(fx.isSaneRate(5), false);
  assert.strictEqual(fx.isSaneRate(5000), false);
  assert.strictEqual(fx.isSaneRate(29.99), false);
  assert.strictEqual(fx.isSaneRate(120.01), false);
});

check('staleness is measured against the threshold inclusively', () => {
  assert.strictEqual(fx.isStale(fresh, NOW, fx.DAY_MS), false);
  assert.strictEqual(fx.isStale(old, NOW, fx.DAY_MS), true);
  // Exactly on the line counts as stale.
  const exact = new Date(NOW - fx.DAY_MS).toISOString();
  assert.strictEqual(fx.isStale(exact, NOW, fx.DAY_MS), true);
  const justUnder = new Date(NOW - fx.DAY_MS + 1000).toISOString();
  assert.strictEqual(fx.isStale(justUnder, NOW, fx.DAY_MS), false);
});

check('an unknown age is never treated as fresh', () => {
  assert.strictEqual(fx.isStale(undefined, NOW, fx.DAY_MS), true);
  assert.strictEqual(fx.isStale('not a date', NOW, fx.DAY_MS), true);
  assert.strictEqual(fx.isStale(null, NOW, fx.DAY_MS), true);
});

check('pesos convert to dollars at the nearest cent', () => {
  // Nearest, not up: this is labelled an estimate and the peso figure is what
  // is actually charged, so inflating it would only make it less accurate.
  assert.strictEqual(fx.pesosToUsd(307, 62.58), 4.91);
  assert.strictEqual(fx.pesosToUsd(1613, 62.58), 25.78);
});

check('conversion refuses to work from an unusable rate', () => {
  assert.strictEqual(fx.pesosToUsd(307, 0), 0);
  assert.strictEqual(fx.pesosToUsd(307, NaN), 0);
  assert.strictEqual(fx.pesosToUsd(307, 5000), 0);
  assert.strictEqual(fx.pesosToUsd(0, 62.58), 0);
  assert.strictEqual(fx.pesosToUsd(-5, 62.58), 0);
});

check('a fresh sane cache is used and reported as live', () => {
  const r = fx.pickRate({ rate: 62.58, fetched_at: fresh }, 60, NOW);
  assert.deepStrictEqual(r, { rate: 62.58, source: 'live' });
});

check('a stale cache falls through to the manual rate', () => {
  const r = fx.pickRate({ rate: 62.58, fetched_at: old }, 60, NOW);
  assert.deepStrictEqual(r, { rate: 60, source: 'manual' });
});

check('a fresh cache holding an insane rate falls through', () => {
  // Freshness alone must not qualify a rate. A recently-cached 0 is still 0.
  const r = fx.pickRate({ rate: 0, fetched_at: fresh }, 60, NOW);
  assert.deepStrictEqual(r, { rate: 60, source: 'manual' });
});

check('no cache at all falls through', () => {
  assert.deepStrictEqual(fx.pickRate(null, 60, NOW), { rate: 60, source: 'manual' });
  assert.deepStrictEqual(fx.pickRate({}, 60, NOW), { rate: 60, source: 'manual' });
});

check('a manual rate from a settings form arrives as a string and still works', () => {
  // Settings come back from an HTML form as strings, so the manual rate is
  // coerced where the API response is not.
  assert.deepStrictEqual(fx.pickRate(null, '62.50', NOW), { rate: 62.5, source: 'manual' });
});

check('an unusable manual rate still yields a usable number', () => {
  // The panel must render regardless. RATE_MIN is the floor of the chain.
  assert.deepStrictEqual(fx.pickRate(null, 0, NOW), { rate: fx.RATE_MIN, source: 'manual' });
  assert.deepStrictEqual(fx.pickRate(null, 'abc', NOW), { rate: fx.RATE_MIN, source: 'manual' });
  assert.deepStrictEqual(fx.pickRate(null, undefined, NOW), { rate: fx.RATE_MIN, source: 'manual' });
});

console.log('\n' + passed + ' assertions passed');
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node scripts/test-fx.js
```

Expected: FAIL — `Cannot find module '../lib/fx'`.

- [ ] **Step 3: Write the implementation**

Create `lib/fx.js`:

```js
// USD/PHP rate handling for the PayPal panel's dollar estimate.
//
// Pure functions only — the fetch itself lives in server.js beside the other
// outbound calls. Everything here decides whether a rate is usable and which
// one to use, so the whole fallback chain is testable without a network.
//
// See docs/superpowers/specs/2026-09-03-paypal-international-payments-design.md.

// A garbage filter, not a market prediction. The band is deliberately wide:
// its only job is to stop a broken API response, an HTML error page or a
// redirect body from rendering "$0.02" or "$4,000" on a checkout panel.
const RATE_MIN = 30;
const RATE_MAX = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

// Strings are rejected, including numeric ones — a rate arrives from the API
// as a number or not at all. Accepting '62.58' would mean accepting whatever
// else a malformed payload happened to put in that field.
function isSaneRate(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= RATE_MIN && n <= RATE_MAX;
}

// Stale at exactly the threshold, and stale whenever the timestamp is missing
// or unparseable — an unknown age is never treated as fresh.
function isStale(fetchedAt, now, maxAgeMs) {
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return true;
  const limit = Number.isFinite(Number(maxAgeMs)) ? Number(maxAgeMs) : DAY_MS;
  return (Number(now) - t) >= limit;
}

// Rounds to the NEAREST cent, not up. This is labelled an estimate on the page
// and the peso figure is what is actually charged, so there is no
// under-recovery to guard against — inflating it would only make the estimate
// less accurate.
function pesosToUsd(pesos, rate) {
  const p = Number(pesos);
  if (!Number.isFinite(p) || p <= 0 || !isSaneRate(rate)) return 0;
  return Math.round((p / rate) * 100) / 100;
}

// The fallback chain in one place. 'live' only for a cache that is both fresh
// AND sane — freshness alone must not qualify a rate, since a recently-cached
// 0 is still 0. Everything else falls through to the manual rate, which is
// coerced because it arrives from an HTML settings form as a string. If that
// is unusable too, RATE_MIN is returned so the caller always has a number and
// the panel can still render.
function pickRate(cache, manualRate, now) {
  const c = cache || {};
  if (isSaneRate(c.rate) && !isStale(c.fetched_at, now, DAY_MS)) {
    return { rate: c.rate, source: 'live' };
  }
  const manual = Number(manualRate);
  if (isSaneRate(manual)) return { rate: manual, source: 'manual' };
  return { rate: RATE_MIN, source: 'manual' };
}

module.exports = { RATE_MIN, RATE_MAX, DAY_MS, isSaneRate, isStale, pesosToUsd, pickRate };
```

- [ ] **Step 4: Run it to verify it passes**

```bash
node scripts/test-fx.js
```

Expected: PASS, `14 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/fx.js scripts/test-fx.js && git commit -m "feat: USD/PHP rate sanity band and fallback chain"
```

---

### Task 3: Seed PayPal into settings

**Files:**
- Modify: `server.js` — inside `getSiteSettings()`, immediately after the existing `payment_methods` seed block (search for `Payment methods start disabled`)
- Modify: `server.js` — the `/admin/payment-methods` multer field list (search for `{ name: 'qr_maya',  maxCount: 1 }`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `settings.payment_methods` contains a `{ key: 'paypal', label: 'PayPal', account_name, account_number, qr_image, enabled }` entry; `settings.paypal_fee_percent` (4.4), `settings.paypal_fee_fixed` (15), `settings.paypal_payout_usd` (0.50), `settings.fx_manual_rate` (62.50).

**Context:** `getSiteSettings()` already uses this exact append-a-migration pattern for `expiry_overdue` and `fb_page_username`. Follow it. The migration must be idempotent — it runs on every single call.

- [ ] **Step 1: Add the method migration and the fee settings**

In `server.js`, directly after the block that closes the `if (!s.payment_methods) { ... }` seed, insert:

```js
  // PayPal joins the existing methods rather than getting its own subsystem.
  // Written as a migration as well as a seed, because every existing install
  // already has the gcash/maya pair and would otherwise never gain the third.
  // Idempotent: this runs on every getSiteSettings() call.
  if (!(s.payment_methods || []).some(m => m && m.key === 'paypal')) {
    const withPaypal = (s.payment_methods || []).concat([
      { key: 'paypal', label: 'PayPal', account_name: '', account_number: '', qr_image: '', enabled: false }
    ]);
    db.set('site_settings.payment_methods', withPaypal).write();
    s.payment_methods = withPaypal;
  }
  // Fee recovery for PayPal orders. Settings rather than constants because
  // PayPal's published rates change, and because the first real payment is the
  // only reliable way to learn what the fee actually lands at.
  if (s.paypal_fee_percent === undefined) { db.set('site_settings.paypal_fee_percent', 4.4).write(); s.paypal_fee_percent = 4.4; }
  if (s.paypal_fee_fixed === undefined) { db.set('site_settings.paypal_fee_fixed', 15).write(); s.paypal_fee_fixed = 15; }
  if (s.paypal_payout_usd === undefined) { db.set('site_settings.paypal_payout_usd', 0.5).write(); s.paypal_payout_usd = 0.5; }
  // The floor of the FX fallback chain — must always be set, so the dollar
  // estimate works before the first live fetch ever succeeds.
  if (s.fx_manual_rate === undefined) { db.set('site_settings.fx_manual_rate', 62.5).write(); s.fx_manual_rate = 62.5; }
```

- [ ] **Step 2: Add the multer field**

In the `/admin/payment-methods` route's `uploadPromoMedia.fields([...])` list, add a third entry so a PayPal QR upload is accepted rather than silently dropped:

```js
  { name: 'qr_gcash', maxCount: 1 },
  { name: 'qr_maya',  maxCount: 1 },
  { name: 'qr_paypal', maxCount: 1 }
```

- [ ] **Step 3: Verify the migration is idempotent and lands correctly**

```bash
node -e "const s=require('./server.js')" 2>/dev/null; node -e "
const low=require('lowdb'),FileSync=require('lowdb/adapters/FileSync');
const db=low(new FileSync('db.json'));
const pm=db.get('site_settings.payment_methods').value()||[];
console.log('methods:', pm.map(m=>m.key).join(', '));
console.log('paypal entries:', pm.filter(m=>m.key==='paypal').length, '(must be exactly 1)');
console.log('percent:', db.get('site_settings.paypal_fee_percent').value());
console.log('fixed:', db.get('site_settings.paypal_fee_fixed').value());
console.log('payout:', db.get('site_settings.paypal_payout_usd').value());
console.log('manual rate:', db.get('site_settings.fx_manual_rate').value());
"
```

Expected: `methods: gcash, maya, paypal`, exactly 1 paypal entry, and the four defaults. Start the server a second time and re-run — the paypal count must still be 1, proving idempotency.

- [ ] **Step 4: Confirm the existing suite still passes**

```bash
node scripts/test-orders.js && node scripts/test-gateway.js && node scripts/test-payments.js
```

Expected: all pass. These touch settings and order state; a broken migration shows up here.

- [ ] **Step 5: Commit**

```bash
git add server.js && git commit -m "feat: seed PayPal payment method and fee settings"
```

---

### Task 4: Fetch the rate and expose the quote

**Files:**
- Modify: `server.js` — new functions beside `createPaymongoCheckout` (search for `async function createPaymongoCheckout`)
- Modify: `server.js` — the order-status `res.render('order-status', {...})` call (search for `res.render('order-status'`)
- Modify: `server.js` — requires at the top (search for `const paymongo = require('./lib/paymongo');`)

**Interfaces:**
- Consumes: `surcharge.computeSurcharge(amountPesos, config)` from Task 1; `fx.pickRate(cache, manualRate, now)`, `fx.isSaneRate(n)`, `fx.pesosToUsd(pesos, rate)` from Task 2; the settings from Task 3.
- Produces: a `paypalQuote` local on the order-status render — either `null` (PayPal disabled or nothing owed) or `{ base, feePeso, payoutPeso, total, feesCombined, usd, handle }`, all pesos whole numbers, `usd` a 2-decimal number, `handle` the PayPal.Me username or email string.

- [ ] **Step 1: Add the requires**

Beside the existing `const paymongo = require('./lib/paymongo');`:

```js
const surcharge = require('./lib/surcharge');
const fx = require('./lib/fx');
```

- [ ] **Step 2: Add the fetch and the rate resolver**

Immediately before `async function createPaymongoCheckout(order, opts) {`:

```js
// Today's USD/PHP rate for the PayPal panel's dollar estimate. Cached in
// settings rather than in memory so it survives a Railway restart — those are
// frequent, and a per-boot cache would leave every redeploy briefly rate-less.
//
// The in-flight flag stops a stampede: when the cache goes stale, every
// request that arrives before the first fetch returns would otherwise start
// its own.
let _fxFetching = false;
async function fetchUsdPhpRate() {
  if (_fxFetching) return;
  _fxFetching = true;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('http ' + r.status);
    const body = await r.json();
    const rate = body && body.rates && body.rates.PHP;
    // Rejected rather than stored. A bad rate cached is a bad rate shown to
    // every customer for the next 24 hours.
    if (!fx.isSaneRate(rate)) throw new Error('rate outside sane band: ' + rate);
    db.set('site_settings.fx_rate_cache', { rate, fetched_at: new Date().toISOString() }).write();
  } catch (e) {
    console.error('[fx]', e.message);
  } finally {
    _fxFetching = false;
  }
}

// The rate to display right now, refreshing in the background when what we
// have has gone stale. Deliberately synchronous and deliberately NOT awaited
// anywhere: a slow or dead FX API must cost a slightly old estimate, never a
// delayed or broken order page.
function currentFxRate() {
  const s = getSiteSettings();
  const picked = fx.pickRate(s.fx_rate_cache || null, s.fx_manual_rate, Date.now());
  if (picked.source !== 'live') fetchUsdPhpRate();
  return picked;
}

// What a PayPal customer is asked to send, or null when the method is off.
// Computed fresh on every render and never persisted — see the spec's
// "The surcharge never touches the order".
function paypalQuoteFor(order) {
  const s = getSiteSettings();
  const pm = (s.payment_methods || []).find(m => m && m.key === 'paypal' && m.enabled);
  if (!pm) return null;
  // gatewayRules.amountDueCentavos is the single existing definition of "what
  // is owed" (rent plus deposit); reusing it keeps this from drifting. Note
  // the binding is `gatewayRules`, not `gateway` — see server.js:15.
  const due = gatewayRules.amountDueCentavos(order) / 100;
  const { rate } = currentFxRate();
  const q = surcharge.computeSurcharge(due, {
    percent: s.paypal_fee_percent,
    fixedPeso: s.paypal_fee_fixed,
    payoutUsd: s.paypal_payout_usd,
    rate
  });
  if (!q.total) return null;
  return Object.assign({}, q, {
    feesCombined: q.feePeso + q.payoutPeso,
    usd: fx.pesosToUsd(q.total, rate),
    handle: pm.account_number || ''
  });
}
```

**Note:** `lib/gateway.js` is already required at `server.js:15` as `gatewayRules`. Use that existing binding — do not add a second require under a different name.

- [ ] **Step 3: Pass the quote to the order page**

In the `res.render('order-status', { ... })` object, add one line beside `payMethods`:

```js
    paypalQuote: paypalQuoteFor(order),
```

- [ ] **Step 4: Verify the quote computes correctly against live settings**

```bash
node -e "
const low=require('lowdb'),FileSync=require('lowdb/adapters/FileSync');
const db=low(new FileSync('db.json'));
const sur=require('./lib/surcharge'), fx=require('./lib/fx');
const s=db.get('site_settings').value();
const picked=fx.pickRate(s.fx_rate_cache||null, s.fx_manual_rate, Date.now());
const q=sur.computeSurcharge(249,{percent:s.paypal_fee_percent,fixedPeso:s.paypal_fee_fixed,payoutUsd:s.paypal_payout_usd,rate:picked.rate});
console.log('rate', picked.rate, '('+picked.source+')');
console.log(JSON.stringify(q), 'usd', fx.pesosToUsd(q.total,picked.rate));
"
```

Expected: a rate near 62.5 from `manual`, and a total near 307 with a USD figure near 4.91.

- [ ] **Step 5: Verify the live fetch works and stores a sane rate**

Start the server, load any order page to trigger the background refresh, then:

```bash
node -e "
const low=require('lowdb'),FileSync=require('lowdb/adapters/FileSync');
console.log(JSON.stringify(low(new FileSync('db.json')).get('site_settings.fx_rate_cache').value()));
"
```

Expected: `{"rate":<a number between 30 and 120>,"fetched_at":"<ISO timestamp>"}`. If it is absent, check the server log for a `[fx]` line — the failure is logged, never thrown.

- [ ] **Step 6: Commit**

```bash
git add server.js && git commit -m "feat: fetch USD/PHP rate and expose the PayPal quote"
```

---

### Task 5: The customer-facing PayPal panel

**Files:**
- Modify: `views/order-status.ejs:159` (the `Step 1 — Send` label), `:169-178` (the panel loop), `:213-225` (the tab script), `:21` (the `awaiting_payment` sub-copy)
- Modify: `public/css/style.css` — append beside the existing `.ord-pay-*` rules

**Interfaces:**
- Consumes: the `paypalQuote` local from Task 4 — `{ base, feePeso, payoutPeso, total, feesCombined, usd, handle }` or `null`.
- Produces: nothing consumed by later tasks.

**Context:** the payment panels are already a generic loop over `payMethods`, so PayPal gets a tab automatically once enabled. Only the panel *body* needs a branch, plus the step heading needs to stop hard-coding one amount — it currently says "Send ₱249" while the PayPal panel would say ₱307, and a customer seeing both numbers will not know which to send.

- [ ] **Step 1: Make the step heading amount reactive**

Replace line 159:

```ejs
    <div class="ord-step-label">Step 1 — Send ₱<%= totalDue %></div>
```

with:

```ejs
    <%# The amount differs per method — PayPal adds fees on top — so this
        figure is driven by the tab script below rather than hard-coded. %>
    <div class="ord-step-label">Step 1 — Send ₱<span id="ordStepAmt"><%= totalDue %></span></div>
```

- [ ] **Step 2: Branch the panel body for PayPal**

Replace the panel loop body (lines 169-178) with:

```ejs
      <% payMethods.forEach((m, i) => { %>
      <div class="ord-pay-panel<%= i === 0 ? '' : ' ord-hidden' %>" data-m="<%= m.key %>"
           data-amt="<%= (m.key === 'paypal' && paypalQuote) ? paypalQuote.total : totalDue %>">
        <% if (m.key === 'paypal' && paypalQuote) { %>
          <div class="ord-pay-row"><span>Rental</span><strong>₱<%= paypalQuote.base %></strong></div>
          <%# One combined line on purpose. Itemising the PayPal cut and the
              bank payout separately on a small rental reads as nickel-and-diming
              and invites line-by-line argument; this carries the same
              information without inviting it. %>
          <div class="ord-pay-row"><span>PayPal &amp; bank fees</span><strong>₱<%= paypalQuote.feesCombined %></strong></div>
          <div class="ord-pay-row ord-pay-row-total"><span>Send</span><strong>₱<%= paypalQuote.total %></strong></div>
          <% if (paypalQuote.usd) { %>
          <div class="ord-pay-usd">≈ $<%= paypalQuote.usd.toFixed(2) %> USD</div>
          <div class="ord-pay-usd-note">Your bank sets the final rate, so the exact dollar amount may differ slightly.</div>
          <% } %>
          <% if (paypalQuote.handle) { %>
          <a class="ord-btn-primary ord-pay-ppbtn" target="_blank" rel="noopener"
             href="https://paypal.me/<%= encodeURIComponent(paypalQuote.handle) %>/<%= paypalQuote.total %>PHP">
            Pay ₱<%= paypalQuote.total %> with PayPal
          </a>
          <% } %>
        <% } else { %>
          <% if (m.qr_image) { %>
          <img src="<%= m.qr_image %>" alt="<%= m.label %> QR code" class="ord-pay-qr">
          <% } %>
          <% if (m.account_name) { %><div class="ord-pay-row"><span>Name</span><strong><%= m.account_name %></strong></div><% } %>
          <% if (m.account_number) { %><div class="ord-pay-row"><span>Number</span><strong><%= m.account_number %></strong></div><% } %>
          <div class="ord-pay-row"><span>Amount</span><strong>₱<%= totalDue %></strong></div>
        <% } %>
      </div>
      <% }) %>
```

- [ ] **Step 3: Drive the heading from the tab click**

In the tab script, inside the existing click handler, after the line `if (methodField) methodField.value = key;`, add:

```js
        // Keep the Step 1 heading agreeing with the panel — PayPal's total
        // includes fees the other methods don't charge.
        var amtEl = document.getElementById('ordStepAmt');
        var panel = document.querySelector('.ord-pay-panel[data-m="' + key + '"]');
        if (amtEl && panel && panel.dataset.amt) amtEl.textContent = panel.dataset.amt;
```

- [ ] **Step 4: Update the awaiting_payment sub-copy**

Line 21 currently reads `sub: 'Pay with GCash or Maya, then tell us below.'`. It is now wrong whenever PayPal is enabled. Replace with a line built from what is actually on:

```js
    awaiting_payment:  { title: 'Send your payment',       sub: 'Pay with ' + (payMethods.length ? payMethods.map(function(m){ return m.label; }).join(', ').replace(/, ([^,]*)$/, ' or $1') : 'any method below') + ', then tell us below.' },
```

- [ ] **Step 5: Add the styles**

Append to `public/css/style.css`, after the existing `.ord-pay-row` rules:

```css
/* PayPal panel. The total line and the dollar estimate are the two numbers a
   customer actually acts on, so they get the visual weight. */
.ord-pay-row-total { border-top: 1px solid rgba(255,255,255,0.14); margin-top: 0.4rem; padding-top: 0.5rem; }
.ord-pay-row-total strong { font-size: 1.15rem; }
.ord-pay-usd { text-align: right; font-size: 1.05rem; font-weight: 600; opacity: 0.9; margin-top: 0.15rem; }
.ord-pay-usd-note { text-align: right; font-size: 0.78rem; opacity: 0.6; margin-top: 0.1rem; line-height: 1.35; }
.ord-pay-ppbtn { display: block; text-align: center; margin-top: 0.85rem; text-decoration: none; }
```

- [ ] **Step 6: Verify in the browser**

Enable PayPal in admin (tick "Show to customers", set the account number to a test handle such as `playstationhub`), then open any order in `awaiting_payment`. Confirm all of:

- a PayPal tab appears beside GCash and Maya
- clicking it changes the Step 1 heading from ₱249 to ₱307
- the panel shows Rental ₱249, PayPal & bank fees ₱58, Send ₱307
- the dollar line reads ≈ $4.91 USD with the "your bank sets the final rate" note
- the button links to `https://paypal.me/playstationhub/307PHP`
- clicking back to the GCash tab returns the heading to ₱249
- with PayPal disabled in admin, no PayPal tab renders at all

Check the browser console is clean.

- [ ] **Step 7: Commit**

```bash
git add views/order-status.ejs public/css/style.css && git commit -m "feat: PayPal payment panel with USD estimate"
```

---

### Task 6: Admin settings for the fees

**Files:**
- Modify: `views/partials/admin/settings.ejs:266-292` (the `pm-card` loop)
- Modify: `views/partials/admin/settings.ejs` — a new fee block before the form's `form-actions` div
- Modify: `server.js` — the `/admin/payment-methods` POST handler, before `res.redirect`

**Interfaces:**
- Consumes: the settings from Task 3, and the `fx` require added to `server.js` in Task 4 (Step 4 below uses `fx.RATE_MIN` / `fx.RATE_MAX` to clamp the manual rate). Task 4 must land first.
- Produces: nothing consumed by later tasks.

**Context:** the admin form already loops generically over `payment_methods`, so PayPal's card renders with no change. Two things are wrong for it though: the field is labelled "Account number" when it holds a PayPal.Me handle, and a QR upload makes no sense for PayPal.

- [ ] **Step 1: Label the PayPal fields for what they hold**

In the `pm-card` loop, replace the account-number label block:

```ejs
            <label class="pm-field">
              <span>Account number</span>
              <input type="text" name="number_<%= m.key %>" value="<%= m.account_number %>">
            </label>
```

with:

```ejs
            <label class="pm-field">
              <span><%= m.key === 'paypal' ? 'PayPal.Me username or business email' : 'Account number' %></span>
              <input type="text" name="number_<%= m.key %>" value="<%= m.account_number %>"
                     placeholder="<%= m.key === 'paypal' ? 'playstationhub' : '' %>">
            </label>
            <% if (m.key === 'paypal') { %>
            <p class="pm-note">
              Just the handle, not the whole link — the site builds
              <code>paypal.me/&lt;handle&gt;/&lt;amount&gt;PHP</code> so the amount is
              filled in for the customer. Use a PayPal <strong>Business</strong> account:
              taking payment for goods on a personal one risks a limitation.
            </p>
            <% } %>
```

- [ ] **Step 2: Hide the QR upload for PayPal**

Wrap the QR file input so it only renders for methods that use one:

```ejs
            <% if (m.key !== 'paypal') { %>
            <label class="pm-field">
              <span>QR image</span>
              <input type="file" name="qr_<%= m.key %>" accept="image/*">
            </label>
            <% } %>
```

Leave the `m.qr_image` preview block below it untouched — it is already conditional.

- [ ] **Step 3: Add the fee fields**

Immediately before the `<div class="form-actions"` in the same form:

```ejs
          <div class="pm-card">
            <div class="pm-card-head"><strong>PayPal fees</strong></div>
            <p class="pm-note">
              What PayPal and the bank take out, added on top of the rental price for
              PayPal orders only. These are starting estimates — check what your first
              real payment actually nets and correct them here.
            </p>
            <label class="pm-field">
              <span>PayPal percentage fee (%)</span>
              <input type="number" step="0.01" min="0" name="paypal_fee_percent" value="<%= settings.paypal_fee_percent %>">
            </label>
            <label class="pm-field">
              <span>PayPal fixed fee (₱)</span>
              <input type="number" step="1" min="0" name="paypal_fee_fixed" value="<%= settings.paypal_fee_fixed %>">
            </label>
            <label class="pm-field">
              <span>Bank payout buffer ($)</span>
              <input type="number" step="0.01" min="0" name="paypal_payout_usd" value="<%= settings.paypal_payout_usd %>">
            </label>
            <p class="pm-note">
              The payout fee is charged per <em>withdrawal</em>, not per order — so
              recovering it on every order over-collects once you batch several into one
              transfer. Set it to 0 when that starts happening.
            </p>
            <label class="pm-field">
              <span>Fallback exchange rate (₱ per $1)</span>
              <input type="number" step="0.01" min="30" max="120" name="fx_manual_rate" value="<%= settings.fx_manual_rate %>">
            </label>
            <p class="pm-note">
              Only used if the live rate can't be fetched. The site refreshes the real
              rate daily on its own.
            </p>
          </div>
```

- [ ] **Step 4: Persist them**

In the `/admin/payment-methods` handler, directly before `res.redirect(...)`, add:

```js
  // Fee settings. Clamped rather than trusted: a negative or absurd value here
  // would show every PayPal customer a wrong total, and the exchange rate is
  // held inside the same sane band lib/fx.js enforces everywhere else.
  const numOr = (v, fallback, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) return fallback;
    return n;
  };
  db.set('site_settings.paypal_fee_percent', numOr(req.body.paypal_fee_percent, 4.4, 0, 100)).write();
  db.set('site_settings.paypal_fee_fixed',   numOr(req.body.paypal_fee_fixed, 15, 0, 10000)).write();
  db.set('site_settings.paypal_payout_usd',  numOr(req.body.paypal_payout_usd, 0.5, 0, 100)).write();
  db.set('site_settings.fx_manual_rate',     numOr(req.body.fx_manual_rate, 62.5, fx.RATE_MIN, fx.RATE_MAX)).write();
```

- [ ] **Step 5: Verify the round trip**

Save the form with the percentage changed to `5`, reload the admin page and confirm it shows `5`. Then open an order page and confirm the fee line moved (₱249 at 5% + ₱15 = ₱28, so fees combined becomes ₱60 and the total ₱309). Then submit `-3` in the percentage field and confirm it falls back to `4.4` rather than storing a negative.

- [ ] **Step 6: Commit**

```bash
git add views/partials/admin/settings.ejs server.js && git commit -m "feat: admin controls for PayPal fees and fallback rate"
```

---

### Task 7: Show the expected total in the admin queue

**Files:**
- Modify: `server.js:3224` (after `const orderQueue = await orders.listByStates(orders.OWNER_STATES);`)
- Modify: `views/partials/order-queue.ejs:238`

**Interfaces:**
- Consumes: `paypalQuoteFor(order)` from Task 4.
- Produces: nothing.

**Context:** when approving a payment the owner compares what landed in PayPal against the order. `amount_due` is the wrong number to compare against for a PayPal order — the customer was asked for the fee-inclusive total. Without this the owner will reject correct payments as overpayments.

- [ ] **Step 1: Attach the expected total**

Directly after line 3224:

```js
  // A PayPal customer was asked for the fee-inclusive total, not amount_due —
  // so the queue must show that number, or the owner compares the receipt
  // against the wrong figure and rejects a correct payment as an overpayment.
  orderQueue.forEach(o => {
    if (o && o.payment_method === 'paypal') {
      const q = paypalQuoteFor(o);
      if (q) o.paypal_expected = q.total;
    }
  });
```

- [ ] **Step 2: Render it**

Replace line 238:

```ejs
          <% if (o.payment_method) { %><span class="oq-method"><%= o.payment_method.toUpperCase() %></span><% } %>
```

with:

```ejs
          <% if (o.payment_method) { %><span class="oq-method"><%= o.payment_method.toUpperCase() %></span><% } %>
          <% if (o.paypal_expected) { %><span class="oq-expected">expect ₱<%= o.paypal_expected %></span><% } %>
```

- [ ] **Step 3: Style it**

Append to `public/css/style.css` beside the existing `.oq-method` rule:

```css
/* The fee-inclusive figure a PayPal customer was actually asked to send. */
.oq-expected { font-size: 0.75rem; opacity: 0.75; margin-left: 0.4rem; white-space: nowrap; }
```

- [ ] **Step 4: Verify**

Put a test order into `verifying_payment` with `payment_method: 'paypal'`, open the admin order queue, and confirm the row shows `PAYPAL` followed by `expect ₱307`. Confirm a GCash order in the same state shows `GCASH` and no expect badge.

- [ ] **Step 5: Commit**

```bash
git add server.js views/partials/order-queue.ejs public/css/style.css && git commit -m "feat: show fee-inclusive expected total on PayPal orders"
```

---

## Final verification

- [ ] **Run the whole suite**

```bash
for t in scripts/test-*.js; do echo "== $t"; node "$t" || exit 1; done
```

Expected: every script passes, including the two new ones.

- [ ] **Deploy and confirm**

```bash
git push
```

Railway redeploys. Per this project's convention a plain 200 does not prove new code is live — poll until you see the 502/000 blip and then a 200 before checking anything.

- [ ] **Post-deploy smoke test**

With PayPal enabled, open a real `awaiting_payment` order and confirm the PayPal tab, the ₱307 total, the dollar estimate, and the pre-filled `paypal.me` link. Then check `site_settings.fx_rate_cache` holds a live rate fetched from production rather than the seeded fallback.

## Owner action required before this can be used

Enabling the method needs a **PayPal Business account** with a PayPal.Me handle. Not a personal account — receiving goods-and-services payments on one risks a limitation. Everything above ships and sits dormant until the handle is filled in and the checkbox ticked.
