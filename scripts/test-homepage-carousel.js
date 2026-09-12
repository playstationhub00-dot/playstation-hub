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

console.log('\nsix cards still have to loop');

ok('a row that fits the screen is no longer given up on', () => {
  // This used to return early when the content was no wider than the row.
  // With ten cards it never fired; at six on a wide monitor it fires every
  // time, and the loop would silently never start.
  const drift = autoDriftSource();
  assert.ok(!/scrollWidth\s*<=\s*slider\.clientWidth/.test(drift),
    'autoDrift must not bail out just because the row fits');
});

ok('it clones as many copies as the row needs, not always one', () => {
  const drift = autoDriftSource();
  assert.ok(/var copies\s*=/.test(drift), 'the copy count is computed');
  assert.ok(/clientWidth/.test(drift.match(/var copies\s*=[^;]+;/)[0]),
    'and it is computed from the visible width: ' + drift.match(/var copies\s*=[^;]+;/)[0]);
});

ok('one set is measured off the cards, not off scrollWidth', () => {
  // scrollWidth reports the CONTAINER width when the content is narrower than
  // it, which overstates one set, undercounts the copies, and leaves the row
  // fitting and motionless.
  const drift = autoDriftSource();
  const m = drift.match(/var copyWidth\s*=\s*([^;]+);/);
  assert.ok(m, 'copyWidth is still derived');
  assert.ok(!/scrollWidth/.test(m[1]),
    'copyWidth must not come from scrollWidth: ' + m[1]);
  assert.ok(/getBoundingClientRect/.test(drift), 'measured from the cards themselves');
});

ok('the wrap distance follows the copy count', () => {
  const drift = autoDriftSource();
  assert.ok(!/scrollWidth\s*\/\s*2/.test(drift),
    'a hardcoded half only holds when there are exactly two copies');
  assert.ok(/function period\(\)/.test(drift), 'the wrap distance is derived from copies');
});

console.log('\nthe homepage rows are trimmed to six');

ok('Coming Soon renders six', () => {
  assert.ok(/upcoming-section[\s\S]{0,120}upcoming:\s*upcoming\.slice\(0,\s*6\)/.test(src),
    'the Coming Soon include still slices to 6');
});

ok('New Releases renders six', () => {
  assert.ok(/newReleases\.slice\(0,\s*6\)\.forEach/.test(src),
    'the New Releases row still slices to 6');
});

ok('but the hero still draws from the whole list', () => {
  // heroGames takes six that HAVE cover art. Capping the shared list would
  // leave the hero short whenever one of the top six has no artwork.
  const hero = src.match(/const heroGames\s*=\s*heroSource[^;]+;/);
  assert.ok(hero, 'heroGames is still built from heroSource');
  assert.ok(/const heroSource\s*=\s*\(newReleases[^;]+;/.test(src),
    'and heroSource is the uncapped newReleases');
});

console.log('\n' + passed + ' assertions passed\n');
