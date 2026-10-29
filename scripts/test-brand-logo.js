// Run: node scripts/test-brand-logo.js
//
// The transparent wordmark replaces the old black-plate logo without taking
// away the admin upload. Legacy paths render the built-in files; once
// logo_builtin_at is stamped, logo-custom.png is an upload and stays.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const os = require('os');
const brand = require('../lib/brand-logo');
const seo = require('../lib/seo');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const partial = fs.readFileSync(path.join(ROOT, 'views/partials/brand-logo.ejs'), 'utf8');

function render(settings, extra) {
  const locals = Object.assign({ settings: settings || {} }, extra || {});
  return ejs.render(partial, locals, { filename: path.join(ROOT, 'views/partials/brand-logo.ejs') });
}

function attr(html, name) {
  const m = html.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : '';
}

console.log('\nresolve');

ok('a missing path and the old svg/png/logo-custom paths use the light wordmark', () => {
  ['', '/logo.svg', '/logo.png', '/uploads/logo-custom.png', '/uploads/logo-custom.webp'].forEach(p => {
    const got = brand.resolve({ logo_path: p }, 'light');
    assert.strictEqual(got.src, '/logo-hub-light.png', p);
    assert.ok(got.srcset.includes('/logo-hub-light-4x.png 4x'), p);
    assert.strictEqual(got.width, 409);
    assert.strictEqual(got.height, 111);
    assert.strictEqual(got.custom, false);
  });
  assert.strictEqual(brand.resolve({}, 'light').src, '/logo-hub-light.png');
});

ok('the dark variant is the #111 file, not the light one', () => {
  const got = brand.resolve({ logo_path: '/logo.svg' }, 'dark');
  assert.strictEqual(got.src, '/logo-hub-dark.png');
  assert.ok(got.srcset.includes('/logo-hub-dark-4x.png 4x'));
});

ok('after the latch, logo-custom.png is the admin upload', () => {
  const settings = { logo_path: '/uploads/logo-custom.png', logo_builtin_at: '2026-10-29T00:00:00.000Z' };
  const got = brand.resolve(settings, 'light');
  assert.strictEqual(got.src, '/uploads/logo-custom.png');
  assert.strictEqual(got.srcset, '');
  assert.strictEqual(got.custom, true);
  assert.strictEqual(brand.resolve(settings, 'dark').src, '/uploads/logo-custom.png');
});

ok('any other upload path is left as the admin saved it', () => {
  const got = brand.resolve({ logo_path: '/uploads/1710000000000.png', logo_builtin_at: 'x' }, 'dark');
  assert.strictEqual(got.src, '/uploads/1710000000000.png');
  assert.strictEqual(got.custom, true);
});

ok('the built-in path stays the built-in file even after the latch', () => {
  const got = brand.resolve({ logo_path: '/logo-hub-light.png', logo_builtin_at: 'x' }, 'light');
  assert.strictEqual(got.src, '/logo-hub-light.png');
  assert.strictEqual(got.custom, false);
});

console.log('\nmigration');

function tempDb(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-logo-'));
  const db = low(new FileSync(path.join(dir, 'games.json')));
  db.defaults({ site_settings: settings }).write();
  return db;
}

ok('a stored logo-custom.png is rewritten once and then left for an upload', () => {
  const db = tempDb({ title: 'PlayStation Hub', logo_path: '/uploads/logo-custom.png' });
  assert.strictEqual(brand.applyMigration(db), true);
  assert.strictEqual(db.get('site_settings.logo_path').value(), '/logo-hub-light.png');
  assert.ok(db.get('site_settings.logo_builtin_at').value());
  db.set('site_settings.logo_path', '/uploads/logo-custom.png').write();
  assert.strictEqual(brand.applyMigration(db), false);
  assert.strictEqual(db.get('site_settings.logo_path').value(), '/uploads/logo-custom.png');
});

ok('a custom path that is not the old fixed name is not replaced', () => {
  const db = tempDb({ logo_path: '/uploads/my-logo.png' });
  assert.strictEqual(brand.applyMigration(db), true);
  assert.strictEqual(db.get('site_settings.logo_path').value(), '/uploads/my-logo.png');
  assert.ok(db.get('site_settings.logo_builtin_at').value());
});

