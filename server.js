const express = require('express');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const sharp = require('sharp');
const session = require('express-session');
const computeAvailability = require('./lib/availability');
const orders = require('./lib/orders');
const { normalizeCustomerPayments, priceDeltaPayment } = require('./lib/payments');
const templates = require('./lib/templates');

const app = express();
const PORT = process.env.PORT || 3000;

// The two rental durations the whole site offers. Every duration-driven loop,
// form, and price lookup reads from this — changing durations again later is a
// one-line edit here instead of a repo-wide hunt. `days` also drives the
// `{type}_price_{days}d` field names on games/price_categories/psplus_prices/
// upcoming (e.g. nt_price_7d, tr_price_30d).
const RENTAL_DURATIONS = [
  { days: 7,  label: 'Weekly',  sub: '1 Week'  },
  { days: 30, label: 'Monthly', sub: '1 Month' },
];
const PROMO_DURATIONS = RENTAL_DURATIONS.map(d => d.days); // [7, 30]
app.locals.RENTAL_DURATIONS = RENTAL_DURATIONS;

// DATA_DIR env var points to a persistent volume on Railway (e.g. /data)
// Falls back to local project folder for development
const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Simple in-memory per-IP rate limiter for the open, unauthenticated order
// routes. No new dependency — a Map is enough given this project's scale.
// Not perfect (resets on restart, doesn't account for shared IPs), just
// present so a single abuser can't hammer these routes unbounded.
const rateBuckets = new Map();
function rateLimited(bucketKey, ip, max, windowMs) {
  const key = bucketKey + ':' + ip;
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, b);
  }
  b.count++;
  return b.count > max;
}
// Cloudflare sits in front of this app and always sets CF-Connecting-IP to
// the true client address, overwriting any spoofed value — that must be read
// first. x-forwarded-for's first hop through Cloudflare's proxy is one of
// Cloudflare's own edge addresses, not the visitor's, so falling back to it
// silently records "Cloudflare" as almost every visitor.
function clientIp(req) {
  return (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim();
}

// req.cookies requires the cookie-parser middleware, which this project does
// not have — reading one cookie by hand is a few lines and doesn't justify
// adding a dependency. Express's own res.cookie() handles writing without it.
function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

const SESSION_COOKIE = 'ph_sid';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, rolling

// Identifies a browsing session across page visits, independent of IP —
// carrier-grade NAT means many unrelated mobile users in the Philippines
// legitimately share one public IP, so IP was never going to be a valid
// visitor identity even once correctly captured (see clientIp() above).
// Re-issues the cookie with a fresh expiry on every call so 30 days counts
// from the visitor's LAST visit, not their first.
function sessionId(req, res) {
  let sid = getCookie(req, SESSION_COOKIE);
  if (!sid) sid = require('crypto').randomBytes(16).toString('hex');
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS
  });
  return sid;
}

const adapter = new FileSync(path.join(dataDir, 'games.json'));
const db = low(adapter);
db.defaults({
  games: [],
  nextId: 1,
  nextUpcomingId: 1,
  upcoming: [],
  reviews: [],
  nextReviewId: 1,
  psplus: [],
  nextPsplusId: 1,
  psplus_popular: [],
  nextPsplusPopularId: 1,
  psplus_prices: {
    nt_price_10d: 349, nt_price_15d: 449, nt_price_30d: 599,
    tr_price_10d: 399, tr_price_15d: 499, tr_price_30d: 699
  },
  psplus_slots: { nt_slots: 0, tr_slots: 0, ps4_slots: 0 },
  announcement: { text: '📢 Monthly subscription renters can enjoy unlimited swap of games! Message us for more info.', active: true },
  announcements: [],
  nextAnnouncementId: 1,
  site_settings: {
    title: 'Playstation Hub',
    logo_path: '/logo.svg',
    favicon_path: '/favicon.svg',
    hero_bg: { type: 'default', path: '' },
    hero_text: {
      line1: 'Rent the Latest',
      highlight: 'PS5 & PS4',
      line2: 'Games',
      subtitle: 'Play more, pay less. Rent top titles starting at ₱99 — choose Weekly or Monthly.',
      title_size: 55,
      highlight_color: '#F0A500',
      subtitle_color: '#aaaaaa'
    }
  },
  hero_slides: [],
  admin_password: 'admin123',
  price_categories: [],
  nextPriceCategoryId: 1,
  customers: [],
  nextCustomerId: 1,
  visitors: [],
  messenger_contacts: [],
  notification_optins: [],
  bot_training: [],
  nextBotTrainingId: 1,
  signin_steps: [],
  nextSigninStepId: 1,
  accounts: [],
  nextAccountId: 1,
  month_logs: []
}).write();

// Seed default sign-in steps on first run only — an owner who has already
// edited/reordered these should never have them silently reset.
if (!db.get('signin_steps').value().length) {
  const DEFAULT_SIGNIN_STEPS = [
    { console: 'ps5', text: 'On your PS5, go to Settings → Users and Accounts → Users' },
    { console: 'ps5', text: 'Select your profile, then choose "Sign in with PS App" so the QR code appears on screen' },
    { console: 'ps5', text: 'Take a photo of the QR code and send it to us' },
    { console: 'ps4', text: 'On your PS4, go to Settings → Login Settings → Sign In' },
    { console: 'ps4', text: 'Choose "Sign in with QR Code" so the QR code appears on screen' },
    { console: 'ps4', text: 'Take a photo of the QR code and send it to us' }
  ];
  let nextId = db.get('nextSigninStepId').value();
  const seeded = DEFAULT_SIGNIN_STEPS.map((s, i) => {
    const byConsole = DEFAULT_SIGNIN_STEPS.filter(x => x.console === s.console);
    const rank = byConsole.indexOf(s);
    return Object.assign({ id: nextId++, rank, image: null, created_at: new Date().toISOString() }, s);
  });
  db.set('signin_steps', seeded).write();
  db.set('nextSigninStepId', nextId).write();
}

// Ensure accounts collection exists for pre-existing databases
if (db.get('accounts').value() === undefined) db.set('accounts', []).write();
if (db.get('nextAccountId').value() === undefined) db.set('nextAccountId', 1).write();
if (db.get('month_logs').value() === undefined) db.set('month_logs', []).write();

// Migrate visitor paths: /game/NUMBER → /game/slug
(function migrateVisitorPaths() {
  const visitors = db.get('visitors').value();
  let changed = false;
  const updated = visitors.map(v => {
    const m = v.path && v.path.match(/^\/game\/(\d+)$/);
    if (!m) return v;
    const game = db.get('games').find({ id: parseInt(m[1]) }).value();
    if (!game) return v;
    const slug = game.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    changed = true;
    return { ...v, path: '/game/' + slug, page: game.title };
  });
  if (changed) db.set('visitors', updated).write();
})();

// Migrate existing games to new fields if missing
db.get('games').value().forEach(g => {
  const patch = {};
  if (g.price_10d === undefined) patch.price_10d = g.price_per_week || 149;
  if (g.price_15d === undefined) patch.price_15d = Math.round((g.price_per_week || 149) * 1.5);
  if (g.price_30d === undefined) patch.price_30d = Math.round((g.price_per_week || 149) * 2.5);
  if (g.trophy_account === undefined) patch.trophy_account = false;
  // Separate trophy/non-trophy prices
  if (g.nt_price_10d === undefined) patch.nt_price_10d = g.price_10d || g.price_per_week || 149;
  if (g.nt_price_15d === undefined) patch.nt_price_15d = g.price_15d || Math.round((g.price_per_week || 149) * 1.5);
  if (g.nt_price_30d === undefined) patch.nt_price_30d = g.price_30d || Math.round((g.price_per_week || 149) * 2.5);
  if (g.tr_price_10d === undefined) patch.tr_price_10d = (g.price_10d || g.price_per_week || 149) + 50;
  if (g.tr_price_15d === undefined) patch.tr_price_15d = (g.price_15d || Math.round((g.price_per_week || 149) * 1.5)) + 50;
  if (g.tr_price_30d === undefined) patch.tr_price_30d = (g.price_30d || Math.round((g.price_per_week || 149) * 2.5)) + 50;
  // Backfill with a date well outside the "added this month" window so pre-existing
  // catalog games don't retroactively show a NEW badge.
  if (g.created_at === undefined) patch.created_at = '2020-01-01T00:00:00.000Z';
  // Weekly/Monthly migration: Monthly reuses the existing (already-correct)
  // 30-day price as-is. Weekly seeds from the old 10-day price — same number,
  // shorter period, a deliberate per-day price increase (spec decision).
  if (g.nt_price_7d === undefined) patch.nt_price_7d = g.nt_price_10d !== undefined ? g.nt_price_10d : (patch.nt_price_10d || 149);
  if (g.tr_price_7d === undefined) patch.tr_price_7d = g.tr_price_10d !== undefined ? g.tr_price_10d : (patch.tr_price_10d || 199);
  if (Object.keys(patch).length) {
    db.get('games').find({ id: g.id }).assign(patch).write();
  }
});

// Weekly/Monthly migration for price categories — same rule as games above.
db.get('price_categories').value().forEach(cat => {
  const patch = {};
  if (cat.nt_price_7d === undefined) patch.nt_price_7d = cat.nt_price_10d || 149;
  if (cat.tr_price_7d === undefined) patch.tr_price_7d = cat.tr_price_10d || 199;
  if (Object.keys(patch).length) {
    db.get('price_categories').find({ id: cat.id }).assign(patch).write();
  }
});

// Weekly/Monthly migration for PS Plus rental prices (single object, not an array).
(function migratePsplusPricesWeeklyMonthly() {
  const pp = db.get('psplus_prices').value();
  if (!pp) return;
  const patch = {};
  if (pp.nt_price_7d === undefined) patch.nt_price_7d = pp.nt_price_10d || 349;
  if (pp.tr_price_7d === undefined) patch.tr_price_7d = pp.tr_price_10d || 399;
  if (Object.keys(patch).length) db.set('psplus_prices', { ...pp, ...patch }).write();
})();

// Weekly/Monthly migration for Coming Soon (upcoming) entries.
db.get('upcoming').value().forEach(u => {
  const patch = {};
  if (u.nt_price_7d === undefined) patch.nt_price_7d = u.nt_price_10d || 0;
  if (u.tr_price_7d === undefined) patch.tr_price_7d = u.tr_price_10d || 0;
  if (Object.keys(patch).length) {
    db.get('upcoming').find({ id: u.id }).assign(patch).write();
  }
});

