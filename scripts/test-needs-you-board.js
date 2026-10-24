// Run: node scripts/test-needs-you-board.js
//
// lib/needs-you-board.js buildBoard: the Waitlist and the Follow-ups grouped
// into one card per game + account type for Admin → Orders → Needs you → By
// game. Cards with a free slot first, then most people; inside a card the
// waiting people priority-then-oldest and the follow-ups newest first.
// See docs/superpowers/specs/2026-10-24-orders-by-game-board-design.md.
const assert = require('assert');
const { buildBoard } = require('../lib/needs-you-board');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const o = (ref, game_id, game_title, account_type, state, created_at, extra) =>
  Object.assign({ ref, game_id, game_title, account_type, state, created_at }, extra || {});

const waitlist = [
  o('PH-0189', 3, "Marvel's Wolverine", 'nt', 'reserved', '2026-09-29T00:00:00Z'),
  o('PH-0186', 3, "Marvel's Wolverine", 'nt', 'waitlisted', '2026-09-27T00:00:00Z'),
  o('PH-0182', 3, "Marvel's Wolverine", 'tr', 'waitlisted', '2026-09-27T00:00:00Z'),
  o('PH-0256', 1, 'Onimusha: Way of the Sword', 'tr', 'waitlisted', '2026-10-22T00:00:00Z'),
  o('PH-0087', 1, 'Onimusha: Way of the Sword', 'tr', 'waitlisted', '2026-09-07T00:00:00Z'),
  o('PH-0300', 'psplus', 'PS Plus Deluxe', 'nt', 'waitlisted', '2026-10-01T00:00:00Z')
];
const followUps = [
  o('PH-0261', 3, "Marvel's Wolverine", 'nt', 'awaiting_payment', '2026-10-23T00:00:00Z'),
  o('PH-0247', 3, "Marvel's Wolverine", 'nt', 'payment_rejected', '2026-10-21T00:00:00Z'),
  o('PH-0250', 'upcoming_4', 'Ghost of Yotei', 'tr', 'awaiting_payment', '2026-10-20T00:00:00Z', { is_reservation: true }),
  o('PH-0251', 'bundle_2', 'Spider-Man Box', 'nt', 'awaiting_payment', '2026-10-19T00:00:00Z', { is_buy: true }),
  o('PH-0252', 9, 'NBA2K27', 'nt', 'awaiting_payment', '2026-10-18T00:00:00Z')
];

ok('one card per game + account type, across games, PS Plus, Coming Soon and box sets', () => {
  const cards = buildBoard({ waitlist, followUps, slotsFree: {} });
  assert.deepStrictEqual(cards.map(c => c.key).sort(),
    ['1|tr', '3|nt', '3|tr', '9|nt', 'bundle_2|nt', 'psplus|nt', 'upcoming_4|tr']);
  const kinds = Object.fromEntries(cards.map(c => [c.key, c.kind]));
  assert.deepStrictEqual([kinds['3|nt'], kinds['psplus|nt'], kinds['upcoming_4|tr'], kinds['bundle_2|nt']], ['game', 'psplus', 'upcoming', 'bundle']);
  const w = cards.find(c => c.key === '3|nt');
  assert.deepStrictEqual([w.gameId, w.type, w.title], [3, 'nt', "Marvel's Wolverine"]);
});

ok('inside a card: waiting priority first then oldest; follow-ups newest first', () => {
  const w = buildBoard({ waitlist, followUps }).find(c => c.key === '3|nt');
  assert.deepStrictEqual(w.waiting.map(x => x.ref), ['PH-0189', 'PH-0186']);
  assert.deepStrictEqual(w.followUps.map(x => x.ref), ['PH-0261', 'PH-0247']);
  const on = buildBoard({ waitlist }).find(c => c.key === '1|tr');
  assert.deepStrictEqual(on.waiting.map(x => x.ref), ['PH-0087', 'PH-0256']);
  assert.deepStrictEqual(on.followUps, []);
});

ok('cards with a free slot first, then most people, then title A-Z, then Trophy, Non-Trophy, PS4', () => {
  const cards = buildBoard({ waitlist, followUps, slotsFree: { '9|nt': 1, '1|tr': 0 } });
  assert.deepStrictEqual(cards.map(c => c.key),
    ['9|nt', '3|nt', '1|tr', 'upcoming_4|tr', '3|tr', 'psplus|nt', 'bundle_2|nt']);
  const tie = buildBoard({ waitlist: [
    o('A1', 5, 'Same', 'nt', 'waitlisted', '2026-10-01T00:00:00Z'),
    o('A2', 5, 'Same', 'tr', 'waitlisted', '2026-10-01T00:00:00Z'),
    o('A3', 6, 'Alpha', 'ps4', 'waitlisted', '2026-10-01T00:00:00Z')
  ] });
  assert.deepStrictEqual(tie.map(c => c.key), ['6|ps4', '5|tr', '5|nt']);
});

ok('slotsFree counts only for released games and PS Plus, never below zero', () => {
  const cards = buildBoard({ waitlist, followUps, slotsFree: { '3|nt': 2, 'psplus|nt': 1, 'upcoming_4|tr': 3, 'bundle_2|nt': 1, '1|tr': -1 } });
  const free = Object.fromEntries(cards.map(c => [c.key, c.slotsFree]));
  assert.deepStrictEqual(free, { '3|nt': 2, 'psplus|nt': 1, 'upcoming_4|tr': 0, 'bundle_2|nt': 0, '1|tr': 0, '3|tr': 0, '9|nt': 0 });
});

ok('empty or missing input gives no cards; a missing title and type still group', () => {
  assert.deepStrictEqual(buildBoard(), []);
  assert.deepStrictEqual(buildBoard({ waitlist: null, followUps: [null] }), []);
  const [c] = buildBoard({ followUps: [o('PH-0400', 77, '', undefined, 'awaiting_payment', '2026-10-01T00:00:00Z')] });
  assert.deepStrictEqual([c.key, c.type, c.title], ['77|nt', 'nt', 'Unknown game']);
});

console.log('\n' + passed + ' assertions passed\n');
