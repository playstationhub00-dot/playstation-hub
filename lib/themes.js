// Storefront theme presets. Colors ride the CSS variables already declared
// on :root in public/css/style.css (--ps-blue, --bg-dark, --bg-card,
// --text-primary, --text-secondary, --border, --accent). The active preset
// is chosen per request from site_settings.themes and written into the HTML
// as an inline style plus a data-theme attribute. The stylesheet itself
// stays theme-agnostic so Cloudflare can keep caching it.
//
// Schedules are wall times in Asia/Manila (UTC+8), stored as
// YYYY-MM-DDTHH:mm with no offset. A window is [start, end): the end
// instant belongs to whatever comes next.

const brandLogo = require('./brand-logo');

const MIGRATION_ID = 'theme-presets-2026-10-29';
const ZONE = 'Asia/Manila';
const DEFAULT_PROMO_TEXT = 'Use code MONTHLY10 for 10% off monthly rentals.';
const DEFAULT_PROMO_CODE = 'MONTHLY10';
const CHRISTMAS_START = '2026-12-01T00:00';
const CHRISTMAS_END = '2026-12-26T00:00';
const HALLOWEEN_END = '2026-11-01T00:00';

const SOLD_BG = '#2b2b2b';
const SOLD_FG = '#f1f1f1';

// Shared by Hub Classic and Sale Mode. Sale Mode only adds the promo strip.
const CLASSIC_COLORS = {
  bg: '#0a0a0a',
  card: '#141414',
  border: '#262626',
  accent: '#F5B800',
  accentText: '#F5B800',
  btnFg: '#0a0a0a',
  btnHover: '#FFD700',
  text: '#ffffff',
  muted: '#a8a8a8',
  footer: '#070707',
  badgeNewBg: '#F5B800',
  badgeNewFg: '#0a0a0a',
  badgeReserveBg: '#1f1a08',
  badgeReserveFg: '#F5B800',
  badgeSoldBg: SOLD_BG,
  badgeSoldFg: SOLD_FG
};

const PRESETS = {
  classic: {
    id: 'classic',
    name: 'Hub Classic',
    colors: CLASSIC_COLORS,
    decor: '',
    kicker: 'Now playing',
    promoDefault: false
  },
  blue: {
    id: 'blue',
    name: 'PS Blue',
    colors: {
      bg: '#07101f',
      card: '#0f1e38',
      border: '#1d3358',
      accent: '#0070D1',
      accentText: '#4DA6FF',
      btnFg: '#ffffff',
      btnHover: '#1A8FE8',
      text: '#ffffff',
      muted: '#a9b8d0',
      footer: '#050c18',
      badgeNewBg: '#0070D1',
      badgeNewFg: '#ffffff',
      badgeReserveBg: '#0b2447',
      badgeReserveFg: '#7fbfff',
      badgeSoldBg: SOLD_BG,
      badgeSoldFg: SOLD_FG
    },
    decor: '',
    kicker: 'Now playing',
    promoDefault: false
  },
  halloween: {
    id: 'halloween',
    name: 'Halloween',
    colors: {
      bg: '#090605',
      card: '#16100b',
      border: '#33200f',
      accent: '#FF7A00',
      accentText: '#FF8F26',
      btnFg: '#0a0a0a',
      btnHover: '#FF9A33',
      text: '#ffffff',
      muted: '#bfae9c',
      footer: '#050302',
      badgeNewBg: '#FF7A00',
      badgeNewFg: '#0a0a0a',
      badgeReserveBg: '#2a1503',
      badgeReserveFg: '#FF9A3D',
      badgeSoldBg: SOLD_BG,
      badgeSoldFg: SOLD_FG
    },
    decor: 'halloween',
    kicker: 'Fright Night pick',
    promoDefault: false
  },
  christmas: {
    id: 'christmas',
    name: 'Christmas',
    colors: {
      bg: '#0b2618',
      card: '#123a27',
      border: '#1f5139',
      accent: '#C8102E',
      accentText: '#F2C14E',
      btnFg: '#ffffff',
      btnHover: '#E02445',
      text: '#ffffff',
      muted: '#b9d3c3',
      footer: '#071a10',
      badgeNewBg: '#C8102E',
      badgeNewFg: '#ffffff',
      badgeReserveBg: '#3a2d0c',
      badgeReserveFg: '#F2C14E',
      badgeSoldBg: SOLD_BG,
      badgeSoldFg: SOLD_FG
    },
    decor: 'christmas',
    kicker: 'Holiday pick',
    promoDefault: false
  },
  sale: {
    id: 'sale',
    name: 'Sale Mode',
    colors: CLASSIC_COLORS,
    decor: '',
    kicker: 'Now playing',
    promoDefault: true
  }
};

