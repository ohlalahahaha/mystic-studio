'use strict';
// Real Chromium + dispatch proof for deterministic poster_render. No provider calls.

const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { findFixtureFont } = require('./fixture-font');

const ROOT = path.join(__dirname, '..');
const DELIVERABLE = path.join(ROOT, 'deliverable');
fs.mkdirSync(DELIVERABLE, { recursive: true });
const here = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-poster-browser-'));
const stateDir = path.join(here, 'state');
fs.mkdirSync(stateDir);
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const config = path.join(here, 'config.json');
fs.writeFileSync(config, JSON.stringify({ outDir: path.join(here, 'default-out'), stateDir, allowDirs: [here] }));
const environment = { ...process.env, MYSTIC_STUDIO_CONFIG: config };
for (const name of ['run', 'mcp', 'http', 'cli', 'alpha', 'text', 'negative']) {
  fs.mkdirSync(path.join(here, name), { recursive: true });
}

const fontSource = findFixtureFont();
const font = path.join(here, 'fixture.ttf');
fs.copyFileSync(fontSource, font);
const fontHash = hash(font);
const image = path.join(here, 'geometric-alpha.png');
const py = [
  'from PIL import Image,ImageDraw',
  `p=Image.new("RGBA",(800,800),(0,0,0,0))`,
  'd=ImageDraw.Draw(p)',
  'd.rectangle((40,40,760,760),fill=(196,146,78,255))',
  'd.rectangle((100,80,360,300),fill=(244,238,227,255))',
  'd.rectangle((420,100,700,300),fill=(23,19,15,255))',
  'd.ellipse((220,350,620,750),fill=(240,220,171,190))',
  'd.rectangle((0,720,210,799),fill=(0,0,0,0))',
  `p.save(${JSON.stringify(image)})`,
].join(';');
const imageGen = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
assert.strictEqual(imageGen.status, 0, imageGen.stderr);
const originalImageBytes = fs.readFileSync(image);
const imageHash = hash(image);
const rect = (x, y, width, height) => ({ x, y, width, height });
const fontFace = (family, size, weight = 400, line_height = 1.15) => ({
  family, path: font, sha256: fontHash, size, weight, line_height,
});
const imageAsset = { path: image, sha256: imageHash };
const manifest = {
  canvas: { width: 1200, height: 1500, dpi: 300 },
  background: { color: '#17130FFF' },
  images: [
    { id: 'geometry', asset: imageAsset, source_width: 800, source_height: 800,
      source: rect(80, 70, 620, 660), dest: rect(560, 180, 540, 660) },
    { id: 'edge-mark', asset: imageAsset, source_width: 800, source_height: 800,
      source: rect(100, 80, 260, 220), dest: rect(1080, 1370, 90, 90) },
  ],
  text: [
    { id: 'label', text: 'TEST FIXTURE', color: '#C0924EFF', align: 'left',
      bounds: rect(70, 80, 390, 60), font: fontFace('Fixture Sans', 30, 400, 1.1) },
    { id: 'title', text: 'Kiểm tra chữ Việt — Đặng Ánh', color: '#F4EEE3FF', align: 'left',
      bounds: rect(70, 220, 420, 220), font: fontFace('Fixture Display', 62, 700, 1.12) },
    { id: 'body', text: 'Deterministic poster renderer\nLossless PNG · physical PDF · editable HTML', color: '#F0DCABFF', align: 'left',
      bounds: rect(70, 500, 420, 150), font: fontFace('Fixture Sans', 30, 400, 1.35) },
    { id: 'footer', text: '1200 × 1500 · 300 DPI · RGB technical proof', color: '#F4EEE3CC', align: 'left',
      bounds: rect(70, 1320, 850, 70), font: fontFace('Fixture Sans', 24, 400, 1.2) },
  ],
};

