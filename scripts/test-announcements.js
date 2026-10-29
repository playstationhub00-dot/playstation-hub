// Run: node scripts/test-announcements.js
//
// Scheduling, placement, priority, pin, the boot migration leaving saved text
// alone, an admin save, and the real homepage route rendering the bar, bell,
// and banner. Throwaway DATA_DIR, no Mongo.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const announcements = require('../lib/announcements');
const themes = require('../lib/themes');

const NOW = new Date('2026-10-29T04:00:00Z'); // 12:00 Asia/Manila

function entry(extra) {
  return Object.assign({
    enabled: true, title: '', text: 'Hello', place_bar: false, place_bell: false, place_banner: false,
    priority: 0, sort: 0, audience: 'all', device: 'all', bell_new_days: 0, bell_pin: false
  }, extra);
}

let passed = 0;
function ok(desc, fn) {
  fn();
  passed++;
  console.log('  ok - ' + desc);
}

console.log('\nscheduling');
ok('an entry is hidden before it starts and from the end instant onward', () => {
  const rows = [
    entry({ id: 1, text: 'Early', place_bar: true, starts_at: '2026-11-02T00:00' }),
    entry({ id: 2, text: 'Live', place_bar: true, starts_at: '2026-10-01T00:00', ends_at: '2026-11-01T00:00' }),
    entry({ id: 3, text: 'Ended', place_bar: true, ends_at: '2026-10-29T12:00' }),
    entry({ id: 4, text: 'Off', place_bar: true, enabled: false }),
    entry({ id: 5, text: 'Open', place_bar: true })
  ];
  const feed = announcements.present({ entries: rows, now: NOW, themePromo: { show: false, text: '', code: '' } });
  const texts = feed.bar.map(s => s.text);
  assert.deepStrictEqual(texts, ['Live', 'Open']);
  const atEnd = announcements.present({
    entries: [entry({ id: 2, text: 'Live', place_bar: true, ends_at: '2026-11-01T00:00' })],
    now: themes.parseManila('2026-11-01T00:00')
  });
  assert.strictEqual(atEnd.bar.length, 0);
  const beforeEnd = announcements.present({
    entries: [entry({ id: 2, text: 'Live', place_bar: true, ends_at: '2026-10-29T12:01' })],
    now: NOW
  });
  assert.strictEqual(beforeEnd.bar[0].text, 'Live');
});

console.log('\nplacement, priority, pin');
ok('bar, bell, and banner each keep only their own entries, up to 3 on the bar', () => {
  const rows = [
    entry({ id: 1, title: 'Low', text: 'l', place_bar: true, place_bell: true, priority: 1, sort: 2 }),
    entry({ id: 2, title: 'High', text: 'h', place_bar: true, priority: 9, sort: 5 }),
    entry({ id: 3, title: 'Mid', text: 'm', place_bar: true, priority: 5, sort: 1 }),
    entry({ id: 4, title: 'Fourth', text: 'f', place_bar: true, priority: 0, sort: 0 }),
    entry({ id: 5, title: 'Pinned note', text: 'top', place_bell: true, bell_pin: true, priority: 0, sort: 9 }),
    entry({ id: 6, title: 'GTA VI reservations are open', text: 'Grab your slot', place_banner: true, device: 'mobile' })
  ];
  const feed = announcements.present({ entries: rows, now: NOW });
  assert.deepStrictEqual(feed.bar.map(s => s.title), ['High', 'Mid', 'Low']);
  assert.ok(!feed.bar.some(s => s.title === 'Fourth'));
  assert.ok(!feed.bar.some(s => s.title.indexOf('GTA') === 0));
  assert.strictEqual(feed.bell[0].title, 'Pinned note');
  assert.ok(feed.bell.find(s => s.title === 'Low'));
  assert.ok(!feed.bell.some(s => s.title === 'High'));
  assert.strictEqual(feed.banner.length, 1);
  assert.strictEqual(feed.banner[0].device, 'mobile');
  assert.strictEqual(feed.banner[0].title, 'GTA VI reservations are open');
  assert.ok(!feed.bar.some(s => s.device === 'mobile'));
});

