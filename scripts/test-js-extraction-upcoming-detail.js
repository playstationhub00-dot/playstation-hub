// Run: node scripts/test-js-extraction-upcoming-detail.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const viewSrc = fs.readFileSync(path.join(REPO_ROOT, 'views', 'upcoming-detail.ejs'), 'utf8');
const jsPath = path.join(REPO_ROOT, 'public', 'js', 'upcoming-detail.js');

console.log('\nupcoming-detail.ejs — inline logic extracted to public/js/upcoming-detail.js');

ok('public/js/upcoming-detail.js exists', () => {
  assert.ok(fs.existsSync(jsPath), 'public/js/upcoming-detail.js was not created');
});

ok('the extracted file has no leftover EJS tags', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(!js.includes('<%'), 'an EJS tag was left in the extracted file');
});

ok('the extracted file still defines gpGo (gallery slider)', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(js.includes('function gpGo'), 'gpGo not found in the extracted file');
});

ok('the pre-existing data block (GAME_TITLE, NT_PRICES, etc.) is untouched', () => {
  assert.ok(/const GAME_TITLE\s*=/.test(viewSrc), 'the pre-existing GAME_TITLE data block was removed — it was out of scope for this task');
  assert.ok(/const RENTAL_DURATIONS\s*=/.test(viewSrc), 'the pre-existing RENTAL_DURATIONS line was removed — it was out of scope for this task');
});

ok('ALL_FULL and gpSlideCount are still hoisted inline as globals', () => {
  assert.ok(/const ALL_FULL\s*=/.test(viewSrc), 'ALL_FULL is no longer declared inline');
  assert.ok(/const gpSlideCount\s*=/.test(viewSrc), 'gpSlideCount is no longer declared inline');
});

ok('the view loads the extracted file via a versioned <script src> at the right position', () => {
  assert.ok(
    /<script src="\/js\/upcoming-detail\.js\?v=<%=\s*assetV\s*%>"><\/script>/.test(viewSrc),
    'upcoming-detail.ejs does not request /js/upcoming-detail.js with ?v=<%= assetV %>'
  );
});

ok('the view no longer carries the big inline block', () => {
  assert.ok(!/function gpGo/.test(viewSrc), 'gpGo is still inline in the view');
});

console.log('\n' + passed + ' assertions passed\n');
