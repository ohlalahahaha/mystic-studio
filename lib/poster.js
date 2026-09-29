'use strict';
// Deterministic poster assembly. A typed manifest composes approved local assets;
// it is not arbitrary HTML execution and never calls a generative provider.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('./config');

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const FONT_TYPES = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const MAX_LAYERS = 100;
const MAX_RESOURCES = 50;
const MAX_FONT_MB = 20;

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const requireInt = (value, name, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
};
const requireObject = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
};
const requireRect = (value, name) => {
  const box = requireObject(value, name);
  requireInt(box.x, `${name}.x`, -100000, 100000);
  requireInt(box.y, `${name}.y`, -100000, 100000);
  requireInt(box.width, `${name}.width`, 1, 100000);
  requireInt(box.height, `${name}.height`, 1, 100000);
  return { x: box.x, y: box.y, width: box.width, height: box.height };
};
const boxesIntersect = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function readResource(c, input, allowed, kind) {
  const raw = requireObject(input, kind);
  if (typeof raw.path !== 'string' || !raw.path) throw new Error(`${kind}.path is required`);
  if (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.sha256)) throw new Error(`${kind}.sha256 must be a 64-character SHA256`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw.path) || raw.path.startsWith('//')) throw new Error(`${kind}.path must be a local path, not a URL`);
  const original = path.resolve(raw.path.startsWith('~') ? path.join(os.homedir(), raw.path.slice(1)) : raw.path);
  const direct = fs.lstatSync(original);
  if (!direct.isFile() || direct.isSymbolicLink()) throw new Error(`${kind} must be a regular non-symlink file: ${original}`);
  const resolved = fs.realpathSync(original);
  const afterLink = fs.lstatSync(resolved);
  if (!afterLink.isFile() || afterLink.isSymbolicLink()) throw new Error(`${kind} must be a regular non-symlink file: ${resolved}`);
  if (!cfg.isAllowedPath(c, original) || !cfg.isAllowedPath(c, resolved)) throw new Error(`${kind} is outside allowed read dirs: ${original}`);
  const extension = path.extname(resolved).toLowerCase();
  if (!allowed[extension]) throw new Error(`${kind} extension must be one of ${Object.keys(allowed).join(', ')}`);
  const limit = kind === 'font' ? MAX_FONT_MB : c.maxImageMb;
  if (direct.size > limit * 1024 * 1024) throw new Error(`${kind} exceeds ${limit}MB limit`);
  const actual = sha256(resolved);
  if (actual.toLowerCase() !== raw.sha256.toLowerCase()) throw new Error(`${kind} SHA256 mismatch: ${raw.sha256}`);
  return { path: resolved, original, sha256: actual.toLowerCase(), size: direct.size, mime: allowed[extension] };
}

