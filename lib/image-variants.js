// Smaller copies of images we host ourselves (/uploads/…).
//
// Game pages keep the original file (posters and gameplay slides, up to 900px).
// Catalog cards and tiny thumbnails ask for a width-capped WebP instead, so a
// card does not download a 900px poster. The copy is
// written once under uploads/_variants and reused. PlayStation CDN urls are
// left alone here except when a caller explicitly asks for a sized srcset;
// those bytes never touch this server.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// 240 stays allowed so a cached page that still asks for it does not 404.
// Cards no longer reference it: a 240px-wide copy of these landscape covers
// is only ~135px tall, and the card is much taller than that.
const CARD_WIDTHS = [480, 720];
const THUMB_WIDTH = 160;
const WIDTHS = new Set([THUMB_WIDTH, 240, ...CARD_WIDTHS]);
// Must stay in step with UNVERSIONED_UPLOAD_NAMES in server.js. Those four
// files are overwritten in place, so a cached smaller copy would go stale.
const BRANDING = /^(favicon-custom|logo-custom|hero-bg-image|hero-bg-video)\./;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const PSN = /^https:\/\/image\.api\.playstation\.com\//;
// Card copies are shown around 100–135px wide. Quality 85 plus an unsharp
// mask left the 720px file only slightly smaller than the upload, and a
// file that was already that narrow was served unchanged. These settings
// are what a catalog card can spare without the cover going soft.
const QUALITY = { 160: 70, 240: 72, 480: 68, 720: 64 };
// Bump when QUALITY or the encoder changes. Old files under
// uploads/_variants/<width>/ are left on disk and never read; the first
// request for each image writes the new copy. Deleting uploads/_variants
// is safe — the next view rebuilds what is still needed.
const VARIANT_VERSION = 'v2';

const MAX_CONCURRENT = 2;
let active = 0;
const waiters = [];
const inflight = new Map();

function isLocalUpload(url) {
  return typeof url === 'string'
    && url.startsWith('/uploads/')
    && !url.startsWith('/uploads/w/')
    && !url.startsWith('/uploads/jpg/');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function basenameOf(url) {
  const base = path.basename(String(url).split('?')[0]);
  return SAFE_NAME.test(base) ? base : '';
}

// A url for one width, or the original when this file should not be rewritten.
function sized(url, width) {
  if (!url || typeof url !== 'string') return '';
  if (isLocalUpload(url)) {
    const base = basenameOf(url);
    if (!base || BRANDING.test(base)) return url;
    return '/uploads/w/' + width + '/' + base;
  }
  if (PSN.test(url)) {
    const stripped = url.replace(/([?&])w=\d+/g, '').replace(/[?&]$/, '').replace(/\?&/, '?');
    return stripped + (stripped.includes('?') ? '&' : '?') + 'w=' + width;
  }
  return url;
}

// Single url for a catalog card that cannot carry a srcset (the browse PS Plus
// list). 720 covers a 2x card; external urls, including PlayStation's, are
// unchanged — the caller appends its own ?w=.
function cardSrc(url) {
  if (!isLocalUpload(url)) return url || '';
  return sized(url, 720) || url;
}

// Single url for a search row or a 30px list thumbnail. External urls stay
// as stored (the PS Plus index already carries its own ?w=).
function thumbSrc(url) {
  if (!isLocalUpload(url)) return url || '';
  return sized(url, THUMB_WIDTH) || url;
}

function cardAttrs(url) {
  if (!url) return '';
  if (!isLocalUpload(url) && !PSN.test(url)) return 'src="' + escAttr(url) + '"';
  const src = sized(url, 480);
  const sharp = sized(url, 720);
  if (!src || src === url) return 'src="' + escAttr(url) + '"';
  // The card slot is about 100–135px wide (see .games-grid), but the cover
  // is landscape inside a 2:3 frame, so the file has to be tall enough to
  // cover the card, not merely as wide as it. sizes="280px" is that height
  // trick: a 1x screen picks 480 and a 2x screen picks 720. Matching the CSS
  // width instead would hand 2x phones the 480 file and soften the cover.
  // The byte savings are in the encoder (QUALITY), not in under-serving.
  return 'src="' + escAttr(src) + '" srcset="' + escAttr(src) + ' 480w, ' + escAttr(sharp) + ' 720w" sizes="280px"';
}

function thumbAttrs(url) {
  if (!url) return '';
  const src = (isLocalUpload(url) || PSN.test(url)) ? sized(url, THUMB_WIDTH) : url;
  return 'src="' + escAttr(src || url) + '"';
}

function takeSlot() {
  return new Promise(resolve => {
    const go = () => { active++; resolve(); };
    if (active < MAX_CONCURRENT) go();
    else waiters.push(go);
  });
}
function releaseSlot() {
  active--;
  const next = waiters.shift();
  if (next) next();
}

function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return '';
}

