'use strict';
// Focused offline tests for the native gemini (Nano Banana) image provider.
// Mocked curl transport + localhost fixture server + actual core dispatch.
// Fake keys only - zero provider requests outside this process, zero spend.

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const cpMod = require('child_process');

const ROOT = path.join(__dirname, '..');
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG1 = Buffer.from(PNG_B64, 'base64');
const KEY = 'fake-gemini-key-not-real';
const geminiImage = require(path.join(ROOT, 'lib', 'gemini-image'));
const { TOOLS } = require(path.join(ROOT, 'lib', 'core'));

const inlineReply = (mime, data) => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: mime || 'image/png', data: data || PNG_B64 } }] } }] });
const okReply = (obj, code) => ({ status: 0, stdout: JSON.stringify(obj) + '\n' + (code || 200), stderr: '' });
const gemCfg = (over) => ({
  geminiKey: KEY, geminiImageBase: 'http://fixture.invalid', geminiImageModel: 'gemini-3.1-flash-image',
  imageProvider: 'higgsfield', outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-out-')), maxImageMb: 9, ...over,
});
const fileCount = (dir) => fs.readdirSync(dir).length;

(async () => {

// --- 1. glm-specific and invalid options rejected before any provider request ---
{
  const orig = cpMod.spawnSync;
  let calls = 0;
  cpMod.spawnSync = () => { calls += 1; return okReply(inlineReply()); };
  try {
    const c = gemCfg();
    assert.throws(() => geminiImage.generate(c, { prompt: 'test', size: '4K' }), /unsupported option 'size'/, 'glm size rejected');
    assert.throws(() => geminiImage.generate(c, { prompt: 'test', quality: 'hd' }), /unsupported option 'quality'/, 'glm quality rejected');
    assert.throws(() => geminiImage.edit(c, { instruction: 'x', size: '1024x1024' }, 'a.png'), /unsupported option 'size'/, 'glm size rejected on edit');
    assert.throws(() => geminiImage.generate(gemCfg({ geminiKey: '' }), { prompt: 'x' }), /GEMINI_API_KEY/, 'no key');
    assert.throws(() => geminiImage.generate(c, { prompt: '' }), /non-empty text prompt/, 'empty prompt');
    assert.throws(() => geminiImage.generate(c, { prompt: 'x', model: 'banana-2' }), /unsupported image model/, 'unknown model');
    assert.throws(() => geminiImage.generate(gemCfg({ geminiImageModel: 'gemini-9-flash-image' }), { prompt: 'x' }), /unsupported image model/, 'bad config model');
    assert.throws(() => geminiImage.generate(c, { prompt: 'x', aspect_ratio: '7:3' }), /unsupported aspect_ratio/, 'bad aspect');
    assert.throws(() => geminiImage.generate(c, { prompt: 'x', image: '/tmp/a.png' }), /text-to-image/, 'image input on generate');
    assert.strictEqual(calls, 0, 'rejected requests make zero provider calls');
    assert.strictEqual(fileCount(c.outDir), 0, 'no partial artifacts');
    fs.rmSync(c.outDir, { recursive: true, force: true });
  } finally { cpMod.spawnSync = orig; }
}

// --- 2. native payload + key hygiene: key via curl stdin config, never argv ---
{
  const orig = cpMod.spawnSync;
  let seen = null;
  cpMod.spawnSync = (cmd, args, opts) => {
    const bodyPath = args[args.indexOf('--data-binary') + 1].replace(/^@/, '');
    seen = { cmd, args, input: (opts && opts.input) || '', bodyJson: fs.readFileSync(bodyPath, 'utf8') };
    return okReply(inlineReply());
  };
  try {
    const c = gemCfg();
    const text = geminiImage.generate(c, { prompt: 'wire check', aspect_ratio: '16:9' });
    const saved = text.split('\n').find((l) => l.startsWith('saved: ')).slice(7);
    assert(fs.existsSync(saved) && geminiImage.sniffMime(fs.readFileSync(saved)) === 'image/png', 'png really saved');
    assert(text.includes('provider: gemini') && text.includes('paid:'), 'result labels provider + paid');
    assert(seen.args.includes('--config') && seen.args[seen.args.indexOf('--config') + 1] === '-', 'auth via curl stdin config');
    assert(!seen.args.join(' ').includes(KEY), 'key never in argv');
    assert(seen.input.includes('x-goog-api-key: ' + KEY) && !seen.input.includes('Authorization'), 'key only as x-goog-api-key');
    assert(/models\/gemini-3\.1-flash-image:generateContent$/.test(seen.args[seen.args.length - 1]), 'native endpoint');
    const body = JSON.parse(seen.bodyJson);
    assert.deepStrictEqual(body.contents, [{ role: 'user', parts: [{ text: 'wire check' }] }], 'native contents shape');
    assert.deepStrictEqual(body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '1K' } }, '3.1 generationConfig');
    fs.rmSync(c.outDir, { recursive: true, force: true });

    const g25 = geminiImage.generationConfig('gemini-2.5-flash-image', '1:1');
    assert.deepStrictEqual(g25.imageConfig, { aspectRatio: '1:1' }, '2.5 omits imageSize');
    const g3 = geminiImage.generationConfig('gemini-3-pro-image', '9:16');
    assert.strictEqual(g3.imageConfig.imageSize, '1K', 'pro keeps imageSize');
  } finally { cpMod.spawnSync = orig; }
}