if (db.get('games').size().value() === 0) {
  const sampleGames = [
    { title: "Marvel's Wolverine",               platform: 'PS5',     available_slots: 1, renters: 7,  nt_price_10d: 199, nt_price_15d: 299, nt_price_30d: 499, tr_price_10d: 249, tr_price_15d: 349, tr_price_30d: 549, genre: 'Action',           trophy_account: true,  cover_image: '', description: '' },
    { title: 'The Last of Us: Part I',            platform: 'PS5',     available_slots: 0, renters: 2,  nt_price_10d: 149, nt_price_15d: 199, nt_price_30d: 349, tr_price_10d: 199, tr_price_15d: 249, tr_price_30d: 399, genre: 'Action-Adventure', trophy_account: false, cover_image: '', description: '' },
    { title: 'The Last of Us Part II Remastered', platform: 'PS5',    available_slots: 0, renters: 2,  nt_price_10d: 149, nt_price_15d: 199, nt_price_30d: 349, tr_price_10d: 199, tr_price_15d: 249, tr_price_30d: 399, genre: 'Action-Adventure', trophy_account: true,  cover_image: '', description: '' },
    { title: 'Tekken 8',                          platform: 'PS5',     available_slots: 2, renters: 8,  nt_price_10d: 99,  nt_price_15d: 149, nt_price_30d: 249, tr_price_10d: 149, tr_price_15d: 199, tr_price_30d: 299, genre: 'Fighting',          trophy_account: false, cover_image: '', description: '' },
    { title: 'Split Fiction',                     platform: 'PS5',     available_slots: 2, renters: 4,  nt_price_10d: 149, nt_price_15d: 199, nt_price_30d: 349, tr_price_10d: 199, tr_price_15d: 249, tr_price_30d: 399, genre: 'Co-op',             trophy_account: false, cover_image: '', description: '' },
    { title: "Marvel's Spider-Man 2",             platform: 'PS5',     available_slots: 3, renters: 12, nt_price_10d: 149, nt_price_15d: 199, nt_price_30d: 349, tr_price_10d: 199, tr_price_15d: 249, tr_price_30d: 399, genre: 'Action',            trophy_account: true,  cover_image: '', description: '' },
    { title: 'Silent Hill f',                     platform: 'PS5',     available_slots: 1, renters: 3,  nt_price_10d: 149, nt_price_15d: 199, nt_price_30d: 349, tr_price_10d: 199, tr_price_15d: 249, tr_price_30d: 399, genre: 'Horror',            trophy_account: false, cover_image: '', description: '' },
    { title: 'Saros',                             platform: 'PS5',     available_slots: 2, renters: 5,  nt_price_10d: 129, nt_price_15d: 179, nt_price_30d: 299, tr_price_10d: 179, tr_price_15d: 229, tr_price_30d: 349, genre: 'Action',            trophy_account: false, cover_image: '', description: '' },
    { title: 'Resident Evil Requiem',             platform: 'PS5',     available_slots: 1, renters: 6,  nt_price_10d: 149, nt_price_15d: 199, nt_price_30d: 349, tr_price_10d: 199, tr_price_15d: 249, tr_price_30d: 399, genre: 'Horror',            trophy_account: true,  cover_image: '', description: '' },
    { title: 'Reanimal',                          platform: 'PS5',     available_slots: 2, renters: 3,  nt_price_10d: 129, nt_price_15d: 179, nt_price_30d: 299, tr_price_10d: 179, tr_price_15d: 229, tr_price_30d: 349, genre: 'Horror',            trophy_account: false, cover_image: '', description: '' },
    { title: 'God of War Ragnarök',               platform: 'PS5',     available_slots: 2, renters: 15, nt_price_10d: 149, nt_price_15d: 199, nt_price_30d: 349, tr_price_10d: 199, tr_price_15d: 249, tr_price_30d: 399, genre: 'Action-Adventure',  trophy_account: true,  cover_image: '', description: '' },
    { title: 'Hogwarts Legacy',                   platform: 'PS4/PS5', available_slots: 3, renters: 10, nt_price_10d: 99,  nt_price_15d: 149, nt_price_30d: 249, tr_price_10d: 149, tr_price_15d: 199, tr_price_30d: 299, genre: 'RPG',               trophy_account: false, cover_image: '', description: '' },
  ];
  let nextId = 1;
  sampleGames.forEach(g => {
    db.get('games').push({ id: nextId++, ...g, created_at: new Date().toISOString() }).write();
  });
  db.set('nextId', nextId).write();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => cb(null, /jpeg|jpg|png|gif|webp/.test(file.mimetype)),
  limits: { fileSize: 5 * 1024 * 1024 }
});
// Poster background images tend to be larger (full-bleed photography), so give
// that upload a higher ceiling than the standard 5MB thumbnail/cover limit.
const uploadPosterBg = multer({
  storage,
  fileFilter: (req, file, cb) => cb(null, /jpeg|jpg|png|gif|webp/.test(file.mimetype)),
  limits: { fileSize: 20 * 1024 * 1024 }
});
// Promo media (homepage promo poster/video) — accepts images or short video clips.
const uploadPromoMedia = multer({
  storage,
  fileFilter: (req, file, cb) => cb(null, /jpeg|jpg|png|gif|webp|mp4|webm|ogg/.test(file.mimetype)),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// Every uploaded cover/gallery image gets downsized and re-encoded as WebP right after
// multer saves it — nothing on this site displays a cover wider than ~400px (cards) or
// ~380px (game detail), so the original phone-camera-sized uploads (often 1-2MB+) were
// pure waste being shipped to every visitor. maxDim is generous (900px) to stay sharp
// on retina displays while still cutting most uploads by 80%+.
async function processUploadedImage(file, maxDim = 900) {
  if (!file) return '';
  if (!/^image\//.test(file.mimetype)) return '/uploads/' + file.filename; // video etc. — leave alone
  const outName = path.basename(file.filename, path.extname(file.filename)) + '.webp';
  const outPath = path.join(uploadsDir, outName);
  try {
    await sharp(file.path)
      .rotate() // respect EXIF orientation before resizing
      .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(outPath);
    fs.unlinkSync(file.path);
    return '/uploads/' + outName;
  } catch (e) {
    // Corrupt/unsupported image — fall back to the untouched original rather than 500ing.
    console.error('Image processing failed for', file.filename, e.message);
    return '/uploads/' + file.filename;
  }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Expose account-summary helper to every EJS template (e.g. partials/game-card.ejs)
app.locals.gameAccountSummary = (gameId) => gameAccountSummary(gameId);
// Expose shared per-game availability computation (accounts-vs-legacy fallback, per slot type)
app.locals.computeAvailability = computeAvailability;
// Expose promo discount lookup so game cards can show the final discounted price, not just the badge
app.locals.getPromoDiscountPct = (promo, days) => getPromoDiscountPct(promo, days);
// Expose template rendering so admin views can build filled-in customer messages
app.locals.renderTemplate = (kind, customer, tpls, opts) => templates.renderFor(kind, customer, tpls, opts);
app.use(express.static(path.join(__dirname, 'public')));

// The edge caches /css/style.css for hours and ignores any Cache-Control we
// set, so a deploy would otherwise leave visitors on stale styles. Cache keys
// are per-URL, so views append ?v=<assetV> to bust it. A redeploy rewrites
// every file's mtime, which is exactly when the version should change.
app.locals.assetV = (() => {
  try {
    return String(Math.floor(fs.statSync(path.join(__dirname, 'public/css/style.css')).mtimeMs));
  } catch {
    return String(Date.now());
  }
})();

// ── JPEG renditions for the Meta catalog feed ────────────────────────────────
// processUploadedImage() stores every cover as .webp, which keeps the site fast
// on mobile, but Meta's product catalog expects JPEG/PNG. Rather than change the
// upload pipeline, convert on demand and cache the result next to the original.
// Registered before the /uploads static handler so this virtual path is matched
// before a filesystem miss (the /uploads/jpg directory doesn't exist on disk).
const jpgCacheDir = path.join(uploadsDir, '_jpg');
app.get('/uploads/jpg/:name', async (req, res) => {
  const base = path.basename(String(req.params.name)).replace(/\.[^.]+$/, '');
  if (!base || base.startsWith('.')) return res.status(400).send('Bad request');
  const cached = path.resolve(jpgCacheDir, base + '.jpg');
  try {
    if (!fs.existsSync(cached)) {
      const src = ['.webp', '.jpg', '.jpeg', '.png', '.gif']
        .map(ext => path.resolve(uploadsDir, base + ext))
        .find(p => fs.existsSync(p));
      if (!src) return res.status(404).send('Not found');
      if (!fs.existsSync(jpgCacheDir)) fs.mkdirSync(jpgCacheDir, { recursive: true });
      // WebP may carry alpha; JPEG can't, so flatten onto the site's dark backdrop.
      await sharp(src).flatten({ background: '#101010' }).jpeg({ quality: 85 }).toFile(cached);
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(cached);
  } catch (e) {
    console.error('[jpg-rendition]', base, e.message);
    res.status(500).send('Conversion failed');
  }
});

// Serve uploads from persistent data directory
app.use('/uploads', express.static(uploadsDir));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'pshub-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

// ── Visitor tracking middleware ───────────────────────────────────────────────
const PAGE_LABELS = { '/': 'Home', '/browse': 'Browse Games', '/ps-plus': 'PS Plus Deluxe', '/how-it-works': 'How It Works' };
app.use((req, res, next) => {
  const reqPath = req.path;
  // Only track public pages, not admin/assets/uploads
  if (reqPath.startsWith('/admin') || reqPath.startsWith('/uploads') || reqPath.startsWith('/css') || reqPath.startsWith('/js') || reqPath.includes('.')) return next();
  const pageLabel = PAGE_LABELS[reqPath] || reqPath;
  const ip = require('crypto').createHash('sha256').update(clientIp(req)).digest('hex');
  const sid = sessionId(req, res);
  // Later route handlers in this same request (e.g. POST /order/create in
  // Task 2) read this instead of calling sessionId() a second time, so
  // there's exactly one place per request that decides "who is this."
  req.sessionId = sid;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  db.get('visitors').push({ date: today, time: now, path: reqPath, page: pageLabel, ip, session_id: sid }).write();
  // Cap well above realistic traffic volume so All-Time visits actually reflects all
  // time instead of silently plateauing — lowdb rewrites the whole file per write, so
  // some ceiling is still needed to avoid unbounded growth over years of uptime.
  const all = db.get('visitors').value();
  if (all.length > 200000) db.set('visitors', all.slice(all.length - 200000)).write();
  next();
});

// Auth middleware — protects all /admin routes
function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// Login routes (public)
app.get('/admin/login', (req, res) => {
  res.render('login', { error: null, settings: getSiteSettings() });
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  const correct = db.get('admin_password').value();
  if (password === correct) {
    req.session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Incorrect password. Try again.', settings: getSiteSettings() });
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

function getGames() { return db.get('games').value(); }
function getGame(id) { return db.get('games').find({ id: parseInt(id) }).value(); }
function newId() {
  const id = db.get('nextId').value();
  db.set('nextId', id + 1).write();
  return id;
}

function getUpcoming() { return db.get('upcoming').value(); }
function getUpcomingGame(id) { return db.get('upcoming').find({ id: parseInt(id) }).value(); }
function newUpcomingId() {
  const id = db.get('nextUpcomingId').value();
  db.set('nextUpcomingId', id + 1).write();
  return id;
}

function getPsplus() { return db.get('psplus').value(); }
function getPsplusEntry(id) { return db.get('psplus').find({ id: parseInt(id) }).value(); }
function newPsplusId() {
  const id = db.get('nextPsplusId').value();
  db.set('nextPsplusId', id + 1).write();
  return id;
}
function getPsplusPrices() { return db.get('psplus_prices').value(); }
function getPsplusSlots() { return db.get('psplus_slots').value() || { nt_slots: 0, tr_slots: 0, ps4_slots: 0 }; }
function getSigninSteps() {
  const all = db.get('signin_steps').value() || [];
  const sortByRank = (a, b) => a.rank - b.rank;
  return {
    ps5: all.filter(s => s.console === 'ps5').sort(sortByRank),
    ps4: all.filter(s => s.console === 'ps4').sort(sortByRank)
  };
}

function getPsplusPopular() { return db.get('psplus_popular').value(); }
function getPsplusPopularEntry(id) { return db.get('psplus_popular').find({ id: parseInt(id) }).value(); }
function newPsplusPopularId() {
  const id = db.get('nextPsplusPopularId').value();
  db.set('nextPsplusPopularId', id + 1).write();
  return id;
}

// MongoDB sync — saves entire db state after every write
let _mongoSaveClient = null;
async function _getMongoDb() {
  if (!process.env.MONGODB_URI) return null;
  const { MongoClient } = require('mongodb');
  // Reconnect if client is gone or connection dropped
  if (_mongoSaveClient) {
    try { await _mongoSaveClient.db('admin').command({ ping: 1 }); }
    catch { try { await _mongoSaveClient.close(); } catch {} _mongoSaveClient = null; }
  }
  if (!_mongoSaveClient) {
    _mongoSaveClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await _mongoSaveClient.connect();
    console.log('[mongo] Connected to MongoDB Atlas');
  }
  return _mongoSaveClient.db('pshub');
}
function syncToMongo() {
  if (!process.env.MONGODB_URI) return;
  _getMongoDb().then(mdb => {
    if (!mdb) return;
    return mdb.collection('state').replaceOne(
      { _id: 'db' },
      { _id: 'db', data: db.getState() },
      { upsert: true }
    );
  }).then(r => {
    if (r) console.log('[mongo] Synced to MongoDB ✅');
  }).catch(e => {
    console.log('[mongo sync error]', e.message);
    _mongoSaveClient = null; // force reconnect next time
  });
}
const _origWrite = db.write.bind(db);
db.write = function() {
  const r = _origWrite();
  syncToMongo();
  return r;
};

// Orders persist as their own MongoDB documents, reusing the connection the
// blob sync already maintains rather than opening a second pool.
orders.init(_getMongoDb);

function normalizeCustomer(c) {
  if (!c) return c;
  c.swap_history = Array.isArray(c.swap_history) ? c.swap_history : [];
  normalizeCustomerPayments(c);
  return c;
}
function getCustomers() { return (db.get('customers').value() || []).map(normalizeCustomer); }
function getCustomer(id) {
  const c = db.get('customers').find({ id: parseInt(id) }).value();
  return c ? normalizeCustomer(c) : c;
}
function newCustomerId() {
  const id = db.get('nextCustomerId').value();
  db.set('nextCustomerId', id + 1).write();
  return id;
}

// ── Accounts (per-account slot inventory) ──────────────────────────────────
const ACCOUNT_SLOT_TYPES = ['trophy', 'non_trophy', 'ps4_primary'];
const ACCOUNT_STATUSES = ['open', 'rented', 'buyed', 'na', 'maintenance'];
function blankSlot(enabled) {
  return { enabled: enabled !== false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
}
function normalizeAccount(a) {
  if (!a) return a;
  a.slots = a.slots || {};
  ACCOUNT_SLOT_TYPES.forEach(t => {
    if (!a.slots[t]) a.slots[t] = blankSlot(true);
    if (!ACCOUNT_STATUSES.includes(a.slots[t].status)) a.slots[t].status = 'open';
  });
  a.game_ids = Array.isArray(a.game_ids) ? a.game_ids : [];
  a.email = a.email || '';
  a.for_sale = a.for_sale === true;
  a.public_name = a.public_name || '';
  return a;
}
function getAccounts() { return (db.get('accounts').value() || []).map(normalizeAccount); }
function getAccount(id) {
  const a = db.get('accounts').find({ id: parseInt(id) }).value();
  return a ? normalizeAccount(a) : a;
}
function newAccountId() {
  const id = db.get('nextAccountId').value() || 1;
  db.set('nextAccountId', id + 1).write();
  return id;
}

// ── Month logs (dashboard drill-down: ad count/spend + screenshots per YYYY-MM) ──
function normalizeMonthLog(m) {
  if (!m) return m;
  m.images = Array.isArray(m.images) ? m.images : [];
  m.ad_count = m.ad_count || 0;
  m.ad_spend = m.ad_spend || 0;
  m.note = m.note || '';
  return m;
}
function getMonthLogs() { return (db.get('month_logs').value() || []).map(normalizeMonthLog); }
function getMonthLog(key) {
  const m = db.get('month_logs').find({ key }).value();
  return m ? normalizeMonthLog(m) : m;
}
// Days until a slot's end date (null if no end date). Negative = expired.
function slotDaysLeft(slot) {
  if (!slot || !slot.end) return null;
  const end = new Date(slot.end + 'T23:59:59');
  if (isNaN(end)) return null;
  return Math.ceil((end - new Date()) / 86400000);
}
// Aggregate availability of a game across every account that holds it (phase 2).
function gameAccountSummary(gameId) {
  const gid = parseInt(gameId);
  const summary = {};
  ACCOUNT_SLOT_TYPES.forEach(t => { summary[t] = { available: 0, total: 0, next_end: null }; });
  getAccounts().forEach(acc => {
    if (!acc.game_ids.includes(gid)) return;
    ACCOUNT_SLOT_TYPES.forEach(t => {
      const s = acc.slots[t];
      if (!s || !s.enabled) return;
      summary[t].total++;
      if (s.status === 'open') summary[t].available++;
      else if (s.status === 'rented' && s.end) {
        if (!summary[t].next_end || s.end < summary[t].next_end) summary[t].next_end = s.end;
      }
    });
  });
  return summary;
}
// Build a gameId → summary map in a single pass over all accounts, so pages that render
// many game-card partials (browse, index) don't recompute the summary per card.
function buildAccountSummaryMap() {
  const map = {};
  function blankSummary() {
    const s = {};
    ACCOUNT_SLOT_TYPES.forEach(t => { s[t] = { available: 0, total: 0, next_end: null }; });
    return s;
  }
  getAccounts().forEach(acc => {
    acc.game_ids.forEach(gid => {
      if (!map[gid]) map[gid] = blankSummary();
      const summary = map[gid];
      ACCOUNT_SLOT_TYPES.forEach(t => {
        const s = acc.slots[t];
        if (!s || !s.enabled) return;
        summary[t].total++;
        if (s.status === 'open') summary[t].available++;
        else if (s.status === 'rented' && s.end) {
          if (!summary[t].next_end || s.end < summary[t].next_end) summary[t].next_end = s.end;
        }
      });
    });
  });
  return map;
}

function getPriceCategories() { return db.get('price_categories').value() || []; }
function getPriceCategory(id) { return db.get('price_categories').find({ id: parseInt(id) }).value(); }
function newPriceCategoryId() {
  const id = db.get('nextPriceCategoryId').value();
  db.set('nextPriceCategoryId', id + 1).write();
  return id;
}
// Returns the effective prices for a game (from category or its own fields)
function resolveGamePrices(game) {
  if (game.price_category_id) {
    const cat = getPriceCategory(game.price_category_id);
    if (cat) {
      return { ...game,
        nt_price_7d: cat.nt_price_7d, nt_price_10d: cat.nt_price_10d, nt_price_15d: cat.nt_price_15d, nt_price_30d: cat.nt_price_30d,
        tr_price_7d: cat.tr_price_7d, tr_price_10d: cat.tr_price_10d, tr_price_15d: cat.tr_price_15d, tr_price_30d: cat.tr_price_30d,
        _category_name: cat.name
      };
    }
  }
  return { ...game, _category_name: null };
}

function resolveSlotDays(game) {
  const today = new Date(); today.setHours(0,0,0,0);
  const renters = getCustomers().filter(c => c.game_title === game.title && c.status === 'renting' && c.end_date);
  function soonest(type) {
    const ends = renters.filter(c => c.account_type === type).map(c => new Date(c.end_date + 'T00:00:00'));
    if (!ends.length) return null;
    const min = new Date(Math.min(...ends));
    return Math.ceil((min - today) / 86400000);
  }
  return { ...game, nt_days_left: soonest('nt'), tr_days_left: soonest('tr'), ps4_days_left: soonest('ps4') };
}

function getAnnouncements() {
  // Migrate legacy single announcement to list on first access
  let list = db.get('announcements').value();
  if (!list || list.length === 0) {
    const legacy = db.get('announcement').value();
    if (legacy && legacy.text) {
      const migrated = [{ id: 1, text: legacy.text, active: legacy.active !== false }];
      db.set('announcements', migrated).set('nextAnnouncementId', 2).write();
      list = migrated;
    }
  }
  return list || [];
}
function getAnnouncement() { return db.get('announcement').value(); }
function getSiteSettings() {
  const s = db.get('site_settings').value();
  if (!s.hero_text) {
    db.set('site_settings.hero_text', {
      line1: 'Rent the Latest', highlight: 'PS5 & PS4', line2: 'Games',
      subtitle: 'Play more, pay less. Rent top titles starting at ₱99 — choose Weekly or Monthly.',
      title_size: 55, highlight_color: '#F0A500', subtitle_color: '#aaaaaa'
    }).write();
    s.hero_text = db.get('site_settings.hero_text').value();
  }
  // Weekly/Monthly migration: the hero subtitle is admin-editable, so only rewrite
  // it if it still exactly matches the old auto-generated default — never
  // overwrite a subtitle an admin customized.
  const OLD_HERO_SUBTITLE = 'Play more, pay less. Rent top titles starting at ₱99 — choose 10, 15, or 30 days.';
  const NEW_HERO_SUBTITLE = 'Play more, pay less. Rent top titles starting at ₱99 — choose Weekly or Monthly.';
  if (s.hero_text && s.hero_text.subtitle === OLD_HERO_SUBTITLE) {
    db.set('site_settings.hero_text.subtitle', NEW_HERO_SUBTITLE).write();
    s.hero_text.subtitle = NEW_HERO_SUBTITLE;
  }
  if (!s.favicon_path) {
    db.set('site_settings.favicon_path', '/favicon.svg').write();
    s.favicon_path = '/favicon.svg';
  }
  if (!s.hero_bg) {
    db.set('site_settings.hero_bg', { type: 'default', path: '', overlay: 50 }).write();
    s.hero_bg = { type: 'default', path: '', overlay: 50 };
  } else if (s.hero_bg.overlay === undefined) {
    db.set('site_settings.hero_bg.overlay', 50).write();
    s.hero_bg.overlay = 50;
  }
  if (!s.hero_slides) {
    db.set('site_settings.hero_slides', []).write();
    s.hero_slides = [];
  }
  if (!s.promo) {
    db.set('site_settings.promo', { enabled: true, discounts: { 10: 0, 15: 0, 30: 10 }, deposit: 100, late_fee_per_day: 20, buy_promo_enabled: false, buy_promo_pct: 0, media_path: '', media_type: '', ends_at: '', title: 'Rent Longer. Save More.', text: 'Discount applied automatically at checkout — no code needed.' }).write();
    s.promo = db.get('site_settings.promo').value();
  } else if (!s.promo.discounts) {
    // Migrate legacy single-duration promo (discount_pct + apply_on_days) to the
    // per-duration `discounts` map, preserving whatever was already configured.
    const discounts = { 10: 0, 15: 0, 30: 0 };
    if (s.promo.discount_pct > 0 && PROMO_DURATIONS.includes(s.promo.apply_on_days)) {
      discounts[s.promo.apply_on_days] = s.promo.discount_pct;
    }
    db.set('site_settings.promo.discounts', discounts).write();
    s.promo.discounts = discounts;
  }
  if (s.promo && s.promo.media_path === undefined) {
    db.set('site_settings.promo.media_path', '').set('site_settings.promo.media_type', '').set('site_settings.promo.ends_at', '').write();
    s.promo.media_path = ''; s.promo.media_type = ''; s.promo.ends_at = '';
  }
  if (!s.popup) {
    db.set('site_settings.popup', { enabled: false, image_path: '', link_url: '/browse', starts_at: '', ends_at: '', version: 1 }).write();
    s.popup = db.get('site_settings.popup').value();
  }
  if (s.section_gap === undefined) {
    db.set('site_settings.section_gap', 4).write();
    s.section_gap = 4;
  }
  // Weekly/Monthly migration: promo discount keys move from {10,15,30} to {7,30}.
  // Seed the new "7" key from the old "10" key so an existing promo's Weekly
  // discount isn't silently lost; leave "10"/"15"/"30" in place (unread) for a
  // clean rollback.
  if (s.promo && s.promo.discounts && s.promo.discounts[7] === undefined) {
    const migratedDiscounts = { ...s.promo.discounts, 7: s.promo.discounts[10] || 0 };
    db.set('site_settings.promo.discounts', migratedDiscounts).write();
    s.promo.discounts = migratedDiscounts;
  }
  // Backfill title/text on an already-stored promo object from before these
  // fields existed, so the homepage doesn't fall back to an empty string.
  if (s.promo && (s.promo.title === undefined || s.promo.text === undefined)) {
    const title = s.promo.title !== undefined ? s.promo.title : 'Rent Longer. Save More.';
    const text = s.promo.text !== undefined ? s.promo.text : 'Discount applied automatically at checkout — no code needed.';
    db.set('site_settings.promo.title', title).write();
    db.set('site_settings.promo.text', text).write();
    s.promo.title = title;
    s.promo.text = text;
  }
  // Seed message templates on first read, and backfill any individual field
  // added later — an owner who has customised three templates should not lose
  // them when a fourth is introduced.
  if (!s.message_templates) {
    db.set('site_settings.message_templates', Object.assign({}, templates.DEFAULT_TEMPLATES)).write();
    s.message_templates = db.get('site_settings.message_templates').value();
  } else {
    const missing = {};
    Object.keys(templates.DEFAULT_TEMPLATES).forEach(k => {
      if (typeof s.message_templates[k] !== 'string') missing[k] = templates.DEFAULT_TEMPLATES[k];
    });
    if (Object.keys(missing).length) {
      const merged = Object.assign({}, s.message_templates, missing);
      db.set('site_settings.message_templates', merged).write();
      s.message_templates = merged;
    }
    // The backfill above only adds absent keys, so a template already stored
    // keeps whatever it had. expiry_overdue shipped ending in {deposit_line}
    // ("your deposit comes back") one release before the late fee existed —
    // left alone it now contradicts the deduction notice in the same message.
    // Swap just that one token so any other wording the owner changed survives.
    const overdueTpl = s.message_templates.expiry_overdue;
    if (typeof overdueTpl === 'string' && overdueTpl.includes('{deposit_line}')) {
      const fixed = overdueTpl.replace(/\{deposit_line\}/g, '{late_fee_line}');
      db.set('site_settings.message_templates.expiry_overdue', fixed).write();
      s.message_templates.expiry_overdue = fixed;
    }
  }
  // Payment methods start disabled: until the owner has uploaded a QR and
  // filled in the account details, showing a customer an empty GCash panel is
  // worse than showing them nothing at all.
  if (!s.payment_methods) {
    db.set('site_settings.payment_methods', [
      { key: 'gcash', label: 'GCash', account_name: '', account_number: '', qr_image: '', enabled: false },
      { key: 'maya',  label: 'Maya',  account_name: '', account_number: '', qr_image: '', enabled: false }
    ]).write();
    s.payment_methods = db.get('site_settings.payment_methods').value();
  }
  // The m.me handle is a setting rather than a constant because the whole
  // referral link depends on it, and getting it wrong silently breaks PSID
  // capture with no visible symptom on the page.
  if (s.fb_page_username === undefined) {
    db.set('site_settings.fb_page_username', 'PlaystationHub00').write();
    s.fb_page_username = 'PlaystationHub00';
  }
  return s;
}
// Every duration a rent promo can apply to, and the % discount for a given duration.
function getPromoDiscountPct(promo, days) {
  if (!promo || !promo.enabled || !promo.discounts) return 0;
  return promo.discounts[days] || 0;
}

// Effective price for `game` at the given duration/account type/status, with the
// active promo discount applied — the same number a walk-in customer would pay
// today. Used to price a game swap's top-up. Returns null when there's no reliable
// basis to compute one (custom duration, missing price data) so the caller falls
// back to manual admin entry instead of guessing. PS4 Primary has no price fields
// of its own on games, so it borrows the Non-Trophy price (flagged via ps4Fallback).
function computeSwapReferencePrice(game, { days, accountType, isBought, promo }) {
  if (!game) return null;
  const ps4Fallback = accountType === 'ps4';
  const usingType = ps4Fallback ? 'nt' : accountType;
  if (isBought) {
    const val = usingType === 'tr' ? (game.buy_tr_price || 0) : (game.buy_nt_price || 0);
    if (!val) return null;
    const price = (promo && promo.buy_promo_enabled && promo.buy_promo_pct > 0)
      ? Math.round(val * (1 - promo.buy_promo_pct / 100)) : val;
    return { price, ps4Fallback };
  }
  const d = parseInt(days);
  if (!PROMO_DURATIONS.includes(d)) return null;
  const resolved = resolveGamePrices(game);
  const base = resolved[usingType + '_price_' + d + 'd'];
  if (!base) return null;
  const pct = getPromoDiscountPct(promo, d);
  const price = pct > 0 ? base - Math.round(base * pct / 100) : base;
  return { price, ps4Fallback };
}

app.get('/how-it-works', (req, res) => {
  res.render('how-it-works', { announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings() });
});

app.get('/how-to-sign-in', (req, res) => {
  res.render('how-to-sign-in', {
    signinSteps: getSigninSteps(),
    announcement: getAnnouncement(),
    announcements: getAnnouncements(),
    settings: getSiteSettings()
  });
});

// PS Plus Deluxe public page
app.get('/ps-plus', (req, res) => {
  const entries = getPsplus();
  // Group by year then sort months within each year
  const byYear = {};
  entries.forEach(e => {
    if (!byYear[e.year]) byYear[e.year] = [];
    byYear[e.year].push(e);
  });
  Object.keys(byYear).forEach(y => byYear[y].sort((a, b) => a.month - b.month));
  const years = Object.keys(byYear).sort((a, b) => b - a); // newest year first
  const popular = [...getPsplusPopular()].sort((a, b) => (a.rank || 999) - (b.rank || 999));
  // Pull slots from the "PS Plus Deluxe" game entry so they stay in sync
  const psplusGame = getGames().find(g => g.title.toLowerCase().includes('ps plus deluxe') || g.title.toLowerCase().includes('playstation plus deluxe'));
  const slots = psplusGame
    ? { nt_slots: psplusGame.non_trophy_slots || 0, tr_slots: psplusGame.trophy_slots || 0, ps4_slots: psplusGame.ps4_primary_slots || 0 }
    : getPsplusSlots();
  const psplusSlug = psplusGame ? gameSlug(psplusGame.title) : null;
  res.render('ps-plus', { byYear, years, popular, prices: getPsplusPrices(), slots, psplusGameId: psplusGame ? psplusGame.id : null, psplusSlug, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings() });
});

app.get('/ps-plus/rent', (req, res) => {
  const prices = getPsplusPrices();
  const rawSlots = getPsplusSlots();
  const psplusGame = getGames().find(g => g.title.toLowerCase().includes('ps plus') || g.title.toLowerCase().includes('playstation plus'));
  const slots = psplusGame
    ? { nt_slots: psplusGame.non_trophy_slots || 0, tr_slots: psplusGame.trophy_slots || 0, ps4_slots: psplusGame.ps4_primary_slots || 0 }
    : rawSlots;
  const settings = getSiteSettings();
  res.render('psplus-rent', { prices, slots, promo: settings.promo, announcement: getAnnouncement(), announcements: getAnnouncements(), settings, order_error: req.query.order_error || null });
});

// PS Plus admin CRUD
app.post('/admin/psplus/add', upload.single('cover_image'), requireAuth, async (req, res) => {
  const { year, month, games_list, notes, nt_slots, tr_slots } = req.body;
  if (!year || !month) return res.redirect('/admin?msg=error');
  const cover_image = req.file ? await processUploadedImage(req.file) : '';
  db.get('psplus').push({
    id: newPsplusId(),
    year: parseInt(year),
    month: parseInt(month),
    month_name: new Date(year, month - 1).toLocaleString('en', { month: 'long' }),
    cover_image,
    games_list: games_list || '',
    notes: notes || '',
    nt_slots: parseInt(nt_slots) || 0,
    tr_slots: parseInt(tr_slots) || 0,
    created_at: new Date().toISOString()
  }).write();
  res.redirect('/admin?msg=psplus_added');
});

app.get('/admin/psplus/edit/:id', requireAuth, (req, res) => {
  const entry = getPsplusEntry(req.params.id);
  if (!entry) return res.redirect('/admin');
  res.render('edit-psplus', { entry, settings: getSiteSettings() });
});

app.post('/admin/psplus/edit/:id', upload.single('cover_image'), requireAuth, async (req, res) => {
  const { year, month, games_list, notes, nt_slots, tr_slots } = req.body;
  const existing = getPsplusEntry(req.params.id);
  if (!existing) return res.redirect('/admin');
  const cover_image = req.file ? await processUploadedImage(req.file) : existing.cover_image;
  db.get('psplus').find({ id: parseInt(req.params.id) }).assign({
    year: parseInt(year),
    month: parseInt(month),
    month_name: new Date(year, month - 1).toLocaleString('en', { month: 'long' }),
    cover_image,
    games_list: games_list || '',
    notes: notes || '',
    nt_slots: parseInt(nt_slots) || 0,
    tr_slots: parseInt(tr_slots) || 0
  }).write();
  res.redirect('/admin?msg=psplus_updated');
});

app.post('/admin/psplus/delete/:id', requireAuth, (req, res) => {
  const entry = getPsplusEntry(req.params.id);
  if (entry?.cover_image) {
    const fp = path.join(uploadsDir, path.basename(entry.cover_image));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.get('psplus').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?msg=psplus_deleted');
});

// PS Plus Popular CRUD
app.post('/admin/psplus/popular/add', upload.single('cover_image'), requireAuth, async (req, res) => {
  const { title, platform, genre, description, rank } = req.body;
  if (!title || !title.trim()) return res.redirect('/admin?msg=error');
  const cover_image = req.file ? await processUploadedImage(req.file) : '';
  db.get('psplus_popular').push({
    id: newPsplusPopularId(),
    title: title.trim(),
    platform: platform || 'PS5',
    genre: genre || '',
    description: description || '',
    rank: parseInt(rank) || 0,
    cover_image,
    cover_focal_x: 50,
    cover_focal_y: 50,
    created_at: new Date().toISOString()
  }).write();
  res.redirect('/admin?msg=popular_added');
});

app.get('/admin/psplus/popular/edit/:id', requireAuth, (req, res) => {
  const entry = getPsplusPopularEntry(req.params.id);
  if (!entry) return res.redirect('/admin');
  res.render('edit-psplus-popular', { entry, settings: getSiteSettings() });
});

app.post('/admin/psplus/popular/edit/:id', upload.single('cover_image'), requireAuth, async (req, res) => {
  const { title, platform, genre, description, rank, cover_focal_x, cover_focal_y } = req.body;
  const existing = getPsplusPopularEntry(req.params.id);
  if (!existing) return res.redirect('/admin');
  const cover_image = req.file ? await processUploadedImage(req.file) : existing.cover_image;
  // A freshly uploaded cover resets the focal point — the old point won't line up with the new image.
  const focalX = req.file ? 50 : Math.min(100, Math.max(0, parseInt(cover_focal_x)));
  const focalY = req.file ? 50 : Math.min(100, Math.max(0, parseInt(cover_focal_y)));
  db.get('psplus_popular').find({ id: parseInt(req.params.id) }).assign({
    title: title.trim(), platform, genre: genre || '',
    description: description || '', rank: parseInt(rank) || 0, cover_image,
    cover_focal_x: isNaN(focalX) ? (existing.cover_focal_x != null ? existing.cover_focal_x : 50) : focalX,
    cover_focal_y: isNaN(focalY) ? (existing.cover_focal_y != null ? existing.cover_focal_y : 50) : focalY
  }).write();
  res.redirect('/admin?msg=popular_updated');
});

app.post('/admin/psplus/popular/delete/:id', requireAuth, (req, res) => {
  const entry = getPsplusPopularEntry(req.params.id);
  if (entry?.cover_image) {
    const fp = path.join(uploadsDir, path.basename(entry.cover_image));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.get('psplus_popular').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?msg=popular_deleted');
});

// Update PS Plus global prices + slots
app.post('/admin/psplus/prices', requireAuth, (req, res) => {
  const { nt_price_7d, nt_price_30d, tr_price_7d, tr_price_30d, nt_slots, tr_slots, ps4_slots } = req.body;
  db.set('psplus_slots', {
    nt_slots: parseInt(nt_slots) || 0,
    tr_slots: parseInt(tr_slots) || 0,
    ps4_slots: parseInt(ps4_slots) || 0
  }).write();
  db.set('psplus_prices', {
    nt_price_7d: parseInt(nt_price_7d) || 349,
    nt_price_30d: parseInt(nt_price_30d) || 599,
    tr_price_7d: parseInt(tr_price_7d) || 399,
    tr_price_30d: parseInt(tr_price_30d) || 699
  }).write();
  res.redirect('/admin?msg=psplus_prices');
});

// Adjust trophy_slots on a game by delta (+1 or -1), and sync trophy_account flag
function adjustTrophySlots(gameId, delta) {
  const game = getGame(gameId);
  if (!game) return;
  const newSlots = Math.max(0, (game.trophy_slots || 0) + delta);
  db.get('games').find({ id: game.id }).assign({
    trophy_slots: newSlots,
    trophy_account: game.trophy_account || newSlots > 0
  }).write();
}
function adjustNtSlots(gameId, delta) {
  const game = getGame(gameId);
  if (!game) return;
  db.get('games').find({ id: game.id }).assign({
    non_trophy_slots: Math.max(0, (game.non_trophy_slots || 0) + delta)
  }).write();
}
function adjustPs4Slots(gameId, delta) {
  const game = getGame(gameId);
  if (!game) return;
  db.get('games').find({ id: game.id }).assign({
    ps4_primary_slots: Math.max(0, (game.ps4_primary_slots || 0) + delta)
  }).write();
}

function sortUpcoming(list) {
  return [...list].sort((a, b) => {
    const ra = a.rank || 0;
    const rb = b.rank || 0;
    // Ranked games first (lower rank number = higher priority)
    if (ra && rb) return ra - rb;
    if (ra) return -1;
    if (rb) return 1;
    // Unranked: sort by release date ascending
    const da = (!a.release_date || a.release_date === 'TBA') ? 'ZZZZ' : a.release_date;
    const db2 = (!b.release_date || b.release_date === 'TBA') ? 'ZZZZ' : b.release_date;
    return da.localeCompare(db2);
  });
}

app.get('/', (req, res) => {
  const all = getGames().map(resolveGamePrices).map(resolveSlotDays).sort((a, b) => a.title.localeCompare(b.title));
  const featured = [...all].sort((a, b) => (b.renters || 0) - (a.renters || 0)).slice(0, 10);
  const upcoming = sortUpcoming(getUpcoming());
  const psplusPopular = [...getPsplusPopular()].sort((a, b) => (a.rank || 999) - (b.rank || 999)).slice(0, 10);
  const psplusPrices = getPsplusPrices();
  const homePsplusGame = getGames().find(g => g.title.toLowerCase().includes('ps plus') || g.title.toLowerCase().includes('playstation plus'));
  const homePsplusSlug = homePsplusGame ? gameSlug(homePsplusGame.title) : null;
  const reviews = db.get('reviews').filter({ visible: true }).value().sort((a, b) => (a.order || 999) - (b.order || 999));
  const s = getSiteSettings();
  // Real counts from actual customer records, not the manually-editable per-game
  // "renters" popularity field (which the homepage stat used to sum — that number
  // reflects nothing about who's currently renting).
  const homeCustomers = getCustomers();
  const activeRenters = homeCustomers.filter(c => c.status === 'renting').length;
  const gamesPurchased = homeCustomers.filter(c => c.status === 'bought').length;
  // "New Releases" — the 10 most recently *released* games, which is a different
  // question from the NEW badge (11 days since we stocked it, created_at). Only
  // games with a real release_date qualify, so the section stays accurate while
  // the field is being backfilled instead of silently falling back to created_at.
  // Future-dated games belong in Coming Soon, so they're excluded here.
  const todayIso = new Date().toISOString().slice(0, 10);
  const newReleases = all
    .filter(g => g.release_date && g.release_date !== 'TBA' && g.release_date <= todayIso)
    .sort((a, b) => b.release_date.localeCompare(a.release_date))
    .slice(0, 10);
  res.render('index', { featured, games: all, upcoming, psplusPopular, psplusPrices, psplusSlug: homePsplusSlug, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s, reviews, promo: s.promo, priceCategories: getPriceCategories(), accountSummaryMap: buildAccountSummaryMap(), activeRenters, gamesPurchased, newReleases });
});

// Shared by /buy (summary cards) and /bundle/:slug (full page) so both compute
// game lists and prices the same way. Some accounts (e.g. "PS HUB Main
// Account") have a catalog game entry with the same title as the account
// itself, linked into their own game_ids — that entry is excluded everywhere
// a bundle's game list is shown, so a bundle never appears to contain itself.
function buildBundleGames(acc, allGames) {
  const gameById = id => allGames.find(g => g.id === parseInt(id));
  const displayName = (acc.public_name || acc.label || '').trim().toLowerCase();
  return acc.game_ids
    .map(gameById)
    .filter(Boolean)
    .filter(g => g.title.trim().toLowerCase() !== displayName);
}

function bundleSlotInfo(acc) {
  const trophy = acc.slots.trophy.enabled
    ? { price: acc.price_permanent_tr, open: acc.slots.trophy.status === 'open', status: acc.slots.trophy.status } : null;
  const nonTrophy = acc.slots.non_trophy.enabled
    ? { price: acc.price_permanent_nt, open: acc.slots.non_trophy.status === 'open', status: acc.slots.non_trophy.status } : null;
  return { trophy, nonTrophy };
}

// Sum of what each game would cost bought individually (same NT-first price
// selection /buy's single-game cards use) vs. the bundle's own price. A
// partial sum would understate the bundle and undercut its own pitch, so
// this returns null the moment any game lacks a buy price — callers fall
// back to the plain per-game-count line instead of showing nothing wrong.
function bundleSavings(games, bundlePrice) {
  if (!games.length || !bundlePrice) return null;
  let sum = 0;
  for (const g of games) {
    const price = g.buy_nt_price > 0 ? g.buy_nt_price : g.buy_tr_price;
    if (!price) return null;
    sum += price;
  }
  return sum > bundlePrice ? { sum, save: sum - bundlePrice } : null;
}

// Resolves the account bundle a game represents (owner-marked via admin edit),
// for the catalog card and detail page. Returns null the moment the flag is
// off, unset, or the linked account no longer exists — a stale link silently
// turns the bundle display off instead of erroring or showing partial data.
function resolveBundleInfo(game) {
  if (!game.is_bundle || !game.bundle_account_id) return null;
  const acc = getAccount(game.bundle_account_id);
  if (!acc) return null;
  const allGames = getGames();
  const games = buildBundleGames(acc, allGames).filter(g => g.id !== game.id);
  return { account: acc, games, count: games.length };
}
app.locals.resolveBundleInfo = (game) => resolveBundleInfo(game);

// The inverse of resolveBundleInfo: given an ordinary game, finds the bundle (if
// any) that contains it, so its catalog card can disclose "renting this gets you
// the whole account." A bundle game itself never resolves to a parent bundle.
function findBundleContaining(game) {
  if (game.is_bundle) return null;
  const allGames = getGames();
  for (const g of allGames) {
    if (!g.is_bundle) continue;
    const info = resolveBundleInfo(g);
    if (info && info.games.some(cg => cg.id === game.id)) {
      return { bundleGame: g, count: info.count };
    }
  }
  return null;
}
app.locals.findBundleContaining = (game) => findBundleContaining(game);

app.get('/buy', (req, res) => {
  const allGames = getGames();
  const bundles = getAccounts()
    .filter(acc => acc.for_sale && (acc.slots.trophy.enabled || acc.slots.non_trophy.enabled))
    .map(acc => {
      const games = buildBundleGames(acc, allGames);
      const { trophy, nonTrophy } = bundleSlotInfo(acc);
      const prices = [trophy, nonTrophy].filter(x => x && x.price > 0).map(x => x.price);
      const gameCount = games.length;
      const name = acc.public_name || acc.label;
      return {
        id: acc.id,
        slug: gameSlug(name),
        name,
        gameCount,
        perGame: gameCount > 1 && prices.length ? Math.round(Math.min(...prices) / gameCount) : null,
        covers: games.slice(0, 4),
        moreCount: Math.max(0, gameCount - 4),
        trophy,
        nonTrophy
      };
    });
  const s = getSiteSettings();
  const promo = s.promo || {};
  const buyPromo = promo.buy_promo_enabled && promo.buy_promo_pct > 0;
  const singleGames = allGames
    .filter(g => (g.buy_nt_price || 0) > 0 || (g.buy_tr_price || 0) > 0)
    .map(g => {
      const base = g.buy_nt_price > 0 ? g.buy_nt_price : g.buy_tr_price;
      const final = buyPromo ? Math.round(base * (1 - promo.buy_promo_pct / 100)) : base;
      return {
        id: g.id, title: g.title, cover_image: g.cover_image, price: final, was: buyPromo ? base : null, slug: gameSlug(g.title),
        platform: g.platform, genre: g.genre,
        cover_focal_x: g.cover_focal_x, cover_focal_y: g.cover_focal_y
      };
    });
  res.render('buy', {
    bundles, singleGames, buyPromo, buyPromoPct: promo.buy_promo_pct || 0,
    announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s,
    orderError: req.query.order_error || null
  });
});

app.get('/bundle/:slug', (req, res) => {
  const allGames = getGames();
  const acc = getAccounts().find(a => a.for_sale && (a.slots.trophy.enabled || a.slots.non_trophy.enabled) && gameSlug(a.public_name || a.label) === req.params.slug);
  if (!acc) return res.redirect('/buy');
  const name = acc.public_name || acc.label;
  const games = buildBundleGames(acc, allGames);
  const { trophy, nonTrophy } = bundleSlotInfo(acc);
  const prices = [trophy, nonTrophy].filter(x => x && x.price > 0).map(x => x.price);
  const gameCount = games.length;
  const comparePrice = nonTrophy && nonTrophy.price > 0 ? nonTrophy.price : (trophy ? trophy.price : 0);
  const bundle = {
    id: acc.id,
    slug: req.params.slug,
    name,
    gameCount,
    perGame: gameCount > 1 && prices.length ? Math.round(Math.min(...prices) / gameCount) : null,
    savings: bundleSavings(games, comparePrice),
    games,
    trophy,
    nonTrophy
  };
  const s = getSiteSettings();
  const reqTier = ['nt', 'tr'].includes(req.query.tier) ? req.query.tier : null;
  res.render('bundle', {
    bundle,
    requestedTier: reqTier,
    announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s
  });
});

app.get('/browse', (req, res) => {
  const { search, platform, genre, unit, newOnly } = req.query;
  const accountSummaryMap = buildAccountSummaryMap();
  let games = getGames().map(resolveGamePrices).map(resolveSlotDays);
  if (search) {
    const q = search.toLowerCase();
    // A bundle also matches on the titles it contains, so searching a game that's
    // only inside the bundle still surfaces it here as well as in the nav search.
    const bundleContains = (g) => {
      const b = resolveBundleInfo(g);
      return b ? b.games.some(bg => bg.title.toLowerCase().includes(q)) : false;
    };
    games = games.filter(g =>
      g.title.toLowerCase().includes(q) ||
      (g.description && g.description.toLowerCase().includes(q)) ||
      bundleContains(g)
    );
  }
  if (platform) games = games.filter(g => g.platform === platform || g.platform === 'PS4/PS5');
  if (genre) games = games.filter(g => g.genre === genre);
  // Availability-by-unit filter: PS4 = has an open PS4 Primary slot;
  // PS5 = has an open Trophy or Non-Trophy slot, regardless of PS4 Primary status.
  if (unit === 'ps4' || unit === 'ps5') {
    games = games.filter(g => {
      const avail = computeAvailability(g, accountSummaryMap[g.id]);
      return unit === 'ps4' ? (avail.showPs4 && avail.ps4Avail) : (avail.trAvail || avail.ntAvail);
    });
  }
  // Same 11-day "new" window as the site-wide NEW badge (isAddedThisMonth, server.js).
  if (newOnly === '1') games = games.filter(isAddedThisMonth);
  games.sort((a, b) => a.title.localeCompare(b.title));
  const genres = [...new Set(getGames().map(g => g.genre).filter(Boolean))].sort();
  const upcoming = sortUpcoming(getUpcoming());
  // PS Plus monthly entries sorted newest first
  const psplus = [...getPsplus()].sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month);
  const priceCategories = getPriceCategories();
  const browseSettings = getSiteSettings();
  res.render('browse', { games, search: search || '', platform: platform || '', genre: genre || '', unit: unit || '', newOnly: newOnly || '', genres, upcoming, psplus, priceCategories, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: browseSettings, promo: browseSettings.promo, accountSummaryMap });
});

// ── Game Detail Page ──────────────────────────────────────────────────────────
function gameSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Meta / Facebook product catalog feed ─────────────────────────────────────
// One row per purchasable option (each rental duration x account type, plus each
// permanent-buy option), grouped under its game via item_group_id. Modelled this
// way rather than one row per game so a Meta AI agent can answer "how much for 30
// days trophy?" with the exact figure instead of inferring it from a "starts at"
// range. Public by design — every number here is already on the game pages.
//
// Prices are recomputed here from the same helpers the cards use, so the catalog
// can't drift from the site. Note the two promos round differently and that is
// deliberate: rentals follow `base - round(base*pct/100)` (matching game-card.ejs)
// and permanent follows `round(base*(1-pct/100))` (matching buyPrice()).
const SITE_URL = (process.env.SITE_URL || 'https://playstation-hub-production.up.railway.app').replace(/\/+$/, '');

// Admin-entered descriptions contain hard line breaks. A quoted newline is legal
// RFC4180, but it splits the row for stricter parsers (and for the Google Sheets
// IMPORTDATA mirror), so flatten all whitespace runs to single spaces.
function metaCsvCell(v) {
  const s = String(v == null ? '' : v).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  return '"' + s.replace(/"/g, '""') + '"';
}
function metaPrice(n) { return Number(n).toFixed(2) + ' PHP'; }
// Meta wants "start/end". Promo end is stored from a datetime-local input (naive
// PH wall-clock), so emit it as +0800 and stamp the start in the server's UTC.
function metaSaleWindow(endsAt) {
  const m = String(endsAt || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!m) return '';
  const now = new Date(), pad = n => String(n).padStart(2, '0');
  const start = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
                `T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}+0000`;
  return `${start}/${m[1]}T${m[2]}+0800`;
}

app.get('/feed/meta-catalog.csv', (req, res) => {
  const s = getSiteSettings();
  const promo = s.promo || {};
  const summaryMap = buildAccountSummaryMap();
  const cats = getPriceCategories();
  const catName = id => (cats.find(c => c.id === id) || {}).name || '';

  const HEADERS = ['id', 'item_group_id', 'title', 'description', 'availability', 'condition',
    'price', 'sale_price', 'sale_price_effective_date', 'link', 'image_link', 'brand',
    'product_type', 'custom_label_0', 'custom_label_1', 'custom_label_2'];

  const rows = [];
  let skippedNoImage = 0;

  getGames().forEach(g => {
    // image_link is required by Meta, so a game with no cover can't be listed.
    if (!g.cover_image) { skippedNoImage++; return; }

    const avail = computeAvailability(g, summaryMap[g.id],
      { nt: g.nt_days_left, tr: g.tr_days_left, ps4: g.ps4_days_left });
    const group = `ph-${g.id}`;
    const link = `${SITE_URL}/game/${gameSlug(g.title)}`;
    const imgBase = path.basename(String(g.cover_image)).replace(/\.[^.]+$/, '');
    const image = `${SITE_URL}/uploads/jpg/${imgBase}.jpg`;
    const desc = (g.description && g.description.trim())
      ? g.description.trim()
      : `${g.title} for ${g.platform || 'PS5'} — rent or buy permanent access from Playstation Hub.`;
    const ptype = catName(g.price_category_id);

    const push = (suffix, label, base, final, inStock, durLabel, typeLabel) => {
      if (!(base > 0)) return;
      const onSale = final < base;
      rows.push([`${group}-${suffix}`, group, `${g.title} — ${label}`, desc,
        inStock ? 'in stock' : 'out of stock', 'new',
        metaPrice(base), onSale ? metaPrice(final) : '',
        onSale ? metaSaleWindow(promo.ends_at) : '',
        link, image, 'Playstation Hub',
        ptype, g.platform || '', durLabel, typeLabel]);
    };

    // Rentals — one row per duration per account type.
    RENTAL_DURATIONS.forEach(({ days: d, label: durLabel }) => {
      const pct = getPromoDiscountPct(promo, d);
      const cut = v => pct > 0 ? v - Math.round(v * pct / 100) : v;
      const nt = g[`nt_price_${d}d`];
      if (nt > 0) push(`nt-${d}d`, `${durLabel} (Non-Trophy)`, nt, cut(nt), avail.ntSlots > 0, durLabel, 'Non-Trophy');
      if (avail.hasTrophy) {
        const tr = g[`tr_price_${d}d`];
        if (tr > 0) push(`tr-${d}d`, `${durLabel} (Trophy)`, tr, cut(tr), avail.trSlots > 0, durLabel, 'Trophy');
      }
    });

    // Permanent purchase. Mirrors the card, which hides Buy only when every slot
    // type is unavailable — so the feed never advertises what the site is hiding.
    const bpct = (promo.buy_promo_enabled && promo.buy_promo_pct > 0) ? promo.buy_promo_pct : 0;
    const buyCut = v => bpct ? Math.round(v * (1 - bpct / 100)) : v;
    const buyInStock = !avail.allUnavail;
    if (g.buy_nt_price > 0) push('buy-nt', 'Permanent (Non-Trophy)', g.buy_nt_price, buyCut(g.buy_nt_price), buyInStock, 'Permanent', 'Non-Trophy');
    if (g.buy_tr_price > 0) push('buy-tr', 'Permanent (Trophy)', g.buy_tr_price, buyCut(g.buy_tr_price), buyInStock, 'Permanent', 'Trophy');
  });

  if (skippedNoImage) console.log(`[meta-feed] skipped ${skippedNoImage} game(s) with no cover image`);
  const csv = [HEADERS.join(','), ...rows.map(r => r.map(metaCsvCell).join(','))].join('\n') + '\n';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(csv);
});

// Creates a rental order from the game page. Deliberately the only entry
// point — Facebook can carry payment proof later, but never creates an order,
// so nothing can bypass the owner's queue.
app.post('/order/create', async (req, res) => {
  if (rateLimited('order_create', clientIp(req), 10, 10 * 60 * 1000)) {
    return res.redirect('/browse?order_error=rate');
  }
  const { game_id, account_type, days, fb_name } = req.body;
  const game = getGame(game_id);
  if (!game) return res.redirect('/browse');

  const name = (fb_name || '').trim();
  const type = ['nt', 'tr', 'ps4'].includes(account_type) ? account_type : null;
  const d = parseInt(days);
  if (!name || !type || !PROMO_DURATIONS.includes(d)) {
    return res.redirect('/game/' + gameSlug(game.title) + '?order_error=1');
  }

  const s = getSiteSettings();
  const promo = s.promo || {};
  const resolved = resolveGamePrices(game);
  // PS4 Primary has no price fields of its own and borrows Non-Trophy pricing,
  // matching computeSwapReferencePrice()'s existing behaviour.
  const priceType = type === 'ps4' ? 'nt' : type;
  const base = resolved[priceType + '_price_' + d + 'd'] || 0;
  if (!base) return res.redirect('/game/' + gameSlug(game.title) + '?order_error=1');

  const pct = getPromoDiscountPct(promo, d);
  const amountDue = pct > 0 ? base - Math.round(base * pct / 100) : base;
  const depositDue = (type === 'tr' || type === 'ps4') ? (promo.deposit || 0) : 0;

  // Freeze the tier's whole price set. A tier's prices can change after an
  // order is placed; snapshotting means a later swap compares against what the
  // customer actually paid rather than today's number.
  const cat = game.price_category_id ? getPriceCategory(game.price_category_id) : null;
  const snapshot = {
    nt_price_7d: resolved.nt_price_7d || 0, nt_price_30d: resolved.nt_price_30d || 0,
    tr_price_7d: resolved.tr_price_7d || 0, tr_price_30d: resolved.tr_price_30d || 0
  };

  try {
    const order = await orders.create({
      game_id: game.id,
      game_title: game.title,
      account_type: type,
      days: d,
      price_tier_name: cat ? cat.name : '',
      price_snapshot: snapshot,
      amount_due: amountDue,
      deposit_due: depositDue,
      fb_name: name,
      session_id: req.sessionId || null
    });
    res.redirect('/order/' + order.ref + '?k=' + order.url_key);
  } catch (e) {
    console.error('[order create]', e.message);
    res.redirect('/game/' + gameSlug(game.title) + '?order_error=1');
  }
});

// Creates a permanent-purchase order — either a specific account's open slot
// (bundle) or a single game (account assigned by the owner at activation,
// same as rentals already work). No days/end_date: reuses the existing
// order lifecycle unchanged, and an empty end_date is already excluded by
// advanceEndedRentals()'s own filter, so a bought order simply rests at
// 'active' forever with no new sweep logic.
app.post('/order/buy', async (req, res) => {
  if (rateLimited('order_create', clientIp(req), 10, 10 * 60 * 1000)) {
    return res.redirect('/buy?order_error=rate');
  }
  const { kind, fb_name } = req.body;
  const name = (fb_name || '').trim();
  if (!name) return res.redirect('/buy?order_error=1');

  if (kind === 'bundle') {
    const { account_id, slot_type } = req.body;
    const account = getAccount(account_id);
    const type = ['tr', 'nt'].includes(slot_type) ? slot_type : null;
    if (!account || !account.for_sale || !type) return res.redirect('/buy?order_error=1');
    const slotKey = type === 'tr' ? 'trophy' : 'non_trophy';
    const slot = account.slots[slotKey];
    // Re-check availability at order time — the page a customer loaded may be stale.
    if (!slot || !slot.enabled || slot.status !== 'open') return res.redirect('/buy?order_error=sold');
    const price = type === 'tr' ? account.price_permanent_tr : account.price_permanent_nt;
    if (!price) return res.redirect('/buy?order_error=1');
    try {
      const order = await orders.create({
        game_id: 'bundle_' + account.id,
        game_title: account.public_name || account.label,
        account_type: type,
        days: null,
        amount_due: price,
        deposit_due: 0,
        fb_name: name,
        session_id: req.sessionId || null,
        is_buy: true,
        account_id: account.id,
        slot_type: type
      });
      res.redirect('/order/' + order.ref + '?k=' + order.url_key);
    } catch (e) {
      console.error('[order buy bundle]', e.message);
      res.redirect('/buy?order_error=1');
    }
    return;
  }

  // Single game
  const { game_id, account_type } = req.body;
  const game = getGame(game_id);
  const type = ['nt', 'tr'].includes(account_type) ? account_type : null;
  if (!game || !type) return res.redirect('/buy?order_error=1');
  const base = type === 'tr' ? (game.buy_tr_price || 0) : (game.buy_nt_price || 0);
  if (!base) return res.redirect('/buy?order_error=1');
  const s = getSiteSettings();
  const promo = s.promo || {};
  const price = (promo.buy_promo_enabled && promo.buy_promo_pct > 0)
    ? Math.round(base * (1 - promo.buy_promo_pct / 100)) : base;
  try {
    const order = await orders.create({
      game_id: game.id,
      game_title: game.title,
      account_type: type,
      days: null,
      amount_due: price,
      deposit_due: 0,
      fb_name: name,
      session_id: req.sessionId || null,
      is_buy: true
    });
    res.redirect('/order/' + order.ref + '?k=' + order.url_key);
  } catch (e) {
    console.error('[order buy single]', e.message);
    res.redirect('/buy?order_error=1');
  }
});

// Creates a PS Plus Deluxe rental order. PS Plus is a global singleton
// product, not a games-collection record, so it can't reuse /order/create's
// per-game price-category/snapshot logic — it reads the flat psplus_prices
// fields instead and uses the sentinel game_id 'psplus' (lib/orders.js never
// validates game_id against anything, it's just stored/displayed).
app.post('/order/create-psplus', async (req, res) => {
  if (rateLimited('order_create', clientIp(req), 10, 10 * 60 * 1000)) {
    return res.redirect('/ps-plus/rent?order_error=rate');
  }
  const { account_type, days, fb_name } = req.body;
  const name = (fb_name || '').trim();
  const type = ['nt', 'tr'].includes(account_type) ? account_type : null;
  const d = parseInt(days);
  if (!name || !type || !PROMO_DURATIONS.includes(d)) {
    return res.redirect('/ps-plus/rent?order_error=1');
  }

  const prices = getPsplusPrices();
  const base = prices[type + '_price_' + d + 'd'] || 0;
  if (!base) return res.redirect('/ps-plus/rent?order_error=1');

  const s = getSiteSettings();
  const promo = s.promo || {};
  const pct = getPromoDiscountPct(promo, d);
  const amountDue = pct > 0 ? base - Math.round(base * pct / 100) : base;
  const depositDue = type === 'tr' ? (promo.deposit || 0) : 0;

  try {
    const order = await orders.create({
      game_id: 'psplus',
      game_title: 'PS Plus Deluxe',
      account_type: type,
      days: d,
      amount_due: amountDue,
      deposit_due: depositDue,
      fb_name: name,
      session_id: req.sessionId || null,
      is_psplus: true
    });
    res.redirect('/order/' + order.ref + '?k=' + order.url_key);
  } catch (e) {
    console.error('[order create-psplus]', e.message);
    res.redirect('/ps-plus/rent?order_error=1');
  }
});

// Creates a reservation order — either a 50% downpayment on a Coming Soon
// game (locking a slot ahead of release) or a flat ₱100 priority-reservation
// fee on an available game whose selected type has no open slot right now
// (matching the fee the site has always quoted for that). Both reuse the
// same order-status page and payment-proof flow as /order/create, but settle
// into 'reserved' instead of progressing to a console sign-in — there's
// either nothing to sign into yet, or no free slot to sign into.
app.post('/order/reserve', async (req, res) => {
  if (rateLimited('order_create', clientIp(req), 10, 10 * 60 * 1000)) {
    return res.redirect('/browse?order_error=rate');
  }
  const { game_id, account_type, days, fb_name } = req.body;
  const upcoming = getUpcomingGame(game_id);
  const isPsplus = !upcoming && game_id === 'psplus';
  const game = upcoming || (isPsplus ? null : getGame(game_id));
  if (!upcoming && !isPsplus && !game) return res.redirect('/browse');
  const isUpcoming = !!upcoming;
  const gameTitle = isPsplus ? 'PS Plus Deluxe' : game.title;
  const errRedirect = isUpcoming
    ? '/upcoming/' + gameSlug(game.title) + '-' + game.id + '?order_error=1'
    : isPsplus
      ? '/ps-plus/rent?order_error=1'
      : '/game/' + gameSlug(game.title) + '?order_error=1';

  const name = (fb_name || '').trim();
  const type = (isUpcoming || isPsplus)
    ? (['nt', 'tr'].includes(account_type) ? account_type : null)
    : (['nt', 'tr', 'ps4'].includes(account_type) ? account_type : null);
  const d = parseInt(days);
  if (!name || !type || !PROMO_DURATIONS.includes(d)) return res.redirect(errRedirect);

  const s = getSiteSettings();
  const promo = s.promo || {};
  let amountDue, depositDue, remainingDue, releaseDate, upcomingGameId;

  if (isUpcoming) {
    const priceField = type + '_price_' + d + 'd';
    const base = game[priceField] || 0;
    if (!base) return res.redirect(errRedirect);
    depositDue = type === 'tr' ? (promo.deposit || 0) : 0;
    const total = base + depositDue;
    amountDue = Math.ceil(total * 0.5);
    remainingDue = total - amountDue;
    releaseDate = game.release_date || '';
    upcomingGameId = game.id;
  } else if (isPsplus) {
    const prices = getPsplusPrices();
    const base = prices[type + '_price_' + d + 'd'] || 0;
    if (!base) return res.redirect(errRedirect);
    const pct = getPromoDiscountPct(promo, d);
    const rentAfterPromo = pct > 0 ? base - Math.round(base * pct / 100) : base;
    const psplusDeposit = type === 'tr' ? (promo.deposit || 0) : 0;
    amountDue = 100;
    depositDue = 0;
    remainingDue = Math.max(0, rentAfterPromo - amountDue) + psplusDeposit;
    releaseDate = '';
    upcomingGameId = null;
  } else {
    const resolved = resolveGamePrices(game);
    const priceType = type === 'ps4' ? 'nt' : type;
    const base = resolved[priceType + '_price_' + d + 'd'] || 0;
    if (!base) return res.redirect(errRedirect);
    const pct = getPromoDiscountPct(promo, d);
    const rentAfterPromo = pct > 0 ? base - Math.round(base * pct / 100) : base;
    const gameDeposit = (type === 'tr' || type === 'ps4') ? (promo.deposit || 0) : 0;
    // Flat ₱100 priority fee, matching the site's existing reservation copy —
    // not a percentage of the total, and independent of the promo/deposit math.
    amountDue = 100;
    depositDue = 0;
    remainingDue = Math.max(0, rentAfterPromo - amountDue) + gameDeposit;
    releaseDate = '';
    upcomingGameId = null;
  }

  try {
    const order = await orders.create({
      game_id: isPsplus ? 'psplus' : game.id,
      game_title: gameTitle,
      account_type: type,
      days: d,
      amount_due: amountDue,
      deposit_due: depositDue,
      fb_name: name,
      session_id: req.sessionId || null,
      is_reservation: true,
      is_psplus: isPsplus,
      upcoming_game_id: upcomingGameId,
      release_date: releaseDate,
      remaining_due: remainingDue
    });
    res.redirect('/order/' + order.ref + '?k=' + order.url_key);
  } catch (e) {
    console.error('[order reserve]', e.message);
    res.redirect(errRedirect);
  }
});

// Separate multer instance for customer-supplied files so its limits stay
// independent of the admin upload paths.
const uploadOrderFile = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, 'order-' + Date.now() + path.extname(file.originalname))
  }),
  fileFilter: (req, file, cb) => cb(null, /jpeg|jpg|png|gif|webp/.test(file.mimetype)),
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.get('/order/:ref', async (req, res) => {
  // Sweep before rendering: lapsed QR windows go back to awaiting_qr so the
  // customer is asked for a fresh code rather than shown a dead countdown, and
  // rentals past their end date move to awaiting_return so the customer is
  // prompted to return without the owner having to spot the date.
  try {
    await orders.expireStaleQrs();
    await orders.advanceEndedRentals();
  } catch (e) { console.error('[order sweep]', e.message); }
  const order = await orders.getByRef(req.params.ref);
  // The ref alone is not authorization (refs are sequential and guessable) —
  // the url_key query param must match too. Redirect exactly as the
  // order-not-found case does, so a wrong key can't be used to confirm a ref
  // exists.
  if (!order || !order.url_key || req.query.k !== order.url_key) return res.redirect('/browse');
  const s = getSiteSettings();
  res.render('order-status', {
    order,
    settings: s,
    payMethods: (s.payment_methods || []).filter(m => m.enabled),
    fbPage: s.fb_page_username || '',
    ownerOnline: !!(s.owner_online),
    announcement: getAnnouncement(),
    announcements: getAnnouncements(),
    msg: req.query.msg || null,
    signinSteps: getSigninSteps(),
  });
});

// Unlinks a just-processed upload when the transition it was meant for didn't
// actually apply, so a failed/stale submission doesn't leave an orphaned file
// behind in uploadsDir. Matches the fs.existsSync + fs.unlinkSync pattern used
// elsewhere in this file (e.g. the admin payment-methods QR replacement).
function cleanupOrphanedUpload(filePath) {
  if (!filePath) return;
  const fp = path.join(uploadsDir, path.basename(filePath));
  if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (e) {} }
}

app.post('/order/:ref/payment-proof', uploadOrderFile.single('proof'), async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order || !order.url_key || req.body.k !== order.url_key) return res.redirect('/browse');
  if (rateLimited('order_upload', clientIp(req), 30, 10 * 60 * 1000)) {
    return res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=stale');
  }
  const channel = req.body.channel === 'messenger' ? 'messenger' : 'upload';
  const method = (req.body.method || '').trim().slice(0, 20) || null;
  let proofPath = null;
  if (channel === 'upload') {
    if (!req.file) return res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=no_file');
    proofPath = await processUploadedImage(req.file, 1400);
  }
  // A customer whose payment was rejected resubmits from the very same form
  // (order-status.ejs renders it for both awaiting_payment and
  // payment_rejected). payment_rejected cannot jump straight to
  // verifying_payment, so first hop it back to awaiting_payment — this keeps
  // the state history honest (rejected -> awaiting_payment -> verifying_payment)
  // instead of pretending the direct jump is a real transition.
  if (order.state === 'payment_rejected') {
    await orders.transition(order.ref, 'awaiting_payment', {});
  }
  const r = await orders.transition(order.ref, 'verifying_payment', {
    payment_proof: proofPath,
    payment_channel: channel,
    payment_method: method
  });
  if (!r) {
    cleanupOrphanedUpload(proofPath);
    return res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=stale');
  }
  res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=payment_submitted');
});

// QR upload is website-only by design: the countdown is the whole mechanism,
// and a code sitting in a Messenger thread has no expiry tracking.
app.post('/order/:ref/qr', uploadOrderFile.single('qr'), async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order || !order.url_key || req.body.k !== order.url_key) return res.redirect('/browse');
  if (rateLimited('order_upload', clientIp(req), 30, 10 * 60 * 1000)) {
    return res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=stale');
  }
  if (!req.file) return res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=no_file');
  const qrPath = await processUploadedImage(req.file, 1400);
  const expiresAt = new Date(Date.now() + orders.QR_WINDOW_MS).toISOString();
  const r = await orders.transition(order.ref, 'qr_pending', {
    qr_image: qrPath,
    qr_expires_at: expiresAt
  });
  if (!r) {
    cleanupOrphanedUpload(qrPath);
    return res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=stale');
  }
  res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=qr_sent');
});

app.post('/order/:ref/return-proof', uploadOrderFile.single('proof'), async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order || !order.url_key || req.body.k !== order.url_key) return res.redirect('/browse');
  if (rateLimited('order_upload', clientIp(req), 30, 10 * 60 * 1000)) {
    return res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=stale');
  }
  if (!req.file) return res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=no_file');
  const proofPath = await processUploadedImage(req.file, 1400);
  const r = await orders.transition(order.ref, 'verifying_return', { return_proof: proofPath });
  if (!r) {
    cleanupOrphanedUpload(proofPath);
    return res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=stale');
  }
  res.redirect('/order/' + order.ref + '?k=' + order.url_key + '&msg=return_submitted');
});

// ── Owner queue actions ───────────────────────────────────────────────────
// One generic advance handler: each of the three owner states has exactly one
// forward move, so the button never has to say which state it is moving to.
// Only these three appear in the queue; every other transition is driven by
// the customer or by the sweeps in lib/orders.
const ORDER_ADVANCE = {
  verifying_payment: 'awaiting_qr',
  qr_pending: 'active',
  verifying_return: 'closed'
};

app.post('/admin/orders/:ref/advance', requireAuth, async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/admin?tab=orders');
  let to = ORDER_ADVANCE[order.state];
  if (order.is_reservation && order.state === 'verifying_payment') to = 'reserved';
  if (!to) return res.redirect('/admin?tab=orders&msg=order_bad_state');
  const patch = {};
  if (to === 'active') {
    // The rental clock starts when the owner actually signs them in, not when
    // the order was placed — a customer who paid overnight isn't billed for
    // hours they couldn't play. Both dates are Manila dates: on a UTC server
    // an ISO slice reports yesterday for the whole Manila morning.
    const start = new Date();
    patch.start_date = orders.manilaDate(start);
    // A buy order has no days — it has no end date either, and stays active
    // indefinitely (advanceEndedRentals() already skips rows with end_date: '').
    if (order.days) {
      const end = new Date(start.getTime() + order.days * 86400000);
      patch.end_date = orders.manilaDate(end);
    } else {
      patch.end_date = '';
    }
  }
  const r = await orders.transition(order.ref, to, patch);
  if (!r) return res.redirect('/admin?tab=orders&msg=order_stale');

  // A web order is otherwise invisible to the revenue ledger, the expiry
  // reminder panel, and top-games — all of which read the customers table,
  // not the orders collection. order.customer_id makes this idempotent: a
  // retried or raced advance call must never create a second customer.
  if (to === 'active' && !order.customer_id && order.is_buy) {
    // Permanent purchase — no rental clock, status 'bought' instead of
    // 'renting'. A bundle-slot purchase also flips that specific account
    // slot to 'buyed', mirroring what the admin UI already does manually
    // for a Messenger-arranged sale (POST /admin/accounts/:id/slot/:type).
    const customerId = newCustomerId();
    db.get('customers').push({
      id: customerId,
      customer_name: order.fb_name,
      game_id: order.game_id,
      game_title: order.game_title,
      days: null,
      account_type: order.account_type,
      start_date: patch.start_date,
      end_date: '',
      price: order.amount_due || 0,
      status: 'bought',
      notes: 'Web purchase ' + order.ref,
      created_at: new Date().toISOString(),
      payments: order.amount_due > 0
        ? [{ amount: order.amount_due, date: patch.start_date, kind: 'purchase' }]
        : [],
    }).write();
    if (order.account_id && order.slot_type) {
      const account = getAccount(order.account_id);
      if (account) {
        const slotKey = order.slot_type === 'tr' ? 'trophy' : 'non_trophy';
        const slot = account.slots[slotKey];
        slot.status = 'buyed';
        slot.renter_id = customerId;
        slot.renter_name = order.fb_name;
        slot.start = ''; slot.end = '';
        account.slots[slotKey] = slot;
        db.get('accounts').find({ id: account.id }).assign({ slots: account.slots }).write();
      }
    }
    const linked = await orders.setCustomerId(order.ref, customerId);
    if (!linked) {
      console.error('[order->customer] setCustomerId failed for', order.ref, '— customer', customerId, 'created but not linked, re-advance could duplicate it');
    }
  }

  if (to === 'active' && !order.customer_id && !order.is_buy) {
    const game = order.is_psplus ? null : getGame(order.game_id);
    const customerId = newCustomerId();
    db.get('customers').push({
      id: customerId,
      customer_name: order.fb_name,
      game_id: order.is_psplus ? 'psplus' : parseInt(order.game_id),
      game_title: order.game_title,
      days: order.days,
      account_type: order.account_type,
      start_date: patch.start_date,
      end_date: patch.end_date,
      // amount_due only — the refundable deposit is not revenue.
      price: order.amount_due || 0,
      status: 'renting',
      notes: 'Web order ' + order.ref,
      created_at: new Date().toISOString(),
      payments: order.amount_due > 0
        ? [{ amount: order.amount_due, date: patch.start_date, kind: 'rental' }]
        : [],
    }).write();
    if (order.is_psplus) {
      // /ps-plus/rent shows slots from a matching games-collection entry when
      // one exists (same lookup as that GET route), falling back to the
      // psplus_slots singleton otherwise — decrement whichever source the
      // page actually displayed when this order was placed.
      const psplusGame = getGames().find(g => g.title.toLowerCase().includes('ps plus') || g.title.toLowerCase().includes('playstation plus'));
      if (psplusGame) {
        if (order.account_type === 'tr') adjustTrophySlots(psplusGame.id, -1);
        else adjustNtSlots(psplusGame.id, -1);
      } else {
        const psplusSlots = getPsplusSlots();
        const key = order.account_type === 'tr' ? 'tr_slots' : 'nt_slots';
        db.set('psplus_slots.' + key, Math.max(0, (psplusSlots[key] || 0) - 1)).write();
      }
    } else if (game) {
      db.get('games').find({ id: game.id }).assign({
        available_slots: Math.max(0, (game.available_slots || 0) - 1),
        renters: (game.renters || 0) + 1
      }).write();
      if (order.account_type === 'tr') adjustTrophySlots(game.id, -1);
      else if (order.account_type === 'ps4') adjustPs4Slots(game.id, -1);
      else adjustNtSlots(game.id, -1);
    }
    const linked = await orders.setCustomerId(order.ref, customerId);
    if (!linked) {
      console.error('[order->customer] setCustomerId failed for', order.ref, '— customer', customerId, 'created but not linked, re-advance could duplicate it');
    }
  }

  // A confirmed Coming Soon reservation goes into the customers table the
  // same way a Messenger-arranged one already does — the upcoming game's
  // slot count is computed live from status:'reservation' rows (see
  // /upcoming/:slug), so no game-record fields need updating here. An
  // available-game priority reservation (upcoming_game_id is null) has no
  // such slot-count mechanism — it stays as an order only, and the owner
  // sets the customer up manually once a slot actually frees, same as a
  // Messenger-arranged priority reservation always has.
  if (to === 'reserved' && !order.customer_id && order.upcoming_game_id) {
    const customerId = newCustomerId();
    db.get('customers').push({
      id: customerId,
      customer_name: order.fb_name,
      game_id: 'upcoming_' + order.upcoming_game_id,
      game_title: order.game_title,
      days: order.days,
      account_type: order.account_type,
      start_date: '',
      end_date: '',
      price: order.amount_due || 0,
      status: 'reservation',
      notes: 'Web reservation ' + order.ref + ' — downpayment ₱' + (order.amount_due || 0) + ', ₱' + (order.remaining_due || 0) + ' due on release',
      created_at: new Date().toISOString(),
      payments: order.amount_due > 0
        ? [{ amount: order.amount_due, date: orders.manilaDate(new Date()), kind: 'reservation' }]
        : [],
    }).write();
    const linked = await orders.setCustomerId(order.ref, customerId);
    if (!linked) {
      console.error('[order->customer] setCustomerId failed for', order.ref, '— customer', customerId, 'created but not linked, re-advance could duplicate it');
    }
  }

  res.redirect('/admin?tab=orders&msg=order_advanced');
});

