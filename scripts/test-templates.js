// Plain assert-based test for message-template substitution. No test framework
// in this project by design — run with `node scripts/test-templates.js`, which
// exits non-zero on the first failed assertion.
const assert = require('assert');
const t = require('../lib/templates');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

const TPL = {
  confirmation: 'Hi {name}, you rented {game} ({type}) for {days} days at P{price}, back by {end_date}. {website}',
  expiry_tomorrow: '{name}: {game} ends {end_date}.\n{return_steps}\n{deposit_line}',
  expiry_today: '{name}: {game} ends TODAY {end_date}.\n{return_steps}\n{deposit_line}',
  expiry_overdue: '{name}: {game} ended {end_date}, {days_overdue} days ago.\n{return_steps}\n{late_fee_line}',
  late_fee_line: 'P{late_fee_per_day}/day: P{deposit_deducted} gone, P{deposit_left} left of P{deposit}.',
  late_fee_zero_line: 'P{late_fee_per_day}/day: all P{deposit} used up after {days_overdue} days. No refund.',
  return_steps_tr: 'TROPHY STEPS',
  return_steps_ps4: 'PS4 STEPS',
  return_steps_nt: 'NONTROPHY STEPS',
  deposit_line: 'Your P{deposit} deposit comes back.',
  reviews_link: 'https://fb.example/reviews',
  website_link: 'https://site.example'
};

const TR = { customer_name: 'Ana', game_title: 'Tekken 8', account_type: 'tr', days: 7, price: 499, end_date: '2026-08-18' };
const NT = { customer_name: 'Ben', game_title: 'NBA 2K26', account_type: 'nt', days: 30, price: 699, end_date: '2026-09-01' };
const PS4 = { customer_name: 'Cy', game_title: 'UFC 6', account_type: 'ps4', days: 7, price: 499, end_date: '2026-08-18' };

check('deposit applies to trophy and ps4 only', () => {
  assert.strictEqual(t.hasDeposit('tr'), true);
  assert.strictEqual(t.hasDeposit('ps4'), true);
  assert.strictEqual(t.hasDeposit('nt'), false);
});

check('substitutes the plain customer fields', () => {
  const out = t.render(TPL.confirmation, TR, TPL, {});
  assert.strictEqual(out, 'Hi Ana, you rented Tekken 8 (Trophy) for 7 days at P499, back by Aug 18, 2026. https://site.example');
});

check('formats the end date long', () => {
  assert.ok(t.render('{end_date}', NT, TPL, {}).includes('Sep 1, 2026'));
});

check('account type renders as a human label', () => {
  assert.strictEqual(t.render('{type}', TR, TPL, {}), 'Trophy');
  assert.strictEqual(t.render('{type}', NT, TPL, {}), 'Non-Trophy');
  assert.strictEqual(t.render('{type}', PS4, TPL, {}), 'PS4 Primary');
});

check('return steps pick the matching variant', () => {
  assert.strictEqual(t.returnStepsFor(TPL, 'tr'), 'TROPHY STEPS');
  assert.strictEqual(t.returnStepsFor(TPL, 'ps4'), 'PS4 STEPS');
  assert.strictEqual(t.returnStepsFor(TPL, 'nt'), 'NONTROPHY STEPS');
});

check('ps4 gets its own steps, not the trophy ones', () => {
  const out = t.render('{return_steps}', PS4, TPL, {});
  assert.strictEqual(out, 'PS4 STEPS');
  assert.notStrictEqual(out, 'TROPHY STEPS');
});

check('deposit line appears for trophy with the amount filled in', () => {
  assert.strictEqual(t.render('{deposit_line}', TR, TPL, { deposit: 100 }), 'Your P100 deposit comes back.');
});

check('deposit line is empty for non-trophy, not a zero line', () => {
  const out = t.render('{deposit_line}', NT, TPL, { deposit: 100 });
  assert.strictEqual(out, '');
  assert.ok(!out.includes('0'));
});

check('unknown tokens are left alone rather than becoming undefined', () => {
  const out = t.render('a {gaem} b {name}', TR, TPL, {});
  assert.strictEqual(out, 'a {gaem} b Ana');
});

check('renderFor picks the named template', () => {
  const out = t.renderFor('expiry_today', TR, TPL, { deposit: 100 });
  assert.ok(out.startsWith('Ana: Tekken 8 ends TODAY Aug 18, 2026.'));
  assert.ok(out.includes('TROPHY STEPS'));
});

