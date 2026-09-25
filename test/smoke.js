'use strict';
// Offline smoke test: config resolution, prompts, tool list, MCP handshake,
// doctor runs, CLI dispatches an error cleanly. No network, no keys needed.

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');

// 1. config loads with defaults, no keys required
const cfg = require(path.join(ROOT, 'lib', 'config'));
const c = cfg.load();
assert(c.outDir && c.stateDir, 'out/state dirs resolve');
assert.strictEqual(c.allowFileUrls, false, 'file:// blocked by default');
assert.strictEqual(c.host, '127.0.0.1', 'HTTP binds localhost by default');
assert(c.geminiKey === '' || typeof c.geminiKey === 'string', 'gemini key is a string (may be empty)');
assert(!/sk-|AIza/.test(JSON.stringify(c)), 'no raw secret shape in config dump');

// allowlist maths
assert(cfg.isAllowedPath(c, path.join(os.tmpdir(), 'x.png')) === true, 'tmp allowed');
assert(cfg.isAllowedPath(c, '/etc/passwd') === false, 'system paths blocked');

// 2. prompts exist and are de-personalized (no estate names); scored laws carry SCORE
const prompts = require(path.join(ROOT, 'lib', 'prompts'));
for (const k of ['PHOTO_LAW', 'DESIGN_LAW', 'VIDEO_LAW', 'DELTA_LAW', 'AUDIT_LAW']) assert(prompts[k].length > 200, `${k} present`);
for (const key of Object.keys(prompts)) assert(!/Phoenix|estate|hq\//i.test(prompts[key]), `${key} has no estate wording`);
assert(/SCORE:/.test(prompts.PHOTO_LAW) && /SCORE:/.test(prompts.DESIGN_LAW), 'photo+design laws carry SCORE');
assert(prompts.AUDIT_LAW.includes('${N}'), 'AUDIT_LAW keeps its ${N} placeholder');
assert(/CROSS-PAGE CONSISTENCY/.test(prompts.AUDIT_LAW), 'AUDIT_LAW judges cross-page consistency');

// 2b. treatments registry: recipes are complete, review brief injectable, law treatment-aware
const treatments = require(path.join(ROOT, 'lib', 'treatments'));
const golden = treatments.get('golden');
assert(golden && /--gold:/.test(golden.css) && golden.moves.length === 6 && golden.guards.length >= 3, 'golden treatment complete (css + 6 moves + guards)');
assert(treatments.get('nope') === undefined && treatments.ids().includes('golden'), 'unknown id is undefined, golden listed');
assert(/SIGNATURE TREATMENT/.test(treatments.reviewBrief(golden)) && /5% of the pixels/.test(treatments.reviewBrief(golden)), 'review brief carries the idiom + guards');
assert(/TREATMENT DISCIPLINE/.test(prompts.DESIGN_LAW), 'DESIGN_LAW is treatment-aware');
const { TOOLS } = require(path.join(ROOT, 'lib', 'core'));

// 3. tool list: 15 tools, schema'd, neutral
assert.strictEqual(TOOLS.length, 15, '15 tools');
for (const t of TOOLS) { assert(t.name && t.description && t.inputSchema, `${t.name} complete`); assert(!/Phoenix/i.test(t.description)); }
const names = TOOLS.map((t) => t.name);
for (const want of ['photo_see', 'web_review', 'recheck', 'studio_doctor', 'video_gif', 'photo_generate', 'web_audit', 'polish', 'taste_note', 'treatments']) assert(names.includes(want), `${want} present`);
const trTool = TOOLS.find((t) => t.name === 'treatments');
assert(trTool.inputSchema.properties.name && !trTool.inputSchema.required, 'treatments name is optional');
assert(TOOLS.find((t) => t.name === 'web_review').inputSchema.properties.treatment, 'web_review accepts a declared treatment');
assert(/treatment/.test(TOOLS.find((t) => t.name === 'web_review').description), 'web_review mentions the treatment hook');
assert(names.some((n) => /generate|edit/.test(n) && TOOLS.find((t) => t.name === n).description.includes('CREDITS')), 'paid tools labelled');

// 4. MCP handshake over stdio
const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n' +
  JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n' +
  JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n';
const hs = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], { input: init, encoding: 'utf8', timeout: 20000 });
const lines = hs.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
assert(lines.find((m) => m.id === 1 && m.result && m.result.serverInfo), 'initialize answered');
const toolsMsg = lines.find((m) => m.id === 2);
assert(toolsMsg.result.tools.length === 15, 'tools/list answered with 15');

