// Catalogue title typos and the old slugs they leave behind.
//
// Names live in the MongoDB state blob (and in order / request documents),
// not in source. scripts/rename-game-titles.js applies fixString / applyToState
// when someone runs it. redirectSlug is what the public routes use so a link
// saved before the rename still lands on the game. Silent Hill: Townfall does
// not change slug — the colon collapses to the same hyphenation.

const EXACT = Object.freeze({
  'resident evil remake triology': 'Resident Evil Remake Trilogy',
  'khazan the first berseker': 'Khazan The First Berserker',
  'assasins creed shadows': "Assassin's Creed Shadows",
  'silent hill townfall': 'Silent Hill: Townfall',
  'nba2k27': 'NBA 2K27'
});

const ASSASSINS_PREFIX = 'assasins creed shadows';

// Fields that hold a title or a sentence a customer reads. Names, slugs,
// passwords and image paths are not in this set — a person's name is not a
// review, and a request slug has to stay put so old #req- links keep working.
const TEXT_KEYS = new Set([
  'title', 'game_title', 'game_rented', 'text', 'description', 'games_list', 'subtitle'
]);

function applyTokens(s) {
  return String(s)
    .replace(/\bafdordable\b/gi, 'affordable')
    .replace(/\bTriology\b/g, 'Trilogy')
    .replace(/\bBerseker\b/g, 'Berserker')
    .replace(/\bAssasins\b/g, "Assassin's")
    .replace(/TownFall/g, 'Townfall')
    .replace(/Silent Hill(?!:)\s+Townfall/g, 'Silent Hill: Townfall')
    .replace(/\bNBA2K27\b/g, 'NBA 2K27');
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
  if (norm.startsWith(ASSASSINS_PREFIX)) {
    const nextCh = norm.charAt(ASSASSINS_PREFIX.length);
    if (!nextCh || !/[a-z0-9]/.test(nextCh)) {
      const rebuilt = "Assassin's Creed Shadows" + body.slice(ASSASSINS_PREFIX.length);
      const next = lead + applyTokens(rebuilt) + trail;
      return next === value ? value : next;
    }
  }
  const next = applyTokens(value);
  return next === value ? value : next;
}

function applyToState(state) {
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
      const next = fixString(value);
      if (next !== value) changes.push({ path, from: value, to: next });
      return next;
    }
    return value;
  }
  return { state: walk(state || {}, '', null), changes };
}

function redirectBase(slug) {
  let s = String(slug || '');
  let changed = false;
  if (s.includes('triology')) { s = s.replace(/triology/g, 'trilogy'); changed = true; }
  if (s.includes('berseker')) { s = s.replace(/berseker/g, 'berserker'); changed = true; }
  if (s.includes('assasins')) { s = s.replace(/assasins/g, 'assassin-s'); changed = true; }
  if (s.includes('nba2k27')) { s = s.replace(/nba2k27/g, 'nba-2k27'); changed = true; }
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

module.exports = {
  EXACT,
  TEXT_KEYS,
  fixString,
  applyToState,
  redirectSlug
};
