// Decides which incoming requests count as visitors. Robots, link-preview
// fetchers, uptime pings and system traffic (payment / Messenger webhooks and
// the site's own /api calls) must not become "sessions" on the dashboard.
// Pure: no database, no Express — server.js calls classifyRequest() per request.

// Case-insensitive fragments of known non-human user-agents.
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegram|bingpreview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|go-http-client|okhttp|axios|node-fetch/i;

function isBotUserAgent(ua) {
  const s = String(ua == null ? '' : ua).trim();
  return !s || BOT_UA.test(s);
}

function isWebhookPath(p) {
  const s = String(p == null ? '' : p);
  return s === '/webhook' || s.startsWith('/webhooks/');
}

// Webhooks, plus /api/* (called by real browsers for search, tracking, etc. —
// never a page view).
function isSystemPath(p) {
  const s = String(p == null ? '' : p);
  return isWebhookPath(s) || s.startsWith('/api/');
}

// Scanner probes that are not shop pages. Historical rows were stored before
// this check existed, so the traffic tab also drops them at read time.
function isProbePath(p) {
  let s = String(p == null ? '' : p).split('?')[0].trim();
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  if (!s || s === '/') return false;
  const lower = s.toLowerCase();
  if (/\/\.[^/]+/.test(lower)) return true;
  if (/\.(php|asp|aspx|jsp|cgi|sql|bak|ini|ya?ml|sh)$/.test(lower)) return true;
  return /(^|\/)(env|dockerfile|docker-compose|wp-admin|wp-login|wp-content|wp-includes|xmlrpc|phpmyadmin|pma|adminer|actuator|server-status|server-info|cgi-bin|boaform|hnap1|id_rsa|telescope|phpinfo|phpunit|web\.config|composer\.(json|lock)|package\.json|etc\/passwd)(\/|$)/.test(lower);
}

// The order page polls /order/:ref/state. Those hits are not pages anyone
// browsed, and they used to crowd out real pages in the top-pages list.
function isOrderStatePath(p) {
  const s = String(p == null ? '' : p).split('?')[0].trim();
  return /^\/order\/[^/]+\/state\/?$/i.test(s);
}

// 'system' | 'bot' | 'action' (a human form post etc.) | 'page' (a human page view)
function classifyRequest({ method, path, userAgent }) {
  if (isSystemPath(path)) return 'system';
  if (isProbePath(path) || isBotUserAgent(userAgent)) return 'bot';
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' ? 'page' : 'action';
}

module.exports = { isBotUserAgent, isWebhookPath, isSystemPath, isProbePath, isOrderStatePath, classifyRequest };