check('a missing end date does not print Invalid Date', () => {
  const out = t.render('{end_date}', { customer_name: 'D', game_title: 'G', account_type: 'nt', days: 7, price: 1, end_date: '' }, TPL, {});
  assert.strictEqual(out, '');
});

check('defaults expose every field the settings form saves', () => {
  ['confirmation','expiry_tomorrow','expiry_today','expiry_overdue','late_fee_line','late_fee_zero_line',
   'return_steps_tr','return_steps_ps4','return_steps_nt','deposit_line','reviews_link','website_link'].forEach(k => {
    assert.ok(typeof t.DEFAULT_TEMPLATES[k] === 'string' && t.DEFAULT_TEMPLATES[k].length > 0, 'missing default: ' + k);
  });
});

check('days_overdue comes from opts, so render stays time-independent', () => {
  const out = t.render('{days_overdue}', TR, TPL, { daysOverdue: 12 });
  assert.strictEqual(out, '12');
});

check('days_overdue is blank when the caller does not supply it', () => {
  const out = t.render('[{days_overdue}]', TR, TPL, {});
  assert.strictEqual(out, '[]');
});

check('the overdue template fills name, game and day count together', () => {
  const out = t.renderFor('expiry_overdue', TR, TPL, { deposit: 100, daysOverdue: 3 });
  assert.ok(out.includes(TR.customer_name), 'name missing');
  assert.ok(out.includes(TR.game_title), 'game missing');
  assert.ok(out.includes('3 days ago'), 'day count missing');
  assert.ok(!out.includes('{'), 'an unresolved token remains: ' + out);
});

check('late fee deducts per day and reports what is left', () => {
  const out = t.render('{late_fee_line}', TR, TPL, { deposit: 100, lateFeePerDay: 20, daysOverdue: 3 });
  assert.strictEqual(out, 'P20/day: P60 gone, P40 left of P100.');
});

check('deduction is capped at the deposit, never negative', () => {
  const out = t.render('{deposit_deducted}/{deposit_left}', TR, TPL, { deposit: 100, lateFeePerDay: 20, daysOverdue: 30 });
  assert.strictEqual(out, '100/0');
});

check('an exhausted deposit switches to the no-refund wording', () => {
  const out = t.render('{late_fee_line}', TR, TPL, { deposit: 100, lateFeePerDay: 20, daysOverdue: 5 });
  assert.ok(out.includes('No refund'), 'expected the zero variant, got: ' + out);
});

check('exactly at the boundary the deposit is gone, not one day early', () => {
  const four = t.render('{deposit_left}', TR, TPL, { deposit: 100, lateFeePerDay: 20, daysOverdue: 4 });
  const five = t.render('{deposit_left}', TR, TPL, { deposit: 100, lateFeePerDay: 20, daysOverdue: 5 });
  assert.strictEqual(four, '20');
  assert.strictEqual(five, '0');
});

check('non-trophy has no deposit, so no late-fee sentence at all', () => {
  const out = t.render('[{late_fee_line}]', NT, TPL, { deposit: 100, lateFeePerDay: 20, daysOverdue: 9 });
  assert.strictEqual(out, '[]');
});

check('a rental that is not overdue gets no late-fee sentence', () => {
  const out = t.render('[{late_fee_line}]', TR, TPL, { deposit: 100, lateFeePerDay: 20, daysOverdue: 0 });
  assert.strictEqual(out, '[]');
});

check('a zero per-day rate deducts nothing and keeps the deposit whole', () => {
  const out = t.render('{deposit_deducted}/{deposit_left}', TR, TPL, { deposit: 100, lateFeePerDay: 0, daysOverdue: 9 });
  assert.strictEqual(out, '0/100');
});

check('trailing blank line from an empty token is trimmed cleanly', () => {
  const out = t.render('a\n{deposit_line}', NT, TPL, {});
  assert.strictEqual(out, 'a');
});

const WEB = Object.assign({}, TR, { order_ref: 'PH-0039', order_key: 'abc123def456' });

check('review_link points at the customer own order page', () => {
  const out = t.render('{review_link}', WEB, TPL, {});
  assert.strictEqual(out, 'https://site.example/order/PH-0039?k=abc123def456');
});

