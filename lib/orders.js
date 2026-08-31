// Order lifecycle + persistence. Unlike every other collection in this app,
// orders live as individual MongoDB documents rather than inside the
// whole-state blob that server.js rewrites on each save — orders are written
// by customers and are money-adjacent, so they cannot tolerate that model's
// last-write-wins behaviour.
const STATES = Object.freeze([
  'awaiting_payment', 'verifying_payment', 'awaiting_qr', 'qr_pending',
  'active', 'awaiting_return', 'verifying_return', 'closed', 'reserved',
  'waitlisted'
]);
const TERMINAL = Object.freeze(['cancelled', 'payment_rejected']);
const queueRules = require('./queue');
const OWNER_STATES = Object.freeze(['verifying_payment', 'qr_pending', 'verifying_return']);
// States that mean "payment has not been verified yet" — anything not in this
// list counts as paid/completed. Shared by every "did this order complete"
// readout in server.js so they can never silently diverge from each other.
const PAID_EXCLUDED_STATES = Object.freeze(['awaiting_payment', 'verifying_payment', 'payment_rejected', 'cancelled']);

// QR codes from a PS5 expire within minutes, so a code submitted overnight is
// worthless by morning. This window is what the countdown counts down.
const QR_WINDOW_MS = 10 * 60 * 1000;

const ALLOWED = {
  // 'awaiting_qr' lets the owner confirm a payment that arrived outside the
  // site (e.g. Messenger) without routing it through verifying_payment,
  // which would make the owner "verify" a payment they personally just
  // confirmed. See POST /admin/orders/:ref/mark-paid.
  awaiting_payment:  ['verifying_payment', 'awaiting_qr', 'cancelled'],
  // Reservation orders (Coming Soon downpayments) settle into 'reserved'
  // instead of 'awaiting_qr' — there is no console to sign into until the
  // game actually releases.
  verifying_payment: ['awaiting_qr', 'reserved', 'payment_rejected', 'cancelled'],
  payment_rejected:  ['awaiting_payment', 'awaiting_qr', 'cancelled'],
  awaiting_qr:       ['qr_pending', 'cancelled'],
  qr_pending:        ['active', 'awaiting_qr', 'cancelled'],
  active:            ['awaiting_return'],
  awaiting_return:   ['verifying_return'],
  verifying_return:  ['closed', 'awaiting_return'],
  closed:            [],
  cancelled:         [],
  // Resting state for a confirmed reservation — the owner converts it to a
  // real rental manually once the game releases, outside this state machine.
  reserved:          [],
  // Fall in Line: a free, unpaid entry recorded so the owner can see and
  // message the customer without scrolling chat. Nothing transitions it
  // automatically — the owner starts a fresh real order by hand once a slot
  // opens for that person (same as they already do today from a Messenger
  // DM), and can drop a stale entry via /admin/orders/:ref/cancel.
  //
  // 'awaiting_payment' is the Fall in Line -> Priority upgrade
  // (POST /order/:ref/upgrade-priority). Upgrading in place rather than
  // creating a second order is what lets the customer keep their ref, their
  // order link and — because created_at is untouched — their place in line.
  waitlisted:        ['cancelled', 'awaiting_payment']
};

function canTransition(from, to) {
  return Array.isArray(ALLOWED[from]) && ALLOWED[from].includes(to);
}

// "The customer paid and got the game" — the shared definition of a completed
// order. Reads through PAID_EXCLUDED_STATES so the orders ledger and the weekly
// funnel readout can never disagree about what counts as completed.
function isPaid(state) {
  return !PAID_EXCLUDED_STATES.includes(state);
}

// Orders still out with a customer: paid, but the account has not come back yet.
// A subset of isPaid(), not a separate bucket.
const OUT_STATES = Object.freeze(['awaiting_qr', 'qr_pending', 'active', 'awaiting_return', 'verifying_return']);

