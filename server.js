const express = require('express');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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
  admin_password: 'admin123',
  price_categories: [],
  nextPriceCategoryId: 1,
  customers: [],
  nextCustomerId: 1
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
  res.render('ps-plus', { byYear, years, popular, prices: getPsplusPrices(), announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings() });
});

// PS Plus admin CRUD
app.post('/admin/psplus/add', upload.single('cover_image'), requireAuth, (req, res) => {
  const { year, month, games_list, notes } = req.body;
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
  const { year, month, games_list, notes } = req.body;
  const existing = getPsplusEntry(req.params.id);
  if (!existing) return res.redirect('/admin');
  const cover_image = req.file ? '/uploads/' + req.file.filename : existing.cover_image;
  db.get('psplus').find({ id: parseInt(req.params.id) }).assign({
    year: parseInt(year),
    month: parseInt(month),
    month_name: new Date(year, month - 1).toLocaleString('en', { month: 'long' }),
    cover_image,
    games_list: games_list || '',
    notes: notes || ''
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

// Update PS Plus global prices
app.post('/admin/psplus/prices', requireAuth, (req, res) => {
  const { nt_price_10d, nt_price_15d, nt_price_30d, tr_price_10d, tr_price_15d, tr_price_30d } = req.body;
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

function sortUpcoming(list) {
  return [...list].sort((a, b) => {
    const da = (!a.release_date || a.release_date === 'TBA') ? 'ZZZZ' : a.release_date;
    const db2 = (!b.release_date || b.release_date === 'TBA') ? 'ZZZZ' : b.release_date;
    return da.localeCompare(db2);
  });
}

app.get('/', (req, res) => {
  const all = getGames().map(resolveGamePrices).sort((a, b) => a.title.localeCompare(b.title));
  const featured = [...all].sort((a, b) => b.renters - a.renters).slice(0, 5);
  const upcoming = sortUpcoming(getUpcoming());
  res.render('index', { featured, games: all, upcoming, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings() });
});

app.get('/browse', (req, res) => {
  const { search, platform, genre } = req.query;
  let games = getGames().map(resolveGamePrices);
  if (search) {
    const q = search.toLowerCase();
    games = games.filter(g =>
      g.title.toLowerCase().includes(q) ||
      (g.description && g.description.toLowerCase().includes(q))
    );
  }
  if (platform) games = games.filter(g => g.platform === platform);
  if (genre) games = games.filter(g => g.genre === genre);
  games.sort((a, b) => a.title.localeCompare(b.title));
  const genres = [...new Set(getGames().map(g => g.genre).filter(Boolean))].sort();
  const upcoming = sortUpcoming(getUpcoming());
  res.render('browse', { games, search: search || '', platform: platform || '', genre: genre || '', genres, upcoming, announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings() });
});

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
  res.render('admin', { games, upcoming, psplus, psplusPopular, psplusPrices: getPsplusPrices(), announcement: getAnnouncement(), announcements: getAnnouncements(), settings: getSiteSettings(), priceCategories: getPriceCategories(), customers });
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
    genre, description, trophy_account, price_category_id, price_mode, cost } = req.body;
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
    trophy_account: trophy_account === 'on',
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
    genre, description, trophy_account, price_category_id, price_mode, cost } = req.body;
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
    trophy_account: trophy_account === 'on',
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

// Customer CRUD
app.post('/admin/customers/add', requireAuth, (req, res) => {
  const { customer_name, game_id, days, custom_days, account_type, start_date, end_date, price, status, notes } = req.body;
  const actualDays = days === 'custom' ? (parseInt(custom_days) || 1) : (parseInt(days) || 10);
  if (!customer_name || !customer_name.trim() || !game_id) return res.redirect('/admin?tab=customers&msg=error');
  const game = getGame(game_id);
  if (!game) return res.redirect('/admin?tab=customers&msg=error');
  const resolved = resolveGamePrices(game);
  const priceVal = parseInt(price) || (days === 'custom' ? 0 : (account_type === 'tr'
    ? (resolved['tr_price_'+days+'d'] || 0)
    : (resolved['nt_price_'+days+'d'] || 0)));
  const id = newCustomerId();
  db.get('customers').push({
    id,
    customer_name: customer_name.trim(),
    game_id: parseInt(game_id),
    game_title: game.title,
    days: actualDays,
    account_type: account_type || 'nt',
    start_date: start_date || '',
    end_date: end_date || '',
    price: priceVal,
    status: status || 'renting',
    notes: notes || '',
    created_at: new Date().toISOString()
  }).write();
  // Adjust slots if renting or bought
  const activeStatus = status || 'renting';
  if (activeStatus === 'renting' || activeStatus === 'bought') {
    const slots = game.available_slots || 0;
    db.get('games').find({ id: parseInt(game_id) }).assign({
      available_slots: Math.max(0, slots - 1),
      renters: (game.renters || 0) + 1
    }).write();
  }
  res.redirect('/admin?tab=customers&msg=customer_added');
});

app.get('/admin/customers/edit/:id', requireAuth, (req, res) => {
  const customer = getCustomer(req.params.id);
  if (!customer) return res.redirect('/admin?tab=customers');
  const games = getGames().map(resolveGamePrices).sort((a, b) => a.title.localeCompare(b.title));
  res.render('edit-customer', { customer, games, settings: getSiteSettings() });
});

app.post('/admin/customers/edit/:id', requireAuth, (req, res) => {
  const { customer_name, game_id, days, custom_days, account_type, start_date, end_date, price, status, notes } = req.body;
  const actualDays = days === 'custom' ? (parseInt(custom_days) || 1) : (parseInt(days) || 10);
  const existing = getCustomer(req.params.id);
  if (!existing) return res.redirect('/admin?tab=customers&msg=error');
  const wasActive = existing.status === 'renting' || existing.status === 'bought';
  const isActive = status === 'renting' || status === 'bought';
  const gameChanged = parseInt(game_id) !== existing.game_id;

  // Revert old game slot change if was active
  if (wasActive) {
    const oldGame = getGame(existing.game_id);
    if (oldGame) {
      db.get('games').find({ id: oldGame.id }).assign({
        available_slots: (oldGame.available_slots || 0) + 1
      }).write();
    }
  }
  // Apply new game slot change if now active
  if (isActive) {
    const newGame = getGame(game_id);
    if (newGame) {
      db.get('games').find({ id: newGame.id }).assign({
        available_slots: Math.max(0, (newGame.available_slots || 0) - 1)
      }).write();
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
  if (wasActive !== isActive) {
    const game = getGame(existing.game_id);
    if (game) {
      db.get('games').find({ id: game.id }).assign({
        available_slots: Math.max(0, (game.available_slots || 0) + (isActive ? -1 : 1))
      }).write();
    }
  }
  db.get('customers').find({ id: parseInt(req.params.id) }).assign({ status }).write();
  res.redirect('/admin?tab=customers&msg=customer_updated');
});

app.post('/admin/customers/delete/:id', requireAuth, (req, res) => {
  const existing = getCustomer(req.params.id);
  if (!existing) return res.redirect('/admin?tab=customers&msg=error');
  // Restore slot if was renting or bought
  if (existing.status === 'renting' || existing.status === 'bought') {
    const game = getGame(existing.game_id);
    if (game) {
      db.get('games').find({ id: game.id }).assign({
        available_slots: (game.available_slots || 0) + 1
      }).write();
    }
  }
  db.get('customers').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?tab=customers&msg=customer_deleted');
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

app.listen(PORT, () => {
  console.log(`\n✅ Playstation Hub running at http://localhost:${PORT}`);
  console.log(`🔧 Admin panel at http://localhost:${PORT}/admin\n`);
});


