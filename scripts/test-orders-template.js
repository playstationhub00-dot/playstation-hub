// Run: node scripts/test-orders-template.js
//
// Renders views/partials/admin/orders.ejs (which includes the three partials
// under views/partials/admin/orders/) with fixture locals, and checks the
// structure the Orders tab and public/js/admin-orders.js rely on: groups and
// their defaults, every existing POST form and confirm prompt, which actions
// sit behind the ⋯ menu, the gateway pill states, and the ledger counts.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { buildBoard } = require('../lib/needs-you-board');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'views', 'partials', 'admin', 'orders.ejs');

const lo = (ref, state, extra) => Object.assign({
  ref, state, created_at: '2026-09-15T00:00:00Z', game_title: 'Tekken 8', account_type: 'nt',
  days: 30, amount_due: 349, deposit_due: 0, fb_name: 'Test Person', start_date: '2026-09-15', end_date: '2026-10-15'
}, extra || {});

function fixture(over) {
  let f;
  const ledgerOrders = [
    lo('PH-0201', 'active'),
    lo('PH-0202', 'closed', { is_buy: true }),
    lo('PH-0203', 'reserved', { is_reservation: true, is_buy: true, upcoming_game_id: 9 }),
    lo('PH-0204', 'awaiting_payment'),
    lo('PH-0205', 'cancelled'),
    lo('PH-0206', 'awaiting_return', { deposit_due: 100 })
  ];
  f = Object.assign({
    orderQueue: [
      lo('PH-0101', 'verifying_payment', { created_at: '2026-09-20T01:00:00Z', fb_name: 'Ana Cruz', payment_method: 'gcash', payment_proof: '/uploads/r.png' }),
      lo('PH-0102', 'qr_pending', { created_at: '2026-09-22T01:00:00Z', qr_expires_at: '2026-09-25T10:00:00Z', qr_code: 'ABCD-EFGH', fb_name: 'Ben Reyes', account_type: 'tr', days: 7, deposit_due: 100, psid: '123' }),
      lo('PH-0103', 'verifying_return', { created_at: '2026-09-21T01:00:00Z', return_proof: '/uploads/p.png', fb_name: 'Cai Lim' })
    ],
    refundsOwed: [lo('PH-0090', 'closed', { deposit_due: 100, fb_name: 'Dee Santos', game_title: 'Hogwarts Legacy' })],
    releasedOrders: [
      lo('PH-0130', 'awaiting_qr', { released_at: '2026-09-25T02:00:00Z', fb_name: 'Ivy Lopez', game_title: 'Phantom Blade Zero', release_msg: '🎮 Phantom Blade Zero is out! Your reservation PH-0130 is ready.' }),
      lo('PH-0131', 'awaiting_qr', { released_at: '2026-09-26T02:00:00Z', fb_name: 'Jon Reyes', game_title: 'Phantom Blade Zero', is_buy: true, days: null, release_msg: '🎮 Phantom Blade Zero is out! Your reservation PH-0131 is ready.' })
    ],
    abandonedOrders: [
      lo('PH-0110', 'awaiting_payment', { game_id: 5, created_at: '2026-09-20T00:00:00Z', fb_name: 'Eli Tan' }),
      lo('PH-0111', 'payment_rejected', { game_id: 5, created_at: '2026-09-24T00:00:00Z', fb_name: 'Fay Ong', account_type: 'tr', days: 7, deposit_due: 100, psid: '456' })
    ],
    waitlistOrders: [
      lo('PH-0120', 'waitlisted', { game_id: 5, created_at: '2026-09-10T00:00:00Z', fb_name: 'Gio Yu', queuePosition: 2 }),
      lo('PH-0121', 'reserved', { game_id: 5, created_at: '2026-09-15T00:00:00Z', fb_name: 'Hana Go', queuePosition: 1, upgraded_from_waitlist: true })
    ],
    ledgerGroups: [{ key: '2026-09', label: '2026-09', paidCount: 4, paidTotal: 1234, orders: ledgerOrders }],
    // `out: 99` is deliberately not the in-period count: the Out on rent chip
    // must count its own rows, not this live all-orders total.
    ledgerStats: { needsYou: 3, qrLive: 1, out: 99, paidCount: 4, paidTotal: 1234, unpaid: 1, cancelled: 1, total: 6 },
    orderPeriod: '',
    orderPeriods: ['2026-09', '2026-08'],
    orderYears: ['2026'],
    abandonedCount: 2,
    startedCount: 5,
    orderStartRate: 12,
    paymongoMode: 'live',
    paymongoHealth: { ok_count: 9, fail_count: 0, last_ok_at: '2026-09-20T03:23:00Z' },
    settings: { owner_online: true, payment_methods: [{ key: 'gcash', label: 'GCash', enabled: true }] }
  }, over || {});
  // server.js builds the board from these same two lists; a test that passes
  // its own orderBoard (or slotsFree) keeps it.
  if (!f.orderBoard) {
    f.orderBoard = buildBoard({ waitlist: f.waitlistOrders, followUps: f.abandonedOrders, slotsFree: f.slotsFree || {} });
  }
  return f;
}