app.post('/admin/orders/:ref/reject', requireAuth, async (req, res) => {
  const order = await orders.getByRef(req.params.ref);
  if (!order) return res.redirect('/admin?tab=orders');
  const r = await orders.transition(order.ref, 'payment_rejected', { payment_proof: null, payment_channel: null });
  if (!r) return res.redirect('/admin?tab=orders&msg=order_stale');
  res.redirect('/admin?tab=orders&msg=order_rejected');
});

app.post('/admin/online', requireAuth, (req, res) => {
  const on = req.body.online === 'on';
  db.set('site_settings.owner_online', on).write();
  res.redirect('/admin?tab=orders&msg=' + (on ? 'online_on' : 'online_off'));
});

// The system tracks the debt; the owner still sends the money. A closed order
// with a deposit stays on the outstanding list until it is explicitly marked
// paid here.
app.post('/admin/orders/:ref/refunded', requireAuth, async (req, res) => {
  await orders.markRefunded(req.params.ref);
  res.redirect('/admin?tab=orders&msg=refund_marked');
});

// Owner-initiated cleanup for test, duplicate, or mistaken orders. Not part
// of the customer-facing lifecycle, so it bypasses transition() entirely.
app.post('/admin/orders/:ref/delete', requireAuth, async (req, res) => {
  await orders.deleteOrder(req.params.ref);
  res.redirect('/admin?tab=orders&msg=order_deleted');
});

