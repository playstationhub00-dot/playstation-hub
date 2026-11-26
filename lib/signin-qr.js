// One-tap console sign-in. A customer photographs the QR on their PS5 or PS4.
// This module reads that image and, when the code is a Sony sign-in link,
// hands the owner a URL to open on the phone that is already signed into the
// business account.
//
// It does not log into PlayStation, store a PSN password, or call any Sony
// API. Decoding happens here, in process, with pure JavaScript. A photo that
// is not a Sony link is treated as undecodable so the owner still has the
// picture and the typed code.

const jsQR = require('jsqr');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const ALLOWED_HOST_SUFFIXES = Object.freeze([
  'sonyentertainmentnetwork.com',
  'playstation.com',
  'sony.com'
]);

const MAX_URL_LEN = 2048;

function hostAllowed(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || host.includes('%')) return false;
  return ALLOWED_HOST_SUFFIXES.some(root => host === root || host.endsWith('.' + root));
}

// A URL the owner can tap. Anything else — a lookalike host, http, a
// credential stuffed into the URL, a non-URL — comes back as '' so the caller
// falls back to the photo and the typed code.
function acceptedSigninUrl(raw) {
  if (typeof raw !== 'string') return '';
  const text = raw.trim();
  if (!text || text.length > MAX_URL_LEN) return '';
  let url;
  try { url = new URL(text); } catch (e) { return ''; }
  if (url.protocol !== 'https:') return '';
  if (url.username || url.password) return '';
  if (!hostAllowed(url.hostname)) return '';
  return url.toString();
}

function asClamped(data, width, height) {
  if (!data || width < 21 || height < 21) return null;
  const pixels = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
  if (pixels.length < width * height * 4) return null;
  return pixels;
}

function qrTextFromPixels(data, width, height) {
  try {
    const pixels = asClamped(data, width | 0, height | 0);
    if (!pixels) return '';
    const code = jsQR(pixels, width | 0, height | 0);
    return code && code.data ? String(code.data) : '';
  } catch (e) {
    return '';
  }
}

function urlFromPixels(data, width, height) {
  return acceptedSigninUrl(qrTextFromPixels(data, width, height));
}

function pixelsFrom(buffer) {
  if (buffer == null) return null;
  let buf;
  try { buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer); }
  catch (e) { return null; }
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    const png = PNG.sync.read(buf);
    return { data: png.data, width: png.width, height: png.height };
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    const jpg = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 40 });
    return { data: jpg.data, width: jpg.width, height: jpg.height };
  }
  return null;
}

// The text inside the QR, or '' when the bytes are not a JPEG/PNG we can read
// or no code is in the picture. Callers that display a link use urlFromImage,
// which also applies the Sony host allowlist.
function decodeQrImage(buffer) {
  try {
    const px = pixelsFrom(buffer);
    if (!px) return '';
    return qrTextFromPixels(px.data, px.width, px.height);
  } catch (e) {
    return '';
  }
}

function urlFromImage(buffer) {
  return acceptedSigninUrl(decodeQrImage(buffer));
}

// What the owner actually used. A decoded link wins over a typed code, because
// that is the thing they opened. A photo that did not decode is 'photo'.
function methodOf(order) {
  const o = order || {};
  if (o.qr_signin_url) return 'qr_link';
  if (o.qr_code) return 'typed_code';
  return 'photo';
}

function slotKeyFor(accountType) {
  if (accountType === 'tr') return 'trophy';
  if (accountType === 'ps4') return 'ps4_primary';
  return 'non_trophy';
}

function slotTypeFor(slot) {
  if (slot === 'trophy') return 'tr';
  if (slot === 'ps4_primary') return 'ps4';
  return 'nt';
}

function idList(values) {
  const out = [];
  const list = Array.isArray(values) ? values : [values];
  list.forEach(v => {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) out.push(n);
  });
  return out;
}

