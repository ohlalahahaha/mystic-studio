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

// Exercise the actual Starter HTTP routes without needing a browser or provider.
const renderDemo = path.join(ROOT, 'workbox-starter', 'render-demo.mjs');
if (fs.existsSync(renderDemo)) {
  const routes = spawnSync(process.execPath, [renderDemo, '--check'], { encoding: 'utf8', timeout: 20000 });
  assert.strictEqual(routes.status, 0, routes.stderr || routes.stdout);
  assert(/all fixture routes served correctly/.test(routes.stdout), 'Starter routes are executable');
}

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

// 3. tool list: 17 tools, schema'd, neutral
assert.strictEqual(TOOLS.length, 17, '17 tools');
for (const t of TOOLS) { assert(t.name && t.description && t.inputSchema, `${t.name} complete`); assert(!/Phoenix/i.test(t.description)); }
const names = TOOLS.map((t) => t.name);
for (const want of ['photo_see', 'web_review', 'recheck', 'studio_doctor', 'video_gif', 'photo_generate', 'web_audit', 'polish', 'taste_note', 'treatments', 'motion_assets', 'motion_prototype']) assert(names.includes(want), `${want} present`);
const trTool = TOOLS.find((t) => t.name === 'treatments');
assert(trTool.inputSchema.properties.name && !trTool.inputSchema.required, 'treatments name is optional');
assert(TOOLS.find((t) => t.name === 'web_review').inputSchema.properties.treatment, 'web_review accepts a declared treatment');
assert(/treatment/.test(TOOLS.find((t) => t.name === 'web_review').description), 'web_review mentions the treatment hook');
assert(TOOLS.find((t) => t.name === 'polish').inputSchema.properties.motion, 'polish accepts optional motion selection');
assert(names.some((n) => /generate|edit/.test(n) && TOOLS.find((t) => t.name === n).description.includes('CREDITS')), 'paid tools labelled');

// 4. MCP handshake over stdio
const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n' +
  JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n' +
  JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n';
const hs = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], { input: init, encoding: 'utf8', timeout: 20000 });
const lines = hs.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
assert(lines.find((m) => m.id === 1 && m.result && m.result.serverInfo), 'initialize answered');
const toolsMsg = lines.find((m) => m.id === 2);
assert(toolsMsg.result.tools.length === 17, 'tools/list answered with 17');

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

// 5c. motion catalog and the opt-in polish runner contract share one registry
const assets = require(path.join(ROOT, 'lib', 'motion-assets'));
assert.deepStrictEqual(assets.ids(), ['lenis', 'gsap', 'vanta', 'react-bits']);
assert.strictEqual(assets.select('gsap,gsap,lenis').length, 2, 'duplicate selections collapse');
assert.throws(() => assets.select('gsap,unknown'), /unknown motion asset/);
assert(/Commons Clause/.test(assets.format('react-bits')) && /static fallback/.test(assets.format('vanta')), 'license and performance guards included');
const motionCall = JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'motion_assets', arguments: { name: 'gsap,lenis' } } }) + '\n';
const ms = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], { input: motionCall, encoding: 'utf8', timeout: 20000 });
const mline = JSON.parse(ms.stdout.trim());
assert(/GSAP/.test(mline.result.content[0].text) && /Lenis/.test(mline.result.content[0].text), 'selected recipes served over MCP');
const motionCli = spawnSync(process.execPath, [path.join(ROOT, 'cli.js'), 'motion', 'react-bits'], { encoding: 'utf8', timeout: 20000 });
assert.strictEqual(motionCli.status, 0);
assert(/React projects only/.test(motionCli.stdout), 'CLI uses same registry');
const { polish } = require(path.join(ROOT, 'lib', 'polish'));
let contract = '';
const fakeApi = {
  newId: () => 'test', saveStep: () => {},
  review: () => 'VERDICT: NEEDS ATTENTION\nTOP 3 FIXES:\n- Add a purposeful hero animation',
  runContract: (_repo, _profile, body) => { contract = body; return { verdict: 'NO-GO' }; },
  delta: () => { throw new Error('should stop before delta'); },
};
polish({}, { url: 'https://example.com', repo: '/tmp/site', motion: 'gsap,lenis', maxRounds: 1 }, fakeApi);
assert(/OPTIONAL MOTION SOURCES/.test(contract) && /github.com\/greensock\/GSAP/.test(contract) && /reduced motion/.test(contract), 'selected sources reach the coding runner contract');
assert(!/react-bits/.test(contract), 'unselected source excluded');
assert.throws(() => polish({}, { motion: 'gsap,unknown' }, fakeApi), /unknown motion asset/, 'invalid selection fails before running');

