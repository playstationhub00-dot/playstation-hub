// Catalogue title typos and the old slugs they leave behind.
//
// Names live in the MongoDB state blob (and in order / request documents),
// not in source. applySlugTitles runs on server boot and renames only the
// four families whose URL token was wrong: assasins, calisto, berseker,
// triology. It touches customer-facing text fields and never ids, stored
// slugs, prices, or image paths. scripts/rename-game-titles.js still applies
// the full set (those four, plus NBA2K27, Silent Hill Townfall, and
// afdordable) to the blob, to orders.game_title, and to game_requests.title
// when someone runs it. Request-board #req- slugs are not in TEXT_KEYS, so
// old request anchors stay put.
//
// publicSlug is the URL the site publishes. It corrects those four tokens
// even when the stored title has not been renamed yet, and it folds the
// previous apostrophe alias assassin-s-creed-shadows into
// assassins-creed-shadows. Black Flag stays
// assassin-s-creed-black-flag-resynced. NBA2K27 stays nba2k27 until the
// title is actually "NBA 2K27". redirectSlug still accepts nba-2k27 as an
// alias of that live slug.

const EXACT = Object.freeze({
  'resident evil remake triology': 'Resident Evil Remake Trilogy',
  'khazan the first berseker': 'Khazan The First Berserker',
  'assasins creed shadows': 'Assassins Creed Shadows',
  'calisto protocol': 'Callisto Protocol',
  'silent hill townfall': 'Silent Hill: Townfall',
  'nba2k27': 'NBA 2K27'
});

// Boot renames these only. NBA2K27 and Townfall change the published slug
// in a way the rest of the site still treats as optional, so they stay on
// the manual script.
const SLUG_EXACT = new Set([
  'resident evil remake triology',
  'khazan the first berseker',
  'assasins creed shadows',
  'calisto protocol'
]);

const ASSASSINS_PREFIX = 'assasins creed shadows';
const ASSASSINS_REBUILD = 'Assassins Creed Shadows';

// Fields that hold a title or a sentence a customer reads. Names, slugs,
// passwords and image paths are not in this set — a person's name is not a
// review, and a request slug has to stay put so old #req- links keep working.
const TEXT_KEYS = new Set([
  'title', 'game_title', 'game_rented', 'text', 'description', 'games_list', 'subtitle'
]);

const SLUG_TOKEN_PAIRS = [
  ['assasins', 'assassins'],
  ['calisto', 'callisto'],
  ['berseker', 'berserker'],
  ['triology', 'trilogy']
];

function applySlugTokens(s) {
  return String(s)
    .replace(/\bTriology\b/g, 'Trilogy')
    .replace(/\bBerseker\b/g, 'Berserker')
    .replace(/\bAssasins\b/g, 'Assassins')
    .replace(/\bCalisto\b/g, 'Callisto');
}

function applyOtherTokens(s) {
  return String(s)
    .replace(/\bafdordable\b/gi, 'affordable')
    .replace(/TownFall/g, 'Townfall')
    .replace(/Silent Hill(?!:)\s+Townfall/g, 'Silent Hill: Townfall')
    .replace(/\bNBA2K27\b/g, 'NBA 2K27');
}

function rebuildAssassins(body) {
  const norm = body.toLowerCase();
  if (!norm.startsWith(ASSASSINS_PREFIX)) return null;
  const nextCh = norm.charAt(ASSASSINS_PREFIX.length);
  if (nextCh && /[a-z0-9]/.test(nextCh)) return null;
  return ASSASSINS_REBUILD + body.slice(ASSASSINS_PREFIX.length);
}

// The four URL families only. A second pass is a no-op, and NBA2K27,
// Townfall, and afdordable are left for the manual script.
function fixSlugTitle(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  const lead = (value.match(/^\s*/) || [''])[0];
  const trail = (value.match(/\s*$/) || [''])[0];
  const body = value.trim();
  const norm = body.toLowerCase();
  if (SLUG_EXACT.has(norm)) {
    return value === EXACT[norm] ? value : EXACT[norm];
  }
  const rebuilt = rebuildAssassins(body);
  if (rebuilt != null) {
    const next = lead + applySlugTokens(rebuilt) + trail;
    return next === value ? value : next;
  }
  const next = applySlugTokens(value);
  return next === value ? value : next;
}

