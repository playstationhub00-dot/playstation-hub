# Payment Events — Monthly Revenue Attribution Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make extension money count toward the month it was actually paid, instead of the month the rental originally started.

**Architecture:** Today a customer record holds one `price` and one `start_date`, so it can only ever represent a single revenue event — an extension mutates `price` in place and the dashboard, which buckets by `start_date`, files the new money under the original month. This adds a `payments[]` array to each customer where every payment carries its own date, and switches the dashboard to sum payments by their own dates rather than summing `price` by the rental's start date. `price` stays as the running total so nothing else that reads it breaks.

**Tech Stack:** Express.js + EJS server-rendered views, lowdb (`games.json`) synced to MongoDB. No test framework; the payment-attribution logic gets a plain assert-based Node script under `scripts/` (zero new dependencies), and the dashboard is verified live on Railway.

## Root cause (confirmed before writing this plan)

- `dashCustDate(c)` (`views/admin.ejs:1557`) returns `c.start_date || c.created_at` — the original rental start.
- `dashFilterMonth(year, month)` (`views/admin.ejs:1577`) buckets customers into months using that date, and monthly revenue sums `price` across that bucket.
- `POST /admin/customers/edit/:id` updates the existing record in place: it writes new `end_date` and `price` but never touches `start_date`.

So a rental started 15 June and extended 8 August has `start_date = 2026-06-15` and a `price` that now includes August's payment — and 100% of it lands in June. Unique-renter counts use the same bucket, which is the second half of the reported symptom.

## Global Constraints

- `payments[]` is the new source of truth for **revenue attribution only**. `price` remains the running total and keeps its current meaning for every other consumer (customer table, exports, swap top-up math in `computeSwapReferencePrice`) (root cause analysis above).
- Every existing customer is backfilled with exactly one payment, dated at their `start_date` (falling back to `created_at`), for their current `price` — so **historical monthly totals must come out identical to today's** (user decision: "Backfill one payment at the start date").
- Past extensions cannot be recovered — that information was never recorded. The backfill reproduces today's numbers; it does not retroactively correct old mis-attributions (stated to user before approval).
- An extension is detected in the edit route as **a price increase on an existing customer**, since that is literally how the owner performs one (user decision: "Edit the customer — change end date and price").
- A payment's date is the date the edit was made (today), not the rental's start or end date.
- Payment amounts are the **delta**, not the new total: extending ₱499 → ₱998 records a ₱499 payment, so the sum of `payments[].amount` always equals `price`.
- No change to the customers table UI, the Excel export, account slots, or the rental lifecycle — this is revenue attribution only.
- EJS tag-balance (`<%` == `%>`) verified for `views/admin.ejs` before committing; `node -c server.js` must exit 0 — established project conventions.
- No local dev server — live verification against https://playstation-hub.com after `git push` (Railway auto-deploys, ~60-90s).

---

### Task 1: `payments[]` on the customer model, with backfill

**Files:**
- Modify: `server.js` (`normalizeCustomer`, around `server.js:403`)
- Create: `scripts/test-payments.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: every customer returned by `getCustomers()`/`getCustomer()` carries `payments: [{ amount, date, kind }]` where `kind` is `'rental'` or `'extension'`. Exported helper `sumPaymentsInMonth(customers, year, month)` → `number`, and `rentersInMonth(customers, year, month)` → `number`, both used by Task 3 and covered by the test script.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-payments.js`:

