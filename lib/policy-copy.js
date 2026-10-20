// Confirmed rental rules (Michael, 2026-10-20). FAQ JSON-LD and the pages
// that print these sentences share this file so the wording cannot drift.
// The swap line is the exact sentence to publish. Do not define "price tier".

const SWAP_LINE = 'Unlimited FREE game changes while your rental is active (2-day cooldown between swaps, subject to slot availability).';
const SWAP_TIER = 'Swaps must be to a game in the same price tier. Swapping into a higher-priced game like GTA VI means paying the price difference.';

function peso(n, fallback) {
  if (n == null || n === '') return String(fallback);
  const v = Number(n);
  return Number.isFinite(v) ? String(v) : String(fallback);
}

// Non-Trophy has no late fee. Trophy and PS4 Primary pay the settings amount
// out of the refundable deposit.
function lateFeeSentence(deposit, lateFee) {
  const dep = peso(deposit, 100);
  const late = peso(lateFee, 20);
  return 'Non-Trophy rentals have no late fees, because no deposit is collected. On Trophy and PS4 Primary, a late return costs ₱' + late + ' per late day, deducted from the ₱' + dep + ' deposit.';
}

module.exports = { SWAP_LINE, SWAP_TIER, lateFeeSentence };