// 5d. real prototype export: deterministic, safe copy and CTA, optional runtime
const prototypeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-prototype-'));
const { prototype } = require(path.join(ROOT, 'lib', 'motion-prototype'));
const prototypeArgs = { headline: 'Make <space> for good work', description: 'Original & deliberate.', action: 'Ask for details', destination: 'https://example.com/?a=1&b=2', motion: 'gsap,lenis' };
const produced = prototype({ outDir: prototypeDir }, prototypeArgs);
const producedAgain = prototype({ outDir: prototypeDir }, prototypeArgs);
assert.strictEqual(producedAgain, produced, 'repeat export has stable path');
assert.strictEqual(fs.readdirSync(prototypeDir).length, 1, 'repeat export creates no duplicate source');
const exported = fs.readFileSync(produced.split('\n')[0].slice(6), 'utf8');
assert(exported.includes('Make &lt;space&gt;') && exported.includes('Original &amp; deliberate.'), 'copy escaped');
assert(exported.includes('a=1&amp;b=2') && !exported.includes('href="javascript:'), 'CTA escaped');
assert(/gsap@3\.15\.0/.test(exported) && /lenis@1\.3\.26/.test(exported), 'selected motion loaded');
assert(/prefers-reduced-motion/.test(exported) && /if \(window\.gsap\)/.test(exported), 'static fallback and reduced motion');
assert(/max-width:700px/.test(exported) && /min-height:48px/.test(exported), 'mobile layout and tap size');
assert.throws(() => prototype({ outDir: prototypeDir }, { ...prototypeArgs, destination: 'javascript:alert(1)' }), /HTTPS or mailto/);
assert.throws(() => prototype({ outDir: prototypeDir }, { ...prototypeArgs, motion: 'react-bits' }), /React Bits needs a React project/);
const anchorExport = prototype({ outDir: prototypeDir }, { ...prototypeArgs, destination: '#details' });
assert(fs.readFileSync(anchorExport.split('\n')[0].slice(6), 'utf8').includes('href="#details"'), 'internal CTA reaches a real section');
fs.rmSync(prototypeDir, { recursive: true, force: true });

