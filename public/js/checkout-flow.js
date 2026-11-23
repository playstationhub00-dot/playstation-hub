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

  function customerName() {
    var line = $('ckLineName');
    if (line && $('ckLine') && !$('ckLine').hidden && line.value.trim()) return line.value.trim();
    return ($('ckName') && $('ckName').value.trim()) || '';
  }

  function typeNameOf(type) {
    return type === 'tr' ? 'Trophy' : type === 'ps4' ? 'PS4 Primary' : 'Non-Trophy';
  }

  function rentLater(type, days) {
    if (typeof PRICES === 'undefined' || !PRICES[type] || !PRICES[type][days]) return 0;
    var base = PRICES[type][days];
    var pct = typeof promoPctFor === 'function' ? promoPctFor(days) : 0;
    return pct > 0 ? base - Math.round(base * pct / 100) : base;
  }

  function freesText(type) {
    var n = (typeof NEXT_DAYS !== 'undefined' && NEXT_DAYS) ? NEXT_DAYS[type] : null;
    if (!(n > 0)) return '';
    return typeNameOf(type) + ' frees up in about ' + n + ' day' + (n === 1 ? '' : 's');
  }

  function lineCounts() {
    var sfx = typeof visibleLineSuffix === 'function' ? visibleLineSuffix() : '';
    var free = document.getElementById('lineFreePos' + sfx);
    var pri = document.getElementById('linePriPos' + sfx);
    var head = document.getElementById('lineHead' + sfx);
    function num(el) {
      var m = el && String(el.textContent).match(/\d+/);
      return m ? parseInt(m[0], 10) : 1;
    }
    var waiting = 0;
    if (head) {
      var w = String(head.textContent).match(/(\d+)\s+(?:person|people)/);
      if (w) waiting = parseInt(w[1], 10);
    }
    return { free: num(free), priority: num(pri), waiting: waiting };
  }

  function syncPageType(type) {
    var radio = document.querySelector('input[name="rentalType"][value="' + type + '"], input[name="rental_type"][value="' + type + '"]');
    if (radio) { radio.checked = true; if (typeof onTypeChange === 'function') onTypeChange(radio); }
  }

  function syncPageDays(days) {
    var btn = document.querySelector('.gd-dur-btn[data-days="' + days + '"]');
    if (btn && typeof onDurChange === 'function') onDurChange(btn);
  }

  function paintLine(kind) {
    var s = selection();
    var counts = lineCounts();
    var pos = kind === 'priority' ? counts.priority : counts.free;
    var later = rentLater(s.type, s.days);
    var soon = freesText(s.type);
    $('ckTitle').textContent = kind === 'priority' ? 'Join the line — Priority' : 'Join the line';
    $('ckLineSub').textContent = kind === 'priority'
      ? '₱100 is taken off your rent later'
      : 'Free · wait your turn · nothing due today';
    $('ckLinePill').textContent = kind === 'priority'
      ? '₱100 is taken off your next rent'
      : 'No slot held · free line takes no slot';
    var cover = root.dataset.cover ? '<img src="' + esc(root.dataset.cover) + '" alt="">' : '';
    $('ckLineGame').innerHTML = cover + '<div><b>' + esc(root.dataset.title) + '</b><span>' +
      esc(typeNameOf(s.type)) + ' · ' + (Number(s.days) === 7 ? 'Weekly' : 'Monthly') + '</span></div>';
    var types = [{ v: 'tr', l: 'Trophy' }, { v: 'nt', l: 'Non-Trophy' }, { v: 'ps4', l: 'PS4 Primary' }]
      .filter(function (t) { return document.querySelector('input[name="rentalType"][value="' + t.v + '"], input[name="rental_type"][value="' + t.v + '"]'); });
    $('ckLineTypes').innerHTML = types.map(function (t) {
      return '<button type="button" class="ck-seg-btn' + (t.v === s.type ? ' on' : '') + '" data-type="' + t.v + '">' + t.l + '</button>';
    }).join('');
    $('ckLinePlans').innerHTML = [7, 30].map(function (d) {
      return '<button type="button" class="ck-seg-btn' + (Number(s.days) === d ? ' on' : '') + '" data-days="' + d + '">' + (d === 7 ? 'Weekly' : 'Monthly') + '</button>';
    }).join('');
    var wait = counts.waiting === 0 ? 'You would be first' : counts.waiting === 1 ? '1 person is waiting' : counts.waiting + ' people are waiting';
    $('ckLinePlace').innerHTML = '<b>' + (kind === 'priority' ? "You'll go first (#" + pos + ')' : "You'll be #" + pos + ' in line') + '</b>' +
      '<span>' + esc([soon, kind === 'priority' ? 'Priority is taken off your rent' : wait].filter(Boolean).join(' · ')) + '</span>';
    if (kind === 'priority') {
      $('ckLineFees').hidden = false;
      $('ckLineFees').innerHTML =
        '<div class="ck-lines"><span>Priority fee · go first in line</span><span>₱100</span></div>' +
        '<div class="ck-lines"><span>Rent when your slot opens</span><span>₱' + later + ' later</span></div>' +
        '<div class="ck-lines ck-total"><span>Total to send</span><span>₱100</span></div>' +
        '<p class="ck-line-off">Taken off your rent when you start playing.</p>';
      $('ckLineNoteWrap').hidden = true;
      $('ckLineGo').hidden = true;
      $('ckLineChoices').hidden = false;
      $('ckLineChoices').innerHTML =
        '<button type="button" class="ck-choice" id="ckLinePay"><b>Pay on the website</b><span>GCash, Maya, QR Ph, PayPal or bank transfer. Then upload a screenshot.</span></button>' +
        '<button type="button" class="ck-choice" id="ckLineMsg"><b>Message us on Messenger</b><span>We save the reservation first, then open Messenger.</span></button>';
      $('ckLineFoot').textContent = '';
    } else {
      $('ckLineFees').hidden = true;
      $('ckLineNoteWrap').hidden = false;
      $('ckLineGo').hidden = false;
      $('ckLineGo').textContent = 'Join the line';
      $('ckLineChoices').hidden = false;
      $('ckLineChoices').innerHTML = '<button type="button" class="ck-instead" id="ckLineInstead">Message us on Messenger instead</button>';
      $('ckLineFoot').textContent = 'We message you on Messenger when your slot opens. Free, no deposit until then.';
    }
    $('ckLineTypes').querySelectorAll('[data-type]').forEach(function (btn) {
      btn.addEventListener('click', function () { syncPageType(btn.dataset.type); paintLine(kind); });
    });
    $('ckLinePlans').querySelectorAll('[data-days]').forEach(function (btn) {
      btn.addEventListener('click', function () { syncPageDays(btn.dataset.days); paintLine(kind); });
    });
    var pay = $('ckLinePay');
    if (pay) pay.addEventListener('click', function () { beginPriority('pay'); });
    var msg = $('ckLineMsg');
    if (msg) msg.addEventListener('click', function () { beginPriority('msg'); });
    var instead = document.getElementById('ckLineInstead');
    if (instead) instead.addEventListener('click', lineMessengerInstead);
    show('ckLine', true);
    show('ckSummary', false);
    show('ckNameWrap', false);
    show('ckChoices', false);
    show('ckHold', false);
  }

  function lineSuccess(info, href) {
    var pos = (info && info.position) || lineCounts().free;
    var s = selection();
    var n = (typeof NEXT_DAYS !== 'undefined' && NEXT_DAYS) ? NEXT_DAYS[s.type] : null;
    var when = n > 0 ? ' (about ' + n + ' day' + (n === 1 ? '' : 's') + ')' : '';
    var free = root.dataset.kind !== 'priority';
    var steps = free
      ? [
        "We keep your place — you're #" + pos + ' in line.',
        'When the ' + typeNameOf(s.type) + ' slot frees up' + when + ', we message you on Messenger.',
        'You pay the rent then. Free to wait — no deposit until your slot opens.'
      ]
      : [
        "We keep your place — you'd go first (#" + pos + ') once the ₱100 is saved.',
        'The ₱100 comes off the rent when your slot opens.',
        'No slot is held, and there is no deposit until then.'
      ];
    show('ckLine', false);
    show('ckChoices', false);
    show('ckMethods', false);
    show('ckPayBox', false);
    show('ckNameWrap', false);
    show('ckHold', false);
    show('ckSummary', false);
    $('ckTitle').textContent = "You're in line";
    $('ckDone').hidden = false;
    var msg = href
      ? '<a class="ck-go ck-line-msg" href="' + esc(href) + '" target="_blank" rel="noopener">Message us on Messenger</a>'
      : '<a class="ck-go ck-line-msg" href="http://m.me/PlaystationHub00?text=' + encodeURIComponent('Hi! I joined the line. Ref ' + ((info && info.ref) || '')) + '" target="_blank" rel="noopener">Message us on Messenger</a>';
    $('ckDone').innerHTML = '<div class="ck-line-ok">✓</div><h3>You\'re in line! #' + pos + '</h3>' +
      '<div class="ck-line-ref">' + esc((info && info.ref) || '') + '</div>' +
      '<p class="ck-line-next">What happens next</p><ul class="ck-line-steps">' +
      steps.map(function (step) { return '<li>' + esc(step) + '</li>'; }).join('') +
      '</ul>' + msg +
      '<button type="button" class="ck-line-done" onclick="checkoutClose()">Done</button>';
  }

  function lineMessengerInstead() {
    var s = selection();
    var text = 'Hi! I want to join the line for ' + (root.dataset.title || 'a game') + ' (' + typeNameOf(s.type) + ', ' + (Number(s.days) === 7 ? 'Weekly' : 'Monthly') + ').';
    window.open('http://m.me/PlaystationHub00?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  function beginPriority(next) {
    var name = customerName();
    if (name.length < 2) { err('Enter your Facebook name.'); return; }
    err('');
    if ($('ckName')) $('ckName').value = name;
    var s = selection();
    fetch('/api/checkout/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_id: root.dataset.gameId, account_type: s.type, days: s.days,
        kind: 'priority', upcoming: upcoming, fb_name: name,
        note: ($('ckLineNote') && $('ckLineNote').value) || '',
        client_token: (document.querySelector('[name=client_token]') || {}).value || ''
      })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { err(res.j.error || 'Could not save your place.'); return; }
        session = res.j;
        session.methods = realMethods();
        session.line = res.j.line;
        show('ckLine', false);
        if (next === 'msg') window.checkoutMessenger();
        else if (!session.methods.length) {
          err('Pay on the website is not available right now. Message us on Messenger instead.');
          show('ckLine', true);
        } else window.checkoutPay();
      }).catch(function () { err('Could not save your place.'); });
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
    show('ckLine', false);
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
    root.hidden = false;
    if (kind === 'line' || kind === 'priority') {
      paintLine(kind);
      return;
    }
    paintSummary(kind);
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
    if (!session) { err('Still saving your place…'); return; }
    var name = customerName();
    if ($('ckName') && name) $('ckName').value = name;
    if (name.length < 2) { err('Enter your Facebook name.'); return; }
    var methods = realMethods();
    if (!methods.length) return;
    err('');
    closeLight();
    renderMethods(methods);
  };

  window.checkoutBack = function () {
    closeLight();
    show('ckMethods', false); show('ckPayBox', false);
    if (root.dataset.kind === 'line' || root.dataset.kind === 'priority') {
      paintLine(root.dataset.kind);
      return;
    }
    show('ckChoices', true);
    $('ckSummary').hidden = false;
    show('ckNameWrap', true);
    $('ckTitle').textContent = 'Confirm reservation';
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
    if ($('ckHoldNote')) $('ckHoldNote').hidden = !(session && session.hold_expires_at);
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
        if (session.line) {
          lineSuccess({ position: session.line.position, ref: session.ref }, 'http://m.me/PlaystationHub00?text=' + encodeURIComponent('Hi! I sent the priority fee. Ref ' + session.ref));
          return;
        }
        show('ckPayBox', false); show('ckHold', false); show('ckNameWrap', false);
        $('ckDone').hidden = false;
        $('ckDone').innerHTML = '<h3>Payment submitted</h3><p>We will confirm on Messenger. Your ref is <b>' + session.ref + '</b>.</p><a class="ck-go" href="http://m.me/PlaystationHub00" target="_blank" rel="noopener">Open Messenger</a>';
      }).catch(function () { err('Could not submit.'); });
  };

  window.checkoutMessenger = function () {
    if (!session) return;
    var name = customerName();
    fetch('/api/checkout/' + session.ref + '/messenger', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: session.k, fb_name: name, note: ($('ckLineNote') && $('ckLineNote').value) || '' })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { err(res.j.error || 'Enter your Facebook name.'); return; }
        closeLight();
        if (session.line) {
          lineSuccess({ position: session.line.position, ref: res.j.ref }, res.j.href);
          return;
        }
        show('ckChoices', false); show('ckMethods', false); show('ckPayBox', false); show('ckNameWrap', false); show('ckHold', false);
        $('ckSummary').hidden = true;
        var prefill = '';
        try { prefill = decodeURIComponent(String(res.j.href).split('text=')[1] || ''); } catch (e) { prefill = ''; }
        $('ckDone').hidden = false;
        $('ckDone').innerHTML = '<h3>Reservation saved</h3><p>Your order is on the site. Ref <b>' + res.j.ref + '</b>. The slot stays held for 15 minutes.</p><p class="ck-example">Messenger opens with this message</p><pre class="ck-prefill">' + prefill.replace(/[&<>]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]); }) + '</pre><a class="ck-go" id="ckOpenMsg" href="' + res.j.href + '" target="_blank" rel="noopener">Open Messenger</a>';
      }).catch(function () { err('Could not save the reservation.'); });
  };

  window.checkoutJoin = function () {
    var name = customerName();
    if (name.length < 2) { err('Enter your Facebook name.'); return; }
    var s = selection();
    fetch('/api/checkout/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_id: root.dataset.gameId, account_type: s.type, days: s.days,
        kind: 'line', upcoming: upcoming, fb_name: name,
        note: ($('ckLineNote') && $('ckLineNote').value) || ''
      })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { err(res.j.error || 'Could not join the line.'); return; }
        var href = 'http://m.me/PlaystationHub00?text=' + encodeURIComponent('Hi! I joined the line.\nLine ref: ' + res.j.ref + '\nFacebook name: ' + name);
        lineSuccess({ position: res.j.line && res.j.line.position, ref: res.j.ref }, href);
      }).catch(function () { err('Could not join the line.'); });
  };

  var lineGo = $('ckLineGo');
  if (lineGo) lineGo.addEventListener('click', function () { window.checkoutJoin(); });

  document.querySelectorAll('.bp-card .gd-line-card form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!document.querySelector('.gd-dur-btn.active')) return;
      var kind = (form.querySelector('[name=kind]') || {}).value === 'queue' ? 'line' : 'priority';
      openModal(kind);
    }, true);
  });
})();
