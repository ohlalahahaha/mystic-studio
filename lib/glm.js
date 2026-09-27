'use strict';
// Z.ai hosted GLM-Image - text-to-image only, via the documented HTTP API.
// POST {glmImageBase}/images/generations, Bearer auth, JSON body; response {created, data:[{url}]}.
// The API key is used ONLY on the generation call - never on the image download, never logged.
// Errors are sanitized: HTTP status and a bounded numeric provider code at most - never
// response bodies, raw stderr, or other response fields. No silent fallback, ever.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const DEFAULT_MODEL = 'glm-image';
const QUALITIES = ['hd', 'standard'];
// Officially recommended resolutions (docs.z.ai/guides/image/glm-image) plus custom
// sizes: both sides a multiple of 32 within 512-2048.
const RECOMMENDED_SIZES = ['1280x1280', '1568x1056', '1056x1568', '1472x1088', '1088x1472', '1728x960', '960x1728'];
// aspect_ratio maps to documented recommended sizes; other ratios must pass size explicitly.
const ASPECT_MAP = { '1:1': '1280x1280', '16:9': '1728x960', '9:16': '960x1728' };

// spawnSync resolved at call time so tests can simulate transport behavior.
function sh(args, timeoutMs) {
  const r = cp.spawnSync('curl', args, { encoding: 'utf8', timeout: timeoutMs || 310000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error('curl transport failure');
  return r;
}

// Only a bounded numeric provider code is ever echoed; anything else is omitted.
function safeCode(code) {
  const s = String(code === undefined || code === null ? '' : code);
  return /^\d{1,10}$/.test(s) ? s : '';
}

function normalizeSize(size) { return String(size === undefined || size === null ? '' : size).trim().toLowerCase(); }

function validSize(size) {
  const s = normalizeSize(size);
  if (RECOMMENDED_SIZES.includes(s)) return true;
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(s);
  if (!m) return false;
  const w = Number(m[1]), h = Number(m[2]);
  return w % 32 === 0 && h % 32 === 0 && w >= 512 && h >= 512 && w <= 2048 && h <= 2048;
}

// Resolved provider id: explicit per-call argument wins, then config default, then higgsfield.
// Unknown providers fail loudly - never a quiet fallback to something else.
function provider(c, a) {
  const p = String((a && a.provider) || c.imageProvider || 'higgsfield').trim().toLowerCase();
  if (p === 'higgsfield' || p === 'glm') return p;
  throw new Error("unknown image provider '" + p + "' - known providers: higgsfield, glm (pass provider per call or set imageProvider in config)");
}

function requireKey(c) {
  if (c.zaiKey) return c.zaiKey;
  throw new Error(
    'no ZAI_API_KEY - the glm provider (Z.ai hosted GLM-Image, paid $0.015/image) needs it. ' +
    'Put ZAI_API_KEY in your shell env, ~/.config/mystic-studio/.env, or ~/.config/mystic/.env (copy .env.example), ' +
    'or use the default higgsfield provider instead. The key stays server-side: never logged, never sent to the image download host.'
  );
}

function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); }
function slug(s) { return (String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'job').slice(0, 28); }

// Text to image. All input validation happens before any network call.
function generate(c, a) {
  a = a || {};
  if (a.image !== undefined || a.images !== undefined || a.image_url !== undefined) {
    throw new Error('glm-image is text-to-image only - the hosted API has no image input. Drop the image argument, or use the higgsfield provider for image work.');
  }
  const model = String(a.model || DEFAULT_MODEL).trim();
  if (model !== DEFAULT_MODEL) throw new Error("unsupported model '" + model + "' - the only hosted glm model in scope is glm-image");
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) throw new Error('glm-image needs a non-empty text prompt - this API has no image input (edits stay on the higgsfield provider)');
  let size;
  if (a.size !== undefined && a.size !== '') {
    size = normalizeSize(a.size);
    if (!validSize(size)) throw new Error("invalid size '" + a.size + "' - glm-image accepts " + RECOMMENDED_SIZES.join(', ') + ', or custom WxH with both sides a multiple of 32 within 512-2048');
  } else if (a.aspect_ratio !== undefined && a.aspect_ratio !== '') {
    const ratio = normalizeSize(a.aspect_ratio);
    if (!ASPECT_MAP[ratio]) throw new Error("unsupported aspect_ratio '" + a.aspect_ratio + "' for glm - supported: " + Object.keys(ASPECT_MAP).join(', ') + ', or pass size explicitly');
    size = ASPECT_MAP[ratio];
  }
  if (!size) size = '1280x1280';
  const body = { model, prompt, size };
  if (a.quality !== undefined && a.quality !== '') {
    if (!QUALITIES.includes(a.quality)) throw new Error("invalid quality '" + a.quality + "' - glm-image accepts hd or standard");
    body.quality = a.quality;
  }
  const key = requireKey(c);
  const bodyFile = path.join(os.tmpdir(), 'studio-glm-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(bodyFile, JSON.stringify(body));
  let r;
  try {
    // argv (which carries the Authorization header) is never echoed; sh() output holds the response only.
    r = sh(['-sS', '-m', '300', '-w', '\n%{http_code}', '-H', 'Authorization: Bearer ' + key, '-H', 'Content-Type: application/json',
      '--data-binary', '@' + bodyFile, c.glmImageBase + '/images/generations']);
  } catch (e) {
    throw new Error('glm-image request failed (curl transport error)');
  } finally { try { fs.unlinkSync(bodyFile); } catch (e) {} }
  if (r.status !== 0) {
    throw new Error('glm-image request failed (curl exit ' + (Number.isInteger(r.status) ? r.status : 'unknown') + ')');
  }
  const reply = String(r.stdout || '');
  const nl = reply.lastIndexOf('\n');
  const httpCode = nl >= 0 ? reply.slice(nl + 1).trim() : '';
  const text = nl >= 0 ? reply.slice(0, nl) : reply;
  let j = null;
  try { j = JSON.parse(text); } catch (e) { j = null; }
  if (httpCode && !/^2/.test(httpCode)) {
    const hint = j && j.error ? safeCode(j.error.code) : '';
    throw new Error('glm-image API error: HTTP ' + httpCode + (hint ? ' code=' + hint : '') + ' - check ZAI_API_KEY and account credit (response body is not echoed)');
  }
  if (!j) throw new Error('glm-image returned non-JSON (HTTP ' + (httpCode || 'unknown') + ')');
  const url = j.data && j.data[0] && j.data[0].url;
  if (!url) throw new Error('glm-image reply had no image url (HTTP ' + (httpCode || 'unknown') + ')');
  return { url, model, size };
}

function isImageFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    const bytes = fs.readSync(fd, head, 0, 12, 0);
    const b = head.slice(0, bytes);
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return true; // PNG full 8-byte magic
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true; // JPEG
    if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return true;
    return false;
  } catch (e) { return false; }
  finally { try { if (fd !== undefined) fs.closeSync(fd); } catch (e) {} }
}

// Download WITHOUT credentials: the image host never sees the API key.
// Unique filename per job; partial or non-image files are cleaned up on every failure path,
// including thrown transport errors (timeouts).
function download(c, url, prompt) {
  let u;
  try { u = new URL(url); } catch (e) { throw new Error('glm-image returned an unparseable image url - refusing to download'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('glm-image returned a non-http(s) image url - refusing to download');
  const extMatch = path.basename(u.pathname).match(/\.(png|jpe?g|webp)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase().replace('.jpeg', '.jpg') : '.png';
  const out = path.join(c.outDir, 'glm-' + slug(prompt) + '-' + stamp() + '-' + Math.random().toString(36).slice(2, 6) + ext);
  const limit = c.maxImageMb * 1024 * 1024;
  const fail = (msg) => { try { fs.unlinkSync(out); } catch (e) {} throw new Error(msg); };
  let r;
  try {
    r = sh(['-sS', '-f', '-L', '--max-filesize', String(limit), '-m', '300', '-o', out, url]);
  } catch (e) {
    return fail('glm-image download failed (curl transport error)');
  }
  if (r.status !== 0) return fail('glm-image download failed (curl exit ' + (Number.isInteger(r.status) ? r.status : 'unknown') + ')');
  let size = 0;
  try { size = fs.statSync(out).size; } catch (e) {}
  if (size <= 0) return fail('glm-image download failed: saved file is empty');
  if (size > limit) return fail('glm-image download over ' + c.maxImageMb + 'MB limit (' + (size / 1048576).toFixed(1) + 'MB) - raise maxImageMb if intended');
  if (!isImageFile(out)) return fail('glm-image download is not a supported image (png/jpg/webp) - file discarded');
  return out;
}

function catalog() {
  return [
    'glm (Z.ai hosted GLM-Image) - TEXT-TO-IMAGE ONLY, paid API ($0.015/image)',
    '  ' + DEFAULT_MODEL + '  sizes: 1280x1280 (default), 1568x1056, 1056x1568, 1472x1088, 1088x1472, 1728x960, 960x1728;',
    '    custom WxH with both sides a multiple of 32 within 512-2048; quality hd|standard; aspect_ratio 1:1|16:9|9:16 maps to recommended sizes',
    '  auth: ZAI_API_KEY (shell env, ~/.config/mystic-studio/.env, or ~/.config/mystic/.env) - server-side only, never sent to the image download host',
    '  image editing is NOT supported by this provider - photo_edit stays on higgsfield',
    '  docs: https://docs.z.ai/guides/image/glm-image',
  ].join('\n');
}

function doctorNote(c) {
  const selected = String(c.imageProvider || 'higgsfield');
  if (!c.zaiKey) return 'ZAI_API_KEY not set - "generate --provider glm" needs it (shell env or the .env file). Paid API $0.015/image; default provider stays ' + selected;
  return 'ZAI_API_KEY configured (value never shown) - live generation not verified by doctor. Paid API $0.015/image; default provider ' + selected;
}

module.exports = { provider, validSize, requireKey, generate, download, catalog, doctorNote, isImageFile, safeCode, DEFAULT_MODEL, QUALITIES, RECOMMENDED_SIZES, ASPECT_MAP };
