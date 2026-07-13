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

module.exports = function computeAvailability(game, sum, legacyDays) {
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

  // trophy_account is an explicit admin override — must not be dropped just because
  // this game also happens to have linked accounts for other slot types.
  const hasTrophy = hasTrophyAcc || !!(game.trophy_account || (game.trophy_slots || 0) > 0);
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
};
