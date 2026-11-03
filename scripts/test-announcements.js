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
  const withCover = announcements.present({
    entries: rows,
    now: NOW,
    catalog: { upcoming: [{ title: 'Grand Theft Auto VI Ultimate Edition', cover_image: '/uploads/gta-cover.webp' }], games: [] }
  });
  assert.strictEqual(withCover.banner[0].image, '/uploads/gta-cover.webp');
  assert.strictEqual(feed.banner[0].image, '', 'an uploaded image is not invented when the catalogue is absent');
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

console.log('\nhero slides');
function heroRows() {
  return [
    entry({ id: 1, source_key: 'home-hero-gta6', place_banner: true, priority: 5, sort: 3, label: 'Reservations open', title: 'GTA VI is coming.', title_accent: 'Reserve your slot now.', text: 'Hold your spot.', button_label: 'Reserve on Messenger', button_url: 'https://m.me/PlaystationHub00', countdown_at: '2026-11-19T00:00' }),
    entry({ id: 2, source_key: 'home-hero-cod-mw4', place_banner: true, priority: 4, sort: 4, title: 'Call of Duty®: Modern Warfare® 4', title_accent: 'is ready to play.', text: 'seed', button_label: 'Rent now', button_url: '/game/call-of-duty-modern-warfare-4', button2_label: 'See all new games', button2_url: '/browse?tab=new', image: '/uploads/1789972642700.webp' }),
    entry({ id: 3, source_key: 'home-hero-psplus', place_banner: true, priority: 3, sort: 5, label: 'PS Plus Deluxe', title: 'Hundreds of games.', title_accent: 'One rental.', text: 'Play any game.', button_label: 'See the games', button_url: '/ps-plus', button2_label: 'How it works', button2_url: '/how-it-works' }),
    entry({ id: 4, source_key: 'home-hero-try3h', place_banner: true, priority: 2, sort: 6, label: 'Try before you pay', title: 'Play free for 3 hours first.', title_accent: '3 hours', text: 'Try it.', button_label: 'Message us', button_url: 'https://m.me/PlaystationHub00', button2_label: 'Compare account types', button2_url: '/guides/trophy-vs-non-trophy-vs-ps4-primary', image: '/uploads/1791607091002.webp' })
  ];
}
function heroGames() {
  return [
    { id: 8, title: 'Call of Duty: Modern Warfare 4', platform: 'PS5', nt_price_7d: 349, tr_price_7d: 449, non_trophy_slots: 1, trophy_slots: 0, cover_image: '/uploads/cod.webp' },
    { id: 9, title: 'God of War Ragnarok', cover_image: '/uploads/gow.webp', platform: 'PS5' },
    { id: 10, title: 'Horizon Zero Dawn', cover_image: '/uploads/hzd.webp', platform: 'PS5' },
    { id: 11, title: 'Ghost of Tsushima', cover_image: '/uploads/ghost.webp', platform: 'PS5' },
    { id: 12, title: 'The Crew Motorfest', cover_image: '/uploads/crew.webp', platform: 'PS5' },
    { id: 13, title: 'Grand Theft Auto V', cover_image: '/uploads/gtav.webp', platform: 'PS5' },
    { id: 14, title: 'The Last of Us Part I', cover_image: '/uploads/tlou.webp', platform: 'PS5' },
    { id: 15, title: 'PS Plus Deluxe', cover_image: '/uploads/plus.webp', nt_price_7d: 999, tr_price_7d: 999, platform: 'PS5' }
  ];
}
ok('GTA stays first, and the other slides take slots, price, and covers from the catalogue', () => {
  const catalog = { games: heroGames(), psplusPrices: { nt_price_7d: 349, tr_price_7d: 399 }, summaries: {} };
  const feed = announcements.present({ entries: heroRows(), now: NOW, catalog });
  assert.deepStrictEqual(feed.banner.map(s => s.sourceKey), ['home-hero-gta6', 'home-hero-cod-mw4', 'home-hero-psplus', 'home-hero-try3h']);
  assert.ok(feed.banner[0].countdown, 'GTA countdown still comes from countdown_at');
  assert.strictEqual(feed.banner[0].title, 'GTA VI is coming.');
  assert.strictEqual(feed.banner[1].label, 'New · Last slot');
  assert.strictEqual(feed.banner[1].buttonLabel, 'Rent now');
  assert.strictEqual(feed.banner[1].buttonUrl, '/game/call-of-duty-modern-warfare-4');
  assert.strictEqual(feed.banner[1].footer, 'Weekly from ₱349');
  assert.ok(feed.banner[1].text.includes('still a slot open'));
  assert.ok(!feed.banner[1].text.includes('\u2014'));
  const many = announcements.present({
    entries: heroRows(), now: NOW,
    catalog: { games: heroGames().map(g => g.id === 8 ? Object.assign({}, g, { non_trophy_slots: 2, trophy_slots: 1 }) : g), psplusPrices: catalog.psplusPrices }
  });
  assert.strictEqual(many.banner[1].label, 'New');
  assert.ok(many.banner[1].text.includes('slots are open'));
  const none = announcements.present({
    entries: heroRows(), now: NOW,
    catalog: { games: heroGames().map(g => g.id === 8 ? Object.assign({}, g, { non_trophy_slots: 0, trophy_slots: 0 }) : g), psplusPrices: { nt_price_7d: 280, tr_price_7d: 399 } }
  });
  assert.strictEqual(none.banner[1].label, 'Full');
  assert.strictEqual(none.banner[1].buttonLabel, 'Join the line');
  assert.strictEqual(none.banner[1].buttonUrl, '/game/call-of-duty-modern-warfare-4');
  assert.ok(!none.banner[1].text.includes('still a slot open'));
  assert.strictEqual(feed.banner[2].footer, 'From ₱349 / week');
  assert.strictEqual(feed.banner[2].button2Url, '/how-it-works');
  assert.deepStrictEqual(feed.banner[2].covers, [], 'rental covers are not the PS Plus collage');
  assert.ok(!/forza|yotei|first light|assassin/i.test(feed.banner[2].text));
  assert.strictEqual(feed.banner[3].title, 'Play free for');
  assert.strictEqual(feed.banner[3].titleAccent, '3 hours');
  assert.strictEqual(feed.banner[3].titleTail, ' first.');
  assert.strictEqual(feed.banner[3].footer, 'Non-Trophy accounts only. Not on Trophy or PS4 Primary.');
  assert.strictEqual(feed.banner[3].badge, true);
  assert.strictEqual(feed.banner[3].buttonUrl, 'https://m.me/PlaystationHub00');
  const fromAccounts = announcements.present({
    entries: heroRows(), now: NOW,
    catalog: {
      games: heroGames().map(g => g.id === 8 ? Object.assign({}, g, { non_trophy_slots: 5, trophy_slots: 5 }) : g),
      summaries: { 8: { non_trophy: { available: 1, total: 3 }, trophy: { available: 0, total: 2 }, ps4_primary: { available: 0, total: 0 } } },
      psplusPrices: catalog.psplusPrices
    }
  });
  assert.strictEqual(fromAccounts.banner[1].label, 'New · Last slot');
  const priced = announcements.present({
    entries: heroRows(), now: NOW,
    catalog: {
      games: [{ id: 8, title: 'Call of Duty: Modern Warfare 4', platform: 'PS5', price_category_id: 2, nt_price_7d: 0, tr_price_7d: 0, non_trophy_slots: 3, trophy_slots: 0, cover_image: '/c.webp' }],
      priceCategories: [{ id: 2, nt_price_7d: 299, tr_price_7d: 399 }],
      promo: { enabled: true, discounts: { 7: 10, 30: 0 } },
      psplusPrices: null
    }
  });
  assert.strictEqual(priced.banner[1].label, 'New');
  assert.strictEqual(priced.banner[1].footer, 'Weekly from ₱269');
  assert.strictEqual(priced.banner[2].footer, '');
  const missing = announcements.present({ entries: heroRows(), now: NOW, catalog: { games: [], psplusPrices: null } });
  assert.strictEqual(missing.banner[1].label, 'Full');
  assert.strictEqual(missing.banner[1].footer, '');
  assert.strictEqual(missing.banner[1].buttonLabel, 'Join the line');
  assert.strictEqual(missing.banner[1].buttonUrl, '/browse?tab=new');
});

