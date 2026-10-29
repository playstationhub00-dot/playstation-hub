// Run: node scripts/test-seo.js
//
// Google should be able to tell pages apart: a real title and description, one
// canonical host, a sitemap, structured data, and a 404 for a slug that is not
// a game. Apex playstation-hub.com 301s to www. Unknown slugs do not.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const seo = require('../lib/seo');
const faqPages = require('../lib/faq-pages');

console.log('\ncanonical and apex');

ok('canonical is www, with the query string and a trailing slash removed', () => {
  assert.strictEqual(seo.canonicalUrl('/browse'), 'https://www.playstation-hub.com/browse');
  assert.strictEqual(seo.canonicalUrl('/browse/'), 'https://www.playstation-hub.com/browse');
  assert.strictEqual(seo.canonicalUrl('/browse?utm_source=google'), 'https://www.playstation-hub.com/browse');
  assert.strictEqual(seo.canonicalUrl('/'), 'https://www.playstation-hub.com');
  assert.strictEqual(seo.canonicalUrl('/game/elden-ring/'), 'https://www.playstation-hub.com/game/elden-ring');
});

ok('apex redirects to www and keeps the path and query', () => {
  assert.strictEqual(
    seo.apexRedirect({ host: 'playstation-hub.com', originalUrl: '/browse?utm_source=google' }),
    'https://www.playstation-hub.com/browse?utm_source=google'
  );
  assert.strictEqual(
    seo.apexRedirect({ host: 'playstation-hub.com', originalUrl: '/' }),
    'https://www.playstation-hub.com/'
  );
});

ok('the public railway hostname 301s to www, and private railway, localhost, and health checks do not', () => {
  assert.strictEqual(seo.apexRedirect({ host: 'www.playstation-hub.com', originalUrl: '/browse' }), null);
  assert.strictEqual(seo.apexRedirect({ host: 'localhost', originalUrl: '/' }), null);
  assert.strictEqual(seo.apexRedirect({ host: '127.0.0.1', originalUrl: '/' }), null);
  assert.strictEqual(
    seo.apexRedirect({ host: 'playstation-hub-production.up.railway.app', originalUrl: '/browse?utm_source=x' }),
    'https://www.playstation-hub.com/browse?utm_source=x'
  );
  assert.strictEqual(
    seo.apexRedirect({ host: 'playstation-hub-production.up.railway.app', originalUrl: '/' }),
    'https://www.playstation-hub.com/'
  );
  assert.strictEqual(seo.apexRedirect({ host: 'foo.railway.internal', originalUrl: '/' }), null);
  assert.strictEqual(seo.apexRedirect({ host: 'foo.railway.internal', originalUrl: '/health' }), null);
  assert.strictEqual(seo.apexRedirect({ host: 'playstation-hub-production.up.railway.app', originalUrl: '/health', userAgent: 'Mozilla/5.0' }), null);
  assert.strictEqual(seo.apexRedirect({ host: 'playstation-hub-production.up.railway.app', originalUrl: '/webhooks/paymongo' }), null);
  assert.strictEqual(seo.apexRedirect({ host: 'playstation-hub-production.up.railway.app', originalUrl: '/webhook?hub.mode=subscribe' }), null);
  assert.strictEqual(seo.apexRedirect({
    host: 'playstation-hub-production.up.railway.app', originalUrl: '/', userAgent: 'RailwayHealthCheck/1.0'
  }), null);
  assert.strictEqual(seo.apexRedirect({ host: 'playstation-hub.com', originalUrl: '/health', userAgent: 'Mozilla/5.0' }), null);
  assert.strictEqual(seo.apexRedirect({
    host: 'playstation-hub.com', originalUrl: '/', userAgent: 'RailwayHealthCheck/1.0'
  }), null);
});

ok('favicon type follows the file, so a png is not declared as svg', () => {
  assert.strictEqual(seo.faviconType('/favicon.svg'), 'image/svg+xml');
  assert.strictEqual(seo.faviconType('/uploads/favicon-custom.png'), 'image/png');
  assert.strictEqual(seo.faviconType('/favicon.ico'), 'image/x-icon');
  assert.strictEqual(seo.faviconType('/favicon.webp'), 'image/webp');
});

console.log('\ntitles, descriptions, json-ld');

const promo = { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 };
const elden = {
  title: 'Elden Ring', platform: 'PS5', cover_image: '/uploads/elden.png',
  nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899,
  non_trophy_slots: 2, trophy_slots: 1
};
const both = {
  title: 'Spider-Man', platform: 'PS4/PS5', cover_image: 'https://image.api.playstation.com/spider.png',
  nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549,
  non_trophy_slots: 1, trophy_slots: 0, ps4_primary_slots: 1
};

ok('the from-price is the cheapest discounted rent price', () => {
  assert.strictEqual(seo.fromPrice(elden, promo), 349);
  assert.strictEqual(seo.fromPrice(both, promo), 199);
  // 799 with 10% off is 719, still above the weekly price.
  assert.strictEqual(seo.fromPrice({ nt_price_7d: 0, nt_price_30d: 500, tr_price_7d: 0, tr_price_30d: 0 }, promo), 450);
});

ok('a game title names the rental, the real platform, and the from-price', () => {
  const page = seo.gamePage({ game: elden, promo, availability: { ntAvail: true, trAvail: false, ps4Avail: false, showPs4: false } });
  assert.strictEqual(page.title, 'Rent Elden Ring PS5 – from ₱349 | PlayStation Hub');
  assert.ok(page.title.length <= 60, page.title + ' (' + page.title.length + ')');
  assert.ok(!page.title.includes('Philippines'), 'a title over 60 characters drops Philippines');
  assert.ok(page.description.includes('Trophy'));
  assert.ok(page.description.includes('Non-Trophy'));
  assert.ok(page.description.includes('GCash'));
  assert.ok(page.description.includes('Maya'));
  assert.ok(page.description.includes('PayPal'));
  assert.ok(page.description.includes('Messenger'));
  assert.ok(page.description.includes('₱100 deposit on Trophy and PS4 Primary.'), page.description);
  assert.ok(page.description.length >= 80 && page.description.length <= 180, page.description + ' (' + page.description.length + ')');
  assert.strictEqual(page.heading, 'Rent Elden Ring for PS5 in the Philippines');
  assert.strictEqual(page.faqs.length, 0);
  assert.ok(!page.jsonLd.some(b => b['@type'] === 'FAQPage'));
  assert.strictEqual(page.canonicalPath, '/game/elden-ring');
  assert.strictEqual(page.image, '/uploads/elden.png');
  assert.strictEqual(page.intro, 'Rent Elden Ring for PS5 in the Philippines from ₱349.');
  const bothPage = seo.gamePage({ game: both, promo });
  assert.ok(bothPage.title.includes('PS4/PS5'));
  assert.ok(bothPage.title.includes('₱199'));
  assert.ok(bothPage.description.includes('PS4 Primary'), bothPage.description);
  assert.strictEqual(bothPage.heading, 'Rent Spider-Man for PS5 & PS4 in the Philippines');
  const short = seo.gamePage({
    game: { title: 'Hades', platform: 'PS5', nt_price_7d: 99, nt_price_30d: 199, tr_price_7d: 149, tr_price_30d: 299 },
    promo
  });
  assert.ok(short.title.includes('Philippines'), short.title);
  assert.ok(short.title.includes('PlayStation Hub'), short.title);
  const ps4only = seo.gamePage({
    game: { title: 'Old Game', platform: 'PS4', nt_price_7d: 149, nt_price_30d: 299, tr_price_7d: 199, tr_price_30d: 399 },
    promo
  });
  assert.strictEqual(ps4only.heading, 'Rent Old Game for PS4 in the Philippines');
  assert.ok(ps4only.description.includes('PS4 Primary'));
});

ok('an upcoming title says Reserve and uses the real from-price', () => {
  const page = seo.upcomingPage({
    game: Object.assign({ id: 5 }, both, { title: 'Phantom Blade', platform: 'PS5' }),
    promo
  });
  assert.strictEqual(page.title, 'Reserve Phantom Blade PS5 – from ₱199 | PlayStation Hub');
  assert.ok(page.description.includes('₱100 deposit on Trophy and PS4 Primary.'), page.description);
  assert.strictEqual(page.canonicalPath, '/upcoming/phantom-blade-5');
  assert.ok(page.intro.startsWith('Reserve Phantom Blade for PS5 in the Philippines from ₱199'));
});

