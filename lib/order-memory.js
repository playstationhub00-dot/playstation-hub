// Local screenshot / test stand-in used only when MongoDB is absent and
// ORDERS_MEMORY=1. Production always has a database and never reaches this.
const rows = [];
let seq = 9000;

function create(fields) {
  const now = new Date().toISOString();
  const state = (fields && fields.state) || 'awaiting_payment';
  const order = Object.assign({
    ref: 'PH-' + String(++seq),
    url_key: 'mem' + seq,
    state,
    payment_proof: null,
    payment_method: null,
    created_at: now,
    state_history: [{ state, at: now }]
  }, fields || {});
  rows.push(order);
  return order;
}

function getByRef(ref) {
  return rows.find(o => o.ref === ref) || null;
}

function listForGame(gameId) {
  const id = String(gameId);
  return rows.filter(o => String(o.game_id) === id);
}

function listAll() {
  return rows.slice();
}

function transition(ref, toState, patch) {
  const order = getByRef(ref);
  if (!order) return null;
  Object.assign(order, patch || {}, { state: toState });
  order.state_history = (order.state_history || []).concat([{ state: toState, at: new Date().toISOString() }]);
  return order;
}

function update(ref, patch) {
  const order = getByRef(ref);
  if (!order) return null;
  Object.assign(order, patch || {});
  return order;
}

function reset() {
  rows.length = 0;
  seq = 9000;
}

module.exports = { create, getByRef, listForGame, listAll, transition, update, reset };
