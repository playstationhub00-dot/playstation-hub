// Public-page SEO: titles, canonical URLs, JSON-LD, the sitemap, and the
// apex → www redirect. Pure. server.js and the head partial call these so a
// game page cannot advertise a different price than the one in the title.
const gameDiscount = require('./game-discount');

const ORIGIN = 'https://www.playstation-hub.com';
const SITE_NAME = 'PlayStation Hub';
const APEX_HOST = 'playstation-hub.com';

const STATIC_PATHS = {
  home: '/',
  browse: '/browse',
  faq: '/faq',
  promos: '/promos',
  'ps-plus': '/ps-plus',
  'how-it-works': '/how-it-works',
  buy: '/buy',
  terms: '/terms',
  privacy: '/privacy',
  'how-to-sign-in': '/how-to-sign-in',
  'data-deletion': '/data-deletion',
  requests: '/requests'
};

const STATIC_COPY = {
  home: {
    title: (min) => min
      ? 'PS5 & PS4 Game Rental Philippines – from ₱' + min + ' | ' + SITE_NAME
      : 'PS5 & PS4 Game Rental Philippines | ' + SITE_NAME,
    description: 'Rent PS5 and PS4 digital games online in the Philippines. Trophy, Non-Trophy, and PS4 Primary, with a ₱100 deposit on Trophy and PS4 Primary. Pay with GCash, Maya, or PayPal.'
  },
  browse: {
    title: 'Rent PS5 & PS4 Games Philippines | ' + SITE_NAME,
    description: 'Browse PS5 and PS4 games for rent in the Philippines. Compare Trophy and Non-Trophy prices and free slots. Pay with GCash, Maya, or PayPal.'
  },
  faq: {
    title: 'PS5 & PS4 Rental FAQ Philippines | ' + SITE_NAME,
    description: 'FAQ on renting PS5 and PS4 games in the Philippines: weekly and monthly, Trophy and Non-Trophy, the ₱100 deposit, and GCash, Maya, or PayPal.'
  },
  promos: {
    title: 'PS5 & PS4 Rental Promos Philippines | ' + SITE_NAME,
    description: 'Current PlayStation Hub promos for PS5 and PS4 game rentals in the Philippines. Discounts apply at checkout. Pay with GCash, Maya, or PayPal.'
  },
  'ps-plus': {
    title: 'Rent PS Plus Deluxe Philippines | ' + SITE_NAME,
    description: 'Rent PS Plus Deluxe in the Philippines and play the monthly games. Trophy and Non-Trophy accounts. Pay with GCash, Maya, or PayPal on Messenger.'
  },
  'how-it-works': {
    title: 'How PS5 & PS4 Rentals Work | ' + SITE_NAME,
    description: 'How PlayStation Hub rentals work: pick a PS5 or PS4 game, choose Trophy or Non-Trophy, pay with GCash, Maya, or PayPal, then sign in with a QR.'
  },
  buy: {
    title: 'Buy PS5 & PS4 Games Philippines | ' + SITE_NAME,
    description: 'Buy permanent PS5 and PS4 game access in the Philippines. One payment, nothing to return. Pay with GCash, Maya, or PayPal. Message us on Messenger.'
  },
  terms: {
    title: 'Rental Terms Philippines | ' + SITE_NAME,
    description: 'Terms for renting and buying PS5 and PS4 digital games from PlayStation Hub in the Philippines, including the ₱100 deposit and late fees.'
  },
  privacy: {
    title: 'Privacy Policy | ' + SITE_NAME,
    description: 'How PlayStation Hub handles your name, Messenger messages, and payment details when you rent or buy PS5 and PS4 games in the Philippines.'
  },
  'how-to-sign-in': {
    title: 'PS5 & PS4 Sign-In QR Guide | ' + SITE_NAME,
    description: 'How to show the sign-in QR on a PS5 or PS4 so PlayStation Hub can sign the rental account into your console. You never share a password.'
  },
  'data-deletion': {
    title: 'Data Deletion | ' + SITE_NAME,
    description: 'How to ask PlayStation Hub to delete your Messenger and order details. Email playstationhub00@gmail.com or message the page on Messenger.'
  },
  requests: {
    title: 'Request a PS5 or PS4 Game | ' + SITE_NAME,
    description: 'Ask PlayStation Hub to stock a PS5 or PS4 game for rent in the Philippines. Requests are free. Pay with GCash, Maya, or PayPal once it is in.'
  }
};

function slug(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function canonicalUrl(pathname) {
  let p = String(pathname || '/').split('#')[0].split('?')[0];
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p === '/') return ORIGIN;
  return ORIGIN + p;
}