console.log('\npartial matches the helper');

ok('the header partial emits the same src, srcset and box as resolve()', () => {
  const cases = [
    [{ logo_path: '/uploads/logo-custom.png', title: 'PlayStation Hub' }, 'light'],
    [{ logo_path: '/logo.svg', title: 'PlayStation Hub' }, 'dark'],
    [{ logo_path: '/uploads/logo-custom.png', logo_builtin_at: 't', title: 'PlayStation Hub' }, 'light'],
    [{ logo_path: '/logo-hub-light.png', title: 'PlayStation Hub' }, 'light']
  ];
  cases.forEach(([settings, variant]) => {
    const html = render(settings, { logoVariant: variant });
    const got = brand.resolve(settings, variant);
    assert.strictEqual(attr(html, 'src'), got.src);
    assert.strictEqual(attr(html, 'srcset'), got.srcset);
    assert.strictEqual(attr(html, 'width'), String(got.width));
    assert.strictEqual(attr(html, 'height'), String(got.height));
    if (got.custom) assert.ok(!html.includes('brand-logo'));
    else assert.ok(html.includes('class="brand-logo'));
  });
});

ok('a poster upload keeps the screen blend; the stock wordmark does not', () => {
  const stock = render({ logo_path: '/logo.svg' }, { logoClass: 'poster-logo', logoAlt: 'logo' });
  assert.ok(stock.includes('poster-logo'));
  assert.ok(!stock.includes('poster-logo-custom'));
  const custom = render(
    { logo_path: '/uploads/logo-custom.png', logo_builtin_at: 't' },
    { logoClass: 'poster-logo', logoAlt: 'logo' }
  );
  assert.ok(custom.includes('poster-logo-custom'));
});

console.log('\nsocial image stays on logo.svg');

function renderHead(settings) {
  const file = path.join(ROOT, 'views/partials/head.ejs');
  return ejs.render(fs.readFileSync(file, 'utf8'), {
    settings,
    noindex: true,
    title: 'T',
    seo
  }, { filename: file });
}

ok('the built-in wordmark is not the og:image; a later upload can be', () => {
  const stock = renderHead({ title: 'PlayStation Hub', favicon_path: '/favicon.svg', logo_path: '/logo-hub-light.png' });
  assert.ok(stock.includes('property="og:image" content="https://www.playstation-hub.com/logo.svg"'));
  const legacy = renderHead({ title: 'PlayStation Hub', favicon_path: '/favicon.svg', logo_path: '/uploads/logo-custom.png' });
  assert.ok(legacy.includes('property="og:image" content="https://www.playstation-hub.com/logo.svg"'));
  const custom = renderHead({
    title: 'PlayStation Hub',
    favicon_path: '/favicon.svg',
    logo_path: '/uploads/logo-custom.png',
    logo_builtin_at: '2026-10-29T00:00:00.000Z'
  });
  assert.ok(custom.includes('property="og:image" content="https://www.playstation-hub.com/uploads/logo-custom.png"'));
  assert.strictEqual(brand.socialImage({ logo_path: '/logo-hub-light.png' }), '/logo.svg');
});

ok('the favicon and the svg file are untouched', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'public/favicon.svg')));
  assert.ok(fs.existsSync(path.join(ROOT, 'public/logo.svg')));
  const head = fs.readFileSync(path.join(ROOT, 'views/partials/head.ejs'), 'utf8');
  assert.ok(head.includes('<link rel="icon" href="<%= fav %>"'));
  assert.ok(head.includes("favicon_path) || '/favicon.svg'"));
});

console.log('\nfiles');

ok('the four pngs are the approved sizes', () => {
  function size(rel) {
    const data = fs.readFileSync(path.join(ROOT, rel));
    assert.strictEqual(data.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
    return { w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
  }
  assert.deepStrictEqual(size('public/logo-hub-light.png'), { w: 409, h: 111 });
  assert.deepStrictEqual(size('public/logo-hub-light-4x.png'), { w: 1636, h: 444 });
  assert.deepStrictEqual(size('public/logo-hub-dark.png'), { w: 409, h: 111 });
  assert.deepStrictEqual(size('public/logo-hub-dark-4x.png'), { w: 1636, h: 444 });
});

console.log('\n' + passed + ' assertions passed\n');
