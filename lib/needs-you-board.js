// Admin → Orders → Needs you → "By game": the Waitlist and the Follow-ups
// (started but not paid) grouped into one card per game + account type — the
// scope a slot actually opens in, so everyone the owner may message about one
// slot sits together. Pure: no Express, no database. server.js passes the
// cards to views/partials/admin/orders/needs-you.ejs, which only renders.
// See docs/superpowers/specs/2026-10-24-orders-by-game-board-design.md.

// Trophy, Non-Trophy, PS4 Primary: the order two cards of one game sit in.
const TYPE_ORDER = ['tr', 'nt', 'ps4'];

// What an order's game_id says about where it came from. Only a released game
// and PS Plus have slots that can be "free right now".
function kindOf(gameId) {
  const id = String(gameId);
  if (id === 'psplus') return 'psplus';
  if (id.indexOf('upcoming_') === 0) return 'upcoming';
  if (id.indexOf('bundle_') === 0) return 'bundle';
  return 'game';
}

const time = o => Date.parse((o && o.created_at) || '') || 0;
const byRef = (a, b) => String(a.ref).localeCompare(String(b.ref));

// The line's own order (queueRules.buildQueue): ⭐ priority first, then oldest.
function waitingOrder(a, b) {
  const ta = a.state === 'reserved' ? 0 : 1;
  const tb = b.state === 'reserved' ? 0 : 1;
  return (ta - tb) || (time(a) - time(b)) || byRef(a, b);
}

// Follow-ups newest first, as the old Follow-ups list was.
function followUpOrder(a, b) {
  return (time(b) - time(a)) || byRef(a, b);
}

// `slotsFree` maps '<game_id>|<type>' to how many slots of that type are free
// now (server.js reads the same counts the game page shows). Cards with a free
// slot come first, then the most people, then title A-Z, then Trophy before
// Non-Trophy before PS4 Primary.
function buildBoard(input) {
  const { waitlist, followUps, slotsFree } = input || {};
  const free = slotsFree || {};
  const cards = new Map();
  function cardFor(o) {
    const type = TYPE_ORDER.indexOf(o.account_type) !== -1 ? o.account_type : 'nt';
    const key = String(o.game_id) + '|' + type;
    if (!cards.has(key)) {
      cards.set(key, {
        key, gameId: o.game_id, type, kind: kindOf(o.game_id),
        title: o.game_title || 'Unknown game', slotsFree: 0, waiting: [], followUps: []
      });
    }
    return cards.get(key);
  }
  (waitlist || []).forEach(o => { if (o) cardFor(o).waiting.push(o); });
  (followUps || []).forEach(o => { if (o) cardFor(o).followUps.push(o); });

  const out = Array.from(cards.values());
  out.forEach(c => {
    const hasSlots = c.kind === 'game' || c.kind === 'psplus';
    c.slotsFree = hasSlots ? Math.max(0, Math.floor(Number(free[c.key]) || 0)) : 0;
    c.waiting.sort(waitingOrder);
    c.followUps.sort(followUpOrder);
  });
  const people = c => c.waiting.length + c.followUps.length;
  return out.sort((a, b) =>
    ((b.slotsFree > 0) - (a.slotsFree > 0)) ||
    (people(b) - people(a)) ||
    a.title.localeCompare(b.title) ||
    (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)));
}

module.exports = { buildBoard, kindOf };
