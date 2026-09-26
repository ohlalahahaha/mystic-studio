#!/usr/bin/env node
'use strict';
// Screenshot helper. Resolves playwright-core and a Chromium binary at runtime —
// no pinned versions. `--check` prints playwright=<OK|MISSING> and browser=<OK|MISSING>.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PLAYWRIGHT_HOSTS = process.env.MYSTIC_STUDIO_PLAYWRIGHT_HOSTS;

function resolvePlaywright() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  const from = (p) => { try { return require.resolve('playwright-core', { paths: [p] }); } catch { return null; } };
  const roots = [process.cwd(), path.join(os.homedir(), 'node_modules')];
  try { roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()); } catch {}
  if (PLAYWRIGHT_HOSTS) PLAYWRIGHT_HOSTS.split(':').forEach((p) => roots.push(p));
  for (const extra of ['/usr/local/lib/node_modules', '/usr/lib/node_modules', '/opt/homebrew/lib/node_modules']) roots.push(extra);
  // nested installs: <root>/<pkg>/node_modules/playwright-core and <root>/@scope/pkg/node_modules/...
  try {
    for (const root of roots.slice()) {
      let entries = [];
      try { entries = fs.readdirSync(root); } catch { continue; }
      for (const e of entries) {
        if (e.startsWith('.') || e === 'node_modules') continue;
        roots.push(path.join(root, e, 'node_modules'));
        if (e.startsWith('@')) {
          let inner = [];
          try { inner = fs.readdirSync(path.join(root, e)); } catch { continue; }
          for (const p of inner) roots.push(path.join(root, e, p, 'node_modules'));
        }
      }
    }
  } catch {}
  for (const r of roots) {
    const hit = from(r);
    if (hit) return hit;
  }
  return null;
}

function scanBrowser() {
  const caches = [path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), path.join(os.homedir(), '.cache', 'ms-playwright')];
  const BIN_NAMES = new Set(['chrome-headless-shell', 'headless_shell', 'chrome', 'Chromium']);
  const found = [];
  for (const cache of caches) {
    let dirs = [];
    try { dirs = fs.readdirSync(cache).filter((d) => /^chromium/.test(d)); } catch { continue; }
    for (const d of dirs) {
      const rootDir = path.join(cache, d);
      const stack = [[rootDir, 0]];
      while (stack.length) {
        const [dir, depth] = stack.pop();
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) { if (depth < 4 && !e.name.startsWith('_')) stack.push([p, depth + 1]); }
          else if (BIN_NAMES.has(e.name)) found.push({ p, v: parseInt((d.match(/-(\d+)/) || [])[1] || '0', 10), shell: /headless/.test(e.name) ? 1 : 0 });
        }
      }
    }
  }
  if (!found.length) return null;
  // prefer headless shells, then newest version
  found.sort((a, b) => (b.shell - a.shell) || (b.v - a.v));
  return found[0].p;
}

let _check = null;
function check() {
  if (_check) return _check;
  const pw = resolvePlaywright();
  let browser = null;
  const envChrome = process.env.MYSTIC_STUDIO_CHROME;
  if (envChrome) {
    // Explicit override wins, fail-closed: a set-but-missing path is an error to report,
    // never silently fall back to a scan that ignores what the user asked for.
    browser = fs.existsSync(envChrome) ? envChrome : null;
  } else if (pw) {
    try {
      const { chromium } = require(pw);
      const auto = chromium.executablePath();
      browser = auto && fs.existsSync(auto) ? auto : scanBrowser();
    } catch { browser = scanBrowser(); }
  }
  _check = { pw, browser };
  return _check;
}

if (process.argv[2] === '--check') {
  const { pw, browser } = check();
  console.log(`playwright=${pw ? 'OK' : 'MISSING'} ${pw || 'npm i -g playwright-core (or set PLAYWRIGHT_CORE)'}`.trim());
  console.log(`browser=${browser ? 'OK' : 'MISSING'} ${browser || 'npx playwright install chromium (or set MYSTIC_STUDIO_CHROME to a Chrome binary)'}`.trim());
  process.exit(0);
}

function main() {
  const [url, out] = process.argv.slice(2);
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
  const width = Number(arg('--w')) || 1280;
  const height = Number(arg('--h')) || 900;
  const dpr = Math.max(1, Math.min(4, Number(arg('--dpr')) || 1));
  const full = process.argv.includes('--full');
  const healthPath = arg('--health');
  if (!url || !out) { console.error('usage: shot.js <url> <out.png> [--w 1280] [--h 900] [--dpr 1] [--full] [--health out.health.json]'); process.exit(2); }

  const { pw, browser } = check();
  if (!pw) { console.error('playwright-core not found — npm i -g playwright-core, or set PLAYWRIGHT_CORE'); process.exit(1); }
  if (!browser) { console.error('no chromium browser found — npx playwright install chromium, or set MYSTIC_STUDIO_CHROME'); process.exit(1); }

  const { chromium } = require(pw);
  (async () => {
    const browserCtx = await chromium.launch({ headless: true, executablePath: browser });
    const page = await browserCtx.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
    // Page health: rendered-DOM facts a screenshot alone cannot prove. Listeners attach
    // BEFORE goto so early 4xx/5xx and console errors are caught, not just steady-state.
    const health = { url, at: new Date().toISOString(), httpErrors: [], consoleErrors: [], pageErrors: [], brokenImages: [], pendingImages: 0 };
    if (healthPath) {
      page.on('response', (r) => { if (r.status() >= 400 && health.httpErrors.length < 50) health.httpErrors.push({ url: r.url(), status: r.status() }); });
      page.on('console', (m) => { if (m.type() === 'error' && health.consoleErrors.length < 50) health.consoleErrors.push(m.text().slice(0, 200)); });
      page.on('pageerror', (e) => { if (health.pageErrors.length < 50) health.pageErrors.push(String((e && e.message) || e).slice(0, 200)); });
    }
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1500);
    if (healthPath) {
      // Scroll pass to trigger lazy loaders, then settle. A below-fold lazy image is
      // PENDING, not broken — racing the capture caused false failures in practice.
      try {
        await page.evaluate(async () => {
          const step = Math.round(window.innerHeight * 0.9) || 800;
          for (let y = 0; y <= document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(700);
        const imgs = await page.evaluate(() => Array.from(document.images).map((im) => ({ src: im.currentSrc || im.src, complete: im.complete, w: im.naturalWidth })));
        // complete && naturalWidth===0 = genuinely broken; !complete = still loading (timing).
        health.brokenImages = imgs.filter((i) => i.complete && i.w === 0 && i.src).map((i) => ({ src: i.src }));
        health.pendingImages = imgs.filter((i) => !i.complete).length;
      } catch (e) { health.note = `health scan incomplete: ${String((e && e.message) || e).slice(0, 150)}`; }
    }
    await page.screenshot({ path: out, fullPage: full });
    await browserCtx.close();
    if (healthPath) fs.writeFileSync(healthPath, JSON.stringify(health, null, 2));
    console.log(`shot ${url} -> ${out}`);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
main();
