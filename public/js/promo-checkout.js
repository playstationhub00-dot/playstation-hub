// Replaces the generic promo rows with this customer's loyalty progress
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
      var item = (line && typeof line === 'object') ? line : { kind: 'promo', label: 'Promo', text: String(line || '') };
      if (!item.text) return;
      var row = document.createElement('div');
      row.className = 'gd-promo-item';
      var label = document.createElement('span');
      label.className = 'gd-promo-label';
      label.setAttribute('data-kind', item.kind || 'promo');
      label.textContent = item.label || 'Promo';
      var text = document.createElement('span');
      text.className = 'gd-promo-text';
      text.textContent = item.text;
      row.appendChild(label);
      row.appendChild(text);
      note.appendChild(row);
    });
    note.hidden = !note.childElementCount;
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