```js
// Plain assert-based test for payment attribution. No test framework in this
// project by design — run with `node scripts/test-payments.js`, which exits
// non-zero on the first failed assertion.
const assert = require('assert');
const { normalizeCustomerPayments, sumPaymentsInMonth, rentersInMonth } = require('../lib/payments');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

check('backfills a single payment at the start date', () => {
  const c = normalizeCustomerPayments({ price: 499, start_date: '2026-06-15', created_at: '2026-06-15T02:00:00.000Z' });
  assert.deepStrictEqual(c.payments, [{ amount: 499, date: '2026-06-15', kind: 'rental' }]);
});

check('falls back to created_at when there is no start date', () => {
  const c = normalizeCustomerPayments({ price: 300, start_date: '', created_at: '2026-05-02T08:00:00.000Z' });
  assert.strictEqual(c.payments[0].date, '2026-05-02');
});

check('leaves an existing payments array alone', () => {
  const existing = [{ amount: 100, date: '2026-01-01', kind: 'rental' }];
  const c = normalizeCustomerPayments({ price: 999, start_date: '2026-06-15', payments: existing });
  assert.deepStrictEqual(c.payments, existing);
});

check('a zero-price customer gets no payment row', () => {
  const c = normalizeCustomerPayments({ price: 0, start_date: '2026-06-15' });
  assert.deepStrictEqual(c.payments, []);
});

check('the backfill reproduces the old single-price total', () => {
  const list = [
    normalizeCustomerPayments({ price: 499, start_date: '2026-06-15' }),
    normalizeCustomerPayments({ price: 300, start_date: '2026-06-20' })
  ];
  assert.strictEqual(sumPaymentsInMonth(list, 2026, 5), 799); // month is 0-indexed: 5 = June
});

check('an extension counts in the month it was paid, not the rental month', () => {
  const c = { customer_name: 'Ana', payments: [
    { amount: 499, date: '2026-06-15', kind: 'rental' },
    { amount: 499, date: '2026-08-08', kind: 'extension' }
  ]};
  assert.strictEqual(sumPaymentsInMonth([c], 2026, 5), 499); // June
  assert.strictEqual(sumPaymentsInMonth([c], 2026, 7), 499); // August
});

check('a renter counts in every month they paid in', () => {
  const c = { customer_name: 'Ana', payments: [
    { amount: 499, date: '2026-06-15', kind: 'rental' },
    { amount: 499, date: '2026-08-08', kind: 'extension' }
  ]};
  assert.strictEqual(rentersInMonth([c], 2026, 5), 1);
  assert.strictEqual(rentersInMonth([c], 2026, 7), 1);
  assert.strictEqual(rentersInMonth([c], 2026, 6), 0); // July — no payment
});

check('the same person paying twice in one month counts once', () => {
  const list = [
    { customer_name: 'Ana', payments: [{ amount: 100, date: '2026-08-02', kind: 'rental' }] },
    { customer_name: ' ana ', payments: [{ amount: 100, date: '2026-08-20', kind: 'extension' }] }
  ];
  assert.strictEqual(rentersInMonth(list, 2026, 7), 1);
  assert.strictEqual(sumPaymentsInMonth(list, 2026, 7), 200);
});

console.log('\n' + passed + ' assertions passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-payments.js`
Expected: FAIL with `Cannot find module '../lib/payments'`.

- [ ] **Step 3: Create `lib/payments.js`**

```js
// Revenue attribution. A customer record holds one running `price`, which can
// only describe a single revenue event — so an extension (which raises `price`
// in place) used to land in the month the rental STARTED rather than the month
// it was paid. Each payment now carries its own date, and revenue is summed
// from payments rather than from `price`.
//
// `price` is deliberately left alone as the running total: the customers table,
// the Excel export and the swap top-up math all still read it.

// Existing records predate payments[], so they are backfilled with one payment
// at the rental's start date for the full price. That reproduces today's
// monthly totals exactly — no past month shifts. Extensions made before this
// change were never recorded separately and cannot be recovered.
function normalizeCustomerPayments(c) {
  if (!c) return c;
  if (Array.isArray(c.payments)) return c;
  const amount = c.price || 0;
  if (!amount) { c.payments = []; return c; }
  const date = c.start_date || (c.created_at ? String(c.created_at).slice(0, 10) : '');
  c.payments = date ? [{ amount, date, kind: 'rental' }] : [];
  return c;
}

function paymentsIn(customers, year, month) {
  const out = [];
  (customers || []).forEach(c => {
    (c.payments || []).forEach(p => {
      if (!p || !p.date) return;
      const d = new Date(p.date + 'T00:00:00');
      if (isNaN(d.getTime())) return;
      if (d.getFullYear() === year && d.getMonth() === month) out.push({ c, p });
    });
  });
  return out;
}

function sumPaymentsInMonth(customers, year, month) {
  return paymentsIn(customers, year, month).reduce((s, x) => s + (x.p.amount || 0), 0);
}

// Someone who paid twice in a month is still one renter, matching how the
// dashboard already counts unique renters by name.
function rentersInMonth(customers, year, month) {
  const names = new Set();
  paymentsIn(customers, year, month).forEach(x => {
    if (x.c.customer_name) names.add(String(x.c.customer_name).trim().toLowerCase());
  });
  return names.size;
}

module.exports = { normalizeCustomerPayments, paymentsIn, sumPaymentsInMonth, rentersInMonth };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-payments.js`
Expected: PASS — eight `ok -` lines then `8 assertions passed`.

- [ ] **Step 5: Wire the backfill into `normalizeCustomer`**

In `server.js`, add the require next to the existing `lib/availability` one at `server.js:10`:

```js
const { normalizeCustomerPayments } = require('./lib/payments');
```

Then find `normalizeCustomer` (`server.js:403`):