// Lightweight public index for the nav search box — small enough (~50 games) to ship
// whole and filter client-side, so results appear with no per-keystroke round-trip.
app.get('/api/search-index', (req, res) => {
  const accountSummaryMap = buildAccountSummaryMap();
  const available = getGames().map(resolveGamePrices).map(resolveSlotDays).map(g => {
    const avail = computeAvailability(g, accountSummaryMap[g.id], { nt: g.nt_days_left, tr: g.tr_days_left, ps4: g.ps4_days_left });
    const slots = avail.ntSlots + avail.trSlots + (avail.showPs4 ? avail.ps4Slots : 0);
    const prices = [g.nt_price_7d, g.nt_price_30d, g.tr_price_7d, g.tr_price_30d].filter(p => p > 0);
    // A bundle account carries the titles it contains as hidden search keywords, so
    // searching a game that's only inside the bundle still surfaces the bundle. The
    // contained games are separate catalog entries with their own rows, so this adds
    // a second, clearly-labelled way to reach them rather than replacing anything.
    const bundle = resolveBundleInfo(g);
    return {
      t: g.title, p: g.platform, pr: prices.length ? Math.min(...prices) : null,
      s: slots, u: '/game/' + gameSlug(g.title), y: 'now', img: g.cover_image || '',
      k: bundle ? bundle.games.map(bg => bg.title).join(' ') : '',
      bn: bundle ? bundle.count : 0
    };
  });
  const soon = sortUpcoming(getUpcoming()).map(g => ({
    t: g.title, p: g.platform, d: g.release_date || 'TBA',
    u: '/upcoming/' + gameSlug(g.title) + '-' + g.id, y: 'soon', img: g.cover_image || ''
  }));
  // "Most Played in PS Plus" titles aren't individually rentable — they're all played
  // through the one PS Plus Deluxe subscription game, same as the homepage cards.
  const psplusGame = getGames().find(g => g.title.toLowerCase().includes('ps plus') || g.title.toLowerCase().includes('playstation plus'));
  const psplusUrl = psplusGame ? '/game/' + gameSlug(psplusGame.title) : '/ps-plus';
  const psplus = getPsplusPopular().map(g => ({
    t: g.title, p: g.platform || 'PS5', u: psplusUrl, y: 'psplus', img: g.cover_image || ''
  }));
  // Titles inside each month's free-text games_list (e.g. "Call of Duty: Modern
  // Warfare III") aren't their own catalog entries — they only exist as lines in that
  // month's card, opened via a modal rather than a page. Deep-link to the month page
  // with ?month=<id> so ps-plus.ejs can auto-open the right card on load.
  const seenTitles = new Set(psplus.map(x => x.t.toLowerCase()));
  const psplusMonthly = [];
  getPsplus().forEach(entry => {
    (entry.games_list || '').split('\n').map(g => g.trim()).filter(Boolean).forEach(title => {
      const key = title.toLowerCase();
      if (seenTitles.has(key)) return;
      seenTitles.add(key);
      psplusMonthly.push({
        t: title, p: 'PS Plus', u: '/ps-plus?month=' + entry.id, y: 'psplus', img: entry.cover_image || ''
      });
    });
  });
  res.json([...available, ...soon, ...psplus, ...psplusMonthly]);
});

app.get('/game/:slug', (req, res) => {
  const param = req.params.slug;
  // Support both numeric ID (old links) and slug
  let game = /^\d+$/.test(param)
    ? getGame(parseInt(param))
    : getGames().find(g => gameSlug(g.title) === param);
  if (!game) return res.redirect('/browse');
  // Redirect numeric URLs to slug URL
  if (/^\d+$/.test(param)) return res.redirect(301, '/game/' + gameSlug(game.title));
  const resolved = resolveGamePrices(resolveSlotDays(game));
  const gdSettings = getSiteSettings();
  res.render('game-detail', { game: resolved, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: gdSettings, promo: gdSettings.promo, accountSummary: gameAccountSummary(game.id), order_error: req.query.order_error || null });
});

// ── Admin Promo Settings ──────────────────────────────────────────────────────
app.post('/admin/promo', requireAuth, uploadPromoMedia.single('promo_media'), async (req, res) => {
  const { enabled, discount_7, discount_30, deposit, late_fee_per_day,
          buy_promo_enabled, buy_promo_pct, ends_at, remove_media, title, text } = req.body;
  const discounts = {
    7: Math.min(100, Math.max(0, parseInt(discount_7) || 0)),
    30: Math.min(100, Math.max(0, parseInt(discount_30) || 0))
  };
  const existing = db.get('site_settings.promo').value() || {};
  let media_path = existing.media_path || '';
  let media_type = existing.media_type || '';
  if (remove_media === 'on') {
    if (media_path) {
      const fp = path.join(uploadsDir, path.basename(media_path));
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    media_path = ''; media_type = '';
  } else if (req.file) {
    if (existing.media_path) {
      const oldFp = path.join(uploadsDir, path.basename(existing.media_path));
      if (fs.existsSync(oldFp)) fs.unlinkSync(oldFp);
    }
    media_type = /^video\//.test(req.file.mimetype) ? 'video' : 'image';
    media_path = await processUploadedImage(req.file);
  }
  db.set('site_settings.promo', {
    enabled: enabled === 'on',
    discounts,
    deposit: Math.max(0, parseInt(deposit) || 100),
    // This db.set replaces the whole promo object, so every field the app reads
    // has to be listed here or it is silently dropped on the next save. An
    // absent field keeps the stored value rather than resetting to 0 — only an
    // explicit 0 in the form turns the late fee off.
    late_fee_per_day: (late_fee_per_day != null && late_fee_per_day !== '')
      ? Math.max(0, parseInt(late_fee_per_day) || 0)
      : (existing.late_fee_per_day != null ? existing.late_fee_per_day : 20),
    buy_promo_enabled: buy_promo_enabled === 'on',
    buy_promo_pct: Math.min(100, Math.max(0, parseInt(buy_promo_pct) || 0)),
    media_path, media_type,
    ends_at: (ends_at || '').trim(),
    title: (title || '').trim() || 'Rent Longer. Save More.',
    text: (text || '').trim() || 'Discount applied automatically at checkout — no code needed.'
  }).write();
  res.redirect('/admin?msg=promo_saved');
});

// Payment method details + QR images. Mirrors /admin/promo: multipart because
// each method carries a QR image, and an unchanged file input leaves the
// existing image in place rather than blanking it.
app.post('/admin/payment-methods', requireAuth, uploadPromoMedia.fields([
  { name: 'qr_gcash', maxCount: 1 },
  { name: 'qr_maya',  maxCount: 1 }
]), async (req, res) => {
  const existing = db.get('site_settings.payment_methods').value() || [];
  const next = [];
  for (const m of existing) {
    const f = (req.files && req.files['qr_' + m.key]) ? req.files['qr_' + m.key][0] : null;
    let qr = m.qr_image || '';
    if (req.body['remove_qr_' + m.key] === 'on' && qr) {
      const fp = path.join(uploadsDir, path.basename(qr));
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      qr = '';
    }
    if (f) {
      if (qr) {
        const oldFp = path.join(uploadsDir, path.basename(qr));
        if (fs.existsSync(oldFp)) fs.unlinkSync(oldFp);
      }
      qr = await processUploadedImage(f, 900);
    }
    next.push({
      key: m.key,
      label: m.label,
      account_name: (req.body['name_' + m.key] || '').trim(),
      account_number: (req.body['number_' + m.key] || '').trim(),
      qr_image: qr,
      // A method with no QR and no account number cannot be paid to, so it
      // stays off no matter what the checkbox says.
      enabled: req.body['enabled_' + m.key] === 'on' && !!(qr || (req.body['number_' + m.key] || '').trim())
    });
  }
  db.set('site_settings.payment_methods', next).write();
  db.set('site_settings.fb_page_username', (req.body.fb_page_username || '').trim().replace(/^@/, '')).write();
  res.redirect('/admin?tab=settings&msg=payment_saved');
});

app.post('/admin/message-templates', requireAuth, (req, res) => {
  const existing = db.get('site_settings.message_templates').value() || {};
  const next = Object.assign({}, existing);
  // Only fields the module defines are writable — an unexpected form field
  // cannot introduce a key that render() would never read.
  Object.keys(templates.DEFAULT_TEMPLATES).forEach(k => {
    if (typeof req.body[k] === 'string') next[k] = req.body[k];
  });
  db.set('site_settings.message_templates', next).write();
  res.redirect('/admin?msg=templates_saved');
});

// ── Homepage Popup ────────────────────────────────────────────────────────────
// Reuses uploadPosterBg (images only, 20MB) — promo artwork is the same shape of file.
app.post('/admin/popup', requireAuth, uploadPosterBg.single('popup_image'), async (req, res) => {
  const { enabled, link_url, starts_at, ends_at, remove_image } = req.body;
  const existing = db.get('site_settings.popup').value() || {};
  let image_path = existing.image_path || '';
  // Bumped whenever the artwork changes. The dismissal key on the client embeds this
  // version, so a "don't show today" click on the old popup can't suppress the new one.
  let version = existing.version || 1;
  if (remove_image === 'on') {
    if (image_path) {
      const fp = path.join(uploadsDir, path.basename(image_path));
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    image_path = '';
    version++;
  } else if (req.file) {
    if (existing.image_path) {
      const oldFp = path.join(uploadsDir, path.basename(existing.image_path));
      if (fs.existsSync(oldFp)) fs.unlinkSync(oldFp);
    }
    image_path = await processUploadedImage(req.file);
    version++;
  }
  db.set('site_settings.popup', {
    enabled: enabled === 'on',
    image_path,
    link_url: (link_url || '').trim() || '/browse',
    starts_at: (starts_at || '').trim(),
    ends_at: (ends_at || '').trim(),
    version
  }).write();
  res.redirect('/admin?msg=popup_saved');
});

// ── Mobile Admin App ──────────────────────────────────────────────────────────
app.get('/admin/app', requireAuth, (req, res) => {
  const customers = getCustomers();
  const games = getGames().map(resolveGamePrices);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const active = customers.filter(c => c.status === 'renting');
  const reservations = customers.filter(c => c.status === 'reservation');
  const bought = customers.filter(c => c.status === 'bought');

  const today0 = new Date(); today0.setHours(0,0,0,0);
  const overdue = active.filter(c => c.end_date && new Date(c.end_date + 'T00:00:00') < today0);
  const dueSoon = active.filter(c => {
    if (!c.end_date) return false;
    const d = new Date(c.end_date + 'T00:00:00');
    const diff = Math.ceil((d - today0) / 86400000);
    return diff >= 0 && diff <= 3;
  });

  const totalRevenue = customers.reduce((s, c) => s + (c.price || 0), 0);
  const thisMonth = now.getMonth(), thisYear = now.getFullYear();
  const monthRevenue = customers.filter(c => {
    const ds = c.start_date || c.created_at;
    if (!ds) return false;
    const d = new Date(c.start_date ? c.start_date + 'T00:00:00' : c.created_at);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).reduce((s, c) => s + (c.price || 0), 0);

  const todayVisitors = (db.get('visitors').value() || []).filter(v => v.date === todayStr).length;

  const slots = {
    nt: games.reduce((s, g) => s + (g.non_trophy_slots || 0), 0),
    tr: games.reduce((s, g) => s + (g.trophy_slots || 0), 0),
    ps4: games.reduce((s, g) => s + (g.ps4_primary_slots || 0), 0),
  };

  res.render('admin-app', {
    active, overdue, dueSoon, reservations, bought,
    totalRevenue, monthRevenue, todayVisitors,
    slots, games, customers,
    settings: getSiteSettings()
  });
});
// ─────────────────────────────────────────────────────────────────────────────

app.get('/admin', requireAuth, async (req, res) => {
  const games = [...getGames()].sort((a, b) => b.id - a.id).map(resolveGamePrices);
  const upcoming = [...getUpcoming()].sort((a, b) => b.id - a.id);
  const psplus = [...getPsplus()].sort((a, b) => b.year - a.year || b.month - a.month);
  const psplusPopular = [...getPsplusPopular()].sort((a, b) => (a.rank || 999) - (b.rank || 999));
  const customers = [...getCustomers()].sort((a, b) => {
    const rank = c => c.status === 'renting' ? 0 : c.status === 'reservation' ? 1 : c.status === 'bought' ? 2 : 3; // done last
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.status === 'renting') {
      // Active rentals: soonest due date first, no end_date → bottom
      if (!a.end_date && !b.end_date) return 0;
      if (!a.end_date) return 1;
      if (!b.end_date) return -1;
      return a.end_date.localeCompare(b.end_date);
    }
    // Done / bought / reservation: most recently finished/added first
    const ad = a.end_date || a.created_at || '';
    const bd = b.end_date || b.created_at || '';
    return bd.localeCompare(ad);
  });
  const visitors = db.get('visitors').value();
  const reviews = db.get('reviews').value().sort((a, b) => (a.order || 999) - (b.order || 999));
  const botTraining = db.get('bot_training').value() || [];
  // Slim payload for the client-side dashboard (year filter + month drill-down) —
  // only the fields it needs, not the full customer records.
  const dashboardData = customers.map(c => ({
    price: c.price || 0, status: c.status, start_date: c.start_date || '', created_at: c.created_at || '',
    end_date: c.end_date || '', game_title: c.game_title || '', customer_name: c.customer_name || '',
    payments: c.payments || []
  }));
  const monthLogs = getMonthLogs();
  // Finished rentals are the bulk of the customer list and grow forever — at 431
  // records they were 1.4MB of the admin page's 1.8MB, re-rendered on every load
  // regardless of which tab was open. The table now renders only live rentals
  // unless ?history=1 is set. Every stat and aggregate still reads the full
  // `customers` array, so nothing reported changes.
  const showHistory = req.query.history === '1';
  try {
    await orders.expireStaleQrs();
    await orders.advanceEndedRentals();
  } catch (e) { console.error('[order sweep]', e.message); }
  const orderQueue = await orders.listByStates(orders.OWNER_STATES);
  const refundsOwed = (await orders.listByStates(['closed']))
    .filter(o => (o.deposit_due || 0) > 0 && !o.deposit_refunded);
  // "Started but didn't pay" — every order stuck before payment is verified.
  // The form captures a Facebook name before payment, so each row is a named
  // lead the owner can message directly, not just a statistic.
  const abandonedOrders = await orders.listByStates(['awaiting_payment', 'payment_rejected']);
  // Weekly funnel readout: how many orders started, how many completed
  // (reached active or beyond), and what fraction that is of game-page
  // traffic in the same window. The single number the conversion plan's
  // decision rule is measured against.
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const allOrders = await orders.listByStates([...orders.STATES, ...orders.TERMINAL]);
  const allRecentOrders = allOrders.filter(o => new Date(o.created_at) >= weekAgo);
  const startedCount = allRecentOrders.length;
  const completedCount = allRecentOrders.filter(o =>
    !orders.PAID_EXCLUDED_STATES.includes(o.state)
  ).length;
  const abandonedCount = startedCount - completedCount;
  // Deliberately UTC, not manilaDate() — visitors.date is stamped in UTC by
  // the tracking middleware, and comparing dates in two different clocks
  // would silently exclude up to a day of visits from the denominator.
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);
  const gamePageVisits = (visitors || []).filter(v =>
    v.path && v.path.startsWith('/game/') && v.date >= weekAgoStr
  ).length;
  const orderStartRate = gamePageVisits > 0
    ? ((startedCount / gamePageVisits) * 100).toFixed(1)
    : null;

  // ── Orders ledger ─────────────────────────────────────────────────────────
  // Every order, browsable by period. Derived from the allOrders array already
  // fetched above rather than a second query, so adding the ledger costs no
  // extra database round trips.
  //
  // Nothing is ever pruned: `orderPeriods` lists every YYYY-MM that actually
  // contains orders, so the picker can reach the full history. Only the DEFAULT
  // view is narrowed — to the last 3 months — because rendering every order on
  // a tab that is usually opened for the action queue is what made the
  // Customers table need trimming.
  const LEDGER_DEFAULT_MONTHS = 3;
  const orderPeriods = [...new Set(allOrders
    .map(o => (o.created_at || '').slice(0, 7))
    .filter(p => /^\d{4}-\d{2}$/.test(p))
  )].sort().reverse();
  const orderYears = [...new Set(orderPeriods.map(p => p.slice(0, 4)))];
  // "2026-08" (one month), "2026" (whole year), "all", or "" for the default window.
  const rawPeriod = String(req.query.operiod || '').trim();
  const orderPeriod = /^(\d{4}(-\d{2})?|all)$/.test(rawPeriod) ? rawPeriod : '';
  let ledgerOrders;
  if (orderPeriod === 'all') {
    ledgerOrders = allOrders;
  } else if (orderPeriod) {
    ledgerOrders = allOrders.filter(o => (o.created_at || '').startsWith(orderPeriod));
  } else {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - LEDGER_DEFAULT_MONTHS);
    const cutoffStr = cutoff.toISOString().slice(0, 7);
    ledgerOrders = allOrders.filter(o => (o.created_at || '').slice(0, 7) >= cutoffStr);
  }
  ledgerOrders = [...ledgerOrders].sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
  // Month headers carry their own count and peso subtotal, so the running total
  // always describes the rows directly beneath it. Paid orders only — an order
  // that was never paid contributed no money and must not inflate the subtotal.
  const ledgerGroups = [];
  ledgerOrders.forEach(o => {
    const key = (o.created_at || '').slice(0, 7);
    let g = ledgerGroups[ledgerGroups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: key, orders: [], paidCount: 0, paidTotal: 0 };
      ledgerGroups.push(g);
    }
    g.orders.push(o);
    if (orders.isPaid(o.state)) {
      g.paidCount++;
      g.paidTotal += (o.amount_due || 0) + (o.deposit_due || 0);
    }
  });
  // Stat tiles. Scoped to the loaded period so they describe what is on screen,
  // except "needs you" and "out on rent", which are always live totals.
  const ledgerStats = {
    needsYou: orderQueue.length,
    qrLive: orderQueue.filter(o => o.state === 'qr_pending').length,
    out: allOrders.filter(o => orders.OUT_STATES.includes(o.state)).length,
    paidCount: ledgerOrders.filter(o => orders.isPaid(o.state)).length,
    paidTotal: ledgerOrders.filter(o => orders.isPaid(o.state))
      .reduce((s, o) => s + (o.amount_due || 0) + (o.deposit_due || 0), 0),
    unpaid: ledgerOrders.filter(o => ['awaiting_payment', 'payment_rejected'].includes(o.state)).length,
    cancelled: ledgerOrders.filter(o => o.state === 'cancelled').length,
    total: ledgerOrders.length
  };

  // ── Visitors tab: session summaries + windowed metrics ────────────────────
  // One pass collapses raw pageview rows into a single record per session, and
  // every time window is then derived from that compact array. Re-walking the
  // raw rows once per window would mean nineteen passes over a collection that
  // grows without bound; this is one pass regardless of how many windows exist.
  const sessionedVisits = visitors.filter(v => v.session_id);
  const rowsBySession = {};
  sessionedVisits.forEach(v => {
    (rowsBySession[v.session_id] = rowsBySession[v.session_id] || []).push(v);
  });

  const sessionedOrders = allOrders.filter(o => o.session_id);
  const orderedSessionIds = new Set(sessionedOrders.map(o => o.session_id));
  const paidSessionIds = new Set(
    sessionedOrders
      .filter(o => !orders.PAID_EXCLUDED_STATES.includes(o.state))
      .map(o => o.session_id)
  );

  const sessionSummaries = Object.keys(rowsBySession).map(sid => {
    const rows = rowsBySession[sid];
    const ordered = orderedSessionIds.has(sid);
    return {
      // A session belongs to the day it STARTED. Counting it on every day it
      // was active would double-count sessions across days and make "Landed"
      // meaningless as a total.
      startDate: rows[0].date,
      browsed: rows.some(v => v.path === '/browse'),
      // "OR ordered" is load-bearing, not redundant: an order can only be
      // placed from a game page, so in practice every ordering session also
      // has a /game/ row — but if that row were ever missing (a tracking gap,
      // a middleware exclusion change), a plain check would let "Started
      // order" exceed "Viewed a game" and reintroduce a >100% percentage.
      // Folding the order in makes the nesting structural, not incidental.
      viewedGame: rows.some(v => v.path.startsWith('/game/')) || ordered,
      ordered,
      paid: paidSessionIds.has(sid),
      // No tab-close event exists, so the last row recorded for a session is
      // the closest available proxy for "the last thing they looked at".
      exitPath: rows[rows.length - 1].path,
      rows
    };
  });

  // Builds every metric for one set of sessions. Called once per window.
  function visWindowMetrics(sessions) {
    const landed = sessions.length;
    const viewedGame = sessions.filter(s => s.viewedGame).length;
    const started = sessions.filter(s => s.ordered).length;
    const paid = sessions.filter(s => s.paid).length;
    const browsedCount = sessions.filter(s => s.browsed).length;

    const pct = (n, prev) => (prev > 0 ? Math.round((n / prev) * 100) : null);
    const funnel = [
      { label: 'Landed', count: landed, pctOfPrev: null },
      { label: 'Viewed a game', count: viewedGame, pctOfPrev: pct(viewedGame, landed) },
      { label: 'Started order', count: started, pctOfPrev: pct(started, viewedGame) },
      { label: 'Paid', count: paid, pctOfPrev: pct(paid, started) }
    ];

    const exitCounts = {};
    sessions.forEach(s => { exitCounts[s.exitPath] = (exitCounts[s.exitPath] || 0) + 1; });
    const exitPages = Object.entries(exitCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([path, count]) => ({ path, count }));

    return {
      funnel,
      exitPages,
      browsed: { count: browsedCount, total: landed, pct: pct(browsedCount, landed) }
    };
  }

  // Most Visited Pages counts PAGE VIEWS, not sessions — it answers "which
  // pages got looked at most", a different question from the session-scoped
  // funnel. It is computed independently over the FULL visitors[] array
  // (filtered by each row's own .date), not over sessionSummaries, so that:
  //   1) "Today's Most Visited Pages" always agrees with the "Today's Visits"
  //      KPI card (both count every row whose date is today), and
  //   2) rows with no session_id (e.g. everything recorded before session
  //      tracking launched) aren't silently dropped from "All-time".
  function topPagesForWindow(dateFilter) {
    const pageCounts = {};
    (visitors || []).forEach(v => {
      if (!dateFilter(v.date)) return;
      const key = v.page || v.path;
      pageCounts[key] = (pageCounts[key] || 0) + 1;
    });
    return Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }

  const winToday = new Date().toISOString().slice(0, 10);
  const winWeek  = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const winMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const winYear  = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  const VIS_WINDOWS = {
    today: { ...visWindowMetrics(sessionSummaries.filter(s => s.startDate === winToday)), topPages: topPagesForWindow(d => d === winToday) },
    week:  { ...visWindowMetrics(sessionSummaries.filter(s => s.startDate >= winWeek)),  topPages: topPagesForWindow(d => d >= winWeek) },
    month: { ...visWindowMetrics(sessionSummaries.filter(s => s.startDate >= winMonth)), topPages: topPagesForWindow(d => d >= winMonth) },
    year:  { ...visWindowMetrics(sessionSummaries.filter(s => s.startDate >= winYear)),  topPages: topPagesForWindow(d => d >= winYear) },
    all:   { ...visWindowMetrics(sessionSummaries), topPages: topPagesForWindow(() => true) },
    byDate: {}
  };

  // Only the fourteen chart bars are clickable, so only those dates need a
  // precomputed entry. This mirrors the same fourteen days the view's own
  // vLast14 chart renders.
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    VIS_WINDOWS.byDate[d] = { ...visWindowMetrics(sessionSummaries.filter(s => s.startDate === d)), topPages: topPagesForWindow(vd => vd === d) };
  }

  res.render('admin', { games, upcoming, psplus, psplusPopular, psplusPrices: getPsplusPrices(), psplusSlots: getPsplusSlots(), announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings(), priceCategories: getPriceCategories(), customers, dashboardData, monthLogs, visitors, msg: req.query.msg || null, reviews, botTraining, accounts: getAccounts(), showHistory, messageTemplates: getSiteSettings().message_templates, templateTokens: templates.TOKENS, orderQueue, refundsOwed, abandonedOrders, startedCount, completedCount, abandonedCount, orderStartRate, VIS_WINDOWS, ledgerGroups, ledgerStats, orderPeriods, orderYears, orderPeriod, signinSteps: getSigninSteps() });
});

