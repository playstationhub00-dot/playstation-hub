// Live days / hours / minutes on the homepage Coming soon cards.
(function () {
  var nodes = document.querySelectorAll('.hh-count[data-release]');
  if (!nodes.length) return;
  function paint() {
    var now = Date.now();
    nodes.forEach(function (node) {
      var end = Date.parse(node.getAttribute('data-release'));
      var left = Math.max(0, end - now);
      var days = Math.floor(left / 86400000);
      var hrs = Math.floor((left % 86400000) / 3600000);
      var min = Math.floor((left % 3600000) / 60000);
      var bits = node.querySelectorAll('b');
      if (bits[0]) bits[0].textContent = String(days);
      if (bits[1]) bits[1].textContent = String(hrs);
      if (bits[2]) bits[2].textContent = String(min);
    });
  }
  paint();
  setInterval(paint, 30000);
})();
