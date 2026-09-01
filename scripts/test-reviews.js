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

console.log('\n' + passed + ' assertions passed');
