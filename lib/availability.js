// Shared availability computation for a single game, used by both game-detail.ejs
// and game-card.ejs so the accounts-vs-legacy fallback logic exists in one place.
//
// `sum` is the per-game account summary from gameAccountSummary(gameId) (or null/undefined
// if accounts data isn't available). Each of the three slot types falls back to legacy
// game.*_slots independently, so migrating only one slot type to the accounts system
// doesn't zero out the other two types' legacy availability.
//
// `legacyDays` (optional) is { nt, tr, ps4 } day-until-available numbers precomputed for
// the legacy (non-account) path, e.g. from resolveSlotDays() on the browse/index routes.
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T23:59:59');
  if (isNaN(d)) return null;
  return Math.max(0, Math.ceil((d - new Date()) / 86400000));
}

function computeAvailability(game, sum, legacyDays) {
  legacyDays = legacyDays || {};

  const hasTrophyAcc = !!(sum && sum.trophy && sum.trophy.total > 0);
  const hasNtAcc = !!(sum && sum.non_trophy && sum.non_trophy.total > 0);
  const hasPs4Acc = !!(sum && sum.ps4_primary && sum.ps4_primary.total > 0);

  const ntSlots = hasNtAcc ? sum.non_trophy.available : (game.non_trophy_slots || 0);
  const trSlots = hasTrophyAcc ? sum.trophy.available : (game.trophy_slots || 0);
  const ps4Slots = hasPs4Acc ? sum.ps4_primary.available : (game.ps4_primary_slots || 0);

  const ntNext = hasNtAcc ? daysUntil(sum.non_trophy.next_end) : (legacyDays.nt != null ? legacyDays.nt : null);
  const trNext = hasTrophyAcc ? daysUntil(sum.trophy.next_end) : (legacyDays.tr != null ? legacyDays.tr : null);
  const ps4Next = hasPs4Acc ? daysUntil(sum.ps4_primary.next_end) : (legacyDays.ps4 != null ? legacyDays.ps4 : null);

  // Every game has both a Trophy and a Non-Trophy account, so Trophy is always
  // offered. At 0 free Trophy slots it shows as full with the waitlist, the
  // same as Non-Trophy does — it is never hidden.
  const hasTrophy = true;
  // PS4 Primary must never show for a PS5-exclusive game, regardless of linked accounts.
  const showPs4 = game.platform === 'PS4' || game.platform === 'PS4/PS5';

  const ntAvail = ntSlots > 0;
  const trAvail = trSlots > 0;
  const ps4Avail = ps4Slots > 0;
  const allUnavail = !ntAvail && !trAvail && (!showPs4 || !ps4Avail);
  const totalSlots = ntSlots + trSlots + (showPs4 ? ps4Slots : 0);

  return {
    ntSlots, trSlots, ps4Slots,
    ntAvail, trAvail, ps4Avail,
    ntNext, trNext, ps4Next,
    hasTrophy, showPs4,
    allUnavail, totalSlots,
    // Per-type "is this figure coming from linked accounts (vs legacy game.*_slots)?" —
    // callers use this to decide whether a precise slot-count/next-end badge applies.
    hasTrophyAcc, hasNtAcc, hasPs4Acc
  };
}

// Which of these games have no slot free at all right now.
//
// Lives here rather than at the call site so the decision is the same one the
// cards make — totalSlots, which already knows that linked accounts override
// legacy counts and that PS4 slots do not count on a PS5-only game. Games are
// expected to have been through resolveSlotDays already, which is where the
// legacy next-available day counts come from.
function fullGameIds(games, summaries) {
  const out = new Set();
  (games || []).forEach(g => {
    if (!g) return;
    const avail = computeAvailability(g, (summaries && summaries[g.id]) || null,
      { nt: g.nt_days_left, tr: g.tr_days_left, ps4: g.ps4_days_left });
    if (!avail.totalSlots) out.add(g.id);
  });
  return out;
}

// Can this game still be sold as permanent access on the given slot type?
// Single source of truth for every buy surface (the /buy list, the detail
// page's buy panel, and the POST /order/buy re-check) — this rule living in
// three separate places, derived from price alone, is what let sold-out
// accounts stay on sale in the first place.
//
// A linked account (`summary[slotKey]`) keeps a rented slot sellable on
// purpose: that rental ends on a known date, so access can be handed over
// afterward. A legacy slot (no linked account) has no such date to sell
// against — it is just a count on the game record — so once a type that has
// actually been rented before has every one of its slots taken, there is
// nothing left to hand over. `legacy`, when the caller has it, is
// `{ everStocked, avail }` for exactly this slot type: `everStocked` says a
// renter has taken this type at least once (so slots genuinely exist for it,
// as opposed to a type nobody has bought into yet, which stays offered — the
// account for that gets created on the first sale), and `avail` says whether
// one is free right now.
function buyTypeSellable(summary, slotKey, legacy) {
  const s = summary && summary[slotKey];
  if (s && s.total) return s.sellable > 0;
  if (legacy && legacy.everStocked) return !!legacy.avail;
  return true;
}

// The function itself stays the export, so every existing
// `require('./lib/availability')(game, sum, days)` call is untouched.
module.exports = computeAvailability;
module.exports.fullGameIds = fullGameIds;
module.exports.buyTypeSellable = buyTypeSellable;
