'use strict';
// Video Factory — acquire lane (B): local file | direct HTTP(S) URL | public page URL (yt-dlp, optional).
// Safety law: user-provided / user-owned / licensed / public-domain sources only.
// No DRM bypass, no paywall/login bypass, no protected-stream circumvention — unsupported sources fail CLEARLY.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const UA = 'MysticStudio-VideoFactory/1.0 (+https://github.com/ohlalahahaha/mystic-studio)';
const MEDIA_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|mp3|wav|m4a|aac|flac|ogg|ogv)$/i;

class VideoError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.name = 'VideoError';
    this.code = code;
    this.hint = hint || '';
  }
}

function classify(input) {
  if (/^https?:\/\//i.test(input)) {
    let u;
    try { u = new URL(input); } catch { throw new VideoError('EFETCH_INPUT', `unparsable URL: ${input}`); }
    return MEDIA_EXT.test(u.pathname) ? 'url' : 'page';
  }
  if (/^file:\/\//i.test(input)) return 'file';
  return 'file';
}

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

function sha256Text(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function getOnce(url, { maxBytes, timeoutMs, redirectsLeft }, out) {
  return new Promise((resolve, reject) => {
    const mod = /^https:/i.test(url) ? https : http;
    const req = mod.request(url, { method: 'GET', headers: { 'user-agent': UA, accept: '*/*' } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new VideoError('EFETCH_REDIRECT', `too many redirects for ${url}`));
        return resolve(getOnce(new URL(res.headers.location, url).toString(), { maxBytes, timeoutMs, redirectsLeft: redirectsLeft - 1 }, out));
      }
      if (status === 404) { res.resume(); return reject(new VideoError('EFETCH_404', `HTTP 404 for ${url}`)); }
      if (status !== 200) { res.resume(); return reject(new VideoError('EFETCH_HTTP', `HTTP ${status} for ${url}`)); }
      const ct = String(res.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
      const len = Number(res.headers['content-length'] || 0);
      if (len && len > maxBytes) {
        res.resume();
        return reject(new VideoError('EGUARD_SIZE', `content-length ${len} exceeds guard ${maxBytes} bytes`, 'raise max_bytes_mb if this media is trusted'));
      }
      let n = 0;
      let settled = false;
      const f = fs.createWriteStream(out);
      const bail = (err) => { if (settled) return; settled = true; try { f.close(); } catch {} try { fs.unlinkSync(out); } catch {} reject(err); };
      res.on('data', (d) => {
        n += d.length;
        if (n > maxBytes) { try { req.destroy(); } catch {} bail(new VideoError('EGUARD_SIZE', `stream exceeded ${maxBytes} bytes`, 'raise max_bytes_mb if trusted')); }
      });
      res.on('error', (e) => bail(e && e.code ? e : new VideoError('EFETCH_NETWORK', String(e.message || e))));
      f.on('error', (e) => bail(e));
      f.on('finish', () => { if (!settled) { settled = true; resolve({ contentType: ct, bytes: n, finalUrl: url }); } });
      res.pipe(f);
    });
    req.on('error', (e) => reject(e && e.code ? e : new VideoError('EFETCH_NETWORK', String(e.message || e))));
    req.setTimeout(timeoutMs, () => req.destroy(new VideoError('EGUARD_TIMEOUT', `fetch exceeded ${timeoutMs}ms`, 'raise timeout_ms or use a faster source')));
    req.end();
  });
}

async function fetchUrl(url, dest, opts) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await getOnce(url, { maxBytes: opts.maxBytes, timeoutMs: opts.timeoutMs, redirectsLeft: 5 }, dest);
      const okType = /^(video|audio)\//.test(r.contentType) || r.contentType === 'application/octet-stream' || r.contentType === '' || MEDIA_EXT.test(new URL(r.finalUrl).pathname);
      if (!okType) {
        try { fs.unlinkSync(dest); } catch {}
        throw new VideoError('EFETCH_TYPE', `refusing non-media content-type "${r.contentType || 'unknown'}" (HTML passed as media?)`, 'pass the direct media file URL, or use a page URL with yt-dlp installed');
      }
      return r;
    } catch (e) {
      lastErr = e;
      if (e.code === 'EFETCH_404' || e.code === 'EFETCH_TYPE' || e.code === 'EGUARD_SIZE' || e.code === 'EGUARD_TIMEOUT' || e.code === 'EFETCH_REDIRECT' || e.code === 'EFETCH_HTTP') throw e;
      try { fs.unlinkSync(dest); } catch {}
    }
  }
  throw lastErr;
}