ok('the PS Plus collage uses only that catalogue, and the sentence names those games', () => {
  const rental = [
    { title: 'Forza Horizon 5', cover_image: '/uploads/forza.webp' },
    { title: 'Ghost of Yotei', cover_image: '/uploads/yotei.webp' },
    { title: '007 First Light', cover_image: '/uploads/007.webp' },
    { title: "Assassin's Creed Shadows", cover_image: '/uploads/shadows.webp' },
    { title: 'Assassin\'s Creed Shadows: Claws of Awaji', cover_image: '/uploads/claws.webp' }
  ];
  const plus = [
    { n: 'Forza Horizon 5', i: 'https://image.api.playstation.com/forza.png' },
    { n: 'Ghost of Yotei', i: 'https://image.api.playstation.com/yotei.png' },
    { n: 'God of War Ragnarök', i: 'https://image.api.playstation.com/gow.png' },
    { n: 'Horizon Zero Dawn Remastered', c: '/uploads/hzd-plus.webp' },
    { n: 'Grand Theft Auto V', i: 'https://image.api.playstation.com/gtav.png' },
    { n: 'No art yet' },
    { n: 'Astro Bot', i: 'https://image.api.playstation.com/astro.png' }
  ];
  // Forza is in this sample list on purpose, after the three named games, so a
  // loose "Horizon" match cannot steal the second slot. The live collage only
  // receives the PS Plus list, never the rental shelf.
  const picked = announcements.selectPsplusCollage(plus);
  assert.deepStrictEqual(picked.covers.map(c => c.title), [
    'God of War Ragnarök',
    'Horizon Zero Dawn Remastered',
    'Grand Theft Auto V',
    'Forza Horizon 5',
    'Ghost of Yotei',
    'Astro Bot'
  ]);
  assert.strictEqual(picked.covers[1].src, '/uploads/w/480/hzd-plus.webp?v=2');
  assert.ok(picked.text.includes('God of War Ragnarök'));
  assert.ok(picked.text.includes('Horizon Zero Dawn Remastered'));
  assert.ok(picked.text.includes('Grand Theft Auto V'));
  assert.ok(picked.text.includes('and more.'));
  assert.ok(!picked.text.includes('Forza'));
  assert.ok(!picked.text.includes('Yotei'));
  assert.ok(!picked.text.includes('\u2014'));
  const feed = announcements.present({
    entries: heroRows(),
    now: NOW,
    catalog: {
      games: rental,
      psplusPrices: { nt_price_7d: 349, tr_price_7d: 399 },
      psplusItems: plus.filter(item => item.n !== 'Forza Horizon 5' && item.n !== 'Ghost of Yotei')
    }
  });
  const titles = feed.banner[2].covers.map(c => c.title);
  assert.deepStrictEqual(titles, ['God of War Ragnarök', 'Horizon Zero Dawn Remastered', 'Grand Theft Auto V', 'Astro Bot']);
  rental.forEach(g => assert.ok(!titles.includes(g.title), g.title));
  assert.ok(!feed.banner[2].text.includes('Forza'));
  assert.ok(!feed.banner[2].text.includes('Yotei'));
  assert.ok(!feed.banner[2].text.includes('First Light'));
  assert.ok(!feed.banner[2].text.includes('Assassin'));
  const two = announcements.selectPsplusCollage([
    { n: 'Astro Bot', i: 'https://image.api.playstation.com/astro.png' },
    { n: 'Sackboy', i: 'https://image.api.playstation.com/sack.png' }
  ]);
  assert.strictEqual(two.covers.length, 2);
  assert.ok(two.text.includes('Astro Bot and Sackboy.'));
  assert.ok(!two.text.includes('and more'));
});

