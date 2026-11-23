// Draws the homepage search (views/partials/home-search.ejs). Matching and
// status text live in home-search-core.js. The list is fetched once, on first
// focus, from the same /api/search-index the nav search uses.
(function () {
  var core = window.HomeSearchCore;
  var input = document.getElementById('hsInput');
  var box = document.getElementById('hsResults');
  var dim = document.getElementById('hsDim');
  if (!core || !input || !box || !dim) return;

  var index = null, failed = false, loading = false;
  var missTimer = null, lastMiss = '';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var waiters = [];
  function load(done) {
    if (index) { if (done) done(); return; }
    if (done) waiters.push(done);
    if (loading) return;
    loading = true;
    fetch('/api/search-index').then(function (r) { return r.json(); })
      .then(function (d) { index = Array.isArray(d) ? d : []; })
      .catch(function () { failed = true; })
      .then(function () {
        loading = false;
        var cbs = waiters.splice(0);
        cbs.forEach(function (fn) { try { fn(); } catch (err) {} });
      });
  }

  function open() { box.hidden = false; dim.hidden = false; }
  function close() { box.hidden = true; dim.hidden = true; }

  function face(e) {
    if (e.y === 'soon') return { cls: 'hs-soon', text: 'Coming soon · Reserve' };
    if (e.y === 'now' && e.s > 0) return { cls: 'hs-free', text: 'Available' };
    if (e.y === 'now' && e.s === 0) return { cls: 'hs-booked', text: 'Full' };
    var st = core.statusOf(e);
    return { cls: 'hs-' + st.kind, text: st.text };
  }

  function row(e) {
    var st = core.statusOf(e);
    var label = face(e);
    var a = el('a', 'hs-row' + (st.kind === 'booked' ? ' hs-row-booked' : ''));
    a.href = e.u;
    var img = el('img', 'hs-img');
    img.alt = e.t || '';
    if (e.img) img.src = e.img;
    img.loading = 'lazy';
    a.appendChild(img);
    var body = el('span', 'hs-body');
    body.appendChild(el('span', 'hs-name', e.t));
    a.appendChild(body);
    a.appendChild(el('span', 'hs-status ' + label.cls, label.text));
    return a;
  }

  function emptyBlock(q) {
    var d = el('div', 'hs-empty');
    d.appendChild(el('div', 'hs-empty-t', 'Not the one?'));
    var req = el('a', 'hs-btn hs-btn-req', '📝 Request a game');
    req.href = core.requestHref(q);
    var msg = el('a', 'hs-btn hs-btn-msg', '💬 Ask us on Messenger');
    msg.href = core.messengerHref(q);
    msg.target = '_blank';
    msg.rel = 'noopener';
    msg.setAttribute('data-track-source', 'search-empty');
    d.appendChild(req);
    d.appendChild(msg);
    return d;
  }

  // A search that found nothing, reported once it has settled (1.2 s without
  // typing) so half-typed words are never counted.
  function scheduleMiss(q) {
    clearTimeout(missTimer);
    if (q.length < 3 || q === lastMiss) return;
    missTimer = setTimeout(function () {
      if (!core.sameQuery(input.value, q)) return;
      lastMiss = q;
      var body = JSON.stringify({ q: q });
      try {
        if (navigator.sendBeacon && navigator.sendBeacon('/api/track/search-miss', new Blob([body], { type: 'application/json' }))) return;
        fetch('/api/track/search-miss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
      } catch (err) { /* tracking must never break the page */ }
    }, 1200);
  }

  function render() {
    var q = input.value.trim();
    box.textContent = '';
    if (!q) { close(); return; }
    open();
    if (failed) {
      var f = el('div', 'hs-empty');
      f.appendChild(el('div', 'hs-empty-t', 'Search is unavailable right now.'));
      var all = el('a', 'hs-btn hs-btn-req', 'Browse All Games');
      all.href = '/browse';
      f.appendChild(all);
      box.appendChild(f);
      return;
    }
    if (!index) { box.appendChild(el('div', 'hs-empty-t', 'Loading…')); return; }
    var hits = core.search(index, q, 6);
    if (!hits.length) { box.appendChild(emptyBlock(q)); scheduleMiss(core.norm(q)); return; }
    hits.forEach(function (e) { box.appendChild(row(e)); });
  }

  var basePlaceholder = (input.getAttribute && input.getAttribute('placeholder')) || 'What game are you looking for?';
  var reduceMotion = false;
  try { reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (err) { reduceMotion = false; }
  var typeTimer = null;
  var typeNames = [];
  var typeAt = 0;

  function stopType() {
    clearTimeout(typeTimer);
    typeTimer = null;
  }
  function resumeType() {
    stopType();
    if (reduceMotion || document.activeElement === input || String(input.value || '').trim() || !typeNames.length) {
      if (!String(input.value || '').trim() && document.activeElement !== input) input.placeholder = basePlaceholder;
      return;
    }
    var name = typeNames[typeAt % typeNames.length];
    var full = 'Try ' + name + '…';
    var n = 0;
    input.placeholder = '';
    function step() {
      if (document.activeElement === input || String(input.value || '').trim()) return;
      n += 1;
      input.placeholder = full.slice(0, n);
      typeTimer = setTimeout(n < full.length ? step : function () { typeAt += 1; resumeType(); }, n < full.length ? 55 : 1400);
    }
    step();
  }
  function armType() {
    if (reduceMotion) return;
    load(function () {
      typeNames = (index || []).filter(function (e) { return e && e.y === 'now' && e.t; }).map(function (e) { return e.t; });
      resumeType();
    });
  }

  input.addEventListener('focus', function () {
    stopType();
    input.placeholder = basePlaceholder;
    load(render);
  });
  input.addEventListener('blur', function () { if (!String(input.value || '').trim()) resumeType(); });
  armType();
  input.addEventListener('input', function () { load(render); render(); });
  dim.addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  document.addEventListener('click', function (e) { if (!e.target.closest('.hs-box')) close(); });

  // ── One search at a time ───────────────────────────────────────────────
  // On the homepage the menu's 🔍 icon would open a second, separate search.
  // While this big search is on screen the icon is hidden; once the visitor
  // has scrolled past it the icon comes back, and tapping it (or pressing /)
  // brings them back here with the keyboard open instead. Other pages don't
  // load this script, so their menu search is unchanged.
  var strip = document.getElementById('homeSearch');
  var navToggle = document.getElementById('navSearchToggle');

  function goToSearch() {
    try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
    if (strip && strip.scrollIntoView) strip.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (navToggle) {
    if (strip && 'IntersectionObserver' in window) {
      // The top 64px sit under the sticky menu bar, so they don't count as visible.
      new IntersectionObserver(function (entries) {
        navToggle.classList.toggle('hs-nav-hidden', entries[0].isIntersecting);
      }, { rootMargin: '-64px 0px 0px 0px' }).observe(input);
    }
    // Capture phase on document runs before the menu's own handler on the button.
    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest || !e.target.closest('#navSearchToggle')) return;
      e.preventDefault();
      e.stopPropagation();
      goToSearch();
    }, true);
  }

  document.addEventListener('keydown', function (e) {
    var active = document.activeElement;
    if (e.key !== '/' || active === input || /^(INPUT|TEXTAREA|SELECT)$/.test((active && active.tagName) || '')) return;
    e.preventDefault();
    e.stopPropagation();
    goToSearch();
  }, true);
})();
