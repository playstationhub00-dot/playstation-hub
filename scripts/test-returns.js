// Run: node scripts/test-returns.js
//
// Returns & deposits lists every Trophy rental, still running or finished.
// PS4 Primary is included only when the order recorded a deposit. Non-Trophy
// is never included. The page posts the existing mark-returned and
// mark-refunded routes, and the browser filter pages 50 at a time.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ejs = require('ejs');
const returns = require('../lib/returns');
const mask = require('../lib/mask');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const NOW = new Date('2026-11-04T05:30:00.000Z');
const EMAIL = 'trophy.one@example.com';

function view(extra) {
  return returns.build(Object.assign({
    now: NOW,
    orders: [],
    customers: [],
    accounts: [],
    slotHistory: []
  }, extra || {}));
}

function names(v) { return v.rows.map(r => r.name); }

ok('lists every trophy rental, newest start first, and leaves non-trophy out', () => {
  const v = view({
    customers: [
      { id: 1, customer_name: 'Older', game_title: 'NBA 2K', account_type: 'tr', status: 'done', start_date: '2026-08-01', end_date: '2026-08-08', created_at: '2026-08-01T00:00:00.000Z' },
      { id: 2, customer_name: 'Newer', game_title: 'Ghost', account_type: 'tr', status: 'renting', start_date: '2026-11-01', end_date: '2026-11-20', created_at: '2026-11-01T00:00:00.000Z' },
      { id: 3, customer_name: 'Non Trophy', game_title: 'Swap Me', account_type: 'nt', status: 'renting', start_date: '2026-11-02', end_date: '2026-11-20', created_at: '2026-11-02T00:00:00.000Z' },
      { id: 4, customer_name: 'Bought', game_title: 'Own It', account_type: 'tr', status: 'bought', start_date: '2026-11-03', created_at: '2026-11-03T00:00:00.000Z' },
      { id: 5, customer_name: 'Waiting', game_title: 'Soon', account_type: 'tr', status: 'reservation', created_at: '2026-11-03T00:00:00.000Z' },
      { id: 6, customer_name: 'Mislabeled', game_title: 'Swap Me', account_type: 'nt', status: 'renting', start_date: '2026-11-02', end_date: '2026-11-20', order_ref: 'PH-1003' }
    ],
    orders: [
      { ref: 'PH-1001', state: 'awaiting_payment', account_type: 'tr', fb_name: 'Never Paid', game_title: 'Nope', deposit_due: 100, is_buy: false },
      { ref: 'PH-1002', state: 'active', account_type: 'nt', fb_name: 'Order NT', game_title: 'Swap Me', deposit_due: 100 },
      { ref: 'PH-1003', state: 'active', account_type: 'tr', customer_id: 6, fb_name: 'Mislabeled', game_title: 'Swap Me', deposit_due: 100, start_date: '2026-11-02', end_date: '2026-11-20' }
    ]
  });
  assert.deepStrictEqual(names(v), ['Newer', 'Older']);
  assert.ok(!names(v).includes('Non Trophy'));
  assert.ok(!names(v).includes('Order NT'));
  assert.ok(!names(v).includes('Mislabeled'));
  assert.strictEqual(v.rows[1].rentalLabel, 'Returned');
});

ok('same start date breaks the tie with the later created record', () => {
  const v = view({
    customers: [
      { id: 1, customer_name: 'First', account_type: 'tr', status: 'done', start_date: '2026-10-01', created_at: '2026-10-01T01:00:00.000Z' },
      { id: 2, customer_name: 'Second', account_type: 'tr', status: 'done', start_date: '2026-10-01', created_at: '2026-10-01T05:00:00.000Z' }
    ]
  });
  assert.deepStrictEqual(names(v), ['Second', 'First']);
});

