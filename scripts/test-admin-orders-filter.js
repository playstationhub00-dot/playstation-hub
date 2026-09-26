// Run: node scripts/test-admin-orders-filter.js
//
// The Orders tab's ledger filters and group memory run in the browser. This
// loads the real public/js/admin-orders.js into a sandbox with no DOM (its
// page wiring is skipped when there is no document) and checks the rules it
// exposes on window.__oqFilter.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const FILE = path.join(__dirname, '..', 'public', 'js', 'admin-orders.js');

function load() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox);
  assert.ok(sandbox.__oqFilter, 'admin-orders.js exposes window.__oqFilter');
  return sandbox.__oqFilter;
}

const F = load();
// Objects made inside the sandbox have another realm's prototypes, so compare
// plain JSON copies rather than the objects themselves.
const plain = o => JSON.parse(JSON.stringify(o));
const st = over => F.normalizeLedgerState(Object.assign({}, over));
const row = (g, t, s) => ({ g, t, s: s || '' });

console.log('\nnormalizeLedgerState()');

ok('defaults to every chip, every type, no search', () => {
  assert.deepStrictEqual(plain(F.normalizeLedgerState(null)), { chip: 'all', type: 'all', q: '' });
});

ok('throws away values it does not recognise', () => {
  assert.deepStrictEqual(plain(F.normalizeLedgerState({ chip: 'lost', type: 'lease', q: 7 })),
    { chip: 'all', type: 'all', q: '' });
});

ok('keeps valid values and caps the search at 100 characters', () => {
  const s = F.normalizeLedgerState({ chip: 'out', type: 'purchase', q: 'x'.repeat(150) });
  assert.strictEqual(s.chip, 'out');
  assert.strictEqual(s.type, 'purchase');
  assert.strictEqual(s.q.length, 100);
});

console.log('\norderType()');

ok('a plain order is a rental', () => {
  assert.strictEqual(F.orderType({ state: 'active' }), 'rental');
});

ok('is_buy is a purchase', () => {
  assert.strictEqual(F.orderType({ is_buy: true }), 'purchase');
});

ok('a priority reservation is a reservation', () => {
  assert.strictEqual(F.orderType({ is_reservation: true }), 'reservation');
});

ok('a Coming Soon pre-order (is_buy AND is_reservation) is a reservation, not a purchase', () => {
  assert.strictEqual(F.orderType({ is_buy: true, is_reservation: true, upcoming_game_id: 9 }), 'reservation');
});

ok('a missing order is a rental rather than a crash', () => {
  assert.strictEqual(F.orderType(null), 'rental');
});

console.log('\nrowMatches()');

ok('the All chip matches every group', () => {
  ['out', 'paid', 'unpaid', 'cancelled'].forEach(g => assert.ok(F.rowMatches(row(g, 'rental'), st({})), g));
});

ok('a chip matches only its own group', () => {
  assert.ok(F.rowMatches(row('out', 'rental'), st({ chip: 'out' })));
  assert.ok(!F.rowMatches(row('paid', 'rental'), st({ chip: 'out' })));
});

ok('type narrows to one kind of order', () => {
  assert.ok(F.rowMatches(row('paid', 'purchase'), st({ type: 'purchase' })));
  assert.ok(!F.rowMatches(row('paid', 'rental'), st({ type: 'purchase' })));
});

ok('search is case-insensitive and ignores surrounding spaces', () => {
  const r = row('out', 'rental', 'ph-0171 nash diaz ufc 6');
  assert.ok(F.rowMatches(r, st({ q: '  NASH ' })));
  assert.ok(!F.rowMatches(r, st({ q: 'tekken' })));
});

ok('chip, type and search combine', () => {
  const f = st({ chip: 'paid', type: 'purchase', q: 'nba' });
  assert.ok(F.rowMatches(row('paid', 'purchase', 'ph-0164 eugen nba2k27'), f));
  assert.ok(!F.rowMatches(row('out', 'purchase', 'ph-0164 eugen nba2k27'), f));
  assert.ok(!F.rowMatches(row('paid', 'rental', 'ph-0164 eugen nba2k27'), f));
  assert.ok(!F.rowMatches(row('paid', 'purchase', 'ph-0170 cairus wolverine'), f));
});

console.log('\nisFiltering()');

ok('true for any chip, type or non-blank search; false for defaults and whitespace', () => {
  assert.strictEqual(F.isFiltering(st({})), false);
  assert.strictEqual(F.isFiltering(st({ q: '   ' })), false);
  assert.strictEqual(F.isFiltering(st({ chip: 'out' })), true);
  assert.strictEqual(F.isFiltering(st({ type: 'rental' })), true);
  assert.strictEqual(F.isFiltering(st({ q: 'nba' })), true);
});

console.log('\nnormalizeGroups()');

ok('keeps only known groups with boolean values', () => {
  assert.deepStrictEqual(plain(F.normalizeGroups({ now: false, waitlist: true, followups: 'yes', bogus: true })),
    { now: false, waitlist: true });
});

ok('anything that is not an object is an empty object', () => {
  assert.deepStrictEqual(plain(F.normalizeGroups('x')), {});
  assert.deepStrictEqual(plain(F.normalizeGroups(null)), {});
});

ok('remembers the Just released group too', () => {
  assert.deepStrictEqual(plain(F.normalizeGroups({ released: false })), { released: false });
});

console.log('\nwiring');

ok('admin.ejs loads admin-orders.js with a cache-busting ?v=', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
  assert.ok(/<script src="\/js\/admin-orders\.js\?v=<%=\s*assetV\s*%>"><\/script>/.test(src));
});

ok('the file still loads cleanly with no DOM (wiring skipped, rules still exposed)', () => {
  const again = load();
  assert.strictEqual(typeof again.rowMatches, 'function');
});

ok('the notification bell no longer points at the deleted order-queue.ejs', () => {
  const bell = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin', 'notif-bell.ejs'), 'utf8');
  assert.ok(!bell.includes('order-queue.ejs'));
  assert.ok(bell.includes('public/js/admin-orders.js'));
});

console.log('\n' + passed + ' assertions passed\n');
