// Admin → Accounts tab: filters, the Slots/Accounts view toggle, and the
// account and slot modals. Loaded on every admin page; the DOM wiring only
// runs when the tab's markup is present, and never in the test sandbox.
(function () {
  'use strict';

  var STATUS_VALUES = ['all', 'open', 'rented', 'ending', 'overdue', 'buyed', 'maintenance', 'na'];
  var TYPE_VALUES = ['all', 'trophy', 'non_trophy', 'ps4_primary'];
  var VIEWS = ['slots', 'accounts'];
  var FILTER_KEY = 'accFilters';
  var VIEW_KEY = 'accView';

  function isAll(v) { return !v || v === 'all'; }

  // Anything read back from storage is untrusted: unknown values fall back to
  // defaults rather than filtering the list down to nothing.
  function normalizeState(raw, fallbackView) {
    var r = raw || {};
    var view = VIEWS.indexOf(r.view) !== -1 ? r.view
      : (VIEWS.indexOf(fallbackView) !== -1 ? fallbackView : 'slots');
    return {
      view: view,
      q: typeof r.q === 'string' ? r.q.slice(0, 100) : '',
      status: STATUS_VALUES.indexOf(r.status) !== -1 ? r.status : 'all',
      type: TYPE_VALUES.indexOf(r.type) !== -1 ? r.type : 'all',
      game: /^\d+$/.test(String(r.game == null ? '' : r.game)) ? String(r.game) : ''
    };
  }

  // "Rented" means every rented slot; "Ending" and "Overdue" are the narrower
  // subsets the template marks with data-due.
  function statusMatches(status, due, want) {
    if (isAll(want)) return true;
    if (want === 'ending' || want === 'overdue') return status === 'rented' && due === want;
    return status === want;
  }

  function chipMatches(chip, f) {
    return statusMatches(chip.status, chip.due, f.status) && (isAll(f.type) || chip.type === f.type);
  }

  function textAndGameMatch(item, f) {
    if (f.game && item.gameIds.indexOf(String(f.game)) === -1) return false;
    var q = String(f.q || '').trim().toLowerCase();
    return !q || item.search.indexOf(q) !== -1;
  }

  function slotMatches(item, f) {
    return chipMatches(item, f) && textAndGameMatch(item, f);
  }

  // An account shows when it matches search and game, and at least one of its
  // enabled slots matches status and type together.
  function accountMatches(account, chips, f) {
    if (!textAndGameMatch(account, f)) return false;
    if (isAll(f.status) && isAll(f.type)) return true;
    return chips.some(function (c) { return !c.disabled && chipMatches(c, f); });
  }

  function activeFilterCount(f) {
    return (isAll(f.status) ? 0 : 1) + (isAll(f.type) ? 0 : 1) + (f.game ? 1 : 0);
  }

  function isFiltering(f) {
    return activeFilterCount(f) > 0 || String(f.q || '').trim() !== '';
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  window.__accFilter = {
    normalizeState: normalizeState,
    statusMatches: statusMatches,
    chipMatches: chipMatches,
    slotMatches: slotMatches,
    accountMatches: accountMatches,
    activeFilterCount: activeFilterCount,
    isFiltering: isFiltering,
    plural: plural
  };

  // ── DOM wiring ───────────────────────────────────────────────────────────
  // Everything below touches the page. It runs only when the Accounts tab's
  // markup exists; the test sandbox has no document, so it is skipped there.

  var TYPE_LABEL = { trophy: '🏆 Trophy', non_trophy: '🎮 Non-Trophy', ps4_primary: '🕹️ PS4 Primary' };

  function byId(id) { return document.getElementById(id); }

  function readStore(store, key) {
    try { return store.getItem(key); } catch (e) { return null; }
  }

  function writeStore(store, key, value) {
    try { store.setItem(key, value); } catch (e) { /* storage blocked: filters just won't persist */ }
  }

  function itemFrom(el) {
    return {
      status: el.getAttribute('data-status') || '',
      due: el.getAttribute('data-due') || '',
      type: el.getAttribute('data-type') || '',
      disabled: el.getAttribute('data-disabled') === '1',
      gameIds: (el.getAttribute('data-game-ids') || '').split(',').filter(Boolean),
      search: el.getAttribute('data-search') || ''
    };
  }

  function toArray(list) { return Array.prototype.slice.call(list); }

  // Returns a click handler for the filter controls, or null when there is no
  // list on the page (no accounts yet).
  function initFilters(root) {
    var slotsView = byId('accSlotsView');
    var accountsView = byId('accAccountsView');
    if (!slotsView || !accountsView) return null;

    var search = byId('accSearch');
    var statusSel = byId('accStatus');
    var typeSel = byId('accType');
    var gameSel = byId('accGame');

    var stored = null;
    try { stored = JSON.parse(readStore(window.sessionStorage, FILTER_KEY) || 'null'); } catch (e) { stored = null; }
    var state = normalizeState(stored, readStore(window.localStorage, VIEW_KEY));

    function syncControls() {
      search.value = state.q;
      statusSel.value = state.status;
      typeSel.value = state.type;
      gameSel.value = state.game;
      // A remembered game that no longer exists leaves the select on nothing;
      // adopt that rather than silently filtering everything out.
      state.game = gameSel.value || '';
    }

    function applySlots() {
      var visible = 0;
      toArray(slotsView.querySelectorAll('.acc-srow')).forEach(function (row) {
        var show = slotMatches(itemFrom(row), state);
        row.hidden = !show;
        if (show) visible++;
      });
      return visible;
    }

    function applyAccounts() {
      var visible = 0;
      var dimming = !isAll(state.status) || !isAll(state.type);
      toArray(accountsView.querySelectorAll('.acc-group')).forEach(function (group) {
        var inGroup = 0;
        toArray(group.querySelectorAll('.acc-arow')).forEach(function (row) {
          var chipEls = toArray(row.querySelectorAll('.acc-chip'));
          var chips = chipEls.map(itemFrom);
          var show = accountMatches(itemFrom(row), chips, state);
          row.hidden = !show;
          chipEls.forEach(function (el, i) {
            el.classList.toggle('acc-chip-dim', show && dimming && !chips[i].disabled && !chipMatches(chips[i], state));
          });
          if (show) inGroup++;
        });
        group.hidden = inGroup === 0;
        var count = group.querySelector('.acc-group-count');
        if (count) count.textContent = '(' + inGroup + ')';
        visible += inGroup;
      });
      return visible;
    }

    function apply() {
      var onSlots = state.view === 'slots';
      slotsView.hidden = !onSlots;
      accountsView.hidden = onSlots;
      toArray(root.querySelectorAll('[data-acc-view]')).forEach(function (btn) {
        var on = btn.getAttribute('data-acc-view') === state.view;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      var visible = onSlots ? applySlots() : applyAccounts();
      var filtering = isFiltering(state);
      var noun = onSlots ? 'slot' : 'account';

      byId('accCount').textContent = plural(visible, noun);
      byId('accEmpty').hidden = visible !== 0;
      byId('accEmptyMsg').textContent = filtering ? 'No ' + noun + 's match these filters.' : 'Nothing to show here yet.';
      byId('accEmptyClear').hidden = !filtering;
      byId('accClear').hidden = !filtering;
      toArray(root.querySelectorAll('[data-acc-stat]')).forEach(function (card) {
        card.classList.toggle('on', card.getAttribute('data-acc-stat') === state.status);
      });
      var n = activeFilterCount(state);
      byId('accFilterBtnCount').textContent = n ? ' (' + n + ')' : '';

      writeStore(window.sessionStorage, FILTER_KEY, JSON.stringify(state));
      writeStore(window.localStorage, VIEW_KEY, state.view);
    }

    function clearFilters() {
      state.q = '';
      state.status = 'all';
      state.type = 'all';
      state.game = '';
      syncControls();
      apply();
    }

    search.addEventListener('input', function () { state.q = search.value; apply(); });
    statusSel.addEventListener('change', function () { state.status = statusSel.value; apply(); });
    typeSel.addEventListener('change', function () { state.type = typeSel.value; apply(); });
    gameSel.addEventListener('change', function () { state.game = gameSel.value || ''; apply(); });

    syncControls();
    apply();

    return function handleClick(target, e) {
      var viewBtn = target.closest('[data-acc-view]');
      if (viewBtn) { state.view = viewBtn.getAttribute('data-acc-view'); apply(); return true; }
      var stat = target.closest('[data-acc-stat]');
      if (stat) {
        state.status = stat.getAttribute('data-acc-stat');
        state.view = 'slots';
        syncControls();
        apply();
        return true;
      }
      if (target.closest('[data-acc-clear]')) { e.preventDefault(); clearFilters(); return true; }
      if (target.closest('#accFilterBtn')) { byId('accFilterPanel').classList.toggle('open'); return true; }
      return false;
    };
  }

  // Returns { openAccount, openSlot }, or null when the embedded data is
  // missing or unreadable — the list still renders and filters, but the edit
  // controls are hidden rather than opening an empty form.
  function initModals(root) {
    var data = null;
    var blob = byId('accData');
    try { data = JSON.parse(blob ? blob.textContent : 'null'); } catch (e) { data = null; }
    var accModal = byId('accModal');
    var slotModal = byId('accSlotModal');
    if (!data || !data.accounts || !accModal || !slotModal) {
      root.classList.add('acc-readonly');
      return null;
    }

    var accForm = byId('accForm');
    var gameSearch = byId('accGameSearch');
    var gameChips = byId('accGameChips');
    var gameBoxes = toArray(accForm.querySelectorAll('input[name="game_ids"]'));
    var slotForm = byId('accSlotForm');

    function open(overlay) { overlay.classList.add('open'); }
    function close(overlay) { overlay.classList.remove('open'); }

    function renderGameChips() {
      gameChips.innerHTML = '';
      gameBoxes.filter(function (b) { return b.checked; }).forEach(function (b) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'acc-gchip';
        chip.setAttribute('data-uncheck', b.value);
        chip.textContent = b.getAttribute('data-title') + ' ✕';
        gameChips.appendChild(chip);
      });
      gameChips.hidden = gameChips.children.length === 0;
    }

    function filterGameList() {
      var q = gameSearch.value.trim().toLowerCase();
      gameBoxes.forEach(function (b) {
        var item = b.closest('.acc-gpick-item');
        item.hidden = q !== '' && b.getAttribute('data-title').toLowerCase().indexOf(q) === -1;
      });
    }

    function setField(name, value) {
      var el = accForm.elements[name];
      if (el) el.value = value == null ? '' : value;
    }

    function setCheck(name, on) {
      var el = accForm.elements[name];
      if (el) el.checked = !!on;
    }

    function openAccount(id) {
      var a = id ? data.accounts[id] : null;
      if (id && !a) return;
      accForm.action = a ? '/admin/accounts/edit/' + id : '/admin/accounts/add';
      byId('accModalTitle').textContent = a ? 'Edit Account' : 'Add Account';
      byId('accModalSubmit').textContent = a ? 'Save changes' : 'Create account';
      setField('label', a ? a.label : '');
      setField('email', a ? a.email : '');
      setField('games_text', a ? a.games_text : '');
      setField('note', a ? a.note : '');
      setField('price_permanent_tr', a ? a.price_permanent_tr : 5000);
      setField('price_permanent_nt', a ? a.price_permanent_nt : 4500);
      setField('public_name', a ? a.public_name : '');
      setCheck('enable_trophy', a ? a.slots.trophy.enabled : true);
      setCheck('enable_non_trophy', a ? a.slots.non_trophy.enabled : true);
      setCheck('enable_ps4_primary', a ? a.slots.ps4_primary.enabled : true);
      setCheck('for_sale', a ? a.for_sale : false);
      var linked = a ? a.game_ids.map(String) : [];
      gameBoxes.forEach(function (b) { b.checked = linked.indexOf(b.value) !== -1; });
      gameSearch.value = '';
      filterGameList();
      renderGameChips();
      open(accModal);
      setTimeout(function () { accForm.elements.label.focus(); }, 50);
    }

    function syncSlotFields() {
      var st = slotForm.elements.status.value;
      byId('accSlotRenterWrap').hidden = !(st === 'rented' || st === 'buyed');
      byId('accSlotDatesWrap').hidden = st !== 'rented';
    }

    function openSlot(id, type) {
      var a = data.accounts[id];
      var s = a && a.slots[type];
      if (!s || !s.enabled) return;
      slotForm.action = '/admin/accounts/' + id + '/slot/' + type;
      byId('accSlotTitle').textContent = TYPE_LABEL[type] + ' — ' + a.label;
      slotForm.elements.status.value = s.status;
      slotForm.elements.renter_id.value = s.renter_id ? String(s.renter_id) : '';
      slotForm.elements.days.value = '';
      slotForm.elements.end_date.value = s.end || '';
      syncSlotFields();
      open(slotModal);
    }

    slotForm.elements.status.addEventListener('change', syncSlotFields);
    gameSearch.addEventListener('input', filterGameList);
    accForm.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'game_ids') renderGameChips();
    });
    gameChips.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-uncheck]');
      if (!chip) return;
      var value = chip.getAttribute('data-uncheck');
      gameBoxes.forEach(function (b) { if (b.value === value) b.checked = false; });
      renderGameChips();
    });
    [accModal, slotModal].forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.closest('[data-acc-close]')) close(overlay);
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      close(accModal);
      close(slotModal);
    });

    return { openAccount: openAccount, openSlot: openSlot };
  }

  function init() {
    var root = byId('tab-accounts');
    if (!root || root.getAttribute('data-acc-init')) return;
    root.setAttribute('data-acc-init', '1');

    var modals = initModals(root);
    var handleFilterClick = initFilters(root);

    root.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (handleFilterClick && handleFilterClick(t, e)) return;
      if (!modals) return;
      if (t.closest('[data-acc-add]')) { modals.openAccount(null); return; }
      var edit = t.closest('[data-acc-edit]');
      if (edit) { modals.openAccount(edit.getAttribute('data-acc-edit')); return; }
      var slotBtn = t.closest('[data-acc-slot]');
      if (slotBtn) {
        var parts = slotBtn.getAttribute('data-acc-slot').split(':');
        modals.openSlot(parts[0], parts[1]);
      }
    });
  }

  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