ok('PS4 Primary is included only when the order recorded a deposit', () => {
  const v = view({
    customers: [
      { id: 8, customer_name: 'PS4 Held', account_type: 'ps4', status: 'renting', start_date: '2026-11-01', end_date: '2026-11-20', order_ref: 'PH-2001', psn_id: 'sample_ps4' },
      { id: 9, customer_name: 'PS4 Bare', account_type: 'ps4', status: 'renting', start_date: '2026-11-02', end_date: '2026-11-20' }
    ],
    orders: [
      { ref: 'PH-2001', state: 'active', account_type: 'ps4', customer_id: 8, fb_name: 'PS4 Held', game_title: 'Drive', deposit_due: 100, deposit_refunded: false, start_date: '2026-11-01', end_date: '2026-11-20' },
      { ref: 'PH-2002', state: 'closed', account_type: 'ps4', fb_name: 'PS4 No Deposit', game_title: 'Drive', deposit_due: 0, deposit_refunded: false, start_date: '2026-10-01' },
      { ref: 'PH-2003', state: 'active', account_type: 'ps4', fb_name: 'PS4 Order', game_title: 'Drive', deposit_due: 100, deposit_refunded: false, start_date: '2026-11-03', end_date: '2026-12-01', psn: 'order_psn' }
    ]
  });
  assert.deepStrictEqual(names(v), ['PS4 Order', 'PS4 Held']);
  assert.strictEqual(v.rows[1].psn, 'sample_ps4');
  assert.strictEqual(v.rows[0].psn, 'order_psn');
  assert.strictEqual(v.rows[1].depositLabel, 'Held, still renting');
  assert.strictEqual(v.rows[1].depositAmount, 100);
});

ok('a customer and their order are one row, and a purchase is not a rental', () => {
  const v = view({
    customers: [
      { id: 4, customer_name: 'Ada', game_title: 'From Customer', account_type: 'tr', status: 'renting', start_date: '2026-11-01', end_date: '2026-11-20', order_ref: 'PH-3001', psn_id: 'ada_psn' }
    ],
    orders: [
      { ref: 'PH-3001', state: 'active', account_type: 'tr', customer_id: 4, fb_name: 'Ada Messenger', game_title: 'From Order', deposit_due: 100, start_date: '2026-11-01', end_date: '2026-11-20' },
      { ref: 'PH-3002', state: 'active', account_type: 'tr', is_buy: true, fb_name: 'Buyer', game_title: 'Bought', deposit_due: 0, start_date: '2026-11-02' }
    ]
  });
  assert.strictEqual(v.rows.length, 1);
  assert.strictEqual(v.rows[0].name, 'Ada');
  assert.strictEqual(v.rows[0].game, 'From Customer');
  assert.strictEqual(v.rows[0].messenger, 'Ada Messenger');
  assert.strictEqual(v.rows[0].ref, 'PH-3001');
  assert.ok(v.rows[0].search.includes('ada_psn'));
  assert.ok(v.rows[0].search.includes('from customer'));
});

ok('rental status follows the end date, and a closed order is Returned', () => {
  const v = view({
    customers: [
      { id: 1, customer_name: 'Live', account_type: 'tr', status: 'renting', start_date: '2026-11-01', end_date: '2026-11-20' },
      { id: 2, customer_name: 'Soon', account_type: 'tr', status: 'renting', start_date: '2026-11-01', end_date: '2026-11-07' },
      { id: 3, customer_name: 'Late', account_type: 'tr', status: 'renting', start_date: '2026-10-01', end_date: '2026-11-01' },
      { id: 4, customer_name: 'Today', account_type: 'tr', status: 'renting', start_date: '2026-11-01', end_date: '2026-11-04' }
    ],
    orders: [
      { ref: 'PH-4001', state: 'awaiting_return', account_type: 'tr', fb_name: 'Ended', game_title: 'G', deposit_due: 100, deposit_refunded: false, start_date: '2026-10-20', end_date: '2026-11-03' },
      { ref: 'PH-4002', state: 'verifying_return', account_type: 'tr', fb_name: 'Checking', game_title: 'G', deposit_due: 100, start_date: '2026-10-15', end_date: '2026-11-02' },
      { ref: 'PH-4003', state: 'closed', account_type: 'tr', fb_name: 'Back', game_title: 'G', deposit_due: 100, deposit_refunded: true, deposit_refunded_at: '2026-11-02T02:00:00.000Z', start_date: '2026-09-01', end_date: '2026-09-08' }
    ]
  });
  const byName = {};
  v.rows.forEach(r => { byName[r.name] = r; });
  assert.strictEqual(byName.Live.rentalLabel, 'Active');
  assert.strictEqual(byName.Soon.rentalLabel, 'Ending soon');
  assert.strictEqual(byName.Today.rentalLabel, 'Ending soon');
  assert.strictEqual(byName.Late.rentalLabel, 'Overdue');
  assert.strictEqual(byName.Ended.rentalLabel, 'Ended');
  assert.strictEqual(byName.Ended.note, 'Waiting for return proof');
  assert.strictEqual(byName.Checking.rentalLabel, 'Ended');
  assert.strictEqual(byName.Back.rentalLabel, 'Returned');
  assert.strictEqual(byName.Back.depositLabel, 'Refunded · 2 Nov 2026');
});