check('review_line renders the ask when there is an order to link to', () => {
  const tpl = Object.assign({}, TPL, { review_line: 'Review us: {review_link}' });
  assert.strictEqual(t.render('{review_line}', WEB, tpl, {}), 'Review us: https://site.example/order/PH-0039?k=abc123def456');
});

check('the ask disappears entirely for a customer with no order page', () => {
  // Every record predating the web ordering flow, and anyone the owner added by
  // hand, has no ref or key — they must get no line at all rather than a broken
  // link or a dangling "Review us:".
  const tpl = Object.assign({}, TPL, { review_line: 'Review us: {review_link}' });
  assert.strictEqual(t.render('a\n{review_line}', TR, tpl, {}), 'a');
  assert.strictEqual(t.render('{review_link}', TR, tpl, {}), '');
});

check('a half-linked customer is treated as unlinked', () => {
  // A ref without its key would build a URL that fails the url_key check on
  // /order/:ref and bounce the customer to /browse.
  const tpl = Object.assign({}, TPL, { review_line: 'Review us: {review_link}' });
  const refOnly = Object.assign({}, TR, { order_ref: 'PH-0039' });
  const keyOnly = Object.assign({}, TR, { order_key: 'abc123' });
  assert.strictEqual(t.render('a\n{review_line}', refOnly, tpl, {}), 'a');
  assert.strictEqual(t.render('a\n{review_line}', keyOnly, tpl, {}), 'a');
});

check('the ask ships at exactly two moments: signed in, and returned', () => {
  // What customers actually review here is the service — "legit and fast",
  // "zero issues with the activation" — not the game, which they already knew
  // before renting. Both facts are true by the time they are signed in, so the
  // ask lands there and again once the deposit is back. Deliberately NOT in
  // expiry_today as well: three asks in one rental is nagging, and that
  // message is already doing the work of return steps and the deposit line.
  assert.ok(t.DEFAULT_TEMPLATES.confirmation.includes('{review_line_setup}'));
  assert.ok(t.DEFAULT_TEMPLATES.return_complete.includes('{review_line}'));
  assert.ok(!t.DEFAULT_TEMPLATES.expiry_today.includes('{review_line}'));
  // Still the site's own review page, never Facebook — that split is what left
  // the site's review section empty for months.
  assert.ok(!t.DEFAULT_TEMPLATES.confirmation.includes('{reviews_link}'));
  assert.ok(t.DEFAULT_TEMPLATES.review_line.includes('{review_link}'));
  assert.ok(t.DEFAULT_TEMPLATES.review_line_setup.includes('{review_link}'));
});

check('both ask lines collapse for a customer with no order link', () => {
  // ~300 records predate the web ordering flow and carry no ref/key. They must
  // get a clean message, not a sentence trailing a broken link.
  const tpl = Object.assign({}, TPL, {
    review_line: 'Review us: {review_link}',
    review_line_setup: 'How was setup? {review_link}'
  });
  assert.strictEqual(t.render('a\n{review_line_setup}', TR, tpl, {}), 'a');
  assert.strictEqual(t.render('a\n{review_line}', TR, tpl, {}), 'a');
  assert.strictEqual(
    t.render('{review_line_setup}', WEB, tpl, {}),
    'How was setup? https://site.example/order/PH-0039?k=abc123def456'
  );
});

check('no shipped template sends reviews to Facebook any more', () => {
  // The confirmation carried an {reviews_link} ask for months. Pointing renters
  // at Facebook is exactly what kept the site's own review section empty, and
  // alongside the new ask it would request a review twice in one message.
  // server.js strips it from stored templates; this guards the defaults.
  Object.keys(t.DEFAULT_TEMPLATES).forEach(k => {
    if (k === 'reviews_link') return;
    assert.ok(!t.DEFAULT_TEMPLATES[k].includes('{reviews_link}'),
      k + ' still points reviews at Facebook');
  });
});

check('the shipped ask lines are about the service, not the game', () => {
  // The whole reason this moved to sign-in time. If the copy asked "how was
  // the game?" the moment would be wrong again.
  const both = t.DEFAULT_TEMPLATES.review_line_setup + ' ' + t.DEFAULT_TEMPLATES.return_complete;
  assert.ok(!/how was the game|enjoy the game\?/i.test(both));
});

console.log('\n' + passed + ' assertions passed');
