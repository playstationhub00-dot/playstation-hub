# Rental Orders v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer place a rental order on the website, pick GCash or Maya and see the QR and details needed to pay, tell us they paid via a pre-written Messenger message, and track the order through an eight-state lifecycle at a no-login reference link — while the owner gets a single queue containing exactly the orders that need them.

**Architecture:** One new self-contained module (`lib/orders.js`) owns the order state machine and persists orders as **individual MongoDB documents**, reusing the Mongo connection `server.js` already opens. Everything else in the app keeps its existing lowdb-plus-whole-state-blob storage untouched. New public routes render one new view (`views/order-status.ejs`); the owner's queue is a new tab inside the existing `views/admin.ejs`. The current direct-to-Messenger rent flow keeps working in parallel — orders are purely additive.

**Tech Stack:** Express.js + EJS server-rendered views, vanilla JS (no framework, no bundler), `mongodb` driver (already a dependency), `multer` + `sharp` for uploads (already used by every other upload route). No test framework exists in this project; `lib/orders.js` gets a plain assert-based Node script under `scripts/` (zero new dependencies), and everything else is verified live on Railway.

## Global Constraints

- All PSN accounts have 2FA enabled — **no automated credential release anywhere in this plan**, permanently, not deferred (spec: Decisions taken before this design).
- QR-primary sign-in: the customer uploads a QR from their console, the owner scans it, the customer never learns the account password (spec: Decisions #2).
- Payment is verified by hand — no GCash/Maya webhook, no auto-confirmation (spec: Decisions #3).
- The order is **always created on the website**. Facebook is never an entry point, only an alternative channel for submitting proof (spec: Approach).
- Eight states exactly: `awaiting_payment`, `verifying_payment`, `awaiting_qr`, `qr_pending`, `active`, `awaiting_return`, `verifying_return`, `closed`. Terminal exits: `cancelled`, `payment_rejected` (spec: Order lifecycle).
- `qr_pending` carries a **10-minute countdown**; on lapse the order returns to `awaiting_qr` and the customer may re-upload without limit (spec: The QR retry loop).
- Reference code format is `PH-NNNN`, e.g. `PH-4821` (spec: Order document fields).
- `deposit_due` is ₱100 for `tr`/`ps4` and ₱0 for `nt`, read from `site_settings.promo.deposit` (spec: Order document fields).
- `fb_name` is **required** on every order (spec: Order document fields).
- `price_snapshot` freezes the tier's prices at order time so a later swap compares against what the customer actually paid (spec: Order document fields).
- QR upload is **website-only** — never offered via Messenger, because the countdown is the entire mechanism (spec: Customer-facing surfaces).
- Only `orders` moves to real MongoDB documents. Games, price categories, PS Plus data, and site settings stay on lowdb (spec: New `orders` collection).
- **Messenger has no `?text=` URL parameter.** Unlike WhatsApp's `wa.me/…?text=`, an `m.me` link cannot pre-fill the composer. The customer copies the pre-written message from the page and pastes it. Any step that appears to pre-fill Messenger text is wrong.
- **Every link to Messenger carries `?ref=<order.ref>`.** This is invisible to the customer and changes nothing about their experience, but Facebook reports the ref alongside the sender's PSID to the webhook, which is the only way this app can ever learn which Facebook thread belongs to which order. This data cannot be backfilled later.
- **Dates are Manila dates (UTC+8), never UTC.** Railway runs in UTC, so `new Date().toISOString().slice(0,10)` rolls over eight hours early and is banned in this plan — the same bug that shifted every rental's end date by a day. Use `orders.manilaDate(d)` from Task 1.
- Out of scope: customer accounts/passwords, payment webhooks, automated credential release, account/game swaps, migrating any other collection, proactive Messenger sending (Task 5 only *captures* the PSID; nothing sends), and notifications beyond the on-page status and owner queue (spec: Out of scope for v1).
- EJS tag-balance (`<%` count == `%>` count) must be verified for every `.ejs` file touched, before committing — established project convention.
- CSS brace-balance must be verified for `public/css/style.css` before committing — established project convention.
- `node -c server.js` must exit 0 after every `server.js` change.
- No local dev server exists — live verification happens against https://playstation-hub.com after `git push` (Railway auto-deploys, ~60-90s).

---

### Task 1: `lib/orders.js` — state machine and Mongo persistence

**Files:**
- Create: `lib/orders.js`
- Create: `scripts/test-orders.js`
- Modify: `server.js:10` (add the require), `server.js:364-402` (wire the existing Mongo getter into the module)

**Interfaces:**
- Consumes: `server.js`'s existing `_getMongoDb()` (defined at `server.js:366`), which returns a `Db` handle for database `pshub` or `null` when `MONGODB_URI` is unset.
- Produces, all from `lib/orders.js`:
  - `init(getDbFn)` — stores the injected async getter. Must be called once at startup.
  - `STATES` — frozen array of the eight lifecycle states in order.
  - `TERMINAL` — frozen array `['cancelled', 'payment_rejected']`.
  - `OWNER_STATES` — frozen array `['verifying_payment', 'qr_pending', 'verifying_return']`.
  - `QR_WINDOW_MS` — number, `600000`.
  - `manilaDate(dateObj)` → `string` — pure, `YYYY-MM-DD` in Manila time.
  - `parseOrderRef(raw)` → `string|null` — pure, validates the `PH-NNNN` shape.
  - `canTransition(from, to)` → `boolean` — pure, no I/O.
  - `nextRef()` → `Promise<string>` — allocates the next `PH-NNNN` code.
  - `create(fields)` → `Promise<order>` — inserts a new order in `awaiting_payment`.
  - `getByRef(ref)` → `Promise<order|null>`.
  - `listByStates(states)` → `Promise<order[]>` — newest first.
  - `transition(ref, toState, patch)` → `Promise<order|null>`.
  - `expireStaleQrs()` → `Promise<number>`.
  - `advanceEndedRentals()` → `Promise<number>`.
  - `markRefunded(ref)` → `Promise<boolean>`.
  - `linkPsid(ref, psid)` → `Promise<boolean>` — attaches a Messenger PSID to an order. Used only by Task 5.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-orders.js`:

```js
// Plain assert-based test for the order state machine. No test framework in
// this project by design — run with `node scripts/test-orders.js`, which exits
// non-zero on the first failed assertion.
const assert = require('assert');
const orders = require('../lib/orders');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

check('exposes the eight lifecycle states in order', () => {
  assert.deepStrictEqual(orders.STATES, [
    'awaiting_payment', 'verifying_payment', 'awaiting_qr', 'qr_pending',
    'active', 'awaiting_return', 'verifying_return', 'closed'
  ]);
});

check('owner states are exactly the three that need the owner', () => {
  assert.deepStrictEqual(orders.OWNER_STATES,
    ['verifying_payment', 'qr_pending', 'verifying_return']);
});

check('allows the normal forward path', () => {
  assert.strictEqual(orders.canTransition('awaiting_payment', 'verifying_payment'), true);
  assert.strictEqual(orders.canTransition('verifying_payment', 'awaiting_qr'), true);
  assert.strictEqual(orders.canTransition('awaiting_qr', 'qr_pending'), true);
  assert.strictEqual(orders.canTransition('qr_pending', 'active'), true);
  assert.strictEqual(orders.canTransition('active', 'awaiting_return'), true);
  assert.strictEqual(orders.canTransition('awaiting_return', 'verifying_return'), true);
  assert.strictEqual(orders.canTransition('verifying_return', 'closed'), true);
});

check('allows the QR retry loop back to awaiting_qr', () => {
  assert.strictEqual(orders.canTransition('qr_pending', 'awaiting_qr'), true);
});

check('allows payment rejection back to awaiting_payment', () => {
  assert.strictEqual(orders.canTransition('verifying_payment', 'payment_rejected'), true);
  assert.strictEqual(orders.canTransition('payment_rejected', 'awaiting_payment'), true);
});

check('rejects skipping the queue', () => {
  assert.strictEqual(orders.canTransition('awaiting_payment', 'active'), false);
  assert.strictEqual(orders.canTransition('awaiting_qr', 'closed'), false);
});

check('rejects moving backwards out of active', () => {
  assert.strictEqual(orders.canTransition('active', 'qr_pending'), false);
  assert.strictEqual(orders.canTransition('closed', 'active'), false);
});

check('allows cancelling only before active', () => {
  assert.strictEqual(orders.canTransition('awaiting_payment', 'cancelled'), true);
  assert.strictEqual(orders.canTransition('awaiting_qr', 'cancelled'), true);
  assert.strictEqual(orders.canTransition('active', 'cancelled'), false);
});

check('a rental that has run its course can be asked to return', () => {
  assert.strictEqual(orders.canTransition('active', 'awaiting_return'), true);
});

check('exposes the QR window as ten minutes', () => {
  assert.strictEqual(orders.QR_WINDOW_MS, 600000);
});

check('manilaDate reads the Manila calendar day, not the UTC one', () => {
  // 2026-08-09T17:00:00Z is already 2026-08-10 in Manila (UTC+8). Slicing the
  // ISO string would wrongly say the 9th — this is the bug that shifted every
  // rental end date by a day.
  assert.strictEqual(orders.manilaDate(new Date('2026-08-09T17:00:00Z')), '2026-08-10');
  // And a timestamp that is the same day in both zones must not drift forward.
  assert.strictEqual(orders.manilaDate(new Date('2026-08-09T03:00:00Z')), '2026-08-09');
});

check('parseOrderRef accepts only the PH-NNNN shape', () => {
  assert.strictEqual(orders.parseOrderRef('PH-4821'), 'PH-4821');
  assert.strictEqual(orders.parseOrderRef('  ph-4821 '), 'PH-4821');
  assert.strictEqual(orders.parseOrderRef('PH-12345'), 'PH-12345');
  // Anything a stranger could put in an m.me?ref= URL must be rejected.
  assert.strictEqual(orders.parseOrderRef(''), null);
  assert.strictEqual(orders.parseOrderRef(null), null);
  assert.strictEqual(orders.parseOrderRef('PH-12'), null);
  assert.strictEqual(orders.parseOrderRef('GET_STARTED'), null);
  assert.strictEqual(orders.parseOrderRef({ $ne: null }), null);
});

console.log('\n' + passed + ' assertions passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-orders.js`
Expected: FAIL with `Cannot find module '../lib/orders'`.

- [ ] **Step 3: Write `lib/orders.js`**

Create `lib/orders.js`:

```js
// Order lifecycle + persistence. Unlike every other collection in this app,
// orders live as individual MongoDB documents rather than inside the
// whole-state blob that server.js rewrites on each save — orders are written
// by customers and are money-adjacent, so they cannot tolerate that model's
// last-write-wins behaviour.
const STATES = Object.freeze([
  'awaiting_payment', 'verifying_payment', 'awaiting_qr', 'qr_pending',
  'active', 'awaiting_return', 'verifying_return', 'closed'
]);
const TERMINAL = Object.freeze(['cancelled', 'payment_rejected']);
const OWNER_STATES = Object.freeze(['verifying_payment', 'qr_pending', 'verifying_return']);

// QR codes from a PS5 expire within minutes, so a code submitted overnight is
// worthless by morning. This window is what the countdown counts down.
const QR_WINDOW_MS = 10 * 60 * 1000;

const ALLOWED = {
  awaiting_payment:  ['verifying_payment', 'cancelled'],
  verifying_payment: ['awaiting_qr', 'payment_rejected', 'cancelled'],
  payment_rejected:  ['awaiting_payment', 'cancelled'],
  awaiting_qr:       ['qr_pending', 'cancelled'],
  qr_pending:        ['active', 'awaiting_qr', 'cancelled'],
  active:            ['awaiting_return'],
  awaiting_return:   ['verifying_return'],
  verifying_return:  ['closed', 'awaiting_return'],
  closed:            [],
  cancelled:         []
};

function canTransition(from, to) {
  return Array.isArray(ALLOWED[from]) && ALLOWED[from].includes(to);
}

// Railway runs in UTC but this business runs on Manila time (UTC+8), so
// toISOString().slice(0,10) reports the previous calendar day for the whole
// Manila morning. Shift into Manila first, then read the date parts.
function manilaDate(d) {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// The ref on an m.me link is attacker-controllable — anyone can open
// m.me/OurPage?ref=<anything>. Only the exact PH-NNNN shape is allowed
// through, so a hostile or malformed payload never reaches a Mongo query.
function parseOrderRef(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const m = /^PH-(\d{4,})$/i.exec(String(raw).trim());
  return m ? 'PH-' + m[1] : null;
}

let _getDb = null;
function init(getDbFn) { _getDb = getDbFn; }

async function _col(name) {
  if (!_getDb) throw new Error('lib/orders: init(getDb) was never called');
  const db = await _getDb();
  return db ? db.collection(name) : null;
}

async function nextRef() {
  const counters = await _col('counters');
  if (!counters) return 'PH-0001';
  const r = await counters.findOneAndUpdate(
    { _id: 'orderRef' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const seq = (r && r.value ? r.value.seq : (r ? r.seq : 1)) || 1;
  return 'PH-' + String(seq).padStart(4, '0');
}

async function create(fields) {
  const col = await _col('orders');
  if (!col) throw new Error('lib/orders: no database available');
  const now = new Date().toISOString();
  const order = Object.assign({
    ref: await nextRef(),
    state: 'awaiting_payment',
    payment_proof: null,
    payment_channel: null,
    payment_method: null,
    qr_image: null,
    qr_expires_at: null,
    return_proof: null,
    deposit_refunded: false,
    psid: null,
    psid_linked_at: null,
    start_date: '',
    end_date: '',
    created_at: now,
    state_history: [{ state: 'awaiting_payment', at: now }]
  }, fields);
  await col.insertOne(order);
  return order;
}

async function getByRef(ref) {
  const col = await _col('orders');
  if (!col) return null;
  const clean = parseOrderRef(ref);
  if (!clean) return null;
  return col.findOne({ ref: clean });
}

async function listByStates(states) {
  const col = await _col('orders');
  if (!col) return [];
  return col.find({ state: { $in: states } }).sort({ created_at: -1 }).toArray();
}

async function transition(ref, toState, patch) {
  const col = await _col('orders');
  if (!col) return null;
  const current = await getByRef(ref);
  if (!current) return null;
  if (!canTransition(current.state, toState)) return null;
  const at = new Date().toISOString();
  const update = Object.assign({}, patch || {}, { state: toState });
  await col.updateOne(
    { ref: current.ref, state: current.state },
    { $set: update, $push: { state_history: { state: toState, at } } }
  );
  return getByRef(current.ref);
}

// Sweeps QR codes whose window has closed back to awaiting_qr so the customer
// is asked for a fresh one instead of waiting on a code that can no longer work.
async function expireStaleQrs() {
  const col = await _col('orders');
  if (!col) return 0;
  const stale = await col.find({
    state: 'qr_pending',
    qr_expires_at: { $lt: new Date().toISOString() }
  }).toArray();
  let moved = 0;
  for (const o of stale) {
    const r = await transition(o.ref, 'awaiting_qr', { qr_image: null, qr_expires_at: null });
    if (r) moved++;
  }
  return moved;
}

// Rentals whose end date has passed move themselves into awaiting_return, so
// the customer is prompted for return proof without the owner having to notice
// the date. Nothing else triggers this transition.
async function advanceEndedRentals() {
  const col = await _col('orders');
  if (!col) return 0;
  const today = manilaDate(new Date());
  const ended = await col.find({ state: 'active', end_date: { $lt: today, $ne: '' } }).toArray();
  let moved = 0;
  for (const o of ended) {
    const r = await transition(o.ref, 'awaiting_return', {});
    if (r) moved++;
  }
  return moved;
}

// A flag on an already-closed order, not a lifecycle move — transition() would
// reject closed→closed, so this writes directly.
async function markRefunded(ref) {
  const col = await _col('orders');
  if (!col) return false;
  const clean = parseOrderRef(ref);
  if (!clean) return false;
  const r = await col.updateOne({ ref: clean }, { $set: { deposit_refunded: true } });
  return r.modifiedCount > 0;
}

// Attaches a Messenger PSID to an order. This is the only place the app ever
// learns which Facebook thread belongs to which order, and it is not
// reconstructable after the fact — hence capturing it from day one even though
// nothing sends messages yet.
async function linkPsid(ref, psid) {
  const col = await _col('orders');
  if (!col) return false;
  const clean = parseOrderRef(ref);
  if (!clean || !psid) return false;
  const r = await col.updateOne(
    { ref: clean },
    { $set: { psid: String(psid), psid_linked_at: new Date().toISOString() } }
  );
  return r.modifiedCount > 0;
}

module.exports = {
  STATES, TERMINAL, OWNER_STATES, QR_WINDOW_MS,
  init, canTransition, manilaDate, parseOrderRef,
  nextRef, create, getByRef, listByStates, transition,
  expireStaleQrs, advanceEndedRentals, markRefunded, linkPsid
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-orders.js`
Expected: PASS — twelve `ok -` lines followed by `12 assertions passed`.

- [ ] **Step 5: Wire the module into `server.js`**

At `server.js:10`, after the existing `const computeAvailability = require('./lib/availability');`, add:

```js
const orders = require('./lib/orders');
```

Then find the end of the Mongo section — the `db.write` override that ends at `server.js:402`:

```js
const _origWrite = db.write.bind(db);
db.write = function() {
  const r = _origWrite();
  syncToMongo();
  return r;
};
```

Immediately after it, add:

```js
// Orders persist as their own MongoDB documents, reusing the connection the
// blob sync already maintains rather than opening a second pool.
orders.init(_getMongoDb);
```

- [ ] **Step 6: Syntax-check**

Run: `node -c server.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add lib/orders.js scripts/test-orders.js server.js
git commit -m "$(cat <<'EOF'
Add order state machine and Mongo-backed persistence

Introduces lib/orders.js owning the eight-state rental lifecycle and
storing orders as individual MongoDB documents, reusing the connection
server.js already maintains. Unlike every other collection, orders are
customer-written and money-adjacent, so they cannot use the whole-state
blob that gets replaced on every save.

Dates format through manilaDate() rather than toISOString().slice(),
which reports the previous day for the whole Manila morning on a
UTC server. parseOrderRef() gates every lookup because order refs
arrive from URLs a stranger can construct.

Covered by scripts/test-orders.js, a plain assert-based script (no test
framework added).
EOF
)"
```

---

### Task 2: Payment methods and Facebook page handle in settings

**Files:**
- Modify: `server.js:568` (seed `payment_methods` and `fb_page_username` in `getSiteSettings()`), plus a new `POST /admin/payment-methods` route near the existing `POST /admin/promo` at `server.js:1113`
- Modify: `views/admin.ejs` (new Payment Methods accordion in the settings tab)
- Modify: `public/css/style.css` (accordion styles)

**Interfaces:**
- Consumes: the existing `getSiteSettings()` seed/backfill pattern (`server.js:568`), `uploadPromoMedia` (`server.js:205`), `processUploadedImage(file, maxDim)` (`server.js:216`), `uploadsDir` (`server.js:34`), and the `requireAuth` middleware (`server.js:304`).
- Produces:
  - `site_settings.payment_methods` — array of `{ key, label, account_name, account_number, qr_image, enabled }`, read by Task 4's status page and Task 3's validation.
  - `site_settings.fb_page_username` — string, the `m.me/<username>` handle, read by Task 4 to build the referral link.

- [ ] **Step 1: Seed the new settings**

In `server.js`, inside `getSiteSettings()`, immediately **before** the closing `return s;` of the function, insert:

```js
  // Payment methods start disabled: until the owner has uploaded a QR and
  // filled in the account details, showing a customer an empty GCash panel is
  // worse than showing them nothing at all.
  if (!s.payment_methods) {
    db.set('site_settings.payment_methods', [
      { key: 'gcash', label: 'GCash', account_name: '', account_number: '', qr_image: '', enabled: false },
      { key: 'maya',  label: 'Maya',  account_name: '', account_number: '', qr_image: '', enabled: false }
    ]).write();
    s.payment_methods = db.get('site_settings.payment_methods').value();
  }
  // The m.me handle is a setting rather than a constant because the whole
  // referral link depends on it, and getting it wrong silently breaks PSID
  // capture with no visible symptom on the page.
  if (s.fb_page_username === undefined) {
    db.set('site_settings.fb_page_username', 'PlaystationHub00').write();
    s.fb_page_username = 'PlaystationHub00';
  }
```

- [ ] **Step 2: Add the save route**

In `server.js`, immediately **after** the closing `});` of the existing `app.post('/admin/promo', ...)` route (starts at `server.js:1113`), insert:

```js
// Payment method details + QR images. Mirrors /admin/promo: multipart because
// each method carries a QR image, and an unchanged file input leaves the
// existing image in place rather than blanking it.
app.post('/admin/payment-methods', requireAuth, uploadPromoMedia.fields([
  { name: 'qr_gcash', maxCount: 1 },
  { name: 'qr_maya',  maxCount: 1 }
]), async (req, res) => {
  const existing = db.get('site_settings.payment_methods').value() || [];
  const next = [];
  for (const m of existing) {
    const f = (req.files && req.files['qr_' + m.key]) ? req.files['qr_' + m.key][0] : null;
    let qr = m.qr_image || '';
    if (req.body['remove_qr_' + m.key] === 'on' && qr) {
      const fp = path.join(uploadsDir, path.basename(qr));
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      qr = '';
    }
    if (f) qr = await processUploadedImage(f, 900);
    next.push({
      key: m.key,
      label: m.label,
      account_name: (req.body['name_' + m.key] || '').trim(),
      account_number: (req.body['number_' + m.key] || '').trim(),
      qr_image: qr,
      // A method with no QR and no account number cannot be paid to, so it
      // stays off no matter what the checkbox says.
      enabled: req.body['enabled_' + m.key] === 'on' && !!(qr || (req.body['number_' + m.key] || '').trim())
    });
  }
  db.set('site_settings.payment_methods', next).write();
  db.set('site_settings.fb_page_username', (req.body.fb_page_username || '').trim().replace(/^@/, '')).write();
  res.redirect('/admin?tab=settings&msg=payment_saved');
});
```

- [ ] **Step 3: Add the admin accordion**

In `views/admin.ejs`, find the Message Templates accordion added by the message-templates work and insert this **immediately before** it:

```ejs
    <details class="admin-acc">
      <summary class="admin-acc-sum">💳 Payment Methods</summary>
      <div class="admin-acc-body">
        <form method="POST" action="/admin/payment-methods" enctype="multipart/form-data">
          <label class="pm-field">
            <span>Facebook page handle (the part after m.me/)</span>
            <input type="text" name="fb_page_username" value="<%= settings.fb_page_username || '' %>" placeholder="PlaystationHub00">
          </label>
          <p class="pm-note">
            Order links to Messenger are built as <code>m.me/&lt;handle&gt;?ref=PH-1234</code>.
            If the handle is wrong the link still opens Messenger, but we never learn
            which customer the order belongs to.
          </p>

          <% (settings.payment_methods || []).forEach(m => { %>
          <div class="pm-card">
            <div class="pm-card-head">
              <strong><%= m.label %></strong>
              <label class="pm-toggle">
                <input type="checkbox" name="enabled_<%= m.key %>" <%= m.enabled ? 'checked' : '' %>>
                <span>Show to customers</span>
              </label>
            </div>
            <label class="pm-field">
              <span>Account name</span>
              <input type="text" name="name_<%= m.key %>" value="<%= m.account_name %>">
            </label>
            <label class="pm-field">
              <span>Account number</span>
              <input type="text" name="number_<%= m.key %>" value="<%= m.account_number %>">
            </label>
            <label class="pm-field">
              <span>QR image</span>
              <input type="file" name="qr_<%= m.key %>" accept="image/*">
            </label>
            <% if (m.qr_image) { %>
            <div class="pm-qr-preview">
              <img src="<%= m.qr_image %>" alt="<%= m.label %> QR">
              <label class="pm-remove"><input type="checkbox" name="remove_qr_<%= m.key %>"> Remove this QR</label>
            </div>
            <% } %>
          </div>
          <% }) %>

          <button type="submit" class="admin-save-btn">Save payment methods</button>
        </form>
      </div>
    </details>
```

- [ ] **Step 4: Add the styles**

In `public/css/style.css`, append at the end of the file:

```css
.pm-card { background: #0d0d0d; border: 1px solid #222; border-radius: 12px; padding: 1rem; margin-bottom: 0.85rem; }
.pm-card-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.8rem; }
.pm-card-head strong { font-size: 1rem; }
.pm-toggle { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: #888; cursor: pointer; }
.pm-toggle input { accent-color: #22c55e; }
.pm-field { display: block; margin-bottom: 0.7rem; }
.pm-field span { display: block; font-size: 0.75rem; font-weight: 700; color: #666; margin-bottom: 0.3rem; }
.pm-field input[type="text"] { width: 100%; background: #111; border: 1.5px solid #222; border-radius: 8px; padding: 0.6rem 0.75rem; color: #fff; font-size: 0.88rem; font-family: inherit; }
.pm-field input[type="text"]:focus { outline: none; border-color: var(--ps-blue); }
.pm-field input[type="file"] { width: 100%; font-size: 0.8rem; color: #888; }
.pm-note { font-size: 0.76rem; color: #666; line-height: 1.6; margin: 0 0 1rem; }
.pm-note code { background: #111; padding: 0.1rem 0.35rem; border-radius: 4px; color: #aaa; }
.pm-qr-preview { display: flex; align-items: center; gap: 0.85rem; margin-top: 0.5rem; }
.pm-qr-preview img { width: 90px; height: 90px; object-fit: contain; background: #fff; border-radius: 8px; padding: 4px; }
.pm-remove { font-size: 0.78rem; color: #888; cursor: pointer; }
```

- [ ] **Step 5: Verify syntax and balance**

Run: `node -c server.js` — expect exit 0.
Run: `grep -o '<%' views/admin.ejs | wc -l` and `grep -o '%>' views/admin.ejs | wc -l` — expect equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — expect equal.

- [ ] **Step 6: Commit**

```bash
git add server.js views/admin.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Add payment method settings for GCash and Maya

Each method carries an account name, number, QR image, and an enabled
flag. Methods default to off and cannot be switched on without a QR or
an account number, so a customer is never shown a payment panel they
cannot actually pay into.

Also stores the Facebook page handle, since the m.me referral links
built in a later task depend on it and a wrong handle fails silently.
EOF
)"
```

---

### Task 3: Order creation from the game page

**Files:**
- Modify: `server.js` (new `POST /order/create` route, placed immediately before the `app.get('/game/:slug'...)` route at `server.js:1076`)
- Modify: `views/game-detail.ejs` (add a "Rent on the site" form beside the existing Messenger CTA)
- Modify: `public/css/style.css` (styles for the new form)

**Interfaces:**
- Consumes: `orders.create(fields)` from Task 1; the existing `resolveGamePrices(game)` (`server.js:523`), `getPriceCategory(id)` (`server.js:516`), `getSiteSettings()` (`server.js:568`), `getPromoDiscountPct(promo, days)`, and `gameSlug(title)` (`server.js:929`).
- Produces: order documents carrying `ref`, `game_id`, `game_title`, `account_type`, `days`, `price_tier_name`, `price_snapshot`, `amount_due`, `deposit_due`, `fb_name` — consumed by Tasks 4-8. Redirects to `/order/:ref`, the route Task 4 builds.

- [ ] **Step 1: Add the order creation route**

In `server.js`, immediately **before** the line `app.get('/game/:slug', (req, res) => {` (currently `server.js:1076`), insert:

```js
// Creates a rental order from the game page. Deliberately the only entry
// point — Facebook can carry payment proof later, but never creates an order,
// so nothing can bypass the owner's queue.
app.post('/order/create', async (req, res) => {
  const { game_id, account_type, days, fb_name } = req.body;
  const game = getGame(game_id);
  if (!game) return res.redirect('/browse');

  const name = (fb_name || '').trim();
  const type = ['nt', 'tr', 'ps4'].includes(account_type) ? account_type : null;
  const d = parseInt(days);
  if (!name || !type || !PROMO_DURATIONS.includes(d)) {
    return res.redirect('/game/' + gameSlug(game.title) + '?order_error=1');
  }

  const s = getSiteSettings();
  const promo = s.promo || {};
  const resolved = resolveGamePrices(game);
  // PS4 Primary has no price fields of its own and borrows Non-Trophy pricing,
  // matching computeSwapReferencePrice()'s existing behaviour.
  const priceType = type === 'ps4' ? 'nt' : type;
  const base = resolved[priceType + '_price_' + d + 'd'] || 0;
  if (!base) return res.redirect('/game/' + gameSlug(game.title) + '?order_error=1');

  const pct = getPromoDiscountPct(promo, d);
  const amountDue = pct > 0 ? base - Math.round(base * pct / 100) : base;
  const depositDue = (type === 'tr' || type === 'ps4') ? (promo.deposit || 0) : 0;

  // Freeze the tier's whole price set. A tier's prices can change after an
  // order is placed; snapshotting means a later swap compares against what the
  // customer actually paid rather than today's number.
  const cat = game.price_category_id ? getPriceCategory(game.price_category_id) : null;
  const snapshot = {
    nt_price_7d: resolved.nt_price_7d || 0, nt_price_30d: resolved.nt_price_30d || 0,
    tr_price_7d: resolved.tr_price_7d || 0, tr_price_30d: resolved.tr_price_30d || 0
  };

  try {
    const order = await orders.create({
      game_id: game.id,
      game_title: game.title,
      account_type: type,
      days: d,
      price_tier_name: cat ? cat.name : '',
      price_snapshot: snapshot,
      amount_due: amountDue,
      deposit_due: depositDue,
      fb_name: name
    });
    res.redirect('/order/' + order.ref);
  } catch (e) {
    console.error('[order create]', e.message);
    res.redirect('/game/' + gameSlug(game.title) + '?order_error=1');
  }
});
```

- [ ] **Step 2: Add the order form to the game page**

In `views/game-detail.ejs`, find the CTA block (the `<a ... id="ctaBtn">` and its hint, currently around `views/game-detail.ejs:271-280`):

```ejs
        <% if (!allUnavail) { %>
        <!-- CTA: Message Us (available slot) -->
        <a href="#" class="gd-cta-btn gd-cta-wait" id="ctaBtn" onclick="return handleMessageUs(event)">
          Pick an account type
        </a>
```

Immediately **after** the `ctaHint` div that follows it, insert this form:

```ejs
        <!-- Order on the site — runs in parallel with the Messenger CTA above -->
        <form method="POST" action="/order/create" class="gd-order-form" id="gdOrderForm">
          <input type="hidden" name="game_id" value="<%= game.id %>">
          <input type="hidden" name="account_type" id="orderType" value="">
          <input type="hidden" name="days" id="orderDays" value="">
          <div class="gd-order-or">or book on the site</div>
          <input type="text" name="fb_name" class="gd-order-name" placeholder="Your Facebook name" required>
          <button type="submit" class="gd-order-btn">Get my order link →</button>
          <div class="gd-order-note">You'll get a link to track your rental. No account needed.</div>
        </form>
```

- [ ] **Step 3: Keep the hidden inputs in sync with the selection**

In `views/game-detail.ejs`'s `<script>` block, find `updateCtaState()` and add these two lines at the very start of the function body, right after `if (!ctaBtn) return;`:

```js
  const oType = document.getElementById('orderType');
  const oDays = document.getElementById('orderDays');
  if (oType) oType.value = selectedType || '';
  if (oDays) oDays.value = selectedDays || '';
```

- [ ] **Step 4: Add the form styles**

In `public/css/style.css`, immediately after the `.gd-cta-hint` rule, add:

```css
.gd-order-form { margin-top: 1.1rem; padding-top: 1.1rem; border-top: 1px solid #1a1a1a; }
.gd-order-or { font-size: 0.72rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #444; text-align: center; margin-bottom: 0.7rem; }
.gd-order-name { width: 100%; background: #111; border: 1.5px solid #222; border-radius: 10px; padding: 0.75rem 0.9rem; color: #fff; font-size: 0.9rem; font-family: inherit; }
.gd-order-name:focus { outline: none; border-color: var(--ps-blue); }
.gd-order-btn { display: block; width: 100%; margin-top: 0.6rem; background: #1a1a1a; color: #ddd; border: 1.5px solid #2a2a2a; border-radius: 10px; padding: 0.8rem; font-weight: 800; font-size: 0.92rem; cursor: pointer; font-family: inherit; transition: border-color 0.15s, color 0.15s; }
.gd-order-btn:hover { border-color: var(--ps-blue); color: #fff; }
.gd-order-note { text-align: center; font-size: 0.72rem; color: #444; margin-top: 0.5rem; }
```

- [ ] **Step 5: Verify syntax and balance**

Run: `node -c server.js` — expect exit 0, no output.
Run: `grep -o '<%' views/game-detail.ejs | wc -l` and `grep -o '%>' views/game-detail.ejs | wc -l` — expect equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — expect equal.

- [ ] **Step 6: Commit**

```bash
git add server.js views/game-detail.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Add order creation from the game page

POST /order/create builds an order from the selected type and duration,
freezing the price tier's full price set so a later swap can compute a
top-up against what the customer actually paid. Requires a Facebook
name. Runs alongside the existing Messenger CTA rather than replacing
it, so nothing breaks if the order flow sees no traffic.
EOF
)"
```

---

### Task 4: Status page — payment method picker and pre-written message

**Files:**
- Create: `views/order-status.ejs`
- Modify: `server.js` (add `GET /order/:ref`, `POST /order/:ref/payment-proof`, and a `uploadOrderFile` multer instance)
- Modify: `public/css/style.css` (status page styles)

**Interfaces:**
- Consumes: `orders.getByRef(ref)`, `orders.transition(ref, toState, patch)`, `orders.expireStaleQrs()`, `orders.advanceEndedRentals()` from Task 1; `site_settings.payment_methods` and `site_settings.fb_page_username` from Task 2; order documents created by Task 3; the existing `processUploadedImage(file, maxDim)` helper (`server.js:216`) and `getSiteSettings()`.
- Produces: the `/order/:ref` page that Tasks 6-8 extend with further step UI. Establishes `uploadOrderFile` (a `multer` instance writing into `uploadsDir`), reused by Task 6's QR upload and Task 7's return upload. Emits `m.me/<handle>?ref=<order.ref>` links, which Task 5's webhook handler consumes.

- [ ] **Step 1: Add the multer instance and the status route**

In `server.js`, immediately after the `POST /order/create` route added in Task 3, insert:

```js
// Separate multer instance for customer-supplied files so its limits stay
// independent of the admin upload paths.
const uploadOrderFile = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, 'order-' + Date.now() + path.extname(file.originalname))
  }),
  fileFilter: (req, file, cb) => cb(null, /jpeg|jpg|png|gif|webp/.test(file.mimetype)),
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.get('/order/:ref', async (req, res) => {
  // Sweep before rendering: lapsed QR windows go back to awaiting_qr so the
  // customer is asked for a fresh code rather than shown a dead countdown, and
  // rentals past their end date move to awaiting_return so the customer is
  // prompted to return without the owner having to spot the date.
  try {
    await orders.expireStaleQrs();
    await orders.advanceEndedRentals();
  } catch (e) { console.error('[order sweep]', e.message); }
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/browse');
  const s = getSiteSettings();
  res.render('order-status', {
    order,
    settings: s,
    payMethods: (s.payment_methods || []).filter(m => m.enabled),
    fbPage: s.fb_page_username || '',
    ownerOnline: !!(s.owner_online),
    announcement: getAnnouncement(),
    announcements: getAnnouncements(),
    msg: req.query.msg || null
  });
});

app.post('/order/:ref/payment-proof', uploadOrderFile.single('proof'), async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/browse');
  const channel = req.body.channel === 'messenger' ? 'messenger' : 'upload';
  const method = (req.body.method || '').trim().slice(0, 20) || null;
  let proofPath = null;
  if (channel === 'upload') {
    if (!req.file) return res.redirect('/order/' + order.ref + '?msg=no_file');
    proofPath = await processUploadedImage(req.file, 1400);
  }
  await orders.transition(order.ref, 'verifying_payment', {
    payment_proof: proofPath,
    payment_channel: channel,
    payment_method: method
  });
  res.redirect('/order/' + order.ref + '?msg=payment_submitted');
});
```

- [ ] **Step 2: Create the status page view**

Create `views/order-status.ejs`:

```ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order <%= order.ref %> — Playstation Hub</title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
<%- include('partials/announcement') %>
<%- include('partials/nav', { active: '' }) %>

<%
  const STEP_COPY = {
    awaiting_payment:  { title: 'Send your payment',       sub: 'Pay with GCash or Maya, then tell us below.' },
    verifying_payment: { title: 'Checking your payment',   sub: 'We\'re confirming it now. This page updates when we\'re done.' },
    awaiting_qr:       { title: 'Ready for sign-in',       sub: 'Open the sign-in QR on your console and send it here.' },
    qr_pending:        { title: 'Scanning your QR',        sub: 'Keep the QR on screen — we\'re signing you in.' },
    active:            { title: 'You\'re all set',         sub: 'Enjoy the game. Return the account by your end date.' },
    awaiting_return:   { title: 'Time to return',          sub: 'Sign out and send us proof to finish up.' },
    verifying_return:  { title: 'Checking your return',    sub: 'Almost done — we\'re confirming it now.' },
    closed:            { title: 'Rental complete',         sub: 'Thanks for renting with us!' },
    cancelled:         { title: 'Order cancelled',         sub: 'This order is no longer active.' },
    payment_rejected:  { title: 'Payment not confirmed',   sub: 'We couldn\'t match your payment. Please send proof again.' }
  };
  const step = STEP_COPY[order.state] || STEP_COPY.awaiting_payment;
  const typeLabel = order.account_type === 'tr' ? 'Trophy' : order.account_type === 'ps4' ? 'PS4 Primary' : 'Non-Trophy';
  const durLabel = order.days === 7 ? 'Weekly' : 'Monthly';
  const totalDue = (order.amount_due || 0) + (order.deposit_due || 0);

  // The message the customer copies and pastes into Messenger. Messenger has no
  // ?text= URL parameter — unlike WhatsApp, the composer cannot be pre-filled —
  // so this is shown on the page with a copy button instead.
  const premadeMsg =
    'Hi! I paid for order ' + order.ref + '.\n' +
    order.game_title + ' — ' + typeLabel + ', ' + durLabel + '\n' +
    'Amount: PHP ' + totalDue + '\n' +
    'Here\'s my proof of payment:';

  // ?ref= is invisible to the customer but comes back to our webhook paired
  // with their PSID, which is the only way we ever learn which Facebook thread
  // belongs to this order.
  const mmLink = fbPage ? 'https://m.me/' + fbPage + '?ref=' + order.ref : '';
%>

<div class="ord-page">
  <div class="ord-ref-bar">
    <span class="ord-ref-label">Your reference</span>
    <span class="ord-ref-code"><%= order.ref %></span>
  </div>

  <% if (msg === 'payment_submitted') { %><div class="ord-flash">Thanks — we'll confirm your payment shortly.</div><% } %>
  <% if (msg === 'no_file') { %><div class="ord-flash ord-flash-warn">Pick an image first, or use the Messenger option.</div><% } %>

  <h1 class="ord-title"><%= step.title %></h1>
  <p class="ord-sub"><%= step.sub %></p>

  <div class="ord-card">
    <div class="ord-row"><span>Game</span><span><%= order.game_title %></span></div>
    <div class="ord-row"><span>Account type</span><span><%= typeLabel %></span></div>
    <div class="ord-row"><span>Duration</span><span><%= durLabel %></span></div>
    <div class="ord-row"><span>Rent</span><span>₱<%= order.amount_due %></span></div>
    <% if (order.deposit_due > 0) { %>
    <div class="ord-row ord-row-dep"><span>Refundable deposit</span><span>+₱<%= order.deposit_due %></span></div>
    <% } %>
    <div class="ord-total"><span>To send now</span><span>₱<%= totalDue %></span></div>
    <% if (order.deposit_due > 0) { %>
    <div class="ord-refund-note">↩ You get ₱<%= order.deposit_due %> back once you return the account.</div>
    <% } %>
  </div>

  <% if (order.state === 'awaiting_payment' || order.state === 'payment_rejected') { %>
  <div class="ord-step">
    <div class="ord-step-label">Step 1 — Send ₱<%= totalDue %></div>

    <% if (!payMethods.length) { %>
      <div class="ord-offline">Our payment details aren't set up on the site yet — please message us on Facebook and we'll sort it out with you directly.</div>
    <% } else { %>
      <div class="ord-pay-tabs">
        <% payMethods.forEach((m, i) => { %>
        <button type="button" class="ord-pay-tab<%= i === 0 ? ' ord-pay-tab-on' : '' %>" data-m="<%= m.key %>"><%= m.label %></button>
        <% }) %>
      </div>
      <% payMethods.forEach((m, i) => { %>
      <div class="ord-pay-panel<%= i === 0 ? '' : ' ord-hidden' %>" data-m="<%= m.key %>">
        <% if (m.qr_image) { %>
        <img src="<%= m.qr_image %>" alt="<%= m.label %> QR code" class="ord-pay-qr">
        <% } %>
        <% if (m.account_name) { %><div class="ord-pay-row"><span>Name</span><strong><%= m.account_name %></strong></div><% } %>
        <% if (m.account_number) { %><div class="ord-pay-row"><span>Number</span><strong><%= m.account_number %></strong></div><% } %>
        <div class="ord-pay-row"><span>Amount</span><strong>₱<%= totalDue %></strong></div>
      </div>
      <% }) %>
      <div class="ord-pay-ref">
        Type <strong><%= order.ref %></strong> in the message/notes field when you send it —
        that's how we match your payment to this order.
      </div>
    <% } %>

    <div class="ord-step-label ord-step-label-2">Step 2 — Tell us you paid</div>
    <div class="ord-msg-box" id="ordMsg"><%= premadeMsg %></div>
    <button type="button" class="ord-btn-secondary" id="ordCopyBtn">Copy this message</button>
    <% if (mmLink) { %>
    <a class="ord-btn-primary" target="_blank" rel="noopener" href="<%= mmLink %>">Open Messenger &amp; paste it</a>
    <% } %>

    <div class="ord-alt">
      <form method="POST" action="/order/<%= order.ref %>/payment-proof" enctype="multipart/form-data" class="ord-upload">
        <input type="hidden" name="channel" value="upload">
        <input type="hidden" name="method" id="ordMethod" value="<%= payMethods.length ? payMethods[0].key : '' %>">
        <div class="ord-alt-label">or upload your receipt here instead</div>
        <input type="file" name="proof" accept="image/*" required>
        <button type="submit" class="ord-btn-secondary">Upload receipt</button>
      </form>
      <form method="POST" action="/order/<%= order.ref %>/payment-proof" class="ord-sent-form">
        <input type="hidden" name="channel" value="messenger">
        <button type="submit" class="ord-btn-link">I already sent it on Messenger</button>
      </form>
    </div>
  </div>
  <script>
  (function(){
    var tabs = document.querySelectorAll('.ord-pay-tab');
    var methodField = document.getElementById('ordMethod');
    tabs.forEach(function(t){
      t.addEventListener('click', function(){
        var key = t.dataset.m;
        tabs.forEach(function(x){ x.classList.toggle('ord-pay-tab-on', x === t); });
        document.querySelectorAll('.ord-pay-panel').forEach(function(p){
          p.classList.toggle('ord-hidden', p.dataset.m !== key);
        });
        if (methodField) methodField.value = key;
      });
    });
    var btn = document.getElementById('ordCopyBtn');
    var box = document.getElementById('ordMsg');
    if (btn && box) {
      btn.addEventListener('click', function(){
        var done = function(){ btn.textContent = 'Copied ✓'; setTimeout(function(){ btn.textContent = 'Copy this message'; }, 1800); };
        // navigator.clipboard needs HTTPS and can be blocked in in-app browsers
        // (customers often arrive from the Facebook app), so fall back rather
        // than leaving the button dead.
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(box.textContent).then(done).catch(function(){ fallback(); });
        } else { fallback(); }
        function fallback() {
          var ta = document.createElement('textarea');
          ta.value = box.textContent;
          ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = 'Press and hold the text to copy'; }
          document.body.removeChild(ta);
        }
      });
    }
  })();
  </script>
  <% } %>
</div>

<%- include('partials/footer') %>
</body>
</html>
```

- [ ] **Step 3: Add the status page styles**

In `public/css/style.css`, append at the end of the file:

```css
.ord-page { max-width: 560px; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
.ord-hidden { display: none; }
.ord-ref-bar { display: flex; align-items: center; justify-content: space-between; background: #0d0d0d; border: 1px solid #222; border-radius: 12px; padding: 0.75rem 1rem; margin-bottom: 1.25rem; }
.ord-ref-label { font-size: 0.7rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #555; }
.ord-ref-code { font-size: 1.15rem; font-weight: 900; color: var(--ps-blue); letter-spacing: 0.5px; }
.ord-flash { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: #22c55e; border-radius: 10px; padding: 0.7rem 1rem; font-size: 0.85rem; font-weight: 700; margin-bottom: 1rem; }
.ord-flash-warn { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.3); color: #ef4444; }
.ord-title { font-size: 1.5rem; font-weight: 900; margin: 0 0 0.35rem; letter-spacing: -0.01em; }
.ord-sub { font-size: 0.9rem; color: #888; margin: 0 0 1.5rem; line-height: 1.6; }
.ord-card { background: #0d0d0d; border: 1px solid #222; border-radius: 12px; padding: 1rem 1.1rem; margin-bottom: 1.5rem; }
.ord-row { display: flex; justify-content: space-between; font-size: 0.85rem; color: #888; padding: 0.25rem 0; }
.ord-row span:last-child { color: #ddd; font-weight: 600; }
.ord-row-dep span:last-child { color: #f59e0b; }
.ord-total { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #1a1a1a; margin-top: 0.75rem; padding-top: 0.75rem; font-weight: 800; font-size: 0.95rem; color: #fff; }
.ord-total span:last-child { color: var(--ps-blue); font-size: 1.25rem; font-weight: 900; }
.ord-refund-note { font-size: 0.75rem; color: #22c55e; margin-top: 0.6rem; }
.ord-step { background: #0d0d0d; border: 1px solid #222; border-radius: 12px; padding: 1.1rem; }
.ord-step-label { font-size: 0.72rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #555; margin-bottom: 0.85rem; }
.ord-step-label-2 { margin-top: 1.6rem; padding-top: 1.3rem; border-top: 1px solid #1a1a1a; }
.ord-pay-tabs { display: flex; gap: 0.5rem; margin-bottom: 0.9rem; }
.ord-pay-tab { flex: 1; background: #111; border: 1.5px solid #222; border-radius: 9px; padding: 0.6rem; color: #888; font-weight: 800; font-size: 0.85rem; cursor: pointer; font-family: inherit; }
.ord-pay-tab-on { border-color: var(--ps-blue); color: #fff; background: rgba(0,112,209,0.1); }
.ord-pay-qr { display: block; width: 200px; max-width: 100%; margin: 0 auto 0.9rem; background: #fff; border-radius: 10px; padding: 8px; }
.ord-pay-row { display: flex; justify-content: space-between; font-size: 0.85rem; color: #888; padding: 0.3rem 0; border-bottom: 1px solid #151515; }
.ord-pay-row strong { color: #fff; font-weight: 700; }
.ord-pay-ref { background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.25); border-radius: 9px; padding: 0.7rem 0.85rem; font-size: 0.8rem; color: #d1a054; line-height: 1.6; margin-top: 0.9rem; }
.ord-pay-ref strong { color: #f59e0b; font-weight: 900; }
.ord-msg-box { background: #111; border: 1px solid #222; border-radius: 10px; padding: 0.85rem; font-size: 0.84rem; color: #ccc; line-height: 1.65; white-space: pre-wrap; margin-bottom: 0.6rem; }
.ord-btn-primary { display: block; width: 100%; text-align: center; background: var(--ps-blue); color: #fff; padding: 0.9rem; border-radius: 10px; font-weight: 800; font-size: 0.95rem; text-decoration: none; margin-top: 0.5rem; }
.ord-btn-secondary { display: block; width: 100%; background: #1a1a1a; color: #ddd; border: 1.5px solid #2a2a2a; border-radius: 10px; padding: 0.8rem; font-weight: 800; font-size: 0.9rem; cursor: pointer; font-family: inherit; }
.ord-btn-secondary:hover { border-color: var(--ps-blue); color: #fff; }
.ord-btn-link { background: none; border: 0; color: #666; font-size: 0.8rem; cursor: pointer; font-family: inherit; text-decoration: underline; padding: 0.5rem; width: 100%; }
.ord-btn-link:hover { color: #aaa; }
.ord-offline { background: #111; border: 1px solid #222; color: #888; border-radius: 9px; padding: 0.65rem 0.85rem; font-size: 0.8rem; margin-bottom: 0.85rem; line-height: 1.5; }
.ord-alt { margin-top: 1.4rem; padding-top: 1.2rem; border-top: 1px solid #1a1a1a; }
.ord-alt-label { font-size: 0.76rem; color: #555; margin-bottom: 0.5rem; }
.ord-upload input[type="file"] { width: 100%; font-size: 0.8rem; color: #888; margin-bottom: 0.5rem; }
.ord-sent-form { margin-top: 0.4rem; }
```

- [ ] **Step 4: Verify syntax and balance**

Run: `node -c server.js` — expect exit 0.
Run: `grep -o '<%' views/order-status.ejs | wc -l` and `grep -o '%>' views/order-status.ejs | wc -l` — expect equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — expect equal.
Run: `grep -c 'm.me' views/order-status.ejs` and confirm no occurrence of `?text=` anywhere: `! grep -q '?text=' views/order-status.ejs && echo "no text param - correct"`.

- [ ] **Step 5: Commit**

```bash
git add server.js views/order-status.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Add order status page with GCash/Maya picker and pre-written message

/order/:ref renders the current step with no login required. The
customer picks a payment method, sees that method's QR and account
details, and is told to put their order reference in the notes field —
amount alone is ambiguous when two people pay the same price on the
same day.

Messenger cannot be pre-filled from a URL (there is no ?text=
parameter), so the message is rendered on the page with a copy button
and a clipboard fallback for in-app browsers. The Messenger link
carries ?ref=<order.ref>, which the next task reads to link the
customer's PSID to their order.
EOF
)"
```

---

### Task 5: Capture the Messenger PSID from the referral

**Files:**
- Modify: `server.js:2708-2722` (handle `referral` and `postback.referral` events in the webhook)

**Interfaces:**
- Consumes: `orders.parseOrderRef(raw)` and `orders.linkPsid(ref, psid)` from Task 1; the `?ref=` links emitted by Task 4.
- Produces: `order.psid` and `order.psid_linked_at` on order documents, displayed by Task 7's owner queue. Nothing sends messages — this task only records the link.

- [ ] **Step 1: Handle referral events in the webhook**

In `server.js`, the webhook's per-event handler currently drops everything that isn't a message:

```js
    entry.messaging?.forEach(event => {
      if (!event.message || event.message.is_echo) return;
      const senderId = event.sender.id;
```

Replace those three lines with:

```js
    entry.messaging?.forEach(event => {
      if (event.message && event.message.is_echo) return;
      const senderId = event.sender.id;

      // A customer arriving from m.me/<page>?ref=PH-1234 produces a referral —
      // either a standalone `referral` event on an existing thread, or one
      // nested in the `postback` when they tap Get Started on a new thread.
      // This pairing of ref and PSID is the only way the app ever learns which
      // Facebook thread belongs to which order, and it cannot be recovered
      // afterwards, so it is recorded even though nothing sends messages yet.
      const rawRef = event.referral?.ref || event.postback?.referral?.ref;
      if (rawRef) {
        const orderRef = orders.parseOrderRef(rawRef);
        if (orderRef) {
          orders.linkPsid(orderRef, senderId)
            .then(ok => console.log('[order psid]', orderRef, ok ? 'linked' : 'no matching order'))
            .catch(e => console.error('[order psid]', e.message));
        }
      }

      // Everything below this point is the existing chat bot, which only
      // handles real inbound text.
      if (!event.message) return;
      const text = (event.message.text || '').toLowerCase().trim();
```

Then **delete** the now-duplicated `const text = ...` line that immediately followed the original `const senderId` line, so the block reads straight into the `messenger_contacts` upsert.

The finished handler must be:

```js
    entry.messaging?.forEach(event => {
      if (event.message && event.message.is_echo) return;
      const senderId = event.sender.id;

      const rawRef = event.referral?.ref || event.postback?.referral?.ref;
      if (rawRef) { /* … as above … */ }

      if (!event.message) return;
      const text = (event.message.text || '').toLowerCase().trim();
      // Save/update PSID so we can blast later
      const existingContact = db.get('messenger_contacts').find({ psid: senderId }).value();
      if (!existingContact) {
        db.get('messenger_contacts').push({ psid: senderId, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() }).write();
      } else {
        db.get('messenger_contacts').find({ psid: senderId }).assign({ last_seen: new Date().toISOString() }).write();
      }
      handleMessage(senderId, text).catch(e => console.error('[handleMessage]', e));
    });
```

- [ ] **Step 2: Syntax-check**

Run: `node -c server.js` — expect exit 0.

- [ ] **Step 3: Confirm the bot path is unchanged**

Run: `grep -n "handleMessage(senderId, text)" server.js` — expect exactly one occurrence, still inside the `forEach`.
Run: `grep -n "messenger_contacts').push" server.js` — expect exactly one occurrence.

These two greps matter because the edit reorders the guard that protects both lines. A referral-only event has no `event.message`, so reaching either line with `text` undefined would break the existing bot for every customer.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "$(cat <<'EOF'
Link the customer's Messenger PSID to their order via m.me ref

The webhook previously dropped every event that wasn't an inbound
message, including referrals. A customer arriving from
m.me/<page>?ref=PH-1234 now has their PSID recorded against that order.

This is invisible to the customer and nothing sends messages yet — but
the ref/PSID pairing is only reported at the moment they arrive and
cannot be reconstructed later, so capturing it now is what makes any
future automatic confirmation or expiry reminder possible at all.

Refs are validated against the PH-NNNN shape before use, since anyone
can put an arbitrary ref in an m.me URL.
EOF
)"
```

---

### Task 6: QR upload with countdown and expiry

**Files:**
- Modify: `server.js` (add `POST /order/:ref/qr`)
- Modify: `views/order-status.ejs` (add the QR step block and countdown script)
- Modify: `public/css/style.css` (countdown styles)

**Interfaces:**
- Consumes: `orders.transition()`, `orders.QR_WINDOW_MS`, `orders.getByRef()` from Task 1; `uploadOrderFile` and `processUploadedImage()` from Task 4; the `ownerOnline` local already passed to the view by Task 4's `GET /order/:ref`.
- Produces: orders reaching `qr_pending` with `qr_expires_at` set, which Task 7's owner queue sorts by.

- [ ] **Step 1: Add the QR upload route**

In `server.js`, immediately after the `POST /order/:ref/payment-proof` route from Task 4, insert:

```js
// QR upload is website-only by design: the countdown is the whole mechanism,
// and a code sitting in a Messenger thread has no expiry tracking.
app.post('/order/:ref/qr', uploadOrderFile.single('qr'), async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/browse');
  if (!req.file) return res.redirect('/order/' + order.ref + '?msg=no_file');
  const qrPath = await processUploadedImage(req.file, 1400);
  const expiresAt = new Date(Date.now() + orders.QR_WINDOW_MS).toISOString();
  await orders.transition(order.ref, 'qr_pending', {
    qr_image: qrPath,
    qr_expires_at: expiresAt
  });
  res.redirect('/order/' + order.ref + '?msg=qr_sent');
});
```

- [ ] **Step 2: Add the QR step to the status page**

In `views/order-status.ejs`, immediately after the closing `<% } %>` of the payment step block added in Task 4 (the one following its `<script>` block), insert:

```ejs
  <% if (order.state === 'awaiting_qr') { %>
  <div class="ord-step">
    <div class="ord-step-label">Send your sign-in QR</div>
    <% if (ownerOnline) { %>
    <div class="ord-online">🟢 We're online right now — send your QR and we'll scan it straight away.</div>
    <% } else { %>
    <div class="ord-offline">We're not online at the moment. You can still send your QR — if it expires before we get to it, we'll ask for a fresh one.</div>
    <% } %>
    <p class="ord-help">On your console, open the sign-in screen so the QR code is showing, take a photo of it, and upload it here. Your QR is only good for about 10 minutes.</p>
    <form method="POST" action="/order/<%= order.ref %>/qr" enctype="multipart/form-data" class="ord-upload">
      <input type="file" name="qr" accept="image/*" required>
      <button type="submit" class="ord-btn-primary" style="margin-top:0.6rem;">Send my QR</button>
    </form>
  </div>
  <% } %>

  <% if (order.state === 'qr_pending') { %>
  <div class="ord-step">
    <div class="ord-step-label">Signing you in</div>
    <div class="ord-countdown" id="ordCountdown" data-expires="<%= order.qr_expires_at %>">--:--</div>
    <p class="ord-help">Keep the QR on your screen. If this runs out we'll ask for a fresh one — nothing is lost.</p>
  </div>
  <script>
  (function(){
    var el = document.getElementById('ordCountdown');
    if (!el) return;
    var expires = new Date(el.dataset.expires).getTime();
    function tick() {
      var left = expires - Date.now();
      if (left <= 0) { el.textContent = 'Expired'; el.classList.add('ord-countdown-done'); location.reload(); return; }
      var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      el.textContent = m + ':' + String(s).padStart(2, '0');
    }
    tick();
    setInterval(tick, 1000);
  })();
  </script>
  <% } %>