// Recent Visits only renders the 100 most recent rows server-side — clicking an older
// day in the 14-day chart needs the full matching set, not just whatever of that day
// survived the top-100 cutoff.
app.get('/admin/api/visitors-by-date', requireAuth, (req, res) => {
  const date = req.query.date || '';
  const matches = db.get('visitors').value().filter(v => v.date === date).reverse().slice(0, 500);
  res.json(matches);
});

// Upcoming CRUD
app.get('/upcoming/:slug', (req, res) => {
  const slug = req.params.slug;
  // slug format: title-slug-ID (ID is at the end after last dash)
  const idMatch = slug.match(/-(\d+)$/);
  let game = null;
  if (idMatch) {
    game = getUpcomingGame(idMatch[1]);
  }
  if (!game) {
    // fallback: match by title slug
    game = getUpcoming().find(g => {
      const s = g.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return slug === s || slug.startsWith(s + '-');
    });
  }
  if (!game) return res.redirect('/browse');

  // Subtract active reservations from slot counts
  const gameKey = 'upcoming_' + game.id;
  const reservations = getCustomers().filter(c =>
    String(c.game_id) === gameKey && c.status === 'reservation'
  );
  const reservedNt = reservations.filter(c => c.account_type === 'nt').length;
  const reservedTr = reservations.filter(c => c.account_type === 'tr').length;
  const resolvedGame = Object.assign({}, game, {
    non_trophy_slots: Math.max(0, (game.non_trophy_slots || 0) - reservedNt),
    trophy_slots:     Math.max(0, (game.trophy_slots     || 0) - reservedTr),
  });

  res.render('upcoming-detail', { game: resolvedGame, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings(), order_error: req.query.order_error || null });
});

app.post('/admin/upcoming/add', upload.single('cover_image'), requireAuth, async (req, res) => {
  const { title, platform, genre, release_date, release_date_tba_val, description,
          non_trophy_slots, trophy_slots, rank,
          nt_price_7d, nt_price_30d,
          tr_price_7d, tr_price_30d } = req.body;
  if (!title || !title.trim()) return res.redirect('/admin?msg=error');
  const cover_image = req.file ? await processUploadedImage(req.file) : '';
  const finalDate = release_date_tba_val === 'TBA' ? 'TBA' : (release_date || 'TBA');
  db.get('upcoming').push({
    id: newUpcomingId(),
    title: title.trim(),
    platform: platform || 'PS5',
    genre: genre || '',
    release_date: finalDate,
    description: description || '',
    cover_image,
    rank: parseInt(rank) || 0,
    non_trophy_slots: parseInt(non_trophy_slots) || 0,
    trophy_slots: parseInt(trophy_slots) || 0,
    nt_price_7d: parseInt(nt_price_7d) || 0,
    nt_price_30d: parseInt(nt_price_30d) || 0,
    tr_price_7d: parseInt(tr_price_7d) || 0,
    tr_price_30d: parseInt(tr_price_30d) || 0,
    created_at: new Date().toISOString()
  }).write();
  res.redirect('/admin?msg=upcoming_added');
});

app.get('/admin/upcoming/edit/:id', requireAuth, (req, res) => {
  const game = getUpcomingGame(req.params.id);
  if (!game) return res.redirect('/admin');
  res.render('edit-upcoming', { game, settings: getSiteSettings() });
});

app.post('/admin/upcoming/edit/:id', upload.single('cover_image'), requireAuth, async (req, res) => {
  const { title, platform, genre, release_date, release_date_tba_val, description,
          non_trophy_slots, trophy_slots, rank,
          nt_price_7d, nt_price_30d,
          tr_price_7d, tr_price_30d } = req.body;
  const existing = getUpcomingGame(req.params.id);
  if (!existing) return res.redirect('/admin');
  const cover_image = req.file ? await processUploadedImage(req.file) : existing.cover_image;
  const finalDate = release_date_tba_val === 'TBA' ? 'TBA' : (release_date || 'TBA');
  db.get('upcoming').find({ id: parseInt(req.params.id) }).assign({
    title: title.trim(), platform, genre: genre || '',
    release_date: finalDate, description: description || '', cover_image,
    rank: parseInt(rank) || 0,
    non_trophy_slots: parseInt(non_trophy_slots) || 0,
    trophy_slots: parseInt(trophy_slots) || 0,
    nt_price_7d: parseInt(nt_price_7d) || 0,
    nt_price_30d: parseInt(nt_price_30d) || 0,
    tr_price_7d: parseInt(tr_price_7d) || 0,
    tr_price_30d: parseInt(tr_price_30d) || 0,
  }).write();
  res.redirect('/admin?msg=upcoming_updated');
});

app.post('/admin/upcoming/delete/:id', requireAuth, (req, res) => {
  const game = getUpcomingGame(req.params.id);
  if (game?.cover_image) {
    const fp = path.join(uploadsDir, path.basename(game.cover_image));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.get('upcoming').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?msg=upcoming_deleted');
});

app.post('/admin/upcoming/release/:id', requireAuth, (req, res) => {
  const game = getUpcomingGame(req.params.id);
  if (!game) return res.redirect('/admin');
  // Add to available games
  db.get('games').push({
    id: newId(),
    title: game.title,
    platform: game.platform || 'PS5',
    genre: game.genre || '',
    description: game.description || '',
    cover_image: game.cover_image || '',
    non_trophy_slots: game.non_trophy_slots || 0,
    trophy_slots: game.trophy_slots || 0,
    nt_price_7d: game.nt_price_7d || 0,
    nt_price_30d: game.nt_price_30d || 0,
    tr_price_7d: game.tr_price_7d || 0,
    tr_price_30d: game.tr_price_30d || 0,
    featured: false,
    renters: 0,
    // Carry the announced date over so a game promoted from Coming Soon lands in
    // "New Releases" without re-typing it. 'TBA' means it was never announced, so
    // it becomes blank here and the admin can fill in the real date.
    release_date: (game.release_date && game.release_date !== 'TBA') ? game.release_date : '',
    created_at: new Date().toISOString()
  }).write();
  // Remove from upcoming
  db.get('upcoming').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?msg=game_released');
});

app.post('/admin/announcement', requireAuth, (req, res) => {
  const { text, active } = req.body;
  db.set('announcement', { text: text || '', active: active === 'on' }).write();
  res.redirect('/admin?msg=announcement');
});

app.post('/admin/announcements/add', requireAuth, (req, res) => {
  const { text, active } = req.body;
  if (!text || !text.trim()) return res.redirect('/admin?msg=error');
  const id = db.get('nextAnnouncementId').value();
  db.get('announcements').push({ id, text: text.trim(), active: active === 'on' }).write();
  db.set('nextAnnouncementId', id + 1).write();
  res.redirect('/admin?msg=announcement');
});

app.post('/admin/announcements/edit/:id', requireAuth, (req, res) => {
  const { text, active } = req.body;
  db.get('announcements').find({ id: parseInt(req.params.id) })
    .assign({ text: text || '', active: active === 'on' }).write();
  res.redirect('/admin?msg=announcement');
});

app.post('/admin/announcements/delete/:id', requireAuth, (req, res) => {
  db.get('announcements').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?msg=announcement');
});

app.post('/admin/add', upload.fields([{ name: 'cover_image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }]), requireAuth, async (req, res) => {
  const { title, platform, available_slots, renters, new_window_days,
    nt_price_7d, nt_price_30d,
    tr_price_7d, tr_price_30d,
    buy_nt_price, buy_tr_price,
    genre, description, release_date, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    price_category_id, price_mode, cost, link_label, link_url } = req.body;
  if (!title || !title.trim()) return res.redirect('/admin?msg=error');
  const coverFile = req.files && req.files.cover_image ? req.files.cover_image[0] : null;
  const cover_image = coverFile ? await processUploadedImage(coverFile) : '';
  const cover_focal_x = 50, cover_focal_y = 50; // fine-tuned later via Edit, once the cover is visible
  const gallery = await Promise.all((req.files && req.files.gallery ? req.files.gallery : []).map(f => processUploadedImage(f)));
  const useCategory = price_mode === 'category' && price_category_id;
  const cat = useCategory ? getPriceCategory(price_category_id) : null;
  db.get('games').push({
    id: newId(),
    title: title.trim(),
    platform: platform || 'PS5',
    cover_image,
    cover_focal_x,
    cover_focal_y,
    gallery,
    available_slots: parseInt(available_slots) || 1,
    renters: parseInt(renters) || 0,
    new_window_days: parseInt(new_window_days) > 0 ? parseInt(new_window_days) : null,
    price_category_id: cat ? parseInt(price_category_id) : null,
    nt_price_7d: cat ? cat.nt_price_7d : (parseInt(nt_price_7d) || 149),
    nt_price_30d: cat ? cat.nt_price_30d : (parseInt(nt_price_30d) || 349),
    tr_price_7d: cat ? cat.tr_price_7d : (parseInt(tr_price_7d) || 199),
    tr_price_30d: cat ? cat.tr_price_30d : (parseInt(tr_price_30d) || 399),
    genre: genre || '',
    description: description || '',
    link_label: (link_label || '').trim(),
    link_url: (link_url || '').trim(),
    non_trophy_slots: parseInt(non_trophy_slots) || 0,
    trophy_slots: trophy_account === 'on' ? (parseInt(trophy_slots) || 1) : 0,
    trophy_account: trophy_account === 'on',
    ps4_primary_slots: parseInt(ps4_primary_slots) || 0,
    buy_nt_price: parseInt(buy_nt_price) || 0,
    buy_tr_price: parseInt(buy_tr_price) || 0,
    cost: parseInt(cost) || 0,
    // Publisher release date (YYYY-MM-DD), optional. Drives the homepage "New
    // Releases" section, which skips any game where this is unset — distinct
    // from created_at, which is when we started stocking it (the NEW badge).
    release_date: (release_date || '').trim(),
    created_at: new Date().toISOString()
  }).write();
  res.redirect('/admin?msg=added');
});

app.get('/admin/edit/:id', requireAuth, (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.redirect('/admin');
  res.render('edit', { game, settings: getSiteSettings(), priceCategories: getPriceCategories(), accounts: getAccounts() });
});

app.post('/admin/edit/:id', upload.fields([{ name: 'cover_image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }]), requireAuth, async (req, res) => {
  const { title, platform, available_slots, renters, new_window_days,
    nt_price_7d, nt_price_30d,
    tr_price_7d, tr_price_30d,
    buy_nt_price, buy_tr_price,
    genre, description, release_date, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    remove_gallery, cover_focal_x, cover_focal_y,
    price_category_id, price_mode, cost, link_label, link_url,
    is_bundle, bundle_account_id } = req.body;
  const existing = getGame(req.params.id);
  if (!existing) return res.redirect('/admin');
  const coverFile = req.files && req.files.cover_image ? req.files.cover_image[0] : null;
  const cover_image = coverFile ? await processUploadedImage(coverFile) : existing.cover_image;
  // A freshly uploaded cover resets the focal point — the old point was picked for
  // the old image and won't line up with the new one until re-adjusted.
  const focalX = coverFile ? 50 : Math.min(100, Math.max(0, parseInt(cover_focal_x)));
  const focalY = coverFile ? 50 : Math.min(100, Math.max(0, parseInt(cover_focal_y)));
  const cover_focal_x_final = isNaN(focalX) ? (existing.cover_focal_x != null ? existing.cover_focal_x : 50) : focalX;
  const cover_focal_y_final = isNaN(focalY) ? (existing.cover_focal_y != null ? existing.cover_focal_y : 50) : focalY;

  // Gallery: keep existing minus removed, then append newly uploaded.
  // Only ever delete files that are actually in THIS game's own gallery — a submitted
  // remove_gallery entry naming any other file (tampered or stale) is ignored.
  const requestedRemove = Array.isArray(remove_gallery) ? remove_gallery : (remove_gallery ? [remove_gallery] : []);
  const existingGallery = existing.gallery || [];
  const toRemove = requestedRemove.filter(img => existingGallery.includes(img));
  let gallery = existingGallery.filter(img => !toRemove.includes(img));
  toRemove.forEach(img => {
    const fp = path.join(uploadsDir, path.basename(img));
    if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (e) {} }
  });
  const newGallery = await Promise.all((req.files && req.files.gallery ? req.files.gallery : []).map(f => processUploadedImage(f)));
  gallery = gallery.concat(newGallery);

  const useCategory = price_mode === 'category' && price_category_id;
  const cat = useCategory ? getPriceCategory(price_category_id) : null;
  db.get('games').find({ id: parseInt(req.params.id) }).assign({
    title: title.trim(), platform, cover_image,
    cover_focal_x: cover_focal_x_final, cover_focal_y: cover_focal_y_final,
    gallery,
    available_slots: parseInt(available_slots),
    renters: parseInt(renters),
    new_window_days: parseInt(new_window_days) > 0 ? parseInt(new_window_days) : null,
    price_category_id: cat ? parseInt(price_category_id) : null,
    nt_price_7d: cat ? cat.nt_price_7d : parseInt(nt_price_7d),
    nt_price_30d: cat ? cat.nt_price_30d : parseInt(nt_price_30d),
    tr_price_7d: cat ? cat.tr_price_7d : parseInt(tr_price_7d),
    tr_price_30d: cat ? cat.tr_price_30d : parseInt(tr_price_30d),
    genre: genre || '',
    description: description || '',
    link_label: (link_label || '').trim(),
    link_url: (link_url || '').trim(),
    non_trophy_slots: parseInt(non_trophy_slots) || 0,
    trophy_slots: trophy_account === 'on' ? (parseInt(trophy_slots) || 0) : 0,
    trophy_account: trophy_account === 'on',
    ps4_primary_slots: parseInt(ps4_primary_slots) || 0,
    buy_nt_price: parseInt(buy_nt_price) || 0,
    buy_tr_price: parseInt(buy_tr_price) || 0,
    cost: parseInt(cost) || 0,
    is_bundle: is_bundle === 'on',
    bundle_account_id: bundle_account_id ? parseInt(bundle_account_id) : null,
    release_date: (release_date || '').trim()
  }).write();
  res.redirect('/admin?msg=updated');
});

// Description-only update — used for bulk-filling descriptions without having to
// resubmit every other field (the full edit route requires all of them or it
// overwrites prices/slots/platform with blanks).
app.post('/admin/games/:id/description', requireAuth, (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.status(404).json({ ok: false, error: 'Game not found' });
  const description = (req.body.description || '').trim();
  db.get('games').find({ id: parseInt(req.params.id) }).assign({ description }).write();
  res.json({ ok: true, id: game.id, title: game.title });
});

// Toggles "the account is stocked and ready" independent of rental history — clears
// the not-yet-stocked notice on game-detail.ejs without touching the new-game
// countdown, which stays governed purely by created_at (the two are independent).
app.post('/admin/games/:id/stocked', requireAuth, (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.redirect('/admin');
  db.get('games').find({ id: parseInt(req.params.id) }).assign({ stocked: !game.stocked }).write();
  res.redirect('/admin?msg=updated');
});

app.post('/admin/delete/:id', requireAuth, (req, res) => {
  const game = getGame(req.params.id);
  if (game?.cover_image) {
    const filePath = path.join(uploadsDir, path.basename(game.cover_image));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  (game?.gallery || []).forEach(img => {
    const fp = path.join(uploadsDir, path.basename(img));
    if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (e) {} }
  });
  db.get('games').remove({ id: parseInt(req.params.id) }).write();
  // Remove this game's id from every account's game_ids so no phantom links remain.
  const deletedGameId = parseInt(req.params.id);
  getAccounts().forEach(acc => {
    if (acc.game_ids.includes(deletedGameId)) {
      db.get('accounts').find({ id: acc.id }).assign({
        game_ids: acc.game_ids.filter(gid => gid !== deletedGameId)
      }).write();
    }
  });
  res.redirect('/admin?msg=deleted');
});

// One-time (re-runnable) migration: shrinks every pre-existing cover/gallery/popup/promo
// upload down to the same WebP treatment new uploads get automatically. Safe to run
// more than once — anything already .webp or already resized is skipped.
async function migrateImageFile(relPath, maxDim = 900) {
  if (!relPath || !relPath.startsWith('/uploads/')) return { path: relPath, changed: false };
  if (/\.webp$/i.test(relPath)) return { path: relPath, changed: false };
  const fileName = path.basename(relPath);
  const filePath = path.join(uploadsDir, fileName);
  if (!fs.existsSync(filePath)) return { path: relPath, changed: false };
  const outName = path.basename(fileName, path.extname(fileName)) + '.webp';
  const outPath = path.join(uploadsDir, outName);
  try {
    await sharp(filePath).rotate().resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(outPath);
    fs.unlinkSync(filePath);
    return { path: '/uploads/' + outName, changed: true };
  } catch (e) {
    console.error('Backfill failed for', relPath, e.message);
    return { path: relPath, changed: false, error: true };
  }
}
app.post('/admin/backfill-images', requireAuth, async (req, res) => {
  const stats = { processed: 0, skipped: 0, errors: 0 };
  const tally = (r) => { if (r.error) stats.errors++; else if (r.changed) stats.processed++; else stats.skipped++; };

  for (const g of db.get('games').value()) {
    const patch = {};
    if (g.cover_image) { const r = await migrateImageFile(g.cover_image); tally(r); if (r.changed) patch.cover_image = r.path; }
    if (g.gallery && g.gallery.length) {
      const newGallery = [];
      let galleryChanged = false;
      for (const img of g.gallery) { const r = await migrateImageFile(img); tally(r); newGallery.push(r.path); if (r.changed) galleryChanged = true; }
      if (galleryChanged) patch.gallery = newGallery;
    }
    if (Object.keys(patch).length) db.get('games').find({ id: g.id }).assign(patch).write();
  }
  for (const g of db.get('upcoming').value()) {
    if (!g.cover_image) continue;
    const r = await migrateImageFile(g.cover_image); tally(r);
    if (r.changed) db.get('upcoming').find({ id: g.id }).assign({ cover_image: r.path }).write();
  }
  for (const e of db.get('psplus').value()) {
    if (!e.cover_image) continue;
    const r = await migrateImageFile(e.cover_image); tally(r);
    if (r.changed) db.get('psplus').find({ id: e.id }).assign({ cover_image: r.path }).write();
  }
  for (const e of db.get('psplus_popular').value()) {
    if (!e.cover_image) continue;
    const r = await migrateImageFile(e.cover_image); tally(r);
    if (r.changed) db.get('psplus_popular').find({ id: e.id }).assign({ cover_image: r.path }).write();
  }
  const settings = db.get('site_settings').value() || {};
  if (settings.popup && settings.popup.image_path) {
    const r = await migrateImageFile(settings.popup.image_path); tally(r);
    if (r.changed) db.set('site_settings.popup.image_path', r.path).write();
  }
  if (settings.promo && settings.promo.media_path && settings.promo.media_type === 'image') {
    const r = await migrateImageFile(settings.promo.media_path); tally(r);
    if (r.changed) db.set('site_settings.promo.media_path', r.path).write();
  }

  res.json(stats);
});

app.post('/admin/hero-text', requireAuth, (req, res) => {
  const { line1, highlight, line2, subtitle, title_size, highlight_color, subtitle_color } = req.body;
  db.set('site_settings.hero_text', {
    line1: line1 || 'Rent the Latest',
    highlight: highlight || 'PS5 & PS4',
    line2: line2 || 'Games',
    subtitle: subtitle || '',
    title_size: Math.min(120, Math.max(20, parseInt(title_size) || 55)),
    highlight_color: highlight_color || '#F0A500',
    subtitle_color: subtitle_color || '#aaaaaa'
  }).write();
  res.redirect('/admin?msg=settings_saved');
});

app.post('/admin/change-password', requireAuth, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const correct = db.get('admin_password').value();
  if (current_password !== correct) return res.redirect('/admin?msg=wrong_password');
  if (!new_password || new_password.length < 4) return res.redirect('/admin?msg=password_too_short');
  if (new_password !== confirm_password) return res.redirect('/admin?msg=password_mismatch');
  db.set('admin_password', new_password).write();
  res.redirect('/admin?msg=password_changed');
});

app.post('/admin/site-settings', requireAuth, upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'hero_bg_file', maxCount: 1 }, { name: 'favicon', maxCount: 1 }]), (req, res) => {
  const { title, hero_bg_type } = req.body;
  const existing = getSiteSettings();
  let logo_path = existing.logo_path;
  let favicon_path = existing.favicon_path || '/favicon.svg';
  let hero_bg = existing.hero_bg || { type: 'default', path: '' };

  // Handle favicon upload
  const faviconFile = req.files && req.files['favicon'] && req.files['favicon'][0];
  if (faviconFile) {
    const ext = path.extname(faviconFile.originalname) || '.png';
    const destName = 'favicon-custom' + ext;
    const dest = path.join(uploadsDir, destName);
    fs.renameSync(faviconFile.path, dest);
    favicon_path = '/uploads/' + destName;
  }

  // Handle logo upload
  const logoFile = req.files && req.files['logo'] && req.files['logo'][0];
  if (logoFile) {
    const ext = path.extname(logoFile.originalname) || '.png';
    const destName = 'logo-custom' + ext;
    const dest = path.join(uploadsDir, destName);
    fs.renameSync(logoFile.path, dest);
    logo_path = '/uploads/' + destName;
  }

  // Handle hero background
  const heroBgFile = req.files && req.files['hero_bg_file'] && req.files['hero_bg_file'][0];
  if (hero_bg_type === 'default') {
    hero_bg = { type: 'default', path: '' };
  } else if (heroBgFile) {
    const ext = path.extname(heroBgFile.originalname) || '.jpg';
    const isVideo = /\.(mp4|webm|ogg)$/i.test(ext);
    const destName = (isVideo ? 'hero-bg-video' : 'hero-bg-image') + ext;
    const dest = path.join(uploadsDir, destName);
    fs.renameSync(heroBgFile.path, dest);
    hero_bg = { type: isVideo ? 'video' : 'image', path: '/uploads/' + destName };
  } else {
    // No new file uploaded — just update type, keep existing path
    hero_bg = { type: hero_bg_type || existing.hero_bg.type, path: existing.hero_bg.path };
  }
  hero_bg.overlay = Math.min(100, Math.max(0, parseInt(req.body.hero_bg_overlay) || 50));
  const section_gap = Math.min(7, Math.max(1.5, parseFloat(req.body.section_gap) || 4));

  // Preserve hero_text — only update the fields this form controls
  db.set('site_settings.title', (title || 'Playstation Hub').trim()).write();
  db.set('site_settings.logo_path', logo_path).write();
  db.set('site_settings.favicon_path', favicon_path).write();
  db.set('site_settings.hero_bg', hero_bg).write();
  db.set('site_settings.section_gap', section_gap).write();
  res.redirect('/admin?msg=settings_saved');
});