ok('the home title and description name the brand without a catalogue price', () => {
  const home = seo.homePage({ games: [elden, both], promo, faqItems: faqPages.homeItems({ deposit: 100, lateFee: 20 }) });
  const desc = 'PlayStation Hub rents PS5 and PS4 digital games in the Philippines. Free game changes while you rent. Pay with GCash, Maya and PayPal. Order on Messenger.';
  assert.strictEqual(home.title, 'PlayStation Hub | Rent PS5 & PS4 Games in the Philippines');
  assert.strictEqual(home.description, desc);
  assert.ok(home.description.length >= 140 && home.description.length <= 165, home.description.length + ' ' + home.description);
  assert.ok(!/₱\d/.test(home.description), home.description);
  assert.ok(home.description.includes('Free game changes'));
  assert.ok(home.description.includes('GCash'));
  assert.ok(home.description.includes('Maya'));
  assert.ok(home.description.includes('PayPal'));
  assert.ok(home.description.includes('Messenger'));
  assert.ok(home.jsonLd.some(b => b['@type'] === 'FAQPage'));
});

ok('static pages have a title and a description near 150 characters', () => {
  ['browse', 'faq', 'promos', 'ps-plus', 'how-it-works', 'buy', 'terms', 'privacy'].forEach(key => {
    const page = seo.staticPage(key);
    assert.ok(page.title.includes('PlayStation Hub'), key);
    assert.ok(!page.title.includes('Playstation Hub'), key);
    assert.ok(page.title.length <= 65, key + ' title ' + page.title.length + ' ' + page.title);
    assert.ok(page.description.length >= 80 && page.description.length <= 180, key + ' ' + page.description.length);
    assert.strictEqual(page.canonicalPath, seo.STATIC_PATHS[key] || page.canonicalPath);
  });
  assert.strictEqual(seo.staticPage('browse').canonicalPath, '/browse');
  assert.strictEqual(seo.staticPage('ps-plus').canonicalPath, '/ps-plus');
  assert.strictEqual(seo.staticPage('how-it-works').canonicalPath, '/how-it-works');
  ['how-it-works', 'trophy-guide', 'psplus-vs-renting', 'guides'].forEach(key => {
    const page = seo.staticPage(key);
    assert.ok(page.title.length <= 60, key + ' title ' + page.title.length + ' ' + page.title);
    assert.ok(page.title.endsWith('| PlayStation Hub'), page.title);
    assert.ok(!page.title.includes('Playstation Hub'), page.title);
    assert.strictEqual(page.canonicalPath, seo.STATIC_PATHS[key]);
  });
  ['how-it-works', 'trophy-guide', 'psplus-vs-renting'].forEach(key => {
    const description = seo.staticPage(key).description;
    assert.ok(description.length >= 140 && description.length <= 155, key + ' ' + description.length + ' ' + description);
  });
});

ok('the five priority games use the brief titles and a visible FAQ', () => {
  const cases = [
    ['Ghost of Yotei', 249, 'Rent Ghost of Yotei PS5 Philippines – from ₱249 | PS Hub', 56],
    ['Resident Evil Requiem', 349, 'Rent Resident Evil Requiem PS5 Philippines – ₱349 | PS Hub', 58],
    ['007 First Light', 349, 'Rent 007 First Light PS5 Philippines – from ₱349 | PS Hub', 57],
    ['Crimson Desert', 349, 'Rent Crimson Desert PS5 Philippines – from ₱349 | PS Hub', 56],
    ['Battlefield 6', 249, 'Rent Battlefield 6 PS5 Philippines – from ₱249 | PS Hub', 55]
  ];
  cases.forEach(([title, weekly, expected, chars]) => {
    const page = seo.gamePage({
      game: { title, platform: 'PS5', nt_price_7d: weekly, nt_price_30d: 799, tr_price_7d: weekly + 50, tr_price_30d: 899 },
      promo
    });
    assert.strictEqual(page.title, expected);
    assert.strictEqual(page.title.length, chars, page.title);
    assert.ok(page.title.length <= 60);
    assert.ok(!page.description.includes('PS4 Primary'), page.description);
    assert.ok(page.description.includes('₱' + weekly + '/week'), page.description);
    assert.ok(page.description.length >= 80 && page.description.length <= 180, page.description.length + ' ' + page.description);
    assert.strictEqual(page.heading, 'Rent ' + title + ' for PS5 in the Philippines');
    assert.strictEqual(page.faqs.length, 6, title);
    const faqLd = page.jsonLd.find(b => b['@type'] === 'FAQPage');
    assert.ok(faqLd, title + ' missing FAQPage');
    assert.strictEqual(faqLd.mainEntity.length, 6);
    page.faqs.forEach((item, i) => {
      assert.strictEqual(faqLd.mainEntity[i].name, item.q);
      assert.strictEqual(faqLd.mainEntity[i].acceptedAnswer.text, item.text);
    });
    const product = page.jsonLd.find(b => b['@type'] === 'Product');
    assert.strictEqual(product.description, page.description);
    assert.ok(!product.offers.some(o => /PS4 Primary/.test(o.name)));
  });
  // A weekly discount changes the brief title's peso figure instead of leaving the old one.
  const discounted = seo.gamePage({
    game: { title: 'Ghost of Yotei', platform: 'PS5', nt_price_7d: 249, nt_price_30d: 549, tr_price_7d: 299, tr_price_30d: 649, discounts: { 7: 10 } },
    promo
  });
  assert.ok(discounted.title.includes('₱224'), discounted.title);
});

ok('game JSON-LD is a Product with PHP offers and a breadcrumb', () => {
  const page = seo.gamePage({
    game: elden, promo,
    availability: { ntAvail: true, trAvail: false, ps4Avail: false, showPs4: false, allUnavail: false }
  });
  const product = page.jsonLd.find(b => b['@type'] === 'Product');
  const crumbs = page.jsonLd.find(b => b['@type'] === 'BreadcrumbList');
  assert.ok(product);
  assert.strictEqual(product.name, 'Elden Ring');
  assert.ok(product.offers.length >= 2);
  product.offers.forEach(o => {
    assert.strictEqual(o.priceCurrency, 'PHP');
    assert.ok(Number(o.price) > 0);
    assert.ok(o.availability.startsWith('https://schema.org/'));
  });
  const weekly = product.offers.find(o => /Non-Trophy/.test(o.name) && /7/.test(o.name));
  assert.ok(weekly, 'missing weekly non-trophy offer');
  assert.strictEqual(weekly.price, '349');
  assert.strictEqual(weekly.availability, 'https://schema.org/InStock');
  const trophy = product.offers.find(o => /Trophy/.test(o.name) && !/Non-Trophy/.test(o.name) && /7/.test(o.name));
  assert.strictEqual(trophy.availability, 'https://schema.org/OutOfStock');
  assert.ok(crumbs.itemListElement.length >= 3);
  assert.strictEqual(crumbs.itemListElement[2].name, 'Elden Ring');
  const abs = seo.absoluteUrl('/uploads/elden.png');
  assert.strictEqual(abs, 'https://www.playstation-hub.com/uploads/elden.png');
  assert.strictEqual(seo.absoluteUrl('https://image.api.playstation.com/spider.png'), 'https://image.api.playstation.com/spider.png');
});

ok('a PS4/PS5 game offers PS4 Primary, and upcoming offers are preorder', () => {
  const page = seo.gamePage({
    game: both, promo,
    availability: { ntAvail: true, trAvail: false, ps4Avail: true, showPs4: true }
  });
  const product = page.jsonLd.find(b => b['@type'] === 'Product');
  assert.ok(product.offers.some(o => /PS4 Primary/.test(o.name)));
  const soon = seo.upcomingPage({ game: Object.assign({ id: 5, release_date: '2027-03-01' }, elden, { title: 'Phantom Blade' }), promo });
  const soonProduct = soon.jsonLd.find(b => b['@type'] === 'Product');
  assert.ok(soonProduct.offers.every(o => o.availability === 'https://schema.org/PreOrder'));
});

