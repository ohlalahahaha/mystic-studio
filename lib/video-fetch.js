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

function sha256Text(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function sha256FileSync(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// curl is a declared repo dependency (README: Node 18+, curl). Sync by design (repo law).
function curlFetch(url, dest, opts) {
  try { return curlOnce(url, dest, opts); }
  catch (e) { if (e && e.code === 'EFETCH_NETWORK') return curlOnce(url, dest, opts); throw e; }
}

function curlOnce(url, dest, opts) {
  const timeoutS = Math.max(1, Math.ceil(opts.timeoutMs / 1000));
  const r = spawnSync('curl', ['-sS', '-L', '--fail', '--proto', '=http,https', '--proto-redir', '=http,https', '--max-time', String(timeoutS), '--max-filesize', String(opts.maxBytes), '-A', UA, '-o', dest, '-w', '\n%{http_code} %{content_type}', url], {
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
  // Server declaration is authoritative. No declaration -> let ffprobe decide (EPROBE path).
  if (!ct) return true;
  return /^(video|audio)\//.test(ct) || ct.includes('octet-stream');
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

module.exports = { VideoError, classify, acquireSync, sha256FileSync, sha256Text, ytDlpVersion, curlFetch, contentTypeOk, MEDIA_EXT, UA };
