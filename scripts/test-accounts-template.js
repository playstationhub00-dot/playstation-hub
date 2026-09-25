// Run: node scripts/test-accounts-template.js
//
// Renders views/partials/admin/accounts.ejs with fixture data built by the
// real lib/accounts-view.js, and checks the markup the client script relies on.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const av = require('../lib/accounts-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const FILE = path.join(__dirname, '..', 'views', 'partials', 'admin', 'accounts.ejs');
const TODAY = '2026-09-25';
const TYPES = ['trophy', 'non_trophy', 'ps4_primary'];

function slot(status, end, extra) {
  return Object.assign({ enabled: true, status, renter_id: null, renter_name: '', start: '', end: end || '' }, extra || {});
}
function account(id, label, slots, extra) {
  const a = Object.assign({
    id, label, email: '', games_text: '', note: '', game_ids: [],
    price_permanent_tr: 5000, price_permanent_nt: 4500, for_sale: false, public_name: '', slots: {}
  }, extra || {});
  TYPES.forEach(t => { a.slots[t] = slots[t] || slot('open', '', { enabled: false }); });
  a.slotView = {};
  TYPES.forEach(t => { a.slotView[t] = av.decorateSlot(a.slots[t], TODAY); });
  a.category_name = 'New Games';
  return a;
}
function render(accounts) {
  const accountsView = {
    accounts,
    groups: accounts.length ? [{ name: 'New Games', accounts }] : [],
    slots: av.flattenSlots(accounts),
    stats: av.slotStats(accounts),
    STATUSES: ['open', 'rented', 'buyed', 'na', 'maintenance']
  };
  const games = [
    { id: 12, title: 'NBA 2K27', platform: 'PS5', cover_image: '/uploads/nba.webp' },
    { id: 3, title: 'Tekken 8', platform: 'PS5', cover_image: '' }
  ];
  const customers = [{ id: 40, customer_name: 'Ana Cruz' }];
  return ejs.render(fs.readFileSync(FILE, 'utf8'), { accountsView, games, customers }, { filename: FILE });
}

const EVIL = 'Pack </script><script>alert(1)</script>';
const accounts = [
  account(1, 'Zeta Pack', {
    trophy: slot('open'),
    non_trophy: slot('rented', '2026-09-27', { renter_id: 40, renter_name: 'Ana Cruz' })
  }, { game_ids: [12, 3], email: 'z@x.com' }),
  account(2, EVIL, { trophy: slot('rented', '2026-09-22') }, { game_ids: [3], note: 'n </script>' })
];
const html = render(accounts);

console.log('\nSlots view');

ok('one row per enabled slot, most urgent first', () => {
  const rows = [...html.matchAll(/class="acc-srow" data-status="(\w+)" data-due="(\w*)" data-type="(\w+)"/g)]
    .map(m => m[1] + ':' + m[2] + ':' + m[3]);
  assert.deepStrictEqual(rows, ['rented:overdue:trophy', 'rented:ending:non_trophy', 'open::trophy']);
});

ok('game ids ride on the rows for the Game filter', () => {
  assert.ok(html.includes('data-game-ids="12,3"'));
});

ok('search haystacks are lower-case and include the renter', () => {
  assert.ok(/data-search="[^"]*ana cruz[^"]*"/.test(html));
  const hays = [...html.matchAll(/data-search="([^"]*)"/g)].map(m => m[1]);
  assert.ok(hays.length > 0);
  hays.forEach(h => assert.strictEqual(h, h.toLowerCase()));
});

console.log('\nAccounts view');

ok('one row per account', () => {
  assert.strictEqual((html.match(/class="acc-arow"/g) || []).length, 2);
});

ok('disabled slots render as dim, non-clickable chips', () => {
  assert.ok(html.includes('<span class="acc-chip slot-pill st-disabled" data-type="ps4_primary" data-disabled="1"'));
});

ok('enabled chips open the slot modal', () => {
  assert.ok(html.includes('data-acc-slot="1:non_trophy"'));
});

console.log('\nstats, filters, data');

ok('stat cards include Overdue, with ending and overdue counted apart', () => {
  assert.ok(/data-acc-stat="overdue"[^]*?<span class="val">1<\/span>/.test(html));
  assert.ok(/data-acc-stat="ending"[^]*?<span class="val">1<\/span>/.test(html));
});

ok('status and type filters stay native selects; the game filter is searchable', () => {
  assert.ok(html.includes('<select id="accStatus" data-ss-skip'));
  assert.ok(html.includes('<select id="accType" data-ss-skip'));
  assert.ok(/<select id="accGame"(?![^>]*data-ss-skip)[^>]*>/.test(html));
});

ok('the account data survives a label that tries to close the script tag', () => {
  const m = html.match(/<script type="application\/json" id="accData">([\s\S]*?)<\/script>/);
  assert.ok(m, 'accData block present');
  assert.ok(!m[1].includes('</script'), 'no raw </script> inside the JSON');
  const data = JSON.parse(m[1]);
  assert.strictEqual(data.accounts['2'].label, EVIL);
  assert.strictEqual(data.accounts['2'].note, 'n </script>');
  assert.deepStrictEqual(data.accounts['1'].game_ids, [12, 3]);
  assert.strictEqual(data.accounts['1'].slots.non_trophy.renter_id, 40);
  assert.strictEqual(data.accounts['1'].slots.ps4_primary.enabled, false);
});

ok('labels are HTML-escaped everywhere else', () => {
  assert.ok(!html.includes('<script>alert(1)</script>'));
});

ok('no inline <style> and no executable inline <script> left in the partial', () => {
  assert.ok(!/<style/.test(html));
  const scripts = html.match(/<script(?![^>]*type="application\/json")[^>]*>/g) || [];
  assert.deepStrictEqual(scripts, []);
});

ok('the slot modal lists customers for the renter picker', () => {
  assert.ok(/<select class="qa-in" name="renter_id">[\s\S]*?<option value="40">Ana Cruz<\/option>/.test(html));
  assert.ok(html.includes('<select class="qa-in" name="status" data-ss-skip>'));
});

ok('the account modal offers every catalogue game as a checkbox', () => {
  assert.ok(html.includes('name="game_ids" value="12" data-title="NBA 2K27"'));
  assert.ok(html.includes('name="game_ids" value="3" data-title="Tekken 8"'));
});

console.log('\nno accounts yet');

ok('a friendly empty state, no list markup, and the Add modal still present', () => {
  const empty = render([]);
  assert.ok(empty.includes('id="accNone"'));
  assert.ok(!empty.includes('id="accSlotsView"'));
  assert.ok(empty.includes('id="accModal"'));
  assert.ok(empty.includes('data-acc-add'));
});

console.log('\n' + passed + ' assertions passed\n');