function ytDlpVersion() {
  const r = spawnSync('yt-dlp', ['--version'], { encoding: 'utf8', timeout: 15000 });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

function fetchPage(url, dest, opts) {
  const v = ytDlpVersion();
  if (!v) {
    throw new VideoError('EUNSUPPORTED_SOURCE', `page URL needs yt-dlp, which is not installed: ${url}`, 'install yt-dlp, or pass a direct media URL / local file');
  }
  const r = spawnSync('yt-dlp', [
    '--no-playlist', '--no-progress', '--no-warnings',
    '-f', 'mp4/best[ext=mp4]/best',
    '--max-filesize', String(opts.maxBytes),
    '--socket-timeout', String(Math.max(1, Math.ceil(opts.timeoutMs / 1000))),
    '-o', dest, url,
  ], { encoding: 'utf8', timeout: Math.min(Math.max(opts.timeoutMs * 2, 60000), 300000), maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || !fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    const tail = String(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ').slice(0, 400);
    throw new VideoError('EUNSUPPORTED_SOURCE', `page fetch failed for ${url} (source may be protected, DRM-encumbered, login-gated, or unsupported — protection bypass is intentionally not supported)`, tail);
  }
  return { contentType: 'video/mp4', bytes: fs.statSync(dest).size, finalUrl: url, adapter: `yt-dlp ${v}` };
}

async function acquire(input, rawDir, opts) {
  opts = opts || {};
  const maxBytes = Math.max(1, Number(opts.maxBytesMb || 19)) * 1024 * 1024;
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 60000));
  fs.mkdirSync(rawDir, { recursive: true });
  const kind = classify(input);
  let result;
  if (kind === 'file') {
    const src = input.replace(/^file:\/\//, '');
    let st;
    try { st = fs.statSync(src); } catch { throw new VideoError('EFETCH_INPUT', `input file not found: ${src}`); }
    if (!st.isFile()) throw new VideoError('EFETCH_INPUT', `input is not a regular file: ${src}`);
    if (st.size === 0) throw new VideoError('EFETCH_INPUT', `input file is empty: ${src}`);
    if (st.size > maxBytes) throw new VideoError('EGUARD_SIZE', `input ${st.size} bytes exceeds guard ${maxBytes}`, 'raise max_bytes_mb if trusted');
    const dest = path.join(rawDir, 'input' + (path.extname(src) || '.bin'));
    fs.copyFileSync(src, dest);
    result = { path: dest, bytes: st.size, contentType: '', finalUrl: src, adapter: 'file-copy' };
  } else if (kind === 'url') {
    const dest = path.join(rawDir, 'input.mp4');
    const r = await fetchUrl(input, dest, { maxBytes, timeoutMs });
    result = { path: dest, bytes: fs.statSync(dest).size, contentType: r.contentType, finalUrl: r.finalUrl, adapter: 'direct-http' };
  } else {
    // page or extension-less URL: try strict direct fetch first, fall back to safe page adapter
    const dest = path.join(rawDir, 'input.mp4');
    try {
      const r = await fetchUrl(input, dest, { maxBytes, timeoutMs });
      result = { path: dest, bytes: fs.statSync(dest).size, contentType: r.contentType, finalUrl: r.finalUrl, adapter: 'direct-http' };
    } catch (e) {
      if (e.code !== 'EFETCH_TYPE') throw e;
      const r = fetchPage(input, dest, { maxBytes, timeoutMs });
      result = { path: dest, bytes: r.bytes, contentType: r.contentType, finalUrl: r.finalUrl, adapter: r.adapter };
    }
  }
  result.kind = kind;
  result.sha256 = await sha256File(result.path);
  result.acquisitionTime = new Date().toISOString();
  return result;
}

function sha256FileSync(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// curl is a declared repo dependency (README: Node 18+, curl). Sync by design (repo law).
function curlFetch(url, dest, opts) {
  const timeoutS = Math.max(1, Math.ceil(opts.timeoutMs / 1000));
  const r = spawnSync('curl', ['-sS', '-L', '--fail', '--max-time', String(timeoutS), '--max-filesize', String(opts.maxBytes), '-A', UA, '-o', dest, '-w', '\n%{http_code} %{content_type}', url], {
    encoding: 'utf8', timeout: (timeoutS + 15) * 1000, maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error) {
    if (r.error.code === 'ENOENT') throw new VideoError('EFETCH_NETWORK', 'curl is required but not installed', 'install curl (declared repo dependency)');
    if (r.error.code === 'ETIMEDOUT') throw new VideoError('EGUARD_TIMEOUT', `fetch exceeded ${timeoutS}s`, 'raise timeout_ms');
    throw new VideoError('EFETCH_NETWORK', String(r.error.message || r.error));
  }
  const outLines = String(r.stdout || '').trim().split('\n');
  const meta = (outLines[outLines.length - 1] || '').trim().split(/\s+/);
  const code = Number(meta[0] || 0);
  const ct = (meta.slice(1).join(' ') || '').toLowerCase();
  if (r.status === 22) {
    if (code === 404) throw new VideoError('EFETCH_404', `HTTP 404 for ${url}`);
    throw new VideoError('EFETCH_HTTP', `HTTP ${code || r.status} for ${url}`);
  }
  if (r.status === 63) throw new VideoError('EGUARD_SIZE', `download exceeds guard ${opts.maxBytes} bytes`, 'raise max_bytes_mb if trusted');
  if (r.status === 28) throw new VideoError('EGUARD_TIMEOUT', `curl timeout ${timeoutS}s`, 'raise timeout_ms');
  if (r.status !== 0) throw new VideoError('EFETCH_NETWORK', `curl exit ${r.status} for ${url}`, String(r.stderr || '').slice(0, 200));
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) throw new VideoError('EFETCH_NETWORK', `empty download for ${url}`);
  if (fs.statSync(dest).size > opts.maxBytes) { try { fs.unlinkSync(dest); } catch {} throw new VideoError('EGUARD_SIZE', `download exceeds guard ${opts.maxBytes} bytes`); }
  return { contentType: ct, bytes: fs.statSync(dest).size, finalUrl: url };
}

function contentTypeOk(ct, url) {
  return /^(video|audio)\//.test(ct) || ct.includes('octet-stream') || ct === '' || MEDIA_EXT.test(new URL(url).pathname);
}

function acquireSync(input, rawDir, opts) {
  opts = opts || {};
  const maxBytes = Math.max(1, Number(opts.maxBytesMb || 19)) * 1024 * 1024;
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 60000));
  fs.mkdirSync(rawDir, { recursive: true });
  const kind = classify(input);
  let result;
  if (kind === 'file') {
    const src = input.replace(/^file:\/\//, '');
    let st;
    try { st = fs.statSync(src); } catch { throw new VideoError('EFETCH_INPUT', `input file not found: ${src}`); }
    if (!st.isFile()) throw new VideoError('EFETCH_INPUT', `input is not a regular file: ${src}`);
    if (st.size === 0) throw new VideoError('EFETCH_INPUT', `input file is empty: ${src}`);
    if (st.size > maxBytes) throw new VideoError('EGUARD_SIZE', `input ${st.size} bytes exceeds guard ${maxBytes}`, 'raise max_bytes_mb if trusted');
    const dest = path.join(rawDir, 'input' + (path.extname(src) || '.bin'));
    fs.copyFileSync(src, dest);
    result = { path: dest, bytes: st.size, contentType: '', finalUrl: src, adapter: 'file-copy' };
  } else if (kind === 'url') {
    const dest = path.join(rawDir, 'input.mp4');
    const r = curlFetch(input, dest, { maxBytes, timeoutMs });
    if (!contentTypeOk(r.contentType, r.finalUrl)) {
      try { fs.unlinkSync(dest); } catch {}
      throw new VideoError('EFETCH_TYPE', `refusing non-media content-type "${r.contentType || 'unknown'}" (HTML passed as media?)`, 'pass the direct media URL, or install yt-dlp for page URLs');
    }
    result = { path: dest, bytes: r.bytes, contentType: r.contentType, finalUrl: r.finalUrl, adapter: 'curl-direct' };
  } else {
    const dest = path.join(rawDir, 'input.mp4');
    let r = null;
    try {
      const rr = curlFetch(input, dest, { maxBytes, timeoutMs });
      if (contentTypeOk(rr.contentType, rr.finalUrl)) r = rr;
      else { try { fs.unlinkSync(dest); } catch {} }
    } catch (e) {
      if (e.code !== 'EFETCH_TYPE') throw e;
    }
    if (r) result = { path: dest, bytes: r.bytes, contentType: r.contentType, finalUrl: r.finalUrl, adapter: 'curl-direct' };
    else {
      const pr = fetchPage(input, dest, { maxBytes, timeoutMs });
      result = { path: dest, bytes: pr.bytes, contentType: pr.contentType, finalUrl: pr.finalUrl, adapter: pr.adapter };
    }
  }
  result.kind = kind;
  result.sha256 = sha256FileSync(result.path);
  result.acquisitionTime = new Date().toISOString();
  return result;
}

module.exports = { VideoError, classify, acquire, acquireSync, sha256File, sha256FileSync, sha256Text, ytDlpVersion, curlFetch, contentTypeOk, MEDIA_EXT, UA };