function render(over) {
  return ejs.render(fs.readFileSync(FILE, 'utf8'), fixture(over), { filename: FILE });
}

// The Needs You markup for one group: from its data-oq-group attribute up to
// the next group or the ledger heading. Rows contain their own <details> ⋯
// menus, so "up to the first </details>" would cut a group short.
function groupBlock(html, key) {
  const start = html.indexOf('data-oq-group="' + key + '"');
  if (start < 0) return '';
  const ends = ['data-oq-group="', 'oq-ledger-h'].map(m => html.indexOf(m, start + 10)).filter(i => i > 0);
  return html.slice(start, ends.length ? Math.min(...ends) : undefined);
}
const refsIn = s => [...s.matchAll(/class="oq-ref">(PH-\d+)</g)].map(m => m[1]);
const needsYouPart = html => html.slice(0, html.indexOf('oq-ledger-h'));
const menus = s => [...s.matchAll(/<details class="oq-more">([\s\S]*?)<\/details>/g)].map(m => m[1]).join('\n');
const outsideMenus = s => s.replace(/<details class="oq-more">[\s\S]*?<\/details>/g, '');

const html = render();

console.log('\nNeeds You');

ok('headline counts Do now + Refunds only', () => {
  assert.ok(/Needs you <span class="oq-zone-n">4<\/span>/.test(html), 'expected 3 + 1 = 4');
});

ok('Do now: live QR first, then oldest first', () => {
  assert.deepStrictEqual(refsIn(groupBlock(html, 'now')), ['PH-0102', 'PH-0101', 'PH-0103']);
});