function absoluteUrl(url) {
  const s = String(url || '').trim();
  if (!s) return ORIGIN + '/logo.svg';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  return ORIGIN + (s.startsWith('/') ? s : '/' + s);
}

function isRailwayHost(host) {
  return host.endsWith('.railway.app') || host.endsWith('.railway.internal') || host === 'railway.internal';
}

function isHealthCheck(originalUrl, userAgent) {
  const path = String(originalUrl || '').split('?')[0];
  if (path === '/health' || path === '/healthz' || path === '/ready' || path === '/live') return true;
  return /HealthCheck|kube-probe|GoogleHC/i.test(String(userAgent || ''));
}

// 301 target, or null when this request should stay on the host it used.
function apexRedirect({ host, originalUrl, userAgent }) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!h || h === 'www.' + APEX_HOST) return null;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return null;
  if (isRailwayHost(h)) return null;
  if (isHealthCheck(originalUrl, userAgent)) return null;
  if (h !== APEX_HOST) return null;
  const target = (originalUrl && String(originalUrl).startsWith('/')) ? String(originalUrl) : '/';
  return ORIGIN + target;
}

function faviconType(filePath) {
  const ext = String(filePath || '').split('?')[0].toLowerCase().match(/\.[a-z0-9]+$/);
  const e = ext ? ext[0] : '';
  if (e === '.svg') return 'image/svg+xml';
  if (e === '.png') return 'image/png';
  if (e === '.ico') return 'image/x-icon';
  if (e === '.webp') return 'image/webp';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.gif') return 'image/gif';
  return 'image/png';
}

function platformOf(game) {
  const p = String((game && game.platform) || '').trim();
  return p || 'PS5';
}

// Cheapest rent a customer actually pays: weekly and monthly, Trophy and
// Non-Trophy, after the same discount the game page uses.
function fromPrice(game, promo) {
  const g = game || {};
  const pairs = [
    [g.nt_price_7d, 7], [g.nt_price_30d, 30],
    [g.tr_price_7d, 7], [g.tr_price_30d, 30]
  ];
  const finals = pairs
    .filter(([base]) => Number(base) > 0)
    .map(([base, days]) => gameDiscount.applyPct(base, gameDiscount.discountPct(g, days, promo)));
  return finals.length ? Math.min(...finals) : 0;
}

function catalogueMin(games, promo) {
  const prices = (games || []).map(g => fromPrice(g, promo)).filter(n => n > 0);
  return prices.length ? Math.min(...prices) : 0;
}

function rentTitle(verb, game, price) {
  const name = game.title;
  const platform = platformOf(game);
  const priceBit = price > 0 ? ' – from ₱' + price : '';
  return verb + ' ' + name + ' ' + platform + ' Philippines' + priceBit + ' | ' + SITE_NAME;
}

function rentDescription(verb, game, price) {
  const platform = platformOf(game);
  const priceBit = price > 0 ? ' from ₱' + price : '';
  return verb + ' ' + game.title + ' for ' + platform + ' in the Philippines' + priceBit +
    '. Trophy and Non-Trophy accounts. ₱100 deposit on Trophy and PS4 Primary. Pay with GCash, Maya, or PayPal on Messenger.';
}

function rentIntro(verb, game, price) {
  const priceBit = price > 0 ? ' from ₱' + price : '';
  return verb + ' ' + game.title + ' for ' + platformOf(game) + ' in the Philippines' + priceBit + '.';
}

function offer(name, price, availability, url) {
  return {
    '@type': 'Offer',
    name,
    price: String(price),
    priceCurrency: 'PHP',
    availability: 'https://schema.org/' + availability,
    url
  };
}

function tierPrice(game, prefix, days, promo) {
  let base = Number(game[prefix + '_price_' + days + 'd']) || 0;
  if (prefix === 'ps4') base = Number(game['tr_price_' + days + 'd']) || Number(game['nt_price_' + days + 'd']) || 0;
  if (!base) return 0;
  return gameDiscount.applyPct(base, gameDiscount.discountPct(game, days, promo));
}

