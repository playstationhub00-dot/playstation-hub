// Run: node scripts/test-upload-filters.js
//
// The bug this exists for: a rejected picture used to fail via multer's own
// `cb(null, false)` convention — skip the file, no error, nothing the route
// handler or the page could show. The edit form then saved normally and
// reloaded showing the old picture, with no explanation. imageFileFilter must
// reject with a real, tagged Error so server.js's global handler can turn it
// into an actual message.
const assert = require('assert');
const { imageFileFilter } = require('../lib/upload-filters');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

function file(mimetype) { return { mimetype, originalname: 'x' }; }

console.log('\nimageFileFilter() — what a picture upload is allowed to be');

['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].forEach(mt => {
  ok('accepts ' + mt, () => {
    let result;
    imageFileFilter(null, file(mt), (err, accept) => { result = { err, accept }; });
    assert.strictEqual(result.err, null, mt + ' should not error');
    assert.strictEqual(result.accept, true);
  });
});

ok('rejects an unsupported type (e.g. an iPhone HEIC photo) with a real Error, not a silent drop', () => {
  let result;
  imageFileFilter(null, file('image/heic'), (err, accept) => { result = { err, accept }; });
  assert.ok(result.err instanceof Error, 'must be a real Error the caller can propagate');
  assert.strictEqual(result.err.code, 'BAD_FILE_TYPE',
    'server.js\'s error handler keys off this exact code to show the right message');
  assert.strictEqual(result.accept, undefined, 'no second argument on the error path');
});

ok('rejects a non-image file (e.g. a PDF) the same way', () => {
  let result;
  imageFileFilter(null, file('application/pdf'), (err, accept) => { result = { err, accept }; });
  assert.ok(result.err instanceof Error);
  assert.strictEqual(result.err.code, 'BAD_FILE_TYPE');
});

console.log('\n' + passed + ' assertions passed\n');
