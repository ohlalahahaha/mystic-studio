'use strict';
// OpenAI GPT Image, via the documented direct Image API.  The zero-dependency
// repo needs no SDK: generations POST JSON to /images/generations and edits POST
// multipart form data to /images/edits.  Provider selection is explicit; every
// failure is terminal (no retry, no duplicate render, no provider fallback).
// Keys travel through curl's stdin config, never argv, logs, or receipts.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-image-2';
const MODELS = new Set([DEFAULT_MODEL]);
const FIXED_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);
const SIZES = new Set(['auto', ...FIXED_SIZES]);
const QUALITIES = new Set(['auto', 'low', 'medium', 'high']);
const FORMATS = new Set(['png', 'jpeg', 'webp']);
const ASPECT_MAP = {
  '1:1': '1024x1024',
  '3:2': '1536x1024', '2:3': '1024x1536',
  '4:3': '1536x1152', '3:4': '1152x1536',
  '16:9': '1536x864', '9:16': '864x1536',
};

// GPT Image 2 accepts documented fixed sizes plus flexible pixel sizes. Validate
// the provider contract locally so malformed dimensions cannot become a paid call.
function validSize(size) {
  const value = normalized(size);
  const match = /^(\d{2,4})x(\d{2,4})$/.exec(value);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width % 16 !== 0 || height % 16 !== 0 || width > 3840 || height > 3840) return false;
  const area = width * height;
  if (area < 655360 || area > 8294400) return false;
  return Math.max(width, height) / Math.min(width, height) <= 3 + Number.EPSILON;
}

function requireKey(c) {
  const key = c.openaiKey;
  if (!key) {
    throw new Error(
      'no OPENAI_API_KEY - the openai provider (GPT Image, paid API usage) needs it. ' +
      'Put OPENAI_API_KEY in your shell env or ~/.config/mystic-studio/.env, or select another provider explicitly. ' +
      'The key stays server-side: never logged and never written to output receipts.'
    );
  }
  if (/["\r\n]/.test(key)) throw new Error('OPENAI_API_KEY contains unsupported characters - refusing to send');
  return key;
}

function resolveModel(c, a) {
  const model = String((a && a.model) || c.openaiImageModel || DEFAULT_MODEL).trim();
  if (!MODELS.has(model)) {
    throw new Error("unsupported OpenAI image model '" + model + "' - this scoped adapter supports " + DEFAULT_MODEL +
      ' (the current supported GPT Image model already verified for this workflow). No automatic model substitution.');
  }
  return model;
}

function rejectFidelityOverride(a) {
  if (a && a.input_fidelity !== undefined) {
    throw new Error("input_fidelity is not accepted for " + DEFAULT_MODEL + " - it always uses high input fidelity; omit the option");
  }
}

function normalized(value) { return String(value === undefined || value === null ? '' : value).trim().toLowerCase(); }

function sizeFor(a) {
  if (a.size !== undefined && a.size !== '') {
    const size = normalized(a.size);
    if (size !== 'auto' && !validSize(size)) {
      throw new Error("invalid size '" + a.size + "' - use auto, 1024x1024, 1536x1024, or 1024x1536, or custom WxH with sides multiple of 16, max edge 3840, area 655360-8294400, and ratio <=3");
    }
    return size;
  }
  if (a.aspect_ratio !== undefined && a.aspect_ratio !== '') {
    const ratio = normalized(a.aspect_ratio);
    if (!ASPECT_MAP[ratio]) {
      throw new Error("unsupported aspect_ratio '" + a.aspect_ratio + "' for openai - supported: " + Object.keys(ASPECT_MAP).join(', ') + ', or pass size explicitly');
    }
    return ASPECT_MAP[ratio];
  }
  return '';
}

function optionsFor(a) {
  const out = { size: sizeFor(a), quality: '', output_format: '' };
  if (a.quality !== undefined && a.quality !== '') {
    out.quality = normalized(a.quality);
    if (!QUALITIES.has(out.quality)) throw new Error("invalid quality '" + a.quality + "' - openai accepts auto, low, medium, or high");
  }
  if (a.output_format !== undefined && a.output_format !== '') {
    out.output_format = normalized(a.output_format);
    if (!FORMATS.has(out.output_format)) throw new Error("invalid output_format '" + a.output_format + "' - openai accepts png, jpeg, or webp");
  }
  return out;
}

function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); }
function slug(s) { return (String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'job').slice(0, 28); }
function safeCode(code) {
  const s = String(code === undefined || code === null ? '' : code);
  return /^\d{1,10}$/.test(s) ? s : '';
}

