// Run: node scripts/test-unpaid-panel.js
//
// Customers → Needs attention → 💸 Not paid yet: renders the panel partial
// with fixtures, then checks at source level that the Customers tab includes
// it, tags unpaid rows, and that server.js feeds it and keeps these orders
// out of Orders → Follow-ups.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'views', 'partials', 'admin', 'customers', 'unpaid.ejs');
const SETTINGS = { payment_methods: [
  { key: 'gcash', label: 'GCash', enabled: true },
  { key: 'maya', label: 'Maya', enabled: true },
  { key: 'paypal', label: 'PayPal', enabled: false }
] };
const ROWS = [
  { ref: 'PH-0301', state: 'awaiting_payment', fb_name: 'Ana Cruz', game_title: 'Ghost of Yotei', account_type: 'nt', days: 30,
    amount_due: 349, created_at: '2026-09-20T12:00:00Z', customer_id: 11, settle_state: 'active',
    reminder_msg: '👋 Hi Ana! Friendly reminder — ₱349 for Ghost of Yotei (PH-0301) is still unpaid.' },
  { ref: 'PH-0302', state: 'verifying_payment', fb_name: 'Ben Reyes', game_title: 'Tekken 8', account_type: 'tr', days: null, is_buy: true,
    amount_due: 1299, created_at: '2026-09-22T12:00:00Z', customer_id: 12, payment_proof: '/uploads/proof.png', reminder_msg: 'b' },
  { ref: 'PH-0303', state: 'payment_rejected', fb_name: 'Cai Lim', game_title: 'Phantom Blade Zero', account_type: 'ps4', days: 30,
    upcoming_game_id: 15, amount_due: 449, created_at: '2026-09-24T12:00:00Z', customer_id: 13, reminder_msg: 'c' }
];

function render(rows) {
  return ejs.render(fs.readFileSync(FILE, 'utf8'), { unpaidQuickAdds: rows, settings: SETTINGS }, { filename: FILE });
}
// One row's markup: from the row holding this ref to the next row.
function row(html, ref) {
  const at = html.indexOf('>' + ref + '<');
  assert.ok(at >= 0, 'row ' + ref);
  const start = html.lastIndexOf('class="rem-row"', at);
  const next = html.indexOf('class="rem-row"', at);
  return html.slice(start, next > 0 ? next : undefined);
}

const html = render(ROWS);

console.log('\nthe panel');

ok('nothing unpaid renders nothing', () => {
  assert.ok(!render([]).includes('unpaidPanel'));
});

ok('the title counts the unpaid orders', () => {
  assert.ok(html.includes('💸 Not paid yet (3)'));
  assert.ok(html.includes('None of this counts in sales until the payment is confirmed — then it counts from that day.'));
});

ok('a rental row shows who, which order, what, how much and since when', () => {
  const r = row(html, 'PH-0301');
  assert.ok(r.includes('Ana Cruz'));
  assert.ok(r.includes('Ghost of Yotei · Non-Trophy · 30 days'));
  assert.ok(r.includes('₱349 owed · since Sep 20'));
});

ok('purchases and reservations say so', () => {
  assert.ok(row(html, 'PH-0302').includes('Tekken 8 · Trophy · Purchase'));
  assert.ok(row(html, 'PH-0302').includes('₱1,299 owed'));
  assert.ok(row(html, 'PH-0303').includes('Phantom Blade Zero · PS4 Primary · Reservation'));
});

ok('a sent proof links to its receipt; a rejected payment is tagged', () => {
  assert.ok(row(html, 'PH-0302').includes('📎 Proof sent — <a href="/uploads/proof.png"'));
  assert.ok(row(html, 'PH-0303').includes('payment rejected'));
  assert.ok(!row(html, 'PH-0301').includes('Proof sent'));
  assert.ok(!row(html, 'PH-0301').includes('payment rejected'));
});

ok('Confirm paid posts to the order, offering each enabled method plus Other / cash', () => {
  const r = row(html, 'PH-0301');
  assert.ok(r.includes('action="/admin/orders/PH-0301/confirm-paid"'));
  assert.ok(r.includes('<option value="gcash">GCash</option>'));
  assert.ok(r.includes('<option value="maya">Maya</option>'));
  assert.ok(r.includes('<option value="manual">Other / cash</option>'));
  assert.ok(!r.includes('PayPal'));
  assert.ok(r.includes('>Confirm paid</button>'));
});

ok('Copy reminder carries the reminder text', () => {
  assert.ok(row(html, 'PH-0301').includes('class="rem-copy" data-msg="👋 Hi Ana! Friendly reminder — ₱349 for Ghost of Yotei (PH-0301) is still unpaid."'));
});

console.log('\nwiring');

ok('the Customers tab shows the panel inside Needs attention and tags unpaid rows', () => {
  const src = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'admin', 'customers.ejs'), 'utf8');
  assert.ok(src.includes("<%- include('customers/unpaid') %>"));
  assert.ok(src.includes("(typeof unpaidQuickAdds !== 'undefined' && unpaidQuickAdds.length)"));
  assert.ok(src.includes('unpaidCustomerIds.includes(c.id)'));
});

ok('server.js feeds the panel and keeps these orders out of Follow-ups', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(SRC.includes('.filter(o => !quickAddSettle.isOwnerRecordedUnpaid(o));'));
  assert.ok(SRC.includes('const unpaidQuickAdds = allOrders'));
  assert.ok(SRC.includes('quickAddSettle.reminderMessage({'));
  assert.ok(SRC.includes('rentIgnored, unpaidQuickAdds, unpaidCustomerIds, notifs,'));
});

console.log('\n' + passed + ' assertions passed\n');