const IDS = ['classic', 'blue', 'halloween', 'christmas', 'sale'];
const CATALOG = IDS.map(id => PRESETS[id]);

const PROMO_STRIP = {
  bg: '#D7263D',
  fg: '#ffffff',
  chipBg: '#ffffff',
  chipFg: '#B3122A'
};

function clip(value, max) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function cleanWhen(value) {
  const s = clip(value, 16);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? s : '';
}

function safeImage(value) {
  const s = String(value || '');
  return /^\/uploads\/[A-Za-z0-9._-]+\.(webp|png|jpe?g|gif)$/.test(s) ? s : '';
}

function emptyPreset() {
  return { start: '', end: '', line1: '', highlight: '', line2: '', hero_image: '' };
}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrast(a, b) {
  const L1 = luminance(a);
  const L2 = luminance(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

function assertHex(hex) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) throw new Error('theme color is not a hex: ' + hex);
  return hex;
}

function cssDecls(preset) {
  const c = preset.colors;
  Object.keys(c).forEach(k => assertHex(c[k]));
  // --ps-blue is the small-text accent (readable on the dark page).
  // Buttons use --theme-btn, which is the stronger fill.
  // style.css redeclares :root later in the page, so the view also writes
  // these onto the <html> style attribute, which beats that stylesheet.
  return '--bg-dark:' + c.bg + ';' +
    '--bg-card:' + c.card + ';' +
    '--bg-card-hover:' + c.card + ';' +
    '--text-primary:' + c.text + ';' +
    '--text-secondary:' + c.muted + ';' +
    '--border:' + c.border + ';' +
    '--accent:' + c.accentText + ';' +
    '--ps-blue:' + c.accentText + ';' +
    '--ps-dark-blue:' + c.accent + ';' +
    '--ps-light-blue:' + c.accentText + ';' +
    '--warning:' + c.accentText + ';' +
    '--theme-btn:' + c.accent + ';' +
    '--theme-btn-fg:' + c.btnFg + ';' +
    '--theme-btn-hover:' + c.btnHover + ';' +
    '--theme-accent-text:' + c.accentText + ';' +
    '--theme-footer:' + c.footer + ';' +
    '--badge-new-bg:' + c.badgeNewBg + ';' +
    '--badge-new-fg:' + c.badgeNewFg + ';' +
    '--badge-reserve-bg:' + c.badgeReserveBg + ';' +
    '--badge-reserve-fg:' + c.badgeReserveFg + ';' +
    '--badge-sold-bg:' + c.badgeSoldBg + ';' +
    '--badge-sold-fg:' + c.badgeSoldFg + ';';
}

function cssVars(preset) {
  return ':root{' + cssDecls(preset) + '}';
}

function keyPairs(preset) {
  const c = preset.colors;
  return [
    ['body text on background', c.text, c.bg],
    ['secondary text on background', c.muted, c.bg],
    ['secondary text on card', c.muted, c.card],
    ['button label on button', c.btnFg, c.accent],
    ['accent text on background', c.accentText, c.bg],
    ['accent text on card', c.accentText, c.card],
    ['New badge label on badge', c.badgeNewFg, c.badgeNewBg],
    ['Reserve badge label on badge', c.badgeReserveFg, c.badgeReserveBg],
    ['Sold Out badge label on badge', c.badgeSoldFg, c.badgeSoldBg]
  ];
}

