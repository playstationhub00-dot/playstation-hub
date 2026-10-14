// Replaces the generic promo lines with this customer's loyalty progress
// once they type the Facebook name the rental ledger knows.
(function () {
  var note = document.getElementById('gdPromoNote');
  var input = document.getElementById('orderFbName');
  if (!note || !input) return;
  var game = note.getAttribute('data-game-id') || '';
  var timer = null;
  function paint(lines) {
    note.textContent = '';
    (lines || []).forEach(function (line) {
      var p = document.createElement('p');
      p.textContent = line;
      note.appendChild(p);
    });
    note.hidden = !lines || !lines.length;
  }
  input.addEventListener('input', function () {
    clearTimeout(timer);
    var name = input.value.trim();
    if (name.length < 2) return;
    timer = setTimeout(function () {
      fetch('/api/promo-line?name=' + encodeURIComponent(name) + '&game=' + encodeURIComponent(game))
        .then(function (r) { return r.json(); })
        .then(function (data) { if (data && Array.isArray(data.lines)) paint(data.lines); })
        .catch(function () {});
    }, 400);
  });
})();
