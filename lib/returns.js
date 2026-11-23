// Returns & deposits: every Trophy and PS4 Primary rental the shop has a
// record of, still running or already finished, and whether the security
// deposit went back.
//
// Non-Trophy rentals are left out. A Non-Trophy login can be swapped for
// another customer even when the last renter never came back, so that list
// is not what this page is for.
//
// A deposit stored on the order (deposit_due) is "recorded". Trophy and PS4
// Primary rentals with no recorded deposit still show the shop's expected
// deposit amount, marked expected. That amount is read from the route
// (site settings, otherwise ₱100). Nothing here writes it back onto the
// customer or the order, and it is not counted as money held or owed.
//
// Pure. The route passes the collections and `now`. scripts/test-returns.js
// asserts the rows. lib/today.js uses tracksDeposit, which still means
// "money the order recorded", so a blank PS4 deposit stays out of the
// Today refund queue.

const mask = require('./mask');

const MANILA_MS = 8 * 60 * 60 * 1000;
const PAGE_SIZE = 50;
const ENDING_SOON_DAYS = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Order states that mean the customer actually had (or still has) the account.
const RENTAL_ORDER_STATES = Object.freeze(['active', 'awaiting_return', 'verifying_return', 'closed']);
// Customer rows that can be a rental. A reservation has not started. A
// purchase is not a rental. Cancelled and refunded count only when a start
// date or a rental order shows they did have the account.
const RENTAL_CUSTOMER_STATUSES = Object.freeze(['renting', 'done', 'cancelled', 'refunded']);

const RENTAL_LABEL = Object.freeze({
  active: 'Active',
  ending: 'Ending soon',
  overdue: 'Overdue',
  ended: 'Ended',
  returned: 'Returned'
});

const RENTAL_BADGE = Object.freeze({
  active: 'ok',
  ending: 'wa',
  overdue: 'er',
  ended: 'wa',
  returned: 'nu'
});

const STILL_RENTING = Object.freeze(['active', 'ending', 'overdue']);

function manilaYmd(now) {
  return new Date(now.getTime() + MANILA_MS).toISOString().slice(0, 10);
}

