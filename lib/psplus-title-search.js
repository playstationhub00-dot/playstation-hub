// Finds a real PlayStation cover for a game title that isn't in our stored PS
// Plus lists — used for the owner's monthly picks, which come in as free text
// (lib/psplus-catalog-view.js's monthlyTags "tiles"). Uses PlayStation's own
// site-search index (Algolia, the same one playstation.com's search box
// calls), with a public search-only key — read-only, no PlayStation account
// or session involved. Never throws; a game it can't find just keeps its
// plain title tile.
const ALGOLIA_APP = 'ULS2J1QB99';
const ALGOLIA_KEY = 'f7707c451051886764c823f7090c0957';
const ALGOLIA_INDEX = 'crawler_en-us';
const ALGOLIA_URL = 'https://' + ALGOLIA_APP.toLowerCase() + '-dsn.algolia.net/1/indexes/*/queries';

const IMAGE_HOST = /^https:\/\/image\.api\.playstation\.com\//;
const STORE_HOST = /^https:\/\/store\.playstation\.com\//;
// The search index also has a plain https://www.playstation.com/.../games/<slug>/
// info page for every title, which is more useful to a customer than a store
// checkout link when we only have loose text and no concept id to build one.
const INFO_HOST = /^https:\/\/www\.playstation\.com\/[a-z-]+\/games\//;

function pickHit(hits, title) {
  if (!hits || !hits.length) return null;
  const q = String(title || '').trim().toLowerCase();
  // Prefer a hit whose own title contains ours (or vice versa) over the
  // first result Algolia ranked highest — "Madden NFL 26" must not silently
  // resolve to "College Football 26" just because it scored a fraction higher.
  const match = hits.find(h => {
    const t = String((h && h.productName) || '').toLowerCase();
    return t && (t.includes(q) || q.includes(t));
  });
  return match || hits[0];
}

// Never throws: every failure comes back as { ok: false, reason }.
async function searchCover(title, { timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  const q = String(title || '').trim();
  if (!q) return { ok: false, reason: 'empty_title' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(ALGOLIA_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-API-Key': ALGOLIA_KEY,
        'X-Algolia-Application-Id': ALGOLIA_APP
      },
      body: JSON.stringify({
        requests: [{
          indexName: ALGOLIA_INDEX,
          params: 'query=' + encodeURIComponent(q) + '&hitsPerPage=5&filters=' + encodeURIComponent('pageType:game')
        }]
      })
    });
    if (!res || !res.ok) return { ok: false, reason: 'http_' + (res ? res.status : 0) };
    let json;
    try { json = await res.json(); } catch (e) { return { ok: false, reason: 'bad_json' }; }
    const hits = json && json.results && json.results[0] && json.results[0].hits;
    const hit = pickHit(hits, q);
    if (!hit) return { ok: false, reason: 'no_match' };
    const image = Array.isArray(hit.image) ? String(hit.image[0] || '') : '';
    const url = String(hit.url || '');
    return {
      ok: true,
      name: String(hit.productName || q),
      image_url: IMAGE_HOST.test(image) ? image : '',
      store_url: (STORE_HOST.test(url) || INFO_HOST.test(url)) ? url : ''
    };
  } catch (e) {
    return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { searchCover, pickHit, ALGOLIA_URL, ALGOLIA_APP, ALGOLIA_KEY, ALGOLIA_INDEX };
