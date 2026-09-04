// Console sign-in code handling — the code a customer reads off their PS5 or
// PS4 sign-in screen and types on their order page, as an alternative to
// photographing the QR beside it.
//
// Pure functions over strings: no network, no database, no PlayStation contact
// of any kind. Approving the sign-in is still a human action in the PlayStation
// App — see
// docs/superpowers/specs/2026-09-04-signin-code-and-owner-alert-design.md for
// why automating that is neither available nor wise.

// A length band, not a format. PlayStation's exact code shape is not documented
// here, and a regex tuned to a guessed format would reject a real code at the
// one moment it matters — with the customer standing at their console and no
// way around it. These bounds catch the failures that actually happen (an empty
// box, a pasted URL, a pasted sentence) and leave everything else to the owner's
// eye, since they see the raw code before using it.
const MIN_LEN = 4;
const MAX_LEN = 16;

// Someone copying a code off a television adds spaces and dashes wherever the
// on-screen grouping suggests, so "abcd-1234", "ABCD 1234" and "abcd1234" all
// have to mean the same thing.
//
// Only strings and numbers are accepted: String({}) is "[object Object]", which
// would strip to a twelve-character alphanumeric run and sail through the length
// check as if it were a real code.
function normalizeCode(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  return String(raw).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function isValidCode(raw) {
  const code = normalizeCode(raw);
  return code.length >= MIN_LEN && code.length <= MAX_LEN;
}

module.exports = { MIN_LEN, MAX_LEN, normalizeCode, isValidCode };
