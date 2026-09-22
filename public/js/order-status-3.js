// Copy-to-clipboard for the expired-code notice.
//
// Its own handler rather than the payment step's: the two never appear on the
// same page (one is awaiting_qr, the other is awaiting_payment), and sharing
// one would have meant editing a money-adjacent flow that already works to
// save a few lines here.
//
// The fallback matters more than usual on this page — customers arrive from
// the Facebook in-app browser, where navigator.clipboard is often unavailable,
// and a dead Copy button is worse than no button at all.
(function () {
  var btn = document.getElementById('ordExpCopyBtn');
  var box = document.getElementById('ordExpMsg');
  if (!btn || !box) return;

  function done() {
    btn.textContent = 'Copied ✓';
    setTimeout(function () { btn.textContent = 'Copy this message'; }, 1800);
  }

  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = box.textContent;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { btn.textContent = 'Press and hold the text to copy'; }
    document.body.removeChild(ta);
  }

  btn.addEventListener('click', function () {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(box.textContent).then(done).catch(fallback);
    } else { fallback(); }
  });
})();
