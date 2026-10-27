// Run: node scripts/test-slot-history.js
//
// The rules behind an account slot's renter history (lib/slot-history.js):
// which lines a slot change makes, how each line reads in the slot popup, and
// how many lines a slot keeps. Pure — no server, no data file.
const assert = require('assert');
const sh = require('../lib/slot-history');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const slot = (status, extra) => Object.assign({ enabled: true, status, renter_id: null, renter_name: '', start: '', end: '' }, extra || {});
const juan = slot('rented', { renter_id: 7, renter_name: 'Juan Cruz', start: '2026-10-02', end: '2026-11-01' });
const games = { 7: 'Elden Ring', 8: 'GTA V' };
const gameOf = id => games[id] || '';
const AT = '2026-10-27T04:00:00.000Z'; // Oct 27, noon in Manila
const at = e => Object.assign({ at: AT }, e);

console.log('\ndiff()');

ok('a renter taking an open slot: one "in" line, how new, with their game and dates', () => {
  assert.deepStrictEqual(sh.diff(slot('open'), juan, { how: 'new' }, gameOf), [
    { kind: 'in', how: 'new', renter_id: 7, renter_name: 'Juan Cruz', game_title: 'Elden Ring', start: '2026-10-02', end: '2026-11-01' }
  ]);
});

ok('a bought slot arrives as how bought', () => {
  const bought = slot('buyed', { renter_id: 7, renter_name: 'Juan Cruz' });
  assert.strictEqual(sh.diff(slot('open'), bought, { how: 'new' }, gameOf)[0].how, 'bought');
});

ok('a renter leaving: one "out" line with the reason, their game and start; Open is not repeated', () => {
  ['returned', 'cleared', 'refunded', 'customer_deleted'].forEach(how => {
    assert.deepStrictEqual(sh.diff(juan, slot('open'), { how }, gameOf), [
      { kind: 'out', how, renter_id: 7, renter_name: 'Juan Cruz', game_title: 'Elden Ring', start: '2026-10-02', end: '2026-11-01' }
    ], how);
  });
});

ok('an unknown reason for leaving reads as cleared by hand', () => {
  assert.strictEqual(sh.diff(juan, slot('open'), { how: 'new' }, gameOf)[0].how, 'cleared');
});

ok('cleared straight into Maintenance: the renter leaves and the new status is noted', () => {
  assert.deepStrictEqual(sh.diff(juan, slot('maintenance'), { how: 'cleared' }, gameOf).map(e => e.kind + ':' + (e.how || e.status)),
    ['out:cleared', 'status:maintenance']);
});

ok('one renter replaced by another: out for the first, in for the second', () => {
  const pedro = slot('rented', { renter_id: 8, renter_name: 'Pedro Reyes', start: '2026-10-27', end: '2026-11-03' });
  assert.deepStrictEqual(sh.diff(juan, pedro, { how: 'cleared' }, gameOf).map(e => e.kind + ':' + e.how + ':' + e.renter_name),
    ['out:cleared:Juan Cruz', 'in:new:Pedro Reyes']);
});

ok('a move carries the other slot, and a game swap rides along on both sides', () => {
  const ctx = { how: 'moved', other: { account_id: 2, account_label: 'PS Plus deluxe 2', slot: 'trophy' }, swap: { from: 'Elden Ring', to: 'GTA V' }, game: 'GTA V' };
  const out = sh.diff(juan, slot('open'), ctx, gameOf)[0];
  assert.deepStrictEqual(out, {
    kind: 'out', how: 'moved', renter_id: 7, renter_name: 'Juan Cruz', game_title: 'Elden Ring', start: '2026-10-02', end: '2026-11-01',
    other_account_id: 2, other_account_label: 'PS Plus deluxe 2', other_slot: 'trophy', from_game: 'Elden Ring', to_game: 'GTA V'
  });
  const inn = sh.diff(slot('open'), juan, ctx, gameOf)[0];
  assert.strictEqual(inn.how, 'moved');
  assert.strictEqual(inn.game_title, 'GTA V', 'ctx.game wins over the not-yet-updated customer row');
  assert.strictEqual(inn.other_account_label, 'PS Plus deluxe 2');
});

ok('a refund undone brings the renter back as how restored', () => {
  assert.strictEqual(sh.diff(slot('open'), juan, { how: 'restored' }, gameOf)[0].how, 'restored');
});

