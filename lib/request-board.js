// How a stocked request is linked from /requests.
//
// "Stocked" means the owner is fulfilling the ask. It does not mean the game
// can be rented today. A Coming soon title (reservations open, not released)
// must stay a reservation even when a catalogue row or game_id also matches —
// that second row is what made Phantom Blade Zero say "Now available — Rent"
// while its public page was still Coming soon.

const { gamePath } = require('./seo');
const titleFixes = require('./title-fixes');

function slugify(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Request anchors stay on the raw slug. The catalogue link uses the public
// slug, so a request filed as "Assasins" still points at /game/assassins-…
// after the title is corrected.
function titlesMatch(stored, requested) {
  const live = titleFixes.publicSlug(stored);
  const asked = titleFixes.publicSlug(requested);
  return titleFixes.slugMatches(live, asked) || titleFixes.slugMatches(live, slugify(requested));
}

function linkStockedRequest(request, games, upcoming) {
  const r = request || {};
  const soon = (upcoming || []).find(g => g && titlesMatch(g.title, r.title));
  if (soon) {
    return {
      linkKind: 'upcoming',
      linkedUrl: '/upcoming/' + titleFixes.publicSlug(soon.title) + '-' + soon.id
    };
  }
  const list = games || [];
  const linkedGame = (r.game_id && list.find(g => g && g.id === r.game_id))
    || list.find(g => g && titlesMatch(g.title, r.title));
  if (linkedGame) {
    return {
      linkKind: 'available',
      linkedUrl: gamePath(linkedGame.title)
    };
  }
  return { linkKind: 'stocked', linkedUrl: null };
}

module.exports = { slugify, linkStockedRequest };
