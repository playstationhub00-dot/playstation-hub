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
  visitors: []
}).write();

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
  res.render('index', { featured, games: all, upcoming, psplusPopular, psplusPrices, psplusSlug: homePsplusSlug, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings() });
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
  res.render('game-detail', { game: resolved, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings() });
});

// ── Admin Promo Settings ──────────────────────────────────────────────────────
app.post('/admin/promo', requireAuth, (req, res) => {
  const { enabled, discount_pct, apply_on_days, deposit } = req.body;
  db.set('site_settings.promo', {
    enabled: enabled === 'on',
    discount_pct: Math.min(100, Math.max(0, parseInt(discount_pct) || 10)),
    apply_on_days: parseInt(apply_on_days) || 30,
    deposit: Math.max(0, parseInt(deposit) || 100)
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
  res.render('admin', { games, upcoming, psplus, psplusPopular, psplusPrices: getPsplusPrices(), psplusSlots: getPsplusSlots(), announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings(), priceCategories: getPriceCategories(), customers, visitors, msg: req.query.msg || null });
});

// Upcoming CRUD
app.post('/admin/upcoming/add', upload.single('cover_image'), requireAuth, (req, res) => {
  const { title, platform, genre, release_date, release_date_tba_val, description } = req.body;
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
  const { title, platform, genre, release_date, release_date_tba_val, description } = req.body;
  const existing = getUpcomingGame(req.params.id);
  if (!existing) return res.redirect('/admin');
  const cover_image = req.file ? '/uploads/' + req.file.filename : existing.cover_image;
  const finalDate = release_date_tba_val === 'TBA' ? 'TBA' : (release_date || 'TBA');
  db.get('upcoming').find({ id: parseInt(req.params.id) }).assign({
    title: title.trim(), platform, genre: genre || '',
    release_date: finalDate, description: description || '', cover_image
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

app.post('/admin/add', upload.single('cover_image'), requireAuth, (req, res) => {
  const { title, platform, available_slots, renters,
    nt_price_10d, nt_price_15d, nt_price_30d,
    tr_price_10d, tr_price_15d, tr_price_30d,
    genre, description, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    price_category_id, price_mode, cost } = req.body;
  if (!title || !title.trim()) return res.redirect('/admin?msg=error');
  const cover_image = req.file ? '/uploads/' + req.file.filename : '';
  const useCategory = price_mode === 'category' && price_category_id;
  const cat = useCategory ? getPriceCategory(price_category_id) : null;
  db.get('games').push({
    id: newId(),
    title: title.trim(),
    platform: platform || 'PS5',
    cover_image,
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

app.post('/admin/edit/:id', upload.single('cover_image'), requireAuth, (req, res) => {
  const { title, platform, available_slots, renters,
    nt_price_10d, nt_price_15d, nt_price_30d,
    tr_price_10d, tr_price_15d, tr_price_30d,
    genre, description, trophy_account, trophy_slots,
    non_trophy_slots, ps4_primary_slots,
    price_category_id, price_mode, cost } = req.body;
  const existing = getGame(req.params.id);
  if (!existing) return res.redirect('/admin');
  const cover_image = req.file ? '/uploads/' + req.file.filename : existing.cover_image;
  const useCategory = price_mode === 'category' && price_category_id;
  const cat = useCategory ? getPriceCategory(price_category_id) : null;
  db.get('games').find({ id: parseInt(req.params.id) }).assign({
    title: title.trim(), platform, cover_image,
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
app.post('/admin/customers/add', requireAuth, (req, res) => {
  const { customer_name, game_id, days, custom_days, account_type, start_date, end_date, price, status, notes } = req.body;
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
  db.get('customers').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?tab=customers&msg=customer_deleted');
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
// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n✅ Playstation Hub running at http://localhost:${PORT}`);
  console.log(`🔧 Admin panel at http://localhost:${PORT}/admin\n`);
});


