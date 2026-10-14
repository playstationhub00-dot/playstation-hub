// Run: node scripts/test-text-compress.js
//
// A logged-in admin response used to never finish. express-session flushes
// the uncompressed Content-Length, then splits the body around the last
// byte. textCompress tried to gzip after that and threw once the headers
// were already sent, so the browser spun until the connection died.
// Anonymous pages still have to come back gzipped. Neither case may take
// longer than a couple of seconds.
const assert = require('assert');
const http = require('http');
const zlib = require('zlib');
const express = require('express');
const session = require('express-session');
const { textCompress } = require('../lib/text-compress');

let passed = 0;
async function ok(desc, fn) {
  await fn();
  passed++;
  console.log('  ok - ' + desc);
}

const HTML = '<!doctype html><title>Admin</title>' + '<p>ledger row</p>'.repeat(800);

function decode(res, body) {
  const enc = String(res.headers['content-encoding'] || '');
  if (enc === 'gzip') return zlib.gunzipSync(body).toString('utf8');
  if (enc === 'br') return zlib.brotliDecompressSync(body).toString('utf8');
  return body.toString('utf8');
}

function start() {
  const app = express();
  // Same order as server.js: compression wraps the response first, then
  // the session store wraps it again. That order is what exposed the hang.
  app.use(textCompress());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false
  }));
  app.post('/login', (req, res) => {
    req.session.isAdmin = true;
    res.redirect('/admin');
  });
  app.get('/admin', (req, res) => {
    res.type('html').send(HTML);
  });
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, method, path, { headers = {}, body = null } = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: Object.assign({ 'Accept-Encoding': 'gzip', 'Content-Type': 'application/x-www-form-urlencoded' }, headers),
      timeout: 2000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
        ms: Date.now() - started
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timed out after 2s — response never finished')); });
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  const server = await start();
  try {
    await ok('an anonymous page still comes back gzipped', async () => {
      const res = await request(server, 'GET', '/admin');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-encoding'], 'gzip');
      assert.strictEqual(decode(res, res.body), HTML);
      assert.ok(res.ms < 2000, 'took ' + res.ms + 'ms');
    });

    await ok('logging in finishes, it does not sit on the redirect', async () => {
      const res = await request(server, 'POST', '/login', { body: 'password=x' });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, '/admin');
      assert.ok(res.headers['set-cookie'], 'session cookie');
      assert.ok(res.ms < 2000, 'took ' + res.ms + 'ms');
    });

    const login = await request(server, 'POST', '/login', { body: 'password=x' });
    const cookie = login.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');

    await ok('a logged-in page finishes and is the full HTML', async () => {
      const res = await request(server, 'GET', '/admin', { headers: { Cookie: cookie } });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(decode(res, res.body), HTML);
      assert.ok(res.ms < 2000, 'took ' + res.ms + 'ms');
      // The session wrapper has already promised the uncompressed length, so
      // this response is sent as-is. What matters is that it arrives whole.
      assert.ok(!res.headers['content-encoding'], 'logged-in body stays the length the session already sent');
    });

    console.log('\n' + passed + ' assertions passed\n');
  } finally {
    server.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