// Railway runs in UTC but this business runs on Manila time (UTC+8), so
// toISOString().slice(0,10) reports the previous calendar day for the whole
// Manila morning. Shift into Manila first, then read the date parts.
function manilaDate(d) {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// The ref on an m.me link is attacker-controllable — anyone can open
// m.me/OurPage?ref=<anything>. Only the exact PH-NNNN shape is allowed
// through, so a hostile or malformed payload never reaches a Mongo query.
function parseOrderRef(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const m = /^PH-(\d{4,})$/i.exec(String(raw).trim());
  return m ? 'PH-' + m[1] : null;
}

let _getDb = null;
function init(getDbFn) { _getDb = getDbFn; }

async function _col(name) {
  if (!_getDb) throw new Error('lib/orders: init(getDb) was never called');
  const db = await _getDb();
  return db ? db.collection(name) : null;
}

async function nextRef() {
  const counters = await _col('counters');
  if (!counters) return 'PH-0001';
  const r = await counters.findOneAndUpdate(
    { _id: 'orderRef' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const seq = (r && r.value ? r.value.seq : (r ? r.seq : 1)) || 1;
  return 'PH-' + String(seq).padStart(4, '0');
}

async function create(fields) {
  const col = await _col('orders');
  if (!col) throw new Error('lib/orders: no database available');
  const now = new Date().toISOString();
  const order = Object.assign({
    ref: await nextRef(),
    // An unguessable companion to the sequential, human-readable ref. The ref
    // alone is not authorization — anyone can enumerate PH-0001, PH-0002, ...
    // — so routes that touch a specific order also require this key.
    url_key: require('crypto').randomBytes(6).toString('hex'),
    state: 'awaiting_payment',
    payment_proof: null,
    payment_channel: null,
    payment_method: null,
    qr_image: null,
    qr_expires_at: null,
    return_proof: null,
    deposit_refunded: false,
    psid: null,
    psid_linked_at: null,
    start_date: '',
    end_date: '',
    created_at: now,
    state_history: [{ state: 'awaiting_payment', at: now }]
  }, fields);
  await col.insertOne(order);
  return order;
}

async function getByRef(ref) {
  const col = await _col('orders');
  if (!col) return null;
  const clean = parseOrderRef(ref);
  if (!clean) return null;
  return col.findOne({ ref: clean });
}

async function listByStates(states) {
  const col = await _col('orders');
  if (!col) return [];
  return col.find({ state: { $in: states } }).sort({ created_at: -1 }).toArray();
}

// Every order that could hold a place in one game's queue. Deliberately broader
// than the queue itself: the membership, expiry and ordering rules all live in
// lib/queue.js, so this stays a dumb fetch and there is exactly one place where
// "who is in line" is decided.
async function listQueueCandidates(gameId) {
  const col = await _col('orders');
  if (!col) return [];
  const states = queueRules.QUEUE_STATES.concat(queueRules.UPGRADE_PENDING_STATES);
  return col.find({
    game_id: gameId,
    state: { $in: states }
  }).sort({ created_at: 1 }).toArray();
}

async function transition(ref, toState, patch) {
  const col = await _col('orders');
  if (!col) return null;
  const current = await getByRef(ref);
  if (!current) return null;
  if (!canTransition(current.state, toState)) return null;
  const at = new Date().toISOString();
  const update = Object.assign({}, patch || {}, { state: toState });
  const r = await col.updateOne(
    { ref: current.ref, state: current.state },
    { $set: update, $push: { state_history: { state: toState, at } } }
  );
  // The filter above pins both ref and the state we just read. If another
  // actor (an owner action, or a sweep like expireStaleQrs/advanceEndedRentals)
  // changed this order's state between our getByRef() and this updateOne(),
  // matchedCount is 0 and the $set/$push silently did nothing. Without this
  // check we'd unconditionally re-fetch and return the unchanged document as
  // if the transition had succeeded, misleading any caller that checks
  // `if (result)` to confirm success.
  if (r.matchedCount === 0) return null;
  return getByRef(current.ref);
}

// Sweeps QR codes whose window has closed back to awaiting_qr so the customer
// is asked for a fresh one instead of waiting on a code that can no longer work.
async function expireStaleQrs() {
  const col = await _col('orders');
  if (!col) return 0;
  const stale = await col.find({
    state: 'qr_pending',
    qr_expires_at: { $lt: new Date().toISOString() }
  }).toArray();
  let moved = 0;
  for (const o of stale) {
    const r = await transition(o.ref, 'awaiting_qr', { qr_image: null, qr_expires_at: null });
    if (r) moved++;
  }
  return moved;
}

// Rentals whose end date has passed move themselves into awaiting_return, so
// the customer is prompted for return proof without the owner having to notice
// the date. Nothing else triggers this transition.
async function advanceEndedRentals() {
  const col = await _col('orders');
  if (!col) return 0;
  const today = manilaDate(new Date());
  const ended = await col.find({ state: 'active', end_date: { $lt: today, $ne: '' } }).toArray();
  let moved = 0;
  for (const o of ended) {
    const r = await transition(o.ref, 'awaiting_return', {});
    if (r) moved++;
  }
  return moved;
}

// A flag on an already-closed order, not a lifecycle move — transition() would
// reject closed→closed, so this writes directly.
async function markRefunded(ref) {
  const col = await _col('orders');
  if (!col) return false;
  const clean = parseOrderRef(ref);
  if (!clean) return false;
  const r = await col.updateOne({ ref: clean }, { $set: { deposit_refunded: true } });
  return r.modifiedCount > 0;
}

// Records the customer-table id an order produced when it went active, so a
// retried or raced advance call never creates a second customer record for
// the same order. Not a lifecycle move, so it bypasses transition().
async function setCustomerId(ref, customerId) {
  const col = await _col('orders');
  if (!col) return false;
  const clean = parseOrderRef(ref);
  if (!clean) return false;
  const r = await col.updateOne({ ref: clean }, { $set: { customer_id: customerId } });
  return r.modifiedCount > 0;
}

// Attaches a Messenger PSID to an order. This is the only place the app ever
// learns which Facebook thread belongs to which order, and it is not
// reconstructable after the fact — hence capturing it from day one even though
// nothing sends messages yet.
async function linkPsid(ref, psid) {
  const col = await _col('orders');
  if (!col) return false;
  const clean = parseOrderRef(ref);
  if (!clean || !psid) return false;
  const r = await col.updateOne(
    { ref: clean },
    { $set: { psid: String(psid), psid_linked_at: new Date().toISOString() } }
  );
  return r.modifiedCount > 0;
}

// Hard-deletes an order. For owner-initiated cleanup of test/duplicate/
// mistaken orders — not part of the customer-facing lifecycle, so it
// bypasses transition() entirely.
async function deleteOrder(ref) {
  const col = await _col('orders');
  if (!col) return false;
  const clean = parseOrderRef(ref);
  if (!clean) return false;
  const r = await col.deleteOne({ ref: clean });
  return r.deletedCount > 0;
}

module.exports = {
  STATES, TERMINAL, OWNER_STATES, PAID_EXCLUDED_STATES, OUT_STATES, QR_WINDOW_MS,
  init, canTransition, isPaid, manilaDate, parseOrderRef,
  nextRef, create, getByRef, listByStates, listQueueCandidates, transition,
  expireStaleQrs, advanceEndedRentals, markRefunded, setCustomerId, linkPsid, deleteOrder
};