ok('FAQ JSON-LD is built from the same questions the page renders', () => {
  const items = faqPages.faqItems({
    hasPromos: false,
    paymentSentence: 'GCash or Maya for local customers · PayPal for international customers'
  });
  const questions = items.map(i => i.q);
  assert.ok(questions.some(q => /how does renting work/i.test(q)));
  assert.ok(questions.some(q => /trophy/i.test(q) && /ps4 primary/i.test(q)));
  const joined = items.map(i => i.text).join('\n');
  assert.ok(joined.includes('₱100'));
  assert.ok(joined.includes('Non-Trophy'));
  assert.ok(joined.includes('GCash'));
  assert.ok(joined.includes('Maya'));
  assert.ok(joined.includes('PayPal'));
  assert.ok(joined.includes('Unlimited FREE game changes while your rental is active (2-day cooldown between swaps, subject to slot availability).'));
  assert.ok(joined.includes('same price tier'));
  assert.ok(joined.includes('GTA VI'));
  assert.ok(joined.includes('Non-Trophy rentals have no late fees'));
  assert.ok(!joined.includes('Monthly is 10% off.'));
  const ld = seo.faqPage(items);
  assert.strictEqual(ld['@type'], 'FAQPage');
  assert.strictEqual(ld.mainEntity.length, items.length);
  ld.mainEntity.forEach((q, i) => {
    assert.strictEqual(q.name, items[i].q);
    assert.strictEqual(q.acceptedAnswer.text, items[i].text);
  });
  const home = faqPages.homeItems({ deposit: 100, lateFee: 20 });
  assert.ok(home.some(i => /PSN password/.test(i.q)));
  assert.ok(home.some(i => /₱100/.test(i.q)));
  assert.strictEqual(faqPages.homeItems({ deposit: 0, lateFee: 20 }).some(i => /deposit back/.test(i.q)), false);
  const trial = 'The free 3-hour trial (Non-Trophy) covers any game, PS Plus Deluxe included, as long as it\'s available at the time.';
  assert.ok(joined.includes(trial));
  assert.ok(home.find(i => i.q === 'Can I try a game before I pay?').text.includes(trial));
  assert.ok(joined.includes('The exception is our PS Plus Deluxe rental, which runs on a PS Plus subscription, so online play is included.'));
});

ok('PS Plus Deluxe is one public path, and its JSON-LD uses the prices it is given', () => {
  assert.strictEqual(seo.gamePath('Elden Ring'), '/game/elden-ring');
  assert.strictEqual(seo.gamePath('PS Plus Deluxe'), '/ps-plus');
  assert.strictEqual(seo.gamePath('PlayStation Plus Deluxe'), '/ps-plus');
  assert.strictEqual(seo.gamePath('Resident Evil 2 Deluxe Edition'), '/game/resident-evil-2-deluxe-edition');
  const blocks = seo.psplusJsonLd({
    prices: { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 },
    slots: { nt_slots: 1, tr_slots: 0 }
  });
  assert.ok(!blocks.some(b => b['@type'] === 'FAQPage'));
  const product = blocks.find(b => b['@type'] === 'Product');
  const crumbs = blocks.find(b => b['@type'] === 'BreadcrumbList');
  assert.strictEqual(product.name, 'PS Plus Deluxe');
  assert.strictEqual(product.url, 'https://www.playstation-hub.com/ps-plus');
  assert.deepStrictEqual(product.offers.map(o => [o.name, o.price, o.priceCurrency, o.availability]), [
    ['Non-Trophy · Weekly', '349', 'PHP', 'https://schema.org/InStock'],
    ['Non-Trophy · Monthly', '699', 'PHP', 'https://schema.org/InStock'],
    ['Trophy · Weekly', '399', 'PHP', 'https://schema.org/OutOfStock'],
    ['Trophy · Monthly', '799', 'PHP', 'https://schema.org/OutOfStock']
  ]);
  assert.deepStrictEqual(crumbs.itemListElement.map(c => c.name), ['Home', 'PS Plus']);
  assert.strictEqual(crumbs.itemListElement[0].item, 'https://www.playstation-hub.com');
  assert.strictEqual(crumbs.itemListElement[1].item, 'https://www.playstation-hub.com/ps-plus');
  blocks.forEach(b => assert.deepStrictEqual(JSON.parse(seo.jsonLdScript(b))['@type'], b['@type']));
  const stored = seo.psplusJsonLd({
    prices: { nt_price_7d: 111, nt_price_30d: 222, tr_price_7d: 333, tr_price_30d: 444 },
    slots: { nt_slots: 2, tr_slots: 3 }
  });
  assert.deepStrictEqual(stored.find(b => b['@type'] === 'Product').offers.map(o => o.price), ['111', '222', '333', '444']);
});

ok('site-wide graph is one OnlineStore and one WebSite', () => {
  const graph = seo.siteGraph();
  const org = graph.find(b => b['@type'] === 'OnlineStore');
  const site = graph.find(b => b['@type'] === 'WebSite');
  assert.strictEqual(graph.filter(b => b['@type'] === 'OnlineStore' || b['@type'] === 'Organization').length, 1);
  assert.strictEqual(graph.filter(b => b['@type'] === 'WebSite').length, 1);
  assert.strictEqual(org.name, 'PlayStation Hub');
  assert.strictEqual(org.alternateName, 'PS HUB');
  assert.strictEqual(org.url, 'https://www.playstation-hub.com/');
  assert.strictEqual(org.logo, 'https://www.playstation-hub.com/logo.svg');
  assert.ok(fs.existsSync(path.join(__dirname, '../public/logo.svg')));
  assert.deepStrictEqual(org.sameAs, ['https://facebook.com/PlaystationHub00']);
  assert.ok(!org.sameAs.some(u => /maps\.google|google\.com\/maps/i.test(u)));
  assert.deepStrictEqual(org.contactPoint, {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    url: 'https://m.me/PlaystationHub00',
    availableLanguage: ['English', 'Filipino']
  });
  assert.deepStrictEqual(org.areaServed, { '@type': 'Country', name: 'Philippines' });
  assert.strictEqual(site.name, 'PlayStation Hub');
  assert.strictEqual(site.alternateName, 'PS HUB');
  assert.strictEqual(site.url, 'https://www.playstation-hub.com/');
  const script = seo.jsonLdScript(org);
  assert.strictEqual(JSON.parse(script)['@type'], 'OnlineStore');
  assert.ok(!script.includes('<'), 'json-ld must not break out of a script tag');
});

console.log('\nsitemap, robots, attribution');

ok('sitemap is XML and lists every game, upcoming title, and public page', () => {
  const xml = seo.sitemapXml({
    games: [
      { path: '/game/elden-ring', lastmod: '2026-01-15T00:00:00.000Z' },
      { path: '/game/spider-man', lastmod: '' }
    ],
    upcoming: [{ path: '/upcoming/phantom-blade-5', lastmod: '2026-03-01T12:00:00.000Z' }]
  });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));
  assert.strictEqual((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
  assert.ok(xml.includes('<loc>https://www.playstation-hub.com/game/elden-ring</loc>'));
  assert.ok(xml.includes('<loc>https://www.playstation-hub.com/game/spider-man</loc>'));
  ['/guides', '/guides/trophy-vs-non-trophy-vs-ps4-primary', '/guides/ps-plus-deluxe-vs-renting'].forEach(p => {
    assert.ok(xml.includes('<loc>https://www.playstation-hub.com' + p + '</loc>'), p);
  });
  assert.ok(xml.includes('<loc>https://www.playstation-hub.com/upcoming/phantom-blade-5</loc>'));
  assert.ok(xml.includes('<lastmod>2026-01-15</lastmod>'));
  assert.ok(xml.includes('<lastmod>2026-03-01</lastmod>'));
  assert.ok(!xml.includes('<lastmod></lastmod>'));
  ['/', '/browse', '/faq', '/promos', '/ps-plus', '/how-it-works', '/buy', '/terms', '/privacy'].forEach(p => {
    const loc = p === '/' ? 'https://www.playstation-hub.com' : 'https://www.playstation-hub.com' + p;
    assert.ok(xml.includes('<loc>' + loc + '</loc>'), p);
  });
  seo.assertWellFormedXml(xml);
});

