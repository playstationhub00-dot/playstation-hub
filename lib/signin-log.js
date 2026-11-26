// Append-only log of the owner's sign-in actions. The row says which order,
// which account, which method (QR link, typed code, or photo) and when.
// It does not store the link or the code: those are single-use secrets, and
// copying them into a log the admin can scroll would keep them past the
// ten-minute wipe. Same rule as lib/reveal-log.js.
//
// Capped like the other lowdb logs. lowdb rewrites the whole file on each
// write, so an unbounded array would grow the state document forever.

const CAP = 500;
const ACTIONS = Object.freeze(['signed_in', 'ask_fresh']);
const METHODS = Object.freeze(['qr_link', 'typed_code', 'photo']);

function append(log, entry, now) {
  const src = entry || {};
  if (!ACTIONS.includes(src.action)) {
    const err = new Error('unknown sign-in action');
    err.code = 'bad_action';
    throw err;
  }
  const ref = String(src.ref == null ? '' : src.ref).trim();
  if (!/^PH-\d{4,}$/.test(ref)) {
    const err = new Error('missing order ref');
    err.code = 'bad_ref';
    throw err;
  }
  const actor = String(src.actor || 'admin').trim().slice(0, 80) || 'admin';
  const at = (now instanceof Date ? now : new Date()).toISOString();
  const row = { at, actor, action: src.action, ref };
  const id = parseInt(src.account_id, 10);
  if (Number.isFinite(id)) row.account_id = id;
  if (METHODS.includes(src.method)) row.method = src.method;
  const base = Array.isArray(log) ? log.slice() : [];
  base.push(row);
  if (base.length <= CAP) return base;
  return base.slice(base.length - CAP);
}

module.exports = { append, CAP, ACTIONS, METHODS };
