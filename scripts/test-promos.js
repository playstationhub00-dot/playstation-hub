// Run: node scripts/test-promos.js
//
// One list of promos the site, the checkout line, and the support assistant
// all read. Loyalty offers are derived from the loyalty toggles. A custom
// promo is live only while it is on and today (Asia/Manila) sits inside its
// dates. Expired and disabled promos never come back from liveOffers.
const assert = require('assert');
const promos = require('../lib/promos');
const loyalty = require('../lib/loyalty');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const games = [
  { id: 7, title: 'Elden Ring' },
  { id: 8, title: 'Hogwarts Legacy' }
];

function custom(over) {
  return Object.assign({
    id: 'p1',
    title: 'Elden week',
    text: '₱50 off Elden Ring this week.',
    terms: 'One rental per customer. New orders only.',
    starts_on: '2026-10-01',
    ends_on: '2026-10-20',
    enabled: true,
    game_id: 7,
    badge: '₱50 off',
    featured: false
  }, over || {});
}

const loyaltyOn = loyalty.normalizeSettings({
  punch_enabled: true, punch_every: 5, reward_days: 7,
  rebook_enabled: true, rebook_amount: 50, rebook_within_days: 7,
  trophy_double: false
});

function live(stored, settings, today) {
  return promos.liveOffers({
    stored: stored || [],
    loyaltySettings: settings || loyaltyOn,
    games,
    today: today || '2026-10-14'
  });
}

console.log('\nlive window');

ok('a promo is live on its start date and on its end date', () => {
  const rows = live([custom({ starts_on: '2026-10-14', ends_on: '2026-10-14' })], loyaltyOn, '2026-10-14');
  assert.ok(rows.some(o => o.id === 'p1'));
});

ok('a promo that has not started yet is hidden', () => {
  const rows = live([custom({ starts_on: '2026-10-15' })], loyaltyOn, '2026-10-14');
  assert.ok(!rows.some(o => o.id === 'p1'));
});

ok('a promo that ended yesterday is hidden', () => {
  const rows = live([custom({ ends_on: '2026-10-13' })], loyaltyOn, '2026-10-14');
  assert.ok(!rows.some(o => o.id === 'p1'));
  assert.ok(!JSON.stringify(promos.publicFacts(rows)).includes('Elden week'));
});

ok('a disabled promo is hidden even inside its dates', () => {
  const rows = live([custom({ enabled: false })], loyaltyOn, '2026-10-14');
  assert.ok(!rows.some(o => o.id === 'p1'));
});

ok('blank dates mean the promo stays open', () => {
  const rows = live([custom({ starts_on: '', ends_on: '' })], loyaltyOn, '2026-10-14');
  assert.ok(rows.some(o => o.id === 'p1'));
});

console.log('\nloyalty offers follow the toggles');

ok('punch and rebook are included while their toggles are on', () => {
  const rows = live([], loyaltyOn, '2026-10-14');
  const punch = rows.find(o => o.id === 'loyalty-punch');
  const rebook = rows.find(o => o.id === 'loyalty-rebook');
  assert.ok(punch);
  assert.ok(punch.text.includes('5'));
  assert.ok(punch.text.includes('7-day'));
  assert.ok(rebook);
  assert.ok(rebook.text.includes('₱50'));
  assert.ok(rebook.text.includes('7 days'));
  assert.ok(!punch.terms.includes('two punches'));
});

ok('turning punch off hides it, and trophy double only changes the punch terms', () => {
  const off = live([], loyalty.normalizeSettings({ punch_enabled: false, rebook_enabled: true, trophy_double: true }), '2026-10-14');
  assert.ok(!off.some(o => o.id === 'loyalty-punch'));
  assert.ok(off.some(o => o.id === 'loyalty-rebook'));
  const doubled = live([], loyalty.normalizeSettings({ punch_enabled: true, rebook_enabled: false, trophy_double: true }), '2026-10-14');
  assert.ok(!doubled.some(o => o.id === 'loyalty-rebook'));
  assert.ok(doubled.find(o => o.id === 'loyalty-punch').terms.includes('two punches'));
});

ok('turning both loyalty offers off leaves no loyalty promo', () => {
  const rows = live([], loyalty.normalizeSettings({ punch_enabled: false, rebook_enabled: false }), '2026-10-14');
  assert.deepStrictEqual(rows, []);
  assert.strictEqual(promos.bannerOffer(rows), null);
});

console.log('\nbanner, badge, checkout');

ok('the featured live promo is the banner, otherwise the first live one', () => {
  const plain = live([custom()], loyaltyOn, '2026-10-14');
  assert.strictEqual(promos.bannerOffer(plain).id, 'loyalty-punch');
  const featured = live([custom({ featured: true, id: 'p9', title: 'Featured week' })], loyaltyOn, '2026-10-14');
  assert.strictEqual(promos.bannerOffer(featured).id, 'p9');
  const expiredFeature = live([custom({ featured: true, ends_on: '2026-10-01' })], { punch_enabled: false, rebook_enabled: false }, '2026-10-14');
  assert.strictEqual(promos.bannerOffer(expiredFeature), null);
});