```

- [ ] **Step 3: Add the `qr_sent` flash message**

In `views/order-status.ejs`, find the flash line added in Task 4:

```ejs
  <% if (msg === 'no_file') { %><div class="ord-flash ord-flash-warn">Pick an image first, or use the Messenger option.</div><% } %>
```

Add immediately after it:

```ejs
  <% if (msg === 'qr_sent') { %><div class="ord-flash">QR received — hold tight.</div><% } %>
```

- [ ] **Step 4: Add the countdown styles**

In `public/css/style.css`, append at the end of the file:

```css
.ord-online { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: #22c55e; border-radius: 9px; padding: 0.65rem 0.85rem; font-size: 0.82rem; font-weight: 700; margin-bottom: 0.85rem; }
/* .ord-offline is already defined in Task 4 — do not redeclare it here. */
.ord-help { font-size: 0.8rem; color: #777; line-height: 1.6; margin: 0 0 0.9rem; }
.ord-countdown { font-size: 2.4rem; font-weight: 900; color: var(--ps-blue); text-align: center; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; margin-bottom: 0.6rem; }
.ord-countdown-done { color: #ef4444; }
```

- [ ] **Step 5: Verify syntax and balance**

Run: `node -c server.js` — expect exit 0.
Run: `grep -o '<%' views/order-status.ejs | wc -l` and `grep -o '%>' views/order-status.ejs | wc -l` — expect equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — expect equal.

- [ ] **Step 6: Commit**

```bash
git add server.js views/order-status.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Add QR upload with a 10-minute countdown and automatic retry

PS5 sign-in codes expire within minutes, so a QR sent overnight is
worthless by morning. Uploading starts a visible countdown; when it
lapses the sweep in lib/orders returns the order to awaiting_qr and the
page asks for a fresh code. Customers can re-upload without limit, so
neither side has to be awake at the same time for the order to survive.
EOF
)"
```

---

### Task 7: Owner queue, verify actions, and the online toggle

**Files:**
- Modify: `server.js` (add the queue data to the `/admin` render, plus `POST /order/:ref/return-proof`, `POST /admin/orders/:ref/advance`, `POST /admin/orders/:ref/reject`, `POST /admin/online`)
- Create: `views/partials/order-queue.ejs`
- Modify: `views/admin.ejs` (new Orders tab button and panel)
- Modify: `public/css/style.css` (queue styles)
- Modify: `views/order-status.ejs` (return-proof step)

**Interfaces:**
- Consumes: `orders.listByStates()`, `orders.OWNER_STATES`, `orders.transition()`, `orders.expireStaleQrs()`, `orders.advanceEndedRentals()`, `orders.manilaDate()` from Task 1; `uploadOrderFile` and `processUploadedImage()` from Task 4; `order.psid` from Task 5; the existing `requireAuth` middleware (`server.js:304`) and `getSiteSettings()`.
- Produces: `site_settings.owner_online` (boolean), read by Task 6's status page via the `ownerOnline` local. Orders reaching `closed` with `deposit_due > 0` and `deposit_refunded: false`, which Task 8 lists.

- [ ] **Step 1: Add the return-proof route and the owner action routes**

In `server.js`, immediately after the `POST /order/:ref/qr` route from Task 6, insert:

```js
app.post('/order/:ref/return-proof', uploadOrderFile.single('proof'), async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/browse');
  if (!req.file) return res.redirect('/order/' + order.ref + '?msg=no_file');
  const proofPath = await processUploadedImage(req.file, 1400);
  await orders.transition(order.ref, 'verifying_return', { return_proof: proofPath });
  res.redirect('/order/' + order.ref + '?msg=return_submitted');
});

// ── Owner queue actions ───────────────────────────────────────────────────
// One generic advance handler: each of the three owner states has exactly one
// forward move, so the button never has to say which state it is moving to.
// Only these three appear in the queue; every other transition is driven by
// the customer or by the sweeps in lib/orders.
const ORDER_ADVANCE = {
  verifying_payment: 'awaiting_qr',
  qr_pending: 'active',
  verifying_return: 'closed'
};

app.post('/admin/orders/:ref/advance', requireAuth, async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/admin?tab=orders');
  const to = ORDER_ADVANCE[order.state];
  if (!to) return res.redirect('/admin?tab=orders&msg=order_bad_state');
  const patch = {};
  if (to === 'active') {
    // The rental clock starts when the owner actually signs them in, not when
    // the order was placed — a customer who paid overnight isn't billed for
    // hours they couldn't play. Both dates are Manila dates: on a UTC server
    // an ISO slice reports yesterday for the whole Manila morning.
    const start = new Date();
    const end = new Date(start.getTime() + order.days * 86400000);
    patch.start_date = orders.manilaDate(start);
    patch.end_date = orders.manilaDate(end);
  }
  await orders.transition(order.ref, to, patch);
  res.redirect('/admin?tab=orders&msg=order_advanced');
});

