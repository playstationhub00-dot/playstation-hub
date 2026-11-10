// Confirm dialogs and undo toasts for the admin.
//
// The rules (which action gets which dialog, and the DELETE word) are in this
// file so scripts/test-admin-confirm.js can require them without a browser.
// The DOM wiring at the bottom runs only in the page.
//
// Typed DELETE is only for deleting an order or an account (and a customer
// row that deletes its order with it). A slide, a review, a game, and the
// other smaller deletes get a plain confirm. Mark paid confirms in the page
// and will not save until a payment method is chosen. Release confirms the
// action. Hide-review and remove-requester wait 8 seconds so Undo can cancel
// them before they save.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') api.install(document);
  if (root) root.AdminConfirm = api;
})(typeof window !== 'undefined' ? window : global, function () {
  const DELETE_WORD = 'DELETE';
  const UNDO_MS = 8000;

  function pathOf(action) {
    const s = String(action || '').trim();
    if (!s) return '';
    try {
      if (/^https?:/i.test(s)) return new URL(s).pathname;
    } catch (e) { /* keep the raw path */ }
    return s.split('?')[0];
  }

  function classifyAdminAction(action, opts) {
    const path = pathOf(action);
    if (/\/admin\/orders\/[^/]+\/delete\/?$/.test(path)) return 'delete-typed';
    if (/\/admin\/accounts\/delete\/[^/]+\/?$/.test(path)) return 'delete-typed';
    if (/\/admin\/customers\/delete\/[^/]+\/?$/.test(path)) {
      return opts && opts.deletesOrder ? 'delete-typed' : 'delete-simple';
    }
    if (/\/admin\/orders\/[^/]+\/mark-paid\/?$/.test(path)) return 'mark-paid';
    if (/\/admin\/upcoming\/release\/[^/]+\/?$/.test(path)) return 'release';
    if (/\/admin\/reviews\/toggle\/[^/]+\/?$/.test(path)) return 'undo';
    if (/\/admin\/requests\/[^/]+\/voter\/remove\/?$/.test(path)) return 'undo';
    if (
      /\/admin\/hero-slides\/delete\/?$/.test(path) ||
      /\/admin\/signin-steps\/[^/]+\/delete\/?$/.test(path) ||
      /\/admin\/signin-code-example\/remove\/?$/.test(path) ||
      /\/admin\/reviews\/delete\/[^/]+\/?$/.test(path) ||
      /\/admin\/announcements\/delete\/[^/]+\/?$/.test(path) ||
      /\/admin\/posters\/background\/remove\/?$/.test(path) ||
      /\/admin\/upcoming\/delete\/[^/]+\/?$/.test(path) ||
      /\/admin\/psplus\/delete\/[^/]+\/?$/.test(path) ||
      /\/admin\/psplus\/popular\/delete\/[^/]+\/?$/.test(path) ||
      /\/admin\/requests\/[^/]+\/delete\/?$/.test(path) ||
      /\/admin\/delete\/[^/]+\/?$/.test(path)
    ) return 'delete-simple';
    return null;
  }

  function acceptsDeleteWord(value) {
    return String(value == null ? '' : value).trim() === DELETE_WORD;
  }

  function kindOf(form) {
    const explicit = form && form.confirmKind;
    if (explicit) return explicit;
    return classifyAdminAction(form && form.action, { deletesOrder: !!(form && form.deletesOrder) });
  }

  function install(doc) {
    if (!doc || doc.__adminConfirmInstalled) return;
    doc.__adminConfirmInstalled = true;
    const pending = [];

    function dialog() { return doc.getElementById('admConfirm'); }

    function openDialog(kind, form) {
      const el = dialog();
      if (!el) {
        if (kind === 'delete-typed' && !acceptsDeleteWord(doc.defaultView && doc.defaultView.prompt ? doc.defaultView.prompt('Type DELETE') : '')) return;
        commit(form);
        return;
      }
      const title = el.querySelector('[data-confirm-title]');
      const body = el.querySelector('[data-confirm-body]');
      const extra = el.querySelector('[data-confirm-extra]');
      const typed = el.querySelector('[data-confirm-typed]');
      const input = el.querySelector('[data-confirm-input]');
      const okBtn = el.querySelector('[data-confirm-ok]');
      const cancelBtn = el.querySelector('[data-confirm-cancel]');
      const copy = copyFor(kind, form);
      title.textContent = copy.title;
      body.textContent = copy.body;
      extra.hidden = !copy.extra;
      extra.innerHTML = copy.extra || '';
      const needsType = kind === 'delete-typed';
      const needsMethod = kind === 'mark-paid';
      typed.hidden = !needsType;
      const methodWrap = el.querySelector('[data-confirm-method]');
      if (methodWrap) methodWrap.hidden = !needsMethod;
      if (needsMethod) fillMethods(el);
      if (input) input.value = '';
      okBtn.disabled = needsType || needsMethod;
      okBtn.textContent = copy.ok;
      cancelBtn.textContent = copy.cancel;
      okBtn.className = 'adm-btn ' + (kind === 'delete-typed' ? 'adm-btn-danger' : 'adm-btn-primary');
      el.hidden = false;
      el.dataset.kind = kind;
      el._form = form;
      (needsType && input ? input : cancelBtn).focus();
    }

    function closeDialog() {
      const el = dialog();
      if (!el) return;
      el.hidden = true;
      el._form = null;
    }

    function copyFor(kind, form) {
      const d = form && form.dataset ? form.dataset : {};
      if (kind === 'delete-typed') {
        const what = d.confirmTitle || 'Delete this?';
        return {
          title: what,
          body: d.confirmBody || 'This cannot be undone.',
          extra: '',
          ok: d.confirmOk || 'Delete',
          cancel: 'Cancel'
        };
      }
      if (kind === 'mark-paid') {
        const lines = [];
        if (d.markName || d.markGame) lines.push([d.markName, d.markGame, d.markType, d.markPlan].filter(Boolean).join(' · '));
        const bits = [];
        if (d.markAmount) bits.push('Amount: ' + d.markAmount);
        if (d.markDeposit && d.markDeposit !== '0') bits.push('Includes a refundable deposit');
        bits.push('Choose how they paid. It is saved on the order.');
        bits.push('Then: the order is marked paid. They still send their sign-in code.');
        return {
          title: 'Mark ' + (d.markRef || 'this order') + ' as paid?',
          body: lines[0] || 'Use this when the customer paid outside the site.',
          extra: bits.map(escapeHtml).join('<br>'),
          ok: 'Yes, mark paid',
          cancel: 'Cancel'
        };
      }
      if (kind === 'release') {
        const n = Number(d.releaseReserved) || 0;
        const changes = [
          'Shows on Browse with rent prices',
          n ? (n + ' reservation' + (n === 1 ? '' : 's') + ' become orders, and those customers get a sign-in message') : 'Reservations on this game become orders',
          'Removed from the Coming soon list'
        ];
        return {
          title: 'Release ' + (d.releaseTitle || 'this game') + '?',
          body: 'It moves from Coming soon to Rent. These change on the live site right away:',
          extra: changes.map(line => '✓ ' + escapeHtml(line)).join('<br>'),
          ok: 'Release now',
          cancel: 'Not yet'
        };
      }
      return {
        title: d.confirmTitle || 'Are you sure?',
        body: d.confirmBody || d.confirm || 'This cannot be undone.',
        extra: '',
        ok: d.confirmOk || 'Delete',
        cancel: 'Cancel'
      };
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function fillMethods(el) {
      const sel = el.querySelector('[data-confirm-method-select]');
      const src = doc.getElementById('oqPayMethodOptions');
      if (!sel) return;
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      const blank = doc.createElement('option');
      blank.value = '';
      blank.textContent = 'Choose a payment method';
      sel.appendChild(blank);
      if (src) {
        Array.prototype.forEach.call(src.options, function (opt) {
          if (!opt.value) return;
          const o = doc.createElement('option');
          o.value = opt.value;
          o.textContent = opt.textContent;
          sel.appendChild(o);
        });
      }
      sel.value = '';
    }

    function chosenMethod(el) {
      const sel = el && el.querySelector('[data-confirm-method-select]');
      return sel && sel.value ? sel.value : '';
    }

    function writeMethod(form, value) {
      if (!form || !value) return;
      let input = form.querySelector('input[name="payment_method"]');
      if (!input) {
        input = doc.createElement('input');
        input.type = 'hidden';
        input.name = 'payment_method';
        form.appendChild(input);
      }
      input.value = value;
    }

    function syncOk() {
      const el = dialog();
      if (!el || el.hidden) return;
      const okBtn = el.querySelector('[data-confirm-ok]');
      if (!okBtn) return;
      if (el.dataset.kind === 'delete-typed') {
        const input = el.querySelector('[data-confirm-input]');
        okBtn.disabled = !acceptsDeleteWord(input && input.value);
      } else if (el.dataset.kind === 'mark-paid') {
        okBtn.disabled = !chosenMethod(el);
      } else {
        okBtn.disabled = false;
      }
    }

    function commit(form) {
      if (!form) return;
      form.dataset.confirmBypass = '1';
      form.dataset.confirmHandled = '1';
      // The old onsubmit="return confirm(...)" would ask a second time.
      form.onsubmit = null;
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    }

    function showUndo(label, run) {
      const host = doc.getElementById('admToasts') || doc.body;
      const toast = doc.createElement('div');
      toast.className = 'adm-toast';
      toast.innerHTML = '<span class="adm-toast-mark">✓</span><span class="adm-toast-text"></span><button type="button" class="adm-toast-undo">Undo</button><span class="adm-toast-bar"><i></i></span>';
      toast.querySelector('.adm-toast-text').textContent = label;
      host.appendChild(toast);
      let timer = setTimeout(finish, UNDO_MS);
      let done = false;
      const bar = toast.querySelector('.adm-toast-bar i');
      if (bar) bar.style.animationDuration = (UNDO_MS / 1000) + 's';
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const i = pending.indexOf(api);
        if (i !== -1) pending.splice(i, 1);
        toast.remove();
        run();
      }
      function cancel() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const i = pending.indexOf(api);
        if (i !== -1) pending.splice(i, 1);
        toast.remove();
      }
      toast.querySelector('.adm-toast-undo').addEventListener('click', cancel);
      const api = { finish, cancel };
      pending.push(api);
      return api;
    }

    doc.addEventListener('submit', function (e) {
      const form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      if (form.dataset && form.dataset.confirmBypass === '1') {
        delete form.dataset.confirmBypass;
        return;
      }
      const kind = kindOf({
        action: form.getAttribute('action') || '',
        confirmKind: form.getAttribute('data-confirm-kind') || '',
        deletesOrder: form.getAttribute('data-deletes-order') === '1'
      });
      if (!kind) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (kind === 'undo') {
        const label = (form.dataset && form.dataset.undoLabel) || 'Change saved';
        showUndo(label, function () { commit(form); });
        return;
      }
      openDialog(kind, form);
    }, true);

    doc.addEventListener('click', function (e) {
      const el = dialog();
      if (!el || el.hidden) return;
      if (e.target === el) closeDialog();
    });

    doc.addEventListener('input', function (e) {
      const el = dialog();
      if (!el || el.hidden) return;
      if (!e.target || !e.target.matches || !e.target.matches('[data-confirm-input]')) return;
      syncOk();
    });

    doc.addEventListener('change', function (e) {
      const el = dialog();
      if (!el || el.hidden) return;
      if (!e.target || !e.target.matches || !e.target.matches('[data-confirm-method-select]')) return;
      syncOk();
    });

    doc.addEventListener('click', function (e) {
      const el = dialog();
      if (!el || el.hidden) return;
      if (e.target.closest && e.target.closest('[data-confirm-cancel]')) {
        e.preventDefault();
        closeDialog();
        return;
      }
      if (e.target.closest && e.target.closest('[data-confirm-ok]')) {
        e.preventDefault();
        if (el.dataset.kind === 'delete-typed') {
          const input = el.querySelector('[data-confirm-input]');
          if (!acceptsDeleteWord(input && input.value)) return;
        }
        const form = el._form;
        if (el.dataset.kind === 'mark-paid') {
          const method = chosenMethod(el);
          if (!method) return;
          writeMethod(form, method);
        }
        closeDialog();
        commit(form);
      }
    });

    doc.addEventListener('keydown', function (e) {
      const el = dialog();
      if (!el || el.hidden) return;
      if (e.key === 'Escape') closeDialog();
    });

    function flush() {
      pending.slice().forEach(function (item) { item.finish(); });
    }
    if (doc.defaultView) {
      doc.defaultView.addEventListener('pagehide', flush);
    }

    if (doc.defaultView) {
      doc.defaultView.adminScheduleUndo = function (label, run) {
        showUndo(label, run);
      };
    }
  }

  return {
    DELETE_WORD,
    UNDO_MS,
    classifyAdminAction,
    acceptsDeleteWord,
    kindOf,
    install
  };
});
