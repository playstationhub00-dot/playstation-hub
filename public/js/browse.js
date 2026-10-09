// Browse filters in the page (views/browse.ejs), using the shared rules in
// public/js/browse-filter-core.js on the facts the server embedded:
//  - the filter panel keeps a draft: ticking only updates the panel's counts and
//    its "Show N games" button; that button applies the draft, closing it any
//    other way throws the draft away;
//  - the sticky filter bar's chips drop one filter at once;
//  - applying moves the existing game cards between their tier sections and the
//    one results grid, draws "Also in PS Plus Deluxe" and keeps the URL in step —
//    no reload.
(function () {
  var C = window.BrowseFilterCore;
  var dataEl = document.getElementById('browseData');
  if (!C || !dataEl) return;
  var data = JSON.parse(dataEl.textContent);
  var games = data.games, psplus = data.psplus, ctx = data.ctx;
  var state = data.state, draft = null, showAllPs = false;
  var $ = function (id) { return document.getElementById(id); };
  var each = function (root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); };
  var copy = function (s) { return JSON.parse(JSON.stringify(s)); };
  var panel = $('bfPanel'), form = $('bfForm');

  var cards = {}, homes = {};
  each(document, '.bf-item[data-id]', function (el) { cards[el.getAttribute('data-id')] = el; });
  each(document, '[data-home]', function (el) { homes[el.getAttribute('data-home')] = el; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── The page for the applied filters ──────────────────────────────────────
  function psCard(p) {
    var cover = p.c
      ? '<img src="' + esc(p.c) + '" alt="' + esc(p.n) + '" class="gc2-cover" loading="lazy" decoding="async">'
      : '<div class="gc2-cover-placeholder"><span>' + esc(p.n) + '</span></div>';
    return '<a href="/ps-plus?game=' + encodeURIComponent(p.k) + '" class="game-card gc2-card bf-ps-card">' + cover +
      '<div class="gc2-scrim"></div><div class="gc2-body"><span class="tier-pill tier-gold">PS Plus</span>' +
      '<div class="gc2-title">' + esc(p.n) + '</div>' +
      '<div class="gc2-price">via PS Plus' + (ctx.psplusFrom ? ' · from <b>₱' + ctx.psplusFrom + '</b>' : '') + '</div></div></a>';
  }
  function renderPsplus(v) {
    $('bfPsplus').hidden = !v.psplusOn;
    if (!v.psplusOn) { $('bfPsGrid').innerHTML = ''; return; }
    var shown = showAllPs ? v.psplus : v.psplus.slice(0, C.PSPLUS_LIMIT);
    $('bfPsGrid').innerHTML = shown.map(psCard).join('');
    $('bfPsCount').textContent = v.psplus.length + ' game' + (v.psplus.length === 1 ? '' : 's');
    $('bfPsAll').hidden = shown.length >= v.psplus.length;
    $('bfPsAll').textContent = 'Show all ' + v.psplus.length;
  }
  function renderBar(v) {
    var chips = C.appliedChips(state, ctx);
    $('bfChips').innerHTML = chips.map(function (c) {
      return '<a class="bf-chip-x" data-group="' + esc(c.group) + '" data-value="' + esc(c.value) + '" href="' + esc(c.href) +
        '" aria-label="Remove ' + esc(c.label) + '">' + esc(c.label) + ' ✕</a>';
    }).join('') + (chips.length >= 2 ? '<a class="bf-clear" href="/browse" data-clear-all="1">Clear all</a>' : '');
    $('bfOpenN').textContent = v.selected ? ' · ' + v.selected : '';
    $('bfOpen').classList.toggle('bf-has', v.selected > 0);
    $('resultsCount').textContent = C.countText(v);
  }
  function render() {
    var v = C.view(games, psplus, state, ctx);
    var inGrid = {};
    if (v.active) v.grid.forEach(function (id) { inGrid[id] = true; $('bfGrid').appendChild(cards[id]); });
    games.forEach(function (f) { if (!inGrid[f.id]) homes[f.home].appendChild(cards[f.id]); });
    $('bfSections').hidden = v.active;
    ['bfUpcoming', 'bfPsMonthly'].forEach(function (id) { if ($(id)) $(id).hidden = v.active; });
    var none = v.active && !v.site.length && !v.psplus.length;
    $('bfResults').hidden = !(v.active && (v.siteOn || none));
    $('bfEmpty').hidden = !(v.active && (v.siteOn || none) && v.site.length === 0);
    $('bfEmpty').textContent = v.psplus.length ? 'None of our own games match — but these PS Plus games do.' : 'No games found. Try a different filter.';
    renderBar(v);
    renderPsplus(v);
  }
  function go(next) {
    state = next;
    showAllPs = false;
    var q = C.toQuery(state);
    history.replaceState(null, '', '/browse' + (q ? '?' + q : ''));
    render();
  }

  // ── The filter panel (a draft until "Show N games") ───────────────────────
  function renderPanel() {
    var v = C.view(games, psplus, draft, ctx);
    var byKey = {};
    v.groups.forEach(function (g) { g.chips.forEach(function (c) { byKey[c.group + '|' + c.value] = c; }); });
    each(panel, '.bf-opt', function (row) {
      var c = byKey[row.getAttribute('data-group') + '|' + row.getAttribute('data-value')];
      if (!c) return;
      var box = row.querySelector('input');
      box.checked = c.on;
      box.disabled = c.zero;
      row.classList.toggle('bf-opt-zero', c.zero);
      row.querySelector('.bf-n').textContent = c.count;
    });
    each(panel, '.bf-sec', function (sec) {
      var g = sec.getAttribute('data-group');
      sec.querySelector('.bf-sec-clear').hidden = !v.groups.some(function (x) { return x.key === g && x.chips.some(function (c) { return c.on; }); });
      var more = sec.querySelector('.bf-more');
      if (more && more.querySelector('input:checked')) more.open = true;
    });
    var label = C.applyLabel(v);
    $('bfGo').textContent = label.text;
    $('bfGo').disabled = label.disabled;
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
  }
  function openPanel() {
    draft = copy(state);
    panel.classList.add('bf-show');
    document.body.classList.add('bf-lock');
    renderPanel();
    document.addEventListener('keydown', onKey);
    $('bfClose').focus();
  }
  function closePanel() {
    if (location.hash === '#bfPanel') { location.hash = ''; history.replaceState(null, '', location.pathname + location.search); }
    panel.classList.remove('bf-show');
    document.body.classList.remove('bf-lock');
    document.removeEventListener('keydown', onKey);
    draft = null;
    $('bfOpen').focus();
  }

  $('bfOpen').addEventListener('click', function (e) { e.preventDefault(); openPanel(); });
  [$('bfClose'), $('bfBackdrop')].forEach(function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); closePanel(); });
  });
  form.addEventListener('change', function (e) {
    var row = e.target.closest('.bf-opt');
    if (!row || !draft) return;
    draft = C.toggle(draft, row.getAttribute('data-group'), row.getAttribute('data-value'));
    renderPanel();
  });
  form.addEventListener('click', function (e) {
    var clear = e.target.closest('[data-clear]');
    if (clear && draft) { draft = C.clearGroup(draft, clear.getAttribute('data-clear')); renderPanel(); }
  });
  $('bfClearAll').addEventListener('click', function () {
    if (!draft) return;
    draft = Object.assign(C.emptyState(), { search: draft.search });
    renderPanel();
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!draft || $('bfGo').disabled) return;
    var next = draft;
    closePanel();
    go(next);
  });

  // ── The filter bar's chips ────────────────────────────────────────────────
  $('bfChips').addEventListener('click', function (e) {
    var chip = e.target.closest('.bf-chip-x');
    if (chip) { e.preventDefault(); go(C.toggle(state, chip.getAttribute('data-group'), chip.getAttribute('data-value'))); return; }
    if (e.target.closest('[data-clear-all]')) { e.preventDefault(); go(C.emptyState()); }
  });
  $('bfPsAll').addEventListener('click', function () { showAllPs = true; render(); });

  // A shared link to #bfPanel (or the no-script fallback) opens it properly.
  if (location.hash === '#bfPanel') {
    // location.hash = '' (unlike replaceState alone) un-matches CSS :target, so the panel can close.
    location.hash = '';
    history.replaceState(null, '', location.pathname + location.search);
    openPanel();
  }
  render();
})();
