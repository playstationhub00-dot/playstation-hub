// Returns & deposits: chip, search, and pages of 50. The rows are already
// built on the server (lib/returns.js). This only shows and hides them.
// Loaded on the admin page. The wiring is skipped when there is no document,
// so scripts/test-returns.js can require the rules from window.__rdFilter.
(function () {
  'use strict';

  var CHIPS = ['all', 'renting', 'owed', 'refunded'];
  var PAGE_SIZE = 50;

  function normalize(raw) {
    var r = raw || {};
    return {
      chip: CHIPS.indexOf(r.chip) !== -1 ? r.chip : 'all',
      q: typeof r.q === 'string' ? r.q.slice(0, 100) : ''
    };
  }

  function rowMatches(row, state) {
    var chip = state && state.chip;
    if (chip === 'renting' && row.renting !== '1') return false;
    if (chip === 'owed' && row.owed !== '1') return false;
    if (chip === 'refunded' && row.refunded !== '1') return false;
    var q = String(state && state.q || '').trim().toLowerCase();
    return !q || String(row.s || '').indexOf(q) !== -1;
  }

  function paginate(count, page, size) {
    var n = Math.max(0, Number(count) || 0);
    var per = Math.max(1, Number(size) || PAGE_SIZE);
    var pages = Math.max(1, Math.ceil(n / per) || 1);
    var p = Math.floor(Number(page) || 1);
    if (p < 1) p = 1;
    if (p > pages) p = pages;
    var start = n === 0 ? 0 : (p - 1) * per;
    var end = Math.min(n, start + per);
    return { page: p, pages: pages, per: per, start: start, end: end };
  }

  var root = typeof window !== 'undefined' ? window : global;
  root.__rdFilter = {
    CHIPS: CHIPS,
    PAGE_SIZE: PAGE_SIZE,
    normalize: normalize,
    rowMatches: rowMatches,
    paginate: paginate
  };

  if (typeof document === 'undefined' || !document.getElementById) return;
  var panel = document.getElementById('tab-returns');
  if (!panel) return;

  var state = normalize(null);
  var page = 1;

  function rows() {
    return Array.prototype.slice.call(panel.querySelectorAll('tr.rd-row'));
  }

  function apply() {
    var matched = [];
    rows().forEach(function (tr) {
      var ok = rowMatches({
        renting: tr.getAttribute('data-renting') || '',
        owed: tr.getAttribute('data-owed') || '',
        refunded: tr.getAttribute('data-refunded') || '',
        s: tr.getAttribute('data-s') || ''
      }, state);
      if (ok) matched.push(tr);
      else tr.hidden = true;
    });
    var windowed = paginate(matched.length, page, PAGE_SIZE);
    page = windowed.page;
    matched.forEach(function (tr, i) {
      tr.hidden = i < windowed.start || i >= windowed.end;
    });
    panel.querySelectorAll('.rd-chip').forEach(function (btn) {
      var on = btn.getAttribute('data-chip') === state.chip;
      btn.classList.toggle('rd-chip-on', on);
      if (on) btn.setAttribute('aria-pressed', 'true');
      else btn.setAttribute('aria-pressed', 'false');
    });
    var empty = document.getElementById('rdEmpty');
    var tableWrap = document.getElementById('rdTableWrap');
    if (empty) empty.hidden = matched.length !== 0;
    if (tableWrap) tableWrap.hidden = matched.length === 0;
    var pager = document.getElementById('rdPager');
    var range = document.getElementById('rdPagerRange');
    var prev = document.getElementById('rdPagerPrev');
    var next = document.getElementById('rdPagerNext');
    if (pager) pager.hidden = matched.length === 0;
    if (range) {
      if (!matched.length) range.textContent = '';
      else range.textContent = (windowed.start + 1) + '–' + windowed.end + ' of ' + matched.length;
    }
    if (prev) prev.disabled = windowed.page <= 1;
    if (next) next.disabled = windowed.page >= windowed.pages;
  }

  panel.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('.rd-chip');
    if (chip && panel.contains(chip)) {
      state.chip = normalize({ chip: chip.getAttribute('data-chip'), q: state.q }).chip;
      page = 1;
      apply();
      return;
    }
    if (e.target.id === 'rdPagerPrev') { page -= 1; apply(); }
    if (e.target.id === 'rdPagerNext') { page += 1; apply(); }
  });

  var search = document.getElementById('rdSearch');
  if (search) {
    search.addEventListener('input', function () {
      state.q = search.value || '';
      page = 1;
      apply();
    });
  }

  apply();
})();