ok('hero slide seeding is idempotent and does not touch a row that already has the key', () => {
  const custom = {
    migrations: ['homepage-redesign-2026-10-29'],
    announcements: [{ id: 3, source_key: 'home-hero-cod-mw4', title: 'Custom CoD', text: 'Keep me', enabled: true, place_banner: true }],
    nextAnnouncementId: 4
  };
  const first = announcements.applyHeroSlides(custom, NOW);
  assert.strictEqual(first.write, true);
  assert.ok(first.migrations.includes(announcements.HERO_SLIDES_MIGRATION_ID));
  const cod = first.announcements.filter(a => a.source_key === 'home-hero-cod-mw4');
  assert.strictEqual(cod.length, 1);
  assert.strictEqual(cod[0].text, 'Keep me');
  assert.strictEqual(cod[0].title, 'Custom CoD');
  assert.strictEqual(first.announcements.filter(a => a.source_key === 'home-hero-psplus').length, 1);
  assert.strictEqual(first.announcements.filter(a => a.source_key === 'home-hero-try3h').length, 1);
  const again = announcements.applyHeroSlides({
    migrations: first.migrations,
    announcements: first.announcements.map(a => a.source_key === 'home-hero-psplus' ? Object.assign({}, a, { title: 'Edited' }) : a),
    nextAnnouncementId: first.nextAnnouncementId
  }, NOW);
  assert.strictEqual(again.write, false);
  assert.strictEqual(again.announcements.filter(a => a.source_key === 'home-hero-psplus').length, 1);
  assert.strictEqual(again.announcements.find(a => a.source_key === 'home-hero-psplus').title, 'Edited');
  const dropped = announcements.applyHeroSlides({
    migrations: [announcements.HERO_SLIDES_MIGRATION_ID],
    announcements: [],
    nextAnnouncementId: 1
  }, NOW);
  assert.strictEqual(dropped.write, false);
  assert.strictEqual(dropped.announcements.length, 0);
});