function promoStripPairs() {
  return [
    ['promo strip text on strip', PROMO_STRIP.fg, PROMO_STRIP.bg],
    ['promo code on chip', PROMO_STRIP.chipFg, PROMO_STRIP.chipBg]
  ];
}

function manilaWall(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.create(null);
  fmt.formatToParts(date).forEach(p => { parts[p.type] = p.value; });
  let hour = parts.hour;
  if (hour === '24') hour = '00';
  return parts.year + '-' + parts.month + '-' + parts.day + 'T' + hour + ':' + parts.minute;
}

function parseManila(wall) {
  if (!wall) return null;
  const d = new Date(wall + ':00+08:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatWall(wall) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall || '');
  if (!m) return wall || '';
  return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] + ', ' + m[4] + ':' + m[5];
}

function covers(row, now) {
  const start = parseManila(row.start);
  const end = parseManila(row.end);
  if (!start && !end) return false;
  if (start && now < start) return false;
  if (end && now >= end) return false;
  return true;
}

function scheduleState(row, now) {
  if (!row.start && !row.end) return 'none';
  if (covers(row, now)) return 'active';
  const start = parseManila(row.start);
  if (start && now < start) return 'upcoming';
  return 'ended';
}

function readPreset(row) {
  const src = row && typeof row === 'object' ? row : {};
  return {
    start: cleanWhen(src.start),
    end: cleanWhen(src.end),
    line1: clip(src.line1, 80),
    highlight: clip(src.highlight, 80),
    line2: clip(src.line2, 80),
    hero_image: safeImage(src.hero_image)
  };
}

function normalize(stored) {
  const src = stored && typeof stored === 'object' ? stored : {};
  const srcPresets = src.presets && typeof src.presets === 'object' ? src.presets : {};
  const presets = {};
  IDS.forEach(id => { presets[id] = readPreset(srcPresets[id]); });
  const promo = src.promo && typeof src.promo === 'object' ? src.promo : {};
  const mode = promo.mode === 'on' || promo.mode === 'off' ? promo.mode : 'auto';
  return {
    base: IDS.indexOf(src.base) !== -1 ? src.base : 'classic',
    promo: {
      text: promo.text !== undefined && promo.text !== null ? clip(promo.text, 180) : DEFAULT_PROMO_TEXT,
      code: promo.code !== undefined && promo.code !== null ? clip(promo.code, 40) : DEFAULT_PROMO_CODE,
      mode
    },
    presets
  };
}

function seed(now) {
  const themes = normalize(null);
  const halloween = themes.presets.halloween;
  halloween.start = manilaWall(now instanceof Date ? now : new Date());
  halloween.end = HALLOWEEN_END;
  halloween.line1 = 'Dare to Play';
  halloween.highlight = 'After Dark';
  const christmas = themes.presets.christmas;
  christmas.start = CHRISTMAS_START;
  christmas.end = CHRISTMAS_END;
  christmas.line1 = 'Unwrap a';
  christmas.highlight = 'New Adventure';
  return themes;
}

