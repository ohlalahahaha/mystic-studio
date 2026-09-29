'use strict';
// Real Chromium proof. Install playwright-core first: npm i --no-save playwright-core
// A system Chromium is auto-discovered; set MYSTIC_STUDIO_CHROME to override it.

const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const here = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-poster-browser-'));
const out = path.join(here, 'out');
fs.mkdirSync(out);
const config = path.join(here, 'config.json');
fs.writeFileSync(config, JSON.stringify({ outDir: out, stateDir: path.join(here, 'state'), allowDirs: [here] }));
const environment = { ...process.env, MYSTIC_STUDIO_CONFIG: config };
environment.MYSTIC_STUDIO_REPO_SHA = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

spawnSync('python3', ['-c', [
  'from PIL import Image,ImageDraw',
  `p=Image.new('RGBA',(40,40),(0,0,0,0))`,
  `d=ImageDraw.Draw(p); d.ellipse((2,2,38,38),fill=(0,128,255,180))`,
  `p.save('${path.join(here, 'alpha.png')}')`,
].join('; ')], { stdio: 'inherit' });
const font = path.join(here, 'DejaVuSans.ttf');
fs.copyFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', font);
const image = path.join(here, 'alpha.png');
const originalBytes = fs.readFileSync(image);
const manifest = {
  canvas: { width: 300, height: 450, dpi: 150 },
  images: [{ id: 'alpha', asset: { path: image, sha256: hash(image) }, source_width: 40, source_height: 40, source: { x: 0, y: 0, width: 40, height: 40 }, dest: { x: 40, y: 40, width: 20, height: 20 } }],
  text: [{ id: 'vietnamese', text: 'Tri ân — Ngày 29/09', color: '#111111FF', align: 'left', bounds: { x: 24, y: 100, width: 252, height: 80 }, font: { family: 'DejaVu Proof', path: font, sha256: hash(font), size: 28, weight: 400, line_height: 1.25 } }],
};

const post = (port, body) => new Promise((resolve, reject) => {
  const request = http.request({ host: '127.0.0.1', port, path: '/v1/tools', method: 'GET' }, (response) => {
    let raw = ''; response.on('data', (chunk) => { raw += chunk; }); response.on('end', () => resolve(JSON.parse(raw)));
  });
  request.on('error', reject); request.end(body);
});
const waitHttp = (port) => new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = () => post(port).then(resolve).catch((error) => Date.now() - started > 10000 ? reject(error) : setTimeout(poll, 100));
  poll();
});

function mcpList() {
  const input = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n' +
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n' +
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n';
  const result = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], { input, encoding: 'utf8', timeout: 20000, env: environment });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').map(JSON.parse).find((message) => message.id === 2).result.tools;
}

(async () => {
  const mcpTools = mcpList();
  const schema = mcpTools.find((tool) => tool.name === 'poster_render').inputSchema;
  assert(schema && schema.required.includes('manifest') && schema.properties.manifest.type === 'object', 'MCP poster schema is complete');
  const port = 27831 + (process.pid % 1000);
  const httpServer = spawn(process.execPath, [path.join(ROOT, 'http.js')], { env: { ...environment, MYSTIC_STUDIO_PORT: String(port) }, stdio: 'ignore' });
  try {
    const httpTools = await waitHttp(port);
    assert.deepStrictEqual(httpTools.tools.find((tool) => tool.name === 'poster_render').inputSchema, schema, 'HTTP and MCP schemas agree');
    const args = path.join(here, 'poster.json');
    fs.writeFileSync(args, JSON.stringify({ manifest, output_dir: out }));
    const render = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'poster_render', args], { encoding: 'utf8', timeout: 120000, env: environment });
    assert.strictEqual(render.status, 0, render.stdout + render.stderr);
    const result = JSON.parse(render.stdout.trim());
    assert(result.ok && /technical_pass.*true/s.test(result.text), 'dispatch reports technical pass');
    const bundle = result.text.match(/^saved isolated poster: (.+)$/m)[1];
    const qa = JSON.parse(fs.readFileSync(path.join(bundle, 'qa-receipt.json'), 'utf8'));
    const png = path.join(bundle, 'poster.png');
    const pdf = path.join(bundle, 'poster.pdf');
    const source = path.join(bundle, 'source.html');
    assert.deepStrictEqual(qa.output_dimensions, { width: 300, height: 450 }, 'PNG has explicit dimensions');
    assert.deepStrictEqual(qa.source_dimensions, [{ id: 'alpha', width: 40, height: 40, crop: { x: 0, y: 0, width: 40, height: 40 } }], 'source dimensions are separate');
    assert(qa.validation.fonts_ready && qa.validation.images_nonzero && qa.validation.literal_text_verified, 'fonts, images and literal text pass');
    assert(qa.outputs.includes('source.html') && fs.statSync(source).size > 1000, 'editable source is separate from preview');
    assert(/Content-Security-Policy[^>]*default-src 'none'/.test(fs.readFileSync(source, 'utf8')), 'source CSP blocks page scripts');
    assert(Buffer.compare(originalBytes, fs.readFileSync(image)) === 0 && qa.source_files[0].sha256 === hash(image), 'original bytes survive unchanged');
    const info = spawnSync('pdfinfo', [pdf], { encoding: 'utf8' });
    assert.strictEqual(info.status, 0, info.stderr);
    assert(/Page size:\s+144 x 216 pts/.test(info.stdout), `PDF physical page is 2x3 inches: ${info.stdout.match(/Page size:.*/)?.[0]}`);
    const extracted = spawnSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
    assert.strictEqual(extracted.status, 0, extracted.stderr);
    assert(extracted.stdout.includes('Tri ân'), 'PDF retains Vietnamese accented text');
    const pixelCheck = spawnSync('python3', ['-c', [
      'from PIL import Image',
      `p=Image.open('${png}').convert('RGBA')`,
      `assert p.size == (300,450)`,
      `assert p.getpixel((5,5))[3] == 0`,
      `assert p.getpixel((50,50))[3] > 0`,
    ].join('; ')], { encoding: 'utf8' });
    assert.strictEqual(pixelCheck.status, 0, pixelCheck.stderr);
    const overflow = { ...manifest, text: [{ ...manifest.text[0], text: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM', bounds: { x: 250, y: 400, width: 10, height: 10 }, font: { ...manifest.text[0].font, size: 40 } }] };
    fs.writeFileSync(args, JSON.stringify({ manifest: overflow, output_dir: out }));
    const failed = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'poster_render', args], { encoding: 'utf8', timeout: 120000, env: environment });
    const failedBody = JSON.parse(failed.stdout.trim());
    assert.notStrictEqual(failed.status, 0, 'text overflow must fail');
    assert(/accidental text overflow/.test(failedBody.error), failedBody.error);
    assert(!fs.readdirSync(out).some((entry) => entry.startsWith('.poster-')), 'failed render leaves no staging output');
    assert(Buffer.compare(originalBytes, fs.readFileSync(image)) === 0, 'source remains unchanged after overflow failure');
    fs.writeFileSync(args, JSON.stringify({ manifest, output_dir: out }));
    const cli = spawnSync(process.execPath, [path.join(ROOT, 'cli.js'), 'poster-render', args, '--output-dir', out], { encoding: 'utf8', timeout: 120000, env: environment });
    assert.notStrictEqual(cli.status, 0, 'second identical render stays isolated instead of overwriting');
    assert(/already exists/.test(cli.stderr), cli.stderr);
    console.log(`browser poster proof passed: ${bundle}`);
  } finally { httpServer.kill('SIGTERM'); }
})().catch((error) => { console.error(error); process.exit(1); });
