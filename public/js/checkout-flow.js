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
    session = null;
    $('ckDone').hidden = true;
    $('ckDone').innerHTML = '';
    $('ckSummary').hidden = false;
    show('ckMethods', false);
    show('ckPayBox', false);
    show('ckNameWrap', true);
    show('ckChoices', true);
    var free = kind === 'line';
    $('ckPay').hidden = free;
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
  window.checkoutClose = function () { root.hidden = true; clearInterval(tick); };

  window.checkoutPay = function () {
    if (!session) { err('Still holding the slot…'); return; }
    var name = $('ckName').value.trim();
    if (name.length < 2) { err('Enter your Facebook name.'); return; }
    err('');
    var methods = (session.methods || []);
    $('ckMethods').hidden = false;
    show('ckChoices', false);
    $('ckMethods').innerHTML = '<button type="button" class="ck-back" onclick="checkoutBack()">Back to choices</button>' +
      methods.map(function (m) {
        return '<button type="button" class="ck-method' + (m.example ? ' is-example' : '') + '" data-key="' + m.key + '"><b>' + m.label + '</b><span>' + m.hint + (m.example ? ' · EXAMPLE' : '') + '</span></button>';
      }).join('');
    $('ckMethods').querySelectorAll('.ck-method').forEach(function (btn) {
      btn.addEventListener('click', function () { showMethod(btn.dataset.key); });
    });
  };

  window.checkoutBack = function () {
    show('ckMethods', false); show('ckPayBox', false); show('ckChoices', true);
    $('ckSummary').hidden = false;
  };

  function showMethod(key) {
    var m = (session.methods || []).filter(function (x) { return x.key === key; })[0];
    if (!m) return;
    session.method = key;
    show('ckMethods', false);
    show('ckPayBox', true);
    $('ckSummary').hidden = true;
    var qr = m.qr_image
      ? '<img class="ck-qr" src="' + m.qr_image + '" alt="">'
      : '<div class="ck-qr ck-qr-example">EXAMPLE<br>Not a real QR</div>';
    $('ckPayDetail').innerHTML = '<b>Pay with ' + m.label + '</b>' +
      (m.example ? '<p class="ck-example">Example details. Add the real account in Admin → Payment methods, or set PAYMENT_' + key.toUpperCase() + '_NUMBER.</p>' : '') +
      '<div class="ck-amt">₱' + ((session.summary && session.summary.total) || '') + '</div>' +
      '<div>Ref ' + session.ref + '</div>' +
      '<div>' + (m.account_name || '') + '</div>' +
      '<div>' + (m.account_number || '') + '</div>' + qr;
    $('ckSubmit').textContent = 'Submit payment — ₱' + ((session.summary && session.summary.total) || '');
    $('ckSubmit').disabled = !file;
  }

  $('ckFile').addEventListener('change', function () {
    file = $('ckFile').files && $('ckFile').files[0];
    var box = $('ckPreview');
    if (!file || !/^image\//.test(file.type)) { file = null; box.hidden = true; $('ckSubmit').disabled = true; err('Upload an image.'); return; }
    if (file.size > 8 * 1024 * 1024) { file = null; $('ckSubmit').disabled = true; err('That image is over 8 MB.'); return; }
    err('');
    box.hidden = false;
    box.innerHTML = '<img alt="" src="' + URL.createObjectURL(file) + '"><div>' + file.name + ' · EXAMPLE if this is a test</div><button type="button" onclick="document.getElementById(\'ckFile\').click()">Replace file</button>';
    $('ckSubmit').disabled = false;
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
        show('ckChoices', false); show('ckNameWrap', false); show('ckHold', false);
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
