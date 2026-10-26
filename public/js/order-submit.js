// Stops a second submit of the same checkout form. The first submit is left
// alone (an earlier handler may still cancel it for a missing name). A
// double-click after that is ignored, and the button is disabled on the next
// turn so the browser does not drop the request that is already leaving.
(function (root) {
  function guardOrderSubmit(form, event) {
    if (!form || !form.getAttribute || form.getAttribute('data-order-once') == null) return true;
    if (event && event.defaultPrevented) return true;
    if (form.getAttribute('data-order-sent') === '1') {
      if (event && event.preventDefault) event.preventDefault();
      return false;
    }
    form.setAttribute('data-order-sent', '1');
    var btn = form.querySelector && form.querySelector('button[type="submit"]');
    if (btn) setTimeout(function () { btn.disabled = true; }, 0);
    return true;
  }

  var api = { guardOrderSubmit: guardOrderSubmit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PHOrderSubmit = api;
})(typeof window !== 'undefined' ? window : this);
