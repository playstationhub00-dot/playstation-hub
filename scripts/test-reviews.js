// Plain assert-based tests for the review rules. No test framework in this
// project by design — run with `node scripts/test-reviews.js`, which exits
// non-zero on the first failed assertion.
const assert = require('assert');
const reviews = require('../lib/reviews');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

// Fixed clock so the "N days ago" assertions below don't drift with real time.
const NOW = new Date('2026-08-31T12:00:00.000Z');

function rev(over) {
  return Object.assign({
    id: 1, name: 'Ram Avila', rating: 5, text: 'Legit seller.',
    game_rented: 'Ghost of Yotei', order: 99, visible: true,
    created_at: '2026-08-20T00:00:00.000Z', source: 'site', order_ref: 'PH-0039'
  }, over);
}

function order(over) {
  return Object.assign({
    ref: 'PH-0039', state: 'active', fb_name: 'Ram Avila',
    game_title: 'Ghost of Yotei', url_key: 'abc123'
  }, over);
}

check('a review with no source field displays as Facebook', () => {
  // Every review that exists today predates the source field. They were all
  // entered from the admin "Add Review from Facebook" form, so Facebook is the
  // correct default and no backfill is needed.
  const legacy = rev({});
  delete legacy.source;
  assert.strictEqual(reviews.badgeFor(legacy), 'facebook');
  assert.strictEqual(reviews.badgeFor({}), 'facebook');
});

check('a site submission gets the verified-renter badge', () => {
  assert.strictEqual(reviews.badgeFor(rev({ source: 'site' })), 'verified');
  assert.strictEqual(reviews.badgeFor(rev({ source: 'facebook' })), 'facebook');
});

check('hasReviewed matches on order ref', () => {
  const list = [rev({ order_ref: 'PH-0039' })];
  assert.strictEqual(reviews.hasReviewed(list, 'PH-0039'), true);
  assert.strictEqual(reviews.hasReviewed(list, 'PH-0040'), false);
  assert.strictEqual(reviews.hasReviewed([], 'PH-0039'), false);
  assert.strictEqual(reviews.hasReviewed(list, null), false);
});

check('the prompt shows only once the customer has the game', () => {
  assert.strictEqual(reviews.canPrompt(order({ state: 'active' }), []), true);
  assert.strictEqual(reviews.canPrompt(order({ state: 'awaiting_return' }), []), true);
  assert.strictEqual(reviews.canPrompt(order({ state: 'verifying_return' }), []), true);
  assert.strictEqual(reviews.canPrompt(order({ state: 'closed' }), []), true);
});

check('paid-but-not-signed-in and reserved orders are not prompted', () => {
  // These customers have paid but never received a game, so there is nothing
  // honest for them to review yet.
  assert.strictEqual(reviews.canPrompt(order({ state: 'awaiting_qr' }), []), false);
  assert.strictEqual(reviews.canPrompt(order({ state: 'qr_pending' }), []), false);
  assert.strictEqual(reviews.canPrompt(order({ state: 'reserved' }), []), false);
  assert.strictEqual(reviews.canPrompt(order({ state: 'awaiting_payment' }), []), false);
  assert.strictEqual(reviews.canPrompt(order({ state: 'waitlisted' }), []), false);
  assert.strictEqual(reviews.canPrompt(null, []), false);
});

check('the prompt disappears once that order has been reviewed', () => {
  const list = [rev({ order_ref: 'PH-0039' })];
  assert.strictEqual(reviews.canPrompt(order({ ref: 'PH-0039' }), list), false);
  assert.strictEqual(reviews.canPrompt(order({ ref: 'PH-0041' }), list), true);
});

check('normalize clamps a rating into 1-5', () => {
  assert.strictEqual(reviews.normalize({ rating: '9', text: 'x' }).rating, 5);
  assert.strictEqual(reviews.normalize({ rating: '0', text: 'x' }).rating, 1);
  assert.strictEqual(reviews.normalize({ rating: '-4', text: 'x' }).rating, 1);
  assert.strictEqual(reviews.normalize({ rating: '3', text: 'x' }).rating, 3);
  assert.strictEqual(reviews.normalize({ rating: 'abc', text: 'x' }).rating, 5);
  assert.strictEqual(reviews.normalize({}).rating, 5);
});

