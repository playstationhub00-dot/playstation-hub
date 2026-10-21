// Gzip or Brotli for text responses. Images and other binaries pass through.
//
// Cloudflare already compresses what the visitor downloads, but it fetches
// the uncompressed body from this app, and HTML is not edge-cached (every
// page sets a session cookie). Compressing here is what cuts Railway egress
// on those pages. Brotli quality stays low so a cold CSS file cannot pin a
// CPU core on the hobby dyno.
//
// express-session, once a cookie already exists, flushes headers before the
// body is finished: it calls writeHead (so on-headers can set the cookie),
// writes every byte but the last, then ends with that last byte. The
// Content-Length on that early writeHead is the uncompressed length express
// already set. Compressing after the headers are on the wire throws
// "headers already sent" and the browser waits until the connection dies —
// that was the admin page spinning after login (fix ae243e2).
//
// The early writeHead is swallowed until the whole body is in hand. The
// cookie is still attached (on-headers runs during that swallowed call and
// setHeader's it). Then the body is compressed, Content-Length is replaced,
// and only then are the headers actually written. A response that is not
// worth compressing is released unchanged, so the length the client was
// promised still matches the bytes.
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

// writeHead(status), writeHead(status, headers), writeHead(status, reason, headers).
// Anything passed only as arguments has to land on the response, because the
// real writeHead is deferred and will not see this call.
function rememberWriteHead(res, args) {
  const statusCode = args[0];
  if (typeof statusCode === 'number') res.statusCode = statusCode;
  let headers;
  if (args.length === 2 && args[1] && typeof args[1] === 'object') headers = args[1];
  else if (args.length >= 3 && args[2] && typeof args[2] === 'object') headers = args[2];
  if (!headers || Array.isArray(headers)) return;
  for (const key of Object.keys(headers)) res.setHeader(key, headers[key]);
}

function textCompress() {
  return function (req, res, next) {
    const encoding = encodingFor(req.headers['accept-encoding']);
    if (!encoding || req.method === 'HEAD') return next();

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const originalWriteHead = res.writeHead.bind(res);
    let passthrough = false;
    let decided = false;
    // True until the final body is known. express-session's early writeHead
    // is remembered but not sent, so Content-Length can still change.
    let holdHeaders = true;
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

    function releaseHeaders() {
      holdHeaders = false;
    }

    res.writeHead = function writeHead(statusCode) {
      if (holdHeaders && !res.headersSent) {
        rememberWriteHead(res, arguments);
        return res;
      }
      return originalWriteHead.apply(res, arguments);
    };

    function sendRaw(cb) {
      releaseHeaders();
      restore();
      const body = Buffer.concat(chunks);
      return body.length ? originalEnd(body, cb) : originalEnd(cb);
    }

    // Headers were held, or this response is not worth compressing.
    // Whatever was buffered has to go out as-is, then this chunk, so the
    // client receives exactly the Content-Length it was promised.
    function flushThenPass(chunk, enc, cb) {
      passthrough = true;
      releaseHeaders();
      restore();
      const body = Buffer.concat(chunks);
      chunks.length = 0;
      if (body.length) originalWrite(body);
      return originalWrite(chunk, enc, cb);
    }

    res.write = function (chunk, enc, cb) {
      if (passthrough) return originalWrite(chunk, enc, cb);
      if (typeof enc === 'function') { cb = enc; enc = undefined; }
      if (res.headersSent) return flushThenPass(chunk, enc, cb);
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
      if (res.headersSent) {
        passthrough = true;
        releaseHeaders();
        restore();
        if (chunks.length) originalWrite(Buffer.concat(chunks));
        return chunk ? originalEnd(chunk, enc, cb) : originalEnd(cb);
      }
      if (!decided && chunk && !compressible()) {
        releaseHeaders();
        restore();
        return chunk ? originalEnd(chunk, enc, cb) : originalEnd(cb);
      }
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc || 'utf8'));
      }
      const body = Buffer.concat(chunks);
      if (!compressible() || body.length < MIN_BYTES || body.length > MAX_BYTES) return sendRaw(cb);

      const zip = encoding === 'br'
        ? (buf, done) => zlib.brotliCompress(buf, BROTLI_OPTS, done)
        : zlib.gzip;
      zip(body, (err, zipped) => {
        if (err || !zipped || zipped.length >= body.length) return sendRaw(cb);
        releaseHeaders();
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
