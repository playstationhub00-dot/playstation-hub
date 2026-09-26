// Admin → Games tab: the sub-tabs (All games · Coming soon · Requests · Price
// categories) and the All games filters — status chip, platform, sort and
// search — all remembered across the reload that follows every action.
// Loaded on the admin page; the page wiring is skipped when there is no
// document (the test sandbox).
(function () {
  'use strict';

  var CHIPS = ['all', 'new', 'soldout', 'never', 'bundle'];
  var PLATFORMS = ['all', 'PS5', 'PS4', 'PS4/PS5'];
  var SORTS = ['newest', 'az', 'earned', 'slots'];
  var SUBTABS = ['all', 'soon', 'requests', 'categories'];
  var FILTER_KEY = 'gamesFilters';
  var SUBTAB_KEY = 'gamesSubtab';

  // A save lands back here with a ?msg=; the sub-tab that action belongs to
  // opens, whatever was open last.
  var MSG_SUBTAB = {
    added: 'all', updated: 'all', deleted: 'all',
    upcoming_added: 'soon', upcoming_updated: 'soon', upcoming_deleted: 'soon',
    release_failed: 'soon', release_in_progress: 'soon',
    cat_added: 'categories', cat_updated: 'categories', cat_deleted: 'categories'
  };

  // Anything read back from storage is untrusted: unknown values fall back to
  // defaults rather than filtering the list down to nothing.
  function normalizeState(raw) {
    var r = raw && typeof raw === 'object' ? raw : {};
    return {
      chip: CHIPS.indexOf(r.chip) !== -1 ? r.chip : 'all',
      platform: PLATFORMS.indexOf(r.platform) !== -1 ? r.platform : 'all',
      sort: SORTS.indexOf(r.sort) !== -1 ? r.sort : 'newest',
      q: typeof r.q === 'string' ? r.q.slice(0, 100) : ''
    };
  }

  // row: { chips: ['new', 'never', …], platform: 'PS5', s: 'lowercased search text' }
  function rowMatches(row, state) {
    if (state.chip !== 'all' && (row.chips || []).indexOf(state.chip) === -1) return false;
    if (state.platform !== 'all' && row.platform !== state.platform) return false;
    var q = String(state.q || '').trim().toLowerCase();
    return !q || String(row.s || '').indexOf(q) !== -1;
  }

  // Sort never hides a row, so it doesn't count as filtering and Clear
  // leaves it alone.
  function isFiltering(state) {
    return state.chip !== 'all' || state.platform !== 'all' || String(state.q || '').trim() !== '';
  }

  // a, b: { id, title, earned, slots }
  function compareRows(a, b, sort) {
    if (sort === 'az') return String(a.title).localeCompare(String(b.title)) || (b.id - a.id);
    if (sort === 'earned') return (b.earned - a.earned) || (b.id - a.id);
    if (sort === 'slots') return (a.slots - b.slots) || String(a.title).localeCompare(String(b.title));
    return b.id - a.id;
  }

  function normalizeSubtab(raw) {
    return SUBTABS.indexOf(raw) !== -1 ? raw : 'all';
  }

  function subtabForMessage(msg) {
    if (typeof msg !== 'string' || !msg) return null;
    if (Object.prototype.hasOwnProperty.call(MSG_SUBTAB, msg)) return MSG_SUBTAB[msg];
    // Every Requests action: approve, reject, stock, delete, cover image, and
    // the voter edits.
    if (/^(request|voter)_/.test(msg)) return 'requests';
    return null;
  }

  window.__gamesFilter = {
    normalizeState: normalizeState,
    rowMatches: rowMatches,
    isFiltering: isFiltering,
    compareRows: compareRows,
    normalizeSubtab: normalizeSubtab,
    subtabForMessage: subtabForMessage
  };

  // ── Page wiring ──────────────────────────────────────────────────────────
  if (typeof document === 'undefined' || !document.getElementById) return;

  function toArray(list) { return Array.prototype.slice.call(list); }

  function readJson(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  function writeJson(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: state just won't persist */ }
  }

  // Closes every other open ⋯ menu when one opens, and closes any open one
  // when the click lands outside all of them.
  document.addEventListener('click', function (e) {
    var clickedMore = e.target.closest && e.target.closest('.gm-more');
    toArray(document.querySelectorAll('.gm-more[open]')).forEach(function (d) {
      if (d !== clickedMore) d.open = false;
    });
  });

  var activateSubtab = function () {};

  function initSubtabs() {
    var shell = document.getElementById('gmShell');
    if (!shell) return;
    var buttons = toArray(shell.querySelectorAll('[data-gm-subtab]'));
    var panels = toArray(shell.querySelectorAll('[data-gm-panel]'));
    activateSubtab = function (key) {
      key = normalizeSubtab(key);
      buttons.forEach(function (b) {
        var on = b.getAttribute('data-gm-subtab') === key;
        b.classList.toggle('gm-subtab-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach(function (p) { p.hidden = p.getAttribute('data-gm-panel') !== key; });
      writeJson(SUBTAB_KEY, key);
    };
    buttons.forEach(function (b) {
      b.addEventListener('click', function () { activateSubtab(b.getAttribute('data-gm-subtab')); });
    });
    // views/admin.ejs strips ?msg= from the URL before this runs, so the
    // template hands it over on data-msg.
    activateSubtab(subtabForMessage(shell.getAttribute('data-msg')) || readJson(SUBTAB_KEY));
  }

  // "+ Add New → Price Category": open the categories sub-tab and its form.
  window.gmOpenNewCategory = function () {
    activateSubtab('categories');
    var form = document.getElementById('gmNewCat');
    if (!form) return;
    form.open = true;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  function initList() {
    var list = document.getElementById('gmList');
    var panel = document.querySelector('[data-gm-panel="all"]');
    var search = document.getElementById('gmSearch');
    var platformSel = document.getElementById('gmPlatform');
    var sortSel = document.getElementById('gmSort');
    if (!list || !panel || !search || !platformSel || !sortSel) return;

    var rows = toArray(list.querySelectorAll('[data-gm-game]')).map(function (el) {
      return {
        el: el,
        chips: (el.getAttribute('data-chips') || '').split(' ').filter(Boolean),
        platform: el.getAttribute('data-platform') || '',
        s: el.getAttribute('data-s') || '',
        id: Number(el.getAttribute('data-id')) || 0,
        title: el.getAttribute('data-title') || '',
        earned: Number(el.getAttribute('data-earned')) || 0,
        slots: Number(el.getAttribute('data-slots')) || 0
      };
    });
    var state = normalizeState(readJson(FILTER_KEY));

    function apply() {
      var shown = 0;
      rows.slice().sort(function (a, b) { return compareRows(a, b, state.sort); }).forEach(function (r) {
        var match = rowMatches(r, state);
        r.el.hidden = !match;
        if (match) shown++;
        list.appendChild(r.el);
      });
      toArray(panel.querySelectorAll('[data-gm-chip]')).forEach(function (c) {
        c.classList.toggle('gm-chip-on', c.getAttribute('data-gm-chip') === state.chip);
      });
      var showing = document.getElementById('gmShowing');
      var shownEl = document.getElementById('gmShown');
      var head = document.getElementById('gmHead');
      var none = document.getElementById('gmNoMatch');
      if (showing) showing.hidden = !isFiltering(state);
      if (shownEl) shownEl.textContent = String(shown);
      if (head) head.hidden = shown === 0;
      if (none) none.hidden = shown !== 0;
      list.hidden = shown === 0;
      writeJson(FILTER_KEY, state);
    }

    search.value = state.q;
    platformSel.value = state.platform;
    sortSel.value = state.sort;
    search.addEventListener('input', function () { state.q = search.value.slice(0, 100); apply(); });
    platformSel.addEventListener('change', function () { state.platform = platformSel.value; apply(); });
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; apply(); });
    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var chip = t.closest('[data-gm-chip]');
      if (chip) { state.chip = chip.getAttribute('data-gm-chip'); apply(); return; }
      if (t.closest('[data-gm-clear]')) {
        e.preventDefault();
        state = normalizeState({ sort: state.sort });
        search.value = '';
        platformSel.value = 'all';
        apply();
      }
    });
    apply();
  }

  function init() {
    initSubtabs();
    initList();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
