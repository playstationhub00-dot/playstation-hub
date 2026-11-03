// The four voucher states on the game page. Apply asks the server; the
// price rows are whatever that quote returned, and checkout runs the same
// check again. A second code never replaces the one already applied.
(function () {
  var box = document.getElementById('voucherBox');
  if (!box || typeof phSetVoucherQuote !== 'function') return;

  var input = document.getElementById('voucherInput');
  var applyBtn = document.getElementById('voucherApply');
  var entry = document.getElementById('voucherEntry');
  var appliedEl = document.getElementById('voucherApplied');
  var errorEl = document.getElementById('voucherError');
  var fineEl = document.getElementById('voucherFine');
  var labelEl = document.getElementById('voucherLabel');
  var hintEl = document.getElementById('voucherHint');
  var nameInput = document.getElementById('orderFbName');
  var defaultFine = 'One code per order. Codes can\'t be combined with other vouchers or Rewards.';

  var applied = null;
  var busy = false;

  function pesos(n) { return '₱' + n; }

  function setApplyEnabled() {
    var has = input && input.value.trim().length > 0;
    if (!applyBtn) return;
    applyBtn.disabled = !has;
    applyBtn.classList.toggle('dis', !has);
  }

  function showError(message, action) {
    if (!errorEl) return;
    errorEl.hidden = !message;
    errorEl.textContent = '';
    if (!message) return;
    var monthly = action && message.indexOf(action) !== -1;
    if (monthly) errorEl.appendChild(document.createTextNode('⚠ '));
    if (monthly) {
      var cut = message.indexOf(action);
      var head = message.slice(0, cut);
      var codeName = head.split(' ')[0];
      var bold = document.createElement('b');
      bold.textContent = codeName;
      errorEl.appendChild(bold);
      errorEl.appendChild(document.createTextNode(head.slice(codeName.length)));
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vact';
      btn.textContent = action;
      btn.addEventListener('click', function () {
        var monthlyBtn = document.querySelector('.gd-dur-btn[data-days="30"]');
        if (monthlyBtn && typeof onDurChange === 'function') onDurChange(monthlyBtn);
        requestQuote(input ? input.value : '');
      });
      errorEl.appendChild(btn);
      return;
    }
    var removeAt = message.indexOf('Remove ');
    if (removeAt !== -1) {
      errorEl.appendChild(document.createTextNode(message.slice(0, removeAt + 'Remove '.length)));
      var rest = message.slice(removeAt + 'Remove '.length);
      var nameEnd = rest.indexOf(' ');
      var boldName = document.createElement('b');
      boldName.textContent = nameEnd === -1 ? rest : rest.slice(0, nameEnd);
      errorEl.appendChild(boldName);
      if (nameEnd !== -1) errorEl.appendChild(document.createTextNode(rest.slice(nameEnd)));
      return;
    }
    errorEl.appendChild(document.createTextNode(message));
  }

  function paintApplied(quote) {
    if (!appliedEl) return;
    appliedEl.hidden = false;
    appliedEl.textContent = '';
    appliedEl.appendChild(document.createTextNode('✓ '));
    var span = document.createElement('span');
    var code = document.createElement('code');
    code.textContent = quote.code;
    span.appendChild(code);
    span.appendChild(document.createTextNode(' applied, −' + quote.pct + '%'));
    appliedEl.appendChild(span);
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', clearApplied);
    appliedEl.appendChild(remove);
    if (labelEl) labelEl.textContent = 'Promo code';
    if (fineEl) fineEl.textContent = quote.fine || 'One code per order. Codes can\'t be combined with other vouchers or Rewards.';
    if (entry) entry.hidden = true;
    if (input) { input.value = ''; input.classList.remove('err', 'f'); }
    var another = document.getElementById('voucherAnother');
    if (another) another.hidden = false;
    if (hintEl) hintEl.hidden = true;
    setApplyEnabled();
  }

  function clearApplied() {
    applied = null;
    phSetVoucherQuote(null);
    if (appliedEl) appliedEl.hidden = true;
    var another = document.getElementById('voucherAnother');
    if (another) another.hidden = true;
    if (entry) entry.hidden = false;
    if (input) { input.value = ''; input.classList.remove('err', 'f'); }
    showError('');
    if (labelEl) labelEl.textContent = 'Have a promo code?';
    if (fineEl) fineEl.textContent = defaultFine;
    if (hintEl) hintEl.hidden = false;
    setApplyEnabled();
  }

  function currentSelection() {
    var typeEl = document.querySelector('input[name="rentalType"]:checked');
    var dayBtn = document.querySelector('.gd-dur-btn.active');
    return {
      account_type: typeEl ? typeEl.value : '',
      days: dayBtn ? dayBtn.getAttribute('data-days') : ''
    };
  }

  function requestQuote(raw) {
    var code = String(raw || '').trim();
    if (!code) return;
    if (applied && applied.code && code.toUpperCase() !== String(applied.code).toUpperCase()) {
      if (input) { input.value = code; input.classList.add('f', 'err'); }
      showError('Only one code per order. Remove ' + applied.code + ' first if you\'d like to use this one instead.');
      return;
    }
    var sel = currentSelection();
    if (!sel.account_type || !sel.days) {
      showError('Pick an account type and a rental length first.');
      return;
    }
    busy = true;
    fetch('/api/voucher/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code,
        game_id: box.getAttribute('data-game-id'),
        account_type: sel.account_type,
        days: sel.days,
        fb_name: nameInput ? nameInput.value.trim() : '',
        applied_code: applied ? applied.code : ''
      })
    }).then(function (r) { return r.json(); }).then(function (data) {
      busy = false;
      if (!data) return;
      if (data.error === 'one_code') {
        showSecond(code, data.message);
        return;
      }
      if (!data.ok) {
        applied = null;
        phSetVoucherQuote(null);
        if (appliedEl) appliedEl.hidden = true;
        if (entry) entry.hidden = false;
        if (input) {
          input.value = code;
          input.classList.add('f');
          input.classList.toggle('err', data.error === 'monthly_only' || data.error === 'unknown' || data.error === 'expired' || data.error === 'used' || data.error === 'loyalty');
        }
        showError(data.message || 'That code isn\'t valid.', data.action || '');
        if (labelEl) labelEl.textContent = 'Have a promo code?';
        if (fineEl) fineEl.textContent = defaultFine;
        if (hintEl && data.error === 'monthly_only') hintEl.hidden = false;
        setApplyEnabled();
        return;
      }
      applied = data;
      showError('');
      if (input) input.classList.remove('err');
      paintApplied(data);
      phSetVoucherQuote(data);
    }).catch(function () {
      busy = false;
      showError('Couldn\'t check that code. Try again.');
    });
  }

  if (input) {
    input.addEventListener('input', function () {
      setApplyEnabled();
      input.classList.remove('err');
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (!applyBtn.disabled) requestQuote(input.value); }
    });
  }
  if (applyBtn) applyBtn.addEventListener('click', function () { requestQuote(input && input.value); });
  var anotherBtn = document.getElementById('voucherAnother');
  if (anotherBtn) anotherBtn.addEventListener('click', function () {
    anotherBtn.hidden = true;
    if (entry) entry.hidden = false;
    if (input) input.focus();
  });
  if (nameInput) {
    var timer = null;
    nameInput.addEventListener('input', function () {
      if (!applied) return;
      clearTimeout(timer);
      timer = setTimeout(function () { requestQuote(applied.code); }, 400);
    });
  }

  // Duration or type changes: re-check the code against the new selection.
  document.querySelectorAll('input[name="rentalType"]').forEach(function (el) {
    el.addEventListener('change', function () {
      if (applied) requestQuote(applied.code);
    });
  });
  document.querySelectorAll('.gd-dur-btn').forEach(function (el) {
    el.addEventListener('click', function () {
      if (!applied) return;
      setTimeout(function () { requestQuote(applied.code); }, 0);
    });
  });

  setApplyEnabled();

  var preset = box.getAttribute('data-error');
  if (preset) {
    var messages = {
      expired: 'That code has ended.',
      used: 'You\'ve already used that code.',
      loyalty: 'That code can\'t be combined with Rewards or the ₱50 comeback discount.',
      monthly_only: 'That code works on monthly rentals only. Switch to Monthly?',
      unknown: 'That code isn\'t valid.',
      disabled: 'That code is turned off.'
    };
    showError(messages[preset] || 'That code couldn\'t be applied.');
  }
})();