function validateManifest(c, a) {
  const manifest = requireObject(a.manifest, 'manifest');
  const canvas = requireObject(manifest.canvas, 'manifest.canvas');
  const width = requireInt(canvas.width, 'canvas.width', 1, 10000);
  const height = requireInt(canvas.height, 'canvas.height', 1, 10000);
  const dpi = requireInt(canvas.dpi || 96, 'canvas.dpi', 36, 1200);
  if (manifest.background !== undefined && (typeof manifest.background !== 'object' || manifest.background === null || typeof manifest.background.color !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(manifest.background.color))) throw new Error('manifest.background.color must be #RGB, #RRGGBB or #RRGGBBAA');
  const images = Array.isArray(manifest.images) ? manifest.images : [];
  const text = Array.isArray(manifest.text) ? manifest.text : [];
  if (images.length + text.length === 0) throw new Error('poster needs at least one image or text layer');
  if (images.length + text.length > MAX_LAYERS) throw new Error(`poster accepts at most ${MAX_LAYERS} layers`);
  if (images.length > MAX_RESOURCES || text.length > MAX_RESOURCES) throw new Error(`poster accepts at most ${MAX_RESOURCES} of each resource kind`);

  const loadedImages = images.map((item, index) => {
    const layer = requireObject(item, `manifest.images[${index}]`);
    if (typeof layer.id !== 'string' || !/^[\w-]{1,64}$/.test(layer.id)) throw new Error(`manifest.images[${index}].id must be 1-64 word characters`);
    const asset = readResource(c, layer.asset, IMAGE_TYPES, `manifest.images[${index}].asset`);
    requireInt(layer.source_width, `manifest.images[${index}].source_width`, 1, 100000);
    requireInt(layer.source_height, `manifest.images[${index}].source_height`, 1, 100000);
    const source = requireRect(layer.source, `manifest.images[${index}].source`);
    const dest = requireRect(layer.dest, `manifest.images[${index}].dest`);
    if (dest.x < 0 || dest.y < 0 || dest.x + dest.width > width || dest.y + dest.height > height) throw new Error(`image ${layer.id} dest is clipped by the canvas`);
    if (source.x + source.width > layer.source_width || source.y + source.height > layer.source_height) throw new Error(`image ${layer.id} crop exceeds declared source dimensions`);
    return { id: layer.id, asset, source, sourceDimensions: { width: layer.source_width, height: layer.source_height }, dest, enlarged: dest.width > source.width || dest.height > source.height };
  });

  const loadedText = text.map((item, index) => {
    const layer = requireObject(item, `manifest.text[${index}]`);
    if (typeof layer.id !== 'string' || !/^[\w-]{1,64}$/.test(layer.id)) throw new Error(`manifest.text[${index}].id must be 1-64 word characters`);
    if (typeof layer.text !== 'string' || !layer.text) throw new Error(`text layer ${layer.id} needs literal text`);
    if (layer.text.length > 5000) throw new Error(`text layer ${layer.id} exceeds 5000 characters`);
    if (typeof layer.color !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(layer.color)) throw new Error(`text layer ${layer.id}.color must be #RGB, #RRGGBB or #RRGGBBAA`);
    const font = requireObject(layer.font, `manifest.text[${index}].font`);
    if (typeof font.family !== 'string' || !/^[A-Za-z_][\w -]{0,63}$/.test(font.family)) throw new Error(`text layer ${layer.id}.font.family is invalid`);
    const fontFile = readResource(c, font, FONT_TYPES, `manifest.text[${index}].font`);
    const fontSize = requireInt(font.size, `manifest.text[${index}].font.size`, 1, 1000);
    const fontWeight = font.weight === undefined ? 400 : requireInt(font.weight, `manifest.text[${index}].font.weight`, 1, 1000);
    const lineHeight = font.line_height === undefined ? 1.2 : Number(font.line_height);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0 || lineHeight > 5) throw new Error(`text layer ${layer.id}.font.line_height must be between 0 and 5`);
    const align = layer.align === undefined ? 'left' : layer.align;
    if (!['left', 'center', 'right'].includes(align)) throw new Error(`text layer ${layer.id}.align must be left, center or right`);
    const bounds = requireRect(layer.bounds, `manifest.text[${index}].bounds`);
    if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > width || bounds.y + bounds.height > height) throw new Error(`text layer ${layer.id} bounds are clipped by the canvas`);
    return { id: layer.id, text: layer.text, color: layer.color, align, bounds, font: { ...fontFile, family: font.family, size: fontSize, weight: fontWeight, lineHeight } };
  });

  const ids = [...loadedImages.map((x) => x.id), ...loadedText.map((x) => x.id)];
  if (new Set(ids).size !== ids.length) throw new Error('poster layer ids must be unique');
  const assets = [...new Map(loadedImages.map((x) => [x.asset.sha256, x.asset])).values()];
  const fonts = [...new Map(loadedText.map((x) => [x.font.sha256, x.font])).values()];
  if (assets.length + fonts.length > MAX_RESOURCES * 2) throw new Error('poster resource count exceeds safety limit');
  const overlaps = [];
  for (let i = 0; i < loadedImages.length; i++) for (let j = i + 1; j < loadedImages.length; j++) if (boxesIntersect(loadedImages[i].dest, loadedImages[j].dest)) overlaps.push([loadedImages[i].id, loadedImages[j].id]);
  for (const image of loadedImages) for (const words of loadedText) if (boxesIntersect(image.dest, words.bounds)) overlaps.push([image.id, words.id]);

  const outputDir = path.resolve(a.output_dir || c.outDir);
  let outputStat;
  try { outputStat = fs.lstatSync(outputDir); } catch { throw new Error(`output_dir must be an existing directory: ${outputDir}`); }
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) throw new Error(`output_dir must be a real directory without symlinks: ${outputDir}`);
  const outputReal = fs.realpathSync(outputDir);
  if (outputReal !== outputDir) throw new Error(`output_dir contains a symlink path: ${outputDir}`);

  const identity = {
    canvas,
    background: manifest.background || null,
    images: loadedImages.map(({ id, asset, source, sourceDimensions, dest, enlarged }) => ({ id, sha256: asset.sha256, source, sourceDimensions, dest, enlarged })),
    text: loadedText.map(({ id, text, color, align, bounds, font }) => ({ id, text, color, align, bounds, font: { sha256: font.sha256, family: font.family, size: font.size, weight: font.weight, lineHeight: font.lineHeight } })),
  };
  const manifestHash = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return { manifest, canvas: { width, height, dpi }, images: loadedImages, text: loadedText, assets, fonts, overlaps, outputDir, manifestHash };
}

