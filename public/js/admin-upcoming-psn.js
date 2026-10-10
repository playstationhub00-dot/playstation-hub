// Admin → Games → Coming soon → "Update from PlayStation" list: keeps the gold
// button's words ("Add 3 games · update 1 date") in step with the ticks.
// Saves nothing. The same rule renders the first label on the server
// (lib/upcoming-psn.js applyLabel); scripts/test-admin-upcoming-psn-page.js checks
// the two agree. Page wiring is skipped when there is no document (tests).
(function () {
  'use strict';

  function plural(n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); }

  function applyLabel(adds, dates) {
    if (adds && dates) return 'Add ' + plural(adds, 'game') + ' · update ' + plural(dates, 'date');
    if (adds) return 'Add ' + plural(adds, 'game');
    if (dates) return 'Update ' + plural(dates, 'date');
    return 'Add selected';
  }

  if (typeof window !== 'undefined') window.__gmpApplyLabel = applyLabel;
  if (typeof document === 'undefined' || !document.getElementById) return;

  function init() {
    var form = document.getElementById('gmpForm');
    var button = form && form.querySelector('[data-gmp-apply]');
    if (!button) return;
    function update() {
      button.textContent = applyLabel(
        form.querySelectorAll('[data-gmp-add]:checked').length,
        form.querySelectorAll('[data-gmp-date]:checked').length
      );
    }
    form.addEventListener('change', update);
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
