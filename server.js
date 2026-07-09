const express = require('express');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// DATA_DIR env var points to a persistent volume on Railway (e.g. /data)
// Falls back to local project folder for development
const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

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
      subtitle: 'Play more, pay less. Rent top titles starting at ₱99 — choose 10, 15, or 30 days.',
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
  bot_training: [],
  nextBotTrainingId: 1,
  accounts: [],
  nextAccountId: 1
}).write();

// Ensure accounts collection exists for pre-existing databases
if (db.get('accounts').value() === undefined) db.set('accounts', []).write();
if (db.get('nextAccountId').value() === undefined) db.set('nextAccountId', 1).write();

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
  if (Object.keys(patch).length) {
    db.get('games').find({ id: g.id }).assign(patch).write();
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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Expose account-summary helper to every EJS template (e.g. partials/game-card.ejs)
app.locals.gameAccountSummary = (gameId) => gameAccountSummary(gameId);
app.use(express.static(path.join(__dirname, 'public')));
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
  const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim();
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  db.get('visitors').push({ date: today, time: now, path: reqPath, page: pageLabel, ip }).write();
  // Keep only last 5000 entries to avoid bloat
  const all = db.get('visitors').value();
  if (all.length > 5000) db.set('visitors', all.slice(all.length - 5000)).write();
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

function getCustomers() { return db.get('customers').value() || []; }
function getCustomer(id) { return db.get('customers').find({ id: parseInt(id) }).value(); }
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
        nt_price_10d: cat.nt_price_10d, nt_price_15d: cat.nt_price_15d, nt_price_30d: cat.nt_price_30d,
        tr_price_10d: cat.tr_price_10d, tr_price_15d: cat.tr_price_15d, tr_price_30d: cat.tr_price_30d,
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
      subtitle: 'Play more, pay less. Rent top titles starting at ₱99 — choose 10, 15, or 30 days.',
      title_size: 55, highlight_color: '#F0A500', subtitle_color: '#aaaaaa'
    }).write();
    s.hero_text = db.get('site_settings.hero_text').value();
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
    db.set('site_settings.promo', { enabled: true, discount_pct: 10, apply_on_days: 30, deposit: 100 }).write();
    s.promo = db.get('site_settings.promo').value();
  }
  return s;
}

app.get('/how-it-works', (req, res) => {
  res.render('how-it-works', { announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings() });
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
  const promo = settings.promo || { enabled: true, discount_pct: 10, apply_on_days: 30, deposit: 100 };
  res.render('psplus-rent', { prices, slots, promo, announcement: getAnnouncement(), announcements: getAnnouncements(), settings });
});

