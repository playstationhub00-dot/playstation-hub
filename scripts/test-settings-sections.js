// Run: node scripts/test-settings-sections.js
//
// Settings is split into tabs. Old #sec- links still name a tab, each form
// still posts to its own route, and bank transfer numbers are masked.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const settingsNav = require('../public/js/admin-settings');
const mask = require('../lib/mask');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const root = path.join(__dirname, '..');
const settings = fs.readFileSync(path.join(root, 'views', 'partials', 'admin', 'settings.ejs'), 'utf8');
const fields = fs.readFileSync(path.join(root, 'views', 'partials', 'admin', 'announcement-fields.ejs'), 'utf8');
const announcements = fs.readFileSync(path.join(root, 'views', 'partials', 'admin', 'announcements.ejs'), 'utf8');
const themes = fs.readFileSync(path.join(root, 'views', 'partials', 'admin', 'themes.ejs'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'views', 'admin.ejs'), 'utf8');
const confirmJs = fs.readFileSync(path.join(root, 'public', 'js', 'admin-confirm.js'), 'utf8');

ok('a hash names the tab, and it wins over a different ?section=', () => {
  assert.strictEqual(settingsNav.sectionForAnchor('sec-payments'), 'payments');
  assert.strictEqual(settingsNav.sectionForAnchor('#sec-game-discounts'), 'pricing');
  assert.strictEqual(settingsNav.sectionForAnchor('sec-reminders'), 'payments');
  assert.strictEqual(settingsNav.sectionForAnchor('sec-images'), 'maintenance');
  assert.strictEqual(settingsNav.sectionForAnchor('sec-loyalty'), 'site');
  assert.strictEqual(settingsNav.sectionForAnchor('sec-alerts'), 'alerts');
  assert.strictEqual(
    settingsNav.resolveSection({ section: 'themes', hash: 'sec-payments' }),
    'payments'
  );
});

ok('?section= and the save message pick a tab when there is no hash', () => {
  assert.strictEqual(settingsNav.resolveSection({ section: 'payments' }), 'payments');
  assert.strictEqual(settingsNav.resolveSection({ section: 'nope', msg: 'reminders_saved' }), 'payments');
  assert.strictEqual(settingsNav.resolveSection({ msg: 'promo_saved' }), 'pricing');
  assert.strictEqual(settingsNav.resolveSection({ msg: 'alerts_saved' }), 'alerts');
  assert.strictEqual(settingsNav.resolveSection({ msg: 'themes_saved' }), 'themes');
  assert.strictEqual(settingsNav.resolveSection({}), 'themes');
  assert.strictEqual(settingsNav.resolveSection({ section: 'maintenance' }), 'maintenance');
});

ok('a schedule value is shown as a date, not shifted by the browser timezone', () => {
  assert.strictEqual(settingsNav.formatSchedule('2026-11-04T13:28'), '4 Nov 2026, 1:28 PM');
  assert.strictEqual(settingsNav.formatSchedule('2026-11-04T00:05'), '4 Nov 2026, 12:05 AM');
  assert.strictEqual(settingsNav.formatSchedule('2026-11-04T12:00'), '4 Nov 2026, 12:00 PM');
  assert.strictEqual(settingsNav.formatSchedule(''), '');
  assert.strictEqual(settingsNav.formatSchedule('not-a-date'), '');
});

ok('optimizing images asks first and says the job is heavy', () => {
  assert.ok(/heavy/i.test(settingsNav.OPTIMIZE_CONFIRM.body));
  assert.ok(/Optimize all images now/.test(settingsNav.OPTIMIZE_CONFIRM.title));
  assert.ok(settings.includes('AdminSettings.OPTIMIZE_CONFIRM'));
  assert.ok(settings.includes('/admin/backfill-images'));
  assert.ok(confirmJs.includes('adminConfirmAsk'));
});

ok('the settings page has one tab per group and keeps every save route', () => {
  ['themes', 'announcements', 'site', 'pricing', 'payments', 'alerts', 'maintenance'].forEach(id => {
    assert.ok(settings.includes('data-set-tab="' + id + '"'), id);
    assert.ok(settings.includes('data-set-panel="' + id + '"'), id);
  });
  [
    '/admin/site-settings',
    '/admin/change-password',
    '/admin/promo',
    '/admin/promo/game-discounts',
    '/admin/payment-methods',
    '/admin/settings/payment-reminders',
    '/admin/settings/alerts'
  ].forEach(route => assert.ok(settings.includes(route), route));
  assert.ok(themes.includes('action="/admin/themes"'));
  assert.ok(announcements.includes('action="/admin/announcements/save"'));
  assert.ok(settings.includes('id="sec-themes"') || themes.includes('id="sec-themes"'));
  assert.ok(announcements.includes('id="sec-announcements"'));
  assert.ok(settings.includes('id="sec-payments"'));
  assert.ok(settings.includes('id="sec-reminders"'));
  assert.ok(settings.includes('id="sec-images"'));
  assert.ok(settings.includes('id="sec-promo"'));
  assert.ok(settings.includes('id="sec-game-discounts"'));
});