ok('a badge is only on the linked game, and a site-wide promo badges every game', () => {
  const rows = live([custom({ badge: '₱50 off' })], { punch_enabled: false, rebook_enabled: false }, '2026-10-14');
  assert.deepStrictEqual(promos.badgeFor(rows, 7), { text: '₱50 off', title: 'Elden week' });
  assert.strictEqual(promos.badgeFor(rows, 8), null);
  const wide = live([custom({ game_id: null, badge: '' })], { punch_enabled: false, rebook_enabled: false }, '2026-10-14');
  assert.strictEqual(promos.badgeFor(wide, 8).text, 'Promo');
  assert.strictEqual(promos.badgeFor(live([], loyaltyOn), 7), null);
});

ok('checkout names the game promo, and a known customer gets the loyalty lines', () => {
  const rows = live([custom()], loyaltyOn, '2026-10-14');
  const generic = promos.checkoutLines(rows, 7, null);
  assert.ok(generic.some(line => line.includes('₱50 off Elden Ring')));
  assert.ok(generic.some(line => line.includes('free 7-day')));
  assert.ok(!promos.checkoutLines(rows, 8, null).some(line => line.includes('Elden Ring')));
  const personal = promos.checkoutLines(rows, 8, {
    show: true,
    punchLine: "You're 2 rentals away from a free 7-day rental",
    rewardLine: '',
    rebookLine: 'Rebook by Oct 20, 2026 for ₱50 off.'
  });
  assert.ok(personal.includes("You're 2 rentals away from a free 7-day rental"));
  assert.ok(personal.includes('Rebook by Oct 20, 2026 for ₱50 off.'));
  assert.ok(!personal.some(line => line.includes('Every 5')));
});

ok('an order uses a promo only when that promo applies', () => {
  const rows = live([custom(), custom({ id: 'p2', title: 'All week', game_id: null, text: 'Site-wide.' })], loyaltyOn, '2026-10-14');
  const ids = promos.usedIds(rows, 7, { rebook: { eligible: true }, availablePunch: 0 });
  assert.ok(ids.includes('p1'));
  assert.ok(ids.includes('p2'));
  assert.ok(ids.includes('loyalty-rebook'));
  assert.ok(!ids.includes('loyalty-punch'));
  const other = promos.usedIds(rows, 8, null);
  assert.ok(!other.includes('p1'));
  assert.ok(other.includes('p2'));
  assert.deepStrictEqual(promos.usedIds(live([], { punch_enabled: false, rebook_enabled: false }), 7, null), []);
});

console.log('\nadmin save');

ok('a save keeps one featured promo and rejects a backwards date range', () => {
  const saved = promos.saveOffer([], {
    title: 'Weekend',
    text: 'Short text',
    terms: 'Terms here',
    starts_on: '2026-10-10',
    ends_on: '2026-10-12',
    enabled: 'on',
    game_id: '7',
    badge: 'Weekend',
    featured: 'on'
  }, { nextId: 3 });
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.offers[0].id, 'p3');
  assert.strictEqual(saved.offers[0].game_id, 7);
  assert.strictEqual(saved.offers[0].enabled, true);
  assert.strictEqual(saved.nextId, 4);
  const second = promos.saveOffer(saved.offers, {
    title: 'Next',
    text: 'Also on',
    terms: '',
    featured: 'on',
    enabled: 'on'
  }, { nextId: saved.nextId });
  assert.strictEqual(second.offers.filter(o => o.featured).length, 1);
  assert.strictEqual(second.offers.find(o => o.id === 'p3').featured, false);
  const bad = promos.saveOffer([], { title: 'X', text: 'Y', starts_on: '2026-10-20', ends_on: '2026-10-01' }, { nextId: 1 });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error, 'dates');
});

ok('editing and deleting leave the other promos alone', () => {
  const first = promos.saveOffer([], { title: 'A', text: 'a' }, { nextId: 1 });
  const second = promos.saveOffer(first.offers, { title: 'B', text: 'b' }, { nextId: first.nextId });
  const edited = promos.saveOffer(second.offers, { id: 'p1', title: 'A2', text: 'a2', enabled: 'on' }, { nextId: second.nextId });
  assert.strictEqual(edited.offers.find(o => o.id === 'p1').title, 'A2');
  assert.strictEqual(edited.offers.find(o => o.id === 'p2').title, 'B');
  const removed = promos.deleteOffer(edited.offers, 'p2');
  assert.deepStrictEqual(removed.map(o => o.id), ['p1']);
});

console.log('\ncounts');

ok('banner views dedupe per session per day, page views and orders do not', () => {
  const events = [];
  const a = promos.record(events, { kind: 'banner', promo_id: 'p1', session_id: 's1', date: '2026-10-14' });
  const b = promos.record(a.events, { kind: 'banner', promo_id: 'p1', session_id: 's1', date: '2026-10-14' });
  const c = promos.record(b.events, { kind: 'page', session_id: 's1', date: '2026-10-14' });
  const d = promos.record(c.events, { kind: 'page', session_id: 's1', date: '2026-10-14' });
  const e = promos.record(d.events, { kind: 'order', promo_id: 'p1', session_id: 's1', date: '2026-10-14' });
  const week = promos.stats(e.events, '2026-10-08');
  assert.deepStrictEqual(week, { banner: 1, page: 2, orders: 1 });
  assert.deepStrictEqual(promos.stats(e.events, '2026-10-15'), { banner: 0, page: 0, orders: 0 });
});

console.log('\n' + passed + ' assertions passed\n');