// Keeping curl resolved through the module object makes transport behavior
// injectable for offline tests without adding a dependency.
function sh(args, stdin, timeoutMs) {
  const r = cp.spawnSync('curl', args, {
    encoding: 'utf8',
    input: stdin || '',
    timeout: timeoutMs || 310000,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (r.error || r.status === 28) {
    throw new Error('openai-image request timed out or failed in transport; outcome UNKNOWN - no retry or fallback');
  }
  if (r.status !== 0) throw new Error('openai-image request failed (curl exit ' + r.status + '); outcome unknown - no retry');
  return r;
}

function parseReply(raw, httpCode) {
  let j = null;
  try { j = JSON.parse(raw); } catch (e) { j = null; }
  if (httpCode && !/^2/.test(httpCode)) {
    const hint = j && j.error ? safeCode(j.error.code) : '';
    throw new Error('openai-image API error: HTTP ' + httpCode + (hint ? ' code=' + hint : '') +
      ' - check OPENAI_API_KEY, model access, and billing (response body is not echoed)');
  }
  if (!j) throw new Error('openai-image returned non-JSON (HTTP ' + (httpCode || 'unknown') + ')');
  return j;
}

function splitHttpReply(reply) {
  const nl = reply.lastIndexOf('\n');
  return {
    httpCode: nl >= 0 ? reply.slice(nl + 1).trim() : '',
    text: nl >= 0 ? reply.slice(0, nl) : reply,
  };
}

function sniffMime(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length >= 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return '';
}

function outputComplete(buf, mime) {
  if (mime === 'image/png') return buf.length > 12 && buf.slice(buf.length - 12).includes(Buffer.from('IEND'));
  if (mime === 'image/jpeg') return buf.length > 4 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  if (mime === 'image/webp') return buf.length >= 16 && buf.readUInt32LE(4) + 8 <= buf.length;
  return false;
}

function dimensions(buf, mime) {
  if (mime === 'image/png' && buf.length >= 24 && buf.slice(12, 16).toString('latin1') === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg') {
    let at = 2;
    while (at + 9 < buf.length) {
      if (buf[at] !== 0xff) { at++; continue; }
      const marker = buf[at + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      const len = buf.readUInt16BE(at + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buf.readUInt16BE(at + 7), height: buf.readUInt16BE(at + 5) };
      }
      at += 2 + len;
    }
  }
  if (mime === 'image/webp' && buf.length >= 30) {
    const chunk = buf.slice(12, 16).toString('latin1');
    if (chunk === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && (buf[20] === 0x2f)) {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      const w = 1 + (buf.readUIntLE(24, 3));
      const h = 1 + (buf.readUIntLE(27, 3));
      return { width: w, height: h };
    }
  }
  return null;
}

function decodeImage(data) {
  const compact = String(data || '').replace(/\s+/g, '');
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error('openai-image reply carried malformed base64 image data - discarded');
  }
  const buf = Buffer.from(compact, 'base64');
  if (!buf.length) throw new Error('openai-image reply carried malformed base64 image data - discarded');
  return buf;
}

function firstImage(j, httpCode) {
  const data = j.data && j.data[0];
  if (!data || !data.b64_json) {
    throw new Error('openai-image reply had no base64 image (HTTP ' + (httpCode || 'unknown') + ') - URL outputs are not downloaded automatically');
  }
  return data.b64_json;
}

function sourceInfo(file, limit) {
  let stat;
  try { stat = fs.statSync(file); } catch (e) { throw new Error('source image is unreadable: ' + path.basename(file)); }
  if (!stat.isFile()) throw new Error('source image is not a regular file');
  if (stat.size <= 0) throw new Error('source image is empty');
  if (stat.size > limit) throw new Error('source image over ' + (limit / 1048576).toFixed(1) + 'MB limit');
  const bytes = fs.readFileSync(file);
  const mime = sniffMime(bytes);
  if (!mime) throw new Error('source image failed signature validation (needs real png/jpeg/webp bytes) - no paid request sent');
  if (!outputComplete(bytes, mime)) throw new Error('source image is incomplete (trailer check failed) - no paid request sent');
  const dims = dimensions(bytes, mime);
  if (!dims || dims.width <= 0 || dims.height <= 0) throw new Error('could not read source image dimensions - no paid request sent');
  return { mime, bytes, size: bytes.length, width: dims.width, height: dims.height };
}

// A receipt failure must never destroy an already-paid image. Return null and
// let the result explicitly say that the bytes are retained without a receipt.
function writeReceipt(out, receipt) {
  const receiptFile = out + '.receipt.json';
  try {
    fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
    return receiptFile;
  } catch (e) {
    return null;
  }
}

function saveOutput(c, b64, label, meta) {
  const buf = decodeImage(b64);
  const mime = sniffMime(buf);
  if (!mime) throw new Error('openai-image output bytes are not a supported image (png/jpeg/webp) - discarded');
  if (!outputComplete(buf, mime)) throw new Error('openai-image output is incomplete (trailer check failed) - discarded');
  // maxImageMb limits source uploads, not already-paid output. The transport
  // response is bounded by maxBuffer; retain valid native output at its full size.
  const dims = dimensions(buf, mime);
  if (!dims || !Number.isFinite(dims.width) || !Number.isFinite(dims.height) || dims.width <= 0 || dims.height <= 0) {
    throw new Error('could not verify OpenAI output dimensions - image discarded');
  }
  const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png';
  fs.mkdirSync(c.outDir, { recursive: true });
  const out = path.join(c.outDir, 'openai-' + slug(label) + '-' + stamp() + '-' + Math.random().toString(36).slice(2, 6) + ext);
  try { fs.writeFileSync(out, buf); } catch (e) { throw new Error('could not save OpenAI image output to ' + c.outDir); }
  const receiptFile = writeReceipt(out, {
    schema: 1,
    provider: PROVIDER,
    model: meta.model,
    operation: meta.operation,
    created_at: new Date().toISOString(),
    output: { path: out, bytes: buf.length, format: mime, width: dims.width, height: dims.height },
    input: meta.input,
  });
  return {
    file: out,
    receiptFile,
    receiptWarning: receiptFile ? '' : 'receipt could not be written; paid output retained',
    bytes: buf.length,
    mime,
    width: dims.width,
    height: dims.height,
  };
}

function temporary(ext) {
  return path.join(os.tmpdir(), 'studio-openai-' + Math.random().toString(36).slice(2) + ext);
}
function unlink(file) { try { fs.unlinkSync(file); } catch (e) {} }

function generate(c, a) {
  a = a || {};
  if (a.image !== undefined || a.images !== undefined) {
    throw new Error('openai generate is text-to-image - use edit with an explicitly selected source image');
  }
  rejectFidelityOverride(a);
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) throw new Error('openai-image needs a non-empty text prompt');
  const model = resolveModel(c, a);
  const opts = optionsFor(a);
  const key = requireKey(c);
  const body = { model, prompt };
  if (opts.size) body.size = opts.size;
  if (opts.quality) body.quality = opts.quality;
  if (opts.output_format) body.output_format = opts.output_format;

  const bodyFile = temporary('.json');
  fs.writeFileSync(bodyFile, JSON.stringify(body));
  let r;
  try {
    const curlConfig = 'header = "Authorization: Bearer ' + key + '"\nheader = "Content-Type: application/json"\n';
    r = sh(['-sS', '-m', '300', '-w', '\n%{http_code}', '--config', '-', '--data-binary', '@' + bodyFile,
      c.openaiImageBase + '/images/generations'], curlConfig);
  } catch (e) { unlink(bodyFile); throw e; }
  finally { unlink(bodyFile); }
  const parsed = splitHttpReply(r.stdout || '');
  const reply = parseReply(parsed.text, parsed.httpCode);
  const saved = saveOutput(c, firstImage(reply, parsed.httpCode), prompt, {
    model, operation: 'generate', input: null,
  });
  return result(saved, model, 'Text-to-image is paid OpenAI API usage; no retry or fallback.');
}

