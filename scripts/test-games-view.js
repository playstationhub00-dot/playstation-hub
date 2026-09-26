// Run: node scripts/test-games-view.js
//
// The Games tab's row data (lib/games-view.js). Its flags follow the customer
// site's own rules — computeAvailability() for slots and Sold out, the NEW
// badge's window, game-detail.ejs's "not rented yet" check — so these feed it
// the same inputs the site sees.
const assert = require('assert');
const gv = require('../lib/games-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const NOW = new Date('2026-09-26T04:00:00.000Z');
// n whole days ago, plus an hour so the day count is never on a boundary.
const daysAgo = n => new Date(NOW.getTime() - n * 86400000 - 3600000).toISOString();
const GAME = over => Object.assign({
  id: 1, title: 'Tekken 8', platform: 'PS5', genre: 'Fighting', created_at: daysAgo(40),
  non_trophy_slots: 2, trophy_slots: 1, ps4_primary_slots: 0, renters: 3,
  nt_price_7d: 149, nt_price_30d: 349, tr_price_7d: 199, tr_price_30d: 399
}, over || {});
const one = (g, customers, summaries) => gv.gameRows([g], customers || [], summaries || {}, NOW)[0];

console.log('\nnew window');

ok('a game added 10 days ago is new with 1 day left', () => {
  const r = one(GAME({ created_at: daysAgo(10) }));
  assert.strictEqual(r.status.isNew, true);
  assert.strictEqual(r.status.daysLeft, 1);
  assert.ok(r.chips.includes('new'));
});

ok('on day 11 it is no longer new', () => {
  const r = one(GAME({ created_at: daysAgo(11) }));
  assert.strictEqual(r.status.isNew, false);
  assert.strictEqual(r.status.daysLeft, null);
});

ok('a custom new_window_days stretches the window', () => {
  const r = one(GAME({ created_at: daysAgo(11), new_window_days: 30 }));
  assert.strictEqual(r.status.isNew, true);
  assert.strictEqual(r.status.daysLeft, 19);
});

ok('no created_at is never new', () => {
  assert.strictEqual(one(GAME({ created_at: undefined })).status.isNew, false);
});

console.log('\nnever rented');

ok('no renters and not stocked is never rented', () => {
  const r = one(GAME({ renters: 0 }));
  assert.strictEqual(r.status.neverRented, true);
  assert.ok(r.chips.includes('never'));
});

ok('stocked or rented once clears it', () => {
  assert.strictEqual(one(GAME({ renters: 0, stocked: true })).status.neverRented, false);
  assert.strictEqual(one(GAME({ renters: 1 })).status.neverRented, false);
  assert.strictEqual(one(GAME({ renters: 0, stocked: true })).status.stocked, true);
});

console.log('\nslots and sold out');

ok('slot counts come from the hand-typed fields when there are no linked accounts', () => {
  const r = one(GAME());
  assert.deepStrictEqual([r.slots.nt, r.slots.tr, r.slots.total], [2, 1, 3]);
  assert.strictEqual(r.status.soldOut, false);
});

ok('linked accounts win over the hand-typed counts, as on the site', () => {
  const r = one(GAME({ id: 7 }), [], { 7: { non_trophy: { total: 2, available: 0 }, trophy: { total: 1, available: 0 } } });
  assert.deepStrictEqual([r.slots.nt, r.slots.tr], [0, 0]);
  assert.strictEqual(r.status.soldOut, true);
  assert.ok(r.chips.includes('soldout'));
});

ok('PS4 slots do not keep a PS5-only game off Sold out, and the PS4 chip is hidden there', () => {
  const r = one(GAME({ non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 3 }));
  assert.strictEqual(r.status.soldOut, true);
  assert.strictEqual(r.slots.showPs4, false);
  const r2 = one(GAME({ platform: 'PS4/PS5', non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 3 }));
  assert.strictEqual(r2.status.soldOut, false);
  assert.strictEqual(r2.slots.showPs4, true);
});

console.log('\nmoney');

ok('earnings add up every customer record for the game, string or numeric id', () => {
  const r = one(GAME({ id: 5, cost: 1000 }), [
    { game_id: 5, price: 349 }, { game_id: '5', price: 199 }, { game_id: 6, price: 999 }
  ]);
  assert.deepStrictEqual(r.money, { earned: 548, txns: 2, cost: 1000, profit: -452 });
});

ok('Coming Soon and PS Plus records never count toward a game', () => {
  const r = one(GAME({ id: 5 }), [{ game_id: 'upcoming_5', price: 449 }, { game_id: 'psplus', price: 299 }, { game_id: null, price: 50 }]);
  assert.deepStrictEqual([r.money.earned, r.money.txns], [0, 0]);
});

ok('no cost counts as 0', () => {
  assert.strictEqual(one(GAME({ id: 5 }), [{ game_id: 5, price: 349 }]).money.profit, 349);
});

console.log('\nrow shape');

ok('bundle and category show up in the row, its chips and its search text', () => {
  const r = one(GAME({ is_bundle: true, _category_name: 'New Games' }));
  assert.strictEqual(r.isBundle, true);
  assert.strictEqual(r.categoryName, 'New Games');
  assert.ok(r.chips.includes('bundle'));
  assert.strictEqual(r.search, 'tekken 8 fighting new games');
});

ok('missing prices become 0 and missing text becomes blank rather than throwing', () => {
  const r = gv.gameRows([{ id: 9 }], [], {}, NOW)[0];
  assert.deepStrictEqual(r.prices, { nt7: 0, nt30: 0, tr7: 0, tr30: 0, buyNt: 0, buyTr: 0 });
  assert.strictEqual(r.title, '');
  assert.strictEqual(r.cover, '');
});

ok('chip counts tally each flag', () => {
  const rows = gv.gameRows([
    GAME({ id: 1, created_at: daysAgo(2) }),
    GAME({ id: 2, renters: 0 }),
    GAME({ id: 3, non_trophy_slots: 0, trophy_slots: 0, is_bundle: true })
  ], [], {}, NOW);
  assert.deepStrictEqual(gv.chipCounts(rows), { all: 3, new: 1, soldout: 1, never: 1, bundle: 1 });
});

console.log('\nComing soon rows');

ok('ready only once a real release date is on or before today', () => {
  const rows = gv.upcomingRows([
    { id: 15, title: 'A', release_date: '2026-09-26' },
    { id: 16, title: 'B', release_date: '2026-09-27' },
    { id: 17, title: 'C', release_date: 'TBA' },
    { id: 18, title: 'D' }
  ], {}, '2026-09-26');
  assert.deepStrictEqual(rows.map(r => r.ready), [true, false, false, false]);
  assert.strictEqual(rows[0].outSince, 'Sep 26, 2026');
  assert.deepStrictEqual(rows.map(r => r.releaseLabel), ['Sep 26, 2026', 'Sep 27, 2026', 'TBA', '—']);
});

ok('reserved counts are read by id, and missing ones are 0', () => {
  const rows = gv.upcomingRows([{ id: 15, title: 'A' }, { id: 16, title: 'B' }], { '15': 3 }, '2026-09-26');
  assert.deepStrictEqual(rows.map(r => r.reserved), [3, 0]);
});

ok('the request summary counts pending separately', () => {
  assert.deepStrictEqual(gv.requestSummary([{ status: 'pending' }, { status: 'approved' }, { status: 'pending' }]), { total: 3, pending: 2 });
  assert.deepStrictEqual(gv.requestSummary(null), { total: 0, pending: 0 });
});

console.log('\n' + passed + ' assertions passed\n');