// 5. unknown tool -> clean MCP error
const bad = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], {
  input: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope', arguments: {} } }) + '\n',
  encoding: 'utf8', timeout: 20000,
});
assert(/unknown tool/.test(bad.stdout), 'unknown tool errors cleanly');

// 5b. treatments over MCP: list, full recipe, clean error on unknown id
const trCall = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'treatments', arguments: {} } }) + '\n' +
  JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'treatments', arguments: { name: 'golden' } } }) + '\n' +
  JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'treatments', arguments: { name: 'nope' } } }) + '\n';
const ts = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], { input: trCall, encoding: 'utf8', timeout: 20000 });
const tlines = ts.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tText = (id) => tlines.find((m) => m.id === id).result.content[0].text;
assert(/The Golden Treatment/.test(tText(3)), 'treatments list served over MCP');
assert(/TOKENS:/.test(tText(4)) && /GUARDS:/.test(tText(4)) && /{"treatment":"golden"}/.test(tText(4)), 'full golden recipe served over MCP');
assert(/unknown treatment/.test(tText(5)), 'unknown treatment errors cleanly over MCP');

// 6. doctor runs offline (may report MISSING — must not crash)
fs.writeFileSync(path.join(HERE, 'args-empty.json'), '{}');
const doc2 = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'studio_doctor', path.join(HERE, 'args-empty.json')], { encoding: 'utf8', timeout: 30000 });
const parsed = JSON.parse(doc2.stdout.trim());
assert(parsed.ok && /MISSING |OK/.test(parsed.text), `doctor prints a report (${parsed.error || ''})`);

// 7. shot guard: file:// refused by default
fs.writeFileSync(path.join(HERE, 'args-shot.json'), JSON.stringify({ url: 'file:///etc/passwd', widths: [1280] }));
const shot = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'web_shot', path.join(HERE, 'args-shot.json')], { encoding: 'utf8', timeout: 30000 });
assert(/only http/.test(JSON.parse(shot.stdout.trim()).error), 'file:// guard active');

