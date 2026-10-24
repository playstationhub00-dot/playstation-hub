// Shared name masking. Used wherever a customer-supplied name is shown to
// someone other than that customer — the queue popout, and reviews on the
// game page and homepage — so the rule can't drift between the two.

// "Michael Dela Cruz" -> "Michael D." — enough for someone to recognise their
// own row, not enough to identify a stranger. The given name is never re-cased:
// it renders what the customer typed, only shorter. The trailing initial IS
// upper-cased, because that letter is a format we generate rather than part of
// the name they wrote — without it a lowercase surname like "Bong umban" masks
// to "Bong u.", which reads as a typo.
function maskName(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!s) return 'Guest';
  const parts = s.split(' ');
  const first = parts[0].length > 14 ? parts[0].slice(0, 14) + '…' : parts[0];
  if (parts.length === 1) return first;
  return first + ' ' + parts[parts.length - 1][0].toUpperCase() + '.';
}

// A name the owner types into "Edit name" on a Waitlist row: trimmed, inner
// whitespace collapsed, 1-80 characters. Returns null for anything else so the
// route can refuse it without saving.
function cleanFbName(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  return s && s.length <= 80 ? s : null;
}

module.exports = { maskName, cleanFbName };
