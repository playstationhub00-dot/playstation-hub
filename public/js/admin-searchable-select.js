// Turns every single-select <select> in the admin panel into a searchable combobox.
// The native <select> stays in the DOM (hidden) so forms, existing onchange handlers,
// and any script that reads/sets `.value` keep working unmodified — we intercept the
// `value` property itself so external assignments (e.g. resetting a field when another
// field changes) stay in sync with the visible search input automatically.
(function () {
  function setupOne(select) {
    if (select.multiple || select.hasAttribute('data-ss-skip')) return;
    select.setAttribute('data-ss-init', '1');

    const wrap = document.createElement('div');
    wrap.className = 'ss-wrap';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('ss-native');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ss-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    wrap.appendChild(input);

    const panel = document.createElement('div');
    panel.className = 'ss-panel';
    wrap.appendChild(panel);

    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', {
      get() { return desc.get.call(select); },
      set(v) { desc.set.call(select, v); syncLabel(); },
      configurable: true
    });

    function getRows() {
      const rows = [];
      Array.from(select.children).forEach(child => {
        if (child.tagName === 'OPTGROUP') {
          if (child.style.display === 'none') return;
          rows.push({ type: 'group', label: child.label });
          Array.from(child.children).forEach(opt => rows.push({ type: 'option', value: opt.value, text: opt.text }));
        } else if (child.tagName === 'OPTION') {
          rows.push({ type: 'option', value: child.value, text: child.text });
        }
      });
      return rows;
    }

    function syncLabel() {
      const opt = select.options[select.selectedIndex];
      input.value = opt ? opt.text : '';
    }

    function closePanel() {
      panel.classList.remove('open');
      syncLabel();
    }

    function selectValue(value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      closePanel();
    }

    function renderPanel(filterText) {
      const q = filterText.trim().toLowerCase();
      panel.innerHTML = '';
      let matched = 0;
      let pendingGroup = null;
      getRows().forEach(row => {
        if (row.type === 'group') {
          pendingGroup = document.createElement('div');
          pendingGroup.className = 'ss-group';
          pendingGroup.textContent = row.label;
          pendingGroup._hasMatch = false;
          panel.appendChild(pendingGroup);
        } else {
          if (q && !row.text.toLowerCase().includes(q)) return;
          matched++;
          if (pendingGroup) pendingGroup._hasMatch = true;
          const item = document.createElement('div');
          item.className = 'ss-option' + (row.value === select.value ? ' active' : '');
          item.textContent = row.text;
          item.addEventListener('mousedown', (e) => { e.preventDefault(); selectValue(row.value); });
          panel.appendChild(item);
        }
      });
      panel.querySelectorAll('.ss-group').forEach(g => { if (!g._hasMatch) g.remove(); });
      if (matched === 0) {
        const empty = document.createElement('div');
        empty.className = 'ss-empty';
        empty.textContent = 'No matches';
        panel.appendChild(empty);
      }
    }

    function openPanel() {
      renderPanel('');
      panel.classList.add('open');
    }

    input.addEventListener('focus', () => { input.select(); openPanel(); });
    input.addEventListener('click', () => openPanel());
    input.addEventListener('input', () => { renderPanel(input.value); panel.classList.add('open'); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.blur(); closePanel(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = panel.querySelector('.ss-option.hover') || panel.querySelector('.ss-option');
        if (pick) pick.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const opts = Array.from(panel.querySelectorAll('.ss-option'));
        if (!opts.length) return;
        let idx = opts.findIndex(o => o.classList.contains('hover'));
        opts.forEach(o => o.classList.remove('hover'));
        idx = e.key === 'ArrowDown' ? Math.min(idx + 1, opts.length - 1) : Math.max(idx - 1, 0);
        opts[idx].classList.add('hover');
        opts[idx].scrollIntoView({ block: 'nearest' });
      }
    });
    input.addEventListener('blur', () => { setTimeout(closePanel, 120); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) panel.classList.remove('open'); });

    syncLabel();
  }

  function init(root) {
    (root || document).querySelectorAll('select:not([data-ss-init])').forEach(setupOne);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
  else init();

  window.initSearchableSelects = init;
})();
