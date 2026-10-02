// Counts taps on any Messenger link (m.me/PlaystationHub00) so the admin
// dashboard can show "Messaged us". Loaded by partials/nav.ejs on every public
// page. Never delays or blocks the link: it only fires a small beacon.
//
// A link may say where it sits with data-track-source="nav|fab|footer|game|
// search|search-empty"; anything else is recorded as "other". The server works
// out the game from the page path, so game pages need no extra attributes.
(function () {
  var MESSENGER = /m\.me\/PlaystationHub00/i;

  function send(payload) {
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/track/message', new Blob([body], { type: 'application/json' }))) return;
    } catch (e) { /* fall through to fetch */ }
    try {
      fetch('/api/track/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    } catch (e) { /* tracking must never break a page */ }
  }

  function onTap(e) {
    var a = e && e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !MESSENGER.test(a.getAttribute('href') || '')) return;
    send({ page: location.pathname, source: a.getAttribute('data-track-source') || 'other' });
  }

  if (typeof document !== 'undefined') {
    // Capture phase: a page script that stops propagation cannot hide the tap.
    document.addEventListener('click', onTap, true);
    document.addEventListener('auxclick', onTap, true);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { onTap: onTap, send: send };
})();
