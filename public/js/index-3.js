(function(){
  const el = document.getElementById('promoCountdown');
  if (!el) return;
  const endsAt = parseInt(el.dataset.ends, 10);
  function tick() {
    const diff = endsAt - Date.now();
    if (diff <= 0) { el.textContent = ''; return; }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    el.textContent = d > 0 ? `Ends in ${d}d ${h}h` : (h > 0 ? `Ends in ${h}h ${m}m` : `Ends in ${m}m`);
  }
  tick();
  setInterval(tick, 60000);
})();
