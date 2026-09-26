// Run: node scripts/test-quick-add-unpaid-wiring.js
//
// An unpaid Quick Add settles the same way whichever way its money arrives.
// The rules are tested in scripts/test-quick-add-settle.js and the pinned
// update in scripts/test-orders-settle.js; this checks server.js routes every
// payment path through the one helper, in the right order. Source-level, like
// scripts/test-release-wiring.js — these routes write customer rows to the
// local lowdb file, which a test must not touch.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function block(startMarker) {
  const i = SRC.indexOf(startMarker);
  assert.ok(i >= 0, 'server.js still has ' + startMarker);
  const next = SRC.indexOf('\napp.', i + startMarker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}
function fnBody(startMarker) {
  const i = SRC.indexOf(startMarker);
  assert.ok(i >= 0, 'server.js still has ' + startMarker);
  const rest = SRC.slice(i);
  const end = rest.search(/\r?\n\}\r?\n/);
  return rest.slice(0, end > 0 ? end : undefined);
}

console.log('\nunpaid Quick Add wiring');

ok('server.js loads lib/quick-add-settle', () => {
  assert.ok(SRC.includes("const quickAddSettle = require('./lib/quick-add-settle');"));
});

ok('Quick Add keeps where an unpaid order belongs, and a paid one is born there', () => {
  const qa = block("app.post('/admin/quick-add', requireAuth,");
  assert.ok(qa.includes("const initialState = paid ? settleState : 'awaiting_payment';"));
  assert.ok(qa.includes('} : { settle_state: settleState },'));
});

ok('the helper settles the order first and records the payment only if that happened', () => {
  const h = fnBody('async function settleQuickAddPayment(');
  const settle = h.indexOf('orders.settleOwnerRecorded(');
  const pay = h.indexOf('quickAddSettle.settlementPayment(');
  assert.ok(settle > 0 && pay > settle, 'settle before recording the payment');
  assert.ok(h.includes('if (!ok) return { ok: false, target };'));
  assert.ok(h.includes('orders.manilaDate()'));
});

ok('a reservation released before it was paid joins the released reservations when settled', () => {
  const h = fnBody('async function settleQuickAddPayment(');
  assert.ok(h.includes("const released = target === 'awaiting_qr' && customer && customer.status === 'reservation';"));
  assert.ok(h.includes('released ? { released_at: nowIso } : {}'));
});

ok('Confirm paid only takes an unpaid Quick Add, and only a known method', () => {
  const r = block("app.post('/admin/orders/:ref/confirm-paid', requireAuth,");
  assert.ok(r.includes('quickAddSettle.isOwnerRecordedUnpaid(order)'));
  assert.ok(r.includes("allowed.includes(req.body.method) ? req.body.method : 'manual'"));
  assert.ok(r.includes("msg=payment_confirm_stale"));
  assert.ok(r.includes("'payment_confirmed'"));
});

ok('an approved proof on an unpaid Quick Add settles before the normal advance', () => {
  const r = block("app.post('/admin/orders/:ref/advance', requireAuth,");
  const hook = r.indexOf("order.state === 'verifying_payment' && quickAddSettle.isOwnerRecordedUnpaid(order)");
  assert.ok(hook > 0 && hook < r.indexOf('let to = ORDER_ADVANCE[order.state];'));
  assert.ok(r.includes('settleQuickAddPayment(order,'));
});

ok('Mark paid settles an unpaid Quick Add before its reservation logic', () => {
  const r = block("app.post('/admin/orders/:ref/mark-paid', requireAuth,");
  const hook = r.indexOf('settleQuickAddPayment(order,');
  assert.ok(hook > 0 && hook < r.indexOf('if (order.is_reservation) {'));
});

ok('the PayMongo webhook settles an unpaid Quick Add before its reservation and sign-in branches', () => {
  const r = block("app.post('/webhooks/paymongo',");
  const hook = r.indexOf('quickAddSettle.isOwnerRecordedUnpaid(order)');
  assert.ok(hook > 0 && hook < r.indexOf('} else if (order.is_reservation) {'));
  assert.ok(r.includes("method: 'gateway', channel: 'paymongo',"));
});

ok('the two toasts exist and open the Customers tab', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'views', 'admin.ejs'), 'utf8');
  assert.ok(admin.includes("payment_confirmed:'customers', payment_confirm_stale:'customers',"));
  assert.ok(admin.includes("payment_confirmed:'✅ Payment confirmed — counted in sales from today.'"));
  assert.ok(admin.includes("payment_confirm_stale:'❌ That order is no longer waiting for payment — reload and try again.'"));
});

console.log('\n' + passed + ' assertions passed\n');
