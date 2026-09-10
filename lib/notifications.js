// Everything waiting on the owner, in one list.
//
// The admin already computes each of these queues for its own tab — the order
// queue for Orders, the reminder list for Customers, the unlinked rentals for
// the data-integrity panel. The problem is that they only exist on the page
// that renders them: sitting in Games, you cannot see that someone's sign-in
// code has been ticking for eight minutes. This module folds those same inputs
// into one ranked list the topbar bell can show from anywhere.
//
// It reads nothing and calls nothing — the route passes in what it already has,
// so this list can never disagree with the tab it came from.

// Ordering is the whole point of the bell: the top row should be the thing to
// do next. Lower rank sorts first.
const RANK = Object.freeze({
  webhook_broken: 0,     // silently breaks every payment after it — fix first
  qr_pending: 1,         // a 10-minute clock is running
  verifying_payment: 2,  // someone is watching a screen, waiting to be let in
  expiry_overdue: 3,
  verifying_return: 10,
  expiry_today: 11,
  no_slot: 12,
  refund_owed: 13,
  expiry_tomorrow: 20,
  review_todo: 21
});

const URGENCY_RANK = Object.freeze({ critical: 0, warn: 1, info: 2 });

function nameOf(x) {
  if (!x) return '';
  return String(x.customer_name || x.fb_name || '').trim();
}

function peso(n) {
  return '₱' + (Number(n) || 0).toLocaleString('en-US');
}

// "PH-1042 · Ana · Elden Ring", skipping whatever is missing so a thin record
// never renders a stray separator or the word undefined.
function detail(parts) {
  return parts.filter(p => p !== null && p !== undefined && String(p).trim() !== '').join(' · ');
}

function ms(t) {
  const v = Date.parse(t || '');
  return isNaN(v) ? Infinity : v;
}

function build(input) {
  const src = input || {};
  const items = [];
  const push = it => { items.push(it); };

  // ── Orders waiting on an owner action ──
  (src.orderQueue || []).forEach(o => {
    if (!o) return;
    const who = nameOf(o);
    if (o.state === 'qr_pending') {
      push({
        id: 'qr_pending:' + o.ref, kind: 'qr_pending', urgency: 'critical', icon: '🕐',
        title: 'Send the sign-in code',
        sub: detail([o.ref, who, o.game_title]),
        tab: 'orders', ref: o.ref, expiresAt: o.qr_expires_at || null,
        tie: ms(o.qr_expires_at)
      });
    } else if (o.state === 'verifying_payment') {
      // PayPal customers were quoted the fee-inclusive total, not amount_due.
      // Showing the peso figure here would have the owner compare a receipt
      // against a number nobody was ever asked to pay.
      const amount = o.payment_method === 'paypal' && o.paypal_expected
        ? peso(o.paypal_expected)
        : peso((o.amount_due || 0) + (o.deposit_due || 0));
      push({
        id: 'verifying_payment:' + o.ref, kind: 'verifying_payment', urgency: 'critical', icon: '💳',
        title: 'Approve a payment',
        sub: detail([o.ref, who, amount]),
        tab: 'orders', ref: o.ref, tie: ms(o.created_at)
      });
    } else if (o.state === 'verifying_return') {
      push({
        id: 'verifying_return:' + o.ref, kind: 'verifying_return', urgency: 'warn', icon: '↩️',
        title: 'Verify a return',
        sub: detail([o.ref, who, o.game_title]),
        tab: 'orders', ref: o.ref, tie: ms(o.created_at)
      });
    }
    // Any other state is somebody else's turn, not the owner's.
  });

  // ── Rentals due back ──
  (src.needsReminder || []).forEach(r => {
    if (!r || !r.c) return;
    const who = nameOf(r.c) || 'Unnamed customer';
    const sub = detail([who, r.c.game_title]);
    if (r.kind === 'expiry_overdue') {
      const d = r.overdueBy || Math.abs(r.dl || 0);
      push({
        id: 'expiry_overdue:' + r.c.id, kind: 'expiry_overdue', urgency: 'critical', icon: '⏰',
        title: 'Overdue by ' + d + ' day' + (d === 1 ? '' : 's'),
        sub, tab: 'customers', tie: r.dl || 0
      });
    } else if (r.kind === 'expiry_today') {
      push({
        id: 'expiry_today:' + r.c.id, kind: 'expiry_today', urgency: 'warn', icon: '📅',
        title: 'Due back today', sub, tab: 'customers', tie: 0
      });
    } else if (r.kind === 'expiry_tomorrow') {
      push({
        id: 'expiry_tomorrow:' + r.c.id, kind: 'expiry_tomorrow', urgency: 'info', icon: '📅',
        title: 'Due back tomorrow', sub, tab: 'customers', tie: 0
      });
    }
  });

  // ── A live rental holding a slot the site still advertises as free ──
  (src.unlinkedRentals || []).forEach(c => {
    if (!c) return;
    push({
      id: 'no_slot:' + c.id, kind: 'no_slot', urgency: 'warn', icon: '🗂️',
      title: 'Rental with no slot assigned',
      sub: detail([nameOf(c) || 'Unnamed customer', c.game_title, 'site still shows this slot free']),
      tab: 'customers', tie: 0
    });
  });

  // ── Deposits the customer is owed back ──
  (src.refundsOwed || []).forEach(o => {
    if (!o) return;
    push({
      id: 'refund_owed:' + o.ref, kind: 'refund_owed', urgency: 'warn', icon: '💵',
      title: 'Deposit to refund',
      sub: detail([o.ref, nameOf(o), peso(o.deposit_due)]),
      tab: 'orders', ref: o.ref, tie: 0
    });
  });

  // ── Review asks: one row, not one per person ──
  // Asking is a batch you sit down and do, so ten separate rows would bury the
  // work that has to happen order by order.
  const todo = (src.reviewQueue || []).filter(r => r && r.status === 'todo').length;
  if (todo) {
    push({
      id: 'review_todo', kind: 'review_todo', urgency: 'info', icon: '⭐',
      title: todo + ' customer' + (todo === 1 ? '' : 's') + ' to ask for a review',
      sub: 'Finished a rental and has not been asked yet',
      tab: 'content', tie: 0
    });
  }

  // ── Gateway health ──
  // Only when the newest thing that happened was a failure. Old failures from
  // before a secret was fixed are history, and an alarm that stays on after
  // the fix is an alarm the owner learns to ignore.
  const h = src.paymongoHealth;
  if (h && (h.fail_count || 0) > 0
      && (!h.last_ok_at || String(h.last_fail_at || '') > String(h.last_ok_at || ''))) {
    push({
      id: 'webhook_broken', kind: 'webhook_broken', urgency: 'critical', icon: '⚠️',
      title: 'PayMongo webhook is failing',
      sub: h.fail_count + ' signature failure' + (h.fail_count === 1 ? '' : 's') + ' — paid orders will not advance on their own',
      tab: 'orders', tie: 0
    });
  }

  items.sort((a, b) =>
    URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
    || RANK[a.kind] - RANK[b.kind]
    || a.tie - b.tie
  );

  return {
    items,
    count: items.length,
    criticalCount: items.filter(i => i.urgency === 'critical').length
  };
}

module.exports = { build, RANK };
