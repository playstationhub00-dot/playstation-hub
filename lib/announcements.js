// Customer announcements. One entry can show in the top bar, the What's New
// bell, and/or the homepage banner card. Schedules are Asia/Manila wall times
// (YYYY-MM-DDTHH:mm, no offset), the same [start, end) convention as
// lib/themes.js: the end instant is already hidden.
//
// The HTML is the same for every visitor (Cloudflare caches the page).
// New-vs-returning, desktop-vs-mobile, and dismiss are applied in the browser.
//
// Boot migration (announcements-2026-10-29) runs once:
//   - existing bar rows keep their text and on/off state
//   - a blank list is filled from the legacy single `announcement` object
//   - one row is bound to the live Loyalty → Promos banner so that sentence
//     keeps showing, and still disappears when the offer does
// A second boot, or any text Michael already saved, is left alone.

const themes = require('./themes');

const MIGRATION_ID = 'announcements-2026-10-29';
const HOME_MIGRATION_ID = 'homepage-redesign-2026-10-29';
const BAR_LIMIT = 3;
const BELL_LIMIT = 8;
const BIND_PROMO = 'promo-banner';

const AUDIENCES = ['all', 'new', 'returning'];
const DEVICES = ['all', 'desktop', 'mobile'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clip(value, max) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function cleanWhen(value) {
  const s = clip(value, 16);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? s : '';
}

function onFlag(value, fallback) {
  if (value === true || value === 'on' || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'off' || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function oneOf(value, allowed, fallback) {
  const s = String(value == null ? '' : value).trim();
  return allowed.indexOf(s) === -1 ? fallback : s;
}

function whole(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function safeUrl(value) {
  const s = clip(value, 300);
  if (!s) return '';
  if (s.charAt(0) === '/' && s.charAt(1) !== '/') return s;
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

function hash(value) {
  const s = String(value || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// A row from before this feature only had id, text, and active. Those still
// belong on the bar and in the bell. A row that already names a placement
// keeps the placements it named; the ones it leaves out stay off.
function isLegacy(src) {
  return src.place_bar === undefined && src.place_bell === undefined && src.place_banner === undefined && !src.bind;
}

function normalizeEntry(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const legacy = isLegacy(src);
  const id = whole(src.id, 1, 1000000000, 0);
  const enabled = src.enabled === undefined ? src.active !== false : onFlag(src.enabled, false);
  return {
    id,
    enabled,
    label: clip(src.label, 32),
    title: clip(src.title, 120),
    title_accent: clip(src.title_accent, 80),
    text: clip(src.text, 400),
    button_label: clip(src.button_label, 40),
    button_url: safeUrl(src.button_url),
    starts_at: cleanWhen(src.starts_at),
    ends_at: cleanWhen(src.ends_at),
    priority: whole(src.priority, -100, 100, 0),
    sort: whole(src.sort, 0, 100000, 0),
    audience: oneOf(src.audience, AUDIENCES, 'all'),
    device: oneOf(src.device, DEVICES, 'all'),
    icon: clip(src.icon, 8),
    image: themes.safeImage(src.image),
    image_mobile: themes.safeImage(src.image_mobile),
    place_bar: src.place_bar === undefined ? legacy : onFlag(src.place_bar, false),
    place_bell: src.place_bell === undefined ? legacy : onFlag(src.place_bell, false),
    place_banner: src.place_banner === undefined ? false : onFlag(src.place_banner, false),
    bell_new_days: whole(src.bell_new_days, 0, 60, legacy ? 0 : 7),
    bell_pin: onFlag(src.bell_pin, false),
    bind: src.bind === BIND_PROMO ? BIND_PROMO : '',
    button2_label: clip(src.button2_label, 40),
    button2_url: safeUrl(src.button2_url),
    countdown_at: cleanWhen(src.countdown_at),
    source_key: /^[a-z0-9-]{1,40}$/.test(String(src.source_key || '')) ? String(src.source_key) : '',
    created_at: cleanWhen(src.created_at),
    updated_at: cleanWhen(src.updated_at) || cleanWhen(src.created_at),
    // Milliseconds, so an edit in the same minute still shows again after dismiss.
    version: /^\d{10,16}$/.test(String(src.version || '')) ? String(src.version) : ''
  };
}

function scheduled(entry, now) {
  const at = now instanceof Date ? now : new Date();
  const start = themes.parseManila(entry.starts_at);
  const end = themes.parseManila(entry.ends_at);
  if (start && at < start) return false;
  if (end && at >= end) return false;
  return true;
}

function hasCopy(entry) {
  return !!(entry.title || entry.text || entry.bind === BIND_PROMO);
}

function isLive(entry, now) {
  return !!(entry && entry.enabled && entry.id && hasCopy(entry) && scheduled(entry, now));
}

function byBar(a, b) {
  return (b.priority - a.priority) || (a.sort - b.sort) || (a.id - b.id);
}

function byBell(a, b) {
  return ((b.bell_pin === true) - (a.bell_pin === true)) || (b.priority - a.priority) || (a.sort - b.sort) || (a.id - b.id);
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function countdownParts(wall, now) {
  const end = themes.parseManila(wall);
  if (!end) return null;
  let ms = end.getTime() - now.getTime();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86400000);
  ms -= days * 86400000;
  const hours = Math.floor(ms / 3600000);
  ms -= hours * 3600000;
  const minutes = Math.floor(ms / 60000);
  ms -= minutes * 60000;
  const seconds = Math.floor(ms / 1000);
  return { at: end.toISOString(), days, hours, minutes, seconds };
}

function dateLabel(wall) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(wall || '');
  if (!m) return '';
  return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}

function isNew(entry, now) {
  const days = entry.bell_new_days;
  if (!days) return false;
  const from = themes.parseManila(entry.starts_at || entry.created_at);
  if (!from) return false;
  return now.getTime() < from.getTime() + days * 86400000;
}

function slideFrom(entry, now, offer) {
  const bound = entry.bind === BIND_PROMO;
  const title = bound && offer ? clip(offer.title, 120) : entry.title;
  const text = bound && offer ? clip(offer.text, 400) : entry.text;
  if (bound && !title && !text) return null;
  const version = entry.version || entry.updated_at || '0';
  return {
    id: entry.id,
    dismissKey: entry.id + '@' + version,
    kind: 'entry',
    bind: bound ? BIND_PROMO : '',
    promoId: bound && offer && offer.id ? String(offer.id) : '',
    label: entry.label,
    title,
    titleAccent: entry.title_accent,
    text,
    code: '',
    icon: entry.icon,
    buttonLabel: entry.button_label || (entry.button_url || bound ? 'Learn more' : ''),
    buttonUrl: entry.button_url || (bound ? '/promos' : ''),
    external: /^https?:\/\//i.test(entry.button_url || ''),
    button2Label: entry.button2_label,
    button2Url: entry.button2_url,
    button2External: /^https?:\/\//i.test(entry.button2_url || ''),
    countdown: countdownParts(entry.countdown_at, now),
    image: entry.image,
    imageMobile: entry.image_mobile,
    audience: entry.audience,
    device: entry.device,
    isNew: isNew(entry, now),
    dateLabel: dateLabel(entry.starts_at || entry.created_at || (offer && offer.starts_on ? offer.starts_on + 'T00:00' : '')),
    pin: entry.bell_pin === true,
    priority: entry.priority
  };
}

function themeSlide(promo) {
  if (!promo || !promo.show || !clip(promo.text, 180)) return null;
  const text = clip(promo.text, 180);
  const code = clip(promo.code, 40);
  const version = hash(text + '\n' + code);
  return {
    id: 'theme',
    dismissKey: 'theme@' + version,
    kind: 'theme',
    bind: '',
    promoId: '',
    label: '',
    title: '',
    titleAccent: '',
    text,
    code,
    icon: '',
    buttonLabel: '',
    buttonUrl: '',
    external: false,
    button2Label: '',
    button2Url: '',
    button2External: false,
    countdown: null,
    image: '',
    imageMobile: '',
    audience: 'all',
    device: 'all',
    isNew: false,
    dateLabel: '',
    pin: false,
    priority: 0
  };
}

function present(input) {
  const src = input || {};
  const now = src.now instanceof Date ? src.now : new Date();
  const offer = src.banner && src.banner.title ? src.banner : null;
  const rows = (Array.isArray(src.entries) ? src.entries : []).map(normalizeEntry).filter(entry => isLive(entry, now));
  function slidesOf(list) {
    return list.map(entry => slideFrom(entry, now, offer)).filter(Boolean);
  }
  const bar = [];
  const theme = themeSlide(src.themePromo);
  if (theme) bar.push(theme);
  slidesOf(rows.filter(r => r.place_bar).sort(byBar)).forEach(s => {
    if (bar.length < BAR_LIMIT) bar.push(s);
  });
  const bell = slidesOf(rows.filter(r => r.place_bell).sort(byBell)).slice(0, BELL_LIMIT);
  const banner = slidesOf(rows.filter(r => r.place_banner).sort(byBar)).map(slide => withCatalogArt(slide, gtaCover(src.catalog)));
  const archive = slidesOf(rows.slice().sort(byBell));
  return { bar, bell, banner, archive };
}

// The GTA VI box the catalogue already has. An announcement image the owner
// uploaded wins; this only fills a banner slide that names GTA VI and has none.
function gtaCover(catalog) {
  const rows = [].concat((catalog && catalog.upcoming) || [], (catalog && catalog.games) || []);
  const hit = rows.find(g => g && g.cover_image && /\b(grand theft auto|gta)\s*vi\b/i.test(String(g.title || '')));
  return hit ? String(hit.cover_image) : '';
}

function withCatalogArt(slide, cover) {
  if (!slide || slide.image || !cover) return slide;
  const blob = [slide.title, slide.titleAccent, slide.text, slide.label].filter(Boolean).join(' ');
  if (!/\b(grand theft auto|gta)\s*vi\b/i.test(blob)) return slide;
  return Object.assign({}, slide, { image: cover, imageFromCatalog: true });
}

function maxId(list) {
  return list.reduce((m, row) => Math.max(m, row && row.id ? row.id : 0), 0);
}

function apply(state, now) {
  const safe = state && typeof state === 'object' ? state : {};
  if (safe.migrations != null && !Array.isArray(safe.migrations)) {
    return { write: false, migrations: safe.migrations, announcements: safe.announcements, nextAnnouncementId: safe.nextAnnouncementId };
  }
  const migrations = Array.isArray(safe.migrations) ? safe.migrations.slice() : [];
  if (migrations.indexOf(MIGRATION_ID) !== -1) {
    return { write: false, migrations, announcements: safe.announcements, nextAnnouncementId: safe.nextAnnouncementId };
  }
  migrations.push(MIGRATION_ID);
  const at = now instanceof Date ? now : new Date();
  const stamp = themes.manilaWall(at);
  let list = Array.isArray(safe.announcements) ? safe.announcements.map(row => Object.assign({}, row)) : [];
  let nextId = whole(safe.nextAnnouncementId, 1, 1000000000, 0);
  if (!nextId || nextId <= maxId(list)) nextId = maxId(list) + 1;

  if (!list.length) {
    const legacy = safe.announcement;
    const text = legacy && legacy.text ? String(legacy.text) : '';
    if (text.trim()) {
      list.push({
        id: nextId,
        text,
        active: legacy.active !== false,
        place_bar: true,
        place_bell: true,
        place_banner: false,
        bell_new_days: 0,
        bell_pin: false,
        sort: 0,
        priority: 0,
        created_at: stamp,
        updated_at: stamp
      });
      nextId += 1;
    }
  } else {
    list = list.map((row, index) => {
      const copy = Object.assign({}, row);
      if (copy.place_bar === undefined) copy.place_bar = true;
      if (copy.place_bell === undefined) copy.place_bell = true;
      if (copy.place_banner === undefined) copy.place_banner = false;
      if (copy.bell_new_days === undefined) copy.bell_new_days = 0;
      if (copy.enabled === undefined && copy.active !== undefined) copy.enabled = copy.active !== false;
      if (copy.sort === undefined) copy.sort = index;
      if (!cleanWhen(copy.created_at)) copy.created_at = stamp;
      if (!cleanWhen(copy.updated_at)) copy.updated_at = cleanWhen(copy.created_at) || stamp;
      return copy;
    });
  }

  if (!list.some(row => row && row.bind === BIND_PROMO)) {
    list.push({
      id: nextId,
      bind: BIND_PROMO,
      enabled: true,
      title: '',
      text: '',
      button_label: 'Learn more',
      button_url: '/promos',
      place_bar: true,
      place_bell: true,
      place_banner: false,
      bell_new_days: 0,
      bell_pin: false,
      priority: 0,
      sort: list.length,
      audience: 'all',
      device: 'all',
      created_at: stamp,
      updated_at: stamp
    });
    nextId += 1;
  }

  return {
    write: true,
    migrations,
    announcements: list.map(normalizeEntry),
    nextAnnouncementId: nextId
  };
}

function readPlacements(body) {
  const b = body || {};
  return {
    place_bar: onFlag(b.place_bar, false),
    place_bell: onFlag(b.place_bell, false),
    place_banner: onFlag(b.place_banner, false)
  };
}

function save(entries, body, opts) {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeEntry).filter(e => e.id);
  const b = body || {};
  const options = opts || {};
  const now = options.now instanceof Date ? options.now : new Date();
  const stamp = themes.manilaWall(now);
  const images = options.images || {};
  const id = whole(b.id, 1, 1000000000, 0);
  const existing = id ? list.find(e => e.id === id) : null;
  const title = clip(b.title, 120);
  const text = clip(b.text, 400);
  const keepingBind = !!(existing && existing.bind === BIND_PROMO && !title && !text);
  if (!title && !text && !keepingBind) return { ok: false, error: 'blank' };
  const starts = cleanWhen(b.starts_at);
  const ends = cleanWhen(b.ends_at);
  if ((b.starts_at && !starts) || (b.ends_at && !ends)) return { ok: false, error: 'dates' };
  if (starts && ends && ends <= starts) return { ok: false, error: 'dates' };
  let nextId = whole(options.nextId, 1, 1000000000, maxId(list) + 1);
  if (nextId <= maxId(list)) nextId = maxId(list) + 1;
  const image = images.image ? themes.safeImage(images.image) : (onFlag(b.image_clear, false) ? '' : (existing ? existing.image : ''));
  const imageMobile = images.image_mobile ? themes.safeImage(images.image_mobile) : (onFlag(b.image_mobile_clear, false) ? '' : (existing ? existing.image_mobile : ''));
  const row = normalizeEntry({
    id: existing ? existing.id : nextId,
    enabled: onFlag(b.enabled, false),
    label: b.label,
    title: keepingBind ? '' : title,
    title_accent: hasOwn(b, 'title_accent') ? b.title_accent : (existing ? existing.title_accent : ''),
    text: keepingBind ? '' : text,
    button_label: b.button_label,
    button_url: b.button_url,
    button2_label: hasOwn(b, 'button2_label') ? b.button2_label : (existing ? existing.button2_label : ''),
    button2_url: hasOwn(b, 'button2_url') ? b.button2_url : (existing ? existing.button2_url : ''),
    countdown_at: hasOwn(b, 'countdown_at') ? b.countdown_at : (existing ? existing.countdown_at : ''),
    source_key: existing ? existing.source_key : '',
    starts_at: starts,
    ends_at: ends,
    priority: b.priority,
    sort: existing ? existing.sort : list.length,
    audience: b.audience,
    device: b.device,
    icon: b.icon,
    image,
    image_mobile: imageMobile,
    place_bar: readPlacements(b).place_bar,
    place_bell: readPlacements(b).place_bell,
    place_banner: readPlacements(b).place_banner,
    bell_new_days: b.bell_new_days === undefined || b.bell_new_days === '' ? (existing ? existing.bell_new_days : 7) : b.bell_new_days,
    bell_pin: b.bell_pin,
    bind: keepingBind ? BIND_PROMO : '',
    created_at: existing && existing.created_at ? existing.created_at : stamp,
    updated_at: stamp,
    version: String(now.getTime())
  });
  if (!existing) {
    list.push(row);
    nextId = row.id + 1;
  } else {
    const index = list.findIndex(e => e.id === existing.id);
    list[index] = row;
  }
  return { ok: true, entries: list, nextId, id: row.id };
}

function gtaCountdown(state) {
  const rows = [].concat((state && state.upcoming) || [], (state && state.games) || []);
  const hit = rows.find(g => g && /\b(grand theft auto|gta)\s*vi\b/i.test(String(g.title || '')));
  if (!hit || !hit.release_date || hit.release_date === 'TBA') return '';
  const day = String(hit.release_date).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day + 'T00:00' : '';
}

// The homepage bar's three lines, plus the GTA VI hero card. Added once.
// A row Michael already has (same source_key) is not touched, and neither is
// any other announcement. countdown_at is the catalogue release date when
// GTA VI is already in Games or Coming soon; otherwise it stays blank for
// the admin field.
function applyHomepage(state, now) {
  const safe = state && typeof state === 'object' ? state : {};
  if (safe.migrations != null && !Array.isArray(safe.migrations)) {
    return { write: false, migrations: safe.migrations, announcements: safe.announcements, nextAnnouncementId: safe.nextAnnouncementId, countdownFrom: '' };
  }
  const migrations = Array.isArray(safe.migrations) ? safe.migrations.slice() : [];
  if (migrations.indexOf(HOME_MIGRATION_ID) !== -1) {
    return { write: false, migrations, announcements: safe.announcements, nextAnnouncementId: safe.nextAnnouncementId, countdownFrom: '' };
  }
  migrations.push(HOME_MIGRATION_ID);
  const at = now instanceof Date ? now : new Date();
  const stamp = themes.manilaWall(at);
  const list = Array.isArray(safe.announcements) ? safe.announcements.slice() : [];
  const keys = new Set(list.map(row => row && row.source_key).filter(Boolean));
  let nextId = whole(safe.nextAnnouncementId, 1, 1000000000, 0);
  if (!nextId || nextId <= maxId(list)) nextId = maxId(list) + 1;
  const countdownFrom = gtaCountdown(safe);
  const seeds = [
    {
      source_key: 'home-bar-monthly10',
      enabled: true,
      icon: '🎮',
      text: 'Use code MONTHLY10 at checkout for 10% off monthly rentals. Promo ends Nov 30.',
      button_label: 'Learn more',
      button_url: '/announcements',
      place_bar: true,
      place_bell: false,
      place_banner: false,
      priority: 3,
      sort: 0,
      bell_new_days: 0
    },
    {
      source_key: 'home-bar-line',
      enabled: true,
      text: 'Sold out? Fall in line for free',
      button_label: 'Join the line',
      button_url: '/browse',
      place_bar: true,
      place_bell: false,
      place_banner: false,
      priority: 2,
      sort: 1,
      bell_new_days: 0
    },
    {
      source_key: 'home-bar-fifth',
      enabled: true,
      text: 'Every 5th paid rental is a free 7-day rental.',
      place_bar: true,
      place_bell: false,
      place_banner: false,
      priority: 1,
      sort: 2,
      bell_new_days: 0
    },
    {
      source_key: 'home-hero-gta6',
      enabled: true,
      label: 'Reservations open',
      title: 'GTA VI is coming.',
      title_accent: 'Reserve your slot now.',
      text: 'Grand Theft Auto VI Ultimate Edition reservations are open. Message us on Messenger and we\'ll hold your spot in line.',
      button_label: 'Reserve on Messenger',
      button_url: 'https://m.me/PlaystationHub00',
      button2_label: 'Browse new games',
      button2_url: '/browse?tab=new',
      place_bar: false,
      place_bell: true,
      place_banner: true,
      priority: 5,
      sort: 3,
      bell_new_days: 14,
      countdown_at: countdownFrom
    }
  ];
  seeds.forEach(seed => {
    if (keys.has(seed.source_key)) return;
    list.push(normalizeEntry(Object.assign({
      id: nextId,
      created_at: stamp,
      updated_at: stamp,
      version: String(at.getTime())
    }, seed)));
    nextId += 1;
  });
  return { write: true, migrations, announcements: list, nextAnnouncementId: nextId, countdownFrom };
}

function remove(entries, id) {
  const key = whole(id, 1, 1000000000, 0);
  return (Array.isArray(entries) ? entries : []).map(normalizeEntry).filter(e => e.id && e.id !== key);
}

function move(entries, id, dir) {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeEntry).filter(e => e.id);
  list.sort((a, b) => (a.sort - b.sort) || (a.id - b.id));
  const index = list.findIndex(e => e.id === whole(id, 1, 1000000000, 0));
  const next = dir === 'up' ? index - 1 : index + 1;
  if (index < 0 || next < 0 || next >= list.length) return list;
  const swapped = list.slice();
  const hold = swapped[index];
  swapped[index] = swapped[next];
  swapped[next] = hold;
  swapped.forEach((row, i) => { row.sort = i; });
  return swapped;
}

module.exports = {
  MIGRATION_ID,
  HOME_MIGRATION_ID,
  BAR_LIMIT,
  BELL_LIMIT,
  BIND_PROMO,
  normalizeEntry,
  scheduled,
  isLive,
  present,
  apply,
  applyHomepage,
  gtaCountdown,
  gtaCover,
  save,
  remove,
  move,
  safeUrl,
  dateLabel
};
