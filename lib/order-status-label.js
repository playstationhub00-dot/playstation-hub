// Human-readable order status for the admin export. The raw `state` stays on
// the row. This label is display only and does not change the stored order.

function statusLabel(order) {
  if (!order) return '';
  const state = order.state;
  if (state === 'waitlisted') return 'In line';
  if (state === 'reserved') {
    if (order.upcoming_game_id) return 'Reserved — awaiting release';
    if (order.is_buy) return 'Purchased';
    return 'Priority';
  }
  if (state === 'cancelled') {
    if (order.slot_given_at) return 'Slot given';
    if (order.cancel_reason === 'stale') return 'Cancelled · ' + (order.stale_days || 30) + '+ days';
    return 'Cancelled';
  }
  const labels = {
    awaiting_payment: 'Awaiting payment',
    verifying_payment: 'Check payment',
    payment_rejected: 'Payment rejected',
    awaiting_qr: 'Waiting for sign-in',
    qr_pending: 'Sign-in code in',
    active: 'Out on rent',
    awaiting_return: 'Return due',
    verifying_return: 'Verify return',
    closed: 'Completed'
  };
  return labels[state] || state || '';
}

module.exports = { statusLabel };
