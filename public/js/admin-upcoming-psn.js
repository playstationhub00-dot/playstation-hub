// Admin → Games → Coming soon → "Update from PlayStation" list: keeps the gold
// button's words ("Add 3 games · update 1 date · get info for 2 games") in
// step with the ticks. Saves nothing. The same rule renders the first label on
// the server (lib/upcoming-psn.js applyLabel); scripts/test-admin-upcoming-psn-page.js
// checks the two agree. Page wiring is skipped when there is no document (tests).
(function () {
  'use strict';

  function plural(n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); }

  function applyLabel(adds, dates, infos) {
    var parts = [];
    if (adds) parts.push('Add ' + plural(adds, 'game'));
    if (dates) parts.push((parts.length ? 'update ' : 'Update ') + plural(dates, 'date'));
    if (infos) parts.push((parts.length ? 'get info for ' : 'Get info for ') + plural(infos, 'game'));
    return parts.length ? parts.join(' · ') : 'Add selected';
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
        form.querySelectorAll('[data-gmp-date]:checked').length,
        form.querySelectorAll('[data-gmp-info]:checked').length
      );
    }
    form.addEventListener('change', update);
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
