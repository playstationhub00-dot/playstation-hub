// PlayStation's announced, dated games for Coming soon → "Update from
// PlayStation". One query to PlayStation's own site-search index (Algolia —
// the same public search-only key and index as lib/psplus-title-search.js):
// every game page whose release date is still ahead. Games with no announced
// date are not in it. Read only when the owner presses the button; no
// PlayStation account or session involved. Never throws.
const { ALGOLIA_URL, ALGOLIA_APP, ALGOLIA_KEY, ALGOLIA_INDEX } = require('./psplus-title-search');
const { cleanTitle, manilaDate, platformOf } = require('./upcoming-psn');

const IMAGE_HOST = /^https:\/\/image\.api\.playstation\.com\//;
const PRODUCT_TYPES = Object.freeze(['FULL_GAME', 'GAME_BUNDLE']);
const FIELDS = 'productName,releaseDateTimestamp,platforms,genre,conceptId,publisher,image,productType';
const HITS = 200;

function queryBody(nowMs) {
  const params = [
    'query=',
    'hitsPerPage=' + HITS,
    'attributesToRetrieve=' + encodeURIComponent(FIELDS),
    'filters=' + encodeURIComponent('pageType:game AND releaseDateTimestamp > ' + Math.floor(nowMs))
  ].join('&');
  return JSON.stringify({ requests: [{ indexName: ALGOLIA_INDEX, params }] });
}

// Pure. The index reply → games sorted by date then title, or null when the
// reply is not the expected shape (so a changed index reads as a failure,
// not as "nothing upcoming"). Each game:
// { concept_id, title, raw_title, release_date, platform, genres, publisher, image_url }
function parseHits(json, nowMs) {
  const hits = json && Array.isArray(json.results) && json.results[0] && json.results[0].hits;
  if (!Array.isArray(hits)) return null;
  const games = [];
  hits.forEach(h => {
    if (!h) return;
    const conceptId = String(h.conceptId == null ? '' : h.conceptId);
    if (!/^\d+$/.test(conceptId)) return;
    if (!PRODUCT_TYPES.includes(h.productType)) return;
    const ts = Number(h.releaseDateTimestamp);
    if (!Number.isFinite(ts) || ts <= nowMs) return;
    const platform = platformOf(h.platforms);
    if (!platform) return;
    const rawTitle = String(h.productName || '').trim();
    const title = cleanTitle(rawTitle);
    if (!title) return;
    const image = (Array.isArray(h.image) ? h.image : [h.image]).map(String).find(x => IMAGE_HOST.test(x)) || '';
    games.push({
      concept_id: conceptId,
      title,
      raw_title: rawTitle,
      release_date: manilaDate(ts),
      platform,
      genres: Array.isArray(h.genre) ? h.genre.map(String) : [],
      publisher: String(h.publisher || '').trim(),
      image_url: image
    });
  });
  return games.sort((a, b) => a.release_date.localeCompare(b.release_date) || a.title.localeCompare(b.title));
}

// { ok: true, games } or { ok: false, games: [], reason } — reasons: timeout,
// network, http_<status>, bad_json, bad_shape.
async function fetchUpcoming({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 10000 } = {}) {
  const nowMs = now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(ALGOLIA_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Algolia-API-Key': ALGOLIA_KEY, 'X-Algolia-Application-Id': ALGOLIA_APP },
      body: queryBody(nowMs)
    });
    if (!res || !res.ok) return { ok: false, games: [], reason: 'http_' + (res ? res.status : 0) };
    let json;
    try { json = await res.json(); } catch (e) { return { ok: false, games: [], reason: 'bad_json' }; }
    const games = parseHits(json, nowMs);
    if (!games) return { ok: false, games: [], reason: 'bad_shape' };
    return { ok: true, games };
  } catch (e) {
    return { ok: false, games: [], reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { queryBody, parseHits, fetchUpcoming };