(async () => {
// 8. page-health formatter: deterministic, broken ≠ pending, honest when absent
const { formatHealth, extractFixes, parseScore } = require(path.join(ROOT, 'lib', 'core'));
assert(/clean at capture/.test(formatHealth({})), 'clean health states clean');
assert(/HTTP errors: 1 \(404/.test(formatHealth({ httpErrors: [{ url: 'https://x/img/hero.jpg', status: 404 }] })), 'http error listed');
const withBroken = formatHealth({ brokenImages: [{ src: 'https://x/hero.jpg' }] });
assert(/broken images: 1/.test(withBroken) && /zero rendered pixels/.test(withBroken), 'broken image fact');
assert(/pending images: 2/.test(formatHealth({ pendingImages: 2 })), 'pending counted');
assert(/unavailable/.test(formatHealth(null)) && /unavailable/.test(formatHealth({ missing: 'sidecar not written' })), 'missing sidecar is honest');

// 9. verdict parsing survives case + markdown variants (models do not always shout)
assert.strictEqual(parseScore('score: *92*/100'), 92, 'parseScore lowercase + asterisks');
assert.strictEqual(parseScore('SCORE: **88**/100'), 88, 'parseScore bold');
assert.strictEqual(parseScore('SCORE: 76 / 100'), 76, 'parseScore spaced');
assert.strictEqual(parseScore('no score here'), null, 'no false score');
const fx = extractFixes('VERDICT: NEEDS WORK\n\nTop 3 fixes:\n- tighten hero spacing\n- fix CTA contrast\nMOBILE: clean');
assert(/tighten hero spacing/.test(fx) && /fix CTA contrast/.test(fx), 'extractFixes case-insensitive');
assert(extractFixes('**TOP 3 FIXES:**\n- bold marker').includes('bold marker'), 'extractFixes bold marker');
const { topFixes } = require(path.join(ROOT, 'lib', 'polish'));
assert(/tighten hero spacing/.test(topFixes('Top 3 Fixes: tighten hero spacing; fix CTA contrast')), 'topFixes case-insensitive');

// 10. video_keyframes fails closed when ffmpeg fails (exit 1) or lies (exit 0, no file)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-smoke-'));
const writeBin = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); fs.chmodSync(p, 0o755); return p; };
const fakeProbe = writeBin('ffprobe', '#!/bin/sh\necho \'{"format":{"duration":"4","size":"1000"}}\'\n');
const fakeFail = writeBin('ffmpeg-fail', '#!/bin/sh\necho "boom" >&2\nexit 1\n');
const fakeLiar = writeBin('ffmpeg-liar', '#!/bin/sh\nexit 0\n');
const fakeGood = writeBin('ffmpeg-good', '#!/bin/sh\nlast=""\nfor a in "$@"; do last="$a"; done\necho fakejpg > "$last"\nexit 0\n');
const tinyVid = path.join(tmp, 'tiny.mp4');
fs.writeFileSync(tinyVid, Buffer.from('not really an mp4 — fake ffprobe answers anyway'));
const cfgPath = path.join(tmp, 'config.json');
fs.writeFileSync(cfgPath, JSON.stringify({ outDir: path.join(tmp, 'out'), stateDir: path.join(tmp, 'state') }));
const kfArgs = path.join(tmp, 'kf.json');
fs.writeFileSync(kfArgs, JSON.stringify({ video: tinyVid, count: 2 }));
const runEnv = (extra) => ({ ...process.env, MYSTIC_STUDIO_CONFIG: cfgPath, ...extra });
const kf = (ffmpeg) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'video_keyframes', kfArgs], { cwd: ROOT, encoding: 'utf8', timeout: 60000, env: runEnv({ MYSTIC_STUDIO_FFMPEG: ffmpeg, MYSTIC_STUDIO_FFPROBE: fakeProbe }) });
  return { status: r.status, body: JSON.parse(r.stdout.trim()) };
};
const kFail = kf(fakeFail);
assert(kFail.body.ok === false && /ffmpeg keyframe 1 failed/.test(kFail.body.error), 'ffmpeg exit 1 fails keyframes');
assert(kFail.status === 1, 'keyframes failure exits non-zero');
const kLiar = kf(fakeLiar);
assert(kLiar.body.ok === false && /missing or empty after ffmpeg exit 0/.test(kLiar.body.error), 'exit-0-no-file ffmpeg cannot fake success');
const kGood = kf(fakeGood);
assert(kGood.body.ok === true && /saved 2 keyframes/.test(kGood.body.text), 'real writes still pass');
for (const line of kGood.body.text.split('\n').slice(1)) {
  assert(line.startsWith('/'), 'returned keyframe paths are absolute');
  assert(fs.statSync(line).size > 0, `keyframe file actually exists: ${line}`);
}

// 11. provider failure is honest: dead endpoint and 200-with-error both surface as ok:false
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const onePng = path.join(tmp, 'one.png');
fs.writeFileSync(onePng, PNG1);
const seeArgs = path.join(tmp, 'see.json');
fs.writeFileSync(seeArgs, JSON.stringify({ image: onePng }));
const seeCfg = (base) => {
  const p = path.join(tmp, 'see-config.json');
  fs.writeFileSync(p, JSON.stringify({ geminiBase: base, outDir: path.join(tmp, 'out'), stateDir: path.join(tmp, 'state'), envFile: path.join(tmp, 'fake.env') }));
  fs.writeFileSync(path.join(tmp, 'fake.env'), 'GEMINI_API_KEY=fake-key-for-failure-test\n');
  return p;
};
// Async spawn: the mock server below lives in THIS process, and spawnSync would freeze
// the event loop that must serve the child's request (the classic self-deadlock).
const runAsync = (args, opts) => new Promise((resolve) => {
  const p = spawn(process.execPath, args, opts);
  let stdout = '', stderr = '';
  const timer = setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs || 60000);
  p.stdout.on('data', (d) => { stdout += d; });
  p.stderr.on('data', (d) => { stderr += d; });
  p.on('error', (e) => { clearTimeout(timer); resolve({ status: 1, stdout, stderr, spawnError: e.message }); });
  p.on('close', (code) => { clearTimeout(timer); resolve({ status: code, stdout, stderr }); });
});
const dead = await runAsync([path.join(ROOT, 'run.js'), 'photo_see', seeArgs], { cwd: ROOT, timeoutMs: 60000, env: { ...process.env, MYSTIC_STUDIO_CONFIG: seeCfg('http://127.0.0.1:9') } });
const deadBody = JSON.parse(dead.stdout.trim());
assert(deadBody.ok === false && /gemini non-JSON reply/.test(deadBody.error), 'dead provider surfaces as failure');
assert(dead.status === 1, 'provider failure exits non-zero');
const errSrv = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: { message: 'quota exceeded (fake)' } })); });
await new Promise((resolve) => errSrv.listen(0, '127.0.0.1', resolve));
const fake200 = await runAsync([path.join(ROOT, 'run.js'), 'photo_see', seeArgs], { cwd: ROOT, timeoutMs: 60000, env: { ...process.env, MYSTIC_STUDIO_CONFIG: seeCfg(`http://127.0.0.1:${errSrv.address().port}`) } });
errSrv.close();
const fake200Body = JSON.parse(fake200.stdout.trim());
assert(fake200Body.ok === false && /gemini error: quota exceeded/.test(fake200Body.error), '200-with-error-body surfaces as failure');
assert(fake200.status === 1, 'error-body failure exits non-zero');

