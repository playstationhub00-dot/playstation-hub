// One sentence for How It Works, game pages, and the footer.
//
// Local customers pay with GCash or Maya. International customers pay with
// PayPal. Card checkout (PayMongo) and bank transfer are real methods in this
// codebase, so they stay in the sentence only when that method is actually on.

function paymentNote(opts) {
  const o = opts || {};
  const methods = o.payment_methods || o.methods || [];
  const bank = methods.some(m => m && m.enabled && m.key === 'bank');
  const parts = ['GCash or Maya for local customers', 'PayPal for international customers'];
  if (o.payViaGateway) parts.push('card checkout is also available');
  if (bank) parts.push('bank transfer is also available');
  return parts.join(' · ');
}

module.exports = { paymentNote };
