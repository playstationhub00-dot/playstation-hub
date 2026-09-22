(function(){
  var key = ORD_PAID_SEEN_KEY;
  var modal = document.getElementById('ordPaidModal');
  if (!modal) return;
  var seen = false;
  try { seen = !!localStorage.getItem(key); } catch (e) {}
  if (seen) return;
  modal.hidden = false;
  function dismiss() {
    modal.hidden = true;
    try { localStorage.setItem(key, '1'); } catch (e) {}
  }
  var later = document.getElementById('ordModalLater');
  if (later) later.addEventListener('click', dismiss);
  var showMe = document.getElementById('ordModalShowMe');
  if (showMe) showMe.addEventListener('click', function(){
    dismiss();
    var target = document.getElementById('ordQrStep');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();