function writeArgs(name, body) {
  const file = path.join(here, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}
function runTool(manifestValue, outputDir, env = environment) {
  const args = writeArgs(`args-${Math.random().toString(36).slice(2)}`, { manifest: manifestValue, output_dir: outputDir });
  const result = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'poster_render', args], {
    encoding: 'utf8', timeout: 180000, env,
  });
  let body = null;
  try { body = JSON.parse(result.stdout.trim()); } catch {}
  return { result, body };
}
function bundleFrom(text) {
  const match = String(text).match(/^saved isolated poster: (.+)$/m);
  assert(match, `missing poster bundle path in: ${String(text).slice(0, 200)}`);
  return match[1].trim();
}
function mcpExchange(args) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'poster_render', arguments: args } },
  ].map((row) => JSON.stringify(row)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], {
    input, encoding: 'utf8', timeout: 180000, env: environment,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const rows = result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
  return { processStatus: result.status, tools: rows.find((row) => row.id === 2).result.tools, call: rows.find((row) => row.id === 3) };
}
function httpJson(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = http.request({ host: '127.0.0.1', port, path: route, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} },
    (response) => {
      let raw = ''; response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(raw || '{}') }));
    });
    request.on('error', reject); if (payload) request.write(payload); request.end();
  });
}
async function waitHttp(port) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try { const response = await httpJson(port, 'GET', '/v1/tools'); if (response.status === 200) return response.body; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('HTTP server did not start');
}
async function waitJob(port, id) {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const response = await httpJson(port, 'GET', `/v1/jobs/${id}`);
    if (response.body.status === 'done' || response.body.status === 'error') return response.body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('HTTP poster job timed out');
}

function commandExists(name) {
  return spawnSync('which', [name], { encoding: 'utf8' }).status === 0;
}

function extractPdfText(pdf) {
  if (commandExists('pdftotext')) {
    const result = spawnSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
    return { method: 'pdftotext', status: result.status, text: result.stdout, error: result.stderr };
  }
  if (process.platform === 'darwin' && commandExists('mdimport') && commandExists('plutil')) {
    const plist = path.join(here, 'pdf-metadata.plist');
    const imported = spawnSync('mdimport', ['-t', '-o', plist, pdf], { encoding: 'utf8' });
    if (imported.status !== 0) return { method: 'mdimport', status: imported.status, text: '', error: imported.stderr };
    const result = spawnSync('plutil', ['-extract', 'kMDItemTextContent', 'raw', '-o', '-', plist], { encoding: 'utf8' });
    try { fs.unlinkSync(plist); } catch {}
    return { method: 'mdimport+plutil', status: result.status, text: result.stdout, error: result.stderr };
  }
  return { method: 'unavailable', status: 127, text: '', error: 'no PDF text extractor found' };
}

function rasterizePdf(pdf, outBase) {
  if (commandExists('pdftoppm')) {
    const result = spawnSync('pdftoppm', ['-png', '-singlefile', '-r', '300', pdf, outBase], { encoding: 'utf8' });
    return { method: 'pdftoppm-300dpi', status: result.status, file: `${outBase}.png`, error: result.stderr };
  }
  if (process.platform === 'darwin' && commandExists('sips')) {
    const file = `${outBase}.png`;
    const result = spawnSync('sips', ['-s', 'format', 'png', pdf, '--out', file], { encoding: 'utf8' });
    return { method: 'sips-72dpi', status: result.status, file, error: result.stderr };
  }
  return { method: 'unavailable', status: 127, file: '', error: 'no PDF rasterizer found' };
}