ok('the old hero background is labelled legacy and still posts', () => {
  assert.ok(settings.includes('class="set-legacy"'));
  assert.ok(/Legacy/.test(settings));
  assert.ok(settings.includes('name="hero_bg_type"'));
  assert.ok(settings.includes('name="hero_bg_file"'));
  assert.ok(settings.includes('name="hero_bg_overlay"'));
  assert.ok(settings.includes('name="section_gap"'));
});

ok('loyalty in settings is a link, and the Loyalty page still has the form', () => {
  assert.ok(settings.includes('href="/admin?tab=loyalty"'));
  assert.ok(!settings.includes('loyalty-settings'));
  assert.ok(!settings.includes('action="/admin/loyalty/settings"'));
});

ok('announcement fields are grouped and delete is a separate simple confirm', () => {
  ['Basics', 'Where &amp; when', 'Button', 'Advanced'].forEach(name => {
    assert.ok(fields.includes(name), name);
  });
  ['name="enabled"', 'name="place_bar"', 'name="place_bell"', 'name="place_banner"',
    'name="title"', 'name="text"', 'name="button_label"', 'name="button_url"',
    'name="button2_label"', 'name="button2_url"', 'name="countdown_at"',
    'name="starts_at"', 'name="ends_at"', 'name="priority"', 'name="icon"',
    'name="audience"', 'name="device"', 'name="bell_new_days"', 'name="bell_pin"',
    'name="image"', 'name="image_mobile"'].forEach(name => assert.ok(fields.includes(name), name));
  assert.ok(announcements.includes('class="ann-admin-preview"'));
  assert.ok(announcements.includes('class="ann-remove"'));
  assert.ok(announcements.includes('data-confirm-title="Delete this announcement?"'));
  assert.ok(!announcements.includes("onsubmit=\"return confirm"));
  assert.ok(themes.includes('type="datetime-local"'));
  assert.ok(themes.includes('Asia/Manila'));
});

ok('leaving a dirty settings tab is wired through the shell', () => {
  assert.ok(admin.includes('settingsShouldBlock'));
  assert.ok(admin.includes('settingsSyncFromUrl'));
  assert.ok(admin.includes('id="setDirty"') || settings.includes('id="setDirty"'));
  assert.ok(settings.includes('Switching tabs with unsaved edits'));
});

console.log('\n' + passed + ' static checks passed');

const PORT = 4813;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-sections-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const SECRETS = {
  gcash: '09170001111',
  maya: '09180002222',
  paypal: 'sample.shop@example.com',
  bank: '999000111222'
};
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  site_settings: {
    title: 'PlayStation Hub',
    fb_page_username: 'SamplePage',
    payment_methods: [
      { key: 'gcash', label: 'GCash', account_name: 'Sample Shop', account_number: SECRETS.gcash, qr_image: '', enabled: true },
      { key: 'maya', label: 'Maya', account_name: 'Sample Shop', account_number: SECRETS.maya, qr_image: '', enabled: true },
      { key: 'paypal', label: 'PayPal', account_name: 'Sample Shop', account_number: SECRETS.paypal, qr_image: '', enabled: true },
      { key: 'bank', label: 'Bank Transfer', account_name: 'Sample Shop', account_number: SECRETS.bank, qr_image: '', enabled: false }
    ]
  },
  announcements: [{
    id: 1, enabled: true, title: 'Sample announcement', text: 'Seeded copy for the editor.',
    place_bar: true, place_bell: false, place_banner: false, button_label: 'Learn more',
    button_url: '/browse', priority: 1, sort: 1, audience: 'all', device: 'all', bell_new_days: 0
  }],
  nextAnnouncementId: 2,
  games: []
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';

function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: 'localhost', port: PORT, path: p, method,
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

  const login = await call('POST', '/admin/login', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: TEST_PASSWORD }).toString()
  });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in');

  const page = await call('GET', '/admin?tab=settings&section=payments', { headers: { Cookie: cookie } });
  assert.strictEqual(page.status, 200);
  assert.ok(page.body.includes('data-set-panel="payments"'));
  assert.ok(page.body.includes('data-mask-subject="bank"'));
  assert.ok(page.body.includes('name="number_bank_keep"'));
  assert.ok(page.body.includes(mask.maskPaymentNumber(SECRETS.bank)));
  assert.ok(page.body.includes(mask.maskPaymentNumber(SECRETS.gcash)));
  assert.ok(page.body.includes(mask.maskPaymentNumber(SECRETS.paypal)));
  Object.keys(SECRETS).forEach(key => {
    assert.ok(!page.body.includes(SECRETS[key]), key + ' number must stay off the page');
  });
  assert.ok(page.body.includes('Sample announcement'));
  assert.ok(page.body.includes('Where &amp; when') || page.body.includes('Where & when'));
  assert.ok(page.body.includes('id="heroLegacy"'));
  assert.ok(page.body.includes('href="/admin?tab=loyalty"'));
  console.log('  ok - rendered settings masks bank transfer and keeps the tabs');
  passed++;

  console.log('\n' + passed + ' passed');
  cleanup();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  cleanup();
  process.exit(1);
});
