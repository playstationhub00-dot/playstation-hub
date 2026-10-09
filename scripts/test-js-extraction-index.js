// Run: node scripts/test-js-extraction-index.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const viewSrc = fs.readFileSync(path.join(REPO_ROOT, 'views', 'index.ejs'), 'utf8');

console.log('\nindex.ejs — the remaining extracted script, public/js/index-4.js');

ok('public/js/index-4.js exists with no leftover EJS tags', () => {
  const js = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'index-4.js'), 'utf8');
  assert.ok(!js.includes('<%'), 'an EJS tag was left in index-4.js');
});
ok('index.ejs requests index-4.js and then home.js, with the version query', () => {
  assert.ok(/<script src="\/js\/index-4\.js\?v=<%=\s*assetV\s*%>"><\/script>/.test(viewSrc));
  assert.ok(viewSrc.indexOf('/js/index-4.js') < viewSrc.indexOf('/js/home.js'));
});
ok('the old hero, PS Plus collapse and promo countdown scripts are gone with their sections', () => {
  [1, 2, 3].forEach(n => {
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, 'public', 'js', 'index-' + n + '.js')), 'index-' + n + '.js still exists');
    assert.ok(!viewSrc.includes('/js/index-' + n + '.js'), 'index.ejs still requests index-' + n + '.js');
  });
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
