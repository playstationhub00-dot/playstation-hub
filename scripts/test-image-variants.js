// Run: node scripts/test-image-variants.js
//
// The url helpers are pure. The route and text compression are checked
// against a throwaway server (temp DATA_DIR, no Mongo). Nothing here writes
// into the project uploads folder.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const sharp = require('sharp');
const v = require('../lib/image-variants');

const PORT = 4721;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'img-variants-'));
const uploadsDir = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function get(urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: urlPath, headers: headers || {}, timeout: 15000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout ' + urlPath)); });
  });
}

async function main() {
  console.log('\nurl helpers');
  await ok('a hosted cover is 480px on a 1x screen and 720px on a 2x screen', async () => {
    const attrs = v.cardAttrs('/uploads/1791607091002.webp');
    assert.ok(attrs.includes('src="/uploads/w/480/1791607091002.webp"'));
    assert.ok(attrs.includes('srcset="/uploads/w/480/1791607091002.webp 480w, /uploads/w/720/1791607091002.webp 720w"'));
    assert.ok(attrs.includes('sizes="280px"'));
    assert.strictEqual(v.cardSrc('/uploads/1791607091002.webp'), '/uploads/w/720/1791607091002.webp');
  });
  await ok('the top-rented thumbnail is the 160px copy', async () => {
    assert.strictEqual(v.thumbSrc('/uploads/g1.png'), '/uploads/w/160/g1.png');
    assert.strictEqual(v.thumbAttrs('/uploads/g1.png'), 'src="/uploads/w/160/g1.png"');
  });
  await ok('branding files and external urls are not rewritten', async () => {
    assert.strictEqual(v.cardSrc('/uploads/logo-custom.png'), '/uploads/logo-custom.png');
    assert.strictEqual(v.thumbSrc('https://image.api.playstation.com/x.png?w=120'), 'https://image.api.playstation.com/x.png?w=120');
    assert.strictEqual(v.cardAttrs('https://example.com/a.png'), 'src="https://example.com/a.png"');
  });
  await ok('a PlayStation thumbnail gets a width, and an unsafe filename is escaped unchanged', async () => {
    assert.ok(v.thumbAttrs('https://image.api.playstation.com/a.jpg').includes('src="https://image.api.playstation.com/a.jpg?w=160"'));
    assert.strictEqual(v.cardAttrs('/uploads/odd".png'), 'src="/uploads/odd&quot;.png"');
  });

  const big = path.join(uploadsDir, 'big-cover.png');
  const small = path.join(uploadsDir, 'small-icon.webp');
  await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#c45500' } }).png().toFile(big);
  await sharp({ create: { width: 80, height: 80, channels: 3, background: '#222' } }).webp().toFile(small);

  process.env.PORT = String(PORT);
  process.env.DATA_DIR = DATA_DIR;
  process.env.MONGODB_URI = '';
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
    try { await get('/manifest.json'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\n/uploads/w');
  await ok('a 1200px cover is served as a 480px WebP and cached for a year', async () => {
    const res = await get('/uploads/w/480/big-cover.png');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'image/webp');
    assert.strictEqual(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    const meta = await sharp(res.body).metadata();
    assert.strictEqual(meta.width, 480);
    assert.ok(res.body.length < fs.statSync(big).size);
  });
  await ok('a 720px copy is the retina card and is still smaller than the source', async () => {
    const res = await get('/uploads/w/720/big-cover.png');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'image/webp');
    const meta = await sharp(res.body).metadata();
    assert.strictEqual(meta.width, 720);
    assert.ok(res.body.length < fs.statSync(big).size);
  });
  await ok('the second request reuses the file on disk', async () => {
    const again = await get('/uploads/w/480/big-cover.png');
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.headers['content-type'], 'image/webp');
  });
  await ok('an image already smaller than the requested width is not enlarged', async () => {
    const res = await get('/uploads/w/480/small-icon.webp');
    assert.strictEqual(res.status, 200);
    const meta = await sharp(res.body).metadata();
    assert.strictEqual(meta.width, 80);
  });
  await ok('an unknown width or a path escape is a 404', async () => {
    assert.strictEqual((await get('/uploads/w/999/big-cover.png')).status, 404);
    assert.strictEqual((await get('/uploads/w/480/..%2F..%2Fpackage.json')).status, 404);
    assert.strictEqual((await get('/uploads/w/480/missing.png')).status, 404);
  });

  console.log('\ntext compression');
  await ok('a stylesheet is brotli-encoded when the client accepts it, and readable after', async () => {
    const plain = await get('/css/style.css');
    const br = await get('/css/style.css', { 'Accept-Encoding': 'br' });
    assert.ok(!plain.headers['content-encoding']);
    assert.strictEqual(br.headers['content-encoding'], 'br');
    assert.ok(/accept-encoding/i.test(br.headers.vary || ''));
    const decoded = zlib.brotliDecompressSync(br.body);
    assert.ok(decoded.equals(plain.body));
    assert.ok(br.body.length < plain.body.length);
  });
  await ok('an image is not compressed', async () => {
    const res = await get('/uploads/w/160/big-cover.png', { 'Accept-Encoding': 'gzip, br' });
    assert.strictEqual(res.status, 200);
    assert.ok(!res.headers['content-encoding']);
    assert.strictEqual(res.headers['content-type'], 'image/webp');
  });

  console.log('\n' + passed + ' assertions passed\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
