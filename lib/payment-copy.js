// One sentence for How It Works, game pages, and the footer.
//
// Local customers pay with GCash or Maya. International customers pay with
// PayPal. Bank transfer is part of the same sentence. Card checkout is never
// named on a customer page.

function paymentNote() {
  return 'GCash or Maya for local customers · PayPal for international customers · bank transfer is also available';
}

module.exports = { paymentNote };