ok('a day past the three-day window is still Active', () => {
  const v = view({
    customers: [
      { id: 1, customer_name: 'Four', account_type: 'tr', status: 'renting', start_date: '2026-11-01', end_date: '2026-11-08' }
    ]
  });
  assert.strictEqual(v.rows[0].rentalLabel, 'Active');
});

ok('deposit status is held while renting, owed after it ends, and not invented', () => {
  const v = view({
    customers: [
      { id: 1, customer_name: 'Holding', account_type: 'tr', status: 'renting', start_date: '2026-11-01', end_date: '2026-11-20', order_ref: 'PH-5001' },
      { id: 2, customer_name: 'Owes', account_type: 'tr', status: 'done', start_date: '2026-10-01', end_date: '2026-10-08', order_ref: 'PH-5002' },
      { id: 3, customer_name: 'No Order', account_type: 'tr', status: 'done', start_date: '2026-09-01', end_date: '2026-09-08' },
      { id: 4, customer_name: 'Cancelled blank', account_type: 'tr', status: 'cancelled' }
    ],
    orders: [
      { ref: 'PH-5001', state: 'active', account_type: 'tr', customer_id: 1, deposit_due: 100, deposit_refunded: false, start_date: '2026-11-01', end_date: '2026-11-20' },
      { ref: 'PH-5002', state: 'closed', account_type: 'tr', customer_id: 2, deposit_due: 100, deposit_refunded: false, start_date: '2026-10-01', end_date: '2026-10-08' }
    ]
  });
  const byName = {};
  v.rows.forEach(r => { byName[r.name] = r; });
  assert.strictEqual(byName.Holding.depositLabel, 'Held, still renting');
  assert.strictEqual(byName.Holding.depositKey, 'held');
  assert.strictEqual(byName.Owes.depositLabel, 'Not refunded yet');
  assert.strictEqual(byName.Owes.canMarkRefunded, true);
  assert.strictEqual(byName['No Order'].depositLabel, 'No deposit recorded');
  assert.strictEqual(byName['No Order'].depositAmount, 0);
  assert.strictEqual(byName['No Order'].canMarkRefunded, false);
  assert.ok(!byName['Cancelled blank']);
  assert.strictEqual(v.summary.heldAmount, 100);
  assert.strictEqual(v.summary.heldCount, 1);
  assert.strictEqual(v.summary.owedCount, 1);
  assert.strictEqual(v.summary.owedAmount, 100);
  assert.strictEqual(v.counts.renting, 1);
  assert.strictEqual(v.counts.owed, 1);
  assert.strictEqual(v.counts.all, 3);
});

ok('a refunded flag with no stored date does not invent one', () => {
  const v = view({
    orders: [
      { ref: 'PH-6001', state: 'closed', account_type: 'tr', fb_name: 'Old Refund', game_title: 'G', deposit_due: 100, deposit_refunded: true, start_date: '2026-07-01' }
    ]
  });
  assert.strictEqual(v.rows[0].depositLabel, 'Refunded');
  assert.strictEqual(v.counts.refunded, 1);
});