// Returns { file, type } or { redirect } or null (bad request / missing).
// Never throws for a bad image — the route redirects to the original.
async function ensureVariant({ uploadsDir, width, name }) {
  width = Number(width);
  if (!WIDTHS.has(width) || !SAFE_NAME.test(name || '') || name.startsWith('.')) return null;
  const root = path.resolve(uploadsDir);
  const source = path.resolve(root, name);
  if (source !== path.join(root, name)) return null;
  if (!fs.existsSync(source)) return null;
  const type = contentTypeFor(source);
  if (!type) return null;

  const key = width + '/' + name;
  if (inflight.has(key)) return inflight.get(key);
  const job = buildVariant({ root, source, width, name, type }).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function buildVariant({ root, source, width, name, type }) {
  const cacheDir = path.join(root, '_variants', VARIANT_VERSION, String(width));
  const cached = path.join(cacheDir, name + '.webp');
  const skipMark = cached + '.orig';
  if (fs.existsSync(cached)) return { file: cached, type: 'image/webp' };
  // Re-encoding this file did not shrink it. Remember that so the next view
  // does not run sharp again; the mark is removed with the source.
  if (fs.existsSync(skipMark)) return { file: source, type };

  let meta;
  try {
    meta = await sharp(source).metadata();
  } catch (e) {
    return { redirect: '/uploads/' + name };
  }
  const sourceWidth = meta.width || 0;

  await takeSlot();
  try {
    if (fs.existsSync(cached)) return { file: cached, type: 'image/webp' };
    if (fs.existsSync(skipMark)) return { file: source, type };
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmp = cached + '.tmp-' + process.pid + '-' + crypto.randomBytes(3).toString('hex');
    try {
      let pipeline = sharp(source).rotate();
      // Never enlarge. A file already no wider than the slot is still
      // re-encoded: serving those originals is why some /w/720 URLs weighed
      // the same as the upload.
      if (sourceWidth > width) {
        pipeline = pipeline.resize({ width, withoutEnlargement: true, kernel: sharp.kernel.lanczos3 });
      }
      await pipeline.webp({
        quality: QUALITY[width] || 68,
        effort: 4,
        smartSubsample: true
      }).toFile(tmp);
      const outSize = fs.statSync(tmp).size;
      const srcSize = fs.statSync(source).size;
      // Already a WebP no wider than asked, and the new file is not smaller.
      // Keep the original bytes rather than a larger "variant".
      if (sourceWidth > 0 && sourceWidth <= width && meta.format === 'webp' && outSize >= srcSize) {
        try { fs.unlinkSync(tmp); } catch (err) { /* partial file already gone */ }
        fs.writeFileSync(skipMark, '');
        return { file: source, type };
      }
      fs.renameSync(tmp, cached);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (err) { /* partial file already gone */ }
      return { redirect: '/uploads/' + name };
    }
    return { file: cached, type: 'image/webp' };
  } finally {
    releaseSlot();
  }
}

module.exports = {
  CARD_WIDTHS, THUMB_WIDTH, WIDTHS, QUALITY, VARIANT_VERSION,
  isLocalUpload, sized, cardSrc, thumbSrc, cardAttrs, thumbAttrs, ensureVariant
};
