// Settings tabs inside the admin shell.
//
// The page is still one document and every save posts to the same route it
// always did. This file only chooses which group is on screen, keeps the
// ?section= and #sec- links in step, and warns before a dirty group is left.
//
// The maps are required from scripts/test-settings-sections.js, so the DOM
// wiring below runs only in the browser.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AdminSettings = api;
  if (typeof document !== 'undefined') api.install(document);
})(typeof window !== 'undefined' ? window : global, function () {
  var SECTIONS = [
    { id: 'themes', label: 'Themes', anchors: ['sec-themes'] },
    { id: 'announcements', label: 'Announcements', anchors: ['sec-announcements'] },
    { id: 'site', label: 'Site', anchors: ['sec-site', 'sec-loyalty'] },
    { id: 'pricing', label: 'Pricing', anchors: ['sec-promo', 'sec-game-discounts'] },
    { id: 'payments', label: 'Payments', anchors: ['sec-payments', 'sec-reminders'] },
    { id: 'alerts', label: 'Alerts', anchors: ['sec-alerts'] },
    { id: 'maintenance', label: 'Maintenance', anchors: ['sec-images'] }
  ];

  // A save still redirects to /admin?tab=settings&msg=… (some older saves omit
  // the tab). The message opens the group that was just saved.
  var MSG_SECTION = {
    themes_saved: 'themes',
    themes_failed: 'themes',
    announcements_saved: 'announcements',
    announcements_invalid: 'announcements',
    announcement: 'announcements',
    settings_saved: 'site',
    theme_saved: 'site',
    password_changed: 'site',
    wrong_password: 'site',
    password_mismatch: 'site',
    password_too_short: 'site',
    promo_saved: 'pricing',
    game_discounts_saved: 'pricing',
    payment_saved: 'payments',
    reminders_saved: 'payments',
    alerts_saved: 'alerts'
  };

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // The confirm on "Optimize all images now". Heavy on purpose: it rewrites
  // older uploads on this server.
  var OPTIMIZE_CONFIRM = {
    title: 'Optimize all images now?',
    body: 'This is heavy. It rewrites older PNG and JPG uploads into smaller WebP files and can take a minute on this server. WebP files are skipped, and running it again is safe. Run it when the shop is quiet.',
    ok: 'Optimize now',
    cancel: 'Not now'
  };

  function sectionById(id) {
    var key = String(id || '').trim().toLowerCase();
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].id === key) return SECTIONS[i];
    }
    return null;
  }

  function sectionForAnchor(hash) {
    var id = String(hash || '').replace(/^#/, '').trim();
    if (!id) return '';
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].anchors.indexOf(id) !== -1) return SECTIONS[i].id;
    }
    return '';
  }

  function sectionForMessage(msg) {
    var key = String(msg || '').trim();
    return Object.prototype.hasOwnProperty.call(MSG_SECTION, key) ? MSG_SECTION[key] : '';
  }

  // Hash wins, then ?section=, then the save message, then Themes.
  // An old #sec-payments link still opens Payments even if section says themes.
  function resolveSection(input) {
    var src = input || {};
    var fromHash = sectionForAnchor(src.hash);
    if (fromHash) return fromHash;
    var requested = String(src.section || '').trim().toLowerCase();
    if (sectionById(requested)) return requested;
    var fromMsg = sectionForMessage(src.msg);
    if (fromMsg) return fromMsg;
    return 'themes';
  }

  // Wall-clock text for a stored Philippines-time value (YYYY-MM-DDTHH:mm).
  // Not parsed with Date, so the browser's timezone cannot shift it.
  function formatSchedule(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || '').trim());
    if (!m) return '';
    var month = Number(m[2]);
    var day = Number(m[3]);
    var hour = Number(m[4]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23) return '';
    var ap = hour >= 12 ? 'PM' : 'AM';
    var h12 = hour % 12;
    if (h12 === 0) h12 = 12;
    return day + ' ' + MONTHS[month - 1] + ' ' + m[1] + ', ' + h12 + ':' + m[5] + ' ' + ap;
  }

  function install(doc) {
    if (!doc || !doc.getElementById || doc.__adminSettingsInstalled) return;
    var shell = doc.getElementById('setShell');
    if (!shell) return;
    doc.__adminSettingsInstalled = true;

    var win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    var panels = Array.prototype.slice.call(shell.querySelectorAll('[data-set-panel]'));
    var tabs = Array.prototype.slice.call(shell.querySelectorAll('[data-set-tab]'));
    var bar = doc.getElementById('setDirty');
    var barText = doc.getElementById('setDirtyText');
    var openId = 'themes';
    var initial = new WeakMap();
    var lastForm = null;
    var saving = false;
    var msgUsed = false;

    function sectionLabel(id) {
      var row = sectionById(id);
      return row ? row.label : 'Settings';
    }

    function activePanel() {
      return shell.querySelector('[data-set-panel="' + openId + '"]');
    }

    function formsIn(panel) {
      if (!panel) return [];
      return Array.prototype.slice.call(panel.querySelectorAll('form'));
    }

    function clean(s) {
      return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    }

    function fieldLabel(el) {
      var aria = el.getAttribute && el.getAttribute('aria-label');
      if (aria && aria.trim()) return clean(aria);
      var wrap = el.closest && el.closest('.form-group, .pm-field, .oq-alert-row');
      if (!wrap) return 'This field';
      var named = wrap.querySelector('.oq-alert-name');
      if (named) return clean(named.textContent);
      var lab = wrap.querySelector('label');
      if (lab) {
        var full = clean(lab.textContent);
        var clone = lab.cloneNode(true);
        Array.prototype.forEach.call(clone.querySelectorAll('span'), function (span) { span.remove(); });
        var short = clean(clone.textContent);
        if (short) return short;
        if (full) return full;
      }
      var span = wrap.querySelector('span');
      if (span) return clean(span.textContent);
      return 'This field';
    }

    function keepInput(el) {
      if (!el.name || !el.form || !el.form.querySelector) return null;
      return el.form.querySelector('[name="' + String(el.name).replace(/"/g, '') + '_keep"]');
    }

    function changed(el) {
      if (!el || el.type === 'hidden' || el.type === 'button' || el.type === 'submit') return false;
      if (el.type === 'file') return !!(el.files && el.files.length);
      var snap = initial.get(el);
      if (!snap) return false;
      var keep = keepInput(el);
      if (keep) return keep.value !== '1';
      if (el.type === 'checkbox' || el.type === 'radio') return !!el.checked !== snap.checked;
      return el.value !== snap.value;
    }

    function collect(container) {
      var names = [];
      if (!container || !container.querySelectorAll) return names;
      var list = container.tagName === 'FORM'
        ? container.querySelectorAll('input, textarea, select')
        : container.querySelectorAll('form input, form textarea, form select');
      Array.prototype.forEach.call(list, function (el) {
        if (!changed(el)) return;
        var label = fieldLabel(el);
        if (label && names.indexOf(label) === -1) names.push(label);
      });
      return names;
    }

    function anyDirty() {
      for (var i = 0; i < panels.length; i++) {
        if (collect(panels[i]).length) return true;
      }
      return false;
    }

    function previewNames(names) {
      var shown = names.slice(0, 3).join(', ');
      if (names.length > 3) shown += ', and ' + (names.length - 3) + ' more';
      return shown;
    }

    function remember(scope) {
      Array.prototype.forEach.call(scope.querySelectorAll('input, textarea, select'), function (el) {
        if (!initial.has(el)) initial.set(el, { value: el.value, checked: !!el.checked });
      });
    }

    function refreshDates(scope) {
      Array.prototype.forEach.call(scope.querySelectorAll('input[type="datetime-local"]'), function (input) {
        if (input._setDateUpdate) input._setDateUpdate();
      });
    }

    function restore(form) {
      Array.prototype.forEach.call(form.querySelectorAll('input, textarea, select'), function (el) {
        var snap = initial.get(el);
        if (!snap) return;
        if (el.type === 'file') {
          try { el.value = ''; } catch (e) { /* a locked file input can refuse */ }
          return;
        }
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = snap.checked;
        else el.value = snap.value;
      });
      refreshDates(form);
    }

    function decorateDates(scope) {
      Array.prototype.forEach.call(scope.querySelectorAll('input[type="datetime-local"]'), function (input) {
        if (input.getAttribute('data-set-date') === '1') return;
        input.setAttribute('data-set-date', '1');
        var row = doc.createElement('div');
        row.className = 'set-date-row';
        var box = doc.createElement('div');
        box.className = 'set-date';
        var face = doc.createElement('span');
        face.className = 'set-date-face';
        var clear = doc.createElement('button');
        clear.type = 'button';
        clear.className = 'set-date-clear';
        clear.textContent = 'Clear';
        var parent = input.parentNode;
        parent.insertBefore(row, input);
        box.appendChild(face);
        box.appendChild(input);
        row.appendChild(box);
        row.appendChild(clear);
        function update() {
          var pretty = formatSchedule(input.value);
          face.textContent = pretty || 'No date set';
          face.classList.toggle('is-empty', !pretty);
          clear.hidden = !input.value;
        }
        input.addEventListener('change', update);
        input.addEventListener('input', update);
        clear.addEventListener('click', function () {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          update();
        });
        input._setDateUpdate = update;
        update();
      });
    }

    function refreshBar() {
      if (!bar || !barText) return;
      var names = collect(activePanel());
      bar.hidden = names.length === 0;
      if (!names.length) return;
      var n = names.length;
      barText.textContent = n + ' unsaved change' + (n === 1 ? '' : 's') + ' on ' + sectionLabel(openId)
        + ' (' + previewNames(names) + '). Switching tabs will ask you first.';
    }

    function writeUrl(id, anchor) {
      if (!win || !win.history || !win.location) return;
      var params = new URLSearchParams(win.location.search);
      params.set('tab', 'settings');
      params.delete('msg');
      params.set('section', id);
      var hash = '';
      if (anchor && sectionForAnchor(anchor) === id) hash = '#' + anchor;
      win.history.replaceState({}, '', '/admin?' + params.toString() + hash);
    }

    function settingsOn() {
      var tab = doc.getElementById('tab-settings');
      return !!(tab && tab.classList.contains('active'));
    }

    function showSection(id, opts) {
      opts = opts || {};
      if (!sectionById(id)) id = 'themes';
      if (!opts.force && id !== openId && collect(activePanel()).length) {
        confirmLeave(function () {
          showSection(id, {
            force: true,
            anchor: opts.anchor,
            scroll: opts.scroll,
            write: opts.write
          });
        }, opts.onStay || null);
        return;
      }
      openId = id;
      panels.forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-set-panel') !== id;
      });
      var activeTab = null;
      tabs.forEach(function (tab) {
        var on = tab.getAttribute('data-set-tab') === id;
        tab.classList.toggle('set-tab-on', on);
        if (tab.setAttribute) tab.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) activeTab = tab;
      });
      // Keep the selected tab in view when the row scrolls sideways on a phone.
      if (activeTab && activeTab.parentElement) {
        var scroller = activeTab.parentElement;
        var left = activeTab.offsetLeft - 8;
        if (scroller.scrollLeft > left || scroller.scrollLeft + scroller.clientWidth < left + activeTab.offsetWidth) {
          scroller.scrollLeft = Math.max(0, left - 8);
        }
      }
      if (opts.write !== false) writeUrl(id, opts.anchor || '');
      refreshBar();
      if (opts.scroll && opts.anchor && sectionForAnchor(opts.anchor) === id) {
        var target = doc.getElementById(opts.anchor);
        if (target && target.scrollIntoView) {
          setTimeout(function () { target.scrollIntoView({ block: 'start' }); }, 30);
        }
      }
    }

    function confirmLeave(onYes, onNo) {
      var names = collect(activePanel());
      var n = names.length;
      var body = n
        ? (n + ' unsaved change' + (n === 1 ? '' : 's') + ' on ' + sectionLabel(openId)
          + ' (' + previewNames(names) + '). Leaving does not save them, and a reload loses them.')
        : 'This tab has unsaved edits. Leaving does not save them.';
      var opts = {
        title: 'Leave without saving?',
        body: body,
        ok: 'Leave without saving',
        cancel: 'Stay on this tab'
      };
      var ask = win && win.adminConfirmAsk;
      function finish(yes) {
        if (yes) { if (onYes) onYes(); }
        else if (onNo) onNo();
      }
      if (typeof ask !== 'function') {
        finish(win && typeof win.confirm === 'function' ? win.confirm(body) : false);
        return;
      }
      ask(opts).then(function (yes) { finish(!!yes); });
    }

    function readHash() {
      if (!win || !win.location) return '';
      return String(win.location.hash || '').replace(/^#/, '');
    }

    // opts.write === false on the first pass, before the page script has read
    // ?msg= for its toast. Later passes write ?section= and keep the group
    // the owner was already on when the URL does not name one.
    function syncFromUrl(opts) {
      opts = opts || {};
      if (!win || !win.location) return;
      var params = new URLSearchParams(win.location.search);
      var rawMsg = shell.getAttribute('data-msg') || params.get('msg') || '';
      var active = settingsOn();
      var tabIsSettings = params.get('tab') === 'settings';
      if (!active && !tabIsSettings && (msgUsed || !sectionForMessage(rawMsg))) return;

      var hash = opts.anchor ? String(opts.anchor).replace(/^#/, '') : readHash();
      var fromHash = sectionForAnchor(hash);
      var query = String(params.get('section') || '').trim().toLowerCase();
      var fromQuery = sectionById(query) ? query : '';
      var msg = msgUsed ? '' : rawMsg;
      if (msg) msgUsed = true;
      var fromMsg = sectionForMessage(msg);
      var id = fromHash || fromQuery || fromMsg;
      if (!id) id = (active || tabIsSettings) ? openId : 'themes';

      showSection(id, {
        force: true,
        anchor: hash,
        scroll: !!(opts.scroll !== false && active && fromHash),
        write: opts.write === false ? false : !!(active || tabIsSettings)
      });
    }

    decorateDates(shell);
    remember(shell);

    shell.addEventListener('click', function (e) {
      var tab = e.target && e.target.closest && e.target.closest('[data-set-tab]');
      if (!tab || !shell.contains(tab)) return;
      e.preventDefault();
      var href = tab.getAttribute('href') || '';
      var hash = href.indexOf('#') === -1 ? '' : href.slice(href.indexOf('#') + 1);
      showSection(tab.getAttribute('data-set-tab'), { anchor: hash, scroll: true, write: true });
    });

    shell.addEventListener('input', function (e) {
      if (e.target && e.target.form && shell.contains(e.target.form)) lastForm = e.target.form;
      refreshBar();
    });
    shell.addEventListener('change', function (e) {
      if (e.target && e.target.form && shell.contains(e.target.form)) lastForm = e.target.form;
      refreshBar();
    });

    if (bar) {
      var discardBtn = doc.getElementById('setDirtyDiscard');
      var saveBtn = doc.getElementById('setDirtySave');
      if (discardBtn) {
        discardBtn.addEventListener('click', function () {
          formsIn(activePanel()).forEach(restore);
          refreshBar();
        });
      }
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          var forms = formsIn(activePanel()).filter(function (form) { return collect(form).length; });
          if (!forms.length) return;
          var form = lastForm && forms.indexOf(lastForm) !== -1 ? lastForm : forms[0];
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.submit();
        });
      }
    }

    doc.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM' || !shell.contains(form)) return;
      if (form.getAttribute('data-settings-bypass') === '1') {
        form.removeAttribute('data-settings-bypass');
        saving = true;
        return;
      }
      var action = form.getAttribute('action') || '';
      if (win && win.AdminConfirm && win.AdminConfirm.classifyAdminAction(action)) return;
      var others = formsIn(activePanel()).filter(function (other) {
        return other !== form && collect(other).length;
      });
      if (!others.length) {
        saving = true;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      var opts = {
        title: 'Save this form only?',
        body: 'Another form on this tab still has unsaved edits. Saving reloads the page and those edits will be lost.',
        ok: 'Save this form',
        cancel: 'Stay'
      };
      function go() {
        saving = true;
        form.setAttribute('data-settings-bypass', '1');
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      }
      var ask = win && win.adminConfirmAsk;
      if (typeof ask !== 'function') {
        if (win && win.confirm && win.confirm(opts.body)) go();
        return;
      }
      ask(opts).then(function (yes) { if (yes) go(); });
    }, true);

    if (win) {
      win.addEventListener('beforeunload', function (e) {
        if (saving || !anyDirty()) return;
        e.preventDefault();
        e.returnValue = '';
      });
      win.addEventListener('hashchange', function () {
        if (win.__settingsIgnoreHash) return;
        var hash = readHash('');
        var id = sectionForAnchor(hash);
        if (!id) return;
        if (id === openId) {
          var target = doc.getElementById(hash);
          if (target && target.scrollIntoView && settingsOn()) target.scrollIntoView({ block: 'start' });
          return;
        }
        showSection(id, {
          anchor: hash,
          scroll: true,
          write: true,
          onStay: function () { writeUrl(openId, ''); }
        });
      });
      win.settingsShouldBlock = function (name, nav) {
        if (!settingsOn()) return false;
        if (!collect(activePanel()).length) return false;
        if (name !== 'settings') return true;
        var btn = doc.querySelector('[data-nav="' + nav + '"]');
        var anchor = btn && btn.getAttribute ? btn.getAttribute('data-anchor') : '';
        var dest = anchor ? sectionForAnchor(anchor) : '';
        if (!dest || dest === openId) return false;
        return true;
      };
      win.settingsConfirmLeave = function (onYes) { confirmLeave(onYes); };
      win.settingsSyncFromUrl = syncFromUrl;
    }

    // Paint the right group before the tab is shown. Do not rewrite the URL
    // yet: the page script still needs ?msg= so it can show the save toast.
    syncFromUrl({ scroll: false, write: false });
  }

  return {
    SECTIONS: SECTIONS,
    MSG_SECTION: MSG_SECTION,
    sectionForAnchor: sectionForAnchor,
    sectionForMessage: sectionForMessage,
    resolveSection: resolveSection,
    formatSchedule: formatSchedule,
    OPTIMIZE_CONFIRM: OPTIMIZE_CONFIRM,
    install: install
  };
});