ok('the account email is masked and Reveal is aimed at that account', () => {
  const v = view({
    customers: [
      { id: 12, customer_name: 'Linked', account_type: 'tr', status: 'done', start_date: '2026-06-01', end_date: '2026-06-08' }
    ],
    accounts: [
      { id: 7, label: 'Trophy 1', email: EMAIL, slots: { trophy: { renter_id: null }, ps4_primary: { renter_id: null } } }
    ],
    slotHistory: [
      { account_id: 7, slot: 'trophy', renter_id: 12, at: '2026-06-08T00:00:00.000Z' },
      { account_id: 7, slot: 'non_trophy', renter_id: 12, at: '2026-07-01T00:00:00.000Z' }
    ]
  });
  const row = v.rows[0];
  assert.strictEqual(row.accountId, 7);
  assert.strictEqual(row.accountLabel, 'Trophy 1');
  assert.strictEqual(row.emailMask, mask.maskEmail(EMAIL));
  assert.ok(!JSON.stringify(row).includes(EMAIL));
});

ok('a live slot is preferred over an older history line', () => {
  const v = view({
    customers: [
      { id: 3, customer_name: 'Now', account_type: 'tr', status: 'renting', start_date: '2026-11-01', end_date: '2026-11-20' }
    ],
    accounts: [
      { id: 1, label: 'Old', email: 'old@example.com', slots: { trophy: { renter_id: null } } },
      { id: 2, label: 'Current', email: 'now@example.com', slots: { trophy: { renter_id: 3 } } }
    ],
    slotHistory: [
      { account_id: 1, slot: 'trophy', renter_id: 3, at: '2026-01-01T00:00:00.000Z' }
    ]
  });
  assert.strictEqual(v.rows[0].accountLabel, 'Current');
  assert.strictEqual(v.rows[0].canMarkReturned, true);
});

ok('actions follow the existing routes: mark returned, confirm the return, mark the deposit', () => {
  const v = view({
    customers: [
      { id: 9, customer_name: 'Still', account_type: 'tr', status: 'renting', start_date: '2026-10-01', end_date: '2026-10-20', order_ref: 'PH-7001' }
    ],
    orders: [
      { ref: 'PH-7001', state: 'verifying_return', account_type: 'tr', customer_id: 9, deposit_due: 100, deposit_refunded: false, start_date: '2026-10-01', end_date: '2026-10-20' }
    ]
  });
  const row = v.rows[0];
  assert.strictEqual(row.rentalLabel, 'Ended');
  assert.strictEqual(row.canMarkReturned, true);
  assert.strictEqual(row.canConfirmReturn, true);
  assert.strictEqual(row.canMarkRefunded, true);
  assert.strictEqual(row.customerId, 9);
  assert.strictEqual(row.ref, 'PH-7001');
});

const ROOT = path.join(__dirname, '..');
const partial = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'admin', 'returns.ejs'), 'utf8');

function render(data) {
  return ejs.render(partial, Object.assign({ returnsView: data }, {
    // The partial formats pesos itself. maskEmail is not called from the view;
    // the row already carries the mask.
  }), { filename: path.join(ROOT, 'views', 'partials', 'admin', 'returns.ejs') });
}

