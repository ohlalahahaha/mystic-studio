'use strict';
// Native Gemini image generation ("Nano Banana") via Google's generativelanguage
// REST API: POST {geminiImageBase}/models/{model}:generateContent. This is the
// direct image endpoint - fully separate from the OpenAI-compatible review base
// (geminiBase) used for photo_see/web_review.
//
// Auth: GEMINI_API_KEY (shared with vision analysis). It is passed to curl through
// stdin config ('--config -') - never in argv, never in a temp header file, never
// logged. No redirects are followed, so the authenticated host cannot be redirected
// anywhere else. One request per job: no retries, no provider fallback, ever.
// Errors are sanitized: HTTP status plus a bounded numeric code at most - never
// response bodies, raw stderr, or secrets. Image output is decoded from
// candidates[].content.parts[].inlineData (thought parts are skipped), checked for
// size and image signature/trailer sanity, and saved into the configured outDir.
// A present key is NOT proof a generation succeeds: image output is paid API usage
// billed by Google independently of any Gemini chat subscription.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { isImageFile } = require('./glm');

const DEFAULT_MODEL = 'gemini-3.1-flash-image';
// Stable, non-preview model ids from Google's current docs/model pages.
// The imageSize image config is only valid on the 3.x image models - it is omitted
// entirely for gemini-2.5-flash-image.
const MODELS = {
  'gemini-3.1-flash-image': { label: 'Nano Banana 2', imageSize: true },
  'gemini-2.5-flash-image': { label: 'original Nano Banana', imageSize: false },
  'gemini-3-pro-image': { label: 'Nano Banana Pro', imageSize: true },
};
const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const OUTPUT_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

// spawnSync resolved at call time so tests can simulate transport behavior.
function sh(args, stdin, timeoutMs) {
  const r = cp.spawnSync('curl', args, { encoding: 'utf8', input: stdin || '', timeout: timeoutMs || 310000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error('curl transport failure');
  return r;
}

// Only a bounded numeric provider code is ever echoed; anything else is omitted.
function safeCode(code) {
  const s = String(code === undefined || code === null ? '' : code);
  return /^\d{1,10}$/.test(s) ? s : '';
}

function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); }
function slug(s) { return (String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'job').slice(0, 28); }

// glm-specific knobs must never silently reach a Gemini request.
function rejectGlmOnlyOptions(a) {
  if (a && a.size !== undefined && a.size !== '') throw new Error("unsupported option 'size' for gemini - glm uses size; gemini uses aspect_ratio (image size is fixed at 1K on the 3.x models)");
  if (a && a.quality !== undefined && a.quality !== '') throw new Error("unsupported option 'quality' for gemini - glm only (hd|standard)");
}

function requireKey(c) {
  if (c.geminiKey) return c.geminiKey;
  throw new Error(
    'no GEMINI_API_KEY - the gemini provider (native Nano Banana image models, paid API usage) needs it. ' +
    'Put GEMINI_API_KEY in your shell env or ~/.config/mystic-studio/.env (copy .env.example), or use another provider. ' +
    'The key stays server-side: never logged, sent only to the configured image API base.'
  );
}

// Model comes from the per-call argument, then the dedicated image-model config
// (separate from the review flashModel/proModel), then the stable default.
function resolveModel(c, a) {
  const model = String((a && a.model) || c.geminiImageModel || DEFAULT_MODEL).trim();
  if (!MODELS[model]) {
    throw new Error("unsupported image model '" + model + "' - supported: " +
      Object.keys(MODELS).map((m) => m + ' (' + MODELS[m].label + ')').join(', ') +
      '. No silent escalation: pick a model explicitly.');
  }
  return model;
}

function aspectFor(a) {
  if (!a || a.aspect_ratio === undefined || a.aspect_ratio === '') return '1:1';
  const r = String(a.aspect_ratio).trim();
  if (!ASPECTS.includes(r)) {
    throw new Error("unsupported aspect_ratio '" + a.aspect_ratio + "' for gemini - supported: " + ASPECTS.join(', '));
  }
  return r;
}

function generationConfig(model, aspect) {
  const gc = { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } };
  if (MODELS[model].imageSize) gc.imageConfig.imageSize = '1K';
  return gc;
}

