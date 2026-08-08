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
  ['confirmation','expiry_tomorrow','expiry_today','return_steps_tr','return_steps_ps4',
   'return_steps_nt','deposit_line','reviews_link','website_link'].forEach(k => {
    assert.ok(typeof t.DEFAULT_TEMPLATES[k] === 'string' && t.DEFAULT_TEMPLATES[k].length > 0, 'missing default: ' + k);
  });
});

console.log('\n' + passed + ' assertions passed');
