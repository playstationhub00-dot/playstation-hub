// Plain assert-based tests for console sign-in code handling. No test framework
// in this project by design — run with `node scripts/test-signin-code.js`,
// which exits non-zero on the first failed assertion.
const assert = require('assert');
const sc = require('../lib/signin-code');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

check('a clean code passes through uppercased', () => {
  assert.strictEqual(sc.normalizeCode('abcd1234'), 'ABCD1234');
  assert.strictEqual(sc.normalizeCode('ABCD1234'), 'ABCD1234');
});

check('separators a customer copies off a TV are stripped', () => {
  // Someone reading a code off a television will add spaces and dashes in
  // whatever places the on-screen grouping suggests. All of these are the
  // same code and must be treated as such.
  ['abcd-1234', 'ABCD 1234', 'abcd - 1234', ' abcd1234 ', 'AB-CD-12-34'].forEach(v => {
    assert.strictEqual(sc.normalizeCode(v), 'ABCD1234', v + ' should normalise');
  });
});

check('normalising never throws on rubbish input', () => {
  // This runs on a customer-submitted form field, so every shape has to be safe.
  assert.strictEqual(sc.normalizeCode(null), '');
  assert.strictEqual(sc.normalizeCode(undefined), '');
  assert.strictEqual(sc.normalizeCode(''), '');
  assert.strictEqual(sc.normalizeCode(12345678), '12345678');
  assert.strictEqual(sc.normalizeCode({}), '');
  assert.strictEqual(sc.normalizeCode([]), '');
});

check('a plausible code is accepted', () => {
  assert.strictEqual(sc.isValidCode('ABCD1234'), true);
  assert.strictEqual(sc.isValidCode('abcd-1234'), true);
  assert.strictEqual(sc.isValidCode('1234'), true);
  assert.strictEqual(sc.isValidCode('ABCDEFGH12345678'), true);
});

check('the empty box and pasted junk are rejected', () => {
  assert.strictEqual(sc.isValidCode(''), false);
  assert.strictEqual(sc.isValidCode('   '), false);
  assert.strictEqual(sc.isValidCode('---'), false);
  assert.strictEqual(sc.isValidCode(null), false);
  assert.strictEqual(sc.isValidCode(undefined), false);
});

check('validation bounds length rather than guessing a format', () => {
  // PlayStation's exact code shape is not documented here. A regex tuned to a
  // guessed format would reject a real code at the one moment it matters, and
  // the customer would have no way around it — so only the obvious failures
  // are caught: too short to be a code, too long to be anything but a paste.
  assert.strictEqual(sc.isValidCode('ABC'), false, 'below MIN_LEN');
  assert.strictEqual(sc.isValidCode('A'.repeat(sc.MAX_LEN)), true, 'exactly MAX_LEN');
  assert.strictEqual(sc.isValidCode('A'.repeat(sc.MAX_LEN + 1)), false, 'above MAX_LEN');
  assert.strictEqual(sc.isValidCode('A'.repeat(sc.MIN_LEN)), true, 'exactly MIN_LEN');
});

check('a code of any letter/digit mix is allowed', () => {
  // Deliberately permissive: all-digits, all-letters and mixed must all pass,
  // because which one PlayStation issues is not something this code decides.
  assert.strictEqual(sc.isValidCode('12345678'), true);
  assert.strictEqual(sc.isValidCode('ABCDEFGH'), true);
  assert.strictEqual(sc.isValidCode('A1B2C3D4'), true);
});

check('a pasted URL or sentence is rejected', () => {
  // The realistic wrong-paste cases: a whole link, or a chunk of instructions.
  assert.strictEqual(sc.isValidCode('https://playstation.com/link'), false);
  assert.strictEqual(sc.isValidCode('my code is ABCD1234 thanks'), false);
});

console.log('\n' + passed + ' assertions passed');
