// Website half of the support assistant. The server owns the thread, so this
// file only shows bubbles and posts the latest line. Bot replies go through
// supportPlain.fill, which keeps the words in text nodes. A customer's own
// line is shown exactly as typed.
(function () {
  var launcher = document.getElementById('phsLauncher');
  var panel = document.getElementById('phsPanel');
  var log = document.getElementById('phsLog');
  var form = document.getElementById('phsForm');
  var input = document.getElementById('phsInput');
  var closeBtn = document.getElementById('phsClose');
  if (!launcher || !panel || !log || !form || !input) return;

  var greeted = false;
  var busy = false;

  function bubble(text, kind) {
    var el = document.createElement('div');
    el.className = 'phs-msg phs-msg-' + kind;
    if (kind === 'me' || !window.supportPlain) el.textContent = text;
    else window.supportPlain.fill(el, text);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function openPanel() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    if (!greeted) {
      greeted = true;
      bubble('Hi! Ask about a game, prices, or how to rent. Taglish is fine.', 'bot');
    }
    input.focus();
  }

  function closePanel() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
  }

  launcher.addEventListener('click', function () {
    if (panel.hidden) openPanel();
    else closePanel();
  });
  if (closeBtn) closeBtn.addEventListener('click', closePanel);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    bubble(text, 'me');
    busy = true;
    input.disabled = true;
    var sendBtn = form.querySelector('.phs-send');
    if (sendBtn) sendBtn.disabled = true;

    fetch('/api/support/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ message: text })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, data: data || {} };
      });
    }).then(function (out) {
      var data = out.data;
      if (data.paused) {
        bubble('This chat is with an admin now. The bot stays quiet until they resume it.', 'wait');
        return;
      }
      if (data.reply) {
        bubble(data.reply, data.handedOff ? 'wait' : 'bot');
        return;
      }
      if (out.status === 429) {
        bubble('Sandali lang — too many messages. Try again in a few minutes.', 'wait');
        return;
      }
      bubble('Something went wrong on my side. Reply ADMIN to talk to a person.', 'wait');
    }).catch(function () {
      bubble('Can’t reach the shop right now. Try again in a bit.', 'wait');
    }).then(function () {
      busy = false;
      input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      input.focus();
    });
  });
})();
