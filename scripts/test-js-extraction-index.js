// Run: node scripts/test-js-extraction-index.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const viewSrc = fs.readFileSync(path.join(REPO_ROOT, 'views', 'index.ejs'), 'utf8');

console.log('\nindex.ejs — 4 inline blocks extracted to public/js/index-1..4.js');

for (const n of [1, 2, 3, 4]) {
  ok('public/js/index-' + n + '.js exists', () => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'public', 'js', 'index-' + n + '.js')), 'missing index-' + n + '.js');
  });
  ok('index-' + n + '.js has no leftover EJS tags', () => {
    const js = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'index-' + n + '.js'), 'utf8');
    assert.ok(!js.includes('<%'), 'an EJS tag was left in index-' + n + '.js');
  });
  ok('index.ejs requests index-' + n + '.js with the version query, in document order', () => {
    assert.ok(
      new RegExp('<script src="\\/js\\/index-' + n + '\\.js\\?v=<%=\\s*assetV\\s*%>"><\\/script>').test(viewSrc),
      'index.ejs does not request /js/index-' + n + '.js with ?v=<%= assetV %>'
    );
  });
}

ok('the 4 script tags still appear in their original relative order', () => {
  const positions = [1, 2, 3, 4].map(n => viewSrc.indexOf('/js/index-' + n + '.js'));
  assert.ok(positions.every(p => p !== -1), 'not all 4 script references found');
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1], 'index-' + (i + 1) + '.js appears before index-' + i + '.js — order changed');
  }
});

ok('index-4.js does not redeclare the hoisted promo globals', () => {
  const js = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'index-4.js'), 'utf8');
  assert.ok(!/const _rentPromo\s*=/.test(js), 'index-4.js should NOT redeclare _rentPromo — it stays hoisted in the view');
  assert.ok(!/const _buyPromo\s*=/.test(js), 'index-4.js should NOT redeclare _buyPromo — it stays hoisted in the view');
});

ok('the hoisted _rentPromo/_buyPromo data block is still present before index-4.js', () => {
  assert.ok(/const _rentPromo\s*=/.test(viewSrc), '_rentPromo is no longer declared inline in index.ejs');
  assert.ok(/const _buyPromo\s*=/.test(viewSrc), '_buyPromo is no longer declared inline in index.ejs');
});

console.log('\n' + passed + ' assertions passed\n');
