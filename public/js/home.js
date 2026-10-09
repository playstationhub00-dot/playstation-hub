// The homepage "Now playing" banner (views/partials/home/top.ejs). The slides
// are a native scroll-snap row, so phones swipe them without help; this adds
// the dots, the arrows and a gentle auto-advance that stops for good once the
// visitor touches the banner, and never runs for reduced-motion users.
(function () {
  var root = document.getElementById('hmBanner');
  var track = document.getElementById('hmSlides');
  if (!root || !track) return;
  var slides = track.children;
  var n = slides.length;
  if (n < 2) return;
  var dots = root.querySelectorAll('.hm-dot');
  var cur = 0, timer = null, hovered = false, touched = false;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mark() {
    Array.prototype.forEach.call(dots, function (d, i) { d.classList.toggle('on', i === cur); });
  }
  function go(i) {
    cur = (i + n) % n;
    track.scrollTo({ left: slides[cur].offsetLeft, behavior: 'smooth' });
    mark();
  }
  // Keep the dots right when the visitor swipes.
  var settle = null;
  track.addEventListener('scroll', function () {
    clearTimeout(settle);
    settle = setTimeout(function () {
      var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i !== cur && i >= 0 && i < n) { cur = i; mark(); }
    }, 80);
  }, { passive: true });

  function stop() { touched = true; clearInterval(timer); }
  Array.prototype.forEach.call(dots, function (d, i) { d.addEventListener('click', function () { stop(); go(i); }); });
  var prev = document.getElementById('hmPrev'), next = document.getElementById('hmNext');
  if (prev) prev.addEventListener('click', function () { stop(); go(cur - 1); });
  if (next) next.addEventListener('click', function () { stop(); go(cur + 1); });
  track.addEventListener('touchstart', stop, { passive: true });
  root.addEventListener('mouseenter', function () { hovered = true; });
  root.addEventListener('mouseleave', function () { hovered = false; });

  if (!reduced) {
    timer = setInterval(function () {
      if (!touched && !hovered && !document.hidden) go(cur + 1);
    }, 6000);
  }
})();
