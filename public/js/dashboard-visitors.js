// HTML for the admin dashboard's visitor cards (Site tab): the funnel, its
// "browsed the catalog" note, "Most asked-about games" and "Searched, nothing
// found". Takes one window object from server.js (VIS_WINDOWS[...]) and returns
// markup; views/partials/admin/dashboard/site.ejs assigns it to innerHTML.
// Everything user-influenced (game titles, search phrases) goes through esc().
(function (root) {
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  function browsedHtml(win) {
    var b = win.browsed;
    var s = 'Browsed the catalog — <strong>' + b.count + '</strong> of <strong>' + b.total +
      '</strong> sessions <span class="vf-browsed-pct">' + (b.pct === null ? '—' : b.pct + '%') + '</span>';
    if (win.skipped > 0) s += ' · <strong>' + win.skipped + '</strong> robot / system hits not counted';
    return s;
  }

  function funnelHtml(win) {
    var top = win.funnel[0].count;
    return win.funnel.map(function (stage) {
      var widthPct = top > 0 ? Math.max(2, Math.round((stage.count / top) * 100)) : 0;
      var pctHtml = stage.pctOfPrev === null ? '' : ' <span class="vf-pct">' + stage.pctOfPrev + '%</span>';
      return '<div class="vf-row">' +
        '<span class="vf-name">' + esc(stage.label) + '</span>' +
        '<div class="vf-bar-track"><div class="vf-bar-fill" style="width:' + widthPct + '%"></div></div>' +
        '<span class="vf-n"><strong>' + stage.count + '</strong>' + pctHtml + '</span>' +
        '</div>';
    }).join('');
  }

  function askedHtml(win) {
    var a = (win && win.asked) || { games: [], other: 0 };
    if (!a.games.length && !a.other) return '<div class="vf-empty">No Message Us taps yet.</div>';
    var rows = a.games.map(function (g) {
      var free = g.slots > 0;
      return '<div class="vf-ask-row">' +
        (g.cover ? '<img class="vf-ask-img" src="' + esc(g.cover) + '" alt="">' : '<span class="vf-ask-img"></span>') +
        '<span class="vf-ask-title">' + esc(g.title) + '</span>' +
        '<span class="vf-ask-badge ' + (free ? 'vf-ask-ok' : 'vf-ask-no') + '">' + (free ? g.slots + ' free' : 'booked') + '</span>' +
        '<span class="vf-ask-n">' + g.count + '</span>' +
        '</div>';
    }).join('');
    if (a.other) rows += '<div class="vf-ask-other">+ taps with no specific game: ' + a.other + '</div>';
    return rows;
  }

  // '' when nothing was searched in vain, so the caller can hide the panel.
  function missesHtml(win) {
    var m = (win && win.misses) || [];
    return m.map(function (x) {
      return '<div class="vf-exit-row"><span class="vf-exit-path">' + esc(x.q) + '</span>' +
        '<span class="vf-exit-n"><strong>' + x.count + '</strong> search' + (x.count !== 1 ? 'es' : '') + '</span></div>';
    }).join('');
  }

  var api = { esc: esc, browsedHtml: browsedHtml, funnelHtml: funnelHtml, askedHtml: askedHtml, missesHtml: missesHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DashVisitors = api;
})(typeof window !== 'undefined' ? window : this);
