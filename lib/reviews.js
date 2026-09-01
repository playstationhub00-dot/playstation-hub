// Review rules for capture and display. Pure functions over plain review and
// order objects — no database access and no Express — so the order page, the
// game page and the admin card all read one implementation.
//
// See docs/superpowers/specs/2026-09-01-review-capture-design.md.

// Same masking rule the queue popout uses, so a name never reads differently
// depending on which part of the site is showing it.
const { maskName } = require('./names');

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

// A reviewer's full name goes to admin only. Every public-facing surface
// shows this instead, e.g. "Ronald M. Fresco" -> "Ronald F.".
function displayName(review) {
  return maskName(review && review.name);
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

// Customer statuses that mean this person actually received a game, so there is
// something real to ask them about. 'reservation' is excluded — they have paid
// for a slot but never played anything yet.
const REQUESTABLE_STATUSES = Object.freeze(['renting', 'done', 'bought']);

function normalizeName(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Whether this customer already has a review on the site. Site-submitted
// reviews carry order_ref and could be matched exactly, but the ones imported
// from Facebook only have a name — so this matches on the normalized name,
// which is the only field both kinds share. Exact match only: a nickname or a
// typo will show as "not asked", which costs a duplicate ask rather than
// anything worse.
function hasReviewedBy(reviews, customerName) {
  const want = normalizeName(customerName);
  if (!want) return false;
  return (reviews || []).some(r => r && normalizeName(r.name) === want);
}

function daysSince(dateStr, now) {
  const t = Date.parse(dateStr || '');
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}

// The owner's work queue for asking customers to be quoted. Three states:
// 'todo' (never asked), 'asked' (messaged, still waiting) and 'reviewed'
// (already on the site). Sorted so the outstanding work is at the top, and
// within that the freshest rental first — someone who finished a game two days
// ago is far likelier to reply than someone from months back.
function buildRequestQueue(customers, reviews, now) {
  const at = now instanceof Date ? now : new Date(now || Date.now());
  // Collapse to one row per PERSON, not per rental. A loyal customer has one
  // record per rental — the real data has someone with fourteen — and asking
  // them fourteen separate times would be worse than not asking at all. The
  // row keeps their most recent rental (freshest thing to reference) and
  // counts the rest.
  const byPerson = new Map();
  (customers || [])
    .filter(c => c && REQUESTABLE_STATUSES.includes(c.status))
    .forEach(c => {
      const key = normalizeName(c.customer_name);
      if (!key) return;
      const existing = byPerson.get(key);
      if (!existing) {
        byPerson.set(key, { latest: c, rentalCount: 1, askedAt: c.review_asked_at || null });
        return;
      }
      existing.rentalCount += 1;
      // Any ask against any of their records counts — keep the most recent.
      const candidate = c.review_asked_at || null;
      if (candidate && (!existing.askedAt || candidate > existing.askedAt)) existing.askedAt = candidate;
      const newer = (Date.parse(c.start_date || '') || 0) > (Date.parse(existing.latest.start_date || '') || 0);
      if (newer) existing.latest = c;
    });

  const rows = [...byPerson.values()].map(({ latest, rentalCount, askedAt }) => {
    const reviewed = hasReviewedBy(reviews, latest.customer_name);
    return {
      id: latest.id,
      name: latest.customer_name || '',
      // How they would appear on the site, so the ask can promise it exactly.
      displayName: maskName(latest.customer_name),
      game: latest.game_title || '',
      accountType: latest.account_type || '',
      startDate: latest.start_date || '',
      rentalCount,
      status: reviewed ? 'reviewed' : (askedAt ? 'asked' : 'todo'),
      askedAt,
      daysSinceStart: daysSince(latest.start_date, at),
      daysSinceAsked: daysSince(askedAt, at)
    };
  });

  const rank = { todo: 0, asked: 1, reviewed: 2 };
  return rows.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return (Date.parse(b.startDate || '') || 0) - (Date.parse(a.startDate || '') || 0);
  });
}

function queueSummary(rows) {
  const list = rows || [];
  return {
    todo: list.filter(r => r.status === 'todo').length,
    asked: list.filter(r => r.status === 'asked').length,
    reviewed: list.filter(r => r.status === 'reviewed').length
  };
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
  REVIEWABLE_STATES, MAX_TEXT, REQUESTABLE_STATUSES,
  badgeFor, displayName, hasReviewed, canPrompt, normalize, sortForGame, aggregate,
  hasReviewedBy, buildRequestQueue, queueSummary
};