ok('robots.txt points crawlers at the sitemap and keeps admin out', () => {
  const txt = seo.robotsTxt();
  assert.ok(txt.includes('User-agent: *'));
  assert.ok(txt.includes('Disallow: /admin'));
  assert.ok(txt.includes('Disallow: /api/'));
  assert.ok(txt.includes('Disallow: /order/'));
  assert.ok(txt.includes('Sitemap: https://www.playstation-hub.com/sitemap.xml'));
  assert.ok(txt.indexOf('Disallow: /admin') < txt.indexOf('Sitemap:'));
});

ok('utm and referrer are kept on the first visit only', () => {
  const first = seo.attributionForRequest({
    query: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'launch', utm_content: 'ad' },
    referrer: 'https://www.google.com/search?q=ps5+rental',
    alreadyCaptured: false
  });
  assert.strictEqual(first.capture, true);
  assert.strictEqual(first.fields.utm_source, 'google');
  assert.strictEqual(first.fields.utm_medium, 'cpc');
  assert.strictEqual(first.fields.utm_campaign, 'launch');
  assert.strictEqual(first.fields.utm_content, 'ad');
  assert.strictEqual(first.fields.referrer, 'https://www.google.com/search');
  const again = seo.attributionForRequest({
    query: { utm_source: 'facebook' }, referrer: 'https://facebook.com/x', alreadyCaptured: true
  });
  assert.strictEqual(again.capture, false);
  const self = seo.attributionForRequest({
    query: {}, referrer: 'https://www.playstation-hub.com/browse', alreadyCaptured: false
  });
  assert.strictEqual(self.fields.referrer || '', '');
});

ok('traffic sources count one session once, from the first visit', () => {
  const rows = [
    { session_id: 'a', time: '2026-04-01T00:00:00.000Z', utm_source: 'google', utm_medium: 'cpc' },
    { session_id: 'a', time: '2026-04-01T00:05:00.000Z', path: '/browse' },
    { session_id: 'b', time: '2026-04-02T00:00:00.000Z', referrer: 'https://facebook.com/PlaystationHub00' },
    { session_id: 'c', time: '2026-04-03T00:00:00.000Z' }
  ];
  const sources = seo.trafficSources(rows);
  const byLabel = Object.fromEntries(sources.map(s => [s.label, s.count]));
  assert.strictEqual(byLabel['google / cpc'], 1);
  assert.strictEqual(byLabel.facebook, 1);
  assert.strictEqual(byLabel.Direct, 1);
});

ok('measurement id and site verification are rendered only when they look real', () => {
  assert.strictEqual(seo.cleanGa4Id('G-ABC123XYZ'), 'G-ABC123XYZ');
  assert.strictEqual(seo.cleanGa4Id(''), '');
  assert.strictEqual(seo.cleanGa4Id('not an id'), '');
  assert.strictEqual(seo.cleanSiteVerification('abcDEF123_-'), 'abcDEF123_-');
  assert.strictEqual(seo.cleanSiteVerification('<script>'), '');
});

console.log('\npages');

const PORT = 4792;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-'));
const prices = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 2, trophy_slots: 1 };
function game(id, title, extra) {
  return Object.assign({
    id, title, platform: 'PS5', genre: 'Action', cover_image: '/uploads/' + id + '.png',
    renters: 1, created_at: '2026-01-15T00:00:00.000Z'
  }, prices, extra || {});
}
const GAMES = [
  game(1, 'Elden Ring', { nt_price_7d: 349 }),
  game(2, 'Spider-Man', { platform: 'PS4/PS5', nt_price_7d: 199, nt_price_30d: 449, tr_price_7d: 249, tr_price_30d: 549, ps4_primary_slots: 1, cover_image: 'https://image.api.playstation.com/spider.png' }),
  game(3, 'Resident Evil Remake Trilogy'),
  game(4, 'PS Plus Deluxe', { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799, non_trophy_slots: 1, trophy_slots: 1 }),
  game(6, 'Ghost of Yotei', { nt_price_7d: 249, nt_price_30d: 549, tr_price_7d: 299, tr_price_30d: 649 }),
  game(7, 'Resident Evil Requiem'),
  game(8, '007 First Light'),
  game(9, 'Crimson Desert'),
  game(10, 'Battlefield 6', { nt_price_7d: 249, nt_price_30d: 549, tr_price_7d: 299, tr_price_30d: 649 }),
  game(11, 'Calisto Protocol'),
  game(12, 'Khazan The First Berseker'),
  game(13, 'Assasins Creed Shadows'),
  game(14, 'Assasins Creed Shadows w/ DLC'),
  game(15, "Assassin's Creed Black Flag Resynced")
];
const UPCOMING = [
  { id: 5, title: 'Phantom Blade', platform: 'PS5', genre: 'Action', release_date: '2027-03-01', cover_image: '/uploads/phantom.png', created_at: '2026-03-01T00:00:00.000Z', non_trophy_slots: 2, trophy_slots: 1, nt_price_7d: 299, nt_price_30d: 699, tr_price_7d: 349, tr_price_30d: 799 }
];

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  games: GAMES, upcoming: UPCOMING, nextId: 16, nextUpcomingId: 6,
  psplus_prices: { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 },
  psplus_slots: { nt_slots: 1, tr_slots: 1, ps4_slots: 0 },
  psplus_popular: [
    { id: 1, title: 'Ghost of Tsushima', platform: 'PS5', rank: 1, cover_image: '' }
  ],
  customers: [], visitors: [], migrations: ['genre-by-slug-2026-10-14', 'theme-presets-2026-10-29']
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.GA4_MEASUREMENT_ID = 'G-TEST1234';
process.env.GOOGLE_SITE_VERIFICATION = 'verifytoken123';

function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(p, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: '127.0.0.1', port: PORT, path: p, timeout: 20000,
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0' }, headers || {})
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out: ' + p)); });
  });
}

function jsonLd(html) {
  const blocks = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) blocks.push(JSON.parse(m[1]));
  return blocks;
}

function titleOf(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m ? m[1] : '';
}

function canonicalOf(html) {
  const m = html.match(/<link rel="canonical" href="([^"]+)"/);
  return m ? m[1] : '';
}

const PAGES = [
  ['/', 'PlayStation Hub | Rent PS5 &amp; PS4 Games in the Philippines'],
  ['/browse', 'Rent PS5'],
  ['/faq', 'FAQ'],
  ['/promos', 'Promos'],
  ['/ps-plus', 'PS Plus'],
  ['/how-it-works', 'How'],
  ['/buy', 'Buy'],
  ['/terms', 'Terms'],
  ['/privacy', 'Privacy']
];

