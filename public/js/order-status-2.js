(function () {
  var node = document.getElementById('ordPoll');
  if (!node || !window.fetch) return;

  var ref = node.dataset.ref, key = node.dataset.key, state = node.dataset.state;
  if (!ref || !key) return;

  // Only the states the OWNER moves. An active rental changes on its end date,
  // not because someone clicked something, so polling it would be a request a
  // minute that can never come back different.
  var WAITING = ['awaiting_payment', 'verifying_payment', 'awaiting_qr', 'qr_pending', 'verifying_return'];
  if (WAITING.indexOf(state) === -1) return;

  // Slow enough to be free at this traffic, quick enough that confirming a
  // payment feels immediate to whoever is staring at the page.
  var EVERY_MS = 8000;
  // A phone left on this page overnight must not poll until the battery dies.
  var GIVE_UP_AFTER_MS = 30 * 60 * 1000;
  var startedAt = Date.now();
  var stopped = false;
  var timer = null;

  function stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; }

  // Reload bookkeeping, per order, in sessionStorage so it survives the very
  // reload it is counting. Every read and write is guarded: private browsing
  // throws on access, and a customer in private mode should still get the
  // refresh, just without the safety net.
  var RELOAD_KEY = 'ordReloads:' + ref;
  var RELOAD_WINDOW_MS = 60000;

  function reloadHistory() {
    try {
      var raw = window.sessionStorage.getItem(RELOAD_KEY);
      var at = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(at)) return [];
      var cutoff = Date.now() - RELOAD_WINDOW_MS;
      return at.filter(function (t) { return typeof t === 'number' && t > cutoff; });
    } catch (e) { return []; }
  }

  function reloadsRecently() { return reloadHistory().length; }

  function noteReload() {
    try {
      var at = reloadHistory();
      at.push(Date.now());
      window.sessionStorage.setItem(RELOAD_KEY, JSON.stringify(at));
    } catch (e) {}
  }

  function schedule() {
    if (stopped) return;
    if (Date.now() - startedAt > GIVE_UP_AFTER_MS) return stop();
    timer = setTimeout(check, EVERY_MS);
  }

  function check() {
    // Nothing to see while the tab is in the background; the visibility
    // handler picks it straight back up, which also covers a phone waking.
    if (document.hidden) return schedule();

    fetch('/order/' + encodeURIComponent(ref) + '/state?k=' + encodeURIComponent(key), {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || !data.ok) throw new Error('refused');
      if (data.state && data.state !== state) {
        // The page is rendered entirely from the order, so a reload is the
        // honest way to show the new step rather than patching one line of it.
        //
        // Guarded against reloading forever. This only triggers when the state
        // the page rendered with disagrees with the live one, and the two are
        // supposed to converge on the next load — but if anything ever made
        // them disagree permanently, an unguarded version of this would spin
        // the customer's page in a loop they could not read or escape. Three
        // is well past any legitimate run of changes in a minute.
        if (reloadsRecently() >= 3) return stop();
        noteReload();
        stop();
        window.location.reload();
        return;
      }
      schedule();
    }).catch(function () {
      // A dropped connection is not a reason to stop waiting; the page simply
      // tries again on the next tick.
      schedule();
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !stopped && !timer) check();
  });

  schedule();
})();