function slotIsFree(slot) {
  if (!slot || slot.enabled === false) return false;
  if (slot.status !== 'open') return false;
  if (slot.renter_id != null && slot.renter_id !== '') return false;
  return true;
}

// Accounts with a free slot of this order's type that actually carry the game.
// A bundle order pins one account (account_id) even when that account has no
// catalogue game id. The order's own account is the default when it is free.
function freeAccounts(accounts, order, opts) {
  const o = order || {};
  const extra = opts || {};
  const slot = slotKeyFor(o.account_type);
  const want = new Set(idList([o.game_id, extra.psplusGameId].concat(extra.gameIds || [])));
  const pinned = parseInt(o.account_id, 10);
  const pinnedId = Number.isFinite(pinned) ? pinned : null;
  const options = [];
  (accounts || []).forEach(acc => {
    if (!acc || acc.id == null) return;
    const id = parseInt(acc.id, 10);
    if (!Number.isFinite(id)) return;
    const s = acc.slots && acc.slots[slot];
    if (!slotIsFree(s)) return;
    const linked = idList(acc.game_ids).some(gid => want.has(gid));
    if (!linked && id !== pinnedId) return;
    options.push({
      id,
      label: String(acc.label || acc.public_name || ('Account ' + id)).trim() || ('Account ' + id),
      slot
    });
  });
  options.sort((a, b) => a.label.localeCompare(b.label) || (a.id - b.id));
  const selected = options.find(a => a.id === pinnedId) || options[0] || null;
  return { slot, options, selectedId: selected ? selected.id : null };
}

// The account the Signed in button will seat. No free slot is not an error
// when the owner did not post one: legacy games still activate without a
// seat. Posting an account that is not in the free list is an error.
function resolveChoice(accounts, order, postedId, opts) {
  const pick = freeAccounts(accounts, order, opts);
  const raw = postedId == null ? '' : String(postedId).trim();
  const posted = raw === '' ? null : parseInt(raw, 10);
  if (!pick.options.length) {
    if (posted != null && Number.isFinite(posted)) return { ok: false, reason: 'signin_no_slot' };
    return { ok: true, accountId: null, slot: pick.slot, slotType: slotTypeFor(pick.slot) };
  }
  const id = Number.isFinite(posted) ? posted : pick.selectedId;
  const hit = pick.options.find(a => a.id === id);
  if (!hit) return { ok: false, reason: 'signin_no_slot' };
  return { ok: true, accountId: hit.id, slot: hit.slot, slotType: slotTypeFor(hit.slot) };
}

// Fields written as the order becomes active. The link and the code are wiped
// in the same write: they are single-use and the ten-minute window is over.
function activationPatch(order, choice, at) {
  const patch = {
    signin_method: methodOf(order),
    signin_at: at || new Date().toISOString(),
    qr_code: null,
    qr_signin_url: null,
    qr_image: null,
    qr_expires_at: null
  };
  if (choice && choice.accountId) {
    patch.signin_account_id = choice.accountId;
    patch.account_id = choice.accountId;
    if (choice.slotType) patch.slot_type = choice.slotType;
  }
  return patch;
}

function historyExtra(order, choice) {
  const extra = { method: methodOf(order), via: 'signed_in' };
  if (choice && choice.accountId) extra.account_id = choice.accountId;
  return extra;
}

// Back to "send a fresh QR". The customer page reads signin_failed_at.
function failedPatch(at) {
  return {
    qr_image: null,
    qr_code: null,
    qr_signin_url: null,
    qr_expires_at: null,
    signin_failed_at: at || new Date().toISOString()
  };
}

module.exports = {
  ALLOWED_HOST_SUFFIXES,
  acceptedSigninUrl,
  decodeQrImage,
  urlFromImage,
  urlFromPixels,
  methodOf,
  slotKeyFor,
  freeAccounts,
  resolveChoice,
  activationPatch,
  historyExtra,
  failedPatch
};
