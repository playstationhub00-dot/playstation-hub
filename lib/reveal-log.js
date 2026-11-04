// Append-only log of admin Reveal clicks. The row says who looked at which
// secret and when. It does not store the secret: the log is read in the same
// admin that is allowed to reveal, and copying the value into the log would
// undo the mask.
//
// Capped like the other lowdb logs. lowdb rewrites the whole file on each
// write, so an unbounded array would grow the state document forever.

const CAP = 500;

const FIELD_FOR_KIND = Object.freeze({
  account_email: 'email',
  payment_number: 'number'
});

function append(log, entry, now) {
  const src = entry || {};
  const kind = src.kind;
  if (!FIELD_FOR_KIND[kind]) {
    const err = new Error('unknown reveal kind');
    err.code = 'bad_kind';
    throw err;
  }
  const subject = String(src.subject == null ? '' : src.subject).trim();
  if (!subject) {
    const err = new Error('missing reveal subject');
    err.code = 'bad_subject';
    throw err;
  }
  const actor = String(src.actor || 'admin').trim().slice(0, 80) || 'admin';
  const at = (now instanceof Date ? now : new Date()).toISOString();
  const row = {
    at,
    actor,
    kind,
    subject: subject.slice(0, 120),
    field: FIELD_FOR_KIND[kind]
  };
  const base = Array.isArray(log) ? log.slice() : [];
  base.push(row);
  if (base.length <= CAP) return base;
  return base.slice(base.length - CAP);
}

module.exports = { append, CAP, FIELD_FOR_KIND };