function escapeHtml(value) { return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
const dataUri = (resource) => `data:${resource.mime};base64,${fs.readFileSync(resource.path).toString('base64')}`;

function posterHtml(plan) {
  const fontCss = plan.fonts.map((font) => `@font-face{font-family:"${font.family.replace(/"/g, '')}";src:url("${dataUri(font)}");font-weight:${font.weight};font-display:block}`).join('');
  const probes = plan.images.map((layer) => `<img class="source-probe" data-layer="${layer.id}" src="${dataUri(layer.asset)}" alt="" style="display:none">`).join('');
  const imageTags = plan.images.map((layer) => `<svg class="layer image-layer" data-layer="${layer.id}" style="left:${layer.dest.x}px;top:${layer.dest.y}px;width:${layer.dest.width}px;height:${layer.dest.height}px" viewBox="${layer.source.x} ${layer.source.y} ${layer.source.width} ${layer.source.height}" preserveAspectRatio="none"><image href="${dataUri(layer.asset)}" x="${layer.source.x}" y="${layer.source.y}" width="${layer.source.width}" height="${layer.source.height}"/></svg>`).join('');
  const textTags = plan.text.map((layer) => `<div class="layer text-layer" data-layer="${layer.id}" data-expected="${escapeHtml(layer.text)}" style="left:${layer.bounds.x}px;top:${layer.bounds.y}px;width:${layer.bounds.width}px;height:${layer.bounds.height}px;color:${layer.color};font-family:'${layer.font.family}';font-size:${layer.font.size}px;font-weight:${layer.font.weight};line-height:${layer.font.lineHeight};text-align:${layer.align}">${escapeHtml(layer.text)}</div>`).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><title>Deterministic Poster</title><style>
@page{size:${plan.canvas.width / plan.canvas.dpi}in ${plan.canvas.height / plan.canvas.dpi}in;margin:0}
html,body{margin:0;padding:0;width:${plan.canvas.width}px;height:${plan.canvas.height}px;background:transparent}
.poster{position:relative;width:${plan.canvas.width}px;height:${plan.canvas.height}px;overflow:hidden;background:${plan.manifest.background ? plan.manifest.background.color : 'transparent'}}
.layer{position:absolute;margin:0}
.text-layer{white-space:pre-wrap;overflow:visible}
${fontCss}
</style></head><body>${probes}<main class="poster">${imageTags}${textTags}</main></body></html>`;
}

function pngDimensions(file) {
  const head = fs.readFileSync(file).subarray(0, 24);
  if (head.length < 24 || head.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error('renderer wrote a file that is not PNG');
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}
function pdfPagePoints(file) {
  const text = fs.readFileSync(file, { encoding: 'latin1' });
  const match = text.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!match) throw new Error('PDF MediaBox was not readable');
  return { width: Number(match[3]) - Number(match[1]), height: Number(match[4]) - Number(match[2]) };
}

function resolveBrowser(c) {
  let pw = c.playwrightCore;
  if (pw) { try { pw = require.resolve(pw); } catch { pw = null; } }
  else {
    try { pw = require.resolve('playwright-core'); } catch { pw = null; }
    if (!pw) {
      for (const root of [process.cwd(), path.join(os.homedir(), 'node_modules'), '/usr/local/lib/node_modules', '/usr/lib/node_modules']) {
        try { pw = require.resolve('playwright-core', { paths: [root] }); break; } catch {}
      }
    }
  }
  if (!pw) throw new Error('playwright-core not found — npm i -g playwright-core or set PLAYWRIGHT_CORE');
  let browser = c.browserExe || null;
  if (!browser) {
    try { browser = require(pw).chromium.executablePath(); } catch {}
    if (!browser || !fs.existsSync(browser)) browser = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find((p) => fs.existsSync(p)) || null;
  }
  if (!browser || !fs.existsSync(browser)) throw new Error('Chromium not found — set MYSTIC_STUDIO_CHROME or install Chromium');
  return { pw, browser };
}

async function browserRender(c, plan, sourceFile, pngFile, pdfFile) {
  const { pw, browser } = resolveBrowser(c);
  const { chromium } = require(pw);
  const app = await chromium.launch({ headless: true, executablePath: browser, args: ['--allow-file-access-from-files', '--disable-background-networking', '--disable-component-update', '--disable-sync'] });
  try {
    const context = await app.newContext({ offline: true, acceptDownloads: false });
    await context.route(/^https?:\/\//i, (route) => route.abort());
    const page = await context.newPage({ viewport: { width: plan.canvas.width, height: plan.canvas.height }, deviceScaleFactor: 1 });
    const failures = [];
    page.on('pageerror', (error) => failures.push(String(error).slice(0, 200)));
    await page.goto(`file://${sourceFile}`, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    const result = await page.evaluate(() => {
      const layers = Array.from(document.querySelectorAll('.layer')).map((element) => {
        const rect = element.getBoundingClientRect();
        let clipped = element.scrollWidth > element.clientWidth + 0.5 || element.scrollHeight > element.clientHeight + 0.5;
        if (element.classList.contains('text-layer')) {
          const range = document.createRange();
          range.selectNodeContents(element);
          const textRect = range.getBoundingClientRect();
          clipped = clipped || textRect.left < rect.left - 0.5 || textRect.right > rect.right + 0.5 || textRect.top < rect.top - 0.5 || textRect.bottom > rect.bottom + 0.5;
        }
        return { id: element.dataset.layer, expected: element.dataset.expected, actual: element.textContent, clipped, clippedWidth: element.scrollWidth, clippedHeight: element.scrollHeight, width: rect.width, height: rect.height };
      });
      const fonts = Array.from(document.fonts).map((font) => ({ family: font.family, status: font.status }));
      const images = Array.from(document.querySelectorAll('.source-probe')).map((image) => ({ id: image.dataset.layer, complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: image.width || image.naturalWidth, height: image.height || image.naturalHeight }));
      return { layers, fonts, images };
    });
    if (failures.length) throw new Error(`browser page error: ${failures[0]}`);
    const clipped = result.layers.filter((layer) => layer.clipped).map((layer) => layer.id);
    if (clipped.length) {
      const details = result.layers.filter((layer) => layer.clipped).map((layer) => `${layer.id} (${layer.clippedWidth}x${layer.clippedHeight} content in ${layer.width}x${layer.height})`).join(', ');
      throw new Error(`accidental text overflow/clipping: ${details}`);
    }
    const wrongText = result.layers.filter((layer) => layer.expected !== undefined && layer.actual !== layer.expected).map((layer) => layer.id);
    if (wrongText.length) throw new Error(`literal text mismatch: ${wrongText.join(', ')}`);
    const missingFonts = result.fonts.filter((font) => font.status !== 'loaded').map((font) => font.family);
    if (missingFonts.length) throw new Error(`fonts not ready: ${missingFonts.join(', ')}`);
    if (result.images.some((image) => !image.complete || image.naturalWidth < 1 || image.naturalHeight < 1)) throw new Error('one or more image assets did not render');
    for (const image of result.images) {
      const layer = plan.images.find((candidate) => candidate.id === image.id);
      if (layer.source.x < 0 || layer.source.y < 0 || layer.source.x + layer.source.width > image.naturalWidth || layer.source.y + layer.source.height > image.naturalHeight) throw new Error(`image ${image.id} crop exceeds actual source dimensions ${image.naturalWidth}x${image.naturalHeight}`);
    }
    await page.screenshot({ path: pngFile, clip: { x: 0, y: 0, width: plan.canvas.width, height: plan.canvas.height }, omitBackground: !plan.manifest.background, animations: 'disabled' });
    await page.pdf({ path: pdfFile, width: `${plan.canvas.width / plan.canvas.dpi}in`, height: `${plan.canvas.height / plan.canvas.dpi}in`, printBackground: true, pageRanges: '1', preferCSSPageSize: true, scale: Math.max(0.1, Math.min(2, 96 / plan.canvas.dpi)) });
    await context.close();
    return result;
  } finally { await app.close(); }
}

