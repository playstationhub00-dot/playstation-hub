// Bar rotation, banner slides, and the What's New bell. First paint is handled
// by the inline script in the announcement partial (dismiss + audience), so
// this file only wires clicks. It does nothing on pages without those nodes.
(function () {
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function read(name) {
    try { return JSON.parse(localStorage.getItem(name) || '{}') || {}; } catch (e) { return {}; }
  }
  function write(name, value) {
    try { localStorage.setItem(name, JSON.stringify(value)); } catch (e) {}
  }
  function pick(root, selector) {
    if (!root || !window.phAnnOk) return;
    var slides = root.querySelectorAll(selector);
    var dots = root.querySelectorAll('.ann-dot');
    var first = -1;
    for (var i = 0; i < slides.length; i++) {
      var show = window.phAnnOk(slides[i]);
      slides[i].classList.toggle('on', false);
      slides[i].setAttribute('aria-hidden', 'true');
      if (dots[i]) dots[i].hidden = !show;
      if (show && first < 0) first = i;
    }
    if (first < 0) {
      root.setAttribute('hidden', '');
      return;
    }
    root.removeAttribute('hidden');
    slides[first].classList.add('on');
    slides[first].removeAttribute('aria-hidden');
    if (dots[first]) dots[first].classList.add('on');
    for (var d = 0; d < dots.length; d++) if (d !== first) dots[d].classList.remove('on');
  }
  window.phAnnPick = pick;

  function showIndex(root, selector, index) {
    var slides = root.querySelectorAll(selector);
    var dots = root.querySelectorAll('.ann-dot');
    var chosen = null;
    for (var i = 0; i < slides.length; i++) {
      var on = i === index && window.phAnnOk(slides[i]);
      slides[i].classList.toggle('on', on);
      if (on) {
        slides[i].removeAttribute('aria-hidden');
        chosen = slides[i];
      } else {
        slides[i].setAttribute('aria-hidden', 'true');
      }
      if (dots[i]) {
        dots[i].classList.toggle('on', on);
        if (on) dots[i].setAttribute('aria-current', 'true');
        else dots[i].removeAttribute('aria-current');
      }
    }
    if (!chosen) pick(root, selector);
  }

  function eligibleIndexes(root, selector) {
    var slides = root.querySelectorAll(selector);
    var out = [];
    for (var i = 0; i < slides.length; i++) if (window.phAnnOk(slides[i])) out.push(i);
    return out;
  }

  function wireRotator(root, selector) {
    if (!root) return;
    pick(root, selector);
    var close = root.querySelector('.announcement-close');
    if (close) close.addEventListener('click', function () {
      var current = root.querySelector(selector + '.on');
      if (!current) return;
      var key = current.getAttribute('data-dismiss') || '';
      var map = read('phAnnDismiss');
      if (key) map[key] = 1;
      write('phAnnDismiss', map);
      pick(root, selector);
    });
    root.querySelectorAll('.ann-dot').forEach(function (dot) {
      dot.addEventListener('click', function () {
        showIndex(root, selector, parseInt(dot.getAttribute('data-index'), 10) || 0);
      });
    });
    var timer = null;
    function step(dir) {
      var ids = eligibleIndexes(root, selector);
      if (ids.length < 2) return;
      var slides = root.querySelectorAll(selector);
      var current = ids[0];
      for (var i = 0; i < slides.length; i++) if (slides[i].classList.contains('on')) current = i;
      var pos = ids.indexOf(current);
      if (pos < 0) pos = 0;
      showIndex(root, selector, ids[(pos + (dir || 1) + ids.length) % ids.length]);
    }
    function start() {
      if (reduced || timer) return;
      if (eligibleIndexes(root, selector).length < 2) return;
      timer = setInterval(function () {
        if (root.hasAttribute('hidden') || document.hidden) return;
        step(1);
      }, 6000);
    }
    function stop() { clearInterval(timer); timer = null; }
    start();
    root.addEventListener('mouseenter', stop);
    root.addEventListener('mouseleave', start);
    root.addEventListener('focusin', stop);
    root.addEventListener('focusout', function (e) {
      if (!root.contains(e.relatedTarget)) start();
    });
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (eligibleIndexes(root, selector).length < 2) return;
      e.preventDefault();
      stop();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    });
  }

  wireRotator(document.getElementById('announcementBar'), '.ann-bar-slide');
  wireRotator(document.getElementById('annBanner'), '.ann-banner-slide');

  var promo = document.querySelector('#announcementBar .ann-bar-slide.on[data-promo-id]');
  if (promo && promo.getAttribute('data-promo-id')) {
    try {
      fetch('/api/track/promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: promo.getAttribute('data-promo-id') })
      });
    } catch (e) {}
  }

  document.querySelectorAll('[data-countdown]').forEach(function (box) {
    var end = Date.parse(box.getAttribute('data-countdown'));
    if (!end) return;
    var parts = { d: box.querySelector('[data-part="d"]'), h: box.querySelector('[data-part="h"]'), m: box.querySelector('[data-part="m"]'), s: box.querySelector('[data-part="s"]') };
    function tick() {
      var ms = end - Date.now();
      if (ms < 0) ms = 0;
      var d = Math.floor(ms / 86400000); ms -= d * 86400000;
      var h = Math.floor(ms / 3600000); ms -= h * 3600000;
      var m = Math.floor(ms / 60000); ms -= m * 60000;
      var s = Math.floor(ms / 1000);
      if (parts.d) parts.d.textContent = String(d);
      if (parts.h) parts.h.textContent = String(h);
      if (parts.m) parts.m.textContent = String(m);
      if (parts.s) parts.s.textContent = String(s);
    }
    tick();
    if (!reduced) setInterval(tick, 1000);
  });

  var btn = document.getElementById('annBellBtn');
  var panel = document.getElementById('annBellPanel');
  if (!btn || !panel) return;

  function seenMap() { return read('phAnnSeen'); }
  function refreshDot() {
    var seen = seenMap();
    var unread = false;
    panel.querySelectorAll('[data-seen]').forEach(function (el) {
      if (el.offsetParent === null && window.getComputedStyle(el).display === 'none') return;
      if (!seen[el.getAttribute('data-seen')]) unread = true;
    });
    var dot = document.getElementById('annBellDot');
    if (dot) dot.hidden = !unread;
    btn.classList.toggle('has-unread', unread);
    btn.setAttribute('aria-label', unread ? "What's new, unread announcements" : "What's new");
  }
  refreshDot();

  function closePanel(focusBtn) {
    if (panel.hidden) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) btn.focus();
  }
  function openPanel() {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    panel.focus();
  }
  btn.addEventListener('click', function () {
    if (panel.hidden) openPanel(); else closePanel(false);
  });
  document.addEventListener('click', function (e) {
    if (panel.hidden) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    closePanel(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) {
      e.preventDefault();
      closePanel(true);
    }
  });
  var mark = document.getElementById('annMarkRead');
  if (mark) mark.addEventListener('click', function () {
    var seen = seenMap();
    panel.querySelectorAll('[data-seen]').forEach(function (el) { seen[el.getAttribute('data-seen')] = 1; });
    write('phAnnSeen', seen);
    refreshDot();
  });
  panel.querySelectorAll('[data-seen]').forEach(function (el) {
    el.addEventListener('click', function () {
      var seen = seenMap();
      seen[el.getAttribute('data-seen')] = 1;
      write('phAnnSeen', seen);
      refreshDot();
    });
  });
})();