// Hero Slides
app.post('/admin/hero-slides/upload', requireAuth, upload.single('slide_image'), (req, res) => {
  if (!req.file) return res.redirect('/admin?msg=no_file');
  const ext = path.extname(req.file.originalname).toLowerCase();
  const destName = 'slide_' + Date.now() + ext;
  const destPath = path.join(uploadsDir, destName);
  fs.renameSync(req.file.path, destPath);
  const slides = db.get('site_settings.hero_slides').value() || [];
  slides.push({ path: '/uploads/' + destName, caption: (req.body.caption || '').trim(), link: (req.body.link || '').trim() });
  db.set('site_settings.hero_slides', slides).write();
  res.redirect('/admin?msg=slide_added');
});

app.post('/admin/hero-slides/delete', requireAuth, (req, res) => {
  const idx = parseInt(req.body.index);
  const slides = db.get('site_settings.hero_slides').value() || [];
  if (idx >= 0 && idx < slides.length) {
    const sl = slides[idx];
    const filePath = path.join(uploadsDir, path.basename(sl.path));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    slides.splice(idx, 1);
    db.set('site_settings.hero_slides', slides).write();
  }
  res.redirect('/admin?msg=slide_deleted');
});

// Customer CRUD
// Apply/clear an account slot from a customer assignment string "id:type"
// Returns true on success, false if the target slot doesn't exist / is disabled (caller must
// surface this rather than leaving the customer marked active with nothing actually reserved).
function applyAccountAssignment(assignStr, { customerId, customerName, status, endDate }) {
  if (!assignStr || !assignStr.includes(':')) return true;
  const [idPart, type] = assignStr.split(':');
  const account = getAccount(idPart);
  if (!account || !ACCOUNT_SLOT_TYPES.includes(type)) return false;
  const slot = account.slots[type];
  if (!slot || !slot.enabled) return false;
  if (status === 'bought') { slot.status = 'buyed'; slot.start = ''; slot.end = ''; }
  else { slot.status = 'rented'; slot.start = new Date().toISOString().slice(0, 10); slot.end = endDate || ''; }
  slot.renter_id = customerId;
  slot.renter_name = customerName;
  account.slots[type] = slot;
  db.get('accounts').find({ id: account.id }).assign({ slots: account.slots }).write();
  return true;
}
// Free any account slot currently linked to a given customer id.
// NOTE: slots with only a free-text renter_name (no linked customer, renter_id === null) are
// never matched here — there is no customer-side event that could correspond to freeing them,
// and this app has no automated/expiry-based sweep for ANY slot type (linked or free-text).
// Freeing a free-text slot today is a manual admin action via /admin/accounts/:id/slot/:type.
function freeAccountSlotsForCustomer(customerId) {
  let anyChanged = false;
  getAccounts().forEach(acc => {
    let changed = false;
    ACCOUNT_SLOT_TYPES.forEach(t => {
      if (acc.slots[t] && acc.slots[t].renter_id === customerId) {
        acc.slots[t] = blankSlot(acc.slots[t].enabled);
        changed = true;
      }
    });
    if (changed) {
      db.get('accounts').find({ id: acc.id }).assign({ slots: acc.slots }).value();
      anyChanged = true;
    }
  });
  if (anyChanged) db.write();
}
// Find the "accId:type" string of whichever slot is currently linked to a customer, or null
function findAccountAssignmentForCustomer(customerId) {
  for (const acc of getAccounts()) {
    for (const t of ACCOUNT_SLOT_TYPES) {
      if (acc.slots[t] && acc.slots[t].renter_id === customerId) return acc.id + ':' + t;
    }
  }
  return null;
}
// Update renter_name/end date/status on an already-assigned slot WITHOUT resetting its start date.
// Returns true on success, false if the target slot no longer exists/is disabled (caller should surface this).
function refreshAccountAssignment(assignStr, { customerName, endDate, status }) {
  if (!assignStr || !assignStr.includes(':')) return true;
  const [idPart, type] = assignStr.split(':');
  const account = getAccount(idPart);
  if (!account || !ACCOUNT_SLOT_TYPES.includes(type)) return false;
  const slot = account.slots[type];
  if (!slot || !slot.enabled) return false;
  slot.renter_name = customerName;
  // Keep slot.status in sync when the customer toggles between renting ↔ bought on the same slot.
  if (status === 'bought' && slot.status !== 'buyed') { slot.status = 'buyed'; slot.end = ''; }
  else if (status === 'renting' && slot.status !== 'rented') { slot.status = 'rented'; if (endDate) slot.end = endDate; }
  else if (slot.status === 'rented' && endDate) slot.end = endDate;
  account.slots[type] = slot;
  db.get('accounts').find({ id: account.id }).assign({ slots: account.slots }).write();
  return true;
}

app.post('/admin/customers/add', requireAuth, (req, res) => {
  const { customer_name, game_id, days, custom_days, account_type, start_date, end_date, price, status, notes, account_assign } = req.body;
  const actualDays = days === 'custom' ? (parseInt(custom_days) || 1) : (parseInt(days) || 7);
  if (!customer_name || !customer_name.trim() || !game_id) return res.redirect('/admin?tab=customers&msg=error');
  // Reservation uses upcoming game (prefixed id), others use regular game
  const isReservation = (status || 'renting') === 'reservation';
  const isUpcomingGame = String(game_id).startsWith('upcoming_');
  let game = null, gameTitle = '';
  if (isUpcomingGame) {
    const upId = parseInt(String(game_id).replace('upcoming_', ''));
    game = getUpcomingGame(upId);
    gameTitle = game ? game.title : '';
  } else {
    game = getGame(game_id);
    gameTitle = game ? game.title : '';
  }
  if (!game) return res.redirect('/admin?tab=customers&msg=error');
  const resolved = isUpcomingGame ? {} : resolveGamePrices(game);
  const priceVal = parseInt(price) || (days === 'custom' || isUpcomingGame ? 0 : (account_type === 'tr'
    ? (resolved['tr_price_'+days+'d'] || 0)
    : (resolved['nt_price_'+days+'d'] || 0)));
  const id = newCustomerId();
  db.get('customers').push({
    id,
    customer_name: customer_name.trim(),
    game_id: isUpcomingGame ? String(game_id) : parseInt(game_id),
    game_title: gameTitle,
    days: isReservation ? 0 : actualDays,
    account_type: account_type || 'nt',
    start_date: start_date || '',
    end_date: end_date || '',
    price: priceVal,
    status: status || 'renting',
    notes: notes || '',
    created_at: new Date().toISOString(),
    // The first payment is dated to the rental's start so a backdated entry
    // lands in the month it belongs to, matching the backfill rule.
    payments: priceVal > 0
      ? [{ amount: priceVal, date: (start_date || new Date().toISOString().slice(0, 10)), kind: 'rental' }]
      : [],
  }).write();
  // Adjust slots only for renting or bought (not reservation)
  const activeStatus = status || 'renting';
  if ((activeStatus === 'renting' || activeStatus === 'bought') && !isUpcomingGame) {
    const slots = game.available_slots || 0;
    db.get('games').find({ id: parseInt(game_id) }).assign({
      available_slots: Math.max(0, slots - 1),
      renters: (game.renters || 0) + 1
    }).write();
    const aType = account_type || 'nt';
    if (aType === 'tr') adjustTrophySlots(parseInt(game_id), -1);
    else if (aType === 'ps4') adjustPs4Slots(parseInt(game_id), -1);
    else adjustNtSlots(parseInt(game_id), -1);
  }
  // Assign account slot if chosen (renting or bought only)
  if (account_assign && (activeStatus === 'renting' || activeStatus === 'bought')) {
    const assigned = applyAccountAssignment(account_assign, {
      customerId: id, customerName: customer_name.trim(),
      status: activeStatus, endDate: end_date || ''
    });
    if (!assigned) return res.redirect('/admin?tab=customers&msg=slot_unavailable');
  }
  res.redirect('/admin?tab=customers&msg=customer_added');
});

// ── One-time fix: end dates computed via updateCustEndDate() were silently
// shifted a day early by toISOString()'s UTC conversion — that shift only
// happens in a positive-UTC-offset timezone (the browsers filling this form
// run on Manila/UTC+8, where local midnight is the previous day in UTC).
// This server likely runs in UTC, so replicating the buggy formula HERE
// would not reproduce the same shift — instead this compares each renting
// customer's stored end_date against the correct (timezone-agnostic)
// start_date+days answer, computed purely from the Date object's own
// calendar fields with no ISO/UTC conversion at any point, and flags only
// records that are exactly one day short of it. A manually-typed date that
// happens to already be correct is never touched, and this stays safe to
// load repeatedly — already-corrected records won't match a second time.
function correctEndDate(startDate, days) {
  const d = new Date(startDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}
function oneDayBefore(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}
function findEndDateFix() {
  return getCustomers()
    .filter(c => c.status === 'renting' && c.start_date && c.end_date && c.days)
    .map(c => ({ c, shifted: correctEndDate(c.start_date, c.days) }))
    .filter(({ c, shifted }) => c.end_date === oneDayBefore(shifted));
}
app.get('/admin/fix-end-dates', requireAuth, (req, res) => {
  const affected = findEndDateFix();
  res.render('fix-end-dates', { affected, settings: getSiteSettings() });
});
app.post('/admin/fix-end-dates', requireAuth, (req, res) => {
  const affected = findEndDateFix();
  affected.forEach(({ c, shifted }) => {
    db.get('customers').find({ id: c.id }).assign({ end_date: shifted }).write();
  });
  res.redirect('/admin?tab=customers&msg=end_dates_fixed');
});

app.get('/admin/customers/edit/:id', requireAuth, (req, res) => {
  const customer = getCustomer(req.params.id);
  if (!customer) return res.redirect('/admin?tab=customers');
  const games = getGames().map(resolveGamePrices).sort((a, b) => a.title.localeCompare(b.title));
  const currentAssign = findAccountAssignmentForCustomer(customer.id);
  res.render('edit-customer', { customer, games, upcoming: getUpcoming(), settings: getSiteSettings(), accounts: getAccounts(), currentAssign });
});

app.post('/admin/customers/edit/:id', requireAuth, (req, res) => {
  const { customer_name, game_id, days, custom_days, account_type, start_date, end_date, price, status, notes, account_assign } = req.body;
  const actualDays = days === 'custom' ? (parseInt(custom_days) || 1) : (parseInt(days) || 7);
  const existing = getCustomer(req.params.id);
  if (!existing) return res.redirect('/admin?tab=customers&msg=error');
  const wasActive = existing.status === 'renting' || existing.status === 'bought';
  const isActive = status === 'renting' || status === 'bought';
  const wasUpcoming = String(existing.game_id).startsWith('upcoming_');
  const isUpcomingNew = String(game_id || existing.game_id).startsWith('upcoming_');

  // ── Sync linked account slot (dashboard) with this edit ──
  const customerId = parseInt(req.params.id);
  const finalCustomerName = (customer_name || existing.customer_name).trim();
  const finalEndDate = end_date || existing.end_date;
  const priorAssign = findAccountAssignmentForCustomer(customerId);
  const submittedAssign = account_assign !== undefined ? (account_assign || null) : priorAssign;
  let slotAssignFailed = false;
  if (!isActive) {
    // No longer renting/bought → free whatever slot was linked
    if (priorAssign) freeAccountSlotsForCustomer(customerId);
  } else if (submittedAssign !== priorAssign) {
    // Assignment target changed (or game/type changed under it) → free old, apply new
    if (priorAssign) freeAccountSlotsForCustomer(customerId);
    if (submittedAssign) {
      slotAssignFailed = !applyAccountAssignment(submittedAssign, { customerId, customerName: finalCustomerName, status, endDate: finalEndDate });
    }
  } else if (priorAssign) {
    // Same slot as before → refresh name/end date/status (renting ↔ bought), keep original start date
    slotAssignFailed = !refreshAccountAssignment(priorAssign, { customerName: finalCustomerName, endDate: finalEndDate, status });
  }
  if (slotAssignFailed) return res.redirect('/admin?tab=customers&msg=slot_unavailable');

  // Revert old game slot/trophy changes if was active
  if (wasActive && !wasUpcoming) {
    const oldGame = getGame(existing.game_id);
    if (oldGame) {
      db.get('games').find({ id: oldGame.id }).assign({
        available_slots: (oldGame.available_slots || 0) + 1
      }).write();
      if (existing.account_type === 'tr') adjustTrophySlots(oldGame.id, +1);
      else if (existing.account_type === 'ps4') adjustPs4Slots(oldGame.id, +1);
      else adjustNtSlots(oldGame.id, +1);
    }
  }
  // Apply new game slot/trophy changes if now active
  if (isActive && !isUpcomingNew) {
    const newGame = getGame(game_id);
    if (newGame) {
      db.get('games').find({ id: newGame.id }).assign({
        available_slots: Math.max(0, (newGame.available_slots || 0) - 1)
      }).write();
      const aType = account_type || existing.account_type || 'nt';
      if (aType === 'tr') adjustTrophySlots(newGame.id, -1);
      else if (aType === 'ps4') adjustPs4Slots(newGame.id, -1);
      else adjustNtSlots(newGame.id, -1);
    }
  }
  const newGame = !isUpcomingNew ? (getGame(game_id) || getGame(existing.game_id)) : null;
  const finalGameId = isUpcomingNew ? String(game_id) : (parseInt(game_id) || existing.game_id);

  // ── Game swap pricing: if the game changed (catalog → catalog, not a reservation),
  // price the new game at the submitted duration/type with the active promo applied,
  // and never let the recorded price drop below what was already paid — downgrades
  // aren't refunded, they just carry the original total forward.
  let finalPrice = price !== undefined && price !== '' ? (parseInt(price) || 0) : existing.price;
  const gameChanged = !wasUpcoming && !isUpcomingNew && newGame && newGame.id !== existing.game_id;
  if (gameChanged) {
    const settings = getSiteSettings();
    const ref = computeSwapReferencePrice(newGame, {
      days: actualDays,
      accountType: account_type || existing.account_type || 'nt',
      isBought: (status || existing.status) === 'bought',
      promo: settings.promo
    });
    if (ref) {
      const pricePaid = existing.price || 0;
      const topUp = Math.max(0, ref.price - pricePaid);
      finalPrice = Math.max(finalPrice, pricePaid);
      const swapEntry = {
        at: new Date().toISOString(),
        from_game_id: existing.game_id, from_game_title: existing.game_title,
        to_game_id: newGame.id, to_game_title: newGame.title,
        days: actualDays, account_type: account_type || existing.account_type || 'nt',
        price_before: pricePaid, new_game_price: ref.price, price_after: finalPrice,
        top_up: topUp, ps4_fallback: ref.ps4Fallback
      };
      db.get('customers').find({ id: parseInt(req.params.id) })
        .assign({ swap_history: [...(existing.swap_history || []), swapEntry] }).write();
    }
  }

  // An extension is performed by editing the customer and raising the price,
  // so a price increase IS the payment event. Record only the delta, dated
  // today — not the rental's start — so the money counts in the month it was
  // actually taken. The running `price` still ends up as the sum of payments.
  const prevPrice = existing.price || 0;
  const newPrice = parseInt(finalPrice) || 0;
  const existingPayments = Array.isArray(existing.payments) ? existing.payments.slice() : [];
  const deltaPayment = priceDeltaPayment(prevPrice, newPrice, { startDate: start_date || existing.start_date });
  if (deltaPayment) existingPayments.push(deltaPayment);

  db.get('customers').find({ id: parseInt(req.params.id) }).assign({
    customer_name: (customer_name || existing.customer_name).trim(),
    game_id: finalGameId,
    game_title: newGame ? newGame.title : existing.game_title,
    days: actualDays,
    account_type: account_type || existing.account_type,
    start_date: start_date || existing.start_date,
    end_date: end_date || existing.end_date,
    price: finalPrice,
    status: status || existing.status,
    notes: notes || '',
    payments: existingPayments,
  }).write();
  res.redirect('/admin?tab=customers&msg=customer_updated');
});

app.post('/admin/customers/status/:id', requireAuth, (req, res) => {
  const { status } = req.body;
  const existing = getCustomer(req.params.id);
  if (!existing) return res.redirect('/admin?tab=customers&msg=error');
  const wasActive = existing.status === 'renting' || existing.status === 'bought';
  const isActive = status === 'renting' || status === 'bought';
  const isUpcoming = String(existing.game_id).startsWith('upcoming_');
  if (wasActive !== isActive && !isUpcoming) {
    const game = getGame(existing.game_id);
    if (game) {
      const delta = isActive ? -1 : 1;
      db.get('games').find({ id: game.id }).assign({
        available_slots: Math.max(0, (game.available_slots || 0) + delta)
      }).write();
      if (existing.account_type === 'tr') adjustTrophySlots(game.id, delta);
      else if (existing.account_type === 'ps4') adjustPs4Slots(game.id, delta);
      else adjustNtSlots(game.id, delta);
    }
  }
  // Free linked account slot(s) when customer is no longer active
  if (wasActive && !isActive) {
    freeAccountSlotsForCustomer(parseInt(req.params.id));
  } else if (wasActive && isActive && existing.status !== status) {
    // Toggling renting ↔ bought on the same linked slot — keep slot.status in sync
    const linkedAssign = findAccountAssignmentForCustomer(parseInt(req.params.id));
    if (linkedAssign) refreshAccountAssignment(linkedAssign, { customerName: existing.customer_name, endDate: existing.end_date, status });
  }
  db.get('customers').find({ id: parseInt(req.params.id) }).assign({ status }).write();
  res.redirect('/admin?tab=customers&msg=customer_updated');
});

app.post('/admin/customers/delete/:id', requireAuth, (req, res) => {
  const existing = getCustomer(req.params.id);
  if (!existing) return res.redirect('/admin?tab=customers&msg=error');
  // Restore slot if was renting or bought (not reservation)
  if ((existing.status === 'renting' || existing.status === 'bought') && !String(existing.game_id).startsWith('upcoming_')) {
    const game = getGame(existing.game_id);
    if (game) {
      db.get('games').find({ id: game.id }).assign({
        available_slots: (game.available_slots || 0) + 1
      }).write();
      if (existing.account_type === 'tr') adjustTrophySlots(game.id, +1);
      else if (existing.account_type === 'ps4') adjustPs4Slots(game.id, +1);
      else adjustNtSlots(game.id, +1);
    }
  }
  freeAccountSlotsForCustomer(parseInt(req.params.id));
  db.get('customers').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?tab=customers&msg=customer_deleted');
});

// ── Accounts Dashboard ────────────────────────────────────────────────────────
app.get('/admin/accounts', requireAuth, (req, res) => {
  const allGames = getGames();
  const gamesById = {};
  allGames.forEach(g => { gamesById[g.id] = g; });
  const categories = getPriceCategories();
  const categoryById = {};
  categories.forEach(c => { categoryById[c.id] = c; });

  const accounts = getAccounts().map(a => {
    const slotView = {};
    ACCOUNT_SLOT_TYPES.forEach(t => {
      slotView[t] = { ...a.slots[t], days_left: slotDaysLeft(a.slots[t]) };
    });
    // Category = the price category of the first linked game (if any)
    const linkedGame = a.game_ids && a.game_ids.length ? gamesById[a.game_ids[0]] : null;
    const cat = linkedGame && linkedGame.price_category_id ? categoryById[linkedGame.price_category_id] : null;
    return { ...a, slotView, category_id: cat ? cat.id : null, category_name: cat ? cat.name : 'Uncategorized' };
  });

  // Group by category name, sorted alphabetically by account label within each group
  const groupsMap = {};
  accounts.forEach(a => {
    if (!groupsMap[a.category_name]) groupsMap[a.category_name] = [];
    groupsMap[a.category_name].push(a);
  });
  const groupNames = sortCategoryNames(Object.keys(groupsMap));
  const groups = groupNames.map(name => ({
    name,
    accounts: groupsMap[name].sort((a, b) => a.label.localeCompare(b.label))
  }));

  // Summary stats
  const stats = { total: 0, open: 0, rented: 0, ending: 0 };
  accounts.forEach(a => ACCOUNT_SLOT_TYPES.forEach(t => {
    const s = a.slotView[t];
    if (!s.enabled) return;
    stats.total++;
    if (s.status === 'open') stats.open++;
    if (s.status === 'rented') { stats.rented++; if (s.days_left != null && s.days_left <= 3) stats.ending++; }
  }));
  const games = allGames.sort((a, b) => a.title.localeCompare(b.title));
  res.render('accounts', {
    accounts, groups, stats, games,
    customers: getCustomers(),
    settings: getSiteSettings(),
    SLOT_TYPES: ACCOUNT_SLOT_TYPES,
    STATUSES: ACCOUNT_STATUSES,
    msg: req.query.msg || ''
  });
});

function parseGameIds(raw) {
  if (Array.isArray(raw)) return raw.map(x => parseInt(x)).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return raw.split(',').map(x => parseInt(x)).filter(Boolean);
  return [];
}

// Shared category display order (New Games → Deluxe → Special → Regular → Uncategorized last)
const PRICE_CATEGORY_ORDER = ['new games', 'deluxe', 'special', 'regular'];
function sortCategoryNames(names) {
  return names.sort((a, b) => {
    if (a === 'Uncategorized') return 1;
    if (b === 'Uncategorized') return -1;
    const ai = PRICE_CATEGORY_ORDER.indexOf(a.toLowerCase());
    const bi = PRICE_CATEGORY_ORDER.indexOf(b.toLowerCase());
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

// A game counts as "new" for a fixed 11 days after created_at by default — not tied to
// calendar month boundaries, so a game added on the 28th still gets the full window
// instead of losing its NEW badge two days later at month-end. A game's own
// new_window_days overrides this default when set (admin-configurable per game). Same
// rule duplicated (with this comment) in partials/game-card.ejs and admin.ejs's Added
// column — keep all three in sync.
const NEW_GAME_WINDOW_DAYS = 11;
function isAddedThisMonth(game) {
  if (!game.created_at) return false;
  const windowDays = game.new_window_days || NEW_GAME_WINDOW_DAYS;
  const daysSinceAdded = Math.floor((Date.now() - new Date(game.created_at).getTime()) / 86400000);
  return daysSinceAdded < windowDays;
}

// Groups every catalog game by its price category (New Games/Deluxe/Special/Regular/Uncategorized),
// with effective prices resolved (category price or the game's own custom price).
// `excludeIds` pulls games out of their normal category — used to split this month's
// new arrivals into their own poster group instead of duplicating them here too.
function gamesByPriceCategory(excludeIds) {
  const skip = excludeIds || new Set();
  const categories = getPriceCategories();
  const categoryById = {};
  categories.forEach(c => { categoryById[c.id] = c; });
  const groupsMap = {};
  getGames().map(resolveGamePrices).filter(g => !skip.has(g.id)).forEach(g => {
    const cat = g.price_category_id ? categoryById[g.price_category_id] : null;
    const name = cat ? cat.name : 'Uncategorized';
    if (!groupsMap[name]) groupsMap[name] = [];
    groupsMap[name].push(g);
  });
  return sortCategoryNames(Object.keys(groupsMap)).map(name => ({
    name,
    games: groupsMap[name].sort((a, b) => a.title.localeCompare(b.title))
  }));
}

// ── Poster Generator (admin) ──────────────────────────────────────────────────
// Turns a flat game list into the {density, pages, count, missingCovers} shape a
// poster group needs — shared by the price-category groups and the New Arrivals group.
function buildPosterGroup(name, games, discount10) {
  const density = games.length <= 4 ? 'large' : 'compact';
  const perPage = density === 'large' ? 4 : 12;
  const gamesWithFromPrice = games.map(game => {
    const prices = [game.nt_price_7d, game.tr_price_7d].filter(p => p > 0);
    const rawFrom = prices.length ? Math.min(...prices) : null;
    const fromPrice = rawFrom != null && discount10 > 0 ? Math.round(rawFrom * (1 - discount10 / 100)) : rawFrom;
    return { ...game, fromPrice };
  });
  const pages = [];
  for (let i = 0; i < gamesWithFromPrice.length; i += perPage) pages.push(gamesWithFromPrice.slice(i, i + perPage));
  const missingCovers = games.filter(game => !game.cover_image).map(game => game.title);
  return { name, density, pages, count: games.length, missingCovers };
}
app.get('/admin/posters', requireAuth, (req, res) => {
  const settings = getSiteSettings();
  const promo = settings.promo;
  // Weekly is always the cheapest tier, so it's what "From ₱X" shows —
  // apply that duration's promo discount (if any) so the poster stays accurate.
  const discount10 = getPromoDiscountPct(promo, RENTAL_DURATIONS[0].days);
  // Games added this month get pulled into their own "New Arrivals" poster instead of
  // sitting mixed into their price-category poster — same "added this month" rule as
  // the site-wide NEW badge, so the two stay consistent.
  const newArrivalGames = getGames().map(resolveGamePrices).filter(isAddedThisMonth).sort((a, b) => a.title.localeCompare(b.title));
  const newArrivalIds = new Set(newArrivalGames.map(g => g.id));
  const groups = gamesByPriceCategory(newArrivalIds);
  const posterGroups = groups.map(g => buildPosterGroup(g.name, g.games, discount10));
  if (newArrivalGames.length) posterGroups.unshift(buildPosterGroup('🆕 New Arrivals', newArrivalGames, discount10));
  // Which durations currently have an active discount, for the poster's promo banner
  const activePromos = promo.enabled ? PROMO_DURATIONS.filter(d => getPromoDiscountPct(promo, d) > 0).map(d => ({ days: d, pct: getPromoDiscountPct(promo, d) })) : [];
  res.render('posters', { posterGroups, settings, activePromos, msg: req.query.msg || '' });
});

// Custom poster background (applies to every category poster, replacing the flat gradient)
app.post('/admin/posters/background', requireAuth, uploadPosterBg.single('poster_background'), (req, res) => {
  if (!req.file) return res.redirect('/admin/posters?msg=error');
  const settings = getSiteSettings();
  if (settings.poster_background_path) {
    const oldFp = path.join(uploadsDir, path.basename(settings.poster_background_path));
    if (fs.existsSync(oldFp)) { try { fs.unlinkSync(oldFp); } catch (e) {} }
  }
  db.set('site_settings.poster_background_path', '/uploads/' + req.file.filename).write();
  res.redirect('/admin/posters?msg=bg_saved');
});
app.post('/admin/posters/background/remove', requireAuth, (req, res) => {
  const settings = getSiteSettings();
  if (settings.poster_background_path) {
    const fp = path.join(uploadsDir, path.basename(settings.poster_background_path));
    if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (e) {} }
  }
  db.set('site_settings.poster_background_path', '').write();
  res.redirect('/admin/posters?msg=bg_removed');
});

app.post('/admin/accounts/add', requireAuth, (req, res) => {
  const { label, games_text, game_ids, note, email, price_permanent_tr, price_permanent_nt,
    enable_trophy, enable_non_trophy, enable_ps4_primary, for_sale, public_name } = req.body;
  if (!label || !label.trim()) return res.redirect('/admin/accounts?msg=error');
  db.get('accounts').push({
    id: newAccountId(),
    label: label.trim(),
    games_text: games_text || '',
    game_ids: parseGameIds(game_ids),
    note: note || '',
    email: (email || '').trim(),
    price_permanent_tr: parseInt(price_permanent_tr) || 5000,
    price_permanent_nt: parseInt(price_permanent_nt) || 4500,
    for_sale: for_sale === 'on',
    public_name: (public_name || '').trim(),
    slots: {
      trophy: blankSlot(enable_trophy !== undefined),
      non_trophy: blankSlot(enable_non_trophy !== undefined),
      ps4_primary: blankSlot(enable_ps4_primary !== undefined)
    },
    created_at: new Date().toISOString()
  }).write();
  res.redirect('/admin/accounts?msg=account_added');
});

app.post('/admin/accounts/edit/:id', requireAuth, (req, res) => {
  const { label, games_text, game_ids, note, email, price_permanent_tr, price_permanent_nt,
    enable_trophy, enable_non_trophy, enable_ps4_primary, for_sale, public_name } = req.body;
  const existing = getAccount(req.params.id);
  if (!existing) return res.redirect('/admin/accounts?msg=error');
  const slots = existing.slots;
  slots.trophy.enabled = enable_trophy !== undefined;
  slots.non_trophy.enabled = enable_non_trophy !== undefined;
  slots.ps4_primary.enabled = enable_ps4_primary !== undefined;
  db.get('accounts').find({ id: parseInt(req.params.id) }).assign({
    label: (label || existing.label).trim(),
    games_text: games_text !== undefined ? games_text : existing.games_text,
    game_ids: parseGameIds(game_ids),
    note: note !== undefined ? note : existing.note,
    email: email !== undefined ? email.trim() : existing.email,
    price_permanent_tr: price_permanent_tr !== undefined && price_permanent_tr !== '' ? (parseInt(price_permanent_tr) || 0) : existing.price_permanent_tr,
    price_permanent_nt: price_permanent_nt !== undefined && price_permanent_nt !== '' ? (parseInt(price_permanent_nt) || 0) : existing.price_permanent_nt,
    for_sale: for_sale === 'on',
    public_name: public_name !== undefined ? public_name.trim() : existing.public_name,
    slots
  }).write();
  res.redirect('/admin/accounts?msg=account_updated');
});

app.post('/admin/accounts/delete/:id', requireAuth, (req, res) => {
  const account = getAccount(req.params.id);
  if (account) {
    // Unlink any customers whose active slot pointed at this account, so no customer
    // record is left dangling on a deleted account.
    ACCOUNT_SLOT_TYPES.forEach(t => {
      const slot = account.slots[t];
      if (slot && slot.renter_id) {
        db.get('customers').find({ id: slot.renter_id }).assign({ status: 'done' }).write();
      }
    });
  }
  db.get('accounts').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin/accounts?msg=account_deleted');
});

// Update a single slot's status / renter / expiration
app.post('/admin/accounts/:id/slot/:type', requireAuth, (req, res) => {
  const { status, renter_id, renter_name, days, end_date } = req.body;
  const type = req.params.type;
  const account = getAccount(req.params.id);
  if (!account || !ACCOUNT_SLOT_TYPES.includes(type)) return res.redirect('/admin/accounts?msg=error');
  const slot = account.slots[type];
  const newStatus = ACCOUNT_STATUSES.includes(status) ? status : slot.status;

  if (newStatus === 'rented' || newStatus === 'buyed') {
    slot.status = newStatus;
    const cust = renter_id ? getCustomer(renter_id) : null;
    slot.renter_id = cust ? cust.id : null;
    slot.renter_name = cust ? cust.customer_name : (renter_name || '');
    if (newStatus === 'rented') {
      if (end_date) slot.end = end_date;
      else if (days) {
        const d = new Date(); d.setDate(d.getDate() + (parseInt(days) || 0));
        slot.end = d.toISOString().slice(0, 10);
      }
      slot.start = slot.start || new Date().toISOString().slice(0, 10);
    } else { slot.start = ''; slot.end = ''; }
  } else {
    // open / na / maintenance → clear renter + dates
    slot.status = newStatus;
    slot.renter_id = null; slot.renter_name = ''; slot.start = ''; slot.end = '';
  }
  account.slots[type] = slot;
  db.get('accounts').find({ id: parseInt(req.params.id) }).assign({ slots: account.slots }).write();
  res.redirect('/admin/accounts?msg=slot_updated');
});

// ── Month Logs (dashboard drill-down: ad count/spend + screenshots) ───────────
// Upsert by YYYY-MM key. Existing images are kept; newly uploaded ones are
// appended, capped at 6 total per month.
app.post('/admin/month-log', requireAuth, upload.array('images', 6), (req, res) => {
  const { month_key, ad_count, ad_spend, note } = req.body;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month_key || '')) return res.redirect('/admin?tab=customers&msg=error');
  const existing = getMonthLog(month_key);
  const newImages = (req.files || []).map(f => '/uploads/' + f.filename);
  const images = [...(existing ? existing.images : []), ...newImages].slice(0, 6);
  const entry = {
    key: month_key,
    ad_count: parseInt(ad_count) || 0,
    ad_spend: parseInt(ad_spend) || 0,
    note: (note || '').trim(),
    images,
    updated_at: new Date().toISOString()
  };
  if (existing) db.get('month_logs').find({ key: month_key }).assign(entry).write();
  else db.get('month_logs').push(entry).write();
  res.redirect('/admin?tab=customers&month=' + month_key + '&msg=month_log_saved');
});

app.post('/admin/month-log/image/delete', requireAuth, (req, res) => {
  const { month_key, image_path } = req.body;
  const existing = getMonthLog(month_key);
  if (!existing) return res.redirect('/admin?tab=customers&msg=error');
  const fp = path.join(uploadsDir, path.basename(image_path || ''));
  if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (e) {} }
  const images = existing.images.filter(img => img !== image_path);
  db.get('month_logs').find({ key: month_key }).assign({ images }).write();
  res.redirect('/admin?tab=customers&month=' + month_key + '&msg=month_log_saved');
});

