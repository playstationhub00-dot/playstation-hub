// What a game page shows from PlayStation's data, resolved against the owner's
// own entries. Pure: views/game-detail.ejs gets the result as `psnView`.
//
// Rule: the owner's value wins; PlayStation only fills what the owner left
// empty. A game with no stored `psn` (or one PlayStation did not know) gets
// hasPsn:false and the page renders exactly as it did before this feature.
const READ_MORE_CHARS = 260;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const month = MONTHS[parseInt(m[2], 10) - 1];
  return month ? month + ' ' + parseInt(m[3], 10) + ', ' + m[1] : '';
}

function fmtVoices(list) {
  const v = (list || []).filter(Boolean);
  if (!v.length) return '';
  return v.length <= 3 ? v.join(', ') : v.slice(0, 3).join(', ') + ' +' + (v.length - 3);
}

function fmtSize(gb) {
  const n = Number(gb);
  return n > 0 ? (Number.isInteger(n) ? n : n.toFixed(1)) + ' GB' : '';
}

function buildGamePsnView(game) {
  const g = game || {};
  const psn = g.psn && typeof g.psn === 'object' ? g.psn : null;
  if (!psn) {
    return { hasPsn: false, media: [], hideGallery: false, tagline: '', rating: null, about: '', aboutParas: [], readMore: false, info: [], genre: g.genre || '' };
  }

  const ownerGallery = (g.gallery || []).filter(Boolean);
  const images = ownerGallery.length ? ownerGallery : (psn.screenshots || []);
  const poster = images[0] || g.cover_image || '';
  const media = (psn.videos || []).map(src => ({ type: 'video', src, poster }))
    .concat(images.map(src => ({ type: 'image', src })));

  const about = String(g.description || psn.description || '').trim();
  const genre = g.genre || (psn.genres || []).join(' / ');
  const release = fmtDate(g.release_date || psn.release_date);
  const rows = [
    ['Release date', release],
    ['Genre', genre],
    ['Publisher', psn.publisher || ''],
    ['Size', fmtSize(g.size_gb)],
    ['Platform', g.platform || ''],
    ['Voice', fmtVoices(psn.voices)],
    ['Age rating', psn.age_rating || '']
  ].filter(r => r[1]).map(r => ({ label: r[0], value: r[1] }));

  const rating = psn.rating && psn.rating.avg > 0
    ? { text: '★ ' + Number(psn.rating.avg).toFixed(1), count: Number(psn.rating.count || 0).toLocaleString('en-US') }
    : null;

  return {
    hasPsn: true,
    media,
    // The owner's Gameplay gallery is folded into the media block, so the
    // separate gallery section below the page would only repeat it.
    hideGallery: media.length > 0,
    tagline: psn.tagline || '',
    rating,
    about,
    aboutParas: about ? about.split(/\n{2,}/).map(p => p.trim()).filter(Boolean) : [],
    readMore: about.length > READ_MORE_CHARS,
    info: rows,
    genre
  };
}

module.exports = { buildGamePsnView, fmtDate, fmtVoices, fmtSize, READ_MORE_CHARS };
