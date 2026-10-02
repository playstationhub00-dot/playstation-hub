// Validation and de-duplication for the two small tracking beacons the public
// site sends (a Message Us tap, a search that found nothing). Pure: server.js
// does the reading of cookies and writing of rows.

// Where on the site a Messenger link sits. Anything else is stored as 'other'.
const SOURCES = ['nav', 'fab', 'hero', 'footer', 'game', 'search', 'search-empty', 'other'];

function cleanSource(s) {
  return SOURCES.includes(s) ? s : 'other';
}

// A site-relative path, query and hash dropped. null for anything else.
function cleanPage(p) {
  if (typeof p !== 'string') return null;
  const s = p.split('#')[0].split('?')[0];
  if (!s.startsWith('/') || s.startsWith('//') || s.length > 200) return null;
  return s;
}

// '/game/<slug>' → '<slug>', anything else → null.
function gameSlugFromPage(page) {
  const m = /^\/game\/([a-z0-9-]+)\/?$/.exec(String(page || ''));
  return m ? m[1] : null;
}

// A search phrase worth keeping: lower-cased, single-spaced, ≤ 60 chars,
// at least 3 characters. '' when it is not.
function cleanQuery(q) {
  if (typeof q !== 'string') return '';
  const s = q.toLowerCase().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  return s.length >= 3 ? s : '';
}

// True when `rows` already holds a row with the same session_id and every
// other `key` field, recorded within windowMs of nowMs. Rows are appended in
// time order, so only the tail is scanned.
function recentDuplicate(rows, key, nowMs, windowMs) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (nowMs - Date.parse(r.time) > windowMs) return false;
    if (Object.keys(key).every(k => r[k] === key[k])) return true;
  }
  return false;
}

module.exports = { SOURCES, cleanSource, cleanPage, gameSlugFromPage, cleanQuery, recentDuplicate };
