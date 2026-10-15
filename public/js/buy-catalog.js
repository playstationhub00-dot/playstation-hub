// The Buy catalog in the page (views/buy-catalog.ejs), using the shared rules
// in public/js/buy-catalog-core.js on the facts the server embedded:
//  - tabs, the search box and the Sort menu change the grid at once;
//  - the filter panel keeps a draft: ticking only updates the panel's counts and
//    its "Show N games" button; that button applies the draft, closing it any
//    other way throws the draft away;
//  - the filter bar's chips drop one filter at once;
//  - every change shows, hides and orders the cards already on the page and
//    keeps the URL in step — no reload.
(function () {
  var C = window.BuyCatalogCore;
  var dataEl = document.getElementById('shopData');
  if (!C || !dataEl) return;
  var data = JSON.parse(dataEl.textContent);
  var state = data.state, draft = null;
  var $ = function (id) { return document.getElementById(id); };
  var each = function (root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); };
  var copy = function (s) { return JSON.parse(JSON.stringify(s)); };
  var panel = $('scPanel'), form = $('scForm'), search = $('scSearch');

  var gameCards = {}, boxCards = {};
  each(document, '#scGrid .shop-item[data-id]', function (el) { gameCards[el.getAttribute('data-id')] = el; });
  each(document, '#scBoxGrid .shop-item[data-box]', function (el) { boxCards[el.getAttribute('data-box')] = el; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── The page for the current state ────────────────────────────────────────
  // The tab's matches, in order, at the front of their grid; the rest hidden.
  function place(cards, grid, ids) {
    var on = {};
    ids.forEach(function (id) {
      var el = cards[id];
      if (!el) return;
      on[id] = true;
      el.hidden = false;
      grid.appendChild(el);
    });
    Object.keys(cards).forEach(function (id) { if (!on[id]) cards[id].hidden = true; });
  }
  function renderTabs(v) {
    var byKey = {};
    v.tabs.forEach(function (t) { byKey[t.key] = t; });
    each($('scTabs'), '.bf-tab', function (el) {
      var t = byKey[el.getAttribute('data-tab')];
      if (!t) return;
      el.classList.toggle('on', t.on);
      if (t.on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
      el.href = t.href;
      el.querySelector('.bf-tab-n').textContent = t.count;
    });
  }
  function renderBar(v) {
    $('scCount').textContent = C.countText(v);
    $('scSort').innerHTML = v.sorts.map(function (o) {
      return '<option value="' + o.key + '"' + (o.on ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    var chips = v.filters ? C.appliedChips(state) : [];
    $('scChips').innerHTML = chips.map(function (c) {
      return '<a class="bf-chip-x" data-group="' + esc(c.group) + '" data-value="' + esc(c.value) + '" href="' + esc(c.href) +
        '" aria-label="Remove ' + esc(c.label) + '">' + esc(c.label) + ' ✕</a>';
    }).join('') + (chips.length >= 2 ? '<a class="bf-clear" href="' + esc(C.href(C.clearFilters(state))) + '" data-clear-all="1">Clear all</a>' : '');
    $('scChips').hidden = !chips.length;
    $('scOpen').hidden = !v.filters;
    $('scOpenN').textContent = v.selected ? ' · ' + v.selected : '';
    $('scOpen').classList.toggle('bf-has', v.selected > 0);
  }
  function render() {
    var v = C.view(data, state);
    renderTabs(v);
    renderBar(v);
    place(gameCards, $('scGrid'), v.kind === 'games' ? v.ids : []);
    place(boxCards, $('scBoxGrid'), v.kind === 'boxes' ? v.ids : []);
    $('scGrid').hidden = v.kind !== 'games';
    $('scBoxGrid').hidden = v.kind !== 'boxes';
    each($('scGrid'), '.shop-rank', function (el) { el.hidden = !v.ranked; });
    $('scEmpty').hidden = v.count > 0;
    $('scReset').href = C.href(C.resetState(state));
  }
  function go(next) {
    state = next;
    history.replaceState(null, '', C.href(state));
    render();
  }
  // After a tab change deep down the page, start the new grid from its top.
  function toTop() {
    var y = $('scTop').getBoundingClientRect().top + window.pageYOffset;
    var start = document.querySelector('.shop-cat-head').getBoundingClientRect().bottom + window.pageYOffset;
    if (y > start + 1) window.scrollTo(0, start);
  }

  // ── Tabs, search and sort ─────────────────────────────────────────────────
  $('scTabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.bf-tab');
    // Ctrl/Cmd/Shift-click or a middle click opens the tab's link as usual.
    if (!tab || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    go(C.withTab(state, tab.getAttribute('data-tab')));
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    toTop();
  });
  search.addEventListener('input', function () { go(C.withSearch(state, search.value)); });
  $('scSearchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    search.blur();
  });
  $('scSort').addEventListener('change', function () { go(C.withSort(state, $('scSort').value)); });
  $('scReset').addEventListener('click', function (e) {
    e.preventDefault();
    search.value = '';
    go(C.resetState(state));
  });

  // ── The filter panel (a draft until "Show N games") ───────────────────────
  function renderPanel() {
    var v = C.view(data, draft);
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
    $('scGo').textContent = label.text;
    $('scGo').disabled = label.disabled;
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
    $('scClose').focus();
  }
  function closePanel() {
    if (location.hash === '#scPanel') { location.hash = ''; history.replaceState(null, '', location.pathname + location.search); }
    panel.classList.remove('bf-show');
    document.body.classList.remove('bf-lock');
    document.removeEventListener('keydown', onKey);
    draft = null;
    $('scOpen').focus();
  }

  $('scOpen').addEventListener('click', function (e) { e.preventDefault(); openPanel(); });
  [$('scClose'), $('scBackdrop')].forEach(function (el) {
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
  $('scClearAll').addEventListener('click', function () {
    if (!draft) return;
    draft = C.clearFilters(draft);
    renderPanel();
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!draft || $('scGo').disabled) return;
    var next = draft;
    closePanel();
    go(next);
  });

  // ── The filter bar's chips ────────────────────────────────────────────────
  $('scChips').addEventListener('click', function (e) {
    var chip = e.target.closest('.bf-chip-x');
    if (chip) { e.preventDefault(); go(C.toggle(state, chip.getAttribute('data-group'), chip.getAttribute('data-value'))); return; }
    if (e.target.closest('[data-clear-all]')) { e.preventDefault(); go(C.clearFilters(state)); }
  });

  // A shared link to #scPanel (or the no-script fallback) opens it properly.
  if (location.hash === '#scPanel') {
    // location.hash = '' (unlike replaceState alone) un-matches CSS :target, so the panel can close.
    location.hash = '';
    history.replaceState(null, '', location.pathname + location.search);
    openPanel();
  }
  render();
})();
