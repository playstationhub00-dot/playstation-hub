// The Browse catalog in the page (views/browse.ejs), using the shared rules in
// public/js/browse-filter-core.js on the facts the server embedded:
//  - tabs, the search box and the Sort menu change the grid at once;
//  - the filter panel keeps a draft: ticking only updates the panel's counts and
//    its "Show N games" button; that button applies the draft, closing it any
//    other way throws the draft away;
//  - the filter bar's chips drop one filter at once;
//  - every change shows, hides and orders the cards already on the page, draws
//    the PS Plus Deluxe games and keeps the URL in step — no reload.
(function () {
  var C = window.BrowseFilterCore;
  var dataEl = document.getElementById('browseData');
  if (!C || !dataEl) return;
  var data = JSON.parse(dataEl.textContent);
  var ctx = data.ctx;
  var state = data.state, draft = null, showAllPs = false;
  var $ = function (id) { return document.getElementById(id); };
  var each = function (root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); };
  var copy = function (s) { return JSON.parse(JSON.stringify(s)); };
  var panel = $('bfPanel'), form = $('bfForm'), search = $('bfSearch');

  var gameCards = {}, soonCards = {};
  each(document, '#bfGrid .bf-item[data-id]', function (el) { gameCards[el.getAttribute('data-id')] = el; });
  each(document, '#bfSoonGrid .bf-item[data-soon]', function (el) { soonCards[el.getAttribute('data-soon')] = el; });

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
  function psCard(p) {
    var cover = p.c
      ? '<img src="' + esc(p.c) + '" alt="' + esc(p.n) + '" class="gc2-cover" loading="lazy" decoding="async">'
      : '<div class="gc2-cover-placeholder"><span>' + esc(p.n) + '</span></div>';
    return '<a href="/ps-plus?game=' + encodeURIComponent(p.k) + '" class="game-card gc2-card bf-ps-card">' + cover +
      '<div class="gc2-scrim"></div><div class="gc2-body"><span class="tier-pill tier-gold">PS Plus</span>' +
      '<div class="gc2-title">' + esc(p.n) + '</div>' +
      '<div class="gc2-price">via PS Plus' + (data.psplusFrom ? ' · from <b>₱' + data.psplusFrom + '</b>' : '') + '</div></div></a>';
  }
  function renderPsplus(v) {
    $('bfPsplus').hidden = v.kind !== 'psplus';
    if (v.kind !== 'psplus') { $('bfPsGrid').innerHTML = ''; return; }
    var shown = showAllPs ? v.psplus : v.psplus.slice(0, C.PSPLUS_LIMIT);
    $('bfPsGrid').innerHTML = shown.map(psCard).join('');
    $('bfPsAll').hidden = shown.length >= v.psplus.length;
    $('bfPsAll').textContent = 'Show all ' + v.psplus.length;
  }
  function renderTabs(v) {
    var byKey = {};
    v.tabs.forEach(function (t) { byKey[t.key] = t; });
    each($('bfTabs'), '.bf-tab', function (el) {
      var t = byKey[el.getAttribute('data-tab')];
      if (!t) return;
      el.classList.toggle('on', t.on);
      if (t.on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
      el.href = t.href;
      el.querySelector('.bf-tab-n').textContent = t.count;
    });
  }
  function renderBar(v) {
    $('bfCount').textContent = C.countText(v);
    $('bfSort').innerHTML = v.sorts.map(function (o) {
      return '<option value="' + o.key + '"' + (o.on ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    $('bfSortWrap').hidden = v.sorts.length < 2;
    var chips = v.filters ? C.appliedChips(state, ctx) : [];
    $('bfChips').innerHTML = chips.map(function (c) {
      return '<a class="bf-chip-x" data-group="' + esc(c.group) + '" data-value="' + esc(c.value) + '" href="' + esc(c.href) +
        '" aria-label="Remove ' + esc(c.label) + '">' + esc(c.label) + ' ✕</a>';
    }).join('') + (chips.length >= 2 ? '<a class="bf-clear" href="' + esc(C.href(C.clearFilters(state))) + '" data-clear-all="1">Clear all</a>' : '');
    $('bfChips').hidden = !chips.length;
    $('bfOpen').hidden = !v.filters;
    $('bfOpenN').textContent = v.selected ? ' · ' + v.selected : '';
    $('bfOpen').classList.toggle('bf-has', v.selected > 0);
  }
  function render() {
    var v = C.view(data, state, ctx);
    renderTabs(v);
    renderBar(v);
    place(gameCards, $('bfGrid'), v.kind === 'games' ? v.ids : []);
    place(soonCards, $('bfSoonGrid'), v.kind === 'soon' ? v.ids : []);
    $('bfGrid').hidden = v.kind !== 'games';
    $('bfSoonGrid').hidden = v.kind !== 'soon';
    each($('bfGrid'), '.bf-rank', function (el) { el.hidden = !v.ranked; });
    $('bfNotes').innerHTML = v.notes.map(function (n) {
      return '<p class="cat-desc"><b>' + esc(n.name) + '</b> — ' + esc(n.desc) + '</p>';
    }).join('');
    $('bfEmpty').hidden = v.count > 0;
    $('bfReset').href = C.href(C.resetState(state));
    renderPsplus(v);
  }
  function go(next) {
    state = next;
    showAllPs = false;
    history.replaceState(null, '', C.href(state));
    render();
  }
  // After a tab change deep down the page, start the new grid from its top.
  function toTop() {
    var y = $('bfTop').getBoundingClientRect().top + window.pageYOffset;
    var start = document.querySelector('.browse-header').getBoundingClientRect().bottom + window.pageYOffset;
    if (y > start + 1) window.scrollTo(0, start);
  }

  // ── Tabs, search and sort ─────────────────────────────────────────────────
  $('bfTabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.bf-tab');
    if (!tab) return;
    e.preventDefault();
    go(C.withTab(state, tab.getAttribute('data-tab')));
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    toTop();
  });
  search.addEventListener('input', function () { go(C.withSearch(state, search.value)); });
  $('bfSearchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    search.blur();
  });
  $('bfSort').addEventListener('change', function () { go(C.withSort(state, $('bfSort').value)); });
  $('bfReset').addEventListener('click', function (e) {
    e.preventDefault();
    search.value = '';
    go(C.resetState(state));
  });

  // ── The filter panel (a draft until "Show N games") ───────────────────────
  function renderPanel() {
    var v = C.view(data, draft, ctx);
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
    draft = C.clearFilters(draft);
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
    if (e.target.closest('[data-clear-all]')) { e.preventDefault(); go(C.clearFilters(state)); }
  });
  $('bfPsAll').addEventListener('click', function () { showAllPs = true; render(); });

  // Old links to the Coming soon slider (/browse#comingSoon) open its tab.
  if (location.hash === '#comingSoon') {
    if (C.tabVisible(data, 'coming-soon')) state = C.withTab(state, 'coming-soon');
    history.replaceState(null, '', C.href(state));
  }
  // A shared link to #bfPanel (or the no-script fallback) opens it properly.
  if (location.hash === '#bfPanel') {
    // location.hash = '' (unlike replaceState alone) un-matches CSS :target, so the panel can close.
    location.hash = '';
    history.replaceState(null, '', location.pathname + location.search);
    openPanel();
  }
  render();
})();
