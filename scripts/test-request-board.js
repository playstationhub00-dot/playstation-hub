// Run: node scripts/test-request-board.js
//
// A stocked request is not automatically rentable. Coming soon games stay on
// the request board after the owner marks them stocked, and that card used to
// say "Now available — Rent" even while reservations were the only thing open.
const assert = require('assert');
const board = require('../lib/request-board');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const games = [
  { id: 9, title: 'Phantom Blade Zero' },
  { id: 4, title: 'Elden Ring Nightreign' }
];
const upcoming = [
  { id: 2, title: 'Phantom Blade Zero', release_date: '2026-10-29' },
  { id: 8, title: 'Silent Hill: Townfall' }
];

console.log('\nlinkStockedRequest');

ok('a catalogue game with no Coming soon row is rentable', () => {
  const link = board.linkStockedRequest(
    { title: 'Elden Ring Nightreign', game_id: 4 },
    games,
    upcoming
  );
  assert.strictEqual(link.linkKind, 'available');
  assert.strictEqual(link.linkedUrl, '/game/elden-ring-nightreign');
});

ok('a title that is still upcoming is a reservation, even when a catalogue row and game_id exist', () => {
  const link = board.linkStockedRequest(
    { title: 'Phantom Blade Zero', game_id: 9 },
    games,
    upcoming
  );
  assert.strictEqual(link.linkKind, 'upcoming');
  assert.strictEqual(link.linkedUrl, '/upcoming/phantom-blade-zero-2');
});

ok('an upcoming title with no catalogue row still reserves, and does not look rentable', () => {
  const link = board.linkStockedRequest(
    { title: 'Silent Hill: Townfall', game_id: null },
    games,
    upcoming
  );
  assert.strictEqual(link.linkKind, 'upcoming');
  assert.strictEqual(link.linkedUrl, '/upcoming/silent-hill-townfall-8');
});

ok('a stocked request with no matching game stays unlinked', () => {
  const link = board.linkStockedRequest(
    { title: 'Something Unlisted', game_id: 99 },
    games,
    upcoming
  );
  assert.strictEqual(link.linkKind, 'stocked');
  assert.strictEqual(link.linkedUrl, null);
});

ok('title match still finds an older stocked request that has no game_id', () => {
  const link = board.linkStockedRequest(
    { title: 'Elden Ring Nightreign' },
    [{ id: 4, title: 'Elden Ring Nightreign' }],
    []
  );
  assert.strictEqual(link.linkKind, 'available');
  assert.strictEqual(link.linkedUrl, '/game/elden-ring-nightreign');
});

console.log('\n' + passed + ' assertions passed\n');
