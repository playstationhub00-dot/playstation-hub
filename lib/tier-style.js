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

// The band on a storefront card. The price category name is the usual source.
// A GTA VI title, or the GTA VI Ultimate price set, is ULTIMATE even when the
// category was named New Games.
function storefrontBand(game, tier) {
  const name = String((tier && tier.name) || '');
  const title = String((game && game.title) || '');
  if (/ps\s*plus|playstation plus/i.test(name)) return { key: 'psplus', label: 'PS PLUS DELUXE' };
  if (/gta|ultimate/i.test(name) || isGtaViTitle(title) || isUltimatePriceTier(game)) {
    return { key: 'ultimate', label: 'ULTIMATE' };
  }
  if (!name) return null;
  if (/new games/i.test(name)) return { key: 'new', label: 'NEW GAMES' };
  if (/deluxe/i.test(name)) return { key: 'deluxe', label: 'DELUXE' };
  if (/special/i.test(name)) return { key: 'special', label: 'SPECIAL' };
  if (/regular/i.test(name)) return { key: 'regular', label: 'REGULAR' };
  return { key: 'other', label: name.toUpperCase() };
}

module.exports = {
  PILL_COLORS, DESCRIPTION_MAX, defaultColor, pillColor, cleanColor, cleanDescription, tierOf,
  isGtaViTitle, isUltimatePriceTier, storefrontBand
};
