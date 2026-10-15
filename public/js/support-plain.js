// Turns a model reply into the text Messenger can show. The Page renders
// no markdown, so **bold** and heading marks would appear as typed.
// Loaded by the website widget as well, and required from lib/support-facts.js.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.supportPlain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function toPlainText(text) {
    var s = String(text == null ? '' : text).replace(/\r\n/g, '\n');
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');
    s = s.replace(/`([^`\n]+)`/g, '$1');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    s = s.replace(/__([^_\n]+)__/g, '$1');
    s = s.replace(/^#{1,6}\s+/gm, '');
    // "* item" is a markdown bullet. Messenger already shows "- item" fine.
    // "+ ₱100" is a deposit line in a slot reply, not a bullet, so it stays.
    s = s.replace(/^(\s*)[*+]\s+(?!₱|\d)/gm, '$1- ');
    s = s.replace(/\*\*/g, '');
    return s.trim();
  }

  // Website bubbles. Markers become elements; the words stay text nodes, so
  // a reply cannot inject HTML. Messenger uses toPlainText instead, because
  // the Page shows the string as typed.
  function fill(parent, text) {
    var doc = parent.ownerDocument;
    var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    lines.forEach(function (line, idx) {
      if (idx) parent.appendChild(doc.createElement('br'));
      var bullet = /^(\s*)[*+]\s+(?!₱|\d)([\s\S]*)$/.exec(line);
      var row = doc.createElement('span');
      if (bullet) {
        row.appendChild(doc.createTextNode(bullet[1] + '- '));
        appendInline(row, bullet[2], doc);
      } else {
        appendInline(row, line, doc);
      }
      parent.appendChild(row);
    });
  }

  function appendInline(parent, src, doc) {
    var re = /\*\*([^*\n]+)\*\*|__([^_\n]+)__/g;
    var s = String(src || '');
    var last = 0;
    var match;
    while ((match = re.exec(s))) {
      if (match.index > last) parent.appendChild(doc.createTextNode(s.slice(last, match.index)));
      var strong = doc.createElement('strong');
      strong.textContent = match[1] != null ? match[1] : match[2];
      parent.appendChild(strong);
      last = re.lastIndex;
    }
    parent.appendChild(doc.createTextNode(s.slice(last).replace(/\*\*/g, '')));
  }

  return { toPlainText: toPlainText, fill: fill };
});