function rentOffers(game, promo, availability, url, preorder) {
  const av = availability || {};
  const showPs4 = typeof av.showPs4 === 'boolean'
    ? av.showPs4
    : (game.platform === 'PS4' || game.platform === 'PS4/PS5');
  const stock = (flag) => (preorder ? 'PreOrder' : (flag ? 'InStock' : 'OutOfStock'));
  const rows = [
    ['Non-Trophy · 7 days', 'nt', 7, av.ntAvail],
    ['Non-Trophy · 30 days', 'nt', 30, av.ntAvail],
    ['Trophy · 7 days', 'tr', 7, av.trAvail],
    ['Trophy · 30 days', 'tr', 30, av.trAvail]
  ];
  if (showPs4) {
    rows.push(['PS4 Primary · 7 days', 'ps4', 7, av.ps4Avail]);
    rows.push(['PS4 Primary · 30 days', 'ps4', 30, av.ps4Avail]);
  }
  return rows.map(([name, prefix, days, avail]) => {
    const price = tierPrice(game, prefix, days, promo);
    if (!price) return null;
    return offer(name, price, stock(!!avail), url);
  }).filter(Boolean);
}

function breadcrumb(crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.item
    }))
  };
}

function productBlock({ game, description, image, url, offers }) {
  const block = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: game.title,
    description,
    brand: { '@type': 'Brand', name: SITE_NAME },
    offers
  };
  if (image) block.image = absoluteUrl(image);
  if (url) block.url = url;
  return block;
}

function gamePage({ game, promo, availability }) {
  const price = fromPrice(game, promo);
  const path = '/game/' + slug(game.title);
  const url = canonicalUrl(path);
  const description = rentDescription('Rent', game, price);
  const image = game.cover_image || '';
  return {
    title: rentTitle('Rent', game, price),
    description,
    canonicalPath: path,
    image,
    type: 'product',
    intro: rentIntro('Rent', game, price),
    jsonLd: [
      productBlock({
        game, description, image, url,
        offers: rentOffers(game, promo, availability, url, false)
      }),
      breadcrumb([
        { name: 'Home', item: ORIGIN },
        { name: 'Browse', item: ORIGIN + '/browse' },
        { name: game.title, item: url }
      ])
    ]
  };
}

function upcomingPage({ game, promo }) {
  const price = fromPrice(game, promo);
  const path = '/upcoming/' + slug(game.title) + '-' + game.id;
  const url = canonicalUrl(path);
  const description = rentDescription('Reserve', game, price);
  const image = game.cover_image || '';
  const avail = { ntAvail: true, trAvail: true, ps4Avail: true, showPs4: game.platform === 'PS4' || game.platform === 'PS4/PS5' };
  return {
    title: rentTitle('Reserve', game, price),
    description,
    canonicalPath: path,
    image,
    type: 'product',
    intro: rentIntro('Reserve', game, price),
    jsonLd: [
      productBlock({
        game, description, image, url,
        offers: rentOffers(game, promo, avail, url, true)
      }),
      breadcrumb([
        { name: 'Home', item: ORIGIN },
        { name: 'Browse', item: ORIGIN + '/browse' },
        { name: game.title, item: url }
      ])
    ]
  };
}

function staticPage(key) {
  const copy = STATIC_COPY[key];
  if (!copy) return { title: SITE_NAME, description: '', canonicalPath: '/', type: 'website', image: '/logo.svg', jsonLd: [] };
  return {
    title: typeof copy.title === 'function' ? copy.title(0) : copy.title,
    description: copy.description,
    canonicalPath: STATIC_PATHS[key] || '/',
    type: 'website',
    image: '/logo.svg',
    jsonLd: []
  };
}

function homePage({ games, promo, faqItems }) {
  const min = catalogueMin(games, promo);
  const copy = STATIC_COPY.home;
  const blocks = [];
  if (faqItems && faqItems.length) blocks.push(faqPage(faqItems));
  return {
    title: copy.title(min),
    description: copy.description,
    canonicalPath: '/',
    type: 'website',
    image: '/logo.svg',
    jsonLd: blocks
  };
}

function faqPage(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: (items || []).map(item => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.text }
    }))
  };
}

function siteGraph() {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: ORIGIN,
      logo: ORIGIN + '/logo.svg',
      sameAs: [
        'https://facebook.com/PlaystationHub00',
        'http://m.me/PlaystationHub00'
      ],
      email: 'playstationhub00@gmail.com'
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: ORIGIN
    }
  ];
}

