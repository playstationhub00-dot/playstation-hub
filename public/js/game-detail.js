function promoPctFor(days) { return PROMO.enabled ? (PROMO.discounts[days] || 0) : 0; }

// Single source of truth for the rent total, used by the order summary,
// the sticky bar, and the reserve-link message builder so they can never
// independently drift on the deposit/discount rule.
function computeRentTotal(type, days) {
  const base = PRICES[type][days];
  const pct = promoPctFor(days);
  const discount = pct > 0 ? Math.round(base * pct / 100) : 0;
  const deposit = (type === 'tr' || type === 'ps4') ? PROMO.deposit : 0;
  return { base, discount, deposit, pct, total: base - discount + deposit };
}

let selectedType = null;
let selectedDays = null;
let selectedBuyType = null;
let currentMode = 'rent';

// ── Mode toggle ──
function setMode(mode) {
  currentMode = mode;
  const isRent = mode === 'rent';
  document.getElementById('rentPanel').style.display = isRent ? 'block' : 'none';
  const buyPanel = document.getElementById('buyPanel');
  if (buyPanel) buyPanel.style.display = isRent ? 'none' : 'block';
  document.getElementById('toggleRent').style.background = isRent ? 'var(--ps-blue)' : 'transparent';
  document.getElementById('toggleRent').style.color = isRent ? '#000' : '#555';
  const tb = document.getElementById('toggleBuy');
  if (tb) { tb.style.background = isRent ? 'transparent' : 'linear-gradient(135deg,#7b2ff7,#f107a3)'; tb.style.color = isRent ? '#555' : '#fff'; }
  if (isRent) { updateTotal(); updateCtaState(); } else { updateBuyPriceHeader(); }
  syncStickyBar();
}

// ── Buy type selection ──
function selectBuyType(type) {
  selectedBuyType = type;
  const ntCard = document.getElementById('buyNtCard');
  const trCard = document.getElementById('buyTrCard');
  if (ntCard) ntCard.style.borderColor = type === 'nt' ? '#22c55e' : '#222';
  if (trCard) trCard.style.borderColor = type === 'tr' ? '#ffc400' : 'rgba(255,196,0,0.2)';
  const typeField = document.getElementById('buyOrderType');
  if (typeField) typeField.value = type;
  updateBuyPriceHeader();
  syncStickyBar();
}

// Shared by both modes — writes the DOM nodes the price header owns.
// `rider` is the small line under the amount ("+ ₱100 refundable deposit")
// — pass null to hide it. Called with `null` for was/save to skip the
// crossed-out "was" price and the "Save ₱X" badge.
function setPriceHeader(kicker, amount, was, save, rider) {
  const kEl = document.getElementById('phKicker');
  const amtEl = document.getElementById('phAmount');
  const wasEl = document.getElementById('phWas');
  const saveEl = document.getElementById('phSave');
  const riderEl = document.getElementById('phRider');
  if (!kEl) return;
  kEl.textContent = kicker;
  amtEl.textContent = '₱' + amount;
  if (was != null && save != null) {
    wasEl.textContent = '₱' + was; wasEl.style.display = '';
    saveEl.textContent = 'Save ₱' + save; saveEl.style.display = '';
  } else {
    wasEl.style.display = 'none'; saveEl.style.display = 'none';
  }
  if (riderEl) {
    if (rider) { riderEl.textContent = rider; riderEl.style.display = ''; }
    else { riderEl.style.display = 'none'; }
  }
}

function resetPriceHeader() {
  const kEl = document.getElementById('phKicker');
  const amtEl = document.getElementById('phAmount');
  if (!kEl) return;
  setPriceHeader(kEl.dataset.defaultKicker, amtEl.dataset.defaultAmount, null, null, null);
}

