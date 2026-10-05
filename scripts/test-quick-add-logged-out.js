// Run: node scripts/test-quick-add-logged-out.js
//
// When the admin login has expired, Quick Add (and any other button that talks
// to the server in the background) must say so instead of "Something went
// wrong". Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI,
// in-memory sessions, a made-up admin password) for the server half, then runs
// Quick Add's own script against a stub page for the browser half.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');

const PORT = 4599;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-logged-out-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  games: [{ id: 1, title: 'Zzyzx Game', platform: 'PS5', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799, non_trophy_slots: 2, trophy_slots: 2 }]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method, headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers), timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}
const form = o => new URLSearchParams(o).toString();

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

// Quick Add's script from the rendered admin page, run against stub elements
// and a stub fetch. Returns the error box after qaSubmit() settles.
async function submitWith(script, fetchImpl) {
  const els = {};
  const el = id => (els[id] = els[id] || {
    id, hidden: true, disabled: false, textContent: '', innerHTML: '', value: '',
    classList: { add() {}, remove() {}, toggle() {} }, scrollIntoView() {}, focus() {}
  });
  const ctx = {
    console,
    window: {},
    document: { getElementById: el, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null },
    fetch: fetchImpl,
    FormData: function () {},
    URLSearchParams: function () { return { toString: () => '' }; },
    setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  el('qaSubmit').textContent = 'Create + get message';
  ctx.window.qaSubmit();
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  return { err: els.qaErr, btn: els.qaSubmit };
}
const reply = (status, contentType, body) => () => Promise.resolve({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => (k.toLowerCase() === 'content-type' ? contentType : null) },
  text: () => Promise.resolve(body),
  json: () => Promise.resolve(JSON.parse(body))
});

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\nserver: a background request after the login expired');
  await okAsync('gets a plain "logged out" answer, not the login page', async () => {
    const r = await call('POST', '/admin/quick-add', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' }, body: form({ customer_name: 'X' }) });
    assert.strictEqual(r.status, 401);
    assert.ok(/application\/json/.test(r.headers['content-type']));
    const body = JSON.parse(r.body);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.reason, 'logged_out');
    assert.ok(/logged out/i.test(body.message) && /nothing was saved/i.test(body.message));
  });
  await okAsync('a normal form post or page load still goes to the login page', async () => {
    const post = await call('POST', '/admin/customers/delete/1', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html,application/xhtml+xml' }, body: '' });
    assert.strictEqual(post.status, 302);
    assert.strictEqual(post.headers.location, '/admin/login');
    const page = await call('GET', '/admin', { headers: { Accept: '*/*' } });
    assert.strictEqual(page.status, 302);
    assert.strictEqual(page.headers.location, '/admin/login');
  });

  // The Quick Add script, from the real admin page.
  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const admin = await call('GET', '/admin', { headers: { Cookie: cookie } });
  assert.strictEqual(admin.status, 200);
  const blocks = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let mm;
  while ((mm = re.exec(admin.body))) blocks.push(mm[1]);
  const script = blocks.find(b => b.includes('window.qaSubmit'));
  assert.ok(script, 'Quick Add script found on the admin page');

  console.log('\nQuick Add form');
  await okAsync('logged out: says so, says nothing was saved, button usable again', async () => {
    const r = await submitWith(script, reply(401, 'application/json; charset=utf-8', JSON.stringify({ ok: false, reason: 'logged_out', message: 'You were logged out — log in again in a new tab, then press Create again. Nothing was saved.' })));
    assert.strictEqual(r.err.hidden, false);
    assert.ok(r.err.textContent.includes('You were logged out'));
    assert.strictEqual(r.btn.disabled, false);
    assert.strictEqual(r.btn.textContent, 'Create + get message');
  });
  await okAsync('an answer that is not JSON (an old login redirect, a proxy error page) explains what to do', async () => {
    const r = await submitWith(script, reply(200, 'text/html; charset=utf-8', '<!DOCTYPE html><html>Admin login</html>'));
    assert.strictEqual(r.err.hidden, false);
    assert.ok(!r.err.textContent.includes('Something went wrong'));
    assert.ok(/reload the page/i.test(r.err.textContent) && /orders/i.test(r.err.textContent), r.err.textContent);
  });
  await okAsync('no connection at all: says the site could not be reached', async () => {
    const r = await submitWith(script, () => Promise.reject(new TypeError('Failed to fetch')));
    assert.ok(/couldn.t reach the site/i.test(r.err.textContent), r.err.textContent);
    assert.strictEqual(r.btn.disabled, false);
  });
  await okAsync('a normal refusal still shows the server message', async () => {
    const r = await submitWith(script, reply(400, 'application/json', JSON.stringify({ ok: false, reason: 'bad_name', message: 'Enter the customer name.' })));
    assert.strictEqual(r.err.textContent, '⚠ Enter the customer name.');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