ok('same renter, game changed: one swap line', () => {
  assert.deepStrictEqual(sh.diff(juan, juan, { swap: { from: 'Elden Ring', to: 'GTA V' } }, gameOf), [
    { kind: 'swap', renter_id: 7, renter_name: 'Juan Cruz', from_game: 'Elden Ring', to_game: 'GTA V' }
  ]);
});

ok('same renter, rented to bought: a status line naming them', () => {
  const bought = Object.assign({}, juan, { status: 'buyed', start: '', end: '' });
  assert.deepStrictEqual(sh.diff(juan, bought, {}, gameOf), [{ kind: 'status', status: 'buyed', renter_id: 7, renter_name: 'Juan Cruz' }]);
});

ok('no renter either side, status changed by hand: a status line', () => {
  assert.deepStrictEqual(sh.diff(slot('open'), slot('maintenance'), { how: 'cleared' }, gameOf), [{ kind: 'status', status: 'maintenance' }]);
});

ok('nothing that matters changed: no lines (end date, name spelling, same game)', () => {
  assert.deepStrictEqual(sh.diff(juan, Object.assign({}, juan, { end: '2026-11-08' }), {}, gameOf), []);
  assert.deepStrictEqual(sh.diff(juan, Object.assign({}, juan, { renter_name: 'Juan dela Cruz' }), {}, gameOf), []);
  assert.deepStrictEqual(sh.diff(juan, juan, { swap: { from: 'Elden Ring', to: 'Elden Ring' } }, gameOf), []);
  assert.deepStrictEqual(sh.diff(slot('open'), slot('open'), {}, gameOf), []);
});

ok('a typed name with no linked customer counts as a renter; a different name is a different renter', () => {
  const typed = slot('rented', { renter_name: 'Walk-in Ana' });
  assert.deepStrictEqual(sh.diff(slot('open'), typed, { how: 'cleared' }, gameOf).map(e => e.kind + ':' + e.how), ['in:new']);
  const other = slot('rented', { renter_name: 'Walk-in Bea' });
  assert.deepStrictEqual(sh.diff(typed, other, { how: 'cleared' }, gameOf).map(e => e.kind + ':' + e.renter_name), ['out:Walk-in Ana', 'in:Walk-in Bea']);
  assert.deepStrictEqual(sh.diff(typed, slot('rented', { renter_name: 'walk-in ana ' }), {}, gameOf), [], 'case and spaces do not count');
});

console.log('\ndescribe()');

ok('lines read the way the slot popup shows them', () => {
  const d = e => { const r = sh.describe(at(e)); return [r.date, r.title, r.detail].join(' | '); };
  assert.strictEqual(d({ kind: 'in', how: 'new', renter_name: 'Juan Cruz', game_title: 'Elden Ring', start: '2026-10-02', end: '2026-11-01' }),
    'Oct 27 | Juan Cruz started | Elden Ring · ends Nov 1');
  assert.strictEqual(d({ kind: 'in', how: 'bought', renter_name: 'Juan Cruz', game_title: 'Elden Ring' }), 'Oct 27 | Juan Cruz bought it | Elden Ring');
  assert.strictEqual(d({ kind: 'in', how: 'moved', renter_name: 'Maria Santos', other_account_label: 'PS Plus deluxe 4 JAPAN', other_slot: 'trophy', game_title: 'PS Plus Deluxe' }),
    'Oct 27 | Maria Santos moved in | from PS Plus deluxe 4 JAPAN · Trophy · PS Plus Deluxe');
  assert.strictEqual(d({ kind: 'in', how: 'restored', renter_name: 'Juan Cruz', game_title: 'Elden Ring' }), 'Oct 27 | Juan Cruz came back | refund undone · Elden Ring');
  assert.strictEqual(d({ kind: 'out', how: 'returned', renter_name: 'Maria Santos', start: '2026-10-02', game_title: 'PS Plus Deluxe' }),
    'Oct 27 | Maria Santos left | returned · rented Oct 2 → Oct 27 · PS Plus Deluxe');
  assert.strictEqual(d({ kind: 'out', how: 'cleared', renter_name: 'Walk-in Ana', start: '2026-10-20' }), 'Oct 27 | Walk-in Ana left | cleared by hand · rented Oct 20 → Oct 27');
  assert.strictEqual(d({ kind: 'out', how: 'refunded', renter_name: 'Juan Cruz' }), 'Oct 27 | Juan Cruz left | refunded');
  assert.strictEqual(d({ kind: 'out', how: 'customer_deleted', renter_name: 'Juan Cruz' }), 'Oct 27 | Juan Cruz left | customer deleted');
  assert.strictEqual(d({ kind: 'out', how: 'moved', renter_name: 'Pedro Reyes', other_account_label: 'PS Plus deluxe 2', other_slot: 'trophy', start: '2026-09-30' }),
    'Oct 27 | Pedro Reyes moved | to PS Plus deluxe 2 · Trophy · rented Sep 30 → Oct 27');
  assert.strictEqual(d({ kind: 'out', how: 'moved', renter_name: 'Juan Cruz', other_account_label: 'Main 3', other_slot: 'non_trophy', from_game: 'Elden Ring', to_game: 'GTA V' }),
    'Oct 27 | Juan Cruz moved | to Main 3 · Non-Trophy · swapped Elden Ring → GTA V');
  assert.strictEqual(d({ kind: 'swap', renter_name: 'Maria Santos', from_game: 'Elden Ring', to_game: 'GTA V' }),
    'Oct 27 | Maria Santos swapped game | Elden Ring → GTA V · stayed on this slot');
  assert.strictEqual(d({ kind: 'status', status: 'maintenance' }), 'Oct 27 | Set to Maintenance | changed by hand');
  assert.strictEqual(d({ kind: 'status', status: 'buyed', renter_id: 7, renter_name: 'Juan Cruz' }), 'Oct 27 | Set to Bought | Juan Cruz');
  assert.strictEqual(d({ kind: 'status', status: 'na' }), 'Oct 27 | Set to Not available | changed by hand');
});