function mergeMissing(current, seeded) {
  const cur = current && typeof current === 'object' ? current : {};
  const curPresets = cur.presets && typeof cur.presets === 'object' ? cur.presets : {};
  const presets = {};
  IDS.forEach(id => {
    const have = curPresets[id];
    const seedRow = seeded.presets[id];
    if (!have || typeof have !== 'object') {
      presets[id] = Object.assign({}, seedRow);
      return;
    }
    presets[id] = {
      start: have.start !== undefined ? cleanWhen(have.start) : seedRow.start,
      end: have.end !== undefined ? cleanWhen(have.end) : seedRow.end,
      line1: have.line1 !== undefined ? clip(have.line1, 80) : seedRow.line1,
      highlight: have.highlight !== undefined ? clip(have.highlight, 80) : seedRow.highlight,
      line2: have.line2 !== undefined ? clip(have.line2, 80) : seedRow.line2,
      hero_image: have.hero_image !== undefined ? safeImage(have.hero_image) : seedRow.hero_image
    };
  });
  const promo = cur.promo && typeof cur.promo === 'object' ? cur.promo : null;
  return {
    base: IDS.indexOf(cur.base) !== -1 ? cur.base : seeded.base,
    promo: promo ? {
      text: promo.text !== undefined ? clip(promo.text, 180) : seeded.promo.text,
      code: promo.code !== undefined ? clip(promo.code, 40) : seeded.promo.code,
      mode: promo.mode === 'on' || promo.mode === 'off' || promo.mode === 'auto' ? promo.mode : seeded.promo.mode
    } : seeded.promo,
    presets
  };
}

// One boot write. Records the flag and fills only fields that are not
// already stored, so an edit made before this ships is left alone.
function apply(state, now) {
  const safe = state && typeof state === 'object' ? state : {};
  const existingMigrations = safe.migrations;
  const current = safe.site_settings && safe.site_settings.themes;
  if (existingMigrations != null && !Array.isArray(existingMigrations)) {
    return { write: false, migrations: existingMigrations, themes: current };
  }
  const migrations = Array.isArray(existingMigrations) ? existingMigrations.slice() : [];
  if (migrations.indexOf(MIGRATION_ID) !== -1) {
    // Flag is set. If the presets object is still there, leave it — including
    // a headline or schedule an admin cleared. If a later sync dropped the
    // object and left the flag, seed again. site_settings.theme is not touched.
    if (current && typeof current === 'object' && current.presets && typeof current.presets === 'object') {
      return { write: false, migrations, themes: current };
    }
    const again = seed(now || new Date());
    const repaired = current && typeof current === 'object' ? mergeMissing(current, again) : again;
    return { write: true, migrations, themes: repaired };
  }
  migrations.push(MIGRATION_ID);
  const seeded = seed(now || new Date());
  const themes = current && typeof current === 'object' ? mergeMissing(current, seeded) : seeded;
  return { write: true, migrations, themes };
}

function headlineOf(row) {
  if (!row.line1 && !row.highlight && !row.line2) return null;
  return { line1: row.line1, highlight: row.highlight, line2: row.line2 };
}

function promoVisible(promo, id) {
  if (promo.mode === 'on') return true;
  if (promo.mode === 'off') return false;
  return PRESETS[id].promoDefault === true;
}

function rangeLabel(row) {
  if (row.start && row.end) return formatWall(row.start) + ' – ' + formatWall(row.end);
  if (row.start) return 'from ' + formatWall(row.start);
  if (row.end) return 'until ' + formatWall(row.end);
  return '';
}

function present(stored, id, row, extra) {
  const preset = PRESETS[id];
  const headline = headlineOf(row);
  return {
    id,
    name: preset.name,
    className: 'theme-' + id,
    decor: preset.decor,
    kicker: preset.kicker,
    logo: brandLogo.variantForBackground(preset.colors.bg),
    colors: preset.colors,
    css: cssVars(preset),
    declarations: cssDecls(preset),
    headline,
    heroImage: row.hero_image,
    promo: {
      show: promoVisible(stored.promo, id),
      text: stored.promo.text,
      code: stored.promo.code,
      bg: PROMO_STRIP.bg,
      fg: PROMO_STRIP.fg
    },
    garland: preset.decor === 'christmas',
    preview: false,
    baseId: stored.base,
    baseName: PRESETS[stored.base].name,
    nowLabel: '',
    why: '',
    states: {},
    overlap: '',
    extra: extra || null
  };
}

