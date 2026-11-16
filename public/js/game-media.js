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
