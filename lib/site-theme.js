// The public site's holiday theme, picked in Admin → Settings → Holiday theme
// and stored as site_settings.theme. '' means no theme. Anything that isn't a
// listed theme counts as '', so a bad or missing value leaves the site as it is.
// views/partials/head.ejs loads public/css/theme-<name>.css for the theme.

const THEMES = ['halloween', 'christmas'];
const LABELS = { '': 'None', halloween: '🎃 Halloween', christmas: '🎄 Christmas' };

function normalizeTheme(value) {
  const s = String(value || '').trim().toLowerCase();
  return THEMES.includes(s) ? s : '';
}

// The theme a request shows. The admin panel never shows one.
function themeFor(path, settings) {
  if (String(path || '').startsWith('/admin')) return '';
  return normalizeTheme(settings && settings.theme);
}

module.exports = { THEMES, LABELS, normalizeTheme, themeFor };
