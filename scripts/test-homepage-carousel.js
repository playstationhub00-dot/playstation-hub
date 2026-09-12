// Run: node scripts/test-homepage-carousel.js
//
// The homepage carousels live in an inline <script> in views/index.ejs. These
// are source-level guards rather than behavioural tests: the drift loop needs a
// real layout to do anything, so the browser is where it gets exercised. What
// is pinned here is the one invariant that broke a Coming Soon card needing two
// clicks — the rule a future edit is most likely to undo by accident.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');

function autoDriftSource() {
  const m = src.match(/function autoDrift\([\s\S]*?\n  \}/);
  assert.ok(m, 'views/index.ejs still defines autoDrift');
  return m[0];
}

// The body of one addEventListener('<type>', function (e) { ... }) inside autoDrift.
function listenerBody(type) {
  const body = autoDriftSource();
  const start = body.indexOf("addEventListener('" + type + "'");
  assert.ok(start !== -1, 'autoDrift still listens for ' + type);
  const open = body.indexOf('{', body.indexOf('function', start));
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') {
      depth--;
      if (depth === 0) return body.slice(open, i + 1);
    }
  }
  throw new Error('could not find the end of the ' + type + ' listener');
}

console.log('\na press must not tear the row down');

ok('pointerdown does not call stop()', () => {
  // stop() folds the scroll position back into the real set and removes every
  // cloned card. Doing that on pointerdown pulled the content out from under
  // the cursor between press and release, so mousedown and mouseup shared no
  // target and the browser never fired a click — a Coming Soon card had to be
  // clicked twice, the first press only resetting the row.
  const body = listenerBody('pointerdown');
  assert.ok(!/\bstop\(\)/.test(body),
    'pointerdown must only record the press, not tear the row down:\n' + body);
});

ok('a horizontal drag still takes control of the row', () => {
  const body = listenerBody('pointermove');
  assert.ok(/\bstop\(\)/.test(body), 'pointermove is what hands the row over');
  assert.ok(/Math\.abs/.test(body), 'and it needs a movement threshold, not any jitter');
});

ok('the press is cleared when the button comes back up', () => {
  // Left set, the next stray pointermove anywhere on the row would be read as
  // a continuing drag and stop the animation for no reason.
  const drift = autoDriftSource();
  assert.ok(/pointerup/.test(drift), 'pointerup clears the recorded press');
  assert.ok(/pointercancel/.test(drift), 'and so does pointercancel');
});

console.log('\nthe gestures that should still stop it, do');

ok('a horizontal wheel still stops the drift', () => {
  const body = listenerBody('wheel');
  assert.ok(/\bstop\(\)/.test(body));
  assert.ok(/deltaX/.test(body) && /deltaY/.test(body),
    'only along the row: a vertical wheel is someone scrolling the page past it');
});

ok('a horizontal touch drag still stops the drift', () => {
  const body = listenerBody('touchmove');
  assert.ok(/\bstop\(\)/.test(body));
  assert.ok(/Math\.abs/.test(body), 'compared against the vertical movement, not any touch');
});

ok('a tap is never treated as a drag', () => {
  // touchstart only records where the finger landed. If it stopped the row,
  // tapping a card on a phone would break the same way clicking one did.
  const body = listenerBody('touchstart');
  assert.ok(!/\bstop\(\)/.test(body), 'touchstart must only record the touch:\n' + body);
});

console.log('\nthe rows are wired up as expected');

ok('all three rows drift, and only Coming Soon runs in reverse', () => {
  const calls = src.match(/autoDrift\('[^']+',\s*\d+(?:,\s*true)?\)/g) || [];
  assert.strictEqual(calls.length, 3, 'three rows: ' + JSON.stringify(calls));
  const reversed = calls.filter(c => /,\s*true\)/.test(c));
  assert.strictEqual(reversed.length, 1, 'exactly one reversed row: ' + JSON.stringify(reversed));
  assert.ok(/upcomingSlider/.test(reversed[0]), 'and it is Coming Soon: ' + reversed[0]);
});

console.log('\n' + passed + ' assertions passed\n');