ok('the page posts the existing routes, confirms them, and masks the login', () => {
  const v = view({
    customers: [
      { id: 9, customer_name: 'Still Out', account_type: 'tr', status: 'renting', start_date: '2026-10-01', end_date: '2026-10-20', order_ref: 'PH-7001', psn_id: 'still_out' }
    ],
    orders: [
      { ref: 'PH-7001', state: 'verifying_return', account_type: 'tr', customer_id: 9, fb_name: 'Still Out', game_title: 'Horizon', deposit_due: 100, deposit_refunded: false, start_date: '2026-10-01', end_date: '2026-10-20' }
    ],
    accounts: [
      { id: 4, label: 'Main Trophy', email: EMAIL, slots: { trophy: { renter_id: 9 } } }
    ]
  });
  const html = render(v);
  assert.ok(html.includes('id="tab-returns"'));
  assert.ok(html.includes('Ended — deposit not refunded yet'));
  assert.ok(html.includes('Still renting'));
  assert.ok(html.includes('currently held'));
  assert.ok(html.includes('owed back'));
  assert.ok(html.includes('action="/admin/customers/status/9"'));
  assert.ok(html.includes('name="status" value="done"'));
  assert.ok(html.includes('name="return_to" value="returns"'));
  assert.ok(html.includes('action="/admin/orders/PH-7001/advance"'));
  assert.ok(html.includes('action="/admin/orders/PH-7001/refunded"'));
  assert.ok(html.includes('data-confirm-kind="bulk"'));
  assert.ok(html.includes('Mark returned'));
  assert.ok(html.includes('Return confirmed'));
  assert.ok(html.includes('Mark deposit refunded'));
  assert.ok(html.includes('data-mask-kind="account_email"'));
  assert.ok(html.includes('data-mask-subject="4"'));
  assert.ok(html.includes(mask.maskEmail(EMAIL)));
  assert.ok(!html.includes(EMAIL));
  assert.ok(html.includes('data-label="Customer"'));
  assert.ok(html.includes('id="rdSearch"'));
  assert.ok(html.includes('Search name, game, or PSN'));
  assert.ok(html.includes('Non-Trophy rentals are not listed'));
  assert.ok(!html.includes('settings'));
});

ok('rows after the first 50 start hidden', () => {
  const customers = [];
  for (let i = 1; i <= 51; i++) {
    const day = String(i).padStart(2, '0');
    customers.push({
      id: i, customer_name: 'Renter ' + i, account_type: 'tr', status: 'done',
      start_date: '2026-01-' + (i > 31 ? '01' : day), end_date: '2026-02-01',
      created_at: '2026-01-01T00:' + String(i).padStart(2, '0') + ':00.000Z'
    });
  }
  const html = render(view({ customers }));
  const tags = html.split('<tr class="rd-row"').slice(1);
  assert.strictEqual(tags.length, 51);
  assert.ok(!/^\s*hidden/.test(tags[0]));
  assert.ok(/^\s*hidden/.test(tags[50]));
  assert.strictEqual(returns.PAGE_SIZE, 50);
});

function loadFilter() {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin-returns.js'), 'utf8'), sandbox);
  return sandbox.__rdFilter;
}

ok('the filter keeps 50 to a page and the owed chip is the deposit to-do', () => {
  const F = loadFilter();
  const plain = o => JSON.parse(JSON.stringify(o));
  assert.strictEqual(F.PAGE_SIZE, 50);
  assert.deepStrictEqual(plain(F.normalize({ chip: 'nope', q: 4 })), { chip: 'all', q: '' });
  const owed = { renting: '', owed: '1', refunded: '', s: 'ada horizon still_out' };
  const live = { renting: '1', owed: '', refunded: '', s: 'ben ghost ben_psn' };
  assert.strictEqual(F.rowMatches(owed, F.normalize({ chip: 'owed', q: '' })), true);
  assert.strictEqual(F.rowMatches(live, F.normalize({ chip: 'owed', q: '' })), false);
  assert.strictEqual(F.rowMatches(live, F.normalize({ chip: 'all', q: 'ben_psn' })), true);
  assert.strictEqual(F.rowMatches(live, F.normalize({ chip: 'all', q: 'horizon' })), false);
  assert.strictEqual(F.rowMatches(owed, F.normalize({ chip: 'renting', q: '' })), false);
  const page = F.paginate(51, 2, F.PAGE_SIZE);
  assert.strictEqual(page.start, 50);
  assert.strictEqual(page.end, 51);
  assert.strictEqual(page.pages, 2);
});

ok('tracksDeposit is trophy, or PS4 Primary with a deposit on the order', () => {
  assert.strictEqual(returns.tracksDeposit({ account_type: 'tr', deposit_due: 0 }), true);
  assert.strictEqual(returns.tracksDeposit({ account_type: 'ps4', deposit_due: 100 }), true);
  assert.strictEqual(returns.tracksDeposit({ account_type: 'ps4', deposit_due: 0 }), false);
  assert.strictEqual(returns.tracksDeposit({ account_type: 'nt', deposit_due: 100 }), false);
  assert.strictEqual(returns.tracksDeposit(null), false);
});

console.log('\n' + passed + ' assertions passed\n');