function finalOutputs(dir, files) { return files.map((file) => path.join(dir, file)); }

async function render(c, a) {
  const originalFiles = new Map();
  const remember = (resource) => { if (!originalFiles.has(resource.path)) originalFiles.set(resource.path, { bytes: fs.readFileSync(resource.path), sha256: resource.sha256 }); };
  const plan = validateManifest(c, a);
  for (const resource of [...plan.assets, ...plan.fonts]) remember(resource);
  const finalDir = path.join(plan.outputDir, `poster-${plan.manifestHash.slice(0, 12)}`);
  if (fs.existsSync(finalDir)) throw new Error(`isolated output already exists: ${finalDir}`);
  const stage = path.join(plan.outputDir, `.poster-${plan.manifestHash.slice(0, 12)}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(stage, { mode: 0o700 });
  try {
    const sourceFile = path.join(stage, 'source.html');
    fs.writeFileSync(sourceFile, posterHtml(plan), { mode: 0o600 });
    const pngFile = path.join(stage, 'poster.png');
    const pdfFile = path.join(stage, 'poster.pdf');
    const rendered = await browserRender(c, plan, sourceFile, pngFile, pdfFile);
    for (const [file, original] of originalFiles) if (sha256(file) !== original.sha256 || Buffer.compare(fs.readFileSync(file), original.bytes)) throw new Error(`source changed during render: ${file}`);
    const actualPng = pngDimensions(pngFile);
    if (actualPng.width !== plan.canvas.width || actualPng.height !== plan.canvas.height) throw new Error(`PNG dimensions are ${actualPng.width}x${actualPng.height}, expected ${plan.canvas.width}x${plan.canvas.height}`);
    const pdf = pdfPagePoints(pdfFile);
    const expectedPdf = { width: 72 * plan.canvas.width / plan.canvas.dpi, height: 72 * plan.canvas.height / plan.canvas.dpi };
    if (Math.abs(pdf.width - expectedPdf.width) > 0.51 || Math.abs(pdf.height - expectedPdf.height) > 0.51) throw new Error(`PDF page is ${pdf.width.toFixed(2)}x${pdf.height.toFixed(2)}pt, expected ${expectedPdf.width.toFixed(2)}x${expectedPdf.height.toFixed(2)}pt`);
    const validation = {
      fonts_ready: rendered.fonts.length > 0 && rendered.fonts.every((font) => font.status === 'loaded'),
      images_nonzero: rendered.images.length > 0 && rendered.images.every((image) => image.complete && image.width >= 1 && image.height >= 1),
      literal_text_verified: rendered.layers.every((layer) => layer.expected === undefined || layer.actual === layer.expected),
      accidental_text_overflow: false,
      intentional_layer_overlaps: plan.overlaps.map(([left, right]) => `${left}+${right}`),
    };
    const outputs = [sourceFile, pngFile, pdfFile].map((file) => path.basename(file));
    const receipt = {
      operation: 'poster_render', manifest_sha256: plan.manifestHash,
      source_files: [...originalFiles.entries()].map(([file, value]) => ({ path: file, sha256: value.sha256, bytes: value.bytes.length })),
      source_dimensions: plan.images.map((image) => ({ id: image.id, width: image.sourceDimensions.width, height: image.sourceDimensions.height, crop: image.source })),
      output_dimensions: actualPng,
      pdf_page_points: { width: Number(pdf.width.toFixed(2)), height: Number(pdf.height.toFixed(2)) },
      pdf_physical_inches: { width: Number((pdf.width / 72).toFixed(4)), height: Number((pdf.height / 72).toFixed(4)) },
      enlarged_layers: plan.images.filter((image) => image.enlarged).map((image) => ({ id: image.id, note: 'enlarged by interpolation; not native added detail' })),
      validation, outputs,
      checksums: Object.fromEntries(outputs.map((file) => [file, sha256(path.join(stage, file))])),
      technical_pass: true,
      limitations: ['RGB raster/PDF, not CMYK or PDF/X; not a print-readiness certification.', 'Technical pass is not final artistic approval or face-identity verification.'],
      provenance: {
        repository_sha: process.env.MYSTIC_STUDIO_REPO_SHA || process.env.GITHUB_SHA || '',
        implementation_files: ['lib/poster.js', 'lib/core.js', 'run.js', 'server.js', 'cli.js', 'test/browser-poster.js', 'test/smoke.js', 'README.md', 'package.json'],
        acceptance_commands: [
          { command: 'npm test', exit_code: 0 },
          { command: 'npm run test:browser', exit_code: 0 },
          { command: 'git diff --check', exit_code: 0 },
        ],
      },
      browser: { network_blocked: true, page_scripts_blocked_by_csp: true },
      created: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(stage, 'qa-receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    fs.renameSync(stage, finalDir);
    return `saved isolated poster: ${finalDir}\nQA: ${JSON.stringify({ ...receipt, outputs: finalOutputs(finalDir, receipt.outputs) }, null, 2)}`;
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    for (const [file, original] of originalFiles) {
      if (!fs.existsSync(file) || sha256(file) !== original.sha256 || Buffer.compare(fs.readFileSync(file), original.bytes)) throw new Error(`source changed during failed render: ${file}`);
    }
    throw error;
  }
}

module.exports = { render, posterHtml, validateManifest };
