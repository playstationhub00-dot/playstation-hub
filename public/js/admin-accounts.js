// Admin → Accounts tab: filters, the Slots/Accounts view toggle, and the
// account and slot modals. Loaded on every admin page; the DOM wiring only
// runs when the tab's markup is present, and never in the test sandbox.
(function () {
  'use strict';

  var STATUS_VALUES = ['all', 'open', 'rented', 'ending', 'overdue', 'buyed', 'maintenance', 'na'];
  var TYPE_VALUES = ['all', 'trophy', 'non_trophy', 'ps4_primary'];
  var VIEWS = ['slots', 'accounts'];
  var FILTER_KEY = 'accFilters';
  var VIEW_KEY = 'accView';

  function isAll(v) { return !v || v === 'all'; }

  // Anything read back from storage is untrusted: unknown values fall back to
  // defaults rather than filtering the list down to nothing.
  function normalizeState(raw, fallbackView) {
    var r = raw || {};
    var view = VIEWS.indexOf(r.view) !== -1 ? r.view
      : (VIEWS.indexOf(fallbackView) !== -1 ? fallbackView : 'slots');
    return {
      view: view,
      q: typeof r.q === 'string' ? r.q.slice(0, 100) : '',
      status: STATUS_VALUES.indexOf(r.status) !== -1 ? r.status : 'all',
      type: TYPE_VALUES.indexOf(r.type) !== -1 ? r.type : 'all',
      game: /^\d+$/.test(String(r.game == null ? '' : r.game)) ? String(r.game) : ''
    };
  }

  // "Rented" means every rented slot; "Ending" and "Overdue" are the narrower
  // subsets the template marks with data-due.
  function statusMatches(status, due, want) {
    if (isAll(want)) return true;
    if (want === 'ending' || want === 'overdue') return status === 'rented' && due === want;
    return status === want;
  }

  function chipMatches(chip, f) {
    return statusMatches(chip.status, chip.due, f.status) && (isAll(f.type) || chip.type === f.type);
  }

  function textAndGameMatch(item, f) {
    if (f.game && item.gameIds.indexOf(String(f.game)) === -1) return false;
    var q = String(f.q || '').trim().toLowerCase();
    return !q || item.search.indexOf(q) !== -1;
  }

  function slotMatches(item, f) {
    return chipMatches(item, f) && textAndGameMatch(item, f);
  }

  // An account shows when it matches search and game, and at least one of its
  // enabled slots matches status and type together.
  function accountMatches(account, chips, f) {
    if (!textAndGameMatch(account, f)) return false;
    if (isAll(f.status) && isAll(f.type)) return true;
    return chips.some(function (c) { return !c.disabled && chipMatches(c, f); });
  }

  function activeFilterCount(f) {
    return (isAll(f.status) ? 0 : 1) + (isAll(f.type) ? 0 : 1) + (f.game ? 1 : 0);
  }

  function isFiltering(f) {
    return activeFilterCount(f) > 0 || String(f.q || '').trim() !== '';
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  window.__accFilter = {
    normalizeState: normalizeState,
    statusMatches: statusMatches,
    chipMatches: chipMatches,
    slotMatches: slotMatches,
    accountMatches: accountMatches,
    activeFilterCount: activeFilterCount,
    isFiltering: isFiltering,
    plural: plural
  };
})();
