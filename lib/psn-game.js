// Reads a game's public details from PlayStation Store: overview, rating,
// genres, release date, publisher, voice languages, age rating, screenshots and
// trailers. Used by the admin "Update from PlayStation" buttons; the public
// site never calls this — it only reads what was stored on the game.
//
// Two public sources, no PlayStation account or session involved:
//   1. PlayStation's site-search index (Algolia, same key as
//      lib/psplus-title-search.js) turns a title into a concept id.
//   2. The store page https://store.playstation.com/en-us/concept/<id> embeds the
//      rest as JSON inside its HTML.
// Nothing here throws: every failure comes back as { ok: false, reason }.
const { ALGOLIA_URL, ALGOLIA_APP, ALGOLIA_KEY, ALGOLIA_INDEX } = require('./psplus-title-search');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const IMG_HOST = /^https:\/\/image\.api\.playstation\.com\//;
const VIDEO_HOST = /^https:\/\/vulcan\.dl\.playstation\.net\//;
// A concept or product page on the store, any locale.
const STORE_LINK = /^https:\/\/store\.playstation\.com\/[a-z]{2}-[a-z]{2}\/(concept|product)\/[A-Za-z0-9_.-]+\/?$/;

const LANGS = {
  ar: 'Arabic', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', en: 'English', es: 'Spanish',
  es_MX: 'Latin American Spanish', fi: 'Finnish', fr: 'French', fr_CA: 'Canadian French', hu: 'Hungarian',
  id: 'Indonesian', it: 'Italian', ja: 'Japanese', ko: 'Korean', nl: 'Dutch', no: 'Norwegian', pl: 'Polish',
  pt: 'Portuguese', pt_BR: 'Brazilian Portuguese', ro: 'Romanian', ru: 'Russian', sv: 'Swedish', th: 'Thai',
  tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese', zh: 'Chinese', zh_Hans: 'Chinese (Simplified)',
  zh_Hant: 'Chinese (Traditional)'
};

const MAX_SCREENSHOTS = 12;
const MAX_VIDEOS = 3;

// The owner's pasted store link, or '' when it is not a PlayStation Store page.
function cleanLink(s) {
  const t = String(s == null ? '' : s).trim();
  return STORE_LINK.test(t) ? t : '';
}

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// "Game: Deluxe Edition" → "Game" — a second search tries the base name.
function titleCandidates(title) {
  const t = String(title || '').trim();
  const base = t.replace(/\s*[-–:]?\s*(deluxe|standard|ultimate|digital|gold|complete|premium|definitive|special)\s+edition\s*$/i, '').trim();
  return base && base !== t ? [t, base] : [t];
}

// ── Parsing ────────────────────────────────────────────────────────────────
const JSON_STR = '((?:[^"\\\\]|\\\\.)*)';

function unjson(s) {
  try { return JSON.parse('"' + s + '"'); } catch (e) { return s; }
}

function first(html, re) {
  const m = re.exec(html);
  return m ? unjson(m[1]) : '';
}

function all(html, re) {
  const out = [];
  let m;
  const g = new RegExp(re.source, 'g');
  while ((m = g.exec(html))) out.push(unjson(m[1]));
  return out;
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

// Store descriptions are small HTML (<br/>, <b>, <li>). Returns plain text
// paragraphs separated by a blank line, without the store's fine print
// ("*There are other bundles that include this product…").
function cleanDescription(raw) {
  const text = String(raw || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, m => ENT[m]);
  const lines = text.split('\n').map(l => l.trim());
  const kept = lines.filter(l => !/^\*/.test(l) && !/^there are other bundles/i.test(l));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function uniqueHosted(urls, hostRe, max) {
  const seen = new Set();
  const out = [];
  urls.forEach(u => {
    if (hostRe.test(u) && !seen.has(u)) { seen.add(u); out.push(u); }
  });
  return out.slice(0, max);
}

// Pure. Returns the details found in a store page, or null when the page holds
// nothing usable (a block page, a 404 shell, a changed layout).
function parseConceptPage(html) {
  const h = String(html || '');
  const description = cleanDescription(first(h, new RegExp('"type":"LONG","value":"' + JSON_STR + '"')));
  const tagline = cleanDescription(first(h, new RegExp('"type":"SHORT","value":"' + JSON_STR + '"')));
  const screenshots = uniqueHosted(all(h, new RegExp('"role":"SCREENSHOT","type":"IMAGE","url":"' + JSON_STR + '"')), IMG_HOST, MAX_SCREENSHOTS);
  const videos = uniqueHosted(all(h, new RegExp('"role":"PREVIEW","type":"VIDEO","url":"' + JSON_STR + '"')), VIDEO_HOST, MAX_VIDEOS);

  const genresBlock = /"localizedGenres":\[(.*?)\]/.exec(h);
  const genres = genresBlock ? all(genresBlock[1], new RegExp('"value":"' + JSON_STR + '"')) : [];
  const langBlock = /"spokenLanguages":\[([^\]]*)\]/.exec(h);
  const voices = [];
  (langBlock ? all(langBlock[1], new RegExp('"' + JSON_STR + '"')) : []).forEach(code => {
    const name = LANGS[code] || LANGS[code.split('_')[0]];
    if (name && !voices.includes(name)) voices.push(name);
  });
  const rate = /"averageRating":([0-9.]+),"totalRatingsCount":(\d+)/.exec(h);
  const rel = /"releaseDate":"(\d{4}-\d{2}-\d{2})/.exec(h);

  if (!description && !screenshots.length && !videos.length && !genres.length) return null;
  return {
    concept_id: first(h, /"conceptId":"(\d+)"/),
    matched_title: first(h, /data-qa="mfe-game-title#name">([^<]+)</) || first(h, new RegExp('"invariantName":"' + JSON_STR + '"')),
    description,
    tagline,
    genres,
    release_date: rel ? rel[1] : '',
    publisher: first(h, new RegExp('"publisherName":"' + JSON_STR + '"')),
    voices,
    age_rating: first(h, new RegExp('"contentRating":\\{"__typename":"ProductContentRating","authority":"[^"]*","description":"' + JSON_STR + '"')),
    rating: rate ? { avg: Math.round(parseFloat(rate[1]) * 10) / 10, count: parseInt(rate[2], 10) } : null,
    screenshots,
    videos
  };
}

// ── Network ────────────────────────────────────────────────────────────────
async function withTimeout(fetchImpl, url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, Object.assign({ signal: ctrl.signal }, init));
  } finally {
    clearTimeout(timer);
  }
}

