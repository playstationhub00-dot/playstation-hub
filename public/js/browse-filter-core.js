// The pure half of the Browse catalog: the tabs (ready-made collections), the
// Sort menu, the search box and the filters — reading and writing the URL,
// which games each tab holds and in what order, and what each filter chip
// would give. No DOM here — the server uses it for the first render (server.js
// GET /browse) and public/js/browse.js uses the same rules for every click, so
// the two can never disagree.
//
// data: { games, soon, psplus }
//  - a site game (server.js browseGameFacts):
//    { id, title, text (lowercased search text), tier ('3' | null), ps4, ps5,
//      genres: [..], from (card's "from ₱X" | null), avail, availPs4, buy,
//      bundle, rank (1 = most rented | null when never rented),
//      released ('YYYY-MM-DD' | null), deal (the game's own deal %, 0 if none) }
//  - a Coming soon game: { id, title, text, order (the site's Coming soon order) }
//  - a PS Plus Deluxe game: { k, n (name), c (cover url), ps4, ps5, g (genre) }
// ctx: { bands: { low, high }, tiers: [{ id: '3', name, desc }], genres: [..] }
//
// See docs/superpowers/specs/2026-10-11-browse-catalog-tabs-design.md.
(function (root) {
  var TABS = [
    ['all', 'All games'], ['most-rented', 'Most rented'], ['new', 'New releases'], ['coming-soon', 'Coming soon'],
    ['deals', 'Deals'], ['available', 'Available now'], ['buy', 'Buy to keep'], ['bundles', 'Bundles'], ['psplus', 'PS Plus Deluxe']
  ];
  var SORTS = {
    discount: 'Biggest discount', 'most-rented': 'Most rented', newest: 'Newest', 'price-asc': 'Price: low to high',
    'price-desc': 'Price: high to low', az: 'A–Z', release: 'Release date'
  };
  var GAME_SORTS = ['most-rented', 'newest', 'price-asc', 'price-desc', 'az'];
  var DEFAULT_SORT = { 'new': 'newest', 'coming-soon': 'release', deals: 'discount', psplus: 'az' };
  var CONSOLES = [['ps4', 'PS4'], ['ps5', 'PS5']];
  var PRICES = ['low', 'mid', 'high'];
  var DEFAULT_BANDS = { low: 200, high: 300 };
  var NEW_MAX = 20;
  var RANKED_MAX = 10;
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

  function tabLabel(key) {
    var t = TABS.filter(function (d) { return d[0] === key; })[0];
    return t ? t[1] : '';
  }
  function isTab(key) { return !!tabLabel(key); }

  // What a tab's grid holds: site games, Coming soon games or PS Plus games.
  function kindOf(tab) { return tab === 'coming-soon' ? 'soon' : tab === 'psplus' ? 'psplus' : 'games'; }

  // The Sort menu's choices for a tab; the tab's default first.
  function sortsFor(tab) {
    if (tab === 'coming-soon') return ['release', 'az'];
    if (tab === 'psplus') return ['az'];
    if (tab === 'deals') return ['discount'].concat(GAME_SORTS);
    if (tab === 'new') return ['newest'].concat(GAME_SORTS.filter(function (k) { return k !== 'newest'; }));
    return GAME_SORTS;
  }
  function defaultSort(tab) { return DEFAULT_SORT[tab] || 'most-rented'; }
  // The order in use: the address's choice when the tab offers it, else the tab's default.
  function sortOf(s) { return sortsFor(s.tab).indexOf(s.sort) >= 0 ? s.sort : defaultSort(s.tab); }

  function emptyState() {
    return { tab: 'all', sort: '', search: '', tiers: [], consoles: [], genres: [], prices: [] };
  }

  function clone(s) {
    return {
      tab: s.tab, sort: s.sort, search: s.search,
      tiers: s.tiers.slice(), consoles: s.consoles.slice(), genres: s.genres.slice(), prices: s.prices.slice()
    };
  }

  // URL query (Express req.query or Object.fromEntries(URLSearchParams)) → state.
  // Old links keep working: the old "Show" ticks (avail=1, new=1, newOnly=1,
  // buy=1, bundle=1) and psplus=1 open their tab; ps4=1, platform=PS4 and
  // unit=ps4|ps5 still work.
  function parseState(q) {
    q = q || {};
    var s = emptyState();
    var unit = first(q.unit);
    var tab = first(q.tab);
    if (isTab(tab)) s.tab = tab;
    else if (first(q.avail) === '1' || unit === 'ps4' || unit === 'ps5') s.tab = 'available';
    else if (first(q['new']) === '1' || first(q.newOnly) === '1') s.tab = 'new';
    else if (first(q.buy) === '1') s.tab = 'buy';
    else if (first(q.bundle) === '1') s.tab = 'bundles';
    else if (first(q.psplus) === '1') s.tab = 'psplus';
    var sort = first(q.sort);
    s.sort = SORTS[sort] ? sort : '';
    var search = first(q.search);
    s.search = String(search == null ? '' : search).trim();
    s.tiers = list(q.tier).filter(function (t) { return /^\d+$/.test(t); });
    s.consoles = list(q.console).filter(function (c) { return c === 'ps4' || c === 'ps5'; });
    if ((first(q.ps4) === '1' || first(q.platform) === 'PS4' || unit === 'ps4') && s.consoles.indexOf('ps4') < 0) s.consoles.push('ps4');
    s.genres = list(q.genre);
    s.prices = list(q.price).filter(function (p) { return PRICES.indexOf(p) >= 0; });
    return s;
  }

  // The newest released games, newest first: the New releases tab.
  function newestIds(games) {
    var out = {};
    (games || []).filter(function (f) { return f.released; })
      .sort(function (a, b) { return cmp(a.released, b.released, -1) || a.title.localeCompare(b.title); })
      .slice(0, NEW_MAX)
      .forEach(function (f) { out[f.id] = true; });
    return out;
  }

  // With the PS4 chip on and PS5 off, "Available now" means a PS4 slot is free.
  function ps4Only(s) { return s.consoles.indexOf('ps4') >= 0 && s.consoles.indexOf('ps5') < 0; }

  function inTab(f, tab, s, newIds) {
    if (tab === 'most-rented') return f.rank != null;
    if (tab === 'new') return !!newIds[f.id];
    if (tab === 'deals') return f.deal > 0;
    if (tab === 'available') return !!(ps4Only(s) ? f.availPs4 : f.avail);
    if (tab === 'buy') return !!f.buy;
    if (tab === 'bundles') return !!f.bundle;
    return true;
  }

  // The tab's own collection, before search and filters.
  function members(data, tab, s, newIds) {
    var k = kindOf(tab);
    if (k === 'soon') return data.soon || [];
    if (k === 'psplus') return data.psplus || [];
    return (data.games || []).filter(function (f) { return inTab(f, tab, s, newIds); });
  }

  // A tab shows only when it holds something (All games always does).
  function tabVisible(data, tab) {
    if (tab === 'all') return true;
    return isTab(tab) && members(data, tab, emptyState(), newestIds(data.games)).length > 0;
  }

  // Drops what the page has no button for — a tier or genre from an old shared
  // link (a deleted category, a genre no game has any more), or a tab with no
  // games — so nothing can silently hide every game.
  function cleanState(s, ctx, data) {
    var n = clone(s);
    var tierIds = (ctx.tiers || []).map(function (t) { return String(t.id); });
    n.tiers = n.tiers.filter(function (t) { return tierIds.indexOf(t) >= 0; });
    n.genres = n.genres.filter(function (g) { return (ctx.genres || []).indexOf(g) >= 0; });
    if (!tabVisible(data, n.tab)) n.tab = 'all';
    return n;
  }

  function toQuery(s) {
    var parts = [];
    if (s.tab && s.tab !== 'all') parts.push('tab=' + s.tab);
    if (sortOf(s) !== defaultSort(s.tab)) parts.push('sort=' + sortOf(s));
    if (s.search) parts.push('search=' + encodeURIComponent(s.search));
    if (s.tiers.length) parts.push('tier=' + s.tiers.join(','));
    if (s.consoles.length) parts.push('console=' + s.consoles.join(','));
    if (s.genres.length) parts.push('genre=' + s.genres.map(encodeURIComponent).join(','));
    if (s.prices.length) parts.push('price=' + s.prices.join(','));
    return parts.join('&');
  }

  function href(s) {
    var q = toQuery(s);
    return '/browse' + (q ? '?' + q : '');
  }

  // Another tab keeps the search and filters and starts in its own default order.
  function withTab(s, tab) {
    var n = clone(s);
    n.tab = tab;
    n.sort = '';
    return n;
  }

  function withSort(s, sort) {
    var n = clone(s);
    n.sort = sort;
    return n;
  }

  function withSearch(s, search) {
    var n = clone(s);
    n.search = String(search == null ? '' : search).trim();
    return n;
  }

  // The filter bar's "Clear all": filters off; tab, order and search stay.
  function clearFilters(s) {
    var n = clone(s);
    n.tiers = []; n.consoles = []; n.genres = []; n.prices = [];
    return n;
  }

  // The empty grid's "Clear filters": search and filters off; the tab stays.
  function resetState(s) {
    var n = clearFilters(s);
    n.search = '';
    return n;
  }

  function selectedCount(s) { return s.tiers.length + s.consoles.length + s.genres.length + s.prices.length; }

  function flip(arr, v) {
    var i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
  }

  function toggle(s, group, value) {
    var n = clone(s);
    value = String(value);
    if (group === 'tier') flip(n.tiers, value);
    else if (group === 'console') flip(n.consoles, value);
    else if (group === 'genre') flip(n.genres, value);
    else if (group === 'price') flip(n.prices, value);
    return n;
  }

  // A section's "Clear" in the filter panel.
  function clearGroup(s, group) {
    var n = clone(s);
    if (group === 'tier') n.tiers = [];
    else if (group === 'console') n.consoles = [];
    else if (group === 'genre') n.genres = [];
    else if (group === 'price') n.prices = [];
    return n;
  }

  function isOn(s, group, value) {
    value = String(value);
    if (group === 'tier') return s.tiers.indexOf(value) >= 0;
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

  // The filter bar's removable chips: one per applied filter.
  function appliedChips(s, ctx) {
    var out = [];
    var add = function (group, value, label) { out.push({ group: group, value: String(value), label: label, href: href(toggle(s, group, value)) }); };
    s.tiers.forEach(function (id) {
      var t = (ctx.tiers || []).filter(function (x) { return String(x.id) === id; })[0];
      add('tier', id, t ? t.name : id);
    });
    CONSOLES.forEach(function (d) { if (s.consoles.indexOf(d[0]) >= 0) add('console', d[0], d[1]); });
    s.genres.forEach(function (g) { add('genre', g, g); });
    PRICES.forEach(function (p) { if (s.prices.indexOf(p) >= 0) add('price', p, bandLabel(p, ctx.bands)); });
    return out;
  }

  function searchHit(text, s) {
    var q = s.search.toLowerCase();
    return !q || String(text).toLowerCase().indexOf(q) >= 0;
  }

  function filterHit(f, s, bands) {
    if (s.tiers.length && s.tiers.indexOf(f.tier) < 0) return false;
    if (s.consoles.length && !s.consoles.some(function (c) { return f[c]; })) return false;
    if (s.genres.length && !s.genres.some(function (g) { return f.genres.indexOf(g) >= 0; })) return false;
    if (s.prices.length && s.prices.indexOf(bandOf(f.from, bands)) < 0) return false;
    return true;
  }

  // What the tab shows for the search and (site games only) the filters.
  function matches(data, s, ctx, newIds) {
    var k = kindOf(s.tab);
    return members(data, s.tab, s, newIds).filter(function (x) {
      if (k === 'psplus') return searchHit(x.n, s);
      if (k === 'soon') return searchHit(x.text, s);
      return searchHit(x.text, s) && filterHit(x, s, ctx.bands);
    });
  }

  // a before b (−1) / after (1) by one value, missing values last.
  function cmp(x, y, dir) {
    var nx = x == null, ny = y == null;
    if (nx || ny) return nx === ny ? 0 : (nx ? 1 : -1);
    return x < y ? -dir : x > y ? dir : 0;
  }
  var ORDER = {
    'most-rented': function (a, b) { return cmp(a.rank, b.rank, 1); },
    newest: function (a, b) { return cmp(a.released, b.released, -1); },
    'price-asc': function (a, b) { return cmp(a.from, b.from, 1); },
    'price-desc': function (a, b) { return cmp(a.from, b.from, -1); },
    discount: function (a, b) { return (b.deal || 0) - (a.deal || 0); },
    release: function (a, b) { return a.order - b.order; },
    az: function () { return 0; }
  };
  // Ties (and A–Z) by title; PS Plus games by name.
  function ordered(items, sort) {
    return items.slice().sort(function (a, b) {
      return ORDER[sort](a, b) || String(a.title || a.n).localeCompare(String(b.title || b.n));
    });
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // A filter chip in the panel: how many games the tab would show with it
  // flipped; a chip that would leave nothing is greyed out.
  function chipFor(data, s, ctx, newIds, group, value, label) {
    var on = isOn(s, group, value);
    var count = matches(data, on ? s : toggle(s, group, value), ctx, newIds).length;
    var zero = !on && count === 0;
    return { group: group, value: String(value), label: label, count: count, on: on, zero: zero, href: zero ? null : href(toggle(s, group, value)) };
  }

  // A chip exists only if some game in the whole library has it.
  function exists(data, ctx, newIds, group, value) {
    return matches(data, toggle(emptyState(), group, value), ctx, newIds).length > 0;
  }

  function chipGroups(data, s, ctx, newIds) {
    var groups = [];
    function group(key, label, defs) {
      var chips = defs.filter(function (d) { return exists(data, ctx, newIds, key, d[0]); })
        .map(function (d) { return chipFor(data, s, ctx, newIds, key, d[0], d[1]); });
      if (chips.length) groups.push({ key: key, label: label, chips: chips });
    }
    group('tier', 'Tier', (ctx.tiers || []).map(function (t) { return [String(t.id), t.name]; }));
    group('console', 'Console', CONSOLES);
    group('genre', 'Genre', (ctx.genres || []).map(function (g) { return [g, g]; }));
    group('price', 'Price', PRICES.map(function (p) { return [p, bandLabel(p, ctx.bands)]; }));
    return groups;
  }

  // The admin-written description of each filtered tier that has one.
  function tierNotes(s, ctx) {
    return (ctx.tiers || []).filter(function (t) { return t.desc && s.tiers.indexOf(String(t.id)) >= 0; })
      .map(function (t) { return { name: t.name, desc: t.desc }; });
  }

  // Everything a render needs for one state.
  function view(data, s, ctx) {
    var newIds = newestIds(data.games);
    var kind = kindOf(s.tab);
    var sort = sortOf(s);
    var hits = ordered(matches(data, s, ctx, newIds), sort);
    var games = kind === 'games';
    return {
      tab: s.tab,
      label: tabLabel(s.tab),
      kind: kind,
      sort: sort,
      sorts: sortsFor(s.tab).map(function (k) { return { key: k, label: SORTS[k], on: k === sort }; }),
      tabs: TABS.filter(function (t) { return tabVisible(data, t[0]); }).map(function (t) {
        var other = withTab(s, t[0]);
        return { key: t[0], label: t[1], count: matches(data, other, ctx, newIds).length, on: t[0] === s.tab, href: href(other) };
      }),
      ids: kind === 'psplus' ? [] : hits.map(function (x) { return x.id; }),
      psplus: kind === 'psplus' ? hits : [],
      count: hits.length,
      ranked: s.tab === 'most-rented' && sort === 'most-rented',
      filters: games,
      // The panel's rows stay those of All games where filters do not apply.
      groups: chipGroups(data, games ? s : withTab(s, 'all'), ctx, newIds),
      notes: games ? tierNotes(s, ctx) : [],
      selected: selectedCount(s)
    };
  }

  // The results bar: "Most rented · 12 games".
  function countText(v) { return v.label + ' · ' + plural(v.count, 'game'); }

  // The filter panel's big button for a draft's view.
  function applyLabel(v) {
    return v.count ? { text: 'Show ' + plural(v.count, 'game'), disabled: false } : { text: 'No games match', disabled: true };
  }

  var api = {
    TABS: TABS, PSPLUS_LIMIT: PSPLUS_LIMIT, RANKED_MAX: RANKED_MAX, NEW_MAX: NEW_MAX, DEFAULT_BANDS: DEFAULT_BANDS,
    genreParts: genreParts, genreList: genreList, emptyState: emptyState, parseState: parseState, cleanState: cleanState,
    tabVisible: tabVisible, sortOf: sortOf, toQuery: toQuery, href: href, withTab: withTab, withSort: withSort,
    withSearch: withSearch, clearFilters: clearFilters, resetState: resetState, selectedCount: selectedCount,
    toggle: toggle, isOn: isOn, clearGroup: clearGroup, appliedChips: appliedChips, countText: countText,
    applyLabel: applyLabel, parseBands: parseBands, normalizeBands: normalizeBands, bandOf: bandOf, bandLabel: bandLabel,
    view: view
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BrowseFilterCore = api;
})(typeof window !== 'undefined' ? window : this);
