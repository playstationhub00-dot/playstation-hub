// The Buy storefront's shelves (views/buy.ejs). Each shelf is a native
// sideways-scrolling row, so phones swipe it without help; on computers the
// ‹ › buttons scroll it by about a screen, and each button greys out at its
// end. (The spotlight above runs on public/js/home.js.)
(function () {
  Array.prototype.forEach.call(document.querySelectorAll('.shop-row-wrap'), function (wrap) {
    var row = wrap.querySelector('.shop-row');
    var prev = wrap.querySelector('.shop-row-prev'), next = wrap.querySelector('.shop-row-next');
    if (!row || !prev || !next) return;
    function update() {
      var max = row.scrollWidth - row.clientWidth;
      prev.disabled = row.scrollLeft <= 1;
      next.disabled = row.scrollLeft >= max - 1;
      wrap.classList.toggle('shop-row-fits', max <= 1);
    }
    function by(dir) { row.scrollBy({ left: dir * Math.max(200, row.clientWidth * 0.85), behavior: 'smooth' }); }
    prev.addEventListener('click', function () { by(-1); });
    next.addEventListener('click', function () { by(1); });
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  });
})();
