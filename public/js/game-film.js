// Gameplay strip, lightbox and info tabs.
// Shared by the released-game page and the Coming soon page so the strip,
// the dots and the lightbox stay one implementation.
// The page declares `gdSlideCount` before this file loads.

// ── Gameplay image slider ──
let gdIndex = 0;
function gdGo(i) {
  if (gdSlideCount <= 1) return;
  gdIndex = (i + gdSlideCount) % gdSlideCount;
  const track = document.getElementById('gdSliderTrack');
  const shots = track ? track.querySelectorAll('.gp-shot') : [];
  if (track && shots.length) {
    const shot = shots[gdIndex];
    if (shot) track.scrollTo({ left: shot.offsetLeft, behavior: 'smooth' });
  } else if (track) {
    track.style.transform = 'translateX(-' + (gdIndex * 100) + '%)';
  }
  document.querySelectorAll('#gdSliderDots .gd-dot').forEach((d, di) => d.classList.toggle('active', di === gdIndex));
  shots.forEach((t, ti) => t.classList.toggle('on', ti === gdIndex));
  const count = document.getElementById('gpGalCount');
  if (count) count.textContent = (gdIndex + 1) + ' / ' + gdSlideCount;
  const gdThumbsWrap = document.getElementById('gdThumbs');
  document.querySelectorAll('#gdThumbs .gd-thumb').forEach((t, ti) => {
    t.classList.toggle('active', ti === gdIndex);
    if (ti === gdIndex && gdThumbsWrap) {
      const target = t.offsetLeft - (gdThumbsWrap.clientWidth - t.clientWidth) / 2;
      gdThumbsWrap.scrollTo({ left: target, behavior: 'smooth' });
    }
  });
}

function gpTab(id, btn) {
  document.querySelectorAll('.gp-tab').forEach(t => {
    t.classList.toggle('on', t === btn);
    t.setAttribute('aria-selected', t === btn ? 'true' : 'false');
  });
  document.querySelectorAll('.gp-pane').forEach(p => { p.hidden = p.id !== id; });
}

function gdMove(dir) { gdGo(gdIndex + dir); }

// Gameplay lightbox. The thumbnail src is already the full screenshot
// (PlayStation CDN or /uploads). showModal traps focus and closes on Esc.
let gpLbOpener = null;
let gpLbScroll = '';
function gpFilmSrc(i) {
  const track = document.getElementById('gdSliderTrack');
  const shot = track && track.querySelectorAll('.gp-shot')[i];
  const img = shot && shot.querySelector('img');
  return img ? img.getAttribute('src') : '';
}
function gpFilmAlt(i) {
  const track = document.getElementById('gdSliderTrack');
  const shot = track && track.querySelectorAll('.gp-shot')[i];
  const img = shot && shot.querySelector('img');
  return img ? (img.getAttribute('alt') || '') : '';
}
function gpLbShow(i) {
  if (gdSlideCount < 1) return;
  gdIndex = (i + gdSlideCount) % gdSlideCount;
  const img = document.getElementById('gpLbImg');
  const count = document.getElementById('gpLbCount');
  if (img) {
    img.src = gpFilmSrc(gdIndex);
    img.alt = gpFilmAlt(gdIndex);
  }
  if (count) count.textContent = (gdIndex + 1) + ' / ' + gdSlideCount;
  const many = gdSlideCount > 1;
  ['gpLbPrev', 'gpLbNext'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.hidden = !many;
    btn.disabled = !many;
  });
  if (gdSlideCount > 1) gdGo(gdIndex);
}
function gpFilmIndex() { return gdIndex; }
function gpOpenFilm(i, from) {
  const dialog = document.getElementById('gpLightbox');
  if (!dialog || typeof dialog.showModal !== 'function') {
    if (gdSlideCount > 1) gdGo(i);
    return;
  }
  gpLbOpener = (from && from.focus) ? from : (document.activeElement && document.activeElement.focus ? document.activeElement : null);
  gpLbScroll = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  gpLbShow(i);
  if (!dialog.open) dialog.showModal();
  const closeBtn = document.getElementById('gpLbClose');
  if (closeBtn) closeBtn.focus();
}
function gpLbMove(dir) { gpLbShow(gdIndex + dir); }
function gpCloseFilm() {
  const dialog = document.getElementById('gpLightbox');
  if (dialog && dialog.open) dialog.close();
}
(function () {
  const dialog = document.getElementById('gpLightbox');
  if (!dialog) return;
  const closeBtn = document.getElementById('gpLbClose');
  const prev = document.getElementById('gpLbPrev');
  const next = document.getElementById('gpLbNext');
  if (closeBtn) closeBtn.addEventListener('click', gpCloseFilm);
  if (prev) prev.addEventListener('click', () => gpLbMove(-1));
  if (next) next.addEventListener('click', () => gpLbMove(1));
  dialog.addEventListener('click', (e) => {
    const t = e.target;
    if (t === dialog || (t.classList && t.classList.contains('gp-lb-frame'))) gpCloseFilm();
  });
  dialog.addEventListener('close', () => {
    document.body.style.overflow = gpLbScroll;
    const back = gpLbOpener;
    gpLbOpener = null;
    if (back && back.focus) back.focus();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); gpLbMove(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); gpLbMove(-1); }
    else if (e.key === 'Tab') {
      const items = [closeBtn, prev, next].filter(el => el && !el.hidden && !el.disabled);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  let startX = null;
  dialog.addEventListener('touchstart', (e) => {
    startX = e.touches && e.touches.length === 1 ? e.touches[0].clientX : null;
  }, { passive: true });
  dialog.addEventListener('touchend', (e) => {
    if (startX == null || !e.changedTouches || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) gpLbMove(dx < 0 ? 1 : -1);
  }, { passive: true });
})();
// Swipe support on touch devices
(function() {
  const slider = document.getElementById('gdSlider');
  if (!slider || gdSlideCount <= 1) return;
  let startX = 0;
  slider.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  slider.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) gdMove(dx < 0 ? 1 : -1);
  }, { passive: true });
})();
// Autoplay: loop through the gallery every 4s. Pauses on hover/touch so a
// reader isn't fighting the slider while looking at an image, and stays off
// entirely for anyone who has asked for reduced motion.
(function() {
  const slider = document.getElementById('gdSlider');
  if (!slider || gdSlideCount <= 1) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let timer = null;
  function start() { stop(); timer = setInterval(() => gdMove(1), 4000); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  slider.addEventListener('mouseenter', stop);
  slider.addEventListener('mouseleave', start);
  slider.addEventListener('touchstart', stop, { passive: true });
  slider.addEventListener('touchend', () => setTimeout(start, 4000), { passive: true });
  document.querySelectorAll('#gdSliderDots .gd-dot, #gdThumbs .gd-thumb, .gd-slider-arrow').forEach(el => {
    el.addEventListener('click', start);
  });
  start();
})();
