// Run: node scripts/test-availability.js
//
// Covers fullGameIds, the predicate behind the Posters tab's "hide full games"
// filter. It is deliberately the same totalSlots the cards decide on, so a
// game the site shows as fully booked is exactly the one the poster leaves out.
const assert = require('assert');
const computeAvailability = require('../lib/availability');
const { fullGameIds, buyTypeSellable } = computeAvailability;

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

console.log('\nthe export shape other callers rely on');

ok('the module is still the function itself', () => {
  // game-card.ejs and game-detail.ejs call require(...)(game, sum, days).
  assert.strictEqual(typeof computeAvailability, 'function');
  const a = computeAvailability({ platform: 'PS5', non_trophy_slots: 2 }, null, {});
  assert.strictEqual(a.totalSlots, 2);
});

console.log('\nfullGameIds() — legacy per-game counts');

ok('a game with no slots of any type is full', () => {
  const ids = fullGameIds([
    { id: 1, platform: 'PS5', non_trophy_slots: 0, trophy_slots: 0 }
  ], {});
  assert.deepStrictEqual([...ids], [1]);
});

ok('one free slot of any type is enough to keep it', () => {
  const ids = fullGameIds([
    { id: 1, platform: 'PS5', non_trophy_slots: 1, trophy_slots: 0 },
    { id: 2, platform: 'PS5', non_trophy_slots: 0, trophy_slots: 1 }
  ], {});
  assert.deepStrictEqual([...ids], [], 'neither is full');
});

ok('PS4 slots do not rescue a PS5-only game', () => {
  // computeAvailability hides PS4 Primary on a PS5 game, so those slots are not
  // sellable and must not count toward "has something free". Getting this wrong
  // would keep a genuinely full game on the poster.
  const ids = fullGameIds([
    { id: 1, platform: 'PS5', non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 3 }
  ], {});
  assert.deepStrictEqual([...ids], [1]);
});

ok('but they do count on a platform that actually offers them', () => {
  const ids = fullGameIds([
    { id: 1, platform: 'PS4', non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 3 },
    { id: 2, platform: 'PS4/PS5', non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 1 }
  ], {});
  assert.deepStrictEqual([...ids], []);
});

console.log('\nfullGameIds() — linked accounts override the legacy counts');

ok('an account with nothing available makes it full, whatever the legacy count says', () => {
  // The legacy field here still claims 5 free. Linked accounts are the truth
  // once they exist, and the card already behaves this way.
  const ids = fullGameIds(
    [{ id: 7, platform: 'PS5', non_trophy_slots: 5, trophy_slots: 0 }],
    { 7: { non_trophy: { total: 3, available: 0 } } }
  );
  assert.deepStrictEqual([...ids], [7]);
});

ok('an account with a slot free keeps it, even when the legacy count is zero', () => {
  const ids = fullGameIds(
    [{ id: 7, platform: 'PS5', non_trophy_slots: 0, trophy_slots: 0 }],
    { 7: { trophy: { total: 2, available: 1 } } }
  );
  assert.deepStrictEqual([...ids], []);
});

ok('each slot type falls back independently', () => {
  // Trophy comes from accounts and is empty; non-trophy has no account at all
  // and still has its legacy slot. That game is not full.
  const ids = fullGameIds(
    [{ id: 9, platform: 'PS5', non_trophy_slots: 2, trophy_slots: 4 }],
    { 9: { trophy: { total: 4, available: 0 } } }
  );
  assert.deepStrictEqual([...ids], []);
});

console.log('\nfullGameIds() — defensive');

ok('bad input does not throw', () => {
  assert.deepStrictEqual([...fullGameIds(null, {})], []);
  assert.deepStrictEqual([...fullGameIds([null, undefined], {})], []);
  assert.deepStrictEqual([...fullGameIds([{ id: 1, platform: 'PS5' }], null)], [1],
    'a game with no counts and no summaries is full, not a crash');
});

ok('it returns a Set, which is what the caller filters with', () => {
  const ids = fullGameIds([{ id: 3, platform: 'PS5', non_trophy_slots: 0 }], {});
  assert.ok(ids instanceof Set);
  assert.strictEqual(ids.has(3), true);
  assert.strictEqual(ids.has(99), false);
});

console.log('\nbuyTypeSellable() — permanent-access gating per slot type');

ok('a linked account with a genuinely sellable slot is sellable', () => {
  assert.strictEqual(buyTypeSellable({ non_trophy: { total: 2, sellable: 1 } }, 'non_trophy'), true);
});

ok('a linked account with every slot sold/offline is not sellable', () => {
  // Deliberately NOT the same as "full from renters" — a linked account's
  // rented slots stay sellable (see the next block); this is buyed/na/maintenance.
  assert.strictEqual(buyTypeSellable({ non_trophy: { total: 2, sellable: 0 } }, 'non_trophy'), false);
});

ok('no linked account and never rented before stays sellable — the account is set up on order', () => {
  assert.strictEqual(buyTypeSellable(null, 'non_trophy', { everStocked: false, avail: false }), true);
  assert.strictEqual(buyTypeSellable({}, 'trophy', { everStocked: false, avail: false }), true);
});

ok('no linked account, rented before, and a free legacy slot right now is sellable', () => {
  assert.strictEqual(buyTypeSellable(null, 'non_trophy', { everStocked: true, avail: true }), true);
});

ok('no linked account, rented before, and no free legacy slot is NOT sellable', () => {
  // The bug this exists for: a legacy type with every slot taken by a renter
  // has no known end date to sell against (unlike a linked account), so it
  // must show as full rather than still being offered.
  assert.strictEqual(buyTypeSellable(null, 'non_trophy', { everStocked: true, avail: false }), false);
  assert.strictEqual(buyTypeSellable({}, 'trophy', { everStocked: true, avail: false }), false);
});

ok('with no legacy context at all, the old always-sellable fallback still holds', () => {
  // Every existing call site that hasn't been taught about legacy availability
  // yet must keep behaving exactly as before.
  assert.strictEqual(buyTypeSellable(null, 'non_trophy'), true);
  assert.strictEqual(buyTypeSellable({}, 'trophy', undefined), true);
});

console.log('\nTrophy is always offered');

ok('a game saved with the old Trophy switch off still offers Trophy, shown as full at 0 slots', () => {
  const a = computeAvailability({ platform: 'PS5', trophy_account: false, trophy_slots: 0, non_trophy_slots: 2 }, null, {});
  assert.strictEqual(a.hasTrophy, true);
  assert.strictEqual(a.trAvail, false);
  assert.strictEqual(a.trSlots, 0);
});

console.log('\n' + passed + ' assertions passed\n');