// 5e. glm-image provider: pure validation (offline, no network, no real secrets)
const glm = require(path.join(ROOT, 'lib', 'glm'));
assert.strictEqual(glm.RECOMMENDED_SIZES.length, 7, 'seven recommended glm sizes');
for (const s of glm.RECOMMENDED_SIZES) assert(glm.validSize(s), 'recommended size ' + s + ' accepted');
for (const s of ['1024x1024', '512x512', '2048x2048', '960x960', '1280X1280']) assert(glm.validSize(s), 'custom/normalized size ' + s + ' accepted');
for (const s of ['banana', '1000x1000', '2049x1024', '480x640', '1280', '']) assert(!glm.validSize(s), 'invalid size ' + JSON.stringify(s) + ' refused');
assert.deepStrictEqual(Object.keys(glm.ASPECT_MAP), ['1:1', '16:9', '9:16'], 'aspect map is the documented trio');
assert.strictEqual(glm.provider({ imageProvider: 'higgsfield' }, {}), 'higgsfield', 'config default provider kept');
assert.strictEqual(glm.provider({}, { provider: 'GLM' }), 'glm', 'explicit provider wins, case-tolerant');
assert.throws(() => glm.provider({}, { provider: 'openai' }), /known providers/, 'unknown provider refused');
assert.throws(() => glm.provider({ imageProvider: 'openai' }, {}), /known providers/, 'bad config provider refused');
const glmSig = path.join(os.tmpdir(), 'glm-sig-test.png');
fs.writeFileSync(glmSig, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
assert(glm.isImageFile(glmSig), 'png signature detected');
fs.writeFileSync(glmSig, '<html>not an image</html>');
assert(!glm.isImageFile(glmSig), 'html refused by signature check');
fs.unlinkSync(glmSig);
const pgTool = TOOLS.find((t) => t.name === 'photo_generate');
assert.deepStrictEqual(pgTool.inputSchema.properties.provider.enum, ['higgsfield', 'glm'], 'provider enum on photo_generate');
assert(pgTool.inputSchema.properties.size && pgTool.inputSchema.properties.quality, 'glm size/quality in schema');
assert(/\$0\.015/.test(pgTool.description) && /SPENDS/.test(pgTool.description) && /No silent provider fallback/.test(pgTool.description), 'paid + no-fallback labelled');
assert(TOOLS.find((t) => t.name === 'photo_edit').inputSchema.properties.provider, 'photo_edit accepts provider (to reject glm explicitly)');
assert(TOOLS.find((t) => t.name === 'studio_catalog').inputSchema.properties.provider, 'studio_catalog accepts provider');

// 5f. glm error hygiene (REPRO1+2 regressions): untrusted code/message/stderr never echo;
// thrown transport failures still clean partial download output. Simulated, no network, no real wait.
const cpMod = require('child_process');
const origSpawnSync = cpMod.spawnSync;
try {
  cpMod.spawnSync = () => ({ status: 0, stdout: JSON.stringify({ error: { code: 'FAKE_SECRET_FOR_TEST' } }) + '\n403', stderr: '' });
  let e1 = null;
  try { glm.generate({ zaiKey: 'FAKE_SECRET_FOR_TEST', glmImageBase: 'http://fixture.invalid' }, { prompt: 'test' }); } catch (e) { e1 = e; }
  assert(e1 && /HTTP 403/.test(e1.message), 'non-2xx surfaces sanitized status');
  assert(e1 && !/FAKE_SECRET_FOR_TEST/.test(e1.message), 'untrusted error.code never echoes');
  cpMod.spawnSync = () => ({ status: 0, stdout: JSON.stringify({ error: { code: '1002' } }) + '\n401', stderr: '' });
  let e2 = null;
  try { glm.generate({ zaiKey: 'FAKE_SECRET_FOR_TEST', glmImageBase: 'http://fixture.invalid' }, { prompt: 'test' }); } catch (e) { e2 = e; }
  assert(e2 && /code=1002/.test(e2.message) && !/FAKE_SECRET_FOR_TEST/.test(e2.message), 'bounded numeric provider code allowed');
  cpMod.spawnSync = () => ({ status: 7, stdout: '', stderr: 'curl: (7) secret-detail-for-test' });
  let e3 = null;
  try { glm.generate({ zaiKey: 'FAKE_SECRET_FOR_TEST', glmImageBase: 'http://fixture.invalid' }, { prompt: 'test' }); } catch (e) { e3 = e; }
  assert(e3 && /curl exit 7/.test(e3.message) && !/secret-detail-for-test/.test(e3.message), 'raw stderr never echoes');
  cpMod.spawnSync = () => { throw new Error('spawnSync curl ETIMEDOUT'); };
  let e4 = null;
  try { glm.generate({ zaiKey: 'FAKE_SECRET_FOR_TEST', glmImageBase: 'http://fixture.invalid' }, { prompt: 'test' }); } catch (e) { e4 = e; }
  assert(e4 && /curl transport error/.test(e4.message) && !/ETIMEDOUT/.test(e4.message), 'generate transport failure sanitized');
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-timeout-'));
  cpMod.spawnSync = (cmdName, args) => {
    const oi = args.indexOf('-o');
    fs.writeFileSync(args[oi + 1], 'partial');
    throw new Error('spawnSync curl ETIMEDOUT');
  };
  let d1 = null;
  try { glm.download({ outDir: dlDir, maxImageMb: 9 }, 'http://fixture.invalid/x.png', 'timeout case'); } catch (e) { d1 = e; }
  assert(d1 && /download failed/.test(d1.message) && !/ETIMEDOUT/.test(d1.message), 'download transport timeout sanitized');
  assert(fs.existsSync(dlDir) && fs.readdirSync(dlDir).length === 0, 'timeout leaves no partial output');
  fs.rmSync(dlDir, { recursive: true, force: true });
} finally { cpMod.spawnSync = origSpawnSync; }



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


// 13. glm-image end-to-end against a local fixture provider (offline — no real API, no spend)
{
  const state = { gen: [], dl: [] };
  const glmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-glm-'));
  const glmOut = path.join(glmDir, 'out');
  const mkCfg = (extra) => {
    const p = path.join(glmDir, 'config-' + Math.random().toString(36).slice(2) + '.json');
    fs.writeFileSync(p, JSON.stringify({ outDir: glmOut, stateDir: path.join(glmDir, 'state'), envFile: path.join(glmDir, 'env.env'), canonicalEnvFile: path.join(glmDir, 'missing.env'), higgsfieldCli: path.join(glmDir, 'hf-fake'), ...extra }));
    return p;
  };
  fs.writeFileSync(path.join(glmDir, 'env.env'), '');
  const hfFake = path.join(glmDir, 'hf-fake');
  fs.writeFileSync(hfFake, '#!/bin/sh\necho "higgs-ran:$@"\nexit 0\n');
  fs.chmodSync(hfFake, 0o755);
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/images/generations') {
      let b = '';
      req.on('data', (d) => { b += d; });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(b); } catch (e) {}
        state.gen.push({ auth: req.headers.authorization || null, body, path: u.pathname });
        const p = String(body.prompt || '');
        if (/APIFAIL/.test(p)) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: '1002', message: 'invalid api key fake-secret-xyz-do-not-echo' } })); }
        else if (/BADJSON/.test(p)) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('totally not json body'); }
        else if (/NODATA/.test(p)) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ created: 123, data: [] })); }
        else if (/DL404/.test(p)) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ created: 123, data: [{ url: base + '/img/missing.png' }] })); }
        else if (/DLFAKE/.test(p)) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ created: 123, data: [{ url: base + '/img/fake.png' }] })); }
        else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ created: 123, data: [{ url: base + '/img/happy.png' }] })); }
      });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/img/happy.png') { state.dl.push({ auth: req.headers.authorization || null }); res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG1); return; }
    if (req.method === 'GET' && u.pathname === '/img/missing.png') { state.dl.push({ auth: req.headers.authorization || null }); res.writeHead(404, { 'content-type': 'text/html' }); res.end('<html>leak-marker-404</html>'); return; }
    if (req.method === 'GET' && u.pathname === '/img/fake.png') { state.dl.push({ auth: req.headers.authorization || null }); res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>leak-marker-fake</html>'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const glmCfgPath = mkCfg({ glmImageBase: base });
  const glmEnv = (extra) => ({ ...process.env, MYSTIC_STUDIO_CONFIG: glmCfgPath, ZAI_API_KEY: 'fake-test-key-not-real', ...extra });
  const glmRun = async (tool, args, env) => {
    const argsFile = path.join(glmDir, 'args.json');
    fs.writeFileSync(argsFile, JSON.stringify(args));
    const r = await runAsync([path.join(ROOT, 'run.js'), tool, argsFile], { cwd: ROOT, timeoutMs: 60000, env: env || glmEnv() });
    let body = null;
    try { body = JSON.parse(r.stdout.trim()); } catch (e) {}
    return { status: r.status, body, raw: String(r.stdout || '') + String(r.stderr || '') };
  };
  const def = await glmRun('photo_generate', { prompt: 'plain harbor' });
  assert(def.body.ok === true && /higgs-ran:image plain harbor/.test(def.body.text), 'default provider still higgsfield with same args');
  assert.strictEqual(state.gen.length, 0, 'default path makes zero glm calls');
  const happy = await glmRun('photo_generate', { prompt: 'sunset pier', provider: 'glm', size: '1728X960', quality: 'hd' });
  assert(happy.body.ok === true, 'glm happy path succeeds: ' + (happy.body.error || ''));
  assert(/saved: /.test(happy.body.text) && /\$0\.015/.test(happy.body.text) && /1728x960/.test(happy.body.text), 'result reports file/size/price');
  const saved = happy.body.text.split('\n').find((l) => l.startsWith('saved: ')).slice(7);
  assert(path.isAbsolute(saved) && saved.startsWith(glmOut) && fs.existsSync(saved) && glm.isImageFile(saved), 'png really saved in outDir');
  assert.strictEqual(state.gen[0].path, '/images/generations', 'documented endpoint path');
  assert.strictEqual(state.gen[0].auth, 'Bearer fake-test-key-not-real', 'generation carries bearer auth');
  assert.deepStrictEqual(state.gen[0].body, { model: 'glm-image', prompt: 'sunset pier', size: '1728x960', quality: 'hd' }, 'request body normalized');
  assert.strictEqual(state.dl[state.dl.length - 1].auth, null, 'download host sees NO auth header');
  const ar = await glmRun('photo_generate', { prompt: 'ar case', provider: 'glm', aspect_ratio: '16:9' });
  assert(ar.body.ok === true && state.gen[1].body.size === '1728x960', 'aspect_ratio 16:9 maps to 1728x960');
  const genCount = () => state.gen.length;
  for (const [args, re, tag] of [
    [{ prompt: 'x', provider: 'glm', aspect_ratio: '21:9' }, /unsupported aspect_ratio/, 'bad aspect ratio'],
    [{ prompt: 'x', provider: 'glm', size: '970x1280' }, /invalid size/, 'bad size'],
    [{ prompt: 'x', provider: 'glm', quality: 'ultra' }, /invalid quality/, 'bad quality'],
    [{ prompt: 'x', provider: 'glm', model: 'glm-image-ultra' }, /unsupported model/, 'foreign model'],
    [{ prompt: 'x', provider: 'glm', image: '/tmp/a.png' }, /text-to-image only/, 'image input refused'],
    [{ prompt: '', provider: 'glm' }, /non-empty text prompt/, 'empty prompt'],
    [{ prompt: 'x', provider: 'openai' }, /known providers/, 'unknown provider'],
  ]) {
    const bad = await glmRun('photo_generate', args);
    assert(bad.body.ok === false && re.test(bad.body.error), tag + ' fails cleanly');
  }
  assert.strictEqual(genCount(), 2, 'invalid requests made zero glm calls');
  const nokey = await glmRun('photo_generate', { prompt: 'x', provider: 'glm' }, glmEnv({ ZAI_API_KEY: '' }));
  assert(nokey.body.ok === false && /ZAI_API_KEY/.test(nokey.body.error) && /higgsfield/.test(nokey.body.error), 'missing key is actionable');
  assert.strictEqual(genCount(), 2, 'missing key makes zero glm calls');
  const apiFail = await glmRun('photo_generate', { prompt: 'APIFAIL case', provider: 'glm' });
  assert(apiFail.body.ok === false && /HTTP 401/.test(apiFail.body.error) && /code=1002/.test(apiFail.body.error), 'api error carries status + code');
  assert(!/fake-secret-xyz/.test(apiFail.raw) && !/invalid api key/.test(apiFail.raw), 'provider error body/secret never echoed');
  const badJson = await glmRun('photo_generate', { prompt: 'BADJSON case', provider: 'glm' });
  assert(badJson.body.ok === false && /non-JSON/.test(badJson.body.error), 'non-json reply surfaced');
  assert(!/totally not json/.test(badJson.raw), 'non-json body never echoed');
  const noData = await glmRun('photo_generate', { prompt: 'NODATA case', provider: 'glm' });
  assert(noData.body.ok === false && /no image url/.test(noData.body.error), 'missing data url surfaced');
  const outBefore = fs.readdirSync(glmOut).sort().join('|');
  const dl404 = await glmRun('photo_generate', { prompt: 'DL404 case', provider: 'glm' });
  assert(dl404.body.ok === false && /download failed/.test(dl404.body.error), 'download 404 fails cleanly');
  assert(!/leak-marker/.test(dl404.raw), '404 html never echoed');
  assert.strictEqual(state.dl[state.dl.length - 1].auth, null, 'failed download also unauthenticated');
  const dlFake = await glmRun('photo_generate', { prompt: 'DLFAKE case', provider: 'glm' });
  assert(dlFake.body.ok === false && /not a supported image/.test(dlFake.body.error), 'html masquerading as image rejected by signature');
  assert(!/leak-marker/.test(dlFake.raw), 'fake image body never echoed');
  assert.strictEqual(fs.readdirSync(glmOut).sort().join('|'), outBefore, 'failed downloads leave no partial files');
  const editGlm = await glmRun('photo_edit', { image: saved, instruction: 'brighten', provider: 'glm' });
  assert(editGlm.body.ok === false && /text-to-image only/.test(editGlm.body.error) && /provider "higgsfield"/.test(editGlm.body.error), 'glm edit refused with explicit guidance');
  const glmDefaultCfg = mkCfg({ glmImageBase: base, imageProvider: 'glm' });
  const editDefault = await glmRun('photo_edit', { image: saved, instruction: 'brighten' }, { ...process.env, MYSTIC_STUDIO_CONFIG: glmDefaultCfg, ZAI_API_KEY: 'fake-test-key-not-real' });
  assert(editDefault.body.ok === false && /provider "higgsfield"/.test(editDefault.body.error), 'glm-as-default edit guides to explicit higgsfield');
  assert.strictEqual(genCount(), 7, 'edits and download failures made no successful extra paid calls');
  // real CLI happy path: --ar normalized to aspect_ratio, full generate + download through the actual entry point
  const cliGen = await runAsync([path.join(ROOT, 'cli.js'), 'generate', 'cli harbor', '--provider', 'glm', '--ar', '16:9'], { cwd: ROOT, timeoutMs: 60000, env: glmEnv() });
  assert.strictEqual(cliGen.status, 0, 'cli generate --provider glm --ar 16:9 exits 0: ' + String(cliGen.stderr || '').slice(0, 200));
  assert(/saved: /.test(cliGen.stdout), 'cli generate saves an image');
  const cliSaved = cliGen.stdout.split('\n').find((l) => l.startsWith('saved: ')).slice(7);
  assert(fs.existsSync(cliSaved) && glm.isImageFile(cliSaved), 'cli generated image really saved');
  assert(state.gen[state.gen.length - 1].body.size === '1728x960', 'cli --ar 16:9 reaches glm as size 1728x960');

  const cliCat = spawnSync(process.execPath, [path.join(ROOT, 'cli.js'), 'catalog', '--provider', 'glm'], { encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(cliCat.status, 0, 'catalog --provider glm exits 0');
  assert(/\$0\.015/.test(cliCat.stdout) && /TEXT-TO-IMAGE ONLY/.test(cliCat.stdout), 'cli catalog lists glm paid text-to-image status');
  const cliNoKey = spawnSync(process.execPath, [path.join(ROOT, 'cli.js'), 'generate', 'x', '--provider', 'glm'], { encoding: 'utf8', timeout: 30000, env: glmEnv({ ZAI_API_KEY: '' }) });
  assert.strictEqual(cliNoKey.status, 1, 'cli generate glm without key exits 1');
  assert(/ZAI_API_KEY/.test(String(cliNoKey.stderr || '') + String(cliNoKey.stdout || '')), 'cli missing-key error is actionable');
  fs.writeFileSync(path.join(glmDir, 'doc-args.json'), '{}');
  const docRun = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'studio_doctor', path.join(glmDir, 'doc-args.json')], { encoding: 'utf8', timeout: 60000, env: glmEnv() });
  const docBody = JSON.parse(docRun.stdout.trim());
  assert(/glm-image \(optional\)/.test(docBody.text) && /not verified/.test(docBody.text), 'doctor reports glm key presence, live generation unverified');
  const httpCfg = mkCfg({ port: 17899, host: '127.0.0.1' });
  const hsrv = spawn(process.execPath, [path.join(ROOT, 'http.js')], { env: { ...process.env, MYSTIC_STUDIO_CONFIG: httpCfg }, stdio: ['ignore', 'pipe', 'pipe'] });
  let httpOut = '';
  hsrv.stdout.on('data', (d) => { httpOut += d; });
  await new Promise((resolve) => {
    const t = setInterval(() => { if (/HTTP API on/.test(httpOut)) { clearInterval(t); resolve(); } }, 100);
    setTimeout(() => { clearInterval(t); resolve(); }, 5000);
  });
  const toolsBody = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:17899/v1/tools', (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve(b)); }).on('error', reject);
  });
  hsrv.kill();
  const httpTools = JSON.parse(toolsBody).tools;
  assert(httpTools.some((t) => t.name === 'photo_generate' && t.inputSchema.properties.provider && t.inputSchema.properties.provider.enum[0] === 'higgsfield'), 'HTTP /v1/tools exposes shared provider schema');
  srv.close();
  try { if (srv.closeAllConnections) srv.closeAllConnections(); } catch (e) {}
  fs.rmSync(glmDir, { recursive: true, force: true });
}

for (const f of ['args-empty.json', 'args-shot.json']) try { fs.unlinkSync(path.join(HERE, f)); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log('smoke: all checks passed');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
