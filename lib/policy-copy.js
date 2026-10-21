// Confirmed rental rules (Michael, 2026-10-20). FAQ JSON-LD and the pages
// that print these sentences share this file so the wording cannot drift.
// The swap line is the exact sentence to publish. Do not define "price tier".

const SWAP_LINE = 'Unlimited FREE game changes while your rental is active (2-day cooldown between swaps, subject to slot availability).';
const SWAP_TIER = 'Swaps must be to a game in the same price tier. Swapping into a higher-priced game like GTA VI means paying the price difference.';

// A normal rental does not include online play. PS Plus Deluxe is the one
// product that does, because that account already has a PS Plus subscription.
const ONLINE_WITHOUT = 'Online multiplayer needs your own PS Plus subscription. A PlayStation Hub rental does not include it.';
const ONLINE_EXCEPTION = 'The exception is our PS Plus Deluxe rental, which runs on a PS Plus subscription, so online play is included.';
const ONLINE_ANSWER = 'Yes. ' + ONLINE_WITHOUT + ' ' + ONLINE_EXCEPTION;

// Homepage FAQ and /faq share this answer. The free try is Non-Trophy only,
// and it covers whatever is available, including PS Plus Deluxe.
const TRIAL_ANSWER = 'Yes, on Non-Trophy accounts. You can play free for three hours on our account before you commit to renting or buying. The free 3-hour trial (Non-Trophy) covers any game, PS Plus Deluxe included, as long as it\'s available at the time. The free try is not available on Trophy or PS4 Primary accounts. Message us and we will set it up.';

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

module.exports = {
  SWAP_LINE, SWAP_TIER, lateFeeSentence,
  ONLINE_WITHOUT, ONLINE_EXCEPTION, ONLINE_ANSWER, TRIAL_ANSWER
};