app.post('/admin/month-log/delete', requireAuth, (req, res) => {
  const { month_key } = req.body;
  const existing = getMonthLog(month_key);
  if (existing) {
    existing.images.forEach(img => {
      const fp = path.join(uploadsDir, path.basename(img));
      if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (e) {} }
    });
    db.get('month_logs').remove({ key: month_key }).write();
  }
  res.redirect('/admin?tab=customers&msg=month_log_deleted');
});

// ── Customer Import / Sample ──────────────────────────────────────────────────

// Download sample Excel template
app.get('/admin/customers/sample', requireAuth, (req, res) => {
  const wb = XLSX.utils.book_new();
  const sampleRows = [
    ['customer_name','game_title','days','account_type','start_date','end_date','price','status','notes'],
    ['Juan dela Cruz','God of War Ragnarök','30','nt','2025-06-01','2025-07-01','349','done','Paid via GCash'],
    ['Maria Santos','Spider-Man 2','15','tr','2025-06-10','2025-06-25','249','renting','With ₱100 deposit'],
    ['Pedro Reyes','Resident Evil 4','10','ps4','2025-06-15','2025-06-25','149','done',''],
    ['Ana Lim','Elden Ring','30','nt','2025-06-20','','0','reservation','Upcoming reservation'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sampleRows);
  // Column widths
  ws['!cols'] = [20,30,8,14,14,14,10,14,30].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws, 'Customers');

  // Notes sheet
  const notesRows = [
    ['FIELD','ACCEPTED VALUES','NOTES'],
    ['customer_name','Any text','Required'],
    ['game_title','Exact game title from your library (or upcoming game title)','Required — matched by title'],
    ['days','10, 15, 30, or any number','Use 0 for reservation/bought'],
    ['account_type','nt, tr, ps4','nt=Non-Trophy  tr=Trophy  ps4=PS4 Primary'],
    ['start_date','YYYY-MM-DD  e.g. 2025-06-01','Leave blank if unknown'],
    ['end_date','YYYY-MM-DD  e.g. 2025-07-01','Leave blank for reservation/bought'],
    ['price','Number only, no ₱ sign','e.g. 349'],
    ['status','renting, done, bought, reservation',''],
    ['notes','Any text','Optional'],
  ];
  const wsNotes = XLSX.utils.aoa_to_sheet(notesRows);
  wsNotes['!cols'] = [18,52,30].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, wsNotes, 'Instructions');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="customers_import_sample.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// Import customers from Excel
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.post('/admin/customers/import', requireAuth, importUpload.single('import_file'), (req, res) => {
  if (!req.file) return res.redirect('/admin?tab=customers&msg=error');
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 2) return res.redirect('/admin?tab=customers&msg=error');

    // Detect header row (first row)
    const headers = rows[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g,'_'));
    const col = h => headers.indexOf(h);

    const games = getGames();
    const upcomingGames = getUpcoming();
    let imported = 0, skipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const get = (field) => {
        const idx = col(field);
        return idx >= 0 ? String(row[idx] || '').trim() : '';
      };

      const customer_name = get('customer_name');
      if (!customer_name) { skipped++; continue; }

      const game_title_raw = get('game_title');
      const status = get('status') || 'done';

      // Match game by title (case-insensitive)
      let game_id = null, game_title = game_title_raw;
      const regularMatch = games.find(g => g.title.toLowerCase() === game_title_raw.toLowerCase());
      if (regularMatch) {
        game_id = regularMatch.id;
        game_title = regularMatch.title;
      } else {
        // Try upcoming games
        const upMatch = upcomingGames.find(g => g.title.toLowerCase() === game_title_raw.toLowerCase());
        if (upMatch) {
          game_id = 'upcoming_' + upMatch.id;
          game_title = upMatch.title;
        } else {
          // Store title as-is with null id — import anyway
          game_id = null;
          game_title = game_title_raw;
        }
      }

      // Parse date — handle both string and JS Date from xlsx
      const parseDate = (val) => {
        if (!val) return '';
        if (val instanceof Date) return val.toISOString().slice(0, 10);
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        return isNaN(d) ? '' : d.toISOString().slice(0, 10);
      };

      const days = parseInt(get('days')) || 0;
      const account_type = get('account_type') || 'nt';
      const start_date = parseDate(row[col('start_date')]);
      const end_date = parseDate(row[col('end_date')]);
      const price = parseInt(get('price')) || 0;
      const notes = get('notes');

      const id = newCustomerId();
      db.get('customers').push({
        id,
        customer_name,
        game_id,
        game_title,
        days,
        account_type,
        start_date,
        end_date,
        price,
        status,
        notes,
        created_at: new Date().toISOString()
      }).write();

      // Adjust slots for active statuses on regular games
      if ((status === 'renting' || status === 'bought') && regularMatch) {
        const g = getGame(regularMatch.id);
        if (g) {
          db.get('games').find({ id: g.id }).assign({
            available_slots: Math.max(0, (g.available_slots || 0) - 1),
            renters: (g.renters || 0) + 1
          }).write();
          if (account_type === 'tr') adjustTrophySlots(g.id, -1);
          else if (account_type === 'ps4') adjustPs4Slots(g.id, -1);
          else adjustNtSlots(g.id, -1);
        }
      }
      imported++;
    }

    res.redirect('/admin?tab=customers&msg=imported_' + imported + '_skipped_' + skipped);
  } catch (e) {
    console.error('Import error:', e);
    res.redirect('/admin?tab=customers&msg=import_error');
  }
});

// Price category CRUD
app.post('/admin/price-categories/add', upload.single('image'), requireAuth, async (req, res) => {
  const { name, nt_price_7d, nt_price_30d, tr_price_7d, tr_price_30d,
    image_width, image_height, image_opacity, image_blend, bg_color, title_color, title_size } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin?msg=error');
  const image = req.file ? await processUploadedImage(req.file) : '';
  db.get('price_categories').push({
    id: newPriceCategoryId(),
    name: name.trim(),
    nt_price_7d: parseInt(nt_price_7d) || 149,
    nt_price_30d: parseInt(nt_price_30d) || 349,
    tr_price_7d: parseInt(tr_price_7d) || 199,
    tr_price_30d: parseInt(tr_price_30d) || 399,
    image,
    // image_width is how far the picture reaches across the card in the Split Art
    // layout. image_height / image_blend are kept for older records but that layout
    // always bleeds the art full-height, so they no longer affect rendering.
    image_width: Math.min(90, Math.max(20, parseInt(image_width) || 52)),
    image_height: Math.min(150, Math.max(10, parseInt(image_height) || 100)),
    image_opacity: Math.min(100, Math.max(0, parseInt(image_opacity) != null && !isNaN(parseInt(image_opacity)) ? parseInt(image_opacity) : 100)),
    image_blend: image_blend === 'on',
    bg_color: /^#[0-9a-fA-F]{6}$/.test(bg_color) ? bg_color : '#F0A500',
    title_color: /^#[0-9a-fA-F]{6}$/.test(title_color) ? title_color : '#ffffff',
    title_size: Math.min(40, Math.max(10, parseInt(title_size) || 18)),
  }).write();
  res.redirect('/admin?msg=cat_added');
});

app.post('/admin/price-categories/edit/:id', upload.single('image'), requireAuth, async (req, res) => {
  const { name, nt_price_7d, nt_price_30d, tr_price_7d, tr_price_30d,
    image_width, image_height, image_opacity, image_blend, bg_color, title_color, title_size, remove_image } = req.body;
  const cat = getPriceCategory(req.params.id);
  if (!cat) return res.redirect('/admin?msg=error');
  const image = req.file ? await processUploadedImage(req.file) : (remove_image === 'on' ? '' : cat.image || '');
  db.get('price_categories').find({ id: parseInt(req.params.id) }).assign({
    name: (name || cat.name).trim(),
    nt_price_7d: parseInt(nt_price_7d) || cat.nt_price_7d,
    nt_price_30d: parseInt(nt_price_30d) || cat.nt_price_30d,
    tr_price_7d: parseInt(tr_price_7d) || cat.tr_price_7d,
    tr_price_30d: parseInt(tr_price_30d) || cat.tr_price_30d,
    image,
    image_width: Math.min(90, Math.max(20, parseInt(image_width) || cat.image_width || 52)),
    image_height: Math.min(150, Math.max(10, parseInt(image_height) || cat.image_height || 90)),
    image_opacity: Math.min(100, Math.max(0, !isNaN(parseInt(image_opacity)) ? parseInt(image_opacity) : (cat.image_opacity != null ? cat.image_opacity : 100))),
    image_blend: image_blend === 'on',
    bg_color: /^#[0-9a-fA-F]{6}$/.test(bg_color) ? bg_color : (cat.bg_color || '#F0A500'),
    title_color: /^#[0-9a-fA-F]{6}$/.test(title_color) ? title_color : (cat.title_color || '#ffffff'),
    title_size: Math.min(40, Math.max(10, parseInt(title_size) || cat.title_size || 18)),
  }).write();
  res.redirect('/admin?msg=cat_updated');
});

app.post('/admin/price-categories/delete/:id', requireAuth, (req, res) => {
  // Remove category link from all games that use it
  db.get('games').filter({ price_category_id: parseInt(req.params.id) }).each(g => {
    db.get('games').find({ id: g.id }).assign({ price_category_id: null }).write();
  }).value();
  db.get('price_categories').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?msg=cat_deleted');
});

app.get('/admin/mongo-status', requireAuth, async (req, res) => {
  if (!process.env.MONGODB_URI) return res.json({ status: 'no MONGODB_URI env var set' });
  try {
    const mdb = await _getMongoDb();
    const doc = await mdb.collection('state').findOne({ _id: 'db' }, { projection: { _id: 1 } });
    res.json({ status: 'connected ✅', savedDoc: doc ? 'yes' : 'no saved doc yet' });
  } catch (e) {
    res.json({ status: 'error ❌', message: e.message });
  }
});

// ── Meta / Facebook Product Catalog Feed ──────────────────────────────────────
// Give Meta this URL: https://your-railway-domain.up.railway.app/feed/meta.csv
app.get('/api/games-export', requireAuth, (req, res) => {
  const cats = getPriceCategories();
  const catMap = {};
  cats.forEach(c => { catMap[c.id] = c; });
  function resolve(g) {
    if (!g.price_category_id) return g;
    const cat = catMap[g.price_category_id];
    if (!cat) return g;
    return Object.assign({}, g, {
      nt_price_7d: cat.nt_price_7d || g.nt_price_7d,
      nt_price_10d: cat.nt_price_10d || g.nt_price_10d,
      nt_price_15d: cat.nt_price_15d || g.nt_price_15d,
      nt_price_30d: cat.nt_price_30d || g.nt_price_30d,
      tr_price_7d: cat.tr_price_7d || g.tr_price_7d,
      tr_price_10d: cat.tr_price_10d || g.tr_price_10d,
      tr_price_15d: cat.tr_price_15d || g.tr_price_15d,
      tr_price_30d: cat.tr_price_30d || g.tr_price_30d,
    });
  }
  res.json({ games: getGames().map(resolve), upcoming: getUpcoming() });
});

