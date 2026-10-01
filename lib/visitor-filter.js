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

// 'system' | 'bot' | 'action' (a human form post etc.) | 'page' (a human page view)
function classifyRequest({ method, path, userAgent }) {
  if (isSystemPath(path)) return 'system';
  if (isBotUserAgent(userAgent)) return 'bot';
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' ? 'page' : 'action';
}

module.exports = { isBotUserAgent, isWebhookPath, isSystemPath, classifyRequest };