ok('a theme promo takes the first bar slot and is not a second strip', () => {
  const feed = announcements.present({
    entries: [entry({ id: 1, text: 'Swap all month', place_bar: true })],
    now: NOW,
    themePromo: { show: true, text: 'Use code MONTHLY10 for 10% off monthly rentals.', code: 'MONTHLY10' }
  });
  assert.strictEqual(feed.bar[0].kind, 'theme');
  assert.strictEqual(feed.bar[0].code, 'MONTHLY10');
  assert.strictEqual(feed.bar[1].text, 'Swap all month');
  assert.ok(!feed.bell.some(s => s.kind === 'theme'));
});

console.log('\nmigration');
ok('existing text is kept, a legacy bar is copied once, and a second boot does not write', () => {
  const custom = {
    migrations: [],
    announcements: [{
      id: 5, text: 'Michael wrote this', title: 'Keep', active: true,
      place_banner: true, button_label: 'Go', priority: 4
    }],
    nextAnnouncementId: 6,
    announcement: { text: 'SHOULD NOT DUPLICATE', active: true }
  };
  const out = announcements.apply(custom, NOW);
  assert.strictEqual(out.write, true);
  const row = out.announcements.find(a => a.id === 5);
  assert.strictEqual(row.text, 'Michael wrote this');
  assert.strictEqual(row.title, 'Keep');
  assert.strictEqual(row.place_banner, true);
  assert.strictEqual(row.button_label, 'Go');
  assert.strictEqual(row.priority, 4);
  assert.ok(!out.announcements.some(a => String(a.text).includes('SHOULD NOT DUPLICATE')));
  assert.strictEqual(out.announcements.filter(a => a.bind === 'promo-banner').length, 1);
  const edited = out.announcements.map(a => a.id === 5 ? Object.assign({}, a, { text: 'Edited later' }) : a);
  const again = announcements.apply({
    migrations: out.migrations,
    announcements: edited,
    nextAnnouncementId: out.nextAnnouncementId,
    announcement: { text: 'put the default back' }
  }, NOW);
  assert.strictEqual(again.write, false);
  assert.strictEqual(again.announcements.find(a => a.id === 5).text, 'Edited later');
});

ok('an empty list takes the legacy bar text, and a bound promo row is not duplicated', () => {
  const first = announcements.apply({
    migrations: [],
    announcements: [],
    announcement: { text: '  Unlimited swap of games!  ', active: false },
    nextAnnouncementId: 1
  }, NOW);
  const legacy = first.announcements.find(a => a.text === 'Unlimited swap of games!');
  assert.ok(legacy);
  assert.strictEqual(legacy.enabled, false);
  assert.strictEqual(legacy.place_bar, true);
  assert.strictEqual(legacy.place_banner, false);
  const again = announcements.apply({
    migrations: [],
    announcements: [{ id: 2, bind: 'promo-banner', text: '', title: '', button_label: 'See deals', enabled: true, place_bar: true }],
    nextAnnouncementId: 3
  }, NOW);
  const bound = again.announcements.filter(a => a.bind === 'promo-banner');
  assert.strictEqual(bound.length, 1);
  assert.strictEqual(bound[0].button_label, 'See deals');
});