app.get('/feed/meta.csv', (req, res) => {
  const siteUrl = process.env.SITE_URL || 'https://your-domain.up.railway.app';
  const games = getGames().filter(g => !g.upcoming);
  const rows = [
    ['id','title','description','availability','condition','price','link','image_link','brand','google_product_category']
  ];
  games.forEach(g => {
    const price = g.price_7 || g.price_14 || g.price_30 || 0;
    rows.push([
      g.id,
      g.title,
      (g.description || g.title).replace(/"/g, '""'),
      (g.non_trophy_slots > 0 || g.trophy_slots > 0 || g.ps4_primary_slots > 0) ? 'in stock' : 'out of stock',
      'new',
      price + ' PHP',
      siteUrl + '/browse',
      g.cover_image ? (g.cover_image.startsWith('http') ? g.cover_image : siteUrl + g.cover_image) : '',
      'PlayStation Hub',
      '1249'  // Video Games category
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g,'""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(csv);
});
// ═══════════════════════════════════════════════════════════════════════════
// MESSENGER WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════

const VERIFY_TOKEN    = process.env.MESSENGER_VERIFY_TOKEN || 'playstation_hub_verify';
const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_TOKEN || '';

// Webhook verification (Meta calls this when you set up the webhook)
app.get('/webhook', (req, res) => {
  if (
    req.query['hub.mode']       === 'subscribe' &&
    req.query['hub.verify_token'] === VERIFY_TOKEN
  ) {
    console.log('✅ Messenger webhook verified');
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// Receive messages
app.post('/webhook', express.json(), (req, res) => {
  res.sendStatus(200); // ack immediately

  const body = req.body;
  if (body.object !== 'page') return;

  body.entry?.forEach(entry => {
    entry.messaging?.forEach(event => {
      if (event.message && event.message.is_echo) return;
      const senderId = event.sender?.id;
      if (!senderId) return;

      // A customer arriving from m.me/<page>?ref=PH-1234 produces a referral —
      // either a standalone `referral` event on an existing thread, or one
      // nested in the `postback` when they tap Get Started on a new thread.
      // This pairing of ref and PSID is the only way the app ever learns which
      // Facebook thread belongs to which order, and it cannot be recovered
      // afterwards, so it is recorded even though nothing sends messages yet.
      const rawRef = event.referral?.ref || event.postback?.referral?.ref;
      if (rawRef) {
        const orderRef = orders.parseOrderRef(rawRef);
        if (orderRef) {
          orders.linkPsid(orderRef, senderId)
            .then(ok => console.log('[order psid]', orderRef, ok ? 'linked' : 'no matching order'))
            .catch(e => console.error('[order psid]', e.message));
        }
      }

      // Recurring Notifications opt-in confirmation arrives as event.optin
      // (Meta's current shape for this button type) with the full grant
      // details; a decline is a normal postback with the payload this bot
      // sets on its own "No thanks" quick reply. The entire raw event is
      // stored on opt-in — see the Global Constraint on raw_optin_payload for
      // why only a subset is not stored instead.
      if (event.optin) {
        const existingOptin = db.get('notification_optins').find({ psid: senderId, topic: 'monthly_promo' }).value();
        if (existingOptin) {
          db.get('notification_optins').find({ psid: senderId, topic: 'monthly_promo' }).assign({
            opted_in_at: new Date().toISOString(),
            raw_optin_payload: event.optin,
            status: 'active',
            last_error: null,
            last_attempt_at: null
          }).write();
        } else {
          db.get('notification_optins').push({
            psid: senderId,
            opted_in_at: new Date().toISOString(),
            frequency: 'MONTHLY',
            topic: 'monthly_promo',
            raw_optin_payload: event.optin,
            status: 'active',
            last_sent_at: null,
            last_error: null,
            last_attempt_at: null
          }).write();
        }
        console.log('[notif optin] confirmed for psid=' + senderId);
      }

      // Everything below this point is the existing chat bot, which only
      // handles real inbound text.
      if (!event.message) return;

      // Save/update PSID so we can blast later. Runs for every inbound
      // message, decline quick-replies included — this contact-tracking
      // must never sit below the decline early-return below, or a person
      // who taps "No thanks" is silently excluded from messenger_contacts
      // (and therefore the 24h Auto Blast pool) despite having messaged us.
      const existingContact = db.get('messenger_contacts').find({ psid: senderId }).value();
      if (!existingContact) {
        db.get('messenger_contacts').push({ psid: senderId, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() }).write();
      } else {
        db.get('messenger_contacts').find({ psid: senderId }).assign({ last_seen: new Date().toISOString() }).write();
      }

      // A tapped "No thanks" quick reply arrives as event.message.quick_reply,
      // not event.postback (that shape is reserved for Structured
      // Messages/persistent-menu/Get-Started taps). Handle and return before
      // this falls through to the bot's normal text handling below.
      if (event.message.quick_reply?.payload === 'NOTIF_DECLINE') {
        console.log('[notif optin] declined by psid=' + senderId);
        return;
      }
      const text = (event.message.text || '').toLowerCase().trim();
      handleMessage(senderId, text)
        .then(() => {
          // Offer once per contact, after the bot's real reply — never
          // instead of it, never woven into handleMessage's own branches.
          const contact = db.get('messenger_contacts').find({ psid: senderId }).value();
          if (contact && !contact.notif_offered) {
            setTimeout(() => {
              sendNotificationOptinOffer(senderId);
              markNotifOffered(senderId);
            }, 1500);
          }
        })
        .catch(e => console.error('[handleMessage]', e));
    });
  });
});

function sendMessage(recipientId, messageData, cb) {
  if (!PAGE_ACCESS_TOKEN) return;
  const https = require('https');
  const payload = JSON.stringify({ recipient: { id: recipientId }, message: messageData });
  const options = {
    hostname: 'graph.facebook.com',
    path: '/v19.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  };
  const req2 = https.request(options, (res2) => {
    let data = '';
    res2.on('data', chunk => { data += chunk; });
    res2.on('end', () => {
      if (res2.statusCode !== 200) console.error('Messenger API error:', res2.statusCode, data);
      if (cb) cb();
    });
  });
  req2.on('error', e => console.error('Messenger send error:', e));
  req2.write(payload);
  req2.end();
}

function sendText(recipientId, text) {
  sendMessage(recipientId, { text });
}

function sendImage(recipientId, imageUrl) {
  sendMessage(recipientId, {
    attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } }
  });
}

// Offers the Recurring Notifications opt-in once per contact. The button's
// exact field names (frequency key, token delivery shape) are Meta's current
// Messenger Platform "Recurring Notifications" request format as of this
// writing — this has changed shape across platform versions before, so this
// function is intentionally isolated: if Meta's actual expected payload
// differs, only this one function needs correcting, nothing else in the bot.
function sendNotificationOptinOffer(recipientId) {
  sendMessage(recipientId, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [{
          title: '🔔 Monthly Game Drops & Promos',
          subtitle: 'Want a heads-up when new games and promos land each month? No spam, one message a month.',
          buttons: [{
            type: 'notification_messages',
            title: 'Yes, notify me!',
            payload: 'NOTIF_OPTIN',
            notification_messages_frequency: 'MONTHLY',
            notification_messages_reoptin: 'PUSH'
          }]
        }]
      }
    }
  });
  // The "No thanks" option is a quick reply on a separate follow-up text —
  // Messenger's notification_messages button type does not support a second,
  // declining button alongside it in the same template element.
  sendMessage(recipientId, {
    text: 'Or if you\'d rather not get monthly updates, that\'s fine too:',
    quick_replies: [{ content_type: 'text', title: 'No thanks', payload: 'NOTIF_DECLINE' }]
  });
}

function markNotifOffered(psid) {
  const existing = db.get('messenger_contacts').find({ psid }).value();
  if (existing) {
    db.get('messenger_contacts').find({ psid }).assign({ notif_offered: true }).write();
  } else {
    db.get('messenger_contacts').push({ psid, first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), notif_offered: true }).write();
  }
}

function getActiveOptins() {
  return db.get('notification_optins').filter({ status: 'active' }).value();
}

async function handleMessage(senderId, text) {
  const games = getGames();
  const upcoming = getUpcoming();
  const SITE = process.env.SITE_URL || 'https://playstation-hub-production.up.railway.app';

  // ── HELP / GREETING ──────────────────────────────────────────────────────
  if (!text || /^(hi|hello|hey|uy|oi|sup|start|help|menu|kamusta|good morning|good afternoon|good evening|musta|helo|hellow|helow)/.test(text)) {
    return sendText(senderId,
      '👋 Hi! Welcome to PlayStation Hub!\n\n' +
      'Here\'s what I can help you with:\n\n' +
      '🎮 Type "games" — see all available games\n' +
      '🔜 Type "coming soon" — see upcoming games\n' +
      '🔍 Type a game name — check price & availability\n' +
      '💰 Type "prices" — see pricing guide\n' +
      '📋 Type "how to rent" — step-by-step rental guide\n' +
      '♾️ Type "buy" — permanent access info\n' +
      '📞 Type "contact" — talk to a human\n\n' +
      'Browse all games 👉 ' + SITE + '/browse'
    );
  }

  // ── HOW TO RENT / PROCESS ────────────────────────────────────────────────
  if (/how.*(rent|order|borrow|get|kumuha|mag|process|works?|start|begin)|pano|paano|step|guide|tutorial|procedure/.test(text)) {
    return sendText(senderId,
      '📋 How to Rent at PlayStation Hub\n\n' +
      '𝟭. Choose a game\n' +
      '   Browse our games 👉 ' + SITE + '/browse\n\n' +
      '𝟮. Pick your account type\n' +
      '   🎮 Non-Trophy — play on our account\n' +
      '   🏆 Trophy — earn trophies on your own PSN\n\n' +
      '𝟯. Choose rental duration\n' +
      '   ⏱ Weekly | Monthly\n\n' +
      '𝟰. Message us here to confirm\n' +
      '   We\'ll set up your account access!\n\n' +
      '𝟱. Pay via GCash & enjoy! 🎉\n\n' +
      '✨ BONUS: 3 hours FREE trial before you commit!\n\n' +
      '💬 Ready to rent? Just tell me which game you want! 😊'
    );
  }

  // ── SELL GAMES / BUY PERMANENT ───────────────────────────────────────────
  if (/sell|nagbebenta|ibebenta|nabibili|pabili|for sale/.test(text)) {
    const buyGames = games.filter(g => (g.buy_nt_price || 0) > 0 || (g.buy_tr_price || 0) > 0);
    const s = getSiteSettings();
    const promo = s.promo || {};
    let msg = '✅ Yes! We offer Permanent Access (Buy) on select games!\n\n';
    msg += '♾️ PERMANENT ACCESS — One-time payment, play forever!\n\n';
    if (buyGames.length > 0) {
      msg += '🎮 Games available for purchase:\n';
      buyGames.slice(0, 8).forEach(g => {
        msg += `• ${g.title}`;
        if (g.buy_nt_price) msg += ` — NT: ₱${g.buy_nt_price}`;
        if (g.buy_tr_price) msg += ` / TR: ₱${g.buy_tr_price}`;
        msg += '\n';
      });
      if (buyGames.length > 8) msg += `  ...and ${buyGames.length - 8} more\n`;
    } else {
      msg += '🎮 Select games available — message us for current titles!\n';
    }
    if (promo.buy_promo_enabled && promo.buy_promo_pct > 0) {
      msg += `\n🔥 BUY PROMO: ${promo.buy_promo_pct}% OFF right now!\n`;
    }
    msg += '\n✨ FREE 3-hour trial before you buy!\n';
    msg += '\n👉 See all: ' + SITE + '/browse\n';
    msg += '💬 Tell me which game you want to buy!';
    return sendText(senderId, msg);
  }

  // ── BUY PERMANENT ────────────────────────────────────────────────────────
  if (/^buy|permanent|lifetime|forever|kahit kailan|sarili|own/.test(text)) {
    return sendText(senderId,
      '♾️ Buy Permanent Access — PlayStation Hub\n\n' +
      'Own a game slot forever with a one-time payment!\n\n' +
      '🎮 Non-Trophy Permanent\n' +
      '   Play on our account, no time limit\n\n' +
      '🏆 Trophy Permanent\n' +
      '   Earn trophies on YOUR own PSN account\n\n' +
      '✨ Benefits:\n' +
      '• One-time payment, play forever\n' +
      '• No monthly fees\n' +
      '• 3 hours FREE trial before you buy\n' +
      '• Message us to set it up anytime\n\n' +
      '👉 Check buy prices: ' + SITE + '/browse\n\n' +
      '💬 Which game are you interested in buying?'
    );
  }

  // ── TRIAL ────────────────────────────────────────────────────────────────
  if (/trial|libre|free|try|subukan|test/.test(text)) {
    return sendText(senderId,
      '🎮 FREE 3-Hour Trial!\n\n' +
      'Yes! We offer a 3-hour FREE trial on our account before you rent or buy. 🎉\n\n' +
      'Just tell us which game you want to try and we\'ll set it up for you!\n\n' +
      '💬 Which game would you like to try?'
    );
  }

  // ── PAYMENT ──────────────────────────────────────────────────────────────
  if (/pay|gcash|payment|bayad|bayaran|how.*pay|magbayad/.test(text)) {
    return sendText(senderId,
      '💳 Payment at PlayStation Hub\n\n' +
      'We accept payment via:\n\n' +
      '📱 GCash — send to our GCash number\n\n' +
      'Once you\'ve chosen a game and duration, message us and we\'ll give you the payment details. Payment first before we set up access. 😊\n\n' +
      '💬 Ready to rent? Tell me which game!'
    );
  }

  // ── CONTACT / HUMAN ───────────────────────────────────────────────────────
  if (/contact|human|agent|tao|admin|owner|staff|ikaw|sino/.test(text)) {
    return sendText(senderId,
      '📞 Talk to our team!\n\n' +
      'Just send your message here on Messenger and we\'ll reply as soon as possible. 😊\n\n' +
      'We\'re usually available during the day. For urgent concerns, message us directly!'
    );
  }

  // ── PRICES GUIDE ─────────────────────────────────────────────────────────
  if (/price|magkano|how much|pricelist|presyo|halaga|cost/.test(text)) {
    const sample = games.filter(g => g.nt_price_7d).slice(0, 4);
    let msg = '💰 PlayStation Hub Pricing\n\n';
    msg += '━━━━━━━━━━━━━━━━━━━\n';
    msg += '🎮 NON-TROPHY ACCOUNT\n';
    msg += '  Weekly / Monthly\n';
    if (sample.length) {
      sample.forEach(g => {
        msg += `  ${g.title.slice(0,18)}: ₱${g.nt_price_7d}/₱${g.nt_price_30d}\n`;
      });
    }
    msg += '\n🏆 TROPHY ACCOUNT (+₱50)\n';
    if (sample.length) {
      sample.forEach(g => {
        if (g.tr_price_7d) msg += `  ${g.title.slice(0,18)}: ₱${g.tr_price_7d}/₱${g.tr_price_30d}\n`;
      });
    }
    msg += '\n✨ FREE 3-hour trial available!\n';
    msg += '📖 See all prices: ' + SITE + '/browse';
    return sendText(senderId, msg);
  }

  // ── PROMO / DISCOUNT ─────────────────────────────────────────────────────
  if (/promo|discount|sale|diskaunto|bawas|may promo|meron.*promo|promo.*meron|special/.test(text)) {
    const s = getSiteSettings();
    const promo = s.promo || {};
    let msg = '🎉 PlayStation Hub Promos!\n\n';
    let hasPromo = false;
    const activeDurations = promo.enabled ? PROMO_DURATIONS.filter(d => getPromoDiscountPct(promo, d) > 0) : [];
    if (activeDurations.length > 0) {
      hasPromo = true;
      msg += `⏱️ RENT PROMO!\n`;
      activeDurations.forEach(d => { msg += `   ${getPromoDiscountPct(promo, d)}% OFF on ${d}-day rentals\n`; });
      if (promo.deposit) msg += `   +₱${promo.deposit} refundable deposit (Trophy accounts)\n`;
      msg += '\n';
    }
    if (promo.buy_promo_enabled && promo.buy_promo_pct > 0) {
      hasPromo = true;
      msg += `♾️ BUY PERMANENT PROMO — ${promo.buy_promo_pct}% OFF!\n`;
      msg += `   Discounted one-time permanent access\n\n`;
    }
    if (!hasPromo) {
      msg += '😊 Wala pang active promo ngayon, pero meron kaming:\n\n';
    }
    msg += '✨ FREE 3-hour trial bago mag-rent o bumili!\n';
    msg += '🎮 Malawak na game selection — PS5 & PS4\n\n';
    msg += '👉 Check our games: ' + SITE + '/browse\n';
    msg += '💬 Message us para sa pinakabagong deals!';
    return sendText(senderId, msg);
  }

  // ── COMING SOON ───────────────────────────────────────────────────────────
  if (/coming soon|upcoming|reserve|reservation/.test(text)) {
    if (!upcoming.length) return sendText(senderId, '📭 No upcoming games right now. Check back soon!');
    let msg = '🔜 Coming Soon Games — Open for Reservation!\n\n';
    upcoming.slice(0, 8).forEach(g => {
      const date = g.release_date === 'TBA' ? 'TBA' : g.release_date;
      msg += `📌 ${g.title} (${g.platform})\n   Expected: ${date}\n`;
      if (g.nt_price_30d) msg += `   From ₱${g.nt_price_30d} (30 days)\n`;
      msg += '\n';
    });
    msg += '📩 Reserve now: ' + SITE + '/browse';
    return sendText(senderId, msg);
  }

  // ── ALL GAMES LIST ────────────────────────────────────────────────────────
  if (/^(games?|list|lahat|all games?|available|ano.*games?|anong games?|meron.*games?)/.test(text)) {
    const avail = games.filter(g => (g.non_trophy_slots || 0) + (g.trophy_slots || 0) > 0);
    const full  = games.filter(g => (g.non_trophy_slots || 0) + (g.trophy_slots || 0) === 0);
    let msg = `🎮 PlayStation Hub — ${games.length} Games\n\n`;
    if (avail.length) {
      msg += `✅ AVAILABLE NOW (${avail.length}):\n`;
      avail.slice(0, 12).forEach(g => { msg += `• ${g.title} (${g.platform})\n`; });
      if (avail.length > 12) msg += `  ...and ${avail.length - 12} more\n`;
    }
    if (full.length) {
      msg += `\n🔴 FULLY RENTED (${full.length} games)\n`;
      full.slice(0, 4).forEach(g => { msg += `• ${g.title}\n`; });
      if (full.length > 4) msg += `  ...and ${full.length - 4} more\n`;
    }
    msg += '\n🔍 See all: ' + SITE + '/browse';
    return sendText(senderId, msg);
  }

  // ── GAME SEARCH ───────────────────────────────────────────────────────────
  const matches = games.filter(g => g.title.toLowerCase().includes(text));
  const upMatches = upcoming.filter(g => g.title.toLowerCase().includes(text));

  if (matches.length > 0) {
    const g = matches[0];
    const ntSlots = g.non_trophy_slots || 0;
    const trSlots = g.trophy_slots || 0;
    const slug = g.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let msg = `🎮 ${g.title} (${g.platform})\n\n`;
    msg += ntSlots > 0 ? `✅ Non-Trophy: ${ntSlots} slot(s) available\n` : `🔴 Non-Trophy: Fully rented\n`;
    if (g.tr_price_7d) msg += trSlots > 0 ? `✅ Trophy: ${trSlots} slot(s) available\n` : `🔴 Trophy: Fully rented\n`;
    msg += `\n💰 PRICING:\n`;
    msg += `🎮 Non-Trophy: ₱${g.nt_price_7d} / ₱${g.nt_price_30d}\n`;
    if (g.tr_price_7d) msg += `🏆 Trophy: ₱${g.tr_price_7d} / ₱${g.tr_price_30d}\n`;
    msg += `(Weekly / Monthly)\n`;
    msg += `\n✨ FREE 3-hour trial available!\n`;
    msg += `\n📄 View game: ${SITE}/game/${slug}`;
    if (matches.length > 1) msg += `\n\nAlso found: ${matches.slice(1,3).map(x=>x.title).join(', ')}`;
    if (g.cover_image) {
      return sendMessage(senderId, { attachment: { type: 'image', payload: { url: SITE + g.cover_image, is_reusable: true } } }, () => sendText(senderId, msg));
    }
    return sendText(senderId, msg);
  }

  if (upMatches.length > 0) {
    const g = upMatches[0];
    const slug = g.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + g.id;
    let msg = `🔜 ${g.title} (${g.platform})\nCOMING SOON — Open for Reservation!\n`;
    msg += `📅 Expected: ${g.release_date === 'TBA' ? 'TBA' : g.release_date}\n`;
    if (g.nt_price_30d) msg += `\n💰 Non-Trophy: ₱${g.nt_price_30d} (30 days)\n`;
    if (g.tr_price_30d) msg += `🏆 Trophy: ₱${g.tr_price_30d} (30 days)\n`;
    msg += `\n📄 Reserve: ${SITE}/upcoming/${slug}`;
    if (g.cover_image) {
      return sendMessage(senderId, { attachment: { type: 'image', payload: { url: SITE + g.cover_image, is_reusable: true } } }, () => sendText(senderId, msg));
    }
    return sendText(senderId, msg);
  }

  // ── AI FALLBACK ───────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.default({ apiKey });
      const gameList = games.slice(0, 20).map(g =>
        `${g.title} (${g.platform}) — NT: ₱${g.nt_price_7d}/₱${g.nt_price_30d}${g.tr_price_7d ? `, TR: ₱${g.tr_price_7d}/₱${g.tr_price_30d}` : ''} — ${((g.non_trophy_slots||0)+(g.trophy_slots||0))>0?'Available':'Fully Rented'}`
      ).join('\n');
      const trainingExamples = (db.get('bot_training').value() || []).slice(0, 30);
      const examplesText = trainingExamples.length > 0
        ? '\n\nHere are real examples of how the owner replies to customers (learn this style exactly):\n' +
          trainingExamples.map(e => `Customer: "${e.customer_msg}"\nYou: "${e.your_reply}"`).join('\n\n')
        : '';
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        messages: [{
          role: 'user',
          content: `You are the Messenger bot for PlayStation Hub — a PS5/PS4 digital game rental shop in the Philippines run by a young Filipino owner. Reply EXACTLY in the owner's communication style based on the examples below. Match their tone, vocabulary, Taglish mix, and friendliness. Keep replies short and conversational.

Business info:
- Rent PS5/PS4 games for Weekly or Monthly durations
- Non-Trophy account (play on our account) and Trophy account (earn trophies on your own PSN)
- Payment via GCash
- FREE 3-hour trial before renting or buying
- Also offer permanent/lifetime Buy access
- Website: https://playstation-hub-production.up.railway.app
${examplesText}

Available games:
${gameList}

Customer message: "${text}"

Reply naturally in the owner's style. Max 5 sentences. If game not available, say so kindly and suggest alternatives.`
        }]
      });
      const aiReply = response.content[0]?.text?.trim();
      if (aiReply) return sendText(senderId, aiReply);
    } catch(e) {
      console.error('[bot AI fallback]', e.message);
    }
  }

  // ── FINAL FALLBACK ────────────────────────────────────────────────────────
  return sendText(senderId,
    '😊 Hindi ko sure kung ano ang ibig mong sabihin, pero nandito kami para tumulong!\n\n' +
    '🎮 Type "games" — available games\n' +
    '💰 Type "prices" — pricing guide\n' +
    '📋 Type "how to rent" — rental steps\n' +
    '🔍 Or type a game name to search!\n\n' +
    'Browse: ' + SITE + '/browse'
  );
}

// ── Bot Training ──────────────────────────────────────────────────────────────
app.post('/admin/bot-training/add', requireAuth, (req, res) => {
  const { customer_msg, your_reply, category } = req.body;
  if (!customer_msg || !your_reply) return res.redirect('/admin?tab=settings&msg=error');
  const id = db.get('nextBotTrainingId').value();
  db.get('bot_training').push({
    id,
    customer_msg: customer_msg.trim(),
    your_reply: your_reply.trim(),
    category: category || 'general',
    created_at: new Date().toISOString()
  }).write();
  db.set('nextBotTrainingId', id + 1).write();
  res.redirect('/admin?tab=settings&msg=training_saved');
});

app.post('/admin/bot-training/delete/:id', requireAuth, (req, res) => {
  db.get('bot_training').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?tab=settings&msg=training_deleted');
});

// ── Sign-In QR Guide ──────────────────────────────────────────────────────────
// Each step is added/edited/deleted individually — never as one bulk form —
// so uploading one screenshot can never risk re-submitting or losing the others.
const uploadSigninStep = multer({
  storage,
  fileFilter: (req, file, cb) => cb(null, /jpeg|jpg|png|gif|webp/.test(file.mimetype)),
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.post('/admin/signin-steps/add', requireAuth, uploadSigninStep.single('image'), async (req, res) => {
  const { console: cons, text } = req.body;
  if (!['ps5', 'ps4'].includes(cons) || !text || !text.trim()) {
    return res.redirect('/admin?tab=settings&msg=error');
  }
  const image = req.file ? await processUploadedImage(req.file, 900) : null;
  const existing = db.get('signin_steps').filter({ console: cons }).value();
  const rank = existing.length ? Math.max(...existing.map(s => s.rank)) + 1 : 0;
  const id = db.get('nextSigninStepId').value();
  db.get('signin_steps').push({
    id, console: cons, rank, text: text.trim(), image, created_at: new Date().toISOString()
  }).write();
  db.set('nextSigninStepId', id + 1).write();
  res.redirect('/admin?tab=settings&msg=signin_step_saved');
});

app.post('/admin/signin-steps/:id', requireAuth, uploadSigninStep.single('image'), async (req, res) => {
  const id = parseInt(req.params.id);
  const step = db.get('signin_steps').find({ id }).value();
  if (!step) return res.redirect('/admin?tab=settings&msg=error');
  const patch = { text: (req.body.text || step.text).trim() };
  if (req.body.remove_image === 'on' && step.image) {
    const fp = path.join(uploadsDir, path.basename(step.image));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    patch.image = null;
  } else if (req.file) {
    if (step.image) {
      const oldFp = path.join(uploadsDir, path.basename(step.image));
      if (fs.existsSync(oldFp)) fs.unlinkSync(oldFp);
    }
    patch.image = await processUploadedImage(req.file, 900);
  }
  db.get('signin_steps').find({ id }).assign(patch).write();
  res.redirect('/admin?tab=settings&msg=signin_step_saved');
});

app.post('/admin/signin-steps/:id/delete', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const step = db.get('signin_steps').find({ id }).value();
  if (step && step.image) {
    const fp = path.join(uploadsDir, path.basename(step.image));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.get('signin_steps').remove({ id }).write();
  res.redirect('/admin?tab=settings&msg=signin_step_deleted');
});

app.post('/admin/signin-steps/:id/move', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const dir = req.body.dir === 'up' ? -1 : req.body.dir === 'down' ? 1 : 0;
  const step = db.get('signin_steps').find({ id }).value();
  if (!step || !dir) return res.redirect('/admin?tab=settings&msg=error');
  const siblings = db.get('signin_steps').filter({ console: step.console }).sortBy('rank').value();
  const idx = siblings.findIndex(s => s.id === id);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= siblings.length) return res.redirect('/admin?tab=settings&msg=signin_step_saved');
  const swapWith = siblings[swapIdx];
  const stepRank = step.rank;
  db.get('signin_steps').find({ id: step.id }).assign({ rank: swapWith.rank }).write();
  db.get('signin_steps').find({ id: swapWith.id }).assign({ rank: stepRank }).write();
  res.redirect('/admin?tab=settings&msg=signin_step_saved');
});

app.post('/admin/bot-training/import-fb', requireAuth, express.json({ limit: '10mb' }), (req, res) => {
  // Parse Facebook Messages JSON export
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.json({ ok: false, error: 'Invalid format' });
  let imported = 0;
  // Facebook export format: messages array with sender_name and content
  // Group into pairs: customer message followed by page reply
  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    const next = messages[i + 1];
    // If next message is from the page (your reply)
    if (msg.content && next.content && msg.sender_name !== next.sender_name) {
      const id = db.get('nextBotTrainingId').value();
      db.get('bot_training').push({
        id,
        customer_msg: msg.content.slice(0, 500),
        your_reply: next.content.slice(0, 500),
        category: 'imported',
        created_at: new Date().toISOString()
      }).write();
      db.set('nextBotTrainingId', id + 1).write();
      imported++;
      if (imported >= 100) break; // cap at 100 examples
    }
  }
  res.json({ ok: true, imported });
});
// ─────────────────────────────────────────────────────────────────────────────

// ── AI Message Generator ──────────────────────────────────────────────────────
app.post('/admin/ai-generate', requireAuth, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) return res.json({ ok: false, error: 'No prompt provided.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.json({ ok: false, error: 'ANTHROPIC_API_KEY not set on server.' });
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are helping a Philippine PlayStation game rental shop (PlayStation Hub) write a Messenger message to send to past customers.

The message should:
- Be in a friendly Filipino/Taglish tone (mix of Filipino and English is fine)
- Use {name} placeholder where the customer's name should appear
- Use {game} placeholder where the last game they rented should appear
- Be concise (3-6 sentences max)
- End with the website link: https://playstation-hub-production.up.railway.app
- NOT include any subject line or "Message:" prefix — just the message body

User's request: ${prompt.trim()}

Write only the message, nothing else.`
      }]
    });
    const text = response.content[0]?.text || '';
    res.json({ ok: true, message: text.trim() });
  } catch (e) {
    console.error('[ai-generate]', e.message);
    res.json({ ok: false, error: 'AI error: ' + e.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// ── Messenger Auto Blast ──────────────────────────────────────────────────────
// Messenger only allows a business-initiated message within 24h of the
// contact's last inbound message (the "standard messaging window"). Outside
// that window, only specific message tags are allowed, and every tag is
// reserved for a narrow non-promotional case (order updates, human-agent
// replies, etc) — none of them permit a promo blast. So "reachable" here
// means "inside the 24h window", not "ever contacted us".
const BLAST_WINDOW_MS = 24 * 60 * 60 * 1000;
function reachableContacts() {
  const contacts = db.get('messenger_contacts').value() || [];
  const cutoff = Date.now() - BLAST_WINDOW_MS;
  return contacts.filter(c => c.last_seen && new Date(c.last_seen).getTime() >= cutoff);
}

app.get('/admin/blast/contacts', requireAuth, (req, res) => {
  const total = (db.get('messenger_contacts').value() || []).length;
  res.json({ reachable: reachableContacts().length, total });
});

app.post('/admin/blast', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.json({ ok: false, error: 'No message provided.' });
  if (!PAGE_ACCESS_TOKEN) return res.json({ ok: false, error: 'MESSENGER_PAGE_TOKEN not configured on server.' });

  const contacts = reachableContacts();
  if (!contacts.length) return res.json({ ok: false, error: 'No contacts are inside the 24-hour messaging window right now. Messenger only allows this kind of message to people who messaged your Page in the last 24 hours.' });

  const https = require('https');
  let sent = 0, failed = 0;

  function sendOne(psid) {
    return new Promise((resolve) => {
      const payload = JSON.stringify({
        recipient: { id: psid },
        message: { text: message },
        messaging_type: 'UPDATE'
      });
      const options = {
        hostname: 'graph.facebook.com',
        path: '/v19.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      };
      const r2 = https.request(options, (resp) => {
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => {
          if (resp.statusCode === 200) sent++;
          else { failed++; console.log('[blast] fail psid=' + psid, resp.statusCode, data); }
          resolve();
        });
      });
      r2.on('error', () => { failed++; resolve(); });
      r2.write(payload);
      r2.end();
    });
  }

  for (const c of contacts) {
    await sendOne(c.psid);
    await new Promise(r => setTimeout(r, 120)); // avoid rate limit
  }

  res.json({ ok: true, sent, failed, total: contacts.length });
});
// ─────────────────────────────────────────────────────────────────────────────

// ── Recurring Notifications Send ─────────────────────────────────────────────
app.post('/admin/notifications/send', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.json({ ok: false, error: 'No message provided.' });
  if (!PAGE_ACCESS_TOKEN) return res.json({ ok: false, error: 'MESSENGER_PAGE_TOKEN not configured on server.' });

  const optins = getActiveOptins();
  if (!optins.length) return res.json({ ok: false, error: 'No active opt-ins yet. Contacts opt in via the bot after messaging your Page.' });

  const https = require('https');
  let sent = 0, failed = 0;

  function sendOne(optin) {
    return new Promise((resolve) => {
      // Best-effort per the plan's stated uncertainty: Meta's recurring-
      // notification send is expected to accept the PSID directly like a
      // normal message once a valid opt-in exists for that recipient/topic,
      // tagged so it's exempt from the 24h window this feature exists to
      // bypass. If Meta's account requires a different recipient shape (e.g.
      // a token field instead of the PSID), this is the one place to adjust.
      const payload = JSON.stringify({
        recipient: { id: optin.psid },
        message: { text: message },
        messaging_type: 'MESSAGE_TAG',
        tag: 'CONFIRMED_EVENT_UPDATE'
      });
      const options = {
        hostname: 'graph.facebook.com',
        path: '/v19.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      };
      const r2 = https.request(options, (resp) => {
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => {
          console.log('[notif send] psid=' + optin.psid, resp.statusCode, data);
          if (resp.statusCode === 200) {
            sent++;
            db.get('notification_optins').find({ psid: optin.psid, topic: 'monthly_promo' }).assign({ last_sent_at: new Date().toISOString(), last_error: null }).write();
          } else {
            // A non-200 response (e.g. the Recurring Notifications permission
            // not yet approved by Meta) is diagnostic information, not proof
            // the opt-in itself is invalid — status stays 'active' so the
            // contact remains reachable on the next send once the underlying
            // condition clears. There is no way to distinguish a transient/
            // permission failure from a permanently invalid recipient from
            // the status code alone, so we default to retryable.
            failed++;
            db.get('notification_optins').find({ psid: optin.psid, topic: 'monthly_promo' }).assign({
              last_error: String(resp.statusCode) + ' ' + data.slice(0, 500),
              last_attempt_at: new Date().toISOString()
            }).write();
          }
          resolve();
        });
      });
      r2.on('error', (e) => { console.error('[notif send error] psid=' + optin.psid, e.message); failed++; resolve(); });
      r2.write(payload);
      r2.end();
    });
  }

  for (const optin of optins) {
    await sendOne(optin);
    await new Promise(r => setTimeout(r, 120));
  }

  res.json({ ok: true, sent, failed, total: optins.length });
});

app.get('/admin/notifications/optins', requireAuth, (req, res) => {
  res.json({ active: getActiveOptins().length });
});
// ─────────────────────────────────────────────────────────────────────────────

// ── Reviews ──────────────────────────────────────────────────────────────────

app.post('/admin/reviews/add', requireAuth, (req, res) => {
  const { name, rating, text, game_rented, order } = req.body;
  const id = db.get('nextReviewId').value();
  db.get('reviews').push({ id, name, rating: parseInt(rating) || 5, text, game_rented: game_rented || '', order: parseInt(order) || 99, visible: true, created_at: new Date().toISOString() }).write();
  db.set('nextReviewId', id + 1).write();
  res.redirect('/admin#reviews');
});

app.post('/admin/reviews/delete/:id', requireAuth, (req, res) => {
  db.get('reviews').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin#reviews');
});

app.post('/admin/reviews/toggle/:id', requireAuth, (req, res) => {
  const review = db.get('reviews').find({ id: parseInt(req.params.id) }).value();
  if (review) db.get('reviews').find({ id: parseInt(req.params.id) }).assign({ visible: !review.visible }).write();
  res.redirect('/admin#reviews');
});

// ─────────────────────────────────────────────────────────────────────────────

// Catches errors thrown/passed in any route above (e.g. multer file-size limit,
// disk write failures) so they're logged and the user gets redirected instead of
// Express's bare "Internal Server Error" page.
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    const back = req.get('referer') || '/admin';
    return res.redirect(back + (back.includes('?') ? '&' : '?') + 'msg=file_too_large');
  }
  res.status(500).send('Something went wrong. Please try again.');
});

app.listen(PORT, () => {
  console.log(`\n✅ Playstation Hub running at http://localhost:${PORT}`);
  console.log(`🔧 Admin panel at http://localhost:${PORT}/admin\n`);
});


