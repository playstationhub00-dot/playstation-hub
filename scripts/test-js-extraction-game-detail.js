// Run: node scripts/test-js-extraction-game-detail.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const viewSrc = fs.readFileSync(path.join(REPO_ROOT, 'views', 'game-detail.ejs'), 'utf8');
const jsPath = path.join(REPO_ROOT, 'public', 'js', 'game-detail.js');

console.log('\ngame-detail.ejs — inline logic extracted to public/js/game-detail.js');

ok('public/js/game-detail.js exists', () => {
  assert.ok(fs.existsSync(jsPath), 'public/js/game-detail.js was not created');
});

ok('the extracted file has no leftover EJS tags', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(!js.includes('<%'), 'an EJS tag was left in the extracted file — it will render as literal text, not run');
});

ok('the extracted file still defines the functions the page depends on', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  for (const fn of ['computeRentTotal', 'promoPctFor', 'updateReserveLinks', 'gdGo']) {
    assert.ok(js.includes(fn), 'expected function `' + fn + '` not found in the extracted file');
  }
});

ok('the view loads it via a versioned <script src> in the original position', () => {
  assert.ok(
    /<script src="\/js\/game-detail\.js\?v=<%=\s*assetV\s*%>"><\/script>/.test(viewSrc),
    'game-detail.ejs does not request /js/game-detail.js with ?v=<%= assetV %>'
  );
});

ok('the view no longer carries the big inline block', () => {
  assert.ok(!/function updateReserveLinks/.test(viewSrc), 'updateReserveLinks is still inline in the view — extraction did not remove it');
});

ok('the hoisted data block still declares every value the moved code reads as a global', () => {
  for (const name of ['PRICES', 'BUY_PRICES', 'PROMO', 'AVAIL', 'ALL_UNAVAIL', 'gameTitle', 'gdSlideCount']) {
    assert.ok(
      new RegExp('const ' + name + '\\s*=').test(viewSrc),
      'expected `const ' + name + ' =` still declared inline in game-detail.ejs'
    );
  }
});

ok('gameTitle is no longer declared a second time inside updateReserveLinks (would shadow the hoisted global)', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  const fnMatch = js.match(/function updateReserveLinks\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, 'could not locate updateReserveLinks in the extracted file to check its body');
  assert.ok(!/const gameTitle/.test(fnMatch[1]), 'updateReserveLinks still has its own `const gameTitle` — this shadows the hoisted global and silently keeps the OLD per-call recomputation instead of the hoisted one-time value');
});

console.log('\n' + passed + ' assertions passed\n');
