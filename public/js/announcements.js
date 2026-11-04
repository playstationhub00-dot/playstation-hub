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

  // Gold sweep on the homepage hero only. The outgoing slide stays put and
  // the incoming one wipes in over it. Reduced motion is a short fade.
  function playHeroMotion(root, slides, prevIndex, nextIndex) {
    var prev = slides[prevIndex];
    var next = slides[nextIndex];
    if (!prev || !next || prev === next) return;
    var gen = (root._annGen || 0) + 1;
    root._annGen = gen;
    for (var i = 0; i < slides.length; i++) slides[i].classList.remove('out', 'in', 'st-on');
    prev.classList.add('out');
    void next.offsetWidth;
    next.classList.add('in');
    if (!reduced) {
      next.classList.add('st-on');
      var sweep = root.querySelector('.ann-banner-sweep');
      if (sweep) {
        var rect = next.getBoundingClientRect();
        var beam = 90;
        try { beam = parseFloat(window.getComputedStyle(sweep, '::before').width) || beam; } catch (err) {}
        if (rect.width > 0 && rect.height > 0) {
          root.style.setProperty('--sweep-from', Math.round(rect.width * 0.925 - beam / 2) + 'px');
          root.style.setProperty('--sweep-to', Math.round(-rect.width * 0.375 - beam / 2) + 'px');
          var angle = Math.atan((rect.width * 0.15) / rect.height) * 180 / Math.PI;
          root.style.setProperty('--sweep-skew', (-angle).toFixed(2) + 'deg');
        }
        sweep.classList.remove('go');
        void sweep.offsetWidth;
        sweep.classList.add('go');
      }
    }
    window.setTimeout(function () {
      if (root._annGen !== gen) return;
      prev.classList.remove('out');
      next.classList.remove('in', 'st-on');
    }, reduced ? 360 : 980);
  }

  function showIndex(root, selector, index, announce) {
    var slides = root.querySelectorAll(selector);
    var dots = root.querySelectorAll('.ann-dot');
    var hero = root.id === 'annBanner';
    var prev = -1;
    var chosen = null;
    for (var p = 0; p < slides.length; p++) {
      if (slides[p].classList.contains('on')) prev = p;
    }
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
    if (hero && chosen && prev >= 0 && prev !== index) playHeroMotion(root, slides, prev, index);
    if (announce && chosen) {
      var region = root.querySelector('.ann-banner-live');
      if (region) region.textContent = chosen.getAttribute('aria-label') || '';
    }
    if (!chosen) pick(root, selector);
    if (typeof root._annAfterShow === 'function') root._annAfterShow();
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
        stop(true);
        showIndex(root, selector, parseInt(dot.getAttribute('data-index'), 10) || 0, true);
      });
    });
    var timer = null;
    function clearFill() {
      if (root.id !== 'annBanner') return;
      var nodes = root.querySelectorAll('.ann-dot');
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('ann-fill');
    }
    function restartFill() {
      if (root.id !== 'annBanner') return;
      clearFill();
      if (reduced || !timer) return;
      var active = root.querySelector('.ann-dot.on');
      if (!active) return;
      void active.offsetWidth;
      active.classList.add('ann-fill');
    }
    if (root.id === 'annBanner') {
      root._annAfterShow = function () {
        if (timer) restartFill();
        else clearFill();
      };
    }
    var touching = false;
    var pointerInside = false;
    var live = root.querySelector('.ann-banner-live');
    function setLive(mode) {
      if (live) live.setAttribute('aria-live', mode);
    }
    // A mouse click focuses a button, but that focus is not :focus-visible.
    // Treating every focused control as a hold stopped the timer forever after
    // the first click, and also if the carousel region itself was focused on
    // load. Only a keyboard focus keeps auto-advance paused.
    function keyboardHold() {
      var active = document.activeElement;
      if (!active || active === document.body || !root.contains(active)) return false;
      try { return active.matches(':focus-visible'); } catch (err) { return false; }
    }
    function canAuto() {
      return !reduced && !pointerInside && !touching && !keyboardHold() && eligibleIndexes(root, selector).length >= 2;
    }
    function step(dir, announce) {
      var ids = eligibleIndexes(root, selector);
      if (ids.length < 2) return;
      var slides = root.querySelectorAll(selector);
      var current = ids[0];
      for (var i = 0; i < slides.length; i++) if (slides[i].classList.contains('on')) current = i;
      var pos = ids.indexOf(current);
      if (pos < 0) pos = 0;
      showIndex(root, selector, ids[(pos + (dir || 1) + ids.length) % ids.length], announce);
    }
    function start() {
      if (timer || !canAuto()) {
        if (!timer) setLive(canAuto() ? 'off' : 'polite');
        return;
      }
      setLive('off');
      var interval = parseInt(root.getAttribute('data-interval'), 10);
      if (!interval || interval < 1000) interval = 6000;
      if (root.id === 'annBanner') {
        root.classList.remove('ann-hold');
        root.style.setProperty('--ann-int', interval + 'ms');
      }
      timer = setInterval(function () {
        if (root.hasAttribute('hidden') || document.hidden || !canAuto()) return;
        step(1, false);
      }, interval);
      restartFill();
    }
    function stop(resetFill) {
      clearInterval(timer);
      timer = null;
      setLive('polite');
      if (root.id !== 'annBanner') return;
      if (resetFill) {
        root.classList.remove('ann-hold');
        clearFill();
      } else {
        root.classList.add('ann-hold');
      }
    }
    start();
    if (reduced) setLive('polite');
    root.addEventListener('mouseenter', function () { pointerInside = true; stop(); });
    root.addEventListener('mouseleave', function () { pointerInside = false; start(); });
    root.addEventListener('focusin', function () { if (keyboardHold()) stop(); });
    root.addEventListener('focusout', function (e) {
      if (!root.contains(e.relatedTarget)) start();
    });
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (eligibleIndexes(root, selector).length < 2) return;
      e.preventDefault();
      stop();
      step(e.key === 'ArrowLeft' ? -1 : 1, true);
      if (!keyboardHold()) start();
    });
    if (root.getAttribute('data-swipe') === '1') {
      var originX = 0;
      var originY = 0;
      var track = false;
      root.addEventListener('touchstart', function (e) {
        if (!e.touches || e.touches.length !== 1) return;
        var target = e.target;
        track = !(target && target.closest && target.closest('a, button'));
        originX = e.touches[0].clientX;
        originY = e.touches[0].clientY;
        touching = true;
        stop();
      }, { passive: true });
      function endTouch(e) {
        var point = e.changedTouches && e.changedTouches[0];
        var dx = point ? point.clientX - originX : 0;
        var dy = point ? point.clientY - originY : 0;
        touching = false;
        if (track && Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          step(dx < 0 ? 1 : -1, true);
        }
        track = false;
        setTimeout(start, 350);
      }
      root.addEventListener('touchend', endTouch, { passive: true });
      root.addEventListener('touchcancel', function () {
        touching = false;
        track = false;
        setTimeout(start, 350);
      }, { passive: true });
    }
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
