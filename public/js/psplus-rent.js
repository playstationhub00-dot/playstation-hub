function promoPctFor(days) { return PROMO.enabled ? (PROMO.discounts[days] || 0) : 0; }

let selectedType = null;
let selectedDays = null;

function onTypeChange(radio) {
  selectedType = radio.value;
  document.querySelectorAll('.gd-type-card').forEach(c => c.classList.remove('gd-type-selected'));
  document.getElementById('label-' + selectedType)?.classList.add('gd-type-selected');
  updatePrices();
  updateTotal();
  updateLinks();
  const hasSlot = AVAIL[selectedType] !== false;
  const ctaOrderWrap = document.getElementById('ctaOrderWrap');
  const ctaHint = document.getElementById('ctaHint');
  const reserveSection = document.getElementById('reserveSection');
  if (ctaOrderWrap) ctaOrderWrap.style.display = hasSlot ? '' : 'none';
  if (ctaHint) ctaHint.style.display = hasSlot ? '' : 'none';
  if (reserveSection) reserveSection.style.display = hasSlot ? 'none' : '';
  if (typeof qlShow === 'function') { qlShow('', selectedType); qlShow('Wait', selectedType); }
}

function onDurChange(btn) {
  selectedDays = parseInt(btn.dataset.days);
  document.querySelectorAll('.gd-dur-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateTotal();
  updateLinks();
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

function updateTotal() {
  const box = document.getElementById('totalBox');
  // A type with no slot cannot be booked, so quoting its price would advertise
  // something unavailable. Guarded here rather than at the call site because
  // onDurChange() also reaches this function and would otherwise re-show the
  // box after the type change had hidden it.
  const hasSlot = selectedType ? AVAIL[selectedType] !== false : true;
  if (!selectedType || !selectedDays || !hasSlot) { if(box) box.style.display = 'none'; return; }
  const base = PRICES[selectedType][selectedDays];
  const pct = promoPctFor(selectedDays);
  const discount = pct > 0 ? Math.round(base * pct / 100) : 0;
  const deposit  = selectedType === 'tr' ? PROMO.deposit : 0;
  const total    = base - discount + deposit;
  let rows = `<div class="gd-total-row"><span>Base (${selectedDays} days)</span><span>₱${base}</span></div>`;
  if (discount > 0) rows += `<div class="gd-total-row gd-total-disc"><span>🎉 ${pct}% OFF (${selectedDays}-day promo)</span><span>-₱${discount}</span></div>`;
  if (deposit  > 0) rows += `<div class="gd-total-row gd-total-dep"><span>🔒 Security Deposit (refundable)</span><span>+₱${deposit}</span></div>`;
  document.getElementById('totalRows').innerHTML = rows;
  document.getElementById('totalFinal').textContent = '₱' + total;
  if(box) box.style.display = 'block';
}

function updateLinks() {
  const typeLabel = selectedType === 'tr' ? 'Trophy / PS4 Primary' : selectedType === 'nt' ? 'Non-Trophy' : '';
  const daysLabel = selectedDays ? selectedDays + ' Days' : '';
  let totalLine = '';
  if (selectedType && selectedDays) {
    const base = PRICES[selectedType][selectedDays];
    const pct = promoPctFor(selectedDays);
    const discount = pct > 0 ? Math.round(base * pct / 100) : 0;
    const deposit  = selectedType === 'tr' ? PROMO.deposit : 0;
    const total    = base - discount + deposit;
    totalLine = 'Total: ₱' + total;
    if (discount > 0) totalLine += ' (incl. ' + pct + '% promo discount)';
    if (deposit  > 0) totalLine += ' + ₱' + deposit + ' refundable deposit';
  }
  const oType = document.getElementById('orderType');
  const oDays = document.getElementById('orderDays');
  if (oType) oType.value = selectedType || '';
  if (oDays) oDays.value = selectedDays || '';
  const rType = document.getElementById('resType');
  const rDays = document.getElementById('resDays');
  if (rType) rType.value = selectedType || '';
  if (rDays) rDays.value = selectedDays || '';

  const ctaMsgLink = document.getElementById('ctaMsgLink');
  if (ctaMsgLink) {
    const msg = ['Hi! I want to RENT PS Plus Deluxe 🏆', typeLabel ? 'Account Type: ' + typeLabel : '', daysLabel ? 'Duration: ' + daysLabel : '', totalLine].filter(Boolean).join('\n');
    ctaMsgLink.href = 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(msg);
  }
  // Both no-slot instances' Messenger fallback links always say PRIORITY
  // RESERVE — that link is the "message us instead of the form" escape
  // hatch, not tied to whichever option card happens to be selected right
  // now (Fall in Line's own path is the form itself, distinguished by the
  // hidden `kind` field, not a separate link).
  ['reserveLink', 'reserveLinkWait'].forEach(id => {
    const rLink = document.getElementById(id);
    if (rLink) {
      const msg = ['Hi! I want to PRIORITY RESERVE a PS Plus Deluxe slot ⭐', typeLabel ? 'Account Type: ' + typeLabel : '', daysLabel ? 'Duration: ' + daysLabel : '', totalLine, 'Note: I am paying the ₱100 priority reservation fee.'].filter(Boolean).join('\n');
      rLink.href = 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(msg);
    }
  });
}

function handleOrderFormSubmit(e) {
  if (!selectedType || !selectedDays) {
    e.preventDefault();
    const el = document.getElementById('ctaValidationMsg');
    if (el) { el.textContent = '⚠️ Please select an account type and rental duration (Weekly or Monthly) to continue.'; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 4000); }
    highlightDurationGrid();
    return false;
  }
  return true;
}

function handleReserveFormSubmit(e) {
  if (!selectedDays) {
    e.preventDefault();
    const el = document.getElementById('reserveValidationMsg');
    if (el) { el.textContent = '⚠️ Please select a rental duration first.'; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 4000); }
    highlightDurationGrid();
    return false;
  }
  return true;
}

function handleReserveClick(e) {
  if (!selectedDays) {
    e.preventDefault();
    const el = document.getElementById('reserveValidationMsg');
    if (el) { el.textContent = '⚠️ Please select a rental duration first.'; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 4000); }
    highlightDurationGrid();
    return false;
  }
  return true;
}

function handleMessageUs(e) {
  if (!selectedDays) {
    e.preventDefault();
    const el = document.getElementById('ctaValidationMsg');
    if (el) { el.textContent = '⚠️ Please select a rental duration (Weekly or Monthly) to continue.'; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 4000); }
    highlightDurationGrid();
    return false;
  }
  return true;
}

function highlightDurationGrid() {
  const grid = document.getElementById('durationGrid');
  if (!grid) return;
  grid.classList.add('gd-dur-grid-shake');
  setTimeout(() => grid.classList.remove('gd-dur-grid-shake'), 600);
}

window.addEventListener('DOMContentLoaded', () => {
  const first = AVAIL.tr
    ? document.querySelector('input[name="rentalType"][value="tr"]')
    : AVAIL.nt ? document.querySelector('input[name="rentalType"][value="nt"]')
    : document.querySelector('input[name="rentalType"]');
  if (first) { first.checked = true; onTypeChange(first); }
  updateLinks();
});
