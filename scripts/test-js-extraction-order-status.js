// Run: node scripts/test-js-extraction-order-status.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const viewSrc = fs.readFileSync(path.join(REPO_ROOT, 'views', 'order-status.ejs'), 'utf8');

console.log('\norder-status.ejs — 3 inline blocks extracted to public/js/order-status-1..3.js');

for (const n of [1, 2, 3]) {
  ok('public/js/order-status-' + n + '.js exists', () => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'public', 'js', 'order-status-' + n + '.js')), 'missing order-status-' + n + '.js');
  });
  ok('order-status-' + n + '.js has no leftover EJS tags', () => {
    const js = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'order-status-' + n + '.js'), 'utf8');
    assert.ok(!js.includes('<%'), 'an EJS tag was left in order-status-' + n + '.js');
  });
  ok('order-status.ejs requests order-status-' + n + '.js with the version query', () => {
    assert.ok(
      new RegExp('<script src="\\/js\\/order-status-' + n + '\\.js\\?v=<%=\\s*assetV\\s*%>"><\\/script>').test(viewSrc),
      'order-status.ejs does not request /js/order-status-' + n + '.js with ?v=<%= assetV %>'
    );
  });
}

ok('the 3 script tags still appear in their original relative order', () => {
  const positions = [1, 2, 3].map(n => viewSrc.indexOf('/js/order-status-' + n + '.js'));
  assert.ok(positions.every(p => p !== -1), 'not all 3 script references found');
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1], 'order-status-' + (i + 1) + '.js appears before order-status-' + i + '.js — order changed');
  }
});

ok('the #ordPoll data element still sits between block 1 and block 2', () => {
  const idx1 = viewSrc.indexOf('/js/order-status-1.js');
  const idxPoll = viewSrc.indexOf('id="ordPoll"');
  const idx2 = viewSrc.indexOf('/js/order-status-2.js');
  assert.ok(idx1 !== -1 && idxPoll !== -1 && idx2 !== -1, 'could not find all three anchors');
  assert.ok(idx1 < idxPoll && idxPoll < idx2, '#ordPoll is no longer positioned between block 1 and block 2 — this element is read by data attribute, its position relative to the scripts must not change');
});

ok('block 1 hoists the paid-seen key instead of building it from a raw EJS interpolation inline', () => {
  assert.ok(/const ORD_PAID_SEEN_KEY\s*=\s*'ord_paid_seen_<%=\s*order\.ref\s*%>'/.test(viewSrc), 'ORD_PAID_SEEN_KEY is not declared as expected');
  const js1 = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'order-status-1.js'), 'utf8');
  assert.ok(/var key = ORD_PAID_SEEN_KEY;/.test(js1), 'order-status-1.js should reference the hoisted ORD_PAID_SEEN_KEY global, not rebuild the key itself');
});

console.log('\n' + passed + ' assertions passed\n');
