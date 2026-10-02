// The pure half of the homepage "What game are you looking for?" search:
// matching a typed phrase against /api/search-index entries and describing
// each hit. No DOM here, so it can be tested; public/js/home-search.js does
// the drawing.
//
// An index entry looks like { t: title, p: platform, y: 'now'|'soon'|'psplus'|
// 'requested', u: url, img, s: open slots, pr: from-price, d: release date,
// v: votes, k: hidden bundle keywords } — see GET /api/search-index.
(function (root) {
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Entries whose title (or hidden bundle keywords) contains every typed word,
  // best first: title starts with the phrase, then title contains the phrase,
  // then the rest; rentable games ('now') ahead of the other kinds on a tie.
  function search(index, query, limit) {
    var q = norm(query);
    if (!q) return [];
    var words = q.split(' ');
    var hits = [];
    (index || []).forEach(function (e, i) {
      var title = norm(e.t);
      var hay = title + ' ' + norm(e.k);
      if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return;
      var rank = title.indexOf(q) === 0 ? 0 : title.indexOf(q) > 0 ? 1 : 2;
      hits.push({ e: e, rank: rank, now: e.y === 'now' ? 0 : 1, i: i });
    });
    hits.sort(function (a, b) { return a.rank - b.rank || a.now - b.now || a.i - b.i; });
    return hits.slice(0, limit || 6).map(function (h) { return h.e; });
  }

  // How a result row describes itself: kind drives the colour, text is the
  // status line, price is the right-hand figure ('' when there is none).
  function statusOf(e) {
    if (e.y === 'now') {
      var price = e.pr ? 'from ₱' + e.pr : '';
      if (e.s > 0) return { kind: 'free', text: '● ' + e.s + ' slot' + (e.s === 1 ? '' : 's') + ' free', price: price };
      return { kind: 'booked', text: '● Fully booked · Fall in line free', price: price };
    }
    if (e.y === 'soon') return { kind: 'soon', text: 'Coming soon · ' + (e.d || 'TBA'), price: '' };
    if (e.y === 'psplus') return { kind: 'psplus', text: '★ Included in PS Plus Deluxe', price: 'Play via PS Plus' };
    if (e.y === 'requested') {
      var v = e.v || 0;
      return { kind: 'requested', text: 'Requested · ' + v + ' vote' + (v === 1 ? '' : 's'), price: '' };
    }
    return { kind: 'other', text: '', price: '' };
  }

  function requestHref(q) { return '/requests?title=' + encodeURIComponent(String(q || '').trim()); }
  function messengerHref(q) {
    return 'http://m.me/PlaystationHub00?text=' + encodeURIComponent('Hi! Do you have ' + String(q || '').trim() + '? 🎮');
  }

  // True while the box still holds the query a pending missed-search beacon was scheduled for.
  function sameQuery(inputValue, q) { return norm(inputValue) === q; }

  var api = { norm: norm, sameQuery: sameQuery, search: search, statusOf: statusOf, requestHref: requestHref, messengerHref: messengerHref };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HomeSearchCore = api;
})(typeof window !== 'undefined' ? window : this);
