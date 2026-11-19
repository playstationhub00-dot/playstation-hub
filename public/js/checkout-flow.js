(function () {
  var root = document.getElementById('checkoutModal');
  if (!root) return;
  var upcoming = root.dataset.upcoming === '1';
  var session = null;
  var tick = null;
  var file = null;

  function $(id) { return document.getElementById(id); }
  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
  function err(msg) { var el = $('ckErr'); if (!el) return; el.hidden = !msg; el.textContent = msg || ''; }

  function selection() {
    var radio = document.querySelector('input[name="rentalType"]:checked, input[name="rental_type"]:checked');
    var dur = document.querySelector('.gd-dur-btn.active');
    var code = '';
    var promo = document.getElementById('orderPromoCode');
    if (promo && promo.value) code = promo.value;
    var type = radio ? radio.value : 'nt';
    if (root.dataset.kind === 'buy') {
      var buyField = document.getElementById('buyOrderType') || document.getElementById('udBuyOrderType');
      if (buyField && buyField.value) type = buyField.value;
    }
    return {
      type: type,
      days: dur ? parseInt(dur.dataset.days, 10) : 30,
      code: code
    };
  }

  function money() {
    var s = selection();
    if (upcoming) {
      var priceEl = document.querySelector('#durGrid .gd-dur-btn.active .gd-dur-price');
      var rent = priceEl ? parseInt(String(priceEl.textContent).replace(/[^\d]/g, ''), 10) || 0 : 0;
      return { rent: rent, deposit: s.type === 'tr' ? 100 : 0 };
    }
    if (typeof chargedRent === 'function') {
      var rt = chargedRent(s.type, s.days);
      return { rent: rt.base - rt.discount, deposit: rt.deposit, was: rt.voucher ? rt.base + rt.deposit : 0, total: rt.total };
    }
    return { rent: 0, deposit: 0 };
  }

  function paintSummary(kind) {
    var s = selection();
    var m = money();
    var typeName = s.type === 'tr' ? 'Trophy' : s.type === 'ps4' ? 'PS4 Primary' : 'Non-Trophy';
    var plan = kind === 'buy' ? 'Permanent' : (Number(s.days) === 7 ? 'Weekly' : 'Monthly');
    var total = kind === 'priority' ? 100 : kind === 'line' ? 0 : (m.total != null ? m.total : m.rent + m.deposit);
    if (kind === 'buy') {
      total = parseInt(root.dataset[s.type === 'tr' ? 'buyTr' : 'buyNt'], 10) || 0;
    }
    var cover = root.dataset.cover ? '<img src="' + root.dataset.cover + '" alt="">' : '';
    $('ckSummary').innerHTML = cover +
      '<b>' + root.dataset.title + '</b>' +
      '<div>' + typeName + ' · ' + plan + '</div>' +
      '<div class="ck-lines"><span>' + (kind === 'priority' ? 'Priority fee' : 'Rental') + '</span><span>₱' + (kind === 'priority' ? 100 : (kind === 'buy' ? total : m.rent)) + '</span></div>' +
      (kind === 'rent' ? '<div class="ck-lines"><span>Refundable deposit</span><span>₱' + m.deposit + '</span></div>' : '') +
      '<div class="ck-lines ck-total"><span>Total to send</span><span>₱' + total + '</span></div>';
    $('ckTitle').textContent = kind === 'line' ? 'Join the line' : 'Confirm reservation';
    return total;
  }

  function startClock(iso) {
    clearInterval(tick);
    var hold = $('ckHold');
    if (!iso) { hold.hidden = true; return; }
    hold.hidden = false;
    function frame() {
      var left = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000));
      var mm = String(Math.floor(left / 60)).padStart(2, '0');
      var ss = String(left % 60).padStart(2, '0');
      $('ckClock').textContent = mm + ':' + ss;
      if (left <= 0) {
        clearInterval(tick);
        expire();
      }
    }
    frame();
    tick = setInterval(frame, 1000);
  }

  function expire() {
    if (session) {
      fetch('/api/checkout/' + session.ref + '/release', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ k: session.k })
      }).catch(function () {});
    }
    closeLight();
    show('ckChoices', false); show('ckMethods', false); show('ckPayBox', false); show('ckNameWrap', false);
    $('ckDone').hidden = false;
    $('ckDone').innerHTML = '<h3>Hold expired</h3><p>The 15-minute hold ended, so this slot was released. You can start again from the game page if it is still open.</p><button type="button" class="ck-go" onclick="checkoutClose()">Start again</button>';
    $('ckTitle').textContent = 'Hold expired';
  }

  function openModal(kind) {
    if (kind === 'buy') {
      var buyField = document.getElementById('buyOrderType') || document.getElementById('udBuyOrderType');
      if (!buyField || !buyField.value) {
        var note = document.getElementById('buyValidationMsg') || document.getElementById('udBuyValidationMsg');
        if (note) { note.textContent = 'Pick Non-Trophy or Trophy first.'; note.style.display = 'block'; }
        return;
      }
    }
    err('');
    file = null;
    clearFileUi();
    closeLight();
    session = null;
    $('ckDone').hidden = true;
    $('ckDone').innerHTML = '';
    $('ckSummary').hidden = false;
    show('ckMethods', false);
    show('ckPayBox', false);
    show('ckNameWrap', true);
    show('ckChoices', true);
    var free = kind === 'line';
    $('ckPay').hidden = true;
    $('ckMsg').hidden = free;
    $('ckJoin').hidden = !free;
    show('ckHold', !free);
    root.dataset.kind = kind;
    paintSummary(kind);
    root.hidden = false;
    if (free) return;
    var s = selection();
    fetch('/api/checkout/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_id: root.dataset.gameId,
        account_type: s.type,
        days: s.days,
        kind: kind,
        upcoming: upcoming,
        promo_code: s.code,
        client_token: (document.querySelector('[name=client_token]') || {}).value || ''
      })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { err(res.j.error || 'Could not hold that slot.'); return; }
        session = res.j;
        session.methods = realMethods();
        $('ckPay').hidden = session.methods.length === 0;
        if (res.j.summary) {
          var s = res.j.summary;
          var cover = s.cover ? '<img src="' + s.cover + '" alt="">' : '';
          var lines = (s.lines || []).map(function (line) {
            return '<div class="ck-lines"><span>' + line.label + '</span><span>₱' + line.amount + '</span></div>';
          }).join('');
          $('ckSummary').innerHTML = cover + '<b>' + s.title + '</b><div>' + s.typeName + ' · ' + s.plan + '</div>' + lines +
            '<div class="ck-lines ck-total"><span>Total to send</span><span>₱' + s.total + '</span></div>';
        }
        startClock(res.j.hold_expires_at);
      }).catch(function () { err('Could not hold that slot.'); });
  }

  window.checkoutOpen = openModal;
  window.checkoutClose = function () { closeLight(); root.hidden = true; clearInterval(tick); };

  function realMethods() {
    return (session && session.methods || []).filter(function (m) {
      return m && !m.example && (m.account_number || m.qr_image);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function clearFileUi() {
    file = null;
    var input = $('ckFile');
    if (input) input.value = '';
    if ($('ckDropEmpty')) $('ckDropEmpty').hidden = false;
    if ($('ckPreview')) { $('ckPreview').hidden = true; $('ckPreview').innerHTML = ''; }
    if ($('ckSubmit')) $('ckSubmit').disabled = true;
    if ($('ckSubmitNote')) $('ckSubmitNote').hidden = false;
  }

  function renderMethods(methods) {
    $('ckMethods').hidden = false;
    show('ckChoices', false);
    $('ckMethods').innerHTML = '<button type="button" class="ck-back" onclick="checkoutBack()">Back to choices</button>' +
      methods.map(function (m) {
        return '<button type="button" class="ck-method" data-key="' + esc(m.key) + '"><b>' + esc(m.label) + '</b><span>' + esc(m.hint) + '</span></button>';
      }).join('');
    $('ckMethods').querySelectorAll('.ck-method').forEach(function (btn) {
      btn.addEventListener('click', function () { showMethod(btn.dataset.key); });
    });
  }

  window.checkoutPay = function () {
    if (!session) { err('Still holding the slot…'); return; }
    var name = $('ckName').value.trim();
    if (name.length < 2) { err('Enter your Facebook name.'); return; }
    var methods = realMethods();
    if (!methods.length) return;
    err('');
    closeLight();
    renderMethods(methods);
  };

  window.checkoutBack = function () {
    closeLight();
    show('ckMethods', false); show('ckPayBox', false); show('ckChoices', true);
    $('ckSummary').hidden = false;
    show('ckNameWrap', true);
    $('ckTitle').textContent = root.dataset.kind === 'line' ? 'Join the line' : 'Confirm reservation';
  };

  window.checkoutChangeMethod = function () {
    if (!session) return;
    closeLight();
    show('ckPayBox', false);
    show('ckNameWrap', false);
    $('ckSummary').hidden = true;
    $('ckTitle').textContent = 'Pay on the website';
    err('');
    renderMethods(realMethods());
  };

  function copyValue(text, btn) {
    function done() {
      btn.textContent = 'Copied';
      btn.classList.add('is-copied');
      setTimeout(function () {
        btn.textContent = 'Copy';
        btn.classList.remove('is-copied');
      }, 1400);
    }
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      area.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
  }

  function closeLight() {
    if ($('ckLight')) $('ckLight').hidden = true;
  }

  function openLight() {
    var m = (session.methods || []).filter(function (x) { return x.key === session.method; })[0];
    if (!m || !m.qr_image) return;
    $('ckLightImg').src = m.qr_image;
    $('ckLightImg').alt = m.label + ' QR';
    $('ckLightName').textContent = m.label + ' QR';
    $('ckLightMeta').textContent = [m.account_name, m.account_number].filter(Boolean).join(' · ');
    $('ckLightHint').textContent = 'Screenshot or save this QR, then open ' + m.label + ' → Scan.';
    $('ckLight').hidden = false;
  }

  function downloadQr() {
    var m = (session && session.methods || []).filter(function (x) { return x.key === session.method; })[0];
    if (!m || !m.qr_image) return;
    var name = m.label.replace(/\s+/g, '-').toLowerCase() + '-qr';
    fetch(m.qr_image).then(function (r) { return r.blob(); }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }).catch(function () { window.open(m.qr_image, '_blank'); });
  }

  function showMethod(key) {
    var m = (session.methods || []).filter(function (x) { return x.key === key; })[0];
    if (!m) return;
    session.method = key;
    show('ckMethods', false);
    show('ckPayBox', true);
    show('ckNameWrap', false);
    $('ckSummary').hidden = true;
    $('ckTitle').textContent = 'Pay with ' + m.label;
    var total = (session.summary && session.summary.total) || 0;
    var rows = '<div class="ck-meta-row"><span>Ref</span><b>' + esc(session.ref) + '</b><button type="button" class="ck-copy" data-copy="' + esc(session.ref) + '">Copy</button></div>';
    if (m.account_name) {
      rows += '<div class="ck-meta-row"><span>Account</span><b>' + esc(m.account_name) + '</b><span></span></div>';
    }
    if (m.account_number) {
      rows += '<div class="ck-meta-row"><span>Number</span><b>' + esc(m.account_number) + '</b><button type="button" class="ck-copy" data-copy="' + esc(m.account_number) + '">Copy</button></div>';
    }
    var qr = '';
    if (m.qr_image) {
      qr = '<div class="ck-qr-card"><button type="button" class="ck-qr-hit" id="ckQrOpen"><img src="' + esc(m.qr_image) + '" alt="' + esc(m.label) + ' QR"></button><button type="button" class="ck-enlarge" id="ckEnlarge">Tap to enlarge</button></div>';
    }
    $('ckPayDetail').innerHTML = '<div class="ck-pay-amt">₱' + esc(total) + '</div>' +
      '<div class="ck-meta">' + rows + '</div>' + qr;
    $('ckSubmit').textContent = 'Submit payment — ₱' + total;
    $('ckSubmit').disabled = !file;
    if ($('ckSubmitNote')) $('ckSubmitNote').hidden = !!file;
  }

  function takeFile(next) {
    var box = $('ckPreview');
    if (!next || !/^image\//.test(next.type || '')) {
      file = null;
      if (box) box.hidden = true;
      if ($('ckDropEmpty')) $('ckDropEmpty').hidden = false;
      $('ckSubmit').disabled = true;
      if ($('ckSubmitNote')) $('ckSubmitNote').hidden = false;
      err('Upload an image.');
      return;
    }
    if (next.size > 8 * 1024 * 1024) {
      file = null;
      $('ckSubmit').disabled = true;
      if ($('ckSubmitNote')) $('ckSubmitNote').hidden = false;
      err('That image is over 8 MB.');
      return;
    }
    err('');
    file = next;
    $('ckDropEmpty').hidden = true;
    box.hidden = false;
    box.innerHTML = '<img alt="" src="' + URL.createObjectURL(next) + '"><b>' + esc(next.name) + '</b><span class="ck-replace">Replace</span>';
    $('ckSubmit').disabled = false;
    $('ckSubmitNote').hidden = true;
  }

  $('ckFile').addEventListener('change', function () {
    takeFile($('ckFile').files && $('ckFile').files[0]);
  });
  var drop = $('ckDrop');
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    drop.classList.remove('is-over');
    var dropped = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (dropped) takeFile(dropped);
  });
  $('ckPayBox').addEventListener('click', function (e) {
    var copyBtn = e.target.closest && e.target.closest('.ck-copy');
    if (copyBtn) { e.preventDefault(); e.stopPropagation(); copyValue(copyBtn.getAttribute('data-copy') || '', copyBtn); return; }
    if (e.target.closest && e.target.closest('#ckQrOpen, #ckEnlarge')) openLight();
  });
  $('ckLight').addEventListener('click', function (e) {
    if (e.target === $('ckLight')) closeLight();
  });
  $('ckLightCard').addEventListener('click', function (e) { e.stopPropagation(); });
  $('ckLightX').addEventListener('click', closeLight);
  $('ckLightDl').addEventListener('click', downloadQr);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('ckLight') && !$('ckLight').hidden) closeLight();
  });

  window.checkoutSubmit = function () {
    if (!session || !file) return;
    var name = $('ckName').value.trim();
    var body = new FormData();
    body.append('k', session.k);
    body.append('fb_name', name);
    body.append('method', session.method || '');
    body.append('proof', file);
    fetch('/api/checkout/' + session.ref + '/proof', { method: 'POST', body: body })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { err(res.j.error || 'Could not submit.'); return; }
        clearInterval(tick);
        closeLight();
        show('ckPayBox', false); show('ckHold', false); show('ckNameWrap', false);
        $('ckDone').hidden = false;
        $('ckDone').innerHTML = '<h3>Payment submitted</h3><p>We will confirm on Messenger. Your ref is <b>' + session.ref + '</b>.</p><a class="ck-go" href="http://m.me/PlaystationHub00" target="_blank" rel="noopener">Open Messenger</a>';
      }).catch(function () { err('Could not submit.'); });
  };

  window.checkoutMessenger = function () {
    if (!session) return;
    var name = $('ckName').value.trim();
    fetch('/api/checkout/' + session.ref + '/messenger', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: session.k, fb_name: name })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { err(res.j.error || 'Enter your Facebook name.'); return; }
        closeLight();
        show('ckChoices', false); show('ckMethods', false); show('ckPayBox', false); show('ckNameWrap', false); show('ckHold', false);
        $('ckSummary').hidden = true;
        var prefill = '';
        try { prefill = decodeURIComponent(String(res.j.href).split('text=')[1] || ''); } catch (e) { prefill = ''; }
        $('ckDone').hidden = false;
        $('ckDone').innerHTML = '<h3>Reservation saved</h3><p>Your order is on the site. Ref <b>' + res.j.ref + '</b>. The slot stays held for 15 minutes.</p><p class="ck-example">Messenger opens with this message</p><pre class="ck-prefill">' + prefill.replace(/[&<>]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]); }) + '</pre><a class="ck-go" id="ckOpenMsg" href="' + res.j.href + '" target="_blank" rel="noopener">Open Messenger</a>';
      }).catch(function () { err('Could not save the reservation.'); });
  };

  window.checkoutJoin = function () {
    var name = $('ckName').value.trim();
    if (name.length < 2) { err('Enter your Facebook name.'); return; }
    var s = selection();
    fetch('/api/checkout/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_id: root.dataset.gameId, account_type: s.type, days: s.days,
        kind: 'line', upcoming: upcoming, fb_name: name
      })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { err(res.j.error || 'Could not join the line.'); return; }
        show('ckChoices', false); show('ckNameWrap', false);
        $('ckDone').hidden = false;
        $('ckDone').innerHTML = '<h3>You are in line</h3><p>Free · ₱0 due today. Ref <b>' + res.j.ref + '</b>. We will message you when a Non-Trophy or Trophy slot opens.</p>';
      }).catch(function () { err('Could not join the line.'); });
  };

  document.querySelectorAll('.bp-card .gd-line-card form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!document.querySelector('.gd-dur-btn.active')) return;
      var kind = (form.querySelector('[name=kind]') || {}).value === 'queue' ? 'line' : 'priority';
      openModal(kind);
    }, true);
  });
})();
