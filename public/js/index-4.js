function slideSection(id, dir) {
  const slider = document.getElementById(id);
  if (!slider) return;
  const card = slider.querySelector('[style*="min-width"]') || slider.querySelector('.game-card');
  const cardW = card ? card.offsetWidth + 20 : 260;
  slider.scrollBy({ left: dir * cardW * 2, behavior: 'smooth' });
}

// Auto-advance for the two top rows: a slow continuous drift rather than
// card-by-card jumps, which read as lurching.
//
// Three things this has to work around:
//   - scroll-snap-type on .upcoming-slider is `x mandatory`, which yanks a
//     continuous scroll back to the nearest card. Snap is switched off while
//     drifting and restored the moment the visitor takes over.
//   - Looping has to be invisible, so the card set is cloned once and the
//     position wraps by exactly half the scroll width — the content under the
//     wrap point is identical, so nothing appears to move.
//   - The row stays a real scroll container throughout, so the arrows, manual
//     swiping and the fade overlay all keep behaving normally.
(function () {
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // `reverse` flips which way the content flows. Forward increases scrollLeft,
  // so cards drift toward the left edge and exit there (content flows right to
  // left) — that's Most Popular. Reverse starts at the halfway wrap point and
  // decreases, so cards drift toward the right edge and exit there instead
  // (content flows left to right) — New Releases and Coming Soon, per request.
  function autoDrift(id, pxPerSecond, reverse) {
    var slider = document.getElementById(id);
    if (!slider || reduced) return;

    // onScreen starts true so a browser whose IntersectionObserver reports late
    // (or not at all) still animates; the observer corrects it on its first
    // callback, which fires immediately on observe().
    var raf = null, stopped = false, hovered = false, onScreen = true;
    var last = 0;

    var originals = Array.prototype.slice.call(slider.children);
    if (!originals.length) return;

    // Width of one full set, measured off the cards themselves rather than
    // scrollWidth. When the content is narrower than its container scrollWidth
    // reports the CONTAINER's width, which reads as a much wider set than
    // exists — the copy count then comes out too low, the row still fits, and
    // nothing ever loops. Spans are scroll-invariant (every card moves
    // together), so this is safe to take at any scroll position.
    function setWidth() {
      var first = originals[0].getBoundingClientRect();
      var last = originals[originals.length - 1].getBoundingClientRect();
      var gap = originals.length > 1
        ? originals[1].getBoundingClientRect().left - first.right
        : 0;
      return (last.right - first.left) + Math.max(0, gap);
    }
    var copyWidth = setWidth();
    if (copyWidth <= 0) return;

    // How many copies the row needs. Scrolling runs from zero to one copy width
    // and then wraps, so the most that is ever needed is a copy plus the visible
    // width. Anything short of that and the row simply fits the screen, which is
    // where this used to give up and never loop — fine while these rows carried
    // ten cards, wrong now they are trimmed to six and a wide monitor shows all
    // of them at once.
    var copies = Math.max(2, Math.ceil(slider.clientWidth / copyWidth) + 1);

    // Duplicate sets, so reaching the end of one wraps to the identical point in
    // the next without anything visibly jumping. Hidden from assistive tech and
    // taken out of the tab order — they are the same links again, and nobody
    // should have to tab through them twice.
    var clones = [];
    for (var copy = 1; copy < copies; copy++) {
      originals.forEach(function (node) {
        var c = node.cloneNode(true);
        c.setAttribute('aria-hidden', 'true');
        // The card itself is the link in the Coming Soon row, while the game rows
        // wrap theirs in a div — so the clone has to be checked as well as its
        // descendants, or half the duplicates stay in the tab order.
        if (c.matches('a, button')) c.setAttribute('tabindex', '-1');
        c.querySelectorAll('a, button').forEach(function (el) { el.setAttribute('tabindex', '-1'); });
        slider.appendChild(c);
        clones.push(c);
      });
    }

    slider.style.scrollSnapType = 'none';

    // One copy's worth of scrolling. Measured after cloning so the gap between
    // copies is counted the same way the gaps inside a copy are.
    function period() { return slider.scrollWidth / copies; }

    // Reverse starts mid-wrap (the seam between the two identical copies)
    // rather than at 0, since there is nothing before position 0 to decrease
    // into — scrollLeft can't go negative in an LTR row. Starting at the seam
    // and counting down reaches 0 exactly when the content there is once
    // again identical to the far end, which is the same invisible-wrap trick
    // the forward direction uses, just approached from the other side.
    var pos = reverse ? period() : slider.scrollLeft;
    if (reverse) slider.scrollLeft = pos;

    function frame(now) {
      if (stopped) return;
      var dt = last ? Math.min(now - last, 100) : 0; // clamp: a backgrounded tab
      last = now;                                    // must not lurch on return
      if (!hovered && onScreen && !document.hidden) {
        var p = period();
        if (reverse) {
          pos -= (pxPerSecond * dt) / 1000;
          if (pos <= 0) pos += p; // identical content, so this is invisible
        } else {
          pos += (pxPerSecond * dt) / 1000;
          if (pos >= p) pos -= p;
        }
        slider.scrollLeft = pos;
      }
      raf = requestAnimationFrame(frame);
    }

    // Once someone takes hold of the row it is theirs. Snap goes back on and the
    // clones are removed, after folding the position back into the real set so
    // nothing shifts under them.
    function stop() {
      if (stopped) return;
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      var p = period();
      if (p > 0) slider.scrollLeft = slider.scrollLeft % p;
      clones.forEach(function (c) { c.remove(); });
      slider.style.scrollSnapType = '';
    }

    raf = requestAnimationFrame(frame);
    slider.addEventListener('mouseenter', function () { hovered = true; });
    slider.addEventListener('mouseleave', function () { hovered = false; });

    // Only gestures aimed ALONG the row count as taking control of it. Reaching
    // these rows means scrolling the page down, and a vertical wheel or swipe
    // fires on whatever sits under the cursor or finger — treating that as
    // intent killed the animation before it ever moved. Listening for 'scroll'
    // is no good either, since our own scrolling fires that every frame.
    slider.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) stop();
    }, { passive: true });

    var tx = null, ty = null;
    slider.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      tx = t.clientX; ty = t.clientY;
    }, { passive: true });
    slider.addEventListener('touchmove', function (e) {
      if (tx === null) return;
      var t = e.touches[0];
      if (Math.abs(t.clientX - tx) > Math.abs(t.clientY - ty)) stop();
    }, { passive: true });

    // A deliberate mouse DRAG along the row — not merely a press.
    //
    // stop() tears the row down: it folds the scroll position back into the
    // real set and removes every cloned card. Running that on pointerdown
    // pulled the content out from under the cursor between press and release,
    // so mousedown and mouseup had no common target and the browser never
    // fired a click at all. That is why a Coming Soon card had to be clicked
    // twice — the first press only reset the row, and the second worked
    // because stop() had already run and returns early.
    //
    // A press needs no separate pause: the animation is already held by
    // `hovered`, which mouseenter set before the press could happen. Only an
    // actual grab has to take the row over, so only movement triggers it.
    var downX = null;
    slider.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') downX = e.clientX;
    }, { passive: true });
    slider.addEventListener('pointermove', function (e) {
      if (downX === null || e.pointerType !== 'mouse') return;
      if (Math.abs(e.clientX - downX) > 8) { downX = null; stop(); }
    }, { passive: true });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
      slider.addEventListener(evt, function () { downX = null; }, { passive: true });
    });

    var wrap = slider.closest('.upcoming-slider-wrap');
    if (wrap) wrap.querySelectorAll('.slider-arrow').forEach(function (b) { b.addEventListener('click', stop); });

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
      }, { threshold: 0.2 }).observe(slider);
    }
  }

  // Slightly different speeds so the rows never drift in lockstep, which
  // would read as one big moving block rather than independent shelves.
  // Only Coming Soon flows left to right; New Releases and Most Popular flow
  // right to left (New Releases was briefly reversed too, then asked back).
  autoDrift('newReleasesSlider', 18);
  autoDrift('upcomingSlider', 16, true);
  autoDrift('popularSlider', 14);
})();