ok('By game: one card per game + type; waiting priority first, then follow-ups newest first', () => {
  const board = groupBlock(html, 'bygame');
  assert.deepStrictEqual(refsIn(board), ['PH-0121', 'PH-0120', 'PH-0110', 'PH-0111']);
  assert.deepStrictEqual([...board.matchAll(/data-oq-card="([^"]+)"/g)].map(m => m[1]), ['5|nt', '5|tr']);
});

ok('Do now, Refunds and By game start open; the old Follow-ups and Waitlist groups are gone', () => {
  assert.ok(html.includes('data-oq-group="now" open>'));
  assert.ok(html.includes('data-oq-group="refunds" open>'));
  assert.ok(html.includes('data-oq-group="bygame" open>'));
  assert.ok(!html.includes('data-oq-group="followups"') && !html.includes('data-oq-group="waitlist"'));
});

ok('the By game heading: total, waiting and didn\'t-pay counts, then the weekly funnel line', () => {
  const h = /<summary class="oq-group-h"><span class="oq-group-name">By game<\/span>[\s\S]*?<\/summary>/.exec(groupBlock(html, 'bygame'))[0];
  assert.ok(h.includes('<span class="oq-group-n">4</span>'));
  assert.ok(h.includes('<span class="oq-group-sub">2 waiting · 2 didn&#39;t pay · 2 of 5 started this week · 12% of game views</span>'));
});

ok('the QR countdown and the ages are still rendered for the script to tick', () => {
  assert.ok(html.includes('class="oq-timer" data-expires="2026-09-25T10:00:00Z"'));
  assert.ok(html.includes('class="oq-ab-age" data-created="2026-09-24T00:00:00Z"'));
});

ok('an empty group is not rendered at all', () => {
  const noRefunds = render({ refundsOwed: [] });
  assert.ok(!noRefunds.includes('data-oq-group="refunds"'));
  assert.ok(/Needs you <span class="oq-zone-n">3<\/span>/.test(noRefunds));
});

ok('everything empty: one quiet line and no groups', () => {
  const empty = render({ orderQueue: [], refundsOwed: [], releasedOrders: [], abandonedOrders: [], waitlistOrders: [], ledgerGroups: [] });
  assert.ok(empty.includes('Nothing waiting on you right now.'));
  assert.ok(!empty.includes('data-oq-group='));
  assert.ok(empty.includes('No orders in this period.'));
});

ok('Just released lists moved reservations newest first, open, with a copy button', () => {
  assert.ok(html.includes('data-oq-group="released" open>'));
  const b = groupBlock(html, 'released');
  assert.deepStrictEqual(refsIn(b), ['PH-0131', 'PH-0130']);
  assert.ok(b.includes('class="oq-btn-ghost rem-copy" data-msg="🎮 Phantom Blade Zero is out! Your reservation PH-0131 is ready."'));
  assert.ok(b.includes('Pre-order'));
  assert.ok(b.includes('Reserve · Monthly'));
});

ok('Just released sits between Do now and Refunds owed', () => {
  const now = html.indexOf('data-oq-group="now"');
  const rel = html.indexOf('data-oq-group="released"');
  const ref = html.indexOf('data-oq-group="refunds"');
  assert.ok(now < rel && rel < ref);
});

ok('no Just released group when nothing was released', () => {
  assert.ok(!render({ releasedOrders: [] }).includes('data-oq-group="released"'));
  assert.ok(!render({ releasedOrders: undefined }).includes('data-oq-group="released"'));
});

console.log('\nactions and confirm prompts');

ok('every existing POST form is still present', () => {
  ['/admin/orders/PH-0101/advance', '/admin/orders/PH-0101/reject', '/admin/orders/PH-0101/delete',
   '/admin/orders/PH-0090/refunded', '/admin/orders/PH-0110/mark-paid', '/admin/orders/PH-0110/cancel',
   '/admin/orders/PH-0120/priority-paid', '/admin/orders/PH-0121/undo-priority', '/admin/online',
   '/admin/orders/PH-0201/delete'].forEach(a => assert.ok(html.includes('action="' + a + '"'), a));
  assert.ok(html.includes('name="operiod"'));
});

ok('confirm prompts are byte-for-byte the old ones', () => {
  const R = r => '&#34;' + r + '&#34;';
  [
    "return confirm('Permanently delete order ' + " + R('PH-0101') + " + '? Its customer record and money go too. This cannot be undone.');",
    "return confirm('Mark order ' + " + R('PH-0110') + " + ' as paid? Use this when the customer paid outside the site (e.g. Messenger). They\\'ll still need to send their sign-in QR.');",
    "return confirm('Cancel order ' + " + R('PH-0110') + " + '? The customer said no or never followed up. The record is kept, unlike Delete.');",
    "return confirm('Delete order ' + " + R('PH-0110') + " + '? Its customer record and money go too. Use this to clear out duplicate or accidental orders. This cannot be undone.');",
    "return confirm('Mark ' + " + R('PH-0120') + " + ' as priority paid?\\n\\nUse this when they sent the ₱100 outside the site. They move above everyone on a free entry, and the rest of the rent is still owed when a slot opens.');",
    "return confirm('Remove ' + " + R('PH-0120') + " + ' from the waiting list?');",
    "return confirm('Undo priority for ' + " + R('PH-0121') + " + '?\\n\\nThey go back to a free waiting-list entry, keeping their reference and their place in line. Use this if the ₱100 never actually arrived.');",
    "return confirm('Delete order ' + " + R('PH-0201') + " + '? Its customer record and money go too. Use this to clear out test orders or accidental duplicates. This cannot be undone.');"
  ].forEach(p => assert.ok(html.includes('onsubmit="' + p + '"'), p.slice(0, 60)));
});

ok('rare and destructive actions sit behind the ⋯ menu', () => {
  const inMenus = menus(needsYouPart(html));
  ['/PH-0101/reject', '/PH-0101/delete', '/PH-0110/cancel', '/PH-0110/delete', '/PH-0120/cancel', '/PH-0121/undo-priority']
    .forEach(a => assert.ok(inMenus.includes(a), a + ' should be in a ⋯ menu'));
});

ok('main actions stay visible, outside any menu', () => {
  const visible = outsideMenus(needsYouPart(html));
  ['/PH-0101/advance', '/PH-0090/refunded', '/PH-0110/mark-paid', '/PH-0120/priority-paid']
    .forEach(a => assert.ok(visible.includes(a), a + ' should be visible'));
  ['/reject', '/cancel', '/delete', '/undo-priority']
    .forEach(a => assert.ok(!visible.includes(a), a + ' should not be visible outside a menu'));
});

ok('Payment link appears only when a PayMongo key is configured', () => {
  const saved = process.env.PAYMONGO_SECRET_KEY;
  try {
    delete process.env.PAYMONGO_SECRET_KEY;
    assert.ok(!render().includes('oq-paylink'));
    process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
    const withKey = render();
    assert.ok(withKey.includes('class="oq-more-item oq-paylink" data-ref="PH-0110"'));
    assert.ok(menus(withKey).includes('oq-paylink'), 'inside the ⋯ menu');
  } finally {
    if (saved === undefined) delete process.env.PAYMONGO_SECRET_KEY; else process.env.PAYMONGO_SECRET_KEY = saved;
  }
});

console.log('\nBy game cards');

// One card's markup, from its <details> to the next card or the board's end.
function cardBlock(s, key) {
  const start = s.indexOf('data-oq-card="' + key + '"');
  if (start < 0) return '';
  const next = s.indexOf('data-oq-card="', start + 10);
  return s.slice(start, next > 0 ? next : undefined);
}

ok('a card line: title, type tag and counts; a section per kind of person', () => {
  const nt = cardBlock(html, '5|nt');
  assert.ok(nt.includes('<span class="oq-card-title">Tekken 8</span>'));
  assert.ok(nt.includes('<span class="oq-card-type oq-card-type-nt">Non-Trophy</span>'));
  assert.ok(nt.includes('<span class="oq-card-n">2 waiting · 1 didn&#39;t pay</span>'));
  assert.ok(nt.includes('<div class="oq-card-lbl">Waiting · 2</div>') && nt.includes('<div class="oq-card-lbl">Started, didn\'t pay · 1</div>'));
  const tr = cardBlock(html, '5|tr');
  assert.ok(tr.includes('<span class="oq-card-type oq-card-type-tr">Trophy</span>') && tr.includes('<span class="oq-card-n">1 didn&#39;t pay</span>'));
  assert.ok(!tr.includes('Waiting ·'), 'no empty section');
});

ok('rows drop the game and type the card already shows; the copied messages keep them', () => {
  const nt = cardBlock(html, '5|nt');
  assert.ok(!/<div class="oq-meta">\s*Tekken 8/.test(nt), 'no game in the meta line');
  assert.ok(/<div class="oq-meta">\s*Monthly ·\s*⭐ Priority — paid/.test(nt));
  assert.ok(/<div class="oq-meta">\s*Monthly · ₱349/.test(nt));
  assert.ok(nt.includes('A slot just opened up for Tekken 8 (Non-Trophy, Monthly)'));
  assert.ok(nt.includes('🎮 Tekken 8 (Non-Trophy)'));
});

ok('a card with a free slot is tagged, goes first and starts open; the others start folded', () => {
  const freeHtml = render({ slotsFree: { '5|tr': 2 } });
  const board = groupBlock(freeHtml, 'bygame');
  assert.deepStrictEqual([...board.matchAll(/data-oq-card="([^"]+)"/g)].map(m => m[1]), ['5|tr', '5|nt']);
  assert.ok(board.includes('<details class="oq-card oq-card-free" data-oq-card="5|tr" open>'));
  assert.ok(cardBlock(freeHtml, '5|tr').includes('<span class="oq-card-free-tag">🟢 2 slots free</span>'));
  assert.ok(board.includes('<details class="oq-card" data-oq-card="5|nt">'));
  const one = render({ slotsFree: { '5|nt': 1 } });
  assert.ok(cardBlock(one, '5|nt').includes('🟢 1 slot free</span>'));
});

ok('the card tags have light-mode colours, so they stay readable on a white card', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  ['.oq-card-type-tr', '.oq-card-type-nt', '.oq-card-type-ps4', '.oq-card-free-tag']
    .forEach(c => assert.ok(css.includes('body.light-mode ' + c + ' {'), c));
});

ok('Coming Soon and box-set cards say so; nothing to show means no board', () => {
  const kinds = render({ waitlistOrders: [], abandonedOrders: [
    lo('PH-0140', 'awaiting_payment', { game_id: 'upcoming_4', game_title: 'Ghost of Yotei', account_type: 'tr', is_reservation: true }),
    lo('PH-0141', 'awaiting_payment', { game_id: 'bundle_2', game_title: 'Spider-Man Box', is_buy: true, days: null })
  ] });
  assert.ok(cardBlock(kinds, 'upcoming_4|tr').includes('<span class="oq-card-n">1 didn&#39;t pay · Coming Soon</span>'));
  assert.ok(cardBlock(kinds, 'bundle_2|nt').includes('<span class="oq-card-n">1 didn&#39;t pay · Box set</span>'));
  assert.ok(!render({ waitlistOrders: [], abandonedOrders: [] }).includes('data-oq-group="bygame"'));
});

console.log('\nwaitlist: slot given and edit name');

ok('✅ Slot given is a visible button on free and priority rows, with its confirm', () => {
  const R = r => '&#34;' + r + '&#34;';
  const visible = outsideMenus(groupBlock(html, 'bygame'));
  [['PH-0120', 'Gio Yu'], ['PH-0121', 'Hana Go']].forEach(([ref, name]) => {
    assert.ok(visible.includes('action="/admin/orders/' + ref + '/slot-given"'), ref);
    assert.ok(visible.includes("onsubmit=\"return confirm('Mark the slot as given to ' + " + R(name) + " + ' (' + " + R(ref) + " + ')?\\n\\nThey leave the line and the record is kept. A ₱100 priority fee stops counting as money — it\\'s already in the rent you recorded.');\""), ref + ' confirm');
  });
  assert.strictEqual((visible.match(/<button type="submit" class="oq-btn-given" title="They got their account — take them off the waiting list">✅ Slot given<\/button>/g) || []).length, 2);
});

ok('✏️ Edit name sits in every Waitlist row\'s ⋯ menu, prefilled with the name', () => {
  const inMenus = menus(groupBlock(html, 'bygame'));
  [['PH-0120', 'Gio Yu'], ['PH-0121', 'Hana Go']].forEach(([ref, name]) => {
    assert.ok(inMenus.includes('<form method="POST" action="/admin/orders/' + ref + '/rename" class="oq-rename">'), ref);
    assert.ok(inMenus.includes('<input type="text" id="oqName-' + ref + '" name="fb_name" value="' + name + '" maxlength="80" required class="oq-rename-input">'), ref + ' input');
  });
  assert.ok(!outsideMenus(groupBlock(html, 'bygame')).includes('/rename'), 'not outside the menu');
  const paidOnSite = render({ waitlistOrders: [lo('PH-0122', 'reserved', { game_id: 5, fb_name: 'Ivo Paz', queuePosition: 1 })] });
  const m = menus(groupBlock(paidOnSite, 'bygame'));
  assert.ok(m.includes('action="/admin/orders/PH-0122/rename"') && !m.includes('undo-priority'));
});

ok('the ledger says ✅ Slot given for a slot given, Cancelled for a plain cancel', () => {
  const ledger = render({ ledgerGroups: [{ key: '2026-10', label: '2026-10', paidCount: 0, paidTotal: 0, orders: [
    lo('PH-0207', 'cancelled', { slot_given_at: '2026-10-24T03:00:00Z' }),
    lo('PH-0208', 'cancelled')
  ] }] });
  const row = ref => { const i = ledger.indexOf('<td class="oq-lref">' + ref + '</td>'); assert.ok(i > 0, ref); return ledger.slice(i, ledger.indexOf('</tr>', i)); };
  assert.ok(row('PH-0207').includes('<span class="oq-st oq-st-dead"><span class="oq-st-dot"></span>✅ Slot given</span>'));
  assert.ok(row('PH-0208').includes('<span class="oq-st oq-st-dead"><span class="oq-st-dot"></span>Cancelled</span>'));
});

ok('the new controls are styled', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  ['.oq-btn-given {', '.oq-rename {', '.oq-rename-input {', '.oq-rename-save {'].forEach(s => assert.ok(css.includes(s), s));
});

