// Run: node scripts/test-js-extraction-psplus-rent.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const viewSrc = fs.readFileSync(path.join(REPO_ROOT, 'views', 'psplus-rent.ejs'), 'utf8');
const jsPath = path.join(REPO_ROOT, 'public', 'js', 'psplus-rent.js');

console.log('\npsplus-rent.ejs — inline logic extracted to public/js/psplus-rent.js');

ok('public/js/psplus-rent.js exists', () => {
  assert.ok(fs.existsSync(jsPath), 'public/js/psplus-rent.js was not created');
});

ok('the extracted file has no leftover EJS tags', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(!js.includes('<%'), 'an EJS tag was left in the extracted file');
});

ok('the extracted file still defines onTypeChange and promoPctFor', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(js.includes('function onTypeChange'), 'onTypeChange not found in the extracted file');
  assert.ok(js.includes('function promoPctFor'), 'promoPctFor not found in the extracted file');
});

ok('PRICES, PROMO, AVAIL are still hoisted inline as globals', () => {
  for (const name of ['PRICES', 'PROMO', 'AVAIL']) {
    assert.ok(new RegExp('const ' + name + '\\s*=').test(viewSrc), 'expected `const ' + name + ' =` still declared inline');
  }
});

ok('the pre-existing RENTAL_DURATIONS line is untouched', () => {
  assert.ok(/const RENTAL_DURATIONS\s*=/.test(viewSrc), 'RENTAL_DURATIONS was removed — it was out of scope for this task');
});

ok('the view loads the extracted file via a versioned <script src> at the right position', () => {
  assert.ok(
    /<script src="\/js\/psplus-rent\.js\?v=<%=\s*assetV\s*%>"><\/script>/.test(viewSrc),
    'psplus-rent.ejs does not request /js/psplus-rent.js with ?v=<%= assetV %>'
  );
});

ok('the view no longer carries the big inline block', () => {
  assert.ok(!/function onTypeChange/.test(viewSrc), 'onTypeChange is still inline in the view');
});

console.log('\n' + passed + ' assertions passed\n');
