// Order lifecycle + persistence. Unlike every other collection in this app,
// orders live as individual MongoDB documents rather than inside the
// whole-state blob that server.js rewrites on each save — orders are written
// by customers and are money-adjacent, so they cannot tolerate that model's
// last-write-wins behaviour.
const STATES = Object.freeze([
  'awaiting_payment', 'verifying_payment', 'awaiting_qr', 'qr_pending',
  'active', 'awaiting_return', 'verifying_return', 'closed'
]);
const TERMINAL = Object.freeze(['cancelled', 'payment_rejected']);
const OWNER_STATES = Object.freeze(['verifying_payment', 'qr_pending', 'verifying_return']);

// QR codes from a PS5 expire within minutes, so a code submitted overnight is
// worthless by morning. This window is what the countdown counts down.
const QR_WINDOW_MS = 10 * 60 * 1000;

const ALLOWED = {
  awaiting_payment:  ['verifying_payment', 'cancelled'],
  verifying_payment: ['awaiting_qr', 'payment_rejected', 'cancelled'],
  payment_rejected:  ['awaiting_payment', 'cancelled'],
  awaiting_qr:       ['qr_pending', 'cancelled'],
  qr_pending:        ['active', 'awaiting_qr', 'cancelled'],
  active:            ['awaiting_return'],
  awaiting_return:   ['verifying_return'],
  verifying_return:  ['closed', 'awaiting_return'],
  closed:            [],
  cancelled:         []
};

function canTransition(from, to) {
  return Array.isArray(ALLOWED[from]) && ALLOWED[from].includes(to);
}

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

async function transition(ref, toState, patch) {
  const col = await _col('orders');
  if (!col) return null;
  const current = await getByRef(ref);
  if (!current) return null;
  if (!canTransition(current.state, toState)) return null;
  const at = new Date().toISOString();
  const update = Object.assign({}, patch || {}, { state: toState });
  await col.updateOne(
    { ref: current.ref, state: current.state },
    { $set: update, $push: { state_history: { state: toState, at } } }
  );
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

module.exports = {
  STATES, TERMINAL, OWNER_STATES, QR_WINDOW_MS,
  init, canTransition, manilaDate, parseOrderRef,
  nextRef, create, getByRef, listByStates, transition,
  expireStaleQrs, advanceEndedRentals, markRefunded, linkPsid
};