function openReserveModal(title) {
  document.getElementById('reserveGameTitle').textContent = title;
  document.getElementById('reserveModal').classList.add('active');
}
function closeReserveModal() { document.getElementById('reserveModal').classList.remove('active'); }
document.getElementById('reserveModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeReserveModal(); });


function switchModalTab(tab) {
  const isRent = tab === 'rent';
  document.getElementById('modalRentPanel').style.display = isRent ? 'block' : 'none';
  document.getElementById('modalBuyPanel').style.display  = isRent ? 'none'  : 'block';
  document.getElementById('modalTabRent').style.background = isRent ? 'var(--ps-blue)' : 'transparent';
  document.getElementById('modalTabRent').style.color      = isRent ? '#000' : '#555';
  document.getElementById('modalTabBuy').style.background  = isRent ? 'transparent' : 'var(--ps-blue)';
  document.getElementById('modalTabBuy').style.color       = isRent ? '#555' : '#000';
}

function openRentModal(title, nt7, nt30, tr7, tr30, hasTrophy, hasNt, buyNt, buyTr) {
  document.getElementById('modalGameTitle').textContent = title;
  // Rent prices
  document.getElementById('modalNtP10').textContent = '₱' + nt7;
  document.getElementById('modalNtP30').textContent = '₱' + nt30;
  document.getElementById('modalTrP10').textContent = '₱' + tr7;
  document.getElementById('modalTrP30').textContent = '₱' + tr30;
  document.getElementById('modalNtSection').style.display = hasNt ? 'block' : 'none';
  document.getElementById('modalTrophySection').style.display = hasTrophy ? 'block' : 'none';
  // Buy prices
  const hasBuyNt = buyNt > 0;
  const hasBuyTr = buyTr > 0 && hasTrophy;
  document.getElementById('modalBuyNtSection').style.display = hasBuyNt ? 'block' : 'none';
  document.getElementById('modalBuyTrSection').style.display = hasBuyTr ? 'block' : 'none';
  // Apply buy promo
  if (_buyPromo.enabled && _buyPromo.pct > 0) {
    document.getElementById('modalBuyPromoBadge').style.display = 'block';
    document.getElementById('modalBuyPromoText').textContent = _buyPromo.pct + '%';
    if (hasBuyNt) {
      const disc = Math.round(buyNt * (1 - _buyPromo.pct / 100));
      document.getElementById('modalBuyNtOriginal').textContent = '₱' + buyNt;
      document.getElementById('modalBuyNtOriginal').style.display = 'block';
      document.getElementById('modalBuyNtPrice').textContent = '₱' + disc;
    }
    if (hasBuyTr) {
      const disc = Math.round(buyTr * (1 - _buyPromo.pct / 100));
      document.getElementById('modalBuyTrOriginal').textContent = '₱' + buyTr;
      document.getElementById('modalBuyTrOriginal').style.display = 'block';
      document.getElementById('modalBuyTrPrice').textContent = '₱' + disc;
    }
  } else {
    document.getElementById('modalBuyPromoBadge').style.display = 'none';
    document.getElementById('modalBuyNtOriginal').style.display = 'none';
    document.getElementById('modalBuyTrOriginal').style.display = 'none';
    document.getElementById('modalBuyNtPrice').textContent = hasBuyNt ? '₱' + buyNt : '—';
    document.getElementById('modalBuyTrPrice').textContent = hasBuyTr ? '₱' + buyTr : '—';
  }
  // Show/hide buy tab
  document.getElementById('modalTabBuy').style.display = (hasBuyNt || hasBuyTr) ? '' : 'none';
  switchModalTab('rent');
  document.getElementById('rentModal').classList.add('active');
}
function closeRentModal() { document.getElementById('rentModal').classList.remove('active'); }
document.getElementById('rentModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeRentModal(); });