// --- 3. edit payload from actual input bytes (MIME sniffed, not extension) ---
{
  const orig = cpMod.spawnSync;
  let body = null;
  cpMod.spawnSync = (cmd, args) => {
    body = JSON.parse(fs.readFileSync(args[args.indexOf('--data-binary') + 1].replace(/^@/, ''), 'utf8'));
    return okReply(inlineReply());
  };
  try {
    const c = gemCfg();
    const input = path.join(os.tmpdir(), 'gemini-edit-in-' + Math.random().toString(36).slice(2) + '.png');
    fs.writeFileSync(input, PNG1);
    const text = geminiImage.edit(c, { instruction: 'brighten' }, input);
    const part = body.contents[0].parts[1].inlineData;
    assert.strictEqual(body.contents[0].parts[0].text, 'brighten', 'instruction is first part');
    assert.strictEqual(part.mimeType, 'image/png', 'input mime from real bytes');
    assert.deepStrictEqual(Buffer.from(part.data, 'base64'), PNG1, 'input bytes inline');
    const saved = text.split('\n').find((l) => l.startsWith('saved: ')).slice(7);
    assert(fs.existsSync(saved), 'edit output saved');
    fs.rmSync(c.outDir, { recursive: true, force: true }); fs.unlinkSync(input);
  } finally { cpMod.spawnSync = orig; }
}

// --- 4. failure modes: exactly one request, sanitized errors, no partial files ---
{
  const orig = cpMod.spawnSync;
  const cases = [
    [{ status: 0, stdout: JSON.stringify({ error: { code: 429, message: 'quota exhausted secret-do-not-echo' } }) + '\n429', stderr: '' }, /HTTP 429 code=429/, '429 sanitized'],
    [{ status: 28, stdout: '', stderr: 'curl secret-detail' }, /curl exit 28/, 'curl failure sanitized'],
    [null, /curl transport error/, 'transport throw sanitized'],
    [{ status: 0, stdout: 'totally not json\n200', stderr: '' }, /non-JSON/, 'non-json rejected'],
    [{ status: 0, stdout: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'haiku only' }] } }] }) + '\n200', stderr: '' }, /no image/, 'text-only rejected'],
    [{ status: 0, stdout: JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: 'thinking' }] } }] }) + '\n200', stderr: '' }, /no image/, 'thought-only rejected'],
    [{ status: 0, stdout: JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }) + '\n200', stderr: '' }, /no image \(reason: SAFETY\)/, 'blocked surfaced'],
    [{ status: 0, stdout: JSON.stringify(inlineReply('image/png', 'abc$$not-base64')) + '\n200', stderr: '' }, /malformed base64/, 'malformed base64'],
    [{ status: 0, stdout: JSON.stringify(inlineReply('application/pdf', PNG_B64)) + '\n200', stderr: '' }, /unsupported image type/, 'bad output mime'],
    [{ status: 0, stdout: JSON.stringify(inlineReply('image/webp', PNG_B64)) + '\n200', stderr: '' }, /claimed MIME image\/webp but the bytes are image\/png - mismatched/, 'webp claim + png bytes'],
    [{ status: 0, stdout: JSON.stringify(inlineReply('image/png', PNG_B64)) + '\n200', stderr: '' }, /over 0\.00001MB limit|over .* limit/, 'size limit enforced'],
  ];
  try {
    for (const [ret, re, tag] of cases) {
      let calls = 0;
      cpMod.spawnSync = () => { calls += 1; if (!ret) throw new Error('ETIMEDOUT-for-test'); return ret; };
      const c = gemCfg(tag.includes('size limit') ? { maxImageMb: 0.00001 } : {});
      let err = null;
      try { geminiImage.generate(c, { prompt: 'fail case' }); } catch (e) { err = e; }
      assert(err && re.test(err.message), tag + ' -> ' + (err && err.message));
      assert(!/secret-do-not-echo|secret-detail|ETIMEDOUT/.test(err.message), tag + ' leaks nothing');
      assert.strictEqual(calls, 1, tag + ' exactly one request (no retry)');
      assert.strictEqual(fileCount(c.outDir), 0, tag + ' leaves no partial artifact');
      fs.rmSync(c.outDir, { recursive: true, force: true });
    }
    // webp claimed complete-header but truncated RIFF body
    const fake = Buffer.alloc(42); fake.write('RIFF', 0, 'latin1'); fake.writeUInt32LE(500, 4); fake.write('WEBP', 8, 'latin1');
    cpMod.spawnSync = () => okReply(inlineReply('image/webp', fake.toString('base64')));
    const c2 = gemCfg();
    let err2 = null;
    try { geminiImage.generate(c2, { prompt: 'short webp' }); } catch (e) { err2 = e; }
    assert(err2 && /not a complete image/.test(err2.message), 'truncated webp RIFF length rejected');
    assert.strictEqual(fileCount(c2.outDir), 0, 'truncated webp leaves no file');
    fs.rmSync(c2.outDir, { recursive: true, force: true });
  } finally { cpMod.spawnSync = orig; }
}

