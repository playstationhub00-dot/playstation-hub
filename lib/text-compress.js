// Gzip or Brotli for text responses. Images and other binaries pass through.
//
// Cloudflare already compresses what the visitor downloads, but it fetches
// the uncompressed body from this app, and HTML is not edge-cached (every
// page sets a session cookie). Compressing here is what cuts Railway egress
// on those pages. Brotli quality stays low so a cold CSS file cannot pin a
// CPU core on the hobby dyno.
const zlib = require('zlib');

const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|xhtml\+xml|rss\+xml)|image\/svg\+xml)/i;
const MIN_BYTES = 1024;
const MAX_BYTES = 4 * 1024 * 1024;
const BROTLI_OPTS = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } };

function encodingFor(header) {
  const s = String(header || '');
  if (/\bbr\b/.test(s)) return 'br';
  if (/\bgzip\b/.test(s)) return 'gzip';
  return '';
}

function textCompress() {
  return function (req, res, next) {
    const encoding = encodingFor(req.headers['accept-encoding']);
    if (!encoding || req.method === 'HEAD') return next();

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    let passthrough = false;
    let decided = false;
    const chunks = [];
    let buffered = 0;

    function compressible() {
      if (res.getHeader('Content-Encoding')) return false;
      const type = String(res.getHeader('Content-Type') || '');
      return COMPRESSIBLE.test(type);
    }

    function restore() {
      res.write = originalWrite;
      res.end = originalEnd;
    }

    function sendRaw(cb) {
      restore();
      const body = Buffer.concat(chunks);
      return body.length ? originalEnd(body, cb) : originalEnd(cb);
    }

    function flushThenPass(chunk, enc, cb) {
      passthrough = true;
      restore();
      const body = Buffer.concat(chunks);
      if (body.length) originalWrite(body);
      return originalWrite(chunk, enc, cb);
    }

    res.write = function (chunk, enc, cb) {
      if (passthrough) return originalWrite(chunk, enc, cb);
      if (typeof enc === 'function') { cb = enc; enc = undefined; }
      if (!decided) {
        decided = true;
        if (!compressible()) return flushThenPass(chunk, enc, cb);
      }
      const buf = chunk ? (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc || 'utf8')) : Buffer.alloc(0);
      buffered += buf.length;
      if (buffered > MAX_BYTES) return flushThenPass(chunk, enc, cb);
      if (buf.length) chunks.push(buf);
      if (typeof cb === 'function') cb();
      return true;
    };

    res.end = function (chunk, enc, cb) {
      if (passthrough) return originalEnd(chunk, enc, cb);
      if (typeof chunk === 'function') { cb = chunk; chunk = undefined; enc = undefined; }
      if (typeof enc === 'function') { cb = enc; enc = undefined; }
      if (!decided && chunk && !compressible()) {
        restore();
        return chunk ? originalEnd(chunk, enc, cb) : originalEnd(cb);
      }
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc || 'utf8'));
      }
      const body = Buffer.concat(chunks);
      if (!compressible() || body.length < MIN_BYTES) return sendRaw(cb);

      const zip = encoding === 'br'
        ? (buf, done) => zlib.brotliCompress(buf, BROTLI_OPTS, done)
        : zlib.gzip;
      zip(body, (err, zipped) => {
        if (err || !zipped || zipped.length >= body.length) return sendRaw(cb);
        restore();
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Content-Length', zipped.length);
        const vary = res.getHeader('Vary');
        const varyStr = vary ? String(vary) : '';
        if (!/\baccept-encoding\b/i.test(varyStr)) {
          res.setHeader('Vary', varyStr ? varyStr + ', Accept-Encoding' : 'Accept-Encoding');
        }
        const etag = res.getHeader('ETag');
        if (etag) res.setHeader('ETag', String(etag).replace(/"$/, '-' + encoding + '"'));
        return originalEnd(zipped, cb);
      });
    };

    next();
  };
}

module.exports = { textCompress, encodingFor, MIN_BYTES };