function fixString(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  const lead = (value.match(/^\s*/) || [''])[0];
  const trail = (value.match(/\s*$/) || [''])[0];
  const body = value.trim();
  const norm = body.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(EXACT, norm)) {
    return value === EXACT[norm] ? value : EXACT[norm];
  }
  const rebuilt = rebuildAssassins(body);
  if (rebuilt != null) {
    const next = lead + applyOtherTokens(applySlugTokens(rebuilt)) + trail;
    return next === value ? value : next;
  }
  const next = applyOtherTokens(applySlugTokens(value));
  return next === value ? value : next;
}

function applyWith(state, fix) {
  const changes = [];
  function walk(value, path, key) {
    if (Array.isArray(value)) {
      return value.map((item, i) => walk(item, path + '[' + i + ']', null));
    }
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(k => {
        out[k] = walk(value[k], (path ? path + '.' : '') + k, k);
      });
      return out;
    }
    if (typeof value === 'string' && key && TEXT_KEYS.has(key)) {
      const next = fix(value);
      if (next !== value) changes.push({ path, from: value, to: next });
      return next;
    }
    return value;
  }
  return { state: walk(state || {}, '', null), changes };
}

function applyToState(state) {
  return applyWith(state, fixString);
}

function applySlugTitles(state) {
  return applyWith(state, fixSlugTitle);
}

function rawSlug(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Published game/upcoming/bundle slug. Idempotent: the corrected token is
// not a superstring of the typo (assassins does not contain assasins,
// callisto does not contain calisto, and the same for berserker/trilogy).
function publicSlug(title) {
  let s = rawSlug(title);
  SLUG_TOKEN_PAIRS.forEach(([from, to]) => {
    if (s.includes(from)) s = s.split(from).join(to);
  });
  // The previous rename target was "Assassin's", which slugged to
  // assassin-s-creed-shadows. That alias belongs on the assassins URL.
  // Black Flag's assassin-s-creed-black-flag-resynced does not match.
  if (s.includes('assassin-s-creed-shadows')) {
    s = s.split('assassin-s-creed-shadows').join('assassins-creed-shadows');
  }
  return s;
}

function redirectBase(slug) {
  let s = String(slug || '');
  let changed = false;
  SLUG_TOKEN_PAIRS.forEach(([from, to]) => {
    if (s.includes(from)) {
      s = s.split(from).join(to);
      changed = true;
    }
  });
  if (s.includes('assassin-s-creed-shadows')) {
    s = s.split('assassin-s-creed-shadows').join('assassins-creed-shadows');
    changed = true;
  }
  if (s.includes('nba2k27')) {
    s = s.split('nba2k27').join('nba-2k27');
    changed = true;
  }
  return changed ? s : null;
}

// Upcoming URLs are "<title-slug>-<id>". Only peel that id off when the title
// part itself is a known typo, so a normal slug that happens to end in a
// number (or "-2") is left alone.
function redirectSlug(slug) {
  const s = String(slug || '');
  const idMatch = s.match(/-(\d+)$/);
  if (idMatch) {
    const base = s.slice(0, -idMatch[0].length);
    const next = redirectBase(base);
    if (next) return next + idMatch[0];
  }
  return redirectBase(s);
}

// True when `requested` is the stored title's slug, or one of the two is the
// pre-rename form of the other. NBA2K27 is not renamed on boot, so its live
// slug stays nba2k27 while redirectSlug still points that spelling at
// nba-2k27. Both have to resolve. This does not invent a hyphen between
// letters and digits for any other title.
function slugMatches(storedSlug, requested) {
  const stored = String(storedSlug || '');
  const req = String(requested || '');
  if (!stored || !req) return false;
  if (stored === req) return true;
  const fromReq = redirectSlug(req);
  if (fromReq && fromReq === stored) return true;
  const fromStored = redirectSlug(stored);
  return !!(fromStored && fromStored === req);
}

// Exact slug wins, so two live titles that are each other's old and new
// spelling do not steal one another's URL. The alias is only for a form
// no current title already uses.
function findBySlug(items, requested, slugOf) {
  const list = Array.isArray(items) ? items : [];
  const toSlug = typeof slugOf === 'function' ? slugOf : (item => item && item.slug);
  const exact = list.find(item => toSlug(item) === requested);
  if (exact) return exact;
  return list.find(item => slugMatches(toSlug(item), requested)) || null;
}

module.exports = {
  EXACT,
  TEXT_KEYS,
  fixString,
  fixSlugTitle,
  applyToState,
  applySlugTitles,
  publicSlug,
  redirectSlug,
  slugMatches,
  findBySlug
};
