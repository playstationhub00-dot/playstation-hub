(function(){
  let cur = 0;
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-dot');
  function goTo(n) {
    slides[cur].classList.remove('active');
    if (dots[cur]) dots[cur].classList.remove('active');
    cur = (n + slides.length) % slides.length;
    slides[cur].classList.add('active');
    if (dots[cur]) dots[cur].classList.add('active');
  }
  window.heroSlide = d => goTo(cur + d);
  window.heroGoTo = goTo;
  if (slides.length > 1) setInterval(() => goTo(cur + 1), 5000);
})();
