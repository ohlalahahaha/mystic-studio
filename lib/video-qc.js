'use strict';
// Video Factory — QC lane (F): measured checks, not prose. Every check carries its measured value.

const fs = require('fs');
const path = require('path');
const edit = require('./video-edit');
const caps = require('./video-captions');

function checksum(p) { return edit && require('./video-fetch').sha256File(p); }

function parseSrtTimes(p, durationSec) {
  const txt = fs.readFileSync(p, 'utf8');
  const times = [...txt.matchAll(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/g)].map((m) => {
    const a = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    const b = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    return { start: a, end: b };
  });
  let monotonic = true;
  let prevEnd = -1;
  for (const t of times) { if (t.start < prevEnd - 1e-3) monotonic = false; prevEnd = t.end; }
  const inside = times.every((t) => t.start >= -0.05 && t.end <= (durationSec || Infinity) + 0.1);
  return { count: times.length, monotonic, inside };
}

async function runQc(ctx) {
  // ctx: {jobDir, plan, manifest, paths:{master, vertical, square, srt, vtt}, renderExits:{master:0,...}}
  const checks = [];
  const add = (name, pass, measured, expected, extra) => checks.push(Object.assign({ name, pass: !!pass, measured, expected }, extra ? { detail: extra } : {}));
  const DUR_TOL = 0.75;
  const AV_TOL = 0.15;

  const mp4s = [['master', ctx.paths.master]];
  if (ctx.paths.vertical) mp4s.push(['vertical', ctx.paths.vertical]);
  if (ctx.paths.square) mp4s.push(['square', ctx.paths.square]);

  const measured = {};
  for (const [name, p] of mp4s) {
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) { add(`${name}/exists-nonempty`, false, fs.existsSync(p) ? fs.statSync(p).size : 'missing', '>0 bytes'); continue; }
    let pr = null;
    let parseOk = true;
    try { pr = edit.probe(p); } catch (e) { parseOk = false; add(`${name}/ffprobe-parse`, false, e.code || 'error', 'parsable', String(e.message).slice(0, 200)); }
    if (!parseOk || !pr) continue;
    measured[name] = pr;
    add(`${name}/codec-video`, pr.codecVideo === 'h264', pr.codecVideo, 'h264');
    add(`${name}/pixfmt`, pr.pixFmt === 'yuv420p', pr.pixFmt, 'yuv420p');
    if (name === 'master') {
      add(`${name}/codec-audio`, ctx.plan.audio.enabled ? pr.hasAudio : !pr.hasAudio, pr.hasAudio ? `audio:${pr.codecAudio}` : 'none', ctx.plan.audio.enabled ? 'audio present' : 'audio absent');
      const expected = { w: ctx.plan.master.width, h: ctx.plan.master.height };
      add(`${name}/geometry`, pr.width === expected.w && pr.height === expected.h, `${pr.width}x${pr.height}`, `${expected.w}x${expected.h}`);
      add(`${name}/duration`, Math.abs(pr.durationSec - edit.planDurationSec(ctx.plan)) <= DUR_TOL, pr.durationSec, `${edit.planDurationSec(ctx.plan)} ±${DUR_TOL}`);
    } else {
      const v = (ctx.plan.variants || []).find((x) => x.name === name) || {};
      add(`${name}/geometry`, pr.width === v.w && pr.height === v.h, `${pr.width}x${pr.height}`, `${v.w}x${v.h}`);
      const mv = measured.master ? measured.master.durationSec : null;
      if (mv != null) add(`${name}/duration`, Math.abs(pr.durationSec - mv) <= DUR_TOL, pr.durationSec, `${mv} ±${DUR_TOL}`);
    }
    if (pr.hasAudio && ctx.plan.audio.enabled) {
      let avDelta = null;
      try {
        const j = JSON.parse(require('child_process').spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', p], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).stdout);
        const a = (j.streams || []).find((s) => s.codec_type === 'audio');
        if (a && a.duration && j.format && j.format.duration) avDelta = Math.abs(Number(j.format.duration) - Number(a.duration));
      } catch {}
      if (avDelta != null) add(`${name}/av-delta`, avDelta <= AV_TOL, Math.round(avDelta * 1000) / 1000, `<=${AV_TOL}`);
    }
    const st = ctx.renderExits ? ctx.renderExits[name] : null;
    if (st != null) add(`${name}/render-exit`, st === 0, st, 0);
  }

  if (ctx.paths.master && fs.existsSync(ctx.paths.master) && ctx.plan.audio.enabled) {
    const loud = edit.measureEbur128(ctx.paths.master);
    if (!loud) add('audio/loudness-measured', false, 'ebur128 unavailable', 'measured I/TP');
    else {
      measured.loudness = loud;
      add('audio/loudness-target', Math.abs(loud.integratedLUFS - ctx.plan.audio.target.integratedLUFS) <= 3, loud.integratedLUFS, `${ctx.plan.audio.target.integratedLUFS} ±3 LUFS`);
      add('audio/no-clipping', loud.truePeakDbFS == null ? false : loud.truePeakDbFS <= -0.1, loud.truePeakDbFS, '<= -0.1 dBFS');
    }
    const bs = edit.detectBlackSilent(ctx.paths.master);
    measured.blackSegments = bs.black;
    measured.silentSegments = bs.silent;
    const dur = edit.planDurationSec(ctx.plan);
    const blackCov = bs.black.reduce((s, b) => s + (b.end - b.start), 0);
    add('video/no-dominant-black', blackCov <= dur * 0.6, `${Math.round(blackCov * 100) / 100}s of ${Math.round(dur * 100) / 100}s`, '<=60% coverage');
  } else if (ctx.plan.audio.enabled) {
    add('audio/loudness-measured', false, 'master missing', 'measured');
  }

  const artPaths = Object.entries(ctx.allArtifacts || {});
  for (const [name, p] of artPaths) {
    if (!p || !fs.existsSync(p)) { add(`artifact/${name}`, false, 'missing', 'present'); continue; }
    const sz = fs.statSync(p).size;
    add(`artifact/${name}`, sz > 0, `${sz}B`, '>0B');
  }

  if (ctx.paths.srt && fs.existsSync(ctx.paths.srt)) {
    const dur = measured.master ? measured.master.durationSec : edit.planDurationSec(ctx.plan);
    const s = parseSrtTimes(ctx.paths.srt, dur);
    add('captions/srt-monotonic-inside', s.count > 0 && s.monotonic && s.inside, { count: s.count, monotonic: s.monotonic, inside: s.inside }, 'count>0, monotonic, within duration');
  }

  const pass = checks.length > 0 && checks.every((c) => c.pass);
  return { pass, checks, measured };
}

module.exports = { runQc, parseSrtTimes };
