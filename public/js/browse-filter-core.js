// The pure half of the Browse filters: reading and writing the URL, matching
// games and PS Plus Deluxe games against the selected chips, counting what each
// chip would give, and the order of the one-grid results. No DOM here — the
// server uses it for the first render (server.js GET /browse) and
// public/js/browse.js uses the same rules in the filter panel and the filter
// bar, so the two can never disagree.
//
// A site game's facts (built by server.js browseGameFacts):
//   { id, title, text (lowercased search text), tier ('3' | null), ps4, ps5,
//     genres: [..], from (card's "from ₱X" | null), avail, availPs4, isNew, buy,
//     bundle, home ('bundles' | 'cat-3' | 'other') }
// A PS Plus Deluxe item: { k, n (name), c (cover url), ps4, ps5, g (genre), j (just added) }
// ctx: { bands: { low, high }, tiers: [{ id: '3', name }], genres: [..],
//        psplusFrom, psplusAvail, psplusAvailPs4 }
//
// See docs/superpowers/specs/2026-10-09-browse-filters-tiers-design.md.
(function (root) {
  var SHOW = [['avail', 'Available now'], ['new', 'Just added'], ['buy', 'Can buy'], ['bundle', 'Bundles']];
  var SHOW_KEY = { avail: 'avail', 'new': 'isNew', buy: 'buy', bundle: 'bundle' };
  var CONSOLES = [['ps4', 'PS4'], ['ps5', 'PS5']];
  var PRICES = ['low', 'mid', 'high'];
  var DEFAULT_BANDS = { low: 200, high: 300 };
  var PSPLUS_LIMIT = 24;

  function first(v) { return Array.isArray(v) ? v[0] : v; }

  // "a,b" (or ["a", "b,c"]) → ['a', 'b', 'c'], trimmed, no blanks, no repeats.
  function list(v) {
    var out = [];
    [].concat(v == null ? [] : v).forEach(function (s) {
      String(s).split(',').forEach(function (p) {
        p = p.trim();
        if (p && out.indexOf(p) < 0) out.push(p);
      });
    });
    return out;
  }

  // A game's genre field is free text ("Action, RPG", "Action/Adventure"): each
  // part is its own genre chip.
  function genreParts(genre) {
    var out = [];
    String(genre == null ? '' : genre).split(/[,/]/).forEach(function (p) {
      p = p.trim();
      if (p && out.indexOf(p) < 0) out.push(p);
    });
    return out;
  }

  function genreList(games) {
    var seen = [];
    (games || []).forEach(function (f) {
      (f.genres || []).forEach(function (g) { if (seen.indexOf(g) < 0) seen.push(g); });
    });
    return seen.sort(function (a, b) { return a.localeCompare(b); });
  }

  function emptyState() {
    return { search: '', avail: false, isNew: false, buy: false, bundle: false, tiers: [], psplus: false, consoles: [], genres: [], prices: [] };
  }

  function clone(s) {
    return {
      search: s.search, avail: s.avail, isNew: s.isNew, buy: s.buy, bundle: s.bundle,
      tiers: s.tiers.slice(), psplus: s.psplus, consoles: s.consoles.slice(), genres: s.genres.slice(), prices: s.prices.slice()
    };
  }

  // URL query (Express req.query or Object.fromEntries(URLSearchParams)) → state.
  // Old links keep working: ps4=1, platform=PS4, unit=ps4|ps5, newOnly=1.
  function parseState(q) {
    q = q || {};
    var s = emptyState();
    var search = first(q.search);
    s.search = String(search == null ? '' : search).trim();
    var unit = first(q.unit);
    s.avail = first(q.avail) === '1' || unit === 'ps4' || unit === 'ps5';
    s.isNew = first(q['new']) === '1' || first(q.newOnly) === '1';
    s.buy = first(q.buy) === '1';
    s.bundle = first(q.bundle) === '1';
    s.tiers = list(q.tier).filter(function (t) { return /^\d+$/.test(t); });
    s.psplus = first(q.psplus) === '1';
    s.consoles = list(q.console).filter(function (c) { return c === 'ps4' || c === 'ps5'; });
    if ((first(q.ps4) === '1' || first(q.platform) === 'PS4' || unit === 'ps4') && s.consoles.indexOf('ps4') < 0) s.consoles.push('ps4');
    s.genres = list(q.genre);
    s.prices = list(q.price).filter(function (p) { return PRICES.indexOf(p) >= 0; });
    return s;
  }

  // Drops tiers and genres the page has no chip for (a deleted category or a
  // genre no game has any more, from an old shared link), so they can't
  // silently hide every game with nothing on screen to turn them off.
  function cleanState(s, ctx) {
    var n = clone(s);
    var tierIds = (ctx.tiers || []).map(function (t) { return String(t.id); });
    n.tiers = n.tiers.filter(function (t) { return tierIds.indexOf(t) >= 0; });
    n.genres = n.genres.filter(function (g) { return (ctx.genres || []).indexOf(g) >= 0; });
    return n;
  }

  function toQuery(s) {
    var parts = [];
    if (s.search) parts.push('search=' + encodeURIComponent(s.search));
    if (s.avail) parts.push('avail=1');
    if (s.isNew) parts.push('new=1');
    if (s.buy) parts.push('buy=1');
    if (s.bundle) parts.push('bundle=1');
    if (s.tiers.length) parts.push('tier=' + s.tiers.join(','));
    if (s.psplus) parts.push('psplus=1');
    if (s.consoles.length) parts.push('console=' + s.consoles.join(','));
    if (s.genres.length) parts.push('genre=' + s.genres.map(encodeURIComponent).join(','));
    if (s.prices.length) parts.push('price=' + s.prices.join(','));
    return parts.join('&');
  }

  function href(s) {
    var q = toQuery(s);
    return '/browse' + (q ? '?' + q : '');
  }

  function selectedCount(s) {
    return (s.avail ? 1 : 0) + (s.isNew ? 1 : 0) + (s.buy ? 1 : 0) + (s.bundle ? 1 : 0) +
      s.tiers.length + (s.psplus ? 1 : 0) + s.consoles.length + s.genres.length + s.prices.length;
  }

  function anyActive(s) { return !!s.search || selectedCount(s) > 0; }

  function flip(arr, v) {
    var i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
  }

  function toggle(s, group, value) {
    var n = clone(s);
    value = String(value);
    if (group === 'show' && SHOW_KEY[value]) n[SHOW_KEY[value]] = !n[SHOW_KEY[value]];
    else if (group === 'tier') { if (value === 'psplus') n.psplus = !n.psplus; else flip(n.tiers, value); }
    else if (group === 'console') flip(n.consoles, value);
    else if (group === 'genre') flip(n.genres, value);
    else if (group === 'price') flip(n.prices, value);
    else if (group === 'search') n.search = '';
    return n;
  }

  // A section's "Clear" in the filter panel.
  function clearGroup(s, group) {
    var n = clone(s);
    if (group === 'show') { n.avail = false; n.isNew = false; n.buy = false; n.bundle = false; }
    else if (group === 'tier') { n.tiers = []; n.psplus = false; }
    else if (group === 'console') n.consoles = [];
    else if (group === 'genre') n.genres = [];
    else if (group === 'price') n.prices = [];
    return n;
  }

  // The panel's tick box for an option, as a GET form field (the panel still
  // works as a plain form without the page script).
  function formField(group, value) {
    value = String(value);
    if (group === 'show') return { name: value, value: '1' };
    if (group === 'tier' && value === 'psplus') return { name: 'psplus', value: '1' };
    return { name: group, value: value };
  }

  // The filter bar's removable chips: one per applied option, then the search.
  function appliedChips(s, ctx) {
    var out = [];
    var add = function (group, value, label) { out.push({ group: group, value: String(value), label: label, href: href(toggle(s, group, value)) }); };
    SHOW.forEach(function (d) { if (s[SHOW_KEY[d[0]]]) add('show', d[0], d[1]); });
    s.tiers.forEach(function (id) {
      var t = (ctx.tiers || []).filter(function (x) { return String(x.id) === id; })[0];
      add('tier', id, t ? t.name : id);
    });
    if (s.psplus) add('tier', 'psplus', 'PS Plus Deluxe');
    CONSOLES.forEach(function (d) { if (s.consoles.indexOf(d[0]) >= 0) add('console', d[0], d[1]); });
    s.genres.forEach(function (g) { add('genre', g, g); });
    PRICES.forEach(function (p) { if (s.prices.indexOf(p) >= 0) add('price', p, bandLabel(p, ctx.bands)); });
    if (s.search) add('search', '', '"' + s.search + '"');
    return out;
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // The filter bar's count: site games, or PS Plus games when only those show.
  function countText(v) {
    return v.siteOn ? plural(v.site.length, 'game') : plural(v.psplus.length, 'PS Plus game');
  }

  // The panel's big button for a draft's view.
  function applyLabel(v) {
    if (v.siteOn && v.site.length) return { text: 'Show ' + plural(v.site.length, 'game'), disabled: false };
    if (v.psplusOn && v.psplus.length) return { text: 'Show ' + plural(v.psplus.length, 'PS Plus game'), disabled: false };
    if (!v.active) return { text: 'Show all games', disabled: false };
    return { text: 'No games match', disabled: true };
  }

  function isOn(s, group, value) {
    value = String(value);
    if (group === 'show') return !!s[SHOW_KEY[value]];
    if (group === 'tier') return value === 'psplus' ? s.psplus : s.tiers.indexOf(value) >= 0;
    if (group === 'console') return s.consoles.indexOf(value) >= 0;
    if (group === 'genre') return s.genres.indexOf(value) >= 0;
    if (group === 'price') return s.prices.indexOf(value) >= 0;
    return false;
  }

  // Two whole numbers 0 < low < high, or null.
  function parseBands(lowRaw, highRaw) {
    var low = Number(String(lowRaw == null ? '' : lowRaw).trim());
    var high = Number(String(highRaw == null ? '' : highRaw).trim());
    if (!Number.isInteger(low) || !Number.isInteger(high) || low <= 0 || high <= low) return null;
    return { low: low, high: high };
  }

  function normalizeBands(b) {
    return (b && parseBands(b.low, b.high)) || { low: DEFAULT_BANDS.low, high: DEFAULT_BANDS.high };
  }

  function bandOf(price, bands) {
    if (price == null || !(price > 0)) return null;
    if (price < bands.low) return 'low';
    if (price < bands.high) return 'mid';
    return 'high';
  }

  function bandLabel(band, bands) {
    if (band === 'low') return 'Under ₱' + bands.low;
    if (band === 'mid') return '₱' + bands.low + '–' + (bands.high - 1);
    return '₱' + bands.high + '+';
  }

  // With the PS4 chip on and PS5 off, "Available now" means a PS4 slot is free.
  function ps4Only(s) { return s.consoles.indexOf('ps4') >= 0 && s.consoles.indexOf('ps5') < 0; }

  // Site games show unless "PS Plus Deluxe" is the only Tier chip on.
  function siteOn(s) { return !(s.psplus && !s.tiers.length); }

  // The PS Plus section shows while filtering, unless Can buy / Bundles is on or
  // other Tier chips are on without "PS Plus Deluxe".
  function psplusOn(s) { return anyActive(s) && !s.buy && !s.bundle && (!s.tiers.length || s.psplus); }

  function matchSite(f, s, bands) {
    var q = s.search.toLowerCase();
    if (q && f.text.indexOf(q) < 0) return false;
    if (s.avail && !(ps4Only(s) ? f.availPs4 : f.avail)) return false;
    if (s.isNew && !f.isNew) return false;
    if (s.buy && !f.buy) return false;
    if (s.bundle && !f.bundle) return false;
    if (s.tiers.length && s.tiers.indexOf(f.tier) < 0) return false;
    if (s.consoles.length && !s.consoles.some(function (c) { return f[c]; })) return false;
    if (s.genres.length && !s.genres.some(function (g) { return f.genres.indexOf(g) >= 0; })) return false;
    if (s.prices.length && s.prices.indexOf(bandOf(f.from, bands)) < 0) return false;
    return true;
  }

  function matchPsplus(p, s, ctx) {
    if (!psplusOn(s)) return false;
    var q = s.search.toLowerCase();
    if (q && String(p.n).toLowerCase().indexOf(q) < 0) return false;
    if (s.avail && !(ps4Only(s) ? ctx.psplusAvailPs4 : ctx.psplusAvail)) return false;
    if (s.isNew && !p.j) return false;
    if (s.consoles.length && !s.consoles.some(function (c) { return p[c]; })) return false;
    if (s.genres.length && s.genres.indexOf(p.g) < 0) return false;
    if (s.prices.length && s.prices.indexOf(bandOf(ctx.psplusFrom, ctx.bands)) < 0) return false;
    return true;
  }

  function results(games, psplus, s, ctx) {
    return {
      site: siteOn(s) ? (games || []).filter(function (f) { return matchSite(f, s, ctx.bands); }) : [],
      psplus: (psplus || []).filter(function (p) { return matchPsplus(p, s, ctx); })
    };
  }

  // What a chip's number means: the games the customer would see. That is the
  // site games, except when only PS Plus games would show.
  function shownCount(games, psplus, s, ctx) {
    var r = results(games, psplus, s, ctx);
    return siteOn(s) ? r.site.length : r.psplus.length;
  }

  function chipFor(games, psplus, s, ctx, group, value, label) {
    var on = isOn(s, group, value);
    var count;
    if (group === 'tier' && value === 'psplus') {
      count = results(games, psplus, on ? s : toggle(s, group, value), ctx).psplus.length;
    } else {
      count = shownCount(games, psplus, on ? s : toggle(s, group, value), ctx);
    }
    var zero = !on && count === 0;
    return { group: group, value: String(value), label: label, count: count, on: on, zero: zero, href: zero ? null : href(toggle(s, group, value)) };
  }

  // A chip exists only if something in the whole library could ever match it
  // (no "Bundles" chip when there are no bundles at all).
  function exists(games, psplus, ctx, group, value) {
    var s = toggle(emptyState(), group, value);
    if (group === 'tier' && value === 'psplus') return (psplus || []).length > 0;
    return shownCount(games, psplus, s, ctx) > 0;
  }

  function chipGroups(games, psplus, s, ctx) {
    var groups = [];
    function group(key, label, defs) {
      var chips = defs.filter(function (d) { return exists(games, psplus, ctx, key, d[0]); })
        .map(function (d) { return chipFor(games, psplus, s, ctx, key, d[0], d[1]); });
      if (chips.length) groups.push({ key: key, label: label, chips: chips });
    }
    group('show', 'Show', SHOW);
    group('tier', 'Tier', (ctx.tiers || []).map(function (t) { return [String(t.id), t.name]; }).concat([['psplus', 'PS Plus Deluxe']]));
    group('console', 'Console', CONSOLES);
    group('genre', 'Genre', (ctx.genres || []).map(function (g) { return [g, g]; }));
    group('price', 'Price', PRICES.map(function (p) { return [p, bandLabel(p, ctx.bands)]; }));
    return groups;
  }

  // The one-grid order while filtering: tier in admin order (no tier last), then A–Z.
  function sortForGrid(list, tiers) {
    var order = {};
    (tiers || []).forEach(function (t, i) { order[String(t.id)] = i; });
    var rank = function (f) { return f.tier != null && order[f.tier] != null ? order[f.tier] : Infinity; };
    return list.slice().sort(function (a, b) { return (rank(a) - rank(b)) || a.title.localeCompare(b.title); });
  }

  // Everything a render needs for one state.
  function view(games, psplus, s, ctx) {
    var r = results(games, psplus, s, ctx);
    var active = anyActive(s);
    return {
      active: active,
      siteOn: siteOn(s),
      psplusOn: active && r.psplus.length > 0,
      site: r.site,
      grid: active ? sortForGrid(r.site, ctx.tiers).map(function (f) { return f.id; }) : [],
      psplus: r.psplus,
      groups: chipGroups(games, psplus, s, ctx),
      selected: selectedCount(s)
    };
  }

  var api = {
    PSPLUS_LIMIT: PSPLUS_LIMIT, DEFAULT_BANDS: DEFAULT_BANDS,
    genreParts: genreParts, genreList: genreList, emptyState: emptyState, parseState: parseState, cleanState: cleanState,
    toQuery: toQuery, href: href, selectedCount: selectedCount, anyActive: anyActive, toggle: toggle, isOn: isOn,
    clearGroup: clearGroup, formField: formField, appliedChips: appliedChips, countText: countText, applyLabel: applyLabel,
    parseBands: parseBands, normalizeBands: normalizeBands, bandOf: bandOf, bandLabel: bandLabel,
    siteOn: siteOn, psplusOn: psplusOn, matchSite: matchSite, matchPsplus: matchPsplus, results: results,
    chipGroups: chipGroups, sortForGrid: sortForGrid, view: view
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BrowseFilterCore = api;
})(typeof window !== 'undefined' ? window : this);