```js
function normalizeCustomer(c) {
  if (!c) return c;
  c.swap_history = Array.isArray(c.swap_history) ? c.swap_history : [];
  return c;
}
```

Change to:

```js
function normalizeCustomer(c) {
  if (!c) return c;
  c.swap_history = Array.isArray(c.swap_history) ? c.swap_history : [];
  normalizeCustomerPayments(c);
  return c;
}
```

This backfills on read. It does not write to the database — records gain a
persisted `payments` array the next time they are saved, and until then the
backfill is recomputed identically on every read, so totals are stable either way.

- [ ] **Step 6: Syntax-check and commit**

Run: `node -c server.js` — expect exit 0, no output.

```bash
git add lib/payments.js scripts/test-payments.js server.js
git commit -m "$(cat <<'EOF'
Add per-payment revenue attribution with backfill

A customer record holds one price and one start date, so it can only
describe a single revenue event — an extension raises price in place and
the dashboard, which buckets by start_date, files the new money under
the month the rental originally started.

lib/payments.js introduces a payments[] array where each payment carries
its own date, plus month-summing helpers. Existing customers backfill to
a single payment at their start date for their full price, so historical
monthly totals are unchanged. price stays as the running total for the
customers table, exports, and swap top-up math.
EOF
)"
```

---

### Task 2: Record a payment when a rental is created or extended

**Files:**
- Modify: `server.js` — `POST /admin/customers/add` (the `db.get('customers').push({...})` call) and `POST /admin/customers/edit/:id` (the `.assign({...})` call)

**Interfaces:**
- Consumes: `normalizeCustomerPayments` from Task 1 (already applied on read via `normalizeCustomer`).
- Produces: customers whose `payments[]` grows by one entry each time the price rises, dated the day the edit was made. Consumed by Task 3's dashboard.

- [ ] **Step 1: Record the initial payment on create**

In `POST /admin/customers/add`, find the object passed to `db.get('customers').push({...})` and add one field alongside `price: priceVal` (keep every existing field exactly as-is):

```js
    // The first payment is dated to the rental's start so a backdated entry
    // lands in the month it belongs to, matching the backfill rule.
    payments: priceVal > 0
      ? [{ amount: priceVal, date: (start_date || new Date().toISOString().slice(0, 10)), kind: 'rental' }]
      : [],
```

- [ ] **Step 2: Append a payment when the price rises on edit**

In `POST /admin/customers/edit/:id`, locate the `existing` record lookup (already present as `const existing = getCustomer(req.params.id);`) and the final `.assign({...})`. Immediately **before** the `.assign(`, insert:

```js
  // An extension is performed by editing the customer and raising the price,
  // so a price increase IS the payment event. Record only the delta, dated
  // today — not the rental's start — so the money counts in the month it was
  // actually taken. The running `price` still ends up as the sum of payments.
  const prevPrice = existing.price || 0;
  const newPrice = parseInt(finalPrice) || 0;
  const priceDelta = newPrice - prevPrice;
  const existingPayments = Array.isArray(existing.payments) ? existing.payments.slice() : [];
  if (priceDelta > 0 && prevPrice > 0) {
    existingPayments.push({
      amount: priceDelta,
      date: new Date().toISOString().slice(0, 10),
      kind: 'extension'
    });
  }
```

Then add `payments: existingPayments,` as a field inside that same `.assign({ ... })` object.

Note on the guard: `prevPrice > 0` means a customer whose price was previously
0 (a reservation being converted, or an entry saved before the amount was
known) gets a corrected first payment through the Task 1 backfill on next read
rather than a spurious "extension" row.

- [ ] **Step 3: Syntax-check**

Run: `node -c server.js`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "$(cat <<'EOF'
Record a payment event on rental creation and extension

New rentals store their first payment dated at the rental's start.
Editing a customer to raise the price — which is exactly how an
extension is performed — appends a payment for the delta dated today,
so extension money counts in the month it was taken rather than the
month the rental began.
EOF
)"
```

---

### Task 3: Sum the dashboard from payments instead of `price`

**Files:**
- Modify: `server.js` (the `dashboardData` mapping, around `server.js:1225`)
- Modify: `views/admin.ejs` (`dashCustDate`/`dashFilterMonth` region, `views/admin.ejs:1557-1578`, and the monthly revenue + unique-renter figures that consume them)

**Interfaces:**
- Consumes: `payments[]` from Tasks 1-2.
- Produces: corrected monthly revenue and renter counts. Final task.

- [ ] **Step 1: Ship `payments` to the client dashboard**

In `server.js`, find the `dashboardData` mapping (`server.js:1225`):

```js
  const dashboardData = customers.map(c => ({
    price: c.price || 0, status: c.status, start_date: c.start_date || '', created_at: c.created_at || '',
    end_date: c.end_date || '', game_title: c.game_title || '', customer_name: c.customer_name || ''
  }));