ok('dates are Manila dates: 8pm UTC on Oct 26 is Oct 27 in Manila', () => {
  assert.strictEqual(sh.shortDate('2026-10-26T20:00:00.000Z'), 'Oct 27');
  assert.strictEqual(sh.shortDate('2026-10-02'), 'Oct 2');
  assert.strictEqual(sh.longDate('2026-10-26T20:00:00.000Z'), 'Oct 27, 2026');
  assert.strictEqual(sh.shortDate(''), '');
});

console.log('\nhistoryView()');

ok('the Now line, the lines newest first as given, the count and the start date', () => {
  const v = sh.historyView({
    entries: [at({ kind: 'status', status: 'maintenance' }), at({ kind: 'in', how: 'new', renter_name: 'Juan Cruz' })],
    slot: juan, game: 'Elden Ring', startedAt: '2026-10-27T01:00:00.000Z'
  });
  assert.deepStrictEqual(v.now, { title: 'Juan Cruz', detail: 'Elden Ring · since Oct 2 · ends Nov 1' });
  assert.deepStrictEqual(v.lines.map(l => l.title), ['Set to Maintenance', 'Juan Cruz started']);
  assert.strictEqual(v.total, 2);
  assert.strictEqual(v.started, 'Oct 27, 2026');
});

ok('no Now line on an empty slot; a bought slot says bought', () => {
  assert.strictEqual(sh.historyView({ entries: [], slot: slot('open'), game: '', startedAt: '' }).now, null);
  const bought = slot('buyed', { renter_id: 7, renter_name: 'Juan Cruz' });
  assert.deepStrictEqual(sh.nowLine(bought, 'Elden Ring'), { title: 'Juan Cruz', detail: 'Elden Ring · bought' });
});

console.log('\ntrim()');

ok('keeps a slot\'s newest 100 lines and leaves other slots alone', () => {
  const list = [];
  for (let i = 1; i <= 103; i++) list.push({ id: i, account_id: 3, slot: 'trophy' });
  list.push({ id: 200, account_id: 3, slot: 'non_trophy' }, { id: 201, account_id: 4, slot: 'trophy' });
  const kept = sh.trim(list, 3, 'trophy');
  const mine = kept.filter(e => e.account_id === 3 && e.slot === 'trophy');
  assert.strictEqual(mine.length, 100);
  assert.strictEqual(mine[0].id, 4, 'the three oldest went');
  assert.ok(kept.some(e => e.id === 200) && kept.some(e => e.id === 201));
  const small = list.slice(0, 5);
  assert.strictEqual(sh.trim(small, 3, 'trophy'), small, 'under the cap the list comes back as it was');
  assert.strictEqual(sh.KEEP, 100);
});

console.log('\n' + passed + ' assertions passed\n');
