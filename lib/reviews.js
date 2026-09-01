// Review rules for capture and display. Pure functions over plain review and
// order objects — no database access and no Express — so the order page, the
// game page and the admin card all read one implementation.
//
// See docs/superpowers/specs/2026-09-01-review-capture-design.md.

// The customer has actually received a game in these states, so there is
// something honest to review. Deliberately excludes 'awaiting_qr' and
// 'qr_pending' (paid, but not signed in yet) and 'reserved' (nothing played).
const REVIEWABLE_STATES = Object.freeze([
  'active', 'awaiting_return', 'verifying_return', 'closed'
]);

// One sentence is the ask. A cap keeps a card from swallowing the page and
// bounds what an abusive submission can push into the moderation queue.
const MAX_TEXT = 300;

// Every review that existed before this feature was typed into the admin
// "Add Review from Facebook" form, so a missing source is Facebook. That
// default is what makes this change a no-op migration.
function badgeFor(review) {
  return review && review.source === 'site' ? 'verified' : 'facebook';
}

function hasReviewed(reviews, ref) {
  if (!ref) return false;
  return (reviews || []).some(r => r && r.order_ref === ref);
}

function canPrompt(order, reviews) {
  if (!order) return false;
  if (!REVIEWABLE_STATES.includes(order.state)) return false;
  return !hasReviewed(reviews, order.ref);
}

// Customer-supplied rating and text, made safe to store. The rating falls back
// to 5 rather than rejecting, because a missing radio should not lose someone's
// written review.
function normalize(input) {
  const raw = input || {};
  let rating = parseInt(raw.rating, 10);
  if (isNaN(rating)) rating = 5;
  rating = Math.min(5, Math.max(1, rating));
  let text = String(raw.text == null ? '' : raw.text).trim().replace(/\s+/g, ' ');
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT).trim();
  return { rating, text };
}

function titleKey(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

// Reviews are one shared pool shown on every game page, so the only per-game
// behaviour is which ones surface first. Returns a new array — callers render
// this straight into a template and must not have their source list reordered.
function sortForGame(reviews, gameTitle) {
  const want = titleKey(gameTitle);
  return (reviews || []).slice().sort((a, b) => {
    const am = want && titleKey(a.game_rented) === want ? 0 : 1;
    const bm = want && titleKey(b.game_rented) === want ? 0 : 1;
    if (am !== bm) return am - bm;
    const ao = a.order == null ? 999 : a.order;
    const bo = b.order == null ? 999 : b.order;
    if (ao !== bo) return ao - bo;
    return (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0);
  });
}

// Describes the business, not the game — so this counts the whole visible pool
// and shows the same figure on every game page.
function aggregate(reviews) {
  const list = reviews || [];
  if (!list.length) return { count: 0, average: 0 };
  const sum = list.reduce((n, r) => n + (Number(r && r.rating) || 0), 0);
  return { count: list.length, average: Math.round((sum / list.length) * 10) / 10 };
}

module.exports = {
  REVIEWABLE_STATES, MAX_TEXT,
  badgeFor, hasReviewed, canPrompt, normalize, sortForGame, aggregate
};