console.log('\nindicator strip');

ok('online pill mirrors the setting', () => {
  assert.ok(/<input type="checkbox" name="online" onchange="this.form.submit\(\)" checked>/.test(html));
  assert.ok(!/name="online"[^>]*checked/.test(render({ settings: { owner_online: false, payment_methods: [] } })));
});

ok('a healthy live gateway is a quiet pill, not a red banner', () => {
  assert.ok(html.includes('oq-pill-pm oq-pill-ok'));
  assert.ok(html.includes('LIVE · webhook ok'));
  assert.ok(!html.includes('oq-pill-bad'));
  assert.ok(!html.includes('oq-pm-warn'));
});

ok('a failing webhook turns the pill red and adds the warning line', () => {
  const broken = render({ paymongoHealth: { ok_count: 9, fail_count: 2, last_ok_at: '2026-09-20T03:23:00Z', last_fail_at: '2026-09-21T03:23:00Z' } });
  assert.ok(broken.includes('oq-pill-pm oq-pill-bad'));
  assert.ok(broken.includes('class="oq-pm-warn"'));
  assert.ok(broken.includes('PAYMONGO_WEBHOOK_SECRET likely doesn'));
});

ok('no gateway markup at all when PayMongo is not configured', () => {
  const none = render({ paymongoMode: 'none' });
  assert.ok(!none.includes('oq-pill-pm'));
  assert.ok(!none.includes('oq-pm-warn'));
});

