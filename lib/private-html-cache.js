// HTML is personal (the session cookie, the live promo). A shared cache must
// not store it. Routes that already chose a Cache-Control keep theirs —
// sitemap, feeds and static files are not HTML renders.
const HEADER = 'private, no-cache';

function install(app) {
  app.use((req, res, next) => {
    const render = res.render;
    res.render = function renderPrivate() {
      if (typeof res.getHeader === 'function' && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', HEADER);
      }
      return render.apply(this, arguments);
    };
    next();
  });
}

module.exports = { install, HEADER };
