// Run: node scripts/test-faq-terms.js
//
// /faq and /terms render in the existing page shell, say the shop facts the
// owner supplied, and do not invent a legal policy. Both are linked from the
// footer next to the contact email.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const pay = require('../lib/payment-copy');
const seo = require('../lib/seo');
const faqPages = require('../lib/faq-pages');
const policy = require('../lib/policy-copy');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const locals = {
  settings: {
    title: 'PlayStation Hub',
    favicon_path: '/favicon.svg',
    logo_path: '/logo.svg',
    payment_methods: [{ key: 'gcash', label: 'GCash', enabled: true }]
  },
  assetV: 'test',
  announcements: [],
  announcement: null,
  payViaGateway: false,
  // Same wrapper server.js puts on app.locals. The partial calls
  // paymentNote(settings, payViaGateway), not the raw options object.
  paymentNote: (settings, gateway) => pay.paymentNote({
    payViaGateway: !!gateway,
    payment_methods: settings && settings.payment_methods
  }),
  seo,
  faqPages,
  policy
};

function render(name) {
  const file = path.join(ROOT, 'views', name);
  return ejs.render(fs.readFileSync(file, 'utf8'), locals, { filename: file });
}

console.log('\nfaq and terms');

ok('both pages render and the footer links them, with the contact email beside Messenger and Facebook', () => {
  const faq = render('faq.ejs');
  const terms = render('terms.ejs');
  const footer = fs.readFileSync(path.join(ROOT, 'views/partials/footer.ejs'), 'utf8');
  [faq, terms].forEach(html => {
    assert.ok(html.includes('Weekly'));
    assert.ok(html.includes('7 days'));
    assert.ok(html.includes('Monthly'));
    assert.ok(html.includes('30 days'));
    assert.ok(html.includes('Non-Trophy'));
    assert.ok(html.includes('Trophy'));
    assert.ok(html.includes('PS4 Primary'));
    assert.ok(html.includes('₱100'));
    assert.ok(html.includes('GCash or Maya for local customers'));
    assert.ok(html.includes('PayPal for international customers'));
    assert.ok(html.includes('playstationhub00@gmail.com'));
    assert.ok(html.includes('http://m.me/PlaystationHub00'));
    assert.ok(html.includes('https://facebook.com/PlaystationHub00'));
    assert.ok(html.includes('QR'));
    assert.ok(/never share a password|Customers never share a password/.test(html));
    assert.ok(html.includes('refunded when the account is returned with proof') || html.includes('refunded when the account is returned with proof.'));
    assert.ok(/[Bb]ought games are permanent/.test(html));
    assert.ok(/free waitlist/.test(html));
    assert.ok(html.includes('/how-it-works'));
    assert.ok(html.includes('href="/faq"'));
    assert.ok(html.includes('href="/terms"'));
  });
  assert.ok(footer.includes('href="/faq"'));
  assert.ok(footer.includes('href="/terms"'));
  assert.ok(footer.includes('mailto:playstationhub00@gmail.com'));
  assert.ok(faq.includes('mailto:playstationhub00@gmail.com'));
  assert.ok(!faq.includes('10% off'), 'faq must not claim 10% off unless a monthly promo is live');
  assert.ok(faq.includes('Unlimited FREE game changes while your rental is active (2-day cooldown between swaps, subject to slot availability).'));
  assert.ok(faq.includes('same price tier'));
  assert.ok(faq.includes('Non-Trophy rentals have no late fees'));
  assert.ok(terms.includes('When the monthly promo is on'));
  assert.ok(terms.includes('10% off'));
  assert.ok(!faq.includes('Playstation Hub'));
  assert.ok(!terms.includes('Playstation Hub'));
  const disclaimer = 'PlayStation Hub is an independent rental shop, not affiliated with Sony Interactive Entertainment.';
  assert.ok(faq.includes(disclaimer));
  assert.ok(terms.includes(disclaimer));
  assert.ok(faq.includes(policy.ONLINE_EXCEPTION));
  assert.ok(terms.includes(policy.ONLINE_WITHOUT));
  assert.ok(terms.includes(policy.ONLINE_EXCEPTION));
  const trialQ = 'Can I try a game before I pay?';
  const trial = policy.TRIAL_ANSWER;
  assert.ok(faq.includes(trial));
  assert.strictEqual(faqPages.faqItems({}).find(i => i.q === trialQ).text, trial);
  assert.strictEqual(faqPages.homeItems({ deposit: 100, lateFee: 20 }).find(i => i.q === trialQ).text, trial);
});

