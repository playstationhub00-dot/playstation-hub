// Run: node scripts/test-messenger-link.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

check('the order page leads with a Messenger confirm link that carries the ref', () => {
  const page = read('views/order-status.ejs');
  assert.ok(page.includes('id="ordMessengerConfirm"'));
  assert.ok(page.includes('Message us on Messenger to confirm'));
  assert.ok(page.includes("https://m.me/' + fbPage + '?ref=' + order.ref"));
  const confirmAt = page.indexOf('id="ordMessengerConfirm"');
  const payAt = page.indexOf('Pay ₱<%= totalDue %> now');
  assert.ok(confirmAt !== -1 && payAt !== -1 && confirmAt < payAt, 'the confirm step has to sit above the pay button');
});

check('a just-placed order and a duplicate submit each get their own flash', () => {
  const page = read('views/order-status.ejs');
  assert.ok(page.includes("msg === 'placed'"));
  assert.ok(page.includes("msg === 'already'"));
  const server = read('server.js');
  assert.ok(server.includes("placed.reused ? 'already' : 'placed'"));
});

check('a referral riding on the first message is still a referral', () => {
  const src = read('lib/messenger-webhook.js');
  assert.ok(src.includes('event.message.referral'));
  const server = read('server.js');
  assert.ok(server.includes('linkOrderFromReferral'));
  assert.ok(server.includes('rememberMessengerContact(event.psid)'));
});

check('checkout forms post a client token and are marked so a double-click is ignored', () => {
  ['views/game-detail.ejs', 'views/psplus-rent.ejs', 'views/bundle.ejs', 'views/upcoming-detail.ejs', 'views/partials/noslot-options.ejs']
    .forEach(file => {
      const src = read(file);
      assert.ok(src.includes('data-order-once'), file);
      assert.ok(src.includes('order-token'), file);
    });
  const guard = read('public/js/order-submit.js');
  assert.ok(guard.includes('data-order-sent'));
  assert.ok(read('views/partials/footer.ejs').includes('/js/order-submit.js'));
});

check('the confirm block renders for an unpaid order with no psid and hides once linked', () => {
  const file = path.join(root, 'views/order-status.ejs');
  const order = {
    ref: 'PH-0301', url_key: 'abc', state: 'awaiting_payment', game_title: 'Tekken 8',
    account_type: 'tr', days: 7, amount_due: 399, deposit_due: 100, fb_name: 'Ana Cruz',
    psid: null, is_buy: false, is_waitlist: false, is_reservation: false
  };
  const locals = {
    order, fbPage: 'PlaystationHub00', msg: 'placed', payMethods: [], isPaidOrder: false,
    payViaGateway: true, paypalQuote: null, ownerOnline: false, approvalEtaMinutes: null,
    recommend: null, canReview: false, myReview: null, holdState: null,
    queueRows: [], queuePos: null, queueExpired: false, signinSteps: [],
    announcements: [], assetV: 't',
    settings: { title: 'PlayStation Hub', logo_path: '/logo.svg', promo: { deposit: 100 }, payment_methods: [] },
    seo: {
      canonicalUrl: (p) => 'https://www.playstation-hub.com' + p,
      absoluteUrl: (p) => 'https://www.playstation-hub.com' + p,
      siteGraph: () => [],
      faviconType: () => 'image/svg+xml',
      jsonLdScript: () => '{}'
    },
    orderClientToken: () => 'abc123def456'
  };
  const html = ejs.render(fs.readFileSync(file, 'utf8'), locals, { filename: file });
  assert.ok(html.includes('id="ordMessengerConfirm"'));
  assert.ok(html.includes('https://m.me/PlaystationHub00?ref=PH-0301'));
  assert.ok(html.includes('Order placed.'));
  order.psid = '999';
  const linked = ejs.render(fs.readFileSync(file, 'utf8'), locals, { filename: file });
  assert.ok(!linked.includes('id="ordMessengerConfirm"'));
});

console.log('\n' + passed + ' assertions passed');