app.post('/admin/orders/:ref/reject', requireAuth, async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/admin?tab=orders');
  await orders.transition(order.ref, 'payment_rejected', { payment_proof: null, payment_channel: null });
  res.redirect('/admin?tab=orders&msg=order_rejected');
});

app.post('/admin/online', requireAuth, (req, res) => {
  const on = req.body.online === 'on';
  db.set('site_settings.owner_online', on).write();
  res.redirect('/admin?tab=orders&msg=' + (on ? 'online_on' : 'online_off'));
});
```

- [ ] **Step 2: Feed the queue into the admin render**

In `server.js`, find the `/admin` route's render call (`server.js:1208` area — the line beginning `res.render('admin', {`). Immediately **before** that `res.render(...)` line, insert:

```js
  try {
    await orders.expireStaleQrs();
    await orders.advanceEndedRentals();
  } catch (e) { console.error('[order sweep]', e.message); }
  const orderQueue = await orders.listByStates(orders.OWNER_STATES);
  const refundsOwed = (await orders.listByStates(['closed']))
    .filter(o => (o.deposit_due || 0) > 0 && !o.deposit_refunded);
```

Then add these two keys to the `res.render('admin', { ... })` object: `orderQueue,` and `refundsOwed,`.

The `/admin` route handler must be `async` for this to work — change its signature from `app.get('/admin', requireAuth, (req, res) => {` to `app.get('/admin', requireAuth, async (req, res) => {`.

- [ ] **Step 3: Create the queue partial**

Create `views/partials/order-queue.ejs`:

```ejs
<%
  const QUEUE_ACTION = {
    verifying_payment: 'Payment confirmed',
    qr_pending: 'Signed them in',
    verifying_return: 'Return confirmed'
  };
  const QUEUE_LABEL = {
    verifying_payment: 'Check payment',
    qr_pending: 'Scan QR',
    verifying_return: 'Check return'
  };
  // Live QR windows first — they are the only rows with a deadline.
  const sortedQueue = [...orderQueue].sort((a, b) => {
    if (a.state === 'qr_pending' && b.state !== 'qr_pending') return -1;
    if (b.state === 'qr_pending' && a.state !== 'qr_pending') return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });
%>

<form method="POST" action="/admin/online" class="oq-online-form">
  <label class="oq-online-toggle">
    <input type="checkbox" name="online" onchange="this.form.submit()" <%= settings.owner_online ? 'checked' : '' %>>
    <span>I'm online now — show a live banner to customers waiting to send a QR</span>
  </label>
</form>

<% if (!sortedQueue.length) { %>
  <div class="oq-empty">Nothing waiting on you right now.</div>
<% } else { %>
  <% sortedQueue.forEach(o => { %>
  <div class="oq-row oq-<%= o.state %>">
    <div class="oq-main">
      <div class="oq-top">
        <span class="oq-ref"><%= o.ref %></span>
        <span class="oq-badge"><%= QUEUE_LABEL[o.state] %></span>
        <% if (o.state === 'qr_pending' && o.qr_expires_at) { %>
        <span class="oq-timer" data-expires="<%= o.qr_expires_at %>">--:--</span>
        <% } %>
      </div>
      <div class="oq-meta">
        <%= o.game_title %> · <%= o.account_type === 'tr' ? 'Trophy' : o.account_type === 'ps4' ? 'PS4 Primary' : 'Non-Trophy' %>
        · <%= o.days === 7 ? 'Weekly' : 'Monthly' %> · ₱<%= (o.amount_due || 0) + (o.deposit_due || 0) %>
      </div>
      <div class="oq-fb">
        FB: <strong><%= o.fb_name %></strong>
        <% if (o.psid) { %>
          <a class="oq-thread" href="https://www.facebook.com/messages/t/<%= o.psid %>" target="_blank" rel="noopener">open chat →</a>
        <% } %>
      </div>
      <% if (o.state === 'verifying_payment') { %>
        <div class="oq-proof">
          <% if (o.payment_method) { %><span class="oq-method"><%= o.payment_method.toUpperCase() %></span><% } %>
          <% if (o.payment_proof) { %>
            <a href="<%= o.payment_proof %>" target="_blank" rel="noopener">View receipt →</a>
          <% } else { %>
            <span class="oq-via-fb">Says they sent it on Messenger — check your inbox</span>
          <% } %>
        </div>
      <% } %>
      <% if (o.state === 'qr_pending' && o.qr_image) { %>
        <div class="oq-proof"><a href="<%= o.qr_image %>" target="_blank" rel="noopener">Open QR to scan →</a></div>
      <% } %>
      <% if (o.state === 'verifying_return' && o.return_proof) { %>
        <div class="oq-proof"><a href="<%= o.return_proof %>" target="_blank" rel="noopener">View return proof →</a></div>
      <% } %>
    </div>
    <div class="oq-actions">
      <form method="POST" action="/admin/orders/<%= o.ref %>/advance">
        <button type="submit" class="oq-btn-go"><%= QUEUE_ACTION[o.state] %></button>
      </form>
      <% if (o.state === 'verifying_payment') { %>
      <form method="POST" action="/admin/orders/<%= o.ref %>/reject">
        <button type="submit" class="oq-btn-no">Can't find it</button>
      </form>
      <% } %>
    </div>
  </div>
  <% }) %>
<% } %>

<script>
(function(){
  function tick() {
    document.querySelectorAll('.oq-timer').forEach(function(el){
      var left = new Date(el.dataset.expires).getTime() - Date.now();
      if (left <= 0) { el.textContent = 'expired'; el.classList.add('oq-timer-dead'); return; }
      var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      el.textContent = m + ':' + String(s).padStart(2, '0') + ' left';
    });
  }
  tick();
  setInterval(tick, 1000);
})();
</script>
```

- [ ] **Step 4: Add the Orders tab to admin**

In `views/admin.ejs`, find the tab button row (`views/admin.ejs:95-103`) and add this button immediately after the Customers button:

```ejs
    <button class="admin-tab" data-tab="orders" onclick="switchTab('orders')">🧾 Orders <% if (orderQueue.length) { %><span class="oq-count"><%= orderQueue.length %></span><% } %></button>
```

Then find the closing `</div>` of the `#tab-customers` panel and, immediately after it, add:

```ejs
  <div class="tab-panel" id="tab-orders">
    <%- include('partials/order-queue') %>
  </div>
```

- [ ] **Step 5: Add the return-proof step to the status page**

In `views/order-status.ejs`, immediately after the `qr_pending` block from Task 6, insert:

```ejs
  <% if (order.state === 'awaiting_return') { %>
  <div class="ord-step">
    <div class="ord-step-label">Return the account</div>
    <p class="ord-help">Sign out of our account on your console, then send us a photo or screenshot showing it. You can also send it on Messenger and we'll tick it off for you.</p>
    <form method="POST" action="/order/<%= order.ref %>/return-proof" enctype="multipart/form-data" class="ord-upload">
      <input type="file" name="proof" accept="image/*" required>
      <button type="submit" class="ord-btn-primary" style="margin-top:0.6rem;">Send return proof</button>
    </form>
  </div>
  <% } %>
```

And add this flash alongside the others:

```ejs
  <% if (msg === 'return_submitted') { %><div class="ord-flash">Return proof received — we'll confirm shortly.</div><% } %>
```

- [ ] **Step 6: Add the queue styles**

In `public/css/style.css`, append at the end of the file:

```css
.oq-online-form { margin-bottom: 1.25rem; }
.oq-online-toggle { display: flex; align-items: center; gap: 0.6rem; background: #0d0d0d; border: 1px solid #222; border-radius: 10px; padding: 0.75rem 1rem; cursor: pointer; font-size: 0.85rem; color: #aaa; }
.oq-online-toggle input { accent-color: #22c55e; }
.oq-empty { color: #555; font-size: 0.9rem; padding: 2rem 0; text-align: center; }
.oq-row { display: flex; gap: 1rem; align-items: flex-start; background: #0d0d0d; border: 1px solid #222; border-radius: 12px; padding: 0.9rem 1rem; margin-bottom: 0.7rem; }
.oq-qr_pending { border-color: rgba(0,112,209,0.4); }
.oq-main { flex: 1; min-width: 0; }
.oq-top { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.35rem; }
.oq-ref { font-weight: 900; color: var(--ps-blue); font-size: 0.95rem; }
.oq-badge { font-size: 0.7rem; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; background: #1a1a1a; color: #888; padding: 0.15rem 0.5rem; border-radius: 5px; }
.oq-timer { font-size: 0.75rem; font-weight: 800; color: #f59e0b; font-variant-numeric: tabular-nums; }
.oq-timer-dead { color: #ef4444; }
.oq-meta { font-size: 0.82rem; color: #888; margin-bottom: 0.25rem; }
.oq-fb { font-size: 0.8rem; color: #666; }
.oq-fb strong { color: #aaa; }
.oq-thread { color: var(--ps-blue); margin-left: 0.4rem; font-size: 0.76rem; }
.oq-proof { margin-top: 0.5rem; font-size: 0.8rem; }
.oq-proof a { color: var(--ps-blue); }
.oq-method { background: #1a1a1a; color: #aaa; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.5px; padding: 0.1rem 0.4rem; border-radius: 4px; margin-right: 0.4rem; }
.oq-via-fb { color: #f59e0b; }
.oq-actions { display: flex; flex-direction: column; gap: 0.4rem; flex-shrink: 0; }
.oq-btn-go { background: var(--ps-blue); color: #fff; border: 0; border-radius: 9px; padding: 0.6rem 0.9rem; font-weight: 800; font-size: 0.82rem; cursor: pointer; font-family: inherit; white-space: nowrap; }
.oq-btn-no { background: transparent; color: #666; border: 1px solid #2a2a2a; border-radius: 9px; padding: 0.5rem 0.9rem; font-weight: 700; font-size: 0.78rem; cursor: pointer; font-family: inherit; white-space: nowrap; }
.oq-btn-no:hover { color: #ef4444; border-color: rgba(239,68,68,0.4); }
.oq-count { background: var(--ps-blue); color: #fff; border-radius: 20px; padding: 0.05rem 0.4rem; font-size: 0.7rem; font-weight: 900; margin-left: 0.3rem; }
```

- [ ] **Step 7: Verify syntax and balance**

Run: `node -c server.js` — expect exit 0.
Run: `for f in views/admin.ejs views/order-status.ejs views/partials/order-queue.ejs; do echo "$f: open=$(grep -o '<%' $f | wc -l) close=$(grep -o '%>' $f | wc -l)"; done` — each file's counts must be equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — expect equal.

- [ ] **Step 8: Commit**

```bash
git add server.js views/admin.ejs views/order-status.ejs views/partials/order-queue.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Add owner order queue, verify actions, and online toggle

One admin tab showing exactly the orders in the three owner states,
live QR windows first, each with the proof to check and a one-tap
advance. Rows whose PSID was captured from an m.me referral link
straight to that customer's Messenger thread.

The rental clock starts when the owner signs the customer in rather
than at order time, so an overnight wait isn't billed, and both dates
are Manila dates rather than UTC. The online toggle drives the live
banner on customers' status pages.
EOF
)"
```

---

### Task 8: Deposit refund tracking

**Files:**
- Modify: `server.js` (add `POST /admin/orders/:ref/refunded`)
- Modify: `views/partials/order-queue.ejs` (add the outstanding-refunds list)
- Modify: `public/css/style.css` (refund list styles)

**Interfaces:**
- Consumes: `refundsOwed` (already computed and passed to the admin view by Task 7, Step 2); `orders.markRefunded(ref)` from Task 1.
- Produces: nothing consumed downstream — this is the final surface.

- [ ] **Step 1: Add the mark-refunded route**

In `server.js`, immediately after the `POST /admin/online` route from Task 7, insert:

```js
// The system tracks the debt; the owner still sends the money. A closed order
// with a deposit stays on the outstanding list until it is explicitly marked
// paid here.
app.post('/admin/orders/:ref/refunded', requireAuth, async (req, res) => {
  await orders.markRefunded(req.params.ref);
  res.redirect('/admin?tab=orders&msg=refund_marked');
});
```

- [ ] **Step 2: Add the refunds list to the queue partial**

In `views/partials/order-queue.ejs`, append at the very end of the file, **before** the closing `<script>` block:

```ejs
<% if (refundsOwed.length) { %>
<div class="oq-refunds">
  <div class="oq-refunds-title">Deposits to refund (<%= refundsOwed.length %>)</div>
  <% refundsOwed.forEach(o => { %>
  <div class="oq-refund-row">
    <div>
      <span class="oq-ref"><%= o.ref %></span>
      <span class="oq-refund-amt">₱<%= o.deposit_due %></span>
      <div class="oq-fb">FB: <strong><%= o.fb_name %></strong> · <%= o.game_title %></div>
    </div>
    <form method="POST" action="/admin/orders/<%= o.ref %>/refunded">
      <button type="submit" class="oq-btn-go">Sent it</button>
    </form>
  </div>
  <% }) %>
</div>
<% } %>
```

- [ ] **Step 3: Add the refunds styles**

In `public/css/style.css`, append at the end of the file:

```css
.oq-refunds { margin-top: 2rem; border-top: 1px solid #1a1a1a; padding-top: 1.25rem; }
.oq-refunds-title { font-size: 0.75rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #f59e0b; margin-bottom: 0.75rem; }
.oq-refund-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; background: #0d0d0d; border: 1px solid rgba(245,158,11,0.25); border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 0.5rem; }
.oq-refund-amt { font-weight: 900; color: #f59e0b; margin-left: 0.5rem; }
```

- [ ] **Step 4: Verify syntax and balance**

Run: `node -c server.js` — expect exit 0.
Run: `grep -o '<%' views/partials/order-queue.ejs | wc -l` and `grep -o '%>' views/partials/order-queue.ejs | wc -l` — expect equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — expect equal.

- [ ] **Step 5: Commit**

```bash
git add server.js views/partials/order-queue.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Track outstanding deposit refunds in the owner queue

Closed Trophy and PS4 Primary orders stay on an outstanding-refunds
list until the owner marks each one sent. The system tracks the debt;
the owner still sends the money.
EOF
)"
```

---

### Task 9: Deploy and verify live

**Files:** none (deploy + verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-8.

- [ ] **Step 1: Run the unit test**

Run: `node scripts/test-orders.js`
Expected: PASS — `12 assertions passed`.

Orders require `MONGODB_URI` to be set. It already is on Railway (the existing blob sync depends on it), so no new configuration is needed — but if the variable were missing, `orders.create()` throws and order creation redirects back to the game page with `?order_error=1` rather than 500ing.

- [ ] **Step 2: Push to trigger the Railway deploy**

```bash
git push origin main
```

- [ ] **Step 3: Wait for the deploy**

Run: `until curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/ | grep -q 200; do sleep 5; done; echo done`

- [ ] **Step 4: Configure payment methods**

In `/admin` (password from project context), open Settings → Payment Methods. Confirm the Facebook page handle field is pre-filled, then **ask the user for their GCash and Maya account names, numbers, and QR images** — these are real financial details and must not be invented. If the user is not available, enable neither method and confirm the status page shows the "not set up yet" fallback instead of an empty panel.

- [ ] **Step 5: Place a real test order**

Using the Browser tool, open a live game page (pick any slug from `curl -s https://playstation-hub.com/feed/meta-catalog.csv`). Select an account type and duration, enter a Facebook name in the new "or book on the site" form, and submit. Confirm:
- You land on `/order/PH-NNNN` with a reference code shown.
- The order summary matches the price shown on the game page, including the ₱100 deposit line for a Trophy selection.
- Step 1 shows the enabled payment methods as tabs, switching tabs swaps the QR and account details, and the reference-in-notes instruction names this order's own code.
- Step 2 shows the pre-written message containing the reference, game, type, duration, and total.

- [ ] **Step 6: Verify the copy button and the referral link**

Click "Copy this message" and confirm the label changes to "Copied ✓". Then read the `href` of the "Open Messenger & paste it" link and confirm it is exactly `https://m.me/<handle>?ref=PH-NNNN` for this order — **not** a `?text=` link, which Messenger ignores.

- [ ] **Step 7: Verify PSID capture end to end**

Open the `m.me` link on a phone or in a browser signed in to a Facebook account that is **not** the page, send any message, then reload `/admin?tab=orders`. Confirm the order row now shows an "open chat →" link beside the Facebook name. Also check the Railway logs for `[order psid] PH-NNNN linked`.

If the link does not appear, check in this order: the page handle in settings matches the real `m.me` handle; the webhook is subscribed to the `messaging_referrals` field in the Meta app dashboard (it is a separate subscription from `messages`); and the ref reached the server at all.

- [ ] **Step 8: Confirm the chat bot still works**

In the same Messenger thread, send `games`. The bot must reply with the game list exactly as before. This is the regression that matters most in Task 5 — the referral edit moved the guard that protects every existing bot path.

- [ ] **Step 9: Walk the order through every state**

Click "I already sent it on Messenger" to reach `verifying_payment`. In `/admin` open the Orders tab and confirm the order appears with the customer's Facebook name and a "Payment confirmed" button. Advance it, then back on the status page upload any image as the QR, confirm the countdown appears and counts down, then advance again from admin and confirm the status page shows the rental as active with an end date `days` ahead of today **in Manila terms** — for a 30-day rental started today, end date must be today + 30, matching the rule that a rental starting 7/11 ends 8/10.

- [ ] **Step 10: Verify the QR expiry loop**

Place a second test order and advance it to `awaiting_qr`, upload a QR, and confirm the queue row shows a live countdown that decrements and that the status page reloads itself when the countdown reaches zero. To avoid a 10-minute wait, confirming the countdown decrements and the row is sorted to the top of the queue is sufficient evidence of the mechanism.

- [ ] **Step 11: Verify the deposit refund list**

Advance the first (Trophy) test order through return and closure. Confirm it appears under "Deposits to refund" with the ₱100 amount, and that clicking "Sent it" removes it from the list permanently.

- [ ] **Step 12: Confirm nothing existing broke**

Load `/`, `/browse`, and a game page. Confirm the original "Message Us on Facebook" CTA still works unchanged, the booking panel behaves as before, and the admin's existing tabs (Games, Customers, PS Plus, Settings) all still render — including the Message Templates accordion, which now sits next to a new Payment Methods accordion.

- [ ] **Step 13: Clean up the test orders**

The test orders are real documents in the `orders` collection and will otherwise sit in the owner's queue forever. Delete them from MongoDB Atlas (Browse Collections → `pshub` → `orders`), or note their refs to the user so they can. Do not delete anything else from that collection.

- [ ] **Step 14: Report results to the user**

Summarize what was verified in Steps 4-13, with screenshots of the customer status page (payment step and active step) and the owner queue, and flag anything that didn't match expectations before considering this plan complete.