ok('the stat cards and the old standalone zones are gone', () => {
  ['oq-stats', 'oq-stat-v', 'class="oq-pm ', 'oq-export', 'oq-online-toggle', 'oq-refunds', 'oq-abandoned']
    .forEach(c => assert.ok(!html.includes(c), c));
});

console.log('\nledger');

ok('header line: total, paid, peso total, period', () => {
  assert.ok(/All orders <span class="oq-zone-n">6<\/span>/.test(html));
  assert.ok(html.includes('4 paid · ₱1,234 · Last 3 months'));
});

ok('chip counts are the rows each chip shows, and add up to All', () => {
  const n = g => {
    const m = html.match(new RegExp('data-g="' + g + '">[^<]*<span class="oq-chip-n">(\\d+)</span>'));
    return m ? Number(m[1]) : null;
  };
  assert.deepStrictEqual([n('all'), n('out'), n('paid'), n('unpaid'), n('cancelled')], [6, 2, 2, 1, 1]);
});

ok('every ledger row carries its type', () => {
  const types = [...html.matchAll(/class="oq-lr" data-g="\w+" data-t="(\w+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(types, ['rental', 'purchase', 'reservation', 'rental', 'rental', 'rental']);
});

ok('month subtotal says paid', () => {
  assert.ok(html.includes('<span class="oq-grp-sum">4 paid · ₱1,234</span>'));
});

ok('type filter stays a native select; no-match state starts hidden', () => {
  assert.ok(html.includes('<select id="oqType" class="oq-type" data-ss-skip'));
  assert.ok(/id="oqNoMatch" hidden>/.test(html));
  assert.ok(html.includes('data-oq-clear'));
});

ok('no inline script, style or old inline handlers', () => {
  assert.ok(!/<script\b/.test(html));
  assert.ok(!/<style\b/.test(html));
  assert.ok(!html.includes('oqChip('));
  assert.ok(!html.includes('oqFilter('));
});

ok('the old monolithic partial is gone', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'views', 'partials', 'order-queue.ejs')));
});

