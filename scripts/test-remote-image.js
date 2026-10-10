// Run: node scripts/test-remote-image.js
//
// Saving a PlayStation image into the uploads folder (lib/remote-image.js).
// fetch is a stub serving a PNG made here; files go to a temp folder that is
// removed at the end. Nothing reaches PlayStation.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { saveRemoteImage, MAX_BYTES } = require('../lib/remote-image');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-image-'));
function cleanup() { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const URL_OK = 'https://image.api.playstation.com/vulcan/ap/rnd/cover.png';
const respond = (buf, headers) => async () => ({
  ok: true, status: 200,
  headers: { get: k => (headers || {})[k.toLowerCase()] || null },
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)
});

async function main() {
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#f0a500' } }).png().toBuffer();

  console.log('\nsaveRemoteImage');
  await okAsync('a PlayStation PNG becomes a WebP of at most 900px in the uploads folder', async () => {
    const seen = [];
    const out = await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: async (u, init) => { seen.push(u); return respond(png)(u, init); } });
    assert.ok(/^\/uploads\/psn-\d+-[0-9a-f]{8}\.webp$/.test(out), out);
    const meta = await sharp(path.join(DIR, path.basename(out))).metadata();
    assert.deepStrictEqual([meta.format, meta.width, meta.height], ['webp', 900, 900]);
    assert.deepStrictEqual(seen, [URL_OK]);
  });
  await okAsync('two saves never share a file name', async () => {
    const a = await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: respond(png) });
    const b = await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: respond(png) });
    assert.ok(a && b && a !== b);
  });
  await okAsync('any other host is refused without fetching', async () => {
    let called = false;
    const spy = async () => { called = true; return respond(png)(); };
    for (const u of ['https://evil.example/x.png', 'http://image.api.playstation.com/x.png', 'https://image.api.playstation.com.evil.example/x.png', '', null]) {
      assert.strictEqual(await saveRemoteImage(u, { uploadsDir: DIR, fetchImpl: spy }), '');
    }
    assert.strictEqual(called, false);
  });
  await okAsync('too big, failed, not an image, thrown or timed out → empty, nothing saved', async () => {
    const before = fs.readdirSync(DIR).length;
    const big = { uploadsDir: DIR, fetchImpl: respond(png, { 'content-length': String(MAX_BYTES + 1) }) };
    assert.strictEqual(await saveRemoteImage(URL_OK, big), '');
    assert.strictEqual(await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: async () => ({ ok: false, status: 404 }) }), '');
    assert.strictEqual(await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: respond(Buffer.from('<html>blocked</html>')) }), '');
    assert.strictEqual(await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: async () => { throw new Error('ECONNRESET'); } }), '');
    const hang = (u, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    });
    assert.strictEqual(await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: hang, timeoutMs: 30 }), '');
    assert.strictEqual(await saveRemoteImage(URL_OK, { fetchImpl: respond(png) }), '', 'no uploads folder');
    assert.strictEqual(fs.readdirSync(DIR).length, before);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