ok('terms state the rental rules and do not add court clauses', () => {
  const terms = render('terms.ejs').toLowerCase();
  assert.ok(terms.includes('terms of service'));
  assert.ok(terms.includes('late fee'));
  assert.ok(terms.includes('no late fees'));
  assert.ok(terms.includes('₱20'));
  assert.ok(terms.includes('costs the same as a ps5 trophy rental'));
  assert.ok(!terms.includes('priced like non-trophy'));
  assert.ok(terms.includes('unlimited free game changes while your rental is active'));
  assert.ok(terms.includes('same price tier'));
  assert.ok(terms.includes('gta vi'));
  assert.ok(terms.includes('psn password'));
  ['governing law', 'liability', 'chargeback', 'free trial', 'priority fee', 'jurisdiction'].forEach(word => {
    assert.ok(!terms.includes(word), 'invented policy: ' + word);
  });
});

ok('privacy and data deletion are public pages linked from the footer', () => {
  const privacy = render('privacy.ejs');
  const deletion = render('data-deletion.ejs');
  const footer = fs.readFileSync(path.join(ROOT, 'views/partials/footer.ejs'), 'utf8');
  assert.ok(privacy.includes('Privacy Policy'));
  assert.ok(privacy.includes('Messenger PSID'));
  assert.ok(privacy.includes('Anthropic Claude'));
  assert.ok(privacy.includes('MongoDB'));
  assert.ok(privacy.includes('Railway'));
  assert.ok(privacy.includes('PayMongo'));
  assert.ok(privacy.includes('GCash'));
  assert.ok(privacy.includes('Maya'));
  assert.ok(privacy.includes('PayPal'));
  assert.ok(privacy.includes('playstationhub00@gmail.com'));
  assert.ok(privacy.includes('within 30 days'));
  assert.ok(deletion.includes('User Data Deletion'));
  assert.ok(deletion.includes('http://m.me/PlaystationHub00'));
  assert.ok(deletion.includes('mailto:playstationhub00@gmail.com'));
  assert.ok(deletion.includes('Within 30 days'));
  assert.ok(deletion.includes('PSID'));
  assert.ok(footer.includes('href="/privacy"'));
  assert.ok(footer.includes('href="/data-deletion"'));
  assert.ok(footer.includes('href="/terms"'));
});

ok('the shared payment sentence matches the helper, including card and bank only when on', () => {
  const file = path.join(ROOT, 'views/partials/pay-note.ejs');
  const src = fs.readFileSync(file, 'utf8');
  function note(extra) {
    return ejs.render(src, Object.assign({}, locals, extra), { filename: file }).trim();
  }
  assert.strictEqual(note({}), pay.paymentNote({ payment_methods: locals.settings.payment_methods, payViaGateway: false }));
  const withExtras = {
    payViaGateway: true,
    settings: { payment_methods: [{ key: 'bank', enabled: true }] }
  };
  assert.strictEqual(
    note(withExtras),
    pay.paymentNote({ payViaGateway: true, payment_methods: withExtras.settings.payment_methods })
  );
  assert.ok(note(withExtras).includes('card checkout is also available'));
  assert.ok(note(withExtras).includes('bank transfer is also available'));
});

const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
ok('the routes exist', () => {
  assert.ok(server.includes("app.get('/faq'"));
  assert.ok(server.includes("app.get('/terms'"));
  assert.ok(server.includes("app.get('/privacy'"));
  assert.ok(server.includes("app.get('/data-deletion'"));
  assert.ok(server.includes('titleFixes.findBySlug'));
  assert.ok(server.includes('requestBoard.linkStockedRequest'));
});

console.log('\n' + passed + ' assertions passed\n');
