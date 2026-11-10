// Masks secrets shown in the admin. The real value stays on the server until
// the owner presses Reveal. A form that was never revealed posts a keep flag
// so saving the rest of the form does not wipe the secret with a blank field.
//
// Shoulder-surfing and screenshots are the threat. The owner is already
// signed in, so this is not an access control.

const PAYMENT_KEYS = Object.freeze(['gcash', 'maya', 'paypal', 'bank']);

function maskEmail(email) {
  const s = String(email == null ? '' : email).trim();
  if (!s) return '';
  const at = s.indexOf('@');
  if (at < 1 || at !== s.lastIndexOf('@')) return maskSecret(s);
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  if (dot < 1) return maskSecret(s);
  const name = domain.slice(0, dot);
  const tld = domain.slice(dot);
  return bullets(local, 5) + '@' + bullets(name, 3) + tld;
}

function maskPaymentNumber(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.includes('@')) return maskEmail(s);
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 6) return maskDigits(digits);
  return maskSecret(s);
}

function maskDigits(digits) {
  const head = digits.slice(0, 2);
  const tail = digits.slice(-2);
  const hidden = digits.length - 4;
  if (digits.length === 11) return head + '•• ••• ••' + tail;
  if (digits.length === 10) return head + '•• ••• •' + tail;
  return head + '•'.repeat(Math.max(4, hidden)) + tail;
}

function maskSecret(s) {
  if (!s) return '';
  if (s.length <= 2) return '•'.repeat(s.length);
  return s.slice(0, 1) + '•'.repeat(Math.max(3, s.length - 2)) + s.slice(-1);
}

function bullets(part, max) {
  const n = Math.max(2, Math.min(max, Math.max(part.length - 1, 2)));
  return part.slice(0, 1) + '•'.repeat(n);
}

function isMaskedPaymentKey(key) {
  return PAYMENT_KEYS.includes(String(key || '').trim().toLowerCase());
}

// keep === '1' (or true) means the owner never edited the secret, so the
// stored value wins even when the visible field was posted empty.
// A missing keep flag is an older form: a posted string is the new value.
function resolveKeptSecret(posted, existing, keep) {
  const stored = existing == null ? '' : String(existing);
  if (keep === '1' || keep === true) return stored;
  if (posted === undefined || posted === null) return stored;
  return String(posted).trim();
}

module.exports = {
  PAYMENT_KEYS,
  maskEmail,
  maskPaymentNumber,
  isMaskedPaymentKey,
  resolveKeptSecret
};
