'use strict';
// Video Factory — test matrix (F). Plain node script, zero-dep, network-independent.
// Sections: FIXTURES -> UNIT -> E2E -> IDEMPOTENCY -> FAILURE -> QC-NEGATIVE -> OPERATOR SURFACE
// Optional non-blocking public smoke: MYSTIC_VIDEO_SMOKE_URL=<direct media url> node test/video.js

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const fetchLane = require(path.join(ROOT, 'lib', 'video-fetch'));
const edit = require(path.join(ROOT, 'lib', 'video-edit'));
const caps = require(path.join(ROOT, 'lib', 'video-captions'));
const qcLane = require(path.join(ROOT, 'lib', 'video-qc'));
const video = require(path.join(ROOT, 'lib', 'video'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mystic-video-test-'));
const JOBS = path.join(TMP, 'video-jobs');
fs.mkdirSync(JOBS, { recursive: true });

let passed = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { passed++; console.log(`PASS ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}${detail ? ' :: ' + String(detail).slice(0, 200) : ''}`); }
}
function expectCode(fn, code, label) {
  try { fn(); ok(false, label, 'expected throw ' + code); }
  catch (e) { ok(e.code === code, label, `got ${e.code || e.name}: ${String(e.message).slice(0, 120)}`); }
}
function gen(name, vfArgs, withAudio, extra) {
  const out = path.join(TMP, name);
  const args = ['-hide_banner', '-y', ...vfArgs];
  if (!withAudio) args.push('-an');
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  if (withAudio) args.push('-c:a', 'aac', '-shortest');
  args.push(out);
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error(`fixture ${name} failed: ${String(r.stderr).slice(-300)}`);
  return out;
}

// Mean luma of the top-left 64x64 corner at t=2s (past the master fade-in).
// Pure-color fixtures make this a deterministic reframe probe: full-bleed red ~= 81, black letterbox = 16.
function edgeLuma(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', '2', '-i', file, '-vf', 'crop=64:64:0:0,signalstats,metadata=print', '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  const m = (String(r.stderr || '') + String(r.stdout || '')).match(/lavfi\.signalstats\.YAVG=([0-9.]+)/);
  return m ? Number(m[1]) : -1;
}

console.log('== FIXTURES ==');
const land = gen('landscape.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8'], true);
const port_ = gen('portrait.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6'], true);
const noaudio = gen('noaudio.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=5'], false);
const fps7 = gen('fps7.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=7:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6'], true);
const redClip = gen('red.mp4', ['-f', 'lavfi', '-i', 'color=c=red:size=640x360:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4'], true);
const corrupt = path.join(TMP, 'corrupt.mp4');
fs.writeFileSync(corrupt, fs.readFileSync(land).subarray(0, 65536));
const transcriptFix = path.join(TMP, 'transcript.json');
fs.writeFileSync(transcriptFix, JSON.stringify({ segments: [
  { start: 0.5, end: 2.0, text: 'hello from the deterministic fixture' },
  { start: 2.5, end: 5.0, text: 'second caption line' },
  { start: 5.5, end: 7.5, text: 'third caption line' },
] }));
ok(edit.probe(land).durationSec > 7 && edit.probe(land).hasAudio, 'fixtures generated and parseable');
ok(fs.statSync(corrupt).size === 65536, 'corrupt fixture is a truncated mp4');

console.log('== LOCAL HTTP SERVER (child process; parent blocks on spawnSync) ==');
const portFile = path.join(TMP, 'fixture-port');
const srv = spawn(process.execPath, [path.join(__dirname, 'video-fixture-server.js'), land, portFile], { stdio: ['ignore', 'ignore', 'inherit'] });
for (let i = 0; i < 400 && !fs.existsSync(portFile); i++) spawnSync('sleep', ['0.05']);
const PORT = Number(fs.readFileSync(portFile, 'utf8').trim());
ok(PORT > 0, 'test http server up on ' + PORT);
main();

