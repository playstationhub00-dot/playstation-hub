// Run: node scripts/test-private-html-cache.js
//
// Public HTML must not be stored by a shared cache. Routes that already set
// Cache-Control (sitemap, search index, static files) keep their own header.
const assert = require('assert');
const { install, HEADER } = require('../lib/private-html-cache');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

function run(res, preset) {
  const app = { mw: null, use(fn) { this.mw = fn; } };
  install(app);
  if (preset) res.setHeader('Cache-Control', preset);
  let next = false;
  app.mw({}, res, () => { next = true; });
  return { next, result: res.render('how-it-works', { settings: {} }) };
}

function fakeRes() {
  const headers = {};
  return {
    headers,
    getHeader(name) { return headers[String(name).toLowerCase()]; },
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    render(view, data) { this.rendered = { view, data }; return 'html'; }
  };
}

check('a rendered HTML page is marked private and is not a shared-cache candidate', () => {
  const res = fakeRes();
  const out = run(res);
  assert.strictEqual(out.next, true);
  assert.strictEqual(res.getHeader('Cache-Control'), HEADER);
  assert.strictEqual(HEADER, 'private, no-cache');
  assert.ok(!/public|s-maxage/.test(HEADER));
  assert.strictEqual(out.result, 'html');
  assert.strictEqual(res.rendered.view, 'how-it-works');
});

check('an explicit Cache-Control on the response is left alone', () => {
  const res = fakeRes();
  run(res, 'public, max-age=300');
  assert.strictEqual(res.getHeader('Cache-Control'), 'public, max-age=300');
});

console.log('\n' + passed + ' assertions passed\n');
