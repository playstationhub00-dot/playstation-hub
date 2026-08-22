// Customer-submitted game requests. Like orders, these are written by customers
// rather than by the admin, so they live as individual MongoDB documents instead
// of inside the lowdb blob that server.js rewrites wholesale — two people
// requesting at the same moment must not lose one another's write.
//
// One document per TITLE, never per vote: the vote count is voters.length, and
// keeping the voters themselves is what turns the ranking into a waiting list
// the owner can message once a game is stocked.

const STATUSES = Object.freeze(['pending', 'approved', 'stocked', 'rejected']);
// What the public board renders. 'pending' is deliberately absent — a brand-new
// title is invisible until the owner approves it, which is what keeps
// customer-typed text off the storefront.
const PUBLIC_STATUSES = Object.freeze(['approved', 'stocked']);

let _getDb = null;

function init(getDbFn) { _getDb = getDbFn; }

async function _col() {
  if (!_getDb) throw new Error('lib/requests: init(getDb) was never called');
  const db = await _getDb();
  return db ? db.collection('game_requests') : null;
}

// Same normalisation as server.js's gameSlug(), duplicated so this module stays
// usable without importing from server.js (which would be a circular import).
function slugify(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// First whitespace-separated token only. The public board never shows a full name.
function firstName(fbName) {
  return String(fbName || '').trim().split(/\s+/)[0] || 'Someone';
}

function _hasVoted(doc, { fb_name, session_id }) {
  const nameLower = String(fb_name || '').trim().toLowerCase();
  return (doc.voters || []).some(v =>
    (session_id && v.session_id && v.session_id === session_id) ||
    (nameLower && String(v.fb_name || '').trim().toLowerCase() === nameLower)
  );
}

async function getBySlug(slug) {
  const col = await _col();
  if (!col) return null;
  return col.findOne({ slug });
}

async function listByStatus(statuses) {
  const col = await _col();
  if (!col) return [];
  return col.find({ status: { $in: statuses } }).toArray();
}

// Everything the public board shows, ranked by vote count descending.
async function listPublic() {
  const rows = await listByStatus(PUBLIC_STATUSES);
  return rows.sort((a, b) => (b.voters || []).length - (a.voters || []).length);
}

// Everything the admin sees: pending first (they need action), then the rest by votes.
async function listForAdmin() {
  const col = await _col();
  if (!col) return [];
  const rows = await col.find({}).toArray();
  return rows.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (b.status === 'pending' && a.status !== 'pending') return 1;
    return (b.voters || []).length - (a.voters || []).length;
  });
}

// Creates a new pending request with its first vote already recorded.
// Returns { ok: false, reason: 'exists' } if the slug is taken, so the caller can
// redirect the customer to vote on the existing entry instead of duplicating it.
async function createRequest({ title, fb_name, session_id, cover_image }) {
  const col = await _col();
  if (!col) return { ok: false, reason: 'no_db' };
  const clean = String(title || '').trim();
  if (!clean) return { ok: false, reason: 'empty' };
  const slug = slugify(clean);
  if (!slug) return { ok: false, reason: 'empty' };

  const existing = await col.findOne({ slug });
  if (existing) return { ok: false, reason: 'exists', slug };

  const now = new Date().toISOString();
  const doc = {
    slug,
    title: clean,
    status: 'pending',
    voters: [{ fb_name: String(fb_name || '').trim(), session_id: session_id || null, at: now }],
    game_id: null,
    cover_image: cover_image || '',
    created_at: now,
    updated_at: now
  };
  try {
    await col.insertOne(doc);
  } catch (e) {
    // Unique index race: someone created the same slug between the findOne and
    // here. Treat it as an existing entry rather than an error.
    if (e && e.code === 11000) return { ok: false, reason: 'exists', slug };
    throw e;
  }
  return { ok: true, doc };
}

// Adds a vote to an existing request. Only 'approved' and 'pending' accept votes —
// a stocked game no longer needs them, and a rejected one should not accumulate.
async function addVote(slug, { fb_name, session_id }) {
  const col = await _col();
  if (!col) return { ok: false, reason: 'no_db' };
  const doc = await col.findOne({ slug });
  if (!doc) return { ok: false, reason: 'not_found' };
  if (!['approved', 'pending'].includes(doc.status)) return { ok: false, reason: 'closed' };
  if (_hasVoted(doc, { fb_name, session_id })) return { ok: false, reason: 'duplicate' };

  const name = String(fb_name || '').trim();
  const now = new Date().toISOString();
  // Re-check the dedup condition inside the filter (not just the earlier read) so two
  // simultaneous votes from the same voter can't both pass the findOne check above and
  // both get pushed — only one findOneAndUpdate can match the not-already-voted filter.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dupClauses = [];
  if (session_id) dupClauses.push({ session_id });
  if (escaped) dupClauses.push({ fb_name: { $regex: '^' + escaped + '$', $options: 'i' } });
  const filter = dupClauses.length
    ? { slug, voters: { $not: { $elemMatch: { $or: dupClauses } } } }
    : { slug };

  const r = await col.findOneAndUpdate(
    filter,
    {
      $push: { voters: { fb_name: name, session_id: session_id || null, at: now } },
      $set: { updated_at: now }
    },
    { returnDocument: 'after' }
  );
  const updated = r && r.value ? r.value : r;
  if (!updated) return { ok: false, reason: 'duplicate' };
  return { ok: true, count: (updated.voters || []).length };
}

async function setStatus(slug, status, patch) {
  const col = await _col();
  if (!col) return false;
  if (!STATUSES.includes(status)) return false;
  const r = await col.updateOne(
    { slug },
    { $set: Object.assign({}, patch || {}, { status, updated_at: new Date().toISOString() }) }
  );
  return r.matchedCount > 0;
}

// Sets or replaces a request's cover image. Called from the admin upload route,
// and from the auto-inherit paths in server.js (request creation, stocking) —
// this function itself has no overwrite guard; the caller decides whether an
// existing cover_image should be left alone.
async function setCoverImage(slug, coverImage) {
  const col = await _col();
  if (!col) return false;
  const r = await col.updateOne(
    { slug },
    { $set: { cover_image: coverImage || '', updated_at: new Date().toISOString() } }
  );
  return r.matchedCount > 0;
}

async function remove(slug) {
  const col = await _col();
  if (!col) return false;
  const r = await col.deleteOne({ slug });
  return r.deletedCount > 0;
}

// Called once at startup. Without the unique index two simultaneous createRequest
// calls could both pass the findOne check and insert the same slug twice.
async function ensureIndexes() {
  const col = await _col();
  if (!col) return;
  await col.createIndex({ slug: 1 }, { unique: true });
}

module.exports = {
  STATUSES, PUBLIC_STATUSES,
  init, slugify, firstName, ensureIndexes,
  getBySlug, listByStatus, listPublic, listForAdmin,
  createRequest, addVote, setStatus, setCoverImage, remove
};
