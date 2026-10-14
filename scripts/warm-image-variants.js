// Prebuild the smaller card and thumbnail copies that /uploads/w/ would
// otherwise create on the first view.
//
// Safe to run more than once: files that already exist are skipped, and the
// originals are not modified or deleted. Game pages keep using the originals.
//
// Do not point this at the live Railway volume unless you intend to write
// there. Copy the volume (or games.json plus the uploads folder) somewhere
// else and run:
//
//   DATA_DIR=/path/to/copy node scripts/warm-image-variants.js
//
// With no DATA_DIR it reads the project directory, which has no production
// uploads. It does not connect to MongoDB and does not start the server.
const fs = require('fs');
const path = require('path');
const imageVariants = require('../lib/image-variants');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
const uploadsDir = path.join(dataDir, 'uploads');
const dbPath = path.join(dataDir, 'games.json');

function add(set, url) {
  if (typeof url === 'string' && url.startsWith('/uploads/')) set.add(url.split('?')[0]);
}

function collect(db) {
  const urls = new Set();
  (db.games || []).forEach(g => { add(urls, g.cover_image); (g.gallery || []).forEach(u => add(urls, u)); });
  (db.upcoming || []).forEach(g => { add(urls, g.cover_image); (g.gallery || []).forEach(u => add(urls, u)); });
  (db.psplus || []).forEach(e => add(urls, e.cover_image));
  (db.psplus_popular || []).forEach(e => add(urls, e.cover_image));
  const s = db.site_settings || {};
  if (s.popup) add(urls, s.popup.image_path);
  if (s.promo && s.promo.media_type === 'image') add(urls, s.promo.media_path);
  (s.hero_slides || []).forEach(sl => add(urls, sl.path));
  if (s.hero_bg && s.hero_bg.type === 'image') add(urls, s.hero_bg.path);
  (db.signin_steps || []).forEach(step => add(urls, step.image));
  return [...urls];
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error('No games.json at ' + dbPath);
    process.exit(1);
  }
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const urls = collect(db);
  const widths = [...imageVariants.WIDTHS];
  let wrote = 0;
  let skipped = 0;
  let missing = 0;
  for (const url of urls) {
    const name = path.basename(url);
    for (const width of widths) {
      const before = path.join(uploadsDir, '_variants', String(width), name + '.webp');
      const existed = fs.existsSync(before);
      const result = await imageVariants.ensureVariant({ uploadsDir, width, name });
      if (!result) { missing++; continue; }
      if (result.redirect) { missing++; continue; }
      if (existed || result.file === path.join(uploadsDir, name)) skipped++;
      else wrote++;
    }
  }
  console.log('urls ' + urls.length + ', variants written ' + wrote + ', already present or small enough ' + skipped + ', missing ' + missing);
}

main().catch(e => { console.error(e); process.exit(1); });
