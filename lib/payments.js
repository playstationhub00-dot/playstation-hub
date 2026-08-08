// Revenue attribution. A customer record holds one running `price`, which can
// only describe a single revenue event — so an extension (which raises `price`
// in place) used to land in the month the rental STARTED rather than the month
// it was paid. Each payment now carries its own date, and revenue is summed
// from payments rather than from `price`.
//
// `price` is deliberately left alone as the running total: the customers table,
// the Excel export and the swap top-up math all still read it.

// Existing records predate payments[], so they are backfilled with one payment
// at the rental's start date for the full price. That reproduces today's
// monthly totals exactly — no past month shifts. Extensions made before this
// change were never recorded separately and cannot be recovered.
// This app's users and business hours are Philippines-only (UTC+8, fixed, no
// DST) — the OLD dashboard logic bucketed created_at by local time, so the
// backfill must reproduce that exact bucketing or historical months move.
function manilaDateString(isoString) {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const manila = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return manila.toISOString().slice(0, 10);
}

function normalizeCustomerPayments(c) {
  if (!c) return c;
  if (Array.isArray(c.payments)) return c;
  const amount = c.price || 0;
  if (!amount) { c.payments = []; return c; }
  const date = c.start_date || (c.created_at ? manilaDateString(c.created_at) : '');
  c.payments = date ? [{ amount, date, kind: 'rental' }] : [];
  return c;
}

// Shared by the customer-edit route: turns a price change into the payment
// row it represents (or null for no change). A positive delta from ₱0 is the
// customer's first payment (a reservation converted to a rental), dated to
// the rental's start so it lands in the right historical month. Any other
// positive delta is an extension, dated today. A negative delta is a
// correction, recorded as a negative 'adjustment' so sum(payments) === price
// always holds.
function priceDeltaPayment(prevPrice, newPrice, opts) {
  opts = opts || {};
  const priceDelta = newPrice - prevPrice;
  if (priceDelta === 0) return null;
  const isFirstPayment = priceDelta > 0 && prevPrice === 0;
  const today = opts.todayDate || new Date().toISOString().slice(0, 10);
  return {
    amount: priceDelta,
    date: isFirstPayment ? (opts.startDate || today) : today,
    kind: isFirstPayment ? 'rental' : (priceDelta > 0 ? 'extension' : 'adjustment')
  };
}

function paymentsIn(customers, year, month) {
  const out = [];
  (customers || []).forEach(c => {
    (c.payments || []).forEach(p => {
      if (!p || !p.date) return;
      const d = new Date(p.date + 'T00:00:00');
      if (isNaN(d.getTime())) return;
      if (d.getFullYear() === year && d.getMonth() === month) out.push({ c, p });
    });
  });
  return out;
}

function sumPaymentsInMonth(customers, year, month) {
  return paymentsIn(customers, year, month).reduce((s, x) => s + (x.p.amount || 0), 0);
}

// Someone who paid twice in a month is still one renter, matching how the
// dashboard already counts unique renters by name.
function rentersInMonth(customers, year, month) {
  const names = new Set();
  paymentsIn(customers, year, month).forEach(x => {
    if (x.c.customer_name) names.add(String(x.c.customer_name).trim().toLowerCase());
  });
  return names.size;
}

module.exports = { normalizeCustomerPayments, manilaDateString, priceDeltaPayment, paymentsIn, sumPaymentsInMonth, rentersInMonth };
