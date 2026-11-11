// Admin → Orders tab: ledger filters (status chip, type, search) that persist
// for the session, Needs You group and By game card open/closed memory, the QR countdowns and
// "x ago" ages, and the Payment link button. Loaded on the admin page; the
// page wiring is skipped when there is no document (the test sandbox).
(function () {
  'use strict';

  var CHIPS = ['all', 'unpaid', 'review', 'signin', 'out', 'verify', 'reserved', 'paid', 'cancelled'];
  var PAGE_SIZE = 50;
  var TYPES = ['all', 'rental', 'purchase', 'reservation'];
  var GROUP_KEYS = ['now', 'released', 'refunds', 'bygame'];
  var LEDGER_KEY = 'oqLedger';
  var GROUPS_KEY = 'oqGroups';
  // By game cards (views/partials/admin/orders/needs-you.ejs data-oq-card):
  // '<game_id>|<type>', e.g. '3|nt', 'psplus|tr', 'upcoming_4|tr'.
  var CARDS_KEY = 'oqCards';
  var CARD_KEY_RE = /^[A-Za-z0-9_]{1,40}\|(tr|nt|ps4)$/;
  var MAX_CARDS = 300;

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

  // Same rule for the cards: only well-formed keys with boolean values, and a
  // cap so years of games cannot grow the stored object without end.
  function normalizeCards(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    var n = 0;
    Object.keys(raw).forEach(function (k) {
      if (n >= MAX_CARDS) return;
      if (CARD_KEY_RE.test(k) && typeof raw[k] === 'boolean') { out[k] = raw[k]; n++; }
    });
    return out;
  }

  // "Cancel selected" on the By game board: the bar's count and the question
  // asked before anything is cancelled.
  function bulkLabel(n) {
    return n + ' selected';
  }

  function bulkConfirm(n) {
    return 'Cancel ' + n + ' selected order' + (n === 1 ? '' : 's') +
      '?\n\nThey leave the board; the records stay in All orders.';
  }

  // Page window over the rows that already match the filters. page is 1-based.
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

  window.__oqFilter = {
    normalizeLedgerState: normalizeLedgerState,
    orderType: orderType,
    rowMatches: rowMatches,
    isFiltering: isFiltering,
    normalizeGroups: normalizeGroups,
    normalizeCards: normalizeCards,
    bulkLabel: bulkLabel,
    bulkConfirm: bulkConfirm,
    paginate: paginate,
    PAGE_SIZE: PAGE_SIZE
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

  // "Cancel selected": the row checkboxes all belong to #oqBulkForm (their
  // form attribute), so ticking them is all the form needs. This keeps the bar,
  // its count and each card's "Select all" box in step with the ticks.
  function initBulk() {
    var form = document.getElementById('oqBulkForm');
    if (!form) return;
    var label = document.getElementById('oqBulkN');
    function picks(root) { return toArray((root || document).querySelectorAll('input.oq-pick')); }
    function ticked() { return picks().filter(function (p) { return p.checked; }).length; }
    function update() {
      var n = ticked();
      form.hidden = n === 0;
      if (label) label.textContent = bulkLabel(n);
      toArray(document.querySelectorAll('details[data-oq-card]')).forEach(function (card) {
        var all = card.querySelector('input.oq-pick-all');
        if (!all) return;
        var mine = picks(card);
        var on = mine.filter(function (p) { return p.checked; }).length;
        all.checked = mine.length > 0 && on === mine.length;
        all.indeterminate = on > 0 && on < mine.length;
      });
    }
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.classList) return;
      if (t.classList.contains('oq-pick-all')) {
        var card = t.closest('details[data-oq-card]');
        if (card) picks(card).forEach(function (p) { p.checked = t.checked; });
      }
      if (t.classList.contains('oq-pick') || t.classList.contains('oq-pick-all')) update();
    });
    var clear = document.getElementById('oqBulkClear');
    if (clear) {
      clear.addEventListener('click', function () {
        picks().forEach(function (p) { p.checked = false; });
        update();
      });
    }
    form.addEventListener('submit', function (e) {
      var n = ticked();
      if (!n || !window.confirm(bulkConfirm(n))) e.preventDefault();
    });
    // A reload can bring ticks back; show the bar for them.
    update();
  }

  // Each By game card re-opens or folds the way the owner last left it; a
  // card they never touched keeps the template's default (open when a slot
  // is free).
  function initCards() {
    var saved = normalizeCards(readJson('local', CARDS_KEY));
    toArray(document.querySelectorAll('details[data-oq-card]')).forEach(function (d) {
      var key = d.getAttribute('data-oq-card');
      if (Object.prototype.hasOwnProperty.call(saved, key)) d.open = saved[key];
      d.addEventListener('toggle', function () {
        var cur = normalizeCards(readJson('local', CARDS_KEY));
        cur[key] = d.open;
        writeJson('local', CARDS_KEY, normalizeCards(cur));
      });
    });
  }

  var focusLedger = null;

  function initLedger() {
    var table = document.getElementById('oqLedger');
    var search = document.getElementById('oqSearch');
    var typeSel = document.getElementById('oqType');
    var gameSel = document.getElementById('oqGame');
    var panel = document.getElementById('tab-orders');
    if (!table || !search || !typeSel || !panel) return;

    var state = normalizeLedgerState(readJson('session', LEDGER_KEY));
    var page = 1;

    function apply() {
      var game = gameSel ? gameSel.value : '';
      var matched = [];
      toArray(table.querySelectorAll('tr.oq-lr')).forEach(function (r) {
        var match = rowMatches({
          g: r.getAttribute('data-g') || '',
          t: r.getAttribute('data-t') || '',
          s: r.getAttribute('data-s') || ''
        }, state);
        if (match && game && (r.getAttribute('data-game') || '') !== game) match = false;
        if (match) matched.push(r);
        else r.hidden = true;
      });
      var windowed = paginate(matched.length, page, PAGE_SIZE);
      page = windowed.page;
      matched.forEach(function (r, i) {
        r.hidden = i < windowed.start || i >= windowed.end;
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
      if (wrap) wrap.hidden = matched.length === 0;
      if (none) none.hidden = matched.length !== 0;
      var range = document.getElementById('oqPagerRange');
      var pager = document.getElementById('oqPager');
      var prev = document.getElementById('oqPagerPrev');
      var next = document.getElementById('oqPagerNext');
      if (pager) pager.hidden = matched.length === 0;
      if (range) {
        range.textContent = matched.length
          ? ('Showing ' + (windowed.start + 1) + '–' + windowed.end + ' of ' + matched.length)
          : '';
      }
      if (prev) prev.disabled = windowed.page <= 1;
      if (next) next.disabled = windowed.page >= windowed.pages;
      writeJson('session', LEDGER_KEY, state);
    }

    search.value = state.q;
    typeSel.value = state.type;
    search.addEventListener('input', function () { page = 1; state.q = search.value; apply(); });
    typeSel.addEventListener('change', function () { page = 1; state.type = typeSel.value; apply(); });
    if (gameSel) gameSel.addEventListener('change', function () { page = 1; apply(); });
    var prevBtn = document.getElementById('oqPagerPrev');
    var nextBtn = document.getElementById('oqPagerNext');
    if (prevBtn) prevBtn.addEventListener('click', function () { page -= 1; apply(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { page += 1; apply(); });
    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var chip = t.closest('.oq-chip');
      if (chip && panel.contains(chip)) { page = 1; state.chip = chip.getAttribute('data-g'); apply(); return; }
      if (t.closest('[data-oq-clear]')) {
        e.preventDefault();
        page = 1;
        state = normalizeLedgerState(null);
        search.value = '';
        typeSel.value = 'all';
        if (gameSel) gameSel.value = '';
        apply();
      }
    });
    var byGame = document.getElementById('oqByGameJump');
    if (byGame) {
      byGame.addEventListener('click', function () {
        var board = document.querySelector('details[data-oq-group="bygame"]');
        if (!board) return;
        board.open = true;
        board.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    apply();
    focusLedger = function (chip) {
      if (CHIPS.indexOf(chip) === -1) return;
      page = 1;
      state.chip = chip;
      apply();
    };
  }

  window.oqFocus = function (opts) {
    opts = opts || {};
    if (opts.group) {
      var g = document.querySelector('details[data-oq-group="' + opts.group + '"]');
      if (g) {
        g.open = true;
        if (!opts.chip && g.scrollIntoView) g.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    if (opts.chip && focusLedger) focusLedger(opts.chip);
    if (opts.chip) {
      var ledger = document.getElementById('oqLedger');
      if (ledger && ledger.scrollIntoView) ledger.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  function parseDetail(row) {
    var raw = row.getAttribute('data-detail');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function fillText(root, sel, value) {
    var el = root.querySelector(sel);
    if (el) el.textContent = value == null ? '' : String(value);
  }

  function initDrawer() {
    var drawer = document.getElementById('oqDrawer');
    var panel = document.getElementById('tab-orders');
    if (!drawer || !panel) return;
    var actions = drawer.querySelector('[data-od-actions]');
    var history = drawer.querySelector('[data-od-history]');

    function close() {
      drawer.hidden = true;
      drawer.setAttribute('aria-hidden', 'true');
      toArray(panel.querySelectorAll('.od-row-on')).forEach(function (r) { r.classList.remove('od-row-on'); });
    }

    function open(row) {
      var detail = parseDetail(row);
      if (!detail) return;
      fillText(drawer, '[data-od-ref]', detail.ref || 'Order');
      fillText(drawer, '[data-od-customer]', detail.customer);
      fillText(drawer, '[data-od-psn]', detail.psn);
      fillText(drawer, '[data-od-phone]', detail.phone);
      fillText(drawer, '[data-od-game]', detail.game);
      fillText(drawer, '[data-od-rental]', detail.rental);
      fillText(drawer, '[data-od-dates]', detail.dates);
      fillText(drawer, '[data-od-total]', detail.total);
      fillText(drawer, '[data-od-deposit]', detail.deposit);
      fillText(drawer, '[data-od-method]', detail.method);
      fillText(drawer, '[data-od-slot]', detail.slot);
      fillText(drawer, '[data-od-note]', detail.note || 'No note');
      var status = drawer.querySelector('[data-od-status]');
      if (status) {
        status.innerHTML = '';
        var badge = document.createElement('span');
        badge.className = 'adm-badge adm-badge-in';
        badge.textContent = detail.status || '';
        status.appendChild(badge);
      }
      var paidRow = drawer.querySelector('[data-od-paidto-row]');
      var paid = drawer.querySelector('[data-od-paidto]');
      var reveal = drawer.querySelector('[data-od-reveal]');
      if (paidRow && paid && reveal) {
        if (detail.paidToMask && detail.paidToReveal) {
          paid.textContent = detail.paidToMask;
          paid.removeAttribute('data-revealed');
          delete paid.dataset.mask;
          reveal.setAttribute('data-mask-subject', detail.paidToReveal);
          paidRow.hidden = false;
        } else {
          paid.textContent = '';
          reveal.setAttribute('data-mask-subject', '');
          paidRow.hidden = true;
        }
      }
      if (history) {
        history.innerHTML = '';
        var items = detail.history && detail.history.length ? detail.history : [{ label: detail.status || 'Recorded', at: '' }];
        items.forEach(function (h) {
          var li = document.createElement('li');
          var name = document.createElement('b');
          name.textContent = h.label || 'Updated';
          li.appendChild(name);
          if (h.at) {
            var when = document.createElement('span');
            var dt = new Date(h.at);
            when.textContent = isNaN(dt.getTime()) ? h.at : dt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
            li.appendChild(when);
          }
          history.appendChild(li);
        });
      }
      if (actions) {
        actions.innerHTML = '';
        var src = row.querySelector('.oq-lact') || row.querySelector('.oq-actions');
        if (src) {
          var clone = src.cloneNode(true);
          toArray(clone.querySelectorAll('[id]')).forEach(function (el) { el.removeAttribute('id'); });
          toArray(clone.querySelectorAll('input.oq-pick, .oq-pick-all')).forEach(function (el) { el.remove(); });
          actions.appendChild(clone);
        }
        if (detail.extend && detail.extend.id) {
          var ext = document.createElement('button');
          ext.type = 'button';
          ext.className = 'adm-btn adm-btn-secondary adm-btn-sm cst-extend';
          ext.textContent = 'Extend';
          ext.setAttribute('data-id', detail.extend.id);
          ext.setAttribute('data-name', detail.extend.name || '');
          ext.setAttribute('data-game', detail.extend.game || '');
          ext.setAttribute('data-end', detail.extend.end || '');
          ext.setAttribute('data-p7', String(detail.extend.p7 || 0));
          ext.setAttribute('data-p30', String(detail.extend.p30 || 0));
          ext.setAttribute('data-today', detail.extend.today || '');
          actions.appendChild(ext);
        }
      }
      toArray(panel.querySelectorAll('.od-row-on')).forEach(function (r) { r.classList.remove('od-row-on'); });
      row.classList.add('od-row-on');
      drawer.hidden = false;
      drawer.setAttribute('aria-hidden', 'false');
      var closeBtn = drawer.querySelector('[data-od-close]');
      if (closeBtn && closeBtn.focus) closeBtn.focus();
    }

    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('button, a, input, select, textarea, label, summary, form')) return;
      var row = t.closest('[data-od-open]');
      if (!row || !panel.contains(row)) return;
      open(row);
    });
    panel.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target && e.target.closest ? e.target.closest('tr[data-od-open]') : null;
      if (!row || e.target !== row) return;
      e.preventDefault();
      open(row);
    });
    drawer.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-od-close]')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || drawer.hidden) return;
      var confirmEl = document.getElementById('admConfirm');
      if (confirmEl && !confirmEl.hidden) return;
      close();
    });
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
    initCards();
    initBulk();
    initLedger();
    initDrawer();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