ok('the three rental guides use live prices and confirmed policy lines', () => {
  const guidePages = require('../lib/guide-pages');
  const policy = require('../lib/policy-copy');
  const promos = require('../lib/promos');
  const ctx = {
    deposit: 100,
    lateFee: 20,
    monthlyPromo: null,
    games: GAMES,
    upcoming: UPCOMING,
    promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100, late_fee_per_day: 20 },
    psplusPrices: { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 },
    loyaltyOffers: promos.loyaltyOffers(null),
    psplusNames: [],
    popularTitles: ['Ghost of Tsushima']
  };
  const how = guidePages.build('how', ctx);
  const trophy = guidePages.build('trophy', ctx);
  const psplus = guidePages.build('psplus', ctx);
  [how, trophy, psplus].forEach(model => {
    assert.deepStrictEqual(guidePages.issues(model), [], model.key + ' ' + guidePages.issues(model).join(' | '));
    assert.strictEqual(model.canonicalPath.startsWith('/'), true);
    assert.ok(model.jsonLd.some(b => b['@type'] === 'FAQPage'));
    assert.ok(model.jsonLd.some(b => b['@type'] === 'BreadcrumbList'));
    const faqLd = model.jsonLd.find(b => b['@type'] === 'FAQPage');
    model.faqs.forEach((item, i) => {
      assert.strictEqual(faqLd.mainEntity[i].acceptedAnswer.text, item.text);
    });
  });
  assert.strictEqual(how.title, 'How to Rent PS5 Games in the Philippines | PlayStation Hub');
  assert.strictEqual(how.h1, 'How to rent PS5 games in the Philippines (step by step)');
  assert.ok(how.jsonLd.some(b => b['@type'] === 'HowTo'));
  const howto = how.jsonLd.find(b => b['@type'] === 'HowTo');
  assert.strictEqual(howto.step.length, 10);
  howto.step.forEach((step, i) => assert.strictEqual(step.text, how.sections.find(s => s.steps).steps.filter(s => s.id)[i].text));
  const swap = how.faqs.find(f => f.q === 'Can I change games during my rental?');
  assert.strictEqual(swap.text, policy.SWAP_LINE + ' ' + policy.SWAP_TIER);
  const trial = how.faqs.find(f => f.q === 'Can I try a game before I pay?');
  assert.strictEqual(trial.text, policy.TRIAL_ANSWER);
  assert.ok(!guidePages.collectText(how).includes('always 10% off'));
  assert.ok(how.answer.text.includes('₱') === false);
  assert.strictEqual(trophy.title, 'Trophy vs Non-Trophy vs PS4 Primary Guide | PlayStation Hub');
  assert.strictEqual(trophy.h1, 'Trophy vs Non-Trophy vs PS4 Primary: which rental account is right for you?');
  assert.strictEqual(trophy.jsonLd.find(b => b['@type'] === 'Article').inLanguage, 'en-PH');
  assert.ok(guidePages.collectText(trophy).includes('₱199'));
  assert.ok(guidePages.collectText(trophy).includes('Spider-Man'));
  assert.strictEqual(psplus.title, 'PS Plus Deluxe vs Renting (Philippines) | PlayStation Hub');
  assert.strictEqual(psplus.h1, 'PS Plus Deluxe vs renting games: which is better for you?');
  assert.strictEqual(psplus.jsonLd.find(b => b['@type'] === 'Article').inLanguage, 'en');
  assert.ok(!psplus.jsonLd.some(b => b['@type'] === 'Product' || b['@type'] === 'Offer'));
  assert.ok(guidePages.collectText(psplus).includes('₱349'));
  assert.ok(guidePages.collectText(psplus).includes('₱699'));
  assert.ok(!guidePages.collectText(psplus).includes('not in our PS Plus Deluxe list'));
  const promoOn = guidePages.build('how', Object.assign({}, ctx, { monthlyPromo: { pct: 10 } }));
  assert.ok(guidePages.collectText(promoOn).includes('Monthly is 10% off right now (current promo, can end).'));
  assert.ok(!guidePages.collectText(promoOn).includes('always 10% off'));
  assert.deepStrictEqual(guidePages.issues(promoOn), []);
});

