// Plain assert-based tests for the game-request name helpers. No test framework
// in this project by design — run with `node scripts/test-requests.js`, which
// exits non-zero on the first failed assertion.
//
// These are the two functions that decide how much of a customer's name the
// public /requests page shows. Nothing here touches the database.
const assert = require('assert');
const requests = require('../lib/requests');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

check('first name is the leading word', () => {
  assert.strictEqual(requests.firstName('Walid Khatib'), 'Walid');
});

check('initials abbreviate a full name', () => {
  assert.strictEqual(requests.initials('Walid Khatib'), 'W.K.');
});

check('a single-word name still gets an initial', () => {
  assert.strictEqual(requests.initials('Walid'), 'W.');
});

check('only the first two words count, so a long name stays short', () => {
  assert.strictEqual(requests.initials('Juan Miguel Dela Cruz'), 'J.M.');
});

check('extra whitespace does not produce empty initials', () => {
  assert.strictEqual(requests.initials('  Maria   Santos  '), 'M.S.');
});

check('initials are upper-cased however the name was typed', () => {
  assert.strictEqual(requests.initials('maria santos'), 'M.S.');
});

// The page renders this string directly, so an empty or junk name must still
// come back as something printable rather than a bare dot or "undefined".
check('a missing name falls back the same way firstName does', () => {
  assert.strictEqual(requests.initials(''), 'Someone');
  assert.strictEqual(requests.initials(null), 'Someone');
  assert.strictEqual(requests.initials(undefined), 'Someone');
});

check('a name of only punctuation does not become a lone dot', () => {
  assert.strictEqual(requests.initials('!!!'), 'Someone');
});

// Emoji and non-Latin names are common in Facebook display names. The point is
// that the result is short and never throws, not that an emoji is a letter.
check('a non-Latin name is abbreviated without throwing', () => {
  assert.strictEqual(typeof requests.initials('Мария Иванова'), 'string');
  assert.ok(requests.initials('Мария Иванова').length <= 6);
});

console.log('\n' + passed + ' assertions passed');
