// Run: node scripts/test-earned-lines.js
//
// The dashboard month panel's Earned list (public/js/earned-lines.js): one
// line per payment, but each says what the payment was and when, a rental's
// extra payments sit right under it instead of reading as a second renter,
// and a rental whose payments add up to more than its price is flagged —
// that, not a repeated name, is what money counted twice looks like.
const assert = require('assert');
const E = require('../public/js/earned-lines');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const row = (name, game, price, payments) => ({ customer_name: name, game_title: game, price, payments });
const inMonth = rows => rows.flatMap(c => c.payments.filter(p => p.date.startsWith('2026-10')).map(p => ({ c, p })));

ok('each payment says what it was and when', () => {
  const kevin = row('Kevin Ralph', "Marvel's Wolverine", 698, [
    { amount: 349, date: '2026-10-03', kind: 'rental' }, { amount: 349, date: '2026-10-10', kind: 'extension' }
  ]);
  const lines = E.earnedLines(inMonth([kevin]));
  assert.deepStrictEqual(lines.map(l => [l.label, l.when, l.amount, l.extra]), [
    ['Rental', 'Oct 3', 349, false], ['Extra payment', 'Oct 10', 349, true]
  ]);
  assert.deepStrictEqual([lines[0].name, lines[0].game], ['Kevin Ralph', "Marvel's Wolverine"]);
  assert.strictEqual(lines[0].warn, false);
});

ok('every kind has a plain label; a price edited down is a correction', () => {
  const kinds = ['rental', 'rent', 'purchase', 'reservation', 'extension', 'adjustment', undefined, 'something-new'];
  assert.deepStrictEqual(kinds.map(E.kindLabel), ['Rental', 'Rental', 'Purchase', 'Reservation', 'Extra payment', 'Price correction', 'Payment', 'Payment']);
  const cj = row('CJ Rejusam', 'Mafia The Old Country', 300, [
    { amount: 349, date: '2026-10-02', kind: 'rental' }, { amount: -49, date: '2026-10-02', kind: 'adjustment' }
  ]);
  assert.deepStrictEqual(E.earnedLines(inMonth([cj])).map(l => l.label + ' ' + l.amount), ['Rental 349', 'Price correction -49']);
});

ok('a rental\'s payments stay together, rentals in the order they were first paid', () => {
  const a = row('Ana', 'Game A', 1000, [{ amount: 500, date: '2026-10-05', kind: 'rental' }, { amount: 500, date: '2026-10-20', kind: 'extension' }]);
  const b = row('Ben', 'Game B', 300, [{ amount: 300, date: '2026-10-08', kind: 'rental' }]);
  const c = row('Cy', 'Game C', 400, [{ amount: 200, date: '2026-09-28', kind: 'reservation' }, { amount: 200, date: '2026-10-02', kind: 'extension' }]);
  // dashPaymentsIn hands them over customer by customer; a later customer can have paid earlier.
  const lines = E.earnedLines(inMonth([a, b, c]));
  assert.deepStrictEqual(lines.map(l => (l.extra ? '  ' : '') + l.name + ' ' + l.when), ['Cy Oct 2', 'Ana Oct 5', '  Ana Oct 20', 'Ben Oct 8']);
  assert.strictEqual(lines[0].extra, false, 'the first payment shown this month heads its rental, even if it is an extra one');
  assert.strictEqual(lines[0].label, 'Extra payment');
});

ok('money counted twice is flagged: payments adding up to more than the price', () => {
  const twice = row('Kevin Ralph', "Marvel's Wolverine", 349, [
    { amount: 349, date: '2026-10-03', kind: 'rental' }, { amount: 349, date: '2026-10-03', kind: 'rent' }
  ]);
  const lines = E.earnedLines(inMonth([twice]));
  assert.deepStrictEqual(lines.map(l => l.warn), [true, false], 'flagged once, on the rental\'s first line');
  const unpaid = row('Dee', 'Game D', 699, [{ amount: 300, date: '2026-10-04', kind: 'rent' }]);
  assert.strictEqual(E.earnedLines(inMonth([unpaid]))[0].warn, false, 'still owing is not counting twice');
  const septToo = row('Eve', 'Game E', 600, [{ amount: 600, date: '2026-09-30', kind: 'rental' }, { amount: 600, date: '2026-10-01', kind: 'extension' }]);
  assert.strictEqual(E.earnedLines(inMonth([septToo]))[0].warn, true, 'every payment on the rental counts, not just this month\'s');
});

ok('nothing paid, nothing listed; odd dates do not break it', () => {
  assert.deepStrictEqual(E.earnedLines([]), []);
  assert.strictEqual(E.shortDate('2026-10-07'), 'Oct 7');
  assert.strictEqual(E.shortDate('nonsense'), '');
});

console.log('\n' + passed + ' assertions passed\n');