ok('the banner script auto-advances on its own interval, and stays quiet for reduced motion', () => {
  const js = fs.readFileSync(path.join(__dirname, '../public/js/announcements.js'), 'utf8');
  assert.ok(js.includes("getAttribute('data-interval')"));
  assert.ok(js.includes('prefers-reduced-motion'));
  assert.ok(js.includes('touchstart') && js.includes('touchend'));
  assert.ok(js.includes('ArrowLeft') && js.includes('ArrowRight'));
  assert.ok(js.includes("setLive('off')") && js.includes("setLive('polite')"));
  assert.ok(js.includes(':focus-visible'), 'a mouse click must not pause auto-advance forever');
  assert.ok(js.includes('ann-banner-arrow'));
  assert.ok(!js.includes('function focusInside'));
  const css = fs.readFileSync(path.join(__dirname, '../public/css/home.css'), 'utf8');
  assert.ok(css.includes('height: 420px') && css.includes('height: 680px'));
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
  migrations: ['theme-presets-2026-10-29', 'announcements-2026-10-29', 'homepage-redesign-2026-10-29'],
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
    const heroAt = body.indexOf('id="find"');
    assert.ok(barAt > 0 && barAt < navAt, 'bar above the header');
    assert.ok(bellAt > navAt && bellAt < navEnd, 'bell inside the header');
    assert.ok(bannerAt > navEnd && bannerAt < heroAt, 'banner under the header and above the search');
    assert.ok(!body.includes('id="hmBanner"'));
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
    assert.ok(body.includes('id="find"'));
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
