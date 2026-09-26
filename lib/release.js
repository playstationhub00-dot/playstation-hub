// Releasing a Coming Soon game.
//
// A Coming Soon game and the reservations against it live in two stores: the
// game and customer records in lowdb, the orders in MongoDB. Releasing it
// creates the real game record, moves every paid reservation / pre-order on to
// "paid, waiting for their sign-in code" for that game, turns unpaid ones into
// ordinary orders, re-points the customer records, and only then removes the
// Coming Soon record. Release used to copy the game and delete the Coming Soon
// record, stranding every reservation on a game that no longer existed.
//
// The decisions are pure functions; releaseUpcoming() runs them against
// injected stores so it is tested without MongoDB, lowdb or a server.

const PRE_PAYMENT_STATES = Object.freeze(['awaiting_payment', 'verifying_payment', 'payment_rejected']);

function sameId(a, b) {
  return a != null && b != null && a !== '' && String(a) === String(b);
}

// Every game has both a Trophy and a Non-Trophy account, so Trophy is always
// on. Coming Soon games have no PS4 Primary option; the owner switches it on in
// Edit for the games that have one.
function releasedGameRecord(upcoming, newGameId, nowIso) {
  const u = upcoming || {};
  return {
    id: newGameId,
    title: u.title,
    platform: u.platform || 'PS5',
    genre: u.genre || '',
    description: u.description || '',
    cover_image: u.cover_image || '',
    gallery: Array.isArray(u.gallery) ? u.gallery.slice() : [],
    buy_nt_price: u.buy_nt_price || 0,
    buy_tr_price: u.buy_tr_price || 0,
    non_trophy_slots: u.non_trophy_slots || 0,
    trophy_slots: u.trophy_slots || 0,
    ps4_primary_slots: 0,
    nt_price_7d: u.nt_price_7d || 0,
    nt_price_30d: u.nt_price_30d || 0,
    tr_price_7d: u.tr_price_7d || 0,
    tr_price_30d: u.tr_price_30d || 0,
    trophy_account: true,
    featured: false,
    renters: 0,
    // 'TBA' means it was never announced; the owner fills the real date in.
    release_date: (u.release_date && u.release_date !== 'TBA') ? u.release_date : '',
    released_from_upcoming_id: u.id,
    created_at: nowIso
  };
}

// Only orders for THIS Coming Soon game. An available-game priority
// reservation also rests in 'reserved' but has no upcoming_game_id, so it is
// never selected.
function partitionReleaseOrders(orderList, upcomingId) {
  const move = [];
  const convert = [];
  (orderList || []).forEach(o => {
    if (!o || !sameId(o.upcoming_game_id, upcomingId)) return;
    if (o.state === 'reserved') move.push(o);
    else if (PRE_PAYMENT_STATES.includes(o.state)) convert.push(o);
  });
  return { move, convert };
}

function releaseMessage({ gameTitle, ref, link }) {
  return '🎮 ' + gameTitle + ' is out! Your reservation ' + ref + ' is ready.\n\n'
    + 'Send your sign-in code here and we\'ll set you up: ' + link;
}

// The customer record a reservation already has, turned into the live rental
// or purchase when the owner signs them in. payments are left alone: the
// reservation payment was recorded when it was confirmed.
function activatedReservationCustomer(customer, order, startDate, endDate) {
  const c = Object.assign({}, customer);
  c.status = order.is_buy ? 'bought' : 'renting';
  c.game_id = Number(order.game_id);
  c.days = order.is_buy ? null : (order.days || null);
  c.start_date = startDate;
  c.end_date = order.is_buy ? '' : (endDate || '');
  return c;
}

function findReleasedGame(games, upcomingId) {
  return (games || []).find(g => g && sameId(g.released_from_upcoming_id, upcomingId)) || null;
}

// existingGame: when a previous release attempt already created the real
// game record but left some orders 'failed' (see below), the Coming Soon
// record is kept around so a retry can find it. Pass that already-released
// game in here and releaseUpcoming will reuse it instead of minting a new
// one, so a retry never creates a duplicate.
async function releaseUpcoming({ upcoming, newGameId, existingGame, now, orderStore, gameStore }) {
  const nowIso = (now || new Date()).toISOString();
  const candidates = await orderStore.listByStates(PRE_PAYMENT_STATES.concat(['reserved']));
  const { move, convert } = partitionReleaseOrders(candidates, upcoming.id);

  // The game exists before any order is pointed at it. On a retry after a
  // partial release, the game already exists — reuse it rather than adding
  // a duplicate.
  let game;
  if (existingGame) {
    game = existingGame;
  } else {
    game = releasedGameRecord(upcoming, newGameId, nowIso);
    await gameStore.addGame(game);
  }

  const moved = [];
  const converted = [];
  const failed = [];
  for (const o of move) {
    let r = null;
    try { r = await orderStore.transition(o.ref, 'awaiting_qr', { game_id: newGameId, released_at: nowIso }); } catch (e) { r = null; }
    (r ? moved : failed).push(o.ref);
  }
  for (const o of convert) {
    let r = false;
    try { r = await orderStore.releaseUnpaidReservation(o.ref, newGameId); } catch (e) { r = false; }
    (r ? converted : failed).push(o.ref);
  }

  const customersRepointed = await gameStore.repointUpcomingCustomers(upcoming.id, newGameId);
  // Only remove the Coming Soon record once nothing is left stranded on it —
  // a partial release keeps it so a retry can find the failed orders again.
  if (failed.length === 0) {
    await gameStore.removeUpcoming(upcoming.id);
  }
  return { game, moved, converted, failed, customersRepointed };
}

module.exports = {
  PRE_PAYMENT_STATES,
  releasedGameRecord,
  partitionReleaseOrders,
  releaseMessage,
  activatedReservationCustomer,
  findReleasedGame,
  releaseUpcoming
};
