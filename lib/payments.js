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
function normalizeCustomerPayments(c) {
  if (!c) return c;
  if (Array.isArray(c.payments)) return c;
  const amount = c.price || 0;
  if (!amount) { c.payments = []; return c; }
  const date = c.start_date || (c.created_at ? String(c.created_at).slice(0, 10) : '');
  c.payments = date ? [{ amount, date, kind: 'rental' }] : [];
  return c;
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

module.exports = { normalizeCustomerPayments, paymentsIn, sumPaymentsInMonth, rentersInMonth };