async function main() {
  require('../server.js');
  const deadline = Date.now() + 20000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('/browse'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 20s');

  await okAsync('every public page type has a title, description, canonical, and social tags', async () => {
    for (const [p, titleBit] of PAGES) {
      const res = await call(p + '?x=1');
      assert.strictEqual(res.status, 200, p);
      const title = titleOf(res.body);
      assert.ok(title.includes('PlayStation Hub'), p + ' title ' + title);
      assert.ok(!res.body.includes('Playstation Hub'), p + ' still says Playstation Hub');
      assert.ok(title.includes(titleBit) || res.body.includes(titleBit), p + ' ' + title);
      const canon = canonicalOf(res.body);
      const expect = p === '/' ? 'https://www.playstation-hub.com' : 'https://www.playstation-hub.com' + p;
      assert.strictEqual(canon, expect, p);
      assert.ok(!canon.includes('?'), p);
      assert.ok(res.body.includes('name="description"'), p);
      assert.ok(res.body.includes('property="og:title"'), p);
      assert.ok(res.body.includes('property="og:description"'), p);
      assert.ok(res.body.includes('property="og:image"'), p);
      assert.ok(res.body.includes('property="og:url"'), p);
      assert.ok(res.body.includes('property="og:type"'), p);
      assert.ok(res.body.includes('property="og:site_name"'), p);
      assert.ok(res.body.includes('name="twitter:card"'), p);
      assert.ok(res.body.includes('PlayStation Hub is an independent rental shop, not affiliated with Sony Interactive Entertainment.'), p);
      assert.ok(res.body.includes('content="verifytoken123"'), p);
      jsonLd(res.body).forEach(b => assert.ok(b['@type'] || b['@graph'], p));
    }
  });

  await okAsync('the homepage title, description, H1, and store JSON-LD match the brand search brief', async () => {
    const home = await call('/');
    const desc = 'PlayStation Hub rents PS5 and PS4 digital games in the Philippines. Free game changes while you rent. Pay with GCash, Maya and PayPal. Order on Messenger.';
    assert.strictEqual(titleOf(home.body), 'PlayStation Hub | Rent PS5 &amp; PS4 Games in the Philippines');
    assert.strictEqual(home.headers['cache-control'], 'private, no-cache');
    assert.ok(home.body.includes('<meta name="description" content="' + desc + '">'));
    assert.ok(home.body.includes('<meta property="og:description" content="' + desc + '">'));
    assert.ok(home.body.includes('<meta name="twitter:description" content="' + desc + '">'));
    const h1s = home.body.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) || [];
    assert.strictEqual(h1s.length, 1, h1s.join('\n'));
    assert.ok(h1s[0].includes('PlayStation Hub'));
    assert.ok(h1s[0].includes('Rent the Latest'));
    assert.ok(h1s[0].includes('PS5 &amp; PS4'));
    const blocks = jsonLd(home.body);
    const org = blocks.find(b => b['@type'] === 'OnlineStore');
    const site = blocks.find(b => b['@type'] === 'WebSite');
    assert.ok(org, 'missing OnlineStore');
    assert.strictEqual(blocks.filter(b => b['@type'] === 'OnlineStore' || b['@type'] === 'Organization').length, 1);
    assert.strictEqual(org.name, 'PlayStation Hub');
    assert.strictEqual(org.alternateName, 'PS HUB');
    assert.strictEqual(org.url, 'https://www.playstation-hub.com/');
    assert.strictEqual(org.logo, 'https://www.playstation-hub.com/logo.svg');
    assert.deepStrictEqual(org.sameAs, ['https://facebook.com/PlaystationHub00']);
    assert.deepStrictEqual(org.contactPoint, {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      url: 'https://m.me/PlaystationHub00',
      availableLanguage: ['English', 'Filipino']
    });
    assert.deepStrictEqual(org.areaServed, { '@type': 'Country', name: 'Philippines' });
    assert.ok(site, 'missing WebSite');
    assert.strictEqual(blocks.filter(b => b['@type'] === 'WebSite').length, 1);
    assert.strictEqual(site.name, 'PlayStation Hub');
    assert.strictEqual(site.alternateName, 'PS HUB');
    assert.strictEqual(site.url, 'https://www.playstation-hub.com/');
    assert.strictEqual(canonicalOf(home.body), 'https://www.playstation-hub.com');
    assert.ok(!/name="robots"[^>]*noindex/i.test(home.body));
    assert.ok(!home.headers['x-robots-tag']);
    ['/browse', '/ps-plus', '/how-it-works', '/faq'].forEach(href => {
      assert.ok(home.body.includes('<a href="' + href + '"'), 'missing crawlable link ' + href);
    });
  });

  await okAsync('a game page title, intro, cover image, and product data come from the catalogue', async () => {
    const res = await call('/game/elden-ring?utm_source=google');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(titleOf(res.body), 'Rent Elden Ring PS5 – from ₱349 | PlayStation Hub');
    assert.ok(res.body.includes('<h1 class="usd-title">Elden Ring</h1>'));
    assert.strictEqual((res.body.match(/<h1\b/g) || []).length, 1);
    assert.ok(!res.body.includes('class="seo-intro"'));
    assert.ok(res.body.includes('id="price-7">₱349'));
    assert.ok(res.body.includes('id="price-30"><span class="gd-dur-price-orig">₱799</span> ₱719'));
    assert.ok(!jsonLd(res.body).some(b => b['@type'] === 'FAQPage'));
    const eldenDesc = (res.body.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
    assert.ok(eldenDesc.includes('₱100 deposit on Trophy and PS4 Primary.'), eldenDesc);
    assert.strictEqual(canonicalOf(res.body), 'https://www.playstation-hub.com/game/elden-ring');
    assert.ok(eldenDesc.includes('Rent Elden Ring for PS5 in the Philippines from ₱349'), eldenDesc);
    assert.ok(res.body.includes('property="og:description" content="' + eldenDesc + '"'));
    assert.ok(!res.body.includes('Unlimited FREE game changes while your rental is active (2-day cooldown between swaps, subject to slot availability).'));
    assert.ok(res.body.includes('property="og:image" content="https://www.playstation-hub.com/uploads/1.png"'));
    assert.ok(/<img[^>]*class="gd-cover gdh-poster"[^>]*width="/.test(res.body) || /<img[^>]*width="[^"]*"[^>]*class="gd-cover gdh-poster"/.test(res.body));
    const blocks = jsonLd(res.body);
    const product = blocks.find(b => b['@type'] === 'Product');
    assert.ok(product, 'missing Product');
    assert.ok(product.offers.some(o => o.priceCurrency === 'PHP' && o.price === '349'));
    assert.ok(product.description.includes('₱100 deposit on Trophy and PS4 Primary.'));
    assert.ok(!product.offers.some(o => /PS4 Primary/.test(o.name)));
    assert.ok(blocks.some(b => b['@type'] === 'BreadcrumbList'));
    assert.ok(blocks.some(b => b['@type'] === 'OnlineStore'));
    const bothRes = await call('/game/spider-man');
    assert.ok(titleOf(bothRes.body).includes('PS4/PS5'));
    assert.ok(titleOf(bothRes.body).includes('₱199'));
    assert.ok(bothRes.body.includes('https://image.api.playstation.com/spider.png'));
    assert.ok(bothRes.body.includes('<h1 class="usd-title">Spider-Man</h1>'));
    assert.ok(!bothRes.body.includes('class="seo-intro"'));
    assert.ok(bothRes.body.includes('id="price-7">₱199'));
    const spiderDesc = (bothRes.body.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
    assert.ok(spiderDesc.includes('PS4 Primary'), spiderDesc);
    const spiderProduct = jsonLd(bothRes.body).find(b => b['@type'] === 'Product');
    const ps4Offer = spiderProduct.offers.find(o => /PS4 Primary/.test(o.name) && /7/.test(o.name));
    assert.strictEqual(ps4Offer.price, '249');
  });

  await okAsync('priority game pages render the brief title, FAQ, and prices without JavaScript', async () => {
    const pages = [
      ['/game/ghost-of-yotei', 'Rent Ghost of Yotei PS5 Philippines – from ₱249 | PS Hub', 'Ghost of Yotei', '₱249'],
      ['/game/resident-evil-requiem', 'Rent Resident Evil Requiem PS5 Philippines – ₱349 | PS Hub', 'Resident Evil Requiem', '₱349'],
      ['/game/007-first-light', 'Rent 007 First Light PS5 Philippines – from ₱349 | PS Hub', '007 First Light', '₱349'],
      ['/game/crimson-desert', 'Rent Crimson Desert PS5 Philippines – from ₱349 | PS Hub', 'Crimson Desert', '₱349'],
      ['/game/battlefield-6', 'Rent Battlefield 6 PS5 Philippines – from ₱249 | PS Hub', 'Battlefield 6', '₱249']
    ];
    for (const [p, title, h1, weekly] of pages) {
      const res = await call(p);
      assert.strictEqual(res.status, 200, p);
      assert.strictEqual(titleOf(res.body), title);
      assert.ok(title.length >= 51 && title.length <= 58, title + ' ' + title.length);
      assert.ok(res.body.includes('<h1 class="usd-title">' + h1 + '</h1>'), h1);
      assert.strictEqual((res.body.match(/<h1\b/g) || []).length, 1, p);
      assert.ok(!res.body.includes('class="seo-intro"'), p);
      assert.ok(!res.body.includes('<h1 class="usd-title">Rent '), p);
      assert.ok(res.body.includes('id="price-7">' + weekly), p);
      assert.ok(!res.body.includes('id="price-7">—'), p);
      assert.ok(!res.body.includes('id="price-30">—'), p);
      const desc = (res.body.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
      const decoded = desc.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      assert.ok(!decoded.includes('PS4 Primary'), decoded);
      assert.ok(decoded.includes(weekly + '/week'), decoded);
      const blocks = jsonLd(res.body);
      const faqLd = blocks.find(b => b['@type'] === 'FAQPage');
      assert.ok(faqLd && faqLd.mainEntity.length === 6, p);
      faqLd.mainEntity.forEach(q => {
        assert.ok(res.body.includes(q.name), q.name);
        const encoded = q.acceptedAnswer.text
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        assert.ok(res.body.includes(encoded), q.name);
      });
      JSON.parse(JSON.stringify(faqLd));
    }
  });

  await okAsync('an upcoming page says Reserve and an unknown slug is a real 404', async () => {
    const soon = await call('/upcoming/phantom-blade-5');
    assert.strictEqual(soon.status, 200);
    assert.ok(titleOf(soon.body).startsWith('Reserve Phantom Blade'));
    assert.strictEqual(canonicalOf(soon.body), 'https://www.playstation-hub.com/upcoming/phantom-blade-5');
    const product = jsonLd(soon.body).find(b => b['@type'] === 'Product');
    assert.ok(product.offers.every(o => o.availability === 'https://schema.org/PreOrder'));
    const missing = await call('/game/not-a-real-game');
    assert.strictEqual(missing.status, 404);
    assert.ok(!missing.headers.location);
    assert.ok(missing.body.includes('href="/browse"'));
    assert.ok(missing.body.includes('noindex'));
    const missingSoon = await call('/upcoming/not-a-real-game');
    assert.strictEqual(missingSoon.status, 404);
    assert.ok(missingSoon.body.includes('href="/browse"'));
  });

  await okAsync('the PS Plus Deluxe game URL 301s to /ps-plus, which carries the stored prices', async () => {
    const old = await call('/game/ps-plus-deluxe?utm_source=google');
    assert.strictEqual(old.status, 301);
    assert.strictEqual(old.headers.location, '/ps-plus?utm_source=google');
    const byId = await call('/game/4');
    assert.strictEqual(byId.status, 301);
    assert.strictEqual(byId.headers.location, '/ps-plus');
    const page = await call('/ps-plus');
    assert.strictEqual(page.status, 200);
    assert.strictEqual(canonicalOf(page.body), 'https://www.playstation-hub.com/ps-plus');
    assert.ok(page.body.includes('Online play included'));
    assert.ok(!page.body.includes('/game/ps-plus-deluxe'));
    const blocks = jsonLd(page.body);
    blocks.forEach(b => assert.ok(b['@type']));
    assert.ok(!blocks.some(b => b['@type'] === 'FAQPage'));
    const product = blocks.find(b => b['@type'] === 'Product');
    assert.deepStrictEqual(product.offers.map(o => o.price), ['349', '699', '399', '799']);
    product.offers.forEach(o => assert.strictEqual(o.priceCurrency, 'PHP'));
    const crumbs = blocks.find(b => b['@type'] === 'BreadcrumbList');
    assert.deepStrictEqual(crumbs.itemListElement.map(c => c.name), ['Home', 'PS Plus']);
    const index = JSON.parse((await call('/api/search-index')).body);
    assert.ok(index.some(e => e.t === 'PS Plus Deluxe' && e.u === '/ps-plus'));
    assert.ok(index.some(e => e.t === 'Ghost of Tsushima' && e.u === '/ps-plus' && e.y === 'psplus'));
    assert.ok(!index.some(e => String(e.u).includes('/game/ps-plus-deluxe')));
  });

  await okAsync('typo game slugs 301 to the corrected URL and the new URL is canonical', async () => {
    const hops = [
      ['/game/resident-evil-remake-triology', '/game/resident-evil-remake-trilogy', 'Resident Evil Remake Trilogy'],
      ['/game/assasins-creed-shadows', '/game/assassins-creed-shadows', 'Assassins Creed Shadows'],
      ['/game/assassin-s-creed-shadows?utm=old', '/game/assassins-creed-shadows?utm=old', 'Assassins Creed Shadows'],
      ['/game/assasins-creed-shadows-w-dlc', '/game/assassins-creed-shadows-w-dlc', 'Assassins Creed Shadows w/ DLC'],
      ['/game/calisto-protocol', '/game/callisto-protocol', 'Callisto Protocol'],
      ['/game/khazan-the-first-berseker', '/game/khazan-the-first-berserker', 'Khazan The First Berserker']
    ];
    for (const [from, location, h1] of hops) {
      const old = await call(from);
      assert.strictEqual(old.status, 301, from);
      assert.strictEqual(old.headers.location, location, from);
      const pathOnly = location.split('?')[0];
      const page = await call(pathOnly);
      assert.strictEqual(page.status, 200, pathOnly);
      assert.strictEqual(canonicalOf(page.body), 'https://www.playstation-hub.com' + pathOnly);
      assert.ok(page.body.includes('<h1 class="usd-title">' + h1 + '</h1>'), h1);
      assert.ok(!page.headers.location);
    }
    const flag = await call('/game/assassin-s-creed-black-flag-resynced');
    assert.strictEqual(flag.status, 200);
    assert.strictEqual(canonicalOf(flag.body), 'https://www.playstation-hub.com/game/assassin-s-creed-black-flag-resynced');
  });

  await okAsync('catalogue prices are in the server-rendered HTML', async () => {
    const home = await call('/');
    const browse = await call('/browse');
    const elden = await call('/game/elden-ring');
    assert.strictEqual(home.status, 200);
    assert.strictEqual(browse.status, 200);
    assert.ok(home.body.includes('class="gc2-price"'), 'home cards omit the price element');
    assert.ok(/from <b>₱\d+/.test(home.body), 'home card price is not in the HTML');
    assert.ok(browse.body.includes('class="gc2-price"'));
    assert.ok(/from <b>₱199/.test(browse.body), 'browse is missing the Spider-Man from-price');
    assert.ok(browse.body.includes('class="cs-price"'));
    assert.ok(/from <b>₱\d+/.test(browse.body));
    assert.ok(elden.body.includes('id="phAmount"'));
    assert.ok(elden.body.includes('>₱349<') || elden.body.includes('>₱349</span>'));
    assert.ok(elden.body.includes('id="price-7">₱349'));
    assert.ok(elden.body.includes('id="price-30">'));
    const soon = await call('/upcoming/phantom-blade-5');
    assert.ok(/from <b>₱\d+/.test(browse.body));
    assert.strictEqual(soon.status, 200);
  });

  await okAsync('faq and the homepage FAQ blocks match their JSON-LD, without an unconfirmed swap claim', async () => {
    const faq = await call('/faq');
    const faqLd = jsonLd(faq.body).find(b => b['@type'] === 'FAQPage');
    assert.ok(faqLd.mainEntity.length >= 8);
    const names = faqLd.mainEntity.map(q => q.name).join('\n');
    assert.ok(/how does renting work/i.test(names));
    assert.ok(/PS4 Primary/.test(faq.body));
    assert.ok(faq.body.includes('₱100'));
    faqLd.mainEntity.forEach(q => {
      assert.ok(faq.body.includes(q.name), q.name);
      assert.ok(q.name !== 'Can I change games during my rental?' || q.acceptedAnswer.text.includes('Unlimited FREE game changes while your rental is active (2-day cooldown between swaps, subject to slot availability).'));
      assert.ok(!/unlimited swap of games/i.test(q.acceptedAnswer.text));
    });
    const home = await call('/');
    const homeLd = jsonLd(home.body).find(b => b['@type'] === 'FAQPage');
    assert.ok(homeLd.mainEntity.length >= 4);
    homeLd.mainEntity.forEach(q => assert.ok(home.body.includes(q.name), q.name));
    assert.strictEqual(titleOf(home.body), 'PlayStation Hub | Rent PS5 &amp; PS4 Games in the Philippines');
  });

  await okAsync('sitemap lists every catalogue game and robots.txt is served by the app', async () => {
    const map = await call('/sitemap.xml');
    assert.strictEqual(map.status, 200);
    assert.ok(/xml/.test(map.headers['content-type']));
    seo.assertWellFormedXml(map.body);
    GAMES.forEach(g => {
      const slug = seo.slug(g.title);
      if (g.title === 'PS Plus Deluxe') {
        assert.ok(!map.body.includes('/game/' + slug), 'duplicate PS Plus URL stays out of the sitemap');
        return;
      }
      assert.ok(map.body.includes('https://www.playstation-hub.com/game/' + slug), g.title + ' ' + slug);
    });
    ['/game/assasins-creed-shadows', '/game/assasins-creed-shadows-w-dlc', '/game/calisto-protocol', '/game/khazan-the-first-berseker', '/game/resident-evil-remake-triology', '/game/assassin-s-creed-shadows'].forEach(old => {
      assert.ok(!map.body.includes('https://www.playstation-hub.com' + old + '<'), old);
      assert.ok(!map.body.includes(old + '</loc>'), old);
    });
    const searchIndex = JSON.parse((await call('/api/search-index')).body);
    assert.ok(searchIndex.some(e => e.t === 'Callisto Protocol' && e.u === '/game/callisto-protocol'));
    assert.ok(searchIndex.some(e => e.t === 'Assassins Creed Shadows' && e.u === '/game/assassins-creed-shadows'));
    assert.ok(!searchIndex.some(e => /assasins|calisto|berseker|triology/.test(String(e.u))));
    assert.ok(map.body.includes('https://www.playstation-hub.com/upcoming/phantom-blade-5'));
    assert.ok(map.body.includes('<lastmod>2026-01-15</lastmod>'));
    assert.strictEqual(map.headers['cache-control'], 'public, max-age=300');
    const robots = await call('/robots.txt');
    assert.strictEqual(robots.status, 200);
    assert.ok(robots.body.includes('User-agent: *'));
    assert.ok(robots.body.includes('Disallow: /admin'));
    assert.ok(robots.body.includes('Disallow: /api/'));
    assert.ok(robots.body.includes('Disallow: /order/'));
    assert.ok(robots.body.includes('Sitemap: https://www.playstation-hub.com/sitemap.xml'));
    const index = await call('/api/search-index');
    assert.strictEqual(index.status, 200);
    assert.strictEqual(index.headers['cache-control'], 'public, max-age=300');
  });

  await okAsync('apex and the railway hostname 301 to www; local, private, and probes do not', async () => {
    const apex = await call('/browse?utm_source=google', { Host: 'playstation-hub.com' });
    assert.strictEqual(apex.status, 301);
    assert.strictEqual(apex.headers.location, 'https://www.playstation-hub.com/browse?utm_source=google');
    const local = await call('/browse', { Host: 'localhost' });
    assert.strictEqual(local.status, 200);
    const railway = await call('/browse?utm_source=x', { Host: 'playstation-hub-production.up.railway.app' });
    assert.strictEqual(railway.status, 301);
    assert.strictEqual(railway.headers.location, 'https://www.playstation-hub.com/browse?utm_source=x');
    const internal = await call('/', { Host: 'foo.railway.internal' });
    assert.notStrictEqual(internal.status, 301);
    const probe = await call('/', { Host: 'playstation-hub-production.up.railway.app', 'User-Agent': 'RailwayHealthCheck/1.0' });
    assert.notStrictEqual(probe.status, 301);
    const hook = await call('/webhooks/paymongo', { Host: 'playstation-hub-production.up.railway.app' });
    assert.notStrictEqual(hook.status, 301);
    const health = await call('/health', { Host: 'playstation-hub.com', 'User-Agent': 'RailwayHealthCheck/1.0' });
    assert.notStrictEqual(health.status, 301);
  });

  await okAsync('admin pages are noindex and GA4 renders only from the env id', async () => {
    const login = await call('/admin/login');
    assert.strictEqual(login.status, 200);
    assert.ok(/noindex/.test(login.body));
    const home = await call('/');
    assert.ok(home.body.includes('G-TEST1234'));
    assert.ok(home.body.includes('googletagmanager.com/gtag/js'));
    assert.ok(home.body.includes("fbq('init', '2184795349041848')"));
  });

  await okAsync('the first visit stores utm and referrer, and a later visit in that session does not replace them', async () => {
    const landing = await call('/?utm_source=google&utm_medium=cpc&utm_campaign=launch&utm_content=ad1', {
      Referer: 'https://www.google.com/search?q=ps5+rental'
    });
    assert.strictEqual(landing.status, 200);
    const cookie = (landing.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    assert.ok(/ph_attr=/.test(cookie), 'first visit did not mark attribution');
    await call('/browse', { Cookie: cookie, Referer: 'https://facebook.com/later' });
    const stored = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
    const mine = (stored.visitors || []).filter(v => v.utm_campaign === 'launch' || (v.referrer && String(v.referrer).includes('facebook')));
    assert.strictEqual(mine.length, 1);
    assert.strictEqual(mine[0].utm_source, 'google');
    assert.strictEqual(mine[0].utm_medium, 'cpc');
    assert.strictEqual(mine[0].utm_campaign, 'launch');
    assert.strictEqual(mine[0].utm_content, 'ad1');
    assert.ok(String(mine[0].referrer).includes('google.com'));
    const sources = seo.trafficSources(stored.visitors);
    assert.ok(sources.some(s => s.label === 'google / cpc' && s.count >= 1));
  });

  await okAsync('rental guides return 200 with one H1, canonical, valid JSON-LD, and sitemap entries', async () => {
    const guidePages = require('../lib/guide-pages');
    const expected = [
      {
        path: '/how-it-works',
        title: 'How to Rent PS5 Games in the Philippines | PlayStation Hub',
        h1: 'How to rent PS5 games in the Philippines (step by step)',
        types: ['HowTo', 'FAQPage', 'BreadcrumbList', 'WebPage']
      },
      {
        path: '/guides/trophy-vs-non-trophy-vs-ps4-primary',
        title: 'Trophy vs Non-Trophy vs PS4 Primary Guide | PlayStation Hub',
        h1: 'Trophy vs Non-Trophy vs PS4 Primary: which rental account is right for you?',
        types: ['Article', 'FAQPage', 'BreadcrumbList']
      },
      {
        path: '/guides/ps-plus-deluxe-vs-renting',
        title: 'PS Plus Deluxe vs Renting (Philippines) | PlayStation Hub',
        h1: 'PS Plus Deluxe vs renting games: which is better for you?',
        types: ['Article', 'FAQPage', 'BreadcrumbList']
      },
      {
        path: '/guides',
        title: 'PS5 & PS4 Rental Guides | PlayStation Hub',
        h1: 'PS5 and PS4 rental guides',
        types: ['BreadcrumbList']
      }
    ];
    function decode(s) {
      return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }
    function visible(html) {
      return decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' '));
    }
    for (const page of expected) {
      const res = await call(page.path);
      assert.strictEqual(res.status, 200, page.path);
      assert.strictEqual(decode(titleOf(res.body)), page.title, page.path);
      assert.strictEqual(canonicalOf(res.body), 'https://www.playstation-hub.com' + page.path);
      const h1s = res.body.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) || [];
      assert.strictEqual(h1s.length, 1, page.path + ' h1 count');
      assert.strictEqual(decode(h1s[0].replace(/<[^>]+>/g, '').trim()), page.h1);
      const desc = (res.body.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
      assert.ok(desc.length >= 80, page.path + ' description');
      const blocks = jsonLd(res.body);
      blocks.forEach(b => assert.ok(b['@type'] || b['@graph'], page.path));
      page.types.forEach(type => assert.ok(blocks.some(b => b['@type'] === type), page.path + ' missing ' + type));
      assert.ok(!blocks.some(b => b['@type'] === 'Product'), page.path);
      const text = visible(res.body);
      assert.ok(!res.body.includes('Playstation Hub'), page.path);
      assert.ok(!text.includes('always 10% off'), page.path);
      assert.ok(!text.includes('stored locally'), page.path);
      assert.ok(!text.includes('Game Trials'), page.path);
      assert.ok(text.includes('href') === false || res.body.includes('href="/browse"'), page.path);
      assert.ok(res.body.includes('href="/browse"'), page.path);
      assert.ok(res.body.includes('href="/faq"'), page.path);
      assert.ok(res.body.includes('href="/guides/trophy-vs-non-trophy-vs-ps4-primary"'), page.path);
      assert.ok(res.body.includes('href="/guides/ps-plus-deluxe-vs-renting"'), page.path);
      const faqLd = blocks.find(b => b['@type'] === 'FAQPage');
      if (faqLd) {
        faqLd.mainEntity.forEach(q => {
          assert.ok(text.includes(q.name), page.path + ' ' + q.name);
          assert.ok(text.includes(q.acceptedAnswer.text), page.path + ' answer ' + q.name);
        });
      }
      const howto = blocks.find(b => b['@type'] === 'HowTo');
      if (howto) howto.step.forEach(step => assert.ok(text.includes(step.text), page.path + ' ' + step.name));
    }
    const how = await call('/how-it-works');
    assert.ok(how.body.includes('Unlimited FREE game changes while your rental is active (2-day cooldown between swaps, subject to slot availability).'));
    assert.ok(how.body.includes('Yes, on Non-Trophy accounts. You can play free for three hours'));
    assert.ok(['/game/ghost-of-yotei', '/game/spider-man', '/game/elden-ring', '/game/battlefield-6'].some(href => how.body.includes('href="' + href + '"')));
    assert.ok(how.body.includes('href="/ps-plus"'));
    const plus = await call('/guides/ps-plus-deluxe-vs-renting');
    assert.ok(plus.body.includes('₱349'));
    assert.ok(plus.body.includes('₱699'));
    assert.ok(!plus.body.includes('not in our PS Plus Deluxe list'));
    assert.ok(!plus.body.includes('always 10% off'));
    const map = await call('/sitemap.xml');
    ['/how-it-works', '/guides', '/guides/trophy-vs-non-trophy-vs-ps4-primary', '/guides/ps-plus-deluxe-vs-renting'].forEach(p => {
      assert.ok(map.body.includes('<loc>https://www.playstation-hub.com' + p + '</loc>'), p);
    });
    assert.strictEqual(guidePages.PATHS.trophy, '/guides/trophy-vs-non-trophy-vs-ps4-primary');
  });

  await okAsync('nav, home, PS Plus, and account pickers link the guides with plain anchors', async () => {
    const home = await call('/');
    assert.strictEqual((home.body.match(/<a href="\/guides" class="">Guides<\/a>/g) || []).length, 2);
    assert.ok(home.body.includes('<a href="/guides">Guides</a>'));
    const bar = home.body.slice(home.body.indexOf('id="startHere"'), home.body.indexOf('id="how"'));
    assert.ok(bar.includes('<a href="/how-it-works">How renting works</a>'));
    assert.ok(bar.includes('<a href="/guides/trophy-vs-non-trophy-vs-ps4-primary">Trophy vs Non-Trophy vs PS4 Primary</a>'));
    assert.ok(bar.includes('<a href="/guides/ps-plus-deluxe-vs-renting">PS Plus Deluxe vs renting</a>'));
    const plus = await call('/ps-plus');
    assert.ok(plus.body.slice(0, plus.body.indexOf('class="ppc-tabs"')).includes('<a href="/guides/ps-plus-deluxe-vs-renting">PS Plus Deluxe vs renting</a>'));
    const game = await call('/game/elden-ring');
    assert.strictEqual(game.status, 200);
    assert.ok(game.body.includes('<a href="/guides/trophy-vs-non-trophy-vs-ps4-primary">Trophy vs Non-Trophy vs PS4 Primary</a>'));
    const soon = await call('/upcoming/phantom-blade-5');
    assert.strictEqual(soon.status, 200);
    assert.ok(soon.body.includes('<a href="/guides/trophy-vs-non-trophy-vs-ps4-primary">Trophy vs Non-Trophy vs PS4 Primary</a>'));
    const guides = await call('/guides');
    assert.strictEqual((guides.body.match(/<a href="\/guides" class="active">Guides<\/a>/g) || []).length, 2);
    const trophy = await call('/guides/trophy-vs-non-trophy-vs-ps4-primary');
    assert.ok(trophy.body.includes('<a href="/guides" class="active">Guides</a>'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
