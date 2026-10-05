'use strict';
// Video Factory — media engine lane (C): probe, scene detect, edit plan, ffmpeg arg builders, measurements.
// Deterministic FFmpeg execution path. No generative calls here — this lane is fully local.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { VideoError } = require('./video-fetch');

function toolVersions() {
  const v = (cmd, a) => {
    const r = spawnSync(cmd, a, { encoding: 'utf8', timeout: 15000 });
    return r.status === 0 ? String(r.stdout).split('\n')[0].trim() : 'missing';
  };
  return { ffmpeg: v('ffmpeg', ['-version']), ffprobe: v('ffprobe', ['-version']), node: process.version };
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60000,
  });
  if (r.status !== 0) {
    throw new VideoError('EPROBE', `ffprobe cannot parse ${path.basename(file)}`, String(r.stderr || '').split('\n').slice(-2).join(' | ').slice(0, 300));
  }
  let j;
  try { j = JSON.parse(r.stdout); } catch { throw new VideoError('EPROBE', 'ffprobe output unparsable'); }
  const vs = (j.streams || []).find((s) => s.codec_type === 'video');
  const as = (j.streams || []).find((s) => s.codec_type === 'audio');
  if (!vs) throw new VideoError('EPROBE', `no video stream found in ${path.basename(file)}`);
  const fpsOf = (s) => {
    const parts = String((s && (s.avg_frame_rate || s.r_frame_rate)) || '0/1').split('/').map(Number);
    return parts[1] ? parts[0] / parts[1] : 0;
  };
  return {
    durationSec: Number((j.format && j.format.duration) || vs.duration || 0),
    width: vs.width, height: vs.height,
    fps: Math.round(fpsOf(vs) * 1000) / 1000,
    hasAudio: !!as,
    codecVideo: vs.codec_name,
    pixFmt: vs.pix_fmt || '',
    codecAudio: as ? as.codec_name : null,
    sampleRate: as ? Number(as.sample_rate) : null,
  };
}

function detectScenes(file, durationSec) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', "select='gt(scene,0.30)',showinfo", '-f', 'null', '-'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000,
  });
  const ts = [];
  const re = /pts_time:([0-9.]+)/g;
  const blob = String(r.stderr || '') + String(r.stdout || '');
  let m;
  while ((m = re.exec(blob))) {
    const t = Number(m[1]);
    if (t > 0.05 && t < durationSec - 0.05) ts.push(Math.round(t * 1000) / 1000);
  }
  return { ts, failed: r.status !== 0 };
}

// Fit (w,h) inside (W,H) box. allowUpscale=false caps at source size (master law: downscale only).
function fitInside(w, h, W, H, allowUpscale) {
  let k = Math.min(W / w, H / h);
  if (!allowUpscale) k = Math.min(1, k);
  const sw = Math.max(2, 2 * Math.floor((w * k) / 2));
  const sh = Math.max(2, 2 * Math.floor((h * k) / 2));
  return [sw, sh];
}