function daysFrom(todayYmd, otherYmd) {
  const a = Date.parse(String(todayYmd || '') + 'T00:00:00Z');
  const b = Date.parse(String(otherYmd || '') + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function prettyDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return '';
  return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
}

function prettyInstant(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return prettyDate(iso);
  return prettyDate(new Date(t + MANILA_MS).toISOString().slice(0, 10));
}

function text() {
  for (let i = 0; i < arguments.length; i++) {
    const s = arguments[i] == null ? '' : String(arguments[i]).trim();
    if (s) return s;
  }
  return '';
}

const DEFAULT_EXPECTED_DEPOSIT = 100;

function depositAmount(order) {
  return Number(order && order.deposit_due) || 0;
}

function expectedAmount(input) {
  const n = Number(input && input.expectedDeposit);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return DEFAULT_EXPECTED_DEPOSIT;
}

// Trophy always. PS4 Primary only when this order recorded a deposit.
// Today uses this for refund money. A blank deposit is still listed on the
// Returns page as expected — that is display, not this money check.
function tracksDeposit(order) {
  if (!order) return false;
  if (order.account_type === 'tr') return true;
  if (order.account_type === 'ps4' && depositAmount(order) > 0) return true;
  return false;
}

function sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function indexOrders(orders) {
  const byRef = new Map();
  const byCustomer = new Map();
  (orders || []).forEach(o => {
    if (!o) return;
    if (o.ref) byRef.set(o.ref, o);
    if (o.customer_id != null && !byCustomer.has(o.customer_id)) byCustomer.set(o.customer_id, o);
  });
  return { byRef, byCustomer };
}

function orderForCustomer(customer, index) {
  if (!customer) return null;
  if (customer.order_ref && index.byRef.get(customer.order_ref)) return index.byRef.get(customer.order_ref);
  if (customer.id != null && index.byCustomer.get(customer.id)) return index.byCustomer.get(customer.id);
  return null;
}

function customerForOrder(order, customers) {
  if (!order) return null;
  const list = customers || [];
  if (order.customer_id != null) {
    const hit = list.find(c => c && sameId(c.id, order.customer_id));
    if (hit) return hit;
  }
  if (order.ref) {
    const hit = list.find(c => c && c.order_ref === order.ref);
    if (hit) return hit;
  }
  return null;
}

function customerDidRent(customer, order) {
  if (!customer || !RENTAL_CUSTOMER_STATUSES.includes(customer.status)) return false;
  if (customer.status === 'renting' || customer.status === 'done') return true;
  if (text(customer.start_date)) return true;
  return !!(order && RENTAL_ORDER_STATES.includes(order.state) && !order.is_buy);
}

// The account they were given. The customer row wins when it names one,
// because that is the slot the rental used. An order with no customer row
// speaks for itself.
function accountTypeOf(customer, order) {
  const fromCustomer = customer && customer.account_type;
  if (fromCustomer) return fromCustomer;
  return (order && order.account_type) || '';
}

function included(customer, order) {
  const type = accountTypeOf(customer, order);
  return type === 'tr' || type === 'ps4';
}

function rentalKey(customer, order, today) {
  const state = order && order.state;
  const status = customer && customer.status;
  if (status === 'done' || state === 'closed') return 'returned';
  if (status === 'cancelled' || status === 'refunded') return 'ended';
  if (state === 'awaiting_return' || state === 'verifying_return') return 'ended';
  const end = text(customer && customer.end_date, order && order.end_date);
  const dl = daysFrom(today, end);
  if (dl == null) return 'active';
  if (dl < 0) return 'overdue';
  if (dl <= ENDING_SOON_DAYS) return 'ending';
  return 'active';
}

function depositKey(amount, refunded, rental) {
  if (refunded) return 'refunded';
  if (amount > 0 && STILL_RENTING.includes(rental)) return 'held';
  if (amount > 0) return 'owed';
  return 'none';
}

function depositLabel(key, refundedOn) {
  if (key === 'refunded') return refundedOn ? 'Recorded · refunded ' + refundedOn : 'Recorded · refunded';
  if (key === 'held') return 'Recorded · held, still renting';
  if (key === 'owed') return 'Recorded · not refunded yet';
  if (key === 'expected') return 'Expected · not on the order';
  return 'No deposit recorded';
}

function findAccount(customer, order, accounts, history) {
  const cid = customer && customer.id;
  const slots = ['trophy', 'ps4_primary'];
  if (cid != null) {
    for (let i = 0; i < (accounts || []).length; i++) {
      const acc = accounts[i];
      if (!acc || !acc.slots) continue;
      for (let s = 0; s < slots.length; s++) {
        const slot = acc.slots[slots[s]];
        if (slot && sameId(slot.renter_id, cid)) return acc;
      }
    }
  }
  if (order && order.account_id != null) {
    const direct = (accounts || []).find(a => a && sameId(a.id, order.account_id));
    if (direct) return direct;
  }
  if (cid == null) return null;
  const lines = (history || []).filter(e =>
    e && sameId(e.renter_id, cid) && (e.slot === 'trophy' || e.slot === 'ps4_primary')
  );
  lines.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  if (!lines.length) return null;
  return (accounts || []).find(a => a && sameId(a.id, lines[0].account_id)) || null;
}

function makeRow(customer, order, today, accounts, history, expected) {
  const rental = rentalKey(customer, order, today);
  const recorded = depositAmount(order);
  const type = accountTypeOf(customer, order);
  let amount = 0;
  let source = 'none';
  if (recorded > 0) {
    amount = recorded;
    source = 'recorded';
  } else if (type === 'tr' || type === 'ps4') {
    amount = expected;
    source = 'expected';
  }
  const refunded = !!(order && order.deposit_refunded && source === 'recorded');
  const depKey = source === 'expected' ? 'expected' : depositKey(amount, refunded, rental);
  const refundedOn = refunded ? prettyInstant(order.deposit_refunded_at) : '';
  const name = text(customer && customer.customer_name, order && order.fb_name) || 'Customer';
  const messenger = text(order && order.fb_name, customer && customer.messenger_name, customer && customer.fb_name);
  const psn = text(
    order && order.psn_id, order && order.psn, order && order.playstation_id,
    customer && customer.psn_id, customer && customer.psn, customer && customer.playstation_id
  );
  const account = findAccount(customer, order, accounts, history);
  const email = account && account.email ? String(account.email) : '';
  const startRaw = text(customer && customer.start_date, order && order.start_date);
  const endRaw = text(customer && customer.end_date, order && order.end_date);
  const createdAt = text(customer && customer.created_at, order && order.created_at);
  const game = text(customer && customer.game_title, order && order.game_title);
  const ref = text(order && order.ref);
  const accountLabel = account
    ? (text(account.label) || ('Account #' + account.id))
    : '';
  const search = [name, messenger, psn, game, ref, accountLabel].join(' ').toLowerCase();
  return {
    id: customer ? 'c' + customer.id : 'o' + ref,
    ref,
    name,
    psn,
    messenger: messenger && messenger.toLowerCase() !== name.toLowerCase() ? messenger : '',
    game,
    accountId: account ? account.id : null,
    accountLabel,
    emailMask: email ? mask.maskEmail(email) : '',
    startRaw,
    endRaw,
    start: prettyDate(startRaw),
    end: prettyDate(endRaw),
    createdAt,
    rentalKey: rental,
    rentalLabel: RENTAL_LABEL[rental],
    rentalBadge: RENTAL_BADGE[rental],
    renting: STILL_RENTING.includes(rental) ? '1' : '',
    depositAmount: amount,
    depositSource: source,
    depositKey: depKey,
    depositLabel: depositLabel(depKey, refundedOn),
    owed: depKey === 'owed' ? '1' : '',
    refunded: depKey === 'refunded' ? '1' : '',
    search,
    customerId: customer ? customer.id : null,
    canMarkReturned: !!(customer && customer.status === 'renting'),
    canConfirmReturn: !!(order && order.state === 'verifying_return' && ref),
    canMarkRefunded: depKey === 'owed' && !!ref,
    note: rental === 'ended' && order && order.state === 'awaiting_return' ? 'Waiting for return proof' : ''
  };
}

function build(input) {
  const src = input || {};
  const now = src.now instanceof Date ? src.now : new Date();
  const today = manilaYmd(now);
  const orders = src.orders || [];
  const customers = src.customers || [];
  const accounts = src.accounts || [];
  const history = src.slotHistory || [];
  const expected = expectedAmount(src);
  const index = indexOrders(orders);
  const usedOrders = new Set();
  const rows = [];

  customers.forEach(customer => {
    if (!customer) return;
    const order = orderForCustomer(customer, index);
    const linked = order && !usedOrders.has(order.ref) ? order : null;
    if (!customerDidRent(customer, linked)) return;
    if (!included(customer, linked)) return;
    if (linked && linked.ref) usedOrders.add(linked.ref);
    rows.push(makeRow(customer, linked, today, accounts, history, expected));
  });

  orders.forEach(order => {
    if (!order || order.is_buy || !order.ref || usedOrders.has(order.ref)) return;
    if (!RENTAL_ORDER_STATES.includes(order.state)) return;
    if (!included(null, order)) return;
    // The customer row says which account they were given. A Non-Trophy
    // customer is not listed here even if an order still says Trophy.
    const customer = customerForOrder(order, customers);
    if (customer && !included(customer, order)) return;
    usedOrders.add(order.ref);
    rows.push(makeRow(customer, order, today, accounts, history, expected));
  });

  rows.sort((a, b) => {
    const byStart = String(b.startRaw).localeCompare(String(a.startRaw));
    if (byStart) return byStart;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  let heldAmount = 0;
  let heldCount = 0;
  let owedAmount = 0;
  let owedCount = 0;
  let refundedCount = 0;
  let rentingCount = 0;
  rows.forEach(row => {
    if (row.renting === '1') rentingCount++;
    if (row.depositKey === 'held') {
      heldAmount += row.depositAmount;
      heldCount++;
    } else if (row.depositKey === 'owed') {
      owedAmount += row.depositAmount;
      owedCount++;
    } else if (row.depositKey === 'refunded') {
      refundedCount++;
    }
  });

  return {
    rows,
    pageSize: PAGE_SIZE,
    counts: {
      all: rows.length,
      renting: rentingCount,
      owed: owedCount,
      refunded: refundedCount
    },
    summary: { heldAmount, heldCount, owedAmount, owedCount }
  };
}

module.exports = {
  PAGE_SIZE,
  ENDING_SOON_DAYS,
  tracksDeposit,
  build
};
