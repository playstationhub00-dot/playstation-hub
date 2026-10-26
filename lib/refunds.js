// Cancel a rental, or cancel one extension and refund what the owner sends back.
//
// Extensions made with the Extend action are their own rows on customer.extensions
// (days, amount, the end date before and after). Older ones were typed into the
// customer form, so they exist only as a payment with kind 'extension' — or, if
// that price rise was never split out, only as a longer duration and a higher
// price. choices() surfaces whichever of those this rental actually has, and
// the merged case asks the owner how many days to take off.
//
// Money follows lib/payments.js: the refund is a negative payment dated the day
// it went out, so every total that sums payments (dashboard, reports, the admin
// app) nets it in that month. `price` moves with the payments so the two still
// agree. The amount charged before the refund is kept on the refund row
// (`gross` for a whole-rental cancel, the extension's own amount otherwise) and
// the customers table shows it.
//
// The Trophy / PS4 deposit is not in `price` (server.js records amount_due
// only). This module does not add it to the refund. The route marks the order's
// deposit refunded when the whole rental is cancelled, and says so on the row.
//
// Pure: no database and no clock unless the caller omits `at`.

const METHODS = Object.freeze(['gcash', 'maya', 'paypal', 'other']);
const METHOD_LABEL = Object.freeze({
  gcash: 'GCash', maya: 'Maya', paypal: 'PayPal', other: 'Other'
});
const INACTIVE = Object.freeze(['cancelled', 'refunded']);

function isInactive(status) {
  return INACTIVE.includes(status);
}