console.log('\nadmin save');
ok('save stores placements, rejects a backwards schedule, and a new image replaces the old path', () => {
  const bad = announcements.save([], {
    title: 'Hello', text: 'World', enabled: 'on', place_bar: 'on',
    starts_at: '2026-10-29T00:00', ends_at: '2026-10-01T00:00'
  }, { nextId: 1, now: NOW });
  assert.strictEqual(bad.ok, false);
  const blank = announcements.save([], { enabled: 'on', place_bar: 'on' }, { nextId: 1, now: NOW });
  assert.strictEqual(blank.ok, false);
  const saved = announcements.save([], {
    title: 'Hello', text: 'World', enabled: 'on', place_banner: 'on', place_bell: 'on',
    priority: '8', bell_pin: 'on', bell_new_days: '3', button_label: 'Reserve', button_url: '/browse'
  }, { nextId: 4, images: { image: '/uploads/111.webp' }, now: NOW });
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.entries[0].place_bar, false);
  assert.strictEqual(saved.entries[0].place_banner, true);
  assert.strictEqual(saved.entries[0].bell_pin, true);
  assert.strictEqual(saved.entries[0].image, '/uploads/111.webp');
  assert.strictEqual(saved.entries[0].button_url, '/browse');
  const later = new Date(NOW.getTime() + 5000);
  const edited = announcements.save(saved.entries, {
    id: saved.id, title: 'Hello', text: 'World edited', enabled: 'on', place_banner: 'on', place_bell: 'on', bell_pin: 'on'
  }, { nextId: saved.nextId, images: { image: '/uploads/222.webp' }, now: later });
  assert.strictEqual(edited.entries[0].text, 'World edited');
  assert.strictEqual(edited.entries[0].image, '/uploads/222.webp');
  assert.notStrictEqual(edited.entries[0].version, saved.entries[0].version);
  const moved = announcements.move([
    entry({ id: 1, text: 'A', sort: 0 }),
    entry({ id: 2, text: 'B', sort: 1 })
  ], 2, 'up');
  assert.deepStrictEqual(moved.map(r => r.text), ['B', 'A']);
  assert.deepStrictEqual(announcements.remove(moved, 2).map(r => r.id), [1]);
});

ok('every theme button pair still clears WCAG AA, which is what the bar and banner use', () => {
  themes.CATALOG.forEach(preset => {
    const ratio = themes.contrast(preset.colors.btnFg, preset.colors.accent);
    assert.ok(ratio >= 4.5, preset.id + ' ' + ratio.toFixed(2));
  });
  const badge = themes.contrast('#ffffff', '#C41230');
  assert.ok(badge >= 4.5, 'NEW badge ' + badge.toFixed(2));
});