check('normalize trims, collapses whitespace and caps length', () => {
  assert.strictEqual(reviews.normalize({ text: '  hello   there  ' }).text, 'hello there');
  assert.strictEqual(reviews.normalize({ text: '' }).text, '');
  assert.strictEqual(reviews.normalize({ text: '   ' }).text, '');
  assert.strictEqual(reviews.normalize({}).text, '');
  const long = 'a'.repeat(400);
  assert.strictEqual(reviews.normalize({ text: long }).text.length, reviews.MAX_TEXT);
});

check('sortForGame floats reviews for this game to the top', () => {
  const list = [
    rev({ id: 1, game_rented: 'Tekken 8', order: 1 }),
    rev({ id: 2, game_rented: 'Ghost of Yotei', order: 50 }),
    rev({ id: 3, game_rented: 'UFC 6', order: 2 })
  ];
  const out = reviews.sortForGame(list, 'Ghost of Yotei');
  assert.strictEqual(out[0].id, 2);
  // The rest keep their normal ordering behind it.
  assert.deepStrictEqual(out.slice(1).map(r => r.id), [1, 3]);
});

check('sortForGame matches case-insensitively and ignores surrounding space', () => {
  const list = [rev({ id: 1, game_rented: 'Tekken 8', order: 1 }),
                rev({ id: 2, game_rented: '  ghost of YOTEI ', order: 50 })];
  assert.strictEqual(reviews.sortForGame(list, 'Ghost of Yotei')[0].id, 2);
});

check('sortForGame does not mutate the array it was given', () => {
  const list = [rev({ id: 1, order: 9 }), rev({ id: 2, order: 1 })];
  const before = list.map(r => r.id);
  reviews.sortForGame(list, 'Tekken 8');
  assert.deepStrictEqual(list.map(r => r.id), before);
});

check('with no game match it falls back to order then newest', () => {
  const list = [
    rev({ id: 1, game_rented: 'A', order: 5, created_at: '2026-08-01T00:00:00.000Z' }),
    rev({ id: 2, game_rented: 'B', order: 1, created_at: '2026-08-02T00:00:00.000Z' }),
    rev({ id: 3, game_rented: 'C', order: 5, created_at: '2026-08-10T00:00:00.000Z' })
  ];
  assert.deepStrictEqual(reviews.sortForGame(list, 'Nothing').map(r => r.id), [2, 3, 1]);
});

check('aggregate averages to one decimal across the whole pool', () => {
  const list = [rev({ rating: 5 }), rev({ rating: 5 }), rev({ rating: 4 })];
  assert.deepStrictEqual(reviews.aggregate(list), { count: 3, average: 4.7 });
});

check('aggregate on an empty pool is zeroed, not NaN', () => {
  assert.deepStrictEqual(reviews.aggregate([]), { count: 0, average: 0 });
  assert.deepStrictEqual(reviews.aggregate(null), { count: 0, average: 0 });
});

check('displayName masks the surname to an initial', () => {
  assert.strictEqual(reviews.displayName(rev({ name: 'Ronald M. Fresco' })), 'Ronald F.');
  assert.strictEqual(reviews.displayName(rev({ name: 'Miggy Lojo' })), 'Miggy L.');
  assert.strictEqual(reviews.displayName(rev({ name: 'Juan' })), 'Juan');
  assert.strictEqual(reviews.displayName(rev({ name: '' })), 'Guest');
  assert.strictEqual(reviews.displayName({}), 'Guest');
});

function cust(over) {
  return Object.assign({
    id: 1, customer_name: 'Ram Avila', game_title: 'Assassins Creed Shadows',
    account_type: 'tr', status: 'renting', start_date: '2026-08-29'
  }, over);
}

check('the queue only includes customers who actually got a game', () => {
  // A reservation holder has paid for a slot but never played anything, so
  // there is nothing honest to ask them to be quoted on.
  const rows = reviews.buildRequestQueue([
    cust({ id: 1, customer_name: 'A Renting', status: 'renting' }),
    cust({ id: 2, customer_name: 'B Done', status: 'done' }),
    cust({ id: 3, customer_name: 'C Bought', status: 'bought' }),
    cust({ id: 4, customer_name: 'D Reserved', status: 'reservation' })
  ], [], NOW);
  assert.deepStrictEqual(rows.map(r => r.id).sort(), [1, 2, 3]);
});