ok('the sidebar badge counts Do now + Refunds', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'views', 'admin.ejs'), 'utf8');
  assert.ok(admin.includes('orderQueue.length + (typeof refundsOwed !== \'undefined\' ? refundsOwed : []).length'));
});

console.log('\nstyles');

const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');

ok('every oq- class the tab renders has a rule', () => {
  // Hooks, not styling: state classes (oq-verifying_payment, …) and the
  // classes scripts and tests select on (oq-pill-pm, oq-group-name,
  // oq-code-copy, oq-ledger-h, oq-paylink).
  const HOOKS = /^oq-(verifying_payment|verifying_return|awaiting_\w+|pill-pm|group-name|code-copy|ledger-h|paylink)$/;
  const rendered = new Set([...html.matchAll(/class="([^"]*)"/g)]
    .flatMap(m => m[1].split(/\s+/))
    .filter(c => /^oq-/.test(c) && !HOOKS.test(c)));
  const missing = [...rendered].filter(c => !CSS.includes('.' + c));
  assert.deepStrictEqual(missing, []);
});

ok('rules for removed markup and dead rules are gone', () => {
  ['.oq-stats', '.oq-stat-v', '.oq-pm {', '.oq-pm-live', '.oq-export', '.oq-online-form', '.oq-online-toggle',
   '.oq-manual-', '.oq-funnel', '.oq-refunds {', '.oq-refund-row', '.oq-abandoned', '.oq-ab-row', '.oq-ab-right',
   '.oq-ab-btns', '.oq-sv-act', '.oq-sv-wait']
    .forEach(r => assert.ok(!CSS.includes(r), r + ' should be removed'));
});

ok('rules other templates rely on are still there', () => {
  ['.oq-alert-test', '.oq-alert-btn', '.oq-count', '.oq-wl-pos', '.oq-timer', '.oq-timer-dead']
    .forEach(r => assert.ok(CSS.includes(r), r));
});

ok('style.css is still CRLF throughout', () => {
  const lf = CSS.split('\n').length - 1;
  const crlf = CSS.split('\r\n').length - 1;
  assert.strictEqual(lf, crlf, 'every newline is CRLF');
});

console.log('\n' + passed + ' assertions passed\n');