function paymentSum(customer) {
  if (!customer) return 0;
  if (!Array.isArray(customer.payments)) return Number(customer.price) || 0;
  return customer.payments.reduce((sum, p) => sum + (Number(p && p.amount) || 0), 0);
}

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function addDays(ymd, n) {
  const t = Date.parse(String(ymd) + 'T00:00:00Z');
  if (isNaN(t)) return '';
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatYmd(ymd) {
  const parts = String(ymd || '').split('-').map(Number);
  if (!parts[0] || !MONTHS[parts[1] - 1] || !parts[2]) return '';
  return MONTHS[parts[1] - 1] + ' ' + parts[2] + ', ' + parts[0];
}

function peso(n) {
  const v = Math.round(Number(n) || 0);
  const body = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-' : '') + body;
}

function cleanMethod(value) {
  const key = String(value || '').trim().toLowerCase();
  return METHODS.includes(key) ? key : null;
}

function cleanNote(value) {
  return String(value == null ? '' : value).trim().slice(0, 240);
}

function fail(error, message) {
  return { ok: false, error, message };
}

function nextPrice(customer, refundAmount) {
  const prev = Number(customer && customer.price) || 0;
  const sum = paymentSum(customer);
  if (sum === prev) return sum - refundAmount;
  return prev - refundAmount;
}

// Which extension the owner can cancel. Recorded rows win. A kind:'extension'
// payment that no recorded row already explains is offered on its own, and the
// owner types the days. With neither, the rental can still be shortened by hand.
function choices(customer) {
  const empty = { recorded: [], inferred: [], manual: false, canCancelRental: false };
  if (!customer || isInactive(customer.status)) return empty;
  const canShorten = customer.status === 'renting';
  const exts = Array.isArray(customer.extensions) ? customer.extensions : [];
  const recorded = [];
  if (canShorten) {
    exts.forEach((ext, index) => {
      if (!ext || ext.cancelled) return;
      const days = Number(ext.days) || 0;
      const amount = Number(ext.amount) || 0;
      if (days < 1 && amount <= 0) return;
      recorded.push({
        key: 'record:' + index,
        source: 'record',
        index,
        days,
        amount,
        from_end_date: ext.from_end_date || '',
        end_date: ext.end_date || '',
        at: ext.at || '',
        paymentIndex: null
      });
    });
  }

  const used = new Set();
  const pays = Array.isArray(customer.payments) ? customer.payments : [];
  recorded.forEach(row => {
    for (let i = 0; i < pays.length; i++) {
      if (used.has(i)) continue;
      const p = pays[i];
      if (!p || p.kind !== 'extension' || p.refunded) continue;
      if (Number(p.amount) === row.amount) {
        used.add(i);
        row.paymentIndex = i;
        break;
      }
    }
  });

  const inferred = [];
  if (canShorten) {
    pays.forEach((p, i) => {
      if (!p || p.kind !== 'extension' || p.refunded || used.has(i)) return;
      if (!(Number(p.amount) > 0)) return;
      inferred.push({
        key: 'payment:' + i,
        source: 'payment',
        index: i,
        days: null,
        amount: Number(p.amount) || 0,
        date: p.date || ''
      });
    });
  }

  if (recorded.length) {
    recorded[recorded.length - 1].last = true;
  }

  return {
    recorded,
    inferred,
    manual: canShorten && recorded.length === 0 && inferred.length === 0,
    canCancelRental: true
  };
}

function endAfterExtension(customer, choice, days) {
  if (choice && choice.source === 'record' && choice.last && isDay(choice.from_end_date)) {
    return choice.from_end_date;
  }
  if (isDay(customer && customer.end_date) && days) return addDays(customer.end_date, -days);
  return (customer && customer.end_date) || '';
}

function auditLine(entry) {
  if (!entry) return '';
  const method = METHOD_LABEL[entry.method] || 'Other';
  const when = formatYmd(entry.date);
  const paid = '₱' + peso(entry.amount) + ' refunded (' + method + ')' + (when ? ' on ' + when : '');
  if (entry.scope === 'extension') {
    const charged = Number(entry.extension_amount);
    const partial = charged > 0 && charged !== Number(entry.amount);
    const money = partial ? ('₱' + peso(entry.amount) + ' of ₱' + peso(charged) + ' refunded (' + method + ')' + (when ? ' on ' + when : '')) : paid;
    return 'Extension cancelled, ' + money;
  }
  if (entry.full) return 'Rental refunded, ' + paid;
  return 'Rental cancelled, ' + paid;
}

function refundPayment(entry) {
  if (!(Number(entry.amount) > 0)) return null;
  return {
    amount: -Math.round(Number(entry.amount)),
    date: entry.date,
    kind: 'refund',
    method: entry.method,
    note: entry.note || '',
    scope: entry.scope,
    refund_id: entry.id
  };
}

function readMoney(input) {
  const method = cleanMethod(input && input.method);
  if (!method) return fail('bad_method', 'Pick how the refund was sent.');
  if (!isDay(input && input.date)) return fail('bad_date', 'Enter the refund date.');
  const amount = roundMoney(input.amount);
  if (amount === null || amount < 0) return fail('bad_amount', 'Enter the refund amount.');
  return { method, amount, note: cleanNote(input.note), date: input.date };
}

function capAmount(customer, amount, extra) {
  const cap = Math.max(0, paymentSum(customer) + (Number(extra) || 0));
  if (amount > cap) {
    return fail('too_much', 'That is more than this rental has collected (₱' + peso(cap) + ').');
  }
  return { cap };
}

function stampId(input) {
  return String((input && input.at) || new Date().toISOString());
}

function copyList(list) {
  return (Array.isArray(list) ? list : []).map(item => Object.assign({}, item));
}

function applyExtension(customer, input) {
  const src = input || {};
  if (!customer) return fail('missing', 'That customer no longer exists.');
  if (customer.status !== 'renting') {
    return fail('bad_status', 'Only a live rental can have an extension cancelled. Cancel the whole rental instead.');
  }
  const list = choices(customer);
  const key = String(src.key || src.extension_key || '');
  const manual = key === 'manual';
  const choice = manual ? null : list.recorded.concat(list.inferred).find(row => row.key === key);
  if (!choice && !(manual && list.manual)) {
    return fail('no_extension', 'That extension is not on this rental.');
  }

  let days = choice && choice.source === 'record' ? choice.days : roundMoney(src.days);
  if (days === null || !days || days < 1) {
    return fail('bad_days', 'Enter how many days this extension added.');
  }
  const curDays = Number(customer.days) || 0;
  if (days > curDays) return fail('bad_days', 'That is more days than this rental has.');
  if (days >= curDays) {
    return fail('whole_rental', 'That removes the whole rental. Choose Cancel the whole rental.');
  }

  const money = readMoney(src);
  if (!money.ok && money.error) return money;
  const capped = capAmount(customer, money.amount, 0);
  if (capped.error) return capped;

  const end = endAfterExtension(customer, choice, days);
  const at = stampId(src);
  const entry = {
    id: at,
    at,
    date: money.date,
    amount: money.amount,
    method: money.method,
    note: money.note,
    scope: 'extension',
    days_removed: days,
    extension_key: choice ? choice.key : 'manual',
    extension_at: (choice && choice.at) || '',
    extension_amount: choice ? choice.amount : money.amount,
    prev_days: curDays,
    prev_end_date: customer.end_date || '',
    prev_price: Number(customer.price) || 0,
    result_days: curDays - days,
    result_end_date: end
  };

  const payments = copyList(customer.payments);
  if (choice && choice.source === 'record' && choice.paymentIndex != null && payments[choice.paymentIndex]) {
    payments[choice.paymentIndex] = Object.assign({}, payments[choice.paymentIndex], { refunded: entry.id });
  }
  if (choice && choice.source === 'payment' && payments[choice.index]) {
    payments[choice.index] = Object.assign({}, payments[choice.index], { refunded: entry.id });
  }
  const pay = refundPayment(entry);
  if (pay) payments.push(pay);

  const extensions = copyList(customer.extensions);
  if (choice && choice.source === 'record' && extensions[choice.index]) {
    extensions[choice.index] = Object.assign({}, extensions[choice.index], {
      cancelled: {
        refund_id: entry.id, at, date: entry.date,
        amount: entry.amount, method: entry.method, note: entry.note
      }
    });
  }

  const price = nextPrice(customer, money.amount);
  entry.result_price = price;
  const refunds = copyList(customer.refunds).concat([entry]);
  return {
    ok: true,
    kind: 'extension',
    entry,
    line: auditLine(entry),
    patch: {
      days: entry.result_days,
      end_date: end,
      price,
      payments,
      extensions,
      refunds,
      status: customer.status
    }
  };
}

function applyRental(customer, input) {
  const src = input || {};
  if (!customer) return fail('missing', 'That customer no longer exists.');
  if (isInactive(customer.status)) {
    return fail('already', 'This rental is already cancelled. Edit the refund, or undo it.');
  }
  const money = readMoney(src);
  if (money.error) return money;
  const capped = capAmount(customer, money.amount, 0);
  if (capped.error) return capped;

  const at = stampId(src);
  const full = capped.cap > 0 && money.amount >= capped.cap;
  const price = nextPrice(customer, money.amount);
  const entry = {
    id: at,
    at,
    date: money.date,
    amount: money.amount,
    method: money.method,
    note: money.note,
    scope: 'rental',
    full,
    gross: Number(customer.price) || 0,
    prev_status: customer.status,
    prev_price: Number(customer.price) || 0,
    prev_days: customer.days,
    prev_end_date: customer.end_date || '',
    prev_assign: '',
    deposit_marked: false,
    order_state: '',
    order_amount: null
  };
  const payments = copyList(customer.payments);
  const pay = refundPayment(entry);
  if (pay) payments.push(pay);
  const refunds = copyList(customer.refunds).concat([entry]);
  return {
    ok: true,
    kind: 'rental',
    entry,
    line: auditLine(entry),
    patch: {
      status: full ? 'refunded' : 'cancelled',
      price,
      payments,
      refunds,
      cancellation: entry
    }
  };
}

function edit(customer, input) {
  const src = input || {};
  if (!customer) return fail('missing', 'That customer no longer exists.');
  const id = String(src.refund_id || src.id || '');
  const refunds = copyList(customer.refunds);
  const idx = refunds.findIndex(row => row && row.id === id);
  if (idx < 0) return fail('missing', 'That refund is not on this rental.');
  const entry = Object.assign({}, refunds[idx]);
  const money = readMoney(src);
  if (money.error) return money;
  const capped = capAmount(customer, money.amount, entry.amount);
  if (capped.error) return capped;

  const delta = money.amount - (Number(entry.amount) || 0);
  entry.amount = money.amount;
  entry.method = money.method;
  entry.note = money.note;
  entry.date = money.date;
  if (entry.scope === 'rental') {
    entry.full = capped.cap > 0 && money.amount >= capped.cap;
  }
  refunds[idx] = entry;

  const payments = copyList(customer.payments);
  const payIndex = payments.findIndex(p => p && p.refund_id === id);
  const pay = refundPayment(entry);
  if (pay && payIndex >= 0) payments[payIndex] = Object.assign({}, payments[payIndex], pay);
  else if (pay) payments.push(pay);
  else if (payIndex >= 0) payments.splice(payIndex, 1);

  const price = (Number(customer.price) || 0) - delta;
  const patch = { price, payments, refunds };
  if (entry.scope === 'rental') {
    patch.status = entry.full ? 'refunded' : 'cancelled';
    patch.cancellation = Object.assign({}, customer.cancellation || {}, entry);
  } else {
    patch.extensions = copyList(customer.extensions).map(ext => {
      if (ext && ext.cancelled && ext.cancelled.refund_id === id) {
        return Object.assign({}, ext, {
          cancelled: Object.assign({}, ext.cancelled, {
            amount: entry.amount, method: entry.method, note: entry.note, date: entry.date
          })
        });
      }
      return ext;
    });
  }
  return { ok: true, kind: 'edit', entry, line: auditLine(entry), patch };
}

function undo(customer, refundId) {
  if (!customer) return fail('missing', 'That customer no longer exists.');
  const id = String(refundId || '');
  const refunds = copyList(customer.refunds);
  const idx = refunds.findIndex(row => row && row.id === id);
  if (idx < 0) return fail('missing', 'That refund is not on this rental.');
  const entry = refunds[idx];

  if (entry.scope === 'extension') {
    const sameDays = Number(customer.days) === Number(entry.result_days);
    const sameEnd = String(customer.end_date || '') === String(entry.result_end_date || '');
    if (!sameDays || !sameEnd) {
      return fail('changed', 'This rental was changed after that refund, so it cannot be undone automatically.');
    }
  }
  if (entry.scope === 'rental') {
    if (!isInactive(customer.status) || !customer.cancellation || customer.cancellation.id !== id) {
      return fail('changed', 'This cancellation was already replaced.');
    }
  }

  refunds.splice(idx, 1);
  const payments = copyList(customer.payments).filter(p => !(p && p.refund_id === id)).map(p => {
    if (p && p.refunded === id) {
      const copy = Object.assign({}, p);
      delete copy.refunded;
      return copy;
    }
    return p;
  });
  const extensions = copyList(customer.extensions).map(ext => {
    if (ext && ext.cancelled && ext.cancelled.refund_id === id) {
      const copy = Object.assign({}, ext);
      delete copy.cancelled;
      return copy;
    }
    return ext;
  });
  const price = (Number(customer.price) || 0) + (Number(entry.amount) || 0);

  if (entry.scope === 'rental') {
    return {
      ok: true,
      kind: 'undo-rental',
      entry,
      patch: {
        status: entry.prev_status || 'renting',
        price,
        days: entry.prev_days != null ? entry.prev_days : customer.days,
        end_date: entry.prev_end_date != null ? entry.prev_end_date : (customer.end_date || ''),
        payments,
        extensions,
        refunds,
        cancellation: null
      }
    };
  }
  return {
    ok: true,
    kind: 'undo-extension',
    entry,
    patch: {
      status: customer.status,
      days: entry.prev_days,
      end_date: entry.prev_end_date || '',
      price,
      payments,
      extensions,
      refunds
    }
  };
}

function formPayload(customer, today) {
  const c = customer || {};
  const list = choices(c);
  const net = Math.max(0, paymentSum(c));
  const inactive = isInactive(c.status);
  const mapRecorded = row => ({
    key: row.key,
    days: row.days,
    amount: row.amount,
    from: row.from_end_date,
    to: row.end_date,
    restoreEnd: row.last && isDay(row.from_end_date) ? row.from_end_date : '',
    inferred: false
  });
  const mapInferred = row => ({
    key: row.key,
    days: null,
    amount: row.amount,
    paidOn: row.date,
    restoreEnd: '',
    inferred: true
  });
  return {
    id: c.id,
    name: c.customer_name || '',
    game: c.game_title || '',
    end: c.end_date || '',
    days: Number(c.days) || 0,
    price: Number(c.price) || 0,
    net,
    status: c.status || '',
    today: today || '',
    accountType: c.account_type || '',
    choices: list.recorded.map(mapRecorded).concat(list.inferred.map(mapInferred)),
    manual: list.manual,
    canRental: !inactive && list.canCancelRental,
    inactive,
    editId: inactive && c.cancellation ? c.cancellation.id : '',
    refunds: (Array.isArray(c.refunds) ? c.refunds : []).map(row => ({
      id: row.id,
      scope: row.scope,
      amount: row.amount,
      method: row.method,
      note: row.note || '',
      date: row.date,
      days: row.days_removed || null
    }))
  };
}

module.exports = {
  METHODS, METHOD_LABEL, INACTIVE,
  isInactive, paymentSum, addDays, formatYmd, peso, auditLine,
  choices, endAfterExtension, applyExtension, applyRental, edit, undo, formPayload
};
