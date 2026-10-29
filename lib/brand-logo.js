// Built-in PlayStation Hub wordmarks. The light file is white text for dark
// backgrounds; the dark file is #111111 text for white backgrounds. Neither
// file belongs on the brand yellow — the cross blends into it.
//
// New filenames on purpose. Cloudflare keeps static assets for a long time,
// so replacing /uploads/logo-custom.png in place would leave visitors on the
// old black-plate logo. These URLs have never been cached.
const LIGHT = '/logo-hub-light.png';
const LIGHT_4X = '/logo-hub-light-4x.png';
const DARK = '/logo-hub-dark.png';
const DARK_4X = '/logo-hub-dark-4x.png';

// Paths that meant "the site logo" before the transparent wordmark. The
// admin uploader still writes /uploads/logo-custom.<ext> (see server.js).
// That name is legacy only until logo_builtin_at is stamped; after that it
// is an admin's own file and must be shown as uploaded.
function isLegacy(logoPath) {
  if (!logoPath) return true;
  if (logoPath === '/logo.svg' || logoPath === '/logo.png') return true;
  return /^\/uploads\/logo-custom\.[A-Za-z0-9]+$/.test(logoPath);
}

function isBuiltin(logoPath) {
  return logoPath === LIGHT || logoPath === LIGHT_4X || logoPath === DARK || logoPath === DARK_4X;
}

function isStock(settings) {
  const logoPath = settings && settings.logo_path;
  if (!logoPath || isBuiltin(logoPath)) return true;
  if (isLegacy(logoPath) && !(settings && settings.logo_builtin_at)) return true;
  return false;
}

// variant 'light' (default) or 'dark'. A custom upload has one file, so both
// variants return it.
function resolve(settings, variant) {
  if (!isStock(settings)) {
    return { src: settings.logo_path, srcset: '', width: 230, height: 56, custom: true };
  }
  if (variant === 'dark') {
    return {
      src: DARK,
      srcset: DARK + ' 1x, ' + DARK_4X + ' 4x',
      width: 409,
      height: 111,
      custom: false
    };
  }
  return {
    src: LIGHT,
    srcset: LIGHT + ' 1x, ' + LIGHT_4X + ' 4x',
    width: 409,
    height: 111,
    custom: false
  };
}

// Social cards stay on the historical /logo.svg. The transparent wordmark is
// white and disappears on a light preview. A custom admin upload still wins.
function socialImage(settings) {
  if (isStock(settings)) return '/logo.svg';
  return (settings && settings.logo_path) || '/logo.svg';
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Brand yellow (the #F5B800 / #F0A500 family) swallows the dark wordmark.
// A light page background uses the dark file; everything else, including
// yellow, uses the light file.
function isBrandYellow(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  if (rgb.b > 80) return false;
  if (rgb.r < 180 || rgb.g < 120) return false;
  return rgb.r >= rgb.g && (rgb.r - rgb.b) > 120;
}

function variantForBackground(hex) {
  if (isBrandYellow(hex)) return 'light';
  const rgb = hexToRgb(hex);
  if (!rgb) return 'light';
  const lin = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  return L > 0.62 ? 'dark' : 'light';
}

// One-time. Rewrites a legacy logo_path to the built-in light file and stamps
// logo_builtin_at so a later upload of logo-custom.png is kept.
// Returns true when it wrote.
function applyMigration(db) {
  const s = db.get('site_settings').value() || {};
  if (s.logo_builtin_at) return false;
  if (isLegacy(s.logo_path)) {
    db.set('site_settings.logo_path', LIGHT).write();
  }
  db.set('site_settings.logo_builtin_at', new Date().toISOString()).write();
  return true;
}

module.exports = {
  LIGHT,
  LIGHT_4X,
  DARK,
  DARK_4X,
  isLegacy,
  isBuiltin,
  isStock,
  resolve,
  socialImage,
  applyMigration,
  isBrandYellow,
  variantForBackground
};
