// Facebook / Meta catalog feed (/feed/meta.csv).
//
// One row per live game. The price is the Non-Trophy 7-day list price (the
// number a game page shows as "Weekly from" when that week is not discounted),
// taken from the game's price category when it has one. Trophy 7-day is the
// fallback. Coming-soon and unreleased games are omitted, and so is any game
// with no positive weekly price — the feed must never advertise ₱0.
//
// Links use the canonical www host. Covers we host are the JPEG rendition
// Meta's catalog accepts (/uploads/jpg/:name). Ids stay the numeric game ids
// so Commerce Manager updates items in place.
const path = require('path');
const seo = require('./seo');

const ORIGIN = seo.ORIGIN;
const HEADERS = Object.freeze([
  'id', 'title', 'description', 'availability', 'condition',
  'price', 'link', 'image_link', 'brand', 'google_product_category'
]);
const BRAND = 'PlayStation Hub';
const PRODUCT_CATEGORY = '1249';
const MAX_DESCRIPTION = 5000;

function wholePesos(n) {
  const v = Number(n);
  if (!(v > 0)) return 0;
  const rounded = Math.round(v);
  return rounded > 0 ? rounded : 0;
}

// Category prices replace the game's own fields, the same way the game page
// does. A game with no category (or a missing category) keeps its own fields.
function pricesFor(game, categories) {
  const own = {
    nt7: wholePesos(game.nt_price_7d),
    nt30: wholePesos(game.nt_price_30d),
    tr7: wholePesos(game.tr_price_7d),
    tr30: wholePesos(game.tr_price_30d)
  };
  if (game.price_category_id == null || game.price_category_id === '') return own;
  const cat = (categories || []).find(c => c && Number(c.id) === Number(game.price_category_id));
  if (!cat) return own;
  return {
    nt7: wholePesos(cat.nt_price_7d),
    nt30: wholePesos(cat.nt_price_30d),
    tr7: wholePesos(cat.tr_price_7d),
    tr30: wholePesos(cat.tr_price_30d)
  };
}

// Same rule as the game page: PS4 Primary exists only when the platform is
// PS4 or PS4/PS5. PS5-only games are Trophy, not Trophy & PS4 Primary.
function offersPs4(game) {
  const platform = String(game && game.platform || '').trim();
  return platform === 'PS4' || platform === 'PS4/PS5';
}

function comingSoon(game, today) {
  if (!game) return true;
  const flag = game.upcoming;
  if (flag === true || flag === 1 || flag === '1' || flag === 'true') return true;
  const match = String(game.release_date || '').trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return !!(match && match[1] > today);
}

function span(week, month) {
  const parts = [];
  if (week > 0) parts.push('₱' + week + '/week');
  if (month > 0) parts.push('₱' + month + '/month');
  return parts.join(', ');
}

function description(prices, ps4, deposit) {
  const bits = [];
  const nt = span(prices.nt7, prices.nt30);
  const tr = span(prices.tr7, prices.tr30);
  if (nt) bits.push('Non-Trophy: ' + nt + '.');
  if (tr) {
    const name = ps4 ? 'Trophy & PS4 Primary' : 'Trophy';
    const dep = deposit > 0 ? ' (₱' + deposit + ' refundable deposit)' : '';
    bits.push(name + ': ' + tr + dep + '.');
  }
  if (nt) bits.push('Free 3-hour trial on Non-Trophy.');
  bits.push('Rent at www.playstation-hub.com or message us on Messenger.');
  let text = bits.join(' ');
  if (text.length > MAX_DESCRIPTION) text = text.slice(0, MAX_DESCRIPTION - 3).trimEnd() + '...';
  return text;
}

function ourHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'playstation-hub.com' || h === 'www.playstation-hub.com' || h.endsWith('.railway.app');
}

// JPEG copy of a cover we host. External https URLs are already absolute and
// are not rewritten onto this site.
function imageLink(cover) {
  const raw = String(cover || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) {
    const abs = raw.startsWith('//') ? 'https:' + raw : raw;
    let url;
    try { url = new URL(abs); } catch (e) { return abs; }
    if (!ourHost(url.hostname)) return abs;
    return localImage(url.pathname);
  }
  const pathOnly = raw.split('?')[0];
  return localImage(pathOnly.startsWith('/') ? pathOnly : '/' + pathOnly);
}

function localImage(pathname) {
  const pathOnly = String(pathname || '').split('?')[0];
  const upload = pathOnly.startsWith('/uploads/')
    && !pathOnly.startsWith('/uploads/jpg/')
    && !pathOnly.startsWith('/uploads/w/');
  if (upload) {
    const base = path.basename(pathOnly).replace(/\.[^.]+$/, '');
    if (base && /^[A-Za-z0-9._-]+$/.test(base) && !base.startsWith('.')) {
      return ORIGIN + '/uploads/jpg/' + base + '.jpg';
    }
  }
  return ORIGIN + (pathOnly.startsWith('/') ? pathOnly : '/' + pathOnly);
}

function depositOf(input) {
  if (!input || input.deposit == null || input.deposit === '') return 100;
  const n = Number(input.deposit);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function todayOf(input) {
  const raw = input && input.today;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

function records(input) {
  const categories = (input && input.categories) || [];
  const deposit = depositOf(input);
  const today = todayOf(input);
  const out = [];
  ((input && input.games) || []).forEach(game => {
    if (!game || game.id == null || game.id === '') return;
    if (comingSoon(game, today)) return;
    const prices = pricesFor(game, categories);
    const weekly = prices.nt7 || prices.tr7;
    if (!(weekly > 0)) return;
    out.push({
      id: String(game.id),
      title: game.title == null ? '' : String(game.title),
      description: description(prices, offersPs4(game), deposit),
      availability: 'in stock',
      condition: 'new',
      price: weekly + ' PHP',
      link: ORIGIN + seo.gamePath(game.title),
      image_link: imageLink(game.cover_image),
      brand: BRAND,
      google_product_category: PRODUCT_CATEGORY
    });
  });
  return out;
}

// Quote every field. A quoted newline is legal CSV but splits the row for
// stricter catalog parsers, so line breaks become spaces. UTF-8 is left as
// UTF-8 — the peso sign must survive.
function cell(value) {
  const s = String(value == null ? '' : value).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  return '"' + s.replace(/"/g, '""') + '"';
}

function csv(input) {
  const lines = [HEADERS.map(cell).join(',')];
  records(input).forEach(row => {
    lines.push(HEADERS.map(key => cell(row[key])).join(','));
  });
  return lines.join('\n') + '\n';
}

module.exports = { ORIGIN, HEADERS, records, csv };