function edit(c, a, file) {
  a = a || {};
  rejectFidelityOverride(a);
  const instruction = typeof a.instruction === 'string' ? a.instruction.trim() : '';
  if (!instruction) throw new Error('openai edit needs a non-empty instruction');
  const model = resolveModel(c, a);
  const opts = optionsFor(a);
  const key = requireKey(c);
  const source = sourceInfo(file, c.maxImageMb * 1024 * 1024);

  const promptFile = temporary('.txt');
  const sourceFile = temporary(source.mime === 'image/png' ? '.png' : source.mime === 'image/jpeg' ? '.jpg' : '.webp');
  fs.writeFileSync(promptFile, instruction);
  fs.writeFileSync(sourceFile, source.bytes);
  const fields = [['model', model], ['prompt', '<' + promptFile], ['image[]', '@' + sourceFile + ';type=' + source.mime]];
  if (opts.size) fields.push(['size', opts.size]);
  if (opts.quality) fields.push(['quality', opts.quality]);
  if (opts.output_format) fields.push(['output_format', opts.output_format]);
  let r;
  try {
    const args = ['-sS', '-m', '300', '-w', '\n%{http_code}', '--config', '-', '-X', 'POST'];
    for (const [name, value] of fields) args.push('-F', name + '=' + value);
    args.push(c.openaiImageBase + '/images/edits');
    r = sh(args, 'header = "Authorization: Bearer ' + key + '"\n');
  } catch (e) { unlink(promptFile); unlink(sourceFile); throw e; }
  finally { unlink(promptFile); unlink(sourceFile); }
  const parsed = splitHttpReply(r.stdout || '');
  const reply = parseReply(parsed.text, parsed.httpCode);
  const saved = saveOutput(c, firstImage(reply, parsed.httpCode), instruction, {
    model, operation: 'edit',
    input: { path: file, bytes: source.size, format: source.mime, width: source.width, height: source.height },
  });
  return result(saved, model, 'Reference edit is paid OpenAI API usage; native output bytes retained; no retry or fallback.');
}