function variantFilter(w, h, srcW, srcH) {
  const [sw, sh] = fitInside(srcW, srcH, w, h, true);
  return `scale=${sw}:${sh},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}

function masterTarget(p) {
  return fitInside(p.width, p.height, 1920, 1080, false);
}

function buildPlan({ probe, sceneTs, preset, options }) {
  const d = probe.durationSec;
  const bounds = [0, ...(sceneTs || []).filter((t) => t > 0.4 && t < d - 0.4), d];
  const cuts = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end - start >= 0.4) cuts.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 });
  }
  if (!cuts.length) cuts.push({ start: 0, end: Math.round(d * 1000) / 1000 });
  const variants = preset === 'social'
    ? [{ name: 'vertical', w: 1080, h: 1920 }, { name: 'square', w: 1080, h: 1080 }]
    : [];
  const chainTail = ',aresample=48000';
  const audio = probe.hasAudio
    ? {
        enabled: true,
        target: { integratedLUFS: -16, truePeakDb: -1.5, lra: 11 },
        chain: preset === 'singing'
          ? `loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.8913:level=false${chainTail}`
          : `loudnorm=I=-16:TP=-1.5:LRA=11${chainTail}`,
      }
    : { enabled: false, reason: 'source has no audio stream — outputs will be silent by design' };
  const [mw, mh] = masterTarget(probe);
  const plan = {
    version: 1,
    preset,
    source: { durationSec: Math.round(d * 1000) / 1000, width: probe.width, height: probe.height, fps: probe.fps, hasAudio: probe.hasAudio },
    master: { width: mw, height: mh },
    cuts,
    variants,
    audio,
    captions: { mode: (options && (options.srt || options.transcript)) ? 'supplied' : 'from-transcript-if-available' },
    burnCaptions: !!(options && options.burnCaptions),
    fades: [{ type: 'fade-in', durSec: 0.15 }, { type: 'fade-out', durSec: 0.25 }],
    generatedBy: 'mystic-studio video-factory v1',
  };
  validatePlan(plan);
  return plan;
}

function validatePlan(plan) {
  if (!plan || plan.version !== 1) throw new VideoError('EPLAN_INVALID', 'edit plan missing or version != 1');
  if (!Array.isArray(plan.cuts) || !plan.cuts.length) throw new VideoError('EPLAN_INVALID', 'plan.cuts empty');
  let prev = 0;
  for (const c of plan.cuts) {
    if (!(c.end > c.start)) throw new VideoError('EPLAN_INVALID', `cut end<=start: ${c.start}-${c.end}`);
    if (c.start < 0) throw new VideoError('EPLAN_INVALID', `cut start < 0: ${c.start}`);
    if (c.start < prev - 1e-6) throw new VideoError('EPLAN_INVALID', 'plan.cuts not monotonic');
    if (c.end - c.start < 0.4) throw new VideoError('EPLAN_INVALID', `cut shorter than 0.4s: ${c.start}-${c.end}`);
    prev = c.end;
  }
  for (const v of plan.variants || []) {
    if (!(v.w >= 16 && v.h >= 16 && v.w % 2 === 0 && v.h % 2 === 0)) throw new VideoError('EPLAN_INVALID', `bad variant geometry ${v.w}x${v.h}`);
  }
  if (plan.audio.enabled && !plan.audio.chain) throw new VideoError('EPLAN_INVALID', 'audio enabled but chain missing');
}

function planDurationSec(plan) {
  return plan.cuts.reduce((s, c) => s + (c.end - c.start), 0);
}

function argsMasterRender(input, out, plan) {
  const n = plan.cuts.length;
  const total = planDurationSec(plan);
  const g = [];
  plan.cuts.forEach((c, i) => g.push(`[0:v]trim=start=${c.start}:end=${c.end},setpts=PTS-STARTPTS[v${i}]`));
  if (plan.audio.enabled) plan.cuts.forEach((c, i) => g.push(`[0:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS[a${i}]`));
  if (plan.audio.enabled) {
    const ins = [];
    plan.cuts.forEach((_, i) => { ins.push(`[v${i}]`); ins.push(`[a${i}]`); });
    g.push(`${ins.join('')}concat=n=${n}:v=1:a=1[cv][ca]`);
    g.push(`[ca]${plan.audio.chain}[af]`);
  } else {
    g.push(`${plan.cuts.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[cv]`);
  }
  g.push(`[cv]scale=${plan.master.width}:${plan.master.height},setsar=1,fade=t=in:st=0:d=0.15,fade=t=out:st=${Math.max(0, total - 0.25).toFixed(3)}:d=0.25[vo]`);
  const args = ['-hide_banner', '-y', '-i', input, '-filter_complex', g.join(';'), '-map', '[vo]'];
  if (plan.audio.enabled) args.push('-map', '[af]');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p');
  if (plan.audio.enabled) args.push('-c:a', 'aac', '-b:a', '160k');
  else args.push('-an');
  args.push('-movflags', '+faststart', out);
  return args;
}

function argsVariantRender(masterIn, out, v, plan, opts) {
  let vf = variantFilter(v.w, v.h, plan.master.width, plan.master.height);
  if (opts && opts.srtPath && plan.burnCaptions) {
    vf = `subtitles=${path.basename(opts.srtPath)}:force_style='FontName=DejaVu Serif,FontSize=22,Outline=1',` + vf;
  }
  const args = ['-hide_banner', '-y', '-i', masterIn, '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p'];
  if (plan.audio.enabled) args.push('-c:a', 'copy');
  else args.push('-an');
  args.push('-movflags', '+faststart', out);
  return args;
}

function argsThumbnail(masterIn, out, atSec) {
  return ['-hide_banner', '-y', '-ss', String(Math.max(0, atSec)), '-i', masterIn, '-frames:v', '1', '-q:v', '3', out];
}

function argsContactSheet(masterIn, out, plan, cols, rows) {
  cols = cols || 4; rows = rows || 5;
  const n = cols * rows;
  const fps = n / Math.max(planDurationSec(plan), 0.1);
  return ['-hide_banner', '-y', '-i', masterIn, '-vf', `fps=${fps.toFixed(4)},scale=240:-2,tile=${cols}x${rows}:padding=4:color=black`, '-frames:v', '1', out];
}

function measureEbur128(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000,
  });
  const out = String(r.stderr || '');
  const sum = out.slice(out.lastIndexOf('Summary:'));
  const i = sum.match(/I:\s+(-?[0-9.]+)/);
  const tp = sum.match(/Peak:\s+(-?[0-9.]+)/);
  const lra = sum.match(/LRA:\s+(-?[0-9.]+)/);
  if (!i) return null;
  return { integratedLUFS: Number(i[1]), truePeakDbFS: tp ? Number(tp[1]) : null, lra: lra ? Number(lra[1]) : null };
}

function detectBlackSilent(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', 'blackdetect=d=0.5', '-af', 'silencedetect=n=-50dB:d=1', '-f', 'null', '-'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000,
  });
  const out = String(r.stderr || '');
  const black = [...out.matchAll(/black_start:\s*([0-9.]+)[^\n]*black_end:\s*([0-9.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  const sStarts = [...out.matchAll(/silence_start:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
  const sEnds = [...out.matchAll(/silence_end:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
  const silent = sStarts.map((s, idx) => ({ start: s, end: sEnds[idx] != null ? sEnds[idx] : null }));
  return { black, silent };
}

function runFfmpeg(args, opts) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: (opts && opts.timeoutMs) || 600000, cwd: (opts && opts.cwd) || undefined });
  return { status: r.status, stderrTail: String(r.stderr || '').trim().split('\n').slice(-4).join(' | ').slice(0, 500) };
}

module.exports = {
  toolVersions, probe, detectScenes, buildPlan, validatePlan, planDurationSec,
  fitInside, variantFilter, masterTarget,
  argsMasterRender, argsVariantRender, argsThumbnail, argsContactSheet,
  measureEbur128, detectBlackSilent, runFfmpeg,
};
