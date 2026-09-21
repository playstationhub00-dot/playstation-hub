// Run: node scripts/test-static-caching.js
//
// Behavioural test, not a source-text guard: spawns the real server on a
// throwaway port, makes real HTTP requests, and asserts the Cache-Control
// header Express actually sent. A source-text check could pass while the
// runtime behavior was wrong (e.g. a typo'd header name) — this can't.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4599;
const REPO_ROOT = path.join(__dirname, '..');

function get(pathAndQuery) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: pathAndQuery, timeout: 5000 }, (res) => {
      res.resume(); // discard body, we only need headers
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out: ' + pathAndQuery)); });
  });
}

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  // Throwaway fixtures inside the real uploads dir, so the real /uploads
  // static handler in server.js serves them. Named so they can't collide
  // with anything real, and removed in the finally block below.
  const uploadsDir = path.join(process.env.DATA_DIR || REPO_ROOT, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const timestampFile = path.join(uploadsDir, '9999999999999-castest.webp');
  const faviconFile = path.join(uploadsDir, 'favicon-custom.png');
  const logoFile = path.join(uploadsDir, 'logo-custom.png');
  const heroImgFile = path.join(uploadsDir, 'hero-bg-image.jpg');
  const heroVidFile = path.join(uploadsDir, 'hero-bg-video.mp4');
  const madeFiles = [timestampFile, faviconFile, logoFile, heroImgFile, heroVidFile];
  const preExisting = madeFiles.filter(fs.existsSync);
  for (const f of madeFiles) if (!fs.existsSync(f)) fs.writeFileSync(f, 'test fixture — safe to delete');

  process.env.PORT = String(PORT);
  const child = require('child_process').spawn(process.execPath, ['server.js'], {
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    // Wait for the server to actually accept connections rather than a fixed
    // sleep, which would be flaky on a slower machine.
    const deadline = Date.now() + 15000;
    let up = false;
    while (Date.now() < deadline) {
      try { await get('/manifest.json'); up = true; break; }
      catch { await new Promise(r => setTimeout(r, 200)); }
    }
    assert.ok(up, 'server did not come up within 15s — check stderr:\n' + (child.stderr.read() || ''));

    console.log('\npublic/ — cached only when the request carries the version query');

    await ok('a versioned stylesheet request is cached for a year, immutable', async () => {
      const res = await get('/css/style.css?v=123');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    });

    await ok('the same file with no version query gets only an hour', async () => {
      const res = await get('/css/style.css');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    await ok('an unrelated unversioned file (manifest.json) also gets an hour', async () => {
      const res = await get('/manifest.json');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    console.log('\n/uploads — cached for a year UNLESS the filename is one of the four branding names');

    await ok('a timestamp-named upload is cached for a year, immutable', async () => {
      const res = await get('/uploads/9999999999999-castest.webp');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    });

    await ok('favicon-custom.png (admin can overwrite this URL) gets only an hour', async () => {
      const res = await get('/uploads/favicon-custom.png');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    await ok('logo-custom.png (admin can overwrite this URL) gets only an hour', async () => {
      const res = await get('/uploads/logo-custom.png');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    await ok('hero-bg-image.jpg (admin can overwrite this URL) gets only an hour', async () => {
      const res = await get('/uploads/hero-bg-image.jpg');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    await ok('hero-bg-video.mp4 (admin can overwrite this URL) gets only an hour', async () => {
      const res = await get('/uploads/hero-bg-video.mp4');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=3600');
    });

    console.log('\npublic/js — now requested with a version query, same as style.css');

    await ok('admin-searchable-select.js is requested with ?v= in views/admin.ejs', async () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, 'views', 'admin.ejs'), 'utf8');
      assert.ok(
        /admin-searchable-select\.js\?v=<%=\s*assetV\s*%>/.test(src),
        'admin.ejs still requests the script at a bare, unversioned path'
      );
    });

    await ok('the versioned script URL is cached for a year, immutable', async () => {
      const res = await get('/js/admin-searchable-select.js?v=123');
      assert.strictEqual(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    });

    console.log('\n' + passed + ' assertions passed\n');
  } finally {
    child.kill();
    for (const f of madeFiles) {
      if (!preExisting.includes(f) && fs.existsSync(f)) fs.unlinkSync(f);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
