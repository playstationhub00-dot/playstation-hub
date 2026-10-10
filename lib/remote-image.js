// Downloads one PlayStation image and saves it into the uploads folder as a
// WebP, the way server.js's processUploadedImage saves an owner's upload — so
// the picture is the site's own file from then on and survives a Release.
// Only PlayStation's image CDN is fetched, and redirects are refused so a
// redirect cannot lead the fetch off that host. Never throws: any failure (wrong
// host, too big, timeout, not an image) comes back as ''.
const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');

const ALLOWED = /^https:\/\/image\.api\.playstation\.com\//;
const MAX_BYTES = 10 * 1024 * 1024;

async function saveRemoteImage(url, { uploadsDir, fetchImpl = globalThis.fetch, maxDim = 900, timeoutMs = 15000 } = {}) {
  if (!ALLOWED.test(String(url || '')) || !uploadsDir) return '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'error' });
    if (!res || !res.ok) return '';
    if (res.url && !ALLOWED.test(res.url)) return '';
    if (Number(res.headers && res.headers.get && res.headers.get('content-length')) > MAX_BYTES) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return '';
    const name = 'psn-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.webp';
    await sharp(buf)
      .rotate()
      .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(path.join(uploadsDir, name));
    return '/uploads/' + name;
  } catch (e) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { saveRemoteImage, MAX_BYTES };