const PORT = 4817;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'announcements-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const prices = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  migrations: ['theme-presets-2026-10-29', 'announcements-2026-10-29'],
  nextAnnouncementId: 10,
  announcements: [
    { id: 1, enabled: true, title: 'Keep', text: 'Michael wrote this', place_bar: true, place_bell: true, place_banner: false, priority: 1, sort: 1, audience: 'all', device: 'all', bell_new_days: 0, updated_at: '2026-10-01T00:00', created_at: '2026-10-01T00:00' },
    { id: 2, enabled: true, title: 'Read this first', text: 'High priority', place_bar: true, place_bell: true, place_banner: false, priority: 9, sort: 2, audience: 'all', device: 'all', bell_new_days: 0, updated_at: '2026-10-20T00:00', created_at: '2026-10-20T00:00' },
    { id: 3, enabled: true, title: 'Pinned note', text: 'Stays on top', place_bar: false, place_bell: true, place_banner: false, bell_pin: true, priority: 0, sort: 3, audience: 'all', device: 'all', bell_new_days: 14, starts_at: '2026-10-28T00:00', created_at: '2026-10-28T00:00', updated_at: '2026-10-28T00:00' },
    { id: 4, enabled: true, title: 'Later note', text: 'After the pin', place_bar: false, place_bell: true, place_banner: false, priority: 2, sort: 4, audience: 'all', device: 'all', bell_new_days: 0, created_at: '2026-10-10T00:00', updated_at: '2026-10-10T00:00' },
    { id: 5, enabled: true, label: 'Now open', title: 'GTA VI reservations are open', text: 'Grab your slot early.', button_label: 'Reserve on Messenger', button_url: 'https://m.me/PlaystationHub00', place_banner: true, place_bar: false, place_bell: false, image: '/uploads/gta.webp', image_mobile: '/uploads/gta-mobile.webp', priority: 0, sort: 5, audience: 'all', device: 'all', created_at: '2026-10-29T00:00', updated_at: '2026-10-29T00:00' },
    { id: 6, enabled: true, title: 'Ended offer', text: 'This ended', place_bar: true, place_banner: true, ends_at: '2026-10-01T00:00', sort: 6, created_at: '2026-09-01T00:00', updated_at: '2026-09-01T00:00' },
    { id: 7, enabled: true, title: 'Not started', text: 'Wait', place_bar: true, starts_at: '2026-12-01T00:00', sort: 7, created_at: '2026-10-01T00:00', updated_at: '2026-10-01T00:00' },
    { id: 8, enabled: false, title: 'Hidden offer', text: 'Nope', place_bar: true, sort: 8, created_at: '2026-10-01T00:00', updated_at: '2026-10-01T00:00' },
    { id: 9, enabled: true, title: 'Phone only deal', text: 'Mobile', place_bar: true, device: 'mobile', priority: 0, sort: 9, audience: 'all', created_at: '2026-10-01T00:00', updated_at: '2026-10-01T00:00' }
  ],
  site_settings: {
    title: 'PlayStation Hub',
    themes: { base: 'classic', presets: { halloween: { start: '', end: '', line1: '', highlight: '', line2: '' }, christmas: { start: '', end: '', line1: '', highlight: '', line2: '' } } },
    promo: { enabled: false, discounts: { 7: 0, 30: 0 }, deposit: 100 },
    hero_text: { line1: 'Rent the Latest', highlight: 'PS5 & PS4', line2: 'Games', subtitle: '', title_size: 55, highlight_color: '#F0A500', subtitle_color: '#aaaaaa' },
    loyalty: { punch_enabled: false, rebook_enabled: false }
  },
  games: [Object.assign({
    id: 1, title: 'Phantom Blade Zero', platform: 'PS5', genre: 'Action',
    cover_image: '/uploads/phantom.png', created_at: '2026-10-01T00:00:00.000Z', release_date: '2026-10-20',
    non_trophy_slots: 1, trophy_slots: 1, renters: 0
  }, prices)]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'announcements-test';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {} }
