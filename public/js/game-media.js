// Game page trailer / screenshot block (views/partials/game-psn-media.ejs) and
// the "Read more" toggle of the overview (game-psn-about.ejs).
(function () {
  var root = document.getElementById('gpMedia');
  if (root) {
    var slides = Array.prototype.slice.call(root.querySelectorAll('.gpm-slide'));
    var thumbs = Array.prototype.slice.call(root.querySelectorAll('.gpm-thumb'));
    var count = document.getElementById('gpmCount');
    var cur = 0;

    var show = function (i) {
      if (i < 0 || i >= slides.length) return;
      cur = i;
      slides.forEach(function (s, k) {
        s.hidden = k !== i;
        if (k !== i) {
          var v = s.querySelector('video');
          if (v && !v.paused) v.pause();
        }
      });
      thumbs.forEach(function (t, k) { t.classList.toggle('on', k === i); });
      if (count) count.textContent = (i + 1) + ' / ' + slides.length;
    };

    var play = document.getElementById('gpmPlay');
    var syncPlay = function () {
      if (!play) return;
      var slide = slides[cur];
      var video = slide && slide.querySelector('video');
      play.hidden = !video || root.classList.contains('is-playing');
    };
    if (play) {
      // The markup keeps controls so the trailer still works if this script
      // does not run. Until Play is tapped, the still is the poster.
      root.querySelectorAll('video').forEach(function (video) { video.removeAttribute('controls'); });
      play.addEventListener('click', function () {
        var video = slides[cur] && slides[cur].querySelector('video');
        if (!video) return;
        root.classList.add('is-playing');
        video.setAttribute('controls', '');
        var started = video.play();
        if (started && started.catch) started.catch(function () {});
        syncPlay();
      });
    }
    var showAndSync = show;
    show = function (i) {
      showAndSync(i);
      if (root.classList.contains('is-playing')) {
        var video = slides[cur] && slides[cur].querySelector('video');
        if (!video) root.classList.remove('is-playing');
      }
      syncPlay();
    };
    thumbs.forEach(function (t, k) { t.addEventListener('click', function () { show(k); }); });
    syncPlay();

    // Swipe on the picture (ignored while the video's own controls are used).
    var stage = document.getElementById('gpmStage');
    var x0 = null;
    stage.addEventListener('touchstart', function (e) { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (x0 === null || e.target.tagName === 'VIDEO') { x0 = null; return; }
      var dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) show(dx < 0 ? Math.min(cur + 1, slides.length - 1) : Math.max(cur - 1, 0));
    }, { passive: true });

    // A thumbnail whose picture fails to load is dropped; the rest still work.
    root.querySelectorAll('.gpm-thumb img').forEach(function (img) {
      img.addEventListener('error', function () { img.remove(); });
    });

    // Screenshots open a lightbox. The trailer still plays in its own tile.
    var shots = [];
    slides.forEach(function (slide, i) {
      var img = slide.querySelector('.gpm-open img');
      if (!img) return;
      shots.push({ index: i, src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' });
    });
    var dialog = document.getElementById('gpmLightbox');
    var lbImg = document.getElementById('gpmLbImg');
    var lbCount = document.getElementById('gpmLbCount');
    var lbThumbs = document.getElementById('gpmLbThumbs');
    var lbPos = 0;
    var lbScroll = '';

    function lbRender() {
      var shot = shots[lbPos];
      if (!shot || !lbImg) return;
      lbImg.src = shot.src;
      lbImg.alt = shot.alt;
      if (lbCount) lbCount.textContent = (lbPos + 1) + ' / ' + shots.length;
      if (!lbThumbs) return;
      Array.prototype.forEach.call(lbThumbs.children, function (btn, k) {
        btn.classList.toggle('on', k === lbPos);
        if (k === lbPos) btn.scrollIntoView({ block: 'nearest', inline: 'center' });
      });
    }
    function lbOpen(slideIndex) {
      if (!dialog || !shots.length || typeof dialog.showModal !== 'function') return;
      var pos = 0;
      shots.forEach(function (s, k) { if (s.index === slideIndex) pos = k; });
      lbPos = pos;
      if (!lbThumbs.childElementCount) {
        shots.forEach(function (s, k) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'gpm-lb-thumb';
          var im = document.createElement('img');
          im.src = s.src;
          im.alt = '';
          im.loading = 'lazy';
          im.decoding = 'async';
          btn.appendChild(im);
          btn.addEventListener('click', function () { lbPos = k; lbRender(); });
          lbThumbs.appendChild(btn);
        });
      }
      lbRender();
      lbScroll = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      if (!dialog.open) dialog.showModal();
    }
    function lbMove(dir) {
      if (!shots.length) return;
      lbPos = (lbPos + dir + shots.length) % shots.length;
      lbRender();
    }
    root.querySelectorAll('.gpm-open').forEach(function (btn) {
      btn.addEventListener('click', function () { lbOpen(Number(btn.getAttribute('data-index'))); });
    });
    if (dialog) {
      var lbClose = document.getElementById('gpmLbClose');
      var lbPrev = document.getElementById('gpmLbPrev');
      var lbNext = document.getElementById('gpmLbNext');
      if (lbClose) lbClose.addEventListener('click', function () { dialog.close(); });
      if (lbPrev) lbPrev.addEventListener('click', function () { lbMove(-1); });
      if (lbNext) lbNext.addEventListener('click', function () { lbMove(1); });
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog) dialog.close();
      });
      dialog.addEventListener('close', function () {
        document.body.style.overflow = lbScroll;
      });
      dialog.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); lbMove(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); lbMove(-1); }
      });
      var lx = null;
      dialog.addEventListener('touchstart', function (e) {
        lx = e.touches.length === 1 ? e.touches[0].clientX : null;
      }, { passive: true });
      dialog.addEventListener('touchend', function (e) {
        if (lx === null) return;
        var dx = e.changedTouches[0].clientX - lx;
        lx = null;
        if (Math.abs(dx) > 40) lbMove(dx < 0 ? 1 : -1);
      }, { passive: true });
    }

    if (root.classList.contains('gpm-many') && stage) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'gpm-more';
      more.hidden = true;
      more.addEventListener('click', function (e) {
        e.stopPropagation();
        lbOpen(Number(more.dataset.index));
      });
      function updateMore() {
        var box = stage.getBoundingClientRect();
        var last = -1;
        slides.forEach(function (s, i) {
          var r = s.getBoundingClientRect();
          if (r.right > box.left + 8 && r.left < box.right - 8) last = i;
        });
        var rest = slides.length - last - 1;
        if (last < 0 || rest <= 0) {
          more.hidden = true;
          return;
        }
        more.hidden = false;
        more.dataset.index = String(last);
        more.textContent = '+' + rest;
        if (more.parentNode !== slides[last]) slides[last].appendChild(more);
      }
      var prev = document.getElementById('gpmPrev');
      var next = document.getElementById('gpmNext');
      function scrollDir(dir) {
        var w = slides[0].getBoundingClientRect().width + 8;
        stage.scrollBy({ left: dir * w, behavior: 'smooth' });
      }
      if (prev) prev.addEventListener('click', function () { scrollDir(-1); });
      if (next) next.addEventListener('click', function () { scrollDir(1); });
      stage.addEventListener('scroll', updateMore, { passive: true });
      window.addEventListener('resize', updateMore);
      if (window.ResizeObserver) new ResizeObserver(updateMore).observe(stage);
      updateMore();
      requestAnimationFrame(function () { requestAnimationFrame(updateMore); });
    }
  }

  var more = document.getElementById('gpaMore');
  var text = document.getElementById('gpaText');
  if (more && text) {
    more.addEventListener('click', function () {
      var open = text.classList.toggle('gpa-open');
      more.textContent = open ? 'Show less' : 'Read more';
      more.setAttribute('aria-expanded', String(open));
    });
  }
})();