// 12. shot --health (real runtime): local page with a broken image + a lazy below-fold image.
// Skipped unless playwright + a browser are present (CI has neither — stays offline-fast).
const chk = spawnSync(process.execPath, [path.join(ROOT, 'shot.js'), '--check'], { encoding: 'utf8', timeout: 30000 });
// MYSTIC_STUDIO_CHROME is honored fail-closed: set-but-missing reports MISSING (no silent scan).
const chkBad = spawnSync(process.execPath, [path.join(ROOT, 'shot.js'), '--check'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, MYSTIC_STUDIO_CHROME: '/nonexistent/chrome' } });
assert(/browser=MISSING/.test(chkBad.stdout), 'MYSTIC_STUDIO_CHROME set-but-missing fails closed instead of ignoring the override');
const fakeChrome = path.join(tmp, 'fake-chrome');
fs.writeFileSync(fakeChrome, '#!/bin/sh\n');
const chkEnv = spawnSync(process.execPath, [path.join(ROOT, 'shot.js'), '--check'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, MYSTIC_STUDIO_CHROME: fakeChrome } });
assert(new RegExp('browser=OK ' + fakeChrome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(chkEnv.stdout), 'MYSTIC_STUDIO_CHROME existing path is used verbatim');
if (/playwright=OK/.test(chk.stdout) && /browser=OK/.test(chk.stdout)) {
  const srv = http.createServer((req, res) => {
    if (req.url === '/good.png') { res.setHeader('content-type', 'image/png'); res.end(PNG1); }
    else if (req.url === '/broken.png') { res.statusCode = 404; res.end('nope'); }
    else if (req.url === '/lazy.png') { setTimeout(() => { res.setHeader('content-type', 'image/png'); res.end(PNG1); }, 2500); }
    else { res.setHeader('content-type', 'text/html'); res.end('<html><body><img src="/good.png"><img src="/broken.png"><div style="height:3000px"></div><img src="/lazy.png" loading="lazy"></body></html>'); }
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const shotOut = path.join(tmp, 'health-shot.png');
  const sidecar = `${shotOut}.health.json`;
  const hs = await runAsync([path.join(ROOT, 'shot.js'), `http://127.0.0.1:${srv.address().port}/`, shotOut, '--w', '800', '--h', '600', '--health', sidecar], { timeoutMs: 90000 });
  srv.close();
  if (hs.status === 0) {
    assert(fs.existsSync(shotOut) && fs.statSync(shotOut).size > 0, 'png written');
    const h = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    assert(h.httpErrors.some((e) => e.status === 404 && /broken\.png/.test(e.url)), '404 captured');
    assert(h.brokenImages.some((b) => /broken\.png/.test(b.src)), 'broken image detected');
    assert(!h.brokenImages.some((b) => /good\.png/.test(b.src)), 'good image not flagged broken');
    assert(typeof h.pendingImages === 'number', 'pending images counted (broken vs pending kept apart)');
  } else if (/browserType\.launch/.test(hs.stderr || '')) {
    // Browser binary exists (--check passed) but cannot launch HERE — e.g. a locked-down
    // sandbox blocks Chromium's Mach bootstrap. Environmental: skip, never silently pass.
    console.log('shot --health runtime test: skipped (browser present but not launchable in this sandbox)');
  } else {
    assert(false, `health shot succeeds (${(hs.stderr || hs.spawnError || '').slice(0, 300)})`);
  }
} else {
  console.log('shot --health runtime test: skipped (no playwright/browser in this environment)');
}

for (const f of ['args-empty.json', 'args-shot.json']) try { fs.unlinkSync(path.join(HERE, f)); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log('smoke: all checks passed');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
