// Admin → Orders tab: ledger filters (status chip, type, search) that persist
// for the session, Needs You group open/closed memory, the QR countdowns and
// "x ago" ages, and the Payment link button. Loaded on the admin page; the
// page wiring is skipped when there is no document (the test sandbox).
(function () {
  'use strict';

  var CHIPS = ['all', 'out', 'paid', 'unpaid', 'cancelled'];
  var TYPES = ['all', 'rental', 'purchase', 'reservation'];
  var GROUP_KEYS = ['now', 'refunds', 'followups', 'waitlist'];
  var LEDGER_KEY = 'oqLedger';
  var GROUPS_KEY = 'oqGroups';

  // Anything read back from storage is untrusted: unknown values fall back to
  // defaults rather than filtering the ledger down to nothing.
  function normalizeLedgerState(raw) {
    var r = raw || {};
    return {
      chip: CHIPS.indexOf(r.chip) !== -1 ? r.chip : 'all',
      type: TYPES.indexOf(r.type) !== -1 ? r.type : 'all',
      q: typeof r.q === 'string' ? r.q.slice(0, 100) : ''
    };
  }

  // A Coming Soon pre-order carries both is_buy and is_reservation; it is a
  // reservation first. views/partials/admin/orders/ledger.ejs applies the same
  // rule when it writes each row's data-t.
  function orderType(order) {
    var o = order || {};
    if (o.is_reservation) return 'reservation';
    if (o.is_buy) return 'purchase';
    return 'rental';
  }

  function rowMatches(row, state) {
    if (state.chip !== 'all' && row.g !== state.chip) return false;
    if (state.type !== 'all' && row.t !== state.type) return false;
    var q = String(state.q || '').trim().toLowerCase();
    return !q || row.s.indexOf(q) !== -1;
  }

  function isFiltering(state) {
    return state.chip !== 'all' || state.type !== 'all' || String(state.q || '').trim() !== '';
  }

  function normalizeGroups(raw) {
    var out = {};
    if (raw && typeof raw === 'object') {
      GROUP_KEYS.forEach(function (k) {
        if (typeof raw[k] === 'boolean') out[k] = raw[k];
      });
    }
    return out;
  }

  window.__oqFilter = {
    normalizeLedgerState: normalizeLedgerState,
    orderType: orderType,
    rowMatches: rowMatches,
    isFiltering: isFiltering,
    normalizeGroups: normalizeGroups
  };
})();