function readDb() { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8')); }

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers),
      timeout: 20000
    }, res => {
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

async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

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
  assert.ok(up, 'server did not come up');

  await okAsync('boot does not overwrite a saved announcement', async () => {
    const state = readDb();
    assert.ok(state.announcements.some(a => a.text === 'Michael wrote this' && a.title === 'Keep'));
    assert.ok(!state.announcements.some(a => /unlimited swap/i.test(a.text || '') || /unlimited swap/i.test(a.title || '')));
    assert.strictEqual(state.announcements.filter(a => a.bind === 'promo-banner').length, 0);
  });

  const home = await call('GET', '/');
  await okAsync('the homepage route renders the bar, the bell, and the banner in that order', async () => {
    assert.strictEqual(home.status, 200);
    const body = home.body;
    const barAt = body.indexOf('id="announcementBar"');
    const navAt = body.indexOf('<nav>');
    const bellAt = body.indexOf('id="annBellBtn"');
    const navEnd = body.indexOf('</nav>');
    const bannerAt = body.indexOf('id="annBanner"');
    const heroAt = body.indexOf('class="hm-top"');
    assert.ok(barAt > 0 && barAt < navAt, 'bar above the header');
    assert.ok(bellAt > navAt && bellAt < navEnd, 'bell inside the header');
    assert.ok(bannerAt > navEnd && bannerAt < heroAt, 'banner under the header and above the existing hero');
    assert.ok(body.indexOf('Read this first') < body.indexOf('Michael wrote this'));
    assert.ok(body.includes('class="ann-bar-slide on'));
    assert.ok(body.includes('ann-dev-mobile'));
    assert.ok(body.includes('Phone only deal'));
    assert.ok(body.includes('GTA VI reservations are open'));
    assert.ok(body.includes('/uploads/gta.webp'));
    assert.ok(body.includes('/uploads/gta-mobile.webp'));
    assert.ok(body.includes('Reserve on Messenger'));
    assert.ok(body.includes('Now open'));
    assert.ok(body.includes('See all announcements'));
    assert.ok(body.indexOf('Pinned note') < body.indexOf('Later note'));
    assert.ok(body.includes('>NEW<'));
    ['Ended offer', 'Not started', 'Hidden offer', 'This ended'].forEach(t => assert.ok(!body.includes(t), t));
    assert.ok(body.includes('class="hm-top"'));
    assert.ok(body.includes('Rent the Latest'));
  });

  await okAsync('the archive page is public and listed in the sitemap', async () => {
    const page = await call('GET', '/announcements');
    assert.strictEqual(page.status, 200);
    assert.ok(page.body.includes('rel="canonical" href="https://www.playstation-hub.com/announcements"'));
    assert.ok(page.body.includes('<h1>What\'s New</h1>') || page.body.includes('<h1>What&#39;s New</h1>'));
    assert.ok(page.body.includes('GTA VI reservations are open'));
    assert.ok(page.body.includes('Pinned note'));
    assert.ok(!page.body.includes('Ended offer'));
    const map = await call('GET', '/sitemap.xml');
    assert.ok(map.body.includes('https://www.playstation-hub.com/announcements'));
  });

  const login = await call('POST', '/admin/login', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ password: TEST_PASSWORD })
  });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in');
  const auth = extra => Object.assign({ Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, extra || {});

  await okAsync('admin save, edit, and delete round-trip onto the homepage', async () => {
    const created = await call('POST', '/admin/announcements/save', {
      headers: auth(),
      body: form({
        title: 'Fresh drop', text: 'Out now', enabled: 'on', place_bar: 'on', place_bell: 'on',
        priority: '4', button_label: 'Browse', button_url: '/browse', bell_new_days: '7'
      })
    });
    assert.strictEqual(created.status, 302);
    assert.ok(created.headers.location.includes('announcements_saved'));
    const row = readDb().announcements.find(a => a.title === 'Fresh drop');
    assert.ok(row);
    assert.strictEqual(row.text, 'Out now');
    assert.strictEqual(row.place_bar, true);
    assert.ok(row.version);
    const shown = await call('GET', '/');
    assert.ok(shown.body.includes('Fresh drop'));
    const screen = await call('GET', '/admin?tab=settings', { headers: { Cookie: cookie } });
    assert.strictEqual(screen.status, 200);
    assert.ok(screen.body.includes('id="sec-announcements"'));
    assert.ok(screen.body.includes('Fresh drop'));
    assert.ok(screen.body.includes('Michael wrote this'));
    const edited = await call('POST', '/admin/announcements/save', {
      headers: auth(),
      body: form({
        id: String(row.id), title: 'Fresh drop', text: 'Updated copy', enabled: 'on',
        place_bar: 'on', place_bell: 'on', priority: '4', bell_new_days: '7'
      })
    });
    assert.strictEqual(edited.status, 302);
    const after = readDb().announcements.find(a => a.id === row.id);
    assert.strictEqual(after.text, 'Updated copy');
    assert.notStrictEqual(after.version, row.version);
    assert.strictEqual(readDb().announcements.find(a => a.id === 1).text, 'Michael wrote this');
    const removed = await call('POST', '/admin/announcements/delete/' + row.id, { headers: { Cookie: cookie } });
    assert.strictEqual(removed.status, 302);
    assert.ok(!readDb().announcements.some(a => a.id === row.id));
    const quiet = await call('GET', '/');
    assert.ok(!quiet.body.includes('Updated copy'));
    assert.ok(quiet.body.includes('Michael wrote this'));
  });

  console.log('\n' + passed + ' assertions passed\n');
}

main().then(() => { cleanup(); process.exit(0); }).catch(e => {
  console.error(e);
  cleanup();
  process.exit(1);
});
