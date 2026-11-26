(function () {
  var KEY = 'ph-basket';
  var linesEl = document.getElementById('basketLines');
  var panel = document.getElementById('basketPanel');
  if (!linesEl || !panel) return;

  var quote = null;
  var applied = '';

  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(function (row) {
        return row && row.id != null && (row.type === 'nt' || row.type === 'tr' || row.type === 'ps4');
      }).slice(0, 8) : [];
    } catch (e) { return []; }
  }
  function write(rows) {
    localStorage.setItem(KEY, JSON.stringify(rows));
    paintAdded();
    paintCount();
  }
  function peso(label) { return '₱' + (label == null ? '0' : label); }

  function paintCount() {
    var n = read().length;
    var badge = document.getElementById('navBasketCount');
    if (badge) {
      badge.textContent = String(n);
      badge.hidden = n < 1;
    }
    var line = document.getElementById('basketCountLine');
    if (line) line.textContent = n + (n === 1 ? ' game' : ' games') + ' · mix Weekly and Monthly as you like';
    var btn = document.getElementById('navBasketToggle');
    if (btn) btn.setAttribute('aria-label', n ? ('Basket, ' + n + (n === 1 ? ' game' : ' games')) : 'Basket');
  }

  function paintAdded() {
    var ids = {};
    read().forEach(function (row) { ids[String(row.id)] = true; });
    document.querySelectorAll('.basket-add').forEach(function (btn) {
      var on = !!ids[String(btn.getAttribute('data-basket-id'))];
      btn.classList.toggle('is-in', on);
      btn.textContent = on ? 'Added' : 'Add to basket';
    });
  }

  function openPanel() {
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    var scrim = document.getElementById('basketScrim');
    if (scrim) scrim.hidden = false;
    var btn = document.getElementById('navBasketToggle');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    refresh();
  }
  function closePanel() {
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    var scrim = document.getElementById('basketScrim');
    if (scrim) scrim.hidden = true;
    var btn = document.getElementById('navBasketToggle');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function typeButtons(line) {
    var types = [
      { id: 'nt', label: 'Non-Trophy' },
      { id: 'tr', label: 'Trophy' },
      { id: 'ps4', label: 'PS4 Primary' }
    ];
    var offered = (line && line.offered) || [line.account_type];
    return types.filter(function (t) { return offered.indexOf(t.id) !== -1; }).map(function (t) {
      return '<button type="button" class="basket-seg' + (t.id === line.account_type ? ' on' : '') + '" data-act="type" data-type="' + t.id + '">' + t.label + '</button>';
    }).join('');
  }

  function render(data) {
    var rows = read();
    var foot = document.getElementById('basketFoot');
    if (!rows.length) {
      linesEl.innerHTML = '<p class="basket-empty">Your basket is empty. Add a game that still has a free slot.</p>';
      if (foot) foot.hidden = true;
      return;
    }
    if (foot) foot.hidden = false;
    var byId = {};
    ((data && data.lines) || []).forEach(function (line) { byId[String(line.game_id)] = line; });
    linesEl.innerHTML = rows.map(function (row, index) {
      var line = byId[String(row.id)] || {
        game_id: row.id, game_title: 'Game', account_type: row.type, days: row.days, price: null, offered: [row.type]
      };
      var cover = line.cover
        ? '<img class="basket-cover" src="' + String(line.cover).replace(/"/g, '') + '" alt="">'
        : '<div class="basket-cover ph">No cover</div>';
      var price = line.price == null ? '…' : ('₱' + (data.labels && line.price % 1 ? Number(line.price).toFixed(2) : line.price));
      return '<article class="basket-line" data-i="' + index + '">' +
        cover +
        '<div><h3>' + escapeHtml(line.game_title || 'Game') + '</h3>' +
        '<p>' + escapeHtml(line.type_name || '') + (line.plan ? ' · ' + escapeHtml(line.plan) : '') + '</p>' +
        '<div class="basket-segs">' + typeButtons(line) +
          '<button type="button" class="basket-seg' + (Number(line.days) === 7 ? ' on' : '') + '" data-act="days" data-days="7">Weekly</button>' +
          '<button type="button" class="basket-seg' + (Number(line.days) === 30 ? ' on' : '') + '" data-act="days" data-days="30">Monthly</button>' +
        '</div>' +
        '<div class="basket-price">' + price + '</div></div>' +
        '<button type="button" class="basket-remove" data-act="remove" aria-label="Remove">×</button></article>';
    }).join('');
    var labels = (data && data.labels) || {};
    document.getElementById('basketSubtotal').textContent = peso(labels.subtotal || '0');
    document.getElementById('basketDeposit').textContent = peso(labels.deposit || '0');
    document.getElementById('basketTotal').textContent = peso(labels.total || '0');
    var note = document.getElementById('basketDepositNote');
    if (note) {
      note.textContent = (data && data.deposit) > 0
        ? 'A refundable deposit applies to each Trophy or PS4 Primary line. Each game is priced on its own. No bundle discount.'
        : 'Each game is priced on its own. No bundle discount.';
    }
    var err = document.getElementById('basketLiveErr');
    if (data && data.ok === false) {
      if (!err) {
        err = document.createElement('p');
        err.id = 'basketLiveErr';
        err.className = 'basket-err';
        linesEl.parentNode.insertBefore(err, foot);
      }
      err.textContent = data.message || 'Check the basket and try again.';
    } else if (err) err.textContent = '';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function payload(code) {
    return {
      lines: read().map(function (row) {
        return { game_id: row.id, account_type: row.type, days: Number(row.days) === 30 ? 30 : 7 };
      }),
      code: code || '',
      fb_name: localStorage.getItem('ph-buyer') || ''
    };
  }

  function refresh() {
    var rows = read();
    if (!rows.length) { quote = null; render({ ok: true, lines: [], labels: {} }); return Promise.resolve(); }
    return fetch('/api/basket/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload(''))
    }).then(function (res) { return res.json();     }).then(function (data) {
      quote = data;
      render(data);
    }).catch(function () {
      render({ ok: false, message: 'The basket could not be priced just now.', lines: [] });
    });
  }

  function addFrom(btn) {
    var id = btn.getAttribute('data-basket-id');
    var rows = read();
    if (rows.some(function (row) { return String(row.id) === String(id); })) {
      openPanel();
      return;
    }
    rows.push({
      id: /^\d+$/.test(String(id)) ? Number(id) : id,
      type: btn.getAttribute('data-basket-type') || 'nt',
      days: Number(btn.getAttribute('data-basket-days')) === 30 ? 30 : 7
    });
    write(rows);
    openPanel();
  }

  document.addEventListener('click', function (e) {
    var add = e.target.closest && e.target.closest('.basket-add');
    if (add) {
      e.preventDefault();
      e.stopPropagation();
      addFrom(add);
    }
  }, true);

  var toggle = document.getElementById('navBasketToggle');
  if (toggle) toggle.addEventListener('click', function () {
    if (panel.hidden) openPanel(); else closePanel();
  });
  var close = document.getElementById('basketClose');
  if (close) close.addEventListener('click', closePanel);
  var scrim = document.getElementById('basketScrim');
  if (scrim) scrim.addEventListener('click', function () { closePanel(); closeVoucher(); });

  linesEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var card = btn.closest('.basket-line');
    var index = card ? Number(card.getAttribute('data-i')) : -1;
    var rows = read();
    var row = rows[index];
    if (!row) return;
    if (btn.getAttribute('data-act') === 'remove') rows.splice(index, 1);
    if (btn.getAttribute('data-act') === 'type') row.type = btn.getAttribute('data-type');
    if (btn.getAttribute('data-act') === 'days') row.days = Number(btn.getAttribute('data-days'));
    applied = '';
    write(rows);
    refresh();
  });

  function openVoucher() {
    var modal = document.getElementById('voucherModal');
    if (!modal) return;
    modal.hidden = false;
    paintVoucher(quote, applied ? 'ok' : '');
  }
  function closeVoucher() {
    var modal = document.getElementById('voucherModal');
    if (modal) modal.hidden = true;
  }
  function paintVoucher(data, state) {
    var ok = document.getElementById('voucherOk');
    var err = document.getElementById('voucherErr');
    var sum = document.getElementById('voucherSummary');
    if (ok) { ok.hidden = state !== 'ok'; ok.textContent = (data && data.note) || ''; }
    if (err) {
      err.hidden = state !== 'err';
      if (state === 'err' && data && data.message && data.message !== 'Code not valid') {
        err.querySelector('b').textContent = data.message;
      } else if (err.querySelector('b')) err.querySelector('b').textContent = 'Code not valid';
    }
    if (!sum) return;
    var labels = (data && data.labels) || {};
    var rows = (data && data.lines) || [];
    sum.innerHTML = rows.map(function (line) {
      return '<div class="voucher-sum-row"><span>' + escapeHtml(line.game_title) + ' · ' + escapeHtml(line.type_name || '') + ' · ' + escapeHtml(line.plan || '') + '</span><span>₱' + line.price + '</span></div>';
    }).join('') +
      (data && data.discount ? '<div class="voucher-sum-row voucher-off"><span>' + escapeHtml(data.code || 'Code') + '</span><span>−₱' + labels.discount + '</span></div>' : '') +
      '<div class="voucher-sum-row"><span>Refundable deposit</span><span>₱' + (labels.deposit || '0') + '</span></div>' +
      '<div class="voucher-sum-row voucher-sum-total"><span>Total to send</span><b>₱' + (labels.total || '0') + '</b></div>';
  }

  var checkout = document.getElementById('basketCheckout');
  if (checkout) checkout.addEventListener('click', function () {
    refresh().then(openVoucher);
  });
  var voucherForm = document.getElementById('voucherForm');
  if (voucherForm) voucherForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = (document.getElementById('voucherCode').value || '').trim();
    fetch('/api/basket/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload(code))
    }).then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
      .then(function (pack) {
        if (pack.data && pack.data.ok) {
          applied = pack.data.code || code;
          quote = pack.data;
          paintVoucher(pack.data, 'ok');
        } else {
          applied = '';
          paintVoucher(pack.data || quote, 'err');
        }
      }).catch(function () { paintVoucher(quote, 'err'); });
  });

  function pay(withCode) {
    var body = payload(withCode ? applied : '');
    fetch('/api/basket/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (data && data.href) {
        write([]);
        window.location.href = data.href;
        return;
      }
      paintVoucher(data, 'err');
    }).catch(function () { paintVoucher(quote, 'err'); });
  }
  var go = document.getElementById('voucherContinue');
  if (go) go.addEventListener('click', function () { pay(true); });
  var skip = document.getElementById('voucherSkip');
  if (skip) skip.addEventListener('click', function () { applied = ''; pay(false); });
  var vx = document.getElementById('voucherClose');
  if (vx) vx.addEventListener('click', closeVoucher);

  paintAdded();
  paintCount();
})();
