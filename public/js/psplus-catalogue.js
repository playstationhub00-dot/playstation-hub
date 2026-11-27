(function () {
  var dataEl = document.getElementById('pspData');
  var grid = document.getElementById('pspGrid');
  var modal = document.getElementById('pspModal');
  if (!dataEl || !grid || !modal) return;
  var games = [];
  try { games = JSON.parse(dataEl.textContent) || []; } catch (e) { games = []; }
  var shown = 0;
  var PAGE = 24;
  var filtered = games;

  function fold(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/['’`]/g, '')
      .replace(/[®™©]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function paint(reset) {
    if (reset) { grid.innerHTML = ''; shown = 0; }
    var slice = filtered.slice(shown, shown + PAGE);
    shown += slice.length;
    grid.insertAdjacentHTML('beforeend', slice.map(function (g) {
      var cover = g.c
        ? '<img src="' + String(g.c).replace(/"/g, '') + '" alt="" loading="lazy">'
        : '<div class="psp-ph"></div>';
      return '<div class="psp-tile">' + cover + '<b>' + String(g.n || '').replace(/[&<>]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
      }) + '</b></div>';
    }).join(''));
    var more = document.getElementById('pspMore');
    if (more) more.hidden = shown >= filtered.length;
    var count = document.getElementById('pspCount');
    if (count) count.textContent = String(filtered.length);
    var foot = document.getElementById('pspFoot');
    if (foot) foot.textContent = filtered.length
      ? 'Showing ' + shown + ' of ' + filtered.length
      : 'No games match.';
  }
  function open() {
    modal.hidden = false;
    document.getElementById('pspSearch').focus();
  }
  function close() { modal.hidden = true; }
  ['pspSeeOpen', 'pspSeeTab'].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', open);
  });
  document.getElementById('pspClose').addEventListener('click', close);
  document.getElementById('pspBack').addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
  document.getElementById('pspSearch').addEventListener('input', function () {
    var q = fold(this.value);
    filtered = !q ? games : games.filter(function (g) { return fold(g.n).indexOf(q) >= 0; });
    paint(true);
  });
  var more = document.getElementById('pspMore');
  if (more) more.addEventListener('click', function () { paint(false); });
  paint(true);
})();