function updateBuyPriceHeader() {
  if (!selectedBuyType) {
    const kEl = document.getElementById('phKicker');
    const amtEl = document.getElementById('phAmount');
    if (!kEl) return;
    const buyFrom = Number(amtEl.dataset.defaultBuyAmount) || 0;
    // Every type full means there is no price to quote at all yet — the
    // "nothing to buy right now" note in the panel already says why, so this
    // just clears the amount rather than showing ₱0.
    if (buyFrom <= 0) {
      kEl.textContent = 'Buy Permanent';
      amtEl.textContent = '—';
      document.getElementById('phWas').style.display = 'none';
      document.getElementById('phSave').style.display = 'none';
      const riderEl = document.getElementById('phRider');
      if (riderEl) riderEl.style.display = 'none';
      return;
    }
    setPriceHeader(kEl.dataset.defaultKicker, buyFrom, null, null, null);
    return;
  }
  const typeName = selectedBuyType === 'tr' ? 'trophy · permanent' : 'non-trophy · permanent';
  setPriceHeader(typeName, BUY_PRICES[selectedBuyType], null, null, null);
}

function handleBuyClick(e) {
  const el = document.getElementById('buyValidationMsg');
  if (!selectedBuyType) {
    e.preventDefault();
    el.textContent = '⚠️ Please select Non-Trophy or Trophy account type first.';
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
    // shake cards
    ['buyNtCard','buyTrCard'].forEach(id => {
      const c = document.getElementById(id);
      if (c) { c.style.transform='translateX(4px)'; setTimeout(()=>c.style.transform='',200); }
    });
    return false;
  }
  const nameField = document.getElementById('buyFbName');
  if (!nameField || !nameField.value.trim()) {
    e.preventDefault();
    el.textContent = '⚠️ Please enter your Facebook name.';
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
    return false;
  }
  return true;
}

// ── Rent flow ──
// Expand/collapse a type row's setup panel. Independent of selecting that
// type — the chevron button is a sibling of the <label>, not a descendant,
// so clicking it never fires the label's native radio-click forwarding.
// One shared setup panel instead of a per-type accordion: the pills are too
// compact to carry their own expander, so the wrapper opens once and shows
// whichever type is selected.
function toggleSetupPanel() {
  const panel = document.getElementById('typeSetupWrap');
  const btn = document.getElementById('setupToggle');
  if (!panel || !btn) return;
  const open = panel.dataset.open === '1';
  panel.dataset.open = open ? '0' : '1';
  btn.setAttribute('aria-expanded', String(!open));
}

// Shows only the selected type's setup block. Called from onTypeChange so the
// panel's contents always match the pill the customer just picked.
function syncSetupPanel() {
  document.querySelectorAll('#typeSetupWrap .gd-setup-block').forEach(b => {
    b.style.display = (b.id === 'setup-' + selectedType) ? '' : 'none';
  });
}

function onTypeChange(radio) {
  selectedType = radio.value;
  document.querySelectorAll('.gd-type-card').forEach(c => c.classList.remove('gd-type-selected'));
  document.getElementById('label-' + selectedType)?.classList.add('gd-type-selected');
  syncSetupPanel();
  updatePrices();
  updateTotal();
  updateReserveLinks();
  updateCtaState();
  syncStickyBar();
  // Swap the queue strip and popout to the newly selected account type. Both
  // partial instances are updated because only one of them is ever on the page.
  if (typeof qlShow === 'function') { qlShow('', selectedType); qlShow('All', selectedType); }
}