function failure(e) {
  return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
}

// Search by title; an exact title match wins, otherwise a hit counts only if its
// title contains ours or ours contains it — "Madden NFL 26" must not quietly attach "College Football 26".
async function searchConcept(title, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const q = String(title || '').trim();
  if (!q) return { ok: false, reason: 'empty_title' };
  try {
    const res = await withTimeout(fetchImpl, ALGOLIA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Algolia-API-Key': ALGOLIA_KEY, 'X-Algolia-Application-Id': ALGOLIA_APP },
      body: JSON.stringify({ requests: [{ indexName: ALGOLIA_INDEX, params: 'query=' + encodeURIComponent(q) + '&hitsPerPage=5&filters=' + encodeURIComponent('pageType:game') }] })
    }, timeoutMs);
    if (!res || !res.ok) return { ok: false, reason: 'http_' + (res ? res.status : 0) };
    let json;
    try { json = await res.json(); } catch (e) { return { ok: false, reason: 'bad_json' }; }
    const hits = (json && json.results && json.results[0] && json.results[0].hits) || [];
    const nq = norm(q);
    // An exact normalised title wins; only then the contains-either-way rule.
    const usable = hits.filter(x => x && x.conceptId && norm(x.productName));
    const hit = usable.find(x => norm(x.productName) === nq)
      || usable.find(x => { const nt = norm(x.productName); return nt.includes(nq) || nq.includes(nt); });
    return hit ? { ok: true, concept_id: String(hit.conceptId) } : { ok: false, reason: 'no_match' };
  } catch (e) {
    return failure(e);
  }
}

// Fetches and parses one game's store page. `game.psn_link` (a link the owner
// pasted) wins over the title search. Returns { ok: true, psn } or
// { ok: false, reason } — reasons: no_match, empty_title, empty_page, timeout,
// network, http_<status>, bad_json.
async function fetchGameInfo(game, { fetchImpl = globalThis.fetch, timeoutMs = 8000, now = () => new Date() } = {}) {
  let url = cleanLink(game && game.psn_link);
  const source = url ? 'manual' : 'auto';
  if (!url) {
    const candidates = titleCandidates(game && game.title);
    for (const t of candidates) {
      const r = await searchConcept(t, { fetchImpl, timeoutMs });
      if (r.ok) { url = 'https://store.playstation.com/en-us/concept/' + r.concept_id; break; }
      if (r.reason !== 'no_match') return r;
    }
    if (!url) return { ok: false, reason: 'no_match' };
  }
  let html;
  try {
    const res = await withTimeout(fetchImpl, url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } }, timeoutMs);
    if (!res || !res.ok) return { ok: false, reason: 'http_' + (res ? res.status : 0) };
    html = await res.text();
  } catch (e) {
    return failure(e);
  }
  const parsed = parseConceptPage(html);
  if (!parsed) return { ok: false, reason: 'empty_page' };
  const concept = parsed.concept_id;
  return {
    ok: true,
    psn: Object.assign(parsed, {
      source,
      store_url: concept ? 'https://store.playstation.com/en-us/concept/' + concept : url,
      fetched_at: now().toISOString()
    })
  };
}

module.exports = { cleanLink, titleCandidates, cleanDescription, parseConceptPage, searchConcept, fetchGameInfo };
