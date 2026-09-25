// Admin → Orders tab: ledger filters (status chip, type, search) that persist
// for the session, Needs You group open/closed memory, the QR countdowns and
// "x ago" ages, and the Payment link button. Loaded on the admin page; the
// page wiring is skipped when there is no document (the test sandbox).
(function () {
  'use strict';

  var CHIPS = ['all', 'out', 'paid', 'unpaid', 'cancelled'];
  var TYPES = ['all', 'rental', 'purchase', 'reservation'];
  var GROUP_KEYS = ['now', 'refunds', 'followups', 'waitlist'];
  var LEDGER_KEY = 'oqLedger';
  var GROUPS_KEY = 'oqGroups';

  // Anything read back from storage is untrusted: unknown values fall back to
  // defaults rather than filtering the ledger down to nothing.
  function normalizeLedgerState(raw) {
    var r = raw || {};
    return {
      chip: CHIPS.indexOf(r.chip) !== -1 ? r.chip : 'all',
      type: TYPES.indexOf(r.type) !== -1 ? r.type : 'all',
      q: typeof r.q === 'string' ? r.q.slice(0, 100) : ''
    };
  }

  // A Coming Soon pre-order carries both is_buy and is_reservation; it is a
  // reservation first. views/partials/admin/orders/ledger.ejs applies the same
  // rule when it writes each row's data-t.
  function orderType(order) {
    var o = order || {};
    if (o.is_reservation) return 'reservation';
    if (o.is_buy) return 'purchase';
    return 'rental';
  }

  function rowMatches(row, state) {
    if (state.chip !== 'all' && row.g !== state.chip) return false;
    if (state.type !== 'all' && row.t !== state.type) return false;
    var q = String(state.q || '').trim().toLowerCase();
    return !q || row.s.indexOf(q) !== -1;
  }

  function isFiltering(state) {
    return state.chip !== 'all' || state.type !== 'all' || String(state.q || '').trim() !== '';
  }

  function normalizeGroups(raw) {
    var out = {};
    if (raw && typeof raw === 'object') {
      GROUP_KEYS.forEach(function (k) {
        if (typeof raw[k] === 'boolean') out[k] = raw[k];
      });
    }
    return out;
  }

  window.__oqFilter = {
    normalizeLedgerState: normalizeLedgerState,
    orderType: orderType,
    rowMatches: rowMatches,
    isFiltering: isFiltering,
    normalizeGroups: normalizeGroups
  };

  // ── Page wiring ──────────────────────────────────────────────────────────
  if (typeof document === 'undefined' || !document.getElementById) return;

  function toArray(list) { return Array.prototype.slice.call(list); }

  function readJson(kind, key) {
    try {
      var store = kind === 'session' ? window.sessionStorage : window.localStorage;
      return JSON.parse(store.getItem(key) || 'null');
    } catch (e) { return null; }
  }

  function writeJson(kind, key, value) {
    try {
      var store = kind === 'session' ? window.sessionStorage : window.localStorage;
      store.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage blocked: state just won't persist */ }
  }

  // Closes every other open ⋯ menu when one opens, and closes any open one
  // when the click lands outside all of them.
  document.addEventListener('click', function (e) {
    var clickedMore = e.target.closest && e.target.closest('.oq-more');
    toArray(document.querySelectorAll('.oq-more[open]')).forEach(function (d) {
      if (d !== clickedMore) d.open = false;
    });
  });

  // Page-wide on purpose: the dashboard overview renders an .oq-timer too and
  // has no loop of its own.
  function tick() {
    toArray(document.querySelectorAll('.oq-timer')).forEach(function (el) {
      var left = new Date(el.getAttribute('data-expires')).getTime() - Date.now();
      if (left <= 0) { el.textContent = 'expired'; el.classList.add('oq-timer-dead'); return; }
      var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      el.textContent = m + ':' + String(s).padStart(2, '0') + ' left';
    });
  }

  function formatAges() {
    toArray(document.querySelectorAll('.oq-ab-age')).forEach(function (el) {
      var ms = Date.now() - new Date(el.getAttribute('data-created')).getTime();
      var mins = Math.floor(ms / 60000);
      if (mins < 60) { el.textContent = mins + 'm ago'; return; }
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) { el.textContent = hrs + 'h ago'; return; }
      el.textContent = Math.floor(hrs / 24) + 'd ago';
    });
  }

  // Re-applies the owner's own open/closed choice per Needs You group; a
  // group they never touched keeps the default the template rendered.
  function initGroups() {
    var saved = normalizeGroups(readJson('local', GROUPS_KEY));
    toArray(document.querySelectorAll('details[data-oq-group]')).forEach(function (d) {
      var key = d.getAttribute('data-oq-group');
      if (Object.prototype.hasOwnProperty.call(saved, key)) d.open = saved[key];
      d.addEventListener('toggle', function () {
        var cur = normalizeGroups(readJson('local', GROUPS_KEY));
        cur[key] = d.open;
        writeJson('local', GROUPS_KEY, cur);
      });
    });
  }

  function initLedger() {
    var table = document.getElementById('oqLedger');
    var search = document.getElementById('oqSearch');
    var typeSel = document.getElementById('oqType');
    var panel = document.getElementById('tab-orders');
    if (!table || !search || !typeSel || !panel) return;

    var state = normalizeLedgerState(readJson('session', LEDGER_KEY));

    function apply() {
      var shown = 0;
      toArray(table.querySelectorAll('tr.oq-lr')).forEach(function (r) {
        var match = rowMatches({
          g: r.getAttribute('data-g') || '',
          t: r.getAttribute('data-t') || '',
          s: r.getAttribute('data-s') || ''
        }, state);
        r.hidden = !match;
        if (match) shown++;
      });
      // A month header with every row filtered out is noise, so hide it too.
      toArray(table.querySelectorAll('tr.oq-grp')).forEach(function (h) {
        var n = h.nextElementSibling, any = false;
        while (n && !n.classList.contains('oq-grp')) {
          if (n.classList.contains('oq-lr') && !n.hidden) { any = true; break; }
          n = n.nextElementSibling;
        }
        h.hidden = !any;
      });
      toArray(panel.querySelectorAll('.oq-chip')).forEach(function (c) {
        c.classList.toggle('oq-chip-on', c.getAttribute('data-g') === state.chip);
      });
      var wrap = document.getElementById('oqLedgerWrap');
      var none = document.getElementById('oqNoMatch');
      if (wrap) wrap.hidden = shown === 0;
      if (none) none.hidden = shown !== 0;
      writeJson('session', LEDGER_KEY, state);
    }

    search.value = state.q;
    typeSel.value = state.type;
    search.addEventListener('input', function () { state.q = search.value; apply(); });
    typeSel.addEventListener('change', function () { state.type = typeSel.value; apply(); });
    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var chip = t.closest('.oq-chip');
      if (chip) { state.chip = chip.getAttribute('data-g'); apply(); return; }
      if (t.closest('[data-oq-clear]')) {
        e.preventDefault();
        state = normalizeLedgerState(null);
        search.value = '';
        typeSel.value = 'all';
        apply();
      }
    });
    apply();
  }

  // "💳 Payment link" — asks the server for a fresh PayMongo checkout session
  // for this order, then copies the URL, falling back to a visible textarea
  // where the clipboard API is refused (plain http).
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.oq-paylink');
    if (!btn) return;
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '… creating link';
    fetch('/admin/orders/' + encodeURIComponent(btn.getAttribute('data-ref')) + '/payment-link', { method: 'POST' })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok || !res.body.ok) {
          btn.textContent = res.body && res.body.reason === 'stale' ? '⚠ already paid/stale' : '⚠ failed — retry';
          setTimeout(function () { btn.textContent = original; }, 2500);
          return;
        }
        var url = res.body.url;
        function flashDone() {
          btn.textContent = '✅ Copied — paste in Messenger';
          setTimeout(function () { btn.textContent = original; }, 2500);
        }
        function fallback() {
          var ta = document.createElement('textarea');
          ta.value = url;
          ta.style.cssText = 'position:fixed;left:1rem;right:1rem;bottom:1rem;height:4rem;z-index:9999;font-size:0.8rem;';
          document.body.appendChild(ta);
          ta.select();
          var copied = false;
          try { copied = document.execCommand('copy'); } catch (err) { copied = false; }
          if (copied) { ta.remove(); flashDone(); }
          else { btn.textContent = '⬇ copy from the box'; setTimeout(function () { ta.remove(); btn.textContent = original; }, 15000); }
        }
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(url).then(flashDone).catch(fallback);
        } else {
          fallback();
        }
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = '⚠ failed — retry';
        setTimeout(function () { btn.textContent = original; }, 2500);
      });
  });

  function init() {
    tick();
    setInterval(tick, 1000);
    formatAges();
    initGroups();
    initLedger();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