function onDurChange(btn) {
  selectedDays = parseInt(btn.dataset.days);
  document.querySelectorAll('.gd-dur-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateTotal();
  updateReserveLinks();
  updateCtaState();
  syncStickyBar();
}

function updatePrices() {
  if (!selectedType) return;
  RENTAL_DURATIONS.forEach(d => {
    const el = document.getElementById('price-' + d);
    if (!el) return;
    const base = PRICES[selectedType][d];
    const pct = promoPctFor(d);
    if (pct > 0) {
      const final = base - Math.round(base * pct / 100);
      el.innerHTML = '<span class="gd-dur-price-orig">₱' + base + '</span> ₱' + final;
    } else {
      el.textContent = '₱' + base;
    }
  });
}

// Order summary is always visible now — this fills it with the exact
// selection once both are picked, or the cheapest "from" figure plus a
// hint line while incomplete, so the box never pops in/out or resizes
// beyond its own row content changing.
function updateTotal() {
  const rowsEl = document.getElementById('totalRows');
  const finalEl = document.getElementById('totalFinal');
  const hintEl = document.getElementById('totalHint');
  const refundEl = document.getElementById('totalRefund');
  if (!rowsEl || !finalEl) return;

  let base, discount = 0, deposit = 0, pct = 0, baseLabel = 'Base';

  if (selectedType && selectedDays) {
    const rt = computeRentTotal(selectedType, selectedDays);
    base = rt.base; discount = rt.discount; deposit = rt.deposit; pct = rt.pct;
    baseLabel = 'Base (' + selectedDays + ' days)';
    updatePriceHeaderFromSelection(base, discount);
  } else if (selectedType) {
    // Cheapest available duration for this type (by final, promo-applied,
    // price) — must match what the header shows below, so the two never
    // disagree the way "From ₱332" (every type) vs "Base ₱399" (this type)
    // used to.
    const cheapest = RENTAL_DURATIONS
      .map(d => computeRentTotal(selectedType, d))
      .reduce((a, b) => b.base - b.discount < a.base - a.discount ? b : a);
    base = cheapest.base; discount = cheapest.discount; deposit = cheapest.deposit; pct = cheapest.pct;
    const typeName = selectedType === 'tr' ? 'Trophy' : selectedType === 'ps4' ? 'PS4 primary' : 'Non-Trophy';
    const final = base - discount;
    const rider = deposit > 0 ? ('+ ₱' + deposit + ' refundable deposit') : null;
    setPriceHeader(typeName + ' · from', final, discount > 0 ? base : null, discount > 0 ? discount : null, rider);
  } else {
    const amtEl = document.getElementById('phAmount');
    base = amtEl ? parseInt(amtEl.dataset.defaultAmount, 10) : 0;
    resetPriceHeader();
  }

  const total = base - discount + deposit;
  let rows = `<div class="gd-total-row"><span>${baseLabel}</span><span>₱${base}</span></div>`;
  if (discount > 0) rows += `<div class="gd-total-row gd-total-disc"><span>🎉 ${pct}% OFF</span><span>-₱${discount}</span></div>`;
  rows += `<div class="gd-total-row gd-total-dep"><span>🔒 Security Deposit (refundable)</span><span>+₱${deposit}</span></div>`;
  rowsEl.innerHTML = rows;
  finalEl.textContent = '₱' + total;

  if (refundEl) {
    if (deposit > 0) { refundEl.textContent = '↩ You get ₱' + deposit + ' back when you finish — real cost ₱' + (total - deposit) + '.'; refundEl.style.display = ''; }
    else { refundEl.style.display = 'none'; }
  }

  if (hintEl) {
    if (!selectedType) { hintEl.textContent = 'Pick an account type to see your exact total.'; hintEl.style.display = ''; }
    else if (!selectedDays) { hintEl.textContent = 'Pick a duration to see your exact total.'; hintEl.style.display = ''; }
    else { hintEl.style.display = 'none'; }
  }
}

// Small bridge to Task 1's setPriceHeader(), kept separate from updateTotal
// so this task doesn't need to know Task 1's exact signature inline twice.
function updatePriceHeaderFromSelection(base, discount) {
  const durName = selectedDays === 7 ? 'Weekly' : 'Monthly';
  const typeName = selectedType === 'tr' ? 'trophy' : selectedType === 'ps4' ? 'PS4 primary' : 'non-trophy';
  const final = base - discount;
  const deposit = (selectedType === 'tr' || selectedType === 'ps4') ? PROMO.deposit : 0;
  const rider = deposit > 0 ? ('+ ₱' + deposit + ' refundable deposit') : null;
  setPriceHeader(durName + ' · ' + typeName, final, discount > 0 ? base : null, discount > 0 ? discount : null, rider);
}

// CTA label tracks how much is left to pick. Never disabled — an incomplete
// click scrolls to and shakes the first missing step (see handleMessageUs).
function updateCtaState() {
  const ctaBtn = document.getElementById('ctaBtn');
  const ctaSub = document.getElementById('ctaSub');
  const ctaHint = document.getElementById('ctaHint');
  const ctaMsgLink = document.getElementById('ctaMsgLink');
  const reserveSection = document.getElementById('reserveSection');
  // The rent form and the price summary both belong to a booking that cannot
  // happen when the selected type has no slot. Hiding the whole form (not
  // just its button) is what removes the stranded, unlabelled name input that
  // used to sit above the no-slot banner with nothing to submit it.
  const orderForm = document.getElementById('gdOrderForm');
  const totalBox = document.getElementById('totalBox');
  // Every type full: #gdOrderForm and #ctaBtn were never rendered, so the
  // logic below (which reads them) doesn't apply — only #totalBox needs
  // hiding here, matching the per-type no-slot case above it.
  // The reserve form's hidden type/days fields exist in two flavours: the
  // suffix:'' instance (per-type no-slot) and the suffix:'All' instance (every
  // type sold out). Keep whichever ones are in the DOM in sync with the
  // current selection — including in the ALL_UNAVAIL branch, which returns
  // early below before the suffix:'' writes further down.
  ['', 'All'].forEach(function (sfx) {
    const rt = document.getElementById('resType' + sfx);
    const rd = document.getElementById('resDays' + sfx);
    if (rt) rt.value = selectedType || '';
    if (rd) rd.value = selectedDays || '';
  });

  if (ALL_UNAVAIL) {
    if (totalBox) totalBox.style.display = 'none';
    return;
  }
  if (!ctaBtn) return;

  const oType = document.getElementById('orderType');
  const oDays = document.getElementById('orderDays');
  if (oType) oType.value = selectedType || '';
  if (oDays) oDays.value = selectedDays || '';

  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (selectedType && !hasSlot) {
    ctaBtn.style.display = 'none';
    if (ctaSub) ctaSub.style.display = 'none';
    if (ctaHint) ctaHint.style.display = 'none';
    if (ctaMsgLink) ctaMsgLink.style.display = 'none';
    // Quoting "To send now ₱349" for a type that cannot be booked reads as a
    // price for something unavailable, so the summary goes with the form.
    if (orderForm) orderForm.style.display = 'none';
    if (totalBox) totalBox.style.display = 'none';
    if (reserveSection) reserveSection.style.display = '';
    return;
  }
  ctaBtn.style.display = '';
  if (ctaMsgLink) ctaMsgLink.style.display = '';
  if (orderForm) orderForm.style.display = '';
  if (totalBox) totalBox.style.display = '';
  if (reserveSection) reserveSection.style.display = 'none';

  if (!selectedType) {
    ctaBtn.textContent = 'Pick an account type';
    ctaBtn.classList.add('gd-cta-wait');
    ctaBtn.disabled = true;
    if (ctaSub) ctaSub.style.display = 'none';
    if (ctaHint) ctaHint.style.display = 'none';
  } else if (!selectedDays) {
    ctaBtn.textContent = 'Pick a duration';
    ctaBtn.classList.add('gd-cta-wait');
    ctaBtn.disabled = true;
    if (ctaSub) ctaSub.style.display = 'none';
    if (ctaHint) ctaHint.style.display = 'none';
  } else {
    const rt = computeRentTotal(selectedType, selectedDays);
    ctaBtn.textContent = '🎮 Rent now — ₱' + rt.total;
    ctaBtn.classList.remove('gd-cta-wait');
    ctaBtn.disabled = false;
    if (ctaSub) ctaSub.style.display = '';
    if (ctaHint) ctaHint.style.display = '';
  }
}

// Mirrors whichever mode is active (rent or buy) into the fixed bottom bar.
// Kept independent from updateCtaState()/updateBuyPriceHeader() because its
// button copy is shorter ("Message us" vs "📘 Message Us on Facebook") and
// it has to represent both modes, not just rent.
function syncStickyBar() {
  const kEl = document.getElementById('gdSbKicker');
  const aEl = document.getElementById('gdSbAmount');
  const bEl = document.getElementById('gdSbBtn');
  if (!kEl) return;

  if (currentMode === 'buy') {
    if (!selectedBuyType) {
      const amtEl = document.getElementById('phAmount');
      kEl.textContent = 'From';
      aEl.textContent = '₱' + (amtEl ? amtEl.dataset.defaultBuyAmount : '0');
      bEl.textContent = 'Pick a type';
      bEl.classList.add('gd-cta-wait');
    } else {
      const typeName = selectedBuyType === 'tr' ? 'Trophy · permanent' : 'Non-trophy · permanent';
      kEl.textContent = typeName;
      aEl.textContent = '₱' + BUY_PRICES[selectedBuyType];
      bEl.textContent = 'Message us';
      bEl.classList.remove('gd-cta-wait');
    }
    return;
  }

  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (selectedType && !hasSlot) {
    // The bar has to quote what its button actually leads to — the cost of
    // getting in line — not the rent price, which is the one thing you cannot
    // do for this type. It used to read the game's cheapest rent figure, so a
    // "Reserve a slot" button sat under a number matching neither option
    // below it (Priority is a flat ₱100; Fall in Line is free).
    const kindEl = document.querySelector('.gd-noslot-options input[id^="resKind"]');
    const isQueue = !!kindEl && kindEl.value === 'queue';
    kEl.textContent = 'No slot right now';
    aEl.textContent = isQueue ? 'Free' : '₱100';
    bEl.textContent = isQueue ? 'Join waitlist' : 'Reserve a slot';
    bEl.classList.remove('gd-cta-wait');
    return;
  }
  if (!selectedType) {
    const amtEl = document.getElementById('phAmount');
    kEl.textContent = 'From';
    aEl.textContent = '₱' + (amtEl ? amtEl.dataset.defaultAmount : '0');
    bEl.textContent = 'Pick a type';
    bEl.classList.add('gd-cta-wait');
  } else if (!selectedDays) {
    kEl.textContent = 'Pick a duration';
    aEl.textContent = '';
    bEl.textContent = 'Pick a duration';
    bEl.classList.add('gd-cta-wait');
  } else {
    const rt = computeRentTotal(selectedType, selectedDays);
    kEl.textContent = 'To send now';
    aEl.textContent = '₱' + rt.total;
    bEl.textContent = 'Rent now';
    bEl.classList.remove('gd-cta-wait');
  }
}

function handleStickyBarClick() {
  if (currentMode === 'buy') {
    if (!selectedBuyType) {
      document.getElementById('buyNtCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    document.getElementById('buyCtaBtn')?.click();
    return;
  }
  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (selectedType && !hasSlot) {
    (document.getElementById('reserveSection') || document.getElementById('reserveSectionAll'))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!selectedType) {
    const el = document.getElementById('typeOptions');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('gd-dur-grid-shake');
    setTimeout(() => el?.classList.remove('gd-dur-grid-shake'), 600);
    return;
  } else if (!selectedDays) {
    document.getElementById('durationGrid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightDurationGrid();
    return;
  }
  const nameField = document.getElementById('orderFbName');
  if (nameField) {
    document.getElementById('gdOrderForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nameField.focus();
  } else {
    document.getElementById('ctaBtn')?.click();
  }
}

function updateReserveLinks() {
  const typeLabel = selectedType === 'tr' ? 'Trophy Account' : selectedType === 'ps4' ? 'PS4 Primary Account' : selectedType === 'nt' ? 'Non-Trophy Account' : '';
  const daysLabel = selectedDays ? selectedDays + ' Days' : '';
  let totalLine = '';
  if (selectedType && selectedDays) {
    const rt = computeRentTotal(selectedType, selectedDays);
    totalLine = 'Total: ₱' + rt.total;
    if (rt.discount > 0) totalLine += ' (incl. ' + rt.pct + '% promo discount)';
    if (rt.deposit  > 0) totalLine += ' + ₱' + rt.deposit + ' refundable deposit';
  }
  const ctaMsgLink = document.getElementById('ctaMsgLink');
  if (ctaMsgLink) {
    ctaMsgLink.href = 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(['Hi! I want to RENT a game 🎮','Game: '+gameTitle,typeLabel?'Account Type: '+typeLabel:'',daysLabel?'Duration: '+daysLabel:'',totalLine].filter(Boolean).join('\n'));
  }
  // Both no-slot instances' Messenger fallback links always say PRIORITY
  // RESERVE — that link is the "message us instead of the form" escape
  // hatch, not tied to whichever option card happens to be selected right
  // now (Fall in Line's own path is the form itself, distinguished by the
  // hidden `kind` field, not a separate link).
  ['reserveLink', 'reserveLinkAll'].forEach(id => {
    const rLink = document.getElementById(id);
    if (rLink) rLink.href = 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(['Hi! I want to PRIORITY RESERVE a slot ⭐','Game: '+gameTitle,typeLabel?'Account Type: '+typeLabel:'',daysLabel?'Duration: '+daysLabel:'',totalLine,'Note: I am paying the ₱100 priority reservation fee.'].filter(Boolean).join('\n'));
  });
}

function handleReserveFormSubmit(e, valMsgId) {
  if (!selectedDays) {
    e.preventDefault();
    const msg = '⚠️ Please select a rental duration (Weekly or Monthly) before continuing.';
    const ids = valMsgId ? [valMsgId] : ['reserveValidationMsg1','reserveValidationMsg2'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.offsetParent !== null) { el.textContent = msg; el.style.display = 'block'; setTimeout(() => el.style.display='none', 4000); }
    });
    highlightDurationGrid();
    return false;
  }
  return true;
}

function handleReserveClick(e, type, valMsgId) {
  if (!selectedDays) {
    e.preventDefault();
    const msg = '⚠️ Please select a rental duration (Weekly or Monthly) before continuing.';
    const ids = valMsgId ? [valMsgId] : ['reserveValidationMsg1','reserveValidationMsg2'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.offsetParent !== null) { el.textContent = msg; el.style.display = 'block'; setTimeout(() => el.style.display='none', 4000); }
    });
    highlightDurationGrid();
    return false;
  }
  return true;
}

function handleMessageUs(e) {
  if (!selectedType && !selectedDays) { e.preventDefault(); showValidation('Please select an account type and rental duration first.'); highlightDurationGrid(); return false; }
  if (!selectedDays) { e.preventDefault(); showValidation('Please select a rental duration (Weekly or Monthly) to continue.'); highlightDurationGrid(); return false; }
  const el = document.getElementById('ctaValidationMsg');
  if (el) el.style.display = 'none';
  return true;
}

function showValidation(msg) {
  const el = document.getElementById('ctaValidationMsg');
  if (!el) return;
  el.textContent = '⚠️ ' + msg; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}

function highlightDurationGrid() {
  const grid = document.getElementById('durationGrid');
  if (!grid) return;
  grid.classList.add('gd-dur-grid-shake');
  setTimeout(() => grid.classList.remove('gd-dur-grid-shake'), 600);
}

// Auto-select first available type on load
window.addEventListener('DOMContentLoaded', () => {
  const preferred = (AVAIL.tr ? document.querySelector('input[name="rentalType"][value="tr"]') : null)
    || (AVAIL.nt ? document.querySelector('input[name="rentalType"][value="nt"]') : null)
    || (AVAIL.ps4 ? document.querySelector('input[name="rentalType"][value="ps4"]') : null)
    || document.querySelector('input[name="rentalType"]');
  if (preferred) { preferred.checked = true; onTypeChange(preferred); }
  else { syncStickyBar(); }
  updateReserveLinks();
  // Auto-switch to buy tab if ?mode=buy
  if (new URLSearchParams(window.location.search).get('mode') === 'buy') {
    const buyBtn = document.getElementById('toggleBuy');
    if (buyBtn) setMode('buy');
  }
});

// ── Gameplay image slider ──
let gdIndex = 0;
function gdGo(i) {
  if (gdSlideCount <= 1) return;
  gdIndex = (i + gdSlideCount) % gdSlideCount;
  const track = document.getElementById('gdSliderTrack');
  if (track) track.style.transform = 'translateX(-' + (gdIndex * 100) + '%)';
  document.querySelectorAll('#gdSliderDots .gd-dot').forEach((d, di) => d.classList.toggle('active', di === gdIndex));
  const gdThumbsWrap = document.getElementById('gdThumbs');
  document.querySelectorAll('#gdThumbs .gd-thumb').forEach((t, ti) => {
    t.classList.toggle('active', ti === gdIndex);
    // Horizontal-only, scoped to the thumbnail strip itself — scrollIntoView()
    // can still move the whole page vertically to reveal an element that
    // isn't fully in the viewport. This gallery now sits at the bottom of the
    // page (previously it was near the top, in the 380px cover column), which
    // is exactly the condition that caused this on the reservation page.
    if (ti === gdIndex && gdThumbsWrap) {
      const target = t.offsetLeft - (gdThumbsWrap.clientWidth - t.clientWidth) / 2;
      gdThumbsWrap.scrollTo({ left: target, behavior: 'smooth' });
    }
  });
}
function gdMove(dir) { gdGo(gdIndex + dir); }
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