// One authenticated request. The API key travels only through curl's stdin config.
function request(c, model, parts, aspect, timeoutMs) {
  const key = requireKey(c);
  if (/["\r\n]/.test(key)) throw new Error('GEMINI_API_KEY contains unsupported characters - refusing to send');
  const bodyFile = path.join(os.tmpdir(), 'studio-gemini-img-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(bodyFile, JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: generationConfig(model, aspect) }));
  const curlConf = 'header = "x-goog-api-key: ' + key + '"\nheader = "Content-Type: application/json"\n';
  let r;
  try {
    r = sh(
      ['-sS', '-m', '300', '-w', '\n%{http_code}', '--config', '-', '--data-binary', '@' + bodyFile, c.geminiImageBase + '/models/' + model + ':generateContent'],
      curlConf,
      timeoutMs
    );
  } catch (e) {
    throw new Error('gemini-image request failed (curl transport error)');
  } finally { try { fs.unlinkSync(bodyFile); } catch (e) {} }
  if (r.status !== 0) {
    throw new Error('gemini-image request failed (curl exit ' + (Number.isInteger(r.status) ? r.status : 'unknown') + ')');
  }
  const reply = String(r.stdout || '');
  const nl = reply.lastIndexOf('\n');
  const httpCode = nl >= 0 ? reply.slice(nl + 1).trim() : '';
  const text = nl >= 0 ? reply.slice(0, nl) : reply;
  let j = null;
  try { j = JSON.parse(text); } catch (e) { j = null; }
  if (httpCode && !/^2/.test(httpCode)) {
    const hint = j && j.error ? safeCode(j.error.code) : '';
    throw new Error('gemini-image API error: HTTP ' + httpCode + (hint ? ' code=' + hint : '') +
      ' - check GEMINI_API_KEY and billing (image output is paid API usage; response body is not echoed)');
  }
  if (!j) throw new Error('gemini-image returned non-JSON (HTTP ' + (httpCode || 'unknown') + ')');
  return j;
}

// Iterate output parts, skip thinking parts, take the first real image.
function extractImage(j) {
  const cand = j.candidates && j.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  for (const p of parts) {
    if (!p || p.thought) continue;
    if (p.inlineData && p.inlineData.data) return p.inlineData;
  }
  const reason = (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason);
  if (reason && /^[A-Z_]{3,40}$/.test(String(reason))) {
    throw new Error('gemini-image returned no image (reason: ' + reason + ') - request blocked or refused by the provider; nothing saved');
  }
  throw new Error('gemini-image returned no image (text-only or empty reply) - nothing saved');
}

// Strict base64: charset + length checks catch malformed/truncated encodings before decode.
function decodeImageData(data) {
  const compact = String(data).replace(/\s+/g, '');
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error('gemini-image reply carried malformed base64 image data - discarded');
  }
  const buf = Buffer.from(compact, 'base64');
  if (!buf || buf.length === 0) throw new Error('gemini-image reply carried malformed base64 image data - discarded');
  return buf;
}

// Trailer sanity: magic alone cannot catch a PNG truncated at the end, and a WebP
// RIFF header can declare more bytes than were actually delivered.
function contentSane(buf, ext) {
  if (ext === '.png') return buf.length > 12 && buf.slice(buf.length - 12).includes(Buffer.from('IEND'));
  if (ext === '.jpg') return buf.length > 4 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  if (ext === '.webp') return buf.readUInt32LE(4) + 8 <= buf.length;
  return false;
}

// Detect the real image type from magic bytes - never trust a claimed MIME alone.
function sniffMime(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 4 && b.slice(0, 4).toString('latin1').startsWith('GIF8')) return 'image/gif';
  return '';
}

// Enforce configured size limits, then write decoded bytes to a unique file in
// outDir. Every failure path removes the partial file - no partial artifacts, ever.
function saveImage(c, inline, label) {
  const mime = String((inline && inline.mimeType) || '').split(';')[0].trim().toLowerCase();
  const ext = OUTPUT_TYPES[mime];
  if (!ext) {
    const safeMime = /^image\/[a-z0-9.+-]{1,20}$/.test(mime) ? mime : 'unknown';
    throw new Error('gemini-image returned unsupported image type (' + safeMime + ') - discarded');
  }
  const limit = c.maxImageMb * 1024 * 1024;
  const buf = decodeImageData(inline.data);
  const actual = sniffMime(buf);
  if (!actual) throw new Error('gemini-image output bytes are not a supported image (png/jpg/webp) - discarded');
  if (actual !== mime) throw new Error('gemini-image output claimed MIME ' + mime + ' but the bytes are ' + actual + ' - mismatched image discarded');
  if (buf.length < 24) throw new Error('gemini-image output too small to be an image - discarded');
  if (buf.length > limit) {
    throw new Error('gemini-image output over ' + c.maxImageMb + 'MB limit (' + (buf.length / 1048576).toFixed(1) + 'MB) - discarded');
  }
  const out = path.join(c.outDir, 'gemini-' + slug(label) + '-' + stamp() + '-' + Math.random().toString(36).slice(2, 6) + ext);
  const fail = (msg) => { try { fs.unlinkSync(out); } catch (e) {} throw new Error(msg); };
  try { fs.writeFileSync(out, buf); } catch (e) { fail('gemini-image could not save output to ' + c.outDir); }
  if (!isImageFile(out)) return fail('gemini-image output failed the image signature check (png/jpg/webp) - file discarded');
  if (!contentSane(buf, ext)) return fail('gemini-image output is not a complete image (trailer check failed) - file discarded');
  return out;
}

function resultText(g) {
  const lines = [
    'saved: ' + g.file,
    'provider: gemini (native Nano Banana)',
    'model: ' + g.model,
    'aspect: ' + g.aspect,
  ];
  if (g.input) lines.push('input: ' + g.input);
  lines.push('paid: Gemini API image output is paid API usage billed by Google independently of any chat subscription (no retry, no fallback)');
  return lines.join('\n');
}

// Text to image. All validation happens before any network call.
function generate(c, a) {
  a = a || {};
  rejectGlmOnlyOptions(a);
  if (a.image !== undefined || a.images !== undefined || a.image_url !== undefined) {
    throw new Error('gemini generate is text-to-image - pass the image to photo_edit with provider "gemini" instead');
  }
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) throw new Error('gemini-image needs a non-empty text prompt');
  const model = resolveModel(c, a);
  const aspect = aspectFor(a);
  const j = request(c, model, [{ text: prompt }], aspect);
  const file = saveImage(c, extractImage(j), prompt);
  return resultText({ file, model, aspect });
}