check('a customer with a matching review is marked reviewed, not asked', () => {
  const rows = reviews.buildRequestQueue(
    [cust({ customer_name: 'Ronald M. Fresco' })],
    [rev({ name: 'Ronald M. Fresco' })],
    NOW
  );
  assert.strictEqual(rows[0].status, 'reviewed');
});

check('review matching ignores case and stray whitespace', () => {
  assert.strictEqual(reviews.hasReviewedBy([rev({ name: 'Miggy Lojo' })], '  miggy   LOJO '), true);
  assert.strictEqual(reviews.hasReviewedBy([rev({ name: 'Miggy Lojo' })], 'Miggy Lojoo'), false);
  assert.strictEqual(reviews.hasReviewedBy([], 'Miggy Lojo'), false);
  assert.strictEqual(reviews.hasReviewedBy([rev({ name: 'Miggy Lojo' })], ''), false);
});

check('having been asked outranks nothing, but a review outranks being asked', () => {
  const asked = reviews.buildRequestQueue([cust({ review_asked_at: '2026-08-28T00:00:00.000Z' })], [], NOW);
  assert.strictEqual(asked[0].status, 'asked');
  assert.strictEqual(asked[0].daysSinceAsked, 3);
  // Already reviewed wins even if they were also asked at some point.
  const both = reviews.buildRequestQueue(
    [cust({ review_asked_at: '2026-08-28T00:00:00.000Z' })],
    [rev({ name: 'Ram Avila' })],
    NOW
  );
  assert.strictEqual(both[0].status, 'reviewed');
});

check('outstanding work sorts to the top, freshest rental first', () => {
  const rows = reviews.buildRequestQueue([
    cust({ id: 1, customer_name: 'Already Reviewed', start_date: '2026-08-30' }),
    cust({ id: 2, customer_name: 'Was Asked', start_date: '2026-08-30', review_asked_at: '2026-08-30T00:00:00.000Z' }),
    cust({ id: 3, customer_name: 'Old Todo', start_date: '2026-08-01' }),
    cust({ id: 4, customer_name: 'New Todo', start_date: '2026-08-30' })
  ], [rev({ name: 'Already Reviewed' })], NOW);
  assert.deepStrictEqual(rows.map(r => r.id), [4, 3, 2, 1]);
});

check('a repeat customer is one row, not one per rental', () => {
  // Real data has someone with fourteen rental records. Fourteen rows would
  // mean asking the same person fourteen times.
  const rows = reviews.buildRequestQueue([
    cust({ id: 1, customer_name: 'Velmor Echivarre', game_title: 'Tekken 8', start_date: '2026-06-01' }),
    cust({ id: 2, customer_name: 'Velmor Echivarre', game_title: 'UFC 6', start_date: '2026-08-30' }),
    cust({ id: 3, customer_name: 'velmor  echivarre', game_title: 'NBA 2K26', start_date: '2026-07-01' })
  ], [], NOW);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].rentalCount, 3);
  // Keeps the most recent rental, which is the freshest thing to reference.
  assert.strictEqual(rows[0].game, 'UFC 6');
  assert.strictEqual(rows[0].daysSinceStart, 1);
});

check('an ask against any of a repeat customer\'s records counts', () => {
  const rows = reviews.buildRequestQueue([
    cust({ id: 1, customer_name: 'Nash Diaz', start_date: '2026-08-01' }),
    cust({ id: 2, customer_name: 'Nash Diaz', start_date: '2026-08-30', review_asked_at: '2026-08-30T00:00:00.000Z' })
  ], [], NOW);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'asked');
});

check('the row carries the masked name the ask will promise', () => {
  const row = reviews.buildRequestQueue([cust({ customer_name: 'Ram Avila' })], [], NOW)[0];
  assert.strictEqual(row.name, 'Ram Avila');
  assert.strictEqual(row.displayName, 'Ram A.');
  assert.strictEqual(row.daysSinceStart, 2);
});

