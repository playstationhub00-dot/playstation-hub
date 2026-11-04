// Reveal a masked admin secret for 30 seconds and log the look-up.
// The value is not in the page until this returns. Saving a form that was
// never edited still posts the keep flag, so the stored secret stays put.
(function () {
  var REVEAL_MS = 30000;

  function remask(el) {
    if (!el || !el.dataset) return;
    if (el.dataset.mask) el.textContent = el.dataset.mask;
    el.dataset.revealed = '';
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.mask-reveal');
    if (!btn) return;
    e.preventDefault();
    var kind = btn.getAttribute('data-mask-kind');
    var subject = btn.getAttribute('data-mask-subject');
    if (!kind || !subject) return;
    var body = new URLSearchParams();
    body.set('kind', kind);
    body.set('subject', subject);
    fetch('/admin/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      credentials: 'same-origin'
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data || !data.ok) return;
      var value = data.value || '';
      var display = btn.previousElementSibling;
      if (display && display.classList && display.classList.contains('mask-value')) {
        if (!display.dataset.mask) display.dataset.mask = display.textContent;
        display.textContent = value;
        display.dataset.revealed = '1';
        setTimeout(function () { remask(display); }, REVEAL_MS);
      }
      var inputName = btn.getAttribute('data-mask-input');
      if (inputName) {
        var input = document.querySelector('[name="' + inputName + '"]');
        var keep = document.querySelector('[name="' + inputName + '_keep"]');
        if (input) {
          input.value = value;
          input.addEventListener('input', function () { if (keep) keep.value = '0'; }, { once: true });
          setTimeout(function () {
            if (keep && keep.value === '1') input.value = '';
          }, REVEAL_MS);
        }
      }
      if (kind === 'account_email') {
        var email = document.getElementById('accEmailInput');
        var emailKeep = document.getElementById('accEmailKeep');
        var maskEl = document.getElementById('accEmailMask');
        if (maskEl) {
          if (!maskEl.dataset.mask) maskEl.dataset.mask = maskEl.textContent;
          maskEl.textContent = value;
          setTimeout(function () { remask(maskEl); }, REVEAL_MS);
        }
        if (email) {
          email.value = value;
          email.addEventListener('input', function () { if (emailKeep) emailKeep.value = '0'; }, { once: true });
          setTimeout(function () {
            if (emailKeep && emailKeep.value === '1') email.value = '';
          }, REVEAL_MS);
        }
      }
    }).catch(function () {});
  });
})();