// Edit an already-validated local image (core loadImage enforces the path allowlist,
// size limits and URL handling before this runs).
function edit(c, a, file) {
  a = a || {};
  rejectGlmOnlyOptions(a);
  const instruction = typeof a.instruction === 'string' ? a.instruction.trim() : '';
  if (!instruction) throw new Error('gemini edit needs a non-empty instruction (CLI: -p "...")');
  const bytes = fs.readFileSync(file);
  const mime = sniffMime(bytes);
  if (!mime) throw new Error('unsupported or malformed input image for gemini edit (needs real png/jpg/webp/gif bytes)');
  const model = resolveModel(c, a);
  const aspect = aspectFor(a);
  const parts = [{ text: instruction }, { inlineData: { mimeType: mime, data: bytes.toString('base64') } }];
  const j = request(c, model, parts, aspect);
  const out = saveImage(c, extractImage(j), instruction);
  return resultText({ file: out, model, aspect, input: file });
}

function catalog() {
  return [
    'gemini (Google native Gemini image - "Nano Banana") - PAID API usage billed by Google, separate from any chat subscription',
    '  ' + DEFAULT_MODEL + '  default Nano Banana 2; aspect_ratio ' + ASPECTS.join('|') + ' (default 1:1); imageSize 1K',
    '  gemini-2.5-flash-image  original Nano Banana (no imageSize config)',
    '  gemini-3-pro-image  Nano Banana Pro',
    '  auth: GEMINI_API_KEY (shell env or ~/.config/mystic-studio/.env) - server-side only, sent only to the image API base',
    '  photo_edit is supported: local/allowed image + instruction; failed calls are never retried or switched to another provider',
    '  a configured key proves availability, not a successful generation - billing/model access is separate',
    '  docs: https://ai.google.dev/gemini-api/docs/generate-content/image-generation',
  ].join('\n');
}

function doctorNote(c) {
  const selected = String(c.imageProvider || 'higgsfield');
  if (!c.geminiKey) return 'GEMINI_API_KEY not set - "generate --provider gemini" needs it (shell env or the .env file). Paid API usage; default provider stays ' + selected;
  return 'GEMINI_API_KEY configured (value never shown) - live image generation not verified by doctor. Image output is paid API usage billed by Google independently of any chat subscription; default provider ' + selected;
}

module.exports = { generate, edit, catalog, doctorNote, requireKey, resolveModel, aspectFor, generationConfig, extractImage, decodeImageData, contentSane, sniffMime, rejectGlmOnlyOptions, safeCode, DEFAULT_MODEL, MODELS, ASPECTS, OUTPUT_TYPES };
