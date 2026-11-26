// How a price category ("tier") looks to customers: the colour of its pill on
// game cards and the game page, and its one-line description. Set by the owner
// in Admin → Games → Price Categories; a category with no colour picked gets one
// from its name. See docs/superpowers/specs/2026-10-09-browse-filters-tiers-design.md.
const PILL_COLORS = ['blue', 'purple', 'coral', 'grey', 'teal', 'pink'];
const DESCRIPTION_MAX = 120;

function defaultColor(name) {
  const n = String(name == null ? '' : name).toLowerCase();
  if (n.includes('new')) return 'blue';
  if (n.includes('deluxe')) return 'purple';
  if (n.includes('special')) return 'coral';
  return 'grey';
}

function pillColor(cat) {
  if (!cat) return 'grey';
  return PILL_COLORS.includes(cat.pill_color) ? cat.pill_color : defaultColor(cat.name);
}

// A submitted colour, or null when it isn't one of the six.
function cleanColor(raw) {
  return PILL_COLORS.includes(raw) ? raw : null;
}

// One line, spaces squeezed, at most 120 characters.
function cleanDescription(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX);
}

// The tier a card or game page shows, or null (no category, or it was deleted).
function tierOf(game, categories) {
  if (!game || !game.price_category_id) return null;
  const cat = (categories || []).find(c => c.id === Number(game.price_category_id));
  return cat ? { id: cat.id, name: cat.name, color: pillColor(cat), description: cat.description || '' } : null;
}

function priceNum(game, key) {
  return Number(game && game[key]) || 0;
}

// "GTA V" must not count. VI and 6 do.
function isGtaViTitle(title) {
  return /\bgrand theft auto\s*(vi|6)\b|\bgta\s*(vi|6)\b/i.test(String(title || ''));
}

// The GTA VI Ultimate list prices. Display only: this does not change what is charged.
function isUltimatePriceTier(game) {
  return priceNum(game, 'nt_price_7d') === 449
    && priceNum(game, 'nt_price_30d') === 899
    && priceNum(game, 'tr_price_7d') === 499
    && priceNum(game, 'tr_price_30d') === 999;
}

// Weekly / monthly list prices. Non-Trophy is checked first: Regular's trophy
// pair (249/549) is the same as Special's non-trophy pair.
const LIST_BANDS = [
  { key: 'regular', label: 'REGULAR', nt: [199, 499], tr: [249, 549] },
  { key: 'special', label: 'SPECIAL', nt: [249, 549], tr: [299, 599] },
  { key: 'deluxe', label: 'DELUXE', nt: [299, 599], tr: [349, 699] },
  { key: 'new', label: 'NEW GAMES', nt: [349, 699], tr: [399, 799] },
  { key: 'ultimate', label: 'ULTIMATE', nt: [449, 899], tr: [499, 999] }
];

function bandFromListPrices(game) {
  const nt7 = priceNum(game, 'nt_price_7d');
  const nt30 = priceNum(game, 'nt_price_30d');
  if (nt7 > 0 && nt30 > 0) {
    const hit = LIST_BANDS.find(row => row.nt[0] === nt7 && row.nt[1] === nt30);
    return hit ? { key: hit.key, label: hit.label } : null;
  }
  const tr7 = priceNum(game, 'tr_price_7d');
  const tr30 = priceNum(game, 'tr_price_30d');
  if (tr7 > 0 && tr30 > 0) {
    const hit = LIST_BANDS.find(row => row.tr[0] === tr7 && row.tr[1] === tr30);
    return hit ? { key: hit.key, label: hit.label } : null;
  }
  return null;
}

// The band on a storefront card. A price category wins, including a category
// the owner names Ultimate. Bundles use the same mapping. With no category,
// the list prices pick the band, non-trophy first. A GTA VI title still reads
// ULTIMATE when its category was left on New Games.
function storefrontBand(game, tier) {
  const name = String((tier && tier.name) || '').replace(/\s+/g, ' ').trim();
  const title = String((game && game.title) || '');
  if (/ps\s*plus|playstation plus/i.test(name)) return { key: 'psplus', label: 'PS PLUS DELUXE' };
  if (/\b(?:ultimate|gta)\b/i.test(name) || isGtaViTitle(title)) return { key: 'ultimate', label: 'ULTIMATE' };
  if (/new games/i.test(name)) return { key: 'new', label: 'NEW GAMES' };
  if (/deluxe/i.test(name)) return { key: 'deluxe', label: 'DELUXE' };
  if (/special/i.test(name)) return { key: 'special', label: 'SPECIAL' };
  if (/regular/i.test(name)) return { key: 'regular', label: 'REGULAR' };
  if (name) return { key: 'other', label: name.toUpperCase() };
  return bandFromListPrices(game);
}

module.exports = {
  PILL_COLORS, DESCRIPTION_MAX, defaultColor, pillColor, cleanColor, cleanDescription, tierOf,
  isGtaViTitle, isUltimatePriceTier, bandFromListPrices, storefrontBand
};
