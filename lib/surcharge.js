// International payment surcharge — what a PayPal customer is asked to send on
// top of the rental price, covering what PayPal and the bank take out.
//
// Pure functions over numbers: no settings read, no database, no network, so
// the money maths is testable without booting the app.
//
// This is a DISPLAY concern and must stay one. Nothing here is ever written to
// an order — amount_due stays the rental price, and this only decides what the
// PayPal panel asks for. See
// docs/superpowers/specs/2026-09-03-paypal-international-payments-design.md.

// Anything unusable becomes 0 rather than throwing. This runs inside a page
// render, and a blank or mistyped settings field must not take the order page
// down for every customer.
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Ceiling with the float error taken out first. 1500 * 4.4 / 100 evaluates to
// 66.00000000000001, and Math.ceil of that is 67 — a phantom peso charged
// every time the percentage lands on a whole number. Rounding to 6 decimals
// first removes it while leaving every genuine fraction alone.
function ceilPeso(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(Number(n.toFixed(6)));
}

// Every rounding goes UP. Under-recovering silently is the failure worth
// guarding against; over-recovering by a peso is not.
function computeSurcharge(amountPesos, config) {
  const c = config || {};
  const base = Math.round(num(amountPesos));
  // Nothing to send means nothing to charge fees on.
  if (base <= 0) return { base: 0, feePeso: 0, payoutPeso: 0, total: 0 };
  const feePeso = ceilPeso(base * num(c.percent) / 100) + ceilPeso(num(c.fixedPeso));
  const payoutPeso = ceilPeso(num(c.payoutUsd) * num(c.rate));
  return { base, feePeso, payoutPeso, total: base + feePeso + payoutPeso };
}

module.exports = { computeSurcharge };
