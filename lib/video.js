'use strict';
// Video Factory — integration owner (A): deterministic job model, resumable stages, idempotent reruns.
// Stages: acquire -> probe -> scenes -> transcribe(optional, explicit) -> editplan -> audio-plan
//         -> render_master -> render_vertical -> render_square -> captions -> thumbnail -> contact_sheet -> qc
// Every stage state lands in manifest.json. Reruns skip done stages whose artifacts verify (cache), --force recomputes.

const fs = require('fs');
const path = require('path');
const os = require('os');
const fetchLane = require('./video-fetch');
const edit = require('./video-edit');
const caps = require('./video-captions');
const qc = require('./video-qc');

const STAGES = ['acquire', 'probe', 'scenes', 'transcribe', 'editplan', 'audio', 'render_master', 'render_vertical', 'render_square', 'captions', 'thumbnail', 'contact_sheet', 'qc'];

function defaultOutDir() {
  return process.env.MYSTIC_VIDEO_OUT || path.join(process.cwd(), 'video-jobs');
}

function persist(manifest) {
  const p = path.join(manifest.jobDir, 'manifest.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmp, p);
}

function artifactEntry(p) {
  return { path: p, bytes: fs.existsSync(p) ? fs.statSync(p).size : 0, sha256: null };
}

function freshManifest(jobId, jobDir, inputRaw, preset, opts) {
  return {
    version: 1,
    jobId,
    createdAt: new Date().toISOString(),
    jobDir,
    input: { raw: inputRaw },
    params: {
      preset,
      force: !!opts.force,
      burnCaptions: !!opts.burnCaptions,
      timeoutMs: Number(opts.timeoutMs || 60000),
      maxBytesMb: Number(opts.maxBytesMb || 19),
      transcribeDeep: !!opts.transcribeDeep,
    },
    toolVersions: edit.toolVersions(),
    stages: {},
    artifacts: {},
    warnings: [],
    errors: [],
  };
}

function stageStart(manifest, name) {
  manifest.stages[name] = { status: 'running', startedAt: new Date().toISOString() };
  persist(manifest);
}

function stageDone(manifest, name, outputs, extra) {
  const s = manifest.stages[name];
  s.status = 'done';
  s.finishedAt = new Date().toISOString();
  s.outputs = outputs || [];
  if (extra) Object.assign(s, extra);
  persist(manifest);
}

function stageSkip(manifest, name, reason, cached) {
  manifest.stages[name] = { status: 'skipped', reason, cached: !!cached, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
  persist(manifest);
}

function stageFail(manifest, name, err) {
  manifest.stages[name] = {
    status: 'failed',
    startedAt: manifest.stages[name] && manifest.stages[name].startedAt || new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: { code: err.code || 'ESTAGE', message: String(err.message || err).slice(0, 400), hint: err.hint || '' },
  };
  manifest.errors.push({ stage: name, code: err.code || 'ESTAGE', message: String(err.message || err).slice(0, 400) });
  persist(manifest);
}

async function verifyArtifact(entry) {
  if (!entry || !entry.path || !fs.existsSync(entry.path)) return false;
  if (fs.statSync(entry.path).size === 0) return false;
  if (!entry.sha256) return true; // no recorded hash -> presence check only
  const h = await fetchLane.sha256File(entry.path);
  return h === entry.sha256;
}

async function runJob(opts) {
  if (!opts || !opts.input) throw new fetchLane.VideoError('EFETCH_INPUT', 'input required (file path, direct media URL, or public page URL)');
  const preset = ['master', 'social', 'singing'].includes(opts.preset) ? opts.preset : 'master';
  if (opts.preset && !['master', 'social', 'singing'].includes(opts.preset)) {
    throw new fetchLane.VideoError('EINPUT', `unknown preset "${opts.preset}"`, 'master | social | singing');
  }
  const outDir = opts.out ? path.resolve(opts.out) : defaultOutDir();
  fs.mkdirSync(outDir, { recursive: true });
  const jobId = fetchLane.sha256Text(`${opts.input}|preset=${preset}`).slice(0, 12);
  const jobDir = path.join(outDir, jobId);
  fs.mkdirSync(path.join(jobDir, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(jobDir, 'out'), { recursive: true });

  let manifest;
  const manifestPath = path.join(jobDir, 'manifest.json');
  if (fs.existsSync(manifestPath) && !opts.force) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { manifest = null; }
  }
  if (!manifest || manifest.version !== 1) manifest = freshManifest(jobId, jobDir, String(opts.input), preset, opts);
  manifest.params.force = !!opts.force;
  persist(manifest);

  const P = {
    raw: path.join(jobDir, 'raw', 'input.mp4'),
    outDir: path.join(jobDir, 'out'),
    master: path.join(jobDir, 'out', 'master.mp4'),
    vertical: path.join(jobDir, 'out', 'vertical.mp4'),
    square: path.join(jobDir, 'out', 'square.mp4'),
    srt: path.join(jobDir, 'out', 'captions.srt'),
    vtt: path.join(jobDir, 'out', 'captions.vtt'),
    transcript: path.join(jobDir, 'out', 'transcript.json'),
    thumbnail: path.join(jobDir, 'out', 'thumbnail.jpg'),
    sheet: path.join(jobDir, 'out', 'contact-sheet.jpg'),
    plan: path.join(jobDir, 'out', 'edit-plan.json'),
    qc: path.join(jobDir, 'out', 'qc.json'),
  };
  const ctx = { opts, manifest, P, plan: null, sourceProbe: null, sceneTs: [], renderExits: {} };
  const force = !!opts.force;

  const run = async (name, fn) => {
    const existing = manifest.stages[name];
    if (existing && existing.status === 'done' && !force) {
      const outs = existing.outputs || [];
      const ok = outs.every((o) => { const e = manifest.artifacts[o]; return !e || verifyArtifact(e); });
      const needs = await Promise.all(outs.map((o) => verifyArtifact(manifest.artifacts[o])));
      if (needs.every(Boolean)) { stageSkip(manifest, name, 'cached: stage done and artifacts verified', true); return; }
    }
    stageStart(manifest, name);
    try {
      await fn();
    } catch (e) {
      stageFail(manifest, name, e);
      throw e;
    }
  };

  // ---- acquire ----
  await run('acquire', async () => {
    const a = await fetchLane.acquire(opts.input, path.join(jobDir, 'raw'), {
      maxBytesMb: manifest.params.maxBytesMb, timeoutMs: manifest.params.timeoutMs,
    });
    if (path.resolve(a.path) !== path.resolve(P.raw)) fs.copyFileSync(a.path, P.raw);
    ctx.acquired = a;
    manifest.input = Object.assign({}, manifest.input, {
      kind: a.kind, source: a.finalUrl, acquiredPath: a.path, bytes: a.bytes,
      sha256: a.sha256, contentType: a.contentType, adapter: a.adapter, acquisitionTime: a.acquisitionTime,
      provenance: { sourceUrl: /^https?:/i.test(a.finalUrl) ? a.finalUrl : null, adapter: a.adapter, checksum: a.sha256, acquisitionTime: a.acquisitionTime },
    });
    stageDone(manifest, 'acquire', ['input.provenance'], { detail: { adapter: a.adapter, bytes: a.bytes } });
  });

  // ---- probe ----
  await run('probe', async () => {
    ctx.sourceProbe = edit.probe(P.raw);
    manifest.source = ctx.sourceProbe;
    stageDone(manifest, 'probe', ['source'], { detail: ctx.sourceProbe });
  });

  // ---- scenes ----
  await run('scenes', async () => {
    ctx.sceneTs = edit.detectScenes(P.raw, manifest.source.durationSec);
    stageDone(manifest, 'scenes', [], { detail: { sceneCount: ctx.sceneTs.length, timestamps: ctx.sceneTs.slice(0, 30) } });
  });

  // ---- transcribe (explicit; never silently invented) ----
  await run('transcribe', async () => {
    if (opts.transcript || opts.srt) { stageSkip(manifest, 'transcribe', 'user-supplied transcript/captions provided — ASR not needed'); return; }
    if (!opts.transcribeDeep) {
      stageSkip(manifest, 'transcribe', 'no transcript provider configured — captions require --transcript <segments.json> or --srt <file> (explicit skip, nothing invented)', false);
      manifest.warnings.push('transcript: skipped explicitly (no provider); captions will be omitted unless supplied');
      return;
    }
    const core = require('./core');
    const res = await core.dispatch({ name: 'video_see', video: P.raw, focus: 'speech transcription' });
    fs.writeFileSync(P.transcript, JSON.stringify({ provider: 'video_see-verdict', raw: res }, null, 2));
    manifest.warnings.push('transcribeDeep: video_see verdict stored as transcript.json sidecar; captions were NOT parsed from it (non-deterministic)');
    stageDone(manifest, 'transcribe', ['transcript.json']);
  });

  // ---- editplan ----
  await run('editplan', async () => {
    ctx.plan = edit.buildPlan({
      probe: manifest.source, sceneTs: ctx.sceneTs, preset,
      options: { srt: opts.srt, transcript: opts.transcript, burnCaptions: opts.burnCaptions },
    });
    fs.writeFileSync(P.plan, JSON.stringify(ctx.plan, null, 2));
    manifest.artifacts.edit_plan = artifactEntry(P.plan);
    stageDone(manifest, 'editplan', ['edit_plan'], { detail: { cuts: ctx.plan.cuts.length, variants: ctx.plan.variants.map((v) => `${v.w}x${v.h}`) } });
  });

  // ---- audio plan ----
  await run('audio', async () => {
    stageDone(manifest, 'audio', [], { detail: { enabled: ctx.plan.audio.enabled, chain: ctx.plan.audio.chain || null, target: ctx.plan.audio.target || null } });
  });

  // ---- render master ----
  await run('render_master', async () => {
    const args = edit.argsMasterRender(P.raw, P.master, ctx.plan);
    const r = edit.runFfmpeg(args, { timeoutMs: 900000 });
    ctx.renderExits.master = r.status;
    if (r.status !== 0 || !fs.existsSync(P.master)) throw new fetchLane.VideoError('ERENDER', `master render failed (exit ${r.status})`, r.stderrTail);
    manifest.artifacts.master = artifactEntry(P.master);
    stageDone(manifest, 'render_master', ['master'], { detail: { exit: r.status, bytes: fs.statSync(P.master).size } });
  });

  // ---- variants ----
  const variantStage = async (name, v, outPath) => {
    await run(name, async () => {
      const args = edit.argsVariantRender(P.master, outPath, v, ctx.plan, { srtPath: P.srt });
      const r = edit.runFfmpeg(args, { timeoutMs: 900000, cwd: path.dirname(P.srt) });
      ctx.renderExits[v.name] = r.status;
      if (r.status !== 0 || !fs.existsSync(outPath)) throw new fetchLane.VideoError('ERENDER', `${v.name} render failed (exit ${r.status})`, r.stderrTail);
      manifest.artifacts[v.name] = artifactEntry(outPath);
      stageDone(manifest, name, [v.name], { detail: { exit: r.status } });
    });
  };
  const vDef = (ctx.plan.variants || []).find((v) => v.name === 'vertical');
  const sDef = (ctx.plan.variants || []).find((v) => v.name === 'square');
  if (vDef) await variantStage('render_vertical', vDef, P.vertical);
  else stageSkip(manifest, 'render_vertical', `preset ${preset} has no vertical variant`, false);
  if (sDef) await variantStage('render_square', sDef, P.square);
  else stageSkip(manifest, 'render_square', `preset ${preset} has no square variant`, false);

  // ---- captions ----
  await run('captions', async () => {
    if (opts.srt) {
      fs.copyFileSync(path.resolve(opts.srt), P.srt);
    } else if (opts.transcript) {
      const list = caps.loadTranscript(path.resolve(opts.transcript));
      const sanitized = caps.sanitize(list, edit.planDurationSec(ctx.plan));
      sanitized.warnings.forEach((w) => manifest.warnings.push(`captions: ${w}`));
      if (!sanitized.segments.length) throw new fetchLane.VideoError('ECAPTIONS', 'transcript produced zero usable segments');
      fs.writeFileSync(P.srt, caps.buildSrt(sanitized.segments));
      fs.writeFileSync(P.vtt, caps.buildVtt(sanitized.segments));
    } else {
      stageSkip(manifest, 'captions', 'no transcript/srt supplied — captions omitted (explicit)', false);
      return;
    }
    manifest.artifacts.srt = artifactEntry(P.srt);
    if (fs.existsSync(P.vtt)) manifest.artifacts.vtt = artifactEntry(P.vtt);
    stageDone(manifest, 'captions', ['srt'].concat(fs.existsSync(P.vtt) ? ['vtt'] : []), {});
  });

  // ---- thumbnail + contact sheet ----
  await run('thumbnail', async () => {
    const at = Math.min(Math.max(edit.planDurationSec(ctx.plan) * 0.35, 0.1), edit.planDurationSec(ctx.plan) - 0.1);
    const r = edit.runFfmpeg(edit.argsThumbnail(P.master, P.thumbnail, at), { timeoutMs: 120000 });
    if (r.status !== 0 || !fs.existsSync(P.thumbnail)) throw new fetchLane.VideoError('ERENDER', `thumbnail failed (exit ${r.status})`, r.stderrTail);
    manifest.artifacts.thumbnail = artifactEntry(P.thumbnail);
    stageDone(manifest, 'thumbnail', ['thumbnail'], {});
  });

  await run('contact_sheet', async () => {
    const r = edit.runFfmpeg(edit.argsContactSheet(P.master, P.sheet, ctx.plan), { timeoutMs: 180000 });
    if (r.status !== 0 || !fs.existsSync(P.sheet)) throw new fetchLane.VideoError('ERENDER', `contact sheet failed (exit ${r.status})`, r.stderrTail);
    manifest.artifacts.contact_sheet = artifactEntry(P.sheet);
    stageDone(manifest, 'contact_sheet', ['contact_sheet'], {});
  });

  // ---- checksums ----
  for (const k of Object.keys(manifest.artifacts)) {
    const e = manifest.artifacts[k];
    if (e.path && fs.existsSync(e.path)) e.sha256 = await fetchLane.sha256File(e.path);
  }

  // ---- qc ----
  let qcResult = null;
  await run('qc', async () => {
    const allArtifacts = Object.assign({ manifest: manifestPath }, Object.fromEntries(Object.entries(manifest.artifacts).map(([k, v]) => [k, v.path])));
    qcResult = await qc.runQc({
      jobDir, plan: ctx.plan, manifest,
      paths: { master: P.master, vertical: fs.existsSync(P.vertical) ? P.vertical : null, square: fs.existsSync(P.square) ? P.square : null, srt: fs.existsSync(P.srt) ? P.srt : null, vtt: fs.existsSync(P.vtt) ? P.vtt : null },
      renderExits: ctx.renderExits,
      allArtifacts,
    });
    fs.writeFileSync(P.qc, JSON.stringify(qcResult, null, 2));
    manifest.artifacts.qc = artifactEntry(P.qc);
    manifest.qc = { pass: qcResult.pass, failed: qcResult.checks.filter((c) => !c.pass).map((c) => c.name) };
    stageDone(manifest, 'qc', ['qc'], { detail: { pass: qcResult.pass, checks: qcResult.checks.length } });
  });

  manifest.finishedAt = new Date().toISOString();
  manifest.status = manifest.qc && manifest.qc.pass ? 'complete' : 'failed';
  persist(manifest);
  if (manifest.status === 'failed') {
    throw new fetchLane.VideoError('EQC_FAIL', `QC failed: ${manifest.qc.failed.join(', ')}`, `see ${P.qc}`);
  }
  return { jobId, jobDir, status: manifest.status, manifest, qc: qcResult };
}

function status(jobRef) {
  let manifestPath = null;
  if (jobRef && (jobRef.endsWith('.json') || jobRef.includes(path.sep) || fs.existsSync(jobRef))) {
    manifestPath = jobRef.endsWith('manifest.json') ? jobRef : fs.existsSync(path.join(jobRef, 'manifest.json')) ? path.join(jobRef, 'manifest.json') : null;
  }
  if (!manifestPath) {
    const outDir = defaultOutDir();
    const p = path.join(outDir, String(jobRef || ''), 'manifest.json');
    if (fs.existsSync(p)) manifestPath = p;
  }
  if (!manifestPath) throw new fetchLane.VideoError('EJOB', `no manifest found for ${jobRef}`, 'pass the jobDir or jobId');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    jobId: m.jobId, jobDir: m.jobDir, status: m.status || 'incomplete',
    input: m.input, params: m.params,
    stages: Object.fromEntries(STAGES.map((s) => [s, m.stages[s] ? `${m.stages[s].status}${m.stages[s].cached ? '(cached)' : ''}` : 'pending'])),
    artifacts: Object.fromEntries(Object.entries(m.artifacts || {}).map(([k, v]) => [k, v.path])),
    qc: m.qc || null, warnings: m.warnings || [], errors: m.errors || [],
  };
}

async function dispatchTool(a) {
  const name = a && a._name;
  if (name === 'video_status') {
    const s = status(a.job || a.jobDir || a.id);
    return ['video_status', `job ${s.jobId} status=${s.status}`, ...Object.entries(s.stages).map(([k, v]) => `  ${k}: ${v}`), `qc: ${s.qc ? (s.qc.pass ? 'PASS' : 'FAIL ' + JSON.stringify(s.qc.failed)) : 'n/a'}`, `dir: ${s.jobDir}`].join('\n');
  }
  const res = await runJob({
    input: a.input, preset: a.preset, out: a.out,
    force: a.force, srt: a.srt, transcript: a.transcript,
    burnCaptions: a.burn_captions, transcribeDeep: a.transcribe_deep,
    timeoutMs: a.timeout_ms, maxBytesMb: a.max_bytes_mb,
  });
  const m = res.manifest;
  const lines = [
    `video_run: ${res.status} (job ${res.jobId})`,
    `input: ${m.input.source} [${m.input.adapter}] sha256=${(m.input.sha256 || '').slice(0, 16)}…`,
    `artifacts:`,
  ];
  for (const [k, v] of Object.entries(m.artifacts)) lines.push(`  ${k}: ${v.path} (${v.bytes}B)`);
  lines.push(`qc: ${res.qc && res.qc.pass ? 'PASS' : 'FAIL'} (${res.qc ? res.qc.checks.filter((c) => c.pass).length + '/' + res.qc.checks.length : 'n/a'} checks)`);
  if (m.warnings.length) lines.push(`warnings: ${m.warnings.join(' | ')}`);
  lines.push(`dir: ${res.jobDir}`);
  return lines.join('\n');
}

module.exports = { runJob, status, dispatchTool, STAGES, defaultOutDir };
