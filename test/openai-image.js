'use strict';
// Offline contract tests for the explicit OpenAI GPT Image adapter. Every
// transport is mocked; no test reaches OpenAI, spends money, or uses a real key.

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const adapter = require('../lib/openai-image');
const core = require('../lib/core');

let checks = 0;
function ok(value, message) {
  assert.ok(value, message);
  checks++;
}
function throws(match, fn, message) {
  assert.throws(fn, match, message);
  checks++;
}
function png() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
}
function config(dir, extra = {}) {
  return {
    openaiKey: 'TEST_KEY_NOT_REAL',
    openaiImageBase: 'http://fixture.invalid/v1',
    openaiImageModel: adapter.DEFAULT_MODEL,
    imageProvider: 'higgsfield',
    outDir: path.join(dir, 'out'),
    maxImageMb: 9,
    ...extra,
  };
}
function temporary(ext, bytes) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'openai-fixture-')), 'source' + ext);
  fs.writeFileSync(file, bytes);
  return file;
}
function restore(original, fn) {
  try { fn(); } finally { cp.spawnSync = original; }
}

const originalSpawn = cp.spawnSync;
const tiny = png();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-image-test-'));
const source = temporary('.png', tiny);
const calls = [];

cp.spawnSync = (command, args, options) => {
  calls.push({ command, args, options });
  const joined = args.join('\n');
  const bodyArg = args.find((a) => a.startsWith('@'));
  const body = bodyArg ? JSON.parse(fs.readFileSync(bodyArg.slice(1), 'utf8')) : null;
  return { status: 0, stdout: JSON.stringify({ data: [{ b64_json: tiny.toString('base64') }] }) + '\n200', stderr: '' };
};

const c = config(tmp);
const generated = adapter.generate(c, { prompt: 'a real framed poster', quality: 'high', aspect_ratio: '16:9' });
ok(fs.readFileSync(c.outDir + '/' + fs.readdirSync(c.outDir)[0]).equals(tiny), 'generation retains native output bytes');
ok(/model: gpt-image-2/.test(generated) && /dimensions: 1x1/.test(generated), 'generation reports model and dimensions');
ok(!calls[0].args.join(' ').includes('TEST_KEY_NOT_REAL'), 'generation key is never in argv');
const receipt1 = JSON.parse(fs.readFileSync(fs.readdirSync(c.outDir).map(f => path.join(c.outDir, f)).find(f => f.endsWith('.receipt.json'))));
ok(receipt1.provider === 'openai' && receipt1.model === 'gpt-image-2' && receipt1.output.width === 1, 'generation receipt is safe and dimension-bearing');
ok(!JSON.stringify(receipt1).includes('TEST_KEY_NOT_REAL'), 'receipt contains no key material');

ok(calls.length === 1 && calls[0].args.some(a => a.endsWith('/images/generations')), 'generation submits exactly once');
const outputOnly = config(tmp, { maxImageMb: 1 / 1048576, outDir: path.join(tmp, 'output-over-source-limit') });
const outputResult = adapter.generate(outputOnly, { prompt: 'retain native output beyond source upload limit' });
const outputPath = outputResult.split('\n').find(line => line.startsWith('saved: ')).slice(7);
ok(fs.readFileSync(outputPath).equals(tiny), 'paid native output is not discarded by source-upload size limit');

calls.length = 0;
fs.rmSync(c.outDir, { recursive: true, force: true });
ok(adapter.validSize('1536x864') && adapter.validSize('864x1536') && adapter.validSize('1536x1152') && adapter.validSize('1152x1536'), 'exact OpenAI flexible aspect sizes pass');
ok(adapter.validSize('1280x720') && adapter.validSize('3840x2160'), 'valid custom 16:9 sizes pass');
ok(adapter.validSize('1536x1024'), 'documented 3:2 fixed size remains valid');
ok(!adapter.validSize('1442x900') && !adapter.validSize('3844x16') && !adapter.validSize('4096x1000') && !adapter.validSize('512x512') && !adapter.validSize('3000x1000'), 'OpenAI custom size limits reject malformed/out-of-range sizes');
ok(adapter.ASPECT_MAP['16:9'] === '1536x864' && adapter.ASPECT_MAP['9:16'] === '864x1536' && adapter.ASPECT_MAP['4:3'] === '1536x1152' && adapter.ASPECT_MAP['3:4'] === '1152x1536', 'aspect ratios are honored exactly');
const edited = adapter.edit(c, { instruction: 'keep the frame and replace only the sky' }, source);
const receipt2 = JSON.parse(fs.readFileSync(fs.readdirSync(c.outDir).map(f => path.join(c.outDir, f)).find(f => f.endsWith('.receipt.json'))));
ok(calls.length === 1 && calls[0].args.some((arg) => arg.endsWith('/images/edits')), 'edit makes one direct multipart Image API request');
ok(calls[0].args.some(a => a === 'image[]=@' + source && false || a.startsWith('image[]=@') && a.endsWith(';type=image/png')), 'edit uploads validated source as multipart image');
ok(calls[0].args.some(a => a === 'model=gpt-image-2'), 'edit selects gpt-image-2 explicitly');
ok(!calls[0].args.some(a => a.startsWith('input_fidelity=')), 'gpt-image-2 never receives input_fidelity');
ok(/provider: openai/.test(edited) && receipt2.operation === 'edit' && receipt2.input.format === 'image/png' && receipt2.input.width === 1, 'edit validates complete source dimensions and records receipt');
const receiptTarget = temporary('.png', tiny);
ok(adapter.writeReceipt(receiptTarget, { provider: 'openai' }) === receiptTarget + '.receipt.json', 'normal receipt is written');
const paidOutput = temporary('.png', tiny);
const originalWrite = fs.writeFileSync;
fs.writeFileSync = (...args) => { if (args[0] === paidOutput + '.receipt.json') throw new Error('disk full'); return originalWrite(...args); };
const failedReceipt = adapter.writeReceipt(paidOutput, { provider: 'openai' });
fs.writeFileSync = originalWrite;
ok(failedReceipt === null && fs.existsSync(paidOutput), 'receipt failure retains paid output');
fs.unlinkSync(paidOutput);
ok(!JSON.stringify(receipt2).includes('TEST_KEY_NOT_REAL'), 'edit receipt contains no key material');
fs.rmSync(c.outDir, { recursive: true, force: true });

