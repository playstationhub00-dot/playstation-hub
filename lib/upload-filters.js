// Multer fileFilter functions. Pulled out of server.js so the rejection
// behaviour — the actual bug this exists to prevent — can be tested without
// booting the server.
//
// multer's own convention for rejecting a file is `cb(null, false)`: skip it,
// no error, nothing for the route handler to see. Used here, an unsupported
// upload (an iPhone photo saved as HEIC, most often) failed completely
// silently — the route ran anyway, the picture just never made it into the
// saved fields, and the page reloaded showing the old one with nothing on
// screen to explain why. Rejecting with a real Error instead routes it
// through server.js's global error handler, which turns it into an actual
// message on the page.
function imageFileFilter(req, file, cb) {
  if (/jpeg|jpg|png|gif|webp/.test(file.mimetype)) return cb(null, true);
  cb(Object.assign(new Error('unsupported image type'), { code: 'BAD_FILE_TYPE' }));
}

module.exports = { imageFileFilter };
