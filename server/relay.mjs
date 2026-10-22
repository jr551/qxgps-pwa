#!/usr/bin/env node
/**
 * qxgps-pwa relay — standalone Node server, ZERO npm dependencies.
 *
 * 1. Serves the built PWA from ../dist (override with STATIC_DIR).
 * 2. Relays /mapi  -> MAPI_UPSTREAM   (default http://app.gps666.net)
 *             /rvsgeo -> RVSGEO_UPSTREAM (default http://rvsgeo.gps666.net)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ANTI-FINGERPRINT HEADER REWRITE — this is the whole point of this file.
 * ══════════════════════════════════════════════════════════════════════════
 * Every request that reaches *.gps666.net must look EXACTLY like one from the
 * vendor Dart app (com.flu.qxhlgg). A browser request is trivially
 * fingerprintable: it carries a browser User-Agent plus Origin, Referer,
 * Sec-Fetch-*, Accept, Accept-Language, Cookie, DNT, ... which the Dart app
 * never sends. And the vendor's own headers (user-agent, accept-encoding) are
 * FORBIDDEN fetch headers the browser will not let us set from the page.
 *
 * So on every relayed request we:
 *   - DISCARD every header the browser sent (nothing is forwarded), and
 *   - set EXACTLY the vendor Dart app's headers:
 *         user-agent:       Dart/3.6 (dart:io)
 *         content-type:     application/json; charset=utf-8
 *         accept-encoding:  gzip
 *         host:             <upstream host>
 *     plus content-length, which is body framing the Dart HTTP client also
 *     sends (dropping it would force chunked transfer-encoding, which would
 *     itself look foreign).
 *   - forward the request body unchanged (JSON is copied as-is), and
 *   - forward the full query string unchanged (this is how ?sid=<session>
 *     passes through).
 * Responses go back with status + content-type + body only (decompressed when
 * the upstream answers gzip — the browser never sees a wire-level header
 * mismatch).
 *
 * The browser app calls the vendor API directly over HTTPS by default;
 * this relay is the optional same-origin fallback (VITE_MAPI_URL=/ at build
 * time, then serve dist/ through this server).
 *
 * SAFETY: relay only; no vendor state is ever modified here. The app itself
 * is strictly read-only toward the vendor platform (Get* and get* calls only).
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { gunzip as _gunzip, inflate as _inflate } from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(_gunzip);
const inflate = promisify(_inflate);

const STATIC_DIR = resolve(
  process.env.STATIC_DIR ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist'),
);
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 8787);
const MAPI_UPSTREAM = process.env.MAPI_UPSTREAM ?? 'http://app.gps666.net';
const RVSGEO_UPSTREAM = process.env.RVSGEO_UPSTREAM ?? 'http://rvsgeo.gps666.net';
const UPSTREAM_TIMEOUT_MS = 15_000;

/** Exactly the vendor Dart app's request headers — nothing else may be sent. */
const VENDOR_HEADERS = {
  'user-agent': 'Dart/3.6 (dart:io)',
  'content-type': 'application/json; charset=utf-8',
  'accept-encoding': 'gzip',
};

/** Static-file MIME types (plain object: a small static lookup table). */
const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.length,
  });
  res.end(body);
}

async function decompressGzipIfAny(raw, contentEncoding) {
  if (contentEncoding === 'gzip') return gunzip(raw);
  if (contentEncoding === 'deflate') return inflate(raw);
  return raw;
}

/** Relay one request upstream with the vendor's exact header set. */
async function relay(req, res, upstreamBase) {
  const upstream = new URL(upstreamBase);
  const target = new URL(req.url, upstream); // path + full query (?sid=) preserved
  const requestFn = upstream.protocol === 'https:' ? httpsRequest : httpRequest;

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendText(res, 400, 'bad request body');
    return;
  }

  // Build the header set from scratch: the browser's headers are DROPPED,
  // never forwarded. Only the vendor headers + framing survive. content-length
  // is sent only when there actually is a body (a bodyless GET has none, same
  // as the Dart client).
  const headers = {
    ...VENDOR_HEADERS,
    host: upstream.host,
  };
  if (body.length > 0) {
    headers['content-length'] = body.length;
  }

  const upstreamReq = requestFn(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: target.pathname + target.search,
      headers,
      timeout: UPSTREAM_TIMEOUT_MS,
    },
    async (upstreamRes) => {
      const chunks = [];
      upstreamRes.on('data', (chunk) => chunks.push(chunk));
      upstreamRes.on('end', async () => {
        try {
          const raw = await decompressGzipIfAny(
            Buffer.concat(chunks),
            String(upstreamRes.headers['content-encoding'] ?? ''),
          );
          // Response to the browser: status + content-type + body only.
          res.writeHead(upstreamRes.statusCode ?? 502, {
            'content-type':
              upstreamRes.headers['content-type'] ?? 'application/json; charset=utf-8',
            'content-length': raw.length,
          });
          res.end(raw);
        } catch {
          sendText(res, 502, 'upstream response could not be decoded');
        }
      });
      upstreamRes.on('error', () => sendText(res, 502, 'upstream response failed'));
    },
  );

  upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('upstream timeout')));
  upstreamReq.on('error', (err) => sendText(res, 502, `upstream error: ${err.message}`));
  upstreamReq.end(body);
}

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'method not allowed');
    return;
  }

  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let filePath = resolve(join(STATIC_DIR, normalize(pathname)));
  if (filePath !== STATIC_DIR && !filePath.startsWith(STATIC_DIR + sep)) {
    sendText(res, 403, 'forbidden');
    return;
  }

  let stats = await stat(filePath).catch(() => null);
  if (stats?.isDirectory()) {
    filePath = join(filePath, 'index.html');
    stats = await stat(filePath).catch(() => null);
  }
  if (!stats?.isFile()) {
    // SPA fallback: extension-less paths get index.html (hash routing needs
    // only "/", but deep links must not 404).
    if (extname(pathname) === '') {
      filePath = join(STATIC_DIR, 'index.html');
      stats = await stat(filePath).catch(() => null);
    }
    if (!stats?.isFile()) {
      sendText(res, 404, 'not found');
      return;
    }
  }

  res.writeHead(200, {
    'content-type': MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stats.size,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/mapi' || pathname.startsWith('/mapi/')) {
    relay(req, res, MAPI_UPSTREAM).catch(() => sendText(res, 500, 'relay failure'));
    return;
  }
  if (pathname === '/rvsgeo' || pathname.startsWith('/rvsgeo/')) {
    relay(req, res, RVSGEO_UPSTREAM).catch(() => sendText(res, 500, 'relay failure'));
    return;
  }
  serveStatic(req, res).catch(() => sendText(res, 500, 'static failure'));
});

server.listen(PORT, HOST, () => {
  console.log(`qxgps relay listening on http://${HOST}:${PORT}`);
  console.log(`  static:  ${STATIC_DIR}`);
  console.log(`  /mapi ->   ${MAPI_UPSTREAM}`);
  console.log(`  /rvsgeo -> ${RVSGEO_UPSTREAM}`);
});