function result(saved, model, paidNote) {
  return [
    'saved: ' + saved.file,
    'receipt: ' + (saved.receiptFile || 'NOT WRITTEN — paid output retained'),
    'provider: openai (GPT Image)',
    'model: ' + model,
    'dimensions: ' + saved.width + 'x' + saved.height,
    'bytes: ' + saved.bytes,
    ...(saved.receiptWarning ? ['warning: ' + saved.receiptWarning] : []),
    'paid: ' + paidNote,
  ].join('\n');
}

function catalog() {
  return [
    'openai (OpenAI GPT Image) - PAID API usage billed by OpenAI',
    '  ' + DEFAULT_MODEL + '  generate and edit; size auto or validated WxH (multiples of 16; max edge 3840; 655360-8294400 pixels; ratio <=3); quality auto|low|medium|high; output_format png|jpeg|webp',
    '  ' + DEFAULT_MODEL + ' always uses high input fidelity for edits; input_fidelity is not sent and cannot be overridden here',
    '  auth: OPENAI_API_KEY - server-side only, never logged or written to receipts',
    '  failed or timed-out requests are terminal; no retry, duplicate render, or provider fallback',
    '  direct documented Image API (no SDK dependency)',
  ].join('\n');
}

function doctorNote(c) {
  const selected = String(c.imageProvider || 'higgsfield');
  if (!c.openaiKey) return 'OPENAI_API_KEY not set - generate/edit with provider "openai" is unavailable until configured. Paid API usage; default provider stays ' + selected;
  return 'OPENAI_API_KEY configured (value never shown) - live image generation not verified by doctor. Paid API usage; select provider "openai" explicitly.';
}

module.exports = {
  generate, edit, catalog, doctorNote, requireKey, resolveModel, optionsFor,
  sourceInfo, dimensions, decodeImage, sniffMime, safeCode, validSize, writeReceipt, ASPECT_MAP,
  DEFAULT_MODEL, MODELS, SIZES, QUALITIES, FORMATS,
};
