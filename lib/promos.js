// Customer-facing promos. Custom promos are stored. Loyalty promos are not:
// they are rebuilt from the loyalty toggles on every read, so turning an
// offer off removes it from the banner, the promos page, checkout, the FAQ,
// and the support assistant together.
//
// Dates are Asia/Manila calendar days (YYYY-MM-DD), inclusive. The caller
// passes today; this file does not read the clock.

const loyalty = require('./loyalty');

const LIMITS = { title: 80, text: 180, terms: 600, badge: 24 };

function clip(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function ymd(value) {
  const s = String(value == null ? '' : value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function gameIdOf(value) {
  if (value == null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeOffer(raw) {
  const src = raw || {};
  const starts = ymd(src.starts_on);
  const ends = ymd(src.ends_on);
  return {
    id: String(src.id || '').trim(),
    title: clip(src.title, LIMITS.title),
    text: clip(src.text, LIMITS.text),
    terms: clip(src.terms, LIMITS.terms),
    starts_on: starts,
    ends_on: ends,
    enabled: src.enabled === true,
    game_id: gameIdOf(src.game_id),
    badge: clip(src.badge, LIMITS.badge),
    featured: src.featured === true
  };
}

function normalizeList(raw) {
  const seen = new Set();
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach(row => {
    const offer = normalizeOffer(row);
    if (!offer.id || seen.has(offer.id)) return;
    seen.add(offer.id);
    out.push(offer);
  });
  return out;
}

function isLive(offer, today) {
  if (!offer || !offer.enabled) return false;
  const day = ymd(today);
  if (!day) return false;
  if (offer.starts_on && day < offer.starts_on) return false;
  if (offer.ends_on && day > offer.ends_on) return false;
  return true;
}

function gameTitle(games, id) {
  if (id == null) return '';
  const game = (games || []).find(g => g && Number(g.id) === Number(id));
  return game ? String(game.title || '') : '';
}

function loyaltyOffers(settings) {
  const s = loyalty.normalizeSettings(settings);
  const out = [];
  if (s.punch_enabled) {
    const terms = (s.trophy_double ? 'Trophy rentals count as two punches. ' : '')
      + 'Paid rentals only. A purchase or a reservation does not count. Message us when a free rental is ready.';
    out.push({
      id: 'loyalty-punch',
      source: 'loyalty',
      kind: 'punch',
      title: 'Free ' + s.reward_days + '-day rental',
      text: 'Every ' + s.punch_every + 'th paid rental is a free ' + s.reward_days + '-day rental.',
      terms,
      starts_on: '',
      ends_on: '',
      enabled: true,
      game_id: null,
      game_title: '',
      badge: '',
      featured: false,
      applies_to_games: false
    });
  }
  if (s.rebook_enabled) {
    out.push({
      id: 'loyalty-rebook',
      source: 'loyalty',
      kind: 'rebook',
      title: '₱' + s.rebook_amount + ' rebook discount',
      text: 'Start a new rental within ' + s.rebook_within_days + ' days of your last one ending and get ₱' + s.rebook_amount + ' off.',
      terms: 'Counted in Asia/Manila dates, from the day the last rental ends through that many days later. Message us to use it.',
      starts_on: '',
      ends_on: '',
      enabled: true,
      game_id: null,
      game_title: '',
      badge: '',
      featured: false,
      applies_to_games: false
    });
  }
  return out;
}

function liveOffers(input) {
  const src = input || {};
  const today = src.today;
  const games = src.games || [];
  const custom = normalizeList(src.stored).filter(o => isLive(o, today)).map(o => Object.assign({}, o, {
    source: 'catalog',
    game_title: gameTitle(games, o.game_id),
    applies_to_games: true
  }));
  return loyaltyOffers(src.loyaltySettings).concat(custom);
}

function bannerOffer(live) {
  const rows = live || [];
  const featured = rows.find(o => o && o.featured && o.source === 'catalog');
  if (featured) return featured;
  return rows[0] || null;
}

function appliesToGame(offer, gameId) {
  if (!offer || !offer.applies_to_games) return false;
  if (offer.game_id == null) return true;
  return Number(offer.game_id) === Number(gameId);
}

function badgeFor(live, gameId) {
  const hit = (live || []).find(o => appliesToGame(o, gameId));
  if (!hit) return null;
  return { text: hit.badge || 'Promo', title: hit.title };
}

function catalogLines(live, gameId) {
  return (live || []).filter(o => appliesToGame(o, gameId)).map(o => o.text).filter(Boolean);
}

function checkoutLines(live, gameId, loyaltyCopy) {
  const lines = catalogLines(live, gameId);
  if (loyaltyCopy && loyaltyCopy.show) {
    [loyaltyCopy.punchLine, loyaltyCopy.rewardLine, loyaltyCopy.rebookLine].forEach(line => {
      if (line) lines.push(line);
    });
    return lines;
  }
  (live || []).forEach(o => {
    if (o && o.source === 'loyalty' && o.text) lines.push(o.text);
  });
  return lines;
}

function usedIds(live, gameId, profile) {
  const ids = [];
  (live || []).forEach(o => {
    if (!o) return;
    if (o.source === 'catalog' && appliesToGame(o, gameId)) ids.push(o.id);
    if (o.id === 'loyalty-rebook' && profile && profile.rebook && (profile.rebook.eligible || profile.rebook.unredeemed > 0)) {
      ids.push(o.id);
    }
    if (o.id === 'loyalty-punch' && profile && profile.availablePunch > 0) ids.push(o.id);
  });
  return ids;
}

function publicFacts(live) {
  return (live || []).map(o => ({
    id: o.id,
    title: o.title,
    text: o.text,
    terms: o.terms,
    startsOn: o.starts_on || null,
    endsOn: o.ends_on || null,
    gameTitle: o.game_title || null,
    badge: o.badge || null
  }));
}

function saveOffer(stored, body, opts) {
  const src = body || {};
  const title = clip(src.title, LIMITS.title);
  const text = clip(src.text, LIMITS.text);
  if (!title || !text) return { ok: false, error: 'blank' };
  const starts = ymd(src.starts_on);
  const ends = ymd(src.ends_on);
  if ((src.starts_on && !starts) || (src.ends_on && !ends)) return { ok: false, error: 'dates' };
  if (starts && ends && ends < starts) return { ok: false, error: 'dates' };
  const list = normalizeList(stored);
  const featured = src.featured === 'on' || src.featured === true;
  const next = {
    id: String(src.id || '').trim(),
    title,
    text,
    terms: clip(src.terms, LIMITS.terms),
    starts_on: starts,
    ends_on: ends,
    enabled: src.enabled === 'on' || src.enabled === true,
    game_id: gameIdOf(src.game_id),
    badge: clip(src.badge, LIMITS.badge),
    featured
  };
  let nextId = (opts && opts.nextId) || 1;
  const index = next.id ? list.findIndex(o => o.id === next.id) : -1;
  if (index === -1) {
    next.id = 'p' + nextId;
    nextId += 1;
    list.push(next);
  } else {
    list[index] = next;
  }
  if (featured) {
    list.forEach(o => { if (o.id !== next.id) o.featured = false; });
  }
  return { ok: true, offers: list, nextId };
}

function deleteOffer(stored, id) {
  const key = String(id || '').trim();
  return normalizeList(stored).filter(o => o.id !== key);
}

function record(events, row) {
  const list = (Array.isArray(events) ? events : []).slice();
  const entry = {
    kind: row && row.kind,
    promo_id: row && row.promo_id ? String(row.promo_id) : '',
    session_id: row && row.session_id ? String(row.session_id) : '',
    date: ymd(row && row.date)
  };
  if (!entry.kind || !entry.date) return { events: list, recorded: false };
  if (entry.kind === 'banner') {
    const dup = list.some(e => e && e.kind === 'banner' && e.promo_id === entry.promo_id && e.session_id === entry.session_id && e.date === entry.date);
    if (dup) return { events: list, recorded: false };
  }
  list.push(entry);
  return { events: list, recorded: true };
}

function stats(events, since) {
  const day = since ? ymd(since) : '';
  const rows = (events || []).filter(e => e && (!day || String(e.date) >= day));
  const count = kind => rows.filter(e => e.kind === kind).length;
  return { banner: count('banner'), page: count('page'), orders: count('order') };
}

module.exports = {
  normalizeList,
  isLive,
  loyaltyOffers,
  liveOffers,
  bannerOffer,
  badgeFor,
  catalogLines,
  checkoutLines,
  usedIds,
  publicFacts,
  saveOffer,
  deleteOffer,
  record,
  stats
};
