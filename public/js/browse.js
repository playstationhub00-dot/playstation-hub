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

  var gameCards = {}, soonCards = {}, comingCards = {};
  each(document, '#bfGrid .bf-item[data-id]', function (el) { gameCards[el.getAttribute('data-id')] = el; });
  each(document, '#bfSoonGrid .bf-item[data-soon]', function (el) { soonCards[el.getAttribute('data-soon')] = el; });
  each(document, '#bfComing .bf-item[data-coming]', function (el) { comingCards[el.getAttribute('data-coming')] = el; });

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
  function renderSoon(v) {
    var sec = $('bfSoonSec');
    if (!sec || !C.soonMatches) return;
    var hits = v.kind === 'games' ? C.soonMatches(data, state) : [];
    sec.hidden = !hits.length;
    var count = $('bfSoonCount');
    if (count) count.textContent = hits.length ? String(hits.length) : '';
    if ($('bfComing')) place(comingCards, $('bfComing'), hits.map(function (x) { return x.id; }));
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
    $('bfCount').textContent = v.count + ' game' + (v.count === 1 ? '' : 's');
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
    $('bfOpenN').textContent = v.selected ? ' (' + v.selected + ')' : '';
    $('bfOpen').classList.toggle('bf-has', v.selected > 0);
  }
  function render() {
    var v = C.view(data, state, ctx);
    renderTabs(v);
    renderBar(v);
    place(gameCards, $('bfGrid'), v.kind === 'games' ? v.ids : []);
    place(soonCards, $('bfSoonGrid'), v.kind === 'soon' ? v.ids : []);
    var ask = $('bfAsk');
    if (ask) { ask.hidden = v.kind !== 'games'; if (v.kind === 'games') $('bfGrid').appendChild(ask); }
    $('bfGrid').hidden = v.kind !== 'games';
    $('bfSoonGrid').hidden = v.kind !== 'soon';
    each($('bfGrid'), '.bf-rank', function (el) { el.hidden = !v.ranked; });
    $('bfNotes').innerHTML = v.notes.map(function (n) {
      return '<p class="cat-desc"><b>' + esc(n.name) + '</b> — ' + esc(n.desc) + '</p>';
    }).join('');
    $('bfEmpty').hidden = v.count > 0;
    var emptyText = $('bfEmptyText');
    if (emptyText) emptyText.textContent = state.search ? 'No games match "' + state.search + '".' : 'No games match.';
    var clearSearch = $('bfClearSearch');
    if (clearSearch) clearSearch.hidden = !state.search;
    $('bfReset').href = C.href(C.resetState(state));
    renderPsplus(v);
    renderSoon(v);
    var searchX = $('bfSearchX');
    if (searchX) searchX.hidden = !state.search;
    syncRange();
    if (!draft) {
      draft = copy(state);
      renderPanel();
      draft = null;
    }
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
  search.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    search.value = '';
    go(C.withSearch(state, ''));
  });
  if ($('bfSearchX')) $('bfSearchX').addEventListener('click', function () {
    search.value = '';
    go(C.withSearch(state, ''));
    search.focus();
  });
  if ($('bfClearSearch')) $('bfClearSearch').addEventListener('click', function () {
    search.value = '';
    go(C.withSearch(state, ''));
  });
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
      var clearBtn = sec.querySelector('.bf-sec-clear');
      if (clearBtn) clearBtn.hidden = !v.groups.some(function (x) { return x.key === g && x.chips.some(function (c) { return c.on; }); });
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
    if (!row) return;
    // Phone sheet keeps a draft until "Show N games". The desktop sidebar
    // applies the tick immediately because the sheet is already open.
    if (!draft) { go(C.toggle(state, row.getAttribute('data-group'), row.getAttribute('data-value'))); return; }
    draft = C.toggle(draft, row.getAttribute('data-group'), row.getAttribute('data-value'));
    renderPanel();
  });
  form.addEventListener('click', function (e) {
    var clear = e.target.closest('[data-clear]');
    if (!clear) return;
    if (!draft) { go(C.clearGroup(state, clear.getAttribute('data-clear'))); return; }
    draft = C.clearGroup(draft, clear.getAttribute('data-clear'));
    renderPanel();
  });
  $('bfClearAll').addEventListener('click', function () {
    if (!draft) { go(C.clearFilters(state)); return; }
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
    if (chip) {
      e.preventDefault();
      if (chip.getAttribute('data-group') === 'range') go(C.clearGroup(state, 'range'));
      else go(C.toggle(state, chip.getAttribute('data-group'), chip.getAttribute('data-value')));
      return;
    }
    if (e.target.closest('[data-clear-all]')) { e.preventDefault(); go(C.clearFilters(state)); }
  });
  $('bfPsAll').addEventListener('click', function () { showAllPs = true; render(); });

  function syncRange() {
    var week = ctx.week;
    var lo = $('bfWmin');
    var hi = $('bfWmax');
    if (!week || !lo || !hi) return;
    lo.value = state.wmin == null ? week.min : state.wmin;
    hi.value = state.wmax == null ? week.max : state.wmax;
    var label = $('bfRangeText');
    if (label) label.textContent = '₱' + lo.value + '–₱' + hi.value;
  }
  function applyRange() {
    var week = ctx.week || { min: 0, max: 0 };
    var lo = Number($('bfWmin').value);
    var hi = Number($('bfWmax').value);
    if (lo > hi) { var swap = lo; lo = hi; hi = swap; }
    var base = draft ? copy(draft) : copy(state);
    base.wmin = lo <= week.min ? null : lo;
    base.wmax = hi >= week.max ? null : hi;
    if (draft) { draft = base; renderPanel(); syncRange(); return; }
    go(base);
  }
  ['bfWmin', 'bfWmax'].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('input', function () {
      var label = $('bfRangeText');
      if (label) label.textContent = '₱' + $('bfWmin').value + '–₱' + $('bfWmax').value;
    });
    el.addEventListener('change', applyRange);
  });

  var lastFocus = null;
  function qvFocusable() {
    return Array.prototype.filter.call($('qv').querySelectorAll('button, a, input, select, textarea'), function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
  }
  function closeQuick() {
    if ($('qv').hidden) return;
    $('qv').hidden = true;
    document.body.classList.remove('qv-lock');
    document.removeEventListener('keydown', onQvKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onQvKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeQuick(); return; }
    if (e.key !== 'Tab') return;
    var nodes = qvFocusable();
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function peso(n) { return n == null ? '—' : '₱' + n; }
  function releaseWords(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return 'Releases ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function rowIcon(kind) {
    if (kind === 'tr') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H5a3 3 0 0 0 3 3M17 6h2a3 3 0 0 1-3 3"/></svg>';
    if (kind === 'ps4') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="7" width="18" height="11" rx="2.5"/><path d="M8 12h.01M11 12h.01M14.5 10.5h.01M16.8 13h.01"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 12h4M9 10v4M16.5 11h.01M18.5 13.5h.01"/></svg>';
  }
  function showQuick() {
    lastFocus = document.activeElement;
    $('qv').hidden = false;
    document.body.classList.add('qv-lock');
    document.addEventListener('keydown', onQvKey);
    $('qvClose').focus();
  }
  function clearSoonBits() {
    $('qvSoon').hidden = true;
    $('qvWhen').hidden = true;
    $('qvWhen').textContent = '';
    $('qvDesc').hidden = true;
    $('qvDesc').textContent = '';
    $('qvFull').hidden = false;
  }
  function paintCover(card) {
    var img = card && card.querySelector('img');
    $('qvCover').innerHTML = img ? '<img src="' + esc(img.getAttribute('src')) + '" alt="">' : '<div class="qv-cover-empty">No cover</div>';
  }
  function openQuick(id) {
    var fact = (data.games || []).filter(function (g) { return String(g.id) === String(id); })[0];
    var card = gameCards[id];
    if (!fact || !card) return;
    clearSoonBits();
    paintCover(card);
    var band = card.querySelector('.gc-band');
    var bandEl = $('qvBand');
    bandEl.className = 'qv-band' + (band ? ' ' + band.className : '');
    bandEl.textContent = band ? band.textContent.replace(/\s+/g, ' ').trim() : '';
    bandEl.hidden = !band;
    $('qvTitle').textContent = fact.title;
    $('qvMeta').textContent = [fact.platform, fact.genreLabel].filter(Boolean).join(' · ');
    $('qvRows').innerHTML = (fact.rows || []).map(function (r) {
      var kind = r.label === 'Trophy' ? 'tr' : r.label === 'PS4 Primary' ? 'ps4' : 'nt';
      var st = r.status === 'Last slot' ? 'last' : r.status === 'Full' ? 'full' : 'ok';
      return '<div class="qv-row">' +
        '<span class="qv-name qv-' + kind + '">' + rowIcon(kind) + esc(r.label) + '</span>' +
        '<span class="qv-st qv-st-' + st + '"><i></i>' + esc(r.status) + '</span>' +
        '<span class="qv-price">Weekly<b>' + peso(r.week) + '</b></span>' +
        '<span class="qv-price">Monthly<b>' + peso(r.month) + '</b></span>' +
        '</div>';
    }).join('');
    var add = card.querySelector('.basket-add');
    var cta = card.querySelector('.rcta');
    var actions = '';
    if (add) {
      actions += '<button type="button" class="basket-add" data-basket-id="' + esc(add.getAttribute('data-basket-id')) +
        '" data-basket-days="' + esc(add.getAttribute('data-basket-days')) +
        '" data-basket-type="' + esc(add.getAttribute('data-basket-type')) + '">Add to basket</button>';
    }
    if (cta) {
      actions += '<a class="rcta ' + (cta.classList.contains('line') ? 'line' : 'rent') + '" href="' + esc(fact.href) + '">' +
        esc(cta.textContent.replace(/\s+/g, ' ').trim()) + '</a>';
    }
    $('qvActions').innerHTML = actions;
    $('qvFull').href = fact.href;
    showQuick();
  }
  function openSoon(id) {
    var fact = (data.soon || []).filter(function (g) { return String(g.id) === String(id); })[0];
    var card = comingCards[id];
    if (!fact || !card) return;
    paintCover(card);
    var bandEl = $('qvBand');
    if (fact.band && fact.band.key) {
      bandEl.className = 'qv-band gc-band gc-band-' + fact.band.key;
      bandEl.textContent = fact.band.label || '';
      bandEl.hidden = false;
    } else {
      bandEl.className = 'qv-band';
      bandEl.textContent = '';
      bandEl.hidden = true;
    }
    $('qvTitle').textContent = fact.title;
    $('qvMeta').textContent = [fact.platform, fact.genreLabel].filter(Boolean).join(' · ');
    var when = releaseWords(fact.release);
    $('qvSoon').hidden = false;
    $('qvWhen').hidden = !when;
    $('qvWhen').textContent = when;
    $('qvDesc').hidden = !fact.description;
    $('qvDesc').textContent = fact.description || '';
    $('qvRows').innerHTML = (fact.rows || []).map(function (r) {
      var kind = r.label === 'Trophy' ? 'tr' : r.label === 'PS4 Primary' ? 'ps4' : 'nt';
      return '<div class="qv-row">' +
        '<span class="qv-name qv-' + kind + '">' + rowIcon(kind) + esc(r.label) + '</span>' +
        '<span class="qv-st qv-st-expect">Expected</span>' +
        '<span class="qv-price">Weekly<b>' + peso(r.week) + '</b></span>' +
        '<span class="qv-price">Monthly<b>' + peso(r.month) + '</b></span>' +
        '</div>';
    }).join('');
    $('qvActions').innerHTML = '<button type="button" class="rcta rent bf-reserve qv-reserve" data-reserve="' + esc(fact.title) + '">Reserve a slot</button>';
    $('qvFull').hidden = !fact.href;
    $('qvFull').href = fact.href || '#';
    showQuick();
  }
  $('bfGrid').addEventListener('click', function (e) {
    if (e.target.closest('.basket-add, .rcta, .bf-ask, button')) return;
    var item = e.target.closest('.bf-item');
    if (!item) return;
    e.preventDefault();
    openQuick(item.getAttribute('data-id'));
  });
  var coming = $('bfComing');
  if (coming) {
    coming.addEventListener('click', function (e) {
      if (e.target.closest('.bf-reserve, button')) return;
      var item = e.target.closest('.bf-item[data-coming]');
      if (!item) return;
      e.preventDefault();
      openSoon(item.getAttribute('data-coming'));
    });
    coming.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('.bf-reserve, button')) return;
      var card = e.target.closest('.bf-soon-card');
      if (!card) return;
      e.preventDefault();
      openSoon(card.parentNode.getAttribute('data-coming'));
    });
  }
  $('qvClose').addEventListener('click', closeQuick);
  $('qvBackdrop').addEventListener('click', closeQuick);
  document.addEventListener('click', function (e) {
    var reserve = e.target.closest && e.target.closest('.bf-reserve');
    if (!reserve) return;
    e.preventDefault();
    e.stopPropagation();
    if (reserve.closest('#qv')) closeQuick();
    if (typeof openReserveModal === 'function') openReserveModal(reserve.getAttribute('data-reserve') || '');
  });

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
