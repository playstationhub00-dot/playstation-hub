// Run: node scripts/test-loyalty-wiring.js
//
// The loyalty rules live in lib/loyalty.js. This checks the admin and the
// order page are actually wired to them, without booting the server (that
// would write the local ledger).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const admin = fs.readFileSync(path.join(ROOT, 'views', 'admin.ejs'), 'utf8');
const orderPage = fs.readFileSync(path.join(ROOT, 'views', 'order-status.ejs'), 'utf8');
const customers = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'admin', 'customers.ejs'), 'utf8');
const ledger = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'admin', 'orders', 'ledger.ejs'), 'utf8');
const needsYou = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'admin', 'orders', 'needs-you.ejs'), 'utf8');
const settings = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'admin', 'settings.ejs'), 'utf8');

ok('server.js loads the loyalty library and builds one snapshot for the admin', () => {
  assert.ok(server.includes("const loyalty = require('./lib/loyalty');"));
  assert.ok(server.includes('res.locals.loyaltyIndex = loyaltySnapshot();'));
  assert.ok(server.includes('today: orders.manilaDate()'));
});

ok('loyalty settings are seeded only when the key is missing', () => {
  assert.ok(server.includes('if (s && s.loyalty === undefined)'));
  assert.ok(server.includes("db.set('site_settings.loyalty', seeded).write();"));
});

ok('redeem, merge, and link routes exist and stay on the loyalty tab', () => {
  ["'/admin/loyalty/settings'", "'/admin/loyalty/redeem'", "'/admin/loyalty/merge'", "'/admin/loyalty/link-name'", "'/admin/loyalty/link-row'", "'/admin/loyalty/unlink'"]
    .forEach(route => assert.ok(server.includes(route), route));
  assert.ok(server.includes("res.redirect('/admin?tab=loyalty&msg=loyalty_redeemed')"));
  assert.ok(server.includes('loyalty.planRedemption(profile, req.body'));
});

ok('the order page is given the same progress copy', () => {
  assert.ok(server.includes('loyaltyProgress: loyalty.customerCopy(loyaltySnapshot().profileFor({ name: order.fb_name, rowId: order.customer_id }))'));
  assert.ok(orderPage.includes('id="ordLoyalty"'));
  assert.ok(orderPage.includes('loyaltyProgress.punchLine'));
  assert.ok(orderPage.includes('loyaltyProgress.rebookLine'));
});

ok('the admin has a Loyalty tab, and settings can edit the offers', () => {
  assert.ok(admin.includes('data-tab="loyalty"'));
  assert.ok(admin.includes("'loyalty'"));
  assert.ok(admin.includes("include('partials/admin/loyalty')"));
  assert.ok(admin.includes("loyalty_saved:'loyalty'"));
  assert.ok(admin.includes("messages.loyalty_redeemed = '🎁 Reward marked redeemed'"));
  assert.ok(settings.includes("action=\"/admin/loyalty/settings\"") || settings.includes('loyalty-settings'));
});

ok('customer and order rows carry the reward badge', () => {
  assert.ok(customers.includes("include('loyalty-badge'"));
  assert.ok(ledger.includes("include('../loyalty-badge'"));
  assert.ok(needsYou.includes("include('../loyalty-badge'"));
});

console.log('\n' + passed + ' assertions passed\n');