(async () => {
  const schemaProbe = mcpExchange({ manifest, output_dir: path.join(here, 'mcp') });
  const schema = schemaProbe.tools.find((tool) => tool.name === 'poster_render').inputSchema;
  assert(schema.properties.manifest.properties.canvas, 'MCP schema has typed manifest properties');
  assert.strictEqual(schema.properties.manifest.additionalProperties, false);
  assert(schemaProbe.call && !schemaProbe.call.result.isError, `successful MCP tools/call: ${JSON.stringify(schemaProbe.call)}`);
  const mcpBundle = bundleFrom(schemaProbe.call.result.content[0].text);
  assert(fs.existsSync(path.join(mcpBundle, 'poster.png')), 'MCP dispatch produced a real PNG');

  const run = runTool(manifest, path.join(here, 'run'));
  assert.strictEqual(run.result.status, 0, run.result.stdout + run.result.stderr);
  const mainBundle = bundleFrom(run.body.text);
  const qa = JSON.parse(fs.readFileSync(path.join(mainBundle, 'qa-receipt.json'), 'utf8'));
  const png = path.join(mainBundle, 'poster.png');
  const pdf = path.join(mainBundle, 'poster.pdf');
  const source = path.join(mainBundle, 'source.html');
  assert.deepStrictEqual(qa.output_dimensions, { width: 1200, height: 1500 });
  assert.deepStrictEqual(qa.pdf_physical_inches, { width: 4, height: 5 });
  assert(qa.validation.fonts_ready && qa.validation.images_nonzero && qa.validation.literal_text_verified);
  assert.strictEqual(qa.source_dimensions[0].width, 800, 'decoded source width recorded');
  assert.strictEqual(qa.source_dimensions[0].height, 800, 'decoded source height recorded');
  assert.strictEqual(qa.source_dimensions[0].declared_width, 800);
  assert(qa.font_faces.some((face) => /Fixture Sans/.test(face.family)), 'first font alias loaded');
  assert(qa.font_faces.some((face) => /Fixture Display/.test(face.family)), 'second alias using same bytes loaded');
  const currentHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const currentTree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const currentDirty = !!spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  assert.strictEqual(qa.provenance.repository_base_commit, currentHead, 'receipt base commit is observed from git');
  assert.strictEqual(qa.provenance.repository_base_tree, currentTree, 'receipt base tree is observed from git');
  assert.strictEqual(qa.provenance.working_tree_dirty, currentDirty, 'receipt reports actual working-tree state');
  assert.strictEqual(qa.provenance.repository_head_if_clean, currentDirty ? null : currentHead, 'dirty base is never labelled tested head');
  assert(Array.isArray(qa.provenance.implementation_files) && qa.provenance.implementation_files.length >= 5);
  assert(!('acceptance_commands' in qa.provenance), 'runtime receipt does not invent test results');
  const html = fs.readFileSync(source, 'utf8');
  assert(/Content-Security-Policy[^>]*default-src 'none'/.test(html));
  assert(!/https?:\/\//i.test(html), 'editable HTML is self-contained and offline');
  assert(Buffer.compare(originalImageBytes, fs.readFileSync(image)) === 0, 'source image bytes unchanged after success');
  assert(Math.abs(qa.pdf_page_points.width - 288) < 0.51 && Math.abs(qa.pdf_page_points.height - 360) < 0.51, 'PDF MediaBox is physical 4x5 inches at 300 DPI');
  const extracted = extractPdfText(pdf);
  assert.strictEqual(extracted.status, 0, extracted.error);
  const extractedText = extracted.text.replace(/\s+/g, ' ').trim();
  assert(extractedText.includes('Kiểm tra chữ Việt — Đặng Ánh'), `PDF keeps Vietnamese text via ${extracted.method}: ${extractedText}`);

  const pdfRaster = rasterizePdf(pdf, path.join(here, 'pdf-raster'));
  assert.strictEqual(pdfRaster.status, 0, pdfRaster.error);
  const pixelScript = [
    'from PIL import Image',
    `src=Image.open(${JSON.stringify(image)}).convert("RGBA")`,
    `png=Image.open(${JSON.stringify(png)}).convert("RGBA")`,
    `pdf=Image.open(${JSON.stringify(pdfRaster.file)}).convert("RGBA")`,
    'assert png.size==(1200,1500)',
    'at=lambda im,x,y: im.getpixel((round(x*im.width/1200),round(y*im.height/1500)))[:3]',
    'expect=src.getpixel((160,140))[:3]',
    'p=at(png,630,250); q=at(pdf,630,250)',
    'assert max(abs(a-b) for a,b in zip(expect,p))<12,(expect,p)',
    'assert max(abs(a-b) for a,b in zip(p,q))<35,(p,q,pdf.size)',
    'p2=at(png,1120,1410); q2=at(pdf,1120,1410)',
    'assert max(abs(a-b) for a,b in zip(p2,q2))<35,(p2,q2,pdf.size)',
  ].join(';');
  const pixels = spawnSync('python3', ['-c', pixelScript], { encoding: 'utf8' });
  assert.strictEqual(pixels.status, 0, pixels.stderr);
  const badDims = { ...manifest, images: manifest.images.map((layer, index) => index ? layer : { ...layer, source_width: 799 }) };
  const dimsFail = runTool(badDims, path.join(here, 'negative'));
  assert.notStrictEqual(dimsFail.result.status, 0);
  assert(/do not match decoded/.test(dimsFail.body.error), dimsFail.body.error);

  const dpiFailures = {};
  for (const dpi of [36, 1200]) {
    const dpiOut = path.join(here, 'negative', `dpi-${dpi}`); fs.mkdirSync(dpiOut);
    const failed = runTool({ ...manifest, canvas: { ...manifest.canvas, dpi } }, dpiOut);
    dpiFailures[dpi] = { exit_code: failed.result.status, error: failed.body.error };
    assert.notStrictEqual(failed.result.status, 0);
    assert(/canvas\.dpi must be an integer from 48 to 960/.test(failed.body.error), failed.body.error);
  }
  const unknownOut = path.join(here, 'negative', 'unknown'); fs.mkdirSync(unknownOut);
  const unknown = runTool({ ...manifest, surprise: true }, unknownOut);
  assert.notStrictEqual(unknown.result.status, 0);
  assert(/unknown properties/.test(unknown.body.error), unknown.body.error);

  const alphaManifest = {
    canvas: { width: 200, height: 200, dpi: 100 },
    images: [{ id: 'alpha-only', asset: imageAsset, source_width: 800, source_height: 800,
      source: rect(0, 0, 800, 800), dest: rect(20, 20, 160, 160) }],
  };
  const alphaRun = runTool(alphaManifest, path.join(here, 'alpha'));
  assert.strictEqual(alphaRun.result.status, 0, alphaRun.result.stdout + alphaRun.result.stderr);
  const alphaBundle = bundleFrom(alphaRun.body.text);
  const alphaQa = JSON.parse(fs.readFileSync(path.join(alphaBundle, 'qa-receipt.json'), 'utf8'));
  assert.strictEqual(alphaQa.validation.fonts_ready, true, 'no text means fonts_ready is vacuously true');
  const alphaCheck = spawnSync('python3', ['-c', [
    'from PIL import Image',
    `p=Image.open(${JSON.stringify(path.join(alphaBundle, 'poster.png'))}).convert("RGBA")`,
    'assert p.getpixel((5,5))[3]==0',
    'assert p.getpixel((100,100))[3]>0',
  ].join(';')], { encoding: 'utf8' });
  assert.strictEqual(alphaCheck.status, 0, alphaCheck.stderr);

  const textManifest = {
    canvas: { width: 420, height: 220, dpi: 100 },
    text: [{ id: 'text-only', text: 'Kiểm tra chữ Việt — Đặng Ánh', color: '#17130FFF', align: 'left',
      bounds: rect(20, 50, 380, 100), font: fontFace('Fixture Sans', 24, 400, 1.2) }],
  };
  const textRun = runTool(textManifest, path.join(here, 'text'));
  assert.strictEqual(textRun.result.status, 0, textRun.result.stdout + textRun.result.stderr);
  const textBundle = bundleFrom(textRun.body.text);
  const textQa = JSON.parse(fs.readFileSync(path.join(textBundle, 'qa-receipt.json'), 'utf8'));
  assert.strictEqual(textQa.validation.images_nonzero, true, 'no images means images_nonzero is vacuously true');
  const overflowOut = path.join(here, 'negative', 'overflow'); fs.mkdirSync(overflowOut);
  const overflow = { ...textManifest, text: [{ ...textManifest.text[0],
    text: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
    bounds: rect(400, 200, 10, 10), font: fontFace('Fixture Sans', 40) }] };
  const failedOverflow = runTool(overflow, overflowOut);
  assert.notStrictEqual(failedOverflow.result.status, 0);
  assert(/accidental text overflow/.test(failedOverflow.body.error));
  assert(Buffer.compare(originalImageBytes, fs.readFileSync(image)) === 0, 'source unchanged after failed render');

  const cliManifest = path.join(here, 'cli-manifest.json');
  fs.writeFileSync(cliManifest, JSON.stringify(manifest));
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'cli.js'), 'poster-render', cliManifest, '--output-dir', path.join(here, 'cli')], {
    encoding: 'utf8', timeout: 180000, env: environment,
  });
  assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout);
  assert(fs.existsSync(path.join(bundleFrom(cli.stdout), 'poster.pdf')), 'CLI dispatch succeeds');

  const port = 27831 + (process.pid % 1000);
  const httpServer = spawn(process.execPath, [path.join(ROOT, 'http.js')], {
    env: { ...environment, MYSTIC_STUDIO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let httpProof = null;
  try {
    const toolsBody = await waitHttp(port);
    assert.deepStrictEqual(toolsBody.tools.find((tool) => tool.name === 'poster_render').inputSchema, schema, 'HTTP/MCP schemas agree');
    const unknownHttp = await httpJson(port, 'POST', '/v1/call', { name: 'no_such_tool', arguments: {} });
    assert.strictEqual(unknownHttp.status, 400, 'HTTP errors cleanly for unknown tool');
    const accepted = await httpJson(port, 'POST', '/v1/call', {
      name: 'poster_render', arguments: { manifest, output_dir: path.join(here, 'http') },
    });
    assert.strictEqual(accepted.status, 202, JSON.stringify(accepted.body));
    const job = await waitJob(port, accepted.body.job_id);
    assert.strictEqual(job.status, 'done', job.error || '');
    assert(fs.existsSync(path.join(bundleFrom(job.result), 'poster.png')), 'HTTP dispatch produced a real poster');
    httpProof = {
      tools_status: 200,
      unknown_tool_status: unknownHttp.status,
      call_status: accepted.status,
      job_status: job.status,
    };
  } finally {
    httpServer.kill('SIGTERM');
  }

  const copies = {
    'poster.png': 'poster-test-fixture.png',
    'poster.pdf': 'poster-test-fixture.pdf',
    'source.html': 'poster-test-fixture.html',
    'qa-receipt.json': 'poster-test-fixture.qa.json',
  };
  for (const [sourceName, targetName] of Object.entries(copies)) {
    fs.copyFileSync(path.join(mainBundle, sourceName), path.join(DELIVERABLE, targetName));
  }
  const alphaFixtureName = 'poster-test-fixture-alpha.png';
  fs.copyFileSync(image, path.join(DELIVERABLE, alphaFixtureName));
  const artifactNames = [...Object.values(copies), alphaFixtureName];
  const artifactHashes = Object.fromEntries(artifactNames.map((name) => [name, hash(path.join(DELIVERABLE, name))]));
  fs.writeFileSync(path.join(DELIVERABLE, 'poster-test-fixture.checksums.json'), JSON.stringify(artifactHashes, null, 2));

  const proof = {
    fixture: 'generic 1200x1500 TEST FIXTURE — no customer/business media',
    git: { head: currentHead, tree: currentTree, working_tree_dirty: currentDirty },
    dispatch: {
      direct_run: { exit_code: run.result.status },
      mcp: { process_exit_code: schemaProbe.processStatus, call_is_error: !!schemaProbe.call.result.isError },
      cli: { exit_code: cli.status },
      http: httpProof,
    },
    pdf: {
      page_points: qa.pdf_page_points,
      physical_inches: qa.pdf_physical_inches,
      text_extractor: extracted.method,
      rasterizer: pdfRaster.method,
      crop_pixel_check_exit: pixels.status,
    },
    negative_checks: {
      decoded_dimension_mismatch_exit: dimsFail.result.status,
      invalid_dpi: dpiFailures,
      unknown_manifest_property_exit: unknown.result.status,
      text_overflow_exit: failedOverflow.result.status,
    },
    vacuous_validation: {
      no_text_fonts_ready: alphaQa.validation.fonts_ready,
      no_images_images_nonzero: textQa.validation.images_nonzero,
    },
    source_preservation: {
      original_alpha_sha256: imageHash,
      original_alpha_unchanged: Buffer.compare(originalImageBytes, fs.readFileSync(image)) === 0,
    },
    artifacts: artifactHashes,
  };
  fs.writeFileSync(path.join(DELIVERABLE, 'poster-test-fixture-proof.json'), JSON.stringify(proof, null, 2));
  console.log(`browser poster proof passed: ${mainBundle}`);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
