// Dismisses the top promo banner for this visit, and counts one view per
// session per day. A dismissed banner stays hidden, so it is not counted again.
(function () {
  var bar = document.getElementById('promoBanner');
  if (!bar) return;
  var id = bar.getAttribute('data-promo-id') || '';
  var key = 'promoBannerDismissed:' + id;
  function hide() { bar.hidden = true; }
  try {
    if (window.sessionStorage && sessionStorage.getItem(key) === '1') { hide(); return; }
  } catch (e) {}
  var btn = document.getElementById('promoBannerClose');
  if (btn) btn.addEventListener('click', function () {
    hide();
    try { sessionStorage.setItem(key, '1'); } catch (e) {}
  });
  try {
    fetch('/api/track/promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id })
    });
  } catch (e) {}
})();