```

Add `payments` to the projection:

```js
  const dashboardData = customers.map(c => ({
    price: c.price || 0, status: c.status, start_date: c.start_date || '', created_at: c.created_at || '',
    end_date: c.end_date || '', game_title: c.game_title || '', customer_name: c.customer_name || '',
    payments: c.payments || []
  }));
```

- [ ] **Step 2: Add payment-based month helpers to the dashboard script**

In `views/admin.ejs`, find `dashFilterMonth` (`views/admin.ejs:1577`) and add these two functions immediately after it:

```js
      // Revenue and renter counts come from payments, each carrying its own
      // date — an extension paid in August counts in August even though the
      // rental started in June. dashFilterMonth stays as-is: it answers "which
      // rentals STARTED this month", which is still the right question for
      // rental-count and top-game figures.
      function dashPaymentsIn(year, month) {
        const out = [];
        DASH_DATA.forEach(function (c) {
          (c.payments || []).forEach(function (p) {
            if (!p || !p.date) return;
            const d = new Date(p.date + 'T00:00:00');
            if (isNaN(d.getTime())) return;
            if (d.getFullYear() === year && d.getMonth() === month) out.push({ c: c, p: p });
          });
        });
        return out;
      }
      function dashRevenueInMonth(year, month) {
        return dashPaymentsIn(year, month).reduce(function (s, x) { return s + (x.p.amount || 0); }, 0);
      }
      function dashRentersInMonth(year, month) {
        const names = new Set();
        dashPaymentsIn(year, month).forEach(function (x) {
          if (x.c.customer_name) names.add(String(x.c.customer_name).trim().toLowerCase());
        });
        return names.size;
      }
```

- [ ] **Step 3: Point the monthly figures at the new helpers**

Search `views/admin.ejs` for every place that computes a per-month revenue total
by reducing `price` over `dashFilterMonth(...)` — the monthly breakdown table and
the month drill-down both do this. Replace each such reduction with
`dashRevenueInMonth(year, month)`, and replace each per-month unique-renter count
(currently `dashUniqueRenters(dashFilterMonth(year, month))`) with
`dashRentersInMonth(year, month)`.

Leave untouched: any figure counting **rentals started** in a month, the top-games
list, and the all-time totals that sum `price` across all customers — those remain
correct, because the sum of a customer's payments always equals their `price`.

- [ ] **Step 4: Verify balance and syntax**

Run: `node -c server.js` — expect exit 0.
Run: `grep -o '<%' views/admin.ejs | wc -l` and `grep -o '%>' views/admin.ejs | wc -l` — expect equal.
Run: `node scripts/test-payments.js` — expect `8 assertions passed`.

- [ ] **Step 5: Commit and deploy**

```bash
git add server.js views/admin.ejs
git commit -m "$(cat <<'EOF'
Sum dashboard revenue and renters from dated payments

Monthly revenue and unique-renter counts now come from payments, each
carrying the date it was taken, instead of summing a customer's running
price into the month their rental started. Rental counts and top-games
still use the rental start date, which is the right basis for those.
EOF
)"
git push origin main
```

- [ ] **Step 6: Wait for the deploy**

Run: `until curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/ | grep -q 200; do sleep 5; done; echo done`

- [ ] **Step 7: Verify historical totals did not shift**

Before deploying, record the current all-time and per-month figures from the admin
Business Dashboard (Total Earned, Rental Revenue, and the monthly breakdown for the
last three months). After deploying, reload and confirm **every one of those numbers
is unchanged** — the backfill dates each existing payment at the rental's start, so
past months must reproduce exactly. Any movement means the backfill is wrong, not
the dashboard.

- [ ] **Step 8: Verify an extension lands in the current month**

In admin, pick a live renting customer, note their price and which month their
revenue currently sits in, then edit them: push the end date out and raise the
price by a known amount (e.g. +₱499). Save, then confirm on the dashboard that:
- The current month's revenue rose by exactly ₱499.
- The original rental month's revenue did **not** change.
- The customer now counts as a renter in the current month as well.

Then reverse the test edit by lowering the price back — note that this leaves the
recorded extension payment in place (payments are an audit trail, not a mirror of
`price`), so either delete the test customer or accept the stray entry, and say
which you did when reporting.

- [ ] **Step 9: Report results**

Summarize the before/after historical figures from Step 7, the extension test from
Step 8, and flag anything that did not match expectation.