function jsonLdScript(block) {
  return JSON.stringify(block).replace(/</g, '\\u003c');
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function lastmodOf(value) {
  const m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function sitemapXml({ games, upcoming }) {
  const urls = [];
  Object.keys(STATIC_PATHS).forEach(key => {
    urls.push({ loc: canonicalUrl(STATIC_PATHS[key]) });
  });
  (games || []).forEach(g => urls.push({ loc: canonicalUrl(g.path), lastmod: lastmodOf(g.lastmod) }));
  (upcoming || []).forEach(g => urls.push({ loc: canonicalUrl(g.path), lastmod: lastmodOf(g.lastmod) }));
  const body = urls.map(u => {
    let row = '  <url>\n    <loc>' + xmlEscape(u.loc) + '</loc>\n';
    if (u.lastmod) row += '    <lastmod>' + u.lastmod + '</lastmod>\n';
    return row + '  </url>';
  }).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    body + '\n</urlset>\n';
}

function assertWellFormedXml(xml) {
  const body = String(xml).replace(/<\?xml[^?]*\?>/, '').trim();
  const re = /<\/?([a-zA-Z0-9:-]+)(\s[^>]*)?\/?>/g;
  const stack = [];
  let m;
  let last = 0;
  while ((m = re.exec(body))) {
    const between = body.slice(last, m.index);
    if (between.includes('<')) throw new Error('bare < in xml text');
    last = m.index + m[0].length;
    const name = m[1];
    const token = m[0];
    if (token.startsWith('</')) {
      const open = stack.pop();
      if (open !== name) throw new Error('mismatched tag ' + open + ' / ' + name);
    } else if (!token.endsWith('/>')) {
      stack.push(name);
    }
  }
  if (stack.length) throw new Error('unclosed ' + stack.join(','));
  if (body.slice(last).includes('<')) throw new Error('trailing markup');
}

function robotsTxt() {
  return 'User-agent: *\nDisallow: /admin\nSitemap: ' + ORIGIN + '/sitemap.xml\n';
}

function cleanUtm(v) {
  const raw = Array.isArray(v) ? v[0] : v;
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
}

function cleanReferrer(referrer) {
  if (!referrer || typeof referrer !== 'string') return '';
  let u;
  try { u = new URL(referrer); } catch (e) { return ''; }
  const h = u.hostname.toLowerCase();
  if (!h) return '';
  if (h === APEX_HOST || h === 'www.' + APEX_HOST || h === 'localhost' || h === '127.0.0.1') return '';
  if (isRailwayHost(h)) return '';
  const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '';
  return (u.origin + path).slice(0, 300);
}

function attributionForRequest({ query, referrer, alreadyCaptured }) {
  if (alreadyCaptured) return { capture: false, fields: {} };
  const fields = {};
  const source = cleanUtm(query && query.utm_source);
  const medium = cleanUtm(query && query.utm_medium);
  const campaign = cleanUtm(query && query.utm_campaign);
  const content = cleanUtm(query && query.utm_content);
  const ref = cleanReferrer(referrer);
  if (source) fields.utm_source = source;
  if (medium) fields.utm_medium = medium;
  if (campaign) fields.utm_campaign = campaign;
  if (content) fields.utm_content = content;
  if (ref) fields.referrer = ref;
  return { capture: true, fields };
}

// "facebook.com" and "www.google.com.ph" both read as the site name.
function sourceHost(hostname) {
  const parts = String(hostname || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length >= 3 && parts[parts.length - 1].length === 2 && /^(com|co|net|org|ac|gov)$/.test(parts[parts.length - 2])) {
    return parts[parts.length - 3];
  }
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || 'Referral';
}

function sourceLabel(v) {
  const src = String((v && v.utm_source) || '').trim();
  const med = String((v && v.utm_medium) || '').trim();
  if (src) return med ? src + ' / ' + med : src;
  if (v && v.referrer) {
    try { return sourceHost(new URL(v.referrer).hostname); }
    catch (e) { return 'Referral'; }
  }
  return 'Direct';
}

function trafficSources(visitors) {
  const first = new Map();
  (visitors || []).forEach((v, i) => {
    const key = v && v.session_id ? v.session_id : 'row:' + i;
    const prev = first.get(key);
    if (!prev || String(v.time || '') < String(prev.time || '')) first.set(key, v);
  });
  const counts = new Map();
  for (const v of first.values()) {
    const label = sourceLabel(v);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function cleanGa4Id(v) {
  const s = String(v || '').trim();
  return /^G-[A-Z0-9]+$/.test(s) ? s : '';
}

function cleanSiteVerification(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(s) ? s : '';
}

module.exports = {
  ORIGIN, SITE_NAME, STATIC_PATHS,
  slug, canonicalUrl, absoluteUrl, apexRedirect, faviconType,
  fromPrice, catalogueMin, gamePage, upcomingPage, staticPage, homePage,
  faqPage, siteGraph, jsonLdScript, sitemapXml, robotsTxt, assertWellFormedXml,
  attributionForRequest, trafficSources, cleanGa4Id, cleanSiteVerification
};
