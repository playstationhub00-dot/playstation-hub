// The dashboard month panel's Earned list (views/partials/admin/dashboard/
// money.ejs). It lists payments, not rentals — a rental extended, topped up by
// a swap, or paid off after a Coming Soon release has several — and bare
// "name — game ₱X" lines made those read as the same renter twice. So each
// line says what the payment was and when, a rental's extra payments sit
// right under it, and a rental whose payments add up to more than its price is
// flagged: by design they always add up to the price (lib/payments.js), so
// more than that is money counted twice.
//
// Pure, for the browser (window.EarnedLines) and node scripts/test-earned-lines.js.
(function (root) {
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // The kinds lib/payments.js, the order routes and Quick Add record.
  // 'extension' is every raise of a rental's price after it started: more
  // days, a swap top-up, a reservation's balance.
  var LABELS = {
    rental: 'Rental', rent: 'Rental', purchase: 'Purchase', reservation: 'Reservation',
    extension: 'Extra payment', adjustment: 'Price correction'
  };

  function kindLabel(kind) { return LABELS[kind] || 'Payment'; }

  // 'YYYY-MM-DD' → 'Oct 7'.
  function shortDate(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m || !MONTHS[Number(m[2]) - 1]) return '';
    return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]);
  }

  function num(n) { n = Number(n); return Number.isFinite(n) ? n : 0; }

  // items: [{ c, p }] — a customer row and one of its payments, as the panel's
  // dashPaymentsIn() gives them for the chosen month. Rentals come in the
  // order they were first paid this month; each rental's payments by date.
  function earnedLines(items) {
    var groups = [];
    (items || []).forEach(function (x, i) {
      var g = null;
      for (var k = 0; k < groups.length; k++) if (groups[k].c === x.c) { g = groups[k]; break; }
      if (!g) { g = { c: x.c, items: [] }; groups.push(g); }
      g.items.push({ p: x.p, i: i });
    });
    var byDate = function (a, b) { return String(a.p.date).localeCompare(String(b.p.date)) || a.i - b.i; };
    groups.forEach(function (g) { g.items.sort(byDate); });
    groups.sort(function (a, b) { return byDate(a.items[0], b.items[0]); });

    var out = [];
    groups.forEach(function (g) {
      var paid = (g.c.payments || []).reduce(function (s, p) { return s + num(p && p.amount); }, 0);
      var warn = paid > num(g.c.price);
      g.items.forEach(function (it, n) {
        out.push({
          name: g.c.customer_name || 'Unknown',
          game: g.c.game_title || '',
          label: kindLabel(it.p.kind),
          when: shortDate(it.p.date),
          amount: num(it.p.amount),
          extra: n > 0,
          warn: n === 0 && warn
        });
      });
    });
    return out;
  }

  var api = { kindLabel: kindLabel, shortDate: shortDate, earnedLines: earnedLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EarnedLines = api;
})(typeof window !== 'undefined' ? window : this);