check('queueSummary counts each state', () => {
  const rows = reviews.buildRequestQueue([
    cust({ id: 1, customer_name: 'A A' }),
    cust({ id: 2, customer_name: 'B B' }),
    cust({ id: 3, customer_name: 'C C', review_asked_at: '2026-08-30T00:00:00.000Z' }),
    cust({ id: 4, customer_name: 'D D' })
  ], [rev({ name: 'D D' })], NOW);
  assert.deepStrictEqual(reviews.queueSummary(rows), { todo: 2, asked: 1, reviewed: 1 });
  assert.deepStrictEqual(reviews.queueSummary([]), { todo: 0, asked: 0, reviewed: 0 });
});

check('an unparseable or missing date reports null rather than NaN', () => {
  const row = reviews.buildRequestQueue([cust({ start_date: '' })], [], NOW)[0];
  assert.strictEqual(row.daysSinceStart, null);
  assert.strictEqual(row.daysSinceAsked, null);
});

check('countRenters counts people, not rental records', () => {
  // The number shown publicly says "renters", so someone who rented fourteen
  // times has to count once. Overstating it would be the whole point of the
  // figure lost.
  assert.strictEqual(reviews.countRenters([
    cust({ id: 1, customer_name: 'Velmor Echivarre' }),
    cust({ id: 2, customer_name: 'Velmor Echivarre' }),
    cust({ id: 3, customer_name: 'Velmor Echivarre' }),
    cust({ id: 4, customer_name: 'Ram Avila' })
  ]), 2);
});

check('countRenters matches names the same way the ask queue does', () => {
  assert.strictEqual(reviews.countRenters([
    cust({ id: 1, customer_name: 'Ram Avila' }),
    cust({ id: 2, customer_name: '  ram   avila  ' }),
    cust({ id: 3, customer_name: 'RAM AVILA' })
  ]), 1);
});

check('countRenters only counts people who actually received a game', () => {
  // Same rule as the ask queue: a reservation holder has paid for a slot but
  // never played anything, so they are not yet a renter.
  assert.strictEqual(reviews.countRenters([
    cust({ id: 1, customer_name: 'A Renting', status: 'renting' }),
    cust({ id: 2, customer_name: 'B Done', status: 'done' }),
    cust({ id: 3, customer_name: 'C Bought', status: 'bought' }),
    cust({ id: 4, customer_name: 'D Reserved', status: 'reservation' })
  ]), 3);
});

check('renterMilestone rounds DOWN, so the "+" is always true', () => {
  // "300+" has to mean at least 300. Rounding up would advertise renters who
  // do not exist.
  assert.deepStrictEqual(reviews.renterMilestone(300), { n: 300, plus: true });
  assert.deepStrictEqual(reviews.renterMilestone(347), { n: 300, plus: true });
  assert.deepStrictEqual(reviews.renterMilestone(399), { n: 350, plus: true });
  assert.deepStrictEqual(reviews.renterMilestone(1240), { n: 1200, plus: true });
});

check('renterMilestone shows a small count exactly, with no "+"', () => {
  // Below the first milestone there is nothing to round to, and "0+" or "50+"
  // from 12 renters would both be lies.
  assert.deepStrictEqual(reviews.renterMilestone(12), { n: 12, plus: false });
  assert.deepStrictEqual(reviews.renterMilestone(49), { n: 49, plus: false });
  assert.deepStrictEqual(reviews.renterMilestone(50), { n: 50, plus: true });
});

check('renterMilestone survives zero and rubbish input', () => {
  assert.deepStrictEqual(reviews.renterMilestone(0), { n: 0, plus: false });
  assert.deepStrictEqual(reviews.renterMilestone(-5), { n: 0, plus: false });
  assert.deepStrictEqual(reviews.renterMilestone(null), { n: 0, plus: false });
  assert.deepStrictEqual(reviews.renterMilestone(undefined), { n: 0, plus: false });
  assert.deepStrictEqual(reviews.renterMilestone('abc'), { n: 0, plus: false });
});

check('countRenters ignores blank names and bad input', () => {
  assert.strictEqual(reviews.countRenters([cust({ customer_name: '' }), cust({ customer_name: '   ' })]), 0);
  assert.strictEqual(reviews.countRenters([]), 0);
  assert.strictEqual(reviews.countRenters(null), 0);
  assert.strictEqual(reviews.countRenters(undefined), 0);
});

console.log('\n' + passed + ' assertions passed');
