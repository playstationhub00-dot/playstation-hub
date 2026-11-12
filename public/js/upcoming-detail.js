
let selectedType = document.querySelector('input[name="rental_type"]:checked')?.value || 'nt';
let selectedDays = null;
let selectedBuyType = null;
// 'rent' = reserve a rental (duration-based, paid in full now). 'buy' =
// pre-order permanent access, also paid in full, on its own dedicated
// panel — it has no duration, so it doesn't share the rent panel's summary
// box, CTA or Messenger link.
let upcomingMode = 'rent';

function setUpcomingMode(mode) {
  upcomingMode = mode === 'buy' ? 'buy' : 'rent';
  const isRent = upcomingMode === 'rent';

  const rentPanel = document.getElementById('udRentPanel');
  if (rentPanel) rentPanel.style.display = isRent ? '' : 'none';
  const buyPanel = document.getElementById('udBuyPanel');
  if (buyPanel) buyPanel.style.display = isRent ? 'none' : '';
  // Fall in Line is a rental-slot concept — a permanent pre-order isn't
  // limited by the same slot pool, so it has nothing to wait in line for.
  const waitlist = document.getElementById('ctaWaitlist');
  if (waitlist) waitlist.style.display = (isRent && ALL_FULL) ? '' : 'none';

  const rentBtn = document.getElementById('udToggleRent');
  const buyBtn  = document.getElementById('udToggleBuy');
  // Guarded separately, not as a pair: the Rent button is always present
  // while the Buy button only exists when a permanent price is set.
  if (rentBtn) rentBtn.classList.toggle('on', isRent);
  if (buyBtn) buyBtn.classList.toggle('on', !isRent);
  if (isRent) { updateSummary(); updateCta(); updateLinks(); }
  syncUpcomingSticky();
}

// Setup-panel handlers, same behaviour as the rent page's: the disclosure
// opens once and shows whichever type is currently selected, rather than each
// pill carrying its own accordion.
function toggleSetupPanel() {
  const panel = document.getElementById('typeSetupWrap');
  const btn = document.getElementById('setupToggle');
  if (!panel || !btn) return;
  const open = panel.dataset.open === '1';
  panel.dataset.open = open ? '0' : '1';
  btn.setAttribute('aria-expanded', String(!open));
}

function syncSetupPanel() {
  document.querySelectorAll('#typeSetupWrap .gd-setup-block').forEach(b => {
    b.style.display = (b.id === 'setup-' + selectedType) ? '' : 'none';
  });
}

function getPrices() { return selectedType === 'tr' ? TR_PRICES : NT_PRICES; }
function getSlots()  { return selectedType === 'tr' ? TR_SLOTS  : NT_SLOTS; }

function onTypeChange() {
  selectedType = document.querySelector('input[name="rental_type"]:checked')?.value || 'nt';
  // renderDurButtons() below re-picks the preferred default (Monthly, same
  // rule as initial load) every time the type changes, rather than trying to
  // carry the old duration across two potentially different price tables —
  // simpler, and it never leaves the summary blank after a type switch.
  document.querySelectorAll('.gd-type-pill').forEach(c => c.classList.remove('gd-type-selected'));
  const checked = document.querySelector('input[name="rental_type"]:checked');
  if (checked) checked.closest('.gd-type-pill').classList.add('gd-type-selected');
  syncSetupPanel();
  renderDurButtons();
  updateSummary();
  updateCta();
  updateOwnStrip();
}

function renderDurButtons() {
  const p = getPrices();
  const grid = document.getElementById('durGrid');
  grid.innerHTML = '';
  const durLabelMap = { 7: 'Weekly · 7 days', 30: 'Monthly · 30 days' };
  const available = RENTAL_DURATIONS.filter(d => p[d]);

  available.forEach(d => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gd-dur-btn';
    btn.dataset.days = d;
    btn.onclick = () => selectDur(d);
    btn.innerHTML = `<span class="gd-dur-days">${durLabelMap[d] || d}</span><span class="gd-dur-price">₱${p[d]}</span>`;
    grid.appendChild(btn);
  });

  // Preselect so the price is visible on load: prefer Monthly (30) when more
  // than one duration exists, otherwise the single available one. Falls back
  // to null (existing "no price set" empty state) when neither is priced.
  const defaultDays = available.includes(30) ? 30 : (available[0] || null);
  if (defaultDays) selectDur(defaultDays);
}