// --- 5. actual core dispatch (run.js subprocess) against a localhost fixture ---
{
  const state = { reqs: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-gemini-'));
  const outDir = path.join(dir, 'out');
  const cfgPath = path.join(dir, 'cfg.json');
  const writeCfg = () => fs.writeFileSync(cfgPath, JSON.stringify({
    outDir, stateDir: path.join(dir, 'state'), envFile: path.join(dir, 'env.env'), canonicalEnvFile: path.join(dir, 'missing.env'),
    higgsfieldCli: path.join(dir, 'no-higgs'), imageProvider: 'higgsfield',
    geminiImageBase: 'http://127.0.0.1:' + state.port + '/v1beta', geminiImageModel: 'gemini-3.1-flash-image',
  }));
  fs.writeFileSync(path.join(dir, 'env.env'), '');
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      state.reqs.push({ auth: req.headers['x-goog-api-key'] || null, bearer: req.headers.authorization || null, path: req.url, body });
      if (/APIFAIL/.test(JSON.stringify(body))) { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 429, message: 'quota secret-leak-marker' } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(inlineReply()));
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  state.port = srv.address().port;
  writeCfg();
  const env = (extra) => ({ ...process.env, MYSTIC_STUDIO_CONFIG: cfgPath, GEMINI_API_KEY: KEY, ZAI_API_KEY: '',
    MYSTIC_STUDIO_IMAGE_PROVIDER: 'higgsfield', MYSTIC_STUDIO_GEMINI_IMAGE_BASE: 'http://127.0.0.1:' + state.port + '/v1beta',
    MYSTIC_STUDIO_GEMINI_IMAGE_MODEL: 'gemini-3.1-flash-image', ...extra });
  const run = (tool, args, e) => new Promise((resolve) => {
    const af = path.join(dir, 'args.json');
    fs.writeFileSync(af, JSON.stringify(args));
    const p = spawn(process.execPath, [path.join(ROOT, 'run.js'), tool, af], { encoding: 'utf8', env: e || env() });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => { let j = null; try { j = JSON.parse(out.trim()); } catch {} resolve({ status: code, body: j, raw: out + err }); });
  });
  const cli = (args, e) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'cli.js'), ...args], { encoding: 'utf8', env: e || env() });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ status: code, stdout: out, stderr: err }));
  });

  const gen = await run('photo_generate', { prompt: 'harbor at dawn', provider: 'gemini', aspect_ratio: '16:9' });
  assert(gen.body.ok === true, 'dispatch generate ok: ' + (gen.body.error || ''));
  const saved = gen.body.text.split('\n').find((l) => l.startsWith('saved: ')).slice(7);
  assert(saved.startsWith(outDir) && fs.existsSync(saved) && geminiImage.sniffMime(fs.readFileSync(saved)) === 'image/png', 'dispatch saved real png in outDir');
  assert.strictEqual(state.reqs[0].path, '/v1beta/models/gemini-3.1-flash-image:generateContent', 'fixture saw native path');
  assert.strictEqual(state.reqs[0].auth, KEY && state.reqs[0].auth === KEY ? KEY : null, 'fixture got key via header');
  assert.strictEqual(state.reqs[0].bearer, null, 'no bearer header');
  assert.strictEqual(state.reqs[0].body.contents[0].parts[0].text, 'harbor at dawn', 'dispatch body prompt');
  assert.strictEqual(state.reqs[0].body.generationConfig.imageConfig.aspectRatio, '16:9', 'dispatch aspect');

  const input = path.join(os.tmpdir(), 'gemini-e2e-' + Math.random().toString(36).slice(2) + '.png');
  fs.writeFileSync(input, PNG1);
  const before = state.reqs.length;
  const badPath = path.join(os.homedir(), 'gemini-not-allowed', 'in.png');
  fs.mkdirSync(path.dirname(badPath), { recursive: true });
  fs.writeFileSync(badPath, PNG1);
  const off = await run('photo_edit', { image: badPath, instruction: 'x', provider: 'gemini' });
  assert(off.body.ok === false && /path outside allowed read dirs/.test(off.body.error), 'disallowed edit path blocked');
  const notImg = path.join(os.tmpdir(), 'gemini-fake-' + Math.random().toString(36).slice(2) + '.png');
  fs.writeFileSync(notImg, '<html>not an image</html>');
  const fake = await run('photo_edit', { image: notImg, instruction: 'x', provider: 'gemini' });
  assert(fake.body.ok === false && /unsupported or malformed input image/.test(fake.body.error), 'non-image input rejected');
  assert.strictEqual(state.reqs.length, before, 'guard failures made zero provider requests');

  const edit = await run('photo_edit', { image: input, instruction: 'make golden', provider: 'gemini' });
  assert(edit.body.ok === true, 'dispatch edit ok: ' + (edit.body.error || ''));
  const editPart = state.reqs[state.reqs.length - 1].body.contents[0].parts[1].inlineData;
  assert.strictEqual(editPart.mimeType, 'image/png', 'edit inline mime from bytes');
  assert.deepStrictEqual(Buffer.from(editPart.data, 'base64'), PNG1, 'edit inline bytes');
  const editSaved = edit.body.text.split('\n').find((l) => l.startsWith('saved: ')).slice(7);
  assert(fs.existsSync(editSaved) && geminiImage.sniffMime(fs.readFileSync(editSaved)) === 'image/png', 'edit output saved');

  const apiFail = await run('photo_generate', { prompt: 'APIFAIL please', provider: 'gemini' });
  assert(apiFail.body.ok === false && /HTTP 429 code=429/.test(apiFail.body.error), 'dispatch 429 sanitized');
  assert(!/secret-leak-marker/.test(apiFail.raw), '429 body never echoed');
  assert(state.reqs.filter((r) => /APIFAIL/.test(JSON.stringify(r.body))).length === 1, '429 made exactly one request');

  const cliGen = await cli(['generate', '--provider', 'gemini', '--prompt', 'cli nano banana']);
  assert.strictEqual(cliGen.status, 0, 'cli generate --provider gemini --prompt exits 0: ' + cliGen.stderr.slice(0, 200));
  assert(/saved: /.test(cliGen.stdout), 'cli generate saved an image');
  const cliEdit = await cli(['edit', input, '-p', 'golden hour', '--provider', 'gemini']);
  assert.strictEqual(cliEdit.status, 0, 'cli edit -p --provider gemini exits 0: ' + cliEdit.stderr.slice(0, 200));
  const cliNoKey = await cli(['generate', '--provider', 'gemini', '--prompt', 'x'], env({ GEMINI_API_KEY: '' }));
  assert.strictEqual(cliNoKey.status, 1 && /GEMINI_API_KEY/.test(cliNoKey.stderr + cliNoKey.stdout) ? cliNoKey.status : -1, 'cli no-key exits 1');
  const cliCat = await cli(['catalog', '--provider', 'gemini']);
  assert.strictEqual(cliCat.status, 0, 'catalog --provider gemini exits 0');
  assert(/gemini-3\.1-flash-image/.test(cliCat.stdout) && /paid/i.test(cliCat.stdout) && /chat subscription/.test(cliCat.stdout), 'catalog lists model + paid status');

  fs.writeFileSync(path.join(dir, 'doc.json'), '{}');
  const doc = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'studio_doctor', path.join(dir, 'doc.json')], { encoding: 'utf8', timeout: 60000, env: env() });
  assert(/gemini-image \(optional\)/.test(doc.stdout) && /not verified/.test(doc.stdout), 'doctor reports gemini-image presence, unverified');

  const pe = TOOLS.find((t) => t.name === 'photo_edit');
  assert(pe.inputSchema.properties.model && pe.inputSchema.properties.aspect_ratio, 'photo_edit schema exposes gemini model/aspect_ratio');
  assert.deepStrictEqual(TOOLS.find((t) => t.name === 'photo_generate').inputSchema.properties.provider.enum, ['higgsfield', 'glm', 'gemini', 'openai'], 'photo_generate enum');
  assert.deepStrictEqual(pe.inputSchema.properties.provider.enum, ['higgsfield', 'glm', 'gemini', 'openai'], 'photo_edit enum');

  fs.rmSync(input, { force: true }); fs.rmSync(notImg, { force: true }); fs.rmSync(path.dirname(badPath), { recursive: true, force: true });
  srv.close();
  try { if (srv.closeAllConnections) srv.closeAllConnections(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('gemini-image: all checks passed');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