// previewId is an allow-listed preset id from ?theme=, or ''.
function resolve(stored, now, previewId) {
  const themes = normalize(stored);
  const at = now instanceof Date ? now : new Date();
  const hits = [];
  IDS.forEach((id, index) => {
    const row = themes.presets[id];
    if (!covers(row, at)) return;
    const start = parseManila(row.start);
    hits.push({ id, index, startMs: start ? start.getTime() : Number.NEGATIVE_INFINITY, row });
  });
  hits.sort((a, b) => (b.startMs - a.startMs) || (b.index - a.index));
  const baseId = themes.base;
  let chosen = hits.length ? hits[0].id : baseId;
  let via = hits.length ? 'schedule' : 'base';
  const preview = IDS.indexOf(previewId) !== -1 ? previewId : '';
  if (preview) {
    chosen = preview;
    via = 'preview';
  }
  const row = themes.presets[chosen];
  const view = present(themes, chosen, row);
  view.nowLabel = formatWall(manilaWall(at));
  const states = {};
  IDS.forEach(id => { states[id] = scheduleState(themes.presets[id], at); });
  view.states = states;
  if (via === 'preview') {
    const realId = hits.length ? hits[0].id : baseId;
    view.preview = true;
    view.why = 'Preview of ' + PRESETS[chosen].name + '. Visitors without ?theme= on the address see ' + PRESETS[realId].name + '.';
  } else if (via === 'schedule') {
    const label = rangeLabel(hits[0].row);
    view.why = PRESETS[chosen].name + ' is live because its schedule (' + label + ', Asia/Manila) includes now.';
    if (hits.length > 1) {
      view.overlap = PRESETS[hits[1].id].name;
      view.why += ' ' + PRESETS[hits[1].id].name + ' is also scheduled, and ' + PRESETS[chosen].name + ' wins because it started later.';
    }
  } else {
    view.why = PRESETS[chosen].name + ' is live because no theme schedule includes now. It is the base theme.';
  }
  return view;
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

// Admin save. A missing text field is left as stored, so a partial post
// cannot wipe a schedule. A present empty date clears that end. The clear
// checkbox drops the hero image; a new upload path replaces it.
function applyAdminSave(stored, body, images) {
  const cur = normalize(stored);
  const b = body || {};
  const pics = images || {};
  if (IDS.indexOf(b.base) !== -1) cur.base = b.base;
  if (b.promo_mode === 'on' || b.promo_mode === 'off' || b.promo_mode === 'auto') cur.promo.mode = b.promo_mode;
  if (hasOwn(b, 'promo_text')) cur.promo.text = clip(b.promo_text, 180);
  if (hasOwn(b, 'promo_code')) cur.promo.code = clip(b.promo_code, 40);
  IDS.forEach(id => {
    const row = cur.presets[id];
    if (hasOwn(b, id + '_start')) row.start = cleanWhen(b[id + '_start']);
    if (hasOwn(b, id + '_end')) row.end = cleanWhen(b[id + '_end']);
    if (hasOwn(b, id + '_line1')) row.line1 = clip(b[id + '_line1'], 80);
    if (hasOwn(b, id + '_highlight')) row.highlight = clip(b[id + '_highlight'], 80);
    if (hasOwn(b, id + '_line2')) row.line2 = clip(b[id + '_line2'], 80);
    if (hasOwn(b, id + '_hero_clear')) row.hero_image = '';
    if (pics[id]) row.hero_image = safeImage(pics[id]);
  });
  return cur;
}

module.exports = {
  MIGRATION_ID,
  ZONE,
  IDS,
  PRESETS,
  CATALOG,
  PROMO_STRIP,
  DEFAULT_PROMO_TEXT,
  DEFAULT_PROMO_CODE,
  CHRISTMAS_START,
  CHRISTMAS_END,
  HALLOWEEN_END,
  normalize,
  seed,
  apply,
  resolve,
  applyAdminSave,
  contrast,
  keyPairs,
  promoStripPairs,
  manilaWall,
  parseManila,
  formatWall,
  covers,
  scheduleState,
  cssVars,
  safeImage
};