function selectDur(days) {
  selectedDays = days;
  document.querySelectorAll('.gd-dur-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.days) === days));
  updateSummary();
  updateCta();
  updateLinks();
}

// Mirrors the rent page's updateTotal(): the box never hides, the rows are
// rebuilt as innerHTML, the final line is what the customer sends right now,
// and the green rider / grey hint sit underneath it. The arithmetic below is
// unchanged from before — only where each figure is printed has moved.
function updateSummary() {
  const rowsEl  = document.getElementById('sumRows');
  const finalEl = document.getElementById('sumFinal');
  const riderEl = document.getElementById('sumRider');
  const hintEl  = document.getElementById('sumHint');
  if (!rowsEl || !finalEl) return;

  if (!selectedDays) {
    rowsEl.innerHTML = '';
    finalEl.textContent = '—';
    riderEl.style.display = 'none';
    hintEl.textContent = 'Pick a duration to see your exact total.';
    hintEl.style.display = '';
    return;
  }

  const price     = getPrices()[selectedDays] || 0;
  const isTrophy  = selectedType === 'tr';
  const deposit   = isTrophy ? 100 : 0;
  const total     = price + deposit;
  const typeName  = isTrophy ? 'Trophy' : 'Non-Trophy';
  const durName   = selectedDays === 7 ? 'Weekly' : 'Monthly';

  rowsEl.innerHTML =
    '<div class="gd-total-row"><span>Rental · ' + typeName + ', ' + durName + '</span><span>' + (price ? '₱' + price : '—') + '</span></div>' +
    '<div class="gd-total-row gd-total-dep"><span>🔒 Refundable deposit</span><span>+₱' + deposit + '</span></div>';
  // Paid in full now — nothing owed when the game releases. The deposit
  // (Trophy only) is still refundable on its own terms, independent of that;
  // the rider only exists to say so, and has nothing to say otherwise.
  finalEl.textContent = total ? '₱' + total : '—';
  riderEl.textContent = deposit ? '↩ ₱' + deposit + ' of that (the deposit) comes back when you finish.' : '';
  riderEl.style.display = (total && deposit) ? '' : 'none';
  hintEl.style.display = 'none';
}

// The rent page's updateCtaState() pattern, one for one: while the choice is
// incomplete the button names the missing step, greys out via .gd-cta-wait and
// the sub-line stays hidden; once complete it names the action and carries the
// amount the customer sends right now. Rent-only — Buy Permanent has its own
// static button on its own panel (see the udBuyPanel markup / selectUdBuyType).
function updateCta() {
  const btn = document.getElementById('ctaReserveBtn');
  const sub = document.getElementById('ctaReserveSub');
  if (!btn) return;

  const setWait = (label) => {
    btn.textContent = label;
    btn.disabled = true;
    btn.classList.add('gd-cta-wait');
    if (sub) sub.style.display = 'none';
  };
  const setReady = (label, subText) => {
    btn.textContent = label;
    btn.disabled = false;
    btn.classList.remove('gd-cta-wait');
    if (sub) { sub.textContent = subText; sub.style.display = ''; }
  };

  syncUpcomingSticky();
  if (!selectedDays) return setWait('Pick a duration');

  const price   = getPrices()[selectedDays] || 0;
  const deposit = selectedType === 'tr' ? 100 : 0;
  const total   = price + deposit;
  const hasSlot = getSlots() > 0;
  const payNote = (typeof PAY_NOTE === 'string' && PAY_NOTE)
    ? PAY_NOTE
    : 'GCash or Maya for local customers · PayPal for international customers';
  setReady((hasSlot ? '🎮 Reserve now — ₱' : '🎮 Request now — ₱') + total,
    hasSlot
      ? 'Pay in full · ' + payNote + ' · nothing more due on release'
      : 'No slots free right now — pay in full to request one. We refund you if one never opens.');
}

// Rent-only. Buy Permanent's Messenger link is static (no duration, no split
// to report), same as the released-game page's own buy panel.
function updateLinks() {
  if (!selectedDays) return;
  const typeName = selectedType === 'tr' ? 'Trophy' : 'Non-Trophy';
  const price    = getPrices()[selectedDays] || 0;
  const deposit  = selectedType === 'tr' ? 100 : 0;
  const total    = price + deposit;
  const priceStr = total ? '₱' + total : 'TBD';
  const hasSlot  = getSlots() > 0;

  const msg = encodeURIComponent(
    'Hi! I want to ' + (hasSlot ? 'RESERVE' : 'REQUEST') + ' a slot for:\n' +
    'Game: ' + GAME_TITLE + ' (Coming Soon)\n' +
    'Type: ' + typeName + '\n' +
    'Duration: ' + selectedDays + ' Days\n' +
    'Total (paid in full): ' + priceStr
  );
  const el = document.getElementById('reserveLinkSlot');
  if (el) el.href = 'http://m.me/PlaystationHub00?text=' + msg;

  const queueMsg = encodeURIComponent(
    'Hi! I want to JOIN THE WAITLIST for:\n' +
    'Game: ' + GAME_TITLE + ' (Coming Soon)\n' +
    'Type: ' + typeName + '\n' +
    'Duration: ' + selectedDays + ' Days\n' +
    'Total: ' + priceStr
  );
  const ql = document.getElementById('queueLink');
  if (ql) ql.href = 'http://m.me/PlaystationHub00?text=' + queueMsg;
}


function shakeDurGrid() {
  const grid = document.getElementById('durGrid');
  grid.classList.remove('rsv-dur-row-shake');
  void grid.offsetWidth;
  grid.classList.add('rsv-dur-row-shake');
  setTimeout(() => grid.classList.remove('rsv-dur-row-shake'), 600);
}

function handleReserveClick(e, mode) {
  if (!ALL_FULL && !selectedDays) {
    e.preventDefault();
    shakeDurGrid();
    return false;
  }
  return true;
}

function handleReserveSubmit(e) {
  if (!selectedDays) {
    e.preventDefault();
    shakeDurGrid();
    return false;
  }
  document.getElementById('reserveType').value = selectedType;
  document.getElementById('reserveDays').value = selectedDays;
  return true;
}

// ── Buy Permanent panel ── mirrors the released-game page's selectBuyType /
// handleBuyClick: a click-to-select card (not a radio pill) and validation on
// submit rather than a disabled button, since there is nothing to compute —
// just "did they pick a type" and "did they type a name".
function selectUdBuyType(type) {
  selectedBuyType = type;
  const ntCard = document.getElementById('udBuyNtCard');
  const trCard = document.getElementById('udBuyTrCard');
  if (ntCard) ntCard.style.borderColor = type === 'nt' ? '#22c55e' : '#222';
  if (trCard) trCard.style.borderColor = type === 'tr' ? '#ffc400' : 'rgba(255,196,0,0.2)';
  // A full type is pre-ordered as a new slot: say what that means for the picked one.
  ['nt', 'tr'].forEach(t => {
    const note = document.getElementById('udBuyNewSlotNote-' + t);
    if (note) note.hidden = t !== type;
  });
  const typeField = document.getElementById('udBuyOrderType');
  if (typeField) typeField.value = type;
  syncUpcomingSticky();
}

function syncUpcomingSticky() {
  const kicker = document.getElementById('udSbKicker');
  const amount = document.getElementById('udSbAmount');
  const btn = document.getElementById('udSbBtn');
  if (!btn) return;
  if (upcomingMode === 'buy') {
    if (kicker) kicker.textContent = 'Buy permanent';
    const price = selectedBuyType ? (BUY_FINAL[selectedBuyType] || 0) : 0;
    if (amount) amount.textContent = price ? ('₱' + price) : 'Pick a type';
    btn.textContent = 'Pre-order';
    btn.classList.toggle('gd-cta-wait', !selectedBuyType);
    return;
  }
  const ready = !!selectedDays;
  const price = ready ? (getPrices()[selectedDays] || 0) : 0;
  const deposit = ready && selectedType === 'tr' ? 100 : 0;
  const total = price + deposit;
  if (kicker) kicker.textContent = ready ? (selectedDays === 7 ? 'Weekly' : 'Monthly') : 'Reserve';
  if (amount) amount.textContent = ready && total ? ('₱' + total) : 'Pick a duration';
  btn.textContent = ready ? (getSlots() > 0 ? 'Reserve' : 'Request') : 'Reserve';
  btn.classList.toggle('gd-cta-wait', !ready);
}

function upcomingStickyClick() {
  const id = upcomingMode === 'buy' ? 'udBuyCtaBtn' : 'ctaReserveBtn';
  const el = document.getElementById(id);
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function handleUdBuyClick(e) {
  const el = document.getElementById('udBuyValidationMsg');
  if (!selectedBuyType) {
    e.preventDefault();
    el.textContent = '⚠️ Please select Non-Trophy or Trophy account type first.';
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
    ['udBuyNtCard', 'udBuyTrCard'].forEach(id => {
      const c = document.getElementById(id);
      if (c) { c.style.transform = 'translateX(4px)'; setTimeout(() => c.style.transform = '', 200); }
    });
    return false;
  }
  const nameField = document.getElementById('udBuyFbName');
  if (!nameField || !nameField.value.trim()) {
    e.preventDefault();
    el.textContent = '⚠️ Please enter your Facebook name.';
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
    return false;
  }
  return true;
}

// ── Own it instead ── the picked type is full but has a permanent price: the
// gold strip on the Rent tab offers to buy it, and the owner adds a new slot.
// See docs/superpowers/specs/2026-10-22-buy-when-full-new-slot-design.md.
function updateOwnStrip() {
  const strip = document.getElementById('udOwnStrip');
  if (!strip) return;
  const price = BUY_FINAL[selectedType] || 0;
  const show = getSlots() === 0 && price > 0;
  strip.hidden = !show;
  if (!show) return;
  const name = selectedType === 'tr' ? 'Trophy' : 'Non-Trophy';
  strip.querySelectorAll('.ud-own-type').forEach(el => { el.textContent = name; });
  document.getElementById('udOwnGo').textContent = 'Buy ₱' + price + ' →';
}

function ownInstead() {
  setUpcomingMode('buy');
  selectUdBuyType(selectedType);
  const panel = document.getElementById('udBuyPanel');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Init
const initChecked = document.querySelector('input[name="rental_type"]:checked');
if (initChecked) initChecked.closest('.gd-type-pill').classList.add('gd-type-selected');
syncSetupPanel();
renderDurButtons();
// renderDurButtons() reaches updateSummary() through selectDur(), but only when
// at least one duration is priced. Calling it here as well means a game with no
// prices set still shows the summary box with its "Pick a duration" hint rather
// than an empty shell.
updateSummary();
updateCta();
updateOwnStrip();
