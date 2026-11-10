// How an owner records a payment that arrived outside the site.
// Mark paid will not save until one of these is chosen. The key is what
// orders.payment_method already stores (gcash, maya, paypal, bank, manual).

const CANONICAL = Object.freeze([
  { key: 'gcash', label: 'GCash' },
  { key: 'maya', label: 'Maya' },
  { key: 'paypal', label: 'PayPal' },
  { key: 'bank', label: 'Bank transfer' },
  { key: 'manual', label: 'Cash/Other' }
]);

function cleanKey(raw) {
  const key = String(raw == null ? '' : raw).trim().toLowerCase();
  return /^[a-z0-9_-]{1,20}$/.test(key) ? key : '';
}

// Canonical methods always appear, even when a shop has not switched them on
// for customers — the owner is recording money that already arrived.
// A label saved in settings wins, so the dialog matches the shop's own names.
// Any other method key the shop already stores is offered after those five.
function choices(methods) {
  const labels = new Map(CANONICAL.map(m => [m.key, m.label]));
  (Array.isArray(methods) ? methods : []).forEach(m => {
    if (!m) return;
    const key = cleanKey(m.key);
    if (!key) return;
    const label = String(m.label || '').trim().slice(0, 40);
    if (!labels.has(key)) labels.set(key, label || key);
    else if (label) labels.set(key, label);
  });
  const order = CANONICAL.map(m => m.key)
    .concat([...labels.keys()].filter(k => !CANONICAL.some(c => c.key === k)));
  return order.map(key => ({ key, label: labels.get(key) }));
}

// null means the owner has not chosen a method we can store. Callers must
// refuse to mark the order paid rather than inventing "manual".
function resolve(posted, methods) {
  const key = cleanKey(posted);
  if (!key) return null;
  return choices(methods).some(m => m.key === key) ? key : null;
}

module.exports = { CANONICAL, choices, resolve };