// PS Plus admin CRUD
app.post('/admin/psplus/add', upload.single('cover_image'), requireAuth, (req, res) => {
  const { year, month, games_list, notes, nt_slots, tr_slots } = req.body;
  if (!year || !month) return res.redirect('/admin?msg=error');
  const cover_image = req.file ? '/uploads/' + req.file.filename : '';
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

app.post('/admin/psplus/edit/:id', upload.single('cover_image'), requireAuth, (req, res) => {
  const { year, month, games_list, notes, nt_slots, tr_slots } = req.body;
  const existing = getPsplusEntry(req.params.id);
  if (!existing) return res.redirect('/admin');
  const cover_image = req.file ? '/uploads/' + req.file.filename : existing.cover_image;
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
app.post('/admin/psplus/popular/add', upload.single('cover_image'), requireAuth, (req, res) => {
  const { title, platform, genre, description, rank } = req.body;
  if (!title || !title.trim()) return res.redirect('/admin?msg=error');
  const cover_image = req.file ? '/uploads/' + req.file.filename : '';
  db.get('psplus_popular').push({
    id: newPsplusPopularId(),
    title: title.trim(),
    platform: platform || 'PS5',
    genre: genre || '',
    description: description || '',
    rank: parseInt(rank) || 0,
    cover_image,
    created_at: new Date().toISOString()
  }).write();
  res.redirect('/admin?msg=popular_added');
});

app.get('/admin/psplus/popular/edit/:id', requireAuth, (req, res) => {
  const entry = getPsplusPopularEntry(req.params.id);
  if (!entry) return res.redirect('/admin');
  res.render('edit-psplus-popular', { entry, settings: getSiteSettings() });
});

app.post('/admin/psplus/popular/edit/:id', upload.single('cover_image'), requireAuth, (req, res) => {
  const { title, platform, genre, description, rank } = req.body;
  const existing = getPsplusPopularEntry(req.params.id);
  if (!existing) return res.redirect('/admin');
  const cover_image = req.file ? '/uploads/' + req.file.filename : existing.cover_image;
  db.get('psplus_popular').find({ id: parseInt(req.params.id) }).assign({
    title: title.trim(), platform, genre: genre || '',
    description: description || '', rank: parseInt(rank) || 0, cover_image
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
  const { nt_price_10d, nt_price_15d, nt_price_30d, tr_price_10d, tr_price_15d, tr_price_30d, nt_slots, tr_slots, ps4_slots } = req.body;
  db.set('psplus_slots', {
    nt_slots: parseInt(nt_slots) || 0,
    tr_slots: parseInt(tr_slots) || 0,
    ps4_slots: parseInt(ps4_slots) || 0
  }).write();
  db.set('psplus_prices', {
    nt_price_10d: parseInt(nt_price_10d) || 349,
    nt_price_15d: parseInt(nt_price_15d) || 449,
    nt_price_30d: parseInt(nt_price_30d) || 599,
    tr_price_10d: parseInt(tr_price_10d) || 399,
    tr_price_15d: parseInt(tr_price_15d) || 499,
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
  const featured = [...all].sort((a, b) => b.renters - a.renters).slice(0, 10);
  const upcoming = sortUpcoming(getUpcoming());
  const psplusPopular = [...getPsplusPopular()].sort((a, b) => (a.rank || 999) - (b.rank || 999)).slice(0, 10);
  const psplusPrices = getPsplusPrices();
  const homePsplusGame = getGames().find(g => g.title.toLowerCase().includes('ps plus') || g.title.toLowerCase().includes('playstation plus'));
  const homePsplusSlug = homePsplusGame ? gameSlug(homePsplusGame.title) : null;
  const reviews = db.get('reviews').filter({ visible: true }).value().sort((a, b) => (a.order || 999) - (b.order || 999));
  const s = getSiteSettings();
  const promo = s.promo || { enabled: false, discount_pct: 0, apply_on_days: 30, deposit: 100, buy_promo_enabled: false, buy_promo_pct: 0 };
  res.render('index', { featured, games: all, upcoming, psplusPopular, psplusPrices, psplusSlug: homePsplusSlug, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: s, reviews, promo });
});

app.get('/browse', (req, res) => {
  const { search, platform, genre } = req.query;
  let games = getGames().map(resolveGamePrices).map(resolveSlotDays);
  if (search) {
    const q = search.toLowerCase();
    games = games.filter(g =>
      g.title.toLowerCase().includes(q) ||
      (g.description && g.description.toLowerCase().includes(q))
    );
  }
  if (platform) games = games.filter(g => g.platform === platform || g.platform === 'PS4/PS5');
  if (genre) games = games.filter(g => g.genre === genre);
  games.sort((a, b) => a.title.localeCompare(b.title));
  const genres = [...new Set(getGames().map(g => g.genre).filter(Boolean))].sort();
  const upcoming = sortUpcoming(getUpcoming());
  // PS Plus monthly entries sorted newest first
  const psplus = [...getPsplus()].sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month);
  const priceCategories = getPriceCategories();
  res.render('browse', { games, search: search || '', platform: platform || '', genre: genre || '', genres, upcoming, psplus, priceCategories, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings() });
});

// ── Game Detail Page ──────────────────────────────────────────────────────────
function gameSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

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
  const gdPromo = gdSettings.promo || { enabled: false, discount_pct: 0, apply_on_days: 30, deposit: 100, buy_promo_enabled: false, buy_promo_pct: 0 };
  res.render('game-detail', { game: resolved, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: gdSettings, promo: gdPromo, accountSummary: gameAccountSummary(game.id) });
});

// ── Admin Promo Settings ──────────────────────────────────────────────────────
app.post('/admin/promo', requireAuth, (req, res) => {
  const { enabled, discount_pct, apply_on_days, deposit,
          buy_promo_enabled, buy_promo_pct } = req.body;
  db.set('site_settings.promo', {
    enabled: enabled === 'on',
    discount_pct: Math.min(100, Math.max(0, parseInt(discount_pct) || 10)),
    apply_on_days: parseInt(apply_on_days) || 30,
    deposit: Math.max(0, parseInt(deposit) || 100),
    buy_promo_enabled: buy_promo_enabled === 'on',
    buy_promo_pct: Math.min(100, Math.max(0, parseInt(buy_promo_pct) || 0))
  }).write();
  res.redirect('/admin?msg=promo_saved');
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

app.get('/admin', requireAuth, (req, res) => {
  const games = [...getGames()].sort((a, b) => b.id - a.id).map(resolveGamePrices);
  const upcoming = [...getUpcoming()].sort((a, b) => b.id - a.id);
  const psplus = [...getPsplus()].sort((a, b) => b.year - a.year || b.month - a.month);
  const psplusPopular = [...getPsplusPopular()].sort((a, b) => (a.rank || 999) - (b.rank || 999));
  const customers = [...getCustomers()].sort((a, b) => {
    // No end_date (bought/missing) → bottom
    if (!a.end_date && !b.end_date) return 0;
    if (!a.end_date) return 1;
    if (!b.end_date) return -1;
    return a.end_date.localeCompare(b.end_date); // soonest first
  });
  const visitors = db.get('visitors').value();
  const reviews = db.get('reviews').value().sort((a, b) => (a.order || 999) - (b.order || 999));
  const botTraining = db.get('bot_training').value() || [];
  res.render('admin', { games, upcoming, psplus, psplusPopular, psplusPrices: getPsplusPrices(), psplusSlots: getPsplusSlots(), announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings(), priceCategories: getPriceCategories(), customers, visitors, msg: req.query.msg || null, reviews, botTraining, accounts: getAccounts() });
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

  res.render('upcoming-detail', { game: resolvedGame, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings() });
});

app.post('/admin/upcoming/add', upload.single('cover_image'), requireAuth, (req, res) => {
  const { title, platform, genre, release_date, release_date_tba_val, description,
          non_trophy_slots, trophy_slots, rank,
          nt_price_10d, nt_price_15d, nt_price_30d,
          tr_price_10d, tr_price_15d, tr_price_30d } = req.body;
  if (!title || !title.trim()) return res.redirect('/admin?msg=error');
  const cover_image = req.file ? '/uploads/' + req.file.filename : '';
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
    nt_price_10d: parseInt(nt_price_10d) || 0,
    nt_price_15d: parseInt(nt_price_15d) || 0,
    nt_price_30d: parseInt(nt_price_30d) || 0,
    tr_price_10d: parseInt(tr_price_10d) || 0,
    tr_price_15d: parseInt(tr_price_15d) || 0,
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

app.post('/admin/upcoming/edit/:id', upload.single('cover_image'), requireAuth, (req, res) => {
  const { title, platform, genre, release_date, release_date_tba_val, description,
          non_trophy_slots, trophy_slots, rank,
          nt_price_10d, nt_price_15d, nt_price_30d,
          tr_price_10d, tr_price_15d, tr_price_30d } = req.body;
  const existing = getUpcomingGame(req.params.id);
  if (!existing) return res.redirect('/admin');
  const cover_image = req.file ? '/uploads/' + req.file.filename : existing.cover_image;
  const finalDate = release_date_tba_val === 'TBA' ? 'TBA' : (release_date || 'TBA');
  db.get('upcoming').find({ id: parseInt(req.params.id) }).assign({
    title: title.trim(), platform, genre: genre || '',
    release_date: finalDate, description: description || '', cover_image,
    rank: parseInt(rank) || 0,
    non_trophy_slots: parseInt(non_trophy_slots) || 0,
    trophy_slots: parseInt(trophy_slots) || 0,
    nt_price_10d: parseInt(nt_price_10d) || 0,
    nt_price_15d: parseInt(nt_price_15d) || 0,
    nt_price_30d: parseInt(nt_price_30d) || 0,
    tr_price_10d: parseInt(tr_price_10d) || 0,
    tr_price_15d: parseInt(tr_price_15d) || 0,
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
    nt_price_10d: game.nt_price_10d || 0,
    nt_price_15d: game.nt_price_15d || 0,
    nt_price_30d: game.nt_price_30d || 0,
    tr_price_10d: game.tr_price_10d || 0,
    tr_price_15d: game.tr_price_15d || 0,
    tr_price_30d: game.tr_price_30d || 0,
    featured: false,
    renters: 0,
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

app.post('/admin/add', upload.fields([{ name: 'cover_image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }]), requireAuth, (req, res) => {
  const { title, platform, available_slots, renters,
    nt_price_10d, nt_price_15d, nt_price_30d,
    tr_price_10d, tr_price_15d, tr_price_30d,
    buy_nt_price, buy_tr_price,
    genre, description, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    price_category_id, price_mode, cost } = req.body;
  if (!title || !title.trim()) return res.redirect('/admin?msg=error');
  const coverFile = req.files && req.files.cover_image ? req.files.cover_image[0] : null;
  const cover_image = coverFile ? '/uploads/' + coverFile.filename : '';
  const gallery = (req.files && req.files.gallery ? req.files.gallery : []).map(f => '/uploads/' + f.filename);
  const useCategory = price_mode === 'category' && price_category_id;
  const cat = useCategory ? getPriceCategory(price_category_id) : null;
  db.get('games').push({
    id: newId(),
    title: title.trim(),
    platform: platform || 'PS5',
    cover_image,
    gallery,
    available_slots: parseInt(available_slots) || 1,
    renters: parseInt(renters) || 0,
    price_category_id: cat ? parseInt(price_category_id) : null,
    nt_price_10d: cat ? cat.nt_price_10d : (parseInt(nt_price_10d) || 149),
    nt_price_15d: cat ? cat.nt_price_15d : (parseInt(nt_price_15d) || 199),
    nt_price_30d: cat ? cat.nt_price_30d : (parseInt(nt_price_30d) || 349),
    tr_price_10d: cat ? cat.tr_price_10d : (parseInt(tr_price_10d) || 199),
    tr_price_15d: cat ? cat.tr_price_15d : (parseInt(tr_price_15d) || 249),
    tr_price_30d: cat ? cat.tr_price_30d : (parseInt(tr_price_30d) || 399),
    genre: genre || '',
    description: description || '',
    non_trophy_slots: parseInt(non_trophy_slots) || 0,
    trophy_slots: trophy_account === 'on' ? (parseInt(trophy_slots) || 1) : 0,
    trophy_account: trophy_account === 'on',
    ps4_primary_slots: parseInt(ps4_primary_slots) || 0,
    buy_nt_price: parseInt(buy_nt_price) || 0,
    buy_tr_price: parseInt(buy_tr_price) || 0,
    cost: parseInt(cost) || 0,
    created_at: new Date().toISOString()
  }).write();
  res.redirect('/admin?msg=added');
});

app.get('/admin/edit/:id', requireAuth, (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.redirect('/admin');
  res.render('edit', { game, settings: getSiteSettings(), priceCategories: getPriceCategories() });
});

app.post('/admin/edit/:id', upload.fields([{ name: 'cover_image', maxCount: 1 }, { name: 'gallery', maxCount: 10 }]), requireAuth, (req, res) => {
  const { title, platform, available_slots, renters,
    nt_price_10d, nt_price_15d, nt_price_30d,
    tr_price_10d, tr_price_15d, tr_price_30d,
    buy_nt_price, buy_tr_price,
    genre, description, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    remove_gallery,
    price_category_id, price_mode, cost } = req.body;
  const existing = getGame(req.params.id);
  if (!existing) return res.redirect('/admin');
  const coverFile = req.files && req.files.cover_image ? req.files.cover_image[0] : null;
  const cover_image = coverFile ? '/uploads/' + coverFile.filename : existing.cover_image;

  // Gallery: keep existing minus removed, then append newly uploaded
  const toRemove = Array.isArray(remove_gallery) ? remove_gallery : (remove_gallery ? [remove_gallery] : []);
  let gallery = (existing.gallery || []).filter(img => !toRemove.includes(img));
  toRemove.forEach(img => {
    const fp = path.join(uploadsDir, path.basename(img));
    if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (e) {} }
  });
  const newGallery = (req.files && req.files.gallery ? req.files.gallery : []).map(f => '/uploads/' + f.filename);
  gallery = gallery.concat(newGallery);

  const useCategory = price_mode === 'category' && price_category_id;
  const cat = useCategory ? getPriceCategory(price_category_id) : null;
  db.get('games').find({ id: parseInt(req.params.id) }).assign({
    title: title.trim(), platform, cover_image, gallery,
    available_slots: parseInt(available_slots),
    renters: parseInt(renters),
    price_category_id: cat ? parseInt(price_category_id) : null,
    nt_price_10d: cat ? cat.nt_price_10d : parseInt(nt_price_10d),
    nt_price_15d: cat ? cat.nt_price_15d : parseInt(nt_price_15d),
    nt_price_30d: cat ? cat.nt_price_30d : parseInt(nt_price_30d),
    tr_price_10d: cat ? cat.tr_price_10d : parseInt(tr_price_10d),
    tr_price_15d: cat ? cat.tr_price_15d : parseInt(tr_price_15d),
    tr_price_30d: cat ? cat.tr_price_30d : parseInt(tr_price_30d),
    genre: genre || '',
    description: description || '',
    non_trophy_slots: parseInt(non_trophy_slots) || 0,
    trophy_slots: trophy_account === 'on' ? (parseInt(trophy_slots) || 0) : 0,
    trophy_account: trophy_account === 'on',
    ps4_primary_slots: parseInt(ps4_primary_slots) || 0,
    buy_nt_price: parseInt(buy_nt_price) || 0,
    buy_tr_price: parseInt(buy_tr_price) || 0,
    cost: parseInt(cost) || 0
  }).write();
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
  res.redirect('/admin?msg=deleted');
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

  // Preserve hero_text — only update the fields this form controls
  db.set('site_settings.title', (title || 'Playstation Hub').trim()).write();
  db.set('site_settings.logo_path', logo_path).write();
  db.set('site_settings.favicon_path', favicon_path).write();
  db.set('site_settings.hero_bg', hero_bg).write();
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
function applyAccountAssignment(assignStr, { customerId, customerName, status, endDate }) {
  if (!assignStr || !assignStr.includes(':')) return;
  const [idPart, type] = assignStr.split(':');
  const account = getAccount(idPart);
  if (!account || !ACCOUNT_SLOT_TYPES.includes(type)) return;
  const slot = account.slots[type];
  if (!slot || !slot.enabled) return;
  if (status === 'bought') { slot.status = 'buyed'; slot.start = ''; slot.end = ''; }
  else { slot.status = 'rented'; slot.start = new Date().toISOString().slice(0, 10); slot.end = endDate || ''; }
  slot.renter_id = customerId;
  slot.renter_name = customerName;
  account.slots[type] = slot;
  db.get('accounts').find({ id: account.id }).assign({ slots: account.slots }).write();
}
// Free any account slot currently linked to a given customer id
function freeAccountSlotsForCustomer(customerId) {
  getAccounts().forEach(acc => {
    let changed = false;
    ACCOUNT_SLOT_TYPES.forEach(t => {
      if (acc.slots[t] && acc.slots[t].renter_id === customerId) {
        acc.slots[t] = blankSlot(acc.slots[t].enabled);
        changed = true;
      }
    });
    if (changed) db.get('accounts').find({ id: acc.id }).assign({ slots: acc.slots }).write();
  });
}

app.post('/admin/customers/add', requireAuth, (req, res) => {
  const { customer_name, game_id, days, custom_days, account_type, start_date, end_date, price, status, notes, account_assign } = req.body;
  const actualDays = days === 'custom' ? (parseInt(custom_days) || 1) : (parseInt(days) || 10);
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
    created_at: new Date().toISOString()
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
    applyAccountAssignment(account_assign, {
      customerId: id, customerName: customer_name.trim(),
      status: activeStatus, endDate: end_date || ''
    });
  }
  res.redirect('/admin?tab=customers&msg=customer_added');
});

app.get('/admin/customers/edit/:id', requireAuth, (req, res) => {
  const customer = getCustomer(req.params.id);
  if (!customer) return res.redirect('/admin?tab=customers');
  const games = getGames().map(resolveGamePrices).sort((a, b) => a.title.localeCompare(b.title));
  res.render('edit-customer', { customer, games, upcoming: getUpcoming(), settings: getSiteSettings() });
});

app.post('/admin/customers/edit/:id', requireAuth, (req, res) => {
  const { customer_name, game_id, days, custom_days, account_type, start_date, end_date, price, status, notes } = req.body;
  const actualDays = days === 'custom' ? (parseInt(custom_days) || 1) : (parseInt(days) || 10);
  const existing = getCustomer(req.params.id);
  if (!existing) return res.redirect('/admin?tab=customers&msg=error');
  const wasActive = existing.status === 'renting' || existing.status === 'bought';
  const isActive = status === 'renting' || status === 'bought';
  const wasUpcoming = String(existing.game_id).startsWith('upcoming_');
  const isUpcomingNew = String(game_id || existing.game_id).startsWith('upcoming_');

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
  const newGame = getGame(game_id) || getGame(existing.game_id);
  db.get('customers').find({ id: parseInt(req.params.id) }).assign({
    customer_name: (customer_name || existing.customer_name).trim(),
    game_id: parseInt(game_id) || existing.game_id,
    game_title: newGame ? newGame.title : existing.game_title,
    days: actualDays,
    account_type: account_type || existing.account_type,
    start_date: start_date || existing.start_date,
    end_date: end_date || existing.end_date,
    price: parseInt(price) || existing.price,
    status: status || existing.status,
    notes: notes || ''
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
  if (wasActive && !isActive) freeAccountSlotsForCustomer(parseInt(req.params.id));
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
  const CATEGORY_ORDER = ['new games', 'deluxe', 'special', 'regular'];
  const groupNames = Object.keys(groupsMap).sort((a, b) => {
    if (a === 'Uncategorized') return 1;
    if (b === 'Uncategorized') return -1;
    const ai = CATEGORY_ORDER.indexOf(a.toLowerCase());
    const bi = CATEGORY_ORDER.indexOf(b.toLowerCase());
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
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

app.post('/admin/accounts/add', requireAuth, (req, res) => {
  const { label, games_text, game_ids, note, price_permanent_tr, price_permanent_nt,
    enable_trophy, enable_non_trophy, enable_ps4_primary } = req.body;
  if (!label || !label.trim()) return res.redirect('/admin/accounts?msg=error');
  db.get('accounts').push({
    id: newAccountId(),
    label: label.trim(),
    games_text: games_text || '',
    game_ids: parseGameIds(game_ids),
    note: note || '',
    price_permanent_tr: parseInt(price_permanent_tr) || 5000,
    price_permanent_nt: parseInt(price_permanent_nt) || 4500,
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
  const { label, games_text, game_ids, note, price_permanent_tr, price_permanent_nt,
    enable_trophy, enable_non_trophy, enable_ps4_primary } = req.body;
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
    price_permanent_tr: parseInt(price_permanent_tr) || existing.price_permanent_tr,
    price_permanent_nt: parseInt(price_permanent_nt) || existing.price_permanent_nt,
    slots
  }).write();
  res.redirect('/admin/accounts?msg=account_updated');
});

app.post('/admin/accounts/delete/:id', requireAuth, (req, res) => {
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
app.post('/admin/price-categories/add', requireAuth, (req, res) => {
  const { name, nt_price_10d, nt_price_15d, nt_price_30d, tr_price_10d, tr_price_15d, tr_price_30d } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin?msg=error');
  db.get('price_categories').push({
    id: newPriceCategoryId(),
    name: name.trim(),
    nt_price_10d: parseInt(nt_price_10d) || 149,
    nt_price_15d: parseInt(nt_price_15d) || 199,
    nt_price_30d: parseInt(nt_price_30d) || 349,
    tr_price_10d: parseInt(tr_price_10d) || 199,
    tr_price_15d: parseInt(tr_price_15d) || 249,
    tr_price_30d: parseInt(tr_price_30d) || 399,
  }).write();
  res.redirect('/admin?msg=cat_added');
});

app.post('/admin/price-categories/edit/:id', requireAuth, (req, res) => {
  const { name, nt_price_10d, nt_price_15d, nt_price_30d, tr_price_10d, tr_price_15d, tr_price_30d } = req.body;
  const cat = getPriceCategory(req.params.id);
  if (!cat) return res.redirect('/admin?msg=error');
  db.get('price_categories').find({ id: parseInt(req.params.id) }).assign({
    name: (name || cat.name).trim(),
    nt_price_10d: parseInt(nt_price_10d) || cat.nt_price_10d,
    nt_price_15d: parseInt(nt_price_15d) || cat.nt_price_15d,
    nt_price_30d: parseInt(nt_price_30d) || cat.nt_price_30d,
    tr_price_10d: parseInt(tr_price_10d) || cat.tr_price_10d,
    tr_price_15d: parseInt(tr_price_15d) || cat.tr_price_15d,
    tr_price_30d: parseInt(tr_price_30d) || cat.tr_price_30d,
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
      nt_price_10d: cat.nt_price_10d || g.nt_price_10d,
      nt_price_15d: cat.nt_price_15d || g.nt_price_15d,
      nt_price_30d: cat.nt_price_30d || g.nt_price_30d,
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
      if (!event.message || event.message.is_echo) return;
      const senderId = event.sender.id;
      const text = (event.message.text || '').toLowerCase().trim();
      // Save/update PSID so we can blast later
      const existingContact = db.get('messenger_contacts').find({ psid: senderId }).value();
      if (!existingContact) {
        db.get('messenger_contacts').push({ psid: senderId, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() }).write();
      } else {
        db.get('messenger_contacts').find({ psid: senderId }).assign({ last_seen: new Date().toISOString() }).write();
      }
      handleMessage(senderId, text).catch(e => console.error('[handleMessage]', e));
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
      '   ⏱ 10 days | 15 days | 30 days\n\n' +
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
    const sample = games.filter(g => g.nt_price_10d).slice(0, 4);
    let msg = '💰 PlayStation Hub Pricing\n\n';
    msg += '━━━━━━━━━━━━━━━━━━━\n';
    msg += '🎮 NON-TROPHY ACCOUNT\n';
    msg += '  10D / 15D / 30D\n';
    if (sample.length) {
      sample.forEach(g => {
        msg += `  ${g.title.slice(0,18)}: ₱${g.nt_price_10d}/₱${g.nt_price_15d}/₱${g.nt_price_30d}\n`;
      });
    }
    msg += '\n🏆 TROPHY ACCOUNT (+₱50)\n';
    if (sample.length) {
      sample.forEach(g => {
        if (g.tr_price_10d) msg += `  ${g.title.slice(0,18)}: ₱${g.tr_price_10d}/₱${g.tr_price_15d}/₱${g.tr_price_30d}\n`;
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
    if (promo.enabled && promo.discount_pct > 0) {
      hasPromo = true;
      msg += `⏱️ RENT PROMO — ${promo.discount_pct}% OFF!\n`;
      msg += `   On ${promo.apply_on_days}-day rentals\n`;
      if (promo.deposit) msg += `   +₱${promo.deposit} refundable deposit\n`;
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
    if (g.tr_price_10d) msg += trSlots > 0 ? `✅ Trophy: ${trSlots} slot(s) available\n` : `🔴 Trophy: Fully rented\n`;
    msg += `\n💰 PRICING:\n`;
    msg += `🎮 Non-Trophy: ₱${g.nt_price_10d} / ₱${g.nt_price_15d} / ₱${g.nt_price_30d}\n`;
    if (g.tr_price_10d) msg += `🏆 Trophy: ₱${g.tr_price_10d} / ₱${g.tr_price_15d} / ₱${g.tr_price_30d}\n`;
    msg += `(10 / 15 / 30 days)\n`;
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
        `${g.title} (${g.platform}) — NT: ₱${g.nt_price_10d}/₱${g.nt_price_15d}/₱${g.nt_price_30d}${g.tr_price_10d ? `, TR: ₱${g.tr_price_10d}/₱${g.tr_price_15d}/₱${g.tr_price_30d}` : ''} — ${((g.non_trophy_slots||0)+(g.trophy_slots||0))>0?'Available':'Fully Rented'}`
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
- Rent PS5/PS4 games for 10, 15, or 30 days
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
app.get('/admin/blast/contacts', requireAuth, (req, res) => {
  const contacts = db.get('messenger_contacts').value() || [];
  res.json({ count: contacts.length });
});

app.post('/admin/blast', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.json({ ok: false, error: 'No message provided.' });
  if (!PAGE_ACCESS_TOKEN) return res.json({ ok: false, error: 'MESSENGER_PAGE_TOKEN not configured on server.' });

  const contacts = db.get('messenger_contacts').value() || [];
  if (!contacts.length) return res.json({ ok: false, error: 'No contacts yet. Contacts are saved automatically when people message your Facebook Page.' });

  const https = require('https');
  let sent = 0, failed = 0;

  function sendOne(psid) {
    return new Promise((resolve) => {
      const payload = JSON.stringify({
        recipient: { id: psid },
        message: { text: message },
        messaging_type: 'MESSAGE_TAG',
        tag: 'HUMAN_AGENT'
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

app.listen(PORT, () => {
  console.log(`\n✅ Playstation Hub running at http://localhost:${PORT}`);
  console.log(`🔧 Admin panel at http://localhost:${PORT}/admin\n`);
});


