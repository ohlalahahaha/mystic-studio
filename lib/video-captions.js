'use strict';
// Video Factory — captions lane: transcript segments -> SRT/VTT, monotonic sanitize inside duration.
// Deterministic. Timestamps are never invented: out-of-range/broken input is clamped WITH a recorded warning.

const fs = require('fs');
const { VideoError } = require('./video-fetch');

function tsSrt(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
}

function tsVtt(sec) {
  return tsSrt(sec).replace(',', '.');
}

// segments: [{start, end, text}] seconds. Returns {segments, warnings}
function sanitize(segments, durationSec) {
  const warnings = [];
  const out = [];
  let prevEnd = 0;
  const list = (segments || []).slice().sort((a, b) => a.start - b.start);
  for (const seg of list) {
    let start = Number(seg.start);
    let end = Number(seg.end);
    const text = String(seg.text || '').replace(/\s+/g, ' ').trim();
    if (!text) { warnings.push(`dropped empty segment at ${start}`); continue; }
    if (!isFinite(start) || start < 0) { warnings.push(`clamped segment start ${start} -> 0`); start = 0; }
    if (!isFinite(end) || end <= start) { end = start + 1.5; warnings.push(`repaired invalid end for segment at ${start}`); }
    if (start < prevEnd) { warnings.push(`overlapping segment shifted ${start} -> ${prevEnd}`); start = prevEnd; end = Math.max(end, start + 0.3); }
    if (durationSec && end > durationSec + 0.05) { warnings.push(`segment end ${end} clamped to duration ${durationSec}`); end = durationSec; }
    if (durationSec && start >= durationSec) { warnings.push(`dropped segment beyond duration at ${start}`); prevEnd = Math.max(prevEnd, end); continue; }
    out.push({ start, end, text });
    prevEnd = end;
  }
  return { segments: out, warnings };
}

function buildSrt(segments) {
  return segments.map((s, i) => `${i + 1}\n${tsSrt(s.start)} --> ${tsSrt(s.end)}\n${s.text}\n`).join('\n');
}

function buildVtt(segments) {
  return 'WEBVTT\n\n' + segments.map((s) => `${tsVtt(s.start)} --> ${tsVtt(s.end)}\n${s.text}\n`).join('\n');
}

// Parse SRT text -> [{start, end, text}] (seconds). Deterministic; skips blocks
// without a timing line. Accepts ',' or '.' ms separators and 1-3 digit ms.
function parseSrt(text) {
  const txt = String(text || '').replace(/\r\n?/g, '\n');
  const re = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
  const toSec = (h, m, s, ms) => (+h) * 3600 + (+m) * 60 + (+s) + Number(String(ms).padEnd(3, '0')) / 1000;
  const out = [];
  for (const block of txt.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => re.test(l));
    if (ti < 0) continue;
    const m = lines[ti].match(re);
    out.push({ start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), text: lines.slice(ti + 1).join('\n').trim() });
  }
  return out;
}

function loadTranscript(p) {
  let j;
  try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new VideoError('ECAPTIONS', `transcript JSON unparsable: ${p}`); }
  const list = Array.isArray(j) ? j : (j.segments || null);
  if (!Array.isArray(list)) throw new VideoError('ECAPTIONS', 'transcript must be an array or {segments:[{start,end,text}]}');
  return list;
}

module.exports = { sanitize, buildSrt, buildVtt, parseSrt, loadTranscript, tsSrt, tsVtt };
