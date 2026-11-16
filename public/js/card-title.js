// One-line game titles. A name scrolls only when it is wider than the card.
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function measure() {
    var boxes = document.querySelectorAll('.gc2-title');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var text = box.querySelector('.gc-title-text');
      if (!text) continue;
      box.classList.remove('is-marquee');
      var cs = getComputedStyle(box);
      var pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      var overflow = text.scrollWidth - (box.clientWidth - pad);
      if (reduce.matches || overflow <= 1) {
        box.style.removeProperty('--gc-shift');
        box.style.removeProperty('--gc-dur');
        continue;
      }
      var dist = Math.ceil(overflow + 12);
      var travel = dist / 36;
      var dur = Math.max(7.5, travel / 0.25);
      box.style.setProperty('--gc-shift', (-dist) + 'px');
      box.style.setProperty('--gc-dur', dur.toFixed(2) + 's');
      box.classList.add('is-marquee');
    }
  }

  var timer;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(measure, 80);
  }

  function boot() {
    measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    window.addEventListener('resize', schedule);
    if (reduce.addEventListener) reduce.addEventListener('change', measure);
    else if (reduce.addListener) reduce.addListener(measure);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