cp.spawnSync = originalSpawn;

const noKey = config(tmp, { openaiKey: '' });
let seen = 0;
cp.spawnSync = () => { seen++; return { status: 0, stdout: '' }; };
throws(/no OPENAI_API_KEY.*paid API usage/, () => adapter.generate(noKey, { prompt: 'no key' }), 'missing key fails before network');
ok(seen === 0, 'missing key makes no request');
cp.spawnSync = originalSpawn;

throws(/unsupported OpenAI image model/, () => adapter.resolveModel(c, { model: 'not-a-real-image-model' }), 'unknown model is refused without substitution');
throws(/always uses high input fidelity/, () => adapter.generate(c, { prompt: 'x', input_fidelity: 'high' }), 'fidelity override is explicitly rejected');
throws(/source image failed signature validation/, () => adapter.edit(c, { instruction: 'edit' }, temporary('.png', Buffer.from('<html>not an image</html>'))), 'non-image source is rejected');
const badKeyCalls = [];
cp.spawnSync = (command, args) => { badKeyCalls.push(args); return { status: 0, stdout: JSON.stringify({ error: { code: 'SECRET_FOR_TEST' } }) + '\n401', stderr: '' }; };
throws(/HTTP 401.*response body is not echoed/, () => adapter.generate(c, { prompt: 'bad key' }), 'HTTP errors are sanitized');
ok(badKeyCalls.length === 1 && !badKeyCalls[0].join(' ').includes('SECRET_FOR_TEST'), 'provider error content is not echoed and no retry occurs');
cp.spawnSync = originalSpawn;

let timeoutCalls = 0;
cp.spawnSync = () => { timeoutCalls++; return { status: null, error: Object.assign(new Error('private ETIMEDOUT detail'), { code: 'ETIMEDOUT' }) }; };
throws(/outcome UNKNOWN.*no retry/, () => adapter.generate(c, { prompt: 'timeout' }), 'ambiguous timeout fails closed');
ok(timeoutCalls === 1 && (!fs.existsSync(c.outDir) || fs.readdirSync(c.outDir).length === 0), 'ambiguous timeout does not duplicate render or leave output');
cp.spawnSync = originalSpawn;

throws(/source image is incomplete/, () => adapter.edit(c, { instruction: 'x' }, temporary('.png', tiny.slice(0, 30))), 'truncated source cannot trigger paid edit');
const tools = core.TOOLS;
ok(JSON.stringify(tools.find(t => t.name === 'photo_generate').inputSchema.properties.provider.enum) === JSON.stringify(['higgsfield', 'glm', 'gemini', 'openai']), 'photo_generate exposes explicit openai');
ok(JSON.stringify(tools.find(t => t.name === 'photo_edit').inputSchema.properties.provider.enum) === JSON.stringify(['higgsfield', 'glm', 'gemini', 'openai']), 'photo_edit exposes explicit openai');

// Doctor must distinguish depleted prepay from a usable key. A fake curl on
// PATH supplies the provider's own HTTP statuses without any network call.
const doctorTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-doctor-'));
const doctorBin = path.join(doctorTmp, 'bin');
fs.mkdirSync(doctorBin);
const oldPath = process.env.PATH;
process.env.PATH = doctorBin + path.delimiter + oldPath;
fs.writeFileSync(path.join(doctorBin, 'curl'), '#!/bin/sh\ncase "$*" in *:generateContent*) echo 402 ;; *) echo 200 ;; esac\n');
fs.chmodSync(path.join(doctorBin, 'curl'), 0o755);
let doctorText = '';
try {
  doctorText = core.doctor({ geminiKey: 'TEST_KEY_NOT_REAL', openaiKey: '', outDir: doctorTmp, stateDir: doctorTmp, ffmpeg: '/usr/bin/false', ffprobe: '/usr/bin/false', higgsfieldCli: 'no-such-higgsfield', codingRunner: 'no-such-runner' });
} finally { process.env.PATH = oldPath; }
ok(/^DEPLETED\s+gemini key/m.test(doctorText), 'doctor labels depleted Gemini prepay as not OK');
ok(/PREPAY DEPLETED \(402\).*unavailable for inference/.test(doctorText), 'doctor says depleted prepay is unavailable');
ok(tools.find(t => t.name === 'photo_generate').inputSchema.properties.quality.enum.includes('high'), 'schema permits OpenAI high quality');
ok(tools.find(t => t.name === 'photo_edit').inputSchema.properties.output_format.enum.includes('jpeg'), 'schema exposes native OpenAI output formats');

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(doctorTmp, { recursive: true, force: true });
console.log(`openai-image: ${checks} checks passed`);