function main() {
  console.log('== UNIT ==');
ok(fetchLane.classify('/tmp/x.mov') === 'file', 'classify: file');
ok(fetchLane.classify('https://e.com/a/b.mp4?dl=1') === 'url', 'classify: direct url by extension');
ok(fetchLane.classify('https://e.com/watch?v=1') === 'page', 'classify: page url');
ok(fetchLane.sha256FileSync ? fetchLane.sha256FileSync(land).length === 64 : false, 'sha256FileSync deterministic');
const [fsw, fsh] = edit.fitInside(1280, 720, 1080, 1920, true);
ok(fsw === 1080 && fsh === 606, 'fitInside landscape->vertical box', `${fsw}x${fsh}`);
const [mw, mh] = edit.fitInside(1280, 720, 1920, 1080, false);
ok(mw === 1280 && mh === 720, 'fitInside master downscale-only cap');
const p8 = { durationSec: 8, width: 1280, height: 720, fps: 30, hasAudio: true };
const planScenes = edit.buildPlan({ probe: p8, sceneTs: [2.0, 5.5], preset: 'social', options: {} });
ok(planScenes.cuts.length === 3, 'scene timestamps produce 3 cuts', JSON.stringify(planScenes.cuts));
ok(planScenes.reframe === 'crop', 'plan records adaptive crop reframe by default', planScenes.reframe);
const ma = edit.argsMasterRender('/in.mp4', '/o.mp4', planScenes);
ok(ma.includes('-filter_complex') && ma.join(' ').includes('concat=n=3') && ma.join(' ').includes('loudnorm'), 'master args: concat+audio chain');
ok(ma.join(' ').includes('fade=t=out'), 'master args: planned fades');
const va = edit.argsVariantRender('/m.mp4', '/v.mp4', { name: 'vertical', w: 1080, h: 1920 }, planScenes, {});
ok(va.join(' ').includes('crop=1080:1920') && !va.join(' ').includes('pad='), 'vertical args: adaptive crop reframing (no letterbox)');
const vp = edit.argsVariantRender('/m.mp4', '/v.mp4', { name: 'vertical', w: 1080, h: 1920 }, Object.assign({}, planScenes, { reframe: 'pad' }), {});
ok(vp.join(' ').includes('scale=1080:606') && vp.join(' ').includes('pad=1080:1920'), 'pad mode restores fit-inside letterbox');
ok(edit.subtitlesOverlay('/x/y/out/captions.srt', false) === "subtitles=captions.srt:force_style='FontSize=22,Bold=1,Outline=1,Shadow=0,MarginV=36'", 'subtitles overlay: escaped bare basename + minimal safe style');
ok(!edit.subtitlesOverlay('/x/y/out/captions.srt', false).includes('FontName'), 'burn style: no exotic FontName dependency (macOS-safe)');
ok(edit.subtitlesOverlay('/weird dir/subs:1.srt', true) === 'subtitles=subs\\:1.srt', 'subtitles path escaping: colon escaped (bare basename)');
ok(typeof edit.hasSubtitlesFilter() === 'boolean', 'capability preflight probe returns boolean');
const pseg = caps.parseSrt('1\n00:00:00,500 --> 00:00:02,000\nhello srt\n\n2\n00:00:02,500 --> 00:00:04,000\nsecond line\nthird words\n');
ok(pseg.length === 2 && pseg[0].start === 0.5 && pseg[0].end === 2 && pseg[1].text === 'second line\nthird words', 'parseSrt: cues + multi-line text', JSON.stringify(pseg));
ok(caps.buildVtt(pseg).startsWith('WEBVTT') && caps.buildVtt(pseg).includes('00:00:00.500 --> 00:00:02.000'), 'parseSrt -> buildVtt round trip');
const sani = caps.sanitize([{ start: 0, end: 2, text: 'a' }, { start: 1, end: 3, text: 'b' }, { start: 99, end: 101, text: 'c' }], 8);
ok(sani.segments.length === 2 && sani.warnings.length >= 2, 'captions sanitize: clamp+drop with warnings', JSON.stringify(sani.warnings));
ok(/00:00:00,000 --> 00:00:02,000/.test(caps.buildSrt(sani.segments)), 'srt builder format');
const e = new fetchLane.VideoError('ECODE_X', 'msg', 'hint');
ok(e.code === 'ECODE_X' && e.hint === 'hint', 'error normalization carries code+hint');
expectCode(() => edit.validatePlan({ version: 1, cuts: [{ start: 0, end: 0.2 }], audio: { enabled: false } }), 'EPLAN_INVALID', 'plan validation rejects <0.4s cut');
expectCode(() => video.runJob({ input: '/nonexistent/file.mp4', out: JOBS }), 'EFETCH_INPUT', 'unit: missing file normalized error');

console.log('== E2E (local-http URL -> full pipeline) ==');
let jobId1 = null; let jobDir1 = null;
{
  const res = video.runJob({ input: `http://127.0.0.1:${PORT}/landscape.mp4`, preset: 'social', out: JOBS, transcript: transcriptFix });
  jobId1 = res.jobId; jobDir1 = res.jobDir;
  ok(res.status === 'complete', 'E2E social run completes', JSON.stringify(res.manifest.errors));
  const A = res.manifest.artifacts;
  for (const k of ['master', 'vertical', 'square', 'srt', 'vtt', 'thumbnail', 'contact_sheet', 'edit_plan', 'qc']) {
    ok(A[k] && A[k].path && fs.existsSync(A[k].path) && A[k].bytes > 0, `artifact ${k} present non-empty`);
  }
  const q = JSON.parse(fs.readFileSync(path.join(jobDir1, 'out', 'qc.json'), 'utf8'));
  ok(q.pass === true, 'qc.json pass=true', JSON.stringify(q.checks.filter((c) => !c.pass)));
  ok(q.checks.some((c) => c.name === 'audio/loudness-target' && typeof c.measured === 'number'), 'qc has measured loudness', JSON.stringify(q.checks.find((c) => c.name === 'audio/loudness-target') || {}));
  const vprobe = edit.probe(path.join(jobDir1, 'out', 'vertical.mp4'));
  ok(vprobe.width === 1080 && vprobe.height === 1920 && vprobe.codecVideo === 'h264', 'vertical 1080x1920 h264');
  ok(edit.probe(path.join(jobDir1, 'out', 'square.mp4')).height === 1080, 'square 1080 height');
  ok(res.manifest.input.provenance && res.manifest.input.provenance.sourceUrl && res.manifest.input.provenance.checksum, 'provenance: source url + checksum + time');
  ok(res.manifest.input.adapter === 'curl-direct', 'adapter recorded: curl-direct');
  const srtTxt = fs.readFileSync(path.join(jobDir1, 'out', 'captions.srt'), 'utf8');
  ok(srtTxt.includes('hello from the deterministic fixture'), 'captions from supplied transcript fixture');
  ok(res.manifest.stages.transcribe.status === 'skipped', 'transcribe explicitly skipped when captions supplied');
}

console.log('== E2E: SUPPLIED SRT -> VERBATIM SRT + DERIVED VTT (Phoenix regression) ==');
{
  const srtFix = path.join(TMP, 'supplied.srt');
  fs.writeFileSync(srtFix, '1\n00:00:00,500 --> 00:00:02,000\nhello srt fixture\n\n2\n00:00:02,500 --> 00:00:04,000\nsecond supplied line\n');
  const res = video.runJob({ input: `http://127.0.0.1:${PORT}/landscape.mp4`, preset: 'social', out: JOBS, srt: srtFix });
  ok(res.status === 'complete', 'srt-supplied run completes', JSON.stringify(res.manifest.errors));
  ok(fs.readFileSync(path.join(res.jobDir, 'out', 'captions.srt'), 'utf8') === fs.readFileSync(srtFix, 'utf8'), 'supplied srt copied verbatim');
  const vtt = fs.readFileSync(path.join(res.jobDir, 'out', 'captions.vtt'), 'utf8');
  ok(vtt.startsWith('WEBVTT') && vtt.includes('hello srt fixture') && vtt.includes('00:00:00.500 --> 00:00:02.000'), 'derived captions.vtt produced from supplied srt');
  ok(res.manifest.artifacts.vtt && res.manifest.artifacts.vtt.bytes > 0, 'vtt recorded as job artifact');
  const q = JSON.parse(fs.readFileSync(path.join(res.jobDir, 'out', 'qc.json'), 'utf8'));
  ok(q.checks.some((c) => c.name === 'captions/vtt-format' && c.pass), 'qc measures captions/vtt-format');
}

console.log('== E2E: ADAPTIVE REFRAME (measured pixels, not prose) ==');
{
  const res = video.runJob({ input: redClip, preset: 'social', out: JOBS });
  ok(res.status === 'complete', 'red-fixture social run completes (crop default)', JSON.stringify(res.manifest.errors));
  const vLuma = edgeLuma(path.join(res.jobDir, 'out', 'vertical.mp4'));
  const sLuma = edgeLuma(path.join(res.jobDir, 'out', 'square.mp4'));
  ok(vLuma > 40, 'vertical is full-bleed cropped (corner luma > 40, no black bar)', vLuma);
  ok(sLuma > 40, 'square is full-bleed cropped (corner luma > 40)', sLuma);
  const resPad = video.runJob({ input: redClip, preset: 'social', out: JOBS, reframe: 'pad' });
  ok(resPad.status === 'complete' && resPad.jobId !== res.jobId, 'pad reframe is a distinct deterministic job');
  const pLuma = edgeLuma(path.join(resPad.jobDir, 'out', 'vertical.mp4'));
  ok(pLuma >= 0 && pLuma < 30, 'pad mode letterboxes as ordered (corner luma < 30)', pLuma);
  expectCode(() => video.runJob({ input: redClip, preset: 'social', out: JOBS, reframe: 'diagonal' }), 'EINPUT', 'unknown reframe -> EINPUT');
}

console.log('== IDEMPOTENCY ==');
{
  const before = fs.statSync(path.join(jobDir1, 'out', 'master.mp4')).mtimeMs;
  const res = video.runJob({ input: `http://127.0.0.1:${PORT}/landscape.mp4`, preset: 'social', out: JOBS, transcript: transcriptFix });
  ok(res.jobId === jobId1, 'rerun same input+preset -> same deterministic jobId');
  ok(res.manifest.stages.render_master.cached === true, 'render_master cache-skipped on rerun');
  ok(res.status === 'complete', 'rerun completes');
  ok(fs.statSync(path.join(jobDir1, 'out', 'master.mp4')).mtimeMs === before, 'master.mp4 untouched on cached rerun');
  const r2 = video.runJob({ input: `http://127.0.0.1:${PORT}/landscape.mp4`, preset: 'social', out: JOBS, transcript: transcriptFix, burnCaptions: true });
  ok(r2.jobId !== jobId1, 'output-changing params (captions/burn) produce a new deterministic jobId');
  ok(r2.status === 'complete' && r2.manifest.params.burnCaptions === true && r2.manifest.stages.render_master.cached !== true, 'renders recompute for new caption params');
  ok(JSON.parse(fs.readFileSync(path.join(r2.jobDir, 'out', 'edit-plan.json'), 'utf8')).burnCaptions === true, 'burn flag present in hydrated plan');
  ok(fs.existsSync(path.join(r2.jobDir, 'out', 'vertical.mp4')), 'burn-captions vertical rendered (captions stage precedes variants)');
  if (edit.hasSubtitlesFilter()) {
    ok(r2.manifest.artifacts.vertical && r2.manifest.artifacts.vertical.bytes > 0, 'burned vertical artifact verified (libass present)');
  } else {
    let capCode = '';
    try { video.runJob({ input: `http://127.0.0.1:${PORT}/landscape.mp4`, preset: 'social', out: JOBS, transcript: transcriptFix, burnCaptions: true, force: true }); } catch (e) { capCode = e.code || ''; }
    ok(capCode === 'ERENDER_CAPABILITY', 'burn without libass -> explicit ERENDER_CAPABILITY (no cryptic 234)', capCode);
  }
  const rBool = video.runJob({ input: fps7, preset: 'master', out: JOBS, burnCaptions: true });
  const rBoolStr = video.runJob({ input: fps7, preset: 'master', out: JOBS, burnCaptions: 'true' });
  ok(rBool.jobId === rBoolStr.jobId && rBoolStr.manifest.stages.render_master.cached === true, "string 'true' normalizes to boolean (same deterministic jobId, cache hit)");
}

console.log('== FAILURE MATRIX ==');
{
  expectCode(() => video.runJob({ input: `http://127.0.0.1:${PORT}/missing.mp4`, out: JOBS }), 'EFETCH_404', '404 url -> EFETCH_404');
  expectCode(() => video.runJob({ input: `http://127.0.0.1:${PORT}/fake.mp4`, out: JOBS }), 'EFETCH_TYPE', 'html-as-media -> EFETCH_TYPE');
  expectCode(() => video.runJob({ input: `http://127.0.0.1:${PORT}/watch?v=abc`, out: JOBS }), 'EUNSUPPORTED_SOURCE', 'page url without yt-dlp -> EUNSUPPORTED_SOURCE with hint');
  expectCode(() => video.runJob({ input: `http://127.0.0.1:${PORT}/big.mp4`, out: JOBS, maxBytesMb: 19 }), 'EGUARD_SIZE', 'oversized guard -> EGUARD_SIZE');
  expectCode(() => video.runJob({ input: `http://127.0.0.1:${PORT}/slow.mp4`, out: JOBS, timeoutMs: 2000 }), 'EGUARD_TIMEOUT', 'slow source -> EGUARD_TIMEOUT');
  let corruptCode = '';
  try { video.runJob({ input: corrupt, out: JOBS }); } catch (e) { corruptCode = e.code || ''; }
  ok(corruptCode === 'EPROBE', 'truncated mp4 -> EPROBE', corruptCode);
}
{
  const r = video.runJob({ input: noaudio, preset: 'master', out: JOBS });
  ok(r.status === 'complete' && r.manifest.artifacts.master.bytes > 0, 'no-audio clip completes (-an by design)');
  const plan = JSON.parse(fs.readFileSync(path.join(r.jobDir, 'out', 'edit-plan.json'), 'utf8'));
  ok(plan.audio.enabled === false, 'no-audio plan: audio disabled explicitly');
  ok(JSON.parse(fs.readFileSync(path.join(r.jobDir, 'out', 'qc.json'), 'utf8')).pass === true, 'no-audio QC pass (audio-absent expected)');
}
{
  const r = video.runJob({ input: port_, preset: 'social', out: JOBS });
  ok(r.status === 'complete', 'portrait input completes');
  ok(edit.probe(path.join(r.jobDir, 'out', 'vertical.mp4')).width === 1080, 'portrait -> vertical geometry ok');
}
{
  const r = video.runJob({ input: fps7, preset: 'master', out: JOBS });
  ok(r.status === 'complete', 'unusual fps (7) completes');
}

console.log('== QC-NEGATIVE (truncated artifact) ==');
{
  const badDir = path.join(TMP, 'qc-negative');
  fs.mkdirSync(badDir, { recursive: true });
  const src = path.join(jobDir1, 'out', 'master.mp4');
  const dst = path.join(badDir, 'master.mp4');
  fs.writeFileSync(dst, fs.readFileSync(src).subarray(0, 4096));
  const plan = JSON.parse(fs.readFileSync(path.join(jobDir1, 'out', 'edit-plan.json'), 'utf8'));
  const m = JSON.parse(fs.readFileSync(path.join(jobDir1, 'manifest.json'), 'utf8'));
  const q = qcLane.runQc({
    jobDir: badDir, plan, manifest: m,
    paths: { master: dst, vertical: null, square: null, srt: null },
    renderExits: { master: 0 },
    allArtifacts: { master: dst },
  });
  ok(q.pass === false, 'QC fails on truncated artifact');
  ok(q.checks.some((c) => !c.pass && /ffprobe-parse|duration|exists/.test(c.name)), 'QC reports the concrete failing check', JSON.stringify(q.checks.filter((c) => !c.pass).map((c) => c.name)));
}

console.log('== OPERATOR SURFACE (run.js = HTTP/MCP path, cli.js = human path) ==');
{
  const srtOperFix = path.join(TMP, 'operator.srt');
  fs.writeFileSync(srtOperFix, '1\n00:00:00,300 --> 00:00:02,300\noperator caption one\n\n2\n00:00:03,000 --> 00:00:05,500\noperator caption two\n');
  const argsFile = path.join(TMP, 'args.json');
  fs.writeFileSync(argsFile, JSON.stringify({ input: fps7, preset: 'master', out: path.join(TMP, 'cli-jobs') }));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'video_run', argsFile], { encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  let j = null; try { j = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop()); } catch {}
  ok(j && j.ok === true && /complete/.test(j.text), 'run.js video_run end-to-end (HTTP job path)', r.stdout + r.stderr);
  const stArgs = path.join(TMP, 'status-args.json');
  fs.writeFileSync(stArgs, JSON.stringify({ job: j && j.text ? (j.text.match(/job ([a-f0-9]{12})/) || [])[1] : '', out: path.join(TMP, 'cli-jobs') }));
  const st = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'video_status', stArgs], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  ok(/video_status/.test(st.stdout || ''), 'run.js video_status reachable');
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'cli.js'), 'video', land, '--preset', 'master', '--out', path.join(TMP, 'cli2')], { encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  ok(cli.status === 0 && /complete/.test(cli.stdout || ''), 'cli.js video <file> one-command operator run', (cli.stderr || '').slice(0, 200));
  // Documented kebab-case flags must reach the tool layer (Phoenix regression:
  // --burn-captions was silently dropped by the CLI parser).
  const cliCap = spawnSync(process.execPath, [path.join(ROOT, 'cli.js'), 'video', `http://127.0.0.1:${PORT}/landscape.mp4`, '--preset', 'social', '--out', path.join(TMP, 'cli3'), '--srt', srtOperFix, '--burn-captions', '--reframe', 'crop'], { encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  ok(cliCap.status === 0 && /complete/.test(cliCap.stdout || ''), 'cli.js: documented --srt/--burn-captions/--reframe flags honored end-to-end', (cliCap.stderr || cliCap.stdout || '').slice(0, 200));
  const capDir = path.join(TMP, 'cli3');
  const capJobs = fs.readdirSync(capDir).filter((d) => fs.existsSync(path.join(capDir, d, 'manifest.json')));
  const capManifest = JSON.parse(fs.readFileSync(path.join(capDir, capJobs[0], 'manifest.json'), 'utf8'));
  ok(capManifest.params.burnCaptions === true && capManifest.params.reframe === 'crop', 'cli kebab-case flags mapped into manifest params', JSON.stringify(capManifest.params));
  ok(fs.existsSync(path.join(capDir, capJobs[0], 'out', 'captions.vtt')), 'cli srt-supplied run produced captions.vtt');
}

console.log('== OPTIONAL PUBLIC SMOKE (non-blocking) ==');
if (process.env.MYSTIC_VIDEO_SMOKE_URL) {
  try {
    const r = video.runJob({ input: process.env.MYSTIC_VIDEO_SMOKE_URL, preset: 'master', out: JOBS });
    ok(r.status === 'complete', 'public smoke completes');
  } catch (e) { console.log(`SKIP public smoke (non-blocking): ${e.code}: ${String(e.message).slice(0, 120)}`); }
} else {
  console.log('SKIP public smoke (set MYSTIC_VIDEO_SMOKE_URL to enable; core CI is network-independent)');
}

try { srv.kill(); } catch {}
console.log(`\nVIDEO FACTORY TEST MATRIX: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('FAILED:', failures.join(' | ')); process.exit(1); }
console.log(`tmpdir kept for inspection: ${TMP}`);
process.exit(0);
}
