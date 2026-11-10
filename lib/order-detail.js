// Plain fields for the admin order drawer. Payment account numbers are
// masked here; the raw value stays on the server until Reveal.

const mask = require('./mask');

const STATE_LABEL = Object.freeze({
  awaiting_payment: 'Awaiting payment',
  verifying_payment: 'Check payment',
  payment_rejected: 'Payment rejected',
  awaiting_qr: 'Waiting for sign-in',
  qr_pending: 'Sign-in code in',
  active: 'Out on rent',
  awaiting_return: 'Out on rent',
  verifying_return: 'Verify return',
  closed: 'Completed',
  reserved: 'Reserved',
  waitlisted: 'Waiting list',
  cancelled: 'Cancelled'
});

const METHOD_LABEL = Object.freeze({
  gcash: 'GCash',
  maya: 'Maya',
  paypal: 'PayPal',
  bank: 'Bank transfer',
  manual: 'Cash/Other',
  gateway: 'Gateway',
  qrph: 'QR Ph'
});

function text() {
  for (let i = 0; i < arguments.length; i++) {
    const s = arguments[i] == null ? '' : String(arguments[i]).trim();
    if (s) return s;
  }
  return '';
}

function typeLabel(t) {
  return t === 'tr' ? 'Trophy' : t === 'ps4' ? 'PS4 Primary' : 'Non-Trophy';
}

function planLabel(o) {
  if (o.is_reservation && o.is_buy) return 'Pre-order';
  if (o.is_reservation) return 'Reservation';
  if (o.is_buy) return 'Purchase';
  if (Number(o.days) === 7) return 'Weekly';
  if (Number(o.days) === 30) return 'Monthly';
  if (o.days) return String(o.days) + '-day rental';
  return 'Rental';
}

function money(n) {
  const v = Number(n);
  return '₱' + (Number.isFinite(v) ? v : 0).toLocaleString('en-US');
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(String(d) + (String(d).length === 10 ? 'T00:00:00' : ''));
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function datesOf(o) {
  if (!o.start_date && !o.end_date) return 'Not set';
  const start = fmtDate(o.start_date);
  const end = fmtDate(o.end_date);
  if (start && end) return start + ' – ' + end;
  return start || end;
}

function methodLabel(key, methods) {
  if (!key) return 'Not recorded';
  const hit = (methods || []).find(m => m && String(m.key).toLowerCase() === key);
  if (hit && hit.label) return String(hit.label);
  return METHOD_LABEL[key] || key;
}

function statusLabel(o) {
  if (o.state === 'cancelled' && o.slot_given_at) return 'Slot given';
  if (o.state === 'cancelled' && o.cancel_reason === 'stale') {
    return 'Cancelled · ' + (o.stale_days || 30) + '+ days';
  }
  if (o.state === 'reserved' && o.upcoming_game_id) return 'Reserved — awaiting release';
  if (o.state === 'reserved') return 'Priority — awaiting a slot';
  return STATE_LABEL[o.state] || o.state || 'Unknown';
}

// The shop's receiving number for this method. gcash / maya / paypal use the
// existing Reveal allow-list. Bank is the same kind of secret, so it is
// masked here too and revealed through the same logged endpoint.
function paidTo(key, methods) {
  if (!key) return { mask: '', reveal: '' };
  const method = (methods || []).find(m => m && String(m.key).toLowerCase() === key);
  const number = method && method.account_number ? String(method.account_number).trim() : '';
  if (!number) return { mask: '', reveal: '' };
  if (!mask.isMaskedPaymentKey(key) && key !== 'bank') return { mask: '', reveal: '' };
  return { mask: mask.maskPaymentNumber(number), reveal: key };
}

function view(order, ctx) {
  const o = order || {};
  const c = (ctx && ctx.customer) || null;
  const methods = (ctx && ctx.paymentMethods) || [];
  const key = String(o.payment_method || '').trim().toLowerCase();
  const paid = paidTo(key, methods);
  const phone = text(o.phone, o.contact_phone, o.mobile, c && c.phone, c && c.contact_phone, c && c.mobile);
  const psn = text(o.psn_id, o.psn, o.playstation_id, c && c.psn_id, c && c.psn, c && c.playstation_id);
  const tiers = (ctx && ctx.extendTiers) || {};
  const tier = c && c.id != null ? tiers[c.id] : null;
  const history = (Array.isArray(o.state_history) ? o.state_history : []).map(h => ({
    label: STATE_LABEL[h && h.state] || (h && h.state) || 'Updated',
    at: h && h.at ? String(h.at) : ''
  }));
  const slot = text(o.slot_label, o.account_label);
  const slotLine = slot || (o.account_id
    ? 'Account #' + o.account_id + (o.slot_type ? ' · ' + o.slot_type : '')
    : '');
  return {
    ref: text(o.ref),
    customer: text(o.fb_name, c && c.customer_name) || 'Unknown customer',
    psn: psn || 'Not recorded',
    phone: phone || 'Not recorded',
    game: text(o.game_title, c && c.game_title) || 'Unknown game',
    rental: typeLabel(o.account_type) + ' · ' + planLabel(o),
    dates: datesOf(o),
    total: money((Number(o.amount_due) || 0) + (Number(o.deposit_due) || 0)),
    deposit: (Number(o.deposit_due) || 0) > 0
      ? money(o.deposit_due) + (o.deposit_refunded ? ' · refunded' : ' · not refunded')
      : 'None',
    method: methodLabel(key, methods),
    methodKey: key,
    paidToMask: paid.mask,
    paidToReveal: paid.reveal,
    slot: slotLine || 'Not assigned',
    status: statusLabel(o),
    history,
    note: text(o.notes, c && c.notes),
    extend: (c && c.status === 'renting' && c.id != null) ? {
      id: String(c.id),
      name: text(c.customer_name, o.fb_name),
      game: text(c.game_title, o.game_title),
      end: text(c.end_date, o.end_date),
      p7: tier ? (Number(tier.p7) || 0) : 0,
      p30: tier ? (Number(tier.p30) || 0) : 0,
      today: text(ctx && ctx.today)
    } : null
  };
}

module.exports = { view, STATE_LABEL, statusLabel };
