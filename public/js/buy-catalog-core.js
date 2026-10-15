// The pure half of the Buy shop (views/buy.ejs, views/buy-catalog.ejs): the
// catalog tabs (which double as the storefront's shelves), the Sort menu, the
// search box and the filters — reading and writing the URL, which items each
// tab holds and in what order, and what each filter chip would give. No DOM
// here — the server uses it for the storefront shelves and the catalog's
// first render (server.js GET /buy, GET /buy/catalog) and
// public/js/buy-catalog.js uses the same rules for every click.
//
// data: { games, boxes }
//  - a game for sale (server.js buyShopData):
//    { id, slug, title, text (lowercased search text), cover, fx, fy, platform,
//      ps4, ps5, genres: [..], genre (first part), price (lowest sellable
//      final price), was (base price when the buy promo cuts it | null),
//      nt, tr (that account type can still be bought), ready (in stock),
//      sold (purchases), order (1 = best selling), released ('YYYY-MM-DD' | null) }
//  - a box set: { id, slug, name, text, gameCount, perGame (| null), from,
//      open (a tier can be bought), covers: [{ title, cover }], more, tiers }
//
// See docs/superpowers/specs/2026-10-11-buy-game-shop-design.md.
(function (root) {
  var TABS = [
    ['all', 'All games'], ['best-sellers', 'Best sellers'], ['ready-today', 'Ready today'], ['box-sets', 'Box sets'],
    ['under-1000', 'Under ₱1,000'], ['1000-1999', '₱1,000 – ₱1,999'], ['2000-up', '₱2,000 and up']
  ];
  var SORTS = {
    'best-selling': 'Best selling', 'price-asc': 'Price: low to high', 'price-desc': 'Price: high to low',
    az: 'A–Z', newest: 'Newest', 'best-value': 'Best value'
  };
  var GAME_SORTS = ['best-selling', 'price-asc', 'price-desc', 'az', 'newest'];
  var PRICE_FIRST = ['price-asc', 'best-selling', 'price-desc', 'az', 'newest'];
  var BOX_SORTS = ['best-value', 'price-asc', 'az'];
  var CONSOLES = [['ps4', 'PS4'], ['ps5', 'PS5']];
  var ACCOUNTS = [['nt', 'Non-Trophy'], ['tr', 'Trophy']];
  var BEST_MAX = 10;
  var SHELF_MAX = 10;
  var RANKED_MAX = 3;

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
  function kindOf(tab) { return tab === 'box-sets' ? 'boxes' : 'games'; }

  // The Sort menu's choices for a tab; the tab's default first.
  function sortsFor(tab) {
    if (tab === 'box-sets') return BOX_SORTS;
    if (tab === 'under-1000' || tab === '1000-1999' || tab === '2000-up') return PRICE_FIRST;
    return GAME_SORTS;
  }
  function sortOf(s) { var o = sortsFor(s.tab); return o.indexOf(s.sort) >= 0 ? s.sort : o[0]; }

  function emptyState() { return { tab: 'all', sort: '', search: '', consoles: [], genres: [], accounts: [] }; }

  function clone(s) {
    return { tab: s.tab, sort: s.sort, search: s.search, consoles: s.consoles.slice(), genres: s.genres.slice(), accounts: s.accounts.slice() };
  }

  // URL query (Express req.query or Object.fromEntries(URLSearchParams)) → state.
  function parseState(q) {
    q = q || {};
    var s = emptyState();
    var tab = first(q.tab);
    if (isTab(tab)) s.tab = tab;
    var sort = first(q.sort);
    s.sort = SORTS[sort] ? sort : '';
    var search = first(q.search);
    s.search = String(search == null ? '' : search).trim();
    s.consoles = list(q.console).filter(function (c) { return c === 'ps4' || c === 'ps5'; });
    s.genres = list(q.genre);
    s.accounts = list(q.account).filter(function (a) { return a === 'nt' || a === 'tr'; });
    return s;
  }

  // The best sellers: every game that has sold, in best-selling order, topped
  // up to 10 with the next best-selling games while fewer than 10 have sold.
  function bestSellerIds(games) {
    var byOrder = (games || []).slice().sort(function (a, b) { return a.order - b.order; });
    var sold = byOrder.filter(function (f) { return f.sold > 0; });
    var ids = sold.length >= BEST_MAX ? sold : sold.concat(byOrder.filter(function (f) { return !(f.sold > 0); }).slice(0, BEST_MAX - sold.length));
    return ids.map(function (f) { return f.id; });
  }

  function inTab(f, tab, best) {
    if (tab === 'best-sellers') return best.indexOf(f.id) >= 0;
    if (tab === 'ready-today') return !!f.ready;
    if (tab === 'under-1000') return f.price < 1000;
    if (tab === '1000-1999') return f.price >= 1000 && f.price < 2000;
    if (tab === '2000-up') return f.price >= 2000;
    return true;
  }

  function members(data, tab, best) {
    if (kindOf(tab) === 'boxes') return data.boxes || [];
    return (data.games || []).filter(function (f) { return inTab(f, tab, best); });
  }

  // A tab shows only when it holds something (All games always does).
  function tabVisible(data, tab) {
    if (tab === 'all') return true;
    return isTab(tab) && members(data, tab, bestSellerIds(data.games)).length > 0;
  }

  // Drops a genre no game has any more (an old shared link) and a tab with
  // nothing in it, so nothing can silently hide every game.
  function cleanState(s, data) {
    var n = clone(s);
    var genres = genreList(data.games);
    n.genres = n.genres.filter(function (g) { return genres.indexOf(g) >= 0; });
    if (!tabVisible(data, n.tab)) n.tab = 'all';
    return n;
  }

  function toQuery(s) {
    var parts = [];
    if (s.tab && s.tab !== 'all') parts.push('tab=' + s.tab);
    if (sortOf(s) !== sortsFor(s.tab)[0]) parts.push('sort=' + sortOf(s));
    if (s.search) parts.push('search=' + encodeURIComponent(s.search));
    if (s.consoles.length) parts.push('console=' + s.consoles.join(','));
    if (s.genres.length) parts.push('genre=' + s.genres.map(encodeURIComponent).join(','));
    if (s.accounts.length) parts.push('account=' + s.accounts.join(','));
    return parts.join('&');
  }

  function href(s) {
    var q = toQuery(s);
    return '/buy/catalog' + (q ? '?' + q : '');
  }

  // Another tab keeps the search and filters and starts in its own default order.
  function withTab(s, tab) { var n = clone(s); n.tab = tab; n.sort = ''; return n; }
  function withSort(s, sort) { var n = clone(s); n.sort = sort; return n; }
  function withSearch(s, search) { var n = clone(s); n.search = String(search == null ? '' : search).trim(); return n; }

  // The filter bar's "Clear all": filters off; tab, order and search stay.
  function clearFilters(s) { var n = clone(s); n.consoles = []; n.genres = []; n.accounts = []; return n; }

  // The empty grid's "Clear filters": search and filters off; the tab stays.
  function resetState(s) { var n = clearFilters(s); n.search = ''; return n; }

  function selectedCount(s) { return s.consoles.length + s.genres.length + s.accounts.length; }

  var GROUP_FIELD = { console: 'consoles', genre: 'genres', account: 'accounts' };

  function toggle(s, group, value) {
    var n = clone(s);
    var arr = n[GROUP_FIELD[group]];
    if (!arr) return n;
    value = String(value);
    var i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1); else arr.push(value);
    return n;
  }

  function clearGroup(s, group) {
    var n = clone(s);
    if (GROUP_FIELD[group]) n[GROUP_FIELD[group]] = [];
    return n;
  }

  function isOn(s, group, value) {
    var arr = s[GROUP_FIELD[group]];
    return !!arr && arr.indexOf(String(value)) >= 0;
  }

  // The filter bar's removable chips: one per applied filter.
  function appliedChips(s) {
    var out = [];
    var add = function (group, value, label) { out.push({ group: group, value: String(value), label: label, href: href(toggle(s, group, value)) }); };
    CONSOLES.forEach(function (d) { if (s.consoles.indexOf(d[0]) >= 0) add('console', d[0], d[1]); });
    s.genres.forEach(function (g) { add('genre', g, g); });
    ACCOUNTS.forEach(function (d) { if (s.accounts.indexOf(d[0]) >= 0) add('account', d[0], d[1]); });
    return out;
  }

  function searchHit(text, s) {
    var q = s.search.toLowerCase();
    return !q || String(text).toLowerCase().indexOf(q) >= 0;
  }

  function filterHit(f, s) {
    if (s.consoles.length && !s.consoles.some(function (c) { return f[c]; })) return false;
    if (s.genres.length && !s.genres.some(function (g) { return f.genres.indexOf(g) >= 0; })) return false;
    if (s.accounts.length && !s.accounts.some(function (a) { return f[a]; })) return false;
    return true;
  }

  // What the tab shows for the search and (games only) the filters.
  function matches(data, s, best) {
    var boxes = kindOf(s.tab) === 'boxes';
    return members(data, s.tab, best).filter(function (x) {
      return searchHit(x.text, s) && (boxes || filterHit(x, s));
    });
  }

  // a before b (−1) / after (1) by one value, missing values last.
  function cmp(x, y, dir) {
    var nx = x == null, ny = y == null;
    if (nx || ny) return nx === ny ? 0 : (nx ? 1 : -1);
    return x < y ? -dir : x > y ? dir : 0;
  }
  var ORDER = {
    'best-selling': function (a, b) { return cmp(a.order, b.order, 1); },
    'price-asc': function (a, b) { return cmp(a.kind === 'box' ? a.from : a.price, b.kind === 'box' ? b.from : b.price, 1); },
    'price-desc': function (a, b) { return cmp(a.price, b.price, -1); },
    newest: function (a, b) { return cmp(a.released, b.released, -1); },
    'best-value': function (a, b) { return cmp(a.perGame, b.perGame, 1); },
    az: function () { return 0; }
  };
  // Ties (and A–Z) by title; box sets by name.
  function ordered(items, sort) {
    return items.slice().sort(function (a, b) {
      return ORDER[sort](a, b) || String(a.title || a.name).localeCompare(String(b.title || b.name));
    });
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // A filter chip in the panel: how many games the tab would show with it
  // flipped; a chip that would leave nothing is greyed out.
  function chipFor(data, s, best, group, value, label) {
    var on = isOn(s, group, value);
    var count = matches(data, on ? s : toggle(s, group, value), best).length;
    var zero = !on && count === 0;
    return { group: group, value: String(value), label: label, count: count, on: on, zero: zero, href: zero ? null : href(toggle(s, group, value)) };
  }

  // A chip exists only if some game in the whole shop has it.
  function exists(data, best, group, value) {
    return matches(data, toggle(emptyState(), group, value), best).length > 0;
  }

  function chipGroups(data, s, best) {
    var groups = [];
    function group(key, label, defs) {
      var chips = defs.filter(function (d) { return exists(data, best, key, d[0]); })
        .map(function (d) { return chipFor(data, s, best, key, d[0], d[1]); });
      if (chips.length) groups.push({ key: key, label: label, chips: chips });
    }
    group('console', 'Console', CONSOLES);
    group('genre', 'Genre', genreList(data.games).map(function (g) { return [g, g]; }));
    group('account', 'Account', ACCOUNTS);
    return groups;
  }

  // Everything a render needs for one state.
  function view(data, s) {
    var best = bestSellerIds(data.games);
    var kind = kindOf(s.tab);
    var sort = sortOf(s);
    var items = matches(data, s, best);
    if (kind === 'boxes') items = items.map(function (b) { return Object.assign({ kind: 'box' }, b); });
    var hits = ordered(items, sort);
    var games = kind === 'games';
    return {
      tab: s.tab,
      label: tabLabel(s.tab),
      kind: kind,
      sort: sort,
      sorts: sortsFor(s.tab).map(function (k) { return { key: k, label: SORTS[k], on: k === sort }; }),
      tabs: TABS.filter(function (t) { return tabVisible(data, t[0]); }).map(function (t) {
        var other = withTab(s, t[0]);
        return { key: t[0], label: t[1], count: matches(data, other, best).length, on: t[0] === s.tab, href: href(other) };
      }),
      ids: hits.map(function (x) { return x.id; }),
      count: hits.length,
      ranked: s.tab === 'best-sellers' && sort === 'best-selling',
      filters: games,
      // The panel's rows stay those of All games on Box sets, where filters do not apply.
      groups: chipGroups(data, games ? s : withTab(s, 'all'), best),
      selected: selectedCount(s)
    };
  }

  // The storefront's shelves: every tab but All games, its first 10 in its
  // default order (empty ones left out).
  function shelves(data) {
    return TABS.filter(function (t) { return t[0] !== 'all'; }).map(function (t) {
      var v = view(data, withTab(emptyState(), t[0]));
      return { key: t[0], label: t[1], kind: v.kind, count: v.count, ids: v.ids.slice(0, SHELF_MAX), href: href(withTab(emptyState(), t[0])) };
    }).filter(function (sh) { return sh.count > 0; });
  }

  // The results bar: "Best sellers · 10 games" ("Box sets · 3 box sets").
  function countText(v) { return v.label + ' · ' + plural(v.count, v.kind === 'boxes' ? 'box set' : 'game'); }

  // The filter panel's big button for a draft's view.
  function applyLabel(v) {
    return v.count ? { text: 'Show ' + plural(v.count, 'game'), disabled: false } : { text: 'No games match', disabled: true };
  }

  var api = {
    TABS: TABS, BEST_MAX: BEST_MAX, SHELF_MAX: SHELF_MAX, RANKED_MAX: RANKED_MAX,
    genreList: genreList, emptyState: emptyState, parseState: parseState, cleanState: cleanState, tabVisible: tabVisible,
    sortOf: sortOf, toQuery: toQuery, href: href, withTab: withTab, withSort: withSort, withSearch: withSearch,
    clearFilters: clearFilters, resetState: resetState, selectedCount: selectedCount, toggle: toggle, clearGroup: clearGroup,
    isOn: isOn, appliedChips: appliedChips, bestSellerIds: bestSellerIds, view: view, shelves: shelves,
    countText: countText, applyLabel: applyLabel
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BuyCatalogCore = api;
})(typeof window !== 'undefined' ? window : this);
