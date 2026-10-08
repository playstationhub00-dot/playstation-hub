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

module.exports = { PILL_COLORS, DESCRIPTION_MAX, defaultColor, pillColor, cleanColor, cleanDescription, tierOf };
